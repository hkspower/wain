# Logo design canvas

The `.dc.html` files here are the **source** for the Wain logo canvas: one
artboard each, laid out by `canvas.json`.

- `Main.dc.html` — primary lockup
- `AppMark.dc.html` — icon-only mark, shown at the sizes it ships at
- `Mono.dc.html` — one-colour versions
- `Placements.dc.html` — navbar, sea band, dark ground

The mark itself is not invented here. It is the one in
`src/components/WainLogo.tsx` and `public/brand/wain-logo.svg` — same Kuwait
silhouette, same pin geometry — with flat fills instead of gradients, because
a gradient only muddies it at the 24px the navbar uses.

`wain-logo.html` is the published canvas: the artboards seeded into a copy of
the editor payload. It is generated, ~2.2MB, and gitignored. Edit the
artboards, re-seed, republish to the same artifact URL — never hand-edit the
seeded file.

Nothing here is wired into the site. If a direction is approved, the change
lands in `WainLogo.tsx` and `public/brand/wain-logo.svg`, which must stay in
sync with each other.
