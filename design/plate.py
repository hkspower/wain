"""
SOUNDING LINES — Plate IV
Rendered at 2x and resampled down, so every hairline lands crisp.
"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SS = 2                      # supersample factor
W, H = 2480, 3508           # A4 @ 300dpi
CW, CH = W * SS, H * SS

FONTS = "/root/.claude/skills/canvas-design/canvas-fonts/"
F_DISPLAY = FONTS + "Italiana-Regular.ttf"
F_TECH    = FONTS + "Jura-Light.ttf"
F_MONO    = FONTS + "GeistMono-Regular.ttf"

# ---- palette: ink ground biased blue-green; bone line; two accents held back ----
INK_TOP    = (23, 43, 52)
INK_BOT    = (7, 14, 19)
BONE       = (216, 205, 184)
VERDIGRIS  = (88, 180, 168)
BRASS      = (198, 154, 92)

def f(path, size):
    return ImageFont.truetype(path, int(size * SS))

def S(v):
    return int(round(v * SS))

# ---------------------------------------------------------------- ground
grad = np.linspace(0, 1, CH, dtype=np.float32)[:, None]
base = np.zeros((CH, CW, 3), dtype=np.float32)
for i in range(3):
    base[:, :, i] = INK_TOP[i] * (1 - grad) + INK_BOT[i] * grad

# a slow radial lift near the surface, so the top reads as light entering water
yy, xx = np.mgrid[0:CH, 0:CW].astype(np.float32)
cx, cy = CW * 0.5, CH * 0.20
r = np.sqrt(((xx - cx) / (CW * 0.75)) ** 2 + ((yy - cy) / (CH * 0.55)) ** 2)
lift = np.clip(1 - r, 0, 1) ** 2 * 17.0
base += lift[:, :, None] * np.array([1.0, 1.25, 1.35], dtype=np.float32)

img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")
layer = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)

# ---------------------------------------------------------------- geometry
ML, MR = 250, 250
CL, CR = ML, W - MR                 # content left / right
AX = W // 2                         # the axis: plumb line
FIELD_TOP, FIELD_BOT = 782, 2596    # the water column
ORIGIN_Y = 694                      # where the sounding begins

def line(p0, p1, fill, alpha, width=1):
    d.line([S(p0[0]), S(p0[1]), S(p1[0]), S(p1[1])],
           fill=fill + (alpha,), width=max(1, S(width)))

def ellipse(cxx, cyy, rr, outline=None, oa=255, fill=None, fa=255, width=1):
    box = [S(cxx - rr), S(cyy - rr), S(cxx + rr), S(cyy + rr)]
    d.ellipse(box,
              outline=(outline + (oa,)) if outline else None,
              fill=(fill + (fa,)) if fill else None,
              width=max(1, S(width)))

def text_ls(x, y, s, font, fill, alpha, track=0.0, anchor="lt"):
    """Letterspaced text. anchor: l/c/r + t/m/b. Returns (x0, y0, x1, y1) at 1x."""
    tr = track * SS
    widths = [d.textlength(ch, font=font) for ch in s]
    total = sum(widths) + tr * (len(s) - 1)
    asc, desc = font.getmetrics()
    px, py = S(x), S(y)
    if anchor[0] == "c":
        px -= total / 2
    elif anchor[0] == "r":
        px -= total
    if anchor[1] == "m":
        py -= asc / 2
    elif anchor[1] == "b":
        py -= asc
    cur = px
    for ch, w in zip(s, widths):
        d.text((cur, py), ch, font=font, fill=fill + (alpha,))
        cur += w + tr
    return (px / SS, py / SS, (px + total) / SS, (py + asc) / SS)

# ---------------------------------------------------------------- strata
# Spacing compresses with depth: density renders pressure without a word.
N_STRATA = 84
strata = []
for i in range(N_STRATA):
    t = i / (N_STRATA - 1)
    y = FIELD_TOP + (FIELD_BOT - FIELD_TOP) * (t ** 1.55)
    strata.append(y)

# Each stratum fades at both ends — no hard terminations.
SEG = 64
for i, y in enumerate(strata):
    t = i / (N_STRATA - 1)
    peak = int(30 + 88 * t)                       # deeper strata read stronger
    for k in range(SEG):
        u0, u1 = k / SEG, (k + 1) / SEG
        x0 = CL + (CR - CL) * u0
        x1 = CL + (CR - CL) * u1
        bell = math.sin(math.pi * ((u0 + u1) / 2)) ** 0.6
        a = int(peak * bell)
        if a > 1:
            line((x0, y), (x1, y), BONE, a, 1)

# ---------------------------------------------------------------- sight fan
# Concentric arcs + radial ticks: the instrument, cropped by its own field.
for rr in range(150, 470, 40):
    steps = 220
    a0, a1 = math.radians(34), math.radians(146)
    for k in range(steps):
        t0 = a0 + (a1 - a0) * k / steps
        t1 = a0 + (a1 - a0) * (k + 1) / steps
        mid = (t0 + t1) / 2
        bell = math.sin((mid - a0) / (a1 - a0) * math.pi) ** 0.7
        a = int(112 * bell)
        if a > 1:
            line((AX + rr * math.cos(t0), ORIGIN_Y + rr * math.sin(t0)),
                 (AX + rr * math.cos(t1), ORIGIN_Y + rr * math.sin(t1)),
                 VERDIGRIS, a, 1)

for k in range(25):
    ang = math.radians(34 + (146 - 34) * k / 24)
    r0, r1 = 150, 452
    bell = math.sin(k / 24 * math.pi) ** 0.8
    line((AX + r0 * math.cos(ang), ORIGIN_Y + r0 * math.sin(ang)),
         (AX + r1 * math.cos(ang), ORIGIN_Y + r1 * math.sin(ang)),
         VERDIGRIS, int(88 * bell), 1)

# ---------------------------------------------------------------- the plumb
line((AX, ORIGIN_Y), (AX, FIELD_BOT + 34), BRASS, 108, 1)
ellipse(AX, ORIGIN_Y, 5, fill=BRASS, fa=210)

# ---------------------------------------------------------------- descent
# Thirteen soundings. Diameters swell toward the floor, then close.
N = 13
marks = []
for i in range(N):
    t = i / (N - 1)
    y = ORIGIN_Y + 168 + (FIELD_BOT - ORIGIN_Y - 210) * (t ** 1.20)
    rr = 13 + 84 * math.sin(math.pi * (t ** 0.90)) ** 1.40
    marks.append((y, rr, t))

for i, (y, rr, t) in enumerate(marks):
    ellipse(AX, y, rr, outline=BONE, oa=int(132 + 92 * math.sin(math.pi * t)), width=1)
    ellipse(AX, y, rr * 0.5, outline=BONE, oa=int(46 + 44 * t), width=1)
    if i in (4, 8):                                   # two held in brass: the argument
        ellipse(AX, y, rr * 0.5, fill=BRASS, fa=196)
        ellipse(AX, y, rr + 13, outline=BRASS, oa=64, width=1)
    else:
        ellipse(AX, y, 2.6, fill=BONE, fa=int(80 + 90 * t))

# tie-lines from axis out to the right, only where a mark is annotated
fmono = f(F_MONO, 15)
for i in (4, 8, 12):
    y, rr, t = marks[i]
    x0 = AX + rr + 24
    x1 = CR - 132
    line((x0, y), (x1, y), BONE, 74, 1)
    text_ls(CR, y, ["IV", "VIII", "XIII"][(4, 8, 12).index(i)],
            fmono, BONE, 178, track=1.6, anchor="rm")

# ---------------------------------------------------------------- depth scale
ftech = f(F_TECH, 19)
for i, y in enumerate(strata):
    if i % 8 == 0:
        line((CL, y), (CL + 30, y), BONE, 148, 1)
        text_ls(CL + 44, y, f"{i:02d}", ftech, BONE, 168, track=1.2, anchor="lm")
    elif i % 2 == 0:
        line((CL, y), (CL + 14, y), BONE, 82, 1)
line((CL, FIELD_TOP - 26), (CL, FIELD_BOT + 26), BONE, 96, 1)
text_ls(CL + 40, FIELD_BOT + 62, "FATHOMS", f(F_TECH, 16), BONE, 140, track=4.2, anchor="lm")

# ---------------------------------------------------------------- header
rule_y = 318
line((CL, rule_y), (CR, rule_y), BONE, 118, 1)
ftiny = f(F_TECH, 17)
text_ls(CL, rule_y - 26, "AN INDEX OF DESCENT AND RETURN", ftiny, BONE, 165, track=5.0, anchor="lb")
text_ls(CR, rule_y - 26, "PL. IV", f(F_MONO, 16), BRASS, 168, track=3.0, anchor="rb")

text_ls(AX, 452, "SOUNDING LINES", f(F_DISPLAY, 132), BONE, 236, track=17.0, anchor="ct")

# a single centred tick under the title — the smallest possible ornament
line((AX - 44, 636), (AX + 44, 636), BRASS, 150, 1)

# ---------------------------------------------------------------- index
div_y = 2712
line((CL, div_y), (CR, div_y), BONE, 96, 1)
text_ls(CL, div_y + 34, "SIEVE ORDER", f(F_TECH, 17), BONE, 170, track=5.0, anchor="lt")
text_ls(CR, div_y + 34, "I — VII", f(F_MONO, 16), BONE, 150, track=2.4, anchor="rt")

ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"]
YIELD = [3, 6, 11, 17, 12, 7, 2]
grid_y = 2834
span = CR - CL
step = span / 7
fnum = f(F_MONO, 17)
for i in range(7):
    gx = CL + step * (i + 0.5)
    rr = 13 + i * 6.8
    ellipse(gx, grid_y, rr, outline=BONE, oa=196, width=1)
    ellipse(gx, grid_y, rr * 0.42, outline=BONE, oa=88, width=1)
    if i == 3:
        ellipse(gx, grid_y, rr * 0.42, fill=BRASS, fa=190)
    else:
        ellipse(gx, grid_y, 2.4, fill=BONE, fa=120)
    text_ls(gx, grid_y + 74, ROMAN[i], fnum, BONE, 150, track=2.0, anchor="ct")
    # dot tally — the count, accumulated by hand
    for k in range(YIELD[i]):
        col, row = k // 9, k % 9          # two columns, nine max — bounded height
        tx = gx + (col * 2 - 0.5) * 15
        ty = grid_y + 112 + row * 8.5
        line((tx - 10, ty), (tx + 10, ty), VERDIGRIS, 200, 1)

# ---------------------------------------------------------------- anchor phrase
text_ls(AX, 3092, "WHAT THE DEPTH RETURNS", f(F_TECH, 25), VERDIGRIS, 238, track=10.5, anchor="ct")

# ---------------------------------------------------------------- footer
foot_y = 3196
line((CL, foot_y), (CR, foot_y), BONE, 74, 1)
ffoot = f(F_MONO, 16)
text_ls(CL, foot_y + 26, "29°22′N — 47°58′E", ffoot, BONE, 150, track=1.8, anchor="lt")
text_ls(AX, foot_y + 26, "SEASON — 120 DAYS", ffoot, BONE, 128, track=1.8, anchor="ct")
text_ls(CR, foot_y + 26, "FIG. I–XIII", ffoot, BONE, 150, track=1.8, anchor="rt")

# ---------------------------------------------------------------- composite
img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

# grain + a whisper of vignette, so the surface reads as material
arr = np.asarray(img).astype(np.float32)
rng = np.random.default_rng(7)
arr += rng.normal(0, 2.3, arr.shape[:2])[:, :, None]
vx = np.linspace(-1, 1, CW, dtype=np.float32)[None, :]
vy = np.linspace(-1, 1, CH, dtype=np.float32)[:, None]
arr *= (1 - 0.10 * np.clip(vx ** 2 + vy ** 2 - 0.28, 0, 3))[:, :, None]
img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

img = img.resize((W, H), Image.LANCZOS)
img.save("/home/user/wain/design/sounding-lines-plate-iv.png", "PNG", optimize=True)
print("saved", img.size)
