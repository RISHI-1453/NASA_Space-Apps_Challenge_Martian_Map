// Mars time & sun position — Allison & McEwen (2000) / NASA GISS Mars24 algorithm.
// All longitudes here are EAST-positive (matching the map).
const MarsTime = (() => {
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const mod = (a, n) => ((a % n) + n) % n;
  const TAI_UTC = 37; // leap seconds (unchanged since 2017)

  function compute(date = new Date()) {
    const jdUT = date.getTime() / 86400000 + 2440587.5;
    const jdTT = jdUT + (TAI_UTC + 32.184) / 86400;
    const dt = jdTT - 2451545.0;

    const M = rad(19.3871 + 0.52402073 * dt);
    const alphaFMS = 270.3871 + 0.524038496 * dt;
    const A = [0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.002, 0.0018];
    const tau = [2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493];
    const phi = [49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095];
    let pbs = 0;
    for (let i = 0; i < 7; i++) pbs += A[i] * Math.cos(rad((0.985626 * dt) / tau[i] + phi[i]));
    const vMinusM = (10.691 + 3.0e-7 * dt) * Math.sin(M) + 0.623 * Math.sin(2 * M) +
      0.05 * Math.sin(3 * M) + 0.005 * Math.sin(4 * M) + 0.0005 * Math.sin(5 * M) + pbs;
    const Ls = mod(alphaFMS + vMinusM, 360);
    const eot = 2.861 * Math.sin(rad(2 * Ls)) - 0.071 * Math.sin(rad(4 * Ls)) +
      0.002 * Math.sin(rad(6 * Ls)) - vMinusM; // degrees
    const msd = (dt - 4.5) / 1.0274912517 + 44796.0 - 0.0009626;
    const mtc = mod(24 * msd, 24);
    const decl = deg(Math.asin(0.42565 * Math.sin(rad(Ls)))) + 0.25 * Math.sin(rad(Ls));
    return { Ls, eot, msd, mtc, decl, marsYear: marsYear(dt) };
  }

  // Mars Year 1 began 1955-04-11 (Clancy et al.). One Mars year = 686.9725 Earth days.
  function marsYear(dt) {
    const jd = dt + 2451545.0;
    return Math.floor((jd - 2435208.5) / 686.9725) + 1;
  }

  function local(t, lat, lonEast) {
    const lmst = mod(t.mtc + lonEast / 15, 24);
    const ltst = mod(lmst + t.eot / 15, 24);
    const H = rad((ltst - 12) * 15);
    const sinAlt = Math.sin(rad(lat)) * Math.sin(rad(t.decl)) +
      Math.cos(rad(lat)) * Math.cos(rad(t.decl)) * Math.cos(H);
    return { lmst, ltst, sunElevation: deg(Math.asin(sinAlt)) };
  }

  // Earth–Mars distance, one-way radio light-time and the Sun–Earth–Mars angle, from JPL's
  // approximate Keplerian elements (Standish, valid 1800–2050) — good to a few light-seconds.
  const ORBITS = { // a (AU), e, I, L, long. perihelion, long. node — and rates per century
    earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]],
    mars: [[1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  };
  function helio(name, T) {
    const [base, rate] = ORBITS[name];
    const [a, e, I, L, w, O] = base.map((v, i) => v + rate[i] * T);
    const M = rad(mod(L - w + 180, 360) - 180), om = rad(w - O), Om = rad(O), inc = rad(I);
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const [co, so, cO, sO, cI, sI] = [Math.cos(om), Math.sin(om), Math.cos(Om), Math.sin(Om), Math.cos(inc), Math.sin(inc)];
    return [(co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
      (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
      so * sI * xp + co * sI * yp];
  }
  function earth(date = new Date()) {
    const T = (date.getTime() / 86400000 + 2440587.5 + (TAI_UTC + 32.184) / 86400 - 2451545) / 36525;
    const e = helio("earth", T), m = helio("mars", T);
    const d = [m[0] - e[0], m[1] - e[1], m[2] - e[2]];
    const au = Math.hypot(...d), r = Math.hypot(...e);
    const elong = deg(Math.acos(-(d[0] * e[0] + d[1] * e[1] + d[2] * e[2]) / (au * r))); // angle Sun–Earth–Mars
    // how far Mars is ahead of Earth around the Sun (+ = ahead): Mars' solar longitude as seen from
    // Earth, which is the Sun's "west" in the heliographic coordinates flare positions are given in
    const sep = mod(deg(Math.atan2(m[1], m[0]) - Math.atan2(e[1], e[0])) + 180, 360) - 180;
    return { au, lightMin: (au * 499.004784) / 60, elongDeg: elong, sepDeg: sep, marsAU: Math.hypot(...m) };
  }

  function season(Ls, lat) {
    const north = ["Spring", "Summer", "Autumn", "Winter"];
    const south = ["Autumn", "Winter", "Spring", "Summer"];
    const i = Math.floor(Ls / 90);
    return (lat >= 0 ? north : south)[i];
  }

  const hhmm = (h) => {
    const m = Math.floor(mod(h, 24) * 60);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };

  return { compute, local, earth, season, hhmm };
})();
