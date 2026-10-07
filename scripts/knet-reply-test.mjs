#!/usr/bin/env node
/**
 * KNET manual K-064 v1.5 (sections 5 and 10.2.1): the notification URL must output ONLY `REDIRECT=<url>` — no
 * HTML — and UDF1-5 must not carry '@' or '/'. Drives the real callback.php with callback_response 'line' and 'both'
 * (editing the SANDBOX knet/config.php and restoring it byte for byte), and reads pay.php's udf handling.
 */
import { readFileSync, writeFileSync } from 'node:fs'
const ROOT = new URL('../sporta-site/public_html/', import.meta.url).pathname
const CFG = ROOT + 'knet/config.php'
const SITE = process.env.SITE_BASE ?? 'http://127.0.0.1:4300'
const original = readFileSync(CFG, 'utf8')
if (!original.includes('SANDBOX')) { console.error('refusing: knet/config.php is not the sandbox one'); process.exit(2) }
let bad = 0
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ' ' + extra}`); if (!ok) bad++ }
const call = async () => { const r = await fetch(`${SITE}/knet/callback.php?trackid=NOSUCHORDER1&result=CAPTURED&amt=1.000`, { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'https' } }); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') || '' } }
const setStyle = (v) => writeFileSync(CFG, original.replace(/\n\);?\s*$/, '') .replace(/\];?\s*$/, `    'callback_response' => '${v}',\n];\n`))
try {
  setStyle('line')
  const a = await call()
  check(/^REDIRECT=https?:\/\/\S+$/.test(a.text), "'line' mode answers only REDIRECT=<url>", JSON.stringify(a.text.slice(0, 160)))
  check(!/[<>]/.test(a.text) && !a.text.includes('\n'), "'line' mode has no HTML and no second line")
  check(a.type.startsWith('text/plain'), "'line' mode is text/plain", a.type)
  setStyle('both')
  const b = await call()
  check(b.text.startsWith('REDIRECT=') && b.text.includes('<html'), "'both' keeps the old answer (REDIRECT= first, then markup)")
} finally { writeFileSync(CFG, original) }
check(readFileSync(CFG, 'utf8') === original, 'knet/config.php is back exactly as it was')
const pay = readFileSync(ROOT + 'knet/pay.php', 'utf8')
const fn = pay.match(/function knet_udf\(\$v\): string \{[^\n]*\}/)
check(!!fn && /'@', '\/'/.test(fn[0]), "knet_udf() strips '@' and '/'")
for (const n of [1, 2, 3, 4, 5]) check(pay.includes(`'udf${n}'         => knet_udf(`), `udf${n} goes through knet_udf()`)
process.exit(bad ? 1 : 0)
