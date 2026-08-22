/**
 * Drives the exported web build through the shop, on a phone-sized viewport.
 * Not a substitute for a device, but it exercises the real components: the
 * catalogue, the cart maths, the stock cap, and the checkout validation all
 * run the same code on every platform.
 *
 *   npx expo export --platform web && node scripts/smoke.mjs
 */
import { chromium } from 'playwright'

// BASE may carry a path (…/app) when checking a packaged build that was
// exported with a baseUrl. Every link in the page is prefixed with it, so the
// selectors below match on containment rather than on a leading slash.
const BASE = process.env.BASE ?? 'http://127.0.0.1:4173'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

// VISIBLE ONLY. A stack keeps the screen you came from mounted and hidden, so
// a product page's price is still in the DOM while the cart is on top —
// `getByText(price).first()` resolves to the hidden one and reports the cart as
// broken. Every query below goes through this.
const seen = (loc) => loc.filter({ visible: true })
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
// The catalogue fetch cannot succeed from this sandbox — outbound HTTPS to the
// shop is blocked — and that is the offline path this test WANTS exercised.
// Its network error is filtered out by URL; nothing else is.
const ignorable = (s) => /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(s)

// One more, and only on the two dynamic routes. `expo export --platform web`
// prerenders /product/[slug] and /order/[ref] with the parameter unresolved,
// so the server HTML cannot match the client's first render and React logs a
// hydration mismatch (#418) before re-rendering correctly. It is a property of
// static-exporting a dynamic route, not of this app — the native build never
// hydrates at all — and the checks above prove both screens work. It is scoped
// to those two paths deliberately: the same error anywhere else is a real bug
// and still fails this test.
const hydrationOnDynamicRoute = (s) => /Minified React error #41[89]|#42[23]/.test(s) &&
  /\/(product|order)\//.test(p.url())
const errors = []
p.on('pageerror', (e) => !ignorable(String(e)) && !hydrationOnDynamicRoute(String(e)) && errors.push(String(e)))
p.on('console', (m) => m.type() === 'error' && !ignorable(m.text()) && !hydrationOnDynamicRoute(m.text()) && errors.push(m.text()))

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

const go = async (path) => {
  await p.goto(BASE + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
}

// --- home, in Arabic, which is the default -------------------------------
await go('/')
check((await seen(p.getByText('تدرّب بثقة')).count()) > 0, 'home opens in Arabic')
check((await seen(p.getByText('رجالي')).count()) > 0, 'category tiles render')
const shot = async (name) => p.screenshot({ path: `/tmp/sporta-${name}.png`, fullPage: false })
await shot('home-ar')

// --- the typefaces are actually loaded ------------------------------------
// Not "did useFonts resolve" — what the text is being PAINTED in. A font that
// fails to register falls back silently to the system face, and the page still
// looks fine at a glance while being a different shop.
const offScale = await p.evaluate(() =>
  [...document.querySelectorAll('*')]
    .filter((el) => el.children.length === 0 && el.textContent?.trim() && !['STYLE', 'SCRIPT'].includes(el.tagName))
    .map((el) => ({
      family: getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, ''),
      text: el.textContent.trim(),
    }))
    // Emoji and the arrow glyph are deliberately left to the system: no text
    // face carries them, and forcing one renders tofu.
    .filter((x) => !/^(Plex|Alexandria)/.test(x.family) && !/^[\p{Emoji}\u2190-\u21FF\uFE0F]+$/u.test(x.text))
    .map((x) => `${x.family}: ${x.text.slice(0, 20)}`),
)
check(offScale.length === 0, `every line is set in the app's own typefaces${offScale.length ? ` — ${offScale.slice(0, 3).join(' | ')}` : ''}`)

// --- the top bar ---------------------------------------------------------
// Every screen has it, so its defects are on every screen. All three of these
// were real: 28px targets, a bar that scrolled away, and a cart pill that
// re-measured itself each time an item went in.
await p.waitForTimeout(600)
const barTargets = await p.evaluate(() =>
  ['الرئيسية', 'المتجر', 'السلة', 'حسابي'].map((label) => {
    const leaf = [...document.querySelectorAll('*')].find(
      (d) => d.children.length === 0 && d.textContent?.trim() === label,
    )
    // Climb to the pressable: React Native Web wraps the label in a couple of
    // divs and the tappable one is not the one holding the text.
    // Climb to the pressable. It renders as a bare <a> with no role attribute
    // — matching on role alone found nothing and reported every target as 0px,
    // which is a passing-looking failure of the test, not of the bar.
    let el = leaf
    for (let i = 0; el && i < 4; i++, el = el.parentElement) {
      if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
        return Math.round(el.getBoundingClientRect().height)
      }
    }
    return 0
  }),
)
check(barTargets.length === 4 && barTargets.every((h) => h >= 44),
  `top-bar targets are tappable (${barTargets.join(', ')}px)`)

// The cart pill must not change width as the basket fills. The count used to
// be rendered inside the label as "(1)", which re-measured the pill — and the
// whole row shifted under the thumb every time something went in.
const pillWidth = () =>
  p.evaluate(() => {
    const leaf = [...document.querySelectorAll('*')].find(
      (d) => d.children.length === 0 && d.textContent?.trim() === 'السلة',
    )
    let el = leaf
    for (let i = 0; el && i < 4; i++, el = el.parentElement) {
      if (el.tagName === 'A') return Math.round(el.getBoundingClientRect().width)
    }
    return 0
  })
const emptyCartPill = await pillWidth()

// --- the grid is two across, not one -------------------------------------
// It ran as a single column for three commits: 48% + 48% + a 16px gap is
// 100.5% of the row, so every card wrapped. Nothing in the suite noticed,
// because a one-column grid still lists every product and still filters.
const cardsPerRow = () =>
  p.evaluate(() => {
    const cards = [...document.querySelectorAll('a[href*="/product/"]')]
    if (!cards.length) return 0
    const top = Math.round(cards[0].getBoundingClientRect().top)
    return cards.filter((c) => Math.abs(Math.round(c.getBoundingClientRect().top) - top) < 4).length
  })
check((await cardsPerRow()) === 2, 'the home grid is two cards across')

// --- shop, filtering -----------------------------------------------------
await go('/shop')
const before = await p.locator('a[href*="/product/"]').count()
check(before > 0, `shop lists products (${before})`)

// --- the first filter chip is on screen in Arabic ------------------------
// The chips lay out row-reverse, so «الكل» is at the far right of the content
// and a ScrollView opens at the LEFT. It measured x=382 on a 390px phone —
// three quarters of it past the edge — and the filter customers reach for most
// was the one they had to go hunting for. Invisible in English, and invisible
// in any screenshot taken in English.
const firstChip = await p.evaluate(() => {
  const leaf = [...document.querySelectorAll('*')].find(
    (d) => d.children.length === 0 && d.textContent?.trim() === 'الكل',
  )
  if (!leaf) return null
  const r = leaf.getBoundingClientRect()
  return { x: Math.round(r.x), right: Math.round(r.x + r.width) }
})
check(!!firstChip && firstChip.x >= 0 && firstChip.right <= 390,
  `the first filter chip is fully on screen (${firstChip?.x}–${firstChip?.right})`)

// Checked on BOTH screens: they carry the same grid written out twice, and
// mutating only the shop's copy left the home check green.
check((await cardsPerRow()) === 2, 'the shop grid is two cards across')
await p.getByRole('button', { name: 'إكسسوارات' }).first().click()
await p.waitForTimeout(500)
const after = await p.locator('a[href*="/product/"]').count()
check(after > 0 && after < before, `category filter narrows the grid (${before} → ${after})`)
await shot('shop-ar')

// --- the badges on the grid ----------------------------------------------
// Back to every product first: the filter test above left the grid on
// accessories, and three of the four badges live on other categories.
await p.getByRole('button', { name: 'الكل' }).first().click()
await p.waitForTimeout(600)
// All four states, on the same screen. Two of them were unreachable when the
// badge was written: nothing in the bundled catalogue was out of stock or
// nearly gone, so the code existed and could never run.
const badges = await p.evaluate(() =>
  [...document.querySelectorAll('a[href*="/product/"]')].map((card) => {
    const slug = card.getAttribute('href').split('/').pop()
    const texts = [...card.querySelectorAll('*')]
      .filter((e) => e.children.length === 0)
      .map((e) => e.textContent.trim())
    return { slug, texts }
  }),
)
const badgeOn = (slug) => badges.find((b) => b.slug === slug)?.texts ?? []
check(badgeOn('grip-training-glove').includes('نفدت الكمية'), 'a sold-out product is badged')
check(badgeOn('high-rise-legging').includes('الكمية محدودة'), 'a nearly-gone product is badged')
check(badgeOn('sculpt-top-grey').includes('جديد'), 'a new product is badged')
check(badgeOn('core-compression-tee').some((t) => t.includes('وفّر')), 'a discounted product is badged')
// One badge per card, never a cluster: three stickers read as decoration.
const clustered = badges.filter(
  (b) => b.texts.filter((t) => ['جديد', 'الكمية محدودة', 'نفدت الكمية'].includes(t)).length > 1,
)
check(clustered.length === 0, 'no card wears more than one badge')

// Arabic copy in Arabic digits — the discount badge said "21%" beside a price
// written ١١٫٠٠٠, which is the giveaway that a string was assembled rather
// than written.
check(!/[0-9]/.test(badgeOn('core-compression-tee').find((t) => t.includes('وفّر')) ?? ''),
  'the discount is written in Arabic digits')

// --- product: sold-out size is visible but not selectable ----------------
await go('/product/desert-runner-short')
const xl = p.getByText('XL', { exact: true })
check((await seen(xl).count()) > 0, 'a sold-out size is still shown')
await p.getByRole('button', { name: 'أضف إلى السلة' }).click()
await p.waitForTimeout(400)
check((await seen(p.getByText('اختر المقاس أولاً')).count()) > 0, 'adding without a size is refused')
await p.getByRole('button', { name: 'M' }).first().click()
await p.getByRole('button', { name: 'أضف إلى السلة' }).click()
await p.waitForTimeout(400)
check((await seen(p.getByText('أُضيف إلى السلة')).count()) > 0, 'adding with a size confirms')
await shot('product-ar')

// The SECOND cap, and the one that matters. The stepper in the basket disables
// itself at the ceiling, so a test that only drives the stepper passes even
// when the store's own cap is removed — verified by deleting it, which changed
// nothing. Nothing disables the add button here, so this is what actually
// proves lib/cart.tsx refuses to oversell: M has six in stock, and ten taps
// must still leave six.
const addBtn = p.getByRole('button', { name: 'أضف إلى السلة' })
for (let i = 0; i < 9; i++) await addBtn.click()
await p.waitForTimeout(400)
check((await seen(p.getByText('هذا كل المتوفر بالمخزون')).count()) > 0,
  'repeated adds are refused at the stock ceiling')

// --- cart: the line, the maths, and the stock cap ------------------------
// Navigated to through the tab bar, not with goto: a full page load is a fair
// test of PERSISTENCE (which the next check covers) but not of the basket the
// customer just filled.
await p.getByRole('button', { name: 'السلة →' }).click()
await p.waitForTimeout(700)
// 6 x 9.750 = 58.500, and it is over the free-delivery line, so both the line
// maths and the delivery rule are read from the same basket.
check((await seen(p.getByText('٥٨٫٥٠٠ د.ك')).count()) > 0, 'line total is quantity x price, in Arabic fils')
check((await seen(p.getByText('مجاني')).count()) > 0, 'delivery is free over 20 KD')
// Click + until it refuses, rather than a fixed number of times: the stepper
// DISABLES itself at the stock ceiling, and clicking a disabled button is a
// 30-second timeout, not a failed assertion. The loop is bounded so a stepper
// that never caps fails the test instead of hanging it.
const plus = seen(p.getByRole('button', { name: 'increase quantity' })).first()
check(!(await plus.isEnabled()), 'the stepper is already at its ceiling and disabled')
check((await seen(p.getByText('هذا كل المتوفر بالمخزون')).count()) > 0,
  'quantity is capped at stock, and says so')
await shot('cart-ar')

// --- the basket survives a reload ---------------------------------------
await go('/cart')
check((await seen(p.getByText('شورت ديزرت للجري')).count()) > 0,
  'the basket is still there after a full reload')

// --- the cart pill did not resize as the basket filled -------------------
await go('/')
await p.waitForTimeout(700)
const fullCartPill = await pillWidth()
check(emptyCartPill > 0 && emptyCartPill === fullCartPill,
  `the cart tab keeps its width with items in it (${emptyCartPill} → ${fullCartPill})`)

// --- checkout validation -------------------------------------------------
await go('/checkout')
await p.getByRole('button', { name: 'تأكيد الطلب' }).or(p.getByRole('button', { name: 'ادفع الآن' })).first().click()
await p.waitForTimeout(400)
check((await seen(p.getByText('هذا الحقل مطلوب')).count()) > 0, 'empty checkout is refused per field')
await shot('checkout-ar')

// --- language switch, live ----------------------------------------------
await go('/account')
await p.getByRole('radio', { name: 'English' }).click()
await p.waitForTimeout(500)
check((await seen(p.getByText('Language')).count()) > 0, 'language switches without a reload')
await go('/')
await shot('home-en')

check(errors.length === 0, `no console or page errors${errors.length ? ` — ${errors.slice(0, 3).join(' | ')}` : ''}`)

await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
