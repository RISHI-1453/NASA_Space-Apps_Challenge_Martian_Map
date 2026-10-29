"""Walking routes that go around steep ground instead of straight over it.

For each leg the terrain around it is gridded from the sharpest DEM (20 m in Jezero and Gale, the
200 m HRSC/MOLA blend elsewhere) and searched with A*: the cost of each step is the time it takes
to walk (the same suited Tobler hiking speed the planner uses), steps steeper than AVOID_DEG cost
PENALTY times more, and steps steeper than BLOCK_DEG are not allowed. The grid path is then
straightened wherever a direct line is no slower and no steeper, so open ground stays a straight
line and only the bits that need it bend around crater walls, scarps and big rock formations.
"""
from __future__ import annotations

import heapq
import math
import threading
from collections import OrderedDict

import numpy as np

import terrain

AVOID_DEG = 15    # the planner's "hazard" slope: walk around these if a detour is reasonable
BLOCK_DEG = 25    # never route a walker up or down anything steeper
PENALTY = 6       # a minute on >15° ground counts like six on the flat
MAX_CELLS = 220   # grid size per side: keeps each search well under a second
MAX_LEG_M = 30_000
_cache: OrderedDict[tuple, list] = OrderedDict()
_lock = threading.Lock()


def _speed(s):  # km/h for slope rise/run (numpy), as terrain.walking_speed_kmh
    return 6 * np.exp(-3.5 * np.abs(s + 0.05)) * terrain.SUIT_FACTOR


def _res_for(s, w, n, e) -> float:
    """The finest terrain under any part of the area (the walk profile will use it there too)."""
    for d in terrain.LOCAL_DEMS:
        if d.overlaps(s, w, n, e):
            return d.res_m
    return 200.0


def safe_leg(a: tuple[float, float], b: tuple[float, float]) -> dict | None:
    """Vertices of a gentler walking line a -> b (endpoints included), or None to walk straight."""
    key = (round(a[0], 6), round(a[1], 6), round(b[0], 6), round(b[1], 6))
    rkey = key[2:] + key[:2]
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
        if rkey in _cache:  # the walk back retraces the way out
            hit = _cache[rkey]
            return None if hit is None else {**hit, "path": hit["path"][::-1]}
    out = _search(a, b)
    with _lock:
        _cache[key] = out
        while len(_cache) > 200:
            _cache.popitem(last=False)
    return out


def _search(a, b):
    L = terrain.haversine_m(a, b)
    if L < 60 or L > MAX_LEG_M:
        return None
    lat0 = (a[0] + b[0]) / 2
    m_lat = terrain.MARS_RADIUS_M * math.pi / 180
    m_lon = m_lat * math.cos(math.radians(lat0))
    pad = max(0.35 * L, 600)
    s, n = min(a[0], b[0]) - pad / m_lat, max(a[0], b[0]) + pad / m_lat
    w, e = min(a[1], b[1]) - pad / m_lon, max(a[1], b[1]) + pad / m_lon
    span_x, span_y = (e - w) * m_lon, (n - s) * m_lat
    cell = max(_res_for(s, w, n, e), span_x / MAX_CELLS, span_y / MAX_CELLS)
    nx, ny = max(8, int(span_x / cell) + 1), max(8, int(span_y / cell) + 1)
    h, _ = terrain.area_grid(s, w, n, e, nx, ny)       # row 0 = north
    h = np.nan_to_num(h.astype(np.float64), nan=float(np.nanmean(h)))
    dx, dy = (e - w) * m_lon / (nx - 1), (n - s) * m_lat / (ny - 1)

    # cost (hours) of each of the 8 moves out of every cell
    moves = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]
    INF = np.inf
    cost = []
    for di, dj in moves:
        d = math.hypot(di * dy, dj * dx)
        shifted = np.roll(h, (-di, -dj), axis=(0, 1))   # shifted[i, j] = h[i + di, j + dj]
        if di:
            shifted[-1 if di > 0 else 0, :] = np.nan    # no stepping off the grid
        if dj:
            shifted[:, -1 if dj > 0 else 0] = np.nan
        dz = shifted - h
        slope = dz / d
        deg = np.degrees(np.arctan(np.abs(slope)))
        c = (d / 1000) / _speed(slope)
        c = np.where(deg > AVOID_DEG, c * PENALTY, c)
        c = np.where((deg > BLOCK_DEG) | np.isnan(shifted), INF, c)
        cost.append(c)
    cost = np.stack(cost)                               # 8 x ny x nx

    def cell_of(p):
        return (min(ny - 1, max(0, round((n - p[0]) / (n - s) * (ny - 1)))),
                min(nx - 1, max(0, round((p[1] - w) / (e - w) * (nx - 1)))))

    (si, sj), (gi, gj) = cell_of(a), cell_of(b)
    vmax = float(_speed(np.array(-0.05)))               # fastest possible walking speed: keeps A* exact
    hscale = 1 / (1000 * vmax)
    g = np.full(ny * nx, INF)
    came = np.full(ny * nx, -1, dtype=np.int64)
    start, goal = si * nx + sj, gi * nx + gj
    g[start] = 0
    heap = [(math.hypot((si - gi) * dy, (sj - gj) * dx) * hscale, start)]
    closed = np.zeros(ny * nx, dtype=bool)
    flat = cost.reshape(8, -1)
    while heap:
        _, u = heapq.heappop(heap)
        if closed[u]:
            continue
        if u == goal:
            break
        closed[u] = True
        ui, uj = divmod(u, nx)
        gu = g[u]
        for k, (di, dj) in enumerate(moves):
            c = flat[k, u]
            if c == INF:
                continue
            vi, vj = ui + di, uj + dj
            v = vi * nx + vj
            nv = gu + c
            if nv < g[v]:
                g[v] = nv
                came[v] = u
                heapq.heappush(heap, (nv + math.hypot((vi - gi) * dy, (vj - gj) * dx) * hscale, v))
    if g[goal] == INF:
        return None

    cells = [goal]
    while cells[-1] != start:
        cells.append(int(came[cells[-1]]))
    cells.reverse()
    # positions in metres (x east, y north) from the grid's north-west corner
    xy = [((c % nx) * dx, -(c // nx) * dy) for c in cells]
    xy[0] = ((a[1] - w) * m_lon, (a[0] - n) * m_lat)
    xy[-1] = ((b[1] - w) * m_lon, (b[0] - n) * m_lat)
    # drop the vertices in the middle of straight grid runs
    xy = [xy[0]] + [q for p, q, r in zip(xy, xy[1:], xy[2:])
                    if abs((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])) > 1e-6] + [xy[-1]]

    def height(x, y):
        fi, fj = -y / dy, x / dx
        i0, j0 = min(ny - 2, max(0, int(fi))), min(nx - 2, max(0, int(fj)))
        ti, tj = min(1, max(0, fi - i0)), min(1, max(0, fj - j0))
        return ((h[i0, j0] * (1 - tj) + h[i0, j0 + 1] * tj) * (1 - ti) + (h[i0 + 1, j0] * (1 - tj) + h[i0 + 1, j0 + 1] * tj) * ti)

    def segment(p, q):
        """(walking hours, metres steeper than AVOID_DEG, max slope deg) of a straight line p -> q."""
        d = math.hypot(q[0] - p[0], q[1] - p[1])
        k = max(1, int(d / (min(dx, dy) / 2)))
        t_h = steep = mx = 0.0
        z0 = height(*p)
        for i in range(1, k + 1):
            x, y = p[0] + (q[0] - p[0]) * i / k, p[1] + (q[1] - p[1]) * i / k
            z = height(x, y)
            st = (z - z0) / (d / k)
            deg = math.degrees(math.atan(abs(st)))
            mx = max(mx, deg)
            t_h += (d / k / 1000) / terrain.walking_speed_kmh(st)
            if deg > AVOID_DEG:
                steep += d / k
            z0 = z
        return t_h, steep, mx

    def stats(pts):
        t = st = mx = 0.0
        for p, q in zip(pts, pts[1:]):
            a_, b_, c_ = segment(p, q)
            t += a_; st += b_; mx = max(mx, c_)
        return t, st, mx

    # straighten: from each vertex, jump to the farthest later vertex a straight line reaches
    # without being slower, steeper overall, or crossing more steep ground than the grid path did
    out, i = [xy[0]], 0
    pref = [0.0]
    for p, q in zip(xy, xy[1:]):
        pref.append(pref[-1] + segment(p, q)[0])
    while i < len(xy) - 1:
        best = i + 1
        for j in range(len(xy) - 1, i + 1, -1):
            t, steep, mx = segment(xy[i], xy[j])
            if steep == 0 and mx <= BLOCK_DEG and t <= (pref[j] - pref[i]) * 1.02:
                best = j
                break
        out.append(xy[best])
        i = best

    straight = segment(xy[0], xy[-1])
    path = stats(out)
    if straight[1] == 0 or path[1] >= straight[1]:
        return None  # nothing steep in the way (or no better line): walk straight
    to_ll = lambda p: (round(n + p[1] / m_lat, 6), round(w + p[0] / m_lon, 6))
    return {"path": [to_ll(p) for p in out],
            "straight_steep_m": round(straight[1]), "steep_m": round(path[1]),
            "straight_km": round(L / 1000, 3), "cell_m": round(cell)}
