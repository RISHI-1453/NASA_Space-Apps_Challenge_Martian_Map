"""Build data/jezero_geology.json: the USGS 1:75,000 geologic map of Jezero crater and Nili Planum
(SIM 3464, Sun & Stack 2020), from the USGS-NASA Planetary Geologic Mapping Program's feature service.
Run from the martian-map folder:

    .venv\\Scripts\\python scripts\\build_jezero_geology.py

Writes every geologic-unit polygon (simplified to ~10 m, far below the map's 1:75k detail) in Mars 2000
latitude/longitude, plus each unit's symbol, name, description, interpretation and official map colour.
"""
import json
from pathlib import Path

import httpx

SERVICE = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer"
UNITS = f"{SERVICE}/8"   # Geologic Units (polygons)
OUT = Path(__file__).resolve().parent.parent / "data" / "jezero_geology.json"
MARS_GCS = 104905        # GCS Mars 2000: plain planetocentric degrees, like the rest of the app
SIMPLIFY_M = 10          # in the service's native metres (a transverse Mercator about 77.5°E)

client = httpx.Client(timeout=120, headers={"User-Agent": "MartianMap/1.0 (NASA Space Apps)"})


def get(url: str, **params) -> dict:
    r = client.get(url, params={"f": "json", **params})
    r.raise_for_status()
    d = r.json()
    if "error" in d:
        raise RuntimeError(d["error"])
    return d


def main() -> None:
    renderer = get(UNITS)["drawingInfo"]["renderer"]
    colour = {u["value"]: "#{:02x}{:02x}{:02x}".format(*u["symbol"]["color"][:3]) for u in renderer["uniqueValueInfos"]}
    units, shapes, offset = {}, [], 0
    while True:
        d = get(f"{UNITS}/query", where="1=1", outFields="unit,name,symbol,Unit_Description,Unit_Interpretation,Additional_Characteristics",
                returnGeometry="true", outSR=MARS_GCS, maxAllowableOffset=SIMPLIFY_M / 59000, geometryPrecision=5,
                resultOffset=offset, resultRecordCount=1000, orderByFields="OBJECTID")
        for f in d["features"]:
            a, rings = f["attributes"], f.get("geometry", {}).get("rings") or []
            code = a["unit"]
            units.setdefault(code, {"symbol": a["symbol"], "name": a["name"], "colour": colour.get(code, "#999999"),
                                    "description": a["Unit_Description"], "interpretation": a["Unit_Interpretation"],
                                    "notes": a["Additional_Characteristics"]})
            rings = [[[round(x, 5), round(y, 5)] for x, y in ring] for ring in rings if len(ring) >= 4]
            if rings:
                shapes.append([code, rings])
        offset += len(d["features"])
        if not d.get("exceededTransferLimit") or not d["features"]:
            break
    out = {"source": "USGS SIM 3464: Geologic map of Jezero crater and the Nili Planum region, Mars (Sun & Stack 2020), 1:75,000",
           "url": "https://doi.org/10.3133/sim3464", "units": units, "shapes": shapes}
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{len(shapes)} polygons, {len(units)} units, {OUT.stat().st_size / 1e6:.2f} MB -> {OUT}")


if __name__ == "__main__":
    main()
