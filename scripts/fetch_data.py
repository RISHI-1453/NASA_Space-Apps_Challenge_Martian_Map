"""Download the elevation data the Martian Map needs (run from the martian-map folder):

    .venv\\Scripts\\python scripts\\fetch_data.py

1. MGS MOLA MEGDR global grid, 16 px/deg (~3.7 km/px), 33 MB    - NASA PDS Geosciences
2. Jezero crater CTX DTM, 20 m/px, 9.7 MB (Mars 2020 landing TRN) - USGS Astrogeology
3. Gale crater / lower Mount Sharp, Curiosity's whole traverse: the MRO HiRISE 1 m DEM that Mars Trek
   serves, exported at 20 m/px, 16 MB - NASA Mars Trek
"""
from pathlib import Path

import httpx

DATA = Path(__file__).resolve().parent.parent / "data"
GALE = ("https://trek.nasa.gov/mars/trekarcgis/rest/services/Gale_DEM_SMG_1m/ImageServer/exportImage"
        "?bbox=137.12247113204074,-4.925474311955841,137.72981290693286,-4.248963057145466&bboxSR=104905"
        "&imageSR=104905&size=1800,2005&format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image")
FILES = [  # (url, file, exact size in bytes, or a minimum for files generated on request)
    ("https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img",
     "mola_megdr_16ppd.img", 5760 * 2880 * 2),
    ("https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif",
     "jezero_ctx_dtm_20m.tif", 9662387),
    (GALE, "gale_hirise_dtm_20m.tif", -14_000_000),
]

for url, name, size in FILES:
    out = DATA / name
    complete = lambda n: n == size if size > 0 else n >= -size
    if out.exists() and complete(out.stat().st_size):
        print("ok      ", name)
        continue
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".part")
    print("download", name, f"({abs(size) / 1e6:.0f} MB) ...")
    with httpx.stream("GET", url, timeout=600, follow_redirects=True) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    if not complete(tmp.stat().st_size):
        raise SystemExit(f"{name}: incomplete download")
    tmp.replace(out)
    print("saved   ", out)
