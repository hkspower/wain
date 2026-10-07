# The Black Demon in real Unreal Engine 5

A kit that renders the catalogue's Black Demon — the same 310,000-triangle
export behind `press/renders/black-demon.png` — in Unreal Engine 5.8 on a
Mac: three 4K studio stills, a ten-second turntable, and the car parked
on the night Gulf Road the port builds for itself.

**Nothing here has run yet.** The repository's machines have no Unreal
(see `../README.md`), so this was written against Epic's documentation
and checked only as text and arithmetic (`npm run test:showcase`,
`node scripts/check-unreal-project.mjs`). The first run on a real
engine is part of the work: it will find names that moved. That is what
`probe` is for, and why every step writes a log.

## The studio is the Blender studio

`tools/blender/studio.py` is the one definition of the stage the cars are
shot in — five area lights, a black glossy floor, three shot angles and
a camera fitted to the car's box. `showcase_math.py` imports it and moves
it into Unreal's frame (centimetres, X forward), so the UE5 hero is lit
and framed exactly as the Cycles hero in `press/renders/`, and the two
can be set side by side. The car's paint is the port's own Substrate
clear-coat material (`GRNPaint.h`) with the GLB's numbers: colour
#0b0a0d, metalness 0.326, roughness 0.24, clear coat 1 at 0.045.

## On the Mac

Once: Unreal Engine 5.8 from the Epic Games Launcher with its C++
toolchain, Xcode 26.1.1 (`../mac/connect.sh` checks it), and the project
opened in the editor once so it builds and makes the car paint
(`/Game/GRN/Generated/M_GRNCarPaint_v1`). Then, from the repository:

```sh
unreal/Showcase/run.sh probe            # 1. what this editor's Python has; nothing is made
unreal/Showcase/run.sh build            # 2. import the car, build the studio map, sequences, presets
unreal/Showcase/run.sh preview hero     # 3. 960x540 in a minute or two: is the light right?
unreal/Showcase/run.sh render all       # 4. three 4K stills and the turntable (an hour or more on an M2)
unreal/Showcase/run.sh night city       # 5. the game's own corniche, 1080p (also: coast)
unreal/Showcase/run.sh encode           # 6. turntable.mp4 and JPEG copies
```

Frames land in `press/unreal/black-demon/` (`stills/`, `turntable/`,
`night/`, `preview/`), logs in `logs/`, and `build.json` records what
`build` found: the importer's axis rule, the mesh bounds, the paint slot,
every warning.

### What to send back after the first run

The log `run.sh` names, and `build.json`. If `probe` lists anything as
MISSING, that alone — the fix is a renamed class, not a design change.
Expect one or two rounds: `GRNShowcase.cpp` in particular has never met
a compiler.

### Tuning the look

Two numbers in `showcase_math.py`, both printed by `build`:

- `LIGHT_SCALE` multiplies all five lights together (683 lm/W is the
  conversion; the five keep their ratio).
- `EV100` is the manual exposure (default 9.3: the key's illuminance at
  the car, less the 0.74 EV the Blender set is opened by).

Change one, run `build` again, `preview hero` again.

### What the Mac cannot do

The path tracer is not supported on macOS, so these are deferred
renders: Lumen GI and reflections, MegaLights, Substrate, Nanite, with
Movie Render Queue's temporal samples (32 on a still) doing the
accumulation. Hardware ray tracing on an M2 is experimental and left to
the project's own setting.

## The pieces

| File | What |
| --- | --- |
| `showcase_math.py` | Every number, no engine: frames, the GLB reader, the studio in UE units, the axis probe. `python3 unreal/Showcase/test_showcase_math.py`. |
| `grn_showcase.py` | Runs inside the editor: `probe`, `build`, `report`. |
| `grn_night.py`, `init_unreal.py` | The night shot's Movie Render Queue executor; it runs the game, not a map. |
| `run.sh` | The Mac wrapper: finds the engine, runs each step, keeps the logs. |
| `black-demon.glb` | The car, 12 MB, as `tools/shots/export-cars.mjs` wrote it. |
| `../Source/GulfRoadNights/GRNShowcase.*` | The game's handle for the night shot: select the car, dress it, park it, clear the road. |

## How the import is kept honest

The importer's mapping of glTF axes onto Unreal's is not assumed. `build`
first imports a 3 x 1 x 2 m probe box through the same pipeline and reads
the rule off its bounds, then finds the car's nose in the GLB from its
head-lamp and tail-lamp nodes, and imports the car with the yaw that puts
that nose on +X — and checks the result's bounds: 4.66 m along X. If the
pipeline ignores the yaw, the studio actor is turned instead and
`build.json` says so (the night-scene body then needs the yaw baked by
hand in the static mesh editor).
