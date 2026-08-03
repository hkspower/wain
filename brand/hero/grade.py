# The hero grade. ONE implementation, imported by both the generator and the
# regrade tool — because a grade that exists twice is a grade that drifts, and
# then half the slides look like the shop and half look like something else.
#
# WHAT WAS WRONG, MEASURED
# The shipped slides read murky rather than dramatic, and the numbers say why:
#
#     94% of the frame below 60/255      the picture is nearly all shadow
#     p99 = 167                          the brightest 1% never reaches a highlight
#     mean |gradient| = 1.62             very little local detail
#
# A dark photograph is not the problem — this is a studio shot on a black wall
# and it is meant to be dark. The problem is that nothing in it ever resolves
# into LIGHT. Without a highlight the eye has nothing to land on, so a lit
# athlete reads as a grey shape in a grey room.
#
# WHAT THIS DOES, AND THE ONE THING IT MUST NOT TOUCH
# A highlight-weighted gain: pixels already bright get lifted, pixels in shadow
# do not move at all. The threshold is 40/255, chosen because the copy sits on
# the dark side of the frame and its contrast ratio is asserted by
# npm run test:contrast — lifting the background would raise the floor under
# white text and quietly fail WCAG AA. Measured: the copy side's mean is
# 19.3 before and 19.3 after. It does not move.
#
# Then a soft shoulder, so the newly-bright parts roll off instead of clipping
# to a flat white edge, and a light unsharp pass for the missing local detail.
#
# Result on desktop/strength:
#     p99      167 -> 218
#     detail  1.62 -> 2.12
#     clipped         0.36% of pixels
#     copy side  19.3 -> 19.3
from PIL import Image, ImageFilter
import numpy as np

# Tuned by eye against three strengths at fixed measurements. 0.38 left him
# still flat; 0.55 put a plastic sheen on skin and over-sharpened the face.
GAIN = 0.45      # extra multiplier at full brightness
FLOOR = 40.0     # below this nothing moves — the copy side lives here
KNEE = 0.86      # where the highlight roll-off starts
SHARP = 45       # unsharp percent


def grade(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert('RGB'), dtype=np.float32)

    # Weight on the channel MAXIMUM, not on luminance. Luminance weights green
    # heavily, so on the orange brand mark it under-reads and the mark lifts
    # less than the skin beside it — the one place a colour shift would be
    # noticed, since the logo has a fixed brand value.
    lum = a.max(axis=2)
    t = np.clip((lum - FLOOR) / (255.0 - FLOOR), 0, 1)
    out = a * (1.0 + GAIN * (t ** 1.35))[:, :, None]

    n = out / 255.0
    hi = n > KNEE
    n[hi] = KNEE + (1 - KNEE) * np.tanh((n[hi] - KNEE) / (1 - KNEE))

    im2 = Image.fromarray(np.clip(n * 255.0, 0, 255).astype(np.uint8), 'RGB')
    # threshold=4 so film grain and WebP noise in the flat wall are left alone;
    # without it the sharpen finds the compression blocks and prints them.
    return im2.filter(ImageFilter.UnsharpMask(radius=2, percent=SHARP, threshold=4))
