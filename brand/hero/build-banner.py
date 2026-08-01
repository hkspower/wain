# Sporta hero banner — v2: sportier type, genuinely higher resolution.
#
# TYPE. The site has exactly one typeface (Alexandria) and it is variable on
# WEIGHT ONLY — no width or slant axis — and the system carries no condensed
# or black display face at all (checked with fc-list). So the athletic look is
# built rather than bought, out of the three things that actually make a
# sportswear wordmark read fast:
#     * wght 900 instead of 800 — heavier ink, tighter counters;
#     * a 10 degree oblique, sheared on the rendered outlines rather than faked
#       by a font flag, so the shear is uniform and the baseline stays put;
#     * negative tracking, so the word locks into one solid block.
# Staying inside Alexandria matters more than any bought face would: the
# banner has to sit above a page set in it.
#
# RESOLUTION. The source is 1600x633 and no upscaler invents detail. But the
# left ~55% of this banner is not photograph — it is a dark gradient with a
# faint weave, and that CAN be regenerated at any size. So the background is
# rebuilt from a heavily blurred copy of the source (blur first, then resample:
# smooth content enlarges losslessly) with fresh grain laid down at the FINAL
# resolution, the photograph half is resampled and detail-enhanced on its own,
# and the band and every letter are drawn as vectors. At 4x only the man is
# bounded by the original file; everything else is native.
#
# Run:  python3 brand/hero/build-banner.py path/to/source.jpg
# Needs: pillow (built with RAQM — Arabic will not shape without it), fonttools.
import math
import os
import sys
import tempfile
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE   = os.path.dirname(os.path.abspath(__file__))
REPO   = os.path.dirname(os.path.dirname(HERE))
SRC    = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'source.jpg')
ORANGE = (255, 123, 22)   # brand.bright #FF7B16, sampled from the band
INK    = (23, 26, 30)     # #171A1E
S      = 4                # master at 4x -> 6400 x 2532
SEAM   = 860 * S          # left of this is regenerated, right of it is photo
SHEAR  = math.tan(math.radians(10))

# The site ships Alexandria as a variable woff2; Pillow cannot pick a weight
# off a variable font, so each cut used here is instantiated to a static TTF in
# a temp dir. Same font file the page is set in — no second typeface enters the
# brand through the back door.
FONTDIR = tempfile.mkdtemp(prefix='sporta-fonts-')


def cut(script, weight):
    """Alexandria at one fixed weight, as a file Pillow will open."""
    path = os.path.join(FONTDIR, f'{script}-{weight}.ttf')
    if not os.path.exists(path):
        f = TTFont(os.path.join(REPO, 'sporta-web/public/fonts',
                                f'alexandria-var-{script}.woff2'))
        f.flavor = None
        instancer.instantiateVariableFont(f, {'wght': weight}, inplace=True)
        f.save(path)
    return path

src = Image.open(SRC).convert('RGB')
W, H = src.size
CW, CH = W * S, H * S

# ---- background, regenerated ------------------------------------------------
# Blur BEFORE enlarging. JPEG blocking and chroma noise live in the high
# frequencies; removing them first means the resample has only smooth gradient
# to carry, which it does exactly. Enlarging first would magnify the artefacts
# and then blur the result into mush.
bg = src.filter(ImageFilter.GaussianBlur(7)).resize((CW, CH), Image.LANCZOS)

# Grain at the FINAL resolution, so it is 1px fine on the master rather than a
# 4px block. Without it the regenerated half is glassy next to the photograph.
noise = Image.effect_noise((CW, CH), 7).convert('L')
bg = ImageChops.add(bg, Image.merge('RGB', (noise, noise, noise)), scale=1, offset=-128)

# ---- photograph, enlarged and re-sharpened ----------------------------------
photo = src.resize((CW, CH), Image.LANCZOS).filter(
    ImageFilter.UnsharpMask(radius=2.6 * S / 2, percent=105, threshold=3))

# Composite: photo on the right, regenerated ground on the left, crossfaded
# across 120px so no vertical edge betrays where one becomes the other.
FEATHER = 120
mask = Image.new('L', (CW, CH), 0)
md = ImageDraw.Draw(mask)
md.rectangle([SEAM + FEATHER, 0, CW, CH], fill=255)
for i in range(FEATHER):
    md.line([(SEAM + i, 0), (SEAM + i, CH)], fill=int(255 * i / FEATHER))
im = Image.composite(photo, bg, mask)

# ---- erase the old baked-in artwork -----------------------------------------
# The source has the old (misspelled, outlined) headline and the band burnt
# into it. Cloning a clean strip over them leaves a rectangle you can see: the
# ground is a gradient, so a patch lifted from 380px lower is the wrong shade
# by the time it is pasted.
#
# Interpolating instead is exact. Across the erased band the ground is a smooth
# vertical gradient and nothing else, so every row between the last clean row
# above and the first clean row below is a weighted blend of those two — which
# is what a gradient IS. No seam is possible, because the top and bottom rows
# of the repair are the rows they replace.
ERASE_T, ERASE_B = 108 * S, 378 * S
ERASE_R = 895 * S
# The two source rows are smoothed horizontally first. Stretching a single
# row down 1000px turns every pixel-to-pixel wobble in it into a vertical
# stripe the full height of the repair — visible even at 1/4 scale.
def _row(y):
    r = im.crop((0, y, ERASE_R, y + 1))
    r = r.resize((ERASE_R // 110, 1), Image.BOX).resize((ERASE_R, 1), Image.BICUBIC)
    return r.resize((ERASE_R, ERASE_B - ERASE_T))

top, bot = _row(ERASE_T), _row(ERASE_B)
ramp = Image.new('L', (ERASE_R, ERASE_B - ERASE_T))
ramp.putdata([255 * (i // ERASE_R) // (ERASE_B - ERASE_T - 1)
              for i in range(ERASE_R * (ERASE_B - ERASE_T))])
repair = Image.composite(bot, top, ramp)
# Fresh grain, or the repaired strip is glassy against the grained ground.
rn = Image.effect_noise(repair.size, 6).convert('L')
repair = ImageChops.add(repair, Image.merge('RGB', (rn, rn, rn)), scale=1, offset=-128)
# Feather the right edge into the photograph rather than butting against it.
edge = Image.new('L', repair.size, 255)
ed = ImageDraw.Draw(edge)
for i in range(80):
    ed.line([(ERASE_R - 80 + i, 0), (ERASE_R - 80 + i, repair.height)],
            fill=int(255 * (1 - i / 80)))
im.paste(repair, (0, ERASE_T), edge)

# ---- the band, as a vector --------------------------------------------------
BAND_T, BAND_B = 250 * S, 321 * S
band_end = 892 * S
d = ImageDraw.Draw(im)
d.rectangle([0, BAND_T, band_end, BAND_B], fill=ORANGE)
# Feather into the band pixels that survive inside the photograph. Same colour,
# so the join is invisible; the ramp only guards against a half-tone seam.
fw = 24 * S
fade = Image.new('L', (fw, BAND_B - BAND_T))
fade.putdata([255 - (255 * (i % fw) // fw) for i in range(fw * (BAND_B - BAND_T))])
im.paste(Image.new('RGB', fade.size, ORANGE), (band_end, BAND_T), fade)


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
    tracking is safe because Latin has neither. Hence no Arabic line here
    asks for tracking, and none ever can.
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
    return layer.crop(layer.getbbox()), pad


def place(layer, x, y, anchor='ls'):
    im.paste(layer, (x if anchor == 'ls' else x - layer.width, y), layer)


LEFT   = 160 * S
RIGHT  = 840 * S
band_h = BAND_B - BAND_T


def build(lang):
    global im
    if lang == 'en':
        kick_txt, head_txt = 'THE BEST', 'SPORTSWEAR'
        kick_f = ImageFont.truetype(cut('latin', 700), 30 * S)
        # Fit by HEIGHT first: near-black type that overshoots the orange band
        # lands on near-black ground and the tops of the letters vanish. The
        # cap height is pinned to 78% of the band, which leaves an even margin
        # above and below, and the width is then checked as a second bound.
        # Tracking is negative: at this weight the word wants to read as one
        # mass, not as ten letters.
        size = 220
        while size > 40:
            f = ImageFont.truetype(cut('latin', 900), size * S // 2)
            lay, _ = set_type(head_txt, f, INK, -2.0 * S, SHEAR)
            if lay.height <= band_h * 0.78 and lay.width <= RIGHT - LEFT:
                break
            size -= 2
        kl, _ = set_type(kick_txt, kick_f, (255, 255, 255), 13 * S)
        place(kl, LEFT, 150 * S)
        place(lay, LEFT, BAND_T + (band_h - lay.height) // 2)
    else:
        kick_txt, head_txt = 'الأفضل', 'ملابس رياضية'
        kick_f = ImageFont.truetype(cut('arabic', 700), 30 * S)
        # Arabic is sized by HEIGHT, never by width: its ascenders and dots
        # tower over Latin caps, so a width fit puts dark ink outside the band.
        # And it is never sheared — an obliqued Arabic is a broken Arabic.
        size = 420
        while size > 30:
            f = ImageFont.truetype(cut('arabic', 900), size)
            lay, _ = set_type(head_txt, f, INK, 0)
            if lay.height <= band_h * 0.92 and lay.width <= RIGHT - LEFT:
                break
            size -= 2
        kl, _ = set_type(kick_txt, kick_f, (255, 255, 255), 0)
        place(kl, band_end - 30 * S, 150 * S, 'rs')
        place(lay, band_end - 30 * S, BAND_T + (band_h - lay.height) // 2, 'rs')
    return size


# Three sizes per language, because they answer three different questions:
#   -4x.webp   the master, for anything that needs to be re-cropped or printed
#   -2x.png    what a retina desktop hero actually wants
#   -slide.webp what the admin's slide uploader accepts (it downscales to 1600
#              in the browser, so handing it anything larger only wastes bytes)
base = im.copy()
for lang in ('en', 'ar'):
    im = base.copy()
    sz = build(lang)
    p = os.path.join(HERE, f'banner-sportswear-{lang}')
    im.save(p + '-4x.webp', quality=95, method=5)
    im.resize((W * 2, H * 2), Image.LANCZOS).save(p + '-2x.png', optimize=True)
    im.resize((1600, 633), Image.LANCZOS).save(p + '-slide.webp', quality=88, method=6)
    print(lang, 'headline pt', sz, im.size)
