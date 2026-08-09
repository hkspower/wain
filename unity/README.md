# Gulf Road Nights — Unity port

A native Unity build of the game for the Steam release: same Gulf Road
spline, handling model, rival roster, SP battle rules and Kuwaiti voice
lines as the web version, ported to C#. Everything is procedural — no
art assets, no scene wiring.

> **Status:** authored code-only (this repo has no Unity editor), so the
> first person to open it should expect to fix small compile nits if your
> Unity version's API differs. The scripts target Unity **2022.3 LTS**
> using only built-in modules (no packages) and the built-in render
> pipeline.

## Open & play

1. Install **Unity 2022.3 LTS** via Unity Hub.
2. Unity Hub → **Add** → select this `unity/` folder → open it.
3. Open any empty scene (File → New Scene → Basic) and press **Play**.
   `Bootstrap.cs` spawns the whole game automatically — no scene setup.

Controls: `W/S` drive · `A/D` steer · `F` flash headlights (start a
battle) · `R` rematch after a defeat · `M` mute.

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
| Billboards, tunnel, beacons, minimap, online hub | ❌ web-only for now |
| Bloom/grain post stack | ❌ add URP + a Volume when you want it |
