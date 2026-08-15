# Authored 3D models — the Blender asset build

The game's high-detail geometry is modeled in Blender and swapped in over
the procedural build at load (`src/game/models.ts`). Each file holds
geometry only; if one is missing or fails to load, the procedural version
simply stands — nothing waits and nothing breaks.

| File | Meshes | Replaces |
| --- | --- | --- |
| `car-{sedan,zx,gtr,rx7}.glb` | Body, Canopy, Roof | the bevel-extruded body shells |
| `wheel-{5,6}.glb` | Tire, Barrel, Alloy, Rotor, Lugs | the hero wheel (5-spoke cast / 6-spoke forged) |
| `palm.glb` | Crown | the corniche palm crown, one geometry for ~130 instances |
| `driver.glb` | Helmet, Visor, Glove, Wheel, Pedal | the driver at the wheel. These hang off joints the IK solver moves every frame, so each part is modelled in its own joint's local frame and dimensioned from `src/game/rig.ts` (via the `rig` block in `profiles.json`) — an authored rim at the wrong radius leaves the solved hands gripping thin air |

`build.json` records what the last build produced — quality preset,
settings and per-file triangle counts.

## Regenerating

```bash
pip install bpy          # Blender as a Python module, no GUI needed
npm run sync:models      # profiles.json from cars.ts → Blender → GLBs
```

Quality is a flag, not a rebuild: `--quality max` (shipped, ~593k
triangles across the seven files), `high` (roughly half), `draft` (fast,
for iterating on shapes). `--only cars,wheels,palm,driver` narrows the build.

There is no `.blend` file: the models are *code*.
`scripts/export-car-profiles.mjs` extracts the side profiles from
`src/game/cars.ts` (the single source of truth for the silhouettes), and
`tools/blender/build_assets.py` lofts them with the same Catmull-Rom top
run and quarter-circle side bevel the runtime extrusion uses — matching
its sampling along the profile and far exceeding it across the width (28
bevel steps to the runtime's 5), which is what makes the authored shells
read smoother than the procedural ones.

Because the loft reproduces the runtime surface exactly (including the
outward bevel bulge the anchor tables were tuned against), every
procedural detail — pop-up headlight doors, tail garnish, wipers, aero —
still lands on the authored body. Commit the regenerated GLBs alongside
any profile change in `cars.ts`.

## Envelopes are a contract, not a suggestion

The wheel is modeled to the dimensions the rest of the game is built
against: 0.36 m rolling radius, 0.26 m section width, 0.205 m bead, 0.2 m
rotor. Ride height, wheel arches, brake glow and skid marks are all
positioned against those numbers, so a "nicer" tire that is 5 mm larger
would lift the car off its own shadow. The same goes for the palm crown,
which sits at the 6.1 m trunk top in the instanced frame.

The wheel is authored once, for the right-hand side; `models.ts` mirrors
it for the left, winding and normals included. Scaling the mesh by -1
instead would reverse the direction the wheel appears to spin.

## What the game swaps, and what stays procedural

| Piece | Source |
| --- | --- |
| Body, Canopy, Roof shells; hero wheels; palm crowns | **These GLBs** (geometry only) |
| Paint, glass, reflections, wheel finish | Game materials — the swap keeps each mesh's material, so resprays, bought wheel finishes and the live probe keep working |
| Lamps, trim, aero kit, underglow, stickers | Procedural (`cars.ts`) |
| Traffic cars and their wheels | Fully procedural — thirty background cars don't need the density |

## Node naming is the contract

`models.ts` matches meshes by name, lower-cased, against the tags the
game sets: `userData.shell` (`Body`, `Canopy`, `Roof`) and
`userData.wheelPart` (`Tire`, `Barrel`, `Alloy`, `Rotor`, `Lugs`), plus
`Crown` for the palm. Renaming a node in an export silently reverts that
piece to procedural.

The exports carry no materials (`export_materials="NONE"`), and axes are
converted by the exporter so +Z is the car's nose in-game.

## UE5

The Unreal port builds its rigs from primitives (`GRNCarFactory`). These
same GLBs import cleanly into the editor via Interchange (File → Import)
when replacing those rigs with real meshes — the node names above are the
rig contract there too.
