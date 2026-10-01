#!/usr/bin/env python3
"""One-off: cut the photo-style subjects for the Accessories and Outlet tiles out of two
generated studio photographs (2026-10-01, ByteDance Seedream 5 Pro, 16:9, 2048x1152,
items on a plain white ground). The generations are not in the repository — only their
cut-outs are, in scripts/fixtures/tile-subjects/, so make-white-tiles.py stays reproducible.

    python3 scripts/cut-photo-subjects.py <accessories-master.png> <shelves-master.png>

The ground is white and every item is dark or orange, so the alpha comes from the colour
distance to white (smooth-stepped), not a segmentation model: the faint floor shadow under
each item falls below the threshold and is dropped, and make-white-tiles.py draws its own."""
import sys, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

OUT = os.path.join(os.path.dirname(__file__), 'fixtures', 'tile-subjects')
acc = Image.open(sys.argv[1]).convert('RGB')
shelves = Image.open(sys.argv[2]).convert('RGB')

# bounding boxes on the 1024x576 preview, x2 for the master, padded
BOXES = {'cap': (425, 20, 590, 112), 'bottle': (484, 104, 548, 236), 'pack': (420, 226, 610, 414),
         'shoes': (428, 404, 608, 488), 'dumbbell': (430, 492, 582, 552)}

def smooth(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

for name, (x0, y0, x1, y1) in BOXES.items():
    crop = acc.crop((x0 * 2, y0 * 2, x1 * 2, y1 * 2))
    a = np.asarray(crop).astype(np.float32)
    dist = 255 - a.min(axis=2)            # 0 on white, large on a dark or orange pixel
    alpha = smooth(dist, 55, 110)
    if name in ('cap', 'bottle', 'dumbbell'):
        # these are black: a neutral mid-to-light grey pixel is the floor shadow, not the item
        mx, mn = a.max(axis=2), a.min(axis=2)
        alpha = alpha * (1 - smooth(mx, 100, 140) * (1 - smooth(mx - mn, 18, 40)))
    # keep only the biggest connected piece: the padded box also catches slivers of the
    # neighbouring items and the grey floor shadow, which are separate blobs
    lab, n = ndimage.label(ndimage.binary_closing(dist > 70, iterations=3))
    if n:
        keep = lab == (1 + int(np.argmax(ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)))))
        keep = ndimage.binary_dilation(keep, iterations=3)
        alpha = alpha * keep
    m = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(5))
    rgba = crop.convert('RGBA')
    rgba.putalpha(m)
    bb = rgba.getbbox()
    rgba = rgba.crop(bb)
    rgba.save(os.path.join(OUT, f'photo-{name}.png'), optimize=True)
    print(name, rgba.size)

# the shelving unit, full height, trimmed to the frame with a little ground either side
sh = shelves.crop((350, 0, 1700, 1152))
sh.save(os.path.join(OUT, 'photo-shelves.jpg'), quality=90, optimize=True)
print('shelves', sh.size)
