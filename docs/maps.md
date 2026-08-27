# Map accuracy

`npm run test:map` — 15 assertions, no browser.

Two questions decide whether a pin tells the truth: is the projection right,
and is the pin drawn where the projection put it. The first was already right.
The second was wrong by kilometres, and nothing said so.

## The projection is exact

`src/lib/map-frame.ts` is Web Mercator, matching the tiles under it, and it
holds up when measured:

| check | result |
| --- | --- |
| `project` → `unproject` round-trip | worst **1.98 × 10⁻⁹ m** — floating-point noise |
| every place inside its own frame | yes |
| bbox aspect vs frame aspect | equal to 1 × 10⁻⁹ |
| `frameWidthMetres` vs haversine | 0.0005% apart |

That last equality is the one that matters most and is easiest to lose. The OSM
embed fits whatever bbox it is handed to whatever frame it is drawn in, growing
the short axis. If the two aspects disagree by even a little, **every** overlaid
pin slides. The bbox is therefore grown to an aspect the caller then applies to
the frame, and both come from `fitFrame`. The test asserts it rather than
trusting it.

## The pins were not where the projection put them

`spreadPins` nudges overlapping pins apart so a stacked one can still be
tapped. Its only limit was one pin width — **a distance in screen units**.

That is fine on a tight view, where a pin width is a few metres of ground, and
ruinous on a wide one, where it is kilometres. Measured against this catalogue,
before the fix:

| view | frame span | worst pin displacement |
| --- | --- | --- |
| place page — Al-Khiran, phone | 230 km | **24.55 km** |
| place page — Failaka, phone | 64 km | 6.55 km |
| search — all 36 places, phone | 122 km | **10.93 km** |
| search — all 36 places, desktop | 122 km | 5.44 km |
| search — outdoors, phone | 122 km | 2.80 km |
| place pages, median of 36 | — | 61 m |

The median is 61 m, which is the nudge working as intended. The tail is the
problem: a place page whose subject has no near neighbours stretches its frame
to reach them, and then 8.9% of that frame is a different town. Al-Khiran's page
drew a pin 24.5 km from the place it named, and it looked completely ordinary —
a pin on a map, on the right coast, at the right sort of zoom.

### The fix

Cap the shift on the ground as well as on the screen:

```ts
export const MAX_PIN_SHIFT_M = 60;

export function pinShiftCap(f: MapFrame, sizeFrac: number): number {
  return Math.min(sizeFrac, MAX_PIN_SHIFT_M / frameWidthMetres(f));
}
```

Both callers — `SearchMap` and `PlaceMapFrame` — pass it. Afterwards every one
of those rows reads **60 m**, and the invariant is checked across 54 search
frames and 216 place-page frames at six real widths from 320 px up.

### Why 60 m

Taken from the data, not chosen. The two closest distinct places in the
catalogue are the Grand Mosque and Liberation Tower, **68 m** apart, so 34 m
each separates the tightest real pair; every other pair needs less. The median
gap between neighbours is 412 m, so 60 m is under a seventh of it and a pin
stays on its own block.

Where the cap bites, pins overlap instead of separating. That is the honest
outcome — the results list beside the map is the exact index, and an
unreachable pin is a smaller lie than a pin in the wrong neighbourhood. The
test confirms the cap did not simply switch spreading off: the same 35 pins
still move, and the 68 m pair still comes apart by a full pin width.

## The audit was under-reporting coordinate precision

`scripts/audit-places.mjs` scored a coordinate's precision with `Math.max` of
its two axes, so a place was flagged only when **both** were coarse. A position
is only as precise as its **worse** axis. With `max`, Kuwait Towers'
`29.389, 48.0034` passed clean: the longitude's four decimals hid a latitude
quantised to a 111 m north–south grid — most of the way to the 68 m that
separates the two closest places in the catalogue.

Now `min`, and two places surface:

```
⚠ أبراج الكويت has only 3 decimal places (~±100m)
⚠ الأفنيوز has only 3 decimal places (~±100m)
```

**These are still open.** No geocoder is reachable from a build box — the
network policy denies everything outside the package registries — so the audit
can prove the data does not contradict itself but never that a place is where
the data says it is. Refining those two needs someone who can look them up.
Adding digits I cannot verify would make the number look precise without making
it true, which is worse than the warning.

## What is still not checked

- **Whether any coordinate is actually correct.** Everything here is internal
  consistency. A place could sit 500 m off in the sea and every test would pass.
- **Land versus water.** Failaka is genuinely offshore, so a naive check would
  need a coastline.
- **That the site's pin agrees with the embed's own marker.** These are drawn by
  two different pieces of code from the same coordinate, so a projection error
  would show as a visible double image — a good check, and it needs a browser
  that can reach openstreetmap.org, which this sandbox cannot.

## A framing observation, not fixed

A search matching both Failaka and anything in the city produces a 122 km frame
in which the whole of Kuwait City is a few pixels wide. The pins no longer lie
about position, but they are unreadably dense. Fixing that means a real decision
— cluster them, drop outliers from the fit, or let the user zoom — rather than a
constant, so it is left alone and written down here instead.
