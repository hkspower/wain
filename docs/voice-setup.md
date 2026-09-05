# صوت وين — ElevenLabs voice setup

Two personas speak place suggestions on wainkw.com:

- **شوق** — a young Kuwaiti woman
- **سالم** — a young Kuwaiti man

The site is a static export, so the ElevenLabs API key never runs in the
browser. Instead, every sentence the personas can say is pre-rendered to MP3
by `scripts/gen-voice.mjs` and shipped as part of the site under
`public/voice/`. Until you generate the clips, the feature still works — the
browser's own Arabic voice reads the same sentences (the shared source of
truth is `src/lib/voice-lines.ts`).

## Status, measured 5 September 2026

**Nothing is recorded yet.** `public/voice/manifest.json` is
`{"version": 0, "clips": {}}` — zero of the **276** lines (138 per persona).
Every spoken line on the live site is read by the browser's own Arabic
synthesiser. That is why شوق sounds like a screen reader.

**The blocker that caused it is gone.** Until now both the clip generator and
the live conversational agent pointed at `w0uhBAmNIG5kUDeaFEsA` (Maryam Essa,
`ar-kuwaiti`, female) and both got `voice_not_found`, because it is a
**library** voice rather than a **workspace** voice — and adding one is a UI
click the API does not expose. On 3 September the four Arabic voices this
workspace owned were all male, so شوق could not be given a voice at all, and
the fix was one click nobody had made.

Re-checked through the connector today, the workspace reaches female Arabic
voices, and شوق has been moved onto one:

| voice | id | |
| --- | --- | --- |
| **Talya — Human-like Arabic AI Bot** | `rh16DBXwtscjdPFeMBYf` | **female, `ar-omani`, young — شوق** |
| Heba Mansuri — Arabic Customer Care | `QsV9PCczMIklRM6xLPAS` | female, `ar-saudi`, formal |
| layla — modern Arabic calm | `g3YpdjT1OTh9cunaumJs` | female, `ar-jordanian` |
| Laloosh — Soothing Arabic Conversation | `albaa6OioIhKtKdCEkQw` | female, `ar-levantine` |
| Eid — Warm, Clear, Confident | `Ywuz3KyW2N5pqKNpwcCL` | male, Gulf — سالم |

**Why Talya.** Nothing in the workspace is Kuwaiti. Omani is Gulf, and a Gulf
ear places it far closer than Levantine or Egyptian — the same «accent first»
reasoning that used to prefer a middle-aged Kuwaiti over a young Levantine.
Her own description carries the rest: «built for Arabic AI assistants… where
the voice needs to feel like a person, not a system», which is the register
شوق is written in. Heba is nearer in accent and is a banking customer-care
voice: right country, wrong job.

**Verified, not assumed.** شوق's real greeting and one real place suggestion
were generated through this voice on 5 September — 195 characters, 20.8
seconds, peak −4.3 dBFS, gated RMS −17.0 dBFS. So the id resolves, the
workspace can speak with it, and the level is where the rest of the pipeline
expects.

That measurement also corrected a number used elsewhere: **9.4 characters a
second**, not the 7.5 estimated from the espeak fixtures. A 170-character
answer is about eighteen seconds — still past the ~15s ceiling Chrome puts on
a single utterance, so splitting an answer into one utterance per sentence
stays necessary.

**What is left is the API key**, which is not in this repository and never
should be:

```
ELEVENLABS_API_KEY=… npm run voice:sample     # one call — listen first
ELEVENLABS_API_KEY=… node scripts/gen-voice.mjs
```

The generator levels the whole set on the way out (`voice:levels`), so no
separate step is owed after it.

`npm run audit:voice` reports all of this from the repo, and is in `npm run
scan`. It warns rather than fails when nothing is recorded — the fallback is
real and the site works — but it does fail when the manifest names a clip that
is not on disk, which is silence in the middle of a sentence rather than a
different voice.

## 1. The two voices

`scripts/gen-voice.mjs` ships a default for each persona, so there is nothing
to pick and nothing to set unless you disagree with the choice:

| | voice | id |
| --- | --- | --- |
| شوق | Talya — Human-like Arabic AI Bot (Gulf, `ar-omani`) | `rh16DBXwtscjdPFeMBYf` |
| سالم | Eid — Warm, Clear, Confident (Gulf) | `Ywuz3KyW2N5pqKNpwcCL` |

**Why these, and what was given up.** The brief calls شوق «صوت كويتي شبابي» —
a young Kuwaiti woman. That voice does not exist in this workspace, and the
two `ar-kuwaiti` female voices in the wider library are both «Maryam», both
recorded middle-aged, calm and unhurried for storytelling — and both
unreachable, being library voices rather than workspace ones.

So the choice was between the right accent at the wrong age, the right age at
the wrong accent, and a voice that cannot be called at all. The third is what
was actually shipping for months. Talya settles it: young, female, and Gulf,
which is the nearest accent available — a Kuwaiti hears a Levantine «شلونك»
instantly, while age is something delivery can push. That is what the
`RENDITION` block in `gen-voice.mjs` is for (lower stability, higher style,
slightly quicker). It cannot turn forty into twenty-five, and this is written
down so nobody has to rediscover it.

**سالم** is `Ywuz3KyW2N5pqKNpwcCL` (Eid), Gulf male, and has always resolved.

## 2. Hear one line before generating 226

```bash
export ELEVENLABS_API_KEY="sk_..."       # Profile → API keys
# ELEVEN_VOICE_SHOUQ only if you are overriding the default above.

npm run voice:sample
```

One API call. It writes `docs/voice-sample/shouq-elevenlabs.mp3` — a real
utterance in the shape شوق actually speaks: greeting, suggestion, best time,
summer warning. **Listen to it before going further.** Everything likely to be
wrong the first time is audible in the first five seconds: a mistyped key, a
voice ID from the wrong account, a model that renders Arabic badly, or a voice
that simply doesn't sound like a young Kuwaiti woman. The full library is 226
paid calls and there is no reason to spend them on a voice you haven't heard.

There is also a placeholder you can play right now, with no key at all:
`docs/voice-sample/shouq-placeholder.mp3`, regenerated by `npm run voice:fixture`.
It is espeak-ng, so it sounds like a robot and is **not** شوق — but the words,
the order and the pacing are hers, which is enough to catch a run-on sentence
or a number read wrongly.

## 3. Generate the clips

```bash
export ELEVEN_VOICE_SALEM="<voice id>"   # the male voice

node scripts/gen-voice.mjs --dry-run     # preview all lines, no API calls
node scripts/gen-voice.mjs               # generate missing and changed clips
```

This writes 226 MP3s (113 lines × 2 personas: greeting, connectors, and a full
suggestion + short name + best time for every place) plus
`public/voice/manifest.json`. Then build and deploy as usual — the clips ride
along in `out/`.

**Editing a line re-records it automatically.** The manifest stores a hash of
the exact sentence behind every clip, and a clip whose sentence no longer
matches is regenerated on the next run. This used not to be true: the script
skipped anything whose `.mp3` already existed, so an edited line kept its old
recording for ever and شوق said one thing aloud and another through the browser
voice — with the recording winning, because the clip path takes priority
whenever clips exist. `--force` still re-renders everything, but you should no
longer need it for a copy change.

## 4. Or let CI do it

Add three repository secrets (Settings → Secrets and variables → Actions):

- `ELEVENLABS_API_KEY`
- `ELEVEN_VOICE_SHOUQ`
- `ELEVEN_VOICE_SALEM`

The deploy workflow runs `gen-voice.mjs --ci` before each build: with the
secrets set it renders any missing clips; without them it logs a notice and
ships the browser-voice fallback.

## How it behaves in the site

- **/search** — the «الاقتراح الصوتي» toggle turns on spoken suggestions;
  once a search settles, the active persona announces the best match. The
  persona picker (شوق / سالم) previews the voice when switched.
- **Place pages** — the map card has «اسمع الاقتراح», which speaks this
  place and up to two related ones.
- Preferences persist in the visitor's Local Storage only (documented on
  the privacy page). Clips are cached for a week by `.htaccess`.
- Costs: generation is a one-time ~7,000 characters per persona; visitors
  stream the static MP3s from your hosting, never from ElevenLabs.

## What is tested

- `tests/voice-pipeline.test.mjs` runs the real generator against a stub API,
  so which clips get re-recorded is verified without spending anything.
- `tests/shouq-clips.test.mjs` drives the playback path in a browser against
  the placeholder MP3s: the manifest lookup, the per-persona key, the queue
  advancing clip to clip, and the all-or-nothing rule — one missing clip sends
  the *whole* utterance to the browser voice, because half a sentence in a
  recorded Kuwaiti voice and half in a robot is worse than all of it in the
  robot. Both run inside `npm run test:shouq`.

---

## The rendition is part of a clip's identity

`gen-voice.mjs` re-records a clip when its sentence changes. It used to do
*only* that: the hash covered the text and nothing else, while the manifest
recorded the voice and the model without ever comparing them. Change شوق's
voice, her stability, her speed, or the model, and every existing clip counted
as current — the site kept playing the old rendition for ever and nothing said
so.

That is the same failure the text hash was added to prevent, one level up, and
it bit hardest at the exact moment somebody set out to improve how she sounds:
the change appeared to succeed and was silently discarded.

The hash now covers the text, the voice id, the model, the output format and
the voice settings. A run that re-records because of one of those says
`rendition changed` rather than `line changed`, so the log distinguishes «this
sentence moved» from «this voice moved». `tests/voice-pipeline.test.mjs`
proves it: swap شوق's voice and all 137 of her clips are re-recorded while
سالم's are left alone. With the old hash that same test records nothing.

---

## The live bridge — a third rendering path

The clip library covers every sentence written down in advance. It cannot
cover one assembled at runtime, and that is exactly where شوق stopped being
herself: the browser's own Arabic voice took over mid-answer, and the drop from
a Kuwaiti woman to a robot is the loudest thing on the page — louder than
anything either voice actually says.

The bridge is an n8n webhook holding the ElevenLabs key server-side, so the
static export still ships no credential; that constraint is why the clip
pipeline exists and it is not relaxed here.

```
POST https://sportake.app.n8n.cloud/webhook/fahad-tts
{ "persona": "shouq" | "salem" | "sporta", "text": "…" }  →  audio/mpeg
```

Set the `WAIN_TTS_URL` repository variable to that URL and the site starts
using it. The path still reads `fahad-tts` after a persona that no longer
exists anywhere in this repo — renaming it would break whatever already calls
it from Sporta, which is a worse trade than an ugly URL.

**The workflow and `gen-voice.mjs` carry the same voice table on purpose.** A
clip and a live sentence are heard one after the other *inside a single
utterance*; if the voice or the settings differ between them, a visitor hears
the speaker change mid-sentence. Change one table and change the other.

**What it costs.** One ElevenLabs call per runtime sentence, at request time —
unlike the clips, which are paid for once. And a configured-but-slow bridge
buys silence, which is worse than the robot, so `voice.ts` gives the sentence
up after four seconds. That number is the whole trade-off; it is a constant
with its reasoning above it.

**Every failure lands on the browser voice**, including the one that does not
look like a failure: a 200 whose body is an error page plays as pure silence,
and silence is indistinguishable from her ignoring the visitor. `voice.ts`
checks the size and the content type before committing to a response.
`tests/shouq-bridge.test.mjs` drives all of it — 500, non-audio 200, empty
body, unreachable, and slow — and with the size/type guard removed the two
silent cases fail exactly as described.
