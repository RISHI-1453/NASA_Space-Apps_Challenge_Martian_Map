// Martian Map frontend
const $ = (id) => document.getElementById(id);
const TREK = "https://trek.nasa.gov/tiles/Mars/EQ";
const trek = (layer, ext, maxNativeZoom, extra = {}) =>
  L.tileLayer(`${TREK}/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`, {
    tileSize: 256, maxNativeZoom, maxZoom: 18, noWrap: true,
    attribution: "NASA/JPL-Caltech · Mars Trek", ...extra,
  });

// ---------- map ----------
const map = L.map("map", {
  crs: L.CRS.EPSG4326, center: [18.4447, 77.4508], zoom: 9, minZoom: 1, maxZoom: 18,
  maxBounds: [[-90, -180], [90, 180]], worldCopyJump: false,
});

// Global basemaps (pick one)
const baseLayers = {
  "Viking color mosaic · 232 m": trek("Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg", 7),
  "THEMIS day infrared · 100 m": trek("THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", "png", 9),
  "MOLA color elevation · 463 m": trek("Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg", 6),
};
baseLayers["THEMIS day infrared · 100 m"].addTo(map);

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
    L.circleMarker([s.lat, s.lon], { radius: 6, color, weight: 2, fillOpacity: 0.35 })
      .bindPopup(`<b>${s.name}</b><br>${s.region}${s.mission ? ` · ${s.mission} (${s.year})` : ""}` +
        `${s.why ? `<br><span style="color:#9a8f88">${s.why}</span>` : ""}` +
        `<br><small>${s.lat.toFixed(4)}°, ${s.lon.toFixed(4)}°E</small>`)
      .on("click", () => updateConditions(s.lat, s.lon, s.name))
      .addTo(sitesLayer);
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
  updateConditions(18.4447, 77.4508, "Perseverance - Octavia E. Butler Landing");
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
let drawing = false, waypoints = [], lastProfile = null, lastLabels = [], chart = null, analyseToken = 0;
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
$("undo").onclick = () => { waypoints.pop(); redrawRoute(); };
$("clear").onclick = () => { waypoints = []; setDrawing(false); redrawRoute(); };
$("export").onclick = exportGeoJSON;
$("roundtrip").onchange = () => redrawRoute();
$("depart").oninput = () => lastProfile && renderPanel(lastProfile, lastLabels);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawing) setDrawing(false); });
map.on("click", (e) => {
  if (!drawing) return;
  waypoints.push([e.latlng.lat, e.latlng.lng]);
  updateBanner();
  redrawRoute();
});

function drawPins() {
  waypoints.forEach((p, i) => {
    const kind = i === 0 ? "start" : i === waypoints.length - 1 && waypoints.length > 1 ? "end" : "mid";
    const m = L.marker(p, { draggable: true, icon: pinIcon(letter(i), kind), zIndexOffset: 1000 });
    m.on("dragend", () => { const ll = m.getLatLng(); waypoints[i] = [ll.lat, ll.lng]; redrawRoute(); });
    m.addTo(routeLayer);
  });
}

function redrawRoute() {
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
  const r = await fetch("/api/profile", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ waypoints: pts, step_m: 50 }),
  });
  if (token !== analyseToken) return; // a newer edit superseded this request
  if (!r.ok) { $("directions").textContent = "Elevation data unavailable — run scripts/fetch_data.py"; return; }
  const p = await r.json();
  lastProfile = p; lastLabels = labels;
  drawRoute(p, n - 1);
  renderPanel(p, labels);
  drawProfile(p, labels);
  const end = waypoints[n - 1];
  updateConditions(end[0], end[1], `Stop ${letter(n - 1)} (destination)`);
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
      .bindTooltip(`${fmtKm(leg.distance_km)} · ${fmtDur(leg.walk_hours)}`, { permanent: true, direction: "center", className: "leg-label" })
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
function renderPanel(p, labels) {
  const s = p.stats;
  const [hh, mm] = ($("depart").value || "09:00").split(":").map(Number);
  const dep = hh + mm / 60;
  const finish = dep + s.walk_hours / MARS_HOUR;
  const startLat = waypoints[0][0];
  const day = daylight(startLat);
  const reserve = s.o2_budget_hours - s.o2_usable_hours;
  const round = $("roundtrip").checked;
  const steep = p.legs.filter((l) => l.max_slope_deg > 8).length;

  let verdict, cls;
  if (s.walk_hours > s.o2_usable_hours) {
    cls = "no"; verdict = `✗ Too long for one EVA — ${fmtDur(s.walk_hours)} of walking but only ${s.o2_usable_hours} h of usable O₂. Remove a stop or plan a rover leg.`;
  } else if (!day) {
    cls = "no"; verdict = "✗ Polar night at this latitude right now — no daylight for an EVA.";
  } else if (finish > day.set) {
    cls = "no"; verdict = `✗ You'd finish at ${clock(finish)}, after sunset (${MarsTime.hhmm(day.set)}). Leave earlier or shorten the route.`;
  } else if (dep < day.rise) {
    cls = "warn"; verdict = `⚠ Departure is before sunrise (${MarsTime.hhmm(day.rise)}). Start later for light and warmth.`;
  } else if (p.hazards.length || steep) {
    cls = "warn"; verdict = `⚠ Doable in one EVA, but ${p.hazards.length ? `${p.hazards.length} stretch(es) are steeper than 15°` : `${steep} leg(s) have moderate slopes`}. Check the highlighted sections.`;
  } else {
    cls = "ok"; verdict = `✓ Safe single EVA — back by ${MarsTime.hhmm(finish)} local time with ${(s.o2_budget_hours - s.walk_hours).toFixed(1)} h of O₂ to spare.`;
  }

  $("howto").hidden = true;
  $("summary").hidden = false;
  const usedPct = Math.min(100, (s.walk_hours / s.o2_budget_hours) * 100);
  $("summary").innerHTML = `
    <div class="big">${fmtDur(s.walk_hours)}<small>${fmtKm(s.distance_km)}${round ? " round trip" : ""}</small></div>
    <div class="sub">↑ ${s.ascent_m} m climb · ↓ ${s.descent_m} m descent · max slope ${s.max_slope_deg}°</div>
    <div class="sub">Depart ${MarsTime.hhmm(dep)} → finish ≈ ${clock(finish)} local solar time${day ? ` · daylight ${MarsTime.hhmm(day.rise)}–${MarsTime.hhmm(day.set)}` : ""}</div>
    <div class="o2">
      <div class="o2-bar"><div class="used" style="width:${usedPct}%;background:${s.walk_hours > s.o2_usable_hours ? RED : ROUTE}"></div><div class="reserve" style="width:${(reserve / s.o2_budget_hours) * 100}%"></div></div>
      <div class="o2-legend"><span>O₂ used ${s.walk_hours.toFixed(1)} h</span><span>usable ${s.o2_usable_hours} h · reserve ${reserve.toFixed(1)} h</span></div>
    </div>
    <div class="verdict ${cls}">${verdict}</div>`;

  // turn-by-turn
  const el = $("directions");
  el.innerHTML = "";
  const outbound = waypoints.length - 1;
  const stop = (j, title, meta, extra, kind) => {
    const d = document.createElement("div");
    d.className = `step stop ${kind}`;
    d.innerHTML = `<div class="icon">${labels[j]}</div><div><div class="title">${title}</div><div class="meta">${meta}</div>${extra}</div>`;
    const s0 = j === 0 ? p.samples[0] : p.samples[p.legs[j - 1].to_idx];
    d.onclick = () => { highlightLayer.clearLayers(); map.flyTo([s0.lat, s0.lon], Math.max(map.getZoom(), 14)); };
    el.appendChild(d);
  };

  const s0 = p.samples[0];
  stop(0, `Start at ${labels[0]}`, `Depart ${MarsTime.hhmm(dep)} local solar time · elevation ${Math.round(s0.elev_m)} m · O₂ ${s.o2_budget_hours} h`,
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
    row.innerHTML = `<div class="icon">${TURN_ICON[leg.instruction] || "↑"}</div><div>
      <div class="title">${leg.instruction} ${compassWord(leg.compass)} for ${fmtKm(leg.distance_km)}</div>
      <div class="meta">${leg.terrain}</div>
      <div class="meta">↑ ${leg.ascent_m} m · ↓ ${leg.descent_m} m · about ${fmtDur(leg.walk_hours)} on foot</div>${warn}</div>`;
    row.onclick = () => {
      el.querySelectorAll(".step").forEach((x) => x.classList.remove("active"));
      row.classList.add("active");
      highlightLeg(leg);
    };
    el.appendChild(row);

    const j = i + 1;
    const end = p.samples[leg.to_idx];
    const arrive = dep + leg.cum_hours / MARS_HOUR;
    const o2Left = s.o2_budget_hours - leg.cum_hours;
    const sun = sunElevation(end.lat, arrive);
    const last = j === p.legs.length;
    const title = last ? (round ? `Back at ${labels[j]} — EVA complete` : `Arrive at ${labels[j]} — destination`)
      : round && j === outbound ? `Reach ${labels[j]} — turnaround point` : `Arrive at ${labels[j]}`;
    let extra = "";
    if (o2Left < 0) extra += `<div class="bad">✗ Out of O₂ before reaching this point.</div>`;
    else if (o2Left < reserve) extra += `<div class="bad">⚠ Into the O₂ reserve (${o2Left.toFixed(1)} h left).</div>`;
    if (sun < 0) extra += `<div class="bad">☾ After sunset — dark and very cold.</div>`;
    else if (sun < 10) extra += `<div class="warn">Sun low (${sun.toFixed(0)}°) — long shadows hide obstacles.</div>`;
    stop(j, title,
      `≈ ${clock(arrive)} local · ${fmtKm(leg.cum_km)} walked · elevation ${Math.round(end.elev_m)} m · O₂ left ${Math.max(0, o2Left).toFixed(1)} h · sun ${sun.toFixed(0)}°`,
      extra, last ? (round ? "start" : "end") : "mid");
  });

  const src = Object.entries(s.dem_sources || {}).map(([k, v]) => `${k} ${v}%`).join(" · ");
  const coarse = Object.keys(s.dem_sources || {}).some((k) => k.startsWith("MGS MOLA"));
  $("dem-note").textContent = `Terrain: ${src}. ` + (coarse
    ? "Parts of this route only have coarse MOLA heights — big hills show up, cliffs and boulders may not. "
    : "High-resolution terrain: crater walls and scarps are captured; individual boulders are not. ") +
    "Walk times use Tobler's hiking formula slowed for a pressurised suit.";
}

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
