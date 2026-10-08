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

All of it is FULL-BLEED: iOS and Android launchers cut their own shape, and a
tile with transparent rounded corners gets black corners on iOS.

Each PNG is stored through Pillow's optimiser: Chromium's own screenshot
encoding left all four 3 to 7% larger than their pixels need (7,110 B on
every install, since the worker precaches them), and the suite fails a
shipped PNG that a lossless re-save would shrink.

    python3 design/app_icons.py
"""

import io
import re
import sys
from pathlib import Path

from PIL import Image

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


def main():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME)
        page = b.new_page()
        for name, svg, size in JOBS:
            page.set_viewport_size({"width": size, "height": size})
            sized = svg.replace("<svg ", f'<svg width="{size}" height="{size}" style="display:block" ', 1)
            page.set_content(f'<body style="margin:0">{sized}</body>')
            im = Image.open(io.BytesIO(page.screenshot(omit_background=True)))
            im.load()
            im.save(SITE / name, "PNG", optimize=True)   # same pixels, fewer bytes
            print(f"  {name}  {size}×{size}  {(SITE / name).stat().st_size} B")
        b.close()


if __name__ == "__main__":
    main()
