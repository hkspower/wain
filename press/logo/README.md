# Identity

Two marks in one system. **Gulf Road Nights** is the game; **Night
Racers** is the crew that runs it. Everything is drawn in code and
rendered through Chromium (`node press/logo/render.mjs`), which is the
only renderer available here that shapes Arabic and Japanese correctly —
PIL would set both as disconnected letterforms. Every file is 4K on its
long edge.

## Gulf Road Nights — the title

| File | Size | Use |
| --- | --- | --- |
| `gulf-road-nights-logo.png` | 3840×2160 | the lockup, on the night ground |
| `gulf-road-nights-logo-transparent.png` | 3840×2160 | the same lockup, no ground |
| `gulf-road-nights-badge.png` | 3840×3840 | the round mark: avatar, sticker, app icon |
| `gulf-road-nights-plate.png` | 2880×3840 | the poster plate |

## Night Racers — the crew

| File | Size | Use |
| --- | --- | --- |
| `night-racers-logo.png` | 3840×2160 | the lockup, on the night ground |
| `night-racers-logo-transparent.png` | 3840×2160 | the same lockup, no ground |
| `night-racers-emblem.png` | 3840×3840 | the crew patch |

Where the title mark is a survey — measured, indexed, annotated — the
crew mark is a stamp. NIGHT in paper white, RACERS in sodium amber, one
line, sheared harder than the title at 12°. Above it sits 走り屋
(*hashiriya*), which is the word Japanese street racers actually use for
themselves rather than a translation of "racer"; the emblem takes that
seal, sets it on a lit disc, and graduates the bezel in 72 stations with
both name arcs left clear of the ticks. ナイトレーサーズ round the top,
NIGHT RACERS round the bottom.

The two marks share the palette, the shear, and the rule that amber
means observed and cyan means calculated — so they read as one house
without either being a recolour of the other.

## The mark

A Japanese street-racer wordmark: heavy condensed gothic sheared 11°,
GULF ROAD in paper white over NIGHTS in sodium amber, the two lines
tracked to the same optical width so the pair locks as one block. Under
it runs the thing the game is actually about — a measured line of street
lamps curving away along a coast. Above it, ガルフロード・ナイツ. Below
it, ليالي شارع الخليج.

Colours are the game's own: `#05070e` ground, `#ffb03c` sodium,
`#46c9ee` gulf, `#e8ecf4` paper. Amber marks what was observed, cyan
what was calculated — a rule the plate keeps and the badge inherits.

## The quiet part

The plate carries two coordinates. The first, 29°22′N 047°58′E, is the
Gulf Road. The second, set a shade fainter, is 35°37′N 139°46′E — the
Bayshore Route on Tokyo Bay. Two lit coasts at the same hour, which is
the whole idea and is never stated anywhere in the artwork.

Typeface: Big Shoulders (display), Geist Mono (annotation), IPA Gothic
(katakana), FreeSerif (Arabic). Design philosophy in `PHILOSOPHY.md`.

## Rebuilding

```bash
node press/logo/render.mjs      # re-renders all four from the .html sources
```

The sources are deterministic — the lamp jitter runs off a fixed seed —
so a rebuild is byte-for-byte the same plate. A survey that redraws
differently each time is not a survey.
