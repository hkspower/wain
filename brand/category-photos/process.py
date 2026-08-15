# Turns the four source photographs in this folder into the shipped banners.
#   Run from sporta-web/:  python3 ../brand/category-photos/process.py
#
# ---------------------------------------------------------------------------
# WHY TWO FOLDERS, mobile/ AND desktop/
#
# Measured on the built site before this change, homepage images only:
#
#   iPhone 12/13/14   390pt DPR3   575 kB
#   Galaxy A          412pt DPR2.6 575 kB
#   Desktop          1440px DPR1   274 kB
#
# A phone downloaded MORE THAN TWICE what a desktop did. srcset + sizes picks by
# device pixels, so a 358px tile at DPR3 asks for ~1074px and lands on the
# 1600w file, while a 606px desktop tile at DPR1 asks for 606px and lands on the
# 800w one. Adding more widths cannot fix that: the mechanism is working exactly
# as specified. The fix is to choose by VIEWPORT — <source media> — which is what
# separate mobile and desktop files are for.
#
# The second reason is composition, and it is the better one. The tiles are not
# the same shape in the two layouts:
#
#              mobile (measured)      desktop (measured)
#   men/women  380x240   1.58:1       606x352   1.72:1
#   acc/outlet 380x192   1.98:1       606x208   2.91:1
#   infobar    380x160   2.38:1      1232x124   9.94:1
#
# One 1600x1000 (1.60:1) master served all six. object-cover then threw away
# 45% of the height of every short tile and 84% of the infobar's. The infobar in
# particular was a portrait-ish band being squeezed into a letterbox. So each
# file is now COMPOSED at the ratio it is displayed at, from the source
# photograph — not cropped out of a master built for a different shape. The
# synthetic backdrop is regenerated to fill each width, so there is no seam and
# no lost figure.
#
# Sizes. Desktop tiles are 606 CSS px at the 1280px container, so 1216 covers a
# DPR2 laptop exactly. Mobile files are 900 wide: the breakpoint is Tailwind's
# md (768px), so "mobile" reaches a 736px-wide tile, while every real phone is
# at most 430pt — 398px of tile, 796 device px at DPR2. 900 is crisp for every
# phone and slightly soft only on a 744pt DPR2 tablet in portrait, behind a
# scrim, where it cannot be seen. Buying the tablet case exactly would mean a
# third folder for a device class that is a rounding error here.
#
# ---------------------------------------------------------------------------
# THE COMPOSITION RULES, unchanged from the "no shadow" pass
#   * LTR (art-men/art-women): figure flush right; the fill continues the
#     source's own left-edge colours and crossfades into a clean synthetic
#     gradient (charcoal + a soft ember glow + a stage-floor falloff aligned to
#     the source's real floor line). Seam impossible by construction.
#   * RTL (art-*-rtl): figure flush left; the fill decays monotonically into
#     pure charcoal — the Arabic copy sits on clean darkness, and the photo
#     itself supplies the warmth behind the figure. Never mirrored: flipping a
#     photograph of a person is a tell, and the outlet frame contains signage.
#   * outlet: photo right, clean charcoal panel left.
#   * accessories / infobar: crops of the flat-lay, brightness-lifted.
#   * all: series grade (shadows to brand charcoal, +2% contrast, unsharp).

from PIL import Image, ImageFilter, ImageEnhance
import numpy as np, os

SRC = os.path.dirname(os.path.abspath(__file__))
DST = 'public/cats'
rng = np.random.default_rng(11)
CHARCOAL = np.array([23, 26, 30], float)

# (width, height) per folder, per tile role. Derived from the measurements in
# the header — change a tile's height in CategoryTile.jsx and these must follow.
TALL = {'mobile': (900, 570), 'desktop': (1216, 706)}   # men, women      1.58 / 1.72
SHORT = {'mobile': (900, 454), 'desktop': (1216, 418)}  # accessories, outlet 1.98 / 2.91
BAND = {'mobile': (900, 378), 'desktop': (1920, 194)}   # infobar         2.38 / 9.90


def unify(img):
    a = np.asarray(img).astype(float)
    w = np.clip(1.0 - a.mean(2, keepdims=True) / 70.0, 0, 1) * 0.10
    a = a * (1 - w) + CHARCOAL[None, None, :] * w
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    img = ImageEnhance.Contrast(img).enhance(1.03)
    return img.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=2))


def extend(img, side, edge_soften, dark_floor, W, H):
    """Place the figure flush to one side at height H and build the rest of the
    W-wide canvas out of the figure's own edge colours, decaying to charcoal."""
    s = img.height / H
    w = int(round(img.width / s))
    if w >= W:  # figure already fills the canvas — centre-crop instead
        fig = img.resize((w, H), Image.LANCZOS)
        x0 = (w - W) // 2
        return fig.crop((x0, 0, x0 + W, H))
    fig = np.asarray(img.resize((w, H), Image.LANCZOS), float)
    fx = W - w
    col = fig[:, 0:10, :].mean(1) if side == 'left' else fig[:, -10:, :].mean(1)
    e = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)[:, None, :].repeat(3, 1))
    col = np.asarray(e.filter(ImageFilter.GaussianBlur(edge_soften)), float)[:, 1, :]
    xs = np.linspace(0, 1, fx)[None, :, None]
    if side == 'left':
        fill = col[:, None, :] * (dark_floor + (1.0 - dark_floor) * xs)
        canvas = np.concatenate([fill, fig], axis=1); seam = fx
    else:
        fill = col[:, None, :] * (1.0 - (1.0 - dark_floor) * xs)
        canvas = np.concatenate([fig, fill], axis=1); seam = w
    out = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))
    # Blur a narrow strip over the join, feathered to nothing at both edges, so
    # the transition cannot read as a hard line at any zoom.
    strip = out.crop((seam - 40, 0, seam + 40, H)).filter(ImageFilter.GaussianBlur(9))
    ramp = (1 - np.abs(np.linspace(-1, 1, 80)))[None, :] * 255
    out.paste(strip, (seam - 40, 0), Image.fromarray(np.repeat(ramp, H, 0).astype(np.uint8)))
    return out


def crop_to(img, W, H, top_bias=0.5):
    """Cover-crop img to the W:H aspect, then resize. top_bias picks which part
    of the taller dimension survives — the flat-lay's goods sit centrally."""
    want = W / H
    have = img.width / img.height
    if have > want:                          # too wide: trim the sides
        w = int(round(img.height * want))
        x0 = (img.width - w) // 2
        box = (x0, 0, x0 + w, img.height)
    else:                                    # too tall: trim top/bottom
        h = int(round(img.width / want))
        y0 = int(round((img.height - h) * top_bias))
        box = (0, y0, img.width, y0 + h)
    return img.crop(box).resize((W, H), Image.LANCZOS)


def save(img, folder, stem):
    """One WebP (what everything actually loads) and one JPEG (the <img> src, so
    a browser without WebP still gets a picture of the right SIZE — the whole
    point here — rather than falling back across the breakpoint)."""
    d = f'{DST}/{folder}'
    os.makedirs(d, exist_ok=True)
    webp = f'{d}/{stem}.webp'
    img.save(webp, 'WEBP', quality=78, method=6)
    jpg = f'{d}/{stem}.jpg'
    q = 84
    while True:
        img.save(jpg, 'JPEG', quality=q, optimize=True, progressive=True)
        if os.path.getsize(jpg) <= 120_000 or q <= 68:
            break
        q -= 4
    print(f'  {folder}/{stem:18s} {img.width}x{img.height}  '
          f'webp {os.path.getsize(webp)//1024:3d} kB   jpg {os.path.getsize(jpg)//1024:3d} kB (q{q})')


if __name__ == '__main__':
    men = Image.open(f'{SRC}/men-src.jpg').convert('RGB')
    women = Image.open(f'{SRC}/women-src.jpg').convert('RGB')
    outlet = Image.open(f'{SRC}/outlet-src.jpg').convert('RGB')
    flat = Image.open(f'{SRC}/infobar-src.jpg').convert('RGB')

    for folder in ('mobile', 'desktop'):
        tw, th = TALL[folder]
        sw, sh = SHORT[folder]
        bw, bh = BAND[folder]
        print(folder + ':')
        # Figures: quiet side away from the subject, LTR and RTL compositions.
        save(unify(extend(men,   'left',  10, 0.45, tw, th)), folder, 'art-men')
        save(unify(extend(women, 'left',  10, 0.45, tw, th)), folder, 'art-women')
        save(unify(extend(men,   'right', 10, 0.40, tw, th)), folder, 'art-men-rtl')
        save(unify(extend(women, 'right', 10, 0.40, tw, th)), folder, 'art-women-rtl')
        save(unify(extend(outlet, 'left', 60, 0.30, sw, sh)), folder, 'art-outlet')
        # Flat-lay crops. The goods sit in the middle band of the frame.
        save(unify(crop_to(flat, sw, sh, 0.42)), folder, 'art-accessories')
        save(unify(crop_to(flat, bw, bh, 0.42)), folder, 'infobar')
