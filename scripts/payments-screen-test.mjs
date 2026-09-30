/**
 * The Payments screen: methods on/off, cash limits, the connection check.
 *
 *   bash scripts/sandbox.sh && node scripts/payments-screen-test.mjs
 *
 * Real browser on the panel and on the checkout; the server is asked directly
 * for what it enforces, because a switch that only hides a button is not a switch.
 * The `rules` row is put back as it was.
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const SLUG = 'cagliari-calcio-sweatshirt-navy'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--batch', '--raw', '--skip-column-names', '-e', q], { encoding: 'utf8' }).trim()
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d && !ok ? '   ' + d : ''}`) }

const original = sql("select value from settings where name='rules'")
const setRules = (v) => sql(`replace into settings (name, value) values ('rules', '${esc(JSON.stringify(v))}')`)
const base = original ? JSON.parse(original) : {}
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function signIn(vp) {
  const ctx = await br.newContext({ viewport: vp, hasTouch: vp.width < 500, isMobile: vp.width < 500 })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/backends`); await p.waitForSelector('input[type=password]', { timeout: 15000 })
  await p.locator('input[type=email], input[type=text]').first().fill('manager@sporta.com.kw')
  await p.locator('input[type=password]').first().fill('correct horse')
  await p.keyboard.press('Enter'); await p.waitForSelector('.admin-content', { timeout: 15000 }); await p.waitForTimeout(1200)
  return { ctx, p }
}
const adminCall = (p, route, body) => p.evaluate(async ([r, b]) => {
  const x = await fetch('/api/admin.php?r=' + r, { method: b ? 'POST' : 'GET', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, credentials: 'include', body: b ? JSON.stringify(b) : undefined })
  return { status: x.status, j: await x.json().catch(() => null) }
}, [route, body])
const orderBody = (method, track) => ({ track_id: track, payment_method: method, lang: 'en',
  items: [{ slug: SLUG, size: 'M', qty: 1 }],
  customer: { name: 'Rig', phone: '5' + String(Math.floor(1e6 + Math.random() * 8e6)), email: 'rig@example.com',
    governorate: 'capital', area: 'Salmiya', block: '1', street: 'One', building: '1' } })
const order = async (method, track) => {
  const r = await fetch(`${BASE}/api/api.php?r=order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderBody(method, track)) })
  return { status: r.status, j: await r.json().catch(() => null) }
}

try {
  setRules({ ...base, payment_methods: ['knet', 'tpay', 'cod'], cod_max_fils: 0 })

  /* ---- the screen, desktop and phone */
  for (const [name, vp] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const { ctx, p } = await signIn(vp)
    check(await p.locator('[data-spps-nav]').count() === (name === 'phone' ? 2 : 2), `${name}: a Payments button is in the navigation`)
    await p.locator('[data-spps-nav]:visible').first().click(); await p.waitForTimeout(1800)
    check(await p.locator('[data-spps]').count() === 1 && (await p.locator('.admin-content h1:visible').allInnerTexts()).join() === 'Payments', `${name}: it opens its own screen and hides the bundle's`)
    check(await p.locator('[data-sporta-panel=payment]:visible').count() === 1, `${name}: the KNET/CBK credentials card is on it`)
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: nothing scrolls sideways`)
    // another screen takes over again
    const other = p.locator(name === 'phone' ? '.m-tabbar__item:not([data-spps-nav])' : '.admin-sidebar button:not([data-spps-nav])').first()
    await other.click(); await p.waitForTimeout(1200)
    check(await p.locator('[data-spps]').count() === 0 && (await p.locator('.admin-content h1:visible').count()) > 0 && (await p.locator('.admin-content h1:visible').first().innerText()) !== 'Payments', `${name}: pressing another screen brings it back`)
    // and Settings no longer carries the credentials card
    const st = p.locator(name === 'phone' ? '.m-tabbar__item' : '.admin-sidebar button').filter({ hasText: /^\s*Settings\s*$/ }).first()
    await st.click(); await p.waitForTimeout(2200)
    check(await p.locator('[data-sporta-panel=payment]').count() === 0, `${name}: Settings no longer carries the payment credentials card`)
    await ctx.close()
  }

  /* ---- switches: save from the screen, then the server and the checkout agree */
  {
    const { ctx, p } = await signIn({ width: 1280, height: 900 })
    await p.locator('[data-spps-nav]:visible').first().click(); await p.waitForTimeout(1500)
    await p.locator('[data-spps] input.spps-sw').nth(2).uncheck()          // cash off
    await p.locator('[data-spps] input.spps-in').nth(0).fill('4')
    await p.locator('[data-spps] input.spps-in').nth(1).fill('12.5')
    await p.locator('[data-spps] button', { hasText: 'Save' }).click(); await p.waitForTimeout(1500)
    const row = JSON.parse(sql("select value from settings where name='rules'"))
    check(JSON.stringify(row.payment_methods) === '["knet","tpay"]' && row.cod_open_max === 4 && row.cod_max_fils === 12500, 'Save stores the methods and both cash limits', JSON.stringify(row))
    check(row.governorates && row.sizes, 'and leaves the other rules alone', '')
    const off = await order('cod', 'PAYSCR' + Date.now().toString(36).toUpperCase())
    check(off.j?.error === 'payment_method_disabled', 'the server refuses a switched-off method', JSON.stringify(off.j))
    // last method cannot be switched off
    await p.locator('[data-spps] input.spps-sw').nth(0).uncheck(); await p.locator('[data-spps] input.spps-sw').nth(1).uncheck()
    await p.locator('[data-spps] button', { hasText: 'Save' }).click(); await p.waitForTimeout(1200)
    check(/at least one/i.test(await p.locator('[data-spps] .spps-note').first().innerText().catch(() => '')) || JSON.parse(sql("select value from settings where name='rules'")).payment_methods.length > 0, 'the last way to pay cannot be switched off')
    await ctx.close()

    // checkout hides it
    const c2 = await br.newContext({ viewport: { width: 1280, height: 900 } }); const q = await c2.newPage()
    await q.goto(`${BASE}/product/${SLUG}?lang=en`, { waitUntil: 'networkidle' })
    await q.getByRole('button', { name: /^M$/ }).first().click(); await q.getByRole('button', { name: /^Add$/ }).first().click(); await q.waitForTimeout(500)
    await q.goto(`${BASE}/checkout?lang=en`, { waitUntil: 'networkidle' }); await q.waitForTimeout(1200)
    const shown = await q.evaluate(() => [...document.querySelectorAll('input[name=paymethod]')].filter((r) => r.closest('label').style.display !== 'none').map((r) => r.value))
    check(!shown.includes('cod') && shown.includes('knet'), 'checkout no longer offers cash on delivery', shown.join())
    await c2.close()

    // preselected method switched off -> the first available is chosen
    setRules({ ...base, payment_methods: ['cod'] })
    const c3 = await br.newContext({ viewport: { width: 1280, height: 900 } }); const z = await c3.newPage()
    await z.goto(`${BASE}/product/${SLUG}?lang=en`, { waitUntil: 'networkidle' })
    await z.getByRole('button', { name: /^M$/ }).first().click(); await z.getByRole('button', { name: /^Add$/ }).first().click(); await z.waitForTimeout(500)
    await z.goto(`${BASE}/checkout?lang=en`, { waitUntil: 'networkidle' }); await z.waitForTimeout(1500)
    check(await z.evaluate(() => document.querySelector('input[name=paymethod]:checked')?.value) === 'cod', 'when the preselected method is off, the first available one is chosen')
    await c3.close()
  }

  /* ---- the cash ceiling */
  setRules({ ...base, payment_methods: ['knet', 'tpay', 'cod'], cod_max_fils: 1000 })
  const over = await order('cod', 'PAYOVR' + Date.now().toString(36).toUpperCase())
  check(over.j?.error === 'cod_over_limit', 'a cash order over the ceiling is refused by name', JSON.stringify(over.j))
  check(sql("select count(*) from orders where track_id like 'PAYOVR%'") === '0', 'and leaves no half order behind')
  setRules({ ...base, payment_methods: ['knet', 'tpay', 'cod'], cod_max_fils: 0 })
  const under = await order('cod', 'PAYOK' + Date.now().toString(36).toUpperCase())
  check(under.status === 200 && !under.j?.error, 'with no ceiling the same order goes through', JSON.stringify(under.j))
  sql("delete from order_items where order_id in (select id from orders where track_id like 'PAYOK%' or track_id like 'PAYOVR%')")
  sql("delete from orders where track_id like 'PAYOK%' or track_id like 'PAYOVR%'")
  setRules({ ...base, payment_methods: ['knet', 'tpay', 'cod'], cod_max_fils: 999999999 })
  const { ctx: c4, p: a4 } = await signIn({ width: 1280, height: 900 })
  check((await adminCall(a4, 'settings_save', { name: 'rules', value: { cod_max_fils: 999999999 } })).j?.error === 'rule_out_of_range:cod_max_fils', 'an absurd ceiling is refused')

  /* ---- the status route */
  const st = await adminCall(a4, 'payment_check')
  check(st.status === 200 && st.j.methods.cod.ready === true && typeof st.j.methods.knet.configured === 'boolean', 'payment_check answers per method', JSON.stringify(st.j?.methods))
  const txt = JSON.stringify(st.j)
  check(!/SANDBOX_NOT_A_REAL|client_secret":"|encrp_key":"|tranportal_password|resource_key/.test(txt), 'and never contains a credential', '')
  const live = await adminCall(a4, 'payment_check&live=1')
  check(live.status === 200 && live.j.cbk && ('login' in live.j.cbk) && live.j.cbk.login.ok === false, 'the live test returns a verdict and does not fall over when the bank cannot be reached', JSON.stringify(live.j?.cbk?.login))
  await c4.close()
  const anon = await fetch(`${BASE}/api/admin.php?r=payment_check`, { headers: { 'X-Sporta-Admin': '1' } })
  check(anon.status === 401, 'the status route is behind the gate')
} finally {
  if (original) sql(`replace into settings (name, value) values ('rules', '${esc(original)}')`); else sql("delete from settings where name='rules'")
  await br.close()
  check(sql("select coalesce(max(value),'') from settings where name='rules'") === original, 'the rules row is back as it was')
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0)
