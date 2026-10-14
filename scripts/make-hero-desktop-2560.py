"""The five neutral hero slides' DESKTOP pictures at 2560px wide — 2026-10-14.

    CWEBP=/path/to/cwebp DWEBP=/path/to/dwebp python3 -I scripts/make-hero-desktop-2560.py

Every desktop and tablet was sent the 3200x1270 master (crossfit alone 328 kB), and the masters carry
almost no detail above ~2240px: they were generated at 3840x1524 and stored at q88. 2560px is exactly
what a 1280px window at 2x draws; wider windows already upscaled the 3200 file, so nothing visible is
lost. Each master is decoded, resized with Lanczos to 2560x1016 (the masters' own 2.52:1) and encoded
at quality 86 with sharp YUV (sharper colour edges, no size cost worth naming), metadata stripped.

Made with libwebp 1.4.0 (cwebp/dwebp from the official release); another version may produce
different bytes, and publish-hero-desktop-2560.php verifies the bytes it writes by sha256, so a
rebuild that changes them must update that publisher's list too. It prints each file's sha256.

The phone pictures were NOT re-encoded: the same treatment at q90 with sharp YUV cost +6% to +10%
bytes on all five (measured), over the +5% that was the condition for it, and a lossy q85 source
cannot shed banding it already carries anyway.
"""
import hashlib, os, subprocess, sys, tempfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, '..', 'sporta-site', 'assets', 'hero')
CWEBP, DWEBP = os.environ.get('CWEBP'), os.environ.get('DWEBP')
if not CWEBP or not DWEBP:
    sys.exit('set CWEBP and DWEBP to libwebp 1.4.0 binaries')

for name in ('crossfit', 'features', 'runner', 'activewear', 'training'):
    src = os.path.join(ART, f'{name}-neutral-desktop.webp')
    out = os.path.join(ART, f'{name}-neutral-desktop-2560.webp')
    with tempfile.TemporaryDirectory() as tmp:
        full, small = os.path.join(tmp, 'full.png'), os.path.join(tmp, 'small.png')
        subprocess.run([DWEBP, '-quiet', src, '-o', full], check=True)
        im = Image.open(full).convert('RGB')
        if im.size != (3200, 1270):
            sys.exit(f'{src} is {im.size}, not the 3200x1270 master')
        im.resize((2560, 1016), Image.LANCZOS).save(small)
        subprocess.run([CWEBP, '-quiet', '-q', '86', '-m', '6', '-sharp_yuv', '-metadata', 'none', small, '-o', out], check=True)
    b = open(out, 'rb').read()
    print(f'{name:<11} {os.path.getsize(src):>7} -> {len(b):>7} bytes  sha256 {hashlib.sha256(b).hexdigest()}')
