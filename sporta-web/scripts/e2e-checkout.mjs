// End-to-end checkout test: a real browser driving the real form against a
// real PostgreSQL, with create_order and its RLS boundary genuinely executing.
//
// It needs three things running (see scripts/test-postgrest-shim.mjs):
//   1. PostgreSQL on :5433 with schema.sql + admin-migration.sql +
//      checkout-migration.sql loaded and the products table seeded;
//   2. `node scripts/test-postgrest-shim.mjs` on :8130 — a PostgREST
//      stand-in that runs SQL as the anon role;
//   3. the built dist/ served on :8188, built with
//      VITE_SUPABASE_URL=http://127.0.0.1:8130 and
//      VITE_PAY_BASE_URL pointed at a stub standing in for the bank.
//
// The point of the real database is that the bug this checkout was built to
// fix — INSERT ... RETURNING blocked by a missing SELECT policy — is invisible
// to a hand-written mock. A mock would have passed the whole time.

import { chromium } from 'playwright'

const B = { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
            args: ['--host-resolver-rules=MAP www.sporta.com.kw 127.0.0.1:8188', '--no-proxy-server'] }
const browser = await chromium.launch(B)
const results = []
const ok = (n, pass, extra = '') => { results.push([n, pass, extra]); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${extra ? ' — ' + extra : ''}`) }

async function shop(lang = 'en') {
  const c = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  await c.addInitScript((l) => localStorage.setItem('lang', l), lang)
  const p = await c.newPage()
  p.on('console', (m) => m.type() === 'error' && console.log('   [console.error]', m.text()))
  await p.goto('http://www.sporta.com.kw/shop', { waitUntil: 'networkidle' })
  return { c, p }
}
const addFirst = async (p) => {
  await p.locator('button[aria-label*=" — "]').first().click()
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]').length > 0)
}

const fill = async (p, f) => {
  for (const [k, v] of Object.entries(f)) {
    const el = p.locator(`#f-${k}`)
    if (k === 'governorate') await el.selectOption(v)
    else await el.fill(v)
  }
}
const GOOD = { name: 'Fatima Al-Ali', phone: '99887766', governorate: 'hawalli', area: 'Salmiya',
               block: '4', street: 'Amman', building: '12', floor: '3', flat: '7', note: 'Blue gate' }

// ---- 1. empty required fields are caught before any network call ----
{
  const { c, p } = await shop()
  await addFirst(p)
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  await p.click('button[type=submit]')
  await p.waitForTimeout(300)
  const alerts = await p.locator('[role=alert]').count()
  const focused = await p.evaluate(() => document.activeElement?.id)
  ok('blocks submit with empty fields', alerts > 1, `${alerts} messages`)
  ok('focuses the first bad field', focused === 'f-name', `focus=${focused}`)
  ok('never reached the bank', !p.url().includes('8131'))
  await c.close()
}

// ---- 2. a landline is rejected client-side ----
{
  const { c, p } = await shop()
  await addFirst(p)
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  await fill(p, { ...GOOD, phone: '22334455' })
  await p.click('button[type=submit]')
  await p.waitForTimeout(300)
  const msg = await p.locator('#e-phone').textContent().catch(() => '')
  ok('rejects a Kuwaiti landline', /8 digits starting 5, 6 or 9/.test(msg ?? ''), (msg ?? '').slice(0, 48))
  await c.close()
}

// ---- 3. full happy path, English ----
{
  const { c, p } = await shop()
  await addFirst(p); await addFirst(p)
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  await fill(p, GOOD)
  await p.click('button[type=submit]')
  await p.waitForURL(/8131/, { timeout: 15000 })
  const url = new URL(p.url())
  ok('reaches the bank', url.port === '8131')
  ok('sends trackid', /^SP[A-Z0-9]{4,}$/.test(url.searchParams.get('trackid') ?? ''), url.searchParams.get('trackid'))
  ok('sends NO amount (server prices it)', !url.searchParams.has('amount'), url.search)
  await c.close()
}

// ---- 4. Arabic path, Arabic area name ----
{
  const { c, p } = await shop('ar')
  await addFirst(p)
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  const dir = await p.evaluate(() => document.documentElement.dir)
  await fill(p, { ...GOOD, name: 'يوسف الكندري', area: 'السالمية', street: 'الخليج' })
  await p.click('button[type=submit]')
  await p.waitForURL(/8131/, { timeout: 15000 })
  ok('Arabic checkout completes', p.url().includes('8131'), `dir=${dir}`)
  await c.close()
}

// ---- 5. details are remembered on the device ----
{
  const c = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const p = await c.newPage()
  await p.goto('http://www.sporta.com.kw/shop', { waitUntil: 'networkidle' })
  await addFirst(p)
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  await fill(p, GOOD)
  await p.click('button[type=submit]')
  await p.waitForURL(/8131/, { timeout: 15000 })
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  const name = await p.locator('#f-name').inputValue()
  ok('remembers the address next time', name === GOOD.name, `name="${name}"`)

  // ...and an explicit opt-out survives, rather than silently re-enabling.
  await p.locator('input[type=checkbox]').uncheck()
  await p.click('button[type=submit]')
  await p.waitForURL(/8131/, { timeout: 15000 })
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  const after = await p.locator('#f-name').inputValue()
  const box = await p.locator('input[type=checkbox]').isChecked()
  ok('honours opting out', after === '' && box === false, `name="${after}" checked=${box}`)
  await c.close()
}

// ---- 6. an item missing from the database names itself ----
{
  const { c, p } = await shop()
  await addFirst(p)
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.includes('cart'))
    localStorage.setItem(k, JSON.stringify([{ slug: 'ghost-product', qty: 1, price: 5, name: { en: 'Ghost Hoodie', ar: 'هودي' } }]))
  })
  await p.reload({ waitUntil: 'networkidle' })
  await fill(p, GOOD)
  await p.click('button[type=submit]')
  await p.waitForTimeout(1500)
  const banner = await p.locator('[role=alert]').first().textContent().catch(() => '')
  ok('names the unavailable product', /Ghost Hoodie/.test(banner ?? ''), (banner ?? '').slice(0, 70))
  ok('did not send them to the bank', !p.url().includes('8131'))
  await c.close()
}

await browser.close()
const failed = results.filter((r) => !r[1])
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
