# Identity

Two marks in one system. **Night Racer** is the game; **Night Racers**
is the crew that runs it. Everything is drawn in code and rendered
through Chromium (`node press/logo/render.mjs`), which is the only
renderer available here that shapes Arabic and Japanese correctly — PIL
would set both as disconnected letterforms. Every file is 4K on its long
edge.

> **The one-letter trap.** The game's files are `night-racer-*` and the
> crew's are `night-racers-*`. That is the honest consequence of the
> game being renamed to Night Racer while the crew kept the name Night
> Racers, and there is no way to make it safer than saying so: read the
> filename twice before you ship it.

## Night Racer — the title

| File | Size | Use |
| --- | --- | --- |
| `night-racer-logo.png` | 3840×2160 | the lockup, on the night ground |
| `night-racer-logo-transparent.png` | 3840×2160 | the same lockup, no ground |
| `night-racer-badge.png` | 3840×3840 | the round mark: avatar, sticker, app icon |
| `night-racer-plate.png` | 2880×3840 | the poster plate |

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

## Arabic-primary

The same two marks with the script order reversed — Arabic as the hero,
Latin as the annotation. Not translations bolted underneath: the whole
hierarchy flips.

| File | Size | Use |
| --- | --- | --- |
| `arabic-title-logo.png` | 3840×2160 | متسابق الليل, the title |
| `arabic-title-logo-transparent.png` | 3840×2160 | the same, no ground |
| `arabic-crew-logo.png` | 3840×2160 | متسابقو الليل, the crew |
| `arabic-crew-logo-transparent.png` | 3840×2160 | the same, no ground |

Set in IBM Plex Sans Arabic Bold — the game's own UI face.

**The Arabic is never sheared.** A synthetic oblique on a cursive script
breaks the joins and tilts the counters against the pen's own angle,
which is why the game's stylesheet sets `font-synthesis: none` on every
Arabic rule it has. The energy that the 11° shear gives the Latin comes
from weight and from the colour split here instead: the amber word leads
on the right, where the reader starts — متسابق in the title, الليل in
the crew mark — and it is the same word the Latin sets in amber, so the
two hierarchies agree without either being a translation of the other's
layout.

## The mark

A Japanese street-racer wordmark: heavy condensed gothic sheared 11°,
NIGHT in paper white over RACER in sodium amber, the two words set to
the same width so the pair locks as one block.

Under it runs the thing the game is actually about. The old title was a
PLACE — Gulf Road — and its mark was a survey of that place, a measured
run of street lamps curving away along a coast. Night Racer is not a
place. It is an hour, and the hour is the rule the whole game runs on:
the road opens at midnight and closes at 05:50, and outside that window
the world is still there and there is nobody to race. So the motif is a
night drawn to scale — twenty-four hours ticked, the open window struck
in sodium, the closed hours left as graduations. The badge is the same
statement made round: the rim is a day, midnight at twelve o'clock, and
the lit arc is 87.5° because five hours and fifty minutes of a day is
87.5° and not because it looked right there.

The figures are the game's own — `RACE_OPEN_H` and `RACE_CLOSE_H` in
`src/game/clock.ts` — and `npm run test:name` fails if the marks and the
game ever disagree. A logo that quotes a number the product has since
changed is worse than one that quotes none.

Colours are the game's own: `#05070e` ground, `#ffb03c` sodium,
`#46c9ee` gulf, `#e8ecf4` paper. Amber marks what was observed, cyan
what was calculated — a rule the plate keeps and the badge inherits.

## The quiet part

The plate carries two coordinates. The first, 29°22′N 047°58′E, is the
Gulf Road. The second, set a shade fainter, is 35°37′N 139°46′E — the
Bayshore Route on Tokyo Bay. Two lit coasts at the same hour, which is
the whole idea and is never stated anywhere in the artwork.

Typeface: Big Shoulders (display), Geist Mono (annotation), Noto Sans
CJK JP (katakana and kanji), IBM Plex Sans Arabic (Arabic). Design
philosophy in `PHILOSOPHY.md`.

## Two things that had quietly broken

Worth keeping, because both failed silently and both are now checked.

**The type was not the type.** Every source here loaded Big Shoulders and
Geist Mono over an absolute `file:///` path into a skills cache outside
the repository. That path stopped existing. A missing `@font-face` src
does not raise — it falls through to the next family in the stack — so
the marks kept rendering and kept looking wrong: the lockups in a generic
sans, and the badge, whose SVG `<text>` named no fallback at all, with
its monogram in a serif. Every face is vendored into `fonts/` now, and
`npm run check:logo` fails if any source reaches outside this directory.

**The two words were not the same width.** The title lockup's whole
premise is that the stacked pair reads as one block, and it was done by
nudging two `letter-spacing` values until the screenshot looked right —
which bakes the answer for one font at one size. Those numbers had been
tuned against the *fallback*: with the real face restored, NIGHT came out
586px against RACER's 392px, under a comment claiming they matched. The
tracking is solved at render time now, from two measurements and a slope,
and the sources report a failure rather than falling back to no tracking
at all.

## Rebuilding

```bash
node press/logo/render.mjs   # re-renders all eleven from the .html sources
npm run check:logo           # fonts resolve, sources and outputs all present
npm run test:name            # the marks and the game agree, and saves are safe
```

The sources are deterministic — the lamp jitter runs off a fixed seed —
so a rebuild is byte-for-byte the same plate. A survey that redraws
differently each time is not a survey.
