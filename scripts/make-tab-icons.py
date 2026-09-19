#!/usr/bin/env python3
"""Draws the bottom-tab icons for the Sporta app.

   python3 scripts/make-tab-icons.py

WHY A SCRIPT AND NOT FOUR PNG FILES

The tabs render their icons in template mode: the platform throws the colour
away and keeps only the alpha, tinting the shape itself. So these files are
masks, not pictures, and a mask is much better kept as the geometry that
produced it — at three scale factors, in a brand where the tab bar is the one
piece of chrome on every screen. Redrawing a 32px house by hand because the
tab bar grew is not work anybody should do twice.

No Pillow in this toolchain, so the rasteriser is here: signed distance
functions sampled 3x3 per pixel for antialiasing, packed into a PNG by zlib.
It is about sixty lines and it removes a binary dependency from the build.
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'images' / 'tabIcons'
BASE = 32                      # @1x, in points — @2x and @3x follow
SS = 3                         # supersamples per axis


def png(path, w, h, alpha):
    """Greyscale-white RGBA, since template rendering keeps only the alpha."""
    raw = bytearray()
    for y in range(h):
        raw.append(0)          # filter: none
        for x in range(w):
            a = max(0, min(255, int(round(alpha[y][x] * 255))))
            raw += bytes((255, 255, 255, a))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    path.write_bytes(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b''))


# --- signed distance helpers, all in 0..1 icon space -----------------------
def rrect(p, cx, cy, hw, hh, r):
    dx, dy = abs(p[0] - cx) - (hw - r), abs(p[1] - cy) - (hh - r)
    return math.hypot(max(dx, 0), max(dy, 0)) + min(max(dx, dy), 0) - r


def circle(p, cx, cy, r):
    return math.hypot(p[0] - cx, p[1] - cy) - r


def segment(p, ax, ay, bx, by, r):
    px, py = p[0] - ax, p[1] - ay
    bax, bay = bx - ax, by - ay
    t = 0.0 if bax == bay == 0 else max(0.0, min(1.0, (px * bax + py * bay) / (bax * bax + bay * bay)))
    return math.hypot(px - bax * t, py - bay * t) - r


def ring(p, cx, cy, r, w):
    return abs(circle(p, cx, cy, r)) - w


def triangle(p, ax, ay, bx, by, cx, cy):
    """Filled triangle: inside where all three edge cross-products agree."""
    def side(x1, y1, x2, y2):
        return (x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1)
    s = (side(ax, ay, bx, by), side(bx, by, cx, cy), side(cx, cy, ax, ay))
    return -1.0 if all(v >= 0 for v in s) or all(v <= 0 for v in s) else 1.0


# --- the four icons --------------------------------------------------------
def home(p):
    roof = triangle(p, 0.50, 0.14, 0.10, 0.48, 0.90, 0.48)
    walls = rrect(p, 0.50, 0.66, 0.30, 0.22, 0.06)
    door = rrect(p, 0.50, 0.74, 0.10, 0.16, 0.04)
    body = min(roof, walls)
    return max(body, -door)


def shop(p):
    """A shopping bag: body plus the handle standing above it."""
    body = rrect(p, 0.50, 0.62, 0.32, 0.26, 0.08)
    hollow = rrect(p, 0.50, 0.62, 0.24, 0.18, 0.05)
    handle = ring(p, 0.50, 0.38, 0.15, 0.045)
    handle = max(handle, p[1] - 0.38)          # upper half only
    return min(max(body, -hollow), handle)


def cart(p):
    basket = min(
        segment(p, 0.24, 0.30, 0.82, 0.30, 0.05),   # rim
        segment(p, 0.27, 0.32, 0.36, 0.56, 0.05),   # left wall
        segment(p, 0.79, 0.32, 0.70, 0.56, 0.05),   # right wall
        segment(p, 0.34, 0.56, 0.72, 0.56, 0.05))   # floor
    handle = min(segment(p, 0.06, 0.16, 0.18, 0.16, 0.05),
                 segment(p, 0.18, 0.16, 0.26, 0.34, 0.05))
    wheels = min(circle(p, 0.40, 0.78, 0.075), circle(p, 0.68, 0.78, 0.075))
    return min(basket, handle, wheels)


def account(p):
    head = circle(p, 0.50, 0.34, 0.17)
    shoulders = ring(p, 0.50, 0.92, 0.30, 0.075)
    shoulders = max(shoulders, p[1] - 0.92)          # upper half only
    return min(head, shoulders)


ICONS = {'home': home, 'shop': shop, 'cart': cart, 'account': account}


def render(fn, size):
    px = 1.0 / size
    grid = []
    for y in range(size):
        row = []
        for x in range(size):
            hits = 0
            for sy in range(SS):
                for sx in range(SS):
                    p = ((x + (sx + 0.5) / SS) * px, (y + (sy + 0.5) / SS) * px)
                    if fn(p) <= 0:
                        hits += 1
            row.append(hits / (SS * SS))
        grid.append(row)
    return grid


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in ICONS.items():
        for scale, suffix in ((1, ''), (2, '@2x'), (3, '@3x')):
            size = BASE * scale
            png(OUT / f'{name}{suffix}.png', size, size, render(fn, size))
            print(f'  {name}{suffix}.png  {size}x{size}')
