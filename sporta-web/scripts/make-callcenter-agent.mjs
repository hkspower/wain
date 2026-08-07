#!/usr/bin/env node
// Create (or update) the Sporta call-centre agent on ElevenLabs Conversational AI.
//
// WHY THIS IS A SCRIPT AND NOT A DASHBOARD CLICK-THROUGH:
// the persona below is not decoration. It carries the shop's real rules —
// the delivery fee, the three payment methods, the returns window, what the
// agent is forbidden to invent. Those are the same numbers store.php charges,
// and a voice that quotes a different figure is a refund and an apology. Kept
// in the repo, they can be reviewed in a diff and corrected in one place; typed
// into a web form they drift the first time someone edits them in a hurry.
//
// It also cannot be run from Claude's sandbox: api.elevenlabs.io is not on the
// egress allowlist there (the proxy answers 403 to CONNECT). Run it on the Mac.
//
//   ELEVENLABS_API_KEY=sk_... node scripts/make-callcenter-agent.mjs
//   ELEVENLABS_API_KEY=sk_... node scripts/make-callcenter-agent.mjs --voices
//   ELEVENLABS_API_KEY=sk_... VOICE_ID=xxxx node scripts/make-callcenter-agent.mjs
//
// --voices lists the workspace's voices so you can pick a young Khaleeji one
// and pass it back as VOICE_ID. Re-running with the same name UPDATES the
// existing agent rather than creating a second one — two agents answering the
// same number with slightly different rules is the failure this avoids.

const KEY = process.env.ELEVENLABS_API_KEY ?? ''
if (!KEY) {
  console.error('Set ELEVENLABS_API_KEY (elevenlabs.io -> profile -> API key).')
  process.exit(1)
}

const API = 'https://api.elevenlabs.io/v1'
const NAME = 'Sporta Call Center — سبورتا'

const call = async (path, init = {}) => {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const body = await res.text()
  let json = null
  try { json = JSON.parse(body) } catch { /* an error page, not JSON */ }
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}\n${body.slice(0, 600)}`)
  }
  return json
}

// --------------------------------------------------------------- voice picker
if (process.argv.includes('--voices')) {
  const { voices } = await call('/voices')
  console.log('\nWorkspace voices — look for Arabic / Khaleeji, young, conversational:\n')
  for (const v of voices) {
    const l = v.labels ?? {}
    console.log(
      `  ${v.voice_id}  ${v.name.padEnd(24)}`,
      [l.language, l.accent, l.age, l.gender, l.use_case].filter(Boolean).join(' · '),
    )
  }
  console.log('\nThen: VOICE_ID=<id> node scripts/make-callcenter-agent.mjs\n')
  process.exit(0)
}

// ------------------------------------------------------------------- the brief
//
// Gulf dialect on purpose. Modern Standard Arabic on a phone call reads as a
// government recording, not as a shop — and the site is already Arabic-first
// for the same reason. English is answered in English: roughly 70% of Kuwait
// is expatriate, which is exactly why the site never forces Arabic by location.
const PROMPT = `أنت موظف خدمة عملاء في متجر "سبورتا" (Sporta) للملابس الرياضية في الكويت.

الشخصية:
- شاب كويتي، لهجة خليجية طبيعية وواضحة، ودود ومحترف — أسلوب مركز اتصالات.
- ابدأ بالترحيب، افهم طلب العميل، أعد التأكيد عليه بكلماتك، ثم اختم بالخطوة التالية.
- ردود قصيرة. هذه مكالمة صوتية، لا رسالة مكتوبة. جملة أو جملتين في كل رد.
- إذا كلّمك العميل بالإنجليزية، أكمل معه بالإنجليزية.

حقائق المتجر — لا تخالفها أبداً:
- العملة دينار كويتي (KWD)، وتُنطق بثلاث خانات عشرية (مثال: 12.500 د.ك).
- التوصيل داخل الكويت بدينار واحد (1.000 د.ك)، ويُضاف بعد الخصم ولا يشمله أي خصم.
- طرق الدفع: كي نت (KNET)، أو تي-باي (T-Pay) دفع أونلاين، أو الدفع عند الاستلام.
- الإرجاع خلال 14 يوماً من الاستلام.
- تتبّع الطلب يكون برقم الطلب — اطلبه من العميل إن سأل عن حالة طلبه.
- الموقع: www.sporta.com.kw

ممنوع منعاً باتاً:
- لا تخترع سعراً، ولا مقاساً، ولا توفّر منتج. إن لم تكن تعرف، قل إنك لا تعرف ووجّه العميل للموقع.
- لا تعد بموعد توصيل محدد بالساعة.
- لا تؤكد استرجاع مبلغ ولا تعالج أي شكوى دفع بنفسك.

حوّل إلى موظف بشري (cs@sporta.com.kw) فوراً في هذه الحالات:
- العميل يقول إنه دُفع من حسابه والطلب يظهر غير مدفوع.
- أي طلب استرجاع مبلغ.
- شكوى أو عميل غاضب.
- أي شيء لا تعرف إجابته بثقة.`

const FIRST = 'هلا والله! معاك سبورتا. شلون أقدر أساعدك اليوم؟'

// --------------------------------------------------------------------- create
// Search first. Running this twice must not leave two agents answering the same
// number with two copies of the rules, silently diverging from then on.
const existing = await call(`/convai/agents?search=${encodeURIComponent('Sporta Call Center')}&page_size=100`)
const found = (existing.agents ?? []).find((a) => a.name === NAME)

const conversation_config = {
  agent: {
    prompt: {
      prompt: PROMPT,
      // Voice work is latency work. Flash is the fastest model and it accepts a
      // fixed language code, which matters here: auto-detection on a short
      // Arabic greeting can guess wrong and answer the first turn in the wrong
      // language, which is the one turn a caller judges the whole call on.
      llm: 'gemini-2.0-flash',
      temperature: 0.4,
    },
    first_message: FIRST,
    language: 'ar',
  },
  tts: {
    ...(process.env.VOICE_ID ? { voice_id: process.env.VOICE_ID } : {}),
    model_id: 'eleven_flash_v2_5',
  },
  turn: {
    // A call-centre agent that talks over the caller is worse than a slow one.
    turn_timeout: 8,
  },
}

const payload = { name: NAME, conversation_config, tags: ['sporta', 'call-center', 'kuwait'] }

const agent = found
  ? await call(`/convai/agents/${found.agent_id}`, { method: 'PATCH', body: JSON.stringify(payload) })
  : await call('/convai/agents/create', { method: 'POST', body: JSON.stringify(payload) })

const id = agent.agent_id ?? found?.agent_id
console.log(`\n${found ? 'Updated' : 'Created'}: ${NAME}`)
console.log(`agent_id: ${id}`)
console.log(`test it:  https://elevenlabs.io/app/conversational-ai/agents/${id}\n`)

if (!process.env.VOICE_ID) {
  console.log('No VOICE_ID given — it is using the workspace default voice.')
  console.log('Run with --voices to pick a young Khaleeji one, then re-run with VOICE_ID=<id>.\n')
}
console.log('Still dashboard-only: attaching a phone number (Twilio/SIP).')
console.log('Until then the agent answers only in the web widget above.\n')
