// Static, crawlable pages for search engines, built from the published weekly data: docs/lists/ (the web version's
// rankings), docs/neighborhoods/ (one page per community area) and docs/cuisines/ (one per cuisine group), plus their
// entries in docs/sitemap.xml. No JavaScript on them (CSP script-src 'none'); every place row links to its page in the
// web version (explore/#/place/<id>).
//
// It loads the data exactly as the web app does (docs/data/v1/manifest.json -> the chicago file, checked for size, sha256,
// rows and records date, then logic.js parseChicago and combine), and everything shown comes from docs/explore/logic.js,
// the port of the iPhone app's rules that check_logic.mjs tests against the app's Swift: board membership, order, metrics
// and explainers (ranked, metric, explainer, NOTES, badges), and an area or cuisine list in the order the web version's
// Search shows it (results() with that neighborhood or cuisine filter). Nothing here re-implements a rule.
//
// Not generated: the negative boards (Lowest scores, Failed latest, Pest citations). app-review-risk.md S6 and the site
// runbook §3 keep negative lists out of page titles and meta descriptions, and a page about one can't honestly have a
// title without it; the lists index points to them in the web version instead.
//
// The generator owns docs/lists/, docs/neighborhoods/ and docs/cuisines/ entirely: it writes every page there, deletes
// anything else in them (a neighborhood or cuisine that leaves the data loses its page), and rewrites only its own
// entries in sitemap.xml (lastmod = the data's records_through), keeping the rest as they are. A page for an area or cuisine
// with fewer than THIN graded places is still written, with robots noindex,follow, and left out of the sitemap.
// Deterministic: the same data and logic write the same bytes, so a second run changes nothing.
//
// The weekly publish (chi-eats/pipeline/publish_data.py) runs it on its staging copy of docs/ after update_counts.py and
// before verify.py, which checks these pages too. By hand:
//   node playbook/tools/static_pages.mjs                  # docs/ beside playbook/
//   node playbook/tools/static_pages.mjs --docs DIR       # another copy of docs/
//   node playbook/tools/static_pages.mjs --check          # exit 1 if any page is out of date; writes nothing
// Exit 0 when written (or up to date), 1 with --check and changes, 2 on a problem (nothing written).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const opt = { docs: resolve(HERE, "../../docs"), check: false };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--docs") opt.docs = resolve(process.argv[++i] || "");
  else if (a === "--check") opt.check = true;
  else { console.error(`static_pages: unknown argument ${a}\nusage: node static_pages.mjs [--docs DIR] [--check]`); process.exit(2); }
}
const DOCS = opt.docs;
const BASE = "https://chicago.eatsranked.com/";
const OWNED = ["lists", "neighborhoods", "cuisines"];
const THIN = 20;              // graded places an area or cuisine page needs to be indexed
const ROWS = 100;             // rows on a page; the web version has the rest (it shows 100, then Show more)
const CITY_DATA = "https://data.cityofchicago.org/Health-Human-Services/Food-Inspections/4ijn-s7e5";
const OG_ALT = "Chicago Restaurants: Ranked app icon, a Chicago hot dog on a sky-blue Chicago-flag star, beside the words: Chicago Restaurants: Ranked. Chicago restaurants, graded A–F and mapped.";
// the guide pages' policy, without 'unsafe-inline' (no inline styles here); connect-src 'self' lets tools that read
// robots.txt from the page (Lighthouse) do so
const CSP = "default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; upgrade-insecure-requests";
// the site's own wording (index.html's grade scale, explore's list caption, About › Our grades and Data updates)
const GRADES_LONG = "Our 0–100 score and A–F grade, calculated from City of Chicago inspection records since January 2023. Not official City grades: the City reports Pass, Pass w/ Conditions or Fail. An inspection describes conditions on the day of the visit.";
const GRADES_CAPTION = "Our grades from City inspection records, not official City grades.";
const VENUES = "not counting airports, stadiums, cafeterias and other non-restaurants";

function fail(msg) { console.error(`static_pages: FAIL ${msg}`); process.exit(2); }

// ------------------------------------------------------------------------------------------------ the data, as app.js loads it
const L = await import(pathToFileURL(join(DOCS, "explore", "logic.js")).href);
function loadData() {
  const mpath = join(DOCS, "data", "v1", "manifest.json");
  if (!existsSync(mpath)) fail(`${mpath} is missing: nothing is published to build from`);
  let m;
  try { m = JSON.parse(readFileSync(mpath, "utf8")); } catch (e) { fail(`manifest.json isn't JSON: ${e.message}`); }
  if (!m || m.schema !== 1 || !m.files || !m.files.chicago) fail("manifest.json: not schema 1 with a chicago file");
  const f = m.files.chicago;
  if (typeof f.path !== "string" || !/^[A-Za-z0-9._-]+\.json$/.test(f.path)) fail(`manifest.json: bad chicago path ${f.path}`);
  const fpath = join(DOCS, "data", "v1", f.path);
  if (!existsSync(fpath)) fail(`${f.path}: not found`);
  const buf = readFileSync(fpath);
  if (f.bytes && buf.length !== f.bytes) fail(`${f.path}: ${buf.length} bytes, the manifest says ${f.bytes}`);
  const sha = createHash("sha256").update(buf).digest("hex");
  if (f.sha256 && sha !== f.sha256) fail(`${f.path}: sha256 doesn't match the manifest`);
  const chi = L.parseChicago(JSON.parse(buf.toString("utf8")));
  if (f.rows != null && chi.rows !== f.rows) fail(`${f.path}: ${chi.rows} rows, the manifest says ${f.rows}`);
  if (m.records_through && chi.recordsThrough !== m.records_through) fail(`${f.path}: records through ${chi.recordsThrough}, the manifest says ${m.records_through}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chi.recordsThrough)) fail(`records_through ${chi.recordsThrough} isn't a date`);
  return { manifest: m, chi, data: L.combine(chi, null) };
}

// ------------------------------------------------------------------------------------------------ small helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (v) => Number(v).toLocaleString("en-US");
const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : many}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => { const [y, mo, d] = iso.split("-").map(Number); return `${MONTHS[mo - 1]} ${d}, ${y}`; };
/** URL path segment: lowercase ASCII words joined by "-", "&" as "and", apostrophes dropped ("O'Hare" -> "ohare"). */
const slugify = (s) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** The web version's own links (app.js placeHref, boardHash, searchHash with one filter). */
const placeHref = (up, p) => `${up}explore/#/place/${encodeURIComponent(p.id)}`;
const boardHref = (up, id) => `${up}explore/#/board/${id}`;
const searchHref = (up, key, value) => `${up}explore/#/search?${new URLSearchParams([[key, value]]).toString()}`;
const sideName = (s) => (s === "Central" ? "Downtown" : `${s} Side`);   // the app's own words for a side (filters, search)
const gradeChip = (g, cls = "") => `<span class="g g${g}${cls ? " " + cls : ""}"><span class="sr">Grade </span>${g}</span>`;
const ldJSON = (o) => JSON.stringify(o, null, 1).replace(/</g, "\\u003c");
const FORK = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 3v6.5a2.2 2.2 0 0 0 2.2 2.2h0a2.2 2.2 0 0 0 2.2-2.2V3M8.7 3v18M17.5 21V3c-2.3 1.4-3.3 4.2-3.3 7.6V13h3.3"/></svg>`;

function gradeCounts(list) {
  const c = { graded: 0, A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const p of list) if (p.grade) { c.graded += 1; c[p.grade] += 1; }
  return c;
}
/** "N have our grade: a A, b B, ..." with each number in a data-n span, which verify.py reads back. */
const gradeLine = (c) => `<span data-n="graded">${n(c.graded)}</span> ${c.graded === 1 ? "has" : "have"} our grade`
  + (c.graded ? `: ${L.GRADES_ORDER.map((g) => `<span data-n="${g}">${n(c[g])}</span> ${g}`).join(", ")}.` : ".");
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (k) => WORDS[k] ?? n(k);

// ------------------------------------------------------------------------------------------------ page frame
function page({ path, title, desc, index, crumbs, h1, kicker, body, generatedNote }) {
  const up = "../".repeat(path.split("/").filter(Boolean).length);
  const url = BASE + path;
  const crumbLD = { "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: BASE + c.path })) };
  const crumbNav = crumbs.map((c, i) => (i === crumbs.length - 1 ? esc(c.name) : `<a href="${up}${c.path}">${esc(c.name)}</a>`)).join(" › ");
  return `<!DOCTYPE html>
<!-- ${generatedNote} -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="${index ? "index,follow,max-image-preview:large" : "noindex,follow"}">
<meta name="theme-color" content="#0E3386">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Chicago Restaurants: Ranked">
<meta property="og:locale" content="en_US">
<meta property="og:image" content="${BASE}og.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(OG_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${BASE}og.png">
<meta name="twitter:image:alt" content="${esc(OG_ALT)}">
<link rel="icon" type="image/svg+xml" href="${up}favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="${up}favicon-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="${up}apple-touch-icon.png">
<link rel="manifest" href="${up}site.webmanifest">
<link rel="stylesheet" href="${up}pages.css">
<script type="application/ld+json">
${ldJSON(crumbLD)}
</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site">
  <div class="wrap bar">
    <a class="logo" href="${up}" aria-label="Chicago Restaurants: Ranked home"><img src="${up}favicon.svg" width="32" height="32" alt="Chi Ranked app icon" decoding="async"><span>Chicago Restaurants: <b>Ranked</b></span></a>
    <nav aria-label="Primary">
      <a href="${up}#how">How it works</a>
      <a href="${up}chicago-restaurant-grades.html">Grades</a>
      <a href="${up}look-up-chicago-restaurant-inspections.html">Look up a place</a>
      <a href="${up}#faq">FAQ</a>
      <a href="${up}explore/">Search on the web</a>
    </nav>
  </div>
</header>
<main id="main">
  <div class="wrap page">
    <nav class="crumbs" aria-label="Breadcrumb">${crumbNav}</nav>
    <p class="kicker">${esc(kicker)}</p>
    <h1>${esc(h1)}</h1>
${body}
  </div>
</main>
<footer class="site">
  <div class="wrap">
    <nav aria-label="Footer">
      <a href="${up}">Chicago Restaurants: Ranked home</a>
      <a href="${up}explore/">Search on the web</a>
      <a href="${up}lists/">Chicago restaurant rankings</a>
      <a href="${up}neighborhoods/">Grades by neighborhood</a>
      <a href="${up}cuisines/">Grades by cuisine</a>
      <a href="${up}how-chicago-restaurant-inspections-work.html">How Chicago restaurant inspections work</a>
      <a href="${up}look-up-chicago-restaurant-inspections.html">Look up a Chicago restaurant inspection</a>
      <a href="${up}chicago-restaurant-grades.html">What the A–F grades mean</a>
      <a href="${up}support.html">Help &amp; support</a>
      <a href="${up}privacy.html">Privacy policy</a>
      <a href="${up}terms.html">Terms of use</a>
      <a href="mailto:work-with-nick@gmail.com">Email support</a>
    </nav>
    <p class="fine">Grades and scores are calculated by this app from public records. They are not official City of Chicago grades. Independent project by Nicholas Soderstrom. Not affiliated with or endorsed by the City of Chicago, the Chicago Department of Public Health, Cook County, the Michelin Guide or the James Beard Foundation.</p>
    <p class="fine">City of Chicago data disclaimer: This site provides applications using data that has been modified for use from its original source, www.cityofchicago.org, the official website of the City of Chicago. The City of Chicago makes no claims as to the content, accuracy, timeliness, or completeness of any of the data provided at this site. The data provided at this site is subject to change at any time. It is understood that the data provided at this site is being used at one's own risk.</p>
    <p class="fine">Inspection and license records: City of Chicago Data Portal. Property values: Cook County Assessor's Office. Restaurant websites and places outside Chicago: Overture Maps Foundation (CDLA Permissive 2.0, Apache 2.0, CC0).</p>
    <p class="fine"><a class="hub" href="https://eatsranked.com/" rel="noopener">More states at eatsranked.com</a></p>
    <p class="fine">© 2026 Nicholas Soderstrom. Made in Chicago.</p>
  </div>
</footer>
</body>
</html>
`;
}

/** The grade note, the records date and the City source, as one box on every page. */
function sourceBox(rt, extra = "") {
  return `    <div class="box">
      <p>${GRADES_LONG}</p>
      <p>City records through <time datetime="${rt}">${longDate(rt)}</time>. About once a week we rebuild the data from the City’s newest public records, and these pages with it. Source: <a href="${CITY_DATA}" rel="noopener">City of Chicago Food Inspections</a> on the Chicago Data Portal.${extra}</p>
    </div>`;
}

// ------------------------------------------------------------------------------------------------ rows
/** A place in an area or cuisine list: name, street address, the latest City result as the app words it (RankRow's result
 *  lines), our grade and score. The whole row links to the place in the web version. */
function placeRow(up, p, other) {
  const sub = [p.addr, other].filter((x) => x != null).join(" · ");
  const lines = p.grade ? [L.resultLine(p), L.newerLine(p)].filter(Boolean)
    : ["No grade yet: no completed inspections since January 2023.", ...(p.lastDate ? [L.resultLine(p)] : [])];
  const tile = p.grade ? gradeChip(p.grade, "gt") : `<span class="tile">${FORK}</span>`;
  const score = p.score != null ? `<span class="rmetric"><b><span class="sr">inspection score </span>${p.score}</b></span>` : "";
  return `      <li><a class="rrow" href="${placeHref(up, p)}">${tile}<span class="rmain"><span class="rname">${esc(p.name)}</span>`
    + `<span class="rsub">${esc(sub)}</span>${lines.map((x) => `<span class="rres">${esc(x)}</span>`).join("")}</span>${score}</a></li>`;
}
/** A ranked row as the web version's board shows it (app.js rankRow, non-negative boards). */
function rankRow(up, p, i, board, data) {
  const m = L.metric(board, p, data.recordsYear);
  const sub = [p.hood, p.cuisine].filter((x) => x != null).join(" · ");
  const b = L.badges(p, board === "honors");
  const badges = b.length ? `<span class="badges">${b.map(([t, k]) => `<span class="badge ${k}">${esc(t)}</span>`).join("")}</span>` : "";
  const grade = board !== "honors" && p.grade ? gradeChip(p.grade) : "";
  return `      <li><a class="rrow" href="${placeHref(up, p)}"><span class="rank${i < 3 ? " podium" : ""}${i >= 99 ? " long" : ""}"><span class="sr">Rank </span>${i + 1}</span>`
    + `<span class="rmain"><span class="rname">${esc(p.name)}</span><span class="rsub">${esc(sub)}</span>${badges}</span>`
    + `<span class="rmetric"><span class="mtop">${grade}<b>${esc(m[0])}</b></span><small>${esc(m[1])}</small></span></a></li>`;
}

// ------------------------------------------------------------------------------------------------ build
function build({ chi, data }) {
  const rt = data.recordsThrough;
  const note = `Written by playbook/tools/static_pages.mjs from data/v1 (City records through ${rt}). Don't edit: each data publish rewrites lists/, neighborhoods/ and cuisines/ and deletes anything else in them.`;
  const pages = [];          // { path, html, index, kind }
  const add = (o) => pages.push({ path: o.path, index: o.index, kind: o.kind, html: page({ ...o, generatedNote: note }) });
  const home = { name: "Chicago Restaurants: Ranked", path: "" };
  const all = L.newFilters();           // the web version's default list: no filters, non-restaurants left out

  // ---- the areas and cuisines, each as the web version's Search lists it (results(): its order, its count)
  const listFor = (filters) => {
    const r = L.results(data, { text: "", scope: "chicago", filters, near: false });
    if (r.orderPending) fail("an area or cuisine list came back pending (it shouldn't depend on the rest of Illinois)");
    return r;
  };
  const taken = new Map();
  const slugOf = (kind, name) => {
    const s = slugify(name);
    if (!s) fail(`${kind} ${JSON.stringify(name)} has no usable URL name`);
    const k = kind + "/" + s;
    if (taken.has(k) && taken.get(k) !== name) fail(`${kind}: ${JSON.stringify(name)} and ${JSON.stringify(taken.get(k))} both make ${s}`);
    taken.set(k, name);
    return s;
  };
  const sideOf = new Map();
  for (const p of data.chicago) if (p.hood != null && p.side != null && !sideOf.has(p.hood)) sideOf.set(p.hood, p.side);
  const areas = chi.hoods.map((h) => ({ name: h, slug: slugOf("neighborhoods", h), side: sideOf.get(h) ?? null, r: listFor(L.newFilters({ hood: h })) }))
    .filter((a) => a.r.total > 0);
  const cuisines = chi.cuisines.map((c) => ({ name: c, slug: slugOf("cuisines", c), r: listFor(L.newFilters({ cuisine: c })) }))
    .filter((c) => c.r.total > 0);
  // grade counts over the whole list (search(), which results() cuts to the first SEARCH_LIMIT it shows)
  const fullList = (filters) => L.search(data, "", "chicago", filters);
  for (const x of [...areas.map((a) => [a, { hood: a.name }]), ...cuisines.map((c) => [c, { cuisine: c.name }])]) {
    const list = fullList(L.newFilters(x[1]));
    if (list.length !== x[0].r.total) fail(`${x[0].name}: search() has ${list.length} places, results() says ${x[0].r.total}`);
    x[0].c = gradeCounts(list);
  }

  // ---- neighborhoods
  const sides = chi.sides.filter((s) => areas.some((a) => a.side === s));
  const areaTotal = areas.reduce((t, a) => t + a.r.total, 0);
  const areaC = gradeCounts(areas.flatMap((a) => fullList(L.newFilters({ hood: a.name }))));
  for (const a of areas) {
    const path = `neighborhoods/${a.slug}/`, up = "../../";
    const shown = a.r.places.slice(0, ROWS);
    const index = a.c.graded >= THIN;
    const siblings = areas.filter((x) => x !== a && x.side === a.side);
    const body = `    <p class="lede">The web version of Chicago Restaurants: Ranked lists <span data-n="places">${n(a.r.total)}</span> ${a.r.total === 1 ? "place" : "places"} in ${esc(a.name)}, a Chicago community area${a.side === "Central" ? " Downtown" : a.side ? ` on the ${esc(sideName(a.side))}` : ""} (${VENUES}). ${gradeLine(a.c)}</p>
${sourceBox(rt, " Each place’s page in the web version links to its own City inspection records.")}
    <h2>Places, best inspection score first</h2>
    <p class="cap">${GRADES_CAPTION} The order is the web version’s for this neighborhood: highest score first, ties by name, places without a score last.</p>
    <ol class="rlist" role="list" data-n-rows="${shown.length}">
${shown.map((p) => placeRow(up, p, p.cuisine)).join("\n")}
    </ol>
    <p class="more">${a.r.total > shown.length ? `Showing the first <span data-n="shown">${n(shown.length)}</span> of ${n(a.r.total)}. ` : ""}<a href="${searchHref(up, "hood", a.name)}">${a.r.total > shown.length ? `See all ${n(a.r.total)} in the web version` : `Filter and map ${esc(a.name)} in the web version`}</a></p>
    ${siblings.length ? `<h2>More ${esc(a.side ? sideName(a.side) : "")} neighborhoods</h2>
    <ul class="links" role="list">${siblings.map((x) => `<li><a href="${up}neighborhoods/${x.slug}/">${esc(x.name)}</a></li>`).join("")}</ul>
    ` : ""}<p><a href="${up}neighborhoods/">All Chicago neighborhoods</a> · <a href="${up}cuisines/">Grades by cuisine</a> · <a href="${up}lists/">Rankings</a></p>`;
    add({ kind: "area", path, index,
      title: `${a.name} Restaurant Grades, Chicago | Chi Ranked`,
      desc: `Our A–F grades for ${plural(a.c.graded, "place", "places")} in ${a.name}, Chicago, from City inspection records through ${longDate(rt)}`
        + (a.c.A ? `: ${n(a.c.A)} graded A` : "") + `. Not official City grades.`,
      crumbs: [home, { name: "Neighborhoods", path: "neighborhoods/" }, { name: a.name, path }],
      h1: `${a.name} restaurant inspection grades`, kicker: `Chicago community area${a.side ? " · " + sideName(a.side) : ""}`, body });
  }
  {
    const up = "../";
    const tables = sides.map((s) => {
      const rows = areas.filter((a) => a.side === s);
      return `    <h2 id="${slugify(sideName(s))}">${esc(sideName(s))}</h2>
    <div class="tablewrap"><table>
      <caption>${esc(sideName(s))}: ${plural(rows.length, "community area", "community areas")}</caption>
      <thead><tr><th scope="col">Community area</th><th scope="col" class="num">Places</th><th scope="col" class="num">With our grade</th><th scope="col" class="num">Graded A</th></tr></thead>
      <tbody>
${rows.map((a) => `        <tr><th scope="row"><a href="${up}neighborhoods/${a.slug}/">${esc(a.name)}</a></th><td class="num">${n(a.r.total)}</td><td class="num">${n(a.c.graded)}</td><td class="num">${n(a.c.A)}</td></tr>`).join("\n")}
      </tbody>
    </table></div>`;
    }).join("\n");
    const noSide = areas.filter((a) => !sides.includes(a.side));
    const body = `    <p class="lede">The web version of Chicago Restaurants: Ranked lists <span data-n="places">${n(areaTotal)}</span> places in <span data-n="areas">${n(areas.length)}</span> Chicago community areas (${VENUES}). <span data-n="graded">${n(areaC.graded)}</span> have our A–F grade, <span data-n="A">${n(areaC.A)}</span> of them an A. Pick a neighborhood to see its places, best inspection score first.</p>
${sourceBox(rt)}
    <p class="jump">${sides.map((s) => `<a href="#${slugify(sideName(s))}">${esc(sideName(s))}</a>`).join(" · ")}</p>
${tables}${noSide.length ? `\n    <h2>Other areas</h2>\n    <ul class="links" role="list">${noSide.map((a) => `<li><a href="${up}neighborhoods/${a.slug}/">${esc(a.name)}</a></li>`).join("")}</ul>` : ""}
    <p><a href="${up}cuisines/">Grades by cuisine</a> · <a href="${up}lists/">Rankings</a> · <a href="${up}explore/">Search and map in the web version</a></p>`;
    add({ kind: "areas", path: "neighborhoods/", index: true,
      title: "Chicago Restaurant Inspection Grades by Neighborhood | Chi Ranked",
      desc: `Our A–F grades for ${n(areaC.graded)} places in ${n(areas.length)} Chicago community areas, from City inspection records through ${longDate(rt)}. Not official City grades.`,
      crumbs: [home, { name: "Neighborhoods", path: "neighborhoods/" }],
      h1: "Chicago restaurant grades by neighborhood", kicker: "Neighborhoods", body });
  }

  // ---- cuisines
  const cuisineNote = " Cuisine groups are the app’s own: each place is filed under one, from its name, its City records and Overture Maps listings.";
  for (const c of cuisines) {
    const path = `cuisines/${c.slug}/`, up = "../../";
    const shown = c.r.places.slice(0, ROWS);
    const index = c.c.graded >= THIN;
    const body = `    <p class="lede">The web version of Chicago Restaurants: Ranked lists <span data-n="places">${n(c.r.total)}</span> Chicago ${c.r.total === 1 ? "place" : "places"} under ${esc(c.name)} (${VENUES}). ${gradeLine(c.c)}</p>
${sourceBox(rt, cuisineNote + " Each place’s page in the web version links to its own City inspection records.")}
    <h2>Places, best inspection score first</h2>
    <p class="cap">${GRADES_CAPTION} The order is the web version’s for this cuisine: highest score first, ties by name, places without a score last.</p>
    <ol class="rlist" role="list" data-n-rows="${shown.length}">
${shown.map((p) => placeRow(up, p, p.hood)).join("\n")}
    </ol>
    <p class="more">${c.r.total > shown.length ? `Showing the first <span data-n="shown">${n(shown.length)}</span> of ${n(c.r.total)}. ` : ""}<a href="${searchHref(up, "cuisine", c.name)}">${c.r.total > shown.length ? `See all ${n(c.r.total)} in the web version` : `Filter and map ${esc(c.name)} in the web version`}</a></p>
    <h2>More cuisines</h2>
    <ul class="links" role="list">${cuisines.filter((x) => x !== c).map((x) => `<li><a href="${up}cuisines/${x.slug}/">${esc(x.name)}</a></li>`).join("")}</ul>
    <p><a href="${up}cuisines/">All cuisines</a> · <a href="${up}neighborhoods/">Grades by neighborhood</a> · <a href="${up}lists/">Rankings</a></p>`;
    add({ kind: "cuisine", path, index,
      title: `Chicago ${c.name} Places: Inspection Grades | Chi Ranked`,
      desc: `Our A–F grades for ${plural(c.c.graded, "Chicago place", "Chicago places")} under ${c.name}, from City inspection records through ${longDate(rt)}`
        + (c.c.A ? `: ${n(c.c.A)} graded A` : "") + `. Not official City grades.`,
      crumbs: [home, { name: "Cuisines", path: "cuisines/" }, { name: c.name, path }],
      h1: `${c.name} places in Chicago: inspection grades`, kicker: "Chicago cuisine group", body });
  }
  {
    const up = "../";
    const total = cuisines.reduce((t, c) => t + c.r.total, 0);
    const cc = gradeCounts(cuisines.flatMap((c) => fullList(L.newFilters({ cuisine: c.name }))));
    const body = `    <p class="lede">The web version of Chicago Restaurants: Ranked lists <span data-n="places">${n(total)}</span> Chicago places in <span data-n="cuisines">${n(cuisines.length)}</span> cuisine groups (${VENUES}). <span data-n="graded">${n(cc.graded)}</span> have our A–F grade, <span data-n="A">${n(cc.A)}</span> of them an A. Pick a cuisine to see its places, best inspection score first.</p>
${sourceBox(rt, cuisineNote)}
    <div class="tablewrap"><table>
      <caption>Chicago cuisine groups</caption>
      <thead><tr><th scope="col">Cuisine</th><th scope="col" class="num">Places</th><th scope="col" class="num">With our grade</th><th scope="col" class="num">Graded A</th></tr></thead>
      <tbody>
${cuisines.map((c) => `        <tr><th scope="row"><a href="${up}cuisines/${c.slug}/">${esc(c.name)}</a></th><td class="num">${n(c.r.total)}</td><td class="num">${n(c.c.graded)}</td><td class="num">${n(c.c.A)}</td></tr>`).join("\n")}
      </tbody>
    </table></div>
    <p><a href="${up}neighborhoods/">Grades by neighborhood</a> · <a href="${up}lists/">Rankings</a> · <a href="${up}explore/">Search and map in the web version</a></p>`;
    add({ kind: "cuisines", path: "cuisines/", index: true,
      title: "Chicago Restaurant Inspection Grades by Cuisine | Chi Ranked",
      desc: `Our A–F grades for ${n(cc.graded)} Chicago places in ${n(cuisines.length)} cuisine groups, from pizza to tacos, from City inspection records through ${longDate(rt)}. Not official City grades.`,
      crumbs: [home, { name: "Cuisines", path: "cuisines/" }],
      h1: "Chicago restaurant grades by cuisine", kicker: "Cuisines", body });
  }

  // ---- rankings: the web version's boards that aren't negative, each under its home card's name
  const boards = L.BOARD_IDS.filter((id) => !L.BOARDS[id].negative).map((id) => {
    const card = L.HOME_CARDS.find((c) => c.board === id && Object.keys(c.filters || {}).length === 0);
    const title = card ? card.title : L.BOARDS[id].title;
    return { id, B: L.BOARDS[id], title, sub: card ? card.sub : "", slug: slugOf("lists", title), list: L.ranked(data, id, all) };
  }).filter((b) => b.list.length > 0);
  const negatives = L.BOARD_IDS.filter((id) => L.BOARDS[id].negative);
  for (const b of boards) {
    const path = `lists/${b.slug}/`, up = "../../";
    const shown = b.list.slice(0, ROWS);
    const body = `    <p class="lede"><span data-n="places">${n(b.list.length)}</span> Chicago ${b.list.length === 1 ? "place is" : "places are"} on the ${esc(b.B.title)} list in the web version of Chicago Restaurants: Ranked (${VENUES}). ${shown.length < b.list.length ? `Here are the top <span data-n="shown">${n(shown.length)}</span>, in the list’s own order.` : "Here they all are, in the list’s own order."}</p>
    <div class="explainer"><h2>How it’s ranked</h2><p>${esc(L.explainer(b.id, rt))}</p></div>
${sourceBox(rt, " Each place’s page in the web version links to its own City inspection records.")}
    <h2>${shown.length < b.list.length ? `Top ${n(shown.length)}` : `All ${n(shown.length)}`}</h2>
    ${b.id !== "honors" ? `<p class="cap">${GRADES_CAPTION}</p>` : ""}${L.NOTES[b.id] ? `<p class="cap">${esc(L.NOTES[b.id])}</p>` : ""}
    <ol class="rlist" role="list" data-n-rows="${shown.length}">
${shown.map((p, i) => rankRow(up, p, i, b.id, data)).join("\n")}
    </ol>
    <p class="more"><a href="${boardHref(up, b.id)}">${shown.length < b.list.length ? `See all ${n(b.list.length)} on this list, with filters, in the web version` : "Filter this list in the web version"}</a></p>
    <h2>More rankings</h2>
    <ul class="links" role="list">${boards.filter((x) => x !== b).map((x) => `<li><a href="${up}lists/${x.slug}/">${esc(x.title)}</a></li>`).join("")}</ul>
    <p><a href="${up}lists/">All rankings</a> · <a href="${up}neighborhoods/">Grades by neighborhood</a> · <a href="${up}cuisines/">Grades by cuisine</a></p>`;
    add({ kind: "board", path, index: true,
      title: `${b.title} · Chicago Restaurant Rankings | Chi Ranked`,
      desc: `${b.sub}: ${shown.length < b.list.length ? `the top ${n(shown.length)} of ${n(b.list.length)}` : `all ${n(b.list.length)}`} Chicago places on this list, from public records through ${longDate(rt)}.`,
      crumbs: [home, { name: "Rankings", path: "lists/" }, { name: b.title, path }],
      h1: b.title, kicker: "Chicago restaurant rankings", body });
  }
  {
    const up = "../";
    const body = `    <p class="lede">The web version of Chicago Restaurants: Ranked has <span data-n="lists">${n(boards.length)}</span> rankings of Chicago restaurants built from public records: City of Chicago inspections and licenses, the Cook County Assessor and hand-checked honors. Each one below shows its top places, in the list’s own order.</p>
${sourceBox(rt)}
    <ul class="cards" role="list">
${boards.map((b) => `      <li><a href="${up}lists/${b.slug}/"><b>${esc(b.title)}</b><span>${esc(b.sub)}</span><span class="cnt">${plural(b.list.length, "place", "places")}</span></a></li>`).join("\n")}
    </ul>
    <p>${word(negatives.length).replace(/^./, (ch) => ch.toUpperCase())} more lists, ${negatives.map((id) => ({ worst: "Lowest inspection scores", recentFails: "Failed latest inspection", pests: "Pest citations" }[id] || L.BOARDS[id].title)).join(", ").replace(/, ([^,]*)$/, " and $1")}, are in the <a href="${up}explore/">web version</a>, where each row shows the place’s street address and its latest City result with the date.</p>
    <p><a href="${up}neighborhoods/">Grades by neighborhood</a> · <a href="${up}cuisines/">Grades by cuisine</a></p>`;
    add({ kind: "boards", path: "lists/", index: true,
      title: "Chicago Restaurant Rankings from Public Records | Chi Ranked",
      desc: `${word(boards.length).replace(/^./, (ch) => ch.toUpperCase())} Chicago restaurant rankings from public records, from cleanest kitchens to Michelin and James Beard honorees, with City records through ${longDate(rt)}.`,
      crumbs: [home, { name: "Rankings", path: "lists/" }],
      h1: "Chicago restaurant rankings", kicker: "Rankings", body });
  }
  return { pages, rt, areas, cuisines, boards };
}

// ------------------------------------------------------------------------------------------------ sitemap
const OWNED_LOC = new RegExp(`^${BASE.replace(/[.]/g, "\\.")}(?:${OWNED.join("|")})/`);
function sitemapWith(src, pages, rt) {
  const blocks = [...src.matchAll(/<url>[\s\S]*?<\/url>/g)].map((m) => m[0]);
  const start = src.indexOf("<url>"), end = src.lastIndexOf("</urlset>");
  if (end < 0) fail("sitemap.xml has no </urlset>");
  const head = start >= 0 ? src.slice(0, start) : src.slice(0, end);
  const keep = blocks.filter((b) => { const m = /<loc>\s*(.*?)\s*<\/loc>/.exec(b); return !(m && OWNED_LOC.test(m[1])); });
  // lists/ then neighborhoods/ then cuisines/, each index before its pages
  const order = (p) => [OWNED.indexOf(p.path.split("/")[0]), p.path.split("/").filter(Boolean).length];
  const ours = pages.filter((p) => p.index).map((p, i) => [order(p), i, p]).sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1] || a[1] - b[1])
    .map(([, , p]) => `<url><loc>${BASE}${p.path}</loc><lastmod>${rt}</lastmod></url>`);
  return head.replace(/[ \t]*$/, "") + [...keep, ...ours].map((b) => `  ${b}\n`).join("") + "</urlset>\n";
}

// ------------------------------------------------------------------------------------------------ write
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
function writeIfChanged(path, text, changes) {
  const old = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (old === text) return;
  changes.push(`${old == null ? "add   " : "update"} ${relative(DOCS, path)}`);
  if (opt.check) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".part", text);
  renameSync(path + ".part", path);
}

const loaded = loadData();
const { pages, rt, areas, cuisines, boards } = build(loaded);
const want = new Map(pages.map((p) => [resolve(DOCS, p.path, "index.html"), p.html]));
const changes = [];
for (const [path, html] of want) writeIfChanged(path, html, changes);
for (const dir of OWNED) {
  for (const f of walk(join(DOCS, dir))) {
    if (want.has(f)) continue;
    changes.push(`delete ${relative(DOCS, f)}`);
    if (!opt.check) rmSync(f);
  }
  // folders left empty (a neighborhood or cuisine gone from the data), deepest first
  const dirs = [];
  const collect = (d) => { if (!existsSync(d)) return; for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { collect(join(d, e.name)); dirs.push(join(d, e.name)); } };
  collect(join(DOCS, dir));
  if (!opt.check) for (const d of dirs) if (readdirSync(d).length === 0) rmdirSync(d);
}
const smPath = join(DOCS, "sitemap.xml");
if (!existsSync(smPath)) fail("docs/sitemap.xml is missing");
writeIfChanged(smPath, sitemapWith(readFileSync(smPath, "utf8"), pages, rt), changes);

const thin = pages.filter((p) => !p.index);
console.log(`static_pages: ${DOCS} <- manifest ${loaded.manifest.version} (records through ${rt})`);
console.log(`  ${pages.length} pages: ${boards.length + 1} rankings, ${areas.length + 1} neighborhoods, ${cuisines.length + 1} cuisines; `
  + `${pages.length - thin.length} in the sitemap, ${thin.length} noindex (fewer than ${THIN} graded places: ${thin.map((p) => p.path).join(", ") || "none"})`);
for (const c of changes.slice(0, 30)) console.log("  " + c);
if (changes.length > 30) console.log(`  ... ${changes.length - 30} more`);
console.log(`${pages.length} pages (${pages.length - thin.length} in the sitemap, ${thin.length} noindex), records through ${rt}: `
  + `${changes.length} ${opt.check ? "out of date" : changes.length === 1 ? "change written" : "changes written"}`);
process.exit(opt.check && changes.length ? 1 : 0);
