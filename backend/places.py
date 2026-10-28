"""Mars place names (IAU nomenclature): search by name and describe where a point is."""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

from terrain import bearing_deg, compass, haversine_m

FEATURES_FILE = Path(__file__).resolve().parent.parent / "data" / "mars_features.json"

FRIENDLY = {
    "Crater": "crater", "Mons": "mountain", "Montes": "mountains", "Vallis": "valley",
    "Valles": "valleys", "Planitia": "plain", "Planum": "plateau", "Terra": "highlands",
    "Chasma": "canyon", "Chaos": "chaotic terrain", "Fossa": "trough", "Dorsum": "ridge",
    "Mensa": "mesa", "Tholus": "hill", "Patera": "volcanic caldera", "Labyrinthus": "canyon maze",
    "Albedo Feature": "albedo region", "Collis": "hills", "Catena": "crater chain", "Rupes": "scarp",
    "Vastitas": "lowland", "Sulcus": "grooved terrain", "Cavus": "pit", "Lingula": "plateau lobe",
    "Scopulus": "escarpment", "Undae": "dune field", "Unda": "dunes", "Fluctus": "lava flow",
    "Palus": "plain", "Serpens": "sinuous ridge", "Tessera": "tiled terrain", "Mensae": "mesas",
}


@lru_cache(maxsize=1)
def features() -> list[dict]:
    raw = json.loads(FEATURES_FILE.read_text(encoding="utf-8"))["features"]
    return [{"name": n, "type": t, "kind": FRIENDLY.get(t, t.lower()), "lat": la, "lon": lo,
             "diameter_km": d} for n, t, la, lo, d in raw]


def search(q: str, limit: int = 8) -> list[dict]:
    q = q.strip().lower()
    if not q:
        return []
    scored = []
    for f in features():
        name = f["name"].lower()
        if name == q:
            rank = 0
        elif name.startswith(q):
            rank = 1
        elif any(w.startswith(q) for w in name.split()):
            rank = 2
        elif q in name:
            rank = 3
        else:
            continue
        scored.append((rank, -f["diameter_km"], f))
    scored.sort(key=lambda x: (x[0], x[1]))
    return [f for _, _, f in scored[:limit]]


def whereis(lat: float, lon: float) -> dict:
    """Plain-language description of a point: which named features contain it, and the nearest one."""
    inside, nearest, best = [], None, math.inf
    for f in features():
        if f["diameter_km"] <= 0:
            continue
        d_km = haversine_m((lat, lon), (f["lat"], f["lon"])) / 1000
        r_km = f["diameter_km"] / 2
        if d_km <= r_km:
            inside.append({**f, "dist_km": round(d_km, 1)})
        else:
            edge = d_km - r_km
            if edge < best:
                best, nearest = edge, {**f, "dist_km": round(d_km, 1), "edge_km": round(edge, 1),
                                       "direction": compass(bearing_deg((f["lat"], f["lon"]), (lat, lon)))}
    inside.sort(key=lambda f: f["diameter_km"])  # most specific first
    if inside:
        here = inside[0]
        summary = f"Inside {here['name']} ({here['kind']}, {here['diameter_km']:.0f} km across)"
        region = next((f for f in inside[1:] if f["diameter_km"] > 4 * here["diameter_km"]), None)
        if region:
            summary += f", in {region['name']}"
    elif nearest:
        summary = f"{nearest['edge_km']:.0f} km {nearest['direction']} of {nearest['name']} ({nearest['kind']})"
    else:
        summary = "Unnamed terrain"
    return {"summary": summary, "inside": inside[:3], "nearest": nearest}
