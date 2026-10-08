#!/usr/bin/env python3
"""The logo's Latin faces, subset for the site.

The dark theme (owner's approval, 2026-10-07) takes its type from the
English logo: Chakra Petch for the Latin half of a display line, JetBrains
Mono for figures, handles and the ">_" prompt. Arabic stays in Cairo, and
neither face has an Arabic glyph, so each subset carries Cairo's own Latin
unicode-range and Arabic in the same element falls through to Cairo.

The sources are the full OFL fonts in design/logo-en/fonts/ (the logo kit
outlines its letters from the same files, so the site and the logo cannot
drift apart). Subsetting is deterministic, so `--check` compares the bytes,
and it also proves every character the pages set in these faces is in the
subset: a missing "+" or "%" falls back to a system face while
getComputedStyle still names the webfont, and nothing else would notice.

Cairo's own Latin file, cairo-latin.woff2 (every figure and Latin letter on
the site), is cut here too, from the Google Fonts Latin subset of Cairo's
variable font (3.130, wght 200 to 1000, OFL) kept in design/fonts-src/ as
the site shipped it: until 2026-10-08 no generator owned
it, so nothing pinned its bytes. Its cmap is kept whole, and the run fails
if one character is lost.

Each face keeps only the layout features something on the site can reach.
JetBrains Mono's code ligatures (`calt`, 155 glyphs) and Cairo's fraction
glyphs (`frac`/`numr`/`dnom`) changed none of the strings the pages set:
every page and tab, rendered at 1440 and 390 with the old and new files
swapped by route, is pixel-identical. 38,284 B to 20,192 B, and 33,820 B to
31,604 B. Cutting the weight axis to the 400 to 800 the pages ask for was
tried and REFUSED: the instancer re-rounds the advance deltas, 44 Cairo
glyphs moved by a unit at 700, and a select on the console's customers tab
narrowed and pushed its buttons (14,612 pixels changed at 390).

    python3 design/site_fonts.py           # write almuhallab/fonts/*.woff2 + licences
    python3 design/site_fonts.py --check   # exit 1 if a file drifted or a glyph is missing
"""
import io
import pathlib
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "logo-en" / "fonts"
CAIRO_SRC = HERE / "fonts-src" / "Cairo-Latin-Variable.woff2"
OUT = HERE.parent / "almuhallab" / "fonts"

# Cairo's Latin range, so the three Latin files split the page the same way
RANGE = ("U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, "
         "U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD")
FEATURES = ["kern", "liga", "calt", "tnum", "lnum", "zero"]
# the mono sets figures, handles, file names and the prompt: no code ligature
# forms in any of them, and Chromium drops ligatures under letter-spacing
MONO_FEATURES = [f for f in FEATURES if f != "calt"]
FACES = [  # source, output, features
    (SRC / "ChakraPetch-SemiBold.ttf", "chakrapetch-600.woff2", FEATURES),
    (SRC / "ChakraPetch-Bold.ttf", "chakrapetch-700.woff2", FEATURES),
    (SRC / "JetBrainsMono-Variable.ttf", "jetbrainsmono-latin.woff2", MONO_FEATURES),
]
# Cairo's Latin: its own coverage, kerning and the variable font's rvrn; no
# fractions, which nothing on the site asks for. The weight axis stays whole.
CAIRO = (CAIRO_SRC, "cairo-latin.woff2", ["kern", "rvrn"])
LICENCES = [("OFL-ChakraPetch.txt", "LICENSE-ChakraPetch.txt"),
            ("OFL-JetBrainsMono.txt", "LICENSE-JetBrainsMono.txt")]
# every character the pages set in these faces: figures, KWD amounts, the
# phone, the handle and the address, the prompt, the Latin display lines
MUST_COVER = ("0123456789+-%.,:/@_>&()·" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
              + "abcdefghijklmnopqrstuvwxyz" + " ")


def build(src, features, unicodes=None):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = features
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    font = TTFont(src, recalcTimestamp=False)   # a save stamps the current time otherwise
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=unicodes if unicodes is not None
                 else subset.parse_unicodes(RANGE.replace(" ", "")))
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)
    return buf.getvalue()


def missing(data):
    cmap = TTFont(io.BytesIO(data)).getBestCmap()
    return [c for c in MUST_COVER if ord(c) not in cmap]


def main():
    want = {OUT / out: build(src, feats) for src, out, feats in FACES}
    src, out, feats = CAIRO
    whole = set(TTFont(src).getBestCmap())
    want[OUT / out] = build(src, feats, unicodes=whole)
    lost = whole - set(TTFont(io.BytesIO(want[OUT / out])).getBestCmap())
    if lost:
        sys.exit(f"{out} would lose characters: {sorted(map(hex, lost))[:8]}")
    lic = {OUT / out: (SRC / src).read_bytes() for src, out in LICENCES}
    gaps = {p.name: missing(d) for p, d in want.items() if missing(d)}
    if "--check" in sys.argv:
        stale = [p.name for p, d in {**want, **lic}.items() if not p.exists() or p.read_bytes() != d]
        if stale or gaps:
            sys.exit(f"site fonts drifted: {stale} missing glyphs: {gaps}")
        print(f"site fonts are current: {len(want)} subsets, {len(lic)} licences, every page glyph covered")
        return
    if gaps:
        sys.exit(f"a subset misses glyphs the pages set: {gaps}")
    for p, d in {**want, **lic}.items():
        p.write_bytes(d)
        print("  wrote", p.name, len(d), "bytes")


if __name__ == "__main__":
    main()
