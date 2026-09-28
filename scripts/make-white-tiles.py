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
cut-out). Re-cutting is not repeated here so the output is reproducible.
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


def compose_accessories(w, h):
    img = ground(w, h)
    sub = Image.open(os.path.join(SUBJ, 'accessories.png')).convert('RGBA')
    # The phone crop is squarer, and the copy sits over its left 76%: the
    # flat lay is scaled to the tile's WIDTH there so it stays on the far side.
    sh = min(int(h * 0.84), int(w * 0.52 * sub.height / sub.width))
    sub = sub.resize((int(sub.width * sh / sub.height), sh), Image.LANCZOS)
    x = w - sub.width - int(w * 0.03)
    y = (h - sub.height) // 2 + int(h * 0.04)
    img.alpha_composite(band(w, h, x + int(sub.width * 0.15), x + int(sub.width * 0.75), skew=0.35))
    img.alpha_composite(stripes(w, h, w - int(w * 0.08), w + 40, 12, 3, skew=0.35))
    img = Image.composite(Image.new('RGBA', (w, h), (20, 12, 8, 255)), img,
                          shadow(w, h, x + sub.width // 2, y + sub.height - 4, sub.width * 0.45, 10, 80))
    img.alpha_composite(sub, (x, y))
    return img


def compose_outlet(w, h):
    img = ground(w, h)
    photo = Image.open(os.path.join(SUBJ, 'outlet.jpg')).convert('RGBA')
    ph = int(h * 0.80); pw = int(ph * 1.38)
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


def save(img, crop, name):
    rgb = img.convert('RGB')
    for n, im in [(name, rgb), (name + '-rtl', rgb.transpose(Image.FLIP_LEFT_RIGHT))]:
        p = os.path.join(ROOT, crop, f'art-{n}')
        im.save(p + '.jpg', quality=86, optimize=True, progressive=True)
        im.save(p + '.webp', quality=82, method=6)
        print(crop, n, im.size)


for crop, sz in SIZES.items():
    w, h = sz['tall']
    save(compose_person('men', w, h), crop, 'men')
    save(compose_person('women', w, h), crop, 'women')
    w, h = sz['wide']
    save(compose_accessories(w, h), crop, 'accessories')
    save(compose_outlet(w, h), crop, 'outlet')
