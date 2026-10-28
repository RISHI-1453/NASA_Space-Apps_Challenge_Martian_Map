// OrbitStudio (orbitstudio3d.com): physical relief models of where the crew will walk, and a guide
// to Mars' major landmarks.
//  • 🖨 Print model opens OrbitStudio, which turns NASA elevation data into a 3D-printable terrain
//    model (STL or multicolour 3MF) for a habitat or home 3D printer: a model to brief an EVA
//    around a table, tracing the route and feeling the slopes, much as Apollo crews studied relief
//    models of their landing sites. Generating and previewing is free; downloading the print file
//    needs an OrbitStudio plan or credit.
//  • Landmarks: OrbitStudio's travel list of 45 Mars places — volcanoes, canyons, craters, basins,
//    polar caps and every landing site — on the map and in the Sites tab.
const Orbit = (() => {
  const APP = "https://orbitstudio3d.com/app";
  // a 20 cm square tile with heights doubled, so gentle Martian slopes are easy to see and feel
  const SETTINGS = { type: "ornament", shape: "square", size: 200, relief: 2 };
  const MIN_KM = 24;          // OrbitStudio's smallest selection on Mars
  const KM_PER_DEG = 59.27;   // on the 3,396 km Mars sphere OrbitStudio uses
  const PHOTO = "https://orbitstudio3d.com/images/mars-puzzle-round-web.jpg";
  const GROUP_ONE = { "Landing Sites": "landing site", Volcanoes: "volcano", "Valles Marineris": "canyon", Craters: "crater",
    "Channels and Fossae": "channel", "Plains and Basins": "plain / basin", "Polar Caps": "polar cap" };
  let landmarks = [], groups = [];
  const layer = L.layerGroup().addTo(map);
  layersControl.addOverlay(layer, "Landmarks (OrbitStudio)");

  // the most specific OrbitStudio place whose box contains a point, if any
  function placeFor(lat, lon) {
    const inside = landmarks.filter((p) => Math.abs(lat - p.lat) <= p.box_km[1] / 2 / KM_PER_DEG &&
      Math.abs(lon - p.lon) <= p.box_km[0] / 2 / (KM_PER_DEG * Math.cos(p.lat * Math.PI / 180)));
    return inside.sort((a, b) => a.box_km[0] * a.box_km[1] - b.box_km[0] * b.box_km[1])[0] || null;
  }
  const appLink = (place) => `${APP}?${new URLSearchParams(place ? { place: place.id, ...SETTINGS } : {})}`;
  const distKm = (a, b) => {
    const r = Math.PI / 180, h = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
    return 2 * 3389.5 * Math.asin(Math.sqrt(h));
  };

  // ---------- the print dialog ----------
  function openPrint({ lat, lon, name = "This spot", spanKm = 0, place } = {}) {
    close();
    place = place || placeFor(lat, lon);
    const coords = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const back = document.createElement("div");
    back.className = "os-back";
    back.innerHTML = `
      <div class="os-card" role="dialog" aria-modal="true" aria-label="3D-print a relief model">
        <button type="button" class="os-x" aria-label="Close">✕</button>
        <div class="os-head">
          <img src="${PHOTO}" alt="A Mars terrain model printed with OrbitStudio" loading="lazy">
          <div><div class="os-title">🖨 3D-print a relief model</div>
            <div class="os-sub">${name} · ${fmtLatLon(lat, lon)}</div></div>
        </div>
        <p>A model you can hold lets the crew brief the walk around a table — trace the route, point at the
          steep parts, agree where to turn back — much as Apollo crews studied relief models of their landing
          sites. <b>OrbitStudio</b> turns NASA elevation data into a model for a habitat or home 3D printer.</p>
        ${place ? `
          <a class="os-go" href="${appLink(place)}" target="_blank" rel="noopener">Open OrbitStudio at ${place.name} ↗</a>
          <p class="os-small">Opens with a 20 cm square model and relief ×2 (heights doubled, so slopes are easy to see and
            feel); change either before you press <b>Generate</b>. To centre it exactly on this spot, use
            <b>Jump to Coordinates</b>: <code>${coords}</code> <button type="button" class="os-copy">Copy</button></p>`
        : `
          <a class="os-go" href="${APP}" target="_blank" rel="noopener">Open OrbitStudio ↗</a>
          <p class="os-small">Choose <b>Mars</b>, enter <code>${coords}</code> <button type="button" class="os-copy">Copy</button>
            under <b>Jump to Coordinates</b> and press <b>Fly</b>. A 20 cm model with relief ×2 makes the slopes easy to feel.</p>`}
        <ul class="os-notes">
          <li>The smallest Mars model covers ${MIN_KM} km${spanKm ? ` — your route spans ${fmtKm(spanKm)}, so the model also shows the land around it. Mark the route on the print with a marker or a thread.` : "."}</li>
          <li>Built from NASA elevation data: crater rims, hills and valleys show; boulders and small scarps don't.</li>
          <li>Generating and previewing a model is free, with no account. Downloading the print file needs an OrbitStudio plan or a download credit.</li>
        </ul>
      </div>`;
    document.body.appendChild(back);
    const shut = () => close();
    back.querySelector(".os-x").onclick = shut;
    back.onclick = (e) => { if (e.target === back) shut(); };
    back.querySelector(".os-copy").onclick = async (e) => {
      try { await navigator.clipboard.writeText(coords); e.target.textContent = "Copied"; } catch { e.target.textContent = coords; }
    };
    back.querySelector(".os-go").focus();
  }
  function close() { document.querySelector(".os-back")?.remove(); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  // a "🖨 Print model" button for popups and cards
  function button(lat, lon, name, opts = {}) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = "🖨 Print model";
    b.title = "3D-print a relief model of this area (OrbitStudio)";
    b.onclick = () => { map.closePopup(); openPrint({ lat, lon, name, ...opts }); };
    return b;
  }

  // ---------- landmarks: map markers and the Sites-tab guide ----------
  function actions(p) {
    const box = document.createElement("div");
    box.appendChild(Dir.actions([p.lat, p.lon], p.name, { close: () => map.closePopup() }));
    const more = document.createElement("div");
    more.className = "place-actions";
    const b3d = document.createElement("button");
    b3d.type = "button"; b3d.textContent = "🌐 3D";
    b3d.onclick = () => { map.closePopup(); Globe.open({ lat: p.lat, lon: p.lon, name: p.name, alt: Math.max(p.box_km[0], p.box_km[1]) * 400 }); };
    more.append(b3d, button(p.lat, p.lon, p.name, { place: p }));
    box.appendChild(more);
    return box;
  }
  function addToMap() {
    for (const p of landmarks) {
      const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "lm-pin", html: "◆", iconSize: [14, 14], iconAnchor: [7, 7] }), keyboard: false })
        .bindTooltip(p.name, { direction: "top", offset: [0, -6] })
        .on("click", () => updateConditions(p.lat, p.lon, p.name))
        .addTo(layer);
      m.bindPopup(() => {
        const box = document.createElement("div");
        box.className = "place-pop";
        box.innerHTML = `<div class="pn">${p.name}</div><div class="pm">${GROUP_ONE[p.group] || p.group} · ${fmtLatLon(p.lat, p.lon)}<br>${p.description}</div>`;
        box.appendChild(actions(p));
        return box;
      }, { maxWidth: 280 });
    }
  }
  function renderList() {
    const el = $("lm-list");
    if (!el) return;
    const q = ($("lm-q").value || "").trim().toLowerCase();
    const hit = (p) => !q || p.name.toLowerCase().includes(q) || p.group.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
    el.innerHTML = "";
    for (const g of groups) {
      const items = landmarks.filter((p) => p.group === g && hit(p));
      if (!items.length) continue;
      const sec = document.createElement("details");
      sec.className = "lm-group";
      sec.open = !!q || g === "Landing Sites";
      sec.innerHTML = `<summary>${g} <span class="muted">${items.length}</span></summary>`;
      for (const p of items) {
        const card = document.createElement("article");
        card.className = "lm";
        const far = me ? ` · ${Math.round(distKm(me, [p.lat, p.lon])).toLocaleString()} km from you` : "";
        card.innerHTML = `<div class="lm-name">${p.name}</div><div class="lm-d">${p.description}</div>
          <div class="lm-m">${fmtLatLon(p.lat, p.lon)} · ${p.elev_m.toLocaleString()} m${far}</div>`;
        const fly = document.createElement("button");
        fly.type = "button"; fly.textContent = "Fly there";
        fly.onclick = () => { map.flyTo([p.lat, p.lon], zoomFor(Math.max(p.box_km[0], p.box_km[1]) * 0.6)); updateConditions(p.lat, p.lon, p.name); };
        const row = actions(p);
        row.querySelector(".place-actions").prepend(fly);
        card.appendChild(row);
        sec.appendChild(card);
      }
      el.appendChild(sec);
    }
    if (!el.children.length) el.innerHTML = `<p class="muted small">No landmark matches “${q}”.</p>`;
  }
  $("lm-q").addEventListener("input", renderList);

  fetch("/api/landmarks").then((r) => r.json()).then((d) => {
    landmarks = d.landmarks; groups = d.groups;
    renderList();
    addToMap();
  }).catch(() => { $("lm-list").innerHTML = `<p class="muted small">Couldn't load the landmark list.</p>`; });

  return { openPrint, button, placeFor, refresh: renderList };
})();
