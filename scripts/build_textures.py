"""Build the globe textures used by the intro animation (run from the martian-map folder):

    .venv\\Scripts\\pip install pillow
    .venv\\Scripts\\python scripts\\build_textures.py

- Mars:  Viking MDIM 2.1 color mosaic, stitched from NASA Mars Trek WMTS tiles (zoom 2 = 8x4 tiles)
- Earth: NASA Visible Earth "Blue Marble" land + shallow water + topography, 2048x1024

Both are equirectangular, longitude -180 at the left edge. The JPEGs are small and committed,
so deployments don't need Pillow or this script.
"""
import io
from pathlib import Path

import httpx
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "frontend" / "textures"
TREK = ("https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/"
        "1.0.0/default/default028mm/{z}/{y}/{x}.jpg")
EARTH = "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg"


def mars(z: int = 2) -> None:
    cols, rows = 2 ** (z + 1), 2 ** z
    img = Image.new("RGB", (cols * 256, rows * 256))
    with httpx.Client(timeout=60) as c:
        for y in range(rows):
            for x in range(cols):
                r = c.get(TREK.format(z=z, y=y, x=x))
                r.raise_for_status()
                img.paste(Image.open(io.BytesIO(r.content)).convert("RGB"), (x * 256, y * 256))
    img.save(OUT / "mars.jpg", quality=86, optimize=True)
    print("mars.jpg", img.size)


def earth() -> None:
    r = httpx.get(EARTH, timeout=120, follow_redirects=True)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content)).convert("RGB").resize((2048, 1024), Image.LANCZOS)
    img.save(OUT / "earth.jpg", quality=86, optimize=True)
    print("earth.jpg", img.size)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    mars()
    earth()
