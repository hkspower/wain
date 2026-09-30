/**
 * Does the backend run without PHP complaining?
 *
 *   bash scripts/sandbox.sh
 *   node scripts/php-runtime-test.mjs
 *
 * scan:php reads the source for constructs PHP has already deprecated. That is
 * a static question and it cannot see the other half: what actually goes wrong
 * while the code RUNS. Those are different faults with different causes —
 * an undefined array key, a null passed where a string was wanted, a division
 * that should not have happened — and none of them appears in a grep.
 *
 * The sandbox has always been started with error_reporting=E_ALL and a log at
 * /tmp/php-strict.log. Nothing ever read it. This does: it truncates the log,
 * drives every endpoint the backend has, and asserts PHP said nothing.
 *
 * WHAT IT FOUND ON ITS FIRST RUN, and why the class is worth a rig:
 *
 *   PHP Warning: Undefined array key "language" in knet/pay.php on line 31
 *
 * The KNET dropin picks the bank's language from the config. Two of its three
 * branches fell back with ??; the third — the DEFAULT, which fires whenever
 * the storefront sends no ?lang= — read the key raw. `language` was added to
 * config.example.php after the dropin shipped, so a shop whose config.php
 * predates it has no such key, the expression evaluates to '', and an EMPTY
 * language field is encrypted into the trandata and handed to the bank.
 *
 * That is a card payment the bank may refuse, for a reason that exists only in
 * a log file on a host with no shell. A warning is not cosmetic when the thing
 * it warns about is a payment.
 *
 * WHY IT IS ALLOWED TO BE STRICT. A PHP notice on this backend is never
 * harmless, because every endpoint answers JSON: anything printed before
 * store_out() corrupts the response, and anything printed after it is
 * appended to valid JSON and breaks the parse at the other end. The shop's
 * own config sets display_errors off, so in production the damage is silent
 * rather than absent.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const LOG = process.env.PHP_LOG ?? '/tmp/php-strict.log'
const SITE = process.env.SITE_BASE ?? 'http://127.0.0.1:4300'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? `\n${extra}` : ''}`)
  return ok
}

if (!check(existsSync(LOG), `the sandbox is logging to ${LOG}`,
  '       start it with scripts/sandbox.sh, which sets error_reporting=E_ALL')) {
  process.exit(1)
}

// Clear the counters first: several routes below are throttled, and a 429 is
// the rig meeting its own defence rather than the code being exercised.
try {
  execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-e', 'delete from rate_limit'],
    { stdio: 'ignore' })
} catch { /* not the sandbox database */ }

writeFileSync(LOG, '')

// EVERY PUBLIC ROUTE, plus the payment dropins and the crons. The point is
// COVERAGE, not correctness — a 400 or a 403 exercises the code that produced
// it just as well as a 200, and often exercises more of it.
const KEY = (() => {
  try {
    return execFileSync('php', ['-r',
      'require "api/store.php"; $c = store_config(); echo (string)($c["cron_key"] ?? "");'],
      { cwd: 'sporta-site/public_html', encoding: 'utf8' }).trim()
  } catch { return '' }
})()

const track = (() => {
  try {
    return execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-B',
      '-e', 'select track_id from orders order by id desc limit 1'], { encoding: 'utf8' }).trim()
  } catch { return 'SPNOSUCHORDER' }
})()

const PUBLIC_ROUTES = [
  'products', 'stock', 'brands', 'slides', 'contact', 'size_chart',
  `status&id=${track}`, `invoice&id=${track}`, `return_items&id=${track}`,
  'product_image&id=1', 'brand_logo&slug=sporta', 'slide_image&id=1',
  'review&t=nope', 'review_invite&t=nope', 'say&t=hi&lang=en&v=nope',
  'assistant', 'order', 'return_request', 'size_advice', 'discount&code=NOPE',
]

const urls = [
  ...PUBLIC_ROUTES.map((r) => `${SITE}/api/api.php?r=${r}`),
  // The dropins, over "https" so they get past knet_require_https().
  `${SITE}/knet/pay.php?trackid=${track}`,
  `${SITE}/knet/pay.php?trackid=${track}&lang=ar`,
  // NO ?lang= AT ALL — the branch that produced the warning this file was
  // written for. Worth its own line, and worth a comment saying so, because it
  // is the case a rig driving the happy path never reaches.
  `${SITE}/knet/pay.php?trackid=${track}&lang=`,
  `${SITE}/pay/pay.php?trackid=${track}`,
  `${SITE}/knet/callback.php?trandata=NOTHEX`,
  `${SITE}/pay/callback.php?ErrorCode=TIJ0020&PayTrackID=${track}`,
  `${SITE}/pay/callback.php?encrp=nope`,
  ...['assistant', 'customer-mail', 'fulfilment', 'push', 'stock', 'voice', 'whatsapp']
    .map((c) => `${SITE}/api/cron-${c}.php?key=${encodeURIComponent(KEY)}`),
  // The admin, signed out — every route behind the gate, which exercises the
  // gate itself on each one.
  `${SITE}/api/admin.php?r=me`,
  `${SITE}/api/admin.php?r=orders`,
]

for (const u of urls) {
  await fetch(u, { redirect: 'manual', headers: { 'X-Forwarded-Proto': 'https' } })
    .then((r) => r.text().catch(() => ''))
    .catch(() => {})
}

// The log is written by the PHP worker, not by us; give it a moment to land.
await new Promise((r) => setTimeout(r, 400))

const raw = readFileSync(LOG, 'utf8').trim()
const lines = raw ? raw.split('\n') : []

// Group identical diagnostics: one bug hit forty times is one bug, and forty
// lines of the same warning is a wall a reader skips.
const seen = new Map()
for (const l of lines) {
  const m = l.match(/PHP (Warning|Notice|Deprecated|Fatal error|Parse error|Recoverable[^:]*):\s*(.*)$/)
  if (!m) continue
  const key = `${m[1]}: ${m[2]}`
  seen.set(key, (seen.get(key) ?? 0) + 1)
}

console.log(`--   ${urls.length} requests driven`)
check(seen.size === 0,
  `PHP said nothing while the backend ran (${lines.length} log lines)`,
  [...seen.entries()].map(([k, n]) => `       ${String(n).padStart(3)}x  ${k}`).join('\n'))

console.log(fails ? `\n${fails} failed` : '\nall ok — no warnings, no notices, no deprecations at runtime')
process.exit(fails ? 1 : 0)
