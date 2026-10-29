// The research behind the numbers.
//
// Every figure the planner quotes (effort, radiation, walk-back, load, pace, dust, ice) points at
// a published source here, and the Science tab lists them all with what each one is used for.
// Sources were gathered with a SciSpace literature search; the key values were read from each
// paper's results, not estimated.
const Science = (() => {
  const doi = (d) => `https://doi.org/${d}`;
  const REFS = [
    // ---- walking on Mars ----
    { id: "pandolf1977", topic: "walk", cite: "Pandolf, Givoni & Goldman 1977", year: 1977,
      title: "Predicting energy expenditure with loads while standing or walking very slowly", venue: "J. Applied Physiology 43(4)", url: doi("10.1152/jappl.1977.43.4.577"),
      finding: "Metabolic power from body mass, carried load, speed, grade and a terrain factor.",
      use: "The base equation for effort at every 50 m of your route." },
    { id: "brown2018", topic: "walk", cite: "Brown et al. 2018", year: 2018,
      title: "The metabolic cost of walking in simulated martian gravity and its implications", venue: "J. Exercise Physiology online 21(1)", url: "https://repositorio.pucrs.br/dspace/handle/10923/12329",
      finding: "Walking at 0.38 g used 0.68 L/min of O₂ against 1.00 L/min at 1 g — about a third less, not the 62% that gravity alone suggests.",
      use: "Scales Earth effort to Mars (× 0.68)." },
    { id: "farley1992", topic: "walk", cite: "Farley & McMahon 1992", year: 1992,
      title: "Energetics of walking and running: insights from simulated reduced-gravity experiments", venue: "J. Applied Physiology 73(6)", url: doi("10.1152/jappl.1992.73.6.2709"),
      finding: "Cutting gravity by 75% cut the cost of walking by only 33% (running by 72%).",
      use: "Why the app doesn't simply scale effort by gravity." },
    { id: "cavagna1998", topic: "walk", cite: "Cavagna, Willems & Heglund 1998", year: 1998,
      title: "Walking on Mars", venue: "Nature 393", url: doi("10.1038/31374"),
      finding: "The most economical walking speed on Mars is about 3.4 km/h (5.5 km/h on Earth).",
      use: "Compared with your planned pace." },
    { id: "kram1997", topic: "walk", cite: "Kram, Domingo & Ferris 1997", year: 1997,
      title: "Effect of reduced gravity on the preferred walk-run transition speed", venue: "J. Experimental Biology 200", url: doi("10.1242/jeb.200.4.821"),
      finding: "People switch from walking to running at the same Froude number (≈ 0.5) at every gravity level.",
      use: "Gives the Mars walk-to-lope speed (≈ 4.7 km/h)." },
    { id: "wickman1996", topic: "walk", cite: "Wickman & Luna 1996", year: 1996,
      title: "Locomotion while load-carrying in reduced gravities", venue: "Aviation, Space & Environmental Medicine 67(10)", url: "https://pubmed.ncbi.nlm.nih.gov/9025816/",
      finding: "An average person could walk for 8 h on Mars carrying up to 50% of body mass (suit and pack included) without undue fatigue.",
      use: "Warns when suit + load is more than half your body mass." },
    { id: "carr2007", topic: "walk", cite: "Carr & Newman 2007", year: 2007,
      title: "Space suit bioenergetics: cost of transport during walking and running", venue: "Aviation, Space & Environmental Medicine 78(12)", url: doi("10.3357/ASEM.1953.2007"),
      finding: "Suit pressure, slope, gravity and Froude number together explain suited walking cost across studies (R² = 0.83).",
      use: "Supports the suit-penalty and slope terms of the effort model." },
    { id: "kluis2025", topic: "walk", cite: "Kluis et al. 2025", year: 2025,
      title: "Characterization of the effects of sex, speed, and incline on metabolic rate during partial gravity ambulation", venue: "J. Applied Physiology", url: doi("10.1152/japplphysiol.00627.2024"),
      finding: "Metabolic rate rises with speed, gravity and incline, with a significant gravity × incline interaction.",
      use: "Why uphill legs cost so much more oxygen." },
    { id: "tobler1993", topic: "walk", cite: "Tobler 1993", year: 1993,
      title: "Three presentations on geographical analysis and modeling (hiking function)", venue: "NCGIA Technical Report 93-1", url: null,
      finding: "Hiking speed falls off exponentially with slope and peaks slightly downhill.",
      use: "Walk time for every step, slowed × 0.35 for a pressurised suit." },
    // ---- life support & EVA planning ----
    { id: "waligora1975", topic: "eva", cite: "Waligora et al. 1975", year: 1975,
      title: "Apollo experience report: assessment of metabolic expenditures", venue: "NASA TN D-7883", url: "https://ntrs.nasa.gov/citations/19750010199",
      finding: "Apollo lunar-surface EVAs averaged 780–1200 BTU/h (229–352 W) of metabolic output.",
      use: "The yardstick for your walk's average effort." },
    { id: "waligora1974", topic: "eva", cite: "Waligora & Horrigan 1974", year: 1974,
      title: "Metabolic cost of extravehicular activities", venue: "NASA (Skylab vs Gemini/Apollo)", url: "https://ntrs.nasa.gov/citations/19750006325",
      finding: "EVA metabolic rates ranged 100–500 kcal/h (116–581 W); long-EVA averages were set by crew pacing.",
      use: "Flags effort peaks above anything measured on Apollo or Skylab." },
    { id: "vos2007", topic: "eva", cite: "Vos, Gernhardt & Lee 2007", year: 2007,
      title: "The Walkback Test: suit and life support requirements for a 10 km traverse in a planetary suit", venue: "SAE 2007-01-3133", url: doi("10.4271/2007-01-3133"),
      finding: "10 km is the Apollo-derived limit for walking home after a rover breakdown. Suited subjects covered it in 96 min at ~700 W — more heat than Apollo or EMU cooling can remove.",
      use: "The 10 km walk-back ring on the map, and the cooling warning." },
    { id: "johnson2010", topic: "eva", cite: "Johnson et al. 2010", year: 2010,
      title: "An integrated traverse planner and analysis tool for planetary exploration (SEXTANT)", venue: "AIAA SPACE 2010", url: doi("10.2514/6.2010-8829"),
      finding: "A traverse planner should compute the walk back home from any point of a traverse, for emergencies.",
      use: "The point-of-no-return marker on one-way routes." },
    { id: "carr2003", topic: "eva", cite: "Carr, Newman & Hodges 2003", year: 2003,
      title: "Geologic traverse planning for planetary EVA", venue: "SAE 2003-01-2416", url: doi("10.4271/2003-01-2416"),
      finding: "Re-analysing Apollo 14, every traverse broke the maximum-metabolic-rate rule, mostly on fast hill climbs and descents.",
      use: "Why steep legs get an effort warning." },
    { id: "paul2012", topic: "eva", cite: "Paul 2012", year: 2012,
      title: "Energy expenditure during extravehicular activity through Apollo", venue: "AIAA ICES 2012-3504", url: doi("10.2514/6.2012-3504"),
      finding: "Gemini EVAs ended with crews exhausted when effort outran suit cooling; real-time metabolic monitoring became essential.",
      use: "Why live guidance tracks effort and heart rate." },
    { id: "marquez2019", topic: "eva", cite: "Marquez et al. 2019", year: 2019,
      title: "Future needs for science-driven geospatial and temporal EVA planning and execution (BASALT)", venue: "Astrobiology 19(3)", url: doi("10.1089/ast.2018.1838"),
      finding: "Mars crews will run EVAs under minutes of communication delay with Earth and must plan and re-plan on site.",
      use: "The live signal-delay figure in Conditions." },
    // ---- radiation ----
    { id: "hassler2014", topic: "rad", cite: "Hassler et al. 2014", year: 2014,
      title: "Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover", venue: "Science 343", url: doi("10.1126/science.1244797"),
      finding: "On Gale crater's floor: 0.21 mGy/day absorbed dose, 0.64 ± 0.12 mSv/day dose equivalent (near solar maximum).",
      use: "Radiation dose for your walk." },
    { id: "guo2021", topic: "rad", cite: "Guo et al. 2021", year: 2021,
      title: "Radiation environment for future human exploration on the surface of Mars: the current understanding based on MSL/RAD dose measurements", venue: "Astronomy & Astrophysics Review 29", url: doi("10.1007/s00159-021-00136-5"),
      finding: "Surface cosmic-ray dose rose about 50% as the Sun went quiet towards solar minimum.",
      use: "The upper end of the dose estimate." },
    { id: "guo2017", topic: "rad", cite: "Guo et al. 2017", year: 2017,
      title: "Dependence of the Martian radiation environment on atmospheric depth: modeling and measurement", venue: "J. Geophysical Research: Planets 122", url: doi("10.1002/2016JE005206"),
      finding: "Dose equivalent falls steadily as the column of air overhead gets thicker.",
      use: "High ground gets more dose than Gale's crater floor; deep basins get less." },
    { id: "zeitlin2013", topic: "rad", cite: "Zeitlin et al. 2013", year: 2013,
      title: "Measurements of energetic particle radiation in transit to Mars on the Mars Science Laboratory", venue: "Science 340", url: doi("10.1126/science.1235989"),
      finding: "Even the shortest round trip to Mars adds about 0.66 Sv dose equivalent.",
      use: "Puts one walk's dose in the context of the whole mission." },
    { id: "nasa3001", topic: "rad", cite: "NASA-STD-3001 Vol. 1 Rev. B 2022", year: 2022,
      title: "NASA Space Flight Human-System Standard, Volume 1: Crew Health", venue: "NASA technical standard", url: null,
      finding: "Career limit of 600 mSv effective dose for every astronaut.",
      use: "Context for the walk's dose." },
    { id: "jpl2024", topic: "rad", cite: "NASA/JPL 2024", year: 2024,
      title: "NASA watches Mars light up during epic solar storm", venue: "NASA Jet Propulsion Laboratory news", url: "https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/",
      finding: "On 20 May 2024 particles from an X-class flare gave Curiosity's RAD about 8,100 µGy (≈ 8.1 mGy) — some 30 chest X-rays, the biggest surge it had measured.",
      use: "Why the space-weather go/no-go and the time-to-shelter matter." },
    { id: "donki", topic: "rad", cite: "NASA CCMC DONKI", year: 2026,
      title: "Space Weather Database Of Notifications, Knowledge, Information", venue: "NASA Community Coordinated Modeling Center", url: "https://kauai.ccmc.gsfc.nasa.gov/DONKI/",
      finding: "Flares with their source positions, solar energetic particle events, and CME arrival times at Earth, Mars and spacecraft from WSA-ENLIL model runs.",
      use: "Live space weather: Mars-bound CMEs and flares from the side of the Sun facing Mars." },
    { id: "swpc", topic: "rad", cite: "NOAA SWPC", year: 2026,
      title: "GOES proton and X-ray flux, solar region reports, 3-day forecasts", venue: "NOAA Space Weather Prediction Center", url: "https://www.swpc.noaa.gov/",
      finding: "Real-time ≥10 MeV proton flux (10 pfu = an S1 radiation storm), flares and each sunspot region's flare and proton probabilities.",
      use: "Live space weather, translated from Earth's view to Mars'." },
    // ---- weather & dust ----
    { id: "cantor2006", topic: "dust", cite: "Cantor, Kanak & Edgett 2006", year: 2006,
      title: "Mars Orbiter Camera observations of Martian dust devils and their tracks (1997–2006)", venue: "J. Geophysical Research 111", url: doi("10.1029/2006JE002700"),
      finding: "11,456 dust devils: activity peaks in each hemisphere's midsummer, none in the north at Ls 203–282°, Amazonis the most active; large vortices exceed 20 m/s.",
      use: "Dust-devil season for the place you're planning." },
    { id: "greeley2010", topic: "dust", cite: "Greeley et al. 2010", year: 2010,
      title: "Gusev Crater, Mars: observations of three dust devil seasons", venue: "J. Geophysical Research 115", url: doi("10.1029/2010JE003608"),
      finding: "Spirit counted 761 dust devils over three seasons, each beginning at Ls ≈ 181° (southern spring).",
      use: "When the season starts in the south." },
    { id: "ferri2003", topic: "dust", cite: "Ferri et al. 2003", year: 2003,
      title: "Dust devils as observed by Mars Pathfinder", venue: "J. Geophysical Research 108", url: doi("10.1029/2000JE001421"),
      finding: "Dust devils were active from about 09:00 to 15:00 local time, 15 m to more than 550 m across.",
      use: "Flags walks during dust-devil hours." },
    { id: "conway2025", topic: "dust", cite: "Conway et al. 2025", year: 2025,
      title: "A global survey for dust devil vortices on Mars using MRO context camera images enabled by neural networks", venue: "Bern Open Repository", url: doi("10.48620/87298"),
      finding: "13,409 detections: about half in Amazonis Planitia, a new hotspot in southern Hellas, and large ones clustered near 60°N/S at summer solstice.",
      use: "Hotspot warnings." },
    { id: "fernandez1997", topic: "dust", cite: "Fernández 1997", year: 1997,
      title: "Martian dust storms: a review", venue: "Earth, Moon, and Planets 77", url: doi("10.1023/A:1006134805153"),
      finding: "Planet-encircling dust storms form in southern spring and summer; regional storms are more frequent.",
      use: "Dust-storm season (Ls 180–360°)." },
    { id: "cantor2001", topic: "dust", cite: "Cantor et al. 2001", year: 2001,
      title: "Martian dust storms: 1999 Mars Orbiter Camera observations", venue: "J. Geophysical Research 106", url: doi("10.1029/2000JE001310"),
      finding: "783 local-to-regional storms in one season; they start at the polar cap edges, at the foot of high terrain and in the mid-latitudes.",
      use: "Dust-storm season note." },
    { id: "marshall1999", topic: "dust", cite: "Marshall 1999", year: 1999,
      title: "Dust on Mars: an aeolian threat to human exploration?", venue: "NASA / LPI", url: "https://ntrs.nasa.gov/citations/20000025356",
      finding: "Fine, electrostatically charged dust coats suits, clouds visors and works into joints and fabrics.",
      use: "Dust hazard note." },
    { id: "munguira2023", topic: "dust", cite: "Munguira et al. 2023", year: 2023,
      title: "Near surface atmospheric temperatures at Jezero from Mars 2020 MEDA measurements", venue: "J. Geophysical Research: Planets 128", url: doi("10.1029/2022JE007559"),
      finding: "Daytime convection peaks at noon (≈ 2.5 K air fluctuations at 1.45 m) and dies away near 17:00 local; nights are stable.",
      use: "When the air near the ground is gustiest." },
    { id: "gomez2014", topic: "dust", cite: "Gómez-Elvira et al. 2014", year: 2014,
      title: "Curiosity's rover environmental monitoring station: overview of the first 100 sols", venue: "J. Geophysical Research: Planets 119", url: doi("10.1002/2013JE004576"),
      finding: "Gale is extremely dry; surface pressure swings about 90 Pa every sol.",
      use: "Weather context." },
    // ---- water & resources ----
    { id: "morgan2025", topic: "ice", cite: "Morgan et al. 2025", year: 2025,
      title: "Refined mapping of subsurface water ice on Mars to support future missions (SWIM)", venue: "Planetary Science Journal 6", url: doi("10.3847/PSJ/ad9b24"),
      finding: "Ice-consistency maps at 3 km/pixel for 0–1, 1–5 and >5 m depth; the shallowest ice reaches equatorward of 30° in places.",
      use: "Ground-ice note in Conditions." },
    { id: "butcher2022", topic: "ice", cite: "Butcher 2022", year: 2022,
      title: "Water ice at mid-latitudes on Mars", venue: "Oxford Research Encyclopedia of Planetary Science", url: doi("10.1093/acrefore/9780190647926.013.239"),
      finding: "The 30–60° latitude bands hold abundant ice under centimetres to metres of soil — leading targets for in-situ water.",
      use: "Ground-ice note in Conditions." },
    { id: "vincendon2010", topic: "ice", cite: "Vincendon et al. 2010", year: 2010,
      title: "Near-tropical subsurface ice on Mars", venue: "Geophysical Research Letters 37", url: doi("10.1029/2009GL041426"),
      finding: "Frost on pole-facing 20–30° slopes needs water ice within 1 m of the surface as far as 25°S.",
      use: "Ice on pole-facing slopes." },
    { id: "davila2013", topic: "ice", cite: "Davila et al. 2013", year: 2013,
      title: "Perchlorate on Mars: a chemical hazard and a resource for humans", venue: "Int. J. Astrobiology 12", url: doi("10.1017/S1473550413000189"),
      finding: "Martian soils hold 0.5–1% perchlorate — a thyroid hazard, but also a possible source of oxygen.",
      use: "Soil hazard and resource note." },
    { id: "lam2002", topic: "ice", cite: "Lam et al. 2002", year: 2002,
      title: "Pulmonary toxicity of simulated lunar and Martian dusts in mice", venue: "Inhalation Toxicology 14", url: doi("10.1080/08958370290084683"),
      finding: "Mars soil simulant caused more lung inflammation and fibrosis than lunar simulant.",
      use: "Keep dust out of the habitat." },
    // ---- orbital science data ----
    { id: "tanaka2014", topic: "data", cite: "Tanaka et al. 2014", year: 2014,
      title: "Geologic map of Mars (SIM 3292), 1:20,000,000", venue: "USGS Scientific Investigations Map 3292", url: "https://doi.org/10.3133/sim3292",
      finding: "Every geologic unit on Mars, mapped from MOLA, THEMIS, HRSC and CTX data and dated Noachian (oldest), Hesperian or Amazonian.",
      use: "The geologic map layer, the unit under any point, and the units a route crosses." },
    { id: "carter2013", topic: "data", cite: "Carter et al. 2013", year: 2013,
      title: "Hydrous minerals on Mars as seen by the CRISM and OMEGA imaging spectrometers: updated global view", venue: "J. Geophysical Research: Planets 118", url: doi("10.1029/2012JE004145"),
      finding: "About 1,000 sites of water-altered minerals, mostly clays, almost all in the ancient southern highlands.",
      use: "Hydrated-mineral points on the map and science stops along a route." },
    { id: "ehlmann2014", topic: "data", cite: "Ehlmann & Edwards 2014", year: 2014,
      title: "Mineralogy of the martian surface", venue: "Annual Review of Earth and Planetary Sciences 42", url: doi("10.1146/annurev-earth-060313-055024"),
      finding: "Where Mars' clays, silica, sulfates, chlorides and carbonates are — each telling of a different kind of ancient water.",
      use: "Water-formed minerals by class, and what each means for a sample." },
    { id: "osterloo2010", topic: "data", cite: "Osterloo et al. 2010", year: 2010,
      title: "Geologic context of proposed chloride-bearing materials on Mars", venue: "J. Geophysical Research 115", url: doi("10.1029/2010JE003613"),
      finding: "About 640 chloride deposits in the southern highlands, the salt of evaporated ponds and lakes, mapped with THEMIS.",
      use: "Chloride salt deposits on the map." },
    { id: "fergason2006", topic: "data", cite: "Fergason, Christensen & Kieffer 2006", year: 2006,
      title: "High-resolution thermal inertia derived from THEMIS: thermal model and applications", venue: "J. Geophysical Research 111", url: doi("10.1029/2006JE002735"),
      finding: "Thermal inertia from night-time THEMIS images separates dust, sand, rocks and bedrock at 100 m scale.",
      use: "The night-infrared layer: bright (warm at night) is rock, dark is loose dust." },
    { id: "putzig2007", topic: "data", cite: "Putzig & Mellon 2007", year: 2007,
      title: "Apparent thermal inertia and the surface heterogeneity of Mars", venue: "Icarus 191", url: doi("10.1016/j.icarus.2007.05.013"),
      finding: "Global TES thermal inertia: low over the dusty Tharsis and Arabia, high where there's rock, crusted ground or ice.",
      use: "The thermal-inertia layer (how firm the ground is)." },
    { id: "ruff2002", topic: "data", cite: "Ruff & Christensen 2002", year: 2002,
      title: "Bright and dark regions on Mars: particle size and mineralogical characteristics based on TES data", venue: "J. Geophysical Research 107", url: doi("10.1029/2001JE001580"),
      finding: "A dust cover index from TES spectra shows where dust blankets the surface and hides the rock beneath.",
      use: "The dust-cover layer." },
    { id: "dundas2014", topic: "data", cite: "Dundas et al. 2014", year: 2014,
      title: "HiRISE observations of new impact craters exposing Martian ground ice", venue: "J. Geophysical Research: Planets 119", url: doi("10.1002/2013JE004482"),
      finding: "Fresh craters at mid-latitudes dug up bright, nearly pure water ice that faded over months as it sublimated.",
      use: "Exposed-ice points, and the ice-prospecting EVA." },
    { id: "mcewen2014", topic: "data", cite: "McEwen et al. 2014", year: 2014,
      title: "Recurring slope lineae in equatorial regions of Mars", venue: "Nature Geoscience 7", url: doi("10.1038/ngeo2014"),
      finding: "Dark streaks that grow down warm slopes each season, including in Valles Marineris.",
      use: "RSL points: places to keep crews away from." },
    { id: "rummel2014", topic: "data", cite: "Rummel et al. 2014", year: 2014,
      title: "A new analysis of Mars 'Special Regions'", venue: "Astrobiology 14(11)", url: doi("10.1089/ast.2014.1227"),
      finding: "Places where Earth microbes might grow, such as RSL, are Special Regions that missions must not contaminate.",
      use: "Keep-out warnings near RSL." },
    // ---- the science EVAs ----
    { id: "msl2025", topic: "sci", cite: "NASA MSL Curiosity team 2025", year: 2025,
      title: "Curiosity explores the boxwork on Mount Sharp", venue: "NASA Mars Science Laboratory mission updates", url: "https://science.nasa.gov/mission/msl-curiosity/",
      finding: "In 2025 Curiosity reached a region of low, mineral-hardened ridges in a net-like pattern seen from orbit, thought to record groundwater flowing through cracks as Mars dried.",
      use: "The boxwork EVA." },
    { id: "hurowitz2025", topic: "sci", cite: "Hurowitz et al. 2025", year: 2025,
      title: "Redox-driven mineral and organic associations in Jezero Crater, Mars", venue: "Nature", url: null,
      finding: "The Cheyava Falls rock's 'leopard spots' hold iron phosphate and iron sulfide with organic matter: a potential biosignature.",
      use: "The Cheyava Falls EVA." },
    { id: "depot2023", topic: "sci", cite: "NASA/JPL 2023", year: 2023,
      title: "Perseverance completes the first sample depot on another world (Three Forks)", venue: "NASA Mars 2020 mission news", url: null,
      finding: "Ten sealed sample tubes were left on Jezero's floor at Three Forks between December 2022 and January 2023.",
      use: "The sample-retrieval EVA." },
    { id: "bramson2015", topic: "sci", cite: "Bramson et al. 2015", year: 2015,
      title: "Widespread excess ice in Arcadia Planitia, Mars", venue: "Geophysical Research Letters 42", url: doi("10.1002/2015GL064844"),
      finding: "Terraced craters and SHARAD radar point to tens of metres of nearly pure ice under Arcadia Planitia.",
      use: "The ice-prospecting EVA." },
    { id: "dundas2018", topic: "sci", cite: "Dundas et al. 2018", year: 2018,
      title: "Exposed subsurface ice sheets in the Martian mid-latitudes", venue: "Science 359", url: doi("10.1126/science.aao1619"),
      finding: "Eroding scarps expose clean ice sheets more than 100 m thick, starting within 1–2 m of the surface.",
      use: "Why the northern mid-latitudes are good places for a base." },
    { id: "squyres2008", topic: "sci", cite: "Squyres et al. 2008", year: 2008,
      title: "Detection of silica-rich deposits on Mars", venue: "Science 320", url: doi("10.1126/science.1155429"),
      finding: "Spirit found soil of up to ~90% opaline silica beside Home Plate, most likely from hot springs or steam vents.",
      use: "The Columbia Hills EVA." },
    { id: "morris2010", topic: "sci", cite: "Morris et al. 2010", year: 2010,
      title: "Identification of carbonate-rich outcrops on Mars by the Spirit rover", venue: "Science 329", url: doi("10.1126/science.1189667"),
      finding: "The Comanche outcrops hold 16–34% Mg-Fe carbonate, formed in water that was not acidic.",
      use: "The Columbia Hills EVA." },
    // ---- maps & time ----
    { id: "allison2000", topic: "map", cite: "Allison & McEwen 2000", year: 2000,
      title: "A post-Pathfinder evaluation of areocentric solar coordinates with improved timing recipes for Mars seasonal/diurnal climate studies", venue: "Planetary and Space Science 48", url: doi("10.1016/S0032-0633(99)00092-6"),
      finding: "The Mars24 recipe for local solar time, season (Ls) and the Sun's position.",
      use: "Clock, sunrise/sunset, sun direction." },
    { id: "fergason2018", topic: "map", cite: "Fergason, Hare & Laura 2018", year: 2018,
      title: "HRSC and MOLA blended digital elevation model at 200 m v2", venue: "USGS Astrogeology Science Center", url: "https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m",
      finding: "Global 200 m terrain from Mars Express stereo blended with MOLA laser altimetry.",
      use: "Terrain and slopes everywhere outside Jezero." },
    { id: "smith2001", topic: "map", cite: "Smith et al. 2001", year: 2001,
      title: "Mars Orbiter Laser Altimeter: experiment summary after the first year of global mapping of Mars", venue: "J. Geophysical Research 106", url: doi("10.1029/2000JE001364"),
      finding: "Global laser altimetry of Mars; the reference surface for every elevation in the app.",
      use: "Fallback terrain." },
  ];
  const TOPICS = { walk: "Walking on Mars", eva: "Life support & EVA planning", rad: "Radiation & space weather", dust: "Weather & dust",
    ice: "Water, soil & resources", data: "Orbital science data on the map", sci: "The science EVAs", map: "Maps & time" };
  const BY_ID = Object.fromEntries(REFS.map((r, i) => [r.id, { ...r, n: i + 1 }]));

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  // a numbered citation link that opens the source card in the Science tab
  const cite = (...ids) => ids.map((id) => BY_ID[id]).sort((a, b) => a.n - b.n).map((r) => {
    const id = r.id;
    return `<a class="cite" href="#ref-${id}" data-ref="${id}" title="${esc(r.cite)} — ${esc(r.title)}">${r.n}</a>`;
  }).join("");
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a.cite");
    if (!a) return;
    e.preventDefault();
    open(a.dataset.ref);
  });
  function open(id) {
    showTab("science");
    const card = document.getElementById(`ref-${id}`);
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash");
  }

  // ---------- Science tab ----------
  function renderLibrary() {
    const el = document.getElementById("science-lib");
    if (!el) return;
    el.innerHTML = Object.entries(TOPICS).map(([t, name]) => `<h3 class="sci-topic">${name}</h3>` +
      REFS.filter((r) => r.topic === t).map((r) => `
        <article class="ref" id="ref-${r.id}">
          <div class="ref-n">${BY_ID[r.id].n}</div>
          <div>
            <div class="ref-f">${r.finding}</div>
            <div class="ref-u"><b>In this app:</b> ${r.use}</div>
            <div class="ref-c">${r.url ? `<a href="${r.url}" target="_blank" rel="noopener">${esc(r.cite)}</a>` : esc(r.cite)} · <i>${esc(r.title)}</i> · ${esc(r.venue)}</div>
          </div>
        </article>`).join("")).join("");
    const n = document.getElementById("science-count");
    if (n) n.textContent = REFS.length;
  }

  // ---------- numbers taken from the papers ----------
  const APOLLO_AVG_W = [229, 352];   // Waligora et al. 1975: 780–1200 BTU/h
  const EVA_MAX_W = 581;             // Waligora & Horrigan 1974: 500 kcal/h
  const WALKBACK_W = 696;            // Vos et al. 2007: 2374 BTU/h, above Apollo/EMU cooling
  const WALKBACK_KM = 10;            // Vos et al. 2007: Apollo-derived walk-back limit
  const LOAD_FRAC = 0.5;             // Wickman & Luna 1996: 8 h on Mars with ≤ 50% body mass
  const MARS_BEST_KMH = 3.4;         // Cavagna et al. 1998
  const LOPE_KMH = Math.sqrt(0.5 * 3.721 * 0.9) * 3.6; // Kram et al. 1997: Froude 0.5, 0.9 m leg
  const GALE_MSV_DAY = 0.64;         // Hassler et al. 2014
  const SOLAR_MIN_FACTOR = 1.5;      // Guo et al. 2021: +50% towards solar minimum
  const GALE_ELEV_M = -4500;         // Curiosity's traverse on Gale's floor, roughly
  const EARTH_BG_MSV_DAY = 2.4 / 365.25; // UNSCEAR world-average natural background
  const R = 3389500, RAD = Math.PI / 180;
  const distM = (a, b) => {
    const x = (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD), y = (b[0] - a[0]) * RAD;
    return R * Math.hypot(x, y);
  };

  // last sample of a route from which you could still walk straight back to the start
  // (retracing your steps) with the reserve intact — the SEXTANT "walkback" idea
  function turnBack(p, tl) {
    const S = p.samples, have = Suit.available(), keep = 1 - Suit.state.reservePct / 100;
    const back = Object.fromEntries(Suit.RES.map((r) => [r.key, 0]));
    let last = 0;
    for (let i = 1; i < S.length; i++) {
      const c = Suit.stepCost(S[i].dist_m - S[i - 1].dist_m, S[i - 1].elev_m - S[i].elev_m); // walking i → i−1
      for (const r of Suit.RES) back[r.key] += c[r.key];
      if (!Suit.RES.every((r) => tl[r.key][i] + back[r.key] <= have[r.key] * keep)) break;
      last = i;
    }
    return last;
  }

  // dust devils: hemisphere season (Cantor 2006, Greeley 2010), hours (Ferri 2003), hotspots (Conway 2025)
  function dustDevils(lat, lon, Ls) {
    const north = lat >= 0;
    const summer = north ? Ls >= 90 && Ls < 180 : Ls >= 270;
    const springSummer = north ? Ls < 180 : Ls >= 180;
    const quiet = north && Ls >= 202.8 && Ls <= 281.5;
    const amazonis = lat > 15 && lat < 45 && lon > -180 && lon < -140;
    const hellas = lat < -30 && lat > -55 && lon > 50 && lon < 90;
    const level = quiet ? 0 : summer ? 2 : springSummer ? 1 : 0;
    let text = quiet ? "No dust devils were seen in the north at this time of year"
      : summer ? "Peak dust-devil season here (local midsummer)"
      : springSummer ? "Dust-devil season here (local spring/summer)" : "Off-season for dust devils here";
    if (amazonis) text += " — and this is Amazonis Planitia, the most active dust-devil region on Mars";
    else if (hellas) text += " — southern Hellas is a dust-devil hotspot";
    return { level: level + (amazonis || hellas ? 1 : 0), text, cites: cite("cantor2006", ...(north ? [] : ["greeley2010"])) + (amazonis || hellas ? cite("conway2025") : "") };
  }
  const stormSeason = (Ls) => Ls >= 180;

  // ---------- route summary: what the research says about this walk ----------
  function routeCheck(p, tl, { round, depart, finish, Ls }) {
    const S = p.samples, A = [S[0].lat, S[0].lon];
    const rows = [];
    const row = (cls, ic, html) => rows.push(`<div class="sci-row ${cls}"><span class="sci-ic">${ic}</span><div>${html}</div></div>`);

    // effort vs Apollo
    const avg = Math.round(tl.avgW), peak = Math.round(tl.peakW);
    const [lo, hi] = APOLLO_AVG_W;
    const effortCls = peak >= WALKBACK_W || avg > hi ? "warn" : "ok";
    row(effortCls, "⚡", `Effort ≈ <b>${avg} W</b> average — ${avg < lo ? "lighter than" : avg <= hi ? "inside" : "above"} the ${lo}–${hi} W Apollo crews averaged on the Moon${cite("waligora1975")}.` +
      (peak >= WALKBACK_W ? ` Peak ${peak} W is as hard as the 10 km Walkback Test pace, which produced more heat than suit cooling could remove${cite("vos2007")} — take the steep parts slowly${cite("carr2003")}.`
        : peak > EVA_MAX_W ? ` Peak ${peak} W is above anything measured on Apollo or Skylab EVAs${cite("waligora1974")} — slow down on the climbs${cite("carr2003")}.`
        : ` Peak ${peak} W.`));

    // radiation
    const msv = (tl.hours / 24) * GALE_MSV_DAY;
    const meanElev = S.reduce((a, s) => a + s.elev_m, 0) / S.length;
    const elevNote = meanElev > GALE_ELEV_M + 3000 ? ` This route is ${((meanElev - GALE_ELEV_M) / 1000).toFixed(0)} km higher than Gale's floor, with less air overhead, so expect more${cite("guo2017")}.`
      : meanElev < GALE_ELEV_M - 1500 ? ` This route is lower than Gale's floor, with more air overhead, so expect a little less${cite("guo2017")}.` : "";
    row("", "☢", `Radiation ≈ <b>${msv < 0.1 ? msv.toFixed(3) : msv.toFixed(2)}–${(msv * SOLAR_MIN_FACTOR).toFixed(msv < 0.1 ? 3 : 2)} mSv</b> on this walk (0.64 mSv/day measured on Gale's floor${cite("hassler2014")}, up to ~50% more near solar minimum${cite("guo2021")}) — about ${Math.max(1, Math.round(msv / EARTH_BG_MSV_DAY))} days of Earth's natural background.${elevNote} For scale: the round trip to Mars adds ~660 mSv${cite("zeitlin2013")}; NASA's career limit is 600 mSv${cite("nasa3001")}.`);

    // space weather: the go/no-go, and how far from shelter the walk ever gets
    if (typeof SpaceWx !== "undefined") {
      const wx = SpaceWx.assess(), end = S.length - 1;
      let shelterH = 0;
      for (let i = 0; i <= end; i++) shelterH = Math.max(shelterH, round ? Math.min(tl.t[i], tl.hours - tl.t[i]) : tl.t[i]);
      const pr = Suit.state.rover === "pressurized";
      const word = { go: "GO", caution: "CAUTION", nogo: "NO-GO", unknown: "not checked" }[wx.level];
      row(wx.level === "go" ? "ok" : wx.level === "unknown" ? "" : "warn", "☀",
        `Space weather <b>${word}</b>: ${wx.headline}${cite("donki", "swpc")}. ` +
        (pr ? "The pressurised rover goes with you, so shelter is minutes away."
          : `If an alert comes, the furthest you'll be from shelter at ${lastLabels[0] || "A"} is <b>${fmtDur(shelterH)}</b> on foot — the fastest particles can arrive within an hour of a flare${cite("jpl2024")}.`));
    }

    // walk-back
    let far = 0, farI = 0;
    S.forEach((s, i) => { const d = distM(A, [s.lat, s.lon]); if (d > far) { far = d; farI = i; } });
    const farKm = far / 1000;
    let wb = `Furthest point ${fmtKm(farKm)} from ${lastLabels[0] || "A"} — ${farKm <= WALKBACK_KM ? "inside" : "<b>beyond</b>"} the 10 km walk-home limit used since Apollo (dashed ring)${cite("vos2007")}.`;
    let tb = null;
    if (!round) {
      tb = turnBack(p, tl);
      const end = S.length - 1;
      if (tb >= end) wb += ` From anywhere on this route you could still walk back to ${lastLabels[0] || "A"} with your reserve intact${cite("johnson2010")}.`;
      else wb += ` <b>Point of no return at ${fmtKm(S[tb].dist_m / 1000)}</b> (⟲ on the map): past it, your suit can't get you back to ${lastLabels[0] || "A"} with the reserve intact — you're committed to the destination${cite("johnson2010")}.`;
    }
    row(farKm > WALKBACK_KM || (tb !== null && tb < S.length - 1) ? "warn" : "ok", "⟲", wb);

    // load
    const carried = Suit.CAP.suitKg + +Suit.state.loadKg, frac = carried / Suit.state.bodyKg;
    if (frac > LOAD_FRAC) row(tl.hours > 4 ? "warn" : "", "🎒", `Suit + load ${Math.round(carried)} kg is ${Math.round(frac * 100)}% of your body mass. Lab studies project an 8-hour Mars walk is sustainable up to about 50%${cite("wickman1996")} — expect to tire sooner and plan rest stops.`);

    // pace
    const kmh = (p.stats.distance_km - (tl.driveKm || 0)) / (tl.walkH || tl.hours || 1); // walking only: not work stops or rover legs
    row("", "🚶", `Planned pace ${kmh.toFixed(1)} km/h, held down by the suit. Unsuited, the cheapest walking speed on Mars is ${MARS_BEST_KMH} km/h${cite("cavagna1998")}, and above ≈ ${LOPE_KMH.toFixed(1)} km/h you'd naturally break into a lope${cite("kram1997")}. Mars gravity cuts the cost of walking by only about a third${cite("brown2018", "farley1992")}.`);

    // dust
    const dd = dustDevils(A[0], A[1], Ls);
    const devilHours = depart < 15 && finish > 9;
    if (dd.level > 0 && devilHours) row(dd.level > 1 ? "warn" : "", "🌪", `${dd.text}${dd.cites}, and your walk overlaps the 09:00–15:00 dust-devil hours${cite("ferri2003")}. Watch the horizon for plumes; dust clings to visors and joints${cite("marshall1999")}.`);
    if (stormSeason(Ls)) row("", "🌫", `It's dust-storm season (Ls ${Ls.toFixed(0)}°: southern spring–summer)${cite("fernandez1997", "cantor2001")} — check orbital weather before a long walk.`);

    return { html: `<div class="sci"><div class="sci-head">🔬 What the research says about this walk</div>${rows.join("")}</div>`, turnBack: tb, far: farI };
  }

  // ---------- Conditions tab: hazards & resources at a place ----------
  function placeNotes(lat, lon, elev, ltst) {
    const t = MarsTime.compute(), out = [];
    const note = (cls, ic, html) => out.push(`<div class="sci-row ${cls}"><span class="sci-ic">${ic}</span><div>${html}</div></div>`);
    const rad = elev === undefined ? "" : elev > GALE_ELEV_M + 3000 ? `This spot is ${((elev - GALE_ELEV_M) / 1000).toFixed(0)} km above Gale's floor: thinner air overhead, so more than that${cite("guo2017")}.`
      : elev < GALE_ELEV_M - 1500 ? `This spot is below Gale's floor: thicker air overhead, so a little less${cite("guo2017")}.` : "This spot is at a similar altitude to Gale's floor.";
    note("", "☢", `Surface radiation: <b>0.64 mSv/day</b> measured by Curiosity on Gale's floor${cite("hassler2014")}, up to ~50% more near solar minimum${cite("guo2021")}. ${rad}`);
    const dd = dustDevils(lat, lon, t.Ls);
    note(dd.level > 1 ? "warn" : "", "🌪", `${dd.text}${dd.cites}. They're most active 09:00–15:00 local${cite("ferri2003")}.` +
      (stormSeason(t.Ls) ? ` Dust-storm season is under way (Ls 180–360°)${cite("fernandez1997")}.` : ` Outside the main dust-storm season (Ls 180–360°)${cite("fernandez1997")}.`));
    const gusty = ltst > 10 && ltst < 16;
    note("", "🌡", `${gusty ? "Now: midday convection — gusty, turbulent air near the ground." : ltst >= 16 && ltst < 18 ? "Now: convection dying down; the air turns calm near 17:00." : "Now: stable, calm air (no daytime convection)."} MEDA saw the turbulence peak at noon and vanish by about 17:00 local${cite("munguira2023")}.`);
    const a = Math.abs(lat);
    if (a >= 40) note("ok", "💧", `<b>Shallow ground ice is likely</b>: the 30–60° bands hold abundant ice under centimetres to metres of soil${cite("butcher2022", "morgan2025")} — a prime spot for in-situ water.`);
    else if (a >= 25) note("", "💧", `Ground ice is patchy at this latitude: SWIM maps the shallowest ice reaching below 30° in places${cite("morgan2025")}, and pole-facing slopes can hide ice within 1 m as far as 25°S${cite("vincendon2010")}.`);
    else note("", "💧", `Shallow ground ice is unlikely this close to the equator${cite("morgan2025")}; water would have to come from hydrated minerals or be brought along.`);
    note("", "⚠", `The soil holds 0.5–1% perchlorate — a thyroid toxin, though also a possible oxygen source${cite("davila2013")}. Mars-like dust inflamed lungs more than lunar dust in tests${cite("lam2002")}: brush down before entering the habitat.`);
    return out.join("");
  }

  // light-time to Earth, and whether the Sun is in the way
  function commsNote() {
    const e = MarsTime.earth();
    const conj = e.elongDeg < 3 ? " · solar conjunction: no contact" : e.elongDeg < 6 ? " · near conjunction: noisy link" : "";
    return { min: e.lightMin, text: `${e.lightMin.toFixed(1)} min one way${conj}`,
      note: `A question to Mission Control and its answer take <b>${(2 * e.lightMin).toFixed(0)} min</b> round trip, so EVA decisions get made on site${cite("marquez2019")}.` };
  }

  renderLibrary(); // scripts are deferred, so the page is already parsed
  return { REFS, cite, open, routeCheck, placeNotes, commsNote, turnBack, LOPE_KMH };
})();
