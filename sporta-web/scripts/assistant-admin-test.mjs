// /backends -> "Sporta AI": the assistant's settings, end to end against the real stack (MariaDB + PHP 8, no mocks of the shop).
//
//   bash scripts/sandbox.sh                  (MariaDB with the `sporta` database, and dropin/php-store/config.php)
//   npm run test:assistant-admin             (node scripts/assistant-admin-test.mjs)
//
// THE SUITE STARTS ITS OWN PHP SERVER (127.0.0.1:8191, or ASSISTANT_ADMIN_PORT) on dropin/php-store with
// SPORTA_API_CONFIG_FILE pointing at a scratch config that `require`s the sandbox's config.php and adds the assistant keys
// a live config may carry: a "config" API key, model, late hours, hand-off number and e-mail, and ai_url / n8n_webhook
// aimed at a FAKE model + webhook server this script runs (127.0.0.1:8192). Every model request it receives is recorded,
// headers included, so the suite can say WHICH key and WHICH model the server used without the key ever being returned
// by any route. Nothing leaves this machine.
//
// WHAT IS ASSERTED
//   1 auth      every route needs the session (401), the X-Sporta-Admin header (400), a JSON body for a write (403) and
//               refuses a cross-site write (403)
//   2 defaults  nothing saved: the screen reads the config's values as "server", the public assistant answers exactly as
//               the config alone makes it (config key and model reach the model, config phone in the contact line)
//   3 save      a full save round-trips (normalised phone, trimmed text) and is what GET answers; a partial save keeps the
//               other fields
//   4 refuse    each bad value is refused with its own code and stores nothing (long / HTML / link / price welcome, bad
//               model, hours 0 / 721 / 1.5 / "abc", bad phone, bad e-mail, bad key, key + clear, a list body)
//   5 key       the key is write-only: no response of any route, admin or public, the activity log or the PHP server's own
//               log carries it; GET says only ai_key_set; it is the key the model receives; clear falls back to the config
//               key; "AI phrasing off" stops the model whatever key is in force
//   6 override  every saved value beats the config (welcome both languages, model, phone, e-mail, late hours) and an emptied
//               field falls back to it again
//   7 off       off: one 200 line with the hand-off contact, no model call, no hand-off, no search; on again: normal
//   8 test      the Test button: answered (source shop+ai), refused by the guard, http 401, off (no key), never the key,
//               no hand-off, throttled
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STORE = join(ROOT, 'dropin/php-store')
const PORT = Number(process.env.ASSISTANT_ADMIN_PORT ?? 8191)
const FAKE = PORT + 1
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } return !!ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(join(STORE, 'config.php'))) { console.log('FAIL dropin/php-store/config.php is missing. Start the sandbox: bash scripts/sandbox.sh'); process.exit(1) }
const sql = (q) => run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', q]).then((r) => r.stdout.trim())
try { await sql('select 1') } catch (e) { console.log('FAIL MariaDB (database sporta) is not answering. Start the sandbox: bash scripts/sandbox.sh'); process.exit(1) }

// ------------------------------------------------------------- fake model + webhook
const CONFIG_KEY = 'sk-ant-config-0000000000000000000000CONFIG'
const ADMIN_KEY = 'sk-ant-api03-ADMINadmin1234567890_-ADMINkeyXYZ'
const ADMIN_KEY2 = 'sk-ant-api03-SECONDsecond0987654321-SECONDkey'
const fake = { model: [], hook: [], mode: 'reword' }
const server = http.createServer((q, r) => {
  let raw = ''
  q.on('data', (c) => { raw += c })
  q.on('end', () => {
    let body = null
    try { body = JSON.parse(raw) } catch { /* recorded as null */ }
    if (q.url.startsWith('/hook')) { fake.hook.push(body); r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{}') }
    fake.model.push({ key: q.headers['x-api-key'], body })
    if (fake.mode === 'unauthorised') { r.writeHead(401, { 'content-type': 'application/json' }); return r.end('{"type":"error","error":{"type":"authentication_error"}}') }
    // The shop's answer is in the system prompt after "SHOP ANSWER:". A rewording the guard accepts: a short "Hi! " in front
    // (no number, same conditions, under 1.3x). 'liar' adds a phone number the shop never said, which the guard must refuse.
    const sys = String(body?.system ?? '')
    const shop = (sys.split('SHOP ANSWER:\n')[1] ?? '').split('\n\nDATA')[0]
    const text = fake.mode === 'liar' ? shop + ' Call 99998888.' : (/[؀-ۿ]/.test(shop) ? 'هلا! ' : 'Hi! ') + shop
    r.writeHead(200, { 'content-type': 'application/json' })
    r.end(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }))
  })
})
await new Promise((res) => server.listen(FAKE, '127.0.0.1', res))

// ------------------------------------------------------------- the PHP server under test
const tmp = mkdtempSync(join(tmpdir(), 'sporta-assistant-admin-'))
const CONF = join(tmp, 'config.php')
writeFileSync(CONF, `<?php
$c = require ${JSON.stringify(join(STORE, 'config.php'))};
$c['ai_key'] = ${JSON.stringify(CONFIG_KEY)};
$c['ai_url'] = 'http://127.0.0.1:${FAKE}/v1/messages';
$c['ai_model'] = 'claude-config-model';
$c['assistant_late_hours'] = 30;
$c['shop_phone'] = '+965 11112222';
$c['shop_email'] = 'config@sporta.test';
$c['n8n_webhook'] = 'http://127.0.0.1:${FAKE}/hook';
$c['n8n_secret'] = 'assistant-admin-test-secret';
unset($c['tts_key'], $c['tts_voice_id']);
return $c;
`)
const PHPLOG = join(tmp, 'php.log')
const php = spawn('php', ['-d', 'log_errors=1', '-d', `error_log=${PHPLOG}`, '-S', `127.0.0.1:${PORT}`, '-t', STORE], {
  env: { ...process.env, SPORTA_API_CONFIG_FILE: CONF }, stdio: ['ignore', 'pipe', 'pipe'],
})
let phpOut = ''
php.stdout.on('data', (d) => { phpOut += d }); php.stderr.on('data', (d) => { phpOut += d })
const stop = () => { try { php.kill() } catch { /* gone */ } server.close() }
process.on('exit', stop)
for (let i = 0; i < 50; i++) { try { await fetch(`${BASE}/api.php?r=products`); break } catch { await sleep(100) } }

const reset = () => sql("delete from settings where name in ('assistant_config','assistant_secret'); delete from rate_limit; update admin_users set failed_attempts = 0, locked_until = null")
await reset()

const seen = []          // every response body, to search for the key
let cookie = ''
const call = async (file, route, { body, method, headers = {}, raw, jar = true } = {}) => {
  const res = await fetch(`${BASE}/${file}.php?r=${route}`, {
    method: method ?? (body !== undefined || raw !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(file === 'admin' ? { 'X-Sporta-Admin': '1' } : {}), ...(jar && cookie ? { Cookie: cookie } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })
  const set = res.headers.get('set-cookie')
  if (set && jar) cookie = set.split(';')[0]
  const text = await res.text()
  seen.push(text)
  let j = null
  try { j = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, body: j, text }
}
const admin = (route, body, opts = {}) => call('admin', route, { body, ...opts })
const ask = (message, lang = 'en') => call('api', 'assistant', { body: { message, lang }, jar: false })
const signIn = async () => {
  const r = await admin('login', { email: 'qa-admin@sporta.test', password: 'correct-horse-battery-kw' })
  if (r.status !== 200) { console.log(`FAIL the test admin could not sign in (${r.status} ${r.body?.error})`); stop(); process.exit(1) }
}
const FULL = {
  enabled: true, ai_enabled: true,
  welcome_ar: '  هلا والله في سبورتا! اسألني عن طلبك أو التوصيل أو الإرجاع أو المقاسات، وأنا أساعدك.  ',
  welcome_en: '  Hello from Sporta! Ask me about your order, delivery, returns or sizes and I will help.  ',
  ai_model: 'claude-admin-model-1', late_hours: '72', handoff_phone: '٥٠٠٠ ١٢٣٤', handoff_email: 'help@sporta.test',
}

try {
  // ------------------------------------------------------------------ 1
  head('1 auth and CSRF')
  {
    const anon = await call('admin', 'assistant_settings', { jar: false })
    is(anon.status === 401 && anon.body?.error === 'not_signed_in', 'GET assistant_settings without a session: 401', `${anon.status} ${anon.text}`)
    const anonSave = await call('admin', 'assistant_settings_save', { body: { enabled: false }, jar: false })
    is(anonSave.status === 401, 'POST assistant_settings_save without a session: 401', `${anonSave.status}`)
    const anonTest = await call('admin', 'assistant_test', { body: { lang: 'en' }, jar: false })
    is(anonTest.status === 401, 'POST assistant_test without a session: 401', `${anonTest.status}`)
    await signIn()
    const noHeader = await fetch(`${BASE}/admin.php?r=assistant_settings_save`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{"enabled":false}' })
    is(noHeader.status === 400, 'a signed-in save without X-Sporta-Admin: 400', `${noHeader.status}`)
    const plain = await admin('assistant_settings_save', undefined, { raw: '{"enabled":false}', headers: { 'Content-Type': 'text/plain' } })
    is(plain.status === 403, 'a save with a text/plain body (a CORS "simple request"): 403', `${plain.status}`)
    const cross = await admin('assistant_settings_save', { enabled: false }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    is(cross.status === 403, 'a save the browser marks cross-site: 403', `${cross.status}`)
    const crossTest = await admin('assistant_test', { lang: 'en' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    is(crossTest.status === 403, 'a Test the browser marks cross-site: 403', `${crossTest.status}`)
    is(await sql("select count(*) from settings where name in ('assistant_config','assistant_secret')") === '0', 'none of the refused writes stored anything')
  }

  // ------------------------------------------------------------------ 2
  head('2 nothing saved: the config decides, as before')
  {
    const g = await admin('assistant_settings')
    const b = g.body ?? {}
    is(g.status === 200 && b.enabled === true && b.ai_enabled === true && b.welcome_ar === '' && b.welcome_en === '' && b.ai_model === ''
       && b.late_hours === 0 && b.handoff_phone === '' && b.handoff_email === '' && b.ai_key_set === false, 'GET answers empty fields (= use the server value) and no key saved', g.text)
    is(b.server?.ai_key_set === true && b.server?.ai_model === 'claude-config-model' && b.server?.late_hours === 30 && b.server?.handoff_phone === '+965 11112222'
       && b.server?.handoff_email === 'config@sporta.test' && /^Welcome to Sporta\./.test(b.server?.welcome_en ?? '') && /سبورتا/.test(b.server?.welcome_ar ?? ''),
       'the "server" block shows what each empty field falls back to (config values, the shop\'s own welcome)', JSON.stringify(b.server))
    is(b.ai_active === true && !('ai_key' in b) && !JSON.stringify(b.server).includes('sk-'), 'the config key is reported only as set (ai_active, server.ai_key_set)')
    fake.model.length = 0
    const hi = await ask('hello')
    is(hi.status === 200 && hi.body?.intent === 'greeting' && hi.body?.source === 'shop+ai' && /^Hi! Welcome to Sporta\./.test(hi.body?.reply ?? ''), 'the public assistant rewords the shop\'s own welcome through the model', hi.text)
    is(fake.model.length === 1 && fake.model[0].key === CONFIG_KEY && fake.model[0].body?.model === 'claude-config-model', 'the model received the CONFIG key and the CONFIG model', JSON.stringify(fake.model.map((m) => [m.key === CONFIG_KEY, m.body?.model])))
    const contact = await ask('how can I contact you')
    is(contact.body?.intent === 'contact' && contact.body.reply.includes('+965 11112222') && contact.body.reply.includes('config@sporta.test'), 'the contact line gives the config number and e-mail', contact.body?.reply)
  }

  // ------------------------------------------------------------------ 3
  head('3 save and read back')
  {
    const s = await admin('assistant_settings_save', FULL)
    const b = s.body ?? {}
    is(s.status === 200 && b.welcome_ar === FULL.welcome_ar.trim() && b.welcome_en === FULL.welcome_en.trim() && b.ai_model === 'claude-admin-model-1'
       && b.late_hours === 72 && b.handoff_phone === '+965 50001234' && b.handoff_email === 'help@sporta.test' && b.enabled === true && b.ai_enabled === true,
       'a full save answers the stored values: text trimmed, hours a number, the phone normalised from Arabic digits to "+965 50001234"', s.text)
    const g = await admin('assistant_settings')
    is(JSON.stringify({ ...g.body }) === JSON.stringify({ ...b }), 'GET answers exactly what the save answered')
    const p = await admin('assistant_settings_save', { late_hours: 96 })
    is(p.status === 200 && p.body?.late_hours === 96 && p.body?.welcome_en === FULL.welcome_en.trim() && p.body?.handoff_phone === '+965 50001234',
       'a partial save changes that field and keeps every other', p.text)
    for (const [input, want] of [['+965 2209-1914', '+965 22091914'], ['0096522091914', '+965 22091914'], ['96522091914', '+965 22091914'],
      ['+44 20 7946 0958', '+442079460958'], ['', '']]) {
      const r = await admin('assistant_settings_save', { handoff_phone: input })
      is(r.status === 200 && r.body?.handoff_phone === want, `phone ${JSON.stringify(input)} is stored as ${JSON.stringify(want)}`, r.text)
    }
    await admin('assistant_settings_save', { handoff_phone: FULL.handoff_phone })
  }

  // ------------------------------------------------------------------ 4
  head('4 validation refusals')
  {
    const before = await sql("select value from settings where name = 'assistant_config'")
    const cases = [
      [{ welcome_en: 'x'.repeat(301) }, 'too_long_assistant_welcome_en'],
      [{ welcome_ar: 'ا'.repeat(301) }, 'too_long_assistant_welcome_ar'],
      [{ welcome_en: 'Hi <b>there</b>' }, 'html_in_assistant_welcome_en'],
      [{ welcome_ar: 'أهلًا <script>alert(1)</script>' }, 'html_in_assistant_welcome_ar'],
      [{ welcome_en: 'Hi, see https://evil.example/login' }, 'link_in_assistant_welcome_en'],
      [{ welcome_en: 'Hi, visit www.evil.test now' }, 'link_in_assistant_welcome_en'],
      [{ welcome_en: 'Hi, go to sporta-sale.com today' }, 'link_in_assistant_welcome_en'],
      [{ welcome_en: 'Everything is 5 KWD today' }, 'price_in_assistant_welcome_en'],
      [{ welcome_ar: 'كل شي بـ ٥ د.ك' }, 'price_in_assistant_welcome_ar'],
      [{ welcome_en: ['a'] }, 'invalid_assistant_welcome_en'],
      [{ ai_model: 'Claude Haiku' }, 'invalid_assistant_ai_model'],
      [{ ai_model: 'claude/../../x' }, 'invalid_assistant_ai_model'],
      [{ ai_model: 'x'.repeat(65) }, 'invalid_assistant_ai_model'],
      [{ ai_model: 7 }, 'invalid_assistant_ai_model'],
      [{ late_hours: 721 }, 'invalid_assistant_late_hours'],
      [{ late_hours: -1 }, 'invalid_assistant_late_hours'],
      [{ late_hours: 1.5 }, 'invalid_assistant_late_hours'],
      [{ late_hours: 'abc' }, 'invalid_assistant_late_hours'],
      [{ late_hours: true }, 'invalid_assistant_late_hours'],
      [{ handoff_phone: '12' }, 'invalid_assistant_handoff_phone'],
      [{ handoff_phone: 'call me' }, 'invalid_assistant_handoff_phone'],
      [{ handoff_phone: '+965 2209 1914 ext 5' }, 'invalid_assistant_handoff_phone'],
      [{ handoff_phone: '1234567890123456' }, 'invalid_assistant_handoff_phone'],
      [{ handoff_email: 'not-an-address' }, 'invalid_assistant_handoff_email'],
      [{ handoff_email: 'a@b.test?bcc=x@y.test' }, 'invalid_assistant_handoff_email'],
      [{ enabled: 'yes' }, 'invalid_assistant_enabled'],
      [{ ai_enabled: 2 }, 'invalid_assistant_ai_enabled'],
      [{ ai_key: 'short' }, 'invalid_ai_key'],
      [{ ai_key: 'sk-ant has spaces in it 1234567890' }, 'invalid_ai_key'],
      [{ ai_key: 'x'.repeat(257) }, 'invalid_ai_key'],
      [{ ai_key: 12345678901234567890 }, 'invalid_ai_key'],
      [{ ai_key: ADMIN_KEY, ai_key_clear: true }, 'ai_key_conflict'],
      [{ ai_key_clear: 'maybe' }, 'invalid_assistant_ai_key_clear'],
      [['enabled', false], 'invalid_assistant_settings'],
    ]
    for (const [body, code] of cases) {
      const r = await admin('assistant_settings_save', body)
      is(r.status === 400 && r.body?.error === code, `refused: ${JSON.stringify(body).slice(0, 70)} -> ${code}`, `${r.status} ${r.text}`)
    }
    is(await sql("select value from settings where name = 'assistant_config'") === before && await sql("select count(*) from settings where name = 'assistant_secret'") === '0',
       'nothing a refused save carried was stored (settings and key unchanged)')
    const badKey = seen.slice(-cases.length).join('\n')
    is(!badKey.includes('sk-ant has spaces') && !badKey.includes(ADMIN_KEY), 'a refusal never repeats the key it was sent')
    const big = await admin('assistant_settings_save', undefined, { raw: JSON.stringify({ welcome_en: 'x'.repeat(17000) }) })
    is(big.status === 413, 'a body over 16 KB: 413', `${big.status}`)
  }

  // ------------------------------------------------------------------ 5
  head('5 the API key is write-only')
  {
    const s = await admin('assistant_settings_save', { ai_key: '  ' + ADMIN_KEY + '  ' })
    is(s.status === 200 && s.body?.ai_key_set === true && !s.text.includes(ADMIN_KEY), 'saving a key answers ai_key_set: true, without the key', s.text)
    is(JSON.parse(await sql("select value from settings where name = 'assistant_secret'")).ai_key === ADMIN_KEY, 'it is stored (trimmed) in its own row, settings.assistant_secret')
    const g = await admin('assistant_settings')
    is(g.body?.ai_key_set === true && !g.text.includes(ADMIN_KEY) && !Object.keys(g.body).some((k) => /key$/.test(k) && k !== 'ai_key_set'), 'GET says only ai_key_set')
    fake.model.length = 0
    const hi = await ask('hello')
    is(fake.model.length === 1 && fake.model[0].key === ADMIN_KEY && fake.model[0].body?.model === 'claude-admin-model-1', 'the model receives the ADMIN key and the ADMIN model (both beat the config)',
       JSON.stringify(fake.model.map((m) => [m.key === ADMIN_KEY ? 'admin' : m.key === CONFIG_KEY ? 'config' : 'other', m.body?.model])))
    is(hi.body?.source === 'shop+ai' && !hi.text.includes(ADMIN_KEY), 'the public answer is reworded and carries no key')
    const keep = await admin('assistant_settings_save', { welcome_en: FULL.welcome_en, ai_key: '' })
    is(keep.body?.ai_key_set === true && JSON.parse(await sql("select value from settings where name = 'assistant_secret'")).ai_key === ADMIN_KEY, 'a save with an empty key keeps the saved key')
    await admin('assistant_settings_save', { ai_key: ADMIN_KEY2 })
    fake.model.length = 0; await ask('hello')
    is(fake.model[0]?.key === ADMIN_KEY2, 'a new key replaces the old one')
    const clr = await admin('assistant_settings_save', { ai_key_clear: true })
    is(clr.status === 200 && clr.body?.ai_key_set === false && clr.body?.ai_active === true, 'clear: ai_key_set false, and the config key still makes the model active', clr.text)
    fake.model.length = 0; await ask('hello')
    is(fake.model[0]?.key === CONFIG_KEY, 'after clear the model receives the CONFIG key again (fallback)')
    await admin('assistant_settings_save', { ai_key: ADMIN_KEY, ai_enabled: false })
    fake.model.length = 0
    const plainHi = await ask('hello')
    const v = await admin('assistant_settings')
    is(fake.model.length === 0 && plainHi.body?.source === 'shop' && v.body?.ai_active === false && v.body?.ai_key_set === true,
       '"AI phrasing" off: no model call with a key saved AND a key in the config; the key stays saved', `${fake.model.length} ${plainHi.text}`)
    await admin('assistant_settings_save', { ai_enabled: true })
    const log = await sql("select action_key from admin_activity_log order by id desc limit 20")
    is(log.split('\n').includes('assistant_settings_save') && !log.includes('sk-'), 'the save is in the activity log by name, without a value')
    const all = seen.join('\n') + '\n' + (existsSync(PHPLOG) ? readFileSync(PHPLOG, 'utf8') : '') + '\n' + phpOut
    is(!all.includes(ADMIN_KEY) && !all.includes(ADMIN_KEY2) && !all.includes(CONFIG_KEY), `no response of this whole run (${seen.length} so far) and no server log line carries a key`)
  }

  // ------------------------------------------------------------------ 6
  head('6 admin value beats config, empty falls back')
  {
    await admin('assistant_settings_save', FULL)
    const off = { ai_enabled: false }
    await admin('assistant_settings_save', off)
    const en = await ask('hello', 'en'), ar = await ask('مرحبا', 'ar')
    is(en.body?.reply === FULL.welcome_en.trim() && ar.body?.reply === FULL.welcome_ar.trim(), 'a hello is answered with the saved welcome, in each language', `${en.body?.reply} | ${ar.body?.reply}`)
    const c = await ask('how can I contact you', 'ar')
    is(c.body?.reply.includes('‎+965 50001234') && c.body.reply.includes('help@sporta.test') && !c.body.reply.includes('11112222'), 'the hand-off number and e-mail are the saved ones (Arabic, with the left-to-right mark)', c.body?.reply)
    const ret = await ask('can I return it', 'en')
    is(ret.body?.reply.includes('+965 50001234'), 'every sentence that gives the number gives the saved one (returns)', ret.body?.reply)
    // late hours: what assistant_order reads, through the same effective config the route uses
    const eff = async () => JSON.parse((await run('php', ['-r', `require ${JSON.stringify(join(STORE, 'store.php'))}; require ${JSON.stringify(join(STORE, 'assistant.php'))};
      $c = assistant_effective_config(store_db(), store_config());
      echo json_encode(['late' => $c['assistant_late_hours'] ?? null, 'model' => $c['ai_model'] ?? null, 'phone' => $c['shop_phone'] ?? null, 'email' => $c['shop_email'] ?? null, 'on' => $c['assistant_enabled'] ?? null]);`],
      { env: { ...process.env, SPORTA_API_CONFIG_FILE: CONF } })).stdout)
    const e1 = await eff()
    is(e1.late === 72 && e1.model === 'claude-admin-model-1' && e1.phone === '+965 50001234' && e1.email === 'help@sporta.test' && e1.on === true,
       'the effective config carries the saved late hours (72 over the config\'s 30), model, phone, e-mail', JSON.stringify(e1))
    await admin('assistant_settings_save', { welcome_en: '', welcome_ar: '', ai_model: '', late_hours: '', handoff_phone: '', handoff_email: '' })
    const e2 = await eff()
    is(e2.late === 30 && e2.model === 'claude-config-model' && e2.phone === '+965 11112222' && e2.email === 'config@sporta.test',
       'emptied fields fall back to the config again (30 h, config model, phone, e-mail)', JSON.stringify(e2))
    const back = await ask('hello', 'en')
    is(/^Welcome to Sporta\./.test(back.body?.reply ?? ''), 'and an emptied welcome is the shop\'s own sentence again', back.body?.reply)
    // a row edited by hand into nonsense degrades to the config, never to an error
    await sql(`update settings set value = '{"enabled":"x","welcome_en":"<i>hi</i>","ai_model":"BAD MODEL","late_hours":99999,"handoff_phone":"nope","handoff_email":"x"}' where name = 'assistant_config'`)
    await sql(`update settings set value = '{"ai_key":"bad key"}' where name = 'assistant_secret'`)
    const e3 = await eff()
    const hand = await ask('hello', 'en')
    is(e3.late === 30 && e3.model === 'claude-config-model' && e3.phone === '+965 11112222' && e3.on === true && hand.status === 200 && /Welcome to Sporta\./.test(hand.body?.reply ?? ''),
       'a row edited by hand into nonsense: every bad field falls back to the config, the assistant still answers', `${JSON.stringify(e3)} ${hand.text}`)
    await reset()
    const e4 = await eff()
    is(e4.late === 30 && e4.model === 'claude-config-model' && e4.on === null, 'no rows at all: the config exactly (assistant_enabled not even set)', JSON.stringify(e4))
    fake.mode = 'reword'
  }

  // ------------------------------------------------------------------ 7
  head('7 the off switch')
  {
    await signIn()
    await admin('assistant_settings_save', { ...FULL, enabled: false })
    await sql('delete from rate_limit')
    fake.model.length = 0; fake.hook.length = 0
    const q = [['hello', 'en'], ['I want to talk to a person', 'en'], ['do you have nike shoes', 'en'], ['وين طلبي SP12345678', 'ar'], ['ابي الغي طلبي', 'ar']]
    const answers = []
    for (const [m, l] of q) answers.push(await ask(m, l))
    is(answers.every((a) => a.status === 200 && a.body?.off === true && a.body?.intent === 'contact' && a.body?.data === null && a.body?.source === 'shop'),
       'off: every question gets 200, intent contact, off: true, no data (the compiled widget still renders it)', answers.map((a) => a.status + ' ' + a.body?.intent).join(', '))
    is(answers[0].body.reply === 'The assistant is switched off right now. We are happy to help on WhatsApp or by phone at +965 50001234, or by email at help@sporta.test',
       'the English line says it is off and gives the saved number and e-mail', answers[0].body.reply)
    is(answers[3].body.reply.startsWith('المساعد متوقف حاليًا.') && answers[3].body.reply.includes('‎+965 50001234') && answers[3].body.reply.includes('help@sporta.test'), 'and the Arabic one', answers[3].body.reply)
    await sleep(300)
    is(fake.model.length === 0 && fake.hook.length === 0, 'off: no model call and no hand-off (not even for "a person" or a cancel)', `${fake.model.length} model, ${fake.hook.length} hook`)
    is(answers.every((a) => !('speak' in a.body)), 'off: nothing is signed for speech')
    const v = await admin('assistant_settings')
    is(v.body?.enabled === false, 'GET says enabled: false')
    await admin('assistant_settings_save', { enabled: true })
    fake.hook.length = 0
    const person = await ask('I want to talk to a person', 'en')
    await sleep(300)
    is(person.body?.intent === 'contact' && !person.body?.off && fake.hook.length === 1, 'on again: the normal answer, and a person request is handed off once more', `${person.text} hooks=${fake.hook.length}`)
  }

  // ------------------------------------------------------------------ 8
  head('8 the Test button')
  {
    await sql('delete from rate_limit')
    await admin('assistant_settings_save', { ...FULL, ai_key: ADMIN_KEY })
    fake.mode = 'reword'; fake.model.length = 0; fake.hook.length = 0
    const t = await admin('assistant_test', { lang: 'en' })
    const b = t.body ?? {}
    is(t.status === 200 && b.ai?.status === 'answered' && b.ai?.http === 200 && b.source === 'shop+ai' && b.question === 'hello'
       && b.shop_reply === FULL.welcome_en.trim() && b.reply === 'Hi! ' + FULL.welcome_en.trim() && b.ai?.model === 'claude-admin-model-1' && typeof b.ai?.ms === 'number',
       'answered: the shop\'s line, the model\'s rewording, the model name, the time', t.text)
    is(fake.model.length === 1 && fake.model[0].key === ADMIN_KEY && !t.text.includes(ADMIN_KEY), 'one model call with the saved key; the key is not in the answer')
    const ta = await admin('assistant_test', { lang: 'ar' })
    is(ta.body?.question === 'مرحبا' && ta.body?.ai?.status === 'answered' && ta.body?.reply.startsWith('هلا! '), 'Arabic: the sample is «مرحبا» and the Arabic welcome is reworded', ta.text)
    fake.mode = 'liar'
    const tl = await admin('assistant_test', { lang: 'en' })
    is(tl.body?.ai?.status === 'refused' && tl.body?.source === 'shop' && tl.body?.reply === FULL.welcome_en.trim(), 'a model answer that adds a number: refused by the guard, the shop\'s line stands', tl.text)
    fake.mode = 'unauthorised'
    await sql('delete from rate_limit')
    const tu = await admin('assistant_test', { lang: 'en' })
    is(tu.body?.ai?.status === 'http_error' && tu.body?.ai?.http === 401 && !/authentication_error/.test(tu.text), 'a key the API refuses: http_error 401, and nothing of the API\'s own answer', tu.text)
    fake.mode = 'reword'
    await admin('assistant_settings_save', { ai_enabled: false })
    fake.model.length = 0
    const to = await admin('assistant_test', { lang: 'en' })
    is(to.body?.ai?.status === 'off' && fake.model.length === 0 && to.body?.source === 'shop', 'AI phrasing off: status off, no model call', to.text)
    await admin('assistant_settings_save', { ai_enabled: true, enabled: false })
    const toff = await admin('assistant_test', { lang: 'en' })
    is(toff.body?.enabled === false && toff.body?.ai?.status === 'answered' && /switched off/.test(toff.body?.off_reply ?? ''),
       'with the assistant off the Test still checks the model, and shows the line shoppers get', toff.text)
    is(fake.hook.length === 0, 'no Test ever hands off to a person')
    let limited = null
    for (let i = 0; i < 8 && !limited; i++) { const r = await admin('assistant_test', { lang: 'en' }); if (r.status === 429) limited = r }
    is(limited !== null, 'the Test is throttled (a few presses a minute: each one can be a paid call)')
    const all = seen.join('\n') + '\n' + (existsSync(PHPLOG) ? readFileSync(PHPLOG, 'utf8') : '') + '\n' + phpOut
    is(!all.includes(ADMIN_KEY) && !all.includes(ADMIN_KEY2) && !all.includes(CONFIG_KEY), `the key is in none of the ${seen.length} responses of the run, nor in a server log`)
  }
} catch (e) {
  fail++
  console.log('FAIL the suite crashed: ' + (e?.stack || e))
} finally {
  await reset()
  stop()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
