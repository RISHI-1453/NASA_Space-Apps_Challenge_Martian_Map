"""Ground-level imagery from NASA's rovers: the nearest rover stop to a point, and the photos
taken there. Perseverance (Mars 2020) photos carry the mast azimuth/elevation each frame was
taken at, so the viewer can lay them out as a look-around panorama.

Sources (public, NASA/JPL-Caltech):
  - Rover stops: MMGIS waypoint layers  mars.nasa.gov/mmgis-maps/{M20,MSL}/Layers/json/*_waypoints.json
  - Photos:      raw-image APIs          mars.nasa.gov/rss/api (Mars 2020), mars.nasa.gov/api/v1/raw_image_items (MSL)
Everything is cached on disk so repeat views are instant.
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import httpx

from terrain import haversine_m

CACHE = Path(__file__).resolve().parent.parent / "data" / "rover"
MISSIONS = {
    "m2020": {"name": "Perseverance", "waypoints": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"},
    "msl": {"name": "Curiosity", "waypoints": "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"},
}
NAVCAM_HFOV = 96.0  # Mars 2020 Navcam, full frame (deg)
_client = httpx.Client(timeout=40, follow_redirects=True, headers={"User-Agent": "MartianMap/1.0 (NASA Space Apps)"})
_waypoints: dict[str, list[dict]] = {}


def _get_json(url: str, params: dict | None = None, tries: int = 3):
    last = None
    for i in range(tries):
        try:
            r = _client.get(url, params=params)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # NASA's servers occasionally reset connections; retry briefly
            last = e
            time.sleep(0.8 * (i + 1))
    raise last


def waypoints(mission: str) -> list[dict]:
    if mission in _waypoints:
        return _waypoints[mission]
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{mission}_waypoints.json"
    if not f.exists() or time.time() - f.stat().st_mtime > 86400:  # refresh daily
        try:
            f.write_text(json.dumps(_get_json(MISSIONS[mission]["waypoints"])), encoding="utf-8")
        except Exception:
            if not f.exists():
                raise
    feats = json.loads(f.read_text(encoding="utf-8"))["features"]
    _waypoints[mission] = [
        {k: p.get(k) for k in ("sol", "site", "drive", "lat", "lon", "yaw", "dist_total_m")}
        for p in (x["properties"] for x in feats) if p.get("lat") is not None
    ]
    return _waypoints[mission]


def nearest(lat: float, lon: float, max_km: float = 3.0) -> dict | None:
    best = None
    for mission in MISSIONS:
        try:
            wps = waypoints(mission)
        except Exception:
            continue
        for w in wps:
            if abs(w["lat"] - lat) > 0.2 or abs(((w["lon"] - lon + 180) % 360) - 180) > 0.2:
                continue  # cheap prefilter (~12 km)
            d = haversine_m((lat, lon), (w["lat"], w["lon"]))
            if best is None or d < best["dist_m"]:
                best = {**w, "mission": mission, "rover": MISSIONS[mission]["name"], "dist_m": round(d)}
    if best and best["dist_m"] <= max_km * 1000:
        return best
    return None


def _m2020_photos(sol: int) -> list[dict]:
    d = _get_json("https://mars.nasa.gov/rss/api/", {
        "feed": "raw_images", "category": "mars2020", "feedtype": "json", "num": 100, "page": 0,
        "order": "sol desc", "search": "NAVCAM_LEFT", "condition_2": f"{sol}:sol:gte", "condition_3": f"{sol}:sol:lte",
    })
    out = []
    for im in d.get("images", []):
        ex = im.get("extended") or {}
        try:
            az, el = float(ex.get("mastAz")), float(ex.get("mastEl"))
        except (TypeError, ValueError):
            az = el = None
        try:
            w, h = (int(v) for v in ex.get("dimension", "(0,0)").strip("()").split(","))
        except ValueError:
            w = h = 0
        f = im.get("image_files") or {}
        out.append({
            "small": f.get("small"), "medium": f.get("medium"), "large": f.get("large") or f.get("medium"),
            "az": az, "el": el, "w": w, "h": h, "site": im.get("site"), "drive": im.get("drive"),
            "camera": (im.get("camera") or {}).get("instrument"), "time": im.get("date_taken_utc"),
        })
    return out


def _msl_photos(sol: int) -> list[dict]:
    d = _get_json("https://mars.nasa.gov/api/v1/raw_image_items/", {
        "order": "sol desc", "per_page": 100, "page": 0,
        "condition_1": "msl:mission", "condition_2": f"{sol}:sol:gte", "condition_3": f"{sol}:sol:lte",
    })
    out = []
    for im in d.get("items", []):
        inst = im.get("instrument") or ""
        if not inst.startswith(("NAV_LEFT", "MAST_LEFT")):
            continue
        ex = im.get("extended") or {}
        az, el = ex.get("mast_az"), ex.get("mast_el")
        out.append({"small": im.get("url"), "medium": im.get("url"), "large": im.get("url"),
                    "az": float(az) if az not in (None, "UNK") else None, "el": float(el) if el not in (None, "UNK") else None,
                    "w": 0, "h": 0, "site": im.get("site"), "drive": im.get("drive"), "camera": inst, "time": im.get("date_taken")})
    return out


def photos(mission: str, sol: int, site: int | None = None, drive: int | None = None) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"photos_{mission}_{sol}.json"
    if f.exists():
        all_ = json.loads(f.read_text(encoding="utf-8"))
    else:
        all_ = _m2020_photos(sol) if mission == "m2020" else _msl_photos(sol)
        f.write_text(json.dumps(all_), encoding="utf-8")
    # prefer frames taken at this exact stop (site/drive); fall back to the whole sol
    def num(v):
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
    here = [p for p in all_ if site is not None and num(p.get("site")) == site and num(p.get("drive")) == drive]
    chosen = here if len(here) >= 3 else all_
    return {"mission": mission, "rover": MISSIONS[mission]["name"], "sol": sol, "exact_stop": chosen is here,
            "hfov": NAVCAM_HFOV, "photos": chosen}
