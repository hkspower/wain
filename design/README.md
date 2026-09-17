# Logo design canvas

The `.dc.html` files here are the **source** for the Wain logo canvas: one
artboard each, laid out by `canvas.json`.

- `Main.dc.html` — primary lockup
- `AppMark.dc.html` — icon-only mark, shown at the sizes it ships at
- `Mono.dc.html` — one-colour versions
- `Placements.dc.html` — navbar, sea band, dark ground

The mark itself is not invented here. It is the one in
`src/components/WainLogo.tsx` and `public/brand/wain-logo.svg`. The Kuwait
silhouette and the pin teardrop are byte-identical to that file on all four
artboards; four things are not, and this list exists because the canvas note
used to claim only the first of them:

- Flat fills instead of gradients, because a gradient only muddies the mark at
  the 24px the navbar uses.
- **The ؟ is redrawn, not copied** — arc radius 4.9→5.1, origin 28→27.4, dot
  r 2→2.05, stroke 3→3.2. The same redraw on all four boards, so it is a
  variant rather than a slip, but it is a variant nobody wrote down.
- **Kuwait carries no white keyline here.** The component strokes every edge at
  3.5, and that keyline is what lets the mark sit on a photograph or a coloured
  band without a container — `Placements.dc.html` is where it would be missed.
  Only `Mono.dc.html`'s outline version puts an edge back.
- The viewBox is cropped tighter than the component's `14 8 84 92`:
  `18 10 84 88` on Main, `22 12 76 78` on the other three.

`wain-logo.html` is the published canvas: the artboards seeded into a copy of
the editor payload. It is generated, ~2.2MB, and gitignored. Edit the
artboards, re-seed, republish to the same artifact URL — never hand-edit the
seeded file.

Nothing here is wired into the site. If a direction is approved, the change
lands in `WainLogo.tsx` and `public/brand/wain-logo.svg`, which must stay in
sync with each other.
