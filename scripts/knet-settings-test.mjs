/**
 * KNET/CBK settings saved from /backends actually reach the gateways.
 *
 *   bash scripts/sandbox.sh && node scripts/knet-settings-test.mjs
 *
 * Saves mode, environment, English code and the three CBK credentials through
 * the real admin route, then asks the REAL loaders (cbk_config, knet_config)
 * what they would send. Asserts the refusals (bad enum, spaces, placeholders),
 * that nothing is ever read back (booleans only), that clearing returns control
 * to the file, that the readiness line follows the saved values, and that the
 * CBK token cache is keyed to the credentials and environment.
 * The `knet` settings row is put back as it was.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }

const before = sql("select value from settings where name='knet'")
let cookie = ''
const call = async (route, body) => {
  const r = await fetch(`${BASE}/api/admin.php?r=${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', cookie },
    body: body ? JSON.stringify(body) : undefined,
  })
  for (const s of r.headers.getSetCookie?.() ?? []) cookie = s.split(';')[0]
  return { status: r.status, j: await r.json().catch(() => null) }
}
const save = (value) => call('settings_save', { name: 'knet', value })
const php = (code) => execFileSync('php', ['-r', code], { encoding: 'utf8', cwd: 'sporta-site/public_html/pay' }).trim()
const cbkCfg = () => JSON.parse(php(`$_SERVER['HTTPS']='off'; require 'cbk.php'; $c=cbk_config(); echo json_encode(['id'=>$c['client_id'],'secret'=>$c['client_secret'],'key'=>$c['encrp_key'],'env'=>$c['env']]);`))
const knetCfg = () => JSON.parse(php(`require '../knet/knet.php'; $c=knet_config(); echo json_encode(['mode'=>$c['mode']??'','env'=>$c['env']??'','lang'=>$c['lang_en']??'']);`))

try {
  sql("delete from rate_limit")
  await call('login', { email: 'manager@sporta.com.kw', password: 'correct horse' })
  const fileCbk = cbkCfg(), fileKnet = knetCfg()
  sql("delete from settings where name='knet'")

  for (const [v, err] of [
    [{ mode: 'both' }, 'invalid_mode'], [{ env: 'live' }, 'invalid_env'], [{ env: 'prod' }, 'invalid_env'],
    [{ lang_en: 'FR' }, 'invalid_lang_en'], [{ cbk_client_id: 'has space' }, 'invalid_cbk_client_id'],
    [{ cbk_client_secret: 'abc\n' }, 'invalid_cbk_client_secret'], [{ cbk_encrp_key: 'YOUR_ENCRP_KEY' }, 'placeholder_cbk_encrp_key'],
  ]) {
    const r = await save(v)
    check(r.j?.error === err, `refused: ${JSON.stringify(v).slice(0, 40)}`, `got ${r.j?.error}`)
  }
  check(sql("select count(*) from settings where name='knet'") === '0', 'a refused save writes nothing')

  const ok = await save({ mode: 'official', env: 'production', lang_en: 'USA',
    cbk_client_id: 'CID-TEST-1', cbk_client_secret: 'SECRET-TEST-2', cbk_encrp_key: 'ENCRP-TEST-3' })
  check(!ok.j?.error, 'a valid save is accepted', JSON.stringify(ok.j))

  const g = (await call('knet')).j
  check(g.mode === 'official' && g.env === 'production' && g.lang_en === 'USA', 'the panel route returns mode, env and language')
  check(g.cbk_client_id_set && g.cbk_client_secret_set && g.cbk_encrp_key_set, 'and the CBK credentials as booleans')
  check(!JSON.stringify(g).includes('SECRET-TEST-2') && !JSON.stringify(g).includes('ENCRP-TEST-3') && !JSON.stringify(g).includes('CID-TEST-1'), 'no credential value is ever sent back')
  check(g.pay?.ready === true && g.pay?.env === 'production', 'readiness follows the saved values', JSON.stringify(g.pay))

  const c = cbkCfg()
  check(c.id === 'CID-TEST-1' && c.secret === 'SECRET-TEST-2' && c.key === 'ENCRP-TEST-3' && c.env === 'production', 'cbk_config() sends the saved credentials and environment', JSON.stringify(c))
  const k = knetCfg()
  check(k.mode === 'official' && k.env === 'production' && k.lang === 'USA', 'knet_config() applies mode, env and language', JSON.stringify(k))

  // leaving a field out changes nothing; clearing one returns it to the file
  await save({ env: 'test' })
  check(cbkCfg().secret === 'SECRET-TEST-2' && cbkCfg().env === 'test', 'omitted credentials are kept; env changed alone')
  await save({ cbk_client_secret: '', mode: '', env: '', lang_en: '' })
  const c2 = cbkCfg(), k2 = knetCfg()
  check(c2.secret === fileCbk.secret && c2.env === fileCbk.env && c2.id === 'CID-TEST-1', 'clearing one field hands just that field back to the file')
  check(k2.mode === fileKnet.mode && k2.env === fileKnet.env && k2.lang === fileKnet.lang, 'cleared mode/env/language return to knet/config.php')

  // a row that fails the shape check is ignored, never applied
  sql(`update settings set value = '{"env":"live","cbk_client_id":"bad id","mode":"x"}' where name='knet'`)
  const c3 = cbkCfg()
  check(c3.id === fileCbk.id && c3.env === fileCbk.env && knetCfg().mode === fileKnet.mode, 'a hand-edited bad row is ignored, not applied')

  // token cache keyed to credentials + environment
  const src = readFileSync('sporta-site/public_html/pay/cbk.php', 'utf8')
  check(/'fp' => \$fp/.test(src) && /\['fp'\] \?\? ''\) === \$fp/.test(src), 'the CBK token cache is keyed to credentials and environment')
} finally {
  sql("delete from settings where name='knet'")
  if (before) execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e', `insert into settings (name, value) values ('knet', '${before.replace(/'/g, "''")}')`])
}
check(sql("select coalesce(max(value),'') from settings where name='knet'") === before, 'the knet row is back as it was')
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0)
