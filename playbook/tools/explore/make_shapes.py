"""Builds docs/explore/shapes.json, the outlines the web app's canvas map draws. Rerun only if a boundary source changes.
It lives here, outside docs/, so it isn't published with the site.

- Chicago's 77 community areas: City of Chicago Data Portal, "Boundaries - Community Areas" (igwz-8jzy), the file the
  pipeline already fetches (chi-eats/data/raw/community_areas.geojson). Names are matched to the app data's `hoods`.
- The Illinois outline and county lines: chi-eats/data/il/il_shapes.json, from Overture Maps divisions (OpenStreetMap
  data, ODbL); the page credits "© OpenStreetMap contributors". The iPhone app doesn't ship these; only the website uses them.
- Lake Michigan: those outlines run to the state line out in the lake, so the shore is drawn as a lake polygon on top. Its
  edge is Chicago's own lakefront (the community areas' easternmost points) and, north of the city, the easternmost points
  of Overture places (beaches, parks, harbors) per 0.005° of latitude, with lone points out in the water ignored. The far
  shores in other states are a rough outline for context only (see FAR below).

usage: chi-eats/.venv/bin/python playbook/tools/explore/make_shapes.py [chi-eats dir]    (needs duckdb for the North Shore; the
pipeline's venv has it)
"""
import json, os, re, sys

CHI = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "../../../../chi-eats")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "docs", "explore", "shapes.json")


def dp(pts, tol):
    """Douglas-Peucker on [lon, lat] points (lon scaled by cos(lat) so the tolerance is even in both directions)."""
    if len(pts) < 5:
        return pts
    k = 0.74   # cos(41.8°)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a][0] * k, pts[a][1]
        bx, by = pts[b][0] * k, pts[b][1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i][0] * k, pts[i][1]
            if L2 == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best:
                best, bi = d, i
        if bi > 0 and best > tol * tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, kp in zip(pts, keep) if kp]


def ring(r, tol, nd):
    out = [[round(x, nd), round(y, nd)] for x, y in dp(r, tol)]
    dedup = [p for i, p in enumerate(out) if i == 0 or p != out[i - 1]]
    return dedup if len(dedup) >= 4 else None


hoods = json.load(open(os.path.join(CHI, "ios/ChiRanked/Resources/chicago.json")))["meta"]["hoods"]
norm = lambda s: re.sub(r"[^a-z]", "", s.lower())
by_norm = {norm(h): h for h in hoods}
g = json.load(open(os.path.join(CHI, "data/raw/community_areas.geojson")))
areas = []
for f in g["features"]:
    raw = f["properties"]["community"]
    name = by_norm.get(norm(raw), raw.title())
    geom = f["geometry"]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    rings = []
    for poly in polys:
        r = ring(poly[0], 0.00018, 4)        # about 20 m; outer rings only (no community area has a hole that matters here)
        if r:
            rings.append(r)
    areas.append({"n": name, "r": rings})
areas.sort(key=lambda a: a["n"])
il = json.load(open(os.path.join(CHI, "data/il/il_shapes.json")))
state = [r for r in (ring(x, 0.004, 3) for x in il["state"]) if r]
counties = [r for c in il["counties"] for r in (ring(x, 0.006, 3) for x in c["c"]) if r]
# ---- Lake Michigan
BAND = 0.005
city_pts = [p for a in areas for r in a["r"] for p in r]
shore = []                          # (lat, lon) from the Indiana line north
lat = 41.760
while lat < 42.0226:
    band = [x for x, y in city_pts if lat - BAND / 2 <= y < lat + BAND / 2]
    if band:
        shore.append((round(lat, 4), max(band)))
    lat += BAND
try:
    import duckdb
    rows = duckdb.connect().execute(
        f"select lat, lon from '{os.path.join(CHI, 'data/il/overture_il_bbox.parquet')}' where lat between 42.02 and 42.5 and lon > -88.0").fetchall()
except Exception as e:      # without duckdb, the North Shore is a straight line to the Wisconsin line
    print("no duckdb:", e)
    rows = []
north = []
lat = 42.03
while lat <= 42.4951:
    lons = sorted((x for y, x in rows if lat - BAND / 2 <= y < lat + BAND / 2), reverse=True)
    for i, L in enumerate(lons):    # the easternmost point with two neighbors within about 500 m: lone points in the water don't count
        if sum(1 for M in lons[i:i + 12] if L - M <= 0.006) >= 3:
            north.append((round(lat, 4), L))
            break
    lat += BAND
# drop a band that sits far out in the water compared with the bands around it (a cluster of misplaced points), then a
# 3-band median irons out single inland dips and spikes; then a little east for the beach itself
def near_median(i):
    around = sorted(v for j, (_, v) in enumerate(north) if j != i and abs(j - i) <= 3)
    return around[len(around) // 2]
north = [(y, x) for i, (y, x) in enumerate(north) if x - near_median(i) <= 0.02]
def med3(i):
    w = sorted(v for _, v in north[max(0, i - 1):i + 2])
    return w[(len(w) - 1) // 2] if len(w) % 2 == 0 else w[len(w) // 2]
med = [(north[i][0], med3(i)) for i in range(len(north))]
shore += [(y, x + 0.0015) for y, x in med]
if shore[-1][0] < 42.495:
    shore.append((42.495, shore[-1][1]))
# The far shores (Wisconsin, Michigan, Indiana) are only context around Illinois: a rough outline from a few towns on the
# water, (lon, lat): Kenosha, Racine, Milwaukee, Port Washington; Whitehall, Holland, South Haven, St. Joseph, New Buffalo,
# Michigan City, the Indiana Dunes, Gary, Indiana Harbor, Whiting and Hammond back to the Illinois line.
FAR = [[-87.81, 42.58], [-87.78, 42.73], [-87.89, 43.04], [-87.87, 43.39], [-87.87, 43.6], [-86.40, 43.6], [-86.34, 43.23],
       [-86.21, 42.77], [-86.21, 42.66], [-86.28, 42.40], [-86.49, 42.11], [-86.60, 41.91], [-86.745, 41.80], [-86.91, 41.725],
       [-87.05, 41.67], [-87.19, 41.63], [-87.33, 41.617], [-87.44, 41.672], [-87.488, 41.685], [-87.51, 41.70]]
lake = [[-87.524, 41.7606]] + [[round(x, 4), y] for y, x in shore] + FAR
lake = ring(lake, 0.00025, 4) or lake

out = {
    "credit": {"areas": "Community area boundaries: City of Chicago Data Portal (igwz-8jzy), simplified.",
               "illinois": "Illinois and county outlines: Overture Maps Foundation divisions, © OpenStreetMap contributors (ODbL), simplified."},
    "areas": areas, "illinois": state, "counties": counties, "lake": lake,
}
json.dump(out, open(OUT, "w"), separators=(",", ":"))
pts = sum(len(r) for a in areas for r in a["r"])
print(f"lake: {len(lake)} points, north shore bands {len(north)}")
print(f"{OUT}: {len(areas)} areas ({pts} points), Illinois {sum(map(len, state))} points, {len(counties)} county rings, {os.path.getsize(OUT):,} bytes")
