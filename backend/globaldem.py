"""USGS Mars HRSC/MOLA Blended DEM, global, 200 m/px (Fergason et al. 2018), read straight from
the public copy with HTTP range requests — the file is 11 GB, we fetch only the pixels we need.

The GeoTIFF is uncompressed int16, one row per strip, stored contiguously, so the byte offset of
any pixel is DATA0 + (row * W + col) * 2. Rows are fetched in parallel in 256-px chunks and kept
in a small in-memory LRU cache. Heights are metres relative to the MOLA areoid.
"""
from __future__ import annotations

import math
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import httpx
import numpy as np

URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
LABEL = "HRSC/MOLA blend (200 m)"
DATA0 = 854272                 # byte offset of pixel (0, 0)
W, H = 106694, 53347           # pixels
RES = 0.003374120830641        # degrees per pixel (pixel-is-area, origin 180°W 90°N)
RES_M = 200
NODATA = -32768
CHUNK = 256                    # columns per cached chunk
MAX_CHUNKS = 80_000            # ~40 MB of int16
MAX_ROWS = 1600                # refuse windows taller than this (~320 km)

_client = httpx.Client(timeout=20, limits=httpx.Limits(max_connections=32, max_keepalive_connections=32))
_pool = ThreadPoolExecutor(max_workers=24)
_cache: OrderedDict[tuple[int, int], np.ndarray] = OrderedDict()
_lock = threading.Lock()
_failures = 0


def _store(row: int, k: int, arr: np.ndarray) -> None:
    with _lock:
        _cache[(row, k)] = arr
        _cache.move_to_end((row, k))
        while len(_cache) > MAX_CHUNKS:
            _cache.popitem(last=False)


def _fetch(row: int, k0: int, k1: int) -> None:
    c0, c1 = k0 * CHUNK, min(W, (k1 + 1) * CHUNK)
    a = DATA0 + (row * W + c0) * 2
    r = _client.get(URL, headers={"Range": f"bytes={a}-{a + (c1 - c0) * 2 - 1}"})
    r.raise_for_status()
    vals = np.frombuffer(r.content, dtype="<i2")
    for k in range(k0, k1 + 1):
        _store(row, k, vals[(k - k0) * CHUNK:(k - k0 + 1) * CHUNK].copy())


def ensure(r0: int, r1: int, c0: int, c1: int) -> bool:
    """Make sure pixels rows r0..r1, cols c0..c1 are cached. False if unavailable."""
    global _failures
    if _failures >= 3:
        return False
    r0, r1 = max(0, r0), min(H - 1, r1)
    c0, c1 = max(0, c0), min(W - 1, c1)
    if r1 - r0 + 1 > MAX_ROWS:
        return False
    k0, k1 = c0 // CHUNK, c1 // CHUNK
    jobs = []
    with _lock:
        for row in range(r0, r1 + 1):
            missing = [k for k in range(k0, k1 + 1) if (row, k) not in _cache]
            if missing:
                jobs.append((row, missing[0], missing[-1]))
            else:
                for k in range(k0, k1 + 1):
                    _cache.move_to_end((row, k))
    try:
        for f in [_pool.submit(_fetch, *j) for j in jobs]:
            f.result()
        _failures = 0
        return True
    except Exception:
        _failures += 1
        return False


def prefetch(s: float, w: float, n: float, e: float) -> bool:
    r0, r1 = int((90 - n) / RES) - 1, int((90 - s) / RES) + 2
    c0, c1 = int((w + 180) / RES) - 1, int((e + 180) / RES) + 2
    return ensure(r0, r1, c0, c1)


def _px(row: int, col: int) -> float | None:
    a = _cache.get((row, col // CHUNK))
    if a is None:
        return None
    v = int(a[col % CHUNK])
    return None if v == NODATA else float(v)


def sample(lat: float, lon: float, fetch: bool = True) -> float | None:
    """Bilinear elevation (m), or None if unavailable / no data / not cached (fetch=False)."""
    y = (90 - lat) / RES - 0.5
    x = (lon + 180) / RES - 0.5
    r, c = int(math.floor(y)), int(math.floor(x))
    if not (0 <= r < H - 1 and 0 <= c < W - 1):
        return None
    if (r, c // CHUNK) not in _cache or (r + 1, (c + 1) // CHUNK) not in _cache:
        if not fetch or not ensure(r, r + 1, c, c + 1):
            return None
    q = [_px(r, c), _px(r, c + 1), _px(r + 1, c), _px(r + 1, c + 1)]
    if any(v is None for v in q):
        return None
    fy, fx = y - r, x - c
    return (q[0] * (1 - fx) + q[1] * fx) * (1 - fy) + (q[2] * (1 - fx) + q[3] * fx) * fy
