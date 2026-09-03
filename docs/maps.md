# Map accuracy

`npm run test:map` — 34 assertions, no browser. The claims that need a rendered
page — a pin's height, an iframe's fetch — are in `tests/map-pin.test.mjs`,
which runs under `npm run test:hangout`.

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
frames and 264 place-page frames at six real widths from 320 px up.

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

## The frame had no room for the pins in it

A pin points at its place from above it — the tip is the coordinate, the head is
just where the icon lives. The frame, meanwhile, was fitted to the **points**,
and it clips its overflow so the rounded corners hold. So the northernmost pin's
head was drawn outside the frame and cut off.

Measured in a browser across six queries and three place pages at three widths,
before the fix:

| | |
| --- | --- |
| pins drawn | 438 |
| pins clipped by the top edge | **79** (18%) |
| worst | قصر السلام, phone search — **23 of 32 px** gone |

Always the top result on the map, which is to say a place the search had just
decided was worth showing.

### The fix

`fitFrame` takes a `headroom` in pixels and the frame's width, and reserves it
above the northernmost point. `pinHeadroom(size)` in `MapPin` derives the number
from the same two constants the pin is built from — the head is `size` tall, the
nose adds half its diagonal, and hovering grows the pair — so the frame cannot
quietly stop matching the thing it makes room for.

The room comes out of the **bottom margin** first, because a pin's tip is its
bottom edge and the bottom therefore needs almost none. The frame only widens
when both margins cannot fit at the zoom it already has: over every category at
six widths, 32 of 54 frames did not widen at all, and the worst that did widened
by 16%. Afterwards: **0 of 438 clipped**.

`fitFrameAround` — the place page — gets the same reservation but is never slid
north. It centres its subject because the page is asking where the subject is,
so it widens symmetrically instead. The test asserts the subject stays dead
centre to 10⁻⁹ of the frame.

## The basemap was fetched twice on every phone

The frame's shape depends on how wide its box is: the aspect cap is tighter on a
phone (1.7 against 2.4) and the pin nudge is budgeted in pixels. That width was
**guessed** at 720 and corrected by a `ResizeObserver` in a `useEffect`, which
runs after paint.

On a desktop the guess was right. On a phone it was wrong every time, and the
correction was not free: the first frame was built at the desktop aspect, the
iframe fetched that bbox from openstreetmap.org, the observer then reported
358 px, and the whole thing was thrown away and fetched again — two cross-origin
round trips, two frame heights, and a white flash, on the device nearly all of
this site's traffic uses.

`useFrameWidth` measures in a **layout** effect instead, before the browser
paints, and the callers render nothing inside the frame until it returns a real
width. Two further details, both of which cost a second fetch on their own:

- `getBoundingClientRect().width` is the border box and `ResizeObserver`'s
  `contentRect` is the content box. The search map's frame has a 1 px border, so
  the two disagreed by 2 px — a different frame, a different bbox, another
  fetch. Both readings are now of the border box.
- The `<link rel="preconnect">` for openstreetmap.org lives in
  `src/app/search/page.tsx`, not in `SearchClient` or `SearchMap`. `SearchClient`
  reads the query string, so Next leaves it out of the prerendered HTML
  entirely, and `SearchMap` does not exist until there are results — by which
  time the iframe is already waiting on the handshake the preconnect is meant to
  have finished.

Measured after: **one** basemap fetch per query on a phone and on a desktop, and
one per place page. Both are asserted in `tests/map-pin.test.mjs`.

The map's own arithmetic was never the cost. `fitFrame + project + spreadPins`
over all 44 places is **0.38 ms**, and 0.11 ms for a typical 24-result set.

## The eight approximate coordinates said nothing about themselves

Eight of the 44 places carry `coordsUnverified` — «the right area, not the right
building», in the catalogue's own words — and nothing in the app read the flag.
Their pin was drawn with the confidence of a surveyed one, and the «الاتجاهات»
button handed a driver the raw pair, which is the one place the difference costs
somebody a wrong turn.

Now, for those eight only, directions resolve against Google's own listing by
name and area, and the page says the pin is approximate. The other 36 still
route to their coordinate — a coordinate beats a name lookup every time it is
true.

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
