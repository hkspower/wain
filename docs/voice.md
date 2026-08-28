# صوت وين — شوق's voice

## Accuracy: what a synthesiser is actually handed

`npm run test:shouq` — 10 assertions in `tests/voice-pipeline.test.mjs`.

Every line in `voice-lines.ts` is written to be **read**. Three things in them
are right on screen and unreliable out loud, and each fails silently — the
engine says the wrong thing, or nothing where the number was, and reports
neither:

| in the line | spoken as | why |
| --- | --- | --- |
| `١٨٧` → `187` | "مئة وسبعة وثمانين" | Arabic-Indic digits are read reliably on recent iOS and Chrome, patchily on older Android and eSpeak, where they come out digit-by-digit or are dropped. Western digits are read as Arabic number words everywhere. |
| `٫` → `.` | "أربعة فاصلة ثمانية" | U+066B is the Arabic decimal separator. Engines that manage the digits still mostly do not know this one, and ٤٫٨ becomes "four eight". |
| `—` → `،` | a pause | An em dash is a beat to a reader and nothing to a synthesiser: some pause, some ignore it, some announce it. A comma pauses everywhere. |

Two real lines were affected: Kuwait Towers' `taglineAr` ("على ارتفاع ١٨٧ متر")
and `مجمع ٣٦٠`, whose number is part of its name.

`forSpeech()` does this, and **both paths use it** — the browser fallback and
the ElevenLabs generator — so the recorded clip and the synthetic line stay the
same sentence. `gen-voice.mjs` hashes the *normalised* text, so editing
`forSpeech` itself re-records the clips it changes. The screen is untouched;
this string never reaches it.

The tests assert over the whole catalogue (113 lines), not six hand-picked
strings, and include the negative case — the raw lines really do contain
Arabic-Indic digits and an em dash, so the two "nothing survives" assertions
are not passing by testing nothing.

## Timing: the first answer of a session

`speak()` awaits the clip manifest before it can choose a path, so the first
utterance paid a network round trip **after** the tap and before any sound —
silence exactly where the visitor is waiting to learn whether the thing works
at all. It is memoised, so only the first one was ever slow.

`primeAudio()` now starts that fetch. It already runs inside the gesture
handler, for the iOS unlock, which makes it the right place: the manifest
downloads while the gesture is still being handled rather than afterwards.

## Timing: the gap between clips — known, not fixed

A spoken answer is up to seven clips: the echo, "أقترح عليك:", the place, its
best time, a summer warning, "وإذا تبي غيره", the alternative. `playNext()`
assigns `audio.src` and plays, one clip at a time, so **each clip's fetch
starts only when that clip becomes due**. On a phone connection a round trip
sits between every pair, and the gaps land exactly where a listener reads
meaning into them.

This is latent rather than live: `public/voice/` holds no clips at all, so
every utterance currently takes the synthetic path, which is one continuous
utterance with no gaps. It becomes real the moment the ElevenLabs key exists
and the clip library is generated.

**Two attempts at fixing it were reverted**, and the reason is worth keeping:

1. *Warm the next clip in a second, throwaway element.* That halves nothing —
   the player then requests the same URL itself, and whether the second request
   costs anything comes down to whether the host sent a cache header. The clip
   test caught it: eight clips fetched twice.
2. *Double-buffer, two elements taking turns.* Correct in principle, and the
   right shape for the eventual fix. In practice `stop()` runs at the top of
   every `speak()` and discards the warmed clip, `primeAudio` has to unlock
   both elements, and the duplicate count fell to five rather than zero.

Neither was worth shipping into a dormant path on the way to something else.
When the clips exist, the fix is the double buffer plus a `stop()` that
distinguishes "abandon this utterance" from "advance within it" — and the
assertion to write first is the one that caught both attempts: no clip is ever
fetched twice.
