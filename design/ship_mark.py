#!/usr/bin/env python3
"""The company mark: the Almuhallab boum as a flat illustration.

Approved by the owner 2026-10-03 («approve all» — logo only, the brown bar
kept), replacing the pixel boum in the masthead, the footer, the favicon,
logo.svg and the share card. One drawing: design/logo-modern/build.py draws
her over the BOUM polygons in design/matrix_logo.py; this writes that drawing
everywhere the site flies it, and `--check` fails on any hand edit.

  * #i-ship in index.html's sprite — inks are currentColor (the second sail at
    .78, the waterline at .45) and the cut lines take var(--ship-cut), the
    colour of whatever she sits on, so one symbol serves the brown bar, the
    brown footer tile and the grey footer base;
  * logo.svg — white on the brand brown, her own ground;
  * favicon.svg — white on a brown rounded square.

    python3 design/ship_mark.py           # write
    python3 design/ship_mark.py --check   # exit 1 on drift
"""
import importlib.util
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITE = HERE.parent / "almuhallab"
PAGE = SITE / "index.html"
BROWN, WHITE = "#6f3f1c", "#ffffff"

_spec = importlib.util.spec_from_file_location("logo_modern", HERE / "logo-modern" / "build.py")
lm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lm)


def _drawing():
    svg = lm.ship_svg()
    vb = re.search(r'viewBox="([^"]+)"', svg).group(1)
    body = svg[svg.index(">") + 1: svg.rindex("</svg>")]
    return vb, body


def _inked(body, ink, soft, dim, cut):
    return (body.replace(f'"{lm.INK}"', f'"{ink}"')
                .replace(f'fill="{lm.SOFT}"', f'fill="{soft[0]}"{soft[1] and " fill-opacity=" + chr(34) + soft[1] + chr(34)}')
                .replace(f'stroke="{lm.SOFT}"', f'stroke="{soft[0]}"{soft[1] and " stroke-opacity=" + chr(34) + soft[1] + chr(34)}')
                .replace(f'stroke="{lm.DIM}"', f'stroke="{dim[0]}"{dim[1] and " stroke-opacity=" + chr(34) + dim[1] + chr(34)}')
                .replace(f'"{lm.BG}"', f'"{cut}"'))


VIEWBOX = _drawing()[0]


def symbol():
    vb, body = _drawing()
    body = _inked(body, "currentColor", ("currentColor", ".78"), ("currentColor", ".45"), "var(--ship-cut, #6f3f1c)")
    body = body.replace('url(#cs1)', 'url(#i-ship-cs1)').replace('url(#cs2)', 'url(#i-ship-cs2)') \
               .replace('id="cs1"', 'id="i-ship-cs1"').replace('id="cs2"', 'id="i-ship-cs2"')
    return f'<symbol id="i-ship" viewBox="{vb}">{body}</symbol>'


def _on_brown(body):
    return _inked(body, WHITE, (WHITE, ".78"), (WHITE, ".45"), BROWN)


def logo_svg():
    vb, body = _drawing()
    x, y, w, h = vb.split()
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="المهلب — Almuhallab">
  <!-- The Almuhallab mark: the Kuwaiti boum as a flat illustration, white on
       the brand brown (owner's approval 2026-10-03). Drawn over the BOUM
       polygons in design/matrix_logo.py by design/logo-modern/build.py and
       written here by design/ship_mark.py — do not edit by hand. -->
  <rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{BROWN}"/>
  {_on_brown(body)}
</svg>
'''


def favicon_svg():
    vb, body = _drawing()
    x, y, w, h = (float(v) for v in vb.split())
    s = 440 / w                       # the ship fills 440 of the 512 tile
    tx, ty = 36 - x * s, 256 - (y + h / 2) * s
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Almuhallab Code favicon: the illustrated boum, white on the brand brown.
       Written by design/ship_mark.py — do not edit by hand. -->
  <rect width="512" height="512" rx="96" fill="{BROWN}"/>
  <g transform="translate({tx:.1f} {ty:.1f}) scale({s:.4f})">{_on_brown(body)}</g>
</svg>
'''


def with_symbol(html):
    sym = symbol()
    if 'id="i-ship"' in html:
        html, n = re.subn(r'<symbol id="i-ship".*?</symbol>', lambda m: sym, html, count=1, flags=re.S)
    else:
        html, n = re.subn(r'(<symbol id="i-boum")', lambda m: sym + "\n    " + m.group(1), html, count=1)
    if n != 1:
        sys.exit("could not place #i-ship in index.html's sprite")
    return html


def main():
    want = {SITE / "logo.svg": logo_svg(), SITE / "favicon.svg": favicon_svg(), PAGE: with_symbol(PAGE.read_text())}
    stale = [p.name for p, t in want.items() if p.read_text() != t]
    if "--check" in sys.argv:
        if stale:
            sys.exit("ship mark drifted: " + ", ".join(stale))
        print("ship mark is current")
        return
    for p, t in want.items():
        p.write_text(t)
    print(f"wrote {len(want)} files")


if __name__ == "__main__":
    main()
