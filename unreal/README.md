# Night Racer — Unreal Engine 5 build

The full game on UE 5.8: same 7.3 km Gulf Road spline, same arcade
handling, same TXR battle rules as the web build — as a **code-only C++
project**. There are no binary `.uasset`s in the repo; everything is
generated at runtime from engine primitives, or — for the one asset a
packaged game cannot make for itself, the car paint — built by C++ in the
editor, so the whole project is reviewable, diffable text.

> **Not compiled here.** This repository's machines are Linux boxes with
> no Unreal and no Windows or Apple toolchain. The 5.8 upgrade, the
> MegaLights lamps and the Substrate paint below were written against
> Epic's documentation and release notes — read second-hand, because the
> pages themselves could not be fetched from the machine this was written
> on — and have **never been built or run**. What *was* checked is
> everything a plain-text check can see: `node
> scripts/check-unreal-project.mjs` (no server, no engine) and the paint
> law compiled with a bare `g++`. See "What has and has not been
> verified" below for the line between the two.

## Open it

1. Install **Unreal Engine 5.8** (the 5.8.3 hotfix is current) from the
   Epic Games Launcher, with its C++ toolchain:
   - **Windows:** Visual Studio 2022 17.14 or newer (2026 recommended),
     MSVC 14.38 or newer (14.50 recommended), Windows SDK 10.0.22621 or
     newer.
   - **macOS:** Sonoma 14.5 or newer and Xcode 26.0 or newer — 26.1.1 is
     the recommended one, Epic lists **26.4 as incompatible**, and there
     is a forum report of the 5.8 preview crashing under 26.5.
     `mac/connect.sh` checks the Xcode version for you. Lumen hardware
     ray tracing and MegaLights on a Mac need Apple Silicon M2 or newer
     and are marked experimental there.
2. Right-click `GulfRoadNights.uproject` → *Generate project files*,
   or just double-click it and accept the "rebuild modules" prompt. Two
   modules build: `GulfRoadNights` (the game) and `GulfRoadNightsEditor`
   (editor only — it builds the car paint, below).
3. Let the editor finish opening. The first time, it builds
   `/Game/GRN/Generated/M_GRNCarPaint_v1` into `Content/` and says so in
   the log (`LogGRNPaintEditor`). Shaders compile once; Substrate makes
   that first compile long.
4. Press Play. The game mode spawns the track, world, player and first
   rival automatically — no map setup needed. `GRN.Paint.Status` in the
   console says which paint the cars are wearing and why.

The project pins its engine in three places that must agree — the
`.uproject`'s `"EngineAssociation": "5.8"`, and
`BuildSettingsVersion.V7` with `EngineIncludeOrderVersion.Unreal5_8` in
**both** `Source/*.Target.cs` — and `check-unreal-project.mjs` fails if
they do not. They are pinned rather than `Latest` so the next engine bump
is a diff someone reads, not a side effect: V7 is the settings version
that turns the ReturnType, Dangling and UnreachableCode warnings into
errors.

## On macOS

```sh
npm run dev                  # the web build, in another terminal
unreal/mac/connect.sh        # checks the link, then generates the Xcode project
```

`connect.sh` exists because of one property of this port: **it is built
to fall back.** If `UGRNApiSubsystem` cannot reach the web build it logs
a warning and plays on with the tables compiled into `GRNTypes.h`. That
is the right behaviour — a plane, a LAN party, a Steam Deck — and it is
also why a Mac that cannot reach the server does not fail. It plays a
slightly older game, quietly. The script asks the questions in the order
they actually go wrong: is the engine installed and *which* one, can
this machine reach the server at all, does the payload match what the
connector reads, and only then generates the Xcode project.

Run it with `--check` to do everything except the Xcode step, and
`--url http://192.168.1.20:3000` to point at another machine.

**Ask the game itself** which tables it is using:

```
GRN.Api.Status
```

in the Unreal console (the tilde key, in Play-In-Editor). One line: the
URL, whether the data is live or baked, and — if baked — why.

### App Transport Security

This is the macOS-specific trap. A **packaged** `.app` refuses cleartext
`http://` by default, so the request never reaches a server, the HTTP
layer returns response code 0, and the fallback catches it. A build
blocked by ATS, a build with the server switched off, and a build that
is working perfectly all look identical from inside the game.

- **Play-In-Editor is not affected.** Developing against
  `http://localhost:3000` from the editor works as-is.
- **A packaged Mac build talking to `http://` is.** Merge
  `unreal/Build/Mac/Resources/Info-ATS.plist` into the produced
  `Info.plist`. 5.8 builds Mac apps through the modern-Xcode workflow,
  where a project-level plist template can carry the exception into
  every build; Project Settings → Platforms → Mac → *Additional Plist
  Data* was the route on 5.4 and may still be. Neither has been watched
  working on 5.8 — the plist's own header says what to check. The
  exception is scoped to `localhost` and `.local`; everything else still
  goes through ATS.
- **An `https://` host needs none of it.** Point `-grnapi=` at one and
  delete the file.

> Not verified on a Mac. This repository's checks run on Linux with no
> Unreal and no Apple hardware, so the plist and the Xcode step are
> written from the documented behaviour and have not been watched
> working. What *is* verified is the part that tells you when they have
> not: `npm run check:connector` runs anywhere, and `GRN.Api.Status`
> answers from inside the game.

## Is it actually connected?

```sh
npm run check:connector                              # against localhost:3000
npm run check:connector -- --url http://192.168.1.20:3000
```

Different question from `npm run check:unreal`, and both are worth
having. (A third, `node scripts/check-unreal-project.mjs`, needs no
server at all — see "What has and has not been verified".)
`check:unreal` compares the tables **baked into** `GRNTypes.h` against
the API, so the offline fallback is correct. `check:connector`
compares the **live path**: every JSON field `ParseGameData` reads by
name has to exist in the payload the server is serving right now, the
API versions have to agree, and the tables have to be non-empty. A
renamed field passes the first and fails the second, and the game would
have told you nothing.

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
speed/body, every car's price and handling figures and the finish it
leaves the factory in (against `GRNPaintLaw.h`), the shared handling
constants, and the API version both sides claim. It exits non-zero on
any mismatch, so the offline tables can never silently disagree with
what an online client is racing.

### What a constant check cannot see

Everything above compares two artefacts the generator itself writes, so
they agree by construction. The half written by hand —
`GRNVehiclePawn.cpp`, `GRNRival.cpp`, `GRNDriverRig.cpp` — was compared
with nothing, and this repository has no Unreal toolchain to compile it
with. Two things went wrong in that gap, both found by reading rather
than by any check:

- **The project did not build.** The web build moved the driver's
  look-ahead from a flat distance to a time, so `rig.ts` lost
  `lookAheadM` and gained `lookAheadS`/`MinM`/`MaxM`. `sync:unreal`
  regenerated the header without `DriverLookAheadM`; two call sites went
  on naming it. Every check stayed green throughout, because every check
  was looking at the generated pair.
- **Five constants were decorative.** `DriverElbowMinDeg`,
  `ElbowMaxDeg`, `KneeMinDeg`, `KneeMaxDeg` and `SoftReach` were
  generated and verified for as long as they had existed, and
  `GRNIk::SolveTwoBone` read none of them — so in UE5 an elbow could
  lock dead straight or fold flat, and the joint snapped from bent to
  straight at full extension. The web build has a test for each
  (`npm run test:ik`, sections 5 and 6).

`check:unreal` now also reads the hand-written sources and fails on any
reference to a `GRNRig::`/`GRNHandling::`/`GRNFuel::` constant the
generated header does not define — a build error is plain text on both
sides, so catching it needs no compiler. It prints the reverse figure
too: how many generated constants no port source reads. That is 69 of
309 today, nearly all of them features this port has not ported (the
plants, the fuel model, the gearbox's shift timing). It is reported
rather than failed, because a port being incomplete is a fair state to
be in — and because the IK limits above sat in exactly that list.

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
| `world.ts` road, rails, cobra-head street lights | `AGRNWorldBuilder` — procedural road ribbon + instanced lights **with a real spot light per lamp**, shadowed by MegaLights where it is on (see "MegaLights" below) |
| `cars.ts` three silhouettes | `GRNCarFactory` — primitive-built sedan / Z-wedge / R34-style coupe with spinning wheels, brake-flare tail lamps, real headlight beams; wing only when the part is owned |
| `cars.ts` paint (basecoat + clearcoat), `mods.ts` `FINISHES`, `paintMetalness` | `GRNPaint` / `GRNPaintLaw.h` — a Substrate clear coat with the web's measured roughness, finishes and metalness law, falling back to the basic-shape material (see "The car paint" below) |
| `ik.ts` two-bone solver + constrained aim | `GRNIk::SolveTwoBone` / `GRNIk::AimConstrained` — the same closed-form law of cosines, same pole-plane basis, same world-scale lift, and the same hinge range and soft reach edge (`DriverElbowMinDeg`/`MaxDeg`, `DriverKneeMinDeg`/`MaxDeg`, `DriverSoftReach`). Those three were generated and verified for a long time while the solver here read none of them — see "What a constant check cannot see" below |
| `characters.ts` driver rig, `driver.ts` `solveDriverRig` | `GRNDriverRig::Build` / `::Solve` — hands IK'd onto the rim, feet onto pedals that sink with the inputs, eyes into the corner, and a `Lean` joint between the root and the body so the driver leans away from lateral g and folds under braking while the hands stay pinned to grips bolted to the car. Driven for the player (`AGRNVehiclePawn::UpdateDriver`) and the rival (`AGRNRival::UpdateDriver`, including the look-over when you pull alongside) |
| `world.ts` `setCrowdFocus` — the watching, waving crowd | `AGRNWorldBuilder::BuildCrowd` / `::SetCrowdFocus`, ticked by the game mode with the player's position |
| `rig.ts` bone lengths, joint offsets, grip angles, neck limits | `namespace GRNRig` in `GRNTypes.h` — generated, and every field compared by `npm run check:unreal` |
| `driver.ts` `lookAheadFor` — the eyes look by TIME | `GRNDriverRig::LookAheadM` — speed × `DriverLookAheadS`, clamped to `DriverLookAheadMinM`/`MaxM`. Both `UpdateDriver`s call it |
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
  (`r.Lumen.HardwareRayTracing`, hit-lighting mode — what makes the clear
  coat reflect the real road rather than the surface cache's
  approximation of it); software Lumen is the automatic fallback.
- **MegaLights** for the ~170 street lamps and the cars' headlights:
  shadowed area lights at a fixed per-pixel cost, 4 samples per pixel
  (16 on `-grnrtxultra`).
- **Substrate** for the car paint's clear coat, in the Blendable GBuffer
  format.
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
GulfRoadNights.exe -grnnomegalights  # MegaLights off; lamps and headlights unshadowed
```

The shadow atlas and streaming pool scale with the preset rather than
sitting at one compromise value — a 4K frame carries 2.25x the pixels of
1440p, and a shadow atlas sized for 1440p shows it.

`ApplyNvidia` turns on hardware ray tracing for Lumen (GI, reflections
and translucency) and ray-traced shadows for any light MegaLights is not
drawing, and pushes reflections past the usual roughness cutoff to
0.75 — wet asphalt under sodium light is the entire look of a night
corniche, and that is exactly the roughness range it lives in.

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
- **MegaLights at 16 samples per pixel** rather than 4, and ray-traced
  shadows at 4 for anything it is not drawing — the lamp posts cast the
  long shadows the whole look rests on, and a stochastic light sampler
  shows undersampling as crawling noise in exactly those penumbrae.
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
Generate project files, open in UE 5.8, and package for Win64 — the
packaging settings always-cook `/Game/GRN/Generated` so the paint goes
with it (see "The car paint"). The DLSS
options above additionally need the NVIDIA DLSS plugin installed; without
it those console variables are simply unrecognised and ignored.

## MegaLights: the street lamps as real lights

The corniche is lit by about 170 sodium lamps — 7.3 km at one every
42 m — and the cars' own headlights, some thirty of them. Every lamp has
always had a real spot light, and every one of them was **unshadowed**,
because a shadowed light used to mean a shadow map per light and 170
shadow maps is not a frame budget anyone has. (The source said Lumen made
them cheap. Lumen never did: it gathers bounce light from what direct
lighting has already lit. They were cheap because they cast nothing.)

MegaLights changes the arithmetic. It is production-ready in 5.8, and it
prices a shadowed light per **pixel** rather than per light: each pixel
samples a few lights and traces their shadows, so the cost holds still as
the count climbs. So, in `GRNWorldBuilder::BuildStreetLights` and in the
car factory's headlight:

- **Shadows on — where MegaLights is drawing.**
  `GRNGraphics::MegaLightsActive()` needs four yeses:
  `r.MegaLights.EnableForProject` (on, in `DefaultEngine.ini`),
  `r.MegaLights.Allow`, an SM6 renderer (MegaLights has no SM5 path on
  desktop) and hardware ray tracing (`IsRayTracingEnabled()`). Where any
  says no, the lamps are built exactly as before — unshadowed — so an
  engine without MegaLights, a GPU that cannot run it, a device profile
  or `-grnnomegalights` never pays for 170 shadow maps. The log says
  which it built.
- **Not the boot rung.** `DefaultScalability.ini` says `r.MegaLights.Allow`
  off on Low and Medium and on from High, but `ApplyMax` puts every group
  at Cinematic — and saves it — before the world is built, so the first
  build always reads Cinematic's yes. The first version of this switch
  read nothing else, which made it the project switch alone: any GPU,
  including one with no MegaLights, got ~170 lamps and ~30 headlights
  shadowed the old way. What survives `ApplyMax` is what outranks
  scalability (a device profile, `-grnnomegalights`, the console) and
  the GPU itself, and those are what the switch now reads.
- **Following the switch, not just asking once.** Every lamp and
  headlight is made through `GRNGraphics::FollowMegaLights`, which tags
  it and re-applies the answer whenever `r.MegaLights.Allow` or the
  project switch changes. Without that, lowering the rung mid-session
  (`scalability 1`) would turn MegaLights off under lights still built
  shadowed — a shadow map each, the cost the rung was lowered to shed.
  Now they go unshadowed with it, and come back when it is raised.
- **A real source size.** The lamp is 12 cm across and 50 cm long, the
  emitting area of a cobra-head's refractor, and its tube lies along the
  arm as the lantern does. The headlight is 9 cm. A point source puts a
  pinprick in a clear coat; a sized one puts the elongated sodium bar a
  car passing under a real lamp wears — which is half of why the paint
  below looks like paint.
- **Movable, before registering.** A light component defaults to
  Stationary, which promises the renderer precomputed shadowing this
  procedural project never builds.

The lamps keep MegaLights' default shadow method (ray tracing, fixed
cost); the virtual-shadow-map method is per-light expensive. Hardware ray
tracing is required on purpose: without it MegaLights falls back to
tracing the global distance field, whose quality Epic calls significantly
reduced, and whether 5.8 takes that fallback for every light on every
such card could not be confirmed from here. Requiring it costs the
shadows on a GPU that might have drawn them; not requiring it, if the
fallback is not taken, costs a shadow map per lamp. What the switch
still cannot see is what the renderer decides per view — a post-process
volume turning MegaLights off, say. The MegaLights visualisation in the
editor's view modes is the check, and `ProfileGPU` is the cost.

**The road cannot be seen by the software tracers.** It is a
`UProceduralMeshComponent`, which has no mesh distance field, so on a GPU
without hardware ray tracing Lumen's software path (and MegaLights'
distance-field fallback, for any shadowed light it draws there) passes
straight through it. The lamps no longer take that path — without
hardware RT they are unshadowed — but Lumen still does. On hardware RT it
is fine. Moving the road to `UDynamicMeshComponent`, which gained Lumen
support around 5.5, is the fix and a separate job.

## The car paint: a Substrate clear coat

Every car in this port used to wear the engine's basic-shape material
with one parameter set — `Color` — and nothing else: no clear coat, no
metal, the same surface on a matte pickup and a gloss supercar. The web
build's paint is a two-layer thing, a metallic basecoat under a lacquer,
and its numbers were **measured**, not picked: `src/game/cars.ts` records
the basecoat roughness swept from 0.29 to 0.10 against a live frame
(0.29 put 68% of the body inside the highlight; 0.18 put 17% there and
is the knee), and the clearcoat roughness taken to 0.06 because at 0.13
it smeared the lamp it reflected and at 0.03 a flawless coat reads as a
neon strip.

Substrate is what lets Unreal draw that as two layers. The port now does:

| | gloss | satin | matte |
| --- | --- | --- | --- |
| clear coat | 1 | 0.45 | 0 |
| clear coat roughness | 0.06 | 0.42 | 1 |
| basecoat roughness | 0.18 | 0.34 | 0.56 |
| metalness × | 1 | 0.8 | 0.25 |

with the metalness itself from the web's law (`paintMetalness`): metallic
in the mid-tones, falling toward solid for pale paints (at metalness near
1 a white car is a mirror of the sodium sky, and the web fleet's pale cars
came out gold) and for near-blacks (F0 *is* the base colour, and a
metallic near-black reflects about half a percent of the light), and 0
for any paint `paints.ts` declares solid. Across the 17 showroom cars that
is 0 (the satin white Wain Special, a declared solid) to 0.95; the matte
Falcon 720 and Jahra pickup come down to 0.24.

Each car wears the finish it leaves the factory in (`mods.ts`): six of
the seventeen are not gloss. The live path reads it from the API's
`cars[].finish`; the baked path from `GRNPaintLaw.h`; a rival wears the
finish of the car it brings, as `engine.ts` does — so the legend in the
Falcon 720 brings it matte. Not ported, on purpose: `envScale` (a three.js
environment-map gain; under Lumen the reflection *is* the scene) and the
flake and orange peel the web team measured making the car look worse.
A finish bought in the garage is not ported either: this port's save has
no per-car equipped parts yet, so every car wears its factory finish.

### Why it is built by the editor, and what happens when it is not

A packaged game cannot create a material — shaders are compiled at cook
time; at runtime only a dynamic instance of an existing one can be made.
So the clear coat is a real asset, `/Game/GRN/Generated/M_GRNCarPaint_v1`,
built from C++ by the **`GulfRoadNightsEditor`** module (an Editor-type
module: it never reaches the game target):

- **Automatically**, the first time the editor opens a project that does
  not have it (`UGRNPaintEditorSubsystem`, after the asset registry's
  initial scan; never inside a commandlet, so a cook cannot write assets
  behind its own back).
- **Headless**, for CI or before a cook:

  ```
  UnrealEditor-Cmd GulfRoadNights.uproject -run=GRNBuildPaint
  UnrealEditor-Cmd GulfRoadNights.uproject -run=GRNBuildPaint -force
  ```

  `-force` rebuilds it in place. Exit code 1 if the paint was not built —
  including with Substrate off, because a pipeline that asked for the
  paint should stop rather than cook a build that quietly lacks it.

The graph is Substrate *Metalness-To-DiffuseAlbedo-F0* → *Simple Clear
Coat* → Front Material, with six parameters: `Color`, `Metalness`,
`Specular`, `BaseRoughness`, `ClearCoat`, `ClearCoatRoughness`. Each node
input is wired through its C++ member, so a Substrate input that a later
engine renames is a **compile error** rather than a silently unconnected
pin and a grey car. The names live once, in `GRNPaint.h`, and the check
fails if any is typed anywhere else. The version is in the asset's name:
a changed graph becomes `_v2`, and a stale `_v1` simply reads as absent.
`Content/` is gitignored, so the asset never enters the repository — the
graph that makes it is the reviewable part. `DefaultGame.ini` always-cooks
`/Game/GRN/Generated`, because nothing references the paint by anything
but a string; it does the same for `/Game/VehicleVarietyPack`, which had
the same gap and predates the paint — the Fab hero art would not have
been cooked either.

**The fallback.** `GRNPaint::CreatePaintMid` decides once per session, in
the order things go wrong:

1. `r.Substrate` is on, the asset exists, it loads, and it is a material
   → the clear coat, every parameter set.
2. Anything else → a dynamic instance of the basic-shape material with
   `Color` — exactly what every car was before.

It says which, once, at Display (`LogGRNPaint`), and on demand:

```
GRN.Paint.Status
```

in the console: the paint, the reason, the asset path and `r.Substrate`.
It asks again rather than repeating the boot answer, so building the
asset mid-session and running it is enough; the next car built (Tab
cycles yours) picks it up. A hero body from Fab keeps the material it was
authored with either way — see "Respray, plainly" below.

A **v2** graph — a real coat slab over a base slab, joined by Vertical
Layer and weighted by `ClearCoat` — needs the Adaptive GBuffer format
(`r.Substrate.ProjectGBufferFormat=1`) and costs more per pixel. It is
worth building only if side-by-side stills of v1 against the web build at
the same paint colour say v1 is not enough.

## The 5.8 upgrade, line by line

Nothing below was reported removed between 5.5 and 5.8 by any source this
was written from, and the first 5.8 compile is the real test. What
changed, and why:

- **Includes made explicit** where a strict include order stops handing
  them over through the shared PCH: `Misc/CommandLine.h` (GRNApi),
  `Engine/Engine.h` and `Engine/World.h` (GRNHud), `Engine/StaticMesh.h`
  (GRNWorldBuilder), `Components/StaticMeshComponent.h` and
  `Components/InputComponent.h` (GRNVehiclePawn),
  `Components/SpotLightComponent.h` (GRNTraffic), `Engine/World.h` and
  `GameFramework/PlayerController.h` (GRNGameMode). The check knows which
  uses need which header and fails on the next one.
- **`FJsonObject`'s keys became `UE::FSharedString` in 5.8.** That breaks
  code that iterates `Values`; GRNApi only calls `Get*Field` /
  `TryGet*Field` with literals, so nothing changed. Every `UE_LOG`,
  `Printf` and `Logf` was audited against 5.8's compile-time
  argument-count check.
- **Input stays on `BindAxis` / `BindAction` and `DefaultInput.ini`.**
  Deprecated since 5.1/5.2, not removed as far as anything here could
  find; they warn. Enhanced Input can be built entirely in code
  (`NewObject<UInputAction>` / `UInputMappingContext`) and still needs no
  assets — the follow-up. **Check in Play-In-Editor that W and Space
  still drive the car.**
- **Config.** `[/Script/Engine.RendererSettings.RayTracing]` is not a
  section the engine has, so its three keys were never read; it is gone.
  `r.RayTracing.AmbientOcclusion` only ever ran with Lumen GI off and the
  legacy ray-traced passes were dropped in 5.4; `r.Lumen.TraceMeshSDFs`
  asked for detail traces deprecated in 5.6. Both are gone from the ini
  and from `GRNGraphics`. MegaLights and Substrate are on; mesh distance
  fields stay on, because Lumen's software path traces them — and so
  would MegaLights' fallback, for any shadowed light it drew without
  hardware ray tracing. The lamps are not shadowed there any more.
- **Two port bugs fixed on the way.** `AGRNGameMode::ApplyCar`'s no-API
  copy of `GetCar` dropped `LengthM`, so that path built the car at its
  silhouette's reference size; and the headlights and lamps were
  Stationary components on things that move.

## High-end assets from Fab

The factory builds cars out of engine primitives so the project has no
binary art in it, and every actor that builds a car carries an `Art →
Hero Assets` slot (`FGRNHeroAssets`, GRNCarFactory.h) for the day it
does. Fab is Epic's asset store; its plugin ships with the editor from
5.4 (Window → Fab), signed in with the Epic account that will hold the
licence. To put a scanned or modelled car in:

1. In Fab, *Add to project* (or *Download* → drag the `.fbx`/`.glb`
   into Content). Import with **Nanite** on and *Combine Meshes* on, so
   the body is one `UStaticMesh`; leave the wheels as a separate mesh if
   the pack has them.
2. Put the mesh where the fleet can find it — **`GRNHeroArt.cpp`**, one
   line per silhouette. That table is the normal route, because art
   belongs to a SHAPE rather than to an actor: the player cycles cars, so
   a body pinned to the pawn would put a sports car's shell on a pickup
   the moment they bought one. **Art → Hero Assets** on the pawn, the
   rival or the traffic actor still exists and still wins where it is
   set — it is an override now, not the way in.
   **Paint Slot** is the material slot the paint rides on, **Tail Slot**
   the lens that flares under braking, **Wheel Slot** the alloy finish;
   `-1` leaves a slot as imported.
3. Play. `GRNCarFactory::Build` loads the references, scales the body so
   its length is the length on the car's card — the player's, the
   rival's and the civilian's alike; until this was fixed the rival and
   the civilian passed no length at all and got their *silhouette's*
   reference instead, which put five of the eight rivals wrong and the
   worst 310 mm short — stands it on the road,
   and drops the primitive bodywork and kit — the art's own aero and
   lamps stand in for them. Wheels are scaled to the primitive's
   diameter so the hub height is unchanged, and mirrored onto the far
   side. The rig API is identical, so nothing that drives, spins, brakes
   or lights the car knows the difference. Rivals (`AGRNRival`) and
   civilians (`AGRNTraffic`) carry the same slot.

What the length is for: the factory fits a hero body by its X extent, so
the card's `lengthM` is the only thing deciding how big an imported car
comes out. A pack whose model is not to scale still lands at the right
size; a car whose card is wrong lands wrong. `check:unreal` now compares
each rival's car id against the web roster so a rival cannot silently
lose the car it brings.

The mesh conventions the factory expects: **X forward, Z up**, the body
standing on Z = 0 after import; the wheel authored with its **axle
along Y** (the spin is applied as a local pitch; the primitive cylinder
spins on its own Z because it is rolled onto its side, and the rig
remembers which it has).

Licensing, stated plainly: Fab's standard licence is per seat and per
project, so those assets can ship in the packaged UE5 build but not in
the web build or this repository — which is why the slot is a soft
reference set in the editor and nothing here depends on the art being
present. The web build keeps its own Blender-authored shells
(`public/models/`), which are generated from the game's silhouettes and
carry no third-party licence.

That licence is now enforced rather than remembered: `unreal/.gitignore`
ignores `Content/`, `*.uasset` and `*.umap`, and `npm run check:structure`
fails if any of it is ever tracked — an ignore rule does nothing about a
file already committed, and the first `git status` after an import
offers the whole pack.

### Epic's Vehicle Variety Pack, concretely

The free "Free For Life" pack — Sports Car, Hatchback, Pickup, SUV, Box
Truck — is the one this repository is set up for. *Window → Fab*, sign
in, *Add to project*. Then, per vehicle:

- **Find a static mesh.** If the pack ships an `SM_` beside the `SK_`,
  use it. If a vehicle is only a skeletal rig — which is how vehicle
  packs are built, because the wheels are bones on the skeleton — bake
  one: open it in the Skeletal Mesh editor and use **Make Static Mesh**.
  *(Its exact place in the 5.8 menus is not something this repository can
  confirm; if it is not there, drop the rig into a level and use the
  level editor's convert-to-static-mesh instead.)*
- **Copy the path.** Right-click the asset → **Copy Reference** gives
  exactly the `Package.Asset` string `GRNHeroArt.cpp` wants.
- **A baked rig brings its wheels with it.** Set `bBodyHasWheels` and
  the factory builds none of its own — they will not turn until you
  separate them in the editor, which is the honest state to be in
  rather than a second set of wheels inside the arches.

The mapping, as shipped: Sports Car → `Super`, Hatchback → `Hatch`,
Pickup → `Pickup`, SUV → `SUV`. The Box Truck goes unused, because no
silhouette in this game is a box truck. `Sedan`, `ZX`, `GTR`, `RX7` and
`Pony` have no counterpart in the pack and keep their primitive shells —
and so, therefore, does civilian traffic, which is always `Sedan`. One
silhouette's art is worn by every car that shares it: all four `Super`s
in the roster become the same sports car until there is a per-car table.

**The paths in that file are unverified.** fab.com was unreachable from
the machine they were written on, so they are written from the pack's
published contents and nobody has watched them resolve. Expect to correct
them once. A path that fails while its neighbours succeed names itself in
the log at startup; a project with none of them resolving says so once,
quietly, and builds primitives exactly as before.

**Respray, plainly.** Every MID in this port drives a vector parameter
called `Color`, which exists because the engine's basic-shape material
declares it and for no other reason. An imported material calls its paint
something else, and `SetVectorParameterValue` on a name the parent does
not expose does nothing at all — no crash, no warning, no colour. So a
hero body **keeps the paint it was authored with** until somebody opens
the pack's material, reads the real parameter name off it, and puts it in
`PaintParam` (and `TailParam` for the brake flare). What the factory does
guarantee is that the import's own material survives at all: it makes a
dynamic instance *of the material already in the slot*, where it used to
assign one parented to the engine cube and render a scanned car flat
grey.

## What has and has not been verified

**Verified here, without Unreal** — `node scripts/check-unreal-project.mjs`:

- One engine version everywhere: the `.uproject`, both targets'
  `BuildSettingsVersion` and `IncludeOrderVersion`, and both READMEs.
- The editor module is Editor-type, in the editor target and not the game
  target; the runtime `Build.cs` names no editor-only module; no editor
  header is included outside `WITH_EDITOR`; every engine header either
  module includes belongs to a module its `Build.cs` depends on; the
  editor module calls nothing from the runtime module that is not inline
  (nothing there is exported, so a call would not link).
- Every use of an engine type the check knows (52 today) has the header
  that declares it, and every `.cpp`'s own header comes first.
- No two `.cpp` files in a module keep a file-local name the other also
  keeps. A unity build pastes them into one translation unit, where two
  anonymous-namespace `Cube()`s are a redefinition error; UnrealBuildTool
  only unity-builds a game module from 32 source files on and this one
  has 15, which is the only reason the three that already exist
  (`Cube`, `Cyl`, `Mid` in GRNCarFactory.cpp and GRNDriverRig.cpp) have
  never bitten. They are recorded as a baseline; a new one fails.
- The ini keys above are present, in sections that exist; the dead
  variables are gone; the always-cook list covers the paint and the hero
  art, derived from the paths in the code.
- Lamps and headlights shadow only through `FollowMegaLights()` — no
  other `SetCastShadows` anywhere in the runtime module — and
  `MegaLightsActive()` reads both variables, the SM6 feature level and
  `IsRayTracingEnabled()`; `-grnnomegalights` is parsed where this README
  says it is; every spot light is Movable before it registers.
- The paint's parameter names are spelled only in `GRNPaint.h`, declared
  by the graph and set by the instance; the fallback ladder is intact;
  the commandlet's run name matches what the docs and log messages quote.
- The finishes, base roughness, declared solids, retired swatches and
  per-car factory finishes match `mods.ts`, `cars.ts` and `paints.ts`, and
  **the metalness law, compiled with `g++ -Wall -Wextra -Wshadow
  -Werror`, gives bit-identical answers to the web's own `paintMetalness`
  on 4,308 colours** — every paint, car and rival, all 256 greys and a
  fixed sweep.

**Not verified — needs a 5.8 editor on a real machine:**

- That it compiles at all. In particular the Substrate node members the
  paint builder names (`BaseColor`, `Metallic`, `Specular` on
  Metalness-To-DiffuseAlbedo-F0; `DiffuseAlbedo`, `F0`, `Roughness`,
  `ClearCoatCoverage`, `ClearCoatRoughness` on Simple Clear Coat), and
  `BuildSettingsVersion.V7` itself, which came from third-party upgrade
  write-ups rather than Epic's page.
- That the Simple Clear Coat renders correctly in the Blendable format.
- That `r.MegaLights.Allow` belongs in `ShadowQuality` — if 5.8's
  `BaseScalability.ini` sets it in a group applied later, that wins.
- That `IConsoleVariable::OnChangedDelegate` fires for a scalability
  change as it does for a console one (`scalability 1` then `scalability
  4` in Play-In-Editor: the log line `GRNGraphics: MegaLights off, N
  lamps and headlights re-lit unshadowed` and back), and that
  `IsRayTracingEnabled()` and `GMaxRHIFeatureLevel` are still spelled so
  in 5.8.
- `r.MegaLights.NumSamplesPerPixel` 4 and 16: 2, 4 and 16 were the
  supported values when MegaLights shipped, and 5.8 may have moved them.
  5.8 also added `r.MegaLights.ScreenTraces.Quality`; its range is not
  known here, so it is left at the engine's default rather than guessed.
- The cost. Turn MegaLights on, look at its visualisation, run
  `ProfileGPU`; turn Substrate on, restart, run `-run=GRNBuildPaint`, and
  compare stills against the web build's at the same paint colour.
- Gamepad and keyboard input in Play-In-Editor.

## The Black Demon showcase

`Showcase/` renders one car — the catalogue's Black Demon, the same
export behind `press/renders/black-demon.png` — in this engine on a Mac:
three 4K studio stills lit and framed exactly as the Blender set, a
ten-second turntable, and the car parked on the night Gulf Road the
game builds for itself. `Showcase/README.md` has the steps
(`Showcase/run.sh probe`, `build`, `preview hero`, `render all`, `night
city`). Like the rest of this port it has not been run here, and says
so; `npm run test:showcase` holds its arithmetic and its control flow
against a stand-in engine.

## Where to take it next

- **Cars**: the primitive rigs drive and read correctly today; Nanite
  car scans go in through **Hero Assets** (above) without touching the
  factory — the rig API (wheels, paint MID, tail MID, headlight) stays.
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
