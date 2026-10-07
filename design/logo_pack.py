#!/usr/bin/env python3
"""Build the Almuhallab Code logo pack: everything a printer, a supplier or a
partner asks for, in one folder (design/logo-pack/).

Nothing here is drawn. The pack is cut from the English logo kit that
design/logo-en/build.py writes (the same kit that writes every mark the site
flies), so it cannot drift from the logo:

  svg/  the kit's nine SVGs, copied byte for byte
  png/  each mark on each ground at the sizes people ask for, resampled from
        the kit's own 4096px (2048px square) rasters with Lanczos
  ico/  a multi-size .ico of the AC monogram on its dark ground

Re-run after the kit changes:

    python3 design/logo-en/build.py
    python3 design/logo_pack.py
    python3 design/logo_pack.py --check   # exit 1 if the pack has drifted
"""

import io
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
KIT = HERE / "logo-en"
OUT = HERE / "logo-pack"

SHAPES = ("logo", "wordmark", "monogram")
GROUNDS = ("dark", "for-dark", "for-light")
WIDE = (400, 800, 1600, 4096)               # px wide, lockup and wordmark
SQUARE = (16, 32, 64, 128, 256, 512, 1024, 2048)
ICO = (16, 24, 32, 48, 64, 128, 256)


def kit(name):
    return KIT / f"almuhallab-code-{name}"


def resized(src, w):
    im = Image.open(src)
    im.load()
    if im.width == w:
        return im
    h = round(im.height * w / im.width)
    return im.resize((w, h), Image.LANCZOS)   # Pillow premultiplies RGBA


def save_png(im, path):
    # Fixed options and no metadata, so a rebuild is byte-identical.
    im.save(path, "PNG", optimize=True)


def build(out):
    for d in ("svg", "png", "ico"):
        (out / d).mkdir(parents=True, exist_ok=True)
    for shape in SHAPES:
        for ground in GROUNDS:
            name = f"{shape}-{ground}"
            shutil.copyfile(kit(name).with_suffix(".svg"),
                            out / "svg" / f"almuhallab-code-{name}.svg")
            for w in (SQUARE if shape == "monogram" else WIDE):
                save_png(resized(kit(name).with_suffix(".png"), w),
                         out / "png" / f"almuhallab-code-{name}-{w}.png")
    src = Image.open(kit("monogram-dark").with_suffix(".png")).convert("RGB")
    src.save(out / "ico" / "almuhallab-code.ico", format="ICO",
             sizes=[(s, s) for s in ICO])
    (out / "README.md").write_text(README)


def files(root):
    return {p.relative_to(root).as_posix(): p.read_bytes()
            for p in sorted(root.rglob("*")) if p.is_file()}


# ── README ───────────────────────────────────────────────────────────────
# The measurements below are taken from the kit's own geometry (logo-en/
# build.py, in the banner's pixels): ALMUHALLAB cap height 148.4, CODE cap
# 58.8, the tag's cap 24.82, the lockup's ink 1405.56 wide; the monogram's
# A is 700 tall in an ink box 1266 wide.

def cmyk(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    k = 1 - max(r, g, b)
    if k >= 1:
        return (0, 0, 0, 100)
    return tuple(round(v * 100) for v in
                 ((1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k))


COLOURS = [
    ("Ground (near-black)", "#0a0908", "the dark ground; page and bar"),
    ("Amber", "#e6a95c", "ALMUHALLAB, the A, `>_`: the one accent"),
    ("Stripe", "#7f5d33", "the dark band inside the amber letters (amber x .55)"),
    ("White", "#f4f4f4", "CODE and the C on dark"),
]


def _readme():
    rows = "\n".join(
        f"| {n} | `{h}` | {', '.join(str(int(h[i:i+2], 16)) for i in (1, 3, 5))} | "
        f"{' · '.join(str(v) for v in cmyk(h))} | {u} |" for n, h, u in COLOURS)
    return f"""# Almuhallab Code: logo pack

Cut from the English logo kit (`design/logo-en/`) by `design/logo_pack.py`.
Do not edit these files by hand: change the kit, then re-run both scripts.

## The marks

| File stem | What it is | Use it when |
|---|---|---|
| `logo` | full lockup: ALMUHALLAB, CODE between rules, `>_ SOFTWARE & SYSTEMS` | there is room: letterhead, signage, a cover |
| `wordmark` | ALMUHALLAB and CODE, without the tag line | the lockup would be below its minimum size |
| `monogram` | the AC monogram: striped amber A, white C | a square or a circle: app tile, profile photo, favicon, stamp |

## The grounds

| Suffix | Ground | Notes |
|---|---|---|
| `-dark` | `#0a0908` drawn in, with the logo's soft amber glow | the preferred form; opaque PNG |
| `-for-dark` | transparent | for a dark photograph or a dark material you supply |
| `-for-light` | transparent | for white paper. The amber is deepened to `#c4893a` (3:1 on white) and CODE and the tag set in dark grey (`#25292f`, `#33383f`), because `#e6a95c` and `#f4f4f4` disappear on white. Print it on white, never on cream or beige |

## Files

- `svg/`: the master files, vector, letters already converted to outlines (no fonts needed).
- `png/`: lockup and wordmark at 400 · 800 · 1600 · 4096 px wide; monogram at 16 · 32 · 64 · 128 · 256 · 512 · 1024 · 2048 px square.
- `ico/almuhallab-code.ico`: the monogram on its dark ground at 16 · 24 · 32 · 48 · 64 · 128 · 256 px.

## Clear space

Call **X** the cap height of ALMUHALLAB. Keep at least **3/4 X** clear on every
side of the lockup and the wordmark: no text, edge, fold or other mark inside it.
The SVGs and PNGs already carry exactly this margin, so place the file's box
and keep other things outside it.

For the monogram, call **A** the height of the letter A. Keep at least **A/3**
clear on every side. The square files carry more than this (about 0.39 A),
so their ink stays inside a circular crop.

## Minimum sizes

Measured on the ink (not the file's padded box):

| Mark | On screen | In print | What sets the limit |
|---|---|---|---|
| Lockup | 340 px wide | 70 mm wide | the tag line's capitals reach 6 px (1.2 mm) |
| Wordmark | 120 px wide | 30 mm wide | the stripes inside ALMUHALLAB stay distinct (cap ~13 px); CODE stays legible |
| Monogram | 16 px tall | 6 mm tall | the A's bands and the C still read as two letters |

Below the lockup's minimum use the wordmark; below the wordmark's, the monogram.

## Colours

| Name | Hex | sRGB | CMYK (C · M · Y · K) | Role |
|---|---|---|---|---|
{rows}

The CMYK figures are computed arithmetically from sRGB. They are **not** a
colour-managed conversion for any press or paper: ask the printer for a
proof and match it against the hex values on a calibrated screen before a run.
Amber is always ink (the letters), never a background or panel colour.

## Do not

- recolour, re-stripe, outline, rotate, stretch or add effects to the marks;
- set the white (`-for-dark`) files on a light ground or the `-for-light` files on a dark one;
- put the marks on beige, cream or sand-tinted grounds;
- re-type ALMUHALLAB in a font: use the files.

The product النوخذة has its own mark (the amber anchor); this pack is the
company's alone.
"""


README = _readme()


def main():
    missing = [n for s in SHAPES for g in GROUNDS for x in (".svg", ".png")
               if not kit(f"{s}-{g}").with_suffix(x).exists()
               for n in [kit(f"{s}-{g}").with_suffix(x).name]]
    if missing:
        sys.exit(f"logo kit incomplete, run design/logo-en/build.py first: {missing}")
    if "--check" in sys.argv:
        with tempfile.TemporaryDirectory() as t:
            build(Path(t))
            want, have = files(Path(t)), files(OUT)
        bad = sorted(k for k in want.keys() | have.keys() if want.get(k) != have.get(k))
        if bad:
            print("logo pack drifted:", *bad, sep="\n  ")
            sys.exit(1)
        print(f"logo pack: {len(want)} files match")
        return
    if OUT.exists():
        shutil.rmtree(OUT)
    build(OUT)
    print(f"wrote {len(files(OUT))} files to {OUT}")


if __name__ == "__main__":
    main()
