"""Refresh the data-derived numbers on docs/*.html from docs/data/v1/manifest.json (the weekly data refresh runs this).

Convention for the pages: in <body>, every number or date that comes from the data is
  <span data-stat="KEY">text</span>
with KEY and text format:
  places, restaurants, graded, illinois, towns   "7,815"               manifest counts, thousands commas
  graded_floor                                   "7,600+"              counts.graded rounded down to the hundred, plus "+"
  records_through                                "September 20, 2026"  manifest records_through
Only the span's text changes. <head> (title, meta, Open Graph, JSON-LD) can't hold spans, so the one data number allowed
there is the graded_floor text, and this script swaps the previous one for the new one. The previous one is --old-floor,
else the one --old-manifest's counts give, else the page's own graded_floor spans as they were before this run.
The run fails, writing nothing, when a number would go stale anyway: any other "N,NNN+" left in <head>, or a key's old
value still in the page outside its span (a number nobody marked). Also on an unknown KEY or markup inside a span.
A page that changed gets today's date in its sitemap.xml <lastmod> and in its Article JSON-LD dateModified (runbook §2).
Idempotent: a second run with the same manifest changes nothing.

  python3 playbook/tools/update_counts.py                        # docs/ beside playbook/
  python3 playbook/tools/update_counts.py --docs DIR --old-floor "7,600+" --today 2026-09-28
  python3 playbook/tools/update_counts.py --check                # exit 1 if any page is out of date; writes nothing
  python3 playbook/tools/update_counts.py --dry-run              # print the changes; writes nothing
"""
import os, re, sys, json, glob, argparse, datetime as dt

DOCS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "docs")
KEYS = ("places", "restaurants", "graded", "graded_floor", "illinois", "towns", "records_through")
SPAN = re.compile(r'(<span\b[^>]*\bdata-stat="([^"]*)"[^>]*>)(.*?)(</span>)', re.S)
FLOOR = re.compile(r"(?<![\d,])\d{1,3}(?:,\d{3})+\+")
DATE_MODIFIED = re.compile(r'("dateModified"\s*:\s*")(\d{4}-\d{2}-\d{2})(")')


def floor(graded):
    return f"{graded // 100 * 100:,}+"


def values(manifest, partial=False):
    """The text each KEY shows, from a manifest. partial: an old manifest may lack some; those keys are left out."""
    n, rt, v = manifest.get("counts") or {}, manifest.get("records_through"), {}
    for k in ("places", "restaurants", "graded", "illinois", "towns"):
        if n.get(k) is not None or not partial:
            v[k] = f"{int(n[k]):,}"
    if n.get("graded") is not None or not partial:
        v["graded_floor"] = floor(int(n["graded"]))
    if rt or not partial:
        d = dt.date.fromisoformat(rt)
        v["records_through"] = f"{d:%B} {d.day}, {d.year}"
    return v


def split_head(src):
    i = src.lower().find("</head>")
    return (src[:i], src[i:]) if i >= 0 else ("", src)


def standalone(value):
    """value as a whole number or date, not part of a longer one ("7,815" isn't in "17,815")."""
    return re.compile(r"(?<![\w,])" + re.escape(value) + r"(?![\w]|,\d)")


def update_page(name, src, new, old_floors, errors):
    """(new source, {key: (old texts, new text, n)}, head floor changes, old span texts by key)."""
    head, body = split_head(src)
    if "data-stat" in head:
        errors.append(f"{name}: data-stat in <head>; spans belong in <body>")
    changes, seen = {}, {}

    def swap(m):
        key, text = m.group(2), m.group(3)
        if key not in KEYS:
            errors.append(f"{name}: unknown data-stat key {key!r}")
            return m.group(0)
        if "<" in text:
            errors.append(f"{name}: markup inside data-stat={key!r}: {text[:60]!r}")
            return m.group(0)
        seen.setdefault(key, set()).add(text)
        if text != new[key]:
            ch = changes.setdefault(key, [set(), new[key], 0])
            ch[0].add(text); ch[2] += 1
        return m.group(1) + new[key] + m.group(4)

    body2 = SPAN.sub(swap, body)
    head2, head_n = head, 0
    for old in sorted(old_floors | seen.get("graded_floor", set())):
        if old != new["graded_floor"] and old in head2:
            head_n += head2.count(old)
            head2 = head2.replace(old, new["graded_floor"])
    for x in sorted(set(FLOOR.findall(head2)) - {new["graded_floor"]}):
        errors.append(f"{name}: <head> still says {x!r}, which isn't the graded_floor this script manages; "
                      f"fix the page or pass --old-floor {x!r}")
    return head2 + body2, changes, head_n, seen


def stale_outside_spans(name, src, olds, new, errors):
    """An old value of a key that changed, still in the page outside a data-stat span. Numbers under 1,000 (towns) aren't
    looked for: "927" also turns up in inline SVG and CSS, and a false alarm would stop the weekly refresh."""
    bare = SPAN.sub(lambda m: m.group(1) + m.group(4), src)
    for key, texts in olds.items():
        for old in texts:
            if old != new[key] and not re.fullmatch(r"\d{1,3}", old) and standalone(old).search(bare):
                errors.append(f"{name}: {old!r} (old {key}) appears outside a data-stat span; mark it up or reword it")


def bump_sitemap(sitemap, pages, today):
    """sitemap.xml text with <lastmod> set to today for these page file names; (text, [pages bumped])."""
    bumped = []

    def one(m):
        loc = m.group(2)
        page = next((p for p in pages if (p == "index.html" and loc.endswith("/")) or loc.endswith("/" + p)), None)
        if page is None or m.group(4) == today:
            return m.group(0)
        bumped.append(page)
        return m.group(1) + m.group(2) + m.group(3) + today + m.group(5)

    out = re.sub(r"(<url>\s*<loc>)(.*?)(</loc>\s*<lastmod>)(.*?)(</lastmod>)", one, sitemap)
    return out, bumped


def run(docs, manifest, old_floors=(), old_values=None, today=None, write=True, log=print):
    """Returns (changed page names, errors). Writes only when write and there are no errors."""
    today = (today or dt.date.today()).isoformat()
    new = values(manifest)
    errors, out, report = [], {}, []
    pages = sorted(glob.glob(os.path.join(docs, "*.html")))
    olds = {k: set() for k in KEYS}
    if old_values:
        for k, v in old_values.items():
            olds[k].add(v)
    parsed = {}
    for path in pages:
        name = os.path.basename(path)
        src = open(path, encoding="utf-8", newline="").read()
        parsed[name] = (path, src) + update_page(name, src, new, set(old_floors), errors)
        for k, texts in parsed[name][5].items():
            olds[k] |= texts
    for name, (path, src, new_src, changes, head_n, _) in parsed.items():
        stale_outside_spans(name, new_src, olds, new, errors)
        if new_src != src:
            new_src = DATE_MODIFIED.sub(lambda m: m.group(1) + today + m.group(3), new_src)
            out[name] = (path, new_src)
            parts = [f"{k} {' / '.join(sorted(o))} -> {n} ({c})" for k, (o, n, c) in sorted(changes.items())]
            if head_n:
                parts.append(f"<head> graded_floor -> {new['graded_floor']} ({head_n})")
            report.append(f"{name}: " + "; ".join(parts))
    sm_path = os.path.join(docs, "sitemap.xml")
    sitemap = open(sm_path, encoding="utf-8", newline="").read() if os.path.exists(sm_path) else None
    if sitemap is not None and out:
        sitemap2, bumped = bump_sitemap(sitemap, list(out), today)
        if bumped:
            report.append(f"sitemap.xml: lastmod {today} for {', '.join(bumped)}")
    else:
        sitemap2 = sitemap
    for line in report:
        log("  " + line)
    if errors:
        for e in errors:
            log("  FAIL " + e)
        return list(out), errors
    if write:
        for path, text in list(out.values()) + ([(sm_path, sitemap2)] if sitemap2 != sitemap else []):
            with open(path + ".part", "w", encoding="utf-8", newline="") as f:
                f.write(text)
            os.replace(path + ".part", path)
    return list(out), errors


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--docs", default=DOCS)
    ap.add_argument("--manifest", help="default: DOCS/data/v1/manifest.json")
    ap.add_argument("--old-manifest", help="the previously published manifest (its values are the ones being replaced)")
    ap.add_argument("--old-floor", action="append", default=[], help='the graded_floor text now in <head>, e.g. "7,600+"')
    ap.add_argument("--today", help="YYYY-MM-DD for lastmod / dateModified (default: today)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true", help="exit 1 if any page is out of date; write nothing")
    g.add_argument("--dry-run", action="store_true", help="print the changes; write nothing")
    a = ap.parse_args()
    docs = os.path.abspath(a.docs)
    manifest = json.load(open(a.manifest or os.path.join(docs, "data", "v1", "manifest.json")))
    old_values = values(json.load(open(a.old_manifest)), partial=True) if a.old_manifest else None
    old_floors = set(a.old_floor) | ({old_values["graded_floor"]} if old_values and "graded_floor" in old_values else set())
    today = dt.date.fromisoformat(a.today) if a.today else None
    print(f"update_counts: {docs} <- manifest {manifest.get('version')} ({json.dumps(values(manifest), ensure_ascii=False)})")
    changed, errors = run(docs, manifest, old_floors, old_values, today, write=not (a.check or a.dry_run))
    verb = "out of date" if a.check else ("would change" if a.dry_run else "changed" if not errors else "not written")
    print(f"{len(changed)} pages {verb}{': ' + ', '.join(changed) if changed else ''}; {len(errors)} problems")
    sys.exit(1 if errors or (a.check and changed) else 0)


if __name__ == "__main__":
    main()
