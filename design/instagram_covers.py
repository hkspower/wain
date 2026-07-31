#!/usr/bin/env python3
"""Instagram highlight covers for المهلب — Almuhallab Code.

Instagram crops a highlight cover to a circle and shows it about 64px wide on a
white profile. Two consequences drive every choice here:

  * A white cover would dissolve into Instagram's white page — the ring would be
    all you saw. So the covers are filled with the brand brown (--tint-strong)
    and the mark is white, which is exactly the treatment the site's masthead
    now uses. The brand stays brown-on-white everywhere else.
  * At 64px there is room for one shape and nothing else. No wordmarks, no
    Arabic labels inside the circle — Instagram already prints the title
    beneath it. One drawn icon, centred, large.

The icons are lifted verbatim from the site's own <symbol> sprite rather than
redrawn, so a cover cannot drift from the interface it represents. Run this
after changing the sprite and the covers follow.

Output: design/instagram/<name>.svg (source) and .png (1080×1080, what you
upload), plus contact-sheet.png to review the set as a whole.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPRITE_SRC = ROOT / "almuhallab" / "index.html"
OUT = ROOT / "design" / "instagram"

# Brand ink, identical to the site's tokens.
BROWN = "#6f3f1c"          # --tint-strong, the masthead fill

SIZE = 1080                # Instagram's cover upload size
ICON = 500                 # icon box, ~46% — comfortably inside the circle crop

# One cover per thing the company actually does or runs. The title under the
# circle is set in Instagram itself; these names are the file names.
COVERS = [
    ("about",      "i-sail",       "من نحن"),
    ("services",   "i-blocks",     "خدماتنا"),
    ("web",        "i-globe",      "المواقع"),
    ("apps",       "i-phone",      "التطبيقات"),
    ("software",   "i-briefcase",  "برمجيات مخصّصة"),
    ("ai",         "i-ai",         "الذكاء الاصطناعي"),
    ("automation", "i-automation", "الأتمتة"),
    ("design",     "i-pen",        "التصميم"),
    ("cloud",      "i-cloud",      "السحابة"),
    ("nokhatha",   "i-anchor",     "النوخذة"),
    ("xbrl",       "i-report",     "الميزانية السنوية"),
    ("contact",    "i-whatsapp",   "تواصل"),
]


def sprite_symbols(html: str) -> dict:
    """Pull every <symbol> body out of the page sprite, keyed by id."""
    found = {}
    for m in re.finditer(r'<symbol id="([a-z-]+)" viewBox="([^"]+)">(.*?)</symbol>', html, re.S):
        found[m.group(1)] = (m.group(2), m.group(3))
    return found


def cover_svg(view_box: str, body: str) -> str:
    """Full-bleed brown square, the mark centred in white.

    The brown fills the whole square rather than a drawn disc: Instagram crops
    to its own circle, and a disc of mine would only have to line up with it
    exactly — any mismatch shows as a pale rim. Filling the square makes the
    crop unable to go wrong. Nothing decorative sits inside either; a cover is
    read at about 64px, where a hairline ring is invisible and the title is
    already printed underneath by Instagram.
    """
    off = (SIZE - ICON) / 2
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}"
     viewBox="0 0 {SIZE} {SIZE}" role="img">
  <rect width="{SIZE}" height="{SIZE}" fill="{BROWN}"/>
  <svg x="{off}" y="{off}" width="{ICON}" height="{ICON}" viewBox="{view_box}"
       fill="none" stroke="#ffffff" stroke-width="1.7"
       stroke-linecap="round" stroke-linejoin="round" color="#ffffff">
    {body}
  </svg>
</svg>
"""


def main() -> int:
    html = SPRITE_SRC.read_text()
    symbols = sprite_symbols(html)
    missing = [sid for _, sid, _ in COVERS if sid not in symbols]
    if missing:
        print("sprite is missing:", ", ".join(missing))
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    written = []
    for name, sid, title in COVERS:
        view_box, body = symbols[sid]
        svg = cover_svg(view_box, body)
        (OUT / f"{name}.svg").write_text(svg)
        written.append((name, title))

    # Render to PNG through the same Chromium the rest of design/ uses. SVG in,
    # PNG out — no converter dependency, and what you see is what a browser
    # draws, which is what Instagram will receive.
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright missing — SVGs written, PNGs skipped")
        return 0

    chrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
    with sync_playwright() as pw:
        br = pw.chromium.launch(executable_path=chrome)
        pg = br.new_context(viewport={"width": SIZE, "height": SIZE},
                            device_scale_factor=1).new_page()
        for name, _ in written:
            pg.goto((OUT / f"{name}.svg").as_uri())
            pg.wait_for_timeout(120)
            pg.screenshot(path=str(OUT / f"{name}.png"))

        # A contact sheet, drawn the way Instagram shows them: circles in a row
        # on white, at the size a visitor actually sees them.
        cells = "".join(
            f'<figure><img src="{n}.png" alt=""><figcaption>{t}</figcaption></figure>'
            for n, t in written)
        sheet = OUT / "_sheet.html"
        sheet.write_text(f"""<!doctype html><meta charset="utf-8">
<style>
  body {{ margin: 0; background: #fff; font: 13px/1.5 system-ui, sans-serif;
         color: #1b2430; padding: 28px; direction: rtl; }}
  .row {{ display: flex; flex-wrap: wrap; gap: 22px 18px; }}
  figure {{ margin: 0; width: 88px; text-align: center; }}
  img {{ width: 76px; height: 76px; border-radius: 50%; display: block;
        margin: 0 auto 6px; }}
  figcaption {{ font-size: 11px; color: #586981; }}
  h1 {{ font-size: 15px; margin: 0 0 18px; }}
</style>
<h1>أبرز الحسابات — المهلب</h1>
<div class="row">{cells}</div>
""")
        pg.set_viewport_size({"width": 760, "height": 420})
        pg.goto(sheet.as_uri())
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(OUT / "contact-sheet.png"), full_page=True)
        sheet.unlink()
        br.close()

    print(f"{len(written)} covers -> {OUT}  ({SIZE}×{SIZE} PNG + SVG source)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
