#!/usr/bin/env python3
"""Draw النوخذة's macOS app icon set from the product's own mark.

macOS wants an `.appiconset`: every size at 1x and 2x, plus a Contents.json
naming them. Apple's own tooling turns that into the `.icns` at build time, so
this writes the set and the build does the rest.

The mark is `almuhallab/icon.svg` — the anchor. النوخذة and المهلب are marked
differently on purpose; the company's boum belongs on the company's surfaces.

    python3 design/macos_icon.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "almuhallab"
OUT = ROOT / "nokhatha_app" / "macos" / "AppIcon.appiconset"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

# Apple asks for each of these at 1x and 2x. 16@2x and 32@1x are both 32px of
# pixels but different files: the OS picks by role, not only by size.
SPECS = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2),
         (256, 1), (256, 2), (512, 1), (512, 2)]


def mark() -> str:
    svg = (SITE / "icon.svg").read_text(encoding="utf-8")
    if "circle" not in svg:
        sys.exit("icon.svg does not look like the anchor — did the mark move?")
    return svg


def render(px: int) -> bytes:
    from playwright.sync_api import sync_playwright
    page = (f'<!doctype html><html><body style="margin:0">'
            f'<div style="width:{px}px;height:{px}px">{mark()}</div></body></html>')
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME)
        pg = b.new_page(viewport={"width": px, "height": px}, device_scale_factor=1)
        pg.set_content(page)
        pg.wait_for_timeout(200)
        shot = pg.screenshot(omit_background=True)
        b.close()
    return shot


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    images = []
    for base, scale in SPECS:
        px = base * scale
        name = f"app_icon_{base}{'@2x' if scale == 2 else ''}.png"
        (OUT / name).write_bytes(render(px))
        images.append({"size": f"{base}x{base}", "idiom": "mac",
                       "filename": name, "scale": f"{scale}x"})
    (OUT / "Contents.json").write_text(json.dumps(
        {"images": images, "info": {"version": 1, "author": "design/macos_icon.py"}},
        indent=2) + "\n")
    print(f"{OUT.relative_to(ROOT)} — {len(images)} sizes + Contents.json")


if __name__ == "__main__":
    main()
