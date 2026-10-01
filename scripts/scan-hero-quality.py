#!/usr/bin/env python3
"""Scan every hero image for blur and for pixelation / compression blockiness. READ-ONLY.

    python3 scripts/scan-hero-quality.py [--heat DIR]

For each image (the web hero art, the placeholder frames and the app's banners):
  * SHARPNESS per 64px tile: variance of a Laplacian on the luminance, at a fixed analysis width of 1600px
    so a 3200px master and a 1600px one are compared fairly. A tile that has detail (not flat studio
    backdrop) and a low value is blurred. Flat tiles are skipped: a plain wall is not blur.
  * UPSCALE SIGNATURE: share of spectral energy above half of Nyquist. An image enlarged from a smaller
    one has almost none there, however many pixels it claims.
  * BLOCKINESS: how much brighter the 8x8 (and 16x16) grid boundaries' pixel steps are than the steps
    inside the blocks. >1.15 means visible compression blocks; ~1.0 means none.
Prints one line per image and the worst tiles, and (with --heat) writes a heat-map PNG per image.
"""
import os, sys, glob
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'sporta-site')
PATTERNS = ['assets/hero/*.webp', 'public_html/hero/desktop/*.webp', 'public_html/hero/mobile/*.webp', 'assets/hero-originals/*.webp', 'assets/hero/*.jpg', 'assets/hero/*.png']
ANALYSE_W = 1600
TILE = 64

def lum(im):
    return np.asarray(im.convert('L'), dtype=np.float32)

def lap_var(g):
    l = g[1:-1, 1:-1] * 4 - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return l

def hf_share(g):
    h, w = g.shape
    win = np.outer(np.hanning(h), np.hanning(w)).astype(np.float32)
    f = np.abs(np.fft.fftshift(np.fft.fft2((g - g.mean()) * win))) ** 2
    yy, xx = np.ogrid[:h, :w]
    r = np.sqrt(((yy - h / 2) / (h / 2)) ** 2 + ((xx - w / 2) / (w / 2)) ** 2)
    tot = f.sum() or 1.0
    return float(f[r > 0.5].sum() / tot), float(f[r > 0.75].sum() / tot)

def blockiness(g, n=8):
    dx = np.abs(np.diff(g, axis=1)); dy = np.abs(np.diff(g, axis=0))
    cols = np.arange(dx.shape[1]); rows = np.arange(dy.shape[0])
    bx = dx[:, (cols % n) == (n - 1)].mean(); ix = dx[:, (cols % n) != (n - 1)].mean()
    by = dy[(rows % n) == (n - 1), :].mean(); iy = dy[(rows % n) != (n - 1), :].mean()
    return float(((bx + by) / 2) / max(1e-6, (ix + iy) / 2))

def scan(path, heat_dir):
    im = Image.open(path)
    nat = im.size
    a = im.convert('RGB')
    if a.width != ANALYSE_W:
        a = a.resize((ANALYSE_W, round(a.height * ANALYSE_W / a.width)), Image.LANCZOS)
    g = lum(a)
    L = lap_var(g)
    H, W = L.shape
    tiles = []
    for y in range(0, H - TILE, TILE):
        for x in range(0, W - TILE, TILE):
            t = g[y:y + TILE, x:x + TILE]
            if t.std() < 6:            # flat backdrop, not a blur
                continue
            tiles.append((float(L[y:y + TILE, x:x + TILE].var()), x, y))
    sharp = np.array([t[0] for t in tiles]) if tiles else np.array([0.0])
    med, p10 = float(np.median(sharp)), float(np.percentile(sharp, 10))
    hf50, hf75 = hf_share(g[: g.shape[0] // 64 * 64, : g.shape[1] // 64 * 64][::2, ::2])
    # blockiness at the file's NATIVE resolution: that is where its codec grid lives
    blk = blockiness(lum(im.convert('RGB')))
    verdict = []
    if med < 60: verdict.append('BLURRY')
    if hf50 < 0.004: verdict.append('UPSCALED-LOOK')
    if blk > 1.12: verdict.append('BLOCKY')
    worst = sorted(tiles)[:3]
    print(f"{os.path.relpath(path, ROOT):52s} {nat[0]}x{nat[1]:<5} sharp med={med:7.1f} p10={p10:6.1f} hf>.5={hf50*100:5.2f}% block={blk:4.2f}  {' '.join(verdict) or 'ok'}")
    if heat_dir:
        os.makedirs(heat_dir, exist_ok=True)
        hm = np.zeros((H // TILE + 1, W // TILE + 1), np.uint8)
        for v, x, y in tiles: hm[y // TILE, x // TILE] = int(np.clip(v / max(med, 1) * 128, 1, 255))
        out = Image.fromarray(hm).resize((hm.shape[1] * 16, hm.shape[0] * 16), Image.NEAREST)
        out.save(os.path.join(heat_dir, os.path.basename(path) + '.heat.png'))
    return verdict, worst

heat = sys.argv[sys.argv.index('--heat') + 1] if '--heat' in sys.argv else None
seen = set()
bad = 0
for pat in PATTERNS:
    for f in sorted(glob.glob(os.path.join(ROOT, pat))):
        if f in seen: continue
        seen.add(f)
        v, _ = scan(f, heat)
        bad += bool(v)
print(f"\n{len(seen)} images, {bad} flagged")
