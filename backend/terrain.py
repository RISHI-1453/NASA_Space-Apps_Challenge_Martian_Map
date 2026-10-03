"""Mars terrain + route analysis.

Elevation comes from the sharpest source covering a point:
  1. Local high-resolution DTMs (e.g. Jezero CTX, 20 m/px) - see LOCAL_DEMS
  2. MGS MOLA MEGDR global grid, 16 px/deg (~3.7 km/px) - everywhere else

Coordinates: planetocentric latitude, EAST longitude in [-180, 180] (what the Leaflet map uses).
Heights are metres relative to the MOLA areoid (the local DTMs are tied to MOLA).
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np

MARS_RADIUS_M = 3_389_500
DATA = Path(__file__).resolve().parent.parent / "data"
MOLA_FILE = DATA / "mola_megdr_16ppd.img"
PPD = 16
LINES, SAMPLES = 180 * PPD, 360 * PPD

_dem: np.ndarray | None = None


def dem() -> np.ndarray:
    global _dem
    if _dem is None:
        if not MOLA_FILE.exists():
            raise FileNotFoundError("MOLA grid missing - run scripts/fetch_data.py")
        _dem = np.memmap(MOLA_FILE, dtype=">i2", mode="r", shape=(LINES, SAMPLES))
    return _dem


def mola_elevation(lat: float, lon: float) -> float:
    """Bilinear MOLA elevation (m) at a point."""
    d = dem()
    lon360 = lon % 360
    # pixel centres sit at half-pixel offsets; line 0 is 90N, sample 0 is 0E
    y = (90 - lat) * PPD - 0.5
    x = lon360 * PPD - 0.5
    y0 = int(np.clip(math.floor(y), 0, LINES - 2))
    x0 = int(math.floor(x)) % SAMPLES
    x1 = (x0 + 1) % SAMPLES
    fy, fx = np.clip(y - y0, 0, 1), x - math.floor(x)
    top = d[y0, x0] * (1 - fx) + d[y0, x1] * fx
    bot = d[y0 + 1, x0] * (1 - fx) + d[y0 + 1, x1] * fx
    return float(top * (1 - fy) + bot * fy)


class LocalDEM:
    """Equirectangular GeoTIFF DTM (Mars 2000 sphere, metres) - e.g. USGS Mars 2020 TRN products."""

    def __init__(self, name: str, path: Path, label: str):
        self.name, self.path, self.label = name, path, label
        self._a = None

    def _load(self):
        import logging
        import tifffile  # only needed when a local DEM is present
        logging.getLogger("tifffile").setLevel(logging.ERROR)  # benign GDAL_NODATA parse notice
        with tifffile.TiffFile(self.path) as t:
            page = t.pages[0]
            a = page.asarray().astype(np.float32)
            sx, sy, _ = page.tags["ModelPixelScaleTag"].value
            _, _, _, x0, y0, _ = page.tags["ModelTiepointTag"].value
            radius = t.geotiff_metadata["GeogSemiMajorAxisGeoKey"]
        a[a < -1e20] = np.nan
        self._a, self.res_m = a, sx
        self.x0, self.y0, self.sx, self.sy, self.radius = x0, y0, sx, sy, radius
        k = 180 / (math.pi * radius)
        h, w = a.shape
        self.bounds = (y0 - h * sy) * k, x0 * k, y0 * k, (x0 + w * sx) * k  # S, W, N, E

    def available(self) -> bool:
        if self._a is None and self.path.exists():
            self._load()
        return self._a is not None

    def sample(self, lat: float, lon: float) -> float | None:
        if not self.available():
            return None
        s, w, n, e = self.bounds
        if not (s <= lat <= n and w <= lon <= e):
            return None
        x = (math.radians(lon) * self.radius - self.x0) / self.sx - 0.5
        y = (self.y0 - math.radians(lat) * self.radius) / self.sy - 0.5
        h, wd = self._a.shape
        xi, yi = int(math.floor(x)), int(math.floor(y))
        if not (0 <= xi < wd - 1 and 0 <= yi < h - 1):
            return None
        fx, fy = x - xi, y - yi
        q = self._a[yi:yi + 2, xi:xi + 2]
        if np.isnan(q).any():
            return None
        v = (q[0, 0] * (1 - fx) + q[0, 1] * fx) * (1 - fy) + (q[1, 0] * (1 - fx) + q[1, 1] * fx) * fy
        return float(v)


LOCAL_DEMS = [
    LocalDEM("jezero_ctx", DATA / "jezero_ctx_dtm_20m.tif", "CTX Jezero DTM (20 m)"),
]
MOLA_LABEL = "MGS MOLA (3.7 km)"


def elevation_src(lat: float, lon: float) -> tuple[float, str]:
    """(elevation m, source label) from the sharpest DEM covering the point."""
    for d in LOCAL_DEMS:
        v = d.sample(lat, lon)
        if v is not None:
            return v, d.label
    return mola_elevation(lat, lon), MOLA_LABEL


def elevation(lat: float, lon: float) -> float:
    return elevation_src(lat, lon)[0]


def dem_coverage() -> list[dict]:
    out = [{"name": "mola", "label": MOLA_LABEL, "resolution_m": 3697, "bounds": [-90, -180, 90, 180]}]
    for d in LOCAL_DEMS:
        if d.available():
            out.append({"name": d.name, "label": d.label, "resolution_m": d.res_m, "bounds": list(d.bounds)})
    return out


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * MARS_RADIUS_M * math.asin(math.sqrt(h))


def _interp(a, b, t):
    """Point a fraction t along the great circle a->b."""
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    p1 = np.array([math.cos(la1) * math.cos(lo1), math.cos(la1) * math.sin(lo1), math.sin(la1)])
    p2 = np.array([math.cos(la2) * math.cos(lo2), math.cos(la2) * math.sin(lo2), math.sin(la2)])
    om = math.acos(float(np.clip(p1 @ p2, -1, 1)))
    if om < 1e-12:
        return a
    p = (math.sin((1 - t) * om) * p1 + math.sin(t * om) * p2) / math.sin(om)
    return math.degrees(math.asin(p[2])), math.degrees(math.atan2(p[1], p[0]))


# --- EVA model --------------------------------------------------------------------------
# Tobler's hiking function, slowed for a pressurised suit. Apollo EVA traverses averaged
# roughly 1-2 km/h on foot; we scale Tobler's ~5 km/h flat speed by SUIT_FACTOR to match.
SUIT_FACTOR = 0.35
O2_HOURS = 8.0          # typical PLSS consumable budget
RESERVE_FRACTION = 0.2  # keep 20 % in reserve for walk-back / contingencies
HAZARD_SLOPE_DEG = 15   # steeper than this is flagged as hazardous on foot


def walking_speed_kmh(slope: float) -> float:
    """slope = rise/run (signed)."""
    return 6 * math.exp(-3.5 * abs(slope + 0.05)) * SUIT_FACTOR


COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
COMPASS_WORDS = {"N": "north", "NE": "northeast", "E": "east", "SE": "southeast",
                 "S": "south", "SW": "southwest", "W": "west", "NW": "northwest"}


def bearing_deg(a, b) -> float:
    """Initial great-circle bearing a->b, degrees clockwise from north."""
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def compass(b: float) -> str:
    return COMPASS[int((b + 11.25) // 22.5) % 16]


def turn_instruction(prev_bearing: float | None, bearing: float) -> str:
    if prev_bearing is None:
        return "Head"
    d = (bearing - prev_bearing + 540) % 360 - 180  # -180..180, + = right
    a = abs(d)
    if a < 15:
        return "Continue straight"
    side = "right" if d > 0 else "left"
    if a < 45:
        return f"Bear {side}"
    if a < 120:
        return f"Turn {side}"
    if a < 165:
        return f"Sharp {side}"
    return "Turn around"


def slope_class(deg: float) -> str:
    if deg < 3:
        return "flat"
    if deg < 8:
        return "gentle"
    if deg < HAZARD_SLOPE_DEG:
        return "moderate"
    if deg < 25:
        return "steep"
    return "dangerous"


def describe_terrain(ascent: float, descent: float, dist_m: float, max_slope: float) -> str:
    net = ascent - descent
    grade = abs(net) / dist_m * 100 if dist_m else 0
    rolling = min(ascent, descent) > 0.3 * max(ascent, descent, 1) and max(ascent, descent) > 20
    if rolling:
        base = "Rolling terrain with ups and downs"
    elif grade < 0.5 and max(ascent, descent) < 15:
        base = "Mostly level ground"
    elif net > 0:
        base = "Hard climb" if grade >= 8 or max_slope >= 8 else "Steady climb"
    else:
        base = "Steep descent" if grade >= 8 or max_slope >= 8 else "Gradual descent"
    return f"{base} ({slope_class(max_slope)} slopes, max {max_slope:.0f}°)"


def profile(waypoints: list[tuple[float, float]], step_m: float = 250) -> dict:
    """Densified elevation profile + per-leg directions + traverse totals for (lat, lon) waypoints."""
    samples: list[dict] = []
    legs: list[dict] = []
    hazards: list[dict] = []
    dist = hours = 0.0
    prev_bearing = None

    sources: dict[str, int] = {}

    def add_sample(p, z, slope_deg, leg, src, t_h=0.0):
        sources[src] = sources.get(src, 0) + 1
        samples.append({"dist_m": round(dist, 1), "lat": round(p[0], 6), "lon": round(p[1], 6),
                        "elev_m": round(z, 1), "slope_deg": round(slope_deg, 2), "leg": leg, "src": src,
                        "t_h": round(t_h, 4)})  # cumulative walking hours to reach this point

    # keep the sample count sane on very long routes
    total = sum(haversine_m(a, b) for a, b in zip(waypoints, waypoints[1:]))
    step_m = max(step_m, total / 3000)

    first = tuple(waypoints[0])
    z0, src0 = elevation_src(*first)
    add_sample(first, z0, 0.0, 0, src0)

    for li, (a, b) in enumerate(zip(waypoints, waypoints[1:])):
        seg = haversine_m(a, b)
        n = max(1, int(seg // step_m))
        pts = [_interp(a, b, i / n) for i in range(1, n)] + [tuple(b)]
        leg_start_idx = len(samples) - 1
        leg_dist = leg_hours = asc = desc = leg_max = 0.0
        leg_hazards = 0
        prev_pt, prev_z = tuple(a), samples[-1]["elev_m"]
        for p in pts:
            z, src = elevation_src(*p)
            d = haversine_m(prev_pt, p)
            dz = z - prev_z
            slope_deg = math.degrees(math.atan(abs(dz) / d)) if d > 0 else 0.0
            if d > 0:
                leg_hours += (d / 1000) / walking_speed_kmh(dz / d)
            dist += d
            leg_dist += d
            asc += max(dz, 0)
            desc += max(-dz, 0)
            leg_max = max(leg_max, slope_deg)
            if slope_deg > HAZARD_SLOPE_DEG:
                leg_hazards += 1
                hazards.append({"dist_m": round(dist), "lat": p[0], "lon": p[1],
                                "slope_deg": round(slope_deg, 1), "leg": li})
            add_sample(p, z, slope_deg, li, src, hours + leg_hours)
            prev_pt, prev_z = p, z
        hours += leg_hours

        brg = bearing_deg(a, b)
        legs.append({
            "index": li,
            "from_idx": leg_start_idx, "to_idx": len(samples) - 1,
            "instruction": turn_instruction(prev_bearing, brg),
            "bearing_deg": round(brg), "compass": compass(brg),
            "distance_km": round(leg_dist / 1000, 3),
            "ascent_m": round(asc), "descent_m": round(desc),
            "start_elev_m": round(samples[leg_start_idx]["elev_m"]),
            "end_elev_m": round(samples[-1]["elev_m"]),
            "max_slope_deg": round(leg_max, 1), "slope_class": slope_class(leg_max),
            "terrain": describe_terrain(asc, desc, leg_dist, leg_max),
            "hazard_points": leg_hazards,
            "walk_hours": round(leg_hours, 3),
            "cum_hours": round(hours, 3), "cum_km": round(dist / 1000, 3),
        })
        prev_bearing = brg

    usable = O2_HOURS * (1 - RESERVE_FRACTION)
    ascent = sum(l["ascent_m"] for l in legs)
    descent = sum(l["descent_m"] for l in legs)
    return {
        "samples": samples,
        "legs": legs,
        "stats": {
            "distance_km": round(dist / 1000, 3),
            "ascent_m": ascent, "descent_m": descent,
            "min_elev_m": round(min(s["elev_m"] for s in samples)),
            "max_elev_m": round(max(s["elev_m"] for s in samples)),
            "max_slope_deg": round(max(l["max_slope_deg"] for l in legs), 1),
            "walk_hours": round(hours, 2),
            "o2_budget_hours": O2_HOURS, "o2_usable_hours": usable,
            "fits_single_eva": hours <= usable,
            "dem_resolution_m": round(2 * math.pi * MARS_RADIUS_M / (360 * PPD)),
            "step_m": round(step_m),
            "dem_sources": {k: round(100 * v / len(samples)) for k, v in sources.items()},
        },
        "hazards": hazards,
        "model": f"Tobler hiking fn x {SUIT_FACTOR} suit factor; hazard > {HAZARD_SLOPE_DEG} deg; "
                 f"{int(RESERVE_FRACTION * 100)}% O2 reserve",
    }
