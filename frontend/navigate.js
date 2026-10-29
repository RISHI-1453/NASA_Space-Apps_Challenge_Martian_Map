// Live Marswalk guidance: "am I on the right path?"
//
// Mars has no GPS. During an EVA the astronaut's position comes from the suit/rover navigation
// fix (radio ranging to the lander, visual odometry, IMU). The astronaut reports each fix by
// tapping the map, typing coordinates, or "Your position" → I'm here. Each fix is snapped to the
// planned route to get progress, cross-track error, next turn, time/O₂ remaining, hazards ahead,
// and a turn-back alert. The same guidance can be shown as a helmet-visor HUD: a compass tape with
// the bearing to the next station, suit gauges, the mission clock, dose so far and space weather.
const Nav = (() => {
  const OFF_ROUTE_M = 40;   // cross-track distance that counts as off route
  const ARRIVE_M = 30;      // within this of a stop = arrived
  const HAZARD_LOOKAHEAD_M = 300;
  const R = 3389500, RAD = Math.PI / 180;

  let active = false, P = null, labels = [], pts = [], cum = [], lat0 = 0, lon0 = 0;
  let stops = [], arrived = new Set(), progress = 0, lastAlong = 0, wrongWayCount = 0;
  let startWall = 0, follow = true, fixCount = 0, visor = false, prevFix = null, heading = null;
  const layer = L.layerGroup();
  let doneLine, trail, posMarker, rejoinLine, accCircle;
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
  let TL = null, base = null; // suit timeline for this route; consumables at the last reading
  const tAt = (along) => { const { i, t } = pointAt(along); return TL.t[i] + t * (TL.t[i + 1] - TL.t[i]); };
  const usedAt = (along) => { const { i, t } = pointAt(along); return Object.fromEntries(Suit.RES.map((r) => [r.key, TL[r.key][i] + t * (TL[r.key][i + 1] - TL[r.key][i])])); };
  function rebase() { base = { have: Suit.available(), at: usedAt(progress), t: tAt(progress), el: elapsed() }; }
  const bearingTo = (a, b) => {
    const [la1, lo1, la2, lo2] = [a[0] * RAD, a[1] * RAD, b[0] * RAD, b[1] * RAD];
    const y = Math.sin(lo2 - lo1) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  };
  const COMPASS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass16 = (b) => COMPASS16[Math.round(b / 22.5) % 16];

  // ---- mission clock ----
  const elapsed = () => (Date.now() - startWall) / 3.6e6;
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
      <div class="nav-ctrl-col">
        <b>Report your position</b>
        <button id="nav-tap" type="button">📍 Tap my position on the map</button>
        <form id="nav-coord" class="nav-ctrl-row"><input id="nav-coord-in" placeholder="or type lat, lon" aria-label="Nav fix coordinates" autocomplete="off"><button type="submit">Go</button></form>
        <span class="muted small" id="nav-lastfix">You start at A. Whenever your suit or rover gives a position fix, tap it on the map or type it here; the guidance updates from each fix.</span>
      </div>`);
    L.DomEvent.disableClickPropagation(ui.ctrl);
    L.DomEvent.disableClickPropagation(ui.bottom);
    ui.ctrl.querySelector("#nav-tap").onclick = () => armTap(!tapArmed);
    ui.ctrl.querySelector("#nav-coord").onsubmit = (e) => {
      e.preventDefault();
      const c = parseCoords(ui.ctrl.querySelector("#nav-coord-in").value || "");
      if (!c) { ui.ctrl.querySelector("#nav-lastfix").textContent = "Couldn't read that — try e.g. 18.4521, 77.4380"; return; }
      ui.ctrl.querySelector("#nav-coord-in").value = "";
      fix(c[0], c[1], 15, "typed");
    };
    map.on("dragstart", stopFollow);
  }
  function stopFollow() { if (active) { follow = false; render(lastState); } }

  // ---- core: process one position fix ----
  let lastState = null;
  function fix(lat, lon, acc = 15, how = "fix") {
    if (!active) return;
    fixCount++;
    const s = snap(lat, lon);
    const along = s.along;
    // wrong way: clearly backwards (beyond the fix's own uncertainty) on three fixes in a row
    wrongWayCount = how === "refresh" ? wrongWayCount : along < lastAlong - Math.max(20, acc) ? wrongWayCount + 1 : 0;
    lastAlong = along;
    // off route only when the gap is bigger than the fix could be wrong by
    const offRoute = s.d > Math.max(OFF_ROUTE_M, 2.5 * acc);
    accCircle.setLatLng([lat, lon]).setRadius(acc * MARS_TO_LEAFLET_M);
    if (acc > 8 && !layer.hasLayer(accCircle)) accCircle.addTo(layer);
    if (acc <= 8) accCircle.remove();
    // which way the astronaut is actually walking (from the last two fixes)
    if (prevFix && how !== "refresh" && Math.hypot(...toXY(lat, lon).map((v, i) => v - toXY(...prevFix)[i])) > 5) heading = bearingTo(prevFix, [lat, lon]);
    if (how !== "refresh") prevFix = [lat, lon];
    const lf = document.getElementById("nav-lastfix");
    const HOW = { tap: "map tap", typed: "typed", start: "route start" };
    if (lf && how !== "refresh") lf.textContent = `Last fix (${HOW[how] || "position"}): ${fmtLatLon(lat, lon)} ±${Math.round(acc)} m`;
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
    const tRem = Math.max(0, TL.hours - tPlan);
    // what's left: last reading − model use while walking − resting use while stopped or slower than plan
    const now = usedAt(progress), idle = Math.max(0, (el - base.el) - (tPlan - base.t)), rest = Suit.rates(150);
    const left = {}, needRest = {}, reserve = {};
    for (const r of Suit.RES) {
      left[r.key] = base.have[r.key] - (now[r.key] - base.at[r.key]) - rest[r.key] * idle;
      needRest[r.key] = TL[r.key][TL.t.length - 1] - now[r.key] + (TL.endUse?.[r.key] || 0);
      reserve[r.key] = (Suit.FULL[r.key] * Suit.state.reservePct) / 100;
    }
    const ltst = departLtst() + el / MARS_HOUR;
    const day = daylight(lat);
    const hazard = P.hazards.find((h) => h.dist_m > progress && h.dist_m <= progress + HAZARD_LOOKAHEAD_M);
    lastState = { lat, lon, acc, s, offRoute, next, total, el, tPlan, tRem, left, needRest, reserve, ltst, day, hazard, snapLL };
    render(lastState);
    if (follow) map.panTo([lat, lon]);
  }

  function render(st) {
    if (!st) return;
    const { lat, lon, s, offRoute, next, total, el, tPlan, tRem, left, needRest, reserve, ltst, day, hazard, snapLL } = st;
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
    const empty = Suit.RES.find((r) => left[r.key] <= 0);
    const short = Suit.RES.find((r) => needRest[r.key] > left[r.key] - reserve[r.key]);
    if (empty) alerts.push(["bad", `✗ ${empty.name} exhausted — switch to the backup supply and head straight back`]);
    else if (short) alerts.push(["bad", `⚠ TURN BACK — ${short.name.toLowerCase()}: the rest of the walk needs ${short.fmt(needRest[short.key])}, only ${short.fmt(Math.max(0, left[short.key] - reserve[short.key]))} usable`]);
    if (+Suit.state.heartRate > 160) alerts.push(["warn", `♥ Heart rate ${Suit.state.heartRate} bpm — slow down and rest`]);
    if (wrongWayCount >= 3) alerts.push(["bad", "⚠ Wrong way — you're walking back along the route"]);
    if (hazard) alerts.push(["warn", `⚠ ${hazard.slope_deg}° slope in ${fmtKm((hazard.dist_m - progress) / 1000)} — slow down, look for a gentler line`]);
    if (day && ltst + tRem / MARS_HOUR > day.set) alerts.push(["warn", `☾ At this pace you finish after sunset (${MarsTime.hhmm(day.set)})`]);
    const late = el - tPlan;
    if (late > 0.25) alerts.push(["warn", `Behind plan by ${fmtDur(late)}`]);
    const wx = typeof SpaceWx !== "undefined" ? SpaceWx.assess() : null;
    if (wx && wx.level === "nogo") alerts.unshift(["bad", `☀ SOLAR STORM — head for shelter at ${labels[0]} now (${wx.headline})`]);
    else if (wx && wx.level === "caution") alerts.push(["warn", `☀ Space weather: ${wx.headline}`]);
    ui.alert.hidden = !alerts.length;
    if (alerts.length) { ui.alert.className = `nav-alert ${alerts[0][0]}`; ui.alert.textContent = alerts[0][1]; }
    if (visor) renderVisor(st, { icon, big, line, offRoute, alerts, wx });

    // --- bottom bar ---
    const eta = ltst + tRem / MARS_HOUR;
    ui.bottom.innerHTML = `
      <div class="nav-stats">
        <div><b>${clock(eta)}</b><span>ETA (local)</span></div>
        <div><b>${fmtKm(Math.max(0, total - progress) / 1000)}</b><span>to go</span></div>
        <div><b>${fmtDur(tRem)}</b><span>walking left</span></div>
        <div class="${needRest.o2 > left.o2 - reserve.o2 ? "neg" : ""}"><b>${Math.max(0, Math.round((left.o2 / Suit.FULL.o2) * 100))}%</b><span>O₂ left</span></div>
        <div class="${needRest.battery > left.battery - reserve.battery ? "neg" : ""}"><b>${Math.max(0, Math.round((left.battery / Suit.FULL.battery) * 100))}%</b><span>battery</span></div>
        <div><b>${fmtDur(el)}</b><span>EVA time</span></div>
      </div>
      <div class="nav-btns">${follow ? "" : '<button id="nav-recenter">◎ Re-center</button>'}<button id="nav-readings">Update readings</button><button id="nav-visor">🪖 Visor</button><button id="nav-view">👁 View</button><button id="nav-end">End</button></div>`;
    ui.bottom.querySelector("#nav-end").onclick = stop;
    ui.bottom.querySelector("#nav-visor").onclick = () => setVisor(true);
    ui.bottom.querySelector("#nav-readings").onclick = () => openReadings(left);
    ui.bottom.querySelector("#nav-view").onclick = () => typeof GroundView !== "undefined" && GroundView.at(lat, lon, "Your position");
    const rc = ui.bottom.querySelector("#nav-recenter");
    if (rc) rc.onclick = () => { follow = true; map.panTo([lat, lon]); render(lastState); };
  }

  // the astronaut reports suit gauges / how they feel; the plan re-baselines from these numbers
  function openReadings(left) {
    if (ui.readings) { ui.readings.remove(); delete ui.readings; return; }
    const st0 = Suit.state, pct = (k) => Math.max(0, Math.round((left[k] / Suit.FULL[k]) * 100));
    const d = document.createElement("form");
    d.className = "nav-readings";
    d.innerHTML = `<b>Suit readings now</b>
      <label>Oxygen <span><input name="o2Pct" type="number" min="0" max="100" value="${pct("o2")}"> %</span></label>
      <label>Battery <span><input name="batteryPct" type="number" min="0" max="100" value="${pct("battery")}"> %</span></label>
      <label>Cooling water <span><input name="waterPct" type="number" min="0" max="100" value="${pct("water")}"> %</span></label>
      <label>CO₂ scrubber <span><input name="co2Hours" type="number" min="0" max="12" step="0.1" value="${Math.max(0, left.co2).toFixed(1)}"> h</span></label>
      <label>Heart rate <span><input name="heartRate" type="number" min="30" max="220" value="${st0.heartRate || ""}" placeholder="—"> bpm</span></label>
      <label>Feeling <span><select name="condition">${["fresh", "normal", "tired"].map((c) => `<option ${c === st0.condition ? "selected" : ""}>${c}</option>`).join("")}</select></span></label>
      <div class="nav-btns"><button type="submit">Save</button><button type="button" data-x>Cancel</button></div>`;
    L.DomEvent.disableClickPropagation(d);
    d.querySelector("[data-x]").onclick = () => { d.remove(); delete ui.readings; };
    d.onsubmit = (e) => {
      e.preventDefault();
      const f = d.elements, num = (n) => (f[n].value === "" ? "" : +f[n].value);
      d.remove(); delete ui.readings;
      Suit.set({ o2Pct: num("o2Pct"), batteryPct: num("batteryPct"), waterPct: num("waterPct"), co2Hours: num("co2Hours"), heartRate: num("heartRate"), condition: f.condition.value });
      toast("✓ Readings updated — plan recalculated");
    };
    map.getContainer().appendChild(d);
    ui.readings = d;
  }
  // new readings or a change in pace: rebuild the timeline and carry on from here
  Suit.onChange(() => {
    if (!active) return;
    TL = Suit.timeline(P, routeOpts(P));
    rebase();
    if (lastState) fix(lastState.lat, lastState.lon, lastState.acc, "refresh");
  });

  function toast(text) {
    const t = document.createElement("div");
    t.className = "nav-toast";
    t.textContent = text;
    map.getContainer().appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ---- start / stop ----
  function start(opts = {}) {
    if (active) { if (opts.visor) setVisor(true); return; }
    if (!lastProfile) return;
    P = lastProfile; labels = lastLabels;
    lat0 = P.samples[0].lat; lon0 = P.samples[0].lon;
    pts = P.samples.map((s) => toXY(s.lat, s.lon));
    cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    stops = [{ idx: 0, dist: 0 }, ...P.legs.map((l) => ({ idx: l.to_idx, dist: cum[l.to_idx] }))];
    arrived = new Set(); progress = 0; lastAlong = 0; wrongWayCount = 0;
    follow = true; fixCount = 0; prevFix = null; heading = null;
    startWall = Date.now();
    TL = Suit.timeline(P, routeOpts(P));
    rebase();
    if (drawing) setDrawing(false);
    active = true;
    document.body.classList.add("navigating");
    layer.clearLayers().addTo(map);
    doneLine = L.polyline([], { color: "#9aa0a6", weight: 6, opacity: 0.95, lineCap: "round", interactive: false }).addTo(layer);
    trail = L.polyline([], { color: "#fff", weight: 2, dashArray: "1 6", opacity: 0.9, interactive: false }).addTo(layer);
    rejoinLine = L.polyline([], { color: RED, weight: 2, dashArray: "6 6", interactive: false }).addTo(layer);
    accCircle = L.circle([lat0, lon0], { radius: 10, color: ROUTE, weight: 1, fillOpacity: 0.12, interactive: false });
    posMarker = L.marker([lat0, lon0], { icon: L.divIcon({ className: "", html: '<div class="me-dot nav"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 3000, interactive: false });
    buildHud();
    map.setView([lat0, lon0], Math.max(map.getZoom(), 15));
    // the walk starts at A; it only moves when the astronaut reports a position
    const atStart = me && Math.hypot(...toXY(me[0], me[1])) < 100;
    fix(...(atStart ? me : [lat0, lon0]), atStart ? 15 : 3, atStart ? "position" : "start");
    if (opts.visor) setVisor(true);
  }
  function stop() {
    armTap(false);
    setVisor(false);
    active = false;
    document.body.classList.remove("navigating");
    map.off("dragstart", stopFollow);
    layer.remove();
    for (const k of Object.keys(ui)) { ui[k].remove(); delete ui[k]; }
  }

  // ---- helmet-visor HUD ----
  function setVisor(on) {
    visor = on && active;
    document.body.classList.toggle("visor-on", visor);
    if (!visor) { ui.visor?.remove(); delete ui.visor; return; }
    if (!ui.visor) {
      const d = document.createElement("div");
      d.className = "visor";
      d.innerHTML = `<div class="v-glass"></div><div class="v-tape"><div class="v-ticks"></div><div class="v-caret">▼</div></div>
        <div class="v-left"></div><div class="v-right"></div><div class="v-center"></div><div class="v-alert" hidden></div>
        <div class="v-reticle"></div><button type="button" class="v-exit">✕ Exit visor</button>`;
      L.DomEvent.disableClickPropagation(d);
      d.querySelector(".v-exit").onclick = () => setVisor(false);
      map.getContainer().appendChild(d);
      ui.visor = d;
    }
    render(lastState);
  }
  const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
  function renderVisor(st, card) {
    const d = ui.visor;
    if (!d) return;
    const { lat, lon, next, total, el, tRem, left, needRest, reserve, ltst, day, snapLL } = st;
    // compass tape: centred on the way you're walking, ◆ on the way to go
    const target = card.offRoute ? bearingTo([lat, lon], snapLL) : next > 0 ? bearingTo([lat, lon], [P.samples[stops[next].idx].lat, P.samples[stops[next].idx].lon]) : null;
    const hdg = heading ?? (next > 0 ? P.legs[next - 1].bearing_deg : target ?? 0);
    const SPAN = 120, ticks = [];
    for (let a = Math.ceil((hdg - SPAN / 2) / 10) * 10; a <= hdg + SPAN / 2; a += 10) {
      const x = 50 + (angDiff(a, hdg) / SPAN) * 100, n = ((a % 360) + 360) % 360;
      const lab = n % 90 === 0 ? "NESW"[n / 90] : n % 30 === 0 ? String(n) : "";
      ticks.push(`<span class="v-tick${lab ? " big" : ""}" style="left:${x}%">${lab}</span>`);
    }
    if (target !== null) {
      const off = angDiff(target, hdg), x = 50 + (Math.max(-SPAN / 2, Math.min(SPAN / 2, off)) / SPAN) * 100;
      ticks.push(`<span class="v-target${Math.abs(off) > SPAN / 2 ? " edge" : ""}" style="left:${x}%">◆</span>`);
    }
    d.querySelector(".v-ticks").innerHTML = ticks.join("") + `<span class="v-hdg">${String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, "0")}°${target !== null ? ` · go ${String(Math.round(target)).padStart(3, "0")}°` : ""}</span>`;
    // suit gauges: the lower suit of the pair, and what the rest of the walk needs (tick)
    const gauge = (key, name) => {
      const f = Math.max(0, left[key] / Suit.FULL[key]), need = Math.min(1, (needRest[key] + reserve[key]) / Suit.FULL[key]);
      const bad = needRest[key] > left[key] - reserve[key];
      return `<div class="v-gauge${bad ? " bad" : f < 0.3 ? " low" : ""}"><div class="v-bar"><i style="height:${Math.round(f * 100)}%"></i><b style="bottom:${Math.round(need * 100)}%"></b></div><span>${name}</span><em>${key === "co2" ? `${Math.max(0, left[key]).toFixed(1)}h` : `${Math.round(f * 100)}%`}</em></div>`;
    };
    d.querySelector(".v-left").innerHTML = gauge("o2", "O₂") + gauge("battery", "PWR") + gauge("water", "H₂O") + gauge("co2", "CO₂");
    const dose = (el / 24) * 0.64, e = MarsTime.earth(), sun = sunElevation(lat, ltst); // on the EVA's clock, like the ETA
    const WX = { go: "GO", caution: "CAUTION", nogo: "NO-GO", unknown: "—" };
    d.querySelector(".v-right").innerHTML = `
      <div><span>EVA</span><b>${fmtDur(el)}</b></div>
      <div><span>ETA</span><b>${clock(ltst + tRem / MARS_HOUR)}</b></div>
      <div><span>TO GO</span><b>${fmtKm(Math.max(0, total - progress) / 1000)}</b></div>
      <div><span>SUN</span><b>${sun.toFixed(0)}°${day ? ` · set ${MarsTime.hhmm(day.set)}` : ""}</b></div>
      <div><span>DOSE</span><b>${dose.toFixed(dose < 0.1 ? 3 : 2)} mSv</b></div>
      <div class="wx-${card.wx?.level || "unknown"}"><span>SPACE WX</span><b>${WX[card.wx?.level || "unknown"]}</b></div>
      <div><span>EARTH</span><b>${e.lightMin.toFixed(0)} min</b></div>`;
    const task = next > 0 && stops[next].idx === P.legs[next - 1].to_idx && next < waypoints.length ? Missions.taskAt(...waypoints[next]) : null;
    d.querySelector(".v-center").innerHTML = `<div class="v-big"><span>${card.icon}</span> ${card.big}</div><div class="v-line">${card.line}</div>${task ? `<div class="v-task">▸ ${task.title}: ${task.task}</div>` : ""}`;
    const va = d.querySelector(".v-alert");
    va.hidden = !card.alerts.length;
    if (card.alerts.length) { va.className = `v-alert ${card.alerts[0][0]}`; va.textContent = card.alerts[0][1]; }
  }

  // manual fixes: tap the map
  // a map click is a position fix only right after "Tap my position" — never by accident
  let tapArmed = false;
  function armTap(on) {
    tapArmed = on;
    const b = document.getElementById("nav-tap");
    if (b) { b.classList.toggle("active", on); b.textContent = on ? "Tap where you are… (Esc to cancel)" : "📍 Tap my position on the map"; }
    map.getContainer().style.cursor = on ? "crosshair" : "";
  }
  map.on("click", (e) => {
    if (!active || !tapArmed) return;
    armTap(false);
    // a tap is only as precise as the zoom level: ~12 screen pixels
    const mPerPx = (180 / (256 * 2 ** map.getZoom())) * ((R * Math.PI) / 180);
    fix(e.latlng.lat, e.latlng.lng, Math.max(5, 12 * mPerPx), "tap");
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tapArmed) armTap(false); });

  return { start, stop, fix, setVisor, get active() { return active; } };
})();
