# sound-export — the game's audio, rendered

The game ships no audio: `public/sfx/manifest.json` is `{}` and the music and
voice manifests are `[]`, so `src/game/sound.ts` synthesises every effect live
and `VoiceBox` falls back to the browser's Arabic speech synthesis. This folder
is that same catalogue rendered once through ElevenLabs, so it can be listened
to, judged, and — if it is good enough — installed.

35 files: 6 effects, 2 music beds, 27 voice lines. 6.6 MB.

## Installing it into the game

The three manifests here are already in the shapes the game reads, so the
folders drop straight in:

    cp -r sound-export/sfx sound-export/music sound-export/voices public/

Nothing else needs changing. `sound.ts` prefers a manifest entry over its
synth, `music.ts` crossfades the two beds, and `VoiceBox` plays a clip when one
exists. Delete `public/*/manifest.json` to go back to synthesis.

## Where each file came from

Effects and music were generated from the prompts already written in
`tools/elevenlabs/generate-sfx.mjs` and `tools/elevenlabs/generate-music.mjs`,
verbatim, at the durations and gains those files declare. Voice lines were read
out of `src/game/rivals.ts` by `scripts/generate-voices.mjs --dry-run`, so the
roster here is the roster the game actually ships.

| set    | model                    | notes                                  |
|--------|--------------------------|----------------------------------------|
| sfx    | `eleven_text_to_sound_v2`| prompt_influence 0.75; skid looped      |
| music  | `eleven_music_v2`        | 96 s each, instrumental, seamless loop  |
| voices | `eleven_multilingual_v2` | language `ar`                           |

Two voices, because the roster has a woman in it and generating her lines in a
man's voice is not a subtle flaw:

- everyone else and the announcer — *ALI, Saudi Arabic & English*
  (`Hvlnv5DwiIO2CQ6oYMZ3`)
- bint-aldeera — *Talya*, Omani (`rh16DBXwtscjdPFeMBYf`)

Both are Gulf-accented, which is the closest the voice library gets to Kuwaiti.

## Encoding: what each set is, and why

Measured with `file(1)` on the shipped bytes, not read off a label:

| set    | encode                        | is that the ceiling?              |
|--------|-------------------------------|-----------------------------------|
| music  | 192 kbps, 48 kHz, stereo      | yes — the platform maximum        |
| sfx    | 128 kbps, 44.1 kHz, stereo    | no, but capped by the connector   |
| voices | 128 kbps, 44.1 kHz, mono      | no, but capped by the connector   |

These were generated through the MCP connector, which stamps
`output_format` server-side and rejects it as a parameter:

    Unknown parameter(s) for model 'eleven_multilingual_v2': output_format.
    Valid parameters: language_code, voice_id

That cap is not the model's. It holds on every speech model — `eleven_v4`
returns *"Your account is not authorized to access this model"*, and
`eleven_v3` returns the same 128 kbps/44.1 kHz mono as v2 — so there is no
route to a better speech or effect encode through the connector.

The direct API has no such cap, and the four generator scripts now all ask
it for `mp3_44100_192`. Three of them did not before: only
`generate-sfx.mjs` requested a format, so the music beds and all 27 voice
lines the repo would have produced were 128 kbps by omission, silently —
the request succeeds, the file plays, and the only evidence is a bitrate
nobody reads. `npm run test:audio-quality` now fails if any generator
drops the format again.

So: **re-running the generators from a machine that can reach
`api.elevenlabs.io` will produce better effects and voices than the files
here.** The music will not change; it is already at 192. In this
environment that host is not on the egress allowlist, which is why the
connector was used at all.

## Three things that are not right yet

**shift and flash are too long.** The generators ask for 0.4 s and 0.3 s. The
sound model's floor is 0.5 s, so both came back at 0.48 s. A gearshift that
lasts half a second lands after the shift it is meant to punctuate. Trim them,
or accept the delay.

**The per-line delivery was dropped.** `generate-voices.mjs` sets a stability
per character — 0.4 for the loud ones, 0.9 so the ghost speaks slow and steady.
The speech node exposes only voice and language, so every one of the 27 lines
was read at the model default. The ghost does not sound like a ghost.

`eleven_v3` takes a bracketed direction instead, and it does consume it rather
than read it out: the ghost's line came back at 3.28 s where speaking the
six-word English direction on top of the Arabic would have taken about six. But
it also came back *shorter* than the 3.58 s untagged take, which is the wrong
direction for "slow and steady", and judging whether it actually sounds better
needs ears this environment does not have. Rather than replace 27 known-good
takes on an unverifiable theory, they were left on v2. Someone who can listen
should try v3 with directions and keep whichever is better.

**There are two music generators and they disagree.** `scripts/generate-music.mjs`
asks for slow synthwave with an oud motif; `tools/elevenlabs/generate-music.mjs`
asks for 128 BPM rocky techno with distorted guitar. Both write
`public/music/cruise.mp3` and `battle.mp3`, so whichever runs last wins. The
beds here are the rocky techno. That duplication should be collapsed to one
table the way the road positions were.
