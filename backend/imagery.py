"""Map imagery for the 3D globe, made small enough for slow connections.

The sharpest layers — the global 5 m CTX mosaic (Caltech Murray Lab, hosted by Esri) and Jezero's
HiRISE and CTX mosaics (NASA Mars Trek) — come as large PNG tiles (50-100 KB each). Each tile is
fetched once, re-encoded as WebP (about 5x smaller, transparency kept), cached on disk and served
with a long browser cache lifetime.
"""
from __future__ import annotations

import io
from pathlib import Path

import httpx
from PIL import Image

TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{{z}}/{{y}}/{{x}}.png"
LAYERS = {
    "ctx": "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}",
    "jez_ctx": TREK.format(layer="JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0"),
    "jez_hirise": TREK.format(layer="JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd"),
}
MAX_Z = {"ctx": 12, "jez_ctx": 13, "jez_hirise": 17}
QUALITY = 72
CACHE = Path(__file__).resolve().parent.parent / "data" / "imagery"

_client = httpx.Client(timeout=30, headers={"User-Agent": "MartianMap/1.0 (NASA Space Apps)"},
                       limits=httpx.Limits(max_connections=16, max_keepalive_connections=16))


class Missing(Exception):
    """The source has no tile here (outside its coverage)."""


def tile(layer: str, z: int, x: int, y: int) -> bytes:
    path = CACHE / layer / f"{z}_{y}_{x}.webp"
    if path.exists():
        return path.read_bytes()
    url = LAYERS[layer].format(z=z, y=y, x=x)
    for attempt in range(3):
        try:
            r = _client.get(url)
            if r.status_code in (400, 404):
                raise Missing
            r.raise_for_status()
            img = Image.open(io.BytesIO(r.content))
            img.load()
            break
        except (httpx.TransportError, httpx.HTTPStatusError, OSError):  # a dropped or cut-short download
            if attempt == 2:
                raise
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=QUALITY, method=4)
    data = buf.getvalue()
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")
    part.write_bytes(data)
    part.replace(path)
    return data
