// Drives the web app (docs/explore/) in headless Chrome, at 1440 px and at 390 px as a phone (device emulation: touch,
// a phone user agent, 3x pixels), against the test mirror (make_mirror.py) served on 127.0.0.1, and checks what the page
// shows against the Swift oracle's answers: search results and their count, Closest matches (heading, wording, rows, the
// note on every row), place pages (newer City results, aka "A · B", alt names never shown), a board with newer results,
// the home grid's counts, and the map (dots drawn, the legend's count, a focused place's card). On every page: no
// requests anywhere but the local server, no cookies, no console errors, nothing wider than the screen. Screenshots go to
// --shots. Chrome runs with its own profile (--profile), never the user's.
//
// usage: node check_browser.mjs --oracle <oracle.json> --mirror <mirror dir> --profile <dir> --shots <dir> [--chrome <path>]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

const opt = {};
for (let i = 2; i + 1 < process.argv.length; i += 2) opt[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if (!opt.oracle || !opt.mirror || !opt.profile || !opt.shots) {
  console.error("usage: node check_browser.mjs --oracle <oracle.json> --mirror <dir> --profile <dir> --shots <dir> [--chrome <path>]"); process.exit(2);
}
const CHROME = opt.chrome || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = resolve(opt.profile), SHOTS = resolve(opt.shots), MIRROR = resolve(opt.mirror);
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const O = JSON.parse(readFileSync(resolve(opt.oracle), "utf8")).datasets.bundled;
const F = O.placeFields;
const place = (row) => Object.fromEntries(F.map((k, i) => [k, row[i]]));
const chicago = O.chicago.map(place), illinois = O.illinois.map(place);
const byId = new Map([...chicago, ...illinois].map((p) => [p.id, p]));
const manifest = JSON.parse(readFileSync(join(MIRROR, "data/v1/manifest.json"), "utf8"));
const rawChicago = JSON.parse(readFileSync(join(MIRROR, "data/v1", manifest.files.chicago.path), "utf8"));

// ------------------------------------------------------------------------------------------------ reporting
let failures = 0, checks = 0, where = "";
function check(ok, what, want, got) {
  checks += 1;
  if (ok) return true;
  failures += 1;
  const show = (v) => { const s = JSON.stringify(v); return s && s.length > 400 ? s.slice(0, 400) + "…" : s; };
  console.log(`  FAIL [${where}] ${what}\n    want: ${show(want)}\n    got:  ${show(got)}`);
  return false;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------------------------------------ a server and Chrome
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = await freePort();
const ORIGIN = `http://127.0.0.1:${port}`;
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", MIRROR], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { if ((await fetch(ORIGIN + "/explore/")).ok) break; } catch { /* starting */ } await sleep(100); }

mkdirSync(PROFILE, { recursive: true });
rmSync(join(PROFILE, "DevToolsActivePort"), { force: true });
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-default-apps",
  "--metrics-recording-only", "--mute-audio", "--hide-scrollbars", "--password-store=basic", "--use-mock-keychain", "about:blank"], { stdio: "ignore" });
let wsPath = null;
for (let i = 0; i < 150 && !wsPath; i++) {
  await sleep(100);
  if (existsSync(join(PROFILE, "DevToolsActivePort"))) {
    const [p, path] = readFileSync(join(PROFILE, "DevToolsActivePort"), "utf8").split("\n");
    if (p && path) wsPath = `ws://127.0.0.1:${p}${path}`;
  }
}
if (!wsPath) { console.error("Chrome didn't start"); chrome.kill(); server.kill(); process.exit(2); }
function stop() { try { chrome.kill(); } catch { /* gone */ } try { server.kill(); } catch { /* gone */ } }

// a minimal DevTools protocol client
const ws = new WebSocket(wsPath);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map(), listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(`${m.error.message}`)) : res(m.result); }
  else if (m.method) for (const fn of listeners) fn(m);
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
const page = (method, params) => send(method, params, S);
const requests = [], problems = [];
listeners.push((m) => {
  if (m.sessionId !== S) return;
  if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
  if (m.method === "Runtime.exceptionThrown") problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) problems.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") problems.push(`log: ${m.params.entry.text} ${m.params.entry.url || ""}`);
});
await page("Page.enable"); await page("Runtime.enable"); await page("Network.enable"); await page("Log.enable");

async function js(expr) {
  const r = await page("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`${expr.slice(0, 80)}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}
async function waitFor(expr, what, ms = 15000) {
  const t = Date.now();
  for (;;) {
    try { const v = await js(expr); if (v) return v; } catch { /* page changing */ }
    if (Date.now() - t > ms) { check(false, `timed out waiting for ${what}`, true, false); return null; }
    await sleep(40);
  }
}
async function shot(name) {
  const m = await js("({w: innerWidth, h: innerHeight})");
  const r = await page("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: m.w, height: m.h, scale: m.w < 720 ? 0.5 : 1 } });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, "base64"));
}
/** Elements sticking out past the right edge of the screen (outside anything that scrolls or clips sideways). */
const OVERFLOW = `(() => {
  const W = document.documentElement.clientWidth, out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= W + 0.5) continue;
    let a = el.parentElement, clipped = false;
    while (a && a !== document.body) { const o = getComputedStyle(a).overflowX; if (o !== "visible") { clipped = true; break; } a = a.parentElement; }
    if (!clipped && getComputedStyle(el).visibility !== "hidden") out.push((el.id ? "#" + el.id : el.tagName.toLowerCase() + "." + el.className) + " right=" + Math.round(r.right));
  }
  return { W, scroll: document.documentElement.scrollWidth, out: out.slice(0, 5) };
})()`;
async function pageChecks(name) {
  const o = await js(OVERFLOW);
  check(o.out.length === 0 && o.scroll <= o.W + 1, `${name}: nothing wider than the ${o.W} px screen`, [], o);
  check((await js("document.cookie")) === "", `${name}: no cookies`, "", await js("document.cookie"));
}
const hashURL = (h) => `${ORIGIN}/explore/${h}`;
/** Opens a route. Within the app it's a hash change, which renders on a later task: a marker left in the old view (a full
 *  render replaces the view's contents) keeps the old page from passing for the new one. */
async function go(h) {
  const before = await js("location.href").catch(() => "");
  if (before.startsWith(ORIGIN + "/explore/") && (await js(`location.hash !== ${JSON.stringify(h)}`))) {
    await js(`document.querySelector("#view").insertAdjacentHTML("beforeend", '<i id="__stale" hidden></i>'); location.hash = ${JSON.stringify(h)}`);
  } else if (!before.startsWith(ORIGIN + "/explore/")) {
    await page("Page.navigate", { url: hashURL(h) });
  }
  await waitFor(`document.readyState === "complete" && location.hash === ${JSON.stringify(h)} && !document.getElementById("__stale") && !document.querySelector("#view .loading")`, `${h} to load`);
}
const paramsOf = (f, scope) => {
  const sp = new URLSearchParams();
  if (scope === "illinois") sp.set("scope", "illinois");
  if (f.sides.length) sp.set("side", f.sides.join(","));
  if (f.hood) sp.set("hood", f.hood);
  if (f.grades.length) sp.set("grade", f.grades.join(""));
  if (f.cuisine) sp.set("cuisine", f.cuisine);
  if (f.liquor) sp.set("liquor", "1");
  if (f.dineIn) sp.set("dinein", "1");
  if (f.hideChains) sp.set("nochains", "1");
  if (f.includeVenues) sp.set("venues", "1");
  if (f.city) sp.set("town", f.city);
  return sp;
};
const anyFilter = (f) => f.sides.length || f.hood || f.grades.length || f.cuisine || f.liquor || f.dineIn || f.hideChains || f.includeVenues || f.city;

// ------------------------------------------------------------------------------------------------ the checks
const CLOSEST_NOTE = "Closest match, not an exact match";
function pickSearches() {
  const S = O.searches;
  const plain = S.filter((s) => !anyFilter(s.filters) && s.text.trim() === s.text && s.text !== "");
  const out = [];
  const take = (list, n) => { for (const s of list) { if (n <= 0) break; if (!out.includes(s)) { out.push(s); n -= 1; } } };
  take(plain.filter((s) => s.source === "coverage sample" && s.total > 0), 10);
  take(plain.filter((s) => s.closest.length > 0 && s.scope === "chicago" && s.source === "queries.tsv"), 8);
  take(plain.filter((s) => s.closest.length > 0 && s.source === "coverage sample"), 4);
  take(plain.filter((s) => s.closest.length > 0 && s.scope === "illinois"), 2);
  take(plain.filter((s) => s.scope === "illinois" && s.total > 0), 4);
  take(plain.filter((s) => s.total === 0 && s.closest.length === 0 && /[a-z]/i.test(s.text)), 2);
  take(plain.filter((s) => s.total > 400), 2);
  take(S.filter((s) => anyFilter(s.filters) && s.text.trim() === s.text && s.total > 0), 5);
  take(S.filter((s) => anyFilter(s.filters) && s.closest.length > 0), 2);
  take(S.filter((s) => anyFilter(s.filters) && s.text === ""), 2);
  return out;
}
const SEARCHES = pickSearches();

async function checkSearch(s, label) {
  const sp = paramsOf(s.filters, s.scope);
  if (s.text) sp.set("q", s.text);
  const h = `#/search?${sp.toString()}`;
  await go(h);
  const done = `(() => { const c = document.querySelector("#scount"); const b = document.querySelector("#sbody");
    return c && b && c.textContent.trim() !== "" && !b.querySelector(".spin") && (b.querySelector("ol.rlist") || b.querySelector(".empty")); })()`;
  if (!(await waitFor(done, `search “${s.text}” to show`))) return;
  const got = await js(`(() => {
    const ids = (sel) => [...document.querySelectorAll(sel)].map((a) => decodeURIComponent(a.getAttribute("href").replace("#/place/", "")));
    const head = document.querySelector(".closest-head");
    return { count: document.querySelector("#scount").textContent.replace(/\\s+/g, " ").trim(),
      shown: ids("#sbody ol.rlist:not(.closest) a.rrow"), closest: ids("#sbody ol.closest a.rrow"),
      notes: [...document.querySelectorAll("#sbody ol.closest a.rrow")].map((a) => a.querySelector(".rclose") ? a.querySelector(".rclose").textContent.trim() : ""),
      head: head ? { h2: head.querySelector("h2").textContent, p: head.querySelector("p").textContent, h3: head.querySelector("h3") && head.querySelector("h3").textContent,
        links: [...head.querySelectorAll("a, button")].map((x) => x.textContent.trim()) } : null,
      empty: document.querySelector("#sbody .empty h2") ? document.querySelector("#sbody .empty h2").textContent : null,
      cap: document.querySelector("#scap").hidden ? null : document.querySelector("#scap").textContent };
  })()`);
  const what = `${label} ${s.scope} “${s.text}”${anyFilter(s.filters) ? " (filtered)" : ""}`;
  const countWant = `${s.total.toLocaleString("en-US")} ${s.total === 1 ? "place" : "places"}${anyFilter(s.filters) ? " · filtered" : ""}`;
  check(got.count === countWant, `${what}: count`, countWant, got.count);
  check(same(got.shown, s.shown.slice(0, 100)), `${what}: the rows shown, in order`, s.shown.slice(0, 100), got.shown);
  check(same(got.closest, s.closest), `${what}: Closest matches`, s.closest, got.closest);
  if (s.closest.length) {
    check(got.notes.every((n) => n === CLOSEST_NOTE) && got.notes.length === s.closest.length, `${what}: every Closest matches row says "${CLOSEST_NOTE}"`, CLOSEST_NOTE, got.notes.slice(0, 3));
    const filtered = anyFilter(s.filters);
    // SearchTab's heading shows the text as searched, trimmed (debounced)
    const want = { h2: `No exact match for “${s.text.trim()}”`, p: filtered ? "These places match only some of your words, or spell them differently. Your filters may be hiding others."
      : "These places match only some of your words, or spell them differently. Check the name and address.", h3: "Closest matches",
      links: [...(filtered ? ["Clear filters"] : []), s.scope === "chicago" ? "Search Rest of Illinois" : "Search Chicago"] };
    check(same(got.head, want), `${what}: the No exact match heading`, want, got.head);
    check(got.empty === null, `${what}: no "No results" panel under Closest matches`, null, got.empty);
    const graded = s.closest.some((id) => byId.get(id)?.grade);
    if (graded) check(got.cap === "Our grades from City inspection records, not official City grades.", `${what}: grades caption`, "Our grades…", got.cap);
  } else if (s.total === 0) {
    check(got.head === null && got.empty === `No results for “${s.text.trim()}”`, `${what}: "No results" panel`, `No results for “${s.text.trim()}”`, got.empty);
  }
}

async function checkPlace(id, label, extra) {
  const p = byId.get(id);
  await go(`#/place/${encodeURIComponent(id)}`);
  if (!(await waitFor(`!!document.querySelector("#view h1") && !document.querySelector("#view .spin")`, `place ${id}`))) return;
  const got = await js(`(() => ({ h1: document.querySelector("#view h1").textContent, title: document.title,
    kv: Object.fromEntries([...document.querySelectorAll("#view dl.kv > div")].map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent])),
    text: document.querySelector("#view").innerText, grade: document.querySelector(".pgrade b") ? document.querySelector(".pgrade b").textContent : null }))()`);
  const what = `${label} ${id} ${p ? p.name : ""}`;
  if (!p) { check(got.h1 === "Not in the current data", `${what}: says it isn't in the data`, "Not in the current data", got.h1); return; }
  check(got.h1 === p.name, `${what}: name`, p.name, got.h1);
  if (p.isChicago) {
    const fmt = (iso) => (iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
    const lastKey = p.newerResult == null ? "Last city inspection" : "Last inspection in our records";
    check(got.kv[lastKey] === `${fmt(p.lastDate)} · ${p.lastResult ?? "—"}`, `${what}: ${lastKey}`, `${fmt(p.lastDate)} · ${p.lastResult}`, got.kv[lastKey]);
    if (p.newerResult) {
      check(got.kv["Newer City result"] === `${p.newerResult}, ${fmt(p.newerDate)}`, `${what}: Newer City result`, `${p.newerResult}, ${fmt(p.newerDate)}`, got.kv["Newer City result"]);
      check(got.text.includes("so it isn't in our score or grade yet."), `${what}: says the newer result isn't in the grade`, true, false);
      check(!("Last city inspection" in got.kv), `${what}: doesn't call the older one the City's last`, undefined, got.kv["Last city inspection"]);
    } else check(!("Newer City result" in got.kv), `${what}: no Newer City result`, undefined, got.kv["Newer City result"]);
    if (p.aka) check(got.kv["Also on City records as"] === p.aka, `${what}: aka shown as "A · B"`, p.aka, got.kv["Also on City records as"]);
    if (p.grade) check(got.grade === `Inspection score ${p.score}/100`, `${what}: score`, `Inspection score ${p.score}/100`, got.grade);
  } else check(got.kv.Town === p.city, `${what}: town`, p.city, got.kv.Town);
  if (extra) await extra(got, what);
}

async function checkBoard(id, label) {
  const want = O.boards[id];
  await go(`#/board/${id}`);
  if (!(await waitFor(`document.querySelectorAll("#blist a.rrow").length > 0`, `board ${id}`))) return;
  const got = await js(`(() => ({ ids: [...document.querySelectorAll("#blist a.rrow")].map((a) => decodeURIComponent(a.getAttribute("href").replace("#/place/", ""))),
    rows: [...document.querySelectorAll("#blist a.rrow")].slice(0, 100).map((a) => [...a.querySelectorAll(".rres")].map((x) => x.textContent)),
    count: document.querySelector("#bcount").textContent.trim(), explainer: document.querySelector("#bexp p").textContent }))()`);
  const list = want.lists[0];
  check(same(got.ids, list.ids.slice(0, 100)), `${label} ${id}: rows in order`, list.ids.slice(0, 100), got.ids);
  check(got.count === `${list.count.toLocaleString("en-US")} ${list.count === 1 ? "place" : "places"}`, `${label} ${id}: count`, list.count, got.count);
  check(got.explainer === want.explainer, `${label} ${id}: explainer`, want.explainer, got.explainer);
  if (want.isNegative) {
    got.ids.forEach((pid, i) => {
      const p = byId.get(pid), lines = got.rows[i];
      if (!p || !lines) return;
      const first = p.newerResult == null ? "City's latest result: " : "Latest in our records: ";
      check(lines[0] && lines[0].startsWith(first), `${label} ${id}: ${p.name}'s result line`, first, lines[0]);
      if (p.newerResult) check(lines[1] && lines[1].startsWith(`Newer City result: ${p.newerResult}, `), `${label} ${id}: ${p.name}'s newer result line`, `Newer City result: ${p.newerResult}`, lines[1]);
      else check(lines.length === 1, `${label} ${id}: ${p.name} has no newer line`, 1, lines.length);
    });
  }
}

async function checkHome(label) {
  await go("#/");
  if (!(await waitFor(`!!document.querySelector(".cards")`, "home"))) return;
  const got = await js(`Object.fromEntries([...document.querySelectorAll(".cards a.card")].map((a) => [a.dataset.card, { n: a.querySelector(".num") ? a.querySelector(".num").textContent : null, s: a.querySelector(".s").textContent }]))`);
  // lists[0] is the board with no filters; the hot dog card is Cleanest with only the cuisine filter
  const count = (id, cuisine) => (cuisine ? O.boards[id].lists.find((l) => l.filters.cuisine === cuisine && !l.filters.includeVenues && !l.filters.liquor) : O.boards[id].lists[0]).count;
  const want = { cleanest: count("cleanest"), hotDogs: count("cleanest", "Hot Dogs & Beef"), honors: count("honors"), watch: count("recentFails"), building: count("building"), sales: count("sales") };
  for (const [k, v] of Object.entries(want)) check(got[k] && got[k].n === v.toLocaleString("en-US"), `${label} home: ${k} card count`, v, got[k] && got[k].n);
  const il = manifest.counts.illinois;
  check(got.illinois && (got.illinois.n === il.toLocaleString("en-US") || got.illinois.n === O.meta.illinoisRestaurantCount.toLocaleString("en-US")), `${label} home: Rest of Illinois count`, il, got.illinois && got.illinois.n);
  check(got.all && got.all.s === "Search nearly every restaurant, café, bakery and tavern in the city", `${label} home: All Restaurants card wording`, "Search nearly every…", got.all && got.all.s);
  check(got.watch && got.watch.s === "Places whose latest City inspection failed, in the last 90 days", `${label} home: Inspection Watch wording`, "…in the last 90 days", got.watch && got.watch.s);
  const hub = await js(`[...document.querySelectorAll("footer a")].some((a) => a.getAttribute("href") === "https://eatsranked.com/" && a.textContent === "More states at eatsranked.com")`);
  check(hub, `${label} home: footer link to eatsranked.com`, true, hub);
}

async function checkMap(label, phone) {
  const expect = (list) => list.filter((p) => !p.venue && p.lat != null && p.lon != null).length;
  await go("#/map");
  if (!(await waitFor(`document.querySelector("#map") && +document.querySelector("#map").dataset.shown > 0`, "map dots"))) return;
  await sleep(300);
  let got = await js(`({ legend: document.querySelector(".legend p").textContent, shown: +document.querySelector("#map").dataset.shown })`);
  const n = expect(chicago);
  check(got.legend.startsWith(`${n.toLocaleString("en-US")} places.`), `${label} map: legend count`, n, got.legend);
  check(got.shown > n * 0.9, `${label} map: dots drawn for the whole city`, `about ${n}`, got.shown);
  await shot(`${label}-map-chicago`);
  await pageChecks(`${label} map`);
  // a focused place: the map flies there and shows its card, fully on screen (above the phone's tab bar)
  const focus = chicago.find((p) => p.grade === "A" && !p.venue && p.lat != null);
  await go(`#/map?focus=${encodeURIComponent(focus.id)}`);
  if (await waitFor(`!document.querySelector("#mcard").hidden`, "the focused place's card")) {
    got = await js(`(() => { const c = document.querySelector("#mcard"), r = c.getBoundingClientRect(), t = document.querySelector(".tabs");
      const tb = t && getComputedStyle(t).position === "fixed" ? t.getBoundingClientRect().top : innerHeight;
      return { h2: c.querySelector("h2").textContent, open: c.querySelector("a.btn.solid").getAttribute("href"), bottom: r.bottom, limit: Math.min(innerHeight, tb), top: r.top }; })()`);
    check(got.h2 === focus.name && got.open === `#/place/${encodeURIComponent(focus.id)}`, `${label} map: focused place's card`, focus.name, got);
    check(got.bottom <= got.limit + 1 && got.top >= 0, `${label} map: the card is on screen${phone ? " above the tab bar" : ""}`, `bottom <= ${got.limit}`, got.bottom);
    await shot(`${label}-map-focus`);
  }
  await go("#/map?scope=illinois");
  if (await waitFor(`document.querySelector("#map") && +document.querySelector("#map").dataset.shown > 0`, "Illinois map dots", 30000)) {
    got = await js(`document.querySelector(".legend p").textContent`);
    const m = expect(illinois);
    check(got.startsWith(`${m.toLocaleString("en-US")} map listings.`), `${label} map: Illinois legend count`, m, got);
    await shot(`${label}-map-illinois`);
    await pageChecks(`${label} map Illinois`);
  }
}

async function typing(label) {
  await go("#/");
  await waitFor(`!!document.querySelector(".cards")`, "home");
  await js(`document.querySelector("#q").focus()`);
  await page("Input.insertText", { text: "portilllo" });
  const ok = await waitFor(`location.hash.startsWith("#/search?q=portilllo") && !!document.querySelector(".closest-head")`, "typed search to show Closest matches");
  if (ok) {
    const want = O.searches.find((s) => s.text === "portilllo" && s.scope === "chicago" && !anyFilter(s.filters));
    const got = await js(`[...document.querySelectorAll("#sbody ol.closest a.rrow")].map((a) => decodeURIComponent(a.getAttribute("href").replace("#/place/", "")))`);
    check(same(got, want.closest), `${label} typing “portilllo”: Closest matches`, want.closest, got);
    await shot(`${label}-search-typed-closest`);
  }
}

// ------------------------------------------------------------------------------------------------ run both widths
const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900, dpr: 1, mobile: false },
  { label: "phone", width: 390, height: 844, dpr: 3, mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1" },
];
const t0 = Date.now();
try {
  for (const v of VIEWPORTS) {
    where = v.label;
    await page("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: v.dpr, mobile: v.mobile });
    await page("Emulation.setTouchEmulationEnabled", v.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    if (v.ua) await page("Network.setUserAgentOverride", { userAgent: v.ua, platform: "iPhone" });
    else await page("Network.setUserAgentOverride", { userAgent: "" });
    await page("Page.navigate", { url: "about:blank" });
    await sleep(200);
    console.log(`\n== ${v.label} ${v.width}x${v.height}${v.mobile ? " (phone emulation)" : ""}`);
    await checkHome(v.label);
    await shot(`${v.label}-home`);
    await pageChecks(`${v.label} home`);
    let closestShot = false;
    for (const [k, s] of SEARCHES.entries()) {
      await checkSearch(s, v.label);
      if (k === 0) { await shot(`${v.label}-search`); await pageChecks(`${v.label} search`); }
      if (s.closest.length && !closestShot && (await js(`!!document.querySelector(".closest-head")`))) {
        closestShot = true;
        await shot(`${v.label}-search-closest`);
        await pageChecks(`${v.label} Closest matches`);
      }
    }
    console.log(`  ${SEARCHES.length} searches checked`);
    const newer = chicago.find((p) => p.newerResult === "Pass") || chicago.find((p) => p.newerResult);
    const failedSince = chicago.find((p) => p.newerResult === "Fail");
    const aka = chicago.find((p) => p.aka && p.aka.includes(" · "));
    // a place with hidden alt names: none of them may show anywhere on its page
    const ac = rawChicago.cols, ai = ac.indexOf("alt"), ii = ac.indexOf("id");
    const altRow = ai < 0 ? null : rawChicago.rows.find((r) => {
      const p = byId.get(r[ii]); const a = r[ai];
      if (!p || !a) return false;
      const names = (typeof a === "string" ? a.split(/[·|;\n]/) : a).map((x) => x.trim()).filter(Boolean);
      return names.every((n) => ![p.name, p.aka, p.addr, p.cuisine, p.brand, p.hood].some((x) => x && x.toLowerCase().includes(n.toLowerCase())));
    });
    for (const [id, label, extra] of [
      [newer && newer.id, "newer result"], [failedSince && failedSince.id, "failed since"], [aka && aka.id, "aka"],
      [altRow && altRow[ii], "alt names", async (got, what) => {
        const a = altRow[ai], names = (typeof a === "string" ? a.split(/[·|;\n]/) : a).map((x) => x.trim()).filter(Boolean);
        for (const n of names) check(!got.text.toLowerCase().includes(n.toLowerCase()), `${what}: hidden alt name "${n}" isn't shown`, false, true);
        const html = await js(`document.documentElement.outerHTML.toLowerCase()`);
        for (const n of names) check(!html.includes(n.toLowerCase()), `${what}: hidden alt name "${n}" isn't in the page at all`, false, true);
      }],
      [illinois.find((p) => !p.venue && p.web).id, "rest of Illinois"], ["0000000-not-a-license", "missing"],
    ]) {
      if (!id) { check(false, `no sample place for ${label}`, "a place", null); continue; }
      await checkPlace(id, `${v.label} ${label}`, extra);
      if (label === "newer result") { await shot(`${v.label}-place-newer`); await pageChecks(`${v.label} place`); }
    }
    await checkBoard("recentFails", v.label);
    await shot(`${v.label}-board-failed-latest`);
    await pageChecks(`${v.label} board`);
    await checkBoard("worst", v.label);
    await checkMap(v.label, v.mobile);
    await typing(v.label);
  }
  where = "all pages";
  const foreign = [...new Set(requests.filter((u) => !u.startsWith(ORIGIN + "/") && !u.startsWith("data:") && u !== "about:blank"))];
  check(foreign.length === 0, "no requests anywhere but the local server (no third parties)", [], foreign);
  const ck = await page("Network.getCookies", { urls: [ORIGIN + "/"] });
  check(ck.cookies.length === 0, "no cookies set", [], ck.cookies.map((c) => c.name));
  check(problems.length === 0, "no console errors, warnings or exceptions", [], problems.slice(0, 10));
  const dataReqs = requests.filter((u) => u.includes("/data/v1/"));
  console.log(`\n${requests.length} requests, all to ${ORIGIN} (data: ${[...new Set(dataReqs.map((u) => u.replace(ORIGIN, "")))].join(", ")})`);
} catch (e) {
  check(false, `the run stopped: ${e.stack || e}`, "no error", String(e));
} finally {
  try { await send("Browser.close"); } catch { /* closing */ }
  stop();
}
console.log(`\nBROWSER: ${checks} checks, ${failures} failures, screenshots in ${SHOTS} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(failures ? 1 : 0);
