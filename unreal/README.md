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

## What maps to what

| Web build (`src/game/`) | UE5 (`Source/GulfRoadNights/`) |
| --- | --- |
| `track.ts` — control points, S/Lat space | `GRNTrack` (USplineComponent, same 17 points) |
| `engine.ts` handling: thrust/drag, heading, drift | `GRNVehiclePawn::UpdateHandling` — constants copied 1:1 into `GRNTypes.h` |
| `engine.ts` battle rules: SP drain, flash ritual | `AGRNGameMode` (drain curve identical) |
| `rivals.ts` roster | `GRNRivals[]` in `GRNTypes.h` |
| `mods.ts` showroom | `GRNCars[]` (garage UI: build in UMG) |
| pre-battle cinematic (slow-mo film) | global time dilation 0.22× for 4.2 s, Start/Esc skips |
| `world.ts` road, rails, cobra-head street lights | `AGRNWorldBuilder` — procedural road ribbon + instanced lights **with real Lumen spot lights per lamp** |
| HUD (React) | `AGRNHud` Canvas drawing (swap for UMG in the art pass) |
| localStorage saves | `UGRNSaveGame` slot "GulfRoadNights" |
| Gamepad (browser Gamepad API) | `DefaultInput.ini`: sticks/triggers/face buttons, same layout |

## Renderer

`Config/DefaultEngine.ini` turns on the UE5 night-city stack:

- **Lumen** global illumination + reflections — the sodium lamps light
  the asphalt for real, and car paint reflects the actual scene (the
  web build fakes this with a cube probe; here it's native).
- **Virtual shadow maps** for crisp lamp shadows.
- **TSR** upscaling — the UE analogue of the web build's dynamic
  resolution governor; scalability groups replace the quality tiers.
- Motion blur off, bloom on, sharpen 0.4 — tuned to the same
  "comfortable night" target as the web grade.

## Where to take it next

- **Cars**: `GRNVehiclePawn`/`GRNRival` render as poses; attach the car
  meshes (the three silhouettes — sedan, Z-wedge, R34-style coupe) as
  static meshes or import real Nanite assets. All handling already works.
- **Garage/results/menus**: the data tables are in `GRNTypes.h`; build
  the screens in UMG against `AGRNGameMode`'s state.
- **Audio**: port `sound.ts`'s synth via MetaSounds (the layered
  engine/skid/wind graph maps almost node-for-node).
- **Steam**: package via *Platforms → Windows → Package Project*, then
  the same SteamPipe scripts as `../desktop/steam/` (point ContentRoot
  at the packaged build). Use the Online Subsystem Steam plugin for
  achievements/overlay.

The Unity 6 port lives in `../unity/` and the shipping web/Electron
build in the repo root — three engines, one game design. The web build
remains the source of truth for gameplay feel; when tuning constants
change there, mirror them in `GRNTypes.h`/`GRNHandling`.
