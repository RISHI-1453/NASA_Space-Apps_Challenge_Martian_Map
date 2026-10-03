// Live Marswalk guidance: "am I on the right path?"
//
// Mars has no GPS. During an EVA the astronaut's position comes from the suit/rover navigation
// fix (radio ranging to the lander, visual odometry, IMU). This module accepts fixes from:
//   - Manual: tap the map at the fix, or type coordinates ("Your position" → I'm here)
//   - Simulate: walks the planned route at the modelled pace (optionally drifting off course),
//     so the guidance can be demonstrated.
// Each fix is snapped to the planned route to get progress, cross-track error, next turn,
// time/O₂ remaining, hazards ahead, and a turn-back alert.
const Nav = (() => {
  const OFF_ROUTE_M = 40;   // cross-track distance that counts as off route
  const ARRIVE_M = 30;      // within this of a stop = arrived
  const HAZARD_LOOKAHEAD_M = 300;
  const R = 3389500, RAD = Math.PI / 180;

  let active = false, P = null, labels = [], pts = [], cum = [], lat0 = 0, lon0 = 0;
  let stops = [], arrived = new Set(), progress = 0, lastAlong = 0, wrongWayCount = 0;
  let mode = "sim", simT = 0, simTimer = null, simSpeed = 60, drift = false, driftOff = 0;
  let startWall = 0, follow = true, voice = false, lastSaid = "", fixCount = 0;
  const layer = L.layerGroup();
  let doneLine, trail, posMarker, rejoinLine;
  const ui = {};

  // ---- geometry in a local metric plane around the route ----
  const toXY = (lat, lon) => [R * Math.cos(lat0 * RAD) * (lon - lon0) * RAD, R * (lat - lat0) * RAD];
  const toLL = (x, y) => [lat0 + y / R / RAD, lon0 + x / (R * Math.cos(lat0 * RAD)) / RAD];

  function snap(lat, lon) {
    // Nearest point on the route, never jumping more than 100 m backwards. That keeps an
    // out-and-back route from snapping onto the return leg on the way out.
    const [px, py] = toXY(lat, lon);
    let best = { d: Infinity };
    for (let i = 0; i < pts.length - 1; i++) {
      if (cum[i + 1] < progress - 100) continue;
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
      const qx = ax + t * dx, qy = ay + t * dy;
      const d = Math.hypot(px - qx, py - qy);
      if (d < best.d - 0.5) best = { d, along: cum[i] + t * (cum[i + 1] - cum[i]), qx, qy, i, t };
    }
    return best;
  }
  function pointAt(along) {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < along) i++;
    const t = (along - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
    return { i, t: Math.max(0, Math.min(1, t)), xy: [pts[i][0] + t * (pts[i + 1][0] - pts[i][0]), pts[i][1] + t * (pts[i + 1][1] - pts[i][1])] };
  }
  const tAt = (along) => { const { i, t } = pointAt(along); const s = P.samples; return s[i].t_h + t * (s[i + 1].t_h - s[i].t_h); };
  function alongAtTime(h) {
    const s = P.samples;
    if (h <= 0) return 0;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i + 1].t_h >= h) return cum[i] + ((h - s[i].t_h) / ((s[i + 1].t_h - s[i].t_h) || 1)) * (cum[i + 1] - cum[i]);
    }
    return cum[cum.length - 1];
  }
  const bearingTo = (a, b) => {
    const [la1, lo1, la2, lo2] = [a[0] * RAD, a[1] * RAD, b[0] * RAD, b[1] * RAD];
    const y = Math.sin(lo2 - lo1) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  };
  const COMPASS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass16 = (b) => COMPASS16[Math.round(b / 22.5) % 16];

  // ---- mission clock ----
  const elapsed = () => (mode === "sim" ? simT : (Date.now() - startWall) / 3.6e6);
  const departLtst = () => { const [h, m] = ($("depart").value || "09:00").split(":").map(Number); return h + m / 60; };

  // ---- HUD ----
  function buildHud() {
    const c = map.getContainer();
    const mk = (cls, html = "") => { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; c.appendChild(d); return d; };
    ui.top = mk("nav-top");
    ui.alert = mk("nav-alert");
    ui.alert.hidden = true;
    ui.bottom = mk("nav-bottom");
    ui.ctrl = mk("nav-ctrl", `
      <div class="nav-ctrl-row"><b>Position source</b>
        <select id="nav-mode"><option value="sim">Simulate walk</option><option value="manual">Nav fixes (tap map)</option></select></div>
      <div class="nav-ctrl-row" id="nav-sim-row">
        <button id="nav-play">❚❚</button>
        <select id="nav-speed"><option value="10">10×</option><option value="60" selected>60×</option><option value="300">300×</option><option value="900">900×</option></select>
        <label><input type="checkbox" id="nav-drift"> Drift off route</label></div>
      <div class="nav-ctrl-row muted" id="nav-man-row" hidden>Tap the map where your nav fix puts you, or use “Your position” → I'm here.</div>
      <div class="nav-ctrl-row"><label><input type="checkbox" id="nav-voice"> 🔊 Voice</label></div>`);
    L.DomEvent.disableClickPropagation(ui.ctrl);
    L.DomEvent.disableClickPropagation(ui.bottom);
    ui.ctrl.querySelector("#nav-mode").value = mode;
    ui.ctrl.querySelector("#nav-mode").onchange = (e) => setMode(e.target.value);
    ui.ctrl.querySelector("#nav-play").onclick = () => (simTimer ? pauseSim() : playSim());
    ui.ctrl.querySelector("#nav-speed").onchange = (e) => { simSpeed = +e.target.value; };
    ui.ctrl.querySelector("#nav-drift").onchange = (e) => { drift = e.target.checked; };
    ui.ctrl.querySelector("#nav-voice").onchange = (e) => { voice = e.target.checked; lastSaid = ""; };
    map.on("dragstart", stopFollow);
  }
  function stopFollow() { if (active) { follow = false; render(lastState); } }

  function say(text) {
    if (!voice || !window.speechSynthesis || text === lastSaid) return;
    lastSaid = text;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(text.replace(/[↑↗↖→←↘↙↩⚠✓✗]/g, "")));
  }

  // ---- core: process one position fix ----
  let lastState = null;
  function fix(lat, lon) {
    if (!active) return;
    fixCount++;
    const s = snap(lat, lon);
    const along = s.along;
    // wrong-way: progress went backwards noticeably on two consecutive fixes
    wrongWayCount = along < lastAlong - 15 ? wrongWayCount + 1 : 0;
    lastAlong = along;
    const offRoute = s.d > OFF_ROUTE_M;
    if (!offRoute) progress = Math.max(progress, along);

    trail.addLatLng([lat, lon]);
    posMarker.setLatLng([lat, lon]);
    if (!map.hasLayer(posMarker)) posMarker.addTo(layer);
    const snapLL = toLL(s.qx, s.qy);
    rejoinLine.setLatLngs(offRoute ? [[lat, lon], snapLL] : []);

    // traveled part of the route in grey
    const k = pointAt(progress);
    doneLine.setLatLngs([...P.samples.slice(0, k.i + 1).map((p) => [p.lat, p.lon]), toLL(...k.xy)]);

    // arrivals
    stops.forEach((st, j) => {
      if (j > 0 && !arrived.has(j) && !offRoute && progress >= st.dist - ARRIVE_M) {
        arrived.add(j);
        toast(j === stops.length - 1 ? `✓ ${$("roundtrip").checked ? "Back at" : "Arrived at"} ${labels[j]} — Marswalk complete` : `✓ Arrived at ${labels[j]}`);
      }
    });

    const next = stops.findIndex((st, j) => j > 0 && st.dist > progress + ARRIVE_M);
    const total = cum[cum.length - 1];
    const el = elapsed();
    const tPlan = tAt(progress);
    const tRem = Math.max(0, P.stats.walk_hours - tPlan);
    const o2Left = P.stats.o2_budget_hours - el;
    const reserve = P.stats.o2_budget_hours - P.stats.o2_usable_hours;
    const ltst = departLtst() + el / MARS_HOUR;
    const day = daylight(lat);
    const hazard = P.hazards.find((h) => h.dist_m > progress && h.dist_m <= progress + HAZARD_LOOKAHEAD_M);
    lastState = { lat, lon, s, offRoute, next, total, el, tPlan, tRem, o2Left, reserve, ltst, day, hazard, snapLL };
    render(lastState);
    if (follow) map.panTo([lat, lon], { animate: mode !== "sim" || simSpeed < 300 });
    if (next === -1 && arrived.has(stops.length - 1)) pauseSim();
  }

  function render(st) {
    if (!st) return;
    const { lat, lon, s, offRoute, next, total, el, tPlan, tRem, o2Left, reserve, ltst, day, hazard, snapLL } = st;
    // --- top card: next maneuver ---
    let icon = "↑", big = "", line = "", sub = "";
    if (offRoute) {
      const b = bearingTo([lat, lon], snapLL);
      icon = "↺"; big = fmtKm(s.d / 1000);
      line = `Off route — head ${compassWord(compass16(b))} (${Math.round(b)}°) to rejoin`;
      sub = `Nearest point on the planned path is ${fmtKm(s.d / 1000)} away`;
    } else if (next === -1) {
      icon = "✓"; big = "Done"; line = `You've reached ${labels[labels.length - 1]}`;
    } else {
      const dist = stops[next].dist - progress;
      const isLast = next === stops.length - 1;
      const leg = P.legs[next];
      big = fmtKm(dist / 1000);
      if (isLast) { icon = "⚑"; line = `${$("roundtrip").checked ? "Back at" : "Arrive at"} ${labels[next]}`; }
      else { icon = TURN_ICON[leg.instruction] || "↑"; line = `At ${labels[next]}: ${leg.instruction.toLowerCase()} ${compassWord(leg.compass)}`; }
      const cur = P.legs[next - 1];
      sub = `Now: heading ${compassWord(cur.compass)} · ${cur.terrain.split(" (")[0].toLowerCase()}`;
    }
    ui.top.className = "nav-top" + (offRoute ? " off" : "");
    ui.top.innerHTML = `<div class="nav-ic">${icon}</div><div><div class="nav-big">${big}</div><div class="nav-line">${line}</div><div class="nav-sub">${sub}</div></div>`;

    // --- alerts, most urgent first ---
    const alerts = [];
    if (o2Left <= 0) alerts.push(["bad", "✗ O₂ budget exhausted — switch to emergency supply, return now"]);
    else if (tRem > o2Left - reserve) alerts.push(["bad", `⚠ TURN BACK — ${fmtDur(tRem)} of walking left but only ${fmtDur(Math.max(0, o2Left - reserve))} of O₂ before reserve`]);
    if (wrongWayCount >= 2) alerts.push(["bad", "⚠ Wrong way — you're walking back along the route"]);
    if (hazard) alerts.push(["warn", `⚠ ${hazard.slope_deg}° slope in ${fmtKm((hazard.dist_m - progress) / 1000)} — slow down, look for a gentler line`]);
    if (day && ltst + tRem / MARS_HOUR > day.set) alerts.push(["warn", `☾ At this pace you finish after sunset (${MarsTime.hhmm(day.set)})`]);
    const late = el - tPlan;
    if (late > 0.25) alerts.push(["warn", `Behind plan by ${fmtDur(late)}`]);
    ui.alert.hidden = !alerts.length;
    if (alerts.length) { ui.alert.className = `nav-alert ${alerts[0][0]}`; ui.alert.textContent = alerts[0][1]; }

    // --- bottom bar ---
    const eta = ltst + tRem / MARS_HOUR;
    ui.bottom.innerHTML = `
      <div class="nav-stats">
        <div><b>${clock(eta)}</b><span>ETA (local)</span></div>
        <div><b>${fmtKm(Math.max(0, total - progress) / 1000)}</b><span>to go</span></div>
        <div><b>${fmtDur(tRem)}</b><span>walking left</span></div>
        <div class="${o2Left - reserve < tRem ? "neg" : ""}"><b>${Math.max(0, o2Left).toFixed(1)} h</b><span>O₂ left</span></div>
        <div><b>${fmtDur(el)}</b><span>EVA time</span></div>
      </div>
      <div class="nav-btns">${follow ? "" : '<button id="nav-recenter">◎ Re-center</button>'}<button id="nav-end">End</button></div>`;
    ui.bottom.querySelector("#nav-end").onclick = stop;
    const rc = ui.bottom.querySelector("#nav-recenter");
    if (rc) rc.onclick = () => { follow = true; map.panTo([lat, lon]); render(lastState); };

    say(offRoute ? `Off route. Head ${compassWord(compass16(bearingTo([lat, lon], snapLL)))} to rejoin.`
      : alerts.length && alerts[0][0] === "bad" ? alerts[0][1] : line); // speak on changes only, not every metre
  }

  function toast(text) {
    const t = document.createElement("div");
    t.className = "nav-toast";
    t.textContent = text;
    map.getContainer().appendChild(t);
    setTimeout(() => t.remove(), 3500);
    say(text);
  }

  // ---- simulation ----
  function simStep() {
    simT += (0.2 * simSpeed) / 3600;
    const along = alongAtTime(simT);
    const p = pointAt(along);
    // drift: walk off to one side (perpendicular to the path), then come back when unticked
    driftOff = drift ? Math.min(150, driftOff + 0.4 * simSpeed * 0.2) : Math.max(0, driftOff - 1.2 * simSpeed * 0.2);
    const [ax, ay] = pts[p.i], [bx, by] = pts[p.i + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len, ny = (bx - ax) / len;
    fix(...toLL(p.xy[0] + nx * driftOff, p.xy[1] + ny * driftOff));
  }
  function playSim() {
    if (simTimer || mode !== "sim") return;
    simTimer = setInterval(simStep, 200);
    const b = document.getElementById("nav-play"); if (b) b.textContent = "❚❚";
  }
  function pauseSim() {
    clearInterval(simTimer); simTimer = null;
    const b = document.getElementById("nav-play"); if (b) b.textContent = "▶";
  }
  function setMode(m) {
    mode = m;
    document.getElementById("nav-sim-row").hidden = m !== "sim";
    document.getElementById("nav-man-row").hidden = m !== "manual";
    if (m === "sim") playSim();
    else { pauseSim(); startWall = Date.now() - simT * 3.6e6; } // keep the mission clock continuous
  }

  // ---- start / stop ----
  function start() {
    if (!lastProfile || active) return;
    P = lastProfile; labels = lastLabels;
    lat0 = P.samples[0].lat; lon0 = P.samples[0].lon;
    pts = P.samples.map((s) => toXY(s.lat, s.lon));
    cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    stops = [{ idx: 0, dist: 0 }, ...P.legs.map((l) => ({ idx: l.to_idx, dist: cum[l.to_idx] }))];
    arrived = new Set(); progress = 0; lastAlong = 0; wrongWayCount = 0;
    simT = 0; driftOff = 0; drift = false; follow = true; lastSaid = ""; fixCount = 0;
    startWall = Date.now();
    if (drawing) setDrawing(false);
    active = true;
    document.body.classList.add("navigating");
    layer.clearLayers().addTo(map);
    doneLine = L.polyline([], { color: "#9aa0a6", weight: 6, opacity: 0.95, lineCap: "round", interactive: false }).addTo(layer);
    trail = L.polyline([], { color: "#fff", weight: 2, dashArray: "1 6", opacity: 0.9, interactive: false }).addTo(layer);
    rejoinLine = L.polyline([], { color: RED, weight: 2, dashArray: "6 6", interactive: false }).addTo(layer);
    posMarker = L.marker([lat0, lon0], { icon: L.divIcon({ className: "", html: '<div class="me-dot nav"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 3000, interactive: false });
    buildHud();
    map.setView([lat0, lon0], Math.max(map.getZoom(), 15));
    // use real nav fixes if the astronaut's saved position is at the route start, else demo
    const nearStart = me && Math.hypot(...toXY(me[0], me[1])) < 500;
    mode = nearStart ? "manual" : "sim";
    document.getElementById("nav-mode").value = mode;
    setMode(mode);
    fix(...(me && mode === "manual" ? me : [lat0, lon0]));
  }
  function stop() {
    pauseSim();
    active = false;
    document.body.classList.remove("navigating");
    map.off("dragstart", stopFollow);
    layer.remove();
    for (const k of Object.keys(ui)) { ui[k].remove(); delete ui[k]; }
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  // manual fixes: tap the map
  map.on("click", (e) => { if (active && mode === "manual" && !picking) fix(e.latlng.lat, e.latlng.lng); });

  return { start, stop, fix, get active() { return active; } };
})();
