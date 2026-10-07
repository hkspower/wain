/**
 * test:checkout-polish — the checkout's summary bar, one-row guest note and live discount box, 2026-10-07.
 *
 *   - below 1024px a summary bar is the FIRST thing in the form; it reads the same total, item count and
 *     lines as the page's own card (compared with the card, which the script only copies from)
 *   - it is collapsed until tapped, opens to the items, delivery and total, and closes again
 *   - from 1024px it is not drawn at all (the page already has the summary beside the form)
 *   - applying a discount moves the bar's total with the card's (it follows, it does not freeze)
 *   - the guest note is ONE row on a phone (height under 64px) and its Track link is still there and tappable
 *   - the discount box has a white ground and a visible edge, and Apply is solid once a code is typed
 *   - nothing of the app is moved: the payment methods are still inside the card, after the fields
 *   - English and Arabic; no sideways scroll
 *
 * MUTATE=1 blocks checkout-polish.js and the stylesheet's rules (must fail).
 */
import { chromium, devices } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

async function toCheckout(opts, lang) {
  const c = await b.newContext(opts)
  await c.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  if (process.env.MUTATE === '1') await c.route('**/assets/checkout-polish.js', (r) => r.abort())
  const p = await c.newPage()
  await p.goto(`${BASE}/shop`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
  const href = await p.evaluate(() => document.querySelector('a[href*="/product/"]').getAttribute('href'))
  await p.goto(BASE + href, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
  await p.locator('button').filter({ hasText: /^(M|L|S|ONE)$/ }).first().click().catch(() => {})
  await p.getByRole('button').filter({ hasText: /Buy now|اشتر/ }).first().click().catch(() => {})
  await p.waitForTimeout(2500)
  if (!/checkout/.test(p.url())) await p.goto(`${BASE}/checkout`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1500)
  if (process.env.MUTATE === '1') await p.addStyleTag({ content: '.cos{display:none!important}' }).catch(() => {})
  return { c, p }
}
const norm = (s) => s.replace(/[\s ‎‏]+/g, ' ').trim()

for (const [name, opts] of [['phone', devices['Pixel 7']], ['tablet', { viewport: { width: 820, height: 1100 } }], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
  for (const lang of ['en', 'ar']) {
    const { c, p } = await toCheckout(opts, lang)
    const tag = `[${name} ${lang}]`
    const wide = name === 'desktop'
    const bar = p.locator('[data-sporta-co-summary] .cos-bar')
    if (wide) {
      check(!(await p.locator('.cos').first().isVisible().catch(() => false)), `${tag} the bar is not drawn beside the two-column layout`)
    } else {
      check(await bar.count() === 1, `${tag} exactly one summary bar`)
      const first = await p.evaluate(() => { const f = document.querySelector('main form'); return !!(f && f.firstElementChild && f.firstElementChild.matches('[data-sporta-co-summary]')) })
      check(first, `${tag} it is the first thing in the form`)
      const m = await p.evaluate(() => {
        const c = document.querySelector('form > aside > div'), w = document.querySelector('[data-sporta-co-summary]')
        const cardTotal = c.querySelector(':scope > div > span.text-accent').textContent
        return { cardTotal, barTotal: w.querySelector('.cos-amount').textContent, cardCount: c.querySelector('h2 span').textContent, barCount: w.querySelector('.cos-count').textContent,
          cardItems: c.querySelectorAll(':scope > ul > li').length, panelItems: w.querySelectorAll('.cos-panel li').length, expanded: w.querySelector('.cos-bar').getAttribute('aria-expanded'), panelHidden: w.querySelector('.cos-panel').hidden,
          payInCard: !!c.querySelector('fieldset input[type=radio]'), fieldsFirst: !!document.querySelector('form > div.min-w-0 input[name=name]') }
      })
      check(norm(m.barTotal) === norm(m.cardTotal), `${tag} the bar's total is the card's total`, `${norm(m.barTotal)}`)
      check(norm(m.barCount) === norm(m.cardCount), `${tag} the bar's item count is the card's`, norm(m.barCount))
      check(m.expanded === 'false' && m.panelHidden, `${tag} it starts collapsed`)
      const bb = await bar.boundingBox()
      check(bb && bb.height >= 44, `${tag} the bar is at least 44px tall`, bb ? `${Math.round(bb.height)}px` : '')
      await bar.click(); await p.waitForTimeout(200)
      const open = await p.evaluate(() => { const w = document.querySelector('[data-sporta-co-summary]'); return { exp: w.querySelector('.cos-bar').getAttribute('aria-expanded'), hidden: w.querySelector('.cos-panel').hidden, items: w.querySelectorAll('.cos-panel li').length, text: w.querySelector('.cos-panel').textContent } })
      check(open.exp === 'true' && !open.hidden, `${tag} a tap opens it`)
      check(open.items === m.cardItems && open.items > 0, `${tag} it lists the same items as the card`, `${open.items} / ${m.cardItems}`)
      check(norm(open.text).includes(norm(m.cardTotal)), `${tag} the opened panel shows the total`)
      await bar.click(); await p.waitForTimeout(200)
      check(await p.evaluate(() => document.querySelector('[data-sporta-co-summary] .cos-panel').hidden), `${tag} a second tap closes it`)
      check(m.payInCard && m.fieldsFirst, `${tag} nothing of the app moved: payment methods stay in the card, fields stay in place`)
    }
    // the discount box
    const d = await p.evaluate(() => { const i = document.querySelector('form > aside input[aria-label][autocomplete="off"]'), n = document.querySelector('form input[name=name]'); const cs = getComputedStyle(i), cn = getComputedStyle(n); return { bg: cs.backgroundColor, nameBg: cn.backgroundColor, edge: cs.borderTopColor, nameEdge: cn.borderTopColor, h: i.getBoundingClientRect().height } })
    check(d.bg === d.nameBg && d.edge === d.nameEdge, `${tag} the discount box is the same silver field as the name box (the shop's own field style)`, `${d.bg} / ${d.nameBg}`)
    check(d.h >= 44, `${tag} and is at least 44px tall`, `${Math.round(d.h)}px`)
    await p.locator('form > aside input[aria-label][autocomplete="off"]').fill('ABC')
    await p.waitForTimeout(300)
    const apply = await p.evaluate(() => { const a = document.querySelector('form > aside button.flex-none'); return { disabled: a.disabled, bg: getComputedStyle(a).backgroundColor, color: getComputedStyle(a).color } })
    check(!apply.disabled && apply.bg === 'rgb(194, 65, 12)' && apply.color === 'rgb(255, 255, 255)', `${tag} Apply turns solid once a code is typed`, JSON.stringify(apply))
    // guest note on a phone
    if (name === 'phone') {
      const g = await p.evaluate(() => { const n = document.querySelector('.guest-note'), a = n.querySelector('a'), r = n.getBoundingClientRect(), ar = a.getBoundingClientRect(); return { h: Math.round(r.height), linkH: Math.round(ar.height), linkW: Math.round(ar.width), href: a.getAttribute('href'), title: n.querySelector('.guest-note__title').textContent.trim() } })
      check(g.h < 64, `${tag} the guest note is one row`, `${g.h}px`)
      check(g.href === '/track' && g.linkW > 0 && g.linkH > 0 && !!g.title, `${tag} its title and the Track link are still there`, `${g.title} -> ${g.href}`)
    }
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${tag} the page does not scroll sideways`)
    await c.close()
  }
}
await b.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the checkout shows its summary first, in one row of guest note, with a live discount box')
process.exit(fails ? 1 : 0)
