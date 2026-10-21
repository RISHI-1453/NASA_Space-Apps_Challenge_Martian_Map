"""USGS Mars HRSC/MOLA Blended DEM v2, global, 200 m/px (Fergason et al. 2018), streamed as tiles.

Esri hosts the same USGS product as a tiled elevation service: 513x513 float32 LERC tiles on a
geographic grid (level 0 = two 180° tiles, origin 180°W 90°N, samples on the tile edges, so
neighbours share their border). We read level 7 — 1.40625° (~83 km) per tile at 163 m spacing —
so one ~250 KB request covers a whole neighbourhood, instead of one HTTP range request per DEM
row from the uncompressed 11 GB USGS GeoTIFF. Spot checks against the USGS file agree to ~1 m.

Tiles are kept on disk (data/esri_dem/) and in a small in-memory LRU, so every area downloads once.
Heights are metres relative to the MOLA areoid.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import lerc
import numpy as np

URL = "https://astro.arcgis.com/arcgis/rest/services/OnMars/MDEM200M/ImageServer/tile/{z}/{row}/{col}"
LABEL = "HRSC/MOLA blend (200 m)"
RES_M = 200
LEVEL = 7                      # 163 m sample spacing — the native 200 m data
N = 512                        # sample intervals per tile (513 samples)
SPAN = 180 / 2 ** LEVEL        # degrees per tile
ROWS, COLS = 2 ** LEVEL, 2 ** (LEVEL + 1)
MAX_TILES = 64                 # ~67 MB of float32
MAX_PREFETCH = 16              # tiles fetched up front for one route / area
RETRY_AFTER_S = 60             # after a network failure, use MOLA for a minute before retrying
CACHE = Path(__file__).resolve().parent.parent / "data" / "esri_dem"

_client = httpx.Client(timeout=30, headers={"User-Agent": "MartianMap/1.0 (NASA Space Apps)"})
_pool = ThreadPoolExecutor(max_workers=8)
_mem: OrderedDict[tuple[int, int], np.ndarray] = OrderedDict()
_lock = threading.Lock()
_key_locks: dict[tuple[int, int], threading.Lock] = {}
_down_until = 0.0


def _read(row: int, col: int, fetch: bool) -> np.ndarray | None:
    global _down_until
    path = CACHE / f"{LEVEL}_{row}_{col}.lerc"
    if path.exists():
        blob = path.read_bytes()
    elif fetch and time.time() >= _down_until:
        try:
            r = _client.get(URL.format(z=LEVEL, row=row, col=col))
            r.raise_for_status()
            blob = r.content
        except Exception:
            _down_until = time.time() + RETRY_AFTER_S
            return None
        CACHE.mkdir(parents=True, exist_ok=True)
        path.with_suffix(".part").write_bytes(blob)
        path.with_suffix(".part").replace(path)
    else:
        return None
    err, arr = lerc.decode(blob)[:2]
    return None if err else np.asarray(arr, dtype=np.float32)


def tile(row: int, col: int, fetch: bool = True) -> np.ndarray | None:
    """The 513x513 level-7 tile at (row, col), or None if unavailable (or not cached and fetch=False)."""
    key = (row, col)
    with _lock:
        if key in _mem:
            _mem.move_to_end(key)
            return _mem[key]
        klock = _key_locks.setdefault(key, threading.Lock())
    with klock:  # concurrent requests for the same tile wait for one download
        with _lock:
            if key in _mem:
                return _mem[key]
        arr = _read(row, col, fetch)
        if arr is not None:
            with _lock:
                _mem[key] = arr
                while len(_mem) > MAX_TILES:
                    _mem.popitem(last=False)
        return arr


def _rc(lat: float, lon: float) -> tuple[int, int]:
    row = min(ROWS - 1, max(0, int((90 - lat) // SPAN)))
    col = min(COLS - 1, max(0, int((lon + 180) // SPAN)))
    return row, col


def _bilinear(a: np.ndarray, fy: np.ndarray, fx: np.ndarray) -> np.ndarray:
    fy, fx = np.clip(fy, 0, N), np.clip(fx, 0, N)
    y0, x0 = np.minimum(fy.astype(int), N - 1), np.minimum(fx.astype(int), N - 1)
    v, u = fy - y0, fx - x0
    return ((a[y0, x0] * (1 - u) + a[y0, x0 + 1] * u) * (1 - v) +
            (a[y0 + 1, x0] * (1 - u) + a[y0 + 1, x0 + 1] * u) * v)


def sample(lat: float, lon: float, fetch: bool = True) -> float | None:
    """Bilinear elevation (m), or None if unavailable (or not cached and fetch=False)."""
    row, col = _rc(lat, lon)
    a = tile(row, col, fetch)
    if a is None:
        return None
    fy = np.array([(90 - row * SPAN - lat) / SPAN * N])
    fx = np.array([(lon - (-180 + col * SPAN)) / SPAN * N])
    return float(_bilinear(a, fy, fx)[0])


def tile_grid(z: int, x: int, y: int, n: int) -> np.ndarray | None:
    """n x n heights spanning geographic tile (z, x, y) edge to edge (row 0 = north), z >= LEVEL."""
    k = z - LEVEL
    row, col = y >> k, x >> k
    a = tile(row, col)
    if a is None:
        return None
    sub = N / 2 ** k  # samples per sub-tile
    t = np.arange(n) * (sub / (n - 1))
    fy, fx = np.meshgrid((y - (row << k)) * sub + t, (x - (col << k)) * sub + t, indexing="ij")
    return _bilinear(a, fy, fx)


def prefetch(s: float, w: float, n: float, e: float) -> bool:
    """Download (in parallel) the tiles covering an area, if it's not too big."""
    r0, c0 = _rc(n, w)
    r1, c1 = _rc(s, e)
    keys = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    if len(keys) > MAX_PREFETCH:
        return False
    return all(a is not None for a in _pool.map(lambda rc: tile(*rc), keys))
