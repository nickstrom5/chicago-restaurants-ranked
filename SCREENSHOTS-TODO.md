# Screenshots to replace

The site references six screenshots that don't exist yet. Each path currently holds a light-blue placeholder PNG with
its caption, so nothing 404s. Replace each file **in place, same filename**. You don't need to touch any HTML unless
the real screen shows something different from the alt text below. If it does, edit the `alt` in `docs/index.html`
so it describes what's actually on screen.

| File | Size (px) | Screen to capture | Caption on the site |
|---|---|---|---|
| `docs/screenshots/iphone-1.png` | 1320 × 2868 | Rankings, **Cleanest** board, whole city | Rankings: the cleanest places in Chicago, top to bottom. |
| `docs/screenshots/iphone-2.png` | 1320 × 2868 | **Map** with grade-colored pins, "near me" button visible | Map: pins colored by grade, and what's near you. |
| `docs/screenshots/iphone-3.png` | 1320 × 2868 | **Place detail** for a well-known place: grade, score, inspections, last visit, licenses | Place page: grade, inspections, licenses and honors. |
| `docs/screenshots/iphone-4.png` | 1320 × 2868 | **Recently failed** board (or Pest citations) | Bottom boards: recently failed and pest citations. |
| `docs/screenshots/iphone-5.png` | 1320 × 2868 | **Search** with the filters sheet open | Search and filters: neighborhood, cuisine, grade and more. |
| `docs/screenshots/ipad-1.png` | 2064 × 2752 | iPad, portrait: list and map | On iPad: more of the list and the map at once. |

Current alt text (from `docs/index.html`):

1. Chicago Restaurant Inspections rankings screen listing the cleanest Chicago restaurants, each with an A–F grade chip, a 0–100 inspection score and its neighborhood
2. Map of Chicago with restaurant pins colored by inspection grade, from green A to red F, and a button to show places near you
3. Restaurant detail screen showing the letter grade and score, inspections since 2023, failed inspections, pest citations, the last visit date and result, and license details
4. Recently failed board listing Chicago restaurants whose most recent city inspection was a fail, with the inspection date and grade for each
5. Search screen with filters for side of the city, neighborhood, cuisine, grade, alcohol, dining room and hiding chains
6. iPad screen of Chicago Restaurant Inspections showing a long list of Chicago restaurants with their grades alongside a map of the city

## How to capture

- iPhone: the 6.9" simulator (iPhone 16/17 Pro Max) produces 1320 × 2868, the same size App Store Connect wants.
  iPad: the 13" iPad simulator produces 2064 × 2752. `xcrun simctl io booted screenshot iphone-1.png`.
- Set the simulator clock to 9:41 and a full battery (`xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100 --batteryState charged`).
- The same captures can go to App Store Connect.

## Weight

A raw 1320 × 2868 screenshot is often 1–3 MB. The page shows them at about 200–440 px wide, so compress before committing:
run them through ImageOptim or `pngquant --quality 70-90`, or save a half-size copy (660 × 1434 and 1032 × 1376).
Keep the **same aspect ratio** so the `width`/`height` attributes in the HTML still reserve the right space. Aim for under
~300 KB per file. They are lazy-loaded, so they don't count against the page's first load.

The JSON-LD `screenshot` list in `docs/index.html` points at the same six URLs, so it updates automatically.
