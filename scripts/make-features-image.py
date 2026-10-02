"""assets/features.webp — the picture beside the three rows of "Sporta features" on the home page.

Built from the two cut-outs the category tiles already use (scripts/fixtures/tile-subjects/), in the
tiles' own look: white ground, the orange slanted band, faint stripes, a soft floor shadow. 2026-10-02.
Deterministic (no random grain), so re-running it changes nothing:  python3 scripts/make-features-image.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(__file__)
SUBJ = os.path.join(HERE, 'fixtures', 'tile-subjects')
OUT = os.path.join(HERE, '..', 'sporta-site', 'public_html', 'assets', 'features.webp')
ORANGE = (224, 86, 28)
W, H = 1200, 900

img = Image.new('RGBA', (W, H), (255, 255, 255, 255))
s = int(H * 0.22)
band = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(band).polygon([(int(W * .30) + s, -10), (int(W * .98) + s, -10), (int(W * .98) - s, H + 10), (int(W * .30) - s, H + 10)],
                             fill=ORANGE + (255,))
img.alpha_composite(band)
st = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(st)
x = int(W * .04)
while x < int(W * .20):
    d.polygon([(x + s, -10), (x + 9 + s, -10), (x + 9 - s, H + 10), (x - s, H + 10)], fill=ORANGE + (70,))
    x += 26
img.alpha_composite(st)

people = [('women', .40), ('men', .68)]            # name, centre x as a share of the width
for name, cx in people:
    sub = Image.open(os.path.join(SUBJ, f'{name}.png')).convert('RGBA')
    sh = int(H * 0.90)
    sw = int(sub.width * sh / sub.height)
    sub = sub.resize((sw, sh), Image.LANCZOS)
    foot = int(H * 0.965)
    sh_layer = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh_layer).ellipse([int(W * cx) - sw * .55, foot - 16, int(W * cx) + sw * .55, foot + 16], fill=110)
    sh_layer = sh_layer.filter(ImageFilter.GaussianBlur(14))
    dark = Image.new('RGBA', (W, H), (20, 14, 8, 255))
    dark.putalpha(sh_layer)
    img.alpha_composite(dark)
    img.alpha_composite(sub, (int(W * cx) - sw // 2, foot - sh))

img.convert('RGB').save(OUT, quality=84, method=6)
print('wrote', os.path.normpath(OUT), os.path.getsize(OUT), 'bytes')
