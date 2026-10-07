// npm run test:live-tracking — live order tracking (2026-10-04): per-step times, the carrier link, the
// driver page and map, the auto-updating /track page, and the panel card. Sandbox on :4300.
//
// Plants its own orders (SPLIVERIG*), signs in as the sandbox admin, drives the real routes and a real
// browser (a phone context with a granted, faked geolocation for the driver page), and removes
// everything it made. Expected values come from the database and the API, never from the overlays.
import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
let fails = 0
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d && !ok ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
const clean = () => { sql("delete from orders where track_id like 'SPLIVERIG%'"); sql('delete from rate_limit; delete from rate_bucket') }

// ---- admin session (cookie jar by hand: fetch keeps none)
let cookie = ''
async function admin(route, body) {
  const r = await fetch(`${BASE}/api/admin.php?r=${route}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined })
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]
  return { status: r.status, json: await r.json().catch(() => null) }
}
const status = async (id) => (await fetch(`${BASE}/api/api.php?r=status&id=${id}`)).json()

clean()
sql("insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, customer_area, created_at, paid_at) values ('SPLIVERIG1', 12.5, 'paid', 'knet', 'unfulfilled', 'Live Rig', '96555512345', 'Salmiya', now() - interval 1 day, now() - interval 1 day), ('SPLIVERIG2', 9, 'pending', 'cod', 'unfulfilled', 'Live Rig Two', '96555512346', 'Hawalli', now(), null)")
const id1 = Number(sql("select id from orders where track_id='SPLIVERIG1'"))
const id2 = Number(sql("select id from orders where track_id='SPLIVERIG2'"))
const b = await chromium.launch({ executablePath: CHROME })
try {
  // ---- A. the schema the code now writes to
  check(sql("show columns from orders like 'shipped_at'") !== '' && sql("show tables like 'order_location'") !== '', 'A1 the migration is applied (orders.shipped_at, order_location)')
  check(/packed.*delivered/.test(sql("select check_clause from information_schema.check_constraints where constraint_name='wa_kind_ck'")), 'A2 whatsapp_outbox accepts packed and delivered kinds')

  // ---- B. steps carry their own time; the gate holds
  const lg = await admin('login', { email: 'manager@sporta.com.kw', password: 'correct horse' })
  check(lg.status === 200, 'B0 signed in as the sandbox admin', String(lg.status))
  let r = await admin('fulfilment', { order_id: id1, status: 'packed' })
  check(r.status === 200 && sql(`select packed_at is not null from orders where id=${id1}`) === '1', 'B1 marking packed stamps packed_at')
  r = await admin('fulfilment', { order_id: id1, status: 'shipped' })
  const shippedAt = sql(`select shipped_at from orders where id=${id1}`)
  check(r.status === 200 && shippedAt !== '' && sql(`select packed_at is not null from orders where id=${id1}`) === '1', 'B2 marking shipped stamps shipped_at and keeps packed_at')
  await new Promise((s) => setTimeout(s, 1100))
  await admin('fulfilment', { order_id: id1, status: 'packed' }); await admin('fulfilment', { order_id: id1, status: 'shipped' })
  check(sql(`select shipped_at from orders where id=${id1}`) === shippedAt, 'B3 re-marking an order does not move the time it first left')
  let st = await status('SPLIVERIG1')
  check(st.packed_at && st.shipped_at === shippedAt && st.location === null && st.courier_url === null, 'B4 ?r=status carries both times, no carrier and no position yet', JSON.stringify(st))
  check(!Object.keys(st).some((k) => /customer|phone|email|address|area|street|^id$|^lat$|^lng$|accuracy_m/.test(k)), 'B5 and still no personal data or raw coordinates', Object.keys(st).join(','))
  const noAuth = await fetch(`${BASE}/api/admin.php?r=courier`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, body: JSON.stringify({ order_id: id1, courier: 'own' }) })
  const noAuth2 = await fetch(`${BASE}/api/admin.php?r=driver_link&order_id=${id1}`, { headers: { 'X-Sporta-Admin': '1' } })
  check(noAuth.status === 401 && noAuth2.status === 401, 'B6 courier and driver_link refuse a visitor without a session', `${noAuth.status} ${noAuth2.status}`)

  // ---- C. the carrier
  r = await admin('courier', { order_id: id1, courier: 'evil', courier_ref: 'ABC123' })
  check(r.status !== 200 && r.json?.error === 'invalid_courier', 'C1 a carrier not on the list is refused by name', JSON.stringify(r))
  r = await admin('courier', { order_id: id1, courier: 'aramex', courier_ref: 'ABC 123;drop' })
  check(r.status !== 200 && r.json?.error === 'invalid_courier_ref', 'C2 a tracking number with odd characters is refused', JSON.stringify(r))
  r = await admin('courier', { order_id: id1, courier: 'aramex', courier_ref: '4219-0001' })
  st = await status('SPLIVERIG1')
  check(r.status === 200 && st.courier === 'aramex' && st.courier_url === 'https://www.aramex.com/track/results?ShipmentNumber=4219-0001' && st.courier_name?.ar === 'أرامكس', 'C3 a carrier and number become the carrier\'s tracking link on ?r=status', JSON.stringify([st.courier, st.courier_url]))
  r = await admin('courier', { order_id: id1, courier: 'own', courier_ref: '' })
  st = await status('SPLIVERIG1')
  check(r.status === 200 && st.courier === 'own' && st.courier_url === null, 'C4 the shop\'s own driver has no carrier page')

  // ---- D. the driver link and positions
  r = await admin(`driver_link&order_id=${id1}`)
  check(r.status === 200 && /^\/api\/driver\.php\?o=SPLIVERIG1&t=[0-9a-f]{32}$/.test(r.json?.path || '') && r.json.usable === true, 'D1 /backends mints a signed driver link for an order on its way', JSON.stringify(r.json))
  const path = r.json.path
  const bad = path.replace(/t=[0-9a-f]{32}$/, 't=' + '0'.repeat(32))
  const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  check((await post(bad, { lat: 29.37, lng: 47.97 })).status === 403, 'D2 a forged signature is refused')
  check((await post(path, { lat: 0, lng: 0 })).status === 400 && (await post(path, { lat: 95, lng: 47 })).status === 400, 'D3 an impossible position is refused')
  let p = await post(path, { lat: 29.375900, lng: 47.977400, acc: 12 })
  check(p.status === 200 && sql(`select concat(lat,',',lng,',',accuracy_m) from order_location where order_id=${id1}`) === '29.375900,47.977400,12', 'D4 a position is stored, one row per order')
  p = await post(path, { lat: 29.380000, lng: 47.980000, acc: 8 })
  check(p.status === 200 && sql(`select count(*) from order_location where order_id=${id1}`) === '1' && sql(`select lat from order_location where order_id=${id1}`) === '29.380000', 'D5 a newer position overwrites rather than adds')
  st = await status('SPLIVERIG1')
  check(st.location && st.location.lat === 29.38 && st.location.lng === 47.98 && st.location.accuracy_m === 8 && st.location.age_sec <= 5, 'D6 ?r=status shows the position while the order is on its way', JSON.stringify(st.location))
  sql(`update order_location set updated_at = now() - interval 31 minute where order_id=${id1}`)
  st = await status('SPLIVERIG1')
  check(st.location === null, 'D7 a position older than 30 minutes is not shown')
  sql(`update order_location set updated_at = now() where order_id=${id1}`)
  const g = await fetch(`${BASE}${path}`)
  const html = await g.text()
  check(g.status === 200 && /data-valid="1"/.test(html) && /driver\.js/.test(html) && !/<script>[^<]+<\/script>/.test(html) && !/Live Rig|Salmiya|555123/.test(html), 'D8 the driver page is served with no inline script and no customer data')
  const gb = await fetch(`${BASE}${bad}`)
  check(gb.status === 200 && /data-valid="0"/.test(await gb.text()), 'D9 a forged link gets the "not valid" page')
  // the driver page in a phone browser with a granted location
  const ctx = await b.newContext({ ...devices['Pixel 7'], geolocation: { latitude: 29.33, longitude: 47.95, accuracy: 20 }, permissions: ['geolocation'] })
  const dp = await ctx.newPage()
  await dp.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await dp.click('.drv-start'); await dp.waitForTimeout(2500)
  const sent = sql(`select concat(lat,',',lng) from order_location where order_id=${id1}`)
  const stText = await dp.textContent('.drv-status')
  check(sent === '29.330000,47.950000' && /المشاركة فعّالة|Sharing/.test(stText || ''), 'D10 pressing "Start sharing" on the phone sends its position and says so', `${sent} | ${stText}`)
  await dp.click('.drv-stop'); await dp.waitForTimeout(800)
  check(sql(`select count(*) from order_location where order_id=${id1}`) === '0', 'D11 "Stop sharing" removes the position')
  await ctx.close()
  await post(path, { lat: 29.38, lng: 47.98, acc: 8 })

  // ---- E. the customer's /track page: times, carrier/map, and it updates by itself
  const c2 = await b.newContext({ ...devices['iPhone 13'] })
  const tp = await c2.newPage()
  const statusCalls = []
  tp.on('request', (q) => { if (/r=status/.test(q.url())) statusCalls.push(Date.now()) })
  await tp.goto(`${BASE}/track?lang=en`, { waitUntil: 'networkidle' }); await tp.waitForTimeout(800)
  await tp.locator('main form input').first().fill('SPLIVERIG1'); await tp.locator('main form button').first().click()
  await tp.waitForTimeout(2500)
  let seen = await tp.evaluate(() => { const bx = document.querySelector('[data-order-progress]'); return bx ? { s: bx.getAttribute('data-op-state'), t: bx.innerText, map: !!bx.querySelector('.leaflet-container'), tiles: document.querySelectorAll('.leaflet-tile').length, live: !!bx.querySelector('.op-live') } : null })
  check(seen && seen.s === 'shipped' && /Packed[\s\S]*Oct|Packed[\s\S]*\d{1,2}:\d{2}/.test(seen.t), 'E1 the track page shows the order on the way with a time on the packed step', seen && seen.t.replace(/\n/g, ' | ').slice(0, 160))
  check(seen && seen.map && seen.live, 'E2 the shop\'s own driver shows as a live map', JSON.stringify(seen && { map: seen.map, live: seen.live }))
  // the order moves on while the page is open: it must notice without a reload
  const before = statusCalls.length
  await admin('fulfilment', { order_id: id1, status: 'delivered' })
  await tp.waitForTimeout(12000)
  seen = await tp.evaluate(() => { const bx = document.querySelector('[data-order-progress]'); return bx ? { s: bx.getAttribute('data-op-state'), map: !!bx.querySelector('.leaflet-container') } : null })
  check(statusCalls.length > before, 'E3 the page re-asks the status by itself while the order is moving', `${statusCalls.length - before} calls in 12s`)
  check(seen && seen.s === 'delivered' && !seen.map, 'E4 …and shows "Delivered" with the map gone, without a reload', JSON.stringify(seen))
  check(sql(`select count(*) from order_location where order_id=${id1}`) === '0', 'E5 delivering an order deletes the driver position')
  const after = statusCalls.length; await tp.waitForTimeout(11000)
  check(statusCalls.length === after, 'E6 a delivered order is not polled any more', `${statusCalls.length - after} extra calls`)
  check((await post(path, { lat: 29.38, lng: 47.98 })).status === 410, 'E7 the driver link stops working once the order is delivered')
  // a carrier order: the link
  await admin('fulfilment', { order_id: id2, status: 'shipped' }); await admin('courier', { order_id: id2, courier: 'dhl', courier_ref: 'JD014600003' })
  await tp.locator('main form input').first().fill('SPLIVERIG2'); await tp.locator('main form button').first().click(); await tp.waitForTimeout(2500)
  const link = await tp.evaluate(() => { const a = document.querySelector('[data-order-progress] .op-courier-link'); return a ? [a.textContent, a.href, a.target] : null })
  check(link && link[0] === 'DHL' && /dhl\.com.*JD014600003/.test(link[1]) && link[2] === '_blank', 'E8 a carrier order links to the carrier\'s tracking page in a new tab', JSON.stringify(link))
  await c2.close()

  // ---- F. the panel card on the Orders screen
  const c3 = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await c3.addInitScript(() => { try { localStorage.setItem('lang', 'en') } catch (e) {} })
  const pp = await c3.newPage()
  await pp.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await pp.fill('input[autocomplete="username"]', 'manager@sporta.com.kw'); await pp.fill('input[type=password]', 'correct horse'); await pp.press('input[type=password]', 'Enter')
  await pp.waitForTimeout(2500)
  const ordersBtn = pp.locator('aside button, nav button', { hasText: /^Orders$/ }).first()
  await ordersBtn.evaluate((x) => x.click()); await pp.waitForTimeout(3000)
  const card = await pp.evaluate(() => { const c = document.querySelector('[data-sporta-tracking]'); if (!c) return null; const row = c.querySelector(`.otp-row[data-order-id]`); return { rows: c.querySelectorAll('.otp-row').length, hasRig2: !!c.querySelector('.otp-row b') && [...c.querySelectorAll('.otp-row b')].some((b) => b.textContent === 'SPLIVERIG2'), first: row && row.querySelector('.otp-courier') && row.querySelector('.otp-courier').value } })
  check(card && card.rows >= 1 && card.hasRig2, 'F1 the Live tracking card lists the order on its way', JSON.stringify(card))
  const rigRow = pp.locator('.otp-row').filter({ hasText: 'SPLIVERIG2' })
  await rigRow.locator('.otp-courier').selectOption('own'); await rigRow.locator('.otp-ref').fill(''); await rigRow.locator('.otp-btn').first().evaluate((x) => x.click()); await pp.waitForTimeout(1200)
  check(sql(`select coalesce(courier,'-') from orders where id=${id2}`) === 'own', 'F2 saving the carrier from the card writes the order')
  await rigRow.locator('.otp-link').evaluate((x) => x.click()); await pp.waitForTimeout(1200)
  const url = await rigRow.locator('.otp-url').inputValue().catch(() => '')
  check(/^https:\/\/www\.sporta\.com\.kw\/api\/driver\.php\?o=SPLIVERIG2&t=[0-9a-f]{32}$/.test(url), 'F3 the card mints the driver link for the shop\'s own delivery', url)
  await c3.close()
} finally {
  await b.close()
  clean()
}
console.log(fails ? `\n${fails} failed` : '\nall ok — live tracking: times, carrier, driver map, self-updating page, panel card')
process.exit(fails ? 1 : 0)
