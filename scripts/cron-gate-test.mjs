/**
 * The seven cron endpoints, asked for by a stranger.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/cron-gate-test.mjs
 *
 * admin-permission-test.mjs walks every route in admin.php and proves one gate
 * stands in front of all of them. Nothing did the same for api/cron-*.php, and
 * those seven are not a quiet corner of the backend:
 *
 *   cron-customer-mail  sends email to customers
 *   cron-whatsapp       sends WhatsApp messages on a paid API
 *   cron-push           sends push notifications
 *   cron-fulfilment     tells the warehouse to ship
 *   cron-assistant      posts conversations to an n8n workflow
 *   cron-voice          ?do=warm synthesises every canned sentence, which is
 *                       two dozen calls to a metered speech vendor
 *   cron-stock          low-stock alerting
 *
 * Their only guard is a key in the query string. That is the right design on
 * this host — it has no shell, so an HTTP URL is the one thing the owner can
 * put in hPanel's cron box — but it means the whole of the shop's outbound
 * messaging sits behind one `hash_equals` per file, seven times, written seven
 * times, with no test on any of them. One file edited without it is a spam
 * cannon and a bill.
 *
 * WHAT IT ASSERTS, and why each one is separate:
 *
 *   NO KEY is refused. The obvious case.
 *   A WRONG KEY is refused. Not the same test: a gate that checks `isset`
 *     rather than the value passes the first and fails this.
 *   AN EMPTY KEY is refused, and this is the one worth spelling out. If the
 *     gate were only `hash_equals($cfg['cron_key'], $given)` then a shop whose
 *     config.php has cron_key => '' — the shipped default — would match the
 *     empty string and open all seven to the world. Every file guards it with
 *     `=== ''` first; this is what says so.
 *   THE RIGHT KEY is accepted, because a gate that refuses everything is not a
 *     gate, it is a broken endpoint, and the four checks above would all pass
 *     on one.
 *
 * It reads the real key out of api/config.php the way otp-test.mjs does, so it
 * is testing the server's own answer and not a fixture's.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const SITE = process.env.SITE_BASE ?? 'http://127.0.0.1:4300'
const CRONS = [
  'cron-assistant', 'cron-customer-mail', 'cron-fulfilment',
  'cron-push', 'cron-stock', 'cron-voice', 'cron-whatsapp',
]

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}

const KEY = execFileSync('php', ['-r',
  'require "api/store.php"; $c = store_config(); echo (string)($c["cron_key"] ?? "");'],
  { cwd: 'sporta-site/public_html', encoding: 'utf8' }).trim()

if (!KEY) {
  console.log('FAIL api/config.php has no cron_key — every endpoint below would 403 for the owner too')
  process.exit(1)
}

const hit = async (path) => {
  const r = await fetch(`${SITE}/api/${path}`, { redirect: 'manual' })
  return { status: r.status, text: (await r.text().catch(() => '')).slice(0, 120) }
}

console.log(`--- the gate, seven times over\n`)
for (const c of CRONS) {
  // cron-voice defaults to `do=status`, which reads the cache and buys
  // nothing; the others do their work on a bare hit. Neither matters here —
  // what is being asked is whether the door opens at all.
  const none = await hit(`${c}.php`)
  const wrong = await hit(`${c}.php?key=not-the-key`)
  const empty = await hit(`${c}.php?key=`)

  check(none.status === 403, `${c}: no key at all is refused (${none.status})`, none.text)
  check(wrong.status === 403, `${c}: a wrong key is refused (${wrong.status})`, wrong.text)
  check(empty.status === 403, `${c}: an empty key is refused (${empty.status})`, empty.text)

  // THE EMPTY-CONFIGURED-KEY CASE, ASKED OF THE SOURCE RATHER THAN THE SERVER.
  //
  // The danger is a shop whose config.php still has cron_key => '' — the
  // shipped default — where a gate written as hash_equals($cfg['cron_key'],
  // $given) alone would match the empty string a stranger sends and open all
  // seven. Every file guards it with `=== ''` first.
  //
  // That cannot be driven from here: this sandbox's key is
  // SANDBOX_NOT_A_REAL_CRON_KEY, so hash_equals is false against '' whether
  // the guard is present or not. Measured — deleting the guard from
  // cron-stock.php changed nothing above, and the line over the request was
  // reporting a property it was not testing.
  //
  // So it is asked of the file. A static check that names the missing guard
  // is worth more than a live one that cannot fail.
  const src = readFileSync(new URL(`../sporta-site/public_html/api/${c}.php`, import.meta.url), 'utf8')
  check(/\(\$cfg\['cron_key'\] \?\? ''\) === ''\s*\|\|/.test(src),
    `${c}: refuses outright when cron_key is unset, before comparing anything`,
    'an unset key would match the empty string a stranger sends')
}

console.log('')
for (const c of CRONS) {
  const ok = await hit(`${c}.php?key=${encodeURIComponent(KEY)}`)
  // NOT a 403, rather than a 200: cron-whatsapp with no token configured, or
  // cron-voice with no voice, answers with its own "not configured" — which is
  // correct and is not the gate. The only thing being asserted is that the
  // right key gets past the door.
  check(ok.status !== 403,
    `${c}: the real key is let through (${ok.status})`,
    'the owner would be locked out of their own cron')
  // AND AN UNCONFIGURED FEATURE IS 503, NOT 500. The sandbox has no WhatsApp
  // token, no VAPID pair, no warehouse address and no n8n webhook, so four of
  // these answer "not set in config.php" — which is correct, and is not a
  // fault. It used to be reported as 500: "this server broke", which is what a
  // monitor pages someone for at three in the morning, and what an owner
  // halfway through their setup would read as the shop being down.
  // cron-voice.php already answered 503 for the same condition.
  if (/not set in config\.php|not configured/i.test(ok.text)) {
    check(ok.status === 503,
      `${c}: "not configured yet" is 503, not a 500 that reads as a breakage`,
      `got ${ok.status}`)
  }
}

console.log(fails ? `\n${fails} failed` : '\nall ok — seven endpoints, one gate each, and it holds')
process.exit(fails ? 1 : 0)
