// Ground view — "Street View" for Mars.
//  • Rover photos: the nearest Perseverance/Curiosity stop's Navcam frames, laid out around 360°
//    by the direction the camera pointed (NASA raw-image metadata). Drag to look around.
//  • 3D terrain: NASA elevation (CTX DTM 20 m in Jezero, MOLA elsewhere) draped with Mars Trek
//    imagery (HiRISE 25 cm / CTX 6 m / Viking), seen from eye height. Drag to look around.
//  • Walk the route: fly along the planned path at eye level or from a drone, slopes coloured.
const GroundView = (() => {
  const R = 3389500, D2R = Math.PI / 180, EYE = 1.7;
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
  async function at(lat, lon, name = "This spot") {
    open(name, `${fmtLatLon(lat, lon)}`, [
      { key: "photos", label: "Rover photos", run: () => photos(lat, lon) },
      { key: "terrain", label: "3D terrain", run: () => terrain({ lat, lon }) },
    ]);
    loading("Looking for the nearest rover stop…");
    let near = null;
    try { near = await (await fetch(`/api/rover/nearest?lat=${lat}&lon=${lon}&max_km=3`)).json(); } catch {}
    if (!root) return;
    selectTab(near ? "photos" : "terrain");
  }
  function walk() {
    if (!lastProfile) return;
    const n = waypoints.length;
    open(`Walk: ${stopName(0)} → ${stopName(n - 1)}`, "Fly along the planned route — drone, eye level or free look", [
      { key: "walk", label: "Walk the route", run: () => terrain({ route: lastProfile }) },
      { key: "photos", label: "Rover photos at start", run: () => photos(waypoints[0][0], waypoints[0][1]) },
    ]);
    selectTab("walk");
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
      if (body) body.innerHTML = `<div class="gv-msg">NASA's raw-image service didn't answer (${e.message || e}). Try again in a moment, or switch to 3D terrain.</div>`;
      return;
    }
    if (!body) return;
    if (!near) {
      body.innerHTML = `<div class="gv-msg">No rover has driven within 3 km of here.<br>Perseverance explores Jezero crater and Curiosity explores Gale crater.
        <button type="button" class="gv-alt">Show this spot in 3D terrain</button></div>`;
      body.querySelector(".gv-alt").onclick = () => selectTab("terrain");
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

  // ---------- 3D terrain ----------
  async function imagery(THREE, b) {
    const inside = (box) => b.s >= box[0][0] && b.n <= box[1][0] && b.w >= box[0][1] && b.e <= box[1][1];
    let [layer, ext, maxZ, label] = inside(JEZ_HIRISE) ? ["JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", "png", 17, "HiRISE 25 cm"]
      : inside(JEZ_CTX) ? ["JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0", "png", 13, "CTX 6 m"]
      : ["Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg", 7, "Viking 232 m (coarse)"];
    let z = Math.max(0, Math.min(maxZ, Math.floor(Math.log2((8 * 180) / (b.e - b.w)))));
    const range = (zz) => { const deg = 180 / 2 ** zz; return { deg, c0: Math.floor((b.w + 180) / deg), c1: Math.floor((b.e + 180) / deg), r0: Math.floor((90 - b.n) / deg), r1: Math.floor((90 - b.s) / deg) }; };
    let g = range(z);
    while ((g.c1 - g.c0 + 1) * (g.r1 - g.r0 + 1) > 64 && z > 0) g = range(--z);
    const cw = (g.c1 - g.c0 + 1) * 256, ch = (g.r1 - g.r0 + 1) * 256;
    const tiles = document.createElement("canvas"); tiles.width = cw; tiles.height = ch;
    const tg = tiles.getContext("2d");
    tg.fillStyle = "#8a6a52"; tg.fillRect(0, 0, cw, ch);
    const jobs = [];
    for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) {
      jobs.push(new Promise((ok) => {
        const im = new Image(); im.crossOrigin = "anonymous";
        im.onload = () => { tg.drawImage(im, (c - g.c0) * 256, (r - g.r0) * 256); ok(); };
        im.onerror = ok;
        im.src = `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/${z}/${r}/${c}.${ext}`;
      }));
    }
    await Promise.all(jobs);
    const sx = ((b.w + 180) / g.deg - g.c0) * 256, sy = ((90 - b.n) / g.deg - g.r0) * 256;
    const sw = ((b.e - b.w) / g.deg) * 256, sh = ((b.n - b.s) / g.deg) * 256;
    const out = document.createElement("canvas");
    out.width = Math.max(2, Math.round(sw)); out.height = Math.max(2, Math.round(sh));
    out.getContext("2d").drawImage(tiles, sx, sy, sw, sh, 0, 0, out.width, out.height);
    const t = new THREE.CanvasTexture(out);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return { tex: t, label };
  }

  function skyTexture(THREE) {
    const c = document.createElement("canvas"); c.width = 4; c.height = 256;
    const g = c.getContext("2d"), grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#6d5444"); grd.addColorStop(0.55, "#b98a62"); grd.addColorStop(1, "#dcb48c"); // butterscotch daytime sky
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function pinSprite(THREE, label, kind) {
    const c = document.createElement("canvas"); c.width = 64; c.height = 88;
    const g = c.getContext("2d");
    g.fillStyle = kind === "start" ? "#34a853" : kind === "end" ? "#ea4335" : "#ffffff";
    g.strokeStyle = "#111"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(32, 86); g.bezierCurveTo(10, 56, 4, 44, 4, 32); g.arc(32, 32, 28, Math.PI, 0); g.bezierCurveTo(60, 44, 54, 56, 32, 86); g.fill(); g.stroke();
    g.fillStyle = kind === "mid" ? "#111" : "#fff"; g.font = "bold 30px Inter, Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, 32, 33);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false }));
    s.center.set(0.5, 0); s.scale.set(0.045, 0.062, 1); s.renderOrder = 10;
    return s;
  }

  async function terrain({ lat, lon, route }) {
    loading("Loading NASA terrain and imagery…");
    const THREE = await import("three");
    const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
    if (!body) return;
    // area: around the point, or the route with a margin
    let s, n, w, e;
    if (route) {
      const S = route.samples;
      s = Math.min(...S.map((p) => p.lat)); n = Math.max(...S.map((p) => p.lat));
      w = Math.min(...S.map((p) => p.lon)); e = Math.max(...S.map((p) => p.lon));
    } else { s = n = lat; w = e = lon; }
    const latC = (s + n) / 2, kx = R * Math.cos(latC * D2R) * D2R, ky = R * D2R;
    const padM = Math.max(900, 0.2 * Math.max((n - s) * ky, (e - w) * kx));
    s -= padM / ky; n += padM / ky; w -= padM / kx; e += padM / kx;
    const lonC = (w + e) / 2, latC2 = (s + n) / 2;
    const Wm = (e - w) * kx, Hm = (n - s) * ky;
    const nx = Math.round(Math.min(220, Math.max(60, 180 * Math.sqrt(Wm / Hm)))), ny = Math.round(Math.min(220, Math.max(60, 180 * Math.sqrt(Hm / Wm))));
    const [gridRes, img] = await Promise.all([fetch(`/api/terrain/grid?s=${s}&w=${w}&n=${n}&e=${e}&nx=${nx}&ny=${ny}`), imagery(THREE, { s, n, w, e })]);
    if (!body) return;
    const elev = new Float32Array(await gridRes.arrayBuffer());
    const demLabel = gridRes.headers.get("X-Source");

    const toLocal = (la, lo) => [(lo - lonC) * kx, -(la - latC2) * ky];
    const heightAt = (x, z) => {
      const fi = ((x + Wm / 2) / Wm) * (nx - 1), fj = ((z + Hm / 2) / Hm) * (ny - 1);
      const i = Math.max(0, Math.min(nx - 2, Math.floor(fi))), j = Math.max(0, Math.min(ny - 2, Math.floor(fj)));
      const u = Math.min(1, Math.max(0, fi - i)), v = Math.min(1, Math.max(0, fj - j));
      const q = (jj, ii) => elev[jj * nx + ii];
      return (q(j, i) * (1 - u) + q(j, i + 1) * u) * (1 - v) + (q(j + 1, i) * (1 - u) + q(j + 1, i + 1) * u) * v;
    };
    const [cx, cz] = route ? toLocal(route.samples[0].lat, route.samples[0].lon) : toLocal(lat, lon);
    const z0 = heightAt(cx, cz);

    // renderer
    body.innerHTML = `<canvas class="gv-canvas"></canvas><div class="gv-hud"></div><div class="gv-note"></div>`;
    const canvas = body.querySelector("canvas"), hud = body.querySelector(".gv-hud");
    const note = body.querySelector(".gv-note");
    note.textContent = `Terrain: ${demLabel} · Imagery: ${img.label} · NASA/JPL-Caltech/USGS/UArizona`;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = skyTexture(THREE);
    const maxDim = Math.max(Wm, Hm);
    scene.fog = new THREE.Fog(0xcfa27a, maxDim * 0.9, maxDim * 3.2);
    const camera = new THREE.PerspectiveCamera(65, 1, 0.5, maxDim * 4);

    // sun at departure time
    const t = MarsTime.compute(), [hh, mm] = ($("depart").value || "09:00").split(":").map(Number);
    const ltst = hh + mm / 60, H = (ltst - 12) * 15 * D2R, phi = latC2 * D2R, dec = t.decl * D2R;
    const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(alt) * Math.sin(azS), Math.max(0.08, Math.sin(alt)), -Math.cos(alt) * Math.cos(azS)).normalize();
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.6); sun.position.copy(sunDir.clone().multiplyScalar(1000)); scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xf2cfa6, 0x3a2a20, 0.75));

    // terrain mesh
    const geo = new THREE.PlaneGeometry(Wm, Hm, nx - 1, ny - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setY(k, elev[k] - z0);
    geo.computeVertexNormals();
    const world = new THREE.Group(); // terrain, route and pins: scaled together for relief exaggeration
    scene.add(world);
    const tint = img.label.startsWith("Viking") ? 0xffffff : 0xf0cba4;
    world.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: img.tex, color: tint, roughness: 1, metalness: 0 })));

    // route ribbon + stop pins
    let path = null;
    if (route) {
      const S = route.samples.filter((p) => p.leg < waypoints.length - 1); // outbound; the way back retraces it
      const P = S.map((p) => { const [x, z] = toLocal(p.lat, p.lon); return new THREE.Vector3(x, heightAt(x, z) - z0, z); });
      const cumD = [0]; for (let i = 1; i < P.length; i++) cumD.push(cumD[i - 1] + P[i].distanceTo(P[i - 1]));
      path = { P, cumD, S, total: cumD[cumD.length - 1] };
      const vtx = [], col = [], idx = [], c = new THREE.Color(), half = 0.9; // a 1.8 m wide path
      P.forEach((p, i) => {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        const nxv = -dz / L * half, nzv = dx / L * half;
        for (const sgn of [-1, 1]) {
          const x = p.x + sgn * nxv, z = p.z + sgn * nzv;
          vtx.push(x, heightAt(x, z) - z0 + 0.35, z);
          const sl = S[i].slope_deg;
          c.set(sl > 15 ? "#ea4335" : sl > 8 ? "#f9ab00" : "#4f8cff"); col.push(c.r, c.g, c.b);
        }
        if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
      });
      const rg = new THREE.BufferGeometry();
      rg.setAttribute("position", new THREE.Float32BufferAttribute(vtx, 3));
      rg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      rg.setIndex(idx);
      world.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.78, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 })));
      const stopIdx = [0, ...route.legs.map((l) => l.to_idx)];
      const nOut = waypoints.length;
      stopIdx.slice(0, nOut).forEach((si, j) => {
        const pin = pinSprite(THREE, letter(j), j === 0 ? "start" : j === nOut - 1 ? "end" : "mid");
        pin.position.copy(P[si]).add(new THREE.Vector3(0, 2, 0));
        world.add(pin);
      });
    } else {
      const pin = pinSprite(THREE, "", "end"); pin.position.set(cx, heightAt(cx, cz) - z0 + 2, cz); world.add(pin);
    }

    // ---- camera modes ----
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495;
    let mode = route ? "drone" : "free", along = 0, playing = !!route, speed = 40, yaw = 0, pitch = -0.08, exag = 1;
    const ground = (x, z) => (heightAt(x, z) - z0) * exag; // terrain height in scene units
    const setExag = (k) => { exag = k; world.scale.y = k; hud.querySelectorAll("[data-exag]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.exag === k))); };
    const pointAt = (d) => {
      const { P, cumD } = path; let i = 1;
      while (i < cumD.length - 1 && cumD[i] < d) i++;
      const u = Math.max(0, Math.min(1, (d - cumD[i - 1]) / ((cumD[i] - cumD[i - 1]) || 1)));
      return { p: P[i - 1].clone().lerp(P[i], u), i };
    };
    function setMode(m) {
      mode = m;
      controls.enabled = m === "free";
      if (m === "free") {
        const c = path ? pointAt(along).p.clone() : new THREE.Vector3(cx, 0, cz);
        c.y = ground(c.x, c.z);
        controls.target.copy(c);
        camera.position.copy(c).add(new THREE.Vector3(-maxDim * 0.16, maxDim * 0.11, maxDim * 0.16));
      }
      hud.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    }
    // HUD
    if (route) {
      hud.innerHTML = `<div class="gv-row">
          <button type="button" data-act="play">❚❚</button>
          <input type="range" class="gv-scrub" min="0" max="${Math.round(path.total)}" value="0" aria-label="Position along route">
          <select class="gv-speed" aria-label="Playback speed"><option value="15">Walk ×10</option><option value="40" selected>×25</option><option value="120">×75</option></select>
        </div>
        <div class="gv-row">
          <button type="button" data-mode="eye">Eye level</button><button type="button" data-mode="drone">Drone</button><button type="button" data-mode="free">Free look</button>
          <button type="button" data-exag="1">Relief ×1</button><button type="button" data-exag="3">×3</button>
          <span class="gv-info"></span>
        </div>`;
      hud.querySelector("[data-act=play]").onclick = (ev) => { playing = !playing; ev.target.textContent = playing ? "❚❚" : "▶"; };
      hud.querySelector(".gv-scrub").oninput = (ev) => { along = +ev.target.value; };
      hud.querySelector(".gv-speed").onchange = (ev) => { speed = +ev.target.value; };
    } else {
      hud.innerHTML = `<div class="gv-row"><button type="button" data-mode="free">Overview</button><button type="button" data-mode="look">Stand here (eye level)</button>
        <button type="button" data-exag="1">Relief ×1</button><button type="button" data-exag="3">×3</button>
        <span class="gv-info">Drag to look around · the red pin marks this spot</span></div>`;
    }
    hud.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
    hud.querySelectorAll("[data-exag]").forEach((b) => (b.onclick = () => { setExag(+b.dataset.exag); if (mode === "free") setMode("free"); }));
    setExag(1);
    setMode(mode);
    // drag-to-look for first-person modes
    let drag = null;
    canvas.addEventListener("pointerdown", (ev) => { if (mode === "look" || mode === "eye") { drag = { x: ev.clientX, y: ev.clientY, yaw, pitch }; canvas.setPointerCapture(ev.pointerId); } });
    canvas.addEventListener("pointermove", (ev) => { if (!drag) return; yaw = drag.yaw - (ev.clientX - drag.x) * 0.005; pitch = Math.max(-1.2, Math.min(1.2, drag.pitch - (ev.clientY - drag.y) * 0.004)); });
    canvas.addEventListener("pointerup", () => { drag = null; });

    function resize() {
      const wpx = body.clientWidth, hpx = body.clientHeight;
      renderer.setSize(wpx, hpx, false); camera.aspect = wpx / hpx; camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize); ro.observe(body); resize();
    let raf = 0, last = performance.now(), lookAhead = null;
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (path && playing && mode !== "free") { along += speed * dt; if (along >= path.total) { along = path.total; playing = false; hud.querySelector("[data-act=play]").textContent = "▶"; } }
      if (mode === "eye" && path) {
        const { p, i } = pointAt(along), ahead = pointAt(Math.min(path.total, along + 35)).p;
        const eye = p.clone(); eye.y = ground(p.x, p.z) + EYE;
        const tgt = ahead.clone(); tgt.y = ground(ahead.x, ahead.z) + EYE * 0.9;
        lookAhead = lookAhead ? lookAhead.lerp(tgt, 0.12) : tgt;
        camera.position.copy(eye);
        camera.lookAt(lookAhead);
        camera.rotateY(yaw); camera.rotateX(pitch + 0.08);
        info(i, p);
      } else if (mode === "drone" && path) {
        const { p, i } = pointAt(along), ahead = pointAt(Math.min(path.total, along + 120)).p;
        const back = p.clone().sub(ahead).setY(0).normalize().multiplyScalar(110);
        const want = p.clone().add(back); want.y = ground(p.x, p.z) + 70;
        camera.position.lerp(want, 0.08);
        const look = ahead.clone(); look.y = ground(ahead.x, ahead.z);
        camera.lookAt(look);
        info(i, p);
      } else if (mode === "look") {
        camera.position.set(cx, ground(cx, cz) + EYE, cz);
        camera.rotation.set(pitch, yaw, 0, "YXZ");
      } else controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    function info(i, p) {
      const s0 = path.S[i], el = hud.querySelector(".gv-info"), sc = hud.querySelector(".gv-scrub");
      if (sc && document.activeElement !== sc) sc.value = Math.round(along);
      const leg = route.legs[s0.leg];
      if (el) el.textContent = `${fmtKm(along / 1000)} of ${fmtKm(path.total / 1000)} · ${Math.round(s0.elev_m)} m · slope ${s0.slope_deg.toFixed(0)}° · ${leg ? `${leg.instruction} ${compassWord(leg.compass)}` : ""}`;
    }
    raf = requestAnimationFrame(frame);
    kill.push(() => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); geo.dispose(); img.tex.dispose(); });
  }

  return { button, at, walk, close };
})();
