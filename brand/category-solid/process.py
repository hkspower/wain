# Builds the home page's category pictures and the "Sporta features" band from the four masters in this folder.
#   Run from sporta-web/:   python3 ../brand/category-solid/process.py            (writes public/cats/{desktop,mobile}/)
#                           python3 ../brand/category-solid/process.py --out DIR  (writes DIR/{desktop,mobile}/ instead)
#   Needs: numpy and OpenCV (pip install numpy opencv-python-headless). Nothing else, no network.
#
# ---------------------------------------------------------------------------------------------------------------
# WHAT THE OWNER ASKED FOR (2026-11-26): "make catories images without ridues" -> "Remove the background glow /
# colour cast" -> "make one solid backgound without effecte" -> "design full new set".
#
# The pictures that were live had an orange studio glow behind the athletes, a vignette around the outlet shelves
# and an ember rim on the flat-lay; under the tile's dark text scrim the glow read as a brown smear. This set has
# NO backdrop of its own: every subject stands on ONE flat colour, and that colour is the scrim's own,
# rgb(17, 17, 19) (public/sporta-cat-tiles.css: rgba(17,17,19,.9) ...). A scrim of colour C over a picture of
# colour C is C at every opacity, so the tile is one flat near-black from edge to edge and the only thing the
# scrim still darkens is a subject that stands under the words, which is what it is for.
#
# THE MASTERS (<name>-src.png, 960 x 1280 or 1280 x 960) were generated on 2026-11-26 with the Figma image
# generator (model gpt-image-2.5-flare), one prompt family: the subject "on one perfectly uniform flat solid matte
# black backdrop, no gradient, no vignette, no glow, no floor line, no cast shadow", the kit in the shop's two
# colours (logo orange #FF7B17 and a mid grey), no logos and no text (the outlet tag carries a percent sign: the
# one mark that reads the same in Arabic and English). The people are not real people. The generator's backdrop
# measured flat to +-2 levels in every corner; what this script does to it is below.
#
# WHAT THIS SCRIPT DOES TO A MASTER (function clean)
#   1. Finds the backdrop colour (median of the four corners) and shifts the whole picture so it becomes BG exactly.
#   2. "Subject" = every pixel more than 12 levels from BG. Everything else is backdrop, and:
#        - a backdrop pixel DARKER than BG is a cast shadow (the flat-lay and the stacks had soft ones reaching
#          30-60px): it becomes BG. No shadows.
#        - a backdrop pixel LIGHTER than BG is the soft edge of the subject: it is kept within 2px of the subject
#          and faded out to BG by 7px, so edges stay smooth and nothing glows.
#   3. So outside a 7px rim around the subject every pixel is BG, bit for bit, and the compositions below are
#      rectangles of that same colour: there is no seam to hide and nothing to "extend".
#
# THE COMPOSITIONS (the numbers are in LAYOUT below; scripts/cat-art-solid-test.mjs measures them on the tiles)
#   The four tiles are one size (equal rows since 2026-11-02), so all four pictures use the same two canvases:
#       desktop 1216 x 706 (1.72 : 1)      mobile 900 x 570 (1.58 : 1)
#   The subject stands at the END side of the tile (right in English, left in Arabic). The "-rtl" files are the
#   same subject on the other side with the ORDER of the items reversed, never a mirror image: a mirrored percent
#   sign is a different sign, and a zip that closes the wrong way is a tell.
#
#   Where the words are (measured on the live tiles, 320-1920px, both languages) decides where a subject may be
#   bright. The words are white and centred; the scrim that makes them readable runs sideways from 768px (strong
#   under the words, clear at the END edge) and bottom-up on a phone (clear in the top quarter, where the small
#   kicker line is). A WHITE thing under a word is the one combination the scrim cannot rescue, so:
#     - PEOPLE run the full height at the END edge. Head and shoulders are beside the words; only the last
#       words of the description cross an arm, where the scrim is at 55-75%.
#     - OBJECTS on a desktop tile stand in the UPPER END part (rows 16-63% of the file): from 768px the words
#       start at row 44% and their long lines are at the bottom, so that part is clear at every width, and it is
#       inside the tile at 1920px too, where the tile shows only rows 16-84%.
#     - OBJECTS on a phone tile stand in the top END corner (x from 74%, rows 9-58%): beside the kicker and the
#       title on every phone from 360px, and above the arrow button. A phone tile is 86px wide there, so it gets
#       two things, not five.
#
#   File names are the ones the LIVE storefront requests (measured on the captured home page): art-men,
#   art-women, art-accessories-v2, art-outlet, each with an "-rtl" twin, plus infobar, as .jpg and .webp.
#
# This folder is not shipped (brand/ never is). public/cats/ holds the exports. On the VPS the folder that is
# served as /cats/ is the media mount /docker/sporta/private/media/cats, which a site deploy never writes:
# see scripts/cats-media-install.mjs.
import os, sys
import cv2
import numpy as np

SRC = os.path.dirname(os.path.abspath(__file__))
DST = 'public/cats'
if '--out' in sys.argv:
    DST = sys.argv[sys.argv.index('--out') + 1]

BG_RGB = (17, 17, 19)                      # the tile scrim's colour, see the header
BG = np.array(BG_RGB[::-1], np.float32)    # OpenCV is BGR
CORE = 12                                  # levels from BG at which a pixel is certainly the subject
RIM_KEEP, RIM_END = 2.0, 7.0               # px: soft edge kept whole / gone
PAD = 8                                    # px of backdrop kept around a cut-out, so its soft edge comes along


# ------------------------------------------------------------------------------------------------ the masters
def clean(name):
    """The master on exact BG: returns (picture float32 BGR, subject mask uint8, the untouched master)."""
    raw = cv2.imread(os.path.join(SRC, name + '-src.png'), cv2.IMREAD_COLOR)
    if raw is None:
        raise SystemExit('missing master: ' + name + '-src.png')
    im = raw.astype(np.float32)
    c = 24
    corners = np.concatenate([im[:c, :c].reshape(-1, 3), im[:c, -c:].reshape(-1, 3),
                              im[-c:, :c].reshape(-1, 3), im[-c:, -c:].reshape(-1, 3)])
    spread = corners.max(0) - corners.min(0)
    if spread.max() > 8:
        raise SystemExit(name + ': the corners are not one colour (spread %s): not a flat-backdrop master' % spread)
    x = np.clip(im + (BG - np.median(corners, axis=0)), 0, 255)
    diff = x - BG
    core = (np.abs(diff).max(axis=2) > CORE).astype(np.uint8)
    # drop specks: a real part of a subject is larger than 12 px
    n, lab, stats, _ = cv2.connectedComponentsWithStats(core, connectivity=8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < 12:
            core[lab == i] = 0
    dist = cv2.distanceTransform(1 - core, cv2.DIST_L2, 5)
    keep = np.clip(1.0 - (dist - RIM_KEEP) / (RIM_END - RIM_KEEP), 0.0, 1.0)      # 1 on the subject's edge, 0 from 7px
    darker = (diff.max(axis=2) <= 0)                                              # no channel above BG: a shadow
    keep[(core == 0) & darker] = 0.0
    keep[core == 1] = 1.0
    out = BG + diff * keep[..., None]
    near = (np.abs(out - BG).max(axis=2) <= 2) & (core == 0)
    out[near] = BG
    return out, core, raw


def cutout(pic, mask, part):
    """One thing out of a cleaned master: `part` is a 0/1 map of the pixels that belong to it. Returns the
    rectangle around it on BG (PAD px of backdrop on every side), with nothing of its neighbours in it."""
    m = (mask & part).astype(np.uint8)
    ys, xs = np.where(m > 0)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    own = cv2.dilate(m, np.ones((2 * PAD + 1, 2 * PAD + 1), np.uint8)) & part.astype(np.uint8)   # the thing + its soft rim
    h, w = mask.shape
    out = np.empty((y1 - y0 + 2 * PAD, x1 - x0 + 2 * PAD, 3), np.float32)
    out[:] = BG
    sx0, sy0, sx1, sy1 = max(0, x0 - PAD), max(0, y0 - PAD), min(w, x1 + PAD), min(h, y1 + PAD)
    src = np.where(own[sy0:sy1, sx0:sx1, None] == 1, pic[sy0:sy1, sx0:sx1], BG)
    out[sy0 - (y0 - PAD):sy1 - (y0 - PAD), sx0 - (x0 - PAD):sx1 - (x0 - PAD)] = src
    return out


def size(spr):
    """Width and height of the thing inside a cut-out (the cut-out minus its PAD)."""
    return spr.shape[1] - 2 * PAD, spr.shape[0] - 2 * PAD


def scaled(spr, s):
    h, w = spr.shape[:2]
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    r = cv2.resize(spr, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    if s < 1:
        # INTER_AREA is a box filter: a touch of unsharp gives the fabric back its weave. Only on the subject,
        # so the flat colour stays the flat colour.
        blur = cv2.GaussianBlur(r, (0, 0), 0.9)
        sharp = np.clip(r + 0.35 * (r - blur), 0, 255)
        subj = (np.abs(r - BG).max(axis=2) > CORE)[..., None]
        r = np.where(subj, sharp, r)
    flat = np.abs(r - BG).max(axis=2) <= 1.0
    r[flat] = BG
    return r


def paste(canvas, spr, s, x, y):
    """Draw the cut-out at scale s with the THING's top-left corner at (x, y). Whatever leaves the canvas is
    cut. Returns the thing's box on the canvas."""
    r = scaled(spr, s)
    ps = int(round(PAD * s))
    H, W = canvas.shape[:2]
    h, w = r.shape[:2]
    px, py = int(round(x)) - ps, int(round(y)) - ps
    cx0, cy0, cx1, cy1 = max(0, px), max(0, py), min(W, px + w), min(H, py + h)
    if cx1 > cx0 and cy1 > cy0:
        part = r[cy0 - py:cy1 - py, cx0 - px:cx1 - px]
        under = canvas[cy0:cy1, cx0:cx1]
        isbg = (np.abs(part - BG).max(axis=2) <= 0.5)[..., None]      # a cut-out's corners are backdrop: never
        canvas[cy0:cy1, cx0:cx1] = np.where(isbg, under, part)       # paint them over a thing already placed
    return px + ps, py + ps, px + w - ps, py + h - ps


def blank(w, h):
    c = np.empty((h, w, 3), np.float32)
    c[:] = BG
    return c


def save(canvas, folder, name):
    d = os.path.join(DST, folder)
    os.makedirs(d, exist_ok=True)
    img = np.clip(np.rint(canvas), 0, 255).astype(np.uint8)
    # 4:4:4: the pictures are orange on near-black, the one case where halved chroma shows as a dirty edge
    cv2.imwrite(os.path.join(d, name + '.jpg'), img,
                [cv2.IMWRITE_JPEG_QUALITY, 88, cv2.IMWRITE_JPEG_OPTIMIZE, 1, cv2.IMWRITE_JPEG_PROGRESSIVE, 1,
                 cv2.IMWRITE_JPEG_SAMPLING_FACTOR, cv2.IMWRITE_JPEG_SAMPLING_FACTOR_444])
    cv2.imwrite(os.path.join(d, name + '.webp'), img, [cv2.IMWRITE_WEBP_QUALITY, 84])


ROWS = []
def report(name, folder, canvas, boxes):
    H, W = canvas.shape[:2]
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    ROWS.append('%-26s %-8s %4dx%-4d subject x %.3f-%.3f  y %.3f-%.3f'
                % (name, folder, W, H, max(0, x0) / W, min(W, x1) / W, max(0, y0) / H, min(H, y1) / H))


def row(canvas, things, s, end_x, bottom_y, gap, rtl):
    """A row of things, bottom-aligned on bottom_y, packed against the END edge end_x (the right edge, or the
    left edge when rtl), in the order given from the END inwards. Returns their boxes."""
    boxes, x = [], end_x
    for t in things:
        w, h = size(t)
        w, h = w * s, h * s
        left = x if rtl else x - w
        boxes.append(paste(canvas, t, s, left, bottom_y - h))
        x = x + w + gap if rtl else x - w - gap
    return boxes


# ------------------------------------------------------------------------------------------------ the layouts
TILE = {'desktop': (1216, 706), 'mobile': (900, 570)}
BAND = {'desktop': (1920, 194), 'mobile': (900, 378)}
EDGE = {'desktop': 0.045, 'mobile': 0.022}          # the gap between a subject and the END edge, share of the width

# People: head-room above the hair, share of the height. The figure runs from there to the bottom edge.
HEAD = {'desktop': 0.105, 'mobile': 0.10}
PEOPLE_EDGE = {'desktop': 0.055, 'mobile': 0.05}


def people(name):
    pic, mask, _ = clean(name)
    fig = cutout(pic, mask, np.ones_like(mask))
    fw, fh = size(fig)
    for folder, (W, H) in TILE.items():
        head = HEAD[folder] * H
        s = (H - head) / fh
        edge = PEOPLE_EDGE[folder] * W
        for suffix, x in (('', W - edge - fw * s), ('-rtl', edge)):
            c = blank(W, H)
            b = paste(c, fig, s, x, head)
            save(c, folder, 'art-' + name + suffix)
            report('art-' + name + suffix, folder, c, [b])


def accessories():
    pic, mask, _ = clean('accessories')
    n, lab, stats, _ = cv2.connectedComponentsWithStats(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)), connectivity=8)
    comps = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] > 4000]
    if len(comps) != 5:
        raise SystemExit('the flat-lay should hold 5 separate things, found %d' % len(comps))
    by_w = sorted(comps, key=lambda i: -stats[i, cv2.CC_STAT_WIDTH])
    duffel = by_w[0]                                                   # the widest
    bottle = by_w[-1]                                                  # the narrowest
    rest = [i for i in comps if i not in (duffel, bottle)]
    backpack = max(rest, key=lambda i: stats[i, cv2.CC_STAT_HEIGHT])   # the tallest of the other three
    rest = [i for i in rest if i != backpack]
    cap = min(rest, key=lambda i: stats[i, cv2.CC_STAT_TOP])           # the cap lies above the socks
    socks = [i for i in rest if i != cap][0]
    T = {k: cutout(pic, mask, (lab == i).astype(np.uint8)) for k, i in
         dict(duffel=duffel, bottle=bottle, backpack=backpack, cap=cap, socks=socks).items()}

    # desktop: two rows in the upper END part. Top row the small kit (it holds the white things: nothing is
    # under them but backdrop at any width), bottom row the two bags.
    W, H = TILE['desktop']
    s, gap, row_gap = 0.345, 26, 20
    bottom2 = 0.635 * H                                                # the bags stand on row 63.5%
    bottom1 = bottom2 - size(T['backpack'])[1] * s - row_gap
    for suffix, rtl in (('', False), ('-rtl', True)):
        c = blank(W, H)
        end = EDGE['desktop'] * W if rtl else W - EDGE['desktop'] * W
        b = row(c, [T['duffel'], T['backpack']], s, end, bottom2, gap, rtl)
        b += row(c, [T['socks'], T['bottle'], T['cap']], s, end, bottom1, gap + 14, rtl)
        save(c, 'desktop', 'art-accessories-v2' + suffix)
        report('art-accessories-v2' + suffix, 'desktop', c, b)

    # mobile: the cap over the duffel in the top END corner
    W, H = TILE['mobile']
    dw, dh = size(T['duffel'])
    cw, ch = size(T['cap'])
    sd = 0.24 * W / dw                                                 # the duffel is 24% of the width
    sc = sd * 1.42                                                     # the cap a little larger than life beside it
    for suffix, rtl in (('', False), ('-rtl', True)):
        c = blank(W, H)
        end = EDGE['mobile'] * W if rtl else W - EDGE['mobile'] * W
        b = row(c, [T['duffel']], sd, end, 0.58 * H, 0, rtl)
        mid = (b[0][0] + b[0][2]) / 2
        b.append(paste(c, T['cap'], sc, mid - cw * sc / 2, b[0][1] - 14 - ch * sc))
        save(c, 'mobile', 'art-accessories-v2' + suffix)
        report('art-accessories-v2' + suffix, 'mobile', c, b)
    return T


def outlet():
    pic, mask, raw = clean('outlet')
    # Four things stand side by side and touch: three stacks and the boxes. Between two of them the master
    # has a dark seam; the cut follows it row by row (the darkest pixel near the seam, median-smoothed).
    grey = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY).astype(np.float32)
    cols = mask.sum(axis=0).astype(np.float32)
    xs = np.where(cols > 0)[0]
    x0, x1 = xs.min(), xs.max()
    def median(v, k):
        vp = np.pad(v, k // 2, mode='edge')
        return np.array([np.median(vp[i:i + k]) for i in range(len(v))], np.float32)
    def seam(guess):
        lo, hi = guess - 26, guess + 26
        return median(grey[:, lo:hi].argmin(axis=1).astype(np.float32) + lo, 41)
    # the seams are where the column profile of the row band through the stacks dips: 3 dips
    band = mask[int(mask.shape[0] * 0.45):int(mask.shape[0] * 0.75)].sum(axis=0).astype(np.float32)
    smooth = np.convolve(band, np.ones(9) / 9, mode='same')
    w = x1 - x0
    guesses = []
    for lo, hi in ((0.20, 0.36), (0.48, 0.62), (0.72, 0.84)):
        a, b = int(x0 + lo * w), int(x0 + hi * w)
        guesses.append(a + int(np.argmin(smooth[a:b])))
    paths = [seam(g) for g in guesses]
    X = np.arange(mask.shape[1], dtype=np.float32)[None, :]
    left_of = [X < p[:, None] for p in paths]
    parts = [left_of[0], (~left_of[0]) & left_of[1], (~left_of[1]) & left_of[2], ~left_of[2]]
    T = [cutout(pic, mask, p.astype(np.uint8)) for p in parts]        # stack, hooded stack + tag, white stack, boxes
    hood, boxes = T[1], T[3]

    # desktop: the hooded stack with its tag and the two boxes, standing on row 62%
    W, H = TILE['desktop']
    s = 0.46 * H / size(hood)[1]
    for suffix, rtl in (('', False), ('-rtl', True)):
        c = blank(W, H)
        end = EDGE['desktop'] * W if rtl else W - EDGE['desktop'] * W
        b = row(c, [boxes, hood], s, end, 0.62 * H, 6, rtl)
        save(c, 'desktop', 'art-outlet' + suffix)
        report('art-outlet' + suffix, 'desktop', c, b)

    # mobile: the hooded stack with its tag in the top END corner
    W, H = TILE['mobile']
    s = 0.485 * H / size(hood)[1]
    for suffix, rtl in (('', False), ('-rtl', True)):
        c = blank(W, H)
        end = EDGE['mobile'] * W if rtl else W - EDGE['mobile'] * W
        b = row(c, [hood], s, end, 0.58 * H, 0, rtl)
        save(c, 'mobile', 'art-outlet' + suffix)
        report('art-outlet' + suffix, 'mobile', c, b)
    return guesses


def band(T):
    """The "Sporta features" band: things of the flat-lay at the two ends, the middle left to the words. One
    picture for both languages (the words are centred), under the band's own even 60% wash."""
    W, H = BAND['desktop']                     # 1920 x 194, drawn 1232 x 124
    c = blank(W, H)
    s = 150.0 / size(T['duffel'])[1]
    base = H / 2
    b = []
    x = 64
    for k in ('cap', 'duffel'):
        w, h = size(T[k])
        b.append(paste(c, T[k], s, x, base - h * s / 2))
        x += w * s + 44
    x = W - 64
    for k in ('backpack', 'socks'):
        w, h = size(T[k])
        sk = min(s, 168.0 / h)
        x -= w * sk
        b.append(paste(c, T[k], sk, x, base - h * sk / 2))
        x -= 44
    save(c, 'desktop', 'infobar')
    report('infobar', 'desktop', c, b)

    W, H = BAND['mobile']                      # 900 x 378, drawn 358 x 150: the words fill the middle, so two
    c = blank(W, H)                            # things look in from opposite corners and are cut by the edges
    cw, ch = size(T['cap'])
    dw, dh = size(T['duffel'])
    sc, sd = 250.0 / ch, 250.0 / dh
    b = [paste(c, T['cap'], sc, -0.40 * cw * sc, -0.42 * ch * sc),
         paste(c, T['duffel'], sd, W - 0.60 * dw * sd, H - 0.56 * dh * sd)]
    save(c, 'mobile', 'infobar')
    report('infobar', 'mobile', c, b)


if __name__ == '__main__':
    people('men')
    people('women')
    things = accessories()
    seams = outlet()
    band(things)
    print('\n'.join(ROWS))
    print('outlet seams near x = %s' % seams)
