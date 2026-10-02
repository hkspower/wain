# Car shells in 3ds Max

Each car's painted body and glass come from three meshes in `public/models/car-<style>.glb`: **Body**, **Canopy** and **Roof**. This folder lets you model them in 3ds Max and bring them back into the game. Inside Max you get the game's own checks, a drift heatmap and fix tools.

The game builds everything else itself: lamps, trim, wheels, mirrors, paint and glass materials.

## The loop

```sh
pip install bpy          # Blender as a Python module, once
npm run max:export       # press/max/: car-<style>.fbx and car-<style>.nr.json, all nine styles
```

In 3ds Max:

1. **Scripting → Run Script… →** `tools/max/nightracer.ms`.
   - This opens the **Night Racer** dock panel.
   - It also adds a **Night Racer** menu and macro category.
   - Menu → **Install at startup** makes the menu load on every launch.
2. **Open style…** and pick `press/max/car-<style>.fbx`. Its `.nr.json` must sit beside it. Four layers come in:
   - **NR_Edit**: Body, Canopy and Roof. Model these.
   - **NR_Envelope**: frozen and see-through. The shells lofted fresh from today's profiles, uncrowned: what the game expects, in your modelling frame.
   - **NR_Target**: hidden. The game's own shells, crowned. The checks measure against these.
   - **NR_Context**: frozen. A whole car of that style, with lamps, trim and wheels, for reference.
3. Model. Press **Check** as often as you like. Use the **heatmap** to see where you are.
4. **Export for game** writes `to-game\car-<style>.fbx` next to the FBX you opened.

Back in the repo:

```sh
npm run max:import -- <path>\to-game                 # or a single car-<style>.fbx
npm run max:import -- --dry-run <path>\to-game       # judge it, change nothing
```

## The panel

| Section | What it does |
|---|---|
| **File** | **Open style…** (metres, FBX import, layers, style data stored in the scene) and **Save work** (`car-<style>.max` next to the FBX). |
| **Check** | The game's own tests, per shell. Before comparing, it crowns your shell exactly as the game does. Then: box drift and skin drift against the game's shell (the game drops a shell past **10 mm**), mirror twins (99.5% needed), open edges, facing, and triangles against 1.5× the shipped count. A slot that is already rejected in the game today says so. |
| **Heatmap** | Colours a copy of each shell, on the `NR_Heatmap` layer, by how far its crowned surface sits from the game's shell: green under 5 mm, amber 5–10 mm, red past 10 mm. The thresholds are editable. **Show heatmap / Show shells** swaps between the copies and your shells. A whole car takes about a minute. |
| **Fix** | **Snap selected verts to Envelope** (Editable Poly, vertex selection). **Make symmetric** (Symmetry about X = 0, collapsed). **Recentre on X = 0**. **Turn outward** (flips an inside-out shell). **Replace with Envelope**: swaps a slot for the fresh loft, made symmetric, ready to refine (Undo works). |
| **Export** | **Export for game** runs the checks first and warns before writing anything the game would reject. **Export all .max in folder…** exports every saved `car-*.max` in a folder in one go. |

The panel remembers its folder, its options and where it was docked.

### Heatmap red is not always rejection

The heatmap measures **every vertex**. The game measures the bounding box and 25 points on the skin. A shell the game accepts can still show a small red spot, for example where a lofted edge rolls over differently from the game's own shell. Treat red as "look here". **Check** gives the verdict.

## Already rejected today: the hatch and super canopies

The game currently drops the shipped hatch and super canopies (skin 26 mm and box 31 mm off) and draws its own instead. The fix is in the panel:

1. Open `car-hatch.fbx` (or `car-super.fbx`).
2. **Fix → Replace with Envelope**, with **Canopy** selected in the slot list.
3. Press **Check**: the canopy now passes (hatch: box 0.2 mm, skin 2.0 mm; super: box 0.2 mm, skin 5.1 mm; 100% symmetric).
4. Refine it if you like, then **Export for game** and run `npm run max:import`.

## The rules the game enforces

- **Within 10 mm** of the game's own shell, after crowning: by box, and by skin at 25 points.
  - So Max is for refining the surface.
  - A real change of silhouette means changing the profile in `src/game/cars.ts`.
- **Exactly one** Body, one Canopy and one Roof. The Canopy is all the glass, as one closed solid.
- **Keep the frame as it arrived:** metres, Z up, nose toward the Front view, centred on X = 0.
- **Symmetric** across X = 0.
- **Closed and facing outward.** The game draws shells single-sided.

## Versions

| 3ds Max | What you get |
|---|---|
| 2025, 2026 | Python dock panel (PySide6); the menu uses the new menu system |
| 2023, 2024 | Python dock panel (PySide2); menu through `menuMan` |
| 2020–2022 | The classic panel (`nightracer_classic.ms`): Open, a box-only Check, Export |

## Files

| File | Role |
|---|---|
| `nightracer.ms` | Loader: Python path, macros, menu, startup install |
| `nightracer/core.py` | The game's tests in plain Python: crown, fit, mirror, symmetrize, nearest point |
| `nightracer/maxio.py` | Moves meshes between the scene and core.py, and holds the open, export and fix operations |
| `nightracer/panel.py` | The dock panel |
| `nightracer_classic.ms` | The panel for Max 2020–2022 |
| `procedural.mjs` | Writes the game's crowned shells (`*-target.glb`) and `*.nr.json` (crown specs, tolerance, how the game judges the shipped file) |
| `export_for_max.py` | Builds the FBX: Edit, the fresh-loft Envelope, Target and Context |
| `import_from_max.py`, `import.mjs` | FBX back to GLB, gated (`npm run max:import`) |

## Tested here, and not

There is no 3ds Max on the build machine (Linux), so the tests work around it.

- **`npm run test:max-core`:** `core.py` checked against the game's own code on all 27 shipped shells.
  - The crown is within 0.00006 mm of `crownShell`.
  - Box and skin drift are within 0.000 mm of `shellFit`, with the same verdicts, including both rejections.
  - Mirror share, open edges and over-shared edges are identical to `check-shell-mirror.mjs`.
- **`tools/max/test_fbx.py`:** reads every FBX the way the panel does. The verdicts match the game's on all 27 slots, and **Replace with Envelope** fixes both rejected canopies.
- **`tools/max/test_maxio.py`:** runs `maxio.py` on a stand-in scene built from the real FBX, in centimetres, to exercise the unit handling. It covers check, the Envelope fix, recentre, outward, heatmap and export selection.
- **The panel:** built offscreen with PySide6 against that scene: check, replace, toggle and export.
- **The real gate:** the fixed canopies, exported to FBX, pass `max:import --dry-run`: fit, mirror and glass.

**Not run:**
- real 3ds Max: FBX import and export settings, pymxs on real nodes, the Symmetry and Normal modifiers, and the menu registration;
- the classic panel.

These were written against the 3ds Max 2023–2026 MAXScript, pymxs and menu documentation. If something fails, the MAXScript Listener or the Python console names the line.
