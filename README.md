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
- **USGS HRSC/MOLA blended DEM, 200 m/px, everywhere on Mars.** `backend/globaldem.py` streams it as 513×513 LERC elevation tiles from Esri's public hosting of the same USGS product. One ~250 KB tile covers 1.4° (about 83 km), so a whole neighbourhood arrives in a single request. Spot checks against the USGS GeoTIFF agree to about 1 m. Tiles are cached on disk (`data/esri_dem/`) and in memory, so each area downloads once; if the service is unreachable the app falls back to MOLA.
- MGS MOLA MEGDR, about 3.7 km/px, as the offline fallback.

**Directions (from → stops → to):** works like a maps app. A start or destination can be your position, a landing site, any of the 2,052 IAU-named places, typed coordinates (`-4.6, 137.4`), or a point chosen on the map. Stops can be added in between, and ⇅ swaps the ends. Every site, search result and dropped pin offers *Directions to here*, *Start from here*, *Add as stop* and *Ground view*. Points chosen on the map are named after the feature they're in, e.g. "Inside Jezero".

**Astronaut & suit:** the astronaut enters current readings: oxygen %, battery %, cooling water %, CO₂-scrubber hours, body mass, carried load, how they feel (fresh / normal / tired), heart rate and the safety reserve to keep. For every 50 m step the app estimates metabolic power from walking speed and slope with the Pandolf (1977) load-carriage equation. It then scales that to Mars gravity with the **measured** factor: walking at 0.38 g costs about 68% of walking on Earth, not 38% (Brown et al. 2018; Farley & McMahon 1992). A pressurised-suit factor goes on top. Typical walks average 230–360 W, matching Apollo lunar EVAs (229–352 W, Waligora et al. 1975). It turns that power into:
- **Oxygen:** 20.1 kJ of energy per litre of O₂ burned
- **CO₂ scrubber:** hours of capacity used, scaled to effort
- **Cooling water:** water evaporated to remove body heat
- **Battery:** a steady draw for fans, pumps and radio

The route summary shows the share of each supply the walk uses and names the **limiting supply**. Each stop shows the oxygen left on arrival. During live guidance, **Update readings** re-baselines from the real gauges, and the turn-back alert checks every supply, including the slower use while you're stopped. Suit capacities default to ISS-EMU figures (e.g. 0.54 kg primary O₂) and can be changed in `frontend/suit.js` for a Mars suit design.

**Mars in 3D (`frontend/globe.js`):** the whole planet as a streaming 3D globe, like Google Earth, built on CesiumJS.
- **Opening it:** the **🌐 3D** button on the map opens the same view in 3D, and **🗺 Back to map** returns the map to wherever you flew. Ground view opens a spot in 3D (directly, if no rover has been within 3 km).
- **Terrain:** streamed as 65×65 heightmaps from `/api/terrain/tile/{z}/{x}/{y}`:
  - The local MOLA grid for the planet view (instant).
  - The HRSC/MOLA 200 m blend from zoom level 8.
  - The 20 m CTX DTM in Jezero from level 9.
  - **Relief ×1/×2/×3** exaggerates heights.
- **Imagery:** the Viking colour mosaic, sharpened close up by the **global 5 m CTX mosaic** (Caltech Murray Lab, via Esri), plus HiRISE 25 cm and CTX 6 m in Jezero. You can switch to CTX only, Viking or MOLA elevation colours. The three heavy layers come through `/api/imagery/…` (`backend/imagery.py`), which re-encodes each PNG tile as WebP once and caches it: about 8 KB per tile instead of 60–95 KB.
- **On the globe:**
  - Your route, draped on the terrain and coloured by slope, with its A/B/C pins.
  - The dashed 10 km walk-home ring and the ⟲ point of no return.
  - Landing and candidate sites, and all 2,052 IAU place names (big features from far away, small craters up close).
  - **Perseverance's and Curiosity's real traverses** and their latest positions.
  - Your position.
- **Moving around:** drag to move, right-drag (or Ctrl/Shift-drag) to tilt and turn, scroll to zoom, double-click to zoom in on a spot. An on-screen pad has a compass (click for north up), zoom ＋/－, turn ⟲/⟳, a top-down/tilted switch and **↻ Orbit** (a slow circle around the view, handy for presenting).
- **Never closer than the data allows:** the camera stops about 1.5 km above the ground on the 200 m terrain, and 200 m above it in Jezero (20 m terrain). Closer than that, orbital data can only look smeared, so there is no eye-level mode.
- **Walk it in 3D:** a chase camera follows the planned route, about 260 m up in Jezero and 1.1 km up elsewhere, with a scrub bar showing distance, elevation, slope and the current instruction. **Look around** frees the camera.
- **Speed:**
  - Cesium (about 1.5 MB) loads the first time 3D is opened, not with the page, and the browser keeps it for a year.
  - The 3D view stays alive between opens, so reopening is instant.
  - Jumping to a far place happens instantly behind a short loading veil, instead of a long flight that streams every tile on the way.
  - Terrain tiles are gzipped and cached by the browser for 30 days. The status pill shows how many tiles are still streaming.
- **Engine workarounds:** Mars needed two fixes Earth never does.
  - Cesium won't draw terrain while the camera is below its ellipsoid, and Mars' lowlands sit up to 8 km below the datum. So the engine's sphere sits 10 km under the datum and every height is raised to match.
  - Cesium sizes ground-draped lines from a table of Earth's terrain heights, which is replaced with one range that holds all of Mars.

**3D-printed relief models (OrbitStudio, `frontend/orbit.js`):** a model you can hold lets the crew brief an EVA around a table (trace the route, point at the steep parts, agree where to turn back), much as Apollo crews studied relief models of their landing sites.
- **🖨 Print model** is on the route summary, on every site, landmark and place card, and in the 3D view.
- It opens [OrbitStudio](https://orbitstudio3d.com), which turns NASA elevation data into an STL or multicolour 3MF model for a habitat or home 3D printer.
- When the area lies inside one of OrbitStudio's known places, the link opens there with a 20 cm square model and relief ×2 filled in. Otherwise it gives the coordinates to paste into *Jump to Coordinates*.
- The dialog explains the limits: the smallest Mars model is 24 km across, small features don't show, and generating and previewing is free while downloading the print file needs an OrbitStudio plan or credit.

**Landmarks of Mars (Sites tab and map ◆):** OrbitStudio's travel list of 45 places: volcanoes, the Valles Marineris canyons, craters, channels, plains and basins, both polar caps, and every landing site. Each has a description, MOLA elevation, distance from you, and *Fly there*, *Directions*, *🌐 3D* and *🖨 Print model*. The list is filterable, and the map layer toggles in the layers control. The data (`data/landmarks.json`) was collected with the OrbitStudio connector; `/api/landmarks` serves it.

**Ground view (Street View for Mars):**
- **Rover photos:** finds the nearest Perseverance or Curiosity stop within 3 km (from NASA's MMGIS rover-traverse data). It lays out that stop's Navcam frames around 360° by the mast azimuth and elevation recorded with each frame (NASA raw-image APIs). Drag to look around, scroll to zoom, and click a frame for full size. This covers Jezero (Perseverance) and Gale (Curiosity).
- **🌐 3D view:** opens the same spot on the 3D globe.

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
- **Position input:** Mars has no GPS, so position comes from the suit or rover **nav fix**. The walk starts at A and **only moves when the astronaut reports a position**:
  - **📍 Tap my position:** one deliberate map tap. Ordinary map clicks are ignored.
  - **Typed coordinates.**
  - **Your position → I'm here.**

  Each fix carries an accuracy (a tap is about 12 screen pixels at the current zoom), shown as a circle. *Off route* only triggers beyond that uncertainty, and *wrong way* needs three clearly backwards fixes.
- **Snapping to the route:** each fix is matched to the nearest point on the planned route. It never jumps more than 100 m backwards, so an out-and-back route can't snap onto the return leg too early.
- **Next-turn card (green):** distance to the next stop and what to do there, e.g. "898 m · At C: turn left west-northwest".
- **Off route (red card):** appears beyond 40 m from the path, with the compass heading back to it and a dashed line to the nearest point on the route.
- **Alerts:** **TURN BACK** when the walking left exceeds the O₂ left before reserve, wrong way, a steep slope within 300 m, finishing after sunset, and falling behind plan.
- **Bottom bar:** ETA (local solar time), distance to go, walking time left, O₂ left and EVA time. Arrival messages appear at each stop. The walked part of the route turns grey and your trail is drawn.

**Mars clock:** Mars Sol Date, MTC, Ls (season), Mars Year; local true solar time, sun elevation and daylight window at the destination, using the Mars24 algorithm (`frontend/marstime.js`). Also shows the live **signal delay to Earth** (JPL orbital elements), with a warning near solar conjunction.

**Research-backed (Science tab):** 38 peer-reviewed and NASA sources, gathered with a SciSpace literature search. Each figure the app shows carries a small numbered link to its source. The Science tab lists every source with what it found and where the app uses it (`frontend/science.js`).
- **Route research check**, under every route summary:
  - **Effort vs Apollo:** average power against the 229–352 W Apollo average. Peaks are flagged above the Apollo/Skylab maximum (581 W) or the Walkback-Test pace that overwhelmed suit cooling (≈ 700 W).
  - **Radiation dose for the walk:** 0.64 mSv/day measured by Curiosity's RAD, up to 50% more near solar minimum. Includes an altitude note (thinner air on high ground means more dose) and context: Earth background, the ~660 mSv trip to Mars, and NASA's 600 mSv career limit.
  - **Walk-back:** furthest distance from the start against the 10 km Apollo walk-home limit, drawn as a dashed ring. One-way routes also get a ⟲ **point of no return**: the last spot from which retracing your steps to A still fits your suit's supplies with the reserve intact (the SEXTANT walk-back idea).
  - **Load:** suit plus pack against the 50%-of-body-mass limit for an 8-hour Mars walk (Wickman & Luna 1996).
  - **Pace:** your pace against the optimal Mars walking speed (3.4 km/h, Cavagna 1998) and the walk-to-lope speed (Froude 0.5, Kram 1997).
  - **Dust:** dust-devil season and hours (Cantor 2006, Greeley 2010, Ferri 2003), the Amazonis and Hellas hotspots (Conway 2025), and dust-storm season (Ls 180–360°).
- **Hazards & resources here**, in Conditions: radiation by altitude, dust devils and storms, near-surface convection (MEDA), ground-ice likelihood by latitude (SWIM, mid-latitude ice, pole-facing slopes), and perchlorate and dust toxicity.

## Layers to add once challenge resources are live

- **More high-res terrain:** add DTMs for other sites. Drop a GeoTIFF in `data/` and add a `LocalDEM(...)` line in `terrain.py`.
  The Jezero HiRISE DTM (1 m) exists too, but it's 1.8 GB.
- **Imagery:** more HiRISE orthoimages beyond Jezero (Trek layer names from the WMTS GetCapabilities).
- **Mineralogy:** CRISM / OMEGA hydrated-mineral maps, for science stops.
- **Subsurface ice:** the SWIM ice-consistency map itself (3 km/px), replacing today's latitude-band note.
- **Conditions:** live MEDA (Perseverance) / REMS (Curiosity) weather, MCS dust opacity, RAD dose by sol,
  TES/THEMIS thermal inertia (how loose the ground is underfoot).
- **Science along the way:** auto-suggest stops where a route crosses mineral/ice/geology units.

## Structure

```
backend/app.py       FastAPI: /api/sites, /api/landmarks, /api/places, /api/whereis, /api/elevation, /api/dem,
                     /api/profile, /api/rover/nearest, /api/rover/photos, /api/rover/track,
                     /api/terrain/tile/{z}/{x}/{y}, /api/imagery/{layer}/{z}/{y}/{x}, /api/features
backend/places.py    IAU place-name search + "where am I" descriptions
backend/globaldem.py 200 m global DEM as cached LERC tiles (USGS HRSC/MOLA blend, hosted by Esri)
backend/imagery.py   the sharpest imagery layers for the 3D view, re-encoded once as small WebP tiles
backend/rover.py     nearest rover stop + its Navcam photos (NASA MMGIS + raw-image APIs, cached)
backend/terrain.py   DEM sampling (local DTMs -> MOLA), great-circle densify, legs/directions, slope/EVA model
frontend/            Leaflet (EPSG:4326 + Trek tiles), Chart.js profile (loaded on first route), Mars clock
frontend/intro.js    3D opener (galaxy → solar system → Mars → globe unrolls into the map); textures in frontend/textures/
frontend/score.js    the intro's synthesised soundtrack (Web Audio)
frontend/directions.js  From → stops → To planner, search, choose-on-map, popup actions
frontend/suit.js     astronaut & suit readings, metabolic/consumables model
frontend/science.js  the 38 cited sources, route research check, walk-back / point of no return, hazard notes
frontend/groundview.js  rover photos look-around (hands 3D over to globe.js)
frontend/globe.js    the 3D Mars globe (CesiumJS): streaming terrain + imagery, route, sites, names, rover tracks, fly-along
frontend/navigate.js live guidance: route snapping, off-route, next turn, O2/turn-back
frontend/orbit.js    OrbitStudio: 🖨 3D-print a relief model of an area; the 45 Mars landmarks guide
data/                sites.json, landmarks.json (OrbitStudio), mars_features.json; MOLA grid + Jezero DTM and the
                     tile caches (downloaded, git-ignored)
scripts/fetch_data.py      downloads the elevation data
scripts/build_features.py  rebuilds data/mars_features.json from the USGS gazetteer
scripts/build_textures.py  rebuilds the intro's Earth/Mars globe textures (needs Pillow)
```

Known limitation: Leaflet's scale bar assumes Earth's radius. Distances in the panel use the Mars radius (3389.5 km) and are correct.
