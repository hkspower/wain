# Testing شوق

```
npm run test:shouq
```

163 checks in six layers, because they fail for different reasons.

| Layer | What it protects |
|---|---|
| **what she says** | the answer's shape — the echo, the reason, the time, one alternative, and that clips and spoken fallback stay the same sentences |
| **the question battery** | whether the answer is *right*, not merely well-formed |
| **the knowledge base** | that the brief matches the data and covers what the site can do |
| **the voice** | the iOS unlock, voice selection, and that closing her silences her |
| **the button and the flow** | the call — tap, ring, connect, hang up — and every way it fails |
| **agent mode** | the ElevenLabs path and the two client tools |

## Why the battery exists separately

The shape suite asserts she names whatever came back first. It passes just as
happily when she recommends a museum for «قهوة» — the sentence is perfectly
well-formed and completely wrong. The battery asks real questions in the words
a Kuwaiti would use and checks the *category* that comes back, so a lost
synonym or a changed weight turns into a failure rather than an assistant that
is confidently unhelpful.

It found one on the first run: **«أبي أتغدى» returned nothing at all.** The
synonym table had the "we" forms — نتغدى، نتعشى، نفطر — and none of the "I"
forms beside them, so the most ordinary way to say "I want lunch" fell through
to no results. Both persons are there now, along with أتقهوى.

Where a case lists more than one acceptable category the question is genuinely
open. «مكان يناسب العيال» accepts `culture`, because the Cultural Centre is
tagged «عيال، عوائل» and is a science museum a child would enjoy — the first
run flagged it and the narrow expectation was mine, not a ranking fault.

## Why the knowledge base is tested

`docs/wain-ai-agent.md` is pasted into the ElevenLabs console, so it is not
documentation — it is the agent's entire model of the world. It can be wrong
two ways, and neither shows up anywhere else: it drifts from `places.ts` and
she states facts the site no longer has, or it omits something the site can do
and she never offers it.

Both had happened. Ordering and the queue shipped without a word of either
reaching her. And the generator scraped each field from the whole file and
zipped the results together, which breaks the first time a place has a menu:
`menuAr: [{ nameAr: "چاي" }]` is scraped as a thirty-seventh place name. Fields
are read from inside their own place block now.

## Why the voice is tested

This is the layer where a bug is silent, literally. `primeAudio` exists because
iOS Safari only lets audio start from inside the task that handled the tap, and
شوق deliberately skips the greeting that used to serve as that unlock. Get it
wrong and she says nothing on an iPhone while working perfectly on every
machine anyone tests on.

The harness instruments `play`, `pause`, `speak`, `cancel` and `getVoices`, so
the checks are about what reaches a speaker: that the unlock plays something
*muted*, that the element does not stay muted afterwards, that ar-KW wins over
ar-SA which wins over the browser default, that a new answer cancels the one
before it rather than overlapping, and that closing her really cancels.

It also showed that if `utterance.voice = …` throws, she goes **completely**
silent rather than merely losing the accent. A real browser will not do that,
but the cost of the failure is total and the guard is one line, so the
assignment is now wrapped and a test holds it.
