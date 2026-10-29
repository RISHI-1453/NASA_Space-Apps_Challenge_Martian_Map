"""Space weather for an EVA go/no-go: what the Sun is doing now, and whether any of it is aimed at Mars.

  NASA DONKI (CCMC)  flares with their source position, solar energetic particle (SEP) events, and
                     coronal mass ejections whose WSA-ENLIL model run predicts an arrival at Mars
  NOAA SWPC          GOES proton flux and X-ray flares measured at Earth, today's sunspot regions with
                     their flare/proton chances, and the 3-day forecast

Everything here is seen from Earth. Mars sits somewhere else around the Sun, so the frontend
(spaceweather.js) works out which of these regions and events face Mars. Results are cached for
15 minutes; a source that's down is skipped, not waited on.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import httpx

DONKI = "https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get"
SWPC = "https://services.swpc.noaa.gov"
TTL = 15 * 60
_client = httpx.Client(timeout=httpx.Timeout(10, connect=4), follow_redirects=True,
                       headers={"User-Agent": "MartianMap/1.0 (NASA Space Apps)"})
_lock = threading.Lock()
_cache: dict = {"t": 0, "data": None}


def _get(url, params=None, tries=3):
    for i in range(tries):
        try:
            r = _client.get(url, params=params)
            r.raise_for_status()
            return r.json()
        except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError):
            # SWPC's front end drops the odd connection; a timeout means the host is down, so no retry
            if i == tries - 1:
                raise
            time.sleep(0.7 * (i + 1))


def _donki(days_back=7):
    now = datetime.now(timezone.utc)
    q = {"startDate": (now - timedelta(days=days_back)).strftime("%Y-%m-%d"), "endDate": now.strftime("%Y-%m-%d")}
    flares = [{"peak": f.get("peakTime"), "class": f.get("classType"), "location": f.get("sourceLocation"),
               "region": f.get("activeRegionNum")} for f in (_get(f"{DONKI}/FLR", q) or [])]
    seps = [{"time": s.get("eventTime"), "instruments": [i.get("displayName") for i in s.get("instruments") or []]}
            for s in (_get(f"{DONKI}/SEP", q) or [])]
    mars = []
    for sim in _get(f"{DONKI}/WSAEnlilSimulations", q) or []:
        for imp in sim.get("impactList") or []:
            if (imp.get("location") or "").lower() == "mars":
                mars.append({"arrival": imp.get("arrivalTime"), "glancing": bool(imp.get("isGlancingBlow")),
                             "run": sim.get("modelCompletionTime")})
    seen, cmes = set(), []
    for m in sorted(mars, key=lambda m: m["run"] or "", reverse=True):  # newest model run per arrival
        k = (m["arrival"] or "")[:13]
        if k not in seen:
            seen.add(k); cmes.append(m)
    return {"flares": flares, "seps": seps, "mars_cmes": sorted(cmes, key=lambda m: m["arrival"] or "")}


def _protons():
    rows = [r for r in _get(f"{SWPC}/json/goes/primary/integral-protons-1-day.json") if r.get("energy") == ">=10 MeV"]
    rows.sort(key=lambda r: r["time_tag"])
    return {"now_pfu": rows[-1]["flux"] if rows else None, "max24_pfu": max((r["flux"] for r in rows), default=None),
            "time": rows[-1]["time_tag"] if rows else None}


def _xray_flares():
    out = []
    for f in _get(f"{SWPC}/json/goes/primary/xray-flares-7-day.json"):
        c = f.get("max_class") or ""
        if c[:1] in ("M", "X"):
            out.append({"peak": f.get("max_time"), "class": c})
    return out


def _regions():
    rows = _get(f"{SWPC}/json/solar_regions.json")
    if not rows:
        return []
    last = max(r["observed_date"] for r in rows)
    return [{"region": r["region"], "location": r["location"], "lat": r["latitude"], "lon": r["longitude"],
             "m_prob": r.get("m_flare_probability"), "x_prob": r.get("x_flare_probability"),
             "proton_prob": r.get("proton_probability"), "spot_class": r.get("spot_class")}
            for r in rows if r["observed_date"] == last and r.get("location")]


def _forecast():
    rows = _get(f"{SWPC}/json/solar_probabilities.json")
    if not rows:
        return None
    r = max(rows, key=lambda r: r["date"])
    return {"date": r["date"], "m_1day": r.get("m_class_1_day"), "x_1day": r.get("x_class_1_day"),
            "protons_1day": r.get("10mev_protons_1_day"), "protons_3day": r.get("10mev_protons_3_day")}


SOURCES = {"donki": _donki, "protons": _protons, "xray_flares": _xray_flares, "regions": _regions, "forecast": _forecast}


def status() -> dict:
    with _lock:
        if _cache["data"] and time.time() - _cache["t"] < TTL:
            return _cache["data"]
    def run(item):
        name, fn = item
        try:
            return name, fn(), None
        except Exception as e:  # one source down shouldn't sink the rest
            return name, None, f"{type(e).__name__}"
    with ThreadPoolExecutor(len(SOURCES)) as ex:
        results = list(ex.map(run, SOURCES.items()))
    data = {name: value for name, value, _ in results}
    data["unavailable"] = [name for name, _, err in results if err]
    data["fetched"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with _lock:
        # keep a failed fetch for 3 minutes only, so a source coming back shows up soon
        _cache["data"], _cache["t"] = data, time.time() - (TTL - 180 if data["unavailable"] else 0)
    return data
