# Chicago Restaurants: Ranked

A free iPhone and iPad app ("Chi Ranked" on your home screen) that turns the City of Chicago's food inspection records
into a 0–100 score and an A–F grade for Chicago restaurants, with rankings, a map, search and saved places.

- Website: https://chicago.eatsranked.com/
- Search on the web (the web version): https://chicago.eatsranked.com/explore/
- How the grades are calculated: https://chicago.eatsranked.com/chicago-restaurant-grades.html
- More states: https://eatsranked.com/
- Privacy: the app collects no data. No account, no analytics, no ads. Location is optional and stays on your device.

The grade is calculated by the app from public records. It is not an official City of Chicago grade, and this project is
not affiliated with the City of Chicago, Cook County, the Michelin Guide or the James Beard Foundation.

## Support

Open an issue: https://github.com/nickstrom5/chicago-restaurants-ranked/issues

Issues are public, so please don't include personal information. For a restaurant that looks wrong, include its name,
address and what's wrong. Inspection results come from the City of Chicago; we fix records that are matched to the wrong
business in the next update.

## Data

- City of Chicago Data Portal: Food Inspections and Business Licenses
- Cook County Assessor: 2025 property values
- Michelin Guide Chicago 2025 and James Beard Foundation honors, verified opening years and published sales (hand-verified)
- Overture Maps Foundation places (CDLA Permissive 2.0, Apache 2.0, CC0): restaurant websites and the directory of
  restaurants elsewhere in Illinois

## This repository

`docs/` is the public website, served by GitHub Pages at the custom domain in `docs/CNAME` (chicago.eatsranked.com; the old
nickstrom5.github.io/chicago-restaurants-ranked/ address redirects there). `docs/data/` is written and committed only by
the weekly publish script (`playbook/01-site-runbook.md` §6, which notes one exception before the first publish).
Everything else (`playbook/`, `SCREENSHOTS-TODO.md`) is internal notes.

© 2026 Nicholas Soderstrom.
