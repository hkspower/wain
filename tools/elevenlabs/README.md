# ElevenLabs sound effects

One command generates the game's recorded effects at the highest quality
the sound-generation API serves (44.1 kHz / 192 kbps MP3) and drops them
into `public/sfx/` where the game loads them automatically:

```bash
export ELEVENLABS_API_KEY=sk_...
npm run sfx              # all effects
npm run sfx -- skid bump # just those two
npm run sfx -- --force   # regenerate everything
```

> These cloud sessions usually cannot reach `api.elevenlabs.io` (the
> org's network policy answers CONNECT with 403). Run this from any
> machine with normal internet access; commit the resulting
> `public/sfx/*.mp3` + `manifest.json`.

## How the game consumes them

`src/game/sound.ts` fetches `public/sfx/manifest.json` at boot:

```json
{
  "bump":  { "file": "impact.mp3", "gain": 1 },
  "skid":  { "file": "skid-loop.mp3", "gain": 0.9, "loop": true }
}
```

- Every **one-shot** event (`bump`, `scrape`, `blowoff`, `shift`,
  `flash`) checks for a sample first and falls back to its synth voice —
  a missing or broken file can never break or delay the game.
- `skid` with `loop: true` becomes the looping **slide bed**: its level
  rides the same skid/driftYaw law as the synth squeal, which ducks to a
  supporting layer underneath it.
- Continuous, parameter-driven layers (engine RPM, induction growl,
  wind, brake squeal) stay synthesized on purpose: they track the
  simulation per frame, which a fixed recording cannot do without
  granular resynthesis.

Hand-authored audio works exactly the same way — the manifest doesn't
care where the files came from. The shipping default is an empty
manifest and the full synth soundscape.
