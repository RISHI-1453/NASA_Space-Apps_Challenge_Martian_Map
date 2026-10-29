// An Apollo-style cuff checklist: the whole EVA on a page the crew can print, strap to a wrist or
// pin up in the habitat. Apollo 15–17 crews worked from cuff checklists and traverse maps with
// numbered stations; this is the same idea built from the planned route: a shaded-relief traverse
// map, the station timeline with the supplies expected at each station, and the turn-back rules.
const Checklist = (() => {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

  // shaded relief of the area from the same terrain the planner uses, as a PNG data URL
  async function relief(s, w, n, e, nx, ny) {
    const r = await fetch(`/api/terrain/area?s=${s}&w=${w}&n=${n}&e=${e}&nx=${nx}&ny=${ny}`);
    if (!r.ok) return null;
    const h = new Float32Array(await r.arrayBuffer());
    const cv = document.createElement("canvas");
    cv.width = nx; cv.height = ny;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(nx, ny);
    const mLat = (3389500 * Math.PI) / 180, dx = ((e - w) * mLat * Math.cos(((n + s) / 2) * Math.PI / 180)) / (nx - 1), dy = ((n - s) * mLat) / (ny - 1);
    let lo = Infinity, hi = -Infinity;
    for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const L = [-0.5, 0.6, 0.62]; // light from the north-west, like a printed map
    for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
      const k = i * nx + j, zx = (h[i * nx + Math.min(nx - 1, j + 1)] - h[i * nx + Math.max(0, j - 1)]) / (2 * dx),
        zy = (h[Math.max(0, i - 1) * nx + j] - h[Math.min(ny - 1, i + 1) * nx + j]) / (2 * dy);
      const len = Math.hypot(zx, zy, 1), shade = Math.max(0, (-zx * L[0] - zy * L[1] + L[2]) / len);
      const t = (h[k] - lo) / (hi - lo || 1), g = 150 + 90 * shade;
      img.data.set([g + 20 * t, g - 6 + 8 * t, g - 18, 255], k * 4); // warm paper tint, lighter uphill
    }
    ctx.putImageData(img, 0, 0);
    return { url: cv.toDataURL("image/png"), lo, hi };
  }

  async function open({ p, tl, labels, names, depart, finish, round, sci, wx, day }) {
    // a sheet over the app (pop-up windows get blocked in embedded browsers); printing prints only it
    close();
    const back = document.createElement("div");
    back.className = "cl-back";
    back.innerHTML = `<div class="cl-sheet"><p>Preparing the checklist…</p></div>`;
    back.onclick = (ev) => { if (ev.target === back) close(); };
    document.body.appendChild(back);
    document.body.classList.add("printing-cl");
    const outbound = waypoints.length - 1;
    const S = p.samples, out = S.filter((x) => x.leg < outbound);
    const la = out.map((x) => x.lat), lo = out.map((x) => x.lon);
    let s = Math.min(...la), n = Math.max(...la), w = Math.min(...lo), e = Math.max(...lo);
    const k = Math.cos(((s + n) / 2) * Math.PI / 180), padY = Math.max((n - s) * 0.15, 0.004), padX = Math.max((e - w) * 0.15, 0.004 / k);
    s -= padY; n += padY; w -= padX; e += padX;
    // square-ish metres per pixel; the map is 640 px wide
    const W = 640, H = Math.max(260, Math.min(640, Math.round((W * (n - s)) / ((e - w) * k))));
    const bg = await relief(s, w, n, e, 200, Math.max(60, Math.round((200 * H) / W))).catch(() => null);
    const X = (lon) => ((lon - w) / (e - w)) * W, Y = (lat) => ((n - lat) / (n - s)) * H;
    const stopIdx = [0, ...p.legs.map((l) => l.to_idx)];
    const kmPerPx = ((e - w) * k * 3389.5 * Math.PI) / 180 / W;
    const bar = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].find((b) => b / kmPerPx > 90) || 20;
    const segs = out.slice(1).map((x, i) => `<line x1="${X(out[i].lon).toFixed(1)}" y1="${Y(out[i].lat).toFixed(1)}" x2="${X(x.lon).toFixed(1)}" y2="${Y(x.lat).toFixed(1)}" stroke="${x.slope_deg > 15 ? "#c62828" : x.slope_deg > 8 ? "#ef8f00" : "#1a4fd6"}"/>`).join("");
    const pins = stopIdx.slice(0, outbound + 1).map((idx, j) => `<g transform="translate(${X(S[idx].lon).toFixed(1)},${Y(S[idx].lat).toFixed(1)})"><circle r="10" fill="${j === 0 ? "#2e7d32" : "#fff"}" stroke="#111" stroke-width="1.5"/><text y="4" text-anchor="middle" font-size="11" font-weight="700" fill="${j === 0 ? "#fff" : "#111"}">${labels[j]}</text></g>`).join("");
    const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="border:1px solid #333;background:#ddd">
      ${bg ? `<image href="${bg.url}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>` : ""}
      <g stroke-width="4" stroke-linecap="round">${segs}</g>${pins}
      <g transform="translate(${W - 34},34)"><polygon points="0,-18 7,6 0,1 -7,6" fill="#111"/><text y="20" text-anchor="middle" font-size="12" font-weight="700">N</text></g>
      <g transform="translate(16,${H - 16})"><rect width="${bar / kmPerPx}" height="5" fill="#111"/><text y="-5" font-size="11">${bar < 1 ? bar * 1000 + " m" : bar + " km"}</text></g>
      ${bg ? `<text x="${W - 8}" y="${H - 8}" text-anchor="end" font-size="10" fill="#333">relief ${Math.round(bg.lo)} to ${Math.round(bg.hi)} m</text>` : ""}
    </svg>`;

    const have = Suit.available(), full = Suit.FULL, reserve = Suit.state.reservePct / 100;
    const pct = (key, i) => Math.max(0, Math.round(((have[key] - tl[key][i]) / full[key]) * 100));
    const end = S.length - 1;
    // the turn-back rule at each station: what you need left there to finish with the reserve intact
    const minToGo = (i) => Suit.RES.map((r) => {
      const need = tl[r.key][end] - tl[r.key][i] + (tl.endUse?.[r.key] || 0) + full[r.key] * reserve;
      return r.key === "co2" ? `CO₂ ≥ ${need.toFixed(1)} h` : `${r.name.split(" ")[0]} ≥ ${Math.min(100, Math.ceil((need / full[r.key]) * 100))}%`;
    }).join(" · ");
    const rows = stopIdx.map((idx, j) => {
      const wp = j < waypoints.length ? waypoints[j] : null, task = wp ? Missions.taskAt(wp[0], wp[1]) : null;
      const work = wp ? +stopWork.get(llKey(wp)) || 0 : 0;
      return `<tr><td class="c"><b>${labels[j]}</b></td><td>${esc(names[j])}${task ? `<div class="t">${esc(task.task)}${task.kit ? ` <i>Kit: ${esc(task.kit)}</i>` : ""}</div>` : ""}</td>
        <td class="c">${MarsTime.hhmm(depart + tl.t[idx] / MARS_HOUR)}</td><td class="c">${(S[idx].dist_m / 1000).toFixed(2)}</td><td class="c">${Math.round(S[idx].elev_m)}</td>
        <td class="c">${pct("o2", idx)}%</td><td class="c">${work && (round ? j < waypoints.length : true) ? work + " min" : "—"}</td><td class="r">${j < stopIdx.length - 1 ? minToGo(idx) : "EVA complete"}</td></tr>`;
    }).join("");
    // worst case walk back to the start (shelter) from anywhere on the route
    let shelterH = 0;
    for (let i = 0; i <= end; i++) shelterH = Math.max(shelterH, round ? Math.min(tl.t[i], tl.hours - tl.t[i]) : tl.t[i]);
    const tb = sci && sci.turnBack !== null && sci.turnBack < end ? S[sci.turnBack] : null;
    const e2 = MarsTime.earth(), t = MarsTime.compute();
    const wxWord = wx ? { go: "GO", caution: "CAUTION", nogo: "NO-GO", unknown: "UNKNOWN" }[wx.level] : "—";
    const html = `
      <div class="bar"><div><div class="k">MARTIAN MAP · EVA CUFF CHECKLIST</div><h1>${esc(names[0])} → ${esc(names[outbound])}${round ? " and back" : ""}</h1></div><div class="cl-btns"><button type="button" data-print>🖨 Print</button><button type="button" data-close>✕ Close</button></div></div>
      <div class="grid" style="margin-top:8px">
        <div><span class="k">Depart</span> <b>${MarsTime.hhmm(depart)}</b> local solar time · back ≈ <b>${clock(finish)}</b>${day ? ` · sunset ${MarsTime.hhmm(day.set)}` : ""}</div>
        <div><span class="k">Mars Sol Date</span> ${t.msd.toFixed(0)} · Ls ${t.Ls.toFixed(0)}° · printed ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</div>
        <div><span class="k">Team</span> ${+Suit.state.crew === 2 ? "EV1 + EV2 (buddy pair)" : "Solo"}${Suit.state.rover !== "none" ? ` · ${Suit.state.rover === "lrv" ? "open rover" : "pressurised rover"} support` : ""} · carrying ${Suit.state.loadKg} kg</div>
        <div><span class="k">Distance</span> ${p.stats.distance_km.toFixed(2)} km · ↑ ${p.stats.ascent_m} m · max slope ${p.stats.max_slope_deg}° · ${fmtDur(tl.hours)} total</div>
      </div>
      <h2>Traverse map</h2>${svg}
      <div class="k" style="margin-top:4px">Route colour: blue under 8°, orange 8–15°, red over 15°. Terrain: ${esc(Object.keys(p.stats.dem_sources || {}).join(", "))}.</div>
      <h2>Stations</h2>
      <table><tr><th>Stn</th><th>Station and task</th><th>Arrive<br>LTST</th><th>km</th><th>Elev m</th><th>O₂ left</th><th>Work</th><th>Go on only if the lower suit has at least</th></tr>${rows}</table>
      <h2>Rules</h2>
      <ul>
        <li><b>Space weather: ${wxWord}</b>${wx ? ` — ${esc(wx.headline)}` : ""}. If a solar particle alert comes in, ${Suit.state.rover === "pressurized" ? "call in the pressurised rover — it is the shelter" : `walk straight back to ${labels[0]}: worst case from this route is <b>${fmtDur(shelterH)}</b>`}.</li>
        ${tb ? `<li><b>Point of no return</b> at ${(tb.dist_m / 1000).toFixed(2)} km: past it the suits can't get you back to ${labels[0]} with the reserve intact.</li>` : ""}
        <li><b>Reserve:</b> keep ${Suit.state.reservePct}% of every supply. Turn back at the first station where any reading is below the right-hand column.</li>
        <li><b>Buddy rule:</b> stay within sight and voice range; the pair turns back on the lower suit's readings.</li>
        <li><b>Steep ground:</b> ${p.hazards.length ? `${p.hazards.length} stretch(es) over 15° on this route — go around, never straight up` : "no stretches over 15° on the planned line"}.</li>
        <li><b>Earth is ${e2.lightMin.toFixed(0)} light-minutes away</b> (${(2 * e2.lightMin).toFixed(0)} min for an answer): decisions are made on site.</li>
      </ul>
      <div class="k" style="margin-top:14px">Terrain: USGS/NASA DEMs via Martian Map · supplies: Pandolf load-carriage model at Mars gravity, ISS-EMU-class suit · space weather: NASA DONKI, NOAA SWPC. A planning aid, not flight-certified.</div>
      `;
    if (!back.isConnected) return; // closed while the relief was loading
    const sheet = back.querySelector(".cl-sheet");
    sheet.innerHTML = html;
    sheet.querySelector("[data-print]").onclick = () => window.print();
    sheet.querySelector("[data-close]").onclick = close;
  }
  function close() {
    document.querySelector(".cl-back")?.remove();
    document.body.classList.remove("printing-cl");
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  return { open, close };
})();
