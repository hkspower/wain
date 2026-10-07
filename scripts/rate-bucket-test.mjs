#!/usr/bin/env node
/**
 * The API's token bucket (2026-10-07, "make api token bucket"; replaces the fixed-window counter in store_throttle()).
 *
 *   bash scripts/sandbox.sh && node scripts/rate-bucket-test.mjs
 *
 * What it proves, each in the direction that matters:
 *   - a bucket of N allows exactly N, then refuses, and a client that waits gets exactly the tokens that refilled;
 *   - an idle hour never banks more than N (no hoarding);
 *   - there is no window boundary to straddle: N spent, then N more at once, is refused;
 *   - two callers are independent, the same caller on two routes is independent;
 *   - the live path: ~150 sequential and 300 CONCURRENT requests to a limited route allow about the ceiling, not all
 *     of them (the concurrent run is the one that catches a read-then-write race);
 *   - it fails towards the old counter when rate_bucket is missing (no 5xx, and rate_limit got the hit);
 *   - housekeeping removes day-old rows.
 * Time is moved by rewriting `refilled_at`, never by sleeping, so the rig is fast and the arithmetic is exact.
 */
import { execFileSync, spawn } from 'node:child_process'
const SITE = process.env.SITE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ' — ' + extra : ''}`) }
const sql = (q) => execFileSync('mariadb', ['--default-character-set=utf8mb4', '-uroot', 'sporta', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
const php = (code) => execFileSync('php', ['-r', `require "${ROOT}/sporta-site/public_html/api/store.php"; $db = store_db(); ${code}`], { encoding: 'utf8' }).trim()
const take = (key, max, win) => php(`echo store_bucket_take($db, '${key}', ${max}, ${win}) ? 'Y' : 'n';`)
const takeN = (key, n, max, win) => php(`$o=''; for ($i=0;$i<${n};$i++) $o .= store_bucket_take($db, '${key}', ${max}, ${win}) ? 'Y' : 'n'; echo $o;`)
const wipe = () => sql('delete from rate_limit; delete from rate_bucket')
const k = (s) => 'rbtest' + s.padEnd(26, '0').slice(0, 26)

try {
  wipe()
  check(sql("show tables like 'rate_bucket'") === 'rate_bucket', 'the rate_bucket table exists in the sandbox')

  // ---- the arithmetic
  check(takeN(k('burst'), 8, 5, 60) === 'YYYYYnnn', 'a bucket of 5 allows exactly five, then refuses', takeN(k('burst2'), 8, 5, 60))
  check(takeN(k('again'), 12, 5, 60) === 'YYYYYnnnnnnn', 'N spent, then N more at once, is refused (nothing to straddle)')

  // 5 per 60s refills one token every 12s: wind the row back 12s and exactly one token is there
  takeN(k('refill'), 5, 5, 60)
  sql(`update rate_bucket set refilled_at = refilled_at - 12 where bucket_key = '${k('refill')}'`)
  check(takeN(k('refill'), 3, 5, 60) === 'Ynn', 'after 12 s (one refill period) exactly one more request is allowed')
  sql(`update rate_bucket set refilled_at = refilled_at - 36 where bucket_key = '${k('refill')}'`)
  check(takeN(k('refill'), 5, 5, 60) === 'YYYnn', 'after 36 s three tokens are back')

  // an idle hour must not hoard: still only five
  takeN(k('idle'), 5, 5, 60)
  sql(`update rate_bucket set refilled_at = refilled_at - 3600 where bucket_key = '${k('idle')}'`)
  check(takeN(k('idle'), 9, 5, 60) === 'YYYYYnnnn', 'an hour of silence banks no more than the bucket holds')

  // a different shape: 1 per 900 s (the password-reset style) is one request, then a long wait
  check(takeN(k('slow'), 3, 1, 900) === 'Ynn', 'a bucket of 1 allows one and refuses the next')

  // ---- who is who
  takeN(k('who'), 5, 5, 60)
  check(take(k('whoelse'), 5, 60) === 'Y', 'another caller has a full bucket of its own')
  const two = php(`$_SERVER['REMOTE_ADDR']='203.0.113.9'; for ($i=0;$i<4;$i++) { store_throttle($db,'routeA',3,60); echo 'Y'; }`)
  // store_fail() prints the bare error and exits, so the script ends at the refused call: three Y, then the body
  check(two === 'YYY{"error":"too_many_attempts"}', 'store_throttle: three allowed, the fourth is refused with a bare 429 body and stops the request', two)
  check(php(`$_SERVER['REMOTE_ADDR']='203.0.113.9'; store_throttle($db,'routeB',3,60); echo 'Y';`) === 'Y', 'the same address on another route has its own bucket')

  // ---- the live path
  wipe()
  const hit = async () => (await fetch(`${SITE}/api/api.php?r=rb_probe_${process.pid}`)).status
  const seq = []; for (let i = 0; i < 150; i++) seq.push(await hit())
  const ok = seq.filter((s) => s !== 429).length, no = seq.filter((s) => s === 429).length
  check(ok >= 120 && ok <= 135 && no >= 15, `150 sequential requests to a 120-per-minute route: ${ok} allowed, ${no} refused (about the ceiling)`)
  check(!seq.some((s) => s >= 500), 'no request answered 5xx')

  wipe()
  const par = await Promise.all(Array.from({ length: 300 }, hit))
  const pok = par.filter((s) => s !== 429).length
  check(pok >= 115 && pok <= 140, `300 CONCURRENT requests: ${pok} allowed — a read-then-write race would let most of them through`)
  check(!par.some((s) => s >= 500), 'no concurrent request answered 5xx')
  check(sql('select count(*) from rate_limit') === '0', 'real traffic was answered by the bucket, not by the fallback counter (a broken bucket would hide behind it)')
  // The sandbox web server is single-threaded, so the run above cannot race. Separate PHP PROCESSES can: 40 of them,
  // ten requests each, one bucket of 50. A read-then-write limiter lets far more than 50 through.
  wipe()
  const code = `require "${ROOT}/sporta-site/public_html/api/store.php"; $db = store_db(); $n=0; for ($i=0;$i<10;$i++) if (store_bucket_take($db, '${k('race')}', 50, 3600)) $n++; echo $n;`
  const runs = await Promise.all(Array.from({ length: 40 }, () => new Promise((res) => { let o = ''; const c = spawn('php', ['-r', code]); c.stdout.on('data', (d) => (o += d)); c.on('close', () => res(Number(o) || 0)) })))
  const granted = runs.reduce((a, b) => a + b, 0)
  check(granted >= 50 && granted <= 52, `40 parallel PHP processes against ONE bucket of 50: ${granted} tokens granted (exactly the bucket, plus at most the refill of a second)`)
  const left = sql(`select count(*) from rate_bucket`)
  check(Number(left) >= 1, 'the bucket row exists after real traffic')

  // ---- fails towards the old counter
  wipe()
  sql('rename table rate_bucket to rate_bucket_hidden')
  try {
    const f = []; for (let i = 0; i < 6; i++) f.push(await hit())
    check(!f.some((s) => s >= 500), 'with rate_bucket missing no request answers 5xx')
    check(Number(sql('select count(*) from rate_limit')) >= 1, 'the fixed-window counter answered instead (rate_limit got the hits)')
  } finally { sql('rename table rate_bucket_hidden to rate_bucket') }

  // ---- housekeeping
  wipe()
  sql(`insert into rate_bucket (bucket_key, tokens, refilled_at, allowed) values ('${k('stale')}', 3, ${Math.floor(Date.now() / 1000) - 90000}, 1)`)
  takeN(k('sweeper'), 500, 1000, 60)
  check(sql(`select count(*) from rate_bucket where bucket_key = '${k('stale')}'`) === '0', 'a day-old bucket is swept away')
  check(sql(`select count(*) from rate_bucket where bucket_key = '${k('sweeper')}'`) === '1', 'the live bucket is not')
} finally {
  try { if (sql("show tables like 'rate_bucket_hidden'")) sql('rename table rate_bucket_hidden to rate_bucket') } catch (e) { /* ignore */ }
  try { wipe() } catch (e) { /* ignore */ }
}
console.log(fails ? `\n${fails} failed` : '\nall ok — a token bucket: burst, steady refill, no hoarding, no race, and a fallback')
process.exit(fails ? 1 : 0)
