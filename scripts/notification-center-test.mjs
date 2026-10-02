/**
 * The /backends notification centre. node scripts/notification-center-test.mjs (sandbox on :4300)
 * Plants ONE order, reads the bell, opens it, and puts the database back.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '-e', q], { encoding: 'utf8' }).trim()
const TRACK = 'SPNOTIFRIG1'
const savedSeen = sql("select quote(value) from settings where name='notif_seen'") || null
const cleanup = () => {
  sql(`delete from orders where track_id in ('${TRACK}','SPNOTIFRIG2')`)
  if (savedSeen !== null) sql(`insert into settings (name,value) values ('notif_seen', ${savedSeen}) on duplicate key update value=${savedSeen}`)
  else sql("delete from settings where name='notif_seen'")
}
cleanup()
sql("delete from settings where name='notif_seen'")
sql(`insert into orders (track_id, amount, payment_status, payment_method, customer_name, customer_phone, created_at) values ('${TRACK}', 12.5, 'failed', 'knet', 'Notif Rig', '55512345', now())`)

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const posts = []
const login = async (vp, touch) => {
  const p = await (await b.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })).newPage()
  p.on('request', (r) => { if (r.method() === 'POST' && /notifications_read/.test(r.url())) posts.push(r.url()) })
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  const before = await p.locator('[data-sporta-notif]').count()
  await p.locator('input').nth(0).fill('manager@sporta.com.kw')
  await p.locator('input').nth(1).fill('correct horse')
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(3500)
  return { p, before }
}
try {
  const { p, before } = await login({ width: 1280, height: 800 }, false)
  check(before === 0, 'no bell on the sign-in screen')
  const bell = p.locator('[data-sporta-notif] .spnc-btn')
  check(await bell.count() === 1, 'the bell appears once signed in')
  await p.waitForTimeout(800)
  const badge = p.locator('.spnc-badge')
  check(await badge.isVisible() && Number(await badge.innerText()) >= 1, 'the badge counts the planted failed payment', await badge.innerText())
  await bell.click()
  await p.waitForTimeout(1200)
  const panel = p.locator('.spnc-panel')
  const text = await panel.innerText()
  check(await panel.isVisible() && text.includes('New order ' + TRACK) && text.includes('Payment failed ' + TRACK), 'opening it lists the order and the failed payment', text.slice(0, 120).replace(/\n/g, ' | '))
  check(posts.length >= 1, 'opening it marks everything read (POST notifications_read)')
  check(!(await badge.isVisible()), 'and the badge clears')
  const api = await p.evaluate(async () => (await fetch('/api/admin.php?r=notifications', { headers: { 'X-Sporta-Admin': '1' }, credentials: 'include' })).json())
  check(api.unread === 0, 'the server now reports nothing unread', 'unread=' + api.unread)
  await new Promise((r) => setTimeout(r, 1100))
  sql("insert into orders (track_id, amount, payment_status, payment_method, customer_name, customer_phone, created_at) values ('SPNOTIFRIG2', 3, 'pending', 'cod', 'Later', '55512345', now())")
  const api2 = await p.evaluate(async () => (await fetch('/api/admin.php?r=notifications', { headers: { 'X-Sporta-Admin': '1' }, credentials: 'include' })).json())
  check(api2.unread === 1, 'an order placed AFTER opening it is the one unread item', 'unread=' + api2.unread)
  sql("delete from orders where track_id='SPNOTIFRIG2'")
  await p.keyboard.press('Escape')
  check(!(await panel.isVisible()), 'Escape closes it')
  await bell.click(); await p.waitForTimeout(500)
  await p.locator('.spnc-row', { hasText: 'New order ' + TRACK }).first().click()
  await p.waitForTimeout(1500)
  check(!(await panel.isVisible()) && (await p.locator('.admin-content h1').first().innerText()).trim() === 'Orders', 'tapping a line closes it and opens Orders', await p.locator('.admin-content h1').first().innerText())
  // The panel must not print HTML from data.
  sql(`update orders set customer_name='<img src=x onerror=window.__x=1>' where track_id='${TRACK}'`)
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  await p.locator('[data-sporta-notif] .spnc-btn').click(); await p.waitForTimeout(800)
  check(await p.evaluate(() => !window.__x && !document.querySelector('.spnc-panel img')), 'a customer name with markup is shown as text, not run')

  // Phone: the bell must not sit on top of the header's own buttons.
  const { p: m } = await login({ width: 390, height: 844 }, true)
  const bb = await m.locator('[data-sporta-notif] .spnc-btn').boundingBox()
  const so = await m.getByRole('button', { name: 'Sign out' }).first().boundingBox()
  const overlap = bb && so && bb.x < so.x + so.width && bb.x + bb.width > so.x && bb.y < so.y + so.height && bb.y + bb.height > so.y
  check(!!bb && !overlap && bb.width >= 44 && bb.height >= 44, 'phone: the bell is 44px and clear of Sign out', JSON.stringify(bb))
  await m.locator('[data-sporta-notif] .spnc-btn').click(); await m.waitForTimeout(600)
  const pb = await m.locator('.spnc-panel').boundingBox()
  check(!!pb && pb.x >= 0 && pb.x + pb.width <= 390, 'phone: the list fits inside the screen', JSON.stringify(pb))
  console.log(fails ? `${fails} failed` : 'all ok')
} finally {
  cleanup()
  await b.close()
}
process.exit(fails ? 1 : 0)
