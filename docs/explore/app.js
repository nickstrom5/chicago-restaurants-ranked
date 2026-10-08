// Chicago Restaurants: Ranked on the web: the iPhone app's home grid, rankings, search, map, place pages, Saved and About.
// It reads the same Google-free data files the app downloads (../data/v1/manifest.json), and ports the app's rules in
// logic.js. No cookies, no analytics, no third-party requests; localStorage holds only Saved places.
import * as L from "./logic.js";

// ------------------------------------------------------------------------------------------------ small helpers
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (name, cls = "ico") => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
const n = (v) => Number(v).toLocaleString("en-US");
const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : many}`;
const store = {
  get(k, d) { try { const v = localStorage.getItem("chiranked." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  /** false when this browser blocks site storage (then it lasts only for this visit) */
  set(k, v) { try { localStorage.setItem("chiranked." + k, JSON.stringify(v)); return true; } catch { return false; } },
};
/** Saved ids as stored, keeping only what can be an id: an old or hand-edited value never stops the page. */
function storedSaved() {
  const raw = store.get("saved", []);
  return Array.isArray(raw) ? [...new Set(raw.filter((x) => typeof x === "string" && x !== ""))] : [];
}
const Q_MAX = 120;            // search runs on the main thread, so a long paste is cut to this many characters
const capQ = (s) => { const a = Array.from(s || ""); return a.length > Q_MAX ? a.slice(0, Q_MAX).join("") : s || ""; };
const phone = matchMedia("(max-width: 719px)"), wide = matchMedia("(min-width: 1100px)");
const placeHref = (p) => `#/place/${encodeURIComponent(p.id)}`;
const gradeChip = (g, cls = "") => `<span class="g g${g}${cls ? " " + cls : ""}"><span class="sr">Grade </span>${g}</span>`;
const GRADE_FILL = { A: "#12733A", B: "#4B7A1B", C: "#F2B01E", D: "#E8804F", F: "#C1302F" };
const GRADE_TEXT = { A: "#fff", B: "#fff", C: "#2B1D00", D: "#2B1000", F: "#fff" };
const MUTED = "#52638A", BLUE = "#0E3386";
const GRADES_CAPTION = "Our grades from City inspection records, not official City grades.";
const DATA = "../data/v1/";

// ------------------------------------------------------------------------------------------------ state
const state = {
  manifest: null, chi: null, il: null, data: null, error: null, progress: 0, slow: false,
  ilPromise: null, ilError: null,            // ilError: true (didn't load) or "missing" (not in the manifest), until Try again or a new page
  saved: new Set(storedSaved()),
  savedOrder: storedSaved(),
  lastTab: "rankings",
  showInfo: false, filtersOpen: false, shown: 100,
  geo: { status: "idle", point: null },      // location: memory only, never stored or sent
  mapCam: {}, mapSel: null, mapStack: null, mapNote: null,
  rankCache: new Map(), lastSurprise: null, surprisePool: null,
  mounted: null, cleanup: null, navs: 0, tabHref: {}, closeSheet: null, onGeo: null,
};
const D = () => state.data;

// ------------------------------------------------------------------------------------------------ history
// Every history entry gets a key and a depth. The key brings back a list's scroll position and length when you come back to
// it; the depth (entries since arriving on this page) lets the page's own Back button go back without ever leaving the site.
const nav = { key: null, depth: 0, route: "#/", views: new Map(), seq: 0 };
const newKey = () => `${Date.now().toString(36)}.${(nav.seq++).toString(36)}`;
const isRouteHash = (h) => h === "" || h === "#" || h.startsWith("#/");
function saveView() {
  if (!nav.key) return;
  nav.views.delete(nav.key);
  nav.views.set(nav.key, { y: window.scrollY, shown: state.shown });
  if (nav.views.size > 80) nav.views.delete(nav.views.keys().next().value);
}
/** A new history entry for `hash` (typing a search from another page). */
function pushRoute(hash) {
  saveView();
  nav.depth += 1; nav.key = newKey();
  history.pushState({ k: nav.key, d: nav.depth }, "", hash);
  nav.route = hash;
}

// ------------------------------------------------------------------------------------------------ data
class DataProblem extends Error {}

async function fetchVerified(file) {
  if (!file || typeof file.path !== "string" || !/^[A-Za-z0-9._-]+\.json$/.test(file.path)) throw new DataProblem("bad manifest entry");
  const res = await fetch(DATA + file.path);
  if (!res.ok) throw new DataProblem(`${file.path}: HTTP ${res.status}`);
  let buf;
  if (res.body && typeof res.body.getReader === "function" && file.bytes > 0) {
    const reader = res.body.getReader();
    const out = new Uint8Array(file.bytes);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > out.length) throw new DataProblem(`${file.path}: longer than the manifest says`);
      out.set(value, got);
      got += value.length;
      onProgress(file, got);
    }
    if (got !== file.bytes) throw new DataProblem(`${file.path}: ${got} bytes, expected ${file.bytes}`);
    buf = out;
  } else {
    buf = new Uint8Array(await res.arrayBuffer());
    if (file.bytes && buf.length !== file.bytes) throw new DataProblem(`${file.path}: ${buf.length} bytes, expected ${file.bytes}`);
  }
  if (file.sha256 && globalThis.crypto && crypto.subtle) {
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hash !== file.sha256) throw new DataProblem(`${file.path}: checksum doesn't match`);
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

let progressFile = null;
function onProgress(file, got) {
  if (file !== progressFile) return;
  state.progress = got / file.bytes;
  const bar = $("#pbar");
  if (bar) { bar.parentElement.classList.remove("indet"); bar.style.width = Math.max(8, Math.round(state.progress * 100)) + "%"; }
}

async function loadChicago() {
  state.error = null; state.slow = false; state.progress = 0;
  const slowTimer = setTimeout(() => { state.slow = true; const s = $("#slow"); if (s) s.hidden = false; }, 8000);
  try {
    let res;
    try { res = await fetch(DATA + "manifest.json", { cache: "no-cache" }); } catch { throw new DataProblem("offline"); }
    if (!res.ok) throw new DataProblem(res.status === 404 ? "missing" : `HTTP ${res.status}`);
    const m = await res.json().catch(() => { throw new DataProblem("manifest unreadable"); });
    if (!m || m.schema !== 1 || !m.files || !m.files.chicago) throw new DataProblem("manifest format");
    state.manifest = m;
    progressFile = m.files.chicago;
    const obj = await fetchVerified(m.files.chicago);
    const chi = L.parseChicago(obj);
    if (m.files.chicago.rows != null && chi.rows !== m.files.chicago.rows) throw new DataProblem("row count");
    if (m.records_through && chi.recordsThrough !== m.records_through) throw new DataProblem("records date");
    state.chi = chi;
    state.data = L.combine(chi, state.il);
    state.rankCache.clear(); state.surprisePool = null;
  } catch (e) {
    state.error = e instanceof DataProblem ? e.message : "unexpected";
    console.warn("Chi Ranked data:", e);
  } finally {
    clearTimeout(slowTimer);
  }
}

/** The rest of Illinois, loaded the first time something needs it (its scope, Near me, a place or saved place there, search).
 *  After a failure it resolves false at once until someone taps Try again or opens another page, so no view can keep refetching. */
function ensureIllinois() {
  if (state.il) return Promise.resolve(true);
  if (state.ilError || !state.manifest) return Promise.resolve(false);
  if (!state.manifest.files.illinois) { state.ilError = "missing"; return Promise.resolve(false); }
  if (!state.ilPromise) {
    state.ilPromise = (async () => {
      const f = state.manifest.files.illinois;
      const obj = await fetchVerified(f);
      const il = L.parseIllinois(obj);
      if (f.rows != null && il.rows !== f.rows) throw new DataProblem("row count");
      state.il = il;
      state.data = L.combine(state.chi, il);
      state.rankCache.clear();
      return true;
    })().catch((e) => { console.warn("Chi Ranked Illinois data:", e); state.ilError = true; state.ilPromise = null; return false; });
  }
  return state.ilPromise;
}
/** Runs `then` once Illinois is in, if the page is still showing the same route. */
function afterIllinois(then) {
  const key = location.hash;
  ensureIllinois().then((ok) => { if (location.hash === key) then(ok); });
}
/** When the rest of Illinois didn't load: says so (never "not listed"), with a Try again that loads it again. */
const ilErrorHTML = (heading = "h2", lead = "") => `<div class="empty" role="alert">${icon("warn")}<${heading} class="${heading === "h1" ? "h1" : ""}">Couldn't load the rest of Illinois</${heading}>
  <p>${lead}${state.ilError === "missing" ? "It isn't in this data update. Please try again later." : "Check your connection and try again."}</p>
  <div class="row"><button class="btn solid" type="button" data-retry-il>Try again</button></div></div>`;
const ilLoadingHTML = (text = "Loading restaurants across the rest of Illinois…") => `<p class="note" aria-live="polite"><span class="spin" aria-hidden="true"></span>${text}</p>`;
const illinoisCount = () => (state.il ? D().illinoisRestaurantCount : state.manifest?.counts?.illinois ?? null);
const townCount = () => (state.il ? D().cities.length : state.manifest?.counts?.towns ?? null);

function ranked(board, f) {
  const key = board + "|" + filtersKey(f);
  let hit = state.rankCache.get(key);
  if (!hit) {
    hit = L.ranked(D(), board, f);
    state.rankCache.set(key, hit);
    if (state.rankCache.size > 6) state.rankCache.delete(state.rankCache.keys().next().value);
  }
  return hit;
}

// ------------------------------------------------------------------------------------------------ routes
function parseHash() {
  // an in-page anchor ("#main") is not a route: keep showing the route we're on
  const h0 = (isRouteHash(location.hash) ? location.hash : nav.route).slice(1) || "/";
  const h = h0.startsWith("/") ? h0 : "/";
  const qi = h.indexOf("?");
  const path = qi >= 0 ? h.slice(0, qi) : h;
  const params = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : "");
  const seg = path.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const name = seg[0] || "home";
  if (name === "board") return { name, board: L.BOARD_IDS.includes(seg[1]) ? seg[1] : "cleanest", params };
  if (name === "place") return { name, id: seg.slice(1).join("/"), params };
  if (["search", "map", "saved", "about", "home"].includes(name)) return { name, params };
  return { name: "home", params, unknown: true };
}
function filtersFromParams(sp, scope) {
  const o = {};
  if (scope === "chicago") {
    const d = D();
    const sides = (sp.get("side") || "").split(",").filter((s) => d && d.sides.includes(s));
    if (sides.length) o.sides = sides;
    if (sp.get("hood") && d && d.hoods.includes(sp.get("hood"))) o.hood = sp.get("hood");
    const g = [...new Set((sp.get("grade") || "").toUpperCase().split(""))].filter((x) => L.GRADES_ORDER.includes(x));
    if (g.length) o.grades = g;
    if (sp.get("liquor") === "1") o.liquor = true;
    if (sp.get("dinein") === "1") o.dineIn = true;
  }
  // A town or cuisine from the rest of Illinois can only be checked once that's in; its lists wait for it, so keep it until then.
  const ilPending = scope === "illinois" && !state.il;
  const town = sp.get("town"), cuisine = sp.get("cuisine");
  if (scope !== "chicago" && town && (ilPending || (D() && D().cities.includes(town)))) o.city = town;
  if (cuisine && (ilPending || (D() && D().cuisines.includes(cuisine)))) o.cuisine = cuisine;
  if (sp.get("nochains") === "1") o.hideChains = true;
  if (sp.get("venues") === "1") o.includeVenues = true;
  return L.newFilters(o);
}
function filtersToParams(f, sp = new URLSearchParams()) {
  if (f.sides.size) sp.set("side", [...f.sides].join(","));
  if (f.hood) sp.set("hood", f.hood);
  if (f.grades.size) sp.set("grade", L.GRADES_ORDER.filter((g) => f.grades.has(g)).join(""));
  if (f.cuisine) sp.set("cuisine", f.cuisine);
  if (f.liquor) sp.set("liquor", "1");
  if (f.dineIn) sp.set("dinein", "1");
  if (f.hideChains) sp.set("nochains", "1");
  if (f.includeVenues) sp.set("venues", "1");
  if (f.city) sp.set("town", f.city);
  return sp;
}
const filtersKey = (f) => filtersToParams(f).toString();
const withQuery = (path, sp) => { const s = sp.toString(); return s ? `${path}?${s}` : path; };
const boardHash = (board, f) => withQuery(`#/board/${board}`, filtersToParams(f));
function searchHash({ q = "", scope = "chicago", near = false, f = null } = {}) {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (scope === "illinois" && !near) sp.set("scope", "illinois");
  if (near) sp.set("near", "1");
  if (f) filtersToParams(f, sp);
  return withQuery("#/search", sp);
}
function mapHash(scope, f, focus) {
  const sp = new URLSearchParams();
  if (scope === "illinois") sp.set("scope", "illinois");
  if (f) filtersToParams(f, sp);
  if (focus) sp.set("focus", focus);
  return withQuery("#/map", sp);
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function replaceHash(hash) { history.replaceState(history.state, "", hash); nav.route = hash; }

// ------------------------------------------------------------------------------------------------ header
const input = () => $("#q");
function syncHeader(route) {
  const scope = routeScope(route);
  const inp = input();
  inp.placeholder = scope === "illinois" ? "Name, town, street or ZIP" : "Name, street, cuisine or ZIP";
  if (route.name === "search" && document.activeElement !== inp) inp.value = capQ(route.params.get("q") || "");
  // a list, the map, Saved or About isn't a search: the box doesn't keep an old query (a place opened from Search keeps it)
  else if (route.name !== "search" && route.name !== "place" && document.activeElement !== inp) inp.value = "";
  $("#qclear").hidden = !inp.value;
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scope === scope)));
  const tab = { home: "rankings", board: "rankings", map: "map", search: "search", saved: "saved", about: "about" }[route.name] || state.lastTab;
  if (route.name !== "place") state.lastTab = tab;
  // like the app's tabs, Rankings, Search and Map come back to where you left them
  if (route.name === "home" || route.name === "board") state.tabHref.rankings = nav.route || "#/";
  if (route.name === "search") state.tabHref.search = nav.route || "#/search";
  if (route.name === "map") state.tabHref.map = nav.route.replace(/([?&])focus=[^&]*&?/, "$1").replace(/[?&]$/, "") || "#/map";
  document.querySelectorAll(".tabs a").forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    if (state.tabHref[a.dataset.tab]) a.setAttribute("href", state.tabHref[a.dataset.tab]);
  });
  const d = D();
  $("#through-date").innerHTML = d && d.recordsThrough ? `City records through <b>${esc(L.Fmt.date(d.recordsThrough))}</b>` : "City records";
}
function routeScope(route) {
  if ((route.name === "search" && route.params.get("near") !== "1") || route.name === "map") return route.params.get("scope") === "illinois" ? "illinois" : "chicago";
  if (route.name === "search") return "chicago";
  if (route.name === "place") return route.id.startsWith("il:") ? "illinois" : "chicago";
  return "chicago";           // the home grid, rankings, Saved and About search Chicago first, like the app's home search box
}
function setScope(scope) {
  const route = parseHash();
  // the pressed area is where you already are; only Near me (which covers both) switches to a plain Chicago search with it
  if (scope === routeScope(route) && !(route.name === "search" && route.params.get("near") === "1")) return;
  state.shown = 100;
  if (route.name === "map") { state.mapSel = null; state.mapStack = null; state.mapNote = null; go(mapHash(scope, null)); return; }
  // a new area starts over: filters reset, as in the app
  go(searchHash({ q: route.name === "search" ? route.params.get("q") || "" : input().value.trim() ? input().value : "", scope }));
}
function wireHeader() {
  let timer = null;
  const inp = input();
  const apply = () => {
    const route = parseHash();
    const q = capQ(inp.value);
    const scope = routeScope(route);
    const f = route.name === "search" ? filtersFromParams(route.params, route.params.get("near") === "1" ? "chicago" : scope) : null;
    const near = route.name === "search" && route.params.get("near") === "1";
    const hash = searchHash({ q, scope, near, f });
    if (route.name === "search") { state.shown = 100; replaceHash(hash); render({ soft: true }); }
    else { pushRoute(hash); state.shown = 100; render({ keepFocus: true }); }
  };
  inp.addEventListener("input", () => {
    $("#qclear").hidden = !inp.value;
    clearTimeout(timer);
    const route = parseHash();
    const prev = route.name === "search" ? (route.params.get("q") || "").trim() : "";
    // the first letter and a cleared field apply at once; otherwise wait for a pause in typing
    if (!inp.value.trim() || !prev) apply(); else timer = setTimeout(apply, 170);
  });
  $("#qform").addEventListener("submit", (e) => {
    e.preventDefault(); clearTimeout(timer); apply();
    if (matchMedia("(pointer: coarse)").matches) inp.blur();        // Search on a phone keyboard: put the keyboard away
  });
  $("#qclear").addEventListener("click", () => { inp.value = ""; $("#qclear").hidden = true; apply(); inp.focus(); });
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => setScope(b.dataset.scope)));
  // Rankings tab while on a list: back to the lists, like tapping the app's current tab
  document.querySelector('.tabs a[data-tab="rankings"]').addEventListener("click", (e) => {
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && parseHash().name === "board") { e.preventDefault(); go("#/"); }
  });
}

// ------------------------------------------------------------------------------------------------ render
const focusHeading = (view) => { const h = view.querySelector("h1"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); } };
/** opts.restore: coming back to an entry ({y, shown}); opts.from: the hash we came back from (its row gets focus). */
function render(opts = {}) {
  const route = parseHash();
  syncHeader(route);
  const view = $("#view");
  if (!D() && route.name !== "about") { renderLoading(view); syncSheet(); return; }
  setRobots(true);
  if (opts.soft && state.mounted && state.mounted.name === route.name && state.mounted.update) { state.mounted.update(route); syncSheet(); return; }
  if (state.cleanup) { state.cleanup(); state.cleanup = null; }
  state.closeSheet = null;
  if (!state.mounted || state.mounted.name !== route.name) state.filtersOpen = false;   // each view opens its own filters
  const V = VIEWS[route.name] || VIEWS.home;
  state.mounted = { name: route.name, update: null };
  V(view, route);
  syncSheet();
  if (opts.restore) {
    // back to a list: the same rows and scroll position, and focus on the row you opened
    window.scrollTo(0, opts.restore.y);
    const row = opts.from ? [...view.querySelectorAll("a[href]")].find((a) => a.getAttribute("href") === opts.from) : null;
    if (row) row.focus({ preventScroll: true }); else focusHeading(view);
    state.navs++;
  } else if (!opts.keepFocus) {
    window.scrollTo(0, 0);
    if (state.navs++ > 0) focusHeading(view);
  }
}

/** Only a page with the data on it is worth indexing: when the data isn't published at all, the page tells crawlers not to.
 *  A fetch that failed (offline, a timeout, a checksum caught mid-update) leaves the tag alone: it passes, and a crawler's
 *  render that happened to hit one shouldn't drop the page from search. */
const ROBOTS = document.querySelector('meta[name="robots"]');
const ROBOTS_ON = ROBOTS ? ROBOTS.content : "";
function setRobots(ok) { if (ROBOTS) ROBOTS.content = ok ? ROBOTS_ON : "noindex"; }

function renderLoading(view) {
  if (state.error) {
    const missing = state.error === "missing", offline = state.error === "offline";
    if (missing) setRobots(false);      // the page's own title stays: a crawler shouldn't file this URL under "Data unavailable"
    view.innerHTML = `<section class="view"><div class="empty" role="alert">${icon("warn")}
      <h1 class="h1">${missing ? "The restaurant data isn't published yet" : offline ? "Can't reach the restaurant data" : "The restaurant data didn't load"}</h1>
      <p>${missing ? "The web app reads the same weekly data files as the iPhone app, and they aren't on this site yet. Please check back soon."
        : offline ? "Check your connection and try again."
        : "It may be in the middle of its weekly update. Try again in a few minutes."}</p>
      <div class="row"><button class="btn solid" id="retry" type="button">Try again</button><a class="btn" href="../chicago-restaurant-grades.html">How the grades work</a></div></div></section>`;
    $("#retry").onclick = async () => { state.error = null; render(); await loadChicago(); render(); };
    return;
  }
  view.innerHTML = `<section class="view loading" aria-live="polite"><p class="display">Chicago<br>Restaurants: Ranked</p>
    <div class="bar indet"><i id="pbar"></i></div><p class="cap">Loading Chicago restaurants…</p>
    <p class="cap" id="slow"${state.slow ? "" : " hidden"}>Still loading. The list is about 2 MB, so a slow connection can take a little while.</p></section>`;
}

// ------------------------------------------------------------------------------------------------ shared pieces
function badgesHTML(p, hideMichelin = false) {
  const b = L.badges(p, hideMichelin);
  return b.length ? `<span class="badges">${b.map(([t, k]) => `<span class="badge ${k}">${esc(t)}</span>`).join("")}</span>` : "";
}
function rankRow(p, i, board) {
  const m = L.metric(board, p, D().recordsYear);
  const neg = L.BOARDS[board].negative;
  let lines;
  if (neg) {
    lines = `<span class="rsub">${esc([p.addr, p.hood].filter((x) => x != null).join(" · "))}</span>`
      + `<span class="rres">${esc(L.resultLine(p))}</span>` + (L.newerLine(p) ? `<span class="rres">${esc(L.newerLine(p))}</span>` : "");
  } else lines = `<span class="rsub">${esc([p.hood, p.cuisine].filter((x) => x != null).join(" · "))}</span>`;
  const grade = board !== "honors" && p.grade ? gradeChip(p.grade) : "";
  return `<li><a class="rrow" href="${placeHref(p)}"><span class="rank${i < 3 ? " podium" : ""}${i >= 99 ? " long" : ""}"><span class="sr">Rank </span>${i + 1}</span>`
    + `<span class="rmain"><span class="rname">${esc(p.name)}</span>${lines}${badgesHTML(p, board === "honors")}</span>`
    + `<span class="rmetric"><span class="mtop">${grade}<b>${esc(m[0])}</b></span><small>${esc(m[1])}</small></span></a></li>`;
}
/** The words on each Closest matches row (SearchRow.closestNote), so a row seen after the heading scrolls away can't pass
 *  for the place typed. Inside the row's link, so a screen reader reads them with the name too. */
const CLOSEST_NOTE = "Closest match, not an exact match";
function searchRow(p, dist, extra = "", closest = false) {
  const tile = p.grade ? gradeChip(p.grade, "gt") : `<span class="tile">${icon("fork")}</span>`;
  const addr = [p.addr, p.placeLine].filter((x) => x != null).join(" · ");
  const right = (p.score != null ? `<span class="score"><span class="sr">inspection score </span>${p.score}</span>` : "")
    + (dist != null ? `<span class="dist">${esc(L.distLabel(dist))}</span>` : "");
  return `<li class="srow-li"><a class="rrow srow" href="${placeHref(p)}">${tile}<span class="rmain"><span class="rname">${esc(p.name)}</span>`
    + `<span class="rsub">${esc(addr)}</span>${closest ? `<span class="rclose">${icon("question")}<span>${CLOSEST_NOTE}</span></span>` : ""}`
    + `${badgesHTML(p)}</span>${right ? `<span class="rmetric">${right}</span>` : ""}</a>${extra}</li>`;
}
function moreButton(total, shown, cap) {
  if (shown >= Math.min(total, cap)) return "";
  const next = Math.min(100, Math.min(total, cap) - shown);
  return `<div class="more"><button class="btn" type="button" data-more>Show ${n(next)} more</button></div>`;
}

// ---- filters panel (FiltersView.swift)
function filtersPanel(scope, f, opts = {}) {
  const d = D();
  const sel = (key, label, all, items, value, fmt = (x) => x) => `<div><label class="flabel" for="f-${key}">${label}</label>
    <select class="fsel" id="f-${key}" data-f="${key}"><option value="">${all}</option>${items.map((x) => `<option value="${esc(x)}"${x === value ? " selected" : ""}>${esc(fmt(x))}</option>`).join("")}</select></div>`;
  const check = (key, label, on) => `<label><input type="checkbox" data-f="${key}"${on ? " checked" : ""}> <span>${label}</span></label>`;
  let html = `<div class="fhead"><h2>${scope === "chicago" ? "Filters" : "Filters · Rest of Illinois"}</h2><button class="linkbtn m-only" type="button" data-f="close">Done</button></div><div class="fgrid">`;
  if (scope === "chicago") {
    html += `<fieldset class="fgroup"><legend>Side of the city</legend><div class="fchips">${d.sides.map((s) => `<button type="button" data-f="side" data-v="${esc(s)}" aria-pressed="${f.sides.has(s)}">${esc(s === "Central" ? "Downtown" : s)}</button>`).join("")}</div></fieldset>`;
    html += `<fieldset class="fgroup"><legend>Inspection grade (ours, not official)</legend><div class="fgrades${f.grades.size ? " some" : ""}">${L.GRADES_ORDER.map((g) => `<button type="button" data-f="grade" data-v="${g}" aria-pressed="${f.grades.has(g)}" aria-label="Grade ${g}"><span class="g g${g}" aria-hidden="true">${g}</span></button>`).join("")}</div></fieldset>`;
    html += `<div class="fgroup">${sel("hood", "Neighborhood", "All neighborhoods", d.hoods, f.hood)}</div>`;
  } else {
    html += `<div class="fgroup">${sel("town", "Town", "All towns", [...d.cities].sort(L.cmpStr), f.city)}</div>`;
  }
  html += `<div class="fgroup">${sel("cuisine", "Cuisine", "All cuisines", d.cuisines, f.cuisine)}</div>`;
  html += `<fieldset class="fgroup"><legend>Show</legend><div class="fchecks">${check("nochains", "Hide chains (5+ locations)", f.hideChains)}`;
  html += scope === "chicago"
    ? check("liquor", "Serves alcohol", f.liquor) + check("dinein", "Has a dining room", f.dineIn) + check("venues", "Include airports, stadiums, cafeterias &amp; other non-restaurants", f.includeVenues)
    : check("venues", "Include gas stations, grocery counters &amp; other non-restaurants", f.includeVenues);
  html += `</div></fieldset></div>`;
  if (opts.near) html += `<p class="fnote">Grade, side, neighborhood, alcohol and dining-room filters come from City of Chicago records, so they show Chicago places only.</p>`;
  html += `<p class="fnote"${L.activeCount(f) ? "" : " hidden"} data-clearrow><button class="btn small" type="button" data-f="clear">Clear all filters</button></p>`;
  // on a phone the panel is a sheet over the list: this shows what the filters leave and closes it
  html += `<div class="fdone"><button class="btn solid" type="button" data-f="close" data-count>${showCount(opts.count)}</button></div>`;
  return html;
}
const showCount = (k) => (k == null ? "Done" : `Show ${plural(k, "place", "places")}`);
const setShowCount = (panel, k) => { const b = panel && panel.querySelector("[data-count]"); if (b) b.textContent = showCount(k); };

/** On a phone an open filters panel is a sheet with a scrim behind it; this keeps the page, the scrim and the sheet's role in step. */
function syncSheet() {
  const panel = phone.matches ? document.querySelector("#view .fpanel:not(.closed):not([hidden])") : null;
  document.body.classList.toggle("sheet-open", !!panel);
  const scrim = $("#scrim"); if (scrim) scrim.hidden = !panel;
  document.querySelectorAll("#view .fpanel").forEach((p) => {
    if (p === panel) { p.setAttribute("role", "dialog"); p.setAttribute("aria-modal", "true"); p.setAttribute("aria-label", "Filters"); }
    else { p.removeAttribute("role"); p.removeAttribute("aria-modal"); p.removeAttribute("aria-label"); }
  });
}
/** Lists with a sidebar: on a wide screen the list comes first (the filters sit to its right), otherwise the filters sit above it,
 *  so the reading and Tab order always match what's on screen. */
function placeSide() {
  const cols = document.querySelector("#view .cols");
  if (!cols) return;
  const side = cols.querySelector(".colside"), body = cols.querySelector(".colbody");
  if (!side || !body) return;
  if (wide.matches) { if (body.nextElementSibling !== side) body.after(side); } else if (side.nextElementSibling !== body) body.before(side);
  fitSide();
}
/** The sticky sidebar only sticks when it fits the window; a taller one scrolls with the page, so nothing is cut off. */
function fitSide() {
  const side = document.querySelector("#view .colside");
  if (!side) return;
  side.classList.remove("tall");
  if (wide.matches && side.scrollHeight > window.innerHeight - 32) side.classList.add("tall");
}

/** Wires a filters panel: each change calls onChange(newFilters). */
function bindFilters(panel, getF, onChange, onClose) {
  const edit = (fn) => { const f = getF(); const g = L.newFilters({ sides: [...f.sides], hood: f.hood, cuisine: f.cuisine, grades: [...f.grades], liquor: f.liquor, dineIn: f.dineIn, hideChains: f.hideChains, includeVenues: f.includeVenues, city: f.city }); fn(g); onChange(g); syncFilters(panel, g); };
  const close = () => { onClose(); syncSheet(); };
  state.closeSheet = close;
  panel.addEventListener("keydown", (e) => {
    if (!document.body.classList.contains("sheet-open")) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;          // a sheet keeps Tab inside it until it's closed
    const els = [...panel.querySelectorAll("button, select, input")].filter((x) => x.offsetParent !== null && !x.disabled);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    const k = b.dataset.f, v = b.dataset.v;
    if (k === "close") { close(); return; }
    if (k === "clear") { edit((g) => { Object.assign(g, L.newFilters()); }); return; }
    if (k === "side") edit((g) => { if (g.sides.has(v)) g.sides.delete(v); else g.sides.add(v); });
    if (k === "grade") edit((g) => { if (g.grades.has(v)) g.grades.delete(v); else g.grades.add(v); });
  });
  panel.addEventListener("change", (e) => {
    const el = e.target.closest("[data-f]");
    if (!el) return;
    const k = el.dataset.f;
    edit((g) => {
      if (k === "hood") g.hood = el.value || null;
      if (k === "town") g.city = el.value || null;
      if (k === "cuisine") g.cuisine = el.value || null;
      if (k === "nochains") g.hideChains = el.checked;
      if (k === "liquor") g.liquor = el.checked;
      if (k === "dinein") g.dineIn = el.checked;
      if (k === "venues") g.includeVenues = el.checked;
    });
  });
}
function syncFilters(panel, f) {
  panel.querySelectorAll('button[data-f="side"]').forEach((b) => b.setAttribute("aria-pressed", String(f.sides.has(b.dataset.v))));
  panel.querySelectorAll('button[data-f="grade"]').forEach((b) => b.setAttribute("aria-pressed", String(f.grades.has(b.dataset.v))));
  const gr = panel.querySelector(".fgrades"); if (gr) gr.classList.toggle("some", f.grades.size > 0);
  const set = (k, v) => { const el = panel.querySelector(`[data-f="${k}"]`); if (el) { if (el.type === "checkbox") el.checked = !!v; else el.value = v || ""; } };
  set("hood", f.hood); set("town", f.city); set("cuisine", f.cuisine); set("nochains", f.hideChains); set("liquor", f.liquor); set("dinein", f.dineIn); set("venues", f.includeVenues);
  const cr = panel.querySelector("[data-clearrow]"); if (cr) cr.hidden = L.activeCount(f) === 0;
}
const filterButton = (f, open) => `<button class="btn small" type="button" data-toggle-filters aria-expanded="${open}">${icon("filter")}<span>${L.activeCount(f) ? `Filters (${L.activeCount(f)})` : "Filters"}</span></button>`;
/** Skip to filters: on a wide screen the filters come after the list in Tab order (placeSide), up to 100 rows later, so a
 *  link just before the list (shown when it has focus) goes to the filters' heading; Tab then goes on to the first filter. */
const skipToFilters = (panelId) => `<a class="skip-inline d-only" href="#${panelId}" data-skip-filters>Skip to filters</a>`;
function focusFilters(root) { const h = root.querySelector(".colside .fpanel h2"); if (h) { h.setAttribute("tabindex", "-1"); h.focus(); } }

// ------------------------------------------------------------------------------------------------ home (HomeView.swift)
function viewHome(view, route) {
  const d = D();
  document.title = "Search Chicago Restaurant Grades, Map & Rankings | Chi Ranked";
  const ilN = illinoisCount(), towns = townCount();
  const cards = L.HOME_CARDS.map((c) => {
    let count = null, href = "#/", sub = c.sub;
    if (c.board) { href = boardHash(c.board, L.newFilters(c.filters)); if (!c.noCount) count = L.boardCount(d, c.board, L.newFilters(c.filters)); }
    else if (c.near) href = searchHash({ near: true });
    else if (c.search === "chicago") href = searchHash({});
    else if (c.search === "illinois") { href = searchHash({ scope: "illinois" }); count = ilN; if (towns != null) sub = `Restaurants in ${n(towns)} more towns. No grades outside Chicago.`; }
    const art = c.icon === "hotdog" ? `<img src="hotdog.png" width="30" height="11" alt="">` : icon(c.icon);
    return `<li><a class="card${c.signature ? " sig" : ""}" href="${href}" data-card="${c.id}"><span class="row"><span class="circle" aria-hidden="true">${art}</span>`
      + (count != null ? `<span class="num" aria-hidden="true">${n(count)}</span>` : "") + `</span><span class="t">${esc(c.title)}</span>`
      + `<span class="s">${esc(sub)}</span>${count != null ? `<span class="sr">, ${plural(count, "place", "places")}</span>` : ""}</a></li>`;
  }).join("");
  view.innerHTML = `<section class="view home">
    <div class="hero">
      <div><span class="capsule" aria-hidden="true"></span>
        <p class="display mark" aria-hidden="true">Chicago<br>Restaurants:<br>Ranked</p>
        <h1>Search Chicago restaurant grades</h1>
        <p class="tag">Food map &amp; our A–F grades</p>
        <p class="lede">Nearly every restaurant, café and tavern the City of Chicago inspects, graded and ranked${ilN != null && towns != null ? `, plus ${n(ilN)} restaurants in ${n(towns)} more Illinois towns` : ", plus restaurants across the rest of Illinois"}.</p>
      </div>
      <aside class="scale" aria-labelledby="scale-h"><h2 id="scale-h">Our grade</h2>
        <ol>${L.GRADES_ORDER.map((g) => `<li>${gradeChip(g)}${{ A: "<span>Best</span>", F: "<span>Worst</span>" }[g] || ""}</li>`).join("")}</ol>
        <p><span class="long">Our 0–100 score and A–F grade, calculated from City of Chicago inspection records since January 2023. Not official City grades: the City reports Pass, Pass w/ Conditions or Fail.</span><span class="short">Our grades from City inspection records, not official City grades.</span> <a href="#/about">How it works</a></p>
      </aside>
    </div>
    <h2 class="sr">Lists</h2>
    <ul role="list" class="cards">${cards}</ul>
    <button class="btn surprise" type="button" id="surprise">${icon("dice")}<span>Surprise me with an A-grade spot</span></button>
    <p class="home-fine">Grades are ours, calculated from City of Chicago inspection records, not official City grades. Every list is built from public records: City inspections and licenses, the Cook County Assessor and hand-checked honors.</p>
    <p class="home-fine"><a href="#/about">See About for sources and disclaimers</a></p>
  </section>`;
  $("#surprise").onclick = () => {
    state.surprisePool ||= L.surpriseCandidates(d.chicago);
    const pool = state.surprisePool.filter((p) => p.id !== state.lastSurprise);
    if (!pool.length) return;
    const p = pool[Math.floor(Math.random() * pool.length)];
    state.lastSurprise = p.id;
    go(placeHref(p));
  };
  view.querySelector('[data-card="nearMe"]').addEventListener("click", () => requestLocation());
}

// ------------------------------------------------------------------------------------------------ boards (RankingsView.swift BoardList)
const CAP = 600;
function viewBoard(view, route) {
  const d = D();
  const board = route.board;
  let f = filtersFromParams(route.params, "chicago");
  const B = L.BOARDS[board];
  const title = () => (board === "cleanest" && f.cuisine && L.filtersEqual(f, L.newFilters({ cuisine: f.cuisine })) ? f.cuisine : B.title);
  // the Hot Dogs & Beef card narrows Cleanest by cuisine; picking a chip shows that whole board, not a hidden filter
  const chipFilters = () => (L.filtersEqual(f, L.newFilters({ cuisine: L.HOT_DOG_CUISINE })) ? L.newFilters() : f);
  const chips = () => L.BOARD_IDS.map((id) => `<a href="${boardHash(id, chipFilters())}"${id === board ? ' aria-current="page"' : ""}>${icon(L.BOARDS[id].icon)}<span>${esc(L.BOARDS[id].short)}</span></a>`).join("");
  view.innerHTML = `<section class="view board">
    <nav class="chips" aria-label="Rankings" id="bchips">${chips()}</nav>
    <div class="cols">
      <div class="colhead bhead">
        <h1 class="h1" id="btitle"></h1>
        <div class="countline"><p class="n" id="bcount" aria-live="polite"></p><span class="spacer"></span>
          ${B.negative ? "" : `<button class="linkbtn m-only" type="button" id="binfo" aria-expanded="${state.showInfo}" aria-controls="bexp">${icon("info")}<span>${state.showInfo ? "Hide how it's ranked" : "How it's ranked"}</span></button>`}
          <span id="bfbtn" class="m-only"></span></div>
        ${board !== "honors" ? `<p class="cap">${GRADES_CAPTION}</p>` : ""}
        ${L.NOTES[board] ? `<p class="cap">${esc(L.NOTES[board])}</p>` : ""}
        ${skipToFilters("bpanel")}
      </div>
      <div class="colbody" id="blist"></div>
      <aside class="colside" aria-label="About this list and filters">
        <div class="explainer${state.showInfo || B.negative ? "" : " closed"}" id="bexp"><h2 class="d-only">How it's ranked</h2><p>${esc(L.explainer(board, d.recordsThrough))}</p></div>
        <div class="fpanel${state.filtersOpen ? "" : " closed"}" id="bpanel">${filtersPanel("chicago", f)}</div>
      </aside>
    </div>
  </section>`;
  const root = view.firstElementChild;
  placeSide();
  const panel = $("#bpanel");
  const draw = () => {
    const list = ranked(board, f);
    document.title = `${title()} · Chicago restaurant rankings | Chi Ranked`;
    $("#btitle").textContent = title();
    $("#bcount").innerHTML = `${plural(list.length, "place", "places")}${L.activeCount(f) ? " <span>· filtered</span>" : ""}`;
    $("#bfbtn").innerHTML = filterButton(f, state.filtersOpen);
    $("#bchips").innerHTML = chips();
    setShowCount(panel, list.length);
    const shown = Math.min(state.shown, CAP, list.length);
    let html;
    if (!list.length) {
      html = `<div class="empty">${icon("filter")}<h2>Nothing matches</h2><p>No places on this board match your filters.</p><div class="row"><button class="btn solid" type="button" data-clear>Clear filters</button></div></div>`;
    } else {
      html = `<ol role="list" class="rlist">${list.slice(0, shown).map((p, i) => rankRow(p, i, board)).join("")}</ol>${moreButton(list.length, shown, CAP)}`;
      if (list.length > CAP && shown >= CAP) html += `<p class="cap">Showing the top ${n(CAP)} of ${n(list.length)}. Use filters or Search to find the rest.</p>`;
    }
    $("#blist").innerHTML = html;
    fitSide();
  };
  const setF = (g) => { f = g; state.shown = 100; replaceHash(boardHash(board, f)); draw(); };
  bindFilters(panel, () => f, setF, () => { state.filtersOpen = false; panel.classList.add("closed"); draw(); $("#bfbtn button").focus(); });
  // on this view's own section, so the listener goes away with it
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-toggle-filters]")) {
      state.filtersOpen = !state.filtersOpen; panel.classList.toggle("closed", !state.filtersOpen); draw(); syncSheet();
      if (state.filtersOpen) panel.querySelector("button, select, input").focus();
    }
    else if (e.target.closest("[data-more]")) { const was = state.shown; state.shown += 100; draw(); const li = $("#blist").querySelectorAll(".rrow")[was]; if (li) li.focus(); }
    else if (e.target.closest("[data-clear]")) { setF(L.newFilters()); syncFilters(panel, f); }
    else if (e.target.closest("[data-skip-filters]")) { e.preventDefault(); focusFilters(root); }
    else if (e.target.closest("#binfo")) {
      state.showInfo = !state.showInfo;
      $("#bexp").classList.toggle("closed", !state.showInfo);
      const b = $("#binfo"); b.setAttribute("aria-expanded", String(state.showInfo)); b.querySelector("span").textContent = state.showInfo ? "Hide how it's ranked" : "How it's ranked";
    }
  });
  draw();
  // bring this list's chip into view on a phone, without scrollIntoView (Chrome would start Tab from the chip)
  const strip = $("#bchips"), cur = strip.querySelector("[aria-current]");
  if (cur && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = Math.max(0, cur.offsetLeft - (strip.clientWidth - cur.offsetWidth) / 2);
  // a chip that gets focus half off the edge of the strip scrolls fully into view (the browser only scrolls once it's all off)
  strip.addEventListener("focusin", (e) => { const a = e.target.closest("a"); if (a) a.scrollIntoView({ inline: "nearest", block: "nearest" }); });
}

// ------------------------------------------------------------------------------------------------ search (SearchTab.swift)
const TRY = ["tacos pilsen", "west loop", "pizza", "logan square", "60614", "portillo", "coffee wicker park", "south side bbq"];
function viewSearch(view, route) {
  let ctx = null;
  view.innerHTML = `<section class="view search"><div class="cols">
    <div class="colhead"><span class="kicker" id="skick"></span><h1 class="h1" id="stitle"></h1>
      <div class="countline" id="shead"><p class="n" id="scount" aria-live="polite"></p><span class="spacer"></span><span class="m-only" id="sfbtn"></span><span id="snear"></span></div>
      <p class="cap" id="scap" hidden></p>${skipToFilters("spanel")}</div>
    <div class="colbody" id="sbody"></div>
    <aside class="colside" aria-label="Filters"><div class="fpanel${state.filtersOpen ? "" : " closed"}" id="spanel"></div></aside></div></section>`;
  const root = view.firstElementChild;
  placeSide();
  const panel = $("#spanel");
  const read = (r) => {
    const near = r.params.get("near") === "1";
    const scope = near ? "chicago" : r.params.get("scope") === "illinois" ? "illinois" : "chicago";
    return { q: capQ(r.params.get("q") || ""), scope, near, f: filtersFromParams(r.params, scope) };
  };
  bindFilters(panel, () => ctx.f, (g) => { ctx.f = g; state.shown = 100; replaceHash(searchHash({ q: ctx.q, scope: ctx.scope, near: ctx.near, f: g })); draw(); },
    () => { state.filtersOpen = false; draw(); const b = $("[data-toggle-filters]"); if (b) b.focus(); });
  let panelKey = null, pendingOrder = false;
  // the one live region for the count: it stays in the page, so a screen reader hears each new count
  const setCount = (html) => { const el = $("#scount"); if (el.innerHTML !== html) el.innerHTML = html; };
  const draw = () => {
    const { q, scope, near, f } = ctx;
    const d = D();
    const text = q.trim();
    const showsSuggestions = !text && !near && L.activeCount(f) === 0;
    // a redraw keeps focus on the same row or button, and in the Near me panel while it changes (Try again, Finding you…, the result)
    const act = document.activeElement, keep = act && root.contains(act) && $("#sbody").contains(act) ? act.getAttribute("href") : null;
    const keepLoc = !!(act && $("#sbody").contains(act) && act.closest("[data-loc]"));
    document.title = near ? "Restaurants near me | Chi Ranked" : text ? `“${text}” · Search ${scope === "chicago" ? "Chicago" : "the rest of Illinois"} | Chi Ranked` : "Search | Chi Ranked";
    $("#skick").textContent = near ? "Chicago and the rest of Illinois" : scope === "chicago" ? "Chicago" : "Rest of Illinois";
    $("#stitle").textContent = near ? "Near me" : text ? "Search" : scope === "chicago" ? "Search Chicago restaurants" : "Search the rest of Illinois";
    // rebuilt when the area changes, and once the rest of Illinois is in (its towns and cuisines join the lists)
    const key = `${scope}|${near}|${!!state.il}`;
    if (panelKey !== key) { panel.innerHTML = filtersPanel(near ? "chicago" : scope, f, { near }); panelKey = key; } else syncFilters(panel, f);
    panel.classList.toggle("closed", !state.filtersOpen);
    $("#snear").innerHTML = near ? `<button class="linkbtn" type="button" data-clear-near>Clear</button>` : "";
    const needIL = scope === "illinois" || near;
    if (needIL && !state.il) {
      setCount(""); $("#sfbtn").innerHTML = ""; $("#scap").hidden = true;
      $("#sbody").innerHTML = state.ilError ? ilErrorHTML() : ilLoadingHTML();
      // once it's in (or has failed), draw again; a failure stays put until Try again, so this never loops
      if (!state.ilError) afterIllinois(() => { ctx = read(parseHash()); draw(); });
      syncSheet();
      return;
    }
    $("#sfbtn").innerHTML = filterButton(f, state.filtersOpen);
    // Chicago search: the rest of Illinois' town names and cuisines are part of the app's search index, so bring them in
    // (in the background); draw again when they arrive if the order could change, and if they fail, stop waiting for them
    if (!state.il && !state.ilError && !showsSuggestions) afterIllinois((ok) => { if (ok || pendingOrder) { ctx = read(parseHash()); draw(); } });
    pendingOrder = false;
    if (showsSuggestions) { setCount(""); drawSuggestions(scope, f); setShowCount(panel, null); syncSheet(); return; }
    let places = [], total = 0, outOfArea = null, point = null, status = "ok", listed = true, closest = [];
    if (near && state.geo.status === "ok") {
      point = state.geo.point;
      const r = L.near(d, text, f, point, L.SEARCH_LIMIT);
      places = r.places; total = r.total;
      if (total === 0) { const best = L.nearest(d, point); if (best && best.m > L.NEAR_RADIUS) outOfArea = best.m; }
    } else {
      if (near) status = state.geo.status;
      // near me without a location but with a query or filters is a plain search (by score, not "Nearest first"), as in the app
      if (near && !text && L.activeCount(f) === 0) listed = false;
      else {
        // Finder.results: the first 400 matches, how many in all, and when nothing matches exactly, the closest ones
        const r = L.results(d, { text: q, scope, filters: f, near: false });
        total = r.total; places = r.places; closest = r.closest;
        // the order depends on the rest of Illinois' town names: wait for them rather than show an order the app wouldn't
        if (r.orderPending && !state.il && !state.ilError) pendingOrder = true;
      }
    }
    // header: count, filters, and one caption line
    const count = point ? (outOfArea != null ? "Near me" : "Nearest first") : !listed ? "Near me" : plural(total, "place", "places");
    // Closest matches only: the count stays "0 places" (the app's), and a screen reader also hears that there's a list below
    const closestNote = closest.length && !places.length && !pendingOrder ? `<span class="sr"> · no exact match, ${plural(closest.length, "closest match", "closest matches")} below</span>` : "";
    setCount(`${count}${L.activeCount(f) ? " <span>· filtered</span>" : ""}${closestNote}`);
    setShowCount(panel, listed ? total : null);
    const hasGrades = places.some((p) => p.grade != null) || closest.some((p) => p.grade != null);
    let cap = null;
    if (near && point) cap = (L.chicagoOnly(f) ? "Chicago places within 50 miles (your filters use City records)." : "Chicago and the rest of Illinois, within 50 miles.") + (hasGrades ? " " + GRADES_CAPTION : "");
    else if (hasGrades) cap = GRADES_CAPTION;
    else if (scope === "illinois" && !near) cap = "No grades outside Chicago: the City inspects only Chicago restaurants.";
    $("#scap").hidden = !cap; $("#scap").textContent = cap || "";
    let html = "";
    if (near && !point) html += locationPanel(status);
    if (pendingOrder) {
      html += ilLoadingHTML("Searching…");
    } else if (near && outOfArea != null) {
      html += `<div class="panel-note"><h2>You're about ${n(Math.round(outOfArea / 1609.344))} miles from Illinois</h2><p>Near me covers Chicago and the rest of Illinois. You can still browse every list, or search by name, neighborhood or ZIP.</p>
        <div class="row"><a class="btn small" href="${boardHash("cleanest", L.newFilters())}">Cleanest Kitchens</a><a class="btn small" href="${searchHash({})}">Search Chicago</a></div></div>`;
    } else if (!places.length && !closest.length && listed) {
      const other = scope === "chicago" ? "illinois" : "chicago";
      html += `<div class="empty">${icon("search")}<h2>${text ? `No results for “${esc(text)}”` : "Nothing matches"}</h2><p>${L.activeCount(f) ? "Your filters may be hiding places." : "Check the spelling or try a new search."}</p><div class="row">`
        + (L.activeCount(f) ? `<button class="btn" type="button" data-clear-filters>Clear filters</button>` : "")
        + (!near && text ? `<a class="btn" href="${searchHash({ q, scope: other })}">Search ${other === "chicago" ? "Chicago" : "Rest of Illinois"} for “${esc(text)}”</a>` : "") + `</div></div>`;
    }
    if (places.length && !pendingOrder) {
      const shown = Math.min(state.shown, places.length);
      html += `<ol role="list" class="rlist">${places.slice(0, shown).map((p) => searchRow(p, point ? L.distance(p, point) : null)).join("")}</ol>`;
      html += moreButton(places.length, shown, L.SEARCH_LIMIT);
      if (shown >= places.length && total > places.length) html += `<p class="cap">Showing the first ${n(places.length)} of ${n(total)}. Add a word, a neighborhood or a filter to narrow it.</p>`;
    }
    // no exact match: the closest ones, under a heading that says so (never as results, never in the count), and every row
    // says so too (SearchTab.closestHeader, SearchRow.closest)
    if (closest.length && !places.length && !pendingOrder) {
      const other = scope === "chicago" ? "illinois" : "chicago";
      html += `<div class="closest-head"><h2>No exact match for “${esc(text)}”</h2>`
        + `<p>${L.activeCount(f) ? "These places match only some of your words, or spell them differently. Your filters may be hiding others."
          : "These places match only some of your words, or spell them differently. Check the name and address."}</p>`
        + ((L.activeCount(f) || (!near && text)) ? `<div class="row">${L.activeCount(f) ? `<button class="btn small" type="button" data-clear-filters>Clear filters</button>` : ""}`
          + (!near && text ? `<a class="btn small" href="${searchHash({ q, scope: other })}">Search ${other === "chicago" ? "Chicago" : "Rest of Illinois"}</a>` : "") + `</div>` : "")
        + `<h3 class="flabel" id="closest-h">Closest matches</h3></div>`;
      html += `<ol role="list" class="rlist closest" aria-labelledby="closest-h">${closest.map((p) => searchRow(p, null, "", true)).join("")}</ol>`;
    }
    $("#sbody").innerHTML = html;
    if (keep) { const again = [...$("#sbody").querySelectorAll("a[href]")].find((a) => a.getAttribute("href") === keep); if (again) again.focus({ preventScroll: true }); }
    if (keepLoc) {
      const again = $("#sbody [data-locate]") || $("#sbody [data-loc]");
      if (again) { if (!again.matches("button")) again.setAttribute("tabindex", "-1"); again.focus({ preventScroll: true }); } else focusHeading(view);
    }
    fitSide();
    syncSheet();
  };
  const drawSuggestions = (scope, f) => {
    const d = D();
    $("#scap").hidden = true;
    const ilN = illinoisCount(), towns = townCount();
    let html = `<p><button class="btn solid nearbtn" type="button" data-near>${icon("location")}<span>Restaurants near me</span></button></p>`;
    if (scope === "chicago") {
      html += `<p class="note">Search nearly every Chicago restaurant by name, street, cuisine, neighborhood or ZIP${ilN != null ? `. Or switch to Rest of Illinois to search ${n(ilN)} restaurants in ${n(towns)} more towns` : ""}.</p>`;
      html += `<h2 class="flabel">Try</h2><ul role="list" class="try">${TRY.map((s) => `<li><a href="${searchHash({ q: s })}">${icon("search")}${esc(s)}</a></li>`).join("")}</ul>`;
    } else {
      html += `<p class="note">${ilN != null ? `Search ${n(ilN)} restaurants in ${n(towns)} more Illinois towns. ` : ""}No grades outside Chicago: the City inspects only Chicago restaurants. Switch to Chicago to search Chicago restaurants.</p>`;
      html += `<h2 class="flabel">Biggest towns</h2><ul role="list" class="try">${d.cities.slice(0, 12).map((c) => `<li><a href="${searchHash({ q: c, scope: "illinois" })}">${icon("building")}${esc(c)}</a></li>`).join("")}</ul>`;
    }
    html += `<p class="note">Or browse the <a href="#/">rankings</a> or the <a href="${mapHash(scope, null)}">map</a>.</p>`;
    $("#sbody").innerHTML = html;
    fitSide();
  };
  // on this view's own section, so the listener goes away with it
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-toggle-filters]")) { state.filtersOpen = !state.filtersOpen; draw(); if (state.filtersOpen) panel.querySelector("button, select, input").focus(); }
    else if (t.closest("[data-more]")) { const was = state.shown; state.shown += 100; draw(); const r = $("#sbody").querySelectorAll(".rrow")[was]; if (r) r.focus(); }
    else if (t.closest("[data-clear-filters]")) { ctx.f = L.newFilters(); replaceHash(searchHash({ q: ctx.q, scope: ctx.scope, near: ctx.near })); syncFilters(panel, ctx.f); draw(); }
    else if (t.closest("[data-near]")) { requestLocation(); go(searchHash({ near: true })); }
    else if (t.closest("[data-locate]")) { requestLocation(); draw(); }
    else if (t.closest("[data-clear-near]")) go(searchHash({ q: ctx.q }));
    else if (t.closest("[data-skip-filters]")) { e.preventDefault(); focusFilters(root); }
  });
  state.onGeo = () => { if (ctx && ctx.near) draw(); };
  state.cleanup = () => { state.onGeo = null; };
  state.mounted.update = (r) => { ctx = read(r); draw(); };
  ctx = read(route);
  draw();
}
/** The Near me panel. data-loc marks it, so a redraw keeps focus in it; its errors are alerts, so a screen reader hears them. */
function locationPanel(status) {
  if (status === "locating") return `<p class="note" aria-live="polite" data-loc><span class="spin" aria-hidden="true"></span>Finding you…</p>`;
  if (status === "denied") return `<div class="panel-note" role="alert" data-loc><p>Location is off for this site. You can still browse by neighborhood or search a ZIP code, or allow location for this site in your browser's settings and try again.</p><div class="row"><button class="btn small" type="button" data-locate>Try again</button></div></div>`;
  if (status === "failed") return `<div class="panel-note" role="alert" data-loc><p>Couldn't find your location. Check that you have a signal and try again, or browse by neighborhood or search a ZIP code.</p><div class="row"><button class="btn small" type="button" data-locate>Try again</button></div></div>`;
  if (status === "unsupported") return `<div class="panel-note" role="alert" data-loc><p>This browser can't share its location. You can still browse by neighborhood or search a ZIP code.</p></div>`;
  return `<div class="panel-note" data-loc><h2>Restaurants near you</h2><p>Sorted by distance from where you are. Your location is used only in this browser and is never stored or sent anywhere.</p><div class="row"><button class="btn solid small" type="button" data-locate>${icon("location")}<span>Use my location</span></button></div></div>`;
}

/** Location, only when someone taps Near me or Show my location. Kept in memory for this visit; never stored or sent. */
function requestLocation(then) {
  if (!("geolocation" in navigator)) { state.geo = { status: "unsupported", point: null }; state.onGeo && state.onGeo(); return; }
  state.geo = { status: "locating", point: state.geo.point };
  ensureIllinois();
  navigator.geolocation.getCurrentPosition((pos) => {
    // rounded to about 100 m, like the app's SearchRequest, so the list and its distance labels agree
    const r = (v) => L.roundAway(v * 1000) / 1000;
    state.geo = { status: "ok", point: [r(pos.coords.latitude), r(pos.coords.longitude)] };
    ensureIllinois().then(() => { state.onGeo && state.onGeo(); then && then(); });
  }, (err) => {
    state.geo = { status: err && err.code === 1 ? "denied" : "failed", point: null };
    state.onGeo && state.onGeo();
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
}

// ------------------------------------------------------------------------------------------------ place page (PlaceDetailView.swift)
const kv = (k, v, cls = "") => `<div${cls ? ` class="${cls}"` : ""}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`;
const section = (title, body) => `<section class="sec" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${body}</section>`;
const noteP = (t) => `<p class="note">${esc(t)}</p>`;
function viewPlace(view, route) {
  const d = D();
  const p = d.byId.get(route.id);
  if (!p) {
    // a place in the rest of Illinois can only be looked up once that data is in: until then (or if it fails) never say it's gone
    if (route.id.startsWith("il:") && !state.il) {
      if (state.ilError) {
        document.title = "Couldn't load the rest of Illinois | Chi Ranked";
        view.innerHTML = `<section class="view">${ilErrorHTML("h1", "This link is to a place outside Chicago, and the restaurants across the rest of Illinois didn't load. ")}</section>`;
        return;
      }
      view.innerHTML = `<section class="view"><h1 class="sr">Loading</h1>${ilLoadingHTML()}</section>`;
      afterIllinois(() => render({ keepFocus: true }));
      return;
    }
    // PlaceDetailView's own words: an id that isn't in the data (gone, or a cut-off link) isn't claimed to have been listed
    document.title = "Not in the current data | Chi Ranked";
    view.innerHTML = `<section class="view"><div class="empty">${icon("fork")}<h1 class="h1">Not in the current data</h1>
      <p>This place isn't in the latest data update. If it's in a later one, it shows here again.</p>
      <div class="row"><a class="btn solid" href="#/">Browse the rankings</a><a class="btn" href="${searchHash({})}">Search</a></div>
      ${state.saved.has(route.id) ? `<p class="cap">It's still in your Saved places, so it comes back there if a later update lists it again.</p>` : ""}</div></section>`;
    return;
  }
  // no grade in the title: tabs, history and bookmarks show it without the "ours, not official" wording
  document.title = `${p.name} · ${p.placeLine} | Chi Ranked`;
  const saved = state.saved.has(p.id);
  const maps = L.mapsLink(p);
  let head = `<span class="kicker">${esc(p.placeLine)}</span><h1 class="pname">${esc(p.name)}</h1>
    <p class="paddr">${esc([p.addr, p.cuisine].filter((x) => x != null).join(" · "))}</p>${badgesHTML(p)}`;
  if (p.isChicago) {
    if (p.grade && p.score != null) {
      head += `<div class="pgrade">${gradeChip(p.grade)}<div><b>Inspection score ${p.score}/100</b><span>Our grade from City of Chicago inspection records, not an official city grade.</span></div></div>`;
    } else {
      head += `<p class="pnograde">No grade yet: no completed inspections since January 2023.${p.risk === 3 ? " The city inspects low-risk places about every two years." : ""}</p>`;
    }
  }
  if (state.geo.point && p.lat != null) {
    const m = L.distance(p, state.geo.point);
    if (m <= L.NEAR_RADIUS) { const lab = L.distLabel(m); head += `<p class="pdist">${icon("location")}${lab === "nearby" ? "Nearby" : esc(lab) + " away"}</p>`; }
  }
  const actions = [
    maps ? `<a class="act" href="${esc(maps)}" target="_blank" rel="noopener">${icon("directions")}<span>Directions</span><span class="sr"> (opens in a new tab)</span></a>` : "",
    p.web ? `<a class="act" href="${esc(p.web)}" target="_blank" rel="noopener nofollow">${icon("compass")}<span>Website</span><span class="sr"> (opens in a new tab)</span></a>` : "",
    `<button class="act" type="button" id="share">${icon("share")}<span>Share</span></button>`,
    // the app's labels: the name says what a tap does ("Remove from Saved"), so no pressed state to contradict it
    `<button class="act${saved ? " on" : ""}" type="button" id="save" aria-label="${saved ? "Remove from Saved" : "Save place"}">${icon("bookmark")}<span>${saved ? "Saved" : "Save"}</span></button>`,
  ].join("");
  let body = "";
  if (p.isChicago) {
    let insp = `<dl class="kv">` + kv("Inspections", L.Fmt.number(p.visits ?? 0)) + kv("Failed", L.Fmt.number(p.fails ?? 0))
      + kv("Passed with conditions", L.Fmt.number(p.passCond ?? 0)) + kv("Violations per visit", L.perVisit(p.violPer))
      + kv("Serious food-safety violations per visit", L.perVisit(p.seriousPer)) + kv("Pest citations (rodents or insects)", L.Fmt.number(p.pests ?? 0))
      + kv("Complaint-triggered inspections", L.Fmt.number(p.complaints ?? 0)) + `</dl>`;
    if ((p.complaints ?? 0) > 0) insp += noteP("Inspections the City made after someone complained. A complaint is not a finding, and many of these inspections pass.");
    // with a newer City result below, this one isn't the City's last inspection any more, only ours
    insp += `<dl class="kv">` + kv(p.newerResult == null ? "Last city inspection" : "Last inspection in our records", `${L.Fmt.date(p.lastDate)} · ${L.Fmt.result(p.lastResult)}`) + `</dl>`;
    if (p.newerResult != null && p.newerDate != null) {
      insp += `<div class="newer"><dl class="kv">${kv("Newer City result", `${L.Fmt.result(p.newerResult)}, ${L.Fmt.date(p.newerDate)}`)}</dl>`
        + noteP(`It's after our records date (${L.Fmt.date(d.recordsThrough)}), so it isn't in our score or grade yet.`) + `</div>`;
    }
    insp += `<dl class="kv">` + kv("City risk category", p.risk != null ? ["", "High", "Medium", "Low"][Math.min(Math.max(p.risk, 0), 3)] : "—") + `</dl>`;
    insp += noteP("Risk category is how often the City schedules inspections, based on the kind of food handling (High = most often). It is not a safety rating.");
    insp += noteP(`Source: City of Chicago Food Inspections, records through ${L.Fmt.date(d.recordsThrough)}. License #${p.id}. Scores weigh failed inspections, pest citations, serious violations, violations per visit, passes with conditions and whether the last visit failed; places with few visits are pulled toward the city average. Our score and grade are not official.`);
    insp += `<div class="extlinks"><a href="${esc(L.cityRecordsURL(p.id))}" target="_blank" rel="noopener">${icon("external")}City inspection records<span class="sr"> (opens in a new tab)</span></a>`
      + `<a href="${esc(L.reportURL(p))}">${icon("mail")}Report a problem with this listing</a></div>`;
    body += section("Health inspections · since Jan 2023", insp);
    if (p.icon != null || p.isHonored || p.honors != null) {
      const list = L.honorsList(p);
      body += section("Honors & history", (p.icon != null ? `<p class="icon-text">${esc(p.icon)}</p>` : "")
        + (list.length ? `<ul role="list" class="honors">${list.map((h) => `<li>${icon("rosette")}<span>${esc(h)}</span></li>`).join("")}</ul>` : ""));
    }
    body += section("License", `<dl class="kv">` + (p.aka != null ? kv("Also on City records as", p.aka) : "")
      + kv(p.sinceVerified ? "Opened" : "First city record", p.sinceFloor ? "2002 or earlier" : p.since != null ? String(p.since) : "—")
      + kv("Serves alcohol", L.yesNo(p.liquor)) + kv("Outdoor patio license", L.yesNo(p.patio)) + kv("Late-hour license", L.yesNo(p.late))
      + kv("Dining room", p.dineIn === true ? "Yes" : p.dineIn === false ? "Takeout only" : "—")
      + kv("Locations in Chicago", p.chain >= 2 ? L.Fmt.number(p.chain) : "This one only") + `</dl>`);
    let prop;
    if (p.bldg != null) {
      prop = `<dl class="kv">` + kv("Estimated market value", (p.bldgExact === false ? "≈" : "") + L.Fmt.money(p.bldg))
        + (p.bldgClass != null ? kv("Property type", L.propertyClass(p.bldgClass)) : "") + `</dl>`
        + noteP(p.bldgExact === false ? "The exact address has no parcel, so this is the nearest parcel on the same side of the block. It may not be this restaurant's building."
          : "Value of the whole property at this address (every parcel there), land and building. The restaurant may be one tenant of many.");
    } else prop = noteP("No taxable parcel matched this address (often airports, parks, city-owned property, or a mismatch in the address records).");
    body += section("Property · Cook County Assessor 2025", prop);
    if (p.sales != null) {
      body += section("Published sales", `<dl class="kv">` + kv("Yearly sales", L.Fmt.money(p.sales)) + (p.salesYear != null ? kv("Year", String(p.salesYear)) : "") + `</dl>`
        + noteP(p.salesLabel != null ? `Source: ${p.salesLabel}.` : "Published figure."));
    }
  } else {
    body += section("Listing", `<dl class="kv">` + kv("Town", p.city) + (p.zip != null ? kv("ZIP", p.zip) : "") + kv("Cuisine", p.cuisine)
      + kv("Locations in Illinois", p.chain >= 2 ? L.Fmt.number(p.chain) : "This one only")
      + (p.venue ? kv("Kind of place", "Not mainly a restaurant (gas station, grocery counter, gaming café or similar)") : "") + `</dl>`
      + noteP("Outside Chicago there's no public statewide inspection data, so this place has no grade. It comes from Overture Maps listings, which can include places that have closed. In a check against Chicago's records, about 7 in 10 of these listings matched a restaurant the City currently inspects. Check before you go.")
      + `<div class="extlinks"><a href="${esc(L.reportURL(p))}">${icon("mail")}Report a problem with this listing</a></div>`);
  }
  view.innerHTML = `<article class="view place"><div class="pgrid">
    <div class="phead"><p class="back"><button class="linkbtn" type="button" id="back">${icon("back")}<span>Back</span></button></p>${head}</div>
    <div class="pside"><div class="actions">${actions}</div>
      ${p.lat != null ? `<a class="locator" href="${mapHash(p.isChicago ? "chicago" : "illinois", null, p.id)}" aria-label="See on map: ${esc(p.name)}"><canvas id="loc" aria-hidden="true"></canvas><span>See on map</span></a>` : ""}</div>
    <div class="pbody">${body}</div>
  </div></article>`;
  // back within this site only: an entry opened from another site (or a shared link) goes to the lists instead
  $("#back").onclick = () => { if (nav.depth > 0) history.back(); else go("#/"); };
  $("#save").onclick = () => {
    const stored = toggleSaved(p.id), s = state.saved.has(p.id), b = $("#save");
    b.classList.toggle("on", s); b.setAttribute("aria-label", s ? "Remove from Saved" : "Save place"); b.querySelector("span").textContent = s ? "Saved" : "Save";
    toast(stored ? (s ? "Saved in this browser" : "Removed from Saved")
      : s ? "Saved for this visit only (this browser blocks site storage)" : "Removed for this visit only (this browser blocks site storage)");
  };
  $("#share").onclick = async () => {
    const url = location.href;
    if (navigator.share) { try { await navigator.share({ title: p.name, text: L.shareText(p), url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch {        // no clipboard access: show the link to copy by hand
      let box = $("#sharebox");
      if (!box) { box = document.createElement("p"); box.id = "sharebox"; box.className = "note"; $("#share").closest(".actions").after(box); }
      box.innerHTML = `<label for="shareurl">Copy this link:</label> <input id="shareurl" class="fsel" readonly value="${esc(url)}">`;
      const inp = $("#shareurl"); inp.focus(); inp.select();
    }
  };
  if (p.lat != null) drawLocator($("#loc"), p);
}
/** Returns whether this browser kept it (false: saved for this visit only). */
function toggleSaved(id) {
  const order = state.savedOrder.filter((x) => x !== id);
  if (state.saved.has(id)) state.saved.delete(id); else { state.saved.add(id); order.unshift(id); }
  state.savedOrder = order.filter((x) => state.saved.has(x));
  return store.set("saved", state.savedOrder);
}
let toastTimer = null;
/** The status region is in the page from the start (empty), so a screen reader announces even the first message. */
function toast(msg) {
  const live = $("#toast");
  live.textContent = "";
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; live.appendChild(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { live.textContent = ""; }, 2200);
}

// ------------------------------------------------------------------------------------------------ saved (SavedAndAbout.swift SavedTab)
function viewSaved(view) {
  document.title = "Saved places | Chi Ranked";
  const ids = state.savedOrder;
  const hasIL = ids.some((id) => id.startsWith("il:"));
  if (hasIL && !state.il && !state.ilError) {
    view.innerHTML = `<section class="view"><h1 class="h1">Saved places</h1>${ilLoadingHTML("Loading your saved places…")}</section>`;
    afterIllinois(() => render({ keepFocus: true }));
    return;
  }
  const d = D();
  // with the rest of Illinois not loaded, its saved places are unknown, not missing
  const unknownIL = hasIL && !state.il ? ids.filter((id) => id.startsWith("il:")).length : 0;
  const places = ids.map((id) => d.byId.get(id)).filter(Boolean);
  const missing = ids.length - places.length - unknownIL;
  let html = `<section class="view"><h1 class="h1">Saved places</h1>`;
  if (unknownIL) {
    html += `<div class="panel-note" role="alert"><p>${unknownIL === 1 ? "1 saved place outside Chicago" : `${n(unknownIL)} saved places outside Chicago`} couldn't be shown: the restaurants across the rest of Illinois didn't load. ${state.ilError === "missing" ? "Please try again later." : "Check your connection and try again."}</p>
      <div class="row"><button class="btn small" type="button" data-retry-il>Try again</button></div></div>`;
  }
  if (!places.length && !unknownIL) html += `<div class="empty">${icon("bookmark")}<h2>No saved places yet</h2><p>Tap Save on any restaurant to keep it here. Saved places stay in this browser.</p><div class="row"><a class="btn solid" href="#/">Browse the rankings</a></div></div>`;
  else if (places.length) {
    if (places.some((p) => p.grade != null || p.score != null)) html += `<p class="cap">${GRADES_CAPTION}</p>`;
    html += `<ol role="list" class="rlist">${places.map((p) => searchRow(p, state.geo.point ? L.distance(p, state.geo.point) : null,
      `<button class="linkbtn srm" type="button" data-remove="${esc(p.id)}" aria-label="Remove ${esc(p.name)} from Saved">Remove</button>`)).join("")}</ol>`;
    html += `<p class="cap">Saved places stay in this browser. Nothing is sent anywhere.</p>`;
  }
  if (missing > 0) html += `<p class="cap">${missing === 1 ? "1 saved place isn't" : `${n(missing)} saved places aren't`} in the current data. ${missing === 1 ? "It comes" : "They come"} back here if a later update lists ${missing === 1 ? "it" : "them"} again.</p>`;
  view.innerHTML = html + `</section>`;
  view.querySelectorAll(".srow-li").forEach((li) => { li.style.display = "flex"; li.style.alignItems = "center"; li.firstElementChild.style.flex = "1"; li.firstElementChild.style.minWidth = "0"; });
  view.firstElementChild.addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (!b) return;
    const stored = toggleSaved(b.dataset.remove);
    render({ keepFocus: true });
    const next = $("#view [data-remove]") || $("#view h1"); if (next) { if (next.tagName === "H1") next.setAttribute("tabindex", "-1"); next.focus(); }
    if (!stored) toast("Removed for this visit only (this browser blocks site storage)");
  });
}

// ------------------------------------------------------------------------------------------------ about (SavedAndAbout.swift AboutView)
function viewAbout(view) {
  document.title = "About, sources and privacy | Chi Ranked";
  const d = D();
  const through = d ? L.Fmt.date(d.recordsThrough) : state.manifest?.records_through ? L.Fmt.date(state.manifest.records_through) : null;
  const release = d && d.overtureRelease ? `, release ${esc(d.overtureRelease)}` : "";
  view.innerHTML = `<article class="view about">
    <span class="kicker">About</span>
    <h1 class="h1">Chicago Restaurants: Ranked</h1>
    <p class="strong">Independent app. Not affiliated with or endorsed by the City of Chicago, the Chicago Department of Public Health or Cook County.</p>
    <p>Nearly every restaurant, bakery, café and tavern the City of Chicago inspects, ranked on public records: health inspections, licenses, property values and honors. Plus a directory of restaurants across the rest of Illinois.</p>
    <p>This is the web version of the free iPhone and iPad app, reading the same data.</p>
    <section><h2>Independent app</h2>
      <p>Chicago Restaurants: Ranked (“Chi Ranked”) is an independent app by Nicholas Soderstrom. It is not affiliated with, endorsed by or operated by the City of Chicago, the Chicago Department of Public Health or Cook County.</p></section>
    <section><h2>Our grades</h2>
      <p>The 0–100 inspection score and A–F grade are calculated by this app from City of Chicago food inspection records since January 2023. They are our assessment, not official City of Chicago grades. The City reports each inspection as Pass, Pass w/ Conditions or Fail and does not issue letter grades. An inspection describes conditions on the day of the visit. For the official record, tap “City inspection records” on any Chicago place.</p>
      <p>The score weighs failed inspections, pest citations, serious food-safety violations, violations per visit, passes with conditions, and whether the last visit failed. Places with few inspections are pulled toward the city average. An F needs a failed inspection or pests; an A needs no failures.</p>
      <p class="fine">Each ranking explains how it's built under “How it's ranked”. <a href="../chicago-restaurant-grades.html">More on what the grades mean</a>.</p></section>
    <section><h2>City of Chicago</h2>
      <p class="fine">This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago. The City of Chicago makes no claims as to the content, accuracy, timeliness, or completeness of any of the data provided at this site. The data provided at this site is subject to change at any time. It is understood that the data provided at this site is being used at one’s own risk.</p>
      <p class="fine">Data used: Food Inspections (data.cityofchicago.org, dataset 4ijn-s7e5) and Business Licenses (datasets r5kz-chrr and uupf-x98q)${through ? `, records through ${esc(through)}` : ""}.</p>
      <blockquote>About the inspection data, from the City’s Food Inspections dataset: “Attempts have been made to minimize any and all duplicate inspection reports. However, the dataset may still contain such duplicates and the appropriate precautions should be exercised when viewing or analyzing these data. The result of the inspections (pass, pass with conditions or fail) as well as the violations noted are based on the findings identified and reported by the inspector at the time of the inspection, and may not reflect the findings noted at other times.”</blockquote></section>
    <section><h2>Data updates</h2>
      <p>${through ? `City records through ${esc(through)}. ` : ""}About once a week we rebuild the data from the City’s newest public records and publish it on this site; the iPhone app and this page read the same files. Your browser downloads them from this site, and the request carries nothing about you.</p></section>
    <section><h2>Cook County Assessor</h2>
      <p class="fine">Property values are estimates for the whole property at the address. Each one is the Cook County Assessor’s 2025 assessed value, as certified by the Cook County Board of Review, divided by the Assessor’s level of assessment for its property class. The source is Cook County Open Data (datacatalog.cookcountyil.gov). These are not sale prices or the value of the restaurant business, and they have been modified from the original source. Cook County makes no warranty as to the data’s accuracy, completeness or timeliness, and does not endorse this app.</p></section>
    <section><h2>Overture Maps Foundation</h2>
      <p class="fine">Restaurant websites, and the directory of places elsewhere in Illinois, come from Overture Maps Foundation places data (overturemaps.org)${release}, filtered and reformatted for this app.</p>
      <ul class="fine"><li>Data from Meta, Microsoft, PinMeTo, Krick, RenderSEO, DAC and BrightQuery. Available under CDLA Permissive 2.0.</li>
        <li>Data from Foursquare. Copyright 2024 Foursquare Labs, Inc. All rights reserved. Available under Apache 2.0. Foursquare data was transformed to the Overture schema. Changed: 2026-03-18. This app further filtered and reformatted it. See the NOTICE under Licenses.</li>
        <li>Data from AllThePlaces. Available under CC0 1.0.</li></ul></section>
    <section><h2>Honors and published figures</h2>
      <p class="fine">Michelin Guide Chicago 2025 distinctions (stars, Bib Gourmand, Green Star), James Beard Foundation awards and America’s Classics, and the other honors shown are reported as facts and checked by hand against public announcements. Sales figures are as published by Restaurant Business (Top 100 Independents); “estimate” marks figures the publisher estimated. Opening years come from verified histories or, where marked, the earliest City license or inspection record. City records begin in 2002.</p>
      <p class="fine">MICHELIN, MICHELIN Guide and Bib Gourmand are trademarks of Michelin. James Beard Foundation and James Beard Award are trademarks of the James Beard Foundation. Other names belong to their owners. This app is not affiliated with or endorsed by any of them.</p></section>
    <section><h2>Maps</h2>
      <p class="fine">The map is drawn in your browser from two outline files: Chicago’s community areas from the City of Chicago Data Portal (Boundaries, Community Areas), and the Illinois and county outlines from Overture Maps Foundation divisions data, © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a>, available under the Open Database License (ODbL). No map tiles are loaded from anyone. Directions open in Apple Maps.</p></section>
    <section><h2>Licenses</h2>
      <p class="fine"><a href="../data/v1/NOTICE.txt">Data licenses and notices (NOTICE.txt)</a>: the attributions above, the Community Data License Agreement – Permissive 2.0, the Apache License 2.0 and the Foursquare OS Places NOTICE.</p></section>
    <section><h2>Privacy</h2>
      <p>No account, no ads, no cookies, no analytics, no tracking. Saved places stay in this browser’s storage. Your location is used only when you tap Near me or Show my location: it sorts places and centers the map in your browser, and it’s never stored or sent anywhere. This page loads nothing from other companies: no fonts, maps or scripts from third parties.</p>
      <p><a href="../privacy.html">Privacy policy</a></p></section>
    <section><h2>Help</h2>
      <p><a href="mailto:nick@eatsranked.com?subject=Chi%20Ranked">Email support</a>: nick@eatsranked.com</p>
      <p><a href="../support.html">Report a wrong or outdated listing</a> · <a href="../terms.html">Terms of use</a> · <a href="../">Website</a></p></section>
    <p class="cap">${through ? `Data through ${esc(through)}.` : ""}</p>
  </article>`;
}

// ------------------------------------------------------------------------------------------------ outlines
let shapesPromise = null;
function loadShapes() {
  shapesPromise ||= fetch("shapes.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((s) => {
    if (!s) return { areas: [], illinois: [], counties: [] };
    for (const a of s.areas) {       // label point: the middle of the biggest ring's bounding box, nudged inside by averaging
      let best = null;
      for (const r of a.r) if (!best || r.length > best.length) best = r;
      a.bbox = bbox(a.r.flat());
      a.label = best ? [best.reduce((t, q) => t + q[0], 0) / best.length, best.reduce((t, q) => t + q[1], 0) / best.length] : null;
    }
    return s;
  });
  return shapesPromise;
}
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
const LAT0 = { chicago: 41.84, illinois: 40.0 };
const LAND = "#EEF2F7", WATER = "#D5E5F4";
/** Lake Michigan over the outlines (they run to the state line out in the lake), with a thin shoreline. */
function drawLake(c, s, ring) {
  if (!s.lake || !s.lake.length) return;
  c.beginPath(); ring(s.lake); c.fillStyle = WATER; c.fill();
  c.strokeStyle = "rgba(14, 51, 134, .18)"; c.lineWidth = 1; c.stroke();
}
const BOUNDS = { chicago: [-87.945, 41.643, -87.523, 42.024], illinois: [-91.52, 36.97, -87.49, 42.51] };

/** The small locator on a place page: the city (or state) with the place's community area and a dot. */
async function drawLocator(cv, p) {
  const s = await loadShapes();
  if (!cv.isConnected) return;
  const scope = p.isChicago ? "chicago" : "illinois";
  const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const c = cv.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const kx = Math.cos(LAT0[scope] * Math.PI / 180);
  const [bx0, by0, bx1, by1] = BOUNDS[scope];
  const k = Math.min(w / ((bx1 - bx0) * kx), h / (by1 - by0)) * 0.9;
  const ox = w / 2 - ((bx0 + bx1) / 2) * kx * k, oy = h / 2 + ((by0 + by1) / 2) * k;
  const X = (lo, la) => [lo * kx * k + ox, -la * k + oy];
  const ring = (r) => { r.forEach(([lo, la], i) => { const [x, y] = X(lo, la); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath(); };
  c.fillStyle = LAND; c.fillRect(0, 0, w, h);
  if (scope === "chicago") {
    drawLake(c, s, ring);
    for (const a of s.areas) { c.beginPath(); a.r.forEach(ring); c.fillStyle = a.n === p.hood ? "#CDE8F7" : "#fff"; c.fill(); c.strokeStyle = a.n === p.hood ? BLUE : "#C9D5EA"; c.lineWidth = a.n === p.hood ? 1.4 : 0.7; c.stroke(); }
  } else {
    c.beginPath(); s.illinois.forEach(ring); c.fillStyle = "#fff"; c.fill(); c.strokeStyle = "#B8C6E0"; c.lineWidth = 1; c.stroke();
    drawLake(c, s, ring);
    c.beginPath(); s.areas.forEach((a) => a.r.forEach(ring)); c.fillStyle = "#E3EAF7"; c.fill();
  }
  const [x, y] = X(p.lon, p.lat);
  c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fillStyle = "rgba(204,52,51,.18)"; c.fill();
  c.beginPath(); c.arc(x, y, 5.5, 0, Math.PI * 2); c.fillStyle = p.grade ? GRADE_FILL[p.grade] : MUTED; c.fill(); c.lineWidth = 2; c.strokeStyle = "#fff"; c.stroke();
}

// ------------------------------------------------------------------------------------------------ map (MapTab.swift, drawn on a canvas)
function viewMap(view, route) {
  const d = D();
  const scope = route.params.get("scope") === "illinois" ? "illinois" : "chicago";
  const f = filtersFromParams(route.params, scope);
  let focus = route.params.get("focus");
  if (scope === "illinois" && !state.il) {
    view.innerHTML = `<section class="view mapview"><h1 class="h1">Map</h1>${state.ilError ? ilErrorHTML() : ilLoadingHTML()}</section>`;
    // once: a failure stays put until Try again, so this never loops
    if (!state.ilError) afterIllinois(() => render({ keepFocus: true }));
    return;
  }
  document.title = `Map · ${scope === "chicago" ? "Chicago" : "Rest of Illinois"} | Chi Ranked`;
  const places = (scope === "chicago" ? d.chicago : d.illinois).filter((p) => L.passes(f, p) && p.lat != null && p.lon != null);
  const legend = scope === "chicago"
    ? `${plural(places.length, "place", "places")}. Dot color = our A–F grade from City inspection records (not official). Gray = no grade.`
    : `${n(places.length)} map ${places.length === 1 ? "listing" : "listings"}. No inspection data outside Chicago, so no grades.`;
  view.innerHTML = `<section class="view mapview">
    <h1 class="sr">Map of ${scope === "chicago" ? "Chicago" : "the rest of Illinois"}</h1>
    <div class="mhead"><div class="legend"><p style="margin:0">${esc(legend)}</p>
      ${scope === "chicago" ? `<ul class="keys" aria-hidden="true">${L.GRADES_ORDER.map((g) => `<li><i style="background:${GRADE_FILL[g]}"></i>${g}</li>`).join("")}<li><i style="background:${MUTED}"></i>No grade</li></ul>` : ""}</div>
      ${filterButton(f, state.filtersOpen)}</div>
    <div class="fpanel" id="mpanel"${state.filtersOpen ? "" : " hidden"}>${filtersPanel(scope, f, { count: places.length })}</div>
    <div class="mapbox" id="mapbox">
      <canvas id="map" tabindex="0" role="img" aria-label="Map of ${scope === "chicago" ? "Chicago's community areas" : "Illinois"} with a dot for each of ${esc(plural(places.length, "place", "places"))}. Drag or use the arrow keys to move, plus and minus to zoom. Select a dot to see the place; Search lists the same places."></canvas>
      <div class="mctl">
        <button type="button" data-z="in" aria-label="Zoom in">${icon("plus")}</button>
        <button type="button" data-z="out" aria-label="Zoom out">${icon("minus")}</button>
        <button type="button" data-z="all" aria-label="${scope === "chicago" ? "Show all of Chicago" : "Show all of Illinois"}">${icon("expand")}</button>
        <button type="button" data-z="me" aria-label="Show my location">${icon("location")}</button>
      </div>
      <div class="mnote" id="mnote" role="status" hidden></div>
      <p class="mcredit">${scope === "chicago" ? "Community areas: City of Chicago" : `Outlines © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> contributors, via Overture Maps`}</p>
      <div class="mcard" id="mcard" hidden></div>
    </div>
  </section>`;
  const panel = $("#mpanel");
  bindFilters(panel, () => f, (g) => {
    const a = document.activeElement, key = a && a.dataset ? [a.dataset.f, a.dataset.v] : null;
    state.mapSel = null; state.mapStack = null; replaceHash(mapHash(scope, g)); render({ keepFocus: true });
    const again = key && key[0] ? $(`#mpanel [data-f="${key[0]}"]${key[1] ? `[data-v="${key[1]}"]` : ""}`) : null;
    if (again) again.focus(); else { const b = $("#mpanel [data-f]"); if (b) b.focus(); }
  }, () => { state.filtersOpen = false; panel.hidden = true; const b = view.querySelector("[data-toggle-filters]"); b.setAttribute("aria-expanded", "false"); b.focus(); });
  view.querySelector("[data-toggle-filters]").onclick = (e) => {
    state.filtersOpen = !state.filtersOpen; panel.hidden = !state.filtersOpen; e.currentTarget.setAttribute("aria-expanded", String(state.filtersOpen)); syncSheet();
    if (state.filtersOpen && phone.matches) panel.querySelector("button, select, input").focus();
  };

  const cv = $("#map"), box = $("#mapbox");
  // On a phone the map fills the space between its header and the tab bar, so the place card (at its bottom) is never
  // under the tab bar. Measured, because the header's height varies with the text size.
  const fitBox = () => {
    if (!phone.matches) { box.style.height = ""; return; }
    const tabs = document.querySelector(".tabs");
    const top = box.getBoundingClientRect().top + window.scrollY;
    const bar = tabs && getComputedStyle(tabs).position === "fixed" ? tabs.getBoundingClientRect().height : 0;
    box.style.height = Math.max(260, Math.floor(window.innerHeight - top - bar - 10)) + "px";
  };
  fitBox();
  window.addEventListener("resize", fitBox);
  const kx = Math.cos(LAT0[scope] * Math.PI / 180);
  const xs = new Float64Array(places.length), ys = new Float64Array(places.length);
  places.forEach((p, i) => { xs[i] = p.lon * kx; ys[i] = -p.lat; });
  // draw order: no grade first, then A to F, so every graded dot is drawn over the gray ones
  const order = { A: 1, B: 2, C: 3, D: 4, F: 5 };
  const idx = places.map((_, i) => i).sort((a, b) => (order[places[a].grade] || 0) - (order[places[b].grade] || 0));
  let shapes = null, W = 0, H = 0, dpr = 1, kFit = 1, cam = null, raf = 0;
  const fit = () => {
    const [bx0, by0, bx1, by1] = BOUNDS[scope];
    const k = Math.min(W / ((bx1 - bx0) * kx), H / (by1 - by0)) * 0.94;
    return { k, x: W / 2 - ((bx0 + bx1) / 2) * kx * k, y: H / 2 + ((by0 + by1) / 2) * k };
  };
  const resize = () => {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const had = cam && W ? [(W / 2 - cam.x) / cam.k, (H / 2 - cam.y) / cam.k] : null;
    W = w; H = h; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    kFit = fit().k;
    if (!cam) cam = state.mapCam[scope] && state.mapCam[scope].w ? rescale(state.mapCam[scope]) : fit();
    else if (had) cam = { k: cam.k, x: W / 2 - had[0] * cam.k, y: H / 2 - had[1] * cam.k };
    schedule();
  };
  const rescale = (saved) => ({ k: saved.k, x: W / 2 - saved.cx * saved.k, y: H / 2 - saved.cy * saved.k });
  const remember = () => { state.mapCam[scope] = { k: cam.k, cx: (W / 2 - cam.x) / cam.k, cy: (H / 2 - cam.y) / cam.k, w: W }; };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  // dot size grows with zoom; a small screen starts smaller, so the whole city isn't one blur of dots
  const radius = () => {
    const z = cam.k / kFit, fitScale = Math.sqrt(Math.min(1, kFit / (scope === "chicago" ? 2000 : 135)));
    const base = scope === "chicago" ? Math.max(1.5, 2.3 * fitScale) : Math.max(1.2, 1.7 * fitScale);
    return scope === "chicago" ? Math.min(11, Math.max(base, base * Math.pow(z, 0.62))) : Math.min(9, Math.max(base, base * Math.pow(z, 0.5)));
  };
  function draw() {
    if (!cam) return;
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = LAND; c.fillRect(0, 0, W, H);
    const X = (lo, la) => [lo * kx * cam.k + cam.x, -la * cam.k + cam.y];
    const ring = (r) => { for (let i = 0; i < r.length; i++) { const x = r[i][0] * kx * cam.k + cam.x, y = -r[i][1] * cam.k + cam.y; if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.closePath(); };
    if (shapes) {
      if (scope === "chicago") {
        drawLake(c, shapes, ring);
        c.beginPath(); shapes.areas.forEach((a) => a.r.forEach(ring)); c.fillStyle = "#fff"; c.fill();
        c.strokeStyle = "#C9D5EA"; c.lineWidth = 0.8; c.stroke();
        const z = cam.k / kFit;
        c.textAlign = "center"; c.textBaseline = "middle";
        if (z > 1.6) {
          c.font = `600 ${Math.min(13, 9 + z)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
          c.fillStyle = "rgba(82, 99, 138, .75)";
          for (const a of shapes.areas) {
            if (!a.label) continue;
            const [x, y] = X(a.label[0], a.label[1]);
            const bw = (a.bbox[2] - a.bbox[0]) * kx * cam.k;
            if (x < -80 || x > W + 80 || y < -20 || y > H + 20 || bw < c.measureText(a.n).width * 1.15) continue;
            c.fillText(a.n.toUpperCase(), x, y);
          }
        }
        const [lx, ly] = X(-87.57, 41.93);
        c.font = `italic 600 ${z > 3 ? 15 : 13}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; c.fillStyle = "rgba(14, 51, 134, .45)";
        if (lx + c.measureText("Lake Michigan").width / 2 < W - 62) c.fillText("Lake Michigan", lx, ly);
      } else {
        c.beginPath(); shapes.illinois.forEach(ring); c.fillStyle = "#fff"; c.fill();
        c.beginPath(); shapes.counties.forEach(ring); c.strokeStyle = "#E1E8F4"; c.lineWidth = 0.7; c.stroke();
        c.beginPath(); shapes.illinois.forEach(ring); c.strokeStyle = "#B8C6E0"; c.lineWidth = 1.2; c.stroke();
        drawLake(c, shapes, ring);
        c.beginPath(); shapes.areas.forEach((a) => a.r.forEach(ring)); c.fillStyle = "#E3EAF7"; c.fill();
      }
    }
    // dots: only what's on screen, one path per color
    const r = radius(), pad = r + 2;
    const x0 = (-pad - cam.x) / cam.k, x1 = (W + pad - cam.x) / cam.k, y0 = (-pad - cam.y) / cam.k, y1 = (H + pad - cam.y) / cam.k;
    let color = null, shown = 0;
    if (r < 8) {         // zoomed out: one path per color
      const flush = () => { if (color) { c.fillStyle = color; c.fill(); if (r >= 3) { c.lineWidth = r >= 6 ? 1.5 : 1; c.strokeStyle = "rgba(255,255,255,.95)"; c.stroke(); } } };
      c.beginPath();
      for (const i of idx) {
        const X0 = xs[i], Y0 = ys[i];
        if (X0 < x0 || X0 > x1 || Y0 < y0 || Y0 > y1) continue;
        const col = places[i].grade ? GRADE_FILL[places[i].grade] : MUTED;
        if (col !== color) { flush(); c.beginPath(); color = col; }
        const x = X0 * cam.k + cam.x, y = Y0 * cam.k + cam.y;
        c.moveTo(x + r, y); c.arc(x, y, r, 0, 6.2832);
        shown++;
      }
      flush();
    } else {             // zoomed in: each dot with its grade letter, like the app's pins (few are on screen by now)
      c.font = `900 ${Math.round(r * 1.15)}px "Avenir Next Condensed", "Arial Narrow", sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 1.5; c.strokeStyle = "rgba(255,255,255,.95)";
      for (const i of idx) {
        const X0 = xs[i], Y0 = ys[i];
        if (X0 < x0 || X0 > x1 || Y0 < y0 || Y0 > y1) continue;
        const p = places[i], x = X0 * cam.k + cam.x, y = Y0 * cam.k + cam.y;
        c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fillStyle = p.grade ? GRADE_FILL[p.grade] : MUTED; c.fill(); c.stroke();
        if (p.grade) { c.fillStyle = GRADE_TEXT[p.grade]; c.fillText(p.grade, x, y + 0.5); }
        shown++;
      }
    }
    if (scope === "illinois" && shapes) {     // over the dots, so the city's name stays readable
      const [cx, cy] = X(-87.95, 41.84);
      c.font = `700 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; c.textAlign = "right"; c.textBaseline = "middle";
      c.lineWidth = 4; c.strokeStyle = "rgba(255,255,255,.95)"; c.strokeText("Chicago", cx - 6, cy);
      c.fillStyle = BLUE; c.fillText("Chicago", cx - 6, cy);
    }
    const sel = state.mapSel;
    if (sel && sel.lat != null) {       // the selected place again on top, ringed
      const [x, y] = X(sel.lon, sel.lat);
      c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fillStyle = sel.grade ? GRADE_FILL[sel.grade] : MUTED; c.fill();
      c.lineWidth = 1.5; c.strokeStyle = "#fff"; c.stroke();
      if (sel.grade && r >= 8) { c.fillStyle = GRADE_TEXT[sel.grade]; c.fillText(sel.grade, x, y + 0.5); }
      c.beginPath(); c.arc(x, y, r + 7, 0, 6.2832); c.lineWidth = 3; c.strokeStyle = "#CC3433"; c.stroke();
    }
    if (state.geo.point) {
      const [x, y] = X(state.geo.point[1], state.geo.point[0]);
      c.beginPath(); c.arc(x, y, 14, 0, 6.2832); c.fillStyle = "rgba(0, 122, 255, .16)"; c.fill();
      c.beginPath(); c.arc(x, y, 6.5, 0, 6.2832); c.fillStyle = "#007AFF"; c.fill(); c.lineWidth = 2.5; c.strokeStyle = "#fff"; c.stroke();
    }
    cv.dataset.shown = String(shown);
  }
  const zoomAt = (factor, px, py) => {
    const k = Math.min(Math.max(cam.k * factor, kFit * 0.6), kFit * (scope === "chicago" ? 80 : 400));
    const s = k / cam.k;
    cam = { k, x: px - (px - cam.x) * s, y: py - (py - cam.y) * s };
    remember(); schedule();
  };
  const hit = (px, py) => {
    const r = radius(), lim = Math.max(12, r + 5);
    let best = -1, bd = lim * lim;
    for (let j = idx.length - 1; j >= 0; j--) {      // topmost first
      const i = idx[j];
      const x = xs[i] * cam.k + cam.x, y = ys[i] * cam.k + cam.y;
      const dd = (x - px) ** 2 + (y - py) ** 2;
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best < 0) return null;
    // places drawn on top of each other (one address, or zoomed far out) come back together, topmost first
    const bx = xs[best] * cam.k + cam.x, by = ys[best] * cam.k + cam.y, stack = [];
    for (let j = idx.length - 1; j >= 0; j--) {
      const i = idx[j];
      if ((xs[i] * cam.k + cam.x - bx) ** 2 + (ys[i] * cam.k + cam.y - by) ** 2 <= 9) stack.push(places[i]);
    }
    return stack.length > 1 ? stack : places[best];
  };
  // the selected dot mustn't sit under the card: move the map so it's in the middle of the space above it
  const keepVisible = (p) => {
    const card = $("#mcard");
    if (!p || p.lat == null || card.hidden || !cam) return;
    const x = p.lon * kx * cam.k + cam.x, y = -p.lat * cam.k + cam.y, r = radius() + 10;
    const top = card.offsetTop, left = card.offsetLeft, right = left + card.offsetWidth;
    if (y + r <= top || x + r < left || x - r > right) return;
    cam = { ...cam, y: cam.y + (Math.max(r + 6, top / 2) - y) };
    remember(); schedule();
  };
  const showCard = (p) => {
    const card = $("#mcard");
    // a shared "focus" link picks the first card only: once you pick something else, coming back shows your pick
    if (focus && !(p && !Array.isArray(p) && p.id === focus)) { focus = null; replaceHash(mapHash(scope, f)); }
    if (Array.isArray(p)) {
      state.mapSel = p[0]; state.mapStack = p;
      const more = p.length - 8;
      card.innerHTML = `<div class="mtop"><div><h2>${n(p.length)} places here</h2><p>Drawn on top of each other on the map.</p></div><button class="close" type="button" aria-label="Close">${icon("close")}</button></div>
        <ul role="list" class="mstack">${p.slice(0, 8).map((x) => `<li><a href="${placeHref(x)}">${x.grade ? gradeChip(x.grade, "gt") : `<span class="tile">${icon("fork")}</span>`}<span>${esc(x.name)}${x.score != null ? ` <small>${x.score}</small>` : ""}</span></a></li>`).join("")}</ul>
        ${more > 0 ? `<p class="cap">and ${n(more)} more. Zoom in to see them apart.</p>` : ""}${p.some((x) => x.grade) ? `<p class="cap">Our grades from City inspection records, not official City grades.</p>` : ""}`;
      card.hidden = false; box.classList.add("carded");
      card.querySelector(".close").onclick = () => { showCard(null); cv.focus(); };
      keepVisible(p[0]);
      schedule();
      return;
    }
    state.mapSel = p; state.mapStack = null;
    if (!p) { card.hidden = true; box.classList.remove("carded"); schedule(); return; }
    const sub = p.grade ? `Grade ${p.grade} · ${p.score ?? 0}/100` : p.cuisine;
    card.innerHTML = `<div class="mtop">${p.grade ? gradeChip(p.grade, "gt") : `<span class="tile">${icon("fork")}</span>`}<div><h2>${esc(p.name)}</h2><p>${esc(sub)}</p><p>${esc([p.addr, p.placeLine].filter((x) => x != null).join(" · "))}</p></div>
      <button class="close" type="button" aria-label="Close">${icon("close")}</button></div>
      ${p.grade ? `<p class="cap" style="margin-top:6px">Our grade from City inspection records, not an official City grade.</p>` : ""}
      <div class="row"><a class="btn solid small" href="${placeHref(p)}">Open place</a>${L.mapsLink(p) ? `<a class="btn small" href="${esc(L.mapsLink(p))}" target="_blank" rel="noopener">Directions<span class="sr"> (opens in a new tab)</span></a>` : ""}</div>`;
    card.hidden = false; box.classList.add("carded");
    card.querySelector(".close").onclick = () => { showCard(null); cv.focus(); };
    keepVisible(p);
    schedule();
  };
  const note = (text) => { const el = $("#mnote"); state.mapNote = text; if (!text) { el.hidden = true; return; } el.innerHTML = `<span style="flex:1">${esc(text)}</span><button type="button" aria-label="Dismiss">${icon("close")}</button>`; el.hidden = false; el.querySelector("button").onclick = () => note(null); };
  const flyTo = (lat, lon, meters) => {
    const k = Math.min(W, H) / (meters / 111000);
    cam = { k: Math.min(Math.max(k, kFit * 0.6), kFit * (scope === "chicago" ? 80 : 400)), x: 0, y: 0 };
    cam.x = W / 2 - lon * kx * cam.k; cam.y = H / 2 + lat * cam.k;
    remember(); schedule();
  };
  // Show my location: MapTab.goTo, including switching areas when most places around you are in the other one
  const goToMe = () => {
    const pt = state.geo.point;
    if (!pt) return;
    const found = L.nearest(D(), pt);
    if (!found || found.m > L.NEAR_RADIUS) {
      const away = found ? `about ${n(Math.round(found.m / 1609.344))} miles from Illinois` : "outside Illinois";
      note(`You're ${away}, so the map stays on ${scope === "chicago" ? "Chicago" : "the rest of Illinois"}. It covers Chicago and the rest of Illinois.`);
      schedule(); return;
    }
    const { chicago: nc, illinois: ni } = L.areaCounts(D(), pt, 800);
    const area = nc + ni === 0 ? (found.p.isChicago ? "chicago" : "illinois") : nc === ni ? scope : nc > ni ? "chicago" : "illinois";
    const meters = Math.max(1600, found.m * 2.5);
    if (area !== scope) {
      state.pendingFly = { pt, meters, note: area === "chicago" ? "Most places near you are in Chicago, so the map switched to Chicago." : "Most places near you are outside Chicago, so the map switched to Rest of Illinois." };
      go(mapHash(area, null));
      return;
    }
    flyTo(pt[0], pt[1], meters);
  };
  // pointer: drag to pan, pinch to zoom, tap a dot
  const ptrs = new Map();
  let moved = false, pinch = null, downAt = null;
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = false; pinch = null; downAt = [e.clientX, e.clientY]; cv.classList.add("dragging"); });
  cv.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], dist = Math.hypot(a[0] - b[0], a[1] - b[1]), rc = cv.getBoundingClientRect();
      if (pinch) zoomAt(dist / pinch, (a[0] + b[0]) / 2 - rc.left, (a[1] + b[1]) / 2 - rc.top);
      pinch = dist; moved = true; return;
    }
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) moved = true;
    if (moved) { cam.x += e.clientX - prev[0]; cam.y += e.clientY - prev[1]; remember(); schedule(); }
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (!ptrs.size) cv.classList.remove("dragging");
    if (!moved && !ptrs.size && e.type === "pointerup") { const rc = cv.getBoundingClientRect(); showCard(hit(e.clientX - rc.left, e.clientY - rc.top)); }
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rc = cv.getBoundingClientRect();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022)), e.clientX - rc.left, e.clientY - rc.top);
  }, { passive: false });
  cv.addEventListener("dblclick", (e) => { const rc = cv.getBoundingClientRect(); zoomAt(2, e.clientX - rc.left, e.clientY - rc.top); });
  cv.addEventListener("keydown", (e) => {
    const step = 60;
    const k = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (k) { e.preventDefault(); cam.x += k[0]; cam.y += k[1]; remember(); schedule(); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(1.5, W / 2, H / 2); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAt(1 / 1.5, W / 2, H / 2); }
    else if (e.key === "Escape" && state.mapSel) showCard(null);
  });
  view.querySelector(".mctl").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-z]");
    if (!b) return;
    const z = b.dataset.z;
    if (z === "in") zoomAt(1.6, W / 2, H / 2);
    else if (z === "out") zoomAt(1 / 1.6, W / 2, H / 2);
    else if (z === "all") { cam = fit(); remember(); note(null); schedule(); }
    else if (z === "me") {
      note(null);
      if (state.geo.status === "ok") { goToMe(); return; }
      note("Finding you…");
      requestLocation(() => { note(null); goToMe(); });
    }
  });
  state.onGeo = () => {
    const s = state.geo.status;
    if (s === "denied") note("Location is off for this site. You can still browse by neighborhood or search a ZIP code, or allow location for this site in your browser's settings.");
    else if (s === "failed") note("Couldn't find your location. Check that you have a signal and try again, or browse by neighborhood or search a ZIP code.");
    else if (s === "unsupported") note("This browser can't share its location.");
    schedule();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(box);
  state.cleanup = () => { ro.disconnect(); window.removeEventListener("resize", fitBox); if (raf) cancelAnimationFrame(raf); state.onGeo = null; };
  resize();
  if (!cam) cam = fit();
  loadShapes().then((s) => { shapes = s; schedule(); });
  if (state.pendingFly) { const pf = state.pendingFly; state.pendingFly = null; flyTo(pf.pt[0], pf.pt[1], pf.meters); note(pf.note); }
  else if (state.mapNote) note(state.mapNote);
  if (focus) {
    const p = places.find((x) => x.id === focus) || d.byId.get(focus);
    if (p && p.lat != null) { flyTo(p.lat, p.lon, 3200); showCard(p); }
  } else if (state.mapStack && state.mapStack.every((x) => places.includes(x))) showCard(state.mapStack);    // back to the "N places here" card
  else if (state.mapSel && places.includes(state.mapSel)) showCard(state.mapSel);
  else { state.mapSel = null; state.mapStack = null; }
}

// ------------------------------------------------------------------------------------------------ boot
const VIEWS = { home: viewHome, board: viewBoard, search: viewSearch, place: viewPlace, map: viewMap, saved: viewSaved, about: viewAbout };
async function boot() {
  try { history.scrollRestoration = "manual"; } catch { /* old browsers: fine */ }
  const st = history.state;
  if (st && st.k) { nav.key = st.k; nav.depth = st.d || 0; } else { nav.key = newKey(); history.replaceState({ k: nav.key, d: 0 }, ""); }
  nav.route = isRouteHash(location.hash) ? location.hash : "#/";
  // pieces the views share: the toast's status region (in the page from the start, so its first message is announced)
  // and the scrim behind a phone's filters sheet
  const live = document.createElement("div"); live.id = "toast"; live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); document.body.appendChild(live);
  const scrim = document.createElement("div"); scrim.id = "scrim"; scrim.className = "scrim"; scrim.hidden = true; document.body.appendChild(scrim);
  scrim.addEventListener("click", () => { if (state.closeSheet) state.closeSheet(); });
  // on a phone, keep a focused element clear of the tab bar: app.css's scroll-padding does it where the browser honors it
  // for focus; elsewhere (Safari) a small element still behind the bar after the browser's own scroll is nudged above it
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!phone.matches || !el.closest || el.closest(".tabs, .fpanel")) return;
    requestAnimationFrame(() => {
      const bar = $(".tabs").getBoundingClientRect().top, r = el.getBoundingClientRect();
      if (r.bottom > bar && r.top < innerHeight && r.height < bar / 2) window.scrollBy(0, r.bottom - bar + 16);
    });
  });
  wireHeader();
  // Skip to content: focus the content, never route (the router would read "#main" as a page)
  $(".skip").addEventListener("click", (e) => { e.preventDefault(); $("#main").focus(); });
  // Try again after the rest of Illinois failed: anywhere it's offered
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-retry-il]")) return;
    state.ilError = null;
    render({ keepFocus: true });
    focusHeading($("#view"));
  });
  window.addEventListener("hashchange", (e) => {
    if (!isRouteHash(location.hash)) {           // an in-page anchor, not a route: stay here, and keep the route in the address bar
      history.replaceState({ k: nav.key, d: nav.depth }, "", nav.route);
      return;
    }
    saveView();
    const s = history.state;
    let restore = null;
    if (s && s.k) { nav.key = s.k; nav.depth = s.d || 0; restore = nav.views.get(s.k) || null; }       // back or forward
    else { nav.depth += 1; nav.key = newKey(); history.replaceState({ k: nav.key, d: nav.depth }, ""); }  // a new page
    nav.route = location.hash;
    state.shown = restore ? restore.shown : 100;
    // a new page may try the rest of Illinois again (once: a failure then stays until Try again)
    if (state.ilError && !state.ilPromise) state.ilError = null;
    let from = null;
    try { from = new URL(e.oldURL).hash; } catch { /* no old URL */ }
    render({ restore, from });
  });
  // the layout switches at these widths: the sidebar's place in the reading order, the sheet, the map's height
  const relayout = () => { placeSide(); syncSheet(); };
  for (const mq of [phone, wide]) { if (mq.addEventListener) mq.addEventListener("change", relayout); else mq.addListener(relayout); }
  window.addEventListener("resize", fitSide);
  render();
  await loadChicago();
  render({ keepFocus: true });
  state.navs = 1;           // from here on, a new view moves focus to its heading
}
boot();
