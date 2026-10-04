// Astronaut & suit status → what a walk will cost.
//
// The astronaut reports consumables (O2, battery, cooling water, CO2 scrubber), body mass, what
// they're carrying and how they feel. For every step of a route we estimate metabolic power with
// the Pandolf et al. (1977) load-carriage equation, scaled to Mars gravity and a pressurised suit,
// then turn power into O2, CO2-scrubber, cooling-water and battery use.
// Capacities default to ISS-EMU-class figures; edit CAP for a Mars suit design.
const Suit = (() => {
  const KEY = "martianmap.suit";
  const DEFAULTS = { o2Pct: 100, batteryPct: 100, waterPct: 100, co2Hours: 8, bodyKg: 80, loadKg: 15, condition: "normal", reservePct: 20, heartRate: "" };
  const CAP = {
    o2Kg: 0.54,       // primary O2 bottle (EMU ≈ 1.2 lb)
    batteryWh: 400,   // suit battery
    waterKg: 3.6,     // cooling feedwater
    suitKg: 50,       // suit + life-support backpack mass
    co2RatedW: 300,   // scrubber hours are rated at this metabolic rate
    systemsW: 45,     // fans, pumps, radio, lights
  };
  const PACE = { fresh: 1.0, normal: 0.9, tired: 0.75 };
  const MARS_G = 3.721 / 9.807;
  const SUIT_PENALTY = 1.3; // extra effort of moving joints in a pressurised suit
  const TERRAIN = 1.3;      // Pandolf terrain factor for loose regolith

  let st = { ...DEFAULTS, ...load() };
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }

  // metabolic power (W) walking at v m/s on a grade (%): Pandolf 1977, gravity-scaled
  function metabolicW(v, gradePct) {
    const W = st.bodyKg, L = CAP.suitKg + st.loadKg;
    const G = gradePct >= 0 ? gradePct : -gradePct * 0.3; // going downhill still costs a little
    const standing = 1.5 * W;
    const carrying = 2.0 * (W + L) * (L / W) ** 2 * MARS_G;
    const moving = TERRAIN * (W + L) * (1.5 * v * v + 0.35 * v * G) * MARS_G * SUIT_PENALTY;
    return Math.min(900, Math.max(150, standing + carrying + moving));
  }
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

  const available = (s = st) => ({
    o2: (CAP.o2Kg * s.o2Pct) / 100, battery: (CAP.batteryWh * s.batteryPct) / 100,
    water: (CAP.waterKg * s.waterPct) / 100, co2: +s.co2Hours,
  });
  const pace = () => PACE[st.condition] || 0.9;

  // cumulative walking hours and consumables at every sample of a route profile
  function timeline(p) {
    const S = p.samples, n = S.length, k = pace();
    const tl = { t: new Float64Array(n), o2: new Float64Array(n), co2: new Float64Array(n), battery: new Float64Array(n), water: new Float64Array(n) };
    let workJ = 0, peakW = 0;
    for (let i = 1; i < n; i++) {
      const dt = Math.max(0, (S[i].t_h - S[i - 1].t_h) / k);
      const d = S[i].dist_m - S[i - 1].dist_m;
      const v = dt > 0 ? d / (dt * 3600) : 0;
      const w = metabolicW(v, d > 0 ? ((S[i].elev_m - S[i - 1].elev_m) / d) * 100 : 0);
      workJ += w * dt * 3600; peakW = Math.max(peakW, w);
      tl.t[i] = tl.t[i - 1] + dt;
      for (const r of RES) tl[r.key][i] = tl[r.key][i - 1] + RATE[r.key](w) * dt;
    }
    tl.hours = tl.t[n - 1];
    tl.avgW = tl.hours ? workJ / (tl.hours * 3600) : 0;
    tl.peakW = peakW;
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
  const needsOf = (tl, i0 = 0, i1 = tl.t.length - 1) => Object.fromEntries(RES.map((r) => [r.key, tl[r.key][i1] - tl[r.key][i0]]));

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
      (st.heartRate ? chip("heart rate", `${st.heartRate} bpm`, st.heartRate > 160) : "");
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
    document.getElementById("suit-reset")?.addEventListener("click", () => set({ o2Pct: 100, batteryPct: 100, waterPct: 100, co2Hours: 8, heartRate: "" }));
  }
  document.addEventListener("DOMContentLoaded", () => { bindForm(); renderSummary(); });
  if (document.readyState !== "loading") { bindForm(); renderSummary(); }

  const rates = (w) => Object.fromEntries(RES.map((r) => [r.key, RATE[r.key](w)])); // per hour at power w
  const FULL = { o2: CAP.o2Kg, co2: 8, battery: CAP.batteryWh, water: CAP.waterKg };       // a full suit
  return { get state() { return st; }, CAP, FULL, RES, set, onChange, timeline, budget, needsOf, available, pace, metabolicW, rates };
})();
