"""Rebuild data/science_features.json: the mineral, salt, ice and active-surface maps behind the
science layers, from NASA Mars Trek's feature services (run from the martian-map folder):

    .venv\\Scripts\\python scripts\\build_science_layers.py

  hydrous   CRISM (MRO) + OMEGA (Mars Express) hydrous-mineral detections    Carter et al. 2013
  aqueous   minerals that formed in water, by class (clays, silica, ...)      Ehlmann & Edwards 2014
  chloride  chloride-salt deposits mapped with THEMIS (Mars Odyssey)          Osterloo et al. 2010
  active    HiRISE: fresh craters (some exposing ice), RSL, active gullies    Daubar 2013, Dundas 2014/15,
                                                                              McEwen 2014, Ojha 2014
"""
import json
import math
from pathlib import Path

import httpx

OUT = Path(__file__).resolve().parent.parent / "data" / "science_features.json"
BASE = "https://trek.nasa.gov/mars/trekarcgis/rest/services/{}/MapServer/0/query"


def query(service: str) -> list[dict]:
    # the services return at most 1000 features and don't page, so walk the feature ids instead
    feats = []
    with httpx.Client(timeout=120) as c:
        n = c.get(BASE.format(service), params={"where": "1=1", "returnCountOnly": "true", "f": "json"}).json()["count"]
        for lo in range(0, n + 1000, 1000):
            r = c.get(BASE.format(service), params={"where": f"FID >= {lo} AND FID < {lo + 1000}", "outFields": "*",
                                                    "returnGeometry": "true", "f": "geojson"})
            r.raise_for_status()
            feats += r.json()["features"]
    if len(feats) < n:
        raise SystemExit(f"{service}: got {len(feats)} of {n} features")
    return feats


def centroid(geom) -> tuple[float, float, float]:
    """(lat, lon, area km²) of a polygon, from its outer rings (small polygons: planar is fine)."""
    rings = geom["coordinates"] if geom["type"] == "Polygon" else [p[0] for p in geom["coordinates"]]
    if geom["type"] == "Polygon":
        rings = [rings[0]]
    A = cx = cy = 0.0
    for ring in rings:
        for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
            c = x0 * y1 - x1 * y0
            A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c
    if abs(A) < 1e-12:
        x, y = ring[0]
        return y, x, 0.0
    cx, cy = cx / (3 * A), cy / (3 * A)
    km_per_deg = 3389.5 * math.pi / 180
    return cy, cx, abs(A) / 2 * km_per_deg ** 2 * math.cos(math.radians(cy))


r3 = lambda v: round(v, 3)
out = {"source": "NASA Mars Trek feature services (trek.nasa.gov), compacted by scripts/build_science_layers.py",
       "hydrous": [], "aqueous": [], "chloride": [], "active": []}

seen = set()
for f in query("Hydrous_Mineral_Detections_OMEGA_CRISM_clon0"):
    lon, lat = f["geometry"]["coordinates"]
    key = (r3(lat), r3(lon), f["properties"]["Instrument"])
    if key not in seen:
        seen.add(key); out["hydrous"].append(list(key))

seen = set()
for f in query("Aquieous_Mineral_Distribution_Options_clon0"):
    lon, lat = f["geometry"]["coordinates"]
    key = (r3(lat), r3(lon), f["properties"]["Class"].strip().lower())
    if key not in seen:
        seen.add(key); out["aqueous"].append(list(key))

for f in query("Chloride_Salt_bearing_Material_THEMIS_clon0"):
    lat, lon, km2 = centroid(f["geometry"])
    out["chloride"].append([r3(lat), r3(lon), round(km2, 1)])

for f in query("RSLs_Gullies_New_IcyCraters_clon0"):
    p = f["properties"]
    lon, lat = f["geometry"]["coordinates"]
    out["active"].append([r3(lat), r3(lon), p["Type"], p.get("Observatio") or "", p.get("Ref") or ""])

OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print({k: len(v) for k, v in out.items() if isinstance(v, list)}, f"{OUT.stat().st_size / 1e3:.0f} KB")
