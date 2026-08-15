#!/usr/bin/env python3
"""Ember Discipline — canvas 'WOMEN'. Female runner at full stride, carved from
one disciplined heat source, running toward the quiet dark left."""
import numpy as np
from PIL import Image

W, H = 1600, 1000
RNG = np.random.default_rng(7141)

# ---- closed palette (float sRGB) ------------------------------------------
C_DEEP = np.array([14, 16, 19]) / 255.0      # #0E1013 cool charcoal
C_WARM = np.array([23, 26, 30]) / 255.0      # #171A1E charcoal
LABOUR = np.array([224, 86, 28]) / 255.0     # #E0561C burnt orange
HOT    = np.array([255, 123, 23]) / 255.0    # #FF7B17 hottest edge
DUST   = np.array([217, 164, 126]) / 255.0   # #D9A47E warm dust (air only)

# ---- helpers ---------------------------------------------------------------
def gblur(a, sy, sx=None):
    """Anisotropic gaussian blur, float, reflect-padded FFT (no banding)."""
    if sx is None:
        sx = sy
    if sy <= 0.01 and sx <= 0.01:
        return a.copy()
    py = int(min(max(3 * sy, 8), 420))
    px = int(min(max(3 * sx, 8), 420))
    ap = np.pad(a, ((py, py), (px, px)), mode="reflect")
    h, w = ap.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    tf = np.exp(-2.0 * np.pi ** 2 * (sy * sy * fy * fy + sx * sx * fx * fx))
    out = np.fft.irfft2(np.fft.rfft2(ap) * tf, s=(h, w))
    return out[py:py + a.shape[0], px:px + a.shape[1]]

def shift2(a, dy, dx):
    """Shift with zero fill (positive dy -> down, dx -> right)."""
    out = np.zeros_like(a)
    ys0, ys1 = max(dy, 0), min(H + dy, H)
    xs0, xs1 = max(dx, 0), min(W + dx, W)
    out[ys0:ys1, xs0:xs1] = a[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out

def add_col(dst, mask2d, color):
    for c in range(3):
        dst[:, :, c] += mask2d * color[c]

# ---- figure mask -----------------------------------------------------------
src = Image.open("/home/user/wain/sporta-web/public/cats/women.webp").convert("RGBA")
alpha = src.split()[3]
alpha = alpha.transpose(Image.FLIP_LEFT_RIGHT)          # she runs LEFT now
alpha = alpha.rotate(6.0, resample=Image.BICUBIC, expand=True)  # lean into stride

am = np.asarray(alpha, dtype=np.float64) / 255.0
ys, xs = np.nonzero(am > 0.02)
am = am[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
bh, bw = am.shape

target_h = 1035                                          # bleeds off the bottom
scale = target_h / bh
tw = int(round(bw * scale))
mask_im = Image.fromarray((am * 255).astype(np.uint8)).resize(
    (tw, target_h), Image.LANCZOS)
am = np.asarray(mask_im, dtype=np.float64) / 255.0

Mraw = np.zeros((H, W))
x0, y0 = 806, 42                                         # right 55%, head near top
h_take = min(target_h, H - y0)
w_take = min(tw, W - x0)
Mraw[y0:y0 + h_take, x0:x0 + w_take] = am[:h_take, :w_take]

# smooth the ragged source edge, then re-crisp with a smoothstep
s = np.clip((gblur(Mraw, 1.6) - 0.30) / 0.40, 0, 1)
M = s * s * (3 - 2 * s)
Mb = gblur(M, 2.0)          # softened for rim math
Msolid = np.clip(M, 0, 1)
fx0, fw = x0, w_take

# ---- background: one continuous cool->warm breath --------------------------
xx = np.linspace(0, 1, W)[None, :] * np.ones((H, 1))
yy = np.linspace(0, 1, H)[:, None] * np.ones((1, W))

t = np.clip((xx - 0.08) / 0.9, 0, 1) ** 1.25             # unhurried gradient
img = np.zeros((H, W, 3))
for c in range(3):
    img[:, :, c] = C_DEEP[c] * (1 - t) + C_WARM[c] * t
# faint cool breath deepens upper-left, floor slightly darker
img *= (1.0 - 0.07 * ((1 - xx) * (0.4 + 0.6 * (1 - yy))))[..., None]

# breathing dark: very low-frequency luminance drift, strongest kept subtle
breath = gblur(RNG.normal(0, 1, (H, W)), 130)
breath = breath / (np.abs(breath).max() + 1e-9)
img += (breath * 0.0085)[..., None]

# warm atmosphere behind her chest and the low track region (air, not surface)
def glow(cx, cy, sx, sy, col, amp):
    g = np.exp(-(((xx * W - cx) / sx) ** 2 + ((yy * H - cy) / sy) ** 2))
    add_col(img, g * amp, col)

glow(1180, 470, 560, 430, LABOUR, 0.085)
glow(1210, 430, 300, 260, LABOUR * 0.55 + DUST * 0.45, 0.055)
glow(1180, 930, 620, 150, LABOUR, 0.045)
glow(940, 520, 900, 520, LABOUR, 0.016)                  # haze reaching left

# ---- motion echoes (repetition with drift, behind her) ---------------------
echo = np.zeros((H, W))
for dx, op, smear in [(46, 0.14, 16), (108, 0.06, 30), (190, 0.028, 46)]:
    e = shift2(Mb, int(RNG.integers(-6, 7)), dx)
    e = gblur(e, 3.0, smear)
    echo += e * op
echo *= (1 - Msolid)                                     # occluded by her mass
add_col(img, echo, LABOUR * 0.85)

# ---- ember streaks trailing off her trailing (right) edge ------------------
rimR = np.clip(Mb - shift2(Mb, 0, -5), 0, 1)             # right-facing edges
eys, exs = np.nonzero(rimR > 0.45)
sel = (exs > x0 + 60) & (eys > 150) & (eys < 930)
eys, exs = eys[sel], exs[sel]

streaks = np.zeros((H, W))
n_streaks = 110
order = RNG.permutation(len(eys))[:n_streaks * 4]
picked = 0
last_y = []
for idx in order:
    if picked >= n_streaks:
        break
    sy_, sx_ = float(eys[idx]), float(exs[idx])
    if any(abs(sy_ - ly) < 10 and abs(sx_ - lx) < 110 for ly, lx in last_y):
        continue                                          # drift, not stacking
    last_y.append((sy_, sx_))
    picked += 1
    L = float(RNG.uniform(36, 290))
    gap = float(RNG.uniform(1, 20))
    I0 = float(RNG.uniform(0.08, 0.58)) * (1.0 if L < 150 else 0.62)
    slope = float(RNG.uniform(-0.05, 0.05))
    amp = float(RNG.uniform(0.2, 2.8))
    freq = float(RNG.uniform(0.4, 1.3))
    ph = float(RNG.uniform(0, 2 * np.pi))
    sv = float(RNG.uniform(0.9, 2.6))
    n = int(L)
    tt = np.arange(n, dtype=np.float64)
    xpix = (sx_ + gap + tt).astype(int)
    ok = xpix < W
    if not ok.any():
        continue
    tt, xpix = tt[ok], xpix[ok]
    yc = sy_ + slope * tt + amp * np.sin(2 * np.pi * (freq * tt / L + ph))
    inten = I0 * np.exp(-3.4 * tt / L) * np.clip(tt / 5.0, 0, 1)
    yi = np.floor(yc).astype(int)
    fr = yc - yi
    for k in range(-4, 5):
        wgt = np.exp(-((k - fr) ** 2) / (2 * sv * sv)) / (sv * 2.5066)
        yk = np.clip(yi + k, 0, H - 1)
        np.add.at(streaks, (yk, xpix), inten * wgt)
streaks = gblur(streaks, 0.7, 2.2)
streaks *= (1 - Msolid * 0.92)
add_col(img, streaks * 0.88, LABOUR)
add_col(img, np.clip(streaks - 0.30, 0, None) * 0.75, HOT - LABOUR)

# hero embers: a handful of bright sparks shed from ponytail, elbow, hip, calf
hero = np.zeros((H, W))
hero_bands = [(60, 230, 5), (250, 420, 4), (540, 680, 4), (760, 930, 3)]
for ylo_b, yhi_b, count in hero_bands:
    band = np.nonzero((eys >= ylo_b) & (eys <= yhi_b))[0]
    if len(band) == 0:
        continue
    chosen = RNG.choice(band, size=min(count * 3, len(band)), replace=False)
    used = 0
    prev = []
    for idx in chosen:
        if used >= count:
            break
        sy_, sx_ = float(eys[idx]), float(exs[idx])
        if any(abs(sy_ - p) < 22 for p in prev):
            continue
        prev.append(sy_)
        used += 1
        L = float(RNG.uniform(30, 140))
        I0 = float(RNG.uniform(0.5, 0.9))
        slope = float(RNG.uniform(-0.06, 0.06))
        amp = float(RNG.uniform(0.4, 2.2))
        ph = float(RNG.uniform(0, 2 * np.pi))
        sv = float(RNG.uniform(0.6, 1.1))
        n = int(L)
        tt = np.arange(n, dtype=np.float64)
        xpix = (sx_ + 2 + tt).astype(int)
        ok = xpix < W
        tt, xpix = tt[ok], xpix[ok]
        if len(tt) == 0:
            continue
        yc = sy_ + slope * tt + amp * np.sin(2 * np.pi * (tt / L + ph))
        inten = I0 * np.exp(-3.8 * tt / L) * np.clip(tt / 3.0, 0, 1)
        yi = np.floor(yc).astype(int)
        fr = yc - yi
        for k in range(-3, 4):
            wgt = np.exp(-((k - fr) ** 2) / (2 * sv * sv)) / (sv * 2.5066)
            yk = np.clip(yi + k, 0, H - 1)
            np.add.at(hero, (yk, xpix), inten * wgt)
        # hot head where the spark leaves her edge
        r = float(RNG.uniform(1.1, 1.9))
        rad = int(np.ceil(3 * r))
        hy, hx = int(sy_), int(sx_ + 3)
        if rad < hy < H - rad - 1 and rad < hx < W - rad - 1:
            gy = np.arange(hy - rad, hy + rad + 1)[:, None] - sy_
            gx = np.arange(hx - rad, hx + rad + 1)[None, :] - (sx_ + 3)
            hero[hy - rad:hy + rad + 1, hx - rad:hx + rad + 1] += \
                I0 * 0.9 * np.exp(-(gy * gy + gx * gx) / (2 * r * r))
hero = gblur(hero, 0.5, 1.0)
hero *= (1 - Msolid * 0.9)
add_col(img, hero * 0.55, LABOUR)
add_col(img, hero * 0.5, HOT)

# ---- drifting ember particles (denser in warm air, dissolve to centre) -----
part = np.zeros((H, W))
part_hot = np.zeros((H, W))
n_part = 170
px_ = RNG.uniform(660, 1600, n_part * 4)
py_ = RNG.uniform(70, 970, n_part * 4)
# acceptance: warm-air density — her wake band, thinning toward the centre,
# thinned again in the extreme top-right so corners stay disciplined
acc = np.clip((px_ - 660) / 940, 0, 1) ** 1.6 \
    * (0.30 + 0.70 * np.exp(-((py_ - 460) / 300) ** 2)) \
    * (1 - 0.75 * np.clip((px_ - 1380) / 220, 0, 1) * np.clip((260 - py_) / 260, 0, 1))
keep = RNG.uniform(0, 1, n_part * 4) < acc
px_, py_ = px_[keep][:n_part], py_[keep][:n_part]
for pxi, pyi in zip(px_, py_):
    r = float(RNG.uniform(0.6, 2.6))
    if RNG.uniform() < 0.08:
        r = float(RNG.uniform(2.6, 4.2))                  # a few larger, softer
    I0 = float(RNG.uniform(0.06, 0.7)) * (1.2 - r / 5.0)
    hot_p = RNG.uniform() < 0.30
    rad = int(np.ceil(3 * r))
    ylo, yhi = int(pyi) - rad, int(pyi) + rad + 1
    xlo, xhi = int(pxi) - rad, int(pxi) + rad + 1
    if ylo < 0 or xlo < 0 or yhi >= H or xhi >= W:
        continue
    gy = np.arange(ylo, yhi)[:, None] - pyi
    gx = np.arange(xlo, xhi)[None, :] - pxi
    blob = I0 * np.exp(-(gy * gy + gx * gx) / (2 * r * r))
    if hot_p:
        part_hot[ylo:yhi, xlo:xhi] += blob
    else:
        part[ylo:yhi, xlo:xhi] += blob
part *= (1 - Msolid * 0.85)
part_hot *= (1 - Msolid * 0.85)
add_col(img, part, LABOUR * 0.9)
add_col(img, part_hot, HOT * 0.9)

# ---- faint warm track-line under her feet ----------------------------------
track_core = np.exp(-((yy * H - 936) / 7.0) ** 2) * \
    np.clip((xx * W - 800) / 260, 0, 1) * np.clip((1590 - xx * W) / 160, 0, 1)
track_soft = np.exp(-((yy * H - 940) / 28.0) ** 2) * \
    np.clip((xx * W - 780) / 340, 0, 1) * np.clip((1590 - xx * W) / 180, 0, 1)
corner_taper = 1 - 0.75 * np.clip((xx * W - 1360) / 180, 0, 1)
track = (gblur(track_core, 1.5, 8) * 0.42 + track_soft * 0.15) * corner_taper
track *= (1 - Msolid * 0.9)
add_col(img, track, LABOUR)
add_col(img, gblur(track_core, 1.0, 4) * 0.11 * corner_taper * (1 - Msolid), HOT)

# ---- the figure: carved two-to-three-tone mass -----------------------------
# core falls into dark (darker than the warm air behind her)
core = np.zeros((H, W, 3))
core_shade = 0.75 + 0.25 * np.clip(1 - (xx - 0.5) * 2.2, 0, 1)   # trailing darker
for c in range(3):
    core[:, :, c] = (C_DEEP[c] * 0.82) * core_shade
img = img * (1 - Msolid[..., None]) + core * Msolid[..., None]

# light penetration from her leading (left) edges — three carved scales
carve_noise = gblur(RNG.normal(0, 1, (H, W)), 34)
carve_noise = 1.0 + 0.20 * carve_noise / (np.abs(carve_noise).max() + 1e-9)

def lead_rim(d, dy):
    return np.clip(Mb - shift2(Mb, dy, d), 0, 1)

# heat is not uniform: chest, front arm, front thigh burn; back and tail cool
X, Y = xx * W, yy * H
heat = np.clip(1.30 - 1.45 * (X - fx0) / fw, 0.18, 1.0)
heat += 0.55 * np.exp(-(((X - 985) / 120) ** 2 + ((Y - 360) / 150) ** 2))   # chest
heat += 0.65 * np.exp(-(((X - 855) / 75) ** 2 + ((Y - 320) / 170) ** 2))    # front arm
heat += 0.45 * np.exp(-(((X - 960) / 130) ** 2 + ((Y - 760) / 150) ** 2))   # front thigh
heat -= 0.50 * np.exp(-(((X - 1160) / 150) ** 2 + ((Y - 230) / 150) ** 2))  # rear shoulder cools
heat = np.clip(heat, 0.12, 1.45)
# the head interior falls dark — only the profile rim stays lit
head_damp = 1 - 0.70 * np.exp(-(((X - 1020) / 85) ** 2 + ((Y - 150) / 105) ** 2))

deep = gblur(lead_rim(34, 10), 20) * M * 0.30 * carve_noise * head_damp
mid  = gblur(lead_rim(13, 4), 6.0) * M * 0.58 * carve_noise * head_damp
tight = gblur(lead_rim(5, 2), 1.5) * M * 1.25

add_col(img, deep * np.clip(heat, 0, 1), LABOUR * 0.55)
add_col(img, mid * np.clip(heat * 1.05, 0, 1.1), LABOUR)
add_col(img, np.clip(tight * heat, 0, 1.2), HOT)

# whisper counter-rim, only where the atmosphere glow behind her justifies it
trail_w = np.exp(-((Y - 380) / 260) ** 2)
trail = gblur(np.clip(Mb - shift2(Mb, 0, -4), 0, 1), 1.8) * M * 0.085 * trail_w
add_col(img, trail, LABOUR)

# ---- bloom around hottest edges --------------------------------------------
lum = img @ np.array([0.35, 0.45, 0.20])
bright = np.clip(img - 0.46, 0, None) * (lum > 0.33)[..., None]
bloom = np.zeros_like(img)
for c in range(3):
    bloom[:, :, c] = gblur(bright[:, :, c], 10) * 0.55 + \
                     gblur(bright[:, :, c], 34) * 0.40
img += bloom
# warm dust only where light hits atmosphere: tint the wide bloom faintly
dustm = gblur(bright[:, :, 0], 46) * 0.10
add_col(img, dustm * (1 - Msolid), DUST - LABOUR * 0.5)

# ---- final polish: grade + second whisper of bloom (no new elements) --------
# gentle S: sink the amber mid-haze a touch, leave darks and hot rims alone
lum2 = img @ np.array([0.35, 0.45, 0.20])
mid_w = np.exp(-((lum2 - 0.30) / 0.16) ** 2)             # only the haze band
img *= (1.0 - 0.05 * mid_w)[..., None]
# hottest edges only: one more wide, faint breath of glow
hot2 = np.clip(img - 0.62, 0, None)
for c in range(3):
    img[:, :, c] += gblur(hot2[:, :, c], 50) * 0.20
# cool breath grade on the far-left dark end of the temperature journey
cool_w = np.clip((0.38 - xx) / 0.38, 0, 1) ** 1.4
img[:, :, 0] *= (1.0 - 0.022 * cool_w)
img[:, :, 2] *= (1.0 + 0.012 * cool_w)

# ---- vignette ---------------------------------------------------------------
r = np.sqrt(((xx - 0.5) / 0.62) ** 2 + ((yy - 0.5) / 0.62) ** 2)
vig = 1 - 0.24 * np.clip(r, 0, 1.3) ** 3
img *= vig[..., None]

# ---- highlight rolloff, palette discipline ----------------------------------
img = np.clip(img, 0, None)
hi = img > 0.78
img[hi] = 0.78 + (img[hi] - 0.78) * (0.22 / (0.22 + (img[hi] - 0.78)))  # soft knee
img = np.clip(img, 0, 0.985)                                  # no pure white

# ---- fine monochrome grain (denser in warm air), dithers all gradients -----
warmth = np.clip((img[:, :, 0] - img[:, :, 2]) * 1.7, 0, 1)
sigma = (2.0 + 2.0 * warmth) / 255.0
grain = RNG.normal(0, 1, (H, W)) * sigma
img += grain[..., None]
img = np.clip(img, 0, 0.992)

out = Image.fromarray((img * 255.0 + 0.5).astype(np.uint8), "RGB")
out.save("/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/art/final-women.png")
print("saved", out.size)
