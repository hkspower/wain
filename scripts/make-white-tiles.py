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


# THE FLAT LAY, REPACKED — 2026-09-28, "render accessories bigger and clear".
# The cut-out is one 942x418 row; laid out as a row it is width-bound, since
# the copy takes the reading-start ~32% of the tile. So each item is cut out of
# the row by its bounding box (measured with scipy.ndimage.label) and placed
# in a tighter, overlapping cluster, drawn back to front.
ITEMS = [  # name, crop box in the cut-out, position in the cluster (back to front)
    # Arranged 2026-09-28 ("arrange items, fix cap") in three columns on one
    # floor: shoes over the dumbbell, the shirts, the bottles. Items the
    # ORIGINAL frame cut off (shirts, bottles, dumbbell at the bottom) stand on
    # the tile's bottom edge, so their straight cut lines are hidden by it.
    ('shoes',    (16, 0, 283, 305),    (0, 60)),
    ('shirts',   (321, 0, 680, 418),   (250, 42)),
    ('bottles',  (704, 277, 942, 418), (556, 319)),
    ('dumbbell', (0, 353, 277, 418),   (10, 395)),
]
CLUSTER = (794, 460)
# THE CAP IS PLACED ON ITS OWN. The original frame cut it at the TOP and the
# RIGHT, which left two straight edges wherever it floated. It now sits in the
# tile's top-right corner, where both cut lines meet the tile's own edges.
CAP = (702, 0, 942, 264)


def compose_accessories(w, h):
    img = ground(w, h)
    src = Image.open(os.path.join(SUBJ, 'accessories.png')).convert('RGBA')
    k = min(w * 0.68 / CLUSTER[0], h * 0.80 / CLUSTER[1])
    cw, ch = int(CLUSTER[0] * k), int(CLUSTER[1] * k)
    ox = w - cw - int(w * 0.02)
    oy = h - ch
    img.alpha_composite(band(w, h, ox + int(cw * 0.18), ox + int(cw * 0.70), skew=0.3))
    img.alpha_composite(stripes(w, h, ox - int(w * 0.07), ox - int(w * 0.01), 12, 3, skew=0.3))

    def put(box, x, y):
        it = src.crop(box)
        it = it.resize((max(1, int(it.width * k)), max(1, int(it.height * k))), Image.LANCZOS)
        # "and make clear": the items are upscaled from the 1216px art, so a
        # modest unsharp mask on the colour (not the alpha edge) restores bite.
        rgb = it.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.6, percent=90, threshold=2))
        rgb.putalpha(it.getchannel('A'))
        img.alpha_composite(rgb, (x, y))
        return it.size

    # the cap first, so nothing in the cluster is ever behind a corner piece
    cap_w = int((CAP[2] - CAP[0]) * k)
    put(CAP, w - cap_w, 0)
    for _, box, (px, py) in ITEMS:
        put(box, ox + int(px * k), oy + int(py * k))
    return img


def compose_outlet(w, h, rtl=False):
    img = ground(w, h)
    photo = Image.open(os.path.join(SUBJ, 'outlet.jpg')).convert('RGBA')
    # The shelves carry "CLEARANCE" signs, so the Arabic frame mirrors the
    # LAYOUT but not the photo: pre-flip it here, and save()'s mirror puts it
    # back the right way round.
    if rtl:
        photo = photo.transpose(Image.FLIP_LEFT_RIGHT)
    ph = int(h * 0.80); pw = int(ph * photo.width / photo.height)
    photo = photo.resize((pw, ph), Image.LANCZOS)
    x = w - pw - int(w * 0.05); y = (h - ph) // 2
    # a black band behind the frame, the orange kept for the frame and the stripes
    dark = band(w, h, x + int(pw * 0.25), w + 80)
    dark_px = np.array(dark); dark_px[..., :3] = (20, 20, 19); img.alpha_composite(Image.fromarray(dark_px))
    img.alpha_composite(stripes(w, h, x - int(w * 0.09), x - int(w * 0.02), 12, 3))
    r = int(h * 0.05); b = max(4, int(h * 0.012))
    mask = Image.new('L', (pw, ph), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, pw - 1, ph - 1], radius=r, fill=255)
    frame = Image.new('RGBA', (pw + 2 * b, ph + 2 * b), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle([0, 0, pw + 2 * b - 1, ph + 2 * b - 1], radius=r + b, fill=ORANGE + (255,))
    img.alpha_composite(frame, (x - b, y - b))
    photo.putalpha(mask)
    img.alpha_composite(photo, (x, y))
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
    save(compose_accessories(w, h), crop, 'accessories')
    save(compose_outlet(w, h), crop, 'outlet', rtl_src=compose_outlet(w, h, rtl=True))
