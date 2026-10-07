#!/usr/bin/env python3
"""Category tiles: white ground, orange band, the subject on the far side.

    python3 scripts/make-white-tiles.py

Asked for on 2026-09-28 as "make all category images white with orange
frills, sporty modern style", approved from the design mockup. Writes all
of cats/{desktop,mobile}/art-{men,women,accessories,outlet}[-rtl].{jpg,webp}
at the sizes the tiles already use (1216x988 desktop; 1080x1080 on a phone since
2026-10-01, one square tile per row), so nothing is cropped by `cover`.

THE COPY IS DRAWN BY THE BUNDLE, on the reading-start side, so the subject
goes on the FAR side: right for the English frame, left for the Arabic one.
The -rtl frame is a mirror — the art carries no text, so a mirror is exact.
All four names get one; assets/tile-art.js swaps the three the bundle does
not know about.

INPUTS are the subject cut-outs in scripts/fixtures/tile-subjects/ (rembg
BiRefNet over the 2026-09-28 studio art; outlet is a photo panel, not a
cut-out: the shelving from the ORIGINAL 2026-08-20 art, x 810-1216, full height, since the
later repaired art had a blurred orange smear beside it). Re-cutting is not repeated here so the output is reproducible.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..', 'sporta-site', 'public_html', 'cats')
SUBJ = os.path.join(os.path.dirname(__file__), 'fixtures', 'tile-subjects')
ORANGE = (224, 86, 28)      # --brand
WHITE = (255, 255, 255)
# THE PHONE ART IS SQUARE since 2026-10-01 ("single full row, square shape, full render, the model
# and all products bigger for the mobile version"): one tile per row on a phone, drawn at 1080x1080 so
# `cover` crops nothing. Desktop is unchanged.
SIZES = {'desktop': {'tall': (1216, 988), 'wide': (1216, 418)},
         'mobile':  {'tall': (1290, 968), 'wide': (1290, 545)}}
# 4:3 ON A PHONE since 2026-10-07 ("improve category images size to perfectly fit mobile version"):
# a square tile was a whole screen-height each (412px on a 412px phone) and the four took four
# screens of scrolling; at 4:3 two fit on one screen. 1290px wide = sharp on a 3x phone up to 430px.
rng = np.random.default_rng(3)


def band(w, h, x0, x1, skew=0.25):
    """An orange parallelogram from x0..x1 at the top, leaning left by skew*h."""
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    s = int(h * skew)
    d.polygon([(x0 + s, -10), (x1 + s, -10), (x1 - s, h + 10), (x0 - s, h + 10)], fill=ORANGE + (255,))
    return layer


def stripes(w, h, x0, x1, pitch, thick, skew=0.25):
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    s = int(h * skew)
    x = x0
    while x < x1:
        d.polygon([(x + s, -10), (x + thick + s, -10), (x + thick - s, h + 10), (x - s, h + 10)],
                  fill=ORANGE + (70,))
        x += pitch
    return layer


def ground(w, h):
    g = np.full((h, w, 3), 255, np.float32)
    g += rng.normal(0, 1.2, g.shape)                     # faint grain so flat white does not band
    return Image.fromarray(np.clip(g, 0, 255).astype(np.uint8)).convert('RGBA')


def shadow(w, h, cx, cy, rx, ry, alpha=110):
    layer = Image.new('L', (w, h), 0)
    ImageDraw.Draw(layer).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=alpha)
    return layer.filter(ImageFilter.GaussianBlur(rx * 0.18))


def compose_person(name, w, h, sharpen=False):
    img = ground(w, h)
    sub = Image.open(os.path.join(SUBJ, f'{name}.png')).convert('RGBA')
    sh = int(h * 0.96)
    sub = sub.resize((int(sub.width * sh / sub.height), sh), Image.LANCZOS)
    if sharpen:
        # The cut-outs are about 650px tall, so the square phone tile ENLARGES them ~1.6x. A light
        # unsharp mask on the colour only (never the alpha, which would ring the edge) keeps the
        # enlargement from reading as soft. It cannot add detail the photograph does not have.
        r, g, b_, a_ = sub.split()
        rgb = Image.merge('RGB', (r, g, b_)).filter(ImageFilter.UnsharpMask(radius=1.6, percent=60, threshold=2))
        sub = Image.merge('RGBA', (*rgb.split(), a_))
    # ONE ALIGNMENT FOR BOTH MODELS, 2026-10-02 ("make all models as same alignment"): the
    # figure is CENTRED on a fixed line and the band, stripes and shadow are laid out from a
    # reference box of the same size for every model, so Men and Women stand in the same place
    # on the same band whatever the width of the pose (it was right-aligned, so a wider pose
    # sat further left and dragged its band with it).
    ref_w = int(sh * 0.40)
    cx = w - int(w * 0.14) - ref_w // 2
    # by the TORSO, not the outline box: a stride or an elbow widens the box and pulls a body
    # off the line, so the centre is the alpha centroid of the top 45% (head and shoulders)
    a_ = np.asarray(sub.split()[3], np.float32)[: int(sub.height * 0.45)]
    tx = int((a_.sum(axis=0) * np.arange(sub.width)).sum() / max(a_.sum(), 1))
    x = cx - tx
    rx = cx - ref_w // 2
    y = h - sub.height
    img.alpha_composite(band(w, h, rx - int(w * 0.06), rx + ref_w + int(w * 0.10)))
    img.alpha_composite(stripes(w, h, rx - int(w * 0.17), rx - int(w * 0.07), 14, 4))
    img = Image.composite(Image.new('RGBA', (w, h), (20, 12, 8, 255)), img,
                          shadow(w, h, cx, h - 6, ref_w * 0.6, 12))
    img.alpha_composite(sub, (x, y))
    return img


# THE FLAT LAY, DRAWN — 2026-09-29, "make accessories images with product
# animation style for adult": flat illustrated products, mature not childish —
# charcoal, grey, white and the shop's orange, a heavy dark outline, no faces,
# no gloss. One row, cap / shirts / shoes / bottles / dumbbell, standing on the
# tile's bottom edge. Each item is drawn at 4x and reduced so outlines are
# smooth, and nothing is cut from a photograph, so nothing has a ragged edge.
INK = (26, 26, 26)
CHAR = (43, 43, 47)
MID = (139, 143, 152)
LIGHT = (201, 203, 208)
GAP = 12
SS = 4


def _canvas(w, h):
    im = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def _fin(im, w, h):
    return im.resize((w, h), Image.LANCZOS)


def _u(v):
    return int(v * SS)


LW = 5   # outline, in drawing units


def item_cap():
    w, h = 190, 150
    im, d = _canvas(w, h)
    lw = _u(LW)
    # brim first, so the dome sits on it and the two read as one cap
    brim = [(_u(40), _u(84)), (_u(176), _u(94)), (_u(188), _u(120)), (_u(150), _u(136)), (_u(60), _u(112))]
    d.polygon(brim, fill=ORANGE)
    d.line(brim + [brim[0]], fill=INK, width=lw, joint='curve')
    d.line([(_u(80), _u(112)), (_u(172), _u(120))], fill=(255, 255, 255), width=_u(3))
    # dome
    d.pieslice([_u(14), _u(6), _u(150), _u(178)], 180, 360, fill=CHAR, outline=INK, width=lw)
    d.rectangle([_u(14), _u(92), _u(150), _u(100)], fill=CHAR)
    d.line([(_u(14), _u(92)), (_u(150), _u(92))], fill=INK, width=lw)
    d.arc([_u(50), _u(6), _u(114), _u(178)], 180, 360, fill=INK, width=_u(3))
    d.line([(_u(82), _u(8)), (_u(82), _u(92))], fill=INK, width=_u(3))
    d.ellipse([_u(76), _u(2), _u(88), _u(14)], fill=ORANGE, outline=INK, width=_u(3))
    return _fin(im, w, h)


def item_shirts():
    w, h = 180, 210
    im, d = _canvas(w, h)
    lw = _u(LW)
    # back tee, then front tee, folded (torso block + sleeve caps + neck)
    for i, (col, dy, stripe) in enumerate([(MID, 0, False), (CHAR, 46, True)]):
        y0 = dy + 8
        d.rounded_rectangle([_u(10), _u(y0), _u(170), _u(y0 + 150)], radius=_u(14), fill=col, outline=INK, width=lw)
        d.polygon([(_u(10), _u(y0 + 6)), (_u(-2 + 4), _u(y0 + 52)), (_u(40), _u(y0 + 58)), (_u(44), _u(y0 + 10))], fill=col, outline=INK)
        d.polygon([(_u(170), _u(y0 + 6)), (_u(178), _u(y0 + 52)), (_u(140), _u(y0 + 58)), (_u(136), _u(y0 + 10))], fill=col, outline=INK)
        d.pieslice([_u(64), _u(y0 - 22), _u(116), _u(y0 + 30)], 0, 180, fill=(244, 241, 236), outline=INK, width=_u(4))
        if stripe:
            d.rectangle([_u(14), _u(y0 + 78), _u(166), _u(y0 + 96)], fill=ORANGE)
            d.line([(_u(14), _u(y0 + 78)), (_u(166), _u(y0 + 78))], fill=INK, width=_u(3))
            d.line([(_u(14), _u(y0 + 96)), (_u(166), _u(y0 + 96))], fill=INK, width=_u(3))
    return _fin(im, w, h)


def item_shoe():
    w, h = 230, 140
    im, d = _canvas(w, h)
    lw = _u(LW)
    # sole
    d.rounded_rectangle([_u(6), _u(104), _u(222), _u(134)], radius=_u(14), fill=(255, 255, 255), outline=INK, width=lw)
    # upper: heel, collar, tongue, laces, toe
    up = [(_u(14), _u(104)), (_u(10), _u(48)), (_u(22), _u(14)), (_u(60), _u(6)), (_u(84), _u(34)),
          (_u(120), _u(48)), (_u(168), _u(66)), (_u(210), _u(84)), (_u(220), _u(104))]
    d.polygon(up, fill=CHAR)
    d.line(up + [up[0]], fill=INK, width=lw, joint='curve')
    # orange toe overlay and swoosh
    toe = [(_u(150), _u(62)), (_u(168), _u(66)), (_u(210), _u(84)), (_u(220), _u(104)), (_u(140), _u(104))]
    d.polygon(toe, fill=ORANGE)
    d.line(toe + [toe[0]], fill=INK, width=_u(4), joint='curve')
    d.line([(_u(34), _u(84)), (_u(90), _u(70)), (_u(130), _u(88))], fill=(255, 255, 255), width=_u(6), joint='curve')
    for t in range(4):
        lx = 86 + t * 16
        d.line([(_u(lx), _u(46 + t * 4)), (_u(lx + 10), _u(58 + t * 4))], fill=(255, 255, 255), width=_u(4))
    return _fin(im, w, h)


def item_bottles():
    w, h = 130, 200
    im, d = _canvas(w, h)
    lw = _u(LW)
    # tall bottle
    d.rounded_rectangle([_u(70), _u(40), _u(122), _u(196)], radius=_u(16), fill=CHAR, outline=INK, width=lw)
    d.rounded_rectangle([_u(84), _u(14), _u(108), _u(44)], radius=_u(6), fill=ORANGE, outline=INK, width=_u(4))
    d.rectangle([_u(74), _u(96), _u(118), _u(126)], fill=ORANGE)
    d.line([(_u(74), _u(96)), (_u(118), _u(96))], fill=INK, width=_u(3))
    d.line([(_u(74), _u(126)), (_u(118), _u(126))], fill=INK, width=_u(3))
    # shaker in front
    d.polygon([(_u(8), _u(74)), (_u(64), _u(74)), (_u(58), _u(196)), (_u(14), _u(196))], fill=MID, outline=INK)
    d.line([(_u(8), _u(74)), (_u(64), _u(74)), (_u(58), _u(196)), (_u(14), _u(196)), (_u(8), _u(74))], fill=INK, width=lw, joint='curve')
    d.rounded_rectangle([_u(6), _u(50), _u(66), _u(76)], radius=_u(8), fill=CHAR, outline=INK, width=_u(4))
    d.rectangle([_u(20), _u(120), _u(52), _u(150)], fill=(255, 255, 255), outline=INK, width=_u(3))
    return _fin(im, w, h)


def item_dumbbell():
    w, h = 154, 100
    im, d = _canvas(w, h)
    lw = _u(LW)
    d.rounded_rectangle([_u(52), _u(38), _u(102), _u(62)], radius=_u(8), fill=LIGHT, outline=INK, width=lw)
    for x0, x1 in [(4, 54), (100, 150)]:
        d.rounded_rectangle([_u(x0), _u(8), _u(x1), _u(94)], radius=_u(16), fill=CHAR, outline=INK, width=lw)
        d.rectangle([_u(x0 + 14), _u(8 + 5), _u(x0 + 26), _u(94 - 5)], fill=ORANGE)
    return _fin(im, w, h)


ITEMS = [item_cap, item_shirts, item_shoe, item_bottles, item_dumbbell]


# PHOTO-STYLE ITEMS — 2026-10-01, "make Sporta Outlet and accessories category images with
# animation, realistic items product, and shelves for Sporta Outlet". The drawn flat items
# above are no longer composed (kept for a revert); the tile uses cut-outs of generated studio
# photographs (scripts/cut-photo-subjects.py), each given a soft contact shadow so it sits on
# the orange band instead of floating on it.
def photo_item(name):
    im = Image.open(os.path.join(SUBJ, f'photo-{name}.png')).convert('RGBA')
    m = int(im.width * 0.06)                     # a little room for the shadow's blur
    pad = 28
    W, H = im.width + 2 * m, im.height + pad + m // 2
    cast = Image.new('L', (W, H), 0)
    cy = im.height + pad // 3
    ImageDraw.Draw(cast).ellipse([W // 2 - int(im.width * 0.46), cy - 7, W // 2 + int(im.width * 0.46), cy + 7], fill=120)
    cast = cast.filter(ImageFilter.GaussianBlur(7))
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.paste((0, 0, 0, 255), (0, 0), cast)
    out.alpha_composite(im, (m, 0))
    return out


def photo_items():
    # cap, pack, shoes, bottle, dumbbell
    return [photo_item(n) for n in ('cap', 'pack', 'shoes', 'bottle', 'dumbbell')]


def compose_accessories(w, h, inset=0.03, share=0.50):
    """TWO ROWS since the tiles became 40% taller (2026-10-01): one long row of five
    stays width-limited, so the same row in a taller box only floated at the bottom
    with empty orange above it. Shirts, bottle and cap on top; trainers and the
    dumbbell below. `share` is the width the widest row may take: kept under half so the rows start clear of
    the tile's copy, which sits in the start half (an earlier .62 ran into the title)."""
    img = ground(w, h)
    cap, pack, shoe, bottle, dumbbell = photo_items()
    rows = [[pack, bottle, cap], [shoe, dumbbell]]
    row_w = [sum(i.width for i in r) + GAP * (len(r) - 1) for r in rows]
    row_h = [max(i.height for i in r) for r in rows]
    vgap = 20
    k = min(w * share / max(row_w), h * 0.80 / (sum(row_h) + vgap))
    rw = int(max(row_w) * k)
    ox = w - rw - int(w * inset)
    img.alpha_composite(band(w, h, ox + int(rw * 0.12), ox + int(rw * 0.88), skew=0.3))
    img.alpha_composite(stripes(w, h, ox - int(w * 0.07), ox - int(w * 0.01), 12, 3, skew=0.3))
    total_h = int((sum(row_h) + vgap) * k)
    y = h - total_h - int(h * 0.06)
    for r, rwid, rh in zip(rows, row_w, row_h):
        x = ox + (rw - int(rwid * k)) // 2
        for it in r:
            it = it.resize((max(1, int(it.width * k)), max(1, int(it.height * k))), Image.LANCZOS)
            img.alpha_composite(it, (x, y + int(rh * k) - it.height))   # stand on the row's baseline
            x += it.width + int(GAP * k)
        y += int((rh + vgap) * k)
    return img


def compose_accessories_square(w, h, far=0.05, bottom=0.08):
    """THE SQUARE PHONE TILE, 2026-10-01: three rows in the FAR half, using the square's height
    instead of two rows squeezed under the copy, so every item is drawn bigger (k 1.13 -> ~1.3).
    The copy sits in the start half at mid-height and the round go-button in the far bottom
    corner, so the rows keep `far` off the far edge and `bottom` off the foot."""
    img = ground(w, h)
    cap, pack, shoe, bottle, dumbbell = photo_items()
    rows = [[pack, bottle], [cap, dumbbell], [shoe]]
    row_w = [sum(i.width for i in r) + GAP * (len(r) - 1) for r in rows]
    row_h = [max(i.height for i in r) for r in rows]
    vgap = 14
    area_x0, area_x1 = int(w * 0.45), int(w * (1 - far))   # the copy ends about 46% across
    k = min((area_x1 - area_x0) / max(row_w), h * (0.92 - bottom) / (sum(row_h) + vgap * (len(rows) - 1)))
    total_h = int((sum(row_h) + vgap * (len(rows) - 1)) * k)
    cx = (area_x0 + area_x1) // 2
    rw = int(max(row_w) * k)
    img.alpha_composite(band(w, h, cx - int(rw * 0.56), cx + int(rw * 0.60), skew=0.3))
    img.alpha_composite(stripes(w, h, cx - int(rw * 0.84), cx - int(rw * 0.72), 12, 3, skew=0.3))
    y = h - int(h * bottom) - total_h
    for r, rwid, rh in zip(rows, row_w, row_h):
        x = cx - int(rwid * k) // 2
        for it in r:
            it = it.resize((max(1, int(it.width * k)), max(1, int(it.height * k))), Image.LANCZOS)
            img.alpha_composite(it, (x, y + int(rh * k) - it.height))   # stand on the row's baseline
            x += it.width + int(GAP * k)
        y += int((rh + vgap) * k)
    return img


def draw_shelves(pw, h, inset=0):
    """Flat, plain, cartoon shelves in the shop's own colours: an orange-edged
    unit, three planks, folded stacks and trainers with a heavy dark outline.
    Drawn at 2x and reduced, so the outlines are smooth. No text, so the
    Arabic frame is a plain mirror."""
    S = 2
    W, H = pw * S, h * S
    im = Image.new('RGB', (W, H), (244, 241, 236))
    d = ImageDraw.Draw(im)
    ink = (26, 26, 26)
    lw = max(3, int(H * 0.006))
    # a soft floor band
    d.rectangle([0, int(H * 0.93), W, H], fill=(232, 226, 218))
    fx0, fx1 = int(inset * S + W * 0.04), int(W * 0.96)
    fy0, fy1 = int(H * 0.05), int(H * 0.95)
    # the unit: orange frame, white back
    d.rounded_rectangle([fx0, fy0, fx1, fy1], radius=int(H * 0.03), fill=(255, 255, 255), outline=ORANGE, width=int(H * 0.028))
    pal = [(43, 43, 47), (139, 143, 152), (255, 255, 255), ORANGE, (201, 203, 208), (70, 72, 80)]
    inner0, inner1 = fx0 + int(W * 0.035), fx1 - int(W * 0.035)
    span = inner1 - inner0
    base = [0.315, 0.62, 0.925]
    pl = int(H * 0.028)
    for r, yb in enumerate(base):
        y = int(H * yb)
        # plank
        d.rounded_rectangle([inner0 - int(W * 0.01), y, inner1 + int(W * 0.01), y + pl], radius=pl // 3,
                            fill=ORANGE, outline=ink, width=lw)
        if r == 1:
            # trainers row
            n = 2
            cw = span / n
            for i in range(n):
                cx = inner0 + cw * (i + 0.5)
                sw = cw * 0.96
                sh = sw * 0.56
                sole = [cx - sw / 2, y - sh * 0.30, cx + sw / 2, y]
                d.rounded_rectangle(sole, radius=sh * 0.14, fill=(255, 255, 255), outline=ink, width=lw)
                x0_, top = cx - sw / 2, y - sh * 0.30
                pts = [(0.04, 0), (0.02, -0.55), (0.06, -0.92), (0.22, -1.0), (0.34, -0.86), (0.40, -0.62),
                       (0.58, -0.55), (0.74, -0.42), (0.90, -0.30), (0.98, -0.12), (0.97, 0)]
                up = [(x0_ + sw * px, top + sh * 0.72 * py) for px, py in pts]
                col = pal[0] if i % 2 == 0 else pal[3]
                d.polygon(up, fill=col)
                d.line(up + [up[0]], fill=ink, width=lw, joint='curve')
                # one white swoosh
                d.line([(x0_ + sw * 0.46, top - sh * 0.50), (x0_ + sw * 0.70, top - sh * 0.36)], fill=(255, 255, 255), width=lw)
            continue
        n = 5
        cw = span / n
        for i in range(n):
            cx0 = inner0 + cw * i + cw * 0.10
            cw2 = cw * 0.80
            layers = 3 + ((i + r) % 3)
            lh = H * 0.052
            for k in range(layers):
                col = pal[(i * 2 + k + r) % len(pal)]
                y1 = y - lh * k
                d.rounded_rectangle([cx0, y1 - lh, cx0 + cw2, y1], radius=lh * 0.28, fill=col, outline=ink, width=lw)
                d.line([(cx0 + cw2 * 0.12, y1 - lh * 0.72), (cx0 + cw2 * 0.42, y1 - lh * 0.72)],
                       fill=(255, 255, 255) if col != (255, 255, 255) else (201, 203, 208), width=lw)
    return im.resize((pw, h), Image.LANCZOS)


def photo_shelves(pw, h):
    """The generated shelving photograph, cover-cropped to the panel (full height, a slice of
    the unit's width starting at its left post, so the orange-capped frame is the first thing
    the slanted edge shows)."""
    im = Image.open(os.path.join(SUBJ, 'photo-shelves.jpg')).convert('RGB')
    # 2026-10-02: the products read small, so the photo is 1.25x larger than the panel's height
    # and cropped from the BOTTOM-LEFT of its top corner, which also pushes the shelves toward
    # the right (the far edge) instead of leaving the empty frame there.
    ZOOM = 1.25
    k = h * ZOOM / im.height
    im = im.resize((int(im.width * k), int(h * ZOOM)), Image.LANCZOS)
    x0 = int(im.width * 0.04)
    y0 = int(h * (ZOOM - 1) * 0.5)
    if im.width - x0 < pw:
        return im.resize((pw, h), Image.LANCZOS)
    return im.crop((x0, y0, x0 + pw, y0 + h))


def compose_outlet(w, h, rtl=False):
    """Drawn shelves on the far side, cut on the tile's slant, with an orange
    edge line and an orange border round the whole tile; the start side stays
    white and WIDE ENOUGH FOR THE COPY (the title ran under the photo on a
    phone in the first full-bleed version). 2026-09-29: plain flat shelves with
    orange borders, in a cartoon style, at the owner's request."""
    img = ground(w, h)
    s = int(h * 0.17)                                   # the tile's slant
    x0 = int(w * 0.53)                                  # picture's top-left corner
    pw = w - x0 + s
    crop = photo_shelves(pw, h).convert('RGBA')
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).polygon([(x0, 0), (w, 0), (w, h), (x0 - s, h)], fill=255)
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    layer.paste(crop, (x0 - s, 0))
    layer.putalpha(mask)
    edge = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(edge).line([(x0, 0), (x0 - s, h)], fill=ORANGE + (255,), width=max(3, int(h * 0.007)))
    img.alpha_composite(stripes(w, h, x0 - int(w * 0.13), x0 - int(w * 0.06), 12, 3))
    img.alpha_composite(layer)
    img.alpha_composite(edge)
    bw = max(3, int(h * 0.007))                          # thin border (was 2% of the height)
    dr = ImageDraw.Draw(img)
    for i in range(bw):
        dr.rectangle([i, i, w - 1 - i, h - 1 - i], outline=ORANGE + (255,))
    return img


def save(img, crop, name, rtl_src=None):
    rgb = img.convert('RGB')
    mirror = (rtl_src or img).convert('RGB').transpose(Image.FLIP_LEFT_RIGHT)
    for n, im in [(name, rgb), (name + '-rtl', mirror)]:
        p = os.path.join(ROOT, crop, f'art-{n}')
        im.save(p + '.jpg', quality=92, optimize=True, progressive=True)
        im.save(p + '.webp', quality=90, method=6)
        print(crop, n, im.size)


for crop, sz in SIZES.items():
    w, h = sz['tall']
    square = crop == 'mobile'
    save(compose_person('men', w, h, sharpen=square), crop, 'men')
    save(compose_person('women', w, h, sharpen=square), crop, 'women')
    if square:
        # the go-button is in the FAR bottom corner in both languages, and the Arabic frame is a
        # mirror, so one composition serves both
        save(compose_accessories_square(w, h, far=0.06, bottom=0.10), crop, 'accessories')   # 4:3, like desktop
        save(compose_outlet(w, h), crop, 'outlet')
        continue
    # All four tiles share one shape since 2026-09-28: the wide 2.9:1 strip left
    # no room for the accessories to grow.
    # The round go-button sits in the PHYSICAL bottom-left of every tile, so the
    # Arabic frame (a mirror, row on the left) needs its row pulled clear of it.
    # desktop uses the three-row composition too (2026-10-01): the tile is nearly square, and the
    # photo items are too wide for the two-row layout to draw them at a decent size
    save(compose_accessories_square(w, h, far=0.06, bottom=0.10), crop, 'accessories')
    save(compose_outlet(w, h), crop, 'outlet')
