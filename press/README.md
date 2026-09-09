# Press kit

Everything the game has to show for itself. The split is by **who
rebuilds it and when**, because that is the only question that matters
when one of these files goes stale — and by whether it is a
**deliverable** or the **output of an instrument**, because that decides
whether it belongs in the history at all.

> This table said "four folders" for a long time while twenty-seven grew
> underneath it. It is generated now, from `scripts/lib/assets.mjs`, and
> `npm run check:assets` fails if it drifts. Do not edit it by hand:
> change the declaration and run `npm run check:assets -- --write`.

<!-- assets:begin -->
| Folder | What | Rebuild | |
| --- | --- | --- | --- |
| `cars/` | A press render of every car on the menu's own turntable. | `tools/shots/cars.mjs` | kept |
| `logo/` | The identity: both marks and the poster plate, with the faces they need vendored beside them. | `press/logo/render.mjs` | kept |
| `shots/` | Reference stills of the game in known states, kept to be compared against their own history. | `tools/shots/capture.mjs` | kept |
| `social/` | Share cards. | by hand | kept |
| `stories/` | The story cards and the page that lays them out. | `scripts/story-cards.mjs` | kept |
| `map/` | The circuit, drawn. | by hand | kept |
| `flags/` | The flag decal, at the size it is worn. | `tools/shots/flags.mjs` | kept |
| `blur/` | Building blur, before and after. | `tools/shots/nightlook.mjs` | kept |
| `sharp/` | Edge sharpness at each resolution step. | `tools/shots/sharpness.mjs` | kept |
| `paint/` | Paint under the street lights, per finish. | `tools/shots/paint.mjs` | kept |
| `shadow/` | The contact shadow, close up. | `tools/shots/shadows.mjs` | kept |
| `menus/` | Every menu at the sizes the gutters check. | `tools/shots/menus.mjs` | kept |
| `stripe/` | The full-length side graphic on each silhouette. | by hand | kept |
| `texels/` | Decal density, magnified. | `tools/shots/texels.mjs` | kept |
| `type/` | The HUD's numerals, held still. | `tools/shots/type.mjs` | kept |
| `volume/` | The car's own silhouette against the light. | `tools/shots/volume.mjs` | kept |
| `audio/` | The glitch report, as a file. | `tools/shots/audioglitch.mjs` | kept |
| `film/` | The pre-race film, both encodings, and its poster frames. The 336 JPEGs it was made from are not the artefact. | `tools/shots/exportfilm.mjs` | part kept |
| `ik/` | The rig at 4K. The JPEGs are the deliverable; the lossless PNGs beside them are 13 MB each. | `tools/shots/ik4k.mjs` | part kept |
| `views/` | Car elevations, rendered on demand. | `tools/shots/car-views.mjs` | regenerated |
| `decals/` | Decal artwork, dumped to look at. | `tools/shots/decals.mjs` | regenerated |
| `levels/` | Level histograms and the frames behind them. | `tools/shots/levels.mjs` | regenerated |
| `shop/` | Shop screenshots. | `tools/shots/shopsmoke.mjs` | regenerated |
| `grid/` | Overhead grid shots. | `tools/shots/grid.mjs` | regenerated |
| `situations/` | Grade frames per situation. | `tools/shots/situations.mjs` | regenerated |
| `glare/` | Glare falloff frames. | `tools/shots/glare.mjs` | regenerated |
| `exhaust/` | Exhaust tip frames. | by hand | regenerated |
| `hud/` | The per-run HUD type report; viewport-dependent. | `tools/shots/hudtype.mjs` | regenerated |
| `dark/` | Dark-area scan frames. | `tools/shots/dark.mjs` | regenerated |
| `edges/` | Edge-quality frames. | `tools/shots/edges.mjs` | regenerated |
| `framing/` | Framing frames at each window size. | `tools/shots/framing.mjs` | regenerated |
| `tint/` | Fifteen captures of one car at fifteen darknesses; the TABLE is the artefact. | `tools/shots/tint.mjs` | regenerated |
| `station/` | Petrol station shots. | `tools/shots/capture.mjs` | regenerated |
| `clock/` | Clock screenshots. No producer found by name. | by hand | regenerated |
| `areas/` | Area-guide plates. No producer found by name. | by hand | regenerated |
| `plants/` | Roadside planting frames. No producer found by name. | by hand | regenerated |
| `limiter/` | Rev-limiter alert frames. No producer found by name. | by hand | regenerated |
<!-- assets:end -->

## Deliverable, or derived?

Every PNG here is **derived** — each one has a committed source that
regenerates it byte-for-byte, and none of them is an input to anything.
They are committed anyway, on purpose:

- `logo/` is the identity. It is referenced from outside the repo, it
  changes rarely, and a logo you have to run a build to see is not a
  logo you can hand to anyone.
- `shots/` exists precisely to be compared against its own past. A
  reference still that is not in history cannot be diffed against the
  version before the change, which is the entire reason to capture it.

So they stay, and the cost is managed instead of avoided: all nineteen
PNGs are re-encoded losslessly at maximum compression (no quantisation
— not a pixel differs), which is worth about 1.7 MB across the set.

## Sources live next to their output

`logo/` carries its own `.html` sources and `render.mjs`; `shots/` is
built by `tools/shots/capture.mjs`. Neither needs anything that is not
in the repo except a browser — the Arabic and Japanese faces the logo
needs are vendored in `logo/fonts/`, because `.next/` is a build
directory that gets cleared and an identity that stops rendering on a
clean checkout is not an identity.

## What is NOT here

Runtime assets live under `public/`, not in the press kit:

| Path | What | Rebuild |
| --- | --- | --- |
| `public/models/*.glb` | Blender-authored car shells, wheels, palms, driver | `npm run sync:models` |
| `public/sfx/` | Recorded sound effects + manifest | `npm run sfx` |
| `public/voices/` | Rival voice lines + manifest | `node scripts/generate-voices.mjs` |

Those are shipped to the browser and must be committed; the press kit
is not. The models are the one set that genuinely cannot be rebuilt
everywhere — `npm run sync:models` needs Blender's `bpy` — which is why
they are the only large binaries in the repo that are load-bearing.
