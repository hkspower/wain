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
GAP = -30
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


def compose_accessories(w, h):
    img = ground(w, h)
    src = Image.open(os.path.join(SUBJ, 'accessories.png')).convert('RGBA')
    # the copy takes the start half, so the row lives in the far ~56%
    k = min(w * 0.58 / ROW_W, h * 0.58 / ROW_H)
    rw, rh = int(ROW_W * k), int(ROW_H * k)
    ox = w - rw - int(w * 0.03)
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


def compose_outlet(w, h, rtl=False):
    """The shelves photo fills the whole far side, edge to edge and top to
    bottom, cut on the tile's own slant, with an orange edge line and an orange
    border round the whole tile; the start side stays white for the copy.
    (2026-09-29, "make the outlet photo full size with orange borders and a
    white body" — chosen over an illustrated shopfront.)"""
    img = ground(w, h)
    photo = Image.open(os.path.join(SUBJ, 'outlet.jpg')).convert('RGB')
    # The shelves carry "CLEARANCE" signs, so the Arabic frame mirrors the
    # LAYOUT but not the photo: pre-flip it here, and save()'s mirror puts it
    # back the right way round.
    if rtl:
        photo = photo.transpose(Image.FLIP_LEFT_RIGHT)
    s = int(h * 0.17)                                   # the tile's slant
    x0 = int(w * 0.40)                                  # photo's top-left corner
    pw = w - x0 + s
    scale = max(pw / photo.width, h / photo.height)
    ph_ = photo.resize((int(photo.width * scale) + 1, int(photo.height * scale) + 1), Image.LANCZOS)
    ph_ = ph_.filter(ImageFilter.UnsharpMask(radius=1.4, percent=80, threshold=2))
    left = (ph_.width - pw) // 2
    crop = ph_.crop((left, 0, left + pw, h)).convert('RGBA')
    mask = Image.new('L', (w, h), 0)
    poly = [(x0, 0), (w, 0), (w, h), (x0 - s, h)]
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    layer.paste(crop, (x0 - s, 0))
    layer.putalpha(mask)
    # orange edge line on the slant, then the tile's orange border on top
    edge = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(edge).line([(x0, 0), (x0 - s, h)], fill=ORANGE + (255,), width=max(8, int(h * 0.02)))
    img.alpha_composite(stripes(w, h, x0 - int(w * 0.10), x0 - int(w * 0.03), 12, 3))
    img.alpha_composite(layer)
    img.alpha_composite(edge)
    bw = max(8, int(h * 0.02))
    d = ImageDraw.Draw(img)
    for i in range(bw):
        d.rectangle([i, i, w - 1 - i, h - 1 - i], outline=ORANGE + (255,))
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
