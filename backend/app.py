"""Martian Map API.  Run:  uvicorn app:app --reload --port 8002  (from backend/)"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import places
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
