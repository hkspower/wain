// The review system, against a real MariaDB.
//
// The feature hands out money. That makes the interesting tests the hostile
// ones: an unsigned link, a guessed order number, a customer submitting twenty
// times, and a code being reused after it has been spent. Each of those is a
// way to turn "tell us what you thought" into a discount printer, and each is
// checked here by attacking it rather than by asserting the happy path twice.
//
// It also pins the two POLICY properties, because they are the reason the
// feature is shaped the way it is and a future edit would undo them without
// noticing:
//
//   * one star is paid exactly like five (rewarding only good ratings is
//     review gating — against Google's policy, unlawful in several markets,
//     and it makes the shop's own average meaningless);
//   * nothing about the Google link is conditional on the reward, because
//     paying for a Google review risks the whole Business Profile.
//
//   npm run test:review     (needs MariaDB and php -S :8095 php-store)
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const run = promisify(execFile)
const API = process.env.PHP_BASE ?? 'http://127.0.0.1:8095'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

// --default-character-set=utf8mb4 is NOT optional. The client negotiates its
// own connection charset, and without this it reads a correctly-stored Arabic
// comment back as "??????" — which looks exactly like the data being corrupt
// and is not. The column, the PDO connection and this client all have to agree.
const sql = async (q) =>
  (await run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', q])).stdout.trim()

// ?r=review allows 10 per ten minutes per IP, and this whole suite is one IP
// submitting far more than that on purpose — the concurrency block alone spends
// eight. Clearing the counter between sections keeps each one testing what it
// says it tests; the throttle itself has its own section at the bottom, where
// it is asserted rather than worked around.
const unthrottle = () => run('mariadb', ['sporta', '-e', 'delete from rate_limit'])

// The signature the SHOP would compute. Read from the same config.php the API
// reads, so the test cannot pass against a server using a different key.
const CFG = readFileSync(new URL('../dropin/php-store/config.php', import.meta.url), 'utf8')
const CRON_KEY = /'cron_key'\s*=>\s*'([^']*)'/.exec(CFG)?.[1] ?? ''
const sig = (track) =>
  createHmac('sha256', CRON_KEY).update(`review\0${track}`).digest('hex').slice(0, 32)

const invite = (track, token) =>
  fetch(`${API}/api.php?r=review_invite&o=${encodeURIComponent(track)}&t=${encodeURIComponent(token)}`)

const submit = (track, token, body = {}) =>
  fetch(`${API}/api.php?r=review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track_id: track, token, rating: 5, lang: 'ar', ...body }),
  })

// ?r=review is rate limited and this suite submits in a loop; a counter left
// over from another suite would read as the feature refusing valid reviews.
await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
// A clean slate every run. The suite's orders are its own — SPREVIEW* — so
// this cannot touch a real one, and re-running must not trip over the last run.
await sql("delete from reviews where order_id in (select id from orders where track_id like 'SPREVIEW%')")
await sql("delete from discounts where code like 'SHUKRAN%'")
await sql("delete from orders where track_id like 'SPREVIEW%'")

// Orders to review. Written directly: this suite is about reviews, and going
// through checkout for each one would make a checkout bug look like a review
// bug.
const mkOrder = async (track, fulfilment = 'delivered') => {
  await sql(
    `insert into orders (track_id, customer_name, customer_phone, customer_lang,
                         customer_governorate, customer_area, customer_block,
                         customer_street, customer_building,
                         amount, payment_method, payment_status, fulfilment_status)
     values ('${track}', 'Fatima Al-Sabah', '96599887766', 'ar',
             'hawalli', 'Salmiya', '4', '12', '5',
             21.000, 'knet', 'paid', '${fulfilment}')`,
  )
  return sql(`select id from orders where track_id='${track}'`)
}

// ------------------------------------------------------------- the happy path
head('a customer can review the order they were sent')
{
  const track = 'SPREVIEW001'
  await mkOrder(track)

  const inv = await invite(track, sig(track))
  const d = await inv.json()
  is(inv.status === 200, 'the signed link opens', `${inv.status}`)
  is(d.track_id === track, 'and it is about their order', d.track_id)
  is(d.reviewed === false, 'which has not been reviewed yet')
  // The page must NEVER name its own percentage: what the customer is promised
  // and what checkout applies have to be one number.
  is(d.reward_pct === 20, 'the offer comes from the SERVER, not the page', `${d.reward_pct}%`)

  const res = await submit(track, sig(track), { rating: 5, comment: 'ممتاز، وصل بسرعة' })
  const s = await res.json()
  is(res.status === 200 && s.ok, 'the review is accepted', `${res.status}`)
  is(typeof s.code === 'string' && s.code.startsWith('SHUKRAN'), 'and it earns a code', s.code)

  const row = (await sql(
    `select rating, comment, lang, reward_code from reviews
      where order_id=(select id from orders where track_id='${track}')`)).split('\t')
  is(row[0] === '5', 'the rating is stored', row[0])
  is(row[1] === 'ممتاز، وصل بسرعة', 'the Arabic comment survives intact', row[1])
  is(row[3] === s.code, 'and the code is recorded against the review it paid for')
}

// ------------------------------------------------------ the code is a real one
head('the reward is an ordinary discount code')
{
  const code = await sql("select code from discounts where code like 'SHUKRAN%' limit 1")
  const row = (await sql(
    `select kind, type, value, usage_limit, active, ends_at > now() from discounts where code='${code}'`)).split('\t')
  is(row[0] === 'code', 'it is a code rule, priced by the same engine as every other', row[0])
  is(row[1] === 'percent' && Math.round(Number(row[2])) === 20, 'worth 20%', `${row[2]}`)
  // Single use is what stops one review paying for a year of shopping.
  is(row[3] === '1', 'usable ONCE', row[3])
  is(row[4] === '1', 'and live')
  is(row[5] === '1', 'with an expiry — an open-ended code never ages off the books')
  // Read off a phone and typed in: no O/0, no I/1.
  is(!/[OI01]/.test(code.replace('SHUKRAN', '')), 'no ambiguous characters to mistype', code)
}

// ------------------------------------------------- THE DISCOUNT-PRINTER ATTACK
head('one order buys exactly one code')
{
  const track = 'SPREVIEW002'
  await mkOrder(track)

  // Eight at once, the way a double-tap and a flaky connection actually look.
  const all = await Promise.all(
    Array.from({ length: 8 }, () => submit(track, sig(track), { rating: 4 })),
  )
  const bodies = await Promise.all(all.map((r) => r.json().catch(() => ({}))))
  const codes = new Set(bodies.map((b) => b.code).filter(Boolean))

  is((await sql(
    `select count(*) from reviews where order_id=(select id from orders where track_id='${track}')`)) === '1',
     'EIGHT concurrent submissions leave ONE review', 'the unique index, not the application')
  is(codes.size === 1, 'and ONE code — not eight', `${codes.size} distinct`)
  // Every caller must get an answer they can act on, not a failure.
  is(bodies.every((b) => b.code), 'every submission is answered with that same code')
}

// ----------------------------------------------------------- forged links
await unthrottle()
head('a review link cannot be guessed')
{
  const track = 'SPREVIEW003'
  await mkOrder(track)

  is((await invite(track, '')).status === 404, 'no signature is refused')
  is((await invite(track, 'f'.repeat(32))).status === 404, 'a wrong signature is refused')
  is((await invite(track, sig(track).toUpperCase())).status === 404,
     'and the signature is compared exactly, not case-insensitively')

  // The order number is real and the signature is for a DIFFERENT order.
  is((await invite(track, sig('SPREVIEW001'))).status === 404,
     'a signature from another order does not transfer')

  // Refused at the same status as a non-existent order, so this cannot be used
  // to discover which order numbers exist.
  const ghost = await invite('SPNOSUCHORDER', sig('SPNOSUCHORDER'))
  is(ghost.status === 404, 'a signed link to an order that does not exist is refused too')
  const a = await (await invite(track, 'bad')).json()
  const b = await ghost.json()
  is(a.error === b.error,
     'and "wrong signature" is indistinguishable from "no such order" — no oracle', a.error)

  is((await sql(`select count(*) from reviews where order_id=(select id from orders where track_id='${track}')`)) === '0',
     'none of that wrote a review')
  is((await sql("select count(*) from discounts where code like 'SHUKRAN%'")) === '2',
     'and none of it minted a code', 'still 2, one per real review')
}

// ------------------------------------------------------------- what is refused
await unthrottle()
head('a cancelled order has nothing to review')
{
  const track = 'SPREVIEW004'
  await mkOrder(track, 'cancelled')
  is((await invite(track, sig(track))).status === 404, 'a cancelled order cannot be reviewed')
  is((await submit(track, sig(track))).status === 404, 'and cannot be submitted for one either')
}

await unthrottle()
head('a rating has to be a rating')
{
  const track = 'SPREVIEW005'
  await mkOrder(track)
  for (const r of [0, 6, -1, 99]) {
    const res = await submit(track, sig(track), { rating: r })
    is(res.status === 400, `${r} is refused`, `${res.status}`)
  }
  is((await sql(`select count(*) from reviews where order_id=(select id from orders where track_id='${track}')`)) === '0',
     'and nothing was written while trying')
}

// --------------------------------------------------------------- THE POLICY
await unthrottle()
head('one star is worth exactly what five is')
{
  const track = 'SPREVIEW006'
  await mkOrder(track)
  const s = await (await submit(track, sig(track), { rating: 1, comment: 'التوصيل تأخر يومين' })).json()
  is(s.ok && !!s.code, 'a ONE-STAR review earns a code', s.code)

  const [low, high] = await Promise.all([
    sql(`select value from discounts where code='${s.code}'`),
    sql(`select d.value from discounts d join reviews r on r.reward_code = d.code
          where r.rating = 5 limit 1`),
  ])
  is(Math.round(Number(low)) === Math.round(Number(high)),
     'worth the SAME as a five-star one — rewarding only good ratings is review gating',
     `${low} vs ${high}`)
  is((await sql(`select comment from reviews where order_id=(select id from orders where track_id='${track}')`))
       === 'التوصيل تأخر يومين',
     'and the complaint is kept — it is the most useful row in the table')
}

// ------------------------------------------------------------ coming back
await unthrottle()
head('clicking the link again shows the same code, not a new one')
{
  const track = 'SPREVIEW001'   // reviewed at the top of this file
  const d = await (await invite(track, sig(track))).json()
  is(d.reviewed === true, 'the link says it is already reviewed')
  is(d.rating === 5, 'and remembers what they said', `${d.rating}`)
  const original = await sql(
    `select reward_code from reviews where order_id=(select id from orders where track_id='${track}')`)
  is(d.code === original, 'and hands back the SAME code', d.code)

  const again = await (await submit(track, sig(track), { rating: 1 })).json()
  is(again.already === true && again.code === original,
     'submitting again cannot overwrite the rating or mint a second code')
  is((await sql(`select rating from reviews where order_id=(select id from orders where track_id='${track}')`)) === '5',
     'the original rating stands')
}

// ---------------------------------------------------------------- the throttle
head('the endpoint is rate limited')
{
  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
  let sawLimit = false
  for (let i = 0; i < 40; i++) {
    const res = await submit('SPREVIEWFLOOD', 'nope', { rating: 5 })
    if (res.status === 429) { sawLimit = true; break }
  }
  is(sawLimit, 'a flood of forged submissions is throttled, not just refused one by one')
  await run('mariadb', ['sporta', '-e', 'delete from rate_limit'])
}

// ------------------------------------------------- the invitation, end to end
await unthrottle()
head('marking an order DELIVERED asks the customer for a review')
{
  // The queue is credential-gated (no WhatsApp token, no rows — see
  // store_queue_whatsapp), so this drives the queue function directly through
  // PHP with a config that has one. What is under test is the LINK, which is
  // where a mistake would be invisible until a customer clicked it.
  const track = 'SPREVIEW007'
  const id = await mkOrder(track)

  // Run the SHOP's own implementation and compare. If these two ever disagree
  // the shop sends links its own API refuses, and nothing else in this suite
  // would notice — every other check computes the signature only once.
  const { stdout } = await run('php', [
    '-r', `require 'dropin/php-store/store.php'; echo store_review_sig('${track}');`,
  ]).catch(() => ({ stdout: '' }))
  is(stdout.trim() === sig(track),
     'PHP and this test compute the SAME signature — the link the shop sends is the link the API accepts',
     stdout.trim() ? `${stdout.trim().slice(0, 12)}…` : 'php did not run')

  // And that link actually opens the review page's data.
  const res = await invite(track, stdout.trim() || sig(track))
  is(res.status === 200, 'and it opens', `${res.status}`)
  void id
}

console.log(fails ? `\n${fails} problem(s) in the review system` : '\nreviews: paid for honestly, once per order')
process.exit(fails ? 1 : 0)
