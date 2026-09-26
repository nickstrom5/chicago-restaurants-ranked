# Site runbook: Chicago Restaurant Inspections

Internal notes. This folder is **not** published; only `docs/` is.

- Site: https://nickstrom5.github.io/chicago-restaurant-inspections/ (GitHub Pages from `docs/` on `main`, no custom domain, no CNAME)
- Repo: https://github.com/nickstrom5/chicago-restaurant-inspections (public; GitHub Issues is the support channel, no support email yet)
- Static HTML, inline CSS, no build step, no third-party scripts, fonts or tracking. `docs/*.html` is the source of truth.

## 1. Publish

1. On GitHub, create the **public** repo `nickstrom5/chicago-restaurant-inspections` (no README, it already has one).
2. `git remote add origin git@github.com:nickstrom5/chicago-restaurant-inspections.git && git push -u origin main`
3. Repo → Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch `main`, folder `/docs` → Save.
4. Wait for the Pages build (Actions tab), then open the site URL. HTTPS is on by default for github.io.
5. Repo → Settings → General → Features: make sure **Issues** is on. The issue forms in `.github/ISSUE_TEMPLATE/` show up automatically.
6. Open https://nickstrom5.github.io/chicago-restaurant-inspections/does-not-exist and check the 404 page is styled and its links work.

### What's different because there is no custom domain

- **robots.txt is not read.** Crawlers only read `robots.txt` at the host root (`nickstrom5.github.io/robots.txt`), not at
  `/chicago-restaurant-inspections/robots.txt`. The file is there for completeness, but submit the sitemap directly in
  Search Console and Bing (below). With no root robots.txt, everything is crawlable, which is what we want.
- **404.html uses root-absolute links** (`/chicago-restaurant-inspections/...`) because GitHub serves it for any missing
  path, at any depth. Every other page uses relative links. If the repo is renamed, fix the prefix in `404.html`.
- **Search Console needs a URL-prefix property.** A Domain property is impossible, since github.io isn't ours.
- **Moving to a custom domain later:** add `docs/CNAME`, then replace `https://nickstrom5.github.io/chicago-restaurant-inspections/`
  everywhere (canonical, og:url, og:image, twitter:image, JSON-LD, sitemap.xml, robots.txt) and change the 404 prefix to `/`.
  GitHub redirects the old github.io URLs to the custom domain on its own. Add the new domain as a property in Search Console.

## 2. SEO after launch

Do these once the site is live.

- **Google Search Console** (search.google.com/search-console): Add property → **URL prefix** →
  `https://nickstrom5.github.io/chicago-restaurant-inspections/`. Verify with the **HTML tag** method: paste the
  `<meta name="google-site-verification" content="...">` line into `<head>` of `docs/index.html` (next to the Smart App
  Banner comment), commit, push, wait for Pages, click Verify. (The HTML-file method also works: put the `googleXXXX.html`
  file in `docs/`.) Then Sitemaps → submit `https://nickstrom5.github.io/chicago-restaurant-inspections/sitemap.xml`.
- **Request indexing:** URL Inspection → paste the home page URL → Request indexing. Repeat for the three guides:
  `how-chicago-restaurant-inspections-work.html`, `look-up-chicago-restaurant-inspections.html`, `chicago-restaurant-grades.html`.
- **Bing Webmaster Tools** (bing.com/webmasters): "Import from Google Search Console" is the quickest. Otherwise add the
  same URL and verify with the `msvalidate.01` meta tag or a `BingSiteAuth.xml` file in `docs/`. Submit the same sitemap,
  and use URL Submission for the home page and guides.
- **Smart App Banner and store buttons**, once the App Store Connect record exists (App Information → Apple ID):
  1. In `docs/index.html`, uncomment `<meta name="apple-itunes-app" content="app-id=APP_ID">` and replace `APP_ID`.
     Safari on iPhone and iPad then shows the banner.
  2. Once the app is **live**, set `APP_STORE_URL` in the script at the bottom of `docs/index.html` to
     `https://apps.apple.com/app/idAPP_ID`. Every `data-store-btn` button switches from "Coming soon" (which links to the
     GitHub repo) to "Download on the App Store".
  3. Add `"downloadUrl"` and `"installUrl"` with the same URL to the `MobileApplication` JSON-LD in `docs/index.html`,
     and add the App Store link to `README.md`.
- **Validate:** search.google.com/test/rich-results on the home page (FAQ, software app) and on a guide (Article,
  Breadcrumb); validator.schema.org for the full graph; paste the home page URL into a link-preview checker
  (opengraph.xyz, or send it to yourself in iMessage) and check `og.png` shows.
- **Never add `aggregateRating` or review markup.** There are none, and the app deliberately carries no ratings or reviews.
- Bump `<lastmod>` in `docs/sitemap.xml` (and `dateModified` in that page's Article JSON-LD) whenever a page's content
  changes, then re-request indexing for it.

## 3. Keep the site honest

Rules for anyone editing `docs/`.

- **Data date.** "September 21, 2026" / "Sep 21" appears in `index.html` (hero stat, sources, FAQ answer and its JSON-LD),
  `support.html` (answer and JSON-LD) and `look-up-chicago-restaurant-inspections.html`. When an app update ships newer
  data, change them all (`grep -rn "September 21, 2026\|Sep 21" docs/`) and bump the sitemap `lastmod`.
- **Counts** (8,526 places, 7,982 restaurants, 17,684 restaurants in 948 other Illinois towns, about 25 published sales
  figures, "about 7 in 10" Overture listings matched) come from `chi-eats/ios/ChiInspect/Resources/chicago.json` and
  `illinois.json` (`meta`), `curated.json`, and the 70.7% calibration in `chi-eats/pipeline/illinois.py`. Update together.
- **FAQ = JSON-LD.** The visible FAQ and the `FAQPage` JSON-LD must match word for word, on both `index.html` and
  `support.html`. `playbook/tools/verify.py` checks this.
- **The grades page mirrors the pipeline.** `chicago-restaurant-grades.html` publishes the exact method: weights from
  `chi-eats/pipeline/build.py` `inspection_record()` (40 × fail share, 3 × violations per visit capped at 10, 8 × items
  1–29 per visit capped at 3, 25 × pest share, 8 if the last visit failed, 6 × pass-with-conditions share), the two-visit
  pull toward the city mean and the cutoffs and F/A rules in `pipeline/score.py`, and the two-inspection minimum for the
  Cleanest/Worst boards in `ios/ChiInspect/Models/Board.swift`. If any of these change, update the grades page, the
  "How the grades work" block and the grade FAQ on `index.html`, and the app's About screen.
- **Sources for the inspection guides.** Everything on `how-chicago-restaurant-inspections-work.html` and
  `look-up-chicago-restaurant-inspections.html` comes from the Food Inspections dataset page and its data-description PDF
  on data.cityofchicago.org, and from violation titles in the data itself. The one exception is the risk schedule (risk 1
  twice a year, risk 2 once a year, risk 3 every other year), cited to CDPH's "Understand Health Code Requirements for Food
  Establishments" page on chicago.gov. chicago.gov refuses automated fetches, so that sentence was confirmed from the
  search-engine text of that page. **Before launch, open the page in a browser and confirm it still says that.**
- **Things the site deliberately does not claim:**
  - No Bib Gourmand or Green Star. `curated.json` has none as of 2026-09-26, so the site says "Michelin Guide Chicago 2025 stars".
    If the data gains them, add them to the copy.
  - Not "all 77 community areas". The data covers 76 (Burnside has no licensed places).
  - Not "every restaurant has a grade". 7,757 of 7,982 restaurants do (97%), so the lede says "nearly every". The
    brand agent's `og.png` says "Health grades for every Chicago restaurant"; consider changing it to "nearly every".
  - No star ratings, reviews or price levels, anywhere. The app doesn't carry them.
- **Legal pages** (`privacy.html`, `terms.html`) were drafted, not reviewed by a lawyer. Keep them in step with the app:
  if the app ever adds analytics, crash reporting, an account, a network data refresh or anything that collects data,
  update `privacy.html` and the App Store privacy label **before** that version ships.

## 4. Verify before pushing

```bash
# serve docs/ under the same path GitHub Pages uses
mkdir -p /tmp/cri-serve && ln -sfn "$PWD/docs" /tmp/cri-serve/chicago-restaurant-inspections
(cd /tmp/cri-serve && python3 -m http.server 8791 --bind 127.0.0.1) &
python3 playbook/tools/verify.py            # 200s, links, assets, anchors, JSON-LD, one h1, heading order,
                                            # title 50–60 / description 140–160, canonical = og:url = sitemap,
                                            # img alt + width/height, FAQ = JSON-LD, noopener, guide word counts
../chi-eats/.venv/bin/python playbook/tools/shoot.py /tmp/cri-shots   # 375 and 1440 px screenshots + overflow check
```

`verify.py` exits 1 on any problem. Set `SITE_ROOT` to check another server, including the live site.
