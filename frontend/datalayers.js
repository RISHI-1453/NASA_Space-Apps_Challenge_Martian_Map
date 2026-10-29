// Orbital science data, layered onto the map: what the ground is made of and how old it is, how
// rocky or dusty it is underfoot, where water once acted, and where there's exposed ice — or ground
// the crew must leave alone. Also the "What orbiters found here" card in Conditions and the
// "Science along the way" card under every route.
//
//   THEMIS night IR (Mars Odyssey) · TES thermal inertia + dust cover (MGS) · USGS SIM 3292 geologic
//   map · CRISM (MRO) + OMEGA (Mars Express) hydrous minerals · aqueous minerals by class ·
//   THEMIS chloride salts · HiRISE (MRO) fresh craters, exposed ice, RSL and active gullies
const DataLayers = (() => {
  // ---------- rasters (NASA Mars Trek tiles) ----------
  const nightIR = trek("THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018", "png", 9);
  const inertia = trek("TES_Thermal_Inertia", "png", 1, { opacity: 0.6 });
  const dust = trek("tes_ruffdust", "png", 2, { opacity: 0.6 });
  const geology = L.tileLayer("https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/WMTS/tile/1.0.0/SIM3292_Global_Geology/default/default028mm/{z}/{y}/{x}.png",
    { tileSize: 256, maxNativeZoom: 11, maxZoom: 18, noWrap: true, opacity: 0.55, attribution: "USGS SIM 3292 (Tanaka et al. 2014) · Mars Trek" });
  // ---------- points: minerals, salts, ice, active slopes ----------
  const minerals = L.layerGroup(), active = L.layerGroup();
  const renderer = L.canvas({ padding: 0.3 });
  const MINERAL = { // colours as in Ehlmann & Edwards (2014)'s map
    phyllosilicate: ["#3d9bff", "Clay minerals"], silica: ["#a46bff", "Opaline silica"], sulfate: ["#ff9f1c", "Sulfates"],
    chloride: ["#ffe14d", "Chloride salts"], carbonate: ["#2ecc71", "Carbonates"],
  };
  const ACTIVE = { ice: ["#dff6ff", "Ice exposed by a fresh crater"], keepout: ["#ff4d4d", "Recurring slope lineae: keep out"],
    unstable: ["#ff8c42", "Active gully (unstable)"], fresh: ["#b9b2ac", "Fresh impact crater"] };
  let raw = null, loaded = null;

  const popup = (it) => {
    const box = document.createElement("div");
    box.className = "place-pop";
    const img = it.image && it.image.trim() ? ` · HiRISE <a href="https://www.uahirise.org/${it.image.trim()}" target="_blank" rel="noopener">${it.image.trim()}</a>` : "";
    box.innerHTML = `<div class="pn">${it.name}</div><div class="pm">${it.what}.<br>${it.src}${img}<br>${fmtLatLon(it.lat, it.lon)} (±${it.prec})</div>`;
    box.appendChild(Dir.actions([it.lat, it.lon], it.name, { close: () => map.closePopup() }));
    return box;
  };
  function build() {
    if (loaded) return loaded;
    loaded = fetch("/api/science/features").then((r) => r.json()).then((d) => {
      raw = d;
      const dot = (layer, lat, lon, color, r, it, ring) => L.circleMarker([lat, lon], { renderer, radius: r, color: ring ? color : "#111", weight: ring ? 2 : 0.6,
        fillColor: color, fillOpacity: ring ? 0.15 : 0.85 }).bindPopup(() => popup(it)).addTo(layer);
      for (const [lat, lon, inst] of d.hydrous)
        dot(minerals, lat, lon, "#00d0ff", 3, { lat, lon, name: `Hydrated minerals (${inst})`, what: "Orbital spectra show water-bearing minerals: rock altered by liquid water", src: `${inst} · Carter et al. 2013`, prec: "~3 km" });
      for (const [lat, lon, cls] of d.aqueous) {
        const [c, name] = MINERAL[cls] || ["#ccc", cls];
        dot(minerals, lat, lon, c, 4, { lat, lon, name, what: WHAT[cls] || "A mineral that formed in water", src: "CRISM / OMEGA / THEMIS · Ehlmann & Edwards 2014", prec: "~1 km" });
      }
      for (const [lat, lon, km2] of d.chloride)
        dot(minerals, lat, lon, "#ffe14d", Math.max(4, Math.min(10, Math.sqrt(km2))), { lat, lon, name: "Chloride salt deposit", what: `About ${Math.max(1, Math.round(km2))} km² of salt left by evaporating water`, src: "THEMIS · Osterloo et al. 2010", prec: "100 m" }, true);
      for (const [lat, lon, typ, obs, ref] of d.active) {
        const g = /icy/.test(typ) ? "ice" : /RSL/.test(typ) ? "keepout" : /gully/.test(typ) ? "unstable" : "fresh";
        dot(active, lat, lon, ACTIVE[g][0], g === "fresh" ? 3 : 5, { lat, lon, name: ACTIVE[g][1], what: ACTIVE_WHAT[g], src: ref, image: obs, prec: "~0.5 km" });
      }
    });
    return loaded;
  }
  const WHAT = {
    phyllosilicate: "Formed by long contact with mild, neutral water — the best minerals for preserving organic matter",
    silica: "Left by hot springs or groundwater; on Earth such deposits keep microbial fossils",
    sulfate: "Left behind as acidic, salty water evaporated",
    chloride: "The salt flats of evaporating ponds and lakes",
    carbonate: "Formed in neutral-to-alkaline water; it can record the ancient atmosphere",
  };
  const ACTIVE_WHAT = {
    ice: "A recent impact dug up clean water ice here — a water resource within reach of a drill",
    keepout: "Dark streaks that grow each warm season. A candidate Special Region: planetary protection says crews and kit stay off it",
    unstable: "Slopes that are still moving today (seasonal CO₂ frost and sand) — unstable ground",
    fresh: "Formed in the last few decades; fresh rock, but loose blocks around the rim",
  };
  // ---------- what each science layer means: shown in the Layers panel and in the legend chip ----------
  const key = (c, t, ring) => `<span class="dl-key"><i style="background:${ring ? "transparent" : c};border-color:${c}"></i>${t}</span>`;
  const LEGEND = [
    [nightIR, "Night infrared", () => `<i>Bright</i>: rock and bedrock that stay warm at night (firm footing, sharp blocks). <i>Dark</i>: fine dust and sand (soft, slow going).`],
    [geology, "Geologic map", () => `Each colour is a rock unit. The unit and its age at any spot are in <i>Conditions → What orbiters found here</i>.`],
    [inertia, "Thermal inertia", () => `<span class="dl-ramp ti"></span> low: loose dust → high: rock, bedrock, ice`],
    [dust, "Dust cover", () => `<span class="dl-ramp dci"></span> thick dust (hides the rock, clogs joints) → dust-free`],
    [minerals, "Water-formed minerals", () => Object.values(MINERAL).map(([c, t]) => key(c, t)).join("") + key("#00d0ff", "hydrated (CRISM/OMEGA)") + key("#ffe14d", "salt deposit", true)],
    [active, "Ice & active slopes", () => Object.values(ACTIVE).map(([c, t]) => key(c, t)).join("")],
  ];
  const legendOf = (layer) => LEGEND.find((l) => l[0] === layer)[2];
  layersControl.addBaseLayer(nightIR, "THEMIS night infrared", { note: "Mars Odyssey · 100 m · rock vs dust", legend: legendOf(nightIR) });
  layersControl.addOverlay(geology, "Geologic map", { group: "Science data", note: "USGS SIM 3292 · rock units and their ages", legend: legendOf(geology) });
  layersControl.addOverlay(inertia, "Thermal inertia", { group: "Science data", note: "MGS TES · how firm the ground is", legend: legendOf(inertia) });
  layersControl.addOverlay(dust, "Dust cover", { group: "Science data", note: "MGS TES · where dust hides the rock", legend: legendOf(dust) });
  layersControl.addOverlay(minerals, "Water-formed minerals", { group: "Science data", note: "CRISM · OMEGA · THEMIS: clays, silica, salts…", legend: legendOf(minerals) });
  layersControl.addOverlay(active, "Ice & active slopes", { group: "Science data", note: "HiRISE: exposed ice, RSL keep-outs, gullies", legend: legendOf(active) });
  map.on("layeradd", (e) => { if (e.layer === minerals || e.layer === active) build(); });
  map.on("layeradd layerremove", (e) => { if (LEGEND.some((l) => l[0] === e.layer)) legend(); });

  // a small "Legend" chip on the map, closed until asked for; it only exists while a science layer is on
  const Legend = L.Control.extend({ options: { position: "bottomleft" }, onAdd() {
    const d = L.DomUtil.create("div", "map-legend");
    d.innerHTML = `<button type="button" class="map-btn lg-toggle" aria-expanded="false"></button><div class="lg-body" hidden></div>`;
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
    d.querySelector(".lg-toggle").onclick = () => { const b = d.querySelector(".lg-body"); b.hidden = !b.hidden; legend(); };
    return d;
  } });
  const leg = new Legend().addTo(map);
  function legend() {
    const el = leg.getContainer(), on = LEGEND.filter(([l]) => map.hasLayer(l)), body = el.querySelector(".lg-body");
    el.hidden = !on.length;
    el.querySelector(".lg-toggle").textContent = body.hidden ? `ⓘ Legend · ${on.length}` : "ⓘ Legend ✕";
    el.querySelector(".lg-toggle").setAttribute("aria-expanded", String(!body.hidden));
    body.innerHTML = on.map(([, name, html]) => `<div><b>${name}</b> ${html()}</div>`).join("");
  }
  legend();

  // ---------- Conditions: what orbiters found at a place ----------
  let hereTimer = null, hereKey = "";
  function here(lat, lon) {
    clearTimeout(hereTimer);
    hereTimer = setTimeout(() => showHere(lat, lon), 350); // the map centre moves a lot; wait for it to settle
  }
  async function showHere(lat, lon) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`, el = document.getElementById("whats-here");
    if (!el || key === hereKey) return;
    hereKey = key;
    let d;
    try { d = await (await fetch(`/api/science/near?lat=${lat}&lon=${lon}&km=25`)).json(); } catch { return; }
    if (hereKey !== key) return;
    const cite = Science.cite, rows = [];
    const row = (cls, ic, html) => rows.push(`<div class="sci-row ${cls}"><span class="sci-ic">${ic}</span><div>${html}</div></div>`);
    if (d.geology) row("", "🪨", `Geologic unit <b>${d.geology.unit}</b>: ${d.geology.name}, ${d.geology.age_text}${cite("tanaka2014")}.`);
    const mins = d.features.filter((f) => f.group === "mineral"), ice = d.features.filter((f) => f.group === "ice"),
      keep = d.features.filter((f) => f.group === "keepout"), unstable = d.features.filter((f) => f.group === "unstable");
    if (keep.length) row("warn", "⛔", `${keep[0].name} ${fmtKm(keep[0].km)} away: ${keep[0].what}${cite("rummel2014", "mcewen2014")}.`);
    if (ice.length) row("ok", "🧊", `${ice[0].name} ${fmtKm(ice[0].km)} away: ${ice[0].what}${cite("dundas2014")}.`);
    if (unstable.length) row("warn", "⚠", `${unstable[0].name} ${fmtKm(unstable[0].km)} away: ${unstable[0].what}.`);
    if (mins.length) {
      const seen = new Set(), list = mins.filter((m) => !seen.has(m.name) && seen.add(m.name)).slice(0, 4);
      row("", "💎", `Water-formed minerals within 25 km: ${list.map((m) => `<b>${m.name}</b> ${fmtKm(m.km)} away`).join(" · ")}. ${list[0].what}${cite("carter2013", "ehlmann2014")}.`);
    } else row("", "💎", `No water-formed minerals mapped within 25 km${cite("carter2013", "ehlmann2014")} — orbital spectra are blind under thick dust, so check the <i>Dust cover</i> layer.`);
    row("", "🌡", `How firm is the ground? Turn on <i>THEMIS night infrared</i> or <i>Thermal inertia</i> in the layers menu: ground that stays warm at night is rock; ground that cools fast is loose dust or sand${cite("fergason2006", "putzig2007")}.`);
    el.innerHTML = rows.join("");
  }

  // ---------- route: science along the way ----------
  let alongToken = 0;
  async function along(p, outbound) {
    const token = ++alongToken, el = document.getElementById("along");
    if (!el) return;
    const S = p.samples.filter((s) => s.leg < outbound);
    const step = Math.max(1, Math.ceil(S.length / 4000)), pts = S.filter((_, i) => i % step === 0);
    el.innerHTML = `<div class="sci fold"><div class="sci-head">🧭 Science along the way <span class="badge"><span class="gv-spin"></span> checking</span></div></div>`;
    let d;
    try {
      const r = await fetch("/api/science/along", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: pts.map((s) => [s.lat, s.lon]), km: 2 }) });
      d = await r.json();
    } catch { if (token === alongToken) el.innerHTML = ""; return; }
    if (token !== alongToken || !document.getElementById("along")) return;
    const cite = Science.cite, rows = [];
    const row = (cls, ic, html) => rows.push(`<div class="sci-row ${cls}"><span class="sci-ic">${ic}</span><div>${html}</div></div>`);
    if (d.geology.length) {
      const units = d.geology.map((g) => `<b>${g.unit}</b> (${g.name.replace(/ unit$/, "")}, ${g.age})`);
      row("", "🪨", (d.geology.length === 1 ? `The whole walk is on one geologic unit: ${units[0]}` : `The walk crosses ${d.geology.length} geologic units: ${units.join(" → ")}. Unit contacts are where the story of an area is told — sample both sides`) + cite("tanaka2014") + ".");
    }
    const legName = (i) => { const s = pts[i]; return s ? `${lastLabels[s.leg] || "A"}→${lastLabels[s.leg + 1] || "B"}` : ""; };
    const hits = d.features.filter((f) => f.group !== "fresh");
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const km = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(a[0] * Math.PI / 180)) * 59.16;
    for (const f of hits.slice(0, 6)) {
      const s = pts[f.route_idx], atStop = waypoints.findIndex((w) => km(w, [f.lat, f.lon]) < 0.4);
      const where = atStop >= 0 ? `at stop ${lastLabels[atStop]}` : `${fmtKm(f.km)} from the route on leg ${legName(f.route_idx)}, ${fmtKm(s.dist_m / 1000)} in`;
      if (f.group === "keepout") row("warn", "⛔", `<b>${f.name}</b> ${where}: ${f.what}${cite("rummel2014")}.`);
      else row(f.group === "ice" ? "ok" : "", f.group === "ice" ? "🧊" : f.group === "unstable" ? "⚠" : "💎",
        `<b>${f.name}</b> ${where}. ${cap(f.what)}.` + (atStop >= 0 ? "" : ` <button type="button" class="link add-sci" data-i="${d.features.indexOf(f)}">+ Add as a science stop</button>`));
    }
    if (!hits.length) row("", "💎", `No mapped mineral, salt or ice detections within 2 km of this route${cite("carter2013", "ehlmann2014")}. Orbital maps are kilometre-scale: at the stops, look for colour changes, veins and layering that only a person on the ground can see.`);
    const n = hits.filter((f) => f.group !== "keepout").length, keepouts = hits.filter((f) => f.group === "keepout").length;
    const badge = keepouts ? `<span class="badge warn">⛔ ${keepouts} keep-out</span>` : n ? `<span class="badge go">${n} target${n > 1 ? "s" : ""} nearby</span>` : `<span class="badge">geology only</span>`;
    el.innerHTML = `<details class="sci fold"${keepouts ? " open" : ""}><summary class="sci-head">🧭 Science along the way ${badge}</summary>${rows.join("")}</details>`;
    el.querySelectorAll(".add-sci").forEach((b) => (b.onclick = () => {
      const f = d.features[+b.dataset.i], s = pts[f.route_idx];
      const at = Math.min(waypoints.length - 1, s.leg + 1);
      waypoints.splice(at, 0, [f.lat, f.lon]);
      wpNames.splice(at, 0, f.name);
      stopWork.set(llKey([f.lat, f.lon]), 20); // time to look, photograph and sample
      redrawRoute();
    }));
  }

  return { here, along, layers: { nightIR, inertia, dust, geology, minerals, active }, build, show(names) {
    for (const n of names) { const l = DataLayers.layers[n]; if (l && !map.hasLayer(l)) { if (l === nightIR) map.eachLayer((x) => Object.values(baseLayers).includes(x) && map.removeLayer(x)); l.addTo(map); } }
  } };
})();
