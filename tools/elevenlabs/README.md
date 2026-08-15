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

```bash
npm run sfx -- --dry-run  # review the roster and prompts, no key needed
npm run sfx:verify        # check a drop before committing it
```

## If it will not connect

This environment blocks the host. The proxy answers with a real 403 and
names the fix:

```
Host not in allowlist: api.elevenlabs.io.
Add this host to your network egress settings to allow access.
```

That is a **network policy, not an API or key problem** — the request is
refused before it reaches ElevenLabs, so a valid key changes nothing.
Two ways through:

1. **Allowlist the host.** Add `api.elevenlabs.io` to the environment's
   network egress settings (Claude Code on the web → the environment's
   network configuration — see
   https://code.claude.com/docs/en/claude-code-on-the-web). Then
   `npm run sfx` works here directly.
2. **Generate elsewhere.** Run the script on any machine with normal
   internet access and commit the resulting `public/sfx/*.mp3` and
   `manifest.json`. Nothing else has to change.

The generator detects this case and stops immediately rather than
retrying a policy decision four times.

> Never commit the key. It is read from `ELEVENLABS_API_KEY` at run time
> and nothing writes it to disk.

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
manifest (`{}`) and the full synth soundscape.

## Proving a drop actually plays

Everything here fails silently on purpose: a missing file, a corrupt
file or a malformed manifest all fall back to the synth without a word.
That is right at runtime and useless when you are trying to confirm a
drop landed, because every failure mode looks like success. Two checks
close that gap:

- `npm run sfx:verify` — the manifest is an object (an array is ignored
  by the loader outright, which is what the old shipped default was),
  every listed file exists, is large enough to be audio rather than an
  error page, starts with a real MP3 or WAV header, has a sane gain, and
  only the slide bed loops. It also catches files sitting in
  `public/sfx` that no manifest entry points at — they ship and never
  play.
- `npm run test:audio` writes a real audio file into `public/sfx`,
  points the manifest at it, reloads the game and asserts the *sample*
  voice fires on an impact rather than the synth — then removes both.
  That is the only test that proves the whole consumption path.
