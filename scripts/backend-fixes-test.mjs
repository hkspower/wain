/**
 * test:backend-fixes — the verified items from the 2026-10-14 backend scan.
 *
 *   SEC-01  the Payments save answers with whether each secret is saved, never the value
 *   N01     a plain date (YYYY-MM-DD) saves as the start of that day, and a junk date is still refused
 *
 * Run `bash scripts/sandbox.sh` first. The `knet` and `promo_bar` rows are read before and restored after.
 * MUTATE=secret puts the value back into the save response, and the SEC-01 checks must fail.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname
const PUB = ROOT + 'sporta-site/public_html'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-e', q], { encoding: 'utf8' }).replace(/\n$/, '')

let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

// MUTATE=secret: restore the leak in the save response, so the rig can show it fails.
const adminFile = PUB + '/api/admin.php'
const adminOrig = readFileSync(adminFile, 'utf8')
if (process.env.MUTATE === 'secret') {
  writeFileSync(adminFile, adminOrig.replace("$saved[$secret . '_set'] = (string) ($saved[$secret] ?? '') !== '';\n            unset($saved[$secret]);", "$saved[$secret . '_set'] = (string) ($saved[$secret] ?? '') !== '';"))
}

const knetOrig = sql("select value from settings where name = 'knet'")
const promoOrig = sql("select value from settings where name = 'promo_bar'")

let cookie = ''
const api = async (route, data) => {
  const r = await fetch(`${BASE}/api/admin.php?r=${route}`, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  const set = r.headers.get('set-cookie')
  if (set && !cookie) cookie = set.split(';')[0]
  return { status: r.status, text: await r.text() }
}

try {
  sql('delete from rate_limit; delete from rate_bucket')
  const login = await api('login', { email: 'manager@sporta.com.kw', password: 'correct horse' })
  check(login.status === 200, 'signed in to the panel', `status ${login.status}`)

  // ---- SEC-01 -----------------------------------------------------------------------------
  const secret = 'RigSecretPw7'
  const save = await api('settings_save', { name: 'knet', value: { tranportal_password: secret, cbk_client_secret: 'RigClientSecret9' } })
  check(save.status === 200, 'the Payments save is accepted', `status ${save.status}`)
  check(!save.text.includes(secret) && !save.text.includes('RigClientSecret9'),
    'the save response carries no secret value')
  const body = JSON.parse(save.text || '{}')
  check(body.tranportal_password_set === true, 'the response says the Tranportal password is saved')
  check(body.cbk_client_secret_set === true, 'the response says the CBK client secret is saved')
  check(body.tranportal_password === undefined && body.cbk_client_secret === undefined,
    'the secret keys themselves are absent from the response')

  // ---- N01 --------------------------------------------------------------------------------
  const promo = (starts) => api('settings_save', { name: 'promo_bar', value: { enabled: false, text_en: 'Rig promo', text_ar: '', href: '/shop', starts_at: starts, ends_at: null } })
  const ok = await promo('2026-10-14')
  check(ok.status === 200, 'a plain date (YYYY-MM-DD) saves', `status ${ok.status}`)
  const okBody = JSON.parse(ok.text || '{}')
  check(okBody.starts_at === '2026-10-14 00:00:00', 'the date is stored as the start of that day', `got ${okBody.starts_at}`)
  const bad = await promo('next tuesday')
  check(bad.status === 400 && /invalid_date/.test(bad.text), 'a junk date is still refused', `status ${bad.status}`)
} finally {
  // Put back exactly what was there, whatever the checks did.
  if (process.env.MUTATE === 'secret') writeFileSync(adminFile, adminOrig)
  sql(`update settings set value = '${knetOrig.replace(/'/g, "''")}' where name = 'knet'`)
  sql(`update settings set value = '${promoOrig.replace(/'/g, "''")}' where name = 'promo_bar'`)
  console.log(fails ? `\n${fails} FAILED` : '\nall backend-fixes checks passed')
  process.exitCode = fails ? 1 : 0
}
