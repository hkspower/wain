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

## 1. Pick the two voices

1. Sign in at <https://elevenlabs.io> and open **Voices → Voice Library**.
2. Search for **Arabic** voices. Listen for:
   - a young, warm **female** voice for شوق,
   - a young, energetic **male** voice for سالم.
   Gulf-accented voices sound best for the Kuwaiti lines; test each voice
   with a sentence like «هلا! وش تدوّر عليه اليوم؟» before choosing.
3. Add both voices to *My Voices* and copy each **Voice ID**
   (the `xxxxxxxxxxxxxxxxxxxxx` string on the voice's page).

## 2. Generate the clips locally

```bash
export ELEVENLABS_API_KEY="sk_..."       # Profile → API keys
export ELEVEN_VOICE_SHOUQ="<voice id>"   # the female voice
export ELEVEN_VOICE_SALEM="<voice id>"   # the male voice

node scripts/gen-voice.mjs --dry-run     # preview all lines, no API calls
node scripts/gen-voice.mjs               # generate missing clips
```

This writes ~78 MP3s (39 lines × 2 personas: greeting, connectors, and a
full suggestion + short name for every place) plus
`public/voice/manifest.json`. Re-running only generates what's missing;
`--force` re-renders everything (do this after editing any line or place
copy). Then build and deploy as usual — the clips ride along in `out/`.

## 3. Or let CI do it

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
- Costs: generation is a one-time ~4,000 characters per persona; visitors
  stream the static MP3s from your hosting, never from ElevenLabs.
