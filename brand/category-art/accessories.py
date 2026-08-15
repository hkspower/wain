#!/usr/bin/env python3
"""
Sporta series — canvas "ACCESSORIES".  Ember Discipline.
Still life of training kit on a low plinth: three caps (repetition with
drift), one tall shaker bottle, one folded towel.  Single warm key from
the upper right.  1600x1000, closed palette, float pipeline, grain-dithered.
"""
import numpy as np
from PIL import Image

W, H = 1600, 1000
RNG = np.random.default_rng(41207)
OUT = "/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/art/acc-v2.png"

# ---------- palette (closed) ----------
def c(hexs):
    return np.array([int(hexs[i:i+2], 16) for i in (0, 2, 4)], dtype=np.float64) / 255.0

CHAR_WARM   = c("171A1E")
COOL_BREATH = c("0D1016")
BURNT       = c("E0561C")
BRIGHT      = c("FF7B17")
DUST        = c("D9A47E")
CORE        = c("101216")

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

def rotc(cx, cy, deg):
    th = np.deg2rad(deg)
    xr = (XX - cx) * np.cos(th) + (YY - cy) * np.sin(th)
    yr = -(XX - cx) * np.sin(th) + (YY - cy) * np.cos(th)
    return xr, yr

def ellipse_m(cx, cy, rx, ry, deg=0.0, soft=1.6):
    xr, yr = rotc(cx, cy, deg)
    r = np.sqrt((xr / rx) ** 2 + (yr / ry) ** 2 + 1e-12)
    e = soft / min(rx, ry)
    return sstep(1.0 + e, 1.0 - e, r)

def rbox_m(cx, cy, hw, hh, r, deg=0.0, soft=1.6):
    xr, yr = rotc(cx, cy, deg)
    qx = np.abs(xr) - (hw - r)
    qy = np.abs(yr) - (hh - r)
    d = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) - r
    return sstep(soft, -soft, d)

# light direction (upper right key) — matches the series
LX, LY = 0.55, -0.835

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
# 2. KEY BEAM + WARM AIR (upper right)
# =========================================================
air = np.exp(-(((XX - 1430) / 520) ** 2 + ((YY - 280) / 400) ** 2))
air = gauss(air, 55)
add_rgb(bg, air * 0.060, BURNT)
add_rgb(bg, air * 0.026, DUST)

# beam axis from off-frame upper right down toward the still life
p0 = np.array([1640.0, 30.0])
dv = np.array([1035.0, 735.0]) - p0
dv /= np.linalg.norm(dv)
tb = (XX - p0[0]) * dv[0] + (YY - p0[1]) * dv[1]
db = (XX - p0[0]) * (-dv[1]) + (YY - p0[1]) * dv[0]
beam = np.exp(-0.5 * (db / 95.0) ** 2) * sstep(-90, 150, tb) * sstep(1010, 560, tb)
beam *= (0.72 + 0.28 * (cloud - cloud.min()) / (cloud.max() - cloud.min() + 1e-9))
beam *= sstep(780, 900, XX)               # never touches the quiet page
add_rgb(bg, beam * 0.050, DUST)
add_rgb(bg, beam * 0.045, BURNT)

# =========================================================
# 3. PLINTH — low platform, warm wash, single grazed edge
# =========================================================
EDGE_Y = 756.0
top_band = sstep(682.0, 706.0, YY) * sstep(EDGE_Y + 10.0, EDGE_Y - 4.0, YY)
wash = np.exp(-(((XX - 1400) / 520) ** 2)) * top_band
wash = gauss(wash, 9)
add_rgb(bg, wash * 0.105, BURNT)
add_rgb(bg, wash * 0.030, DUST)

# front face — barely lit, falls to nothing at frame bottom
face = sstep(EDGE_Y - 2, EDGE_Y + 10, YY) * np.exp(-np.maximum(YY - EDGE_Y, 0) / 130.0)
face *= np.exp(-(((XX - 1400) / 480) ** 2))
add_rgb(bg, face * 0.040, BURNT)

# grazed edge line — hand-set intensity drift, never laser-straight
line_noise = gauss(RNG.normal(0, 1, (H, W)), 30)
line_noise = 1.0 + 0.55 * line_noise / (np.abs(line_noise).max() + 1e-9) * 2.2
prof = np.exp(-0.5 * ((YY - EDGE_Y) / 1.5) ** 2) + 0.35 * np.exp(-0.5 * ((YY - EDGE_Y) / 4.5) ** 2)
ampx = sstep(740, 1060, XX) * (0.42 + 0.58 * sstep(1000, 1430, XX)) * np.clip(line_noise, 0.5, 1.5)
edge_line = prof * ampx
add_rgb(bg, edge_line * 0.42, BURNT)
add_rgb(bg, np.clip(edge_line - 0.55, 0, None) * 0.55, BRIGHT)
add_rgb(bg, edge_line * 0.06, DUST)

img = bg.copy()

# =========================================================
# 4. OBJECT MASKS
# =========================================================
# ---- caps: repetition with drift (position / height / tilt / interval)
def cap_mask(cx, by, rx, ry, bl, tilt):
    xr, yr = rotc(cx, by, tilt)
    r = np.sqrt((xr / rx) ** 2 + (yr / ry) ** 2 + 1e-12)
    e = 1.6 / min(rx, ry)
    crown = sstep(1.0 + e, 1.0 - e, r) * sstep(4.0, -4.0, yr)
    bx = -rx * 0.30 - bl * 0.5
    rb = np.sqrt(((xr - bx) / (bl * 0.62)) ** 2 + ((yr + 9.0) / 8.0) ** 2 + 1e-12)
    brim = sstep(1.20, 0.84, rb)
    return np.clip(np.maximum(crown, brim), 0, 1)

cap_par = [
    (900,  716, 73, 62, 112,  4.0, 0.62),   # cx, base_y, rx, ry, brim_len, tilt, gain
    (1062, 709, 80, 71, 122, -3.0, 0.80),
    (1218, 714, 76, 66, 116,  1.5, 0.95),
]
caps = [cap_mask(*p[:6]) for p in cap_par]

# ---- shaker bottle (tall)
BOT_CX, BOT_BASE = 1372, 716
body = rbox_m(BOT_CX, (500 + BOT_BASE) / 2, 54, (BOT_BASE - 500) / 2 + 4, 22)
lid  = rbox_m(BOT_CX, 472, 42, 30, 13)
lip  = rbox_m(BOT_CX, 436, 26, 10, 8)
bottle = np.clip(body + lid + lip, 0, 1)

# ---- folded towel (soft mass, front-left anchor)
t1 = ellipse_m(882, 754, 128, 25, -1.5)
t2 = ellipse_m(902, 737, 112, 19,  2.5)
t3 = ellipse_m(868, 723, 92,  15, -3.0)
towel = gauss(np.clip(np.maximum(np.maximum(t1, t2), t3), 0, 1), 3.0)
towel = sstep(0.22, 0.78, towel)

# =========================================================
# 5. GROUND SHADOWS (before objects) — long, soft, leftward
# =========================================================
def ground_shadow(bx, by, length, ry, amp):
    s = np.exp(-0.5 * ((YY - by) / ry) ** 2) * np.exp(-0.5 * ((XX - bx) / length) ** 2)
    s *= sstep(bx + 34.0, bx - 42.0, XX)
    return gauss(s, 6) * amp

SH = np.zeros((H, W))
for (cx, by, rx, ry, bl, tilt, g) in cap_par:
    SH = np.maximum(SH, ground_shadow(cx - rx * 0.2, by + 9, 210, 13, 0.50))
SH = np.maximum(SH, ground_shadow(BOT_CX - 12, BOT_BASE + 10, 330, 15, 0.62))
SH = np.maximum(SH, ground_shadow(884, 758, 200, 17, 0.42))
# contact darks right under each base
for (cx, by, rx, ry, bl, tilt, g) in cap_par:
    SH = np.maximum(SH, gauss(ellipse_m(cx, by + 4, rx * 1.05, 7), 3) * 0.55)
SH = np.maximum(SH, gauss(ellipse_m(BOT_CX, BOT_BASE + 4, 60, 8), 3) * 0.60)
SH = np.maximum(SH, gauss(ellipse_m(882, 760, 130, 10), 4) * 0.45)
SH *= sstep(690.0, 712.0, YY)          # shadows live on the plinth top only
SH *= sstep(700.0, 770.0, XX)          # and die before the quiet page
img *= (1.0 - np.clip(SH, 0, 1)[:, :, None] * 0.85)

# =========================================================
# 6. CARVE + COMPOSITE  (back to front)
# =========================================================
rim_noise = gauss(RNG.normal(0, 1, (H, W)), 18)
rim_noise = 1.0 + 0.55 * rim_noise / (np.abs(rim_noise).max() + 1e-9) * 3.0
rim_noise = np.clip(rim_noise, 0.45, 1.6)

w_pos = np.clip(0.30 + 0.78 * sstep(760, 1470, XX) + 0.40 * (1.0 - yn), 0, 1.5)

rim_total = np.zeros((H, W))
M_all = np.zeros((H, W))
heat_total = np.zeros((H, W))

def carve(M, gain, bs=1.0, p=1.3, extra=None, mid_gain=0.6):
    Ms = gauss(M, 2.2)
    gy, gx = np.gradient(Ms)
    ndl = np.clip(-(gx * LX + gy * LY), 0, None)
    sel = ndl[M > 0.3]
    ndl = ndl / (sel.max() + 1e-9) if sel.size else ndl
    rim_hot = np.clip(ndl, 0, 1.15) ** p * M * w_pos * rim_noise * gain
    rim_warm = gauss(rim_hot, 5.0 * bs) * M
    inner = gauss(rim_hot, 13.0 * bs) * M
    mid = gauss(rim_hot, 26.0 * bs) * M
    heat = 2.1 * rim_hot + 1.30 * rim_warm + 1.00 * inner + mid_gain * mid
    if extra is not None:
        heat += extra * M
    heat = np.clip(heat, 0, 1)
    s1 = sstep(0.035, 0.60, heat)
    s2 = sstep(0.62, 0.97, heat)
    rgb = (CORE[None, None, :]
           + (BURNT - CORE)[None, None, :] * s1[:, :, None]
           + (BRIGHT - BURNT)[None, None, :] * s2[:, :, None])
    return rgb, heat, rim_hot

def comp(img, M, rgb):
    return img * (1.0 - M[:, :, None]) + rgb * M[:, :, None]

# caps 1 & 2 (back row, left/mid)
for i in (0, 1):
    M = caps[i]
    g = cap_par[i][6]
    rgb, heat, rh = carve(M, g)
    img = comp(img, M, rgb)
    rim_total = rim_total * (1 - M) + rh
    heat_total = np.maximum(heat_total, heat * M)
    M_all = np.maximum(M_all, M)

# bottle (behind cap3's right rim)
lip_hot = np.exp(-(((XX - (BOT_CX + 14)) / 22) ** 2 + ((YY - 430) / 8) ** 2)) * 0.85
side_streak = np.exp(-0.5 * ((XX - (BOT_CX + 40)) / 5.5) ** 2) * sstep(700, 660, YY) * sstep(505, 545, YY) * 0.30
rgb, heat, rh = carve(bottle, 1.05, bs=1.15, extra=lip_hot + side_streak, mid_gain=0.5)
img = comp(img, bottle, rgb)
rim_total = rim_total * (1 - bottle) + rh
heat_total = np.maximum(heat_total, heat * bottle)
M_all = np.maximum(M_all, bottle)

# cap 3 (front of bottle overlap)
M = caps[2]
rgb, heat, rh = carve(M, cap_par[2][6])
img = comp(img, M, rgb)
rim_total = rim_total * (1 - M) + rh
heat_total = np.maximum(heat_total, heat * M)
M_all = np.maximum(M_all, M)

# towel (front, soft — dimmer rims, fold highlights)
fold1 = np.exp(-(((XX - 940) / 55) ** 2 + ((YY - 726) / 4.5) ** 2)) * 0.34
fold2 = np.exp(-(((XX - 965) / 42) ** 2 + ((YY - 743) / 4.0) ** 2)) * 0.24
rgb, heat, rh = carve(towel, 0.48, bs=1.3, p=1.15, extra=gauss(fold1 + fold2, 2.0), mid_gain=0.75)
img = comp(img, towel, rgb)
rim_total = rim_total * (1 - towel) + rh
heat_total = np.maximum(heat_total, heat * towel)
M_all = np.maximum(M_all, towel)

# =========================================================
# 7. SPILL — light in the air just off the hot rims
# =========================================================
spill = gauss(rim_total, 13.0) * (1.0 - M_all)
add_rgb(img, spill * 0.42, BURNT)
add_rgb(img, spill * 0.15, DUST)

# =========================================================
# 8. DUST MOTES — sparse, in the beam and warm air
# =========================================================
ember = np.zeros((H, W))
n_try = 1600
exs = RNG.uniform(780, 1620, n_try)
eys = RNG.uniform(40, 760, n_try)
kept = []
for ex, ey in zip(exs, eys):
    iy, ix = int(min(ey, H - 1)), int(min(ex, W - 1))
    p = 0.03 + 1.5 * beam[iy, ix] + 0.5 * air[iy, ix] + 0.8 * spill[iy, ix]
    if M_all[iy, ix] > 0.4:
        continue
    if RNG.uniform() < p * 0.16:
        kept.append((ex, ey))
kept = kept[:70]
for (ex, ey) in kept:
    r = RNG.uniform(0.7, 2.4)
    amp = RNG.uniform(0.14, 0.9) * (0.4 + 0.6 * RNG.uniform())
    streak = RNG.uniform(0.8, 3.6)
    ang = RNG.uniform(-0.35, 0.1)
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
for _ in range(6):
    ex = RNG.uniform(1150, 1580); ey = RNG.uniform(90, 520)
    r = RNG.uniform(3.0, 6.0); amp = RNG.uniform(0.04, 0.10)
    s = int(r * 3 + 3)
    x0, x1 = max(0, int(ex) - s), min(W, int(ex) + s)
    y0, y1 = max(0, int(ey) - s), min(H, int(ey) + s)
    ly, lx = np.mgrid[y0:y1, x0:x1].astype(np.float64)
    blob = np.exp(-(((lx - ex) ** 2 + (ly - ey) ** 2) / (2 * r ** 2)))
    ember[y0:y1, x0:x1] += blob * amp
ember = np.clip(ember, 0, 1.4)
emb_soft = gauss(ember, 1.0)
add_rgb(img, emb_soft * 0.55, BURNT)
add_rgb(img, np.clip(emb_soft - 0.32, 0, None) * 0.9, BRIGHT)

# =========================================================
# 9. BLOOM — gaussian of the bright pass, two radii
# =========================================================
lum = img @ np.array([0.30, 0.45, 0.25])
hot = np.clip(lum - 0.30, 0, None) * np.clip(img[:, :, 0] - img[:, :, 2], 0, None) * 3.0
bloom1 = gauss(hot, 8.0)
bloom2 = gauss(hot, 26.0)
add_rgb(img, bloom1 * 0.30 + bloom2 * 0.17, BURNT * 0.75 + BRIGHT * 0.25)

# =========================================================
# 10. GRADE — cool/warm cross, lift, vignette
# =========================================================
grade = t_h
img[:, :, 0] *= (0.985 + 0.045 * grade)
img[:, :, 2] *= (1.045 - 0.075 * grade)
img = img * 0.965 + 0.0135
r2 = ((XX - W * 0.52) / (W * 0.62)) ** 2 + ((YY - H * 0.46) / (H * 0.72)) ** 2
vig = 1.0 - 0.16 * np.clip(r2, 0, 1.6) ** 1.25
img *= vig[:, :, None]

# =========================================================
# 11. GRAIN — monochrome, denser in the warm air
# =========================================================
warmth = np.clip(0.25 * t_h + 1.3 * air + 1.6 * beam + 1.1 * spill + 0.9 * wash + heat_total * 0.6, 0, 1)
g_sigma = (1.9 + 2.1 * warmth) / 255.0
grain = RNG.normal(0, 1, (H, W)) * g_sigma
img += grain[:, :, None]

img = np.clip(img, 0.004, 0.985)
out = (img * 255.0 + RNG.uniform(0, 1, (H, W, 3))).astype(np.uint8)
Image.fromarray(out, "RGB").save(OUT)
print("wrote", OUT)
