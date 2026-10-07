# Site runbook: Chicago Restaurants: Ranked

Internal notes. This folder is **not** published; only `docs/` is.

- Site: **https://chicago.eatsranked.com/** (GitHub Pages from `docs/` on `main`; `docs/CNAME` names the domain; DNS: a
  CNAME record `chicago` → `nickstrom5.github.io` on eatsranked.com, live since 2026-09-28). Once `docs/CNAME` is pushed,
  GitHub redirects the old https://nickstrom5.github.io/chicago-restaurants-ranked/ URLs to the same page on the domain.
- Web version: https://chicago.eatsranked.com/explore/ (`docs/explore/`, built separately; it reads the same
  `docs/data/v1/` files as the app). The header nav on every page ("Search on the web"), the home page, the sitemap and
  the support and privacy pages link to it.
- Hub: https://eatsranked.com/ (the other states). Every footer has "More states at eatsranked.com".
- Repo: https://github.com/nickstrom5/chicago-restaurants-ranked (public; support is by email, work-with-nick@gmail.com, with GitHub Issues as a public option)
- Static HTML, inline CSS, no build step, no third-party scripts, fonts or tracking. `docs/*.html` is the source of truth.

## 1. Publish

1. On GitHub, create the **public** repo `nickstrom5/chicago-restaurants-ranked` (no README, it already has one).
2. `git remote add origin git@github.com:nickstrom5/chicago-restaurants-ranked.git && git push -u origin main`
3. Repo → Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch `main`, folder `/docs` → Save.
4. Wait for the Pages build (Actions tab).
5. **Custom domain.** `docs/CNAME` contains `chicago.eatsranked.com`, so the push sets it. Repo → Settings → Pages →
   Custom domain must read `chicago.eatsranked.com` with a green "DNS check successful" (if it's empty, type the domain and
   Save). GitHub then requests a certificate for it.
6. **Enforce HTTPS (Nick).** Once the certificate is issued (the Settings → Pages page says so and the **Enforce HTTPS**
   box stops being greyed out; usually minutes, up to a day), tick **Enforce HTTPS**. Until then the domain answers only
   over plain http, which App Review, the App Store fields and the app (App Transport Security) can't use. Then check:
   `curl -sI https://chicago.eatsranked.com/` returns 200, and
   `curl -sI https://nickstrom5.github.io/chicago-restaurants-ranked/support.html` returns a 301 to
   `https://chicago.eatsranked.com/support.html`.
7. Recommended: verify `eatsranked.com` for the GitHub account (github.com → Settings → Pages → Add a domain; one DNS TXT
   record), so no other GitHub repo can claim a subdomain of it.
8. Repo → Settings → General → Features: make sure **Issues** is on. The issue forms in `.github/ISSUE_TEMPLATE/` show up automatically.
9. Open https://chicago.eatsranked.com/does-not-exist and check the 404 page is styled and its links work.

### The custom domain

- **The site lives at the domain root.** Canonical, og:url, og:image, twitter:image, JSON-LD, `sitemap.xml`, the
  `robots.txt` Sitemap line and `site.webmanifest` (start_url and scope `/`) all use `https://chicago.eatsranked.com/`.
  Every page except `404.html` uses relative links.
- **404.html uses root-absolute links** (`/...`) because GitHub serves it for any missing path, at any depth.
- **robots.txt is read now** (it's at the host root) and names the sitemap.
- **The old address redirects.** GitHub sends every `nickstrom5.github.io/chicago-restaurants-ranked/...` URL to the same
  path on the domain, so old links and the issue templates still reach the site.
- **The app fetches the domain directly.** Build 1.0 (2)'s `DataUpdater.site` is `https://chicago.eatsranked.com/` (its
  About links are built from it too), so it doesn't rely on the redirect. What it needs is a valid certificate for
  `chicago.eatsranked.com` (§1 steps 5–6): App Transport Security refuses a certificate issued for another name, so until
  GitHub has issued one every check fails and the app keeps its current data (safely) instead of updating. Keep Enforce
  HTTPS on as good practice, so plain-http visitors and old github.io links end up on https; the app itself only ever
  asks for https.
- **Changing the domain again:** edit `docs/CNAME`, replace the domain everywhere in `docs/` (the list above),
  `BASE` in `playbook/tools/verify.py`, `SITE` in `chi-eats/ios/scripts/listing-copy.py`, `LIVE` in
  `chi-eats/pipeline/publish_data.py` and `DataUpdater.site` in the app, then paste the new URLs into App Store Connect.

## 2. SEO after launch

Do these once the site is live.

- **Google Search Console** (search.google.com/search-console): Add property → **Domain** → `eatsranked.com`, verified
  with the DNS TXT record Google gives you (at the eatsranked.com registrar). It covers chicago.eatsranked.com and any
  other state's subdomain. (A **URL prefix** property for `https://chicago.eatsranked.com/` also works, verified with the
  **HTML tag** method: paste the `<meta name="google-site-verification" content="...">` line into `<head>` of
  `docs/index.html` next to the Smart App Banner comment, commit, push, wait for Pages, click Verify.) Then Sitemaps →
  submit `https://chicago.eatsranked.com/sitemap.xml`. `robots.txt` names it too.
- **Request indexing:** URL Inspection → paste the home page URL → Request indexing. Repeat for the web version
  (`explore/`) and the three guides: `how-chicago-restaurant-inspections-work.html`,
  `look-up-chicago-restaurant-inspections.html`, `chicago-restaurant-grades.html`.
- **Bing Webmaster Tools** (bing.com/webmasters): "Import from Google Search Console" is the quickest. Otherwise add the
  same URL and verify with the `msvalidate.01` meta tag or a `BingSiteAuth.xml` file in `docs/`. Submit the same sitemap,
  and use URL Submission for the home page and guides.
- **Smart App Banner and store buttons:** see §5, "Release checklist". The Apple ID is 6816931379.
- **Validate:** search.google.com/test/rich-results on the home page (FAQ, software app) and on a guide (Article,
  Breadcrumb); validator.schema.org for the full graph; paste the home page URL into a link-preview checker
  (opengraph.xyz, or send it to yourself in iMessage) and check `og.png` shows.
- **Never add `aggregateRating` or review markup.** There are none, and the app deliberately carries no ratings or reviews.
- Bump `<lastmod>` in `docs/sitemap.xml` (and `dateModified` in that page's Article JSON-LD) whenever a page's content
  changes, then re-request indexing for it.

## 3. Keep the site honest

Rules for anyone editing `docs/`.

- **Data numbers and dates live in `data-stat` spans.** The data refreshes weekly (see §6), so no page hard-codes a count
  or the records date. In `<body>`, every data-derived number or date is wrapped as `<span data-stat="KEY">text</span>`,
  and `playbook/tools/update_counts.py` (run by the weekly publish) rewrites the span contents. Keys and formats:

  | Key | Meaning | Format |
  |---|---|---|
  | `places` | Chicago places in the app (`chicago.json` rows, venues included) | `8,354` |
  | `restaurants` | Chicago restaurants shown by default (venues aside) | `7,820` |
  | `graded` | those restaurants with a grade | `7,652` |
  | `graded_floor` | `graded` rounded down to the hundred, plus "+" | `7,600+` |
  | `illinois` | restaurants in the rest of Illinois (venues aside) | `17,602` |
  | `towns` | other Illinois towns with at least one of them | `927` |
  | `records_through` | City records date | `September 21, 2026` |

  Rules:
  - **`<head>` carries no exact counts or dates** (title, meta description, og/twitter, JSON-LD). The one data number
    allowed there is the `graded_floor` text ("7,600+"), which `update_counts.py` swaps in `<head>` too; any other
    "N,NNN+" in a `<head>` makes it fail. Today no `<head>` has one. Page edit dates are not data and are not spans:
    `update_counts.py` sets sitemap `lastmod` and Article `dateModified` to the run date on pages it changes, and the
    visible "Updated"/"Effective" lines change only when someone edits the words.
  - **FAQ answers carry no data numbers or dates.** The visible FAQ must match its `FAQPage` JSON-LD word for word, and
    the JSON-LD (in `<head>`) can't hold a span. Say "thousands of restaurants in hundreds of other Illinois towns", or
    "the app shows the date its City records run through", instead.
  - Screenshot `alt` text describes the image as captured (for example "Cleanest Kitchens (6,444)"), so it changes only
    when the screenshots are re-shot, not weekly.
  - A new number on a page gets a span, or a key added to `update_counts.py` first. The script fails on an old value
    left outside a span, but it can't see a number it was never told about (or one under 1,000, like the town count). Current values come from
    `chi-eats/ios/ChiRanked/Resources/chicago.json` and `illinois.json` (rows and `meta`). Hand-checked figures that
    aren't weekly data ("about two dozen published sales", the "about 7 in 10" calibration in `chi-eats/pipeline/illinois.py`)
    stay as words.
- **FAQ = JSON-LD.** The visible FAQ and the `FAQPage` JSON-LD must match word for word, on both `index.html` and
  `support.html`. `playbook/tools/verify.py` checks this.
- **Freshness words.** The data is refreshed about weekly and can lag the City by a week or more. Say "failed latest
  inspection", never "recent" or "recently failed" (the app's Failed latest board keeps only fails within 90 days of the
  records date). Say "about once a week" for our data, not "daily" or "real time", and never promise an exact publish day.
  - Keep checking and downloading apart. The app *checks* this site for a new manifest when it's opened: at most once a
    day after a successful check, an hour later after a failed one (so up to hourly while the manifest is missing), and on
    "Check for new data". It *downloads* data about once a week. Never write "about once a week the app contacts / downloads
    from this website" in a way that hides the checks; `privacy.html` "Data updates" states the exact cadence.
  - Don't name a weekday for the City's updates. The City's data-description PDF says "each Friday", but the portal lists
    the Food Inspections dataset as "Updated daily", rows are added on most days, and some results are posted more than a
    week after the inspection (checked 2026-09-28, §3 "Sources for the inspection guides"). Say that instead.
  - Don't write "sends nothing about you" for the update requests. They carry no location, identifiers, cookies or usage
    data, but like any web request they include the IP address and the app's name and version (User-Agent). The app sends
    a fixed `Accept-Language: en`, the same for everyone, so pages don't mention the device's language. Name what isn't
    sent, and say standard technical details are.
- **The grades page mirrors the pipeline.** `chicago-restaurant-grades.html` publishes the exact method: weights from
  `chi-eats/pipeline/build.py` `inspection_record()` (40 × fail share, 3 × violations per visit capped at 10, 8 × items
  1–29 per visit capped at 3, 25 × pest share, 8 if the last visit failed, 6 × pass-with-conditions share), the two-visit
  pull toward the city mean and the cutoffs and F/A rules in `pipeline/score.py`, and the two-inspection minimum for the
  Cleanest/Lowest boards in `ios/ChiRanked/Models/Board.swift`. If any of these change, update the grades page, the
  "How the grades work" block and the grade FAQ on `index.html`, and the app's About screen.
- **Sources for the inspection guides.** Everything on `how-chicago-restaurant-inspections-work.html` and
  `look-up-chicago-restaurant-inspections.html` comes from the Food Inspections dataset page and its data-description PDF
  on data.cityofchicago.org, and from violation titles in the data itself. The one exception is the risk schedule (risk 1
  twice a year, risk 2 once a year, risk 3 every other year), cited to CDPH's "Understand Health Code Requirements for Food
  Establishments" page on chicago.gov. chicago.gov refuses automated fetches, so that sentence was confirmed from the
  search-engine text of that page. **Before launch, open the page in a browser and confirm it still says that.**
  Where the PDF and the portal disagree, the portal's current metadata wins: the PDF's "updated ... each Friday" is out of
  date (the metadata says "Updated daily"). "Some results arrive over a week late" was checked on 2026-09-28 with each
  row's Socrata `:created_at`: of 888 inspections dated September 1–28, 139 were posted 8 or more days after the visit
  (up to 26), and new rows were added on most days, weekends included.
- **Things the site deliberately does not claim:**
  - No Bib Gourmand or Green Star. `curated.json` has none as of 2026-09-26, so the site says "Michelin Guide Chicago 2025 stars".
    If the data gains them, add them to the copy.
  - Not "all 77 community areas". The data covers 76 (Burnside has no licensed places).
  - Not "every Chicago restaurant", for coverage or for grades. A few real restaurants are filed by the City under other
    facility types (Grocery Store, Shared Kitchen) and aren't in the data, so say "nearly every"; `verify.py` (every
    sitemap page) and `chi-eats/ios/scripts/listing-copy.py` (the App Store text) fail on "every Chicago restaurant".
  - Not "every restaurant has a grade". About 98% do (7,652 of 7,820 on the September 21, 2026 data), so the lede says "nearly every". The
    `og.png` now says "Our health grades for nearly every Chicago restaurant" (re-rendered in the cross-check). The
    same string must be changed on the `pitch` line of `chi-eats/ios/scripts/make-brand.swift`, or re-running that
    script puts "every" back.
  - No star ratings, reviews or price levels, anywhere. The app doesn't carry them.
- **Footer disclaimer.** Every page's footer carries the City of Chicago data disclaimer **word for word** (the City's
  Data Terms of Use require it wherever an app built on its data can be downloaded) and the independence line. Never
  paraphrase or drop it; new pages copy the footer as is.
- **No negative lists in marketing.** No Worst inspections / Recently failed / Pest citations board, and no D or F place,
  in screenshots, `og.png`, page titles or meta descriptions (app-review-risk.md L5, S6). Describe those boards
  neutrally in body copy ("lowest inspection scores", "failed latest inspection").
- **Legal pages** (`privacy.html`, `terms.html`) were drafted, not reviewed by a lawyer. Keep them in step with the app:
  if the app ever adds analytics, crash reporting, an account or anything that collects data, update `privacy.html` and
  the App Store privacy label **before** that version ships. The weekly data download (build 1.0 (2)) is described in
  `privacy.html` "Data updates": how often it checks and downloads, JSON data only, no location, identifiers, cookies or
  usage data, and the standard details any request carries (IP address, the app's name and version), which GitHub sees
  like any web host. If the download ever sends anything more (a query parameter, an identifier, a header that varies by
  device, such as the device's own language), that section and the label change first. `privacy.html` "The web version"
  describes `explore/`: nothing collected, no cookies or third-party requests, Saved in the browser's storage, location
  only on a tap and only in the browser. If `explore/` ever changes any of that, that section changes first.
- **Visible page dates are the push date.** When the words of any page with an "Effective" or "Updated" line change
  (`privacy.html`, `terms.html`, `support.html` and the three guides: `how-chicago-restaurant-inspections-work.html`,
  `look-up-chicago-restaurant-inspections.html`, `chicago-restaurant-grades.html`), that line is the day the new words
  go live (the push date), never an earlier day; bump the page's `<lastmod>` in `sitemap.xml` (and a guide's Article
  `dateModified`) with it. If the push slips past the date you wrote, change the date before pushing. `data-stat`
  span updates by `update_counts.py` don't count as new words. (The 2026-10-05 rewrite of privacy and terms first
  shipped under "Effective 28 September 2026", a week before it went live, and privacy promises a new effective date
  for changes; the three guides' wording changes in that push also went out under "Updated 28 September 2026".)
- **Site edits go out before a data publish.** `chi-eats/pipeline/publish_data.py` refuses to run while `docs/` has
  uncommitted or untracked changes, and while the site has unpushed commits it didn't make (any commit whose subject
  isn't its own `Data:`/`Weekly data: City records through …`, or that touches anything outside `docs/`, this
  runbook included). So run §4, then commit **and push** page and playbook edits (with Nick's OK) before a
  `--push` or `--republish --push` run, or the weekly run that follows.
- **Say which version a sentence covers.** The terms and privacy cover both the app and this website, which differ:
  in the app the map and directions are Apple's; on the web the map is drawn in the browser from City of Chicago and
  OpenStreetMap/Overture outline files (no map service), and directions open Apple Maps. The app's links go to
  this website (chicago.eatsranked.com), not to GitHub.

## 4. Verify before pushing

```bash
# serve docs/ at the root, the way GitHub Pages serves chicago.eatsranked.com
(cd docs && python3 -m http.server 8791 --bind 127.0.0.1) &
python3 playbook/tools/verify.py            # 200s, links, assets, anchors, JSON-LD, one h1, heading order,
                                            # title 50–60 / description 140–160, canonical = og:url = sitemap,
                                            # img alt + width/height, FAQ = JSON-LD, noopener, guide word counts,
                                            # docs/CNAME, robots.txt Sitemap line, manifest scope, no old github.io
                                            # URL, and on every page the explore/ link and the eatsranked.com hub link
SITE_ROOT=http://127.0.0.1:8791/ ../chi-eats/.venv/bin/python playbook/tools/shoot.py /tmp/cri-shots   # 375 and 1440 px + overflow
```

Every URL in `sitemap.xml` also gets the site-wide checks, including pages built elsewhere such as `explore/`: no old
github.io address or `/chicago-restaurants-ranked/` path, the eatsranked.com hub link, canonical = og:url = its sitemap
URL, og:image and twitter:image on the domain, JSON-LD that parses, points at the domain and has no rating or review
markup, no "every Chicago restaurant" (the data covers nearly every one), and the Content-Security-Policy meta tag
(GitHub Pages can't send the header): right after `<meta charset>`, `script-src 'self'` on a page that loads a script
file and `'none'` on one that doesn't, and no inline `<script>` or `on…=` handler, which the policy would block (the
home page's App Store script is `docs/store.js` for that reason; JSON-LD is fine). A new page in the sitemap is checked
automatically. It also checks `/favicon.ico` and `/.well-known/security.txt` (Contact, Canonical, an `Expires` in the
future: it fails once that date passes, so move it a year ahead when it warns). `explore/index.html` (owned by the
Explore workflow) failed these on 2026-09-28 and passes them as of 2026-10-05.

`verify.py` exits 1 on any problem. Set `SITE_ROOT` to check another server, including the live site
(`SITE_ROOT=https://chicago.eatsranked.com/ python3 playbook/tools/verify.py`). A root-absolute link (`/x`, in
`404.html`) resolves against `SITE_ROOT`, so docs/ served under a path prefix checks the same way. `shoot.py` still
defaults to the old `/chicago-restaurants-ranked/` path, hence its `SITE_ROOT`.

`support.html` questions are `<h2>` tags directly followed by one `<p>`, which is how `verify.py` matches the FAQ. To link
to one, put the `id` on a span inside it, as `<h2><span id="report">…</span></h2>` does (`privacy.html` and `terms.html`
link to `support.html#report`).

## 5. Release checklist (App Store go-live)

### Before submitting build 1.0 (2)

Build 1.0 (2) is the first build with the weekly data refresh, and the site, terms, privacy policy and listing all say the
data is refreshed about weekly. The three steps below were blockers, in this order. **Steps 1 and 2 were done on
2026-10-05** (the pages are live at https://chicago.eatsranked.com/ over HTTPS with Enforce HTTPS on, and the first
publish made manifest version 2026-09-28.1); step 3's task exists but still needs its permissions approved. Before
each submission, check again that the pages and the manifest return 200.

1. **Push the pages and move to the domain.** Run §4 (it must end `PROBLEMS: 0`, `explore/` included), then commit
   **and push** everything under `docs/` **before** the first publish, until `git status -- docs` is clean: the updated
   pages, `sitemap.xml`, `robots.txt`, `site.webmanifest`, `docs/CNAME`, `docs/explore/` (it can't stay untracked, so
   it has to be finished first) and `docs/data/v1/NOTICE.txt`, the one-time exception in §6. `publish_data.py --push`
   refuses to run while `docs/` has uncommitted or untracked files or the site has unpushed commits it didn't make, so
   "together with the publish" no longer works. Then do §1 steps 5 and 6 (custom domain, certificate, Enforce HTTPS) and
   check `https://chicago.eatsranked.com/privacy.html` loads over HTTPS: App Review reads it, and the listing's Support,
   Marketing and Privacy URLs point at the domain. Until the first publish, `explore/` can't load data (it reads
   `data/v1/manifest.json`), so do step 2 straight after.
2. **First data publish (done 2026-10-05).** From `chi-eats/`: `.venv/bin/python pipeline/publish_data.py --first --push`
   (a `--first --dry-run` first shows everything and writes nothing; `--first` is ignored now that a live manifest exists). It stops at its `live_manifest` gate until
   `https://chicago.eatsranked.com/` has a valid certificate (step 1). Then
   `curl -sI https://chicago.eatsranked.com/data/v1/manifest.json`, the address build 1.0 (2) fetches, must return 200,
   and About › "Check for new data" on the TestFlight build must say "You have the latest data". Until then the manifest
   is a 404 (or, without the certificate, unreadable), the button says "Couldn't check — try again later", and the review
   notes send the reviewer to it.
3. **Weekly scheduled task: created; approve its permissions once.** The Claude scheduled task
   `chicago-restaurants-weekly-data` runs `publish_data.py --push` on Mondays at 06:30 America/Chicago (prompt and rules:
   `chi-eats/pipeline/ops/weekly-publish-task.md`; see §6). Until its tool permissions are approved (allow rules, or a
   "Run now" answering "always allow" at each prompt), each run waits at its first prompt and publishes nothing, though
   the task list may show "succeeded" (`chi-eats/ios/CLAUDE.md`, "Weekly data refresh"). Without a working weekly run
   the "about once a week" wording on every page is false within a couple of weeks.

The hub link: https://eatsranked.com/ is live over HTTPS (checked 2026-09-28: 200 from GitHub Pages, "Eats Ranked:
Restaurant Grades & Rankings, State by State"), so every footer's "More states at eatsranked.com" works.

### After Apple approves

The App Store Connect record exists: Apple ID **6816931379**. While the app is in review, leave the "Coming soon to the
App Store" buttons and the commented-out banner as they are. Once Apple approves the app **and it is live on the store**
(a banner or button pointing at a page that isn't live yet looks broken), with Nick's OK:

1. In `docs/index.html`, uncomment the Smart App Banner and set its app id:
   `<meta name="apple-itunes-app" content="app-id=6816931379">`. Delete the instruction comment around it.
2. In `docs/store.js` (the home page loads it at the bottom), set
   `var APP_STORE_URL = "https://apps.apple.com/app/id6816931379";`. Every `data-store-btn` button then links to the App
   Store and reads "Download on the App Store", and goes back to the solid button style (until then it is a quiet badge).
3. Restore the "Free iPhone and iPad app" wording in `docs/index.html`'s title and description (`<title>`, `description`
   and their `og:` and `twitter:` copies say "app coming soon" until launch); keep verify.py's 50–60 and 140–160 characters.
4. Add `"downloadUrl"` and `"installUrl"`, both `https://apps.apple.com/app/id6816931379`, to the `MobileApplication`
   JSON-LD in `docs/index.html`, and add the App Store link to `README.md`.
5. Open `https://apps.apple.com/app/id6816931379` in a browser and check it shows Chicago Restaurants: Ranked.
6. Run §4, bump `lastmod` for the home page in `docs/sitemap.xml`, commit, push, wait for Pages, then open the live home
   page on an iPhone in Safari and check the banner and both buttons.

## 6. Weekly data on the site

From build 1.0 (2) the app checks `data/v1/manifest.json` on the site (https://chicago.eatsranked.com/data/v1/manifest.json,
requested directly: `DataUpdater.site` is the domain, so it needs the domain's certificate, §1 step 6) when it is opened
(at most once a day after a successful check, an hour later after a failed one, and on About › "Check for new data") and
downloads newer data files when there are any, about once a week. The web version (`explore/`) reads the same files.
`chi-eats/pipeline/publish_data.py`
writes everything under `docs/data/v1/` (the manifest, content-addressed `chicago-<sha>.json` / `illinois-<sha>.json`
files and `NOTICE.txt`), runs `playbook/tools/update_counts.py` to refresh the `data-stat` spans (§3), sitemap
`lastmod` and Article `dateModified`, and runs §4 before it pushes. It runs weekly from the Claude scheduled task
`chicago-restaurants-weekly-data` (Mondays 06:30 America/Chicago) and publishes nothing if any gate fails.

**Status 2026-10-05: live.** The first publish went live on 2026-10-05 (manifest version 2026-09-28.1, published
2026-10-05T13:19:54Z), and the scheduled task exists; its tool permissions still need approving once (§5 step 3).

- **`publish_data.py` is the only way to change `docs/data/`.** Never hand-edit, copy or delete files there, and never
  commit them by hand: a wrong file reaches every installed app and every web visitor. **One exception, once (done 2026-10-05):**
  `docs/data/v1/NOTICE.txt`, which `publish_data.py` itself wrote while it was being tested on 2026-09-28, was committed
  unchanged with the pages in §5 step 1, because the script's preflight refuses any untracked file under `docs/` (it
  still names the old github.io address; the first publish rewrites it). From then on the script updates and commits it
  like every other file there. Weekly: `publish_data.py --push`.
  First time (done): `--first --push`. To correct a wrong fact that's already published for the same records date:
  `publish_data.py --republish --push` (it publishes the corrected files as the next version of that date and runs every
  gate). `--dry-run` shows everything and writes nothing.
- **Exit codes and statuses** (`chi-eats/data/publish_report.json` → `status`): **0** = `published`, `published_locally`
  (no `--push`), `dry_run_ok` or `no_new_data`; **2** = `failed` or `error`: a gate or step failed and nothing new is
  public (the report lists why); **3** = `published_unconfirmed`: git said the site push worked but the remote doesn't show
  it, so check the live site. The weekly task republishes the web leaderboard artifact only on `published`.
- `v1` is the data format the shipped apps read. A breaking change to the JSON format goes in a new `docs/data/v2/`
  folder with an app update that reads it, so apps already installed keep reading `v1`.
- Only the Google-free app exports go there (S5 in `chi-eats/ios/playbook/app-review-risk.md`): never
  `chi-eats/site/restaurants.json` or anything else from the old leaderboard.
