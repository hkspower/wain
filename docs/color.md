# Colour

`npm run audit:color` — needs `npm run build` first, because it measures the
built site in a real browser rather than reading the stylesheet.

## Why measure instead of read

The stylesheet is not what the eye sees. A token at 12% opacity over sand is a
colour no token names; a gradient is a different colour at every point along it;
and text sits on whatever happens to be behind it, which is usually three
elements up the tree. All three of those are invisible to anything that only
reads CSS, so this opens the site in Chromium and asks the compositor.

Kuwait is bright, phones are held outdoors at midday, and grey-on-grey that
reads fine on a desk monitor is unreadable in a car park. That is the whole
reason contrast is checked at all.

## What it reports

**The palette.** 95 tokens, 95 distinct colours — no two tokens are secretly the
same colour, and if two ever become the same the run says so by name.

**The volume.** 77 distinct colours actually render across 11 routes on two
viewports. 23 of them are not named by any token; those are composites and
gradient stops, and they are listed for interest, not as a verdict.

**Invented colours.** The verdict on palette drift is taken from the source, not
from the screen, because a rendered colour cannot tell you where it came from —
sea-700 at 40% over sand looks identical whether a token or a hand-typed hex
produced it. So every `.ts`/`.tsx` under `src/` is read for hex literals.

Two exemptions, and only two:

- `KuwaitSkyline`, `CategoryArt`, `WainLogo`, `PlaceArt` are *drawings* — a dhow
  sail, a dome, the flag. Their colours are chosen for the picture, not applied
  to an interface, none of them sits behind text, and forcing them onto a
  nine-step UI ramp would flatten them.
- `layout.tsx` and `manifest.ts` set the PWA and browser-chrome colours, which
  the operating system reads before any stylesheet exists.

Anything else with a hex in it fails the run.

**Contrast.** Every visible text node is measured against the surface behind it:
WCAG AA, 4.5:1 for normal text and 3.0:1 for large (24px, or 18.66px bold).
1600 nodes, all passing.

## How the backdrop is worked out

Walking up from the text, compositing each ancestor's paint layers behind what
has accumulated so far, until the stack is opaque — then flattening onto white.

Two details that took two runs to get right, and are worth knowing if this file
is ever edited:

- **Colours are painted, not parsed.** Tailwind v4 compiles `bg-white/95` to
  `color-mix()`, which Chromium reports as `oklab(0.99 0.00004 0.00002 / 0.95)`.
  A regex looking for `rgba()` skips that silently and then reports the colour
  *behind* the translucent surface as though nothing were in front of it. The
  first run of this script claimed the site had white text on white for exactly
  that reason. Every colour string is now drawn onto a 1×1 canvas twice, once
  over white and once over black; the difference gives alpha and the black pass
  divided by alpha gives the colour. Both passes are opaque, so nothing is lost
  to premultiplication, and it works for any syntax the browser accepts.

- **A gradient has no single answer, so it gets several.** Its stops are each
  carried forward as a separate candidate backdrop and the worst resulting ratio
  is the one reported. Only the two extremes by luminance are kept, since the
  worst case is always one of them.

Text over a *photograph* is not measurable from CSS. Those are counted and
reported separately, never failed on a guess. There are currently none.

## What it found

One real failure, on the most prominent button on the site: the وين AI launcher
ran `from-coral-500 to-coral-700`, and its label sits at the top — white at
16px/600 on coral-500 is **3.61:1**, under the 4.5 it needs. The panel header
had the same defect at its coral-500 end.

Both now start one step darker, `coral-600` (**4.69:1**), keeping the hue, the
direction and the same 200-step spread. Nothing else about them changed.

The other three failures the first run printed were all bugs in this script, not
in the site — see the two details above.
