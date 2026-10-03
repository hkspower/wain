#!/usr/bin/env python3
"""The home-screen icons, rendered from the marks the site already has.

Every page pointed `apple-touch-icon` at an SVG, and iOS does not accept SVG
there — "Add to Home Screen" showed a blurred screenshot of the page instead of
the mark. The manifest offered SVG only, and used the same drawing as its
`maskable` icon. Android builds the installed icon from PNGs.

The two marks stay apart, as the identity requires:
  * the company page (index.html) gets the illustrated boum — favicon.svg;
  * النوخذة, the installable app (manifest.webmanifest), keeps the ⚓ — icon.svg.

All of it is FULL-BLEED: iOS and Android launchers cut their own shape, and a
tile with transparent rounded corners gets black corners on iOS.

    python3 design/app_icons.py
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pixel_boum as pb  # noqa: E402  the one bitmap of the square mark

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "almuhallab"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
BROWN = "#25292f"


def boum_touch():
    """180×180: the illustrated boum on the brand brown — favicon.svg's own tile,
    drawn full-bleed (iOS cuts its own shape)."""
    svg = (SITE / "favicon.svg").read_text()
    return svg.replace('rx="96" ', "", 1)


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
    ("apple-touch-icon.png", boum_touch(), 180),
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
            page.screenshot(path=str(SITE / name), omit_background=True)
            print(f"  {name}  {size}×{size}")
        b.close()


if __name__ == "__main__":
    main()
