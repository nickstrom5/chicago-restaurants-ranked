// Compares the web app's logic (docs/explore/logic.js) with the iPhone app's own Swift code, run as a macOS command-line
// oracle (oracle/main.swift, see README.md), on the app's bundled data read through the test mirror's content-addressed
// data/v1 manifest (make_mirror.py), and on the fixtures. Every difference is printed; the exit code is 1 if there is any.
//
// usage: node check_logic.mjs --oracle <oracle.json> --mirror <mirror dir> [--logic <logic.js>] [--swift <chi-eats/ios/ChiRanked>]
//        [--fail-fast 1]   (stop at the first difference: mutate.mjs uses it)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, "../../..");
const opt = {};
for (let i = 2; i + 1 < process.argv.length; i += 2) opt[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if (!opt.oracle || !opt.mirror) { console.error("usage: node check_logic.mjs --oracle <oracle.json> --mirror <dir> [--logic <logic.js>] [--swift <ChiRanked dir>]"); process.exit(2); }
const LOGIC = resolve(opt.logic || join(SITE, "docs/explore/logic.js"));
const SWIFT = resolve(opt.swift || join(SITE, "../chi-eats/ios/ChiRanked"));
const L = await import(pathToFileURL(LOGIC).href);

// ------------------------------------------------------------------------------------------------ reporting
const diffs = [];
const tally = {};
let section = "";
const LIMIT = 25;          // printed per section; all are counted
function check(ok, what, swift, web) {
  tally[section] = tally[section] || { checked: 0, failed: 0 };
  tally[section].checked += 1;
  if (ok) return true;
  tally[section].failed += 1;
  diffs.push(section);
  if (opt["fail-fast"]) { console.log(`FIRST DIFFERENCE [${section}] ${what}`); process.exit(1); }
  if (tally[section].failed <= LIMIT) {
    const show = (v) => { const s = JSON.stringify(v); return s && s.length > 600 ? s.slice(0, 600) + "…" : s; };
    console.log(`  DIFF [${section}] ${what}\n    swift: ${show(swift)}\n    web:   ${show(web)}`);
  }
  return false;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function firstDiff(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { at: i, swift: a.slice(Math.max(0, i - 2), i + 3), web: b.slice(Math.max(0, i - 2), i + 3), lengths: [a.length, b.length] };
  return null;
}
function checkList(what, swift, web) {
  if (same(swift, web)) return check(true);
  const d = firstDiff(swift, web);
  return check(false, `${what}: first difference at #${d.at} (lengths ${d.lengths.join(" vs ")})`, d.swift, d.web);
}
const utf8 = (s) => Buffer.byteLength(s, "utf8");
const toFilters = (f) => L.newFilters({ sides: f.sides, hood: f.hood, cuisine: f.cuisine, grades: f.grades, liquor: f.liquor, dineIn: f.dineIn,
  hideChains: f.hideChains, includeVenues: f.includeVenues, city: f.city });
const fname = (f) => {
  const on = Object.entries(f).filter(([, v]) => (Array.isArray(v) ? v.length : v)).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("+") : v}`);
  return on.length ? ` [${on.join(", ")}]` : "";
};

// ------------------------------------------------------------------------------------------------ data
const oracle = JSON.parse(readFileSync(resolve(opt.oracle), "utf8"));

/** The bundled data the way the web app loads it: the mirror's manifest, each file checked for size, sha256 and rows. */
function loadMirror() {
  const dir = join(resolve(opt.mirror), "data/v1");
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  section = "mirror";
  check(m.schema === 1 && m.files && m.files.chicago && m.files.illinois, "manifest has schema 1 and both files", 1, m.schema);
  const parsed = {};
  for (const key of ["chicago", "illinois"]) {
    const f = m.files[key];
    const buf = readFileSync(join(dir, f.path));
    const sha = createHash("sha256").update(buf).digest("hex");
    check(f.path === `${key}-${f.sha256.slice(0, 12)}.json`, `${key}: named for its sha256`, `${key}-${f.sha256.slice(0, 12)}.json`, f.path);
    check(buf.length === f.bytes && sha === f.sha256, `${key}: bytes and sha256 match the manifest`, [f.bytes, f.sha256], [buf.length, sha]);
    check(sha === oracle.inputs[key].sha256, `${key}: the same file the oracle read (rebuild the mirror or rerun the oracle)`, oracle.inputs[key].sha256, sha);
    parsed[key] = JSON.parse(buf.toString("utf8"));
    check(parsed[key].rows.length === f.rows, `${key}: rows match the manifest`, f.rows, parsed[key].rows.length);
  }
  check(parsed.chicago.meta.records_through === m.records_through, "records_through matches the manifest", m.records_through, parsed.chicago.meta.records_through);
  return parsed;
}
function loadFixture(name) {
  const fx = JSON.parse(readFileSync(join(HERE, "fixtures", name + ".json"), "utf8"));
  return { chicago: fx.chicago, illinois: fx.illinois };
}

// ------------------------------------------------------------------------------------------------ one dataset
function compare(name, files) {
  const O = oracle.datasets[name];
  const t0 = Date.now();
  const data = L.combine(L.parseChicago(files.chicago), L.parseIllinois(files.illinois));
  console.log(`\n== ${name}: ${data.chicago.length} Chicago, ${data.illinois.length} rest of Illinois (parsed in ${Date.now() - t0} ms)`);

  section = `${name}/meta`;
  const meta = { recordsThrough: data.recordsThrough, failsFrom: data.asOf.failsFrom, hoods: data.hoods, sides: data.sides, cuisines: data.cuisines,
    cities: data.cities, overtureRelease: data.overtureRelease, rows: [files.chicago.rows.length, files.illinois.rows.length],
    restaurantCount: data.restaurantCount, illinoisRestaurantCount: data.illinoisRestaurantCount, recordsYear: data.recordsYear };
  for (const k of Object.keys(O.meta)) check(same(O.meta[k], meta[k]), k, O.meta[k], meta[k]);

  // every place, in list order, every field
  section = `${name}/places`;
  const F = O.placeFields;
  const value = (p, k) => {
    switch (k) {
      case "altBytes": return utf8(p.searchText.slice(p.searchText.length - p.joinLen - p.altLen, p.searchText.length - p.joinLen));
      case "joinBytes": return p.joinLen ? utf8(p.searchText.slice(p.searchText.length - p.joinLen)) : 0;
      case "privateDining": return p.isChicago && L.isPrivateDining(p);
      default: return p[k] === undefined ? "(missing)" : p[k];
    }
  };
  for (const [list, rows] of [[data.chicago, O.chicago], [data.illinois, O.illinois]]) {
    checkList("order (ids)", rows.map((r) => r[0]), list.map((p) => p.id));
    rows.forEach((row, i) => {
      const p = list[i];
      if (!p || p.id !== row[0]) return;
      F.forEach((k, c) => {
        let want = row[c];
        // the one intended difference: only http(s) websites become links on the web (the data has only https)
        if (k === "web" && want != null && !/^https?:\/\//i.test(want)) want = null;
        const got = value(p, k);
        if (got !== want) check(false, `${p.id} ${p.name}: ${k}`, want, got); else check(true);
      });
    });
  }
  section = `${name}/surprise`;
  checkList("Surprise me candidates", O.surprise, L.surpriseCandidates(data.chicago).map((p) => p.id));

  // boards: titles, explainers, every list under every filter set, counts, and the default list's metrics
  section = `${name}/boards`;
  checkList("board order", O.boardOrder, L.BOARD_IDS);
  for (const id of O.boardOrder) {
    const b = O.boards[id], B = L.BOARDS[id];
    check(b.title === B.title && b.short === B.short, `${id}: title and short title`, [b.title, b.short], [B.title, B.short]);
    check(b.note === (L.NOTES[id] ?? null), `${id}: note`, b.note, L.NOTES[id] ?? null);
    check(b.isNegative === B.negative, `${id}: negative board`, b.isNegative, B.negative);
    check(b.explainer === L.explainer(id, data.recordsThrough), `${id}: explainer`, b.explainer, L.explainer(id, data.recordsThrough));
    check(b.explainerNoDate === L.explainer(id, ""), `${id}: explainer without a records date`, b.explainerNoDate, L.explainer(id, ""));
    for (const l of b.lists) {
      const f = toFilters(l.filters);
      checkList(`${id}${fname(l.filters)}`, l.ids, L.ranked(data, id, f).map((p) => p.id));
      check(l.count === L.boardCount(data, id, f), `${id}${fname(l.filters)}: count`, l.count, L.boardCount(data, id, f));
    }
    const top = L.ranked(data, id, L.newFilters());
    b.metrics.forEach(([pid, v, lab], i) => {
      const p = top[i];
      if (!p || p.id !== pid) return;
      const m = L.metric(id, p, data.recordsYear);
      if (m[0] !== v || m[1] !== lab) check(false, `${id} metric for ${pid} ${p.name}`, [v, lab], m); else check(true);
    });
  }

  // searches: how each parsed, every exact match in order, the count, the first 400 shown, Closest matches
  section = `${name}/search`;
  const t1 = Date.now();
  let n = 0, closest = 0;
  for (const s of O.searches) {
    const f = toFilters(s.filters);
    const what = `${s.scope} “${s.text}”${fname(s.filters)} (${s.source})`;
    const q = L.parse(data.index, L.trimWS(s.text), s.scope);
    // the typed needles' order follows a Swift dictionary's (random per launch) and doesn't change a match: compared as sets
    const tokens = q.tokens.map((t) => ({ typed: t.typed, typedNeedles: t.needles.slice(0, t.typed).sort(), loose: t.needles.slice(t.typed) }));
    const want = s.parse.tokens.map((t) => ({ typed: t.typed, typedNeedles: t.needles.slice(0, t.typed).sort(), loose: t.needles.slice(t.typed) }));
    check(same(want, tokens), `${what}: tokens`, want, tokens);
    const pq = { hoods: [...q.hoods].sort(), city: q.city, side: q.side, phraseRaw: q.phraseRaw, isPlaceOrFood: q.isPlaceOrFood, isEmpty: L.queryEmpty(q) };
    const pw = { hoods: s.parse.hoods, city: s.parse.city, side: s.parse.side, phraseRaw: s.parse.phraseRaw, isPlaceOrFood: s.parse.isPlaceOrFood, isEmpty: s.parse.isEmpty };
    check(same(pw, pq), `${what}: area and kind`, pw, pq);
    const all = L.search(data, s.text, s.scope, f).map((p) => p.id);
    checkList(`${what}: matches`, s.matches, all);
    const r = L.results(data, { text: s.text, scope: s.scope, filters: f, near: false });
    check(r.total === s.total, `${what}: count`, s.total, r.total);
    checkList(`${what}: shown`, s.shown, r.places.map((p) => p.id));
    checkList(`${what}: Closest matches`, s.closest, r.closest.map((p) => p.id));
    n += 1; if (s.closest.length) closest += 1;
  }
  console.log(`  ${n} searches (${closest} with Closest matches) in ${Date.now() - t1} ms`);

  // near me: closest first, the count, out of area, the distance labels; the nearest place and area counts for the map
  section = `${name}/near`;
  for (const e of O.near) {
    if (e.ids) {
      const pt = [L.roundAway(e.point[0] * 1000) / 1000, L.roundAway(e.point[1] * 1000) / 1000];   // SearchRequest's rounding
      check(same(pt, e.rounded), `${e.where}: rounded point`, e.rounded, pt);
      const f = toFilters(e.filters);
      const r = L.results(data, { text: e.text, scope: "chicago", filters: f, near: true, point: e.rounded });
      const what = `near ${e.where} “${e.text}”${fname(e.filters)}`;
      checkList(`${what}: places`, e.ids, r.places.map((p) => p.id));
      check(r.total === e.total, `${what}: count`, e.total, r.total);
      const oa = r.outOfArea, ok = e.outOfArea == null ? oa == null : oa != null && Math.abs(oa - e.outOfArea) <= 1e-6 * e.outOfArea;
      check(ok, `${what}: out of area`, e.outOfArea, oa);
      checkList(`${what}: distance labels`, e.labels, r.places.slice(0, 40).map((p) => L.distLabel(L.distance(p, e.rounded))));
    } else {
      const best = L.nearest(data, e.point);
      check((best ? best.p.id : null) === e.nearest, `${e.where}: nearest place`, e.nearest, best && best.p.id);
      check(best == null ? e.nearestMeters == null : Math.abs(best.m - e.nearestMeters) <= 1e-6 * Math.max(1, e.nearestMeters), `${e.where}: nearest meters`, e.nearestMeters, best && best.m);
      const c = L.areaCounts(data, e.point), c8 = L.areaCounts(data, e.point, 800);
      check(same(e.areaCounts, [c.chicago, c.illinois]), `${e.where}: places within 3 km`, e.areaCounts, [c.chicago, c.illinois]);
      check(same(e.areaCounts800, [c8.chicago, c8.illinois]), `${e.where}: places within 800 m`, e.areaCounts800, [c8.chicago, c8.illinois]);
    }
  }

  // formatters
  section = `${name}/fmt`;
  for (const [k, v] of Object.entries(O.fmt.date)) check(L.Fmt.date(k) === v, `Fmt.date(${JSON.stringify(k)})`, v, L.Fmt.date(k));
  for (const [k, v] of Object.entries(O.fmt.money)) check(L.Fmt.money(+k) === v, `Fmt.money(${k})`, v, L.Fmt.money(+k));
  for (const [k, v] of Object.entries(O.fmt.number)) check(L.Fmt.number(+k) === v, `Fmt.number(${k})`, v, L.Fmt.number(+k));
  for (const [k, v] of Object.entries(O.fmt.items)) check(same(L.Fmt.items(k), v), `Fmt.items(${JSON.stringify(k)})`, v, L.Fmt.items(k));
  for (const [m, v] of O.fmt.geoLabel) check(L.distLabel(m) === v, `Geo.label(${m})`, v, L.distLabel(m));
  for (const [k, v] of Object.entries(O.fmt.failsFrom)) check(L.asOf(k).failsFrom === v, `AsOf(${JSON.stringify(k)}).failsFrom`, v, L.asOf(k).failsFrom);
}

// ------------------------------------------------------------------------------------------------ words the web copies from the app's views
// Lines app.js shows that the oracle can't run (they live in SwiftUI views). Each must still be in the Swift file it was
// copied from (so a change there shows up here) and in the web files.
function wording() {
  section = "wording";
  const web = ["app.js", "logic.js", "index.html"].map((f) => readFileSync(join(dirname(LOGIC), f), "utf8")).join("\n");
  const swift = (f) => readFileSync(join(SWIFT, f), "utf8");
  const pairs = [
    ["Views/SearchTab.swift", "Closest match, not an exact match"],
    ["Views/SearchTab.swift", "No exact match for “"],
    ["Views/SearchTab.swift", "These places match only some of your words, or spell them differently. Check the name and address."],
    ["Views/SearchTab.swift", "These places match only some of your words, or spell them differently. Your filters may be hiding others."],
    ["Views/SearchTab.swift", "Text(\"Closest matches\")", "Closest matches"],
    ["Views/SearchTab.swift", "Search Chicago restaurants"],
    ["Views/SearchTab.swift", "Our grades from City inspection records, not official City grades."],
    ["Views/SearchTab.swift", "No grades outside Chicago: the City inspects only Chicago restaurants."],
    ["Views/SearchTab.swift", "Check the spelling or try a new search."],
    ["Views/SearchTab.swift", "Your filters may be hiding places."],
    ["Views/SearchTab.swift", "Chicago places within 50 miles (your filters use City records)."],
    ["Views/SearchTab.swift", "Chicago and the rest of Illinois, within 50 miles."],
    ["Views/RankingsView.swift", "City's latest result"],
    ["Views/RankingsView.swift", "Latest in our records"],
    ["Views/RankingsView.swift", "Newer City result: "],
    ["Views/PlaceDetailView.swift", "Last city inspection"],
    ["Views/PlaceDetailView.swift", "Last inspection in our records"],
    ["Views/PlaceDetailView.swift", "KV(\"Newer City result\"", "Newer City result"],
    ["Views/PlaceDetailView.swift", "so it isn't in our score or grade yet."],
    ["Views/PlaceDetailView.swift", "Also on City records as"],
    ["Views/PlaceDetailView.swift", "Report a problem with this listing"],
    ["Views/PlaceDetailView.swift", "Not in the current data"],
    ["Views/PlaceDetailView.swift", "This place isn't in the latest data update. If it's in a later one, it shows here again."],
    ["Views/HomeView.swift", "Search nearly every restaurant, café, bakery and tavern in the city"],
    ["Views/HomeView.swift", "Places whose latest City inspection failed, in the last 90 days"],
    ["Views/HomeView.swift", "Food map & our A–F grades", "Food map &amp; our A–F grades"],
    ["Views/HomeView.swift", "Nearly every restaurant, café and tavern the City of Chicago inspects, graded and ranked"],
    ["Views/SavedAndAbout.swift", "Nearly every restaurant, bakery, café and tavern the City of Chicago inspects, ranked on public records"],
  ];
  for (const [f, s, w = s] of pairs) {      // [Swift file, its words, the web's spelling when it differs (HTML)]
    check(swift(f).includes(s), `${f} no longer says ${JSON.stringify(s)}: the web copy may be stale`, s, "(not in the Swift file)");
    check(web.includes(w), `the web app doesn't say ${JSON.stringify(w)} (from ${f})`, w, "(not in app.js / logic.js / index.html)");
  }
  // our data covers nearly every Chicago restaurant, not every one (verify.py's rule, here for app.js and logic.js too)
  const over = /(?<!nearly\s)\bevery\s+(?:Chicago\s+restaurant|restaurant\s+in\s+the\s+city|restaurant,\s+caf)/gi;
  const hits = [...web.matchAll(over)].map((m) => web.slice(Math.max(0, m.index - 30), m.index + 60).replace(/\s+/g, " "));
  check(!hits.length, "claims every restaurant (say 'nearly every')", [], hits);
  check(!/nickstrom5\.github\.io|\/chicago-restaurants-ranked\//.test(web), "names the old address or the old path prefix", false, true);
}

// ------------------------------------------------------------------------------------------------ the rest of Illinois in slices
// app.js reads the rest of Illinois with parseIllinoisInSteps (about 1,000 rows at a time, the page free between them): it
// must give exactly what parseIllinois gives (every place, field and list, in order), which everything above compares with
// the app.
async function stepped(name, files) {
  section = `${name}/stepped`;
  const whole = L.parseIllinois(files.illinois);
  let pauses = 0;
  const parts = await L.parseIllinoisInSteps(files.illinois, async () => { pauses += 1; }, 997);
  const plain = (r) => JSON.stringify({ ...r, illinois: r.illinois.map(({ _und, ...p }) => p) });
  check(plain(parts) === plain(whole), "parseIllinoisInSteps gives what parseIllinois gives", "the same", "different");
  const want = Math.floor(files.illinois.rows.length / 997) + 1;
  check(pauses === want, "parseIllinoisInSteps pauses between slices of rows", want, pauses);
}

// ------------------------------------------------------------------------------------------------ run
const bundled = loadMirror();
compare("bundled", bundled);
compare("rules", loadFixture("rules"));
compare("edge", loadFixture("edge"));
await stepped("bundled", bundled);
await stepped("edge", loadFixture("edge"));
wording();
console.log("\nsummary:");
for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(18)} ${String(v.checked).padStart(9)} checked  ${v.failed ? v.failed + " DIFFERENT" : "0 differences"}`);
const total = Object.values(tally).reduce((a, v) => a + v.checked, 0);
console.log(`\nLOGIC: ${total} checks, ${diffs.length} differences`);
process.exit(diffs.length ? 1 : 0);
