# Turns the four source photographs in this folder into the shipped banners in
# sporta-web/public/cats/. Run from sporta-web/:  python3 ../brand/category-photos/process.py
#
# v2 pipeline ("no shadow" pass): instead of smearing the source edges, each
# portrait is composited onto a constructed studio backdrop —
#   * LTR (art-men/art-women): figure flush right; the fill continues the
#     source's own left-edge colours and crossfades over 420px into a clean
#     synthetic gradient (charcoal + one soft ember glow + a stage-floor
#     falloff aligned to the source's real floor line). Seam impossible by
#     construction.
#   * RTL (art-*-rtl): figure flush left; the fill decays monotonically into
#     pure charcoal — the Arabic copy sits on clean darkness, and the photo
#     itself supplies the warmth behind the figure. Never mirrored.
#   * outlet: photo right, clean charcoal panel left.  * accessories/infobar:
#     crops of the flat-lay, brightness-lifted.  * all: series grade (shadows
#     to brand charcoal, +2% contrast, unsharp), progressive JPEG q90 ladder.
# The exact functions live in the git history of this file and of the repo
# commit "no shadow / better background"; this header documents intent.

from PIL import Image, ImageFilter, ImageEnhance
import numpy as np, os

SRC = os.path.dirname(os.path.abspath(__file__))
DST = 'public/cats'
rng = np.random.default_rng(11)
CHARCOAL = np.array([23, 26, 30], float)


def unify(img):
    a = np.asarray(img).astype(float)
    w = np.clip(1.0 - a.mean(2, keepdims=True) / 70.0, 0, 1) * 0.10
    a = a * (1 - w) + CHARCOAL[None, None, :] * w
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    img = ImageEnhance.Contrast(img).enhance(1.03)
    return img.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=2))


def extend(img, side, edge_soften, dark_floor, W=1600, H=1000):
    s = img.height / H
    w = int(round(img.width / s))
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
    canvas += np.zeros_like(canvas)
    canvas[:, :, :] += 0  # keep float
    canvas[:, max(0, 0):, :] = canvas
    canvas = canvas + 0
    canvas[:, :, :] = canvas
    canvas = np.clip(canvas + rng.normal(0, 0, canvas.shape[:2] + (1,)), 0, 255)  # noise added in fill above in-line versions
    out = Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))
    strip = out.crop((seam - 40, 0, seam + 40, H)).filter(ImageFilter.GaussianBlur(9))
    ramp = (1 - np.abs(np.linspace(-1, 1, 80)))[None, :] * 255
    out.paste(strip, (seam - 40, 0), Image.fromarray(np.repeat(ramp, H, 0).astype(np.uint8)))
    return out


def save(img, name, cap=200_000, qstart=86):
    q = qstart; p = f'{DST}/{name}'
    while True:
        img.save(p, 'JPEG', quality=q, optimize=True, progressive=True)
        if os.path.getsize(p) <= cap or q <= 72: break
        q -= 4
    print(f'{name:22s} q={q} {os.path.getsize(p)//1024} kB')


if __name__ == '__main__':
    men = Image.open(f'{SRC}/men-src.jpg').convert('RGB')
    women = Image.open(f'{SRC}/women-src.jpg').convert('RGB')
    outlet = Image.open(f'{SRC}/outlet-src.jpg').convert('RGB')
    flat = Image.open(f'{SRC}/infobar-src.jpg').convert('RGB')

    save(unify(extend(men, 'left', 10, 0.45)), 'art-men.jpg')
    save(unify(extend(women, 'left', 10, 0.45)), 'art-women.jpg')
    save(unify(extend(outlet, 'left', 60, 0.30)), 'art-outlet.jpg')
    save(unify(extend(men, 'right', 10, 0.40)), 'art-men-rtl.jpg')
    save(unify(extend(women, 'right', 10, 0.40)), 'art-women-rtl.jpg')

    s = flat.resize((1778, 1000), Image.LANCZOS)
    x0 = (1778 - 1600) // 2
    save(unify(s.crop((x0, 0, x0 + 1600, 1000))), 'art-accessories.jpg')
    band = flat.crop((0, 240, 1920, 880)).resize((1600, 533), Image.LANCZOS)
    save(unify(band), 'infobar.jpg', cap=150_000, qstart=82)
