// Mars in 3D — the whole planet as a streaming globe, like Google Earth (CesiumJS).
//  • Terrain: the local MOLA grid for the planet view (instant), the HRSC/MOLA 200 m blend as you
//    zoom in, and the 20 m CTX DTM in Jezero — /api/terrain/tile serves 65×65 heightmaps.
//  • Imagery: the Viking colour mosaic, sharpened close up by the global 5 m CTX mosaic (Caltech
//    Murray Lab, served by Esri) and HiRISE 25 cm in Jezero — all NASA data.
//  • On top: your route (coloured by slope) and stops, landing sites, IAU place names, the
//    Perseverance and Curiosity traverses, your position — and a fly-along of the planned walk.
// The engine (~1.7 MB) downloads once, in the background, and stays alive between opens.
const Globe = (() => {
  const BASE = "https://cdn.jsdelivr.net/npm/cesium@1.144.0/Build/Cesium/";
  const R = 3396190;                 // Mars 2000 sphere — the datum of the DEMs and the imagery
  // Cesium can't draw terrain while the camera is inside its ellipsoid, and Mars' lowlands lie up to
  // 8.2 km below the datum (Hellas). So the engine's sphere sits 10 km under the datum and every
  // height is raised by that much: lift(h) is where a height above the datum goes in the scene.
  const DATUM = 10000;
  const lift = (h) => DATUM + h * exag;
  const EYE = 1.7;
  const CTX_URL = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}";
  let C = null, viewer = null, root = null, enginePromise = null, providers = null;
  let opened = null, exag = 1, mode = "free", yaw = 0, pitch = 0, standAt = null, walkState = null, raf = 0;
  let features = null, featureLabels = null, routeFor = null, meFor = null, herePin = null;
  const routeEnts = [], routeLines = [], meEnts = [];

  // ---------- engine ----------
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
      s.onerror = () => { enginePromise = null; s.remove(); fail(new Error("Couldn't download the 3D engine")); };
      document.head.appendChild(s);
    });
    return enginePromise;
  }
  // fetch the engine into the browser cache while the 2D map is in use, so 3D opens quickly
  window.addEventListener("load", () => setTimeout(() => {
    const l = document.createElement("link");
    l.rel = "prefetch"; l.href = `${BASE}Cesium.js`;
    document.head.appendChild(l);
  }, 5000));

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
          <button type="button" data-act="eye" title="Stand on the surface and look around">👁 Eye level</button>
          <select class="gl-imagery" aria-label="Imagery">
            <option value="colour">Colour + CTX 5 m detail</option>
            <option value="ctx">CTX 5 m (sharpest, greyscale)</option>
            <option value="viking">Viking colour</option>
            <option value="mola">MOLA elevation colours</option>
            <option value="themis">THEMIS day infrared</option>
          </select>
          <span class="gl-exag" role="group" aria-label="Relief exaggeration"><button type="button" data-exag="1">Relief ×1</button><button type="button" data-exag="2">×2</button><button type="button" data-exag="3">×3</button></span>
          <button type="button" class="gl-close" data-act="close">🗺 Back to map</button>
        </div>
      </header>
      <div class="gl-body">
        <div class="gl-view"></div>
        <div class="gl-status" hidden><span class="gv-spin"></span><span class="gl-status-text"></span></div>
        <div class="gv-hud gl-hud"></div>
        <div class="gl-readout"></div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector("[data-act=close]").onclick = close;
    root.querySelector("[data-act=planet]").onclick = planet;
    root.querySelector("[data-act=here]").onclick = () => opened && opened.lat !== undefined && goTo(opened.lat, opened.lon, opened.alt);
    root.querySelector("[data-act=eye]").onclick = eyeLevel;
    root.querySelector(".gl-imagery").onchange = (e) => setImagery(e.target.value);
    root.querySelectorAll("[data-exag]").forEach((b) => (b.onclick = () => setExag(+b.dataset.exag)));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root && !root.hidden && !document.querySelector("#gv")) close(); });
  }
  function status(text) {
    const el = root.querySelector(".gl-status");
    el.hidden = !text;
    el.querySelector(".gl-status-text").textContent = text || "";
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
      infoBox: false, selectionIndicator: false, requestRenderMode: true, maximumRenderTimeChange: Infinity,
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
    globe.baseColor = C.Color.fromCssColorString("#6e4630");
    globe.showGroundAtmosphere = false;
    globe.tileCacheSize = 600;
    globe.depthTestAgainstTerrain = true;
    // a thin butterscotch sky instead of Earth's blue (Cesium only adds an atmosphere for Earth)
    scene.skyAtmosphere = new C.SkyAtmosphere(ell);
    scene.skyAtmosphere.hueShift = -0.5;
    scene.skyAtmosphere.saturationShift = -0.25;
    scene.skyAtmosphere.brightnessShift = -0.35;
    viewer.cesiumWidget.creditContainer.classList.add("gl-credits");
    viewer.creditDisplay.addStaticCredit(new C.Credit("Terrain: MGS MOLA, HRSC/MOLA blend (USGS), CTX DTM · Imagery: NASA/JPL-Caltech, Mars Trek, CTX mosaic (Caltech Murray Lab, Esri)"));
    imageryProviders(tiling);
    setImagery("colour");
    globe.tileLoadProgressEvent.addEventListener((n) => status(n ? `Streaming NASA terrain and imagery… ${n} tile${n === 1 ? "" : "s"} to go` : ""));
    viewer.camera.percentageChanged = 0.02;
    viewer.camera.changed.addEventListener(readout);
    bindLook();
    loadStatic();
  }

  function imageryProviders(tiling) {
    const trek = (layer, ext, maximumLevel, extra = {}) => new C.UrlTemplateImageryProvider({
      url: `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`,
      tilingScheme: tiling, maximumLevel, ...extra });
    const box = (b) => C.Rectangle.fromDegrees(b[0][1], b[0][0], b[1][1], b[1][0]);
    providers = {
      viking: trek("Mars_Viking_MDIM21_ClrMosaic_global_232m", "jpg", 7),
      themis: trek("THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", "png", 9),
      mola: trek("Mars_MGS_MOLA_ClrShade_merge_global_463m", "jpg", 6),
      ctx: new C.UrlTemplateImageryProvider({ url: CTX_URL, tilingScheme: tiling, tileWidth: 512, tileHeight: 512, maximumLevel: 12 }),
      jezCtx: trek("JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0", "png", 13, { rectangle: box(JEZ_CTX) }),
      jezHirise: trek("JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd", "png", 17, { rectangle: box(JEZ_HIRISE) }),
    };
  }
  function setImagery(m) {
    const layers = viewer.imageryLayers;
    layers.removeAll(true);
    const add = (p, o = {}) => layers.add(new C.ImageryLayer(p, o));
    if (m === "viking") add(providers.viking);
    else if (m === "mola") add(providers.mola);
    else if (m === "themis") add(providers.themis);
    else {
      add(providers.viking);
      // colour mode keeps some Viking colour under the sharp greyscale CTX
      add(providers.ctx, m === "ctx" ? { minimumTerrainLevel: 4 } : { alpha: 0.72, minimumTerrainLevel: 6 });
      add(providers.jezCtx, { minimumTerrainLevel: 9 });
      add(providers.jezHirise, { minimumTerrainLevel: 11 });
    }
    root.querySelector(".gl-imagery").value = m;
    viewer.scene.requestRender();
  }
  function setExag(k) {
    exag = k;
    viewer.scene.verticalExaggeration = k;
    viewer.scene.verticalExaggerationRelativeHeight = DATUM; // stretch heights about the datum
    root.querySelectorAll("[data-exag]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.exag === k)));
    if (featureLabels) placeFeatureLabels();
    viewer.scene.requestRender();
  }

  // ---------- what's on the globe ----------
  const color = (css, a = 1) => C.Color.fromCssColorString(css).withAlpha(a);
  const pinImage = (label, kind) => {
    const fill = kind === "start" ? "#34a853" : kind === "end" ? "#ea4335" : kind === "here" ? "#ea4335" : "#ffffff";
    const ink = kind === "mid" ? "#111" : "#fff";
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="38" viewBox="0 0 28 38"><path d="M14 37S2 22.5 2 14a12 12 0 0 1 24 0c0 8.5-12 23-12 23z" fill="${fill}" stroke="#111" stroke-width="1.5"/><text x="14" y="18.5" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="12" font-weight="700" fill="${ink}">${label}</text></svg>`)}`;
  };
  const pin = (lat, lon, label, kind, name) => viewer.entities.add({
    position: C.Cartesian3.fromDegrees(lon, lat),
    billboard: { image: pinImage(label, kind), verticalOrigin: C.VerticalOrigin.BOTTOM, heightReference: C.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: name ? { text: name, font: "600 13px Inter, sans-serif", fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3,
      style: C.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: C.VerticalOrigin.BOTTOM, pixelOffset: new C.Cartesian2(0, -40),
      heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
  });

  async function loadStatic() {
    // landing sites and candidate human sites
    fetch("/api/sites").then((r) => r.json()).then(({ sites }) => {
      for (const s of sites) {
        const c = s.type === "lander" ? "#5ec4d6" : "#e8b04b";
        viewer.entities.add({
          position: C.Cartesian3.fromDegrees(s.lon, s.lat),
          point: { pixelSize: 9, color: color(c), outlineColor: C.Color.BLACK, outlineWidth: 2, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 3e5 },
          label: { text: s.name, font: "600 13px Inter, sans-serif", fillColor: color(c), outlineColor: C.Color.BLACK, outlineWidth: 3,
            style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(10, 0), horizontalOrigin: C.HorizontalOrigin.LEFT,
            heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: 3e5, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 9e6) },
        });
      }
      viewer.scene.requestRender();
    }).catch(() => {});
    // the rovers' real traverses
    for (const m of ["m2020", "msl"]) {
      fetch(`/api/rover/track?mission=${m}`).then((r) => (r.ok ? r.json() : null)).then((t) => {
        if (!t) return;
        groundLine(t.points.flatMap(([la, lo]) => [lo, la]), "#5ec4d6", 3, { alpha: 0.95, far: 4e5 });
        viewer.entities.add({ position: C.Cartesian3.fromDegrees(t.latest.lon, t.latest.lat),
          label: { text: `${t.rover} today (sol ${t.latest.sol})`, font: "600 12px Inter, sans-serif", fillColor: color("#5ec4d6"), outlineColor: C.Color.BLACK, outlineWidth: 3,
            style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -14), heightReference: C.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2e5) } });
        viewer.scene.requestRender();
      }).catch(() => {});
    }
    // every IAU-named feature: big ones from far away, small craters only up close
    try { features = await (await fetch("/api/features")).json(); } catch { return; }
    featureLabels = viewer.scene.primitives.add(new C.LabelCollection());
    for (const [name, , lat, lon, d] of features) {
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
    viewer.scene.requestRender();
  }

  // A line draped on the terrain. Built on the main thread (asynchronous: false) because the worker
  // that would otherwise build it has its own copy of Earth's height table (see ensureViewer).
  function groundLine(lonLats, css, width, { alpha = 1, dash = false, far } = {}) {
    const attributes = { color: C.ColorGeometryInstanceAttribute.fromColor(color(css, alpha)) };
    if (far) attributes.distanceDisplayCondition = new C.DistanceDisplayConditionGeometryInstanceAttribute(0, far);
    const prim = viewer.scene.groundPrimitives.add(new C.GroundPolylinePrimitive({
      geometryInstances: new C.GeometryInstance({ geometry: new C.GroundPolylineGeometry({ positions: C.Cartesian3.fromDegreesArray(lonLats), width }), attributes }),
      appearance: dash ? new C.PolylineMaterialAppearance({ material: C.Material.fromType("PolylineDash", { color: color(css, alpha), dashLength: 18 }) })
        : new C.PolylineColorAppearance(),
      asynchronous: false,
    }));
    viewer.scene.requestRender();
    return prim;
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
            label: { text: "⟲ point of no return", font: "600 12px Inter, sans-serif", fillColor: color("#e8b04b"), outlineColor: C.Color.BLACK, outlineWidth: 3,
              style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -18), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
        }
      }
    }
    const meKey = me ? me.join() : "";
    if (meFor !== meKey) {
      meEnts.splice(0).forEach((e) => viewer.entities.remove(e));
      meFor = meKey;
      if (me) meEnts.push(viewer.entities.add({ position: C.Cartesian3.fromDegrees(me[1], me[0]),
        point: { pixelSize: 14, color: color("#4f8cff"), outlineColor: C.Color.WHITE, outlineWidth: 3, heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: "You are here", font: "600 12px Inter, sans-serif", fillColor: C.Color.WHITE, outlineColor: C.Color.BLACK, outlineWidth: 3,
          style: C.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new C.Cartesian2(0, -18), heightReference: C.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } }));
    }
    viewer.scene.requestRender();
  }

  // ---------- camera ----------
  const D2R = Math.PI / 180;
  // a tilted view of a point from the south, like looking across a landscape
  async function goTo(lat, lon, alt) {
    setMode("free");
    const inJezero = lat >= JEZ_CTX[0][0] && lat <= JEZ_CTX[1][0] && lon >= JEZ_CTX[0][1] && lon <= JEZ_CTX[1][1];
    const h = alt || (inJezero ? 5000 : 18000);
    const back = h / Math.tan(35 * D2R);
    const g = ground(lat, lon, await surface(lat, lon));
    viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat - (back / R) / D2R, h + g),
      orientation: { heading: 0, pitch: -35 * D2R, roll: 0 }, duration: 2.2 });
  }
  // ground height (datum metres) from the server; quick=true never waits on a download (MOLA if the
  // 200 m tile isn't cached yet)
  async function surface(lat, lon, quick = true) {
    try { return (await (await fetch(`/api/elevation?lat=${lat}&lon=${lon}${quick ? "&quick=1" : ""}`)).json()).elev_m; } catch { return 0; }
  }
  function planet() {
    stopWalk(); setMode("free");
    const c = centre() || { lat: 10, lon: 0 };
    viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(c.lon, Math.max(-60, Math.min(60, c.lat)), 2.6 * R), duration: 2.4 });
  }
  // Where the ground is in the scene. While terrain streams in, the coarse tiles on screen can sit
  // hundreds of metres below the real surface; a camera placed on them ends up underground once the
  // detail arrives (and Cesium then draws nothing). So never go below a height we know (datum metres).
  function ground(lat, lon, known) {
    const h = viewer.scene.globe.getHeight(C.Cartographic.fromDegrees(lon, lat));
    const k = known === undefined ? undefined : lift(known);
    if (h === undefined) return k ?? DATUM;
    return k === undefined ? h : Math.max(h, k);
  }
  function centre() {
    const cv = viewer.scene.canvas;
    const hit = viewer.camera.pickEllipsoid(new C.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2));
    if (!hit) return null;
    const c = C.Cartographic.fromCartesian(hit);
    return { lat: c.latitude / D2R, lon: c.longitude / D2R };
  }
  // Leaflet zoom ↔ camera height (Leaflet's EPSG4326 world is 512 px wide at zoom 0)
  const viewH = () => (viewer ? viewer.scene.canvas.clientHeight : innerHeight);
  const heightForZoom = (z) => viewH() * ((360 / (512 * 2 ** z)) * D2R * R) * 0.866;
  const zoomForHeight = (h) => Math.max(1, Math.min(18, Math.round(Math.log2((viewH() * 360 * D2R * R * 0.866) / (512 * h)))));
  function readout() {
    const c = viewer.camera.positionCartographic, el = root.querySelector(".gl-readout");
    const h = c.height - DATUM;
    el.textContent = `${fmtLatLon(c.latitude / D2R, c.longitude / D2R)} · ${h > 20000 ? `${(h / 1000).toFixed(0)} km` : `${Math.round(h)} m`} above the datum`;
  }

  // first-person modes: the camera is ours, and dragging turns your head
  function setMode(m) {
    mode = m;
    const ctl = viewer.scene.screenSpaceCameraController;
    ctl.enableInputs = m === "free";
    root.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    root.querySelector("[data-act=eye]").setAttribute("aria-pressed", String(m === "look"));
  }
  function bindLook() {
    const cv = viewer.scene.canvas;
    let drag = null;
    cv.addEventListener("pointerdown", (e) => { if (mode !== "free") { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; cv.setPointerCapture(e.pointerId); } });
    cv.addEventListener("pointermove", (e) => {
      if (!drag) return;
      yaw = drag.yaw + (e.clientX - drag.x) * 0.25;
      pitch = Math.max(-80, Math.min(60, drag.pitch - (e.clientY - drag.y) * 0.2));
      if (mode === "look") placeEye();
    });
    cv.addEventListener("pointerup", () => { drag = null; });
  }
  async function eyeLevel() {
    if (mode === "look") return setMode("free");
    stopWalk();
    const c = (opened && opened.lat !== undefined && !opened.fromMap) ? opened : centre();
    if (!c) return;
    standAt = { lat: c.lat, lon: c.lon, elev: await surface(c.lat, c.lon, false) }; // the real 200 m height to stand on
    yaw = 0; pitch = -2;
    setMode("look");
    // let the terrain under you load, then stand on it
    viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(c.lon, c.lat, ground(c.lat, c.lon, standAt.elev) + 400), orientation: { heading: 0, pitch: -20 * D2R, roll: 0 },
      duration: 1.6, complete: () => { placeEye(); setTimeout(placeEye, 1200); setTimeout(placeEye, 3000); } });
  }
  function placeEye() {
    if (mode !== "look" || !standAt) return;
    viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(standAt.lon, standAt.lat, ground(standAt.lat, standAt.lon, standAt.elev) + EYE * 2),
      orientation: { heading: yaw * D2R, pitch: pitch * D2R, roll: 0 } });
    root.querySelector(".gl-hud").innerHTML = mode === "look" ? `<div class="gv-row"><span class="gv-info">Standing at ${fmtLatLon(standAt.lat, standAt.lon)} · drag to look around · 👁 again to fly free</span></div>` : "";
    viewer.scene.requestRender();
  }

  // ---------- fly along the planned walk ----------
  function walkHud() {
    const st = walkState;
    root.querySelector(".gl-hud").innerHTML = `
      <div class="gv-row">
        <button type="button" data-w="play">${st.playing ? "❚❚" : "▶"}</button>
        <input type="range" class="gv-scrub" min="0" max="${Math.round(st.total)}" value="${Math.round(st.along)}" aria-label="Position along route">
        <select class="gv-speed" aria-label="Playback speed"><option value="15">Walk ×10</option><option value="40" selected>×25</option><option value="120">×75</option></select>
      </div>
      <div class="gv-row">
        <button type="button" data-mode="eye">Eye level</button><button type="button" data-mode="drone">Drone</button><button type="button" data-mode="free">Free look</button>
        <span class="gv-info"></span>
      </div>`;
    const hud = root.querySelector(".gl-hud");
    hud.querySelector("[data-w=play]").onclick = (e) => { st.playing = !st.playing; e.target.textContent = st.playing ? "❚❚" : "▶"; };
    hud.querySelector(".gv-scrub").oninput = (e) => { st.along = +e.target.value; };
    hud.querySelector(".gv-speed").value = String(st.speed);
    hud.querySelector(".gv-speed").onchange = (e) => { st.speed = +e.target.value; };
    hud.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { setMode(b.dataset.mode); if (b.dataset.mode === "free") overview(); }));
    setMode(mode);
  }
  function overview() {
    const S = walkState.S;
    viewer.camera.flyToBoundingSphere(C.BoundingSphere.fromPoints(S.map((s) => C.Cartesian3.fromDegrees(s.lon, s.lat, lift(s.elev_m)))),
      { offset: new C.HeadingPitchRange(0, -40 * D2R, 0), duration: 1.5 });
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
    if (st.playing && mode !== "free") {
      st.along = Math.min(st.total, st.along + st.speed * dt);
      if (st.along >= st.total) { st.playing = false; const b = root.querySelector("[data-w=play]"); if (b) b.textContent = "▶"; }
    }
    const p = pointAt(st.along), ahead = pointAt(Math.min(st.total, st.along + (mode === "eye" ? 40 : 300)));
    const brg = st.along >= st.total - 1 ? st.lastBrg : bearing(p, ahead);
    st.lastBrg = brg;
    if (mode === "eye") {
      viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(p.lon, p.lat, ground(p.lat, p.lon, p.elev) + EYE * 2),
        orientation: { heading: brg + yaw * D2R, pitch: (pitch - 4) * D2R, roll: 0 } });
    } else if (mode === "drone") {
      const back = offset(p, brg, -420);  // behind and above you, like a chase drone
      const gz = Math.max(ground(p.lat, p.lon, p.elev), ground(back.lat, back.lon, p.elev)); // clear any hill behind you too
      viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(back.lon, back.lat, gz + 260),
        orientation: { heading: brg + yaw * D2R, pitch: (pitch - 30) * D2R, roll: 0 } });
    }
    const s0 = st.S[p.i], leg = lastProfile.legs[s0.leg];
    const info = root.querySelector(".gl-hud .gv-info"), sc = root.querySelector(".gl-hud .gv-scrub");
    if (sc && document.activeElement !== sc) sc.value = Math.round(st.along);
    if (info) info.textContent = `${fmtKm(st.along / 1000)} of ${fmtKm(st.total / 1000)} · ${Math.round(s0.elev_m)} m · slope ${s0.slope_deg.toFixed(0)}° · ${leg ? `${leg.instruction} ${compassWord(leg.compass)}` : ""}`;
    viewer.scene.requestRender();
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
    status(window.Cesium ? "" : "Loading the 3D engine…");
    try { await ensureViewer(); } catch (e) { status(`✗ 3D view failed to start: ${e.message}`); return false; }
    if (root.hidden) return false;
    status("");
    viewer.useDefaultRenderLoop = true;
    setExag(exag);
    refreshOverlays();
    if (herePin) { viewer.entities.remove(herePin); herePin = null; }
    if (lat !== undefined && !fromMap) herePin = pin(lat, lon, "", "here", name);
    setMode("free");
    if (fromMap && lat !== undefined) {
      viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, DATUM + heightForZoom(zoom)), duration: 0 });
    } else if (lat !== undefined) goTo(lat, lon, alt);
    readout();
    return true;
  }
  // the 2D map's view, in 3D
  function fromMap() {
    const c = map.getCenter();
    return open({ lat: c.lat, lon: c.lng, zoom: map.getZoom(), fromMap: true, name: "Mars in 3D", sub: "Drag to orbit · scroll to zoom · right-drag or Ctrl-drag to tilt" });
  }
  async function walk() {
    if (!lastProfile) return;
    const n = waypoints.length;
    if (!(await open({ name: `Walk: ${stopName(0)} → ${stopName(n - 1)}`, sub: "Fly along the planned route — eye level, drone or free look" }))) return;
    const S = lastProfile.samples.filter((s) => s.leg < n - 1);
    const cum = [0];
    for (let i = 1; i < S.length; i++) cum.push(cum[i - 1] + (S[i].dist_m - S[i - 1].dist_m));
    walkState = { S, cum, total: cum[cum.length - 1], along: 0, playing: false, speed: 40, last: performance.now(), lastBrg: 0 };
    yaw = 0; pitch = 0;
    mode = "drone";
    walkHud();
    // look over the route first while its terrain loads, then start the drone
    overview();
    setTimeout(() => { if (walkState) { setMode("drone"); walkState.playing = true; walkHud(); walkState.last = performance.now(); raf = requestAnimationFrame(walkFrame); } }, 2600);
  }
  function close() {
    if (!root || root.hidden) return;
    stopWalk();
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
