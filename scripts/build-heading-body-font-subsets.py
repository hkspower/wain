#!/usr/bin/env python3
"""Build the self-hosted Anton (headings) and IBM Plex Sans (Latin body)
   subsets for the 2026-09 font swap.

   pip install fonttools brotli
   python3 scripts/build-heading-body-font-subsets.py /path/to/scratch/with/source/ttfs

WHY IT EXISTS. The owner approved swapping Alexandria's display role for
Anton (bold condensed display, OFL) and giving the existing IBM Plex Sans
Arabic a matching Latin sibling, IBM Plex Sans (OFL), for body text — see
CLAUDE.md's font-face section for why a subset gets BUILT rather than the
bundle's declarations edited by hand, and why the range must come from one
place.

ONE HOME FOR THE LATIN RANGE. `build-plex-subsets.py` already carries the
lesson that a unicode-range hand-copied into a script drifts from the
stylesheet that declares it. Rather than repeating the Latin range here, it
is read out of the BUNDLE's own existing `plex-400-latin` @font-face rule —
the same range IBM Plex Sans Arabic's own Latin fallback already uses — so
the new families cover exactly the same Latin set as everything already
shipped, and a future change to that range is picked up by re-running this
rather than by editing two files.

SOURCES (both OFL 1.1, verified against the OFL.txt each ships with):
  - Anton:         google/fonts ofl/anton/Anton-Regular.ttf
  - IBM Plex Sans:  google/fonts ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf
                    (variable; instanced to static 400/600/700 at wdth=100
                    before subsetting, to match the weight set already
                    shipped for IBM Plex Sans Arabic)

Anton ships one weight only (400) — it is a display face by design, not a
weight family, so no other instance is built for it.
"""

import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / 'sporta-site' / 'public_html' / 'assets'
FONTS = ROOT / 'sporta-site' / 'public_html' / 'fonts'


def latin_range() -> str:
    css = ''
    for f in CSS.glob('index-*.css'):
        css += f.read_text(encoding='utf-8')
    if not css:
        sys.exit('no built stylesheet found in ' + str(CSS))
    m = re.search(
        r"@font-face\{[^}]*plex-400-latin\.woff2[^}]*unicode-range:([^;}]+)",
        css,
    )
    if not m:
        sys.exit('could not find the plex-400-latin unicode-range in the bundle')
    return m.group(1).strip()


def expand(ranges: str) -> list[int]:
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
            lo_s, hi_s = item.split('-')
            points.extend(range(int(lo_s, 16), int(hi_s, 16) + 1))
        else:
            points.append(int(item, 16))
    return points


def build_static(src: Path, out: Path, unicodes: list[int]) -> None:
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.desubroutinize = True
    opts.recommended_glyphs = True
    font = TTFont(str(src))
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.save(str(out))
    print(f'wrote {out} ({out.stat().st_size} bytes)')


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(f'usage: {sys.argv[0]} /path/to/source/ttfs')
    src_dir = Path(sys.argv[1])
    unicodes = expand(latin_range())
    FONTS.mkdir(parents=True, exist_ok=True)

    anton_src = src_dir / 'Anton-Regular.ttf'
    if not anton_src.exists():
        sys.exit(f'missing {anton_src}')
    build_static(anton_src, FONTS / 'anton-400-latin.woff2', unicodes)

    plex_sans_var = src_dir / 'IBMPlexSans[wdth,wght].ttf'
    if not plex_sans_var.exists():
        sys.exit(f'missing {plex_sans_var}')
    for weight in (400, 600, 700):
        f = TTFont(str(plex_sans_var))
        instantiateVariableFont(f, {'wght': weight, 'wdth': 100}, inplace=True)
        tmp = src_dir / f'IBMPlexSans-{weight}-instance.ttf'
        f.save(str(tmp))
        build_static(tmp, FONTS / f'ibmplexsans-{weight}-latin.woff2', unicodes)


if __name__ == '__main__':
    main()
