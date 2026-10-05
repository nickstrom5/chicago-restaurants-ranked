// Chicago Restaurants: Ranked on the web: the iPhone app's rules, ported from its Swift source so both say the same thing.
// Sources (chi-eats/ios/ChiRanked): Models/Place.swift (Fmt), Models/Board.swift (Board, AsOf, Filters), Services/Search.swift
// (Norm, Token, SearchIndex), Services/DataStore.swift (DataLoader, Finder: matches, closest, results, near; Geo, surprise),
// Views/HomeView.swift (HomeCard), Views/RankingsView.swift (RankRow's result lines), Views/PlaceDetailView.swift
// (ListingReport, CityRecords, PropertyClass, the Apple Maps link). No DOM here: the app page (app.js) and the logic test
// (chicago-restaurants-ranked/playbook/tools/explore/check_logic.mjs), which checks this file against the app's own Swift
// code compiled for macOS, both import it.

// ------------------------------------------------------------------------------------------------ strings, Swift-style
const SEG = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
const ASCII = /^[\x00-\x7f]*$/;
/** Swift Characters (grapheme clusters). */
export const chars = (s) => (ASCII.test(s) ? s.split("") : SEG ? Array.from(SEG.segment(s), (x) => x.segment) : Array.from(s));
/** Swift `String.count`. */
export const len = (s) => (ASCII.test(s) ? s.length : chars(s).length);

/** Swift `a < b` on Strings: unicode scalar order of the NFC forms (callers pass NFC strings). */
export function cmpStr(a, b) {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i), y = b.charCodeAt(i);
    if (x !== y) {
      // UTF-16 puts surrogates (U+10000 and up) below U+E000–U+FFFF; scalar order puts them above
      if (x >= 0xd800 && y >= 0xd800) { x = x >= 0xe000 ? x - 0x800 : x + 0x2000; y = y >= 0xe000 ? y - 0x800 : y + 0x2000; }
      return x < y ? -1 : 1;
    }
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}
const nfc = (s) => (ASCII.test(s) ? s : s.normalize("NFC"));

/** A stable sort by a Swift-style "a comes before b" predicate (Swift's sort keeps equal elements in order). */
export function sortBy(list, before) {
  return list.sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
}

// Foundation's folding (caseInsensitive, diacriticInsensitive, widthInsensitive), checked against it on macOS: full case
// folding for the few letters where it differs from lowercasing, then only the combining diacritical marks go (Latin, Greek
// and Cyrillic accents); Arabic, Hebrew, Indic and kana marks stay, as they do in Foundation.
const MARKS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g;
const FOLD = { "ß": "ss", "ẞ": "ss", "ς": "σ", "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };
function foldBase(s) {
  let t = s.toLowerCase();
  if (!ASCII.test(t)) {
    t = t.replace(/[ßẞςﬀ-ﬆ]/g, (c) => FOLD[c] || c).normalize("NFD").replace(MARKS, "").normalize("NFC");
  }
  return t;
}
/** `name.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)` (DataLoader.bestFirst). */
export const foldName = (s) => foldBase(s);
const WIDE = /[\uff01-\uff5e]/g;          // fullwidth ASCII (Foundation leaves U+3000 alone)
const foldWide = (s) => (ASCII.test(s) ? s : s.replace(WIDE, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));

// ------------------------------------------------------------------------------------------------ Norm (Search.swift)
export const typeSyn = { avenue: "ave", street: "st", boulevard: "blvd", road: "rd", drive: "dr", place: "pl", court: "ct", parkway: "pkwy",
  highway: "hwy", route: "rt", rte: "rt", lane: "ln", trail: "trl" };
export const syn = { north: "n", south: "s", east: "e", west: "w", saint: "st", mount: "mt", ...typeSyn };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const synOf = (w) => (has(syn, w) ? syn[w] : undefined);
const abbr = new Set(Object.values(syn));
const typeAbbr = new Set(Object.values(typeSyn));
const rev = {};
for (const [k, v] of Object.entries(syn)) (rev[v] ||= []).push(k);
const STOP = new Set(["the", "and", "of", "a"]);
/** Dish words that should also find the kind of place that serves them. */
const FOOD = {
  taco: [" taqueria", " mexican "], tacos: [" taco", " taqueria", " mexican "], burrito: [" mexican "], burritos: [" burrito", " mexican "],
  sushi: [" japanese "], ramen: [" japanese "], pho: [" vietnamese "], banh: [" vietnamese "], dumplings: [" dumpling", " chinese "],
  // " bar b q" covers Bar-B-Q and Bar B Que; " bar b" alone matched a name ending in Bar before "Bar & Pub" or a town starting with B
  burger: [" burgers "], burgers: [" burger"], bbq: [" barbecue", " bar b q"], barbecue: [" bbq"], wings: [" wing", " chicken "],
  donut: [" doughnut", " bakery "], donuts: [" donut", " doughnut", " bakery "], coffee: [" cafe", " espresso"], cafe: [" coffee"],
  pizza: [" pizzeria"], pizzeria: [" pizza"], beef: [" beef "], hot: [" hot "], curry: [" indian ", " thai "],
  gyro: [" gyros", " mediterranean "], gyros: [" gyro", " mediterranean "], falafel: [" mediterranean "], bagel: [" bagels", " bakery "],
};
/** Food emoji from the emoji keyboard, read as the word (raw() drops emoji, so "🍕" used to match everything). */
const EMOJI = {
  "🍕": "pizza", "🌮": "taco", "🌯": "burrito", "🍔": "burger", "🌭": "hot dog", "🍣": "sushi", "🍜": "ramen", "🍝": "italian",
  "☕": "coffee", "☕️": "coffee", "🍩": "donut", "🥯": "bagel", "🥐": "bakery", "🍰": "bakery", "🧁": "bakery", "🍦": "ice cream", "🍨": "ice cream",
  "🍗": "chicken", "🥟": "dumplings", "🥙": "gyro", "🧆": "falafel", "🍛": "curry", "🍺": "bar", "🍷": "wine", "🥩": "steak", "🦞": "seafood",
};
/** Norm.spellEmoji: food emoji read as the word. */
export function spellEmoji(s) {
  if (ASCII.test(s)) return s;
  const cs = chars(s);
  if (!cs.some((c) => has(EMOJI, c))) return s;
  return cs.map((c) => (has(EMOJI, c) ? ` ${EMOJI[c]} ` : c)).join("");
}
const ALNUM = /[\p{L}\p{M}\p{N}]/u;
const APOS = (u) => u === "'" || u === "\u2019" || u === "`";

/** Norm.words: lowercased, accent-free words; apostrophes dropped ("Al's" -> "als"); "B&B" -> "bb"; any script kept. With
 *  `marking`, also which words were typed with 's ("DiCola's" -> "dicolas", marked): the query also tries their stem. A lone
 *  's after a period ("D.A.'s") is then dropped instead of becoming a word "s". */
export function words(s, marking = false) {
  if (s == null || s === "") return { words: [], possessive: [] };
  const folded = foldBase(foldWide(s));
  const ws = [], marks = [];                    // with `marking`, one mark per entry in ws
  let cur = "", curMarked = false;
  const flush = () => {
    if (cur) { ws.push(cur); if (marking) marks.push(curMarked); cur = ""; }
    curMarked = false;
  };
  const take = (u) => {
    if (ALNUM.test(u)) cur += u;
    else if (APOS(u)) return;
    else if (u === "&") { flush(); ws.push("&"); if (marking) marks.push(false); }
    else flush();
  };
  if (marking) {
    // the query: look ahead for 's at the end of a word, "Sam's" (marked) or "D.A.'s" (the s is dropped)
    const us = Array.from(folded);
    let k = 0;
    while (k < us.length) {
      const u = us[k];
      if (APOS(u) && k + 1 < us.length && (us[k + 1] === "s" || us[k + 1] === "S") && (k + 2 === us.length || !ALNUM.test(us[k + 2]))) {
        if (cur === "") {
          const last = ws[ws.length - 1];
          if (last !== undefined && last !== "&") { k += 2; continue; }
        } else curMarked = true;
      }
      take(u);
      k += 1;
    }
  } else {
    for (const u of folded) take(u);           // place names, once each at load: no lookahead
  }
  flush();
  const out = [], outMarks = [];
  let k = 0;
  while (k < ws.length) {
    const w = ws[k];
    if (w === "&") {
      const last = out[out.length - 1];
      if (last !== undefined && len(last) === 1 && k + 1 < ws.length && len(ws[k + 1]) === 1) {
        out[out.length - 1] = last + ws[k + 1];
        if (marking) outMarks[outMarks.length - 1] = marks[k + 1];
        k += 2; continue;
      }
      out.push("and"); if (marking) outMarks.push(false);
    } else { out.push(w.toLowerCase()); if (marking) outMarks.push(marks[k]); }
    k += 1;
  }
  return { words: out, possessive: outMarks };
}
/** Norm.raw */
export const raw = (s) => words(s, false).words;
/** Norm.mapped: address words, normalized ("North Clark Street" -> "n clark st"). */
export const mapped = (s) => raw(s).map((w) => synOf(w) ?? w);

/** Norm.joins: each pair of adjacent words in each name, joined ("Skyway Dog House" adds "skywaydog" and "doghouse",
 *  "A P Deli" adds "ap"), never a pair with "and", "the", "of" or the article "a" ("a" among initials is a letter). */
export function joins(names) {
  const out = [];
  for (const w of names) {
    if (w.length <= 1) continue;
    const isStop = (i) => STOP.has(w[i]) && !(len(w[i]) === 1 && ((i > 0 && len(w[i - 1]) === 1) || (i + 1 < w.length && len(w[i + 1]) === 1)));
    for (let i = 0; i < w.length - 1; i++) if (!isStop(i) && !isStop(i + 1)) out.push(w[i] + w[i + 1]);
  }
  return out;
}
const NAME_SEP = /[\u00B7|;\n\r\u000B\u000C\u0085\u2028\u2029]/;
const trimSpaces = (x) => x.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, "");
/** Norm.names: a list of names as the data writes it ("A · B"; "|", ";" or a new line also separate), one name each. */
export const names = (s) => s.split(NAME_SEP).map(trimSpaces).filter((x) => x !== "");
/** Norm.extras: what a place's search texts add after their own words: its hidden search names (the optional "alt" column,
 *  never shown), then the joined adjacent words of every name. Each part is empty, or words each followed by a space. */
export function extras(nameWords, alt) {
  const altWords = alt.map(raw);
  const text = (ws) => (ws.length ? ws.join(" ") + " " : "");
  return { alt: text(altWords.flat()), joins: text(joins(nameWords.concat(altWords))) };
}
/** Norm.undoubled(_:tail:): doubled letters a–z collapsed ("yummi" -> "yumi"; digits and other letters stay), and how long
 *  the last `tail` characters (a place's joined words, after a space) are once collapsed. Closest matches only. */
export function undoubled(s, tail = 0) {
  const mark = s.length - tail;
  let out = "", at = 0, last = -1;
  for (let i = 0; i < s.length; i++) {
    if (i === mark) at = out.length;
    const c = s.charCodeAt(i);
    if (c === last && c >= 0x61 && c <= 0x7a) continue;
    out += s[i];
    last = c;
  }
  if (mark >= s.length) at = out.length;
  return { text: out, tail: out.length - at };
}
/** Norm.has(_:_:in:): whether `needle` lies wholly inside characters lo..<hi of `text`. */
function hasIn(text, needle, lo, hi) {
  lo = Math.max(0, lo); hi = Math.min(text.length, hi);
  if (needle.length > hi - lo) return false;
  if (!needle.length) return true;
  const i = text.indexOf(needle, lo);
  return i !== -1 && i + needle.length <= hi;
}

/** Token: one query word, needles any of which may match. The first `typed` are the word as typed (and its abbreviation or
 *  full form); the rest read it more loosely (food words, a stem, z as s, joined words). `whole`: each needle ending at a
 *  word end, for a place's joined words, which match only whole. */
export function makeToken(needles, typed) {
  return { needles, typed: Math.min(typed, needles.length), whole: needles.map((n) => (n.endsWith(" ") ? n : n + " ")) };
}
/** Token.undoubled: the same word for Closest matches, doubled letters collapsed, repeats dropped. */
export function undoubledToken(t) {
  const seen = new Set(), out = [];
  let typedOut = 0;
  t.needles.forEach((n0, k) => {
    const n = undoubled(n0).text;
    if (seen.has(n)) return;
    seen.add(n); out.push(n);
    if (k < t.typed) typedOut += 1;
  });
  return makeToken(out, typedOut);
}

// ------------------------------------------------------------------------------------------------ SearchIndex (Search.swift)
/** Neighborhood names people use, mapped to the city's 77 community areas. */
export const NEIGHBORHOODS = {
  "pilsen": ["Lower West Side"], "wicker park": ["West Town"], "ukrainian village": ["West Town"], "east village": ["West Town"],
  "noble square": ["West Town"], "river west": ["West Town", "Near West Side"], "bucktown": ["Logan Square"],
  "river north": ["Near North Side"], "gold coast": ["Near North Side"], "streeterville": ["Near North Side"],
  "magnificent mile": ["Near North Side"], "mag mile": ["Near North Side"], "old town": ["Near North Side", "Lincoln Park"],
  "west loop": ["Near West Side"], "fulton market": ["Near West Side"], "greektown": ["Near West Side"], "little italy": ["Near West Side"],
  "university village": ["Near West Side"], "south loop": ["Near South Side", "Loop"], "printers row": ["Loop", "Near South Side"],
  "chinatown": ["Armour Square"], "wrigleyville": ["Lake View"], "boystown": ["Lake View"], "northalsted": ["Lake View"],
  "lakeview": ["Lake View"], "lakeview east": ["Lake View"], "andersonville": ["Edgewater"], "roscoe village": ["North Center"],
  "ravenswood": ["Lincoln Square", "North Center"], "bronzeville": ["Douglas", "Grand Boulevard"], "little village": ["South Lawndale"],
  "la villita": ["South Lawndale"], "back of the yards": ["New City"], "buena park": ["Uptown"], "old irving park": ["Irving Park"],
  "depaul": ["Lincoln Park"], "sheffield": ["Lincoln Park"], "midway": ["Garfield Ridge", "Clearing"], "the loop": ["Loop"],
  "downtown": ["Loop", "Near North Side", "Near South Side"], "west ridge": ["West Ridge"], "devon avenue": ["West Ridge"],
  "little saigon": ["Uptown"], "argyle": ["Uptown"], "koreatown": ["Albany Park"], "swedish american": ["Edgewater"],
};
const SIDE_PHRASES = [
  ["far north side", "Far North"], ["far southwest side", "Far Southwest"], ["far southeast side", "Far Southeast"],
  ["northwest side", "Northwest"], ["southwest side", "Southwest"], ["north side", "North"], ["south side", "South"],
  ["west side", "West"], ["downtown", "Central"],
].map(([k, v]) => ({ key: mapped(k), name: v }));

export function makeIndex(hoods, cities, cuisines) {
  const known = new Set(hoods);
  const areas = hoods.map((h) => ({ key: mapped(h), names: [h] })).filter((x) => x.key.length > 1);
  const aliases = Object.entries(NEIGHBORHOODS).map(([k, v]) => ({ key: mapped(k), names: v.filter((h) => known.has(h)) })).filter((x) => x.names.length);
  const hoodPhrases = sortBy(areas.concat(aliases), (a, b) => a.key.length > b.key.length
    || (a.key.length === b.key.length && len(a.key.join("")) > len(b.key.join(""))));
  const cityPhrases = sortBy(cities.concat(["Chicago"]).map((c) => ({ key: mapped(c), name: c })), (a, b) => len(a.key.join("")) > len(b.key.join("")));
  const foodWords = new Set(cuisines.flatMap(mapped));
  for (const w of [...STOP, "other", "n", "s", "e", "w"]) foodWords.delete(w);
  for (const w of ["pizzas", "tacos", "burger", "donuts", "doughnuts", "coffee", "cafe", "bakery", "wings", "dogs", "ramen", "noodles",
    "bagels", "ice", "cream", "brunch", "sushi", "bbq"]) foodWords.add(w);
  const placeWords = new Set(hoods.concat(cities).flatMap(mapped).filter((w) => len(w) > 2));
  return { hoodPhrases, cityPhrases, sidePhrases: SIDE_PHRASES, foodWords, placeWords };
}

/** SearchIndex.variants: other spellings a typed word also finds, as whole words: the stem of a word typed with 's or of a
 *  word of 4+ letters ending in s ("DiCola's", "skillets"), and for a word of 5+ letters ending in z, the same with s. */
export function variants(word, possessive) {
  const out = [];
  const stem = (w) => { if (len(w) > 1 && w.endsWith("s") && (possessive || len(w) >= 4)) out.push(` ${w.slice(0, -1)} `); };
  stem(word);
  if (len(word) >= 5 && word.endsWith("z")) {
    const s = word.slice(0, -1) + "s";
    out.push(` ${s}`);
    stem(s);
  }
  return out;
}

/** SearchIndex.parse */
export function parse(index, text, scope) {
  const q = { text, tokens: [], hoods: new Set(), city: null, side: null, phraseRaw: null, isPlaceOrFood: false };
  let { words: rawW, possessive } = words(spellEmoji(text), true);
  let map = rawW.map((w) => synOf(w) ?? w);
  const find = (phrase) => {
    if (!phrase.length || phrase.length > map.length) return null;
    for (let i = 0; i <= map.length - phrase.length; i++) {
      let ok = true;
      for (let k = 0; k < phrase.length; k++) if (map[i + k] !== phrase[k]) { ok = false; break; }
      if (ok) return [i, i + phrase.length];
    }
    return null;
  };
  const free = (r) => !(r[1] < map.length && typeAbbr.has(map[r[1]]));
  const cut = (r) => {
    const w = rawW.slice(r[0], r[1]).join(" ");
    const drop = (a) => a.slice(0, r[0]).concat(a.slice(r[1]));
    rawW = drop(rawW); map = drop(map); possessive = drop(possessive);
    return w;
  };
  // the longest place named in the query: a Chicago neighborhood or, statewide, a town
  let best = null;
  if (scope === "chicago") for (const h of index.hoodPhrases) { const r = find(h.key); if (r && free(r)) { best = { r, names: h.names, isHood: true }; break; } }
  if (scope === "illinois") {
    for (const c of index.cityPhrases) {
      const r = find(c.key);
      if (r && free(r) && (best == null || r[1] - r[0] > best.r[1] - best.r[0])) { best = { r, names: [c.name], isHood: false }; break; }
    }
  }
  if (best) {
    if (best.isHood) q.hoods = new Set(best.names); else q.city = best.names[0];
    q.phraseRaw = cut(best.r);
  } else {
    for (const s of index.sidePhrases) { const r = find(s.key); if (r && free(r)) { q.side = s.name; q.phraseRaw = cut(r); break; } }
  }
  // "a" among initials ("A.P. Deli", "D.A.'s") is a letter, not the article
  const isStop = (i) => STOP.has(map[i]) && !(len(rawW[i]) === 1 && ((i > 0 && len(rawW[i - 1]) === 1) || (i + 1 < rawW.length && len(rawW[i + 1]) === 1)));
  let idx = rawW.map((_, i) => i);
  if (idx.some((i) => !isStop(i))) idx = idx.filter((i) => !isStop(i));
  const last = idx.length - 1;
  const tokens = [], typed = [], covers = [];   // per token: its needles, how many are the word as typed, the positions in rawW
  let joinedLast = false;
  let n = 0;
  while (n <= last) {
    const rt = rawW[idx[n]];
    const next = n < last ? rawW[idx[n + 1]] : null;
    const m = synOf(rt);
    if (m !== undefined) {                      // "north": N, or a word starting "north"
      tokens.push([` ${m} `, ` ${rt}`]); typed.push(2); covers.push([idx[n]]); n += 1; continue;
    }
    // "o hare" = "ohare"; not across a dropped "and" or "the" ("L and J", "Mrs. P & Me" keep their letters apart)
    if (len(rt) === 1 && next != null && idx[n + 1] === idx[n] + 1 && !abbr.has(rt) && synOf(next) === undefined) {
      tokens.push([` ${rt}${next}`, ` ${rt} ${next}`]); typed.push(2); covers.push([idx[n], idx[n + 1]]);
      n += 2; if (n - 1 === last) joinedLast = true; continue;
    }
    const isAbbr = abbr.has(rt) && (n < last || len(rt) > 1);
    const whole = isAbbr || (len(rt) <= 2 && n < last);
    const v = [" " + rt + (whole ? " " : "")];
    if (isAbbr) for (const w of rev[rt] || []) v.push(` ${w} `);
    if (n === last && len(rt) >= 3) for (const [k, a] of Object.entries(typeSyn)) if (k !== rt && k.startsWith(rt)) v.push(` ${a} `);
    typed.push(v.length);
    if (has(FOOD, rt)) v.push(...FOOD[rt]);    // "tacos" also finds taquerias
    if (!isAbbr) v.push(...variants(rt, possessive[idx[n]]));
    tokens.push(v);
    covers.push([idx[n]]);
    n += 1;
  }
  // "north ave", "halsted st": a finished street type sticks to the word before it ("king dr" also finds "King Jr Dr"),
  // unless a dropped word stood between them ("Down the Street", "Mousie's On The Boulevard")
  if (last >= 1 && !joinedLast && idx[last] === idx[last - 1] + 1 && typeAbbr.has(map[idx[last]]) && tokens.length >= 2) {
    const mp = map[idx[last - 1]], ma = map[idx[last]], rp = rawW[idx[last - 1]], ra = rawW[idx[last]];
    tokens.splice(tokens.length - 2, 2); typed.splice(typed.length - 2, 2);
    tokens.push([` ${mp} ${ma} `, ` ${mp} jr ${ma} `, ` ${rp} ${ra}`]); typed.push(3);
    covers.splice(covers.length - 2, 2);
    covers.push([idx[last - 1], idx[last]]);
  }
  // two words typed apart may be one word in the name ("fat burger" finds Fatburger, "a huevo" Ahuevo): either word's token
  // also takes the pair joined, loosely; not street and direction words, and not "and", "the" or "of"
  const joinable = (w) => synOf(w) === undefined && !abbr.has(w) && (w === "a" || !STOP.has(w));
  for (let i = 0; i + 1 < rawW.length; i++) {
    if (!joinable(rawW[i]) || !joinable(rawW[i + 1])) continue;
    const joined = ` ${rawW[i]}${rawW[i + 1]}`;
    for (let t = 0; t < tokens.length; t++) {
      const c = covers[t];
      if (c.length === 1 && (c[0] === i || c[0] === i + 1) && !tokens[t].includes(joined)) tokens[t].push(joined);
    }
  }
  q.tokens = tokens.map((v, t) => makeToken(v, typed[t]));
  q.isPlaceOrFood = idx.length > 0 && idx.every((i) => index.foodWords.has(map[i]) || index.placeWords.has(map[i]));
  return q;
}
export const queryEmpty = (q) => !q.tokens.length && !q.hoods.size && q.city == null && q.side == null;

/** SearchIndex.has: whether a place's search or name text has the word: any needle among its own words and hidden alt
 *  names (which end `joinLen` characters before the end), or a needle whole among its joined words, the last `joinLen`. */
export function hasToken(text, t, joinLen) {
  const end = text.length, joinStart = Math.max(0, end - joinLen);
  for (let k = 0; k < t.needles.length; k++) {
    if (hasIn(text, t.needles[k], 0, joinStart)) return true;
    if (joinLen > 0 && hasIn(text, t.whole[k], joinStart - 1, end)) return true;
  }
  return false;
}
/** SearchIndex.hasAsTyped: whether the place's own words (name, aka, brand: not its alt names or joined words) have the word as typed. */
function hasAsTyped(p, t) {
  const own = Math.max(0, p.nameText.length - p.altLen - p.joinLen);
  for (let k = 0; k < t.typed; k++) if (hasIn(p.nameText, t.needles[k], 0, own)) return true;
  return false;
}
/** SearchIndex.inArea: in the neighborhood, town or side the query names, or with those words in its name ("Pilsen Yards"). */
export function inArea(p, q) {
  if (!q.hoods.size && q.city == null && q.side == null) return true;
  const phrase = ` ${q.phraseRaw ?? ""} `;
  if (q.hoods.size && !q.hoods.has(p.hood ?? "") && !p.nameText.includes(phrase)) return false;
  if (q.city != null && p.city !== q.city && !p.nameText.includes(phrase)) return false;
  if (q.side != null && p.side !== q.side && !p.nameText.includes(phrase)) return false;
  return true;
}
/** SearchIndex.matches */
export function matches(p, q) {
  if (!inArea(p, q)) return false;
  for (const t of q.tokens) if (!hasToken(p.searchText, t, p.joinLen)) return false;
  return true;
}
/** SearchIndex.nameMatch: "typed" when the place's own words have every query word as typed ("wingz": Wingz It Iz), "loose"
 *  when some only through a looser reading, a hidden alt name or joined words ("wingz": Wingstop), else null. */
export function nameMatch(p, q) {
  for (const t of q.tokens) if (!hasToken(p.nameText, t, p.joinLen)) return null;
  return q.tokens.every((t) => hasAsTyped(p, t)) ? "typed" : "loose";
}

// ------------------------------------------------------------------------------------------------ Filters (Board.swift)
export function newFilters(o = {}) {
  return { sides: new Set(o.sides || []), hood: o.hood ?? null, cuisine: o.cuisine ?? null, grades: new Set(o.grades || []),
    liquor: !!o.liquor, dineIn: !!o.dineIn, hideChains: !!o.hideChains, includeVenues: !!o.includeVenues, city: o.city ?? null };
}
export const activeCount = (f) => f.sides.size + (f.hood == null ? 0 : 1) + (f.cuisine == null ? 0 : 1) + f.grades.size + (f.liquor ? 1 : 0)
  + (f.dineIn ? 1 : 0) + (f.hideChains ? 1 : 0) + (f.includeVenues ? 1 : 0) + (f.city == null ? 0 : 1);
/** Filters that come from City records, so they leave out the rest of Illinois (Finder.near, SearchTab.caption). */
export const chicagoOnly = (f) => f.grades.size > 0 || f.sides.size > 0 || f.hood != null || f.liquor || f.dineIn;
export function passes(f, p) {
  if (!f.includeVenues && p.venue) return false;
  if (f.hideChains && p.isChain) return false;
  if (f.cuisine != null && p.cuisine !== f.cuisine) return false;
  if (p.isChicago) {
    if (f.sides.size && !f.sides.has(p.side ?? "")) return false;
    if (f.hood != null && p.hood !== f.hood) return false;
    if (f.grades.size && !(p.grade != null && f.grades.has(p.grade))) return false;
    if (f.liquor && p.liquor !== true) return false;
    if (f.dineIn && p.dineIn !== true) return false;
  } else if (f.city != null && p.city !== f.city) return false;
  return true;
}
export function filtersEqual(a, b) {
  const set = (x, y) => x.size === y.size && [...x].every((v) => y.has(v));
  return set(a.sides, b.sides) && a.hood === b.hood && a.cuisine === b.cuisine && set(a.grades, b.grades) && a.liquor === b.liquor
    && a.dineIn === b.dineIn && a.hideChains === b.hideChains && a.includeVenues === b.includeVenues && a.city === b.city;
}

// ------------------------------------------------------------------------------------------------ Fmt (Place.swift)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
/** A "yyyy-MM-dd" date as DateFormatter.iso reads it (Fmt.date, AsOf): a real calendar day, its month and day written with one
 *  digit or two. Null otherwise. (Foundation also takes odder spellings, "2026/09/01"; the data never has them.) */
function isoDay(s) {
  const m = ISO.exec(s || "");
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return null;
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);              // not Date.UTC, which reads years 0–99 as 1900–1999
  return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t : null;
}
const pad = (v, n) => String(v).padStart(n, "0");
/** Round half away from zero, like Swift's `.rounded()`. */
export const roundAway = (x) => Math.sign(x) * Math.round(Math.abs(x));
// printf's %.nf rounds an exact binary tie to even; Number.toFixed rounds it up, so ties are found exactly and fixed.
function exactHalf(x, f) {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0), lo = dv.getUint32(4), ex = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), e;
  if (ex === 0) e = -1074; else { m |= 1n << 52n; e = ex - 1075; }
  let num = m * 10n ** BigInt(f) * 2n;
  if (e >= 0) num <<= BigInt(e);
  else { const d = 1n << BigInt(-e); if (num % d !== 0n) return false; num /= d; }
  return num % 2n === 1n;
}
/** String(format: "%.<f>f", x) */
export function printfFixed(x, f) {
  if (!Number.isFinite(x)) return String(x);
  if (exactHalf(x, f)) {
    const scaled = Math.abs(x) * 10 ** f;             // exact here: x·10^f is a half-integer
    let n = Math.floor(scaled);
    if (n % 2 === 1) n += 1;
    const s = (n / 10 ** f).toFixed(f);
    return (x < 0 && n !== 0 ? "-" : "") + s;
  }
  return x.toFixed(f);
}
/** ICU's number formatting (Swift's `.formatted(.number.precision(.fractionLength(n)))`): half-even on the shortest decimal. */
export function icuFixed(x, f) {
  const s = String(Math.abs(x));
  if (/e/.test(s)) return (x < 0 ? "-" : "") + Math.abs(x).toFixed(f);
  const [ip, fp = ""] = s.split(".");
  if (fp.length <= f) return (x < 0 ? "-" : "") + ip + (f ? "." + fp.padEnd(f, "0") : "");
  const digits = BigInt(ip + fp.slice(0, f));
  const rest = fp.slice(f);
  let up = rest[0] > "5" || (rest[0] === "5" && /[1-9]/.test(rest.slice(1)));
  if (rest[0] === "5" && !/[1-9]/.test(rest.slice(1))) up = digits % 2n === 1n;
  const d = (digits + (up ? 1n : 0n)).toString().padStart(f + 1, "0");
  const out = f ? d.slice(0, d.length - f) + "." + d.slice(d.length - f) : d;
  return (x < 0 && /[1-9]/.test(out) ? "-" : "") + out;
}
const group = (n) => n.toLocaleString("en-US");
export const Fmt = {
  money(v) {
    if (v == null) return "—";
    const a = Math.abs(v);
    if (a >= 1e9) return "$" + printfFixed(v / 1e9, 2) + "B";
    if (a >= 1e6) return "$" + printfFixed(v / 1e6, a >= 1e8 ? 0 : 1) + "M";
    if (a >= 1e3) return `$${roundAway(v / 1e3)}K`;
    return `$${v}`;
  },
  number: (v) => (v == null ? "—" : group(v)),
  date(iso) {
    const d = isoDay(iso);
    return d ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : "—";
  },
  /** The City's result exactly as the City writes it. */
  result: (r) => (r == null || r === "" ? "—" : r),
  /** Splits "a; b (c; d); e" on "; " only outside parentheses. */
  items(s) {
    const out = [];
    let cur = "", depth = 0;
    const cs = chars(s);
    for (let i = 0; i < cs.length; i++) {
      const ch = cs[i];
      if (ch === "(") depth += 1; else if (ch === ")") depth = Math.max(depth - 1, 0);
      if (ch === ";" && depth === 0 && cs[i + 1] === " ") { i += 1; out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, "")).filter((x) => x);
  },
};
/** Swift `v.map { String(format: "%.1f", $0) } ?? "—"` */
export const perVisit = (v) => (v == null ? "—" : printfFixed(v, 1));
/** "—" when the City has no matched license record: unknown isn't "No". */
export const yesNo = (v) => (v == null ? "—" : v ? "Yes" : "No");

// ------------------------------------------------------------------------------------------------ AsOf and boards (Board.swift)
export const RECENT_FAIL_DAYS = 90;
/** AsOf: the data's own records date, which time-based board rules count back from (never the clock). Failed latest lists
 *  fails dated on or after `failsFrom` (yyyy-MM-dd), RECENT_FAIL_DAYS before it; "" when the data has no date (every fail). */
export function asOf(recordsThrough) {
  const d = isoDay(recordsThrough);
  let failsFrom = "";
  if (d) {
    d.setUTCDate(d.getUTCDate() - RECENT_FAIL_DAYS);
    failsFrom = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
  }
  return { recordsThrough, failsFrom };
}

const cmp = (x, y, desc) => (x === y ? null : desc ? x > y : x < y);
const cmpS = (x, y, desc) => { const c = cmpStr(x, y); return c === 0 ? null : desc ? c > 0 : c < 0; };
const nameLess = (a, b) => cmpStr(a.nameNFC, b.nameNFC) < 0;
const collator = typeof Intl !== "undefined" ? new Intl.Collator("en-US", { sensitivity: "accent" }) : null;
const tie = (a, b) => cmp(a.score ?? -1, b.score ?? -1, true) ?? nameLess(a, b);

export const GRADES_ORDER = ["A", "B", "C", "D", "F"];
export const BOARD_IDS = ["cleanest", "worst", "recentFails", "pests", "iconic", "honors", "oldest", "newest", "building", "sales"];
export const BOARDS = {
  cleanest: { title: "Cleanest", short: "Cleanest", icon: "seal",
    eligible: (p) => (p.visits ?? 0) >= 2 && p.score != null && !p.failedSince,
    before: (a, b) => cmp(a.score, b.score, true) ?? cmp(a.visits ?? 0, b.visits ?? 0, true) ?? nameLess(a, b) },
  worst: { title: "Lowest scores", short: "Lowest", icon: "warn", negative: true,
    eligible: (p) => (p.visits ?? 0) >= 2 && p.score != null,
    before: (a, b) => cmp(a.score, b.score, false) ?? cmp(a.fails ?? 0, b.fails ?? 0, true) ?? cmp(a.pests ?? 0, b.pests ?? 0, true) ?? nameLess(a, b) },
  recentFails: { title: "Failed latest", short: "Failed latest", icon: "octagon", negative: true,
    // recent fails only, and never one the City has since passed
    eligible: (p, as) => p.lastResult === "Fail" && !p.passedSince && cmpStr(p.lastDate ?? "", as.failsFrom) >= 0,
    before: (a, b) => cmpS(a.lastDate ?? "", b.lastDate ?? "", true) ?? cmp(a.score ?? 100, b.score ?? 100, false) ?? nameLess(a, b) },
  pests: { title: "Pest citations", short: "Pests", icon: "ant", negative: true,
    eligible: (p) => (p.pests ?? 0) > 0,
    before: (a, b) => cmp(a.pests ?? 0, b.pests ?? 0, true) ?? cmpS(a.lastDate ?? "", b.lastDate ?? "", true) ?? nameLess(a, b) },
  iconic: { title: "Most iconic", short: "Iconic", icon: "star",
    eligible: (p) => (p.iconPts ?? 0) > 0,
    before: (a, b) => cmp(a.iconPts ?? 0, b.iconPts ?? 0, true) ?? tie(a, b) },
  honors: { title: "Michelin & Beard", short: "Michelin & Beard", icon: "rosette",
    eligible: (p) => p.isHonored,
    before: (a, b) => cmp(a.stars ?? 0, b.stars ?? 0, true) ?? cmp(a.jbf != null ? 1 : 0, b.jbf != null ? 1 : 0, true) ?? cmp(a.bib ? 1 : 0, b.bib ? 1 : 0, true)
      ?? cmp(a.iconPts ?? 0, b.iconPts ?? 0, true) ?? nameLess(a, b) },
  oldest: { title: "Oldest", short: "Oldest", icon: "hourglass",
    eligible: (p) => p.since != null,
    before: (a, b) => cmp(a.since, b.since, false) ?? cmp(a.iconPts ?? 0, b.iconPts ?? 0, true) ?? tie(a, b) },
  newest: { title: "Newest", short: "Newest", icon: "sparkles",
    eligible: (p) => p.since != null,
    before: (a, b) => {
      const byYear = cmp(a.since, b.since, true);
      if (byYear != null) return byYear;
      // only a year is known, so same-year places go A to Z (localizedCaseInsensitiveCompare)
      const byName = collator ? collator.compare(a.name, b.name) : a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return byName === 0 ? cmpStr(a.id, b.id) < 0 : byName < 0;
    } },
  building: { title: "Building value", short: "Building value", icon: "building",
    eligible: (p) => p.bldg != null,
    before: (a, b) => cmp(a.bldg, b.bldg, true) ?? tie(a, b) },
  sales: { title: "Top published sales", short: "Top sales", icon: "dollar",
    eligible: (p) => p.sales != null,
    before: (a, b) => cmp(a.sales, b.sales, true) ?? nameLess(a, b) },
};
for (const id of BOARD_IDS) { BOARDS[id].id = id; BOARDS[id].negative = !!BOARDS[id].negative; }

/** Board.explainer(recordsThrough:) */
export function explainer(id, recordsThrough) {
  const through = recordsThrough ? ` through ${Fmt.date(recordsThrough)}` : "";
  const as = recordsThrough ? `, as of ${Fmt.date(recordsThrough)},` : "";
  // the window exactly as the board applies it: a fail dated on or after records date − 90 days. Without a records date the
  // board keeps every fail, so the text claims no window.
  const failsFrom = asOf(recordsThrough).failsFrom;
  const window = failsFrom === "" ? "" : `, counting only fails dated ${Fmt.date(failsFrom)} or later (${RECENT_FAIL_DAYS} days before that date)`;
  // only the negative boards' rows show results (Cleanest rows show neighborhood and cuisine)
  const rows = id === "worst" ? " Each row shows the latest City result in our records, and any newer City result from after our records date." : "";
  switch (id) {
    case "cleanest": case "worst":
      return `Our 0–100 score, not an official City grade. Based on City of Chicago inspections from January 2023${through}: failed inspections, pest citations, serious food-safety violations, violations per visit, passes with conditions, and whether the last visit failed. Places need at least two inspections.${rows}`;
    case "recentFails":
      // the app hears of a newer result only from our data, which we update about weekly; never "as soon as the City posts"
      return `Places whose most recent City of Chicago inspection on record${as} was a Fail${window}. A place leaves this list once our data shows a newer passing City result (we update the data about once a week). Many places pass a re-inspection within days. Tap a place to see the City's record for anything newer. The number on each row is our 0–100 score, not an official City score.`;
    case "pests":
      return "City of Chicago inspections since January 2023 whose citation describes rodents, insects or signs of them. Door gaps and missing pest-control logs aren't counted, and a citation repeated at the next visit counts once. A citation records what the inspector found that day; it may since have been corrected.";
    case "iconic":
      return "Points for staying power (years open, from city license records and verified histories) and honors: Michelin stars and Bib Gourmand, James Beard awards and America's Classics, and long-running icons.";
    case "honors":
      return "Michelin Guide Chicago 2025 stars and Bib Gourmands, and James Beard Foundation winners, finalists and America's Classics, checked by hand.";
    case "oldest":
      return "Year opened at this address, from verified histories where we have them; otherwise the earliest City of Chicago license or inspection here. City records start in 2002, so older places without a history show “by 2002”. Records give only a year, so within a year the most iconic places come first.";
    case "newest":
      return "Year opened at this address, from verified histories where we have them; otherwise the earliest City of Chicago license or inspection here. Records give only a year, not a date, so places from the same year are listed A to Z.";
    case "building":
      return "Estimated market value of the whole property at the address (Cook County Assessor, 2025). For a tower, that's the whole tower, not the restaurant. ≈ marks the nearest parcel on the block when the exact address has none.";
    case "sales":
      return "Only places whose yearly sales were publicly reported, about two dozen in all. Most restaurants don't publish sales. Each figure is the latest year published for that place, so the years differ; each row shows its year. “est.” means the publisher estimated the figure; “approx.” means the company gave a rounded figure.";
  }
  return "";
}
/** Board.note: one always-visible line for boards whose order needs a caveat the rows can't show. */
export const NOTES = {
  newest: "Records give only the year, so same-year places are listed A to Z.",
  oldest: "Records give only the year; within a year, the most iconic come first.",
  sales: "Figures are from different years; each row shows its year.",
};

/** Board.metric: the big number on the right of a row, and its label. `recordsYear` is Fmt.recordsYear. */
export function metric(id, p, recordsYear) {
  switch (id) {
    case "cleanest": case "worst": return [String(p.score ?? 0), "inspection score"];
    case "recentFails": return [p.score != null ? String(p.score) : "—", "our score"];
    case "pests": return [String(p.pests ?? 0), (p.pests ?? 0) === 1 ? "pest citation" : "pest citations"];
    case "iconic": return [String(roundAway(p.iconPts ?? 0)), "iconic points"];
    case "honors":
      if (p.stars != null && p.stars > 0) return [String(p.stars), p.stars === 1 ? "Michelin star" : "Michelin stars"];
      if (p.jbf != null) return ["JBF", p.jbf.includes("America's Classic") ? "America's Classic" : "James Beard"];
      return ["Bib", "Michelin Bib Gourmand"];
    case "oldest": case "newest": {
      if (p.sinceFloor) return ["≤2002", "licensed by 2002"];
      const now = recordsYear ?? new Date().getFullYear();
      const y = now - (p.since ?? now);
      return [String(p.since ?? 0), p.sinceVerified ? (y <= 0 ? `opened ${now}` : `${y} yrs`) : "first city record"];
    }
    case "building": return [(p.bldgExact === false ? "≈" : "") + Fmt.money(p.bldg), p.bldgExact === false ? "nearest parcel" : "property value"];
    case "sales": {
      const kind = p.salesLabel != null && p.salesLabel.includes("(approx.)") ? "approx. " : p.salesKind === "reported" ? "" : "est. ";
      return [Fmt.money(p.sales), kind + (p.salesYear != null ? `${p.salesYear} sales` : "sales/yr")];
    }
  }
  return ["", ""];
}

/** RankRow.resultLine: with a newer City result on the next line, this one is only the latest in our records, and says so. */
export const resultLine = (p) => `${p.newerResult == null ? "City's latest result" : "Latest in our records"}: ${Fmt.result(p.lastResult)}, ${Fmt.date(p.lastDate)}`;
/** RankRow.newerLine: a City result after the records date, so the row doesn't read as if the one above were still the newest. */
export const newerLine = (p) => (p.newerResult != null && p.newerDate != null ? `Newer City result: ${Fmt.result(p.newerResult)}, ${Fmt.date(p.newerDate)}` : null);

/** DataStore.ranked: eligible places in the list's own order (best score first), then the board's order. */
export function ranked(data, id, filters) {
  const b = BOARDS[id];
  return sortBy(data.chicago.filter((p) => passes(filters, p) && b.eligible(p, data.asOf)), b.before);
}
export function boardCount(data, id, filters) {
  const b = BOARDS[id];
  let n = 0;
  for (const p of data.chicago) if (passes(filters, p) && b.eligible(p, data.asOf)) n += 1;
  return n;
}

// ------------------------------------------------------------------------------------------------ HomeCard (HomeView.swift)
export const HOT_DOG_CUISINE = "Hot Dogs & Beef";
export const HOME_CARDS = [
  { id: "cleanest", title: "Cleanest Kitchens", sub: "Top inspection scores, graded A–F from City records", board: "cleanest", filters: {}, icon: "seal", signature: true },
  { id: "hotDogs", title: "Hot Dogs & Beef", sub: "Chicago dogs and Italian beef, ranked by inspection score", board: "cleanest", filters: { cuisine: HOT_DOG_CUISINE }, icon: "hotdog", signature: true },
  { id: "honors", title: "Michelin & Beard", sub: "Michelin stars, Bib Gourmands and James Beard honorees", board: "honors", filters: {}, icon: "rosette", signature: true },
  { id: "iconic", title: "Chicago Icons", sub: "Long-running institutions and honored kitchens", board: "iconic", filters: {}, icon: "star", signature: true, noCount: true },
  { id: "oldest", title: "Oldest Places", sub: "Opening years from histories and City records", board: "oldest", filters: {}, icon: "hourglass", noCount: true },
  { id: "newest", title: "Newest Openings", sub: "By opening year or year of first City record", board: "newest", filters: {}, icon: "sparkles", noCount: true },
  { id: "watch", title: "Inspection Watch", sub: "Places whose latest City inspection failed, in the last 90 days", board: "recentFails", filters: {}, icon: "warn" },
  { id: "building", title: "Building Value", sub: "Most valuable properties, from the Cook County Assessor", board: "building", filters: {}, icon: "building" },
  { id: "sales", title: "Top Sales", sub: "Highest yearly sales that were publicly reported", board: "sales", filters: {}, icon: "dollar" },
  { id: "nearMe", title: "Near Me", sub: "Everything around you, closest first", near: true, icon: "location", noCount: true },
  { id: "all", title: "All Restaurants", sub: "Search nearly every restaurant, café, bakery and tavern in the city", search: "chicago", icon: "fork", noCount: true },
  { id: "illinois", title: "Rest of Illinois", sub: "Restaurants across the rest of the state. No grades outside Chicago.", search: "illinois", icon: "map" },
];

// ------------------------------------------------------------------------------------------------ DataLoader (DataStore.swift)
function table(obj, name) {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.cols) || !Array.isArray(obj.rows)) throw new Error(`The ${name} data couldn't be read.`);
  const cols = {};
  obj.cols.forEach((c, i) => { if (!(c in cols)) cols[c] = i; });
  return { cols, rows: obj.rows, meta: obj.meta && typeof obj.meta === "object" ? obj.meta : {} };
}
const strList = (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v : []);
function reader(c) {
  const v = (row, k) => { const i = c[k]; if (i === undefined || i >= row.length) return null; const x = row[i]; return x === null ? null : x; };
  const num = (x) => (typeof x === "number" ? x : typeof x === "boolean" ? (x ? 1 : 0) : null);
  return {
    v,
    s: (row, k) => { const x = v(row, k); return typeof x === "string" && x !== "" ? x : null; },
    i: (row, k) => { const x = num(v(row, k)); return x == null ? null : Math.trunc(x); },
    d: (row, k) => num(v(row, k)),
    b: (row, k) => { const x = num(v(row, k)); return x != null && Math.trunc(x) !== 0; },
    ob: (row, k) => { const x = num(v(row, k)); return x == null ? null : Math.trunc(x) !== 0; },
    /** The optional "alt" column: other names people search a place by, for search only, never shown. One string (names
     *  apart with " · ", "|", ";" or a new line) or a list of strings. */
    alt: (row) => {
      const x = v(row, "alt");
      if (typeof x === "string") return names(x);
      if (Array.isArray(x)) return x.filter((s) => typeof s === "string").flatMap(names);
      return [];
    },
  };
}
const pick = (list, i) => (i != null && i >= 0 && i < list.length ? list[i] : null);
/** Only http(s) websites become a link. The app takes any URL(string:); the data only ever has https, and a page link must
 *  never carry another scheme (javascript:). */
function webURL(s) {
  if (s == null || !/^https?:\/\//i.test(s)) return null;
  try { return new URL(s).protocol.startsWith("http") ? s : null; } catch { return null; }
}
function finishPlace(p) {
  p.nameNFC = nfc(p.name);
  p.isHonored = (p.stars ?? 0) > 0 || p.bib || p.jbf != null;
  p.passedSince = p.newerResult === "Pass" || p.newerResult === "Pass w/ Conditions";
  p.failedSince = p.newerResult === "Fail";
  p.isChain = p.chain >= 5;
  p.placeLine = p.isChicago ? [p.hood, "Chicago"].filter((x) => x != null).join(", ") : p.city;
  return p;
}
/** Words of a value many places share (cuisine, neighborhood, side, town, brand), normalized once per load. */
function sharedWords() {
  const memo = new Map();
  return (value) => {
    if (value == null) return [];
    let w = memo.get(value);
    if (!w) { w = raw(value); memo.set(value, w); }
    return w;
  };
}
/** The two search texts, " own words " then the hidden alt names, then the joined words (searched, never shown).
 *  altLen / joinLen say where those two parts start, in characters from the end (Place.altBytes / joinBytes). */
function setTexts(p, hay, own, ex) {
  p.searchText = " " + hay.join(" ") + " " + ex.alt + ex.joins;
  p.nameText = " " + own.join(" ") + " " + ex.alt + ex.joins;
  p.altLen = ex.alt.length;
  p.joinLen = ex.joins.length;
}

/** DataLoader.loadAll's Chicago half. */
export function parseChicago(obj) {
  const chi = table(obj, "Chicago");
  const hoods = strList(chi.meta.hoods), sides = strList(chi.meta.sides), cuisines = strList(chi.meta.cuisines);
  const through = typeof chi.meta.records_through === "string" ? chi.meta.records_through : "";
  const { s, i, d, b, ob, alt } = reader(chi.cols);
  const shared = sharedWords();
  const out = [];
  for (const row of chi.rows) {
    if (!Array.isArray(row)) continue;
    const id = s(row, "id"), name = s(row, "name");
    if (id == null || name == null) continue;
    const hood = pick(hoods, i(row, "hood"));
    const p = { id, name, addr: s(row, "addr"), zip: s(row, "zip"), lat: d(row, "lat"), lon: d(row, "lon"), city: "Chicago", hood,
      side: pick(sides, i(row, "side")), cuisine: pick(cuisines, i(row, "cuisine")) ?? "American & Other", brand: s(row, "brand"),
      chain: i(row, "chain") ?? 1, venue: b(row, "venue"), isChicago: true, web: webURL(s(row, "web")) };
    p.dineIn = ob(row, "dinein"); p.liquor = ob(row, "liquor"); p.patio = ob(row, "patio"); p.late = ob(row, "late");
    p.since = i(row, "since"); p.sinceFloor = b(row, "sinceFloor"); p.sinceVerified = b(row, "sinceVerified");
    p.risk = i(row, "risk"); p.visits = i(row, "visits"); p.fails = i(row, "fails"); p.passCond = i(row, "passCond");
    p.violPer = d(row, "violPer"); p.seriousPer = d(row, "seriousPer"); p.pests = i(row, "pests");
    p.complaints = i(row, "complaints"); p.lastDate = s(row, "lastDate"); p.lastResult = s(row, "lastResult");
    // a newer result needs its date, and a date after the records date; anything else would contradict the row
    p.newerResult = null; p.newerDate = null;
    const nr = s(row, "newerResult"), nd = s(row, "newerDate");
    if (nr != null && nd != null && cmpStr(nd, through) > 0) { p.newerResult = nr; p.newerDate = nd; }
    p.score = i(row, "score");
    const g = s(row, "grade");
    p.grade = g != null && ["A", "B", "C", "D", "F"].includes(g) ? g : null;
    p.bldg = i(row, "bldg"); p.bldgClass = s(row, "bldgClass"); p.bldgExact = ob(row, "bldgExact");
    p.stars = i(row, "stars"); p.bib = b(row, "bib"); p.green = b(row, "green");
    p.jbf = s(row, "jbf"); p.honors = s(row, "honors"); p.icon = s(row, "icon"); p.iconPts = d(row, "iconPts");
    p.sales = i(row, "sales"); p.salesYear = i(row, "salesYear"); p.salesLabel = s(row, "salesLabel"); p.salesKind = s(row, "salesKind");
    p.aka = s(row, "aka");                     // the City's other names, "A · B", shown as is
    // search text: " name aka cuisine hood brand zip side address ", then the hidden names and joined words
    const nameWords = raw(name), brandWords = raw(p.brand);
    const akaNames = (p.aka != null ? names(p.aka) : []).map(raw), akaWords = akaNames.flat();
    const ex = extras([nameWords, ...akaNames, brandWords], alt(row));
    const hay = nameWords.concat(akaWords, shared(p.cuisine), shared(hood), brandWords, raw(p.zip),
      shared(p.side == null ? null : p.side === "Central" ? "Downtown" : `${p.side} Side`), mapped(p.addr));
    setTexts(p, hay, nameWords.concat(akaWords, brandWords), ex);
    out.push(finishPlace(p));
  }
  return { chicago: bestFirst(out), hoods, sides, cuisines, recordsThrough: through, rows: chi.rows.length, meta: chi.meta };
}

/** DataLoader.loadAll's rest-of-Illinois half. */
export function parseIllinois(obj) {
  const il = table(obj, "Illinois");
  const cuisines = strList(il.meta.cuisines), citiesMeta = strList(il.meta.cities), brands = strList(il.meta.brands);
  const { s, i, d, b, alt } = reader(il.cols);
  const shared = sharedWords();
  const out = [];
  const taken = new Map();
  for (const row of il.rows) {
    if (!Array.isArray(row)) continue;
    const name = s(row, "name");
    if (name == null) continue;
    const city = pick(citiesMeta, i(row, "city")) ?? "Illinois";
    const brand = pick(brands, i(row, "brand"));
    const lat = d(row, "lat"), lon = d(row, "lon");
    const nameWords = raw(name);                // normalized once, for the id and the name search
    let id = illinoisID(nameWords, lat, lon);
    const n = taken.get(id);
    if (n !== undefined) { taken.set(id, n + 1); id += `-${n + 1}`; } else taken.set(id, 1);
    const p = { id, name, addr: s(row, "addr"), zip: s(row, "zip"), lat, lon, city, hood: null, side: null,
      cuisine: pick(cuisines, i(row, "cuisine")) ?? "American & Other", brand, chain: i(row, "chain") ?? 1, venue: b(row, "venue"),
      isChicago: false, web: webURL(s(row, "web")) };
    for (const k of ["dineIn", "liquor", "patio", "late", "since", "risk", "visits", "fails", "passCond", "violPer", "seriousPer", "pests",
      "complaints", "lastDate", "lastResult", "score", "grade", "newerResult", "newerDate", "bldg", "bldgClass", "bldgExact", "stars", "jbf",
      "honors", "icon", "iconPts", "sales", "salesYear", "salesLabel", "salesKind", "aka"]) p[k] = null;
    p.sinceFloor = false; p.sinceVerified = false; p.bib = false; p.green = false;
    const brandWords = shared(brand);
    const ex = extras([nameWords, brandWords], alt(row));
    const hay = nameWords.concat(shared(city), raw(p.zip), shared(p.cuisine), brandWords, mapped(p.addr));
    setTexts(p, hay, nameWords.concat(brandWords), ex);
    out.push(finishPlace(p));
  }
  // towns biggest first, so a lookup lands on the main spelling
  const count = new Map();
  for (const p of out) if (!p.venue) count.set(p.city, (count.get(p.city) || 0) + 1);
  const cities = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || cmpStr(nfc(a), nfc(b)));
  return { illinois: bestFirst(out), cuisines, cities, overtureRelease: typeof il.meta.overture_release === "string" ? il.meta.overture_release : "",
    rows: il.rows.length, meta: il.meta };
}

/** Best score first, then name, then file order (DataLoader.bestFirst). */
export function bestFirst(list) {
  const nm = list.map((p) => nfc(foldName(p.name)));
  const idx = list.map((_, i) => i);
  idx.sort((a, b) => {
    const sa = list[a].score ?? -1, sb = list[b].score ?? -1;
    if (sa !== sb) return sa > sb ? -1 : 1;
    const c = cmpStr(nm[a], nm[b]);
    return c !== 0 ? c : a - b;
  });
  return idx.map((i) => list[i]);
}

/** "il:" + FNV-1a 64 of the normalized name and the location rounded to about 100 m (DataLoader.illinoisID). */
export function illinoisID(nameWords, lat, lon) {
  const milli = (v) => (v == null ? "" : String(roundAway(v * 1000)));
  const bytes = new TextEncoder().encode(nameWords.join(" ") + "|" + milli(lat) + "|" + milli(lon));
  let hi = 0xcbf29ce4, lo = 0x84222325;                   // offset basis, as two 32-bit halves
  for (const byte of bytes) {
    lo = (lo ^ byte) >>> 0;
    // (hi·2^32 + lo) · (2^40 + 0x1b3) mod 2^64
    const l = lo * 0x1b3;
    const carry = Math.floor(l / 4294967296);
    const nlo = l % 4294967296;
    const nhi = (hi * 0x1b3 + carry + ((lo << 8) >>> 0)) % 4294967296;
    hi = nhi >>> 0; lo = nlo >>> 0;
  }
  return "il:" + ((BigInt(hi) << 32n) | BigInt(lo)).toString(16);
}

/** Puts the two halves together like DataLoader.loadAll's result, plus what DataStore works out from it. */
export function combine(chi, il) {
  const data = {
    chicago: chi.chicago, illinois: il ? il.illinois : [], hoods: chi.hoods, sides: chi.sides,
    cuisines: [...new Set(chi.cuisines.concat(il ? il.cuisines : []).map(nfc))].sort(cmpStr),
    cities: il ? il.cities : [], recordsThrough: chi.recordsThrough, overtureRelease: il ? il.overtureRelease : "",
    illinoisLoaded: !!il,
  };
  data.asOf = asOf(chi.recordsThrough);
  data.recordsYear = /^\d{4}/.test(chi.recordsThrough) ? +chi.recordsThrough.slice(0, 4) : null;
  data.index = makeIndex(data.hoods, data.cities, data.cuisines);
  data.byId = new Map();
  data.chicago.forEach((p) => data.byId.set(p.id, p));
  data.illinois.forEach((p) => data.byId.set(p.id, p));
  data.restaurantCount = data.chicago.reduce((n, p) => n + (p.venue ? 0 : 1), 0);
  data.illinoisRestaurantCount = data.illinois.reduce((n, p) => n + (p.venue ? 0 : 1), 0);
  return data;
}

// ------------------------------------------------------------------------------------------------ Finder and Geo (DataStore.swift)
export const SEARCH_LIMIT = 400;            // SearchResults.limit
export const CLOSEST_LIMIT = 50;            // SearchResults.closestLimit
/** `trimmingCharacters(in: .whitespacesAndNewlines)` */
export const trimWS = (t) => t.replace(/^[\p{Z}\t\n\v\f\r\u0085]+|[\p{Z}\t\n\v\f\r\u0085]+$/gu, "");
/** Finder.matches: matches in the list's own order (best score first, then name); a name search ("portillo") puts places
 *  named that way first: names with every word as typed, then names with them only through a looser reading (a stem, z as
 *  s, joined words, a hidden alt name: "wingz" lists Wingz It Iz before Wingstop), then the rest. Text with nothing
 *  searchable in it (punctuation) matches nothing, not the whole city. */
export function search(data, text, scope, filters) {
  text = trimWS(text);
  const q = parse(data.index, text, scope);
  if (queryEmpty(q) && text !== "") return [];
  const list = scope === "chicago" ? data.chicago : data.illinois;
  const empty = queryEmpty(q);
  const hits = list.filter((p) => passes(filters, p) && (empty || matches(p, q)));
  if (!q.tokens.length || q.isPlaceOrFood) return hits;
  const named = [], loose = [], rest = [];
  for (const p of hits) {
    const m = nameMatch(p, q);
    (m === "typed" ? named : m === "loose" ? loose : rest).push(p);
  }
  const out = named.concat(loose, rest);
  // Until the rest of Illinois is in, the index lacks its town names and cuisines. They can only turn isPlaceOrFood on
  // (list order), so names-first is then a guess, unless it comes out in the same order anyway. The count is right either way.
  if (!data.illinoisLoaded && out.some((p, i) => p !== hits[i])) out.orderPending = true;
  return out;
}

/** A place's search and name texts with doubled letters collapsed, worked out once (they don't depend on the query). */
function undoubledTexts(p) {
  if (!p._und) p._und = { search: undoubled(p.searchText, p.joinLen), name: undoubled(p.nameText, p.joinLen) };
  return p._und;
}
/** Finder.closest: when nothing matches exactly, places with all but at most two of the typed words (at least one, and at
 *  least one of them in the name), with doubled letters collapsed on both sides ("yummi express" finds Yumi Express). Ranked
 *  by the words matched in the name, each weighted by how rare it is in the list (so "fox's pizza" puts Fox's before every
 *  pizzeria), then by words matched anywhere, then in the list's own order. Search shows these apart, as "Closest matches". */
export function closest(data, text, scope, filters, limit = CLOSEST_LIMIT) {
  const q = parse(data.index, trimWS(text), scope);
  if (!q.tokens.length || q.tokens.length > 64) return [];
  const tokens = q.tokens.map(undoubledToken);
  const need = Math.max(1, tokens.length - 2), spare = tokens.length - need;
  const list = scope === "chicago" ? data.chicago : data.illinois;
  const found = [];
  const seen = new Array(tokens.length).fill(0);        // places each word matches, for its weight
  let scanned = 0;
  list.forEach((p, i) => {
    if (!passes(filters, p) || !inArea(p, q)) return;
    scanned += 1;
    const u = undoubledTexts(p);                         // joined words still match only whole
    let inName = null, all = 0, missed = 0;
    tokens.forEach((v, t) => {
      if (hasToken(u.search.text, v, u.search.tail)) {
        all += 1;
        seen[t] += 1;
        if (hasToken(u.name.text, v, u.name.tail)) (inName ||= []).push(t);
      } else missed += 1;
    });
    if (missed <= spare && inName) found.push({ i, inName, all });
  });
  // a word found in few places says more than one found in many ("fox" against "pizza")
  const weight = seen.map((n) => Math.log((scanned + 1) / (n + 1)));
  const score = (ts) => { let s = 0; for (const t of ts) s += weight[t]; return s; };   // in word order, as the app adds them
  const ranked = found.map((x) => ({ i: x.i, name: score(x.inName), all: x.all }))
    .sort((a, b) => (a.name !== b.name ? (a.name > b.name ? -1 : 1) : a.all !== b.all ? b.all - a.all : a.i - b.i));
  return ranked.slice(0, limit).map((x) => list[x.i]);
}

/** Finder.results: one Search list as shown: the first SEARCH_LIMIT matches in order, how many there are, and when nothing
 *  matches exactly, the closest ones (shown apart, labelled, never counted). Near me: closest first, and how far the nearest
 *  place is when there's nothing within 50 miles. `req`: { text, scope, filters, near, point }. */
export function results(data, req) {
  const out = { places: [], total: 0, outOfArea: null, closest: [], orderPending: false };
  if (req.near) {
    if (!req.point) return out;
    const hits = near(data, req.text, req.filters, req.point, SEARCH_LIMIT);
    out.places = hits.places;
    out.total = hits.total;
    if (hits.total === 0) { const c = nearest(data, req.point); if (c && c.m > NEAR_RADIUS) out.outOfArea = c.m; }
  } else {
    const hits = search(data, req.text, req.scope, req.filters);
    out.total = hits.length;
    out.places = hits.slice(0, SEARCH_LIMIT);
    out.orderPending = !!hits.orderPending;
    if (!hits.length) out.closest = closest(data, req.text, req.scope, req.filters, CLOSEST_LIMIT);
  }
  return out;
}

export const NEAR_RADIUS = 80467;          // 50 mi
export function meters(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}
export const distance = (p, pt) => (p.lat == null || p.lon == null ? Infinity : meters(p.lat, p.lon, pt[0], pt[1]));
/** Geo.label */
export function distLabel(m) {
  const miles = m / 1609.344;
  if (miles < 0.1) return "nearby";
  if (miles < 10) return icuFixed(miles, 1) + " mi";
  return group(roundAway(miles)) + " mi";
}
function box(pt, m) {
  const dLat = m / 111000, dLon = m / (111000 * Math.max(0.1, Math.cos(pt[0] * Math.PI / 180)));
  return { minLat: pt[0] - dLat, maxLat: pt[0] + dLat, minLon: pt[1] - dLon, maxLon: pt[1] + dLon };
}
/** Finder.near: matches in Chicago and the rest of Illinois within 50 miles, closest first. A Chicago-only filter (grade,
 *  side, neighborhood, licenses) leaves out the rest of Illinois; a town filter leaves out Chicago. */
export function near(data, text, filters, pt, limit = SEARCH_LIMIT) {
  text = trimWS(text);
  const bx = box(pt, NEAR_RADIUS);
  const found = [];
  const scan = (list, scope, offset) => {
    const q = parse(data.index, text, scope);   // a Chicago neighborhood or an Illinois town, as the words fit
    if (queryEmpty(q) && text !== "") return;
    const empty = queryEmpty(q);
    list.forEach((p, i) => {
      if (p.lat == null || p.lon == null) return;
      if (!(p.lat >= bx.minLat && p.lat <= bx.maxLat && p.lon >= bx.minLon && p.lon <= bx.maxLon)) return;
      if (!passes(filters, p) || !(empty || matches(p, q))) return;
      const dd = meters(p.lat, p.lon, pt[0], pt[1]);
      if (dd <= NEAR_RADIUS) found.push({ m: dd, i: offset + i, p });
    });
  };
  if (filters.city == null) scan(data.chicago, "chicago", 0);
  if (!chicagoOnly(filters)) scan(data.illinois, "illinois", data.chicago.length);
  found.sort((a, b) => a.m - b.m);
  return { places: found.slice(0, limit).map((x) => x.p), total: found.length };
}
/** Finder.nearest: the closest place we list anywhere (venues aside), and how far it is. */
export function nearest(data, pt) {
  let best = null;
  for (const list of [data.chicago, data.illinois]) for (const p of list) {
    if (p.venue) continue;
    const dd = distance(p, pt);
    if (dd < (best ? best.m : Infinity)) best = { p, m: dd };
  }
  return best;
}
/** DataStore.areaCounts: how many places (venues included: O'Hare's terminals are Chicago) lie within `m` meters of `pt`,
 *  per area. The map picks its area from this (MapTab.goTo counts within 800 m). */
export function areaCounts(data, pt, m = 3000) {
  const count = (list) => list.reduce((n, p) => n + (distance(p, pt) <= m ? 1 : 0), 0);
  return { chicago: count(data.chicago), illinois: count(data.illinois) };
}

// ------------------------------------------------------------------------------------------------ Surprise me (DataStore.swift)
const W = "[\\p{L}\\p{M}\\p{Nd}\\p{Pc}]";
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;       // ICU's \b (Unicode word characters)
const PRIVATE = [
  "cater", "\\boffsite\\b", "private dining", "@", "hospitality\\s*$", "culinary group",
  "\\b(flik|eurest|sodexo|aramark|guckenheimer|canteen)\\b", "\\b(employee|staff|corporate)\\b", "\\bcommissary\\b",
  "\\b(metropolitan|tavern|union league|university|standard|casino|racquet|arts|chicago) club\\b", "\\bsport club\\b", "cliff dwellers",
  "\\bgrand lodge\\b", "\\bmasonic\\b", "\\b(elks|moose) lodge\\b", "\\bvfw\\b", "american legion", "knights of columbus",
  "\\b(community|baptist|methodist|lutheran|presbyterian|catholic) church\\b", "\\bministr(y|ies)\\b", "\\bparish\\b",
  "\\b(iskcon|mosque|masjid|synagogue|gurdwara)\\b", "nutrici[oó]n", "\\bnutrition\\b",
  "\\b(community|social) services\\b", "\\bcommons association\\b", "\\b(health|medical) center\\b", "\\bhospital\\b",
  "\\b(universit(y|ies)|college|campus|uchicago)\\b", "^(harper center|cobb hall|center court|tower house|drw)$", "haymarket center",
].join("|").replace(/\\b/g, B);
const PRIVATE_RE = new RegExp(PRIVATE, "iu");
/** Finder.isPrivateDining: caterers, private clubs, churches, corporate and campus dining. */
export const isPrivateDining = (p) => [p.name, p.aka].some((s) => s != null && PRIVATE_RE.test(s));
/** DataStore.surpriseCandidates: A-grade independents the public can walk into, and none the City has failed since. */
export const surpriseCandidates = (chicago) => chicago.filter((p) => p.grade === "A" && !p.venue && !p.isChain && p.lat != null && !isPrivateDining(p) && !p.failedSince);

// ------------------------------------------------------------------------------------------------ place page pieces (PlaceDetailView.swift)
// URLComponents' query encoding: RFC 3986 query characters stay, except & = (and + by hand); everything else is %XX UTF-8.
const QUERY_OK = /[A-Za-z0-9\-._~!$'()*,;:@/?]/;
function pct(s, ok) {
  let out = "";
  for (const ch of s) {
    if (ok.test(ch)) { out += ch; continue; }
    for (const byte of new TextEncoder().encode(ch)) out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}
const queryValue = (s) => pct(s, QUERY_OK);
/** Swift's "\(Double)": the shortest digits that read back the same, like JS, but a whole number keeps its ".0" (42.0, not 42). */
export const swiftDouble = (v) => (Number.isInteger(v) ? (Object.is(v, -0) ? "-0.0" : v.toFixed(1)) : String(v));
/** Apple Maps link: q = the name, ll = the point ("+" escaped, since Maps reads a bare "+" as a space). */
export function mapsLink(p) {
  if (p.lat == null || p.lon == null) return null;
  return `https://maps.apple.com/?q=${queryValue(p.name)}&ll=${queryValue(`${swiftDouble(p.lat)},${swiftDouble(p.lon)}`)}`;
}
export const REPORT_EMAIL = "work-with-nick@gmail.com";
export const reportSubject = (p) => (p.isChicago ? `Listing correction: ${p.name} (License #${p.id})` : `Listing correction: ${p.name}, ${p.city}`);
/** ListingReport.url */
export const reportURL = (p) => `mailto:${REPORT_EMAIL}?subject=${queryValue(reportSubject(p))}`;
const RECORD_COLS = ["inspection_date", "results", "inspection_type", "dba_name", "aka_name", "address", "violations", "inspection_id"];
/** CityRecords.url: the City of Chicago's own inspection records for one license, newest first. */
export function cityRecordsURL(license) {
  const select = RECORD_COLS.map((c) => "`" + c + "`").join(", ");
  const q = `SELECT\n  ${select}\nWHERE \`license_\` = "${license}"\nORDER BY \`inspection_date\` DESC NULL FIRST`;
  return `https://data.cityofchicago.org/Health-Human-Services/Food-Inspections/4ijn-s7e5/explore/query/${pct(q, /[\p{L}\p{M}\p{N}]/u)}/page/filter`;
}
const CLASS_EXACT = { "212": "Mixed-use building, 6 units or fewer", "517": "One-story commercial building",
  "591": "Commercial building over 3 stories", "592": "2–3 story building with retail or commercial space", "599": "Commercial condominium unit",
  "597": "Special commercial structure", "593": "Industrial building", "531": "Shopping center", "523": "Gas station", "528": "Bank building",
  "527": "Theater" };
const CLASS_FAMILY = { "2": "Residential or small mixed-use", "3": "Apartment or mixed-use building", "4": "Not-for-profit property",
  "5": "Commercial property", "6": "Incentive-class industrial", "7": "Incentive-class commercial", "8": "Incentive-class commercial/industrial",
  "9": "Incentive-class multifamily" };
/** PropertyClass.describe: Cook County Assessor property classes, in words. */
export function propertyClass(code) {
  const cs = chars(code);
  const name = (has(CLASS_EXACT, code) ? CLASS_EXACT[code] : null) ?? (cs.length && has(CLASS_FAMILY, cs[0]) ? CLASS_FAMILY[cs[0]] : null) ?? "Other";
  return cs.length >= 2 ? `${name} (class ${cs[0]}-${cs.slice(1).join("")})` : name;
}
/** PlacePage.honorsList */
export function honorsList(p) {
  const out = [];
  if (p.stars != null && p.stars > 0) out.push(`Michelin Guide Chicago 2025: ${p.stars} star${p.stars > 1 ? "s" : ""}`);
  if (p.bib) out.push("Michelin Guide Chicago 2025: Bib Gourmand");
  if (p.green) out.push("Michelin Green Star");
  if (p.jbf != null) out.push(...Fmt.items(p.jbf).map((x) => `James Beard: ${x}`));
  if (p.honors != null) out.push(...Fmt.items(p.honors));
  return out;
}
/** PlaceBadges.badges: [text, kind]. */
export function badges(p, hideMichelin = false) {
  const out = [];
  if (p.stars != null && p.stars > 0 && !hideMichelin) out.push([`${p.stars} Michelin star${p.stars === 1 ? "" : "s"}`, "red"]);
  if (p.bib) out.push(["Bib Gourmand", "plain"]);
  if (p.jbf != null) out.push([p.jbf.includes("America's Classic") ? "America's Classic" : "James Beard", "blue"]);
  if (p.icon != null && p.stars == null && p.jbf == null) out.push(["Icon", "icon"]);
  if (p.isChain) out.push([`Chain · ${p.chain}`, "plain"]);
  return out;
}
/** PlacePage.shareText */
export function shareText(p) {
  const parts = [`${p.name}, ${p.addr != null ? `${p.addr}, ` : ""}${p.city}`];
  if (p.grade != null && p.score != null) {
    parts.push(`Inspection grade ${p.grade} (${p.score}/100), from City of Chicago inspection records. Grade by Chicago Restaurants: Ranked, not an official city grade.`);
  }
  const link = mapsLink(p);
  if (link) parts.push(link);
  return parts.join("\n");
}
