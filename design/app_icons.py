#!/usr/bin/env python3
"""The home-screen icons, rendered from the marks the site already has.

Every page pointed `apple-touch-icon` at an SVG, and iOS does not accept SVG
there — "Add to Home Screen" showed a blurred screenshot of the page instead of
the mark. The manifest offered SVG only, and used the same drawing as its
`maskable` icon. Android builds the installed icon from PNGs.

The two marks stay apart, as the identity requires: the company page's
touch icon is the AC monogram, written by design/logo-en/build.py with the
rest of the company's marks; this script draws النوخذة's, the installable
app (manifest.webmanifest), from its anchor, icon.svg.

The touch icons and the maskable icon are FULL-BLEED: iOS and Android launchers
cut their own shape, and a tile with transparent rounded corners gets black
corners on iOS. The two "any" icons (icon-192, icon-512) keep their rounded
transparent corners on purpose; test_suite.py pins that.

Each PNG is stored at its smallest lossless encoding (design/png_store.py).
Chromium's own screenshot encoding had left all four 3 to 7% larger than their
pixels need (7,110 B on every install, since the worker precaches them), and
Pillow's optimiser was not the smallest either.

    python3 design/app_icons.py            # draw the four PNGs
    python3 design/app_icons.py --check    # fail if a committed PNG drifted
"""

import io
import re
import sys
from pathlib import Path

from PIL import Image

from png_store import write_png

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "almuhallab"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"


def anchor(full_bleed):
    """icon.svg itself; full-bleed drops the rounded tile's corner radius. Its
    art already sits inside the maskable safe zone (the centre 80% circle)."""
    svg = (SITE / "icon.svg").read_text()
    if full_bleed:
        svg, n = re.subn(r'(<rect width="512" height="512") rx="\d+"', r"\1", svg)
        if n != 1:
            sys.exit("icon.svg's tile changed shape — check before rendering")
    return svg


JOBS = [  # (file, svg, size)
    ("nokhatha-touch-icon.png", anchor(True), 180),
    ("icon-192.png", anchor(False), 192),
    ("icon-512.png", anchor(False), 512),
    ("icon-maskable-512.png", anchor(True), 512),
]


def render(page, svg, size):
    """One icon drawn by Chromium at its size, as RGBA pixels."""
    page.set_viewport_size({"width": size, "height": size})
    sized = svg.replace("<svg ", f'<svg width="{size}" height="{size}" style="display:block" ', 1)
    page.set_content(f'<body style="margin:0">{sized}</body>')
    im = Image.open(io.BytesIO(page.screenshot(omit_background=True)))
    im.load()
    return im   # the screenshot's own mode: full-bleed icons are RGB, the rounded ones RGBA


def differs(a, b):
    """The pixels where two renders differ by more than 2 levels in any channel,
    compared premultiplied, as logo-en/build.py does: a different Chromium build
    passes and a hand edit does not. None when they match."""
    from PIL import ImageChops
    if a.size != b.size:
        return f"{a.size} vs {b.size}"
    a, b = a.convert("RGBa"), b.convert("RGBa")
    return ImageChops.difference(a, b).point(lambda v: 255 if v > 2 else 0).getbbox(alpha_only=False)


def main():
    from playwright.sync_api import sync_playwright
    checking = "--check" in sys.argv
    stale = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME)
        page = b.new_page()
        for name, svg, size in JOBS:
            im = render(page, svg, size)
            if checking:
                path = SITE / name
                bad = differs(im, Image.open(path)) if path.exists() else "missing"
                if bad:
                    stale.append(f"{name} ({bad})")
                continue
            n = write_png(im, SITE / name)
            print(f"  {name}  {size}×{size}  {n} B")
        b.close()
    if checking:
        if stale:
            sys.exit("installed-app icons drifted from icon.svg: " + ", ".join(stale))
        print(f"installed-app icons are current: {len(JOBS)} PNGs drawn from icon.svg")


if __name__ == "__main__":
    main()
