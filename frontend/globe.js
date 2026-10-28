// Mars in 3D — the whole planet as a streaming globe, like Google Earth (CesiumJS).
//  • Terrain: the local MOLA grid for the planet view (instant), the HRSC/MOLA 200 m blend as you
//    zoom in, and the 20 m CTX DTM in Jezero — /api/terrain/tile serves 65×65 heightmaps.
//  • Imagery: the Viking colour mosaic, sharpened close up by the global 5 m CTX mosaic and, in
//    Jezero, HiRISE 25 cm — the heavy layers come through /api/imagery as small WebP tiles.
//  • On top: your route (coloured by slope) and stops, landing sites, IAU place names, the
//    Perseverance and Curiosity traverses, your position — and a chase-camera flight along the walk.
//  • Never closer than the elevation data can show truthfully: ~1.5 km above the ground in most
//    places, 200 m in Jezero, where a 20 m terrain model exists.
// The engine (~1.5 MB) downloads the first time 3D is opened, then stays alive and in the cache.
const Globe = (() => {
  const BASE = "https://cdn.jsdelivr.net/npm/cesium@1.144.0/Build/Cesium/";
  const R = 3396190;                 // Mars 2000 sphere — the datum of the DEMs and the imagery
  // Cesium can't draw terrain while the camera is inside its ellipsoid, and Mars' lowlands lie up to
  // 8.2 km below the datum (Hellas). So the engine's sphere sits 10 km under the datum and every
  // height is raised by that much: lift(h) is where a height above the datum goes in the scene.
  const DATUM = 10000;
  const lift = (h) => DATUM + h * exag;
  const D2R = Math.PI / 180;
  const MIN_M = { jezero: 200, mars: 1500 };   // closest approach, by what the elevation data resolves
  let C = null, viewer = null, root = null, enginePromise = null, providers = null;
  let opened = null, exag = 1, mode = "free", walkState = null, raf = 0, orbiting = null, veilTimer = 0;
  let features = null, featureLabels = null, routeFor = null, meFor = null, herePin = null;
  const routeEnts = [], routeLines = [], meEnts = [];
  const inJezero = (lat, lon) => lat >= JEZ_CTX[0][0] && lat <= JEZ_CTX[1][0] && lon >= JEZ_CTX[0][1] && lon <= JEZ_CTX[1][1];

  // ---------- engine (loaded on first use only) ----------
  function engine() {
    if (enginePromise) return enginePromise;
    window.CESIUM_BASE_URL = BASE;
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = `${BASE}Widgets/widgets.css`;
    document.head.appendChild(css);
    enginePromise = new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = `${BASE}Cesium.js`;
      s.onload = () => ok(window.Cesium);
      s.onerror = () => { enginePromise = null; s.remove(); fail(new Error("couldn't download the 3D engine")); };
      document.head.appendChild(s);
    });
    return enginePromise;
  }

  // ---------- overlay ----------
  function shell() {
    if (root) return;
    root = document.createElement("div");
    root.id = "globe"; root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Mars in 3D");
    root.innerHTML = `
      <header class="gv-head gl-head">
        <div class="gv-name"><div class="gv-title"></div><div class="gv-sub"></div></div>
        <div class="gl-tools">
          <button type="button" data-act="planet" title="Zoom out to the whole planet">🌐 Planet</button>
          <button type="button" data-act="here" title="Back to the place this view opened on">📍 Here</button>
          <button type="button" data-act="print" title="Make a 3D-printable relief model of this area">🖨 Print model</button>
          <select class="gl-imagery" aria-label="Imagery">
            <option value="colour">Colour + CTX 5 m detail</option>
            <option value="ctx">CTX 5 m (sharpest, greyscale)</option>
            <option value="viking">Viking colour</option>
            <option value="mola">MOLA elevation colours</option>
          </select>
          <span class="gl-exag" role="group" aria-label="Relief exaggeration"><button type="button" data-exag="1">Relief ×1</button><button type="button" data-exag="2">×2</button><button type="button" data-exag="3">×3</button></span>
          <button type="button" class="gl-close" data-act="close">🗺 Back to map</button>
        </div>
      </header>
      <div class="gl-body">
        <div class="gl-view"></div>
        <div class="gl-veil" hidden><span class="gv-spin"></span><span class="gl-veil-text"></span></div>
        <div class="gl-status" hidden><span class="gv-spin"></span><span class="gl-status-text"></span></div>
        <div class="gl-pad" aria-label="Camera controls">
          <button type="button" data-nav="north" class="gl-compass" title="Turn north up"><span>▲</span><i>N</i></button>
          <button type="button" data-nav="in" title="Zoom in">＋</button>
          <button type="button" data-nav="out" title="Zoom out">－</button>
          <button type="button" data-nav="left" title="Turn left">⟲</button>
          <button type="button" data-nav="right" title="Turn right">⟳</button>
          <button type="button" data-nav="tilt" title="Switch between a tilted view and straight down">◩</button>
          <button type="button" data-nav="orbit" title="Slowly circle the centre of the view">↻ Orbit</button>
        </div>
        <div class="gv-hud gl-hud"></div>
        <div class="gl-hint">Drag to move · right-drag or Ctrl-drag to tilt &amp; turn · scroll to zoom · double-click to zoom in</div>
        <div class="gl-readout"></div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector("[data-act=close]").onclick = close;
    root.querySelector("[data-act=planet]").onclick = planet;
    root.querySelector("[data-act=here]").onclick = () => opened && opened.lat !== undefined && goTo(opened.lat, opened.lon, opened.alt);
    root.querySelector("[data-act=print]").onclick = () => {
      const c = centre() || opened;
      if (!c) return;
      const seenKm = ((viewer.camera.positionCartographic.height - DATUM) / 1000) * 1.2; // about what's on screen
      PrintModel.open({ lat: c.lat, lon: c.lon, spanKm: Math.max(5, Math.min(1000, seenKm)),
        name: opened && opened.lat !== undefined && !opened.fromMap ? opened.name : "This view" });
    };
    root.querySelector(".gl-imagery").onchange = (e) => setImagery(e.target.value);
    root.querySelectorAll("[data-exag]").forEach((b) => (b.onclick = () => setExag(+b.dataset.exag)));
    root.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => nav(b.dataset.nav)));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root && !root.hidden && !document.querySelector("#gv, .pm-back")) close(); });
  }
  function status(text) {
    const el = root.querySelector(".gl-status");
    el.hidden = !text;
    el.querySelector(".gl-status-text").textContent = text || "";
  }
  // cover the view while a new place streams in, instead of showing blurry or empty frames;
  // untilLoaded lifts it as soon as the terrain on screen has arrived
  let veilCheck = null;
  function veil(text, untilLoaded = false) {
    const v = root.querySelector(".gl-veil");
    clearTimeout(veilTimer);
    if (veilCheck) { viewer.scene.postRender.removeEventListener(veilCheck); veilCheck = null; }
    if (!text) { v.hidden = true; return; }
    v.querySelector(".gl-veil-text").textContent = text;
    v.hidden = false;
    // a jump only needs covering until the coarse terrain is in (the status pill shows the rest)
    veilTimer = setTimeout(() => veil(""), untilLoaded ? 4000 : 30000);
    if (untilLoaded && viewer) {
      const t0 = performance.now();
      veilCheck = () => { if (performance.now() - t0 > 500 && viewer.scene.globe.tilesLoaded) veil(""); };
      viewer.scene.postRender.addEventListener(veilCheck);
    }
  }

  // ---------- viewer ----------
  async function ensureViewer() {
    if (viewer) return;
    C = await engine();
    const ell = new C.Ellipsoid(R - DATUM, R - DATUM, R - DATUM);
    C.Ellipsoid.default = ell;
    // Lines draped on the ground are sized from a built-in table of *Earth's* terrain heights; on
    // Mars (lifted by DATUM) that table would cull them. Use one range that holds all of Mars instead.
    const ath = C.ApproximateTerrainHeights;
    ath._initPromise = Promise.resolve();
    ath._terrainHeights = {};
    ath._defaultMinTerrainHeight = 0;
    ath._defaultMaxTerrainHeight = DATUM + 21300 * 3;  // Olympus Mons at ×3 relief
    const tiling = new C.GeographicTilingScheme({ ellipsoid: ell });
    viewer = new C.Viewer(root.querySelector(".gl-view"), {
      ellipsoid: ell, baseLayer: false, animation: false, timeline: false, geocoder: false, homeButton: false,
      sceneModePicker: false, baseLayerPicker: false, navigationHelpButton: false, fullscreenButton: false,
      infoBox: false, selectionIndicator: false, targetFrameRate: 30,
      terrainProvider: new C.CustomHeightmapTerrainProvider({
        width: 65, height: 65, tilingScheme: tiling,
        callback: (x, y, level) => fetch(`/api/terrain/tile/${level}/${x}/${y}`)
          .then((r) => { if (!r.ok) throw new Error(`terrain ${r.status}`); return r.arrayBuffer(); })
          .then((b) => Float32Array.from(new Int16Array(b), (h) => h + DATUM)),
      }),
    });
    try { setup(ell, tiling); } catch (e) { viewer.destroy(); viewer = null; throw e; }
  }
  function setup(ell, tiling) {
    const scene = viewer.scene, globe = scene.globe;
    if (scene.moon) scene.moon.show = false;
    globe.baseColor = C.Color.fromCssColorString("#7a5038");   // Mars-brown, never black, while tiles load
    globe.showGroundAtmosphere = false;
    globe.tileCacheSize = 800;
    globe.depthTestAgainstTerrain = true;
    // a thin butterscotch sky instead of Earth's blue (Cesium only adds an atmosphere for Earth)
    scene.skyAtmosphere = new C.SkyAtmosphere(ell);
    scene.skyAtmosphere.hueShift = -0.5;
    scene.skyAtmosphere.saturationShift = -0.25;
    scene.skyAtmosphere.brightnessShift = -0.35;
    controls();
    viewer.cesiumWidget.creditContainer.classList.add("gl-credits");
    viewer.creditDisplay.addStaticCredit(new C.Credit("Terrain: MGS MOLA, HRSC/MOLA blend (USGS), CTX DTM · Imagery: NASA/JPL-Caltech, Mars Trek, CTX mosaic (Caltech Murray Lab, Esri)"));
    imageryProviders(tiling);
    setImagery("colour");
    globe.tileLoadProgressEvent.addEventListener((n) => {
      status(n ? `Loading NASA terrain and imagery… ${n} tile${n === 1 ? "" : "s"} to go` : "");
    });
    viewer.camera.percentageChanged = 0.01;
    viewer.camera.changed.addEventListener(onCamera);
    loadStatic();
  }

  // Google-Earth-style mouse controls, and limits that keep the camera where the data looks real
  function controls() {
    const ctl = viewer.scene.screenSpaceCameraController, E = C.CameraEventType, K = C.KeyboardEventModifier;
    ctl.rotateEventTypes = E.LEFT_DRAG;                    // drag: move across the planet
    ctl.translateEventTypes = E.LEFT_DRAG;
    ctl.tiltEventTypes = [E.RIGHT_DRAG, E.MIDDLE_DRAG, { eventType: E.LEFT_DRAG, modifier: K.CTRL }, { eventType: E.LEFT_DRAG, modifier: K.SHIFT }];
    ctl.zoomEventTypes = [E.WHEEL, E.PINCH];
    ctl.enableLook = false;                                // free look spins you off into space
    ctl.minimumZoomDistance = MIN_M.mars;
    ctl.maximumZoomDistance = 2.4e7;
    ctl.minimumCollisionTerrainHeight = DATUM + 30000 * 3; // always keep clear of the terrain, even on Olympus Mons
    ctl.inertiaSpin = 0.8; ctl.inertiaTranslate = 0.8; ctl.inertiaZoom = 0.6;
    const h = viewer.cesiumWidget.screenSpaceEventHandler;
    h.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    h.setInputAction((e) => {                              // double-click: zoom in towards that spot
      const p = viewer.scene.globe.pick(viewer.camera.getPickRay(e.position), viewer.scene);
      if (!p) return;
      const range = C.Cartesian3.distance(viewer.camera.positionWC, p);
      flyAround(p, viewer.camera.heading, Math.min(viewer.camera.pitch, -30 * D2R), Math.max(minRange() * 1.5, range / 3));
    }, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    const stopOrbit = () => { if (orbiting) toggleOrbit(false); };
    viewer.scene.canvas.addEventListener("pointerdown", stopOrbit);
    viewer.scene.canvas.addEventListener("wheel", stopOrbit, { passive: true });
  }
  function onCamera() {
    const c = viewer.camera.positionCartographic, lat = c.latitude / D2R, lon = c.longitude / D2R;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = inJezero(lat, lon) ? MIN_M.jezero : MIN_M.mars;
    const h = c.height - DATUM;
    root.querySelector(".gl-readout").textContent = `${fmtLatLon(lat, lon)} · ${h > 20000 ? `${(h / 1000).toFixed(0)} km` : `${Math.round(h)} m`} above the datum`;
    root.querySelector(".gl-compass span").style.transform = `rotate(${-viewer.camera.heading / D2R}deg)`;
  }
  const minRange = () => viewer.scene.screenSpaceCameraController.minimumZoomDistance;

  function imageryProviders(tiling) {
    const trek = (layer, ext, maximumLevel) => new C.UrlTemplateImageryProvider({
      url: `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`, tilingScheme: tiling, maximumLevel });
    // the heavy greyscale layers come through our server as WebP (~5x smaller than the PNG originals)
    const ours = (layer, maximumLevel, extra = {}) => new C.UrlTemplateImageryProvider({ url: `/api/imagery/${layer}/{z}/{y}/{x}`, tilingScheme: tiling, maximumLevel, ...extra });
    const box = (b) => C.Rectangle.fromDegrees(b[0][1], b[0][0], b[1][1], b[1][0]);
    providers = {
      viking: trek("Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg", 7),
      mola: trek("Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg", 6),
      ctx: ours("ctx", 12, { tileWidth: 512, tileHeight: 512 }),
      jezCtx: ours("jez_ctx", 13, { rectangle: box(JEZ_CTX) }),
      jezHirise: ours("jez_hirise", 17, { rectangle: box(JEZ_HIRISE) }),
    };
  }
  function setImagery(m) {
    const layers = viewer.imageryLayers;
    layers.removeAll(true);
    const add = (p, o = {}) => layers.add(new C.ImageryLayer(p, o));
    if (m === "viking") add(providers.viking);
    else if (m === "mola") add(providers.mola);
    else {
      add(providers.viking);
      // the 5 m detail only once you're close; colour mode keeps some Viking colour under it
      add(providers.ctx, m === "ctx" ? { minimumTerrainLevel: 6 } : { alpha: 0.72, minimumTerrainLevel: 8 });
      add(providers.jezCtx, { minimumTerrainLevel: 9 });
      add(providers.jezHirise, { minimumTerrainLevel: 11 });
    }
    root.querySelector(".gl-imagery").value = m;
  }
  function setExag(k) {
    exag = k;
    viewer.scene.verticalExaggeration = k;
    viewer.scene.verticalExaggerationRelativeHeight = DATUM; // stretch heights about the datum
    root.querySelectorAll("[data-exag]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.exag === k)));
    if (featureLabels) placeFeatureLabels();
  }

  // ---------- what's on the globe ----------
  const color = (css, a = 1) => C.Color.fromCssColorString(css).withAlpha(a);
  const pinImage = (label, kind) => {
    const fill = kind === "start" ? "#34a853" : kind === "end" || kind === "here" ? "#ea4335" : "#ffffff";
    const ink = kind === "mid" ? "#111" : "#fff";
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38"><path d="M14 37S2 22.5 2 14a12 12 0 0 1 24 0c0 8.5-12 23-12 23z" fill="${fill}" stroke="#111" stroke-width="1.5"/><text x="14" y="18.5" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="12" font-weight="700" fill="${ink}">${label}</text></svg>`)}`;
  };
  const label = (text, css, offsetY, extra = {}) => ({ text, font: "600 13px Inter, sans-serif", fillColor: color(css), outlineColor: C.Color.BLACK, outlineWidth: 3,
    style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, offsetY), heightReference: C.HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY, ...extra });
  const pin = (lat, lon, text, kind, name) => viewer.entities.add({
    position: C.Cartesian3.fromDegrees(lon, lat),
    billboard: { image: pinImage(text, kind), verticalOrigin: C.VerticalOrigin.BOTTOM, heightReference: C.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: name ? label(name, "#ffffff", -40, { verticalOrigin: C.VerticalOrigin.BOTTOM }) : undefined,
  });
  // A line draped on the terrain. Built on the main thread (asynchronous: false) because the worker
  // that would otherwise build it has its own copy of Earth's height table (see ensureViewer).
  function groundLine(lonLats, css, width, { alpha = 1, dash = false, far } = {}) {
    const attributes = { color: C.ColorGeometryInstanceAttribute.fromColor(color(css, alpha)) };
    if (far) attributes.distanceDisplayCondition = new C.DistanceDisplayConditionGeometryInstanceAttribute(0, far);
    return viewer.scene.groundPrimitives.add(new C.GroundPolylinePrimitive({
      geometryInstances: new C.GeometryInstance({ geometry: new C.GroundPolylineGeometry({ positions: C.Cartesian3.fromDegreesArray(lonLats), width }), attributes }),
      appearance: dash ? new C.PolylineMaterialAppearance({ material: C.Material.fromType("PolylineDash", { color: color(css, alpha), dashLength: 18 }) })
        : new C.PolylineColorAppearance(),
      asynchronous: false,
    }));
  }

  async function loadStatic() {
    // landing sites and candidate human sites
    fetch("/api/sites").then((r) => r.json()).then(({ sites }) => {
      for (const s of sites) {
        const c = s.type === "lander" ? "#5ec4d6" : "#e8b04b";
        viewer.entities.add({
          position: C.Cartesian3.fromDegrees(s.lon, s.lat),
          point: { pixelSize: 9, color: color(c), outlineColor: C.Color.BLACK, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 3e5 },
          label: label(s.name, c, 0, { pixelOffset: new C.Cartesian2(10, 0), horizontalOrigin: C.HorizontalOrigin.LEFT, disableDepthTestDistance: 3e5,
            distanceDisplayCondition: new C.DistanceDisplayCondition(0, 9e6) }),
        });
      }
    }).catch(() => {});
    // the rovers' real traverses
    for (const m of ["m2020", "msl"]) {
      fetch(`/api/rover/track?mission=${m}`).then((r) => (r.ok ? r.json() : null)).then((t) => {
        if (!t) return;
        groundLine(t.points.flatMap(([la, lo]) => [lo, la]), "#5ec4d6", 3, { alpha: 0.95, far: 4e5 });
        viewer.entities.add({ position: C.Cartesian3.fromDegrees(t.latest.lon, t.latest.lat),
          label: label(`${t.rover} today (sol ${t.latest.sol})`, "#5ec4d6", -14, { font: "600 12px Inter, sans-serif", distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2e5) }) });
      }).catch(() => {});
    }
    // every IAU-named feature: big ones from far away, small craters only up close
    try { features = await (await fetch("/api/features")).json(); } catch { return; }
    featureLabels = viewer.scene.primitives.add(new C.LabelCollection());
    for (const [name, , , , d] of features) {
      featureLabels.add({ text: name, font: "500 12px Inter, sans-serif", fillColor: color("#f1e4d6", 0.92), outlineColor: color("#000", 0.85), outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: C.HorizontalOrigin.CENTER,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, Math.min(9e6, Math.max(6e4, d * 1000 * 10))),
        disableDepthTestDistance: 5e4 }); // nearby names always show; farther ones hide behind hills
    }
    placeFeatureLabels();
  }
  // labels float a little above the (exaggerated) ground, at the feature's MOLA height
  function placeFeatureLabels() {
    for (let i = 0; i < features.length; i++) {
      const [, , lat, lon, , h] = features[i];
      featureLabels.get(i).position = C.Cartesian3.fromDegrees(lon, lat, lift(h) + 1500);
    }
  }

  // the planned route, its stops, the walk-back ring and the point of no return; your position
  function refreshOverlays() {
    if (routeFor !== lastProfile) {
      routeEnts.splice(0).forEach((e) => viewer.entities.remove(e));
      routeLines.splice(0).forEach((l) => viewer.scene.groundPrimitives.remove(l));
      routeFor = lastProfile;
      if (lastProfile) {
        const p = lastProfile, outbound = waypoints.length - 1;
        const S = p.samples.filter((s) => s.leg < outbound);
        const cls = (s) => (s.slope_deg > 15 ? RED : s.slope_deg > 8 ? AMBER : ROUTE);
        const ll = (pts) => pts.flatMap((s) => [s.lon, s.lat]);
        routeLines.push(groundLine(ll(S), "#0b1a33", 11, { alpha: 0.9 }));  // dark outline, like the 2D map
        let run = [S[0]], c = cls(S[1] || S[0]);
        for (let i = 1; i < S.length; i++) {
          run.push(S[i]);
          const next = S[i + 1] && cls(S[i + 1]);
          if (next !== c || i === S.length - 1) {
            routeLines.push(groundLine(ll(run), c, 6));
            run = [S[i]]; c = next;
          }
        }
        const stops = [0, ...p.legs.map((l) => l.to_idx)].slice(0, waypoints.length);
        stops.forEach((si, j) => routeEnts.push(pin(p.samples[si].lat, p.samples[si].lon, letter(j), j === 0 ? "start" : j === stops.length - 1 ? "end" : "mid")));
        // Apollo-era 10 km walk-home ring (dashed) around the start
        const A = p.samples[0], ring = [];
        for (let k = 0; k <= 96; k++) {
          const b = (k / 96) * 2 * Math.PI, d = 10000 / R;
          const la = Math.asin(Math.sin(A.lat * D2R) * Math.cos(d) + Math.cos(A.lat * D2R) * Math.sin(d) * Math.cos(b));
          const lo = A.lon * D2R + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(A.lat * D2R), Math.cos(d) - Math.sin(A.lat * D2R) * Math.sin(la));
          ring.push(lo / D2R, la / D2R);
        }
        routeLines.push(groundLine(ring, "#ece6e1", 2, { alpha: 0.7, dash: true }));
        const tb = $("roundtrip").checked ? null : Science.turnBack(p, Suit.timeline(p));
        if (tb !== null && tb < p.samples.length - 1) {
          const s = p.samples[tb];
          routeEnts.push(viewer.entities.add({ position: C.Cartesian3.fromDegrees(s.lon, s.lat),
            point: { pixelSize: 16, color: color("#e8b04b"), outlineColor: C.Color.BLACK, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
            label: label("⟲ point of no return", "#e8b04b", -18, { font: "600 12px Inter, sans-serif" }) }));
        }
      }
    }
    const meKey = me ? me.join() : "";
    if (meFor !== meKey) {
      meEnts.splice(0).forEach((e) => viewer.entities.remove(e));
      meFor = meKey;
      if (me) meEnts.push(viewer.entities.add({ position: C.Cartesian3.fromDegrees(me[1], me[0]),
        point: { pixelSize: 14, color: color("#4f8cff"), outlineColor: C.Color.WHITE, outlineWidth: 3, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: label("You are here", "#ffffff", -18, { font: "600 12px Inter, sans-serif" }) }));
    }
  }

  // ---------- camera ----------
  // Where the ground is in the scene. While terrain streams in, the coarse tiles on screen can sit
  // hundreds of metres below the real surface; a camera placed on them ends up underground once the
  // detail arrives (and Cesium then draws nothing). So never go below a height we know (datum metres).
  function ground(lat, lon, known) {
    const h = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
    const k = known === undefined ? undefined : lift(known);
    if (h === undefined) return k ?? DATUM;
    return k === undefined ? h : Math.max(h, k);
  }
  // ground height (datum metres) from the server, never waiting on a download
  async function surface(lat, lon) {
    try { return (await (await fetch(`/api/elevation?lat=${lat}&lon=${lon}&quick=1`)).json()).elev_m; } catch { return 0; }
  }
  function centrePoint() {
    const cv = viewer.scene.canvas, xy = new C.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2);
    return viewer.scene.globe.pick(viewer.camera.getPickRay(xy), viewer.scene) || viewer.camera.pickEllipsoid(xy);
  }
  function centre() {
    const p = centrePoint();
    if (!p) return null;
    const c = C.Cartographic.fromCartesian(p);
    return { lat: c.latitude / D2R, lon: c.longitude / D2R };
  }
  function flyAround(target, heading, pitch, range, duration = 0.7) {
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target, 0), { offset: new C.HeadingPitchRange(heading, pitch, range), duration });
  }
  // a tilted view of a place from the south, like looking across a landscape. Far jumps happen
  // instantly behind the loading veil: a long flight streams every tile on the way and looks broken.
  async function goTo(lat, lon, alt) {
    setMode("free");
    toggleOrbit(false);
    const h = Math.max(alt || (inJezero(lat, lon) ? 6000 : 25000), MIN_M.mars);
    const target = C.Cartesian3.fromDegrees(lon, lat, ground(lat, lon, await surface(lat, lon)));
    const c = centre(), far = !c || Math.hypot(c.lat - lat, (c.lon - lon) * Math.cos(lat * D2R)) > 4;
    if (far) veil(`Loading the terrain around ${opened?.name || "this spot"}…`, true);
    flyAround(target, 0, -40 * D2R, h / Math.sin(40 * D2R), far ? 0 : 1.4);
  }
  function planet() {
    stopWalk(); setMode("free"); toggleOrbit(false);
    const c = centre() || { lat: 10, lon: 0 };
    viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(c.lon, Math.max(-60, Math.min(60, c.lat)), 2.6 * R), duration: 1.8 });
  }
  // the on-screen camera pad: everything turns around the point in the middle of the view
  function nav(what) {
    if (what === "orbit") return toggleOrbit(!orbiting);
    toggleOrbit(false);
    if (mode !== "free") setMode("free");
    const cam = viewer.camera, target = centrePoint();
    if (!target) {
      if (what === "in") cam.zoomIn(cam.positionCartographic.height * 0.5);
      if (what === "out") cam.zoomOut(cam.positionCartographic.height);
      return;
    }
    const range = C.Cartesian3.distance(cam.positionWC, target), h = cam.heading, p = cam.pitch;
    if (what === "in") flyAround(target, h, p, Math.max(minRange(), range * 0.45));
    else if (what === "out") flyAround(target, h, p, Math.min(2.4e7, range * 2.2));
    else if (what === "left") flyAround(target, h - 30 * D2R, p, range);
    else if (what === "right") flyAround(target, h + 30 * D2R, p, range);
    else if (what === "north") flyAround(target, 0, p, range);
    else if (what === "tilt") flyAround(target, h, p < -70 * D2R ? -35 * D2R : -89.9 * D2R, range);
  }
  // slow presentation orbit around the centre of the view; any drag or scroll stops it
  function toggleOrbit(on) {
    const b = root && root.querySelector("[data-nav=orbit]");
    if (b) b.setAttribute("aria-pressed", String(!!on));
    if (!on) { if (orbiting) { viewer.scene.preRender.removeEventListener(orbiting); orbiting = null; } return; }
    const target = centrePoint();
    if (!target) return;
    let heading = viewer.camera.heading;
    const pitch = Math.min(viewer.camera.pitch, -25 * D2R), range = C.Cartesian3.distance(viewer.camera.positionWC, target);
    orbiting = () => {
      heading += 0.0025;
      viewer.camera.lookAt(target, new C.HeadingPitchRange(heading, pitch, range));
      viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    };
    viewer.scene.preRender.addEventListener(orbiting);
  }
  function setMode(m) {
    mode = m;
    viewer.scene.screenSpaceCameraController.enableInputs = m === "free";
    root.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  }

  // ---------- fly along the planned walk ----------
  // A chase camera behind and above the walker — as low as the terrain data still looks real.
  function walkHud() {
    const st = walkState;
    root.querySelector(".gl-hud").innerHTML = `
      <div class="gv-row">
        <button type="button" data-w="play">${st.playing ? "❚❚" : "▶"}</button>
        <input type="range" class="gv-scrub" min="0" max="${Math.round(st.total)}" value="${Math.round(st.along)}" aria-label="Position along route">
        <select class="gv-speed" aria-label="Playback speed"><option value="15">Walk ×10</option><option value="40">×25</option><option value="120">×75</option></select>
      </div>
      <div class="gv-row">
        <button type="button" data-mode="chase">Follow the walk</button><button type="button" data-mode="free">Look around</button>
        <span class="gv-info"></span>
      </div>`;
    const hud = root.querySelector(".gl-hud");
    hud.querySelector("[data-w=play]").onclick = (e) => { st.playing = !st.playing; e.target.textContent = st.playing ? "❚❚" : "▶"; if (st.playing && mode === "free") setMode("chase"); };
    hud.querySelector(".gv-scrub").oninput = (e) => { st.along = +e.target.value; };
    hud.querySelector(".gv-speed").value = String(st.speed);
    hud.querySelector(".gv-speed").onchange = (e) => { st.speed = +e.target.value; };
    hud.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { setMode(b.dataset.mode); if (b.dataset.mode === "free") overview(); }));
    setMode(mode);
  }
  function overview() {
    viewer.camera.flyToBoundingSphere(C.BoundingSphere.fromPoints(walkState.S.map((s) => C.Cartesian3.fromDegrees(s.lon, s.lat, lift(s.elev_m)))),
      { offset: new C.HeadingPitchRange(0, -40 * D2R, 0), duration: 1.2 });
  }
  function pointAt(d) {
    const { S, cum } = walkState;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const u = Math.max(0, Math.min(1, (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)));
    const a = S[i - 1], b = S[i];
    return { lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u, elev: a.elev_m + (b.elev_m - a.elev_m) * u, i };
  }
  const bearing = (a, b) => {
    const y = Math.sin((b.lon - a.lon) * D2R) * Math.cos(b.lat * D2R);
    const x = Math.cos(a.lat * D2R) * Math.sin(b.lat * D2R) - Math.sin(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.cos((b.lon - a.lon) * D2R);
    return Math.atan2(y, x);
  };
  const offset = (p, brg, m) => ({ lat: p.lat + (m * Math.cos(brg)) / R / D2R, lon: p.lon + (m * Math.sin(brg)) / (R * Math.cos(p.lat * D2R)) / D2R });
  function walkFrame(now) {
    const st = walkState;
    if (!st) return;
    const dt = Math.min(0.1, (now - st.last) / 1000); st.last = now;
    if (st.playing && mode === "chase") {
      st.along = Math.min(st.total, st.along + st.speed * dt);
      if (st.along >= st.total) { st.playing = false; const b = root.querySelector("[data-w=play]"); if (b) b.textContent = "▶"; }
    }
    const p = pointAt(st.along), ahead = pointAt(Math.min(st.total, st.along + 300));
    const brg = st.along >= st.total - 1 ? st.lastBrg : bearing(p, ahead);
    st.lastBrg = brg;
    if (mode === "chase") {
      const back = offset(p, brg, -st.back);
      const gz = Math.max(ground(p.lat, p.lon, p.elev), ground(back.lat, back.lon, p.elev)); // clear any hill behind you too
      viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(back.lon, back.lat, gz + st.up),
        orientation: { heading: brg, pitch: -Math.atan2(st.up, st.back * 1.6), roll: 0 } });
    }
    const s0 = st.S[p.i], leg = lastProfile.legs[s0.leg];
    const info = root.querySelector(".gl-hud .gv-info"), sc = root.querySelector(".gl-hud .gv-scrub");
    if (sc && document.activeElement !== sc) sc.value = Math.round(st.along);
    if (info) info.textContent = `${fmtKm(st.along / 1000)} of ${fmtKm(st.total / 1000)} · ${Math.round(s0.elev_m)} m · slope ${s0.slope_deg.toFixed(0)}° · ${leg ? `${leg.instruction} ${compassWord(leg.compass)}` : ""}`;
    raf = requestAnimationFrame(walkFrame);
  }
  function stopWalk() {
    cancelAnimationFrame(raf); raf = 0;
    walkState = null;
    if (root) root.querySelector(".gl-hud").innerHTML = "";
  }

  // ---------- entry points ----------
  async function open({ lat, lon, name = "Mars in 3D", sub, alt, fromMap = false, zoom } = {}) {
    shell();
    stopWalk();
    root.hidden = false;
    document.body.classList.add("globe-open");
    root.querySelector(".gv-title").textContent = name;
    root.querySelector(".gv-sub").textContent = sub ?? (lat !== undefined ? fmtLatLon(lat, lon) : "The whole planet");
    root.querySelector("[data-act=here]").hidden = fromMap || lat === undefined;
    opened = { lat, lon, name, alt, fromMap };
    if (!viewer) veil(window.Cesium ? "Starting 3D…" : "Loading the 3D engine (about 1.5 MB, first time only — your browser keeps it)…");
    try { await ensureViewer(); } catch (e) { veil(""); status(`✗ 3D view failed to start: ${e.message}`); return false; }
    if (root.hidden) return false;
    veil("");
    viewer.useDefaultRenderLoop = true;
    setExag(exag);
    refreshOverlays();
    if (herePin) { viewer.entities.remove(herePin); herePin = null; }
    if (lat !== undefined && !fromMap) herePin = pin(lat, lon, "", "here", name);
    setMode("free");
    if (fromMap && lat !== undefined) {
      viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, DATUM + Math.max(MIN_M.mars, heightForZoom(zoom))) });
    } else if (lat !== undefined) await goTo(lat, lon, alt);
    onCamera();
    return true;
  }
  // Leaflet zoom ↔ camera height (Leaflet's EPSG4326 world is 512 px wide at zoom 0)
  const viewH = () => (viewer ? viewer.scene.canvas.clientHeight : innerHeight);
  const heightForZoom = (z) => viewH() * ((360 / (512 * 2 ** z)) * D2R * R) * 0.866;
  const zoomForHeight = (h) => Math.max(1, Math.min(18, Math.round(Math.log2((viewH() * 360 * D2R * R * 0.866) / (512 * h)))));
  // the 2D map's view, in 3D
  function fromMap() {
    const c = map.getCenter();
    return open({ lat: c.lat, lon: c.lng, zoom: map.getZoom(), fromMap: true, name: "Mars in 3D", sub: "The map's view, in 3D" });
  }
  async function walk() {
    if (!lastProfile) return;
    const n = waypoints.length;
    if (!(await open({ name: `Walk: ${stopName(0)} → ${stopName(n - 1)}`, sub: "A chase camera follows the planned route — press ▶" }))) return;
    const S = lastProfile.samples.filter((s) => s.leg < n - 1);
    const cum = [0];
    for (let i = 1; i < S.length; i++) cum.push(cum[i - 1] + (S[i].dist_m - S[i - 1].dist_m));
    const sharp = inJezero(S[0].lat, S[0].lon);       // 20 m terrain: fly low; elsewhere stay above ~1 km
    walkState = { S, cum, total: cum[cum.length - 1], along: 0, playing: false, speed: 40, last: performance.now(), lastBrg: 0,
      back: sharp ? 450 : 1800, up: sharp ? 260 : 1100 };
    mode = "free";
    walkHud();
    veil("Loading the terrain along your route…", true);
    overview();
    raf = requestAnimationFrame(walkFrame);
  }
  function close() {
    if (!root || root.hidden) return;
    stopWalk();
    toggleOrbit(false);
    veil("");
    if (viewer) {
      if (opened && opened.fromMap) {
        const c = centre();
        if (c) map.setView([c.lat, c.lon], zoomForHeight(viewer.camera.positionCartographic.height - DATUM), { animate: false });
      }
      viewer.useDefaultRenderLoop = false;
    }
    root.hidden = true;
    document.body.classList.remove("globe-open");
    map.invalidateSize();
  }

  return { open, fromMap, walk, close, get active() { return !!root && !root.hidden; }, get viewer() { return viewer; } };
})();
