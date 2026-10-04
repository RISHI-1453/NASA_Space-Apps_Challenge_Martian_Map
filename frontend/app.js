// Martian Map frontend
const $ = (id) => document.getElementById(id);

// ---------- side-panel tabs: one section at a time, so nothing hides below the fold ----------
function showTab(name) {
  document.querySelectorAll("#panel section[data-tab]").forEach((sec) => { sec.hidden = sec.dataset.tab !== name; });
  document.querySelectorAll(".panel-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  try { localStorage.setItem("martianmap.tab", name); } catch {}
}
document.querySelectorAll(".panel-tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
showTab((() => { try { return localStorage.getItem("martianmap.tab") || "route"; } catch { return "route"; } })());
const TREK = "https://trek.nasa.gov/tiles/Mars/EQ";
const trek = (layer, ext, maxNativeZoom, extra = {}) =>
  L.tileLayer(`${TREK}/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`, {
    tileSize: 256, maxNativeZoom, maxZoom: 18, noWrap: true,
    attribution: "NASA/JPL-Caltech · Mars Trek", ...extra,
  });

// ---------- map ----------
const map = L.map("map", {
  crs: L.CRS.EPSG4326, center: [0, 0], zoom: 1, minZoom: 1, maxZoom: 18, // whole planet; no preset site
  maxBounds: [[-90, -180], [90, 180]], worldCopyJump: false,
});

// Global basemaps (pick one)
const baseLayers = {
  "Viking color mosaic · 232 m": trek("Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg", 7),
  "THEMIS day infrared · 100 m": trek("THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", "png", 9),
  "MOLA color elevation · 463 m": trek("Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg", 6),
};
baseLayers["Viking color mosaic · 232 m"].addTo(map);
// High-resolution local mosaics, drawn on top only where they have coverage (Jezero crater)
const JEZ_CTX = [[18.2110, 77.1605], [18.7212, 77.6992]];
const JEZ_HIRISE = [[18.3068, 77.2229], [18.6693, 77.5840]];
const hiresLayers = {
  "CTX Jezero mosaic · 6 m": trek("JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0", "png", 13, { bounds: JEZ_CTX, minZoom: 8 }).addTo(map),
  "HiRISE Jezero mosaic · 25 cm": trek("JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", "png", 17, { bounds: JEZ_HIRISE, minZoom: 10 }).addTo(map),
};

const graticule = L.layerGroup();
for (let lat = -60; lat <= 60; lat += 30)
  L.polyline([[lat, -180], [lat, 180]], { color: "#fff", weight: 0.5, opacity: 0.25, interactive: false }).addTo(graticule);
for (let lon = -150; lon <= 180; lon += 30)
  L.polyline([[-90, lon], [90, lon]], { color: "#fff", weight: 0.5, opacity: 0.25, interactive: false }).addTo(graticule);

const sitesLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const demLayer = L.layerGroup().addTo(map);
L.control.layers(baseLayers, { ...hiresLayers, "Sites": sitesLayer, "High-res terrain area": demLayer, "Lat/Lon grid": graticule, "Route": routeLayer },
  { position: "topleft" }).addTo(map);
L.control.scale({ imperial: false }).addTo(map); // note: scale assumes Earth radius — see README

// ---------- high-res terrain coverage ----------
fetch("/api/dem").then((r) => r.json()).then((dems) => {
  for (const d of dems.filter((d) => d.name !== "mola")) {
    const [s, w, n, e] = d.bounds;
    L.rectangle([[s, w], [n, e]], { color: "#6cc68a", weight: 1.5, dashArray: "6 6", fill: false, interactive: false })
      .bindTooltip(`${d.label} — detailed slopes inside this box`, { sticky: true }).addTo(demLayer);
  }
});

// ---------- sites ----------
fetch("/api/sites").then((r) => r.json()).then(({ sites }) => {
  const sel = $("site-select");
  for (const s of sites) {
    const color = s.type === "lander" ? "#5ec4d6" : "#e8b04b";
    const mk = L.circleMarker([s.lat, s.lon], { radius: 6, color, weight: 2, fillOpacity: 0.35 })
      .on("click", () => updateConditions(s.lat, s.lon, s.name))
      .addTo(sitesLayer);
    mk.bindPopup(() => {
      const box = document.createElement("div");
      box.className = "place-pop";
      box.innerHTML = `<div class="pn">${s.name}</div><div class="pm">${s.region}${s.mission ? ` · ${s.mission} (${s.year})` : ""}` +
        `${s.why ? `<br>${s.why}` : ""}<br>${s.lat.toFixed(4)}°, ${s.lon.toFixed(4)}°E</div>`;
      box.appendChild(Dir.actions([s.lat, s.lon], s.name, { close: () => mk.closePopup() }));
      if (typeof GroundView !== "undefined") box.appendChild(GroundView.button(s.lat, s.lon, s.name));
      return box;
    });
    const o = document.createElement("option");
    o.value = s.id; o.textContent = `${s.type === "lander" ? "●" : "◆"} ${s.name}`;
    o.dataset.lat = s.lat; o.dataset.lon = s.lon;
    sel.appendChild(o);
  }
  sel.onchange = () => {
    const o = sel.selectedOptions[0];
    if (!o.value) return;
    map.flyTo([+o.dataset.lat, +o.dataset.lon], 8);
    updateConditions(+o.dataset.lat, +o.dataset.lon, o.textContent.slice(2));
  };
  // until a site, a position or a route is chosen, conditions follow the centre of the map
  const followCentre = () => {
    if (me || (condTarget && condTarget.label !== "Map centre")) return;
    const c = map.getCenter();
    updateConditions(c.lat, c.lng, "Map centre");
  };
  map.on("moveend", followCentre);
  followCentre();
});

// ---------- cursor readout ----------
let readoutTimer;
map.on("mousemove", (e) => {
  const { lat, lng } = e.latlng;
  $("readout").textContent = `${lat.toFixed(4)}°, ${lng.toFixed(4)}°E`;
  clearTimeout(readoutTimer);
  readoutTimer = setTimeout(async () => {
    const r = await fetch(`/api/elevation?lat=${lat}&lon=${lng}`);
    if (r.ok) { const d = await r.json(); $("readout").textContent = `${lat.toFixed(4)}°, ${lng.toFixed(4)}°E · ${Math.round(d.elev_m)} m · ${d.source}`; }
  }, 120);
});

// ---------- route planner ----------
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MARS_HOUR = 1.0274912517; // Earth hours in one Mars "hour" (1/24 sol); walk times are Earth hours
const ROUTE = "#4f8cff", AMBER = "#f9ab00", RED = "#ea4335";
let drawing = false, waypoints = [], wpNames = [], lastProfile = null, lastLabels = [], lastNames = [], chart = null, analyseToken = 0;
const highlightLayer = L.layerGroup().addTo(map);
const hoverDot = L.circleMarker([0, 0], { radius: 7, color: "#fff", weight: 2, fillColor: ROUTE, fillOpacity: 1, interactive: false });

const letter = (i) => LETTERS[i] || `#${i + 1}`;
const fmtDur = (h) => { const m = Math.round(h * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
const clock = (h) => `${MarsTime.hhmm(h)}${h >= 24 ? ` (+${Math.floor(h / 24)} sol)` : ""}`;
const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km`);
const WORDS = { N: "north", E: "east", S: "south", W: "west" };
const compassWord = (c) => c.length === 1 ? WORDS[c]
  : c.length === 2 ? WORDS[c[0]] + WORDS[c[1]]
  : `${WORDS[c[0]]}-${WORDS[c[1]]}${WORDS[c[2]]}`;
const TURN_ICON = { "Head": "↑", "Continue straight": "↑", "Bear right": "↗", "Bear left": "↖",
  "Turn right": "→", "Turn left": "←", "Sharp right": "↘", "Sharp left": "↙", "Turn around": "↩" };

function pinIcon(label, kind) {
  const fill = kind === "start" ? "#34a853" : kind === "end" ? RED : "#ffffff";
  const ink = kind === "mid" ? "#111" : "#fff";
  return L.divIcon({
    className: "pin", iconSize: [28, 38], iconAnchor: [14, 37],
    html: `<svg width="28" height="38" viewBox="0 0 28 38"><path d="M14 37S2 22.5 2 14a12 12 0 0 1 24 0c0 8.5-12 23-12 23z" fill="${fill}" stroke="#111" stroke-width="1.5"/><text x="14" y="18.5" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="12" font-weight="700" fill="${ink}">${label}</text></svg>`,
  });
}

// sun helpers (use today's solar declination)
const D2R = Math.PI / 180;
function sunElevation(lat, ltst) {
  const { decl } = MarsTime.compute();
  const s = Math.sin(lat * D2R) * Math.sin(decl * D2R) +
    Math.cos(lat * D2R) * Math.cos(decl * D2R) * Math.cos((ltst - 12) * 15 * D2R);
  return Math.asin(s) / D2R;
}
function daylight(lat) {
  const { decl } = MarsTime.compute();
  const c = -Math.tan(lat * D2R) * Math.tan(decl * D2R);
  if (c <= -1) return { rise: 0, set: 24 };
  if (c >= 1) return null;
  const h = Math.acos(c) / D2R / 15;
  return { rise: 12 - h, set: 12 + h };
}

// ---------- drawing mode ----------
const banner = document.createElement("div");
banner.className = "draw-banner";
banner.hidden = true;
map.getContainer().appendChild(banner);
const updateBanner = () => { banner.textContent = `Click the map to place stop ${letter(waypoints.length)} · Esc or ✓ Done to finish`; };

function setDrawing(on) {
  drawing = on;
  $("draw").classList.toggle("active", on);
  $("draw").textContent = on ? "✓ Done" : "✚ Add stops";
  map.getContainer().style.cursor = on ? "crosshair" : "";
  banner.hidden = !on;
  updateBanner();
  if (!on && waypoints.length > 1) map.fitBounds(L.latLngBounds(waypoints).pad(0.3), { maxZoom: 15 });
}
$("draw").onclick = () => setDrawing(!drawing);
$("undo").onclick = () => { waypoints.pop(); wpNames.length = waypoints.length; redrawRoute(); };
$("clear").onclick = () => { waypoints = []; wpNames = []; setDrawing(false); redrawRoute(); if (typeof Dir !== "undefined") Dir.clear(); };
$("export").onclick = exportGeoJSON;
$("roundtrip").onchange = () => redrawRoute();
$("depart").oninput = () => lastProfile && renderPanel(lastProfile, lastLabels);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (drawing) setDrawing(false);
  if (picking) $("pick-me").click();
});
map.on("click", (e) => {
  if (!drawing) return;
  waypoints.push([e.latlng.lat, e.latlng.lng]);
  wpNames.push(null);
  updateBanner();
  redrawRoute();
});

function drawPins() {
  waypoints.forEach((p, i) => {
    const kind = i === 0 ? "start" : i === waypoints.length - 1 && waypoints.length > 1 ? "end" : "mid";
    const m = L.marker(p, { draggable: true, icon: pinIcon(letter(i), kind), zIndexOffset: 1000 });
    m.on("dragend", () => { const ll = m.getLatLng(); waypoints[i] = [ll.lat, ll.lng]; wpNames[i] = null; redrawRoute(); });
    m.addTo(routeLayer);
  });
}

function redrawRoute() {
  wpNames.length = waypoints.length;
  if (typeof Dir !== "undefined") Dir.render();
  routeLayer.clearLayers();
  highlightLayer.clearLayers();
  drawPins();
  if (waypoints.length < 2) {
    lastProfile = null;
    $("howto").hidden = false;
    $("summary").hidden = true;
    $("directions").innerHTML = "";
    $("profile-wrap").hidden = true;
    return;
  }
  // provisional straight line until the terrain-aware route comes back
  L.polyline(waypoints, { color: ROUTE, weight: 3, dashArray: "2 8", opacity: 0.8 }).addTo(routeLayer);
  analyse();
}

async function analyse() {
  const token = ++analyseToken;
  const n = waypoints.length;
  const round = $("roundtrip").checked;
  const pts = round ? [...waypoints, ...waypoints.slice(0, -1).reverse()] : [...waypoints];
  const labels = pts.map((_, j) => (j < n ? letter(j) : letter(n - 2 - (j - n))));
  const names = pts.map((_, j) => stopName(j < n ? j : n - 2 - (j - n)));
  const r = await fetch("/api/profile", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ waypoints: pts, step_m: 50 }),
  });
  if (token !== analyseToken) return; // a newer edit superseded this request
  if (!r.ok) { $("directions").textContent = "Elevation data unavailable — run scripts/fetch_data.py"; return; }
  const p = await r.json();
  lastProfile = p; lastLabels = labels; lastNames = names;
  drawRoute(p, n - 1);
  renderPanel(p, labels);
  drawProfile(p, labels);
  if (!Nav.active) {
    showTab("route");
    requestAnimationFrame(() => $("summary").scrollIntoView({ block: "start", behavior: "smooth" }));
  }
  const end = waypoints[n - 1];
  updateConditions(end[0], end[1], `${letter(n - 1)}: ${stopName(n - 1)}`);
}

// ---------- map rendering ----------
function drawRoute(p, outboundLegs) {
  routeLayer.clearLayers();
  const S = p.samples.filter((s) => s.leg < outboundLegs);
  const ll = S.map((s) => [s.lat, s.lon]);
  L.polyline(ll, { color: "#0b1a33", weight: 11, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(routeLayer);
  L.polyline(ll, { color: ROUTE, weight: 6, lineCap: "round", lineJoin: "round", interactive: false }).addTo(routeLayer);
  for (let i = 1; i < S.length; i++) {
    const sl = S[i].slope_deg;
    if (sl <= 8) continue;
    L.polyline([ll[i - 1], ll[i]], { color: sl > 15 ? RED : AMBER, weight: 6, lineCap: "round", interactive: false }).addTo(routeLayer);
  }
  for (const h of p.hazards.filter((h) => h.leg < outboundLegs)) {
    L.circleMarker([h.lat, h.lon], { radius: 6, color: "#fff", weight: 2, fillColor: RED, fillOpacity: 1 })
      .bindTooltip(`⚠ ${h.slope_deg}° slope`).addTo(routeLayer);
  }
  for (const leg of p.legs.slice(0, outboundLegs)) {
    const mid = p.samples[Math.round((leg.from_idx + leg.to_idx) / 2)];
    L.circleMarker([mid.lat, mid.lon], { radius: 1, opacity: 0, fillOpacity: 0, interactive: false })
      .bindTooltip(`${fmtKm(leg.distance_km)} · ${fmtDur(leg.walk_hours / Suit.pace())}`, { permanent: true, direction: "center", className: "leg-label" })
      .addTo(routeLayer);
  }
  drawPins();
}

function highlightLeg(leg) {
  highlightLayer.clearLayers();
  const ll = lastProfile.samples.slice(leg.from_idx, leg.to_idx + 1).map((s) => [s.lat, s.lon]);
  L.polyline(ll, { color: "#fff", weight: 14, opacity: 0.35, lineCap: "round", interactive: false }).addTo(highlightLayer);
  map.fitBounds(L.latLngBounds(ll).pad(0.3), { maxZoom: 13 });
}

// ---------- side panel ----------
const stopName = (i) => (wpNames[i] || (waypoints[i] ? fmtLatLon(waypoints[i][0], waypoints[i][1]) : ""));

function renderPanel(p, labels) {
  const s = p.stats;
  const names = lastNames;
  const [hh, mm] = ($("depart").value || "09:00").split(":").map(Number);
  const dep = hh + mm / 60;
  const tl = Suit.timeline(p);                 // walking time + consumables at every sample
  const have = Suit.available();
  const bud = Suit.budget(Suit.needsOf(tl), have);
  const lim = bud.limiting;
  const reservePct = Suit.state.reservePct;
  const finish = dep + tl.hours / MARS_HOUR;
  const day = daylight(waypoints[0][0]);
  const round = $("roundtrip").checked;
  const steep = p.legs.filter((l) => l.max_slope_deg > 8).length;
  const pctLeft = (key, i) => Math.max(0, Math.round(((have[key] - tl[key][i]) / (key === "co2" ? 8 : Suit.CAP[{ o2: "o2Kg", battery: "batteryWh", water: "waterKg" }[key]])) * 100));

  let verdict, cls;
  if (!bud.ok) {
    cls = "no"; verdict = `✗ Not enough ${lim.name.toLowerCase()}: this walk needs ${lim.fmt(lim.need)} but only ${lim.fmt(lim.usable)} is usable after the ${reservePct}% reserve. Shorten the route, refill, or plan a rover leg.`;
  } else if (!day) {
    cls = "no"; verdict = "✗ Polar night at this latitude right now — no daylight for an EVA.";
  } else if (finish > day.set) {
    cls = "no"; verdict = `✗ You'd finish at ${clock(finish)}, after sunset (${MarsTime.hhmm(day.set)}). Leave earlier or shorten the route.`;
  } else if (dep < day.rise) {
    cls = "warn"; verdict = `⚠ Departure is before sunrise (${MarsTime.hhmm(day.rise)}). Start later for light and warmth.`;
  } else if (p.hazards.length || steep) {
    cls = "warn"; verdict = `⚠ Supplies are fine, but ${p.hazards.length ? `${p.hazards.length} stretch(es) are steeper than 15°` : `${steep} leg(s) have moderate slopes`}. Check the highlighted sections.`;
  } else {
    cls = "ok"; verdict = `✓ Safe single EVA — back by ${clock(finish)}. Tightest supply: ${lim.name.toLowerCase()}, ${Math.round((1 - lim.frac) * 100)}% left at the end.`;
  }
  if (Suit.state.heartRate > 160) verdict += `<br>♥ Heart rate ${Suit.state.heartRate} bpm is high — rest before setting out.`;

  $("howto").hidden = true;
  $("summary").hidden = false;
  const bars = bud.items.map((it) => {
    const usedPct = Math.min(100, it.frac * 100), haveVsFull = it.avail;
    const color = !it.ok ? RED : it === lim ? AMBER : ROUTE;
    return `<div class="res-row${it === lim ? " lim" : ""}">
      <span class="res-name">${it.name}</span>
      <div class="res-bar" title="${it.name}: walk needs ${it.fmt(it.need)} of ${it.fmt(haveVsFull)} in the suit">
        <div class="used" style="width:${usedPct}%;background:${color}"></div>
        <div class="keep" style="left:${100 - reservePct}%"></div></div>
      <span class="res-val">${it.avail > 0 ? `${Math.round(it.frac * 100)}%` : "empty"}</span></div>`;
  }).join("");
  $("summary").innerHTML = `
    <div class="big">${fmtDur(tl.hours)}<small>${fmtKm(s.distance_km)}${round ? " round trip" : ""}</small></div>
    <div class="sub">${names[0]} → ${names[waypoints.length - 1]}${round ? " and back" : ""}</div>
    <div class="sub">↑ ${s.ascent_m} m climb · ↓ ${s.descent_m} m descent · max slope ${s.max_slope_deg}°</div>
    <div class="sub">Depart ${MarsTime.hhmm(dep)} → finish ≈ ${clock(finish)} local solar time${day ? ` · daylight ${MarsTime.hhmm(day.rise)}–${MarsTime.hhmm(day.set)}` : ""}</div>
    <div class="res">
      <div class="res-head"><span>Share of what's in the suit this walk uses</span><span>reserve ${reservePct}%</span></div>
      ${bars}
      <div class="res-foot">Effort ≈ ${Math.round(tl.avgW)} W average, ${Math.round(tl.peakW)} W peak · pace: ${Suit.state.condition} · carrying ${Suit.state.loadKg} kg</div>
    </div>
    <div class="verdict ${cls}">${verdict}</div>
    <div class="row go-row">
      <button id="nav-start" class="go">▶ Start Marswalk — live guidance</button>
      <button id="walk-3d" class="go alt" title="Fly along the route at eye level">⛰ Walk it in 3D</button>
    </div>`;
  $("nav-start").onclick = () => Nav.start();
  $("walk-3d").onclick = () => (typeof GroundView !== "undefined" ? GroundView.walk() : null);

  // turn-by-turn
  const el = $("directions");
  el.innerHTML = "";
  const outbound = waypoints.length - 1;
  const stop = (j, title, meta, extra, kind) => {
    const d = document.createElement("div");
    d.className = `step stop ${kind}`;
    d.innerHTML = `<div class="icon">${labels[j]}</div><div><div class="title">${title}</div><div class="meta">${meta}</div>${extra}
      <button type="button" class="step-view" title="Ground view at ${labels[j]}">👁 Ground view</button></div>`;
    const s0 = j === 0 ? p.samples[0] : p.samples[p.legs[j - 1].to_idx];
    d.onclick = () => { highlightLayer.clearLayers(); map.flyTo([s0.lat, s0.lon], Math.max(map.getZoom(), 14)); };
    d.querySelector(".step-view").onclick = (ev) => { ev.stopPropagation(); GroundView.at(s0.lat, s0.lon, `${labels[j]}: ${names[j]}`); };
    el.appendChild(d);
  };

  const s0 = p.samples[0];
  stop(0, `Start at ${labels[0]}: ${names[0]}`, `Depart ${MarsTime.hhmm(dep)} local solar time · elevation ${Math.round(s0.elev_m)} m · O₂ ${Suit.state.o2Pct}%`,
    day && dep < day.rise ? `<div class="warn">⚠ Sun not up yet (rises ${MarsTime.hhmm(day.rise)})</div>` : "", "start");

  p.legs.forEach((leg, i) => {
    if (round && i === outbound) {
      const div = document.createElement("div");
      div.className = "return-divider";
      div.textContent = "Return to start";
      el.appendChild(div);
    }
    const row = document.createElement("div");
    row.className = "step leg";
    let warn = "";
    if (leg.hazard_points) warn += `<div class="bad">⚠ ${leg.hazard_points} stretch(es) steeper than 15° — find a way around, don't climb straight up.</div>`;
    else if (leg.slope_class === "moderate") warn += `<div class="warn">Moderate slopes up to ${leg.max_slope_deg}° — slow down, watch your footing.</div>`;
    const legH = tl.t[leg.to_idx] - tl.t[leg.from_idx];
    row.innerHTML = `<div class="icon">${TURN_ICON[leg.instruction] || "↑"}</div><div>
      <div class="title">${leg.instruction} ${compassWord(leg.compass)} for ${fmtKm(leg.distance_km)}</div>
      <div class="meta">${leg.terrain}</div>
      <div class="meta">↑ ${leg.ascent_m} m · ↓ ${leg.descent_m} m · about ${fmtDur(legH)} on foot · uses ${((tl.o2[leg.to_idx] - tl.o2[leg.from_idx]) * 1000).toFixed(0)} g O₂</div>${warn}</div>`;
    row.onclick = () => {
      el.querySelectorAll(".step").forEach((x) => x.classList.remove("active"));
      row.classList.add("active");
      highlightLeg(leg);
    };
    el.appendChild(row);

    const j = i + 1;
    const end = p.samples[leg.to_idx];
    const arrive = dep + tl.t[leg.to_idx] / MARS_HOUR;
    const sun = sunElevation(end.lat, arrive);
    const last = j === p.legs.length;
    const title = last ? (round ? `Back at ${labels[j]}: ${names[j]} — EVA complete` : `Arrive at ${labels[j]}: ${names[j]}`)
      : round && j === outbound ? `Reach ${labels[j]}: ${names[j]} — turnaround point` : `Arrive at ${labels[j]}: ${names[j]}`;
    let extra = "";
    for (const it of bud.items) {
      const left = it.avail - tl[it.key][leg.to_idx];
      if (left < 0) { extra += `<div class="bad">✗ ${it.name} runs out before this point.</div>`; break; }
      if (left < it.avail - it.usable) { extra += `<div class="bad">⚠ Into the ${it.name.toLowerCase()} reserve here.</div>`; break; }
    }
    if (sun < 0) extra += `<div class="bad">☾ After sunset — dark and very cold.</div>`;
    else if (sun < 10) extra += `<div class="warn">Sun low (${sun.toFixed(0)}°) — long shadows hide obstacles.</div>`;
    stop(j, title,
      `≈ ${clock(arrive)} local · ${fmtKm(leg.cum_km)} walked · elevation ${Math.round(end.elev_m)} m · O₂ ${pctLeft("o2", leg.to_idx)}% · sun ${sun.toFixed(0)}°`,
      extra, last ? (round ? "start" : "end") : "mid");
  });

  const src = Object.entries(s.dem_sources || {}).map(([k, v]) => `${k} ${v}%`).join(" · ");
  const keys = Object.keys(s.dem_sources || {});
  $("dem-note").textContent = `Terrain: ${src}. ` + (keys.some((k) => k.startsWith("MGS MOLA"))
    ? "Parts of this route only have coarse MOLA heights (3.7 km) — big hills show up, cliffs and boulders may not. "
    : keys.some((k) => k.startsWith("HRSC"))
      ? "200 m terrain: hills and large crater walls show up; small scarps and boulders don't. "
      : "High-resolution terrain: crater walls and scarps are captured; individual boulders are not. ") +
    "Walk times use Tobler's hiking formula slowed for a pressurised suit.";
}

Suit.onChange(() => { if (lastProfile) { renderPanel(lastProfile, lastLabels); drawRoute(lastProfile, waypoints.length - 1); } });

// ---------- elevation profile ----------
function drawProfile(p, labels) {
  $("profile-wrap").hidden = false;
  const samples = p.samples;
  const stops = [0, ...p.legs.map((l) => l.to_idx)];
  const stopsPlugin = {
    id: "stops",
    afterDatasetsDraw(c) {
      const { ctx, chartArea: a, scales: { x } } = c;
      ctx.save();
      stops.forEach((idx, j) => {
        const px = x.getPixelForValue(idx);
        ctx.strokeStyle = "rgba(236,230,225,.35)"; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, a.top + 14); ctx.lineTo(px, a.bottom); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = j === 0 ? "#34a853" : j === stops.length - 1 ? ($("roundtrip").checked ? "#34a853" : RED) : "#ece6e1";
        ctx.beginPath(); ctx.arc(px, a.top + 7, 7, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = j === 0 || j === stops.length - 1 ? "#fff" : "#111";
        ctx.font = "700 9px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(labels[j], px, a.top + 7.5);
      });
      ctx.restore();
    },
  };
  chart?.destroy();
  const cv = $("profile");
  chart = new Chart(cv, {
    type: "line",
    data: {
      labels: samples.map((s) => (s.dist_m / 1000).toFixed(2)),
      datasets: [{
        data: samples.map((s) => s.elev_m), borderWidth: 2.5, fill: true,
        backgroundColor: "rgba(79,140,255,.12)", pointRadius: 0, tension: 0.2,
        segment: { borderColor: (c) => { const sl = samples[c.p1DataIndex].slope_deg; return sl > 15 ? RED : sl > 8 ? AMBER : ROUTE; } },
      }],
    },
    options: {
      animation: false, layout: { padding: { top: 6 } },
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false },
        tooltip: { callbacks: { title: (i) => `${i[0].label} km`, label: (i) => `${Math.round(i.raw)} m · slope ${samples[i.dataIndex].slope_deg}°` } } },
      scales: {
        x: { ticks: { color: "#9a8f88", maxTicksLimit: 6 }, grid: { color: "#2d2522" }, title: { display: true, text: "distance walked (km)", color: "#9a8f88" } },
        y: { ticks: { color: "#9a8f88" }, grid: { color: "#2d2522" }, title: { display: true, text: "elevation (m)", color: "#9a8f88" } },
      },
      onHover: (_, els) => {
        if (!els.length) return;
        const s = samples[els[0].index];
        hoverDot.setLatLng([s.lat, s.lon]).addTo(map);
        $("readout").textContent = `${s.lat.toFixed(4)}°, ${s.lon.toFixed(4)}°E · ${Math.round(s.elev_m)} m · ${s.slope_deg}°`;
      },
    },
    plugins: [stopsPlugin],
  });
  cv.onmouseleave = () => hoverDot.remove();
}

function exportGeoJSON() {
  if (waypoints.length < 2) return;
  const gj = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Marswalk route", body: "Mars", crs: "IAU_2015:49900 (lat, east lon)",
          round_trip: $("roundtrip").checked, depart_ltst: $("depart").value, ...(lastProfile?.stats || {}),
          directions: lastProfile?.legs.map((l) => `${l.instruction} ${compassWord(l.compass)} ${fmtKm(l.distance_km)} — ${l.terrain}`) },
        geometry: { type: "LineString", coordinates: waypoints.map(([la, lo]) => [lo, la]) },
      },
      ...waypoints.map(([la, lo], i) => ({
        type: "Feature", properties: { stop: letter(i) }, geometry: { type: "Point", coordinates: [lo, la] },
      })),
    ],
  };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(gj, null, 2)], { type: "application/geo+json" }));
  a.download = "marswalk_route.geojson";
  a.click();
}

// ---------- your position ----------
// Mars has no GPS: the astronaut's position comes from a place name, coordinates from the
// lander/rover navigation fix, or a spot picked on the map.
let me = null, picking = false;
const meLayer = L.layerGroup().addTo(map);
const searchLayer = L.layerGroup().addTo(map);
const ME_KEY = "martianmap.me";

function parseCoords(s) {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = +m[1], lon = +m[3];
  if (m[2] && m[2].toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4] && m[4].toUpperCase() === "W") lon = -Math.abs(lon);
  if (lon > 180) lon -= 360; // accept 0–360°E
  if (Math.abs(lat) > 90 || lon < -180 || lon > 180) return null;
  return [lat, lon];
}
const fmtLatLon = (lat, lon) => `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}`;
// zoom so a feature of this size fills roughly the map view
const zoomFor = (km) => Math.max(3, Math.min(14, Math.round(Math.log2(351.6 / (Math.max(km, 3) / 59.16)))));

async function whereis(lat, lon) {
  try { const r = await fetch(`/api/whereis?lat=${lat}&lon=${lon}`); return r.ok ? r.json() : null; } catch { return null; }
}

// ----- set / show my position -----
async function setMe(lat, lon, { fly = true, save = true } = {}) {
  me = [lat, lon];
  if (typeof Nav !== "undefined" && Nav.active) Nav.fix(lat, lon, 15, "position"); // a new nav fix during a Marswalk
  meLayer.clearLayers();
  L.marker(me, { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 2000, keyboard: false })
    .bindTooltip("You are here", { direction: "top", offset: [0, -10] }).addTo(meLayer);
  $("start-here").disabled = $("center-me").disabled = false;
  if (fly) map.flyTo(me, Math.max(map.getZoom(), 12));
  if (save) { try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch {} }
  $("me-card").className = "me-card set";
  $("me-card").innerHTML = `<div class="where">Locating…</div><div class="muted">${fmtLatLon(lat, lon)}</div>`;
  updateConditions(lat, lon, "Your position");
  const w = await whereis(lat, lon);
  if (!w || me[0] !== lat || me[1] !== lon) return;
  $("me-card").innerHTML = `<div class="where">${w.summary}</div>
    <div class="muted">${fmtLatLon(lat, lon)}${w.elev_m !== undefined ? ` · ${Math.round(w.elev_m)} m` : ""}</div>
    ${w.elev_source ? `<div class="muted">Terrain data: ${w.elev_source}</div>` : ""}
    <button type="button" class="me-view">👁 Ground view from here</button>`;
  $("me-card").querySelector(".me-view").onclick = () => GroundView.at(lat, lon, "Your position");
}

$("pick-me").onclick = () => {
  picking = !picking;
  if (picking && drawing) setDrawing(false);
  $("pick-me").classList.toggle("active", picking);
  map.getContainer().style.cursor = picking ? "crosshair" : "";
  banner.hidden = !picking;
  banner.textContent = "Click the map where you are";
};
map.on("click", (e) => {
  if (!picking) return;
  picking = false;
  $("pick-me").classList.remove("active");
  map.getContainer().style.cursor = "";
  banner.hidden = true;
  setMe(e.latlng.lat, e.latlng.lng, { fly: false });
});
$("center-me").onclick = () => me && map.flyTo(me, Math.max(map.getZoom(), 12));
$("start-here").onclick = () => {
  if (!me) return;
  showTab("route");
  Dir.setFrom([...me], "Your position"); // then choose where to go
};

function routeFromMe(lat, lon, name = null) {
  if (!me) return;
  waypoints = [[...me]]; wpNames = ["Your position"];
  Dir.setTo([lat, lon], name);
}

// ----- place card (search result, typed coordinates, or right-click) -----
async function showPlace(lat, lon, title, meta, zoom) {
  searchLayer.clearLayers();
  const pin = L.marker([lat, lon], { icon: pinIcon("", "end"), zIndexOffset: 1500 }).addTo(searchLayer);
  const box = document.createElement("div");
  box.className = "place-pop";
  box.innerHTML = `<div class="pn">${title}</div><div class="pm">${meta || ""}${meta ? "<br>" : ""}${fmtLatLon(lat, lon)}<span class="pw"></span></div>`;
  const btn = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => { map.closePopup(); fn(); }; box.appendChild(b); };
  btn("📍 I'm here", () => { searchLayer.clearLayers(); setMe(lat, lon, { fly: false }); });
  const placeName = title === "Dropped pin" || title === "Coordinates" ? null : title;
  box.appendChild(Dir.actions([lat, lon], placeName, { close: () => { map.closePopup(); searchLayer.clearLayers(); } }));
  box.appendChild(GroundView.button(lat, lon, placeName || "Dropped pin"));
  pin.bindPopup(box, { className: "", maxWidth: 260 });
  if (zoom !== undefined) map.flyTo([lat, lon], zoom);
  pin.openPopup();
  const w = await whereis(lat, lon);
  const el = box.querySelector(".pw");
  if (w && el) el.innerHTML = `<br>${w.summary}${w.elev_m !== undefined ? ` · ${Math.round(w.elev_m)} m` : ""}`;
}
map.on("contextmenu", (e) => showPlace(e.latlng.lat, e.latlng.lng, "Dropped pin", ""));

// ----- search box -----
let searchTimer, results = [], sel = -1;
const resultsEl = $("place-results");
function renderResults() {
  resultsEl.innerHTML = "";
  resultsEl.hidden = !results.length;
  results.forEach((r, i) => {
    const d = document.createElement("div");
    d.className = "result" + (i === sel ? " sel" : "");
    d.innerHTML = `<div class="rn">${r.label}</div><div class="rm">${r.meta}</div>`;
    d.onmousedown = (ev) => { ev.preventDefault(); choose(r); };
    resultsEl.appendChild(d);
  });
}
function choose(r) {
  results = []; renderResults();
  $("place-q").value = r.label.startsWith("Go to ") ? r.label.slice(6) : r.label;
  $("place-q").blur();
  showPlace(r.lat, r.lon, r.label.startsWith("Go to ") ? "Coordinates" : r.label, r.card, r.zoom);
}
$("place-q").addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = $("place-q").value;
  const c = parseCoords(q);
  if (c) {
    results = [{ label: `Go to ${fmtLatLon(...c)}`, meta: "Coordinates (planetocentric, east-positive)", card: "", lat: c[0], lon: c[1], zoom: 12 }];
    sel = 0; return renderResults();
  }
  if (q.trim().length < 2) { results = []; return renderResults(); }
  searchTimer = setTimeout(async () => {
    const r = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
    if (!r.ok || $("place-q").value !== q) return;
    results = (await r.json()).map((f) => ({
      label: f.name, lat: f.lat, lon: f.lon, zoom: zoomFor(f.diameter_km),
      card: `${f.kind[0].toUpperCase() + f.kind.slice(1)}${f.diameter_km ? ` · ${f.diameter_km.toFixed(0)} km across` : ""}`,
      meta: `${f.kind[0].toUpperCase() + f.kind.slice(1)}${f.diameter_km ? ` · ${f.diameter_km.toFixed(0)} km` : ""} · ${fmtLatLon(f.lat, f.lon)}`,
    }));
    sel = results.length ? 0 : -1;
    renderResults();
  }, 150);
});
$("place-q").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { sel = Math.min(results.length - 1, sel + 1); renderResults(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); renderResults(); e.preventDefault(); }
  else if (e.key === "Enter" && results[sel]) { choose(results[sel]); e.preventDefault(); }
  else if (e.key === "Escape") { results = []; renderResults(); }
});
$("place-q").addEventListener("blur", () => setTimeout(() => { results = []; renderResults(); }, 100));


// ---------- Mars clock & conditions ----------
let condTarget = null;
function updateConditions(lat, lon, label) { condTarget = { lat, lon, label }; renderConditions(); }

function renderConditions() {
  const t = MarsTime.compute();
  $("clock").innerHTML = `Mars Sol Date <b>${t.msd.toFixed(2)}</b> · MTC <b>${MarsTime.hhmm(t.mtc)}</b> · Ls <b>${t.Ls.toFixed(1)}°</b> · MY <b>${t.marsYear}</b>`;
  if (!condTarget) return;
  const { lat, lon, label } = condTarget;
  const loc = MarsTime.local(t, lat, lon);
  const cosH0 = -Math.tan((lat * Math.PI) / 180) * Math.tan((t.decl * Math.PI) / 180);
  let daylight;
  if (cosH0 <= -1) daylight = "24 h (polar day)";
  else if (cosH0 >= 1) daylight = "0 h (polar night)";
  else {
    const h = (Math.acos(cosH0) * 180) / Math.PI / 15;
    daylight = `${MarsTime.hhmm(12 - h)} – ${MarsTime.hhmm(12 + h)} LTST`;
  }
  $("conditions").innerHTML = [
    ["Location", `<span style="font-size:13px">${label}</span>`],
    ["Local true solar time", MarsTime.hhmm(loc.ltst)],
    ["Sun elevation", `${loc.sunElevation.toFixed(1)}° ${loc.sunElevation > 0 ? "☀" : "☾"}`],
    ["Season (hemisphere)", MarsTime.season(t.Ls, lat)],
    ["Daylight window", `<span style="font-size:13px">${daylight}</span>`],
    ["Elevation", `<span id="cond-elev">…</span>`],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  fetch(`/api/elevation?lat=${lat}&lon=${lon}`).then((r) => r.ok && r.json()).then((d) => {
    if (d && $("cond-elev")) $("cond-elev").textContent = `${Math.round(d.elev_m)} m`;
  });
}
setInterval(renderConditions, 30000);
renderConditions();

// restore last position (runs last: setMe needs the conditions panel above)
try {
  const saved = JSON.parse(localStorage.getItem(ME_KEY) || "null");
  if (Array.isArray(saved) && saved.length === 2) {
    setMe(saved[0], saved[1], { fly: false, save: false });
    map.setView(saved, 11, { animate: false });
  }
} catch {}
