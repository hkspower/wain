# Shared toolkit for the Ember Discipline canvases — carved-mass lighting on PIL
# masks: hot rim where the key light grazes, burnt mids, cores falling dark,
# bloom, particles, grain, vignette. Kept identical across canvases so the four
# artworks grade as one series.
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1600, 1000
CHARCOAL_DEEP = np.array([14, 16, 19], float)      # 0E1013
CHARCOAL = np.array([23, 26, 30], float)           # 171A1E
BURNT = np.array([224, 86, 28], float)             # E0561C
BRIGHT = np.array([255, 123, 23], float)           # FF7B17
DUST = np.array([217, 164, 126], float)            # D9A47E

rng = np.random.default_rng(41)


def base_canvas():
    """Cool-to-warm charcoal field: cool breath lower-left, warmth upper-right."""
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    t = (xx / W * 0.75 + (1 - yy / H) * 0.25)      # temperature ramp, mostly horizontal
    img = CHARCOAL_DEEP[None, None, :] * (1 - t[..., None] * 0.35) \
        + CHARCOAL[None, None, :] * (t[..., None] * 0.35)
    img[..., 2] += (1 - t) * 4.0                    # the cool breath in the dark end
    return img, xx, yy


def warm_glow(img, cx, cy, radius, strength, color=BURNT):
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    d = np.sqrt(((xx - cx) / radius) ** 2 + ((yy - cy) / (radius * 0.62)) ** 2)
    g = np.exp(-d * d) * strength
    img += color[None, None, :] * g[..., None]
    return img


def mask_of(draw_fn, blur=0.0):
    m = Image.new('L', (W, H), 0)
    draw_fn(ImageDraw.Draw(m))
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(m).astype(float) / 255.0


def rim_from(mask, light=(1, -1), width=3.0, jitter=0.35):
    """Edge of the mask that faces the light: mask minus itself shifted toward
    the light. `light` is (dx, dy) of the light direction in pixels-per-step."""
    a = Image.fromarray((mask * 255).astype(np.uint8))
    shifted = a.transform((W, H), Image.AFFINE,
                          (1, 0, light[0] * width, 0, 1, light[1] * width),
                          resample=Image.BILINEAR)
    rim = np.clip(np.asarray(a, float) - np.asarray(shifted, float), 0, 255) / 255.0
    # organic variation so the rim never reads as a uniform wire
    noise = rng.normal(1.0, jitter, (H, W))
    rim *= np.clip(noise, 0.25, 1.6)
    return np.clip(rim, 0, 1)


def carve(img, mask, rim, mid_tone=0.16, rim_heat=1.0, interior_grad=None):
    """Sink the mass toward dark, lay a burnt mid where light reaches, burn the rim."""
    interior = mask if interior_grad is None else np.clip(mask * interior_grad, 0, 1)
    img *= (1 - mask[..., None] * 0.88)                       # the core falls dark
    img += BURNT[None, None, :] * (interior * mid_tone)[..., None]
    img += BRIGHT[None, None, :] * (rim * rim_heat)[..., None]
    return img


def bloom(img, threshold=60):
    lum = img.mean(axis=2)
    hot = np.clip(lum - threshold, 0, None)
    hot_img = np.zeros_like(img)
    for c in range(3):
        hot_img[..., c] = hot * (BRIGHT[c] / 255.0)
    blurred = np.asarray(Image.fromarray(np.clip(hot_img, 0, 255).astype(np.uint8))
                         .filter(ImageFilter.GaussianBlur(14)), float)
    return img + blurred * 0.55


def particles(img, n, x_lo, x_hi, y_lo, y_hi, warm_bias=True):
    layer = Image.new('RGB', (W, H), 0)
    d = ImageDraw.Draw(layer)
    for _ in range(n):
        x = rng.uniform(x_lo, x_hi)
        y = rng.uniform(y_lo, y_hi)
        r = rng.uniform(0.7, 2.6)
        a = rng.uniform(0.15, 0.9)
        col = tuple(int(c * a) for c in (BRIGHT if rng.random() < 0.6 else DUST))
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)
    layer = layer.filter(ImageFilter.GaussianBlur(0.8))
    return img + np.asarray(layer, float) * 0.85


def finish(img, out_path, grain_warm=3.6, grain_cool=1.8):
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    t = xx / W
    # vignette
    d = np.sqrt(((xx - W / 2) / (W * 0.72)) ** 2 + ((yy - H / 2) / (H * 0.72)) ** 2)
    img *= (1 - np.clip(d - 0.55, 0, 1) * 0.35)[..., None]
    # grain, denser in the warm air
    sigma = grain_cool + (grain_warm - grain_cool) * t
    img += rng.normal(0, 1, (H, W))[..., None] * sigma[..., None]
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(out_path)
