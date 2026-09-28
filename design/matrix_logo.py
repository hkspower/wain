#!/usr/bin/env python3
"""Build the Almuhallab "matrix code" logo pack — design/matrix-logo/.

The approved concept: the Kuwaiti boum under sail, drawn as a field of code
glyphs, beside المهلب in Reem Kufi. This is a campaign/alternate mark; the
site's locked identity (logo.svg, the sprite) is untouched by it.

Every letter in every SVG is outlined to a path at build time — shaped by
HarfBuzz, drawn from the font's own outlines — so the files open identically
on a machine that has none of the fonts. The PNGs are rendered by the same
Chromium the rest of the design tooling uses.

    python3 design/matrix_logo.py
"""

import io
import random
import shutil
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "design" / "matrix-logo"
FONTS = OUT / "fonts"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

KUFI = FONTS / "ReemKufi-Bold.ttf"
MONO = FONTS / "ShareTechMono-Regular.ttf"
CAIRO = ROOT / "almuhallab" / "fonts" / "cairo-700.woff2"

GLYPHS = "0123456789ABCDEF{}[]<>/=+*#$%;:"
# Cells on the ship draw only from dense glyphs: a lit `;` or `-` is a hole in
# the sail, and enough of them made the silhouette read as ragged.
DENSE = "0689#$%&@BDEHMNQRW"
SEED = 1971

# Every colour is a site token: --ord-1 · --sand-vivid · --tint · --tint-strong
# · --text · --muted. Nothing here is picked by eye.
GROUNDS = {
    "dark": dict(bg="#0b0705", on="#e3a556", off="#c08552", dim=(0.10, 0.20),
                 word="#e3a556", ink="#f1e3d3", rule="#c08552", glow=True),
    "brown": dict(bg="#6f3f1c", on="#fff4e6", off="#e3a556", dim=(0.14, 0.24),
                  word="#ffffff", ink="#ffffff", rule="#e3a556", glow=True),
    "white": dict(bg="#ffffff", on="#7a4418", off="#434d55", dim=(0.12, 0.22),
                  word="#7a4418", ink="#1b2430", rule="#7a4418", glow=False),
}

# The boum, in unit coordinates of a 3:2 box. Four things make her a boum and
# all four are here: double-ended hull with a raked stem, filled lateen sails,
# tall mainmast forward, short mizzen aft.
BOUM = [
    [(0.10, 0.60), (0.52, 0.04), (0.56, 0.62)],                       # main sail
    [(0.61, 0.62), (0.79, 0.26), (0.84, 0.62)],                       # mizzen sail
    [(0.525, 0.04), (0.545, 0.04), (0.545, 0.68), (0.525, 0.68)],     # mainmast
    [(0.785, 0.26), (0.805, 0.26), (0.805, 0.68), (0.785, 0.68)],     # mizzen mast
    [(0.03, 0.60), (0.07, 0.68), (0.93, 0.68), (0.98, 0.58), (0.995, 0.60),
     (0.94, 0.79), (0.72, 0.87), (0.36, 0.87), (0.14, 0.79)],         # hull
    [(0.035, 0.605), (0.065, 0.605), (0.03, 0.44), (0.005, 0.45)],    # stem
]


class Face:
    def __init__(self, path):
        self.tt = TTFont(path)
        # HarfBuzz cannot read WOFF2; hand it the decompressed sfnt instead,
        # or every glyph of the site's Cairo shapes to .notdef and prints tofu.
        if self.tt.flavor:
            self.tt.flavor = None
            buf = io.BytesIO()
            self.tt.save(buf)
            self.tt = TTFont(io.BytesIO(buf.getvalue()))
            data = buf.getvalue()
        else:
            data = path.read_bytes()
        self.hb = hb.Font(hb.Face(data))
        self.upem = self.tt["head"].unitsPerEm
        self.glyphs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        hhea = self.tt["hhea"]
        self.ascent, self.descent = hhea.ascent, hhea.descent

    def shape(self, text, rtl=False):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        if rtl:
            buf.direction = "rtl"
        hb.shape(self.hb, buf, {})
        return buf.glyph_infos, buf.glyph_positions

    def run(self, text, size, x, baseline, rtl=False, tracking=0.0):
        """One line outlined to a single path `d`, left edge at x. Returns (d, width).
        HarfBuzz hands RTL runs back in visual left-to-right order."""
        infos, pos = self.shape(text, rtl)
        s = size / self.upem
        pen = SVGPathPen(self.glyphs)
        cx = 0.0
        for i, (info, p) in enumerate(zip(infos, pos)):
            name = self.order[info.codepoint]
            tp = TransformPen(pen, (s, 0, 0, -s, x + (cx + p.x_offset) * s,
                                    baseline - p.y_offset * s))
            self.glyphs[name].draw(tp)
            cx += p.x_advance + (tracking * self.upem if i < len(infos) - 1 else 0)
        return pen.getCommands(), cx * s

    def width(self, text, size, rtl=False, tracking=0.0):
        infos, pos = self.shape(text, rtl)
        adv = sum(p.x_advance for p in pos) + tracking * self.upem * (len(infos) - 1)
        return adv * size / self.upem

    def glyph_path(self, ch, size):
        """A single code glyph centred on (0,0) so a <use> places it by cell centre."""
        infos, pos = self.shape(ch)
        s = size / self.upem
        adv = pos[0].x_advance * s
        pen = SVGPathPen(self.glyphs)
        tp = TransformPen(pen, (s, 0, 0, -s, -adv / 2, size * 0.36))
        self.glyphs[self.order[infos[0].codepoint]].draw(tp)
        return pen.getCommands()


def inside(px, py, poly):
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def on_boum(u, v):
    return any(inside(u, v, p) for p in BOUM)


def code_field(mono, cols, rows, cell, x0, y0, box, g, rng, prefix):
    """The mark: a cols×rows glyph grid; cells whose centre falls on the boum
    burn bright. `box` = (bx, by, bw, bh) in grid units where the 3:2 ship sits."""
    size = cell * 0.92
    defs = "".join(f'<path id="{prefix}{i}" d="{mono.glyph_path(ch, size)}"/>'
                   for i, ch in enumerate(GLYPHS))
    defs += "".join(f'<path id="{prefix}d{i}" d="{mono.glyph_path(ch, size)}"/>'
                    for i, ch in enumerate(DENSE))
    bright, dim = [], []
    bx, by, bw, bh = box
    for r in range(rows):
        for c in range(cols):
            u, v = (c + 0.5 - bx) / bw, (r + 0.5 - by) / bh
            x, y = x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell
            if 0 <= u <= 1 and 0 <= v <= 1 and on_boum(u, v):
                di = rng.randrange(len(DENSE))
                bright.append(f'<use href="#{prefix}d{di}" x="{x:.2f}" y="{y:.2f}"/>')
            else:
                gi = rng.randrange(len(GLYPHS))
                use = f'<use href="#{prefix}{gi}" x="{x:.2f}" y="{y:.2f}"'
                lo, hi = g["dim"]
                dim.append(use + f' opacity="{rng.uniform(lo, hi):.2f}"/>')
    glow = f' filter="url(#{prefix}glow)"' if g["glow"] else ""
    body = (f'<g fill="{g["off"]}">{"".join(dim)}</g>'
            f'<g fill="{g["on"]}"{glow}>{"".join(bright)}</g>')
    return defs, body


def glow_filter(prefix, radius):
    return (f'<filter id="{prefix}glow" x="-20%" y="-20%" width="140%" height="140%">'
            f'<feGaussianBlur stdDeviation="{radius}" result="b"/>'
            f'<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>'
            f'</filter>')


def doc(w, h, g, defs, body, transparent, title):
    bg = "" if transparent else f'<rect width="{w}" height="{h}" fill="{g["bg"]}"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
            f'width="{w}" height="{h}" role="img" aria-label="{title}">'
            f'<title>{title}</title><defs>{defs}</defs>{bg}{body}</svg>\n')


# ---------------------------------------------------------------- layouts

def mark(faces, g, transparent):
    """Square icon: the whole tile is code; the ship burns out of it."""
    kufi, mono, cairo = faces
    W = H = 1024
    cols = rows = 48
    cell = W / cols
    defs, body = code_field(mono, cols, rows, cell, 0, 0,
                            (3, 11, 42, 28), g, random.Random(SEED), "m")
    if g["glow"]:
        defs += glow_filter("m", 3)
    return doc(W, H, g, defs, body, transparent, "Almuhallab Code — boum in code")


def wordmark_block(faces, g, cx_right, top, scale, align="right"):
    """المهلب / ALMUHALLAB CODE / >_ شركة برمجة وأنظمة, right-aligned at cx_right
    (or centred on it). Returns (svg, width, height)."""
    kufi, mono, cairo = faces
    out, y, widths = [], top, []
    ar_size = 250 * scale
    w = kufi.width("المهلب", ar_size, rtl=True)
    widths.append(w)
    x = cx_right - w if align == "right" else cx_right - w / 2
    base = y + ar_size * 1.0
    d, _ = kufi.run("المهلب", ar_size, x, base, rtl=True)
    glow = ' filter="url(#wglow)"' if g["glow"] else ""
    out.append(f'<path d="{d}" fill="{g["word"]}"{glow}/>')
    y = base + ar_size * 0.40

    en = "ALMUHALLAB CODE"
    en_size = 56 * scale
    track = 0.42
    w = mono.width(en, en_size, tracking=track)
    widths.append(w)
    x = cx_right - w if align == "right" else cx_right - w / 2
    base = y + en_size
    d, _ = mono.run(en, en_size, x, base, tracking=track)
    out.append(f'<path d="{d}" fill="{g["ink"]}"/>')
    y = base + en_size * 0.9

    tag = "شركة برمجة وأنظمة"
    t_size = 42 * scale
    p_size = 38 * scale
    gap = 18 * scale
    tw = cairo.width(tag, t_size, rtl=True)
    pw = mono.width("_<", p_size)
    total = pw + gap + tw
    widths.append(total)
    x = cx_right - total if align == "right" else cx_right - total / 2
    base = y + t_size * 1.05
    # RTL: the line starts on the right, so the prompt leads from there, and
    # its chevron is bidi-mirrored to point at the text — what a browser does
    # to ">_" in an RTL line, done by hand because these glyphs are outlines
    d, _ = cairo.run(tag, t_size, x, base, rtl=True)
    out.append(f'<path d="{d}" fill="{g["ink"]}"/>')
    d, _ = mono.run("_<", p_size, x + tw + gap, base)
    out.append(f'<path d="{d}" fill="{g["rule"]}"/>')
    y = base + t_size * 0.45
    return "".join(out), max(widths), y - top


def horizontal(faces, g, transparent):
    kufi, mono, cairo = faces
    W, H = 2400, 720
    gutter = 72
    # mark on the RTL start (right), text to its left, right-aligned; the pair
    # is measured and centred as one unit, not pinned to the right edge
    cols, rows = 48, 32
    cell = 13.5
    mw, mh = cols * cell, rows * cell
    _, tw, _ = wordmark_block(faces, g, 0, 0, 0.9)
    total = tw + gutter + 2 + gutter + mw
    mx, my = (W + total) / 2 - mw, (H - mh) / 2
    defs, body = code_field(mono, cols, rows, cell, mx, my,
                            (0, 0, 48, 32), g, random.Random(SEED + 1), "h")
    if g["glow"]:
        defs += glow_filter("h", 2) + glow_filter("w", 7)
    rule_x = mx - gutter - 2
    body += (f'<rect x="{rule_x:.1f}" y="{my:.1f}" width="2" height="{mh:.1f}" '
             f'fill="{g["rule"]}" opacity="0.6"/>')
    text, _, th = wordmark_block(faces, g, rule_x - gutter, 0, 0.9)
    body += f'<g transform="translate(0 {(H - th) / 2:.1f})">{text}</g>'
    return doc(W, H, g, defs, body, transparent, "Almuhallab Code — horizontal lockup")


def stacked(faces, g, transparent):
    kufi, mono, cairo = faces
    W, H = 1600, 1600
    cols, rows = 60, 40
    cell = 16
    mw, mh = cols * cell, rows * cell
    gap = 40
    _, _, th = wordmark_block(faces, g, 0, 0, 1.0, align="center")
    mx = (W - mw) / 2
    my = (H - (mh + gap + th)) / 2
    defs, body = code_field(mono, cols, rows, cell, mx, my,
                            (0, 0, 60, 40), g, random.Random(SEED + 2), "s")
    if g["glow"]:
        defs += glow_filter("s", 2.5) + glow_filter("w", 8)
    text, _, _ = wordmark_block(faces, g, W / 2, my + mh + gap, 1.0, align="center")
    body += text
    return doc(W, H, g, defs, body, transparent, "Almuhallab Code — stacked lockup")


# ---------------------------------------------------------------- output

LAYOUTS = {"mark": (mark, [1024, 512, 180]),
           "horizontal": (horizontal, [2400, 1200]),
           "stacked": (stacked, [1600, 800])}


def main():
    faces = (Face(KUFI), Face(MONO), Face(CAIRO))
    svg_dir, png_dir = OUT / "svg", OUT / "png"
    for d in (svg_dir, png_dir):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)

    jobs = []
    for name, (build, sizes) in LAYOUTS.items():
        for ground, g in GROUNDS.items():
            svg = build(faces, g, transparent=False)
            p = svg_dir / f"almuhallab-matrix-{name}-{ground}.svg"
            p.write_text(svg)
            jobs.append((p, sizes, False))
        # a transparent cut for placing on a ground of the user's own
        for ground in ("dark", "white"):
            svg = build(faces, GROUNDS[ground], transparent=True)
            p = svg_dir / f"almuhallab-matrix-{name}-{ground}-transparent.svg"
            p.write_text(svg)
            jobs.append((p, sizes, True))

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME)
        page = browser.new_page()
        for path, sizes, transparent in jobs:
            text = path.read_text()
            vw = float(text.split('viewBox="0 0 ')[1].split()[0])
            vh = float(text.split('viewBox="0 0 ')[1].split()[1].rstrip('"'))
            for w in sizes:
                h = round(w * vh / vw)
                page.set_viewport_size({"width": w, "height": h})
                body = text.replace(f'width="{int(vw)}" height="{int(vh)}"',
                                    f'width="{w}" height="{h}"', 1)
                page.set_content(f'<body style="margin:0;background:transparent">{body}</body>')
                page.screenshot(path=str(png_dir / f"{path.stem}-{w}.png"),
                                omit_background=transparent)
        browser.close()

    print(f"design/matrix-logo — {len(jobs)} SVG, "
          f"{len(list(png_dir.glob('*.png')))} PNG")


if __name__ == "__main__":
    main()
