# Web app tests and tools (`docs/explore/`)

The web version of Chicago Restaurants: Ranked (`docs/explore/`, live at https://chicago.eatsranked.com/explore/) is a
port of the iPhone app's rules to JavaScript: `logic.js` holds the app's data loading, boards, search and formatting,
`app.js` the screens. This folder checks that port against the app itself. It sits outside `docs/`, so none of it is
published.

## Run everything

```bash
playbook/tools/explore/run_all.sh              # about 2 minutes (1 more the first time, to build the oracle)
playbook/tools/explore/run_all.sh --mutants    # also checks the checker (about 5 more minutes)
```

It ends with a summary; every line must say `pass`. The exit code is 1 otherwise. Output (the mirror, the oracle's
answers, Chrome's profile, screenshots, the full logs `logic.txt`, `browser.txt`, `verify.txt`) goes to
`$EXPLORE_WORK`, by default `$TMPDIR/chiranked-explore-tests`. Nothing is written in `docs/` or in chi-eats.

Needs: macOS with the Xcode command-line tools (`swiftc`), Node 22 or later (it uses Node's built-in WebSocket and
fetch, nothing to install), `python3`, `curl`, and Google Chrome (`CHROME=/path/to/chrome` for another one). The chi-eats
repo is expected next to this one (`CHI_EATS=/path` otherwise). Chrome runs headless with its own profile
(`$EXPLORE_WORK/chrome`), never yours.

## The steps

1. **Mirror** (`make_mirror.py <dir>`). `docs/data/v1/` is written only by chi-eats' `publish_data.py`, and until the
   first publish it has no manifest, so the web app can't load locally. The mirror serves `docs/` as is (symlinked, so
   edits show up at once) plus its own `data/v1/`: the app's bundled `chicago.json` and `illinois.json`
   (`chi-eats/ios/ChiRanked/Resources/`) under content-addressed names (`chicago-<sha256[:12]>.json`) and a
   `manifest.json` in the published format, counts from the pipeline's `validate_app_data.py`.
2. **Oracle** (`oracle/main.swift`, `oracle/shim.swift`). The app's own `Models/Place.swift`, `Models/Board.swift`,
   `Services/Search.swift`, `Services/DataStore.swift` and `Services/DataUpdater.swift`, compiled for macOS as a
   command-line tool (no simulator). `shim.swift` stands in for the one type they need from a UIKit file. It loads the
   data through the app's `DataLoader` / `DataStore` and writes everything the app would show to `oracle.json`: every
   place's fields and search texts, every board under about 130 filter sets with counts and row metrics, about 3,200
   searches (exact matches in order, the count, the 400 shown, Closest matches, how each query parsed), Near me from
   eight points, and the formatters. The searches come from `queries.tsv`, from the app's own tests (it reads
   `chi-eats/ios/ChiRankedTests/DataAndSearchTests.swift`: the coverage QA sample, the name-first cases, the rules
   fixture's queries), and from the data (names, typing prefixes, misspellings that trigger Closest matches, aka and
   alt names, towns, neighborhoods, cuisines). The binary is rebuilt only when one of those Swift files changes.
3. **Logic** (`check_logic.mjs`). Loads the mirror's data the way the page does (manifest, size, sha256, rows), runs
   `logic.js` on it and on the two fixtures, and compares with the oracle. It must report **0 differences**. It also
   checks the lines `app.js` copies from the app's SwiftUI views (Closest matches wording, "Latest in our records",
   "Newer City result", the home cards): each must still be in the Swift file and in the web files, so a change on
   either side shows up here. And no "every Chicago restaurant" claim (say "nearly every"), and no old address.
4. **Browser** (`check_browser.mjs`). Headless Chrome against the mirror on `127.0.0.1`, at 1440x900 and as a
   390x844 phone (touch, a phone user agent, 3x pixels). Against the oracle: about 40 searches (rows in order, the
   count, Closest matches with their heading, wording, buttons and the "Closest match, not an exact match" line on
   every row, "No results"), a search typed into the box, place pages (a newer City result and its labels, aka shown as
   "A · B", hidden alt names absent from the page, a rest-of-Illinois place, an id that isn't in the data), the Failed
   latest and Lowest scores boards (rows, counts, explainer, result lines), the home grid's counts, and the map (dots
   drawn, the legend's count, a focused place's card on screen above the phone's tab bar, the Illinois map). On every
   page: nothing wider than the screen; overall: no request to anything but the local server, no cookies, no console
   errors. Screenshots of each screen are in `$EXPLORE_WORK/shots/`; look at them after layout changes.
5. **verify.py** (`playbook/tools/verify.py`) with `docs/` served at the root (`SITE_ROOT=http://127.0.0.1:<port>/`),
   as the runbook does before a push. `explore/` gets its site-wide checks (canonical, og:url, images and JSON-LD on
   https://chicago.eatsranked.com/, the eatsranked.com footer link, no old address, no "every Chicago restaurant").
   It must end `PROBLEMS: 0`.
6. **Mutants** (`mutate.mjs`, with `--mutants`). Plants 22 small bugs one at a time in a copy of the web app (a stem
   rule off by one, Closest matches' limits and weights, alt names dropped, the 90-day window, a reworded row note...)
   and requires the logic test to catch each. Run it after changing `check_logic.mjs` or the oracle.

Each step also runs alone; the commands are in `run_all.sh`.

## Rules the comparison relies on

- **The one intended difference.** The app makes a link of any website `URL(string:)` accepts; the web makes links of
  `http(s)` ones only, so a value like `javascript:` could never become a link. The data only has `https`, and the
  edge fixture has an `ftp:` one to keep this rule honest. Everything else must match exactly.
- The typed needles of a query word are compared as a set: their order follows a Swift dictionary's, which changes from
  launch to launch, and doesn't change what matches.
- Distances (Near me, the nearest place) are compared to a millionth of their length, since `sin` and `cos` can differ
  in the last bit between Swift and JavaScript; the order and the labels shown must match exactly.
- Dates: `Fmt.date` and `AsOf` take a real calendar day written `yyyy-M-d` with one or two digits for month and day, as
  Foundation does. Foundation also reads odder spellings (`2026/09/01`); the data never has them.

## When something changes

- **The app's Swift changed** (`git -C ../chi-eats diff HEAD -- ios/ChiRanked`): rerun. A difference names the place,
  board or query and shows both answers; port the change to `logic.js` or `app.js` (the comments there name the Swift
  type each piece comes from). If the oracle stops building, a Swift file probably needs a new app type: add a stand-in
  to `oracle/shim.swift`, or add the file to `SOURCES` in `run_all.sh` if it builds for macOS.
- **The data changed** (a new export or publish): rerun; the mirror and the oracle read the current files.
- **More search cases:** add a line to `queries.tsv` (`dataset<TAB>scope<TAB>text`; datasets `bundled`, `rules`,
  `edge`). Cases added to the app's `DataAndSearchTests.swift` (`Case(text: ...)`, `ids("...")`, `ruled("...")`) are
  picked up automatically.
- **Fixtures:** `fixtures/rules.json` is a copy of `DataAndSearchTests.rules`; keep it in step when the test's rows
  change. `fixtures/edge.json` is ours: the Failed latest window's first day, newer results the loader must drop,
  aka and alt lists, accents, other scripts, fullwidth letters, same-name ties.

## Other tools

- `make_shapes.py` rebuilds `docs/explore/shapes.json`, the outlines the map draws (City community areas; the Illinois
  outline and counties from Overture Maps divisions, OpenStreetMap data, credited on the page). Rerun it only if a
  boundary source changes: `chi-eats/.venv/bin/python playbook/tools/explore/make_shapes.py` (it needs duckdb, which the
  pipeline's venv has). On the current inputs it reproduces the published file byte for byte.
