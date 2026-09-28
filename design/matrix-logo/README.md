# المهلب — matrix code logo pack

The boum under sail, drawn as a field of code glyphs, beside **المهلب** in
Reem Kufi. This is the **campaign / alternate mark**, approved from the design
canvas on 2026-09-28. The site's own identity (`almuhallab/logo.svg`, the
`#i-boum` / `#i-sail` sprite, `design/logo-pack/`) is locked and is not
replaced by it.

Everything here is generated. Do not edit these files by hand; change
`design/matrix_logo.py` and run it again:

```bash
python3 design/matrix_logo.py
```

## What is in the pack

| Layout | Use it for | SVG canvas | PNG widths |
|---|---|---|---|
| `mark` | avatar, app tile, favicon-scale uses (the ship alone, filling a square of code) | 1024 × 1024 | 1024 · 512 · 180 |
| `horizontal` | headers, banners, email signatures, slides | 2400 × 720 | 2400 · 1200 |
| `stacked` | posters, cover pages, square social posts | 1600 × 1600 | 1600 · 800 |

Each layout comes on three grounds, plus two transparent cuts:

| Ground | File suffix | Wordmark on ground |
|---|---|---|
| warm black `#0b0705` | `-dark` | amber `#e3a556`: **9.3:1** |
| brand brown `#6f3f1c` | `-brown` | white: **8.7:1** |
| white `#ffffff` | `-white` | brand brown `#7a4418`: **7.9:1** |
| none | `-dark-transparent`, `-white-transparent` | for placing on your own ground: use `dark` inks on dark grounds, `white` inks on light ones |

Every ratio clears WCAG's 7:1 body-text floor. They are computed, not
estimated.

## The SVGs need no fonts

Every letter in every SVG is **outlined to a path** at build time: shaped by
HarfBuzz (so the Arabic joins correctly) and drawn from the font's own
outlines. The files look identical on a machine that has none of the fonts
installed, and a printer can open them without asking for anything.

The dark and brown versions carry a soft glow (an SVG blur filter). Some print
RIPs and older vector editors flatten or drop filters. For print, prefer the
`-white` files, which have no glow, or ask for a proof.

## Colours

All of them are the site's own tokens. None were picked by eye:

| Role | Hex | Site token |
|---|---|---|
| wordmark, lit ship (dark) | `#e3a556` | `--sand-vivid` |
| code field, rules | `#c08552` | `--ord-1` |
| wordmark, ship (white) | `#7a4418` | `--tint` |
| brown ground | `#6f3f1c` | `--tint-strong` |
| text on white | `#1b2430` | `--text` |
| code field on white | `#434d55` | `--muted` |

## Type

| Line | Face | Licence |
|---|---|---|
| المهلب | Reem Kufi Bold | SIL OFL 1.1: `fonts/OFL-ReemKufi.txt` |
| ALMUHALLAB CODE, the code glyphs, the prompt | Share Tech Mono | SIL OFL 1.1: `fonts/OFL-ShareTechMono.txt` |
| شركة برمجة وأنظمة | Cairo Bold (the site's own face, `almuhallab/fonts/`) | SIL OFL 1.1 |

## The ship

The ship is the same boum as the site's mark. Four things make her a boum,
and all four survive the conversion to code: she is **double-ended** with a
raked stem, she carries **filled lateen sails**, her **tall mainmast is forward**
and her mizzen is short and aft, and her **sheer rises** into both ends. She is
defined as polygons and rasterised onto the glyph grid (48×48 for the
mark, 48×32 horizontal, 60×40 stacked). Lit cells draw only from dense glyphs
(`0 8 # $ B D M W …`) so that the sails read as solid. The grid is seeded, so
every build lays out the same glyphs.

## Using it

- **Clear space:** keep at least the height of «ALMUHALLAB CODE» clear on
  every side of a lockup.
- **Minimum size:** horizontal lockup 360 px / 60 mm wide; mark 64 px. Below
  64 px the glyphs blur into texture, so use the site's plain boum
  (`design/logo-pack/`) at icon sizes instead.
- **Do not** recolour outside the table above, stretch it, set the wordmark
  in another face, or place the dark version on a light ground.
