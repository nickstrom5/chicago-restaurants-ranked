"""SEO and link checks for docs/ (see playbook/01-site-runbook.md, "Verify before pushing").
Serve docs/ under /chicago-restaurants-ranked/ first, then: python3 playbook/tools/verify.py
Exit code 1 if anything fails."""
import json, re, sys, urllib.request, urllib.error, html
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
import os
ROOT = os.environ.get("SITE_ROOT", "http://127.0.0.1:8791/chicago-restaurants-ranked/")
HOST = urlparse(ROOT).netloc
BASE = "https://nickstrom5.github.io/chicago-restaurants-ranked/"
PAGES = ["", "how-chicago-restaurant-inspections-work.html", "look-up-chicago-restaurant-inspections.html",
         "chicago-restaurant-grades.html", "support.html", "privacy.html", "terms.html", "404.html"]
problems = []
def bad(*a): problems.append(" ".join(str(x) for x in a)); print("  FAIL:", *a)
cache = {}
def get(url):
    if url in cache: return cache[url]
    try:
        r = urllib.request.urlopen(url, timeout=10); cache[url] = (r.status, r.read())
    except urllib.error.HTTPError as e: cache[url] = (e.code, b"")
    return cache[url]

class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.tags=[]; s.heads=[]; s.cur=None; s.ld=[]; s.inld=False; s.buf=""; s.title=""; s.intitle=False
        s.text=[]; s.inart=0; s.art=[]; s.skip=0; s.summ=[]; s.insumm=False; s.faqp=[]; s.indet=False; s.inp=False; s.pbuf=""
    def handle_starttag(s, t, a):
        a = dict(a); s.tags.append((t, a))
        if t in ("h1","h2","h3","h4"): s.heads.append(t)
        if t == "script" and a.get("type") == "application/ld+json": s.inld=True; s.buf=""
        if t in ("script","style"): s.skip+=1
        if t == "title": s.intitle=True
        if t == "article": s.inart+=1
        if t == "details": s.indet=True
        if t == "summary": s.insumm=True; s.summ.append("")
        if t == "p" and s.indet: s.inp=True; s.pbuf=""
    def handle_endtag(s, t):
        if t == "script" and s.inld: s.ld.append(s.buf); s.inld=False
        if t in ("script","style"): s.skip-=1
        if t == "title": s.intitle=False
        if t == "article": s.inart-=1
        if t == "summary": s.insumm=False
        if t == "details": s.indet=False
        if t == "p" and s.inp: s.faqp.append(s.pbuf); s.inp=False
    def handle_data(s, d):
        if s.inld: s.buf+=d
        if s.intitle: s.title+=d
        if s.insumm: s.summ[-1]+=d
        if s.inp: s.pbuf+=d
        if not s.skip and s.inart: s.art.append(d)

sitemap = get(ROOT+"sitemap.xml")[1].decode()
smurls = re.findall(r"<loc>(.*?)</loc>", sitemap)
print("sitemap:", len(smurls), "urls; lastmod:", set(re.findall(r"<lastmod>(.*?)</lastmod>", sitemap)))
for u in smurls:
    assert u.startswith(BASE), u
    st,_ = get(ROOT + u[len(BASE):])
    if st != 200: bad("sitemap url", u, st)
for page in PAGES:
    url = ROOT + page; st, body = get(url); print(f"\n== {page or 'index.html'} [{st}] {len(body)} bytes")
    if st != 200: bad(page, "status", st); continue
    src = body.decode("utf-8"); p = P(); p.feed(src)
    for word in ("Worst inspections", "Recently failed", "worst boards", "Chi Inspect"):   # old or non-neutral names (app Board.swift titles rule)
        if word.lower() in src.lower(): bad(page, "uses banned wording", repr(word))
    if '<html lang="en">' not in src: bad(page, "lang")
    h1 = p.heads.count("h1")
    if h1 != 1: bad(page, "h1 count", h1)
    # heading order: no jumps of more than one level down
    lv = [int(h[1]) for h in p.heads]
    for a, b in zip(lv, lv[1:]):
        if b > a + 1: bad(page, "heading jump", a, "->", b)
    if lv and lv[0] != 1: bad(page, "first heading not h1")
    for lm in ("header", "main", "nav", "footer"):
        if not any(t == lm for t, _ in p.tags): bad(page, "missing landmark", lm)
    metas = {(a.get("name") or a.get("property")): a.get("content") for t, a in p.tags if t == "meta"}
    title = html.unescape(p.title); desc = metas.get("description", "")
    noindex = "noindex" in (metas.get("robots") or "")
    print(f"  title {len(title)}: {title}\n  desc {len(desc)}: {desc[:90]}...")
    if not noindex:
        if not 50 <= len(title) <= 60: bad(page, "title length", len(title))
        if not 140 <= len(desc) <= 160: bad(page, "desc length", len(desc))
        canon = [a["href"] for t, a in p.tags if t == "link" and a.get("rel") == "canonical"]
        exp = BASE + page
        if canon != [exp]: bad(page, "canonical", canon)
        if metas.get("og:url") != exp: bad(page, "og:url", metas.get("og:url"))
        if exp not in smurls: bad(page, "not in sitemap")
        if metas.get("robots") != "index,follow,max-image-preview:large": bad(page, "robots meta")
        for k in ("og:title","og:description","og:type","og:site_name","og:image","og:image:width","og:image:height","og:image:alt",
                  "twitter:card","twitter:title","twitter:description","twitter:image","theme-color"):
            if not metas.get(k): bad(page, "missing meta", k)
        if metas.get("twitter:card") != "summary_large_image": bad(page, "twitter card")
        if not metas.get("og:image","").startswith("https://"): bad(page, "og:image not absolute")
        st2,_ = get(ROOT + metas["og:image"][len(BASE):])
        if st2 != 200: bad(page, "og image 404")
    else:
        if page != "404.html": bad(page, "unexpected noindex")
    rels = [(a.get("rel"), a.get("sizes"), a.get("href")) for t, a in p.tags if t == "link"]
    for need in [("icon", None, "svg"), ("icon", "32x32", "favicon-32.png"), ("apple-touch-icon", "180x180", "apple-touch-icon.png"), ("manifest", None, "site.webmanifest")]:
        if not any(r == need[0] and (need[1] is None or s == need[1]) and h.endswith(need[2]) for r, s, h in rels): bad(page, "missing icon link", need)
    # JSON-LD
    for blk in p.ld:
        try:
            j = json.loads(blk); types = [x.get("@type") for x in j.get("@graph", [j])]; print("  JSON-LD ok:", types)
            if "aggregateRating" in blk or '"review"' in blk: bad(page, "rating/review markup present")
        except Exception as e: bad(page, "JSON-LD parse", e)
    if page not in ("", "404.html") and not any('"BreadcrumbList"' in b for b in p.ld): bad(page, "no BreadcrumbList")
    # FAQ mirror
    faqs = [json.loads(b) for b in p.ld if '"FAQPage"' in b]
    if faqs:
        qs = [(q["name"], q["acceptedAnswer"]["text"]) for q in faqs[0]["mainEntity"]]
        if page == "":
            vis = list(zip([s.strip() for s in p.summ], [x.strip() for x in p.faqp]))
        else:
            vis = re.findall(r"<h2>(.*?)</h2>\s*<p>(.*?)</p>", src.split('<div class="qa">')[1].split("</div>")[0], re.S)
            vis = [(html.unescape(re.sub("<[^>]+>", "", a)), html.unescape(re.sub("<[^>]+>", "", b))) for a, b in vis]
        if vis != qs:
            bad(page, "FAQ mismatch"); [print("   V:", v, "\n   L:", l) for v, l in zip(vis, qs) if v != l]
        else: print(f"  FAQ mirror ok ({len(qs)} Qs)")
    # images
    imgs = [a for t, a in p.tags if t == "img"]
    for a in imgs:
        for k in ("alt", "width", "height", "decoding"):
            if not a.get(k): bad(page, "img missing", k, a.get("src"))
        if "screenshots/" in a.get("src","") and a.get("loading") != "lazy": bad(page, "screenshot not lazy", a["src"])
        if "favicon" in a.get("src","") and a.get("loading") == "lazy": bad(page, "header logo lazy")
    print(f"  imgs: {len(imgs)} all with alt/width/height" if imgs else "  imgs: 0")
    # links + assets
    ext_bad = []; n_int = 0
    for t, a in p.tags:
        for attr in ("href", "src"):
            v = a.get(attr)
            if not v or t == "meta": continue
            if t == "link" and a.get("rel") == "canonical": continue
            if v.startswith(("mailto:", "tel:")): continue
            full = urljoin(url, v); u = urlparse(full)
            if u.netloc == HOST:
                n_int += 1
                st3, b3 = get(full.split("#")[0])
                if st3 != 200: bad(page, "broken internal", v, st3)
                frag = u.fragment
                if frag and full.split("#")[0].rstrip("/") == url.rstrip("/").replace("index.html",""):
                    if f'id="{frag}"' not in src: bad(page, "missing anchor", frag)
                elif frag:
                    if f'id="{frag}"'.encode() not in b3: bad(page, "missing anchor on target", v)
            else:
                if t in ("script", "link", "img"): bad(page, "external resource", v)
                if t == "a" and "noopener" not in (a.get("rel") or ""): ext_bad.append(v)
    if ext_bad: bad(page, "external links without noopener", ext_bad)
    print(f"  internal refs checked: {n_int}")
    if p.inart or p.art:
        words = len(re.findall(r"[A-Za-z0-9’'–-]+", " ".join(p.art)))
        print("  article words:", words)
        if page in PAGES[1:4] and not 400 <= words <= 760: bad(page, "article word count", words)
    if page == "":
        print("  index weight (html only):", len(body), "bytes")
        if len(body) > 150_000: bad("index too heavy")
# manifest
m = json.loads(get(ROOT+"site.webmanifest")[1])
for ic in m["icons"]:
    st4,_ = get(urljoin(ROOT+"site.webmanifest", ic["src"]))
    if st4 != 200: bad("manifest icon", ic["src"], st4)
print("\nmanifest ok:", m["start_url"], [i["src"] for i in m["icons"]])
print("robots.txt:", get(ROOT+"robots.txt")[1].decode().strip().replace("\n"," | "))
print(".nojekyll:", get(ROOT+".nojekyll")[0])
print("\nPROBLEMS:", len(problems))
for x in problems: print(" -", x)

sys.exit(1 if problems else 0)
