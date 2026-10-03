"""Build data/mars_features.json from the official IAU Mars nomenclature (USGS Gazetteer of
Planetary Nomenclature). Run from the martian-map folder:

    .venv\\Scripts\\python scripts\\build_features.py

Output rows: [name, type, lat, lon_east(-180..180), diameter_km]. The JSON is small (~150 KB)
and committed, so deployments don't need to run this.
"""
import io
import json
import struct
import zipfile
from pathlib import Path

import httpx

URL = "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.zip"
OUT = Path(__file__).resolve().parent.parent / "data" / "mars_features.json"


def read_dbf(raw: bytes) -> list[dict]:
    n, hlen, rlen = struct.unpack("<IHH", raw[4:12])
    fields = []
    for i in range(32, hlen - 1, 32):
        f = raw[i:i + 32]
        fields.append((f[:11].split(b"\0")[0].decode(), f[16]))
    rows = []
    for k in range(n):
        r = raw[hlen + k * rlen: hlen + (k + 1) * rlen]
        if r[:1] == b"*":  # deleted record
            continue
        p, row = 1, {}
        for name, ln in fields:
            row[name] = r[p:p + ln].decode("utf-8", "replace").strip()
            p += ln
        rows.append(row)
    return rows


def main():
    z = zipfile.ZipFile(io.BytesIO(httpx.get(URL, timeout=300, follow_redirects=True).content))
    dbf = next(n for n in z.namelist() if n.lower().endswith(".dbf"))
    out = []
    for r in read_dbf(z.read(dbf)):
        if "Adopted" not in r.get("approval", ""):
            continue
        lon = float(r["center_lon"])
        lon = lon - 360 if lon > 180 else lon
        ftype = r["type"].split(",")[0].strip()  # "Crater, craters" -> "Crater"
        out.append([r["clean_name"] or r["name"], ftype, round(float(r["center_lat"]), 4),
                    round(lon, 4), round(float(r["diameter"] or 0), 1)])
    out.sort(key=lambda x: -x[4])  # biggest first: better default search ranking
    OUT.write_text(json.dumps({
        "source": "IAU/USGS Gazetteer of Planetary Nomenclature (Mars)",
        "columns": ["name", "type", "lat", "lon_east", "diameter_km"],
        "features": out,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} features -> {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
