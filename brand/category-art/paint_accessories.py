# ACCESSORIES — still life of training kit on a low plinth, one warm key from
# the upper right. Iteration 2: the caps must read as caps (crown + visor), the
# plinth is a silhouette with one grazed edge (never a grey slab), particles
# live only in the key beam and stay warm.
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from paint_lib import (W, H, BURNT, BRIGHT, DUST, rng, base_canvas, warm_glow,
                       mask_of, rim_from, carve, bloom, finish)

img, xx, yy = base_canvas()

PLINTH_Y = 710
KEY = (1.15, -0.85)

# ---- atmosphere: a diagonal key beam from the upper right ------------------
for i, s in enumerate([0.05, 0.07, 0.09]):
    img = warm_glow(img, 1520 - i * 130, 140 + i * 190, 520, s, DUST)
img = warm_glow(img, 1240, PLINTH_Y + 30, 560, 0.13, BURNT)

# ---- plinth: pure silhouette below, one warm grazed line on the lip --------
m_plinth = mask_of(lambda d: d.rectangle([600, PLINTH_Y, W, H], fill=255), blur=0.5)
img *= (1 - m_plinth[..., None] * 0.55)          # front face darker than the room
lip = np.zeros((H, W))
lip[PLINTH_Y - 2:PLINTH_Y + 1, 640:W] = 1.0
lip *= np.clip((xx - 640) / (W - 640), 0, 1)[PLINTH_Y - 2:PLINTH_Y + 1, :].mean(0) ** 0.6
lip = np.asarray(Image.fromarray((lip * 255).astype(np.uint8))
                 .filter(ImageFilter.GaussianBlur(1.2)), float) / 255.0
img += BURNT[None, None, :] * (lip * 0.5)[..., None]

# ---- object masks ----------------------------------------------------------
def cap(d, cx, y, s, flip=False):
    """Profile of a baseball cap: domed crown + flat visor. Visor points toward
    the quiet left unless flipped."""
    d.pieslice([cx - 78 * s, y - 118 * s, cx + 78 * s, y + 30 * s], 180, 360, fill=255)
    d.rectangle([cx - 78 * s, y - 44 * s, cx + 78 * s, y], fill=255)      # crown base band
    vx0, vx1 = (cx - 122 * s, cx + 4 * s) if not flip else (cx - 4 * s, cx + 122 * s)
    d.ellipse([vx0, y - 20 * s, vx1, y + 14 * s], fill=255)               # visor
    d.ellipse([cx - 7 * s, y - 124 * s, cx + 7 * s, y - 110 * s], fill=255)  # button

def bottle(d, cx, y, s):
    d.rounded_rectangle([cx - 44 * s, y - 240 * s, cx + 44 * s, y], radius=int(34 * s), fill=255)
    d.polygon([(cx - 44 * s, y - 210 * s), (cx - 26 * s, y - 258 * s),
               (cx + 26 * s, y - 258 * s), (cx + 44 * s, y - 210 * s)], fill=255)  # shoulder
    d.rounded_rectangle([cx - 22 * s, y - 296 * s, cx + 22 * s, y - 252 * s],
                        radius=int(9 * s), fill=255)                                # lid
    d.ellipse([cx - 30 * s, y - 310 * s, cx + 30 * s, y - 292 * s], fill=255)       # loop knob

def towel(d, cx, y, s):
    for i, (w_, h_, jx) in enumerate([(140, 40, 0), (152, 42, 10), (128, 36, -6)]):
        d.rounded_rectangle([cx - w_ * s + jx, y - sum([40, 42, 36][:i + 1]) * s,
                             cx + w_ * s + jx, y - sum([40, 42, 36][:i]) * s],
                            radius=int(19 * s), fill=255)

# back-to-front so nearer masses carve over farther ones
OBJECTS = [
    ('bottle', lambda d: bottle(d, 1268, PLINTH_Y + 2, 1.05), 0.10),
    ('towel',  lambda d: towel(d, 1035, PLINTH_Y + 4, 1.05),  0.09),
    ('cap',    lambda d: cap(d, 1032, PLINTH_Y - 124, 0.78),  0.13),  # resting on the towel
    ('cap',    lambda d: cap(d, 1448, PLINTH_Y - 2, 1.06),    0.15),
    ('cap',    lambda d: cap(d, 1620, PLINTH_Y - 8, 0.9, True), 0.12),  # bleeds off right
]

interior = np.clip((xx / W - 0.30) * 1.6, 0, 1) * np.clip(1 - (yy - 260) / 760, 0.25, 1)
for _, fn, mid in OBJECTS:
    m = mask_of(fn, blur=0.6)
    rim = rim_from(m, light=KEY, width=2.8, jitter=0.22)
    img = carve(img, m, rim, mid_tone=mid, rim_heat=0.9, interior_grad=interior)
    ys, xs = np.where(m > 0.5)
    if len(xs):
        img = warm_glow(img, xs.mean(), min(ys.max() + 10, H - 1), 110, 0.04, BURNT)

# ---- sparse warm dust, only inside the beam --------------------------------
layer = Image.new('RGB', (W, H), 0)
d = ImageDraw.Draw(layer)
for _ in range(64):
    t = rng.uniform(0, 1)
    x = 1560 - t * 640 + rng.normal(0, 70)
    y = 110 + t * 520 + rng.normal(0, 60)
    r = rng.uniform(0.6, 2.0)
    a = rng.uniform(0.12, 0.55)
    col = BRIGHT if rng.random() < 0.75 else DUST
    d.ellipse([x - r, y - r, x + r, y + r], fill=tuple(int(c * a) for c in col))
img += np.asarray(layer.filter(ImageFilter.GaussianBlur(1.1)), float) * 0.8

img = bloom(img, threshold=62)
finish(img, 'final-accessories.png')
print('accessories v2 rendered')
