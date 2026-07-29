#!/usr/bin/env python3
"""
Sporta series — canvas "MEN".  Ember Discipline.
Front double-biceps mass carved out of charcoal, lit from the upper right.
1600x1000, closed palette, float pipeline, grain-dithered.
"""
import numpy as np
from PIL import Image

W, H = 1600, 1000
RNG = np.random.default_rng(70428)
OUT = "/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/art/final-men.png"

# ---------- palette (closed) ----------
def c(hexs):
    return np.array([int(hexs[i:i+2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0

CHAR_WARM  = c("171A1E")
COOL_BREATH= c("0D1016")
BURNT      = c("E0561C")
BRIGHT     = c("FF7B17")
DUST       = c("D9A47E")
CORE       = c("101216")

# ---------- helpers ----------
def gauss(a, sigma):
    if sigma <= 0:
        return a.copy()
    pad = int(max(8, sigma * 3.5))
    ap = np.pad(a, pad, mode="edge")
    h, w = ap.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    ker = np.exp(-2.0 * (np.pi ** 2) * (sigma ** 2) * (fy ** 2 + fx ** 2))
    out = np.fft.irfft2(np.fft.rfft2(ap) * ker, s=(h, w))
    return out[pad:-pad, pad:-pad]

def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)

def add_rgb(img, field, col):
    img += field[:, :, None] * col[None, None, :]

YY, XX = np.mgrid[0:H, 0:W].astype(np.float64)
xn = XX / W
yn = YY / H

# =========================================================
# 1. BACKGROUND — breathing dark, cool left -> warm right
# =========================================================
bg = np.zeros((H, W, 3))
t_h = sstep(0.05, 1.0, xn) ** 1.25
for k in range(3):
    bg[:, :, k] = COOL_BREATH[k] + (CHAR_WARM[k] - COOL_BREATH[k]) * t_h
bg *= (0.92 + 0.10 * sstep(0.0, 0.75, yn))[:, :, None]

cloud = gauss(RNG.normal(0, 1, (H, W)), 90) * 5.0 + gauss(RNG.normal(0, 1, (H, W)), 35) * 1.6
cloud -= cloud.mean()
cloud_amp = (0.008 + 0.020 * t_h)
bg += (cloud * cloud_amp)[:, :, None] * np.array([1.0, 0.92, 0.80])[None, None, :]

# =========================================================
# 2. FIGURE MASK from owner's silhouette
# =========================================================
src = Image.open("/home/user/wain/sporta-web/public/cats/men.webp").convert("RGBA")
alpha = np.array(src)[:, :, 3].astype(np.float64) / 255.0
ys, xs = np.nonzero(alpha > 0.03)
bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()
crop = alpha[by0:by1 + 1, bx0:bx1 + 1]
bh, bw = crop.shape

TARGET_BH = 795
sc = TARGET_BH / bh
tw, th = int(round(bw * sc)), int(round(bh * sc))
mimg = Image.fromarray((crop * 255).astype(np.uint8)).resize((tw, th), Image.LANCZOS)
mres = np.array(mimg).astype(np.float64) / 255.0

FX0 = 730
FY1 = 1030
FY0 = FY1 - th
M = np.zeros((H, W))
dx0, dy0 = max(0, FX0), max(0, FY0)
dx1, dy1 = min(W, FX0 + tw), min(H, FY0 + th)
M[dy0:dy1, dx0:dx1] = mres[dy0 - FY0:dy1 - FY0, dx0 - FX0:dx1 - FX0]
M = np.clip(M, 0, 1)

fxn = np.clip((XX - FX0) / tw, 0, 1)
fyn = np.clip((YY - FY0) / th, 0, 1)

# =========================================================
# 3. FLOOR GLOW — a warm low bed the mass stands out of
# =========================================================
floor = np.exp(-(((XX - 1150) / 560) ** 2 + ((YY - 1060) / 230) ** 2))
floor += 0.62 * np.exp(-(((XX - 1080) / 300) ** 2 + ((YY - 1020) / 140) ** 2))
floor = gauss(floor, 35)
floor *= sstep(560, 900, XX)          # stays out of the quiet page
add_rgb(bg, floor * 0.30, BURNT)
add_rgb(bg, floor * 0.050, DUST)

# warm air high right where the key light lives
air = np.exp(-(((XX - 1380) / 560) ** 2 + ((YY - 260) / 420) ** 2))
air = gauss(air, 60)
add_rgb(bg, air * 0.070, BURNT)
add_rgb(bg, air * 0.030, DUST)

# =========================================================
# 4. DEEP BACKGROUND — barbell resting low behind him
#    (visible in the gap x~750..1120 below y=760)
# =========================================================
BAR_Y = 792.0
bar_prof = np.exp(-((YY - BAR_Y) ** 2) / (2 * 2.2 ** 2))
bar_amp = sstep(766, 838, XX) * (0.55 + 0.45 * sstep(950, 1160, XX)) * sstep(1430, 1150, XX)
bar_layer = bar_prof * bar_amp * 0.60
bar_layer += np.exp(-((YY - (BAR_Y - 1.8)) ** 2) / (2 * 1.0 ** 2)) * bar_amp * 0.45

# two plate discs on the near end of the bar — repetition with drift
# (back disc first; the front disc's dark body occludes its crescent)
def disc_field(px, py, pr):
    d = np.sqrt((XX - px) ** 2 + (YY - py) ** 2)
    body = sstep(pr, pr - 3.0, d)
    bs = gauss(body, 2.5)
    dgy, dgx = np.gradient(bs)
    cres = np.clip(-(dgx * 0.55 + dgy * -0.835), 0, None)
    cres = cres / (cres.max() + 1e-9)
    return body, cres

body2, cres2 = disc_field(958, BAR_Y + 3, 48)     # back plate, smaller, drifted
body1, cres1 = disc_field(852, BAR_Y - 2, 62)     # front plate
plate_mask = np.maximum(body1, body2)
bar_light = bar_layer * (1.0 - gauss(plate_mask, 1.5) * 0.85)  # bar passes behind rims
bar_light += cres2 * 1.15 * (1.0 - body1)          # back crescent, dimmer, occluded
bar_light += cres1 * 2.10                          # front crescent — a real lit edge
bar_light += (body1 * 0.015 + body2 * 0.010)       # barest ghost of the disc bodies
bar_light = gauss(bar_light, 1.4)                  # sit back in depth
bar_light *= (1.0 - sstep(780, 728, XX))           # dead quiet toward the page
# discs BLOCK the floor glow — dark bodies against the warm bed (neutral)
occl = gauss(plate_mask, 2.0) * 0.62
bg *= (1.0 - occl[:, :, None] * 0.72)
add_rgb(bg, bar_light * 0.42, BURNT)
add_rgb(bg, bar_light * 0.07, DUST)

# =========================================================
# 5. FIGURE RE-LIT AS CARVED MASS
# =========================================================
Ms = gauss(M, 3.5)
gy, gx = np.gradient(Ms)
LX, LY = 0.55, -0.835
ndl = np.clip(-(gx * LX + gy * LY), 0, None)
ndl = ndl / (ndl.max() + 1e-9)

# organic rim width — hand-set, never wire-uniform
rim_noise = gauss(RNG.normal(0, 1, (H, W)), 22)
rim_noise = 1.0 + 0.55 * rim_noise / (np.abs(rim_noise).max() + 1e-9) * 3.0
rim_noise = np.clip(rim_noise, 0.45, 1.6)

w_pos = np.clip(0.10 + 1.05 * (0.55 * fxn + 0.60 * (1.0 - fyn)), 0, 1.35)

rim_hot  = (ndl ** 1.35) * M * w_pos * rim_noise
rim_warm = gauss(rim_hot, 11.0) * M * rim_noise
inner    = gauss(rim_hot, 38.0) * M
mid      = gauss(rim_hot, 60.0) * M            # burnt mid falling through the chest

# interiors are allowed to disappear: damp the head's inside, keep its rim
head_damp = 1.0 - 0.72 * np.exp(-(((XX - 1284) / 88) ** 2 + ((YY - 330) / 110) ** 2))

# quiet the symmetric pec-line rims so they whisper, not swoosh
pec_damp = 1.0 - 0.45 * np.exp(-(((XX - 1265) / 240) ** 2 + ((YY - 765) / 95) ** 2))

# warm air off-frame right keeps the exiting arm connected (no floating fist)
edge_fill = sstep(0.72, 1.0, fxn) * (0.45 * (1.0 - fyn) + 0.20) * 0.44 * M

# the core sinks; the figure emerges FROM the dark
sink = 1.0 - sstep(0.50, 1.02, fyn) * 0.94
sink *= 1.0 - sstep(0.34, 0.0, fxn) * 0.50

heat = ((2.05 * rim_hot + 1.35 * rim_warm) * pec_damp
        + (1.10 * inner + 0.55 * mid) * head_damp + edge_fill) * sink
heat = np.clip(heat, 0, 1)

s1 = sstep(0.035, 0.60, heat)
s2 = sstep(0.62, 0.97, heat)
fig_rgb = (CORE[None, None, :]
           + (BURNT - CORE)[None, None, :] * s1[:, :, None]
           + (BRIGHT - BURNT)[None, None, :] * s2[:, :, None])

img = bg * (1.0 - M[:, :, None]) + fig_rgb * M[:, :, None]

# =========================================================
# 6. LIGHT IN THE AIR — spill off the rim, outside the mass
# =========================================================
spill = gauss(rim_hot, 15.0) * (1.0 - M)
add_rgb(img, spill * 0.50, BURNT)
add_rgb(img, spill * 0.18, DUST)

# =========================================================
# 7. EMBERS — sparse, rising, denser in the warm air
# =========================================================
ember = np.zeros((H, W))
n_try = 1400
exs = RNG.uniform(700, 1620, n_try)
eys = RNG.uniform(60, 990, n_try)
keep = []
for ex, ey in zip(exs, eys):
    if ex < 748:
        continue
    p = 0.05 + 0.6 * air[int(min(ey, H - 1)), int(min(ex, W - 1))] \
        + 1.1 * spill[int(min(ey, H - 1)), int(min(ex, W - 1))] \
        + 0.5 * floor[int(min(ey, H - 1)), int(min(ex, W - 1))]
    if ex > 1380 and ey > 780:
        p *= 0.30
    if RNG.uniform() < p * 0.22:
        keep.append((ex, ey))
keep = keep[:95]

for (ex, ey) in keep:
    r = RNG.uniform(0.8, 2.8)
    amp = RNG.uniform(0.16, 1.0) * (0.4 + 0.6 * RNG.uniform())
    streak = RNG.uniform(1.2, 5.0)
    ang = RNG.uniform(-0.3, 0.3)
    px, py = int(ex), int(ey)
    s = int(np.ceil(max(r, streak) * 3 + 3))
    x0, x1 = max(0, px - s), min(W, px + s)
    y0, y1 = max(0, py - s), min(H, py + s)
    if x1 <= x0 or y1 <= y0:
        continue
    ly, lx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
    dx = (lx - ex) + (ly - ey) * ang
    dy = (ly - ey)
    blob = np.exp(-(dx ** 2 / (2 * r ** 2) + dy ** 2 / (2 * (r * 0.8 + streak * 0.5) ** 2)))
    ember[y0:y1, x0:x1] += blob * amp
# a few big soft bokeh motes drifting in the hot air
for _ in range(7):
    ex = RNG.uniform(1050, 1560); ey = RNG.uniform(120, 700)
    r = RNG.uniform(3.5, 7.0); amp = RNG.uniform(0.05, 0.12)
    s = int(r * 3 + 3)
    x0, x1 = max(0, int(ex) - s), min(W, int(ex) + s)
    y0, y1 = max(0, int(ey) - s), min(H, int(ey) + s)
    ly, lx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
    blob = np.exp(-(((lx - ex) ** 2 + (ly - ey) ** 2) / (2 * r ** 2)))
    ember[y0:y1, x0:x1] += blob * amp
ember = np.clip(ember, 0, 1.4)
emb_soft = gauss(ember, 1.0)
add_rgb(img, emb_soft * 0.62, BURNT)
add_rgb(img, np.clip(emb_soft - 0.30, 0, None) * 1.0, BRIGHT)

# =========================================================
# 8. BLOOM — gaussian of the bright pass, two radii
# =========================================================
lum = img @ np.array([0.30, 0.45, 0.25])
hot = np.clip(lum - 0.30, 0, None) * np.clip(img[:, :, 0] - img[:, :, 2], 0, None) * 3.0
bloom1 = gauss(hot, 9.0)
bloom2 = gauss(hot, 30.0)
add_rgb(img, bloom1 * 0.36 + bloom2 * 0.22, BURNT * 0.75 + BRIGHT * 0.25)

# =========================================================
# 9. GRADE — cool/warm cross, lift, vignette
# =========================================================
grade = t_h
img[:, :, 0] *= (0.982 + 0.048 * grade)
img[:, :, 2] *= (1.055 - 0.085 * grade)
# gentle toe: the deepest darks settle, without crushing the breathing left
lum_t = img @ np.array([0.33, 0.34, 0.33])
toe = 1.0 - 0.10 * (1.0 - sstep(0.015, 0.16, lum_t))
img *= toe[:, :, None]
img = img * 0.965 + 0.0135
r2 = ((XX - W * 0.52) / (W * 0.62)) ** 2 + ((YY - H * 0.46) / (H * 0.72)) ** 2
vig = 1.0 - 0.16 * np.clip(r2, 0, 1.6) ** 1.25
img *= vig[:, :, None]

# =========================================================
# 10. GRAIN — monochrome, denser in warm air
# =========================================================
warmth = np.clip(0.25 * t_h + 1.4 * air + 1.2 * spill + 0.8 * floor + heat * 0.6, 0, 1)
g_sigma = (1.9 + 2.1 * warmth) / 255.0
grain = RNG.normal(0, 1, (H, W)) * g_sigma
img += grain[:, :, None]

img = np.clip(img, 0.004, 0.985)
out = (img * 255.0 + RNG.uniform(0, 1, (H, W, 3))).astype(np.uint8)
Image.fromarray(out, "RGB").save(OUT)
print("wrote", OUT)
