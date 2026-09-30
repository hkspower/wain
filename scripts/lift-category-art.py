#!/usr/bin/env python3
"""Open up the shadows in the category artwork without touching the brand orange.

    python3 scripts/lift-category-art.py            # report only
    python3 scripts/lift-category-art.py --write    # apply

WHY IT IS NOT A BRIGHTNESS SLIDER, and not a plain gamma either.

The tiles are dark — mean luma 34 to 75, tenth percentile as low as 6 — so the
shadows really are crushed and there is plenty of headroom above (ninetieth
percentile only 57 to 129). The obvious move is a gamma below 1, and I tried
it: gamma 0.80 lifted every mean by 14 to 18 points and looked right.

It also broke something. The artwork contains a large ORANGE panel with white
text over it, and that orange has a luminance of 62 — it is a shadow by the
maths even though it reads as a bright colour. Lifting it took white-on-orange
from 3.59:1 to 3.00:1, measured. It was already under the 4.5 that the small
kicker text needs; the lift made it worse.

So the lift is weighted by SATURATION as well as luminance:

    amount = shadow_falloff(luma) * (1 - saturation) ** 2

A neutral dark — the grey studio background, the black gym floor, the shadow
under a shoulder — has saturation near 0 and gets the full lift. The orange
panel has saturation near 1 and is left almost exactly as it was. Skin tones
sit in between and move a little, which is what you want.

The falloff ends at luma 130: above that the picture is already bright and
lifting it only flattens the image and clips highlights.

Both the .jpg and the .webp are written from the same processed pixels. They
are alternates of one picture — the browser picks whichever it prefers — and
letting them drift means two visitors see two different shops.
"""
import sys, os, glob
import numpy as np
from PIL import Image

WRITE = '--write' in sys.argv
ROOT = os.path.join(os.path.dirname(__file__), '..', 'sporta-site', 'public_html')

# WCAG relative luminance, so "shadow" means what the contrast maths means.
def luma(a):
    c = a / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]

def lift(im, strength=0.55, ends_at=130 / 255):
    a = np.asarray(im.convert('RGB'), dtype=np.float64)
    y = luma(a)                                   # 0..1
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0.0)

    # Full effect at black, none at ends_at, smooth in between.
    t = np.clip(1.0 - y / ends_at, 0.0, 1.0) ** 1.5
    amount = strength * t * (1.0 - sat) ** 2      # neutrals only

    # A gamma applied per-pixel at the strength decided above. Working on the
    # channels together keeps hue and saturation where they are; scaling each
    # channel independently would drift the colour.
    g = 1.0 - 0.45 * amount
    y_safe = np.maximum(y, 1e-6)
    scale = (y_safe ** g) / y_safe
    out = np.clip(a * scale[..., None], 0, 255)
    return Image.fromarray(out.astype(np.uint8))

def stats(im):
    g = np.asarray(im.convert('L'))
    return g.mean(), np.percentile(g, 10), np.percentile(g, 90)

files = sorted(glob.glob(os.path.join(ROOT, 'cats', '*', 'art-*.jpg')))
print(f"{'file':38} {'mean':>13} {'p10':>11} {'p90':>11}")
for jpg in files:
    src = Image.open(jpg).convert('RGB')
    new = lift(src)
    a, b = stats(src), stats(new)
    rel = os.path.relpath(jpg, ROOT)
    print(f"{rel:38} {a[0]:5.1f} -> {b[0]:5.1f} {a[1]:5.0f} -> {b[1]:3.0f} {a[2]:5.0f} -> {b[2]:3.0f}")
    if WRITE:
        new.save(jpg, 'JPEG', quality=86, optimize=True, progressive=True)
        new.save(jpg[:-4] + '.webp', 'WEBP', quality=84, method=6)

print('\nwritten' if WRITE else '\nreport only — pass --write to apply')
