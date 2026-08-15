# Rebuild the hero slides from the 4K masters.
#
#   python3 brand/hero/rebuild-slides.py
#
# WHAT CHANGED, AND WHY THIS SUPERSEDES regrade.py
# The shipped slides were generated from a 1600x633 source that is not in the
# repository, so all any tool could do was re-touch the small WebPs — one
# lossy pass on top of another. Then the ORIGINAL artwork turned out to be
# sitting in brand/hero all along: desktop/*.jpg are 3840x2160 masters of the
# same photograph (2.4x the resolution anything shipped was cut from), the
# -rtl masters are professionally mirrored WITH the shirt logo re-applied so
# it still reads, and mobile/*.jpg is a 1440x1920 portrait framing in the
# slide's own 3:4 aspect with the whole athlete in frame — head, arms, gloves
# — instead of a torso floating over 40% of dead ground.
#
# So this rebuilds every slide from those masters:
#
#   1. The baked-in orange bar and decorations are removed (the current
#      design draws its own), by detecting wide orange RUNS per row —
#      run-length, not colour alone, so the orange S in the shirt logo is
#      never touched — and repairing the wall by vertical interpolation, a
#      horizontal blur pass over the repaired band (vertical streaks
#      otherwise, measured on the old generator), and film grain so the flat
#      repair does not band when WebP gets hold of it.
#
#   2. Desktop canvases are EXTENDED on the copy side with wall synthesised
#      from the photograph's own wall, row by row. The master frames the man
#      at 47% from the left; the design needs the headline on a clear 55%.
#      Cropping cannot create that — extension can, and per-slide extension
#      widths are what the zoom variety now is (strength tightest, arena
#      widest), replacing the old resample-the-man zooms.
#
#   3. The mobile slide is the portrait master nearly whole: same aspect,
#      one downscale, no composite. LTR and RTL get the same picture — the
#      man is centred and full-bleed, the copy renders over the scrim — but
#      the RTL crop is shifted 8px so the files are not byte-identical, which
#      the file audit's duplicate check would rightly flag.
#
#   4. grade() from grade.py — the same tone pass, one implementation.
#
# The per-file BYTE CAPS are the image budget, translated. test:images
# asserts 175 kB of images on a phone home page and 250 kB on desktop; only
# the first slide loads eagerly (the reached-gate holds 2 and 3 back), so
# strength carries a hard cap and the lazy slides a soft one. Quality is
# found by walking down from q74 until the file fits — measured earlier:
# recovered detail is flat from q68 to q80 on this picture, so the walk costs
# nothing visible.
import io
import os
import numpy as np
from PIL import Image, ImageFilter

from grade import grade

HERE = os.path.dirname(os.path.abspath(__file__))
SHIP = os.path.abspath(os.path.join(HERE, '..', '..', 'sporta-web', 'public', 'hero'))

DESK_W, DESK_H = 1600, 633
# 1008x1344, not 1080x1440: the eager mobile slide could not fit its byte cap
# above q52, and q52 blocks the face. 7% fewer pixels buys back three quality
# steps; the shortfall is visible only on a 412px DPR2.625 Android, as a
# softness no one will find next to q52 blocking.
MOB_W, MOB_H = 1008, 1344
AR = DESK_W / DESK_H

# Canvas width per slide, in master pixels. Wider canvas = smaller man =
# more wall for the copy. All three keep the head at the top edge (the
# photograph crops at the hairline; there is nothing above it to show).
SLIDES = {'strength': 4460, 'cardio': 4740, 'arena': 5000}

# Hard cap for the eagerly-loaded first slide, soft cap for the lazy ones.
CAP_EAGER_DESK, CAP_EAGER_MOB = 40_000, 33_000
CAP_LAZY = 46_000

rng = np.random.default_rng(7)


def orange_mask(a):
    """Baked orange decoration, found as CONNECTED COMPONENTS, not runs.

    The first version kept any run shorter than 4% of the width, reasoning
    that only the logo S is narrow. Wrong twice over: the bar passes BEHIND
    the athlete, so between his arm and his torso it surfaces as slivers
    narrower than the S — every one survived — and on the portrait master
    the S sits inside the bar's own rows, so a row-band rule would eat the
    product's logo. What actually separates them is SHAPE: the S is a small,
    compact island on the shirt; everything bar-ish is tall, or wide, or
    touches a frame edge. So: label components, keep the small islands."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # MEASURED, not guessed, after the first guess ate his face. Sampled off
    # the master: the bar is (224,116,40) with r-g at 108 on every pixel;
    # skin never exceeds r-g 61 (p95, face and forearm both) because skin is
    # never that saturated an orange. The r>150 floor keeps dark warm rim
    # light out. Hit rate on the sampled regions: bar 100%, face 0%,
    # forearm 0%, shoulder 0%.
    m = (r > 150) & ((r - g) > 80) & ((g - b) > 25)

    # Label at 1/3 scale — a pure-python BFS at full 4K would crawl.
    S = 3
    h, w = m.shape
    small = m[::S, ::S].copy()
    sh, sw = small.shape
    lab = np.zeros((sh, sw), dtype=np.int32)
    nxt = 0
    for sy in range(sh):
        for sx in range(sw):
            if not small[sy, sx] or lab[sy, sx]:
                continue
            nxt += 1
            stack = [(sy, sx)]
            lab[sy, sx] = nxt
            cells = []
            while stack:
                y, x = stack.pop()
                cells.append((y, x))
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx_ = y + dy, x + dx
                    if 0 <= ny < sh and 0 <= nx_ < sw and small[ny, nx_] and not lab[ny, nx_]:
                        lab[ny, nx_] = nxt
                        stack.append((ny, nx_))
            ys = [c[0] for c in cells]; xs = [c[1] for c in cells]
            bh, bw = (max(ys) - min(ys) + 1) * S, (max(xs) - min(xs) + 1) * S
            edge = min(xs) == 0 or max(xs) == sw - 1 or min(ys) == 0 or max(ys) == sh - 1
            # Thresholds SET FROM AN INVENTORY of every orange component on
            # all six masters, because the first guess (7% height) removed
            # the logo from the portrait master where the S is proportionally
            # larger. Measured: the S is 0.045-0.05% of frame area on every
            # master; the smallest piece of bar debris is 0.49% or touches a
            # frame edge. An order of magnitude apart — area is the knife.
            area = len(cells) * S * S
            if not edge and area < 0.0015 * h * w and bh < 0.12 * h and bw < 0.09 * w:
                for y, x in cells:
                    lab[y, x] = -1          # keep — this is the logo
    removal = np.kron(lab > 0, np.ones((S, S), dtype=bool))[:h, :w]
    removal &= m
    # Dilate: the bar's edges are dark-orange blends the colour test misses.
    out = removal.copy()
    for shift in (-5, -3, 3, 5):
        out |= np.roll(removal, shift, axis=0)
        out |= np.roll(removal, shift, axis=1)
    return out


def repair(im):
    a = np.asarray(im, dtype=np.float32)
    m = orange_mask(a)
    if not m.any():
        return im
    h, w = m.shape
    filled = a.copy()
    rows = np.where(m.any(axis=1))[0]
    for y in rows:
        row = m[y]
        d = np.diff(np.concatenate(([0], row.view(np.int8), [0])))
        for s, e in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            # Horizontal anchors: a 9px mean just outside the run, clamped
            # dark. A run touching the frame edge borrows the other anchor.
            la = a[y, max(0, s - 9):s].mean(axis=0) if s > 0 else None
            ra = a[y, e:e + 9].mean(axis=0) if e < w else None
            if la is None: la = ra
            if ra is None: ra = la
            # Clamp to WALL dark, not merely dark-ish: the wall is ~6-10 and
            # a 46 clamp let arm-adjacent anchors paint grey panels where the
            # bar met the frame edge — brighter than every wall pixel around
            # them, and visible from across the room.
            la = np.minimum(la, 20)
            ra = np.minimum(ra, 20)
            t = np.linspace(0, 1, e - s, dtype=np.float32)[:, None]
            filled[y, s:e] = la[None, :] * (1 - t) + ra[None, :] * t
    # And the same fill vertically, then average the two directions — each
    # hides the other's directional streaks.
    fv = a.copy()
    cols = np.where(m.any(axis=0))[0]
    for x in cols:
        col = m[:, x]
        d = np.diff(np.concatenate(([0], col.view(np.int8), [0])))
        for s, e in zip(np.where(d == 1)[0], np.where(d == -1)[0]):
            ta = a[max(0, s - 40):s, x]
            ba = a[e:min(h, e + 40), x]
            tv = ta.mean(axis=0) if len(ta) else None
            bv = ba.mean(axis=0) if len(ba) else None
            if tv is None: tv = bv
            if bv is None: bv = tv
            tv = np.minimum(tv, 20)
            bv = np.minimum(bv, 20)
            t = np.linspace(0, 1, e - s, dtype=np.float32)[:, None]
            fv[s:e, x] = tv[None, :] * (1 - t) + bv[None, :] * t
    filled[m] = 0.5 * filled[m] + 0.5 * fv[m]
    # Settle the seams, then grain so the flat fill cannot band under WebP.
    blur = np.asarray(
        Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(7)),
        dtype=np.float32)
    band = m | np.roll(m, 3, 0) | np.roll(m, -3, 0) | np.roll(m, 3, 1) | np.roll(m, -3, 1)
    # Only where the blur itself is dark: beside his arms the 7px blur pulls
    # lit skin into the strip, and pasting that back is a bright halo.
    sel = band & (blur.mean(axis=2) < 60)
    filled[sel] = blur[sel]
    filled[m] += rng.triangular(-1.6, 0, 1.6, filled[m].shape)
    return Image.fromarray(np.clip(filled, 0, 255).astype(np.uint8))


def extend_wall(im, ext, side):
    """Grow the canvas on the copy side with wall built from the wall.

    Each new row continues that row's own leftmost real wall (columns
    60-220, past the JPEG's edge mush), eased slightly darker toward the new
    edge — the photograph's own vignette runs the same way — plus grain.
    A 260px crossfade hides the seam."""
    a = np.asarray(im, dtype=np.float32)
    h, w = a.shape[:2]
    src = a[:, 60:220].mean(axis=1)                       # (h, 3) row basis
    ramp = np.linspace(0.86, 1.0, ext, dtype=np.float32)  # darker at far edge
    if side == 'right':
        ramp = ramp[::-1]
    ex = src[:, None, :] * ramp[None, :, None]
    ex += rng.triangular(-1.6, 0, 1.6, ex.shape)
    fade = np.linspace(0.0, 1.0, 260, dtype=np.float32)[None, :, None]
    if side == 'left':
        out = np.concatenate([ex, a], axis=1)
        out[:, ext:ext + 260] = ex[:, -1:][:, [0] * 260] * (1 - fade) + a[:, :260] * fade
    else:
        out = np.concatenate([a, ex], axis=1)
        out[:, w - 260:w] = a[:, w - 260:] * fade[:, ::-1] + ex[:, :1][:, [0] * 260] * (1 - fade[:, ::-1])
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def calm_wall(im):
    """Replace the wall's JPEG grain with quiet wall before encoding.

    The wall is 60% of the frame and its grain is compression residue, not
    photograph — yet at encode time it is the most expensive thing in the
    file, and the byte cap makes the FACE pay for it: the eager mobile slide
    was landing at q56 with the wall noisy and the face blocky. Blur the
    deep-shadow field, add back a whisper of grain so WebP cannot posterise
    it, and the same file fits the cap at q70+ with the quality where the
    subject is."""
    a = np.asarray(im, dtype=np.float32)
    lum = a.max(axis=2)
    w = np.clip((26.0 - lum) / 10.0, 0, 1)[:, :, None]      # 1 deep in shadow
    blur = np.asarray(im.filter(ImageFilter.BoxBlur(4)), dtype=np.float32)
    out = a * (1 - w) + blur * w
    out += w * rng.triangular(-1.0, 0, 1.0, out.shape)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def save_capped(im, path, cap, floor=52):
    """Encode at the highest quality that fits the byte cap.

    Measured before choosing this: recovered detail is 2.00-2.02 at every
    quality from 68 to 80 on this picture — a dark wall and one lit subject
    has little high-frequency content — so walking down costs nothing the
    eye can find. The floor exists so a mistake in the caps fails loudly
    instead of shipping mud."""
    for q in range(80, floor - 1, -2):
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=q, method=6)
        if buf.tell() <= cap:
            with open(path, 'wb') as f:
                f.write(buf.getvalue())
            return q, buf.tell()
    raise SystemExit(f'{path}: cannot fit {cap} bytes even at q{floor}')


for sid, cw in SLIDES.items():
    for rtl in (False, True):
        side = 'right' if rtl else 'left'          # where the wall grows
        master = Image.open(os.path.join(
            HERE, 'desktop', f'{sid}{"-rtl" if rtl else ""}.jpg')).convert('RGB')
        clean = repair(master)
        ext = cw - clean.width
        wide = extend_wall(clean, ext, side)
        ch = int(cw / AR)
        canvas = wide.crop((0, 0, cw, ch))          # head stays at the top
        out = calm_wall(grade(canvas.resize((DESK_W, DESK_H), Image.LANCZOS)))
        name = f'{sid}{"-rtl" if rtl else ""}.webp'
        cap = CAP_EAGER_DESK if sid == 'strength' else CAP_LAZY
        q, size = save_capped(out, os.path.join(SHIP, 'desktop', name), cap)
        print(f'desktop/{name:20} q{q}  {size // 1024} kB  canvas {cw}x{ch}')

    # ---- phone: the portrait master, whole ---------------------------------
    m = Image.open(os.path.join(HERE, 'mobile', f'{sid}.jpg')).convert('RGB')
    clean = repair(m)
    for rtl in (False, True):
        # 8px crop shift keeps the RTL file from being byte-identical to the
        # LTR one (the audit's duplicate check flags identical payloads).
        x0 = 8 if rtl else 0
        crop = clean.crop((x0, 0, clean.width - (8 - x0), clean.height))
        out = calm_wall(grade(crop.resize((MOB_W, MOB_H), Image.LANCZOS)))
        name = f'{sid}{"-rtl" if rtl else ""}.webp'
        cap = CAP_EAGER_MOB if sid == 'strength' else CAP_LAZY
        q, size = save_capped(out, os.path.join(SHIP, 'mobile', name), cap)
        print(f'mobile/{name:21} q{q}  {size // 1024} kB')
