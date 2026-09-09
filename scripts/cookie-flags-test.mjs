/**
 * The session cookie's flags, and the directive that must never come back.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/cookie-flags-test.mjs
 *
 * WHY THIS EXISTS. Two `Header edit Set-Cookie` lines sat in .htaccess for
 * months adding Secure and SameSite to any cookie that arrived without them.
 * They were tested against Apache 2.4.58, where they work perfectly. Production
 * is LiteSpeed, which DOES NOT IMPLEMENT `Header edit`: it emitted each
 * directive as a header literally named `edit:`, so the rule protected nothing
 * and every response carried two junk headers. Measured live, `edit=2`.
 *
 * So the rig cannot test the thing that broke — htaccess-test.mjs starts a real
 * Apache, and on Apache the rule WORKS. A rig that passes on the wrong server
 * is not a test. What CAN be checked here, and is:
 *
 *   1. STATIC. No .htaccess in this repository carries a `Header edit`
 *      directive. That is the LiteSpeed trap itself, and it is the check that
 *      would have caught the original bug at commit time.
 *   2. STATIC. session_set_cookie_params() is reachable from every
 *      session_start() — i.e. store_session_start() is the only place a session
 *      begins, which is what makes claim 3 true of the whole codebase rather
 *      than of one file.
 *   3. LIVE, against the real PHP. Sign in and read the actual Set-Cookie: it
 *      must carry HttpOnly and SameSite=Strict.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE. `Secure` and the `__Host-` prefix are
 * correct to be ABSENT on the sandbox: store_session_start() sets them from
 * store_is_https(), and a browser MUST reject a __Host- cookie that is not
 * Secure, so forcing them over http would lock the admin out of every local
 * server. The test asserts the http shape on http and says so, rather than
 * asserting a thing that would be wrong here and right in production.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = process.env.SITE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('../', import.meta.url).pathname

let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

/* ---- 1. the directive LiteSpeed does not implement ---------------------- */

const htaccess = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((p) => p.endsWith('.htaccess'))

check(htaccess.length > 0, `found .htaccess files to check (${htaccess.length})`)

/* A DIRECTIVE, not the words. The removal left a long comment explaining what
   was removed and why, and a check that merely grepped for "Header edit" would
   fail on that comment for ever — so it would have been deleted, and with it
   the guard. Only a line whose first non-space token is `Header` counts. */
const offenders = []
for (const rel of htaccess) {
  const lines = readFileSync(ROOT + rel, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (/^\s*Header\s+(always\s+)?edit\*?\s/i.test(line)) offenders.push(`${rel}:${i + 1}`)
  })
}
check(offenders.length === 0,
  `no .htaccess uses "Header edit" — LiteSpeed emits it as a header instead${offenders.length ? ': ' + offenders.join(', ') : ''}`)

/* ---- 2. one door into a session ---------------------------------------- */

const php = execFileSync('git', ['ls-files', '-z', 'sporta-site/public_html'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((p) => p.endsWith('.php'))

const bare = []
for (const rel of php) {
  const src = readFileSync(ROOT + rel, 'utf8')
  src.split('\n').forEach((line, i) => {
    /* COMMENTS ARE NOT CALLS. The first version of this flagged
       orders-print.php:69, which is a line of prose ABOUT session_start()
       inside a // comment — a false positive that would have been silenced by
       loosening the check, i.e. by breaking it. Strip the comment first. */
    const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/#.*$/, '')
    if (!/(^|[^_\w])session_start\s*\(/.test(code)) return
    // store.php's own definition is the one legitimate call site.
    if (rel.endsWith('api/store.php')) return
    bare.push(`${rel}:${i + 1}`)
  })
}
check(bare.length === 0,
  `no file starts a session except store_session_start()${bare.length ? ': ' + bare.join(', ') : ''}`)

const store = readFileSync(ROOT + 'sporta-site/public_html/api/store.php', 'utf8')
const params = store.slice(store.indexOf('function store_session_start'), store.indexOf('function store_session_end'))
check(/'httponly'\s*=>\s*true/.test(params), 'store_session_start sets httponly')
check(/'samesite'\s*=>\s*'Strict'/.test(params), 'store_session_start sets samesite=Strict')
check(/'secure'\s*=>\s*\$secure/.test(params), 'and secure from store_is_https(), not hardcoded')

/* ---- 3. what the real server actually sends ----------------------------- */

const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '--default-character-set=utf8mb4', '-e', q],
    { encoding: 'utf8' }).trim()

/* THE SEEDED ACCOUNT BY NAME, not "whichever is first". The first version took
   `order by id limit 1` and got rig@local — a different account, with a
   different password — so the sign-in 401'd and the three cookie assertions
   failed for a reason that had nothing to do with cookies. sandbox.sh seeds
   this address and this password; ask for them. */
const EMAIL = process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw'
const email = sql(`select email from admin_users where email = '${EMAIL}'`)

if (!email) {
  check(false, `the sandbox has no ${EMAIL} to sign in as — run scripts/sandbox.sh`)
} else {
  const res = await fetch(`${BASE}/api/admin.php?r=login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
    body: JSON.stringify({ email, password: process.env.ADMIN_PASSWORD ?? 'correct horse' }),
  })
  const raw = res.headers.getSetCookie?.() ?? []
  const cookie = raw.find((c) => /sporta_admin=/.test(c)) ?? ''

  check(cookie !== '', `signing in set a session cookie (HTTP ${res.status})`)
  check(/;\s*HttpOnly/i.test(cookie), `it is HttpOnly — "${cookie.slice(0, 60)}"`)
  check(/;\s*SameSite=Strict/i.test(cookie), 'and SameSite=Strict, which is the CSRF defence')
  /* Over http this is the CORRECT shape, and saying so is the point: the same
     code sends __Host- and Secure over https, and asserting those here would
     be asserting a bug. */
  check(!/^__Host-/.test(cookie) && !/;\s*Secure/i.test(cookie),
    'and on plain http it is neither Secure nor __Host- prefixed, as it must not be')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — flags set where the cookie is made, and no rewrite to be ignored')
process.exit(fails ? 1 : 0)
