// READ-ONLY health probe of the live Sporta AI (run ON the VPS in node:24-alpine; /docker/sporta and /var/log mounted read-only).
// GET only against the site; it never POSTs a question (CLAUDE.md probing rules). Reports:
//   1. which assistant.php / api.php / cron-voice.php are live (sha256 against the repo baseline and HEAD, passed in env);
//   2. what the live storefront bundle does with the assistant (does it call ?r=assistant, is there a widget);
//   3. the voice route's answer to a deliberately unsigned request (no_voice = speech off, bad signature = speech on);
//   4. the last voice / assistant lines of the host cron log and the payment-log directory listing (names only).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
const B = 'https://www.sporta.com.kw'
const say = (s) => console.log(s)
const sha = (p) => existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16) : 'missing'
const EXPECT = JSON.parse(process.env.AI_EXPECT || '{}')
say('== 1 live files')
for (const f of ['api/assistant.php', 'api/api.php', 'api/cron-voice.php', 'api/store.php']) {
  const h = sha('/sporta/site/' + f)
  const e = EXPECT[f] || {}
  say(`${f} ${h} ${h === e.base ? '= baseline dcd2b28b' : h === e.head ? '= repo HEAD' : '!= baseline, != HEAD'}`)
}
say('== 2 storefront bundle')
const home = await (await fetch(B + '/')).text()
const assets = [...home.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
say('entry scripts: ' + assets.join(' '))
const seen = new Set(), queue = [...assets], hits = []
while (queue.length && seen.size < 60) {
  const a = queue.shift(); if (seen.has(a)) continue; seen.add(a)
  const js = await (await fetch(B + a)).text().catch(() => '')
  for (const m of js.matchAll(/["'`](\.?\/?assets\/[A-Za-z0-9_.-]+\.js|\.\/[A-Za-z0-9_.-]+\.js)["'`]/g)) {
    const p = m[1].startsWith('./') ? '/assets/' + m[1].slice(2) : m[1].startsWith('/') ? m[1] : '/' + m[1]
    if (!seen.has(p)) queue.push(p)
  }
  if (/r=assistant|assistant/.test(js)) {
    const idx = js.search(/r=assistant/)
    hits.push(`${a} ${js.length}B assistant-mentions=${(js.match(/assistant/g) || []).length}` + (idx >= 0 ? ` ctx="${js.slice(Math.max(0, idx - 80), idx + 80).replace(/\s+/g, ' ')}"` : ''))
  }
}
say(`chunks scanned ${seen.size}; with "assistant": ${hits.length}`)
for (const h of hits.slice(0, 8)) say('  ' + h.slice(0, 400))
say('== 3 assistant routes (GET only)')
for (const p of ['/api/api.php?r=assistant', '/api/api.php?r=say&t=x&l=ar&v=0']) {
  const r = await fetch(B + p)
  say(`${p} -> ${r.status} ${(await r.text()).slice(0, 160).replace(/\s+/g, ' ')}`)
}
say('== 4 host logs (read-only)')
try {
  const lines = readFileSync('/hostlog/sporta-cron.log', 'utf8').split('\n')
  const v = lines.filter((l) => /voice|assistant|tts|eleven/i.test(l))
  say(`sporta-cron.log ${lines.length} lines, voice/assistant ${v.length}; last:`)
  for (const l of v.slice(-12)) say('  ' + l.slice(0, 220))
  say('last 5 lines of the log:'); for (const l of lines.filter(Boolean).slice(-5)) say('  ' + l.slice(0, 220))
} catch (e) { say('cron log: ' + e.message) }
try {
  const d = '/sporta/private/voice'
  for (const n of readdirSync(d)) { const s = statSync(d + '/' + n); say(`voice/${n} ${s.isDirectory() ? 'dir ' + readdirSync(d + '/' + n).length + ' entries' : s.size + 'B'} ${s.mtime.toISOString()}`) }
} catch (e) { say('voice dir: ' + e.message) }
say('== 5 assistant config keys (verdicts only, never a value)')
try {
  const files = readdirSync('/sporta/private').filter((n) => /config.*\.php$/.test(n))
  for (const n of files) {
    const t = readFileSync('/sporta/private/' + n, 'utf8')
    const v = (k) => { const m = t.match(new RegExp("['\"]" + k + "['\"]\\s*=>\\s*(['\"])(.*?)\\1")); return !m ? (new RegExp("['\"]" + k + "['\"]").test(t) ? 'present(non-string)' : 'absent') : m[2].trim() === '' ? 'EMPTY' : 'set(' + m[2].length + ' chars)' }
    say(`${n}: ` + ['assistant_enabled', 'ai_enabled', 'ai_key', 'anthropic_key', 'anthropic_api_key', 'ai_model', 'tts_key', 'tts_voice_id', 'cron_key'].map((k) => k + '=' + v(k)).join(' '))
  }
} catch (e) { say('config: ' + e.message) }
say('AI_PROBE_DONE')
