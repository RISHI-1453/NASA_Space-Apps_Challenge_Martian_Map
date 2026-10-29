// Astronaut & suit status → what a walk will cost.
//
// The astronaut reports consumables (O2, battery, cooling water, CO2 scrubber), body mass, what
// they're carrying and how they feel. For every step of a route we estimate metabolic power with
// the Pandolf et al. (1977) load-carriage equation, then scale it to Mars gravity with a measured
// factor (walking at 0.38 g costs ~68% of 1 g, not 38% — Brown et al. 2018; Farley & McMahon 1992)
// and a pressurised-suit penalty, and turn power into O2, CO2-scrubber, cooling-water and battery
// use. Averages land inside the 229–352 W Apollo crews averaged on the Moon (Waligora et al. 1975).
// Capacities default to ISS-EMU-class figures; edit CAP for a Mars suit design.
//
// A plan can also hold work time at the stops (station work, at Apollo-like effort), legs driven
// on a rover (seated, at resting effort), and a second astronaut: with a buddy pair every check
// uses whichever suit has less of each supply, because the pair walks home together.
const Suit = (() => {
  const KEY = "martianmap.suit";
  const DEFAULTS = { o2Pct: 100, batteryPct: 100, waterPct: 100, co2Hours: 8, bodyKg: 80, loadKg: 15, condition: "normal", reservePct: 20, heartRate: "",
    crew: 2, o2Pct2: 100, batteryPct2: 100, waterPct2: 100, co2Hours2: 8, rover: "none" };
  const CAP = {
    o2Kg: 0.54,       // primary O2 bottle (EMU ≈ 1.2 lb)
    batteryWh: 400,   // suit battery
    waterKg: 3.6,     // cooling feedwater
    suitKg: 50,       // suit + life-support backpack mass
    co2RatedW: 300,   // scrubber hours are rated at this metabolic rate
    systemsW: 45,     // fans, pumps, radio, lights
  };
  const PACE = { fresh: 1.0, normal: 0.9, tired: 0.75 };
  const STATION_W = 250;    // working at a stop: inside the 229–352 W Apollo EVA average (Waligora et al. 1975)
  const RIDE_W = 150;       // riding a rover in the suit: the model's resting rate
  // an LRV-class rover: ~10 km/h on the flat, crawling on steep ground (Apollo's LRV managed 25° slopes)
  const driveKmh = (s) => 10 * Math.max(0.25, 1 - Math.abs(Math.atan(s) * 180 / Math.PI) / 25);
  const MARS_WALK = 0.68;   // walking VO2 at 0.38 g ÷ at 1 g (Brown et al. 2018: 0.68 vs 1.00 L/min)
  const SUIT_PENALTY = 1.3; // extra effort of moving joints in a pressurised suit
  const TERRAIN = 1.3;      // Pandolf terrain factor for loose regolith

  let st = { ...DEFAULTS, ...load() };
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }

  // metabolic power (W) walking at v m/s on a grade (%): Pandolf 1977 at 1 g, scaled to Mars
  function metabolicW(v, gradePct) {
    const W = st.bodyKg, L = CAP.suitKg + st.loadKg;
    const G = gradePct >= 0 ? gradePct : -gradePct * 0.3; // going downhill still costs a little
    const standing = 1.5 * W;
    const carrying = 2.0 * (W + L) * (L / W) ** 2;
    const moving = TERRAIN * (W + L) * (1.5 * v * v + 0.35 * v * G) * SUIT_PENALTY;
    return Math.min(900, Math.max(150, (standing + carrying + moving) * MARS_WALK));
  }
  // walking speed (km/h) on a slope (rise/run): Tobler's hiking function slowed for a suit —
  // the same formula the server uses for walk times (terrain.walking_speed_kmh)
  const toblerKmh = (s) => 6 * Math.exp(-3.5 * Math.abs(s + 0.05)) * 0.35;
  const RATE = {
    o2: (w) => ((w * 3600) / 20100) * 1.429e-3,         // kg/h: 20.1 kJ per litre of O2, 1.429 g per litre
    co2: (w) => w / CAP.co2RatedW,                       // scrubber-hours per hour
    battery: () => CAP.systemsW,                         // Wh per hour
    water: (w) => (Math.max(0, w - 80) * 3600) / 2.45e6, // kg/h of water evaporated to dump body heat
  };
  const RES = [
    { key: "o2", name: "Oxygen", fmt: (x) => `${x.toFixed(2)} kg` },
    { key: "co2", name: "CO₂ scrubber", fmt: (x) => `${x.toFixed(1)} h` },
    { key: "battery", name: "Battery", fmt: (x) => `${Math.round(x)} Wh` },
    { key: "water", name: "Cooling water", fmt: (x) => `${x.toFixed(1)} kg` },
  ];

  const suitHas = (o2Pct, batteryPct, waterPct, co2Hours) => ({
    o2: (CAP.o2Kg * o2Pct) / 100, battery: (CAP.batteryWh * batteryPct) / 100, water: (CAP.waterKg * waterPct) / 100, co2: +co2Hours,
  });
  // what the team can count on: a buddy pair is only as far from empty as the emptier suit
  function available(s = st) {
    const a = suitHas(s.o2Pct, s.batteryPct, s.waterPct, s.co2Hours);
    if (+s.crew !== 2) return a;
    const b = suitHas(s.o2Pct2, s.batteryPct2, s.waterPct2, s.co2Hours2);
    return Object.fromEntries(Object.keys(a).map((k) => [k, Math.min(a[k], b[k])]));
  }
  // which astronaut's suit sets a supply's limit (for the verdict text)
  function whoLimits(key, s = st) {
    if (+s.crew !== 2) return "";
    const a = suitHas(s.o2Pct, s.batteryPct, s.waterPct, s.co2Hours)[key], b = suitHas(s.o2Pct2, s.batteryPct2, s.waterPct2, s.co2Hours2)[key];
    return b < a ? "EV2's" : a < b ? "EV1's" : "";
  }
  const pace = () => PACE[st.condition] || 0.9;

  // cumulative hours and consumables at every sample of a route profile.
  // opts.dwell: {sampleIndex: hours of work there before moving on}; opts.drive(leg): driven, not walked
  function timeline(p, opts = {}) {
    const S = p.samples, n = S.length, k = pace(), dwell = opts.dwell || {}, drive = opts.drive || (() => false);
    const tl = { t: new Float64Array(n), o2: new Float64Array(n), co2: new Float64Array(n), battery: new Float64Array(n), water: new Float64Array(n) };
    let workJ = 0, peakW = 0, walkH = 0, driveH = 0, workH = 0, driveKm = 0;
    for (let i = 1; i < n; i++) {
      const d = S[i].dist_m - S[i - 1].dist_m, dz = S[i].elev_m - S[i - 1].elev_m;
      const rides = drive(S[i].leg);
      const dt = rides ? (d > 0 ? d / 1000 / driveKmh(dz / d) : 0) : Math.max(0, (S[i].t_h - S[i - 1].t_h) / k);
      const v = dt > 0 ? d / (dt * 3600) : 0;
      const w = rides ? RIDE_W : metabolicW(v, d > 0 ? (dz / d) * 100 : 0);
      const stay = +dwell[i - 1] || 0; // station work at the sample we're leaving
      workJ += w * dt * 3600 + STATION_W * stay * 3600;
      if (!rides) peakW = Math.max(peakW, w);
      if (rides) { driveH += dt; driveKm += d / 1000; } else walkH += dt;
      workH += stay;
      tl.t[i] = tl.t[i - 1] + dt + stay;
      for (const r of RES) tl[r.key][i] = tl[r.key][i - 1] + RATE[r.key](w) * dt + RATE[r.key](STATION_W) * stay;
    }
    // work at the very end (the destination of a one-way walk) happens after the last step
    const endStay = +dwell[n - 1] || 0;
    tl.endUse = Object.fromEntries(RES.map((r) => [r.key, RATE[r.key](STATION_W) * endStay]));
    workJ += STATION_W * endStay * 3600; workH += endStay;
    tl.hours = tl.t[n - 1] + endStay;
    tl.avgW = tl.hours ? workJ / (tl.hours * 3600) : 0;
    tl.peakW = peakW || RIDE_W;
    Object.assign(tl, { walkH, driveH, workH, driveKm });
    return tl;
  }

  // compare what (part of) a route needs with what's in the suit
  function budget(needs, have = available()) {
    const keep = 1 - st.reservePct / 100;
    const items = RES.map((r) => {
      const need = needs[r.key], avail = have[r.key], usable = Math.max(0, avail * keep);
      return { ...r, need, avail, usable, frac: avail > 0 ? need / avail : Infinity, ok: need <= usable };
    });
    const limiting = items.reduce((a, b) => (b.need / (b.usable || 1e-9) > a.need / (a.usable || 1e-9) ? b : a));
    return { items, limiting, ok: items.every((x) => x.ok) };
  }
  const needsOf = (tl, i0 = 0, i1 = tl.t.length - 1) => Object.fromEntries(RES.map((r) =>
    [r.key, tl[r.key][i1] - tl[r.key][i0] + (i1 === tl.t.length - 1 ? tl.endUse?.[r.key] || 0 : 0)]));

  // hours and consumables to walk d metres with a height change of dz (for walk-back estimates)
  function stepCost(d, dz) {
    const s = d > 0 ? dz / d : 0, dt = d / 1000 / toblerKmh(s) / pace();
    const w = metabolicW(dt > 0 ? d / (dt * 3600) : 0, s * 100);
    return { t: dt, ...Object.fromEntries(RES.map((r) => [r.key, RATE[r.key](w) * dt])) };
  }

  // ---------- panel UI ----------
  const listeners = [];
  const onChange = (fn) => listeners.push(fn);
  function set(patch) {
    st = { ...st, ...patch };
    save();
    renderSummary();
    listeners.forEach((fn) => fn(st));
  }
  function renderSummary() {
    const el = document.getElementById("suit-summary");
    if (!el) return;
    const chip = (label, value, low) => `<span class="chip${low ? " low" : ""}"><b>${value}</b> ${label}</span>`;
    el.innerHTML = chip("O₂", `${st.o2Pct}%`, st.o2Pct < 40) + chip("battery", `${st.batteryPct}%`, st.batteryPct < 30) +
      chip("cooling water", `${st.waterPct}%`, st.waterPct < 30) + chip("CO₂ scrubber", `${(+st.co2Hours).toFixed(1)} h`, st.co2Hours < 2) +
      chip("carrying", `${st.loadKg} kg`) + chip("feeling", st.condition) +
      (st.heartRate ? chip("heart rate", `${st.heartRate} bpm`, st.heartRate > 160) : "") +
      (+st.crew === 2 ? chip("EV2 O₂", `${st.o2Pct2}%`, st.o2Pct2 < 40) + chip("EV2 battery", `${st.batteryPct2}%`, st.batteryPct2 < 30) : chip("crew", "solo", true)) +
      (st.rover !== "none" ? chip("support", st.rover === "pressurized" ? "pressurised rover" : "open rover") : "");
    const dot = document.getElementById("tab-me-dot");
    if (dot) dot.hidden = !(st.o2Pct < 40 || st.batteryPct < 30 || st.waterPct < 30 || st.co2Hours < 2 || st.heartRate > 160 ||
      (+st.crew === 2 && (st.o2Pct2 < 40 || st.batteryPct2 < 30 || st.waterPct2 < 30 || st.co2Hours2 < 2)));
    const ev2 = document.getElementById("ev2-set");
    if (ev2) ev2.hidden = +st.crew !== 2;
    const f = document.getElementById("suit-form");
    if (f && !f.contains(document.activeElement)) for (const [k, v] of Object.entries(st)) if (f.elements[k]) f.elements[k].value = v;
  }
  function bindForm() {
    const f = document.getElementById("suit-form");
    if (!f) return;
    f.addEventListener("input", (e) => {
      const el = e.target;
      if (!el.name) return;
      const v = el.type === "number" ? (el.value === "" ? "" : Math.max(+el.min || 0, Math.min(+el.max || 1e9, +el.value))) : el.value;
      set({ [el.name]: v });
    });
    f.addEventListener("submit", (e) => e.preventDefault());
    document.getElementById("suit-reset")?.addEventListener("click", () => set({ o2Pct: 100, batteryPct: 100, waterPct: 100, co2Hours: 8, heartRate: "",
      o2Pct2: 100, batteryPct2: 100, waterPct2: 100, co2Hours2: 8 }));
  }
  bindForm(); renderSummary(); // scripts are deferred, so the form is already in the page

  const rates = (w) => Object.fromEntries(RES.map((r) => [r.key, RATE[r.key](w)])); // per hour at power w
  const FULL = { o2: CAP.o2Kg, co2: 8, battery: CAP.batteryWh, water: CAP.waterKg };       // a full suit
  return { get state() { return st; }, CAP, FULL, RES, set, onChange, timeline, budget, needsOf, stepCost, available, whoLimits, pace, metabolicW, rates,
    STATION_W, RIDE_W, driveKmh };
})();
