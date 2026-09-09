#!/usr/bin/env python3
"""Build the Almuhallab ship animation — the boum assembled out of falling code.

    python3 design/ship/build_ship.py        # writes design/ship/ship.html
    python3 design/ship/render_ship.py       # → ship.mp4 + ship-poster.png

THE SHIP IS NOT REDRAWN HERE. Its paths are lifted out of `#i-boum` in
almuhallab/index.html at build time, exactly as design/logo_pack.py lifts them,
so this animation cannot drift from the mark the site actually flies. The
identity is locked in CLAUDE.md; an animation that "nearly" matches the logo is
a second logo, which is the thing that rule exists to prevent. If this script
cannot find the symbol it stops rather than falling back to a drawing of its
own.

THE CODE IS ARABIC, not katakana. The Matrix's rain is Japanese because that
film is Japanese-inflected; a Kuwaiti software company's rain is its own
alphabet. Digits stay Latin, matching the rule the whole site follows — the
site has printed Arabic-Indic digits beside Latin ones in one table before, and
that is the defect the rule exists for.

WHITE GROUND, BROWN RAIN. Green-on-black is the cliché and it is also not this
company: the identity is brown ink on white and it is locked. The rain reads
because the leading glyph is full-strength brand brown against white and the
trail falls away behind it, not because it glows.

DETERMINISM. Every frame is a pure function of its index: the columns are laid
out by a seeded PRNG, the glyph at a cell is a hash of (column, cell, frame),
and a locked cell's lock frame is solved in closed form rather than accumulated.
Nothing carries state between frames, so the renderer can seek to any frame and
get the same picture — which is what lets a slow screenshot not drop a frame.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent
PAGE = ROOT / "almuhallab" / "index.html"


def boum():
    """The wide mark's paths, straight out of the page's sprite."""
    html = PAGE.read_text(encoding="utf-8")
    m = re.search(r'<symbol id="i-boum" viewBox="([^"]+)">(.*?)</symbol>',
                  html, re.S)
    if not m:
        raise SystemExit(
            f"no #i-boum symbol in {PAGE} — the sprite moved or was renamed.\n"
            "  Stopping rather than drawing a ship of my own: the mark is\n"
            "  locked, and a near-match is a second logo.")
    view, body = m.group(1), m.group(2)
    # One pattern, not two: the attributes before `d` may be empty, so a second
    # "starts with d=" pattern would match the same path again and the ship
    # would be drawn twice — heavier strokes, and nothing to say why.
    paths = re.findall(r'<path\s+([^>]*?)d="([^"]+)"', body)
    out = []
    for attrs, d in paths:
        fill = "currentColor" if 'fill="currentColor"' in attrs else "none"
        sw = re.search(r'stroke-width="([\d.]+)"', attrs)
        cap = re.search(r'stroke-linecap="(\w+)"', attrs)
        out.append({"d": d, "fill": fill,
                    "w": float(sw.group(1)) if sw else 0.0,
                    "cap": cap.group(1) if cap else "butt"})
    # Eight: waterline · hull · sheer · two masts · the two spars in one d ·
    # two sails. Fewer means the sprite changed shape and this animation would
    # be flying a different ship than the site.
    if len(out) != 8:
        raise SystemExit(f"{len(out)} paths in #i-boum — expected 8")
    return view, out


TEMPLATE = """<meta charset="utf-8">
<title>المهلب كود — الشراع من الشيفرة</title>
<style>
  /* Cairo, bundled with the site. Never a webfont CDN: the site's CSP is
     default-src 'none' and this page is built from the same parts. */
  @font-face {{ font-family:"Cairo"; font-weight:400; font-display:block;
    src:url("../../almuhallab/fonts/cairo-400.woff2") format("woff2"); }}
  @font-face {{ font-family:"Cairo"; font-weight:700; font-display:block;
    src:url("../../almuhallab/fonts/cairo-700.woff2") format("woff2"); }}
  @font-face {{ font-family:"Cairo"; font-weight:800; font-display:block;
    src:url("../../almuhallab/fonts/cairo-800.woff2") format("woff2"); }}
  html,body {{ margin:0; background:#fff; overflow:hidden; }}
  canvas {{ display:block; }}
</style>
<canvas id="c" width="{W}" height="{H}"></canvas>
<script>
"use strict";
var W = {W}, H = {H}, FPS = {FPS}, TOTAL = {TOTAL};
var TINT = "#7a4418", TINT_STRONG = "#6f3f1c";

var SHIP = {SHIP};
var VIEW = {VIEW};

// The glyphs: the company's own alphabet, and Latin digits — the numeral
// system the whole site uses.
var GLYPHS = ("ابتثجحخدذرزسشصضطظعغفقكلمنهوي" + "0123456789").split("");

// ---- determinism ---------------------------------------------------------
// A seeded PRNG for the layout and an integer hash for the glyphs. Nothing
// accumulates across frames: frame N is computed from N alone, so the renderer
// can seek anywhere and a slow screenshot cannot shift the picture.
function mulberry32(a) {{
  return function () {{
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }};
}}
function hash3(a, b, c) {{
  var h = (a * 374761393 + b * 668265263 + c * 2246822519) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return (h ^ h >>> 16) >>> 0;
}}

// ---- the timeline --------------------------------------------------------
// Seconds, not frames, so the shape of the film survives a change of fps.
var T_RAIN   = 0.0;   // rain establishes
var T_LOCK   = 1.6;   // the rain starts painting the hull
var T_LOCKED = 5.5;   // every cell of the mark has been struck
// A full second where the ship simply STANDS, complete and solid in code,
// before anything else happens. Without it T_LOCKED and T_RESOLVE were the
// same instant: the mark was finished and already dissolving on the same
// frame, so the one picture the whole animation is building towards was
// never actually on screen.
var T_RESOLVE= 6.5;   // code gives way to the drawn mark
var T_MARK   = 7.6;
var T_WORD   = 7.9;   // the wordmark writes in beneath

// ---- layout --------------------------------------------------------------
var CELL = 13;
var COLS = Math.ceil(W / CELL);
var ROWS = Math.ceil(H / CELL);
var TRAIL = 14;                       // cells of fading tail behind each head

var rnd = mulberry32(20260909);
var col = [];
for (var c = 0; c < COLS; c++) {{
  col.push({{
    speed: (0.22 + rnd() * 0.42),     // cells per frame
    phase: rnd() * ROWS * 3,
    dim: 0.10 + rnd() * 0.17
  }});
}}

// ---- the ship's own mask -------------------------------------------------
// The mark is filled once into an offscreen canvas at the size it will hold on
// screen; a cell is "in the ship" when that canvas has ink at its centre. This
// is why the code assembles the real boum and not an outline of one: the mask
// is the drawing itself.
var vb = VIEW.split(/\\s+/).map(Number);
var SHIP_W = Math.round(W * 0.68);
var SHIP_H = SHIP_W * (vb[3] / vb[2]);
var SHIP_X = (W - SHIP_W) / 2;
var SHIP_Y = (H - SHIP_H) / 2 - H * 0.045;
var SCALE = SHIP_W / vb[2];

function drawShip(g, alpha) {{
  g.save();
  g.globalAlpha = alpha;
  g.translate(SHIP_X, SHIP_Y);
  g.scale(SCALE, SCALE);
  for (var i = 0; i < SHIP.length; i++) {{
    var p = SHIP[i], path = new Path2D(p.d);
    if (p.fill === "currentColor") {{ g.fillStyle = TINT_STRONG; g.fill(path); }}
    if (p.w > 0) {{
      g.strokeStyle = TINT_STRONG;
      g.lineWidth = p.w;
      g.lineCap = p.cap;
      g.lineJoin = "round";
      g.stroke(path);
    }}
  }}
  g.restore();
}}

var mask = document.createElement("canvas");
mask.width = W; mask.height = H;
var mg = mask.getContext("2d");
// Filled *and* stroked heavily, so the masts and spars — one pixel wide in the
// original units — are thick enough for a 26px grid to find them. A mast the
// grid cannot see is a mast the code never builds, and the mark stops being a
// boum the moment its rig goes missing.
mg.save();
mg.translate(SHIP_X, SHIP_Y);
mg.scale(SCALE, SCALE);
for (var i = 0; i < SHIP.length; i++) {{
  var p = SHIP[i], path = new Path2D(p.d);
  mg.fillStyle = "#000";
  if (p.fill === "currentColor") mg.fill(path);
  if (p.w > 0) {{
    mg.strokeStyle = "#000";
    mg.lineWidth = Math.max(p.w, 1.1);
    mg.lineCap = p.cap; mg.lineJoin = "round";
    mg.stroke(path);
  }}
}}
mg.restore();
var maskData = mg.getImageData(0, 0, W, H).data;
function inShip(px, py) {{
  if (px < 0 || py < 0 || px >= W || py >= H) return false;
  return maskData[((py | 0) * W + (px | 0)) * 4 + 3] > 24;
}}

// Which cells belong to the ship, and the frame each is struck by its own
// column's falling head — solved, not accumulated. A column repeats every
// `period` frames; the strike is the first repetition at or after T_LOCK.
var lockStart = T_LOCK * FPS, lockEnd = T_LOCKED * FPS;
var cells = [];
for (var c = 0; c < COLS; c++) {{
  var period = (ROWS + TRAIL) / col[c].speed;
  for (var r = 0; r < ROWS; r++) {{
    var cx = c * CELL + CELL / 2, cy = r * CELL + CELL / 2;
    if (!inShip(cx, cy)) continue;
    var f0 = ((r + TRAIL) - col[c].phase) / col[c].speed;
    var k = Math.ceil((lockStart - f0) / period);
    var at = f0 + Math.max(0, k) * period;
    // A slow column's next pass can fall after the window closes, and that
    // cell would then never be struck — a permanent hole in the hull. Fold it
    // back INTO the window: `at % period` was the first attempt and it could
    // return a larger number than it was given, which is how the holes got
    // there in the first place.
    if (at > lockEnd) at = lockStart + ((at - lockStart) % (lockEnd - lockStart));
    cells.push({{ c: c, r: r, x: cx, y: cy, at: at }});
  }}
}}

// ---- drawing -------------------------------------------------------------
var ctx = document.getElementById("c").getContext("2d");

function glyph(c, r, f) {{
  // held for a few frames, so the rain flickers rather than strobes
  return GLYPHS[hash3(c, r, Math.floor(f / 3)) % GLYPHS.length];
}}
function ease(x) {{ return x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3); }}

// How much each glyph must be widened to fill a cell. Measured once for the
// thirty-eight glyphs rather than per cell per frame — the same measurement
// eleven hundred times a frame is the kind of cost that only shows up as a
// render that never finishes.
var LOCK_FONT = '800 ' + Math.round(CELL * 1.06) + 'px Cairo, sans-serif';
var STRETCH = {{}};
(function () {{
  ctx.save();
  ctx.font = LOCK_FONT;
  for (var i = 0; i < GLYPHS.length; i++) {{
    var w = ctx.measureText(GLYPHS[i]).width;
    STRETCH[GLYPHS[i]] = w > 0.5 ? Math.min(2.1, CELL / w) : 1;
  }}
  ctx.restore();
}})();
function stretch(g) {{ return STRETCH[g] || 1; }}

function renderFrame(f) {{
  var t = f / FPS;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  var resolve = ease((t - T_RESOLVE) / (T_MARK - T_RESOLVE));

  // The rain, everywhere — and deliberately faint. The first version gave the
  // falling heads nearly the weight of the struck cells, and the ship simply
  // did not appear: with no figure/ground separation the whole frame read as
  // noise. Ground is texture; the mark is ink.
  ctx.font = '400 ' + (CELL - 6) + 'px Cairo, sans-serif';
  for (var c = 0; c < COLS; c++) {{
    var period = ROWS + TRAIL;
    var head = ((col[c].phase + f * col[c].speed) % period);
    for (var k = 0; k < TRAIL; k++) {{
      var r = Math.floor(head) - k;
      if (r < 0 || r >= ROWS) continue;
      var x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
      // a cell the ship has already claimed is drawn by the ship, not here
      if (inShip(x, y) && f >= lockStart) continue;
      var a = (1 - k / TRAIL) * col[c].dim * (k === 0 ? 1 : 0.72);
      a *= (1 - 0.55 * resolve);       // the rain steps back for the mark
      ctx.fillStyle = TINT;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillText(glyph(c, r, f), x, y);
    }}
  }}
  ctx.globalAlpha = 1;

  // The ship, struck cell by cell out of the code — and SOLID. Cairo's glyphs
  // are not one width, so letting them sit at their natural advance left white
  // gutters right through the sails and the hull read as scattered type rather
  // than as a shape. Each struck glyph is stretched horizontally to exactly
  // fill its cell, so the cells abut and the mark is a mass, not a sprinkle.
  // The stretch is capped: a narrow letter blown to three times its width
  // stops being that letter, and the rain has to stay readable as Arabic.
  ctx.font = LOCK_FONT;
  for (var i = 0; i < cells.length; i++) {{
    var cl = cells[i];
    if (f < cl.at) continue;
    var age = (f - cl.at) / FPS;
    var pop = ease(age / 0.28);                 // it lands, it does not fade in
    var g = glyph(cl.c, cl.r, cl.at);
    ctx.fillStyle = TINT_STRONG;
    ctx.globalAlpha = (0.82 + 0.18 * pop) * (1 - resolve);
    ctx.save();
    ctx.translate(cl.x, cl.y);
    var s = 1 + 0.45 * (1 - pop);
    ctx.scale(stretch(g) * s, s);
    ctx.fillText(g, 0, 0);
    ctx.restore();
  }}
  ctx.globalAlpha = 1;

  // and then it is simply the mark
  if (resolve > 0) drawShip(ctx, resolve);

  // the wordmark, in the locked lockup order
  var wa = ease((t - T_WORD) / 1.0);
  if (wa > 0) {{
    var baseY = SHIP_Y + SHIP_H + H * 0.055;
    ctx.globalAlpha = wa;
    ctx.fillStyle = TINT;
    ctx.font = '800 ' + Math.round(H * 0.085) + 'px Cairo, sans-serif';
    ctx.fillText("المهلب", W / 2, baseY);
    ctx.fillStyle = TINT_STRONG;
    ctx.font = '700 ' + Math.round(H * 0.036) + 'px Cairo, sans-serif';
    ctx.fillText("Almuhallab Code", W / 2, baseY + H * 0.078);
    ctx.font = '400 ' + Math.round(H * 0.028) + 'px Cairo, sans-serif';
    ctx.fillText("شركة برمجة وأنظمة", W / 2, baseY + H * 0.126);
    ctx.globalAlpha = 1;
  }}
}}

window.renderFrame = renderFrame;
// Reported so the renderer can refuse a build where cells fall outside the
// window: such a cell is a hole in the hull that no frame ever fills, and
// nothing in a finished video says which one it was.
var late = 0;
for (var i = 0; i < cells.length; i++) {{
  if (cells[i].at < lockStart || cells[i].at > lockEnd) late++;
}}
window.SHIP_META = {{ fps: FPS, total: TOTAL, frames: Math.round(TOTAL * FPS),
                     cells: cells.length, late: late }};

// A preview when the page is opened by hand; the renderer never uses it.
var live = 0;
function tick() {{ renderFrame(live++ % Math.round(TOTAL * FPS)); requestAnimationFrame(tick); }}
if (!location.search.includes("still")) document.fonts.ready.then(tick);
else document.fonts.ready.then(function () {{ renderFrame(0); }});
</script>
"""


def main():
    view, paths = boum()
    import json
    html = TEMPLATE.format(
        W=1920, H=1080, FPS=30, TOTAL=10.0,
        SHIP=json.dumps(paths, ensure_ascii=False),
        VIEW=json.dumps(view))
    out = HERE / "ship.html"
    out.write_text(html, encoding="utf-8")
    print(f"  {out.relative_to(ROOT)}")
    print(f"  {len(paths)} paths lifted from #i-boum · 1920×1080 · 10.0s @30fps")
    print("  next:  python3 design/ship/render_ship.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
