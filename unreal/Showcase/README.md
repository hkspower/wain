# The catalogue in real Unreal Engine 5

A kit that renders the game's cars in Unreal Engine 5.8 on a Mac: for
every car in `press/renders/cars.json`, a studio hero, side and rear at
2560 x 1440 (the size of the Blender renders, so a car and its Cycles
twin compare pixel for pixel); for the Black Demon also three 4K stills
and a ten-second turntable; and any car parked on the night Gulf Road
the port builds for itself.

**Nothing here has run yet.** The repository's machines have no Unreal
(see `../README.md`), so this was written against Epic's documentation
and checked only as text and arithmetic (`npm run test:showcase`,
`node scripts/check-unreal-project.mjs`). The first run on a real
engine is part of the work: it will find names that moved. That is what
`probe` is for, and why every step writes a log.

## The studio is the Blender studio

`tools/blender/studio.py` is the one definition of the stage the cars are
shot in — five area lights, a black glossy floor, three shot angles and
a camera fitted to each car's box. `showcase_math.py` imports it and
moves it into Unreal's frame (centimetres, X forward), so every UE5 hero
is lit and framed exactly as its Cycles hero in `press/renders/`. A
car's paint is the port's own Substrate clear-coat material
(`GRNPaint.h`) with that car's numbers read from its GLB: colour,
metalness, roughness and clear coat, so a matte car comes out matte.

## On the Mac

Once: Unreal Engine 5.8 from the Epic Games Launcher with its C++
toolchain, Xcode 26.1.1 (`../mac/connect.sh` checks it), node, and the
project opened in the editor once so it builds and makes the car paint
(`/Game/GRN/Generated/M_GRNCarPaint_v1`). Then, from the repository,
the first time with ONE car, because the first run is where names that
moved show up:

```sh
unreal/Showcase/run.sh probe                        # 1. what this editor's Python has; nothing is made
unreal/Showcase/run.sh build black-demon            # 2. import it, build its studio, sequences, presets
unreal/Showcase/run.sh preview black-demon hero     # 3. 960x540 in a minute or two: is the light right?
unreal/Showcase/run.sh render black-demon hero      # 4. the real frame, 2560x1440
```

Then the rest:

```sh
npm run dev                                         # in another terminal: export boots the web build
unreal/Showcase/run.sh export                       # 5. the other 16 cars' GLBs (168 MB, git-ignored)
unreal/Showcase/run.sh build all                    # 6. every car; one that fails does not stop the rest
unreal/Showcase/run.sh render all                   # 7. hero, side, rear for each (+ the Black Demon's turntable)
unreal/Showcase/run.sh sheet                        # 8. a 4-wide contact sheet of every hero
unreal/Showcase/run.sh compare                      # 9. Blender and Unreal side by side, with the brightness gap
unreal/Showcase/run.sh night city falcon-720        # 10. a car on the game's own corniche (default black-demon)
unreal/Showcase/run.sh encode                       # 11. turntable.mp4 and JPEG copies
unreal/Showcase/run.sh report                       # what build recorded, car by car
```

`render` also takes one shot (`hero`, `side`, `rear`, `turntable`) and
`--4k` for the Black Demon's 3840 x 2160 with 32 temporal samples.
Frames land in `press/unreal/<id>/` (`stills/`, `stills4k/`, `turntable/`,
`night/`, `preview/`), logs in `press/unreal/logs/`, and `build` writes
`press/unreal/<id>/build.json` per car and `press/unreal/fleet.json`
for all of them: the importer's axis rule, each mesh's bounds against the
card's length, the paint slot, every warning.

### Reading the comparison

`compare` tiles each car's Blender render beside its Unreal hero and
prints the gap in mean brightness in stops. A gap that is the same for
all 17 cars is a setting (`LIGHT_SCALE` or `EV100`, below), not 17
faults. The car whose gap is far from the others, or whose nose points
the wrong way, or whose paint reads as the wrong finish, is the one to
open first, and its `build.json` says what the import found.

### What to send back after the first run

The log `run.sh` names, `fleet.json` and, for a car that looks wrong,
its `build.json`. If `probe` lists anything as MISSING, that alone — the
fix is a renamed class, not a design change. Expect one or two rounds:
`GRNShowcase.cpp` in particular has never met a compiler.

### Tuning the look

Two numbers in `showcase_math.py`, both printed by `build`:

- `LIGHT_SCALE` multiplies all five lights together (683 lm/W is the
  conversion; the five keep their ratio).
- `EV100` is the manual exposure (default 9.3: the key's illuminance at
  the car, less the 0.74 EV the Blender set is opened by).

Change one, run `build all` again, `preview` again.

### On a MacBook M2, at full power

`build` and `render` read the machine first — the chip, its one pool of
memory, the performance cores and the GPU cores (`sysctl`, and
`system_profiler` for the GPU count, which is the only place it is
written down) — and size every preset for it. `showcase_math.mac_profile`
is the rule, and it keeps two things apart:

- **Memory decides the tiles.** A 3840 x 2160 frame rendered as one tile
  holds the whole G-buffer, Lumen's scene and the accumulation buffers at
  once; on 8 GB shared with the editor that is the swap file, which on a
  Mac is silent and ten times slower. Tiles cut the frame into pieces
  rendered one after another and stitched, at the same quality. Under
  12 GB: 2 x 2 at 2560 x 1440 and 3 x 3 at 4K. 12 GB and up: one tile
  and 2 x 2.
- **GPU cores decide the temporal samples.** Each is a whole extra render
  of the frame, so they turn cores into quality at a fixed wall-clock
  cost: the 8-core M2 keeps the kit's 16 / 32, a Pro (16 or 19 cores)
  takes 24 / 48, a Max or Ultra 32 / 64, for about the same minutes a
  frame.
- The streaming pool is a quarter of memory between 2 and 12 GB; Lumen
  is told to trace in software (an M2 has no ray-tracing hardware, and
  Metal's path for it on later chips is experimental); TSR's history
  stays native rather than 2x, because unified memory is bandwidth the
  CPU is also using.

The profile is printed when `build` starts, written into each car's
`build.json` under `machine`, and `../mac/connect.sh` prints it before
anything is built. Elsewhere, or if a reading fails, the kit's defaults
stand. None of these numbers is a measurement: they are where to start
on each machine, and `run.sh preview` is the clock. The path tracer is
still not supported on macOS, so every frame is a deferred render with
Movie Render Queue's samples doing the accumulation. How long 17 cars
take is not known: time the first one, and the profile tells you what
it was timed under.

## What to compare against

`press/unreal/black-demon/stand-in/` holds the Black Demon's shots made
by the renderers this repository can run: `cycles-hero.jpg`,
`cycles-side.jpg`, `cycles-rear.jpg` from the Blender studio, and
`web-night-city.jpg`, `web-night-coast.jpg` from the game itself
(`CAR=black-demon PAINT=factory node tools/shots/ik4k.mjs`). Every
car's Cycles hero is `press/renders/<id>.png`
(`npm run cars:render`). The Cycles turntable preview is not in git; it
lives on the render board.

## The pieces

| File | What |
| --- | --- |
| `showcase_math.py` | Every number, no engine: per-car paths, the catalogue, frames, the GLB reader, the studio in UE units, the axis probe, the Mac's render profile. |
| `grn_showcase.py` | Runs inside the editor: `probe`, `build [id\|all]`, `report`. |
| `grn_night.py`, `init_unreal.py` | The night shot's Movie Render Queue executor; it runs the game, not a map. |
| `run.sh` | The Mac wrapper: finds the engine, runs each step, keeps the logs. |
| `black-demon.glb` | The one car carried in git, 8 MB; the other 16 come from `run.sh export`. |
| `test_showcase_math.py`, `test_dry_run.py` | `npm run test:showcase`: the arithmetic, every exported GLB, and `build all` against a stand-in engine. |
| `../../tools/shots/ue-compare.mjs` | The Blender-against-Unreal sheet; `npm run cars:ue-compare:rules` checks the tool. |
| `../Source/GulfRoadNights/GRNShowcase.*` | The game's handle for the night shot: select the car, dress it, park it, clear the road. |

## How the import is kept honest

The importer's mapping of glTF axes onto Unreal's is not assumed. `build`
first imports a 3 x 1 x 2 m probe box through the same pipeline (once per
run) and reads the rule off its bounds, then finds each car's nose in its
GLB from its head-lamp and tail-lamp nodes (all 17 carry both), and
imports the car with the yaw that puts that nose on +X — and checks the
result's bounds against the length on the car's card. If the pipeline
ignores the yaw, the studio actor is turned instead and the car's
`build.json` says so (the night-scene body then needs the yaw baked by
hand in the static mesh editor).
