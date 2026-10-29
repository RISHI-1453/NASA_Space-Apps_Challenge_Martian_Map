// Science EVAs: ready-made Marswalks with a science goal, at places NASA's rovers and orbiters have
// studied closely. Each station has a task, the kit for it and the time it takes; the stations are
// real rover positions (NASA MMGIS traverse data) or mapped orbital detections. "Plan this EVA"
// loads one into the planner, where every check (suits, slopes, sun, radiation, space weather)
// runs on it like on any other route.
const Missions = (() => {
  const LIST = [
    {
      id: "boxwork", title: "The boxwork of Mount Sharp", site: "Gale crater · Curiosity, 2025", region: "Gale",
      goal: "How long did groundwater flow through Mount Sharp as Mars dried out?",
      why: "From orbit, part of Mount Sharp is covered in a net of low ridges — boxwork. Groundwater left minerals in cracks in the rock; wind later stripped the softer rock around them, leaving the hardened cracks standing. Curiosity drove into it in 2025. A crew can walk ridge to hollow, see which ridges cut which, and pick the best rock to bring home — in hours, not months.",
      human: "Reading the 3D pattern of ridges on the spot and choosing samples by eye is exactly what rovers are slow at.",
      cites: ["msl2025", "tanaka2014"], layers: ["geology"], depart: "09:00", load: 18, round: false, rover: "pressurized",
      note: "One way: the pressurised rover drops the crew at A and picks them up at E.",
      stops: [
        { lat: -4.79689, lon: 137.38772, name: "Boxwork margin (Curiosity, sol 4526)", min: 15, task: "Panorama of the ridge network ahead from the high ground; set up the radio relay.", kit: "camera, radio relay" },
        { lat: -4.80191, lon: 137.38211, name: "Boxwork ridge (sol 4575)", min: 35, task: "Follow one ridge along its length. Sample the hard ridge-crest cement and the softer bedrock beside it.", kit: "rock hammer, chisel, sample bags, hand lens" },
        { lat: -4.80689, lon: 137.37984, name: "Hollow between ridges (sol 4650)", min: 30, task: "Trench the hollow floor to find the fracture fill that became the ridges; scoop the sediment.", kit: "scoop, trenching tool, core tubes" },
        { lat: -4.81202, lon: 137.38204, name: "Where ridges cross (sol 4851)", min: 25, task: "Which ridge cuts which? Measure ridge heights and directions to date the fracture sets.", kit: "compass, measuring tape, camera" },
        { lat: -4.82143, lon: 137.38582, name: "Southern boxwork (sol 4977)", min: 35, task: "Drill a core from a ridge for return to Earth; log it against Curiosity's analyses nearby.", kit: "hand drill, sterile core tubes" },
      ],
    },
    {
      id: "cheyava", title: "Leopard spots at Cheyava Falls", site: "Jezero crater · Perseverance, 2024", region: "Jezero",
      goal: "Did microbes once live in Jezero's river mud?",
      why: "In July 2024 Perseverance found a rock in Neretva Vallis, the river channel into Jezero, with millimetre 'leopard spots': pale rings with dark rims rich in iron phosphate and sulfide. On Earth, reactions like these are often driven by microbes. It's the strongest candidate biosignature yet — a person can survey the whole outcrop and choose the best spots to sample.",
      human: "Finding more of a millimetre-scale texture across a whole outcrop takes eyes, a hand lens and judgement.",
      cites: ["hurowitz2025"], layers: ["minerals"], depart: "09:30", load: 15, round: true, rover: "none",
      stops: [
        { lat: 18.4919, lon: 77.30104, name: "Neretva Vallis (Perseverance, sol 1230)", min: 10, task: "Suit check; photograph the channel floor and the light-toned outcrop upstream.", kit: "camera" },
        { lat: 18.493, lon: 77.30324, name: "Bright Angel outcrop (sol 1224)", min: 30, task: "Map where the pale Bright Angel rock meets the darker rock; sample both sides of the contact.", kit: "rock hammer, sample bags, hand lens" },
        { lat: 18.49744, lon: 77.30513, name: "Cheyava Falls (sol 1206)", min: 60, task: "Find more leopard spots; image them at millimetre scale; take a clean core. Organics-clean tools only — keep Earth microbes out of the sample.", kit: "macro camera, hand lens, sterile corer and tubes" },
      ],
    },
    {
      id: "depot", title: "Collect the Three Forks samples", site: "Jezero crater · Perseverance, 2022–23", region: "Jezero",
      goal: "Bring home the first rocks ever cached on another planet.",
      why: "Between December 2022 and January 2023 Perseverance left ten sealed sample tubes on the crater floor at Three Forks, as a backup cache for Mars Sample Return. A crew could walk over from the landing site, find each tube, check its seal and carry the set home.",
      human: "Handling ten tubes, checking seals and packing them takes minutes for a person and a whole campaign for robots.",
      cites: ["depot2023"], layers: [], depart: "09:00", load: 12, round: true, rover: "none",
      stops: [
        { lat: 18.4447, lon: 77.4508, name: "Octavia E. Butler Landing", min: 10, task: "Suit check; plot the tube positions from Perseverance's records.", kit: "tube map" },
        { lat: 18.45311, lon: 77.40859, name: "Three Forks depot, east end (sol 684)", min: 40, task: "Photograph each tube where it lies before touching it, check the seal, bag it in a sealed carrier.", kit: "sample carrier, gloves, camera" },
        { lat: 18.45007, lon: 77.40176, name: "Three Forks depot, west end (sol 641)", min: 40, task: "Collect the remaining tubes; count all ten before heading back.", kit: "sample carrier" },
      ],
    },
    {
      id: "ice", title: "Prospect for ice at a fresh crater", site: "Arcadia Planitia · MRO HiRISE", region: "Arcadia",
      goal: "How much clean water ice lies under the northern plains — enough for a base?",
      why: "HiRISE watched new craters punch through the soil here and expose bright, clean water ice that faded over months as it turned to vapour. Radar from orbit suggests thick sheets of ice under Arcadia. A crew that can drill ice has water to drink, oxygen to breathe and fuel to fly home.",
      human: "Finding the bright patch, drilling it and running a radar line takes a crew a morning.",
      cites: ["dundas2014", "bramson2015", "dundas2018"], layers: ["active", "inertia"], depart: "10:00", load: 22, round: true, rover: "lrv", drive: [0],
      note: "The crater's position is known to about ±0.5 km (HiRISE survey), so the first task is finding it. The crew drives the open rover out and back with the radar sled; the stations are on foot.",
      stops: [
        { lat: 46.15, lon: -171.47, name: "Habitat (example site)", min: 15, task: "Suit check; load the ground-penetrating radar sled on the rover.", kit: "GPR sled" },
        { lat: 46.17, lon: -171.51, name: "Icy impact crater (Dundas et al. 2014)", min: 50, task: "Find the bright ice in the crater floor; drill a core and measure how pure it is.", kit: "ice drill, insulated sample cans" },
        { lat: 46.185, lon: -171.535, name: "End of the radar line", min: 30, task: "Tow the radar away from the crater to map the buried ice sheet's depth and thickness.", kit: "GPR sled" },
      ],
    },
    {
      id: "columbia", title: "Hot springs of the Columbia Hills", site: "Gusev crater · Spirit, 2004–2010", region: "Gusev",
      goal: "Were there hot springs on Mars where life could have started?",
      why: "Spirit found rock rich in carbonate at Comanche (water that wasn't acidic) and soil that was almost pure opaline silica beside Home Plate — on Earth, silica like that forms at hot springs and keeps microbial fossils. Spirit then got stuck for good in soft sulfate sand at Troy.",
      human: "A crew can tell firm ground from the soft sand that trapped Spirit, and sample the silica nodules by hand.",
      cites: ["morris2010", "squyres2008"], layers: ["nightIR"], depart: "09:00", load: 15, round: true, rover: "none",
      note: "Terrain here is the 200 m global model only: hills show up, the small scarps of Home Plate don't.",
      stops: [
        { lat: -14.594, lon: 175.52875, name: "Comanche outcrop", min: 30, task: "Sample the carbonate-rich outcrop — too dusty for orbiters to see it, Spirit found it up close.", kit: "rock hammer, sample bags" },
        { lat: -14.60612, lon: 175.5313, name: "Home Plate", min: 30, task: "Log the layered volcanic ash: where hot rock met water.", kit: "camera, hand lens" },
        { lat: -14.60651, lon: 175.53224, name: "Silica Valley", min: 40, task: "Collect the nodular opaline silica; look for fine layering like hot-spring sinter on Earth.", kit: "scoop, sample bags, hand lens" },
        { lat: -14.60599, lon: 175.53074, name: "Troy (where Spirit got stuck)", min: 20, task: "Probe how soft the sulfate sand is, and mark a firm path around it.", kit: "penetrometer, flags" },
      ],
    },
  ];

  const near = (a, b) => Math.abs(a[0] - b[0]) < 2e-4 && Math.abs(a[1] - b[1]) < 2e-4;
  // the task planned at a route stop, if it's one of a mission's stations
  function taskAt(lat, lon) {
    for (const m of LIST) for (const s of m.stops) if (near([lat, lon], [s.lat, s.lon])) return { title: s.name.split(" (")[0], task: s.task, kit: s.kit, mission: m.title };
    return null;
  }

  function plan(m) {
    if (typeof Nav !== "undefined" && Nav.active) Nav.stop();
    waypoints = m.stops.map((s) => [s.lat, s.lon]);
    wpNames = m.stops.map((s) => s.name);
    m.stops.forEach((s) => stopWork.set(llKey([s.lat, s.lon]), s.min));
    for (const i of m.drive || []) driveLegs.add(legKey(waypoints[i], waypoints[i + 1]));
    $("roundtrip").checked = m.round;
    $("depart").value = m.depart;
    Suit.set({ loadKg: m.load, rover: m.rover, crew: 2 });
    if (m.layers.length) DataLayers.show(m.layers);
    showTab("route");
    redrawRoute();
    map.fitBounds(L.latLngBounds(waypoints).pad(0.4), { maxZoom: 15 });
  }

  function render() {
    const el = document.getElementById("missions");
    if (!el) return;
    el.innerHTML = LIST.map((m, i) => `
      <article class="mission">
        <div class="mi-site">${m.site}</div>
        <h3>${m.title}</h3>
        <div class="mi-goal">🎯 ${m.goal}</div>
        <p>${m.why}${Science.cite(...m.cites)}</p>
        <p class="mi-human"><b>Why send people:</b> ${m.human}</p>
        <ol class="mi-stops">${m.stops.map((s) => `<li><b>${s.name}</b> · ${s.min} min — ${s.task}</li>`).join("")}</ol>
        ${m.note ? `<p class="muted small">${m.note}</p>` : ""}
        <div class="mi-meta">${m.round ? "Round trip" : "One way"} · ${m.stops.length} stations · ${m.stops.reduce((a, s) => a + s.min, 0)} min of work · carrying ${m.load} kg${m.rover !== "none" ? ` · ${m.rover === "lrv" ? "open rover" : "pressurised rover"} support` : ""}</div>
        <button type="button" class="go mi-plan" data-i="${i}">▶ Plan this EVA</button>
      </article>`).join("");
    el.querySelectorAll(".mi-plan").forEach((b) => (b.onclick = () => plan(LIST[+b.dataset.i])));
  }
  render();
  return { LIST, taskAt, plan };
})();
