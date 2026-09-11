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

## Status, measured 11 September 2026

**Nothing is recorded yet** — zero of the **324** lines (162 per persona).
Every spoken line on the live site is read by the browser's own Arabic
synthesiser. That is why شوق sounds like a screen reader.

**One real render exists**, `docs/voice-sample/shouq-talya-search-empty.mp3`:
her `search-empty` line in Talya, generated through the ElevenLabs connector.
It is a sample and deliberately not in `public/voice/` — it came out at 128
kbps and at the connector's default settings rather than the `mp3_44100_64`,
`stability 0.35`, `similarity_boost 0.8` the library is specified at, and a
library rendered at the wrong settings is the drift `docs/voice.md` exists to
prevent. Use it to hear her; generate the library with the script.

**Everything except the key is now wired.** The route is §4 below — CI, with
the library cached between runs. `ELEVENLABS_API_KEY` in GitHub's secrets UI
is the whole remaining step.

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
second**, not the 7.5 estimated from the espeak fixtures.

**There are two rates, not one.** Measured again on 5 September: a single
continuous 279-character Kuwaiti passage, through this same voice and the
agent's own model, came back at 24.61 seconds — **11.3 characters a second**,
and 12.0 at the agent's speed of 1.06. The 9.4 figure is not wrong; it is
measuring something else. It came from a two-utterance sample, and the silence
between two utterances is counted in the duration but not in the characters.

**And the 11.3 was too generous — corrected 7 September.** Re-measured on a
242-character line through the deployed voice, one continuous utterance:

| model | duration | c/s at 1.00 | c/s at the agent's 1.06 |
| --- | ---: | ---: | ---: |
| `eleven_turbo_v2_5` (was live) | 25.22s | 9.60 | **10.17** |
| `eleven_flash_v2_5` (now live) | 22.43s | 10.79 | **11.44** |

So the old model ran at 10.17, not 12.0 — about 15% slower than this file
claimed. That is not a rounding quarrel, because the whole prompt is built on
a fifteen-second ceiling («أي جواب يطول أكثر من خمستعشر ثانية صار خطبة مو
خدمة»). At her measured 178-character mean the real number was **17.5
seconds** — over her own limit, on every answer of average length, for as long
as the wrong rate went unchecked. Nothing in the prompt was wrong; the budget
it was written against was.

Use **11.4 c/s** now. 178 characters is 15.6 seconds, which is at the ceiling
rather than four seconds past it — and it is the model change below, not any
editing, that put it there.

One caveat on the arithmetic, stated rather than buried: both numbers were
generated at speed 1.00, because the generation endpoint takes no speed
parameter. The 1.06 column is scaled, which assumes speed scales linearly. It
is a reasonable assumption and it is not a measurement.

So use the rate that matches the pipeline. The recorded clips in `voice-lines`
are one utterance per sentence, and 9.4 is theirs — the ~15s ceiling Chrome
puts on a single utterance is why they are split that way, and that stays
necessary. شوق speaks a whole answer in one continuous turn, and 12.0 is hers:
her measured mean of 178 characters is about **fifteen seconds**, at the
ceiling rather than four seconds past it. Applying the clip rate to her
answers overstated them by a quarter — enough to send someone chasing a length
problem that is not there.

**Her pronunciation was measured, not assumed.** The same passage was written
to be dense with everything that could plausibly break: the Gulf چ in «چاي»،
«باچر» and «مچبوس», place names the catalogue depends on (مقاهي المباركية،
جسر الشيخ جابر، الأفنيوز، سوق السمك), and a spelled-out number. It was
generated in her voice and transcribed straight back with Scribe, and the
transcript came back **character-identical to the source**. Nothing is
mispronounced, so `pronunciation_dictionary_locators` stays empty — a
dictionary here would be effort spent correcting something that is already
right. Worth re-running if the voice or the TTS model ever changes; the two
calls are a generate and a transcribe on one flow.

One limit, stated rather than glossed: the round trip runs at the voice's
default stability, not the agent's 0.35, so it proves the voice and model say
these words correctly — not that every setting on top of them preserves it.

## The TTS model and the sample rate, changed 7 September

Two settings had been sitting untouched since the agent was built, and neither
survived being looked at.

**She was running a deprecated model.** `eleven_turbo_v2_5` is marked in the
API's own enum as *"Deprecated: Use eleven_flash_v2_5 instead."* It still
worked, which is exactly why nobody noticed. Now on `eleven_flash_v2_5` — the
successor the deprecation notice names, not a guess at what might be better.

The swap is not only housekeeping: on the identical line it is 22.43s against
25.22s, 11% shorter, and that is what brings her mean answer back under the
fifteen seconds the prompt is written around. A pronunciation round-trip was
run on both before switching, and both came back character-identical to the
source — چاي, باچر, مقاهي المباركية, جسر الشيخ جابر, ستة وثلاثين. So the
faster model gives up nothing on the hard cases.

**And she was speaking at 16 kHz.** `agent_output_audio_format` was
`pcm_16000`, which caps the audible band at 8 kHz — the telephone ceiling.
شوق is not on a telephone; she is delivered through a browser widget on
wainkw.com, where there is no reason to accept a phone line's bandwidth. Now
`pcm_24000`.

That one is a judgement rather than a defect. It costs bandwidth — roughly
384 kbps against 256 for raw PCM — and the gain is in sibilance and air rather
than intelligibility, which was already fine. If Kuwaiti mobile data ever makes
that a problem, `pcm_16000` is one field away and nothing else depends on it.

**`optimize_streaming_latency: 3` is dead and cannot be removed.** The API
marks it *"Deprecated: this field is a no-op and is ignored"*, and it carries a
default, so there is no value that makes it go away — setting it would be
churn against a field nothing reads. Left as it is, recorded here so the next
person to see it does not go looking for what it does.

Levels were measured at the same time, through Chromium's decoder the way
`clip-levels.mjs` does it: peak −2.5 dBFS and gated RMS −16.4 on the old
model, −1.9 and −16.1 on the new. No clipping either way, and both sit close
to the −4.3 / −17.0 recorded from the first sample.

**`multilingual_v2` was measured on 9 September, so nobody has to wonder.**
The same 131-character line through Talya: flash **10.87s**, turbo **13.37s**,
multilingual **13.42s**. Multilingual is not a better turbo — it is the same
length — so everything above flash costs 23% more talking and buys nothing on
the axis the prompt is written around, which is answers under fifteen seconds.
The 11% measured on 7 September holds at a different length, from a different
direction.

That gap is the reason to leave `speed: 1.06` and `stability: 0.35` alone as
well. They read as "she is rushing" if you meet them cold; they are in
`docs/wain-ai-agent.md` as deliberate — «الدليل يمشي أسرع من الراوي», and low
stability is what makes a voice read young rather than composed.

**Arabic-Indic digits were round-tripped through the live path too.** «مجمع
٣٦٠ في الزهراء» came back character-identical. That is weaker than it looks —
Scribe writes ٣٦٠ whether she said «ثلاثمية وستين» or «ثلاثة ستة صفر», so it
rules out the digits being *dropped* and little else. Worth knowing because
`forSpeech()` does **not** run on the live path: it normalises ١٨٧ → 187 and
چ → تش for the clips and the browser fallback only. The agent's own
`text_normalisation_type` is `system_prompt`, and the prompt says nothing
about digits.

## Two turn settings, both measured, one kept

**The thinking filler is on, at five seconds.** `soft_timeout_config` had a
message written — «ثانية وحدة…» — and `timeout_seconds: -1`, so it could never
fire: a filler nobody could hear. Switching it on at **two** seconds was worse
than leaving it off. Her LLM turn regularly takes longer than two seconds, so
it fired on **15 of 18** test runs and stacked up to three fillers in front of
one answer:

> «خلّيني أشوف لك…. لحظة، أدوّر لك…. ثانية وحدة…. أوكي، تبين طلعة بخمس
> دنانير، شنو خاطرك تسوين؟»

That is not a filler, that is a stammer, and the budget test went from passing
to failing because the recommendation never arrived. At **five seconds, capped
at one, with a single phrase**, it fires on 3 of 18 — the genuinely slow turns
it was written for — and nothing else changed. If it ever starts appearing on
most turns again, the threshold is wrong, not the idea.

**Speculative turn is off, and that is a decision, not a default.** Turning it
on makes her start generating during the caller's silence, and it measurably
helped correctness — 18/18 against 17/18. It also cut how often she ends a
turn by handing it back, from 12 of 18 to **6 of 18**, and made her answers
longer (193 characters against 170). On a phone call an answer that ends in a
statement ends in silence, and silence reads as a dropped line: two thirds of
her turns leaving the caller unsure whether she was finished is a worse fault
than one intermittent test. The 18/18 was one run of ذكاء ٥, which has been
flaky in both directions all along.

So: correctness within noise, turn-taking clearly worse, and off it stays.
Re-test both numbers before turning it back on.

## Handing the turn back — where the silence actually comes from

The 12-of-18 hand-back figure above was treated as a phrasing problem, and
the first fix was phrasing: the closing question became the mandatory fifth
step of the answer shape in the brief and the live prompt, a floor where the
other four steps are a ceiling. Measured on 6 September (9 tests × 2):
**18/18 correct, hand-back 13 of 18**. One better than before, and eight of
the nine pairs came back character-identical — the agent runs at temperature
0, so a repeat is not a second sample and «18 runs» is really nine.

Reading the two transcripts that still went quiet showed the number was
measuring the wrong thing. Neither answer lacked a question because she forgot
one. In both, she gave the recommendation, **called `show_places`, and then
the turn generated after the tool result was empty** — no «حطيتهم لك على
الخريطة», no question, nothing. The turns without a tool call handed back
every time. The fault is not in the sentence she writes before the tool; it is
that the sentence after the tool is not written at all.

Two changes, one per side of that boundary:

- **The prompt** now says it explicitly, in the tools section and in call
  habit ٢: the reply after `show_places` or `open_place` is never empty — one
  sentence for what changed on the screen, one question to return the turn.
  Re-run: **9/9 correct, hand-back 7 of 9**. The two misses were, again, the
  two runs where a tool was called — different tests this time (٥ and ٧
  instead of ١ and ٣), which is the pattern moving with the tool call rather
  than with the question. The prompt can shift which turns call a tool; it
  does not fill the turn after one.
- **The tool result** is the other input to that turn, and it was «showing
  places for: قهوة هادية» — a status line in English, after which a model
  that has already answered has nothing to add. `WainAiCall.tsx` now returns,
  in her language, what is on the screen and that the caller is waiting for
  her: «الأماكن المطابقة لـ «…» الحين على الخريطة قدام الزائر. قولي له بجملة
  وحدة إنها على الخريطة، واسأليه سؤال قصير يرجّع له الدور.» The refusals say
  the one thing that matters instead of a code: nothing on the screen changed.

**The second change is not measurable from here**, stated plainly: the agent
test runner skips client tools and hands the model a stub result («Skipping
tool call in test mode»), so the 7 of 9 is the ceiling the tests can show,
not the number a real call gets. The browser test pins what the tool returns;
whether the model speaks from it is a question for the conversation logs once
the site has had some calls. If the post-tool turn is still empty there, the
next lever is `pre_tool_speech: "force"` on both tools, which makes her speak
before the call rather than relying on the turn after it — a change to the
call's rhythm, so measure, do not assume.

**A third change, 7 September, that the runner *can* see.** A new test that
greets her in heavy slang failed on one criterion only: she understood every
word, answered in Kuwaiti, called `show_places`, and the sentence before the
call ended on a full stop. So the prompt now says the sentence *before* a tool
call must itself end on the short question — «شرايك؟», «أفتح لك صفحته؟» — and
only then call the tool; the tool may be slow or return nothing, and the turn
has to already be the caller's. That is the pre-tool half of the same silence,
and it is the half the test runner exercises. Re-run: **10/10 correct,
hand-back 9 of 10**, and all three replies that called a tool ended on a
question. The remaining miss (ذكاء ٢) asks its question mid-reply and
finishes on the place's description, which is the length rule and this rule
pulling on the same sentence rather than anything to do with tools.

**And the tool result now tells her what is actually on the screen.** The
first Arabic result said «the matching places are on the map» for any query
at all — including a query the search page answered with «ما لقينا شي», so
she would confirm places that were not there, and a slug she misremembered
navigated to a 404 and then told her the page was open. `WainAiCall.tsx` now
runs the same search the page runs (same index, same limit, places only) and
returns the count and the first three names — «٤ أماكن مطابقة لـ «…» الحين
على الخريطة قدام الزائر، أولها: …» — or, on zero, «ما لقيت ولا مكان» with an
instruction to say so and try a wider word; `open_place` checks the slug
against the catalogue and returns the place's name, or a refusal, before
anything navigates. The search module is loaded on the first tool call
rather than imported, so the call chunk that is preloaded on hover of the
button does not carry the index. The browser test asserts all of it: the
count and the first name on a real query, the zero-result wording on a
nonsense one, the name on a real slug, and no navigation on a well-formed
slug that is not a place. The prompt has a matching line: name the first
place when names come back, and never say «حطيتهم لك على الخريطة» when the
result says nothing was found.

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

## 2. Hear one line before generating 324

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
that simply doesn't sound like a young Kuwaiti woman. The full library is 324
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

This writes **324 MP3s** (162 lines × 2 personas: greeting, connectors, and a
full suggestion + short name + best time for every place) plus
`public/voice/manifest.json`. Then build and deploy as usual — the clips ride
along in `out/`, and they have to: `deploy.php` prunes against the manifest, so
anything uploaded beside a deploy is deleted by the next one.

The count moves with the catalogue. It was 226 when there were 33 places and is
324 at 52, so a number written down here is a reading rather than a constant —
`node scripts/gen-voice.mjs --dry-run` prints the current one and spends
nothing.

**Editing a line re-records it automatically.** The manifest stores a hash of
the exact sentence behind every clip, and a clip whose sentence no longer
matches is regenerated on the next run. This used not to be true: the script
skipped anything whose `.mp3` already existed, so an edited line kept its old
recording for ever and شوق said one thing aloud and another through the browser
voice — with the recording winning, because the clip path takes priority
whenever clips exist. `--force` still re-renders everything, but you should no
longer need it for a copy change.

## 4. Or let CI do it — which is the only route that works today

Add one repository secret (Settings → Secrets and variables → Actions):

- `ELEVENLABS_API_KEY`

`ELEVEN_VOICE_SHOUQ` and `ELEVEN_VOICE_SALEM` are optional overrides; without
them the generator uses the ids in `DEFAULT_VOICE_IDS`, which are the voices
this workspace actually owns and the ones the n8n TTS bridge is set to.

The deploy workflow runs `gen-voice.mjs --ci` before each build: with the
secret set it renders any missing clips; without it the step logs a notice,
the next step warns, and the build ships the browser-voice fallback.

**This sandbox cannot do it, and an API key would not change that.**
`api.elevenlabs.io` is refused at CONNECT by the egress gateway here — the
same block that stops uploads to Hostinger — so `npm run voice:sample` answers
`403 … Host not in allowlist` whether a key is set or not. A GitHub runner
reaches it over the ordinary internet. The key belongs in GitHub's secrets UI
and nowhere else: not in a chat message, not in a file, not in this repository.

### The library is cached between runs, and that is load-bearing

Measured, not estimated: **324 clips, 13,247 characters**, 162 lines per
persona. The generator renders them one at a time with a 350ms pause between
calls, which is **~13 minutes** and **about $2.40** for a cold run — priced off
the one real render this repository has, 75.99 credits ≈ $0.014 for a 90-
character line. A checkout is fresh, so without a cache that is paid
in full on **every push** — for a set of sentences that changes a few times a
year.

So `actions/cache` restores `public/voice/` before the step. The exact key
hashes everything that can change a clip (`voice-lines.ts`, `arabic.ts`,
`places.ts`, `gen-voice.mjs`); the `voice-` prefix restore-key hands over the
previous library when one of them moves, which is the case that matters —
editing one line then costs one render, not 324. Correctness does not depend
on the key being right: every clip carries a hash of
`{text, voiceId, model, format, settings}`, so a restored file that no longer
matches is re-recorded regardless. The key only decides how much is reused.

### `public/voice/` is gitignored, and that is also load-bearing

It is generated output — ~14MB of MP3 plus the manifest cataloguing it — and
it is ignored for two measured reasons.

**It would be 14MB in git for ever.** This repository already carries 25MB of
release archives committed and removed six times over; the removals reclaim
nothing, and history cannot be rewritten because شوق's knowledge base is
pinned to a commit on this branch.

**And it would have cost the deploy its proof.** `next.config`'s
`buildIdFromGit` falls back to a **random** build id whenever
`git status --porcelain` is not empty, and CI generates these clips into the
working tree *before* `npm run build`. Untracked, they were 324 `??` lines: the
moment `ELEVENLABS_API_KEY` was set, every deploy would have shipped
`_next/static/<random>/` instead of `_next/static/<commit>/` — which is the one
artefact whose name carries the commit, and the thing `deploy:verify` proves a
deploy with. Turning شوق's voice on must not silently take away the evidence
that the deploy landed. The workflow now asserts the tree is clean before it
builds, so that can never be discovered after the fact.

A fresh clone therefore has no `public/voice/` at all. `audit:voice` treats
that as «not generated yet» and warns, exactly as it already did for a manifest
with zero clips.

## How it behaves in the site

- **/search** — the «الاقتراح الصوتي» toggle turns on spoken suggestions;
  once a search settles, the active persona announces the best match. The
  persona picker (شوق / سالم) previews the voice when switched.
- **Place pages** — the map card has «اسمع الاقتراح», which speaks this
  place and up to two related ones.
- Preferences persist in the visitor's Local Storage only (documented on
  the privacy page). Clips are cached for a week by `.htaccess`.
- Costs: generation is 6,623 characters for شوق and 6,624 for سالم, once per
  change rather than once per visitor; visitors stream the static MP3s from
  your hosting, never from ElevenLabs.

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
proves it: swap شوق's voice and every one of her clips is re-recorded while
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
