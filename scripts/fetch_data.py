"""Download the elevation data the Martian Map needs (run from the martian-map folder):

    .venv\\Scripts\\python scripts\\fetch_data.py

1. MGS MOLA MEGDR global grid, 16 px/deg (~3.7 km/px), 33 MB    - NASA PDS Geosciences
2. Jezero crater CTX DTM, 20 m/px, 9.7 MB (Mars 2020 landing TRN) - USGS Astrogeology
"""
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parent.parent / "data"
FILES = [
    ("https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img",
     "mola_megdr_16ppd.img", 5760 * 2880 * 2),
    ("https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif",
     "jezero_ctx_dtm_20m.tif", 9662387),
]

for url, name, size in FILES:
    out = DATA / name
    if out.exists() and out.stat().st_size == size:
        print("ok      ", name)
        continue
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".part")
    print("download", name, f"({size / 1e6:.1f} MB) ...")
    with httpx.stream("GET", url, timeout=600, follow_redirects=True) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    if tmp.stat().st_size != size:
        raise SystemExit(f"{name}: incomplete download")
    tmp.replace(out)
    print("saved   ", out)
