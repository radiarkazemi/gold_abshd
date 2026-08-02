#!/usr/bin/env python3
"""Regenerate PWA / home-screen icons from public/logo.png.

Goals:
  - Fully transparent canvas (no baked black/white plate)
  - `any` icons padded so the mark fits launcher grids without clipping
  - `maskable` icons keep the mark inside the Android safe zone (~80%)
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SOURCE = PUBLIC / "logo.png"

# Max content size as a fraction of the canvas edge.
ANY_SCALE = 0.70          # comfortable grid fit for circles / squcircles
MASKABLE_SCALE = 0.52     # well inside the 80% maskable safe zone
APPLE_SCALE = 0.68


def clean_alpha(im: Image.Image) -> Image.Image:
    """Force fully-transparent pixels to (0,0,0,0) to avoid black-plate bugs."""
    arr = np.array(im.convert("RGBA"))
    transparent = arr[:, :, 3] == 0
    arr[transparent] = (0, 0, 0, 0)
    return Image.fromarray(arr, "RGBA")


def content_layer(im: Image.Image) -> Image.Image:
    """Crop to visible alpha bounds (keep a tiny soft fringe)."""
    im = clean_alpha(im)
    bbox = im.getbbox()
    if not bbox:
        return im
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - 2)
    y0 = max(0, y0 - 2)
    x1 = min(im.width, x1 + 2)
    y1 = min(im.height, y1 + 2)
    return im.crop((x0, y0, x1, y1))


def fit_on_canvas(content: Image.Image, size: int, scale: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    max_edge = max(1, int(size * scale))
    cw, ch = content.size
    ratio = min(max_edge / cw, max_edge / ch)
    nw = max(1, int(round(cw * ratio)))
    nh = max(1, int(round(ch * ratio)))
    resized = content.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (size - nw) // 2
    y = (size - nh) // 2
    canvas.paste(resized, (x, y), resized)
    return clean_alpha(canvas)


def save(im: Image.Image, path: Path) -> None:
    im.save(path, format="PNG", optimize=True)
    print(f"wrote {path.name} ({im.size[0]}x{im.size[1]})")


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"missing source logo: {SOURCE}")
    content = content_layer(Image.open(SOURCE))

    specs = [
        ("favicon-64.png", 64, ANY_SCALE),
        ("icon-192.png", 192, ANY_SCALE),
        ("icon-512.png", 512, ANY_SCALE),
        ("icon-192-maskable.png", 192, MASKABLE_SCALE),
        ("icon-512-maskable.png", 512, MASKABLE_SCALE),
        ("apple-touch-icon.png", 180, APPLE_SCALE),
    ]
    for name, size, scale in specs:
        save(fit_on_canvas(content, size, scale), PUBLIC / name)

    # Keep logo.png as the in-app artwork, but normalize transparent pixels.
    logo = clean_alpha(Image.open(SOURCE))
    save(logo, PUBLIC / "logo.png")
    print("brand icons regenerated")


if __name__ == "__main__":
    main()
