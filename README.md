# Martian Map — Interplanetary Survival Guide

**Challenge:** Interplanetary Survival Guide: Martian Map (2026 NASA Space Apps, Intermediate)
**Team:** Code Huzzlers

A layered, integrated map of the Martian surface that helps an astronaut plan a **Marswalk**:
draw a route, see its elevation profile, slope hazards, walking time against the suit's O₂
budget, and the sun/daylight conditions at the destination.

## Run

```bat
run.bat
```
Then open http://localhost:8002. The first time only, set up the environment and download the elevation grid:
```bat
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python scripts\fetch_data.py
```

## What works now

**Map layers (all NASA Mars Trek WMTS):**

| Layer | Resolution | Mission |
|---|---|---|
| THEMIS day-infrared global mosaic (default) | 100 m/px | Mars Odyssey |
| Viking color mosaic | 232 m/px | Viking orbiters |
| MOLA color elevation | 463 m/px | Mars Global Surveyor |
| CTX Jezero mosaic (overlay) | 6 m/px | MRO |
| HiRISE Jezero mosaic (overlay) | 25 cm/px | MRO |

**Terrain (heights, slopes):** uses the sharpest model covering each point.
- CTX Jezero DTM, 20 m/px. This is the USGS Mars 2020 landing-navigation product, with coverage shown as a green dashed box on the map.
- MGS MOLA MEGDR, about 3.7 km/px, everywhere else.

**Your position (no GPS on Mars):**
- **Search:** 2,052 official IAU place names (craters, mountains, valleys…). Choosing one flies the map there and opens a place card.
- **Coordinates:** type them from the lander/rover navigation fix, e.g. `18.4447, 77.4508`, `4.59S 137.44E`, or 0–360°E.
- **Pick on map:** click to drop the blue pulsing "You are here" dot. Right-click anywhere for a dropped pin.
- **Place cards:** 📍 *I'm here* · 🧭 *Directions from me* · ➕ *Add as stop*.
- **Description:** your position is described in plain words (e.g. "Inside Jezero (crater, 48 km across), in Nili Fossae"), with its elevation and terrain source. *Start route here* begins a Marswalk from that spot. The position is remembered between visits.

**Marswalk planner (Google-Maps style):**
- **Stops:** lettered pins A, B, C… that you can drag. The route has a dark outline, and each leg is labelled with its distance and time.
- **Slope colouring:** the route turns amber over 8° and red over 15°, with a red dot at each hazard point.
- **Summary card:** total time, distance, climb, an O₂ bar (usable vs 20 % reserve), finish time against the daylight window, and an overall verdict (safe / caution / not feasible).
- **Turn-by-turn directions:** "Head west-northwest for 1.65 km". Each leg describes the terrain (steady climb / rolling / level…) and gives climb, descent and time, plus warnings for steep sections.
- **At every stop:** arrival time in local solar time, distance so far, elevation, O₂ left, and sun elevation. Warnings appear for the O₂ reserve, sunset, or a low sun.
- **Options:** departure time, and "return to start", which adds the walk back so the whole EVA is checked.
- **Elevation profile:** the line is coloured by slope, with the stop letters marked. Hovering the chart shows the matching point on the map.
- **Click a step:** zooms to and highlights that leg.
- **Export:** GeoJSON of the route, stops, stats and directions.

**Mars clock:** Mars Sol Date, MTC, Ls (season), Mars Year; local true solar time, sun elevation and daylight window at the destination, using the Mars24 algorithm (`frontend/marstime.js`).

## Layers to add once challenge resources are live

- **More high-res terrain:** add DTMs for other sites. Drop a GeoTIFF in `data/` and add a `LocalDEM(...)` line in `terrain.py`.
  The Jezero HiRISE DTM (1 m) exists too, but it's 1.8 GB.
- **Imagery:** CTX global mosaic and HiRISE orthoimages (Trek layer names from the WMTS GetCapabilities).
- **Mineralogy:** CRISM / OMEGA hydrated-mineral maps, for science stops.
- **Subsurface ice:** SWIM (Subsurface Water Ice Mapping) consensus map, for ISRU.
- **Conditions:** MEDA (Perseverance) / REMS (Curiosity) weather, MCS dust opacity, RAD radiation,
  TES/THEMIS thermal inertia (how loose the ground is underfoot).
- **Science along the way:** auto-suggest stops where a route crosses mineral/ice/geology units.

## Structure

```
backend/app.py       FastAPI: /api/sites, /api/places, /api/whereis, /api/elevation, /api/dem, /api/profile
backend/places.py    IAU place-name search + "where am I" descriptions
backend/terrain.py   DEM sampling (local DTMs -> MOLA), great-circle densify, legs/directions, slope/EVA model
frontend/            Leaflet (EPSG:4326 + Trek tiles), Chart.js profile, Mars clock
data/                sites.json, MOLA grid + Jezero DTM (downloaded, git-ignored)
scripts/fetch_data.py      downloads the elevation data
scripts/build_features.py  rebuilds data/mars_features.json from the USGS gazetteer
```

Known limitation: Leaflet's scale bar assumes Earth's radius. Distances in the panel use the Mars radius (3389.5 km) and are correct.
