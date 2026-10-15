/**
 * test:track-polling — how /track asks for an order's status (assets/order-progress.js, 2026-10-15).
 *
 *   A  after a failed request (here a 500) it tries again, with growing gaps, and recovers
 *      (it used to stop for good: the fired timer's id was never cleared)
 *   B  every ~10 s while the order is moving
 *   C  an order that has not changed for 5 minutes is asked once a minute, and after an hour
 *      not at all (an abandoned "pending" order was asked every 10 s for ever)
 * Uses Playwright's fake clock, so an hour takes a second. Run `bash scripts/sandbox.sh` first.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const TRACK = 'SPPOLL' + Date.now().toString(36).toUpperCase().slice(-5)
const SLUG = sql("select slug from products where active = 1 order by id limit 1")

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
try {
  sql('delete from rate_limit; delete from rate_bucket')
  const placed = await (await fetch(`${BASE}/api/api.php?r=order`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ track_id: TRACK, items: [{ slug: SLUG, qty: 1 }], payment_method: 'cod', lang: 'en',
      customer: { name: 'Poll Rig', phone: '58' + String(Date.now()).slice(-6), email: 'p@example.com', governorate: 'capital', area: 'Salmiya', block: '1', street: 'One', building: '1' } }) })).json()
  check(!!placed.order_id, 'an order to track', JSON.stringify(placed).slice(0, 80))

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const p = await ctx.newPage()
  await p.clock.install()
  let mode = 'pass'
  const calls = []
  await p.route(/r=status/, async (route) => {
    calls.push({ t: await p.evaluate(() => Date.now()).catch(() => 0), mode })
    if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"failed"}' })
    return route.continue()
  })
  await p.goto(`${BASE}/track?lang=en`, { waitUntil: 'networkidle' })
  await p.locator('main form input').first().fill(TRACK)
  await p.locator('main form button').first().click()
  await p.clock.runFor(3000)
  await p.waitForSelector('[data-order-progress]', { timeout: 10000 })
  const count = () => calls.length
  // In steps no longer than the interval being measured, with a real pause after each: the
  // request itself takes real time, and the next timer is only set once it has answered.
  const window = async (ms, step = 10000) => {
    const n = count()
    for (let done = 0; done < ms; done += step) { await p.clock.runFor(Math.min(step, ms - done)); await p.waitForTimeout(120) }
    return count() - n
  }

  // B
  const b = await window(60000)
  check(b >= 5 && b <= 7, 'B about every 10 s while the order is moving', `${b} in a minute`)

  // A
  mode = 'fail'
  const failing = await window(120000)
  mode = 'pass'
  const back = await window(130000)
  check(failing >= 2 && failing <= 5, 'A while failing it keeps trying, with growing gaps', `${failing} tries in 2 minutes`)
  check(back >= 1, 'A it recovers once the server answers again', `${back} in the next ~2 minutes`)

  // C — nothing changes in the order from here on
  await window(6 * 60000, 10000)
  const slow = await window(5 * 60000)
  check(slow >= 3 && slow <= 7, 'C after 5 quiet minutes, about once a minute', `${slow} in 5 minutes`)
  await window(70 * 60000, 60000)
  const none = await window(10 * 60000, 60000)
  check(none === 0, 'C after an hour with no change, it stops asking', `${none} in 10 minutes`)
  await ctx.close()
} finally {
  await browser.close()
  const id = sql(`select ifnull(max(id), 0) from orders where track_id = '${TRACK}'`)
  if (+id) {
    for (const t of ['order_items', 'fulfilment_outbox', 'customer_mail_outbox', 'whatsapp_outbox', 'push_outbox', 'order_location']) sql(`delete from ${t} where order_id = ${id}`)
    sql(`delete from orders where id = ${id}`)
  }
  sql('delete from rate_limit; delete from rate_bucket')
  console.log(fails ? `\n${fails} FAILED` : '\nall track-polling checks passed')
  process.exitCode = fails ? 1 : 0
}
