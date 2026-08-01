# Sporta hero banner — built from the studio photograph, not retouched onto it.
#
# Run:  python3 brand/hero/build-banner.py path/to/source.jpg
# Needs: pillow (built with RAQM — Arabic will not shape without it), fonttools,
#        numpy.
#
# THE SHAPE OF THE PROBLEM
#
# The source is a 1600x633 JPEG: an athlete lit against a dark studio wall on
# the right, and on the left a flat dark ground carrying an orange stripe with
# a headline burnt into it. Only the athlete is photograph. Everything else is
# graphic, and graphic can be rebuilt — which is the whole reason this file
# exists rather than a retouching session:
#
#   * REBUILT IS SHARPER. Type set as outlines at 4x is sharp at 4x. The same
#     type upscaled from a 1600px JPEG is 1600px of type with bigger pixels,
#     and carries the JPEG's ringing with it.
#   * REBUILT IS CLEAN. The left ground here is generated from a formula, so it
#     has no compression blocking, no banding and no ghost of the old headline
#     to paint out. An earlier version repaired the old artwork instead and
#     every attempt left something: a cloned patch showed its rectangle, and
#     interpolating between two rows left faint vertical streaks.
#   * REBUILT IS EDITABLE. Changing the wording is a re-run.
#
# So the canvas is assembled in three parts that meet along one seam, at x=860
# in source coordinates: the athlete's half is resampled and re-sharpened, the
# left ground is generated, and the orange graphic and every letter are drawn
# on top as vectors.
#
# WHY THE STRIPE BECOMES A PLATE
#
# The headline's size is not a taste decision, it is a geometry one: near-black
# type has to stay inside the orange or it lands on near-black ground and its
# tops vanish. The source's stripe is 74px of a 633px canvas, so it capped the
# headline at about 58px of cap height — small, on a banner this wide.
#
# The stripe cannot simply be made taller, because it passes BEHIND the athlete
# and there is no mask for him. But it does not have to be one thickness. Left
# of him it is a PLATE 112px deep, cut off by a diagonal that repeats the type's
# 10 degree lean; from there the original 74px stripe carries on behind him and
# out the right edge. The measurements that make this safe are in PLATE_R —
# the athlete's silhouette was measured, not guessed.
#
# The headline gained about 60% of its cap height from that one change.
import math
import os
import sys
import tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SRC  = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'source.jpg')

ORANGE = (255, 123, 22)   # brand.bright #FF7B16, and the sampled stripe
INK    = (23, 26, 30)     # #171A1E
S      = 4                # master at 4x -> 6400 x 2532
SHEAR  = math.tan(math.radians(10))

# --- geometry, in SOURCE pixels (multiply by S to draw) ----------------------
SEAM     = 860            # left of here is generated, right of here is photo
BLEND    = 30             # crossfade width across that seam
STRIPE_T, STRIPE_B = 248, 322    # the stripe as it exists in the photograph
PLATE_T, PLATE_B   = 229, 341    # the deeper plate drawn left of the athlete
STRIPE_R = 910            # vector stripe ends here; the photo's own orange
                          # covers 910..937, and the athlete starts at 937
# The plate's diagonal. Measured, not guessed: scanning the source for orange
# puts the athlete's edge at x=937 across the stripe rows, and a luminance scan
# of the rows just above and below the stripe puts it at 955 and 940. The
# diagonal's rightmost point is 918, so it clears him everywhere by ~20px, and
# it leans the same 10 degrees as the headline.
PLATE_R_TOP, PLATE_R_BOT = 918, 898
TEXT_L, TEXT_R = 120, 880        # the run the headline may occupy

# The site ships Alexandria as a variable woff2; Pillow cannot pick a weight off
# a variable font, so each cut is instantiated to a static TTF in a temp dir.
# Same file the page is set in — no second typeface enters the brand this way.
FONTDIR = tempfile.mkdtemp(prefix='sporta-fonts-')


def cut(script, weight):
    """Alexandria at one fixed weight, as a file Pillow will open."""
    path = os.path.join(FONTDIR, f'{script}-{weight}.ttf')
    if not os.path.exists(path):
        from fontTools.ttLib import TTFont
        from fontTools.varLib import instancer
        f = TTFont(os.path.join(REPO, 'sporta-web/public/fonts',
                                f'alexandria-var-{script}.woff2'))
        f.flavor = None
        instancer.instantiateVariableFont(f, {'wght': weight}, inplace=True)
        f.save(path)
    return path


src = Image.open(SRC).convert('RGB')
W, H = src.size
CW, CH = W * S, H * S

# ---------------------------------------------------------------- the ground
#
# Generated, not sampled — but ANCHORED to the photograph so the seam cannot
# show. The anchor is the studio wall's own colour at every height, taken from
# a 55px column just left of the athlete, which is wall and nothing else.
col = np.asarray(src.crop((845, 0, 900, H)), dtype=np.float64).mean(axis=1)

# Except across the stripe, where that column is orange. Those rows are filled
# by a straight line between the wall above and the wall below — the wall is a
# smooth gradient there, so the line IS the wall.
a, b = 244, 327
t = np.linspace(0, 1, b - a)[:, None]
col[a:b] = col[a - 1] * (1 - t) + col[b] * t

# Smoothed hard: this is meant to be the wall's trend, not its grain. The grain
# is put back later, at the final resolution, where it is 1px fine instead of
# 4px blocky.
k = np.exp(-0.5 * (np.arange(-90, 91) / 30.0) ** 2)
k /= k.sum()
col = np.stack([np.convolve(np.pad(col[:, c], 90, mode='edge'), k, 'valid')
                for c in range(3)], axis=1)

# Upsample the anchor to the master's height, then sweep it left.
yy = np.linspace(0, H - 1, CH)
anchor = np.stack([np.interp(yy, np.arange(H), col[:, c]) for c in range(3)], 1)

# The sweep. Deliberately DARKER toward the left, from the wall's own tone at
# the seam down to 62% of it at the far edge, on a smoothstep so there is no
# edge anywhere in it. This is not decoration: the headline block and the white
# kicker sit in that left third, and every level the ground drops there is
# contrast they gain. It also reads as a studio falloff, which is what the
# right half genuinely is.
xx = np.linspace(0, 1, CW)[None, :]
s = np.clip(xx / (SEAM / W), 0, 1)
sweep = 0.62 + 0.38 * (s * s * (3 - 2 * s))

# A slow vertical vignette on top, so the corners settle rather than sit flat.
vy = np.linspace(-1, 1, CH)[:, None]
sweep = sweep * (1 - 0.08 * np.abs(vy) ** 2.4)

ground = anchor[:, None, :] * sweep[:, :, None]

# Dither, and ONLY dither. An 8-bit gradient this dark and this wide bands into
# visible steps without it, and a sub-level of noise is the standard cure —
# invisible at any viewing distance, but it breaks the contours.
#
# Texture was tried twice here and thrown away twice, which is the note worth
# keeping. A ground sitting at luminance ~18 has almost no headroom: mottle at
# ±2.5 levels on a 24px grid read as speckled dirt, and dropping it to ±1.3 on
# a 140px grid only turned the dirt into soft cloudy blotches. Two levels is a
# seventh of this ground. The wall behind an athlete in a studio is smooth, and
# so is this one.
rng = np.random.default_rng(20250801)
ground += rng.triangular(-1.4, 0, 1.4, (CH, CW, 1))
ground = Image.fromarray(np.clip(ground, 0, 255).astype(np.uint8), 'RGB')

# ------------------------------------------------------- the athlete's half
#
# Two sharpening passes doing two different things: a wide, weak one for local
# contrast (the shirt's folds and the wall's falloff read as form), then a
# narrow, stronger one for edges. One pass tuned to do both either halos the
# edges or leaves the form flat.
photo = src.resize((CW, CH), Image.LANCZOS)
photo = photo.filter(ImageFilter.UnsharpMask(radius=18 * S, percent=22, threshold=2))
photo = photo.filter(ImageFilter.UnsharpMask(radius=1.3 * S, percent=115, threshold=3))

mask = Image.new('L', (CW, CH), 0)
md = ImageDraw.Draw(mask)
md.rectangle([(SEAM + BLEND) * S, 0, CW, CH], fill=255)
for i in range(BLEND * S):
    md.line([(SEAM * S + i, 0), (SEAM * S + i, CH)], fill=int(255 * i / (BLEND * S)))
im = Image.composite(photo, ground, mask)

# ------------------------------------------------------- the orange graphic
d = ImageDraw.Draw(im)
# The stripe first, out to where the photograph's own orange takes over. The
# last 16px fade rather than butt, so a hair of colour drift between the drawn
# orange and the photographed orange cannot show as a seam.
d.rectangle([0, STRIPE_T * S, STRIPE_R * S, STRIPE_B * S], fill=ORANGE)
fw, fh = 16 * S, (STRIPE_B - STRIPE_T) * S
fade = Image.new('L', (fw, fh))
fade.putdata([255 - 255 * (i % fw) // fw for i in range(fw * fh)])
im.paste(Image.new('RGB', (fw, fh), ORANGE), (STRIPE_R * S, STRIPE_T * S), fade)
# Then the plate over it, diagonal edge and all.
d.polygon([(0, PLATE_T * S), (PLATE_R_TOP * S, PLATE_T * S),
           (PLATE_R_BOT * S, PLATE_B * S), (0, PLATE_B * S)], fill=ORANGE)

PLATE_H = (PLATE_B - PLATE_T) * S


def set_type(text, font, fill, tracking, shear=0.0):
    """Render one line on its own layer, letterspaced, optionally obliqued.

    Drawn glyph by glyph because Pillow has no tracking control, and sheared
    afterwards on the assembled layer so the slant is one consistent angle
    rather than per-glyph rounding. The layer is padded by exactly the
    horizontal travel the shear introduces, so nothing is clipped.

    With tracking == 0 the string is drawn in ONE call, and that is not an
    optimisation — it is the only way Arabic can be drawn at all. Splitting a
    string into characters and placing them left to right destroys both the
    joining (every letter falls back to its isolated form) and the bidi run
    (the word comes out mirrored): "الأفضل" rendered as "لضفألا". Latin
    tracking is safe because Latin has neither. Hence no Arabic line here asks
    for tracking, and none ever can.
    """
    probe = ImageDraw.Draw(Image.new('L', (1, 1)))
    box = font.getbbox(text)
    h = box[3] + abs(box[1]) + 8
    pad = int(abs(shear) * h) + 2
    if tracking == 0:
        w = int(probe.textlength(text, font=font)) + 8
        layer = Image.new('RGBA', (w + pad * 2, h), (0, 0, 0, 0))
        ImageDraw.Draw(layer).text((pad, -box[1] + 4), text, font=font, fill=fill + (255,))
    else:
        widths = [probe.textlength(c, font=font) for c in text]
        w = int(sum(widths) + tracking * (len(text) - 1)) + 8
        layer = Image.new('RGBA', (w + pad * 2, h), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        x = pad
        for c, cw in zip(text, widths):
            ld.text((x, -box[1] + 4), c, font=font, fill=fill + (255,))
            x += cw + tracking
    if shear:
        # Bottom slides left, so the word leans right.
        layer = layer.transform(layer.size, Image.AFFINE, (1, shear, 0, 0, 1, 0),
                                resample=Image.BICUBIC)
    return layer.crop(layer.getbbox())


def fit(script, weight, text, fill, tracking, shear, max_h, max_w, start):
    """The largest size at which the line clears both bounds.

    Both bounds, always. Height alone lets a long word run off the plate;
    width alone lets a short one overshoot it top and bottom. Which of the two
    actually binds differs between the two languages and between any two
    headlines anyone types here later, so neither is assumed.
    """
    size = start
    while size > 20:
        f = ImageFont.truetype(cut(script, weight), size)
        lay = set_type(text, f, fill, tracking, shear)
        if lay.height <= max_h and lay.width <= max_w:
            return lay, size
        size -= 2
    raise SystemExit(f'{text!r} will not fit')


def build(lang):
    """Return (headline layer, kicker layer, point size) placed on `im`."""
    plate_mid = (PLATE_T + PLATE_B) * S // 2
    max_w = (TEXT_R - TEXT_L) * S

    if lang == 'en':
        # 86% of the plate, leaving 7% of clear orange above and below. Caps
        # have no descenders, so the layer's box IS the cap height.
        head, size = fit('latin', 900, 'SPORTSWEAR', INK, -2.2 * S, SHEAR,
                         PLATE_H * 0.86, max_w, 320 * S // 2)
        kick = set_type('THE BEST', ImageFont.truetype(cut('latin', 700), 42 * S),
                        (255, 255, 255), 17 * S)
        hx, kx, anchor = TEXT_L * S, TEXT_L * S, 'ls'
    else:
        # Arabic is sized by HEIGHT, never by width: its ascenders and dots
        # tower over Latin caps, so a width fit puts ink outside the plate.
        # And it is never sheared — an obliqued Arabic is a broken Arabic.
        head, size = fit('arabic', 900, 'ملابس رياضية', INK, 0, 0,
                         PLATE_H * 0.86, max_w, 460)
        kick = set_type('الأفضل', ImageFont.truetype(cut('arabic', 700), 42 * S),
                        (255, 255, 255), 0)
        # Right-aligned to the plate, clear of its diagonal.
        hx = kx = (PLATE_R_BOT - 60) * S
        anchor = 'rs'

    for lay, y in ((head, plate_mid - head.height // 2),
                   (kick, PLATE_T * S - 30 * S - kick.height)):
        x = (hx if lay is head else kx)
        im.paste(lay, (x if anchor == 'ls' else x - lay.width, y), lay)
    return size


# Three sizes per language, because they answer three different questions:
#   -4x.webp    the master, for anything that needs re-cropping or printing
#   -2x.png     what a retina desktop hero actually wants
#   -slide.webp what the admin's slide uploader accepts (it downscales to 1600
#               in the browser, so handing it more only wastes bytes)
base = im.copy()
for lang in ('en', 'ar'):
    im = base.copy()
    size = build(lang)
    p = os.path.join(HERE, f'banner-sportswear-{lang}')
    im.save(p + '-4x.webp', quality=95, method=5)
    im.resize((W * 2, H * 2), Image.LANCZOS).save(p + '-2x.png', optimize=True)
    im.resize((W, H), Image.LANCZOS).save(p + '-slide.webp', quality=88, method=6)
    print(f'{lang}: headline {size}px on a {PLATE_H}px plate')
