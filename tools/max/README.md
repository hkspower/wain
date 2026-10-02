# Car shells in 3ds Max

Each car's painted body and glass come from three meshes in `public/models/car-<style>.glb`: **Body**, **Canopy** and **Roof**. This folder lets you model them in 3ds Max and bring them back into the game, with a check that the game will accept what you made.

The game builds everything else itself: lamps, trim, wheels, mirrors, paint and glass materials.

## The loop

```sh
pip install bpy                                  # Blender as a Python module, once
npm run max:export                               # press/max/car-<style>.fbx, all nine styles
```

In 3ds Max (2020 or later):

1. **Scripting → Run Script… →** `tools/max/nightracer.ms`. This opens the Night Racer panel.
2. **Open style…** and pick `press/max/car-<style>.fbx`. The panel puts the car on three layers:
   - **NR_Edit**: Body, Canopy and Roof. Model these.
   - **NR_Envelope**: frozen and see-through. This is where the game's own shell is.
   - **NR_Context**: frozen. A whole car of that style, with lamps, trim and wheels, for reference.
3. Model. **Check** shows how far each shell's box has moved, in mm.
4. **Export for game** writes `to-game\car-<style>.fbx` next to the file you opened.

Back in the repo:

```sh
npm run max:import -- <path>\to-game                 # or a single car-<style>.fbx
npm run max:import -- --dry-run <path>\to-game       # judge it, change nothing
npm run max:import -- --mirror <path>\to-game        # make it symmetric first
```

## The rules the game enforces

- **Within 10 mm of the Envelope.** The game compares every authored shell with the shell it builds from the car's profile in `src/game/cars.ts`. It checks the bounding box and the skin (25 downward rays). If a shell is more than 10 mm off, the game **silently** uses its own shell instead (`shellFit` in `src/game/models.ts`). `max:import` runs that same test, and refuses the file with the slot, the distance and the worst face.

  So Max is for refining the surface: crisper creases, better transitions, cleaner reflections. A real change of silhouette means changing the profile in `cars.ts`, which is a separate job.
- **Exactly one Body, one Canopy and one Roof.** The Canopy is all the glass, and it is one closed solid.
- **Keep the frame as it arrived:** metres, Z up, nose toward the Front view, centred on X = 0. Move the shells, not the frame.
- **Symmetric across X = 0.** `check:shells` needs at least 99.5% of triangles to have a mirrored twin. The Symmetry modifier, or `--mirror` on import, handles this.
- **Closed and facing outward.** The game draws shells single-sided. A shell that is inside-out as a whole is flipped on import; a single flipped patch is not.
- **About the shipped triangle count.** The panel's Check warns past 1.5×, because every car on the road pays for it.

## What `max:import` does

1. **Convert** (`import_from_max.py`, Blender): FBX to GLB, the way `tools/blender/build_assets.py` exports. Only the three named meshes are kept, and transforms and modifiers are baked in. Wrong units are caught by the car's length: a file at 100× or in inches is rescaled with a warning, and anything else is refused.
2. **Fit**: `scripts/check-shell-fit.mjs`, the game's own accept test.
   - A slot that was already rejected in the shipped file gets a warning, not a refusal. Today that is the hatch and super canopies.
3. **Mirror**: `npm run check:shells`.
4. **Glass**: `npm run test:glassfit`, which checks that the glass still lands on the body.

Only when all four pass is `public/models/car-<style>.glb` replaced. `build.json` then records `"source": "3ds Max"`, and the browser cache key changes. Any failure puts every file back as it was.

From then on, `npm run sync:models` (the Blender re-loft) **skips** that style instead of overwriting your work. Pass `--overwrite-max` to `build_assets.py` to re-loft it anyway.

## Checking what ships

```sh
npm run check:shell-fit                     # every shipped shell, as the game judges it
npm run check:shell-fit -- some/car-gtr.glb
```

## Tested here, and not

There is no 3ds Max on the build machine, which runs Linux. The Blender half was tested end to end, with Blender standing in for Max:

- **Round trip:** export, then import, gives drift identical to the shipped files, and all gates pass.
- **Edits:** a roof raised 5 mm imports; a roof raised 20 mm is refused, and nothing changes.
- **Units:** a file at inch scale is rescaled.
- **Protection:** the Blender rebuild skips a style marked `3ds Max`.

`nightracer.ms` was written against the MAXScript and FBX importer/exporter documentation, but has not been run. If anything in it fails in your version of Max, the listener will name the line.
