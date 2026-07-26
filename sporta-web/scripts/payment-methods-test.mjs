// Both payment methods, driven end to end against real PostgreSQL.
//
// The two paths diverge at the last step and must not be tested as one: KNET
// hands the shopper to the bank, cash never touches it. The thing worth
// asserting is not that each "works" but that neither leaks into the other —
// a cash order must not reach the gateway, and a KNET order must not be
// recorded as cash.
//
// Needs dist/ on :8188, the shim on :8130, a stub bank on :8131, PostgreSQL on
// :5433.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PSQL = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'sporta', '-tAq']
const q = (sql) => execFileSync('psql', [...PSQL, '-c', sql]).toString().trim()

const box = { window: {} }
new Function('window', readFileSync(new URL('../../sporta-html5/assets/products.js', import.meta.url), 'utf8'))(box.window)
const P = box.window.SPORTA_PRODUCTS[0]

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--host-resolver-rules=MAP www.sporta.com.kw 127.0.0.1:8188', '--no-proxy-server'],
})
const results = []
const ok = (n, pass, extra = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${extra ? ' — ' + extra : ''}`) }

async function checkout(method, lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  await ctx.addInitScript(([item, l]) => {
    localStorage.setItem('sporta_cart', JSON.stringify([item]))
    localStorage.setItem('lang', l)
  }, [{ slug: P.slug, qty: 1, price: P.price, name: P.name, image: '' }, lang])
  const p = await ctx.newPage()
  await p.goto('http://www.sporta.com.kw/checkout', { waitUntil: 'networkidle' })
  await p.locator('#f-name').fill('Fatima Al-Ali')
  await p.locator('#f-phone').fill('99887766')
  await p.locator('#f-governorate').selectOption('hawalli')
  await p.locator('#f-area').fill('Salmiya')
  for (const [k, v] of Object.entries({ block: '4', street: 'Amman', building: '12' })) {
    await p.locator(`#f-${k}`).fill(v)
  }
  if (method === 'cod') await p.locator('input[name=paymethod][value=cod]').check()
  await p.locator('button[type=submit]:visible').first().click()
  return { ctx, p }
}

// ---- 1. KNET still goes to the bank -----------------------------------------
{
  const { ctx, p } = await checkout('knet')
  await p.waitForURL(/8131/, { timeout: 15000 })
  const track = new URL(p.url()).searchParams.get('trackid')
  ok('KNET reaches the bank', p.url().includes('8131'), new URL(p.url()).pathname)
  ok('KNET sends no amount', !new URL(p.url()).searchParams.has('amount'))
  ok('KNET order is recorded as knet/pending', q(`select payment_method||'/'||payment_status from orders where track_id='${track}'`) === 'knet/pending')
  await ctx.close()
}

// ---- 2. cash never touches the bank -----------------------------------------
{
  const { ctx, p } = await checkout('cod')
  await p.waitForURL(/payment\/result/, { timeout: 15000 })
  const url = new URL(p.url())
  const track = url.searchParams.get('trackid')
  ok('cash goes straight to the result page', url.pathname === '/payment/result', url.search)
  ok('cash NEVER reaches the bank', !p.url().includes('8131'))
  ok('cash order is recorded as cod/pending',
     q(`select payment_method||'/'||payment_status from orders where track_id='${track}'`) === 'cod/pending')
  ok('the amount is still priced by the server',
     Number(q(`select amount from orders where track_id='${track}'`)) === Number(P.price))

  // waitForFunction on the document text, not getByText: the confirmation is
  // one sentence inside a paragraph, and a fixed sleep raced the lazily-loaded
  // result chunk — English won that race and Arabic lost it, so the report
  // blamed the translation for a timing problem.
  await p.waitForFunction(() => /pay the driver/i.test(document.body.innerText), null, { timeout: 20000 })
  const body = await p.locator('body').innerText()
  ok('the shopper is told to pay the driver', /pay the driver/i.test(body), 'confirmation shown')
  ok('and it does not read as a failure', !/failed|wrong|cancelled/i.test(body))
  ok('the cart is emptied', await p.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]').length === 0))
  await ctx.close()
}

// ---- 3. Arabic ---------------------------------------------------------------
{
  const { ctx, p } = await checkout('cod', 'ar')
  await p.waitForURL(/payment\/result/, { timeout: 15000 })
  // "مندوب", not "المندوب": the sentence reads "ادفع للمندوب" — pay TO the
  // driver — and لل is a different prefix from ال, so the definite form does
  // not occur in the string at all. The page had been rendering correctly for
  // several rounds of debugging while this regex insisted it was not.
  await p.waitForFunction(() => /مندوب/.test(document.body.innerText), null, { timeout: 20000 })
  const body = await p.locator('body').innerText()
  ok('Arabic cash order confirms in Arabic', /مندوب/.test(body), 'confirmation shown in Arabic')
  ok('and the page is RTL', (await p.evaluate(() => document.documentElement.dir)) === 'rtl')
  await ctx.close()
}

// ---- 4. the database refuses a method the UI never offers --------------------
{
  let refused = false
  try {
    q(`select public.create_order('BADMETH001','[{"slug":"${P.slug}","qty":1}]'::jsonb,
       '{"name":"T T","phone":"99887766","governorate":"hawalli","area":"Sal","block":"1","street":"X","building":"1"}'::jsonb,'free')`)
  } catch (e) { refused = /invalid_payment_method/.test(String(e.stderr || e.message)) }
  ok('an invented payment method is refused by the database', refused)
}

await browser.close()
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
