"""Martian Map API.  Run:  uvicorn app:app --reload --port 8002  (from backend/)"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import places
import rover
import terrain

ROOT = Path(__file__).resolve().parent.parent
app = FastAPI(title="Martian Map")


@app.get("/api/sites")
def sites():
    return json.loads((ROOT / "data" / "sites.json").read_text(encoding="utf-8"))


@app.get("/api/elevation")
def elevation(lat: float, lon: float):
    try:
        z, src = terrain.elevation_src(lat, lon)
        return {"lat": lat, "lon": lon, "elev_m": round(z, 1), "source": src}
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))


@app.get("/api/places")
def places_search(q: str, limit: int = 8):
    """Search IAU-named Mars features (craters, mountains, valleys...)."""
    return places.search(q, min(limit, 20))


@app.get("/api/whereis")
def whereis(lat: float, lon: float):
    """Describe a position: containing/nearest named feature, plus its elevation."""
    out = places.whereis(lat, lon)
    try:
        z, src = terrain.elevation_src(lat, lon)
        out.update(elev_m=round(z, 1), elev_source=src)
    except FileNotFoundError:
        pass
    return out


@app.get("/api/rover/nearest")
def rover_nearest(lat: float, lon: float, max_km: float = 3.0):
    """Nearest Perseverance/Curiosity stop to a point (within max_km), or null."""
    return rover.nearest(lat, lon, max_km)


@app.get("/api/rover/photos")
def rover_photos(mission: str, sol: int, site: int | None = None, drive: int | None = None):
    """Rover photos (Navcam) taken on a sol, preferring frames from the given stop."""
    if mission not in rover.MISSIONS:
        raise HTTPException(400, "mission must be m2020 or msl")
    try:
        return rover.photos(mission, sol, site, drive)
    except Exception as e:
        raise HTTPException(502, f"NASA raw-image service unavailable: {e}")


@app.get("/api/terrain/grid")
def terrain_grid(s: float, w: float, n: float, e: float, nx: int = 160, ny: int = 160):
    """Elevation grid (metres, float32, row 0 = north) for the 3D view, from the sharpest DEM."""
    nx, ny = max(2, min(nx, 320)), max(2, min(ny, 320))
    import numpy as np
    out = np.empty((ny, nx), dtype="<f4")
    sources: dict[str, int] = {}
    for j in range(ny):
        lat = n - (n - s) * j / (ny - 1)
        for i in range(nx):
            z, src = terrain.elevation_src(lat, w + (e - w) * i / (nx - 1))
            out[j, i] = z
            sources[src] = sources.get(src, 0) + 1
    main = max(sources, key=sources.get)
    return Response(out.tobytes(), media_type="application/octet-stream",
                    headers={"X-Nx": str(nx), "X-Ny": str(ny), "X-Source": main,
                             "Access-Control-Expose-Headers": "X-Nx, X-Ny, X-Source"})


@app.get("/api/dem")
def dem_coverage():
    """Which elevation models are loaded and where they apply."""
    return terrain.dem_coverage()


class Route(BaseModel):
    waypoints: list[tuple[float, float]] = Field(..., min_length=2, max_length=200)
    step_m: float = Field(50, ge=20, le=5000)


@app.post("/api/profile")
def profile(route: Route):
    try:
        return terrain.profile(route.waypoints, route.step_m)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))


class Frontend(StaticFiles):
    """Static files that browsers re-validate on every load (cheap 304s via ETag), so a deploy
    never leaves visitors on a stale app.js."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/", Frontend(directory=ROOT / "frontend", html=True), name="frontend")
