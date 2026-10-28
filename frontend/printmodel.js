// 🖨 3D-print a relief model — built right here, from the same NASA elevation data the planner uses.
// A model you can hold lets the crew brief an EVA around a table: follow the walk (it's raised on the
// model, with a bump at every stop), point at the steep parts, agree where to turn back — much as
// Apollo crews studied relief models of their landing sites. The download is a binary STL that prints
// flat on any 3D printer, with no supports.
const PrintModel = (() => {
  const KM_PER_DEG = (3389.5 * Math.PI) / 180;
  const DETAIL = { standard: 160, fine: 256 };
  const AREAS_KM = [5, 10, 20, 50, 100, 200, 500, 1000];
  const RELIEFS = [1, 2, 3, 5, 10];
  const BASE_MM = 3, RIDGE_MM = 0.8, RIDGE_R = 0.9, STOP_MM = 1.6, STOP_R = 2.2;
  let back = null, job = null, grid = null, mesh = null, view = null, loadToken = 0;

  // ---------- the area ----------
  function areaFor(j) {
    if (j.route) {
      const la = j.route.samples.map((s) => s.lat), lo = j.route.samples.map((s) => s.lon);
      let s = Math.min(...la), n = Math.max(...la), w = Math.min(...lo), e = Math.max(...lo);
      const k = Math.cos(((s + n) / 2) * Math.PI / 180);
      // a margin round the walk, at least 3 km across, and never thinner than 60% of its length
      let hk = Math.max(3, (n - s) * KM_PER_DEG * 1.5), wk = Math.max(3, (e - w) * KM_PER_DEG * k * 1.5);
      hk = Math.max(hk, wk * 0.6); wk = Math.max(wk, hk * 0.6);
      const cy = (s + n) / 2, cx = (w + e) / 2;
      return { s: cy - hk / 2 / KM_PER_DEG, n: cy + hk / 2 / KM_PER_DEG, w: cx - wk / 2 / (KM_PER_DEG * k), e: cx + wk / 2 / (KM_PER_DEG * k), wk, hk };
    }
    const km = j.areaKm, k = Math.cos(j.lat * Math.PI / 180);
    const dLat = Math.min(km / 2 / KM_PER_DEG, 80), dLon = Math.min(km / 2 / (KM_PER_DEG * k), 179);
    const s = Math.max(-89.9, j.lat - dLat), n = Math.min(89.9, j.lat + dLat);
    const w = Math.max(-180, j.lon - dLon), e = Math.min(180, j.lon + dLon);
    return { s, n, w, e, wk: (e - w) * KM_PER_DEG * k, hk: (n - s) * KM_PER_DEG };
  }

  // ---------- heights → printable mesh ----------
  function build() {
    const { H, nx, ny, src } = grid, a = job.area;
    const sizeMm = +field("size").value, detail = DETAIL[field("detail").value];
    const X = a.wk >= a.hk ? sizeMm : (sizeMm * a.wk) / a.hk, Y = a.wk >= a.hk ? (sizeMm * a.hk) / a.wk : sizeMm;
    const mmPerM = X / (a.wk * 1000);
    let lo = Infinity, hi = -Infinity;
    for (const v of H) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!job.reliefChosen) {            // enough height to feel: the smallest step giving ≥ 10 mm of relief
      const natural = (hi - lo) * mmPerM;
      field("relief").value = String(RELIEFS.find((r) => natural * r >= 10) || RELIEFS[RELIEFS.length - 1]);
    }
    const k = +field("relief").value;
    const dx = X / (nx - 1), dy = Y / (ny - 1);
    // raise the route and the stops so fingers and eyes can follow them
    const raise = new Float32Array(nx * ny), tag = new Uint8Array(nx * ny); // tag 1 = route, 2 = stop
    if (job.route && field("route").checked) {
      const xy = (p) => [((p.lon - a.w) / (a.e - a.w)) * X, ((p.lat - a.s) / (a.n - a.s)) * Y];
      const P = job.route.samples.map(xy);
      const mark = (x0, y0, x1, y1, r, h, t) => {
        const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - r) / dx)), i1 = Math.min(nx - 1, Math.ceil((Math.max(x0, x1) + r) / dx));
        const j0 = Math.max(0, Math.floor((Math.min(y0, y1) - r) / dy)), j1 = Math.min(ny - 1, Math.ceil((Math.max(y0, y1) + r) / dy));
        const ux = x1 - x0, uy = y1 - y0, L2 = ux * ux + uy * uy || 1;
        for (let jj = j0; jj <= j1; jj++) for (let i = i0; i <= i1; i++) {
          const px = i * dx, py = jj * dy, t2 = Math.max(0, Math.min(1, ((px - x0) * ux + (py - y0) * uy) / L2));
          if (Math.hypot(px - x0 - t2 * ux, py - y0 - t2 * uy) > r) continue;
          const idx = (ny - 1 - jj) * nx + i;            // grid row 0 is north (largest y)
          if (h >= raise[idx]) { raise[idx] = h; tag[idx] = t; }
        }
      };
      for (let q = 1; q < P.length; q++) mark(P[q - 1][0], P[q - 1][1], P[q][0], P[q][1], RIDGE_R, RIDGE_MM, 1);
      for (const si of job.route.stops) { const [x, y] = P[si]; mark(x, y, x, y, STOP_R, STOP_MM, 2); }
    }
    // vertices: the top grid, a bottom copy of it (only its edge is used) and the centre of the base
    const top = nx * ny, pos = new Float32Array((2 * top + 1) * 3);
    let zMax = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const idx = j * nx + i, v = Number.isFinite(H[idx]) ? H[idx] : lo;
      const z = BASE_MM + (v - lo) * mmPerM * k + raise[idx];
      zMax = Math.max(zMax, z);
      pos.set([i * dx, (ny - 1 - j) * dy, z], idx * 3);
      pos.set([i * dx, (ny - 1 - j) * dy, 0], (top + idx) * 3);
    }
    pos.set([X / 2, Y / 2, 0], 2 * top * 3);
    const tri = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const p = j * nx + i, q = p + 1, r = p + nx, t = r + 1;
      tri.push(p, r, q, q, r, t);                        // counter-clockwise seen from above
    }
    // the outline, counter-clockwise seen from above: south edge, east, north, west
    const ring = [];
    for (let i = 0; i < nx; i++) ring.push((ny - 1) * nx + i);
    for (let j = ny - 2; j >= 0; j--) ring.push(j * nx + nx - 1);
    for (let i = nx - 2; i >= 0; i--) ring.push(i);
    for (let j = 1; j < ny - 1; j++) ring.push(j * nx);
    for (let m = 0; m < ring.length; m++) {
      const p = ring[m], q = ring[(m + 1) % ring.length], P0 = top + p, Q0 = top + q;
      tri.push(p, P0, Q0, p, Q0, q);                     // the walls face outwards
      tri.push(2 * top, Q0, P0);                         // the base faces down
    }
    mesh = { pos, index: Uint32Array.from(tri), tag, top, X, Y, zMax, k, mmPerM, src, detail };
    stats();
    draw();
  }

  // binary STL: 80-byte header, triangle count, then normal + 3 corners per triangle
  function stl() {
    const { pos, index } = mesh, n = index.length / 3, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    const head = `Martian Map relief model - ${job.name}`.slice(0, 79);
    for (let c = 0; c < head.length; c++) dv.setUint8(c, head.charCodeAt(c) & 0x7f);
    dv.setUint32(80, n, true);
    let o = 84;
    for (let t = 0; t < n; t++) {
      const a = index[3 * t] * 3, b = index[3 * t + 1] * 3, c = index[3 * t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      for (const v of [nx, ny, nz, pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]]) { dv.setFloat32(o, v, true); o += 4; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return new Blob([buf], { type: "model/stl" });
  }

  // ---------- 3D preview ----------
  async function draw() {
    const THREE = await import("three");
    const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
    if (!back || !mesh) return;
    const cv = back.querySelector(".pm-view");
    if (!view) {
      const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
      renderer.setPixelRatio(Math.min(1.5, devicePixelRatio));
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1b1512);
      const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
      scene.add(new THREE.HemisphereLight(0xfff1e0, 0x2a1d16, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-1, 1.4, 2); scene.add(sun);
      const controls = new OrbitControls(camera, cv);
      controls.enableDamping = true;
      view = { THREE, renderer, scene, camera, controls, obj: null, raf: 0 };
      const loop = () => { view.controls.update(); view.renderer.render(view.scene, view.camera); view.raf = requestAnimationFrame(loop); };
      loop();
    }
    const { scene, camera, controls } = view;
    if (view.obj) { scene.remove(view.obj); view.obj.geometry.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(mesh.pos, 3));
    // colour: Mars red, the route blue, the stops white
    const col = new Float32Array(mesh.pos.length), red = [0.76, 0.41, 0.24];
    for (let v = 0; v < mesh.pos.length / 3; v++) {
      const t = v < mesh.top ? mesh.tag[v] : 0;
      col.set(t === 1 ? [0.31, 0.55, 1] : t === 2 ? [1, 1, 1] : red, v * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    g.computeVertexNormals();
    g.rotateX(-Math.PI / 2);                               // print bed flat, north away from you
    g.translate(-mesh.X / 2, 0, mesh.Y / 2);
    view.obj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
    scene.add(view.obj);
    const size = Math.max(mesh.X, mesh.Y);
    camera.position.set(size * 0.55, size * 0.75, size * 0.95);
    controls.target.set(0, mesh.zMax / 3, 0);
    resize();
  }
  function resize() {
    if (!view) return;
    const cv = view.renderer.domElement, w = cv.clientWidth, h = cv.clientHeight;
    view.renderer.setSize(w, h, false);
    view.camera.aspect = w / h; view.camera.updateProjectionMatrix();
  }

  // ---------- the dialog ----------
  const field = (name) => back.querySelector(`[name=${name}]`);
  function stats() {
    const m = mesh, tris = m.index.length / 3;
    back.querySelector(".pm-stats").innerHTML = `
      <span><b>${Math.round(m.X)} × ${Math.round(m.Y)} mm</b> model of ${fmtKm(job.area.wk)} × ${fmtKm(job.area.hk)}</span>
      <span>1 mm on it = <b>${Math.round(1 / m.mmPerM).toLocaleString()} m</b> on Mars</span>
      <span>heights <b>×${m.k}</b> · ${BASE_MM}–${Math.round(m.zMax)} mm tall</span>
      <span>${tris.toLocaleString()} triangles · ${(tris * 50 / 1048576).toFixed(1)} MB</span>
      <span>terrain: ${m.src}</span>`;
    back.querySelector(".pm-dl").disabled = false;
  }
  async function load() {
    const token = ++loadToken, a = (job.area = areaFor(job));
    const n = DETAIL[field("detail").value];
    const nx = a.wk >= a.hk ? n : Math.max(16, Math.round((n * a.wk) / a.hk)), ny = a.wk >= a.hk ? Math.max(16, Math.round((n * a.hk) / a.wk)) : n;
    back.querySelector(".pm-dl").disabled = true;
    back.querySelector(".pm-stats").innerHTML = `<span class="calc"><span class="gv-spin"></span>Loading NASA elevation for ${fmtKm(a.wk)} × ${fmtKm(a.hk)}…</span>`;
    try {
      const r = await fetch(`/api/terrain/area?s=${a.s}&w=${a.w}&n=${a.n}&e=${a.e}&nx=${nx}&ny=${ny}`);
      if (!r.ok) throw new Error(`server ${r.status}`);
      const H = new Float32Array(await r.arrayBuffer());
      if (token !== loadToken || !back) return;
      grid = { H, nx, ny, src: r.headers.get("X-Source") || "" };
      build();
    } catch (e) {
      if (token === loadToken && back) back.querySelector(".pm-stats").innerHTML = `<span class="bad">✗ Couldn't load the elevation (${e.message}). <button type="button" class="pm-retry">Try again</button></span>`;
      back.querySelector(".pm-retry")?.addEventListener("click", load);
    }
  }
  function open({ lat, lon, name = "This spot", spanKm = 20, route = null } = {}) {
    close();
    // the place's own size is offered exactly (a whole volcano or crater), alongside round sizes
    const areaKm = Math.max(3, Math.min(1200, Math.round(spanKm)));
    const areas = [...new Set([...AREAS_KM, areaKm])].sort((a, b) => a - b);
    job = { lat, lon, name, route, areaKm, reliefChosen: false };
    back = document.createElement("div");
    back.className = "pm-back";
    back.innerHTML = `
      <div class="pm-card" role="dialog" aria-modal="true" aria-label="3D-print a relief model">
        <button type="button" class="pm-x" aria-label="Close">✕</button>
        <div class="pm-title">🖨 3D-print a relief model</div>
        <div class="pm-sub">${name} · ${fmtLatLon(lat, lon)}</div>
        <canvas class="pm-view" aria-label="Preview of the model — drag to turn it"></canvas>
        <div class="pm-opts">
          <label>Size <select name="size">${[100, 150, 200, 250].map((v) => `<option value="${v}"${v === 150 ? " selected" : ""}>${v} mm</option>`).join("")}</select></label>
          <label>Heights <select name="relief">${RELIEFS.map((v) => `<option value="${v}">×${v}</option>`).join("")}</select></label>
          ${route ? `<label><input type="checkbox" name="route" checked> Raise the route &amp; stops</label>`
            : `<label>Area <select name="area">${areas.map((v) => `<option value="${v}"${v === areaKm ? " selected" : ""}>${v} km</option>`).join("")}</select></label>`}
          <label>Detail <select name="detail"><option value="standard">Standard</option><option value="fine">Fine</option></select></label>
        </div>
        <div class="pm-stats"></div>
        <button type="button" class="pm-dl go" disabled>⬇ Download STL</button>
        <p class="pm-small">${route ? "The walk is raised 0.8 mm on the model, with a bump at every stop, so the crew can trace it with a finger while briefing — much as Apollo crews studied relief models of their landing sites." : "A model the crew can hold makes a walk easy to brief around a table — much as Apollo crews studied relief models of their landing sites."}
          Prints flat on its 3 mm base with no supports; 0.2 mm layers work well. Heights are exaggerated as shown, so gentle Martian slopes are easy to see and feel.</p>
      </div>`;
    document.body.appendChild(back);
    back.querySelector(".pm-x").onclick = close;
    back.onclick = (e) => { if (e.target === back) close(); };
    field("size").onchange = build;
    field("relief").onchange = () => { job.reliefChosen = true; build(); };
    field("detail").onchange = load;
    if (route) field("route").onchange = build;
    else field("area").onchange = (e) => { job.areaKm = +e.target.value; job.reliefChosen = false; load(); };
    back.querySelector(".pm-dl").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(stl());
      a.download = `mars-relief-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "model"}.stl`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    addEventListener("resize", resize);
    load();
  }
  function close() {
    if (view) { cancelAnimationFrame(view.raf); view.controls.dispose(); view.renderer.dispose(); view.obj?.geometry.dispose(); view = null; }
    back?.remove(); back = null; mesh = null; grid = null;
    removeEventListener("resize", resize);
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && back) close(); });

  // a "🖨 Print model" button for popups and cards
  function button(lat, lon, name, opts = {}) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = "🖨 Print model";
    b.title = "Make a 3D-printable relief model of this area";
    b.onclick = () => { map.closePopup(); open({ lat, lon, name, ...opts }); };
    return b;
  }
  return { open, button, close, get active() { return !!back; } };
})();
