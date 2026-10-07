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
OUT = HERE.parent / "almuhallab" / "fonts"

# Cairo's Latin range, so the three Latin files split the page the same way
RANGE = ("U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, "
         "U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD")
FEATURES = ["kern", "liga", "calt", "tnum", "lnum", "zero"]
FACES = [  # source, output
    ("ChakraPetch-SemiBold.ttf", "chakrapetch-600.woff2"),
    ("ChakraPetch-Bold.ttf", "chakrapetch-700.woff2"),
    ("JetBrainsMono-Variable.ttf", "jetbrainsmono-latin.woff2"),
]
LICENCES = [("OFL-ChakraPetch.txt", "LICENSE-ChakraPetch.txt"),
            ("OFL-JetBrainsMono.txt", "LICENSE-JetBrainsMono.txt")]
# every character the pages set in these faces: figures, KWD amounts, the
# phone, the handle and the address, the prompt, the Latin display lines
MUST_COVER = ("0123456789+-%.,:/@_>&()·" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
              + "abcdefghijklmnopqrstuvwxyz" + " ")


def build(src):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = FEATURES
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    font = TTFont(SRC / src, recalcTimestamp=False)   # a save stamps the current time otherwise
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(RANGE.replace(" ", "")))
    sub.subset(font)
    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)
    return buf.getvalue()


def missing(data):
    cmap = TTFont(io.BytesIO(data)).getBestCmap()
    return [c for c in MUST_COVER if ord(c) not in cmap]


def main():
    want = {OUT / out: build(src) for src, out in FACES}
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
