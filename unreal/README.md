# Gulf Road Nights — Unreal Engine 5 build

The full game on UE 5.4: same 7.3 km Gulf Road spline, same arcade
handling, same TXR battle rules as the web build — as a **code-only C++
project**. There are no binary `.uasset`s in the repo; everything is
generated at runtime from engine primitives, so the whole project is
reviewable, diffable text.

## Open it

1. Install **Unreal Engine 5.4+** from the Epic Games Launcher (with the
   C++ toolchain: Visual Studio 2022 on Windows, Xcode on macOS).
2. Right-click `GulfRoadNights.uproject` → *Generate project files*,
   or just double-click it and accept the "rebuild module" prompt.
3. Press Play. The game mode spawns the track, world, player and first
   rival automatically — no map setup needed.

## The data API

The Unreal build does not just *copy* the web game's numbers — it can
**fetch** them. At boot `UGRNApiSubsystem` requests
`/api/grn/v1/gamedata` and, on success, replaces the compiled-in tables
with live ones: roster, showroom, handling constants, even the track's
control points (the spline is rebuilt from them). If the fetch fails —
offline, LAN, a plane — the tables baked into `GRNTypes.h` stand in and
the game plays identically. A payload whose `apiVersion` the client does
not recognise is rejected in favour of the baked data, and a partial
payload is refused outright: half a roster is worse than none.

| Endpoint | Serves |
| --- | --- |
| `GET /api/grn/v1/manifest` | discovery: version, endpoint list, counts, hub URLs |
| `GET /api/grn/v1/gamedata` | everything in one fetch (what the game uses) |
| `GET /api/grn/v1/track` | control points, road width, lane offsets |
| `GET /api/grn/v1/rivals` | the roster with colours, top speeds, prizes, voice lines |
| `GET /api/grn/v1/cars` | showroom + garage parts |

These are statically generated, so they also ship inside the static
export (`out/api/grn/v1/…`) and are served by the Electron shell — a
packaged Steam build can point the Unreal client at its own bundled
copy with no server at all.

The hub server adds the write side at `http://<hub>:8787/api/v1`:

| Endpoint | Purpose |
| --- | --- |
| `GET /status` | health, players online, teams, uptime |
| `GET /leaderboard` | session best laps |
| `POST /lap` `{name,ms}` | submit a lap; replies whether it is a personal best |
| `GET /career/:name` | pull a cloud career |
| `PUT /career/:name` | push one (4 KB cap) |

`UGRNApiSubsystem::SubmitLap` / `PushCareer` / `PullCareer` wrap those.
Point a build elsewhere without recompiling:

```
GulfRoadNights.exe -grnapi=https://your-site -grnhub=http://your-hub:8787
```

### Drift protection

`npm run check:unreal` fetches the live API and diffs it against
`GRNTypes.h` — track points, every rival's name/crew/colour/top
speed/body, every car's price and handling figures, the shared handling
constants, and the API version both sides claim. It exits non-zero on
any mismatch, so the offline tables can never silently disagree with
what an online client is racing.

## Staying in sync with the web build

The data tables in `GRNTypes.h` are **generated** — never edit them by
hand. When `src/game/{track,rivals,mods}.ts` change, run from the repo
root:

```bash
npm run sync:unreal     # regenerates GRNTypes.h and GRNSimConstants.h
```

and commit the regenerated headers. Track geometry, the rival roster,
the full 14-car showroom and the handling constants all flow from the
TypeScript source of truth into UE5 in one step.

`GRNSimConstants.h` is the second generated header, and it carries every
constant **twice**: `namespace GRNHandling` at `float` for the engine
code, and `namespace GRNExact` at `double` for the solvers in
`GRNSim.h`. That is not belt-and-braces — see the parity section above
for the frame where a float rounding difference changed a discrete
decision and the two builds never converged again.

## The simulation core — the same solver, not the same numbers

For a long time the ports carried the web build's *constants* and wrote
their own *code* around them. That is a weaker guarantee than it looks:
`check:unreal` could report every figure in agreement while the two
builds drove differently, because a table of numbers says nothing about
what is done with them. The drift clamp was exactly that — the same
figure, applied at a different point in the step.

`GRNSim.h` closes it. It is an **engine-free header** — no
`CoreMinimal.h`, no `FVector`, nothing but `<cmath>` — holding
double-precision ports of the three solvers the web build runs each
frame:

| Web build | `GRNSim.h` |
| --- | --- |
| `grip.ts` — load transfer, downforce, sub-linear grip | `GripAtSpeed`, `SolveLoad` |
| `brakes.ts` — lock-up, ABS pulsing, disc heat, fade | `SolveBrakes` |
| `drift.ts` — entry types, chain, bank, snap-back | `SolveDrift` |

`AGRNVehiclePawn::UpdateHandling` calls them rather than reimplementing
them, so a change to the feel of the car is a change in one file that
both engines then run.

Because it is engine-free, it **compiles with bare `g++`** — which is
what makes the next part possible.

### Fixed tick

The web build steps physics at a fixed rate and interpolates the render
pose; the UE5 pawn now does the same. `GRNSimHz` is 120, `GRNSimMaxSteps`
caps a frame at 8 sub-steps and `GRNSimMaxFrame` clamps a stalled frame
to 0.25 s, so a hitch cannot spiral into a slower and slower catch-up.
`StepSim()` advances the state; `ApplyRenderPose()` blends the previous
and current states by the leftover accumulator fraction. The camera is
framed on the pose actually **shown**, not the one last solved, or it
judders by exactly the interpolation it was meant to hide. Lap position
interpolates through `Track->DeltaAhead` so the wrap at the start line
goes the short way round rather than sweeping 7.3 km backwards.

Frame rate and simulation rate are now independent: 30 fps and 240 fps
solve the identical trajectory.

### The parity harness

`npm run test:parity` compiles `tools/parity/parity.cpp` with `g++`,
runs the same scripted drive through the TypeScript solvers under Node,
and compares 14 state fields step by step.

The script is **cycled, not random**. White-noise inputs never spin the
car, never chain two drifts and never bank a run — the branches that
matter are the ones that need a *sequence*. So it cycles seven
manoeuvres: cruise, flat out, threshold brake, left-foot trail brake,
handbrake → lock-in → hands-off, transitions with a slow release, and
lift-off. A 240-step run-up brings the car to speed first, because a
trail-brake entry at 20 m/s peaks below its own threshold and silently
tests nothing.

Current state: **16 000 steps, worst disagreement 5e-12 relative**, and
`chain` — an integer — matching exactly. All twelve solver branches are
covered by construction, and the test fails if any of them stops being
reached.

Two real divergences came out of it. Float constants alone were enough:
one frame the two builds sat either side of a threshold, took different
discrete branches, and separated permanently — so the generator now
emits `namespace GRNExact` at `double` precision alongside the `float`
constants the engine code uses. The other was a stale duplicate line in
the C++ left behind by a merge. Neither was visible to a constant diff.

## What maps to what

| Web build (`src/game/`) | UE5 (`Source/GulfRoadNights/`) |
| --- | --- |
| `track.ts` — control points, S/Lat space | `GRNTrack` (USplineComponent, same 17 points) |
| `engine.ts` handling: thrust/drag, heading | `GRNVehiclePawn::UpdateHandling` — constants copied 1:1 into `GRNTypes.h`, stepped at a fixed 120 Hz with render interpolation |
| `grip.ts`, `brakes.ts`, `drift.ts` — the three solvers | `GRNSim.h` — engine-free ports, called by `UpdateHandling`, verified step-for-step by `npm run test:parity` |
| `engine.ts` battle rules: SP drain, flash ritual | `AGRNGameMode` (drain curve identical) |
| `rivals.ts` roster | `GRNRivals[]` in `GRNTypes.h` |
| `mods.ts` showroom | `GRNCars[]` — applied to the pawn by `ApplyCar`; Tab / D-pad-right cycles machines until the UMG garage lands |
| pre-battle cinematic (slow-mo film) | time dilation 0.22× + a real camera flying the same three shots (rival orbit → side pass → chase pull-back), Start/Esc skips |
| `world.ts` road, rails, cobra-head street lights | `AGRNWorldBuilder` — procedural road ribbon + instanced lights **with real Lumen spot lights per lamp** |
| `cars.ts` three silhouettes | `GRNCarFactory` — primitive-built sedan / Z-wedge / R34-style coupe with paint MIDs, spinning wheels, brake-flare tail lamps, real headlight beams; wing only when the part is owned |
| `ik.ts` two-bone solver + constrained aim | `GRNIk::SolveTwoBone` / `GRNIk::AimConstrained` — the same closed-form law of cosines, same pole-plane basis, same world-scale lift |
| `characters.ts` driver rig, `driver.ts` `solveDriverRig` | `GRNDriverRig::Build` / `::Solve` — hands IK'd onto the rim, feet onto pedals that sink with the inputs, eyes into the corner, and a `Lean` joint between the root and the body so the driver leans away from lateral g and folds under braking while the hands stay pinned to grips bolted to the car. Driven for the player (`AGRNVehiclePawn::UpdateDriver`) and the rival (`AGRNRival::UpdateDriver`, including the look-over when you pull alongside) |
| `world.ts` `setCrowdFocus` — the watching, waving crowd | `AGRNWorldBuilder::BuildCrowd` / `::SetCrowdFocus`, ticked by the game mode with the player's position |
| `rig.ts` bone lengths, joint offsets, grip angles, neck limits | `namespace GRNRig` in `GRNTypes.h` — generated, and every field compared by `npm run check:unreal` |
| traffic | `AGRNTraffic` × 30, matching the web build, with its shunt rules (speed clamp, hitbox knock-out, SP cost in battle) |
| HUD (React) | `AGRNHud` Canvas drawing (swap for UMG in the art pass) |
| localStorage saves | `UGRNSaveGame` slot "GulfRoadNights" |
| Gamepad (browser Gamepad API) | `DefaultInput.ini`: sticks/triggers/face buttons, same layout |

## Renderer — full UE5, max resolution by default

The game boots at the renderer's ceiling. `GRNGraphics::ApplyMax` runs
before the first frame and sets:

- **Native desktop resolution, fullscreen**, VSync off, frame cap off —
  `r.ScreenPercentage 100`, no hidden upscale.
- **Cinematic scalability** (level 4) across every group.
- **Lumen** GI + reflections at raised quality (probe resolution 32,
  radiosity spacing 2, rough reflections traced to 0.6) — the sodium
  lamps light the asphalt for real and car paint reflects the actual
  scene. **Hardware ray tracing** feeds Lumen on GPUs that have it
  (`r.Lumen.HardwareRayTracing`, hit-lighting mode); software Lumen is
  the automatic fallback.
- **Nanite** enabled project-wide, ready for scanned car/city meshes.
- **Virtual shadow maps** at zero LOD bias; **TSR** at its
  highest-quality history preset; SSR/refraction/translucency at max;
  a 4 GB streaming pool so nothing pops on the 7 km lap.

`Config/DefaultScalability.ini` defines a Cine tier above Epic (denser
Lumen probes, sharper VSM) and keeps even lower rungs on Lumen + VSM.
Players can pull any dial down from the console or a future settings
screen — ApplyMax sets the ceiling, not a cage. Motion blur stays off
and sharpen at 0.4, matching the web build's comfort grade.

For marketing stills, the Path Tracer is one console command away
(`r.PathTracing 1`) and `HighResShot 3840x2160` captures native 4K.

### 4K / 2K and the NVIDIA path

`GRNGraphics` takes an explicit output preset as well as the native
default, so a player can render 4K on a 1440p panel or drop to 1440p on a
4K one:

```
GulfRoadNights.exe -grn4k          # 3840 x 2160
GulfRoadNights.exe -grn2k          # 2560 x 1440
GulfRoadNights.exe -grn1080        # 1920 x 1080
GulfRoadNights.exe -grndlss=perf   # DLSS Performance instead of Quality
GulfRoadNights.exe -grnnonvidia    # skip the NVIDIA path entirely
```

The shadow atlas and streaming pool scale with the preset rather than
sitting at one compromise value — a 4K frame carries 2.25x the pixels of
1440p, and a shadow atlas sized for 1440p shows it.

`ApplyNvidia` turns on hardware ray tracing for Lumen (GI, reflections
and translucency), ray-traced shadows and AO, and pushes reflections past
the usual roughness cutoff to 0.75 — wet asphalt under sodium light is
the entire look of a night corniche, and that is exactly the roughness
range it lives in.

DLSS and Reflex are **plugin-provided**. The console variables are set
unconditionally because an unrecognised variable is a no-op, so the same
build stays correct on AMD, Intel and in the editor. Install the DLSS
plugin from the Epic marketplace to activate them. DLSS Quality is the
default rather than Performance: at 4K it renders 1440p internally, which
on an RTX card is both faster and sharper than native 4K through TSR.

### The 5090-class profile

`-grnrtxultra` layers a top-end RTX profile on top of the NVIDIA path.
It is deliberately opt-in because every line of it costs real
milliseconds:

- **Lumen traced far denser** — probe resolution 64, octahedron 16,
  radiosity spacing 1, reflections traced to roughness 1.0. The corniche
  is lit almost entirely by many small sodium sources, which is the case
  that punishes a sparse probe grid hardest.
- **Ray-traced shadows and AO at 4 samples per pixel** rather than the
  denoised default — the lamp posts cast the long shadows the whole look
  rests on, and they are what shows undersampling first.
- **Nanite and virtual shadow maps unclamped** (0.5 px per edge, 16k
  pages, 16 SMRT rays), volumetric fog at a 4 px grid, and a 12 GB
  streaming pool, because a 5090 carries 32 GB and there is no reason to
  stream conservatively.
- **DLSS Ray Reconstruction** replaces the hand-tuned denoisers with the
  trained one — the single biggest win for ray-traced detail.

**Frame Generation is opt-in on top of that** (`-grnframegen`). It
roughly doubles displayed frame rate but adds a frame of latency, and in
a game decided by when you lift for a corner that is a trade only the
player should make — so it is never forced on.

`-grnpathtrace` switches to the path tracer at 2048 spp for marketing
stills. It converges over many frames, so it is a capture tool, not a
gameplay mode.

**Building it is a Windows job.** This repo carries the source, the
config and the data pipeline — it cannot compile or package itself here.
Generate project files, open in UE 5.4+, and package for Win64. The DLSS
options above additionally need the NVIDIA DLSS plugin installed; without
it those console variables are simply unrecognised and ignored.

## Where to take it next

- **Cars**: the primitive rigs drive and read correctly today; swap
  `GRNCarFactory::Build` internals for Nanite car scans when art lands —
  the rig API (wheels, paint MID, tail MID, headlight) stays.
- **Garage/results/menus**: the data tables are in `GRNTypes.h`; build
  the screens in UMG against `AGRNGameMode`'s state.
- **Audio**: port `sound.ts`'s synth via MetaSounds (the layered
  engine/skid/wind graph maps almost node-for-node).
- **Steam**: package via *Platforms → Windows → Package Project*, then
  the same SteamPipe scripts as `../desktop/steam/` (point ContentRoot
  at the packaged build). Use the Online Subsystem Steam plugin for
  achievements/overlay.

- **Unity**: the `../unity/` port is still at the earlier standard —
  `GRNData.cs` carries the numbers, not the solvers. Porting `GRNSim.h`
  to C# and extending `tests/parity.mjs` to a third column is the same
  job again, and the harness is already shaped for it.

The Unity 6 port lives in `../unity/` and the shipping web/Electron
build in the repo root — three engines, one game design. The web build
remains the source of truth for gameplay feel; when tuning constants
change there, run `npm run sync:unreal` rather than editing
`GRNTypes.h`/`GRNSimConstants.h`, and let `npm run test:parity` confirm
the two builds still drive the same car.
