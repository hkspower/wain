# Category tile artwork — "Ember Discipline"

The four home-page category artworks (`sporta-web/public/cats/art-*.jpg`) are
generated, not sourced: every canvas is produced by a Python/PIL script in this
folder, under the design philosophy in `PHILOSOPHY.md`. Nothing here ships —
this folder is the master, `public/cats/` holds the 1600×1000 JPEG exports.

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
`public_html/cats/{men,women,accessories,outlet}.jpg` on the server and the
tiles switch with no rebuild.
