# The app preview deck

```
npm run build && node scripts/gen-preview.mjs
```

Writes `docs/wain-app-preview.pdf` — five A4 landscape pages of the app as it
actually runs — and a PNG of every page beside it in `docs/preview-pages/`.

Screens are captured from the real static export, so the deck cannot drift from
the product the way a hand-made mockup does.

## Resolution

The page PNGs export at **3840 × 2715 — 4K UHD on the long edge**, which for a
297mm page is about 328dpi. They were 3509 × 2481 (300dpi).

The PDF is unchanged in size and in kind: its type is not rasterised at all.
The deck is printed through Chromium with `preferCSSPageSize`, so Arabic stays
live, selectable, subsetted vector text and is resolution-independent already.
Only the embedded screenshots are pixels, and those are the same captures the
PNGs use.

## The rule, and why the old ceiling was too low

**Nothing may be enlarged past what was captured.** More pixels than the source
holds is a bigger file that is not a better picture.

That rule has not changed. What changed is that it is now *checked* instead of
asserted in a comment — and checking it showed the old 300dpi ceiling was far
more cautious than the captures required, with most of a stop of headroom
sitting unused.

The comment also named the wrong binding asset. It said the desktop plate; it
is actually the cover's hero phone, which is placed at 1.28× the normal phone
width:

| asset | captured | placed | own ceiling |
|---|---|---|---|
| cover hero phone | 1170px | 74.2mm | 400dpi |
| desktop plate | 4320px | 257mm | 427dpi |
| phone plate | 1170px | 58mm | 512dpi |

At 4K's 328dpi every one of them is still being **downsampled** into the page —
1.22×, 1.30× and 1.56× headroom respectively — which is what makes the result
crisp rather than merely large.

The generator prints that table on every run and **exits 1 rather than write a
soft page**. Asking for 5200px, for instance, is refused:

```
gen-preview: 445dpi would enlarge assets past their capture:
  cover hero phone: needs 1301px, captured 1170px
  desktop plate: needs 4503px, captured 4320px
Raise the deviceScaleFactor on those captures, or lower TARGET_LONG_EDGE.
```

## Going higher than 4K

Raise `TARGET_LONG_EDGE`. Up to about 4670px the current captures cover it. Past
that, the guard will name whichever asset is short, and the fix is to raise the
`deviceScaleFactor` on that capture — not to let the export invent the detail.
