#!/usr/bin/env python3
"""Hero frames: a higher-resolution, sharpened render of the five 1600px desktop banners.

    python3 scripts/make-hero-sharp.py

2026-10-01, "improve render and hero slide images make no blur". WHAT IS AND IS NOT BLURRY:
the live carousel's own slides are 3200x1270 (hero_slides rows) and are sharp. The soft thing a
visitor sees is the placeholder frame, /hero/desktop/<name>.webp — only 1600px wide — which sits
under the page until the real slide arrives, and which a retina screen enlarges by the browser's
cheap bilinear stretch.

THIS CANNOT ADD DETAIL THAT IS NOT IN THE ART, and says so. It enlarges once, with Lanczos, to
2560px (a 1280px-wide screen at 2x) and applies a modest unsharp mask, so edges are crisp instead of
smeared by the browser's stretch. The proper fix is the owner's larger masters (3200px); drop them
into sporta-site/assets/hero-originals/ and re-run, and the same script uses them.

The ORIGINALS are kept in sporta-site/assets/hero-originals/ (outside the docroot) and are always
the input, so running this twice never sharpens a sharpened copy. A source already at or above
2560 is only re-encoded, never enlarged.
"""
import os
from PIL import Image, ImageFilter

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, '..', 'sporta-site', 'assets', 'hero-originals')
OUT = os.path.join(HERE, '..', 'sporta-site', 'public_html', 'hero', 'desktop')
TARGET_W = 2560

for name in sorted(os.listdir(SRC)):
    if not name.endswith('.webp'):
        continue
    im = Image.open(os.path.join(SRC, name)).convert('RGB')
    if im.width < TARGET_W:
        h = round(im.height * TARGET_W / im.width)
        im = im.resize((TARGET_W, h), Image.LANCZOS)
        im = im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=60, threshold=2))
    dst = os.path.join(OUT, name)
    im.save(dst, quality=84, method=6)
    print(name, im.size, os.path.getsize(dst) // 1024, 'kB')
