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

#### Or let the script do the auditioning

Step 3 by hand means listening to one voice, forgetting it, and listening to
the next — which is how you end up picking the last one you heard. This does
the comparison properly, on your Mac (Claude's sandbox cannot reach
`api.elevenlabs.io`):

```bash
export ELEVENLABS_API_KEY=sk_...
node scripts/voice-audition.mjs --library --take 6 --audition
open scripts/.voice-audition/index.html
```

Every candidate says the **shop's own three sentences** — the greeting, an
order number, and the contact line with the phone and email — put through the
same pronunciation preparation the server applies, so what you hear is what a
customer hears. One page, same sentences, same order, so the choice is A/B.

`--mine` lists the voices already on the account; naming voice IDs outright
auditions just those. It never writes your key anywhere, never clones, and
never touches the server.

### Then, in `api/config.php` on the server

```php
'tts_key'       => 'sk_…',           // ElevenLabs → Profile → API key
'tts_voice_id'  => 'xxxxxxxxxxxxxxxxxxxx',
'tts_model'     => 'eleven_multilingual_v2',
'tts_format'    => 'mp3_22050_32',
'tts_cache_dir' => __DIR__ . '/../../sporta-voice',
```

`eleven_multilingual_v2` is not optional. A monolingual model reads Arabic
letters with English phonemes, which is worse than silence.

`tts_format` is speech, not music. The API defaults to 128 kbps, which is four
times the bytes for nothing anyone can hear on a spoken sentence — and these
play on mobile data. Everything else (`tts_stability`, `tts_style`,
`tts_timeout`, `tts_log`) has a working default; see `config.example.php`.

`cron_key` must already be set — the signature is keyed on it.

### Then warm it, once

```
https://www.sporta.com.kw/api/cron-voice.php?key=YOUR_CRON_KEY&do=warm
```

Paste that in a browser after setting the voice. It buys all thirty-six fixed
sentences — eighteen in each language — in one run, so **no customer is ever
the one who waits for a synthesis call** on "delivery is same-day". Without it
those thirty-six waits happen to thirty-six real people, one each.

Re-run it after changing the voice, the model or the format: each is part of
the cache key, so changing one makes the whole cache cold.

`&do=prune` deletes audio nobody has played in 90 days, and is worth a monthly
hPanel cron — every order-status answer names an order number, so each is a
sentence said once and never again. `&do=` on its own reports what is cached.

It answers over **HTTP** rather than being a command-line script because this
server has no shell and never will. `cron_key` is the authorisation, and a
missing or wrong key is refused before a single upstream call is made.

### What it costs, and why that is small

Almost nothing, because **the shop's answers repeat**. Delivery, returns,
payment methods and the greeting are the same words every time; each is
synthesised once and served from `sporta-voice/` on disk for ever after. Only
a genuinely new sentence — an order card, a product list — is ever bought.

Two customers pressing the speaker on the same new sentence at the same moment
buy it **once**: the second waits on a lock and gets what the first wrote. That
also stops two processes writing one file, which used to be a real risk of an
mp3 that plays as a burst of noise. Audio is written to a temp name and renamed
into place, so a reader sees the whole file or no file, never half of one.

### What it sounds like

The text on screen and the text read aloud are **not the same string**, and the
two sentences a customer most needs to hear right are the two a TTS model gets
most wrong:

- `SP1AU702NKHTKDV` inside an Arabic sentence is a Latin token, and the model
  tries to pronounce it as a **word**. Spelled out, it is read as characters —
  which is the point, because the customer is checking it against the SMS in
  their other hand.
- `22091914` is eight digits, so the model reads **"twenty-two million, ninety
  one thousand…"**. Nobody can dial that. Phone numbers go digit by digit.
- `cs@sporta.com.kw` was handed over whole and came back as one syllable — on
  the single sentence whose entire job is to be **written down** by someone
  holding a phone. It is now spoken as its parts: the local part spelled out,
  the domain joined by "dot", the brand still sounding like the brand.
- `KWD` read as "kay double-you dee", and «د.ك» no better — in the delivery
  answer, one of the three sentences this shop says most. Both are expanded to
  the spoken currency.

Prices are deliberately left alone: `4.000` KWD must stay "four point zero zero
zero", not become four separate digits.

This happens on the way out, after the signature check, so **fixing
pronunciation never invalidates a signature a browser is already holding**, and
what the customer reads is untouched.

### When it does not work

A wrong key, an unknown voice ID and an exhausted quota used to be the same
thing from outside: a speaker button that does nothing. The reason is now
written to `sporta-voice.log`, beside the cache and above `public_html` —
status and reason, never the key. A 200 carrying a JSON error instead of audio
is also refused rather than cached as if it were sound, which would have played
as silence for ever and never retried.

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

Fired at exactly three moments: the customer **asked for a person**, the
customer **asked to cancel an order**, or the question **fell through and found
nothing**. Not on every message — n8n is not a transcript log.

Cancelling is on that list because it is the one intent whose fixed answer is
not the end of the matter: something is already moving, the shop can only stop
it by acting, and the reply tells the customer to telephone. With no handoff
that is advice nobody followed up.

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

**Both ends now refuse to run without the secret.** It used to be optional in
effect: an unset `n8n_secret` signed with an empty key, and an unset
`SPORTA_N8N_SECRET` verified against the same empty key and accepted it — so
the signature check passed and protected nothing. That is worse than having no
check, because the design says the handoff is authenticated. If you configure
`n8n_webhook`, configure `n8n_secret` too, or the shop simply will not send.

The POST is **fire-and-forget with a 4-second timeout**. The customer already
has their answer on screen; whether an automation platform acknowledged the
handoff is not their problem and must never delay or fail their request.

Payload: `source`, `intent`, `lang`, `message`, `reply`, `at`.

---

## Proving it

`npm run test:assistant` (126 checks) covers both against a fake gateway
(`scripts/fake-voice.php`) — forged and unsigned text refused without a single
upstream call, a signed sentence spoken, the same sentence bought only once, a
cross-language replay refused, and the handoff arriving correctly signed and
*not* arriving for an ordinary answered question.

It also proves the parts you cannot hear from here: an order number goes
upstream **spelled out**, a phone number **digit by digit**, an email address
**as its parts** and «د.ك» / `KWD` as the spoken currency — while what the
customer reads on screen is unchanged in every case; audio is asked for at speech bitrate; an upstream
401 lands in the log without the API key in it; a 200 carrying JSON is refused
rather than cached as audio; and after `do=warm` a real customer pressing the
speaker makes **no upstream call at all**.

Claude's sandbox cannot reach `api.elevenlabs.io` (it is outside the egress
allowlist), so no voice has been auditioned here and no live call has been
made. Everything above is verified against the fake; the voice itself is your
ear's job.
