# Press kit

Everything the game has to show for itself, in four folders. The split
is by **who rebuilds it and when**, because that is the only question
that matters when one of these files goes stale.

| Folder | What | Rebuild |
| --- | --- | --- |
| `logo/` | The identity: two marks, Latin and Arabic, plus the poster plate. 4K. | `node press/logo/render.mjs` |
| `shots/` | Reference stills of the game in eight known states. | `npm run shots` |
| `cars/` | Beauty renders of the flagship car. | hand-captured |
| `film/` | The pre-race versus film and its poster frame. | recorded from the game |

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
