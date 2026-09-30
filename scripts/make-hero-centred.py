"""Hero slides with the athlete centred — 2026-09-29, "make all hero slide
models full centered and better aspect ratio and improve model quality".

Desktop: the 2.52:1 frame shifted so the athlete's centre lands on the
middle; the side the shift opens is filled by stretching the backdrop's own
edge columns and blurring them, which on a studio gradient reads as more of
the same wall. Phone: a 4:5 crop around the athlete, because the phone hero
box is taller than it is wide and a 2.52:1 banner there shows a third of the
picture. Both get a gentle unsharp mask; no detail is invented, so the
1600px CrossFit master stays a 1600px image upscaled.
"""
import os, sys
from PIL import Image, ImageFilter

SRC = 'sporta-site/assets/hero'
OUT = 'sporta-site/assets/hero'
# name, source file, athlete centre as a fraction of the width
SLIDES = [
    ('runner',     'runner-clean.webp',           0.506),
    ('activewear', 'activewear-clean.webp',       0.659),
    ('training',   'training-clean.webp',         0.506),
    ('features',   'features-clean-desktop.webp', 0.160),
    ('crossfit',   'crossfit-desktop.webp',       0.500),
]

def sharpen(im):
    return im.filter(ImageFilter.UnsharpMask(radius=2, percent=70, threshold=3))

def centre(im, cx):
    w, h = im.size
    d = int(w * (0.5 - cx))           # >0 moves the picture right
    out = Image.new('RGB', (w, h))
    out.paste(im, (d, 0))
    band = max(8, w // 200)
    if d > 0:                         # fill the left strip from the left edge
        edge = im.crop((0, 0, band, h)).resize((d, h), Image.BILINEAR)
        out.paste(edge.filter(ImageFilter.GaussianBlur(24)), (0, 0))
    elif d < 0:
        edge = im.crop((w - band, 0, w, h)).resize((-d, h), Image.BILINEAR)
        out.paste(edge.filter(ImageFilter.GaussianBlur(24)), (w + d, 0))
    return out

for name, f, cx in SLIDES:
    im = Image.open(os.path.join(SRC, f)).convert('RGB')
    if im.width < 3200:
        im = im.resize((3200, round(3200 * im.height / im.width)), Image.LANCZOS)
    im = im.resize((3200, 1270), Image.LANCZOS)
    d = sharpen(centre(im, cx))
    d.save(os.path.join(OUT, f'{name}-centred-desktop.webp'), quality=88, method=6)
    # phone 4:5, from the centred frame so it is centred by construction
    # the runner's stride is wider than 4:5, so his frame is square
    ratio = 1.0 if name == 'runner' else 4 / 5
    ch = d.height; cw = int(ch * ratio)
    x = (d.width - cw) // 2
    m = d.crop((x, 0, x + cw, ch)).resize((1080, round(1080 / ratio)), Image.LANCZOS)
    m.save(os.path.join(OUT, f'{name}-centred-mobile.webp'), quality=86, method=6)
    print(name, 'shift', round((0.5 - cx) * 100, 1), '%')
