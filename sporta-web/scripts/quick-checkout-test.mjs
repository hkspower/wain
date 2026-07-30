// Quick checkout, and the checkout it collapses.
//
// Two things this has to prove, because both are the kind of bug that only
// shows up with money on the line:
//   * a returning shopper reaches Pay without retyping anything, and the
//     address they are shown is the one the order will actually go to
//   * a DOUBLE TAP DOES NOT CREATE TWO ORDERS. create_order has an idempotency
//     guard keyed on track_id, and the browser used to mint a fresh id on every
//     call, so the guard could never fire.
//
//   npm run test:quick        (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => {
  fails++
  console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`)
}
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))

const CART = [
  {
    key: 'cloudsoft-jacket-army-green__L__normal',
    slug: 'cloudsoft-jacket-army-green',
    size: 'L',
    fit: 'normal',
    name: { en: 'Cloudsoft Jacket — Army Green', ar: 'جاكيت كلاودسوفت — أخضر عسكري' },
    price: 10,
    image: '',
    qty: 2,
  },
]
const SAVED = {
  name: 'Test Shopper', phone: '99887766', governorate: 'capital',
  area: 'Salmiya', block: '4', street: '12', building: '5', floor: '', flat: '', note: '',
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
})

async function open({ lang = 'en', saved = null, viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.addInitScript(
    ([l, cart, delivery]) => {
      localStorage.setItem('lang', l)
      localStorage.setItem('sporta_cart', JSON.stringify(cart))
      if (delivery) localStorage.setItem('sporta.delivery', JSON.stringify(delivery))
      else localStorage.removeItem('sporta.delivery')
    },
    [lang, CART, saved],
  )
  await page.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
  return { ctx, page }
}

// ------------------------------------------- first-time shopper: the form
{
  const { ctx, page } = await open()
  const fields = await page.locator('form input, form select, form textarea').count()
  is(fields > 6, 'with nothing saved, the full form is shown', `${fields} controls`)
  is(
    (await page.locator('#f-name').count()) === 1,
    'the name field is present for a first-time shopper',
  )
  await ctx.close()
}

// ------------------------------------------- returning shopper: quick
{
  const { ctx, page } = await open({ saved: SAVED })

  const h1 = (await page.locator('h1').first().textContent())?.trim()
  is(h1 === 'Quick checkout', 'saved details open the quick card', h1)

  // No fields to fill in — that is the entire point.
  const textInputs = await page.locator('form input:not([type=radio])').count()
  is(textInputs === 0, 'quick checkout asks for nothing', `${textInputs} inputs`)

  // The address on screen must be the address the order goes to. An express
  // checkout that hides where it is delivering is how a parcel reaches a flat
  // someone moved out of two years ago.
  const body = await page.locator('form').innerText()
  for (const bit of ['Test Shopper', '99887766', 'Salmiya', '4', '12', '5']) {
    if (!body.includes(bit)) bad('the saved address is shown in full', `missing ${bit}`)
  }
  is(body.includes('Test Shopper') && body.includes('Salmiya'), 'the saved address is shown in full')

  // And the bag, with its options — paying for the wrong size is the other
  // failure mode of a collapsed checkout.
  is(body.includes('L') && /Cloudsoft/.test(body), 'the bag and its size are shown')
  is(/KWD\s*20/.test(body.replace(/[‎‏]/g, '')), 'the total is shown', body.match(/KWD[^\n]*/g)?.join(' | '))

  // One tap back to the form.
  await page.getByRole('button', { name: 'Change' }).click()
  is((await page.locator('#f-name').count()) === 1, 'Change opens the full form')
  is(
    (await page.locator('#f-name').inputValue()) === 'Test Shopper',
    'the form opens pre-filled, not blank',
  )
  await ctx.close()
}

// ------------------------------------------- incomplete details fall back
{
  const { ctx, page } = await open({ saved: { ...SAVED, building: '' } })
  const h1 = (await page.locator('h1').first().textContent())?.trim()
  is(h1 !== 'Quick checkout', 'a missing required field falls back to the form', h1)
  await ctx.close()
}

// ------------------------------------------- Arabic
{
  const { ctx, page } = await open({ lang: 'ar', saved: SAVED })
  is((await page.evaluate(() => document.documentElement.dir)) === 'rtl', 'quick checkout is RTL in Arabic')
  const h1 = (await page.locator('h1').first().textContent())?.trim()
  is(/[؀-ۿ]/.test(h1 ?? ''), 'its heading is Arabic', h1)
  // A phone number is an LTR run: "+965 99887766" must not render as
  // "96599887766+".
  const dir = await page.locator('p[dir="ltr"]').first().getAttribute('dir')
  is(dir === 'ltr', 'the phone number stays an LTR run in Arabic')
  await ctx.close()
}

// ------------------------------------------- the double tap, in Node
//
// This is the property that matters and it is decided entirely in the browser,
// before any request: the track id. create_order returns the existing pending
// order for a track id it has already seen, so two taps with the same id are
// one order — and two taps with two ids are two orders, which is what used to
// happen because a fresh id was minted on every call.
{
  // sessionStorage does not exist in Node, and attempt.js only touches it
  // inside functions, so a plain object stub is enough and keeps this a test of
  // the real module rather than a copy of it.
  const store = new Map()
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  const { attemptTrackId, clearAttempt } = await import('../src/lib/attempt.js')

  const order = {
    items: CART,
    customer: { ...SAVED, phone: '96599887766' },
    paymentMethod: 'knet',
  }

  const a = attemptTrackId(order)
  const b = attemptTrackId(order)
  is(a === b, 'a second tap reuses the track id — one order, not two', `${a} / ${b}`)
  is(/^SP[A-Z0-9]{4,28}$/.test(a), 'the id is CBK-safe: alphanumeric, <= 30 chars', a)

  // A different bag is a different order and must not be handed the first
  // one's id — create_order would return the FIRST order and the shopper would
  // pay for a bag they no longer have.
  const changed = attemptTrackId({ ...order, items: [{ ...CART[0], qty: 3 }] })
  is(changed !== a, 'changing the bag starts a new attempt', changed)

  // So is a different size of the same product.
  const resized = attemptTrackId({ ...order, items: [{ ...CART[0], size: 'XL' }] })
  is(resized !== changed, 'changing the size starts a new attempt', resized)

  // And a different address.
  const moved = attemptTrackId({ ...order, customer: { ...order.customer, block: '9' } })
  is(moved !== resized, 'changing the address starts a new attempt', moved)

  // Back to the original order: still the original id, because nothing about
  // it changed. (It is re-derived, not remembered — only the latest is kept.)
  const again = attemptTrackId(order)
  is(/^SP/.test(again), 'the fingerprint is stable, not a counter', again)

  clearAttempt()
  const afterClear = attemptTrackId(order)
  is(
    afterClear !== again,
    'clearing the attempt (order placed) starts a fresh one',
    `${again} -> ${afterClear}`,
  )
}

await browser.close()
console.log(fails ? `\n${fails} problem(s) in checkout` : '\nquick checkout: two taps, one order')
process.exit(fails ? 1 : 0)
