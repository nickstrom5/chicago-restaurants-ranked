// Checks the checker: plants one small, realistic bug at a time in a copy of the web app (logic.js, app.js) and runs
// check_logic.mjs on it. Every mutant must be caught (a difference reported). A mutant that survives means the logic test
// has a blind spot there. Writes only under <work>/mutants/.
//
// usage: node mutate.mjs --oracle <oracle.json> --mirror <mirror dir> --work <dir>
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPLORE = resolve(HERE, "../../../docs/explore");
const opt = {};
for (let i = 2; i + 1 < process.argv.length; i += 2) opt[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if (!opt.oracle || !opt.mirror || !opt.work) { console.error("usage: node mutate.mjs --oracle <oracle.json> --mirror <dir> --work <dir>"); process.exit(2); }

// [file, what, find, replace]: each `find` must occur exactly once
const MUTANTS = [
  ["logic.js", "stems need 5 letters, not 4", "(possessive || len(w) >= 4)", "(possessive || len(w) >= 5)"],
  ["logic.js", "z doesn't read as s", "if (len(word) >= 5 && word.endsWith(\"z\")) {", "if (false) {"],
  ["logic.js", "doubled letters aren't collapsed", "if (c === last && c >= 0x61 && c <= 0x7a) continue;", "if (false) continue;"],
  ["logic.js", "Closest matches spares three words", "spare = tokens.length - need;", "spare = tokens.length - need + 1;"],
  ["logic.js", "Closest matches don't need a word in the name", "if (missed <= spare && inName)", "if (missed <= spare && (inName || (inName = [])))"],
  ["logic.js", "Closest matches: no rarity weight", "Math.log((scanned + 1) / (n + 1))", "1"],
  ["logic.js", "Closest matches: 49, not 50", "export const CLOSEST_LIMIT = 50;", "export const CLOSEST_LIMIT = 49;"],
  ["logic.js", "loose names before typed names", "const out = named.concat(loose, rest);", "const out = loose.concat(named, rest);"],
  ["logic.js", "alt names ignored", "const ex = extras([nameWords, ...akaNames, brandWords], alt(row));", "const ex = extras([nameWords, ...akaNames, brandWords], []);"],
  ["logic.js", "aka read as one name", "const akaNames = (p.aka != null ? names(p.aka) : []).map(raw)", "const akaNames = (p.aka != null ? [p.aka] : []).map(raw)"],
  ["logic.js", "joins across \"and\"", "for (let i = 0; i < w.length - 1; i++) if (!isStop(i) && !isStop(i + 1)) out.push(w[i] + w[i + 1]);", "for (let i = 0; i < w.length - 1; i++) out.push(w[i] + w[i + 1]);"],
  ["logic.js", "joined data words match anywhere", "if (joinLen > 0 && hasIn(text, t.whole[k], joinStart - 1, end)) return true;", "if (joinLen > 0 && hasIn(text, t.needles[k], joinStart - 1, end)) return true;"],
  ["logic.js", "query words not joined", "if (!joinable(rawW[i]) || !joinable(rawW[i + 1])) continue;", "continue;"],
  ["logic.js", "lone 's after a period kept", "if (last !== undefined && last !== \"&\") { k += 2; continue; }", "if (false) { k += 2; continue; }"],
  ["logic.js", "a letter joins across a dropped word", "idx[n + 1] === idx[n] + 1 && !abbr.has(rt)", "!abbr.has(rt)"],
  ["logic.js", "Failed latest: 89 days", "export const RECENT_FAIL_DAYS = 90;", "export const RECENT_FAIL_DAYS = 89;"],
  ["logic.js", "Failed latest keeps places passed since", "p.lastResult === \"Fail\" && !p.passedSince &&", "p.lastResult === \"Fail\" &&"],
  ["logic.js", "Cleanest keeps places failed since", "eligible: (p) => (p.visits ?? 0) >= 2 && p.score != null && !p.failedSince,", "eligible: (p) => (p.visits ?? 0) >= 2 && p.score != null,"],
  ["logic.js", "a newer result on the records date counts", "cmpStr(nd, through) > 0", "cmpStr(nd, through) >= 0"],
  ["logic.js", "explainer drifts", "(${RECENT_FAIL_DAYS} days before that date)", "(${RECENT_FAIL_DAYS} days before then)"],
  ["logic.js", "home card says every", "sub: \"Search nearly every restaurant, café, bakery and tavern in the city\"", "sub: \"Search every restaurant, café, bakery and tavern in the city\""],
  ["app.js", "Closest matches row note reworded", "const CLOSEST_NOTE = \"Closest match, not an exact match\";", "const CLOSEST_NOTE = \"Closest match\";"],
];

const root = join(resolve(opt.work), "mutants");
rmSync(root, { recursive: true, force: true });
let survived = 0;
MUTANTS.forEach(([file, what, find, repl], k) => {
  const dir = join(root, String(k));
  mkdirSync(dir, { recursive: true });
  cpSync(EXPLORE, dir, { recursive: true });
  const src = readFileSync(join(dir, file), "utf8");
  const n = src.split(find).length - 1;
  if (n !== 1) { console.log(`  ?? ${what}: the text to change occurs ${n} times in ${file} (update mutate.mjs)`); survived += 1; return; }
  writeFileSync(join(dir, file), src.replace(find, repl));
  const t = Date.now();
  const r = spawnSync(process.execPath, [join(HERE, "check_logic.mjs"), "--oracle", opt.oracle, "--mirror", opt.mirror, "--logic", join(dir, "logic.js"), "--fail-fast", "1"],
    { encoding: "utf8", maxBuffer: 1 << 26 });
  const caught = r.status === 1 && /FIRST DIFFERENCE/.test(r.stdout);
  const first = (r.stdout.match(/FIRST DIFFERENCE (.*)/) || [])[1] || (r.stderr || "").split("\n")[0];
  console.log(`  ${caught ? "caught  " : "SURVIVED"} ${what}${caught ? `: ${first.slice(0, 110)}` : ` (exit ${r.status})`} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  if (!caught) survived += 1;
});
rmSync(root, { recursive: true, force: true });
console.log(`\nMUTANTS: ${MUTANTS.length - survived} of ${MUTANTS.length} caught`);
process.exit(survived ? 1 : 0);
