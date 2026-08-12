# Authored 3D models — the Blender car shells

Every car body in Gulf Road Nights is modeled in Blender. The four
`car-<style>.glb` files here hold the Body / Canopy / Roof shells for the
sedan, the Z-wedge, the R34-style coupe and the FD, and the game swaps
them in over its procedural extrusions at load (`src/game/models.ts`).
If a file is missing or fails to load, the procedural car simply stands —
nothing waits and nothing breaks.

## Regenerating

```bash
pip install bpy          # Blender as a Python module, no GUI needed
npm run sync:models      # profiles.json from cars.ts → Blender → GLBs
```

There is no `.blend` file: the models are *code*. `scripts/export-car-profiles.mjs`
extracts the side profiles from `src/game/cars.ts` (the single source of
truth for the silhouettes), and `tools/blender/build_cars.py` lofts them
with the same Catmull-Rom top run and quarter-circle side bevel the
runtime extrusion uses — matching its sampling along the profile and
beating it across the width (8 bevel steps to the runtime's 5), which is
what makes the authored shells read smoother than the procedural ones.

Because the loft reproduces the runtime surface exactly (including the
outward bevel bulge the anchor tables were tuned against), every
procedural detail — pop-up headlight doors, tail garnish, wipers, aero —
still lands on the authored body. Commit the regenerated GLBs alongside
any profile change in `cars.ts`.

## What the game swaps, and what stays procedural

| Piece | Source |
| --- | --- |
| Body, Canopy, Roof shells | **These GLBs** (geometry only) |
| Paint, glass, reflections | Game materials — the swap keeps the mesh's material, so resprays and the live probe keep working |
| Wheels, lamps, trim, aero kit, underglow | Procedural (`cars.ts`) |
| Traffic cars | Fully procedural — thirty background cars don't need the density |

## Node naming is the contract

`models.ts` matches meshes by name, lower-cased, against the
`userData.shell` tags the car factory sets: `Body`, `Canopy`, `Roof`.
Renaming a node in an export silently reverts that shell to procedural.

The exports carry no materials (`export_materials="NONE"`), and axes are
converted by the exporter so +Z is the car's nose in-game.

## UE5

The Unreal port builds its rigs from primitives (`GRNCarFactory`). These
same GLBs import cleanly into the editor via Interchange (File → Import)
when replacing those rigs with real meshes — the node names above are the
rig contract there too.
