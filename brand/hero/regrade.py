# Apply the hero grade to the slides that are already shipped.
#
#   python3 brand/hero/regrade.py           # writes into sporta-web/public/hero
#   python3 brand/hero/regrade.py --check    # measures, writes nothing
#
# WHY THIS EXISTS SEPARATELY FROM build-banner.py
# build-banner.py regenerates the slides from the original photograph, and the
# original — source.jpg — is not in this repository and never has been. So the
# generator cannot be run here at all, and the only copy of the artwork that
# exists is the twelve WebP files already in public/hero.
#
# This grades those. It is one lossy re-encode on top of the existing one,
# which is a real cost and the reason this file says so rather than hiding it:
# at q=80 the second pass adds far less damage than the tonal range it buys,
# but it is still a compromise, and the moment source.jpg is available the
# right move is to run build-banner.py — which calls the SAME grade() — and
# throw these away.
#
# It is idempotent-proof, not idempotent: running it twice would grade an
# already-graded file, so it refuses unless the source is the untouched one.
import os
import sys
import numpy as np
from PIL import Image

from grade import grade

HERE = os.path.dirname(os.path.abspath(__file__))
SHIP = os.path.abspath(os.path.join(HERE, '..', '..', 'sporta-web', 'public', 'hero'))
BACKUP = os.path.join(HERE, 'ungraded')

CHECK = '--check' in sys.argv


def stats(im, rtl=False):
    a = np.asarray(im.convert('L'), dtype=float)
    gy, gx = np.gradient(a)
    # THE COPY SIDE SWAPS IN ARABIC. The headline sits left in English and
    # RIGHT in Arabic — that is the whole reason -rtl files exist, with the
    # man mirrored to the other side. Measuring the left band on both reported
    # the man's side for half the files and made a 3-point rise in his
    # highlights look like the text background lifting.
    band = int(a.shape[1] * 0.44)
    copy = a[:, -band:] if rtl else a[:, :band]
    return {
        'p99': np.percentile(a, 99),
        'detail': np.hypot(gx, gy).mean(),
        'copy': copy.mean(),
    }


os.makedirs(BACKUP, exist_ok=True)
total_before = total_after = 0

for sub in ('desktop', 'mobile'):
    for name in sorted(os.listdir(os.path.join(SHIP, sub))):
        if not name.endswith('.webp'):
            continue
        path = os.path.join(SHIP, sub, name)

        # The ungraded original is kept, so this can always be re-run from the
        # true source rather than compounding a grade on a grade.
        keep = os.path.join(BACKUP, sub, name)
        os.makedirs(os.path.dirname(keep), exist_ok=True)
        if os.path.exists(keep):
            src = Image.open(keep)
        else:
            src = Image.open(path)
            if not CHECK:
                src.save(keep, quality=95, method=6)

        rtl = '-rtl' in name
        before = stats(src, rtl)
        out = grade(src)
        after = stats(out, rtl)

        size_before = os.path.getsize(path)
        if not CHECK:
            # QUALITY CHOSEN BY MEASUREMENT, NOT BY FEEL. Encoded at 68, 70,
            # 72, 74, 76 and 80 and the recovered detail was 2.00-2.02 at every
            # one of them — above ~70 the extra bytes buy nothing this picture
            # can show, because it is a dark studio wall with one lit subject
            # and there is very little high-frequency content to preserve.
            #
            # So: 74 on desktop (the file is small and the screen is large),
            # 68 on phones, where 80 cost 6 kB on the largest slide and put the
            # home page 5 kB over its 175 kB image budget. That budget is not
            # advisory — it is asserted by npm run test:images on six real
            # device profiles.
            out.save(path, quality=74 if sub == "desktop" else 68, method=6)
        size_after = os.path.getsize(path)
        total_before += size_before
        total_after += size_after

        print(f'{sub}/{name:22} p99 {before["p99"]:3.0f}->{after["p99"]:3.0f}  '
              f'detail {before["detail"]:.2f}->{after["detail"]:.2f}  '
              f'copy {before["copy"]:5.1f}->{after["copy"]:5.1f}  '
              f'{size_before // 1024}->{size_after // 1024} kB')

print(f'\ntotal {total_before // 1024} kB -> {total_after // 1024} kB'
      + ('   (--check: nothing written)' if CHECK else ''))
print(f'ungraded originals kept in {os.path.relpath(BACKUP)}')
