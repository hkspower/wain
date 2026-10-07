/**
 * The admin sign-in log: every attempt with address and country.
 *
 *   bash scripts/sandbox.sh && node scripts/login-log-test.mjs
 *
 * Drives the real doors over HTTP and reads the log table back. The country
 * lookup is exercised against a local stand-in for the lookup service (the
 * real one is a third party and is not called from tests).
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EMAIL = 'manager@sporta.com.kw', PASS = 'correct horse'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
const post = async (route, body, cookie = '') => {
  const r = await fetch(`${BASE}/api/admin.php?r=${route}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', cookie }, body: JSON.stringify(body) })
  const sc = (r.headers.getSetCookie?.() ?? []).map((s) => s.split(';')[0]).join('; ')
  return { status: r.status, j: await r.json().catch(() => null), cookie: sc }
}
const last = () => sql('select method, result, ip, country, coalesce(admin_id,0)>0, new_ip from admin_login_log order by id desc limit 1').split('\t')
const count = () => Number(sql('select count(*) from admin_login_log'))
const settle = async (n) => { for (let i = 0; i < 40 && count() < n; i++) await new Promise((r) => setTimeout(r, 100)) }

sql('delete from admin_login_log'); sql('delete from admin_ip_geo'); sql('delete from rate_limit; delete from rate_bucket')

let n = count()
await post('login', { email: EMAIL, password: 'wrong password 123' }); await settle(n + 1)
let r = last()
check(r[0] === 'password' && r[1] === 'bad_credentials' && r[2] === '127.0.0.1' && r[4] === '1', 'a wrong password is logged with the address and the account', r.join(' '))
check(r[3] === '--', 'a private address is marked, not looked up', `country=${r[3]}`)

await post('login', { email: 'nobody@nowhere.test', password: 'x'.repeat(14) }); await settle(n + 2)
r = last()
check(r[1] === 'bad_credentials' && r[4] === '0', 'an unknown account is logged too, with no account id', r.join(' '))

const ok = await post('login', { email: EMAIL, password: PASS }); await settle(n + 3)
r = last()
check(ok.status === 200 && r[1] === 'ok' && r[5] === '1', 'a success is logged, and the first from an address is marked new', r.join(' '))
await post('login', { email: EMAIL, password: PASS }); await settle(n + 4)
check(last()[5] === '0', 'the second success from the same address is not new')

// the password itself is never written anywhere in the log
check(!sql('select group_concat(concat_ws(",",email,method,result,ip,agent)) from admin_login_log').includes(PASS), 'no password appears in the log')

// passcode + reset doors are on the list
const before = count()
await post('passcode_unlock', { passcode: '111222' }); await settle(before + 1)
check(last()[0] === 'passcode' && last()[1] === 'passcode_refused', 'the passcode door is logged', last().join(' '))
await post('password_reset_confirm', { email: EMAIL, code: '00000000', password: 'x'.repeat(14), password2: 'x'.repeat(14) }); await settle(before + 2)
check(last()[0] === 'reset' && last()[1] === 'reset_refused', 'the reset door is logged', last().join(' '))

// the panel route
const c = (await post('login', { email: EMAIL, password: PASS })).cookie
const lg = await (await fetch(`${BASE}/api/admin.php?r=login_log`, { headers: { 'X-Sporta-Admin': '1', cookie: c } })).json()
check(lg.ready && lg.rows.length >= 6 && lg.failures_24h >= 3, 'the panel route returns the history and a 24-hour failure count', `rows=${lg.rows?.length} fails=${lg.failures_24h}`)
const anon = await fetch(`${BASE}/api/admin.php?r=login_log`, { headers: { 'X-Sporta-Admin': '1' } })
check(anon.status === 401, 'the history is behind the gate')

// country lookup, against a stand-in service
const dir = mkdtempSync(join(tmpdir(), 'geo-'))
writeFileSync(join(dir, 'r.php'), `<?php header('Content-Type: application/json'); $c = str_starts_with($_SERVER['REQUEST_URI'], '/203.0.113') ? ['success'=>true,'country_code'=>'kw','country'=>'Kuwait'] : ['success'=>false]; echo json_encode($c);`)
const srv = spawn('php', ['-S', '127.0.0.1:4392', '-t', dir, join(dir, 'r.php')], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 700))
try {
  const php = (code) => execFileSync('php', ['-r', `$_SERVER['HTTPS']='off'; require 'sporta-site/public_html/api/store.php'; $db=store_db(); ${code}`], { encoding: 'utf8' }).trim()
  const T = 'http://127.0.0.1:4392/{ip}'
  check(php(`echo json_encode(store_geo_lookup($db,'203.0.113.9','${T}'));`) === '["KW","Kuwait"]', 'a public address is looked up and normalised', '')
  check(sql("select country from admin_ip_geo where ip='203.0.113.9'") === 'KW', 'and remembered')
  check(php(`echo json_encode(store_geo_lookup($db,'203.0.113.9','http://127.0.0.1:1/{ip}'));`) === '["KW","Kuwait"]', 'a remembered address is not asked about again')
  check(php(`echo json_encode(store_geo_lookup($db,'198.51.100.7','${T}'));`) === '[null,null]', 'a failed lookup leaves the country blank, not wrong')
  check(php(`echo json_encode(store_geo_lookup($db,'10.1.2.3','${T}'));`).startsWith('["--"'), 'a private address is never sent to the service')
  // the alert: third failure from a new address
  sql("insert into admin_login_log (admin_id,email,method,result,ip,new_ip) select id,email,'password','bad_credentials','203.0.113.50',1 from admin_users where email='" + EMAIL + "' limit 2")
  const out = php(`$_SERVER['REMOTE_ADDR']='203.0.113.50'; store_admin_login_log($db,'password','bad_credentials',(int)$db->query("select id from admin_users where email='${EMAIL}'")->fetchColumn(),'${EMAIL}','${T}'); echo $db->query("select country from admin_login_log order by id desc limit 1")->fetchColumn();`)
  check(out === 'KW', 'a log row picks up its country', out)
} finally { srv.kill() }

sql('delete from admin_login_log'); sql('delete from admin_ip_geo')
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0)
