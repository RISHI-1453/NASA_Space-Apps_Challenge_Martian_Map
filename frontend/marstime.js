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

  return { compute, local, season, hhmm };
})();
