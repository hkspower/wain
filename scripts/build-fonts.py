#!/usr/bin/env python3
"""Turns the website's webfonts into fonts the native app can load.

   pip install fonttools brotli
   python3 scripts/build-fonts.py

WHY THIS IS NOT A COPY. The storefront ships .woff2, which is a web format:
expo-font loads .ttf and .otf and nothing else, so a native build cannot use
those files at all. They are also SUBSET — Arabic and Latin glyphs in separate
files, which a browser stitches back together with a font-family list. React
Native has no such fallback chain: it takes one family per style, so a subset
missing Latin renders every English word as tofu.

So each weight is decompressed and its two subsets are MERGED back into one
font that covers both scripts, which is what the app then loads.

The result is the same typeface the website uses, so a customer who has seen
one does not meet different letterforms in the other: Alexandria for display,
IBM Plex Sans Arabic for everything else.
"""

import sys
from pathlib import Path

from fontTools import varLib
from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = Path(__file__).resolve().parent.parent / 'sporta-site' / 'public_html' / 'fonts'
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'fonts'

# (output name, [subset files], weight to pin a variable font at)
#
# Alexandria ships as a VARIABLE font, and two variable fonts cannot be merged:
# fontTools has no rule for combining their variation stores, and says so. It is
# pinned to a single weight first, which is all the app asks of it — a display
# face used at one weight, for headings.
FAMILIES = [
    ('Alexandria', ['alexandria-var-latin.woff2', 'alexandria-var-arabic.woff2'], 700),
    ('Plex-400', ['plex-400-latin.woff2', 'plex-400-arabic.woff2'], None),
    ('Plex-600', ['plex-600-latin.woff2', 'plex-600-arabic.woff2'], None),
    ('Plex-700', ['plex-700-latin.woff2', 'plex-700-arabic.woff2'], None),
]


def to_ttf(woff2: Path, tmp: Path, weight: int | None) -> Path:
    font = TTFont(woff2)          # fontTools reads woff2 directly, given brotli
    font.flavor = None            # drop the web compression
    if weight is not None and 'fvar' in font:
        font = instancer.instantiateVariableFont(font, {'wght': weight}, inplace=True)
    out = tmp / (woff2.stem + '.ttf')
    font.save(out)
    return out


def main() -> int:
    if not SRC.exists():
        print(f'no fonts at {SRC} — the storefront package is not restored', file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT / '.tmp'
    tmp.mkdir(exist_ok=True)

    for name, parts, weight in FAMILIES:
        ttfs = [to_ttf(SRC / p, tmp, weight) for p in parts]
        target = OUT / f'{name}.ttf'
        if len(ttfs) == 1:
            TTFont(ttfs[0]).save(target)
        else:
            # Merge, then rename the result: the merged font otherwise keeps the
            # first subset's name, and two files claiming to be the same family
            # is how a phone renders the wrong weight and nobody can see why.
            merged = Merger().merge([str(f) for f in ttfs])
            for record in merged['name'].names:
                if record.nameID in (1, 4, 16):
                    record.string = name
            merged.save(target)
        kb = target.stat().st_size // 1024
        chars = len(TTFont(target).getBestCmap())
        print(f'  {target.name:16s} {kb:4d} kB  {chars} glyphs mapped')

    for f in tmp.iterdir():
        f.unlink()
    tmp.rmdir()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
