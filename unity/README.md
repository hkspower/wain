# Night Racer — Unity port

A native Unity build of the game for the Steam release: same Gulf Road
spline, handling model, rival roster, SP battle rules and Kuwaiti voice
lines as the web version, ported to C#. The world is procedural — no art
assets, no scene wiring — and the cars are the web build's own 17,
brought in from the GLBs the game exports and baked into Unity assets
(one prefab per car, with its hood, rear window, rear wing and tyres as
prefabs of their own). See **The cars** below.

> **Status:** authored without a Unity editor. Every script is compiled
> in CI-style against Unity's reference assemblies plus source-checked
> URP stubs (`npm run check:unity-compile`, 0 errors), and the car reader
> is run against all 17 real GLBs (`npm run test:unity-cars`), but nothing
> has been played in Unity yet. The scripts target **Unity 6 LTS
> (6000.0)** with the **Universal Render Pipeline**.

## Open & play

1. Install **Unity 6 LTS (6000.0.x)** via Unity Hub.
2. Unity Hub → **Add** → select this `unity/` folder → open it. The URP
   package restores automatically from `Packages/manifest.json`.
3. Run the menu item **Night Racer ▸ Setup Rendering (URP + Post)**
   once. It generates the pipeline asset, renderer and post-processing
   profile and wires them into Graphics/Quality settings.
4. The cars (once per export): with `npm run dev` running at the repo
   root, `npm run cars:export` writes the 17 GLBs to `press/renders/glb/`.
   Then **Night Racer ▸ Bake Cars to Assets** (or
   `tools/unity/bake-cars.sh`) turns each into its own prefab. Skipping
   the bake still works in the Editor — the GLBs are read directly — and
   skipping the export too gives the procedural stand-in cars.
5. Open an empty scene (File → New Scene → **Empty**: the Basic template
   adds a second Main Camera and a daylight sun) and press **Play**.
   `Bootstrap.cs` spawns the whole game automatically — no scene setup.

## The cars

The web build's cars, not lookalikes. `NightRacer.Cars.CarLibrary` finds
each car in this order:

| Source | What it is |
| --- | --- |
| `Assets/Resources/Cars/<id>/<id>.prefab` | the car baked into Unity assets — instant to load, ships in a build |
| `Assets/StreamingAssets/Cars/<id>.glb` | the export copied in by `npm run sync:unity-cars`, read at runtime |
| `press/renders/glb/<id>.glb` | the export itself (Editor only) |
| — | none of these: the procedural silhouette, so a clean clone still runs |

**Baked, every car is its own asset** (`Assets/Resources/Cars/<id>/`):

| Asset | |
| --- | --- |
| `<id>.prefab` | the whole car, `CarRig` on the root, with the parts below nested as prefab instances |
| `Parts/Hood.prefab` | the bonnet panel (paint ahead of the windscreen's foot, facing up, between the fenders) |
| `Parts/RearWindow.prefab` | the back glass |
| `Parts/RearWing.prefab` | the wing, on the seven cars that carry one |
| `Parts/Tyre-F.prefab`, `Tyre-R.prefab` | the tyres; each axle's right tyre is the left one mirrored (checked on all 17) |
| `Meshes/`, `Materials/`, `Textures/` | every mesh by part, every material, the plate/decal/tyre/seat maps |

Edit `Parts/Tyre-F.prefab` and both front wheels follow. The folder is
generated (hundreds of MB of mesh data) and git-ignored: bake again after
re-exporting.

**What is carried across**, from the GLB's own values: the paint on URP
**Complex Lit** with the real clear coat (gloss 1 / 0.045, satin 0.45 /
0.42, matte none); glass that keeps its reflection at 45% opacity
(premultiplied, URP's "preserve specular"); lamps at their real emissive
strengths, with brake levels from the web (`CarRig.SetBrake`); plates,
decals and reflectors at their night floors; tyre and seat maps with
their texture transforms. The reader is our own (`CarAsset.cs`), not
glTFast: glTFast ignores `KHR_materials_emissive_strength`, which dims
the lamps to a quarter and lights plates, decals and brake discs white.

**Something to reflect**: a procedural night environment (the web's
`env.ts` recipe: horizon band, lamp heads, moon, lit towers) is the
scene's reflection, and a realtime probe rides with the player's car,
leaving cars and lamp coronas out of what it sees.

**On the road**: the player drives the catalogue car `PlayerCar()`
picks, each rival their own car (`CarId`, generated from the web roster)
in their colours, and traffic the five street cars repainted in the
traffic palette by the web's paint law. Wheels roll at each car's own
tyre radius about their hubs; the front pair can steer
(`CarRig.Steer`).

**Checks**, runnable without Unity (both need the .NET 8 SDK):

```bash
npm run test:unity-cars       # the reader against all 17 GLBs: triangles, size,
                              # hubs, radii, parts, winding, the paint law
npm run check:unity-compile   # every script against Unity's reference assemblies
```

## The data connection

The Unity build does not keep its own copy of the game's numbers — it
**generates** them from the same TypeScript the browser runs, and can
**fetch** them live at boot.

```bash
npm run sync:unity      # regenerate unity/Assets/Scripts/GRNData.cs
npm run check:unity     # prove it matches the live API (needs npm run dev)
```

`scripts/export-unity-data.mjs` reads `src/game/{track,rivals,mods,handling}.ts`
and emits `GRNData.cs`: the 17 track control points, the full rival
roster with colours, speeds, prizes, body styles and spoken lines, the
whole showroom, and the handling constants. **Never edit `GRNData.cs` by
hand** — it is build output.

At boot `GRNApi` requests `/api/grn/v1/gamedata` and, on success,
replaces those tables with live ones. If the fetch fails — offline, LAN,
a plane, a server mid-deploy — the generated tables stand in and the game
plays identically. A payload whose `apiVersion` this build does not
recognise is rejected in favour of the baked data, and a partial payload
is refused outright: half a roster is worse than none. Point a build
somewhere else without recompiling:

```
GulfRoadNights.exe -grnapi=https://your-site -grnhub=http://your-hub:8787
```

### Why this exists

The roster used to be hand-typed into `Rivals.cs`. By the time this
pipeline was added it had silently fallen **two rivals and an entire
14-car showroom** behind the game, and had no body-style concept at all.
That is what a duplicated table does over time. `npm run check:unity`
now diffs the generated data against the live API — every rival's
name, crew, area, colour, top speed, body style, prize and voice line,
every car's price and handling figures, all 151 handling constants, all
147 rig constants, all 102 parts in the showroom, all 31 paints, the tyre,
the body-shape law and the API version both sides claim — and exits
non-zero on any mismatch, so it cannot drift again unnoticed.

### And it checks that it checks everything

For a while it did not. It covered eight of the fifteen things the API
publishes and printed "in sync" — the showroom, the palette, the rig,
the carbon table and the social runs were all outside it, and nothing in
the report hinted that they were. A check that covers most of a contract
and reports like it covers all of it is worse than one that admits its
scope.

So the last section is a coverage gate: every key the API publishes must
be named in the check exactly once, either as verified or as **declared
absent with the reason the Unity port does without it**. Add a section to
the API and `check:unity` goes red until somebody decides which it is.
Today that is eleven checked and four declared absent — the title
string, the response timestamp, the carbon readout (a web/hub results
screen this client has no equivalent of) and the social runs (scored by
the hub against other players online, which an offline client does not
join).

The gate is what keeps "checks everything" true after today, rather than
true on the day it was written.

Crucially the generated data is **read by the game**, not just verified:
`TrackSpline` builds the road from `GRNData.ControlPoints`, the handling
model reads `GRNData.Handling` rather than its own literals, and
`CarFactory.WheelRadius` reads `GRNData.TyreRadius`. That last one is
the example: it was `0.33f`, typed by hand, against the web's 0.375 and
the Unreal port's 0.40 — one car with three sizes of wheel across three
builds, spun at three different rates. The check now asserts both the
value AND that the C# still reads it rather than holding its own copy,
because the value was never really the problem.
A contract test that green-lights numbers nothing consumes is worse than
none — it reports safety it cannot deliver.

When the API answers after the world is already up, the controller
rebuilds the spline and respawns the rival on the next frame boundary, so
live data reaches the race it was fetched for rather than the one after.

## The render stack

The world is procedural — no textures or models ship in the repo; the
cars come from the game's export (above).

| Feature | Detail |
| --- | --- |
| Pipeline | Universal RP, HDR, 4x MSAA, SRP batcher |
| Anti-aliasing | MSAA 4x + SMAA (high) |
| Tonemapping | ACES filmic, +0.25 EV, mild contrast/saturation lift |
| Bloom | Threshold 0.85, warm sodium tint — lamps, headlights, taillights and tower spheres all halo |
| Post | Vignette, film grain, chromatic aberration, camera motion blur |
| Sun/moon shadows | Soft, 4096 shadow map, 4 cascades, 220 m distance |
| Headlights | Spot light with **soft real-time shadows** — traffic throws moving shadows up the road |
| Street lamps | HDR emissive heads + camera-facing coronas, point lights every 4th pole |
| Road | Procedurally generated asphalt: four octaves of tileable value noise for graded aggregate, tyre-polished wear bands, oil drips, plus a matching normal map from the same height field. 16x anisotropic |
| Cars | The web build's own 17 cars (above): Complex Lit clear-coat paint, premultiplied glass, lamps at their real emissive strengths, a realtime reflection probe on the player's car over a procedural night environment, soft contact shadow. Without the export, four procedural silhouettes stand in |

If you open the project before installing URP, the game still runs on the
built-in pipeline (materials fall back to `Standard`) and logs a warning
telling you to run the setup menu item.

Controls: `W/S` drive · `A/D` steer · `F` flash headlights (start a
battle) · `R` rematch after a defeat · `M` mute.

## Why Unity and not Unreal

For a phone racer Unity is the right engine, and it is not a close call:

| | Unity | Unreal 5 |
| --- | --- | --- |
| Empty build size | ~15-25 MB | ~80-150 MB |
| Share of top-grossing mobile titles | ~70% | under 5% |
| Mobile thermals / battery | Tuned for it | Desktop-class renderer |
| Web/desktop/mobile from one codebase | Yes | Heavier lift |

Unreal wins on high-end PC and console fidelity - Nanite and Lumen have
no Unity equivalent. If a console-grade version is ever the goal it is
the better host, and this repo's track spline, handling constants and
rival data port over cleanly. For phones, Unity ships the same game at a
fraction of the download and battery cost.

## Mobile builds

Touch controls are built in: `TouchControls.cs` reads `Input.touches`
directly (not GUI buttons) so steering and throttle register at the same
time, and draws steering, gas/brake and Flash/NOS/Horn pads sized to the
screen. The keyboard keeps working alongside them, and the keyboard hint
hides itself on handhelds.

`MobileTier.cs` runs once at startup on handheld devices and trims the
render load without changing the look: 60 fps target, 0.85 render scale,
hard shadows at 90 m with 2 cascades, MSAA 2x, and motion blur, chromatic
aberration and film grain switched off. Bloom and ACES tonemapping stay -
they are the night.

**iOS:** File > Build Settings > iOS > Switch Platform, then Build. Open
the generated Xcode project, set your team and bundle id, Archive, and
submit through App Store Connect (needs a US$99/year Apple Developer
account and a Mac).

**Android:** switch platform to Android, tick **Build App Bundle
(.aab)**, set a keystore under Player Settings > Publishing Settings,
Build, then upload the `.aab` to the Play Console (US$25 one-off).

For both, set the orientation to Landscape Left/Right in Player Settings
and enable **Auto Graphics API** so older devices fall back to GLES3.

## ElevenLabs voices & effects

Rival lines (Kuwaiti dialect) are spoken through the ElevenLabs
multilingual TTS. Create `Assets/StreamingAssets/elevenlabs.json`:

```json
{ "apiKey": "sk_your_key", "voiceId": "pNInz6obpgDQGcFmaJgB" }
```

- Pick any voice id from your ElevenLabs VoiceLab (a deep male Arabic
  voice suits the boss; the default is ElevenLabs' "Adam").
- Clips cache to `Application.persistentDataPath` — each line is billed
  once, then replays free and offline.
- `ElevenLabsVoice.GenerateSfx(prompt, id)` hits the sound-generation
  endpoint the same way if you want designed effects (sirens, crowds).
- The `ELEVENLABS_API_KEY` environment variable overrides the file.
- No key → voice lines are skipped silently; the synth engine audio,
  music-free soundscape and all gameplay still work.

The web build shares the same lines — see `scripts/generate-voices.mjs`
at the repo root to pre-render them once for both platforms.

## Building for Steam

1. File → Build Settings → Windows x86_64 → **Build** into `Build/`.
2. Add [Steamworks.NET](https://steamworks.github.io/) for achievements,
   overlay and cloud saves; drop `steam_appid.txt` beside the exe for
   local testing.
3. Upload the `Build/` folder as a depot with `steamcmd` (see
   `desktop/README.md` at the repo root for a working app_build.vdf
   example — the depot layout is identical).

## What's ported vs the web build

| System | Status |
| --- | --- |
| Gulf Road spline (real corniche layout) | ✅ same control points |
| Handling (heading, grip-limited yaw, curve slip) | ✅ same constants |
| Rival roster, SP battles, flash-to-start | ✅ |
| The cars themselves (all 17, as separate assets with their parts) | ✅ from the game's own export |
| Traffic + collisions | ✅ |
| Kuwaiti voice lines | ✅ via ElevenLabs |
| Engine/wind/impact audio | ✅ procedural (OnAudioFilterRead) |
| Kuwait Towers, water towers, mosque, palms, lamps | ✅ simplified |
| Bloom / grain / ACES / motion blur | ✅ URP volume |
| Real-time shadows (moon + headlights) | ✅ |
| Procedural asphalt + normal map | ✅ |
| Touch controls + mobile render tier | ✅ |
| Billboards, tunnel, beacons, minimap, online hub, garage | ❌ web-only for now |
