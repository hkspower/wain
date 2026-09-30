#!/usr/bin/env python3
"""Build the four IBM Plex Sans Arabic subsets the stylesheet asks for and the
   server does not have.

   pip install fonttools brotli
   python3 scripts/build-plex-subsets.py /path/to/ibm-plex-sans-arabic/fonts/complete/ttf

WHY IT EXISTS. `assets/index-TIUCmnwm.css` declares EIGHT @font-face rules for
this family — weights 400, 600 and 700, each split into an Arabic and a Latin
subset. Only the two 600 files were ever shipped. Measured 2026-09-09 against
the sandbox, which serves the same tree as the live server:

    plex-400-arabic  404      plex-600-arabic  200 45688
    plex-400-latin   404      plex-600-latin   200
    plex-700-arabic  404
    plex-700-latin   404

NOTHING IS VISIBLY BROKEN TODAY, and that is the trap. A browser fetches a
face only when some text actually uses that family at that weight, and no text
currently does at 400 or 700 — so `scripts/font-audit.mjs` passes, truthfully,
saying "every font the shop asks for actually answers". It is asking about the
faces the pages REQUEST, not the ones the stylesheet DECLARES. The first time
anybody sets `font-weight: 400` on a Plex element, the request 404s and the
text silently falls back to Arial mid-paragraph.

WHY BUILD RATHER THAN DELETE THE RULES. The rules live in a CONTENT-HASHED
file, `index-TIUCmnwm.css`, and `sw.js` caches hashed assets cache-first and
never re-asks — editing one in place would pin every returning visitor to
whichever copy they already hold, with no way out but a VERSION bump. The
bundle has no source here to rebuild from either. Supplying the four files is
the change that needs no cache rotation and no bundle.

HOW IT STAYS HONEST. The unicode-ranges are not typed in here; they are READ
from the stylesheet's own @font-face rules, so the subsets cover exactly what
the browser was told they cover. If the bundle is ever rebuilt with different
ranges, re-running this picks them up rather than quietly shipping the old set.

The source is IBM Plex Sans Arabic, OFL 1.1, from the IBM/plex release. Pass
the directory holding the complete TTFs; Regular becomes 400 and Bold becomes
700, which is what the shipped SemiBold file proves the 600 pair were made
from (its name table reads IBMPlexSansArabic-SemiBold, 1299 glyphs, 1000 upem).
"""

import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / 'sporta-site' / 'public_html' / 'assets'
FONTS = ROOT / 'sporta-site' / 'public_html' / 'fonts'

# output stem -> source TTF filename. 600 is deliberately absent: it is already
# shipped and correct, and rebuilding a file that works is a way to break one.
WANT = {
    'plex-400': 'IBMPlexSansArabic-Regular.ttf',
    'plex-700': 'IBMPlexSansArabic-Bold.ttf',
}


def font_face_ranges() -> dict[str, str]:
    """{'plex-400-arabic': 'U+6??,U+750-77F,…'} straight out of the built CSS."""
    css = ''
    for f in CSS.glob('index-*.css'):
        css += f.read_text(encoding='utf-8')
    if not css:
        sys.exit('no built stylesheet found in ' + str(CSS))

    out = {}
    for rule in re.finditer(r'@font-face\{[^}]*\}', css):
        block = rule.group(0)
        src = re.search(r'/fonts/(plex-\d{3}-(?:arabic|latin))\.woff2', block)
        rng = re.search(r'unicode-range:([^;}]+)', block)
        if src and rng:
            out[src.group(1)] = rng.group(1).strip()
    return out


def expand(ranges: str) -> list[int]:
    """The stylesheet's unicode-range, as a list of code points.

    fontTools' own parse_unicodes() cannot do this alone: it reads `U+750-77F`
    but throws on `U+6??`, and the wildcard form is what the Arabic rule
    actually uses (`U+6??` = the whole Arabic block). Rather than hand-copying
    the ranges into this file — which is how a subset silently stops matching
    the rule that describes it — the wildcards are expanded and everything
    else is handed to fontTools.
    """
    points: list[int] = []
    for item in ranges.replace('U+', '').replace('u+', '').split(','):
        item = item.strip()
        if not item:
            continue
        if '?' in item:
            lo = int(item.replace('?', '0'), 16)
            hi = int(item.replace('?', 'F'), 16)
            points.extend(range(lo, hi + 1))
        elif '-' in item:
            lo, hi = item.split('-', 1)
            points.extend(range(int(lo, 16), int(hi, 16) + 1))
        else:
            points.append(int(item, 16))
    return points


def build(src_ttf: Path, ranges: str, out: Path) -> None:
    unicodes = expand(ranges)

    font = TTFont(src_ttf)
    opts = subset.Options()
    opts.layout_features = ['*']       # Arabic is unreadable without its shaping
    opts.name_IDs = ['*']              # keep the name table: this is how the
    opts.name_legacy = True            # shipped 600 file identifies itself
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.drop_tables = []
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)

    font.flavor = 'woff2'
    font.save(out)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__.strip().splitlines()[2].strip())
    src_dir = Path(sys.argv[1])

    ranges = font_face_ranges()
    if not ranges:
        sys.exit('the stylesheet declares no plex-*.woff2 faces — nothing to build')

    made = []
    for stem, ttf in WANT.items():
        source = src_dir / ttf
        if not source.is_file():
            sys.exit('missing source: ' + str(source))
        for script in ('arabic', 'latin'):
            name = f'{stem}-{script}'
            if name not in ranges:
                print(f'-- {name}: the stylesheet does not declare it; skipped')
                continue
            out = FONTS / (name + '.woff2')
            build(source, ranges[name], out)
            made.append((name, out.stat().st_size))

    for name, size in made:
        print(f'ok   {name}.woff2  {size:,} bytes')

    # Against the file that was already right. A subset an order of magnitude
    # off the shipped one is a wrong unicode-range, not a lighter weight.
    ref = FONTS / 'plex-600-arabic.woff2'
    if ref.is_file():
        print(f'--   for comparison, plex-600-arabic.woff2 is {ref.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
