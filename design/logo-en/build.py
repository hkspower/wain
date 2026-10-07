#!/usr/bin/env python3
"""The English logo of Almuhallab Code, as vectors and full-size PNGs.

The lockup is the one on the English banner (2026-10-07): ALMUHALLAB in
Chakra Petch Bold with the striped amber fill, CODE in Chakra Petch SemiBold
between two fading rules, and the terminal line `>_ SOFTWARE & SYSTEMS` in
JetBrains Mono with its block cursor.

Every letter is an outline, not text: each line is shaped with HarfBuzz
(kerning on, as a browser sets it), and the glyphs are drawn out of the
bundled OFL fonts with fontTools. So the SVGs need no font installed and
look the same in every program, and the PNGs are rasterised from those
same SVGs, so the bitmap cannot disagree with the vector.

    python3 design/logo-en/build.py           # write SVG, PNG, sheet, README
    python3 design/logo-en/build.py --check   # exit 1 if an SVG or the README drifted
"""
import colorsys
import pathlib
import sys

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = pathlib.Path(__file__).resolve().parent
FONTS = HERE / "fonts"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

# ── colour ────────────────────────────────────────────────────────────────
GROUND = "#0a0908"          # the banner's near-black
AMBER = "#E6A95C"           # the banner's accent
CODE_INK = "#f4f4f4"
TAG_INK = "#ececec"
LIGHT_CODE = "#25292f"      # the site's --tint-strong
LIGHT_TAG = "#33383f"       # the site's --tint


def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _hex(rgb):
    return "#" + "".join(f"{round(max(0, min(1, c)) * 255):02x}" for c in rgb)


def _lum(h):
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in _rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def shade(h, k):
    """The stripe tone: the same colour at k of its strength, as the banner's."""
    return _hex(tuple(c * k for c in _rgb(h)))


def solve_on_white(h, target):
    """The banner's amber reads 2.25:1 on white, too faint for a mark. Keep
    its hue and saturation and lower the lightness until it clears target."""
    hh, ll, ss = colorsys.rgb_to_hls(*_rgb(h))
    while ll > 0:
        cand = _hex(colorsys.hls_to_rgb(hh, ll, ss))
        if contrast(cand, "#ffffff") >= target:
            return cand
        ll -= 0.002
    raise SystemExit("no amber clears the target")


AMBER_LIGHT = solve_on_white(AMBER, 3.0)

# ── type ──────────────────────────────────────────────────────────────────


class Face:
    def __init__(self, file, wght=None):
        path = str(FONTS / file)
        self.tt = TTFont(path)
        self.upm = self.tt["head"].unitsPerEm
        self.cap = self.tt["OS/2"].sCapHeight
        self.asc = self.tt["hhea"].ascent
        self.desc = self.tt["hhea"].descent
        self.gs = self.tt.getGlyphSet(location={"wght": wght}) if wght else self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        self.hb = hb.Font(hb.Face(hb.Blob.from_file_path(path)))
        if wght:
            self.hb.set_variations({"wght": wght})


def _num(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


class Run:
    """One line of shaped text: its outline and ink box, pen at (ox, baseline)."""

    def __init__(self, face, text, size, track_em=0.0):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(face.hb, buf, {"kern": True})
        self.face, self.size = face, size
        self.s = size / face.upm
        self.cap = face.cap * self.s
        self.glyphs = []
        x = 0.0
        n = len(buf.glyph_infos)
        for i, (inf, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
            self.glyphs.append((face.order[inf.codepoint], x + pos.x_offset * self.s, pos.y_offset * self.s))
            x += pos.x_advance * self.s
            if i < n - 1:
                x += track_em * size          # tracking between letters, none after the last
        self.advance = x
        b = self._draw(BoundsPen(face.gs), 0, 0)
        self.bounds = b.bounds                 # (xmin, ymin, xmax, ymax), y down, pen origin (0, 0)

    def _draw(self, pen, ox, oy):
        for name, gx, gy in self.glyphs:
            t = TransformPen(pen, (self.s, 0, 0, -self.s, ox + gx, oy - gy))
            self.face.gs[name].draw(t)
        return pen

    def path(self, ox, oy):
        pen = SVGPathPen(self.face.gs, ntos=_num)
        return self._draw(pen, ox, oy).getCommands()

    @property
    def ink_w(self):
        return self.bounds[2] - self.bounds[0]


CHAKRA_B = Face("ChakraPetch-Bold.ttf")
CHAKRA_SB = Face("ChakraPetch-SemiBold.ttf")
MONO_500 = Face("JetBrainsMono-Variable.ttf", 500)
MONO_700 = Face("JetBrainsMono-Variable.ttf", 700)

# ── the lockup, in the banner's own pixels ───────────────────────────────
# Sizes, tracking and the ink gaps are the banner's (1920×1080): the
# wordmark 212px tracked .02em, CODE 84px tracked .5em inside a 1180px row,
# the terminal line 34px tracked .3em; 58px of air from the wordmark's
# baseline to CODE's cap line and 70px from CODE to the terminal line.

WORD = Run(CHAKRA_B, "ALMUHALLAB", 212, 0.02)
CODE = Run(CHAKRA_SB, "CODE", 84, 0.5)
PROMPT = Run(MONO_700, ">_", 34)
TAG = Run(MONO_500, "SOFTWARE & SYSTEMS", 34, 0.3)

ROW_HALF = 590          # the CODE row is 1180 wide
RULE_GAP = 30           # from CODE's ink to each rule
RULE_T = 2
GAP_WORD_CODE = 58
GAP_CODE_TAG = 70
PROMPT_GAP = 22         # flex gap after the prompt
CURSOR_GAP = 26         # flex gap plus the cursor's own 4px margin
CURSOR_W = 16


def stripe_period(cap):
    """Stripes that start and end on an amber band: the cap height holds n
    whole periods plus one more band, so the top and the foot of every letter
    are clean amber rather than cut through a dark line. 5 : 2 as on the
    banner, n chosen to keep the period nearest the banner's 7px."""
    n = round((cap - 5) / 7)
    p = cap / (n + 5 / 7)
    return p, p * 5 / 7


def lockup(with_tag=True):
    """Every shape of the lockup, centred on x = 0 with the wordmark's
    baseline at y = 0, and the ink box of the whole."""
    shapes = []
    wx = -WORD.ink_w / 2 - WORD.bounds[0]
    shapes.append(("word", WORD.path(wx, 0)))
    word_top = -WORD.cap

    code_base = GAP_WORD_CODE + CODE.cap
    cx = -CODE.ink_w / 2 - CODE.bounds[0]
    shapes.append(("code", CODE.path(cx, code_base)))
    mid = code_base - CODE.cap / 2
    code_l, code_r = cx + CODE.bounds[0], cx + CODE.bounds[2]
    shapes.append(("rule_l", (-ROW_HALF, mid - RULE_T / 2, code_l - RULE_GAP - -ROW_HALF, RULE_T)))
    shapes.append(("rule_r", (code_r + RULE_GAP, mid - RULE_T / 2, ROW_HALF - code_r - RULE_GAP, RULE_T)))
    bottom = code_base
    left = min(-ROW_HALF, wx + WORD.bounds[0])
    right = max(ROW_HALF, wx + WORD.bounds[2])

    if with_tag:
        tag_base = code_base + GAP_CODE_TAG + TAG.cap
        # the cursor fills the line box of a 34px line set solid, as on the banner
        line_top = tag_base - (MONO_500.asc + ((MONO_500.upm - (MONO_500.asc - MONO_500.desc)) / 2)) * TAG.s
        cur_h = TAG.size
        # boxes, as the banner's flex row lays them out: prompt | gap | text | gap | cursor
        group_w = PROMPT.advance + PROMPT_GAP + TAG.advance + CURSOR_GAP + CURSOR_W
        px = -group_w / 2
        # centre by ink: the row's ink starts at the prompt's ink and ends at the cursor
        ink_l = px + PROMPT.bounds[0]
        ink_r = px + group_w
        px -= (ink_l + ink_r) / 2
        tx = px + PROMPT.advance + PROMPT_GAP
        cur_x = tx + TAG.advance + CURSOR_GAP
        shapes.append(("prompt", PROMPT.path(px, tag_base)))
        shapes.append(("tag", TAG.path(tx, tag_base)))
        shapes.append(("cursor", (cur_x, line_top, CURSOR_W, cur_h)))
        bottom = max(tag_base + PROMPT.bounds[3], line_top + cur_h)
    return shapes, (left, word_top, right, bottom)


# ── SVG ──────────────────────────────────────────────────────────────────

GROUNDS = {
    # name: (ground, amber, code ink, tag ink, glow)
    "dark": (GROUND, AMBER, CODE_INK, TAG_INK, True),
    "for-dark": (None, AMBER, CODE_INK, TAG_INK, False),
    "for-light": (None, AMBER_LIGHT, LIGHT_CODE, LIGHT_TAG, False),
}
PAD = 112          # clear space round the ink, in the banner's pixels (3/4 of the wordmark's cap height)


def svg(with_tag, ground, square=None):
    bg, amber, code_ink, tag_ink, glow = GROUNDS[ground]
    shapes, (l, t, r, b) = lockup(with_tag)
    if square:
        # a square tile: the ink sits inside the circle a profile photo is cut to
        side = square
        radius = side / 2 * 0.80
        k = 2 * radius / ((r - l) ** 2 + (b - t) ** 2) ** 0.5
        vw = side / k
        vx, vy = (l + r) / 2 - vw / 2, (t + b) / 2 - vw / 2
        vb = (vx, vy, vw, vw)
        size = (side, side)
    else:
        vb = (l - PAD, t - PAD, r - l + 2 * PAD, b - t + 2 * PAD)
        size = (vb[2], vb[3])
    period, band = stripe_period(WORD.cap)
    dark = shade(amber, 0.55)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{" ".join(_num(v) for v in vb)}" '
           f'width="{_num(size[0])}" height="{_num(size[1])}" role="img" aria-label="Almuhallab Code">',
           "  <!-- Almuhallab Code, the English logo. Letters are outlines from Chakra Petch and",
           "       JetBrains Mono (SIL OFL). Written by design/logo-en/build.py; do not edit by hand. -->",
           "  <defs>",
           f'    <pattern id="stripes" patternUnits="userSpaceOnUse" x="0" y="{_num(-WORD.cap)}" '
           f'width="16" height="{_num(period)}">',
           f'      <rect width="16" height="{_num(band)}" fill="{amber}"/>',
           f'      <rect y="{_num(band)}" width="16" height="{_num(period - band)}" fill="{dark}"/>',
           "    </pattern>",
           f'    <linearGradient id="fade-l" x1="0" x2="1" y1="0" y2="0">'
           f'<stop offset="0" stop-color="{amber}" stop-opacity="0"/>'
           f'<stop offset="1" stop-color="{amber}" stop-opacity="0.55"/></linearGradient>',
           f'    <linearGradient id="fade-r" x1="0" x2="1" y1="0" y2="0">'
           f'<stop offset="0" stop-color="{amber}" stop-opacity="0.55"/>'
           f'<stop offset="1" stop-color="{amber}" stop-opacity="0"/></linearGradient>']
    if glow:
        out += ['    <filter id="glow" x="-10%" y="-70%" width="120%" height="240%" color-interpolation-filters="sRGB">',
                '      <feGaussianBlur in="SourceAlpha" stdDeviation="20" result="blur"/>',
                f'      <feFlood flood-color="{amber}" flood-opacity="0.32"/>',
                '      <feComposite in2="blur" operator="in" result="halo"/>',
                '      <feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge>',
                "    </filter>"]
    out.append("  </defs>")
    if bg:
        out.append(f'  <rect x="{_num(vb[0])}" y="{_num(vb[1])}" width="{_num(vb[2])}" height="{_num(vb[3])}" fill="{bg}"/>')
    for kind, d in shapes:
        if kind == "word":
            out.append(f'  <path d="{d}" fill="url(#stripes)"{" filter=" + chr(34) + "url(#glow)" + chr(34) if glow else ""}/>')
        elif kind == "code":
            out.append(f'  <path d="{d}" fill="{code_ink}"/>')
        elif kind in ("rule_l", "rule_r"):
            x, y, w, h = d
            out.append(f'  <rect x="{_num(x)}" y="{_num(y)}" width="{_num(w)}" height="{_num(h)}" '
                       f'fill="url(#fade-{kind[-1]})"/>')
        elif kind == "prompt":
            out.append(f'  <path d="{d}" fill="{amber}"/>')
        elif kind == "tag":
            out.append(f'  <path d="{d}" fill="{tag_ink}"/>')
        elif kind == "cursor":
            x, y, w, h = d
            out.append(f'  <rect x="{_num(x)}" y="{_num(y)}" width="{_num(w)}" height="{_num(h)}" '
                       f'fill="{amber}" fill-opacity="0.85"/>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


PNG_W = 4096
SQUARE = 2048
# name: (with tagline, ground, square side or None)
FILES = {
    "almuhallab-code-logo-dark": (True, "dark", None),
    "almuhallab-code-logo-for-dark": (True, "for-dark", None),
    "almuhallab-code-logo-for-light": (True, "for-light", None),
    "almuhallab-code-wordmark-dark": (False, "dark", None),
    "almuhallab-code-wordmark-for-dark": (False, "for-dark", None),
    "almuhallab-code-wordmark-for-light": (False, "for-light", None),
    "almuhallab-code-square-dark": (False, "dark", SQUARE),
}


def png_size(name):
    with_tag, ground, square = FILES[name]
    if square:
        return square, square
    _, (l, t, r, b) = lockup(with_tag)
    w, h = r - l + 2 * PAD, b - t + 2 * PAD
    return PNG_W, round(PNG_W * h / w)


def readme():
    rows = []
    for name, (with_tag, ground, square) in FILES.items():
        w, h = png_size(name)
        what = ("full lockup" if with_tag else "wordmark") if not square else "square tile (profile photo)"
        where = {"dark": "on its own near-black ground",
                 "for-dark": "transparent, for dark backgrounds",
                 "for-light": "transparent, for white and light backgrounds"}[ground]
        rows.append(f"| `{name}.svg` · `.png` | {what}, {where} | {w} × {h} |")
    return f"""# Almuhallab Code, English logo

The lockup from the English banner: **ALMUHALLAB** in Chakra Petch Bold with
the striped amber fill, **CODE** in Chakra Petch SemiBold between two fading
rules, and the terminal line `>_ SOFTWARE & SYSTEMS` in JetBrains Mono.

Generated by `build.py`; do not edit the files by hand. Every letter is an
outline, so the SVGs need no font installed, and every PNG is rasterised
from its SVG.

| File | What | PNG size (px) |
|---|---|---|
{chr(10).join(rows)}

`preview-sheet.png` shows each one on the grounds it is made for.

## Which one to use

- **Full lockup** where there is room to read the terminal line: a header,
  a slide, a banner, print.
- **Wordmark** (no terminal line) where the logo is small: below about
  600 px wide the terminal line is too small to read.
- **Square tile** for profile photos. The ink sits inside the circle the
  platforms cut it to, so nothing is shaved off.
- On a dark background use `-dark` or `-for-dark`; on white or light grey use
  `-for-light`. Never put `-for-dark` on white: its CODE is white.

## Colour

| Use | Colour | Contrast |
|---|---|---|
| Amber on dark | `{AMBER}` | {contrast(AMBER, GROUND):.1f}:1 on `{GROUND}` |
| Amber on light | `{AMBER_LIGHT}` | {contrast(AMBER_LIGHT, '#ffffff'):.1f}:1 on white |
| CODE on dark | `{CODE_INK}` | {contrast(CODE_INK, GROUND):.1f}:1 |
| CODE on light | `{LIGHT_CODE}` | {contrast(LIGHT_CODE, '#ffffff'):.1f}:1 |
| Terminal line on light | `{LIGHT_TAG}` | {contrast(LIGHT_TAG, '#ffffff'):.1f}:1 |
| Stripes | the amber at 55% | |

The banner's amber reads only {contrast(AMBER, '#ffffff'):.2f}:1 on white, too
faint for a mark, so the light version keeps its hue and saturation and is
darkened until it clears 3:1.

## Clear space

Keep at least the height of CODE's capitals clear on every side. The PNGs
already carry 3/4 of the wordmark's cap height as margin.

## Fonts

Chakra Petch (Cadson Demak) and JetBrains Mono (JetBrains), both under the
SIL Open Font License; the licences are in `fonts/`.

## Rebuild

    python3 design/logo-en/build.py           # writes everything here
    python3 design/logo-en/build.py --check   # fails if an SVG or this README drifted
"""


def render_pngs(names):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=CHROME)
        for name in names:
            w, h = png_size(name)
            pg = br.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            src = (HERE / f"{name}.svg").read_text()
            pg.set_content('<!doctype html><html><head><style>html,body{margin:0;background:transparent}'
                           f'svg{{display:block;width:{w}px;height:{h}px}}</style></head><body>{src}</body></html>')
            pg.wait_for_timeout(150)
            pg.screenshot(path=str(HERE / f"{name}.png"), omit_background=True,
                          clip={"x": 0, "y": 0, "width": w, "height": h})
            pg.close()
            print("  wrote", f"{name}.png", f"{w}×{h}")
        sheet(br)
        br.close()


def sheet(br):
    """One page that shows each file on the grounds it is made for, with a
    checkerboard under the transparent ones so their edges can be judged."""
    check = ("background-color:#fff;background-image:linear-gradient(45deg,#d9dce1 25%,transparent 25%),"
             "linear-gradient(-45deg,#d9dce1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d9dce1 75%),"
             "linear-gradient(-45deg,transparent 75%,#d9dce1 75%);background-size:24px 24px;"
             "background-position:0 0,0 12px,12px -12px,-12px 0")
    cells = []
    for name, (with_tag, ground, square) in FILES.items():
        grounds = {"dark": [("own ground", "")],
                   "for-dark": [("on #1b1d22", "background:#1b1d22"), ("on checker", check)],
                   "for-light": [("on white", "background:#ffffff"), ("on checker", check)]}[ground]
        for label, style in grounds:
            cells.append(f'<figure style="margin:0"><div style="{style};border:1px solid #2b2f36;'
                         f'display:flex;align-items:center;justify-content:center;height:{360 if square else 300}px">'
                         f'<img src="{name}.png" style="max-width:{"340px" if square else "92%"};max-height:92%"></div>'
                         f'<figcaption style="font:500 15px/1.4 monospace;color:#c9ced6;padding:8px 0 0">'
                         f'{name} · {label}</figcaption></figure>')
    html = ('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#111316;padding:32px;'
            'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}</style></head><body>'
            + "".join(cells) + "</body></html>")
    tmp = HERE / ".sheet.html"
    tmp.write_text(html)
    pg = br.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
    pg.goto(tmp.as_uri())
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(HERE / "preview-sheet.png"), full_page=True)
    pg.close()
    tmp.unlink()
    print("  wrote preview-sheet.png")


def main():
    want = {HERE / f"{n}.svg": svg(*FILES[n][:2], square=FILES[n][2]) for n in FILES}
    want[HERE / "README.md"] = readme()
    if "--check" in sys.argv:
        stale = [p.name for p, t in want.items() if not p.exists() or p.read_text() != t]
        if stale:
            sys.exit("English logo drifted: " + ", ".join(stale))
        print("English logo is current")
        return
    for p, t in want.items():
        p.write_text(t)
        print("  wrote", p.name)
    render_pngs(list(FILES))


if __name__ == "__main__":
    main()
