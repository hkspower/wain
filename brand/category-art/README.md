# Category tile artwork — "Ember Discipline"

The four home-page category artworks (`sporta-web/public/cats/art-*.jpg`) are
generated, not sourced. Two generations exist under the same philosophy
(`PHILOSOPHY.md`); the one that ships is the second:

**Current (ships): `raymarch/` — real-time 3D renders.** A GLSL sphere-tracing
framework (`raymarch/render.mjs`) rendered in headless Chromium via WebGL2:
one warm key light, cool fill, soft shadows, ambient occlusion, glossy floor
with true reflections, ACES tonemap. Per-scene SDF files in
`raymarch/scenes/`. The men/women statues are the owner's banner silhouettes
extruded into 3D through exact Euclidean signed-distance fields
(`scenes/men.tex.png`, `scenes/women.tex.png`, 16-bit packed in RG) with an
organic inflation profile — the anatomy is the brand silhouette, guaranteed.
Render: `node render.mjs <scene> out.png 1600 1000` (needs playwright; symlink
node_modules from sporta-web). Post-grade (bloom/grain/vignette) and JPEG
encoding are described in the git history of this folder.

**First generation (superseded): the Python/PIL paintings** (`paint_*.py`,
`men.py`, `women.py`) — kept because they are the recipe the philosophy was
proven on. Nothing in this folder ships; `public/cats/` holds the exports.

| Canvas | Script | Subject |
|---|---|---|
| art-men.jpg | `men.py` | double-biceps figure (mask from the owner's banner silhouette) |
| art-women.jpg | `women.py` | runner at full stride (mask from the owner's banner silhouette) |
| art-accessories.jpg | `paint_accessories.py` (+ `paint_lib.py`) | caps, bottle, folded towel on a plinth |
| art-outlet.jpg | `paint_outlet.py` (+ `paint_lib.py`) | stocked shelves (رفوف) under a store lamp |

Compositional contract (do not break when regenerating):
- 1600×1000, closed palette (charcoal #0E1013–#171A1E, #E0561C, #FF7B17, dust
  #D9A47E), no text, no faces with features.
- The LEFT ~45% stays quiet and dark — the tile lays its title there, and
  `CategoryTile.jsx` mirrors the whole image under RTL so the quiet side always
  follows the text.
- Bottom-right ~220px: the arrow chip lands there; no critical detail.

`men.py` and `women.py` were authored agent-side against the same philosophy and
read their figure masks from the original silhouette extractions (git history of
`sporta-web/public/cats/*.webp`, removed after these full-bleed canvases
replaced them).

These artworks are the FALLBACK layer. Real photography wins: upload
`public_html/cats/desktop/{men,women,accessories,outlet}.jpg` **and**
`public_html/cats/mobile/<same names>` on the server and the tiles switch with
no rebuild.

**Both folders, every time.** The tile picks its folder from the viewport
(`<source media>`), so a phone is never sent the desktop file — that is the
whole point of the split, and it is why there is no fall-through from one folder
to the other. Finding out whether the desktop file exists would mean
downloading it on the phone first, which is the thing being prevented. If a
folder is missing its file, that layout shows the shipped artwork instead;
nothing breaks, but the photograph simply will not appear there.

If you only have one picture, put the same file in both. The phone then carries
a few more kB than it needs, which is still far better than the desktop-sized
file it used to get. Better: save a copy about 900 px wide for `mobile/`.
