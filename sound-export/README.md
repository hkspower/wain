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

## Three things that are not right yet

**shift and flash are too long.** The generators ask for 0.4 s and 0.3 s. The
sound model's floor is 0.5 s, so both came back at 0.48 s. A gearshift that
lasts half a second lands after the shift it is meant to punctuate. Trim them,
or accept the delay.

**The per-line delivery was dropped.** `generate-voices.mjs` sets a stability
per character — 0.4 for the loud ones, 0.9 so the ghost speaks slow and steady.
The speech node used here exposes only voice and language, so every one of the
27 lines was read at the model default. The ghost does not sound like a ghost.

**There are two music generators and they disagree.** `scripts/generate-music.mjs`
asks for slow synthwave with an oud motif; `tools/elevenlabs/generate-music.mjs`
asks for 128 BPM rocky techno with distorted guitar. Both write
`public/music/cruise.mp3` and `battle.mp3`, so whichever runs last wins. The
beds here are the rocky techno. That duplication should be collapsed to one
table the way the road positions were.
