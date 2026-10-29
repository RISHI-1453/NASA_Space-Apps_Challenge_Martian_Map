"""Map imagery for the 3D globe (and the map's close-ups), made small enough for slow connections.

The sharpest layers — the global 5 m CTX mosaic (Caltech Murray Lab, hosted by Esri) and the HiRISE
mosaics of Jezero and Gale and Jezero's CTX mosaic (NASA Mars Trek) — come as large PNG tiles (50-100 KB each). Each tile is
fetched once, re-encoded as WebP (about 5x smaller, transparency kept), cached on disk and served
with a long browser cache lifetime.

CTX and HiRISE (red filter) are greyscale cameras, so up close Mars would look grey. The "_c"
variant of each layer puts the colour back: the detail (brightness) comes from the greyscale tile,
and the colour is Martian dust's butterscotch, made stronger or weaker by how red the Viking
orbiters' colour mosaic is at that spot (pan-sharpening, the usual way to colour a sharp
black-and-white image with a coarser colour one). So dusty plains come out butterscotch and dark
basaltic sand a duller grey-brown, the way Viking saw them.
"""
from __future__ import annotations

import io
import threading
from collections import OrderedDict
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{{z}}/{{y}}/{{x}}.png"
LAYERS = {
    "ctx": "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}",
    "jez_ctx": TREK.format(layer="JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0"),
    "jez_hirise": TREK.format(layer="JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd"),
    "gale_hirise": TREK.format(layer="curiosity_hirise_mosaic"),
}
MAX_Z = {"ctx": 12, "jez_ctx": 13, "jez_hirise": 17, "gale_hirise": 16}
VIKING = "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg"
VIKING_MAX_Z = 7  # 232 m/px; same geographic tile grid as every layer here (level 0 = two 180° tiles)
# colour of bright Martian dust relative to its brightness (red, green, blue), close to the
# butterscotch that Viking, Pathfinder and the rovers' true-colour images show
DUST = np.array([1.36, 0.94, 0.66], dtype=np.float32)
# brightness of each local mosaic against the global CTX mosaic over the same ground (this = gain * ctx
# + offset): the median ratio over 13-16 matching zoom-12 tiles each; undone before colouring
MATCH: dict[str, tuple[float, float]] = {"jez_hirise": (0.895, 0.0), "jez_ctx": (1.214, 0.0), "gale_hirise": (0.966, 0.0)}
QUALITY = 72
CACHE = Path(__file__).resolve().parent.parent / "data" / "imagery"

_client = httpx.Client(timeout=30, headers={"User-Agent": "MartianMap/1.0 (NASA Space Apps)"},
                       limits=httpx.Limits(max_connections=16, max_keepalive_connections=16))
_viking: OrderedDict[tuple[int, int, int], Image.Image] = OrderedDict()
_viking_lock = threading.Lock()


class Missing(Exception):
    """The source has no tile here (outside its coverage)."""


def _download(url: str) -> bytes:
    for attempt in range(3):
        try:
            r = _client.get(url)
            if r.status_code in (400, 404):
                raise Missing
            r.raise_for_status()
            Image.open(io.BytesIO(r.content)).verify()  # a cut-short download fails here
            return r.content
        except (httpx.TransportError, httpx.HTTPStatusError, OSError):
            if attempt == 2:
                raise


def _save(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")
    part.write_bytes(data)
    part.replace(path)


def _webp(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=QUALITY, method=4)
    return buf.getvalue()


def _grey(layer: str, z: int, x: int, y: int) -> tuple[Path, Image.Image | None]:
    """The original tile's cache file, downloading it first if needed (the image when just downloaded)."""
    path = CACHE / layer / f"{z}_{y}_{x}.webp"
    if path.exists():
        return path, None
    img = Image.open(io.BytesIO(_download(LAYERS[layer].format(z=z, y=y, x=x))))
    img.load()
    _save(path, _webp(img))
    return path, img


def tile(layer: str, z: int, x: int, y: int) -> bytes:
    """The original (greyscale) tile, as WebP."""
    return _grey(layer, z, x, y)[0].read_bytes()


def _viking_tile(z: int, x: int, y: int) -> Image.Image:
    key = (z, x, y)
    with _viking_lock:
        if key in _viking:
            _viking.move_to_end(key)
            return _viking[key]
    path = CACHE / "viking" / f"{z}_{y}_{x}.jpg"
    if path.exists():
        raw = path.read_bytes()
    else:
        raw = _download(VIKING.format(z=z, y=y, x=x))
        _save(path, raw)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    with _viking_lock:
        _viking[key] = img
        while len(_viking) > 96:
            _viking.popitem(last=False)
    return img


def _viking_area(z: int, x: int, y: int, size: int) -> Image.Image:
    """Viking colour for exactly the area of tile (z, x, y), upsampled to size x size."""
    vz = min(z, VIKING_MAX_Z)
    f = 2 ** (z - vz)                       # this tile is 1/f of a Viking tile across
    src = _viking_tile(vz, x // f, y // f)
    w = src.width / f
    x0, y0 = (x % f) * w, (y % f) * w
    return src.transform((size, size), Image.Transform.EXTENT, (x0, y0, x0 + w, y0 + w), Image.Resampling.BILINEAR)


def colour(layer: str, z: int, x: int, y: int) -> bytes:
    """The greyscale tile coloured with Viking's colour of the same ground, as WebP."""
    path = CACHE / f"{layer}_c" / f"{z}_{y}_{x}.webp"
    if path.exists():
        return path.read_bytes()
    src, img = _grey(layer, z, x, y)  # the greyscale view and the colour view share one download
    grey = (img or Image.open(src)).convert("LA")
    size = grey.width
    lum, alpha = grey.split()
    rgb = np.asarray(_viking_area(z, x, y, size), dtype=np.float32)
    # How red the ground is, from Viking (smooth: upsampled 232 m data): red/blue is ~2 on bright
    # dusty plains and ~1 on dark basaltic sand. Viking's dark areas carry a bluish cast that would
    # turn purple once brightened, so the hue is Mars' own and Viking sets how strong it is.
    redness = np.clip((rgb[..., 0] / np.maximum(rgb[..., 2], 1) - 1.0) / 1.0, 0, 1)
    strength = 0.5 + 0.5 * redness
    # each mosaic was stretched differently; bring the local ones to the global CTX's brightness so
    # the HiRISE/CTX footprints don't show as darker rectangles
    gain, offset = MATCH.get(layer, (1.0, 0.0))
    g = np.clip((np.asarray(lum, dtype=np.float32) - offset) / gain, 0, 255)
    g = 255 * (g / 255) ** 1.12   # a touch more contrast than the raw mosaics
    out = np.clip(g[..., None] * (1 + strength[..., None] * (DUST - 1)), 0, 255).astype(np.uint8)
    img = Image.fromarray(out, "RGB")
    img.putalpha(alpha)
    data = _webp(img)
    _save(path, data)
    return data
