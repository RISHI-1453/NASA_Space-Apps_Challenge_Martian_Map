"""Ground-level imagery from NASA's rovers: the nearest rover stop to a point, and the photos
taken there. Perseverance (Mars 2020) photos carry the mast azimuth/elevation each frame was
taken at, so the viewer can lay them out as a look-around panorama.

Sources (public, NASA/JPL-Caltech):
  - Rover stops: MMGIS waypoint layers  mars.nasa.gov/mmgis-maps/{M20,MSL}/Layers/json/*_waypoints.json
  - Photos:      raw-image APIs          mars.nasa.gov/rss/api (Mars 2020), mars.nasa.gov/api/v1/raw_image_items (MSL):
                 Navcam (look-around), Mastcam-Z / Mastcam (colour), WATSON / MAHLI (close-ups from the arm)
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
NAVCAM_HFOV = {"m2020": 96.0, "msl": 45.0}  # Navcam full-frame field of view (deg)
# what each view asks NASA's raw-image service for: the look-around (Navcam, black and white, with
# pointing), the colour mast camera, and the arm's close-up camera
CAMERAS = {
    "m2020": {"nav": "NAVCAM_LEFT", "colour": "MCZ_LEFT", "closeup": "SHERLOC_WATSON"},
    "msl": {"nav": "NAV_LEFT_B", "colour": "MAST_LEFT", "closeup": "MAHLI"},
}
STAY_MAX_SOLS = 25  # a stop's photos: from the sol the rover arrived until it drove on (at most this long)
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
        for i, w in enumerate(wps):
            if abs(w["lat"] - lat) > 0.2 or abs(((w["lon"] - lon + 180) % 360) - 180) > 0.2:
                continue  # cheap prefilter (~12 km)
            d = haversine_m((lat, lon), (w["lat"], w["lon"]))
            if best is None or d < best["dist_m"]:
                # the stay: until the rover drove on, counting short bumps within a workspace (< 50 m) as staying
                k = i + 1
                while k < len(wps) and haversine_m((w["lat"], w["lon"]), (wps[k]["lat"], wps[k]["lon"])) < 50:
                    k += 1
                left = wps[k]["sol"] if k < len(wps) and wps[k].get("sol") is not None else w["sol"] + STAY_MAX_SOLS
                best = {**w, "mission": mission, "rover": MISSIONS[mission]["name"], "dist_m": round(d),
                        "sol_end": max(w["sol"], min(left, w["sol"] + STAY_MAX_SOLS))}
    if best and best["dist_m"] <= max_km * 1000:
        return best
    return None


def _m2020_photos(sol: int, sol_end: int, camera: str) -> list[dict]:
    d = _get_json("https://mars.nasa.gov/rss/api/", {
        "feed": "raw_images", "category": "mars2020", "feedtype": "json", "num": 100, "page": 0,
        "order": "sol desc", "search": camera, "condition_2": f"{sol}:sol:gte", "condition_3": f"{sol_end}:sol:lte",
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
            "camera": (im.get("camera") or {}).get("instrument"), "time": im.get("date_taken_utc"), "sol": im.get("sol"),
        })
    return out


def _msl_photos(sol: int, sol_end: int, camera: str) -> list[dict]:
    d = _get_json("https://mars.nasa.gov/api/v1/raw_image_items/", {
        "order": "sol desc", "per_page": 100, "page": 0, "search": camera,
        "condition_1": "msl:mission", "condition_2": f"{sol}:sol:gte", "condition_3": f"{sol_end}:sol:lte",
    })
    out = []
    for im in d.get("items", []):
        ex = im.get("extended") or {}
        az, el = ex.get("mast_az"), ex.get("mast_el")
        out.append({"small": im.get("url"), "medium": im.get("url"), "large": im.get("url"),
                    "az": float(az) if az not in (None, "UNK") else None, "el": float(el) if el not in (None, "UNK") else None,
                    "w": 0, "h": 0, "site": im.get("site"), "drive": im.get("drive"), "camera": im.get("instrument"),
                    "time": im.get("date_taken"), "sol": im.get("sol")})
    return out


def photos(mission: str, sol: int, site: int | None = None, drive: int | None = None, kind: str = "nav",
           sol_end: int | None = None) -> dict:
    """Photos from a rover stop. The look-around (kind "nav") uses the sol the rover arrived; colour and
    close-ups search every sol it stayed (sol..sol_end), since arm work at a stop takes several sols."""
    CACHE.mkdir(parents=True, exist_ok=True)
    end = sol if kind == "nav" or sol_end is None else max(sol, min(sol_end, sol + STAY_MAX_SOLS))
    f = CACHE / f"photos_{mission}_{kind}_{sol}_{end}.json"
    if f.exists():
        all_ = json.loads(f.read_text(encoding="utf-8"))
    else:
        fetch = _m2020_photos if mission == "m2020" else _msl_photos
        all_ = fetch(sol, end, CAMERAS[mission][kind])
        f.write_text(json.dumps(all_), encoding="utf-8")
    # prefer frames taken at this exact stop (site/drive); fall back to the whole sol
    def num(v):
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
    here = [p for p in all_ if site is not None and num(p.get("site")) == site and num(p.get("drive")) == drive]
    chosen = here if len(here) >= 3 else all_
    return {"mission": mission, "rover": MISSIONS[mission]["name"], "sol": sol, "sol_end": end, "kind": kind,
            "exact_stop": chosen is here, "hfov": NAVCAM_HFOV[mission], "photos": chosen}
