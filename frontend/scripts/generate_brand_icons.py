#!/usr/bin/env python3
"""Regenerate PWA / home-screen icons from public/logo.png.

Goals:
  - Fully transparent canvas (no baked black/white plate)
  - Mark kept well inside circular / squircle launcher masks
  - Filenames are versioned (gt-*) so phones cannot keep a stale icon URL
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SOURCE = PUBLIC / "logo.png"

# Max content size as a fraction of the canvas edge.
# ~0.50 keeps diamond points inside an inscribed circular mask.
ANY_SCALE = 0.50
APPLE_SCALE = 0.50

# Legacy names we no longer ship (delete so stale dist copies vanish).
LEGACY_ICON_NAMES = [
    "icon-192.png",
    "icon-512.png",
    "icon-192-maskable.png",
    "icon-512-maskable.png",
    "apple-touch-icon.png",
    "favicon-64.png",
]


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


ADMIN_BG = (28, 22, 12, 255)
ADMIN_BORDER = (201, 162, 39, 255)
ADMIN_BAR = (201, 162, 39, 255)
ADMIN_MARK = (26, 21, 8, 255)


def fit_on_admin_canvas(content: Image.Image, size: int, scale: float) -> Image.Image:
    """Opaque dark-gold plate so iOS home-screen can tell admin apart from client."""
    canvas = Image.new("RGBA", (size, size), ADMIN_BG)
    draw = ImageDraw.Draw(canvas)
    border = max(3, size // 28)
    inset = border // 2
    draw.rounded_rectangle(
        [inset, inset, size - 1 - inset, size - 1 - inset],
        radius=max(16, size // 6),
        outline=ADMIN_BORDER,
        width=border,
    )

    bar_h = max(22, size // 5)
    draw.rectangle([0, size - bar_h, size, size], fill=ADMIN_BAR)
    # Three short bars = "panel" mark (readable at 180px without a font).
    mark_w = max(8, size // 8)
    mark_h = max(3, size // 36)
    gap = max(3, size // 32)
    total_h = mark_h * 3 + gap * 2
    x0 = (size - mark_w * 3) // 2
    y0 = size - bar_h + (bar_h - total_h) // 2
    for i in range(3):
        y = y0 + i * (mark_h + gap)
        draw.rounded_rectangle([x0, y, x0 + mark_w * 3, y + mark_h], radius=mark_h // 2, fill=ADMIN_MARK)

    max_edge = max(1, int(size * scale))
    cw, ch = content.size
    ratio = min(max_edge / cw, max_edge / ch)
    nw = max(1, int(round(cw * ratio)))
    nh = max(1, int(round(ch * ratio)))
    resized = content.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (size - nw) // 2
    y = (size - bar_h - nh) // 2
    canvas.paste(resized, (x, max(border + 2, y)), resized)
    return canvas


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
        ("gt-favicon-64.png", 64, ANY_SCALE),
        ("gt-icon-192.png", 192, ANY_SCALE),
        ("gt-icon-512.png", 512, ANY_SCALE),
        ("gt-apple-touch-icon.png", 180, APPLE_SCALE),
    ]
    for name, size, scale in specs:
        save(fit_on_canvas(content, size, scale), PUBLIC / name)

    admin_specs = [
        ("gt-admin-icon-192.png", 192, 0.46),
        ("gt-admin-apple-touch-icon.png", 180, 0.46),
    ]
    for name, size, scale in admin_specs:
        save(fit_on_admin_canvas(content, size, scale), PUBLIC / name)

    # Keep logo.png as the in-app artwork, but normalize transparent pixels.
    logo = clean_alpha(Image.open(SOURCE))
    save(logo, PUBLIC / "logo.png")

    for name in LEGACY_ICON_NAMES:
        legacy = PUBLIC / name
        if legacy.exists():
            legacy.unlink()
            print(f"removed legacy {name}")

    print("brand icons regenerated")


if __name__ == "__main__":
    main()
