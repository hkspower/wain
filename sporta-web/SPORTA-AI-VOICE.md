# سبورتا AI — the voice, and n8n

Two optional add-ons to the assistant. **The shop works completely without
both**: with neither configured there is no speaker button and no handoff, and
every answer is the same one it always was, looked up from the database.

---

## 1. The voice (ElevenLabs)

### Pick the voice first — it is the only thing you have to choose

There is **no "Kuwaiti" setting**. The accent lives entirely in the voice you
pick, so this is a listening job, not a configuration one:

1. Sign in at elevenlabs.io → **Voices** → **Voice Library**.
2. Filter **Language: Arabic**, **Gender: Male**, **Age: Middle-aged**.
3. Audition them with a real Sporta sentence, not the sample text — paste:

   > التوصيل داخل الكويت في نفس اليوم للطلبات المؤكدة، والتوصيل مجاني.

   A Levantine or Egyptian voice will read it perfectly and still sound
   foreign to a Kuwaiti customer. Listen for Gulf vowels; if none of the
   library voices land, an **Instant Voice Clone** of a Kuwaiti speaker
   reading two minutes of that text is the fallback (needs their consent).
4. Add it to your voices and copy the **Voice ID** (a 20-character string).

### Then, in `api/config.php` on the server

```php
'tts_key'       => 'sk_…',           // ElevenLabs → Profile → API key
'tts_voice_id'  => 'xxxxxxxxxxxxxxxxxxxx',
'tts_model'     => 'eleven_multilingual_v2',
'tts_cache_dir' => __DIR__ . '/../../sporta-voice',
```

`eleven_multilingual_v2` is not optional. A monolingual model reads Arabic
letters with English phonemes, which is worse than silence.

`cron_key` must already be set — the signature is keyed on it.

### What it costs, and why that is small

Almost nothing, because **the shop's answers repeat**. Delivery, returns,
payment methods and the greeting are the same words every time; each is
synthesised once and served from `sporta-voice/` on disk for ever after. Only
a genuinely new sentence — an order card, a product list — is ever bought.

The cache directory sits **above `public_html`** (`SERVER-LAYOUT.md`). An
audio cache inside the web root is a directory anyone can walk, and some of
those files quote an order number.

### The rule that keeps the bill yours

**The browser can never ask for arbitrary speech.** Every reply the assistant
writes carries `speak` — an HMAC of that exact sentence, keyed on `cron_key`.
`api.php?r=say` synthesises only text whose signature verifies and answers 403
to everything else, *before* touching ElevenLabs.

Without that check this endpoint is a free text-to-speech service for the
entire internet, billed to this shop. The signature is also bound to the
language, so the same words cannot be replayed as the other one.

---

## 2. n8n (the handoff)

Fired at exactly two moments: the customer **asked for a person**, or the
question **fell through and found nothing**. Not on every message — n8n is not
a transcript log.

```php
'n8n_webhook' => 'https://your-n8n/webhook/sporta-ai',
'n8n_secret'  => 'a long random string',
```

Import `dropin/n8n/sporta-ai-handoff.json` and set an n8n environment variable
`SPORTA_N8N_SECRET` to the same string. The first node in that workflow
verifies `X-Sporta-Signature` and throws if it does not match — keep it there.
A webhook URL stops being a secret the moment it is in a browser history, and
a workflow that messages a human on an unverified payload is a way to make
this shop send messages for strangers.

The POST is **fire-and-forget with a 4-second timeout**. The customer already
has their answer on screen; whether an automation platform acknowledged the
handoff is not their problem and must never delay or fail their request.

Payload: `source`, `intent`, `lang`, `message`, `reply`, `at`.

---

## Proving it

`npm run test:assistant` covers both against a fake gateway
(`scripts/fake-voice.php`) — forged and unsigned text refused without a single
upstream call, a signed sentence spoken, the same sentence bought only once, a
cross-language replay refused, and the handoff arriving correctly signed and
*not* arriving for an ordinary answered question.

Claude's sandbox cannot reach `api.elevenlabs.io` (it is outside the egress
allowlist), so no voice has been auditioned here and no live call has been
made. Everything above is verified against the fake; the voice itself is your
ear's job.
