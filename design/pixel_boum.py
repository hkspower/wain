#!/usr/bin/env python3
"""The Almuhallab mark as a pixel boum — the one source of the site's logo.

The ship is the same polygons the matrix-code pack draws in glyphs
(design/matrix_logo.py: BOUM), rasterised onto a cell grid:

  * wide form  — #i-boum in index.html and almuhallab/logo.svg (masthead, print)
  * square form — #i-sail in index.html and almuhallab/favicon.svg (tab, footer)

The square form is a hand-set 16×16 bitmap, not a rasterisation: at 16px
every cell is exactly one screen pixel, which is the only way a mark this
small stays sharp. It is cropped as the old square form was — one hull, one
stem, one mast, one lateen sail — and it is still a boum: double-ended, raked
stem forward, sail peaked high at the mast, sheer rising into both ends.

It also writes how the masthead shows the wide form — its window onto the
ship and the pixel hint that keeps her cells and gaps whole at bar sizes
(see "the masthead's hint" below). Which cells are lit never changes there.

    python3 design/pixel_boum.py            # write all four places
    python3 design/pixel_boum.py --check    # exit 1 if any has drifted
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from matrix_logo import BOUM, on_boum  # noqa: E402  the one drawing of the ship

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "almuhallab"
PAGE = SITE / "index.html"

# ---------------------------------------------------------------- wide form
# 48×24 viewBox (the masthead's 2:1 box). The ship keeps her true 3:2
# proportions on a 36×24 grid, centred; nothing is stretched.
W_COLS, W_ROWS, W_X0 = 36, 24, 6
W_GAP = 0.18            # the gap between cells IS the code texture; one
                        # unit is ~3px at the masthead, so this reads as a seam

# ---------------------------------------------------------------- square form
# Bow to the left, as in the wide form. '#' = lit.
SQUARE = [
    "................",
    "..........#.....",
    ".........##.....",
    "........###.....",
    ".......####.....",
    "......#####.....",
    ".....######.....",
    "....#######.....",
    "...########.....",
    "..#########.....",
    ".#........#...#.",
    ".##.......#..##.",
    "..############..",
    "...##########...",
    "....########....",
    "................",
]
S_GAP = 0.06            # a hair at 16px (sub-pixel), a seam at 180px


def cells_path(cells, size, gap):
    """One path, one square subpath per lit cell."""
    s = size - gap
    return "".join(f"M{x * size + gap / 2:g} {y * size + gap / 2:g}h{s:g}v{s:g}h{-s:g}z"
                   for x, y in cells)


W_SAMPLES = 4          # 4×4 points per cell
W_COVER = 0.30         # lit when the ship covers this much of the cell: centre
                       # sampling alone dropped the thin stem into floating dots


def wide_cells():
    out, n = [], W_SAMPLES
    for r in range(W_ROWS):
        for c in range(W_COLS):
            hits = sum(on_boum((c + (i + 0.5) / n) / W_COLS, (r + (j + 0.5) / n) / W_ROWS)
                       for i in range(n) for j in range(n))
            if hits / (n * n) >= W_COVER:
                out.append((c + W_X0, r))
    return out


def square_cells():
    return [(x, y) for y, row in enumerate(SQUARE) for x, ch in enumerate(row) if ch == "#"]


def fmt(v):
    return f"{v:.3f}".rstrip("0").rstrip(".")


def wide_d():
    cells = wide_cells()
    s = 1 - W_GAP
    return "".join(f"M{fmt(x + W_GAP / 2)} {fmt(y + W_GAP / 2)}h{fmt(s)}v{fmt(s)}h-{fmt(s)}z"
                   for x, y in cells)


def square_d(unit):
    s = unit * (1 - S_GAP)
    g = unit * S_GAP / 2
    return "".join(f"M{fmt(x * unit + g)} {fmt(y * unit + g)}h{fmt(s)}v{fmt(s)}h-{fmt(s)}z"
                   for x, y in square_cells())


# ------------------------------------------------------- the masthead's hint
# The canonical #i-boum leaves 0.18 of every cell as gap. That is a seam at
# print sizes, but in the masthead a cell is 2–4 CSS px, so the gap is 0.36–
# 0.72 of a pixel: it lands between device pixels, half the gaps vanish into
# grey and the white ship reads blurred. So the masthead rasterises her the
# way a font is hinted — the same lit cells, drawn for the pixel grid in
# front of it:
#
#   * a cell is a whole number of DEVICE pixels, q = round(cell × ratio),
#     never less than 2; the box is sized from q, so 36 cells are 36q pixels
#   * the gap is the whole pixel count nearest the drawing's 0.18 of a cell,
#     g = max(1, round(0.18 q)) — never less than one pixel, so it is never
#     filled: 3+1 at 4px, 7+1 at 8px, 10+2 at 12px
#   * each row of the ship is one line, dashed into cells: stroke-width is
#     the cell's height, the dash its width, the dash gap the seam. The cells
#     lit are wide_cells() exactly (asserted below); only their size moves.
#   * the browser rounds the box to whole CSS px, which at 1.25×, 1.75× or
#     2.625× is not a whole device pixel, so the cells are drawn crispEdges
#     (no part-lit pixels) and nudged by HINT_NUDGE of a device pixel. With
#     every edge on one shared fraction they all round the same way — unless
#     that fraction sits near ½, where float noise decides each edge and a
#     cell gains a pixel or a gap closes. Measured: a ¼ px nudge put a box at
#     .25 exactly on ½ (1.75×: one gap filled down a whole column); 0.27 left
#     it .02 away and the first cell of a run still flipped (2.75×). 1/16 is
#     as far from ½ as a box offset in eighths allows (1/16 for all of them,
#     ≥ .10 for thirds, .04 for tenths). Swept — eleven ratios from 1× to
#     3×, desktop and phone, four widths each, both bar states — 176 of 176
#     render every cell q − g pixels wide, with no part-lit pixel.
#
# The page hands over --dpr (CSS cannot read the pixel ratio). Without it
# the bar assumes 1, which is still exact at 1×, 2× and 3×. Without CSS
# round() the box keeps --cell; where `d` is not a CSS property the
# symbol's own drawing shows. Each step back is the mark as it was.
MAST_PRE = '<svg class="logo" viewBox="'
MAST_RE = re.compile(r'<svg class="logo" viewBox="[^"]*" aria-hidden="true">'
                     r'(?:<svg width="48" height="24">)?<use href="#i-boum"/>(?:</svg>)?</svg>')
HINT_NUDGE = 0.0625
HINT_RE = re.compile(r"/\* pixel-boum:hint \*/.*?/\* /pixel-boum:hint \*/", re.S)


def wide_runs():
    """The lit cells as horizontal runs: (x, y, length)."""
    lit = set(wide_cells())
    runs = []
    for y in range(W_ROWS):
        x = 0
        while x < 48:
            if (x, y) in lit:
                start = x
                while (x, y) in lit:
                    x += 1
                runs.append((start, y, x - start))
            else:
                x += 1
    back = {(x + i, y) for x, y, n in runs for i in range(n)}
    assert back == lit, "the runs must light exactly the ship's cells"
    return runs


def ink_box():
    """The ship's cells' bounds, in cells — the masthead's window onto her."""
    cells = wide_cells()
    xs, ys = [x for x, _ in cells], [y for _, y in cells]
    return min(xs), min(ys), max(xs) + 1 - min(xs), max(ys) + 1 - min(ys)


def masthead_svg():
    # The window is cropped to her cells, so the box is the ink: the layout
    # gap under her is the visual gap, and a row lockup does not carry six
    # empty cells beside her. The inner <svg> gives the symbol its own 48×24
    # viewport inside the cropped window (a bare <use> would fit 48×24 into
    # 36×20 and shrink her).
    x, y, w, h = ink_box()
    return (f'{MAST_PRE}{x} {y} {w} {h}" aria-hidden="true">'
            f'<svg width="48" height="24"><use href="#i-boum"/></svg></svg>')


def hint_css():
    _, _, w, h = ink_box()
    d = "".join(f"M{x} {y + 0.5:g}h{n}" for x, y, n in wide_runs())
    f = "var(--g) / var(--q)"   # the gap, as a fraction of a cell
    return f"""/* pixel-boum:hint */
    /* Written by design/pixel_boum.py, which explains it — edit it there.
       --cell is the CSS size of one cell; the bar sets it per state. --qmin
       is the fewest device pixels a cell may take: 2 draws 1 lit + 1 seam, a
       tan mesh rather than a white ship, so the compact states ask for 3. */
    .brand .logo {{ width: calc(var(--cell) * {w}px); height: calc(var(--cell) * {h}px); }}
    @supports (width: calc(round(nearest, 1.5px, 1px))) {{
      .brand .logo {{
        --q: max(var(--qmin, 2), round(nearest, calc(var(--cell) * var(--dpr, 1)), 1));
        --g: max(1, round(nearest, calc(var(--q) * {W_GAP}), 1));
        width: calc(var(--q) / var(--dpr, 1) * {w}px); height: calc(var(--q) / var(--dpr, 1) * {h}px); }}
      @supports (d: path("M0 0")) {{
        #i-boum path {{ d: path("{d}");
          fill: none; stroke: currentColor; shape-rendering: crispEdges;
          stroke-width: calc(1 - {f}); stroke-dasharray: calc(1 - {f}) calc({f});
          transform: translate(calc({HINT_NUDGE}px / var(--q)), calc(({HINT_NUDGE} - var(--g) / 2) * 1px / var(--q))); }}
      }}
    }}
    /* /pixel-boum:hint */"""


def with_masthead(html):
    if html.count('<use href="#i-boum"/>') != 1:
        sys.exit("#i-boum must be used once, by the masthead: its hint styles the symbol itself")
    html, n1 = MAST_RE.subn(lambda m: masthead_svg(), html, count=1)
    html, n2 = HINT_RE.subn(lambda m: hint_css(), html, count=1)
    if n1 != 1 or n2 != 1:
        sys.exit("masthead logo or the pixel-boum:hint block not found in index.html")
    return html


def symbols():
    boum = (f'<symbol id="i-boum" viewBox="0 0 48 24">'
            f'<path fill="currentColor" stroke="none" d="{wide_d()}"/></symbol>')
    sail = (f'<symbol id="i-sail" viewBox="0 0 24 24">'
            f'<path fill="currentColor" stroke="none" d="{square_d(1.5)}"/></symbol>')
    return boum, sail


def logo_svg():
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" role="img" aria-label="المهلب — Almuhallab">
  <!-- The Almuhallab mark, wide form: the Kuwaiti boum under sail, drawn as a
       grid of lit cells, white on the brand brown — the site-scale form of the matrix-code logo
       (design/matrix-logo/), rasterised from the same polygons. Four things
       make her a boum and all four survive the grid: she is double-ended with
       a raked stem, she carries filled lateen sails, the tall mainmast is
       forward and the short mizzen aft, and the sheer rises into both ends.
       Generated by design/pixel_boum.py — do not edit by hand. -->
  <rect width="48" height="24" fill="#6f3f1c"/>
  <path fill="#ffffff" d="{wide_d()}"/>
</svg>
'''


def favicon_svg():
    unit = 32   # 512 / 16: one cell is one pixel of a 16px tab icon
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Almuhallab Code favicon: the square pixel boum, white on the brand
       brown (owner's request 2026-09-28: white mark, brown ground). Set on a 16×16 grid so that at 16px each cell is exactly one
       screen pixel. Kept in step with #i-sail by design/pixel_boum.py. -->
  <rect width="512" height="512" rx="96" fill="#6f3f1c"/>
  <path fill="#ffffff" d="{square_d(unit)}"/>
</svg>
'''


def with_symbols(html):
    boum, sail = symbols()
    html, n1 = re.subn(r'<symbol id="i-boum".*?</symbol>', lambda m: boum, html, count=1, flags=re.S)
    html, n2 = re.subn(r'<symbol id="i-sail".*?</symbol>', lambda m: sail, html, count=1, flags=re.S)
    if n1 != 1 or n2 != 1:
        sys.exit("#i-boum / #i-sail not found in index.html")
    return html


def main():
    check = "--check" in sys.argv
    want = {
        SITE / "logo.svg": logo_svg(),
        SITE / "favicon.svg": favicon_svg(),
        PAGE: with_masthead(with_symbols(PAGE.read_text())),
    }
    stale = [p.name for p, t in want.items() if p.read_text() != t]
    if check:
        if stale:
            print("pixel boum drifted: " + ", ".join(stale))
            sys.exit(1)
        print("pixel boum is current")
        return
    for p, t in want.items():
        p.write_text(t)
    print(f"wrote {len(want)} files — wide {len(wide_cells())} cells, "
          f"square {len(square_cells())} cells")


if __name__ == "__main__":
    main()
