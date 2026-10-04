// Cinematic opener: title → Milky Way → Sun → solar system (today) → Earth → Mars →
// "anywhere on Mars": the globe spins, then unrolls into the flat map the app opens on.
// One timeline (seconds) drives picture and sound, so it can be paused, scrubbed and skipped.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Score } from "./score.js";

const SUN_DIVE = 8.6;    // galaxy scene before this, solar-system scene after
const WIDE = 14.2;       // hold on the whole solar system until here
const INNER = 14.6;      // zoom into the inner planets
const EARTH = 17.6;      // glide to Earth
const MARS = 21.8;       // pull back to see Earth and Mars together
const CROSS = 25.2;      // cross the gap
const ARRIVE = 28.2;     // in front of Mars
const UNROLL0 = 33.2;    // globe starts unrolling into a map
const UNROLL1 = 36.2;    // flat, lined up with the real map
const END = 37.8;
export const CUES = { sunDive: SUN_DIVE, inner: INNER, earth: EARTH, mars: MARS, cross: CROSS, arrive: ARRIVE, unroll0: UNROLL0, unroll1: UNROLL1, end: END };
const AU = 30;           // scene units per astronomical unit
const MARS_R = 0.8;

// ---------- real planet positions (JPL approximate Keplerian elements, valid 1800–2050) ----------
const ELEMENTS = { // a(AU), e, I, L, long. perihelion, long. node — and their rates per century
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
  mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  uranus: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.01262724]],
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
  { name: "Solar system", start: SUN_DIVE + 0.4, title: "The solar system today", text: `All eight planets, where they are on ${dateText}. Distances are to scale; sizes are not.` },
  { name: "Inner planets", start: INNER, title: "The inner planets", text: "Mercury, Venus, Earth and Mars: the rocky worlds close to the Sun." },
  { name: "Earth", start: EARTH, title: "Earth", text: "Home, and mission control." },
  { name: "Mars", start: MARS, title: "Mars", text: `${distMkm} million km from Earth today. A radio message takes ${lightMin} minutes to get there.` },
  { name: "Anywhere", start: ARRIVE, title: "Anywhere on Mars", text: "Volcanoes, canyons, craters and old lake beds. Pick any spot on the map and plan your walk." },
];
// places that light up as the globe turns (IAU gazetteer centres)
const PLACES = [
  ["Olympus Mons", 18.6528, -133.8025], ["Arsia Mons", -8.2571, -120.0925], ["Valles Marineris", -14.0059, -58.5877],
  ["Argyre Planitia", -49.8406, -43.3098], ["Acidalia Planitia", 49.76, -20.74], ["Meridiani Planum", -0.04, -3.14],
  ["Hellas Planitia", -42.4301, 70.5025], ["Jezero", 18.4082, 77.6873], ["Utopia Planitia", 46.7363, 117.5168],
  ["Gale", -5.3672, 137.811], ["Elysium Mons", 25.0232, 147.2138],
];

// ---------- helpers ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOut = (u) => 1 - Math.pow(1 - u, 3);
const lerpV = (a, b, u) => a.clone().lerp(b, u);
const bez = (p0, p1, p2, u) => p0.clone().multiplyScalar((1 - u) ** 2).add(p1.clone().multiplyScalar(2 * u * (1 - u))).add(p2.clone().multiplyScalar(u * u));
function surfaceNormal(lat, lon) { // matches THREE.SphereGeometry UVs with lon −180 at the texture's left edge
  const p = lat * D2R, l = lon * D2R;
  return new THREE.Vector3(Math.cos(p) * Math.cos(l), Math.sin(p), -Math.cos(p) * Math.sin(l));
}
// same shape the unroll shader draws, for pinning labels to the moving surface
function unrollPoint(lat, lon, m) {
  const la = lat * D2R, lo = lon * D2R;
  const sph = new THREE.Vector3(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
  const cyl = new THREE.Vector3(Math.sin(lo), la, Math.cos(lo));
  const a = ease(clamp(m * 2)), b = ease(clamp(m * 2 - 1));
  let p = sph.lerp(cyl, a);
  if (b > 0) {
    const k = 1 - b;
    p = k < 0.001 ? new THREE.Vector3(lo, la, 1) : new THREE.Vector3(Math.sin(lo * k) / k, la, (Math.cos(lo * k) - 1) / k + 1);
  }
  return p;
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
function atmosphere(radius, color, strength) { // soft halo: brightest at the planet's edge, fading into space
  const shell = 1.12, limb = Math.sqrt(1 - 1 / (shell * shell)); // |N·V| on the shell just outside the planet's edge
  return new THREE.Mesh(new THREE.SphereGeometry(radius * shell, 64, 32), new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(color) }, k: { value: strength }, limb: { value: limb } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 c; uniform float k; uniform float limb; varying vec3 vN; varying vec3 vV;
      void main() { float f = pow(clamp(abs(dot(vN, vV)) / limb, 0.0, 1.0), 2.2); gl_FragColor = vec4(c * f * k, f); }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
}

export function playIntro({ onDone, mapRect, autoplay = true } = {}) {
  // ---------- DOM ----------
  const root = document.createElement("div");
  root.id = "intro";
  root.className = "titled";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Intro: from the Milky Way to Mars");
  root.innerHTML = `
    <canvas class="intro-canvas"></canvas>
    <div class="intro-flash"></div>
    <div class="intro-labels" aria-hidden="true"></div>
    <div class="intro-scrim" aria-hidden="true"></div>
    <section class="intro-title">
      <p class="intro-by">Code Huzzlers presents</p>
      <h1>Martian Map</h1>
      <p class="intro-lede">Plan a safe walk anywhere on Mars, then follow it step by step.</p>
      <div class="intro-title-actions">
        <button type="button" class="intro-begin">Begin</button>
        <button type="button" class="intro-skip-title">Skip to map</button>
      </div>
      <p class="intro-note">Best with sound on. Made for the NASA Space Apps Challenge 2026.</p>
    </section>
    <div class="intro-caption" aria-live="polite"><h1></h1><p></p></div>
    <div class="intro-controls">
      <button type="button" class="intro-pause">Pause</button>
      <button type="button" class="intro-sound" aria-pressed="true">Sound on</button>
      <button type="button" class="intro-skip">Skip to map</button>
    </div>
    <nav class="intro-timeline" aria-label="Intro chapters"><div class="intro-track"><div class="intro-fill"></div></div></nav>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const canvas = $(".intro-canvas"), flash = $(".intro-flash"), labelsEl = $(".intro-labels");
  const capH = $(".intro-caption h1"), capP = $(".intro-caption p"), caption = $(".intro-caption");
  const nav = $(".intro-timeline"), fill = $(".intro-fill");
  const chapterBtns = CHAPTERS.map((c) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = c.name; b.style.left = `${(c.start / END) * 100}%`;
    b.onclick = () => seek(c.start + 0.01);
    nav.appendChild(b);
    return b;
  });

  // ---------- renderer + bloom ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.005, 60000);
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(new THREE.Scene(), camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, 0.55, 0.78);
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(new OutputPass());
  function resize() {
    const w = root.clientWidth, h = root.clientHeight, pr = Math.min(1.75, window.devicePixelRatio);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    composer.setPixelRatio(pr); composer.setSize(w, h);
    camera.aspect = w / h;
    // keep the 16:10 horizontal framing on narrow/portrait screens by widening the vertical FOV
    const hHalf = Math.atan(Math.tan(22.5 * D2R) * 1.6);
    camera.fov = camera.aspect >= 1.6 ? 45 : Math.min(100, (2 * Math.atan(Math.tan(hHalf) / camera.aspect)) / D2R);
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();
  const loader = new THREE.TextureLoader();
  const tex = (url) => { const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const marsTex = tex("textures/mars.jpg");

  // ---------- scene 1: the galaxy ----------
  const up = new THREE.Vector3(0, 1, 0);
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
    core.scale.setScalar(30);
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
  sys.add(starfield(7000, 25000, 1.1));
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
  earth.add(atmosphere(1, "#6fa8ff", 1.4));
  earth.rotation.z = 23.4 * D2R;
  const mars = planet("mars", MARS_R, new THREE.MeshStandardMaterial({ map: marsTex, roughness: 1 }));
  const marsAtmo = atmosphere(MARS_R, "#e8a07a", 0.7);
  mars.add(marsAtmo);
  planet("jupiter", 2.4, new THREE.MeshStandardMaterial({ map: bandTexture(["#d9c3a0", "#b48a64", "#e8dccb", "#a27552", "#cdb08a"]), roughness: 1 }));
  const saturn = planet("saturn", 2.0, new THREE.MeshStandardMaterial({ map: bandTexture(["#e6d3a8", "#cdb382", "#efe2c2", "#bfa274"]), roughness: 1 }));
  { // Saturn's rings, tilted ~27 degrees
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const g = c.getContext("2d");
    for (let r = 256; r > 0; r--) {
      const f = r / 256, inRing = f > 0.56;
      const band = 0.55 + 0.45 * Math.sin(f * 90) * Math.sin(f * 23);
      const alpha = (f > 0.8 && f < 0.84 ? 0.08 : 0.75) * band; // Cassini division
      g.fillStyle = inRing ? "rgba(226,208,170," + alpha.toFixed(3) + ")" : "rgba(0,0,0,0)";
      g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.fill();
    }
    const rt = new THREE.CanvasTexture(c); rt.colorSpace = THREE.SRGBColorSpace;
    const rings = new THREE.Mesh(new THREE.RingGeometry(2.6, 4.6, 128),
      new THREE.MeshBasicMaterial({ map: rt, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    rings.rotation.x = -Math.PI / 2 + 26.7 * D2R;
    saturn.add(rings);
  }
  planet("uranus", 1.5, new THREE.MeshStandardMaterial({ color: 0x9fd8e0, roughness: 1 }));
  planet("neptune", 1.45, new THREE.MeshStandardMaterial({ color: 0x4b70dd, roughness: 1 }));

  // beacons: fixed-size dots so planets are visible from the overview (sizes aren't to scale anyway)
  const BEACON = { mercury: "#bdb8b0", venus: "#f1dcb0", earth: "#8fbaff", mars: "#e0713e", jupiter: "#e4cfa8", saturn: "#eadcb6", uranus: "#a8e2ea", neptune: "#6f8ff0" };
  const beacons = new THREE.Group();
  for (const [name, color] of Object.entries(BEACON)) {
    const g = new THREE.BufferGeometry().setFromPoints([POS[name]]);
    const big = name === "earth" || name === "mars";
    beacons.add(new THREE.Points(g, new THREE.PointsMaterial({ color, map: dotTexture(), size: big ? 14 : 10, sizeAttenuation: false, transparent: true, depthWrite: false })));
  }
  sys.add(beacons);

  // Earth → Mars distance line
  const linkLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([POS.earth, POS.mars]),
    new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0 }));
  linkLine.computeLineDistances(); sys.add(linkLine);

  // ---------- camera choreography (solar-system scene) ----------
  const sideOf = (dir) => new THREE.Vector3().crossVectors(up, dir).normalize();
  const toSunE = POS.earth.clone().negate().normalize();
  const earthDir = toSunE.clone().multiplyScalar(0.72).add(sideOf(toSunE).multiplyScalar(0.62)).add(up.clone().multiplyScalar(0.28)).normalize();
  const earthCam = POS.earth.clone().add(earthDir.multiplyScalar(3.6));
  const toSunM = POS.mars.clone().negate().normalize();
  const marsDir = toSunM.clone().multiplyScalar(0.8).add(sideOf(toSunM).multiplyScalar(-0.45)).setY(0).normalize();
  const SPIN_DIST = 3.3;
  const marsCam = POS.mars.clone().add(marsDir.clone().multiplyScalar(SPIN_DIST)); // Mars centred, full disc
  const mid = POS.earth.clone().add(POS.mars).multiplyScalar(0.5);
  const gap = POS.earth.distanceTo(POS.mars);
  const perp = new THREE.Vector3().crossVectors(up, POS.mars.clone().sub(POS.earth)).normalize();
  if (perp.dot(mid) > 0) perp.negate();
  const bothView = mid.clone().add(perp.clone().multiplyScalar(gap * 0.95)).add(up.clone().multiplyScalar(gap * 0.42));
  const midDir = mid.clone().setY(0).normalize();
  const overview = midDir.clone().multiplyScalar(-95).add(new THREE.Vector3(0, 80, 0));
  const wideView = midDir.clone().multiplyScalar(-1550).add(new THREE.Vector3(0, 1450, 0)); // all eight orbits
  // zoom along the line of sight with the distance changing exponentially (reads as one smooth move)
  const zoomPath = (a, b, u) => {
    const da = a.length(), db = b.length();
    return a.clone().normalize().lerp(b.clone().normalize(), u).normalize().multiplyScalar(da * Math.pow(db / da, u));
  };
  const overviewLook = midDir.clone().multiplyScalar(18);
  // spin Mars so longitude 0 faces the camera when the unroll begins (north up, like the map)
  const marsRotFinal = -Math.atan2(marsDir.z, marsDir.x);

  // ---------- the unroll: globe → cylinder → flat map, drawn in front of the frozen camera ----------
  const unrollGeo = new THREE.SphereGeometry(1, 192, 96);
  {
    const uv = unrollGeo.attributes.uv, ll = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) { ll[i * 2] = (uv.getX(i) - 0.5) * 2 * Math.PI; ll[i * 2 + 1] = (uv.getY(i) - 0.5) * Math.PI; }
    unrollGeo.setAttribute("lonlat", new THREE.BufferAttribute(ll, 2));
  }
  const unrollMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: marsTex }, morph: { value: 0 }, lightDir: { value: new THREE.Vector3(0, 0, 1) }, opacity: { value: 0 } },
    vertexShader: `attribute vec2 lonlat; uniform float morph; varying vec2 vUv; varying vec3 vN;
      float ease(float x) { return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0; }
      void main() {
        float lon = lonlat.x, lat = lonlat.y;
        vec3 sph = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
        vec3 cyl = vec3(sin(lon), lat, cos(lon));
        float a = ease(clamp(morph * 2.0, 0.0, 1.0)), b = ease(clamp(morph * 2.0 - 1.0, 0.0, 1.0));
        vec3 p = mix(sph, cyl, a);
        if (b > 0.0) { float k = 1.0 - b; p = k < 0.001 ? vec3(lon, lat, 1.0) : vec3(sin(lon * k) / k, lat, (cos(lon * k) - 1.0) / k + 1.0); }
        vN = normalize(mix(sph, vec3(0.0, 0.0, 1.0), clamp(morph * 1.4, 0.0, 1.0)));
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 lightDir; uniform float morph; uniform float opacity; varying vec2 vUv; varying vec3 vN;
      void main() {
        vec4 tex = texture2D(map, vUv);
        float lambert = 0.12 + 0.83 * max(dot(normalize(vN), lightDir), 0.0);
        gl_FragColor = vec4(tex.rgb * mix(lambert, 1.0, smoothstep(0.2, 0.85, morph)), opacity);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, transparent: true,
  });
  const unroll = new THREE.Mesh(unrollGeo, unrollMat);
  unroll.frustumCulled = false; unroll.visible = false;
  sys.add(unroll);
  let frozen = null; // camera pose + target rectangle, captured when the unroll starts
  function freeze() {
    const W = root.clientWidth, H = root.clientHeight;
    const r = mapRect && mapRect();
    const rect = r && r.width > 20 ? r : { left: W * 0.1, top: (H - W * 0.4) / 2, width: W * 0.8, height: W * 0.4 };
    const wpp = (2 * SPIN_DIST * Math.tan((camera.fov * D2R) / 2)) / H; // scene units per pixel at the globe's depth
    const sEnd = (rect.width * wpp) / (2 * Math.PI);
    frozen = {
      pos: marsCam.clone(), quat: new THREE.Quaternion(),
      startC: new THREE.Vector3(0, 0, -SPIN_DIST), sStart: MARS_R,
      endC: new THREE.Vector3((rect.left + rect.width / 2 - W / 2) * wpp, -(rect.top + rect.height / 2 - H / 2) * wpp, -(SPIN_DIST + sEnd)), sEnd,
    };
    const m = new THREE.Matrix4().lookAt(marsCam, POS.mars, up);
    frozen.quat.setFromRotationMatrix(m);
    unrollMat.uniforms.lightDir.value.copy(POS.mars.clone().negate().normalize().applyQuaternion(frozen.quat.clone().invert()));
  }

  // ---------- labels (HTML, projected from 3D) ----------
  const labels = {};
  const label = (key, text, cls = "") => {
    const d = document.createElement("div"); d.className = `intro-label ${cls}`; d.textContent = text;
    labelsEl.appendChild(d); labels[key] = d; return d;
  };
  label("here", "You are here", "here");
  label("mercury", "Mercury"); label("venus", "Venus"); label("earth", "Earth", "earth");
  label("mars", "Mars", "mars"); label("jupiter", "Jupiter"); label("belt", "Asteroid belt", "faint");
  label("saturn", "Saturn"); label("uranus", "Uranus"); label("neptune", "Neptune"); label("sun", "Sun", "faint");
  label("dist", `${distMkm} million km`, "dist");
  PLACES.forEach(([n], i) => label(`p${i}`, n, "place"));
  const v = new THREE.Vector3();
  function place(key, world, show, dy = -14) {
    const el = labels[key];
    v.copy(world).project(camera);
    const sy = (-v.y * 0.5 + 0.5) * root.clientHeight;
    const visible = show && v.z < 1 && Math.abs(v.x) < 1.05 && sy > 60 && sy < root.clientHeight - 100; // clear of controls & timeline
    el.style.opacity = visible ? 1 : 0;
    if (visible) el.style.transform = `translate(${(v.x * 0.5 + 0.5) * root.clientWidth}px, ${sy + dy}px) translate(-50%, -100%)`;
  }

  // ---------- sound ----------
  let score = null, soundOn = true;
  function startSound() {
    if (!soundOn) return;
    try { score = score || new Score(CUES); score.start(t); } catch { score = null; return; }
    // browsers keep audio locked until the viewer clicks or presses a key; say so on the button
    setTimeout(() => {
      if (score && score.ctx.state !== "running" && !done) {
        const b = $(".intro-sound"); b.textContent = "Click for sound"; b.classList.add("locked");
      }
    }, 400);
  }
  // first click / key press anywhere: unlock audio and pick the music up where the picture is
  function unlockSound() {
    if (!score || score.ctx.state === "running" || done) return;
    score.ctx.resume().then(() => {
      if (playing && !done) score.start(t);
      const b = $(".intro-sound"); b.classList.remove("locked"); b.textContent = soundOn ? "Sound on" : "Sound off";
    });
  }
  document.addEventListener("pointerdown", unlockSound, true);
  document.addEventListener("keydown", unlockSound, true);

  // ---------- frame ----------
  let t = 0, playing = false, titled = true, raf = 0, last = performance.now(), idle = 0, done = false, captionIdx = -1;
  function frame(nowMs) {
    const dt = Math.min(0.1, (nowMs - last) / 1000); last = nowMs;
    if (playing) t += dt;
    if (titled) idle += dt;
    if (t >= END) return finish();
    render();
    raf = requestAnimationFrame(frame);
  }

  function render() {
    if (!titled) {
      let ci = 0;
      CHAPTERS.forEach((c, i) => { if (t >= c.start) ci = i; });
      if (ci !== captionIdx) {
        captionIdx = ci;
        caption.classList.remove("show");
        setTimeout(() => { capH.textContent = CHAPTERS[ci].title; capP.textContent = CHAPTERS[ci].text; caption.classList.add("show"); }, 220);
        chapterBtns.forEach((b, i) => b.classList.toggle("active", i === ci));
      }
    }
    fill.style.width = `${(t / END) * 100}%`;
    flash.style.opacity = Math.exp(-(((t - SUN_DIVE) / 0.45) ** 2));
    root.classList.toggle("ending", t > UNROLL1 - 0.4);
    // bloom: strong around the galaxy core and the Sun, gentle near planets, off for the map
    bloom.strength = t < SUN_DIVE ? 0.45 + 1.8 * ease(seg(t, 5.4, SUN_DIVE))
      : 1.3 - 0.5 * seg(t, SUN_DIVE, 11) - 0.45 * seg(t, EARTH, EARTH + 2) + 0.2 * seg(t, MARS, MARS + 1.5) - 0.3 * seg(t, CROSS, ARRIVE) - 0.2 * seg(t, UNROLL0, UNROLL0 + 1);

    if (t < SUN_DIVE) {
      galaxy.rotation.y = (t + idle) * 0.02;
      galaxy.updateMatrixWorld();
      const sunW = galaxy.localToWorld(sunLocal.clone());
      const phi = 0.9 + t * 0.07 + idle * 0.02;
      const orbitPos = new THREE.Vector3(Math.cos(phi) * 115, 62 - t * 3, Math.sin(phi) * 115);
      const u = ease(seg(t, 5.2, SUN_DIVE));
      const dive = sunW.clone().add(orbitPos.clone().sub(sunW).normalize().multiplyScalar(0.6));
      camera.position.copy(lerpV(orbitPos, dive, u));
      // on the title screen the galaxy sits to the right of the words; it drifts to centre as we start
      const right = new THREE.Vector3().crossVectors(orbitPos.clone().negate().normalize(), up).normalize();
      const offset = right.multiplyScalar(-34 * (1 - ease(seg(t, 0.3, 4.5))));
      camera.lookAt(lerpV(offset, sunW, ease(seg(t, 4.8, 7.2))));
      for (const k of Object.keys(labels)) if (k !== "here") labels[k].style.opacity = 0;
      place("here", sunW, !titled && t > 2 && t < 7.6, -10);
      renderPass.scene = galaxyScene;
      composer.render();
      return;
    }

    // solar system
    earth.rotation.y = (t - SUN_DIVE) * 0.35;
    const turn = 1 - easeOut(seg(t, CROSS + 1, UNROLL0 - 0.15)); // one slowing turn so the whole planet goes by
    mars.rotation.y = marsRotFinal - turn * Math.PI * 2;
    const away = 1 - seg(t, CROSS + 1, ARRIVE - 0.6);
    for (const [m, base] of fadeNearMars) { m.opacity = base * away; m.visible = away > 0.01; }
    linkLine.material.opacity = 0.7 * seg(t, MARS + 0.4, MARS + 1.4) * (1 - seg(t, CROSS - 1.6, CROSS - 0.8));
    const beaconAlpha = seg(t, 9.4, 10.4) * (1 - seg(t, EARTH + 1.2, EARTH + 2.2)) + seg(t, MARS + 0.2, MARS + 1) * (1 - seg(t, CROSS - 0.4, CROSS + 0.6));
    beacons.children.forEach((b) => { b.material.opacity = beaconAlpha; b.visible = beaconAlpha > 0.01; });

    let pos, look;
    const start = new THREE.Vector3(0, 3.5, 11);
    if (t < WIDE) {                       // burst out of the Sun and keep pulling back: all eight planets
      const u = ease(seg(t, SUN_DIVE, WIDE - 1.4));
      pos = zoomPath(start, wideView, u).applyAxisAngle(up, seg(t, SUN_DIVE, WIDE) * 0.12);
      look = new THREE.Vector3();
    } else if (t < EARTH) {               // dive back in to the inner planets
      const u = ease(seg(t, WIDE, EARTH - 0.4));
      pos = zoomPath(wideView.clone().applyAxisAngle(up, 0.12), overview, u);
      look = lerpV(new THREE.Vector3(), overviewLook, u);
    } else if (t < MARS) {                // glide to Earth
      const u = ease(seg(t, EARTH, MARS - 0.6));
      pos = bez(overview, POS.earth.clone().add(new THREE.Vector3(0, 30, 0)), earthCam, u);
      look = lerpV(overviewLook, POS.earth, ease(seg(t, EARTH, EARTH + 2.2)));
    } else if (t < CROSS) {               // pull back: Earth, the gap, Mars
      const u = ease(seg(t, MARS, CROSS - 0.4));
      pos = bez(earthCam, POS.earth.clone().add(up.clone().multiplyScalar(gap * 0.3)), bothView, u);
      look = lerpV(POS.earth, mid, u);
    } else {                              // cross the gap and settle in front of Mars
      const u = ease(seg(t, CROSS, ARRIVE + 0.6));
      pos = bez(bothView, POS.mars.clone().add(perp.clone().multiplyScalar(gap * 0.25)).add(up.clone().multiplyScalar(gap * 0.12)), marsCam, u);
      look = lerpV(mid, POS.mars, ease(seg(t, CROSS, CROSS + 2)));
    }
    // a short shudder as we burst out of the Sun
    const shake = Math.max(0, 1 - (t - SUN_DIVE) / 0.9) * 0.18;
    pos.add(new THREE.Vector3(Math.sin(t * 91) * shake, Math.cos(t * 77) * shake, 0));
    camera.position.copy(pos);
    camera.lookAt(look);

    // the unroll
    const inUnroll = t >= UNROLL0 - 0.35;
    if (inUnroll && !frozen) freeze();
    if (!inUnroll) frozen = null;
    unroll.visible = inUnroll;
    mars.visible = t < UNROLL0 + 0.05;
    if (inUnroll) {
      camera.position.copy(frozen.pos); camera.quaternion.copy(frozen.quat);
      const m = seg(t, UNROLL0, UNROLL1);
      unrollMat.uniforms.morph.value = m;
      unrollMat.uniforms.opacity.value = seg(t, UNROLL0 - 0.35, UNROLL0);
      const u = ease(seg(t, UNROLL0 + 0.5, UNROLL1));
      // the cylinder is π/2 times taller than the globe — shrink while it forms so the height holds steady
      const base = frozen.sStart * (1 - (1 - 2 / Math.PI) * ease(clamp(m * 2)));
      const s = base * Math.pow(frozen.sEnd / base, u);
      unroll.scale.setScalar(s);
      unroll.quaternion.copy(frozen.quat);
      // the flattened surface sits at local z = +s, so keep it at the globe's depth as the scale grows
      const c = lerpV(frozen.startC, new THREE.Vector3(frozen.endC.x, frozen.endC.y, -(SPIN_DIST + s)), u);
      unroll.position.copy(c.applyQuaternion(frozen.quat).add(frozen.pos));
    }
    camera.updateMatrixWorld();

    const wide = t > 10.2 && t < WIDE + 0.6, inner = t > INNER + 1.6 && t < EARTH + 1.6;
    place("sun", new THREE.Vector3(), wide, -12);
    place("jupiter", POS.jupiter, wide || inner, -16); place("saturn", POS.saturn, wide, -16);
    place("uranus", POS.uranus, wide, -12); place("neptune", POS.neptune, wide, -12);
    place("mercury", POS.mercury, inner); place("venus", POS.venus, inner);
    place("belt", POS.jupiter.clone().normalize().multiplyScalar(2.75 * AU), inner && t < EARTH);
    place("earth", POS.earth, t > INNER + 1.6 && t < CROSS - 0.8, -20);
    place("mars", POS.mars, t > INNER + 1.6 && t < CROSS + 0.8, -18);
    place("dist", mid, t > MARS + 1.2 && t < CROSS - 0.8, -8);
    place("here", POS.earth, false);

    // famous places: on the turning globe, then riding along the unroll
    mars.updateMatrixWorld();
    const camW = camera.position;
    PLACES.forEach(([, lat, lon], i) => {
      let w, show;
      if (!inUnroll || t < UNROLL0) {
        const nW = surfaceNormal(lat, lon).applyQuaternion(mars.quaternion);
        w = POS.mars.clone().add(nW.clone().multiplyScalar(MARS_R));
        show = t > ARRIVE + 0.4 && nW.dot(camW.clone().sub(w).normalize()) > 0.35;
      } else {
        const m = unrollMat.uniforms.morph.value;
        const p = unrollPoint(lat, lon, m);
        w = p.multiplyScalar(unroll.scale.x).applyQuaternion(unroll.quaternion).add(unroll.position);
        show = (m > 0.55 || unrollPoint(lat, lon, m).z > 0.35) && t < UNROLL1 + 0.3;
      }
      place(`p${i}`, w, show, -6);
    });

    renderPass.scene = sys;
    composer.render();
  }

  // ---------- controls ----------
  function seek(time) {
    t = clamp(time, 0, END - 0.05); captionIdx = -1; frozen = null;
    if (score && playing) score.start(t);
    render();
  }
  function setPlaying(p) {
    playing = p;
    const b = $(".intro-pause");
    b.textContent = p ? "Pause" : "Play";
    if (score) p ? score.start(t) : score.stop();
  }
  function begin() {
    if (!titled) return;
    titled = false;
    root.classList.remove("titled");
    playing = true;
    startSound();
    $(".intro-pause").focus();
  }
  function setSound(on) {
    soundOn = on;
    const b = $(".intro-sound");
    b.textContent = on ? "Sound on" : "Sound off"; b.setAttribute("aria-pressed", String(on));
    if (on && !score && !titled) startSound();
    else if (score) score.setMuted(!on);
  }
  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    root.classList.add("gone");
    window.removeEventListener("resize", resize);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", unlockSound, true);
    document.removeEventListener("keydown", unlockSound, true);
    clearTimeout(autoTimer);
    if (score) score.close();
    onDone && onDone();
    setTimeout(() => { composer.dispose(); renderer.dispose(); root.remove(); }, 900);
  }
  function onKey(e) {
    if (titled) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); begin(); } else if (e.key === "Escape") finish(); return; }
    if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); finish(); }
    else if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === "m" || e.key === "M") setSound(!soundOn);
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      let ci = 0; CHAPTERS.forEach((c, i) => { if (t >= c.start) ci = i; });
      ci = clamp(ci + (e.key === "ArrowRight" ? 1 : -1), 0, CHAPTERS.length - 1);
      seek(CHAPTERS[ci].start + 0.01);
    }
  }
  $(".intro-begin").onclick = begin;
  $(".intro-skip-title").onclick = finish;
  $(".intro-pause").onclick = () => setPlaying(!playing);
  $(".intro-sound").onclick = () => setSound(!soundOn);
  $(".intro-skip").onclick = finish;
  document.addEventListener("keydown", onKey);
  $(".intro-begin").focus();
  // start on its own after a moment on the title screen (Begin starts it straight away)
  const autoTimer = autoplay ? setTimeout(() => { if (titled && !done) begin(); }, 3200) : 0;
  raf = requestAnimationFrame(frame);

  return { finish, seek, begin, setPlaying, get time() { return t; } };
}
