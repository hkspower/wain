# Gulf Road Nights — Unity port

A native Unity build of the game for the Steam release: same Gulf Road
spline, handling model, rival roster, SP battle rules and Kuwaiti voice
lines as the web version, ported to C#. Everything is procedural — no
art assets, no scene wiring.

> **Status:** authored code-only (this repo has no Unity editor), so the
> first person to open it should expect to fix small compile nits if your
> Unity version's API differs. The scripts target **Unity 6 LTS
> (6000.0)** with the **Universal Render Pipeline**.

## Open & play

1. Install **Unity 6 LTS (6000.0.x)** via Unity Hub.
2. Unity Hub → **Add** → select this `unity/` folder → open it. The URP
   package restores automatically from `Packages/manifest.json`.
3. Run the menu item **Gulf Road Nights ▸ Setup Rendering (URP + Post)**
   once. It generates the pipeline asset, renderer and post-processing
   profile and wires them into Graphics/Quality settings.
4. Open any empty scene (File → New Scene → Basic) and press **Play**.
   `Bootstrap.cs` spawns the whole game automatically — no scene setup.

## The render stack

Everything is procedural — no textures or models ship in the repo.

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
| Cars | Clearcoat paint, alloy rims, HDR emissive lamps, brake flare, soft contact shadow |

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
| Traffic + collisions | ✅ |
| Kuwaiti voice lines | ✅ via ElevenLabs |
| Engine/wind/impact audio | ✅ procedural (OnAudioFilterRead) |
| Kuwait Towers, water towers, mosque, palms, lamps | ✅ simplified |
| Bloom / grain / ACES / motion blur | ✅ URP volume |
| Real-time shadows (moon + headlights) | ✅ |
| Procedural asphalt + normal map | ✅ |
| Touch controls + mobile render tier | ✅ |
| Billboards, tunnel, beacons, minimap, online hub, garage | ❌ web-only for now |
