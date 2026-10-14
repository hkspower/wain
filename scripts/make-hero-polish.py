#!/usr/bin/env python3
"""
Hero polish, 2026-10-14 — the five neutral photo slides, graded to one white and given square
phone pictures. The owner chose both ("Match colours + switch off 2 and 3", "New square phone
pictures"), out of options rendered with their measurements.

    python3 scripts/make-hero-polish.py          writes sporta-site/assets/hero/<name>-polish-*.webp
    python3 scripts/make-hero-polish.py --check  rebuilds in memory, fails if a committed file differs

ONE WHITE. Measured on the 3200px masters, over bright low-saturation pixels (the studio):

    crossfit    bg 217/220/214  L 218   slightly warm and green
    features    bg 225/223/221  L 225   slightly warm
    runner      bg 219/222/220  L 221   slightly cool
    activewear  bg 238/237/229  L 234   warm beige, and the brightest
    training    bg 222/223/221  L 222   neutral

Each picture gets per-channel gains IN LINEAR LIGHT (so a gain is a white-balance and exposure
change, not a hue shift) that take its studio to the same neutral grey, sRGB 224. That is a
white-balance correction: skin, fabric and the orange trim move by the same gains as the wall,
which is what makes the five look like one shoot. Nothing else is touched: no curve, no
saturation, no sharpening.

SQUARE PHONE PICTURES, CUT FROM THE ART RATHER THAN GENERATED. Every 1080x1350 phone picture is
a full-height crop of its own desktop master (template match 0.997-0.999 at scale 0.94), so the
square is the same scene, wider: the master supplies the sides, the phone picture (sharper: it
came from the 1524px original, the 3200 master from a downscale of it) is laid back over the
centre with a 48px feathered edge, and nothing in the frame is invented except a strip of FLOOR
under the feet. That strip exists because the controls sit at the foot of the phone hero and the
feet stood at 89-97% of the old picture's height, under them. The floor is the floor's own last
rows, blurred along the row and carried down, with the picture's own grain; it is plain studio
floor in the four full-body slides. CrossFit is waist-up: it has no feet to clear and gets none
(a strip there smeared the shorts into a grey band), so its square is 1350, the art's own height.

The phone picture's athlete is exactly the pixels the shop showed before (graded); only the frame
around it grows.
"""
import io, sys, hashlib
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HERO = ROOT / 'sporta-site' / 'assets' / 'hero'
NAMES = ['crossfit', 'features', 'runner', 'activewear', 'training']
TARGET = 224.0           # sRGB grey the studio white is taken to
FLOOR = 120              # px of floor added under the phone picture (phone scale)
NO_FLOOR = {'crossfit'}  # waist-up: there are no feet, and a strip would smear the shorts
FEATHER = 48             # px ramp where the phone picture is laid over the master's sides
DESKTOP_W = 2560
Q_DESKTOP, Q_PHONE = 86, 86


def to_lin(a):
    a = a / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def to_srgb(l):
    l = np.clip(l, 0, 1)
    return np.where(l <= 0.0031308, l * 12.92, 1.055 * l ** (1 / 2.4) - 0.055) * 255.0


def studio(a):
    """Mean colour of the bright, near-grey pixels: the studio wall and floor."""
    mx, mn = a.max(2), a.min(2)
    L = a @ np.array([0.2126, 0.7152, 0.0722])
    sat = (mx - mn) / np.maximum(mx, 1)
    m = (sat < 0.10) & (L > np.percentile(L, 40))
    return a[m].mean(0)


def gains_for(master):
    bg = studio(master)
    return to_lin(np.full(3, TARGET)) / to_lin(bg)


def grade(a, g):
    return to_srgb(to_lin(a) * g)


def webp(arr, q):
    b = io.BytesIO()
    Image.fromarray(np.clip(np.rint(arr), 0, 255).astype(np.uint8)).save(b, 'WEBP', quality=q, method=6, use_sharp_yuv=True)
    return b.getvalue()


def locate(master_l, phone_l, s):
    """x of the phone picture inside the master, both at phone scale."""
    r = cv2.matchTemplate(master_l, phone_l, cv2.TM_CCOEFF_NORMED)
    _, mx, _, loc = cv2.minMaxLoc(r)
    if mx < 0.99:
        raise SystemExit(f'phone picture not found in its master (best {mx:.4f})')
    return loc[0], mx


def floor_strip(img, rows, rng):
    """`rows` more rows of floor under `img`: its last rows, blurred along the row, carried down
    and eased towards their own mean, with grain matched to the picture's."""
    tail = img[-24:].astype(np.float32)
    base = tail.mean(0)                                        # one row, per column
    smooth = cv2.GaussianBlur(base[None], (0, 0), sigmaX=60)[0]
    flat = smooth.mean(0)
    noise_sd = float(np.std(tail - cv2.GaussianBlur(tail, (0, 0), 2)))
    out = np.empty((rows, img.shape[1], 3), np.float32)
    for i in range(rows):
        t = (i + 1) / rows
        w = min(1.0, t * 4)                                    # leave the real row quickly
        row = (1 - w) * base + w * ((1 - 0.35 * t) * smooth + 0.35 * t * flat)
        out[i] = row
    out += rng.normal(0, noise_sd, out.shape)
    return out


def build(name):
    master = np.asarray(Image.open(HERO / f'{name}-neutral-desktop.webp').convert('RGB')).astype(np.float32)
    phone = np.asarray(Image.open(HERO / f'{name}-neutral-mobile.webp').convert('RGB')).astype(np.float32)
    g = gains_for(master)
    gm, gp = grade(master, g), grade(phone, g)

    # desktop: the graded master at 2560
    dw, dh = DESKTOP_W, round(master.shape[0] * DESKTOP_W / master.shape[1])
    desk = np.asarray(Image.fromarray(np.clip(np.rint(gm), 0, 255).astype(np.uint8)).resize((dw, dh), Image.LANCZOS)).astype(np.float32)

    # phone: the master scaled to the phone picture's height, the phone picture over its centre
    ph, pw = phone.shape[:2]
    s = ph / master.shape[0]
    mw = round(master.shape[1] * s)
    up = np.asarray(Image.fromarray(np.clip(np.rint(gm), 0, 255).astype(np.uint8)).resize((mw, ph), Image.LANCZOS)).astype(np.float32)
    px, corr = locate(cv2.cvtColor(up.astype(np.uint8), cv2.COLOR_RGB2GRAY), cv2.cvtColor(np.clip(gp, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY), s)
    floor = 0 if name in NO_FLOOR else FLOOR
    side = ph + floor
    x0 = px + pw // 2 - side // 2
    x0 = max(0, min(mw - side, x0))
    canvas = up[:, x0:x0 + side].copy()
    alpha = np.ones(pw, np.float32)
    ramp = (np.arange(FEATHER, dtype=np.float32) + 0.5) / FEATHER
    if px - x0 > 0: alpha[:FEATHER] = ramp
    if px - x0 + pw < side: alpha[-FEATHER:] = ramp[::-1]
    a = alpha[None, :, None]
    canvas[:, px - x0:px - x0 + pw] = canvas[:, px - x0:px - x0 + pw] * (1 - a) + gp * a
    rng = np.random.default_rng(int(hashlib.sha256(name.encode()).hexdigest()[:8], 16))
    sq = np.concatenate([canvas, floor_strip(canvas, floor, rng)], 0) if floor else canvas
    return {
        f'{name}-polish-desktop-2560.webp': webp(desk, Q_DESKTOP),
        f'{name}-polish-phone.webp': webp(sq, Q_PHONE),
    }, dict(gains=g.round(4).tolist(), corr=round(corr, 4), x0=x0, phone_x=px, side=side)


def main():
    check = '--check' in sys.argv
    bad = 0
    for n in NAMES:
        files, info = build(n)
        for fn, b in files.items():
            p = HERO / fn
            if check:
                same = p.exists() and p.read_bytes() == b
                bad += not same
                print(f"{'ok  ' if same else 'FAIL'} {fn}")
            else:
                p.write_bytes(b)
                im = Image.open(io.BytesIO(b))
                print(f'{fn:34s} {im.size[0]}x{im.size[1]} {len(b):7d} bytes  sha256 {hashlib.sha256(b).hexdigest()}')
        if not check:
            print(f'  {n}: gains {info["gains"]} match {info["corr"]} square from x={info["x0"]} (phone at {info["phone_x"]}) side {info["side"]}')
    if check:
        print('all ok — the polished hero pictures match their recipe' if not bad else f'{bad} file(s) differ — run python3 scripts/make-hero-polish.py')
        sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
