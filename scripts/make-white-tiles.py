#!/usr/bin/env python3
"""Category tiles: white ground, orange band, the subject on the far side.

    python3 scripts/make-white-tiles.py

Asked for on 2026-09-28 as "make all category images white with orange
frills, sporty modern style", approved from the design mockup. Writes all
of cats/{desktop,mobile}/art-{men,women,accessories,outlet}[-rtl].{jpg,webp}
at the sizes the tiles already use (1216x706 / 1216x418 desktop, 900x570 /
900x454 mobile), so nothing is cropped by `cover`.

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
SIZES = {'desktop': {'tall': (1216, 706), 'wide': (1216, 418)},
         'mobile':  {'tall': (900, 570),  'wide': (900, 454)}}
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


def compose_person(name, w, h):
    img = ground(w, h)
    sub = Image.open(os.path.join(SUBJ, f'{name}.png')).convert('RGBA')
    sh = int(h * 0.96)
    sub = sub.resize((int(sub.width * sh / sub.height), sh), Image.LANCZOS)
    x = w - sub.width - int(w * 0.14)
    y = h - sub.height
    img.alpha_composite(band(w, h, x - int(w * 0.06), x + sub.width + int(w * 0.10)))
    img.alpha_composite(stripes(w, h, x - int(w * 0.17), x - int(w * 0.07), 14, 4))
    img = Image.composite(Image.new('RGBA', (w, h), (20, 12, 8, 255)), img,
                          shadow(w, h, x + sub.width // 2, h - 6, sub.width * 0.6, 12))
    img.alpha_composite(sub, (x, y))
    return img


# THE FLAT LAY, ONE ROW — 2026-09-29, "make accessories image all items one
# row and fix cap edges". The five items stand side by side on the tile's
# bottom edge (which hides the straight cut lines the ORIGINAL frame left on
# the shirts, bottles and dumbbell), in the order the owner chose: cap,
# shirts, shoes, bottles, dumbbell. Each is cut out of the row by its bounding
# box (measured with scipy.ndimage.label). GAP is negative so neighbours tuck
# together and the row reads as one set.
ITEMS = [  # name, crop box in the cut-out, cut_top (frame sliced its top)
    ('cap',      (702, 0, 942, 264),   True),
    ('shirts',   (321, 0, 680, 418),   True),
    ('shoes',    (16, 0, 283, 305),    True),
    ('bottles',  (704, 277, 942, 418), False),
    ('dumbbell', (0, 353, 277, 418),   False),
]
GAP = 6
ROW_W = sum(b[2] - b[0] for _, b, _ in ITEMS) + GAP * (len(ITEMS) - 1)
ROW_H = max(b[3] - b[1] for _, b, _ in ITEMS)


def clean_alpha(a, cut_top):
    """The rembg matte is soft and dark-fringed: pull the edge in a pixel,
    then make it crisp-but-smooth (blur, then a steep ramp), so the outline of
    the cap reads as a clean line instead of a ragged halo. Where the source
    frame sliced the item at its top, fade those rows out instead of leaving
    a flat cut."""
    a = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.1))
    arr = np.asarray(a, np.float32) / 255.0
    arr = np.clip((arr - 0.30) / 0.40, 0, 1)
    arr = arr * arr * (3 - 2 * arr)                      # smoothstep
    if cut_top:
        n = min(5, arr.shape[0])
        arr[:n] *= np.linspace(0.0, 1.0, n)[:, None] ** 1.5
    return Image.fromarray((arr * 255).astype(np.uint8))


def compose_accessories(w, h, inset=0.03, share=0.58):
    img = ground(w, h)
    src = Image.open(os.path.join(SUBJ, 'accessories.png')).convert('RGBA')
    # the copy takes the start half, so the row lives in the far ~56%
    k = min(w * share / ROW_W, h * 0.58 / ROW_H)
    rw, rh = int(ROW_W * k), int(ROW_H * k)
    ox = w - rw - int(w * inset)
    img.alpha_composite(band(w, h, ox + int(rw * 0.16), ox + int(rw * 0.80), skew=0.3))
    img.alpha_composite(stripes(w, h, ox - int(w * 0.07), ox - int(w * 0.01), 12, 3, skew=0.3))
    x = ox
    for _, box, cut_top in ITEMS:
        it = src.crop(box)
        it = it.resize((max(1, int(it.width * k)), max(1, int(it.height * k))), Image.LANCZOS)
        rgb = it.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.6, percent=90, threshold=2))
        rgb.putalpha(clean_alpha(it.getchannel('A'), cut_top))
        img.alpha_composite(rgb, (x, h - rgb.height))
        x += rgb.width + int(GAP * k)
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
    crop = draw_shelves(pw, h, inset=s).convert('RGBA')
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).polygon([(x0, 0), (w, 0), (w, h), (x0 - s, h)], fill=255)
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    layer.paste(crop, (x0 - s, 0))
    layer.putalpha(mask)
    edge = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(edge).line([(x0, 0), (x0 - s, h)], fill=ORANGE + (255,), width=max(8, int(h * 0.02)))
    img.alpha_composite(stripes(w, h, x0 - int(w * 0.13), x0 - int(w * 0.06), 12, 3))
    img.alpha_composite(layer)
    img.alpha_composite(edge)
    bw = max(8, int(h * 0.02))
    dr = ImageDraw.Draw(img)
    for i in range(bw):
        dr.rectangle([i, i, w - 1 - i, h - 1 - i], outline=ORANGE + (255,))
    return img


def save(img, crop, name, rtl_src=None):
    rgb = img.convert('RGB')
    mirror = (rtl_src or img).convert('RGB').transpose(Image.FLIP_LEFT_RIGHT)
    for n, im in [(name, rgb), (name + '-rtl', mirror)]:
        p = os.path.join(ROOT, crop, f'art-{n}')
        im.save(p + '.jpg', quality=86, optimize=True, progressive=True)
        im.save(p + '.webp', quality=82, method=6)
        print(crop, n, im.size)


for crop, sz in SIZES.items():
    w, h = sz['tall']
    save(compose_person('men', w, h), crop, 'men')
    save(compose_person('women', w, h), crop, 'women')
    # All four tiles share one shape since 2026-09-28: the wide 2.9:1 strip left
    # no room for the accessories to grow.
    # The round go-button sits in the PHYSICAL bottom-left of every tile, so the
    # Arabic frame (a mirror, row on the left) needs its row pulled clear of it.
    save(compose_accessories(w, h), crop, 'accessories',
         rtl_src=compose_accessories(w, h, inset=0.12, share=0.52))
    save(compose_outlet(w, h), crop, 'outlet')
