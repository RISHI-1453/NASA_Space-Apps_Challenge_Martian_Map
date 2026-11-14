"""Science layers: where orbiters found minerals that formed in water, salt deposits, exposed ice and
slopes that are still active (data/science_features.json, built from NASA Mars Trek by
scripts/build_science_layers.py), and the USGS global geologic map unit under any point.

  hydrous   CRISM (MRO) + OMEGA (Mars Express) hydrous-mineral detections    Carter et al. 2013
  aqueous   water-formed minerals by class                                    Ehlmann & Edwards 2014
  chloride  chloride-salt deposits mapped with THEMIS (Mars Odyssey)          Osterloo et al. 2010
  active    HiRISE (MRO): new craters, ice-exposing craters, RSL, active gullies
  geology   USGS SIM 3292 global geologic map (Tanaka et al. 2014), queried live from Mars Trek; inside
            Jezero and Nili Planum, the 1:75,000 USGS SIM 3464 map (Sun & Stack 2020) instead
            (data/jezero_geology.json, built by scripts/build_jezero_geology.py)
"""
from __future__ import annotations

import json
import math
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import numpy as np

DATA = Path(__file__).resolve().parent.parent / "data" / "science_features.json"
R_KM = 3389.5
GEOLOGY = "https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/0/query"

# what each kind of detection means for a crew on foot
AQUEOUS = {
    "phyllosilicate": ("Clay minerals", "formed by long contact with mild, neutral water — the best minerals for preserving organic matter"),
    "silica": ("Opaline silica", "left by hot springs or groundwater; on Earth such deposits keep microbial fossils"),
    "sulfate": ("Sulfate salts", "left behind as acidic, salty water evaporated"),
    "chloride": ("Chloride salts", "the salt flats of evaporating ponds and lakes"),
    "carbonate": ("Carbonates", "formed in neutral-to-alkaline water; they can record the ancient atmosphere"),
}
ACTIVE = {
    "icy impact site": ("Ice exposed by a fresh crater", "ice", "clean water ice dug up by a recent impact — a water resource within reach of a drill"),
    "new crater": ("Fresh impact crater", "fresh", "formed in the last few decades; fresh rock and ejecta, but loose blocks around the rim"),
    "confirmed recurring slope lineae (RSL)": ("Recurring slope lineae (RSL)", "keepout", "dark streaks that grow each warm season: a candidate Special Region — planetary protection says keep crews and kit off it"),
    "partially confirmed recurring slope lineae (RSL)": ("Possible recurring slope lineae", "keepout", "may be a Special Region — treat as off limits until checked"),
    "active gully": ("Active gully", "unstable", "slopes still moving today (seasonal CO₂ frost) — unstable ground"),
    "dune or sandy gully": ("Sandy gully on a dune", "unstable", "loose sand still sliding today"),
}

_lock = threading.Lock()
_items: list[dict] | None = None
_xyz: np.ndarray | None = None
_raw: dict | None = None


def _unit(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=-1)


def _load():
    global _items, _xyz, _raw
    with _lock:
        if _items is not None:
            return
        raw = json.loads(DATA.read_text(encoding="utf-8"))
        items = []
        for lat, lon, inst in raw["hydrous"]:
            items.append({"kind": "hydrous", "lat": lat, "lon": lon, "name": f"Hydrated minerals ({inst})",
                          "what": f"{inst} spectra show water-bearing minerals: rock altered by liquid water", "group": "mineral"})
        for lat, lon, cls in raw["aqueous"]:
            name, what = AQUEOUS.get(cls, (cls.title(), "a mineral that formed in water"))
            items.append({"kind": "aqueous", "lat": lat, "lon": lon, "name": name, "what": what, "group": "mineral", "class": cls})
        for lat, lon, km2 in raw["chloride"]:
            items.append({"kind": "chloride", "lat": lat, "lon": lon, "name": "Chloride salt deposit",
                          "what": f"about {km2:.0f} km² of salt left by evaporating water (THEMIS)" if km2 >= 1 else "salt left by evaporating water (THEMIS)",
                          "group": "mineral", "km2": km2})
        for lat, lon, typ, obs, ref in raw["active"]:
            name, group, what = ACTIVE.get(typ, (typ.capitalize(), "fresh", typ))
            items.append({"kind": "active", "lat": lat, "lon": lon, "name": name, "what": what, "group": group,
                          "image": obs, "ref": ref})
        _xyz = _unit(np.array([i["lat"] for i in items]), np.array([i["lon"] for i in items]))
        _items, _raw = items, raw


def features() -> dict:
    """Everything, compact, for the map layers."""
    _load()
    return _raw


def near(lat: float, lon: float, km: float = 25, limit: int = 12) -> list[dict]:
    """Detections within km of a point, nearest first."""
    _load()
    d = np.arccos(np.clip(_xyz @ _unit(lat, lon), -1, 1)) * R_KM
    idx = np.argsort(d)
    out = []
    for i in idx[:limit * 4]:
        if d[i] > km or len(out) >= limit:
            break
        out.append({**_items[i], "km": round(float(d[i]), 2)})
    return out


def along(points: list[tuple[float, float]], km: float = 3, limit: int = 20) -> list[dict]:
    """Detections within km of a route, each with the route point it's closest to, in route order."""
    _load()
    if not points:
        return []
    step = max(1, len(points) // 400)
    sub = points[::step] + [points[-1]]
    P = _unit(np.array([p[0] for p in sub]), np.array([p[1] for p in sub]))
    D = np.arccos(np.clip(_xyz @ P.T, -1, 1)) * R_KM          # features x route points
    j = D.argmin(axis=1)
    dmin = D[np.arange(len(j)), j]
    hits = np.flatnonzero(dmin <= km)
    out, seen = [], set()
    for i in hits[np.argsort(dmin[hits])]:
        it = _items[i]
        key = (it["name"], round(it["lat"], 2), round(it["lon"], 2))
        if key in seen:
            continue
        seen.add(key)
        out.append({**it, "km": round(float(dmin[i]), 2), "route_idx": int(min(j[i] * step, len(points) - 1))})
        if len(out) >= limit:
            break
    return sorted(out, key=lambda x: x["route_idx"])


# --- USGS geologic map (SIM 3292) ---------------------------------------------------------------
PERIODS = {"N": "Noachian", "H": "Hesperian", "A": "Amazonian"}
AGES = {"Noachian": "more than 3.7 billion years old", "Hesperian": "about 3.7–3.0 billion years old",
        "Amazonian": "younger than about 3 billion years"}
EPOCH = {"e": "Early", "m": "Middle", "l": "Late"}
_geo_cache: dict[tuple[float, float], dict | None] = {}
_client = httpx.Client(timeout=httpx.Timeout(12, connect=5), headers={"User-Agent": "MartianMap/1.0 (NASA Space Apps)"})


def _age(unit: str) -> str:
    m = re.match(r"^([eml]?)([NHA]+)", unit)
    if not m:
        return ""
    epoch, periods = EPOCH.get(m.group(1), ""), [PERIODS[c] for c in m.group(2)]
    if len(periods) == 1:
        return f"{epoch} {periods[0]}".strip()
    return f"{periods[-1]} to {periods[0]}"  # e.g. "AH" = Amazonian and Hesperian: oldest last


# --- USGS 1:75,000 geologic map of Jezero crater and Nili Planum (SIM 3464) ---------------------
JEZERO = Path(__file__).resolve().parent.parent / "data" / "jezero_geology.json"
_jez: dict | None = None


def _load_jezero() -> dict:
    """The map's unit polygons with their bounding boxes, for point lookups."""
    global _jez
    with _lock:
        if _jez is None:
            d = json.loads(JEZERO.read_text(encoding="utf-8")) if JEZERO.exists() else {"units": {}, "shapes": []}
            rings = [[np.asarray(r, dtype=np.float64) for r in rs] for _, rs in d["shapes"]]
            box = np.array([[min(r[:, 0].min() for r in rs), min(r[:, 1].min() for r in rs),
                             max(r[:, 0].max() for r in rs), max(r[:, 1].max() for r in rs)] for rs in rings]) if rings else np.zeros((0, 4))
            _jez = {"raw": d, "units": d["units"], "codes": [c for c, _ in d["shapes"]], "rings": rings, "box": box}
        return _jez


def jezero_geology() -> dict:
    """The whole map, compact, for the map layer."""
    return _load_jezero()["raw"]


def _inside(rings: list[np.ndarray], x: float, y: float) -> bool:
    """Even-odd test over all of a polygon's rings, so holes and multi-part units both work."""
    hit = False
    for r in rings:
        x0, y0, x1, y1 = r[:-1, 0], r[:-1, 1], r[1:, 0], r[1:, 1]
        cross = (y0 > y) != (y1 > y)
        xs = x0 + (y - y0) * (x1 - x0) / np.where(y1 == y0, 1e-12, y1 - y0)
        hit ^= bool(np.count_nonzero(cross & (x < xs)) % 2)
    return hit


SIM3464_AGES = {"N": ("Noachian", "more than 3.7 billion years old"),
                "NH": ("Late Noachian to Early Hesperian", "about 3.7 billion years old"),
                "H": ("Hesperian", "about 3.7–3.0 billion years old"),
                "A": ("Amazonian", "younger than about 3 billion years")}


def jezero_unit(lat: float, lon: float) -> dict | None:
    """The SIM 3464 unit at a point, or None outside the map."""
    j = _load_jezero()
    b = j["box"]
    if not len(b):
        return None
    for i in np.flatnonzero((b[:, 0] <= lon) & (lon <= b[:, 2]) & (b[:, 1] <= lat) & (lat <= b[:, 3])):
        if _inside(j["rings"][i], lon, lat):
            u = j["units"][j["codes"][i]]
            m = re.match(r"^([NHA]+)", u["symbol"])  # the age letters lead the symbol, oldest first; crater units have none
            age, text = SIM3464_AGES.get(m.group(1) if m else "", ("", "age not assigned on the map"))
            return {"unit": u["symbol"], "name": u["name"], "age": age, "age_text": text,
                    "interpretation": u["interpretation"], "notes": u["notes"], "ref": "sun2020", "scale": "1:75,000"}
    return None


def geology(lat: float, lon: float) -> dict | None:
    """The geologic unit at a point: code, description and age (the detailed Jezero map where it exists)."""
    local = jezero_unit(lat, lon)
    if local:
        return local
    key = (round(lat, 2), round(lon, 2))  # ~600 m: far finer than the map's 1:20M scale
    if key in _geo_cache:
        return _geo_cache[key]
    r = _client.get(GEOLOGY, params={"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": "104905",
                                     "spatialRel": "esriSpatialRelIntersects", "outFields": "Unit,UnitDesc",
                                     "returnGeometry": "false", "f": "json"})
    r.raise_for_status()
    feats = r.json().get("features") or []
    out = None
    if feats:
        a = feats[0]["attributes"]
        age = _age(a["Unit"])
        if " to " in age:  # a unit spanning a period boundary
            older, younger = age.split(" to ")
            text = f"formed around the {older}–{younger} boundary, " + ("about 3.7 billion years ago" if older == "Noachian" else "about 3 billion years ago")
        else:
            text = AGES.get(next((p for p in AGES if age.endswith(p)), ""), "")
        out = {"unit": a["Unit"], "name": a["UnitDesc"], "age": age, "age_text": text, "ref": "tanaka2014", "scale": "1:20,000,000"}
    _geo_cache[key] = out
    return out


def geology_along(points: list[tuple[float, float]], n: int = 10) -> list[dict]:
    """Geologic units a route crosses, in order, with the route index where each starts."""
    if not points:
        return []
    if any(jezero_unit(*points[i]) for i in (0, len(points) - 1)):
        n = max(n, 60)  # the detailed Jezero map is a local lookup, and its units are small: sample densely
    idx = sorted({round(i * (len(points) - 1) / max(1, n - 1)) for i in range(n)})
    with ThreadPoolExecutor(6) as ex:
        units = list(ex.map(lambda i: _safe_geology(*points[i]), idx))
    out = []
    for i, u in zip(idx, units):
        if u and (not out or out[-1]["unit"] != u["unit"]):
            out.append({**u, "route_idx": i})
    return out


def _safe_geology(lat, lon):
    try:
        return geology(lat, lon)
    except Exception:
        return None
