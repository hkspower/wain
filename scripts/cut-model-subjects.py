#!/usr/bin/env python3
"""One-off: cut the Men and Women tile models out of two generated studio photographs
(2026-10-01, ByteDance Seedream 5 Pro, 16:9, 2048x1152, one person on a plain white ground).
The generations are not in the repository, only the cut-outs are, in
scripts/fixtures/tile-subjects/men.png and women.png, so make-white-tiles.py stays reproducible.

    python3 scripts/cut-model-subjects.py <men-master.png> <women-master.png>

Replaces cut-outs that were ~650px tall and had to be enlarged 1.6x to fill a tile; these are
~1000px tall, so a tile now shows them at or near native size. Alpha comes from the colour
distance to white (smooth-stepped), holes filled, the largest connected piece kept, and the
white that bleeds into the edge pixels is removed (un-matted against white) so there is no
pale halo on the orange. The floor shadow is lighter than the threshold and is dropped;
make-white-tiles.py draws its own contact shadow."""
import sys, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

OUT = os.path.join(os.path.dirname(__file__), 'fixtures', 'tile-subjects')

def smooth(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def cut(src, name):
    rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    dist = 255 - rgb.min(axis=2)
    alpha = smooth(dist, 38, 95)
    solid = ndimage.binary_closing(dist > 60, iterations=3)
    # fill only SMALL holes (a white shoe sole, a logo): the gap between an arm and the torso is
    # background and stays transparent, or it shows as a white wedge on the orange band
    holes = ndimage.binary_fill_holes(solid) & ~solid
    hl, hn = ndimage.label(holes)
    sizes = ndimage.sum(holes, hl, range(1, hn + 1))
    for i, sz in enumerate(sizes, 1):
        if sz < 1500:
            solid |= hl == i
    # the white soles sit at the very bottom and open to the floor, so close harder there
    ys = np.where(solid.any(axis=1))[0]
    low = int(ys.max() - (ys.max() - ys.min()) * 0.07)
    solid[low:] = ndimage.binary_closing(solid, iterations=14)[low:]
    lab, n = ndimage.label(solid)
    keep = lab == (1 + int(np.argmax(ndimage.sum(np.ones_like(lab), lab, range(1, n + 1)))))
    keep = ndimage.binary_dilation(keep, iterations=2)
    alpha = alpha * keep
    alpha = np.maximum(alpha, ndimage.binary_erosion(keep, iterations=3).astype(np.float32))
    m = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    a = np.asarray(m).astype(np.float32)[..., None] / 255
    clean = np.clip((rgb - (1 - a) * 255) / np.maximum(a, 0.05), 0, 255)
    out = Image.fromarray(np.dstack([clean, a * 255]).astype(np.uint8), 'RGBA')
    out = out.crop(out.getbbox())
    out.save(os.path.join(OUT, f'{name}.png'), optimize=True)
    print(name, out.size)

cut(sys.argv[1], 'men')
cut(sys.argv[2], 'women')
