"""Full-page screenshots of every page at 375 and 1440 px, plus horizontal-overflow and console/network error checks.
Usage: python playbook/tools/shoot.py OUTPUT_DIR   (needs Playwright + Chrome)"""
import sys
from playwright.sync_api import sync_playwright
import os
ROOT = os.environ.get("SITE_ROOT", "http://127.0.0.1:8791/chicago-restaurant-inspections/")
PAGES = ["", "how-chicago-restaurant-inspections-work.html", "look-up-chicago-restaurant-inspections.html",
         "chicago-restaurant-grades.html", "support.html", "privacy.html", "terms.html", "404.html"]
OUT = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    for w, h in ((375, 812), (1440, 900)):
        ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
        pg = ctx.new_page(); errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("requestfailed", lambda r: errs.append("FAILED " + r.url))
        pg.on("response", lambda r: errs.append(f"HTTP {r.status} {r.url}") if r.status >= 400 else None)
        for page in PAGES:
            pg.goto(ROOT + page, wait_until="networkidle")
            pg.evaluate("document.querySelectorAll('img[loading=lazy]').forEach(i => i.loading='eager')")
            pg.wait_for_timeout(300)
            sw = pg.evaluate("document.documentElement.scrollWidth")
            wide = pg.evaluate("""[...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth + 1 && !e.closest('.shots') && !e.closest('.tablewrap') }).slice(0,5).map(e => e.tagName + '.' + e.className)""")
            name = (page or "index.html").replace(".html", "")
            pg.screenshot(path=f"{OUT}/{name}-{w}.png", full_page=True)
            print(w, name, "scrollWidth", sw, "overflow:" , wide if wide else "none")
        print(w, "errors:", errs or "none")
        ctx.close()
    b.close()
