# Kuwait places art canvas

Review sheets for the per-place hero art in `src/components/PlaceArt.tsx`.

- `Main.dc.html` — all seventeen places, marked with whether each has its own
  drawing or falls back to its category
- `Culture.dc.html` — the four that used to share one scene
- `Souqs.dc.html` — souq vs mall vs waterfront mall
- `Water.dc.html` — park, beach, island, man-made island, water park
- `SafeBox.dc.html` — why art has to live inside x 72–328, y 20–140

**The scenes here are extracted from the rendered site, not hand-copied.** The
build script drives every place page in a browser and lifts the hero SVG's
actual `innerHTML`, so the canvas shows exactly what ships — spreads, opacities
and all. Redraw in `PlaceArt.tsx`, re-extract, re-seed; never edit the SVG here
and expect the site to change.

`kuwait-places-art.html` is the published canvas: 2.2MB of bundled editor code
wrapped around these artboards. Generated, gitignored, never hand-edited.
