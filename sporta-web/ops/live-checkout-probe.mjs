// READ-ONLY probe: why does the live checkout offer which payment methods, and did the 2026-11-18 release change the answer?
// Run ON the VPS in node:24-alpine with php installed (apk add php84 php84-openssl php84-curl), the store config and the three database
// secret files, and /docker/sporta mounted read-only, on the sporta-db_default network. SELECT only. It prints booleans, short settings
// switches and the CLASS of a configuration error (every config value is masked out of the message); never a secret, host or user name.
//
// 1. the owner's saved checkout switches (settings.checkout): which methods are switched on;
// 2. the gateway readiness check (knet_assert_payment_config / cbk_assert_payment_config) run with the OLD library (the deploy backup
//    taken before the release) and the NEW library (what is live now) against the live gateway configs: same answer or not.
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { MySQL, credentials, scrub } from '../scripts/db-schema-live-diff.mjs'

const say = (s) => console.log(s)
const creds = credentials({ config: '/run/sporta-api-config.php' })
const conn = new MySQL(creds)
try {
  await conn.connect()
  await conn.query('set session transaction read only')
  say('== 1 saved checkout switches')
  const rows = (await conn.query("select name, value from settings where name in ('checkout','payment_config_note')")).rows
  for (const [name, value] of rows) {
    let v = null
    try { v = JSON.parse(value) } catch { /* not json */ }
    if (v && typeof v === 'object') {
      const keep = {}
      for (const [k, x] of Object.entries(v)) if (['boolean', 'number'].includes(typeof x) || (typeof x === 'string' && x.length <= 24)) keep[k] = x
      say(`${name}: ${JSON.stringify(keep)}`)
    } else say(`${name}: (not an object)`)
  }
  const names = (await conn.query("select name from settings where name like '%knet%' or name like '%cbk%' or name like '%pay%' or name like '%checkout%' order by name")).rows.map((r) => r[0])
  say(`related setting names: ${names.join(', ')}`)
} catch (e) { say(`DB PROBE FAILED: ${scrub(e.message, [creds.password])}`) } finally { try { conn.end() } catch { /* closed */ } }

say('== 2 gateway readiness: old library vs new library')
const backupRoot = '/sporta/backups'
// The deploy tool keeps what a release replaced as <name>.tar.gz of the changed paths, relative to the web root.
const archives = existsSync(backupRoot) ? readdirSync(backupRoot).filter((n) => /^deploy-20261118T130519Z-.*\.tar\.gz$/.test(n)) : []
say(`deploy backup found: ${archives.length ? archives[0] : 'NONE'}`)
const oldRoot = '/tmp/old'
if (archives.length) spawnSync('sh', ['-c', `mkdir -p ${oldRoot} && tar xzf ${join(backupRoot, archives[0])} -C ${oldRoot} knet/knet.php pay/cbk.php`], { encoding: 'utf8' })
const find = (root, rel) => {
  const p = join(root, rel)
  return existsSync(p) ? p : null
}
const cases = [
  ['knet', 'knet/knet.php', '/sporta/private/knet-config.php', 'knet_assert_payment_config'],
  ['tpay', 'pay/cbk.php', '/sporta/private/pay-config.php', 'cbk_assert_payment_config'],
]
const runPhp = (lib, cfgFile, fn) => {
  const code = `error_reporting(E_ALL); $cfg = require $argv[2]; require $argv[1];
    try { ${fn}($cfg); echo "OK"; } catch (Throwable $e) { $m = $e->getMessage();
      foreach ($cfg as $v) if (is_string($v) && strlen($v) > 3) $m = str_replace($v, '***', $m);
      echo 'FAIL ' . get_class($e) . ': ' . substr($m, 0, 220); }`
  const r = spawnSync('php', ['-r', code, lib, cfgFile], { encoding: 'utf8' })
  return (r.stdout || r.stderr || `exit ${r.status}`).trim().slice(0, 300)
}
for (const [name, rel, cfgFile, fn] of cases) {
  if (!existsSync(cfgFile)) { say(`${name}: config file not found`); continue }
  const oldLib = archives.length ? find(oldRoot, rel) : null
  const newLib = find('/sporta/site', rel)
  say(`${name}: OLD library ${oldLib ? runPhp(oldLib, cfgFile, fn) : 'not in the backup (the file did not change, or the layout differs)'}`)
  say(`${name}: NEW library ${newLib ? runPhp(newLib, cfgFile, fn) : 'not found under /sporta/site'}`)
}
say('PROBE_DONE')
