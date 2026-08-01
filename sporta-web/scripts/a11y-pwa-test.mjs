// Keyboard accessibility, the offline shell, dark mode, the shop's progressive
// grid and wishlist sync — asserted, because every one of these was either
// missing or measurably broken when it was written.
//
//   node scripts/a11y-pwa-test.mjs [baseUrl]      (needs HTTPS or localhost for the SW)
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:4173'
let fails = 0
const ok = (pass, what, detail = '') => {
  if (!pass) fails++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${detail ? `  — ${detail}` : ''}`)
}
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// ---------------------------------------------------------------- keyboard
{
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
  await p.goto(BASE + '/', { waitUntil: 'networkidle' })

  await p.keyboard.press('Tab')
  // The link slides in over 0.15s; reading its position immediately catches it
  // mid-transition, which is a fact about the test and not about the link.
  await p.waitForTimeout(400)
  const first = await p.evaluate(() => ({
    tag: document.activeElement.tagName, href: document.activeElement.getAttribute('href'),
    top: Math.round(document.activeElement.getBoundingClientRect().top),
  }))
  ok(first.href === '#main', 'the first tab stop is the skip link', `${first.tag} -> ${first.href}`)
  ok(first.top >= 0, 'the skip link becomes visible when focused', `top ${first.top}px`)
  await p.keyboard.press('Enter')
  await p.waitForTimeout(200)
  ok(await p.evaluate(() => document.activeElement.id === 'main' || location.hash === '#main'),
    'it moves focus/position to <main>')

  // The closed cart drawer must be out of the tab order.
  const closed = await p.evaluate(() => {
    const d = document.querySelector('.cart-drawer')
    const btn = d?.querySelector('button')
    btn?.focus()
    return { inert: d?.hasAttribute('inert'), took: document.activeElement === btn }
  })
  ok(closed.inert === true, 'the CLOSED cart drawer is inert')
  ok(closed.took === false, '…so its buttons cannot take focus', 'was tab stops 44-45 of 46')

  // Open it: focus in, trapped, Escape out, focus restored.
  const bag = p.locator('header button[aria-label*="Bag" i]').first()
  await bag.focus()
  await p.keyboard.press('Enter')
  await p.waitForTimeout(500)
  ok(await p.evaluate(() => document.querySelector('.cart-drawer')?.contains(document.activeElement)),
    'opening it moves focus inside')
  let inside = true
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press('Tab')
    if (!(await p.evaluate(() => document.querySelector('.cart-drawer')?.contains(document.activeElement)))) inside = false
  }
  ok(inside, 'Tab is trapped inside while open', '8 presses')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(500)
  ok(!(await p.evaluate(() => document.querySelector('.cart-drawer').className.includes('translate-x-0'))),
    'Escape closes it')
  ok(await p.evaluate(() => document.activeElement.getAttribute('aria-label')?.match(/bag/i) !== null),
    'focus returns to the button that opened it',
    await p.evaluate(() => document.activeElement.getAttribute('aria-label') ?? document.activeElement.tagName))
  await p.close()
}

// ------------------------------------------------------------------- theme
for (const [saved, want] of [['dark', 'dark'], ['light', 'light']]) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.addInitScript((v) => localStorage.setItem('sporta_theme', v), saved)
  await p.addInitScript(() => {
    window.__first = null
    requestAnimationFrame(() => { window.__first = document.documentElement.dataset.theme ?? '(none)' })
  })
  await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  const at = await p.evaluate(() => window.__first)
  ok(at === want, `theme "${saved}" is set before the first frame (no flash)`, `first frame: ${at}`)
  await p.close()
}

// ------------------------------------------------------- shop: progressive grid
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 } })
  await p.goto(BASE + '/shop', { waitUntil: 'networkidle' })
  await p.waitForTimeout(400)
  const firstBatch = await p.evaluate(() => document.querySelectorAll('a[class*="aspect-"]').length)
  ok(firstBatch === 12, 'the shop renders 12 cards first, not the whole catalogue', String(firstBatch))
  const btn = p.locator('button:has-text("Show"), button:has-text("اعرض")').first()
  ok(await btn.count() > 0, 'a real "Show more" button exists for keyboard users')
  await btn.click()
  await p.waitForTimeout(300)
  ok(await p.evaluate(() => document.querySelectorAll('a[class*="aspect-"]').length) === 24,
    'the button loads the next 12')
  // And the sentinel keeps loading on scroll until the list is exhausted.
  for (let i = 0; i < 6; i++) { await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(350) }
  const all = await p.evaluate(() => document.querySelectorAll('a[class*="aspect-"]').length)
  ok(all === 46, 'scrolling loads the rest', `${all} of 46`)
  ok(await p.locator('button:has-text("Show"), button:has-text("اعرض")').count() === 0,
    'the button disappears once everything is shown')
  await p.close()
}

// --------------------------------------------------------- wishlist cross-tab
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  const a = await ctx.newPage()
  const c = await ctx.newPage()
  await a.goto(BASE + '/shop', { waitUntil: 'networkidle' })
  await c.goto(BASE + '/wishlist', { waitUntil: 'networkidle' })
  await a.locator('button[aria-label*="wishlist" i], button[aria-label*="المفضلة"]').first().click()
  await a.waitForTimeout(600)
  const inA = await a.evaluate(() => JSON.parse(localStorage.getItem('sporta_wishlist') || '[]').length)
  await c.waitForTimeout(600)
  const shownInB = await c.evaluate(() => document.querySelectorAll('a[class*="aspect-"]').length)
  ok(inA === 1, 'a heart in tab A is saved', String(inA))
  ok(shownInB === 1, 'and appears in tab B without a reload', `${shownInB} item(s)`)
  await ctx.close()
}

// ------------------------------------------------------------------- offline
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  const p = await ctx.newPage()
  await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  const reg = await p.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false))
  ok(reg === true, 'the service worker registers and activates')

  // Wait for the PRECACHE to finish, by polling for it rather than sleeping.
  // A fixed 1200 ms passed on this machine and would have failed on a slower
  // one — and a flaky offline test is worse than none, because the response to
  // it is to stop believing the suite.
  const precached = await p.evaluate(async () => {
    const want = 20
    for (let i = 0; i < 60; i++) {
      const keys = await caches.keys()
      const all = (await Promise.all(keys.map((k) => caches.open(k).then((c) => c.keys())))).flat()
      if (all.length >= want) return all.length
      await new Promise((r) => setTimeout(r, 250))
    }
    return -1
  })
  ok(precached > 0, 'the app shell and every route chunk are precached', `${precached} entries`)
  await ctx.setOffline(true)
  for (const route of ['/', '/shop', '/product/sculpt-top-grey', '/cart']) {
    const res = await p.goto(BASE + route, { waitUntil: 'domcontentloaded' }).catch(() => null)
    await p.waitForTimeout(900)
    const d = await p.evaluate(() => ({
      main: !!document.querySelector('#main'),
      chars: document.body.innerText.length,
      h1: document.querySelector('h1')?.textContent?.trim().slice(0, 24) ?? '',
    })).catch(() => ({ main: false, chars: 0, h1: '' }))
    ok(d.main && d.chars > 300, `offline ${route} renders`, `${res?.status()} ${d.chars} chars, h1 "${d.h1}"`)
  }
  // config.js and the payment endpoints must never be served from the cache.
  const cached = await p.evaluate(async () => {
    const keys = await caches.keys()
    const all = (await Promise.all(keys.map((k) => caches.open(k).then((c) => c.keys())))).flat()
    return all.map((r) => new URL(r.url).pathname)
  })
  ok(!cached.includes('/config.js'), 'config.js is NOT in any cache', cached.filter((u) => u.includes('config')).join() || 'none')
  ok(!cached.some((u) => u.startsWith('/knet/') || u.startsWith('/pay/')),
    'no payment endpoint is in any cache')
  await ctx.setOffline(false)
  await ctx.close()
}

// ------------------------------------ the shell has to stop being a shell
//
// index.html paints a header bar, a logo and a hero box before any JavaScript
// runs, and React clears it on mount. If the bundle never arrives it is never
// cleared — and a visitor gets an orange bar, a logo and nothing else, for
// ever. That does not look broken, it looks like a shop with no stock, so it
// gets reported as "the website is only a top bar and a logo" rather than as
// a failed deploy.
//
// The module is aborted here exactly the way a partial upload breaks it: the
// HTML is current, the hashed chunk it names is not on the server.
{
  const ctx = await b.newContext({ serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.route('**/assets/index-*.js', (r) => r.abort())
  await p.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(11500)
  const text = await p.locator('#root').innerText()
  ok(/did not finish loading/i.test(text),
     'a bundle that never loads says so, instead of leaving a bare shell',
     JSON.stringify(text.split('\n')[0]))
  ok(/assets\/index-.*\.js/.test(text),
     'and names the file that failed, which is the whole diagnosis',
     (text.match(/\S*assets\/\S+/) ?? ['(none)'])[0])
  await ctx.close()
}

// The other half of that check, and the one that matters more: it must not
// cry wolf. A false alarm on a slow connection would be its own bug.
{
  const ctx = await b.newContext({ serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.goto(BASE, { waitUntil: 'load' })
  await p.waitForTimeout(11500)
  const text = await p.locator('#root').innerText()
  ok(!/did not finish loading/i.test(text),
     'and a HEALTHY page never shows it, however long it is left open')
  await ctx.close()
}

await b.close()
console.log(fails ? `\n${fails} failed` : '\nall accessible, installable and offline-capable')
process.exit(fails ? 1 : 0)
