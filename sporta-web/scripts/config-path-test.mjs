// WHERE THE CONFIG LIVES — both server layouts, end to end.
//
// The store, KNET and T-Pay each used to read config.php from the folder they
// run in. The live VPS keeps NO config.php in the web root: the store's config
// is a read-only bind mount named by SPORTA_API_CONFIG_FILE, and the gateways'
// sit in the directory SPORTA_PRIVATE_CONFIG_DIR names (knet-config.php,
// pay-config.php). KNET had learnt that; the store and T-Pay had not, so the
// next release to the VPS would have taken the API and T-Pay down with it.
// api/config-path.php is now the one rule all three read.
//
// This suite lays the dropins out the way bundle-php ships them — api/, knet/
// and pay/ side by side — in throwaway folders, and proves:
//   1. the rule itself, case by case, under php-cli;
//   2. the VPS layout: no config.php anywhere under the web root, and the
//      catalogue, a KNET handoff and a whole T-Pay payment still work — with
//      the gateway configs carrying NO database block, so the fallback to the
//      store's database settings is proven on the way;
//   3. the shared-hosting layout: config.php next to the code, as before;
//   4. it fails CLOSED: a private directory without the store's config is
//      refused even with a perfectly good api/config.php sitting in the web
//      root, and no refusal names a path.
//
//   npm run test:config
//   (needs the sandbox — MariaDB, its test configs, and the fake CBK gateway
//   on :8099: npm run sandbox)
import { execFile, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const DROPIN = join(HERE, '..', 'dropin')
const GW = process.env.CBK_BASE ?? 'http://127.0.0.1:8099'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

const sql = async (q) => (await run('mariadb', ['sporta', '-N', '-B', '-e', q])).stdout.trim()

// The sandbox's TEST configs (fake gateways, the local database) are the
// source for every config this suite writes. Without them there is nothing to
// point the layouts at.
const SRC = {
  api: join(DROPIN, 'php-store', 'config.php'),
  knet: join(DROPIN, 'php-knet', 'config.php'),
  tpay: join(DROPIN, 'php-cbk', 'config.php'),
}
for (const f of Object.values(SRC)) {
  if (!existsSync(f)) {
    console.error(`missing ${f} — run npm run sandbox first`)
    process.exit(1)
  }
}
try {
  await fetch(`${GW}/`)
} catch {
  console.error(`the fake CBK gateway is not answering on ${GW} — run npm run sandbox first`)
  process.exit(1)
}

// Same rate-limit reset the other suites do: ?r=order allows 20 per ten
// minutes per IP, and they all share 127.0.0.1.
await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
const TRACKS = ['SPCFGVPSKNET', 'SPCFGVPSTPAY', 'SPCFGLEGKNET', 'SPCFGLEGTPAY', 'SPCFGBADTPAY']
const inList = TRACKS.map((t) => `'${t}'`).join(',')
const forget = () => sql(
  `delete from fulfilment_outbox where order_id in (select id from orders where track_id in (${inList}));
   delete from order_items where order_id in (select id from orders where track_id in (${inList}));
   delete from orders where track_id in (${inList});`,
)
await forget()

// ------------------------------------------------------------------ layouts
const T = mkdtempSync(join(tmpdir(), 'sporta-cfg-'))
// bundle-php's rule: everything in the dropin except the secrets and notes.
const SKIP = new Set(['config.php', '.cbk_token.json', 'README.md'])
const lay = (site) => {
  for (const [from, to] of [['php-store', 'api'], ['php-knet', 'knet'], ['php-cbk', 'pay']]) {
    cpSync(join(DROPIN, from), join(site, to), { recursive: true, filter: (src) => !SKIP.has(basename(src)) })
  }
}
// A config is written by PHP itself (var_export), from a sandbox config, with
// keys dropped or replaced — never by string-building PHP in JavaScript.
const writeConfig = async (src, dest, { drop = [], set = {} } = {}) => {
  mkdirSync(dirname(dest), { recursive: true })
  await run('php', ['-r', `
    $c = require $argv[1];
    foreach (json_decode($argv[3], true) as $k) unset($c[$k]);
    foreach (json_decode($argv[4], true) as $k => $v) $c[$k] = $v;
    file_put_contents($argv[2], "<?php\\nreturn " . var_export($c, true) . ";\\n");
  `, '--', src, dest, JSON.stringify(drop), JSON.stringify(set)])
}
const DB_BLOCK = ['mysql_host', 'mysql_name', 'mysql_user', 'mysql_pass']
const configsUnder = (dir) => readdirSync(dir, { recursive: true })
  .filter((p) => basename(String(p)) === 'config.php' && statSync(join(dir, String(p))).isFile())

const PORT = { vps: 8111, legacy: 8112, broken: 8113 }
const base = (k) => `http://127.0.0.1:${PORT[k]}`

// The VPS: web root with no secrets, configs above it.
const VPS = { site: join(T, 'vps', 'site'), priv: join(T, 'vps', 'private') }
lay(VPS.site)
await writeConfig(SRC.api, join(VPS.priv, 'api-config.php'))
// NO database block in either gateway config: the fallback must supply it.
await writeConfig(SRC.knet, join(VPS.priv, 'config', 'knet-config.php'), { drop: DB_BLOCK })
await writeConfig(SRC.tpay, join(VPS.priv, 'config', 'pay-config.php'),
  { drop: DB_BLOCK, set: { return_url: `${base('vps')}/pay/callback.php` } })

// Shared hosting: each config.php next to the code that reads it.
const LEGACY = { site: join(T, 'legacy', 'site') }
lay(LEGACY.site)
await writeConfig(SRC.api, join(LEGACY.site, 'api', 'config.php'))
await writeConfig(SRC.knet, join(LEGACY.site, 'knet', 'config.php'))
await writeConfig(SRC.tpay, join(LEGACY.site, 'pay', 'config.php'),
  { set: { return_url: `${base('legacy')}/pay/callback.php` } })

// A VPS whose private store config was never mounted — and whose web root
// still holds WORKING config.php files from an older install. Every one of
// them would succeed if read; none may be.
const BROKEN = { site: join(T, 'broken', 'site'), priv: join(T, 'broken', 'private') }
lay(BROKEN.site)
await writeConfig(SRC.api, join(BROKEN.site, 'api', 'config.php'))
await writeConfig(SRC.knet, join(BROKEN.site, 'knet', 'config.php'))
await writeConfig(SRC.tpay, join(BROKEN.site, 'pay', 'config.php'))
await writeConfig(SRC.knet, join(BROKEN.priv, 'config', 'knet-config.php'), { drop: DB_BLOCK })
// ...and no pay-config.php in the private directory at all.

// ------------------------------------------------------------------ servers
const CLEAN_ENV = { ...process.env }
delete CLEAN_ENV.SPORTA_API_CONFIG_FILE
delete CLEAN_ENV.SPORTA_PRIVATE_CONFIG_DIR
const servers = []
const serve = async (key, site, extra) => {
  const p = spawn('php', ['-S', `127.0.0.1:${PORT[key]}`, '-t', site],
    { env: { ...CLEAN_ENV, ...extra }, stdio: 'ignore' })
  servers.push(p)
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base(key)}/`); return } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  throw new Error(`php -S on ${PORT[key]} did not start`)
}
const stop = () => { for (const p of servers) p.kill() }
process.on('exit', stop)

await serve('vps', VPS.site, {
  SPORTA_API_CONFIG_FILE: join(VPS.priv, 'api-config.php'),
  SPORTA_PRIVATE_CONFIG_DIR: join(VPS.priv, 'config'),
})
await serve('legacy', LEGACY.site, {})
await serve('broken', BROKEN.site, { SPORTA_PRIVATE_CONFIG_DIR: join(BROKEN.priv, 'config') })

// The endpoints refuse plain HTTP; the proxy header is how the edge says TLS
// was terminated upstream (Traefik on the VPS, Hostinger's proxy on shared).
const HTTPS = { 'X-Forwarded-Proto': 'https' }
const get = (url, init = {}) => fetch(url, { redirect: 'manual', ...init, headers: { ...HTTPS, ...(init.headers ?? {}) } })

const newOrder = async (key, track, method) => (await fetch(`${base(key)}/api/api.php?r=order`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    track_id: track,
    items: [{ slug: 'cloudsoft-jacket-army-green', qty: 1, size: 'L', fit: 'oversize' }],
    customer: {
      name: 'Fatima Al-Sabah', phone: '99887766', governorate: 'hawalli',
      area: 'Salmiya', block: '4', street: '12', building: '5',
    },
    payment_method: method,
  }),
})).json()

const formFields = (html) => Object.fromEntries(
  [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]),
)
const formAction = (html) => /<form method="post" action="([^"]+)"/.exec(html)?.[1] ?? ''
const products = async (key) => {
  const res = await get(`${base(key)}/api/api.php?r=products`)
  const text = await res.text()
  let list = null
  try { const j = JSON.parse(text); list = Array.isArray(j) ? j : (j.products ?? null) } catch { /* not JSON */ }
  return { status: res.status, text, list }
}

try {
  // ---------------------------------------------------------- 1. the rule
  head('the rule, case by case')
  {
    const out = await run('php', ['-r', `
      require $argv[1];
      $cases = json_decode($argv[2], true);
      $res = [];
      foreach ($cases as [$api, $dir, $kind]) {
        $api === null ? putenv('SPORTA_API_CONFIG_FILE') : putenv("SPORTA_API_CONFIG_FILE=$api");
        $dir === null ? putenv('SPORTA_PRIVATE_CONFIG_DIR') : putenv("SPORTA_PRIVATE_CONFIG_DIR=$dir");
        try { $res[] = sporta_config_path($kind, '/legacy/' . $kind . '/config.php'); }
        catch (Throwable $e) { $res[] = get_class($e) . ': ' . $e->getMessage(); }
      }
      echo json_encode($res);
    `, '--', join(DROPIN, 'php-store', 'config-path.php'), JSON.stringify([
      [null, null, 'api'], [null, null, 'knet'], [null, null, 'tpay'],
      ['', '', 'api'], ['', '', 'knet'],
      ['/srv/api.php', null, 'api'], ['/srv/api.php', null, 'tpay'],
      ['/srv/api.php', '/srv/cfg/', 'api'], ['/srv/api.php', '/srv/cfg/', 'knet'], ['/srv/api.php', '/srv/cfg', 'tpay'],
      [null, '/srv/cfg', 'api'],
      ['api.php', null, 'api'], [' /srv/api.php', null, 'api'],
      ['/srv/api.php', 'cfg', 'knet'], ['/srv/api.php', '/srv/cfg ', 'tpay'],
      [null, null, 'mail'],
    ])])
    const [l1, l2, l3, e1, e2, f1, f2, v1, v2, v3, c1, r1, r2, r3, r4, u1] = JSON.parse(out.stdout)
    is(l1 === '/legacy/api/config.php' && l2 === '/legacy/knet/config.php' && l3 === '/legacy/tpay/config.php',
       'nothing set (shared hosting): each config.php next to its code', [l1, l2, l3].join(' '))
    is(e1 === '/legacy/api/config.php' && e2 === '/legacy/knet/config.php',
       'empty variables count as unset', [e1, e2].join(' '))
    is(f1 === '/srv/api.php', 'SPORTA_API_CONFIG_FILE names the store config', f1)
    is(f2 === '/legacy/tpay/config.php', 'without a private directory the gateways stay next to their code', f2)
    is(v1 === '/srv/api.php' && v2 === '/srv/cfg/knet-config.php' && v3 === '/srv/cfg/pay-config.php',
       'the VPS: knet-config.php and pay-config.php in the private directory', [v1, v2, v3].join(' '))
    is(c1 === 'RuntimeException: Private API config path missing',
       'a private directory with no store config FAILS — no web-root fallback', c1)
    is(r1.startsWith('RuntimeException') && r2.startsWith('RuntimeException'),
       'a relative or padded SPORTA_API_CONFIG_FILE is refused', `${r1} | ${r2}`)
    is(r3.startsWith('RuntimeException') && r4.startsWith('RuntimeException'),
       'a relative or padded SPORTA_PRIVATE_CONFIG_DIR is refused', `${r3} | ${r4}`)
    is(u1.startsWith('InvalidArgumentException'), 'an unknown kind of config is refused', u1)
  }
  {
    // A gateway copied on its own, with no api/ beside it. Shared hosting
    // still works; a private-config server must not quietly read pay/config.php.
    const probe = (env) => run('php', ['-r', `
      require $argv[1];
      try { echo cbk_config_path('tpay', '/legacy/pay/config.php'); }
      catch (Throwable $e) { echo get_class($e), ': ', $e->getMessage(); }
    `, '--', join(DROPIN, 'php-cbk', 'cbk.php')], { env: { ...CLEAN_ENV, ...env } })
    const alone = (await probe({})).stdout
    const strict = (await probe({ SPORTA_PRIVATE_CONFIG_DIR: '/srv/cfg' })).stdout
    is(alone === '/legacy/pay/config.php', 'T-Pay on its own, shared hosting: pay/config.php', alone)
    is(strict === 'RuntimeException: Private config resolver is missing',
       'T-Pay on its own on a private-config server refuses rather than guess', strict)
  }

  // ------------------------------------------------------ 2. the VPS layout
  head('the VPS layout: no config.php in the web root')
  {
    const found = configsUnder(VPS.site)
    is(found.length === 0, 'the web root holds no config.php at all', found.join(', ') || 'none')

    const cat = await products('vps')
    is(cat.status === 200 && Array.isArray(cat.list) && cat.list.length > 0,
       'the catalogue loads — the store read its private config', `${cat.status}, ${cat.list?.length ?? 0} products`)

    const kOrder = await newOrder('vps', 'SPCFGVPSKNET', 'knet')
    is(typeof kOrder.amount === 'number' && kOrder.amount > 0, 'an order is taken', `${kOrder.amount} KWD`)
    const k = await get(`${base('vps')}/knet/pay.php?trackid=SPCFGVPSKNET`)
    const kLoc = k.headers.get('location') ?? ''
    is(k.status === 302 && kLoc.includes('trandata='),
       'KNET hands the shopper to the bank — knet-config.php from the private directory, and its database from the store config',
       `${k.status}`)

    const tOrder = await newOrder('vps', 'SPCFGVPSTPAY', 'tpay')
    const t = await get(`${base('vps')}/pay/pay.php?trackid=SPCFGVPSTPAY`)
    const html = await t.text()
    const f = formFields(html)
    is(t.status === 200 && formAction(html).includes('/ePay/pg/epay'),
       'T-Pay hands the shopper to CBK — pay-config.php from the private directory', `${t.status}`)
    is(f.tij_MerchantPaymentAmount === Number(tOrder.amount).toFixed(3),
       'the amount is the order total, read through the fallback database settings', f.tij_MerchantPaymentAmount)

    // The rest of a payment: the callback loads the same config the same way.
    const action = formAction(html).replace(/&amp;/g, '&')
    if (!action) {
      bad('the T-Pay callback settles it and sends the shopper to the success page', 'no payment form to follow')
      bad('the order is PAID in MySQL', 'never reached the gateway')
    } else {
      const gw = await (await fetch(`${action}${action.includes('?') ? '&' : '?'}outcome=success`, {
        method: 'POST', body: new URLSearchParams(f),
      })).json()
      const back = await get(gw.return_url)
      const loc = back.headers.get('location') ?? ''
      is(back.status === 302 && loc.includes('status=success'),
         'the T-Pay callback settles it and sends the shopper to the success page', loc.split('?')[1] ?? `${back.status}`)
      const paid = await sql("select payment_status from orders where track_id='SPCFGVPSTPAY'")
      is(paid === 'paid', 'the order is PAID in MySQL', paid)
    }

    const self = await (await get(`${base('vps')}/knet/selftest.php`)).text()
    is(self.includes('config.php  : present'), 'knet/selftest.php finds the private KNET config',
       self.split('\n').find((l) => l.startsWith('config.php')) ?? '')

    // preflight renders every check in its "Everything checked" list, so the
    // rows themselves are the evidence. "missing" was also the state in which
    // it answered WITHOUT a key; finding the config is what locks it.
    const pre = await (await get(`${base('vps')}/api/preflight.php`)).text()
    is(!pre.includes('Copy api/config.example.php to api/config.php') && !pre.includes('config location ('),
       'api/preflight.php finds the private store config')
    is(!pre.includes('api/config.php: db_host'), 'and is locked by it — no details without the key')
    const { cron_key: cronKey } = JSON.parse((await run('php', ['-r',
      'echo json_encode(["cron_key" => (require $argv[1])["cron_key"] ?? ""]);', '--', SRC.api])).stdout)
    const unlocked = await (await get(`${base('vps')}/api/preflight.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: cronKey }),
    })).text()
    is(unlocked.includes('api/config.php: db_host'), 'with the key it opens')
    is(unlocked.includes('knet/config.php: characters') && unlocked.includes('pay/config.php: characters')
       && !unlocked.includes('missing — this payment method is off'),
       'and reads both payment configs from the private directory')
  }

  // --------------------------------------------- 3. the shared-hosting layout
  head('shared hosting: config.php next to the code')
  {
    const cat = await products('legacy')
    is(cat.status === 200 && Array.isArray(cat.list) && cat.list.length > 0,
       'the catalogue loads from api/config.php', `${cat.status}, ${cat.list?.length ?? 0} products`)
    await newOrder('legacy', 'SPCFGLEGKNET', 'knet')
    const k = await get(`${base('legacy')}/knet/pay.php?trackid=SPCFGLEGKNET`)
    is(k.status === 302 && (k.headers.get('location') ?? '').includes('trandata='),
       'KNET reads knet/config.php', `${k.status}`)
    const tOrder = await newOrder('legacy', 'SPCFGLEGTPAY', 'tpay')
    const t = await get(`${base('legacy')}/pay/pay.php?trackid=SPCFGLEGTPAY`)
    const f = formFields(await t.text())
    is(t.status === 200 && f.tij_MerchantPaymentAmount === Number(tOrder.amount).toFixed(3),
       'T-Pay reads pay/config.php', `${t.status} ${f.tij_MerchantPaymentAmount ?? ''}`)
  }

  // ------------------------------------------------------ 4. fails closed
  head('a half-configured VPS fails closed')
  {
    // The order is placed through the WORKING layout; the broken server is
    // then asked to charge for it. Every refusal below would have been a
    // success if the web-root config.php files were read.
    await newOrder('vps', 'SPCFGBADTPAY', 'tpay')

    const cat = await products('broken')
    is(cat.status === 500 && cat.list === null,
       'the store refuses rather than read the web-root api/config.php', `${cat.status} ${cat.text.slice(0, 40)}`)
    is(!cat.text.includes(T), 'and the refusal names no path')

    const t = await get(`${base('broken')}/pay/pay.php?trackid=SPCFGBADTPAY`)
    const tBody = await t.text()
    is(t.status === 503 && tBody === 'Payment service is not configured.',
       'T-Pay with no private pay-config.php is off — the web-root pay/config.php is not used', `${t.status} ${tBody.slice(0, 40)}`)

    const k = await get(`${base('broken')}/knet/pay.php?trackid=SPCFGBADTPAY`)
    const kBody = await k.text()
    is(k.status === 500 && !(k.headers.get('location') ?? '').includes('trandata='),
       'KNET cannot borrow the web-root store config for its database', `${k.status}`)
    is(!kBody.includes(T) && !kBody.includes('RuntimeException'),
       'and the error stays in the log, not the response', kBody.slice(0, 60) || '(empty body)')
  }
} finally {
  stop()
  await forget()
  rmSync(T, { recursive: true, force: true })
}

console.log(`\n${fails === 0 ? 'ALL OK' : `${fails} FAILED`}`)
process.exit(fails === 0 ? 0 : 1)
