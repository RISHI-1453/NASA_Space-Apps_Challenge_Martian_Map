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

## Intro (for presenting)

The intro plays every time the app opens. A title screen ("Code Huzzlers presents Martian Map") shows for about 3 seconds, then a ~38-second 3D journey starts by itself with its own soundtrack. Press **Begin** to start it straight away:
**Milky Way → dive into the Sun → the whole solar system today (all eight planets) → the inner planets → Earth → Earth and Mars together → "Anywhere on Mars"**.
At the end, the Mars globe turns past famous places, then **unrolls into the flat map**. That flat map lands pixel-for-pixel on the app's whole-planet view, so the intro hands over without a cut. No particular site is preset: the app opens on the whole planet, or on your saved position.

- **Real positions:** planets sit where they are *today*, using JPL approximate Keplerian elements. Earth–Mars distance and radio delay are computed live, and were checked against JPL Horizons (1.6446 vs 1.6447 AU on 4 Oct 2026). Distances are to scale; planet sizes are not.
- **Real imagery:** NASA Blue Marble (Earth) and the Viking MDIM 2.1 colour mosaic (Mars), via `scripts/build_textures.py`. Place labels come from the IAU gazetteer.
- **Look:** bloom glow on the Sun and galaxy core, atmosphere halos on Earth and Mars, and soft particle stars.
- **Sound:** a score synthesised live with the Web Audio API (`frontend/score.js`, no audio files). It has a drone, evolving chords per chapter, a riser and boom on the Sun dive, shimmering arpeggios, a whoosh across to Mars, and a chime as the map lands. It stays in sync when you pause or jump. Browsers keep sound off until the viewer clicks or presses a key, so if nobody has, the **Click for sound** button pulses; the music then joins in at the right point.
- **Controls:** **Begin** (or Enter) starts it. Then **Space** pauses or plays, **← / →** moves between chapters, **M** toggles sound, and **Esc** skips to the map. The chapter timeline is clickable, and **Watch intro** in the header replays it.
- **Skipping:** add `#nointro` to the URL (or `?intro=0`) to open straight on the map.

## What works now

**Map layers (all NASA Mars Trek WMTS):**

| Layer | Resolution | Mission |
|---|---|---|
| THEMIS day-infrared global mosaic | 100 m/px | Mars Odyssey |
| Viking color mosaic (default) | 232 m/px | Viking orbiters |
| MOLA color elevation | 463 m/px | Mars Global Surveyor |
| CTX Jezero mosaic (overlay) | 6 m/px | MRO |
| HiRISE Jezero mosaic (overlay) | 25 cm/px | MRO |

**Terrain (heights, slopes):** uses the sharpest model covering each point.
- CTX Jezero DTM, 20 m/px. This is the USGS Mars 2020 landing-navigation product, with coverage shown as a green dashed box on the map.
- MGS MOLA MEGDR, about 3.7 km/px, everywhere else.

**Directions (from → stops → to):** works like a maps app. A start or destination can be your position, a landing site, any of the 2,052 IAU-named places, typed coordinates (`-4.6, 137.4`), or a point chosen on the map. Stops can be added in between, and ⇅ swaps the ends. Every site, search result and dropped pin offers *Directions to here*, *Start from here*, *Add as stop* and *Ground view*. Points chosen on the map are named after the feature they're in, e.g. "Inside Jezero".

**Astronaut & suit:** the astronaut enters current readings: oxygen %, battery %, cooling water %, CO₂-scrubber hours, body mass, carried load, how they feel (fresh / normal / tired), heart rate and the safety reserve to keep. For every 200 m step the app estimates metabolic power from walking speed and slope, using the Pandolf (1977) load-carriage equation scaled to Mars gravity (0.38 g), with a pressurised-suit factor. It turns that power into:
- **Oxygen:** 20.1 kJ of energy per litre of O₂ burned
- **CO₂ scrubber:** hours of capacity used, scaled to effort
- **Cooling water:** water evaporated to remove body heat
- **Battery:** a steady draw for fans, pumps and radio

The route summary shows the share of each supply the walk uses and names the **limiting supply**. Each stop shows the oxygen left on arrival. During live guidance, **Update readings** re-baselines from the real gauges, and the turn-back alert checks every supply, including the slower use while you're stopped. Suit capacities default to ISS-EMU figures (e.g. 0.54 kg primary O₂) and can be changed in `frontend/suit.js` for a Mars suit design.

**Ground view (Street View for Mars):**
- **Rover photos:** finds the nearest Perseverance or Curiosity stop within 3 km (from NASA's MMGIS rover-traverse data). It lays out that stop's Navcam frames around 360° by the mast azimuth and elevation recorded with each frame (NASA raw-image APIs). Drag to look around, scroll to zoom, and click a frame for full size. This covers Jezero (Perseverance) and Gale (Curiosity).
- **3D terrain:** the sharpest elevation model (CTX DTM 20 m in Jezero, MOLA elsewhere) draped with Mars Trek imagery (HiRISE 25 cm, CTX 6 m or Viking), with a Mars sky and the sun placed for your departure time. You can view it from overhead or **stand there at eye level**, with a *Relief ×3* toggle.
- **Walk it in 3D:** fly along the planned route by drone, at eye level or in free look, with the path coloured by slope and the A/B/C pins in place. A scrub bar shows distance, elevation, slope and the current instruction.

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

**Live Marswalk guidance (▶ Start Marswalk):** answers "am I on the right path?" while walking.
- **Position input:** Mars has no GPS, so position comes from the suit or rover **nav fix**. Tap the map, or use *Your position → I'm here*. **Simulate walk** plays the route at 10–900× for demos, with an optional *Drift off route*.
- **Snapping to the route:** each fix is matched to the nearest point on the planned route. It never jumps more than 100 m backwards, so an out-and-back route can't snap onto the return leg too early.
- **Next-turn card (green):** distance to the next stop and what to do there, e.g. "898 m · At C: turn left west-northwest".
- **Off route (red card):** appears beyond 40 m from the path, with the compass heading back to it and a dashed line to the nearest point on the route.
- **Alerts:** **TURN BACK** when the walking left exceeds the O₂ left before reserve, wrong way, a steep slope within 300 m, finishing after sunset, and falling behind plan.
- **Bottom bar:** ETA (local solar time), distance to go, walking time left, O₂ left and EVA time. Arrival messages appear at each stop. The walked part of the route turns grey and your trail is drawn. Optional 🔊 voice guidance.

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
backend/app.py       FastAPI: /api/sites, /api/places, /api/whereis, /api/elevation, /api/dem, /api/profile,
                     /api/rover/nearest, /api/rover/photos, /api/terrain/grid
backend/places.py    IAU place-name search + "where am I" descriptions
backend/rover.py     nearest rover stop + its Navcam photos (NASA MMGIS + raw-image APIs, cached)
backend/terrain.py   DEM sampling (local DTMs -> MOLA), great-circle densify, legs/directions, slope/EVA model
frontend/            Leaflet (EPSG:4326 + Trek tiles), Chart.js profile, Mars clock
frontend/intro.js    3D opener (galaxy → solar system → Mars → globe unrolls into the map); textures in frontend/textures/
frontend/score.js    the intro's synthesised soundtrack (Web Audio)
frontend/directions.js  From → stops → To planner, search, choose-on-map, popup actions
frontend/suit.js     astronaut & suit readings, metabolic/consumables model
frontend/groundview.js  rover photos look-around, 3D terrain, 3D route walk (Three.js)
frontend/navigate.js live guidance: route snapping, off-route, next turn, O2/turn-back, simulation
data/                sites.json, MOLA grid + Jezero DTM (downloaded, git-ignored)
scripts/fetch_data.py      downloads the elevation data
scripts/build_features.py  rebuilds data/mars_features.json from the USGS gazetteer
scripts/build_textures.py  rebuilds the intro's Earth/Mars globe textures (needs Pillow)
```

Known limitation: Leaflet's scale bar assumes Earth's radius. Distances in the panel use the Mars radius (3389.5 km) and are correct.
