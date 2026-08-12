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
npm run sync:unreal     # regenerates Source/GulfRoadNights/GRNTypes.h
```

and commit the regenerated header. Track geometry, the rival roster,
the full 13-car showroom and the handling constants all flow from the
TypeScript source of truth into UE5 in one step.

## What maps to what

| Web build (`src/game/`) | UE5 (`Source/GulfRoadNights/`) |
| --- | --- |
| `track.ts` — control points, S/Lat space | `GRNTrack` (USplineComponent, same 17 points) |
| `engine.ts` handling: thrust/drag, heading, drift | `GRNVehiclePawn::UpdateHandling` — constants copied 1:1 into `GRNTypes.h` |
| `engine.ts` battle rules: SP drain, flash ritual | `AGRNGameMode` (drain curve identical) |
| `rivals.ts` roster | `GRNRivals[]` in `GRNTypes.h` |
| `mods.ts` showroom | `GRNCars[]` — applied to the pawn by `ApplyCar`; Tab / D-pad-right cycles machines until the UMG garage lands |
| pre-battle cinematic (slow-mo film) | time dilation 0.22× + a real camera flying the same three shots (rival orbit → side pass → chase pull-back), Start/Esc skips |
| `world.ts` road, rails, cobra-head street lights | `AGRNWorldBuilder` — procedural road ribbon + instanced lights **with real Lumen spot lights per lamp** |
| `cars.ts` three silhouettes | `GRNCarFactory` — primitive-built sedan / Z-wedge / R34-style coupe with paint MIDs, spinning wheels, brake-flare tail lamps, real headlight beams; wing only when the part is owned |
| traffic | `AGRNTraffic` × 8 with the web build's shunt rules (speed clamp, hitbox knock-out, SP cost in battle) |
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

The Unity 6 port lives in `../unity/` and the shipping web/Electron
build in the repo root — three engines, one game design. The web build
remains the source of truth for gameplay feel; when tuning constants
change there, mirror them in `GRNTypes.h`/`GRNHandling`.
