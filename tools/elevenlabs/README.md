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
npm run sfx -- --check    # can we reach the API, and is there a key?
npm run sfx -- --dry-run  # review the roster and prompts, no key needed
npm run sfx:verify        # check a drop before committing it
```

`--check` answers the two questions separately, because they fail in
completely different ways and **a key cannot help with a host that is
not allowlisted**.

## Is it working yet?

```bash
npm run audio:check
```

One command, all three pipelines. They hit the same host, so they are
blocked or working together — checking them separately was three
commands to learn one fact.

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

   This cannot be fixed from inside the repo or by the agent. The
   session's own proxy documentation is unambiguous about it: *"The
   destination host is not allowed by your organization's egress policy
   for this session. Do not retry or route around it — report the
   blocked host."* There is no config file here that grants a host;
   the allowlist lives in the environment, and only its owner can
   change it.
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


## Voice lines

The rivals' Arabic dialogue is a separate generator, because it is
text-to-speech rather than sound generation:

```bash
node scripts/generate-voices.mjs --check     # key + reachability
node scripts/generate-voices.mjs --dry-run   # the whole script, no key
ELEVENLABS_API_KEY=sk_... node scripts/generate-voices.mjs
```

It writes `public/voices/<clip-id>.mp3` plus a manifest listing the ids;
`src/game/voice.ts` plays a clip when one exists and falls back to the
browser's Arabic speech synthesis when it does not.

**The roster is read from `src/game/rivals.ts`, never copied.** The
previous version carried a hand-maintained table under the instruction
"keep this table in sync", and it had already drifted: two rivals —
`bu-torab` and `al-sayyaf` — had been added to the game with no lines
here at all, so they alone fell back to speech synthesis while the other
six spoke in real recorded voices. Nobody would notice until they raced
the sixth rival. Parsing the source is how the UE5 and Unity generators
avoid exactly this, and it is now how this one does too: 8 rivals, 27
clips.

The woman on the roster also gets a woman's voice. `bint-aldeera` is
marked `female: true` in `rivals.ts` and every one of her lines was
being rendered with the male voice; the generator now picks
`ELEVENLABS_VOICE_ID_F` for her.


## Race music

```bash
npm run music -- --check      # key + reachability
npm run music -- --dry-run    # the musical brief, no key needed
ELEVENLABS_API_KEY=sk_... npm run music
```

Two tracks into `public/music/`, because the game has two states and
crossfades between them on the SP bar: `cruise` is the road when
nothing is at stake, `battle` is a rival alongside you. `src/game/music.ts`
picks them up from `public/music/manifest.json` and drops its
synthesized score the moment they exist.

The brief is rocky techno — a live-sounding kit and distorted guitar
over a four-on-the-floor techno spine, driving rather than euphoric,
because this is a road at two in the morning and not a festival.

**Both prompts pin the same key, tempo and kit.** That is the one
constraint the crossfade cannot survive without: two tracks written
independently, in different keys or at different tempos, sound like a
radio being retuned mid-corner every time the SP bar moves. 128 BPM,
A minor, both of them, stated in the shared half of the prompt rather
than left to chance.

They also both reserve 80–250 Hz. That band is where a V6 lives, and a
score that fills it turns the engine — which is the instrument the
player is actually driving — into mud.
