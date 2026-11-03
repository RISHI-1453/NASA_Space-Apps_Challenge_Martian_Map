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
from PIL import Image, ImageFile

# a few of the source's tiles are cut short at the source itself (the same bytes on every download):
# decode the rows that are there rather than failing the whole tile — see _decode
ImageFile.LOAD_TRUNCATED_IMAGES = True

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
        except (httpx.TransportError, httpx.HTTPStatusError):
            if attempt == 2:
                raise
            continue
        try:
            Image.open(io.BytesIO(r.content)).verify()  # a cut-short download fails here...
            return r.content
        except (OSError, SyntaxError):  # (PIL reports a bad PNG checksum as SyntaxError)
            if attempt == 2:  # ...but the same bytes three times means the source tile itself is short:
                Image.open(io.BytesIO(r.content))  # if it's an image at all, use the rows it has (_decode)
                return r.content


def _save(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")
    part.write_bytes(data)
    part.replace(path)


def _webp(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=QUALITY, method=4)
    return buf.getvalue()


def _decode(data: bytes) -> tuple[Image.Image, bool]:
    """A downloaded tile as an image, and whether it was broken. A truncated greyscale tile decodes
    with its missing rows black; those rows become transparent (and a corrupt tile entirely so)."""
    img = Image.open(io.BytesIO(data))
    try:
        img.load()
    except (OSError, SyntaxError):  # corrupt, not just short (a bad checksum)
        return Image.new("LA", img.size, (0, 0)), True
    if img.mode != "L":
        return img, False
    a = np.asarray(img)
    rows = np.flatnonzero(a.max(axis=1) > 0)
    last = rows[-1] + 1 if rows.size else 0
    if last == a.shape[0]:
        return img, False
    alpha = np.full(a.shape, 255, np.uint8)
    alpha[last:] = 0
    out = img.convert("LA")
    out.putalpha(Image.fromarray(alpha, "L"))
    return out, True


def _patch(layer: str, z: int, x: int, y: int, img: Image.Image) -> Image.Image:
    """Fill a broken tile's missing rows from the tile above it: the same ground at half the detail
    (and whatever is still missing stays transparent, so the map underneath shows)."""
    if z == 0:
        return img
    a = np.asarray(img)
    hole = a[..., 1] == 0
    try:
        ppath, pimg = _grey(layer, z - 1, x // 2, y // 2)
        parent = (pimg or Image.open(ppath)).convert("LA")
    except Exception:
        return img
    s = parent.width // 2
    quad = parent.crop(((x % 2) * s, (y % 2) * s, (x % 2 + 1) * s, (y % 2 + 1) * s)).resize(img.size, Image.Resampling.BILINEAR)
    out = a.copy()
    out[hole] = np.asarray(quad)[hole]
    return Image.fromarray(out, "LA")


def _grey(layer: str, z: int, x: int, y: int) -> tuple[Path, Image.Image | None]:
    """The original tile's cache file, downloading it first if needed (the image when just downloaded)."""
    path = CACHE / layer / f"{z}_{y}_{x}.webp"
    if path.exists():
        return path, None
    img, broken = _decode(_download(LAYERS[layer].format(z=z, y=y, x=x)))
    if broken:
        img = _patch(layer, z, x, y, img)
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
