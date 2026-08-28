# Design canvases

Working files for canvases published to Claude Design. Each directory holds
the **source**: one `.dc.html` per artboard, a `canvas.json` laying them out,
and any shared fragments.

The seeded `wain-*.html` beside them is **not** tracked. It is a 2.5MB copy of
the canvas editor with this source embedded, rebuilt from these files whenever
anything changes — so the artboards are what to edit, never the seeded page.

## wain-identity

The brand identity system: the mark, the وين؟ wordmark, the three lockups, the
app icon and its maskable safe area, the favicon step-down, colour variants,
clear space and misuse.

`_logo.txt` is the mark's geometry, lifted verbatim from
`src/components/WainLogo.tsx` and shared across the artboards so the canvas and
the product can never drift. Every colour is a token from `globals.css`; the
type is IBM Plex Sans Arabic, the face the site already ships.

The one design decision in here that is not simply documentation is the
favicon: the full mark carries a country outline, a pin, a stroked ؟ and a
3.5-unit keyline, and below 32px the keyline starts eating the shapes it exists
to separate. The board shows that at true pixel size and steps the mark down —
full mark above 32px, pin-with-؟ from 24, solid pin at 16.
