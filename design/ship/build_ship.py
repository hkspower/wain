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

// ---- two grids, because one grid cannot do both jobs ---------------------
// The rain and the ship were laid out on the same grid, and the two wants
// pull opposite ways: the ship needs small cells to be solid, the rain needs
// large glyphs to be legible. Shrinking the grid to 13px for solidity made
// the falling code too small to read. So the rain keeps its own coarse grid
// and the ship keeps a fine one — and the ship's cells are still struck by
// the rain column that passes over them, so the rain visibly paints the hull.
var RAIN = 22;                        // the falling code: big enough to read
var CELL = 13;                        // the ship's fill: small enough to be solid
var RCOLS = Math.ceil(W / RAIN);
var RROWS = Math.ceil(H / RAIN);
var TRAIL = 13;                       // cells of fading tail behind each head

var rnd = mulberry32(20260909);
var col = [];
for (var c = 0; c < RCOLS; c++) {{
  col.push({{
    speed: (0.20 + rnd() * 0.38),     // cells per frame
    phase: rnd() * RROWS * 3,
    dim: 0.30 + rnd() * 0.34
  }});
}}

// ---- the ship's own mask -------------------------------------------------
// The mark is filled once into an offscreen canvas at the size it will hold on
// screen. It does two jobs: it says which cells are in the ship, and it is the
// alpha the code fill is clipped against — so the fill stops exactly at the
// mark's edge rather than at whichever cell centres happened to fall inside.
var vb = VIEW.split(/\\s+/).map(Number);

// TWO SIZES. While the code builds her the boum fills the frame — 80% of its
// width — because that is the spectacle. Then she settles into the company's
// LOCKUP: the mark, «المهلب», Almuhallab Code, «شركة برمجة وأنظمة», at the
// proportions the site's own masthead uses (mark 74px tall, name 30px,
// English 14px with .1em tracking, descriptor 12px, 8px under the mark and 4px
// between lines). The first version sized the wordmark by eye at about a
// third of that ratio, which made the ending a ship with a caption rather
// than the company's logo. Everything below is derived from M, the mark's
// height in the lockup, so the ratios cannot drift from the masthead's.
var BIG_W = Math.round(W * 0.80);
var BIG_H = BIG_W * (vb[3] / vb[2]);
var BIG_X = (W - BIG_W) / 2;
var BIG_Y = (H - BIG_H) / 2;
var BIG_S = BIG_W / vb[2];

var M = 74;                                 // the masthead's mark height
var LK = {{                                  // the lockup, in units of M
  gap: 8 / M, name: 30 / M, nameLH: 1.2, en: 14 / M, enLH: 1.3,
  small: 12 / M, smallLH: 1.3, line: 4 / M
}};
// total lockup height in M: mark + gap + name + line + en + line + small
var LOCK_TOTAL = 1 + LK.gap + LK.name * LK.nameLH + LK.line +
                 LK.en * LK.enLH + LK.line + LK.small * LK.smallLH;
var LOCK_MH = Math.round(H * 0.86 / LOCK_TOTAL);   // mark height in the lockup
var LOCK_W = LOCK_MH * (vb[2] / vb[3]);
var LOCK_X = (W - LOCK_W) / 2;
var LOCK_Y = (H - LOCK_MH * LOCK_TOTAL) / 2;
var LOCK_S = LOCK_W / vb[2];

// the mask and the cells are built at the BIG size — that is where the code is
var SHIP_X = BIG_X, SHIP_Y = BIG_Y, SCALE = BIG_S;

// where the ship is on a given frame: big while she is code, settling into
// the lockup as she resolves
function shipAt(settle) {{
  var k = ease(settle);
  return {{ x: BIG_X + (LOCK_X - BIG_X) * k,
           y: BIG_Y + (LOCK_Y - BIG_Y) * k,
           s: BIG_S + (LOCK_S - BIG_S) * k }};
}}

function shipPaths(g, at) {{
  at = at || {{ x: BIG_X, y: BIG_Y, s: BIG_S }};
  g.translate(at.x, at.y);
  g.scale(at.s, at.s);
}}

function drawShip(g, alpha, at) {{
  g.save();
  g.globalAlpha = alpha;
  shipPaths(g, at);
  for (var i = 0; i < SHIP.length; i++) {{
    var p = SHIP[i], path = new Path2D(p.d);
    if (p.fill === "currentColor") {{ g.fillStyle = TINT_STRONG; g.fill(path); }}
    if (p.w > 0) {{
      g.strokeStyle = TINT_STRONG;
      g.lineWidth = p.w; g.lineCap = p.cap; g.lineJoin = "round";
      g.stroke(path);
    }}
  }}
  g.restore();
}}

// THE BORDER. The code fill alone gives a shape whose edge is made of letter
// shapes, and at any distance that edge reads as fuzz. Stroking the mark's own
// outline over the fill draws the boum's line — the stem, the sheer, the leech
// of each sail — so the shape is stated and the code sits inside it. It is
// drawn only while the code is standing; the resolved mark is the mark itself,
// with nothing added to it.
function drawBorder(g, alpha, at) {{
  g.save();
  g.globalAlpha = alpha;
  shipPaths(g, at);
  g.strokeStyle = TINT_STRONG;
  g.lineJoin = "round";
  for (var i = 0; i < SHIP.length; i++) {{
    var p = SHIP[i], path = new Path2D(p.d);
    // A filled path gets a THIN outline, not its own weight. The hull is a
    // filled crescent a few units deep; stroking its outline at the mark's
    // own 0.6 swallowed the crescent whole and left the code showing as a
    // ribbon inside a heavy brown shape. The masts and spars are already
    // lines and keep their true weight — code inside a mast was never going
    // to be visible, and a mast at half weight is not this mark's mast.
    g.lineWidth = p.fill === "currentColor" ? 0.34 : p.w;
    g.lineCap = p.w > 0 ? p.cap : "round";
    g.stroke(path);
  }}
  g.restore();
}}

var mask = document.createElement("canvas");
mask.width = W; mask.height = H;
var mg = mask.getContext("2d");
// Filled *and* stroked heavier than true, so the masts and spars — barely a
// unit wide in the original drawing — survive into a grid of pixels. A mast
// the grid cannot see is a mast the code never builds, and the mark stops
// being a boum the moment its rig goes missing.
mg.save();
shipPaths(mg);
for (var i = 0; i < SHIP.length; i++) {{
  var p = SHIP[i], path = new Path2D(p.d);
  mg.fillStyle = "#000";
  if (p.fill === "currentColor") mg.fill(path);
  mg.strokeStyle = "#000";
  mg.lineWidth = p.w > 0 ? Math.max(p.w, 1.0) : 0.5;
  mg.lineCap = p.w > 0 ? p.cap : "round";
  mg.lineJoin = "round";
  mg.stroke(path);
}}
mg.restore();
var maskData = mg.getImageData(0, 0, W, H).data;
function inShip(px, py) {{
  if (px < 0 || py < 0 || px >= W || py >= H) return false;
  return maskData[((py | 0) * W + (px | 0)) * 4 + 3] > 16;
}}

// The layer the code fill is drawn on, so it can be clipped to the mask before
// it reaches the page. A glyph is drawn from its centre and spills past the
// cell it belongs to, so cells chosen by centre alone gave a deckle edge that
// no amount of grid tuning fixes — the fill has to be cut, not approximated.
var layer = document.createElement("canvas");
layer.width = W; layer.height = H;
var lg = layer.getContext("2d");

// Which cells belong to the ship, and the frame each is struck by the rain
// column above it — solved, not accumulated. A column repeats every `period`
// frames; the strike is the first repetition at or after T_LOCK.
var lockStart = T_LOCK * FPS, lockEnd = T_LOCKED * FPS;
var cells = [];
for (var gx = 0; gx < Math.ceil(W / CELL); gx++) {{
  for (var gy = 0; gy < Math.ceil(H / CELL); gy++) {{
    var cx = gx * CELL + CELL / 2, cy = gy * CELL + CELL / 2;
    if (!inShip(cx, cy)) continue;
    var rc = Math.min(RCOLS - 1, Math.floor(cx / RAIN));
    var rr = cy / RAIN;                       // in rain rows, not ship rows
    var period = (RROWS + TRAIL) / col[rc].speed;
    var f0 = ((rr + TRAIL) - col[rc].phase) / col[rc].speed;
    var k = Math.ceil((lockStart - f0) / period);
    var at = f0 + Math.max(0, k) * period;
    // A slow column's next pass can fall after the window closes, and that
    // cell would then never be struck — a permanent hole in the hull. Fold it
    // back INTO the window: `at % period` was the first attempt and it could
    // return a larger number than it was given, which is how the holes got
    // there in the first place.
    if (at > lockEnd) at = lockStart + ((at - lockStart) % (lockEnd - lockStart));
    cells.push({{ c: rc, r: gy, x: cx, y: cy, at: at }});
  }}
}}

// ---- drawing -------------------------------------------------------------
var ctx = document.getElementById("c").getContext("2d");

function glyph(c, r, f) {{
  // held for a few frames, so the rain flickers rather than strobes
  return GLYPHS[hash3(c, r, Math.floor(f / 3)) % GLYPHS.length];
}}
function ease(x) {{ return x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3); }}

// How much each glyph must be widened to fill a cell. Cairo's glyphs are not
// one width, and at their natural advance they leave white gutters straight
// through the sails — the ship read as scattered type rather than a shape.
// Measured once for the thirty-eight glyphs, not per cell per frame: the same
// measurement thousands of times a frame only shows up as a render that never
// finishes. Capped, because a narrow letter blown to three times its width
// stops being that letter.
var LOCK_FONT = '800 ' + Math.round(CELL * 1.06) + 'px Cairo, sans-serif';
var RAIN_FONT = '500 ' + Math.round(RAIN * 0.82) + 'px Cairo, sans-serif';
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
  var at = shipAt(resolve);

  // The rain. It is the subject of the piece, not wallpaper, so it is set at a
  // size that can actually be read and at a weight that holds on white — but
  // still under the struck cells, because with no separation between figure and
  // ground the first version read as noise and the ship never appeared at all.
  ctx.font = RAIN_FONT;
  ctx.fillStyle = TINT;
  for (var c = 0; c < RCOLS; c++) {{
    var period = RROWS + TRAIL;
    var head = ((col[c].phase + f * col[c].speed) % period);
    for (var k = 0; k < TRAIL; k++) {{
      var r = Math.floor(head) - k;
      if (r < 0 || r >= RROWS) continue;
      var x = c * RAIN + RAIN / 2, y = r * RAIN + RAIN / 2;
      var a = (1 - k / TRAIL) * col[c].dim * (k === 0 ? 1.35 : 0.8);
      a *= (1 - 0.6 * resolve);
      // A cell the code-ship has claimed is drawn by the ship, not here — but
      // only while the code is standing. Once she settles into the lockup the
      // rain returns to where she was, fading in as the code fades out; left
      // as a hard skip, a ship-shaped hole stayed in the rain for the rest of
      // the film, under the resolved mark, exactly where she used to be.
      if (f >= lockStart && inShip(x, y)) a *= resolve;
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.fillText(glyph(c, r, f), x, y);
    }}
  }}
  ctx.globalAlpha = 1;

  // The ship, struck cell by cell — drawn to its own layer and then cut to the
  // mark's silhouette, so the fill ends where the boum ends.
  if (resolve < 1) {{
    lg.clearRect(0, 0, W, H);
    lg.textAlign = "center";
    lg.textBaseline = "middle";
    lg.font = LOCK_FONT;
    lg.fillStyle = TINT_STRONG;
    for (var i = 0; i < cells.length; i++) {{
      var cl = cells[i];
      if (f < cl.at) continue;
      var pop = ease((f - cl.at) / FPS / 0.26);   // it lands, it does not fade
      var g = glyph(cl.c, cl.r, cl.at);
      lg.globalAlpha = 0.85 + 0.15 * pop;
      lg.save();
      lg.translate(cl.x, cl.y);
      var s = 1 + 0.4 * (1 - pop);
      lg.scale(stretch(g) * s, s);
      lg.fillText(g, 0, 0);
      lg.restore();
    }}
    lg.globalAlpha = 1;
    lg.globalCompositeOperation = "destination-in";
    lg.drawImage(mask, 0, 0);
    lg.globalCompositeOperation = "source-over";

    // The code layer moves WITH the ship as she settles. It was drawn at the
    // big size; mapping it onto the frame's transform keeps code and mark on
    // top of each other through the crossfade — otherwise the mark would
    // slide out from under a fixed block of code and the hand-over would show.
    var k = at.s / BIG_S;
    ctx.save();
    ctx.globalAlpha = 1 - resolve;
    ctx.translate(at.x, at.y);
    ctx.scale(k, k);
    ctx.translate(-BIG_X, -BIG_Y);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();

    // and the outline over it, rising as the hull fills
    var edge = ease((f - lockStart) / (lockEnd - lockStart));
    drawBorder(ctx, edge * (1 - resolve), at);
  }}

  // and then it is simply the mark
  if (resolve > 0) drawShip(ctx, resolve, at);

  // The wordmark, in the lockup's own order and proportions. Every size here
  // is a ratio of the mark's height, taken from the masthead stylesheet.
  var wa = ease((t - T_WORD) / 1.0);
  if (wa > 0) {{
    var mh = LOCK_MH, y = LOCK_Y + mh + LK.gap * mh;
    ctx.globalAlpha = wa;
    ctx.textBaseline = "top";
    ctx.fillStyle = TINT;
    ctx.font = '800 ' + Math.round(LK.name * mh) + 'px Cairo, sans-serif';
    ctx.fillText("المهلب", W / 2, y);
    y += LK.name * mh * LK.nameLH + LK.line * mh;
    ctx.fillStyle = TINT_STRONG;
    ctx.font = '700 ' + Math.round(LK.en * mh) + 'px Cairo, sans-serif';
    // the masthead tracks the English line at .1em; Chromium's canvas honours
    // letterSpacing, and on a browser that does not the line simply sets tight
    if ("letterSpacing" in ctx) ctx.letterSpacing = (LK.en * mh * 0.1) + "px";
    ctx.fillText("Almuhallab Code", W / 2, y);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    y += LK.en * mh * LK.enLH + LK.line * mh;
    ctx.globalAlpha = wa * 0.82;              // the descriptor sits back, as on the bar
    ctx.font = '500 ' + Math.round(LK.small * mh) + 'px Cairo, sans-serif';
    ctx.fillText("شركة برمجة وأنظمة", W / 2, y);
    ctx.globalAlpha = 1;
    ctx.textBaseline = "middle";
  }}
}}

// Reported so the renderer can refuse a build where cells fall outside the
// window: such a cell is a hole in the hull that no frame ever fills, and
// nothing in a finished video says which one it was.
var late = 0;
for (var i = 0; i < cells.length; i++) {{
  if (cells[i].at < lockStart || cells[i].at > lockEnd) late++;
}}
window.SHIP_META = {{ fps: FPS, total: TOTAL, frames: Math.round(TOTAL * FPS),
                     cells: cells.length, late: late }};

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
