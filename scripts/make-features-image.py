"""assets/features.webp — the panel the "Sporta features" rows sit INSIDE on the home page.

2026-10-03: the owner asked for the two models to go and the text to sit inside, in white, on the
orange band. So: no people, and the band is wide and central — at every height it covers
x = 0.225W..0.935W, and the panel is shown with background-size: cover, so a phone's crop lands
entirely on orange. Text placed over the white edges would be white on white.


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
W, H = 1600, 600

img = Image.new('RGBA', (W, H), (255, 255, 255, 255))
s = int(H * 0.12)
band = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(band).polygon([(int(W * .18) + s, -10), (int(W * .98) + s, -10), (int(W * .98) - s, H + 10), (int(W * .18) - s, H + 10)],
                             fill=ORANGE + (255,))
img.alpha_composite(band)
st = Image.new('RGBA', (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(st)
x = int(W * .04)
while x < int(W * .15):
    d.polygon([(x + s, -10), (x + 9 + s, -10), (x + 9 - s, H + 10), (x - s, H + 10)], fill=ORANGE + (70,))
    x += 26
img.alpha_composite(st)

people = []                                          # the models were removed, 2026-10-03
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
