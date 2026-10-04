// Directions: From → (stops) → To, like a maps app.
// Any endpoint can be your position, a site, an IAU-named place, typed coordinates, or a point
// chosen on the map. `waypoints` / `wpNames` (app.js) stay the single source of truth.
const Dir = (() => {
  const fromEl = $("dir-from"), toEl = $("dir-to"), stopsEl = $("dir-stops"), res = $("dir-results"), box = $("dir");
  let pendingTo = null;   // a destination picked before any start point
  let choosing = null;    // role waiting for a click on the map: "from" | "to" | "stop" | number (stop index)
  let sites = [];
  fetch("/api/sites").then((r) => r.json()).then((d) => { sites = d.sites; });

  const nameAt = (i) => wpNames[i] || fmtLatLon(waypoints[i][0], waypoints[i][1]);
  const roleName = (role) => (role === "from" ? "starting point" : role === "to" ? "destination" : "stop");

  // ---------- state changes ----------
  function apply() {
    showTab("route");
    redrawRoute();
    render();
    if (waypoints.length > 1) map.fitBounds(L.latLngBounds(waypoints).pad(0.3), { maxZoom: 14 });
    else if (waypoints.length === 1) map.flyTo(waypoints[0], Math.max(map.getZoom(), 9));
  }
  function setFrom(ll, name) {
    if (!waypoints.length) {
      waypoints = [ll]; wpNames = [name];
      if (pendingTo) { waypoints.push(pendingTo.ll); wpNames.push(pendingTo.name); pendingTo = null; }
    } else { waypoints[0] = ll; wpNames[0] = name; }
    apply();
    if (waypoints.length === 1) toEl.focus();
  }
  function setTo(ll, name) {
    if (!waypoints.length) {
      if (me) { waypoints = [[...me], ll]; wpNames = ["Your position", name]; }
      else { pendingTo = { ll, name }; render(); fromEl.focus(); flash(fromEl); return; }
    } else if (waypoints.length === 1) { waypoints.push(ll); wpNames.push(name); }
    else { waypoints[waypoints.length - 1] = ll; wpNames[wpNames.length - 1] = name; }
    apply();
  }
  function addStop(ll, name) {
    if (waypoints.length < 2) return waypoints.length ? setTo(ll, name) : setFrom(ll, name);
    waypoints.splice(waypoints.length - 1, 0, ll);
    wpNames.splice(wpNames.length - 1, 0, name);
    apply();
  }
  function setRole(role, ll, name) {
    if (role === "from") setFrom(ll, name);
    else if (role === "to") setTo(ll, name);
    else if (role === "stop") addStop(ll, name);
    else { waypoints[role] = ll; wpNames[role] = name; apply(); }
  }
  function removeStop(i) { waypoints.splice(i, 1); wpNames.splice(i, 1); apply(); }
  function swap() {
    if (waypoints.length < 2) return;
    waypoints.reverse(); wpNames.reverse();
    apply();
  }
  function clear() { pendingTo = null; render(); }
  const flash = (el) => { el.classList.add("need"); setTimeout(() => el.classList.remove("need"), 1600); };

  // ---------- rendering ----------
  function render() {
    const n = waypoints.length;
    if (document.activeElement !== fromEl) fromEl.value = n ? nameAt(0) : "";
    if (document.activeElement !== toEl) toEl.value = n > 1 ? nameAt(n - 1) : pendingTo ? pendingTo.name : "";
    stopsEl.innerHTML = "";
    for (let i = 1; i < n - 1; i++) {
      const row = document.createElement("div");
      row.className = "dir-row";
      row.innerHTML = `<span class="dir-dot stop">${letter(i)}</span>
        <input type="search" autocomplete="off" aria-label="Stop ${letter(i)}" value="${nameAt(i).replace(/"/g, "&quot;")}">
        <button type="button" class="dir-x" title="Remove stop ${letter(i)}" aria-label="Remove stop ${letter(i)}">✕</button>`;
      attach(row.querySelector("input"), i);
      row.querySelector(".dir-x").onclick = () => removeStop(i);
      stopsEl.appendChild(row);
    }
    $("dir-from-dot").textContent = n ? letter(0) : "";
    $("dir-to-dot").textContent = n > 1 ? letter(n - 1) : "";
  }

  // ---------- search dropdown shared by every input ----------
  let active = null, role = null, items = [], sel = -1, timer = 0;
  function show() {
    res.innerHTML = "";
    res.hidden = !items.length || !active;
    if (res.hidden) return;
    res.style.top = `${active.offsetTop + active.offsetHeight + 4}px`;
    items.forEach((it, i) => {
      const d = document.createElement("div");
      d.className = "result" + (i === sel ? " sel" : "");
      d.innerHTML = `<div class="rn"><span class="ri">${it.icon}</span>${it.label}</div><div class="rm">${it.meta}</div>`;
      d.onmousedown = (e) => { e.preventDefault(); pick(it); };
      res.appendChild(d);
    });
  }
  function pick(it) {
    const r = role;
    close();
    if (it.choose) return chooseOnMap(r);
    setRole(r, it.ll, it.label);
  }
  function close() { items = []; sel = -1; show(); if (active) active.blur(); active = null; render(); }

  async function suggest(q) {
    const base = [];
    if (me) base.push({ icon: "◉", label: "Your position", meta: fmtLatLon(me[0], me[1]), ll: [...me] });
    base.push({ icon: "⌖", label: "Choose on map", meta: "Click anywhere on the map", choose: true });
    const c = parseCoords(q);
    if (c) { items = [{ icon: "⌗", label: fmtLatLon(c[0], c[1]), meta: "Coordinates (east-positive)", ll: c }, ...base]; sel = 0; return show(); }
    const ql = q.trim().toLowerCase();
    const siteHits = sites.filter((s) => !ql || s.name.toLowerCase().includes(ql) || (s.region || "").toLowerCase().includes(ql))
      .slice(0, ql ? 5 : 4)
      .map((s) => ({ icon: s.type === "lander" ? "●" : "◆", label: s.name, meta: `${s.region} · ${fmtLatLon(s.lat, s.lon)}`, ll: [s.lat, s.lon] }));
    items = [...base, ...siteHits];
    sel = ql ? Math.min(items.length - 1, base.length) : 0;
    show();
    if (ql.length < 2) return;
    const qAt = q;
    const r = await fetch(`/api/places?q=${encodeURIComponent(q)}&limit=6`);
    if (!r.ok || active?.value !== qAt) return;
    const places = (await r.json()).map((f) => ({ icon: "▲", label: f.name, meta: `${f.kind}${f.diameter_km ? ` · ${f.diameter_km.toFixed(0)} km` : ""} · ${fmtLatLon(f.lat, f.lon)}`, ll: [f.lat, f.lon] }));
    items = [...base, ...siteHits, ...places];
    if (siteHits.length + places.length) sel = base.length;
    show();
  }
  function attach(input, r) {
    input.addEventListener("focus", () => { active = input; role = r; input.select(); suggest(""); });
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => suggest(input.value), 120); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); show(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); show(); e.preventDefault(); }
      else if (e.key === "Enter") { if (items[sel]) pick(items[sel]); e.preventDefault(); }
      else if (e.key === "Escape") close();
    });
    input.addEventListener("blur", () => setTimeout(() => { if (active === input) close(); }, 120));
  }
  attach(fromEl, "from");
  attach(toEl, "to");
  $("dir-swap").onclick = swap;
  $("dir-add-stop").onclick = () => {
    if (waypoints.length < 2) { (waypoints.length ? toEl : fromEl).focus(); return; }
    chooseOnMap("stop");
  };

  // ---------- choose a point on the map ----------
  function chooseOnMap(r) {
    if (drawing) setDrawing(false);
    choosing = r;
    banner.hidden = false;
    banner.textContent = `Click the map to set the ${roleName(r)} · Esc to cancel`;
    map.getContainer().style.cursor = "crosshair";
  }
  function stopChoosing() { choosing = null; banner.hidden = true; map.getContainer().style.cursor = ""; }
  map.on("click", async (e) => {
    if (choosing === null) return;
    const r = choosing, ll = [e.latlng.lat, e.latlng.lng];
    stopChoosing();
    setRole(r, ll, null);
    // name the point after the feature it's in or near
    const w = await whereis(ll[0], ll[1]);
    const i = waypoints.findIndex((p) => p[0] === ll[0] && p[1] === ll[1]);
    if (w && i >= 0 && !wpNames[i]) { wpNames[i] = w.summary.replace(/ \(.*?\)/g, ""); render(); if (lastProfile) renderPanel(lastProfile, lastLabels); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && choosing !== null) stopChoosing(); });

  // ---------- actions for site / place popups ----------
  function actions(ll, name, { close: closePopup } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "place-actions";
    const btn = (label, fn, primary) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label; if (primary) b.className = "primary";
      b.onclick = () => { closePopup && closePopup(); fn(); };
      wrap.appendChild(b);
    };
    btn("🧭 Directions to here", () => setTo([...ll], name), true);
    btn("▶ Start from here", () => setFrom([...ll], name));
    if (waypoints.length >= 2) btn("➕ Add as stop", () => addStop([...ll], name));
    return wrap;
  }

  render();
  return { setFrom, setTo, addStop, swap, clear, render, actions, nameAt, chooseOnMap };
})();
