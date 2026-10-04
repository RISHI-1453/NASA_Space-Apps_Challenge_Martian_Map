// Cinematic opener: Milky Way → Sun → solar system (today) → Earth → Mars → Jezero → map.
// One timeline (seconds) drives everything, so it can be paused, scrubbed and skipped.
import * as THREE from "three";

const SUN_DIVE = 8.6;   // galaxy scene before this, solar-system scene after
const END = 31.8;
const AU = 30;          // scene units per astronomical unit
const JEZERO = { lat: 18.4447, lon: 77.4508 };

// ---------- real planet positions (JPL approximate Keplerian elements, valid 1800–2050) ----------
const ELEMENTS = { // a(AU), e, I, L, long. perihelion, long. node — and their rates per century
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
};
const D2R = Math.PI / 180;
function orbitAt(name, T) {
  const [base, rate] = ELEMENTS[name];
  const [a, e, I, L, w, O] = base.map((v, i) => v + rate[i] * T);
  return { a, e, I: I * D2R, om: (w - O) * D2R, O: O * D2R, M: ((((L - w) % 360) + 540) % 360 - 180) * D2R };
}
function toScene(o, E) {
  const xp = o.a * (Math.cos(E) - o.e), yp = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  const [co, so, cO, sO, cI, sI] = [Math.cos(o.om), Math.sin(o.om), Math.cos(o.O), Math.sin(o.O), Math.cos(o.I), Math.sin(o.I)];
  const x = (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp;
  const y = (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp;
  const z = so * sI * xp + co * sI * yp;
  return new THREE.Vector3(x * AU, z * AU, -y * AU); // ecliptic north = scene up
}
function planetPos(name, T) {
  const o = orbitAt(name, T);
  let E = o.M + o.e * Math.sin(o.M);
  for (let i = 0; i < 8; i++) E -= (E - o.e * Math.sin(E) - o.M) / (1 - o.e * Math.cos(E));
  return toScene(o, E);
}
const now = new Date();
const T = (now.getTime() / 86400000 + 2440587.5 + 69.184 / 86400 - 2451545) / 36525;
const POS = Object.fromEntries(Object.keys(ELEMENTS).map((k) => [k, planetPos(k, T)]));
const distAU = POS.earth.distanceTo(POS.mars) / AU;
const distMkm = Math.round(distAU * 149.5978707);
const lightMin = (distAU * 499.004784 / 60).toFixed(1);
const dateText = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const CHAPTERS = [
  { name: "Milky Way", start: 0, title: "The Milky Way", text: "A few hundred billion stars. One of them is ours." },
  { name: "Sun", start: 6.2, title: "The Sun", text: "Our star, about 26,000 light-years from the centre of the galaxy." },
  { name: "Solar system", start: SUN_DIVE + 0.4, title: "The solar system today", text: `Planets where they are on ${dateText}. Sizes are not to scale.` },
  { name: "Earth", start: 15, title: "Earth", text: "Home, and mission control." },
  { name: "Mars", start: 19.2, title: "Mars", text: `${distMkm} million km from Earth today. A radio message takes ${lightMin} minutes to get there.` },
  { name: "Jezero", start: 25.6, title: "Jezero crater", text: "An ancient lake bed, where Perseverance landed in 2021. Your Marswalk starts here." },
];

// ---------- helpers ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const lerpV = (a, b, u) => a.clone().lerp(b, u);
const bez = (p0, p1, p2, u) => p0.clone().multiplyScalar((1 - u) ** 2).add(p1.clone().multiplyScalar(2 * u * (1 - u))).add(p2.clone().multiplyScalar(u * u));
function surfaceNormal(lat, lon) { // matches THREE.SphereGeometry UVs with lon −180 at the texture's left edge
  const p = lat * D2R, l = lon * D2R;
  return new THREE.Vector3(Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l));
}
function glowTexture(inner, outer) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, inner); grd.addColorStop(0.18, inner); grd.addColorStop(0.45, outer); grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let _dot;
function dotTexture() { // soft round point sprite, so close-up particles read as bokeh, not squares
  if (_dot) return _dot;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.35, "rgba(255,255,255,.8)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return (_dot = new THREE.CanvasTexture(c));
}
function featherMask() { // opaque centre, soft edges: hides the seam between the sharp patch and the globe
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const e = Math.min(x, y, 255 - x, 255 - y) / 64; // 0 at the edge → 1 a quarter of the way in
    const a = Math.round(255 * Math.min(1, e) ** 1.5);
    img.data.set([a, a, a, 255], (y * 256 + x) * 4);
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}
function bandTexture(colors) {
  const c = document.createElement("canvas"); c.width = 16; c.height = 256;
  const g = c.getContext("2d");
  for (let y = 0; y < 256; y++) { g.fillStyle = colors[Math.floor((Math.sin(y * 0.21) * 0.5 + 0.5 + (y % 37) / 80) * colors.length) % colors.length]; g.fillRect(0, y, 16, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function starfield(n, radius, size) {
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(radius * (0.8 + Math.random() * 0.2));
    p.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xdfe6ff, size, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false }));
}

export function playIntro({ onDone } = {}) {
  // ---------- DOM ----------
  const root = document.createElement("div");
  root.id = "intro";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Intro: from the Milky Way to Jezero crater");
  root.innerHTML = `
    <canvas class="intro-canvas"></canvas>
    <div class="intro-flash"></div>
    <div class="intro-labels" aria-hidden="true"></div>
    <div class="intro-scrim" aria-hidden="true"></div>
    <div class="intro-caption" aria-live="polite"><h1></h1><p></p></div>
    <div class="intro-controls">
      <button type="button" class="intro-pause" aria-label="Pause">Pause</button>
      <button type="button" class="intro-skip">Skip to map</button>
    </div>
    <nav class="intro-timeline" aria-label="Intro chapters"><div class="intro-track"><div class="intro-fill"></div></div></nav>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const canvas = $(".intro-canvas"), flash = $(".intro-flash"), labelsEl = $(".intro-labels");
  const capH = $(".intro-caption h1"), capP = $(".intro-caption p"), caption = $(".intro-caption");
  const nav = $(".intro-timeline"), fill = $(".intro-fill");
  const chapterBtns = CHAPTERS.map((c, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = c.name; b.style.left = `${(c.start / END) * 100}%`;
    b.onclick = () => seek(c.start + 0.01);
    nav.appendChild(b);
    return b;
  });

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.005, 4000);
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // keep the 16:10 horizontal framing on narrow/portrait screens by widening the vertical FOV
    const hHalf = Math.atan(Math.tan(22.5 * D2R) * 1.6);
    camera.fov = camera.aspect >= 1.6 ? 45 : Math.min(100, (2 * Math.atan(Math.tan(hHalf) / camera.aspect)) / D2R);
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();
  const loader = new THREE.TextureLoader();
  const tex = (url) => { const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

  // ---------- scene 1: the galaxy ----------
  const galaxyScene = new THREE.Scene();
  galaxyScene.add(starfield(4000, 900, 1.2));
  const galaxy = new THREE.Group();
  galaxyScene.add(galaxy);
  {
    const N = 70000, R = 60, ARMS = 4, SPIN = 4.2;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const cIn = new THREE.Color("#ffd49a"), cOut = new THREE.Color("#6d8dff"), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const r = Math.pow(Math.random(), 1.5) * R;
      const a = ((i % ARMS) / ARMS) * Math.PI * 2 + (r / R) * SPIN;
      const jitter = () => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * (2 + r * 0.32);
      pos.set([Math.cos(a) * r + jitter(), jitter() * 0.18, Math.sin(a) * r + jitter()], i * 3);
      c.copy(cIn).lerp(cOut, Math.min(1, r / (R * 0.75)));
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    galaxy.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.3, map: dotTexture(), vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })));
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(255,226,180,1)", "rgba(255,170,90,0.25)"), blending: THREE.AdditiveBlending, depthWrite: false }));
    core.scale.setScalar(38);
    galaxy.add(core);
  }
  // the Sun sits in a spur between two arms, ~58% of the way out
  const sunR = 35, sunA = (sunR / 60) * 4.2 + 0.7;
  const sunLocal = new THREE.Vector3(Math.cos(sunA) * sunR, 0, Math.sin(sunA) * sunR);
  const galaxySun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(255,244,214,1)", "rgba(255,196,107,0.35)"), blending: THREE.AdditiveBlending, depthWrite: false }));
  galaxySun.position.copy(sunLocal); galaxySun.scale.setScalar(2.2);
  galaxy.add(galaxySun);

  // ---------- scene 2: the solar system on today's date ----------
  const sys = new THREE.Scene();
  sys.add(starfield(6000, 1500, 1.1));
  sys.add(new THREE.AmbientLight(0xffffff, 0.12));
  sys.add(new THREE.PointLight(0xffffff, 2.6, 0, 0));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 24), new THREE.MeshBasicMaterial({ color: 0xffd58a }));
  sys.add(sun);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(255,236,190,1)", "rgba(255,170,80,0.3)"), blending: THREE.AdditiveBlending, depthWrite: false }));
  sunGlow.scale.setScalar(26); sys.add(sunGlow);

  const ORBIT_COLOR = { earth: 0x6fa8ff, mars: 0xc1440e };
  const fadeNearMars = []; // [material, base opacity]
  for (const name of Object.keys(ELEMENTS)) {
    const o = orbitAt(name, T), pts = [];
    for (let k = 0; k <= 256; k++) pts.push(toScene(o, (k / 256) * Math.PI * 2));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: ORBIT_COLOR[name] || 0xffffff, transparent: true, opacity: ORBIT_COLOR[name] ? 0.75 : 0.16 }));
    sys.add(line);
    fadeNearMars.push([line.material, line.material.opacity]);
  }
  { // asteroid belt between Mars and Jupiter
    const n = 3500, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = (2.2 + Math.random() * 1.1) * AU, a = Math.random() * Math.PI * 2;
      p.set([Math.cos(a) * r, (Math.random() - 0.5) * 2.5, Math.sin(a) * r], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    const belt = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8c847b, size: 0.45, map: dotTexture(), transparent: true, opacity: 0.55, depthWrite: false }));
    sys.add(belt);
    fadeNearMars.push([belt.material, 0.55]);
  }
  const planet = (name, radius, material) => { const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), material); m.position.copy(POS[name]); sys.add(m); return m; };
  planet("mercury", 0.45, new THREE.MeshStandardMaterial({ color: 0x9c968f, roughness: 1 }));
  planet("venus", 0.8, new THREE.MeshStandardMaterial({ color: 0xe9d3a7, roughness: 1 }));
  const earth = planet("earth", 1, new THREE.MeshStandardMaterial({ map: tex("textures/earth.jpg"), roughness: 0.85 }));
  const MARS_R = 0.8;
  const mars = planet("mars", MARS_R, new THREE.MeshStandardMaterial({ map: tex("textures/mars.jpg"), roughness: 1 }));
  planet("jupiter", 2.4, new THREE.MeshStandardMaterial({ map: bandTexture(["#d9c3a0", "#b48a64", "#e8dccb", "#a27552", "#cdb08a"]), roughness: 1 }));
  earth.rotation.z = 23.4 * D2R;

  // beacons: fixed-size dots so planets are visible from the overview (sizes aren't to scale anyway)
  const BEACON = { mercury: "#bdb8b0", venus: "#f1dcb0", earth: "#8fbaff", mars: "#e0713e", jupiter: "#e4cfa8" };
  const beacons = new THREE.Group();
  for (const [name, color] of Object.entries(BEACON)) {
    const g = new THREE.BufferGeometry().setFromPoints([POS[name]]);
    const big = name === "earth" || name === "mars";
    beacons.add(new THREE.Points(g, new THREE.PointsMaterial({ color, map: dotTexture(), size: big ? 14 : 10, sizeAttenuation: false, transparent: true, depthWrite: false })));
  }
  sys.add(beacons);

  // sharper Viking patch centred on Jezero (70.3125–84.375°E, 11.25–25.3125°N) for the final descent
  const patch = new THREE.Mesh(
    new THREE.SphereGeometry(MARS_R * 1.0006, 64, 64, (70.3125 + 180) * D2R, 14.0625 * D2R, (90 - 25.3125) * D2R, 14.0625 * D2R),
    new THREE.MeshStandardMaterial({ map: tex("textures/mars_jezero.jpg"), alphaMap: featherMask(), transparent: true, depthWrite: false, roughness: 1 }));
  mars.add(patch);

  // Jezero marker: a ring the size of the crater (~45 km) lying on the surface
  const nJ = surfaceNormal(JEZERO.lat, JEZERO.lon);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0062, 0.0078, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  ring.position.copy(nJ.clone().multiplyScalar(MARS_R * 1.0012));
  ring.lookAt(nJ.clone().multiplyScalar(2));
  mars.add(ring);

  // Earth → Mars distance line
  const linkLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([POS.earth, POS.mars]),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0 }));
  linkLine.computeLineDistances(); sys.add(linkLine);

  // ---------- camera choreography (solar-system scene) ----------
  const up = new THREE.Vector3(0, 1, 0);
  const sideOf = (dir) => new THREE.Vector3().crossVectors(up, dir).normalize();
  const toSunE = POS.earth.clone().negate().normalize();
  const earthDir = toSunE.clone().multiplyScalar(0.72).add(sideOf(toSunE).multiplyScalar(0.62)).add(up.clone().multiplyScalar(0.28)).normalize();
  const earthCam = POS.earth.clone().add(earthDir.multiplyScalar(3.6));
  const toSunM = POS.mars.clone().negate().normalize();
  const marsDir = toSunM.clone().multiplyScalar(0.75).add(sideOf(toSunM).multiplyScalar(-0.55)).normalize();
  const marsApproach = POS.mars.clone().add(marsDir.clone().add(up.clone().multiplyScalar(0.25)).normalize().multiplyScalar(5.5));
  const mid = POS.earth.clone().add(POS.mars).multiplyScalar(0.5);
  // wide shot holding Earth, the distance line and Mars, taken from the sunlit side
  const gap = POS.earth.distanceTo(POS.mars);
  const perp = new THREE.Vector3().crossVectors(up, POS.mars.clone().sub(POS.earth)).normalize();
  if (perp.dot(mid) > 0) perp.negate();
  const bothView = mid.clone().add(perp.multiplyScalar(gap * 0.95)).add(up.clone().multiplyScalar(gap * 0.42));
  // overview from behind the Sun, so Earth and Mars sit in the upper half — clear of the caption
  const midDir = mid.clone().setY(0).normalize();
  const overview = midDir.clone().multiplyScalar(-95).add(new THREE.Vector3(0, 80, 0));
  const overviewLook = midDir.clone().multiplyScalar(18);
  // spin Mars so Jezero ends up facing the approaching camera, in daylight
  const angN = Math.atan2(nJ.z, nJ.x), angT = Math.atan2(marsDir.z, marsDir.x);
  const marsRotFinal = angN - angT;
  const jezeroWorld = () => mars.localToWorld(nJ.clone().multiplyScalar(MARS_R));

  // ---------- labels (HTML, projected from 3D) ----------
  const labels = {};
  const label = (key, text, cls = "") => {
    const d = document.createElement("div"); d.className = `intro-label ${cls}`; d.textContent = text;
    labelsEl.appendChild(d); labels[key] = d; return d;
  };
  label("here", "You are here", "here");
  label("mercury", "Mercury"); label("venus", "Venus"); label("earth", "Earth", "earth");
  label("mars", "Mars", "mars"); label("jupiter", "Jupiter"); label("belt", "Asteroid belt", "faint");
  label("dist", `${distMkm} million km`, "dist");
  label("jezero", "Jezero crater", "here");
  const v = new THREE.Vector3();
  function place(key, world, show, dy = -14) {
    const el = labels[key];
    v.copy(world).project(camera);
    const sy = (-v.y * 0.5 + 0.5) * root.clientHeight;
    const visible = show && v.z < 1 && Math.abs(v.x) < 1.05 && sy > 60 && sy < root.clientHeight - 100; // keep clear of controls & timeline
    el.style.opacity = visible ? 1 : 0;
    if (visible) el.style.transform = `translate(${(v.x * 0.5 + 0.5) * root.clientWidth}px, ${(-v.y * 0.5 + 0.5) * root.clientHeight + dy}px) translate(-50%, -100%)`;
  }

  // ---------- frame ----------
  let t = 0, playing = true, raf = 0, last = performance.now(), done = false, captionIdx = -1;
  function frame(nowMs) {
    const dt = Math.min(0.1, (nowMs - last) / 1000); last = nowMs;
    if (playing) t += dt;
    if (t >= END) return finish();
    render();
    raf = requestAnimationFrame(frame);
  }

  function render() {
    // caption + timeline
    let ci = 0;
    CHAPTERS.forEach((c, i) => { if (t >= c.start) ci = i; });
    if (ci !== captionIdx) {
      captionIdx = ci;
      caption.classList.remove("show");
      setTimeout(() => { capH.textContent = CHAPTERS[ci].title; capP.textContent = CHAPTERS[ci].text; caption.classList.add("show"); }, 220);
      chapterBtns.forEach((b, i) => b.classList.toggle("active", i === ci));
    }
    fill.style.width = `${(t / END) * 100}%`;
    flash.style.opacity = Math.exp(-(((t - SUN_DIVE) / 0.45) ** 2));
    root.classList.toggle("ending", t > END - 1.6);

    if (t < SUN_DIVE) {
      galaxy.rotation.y = t * 0.02;
      galaxy.updateMatrixWorld();
      const sunW = galaxy.localToWorld(sunLocal.clone());
      const phi = 0.9 + t * 0.07;
      const orbitPos = new THREE.Vector3(Math.cos(phi) * 115, 62 - t * 3, Math.sin(phi) * 115);
      const u = ease(seg(t, 5.2, SUN_DIVE));
      const dive = sunW.clone().add(orbitPos.clone().sub(sunW).normalize().multiplyScalar(0.6));
      camera.position.copy(lerpV(orbitPos, dive, u));
      camera.lookAt(lerpV(new THREE.Vector3(), sunW, ease(seg(t, 4.8, 7.2))));
      place("here", sunW, t > 2 && t < 7.6, -10);
      for (const k of Object.keys(labels)) if (k !== "here") labels[k].style.opacity = 0;
      renderer.render(galaxyScene, camera);
      return;
    }

    // solar system
    const ts = t - SUN_DIVE;
    earth.rotation.y = ts * 0.35;
    const f = (x) => (x > 1 ? x - 0.5 : x > 0 ? (x * x) / 2 : 0); // smooth stop
    mars.rotation.y = marsRotFinal - 0.3 * f(27.2 - t);
    ring.material.opacity = t > 26.4 ? 0.75 + 0.25 * Math.sin(t * 4) : 0;
    ring.scale.setScalar(1 + 0.15 * Math.sin(t * 4));
    linkLine.material.opacity = 0.7 * seg(t, 19.6, 20.6) * (1 - seg(t, 23.6, 24.4));
    const away = 1 - seg(t, 24.2, 25.4);
    for (const [m, base] of fadeNearMars) { m.opacity = base * away; m.visible = away > 0.01; }
    const beaconAlpha = seg(t, 9.6, 10.6) * (1 - seg(t, 16.4, 17.4)) + seg(t, 19.4, 20.2) * (1 - seg(t, 22.8, 23.8));
    beacons.children.forEach((b) => { b.material.opacity = beaconAlpha; b.visible = beaconAlpha > 0.01; });

    let pos, look;
    const start = new THREE.Vector3(0, 3.5, 11);
    if (t < 15) {                         // pull back from the Sun to the whole inner system
      const u = ease(seg(t, SUN_DIVE, 14.2));
      pos = bez(start, new THREE.Vector3(0, 60, 30), overview, u);
      look = lerpV(new THREE.Vector3(), overviewLook, u);
    } else if (t < 19.2) {                // glide to Earth
      const u = ease(seg(t, 15, 18.6));
      pos = bez(overview, POS.earth.clone().add(new THREE.Vector3(0, 30, 0)), earthCam, u);
      look = lerpV(overviewLook, POS.earth, ease(seg(t, 15, 17.2)));
    } else if (t < 22.6) {                // pull back: Earth, the gap, Mars
      const u = ease(seg(t, 19.2, 22.2));
      pos = bez(earthCam, POS.earth.clone().add(up.clone().multiplyScalar(gap * 0.3)), bothView, u);
      look = lerpV(POS.earth, mid, u);
    } else if (t < 25.6) {                // cross the gap to Mars
      const u = ease(seg(t, 22.6, 25.5));
      pos = bez(bothView, POS.mars.clone().add(perp.clone().multiplyScalar(gap * 0.25)).add(up.clone().multiplyScalar(gap * 0.12)), marsApproach, u);
      look = lerpV(mid, POS.mars, ease(seg(t, 22.6, 24.4)));
    } else {                              // descend over Jezero
      mars.updateMatrixWorld();
      const n = jezeroWorld().sub(POS.mars).normalize();
      const u = ease(seg(t, 25.6, 31));
      pos = lerpV(marsApproach, POS.mars.clone().add(n.clone().multiplyScalar(MARS_R * 1.09)), u);
      look = lerpV(POS.mars, jezeroWorld(), ease(seg(t, 25.6, 28.5)));
    }
    camera.position.copy(pos);
    camera.lookAt(look);

    const sysLabels = t > 10 && t < 19.4;
    place("mercury", POS.mercury, sysLabels); place("venus", POS.venus, sysLabels);
    place("jupiter", POS.jupiter, sysLabels, -30);
    place("belt", new THREE.Vector3(0, 0, 0).add(POS.jupiter.clone().normalize().multiplyScalar(2.75 * AU)), sysLabels && t < 15);
    place("earth", POS.earth, t > 10 && t < 23.4, -20);
    place("mars", POS.mars, t > 10 && t < 24.6, -18);
    place("dist", mid, t > 20.4 && t < 23.4, -8);
    mars.updateMatrixWorld();
    place("jezero", jezeroWorld(), t > 27 && t < END - 1.4, -12);
    place("here", POS.earth, false);
    renderer.render(sys, camera);
  }

  // ---------- controls ----------
  function seek(time) { t = clamp(time, 0, END - 0.05); captionIdx = -1; render(); }
  function setPlaying(p) {
    playing = p;
    const b = $(".intro-pause");
    b.textContent = p ? "Pause" : "Play"; b.setAttribute("aria-label", p ? "Pause" : "Play");
  }
  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    root.classList.add("gone");
    window.removeEventListener("resize", resize);
    document.removeEventListener("keydown", onKey);
    onDone && onDone();
    setTimeout(() => { renderer.dispose(); root.remove(); }, 900);
  }
  function onKey(e) {
    if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); finish(); }
    else if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      let ci = 0; CHAPTERS.forEach((c, i) => { if (t >= c.start) ci = i; });
      ci = clamp(ci + (e.key === "ArrowRight" ? 1 : -1), 0, CHAPTERS.length - 1);
      seek(CHAPTERS[ci].start + 0.01);
    }
  }
  $(".intro-pause").onclick = () => setPlaying(!playing);
  $(".intro-skip").onclick = finish;
  document.addEventListener("keydown", onKey);
  $(".intro-skip").focus();
  raf = requestAnimationFrame(frame);

  return { finish, seek, get time() { return t; }, setPlaying };
}
