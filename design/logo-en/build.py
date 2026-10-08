#!/usr/bin/env python3
"""The English logo of Almuhallab Code, as vectors and full-size PNGs.

The lockup is the one on the English banner (2026-10-07): ALMUHALLAB in
Chakra Petch Bold with the striped amber fill, CODE in Chakra Petch SemiBold
between two fading rules, and the terminal line `>_ SOFTWARE & SYSTEMS` in
JetBrains Mono with its block cursor. The monogram, for profile photos and
icons, is its first letters: the striped amber A and the white C.

Every letter is an outline, not text: each line is shaped with HarfBuzz
(kerning on, as a browser sets it), and the glyphs are drawn out of the
bundled OFL fonts with fontTools. So the SVGs need no font installed and
look the same in every program, and the PNGs are rasterised from those
same SVGs, so the bitmap cannot disagree with the vector. `--check` proves
both halves: it compares the SVGs and the README as text, and re-renders
every PNG and compares it pixel by pixel.

    python3 design/logo-en/build.py           # write SVG, PNG, sheet, README
    python3 design/logo-en/build.py --check   # exit 1 if any output drifted
"""
import functools
import io
import math
import pathlib
import re
import sys
import tempfile

import uharfbuzz as hb
from fontTools.pens.basePen import BasePen
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
LIGHT_CODE = "#25292f"      # dark grey ink for light grounds (14.6:1 on white)
LIGHT_TAG = "#33383f"       # (11.8:1 on white)
STRIPE = 0.55               # the dark band is the amber at 55%, as on the banner


def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _hex(rgb):
    return "#" + "".join(f"{round(max(0, min(1, c)) * 255):02x}" for c in rgb)


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _gam(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _lum(h):
    r, g, b = (_lin(c) for c in _rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def shade(h, k):
    return _hex(tuple(c * k for c in _rgb(h)))


def to_oklab(h):
    r, g, b = (_lin(c) for c in _rgb(h))
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def from_oklab(L, a, b):
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
           -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
           -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    if min(rgb) < -1e-4 or max(rgb) > 1 + 1e-4:
        return None                     # out of sRGB: not a colour we can print
    return _hex(tuple(_gam(max(0, min(1, c))) for c in rgb))


def solve_on_white(h, target):
    """The banner's amber reads only 2.06:1 on white, too faint for a mark.
    Keep its perceived hue and chroma (OKLCH) and lower only its lightness
    until it clears the target. Darkening in HLS at constant saturation would
    raise the chroma and swing the hue toward orange (a reviewer measured
    #d18320 that way: pumpkin, not gold)."""
    L, a, b = to_oklab(h)
    while L > 0:
        cand = from_oklab(L, a, b)
        if cand and contrast(cand, "#ffffff") >= target:
            return cand
        L -= 0.001
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

    def baseline_in_line(self, size):
        """Where a browser puts the baseline in a line box set solid
        (line-height: 1): the half-leading, negative here, plus the ascent."""
        content = (self.asc - self.desc) / self.upm
        return ((1 - content) / 2 + self.asc / self.upm) * size


class _FlatEdges(BasePen):
    """The y of every flat (horizontal) straight edge of an outline: the
    tops and feet of strokes, the A's crossbar. A stripe's edge that lands a
    hair away from one leaves a sliver of the other colour along it."""

    def __init__(self, gs, min_len=1e-6):
        super().__init__(gs)
        self.ys = set()
        self.min_len = min_len
        self._p = self._start = None

    def _flat(self, a, b):
        if abs(a[1] - b[1]) < 1e-6 and abs(a[0] - b[0]) > self.min_len:
            self.ys.add(round(a[1], 4))

    def _moveTo(self, p):
        self._p = self._start = p

    def _lineTo(self, p):
        self._flat(self._p, p)
        self._p = p

    def _curveToOne(self, a, b, c):
        self._p = c

    def _qCurveToOne(self, a, b):
        self._p = b

    def _closePath(self):
        if self._p and self._start:
            self._flat(self._p, self._start)


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
        self.bounds = self._draw(BoundsPen(face.gs), 0, 0).bounds   # (xmin, ymin, xmax, ymax), y down

    def _draw(self, pen, ox, oy):
        for name, gx, gy in self.glyphs:
            self.face.gs[name].draw(TransformPen(pen, (self.s, 0, 0, -self.s, ox + gx, oy - gy)))
        return pen

    def path(self, ox, oy):
        return self._draw(SVGPathPen(self.face.gs, ntos=_num), ox, oy).getCommands()

    def flat_edges(self, ox, oy, min_len=1e-6):
        return sorted(self._draw(_FlatEdges(self.face.gs, min_len), ox, oy).ys)

    def flat_fracs(self, ox=0):
        """The flat edges that are strokes, not the point of a vertex (the
        A's apex and the M's inner corners are flats under one unit wide),
        as fractions of the cap down from the cap line."""
        return tuple((e + self.cap) / self.cap for e in self.flat_edges(ox, 0, 0.02 * self.size))

    @property
    def ink_w(self):
        return self.bounds[2] - self.bounds[0]


CHAKRA_B = Face("ChakraPetch-Bold.ttf")
CHAKRA_SB = Face("ChakraPetch-SemiBold.ttf")
MONO_500 = Face("JetBrainsMono-Variable.ttf", 500)
MONO_700 = Face("JetBrainsMono-Variable.ttf", 700)

# ── the lockup, in the banner's own CSS pixels ───────────────────────────
WORD = Run(CHAKRA_B, "ALMUHALLAB", 212, 0.02)
CODE = Run(CHAKRA_SB, "CODE", 84, 0.5)
PROMPT = Run(MONO_700, ">_", 34)
TAG = Run(MONO_500, "SOFTWARE & SYSTEMS", 34, 0.3)

# The gaps are the banner's CSS worked through, not measured off a render:
# the wordmark's line box (212, set solid) plus its 10px padding and the
# CODE row's 4px margin; then CODE's line box (84) and the terminal row's
# 54px margin. Each line box is measured from its baseline to the next
# line's cap line, so the outlines land where the banner's text sat.
GAP_WORD_CODE = ((212 - CHAKRA_B.baseline_in_line(212)) + 10 + 4
                 + (CHAKRA_SB.baseline_in_line(84) - CODE.cap))
GAP_CODE_TAG = ((84 - CHAKRA_SB.baseline_in_line(84)) + 54
                + (MONO_500.baseline_in_line(34) - TAG.cap))

ROW_HALF = 590          # the CODE row is 1180 wide
RULE_T = 2
# On the banner each rule stops 28px from CODE's box, which is its ink plus
# the side bearings (C's left, E's right). The kit centres CODE on its ink,
# so it splits the two bearings evenly: the rules stay equal in length and
# each gap is within a pixel of the banner's.
_LSB = CODE.bounds[0]
_RSB = CODE.advance - CODE.bounds[2]
RULE_GAP = 28 + (_LSB + _RSB) / 2
PROMPT_GAP = 22         # the terminal row's flex gap
CURSOR_GAP = 26         # the flex gap plus the cursor's own 4px margin
CURSOR_W = 16
GLOW_SIGMA_EM = 40 / 212    # the banner's drop-shadow(0 0 40px) on a 212px word: CSS blurs with sigma = 40


def stripe_bands(cap, n=None):
    """The dark bands across a letter of cap height `cap`, as (top, height)
    from the cap line down. The letter starts and ends on an amber band, so
    no letter's top or foot is cut through a dark line: the cap holds n
    whole periods plus one more amber band, 5 : 2 as on the banner. With no
    n, the period is kept nearest the banner's 7px."""
    if n is None:
        n = round((cap - 5) / 7)
    p = cap / (n + 5 / 7)
    band = p * 5 / 7
    return [(band + i * p, p - band) for i in range(n)]


def snap_bands(bands, top, edges, tol):
    """The bands in absolute y, each edge moved onto the ONE flat outline edge
    nearest it, if that is within `tol` (one pixel of the finished image), so
    no sliver of amber or of dark is left along a stroke's top or foot. A snap
    that would squash or swell its band past 40% is refused: chaining every
    edge in turn once dragged both edges of a band onto the same line and the
    band vanished (the masthead, where a pixel is half a band)."""
    def near(v):
        cands = [e for e in edges if 0 < abs(v - e) <= tol]
        return min(cands, key=lambda e: abs(v - e)) if cands else v
    def fair(lo, hi, h):
        return 0.6 * h <= hi - lo <= 1.4 * h
    out = []
    for y, h in bands:
        a, b = top + y, top + y + h
        na, nb = near(a), near(b)
        if not fair(na, nb, h):
            na, nb = (na, b) if fair(na, b, h) else ((a, nb) if fair(a, nb, h) else (a, b))
        out.append((na, nb - na))
    return out


# ── stripes in whole device pixels ───────────────────────────────────────
# A band is crisp only when it is a whole number of device rows. crispEdges
# puts each edge on a row, but a band 2.3 rows tall is then drawn 2 rows
# here and 3 there: the masthead's three bands at 1x were exactly that, and
# the 180px touch icon's five (3.5 rows) too. So a stripe meant for a known
# size is designed IN device pixels, for a cap that is itself a whole number
# of them, and only then mapped back to the outline's units. Any offset of
# the whole drawing keeps it exact: a band of k rows always covers k pixel
# centres, wherever it starts.

BAND_MIN = 2           # the thinnest dark band that reads as a line: two device rows
BAND_RATIO = 5 / 2     # amber : dark, as on the banner


def pixel_bands(cap_px, n=None, flats=()):
    """The dark bands across a letter whose cap is `cap_px` device pixels,
    as (row, rows) from the cap line, every edge on a whole row; None where
    no band of BAND_MIN rows fits (the letter is drawn solid there).

    With no n (the wordmark) it is the banner's own stripe at device
    resolution: two dark rows in a period of seven, as many periods as the
    cap holds, never more than the kit's twenty, and never fewer than the
    three the masthead always carried unless three bands of two rows leave
    the amber thinner than one and a half times the dark (then two).
    With n (the monogram's five, the share card's twenty) the count is
    kept and the dark band is the whole number of rows, at least two, whose
    amber gaps come nearest 5 : 2.

    The amber gaps share the rest as whole rows, each inner gap the floor or
    the ceiling of the even share, so the stripe stays regular; the two
    outer gaps may give or take one more, which moves the whole set by a
    row. Within that, the arrangement keeps band edges off the letters'
    flat edges (`flats`, as fractions of the cap down from the cap line):
    an edge less than a row from a stroke's top or foot leaves a sliver of
    the other colour along it."""
    if n is None:
        d = BAND_MIN
        n = max(3, min(20, round((cap_px - BAND_RATIO * d) / (d * (1 + BAND_RATIO)))))
        while n > 2 and (cap_px - n * d) / (n + 1) / d < 1.5:
            n -= 1                      # the masthead's old three where they fit, else two
    else:
        ideal = cap_px * 2 / (7 * n + 5)
        cands = sorted({max(BAND_MIN, math.floor(ideal)), max(BAND_MIN, math.ceil(ideal))})
        d = min(cands, key=lambda k: abs(math.log(max(1e-9, (cap_px - n * k) / (n + 1)) / k / BAND_RATIO)))
    amber = (cap_px - n * d) / (n + 1)
    if amber / d < 1.5:
        return None                     # the dark would outweigh the amber: solid
    edges = [f * cap_px for f in flats if 0 < f < 1]

    def slivers(e):
        return sum(1 for f in edges if 0.15 < abs(e - f) < 1)

    inner = range(math.floor(amber), math.ceil(amber) + 1)
    outer = range(max(1, math.floor(amber) - 1), math.ceil(amber) + 2)

    @functools.lru_cache(None)
    def best(i, row, first):
        if i == n:
            g = cap_px - row
            if g not in outer:
                return (math.inf, ())
            return ((g - amber) ** 2 + 0.5 * abs(g - first), (g,))
        out = (math.inf, ())
        for g in (outer if i == 0 else inner):
            top = row + g
            if top + d > cap_px:
                break
            cost, rest = best(i + 1, top + d, g if i == 0 else first)
            cost += (g - amber) ** 2 + slivers(top) + slivers(top + d)
            if cost < out[0]:
                out = (cost, (g,) + rest)
        return out

    cost, gaps = best(0, 0, 0)
    if cost == math.inf:
        return None
    rows, r = [], 0
    for g in gaps[:-1]:
        r += g
        rows.append((r, d))
        r += d
    return rows


def band_group(cap_units, top, cap_px, n=None, flats=()):
    """pixel_bands mapped onto an outline: (y, height) in its units."""
    rows = pixel_bands(cap_px, n, flats)
    if rows is None:
        return None
    k = cap_units / cap_px
    return [(top + r * k, h * k) for r, h in rows]


def lockup(with_tag=True, bands=None):
    """Every shape of the lockup, centred on x = 0 with the wordmark's
    baseline at y = 0, the ink box of the whole, and the glow's sigma."""
    shapes = []
    wx = -WORD.ink_w / 2 - WORD.bounds[0]
    shapes.append(("striped", WORD.path(wx, 0), -WORD.cap, WORD.cap, bands, WORD.flat_edges(wx, 0)))
    word_top = -WORD.cap

    code_base = GAP_WORD_CODE + CODE.cap
    cx = -CODE.ink_w / 2 - CODE.bounds[0]
    shapes.append(("code", CODE.path(cx, code_base)))
    mid = code_base - CODE.cap / 2
    code_l, code_r = cx + CODE.bounds[0], cx + CODE.bounds[2]
    shapes.append(("rule_l", (-ROW_HALF, mid - RULE_T / 2, code_l - RULE_GAP + ROW_HALF, RULE_T)))
    shapes.append(("rule_r", (code_r + RULE_GAP, mid - RULE_T / 2, ROW_HALF - code_r - RULE_GAP, RULE_T)))
    bottom = code_base
    left = min(-ROW_HALF, wx + WORD.bounds[0])
    right = max(ROW_HALF, wx + WORD.bounds[2])

    if with_tag:
        tag_base = code_base + GAP_CODE_TAG + TAG.cap
        # the cursor fills the line box of a 34px line set solid, as on the banner
        line_top = tag_base - MONO_500.baseline_in_line(TAG.size)
        cur_h = TAG.size
        # boxes as the banner's flex row lays them out: prompt | gap | text | gap | cursor,
        # then the whole row centred on its ink (the prompt's ink to the cursor's edge)
        group_w = PROMPT.advance + PROMPT_GAP + TAG.advance + CURSOR_GAP + CURSOR_W
        px = -group_w / 2
        ink_l, ink_r = px + PROMPT.bounds[0], px + group_w
        px -= (ink_l + ink_r) / 2
        tx = px + PROMPT.advance + PROMPT_GAP
        cur_x = tx + TAG.advance + CURSOR_GAP
        shapes.append(("prompt", PROMPT.path(px, tag_base)))
        shapes.append(("tag", TAG.path(tx, tag_base)))
        shapes.append(("cursor", (cur_x, line_top, CURSOR_W, cur_h)))
        bottom = max(tag_base + PROMPT.bounds[3], line_top + cur_h)
    return shapes, (left, word_top, right, bottom), GLOW_SIGMA_EM * WORD.size


# The monogram: the lockup's first letters, A from ALMUHALLAB (striped amber)
# and C from CODE (in CODE's ink), both Bold so they hold up at 32px. Chosen
# by rendering four candidates in a circle at 150/110/44/32px (AC, AC with
# the cursor, the prompt, AC tight) and keeping the one that still read at
# 32. Five bands: the count that puts both edges of the A's crossbar inside
# amber (22 and 32 units clear; seven left a sliver under it and started its
# top on a dark band), with bands a third thicker than seven. The stripes
# read on a 1x screen at 110px and up; below about 64 device pixels no count
# can give a band a whole pixel, so they blend into the amber, and the AC
# still reads.
MONO_SIZE = 1000
MONO_A = Run(CHAKRA_B, "A", MONO_SIZE)
MONO_C = Run(CHAKRA_B, "C", MONO_SIZE)
MONO_GAP = 0.06 * MONO_SIZE
MONO_BANDS = 5


def monogram(bands=None):
    total = MONO_A.ink_w + MONO_GAP + MONO_C.ink_w
    xa = -total / 2 - MONO_A.bounds[0]
    xc = -total / 2 + MONO_A.ink_w + MONO_GAP - MONO_C.bounds[0]
    cap = MONO_A.cap
    shapes = [("striped", MONO_A.path(xa, 0), -cap, cap, MONO_BANDS if bands is None else bands,
               MONO_A.flat_edges(xa, 0)),
              ("code", MONO_C.path(xc, 0))]
    return shapes, (-total / 2, -cap, total / 2, max(0, MONO_A.bounds[3], MONO_C.bounds[3])), GLOW_SIGMA_EM * MONO_SIZE


# ── SVG ──────────────────────────────────────────────────────────────────

GROUNDS = {
    # name: (ground, amber, code ink, tag ink, glow)
    "dark": (GROUND, AMBER, CODE_INK, TAG_INK, True),
    "for-dark": (None, AMBER, CODE_INK, TAG_INK, False),
    "for-light": (None, AMBER_LIGHT, LIGHT_CODE, LIGHT_TAG, False),
}
PAD = 112          # clear space round the ink, in the banner's pixels (3/4 of the wordmark's cap height)
PNG_W = 4096
SQUARE = 2048
CIRCLE = 0.80      # a square tile's ink stays inside 80% of the circle a profile photo is cut to

# name: (shape, ground)
FILES = {
    "almuhallab-code-logo-dark": ("logo", "dark"),
    "almuhallab-code-logo-for-dark": ("logo", "for-dark"),
    "almuhallab-code-logo-for-light": ("logo", "for-light"),
    "almuhallab-code-wordmark-dark": ("wordmark", "dark"),
    "almuhallab-code-wordmark-for-dark": ("wordmark", "for-dark"),
    "almuhallab-code-wordmark-for-light": ("wordmark", "for-light"),
    "almuhallab-code-monogram-dark": ("monogram", "dark"),
    "almuhallab-code-monogram-for-dark": ("monogram", "for-dark"),
    "almuhallab-code-monogram-for-light": ("monogram", "for-light"),
}


def geometry(shape, bands=None):
    if shape == "monogram":
        return monogram(bands)
    return lockup(with_tag=(shape == "logo"), bands=bands)


def frame(shape):
    """The viewBox and the PNG's pixel size. A wide tile's height is rounded
    to whole pixels first and the viewBox grown to that exact aspect, the
    extra split above and below: with the aspects a hair apart, the
    renderer letterboxed the ground and left the first and last rows of the
    dark PNGs partly transparent."""
    _, (l, t, r, b), _ = geometry(shape)
    if shape == "monogram":
        k = 2 * (SQUARE / 2 * CIRCLE) / ((r - l) ** 2 + (b - t) ** 2) ** 0.5
        vw = SQUARE / k
        return ((l + r) / 2 - vw / 2, (t + b) / 2 - vw / 2, vw, vw), (SQUARE, SQUARE)
    vw = r - l + 2 * PAD
    px_h = round(PNG_W * (b - t + 2 * PAD) / vw)
    vh = vw * px_h / PNG_W
    return (l - PAD, (t + b) / 2 - vh / 2, vw, vh), (PNG_W, px_h)


def svg(name, shape=None, ground=None, bands=None, framing=None, hairline=False):
    if shape is None:
        shape, ground = FILES[name]
    bg, amber, code_ink, tag_ink, glow = GROUNDS[ground]
    shapes, _, sigma = geometry(shape, bands)
    vb, (pw, ph) = framing or frame(shape)
    dark = shade(amber, STRIPE)
    vbs = " ".join(_num(v) for v in vb)
    tol = vb[2] / pw          # one pixel of the finished PNG, in user units
    # Every id carries the file's name: inlined side by side in one page,
    # url(#id) resolves to the first element with that id in the document,
    # and the second logo took the first one's clip outline and glow.
    pre = name
    # the SVG's own size is the PNG's, so it opens at the size it was made for
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vbs}" width="{pw}" height="{ph}" '
           f'role="img" aria-label="Almuhallab Code">',
           "  <!-- Almuhallab Code, the English logo. Letters are outlines from Chakra Petch and",
           "       JetBrains Mono (SIL OFL). Written by design/logo-en/build.py; do not edit by hand. -->",
           "  <defs>"]
    for i, (kind, d, *rest) in enumerate(shapes):
        if kind == "striped":
            out.append(f'    <clipPath id="{pre}-letters-{i}"><path d="{d}"/></clipPath>')
    if hairline:
        # the masthead's rules: a gradient in user space (a zero-height line
        # has no bounding box to stretch an objectBoundingBox gradient over)
        for k, (x, y, w, h) in ((k, d) for k, d, *_ in shapes if k in ("rule_l", "rule_r")):
            a, b = ("0", "0.55") if k == "rule_l" else ("0.55", "0")
            out.append(f'    <linearGradient id="{pre}-fade-{k[-1]}" gradientUnits="userSpaceOnUse" '
                       f'x1="{_num(x)}" x2="{_num(x + w)}" y1="0" y2="0">'
                       f'<stop offset="0" stop-color="{amber}" stop-opacity="{a}"/>'
                       f'<stop offset="1" stop-color="{amber}" stop-opacity="{b}"/></linearGradient>')
    elif any(k in ("rule_l", "rule_r") for k, *_ in shapes):
        out += [f'    <linearGradient id="{pre}-fade-l" x1="0" x2="1" y1="0" y2="0">'
                f'<stop offset="0" stop-color="{amber}" stop-opacity="0"/>'
                f'<stop offset="1" stop-color="{amber}" stop-opacity="0.55"/></linearGradient>',
                f'    <linearGradient id="{pre}-fade-r" x1="0" x2="1" y1="0" y2="0">'
                f'<stop offset="0" stop-color="{amber}" stop-opacity="0.55"/>'
                f'<stop offset="1" stop-color="{amber}" stop-opacity="0"/></linearGradient>']
    if glow:
        # the region is the whole tile, so no halo is ever cut by a filter box
        out += [f'    <filter id="{pre}-glow" filterUnits="userSpaceOnUse" x="{_num(vb[0])}" y="{_num(vb[1])}" '
                f'width="{_num(vb[2])}" height="{_num(vb[3])}" color-interpolation-filters="sRGB">',
                f'      <feGaussianBlur in="SourceAlpha" stdDeviation="{_num(sigma)}" result="blur"/>',
                f'      <feFlood flood-color="{amber}" flood-opacity="0.32"/>',
                '      <feComposite in2="blur" operator="in" result="halo"/>',
                '      <feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge>',
                "    </filter>"]
    out.append("  </defs>")
    if bg:
        out.append(f'  <rect x="{_num(vb[0])}" y="{_num(vb[1])}" width="{_num(vb[2])}" height="{_num(vb[3])}" fill="{bg}"/>')
    for i, (kind, d, *rest) in enumerate(shapes):
        if kind == "striped":
            # solid amber, then the dark bands drawn over it inside the
            # letters' outline: the letters stay fully opaque (a <pattern>
            # tile is resampled, and its band edges left see-through seams)
            top, cap, n, edges = rest
            g = f' filter="url(#{pre}-glow)"' if glow else ""
            out.append(f'  <g{g}>')
            out.append(f'    <path d="{d}" fill="{amber}"/>')
            # crispEdges puts every band edge on a whole device pixel: smooth
            # edges straddled two rows each and, at 1.1 to 1.4 px a band
            # (the compact masthead at 1x, the share card), left one band at
            # 72% of its depth beside another at 100%
            out.append(f'    <g class="bands" clip-path="url(#{pre}-letters-{i})" fill="{dark}" shape-rendering="crispEdges">')
            if isinstance(n, list):
                # bands drawn for whole device pixels (pixel_bands): one
                # group per cap in device px, a class naming it ("k72": a
                # 72-row cap), the page's CSS showing the one that fits;
                # every group but the first is hidden until it does
                # (a cap 1.5 times another, five bands of 3 rows against 2,
                # can be the same drawing: one path then carries both names)
                drawn = {}
                for cls, group, shown in n:
                    if not group:
                        continue
                    x0, w0 = _num(vb[0]), _num(vb[2])
                    path = "".join(f"M{x0} {_num(y)}h{w0}v{_num(h)}h-{w0}z" for y, h in group)
                    if path in drawn:
                        drawn[path][0].append(cls)
                        drawn[path][1] |= shown
                    else:
                        drawn[path] = [[cls], shown]
                for path, (names, shown) in drawn.items():
                    hide = "" if shown else ' display="none"'
                    out.append(f'      <path class="{" ".join(names)}"{hide} d="{path}"/>')
            else:
                for y, h in snap_bands(stripe_bands(cap, n), top, edges, tol):
                    out.append(f'      <rect x="{_num(vb[0])}" y="{_num(y)}" width="{_num(vb[2])}" height="{_num(h)}"/>')
            out.append("    </g>")
            out.append("  </g>")
        elif kind == "code":
            out.append(f'  <path d="{d}" fill="{code_ink}"/>')
        elif kind in ("rule_l", "rule_r"):
            x, y, w, h = d
            if hairline:
                # one CSS pixel at every masthead width, on a whole device row:
                # the kit's 2-unit rule was 0.4px at 280 and 0.2px compact,
                # painted as a grey smear a third of the amber's strength
                out.append(f'  <line x1="{_num(x)}" x2="{_num(x + w)}" y1="{_num(y + h / 2)}" y2="{_num(y + h / 2)}" '
                           f'stroke="url(#{pre}-fade-{kind[-1]})" stroke-width="1" '
                           f'vector-effect="non-scaling-stroke" shape-rendering="crispEdges"/>')
            else:
                out.append(f'  <rect x="{_num(x)}" y="{_num(y)}" width="{_num(w)}" height="{_num(h)}" '
                           f'fill="url(#{pre}-fade-{kind[-1]})"/>')
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


# ── PNG ──────────────────────────────────────────────────────────────────

def rasterise(br, name):
    """The PNG for one SVG, exactly as written: rendered by Chromium at its
    own size. A dark tile is then floored at the ground and saved without
    an alpha channel. The floor is exact, since the glow only adds light:
    in its far tail 8-bit compositing rounded a contour of pixels one level
    below the ground, which shows as a faint ring once brightened or printed."""
    _, ground = FILES[name]
    vb, (w, h) = frame(FILES[name][0])
    return render(br, svg(name), w, h, GROUNDS[ground][0])


def render(br, text, w, h, ground=None):
    from PIL import Image, ImageChops
    pg = br.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
    pg.set_content('<!doctype html><html><head><style>html,body{margin:0;background:transparent}'
                   f'svg{{display:block;width:{w}px;height:{h}px}}</style></head><body>{text}</body></html>')
    pg.wait_for_timeout(150)
    raw = pg.screenshot(omit_background=True, clip={"x": 0, "y": 0, "width": w, "height": h})
    pg.close()
    im = Image.open(io.BytesIO(raw))
    if ground:
        im = ImageChops.lighter(im.convert("RGB"), Image.new("RGB", im.size, ground))
    return im


# ── the site's own marks ─────────────────────────────────────────────────
# Since the dark theme (owner's approval, 2026-10-07) the company flies this
# logo, and every mark the site serves is written here, so none can drift
# from the kit: the masthead wordmark inline in index.html, favicon.svg (the
# AC monogram on a rounded tile), logo.svg, the touch icon, the square logo
# the structured data names, and the share card.

SITE = HERE.parent.parent / "almuhallab"
# The masthead's stripes (owner's «use higher logo quality», 2026-10-08).
# The kit draws twenty bands; three thick ones were all the masthead could
# carry at 1x, and on a 3x phone it carried the same three. Now each state
# of the bar and each screen density draws the finest stripe it can render:
# two dark device rows in a period of seven, the banner's own proportion at
# device resolution (pixel_bands), so a 3x phone shows fifteen bands at the
# top of the bar and a 1x screen four. Each (cap x density) is one band
# group in the inline SVG and the CSS below shows one.
#
# The box is framed for whole pixels, not for the ink (topbar pass,
# 2026-10-07): the cap line sits ON the box's top edge and the width is the
# cap times MAST_PX / MAST_CAP, so a whole-pixel cap gives the width (and
# every cap below is whole: its top and the baseline fall on whole rows).
MAST_PX = 280
MAST_CAP = 30      # the scale: a 30px cap is a 280px word, 28 / 3 px of width per px of cap
MAST_OPEN = "<!-- logo-en:masthead · written by design/logo-en/build.py, do not edit by hand -->"
MAST_CLOSE = "<!-- /logo-en:masthead -->"
CSS_OPEN = "/* logo-en:css · written by design/logo-en/build.py, do not edit by hand */"
CSS_CLOSE = "/* /logo-en:css */"
# The bar's states, in cascade order (a later state outranks an earlier
# one where both match, as the page's own blocks do: a phone wins over a
# short screen): (what, media query, selector prefix, cap in CSS px).
# Bigger at the top of the bar (owner's request, 2026-10-08): 336 on a
# desktop (a 36px cap, was 280), 280 on a phone (30, was 220 and a 23.57px
# cap). The compact strip, on screen the whole visit, keeps its size, and so
# does a phone on its side, whose bar is a third of the screen: 196 there
# (21, was 200 and a 21.43px cap), within the share it had.
MAST_STATES = (
    ("the top of the bar", None, "", 36),
    ("scrolled", None, "html.scrolled ", 18),
    ("a phone on its side, a short screen", "(max-height: 500px)", "", 21),
    ("a phone", "(max-width: 640px)", "", 30),
    ("a phone or a short screen, scrolled", "(max-width: 640px), (max-height: 500px)", "html.scrolled ", 15),
)
# A group drawn for r x is shown from r x up: a band of two device rows at
# 2x is 2.6 rows at 2.625x and never fewer than two. Below 2x the 1x group
# (1.25x and 1.5x screens draw it 2.5 and 3 rows deep).
DENSITIES = ((1, None),
             (2, "(min-resolution: 2dppx), (-webkit-min-device-pixel-ratio: 2)"),
             (3, "(min-resolution: 3dppx), (-webkit-min-device-pixel-ratio: 3)"))


def mast_caps():
    """Every cap the masthead is drawn at, in device px, the first one shown
    by default (the desktop bar at 1x)."""
    caps = []
    for *_, cap in MAST_STATES:
        for r, _ in DENSITIES:
            if cap * r not in caps:
                caps.append(cap * r)
    return caps


def masthead():
    _, (l, t, r, b), _ = geometry("wordmark")
    vw = WORD.cap * MAST_PX / MAST_CAP
    vb = ((l + r) / 2 - vw / 2, t, vw, b - t + 4)
    flats = WORD.flat_fracs()
    groups = [(f"k{c}", band_group(WORD.cap, t, c, None, flats), i == 0) for i, c in enumerate(mast_caps())]
    text = svg("site-mast", shape="wordmark", ground="for-dark", bands=groups,
               framing=(vb, (MAST_PX, round(MAST_PX * vb[3] / vb[2]))), hairline=True)
    lines = text.splitlines()
    lines[0] = re.sub(r' width="\d+" height="\d+" role="img" aria-label="Almuhallab Code">',
                      ' class="logo" role="img" aria-label="المهلب كود · Almuhallab Code" focusable="false">', lines[0])
    assert 'class="logo"' in lines[0], lines[0]
    lines = [x for x in lines if "<!-- Almuhallab Code, the English logo" not in x and "JetBrains Mono (SIL OFL)" not in x]
    return "\n".join("      " + x for x in lines)


def glow_px(cap):
    """The halo at the kit's sigma per letter height (40 on a 148.4 cap)."""
    return round(cap * GLOW_SIGMA_EM * WORD.size / WORD.cap)


def site_css():
    """The masthead's size and its band group per state and density, and
    the footer mark's; the page's stylesheet carries this block between the
    logo-en:css markers, so a size and the stripe drawn for it cannot part."""
    pad = "    "
    out = [pad + CSS_OPEN,
           pad + "/* the masthead logo: its width per state (a whole-pixel cap times 28/3),",
           pad + "   the halo at the kit's sigma per letter height, and the one band group",
           pad + "   drawn for that cap at this density (k72: a 72-row cap) */"]

    def show(prefix, scope, cls):
        return f"{prefix}{scope} .bands > * {{ display: none; }} {prefix}{scope} .{cls} {{ display: inline; }}"

    for what, media, prefix, cap in MAST_STATES:
        w = cap * MAST_PX / MAST_CAP
        assert w == int(w), (what, w)
        body = [f"/* {what}: a cap of {cap}px */",
                f"{prefix}.brand .logo {{ width: {int(w)}px; --glow: {glow_px(cap)}px; }}"]
        for r, q in DENSITIES:
            rule = show(prefix, ".brand .logo", f"k{cap * r}")
            body.append(rule if q is None else f"@media {q} {{ {rule} }}")
        if media:
            out.append(pad + f"@media {media} {{")
            out += [pad + "  " + x for x in body]
            out.append(pad + "}")
        else:
            out += [pad + x for x in body]
    fm = footer_groups()
    out.append(pad + f"/* the footer's AC monogram, {FOOT_PX}px: solid where five bands of two rows")
    out.append(pad + "   cannot fit the A, striped where they can */")
    for r, q in DENSITIES:
        cls = f"k{FOOT_CAP * r}"
        if any(c == cls and g for c, g, _ in fm):
            rule = show("", ".fbrand .logo", cls)
        else:
            rule = ".fbrand .logo .bands > * { display: none; }"
        out.append(pad + (rule if q is None else f"@media {q} {{ {rule} }}"))
    out.append(pad + CSS_CLOSE)
    return "\n".join(out)


def with_masthead(html):
    pat = re.compile(re.escape(MAST_OPEN) + r".*?" + re.escape(MAST_CLOSE), re.S)
    if not pat.search(html):
        sys.exit("index.html has no logo-en:masthead markers")
    html = pat.sub(lambda _: MAST_OPEN + "\n" + masthead() + "\n      " + MAST_CLOSE, html, count=1)
    pat = re.compile(r"    " + re.escape(CSS_OPEN) + r".*?" + re.escape(CSS_CLOSE), re.S)
    if not pat.search(html):
        sys.exit("index.html has no logo-en:css markers")
    html = pat.sub(lambda _: site_css(), html, count=1)
    pat = re.compile(re.escape(FOOT_OPEN) + r".*?" + re.escape(FOOT_CLOSE), re.S)
    if not pat.search(html):
        sys.exit("index.html has no logo-en:footer markers")
    return pat.sub(lambda _: FOOT_OPEN + "\n" + footer_mark() + "\n          " + FOOT_CLOSE, html, count=1)


# ── the monogram at a known size ─────────────────────────────────────────
# The footer's mark and every PNG icon are drawn for one size in device
# pixels, so the monogram is framed for it: the A's cap a whole number of
# pixels (0.387 of the tile, rounded) starting on a whole row, the ink
# centred within half a pixel, and its five bands drawn in whole rows
# (pixel_bands). Where five bands of two rows cannot fit the A, it is solid.

FOOT_PX = 44
FOOT_CAP = round(FOOT_PX * MONO_A.cap / frame("monogram")[0][2])
FOOT_OPEN = "<!-- logo-en:footer · written by design/logo-en/build.py, do not edit by hand -->"
FOOT_CLOSE = "<!-- /logo-en:footer -->"
TILE_RX = 96 / 512          # the rounded tile of a favicon, as the site's tab icons always had


def mono_framing(size):
    """The viewBox that puts the monogram's A cap on whole pixels at `size`."""
    _, (l, t, r, b), _ = monogram()
    cap_px = round(size * MONO_A.cap / frame("monogram")[0][2])
    k = cap_px / MONO_A.cap                  # px per unit
    vw = size / k
    row = round(size / 2 - (b - t) / 2 * k)  # the cap line, on a whole row
    return ((l + r) / 2 - vw / 2, t - row / k, vw, vw), cap_px


def mono_tile(name, size, densities=(1,), rounded=False, shown=True):
    """The AC monogram on its dark tile, framed for `size` px, with one band
    group per density (a group for r x drawn for a cap of r times the cap)."""
    vb, cap_px = mono_framing(size)
    flats = MONO_A.flat_fracs()
    groups = [(f"k{cap_px * r}", band_group(MONO_A.cap, -MONO_A.cap, cap_px * r, MONO_BANDS, flats),
               shown and i == 0) for i, r in enumerate(densities)]
    text = svg(name, shape="monogram", ground="dark", bands=groups, framing=(vb, (size, size)))
    if rounded:
        ground = (f'<rect x="{_num(vb[0])}" y="{_num(vb[1])}" width="{_num(vb[2])}" height="{_num(vb[3])}" '
                  f'fill="{GROUND}"/>')
        assert ground in text
        text = text.replace(ground, ground.replace(' fill=', f' rx="{_num(vb[2] * TILE_RX)}" fill='))
    return text, cap_px, groups


def footer_groups():
    return mono_tile("site-foot", FOOT_PX, (1, 2, 3), rounded=True, shown=False)[2]


def footer_mark():
    """The footer's AC monogram, inline so the page's CSS can pick its band
    group by density: favicon.svg as an image cannot (an SVG image is not
    told the screen's resolution), so the footer showed it solid on every
    screen. At 44px its A has a 17px cap: no stripe fits at 1x, five bands of
    two rows fit at 2x, of three at 3x."""
    text = mono_tile("site-foot", FOOT_PX, (1, 2, 3), rounded=True, shown=False)[0]
    lines = text.splitlines()
    lines[0] = lines[0].replace(' role="img" aria-label="Almuhallab Code">',
                                ' class="logo" aria-hidden="true" focusable="false">')
    assert 'class="logo"' in lines[0], lines[0]
    lines = [x for x in lines if "<!-- Almuhallab Code, the English logo" not in x and "JetBrains Mono (SIL OFL)" not in x]
    return "\n".join("          " + x for x in lines)


def favicon():
    """The AC monogram on its own dark tile with the rounded corners of a
    favicon (the same 96/512 the site's tab icons always had)."""
    text = svg("almuhallab-code-monogram-dark")
    vb, _ = frame("monogram")
    text = re.sub(r' width="\d+" height="\d+"', "", text, count=1)
    ground = (f'<rect x="{_num(vb[0])}" y="{_num(vb[1])}" width="{_num(vb[2])}" height="{_num(vb[3])}" '
              f'fill="{GROUND}"/>')
    assert ground in text
    text = text.replace(ground, ground.replace(' fill=', f' rx="{_num(vb[2] * 96 / 512)}" fill='))
    # Up to 48px a band is under a pixel (0.31px in a 16px tab, 0.62 at 32)
    # and five of them wash the A into a muddy brown, so the A goes solid
    # amber there. A media query inside an SVG image measures the image
    # itself, in CSS px: resolution queries are not honoured there (tested:
    # max-resolution matched at 2x too), so the footer's 44px mark is solid
    # on every screen.
    style = ("  <style>@media (max-width: 48px) "
             "{ .bands { display: none } }</style>")
    return text.replace("  <defs>", style + "\n  <defs>", 1)


# The share card at twice the size (owner's «use higher logo quality»,
# 2026-10-08): 2400x1260, the same composition laid out at 1200x630 and
# rendered at 2x. 1200x630 carried ten bands where the kit draws twenty;
# at 2x the word's cap is 164 device rows (82 CSS px, framed whole, its cap
# line on a whole row where the old frame had it), which holds the kit's
# twenty at two rows a band. Every platform takes the size (Facebook's and
# LinkedIn's minimum is 1200x630; X allows 4096), and the file stays far
# under the 300 KB WhatsApp will preview.
OG_W, OG_H, OG_SCALE = 1200, 630, 2
OG_CAP = 82           # the wordmark's cap in the card's CSS px
OG_BANDS = 20         # the kit's own count
OG_LOCK = (900, 327)  # the lockup's box in the card, as before


def og(br):
    """The share card: the dark lockup with its glow, the company named in
    Arabic beneath it in Cairo, and the address in JetBrains Mono, as on the
    banner, laid out at 1200x630 and rendered at OG_SCALE. Fonts load from
    the site's own files."""
    from PIL import Image
    fonts = SITE / "fonts"
    _, (l, t, r, b), _ = lockup()
    k = OG_CAP / WORD.cap                       # CSS px per unit
    vb0, _ = frame("logo")
    row = round((t - vb0[1]) * OG_LOCK[0] / vb0[2])
    vb = ((l + r) / 2 - OG_LOCK[0] / k / 2, t - row / k, OG_LOCK[0] / k, OG_LOCK[1] / k)
    groups = [(f"k{OG_CAP * OG_SCALE}", band_group(WORD.cap, t, OG_CAP * OG_SCALE, OG_BANDS, WORD.flat_fracs()), True)]
    lock = svg("almuhallab-code-logo-dark", bands=groups, framing=(vb, OG_LOCK))
    ar = "U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFF, U+200C-200E"
    html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Cairo; font-weight: 700; src: url("{(fonts / 'cairo-700.woff2').as_uri()}") format("woff2"); unicode-range: {ar}; }}
@font-face {{ font-family: "JetBrains Mono"; font-weight: 100 800; src: url("{(fonts / 'jetbrainsmono-latin.woff2').as_uri()}") format("woff2"); }}
html, body {{ margin: 0; background: {GROUND}; }}
.c {{ width: {OG_W}px; height: {OG_H}px; display: flex; flex-direction: column; align-items: center; justify-content: center; }}
svg {{ display: block; width: {OG_LOCK[0]}px; height: {OG_LOCK[1]}px; }}
.ar {{ font: 700 34px/1.5 Cairo; color: {TAG_INK}; margin-top: 10px; }}
.url {{ font: 500 20px/1 "JetBrains Mono"; letter-spacing: .32em; color: {AMBER}; margin-top: 26px; direction: ltr; }}
</style></head><body><div class="c">{lock}<div class="ar" dir="rtl">المهلب كود · شركة برمجة وأنظمة</div>
<div class="url">www.almuhallab-code.com</div></div></body></html>"""
    tmp = HERE / ".og.html"
    tmp.write_text(html)
    pg = br.new_page(viewport={"width": OG_W, "height": OG_H}, device_scale_factor=OG_SCALE)
    pg.goto(tmp.as_uri())
    pg.evaluate("Promise.all([document.fonts.load('700 34px Cairo', 'المهلب'), document.fonts.load('500 20px \"JetBrains Mono\"', 'www')])")
    pg.wait_for_timeout(200)
    ok = pg.evaluate("document.fonts.check('700 34px Cairo', 'المهلب') && document.fonts.check('500 20px \"JetBrains Mono\"', 'www')")
    top = pg.evaluate("document.querySelector('svg').getBoundingClientRect().top")
    raw = pg.screenshot(clip={"x": 0, "y": 0, "width": OG_W, "height": OG_H})
    pg.close()
    tmp.unlink()
    if not ok:
        sys.exit("the share card's faces failed to load: refusing to draw a fallback")
    if top != int(top):
        sys.exit(f"the share card's lockup starts at {top}px: its cap line would fall between rows")
    return Image.open(io.BytesIO(raw)).convert("RGB")


def site_text():
    return {SITE / "favicon.svg": favicon(), SITE / "logo.svg": svg("almuhallab-code-logo-dark")}


# The company's icons (owner's «use higher logo quality», 2026-10-08). Each
# PNG is drawn for its own size by mono_tile: the A's cap whole, its five
# bands whole rows where two rows or more fit (four rows a band at 180 and
# 192, ten at 512), solid below (a tab's 32 and 48, where a band would be
# under a row and five would wash the A brown). The tab sizes and the 192
# sit on the favicon's rounded tile; the touch icon and the square logo
# fill the square, which the platform rounds or crops itself.
ICONS = (
    ("favicon-32.png", 32, True),
    ("favicon-48.png", 48, True),
    ("favicon-192.png", 192, True),
    ("apple-touch-icon.png", 180, False),
    ("logo-512.png", 512, False),
    ("logo-1024.png", 1024, False),     # the structured data's logo, at twice the 512
)


def icon_png(br, size, rounded):
    """One icon, rasterised from its own SVG at its own size. A full square is
    floored at the ground and saved without alpha, as the kit's dark tiles
    are; a rounded tile keeps its transparent corners, and is floored at the
    ground only where it is opaque."""
    from PIL import Image, ImageChops
    text = mono_tile(f"site-icon-{size}", size, (1,), rounded=rounded)[0]
    if not rounded:
        return render(br, text, size, size, GROUND)
    im = render(br, text, size, size)
    rgb = ImageChops.lighter(im.convert("RGB"), Image.new("RGB", im.size, GROUND))
    rgb.putalpha(im.getchannel("A"))
    return rgb


def site_pngs(br):
    out = {SITE / name: icon_png(br, size, rounded) for name, size, rounded in ICONS}
    out[SITE / "og.png"] = og(br)
    return out


def sheet(br, out_path=None):
    """One page that shows each file on the grounds it is made for, with a
    checkerboard under the transparent ones so their edges can be judged,
    and the monogram cut to a circle at the sizes profile photos are shown."""
    def checker(a, b):
        return (f"background-color:{a};background-image:linear-gradient(45deg,{b} 25%,transparent 25%),"
                f"linear-gradient(-45deg,{b} 25%,transparent 25%),linear-gradient(45deg,transparent 75%,{b} 75%),"
                f"linear-gradient(-45deg,transparent 75%,{b} 75%);background-size:24px 24px;"
                "background-position:0 0,0 12px,12px -12px,-12px 0")
    light_check, dark_check = checker("#ffffff", "#d9dce1"), checker("#1b1d22", "#2b2f36")
    cells = []
    for name, (shape, ground) in FILES.items():
        grounds = {"dark": [("own ground", "")],
                   "for-dark": [("on #1b1d22", "background:#1b1d22"), ("on a dark checker", dark_check)],
                   "for-light": [("on white", "background:#ffffff"), ("on a light checker", light_check)]}[ground]
        for label, style in grounds:
            sq = shape == "monogram"
            cells.append(f'<figure style="margin:0"><div style="{style};border:1px solid #2b2f36;'
                         f'display:flex;align-items:center;justify-content:center;height:300px">'
                         f'<img src="{name}.png" style="max-width:{"280px" if sq else "92%"};max-height:92%"></div>'
                         f'<figcaption style="font:500 15px/1.4 monospace;color:#c9ced6;padding:8px 0 0">'
                         f'{name} · {label}</figcaption></figure>')
    circles = "".join(f'<div style="text-align:center;font:500 13px monospace;color:#8a919a">'
                      f'<img src="almuhallab-code-monogram-dark.png" style="width:{s}px;height:{s}px;'
                      f'border-radius:50%;display:block;margin:0 auto 6px">{s}px</div>' for s in (150, 110, 44, 32))
    cells.append('<figure style="margin:0"><div style="background:#ffffff;border:1px solid #2b2f36;display:flex;'
                 'align-items:flex-end;justify-content:center;gap:36px;height:300px;padding-bottom:40px;'
                 f'box-sizing:border-box">{circles}</div><figcaption style="font:500 15px/1.4 monospace;'
                 'color:#c9ced6;padding:8px 0 0">almuhallab-code-monogram-dark · as a profile photo</figcaption></figure>')
    html = ('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#111316;padding:32px;'
            'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}</style></head><body>'
            + "".join(cells) + "</body></html>")
    tmp = HERE / ".sheet.html"
    tmp.write_text(html)
    pg = br.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1)
    pg.goto(tmp.as_uri())
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(out_path or HERE / "preview-sheet.png"), full_page=True)
    pg.close()
    tmp.unlink()


# ── README ───────────────────────────────────────────────────────────────

def readme():
    what = {"logo": "full lockup", "wordmark": "wordmark", "monogram": "monogram (square)"}
    where = {"dark": "on its own near-black ground",
             "for-dark": "transparent, for dark backgrounds",
             "for-light": "transparent, for white and light backgrounds"}
    rows = [f"| `{n}.svg` · `.png` | {what[s]}, {where[g]} | {frame(s)[1][0]} × {frame(s)[1][1]} |"
            for n, (s, g) in FILES.items()]
    return f"""# Almuhallab Code, English logo

The lockup from the English banner: **ALMUHALLAB** in Chakra Petch Bold with
the striped amber fill, **CODE** in Chakra Petch SemiBold between two fading
rules, and the terminal line `>_ SOFTWARE & SYSTEMS` in JetBrains Mono. The
monogram is its first letters: the striped amber **A** and the **C** in
CODE's ink (white on dark, `{LIGHT_CODE}` on light).

Generated by `build.py`; do not edit the files by hand. Every letter is an
outline, so the SVGs need no font installed, and every PNG is rasterised
from its SVG.

| File | What | PNG size (px) |
|---|---|---|
{chr(10).join(rows)}

`preview-sheet.png` shows each one on the grounds it is made for (the
transparent files also on a checker of their own lightness, so their edges
can be judged), and the monogram cut to a circle at 150, 110, 44 and 32 px.

## Which one to use

- **Full lockup** where there is room to read the terminal line: a header,
  a slide, a banner, print. Below about 600 px wide, use the wordmark.
- **Wordmark** (no terminal line) where the logo is smaller.
- **Monogram** for profile photos, app icons and favicons, where the name
  cannot be read at all. Its ink sits inside 80% of the circle the
  platforms cut a profile photo to, so nothing is shaved off. Its stripes
  show from about 110 px up on an ordinary screen; smaller, they blend into
  the amber and the AC still reads.
- On a dark background use `-dark` or `-for-dark`; on white or light grey use
  `-for-light`. Never put `-for-dark` on white: its CODE is white.
- The `-dark` PNGs are opaque (no alpha channel); the others are transparent.

## Colour

| Use | Colour | Contrast |
|---|---|---|
| Amber on dark | `{AMBER}` | {contrast(AMBER, GROUND):.1f}:1 on `{GROUND}` |
| Amber on light | `{AMBER_LIGHT}` | {contrast(AMBER_LIGHT, '#ffffff'):.2f}:1 on white |
| CODE on dark | `{CODE_INK}` | {contrast(CODE_INK, GROUND):.1f}:1 |
| CODE on light | `{LIGHT_CODE}` | {contrast(LIGHT_CODE, '#ffffff'):.1f}:1 |
| Terminal line on light | `{LIGHT_TAG}` | {contrast(LIGHT_TAG, '#ffffff'):.1f}:1 |
| Stripes | the amber at 55%: `{shade(AMBER, STRIPE)}` on dark, `{shade(AMBER_LIGHT, STRIPE)}` on light | |

The banner's amber reads only {contrast(AMBER, '#ffffff'):.2f}:1 on white, too
faint for a mark. The light version keeps its perceived hue and chroma
(OKLCH) and lowers only the lightness until it clears 3:1, so it reads as
the same gold, darker, rather than turning orange.

## Clear space

Keep at least the height of CODE's capitals clear on every side. The wide
PNGs already carry 3/4 of the wordmark's cap height as margin.

## Fonts

Chakra Petch (Cadson Demak) and JetBrains Mono (JetBrains), both under the
SIL Open Font License; the licences are in `fonts/`.

## Rebuild

    python3 design/logo-en/build.py           # writes everything here
    python3 design/logo-en/build.py --check   # fails if any SVG, PNG, the sheet or this README drifted
"""


# ── main ─────────────────────────────────────────────────────────────────

def _differs(a, b):
    """The pixels where two images differ by more than 2 levels in any
    channel, as a bounding box, or None. Two levels of slack let a different
    Chromium build pass; a hand edit does not. Transparent images are
    compared premultiplied, so a fully transparent pixel never counts, and
    on every channel: Pillow's getbbox() looks only at alpha by default, and
    a recoloured PNG with its alpha untouched passed (a reviewer proved it)."""
    from PIL import ImageChops
    if a.size != b.size or a.mode != b.mode:
        return f"{a.mode} {a.size} vs {b.mode} {b.size}"
    if a.mode == "RGBA":
        a, b = a.convert("RGBa"), b.convert("RGBa")
    diff = ImageChops.difference(a, b).point(lambda v: 255 if v > 2 else 0)
    return diff.getbbox(alpha_only=False)


def main():
    from PIL import Image
    from playwright.sync_api import sync_playwright
    want = {HERE / f"{n}.svg": svg(n) for n in FILES}
    want[HERE / "README.md"] = readme()
    if "--check" in sys.argv:
        stale = [p.name for p, t in want.items() if not p.exists() or p.read_text() != t]
        stale += [f"site/{p.name}" for p, t in site_text().items() if not p.exists() or p.read_text() != t]
        page = (SITE / "index.html").read_text()
        if with_masthead(page) != page:
            stale.append("site/index.html (the masthead wordmark)")
        owners = {}
        for p, t in want.items():
            for i in re.findall(r'\bid="([^"]+)"', t):
                owners.setdefault(i, set()).add(p.name)
        shared = sorted(i for i, o in owners.items() if len(o) > 1)
        if shared:
            stale.append("ids shared between files: " + ", ".join(shared[:4]))
        with sync_playwright() as p:
            br = p.chromium.launch(executable_path=CHROME)
            for n in FILES:
                path = HERE / f"{n}.png"
                if not path.exists():
                    stale.append(f"{n}.png (missing)")
                    continue
                bad = _differs(rasterise(br, n), Image.open(path))
                if bad:
                    stale.append(f"{n}.png ({bad})")
            for path, im in site_pngs(br).items():
                bad = _differs(im, Image.open(path)) if path.exists() else "missing"
                if bad:
                    stale.append(f"site/{path.name} ({bad})")
            if not (HERE / "preview-sheet.png").exists():
                stale.append("preview-sheet.png (missing)")
            else:
                with tempfile.TemporaryDirectory() as tmp:
                    fresh = pathlib.Path(tmp) / "sheet.png"
                    sheet(br, fresh)
                    bad = _differs(Image.open(fresh).convert("RGB"), Image.open(HERE / "preview-sheet.png").convert("RGB"))
                if bad:
                    stale.append(f"preview-sheet.png ({bad})")
            br.close()
        if stale:
            sys.exit("English logo drifted: " + ", ".join(stale))
        print(f"English logo is current: {len(FILES)} SVGs, {len(FILES)} PNGs and the sheet re-rendered, README; "
              "the site's favicon, logo, masthead with its CSS, footer mark, "
              f"{len(ICONS)} icons ({', '.join(str(n) for _, n, _ in ICONS)}) and the share card")
        return
    for old in HERE.glob("almuhallab-code-*"):
        if old.stem not in FILES:
            old.unlink()
            print("  removed", old.name)
    for p, t in want.items():
        p.write_text(t)
        print("  wrote", p.name)
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=CHROME)
        for n in FILES:
            im = rasterise(br, n)
            im.save(HERE / f"{n}.png", optimize=True)
            print("  wrote", f"{n}.png", f"{im.size[0]}×{im.size[1]}", im.mode)
        sheet(br)
        print("  wrote preview-sheet.png")
        for path, t in site_text().items():
            path.write_text(t)
            print("  wrote site", path.name)
        page = SITE / "index.html"
        page.write_text(with_masthead(page.read_text()))
        print("  wrote site index.html masthead")
        for path, im in site_pngs(br).items():
            im.save(path, optimize=True)
            print("  wrote site", path.name, f"{im.size[0]}×{im.size[1]}", f"{path.stat().st_size // 1024} KB")
        br.close()


if __name__ == "__main__":
    main()
