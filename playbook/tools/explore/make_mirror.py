"""Builds a local mirror of the site for testing the web app (docs/explore/) on the app's bundled data.

The live site's data/v1/ is written only by chi-eats/pipeline/publish_data.py, and until the first publish docs/data/v1/
holds no manifest, so the web app has nothing to load locally. This makes a separate folder that serves docs/ as it is
(each top-level entry symlinked, so edits to docs/explore/ show up without rebuilding) plus its own data/v1/: the app's
chicago.json and illinois.json under content-addressed names (chicago-<sha256[:12]>.json) and a manifest.json in the
published format (schema 1, version "<records_through>.1", sha256, bytes, rows, counts), the way publish_data.py writes
them. Nothing is written inside docs/.

usage: python3 make_mirror.py <mirror dir> [chi-eats/ios/ChiRanked/Resources] [docs dir]
"""
import datetime as dt
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CHI_EATS = os.path.abspath(os.path.join(SITE, "..", "chi-eats"))


def counts(chicago, illinois):
    """The manifest's counts, as publish_data.counts_of works them out (validate_app_data's stats); a plain count if the
    pipeline isn't next to this repo."""
    try:
        sys.path.insert(0, os.path.join(CHI_EATS, "pipeline"))
        sys.dont_write_bytecode = True          # leave nothing behind in chi-eats
        import validate_app_data as vad
        _, s1 = vad.check_chicago(chicago, dt.date.max, [], newer=False)
        _, s2 = vad.check_illinois(illinois, [])
        return {"places": s1.get("places"), "restaurants": s1.get("restaurants"), "graded": s1.get("graded"),
                "illinois": s2.get("illinois"), "towns": s2.get("towns")}
    except Exception as e:  # noqa: BLE001 - a test helper: fall back, and say so
        print("make_mirror: validate_app_data unavailable (%s); counting by hand" % e)
        c, k = chicago["cols"], illinois["cols"]
        rest = [r for r in illinois["rows"] if not r[k.index("venue")]]
        return {"places": len(chicago["rows"]), "restaurants": sum(1 for r in chicago["rows"] if not r[c.index("venue")]),
                "graded": sum(1 for r in chicago["rows"] if r[c.index("grade")]), "illinois": len(rest),
                "towns": len({r[k.index("city")] for r in rest if r[k.index("city")] is not None})}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = os.path.abspath(sys.argv[1])
    res = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(CHI_EATS, "ios", "ChiRanked", "Resources")
    docs = os.path.abspath(sys.argv[3]) if len(sys.argv) > 3 else os.path.join(SITE, "docs")
    if out == docs or out.startswith(docs + os.sep):
        sys.exit("make_mirror: the mirror must be outside docs/")
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, "data", "v1"))
    for name in os.listdir(docs):
        if name != "data":
            os.symlink(os.path.join(docs, name), os.path.join(out, name))
    notice = os.path.join(docs, "data", "v1", "NOTICE.txt")
    if os.path.exists(notice):
        shutil.copy2(notice, os.path.join(out, "data", "v1", "NOTICE.txt"))
    files, parsed = {}, {}
    for key in ("chicago", "illinois"):
        b = open(os.path.join(res, key + ".json"), "rb").read()
        parsed[key] = json.loads(b)
        sha = hashlib.sha256(b).hexdigest()
        path = "%s-%s.json" % (key, sha[:12])
        open(os.path.join(out, "data", "v1", path), "wb").write(b)
        files[key] = {"path": path, "sha256": sha, "bytes": len(b), "rows": len(parsed[key]["rows"])}
    rt = parsed["chicago"]["meta"]["records_through"]
    manifest = {"schema": 1, "version": rt + ".1", "records_through": rt,
                "published": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "min_app_build": 1,
                "files": files, "counts": counts(parsed["chicago"], parsed["illinois"])}
    json.dump(manifest, open(os.path.join(out, "data", "v1", "manifest.json"), "w"), indent=1)
    print("mirror:", out, "records through", rt, {k: v["path"] for k, v in files.items()}, manifest["counts"])


if __name__ == "__main__":
    main()
