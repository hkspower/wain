# OUTLET — shop shelving (رفوف) stocked with assorted goods, one warm store
# lamp above the top shelf. Rows drift; lower shelves sink into the charcoal.
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from paint_lib import (W, H, BURNT, BRIGHT, DUST, rng, base_canvas, warm_glow,
                       mask_of, rim_from, carve, bloom, finish)

img, xx, yy = base_canvas()

LAMP = (1240, -60)
KEY = (0.25, -1.35)          # light pours DOWN -> rims on the top edges

# ---- the lamp: one pool of warm air above the top shelf --------------------
img = warm_glow(img, LAMP[0], LAMP[1], 760, 0.30, DUST)
img = warm_glow(img, LAMP[0], LAMP[1] + 90, 420, 0.22, BURNT)
img = warm_glow(img, 900, H - 60, 700, 0.045, BURNT)   # faintest floor reflection

# ---- three shelf planes, seen slightly from below --------------------------
# Each shelf: goods first (behind), then the shelf slab carves over their feet.
SHELVES = [
    {'y': 330, 'x0': 700, 'sink': 1.00},
    {'y': 580, 'x0': 660, 'sink': 0.62},
    {'y': 830, 'x0': 620, 'sink': 0.34},
]

def stack(d, cx, y, s, n=3):
    """Folded apparel."""
    h = 0
    for i in range(n):
        w_, h_ = rng.uniform(52, 74) * s, rng.uniform(24, 32) * s
        jx = rng.uniform(-6, 6)
        d.rounded_rectangle([cx - w_ + jx, y - h - h_, cx + w_ + jx, y - h],
                            radius=int(11 * s), fill=255)
        h += h_

def shoebox(d, cx, y, s, ang):
    box = Image.new('L', (240, 130), 0)
    ImageDraw.Draw(box).rounded_rectangle([10, 20, 230, 120], radius=8, fill=255)
    ImageDraw.Draw(box).rounded_rectangle([4, 4, 236, 34], radius=6, fill=255)   # lid
    box = box.rotate(ang, expand=True, resample=Image.BICUBIC)
    box = box.resize((int(box.width * s), int(box.height * s)))
    d._image.paste(box, (int(cx - box.width / 2), int(y - box.height)), box)

def trainer(d, cx, y, s):
    """Shoe in profile, toe toward the quiet left."""
    d.rounded_rectangle([cx - 95 * s, y - 26 * s, cx + 95 * s, y], radius=int(13 * s), fill=255)  # sole
    d.polygon([(cx - 95 * s, y - 20 * s), (cx - 62 * s, y - 34 * s), (cx - 10 * s, y - 64 * s),
               (cx + 34 * s, y - 88 * s), (cx + 58 * s, y - 86 * s), (cx + 62 * s, y - 56 * s),
               (cx + 88 * s, y - 44 * s), (cx + 95 * s, y - 16 * s)], fill=255)                    # upper
def bottles(d, cx, y, s, n=2):
    for i in range(n):
        bx = cx + i * 46 * s + rng.uniform(-4, 4)
        bh = rng.uniform(95, 125) * s
        d.rounded_rectangle([bx - 17 * s, y - bh, bx + 17 * s, y], radius=int(13 * s), fill=255)
        d.rounded_rectangle([bx - 8 * s, y - bh - 14 * s, bx + 8 * s, y - bh + 4], radius=4, fill=255)

GOODS = [stack, shoebox, trainer, bottles]

for si, sh in enumerate(SHELVES):
    y, x0, sink = sh['y'], sh['x0'], sh['sink']
    # goods: a drifting row across the shelf
    x = x0 + 120 + rng.uniform(0, 60)
    gm = Image.new('L', (W, H), 0)
    gd = ImageDraw.Draw(gm)
    gd._image = gm
    order = list(rng.permutation(len(GOODS)))
    gi = 0
    while x < W + 60:
        kind = GOODS[order[gi % len(GOODS)]]
        gi += 1
        s = rng.uniform(0.85, 1.25) * (1.06 - si * 0.06)
        if kind is shoebox:
            kind(gd, x, y - 2, s * 0.9, rng.uniform(-7, 7))
        else:
            kind(gd, x, y - 2, s)
        x += rng.uniform(150, 250)
    m_goods = np.asarray(gm.filter(ImageFilter.GaussianBlur(0.6)), float) / 255.0
    rim = rim_from(m_goods, light=KEY, width=2.6, jitter=0.24)
    depth = np.clip(1 - (yy - (y - 260)) / 420, 0.25, 1)     # upper parts catch more light
    img = carve(img, m_goods, rim * sink, mid_tone=0.11 * sink, rim_heat=0.95 * sink,
                interior_grad=depth)

    # the shelf slab: silhouette with a lit lip, brighter near the lamp
    m_slab = mask_of(lambda d: d.polygon(
        [(x0, y), (W, y - 6), (W, y + 34), (x0 + 14, y + 42)], fill=255), blur=0.5)
    img *= (1 - m_slab[..., None] * 0.72)
    lip = rim_from(m_slab, light=(0.1, -1.5), width=2.2, jitter=0.18)
    lamp_fall = np.exp(-((xx - LAMP[0]) / 720.0) ** 2)
    img += BRIGHT[None, None, :] * (lip * lamp_fall * 0.75 * sink)[..., None]

# ---- dust hanging in the lamp cone -----------------------------------------
layer = Image.new('RGB', (W, H), 0)
d = ImageDraw.Draw(layer)
for _ in range(70):
    t = rng.uniform(0, 1)
    x = LAMP[0] + rng.normal(0, 90 + 260 * t)
    y = 30 + t * 560
    r = rng.uniform(0.5, 1.9)
    a = rng.uniform(0.10, 0.5) * (1 - t * 0.5)
    col = BRIGHT if rng.random() < 0.7 else DUST
    d.ellipse([x - r, y - r, x + r, y + r], fill=tuple(int(c * a) for c in col))
img += np.asarray(layer.filter(ImageFilter.GaussianBlur(1.0)), float) * 0.8

img = bloom(img, threshold=60)
finish(img, 'final-outlet.png')
print('outlet rendered')
