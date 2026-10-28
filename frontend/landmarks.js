// Landmarks of Mars: 45 major places — volcanoes, the Valles Marineris canyons, craters, channels,
// plains and basins, both polar caps and every landing site — on the map (◆) and in the Sites tab,
// each with a short description, its MOLA elevation and the distance from you.
// (List and descriptions: OrbitStudio's Mars travel list, collected into data/landmarks.json.)
const Landmarks = (() => {
  const GROUP_ONE = { "Landing Sites": "landing site", Volcanoes: "volcano", "Valles Marineris": "canyon", Craters: "crater",
    "Channels and Fossae": "channel", "Plains and Basins": "plain / basin", "Polar Caps": "polar cap" };
  let landmarks = [], groups = [];
  const layer = L.layerGroup().addTo(map);
  layersControl.addOverlay(layer, "Landmarks");

  const distKm = (a, b) => {
    const r = Math.PI / 180, h = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
    return 2 * 3389.5 * Math.asin(Math.sqrt(h));
  };
  const spanKm = (p) => Math.max(p.box_km[0], p.box_km[1]);

  function actions(p) {
    const box = document.createElement("div");
    box.appendChild(Dir.actions([p.lat, p.lon], p.name, { close: () => map.closePopup() }));
    const more = document.createElement("div");
    more.className = "place-actions";
    const b3d = document.createElement("button");
    b3d.type = "button"; b3d.textContent = "🌐 3D";
    b3d.onclick = () => { map.closePopup(); Globe.open({ lat: p.lat, lon: p.lon, name: p.name, alt: spanKm(p) * 400 }); };
    more.append(b3d, PrintModel.button(p.lat, p.lon, p.name, { spanKm: spanKm(p) }));
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
        fly.onclick = () => { map.flyTo([p.lat, p.lon], zoomFor(spanKm(p) * 0.6)); updateConditions(p.lat, p.lon, p.name); };
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

  return { refresh: () => landmarks.length && renderList() };
})();
