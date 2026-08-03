// api/preflight.php — the install ladder, against a real staged public_html.
//
//   npm run test:preflight        (needs MariaDB and php)
//
// WHY THIS SUITE EXISTS AT ALL
// preflight.php is the ONLY instrument the owner has. There is no shell on
// that host, no logs they can read, and no way to ask the server a question
// except by loading a page. Every go-live failure so far — the wrong db_pass,
// the half-uploaded assets folder, the missing mysql_* block — was diagnosed
// by someone with a terminal, and preflight exists so that the next one is
// not. A diagnostic nobody tests is a diagnostic that says "everything is
// fine" on the day it matters, which is worse than not having one.
//
// So each check below BREAKS the install in one specific way and asserts that
// the page names that failure and no other. A test that only asserts a healthy
// install stays green would have passed against every bug listed above.
import { execFile } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)
const sql = async (q) => (await run('mariadb', ['-N', '-B', '-e', q])).stdout.trim()

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 56 - t.length))}`)

const ROOT = '/tmp/sporta-preflight'
const PORT = 8210
const KEY = 'preflight-cron-key-0123456789'
const src = (p) => new URL(`../${p}`, import.meta.url).pathname

// A staged public_html, built the way the owner's actually is: the site at the
// root, /api, /knet and /pay beside it.
function stage() {
  rmSync(ROOT, { recursive: true, force: true })
  for (const d of ['api', 'knet', 'pay', 'assets']) mkdirSync(`${ROOT}/${d}`, { recursive: true })
  cpSync(src('dropin/php-store'), `${ROOT}/api`, { recursive: true })
  cpSync(src('dropin/php-knet'), `${ROOT}/knet`, { recursive: true })
  cpSync(src('dropin/php-cbk'), `${ROOT}/pay`, { recursive: true })
  // The dropins carry a local config.php for the other suites; the ladder must
  // be driven from the ones written below, not from those.
  for (const f of ['api/config.php', 'knet/config.php', 'pay/config.php']) {
    rmSync(`${ROOT}/${f}`, { force: true })
  }
  writeFileSync(`${ROOT}/.htaccess`, '# root\n')
  writeFileSync(`${ROOT}/index.html`, '<!doctype html><script src="/assets/app-abc123.js"></script>')
  writeFileSync(`${ROOT}/assets/app-abc123.js`, '//\n')
  mkdirSync(`${ROOT}/hero`, { recursive: true })
}

const php = (o) => `<?php return ${JSON.stringify(o)
  .replace(/^\{/, '[').replace(/\}$/, ']').replace(/":/g, '"=>')};`

const apiCfg = (o = {}) => writeFileSync(`${ROOT}/api/config.php`, php({
  db_host: 'localhost', db_name: 'sporta', db_user: 'sporta', db_pass: 'test-pass',
  cron_key: KEY, ...o,
}))
// A KNET config that is correct in every way, so each test can spoil exactly
// one thing and the failure it produces is unambiguous.
const knetCfg = (o = {}) => writeFileSync(`${ROOT}/knet/config.php`, php({
  env: 'test',
  test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm',
  production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
  tranportal_id: 'sporta1', tranportal_password: 'pw123456',
  resource_key: '1234567890123456',
  response_url: 'https://www.sporta.com.kw/knet/callback.php',
  error_url: 'https://www.sporta.com.kw/knet/callback.php',
  result_page_url: 'https://www.sporta.com.kw/payment/result',
  log_file: '/tmp/sporta-preflight-knet.log',
  mysql_host: 'localhost', mysql_name: 'sporta', mysql_user: 'sporta', mysql_pass: 'test-pass',
  ...o,
}))

// The page is a POST form once api/config.php exists — the cron_key gates it.
const load = async () => {
  const { stdout } = await run('curl', ['-s', '-X', 'POST',
    '-d', `key=${KEY}`, `http://127.0.0.1:${PORT}/api/preflight.php`])
  return stdout
}
// Findings are rendered as rows; this pulls out the ones the page is unhappy
// about, which is what every assertion below is really asking for.
// The state lives on the dot, not the row — every row carries class="row" and
// only the <span class="dot ok|warn|bad"> says how it went.
const problems = (html) => [...html.matchAll(
  /class="dot (bad|warn)"><\/span>\s*<span>\s*<b>([^<]*)<\/b>(?:\s*<span class="detail">\s*—\s*([^<]*))?/g)]
  .map((m) => `${m[1]} ${m[2]} ${m[3] ?? ''}`)
const says = (html, re) => problems(html).some((p) => re.test(p))

stage()
apiCfg()
knetCfg()
const srv = (await import('node:child_process')).spawn(
  'php', ['-S', `127.0.0.1:${PORT}`, '-t', ROOT], { stdio: 'ignore', detached: true })
for (let i = 0; i < 60; i++) {
  const r = await run('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}',
                               `http://127.0.0.1:${PORT}/`]).catch(() => null)
  if (r && r.stdout !== '000') break
  await new Promise((r) => setTimeout(r, 100))
}

try {
  // ------------------------------------------------------------ the baseline
  head('a correct install is reported as correct')
  {
    const html = await load()
    is(html.includes('preflight') || html.includes('<'), 'the page renders at all')
    // `bad` only. A healthy install still WARNS — env is 'test', and
    // setup-config.php/selftest.php are still sitting on the server waiting to
    // be deleted. Those are the page doing its job, not the install failing.
    is(!problems(html).some((p) => /^bad .*knet\/config\.php/.test(p)),
       'nothing BROKEN about knet/config.php',
       problems(html).filter((p) => /knet/.test(p)).join(' | '))
    is(!says(html, /the key actually encrypts/), 'the resource key round-trips')
    is(!says(html, /reaches the orders table/), 'and the gateway reaches the orders table')
  }

  // ------------------------------- the failure this whole page was written for
  head('a database block that is filled in but WRONG')
  {
    // Four non-empty values that do not work — the check that used to pass.
    // Historically this shipped as "Invalid amount" on a live checkout.
    knetCfg({ mysql_pass: 'not-the-password' })
    const html = await load()
    is(says(html, /reaches the orders table/),
       'a wrong mysql_pass is caught, not counted as "present"',
       problems(html).find((p) => /orders table/.test(p)) ?? 'nothing reported')
    is(/mysql_user or mysql_pass is wrong/.test(html),
       'and MySQL’s own reason is passed on rather than flattened')
    is(!html.includes('not-the-password'), 'the wrong password is never printed back')
  }

  head('a database that works but is the WRONG one')
  {
    await sql('create database if not exists sporta_other')
    await sql("grant all on sporta_other.* to 'sporta'@'localhost'")
    await sql('create table if not exists sporta_other.orders (id int primary key)')
    knetCfg({ mysql_name: 'sporta_other' })
    const html = await load()
    is(says(html, /same database as api\/config\.php/),
       'the shop and the gateway pointing at two databases is caught',
       problems(html).find((p) => /same database/.test(p)) ?? 'nothing reported')
    await sql('drop database sporta_other')
  }

  // ------------------------------------------------------------ the AES key
  head('the resource key')
  {
    knetCfg({ resource_key: '1234567890123456 ' })   // 17 — the classic paste
    let html = await load()
    is(says(html, /resource_key length/), 'a 17-byte key is caught')
    is(says(html, /characters/), 'and the trailing space is named as the cause',
       problems(html).find((p) => /characters/.test(p)) ?? '')

    // Sixteen bytes, one of which is a non-breaking space: passes the length
    // check, invisible in File Manager, and the reason the round trip exists.
    knetCfg({ resource_key: '123456789012345 ' })
    html = await load()
    is(says(html, /characters/),
       'a NON-BREAKING SPACE inside a 16-byte key is caught, though it counts as 16',
       problems(html).find((p) => /characters/.test(p)) ?? 'nothing reported')
  }

  head('placeholders are not credentials')
  {
    knetCfg({ tranportal_id: 'YOUR_TRANPORTAL_ID' })
    const html = await load()
    is(says(html, /knet\/config\.php/), 'the example value is still refused')
  }

  // -------------------------------------------------- test vs production URLs
  head('which gateway the money is actually going to')
  {
    knetCfg({ test_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm' })
    const html = await load()
    is(says(html, /test_url/),
       'env=test pointed at the PRODUCTION host is caught — those are real cards',
       problems(html).find((p) => /test_url/.test(p)) ?? 'nothing reported')

    knetCfg({ production_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm' })
    is(says(await load(), /production_url/),
       'and a production_url that is still a test host is caught too')
  }

  // ------------------------------------------------------- the .htaccess files
  head('the file that keeps the Tranportal password off the internet')
  {
    knetCfg()
    writeFileSync(`${ROOT}/knet/.htaccess`, '# tidied up\n')
    const html = await load()
    is(says(html, /denies its secrets/),
       'a .htaccess that exists but denies nothing is caught — present is not protecting',
       problems(html).find((p) => /denies/.test(p)) ?? 'nothing reported')
    cpSync(src('dropin/php-knet/.htaccess'), `${ROOT}/knet/.htaccess`)
    is(!says(await load(), /denies its secrets/), 'and the real one passes')
  }

  // ----------------------------------------------------------------- secrecy
  head('it never prints a secret')
  {
    knetCfg()
    const html = await load()
    for (const secret of ['pw123456', '1234567890123456', 'test-pass', KEY]) {
      is(!html.includes(secret), `${secret.slice(0, 4)}… is not in the page`)
    }
  }

  head('and it stays locked without the key')
  {
    const { stdout } = await run('curl', ['-s', '-X', 'POST', '-d', 'key=wrong',
                                          `http://127.0.0.1:${PORT}/api/preflight.php`])
    // Not a bare "tranportal": the .htaccess row legitimately says it keeps
    // the Tranportal credentials unreadable, and that sentence is public.
    // What must not appear is anything READ OUT of a config file.
    is(!/reaches the orders table|resource_key length|credentials set|actually encrypts/i.test(stdout),
       'a wrong cron_key learns nothing about the payment configs')
  }
} finally {
  try { process.kill(-srv.pid) } catch {}
  rmSync(ROOT, { recursive: true, force: true })
}

console.log(fails ? `\n${fails} problem(s) in the install ladder`
                  : '\npreflight: every way of getting the setup wrong is named')
process.exit(fails ? 1 : 0)
