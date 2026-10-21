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
def elevation(lat: float, lon: float, quick: bool = False):
    """quick=1 never waits on a download (the cursor readout): cached 200 m data, else MOLA."""
    try:
        z, src = terrain.elevation_src(lat, lon, fetch=not quick)
        return {"lat": lat, "lon": lon, "elev_m": round(z, 1), "source": src}
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))


@app.get("/api/places")
def places_search(q: str, limit: int = 8):
    """Search IAU-named Mars features (craters, mountains, valleys...)."""
    return places.search(q, min(limit, 20))


@app.get("/api/places/near")
def places_near(lat: float, lon: float, max_km: float = 80, limit: int = 12):
    """Named features near a point (nearest first) — landmarks for a bearings fix."""
    return places.near(lat, lon, min(max_km, 500), min(limit, 50))


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


@app.get("/api/terrain/tile/{z}/{x}/{y}")
def terrain_tile(z: int, x: int, y: int):
    """3D-globe heightmap: 65x65 int16 metres over geographic tile (z, x, y), row 0 = north."""
    if not (0 <= z <= 22 and 0 <= x < 2 ** (z + 1) and 0 <= y < 2 ** z):
        raise HTTPException(404, "no such tile")
    data, src = terrain.tile_bytes(z, x, y)
    # tiles never change, so browsers can keep them; a MOLA stand-in for a missed download can't
    stand_in = z >= terrain.NET_LEVEL and src == terrain.MOLA_LABEL
    return Response(data, media_type="application/octet-stream",
                    headers={"X-Source": src, "Access-Control-Expose-Headers": "X-Source",
                             "Cache-Control": "public, max-age=120" if stand_in else "public, max-age=2592000, immutable"})


@app.get("/api/features")
def all_features():
    """Every IAU-named feature, compact: [name, kind, lat, lon, diameter_km, MOLA elevation m] — globe labels."""
    return [[f["name"], f["kind"], f["lat"], f["lon"], f["diameter_km"], round(terrain.mola_elevation(f["lat"], f["lon"]))]
            for f in places.features()]


@app.get("/api/rover/track")
def rover_track(mission: str):
    """A rover's whole traverse as [[lat, lon], ...] plus its latest stop."""
    if mission not in rover.MISSIONS:
        raise HTTPException(400, "mission must be m2020 or msl")
    wp = rover.waypoints(mission)
    return {"rover": rover.MISSIONS[mission]["name"], "points": [[p["lat"], p["lon"]] for p in wp], "latest": wp[-1]}


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
