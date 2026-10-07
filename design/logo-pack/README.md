# Almuhallab Code: logo pack

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
| Monogram | 24 px tall | 8 mm tall | the A's bands stay distinct and the C still reads as a second letter |

Below the lockup's minimum use the wordmark; below the wordmark's, the monogram.
The A's stripes merge into one mottled fill below 24 px, so 16 px survives only
as the favicon and `.ico` size, where a browser tab requires it.

## Colours

| Name | Hex | sRGB | CMYK (C · M · Y · K) | Role |
|---|---|---|---|---|
| Ground (near-black) | `#0a0908` | 10, 9, 8 | 0 · 10 · 20 · 96 | the dark ground; page and bar |
| Amber | `#e6a95c` | 230, 169, 92 | 0 · 27 · 60 · 10 | ALMUHALLAB, the A, `>_`: the one accent |
| Stripe | `#7f5d33` | 127, 93, 51 | 0 · 27 · 60 · 50 | the dark band inside the amber letters (amber x .55) |
| White | `#f4f4f4` | 244, 244, 244 | 0 · 0 · 0 · 4 | CODE and the C on dark |

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
