// Space weather for the EVA go/no-go: is anything on the Sun aimed at Mars right now?
//
// /api/spaceweather brings NASA DONKI (flares with source positions, particle events, CMEs whose
// WSA-ENLIL run predicts a Mars arrival) and NOAA SWPC (GOES protons and X-ray flares, today's
// sunspot regions). All of that is seen from Earth. Mars is somewhere else around the Sun, so this
// works out, from the two planets' orbits, which side of the Sun faces Mars and which regions
// are magnetically connected to it — that's where the particles that reach Mars come from.
const SpaceWx = (() => {
  const REFRESH_MS = 15 * 60 * 1000;
  const S1_PFU = 10;          // NOAA S1 radiation storm: >=10 MeV protons at 10 pfu
  const ROT_DEG_DAY = 13.2;   // the Sun turns ~13.2° a day as seen from the planets
  const CONNECT_W = 80;       // Parker-spiral footpoint for Mars (~1.5 AU, 400 km/s wind): ~80° west of the sub-Mars point
  let data = null, loading = null;
  const listeners = [];
  const ang = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
  // "S18W83" -> {lat: -18, lonW: 83}: heliographic, west positive (towards the Sun's right limb from Earth)
  const parseLoc = (s) => {
    const m = /^([NS])(\d+)([EW])(\d+)/i.exec(s || "");
    return m ? { lat: (m[1].toUpperCase() === "S" ? -1 : 1) * +m[2], lonW: (m[3].toUpperCase() === "W" ? 1 : -1) * +m[4] } : null;
  };
  const lonText = (w) => { const x = Math.round((((w % 360) + 540) % 360) - 180); return x >= 0 ? `W${x}°` : `E${-x}°`; };
  const ago = (iso) => (Date.now() - Date.parse(iso)) / 3.6e6; // hours
  const fmtAgo = (h) => (h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`);
  const fmtIn = (h) => (h < 0 ? fmtAgo(-h) : h < 48 ? `in ${Math.round(h)} h` : `in ${Math.round(h / 24)} days`);

  async function load(force = false) {
    if (loading) return loading;
    if (data && !force && Date.now() - data._t < REFRESH_MS) return data;
    loading = fetch("/api/spaceweather").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
      loading = null;
      if (d) { data = { ...d, _t: Date.now() }; listeners.forEach((fn) => fn()); render(); }
      return data;
    });
    return loading;
  }

  // where Mars is around the Sun, as seen from Earth
  function geometry() {
    const e = MarsTime.earth();
    const sub = e.sepDeg;                   // the sub-Mars point on the Sun, in Earth-view heliographic longitude (W +)
    return { sep: e.sepDeg, sub, connect: sub + CONNECT_W, earthSees: Math.max(0, 180 - Math.abs(sub)) / 180, au: e.marsAU };
  }

  // the go/no-go, with the reasons behind it
  function assess() {
    if (!data) return { level: "unknown", headline: "space weather not loaded yet", reasons: [] };
    const g = geometry(), reasons = [], why = (lvl, text) => reasons.push({ lvl, text });
    const shared = Math.abs(g.sep) < 60; // Earth and Mars on roughly the same side of the Sun
    const d = data.donki;
    // particles: measured at Earth (GOES), and events DONKI logged with Mars-side instruments
    const pf = data.protons?.now_pfu;
    if (pf != null && pf >= S1_PFU) why(shared ? "nogo" : "caution", `a solar radiation storm is under way at Earth (GOES ≥10 MeV protons ${pf.toFixed(0)} pfu)${shared ? ", and Mars is on the same side of the Sun" : ""}`);
    for (const s of d?.seps || []) {
      const h = ago(s.time), atMars = s.instruments.some((i) => /MAVEN|MSL|Mars/i.test(i));
      if (atMars && h < 24) why("nogo", `a solar particle event was recorded at Mars ${fmtAgo(h)} (${s.instruments.join(", ")})`);
    }
    // CMEs the NASA model sends to Mars
    for (const c of d?.mars_cmes || []) {
      const h = -ago(c.arrival);
      if (h > -6 && h < 18) why("nogo", `a coronal mass ejection is due at Mars ${fmtIn(h)}${c.glancing ? " (glancing blow)" : ""} — its shock can bring a burst of energetic particles`);
      else if (h >= 18 && h < 72) why("caution", `a coronal mass ejection is forecast to reach Mars ${fmtIn(h)} (NASA WSA-ENLIL)`);
    }
    // big flares from the side facing Mars or connected to it
    const flares = d?.flares?.length ? d.flares : (data.xray_flares || []).map((f) => ({ ...f, location: null }));
    for (const f of flares) {
      if (!/^[MX]/.test(f.class || "")) continue;
      const h = ago(f.peak), loc = parseLoc(f.location);
      if (h > 24) continue;
      const facing = loc ? ang(loc.lonW, g.sub) < 90 : shared, connected = loc && ang(loc.lonW, g.connect) < 45;
      if (facing || connected) why(f.class[0] === "X" ? "nogo" : "caution",
        `${f.class} flare ${fmtAgo(h)}${loc ? ` from ${f.location}, ${connected ? "magnetically connected to Mars" : "on the side facing Mars"}` : ""} — particles can follow within hours`);
    }
    // sunspot regions turned towards Mars that may flare
    for (const r of data.regions || []) {
      const loc = parseLoc(r.location);
      if (!loc || ang(loc.lonW, g.sub) >= 90) continue;
      if ((r.proton_prob ?? 0) >= 10 || (r.x_prob ?? 0) >= 10)
        why("caution", `sunspot region ${r.region} (${r.location}) faces Mars with a ${Math.max(r.proton_prob ?? 0, r.x_prob ?? 0)}% chance of a major flare or proton event`);
    }
    const level = reasons.some((r) => r.lvl === "nogo") ? "nogo" : reasons.some((r) => r.lvl === "caution") ? "caution"
      : data.unavailable?.length >= 4 ? "unknown" : "go";
    const headline = level === "go" ? "quiet — nothing on the Sun is aimed at Mars" : level === "unknown" ? "space-weather services unreachable" : reasons.find((r) => r.lvl === level).text;
    return { level, headline, reasons, geometry: g };
  }

  // the Conditions-tab card
  function render() {
    const el = document.getElementById("spacewx");
    if (!el || !data) return;
    const a = assess(), g = a.geometry || geometry();
    const cite = Science.cite;
    const ICON = { go: "🟢", caution: "🟠", nogo: "🔴", unknown: "⚪" }, WORD = { go: "GO", caution: "CAUTION", nogo: "NO-GO", unknown: "UNKNOWN" };
    const rows = [];
    const row = (cls, ic, html) => rows.push(`<div class="sci-row ${cls}"><span class="sci-ic">${ic}</span><div>${html}</div></div>`);
    row(a.level === "go" ? "ok" : a.level === "unknown" ? "" : "warn", ICON[a.level],
      `<b class="wx-${a.level}">EVA ${WORD[a.level]}:</b> ${a.headline}.` + (a.reasons.length > 1 ? `<ul class="wx-list">${a.reasons.slice(1).map((r) => `<li>${r.text}</li>`).join("")}</ul>` : ""));
    const side = Math.abs(g.sep) < 15 ? "almost in line with Earth" : `${Math.abs(g.sep).toFixed(0)}° ${g.sep > 0 ? "ahead of" : "behind"} Earth`;
    row("", "🪐", `Mars is ${side} in its orbit, so ${g.earthSees > 0.8 ? "Earth sees almost all" : g.earthSees > 0.5 ? "Earth sees most" : g.earthSees > 0.2 ? "Earth sees only part" : "Earth sees little"} of the face of the Sun turned to Mars.` +
      (Math.abs(g.sub) > 60 ? " Flares from the hidden part reach Mars without warning from Earth-side telescopes." : "") +
      ` Particles reach Mars mostly from flares near ${lonText(g.connect)} on the Sun as Earth sees it, where the field line to Mars starts` +
      (ang(g.connect, 0) > 90 ? " — on the far side, out of Earth's view." : "."));
    const pf = data.protons?.now_pfu;
    const flares = data.donki?.flares?.length ? data.donki.flares : data.xray_flares || [];
    const big = flares.filter((f) => /^[MX]/.test(f.class || "") && ago(f.peak) < 168);
    row("", "📡", `${pf != null ? `GOES protons (≥10 MeV) at Earth: <b>${pf < 1 ? pf.toFixed(2) : pf.toFixed(0)} pfu</b> (storm level is 10). ` : ""}` +
      `M/X flares in the last 7 days: <b>${big.length ? big.map((f) => f.class).join(", ") : "none"}</b>. ` +
      (data.donki ? `NASA's model runs send <b>${data.donki.mars_cmes.length ? data.donki.mars_cmes.length + " CME(s)" : "no CMEs"}</b> to Mars this week.` : "NASA DONKI (flare positions, CMEs to Mars) is unreachable right now — using NOAA's Earth-side data only.") +
      `<div class="muted">Sources: NASA DONKI, NOAA SWPC GOES · updated ${new Date(data.fetched).toUTCString().slice(17, 22)} UTC</div>`);
    row("", "🛡", `Why it matters: on 20 May 2024 particles from one X-class flare gave Curiosity's radiation detector about 8.1 mGy in a day — some 30 chest X-rays${cite("jpl2024")}. The fastest particles can arrive within an hour of a flare, so a crew outside needs to know how quickly it can reach shelter (the route check shows yours).`);
    el.innerHTML = rows.join("");
  }

  load();
  setInterval(() => load(true), REFRESH_MS);
  return { load, assess, geometry, onChange: (fn) => listeners.push(fn), get data() { return data; } };
})();
