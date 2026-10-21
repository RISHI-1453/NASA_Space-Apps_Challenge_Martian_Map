// Ground view — "Street View" for Mars.
//  • Rover photos: the nearest Perseverance/Curiosity stop's Navcam frames, laid out around 360°
//    by the direction the camera pointed (NASA raw-image metadata). Drag to look around.
//  • 3D view: hands over to the 3D globe (globe.js), opened on this spot.
const GroundView = (() => {
  let root = null, body = null, kill = [], current = null;

  // ---------- overlay shell ----------
  function open(title, sub, tabs) {
    close();
    root = document.createElement("div");
    root.id = "gv";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", `Ground view: ${title}`);
    root.innerHTML = `
      <header class="gv-head">
        <div class="gv-name"><div class="gv-title"></div><div class="gv-sub"></div></div>
        <div class="gv-tabs" role="tablist"></div>
        <button type="button" class="gv-close" aria-label="Close ground view">✕</button>
      </header>
      <div class="gv-body"></div>`;
    document.body.appendChild(root);
    root.querySelector(".gv-title").textContent = title;
    root.querySelector(".gv-sub").textContent = sub || "";
    body = root.querySelector(".gv-body");
    root.querySelector(".gv-close").onclick = close;
    const tabBox = root.querySelector(".gv-tabs");
    for (const t of tabs || []) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = t.label; b.setAttribute("role", "tab"); b.dataset.key = t.key;
      b.onclick = () => selectTab(t.key);
      tabBox.appendChild(b);
    }
    current = { tabs: tabs || [] };
    const onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".gv-lightbox")) close(); };
    document.addEventListener("keydown", onKey);
    kill.push(() => document.removeEventListener("keydown", onKey));
    root.querySelector(".gv-close").focus();
  }
  function setSub(text) { if (root) root.querySelector(".gv-sub").textContent = text; }
  function selectTab(key) {
    stopScene();
    root.querySelectorAll(".gv-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.key === key)));
    current.tabs.find((t) => t.key === key)?.run();
  }
  function stopScene() { kill.splice(1).forEach((f) => f()); body.innerHTML = ""; } // keep the Esc handler (kill[0])
  function close() {
    kill.forEach((f) => f()); kill = [];
    root?.remove(); root = null; body = null; current = null;
  }
  const loading = (text) => { body.innerHTML = `<div class="gv-msg"><div class="gv-spin"></div>${text}</div>`; };

  // ---------- entry points ----------
  function button(lat, lon, name) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = "👁 Ground view";
    b.onclick = () => { map.closePopup(); at(lat, lon, name); };
    return b;
  }
  // rover photos if a rover has been within 3 km, otherwise straight to the 3D globe
  async function at(lat, lon, name = "This spot") {
    const in3d = () => { close(); Globe.open({ lat, lon, name }); };
    open(name, `${fmtLatLon(lat, lon)}`, [
      { key: "photos", label: "Rover photos", run: () => photos(lat, lon) },
      { key: "3d", label: "🌐 3D view", run: in3d },
    ]);
    loading("Looking for the nearest rover stop…");
    let near = null;
    try { near = await (await fetch(`/api/rover/nearest?lat=${lat}&lon=${lon}&max_km=3`)).json(); } catch {}
    if (!root) return;
    if (near) selectTab("photos");
    else in3d();
  }

  // ---------- rover photos: a look-around strip ----------
  async function photos(lat, lon) {
    loading("Finding photos from the nearest rover stop…");
    let near, d;
    try {
      near = await (await fetch(`/api/rover/nearest?lat=${lat}&lon=${lon}&max_km=3`)).json();
      if (near) {
        const r = await fetch(`/api/rover/photos?mission=${near.mission}&sol=${near.sol}&site=${near.site}&drive=${near.drive}`);
        if (!r.ok) throw new Error((await r.json()).detail);
        d = await r.json();
      }
    } catch (e) {
      if (body) body.innerHTML = `<div class="gv-msg">NASA's raw-image service didn't answer (${e.message || e}). Try again in a moment, or switch to the 3D view.</div>`;
      return;
    }
    if (!body) return;
    if (!near) {
      body.innerHTML = `<div class="gv-msg">No rover has driven within 3 km of here.<br>Perseverance explores Jezero crater and Curiosity explores Gale crater.
        <button type="button" class="gv-alt">See this spot in 3D</button></div>`;
      body.querySelector(".gv-alt").onclick = () => selectTab("3d");
      return;
    }
    const pics = d.photos.filter((p) => p.medium);
    setSub(`${d.rover}, sol ${d.sol} — rover stop ${fmtKm(near.dist_m / 1000)} from here · ${pics.length} Navcam frames${d.exact_stop ? "" : " from that sol"}`);
    if (!pics.length) { body.innerHTML = `<div class="gv-msg">${d.rover} took no Navcam frames on sol ${d.sol}.</div>`; return; }

    // ground-looking frames first, horizon views last so they sit on top (that's what you navigate by)
    const placed = pics.filter((p) => p.az !== null && p.el !== null).sort((a, b) => a.el - b.el);
    if (placed.length < 2) return gallery(pics, d);
    const PX = 9, EL_TOP = 50, EL_BOT = -70, W = 360 * PX, H = (EL_TOP - EL_BOT) * PX;
    body.innerHTML = `<div class="gv-strip-wrap"><div class="gv-strip"></div></div>
      <div class="gv-compass"></div>
      <div class="gv-hint">Drag to look around · scroll to zoom · click a frame to open it · directions are relative to the rover</div>`;
    const wrap = body.querySelector(".gv-strip-wrap"), strip = body.querySelector(".gv-strip"), compass = body.querySelector(".gv-compass");
    strip.style.width = `${W * 3}px`; strip.style.height = `${H}px`;
    // later frames on top; three copies side by side so panning wraps around seamlessly
    for (const copy of [-1, 0, 1]) for (const p of placed) {
      const hfov = d.hfov * ((p.w || 1280) / 1280), vfov = hfov * ((p.h || 960) / (p.w || 1280));
      const az = ((p.az % 360) + 360) % 360;
      const img = document.createElement("img");
      img.src = p.medium; img.loading = "lazy"; img.alt = `${d.rover} ${p.camera}, azimuth ${Math.round(az)}°, elevation ${Math.round(p.el)}°`;
      img.style.cssText = `left:${W + copy * W + (az - hfov / 2) * PX}px;top:${(EL_TOP - p.el - vfov / 2) * PX}px;width:${hfov * PX}px;height:${vfov * PX}px`;
      img.onclick = (e) => { if (!dragged) lightbox(p, d); e.stopPropagation(); };
      strip.appendChild(img);
    }
    for (let a = 0; a < 360; a += 45) {
      const t = document.createElement("span");
      t.textContent = a === 0 ? "0° (rover ahead)" : `${a}°`;
      t.dataset.az = a;
      compass.appendChild(t);
    }
    let offset = -W, scale = 1, dragged = false;
    const firstAz = ((placed[0].az % 360) + 360) % 360;
    offset = -(W + firstAz * PX) + wrap.clientWidth / 2;
    function layout() {
      const fit = Math.max(0.35, (wrap.clientHeight / H) * scale);
      const span = W * fit;
      offset = ((((offset + W) % span) + span) % span) - span; // keep within one copy
      strip.style.transform = `translate(${offset}px, 0) scale(${fit})`;
      compass.querySelectorAll("span").forEach((s) => {
        const x = (((offset + (W + +s.dataset.az * PX) * fit) % span) + span) % span;
        s.style.left = `${x}px`;
        s.hidden = x > wrap.clientWidth;
      });
    }
    let sx = 0, so = 0, down = false;
    wrap.onpointerdown = (e) => { down = true; dragged = false; sx = e.clientX; so = offset; wrap.setPointerCapture(e.pointerId); };
    wrap.onpointermove = (e) => { if (!down) return; if (Math.abs(e.clientX - sx) > 4) dragged = true; offset = so + (e.clientX - sx); layout(); };
    wrap.onpointerup = () => { down = false; };
    wrap.onwheel = (e) => { e.preventDefault(); scale = Math.max(0.6, Math.min(3, scale * (e.deltaY < 0 ? 1.12 : 0.89))); layout(); };
    wrap.tabIndex = 0;
    wrap.onkeydown = (e) => { if (e.key === "ArrowLeft") { offset += 80; layout(); } if (e.key === "ArrowRight") { offset -= 80; layout(); } };
    const ro = new ResizeObserver(layout); ro.observe(wrap);
    kill.push(() => ro.disconnect());
    layout();
  }
  function gallery(pics, d) {
    body.innerHTML = `<div class="gv-gallery"></div>`;
    const g = body.querySelector(".gv-gallery");
    for (const p of pics) {
      const img = document.createElement("img");
      img.src = p.medium; img.loading = "lazy"; img.alt = `${d.rover} ${p.camera}`;
      img.onclick = () => lightbox(p, d);
      g.appendChild(img);
    }
  }
  function lightbox(p, d) {
    const lb = document.createElement("div");
    lb.className = "gv-lightbox";
    lb.innerHTML = `<img src="${p.large}" alt="${d.rover} ${p.camera}">
      <div class="gv-cap">${d.rover} ${p.camera.replace(/_/g, " ").toLowerCase()} · sol ${d.sol}${p.az !== null ? ` · azimuth ${Math.round(p.az)}°, elevation ${Math.round(p.el)}°` : ""} · ${p.time ? p.time.slice(0, 16).replace("T", " ") + " UTC" : ""}
      · <a href="${p.large}" target="_blank" rel="noopener">open full size</a> · NASA/JPL-Caltech</div>
      <button type="button" class="gv-close" aria-label="Close photo">✕</button>`;
    const shut = () => lb.remove();
    lb.onclick = (e) => { if (e.target === lb || e.target.classList.contains("gv-close")) shut(); };
    const k = (e) => { if (e.key === "Escape") { shut(); document.removeEventListener("keydown", k); } };
    document.addEventListener("keydown", k);
    root.appendChild(lb);
  }


  return { button, at, close };
})();
