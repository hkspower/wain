// Pick Sporta's voice by EAR, not by reading adjectives on a web page.
//
// WHY THIS IS A SCRIPT AND NOT A RECOMMENDATION. Accent is the whole question
// here — the shop wants a young Kuwaiti voice with a call-centre manner — and
// accent is a property of the VOICE, not of anything in config. No amount of
// tuning stability or style turns a Levantine read into a Kuwaiti one. So the
// only honest way to choose is to hear the candidates saying the shop's own
// sentences, which is what this does.
//
// It also cannot be done from Claude's sandbox: api.elevenlabs.io is refused at
// CONNECT by the egress policy, so this is written to run on your Mac.
//
//   export ELEVENLABS_API_KEY=sk_...
//   node scripts/voice-audition.mjs --library          # find Arabic voices to try
//   node scripts/voice-audition.mjs --mine             # voices already on the account
//   node scripts/voice-audition.mjs <id> <id> <id>     # audition them, side by side
//   node scripts/voice-audition.mjs --library --take 6 --audition    # both at once
//
// Output lands in scripts/.voice-audition/ (git-ignored): one mp3 per voice per
// sentence, plus index.html — open that and every candidate is a play button in
// one page, so the comparison is A/B and not "listen, forget, listen again".
//
// THE SENTENCES ARE THE SHOP'S OWN, not "the quick brown fox". A voice is
// chosen on how it says «أهلًا بك في سبورتا» and how it reads an order number
// aloud, because those are the sentences it will actually be paid to say. They
// are run through the SAME pronunciation preparation the server applies, so
// what you hear in this page is what a customer hears — order numbers spelled
// out, the phone number digit by digit, the email as its parts.
//
// WHAT THIS NEVER DOES: write your API key anywhere, clone a voice, or change
// anything on the server. It reads, it synthesises, it saves mp3s. The voice ID
// you settle on goes into api/config.php by hand — see the closing note it
// prints.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '.voice-audition')
const API = 'https://api.elevenlabs.io'

const KEY = process.env.ELEVENLABS_API_KEY ?? ''
if (!KEY) {
  console.error(`
No ELEVENLABS_API_KEY in the environment.

  export ELEVENLABS_API_KEY=sk_...
  node scripts/voice-audition.mjs --library

The key is read from the environment and never written to disk, so it does not
end up in the repo. Get one at elevenlabs.io -> profile -> API key.
`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const ids = argv.filter((a) => !a.startsWith('--') && !/^\d+$/.test(a))

// The model. eleven_multilingual_v2 is the safe default and the one the server
// ships with; the flash model is faster and cheaper but a different read, so
// audition on whatever you will actually run.
const MODEL = opt('--model', 'eleven_multilingual_v2')
const TAKE = Number(opt('--take', '8'))

const api = async (path, init = {}) => {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'xi-api-key': KEY, ...(init.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${path} -> ${res.status} ${body.slice(0, 200)}`)
  }
  return res
}

// ---------------------------------------------------------- what they will say
//
// Three sentences, chosen because each one breaks a different way.
const LINES = [
  {
    id: 'greeting',
    lang: 'ar',
    // The first thing every visitor hears. Warmth is judged here or nowhere.
    text: 'أهلًا بك في سبورتا. أقدر أساعدك في حالة طلبك، التوصيل، الإرجاع، أو إيجاد المقاس المناسب.',
  },
  {
    id: 'order',
    lang: 'ar',
    // A Latin token inside an Arabic sentence — the case that makes a
    // multilingual model stumble, and the case a customer must transcribe.
    text: 'لم أجد طلبًا بالرقم SP1AU702NKHTKDV. تأكد من الرقم وأرسله مرة ثانية.',
  },
  {
    id: 'contact',
    lang: 'ar',
    // Digits and an email address: the sentence people write down.
    text: 'يسعدنا خدمتك: +965 22091914 أو cs@sporta.com.kw',
  },
]

// ------------------------------------------------- the server's own preparation
//
// A PORT, DELIBERATELY, of assistant_speech_prep() in dropin/php-store/
// assistant.php. Auditioning the raw sentence would be auditioning something
// the shop never sends: the customer hears the PREPARED text, so that is what
// has to come out of the speakers here.
//
// If you change the PHP, change this — and note that assistant-test.mjs asserts
// the PHP behaviour, so the PHP is the one that is proven. This copy exists so
// the audition is honest, not as a second implementation to rely on.
function prep(text, lang) {
  text = text.replace(/\b(SP[A-Za-z0-9]{4,28})\b/g, (m) => [...m.toUpperCase()].join(' '))
  text = text.replace(/(?<![\d.])(\d{7,})(?![\d.])/g, (m) => [...m].join(' '))
  text = text.replace(/\+(\d{1,4})\b/g, (_, d) =>
    (lang === 'ar' ? 'زائد ' : 'plus ') + [...d].join(' '))
  text = text.replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (_, user, host) => {
    const at = lang === 'ar' ? ' آت ' : ' at '
    const dot = lang === 'ar' ? ' دوت ' : ' dot '
    return [...user].join(' ') + at + host.split('.').join(dot)
  })
  text = lang === 'ar'
    ? text.replace(/\bد\.?\s?ك\b/gu, 'دينار كويتي')
    : text.replace(/\bKWD\b/gu, 'Kuwaiti dinars')
  return text.replace(/[ \t]+/g, ' ').trim()
}

// ------------------------------------------------------------------- listing
const label = (v) => {
  const l = v.labels ?? {}
  return [l.accent, l.age, l.gender, l.use_case ?? l.description].filter(Boolean).join(' · ')
}

async function mine() {
  const j = await (await api('/v1/voices')).json()
  return (j.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name, note: label(v) }))
}

// The shared library is where an ARABIC voice actually comes from — an account
// starts with the stock English set, and none of those is the answer to
// "young Kuwaiti". Filtered to Arabic and sorted by how much other people use
// them, which is the closest thing to a quality signal the API offers.
async function library() {
  const qs = new URLSearchParams({
    page_size: String(Math.max(TAKE, 20)),
    language: 'ar',
    sort: 'trending',
  })
  const j = await (await api(`/v1/shared-voices?${qs}`)).json()
  return (j.voices ?? []).slice(0, TAKE).map((v) => ({
    id: v.voice_id,
    name: v.name,
    note: [label(v), v.accent, v.age, v.gender].filter(Boolean).join(' · '),
    // A library voice must be added to the account before it can be used by
    // ID. The audition below reports this rather than failing mysteriously.
    shared: true,
    owner: v.public_owner_id,
  }))
}

// ----------------------------------------------------------------- synthesis
async function say(voiceId, text, lang) {
  const res = await api(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_22050_32`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      // THE CALL-CENTRE SETTINGS, and the ones the server ships with — so what
      // you hear is what the shop will sound like, not a demo tuned to
      // flatter. Stability below the halfway mark keeps some life in the read;
      // push it up and a greeting starts to sound like a station announcement.
      voice_settings: {
        stability: Number(opt('--stability', '0.45')),
        similarity_boost: Number(opt('--similarity', '0.8')),
        style: Number(opt('--style', '0.0')),
        use_speaker_boost: true,
      },
      ...(MODEL === 'eleven_multilingual_v2' ? {} : { language_code: lang }),
    }),
  })
  return Buffer.from(await res.arrayBuffer())
}

// --------------------------------------------------------------------- main
const wantList = flag('--library') || flag('--mine')
let candidates = ids.map((id) => ({ id, name: id, note: 'given on the command line' }))

if (flag('--mine')) candidates = [...candidates, ...(await mine())]
if (flag('--library')) candidates = [...candidates, ...(await library())]

if (wantList) {
  console.log(`\n${candidates.length} voice(s):\n`)
  for (const v of candidates) {
    console.log(`  ${v.id}  ${v.name}${v.note ? `\n      ${v.note}` : ''}${v.shared ? '\n      (library voice — add it to your account before use)' : ''}`)
  }
  console.log('')
}

if (!candidates.length) {
  console.error('Nothing to audition. Pass voice IDs, or --library / --mine.')
  process.exit(1)
}
// Listing alone is a listing. Auditioning costs credits, so it is opt-in when
// combined with a listing flag, and implied when IDs are named outright.
if (wantList && !flag('--audition')) {
  console.log('Add --audition to hear them say the shop\'s own sentences.\n')
  process.exit(0)
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const rows = []
for (const v of candidates) {
  const files = []
  for (const line of LINES) {
    const spoken = prep(line.text, line.lang)
    const name = `${v.id}-${line.id}.mp3`
    try {
      writeFileSync(join(OUT, name), await say(v.id, spoken, line.lang))
      files.push({ ...line, file: name, spoken })
      console.log(`  ok    ${v.name}  ${line.id}`)
    } catch (e) {
      // A shared-library voice that has not been added to the account answers
      // 400 here. Reported per voice so one bad candidate does not end the run.
      console.log(`  FAIL  ${v.name}  ${line.id}  — ${String(e.message).slice(0, 120)}`)
    }
  }
  if (files.length) rows.push({ ...v, files })
}

// One page, every candidate, same sentences in the same order. The comparison
// has to be side by side: a voice heard alone always sounds fine.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
writeFileSync(join(OUT, 'index.html'), `<!doctype html>
<html lang="ar" dir="rtl"><meta charset="utf-8">
<title>Sporta — تجربة الأصوات</title>
<style>
  body{font-family:system-ui,-apple-system,"SF Arabic",sans-serif;background:#E2DBCE;color:#171A1E;margin:0;padding:24px}
  h1{font-size:20px;margin:0 0 4px}
  p.sub{margin:0 0 24px;opacity:.7;font-size:14px}
  .v{background:#fff;border-radius:14px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 3px #0001}
  .id{font:12px ui-monospace,monospace;opacity:.6;direction:ltr;text-align:right}
  .l{display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap}
  .t{font-size:13px;opacity:.75;flex:1;min-width:240px}
  audio{height:34px}
  b{color:#E0561C}
</style>
<h1>أي صوت هو صوت سبورتا؟</h1>
<p class="sub">نفس الجُمل، بنفس الإعدادات — الفرق هو الصوت وحده. الموديل: ${esc(MODEL)}</p>
${rows.map((v) => `<div class="v">
  <div><b>${esc(v.name)}</b> ${v.note ? `— ${esc(v.note)}` : ''}</div>
  <div class="id">${esc(v.id)}</div>
  ${v.files.map((f) => `<div class="l"><audio controls preload="none" src="${esc(f.file)}"></audio><div class="t">${esc(f.spoken)}</div></div>`).join('')}
</div>`).join('\n')}
`)

console.log(`
${rows.length} voice(s) auditioned.

  open ${join(OUT, 'index.html')}

When you have picked one, put its ID on the SERVER — it is never committed:

  npm run ftp -- get /public_html/api/config.php ./config.php
  # edit:  'tts_key' => 'sk_...',  'tts_voice_id' => '<the id>',
  #        'cron_key' => '<any long random string>',
  # then upload it back through hPanel File Manager — npm run ftp cannot
  # overwrite config.php by design.

Then warm the cache so the common answers play instantly:

  curl "https://www.sporta.com.kw/api/cron-voice.php?key=<cron_key>"
`)
