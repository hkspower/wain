/**
 * Every write field on the website is soft silver — and the owner's panel is not.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/soft-silver-fields-test.mjs
 *
 * Asked for 2026-10-01: "add soft silver color to write fields all website". It reads the PAINTED
 * colour of the real fields on several pages in both themes (never the stylesheet), asserts the
 * fill is the silver and the ink on it reads at AA, checks the placeholder does too, and then the
 * other half: a field inside the /backends panel (.admin-content) is NOT silver, because the rule
 * was asked for the website and a rule that quietly restyled the owner's workspace is the failure
 * to catch. It counts the fields it found per page — a scan that found none passes everything.
 */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }
const SILVER = 'rgb(217, 221, 226)'
const lum = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((x) => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4 }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2] }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05) }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' })
const read = (p) => p.evaluate(() => [...document.querySelectorAll('input, textarea, select')]
  .filter((e) => !['hidden', 'checkbox', 'radio', 'range', 'file', 'submit', 'button'].includes(e.type) && !e.closest('.admin-content'))
  .filter((e) => e.getBoundingClientRect().width > 0)
  .map((e) => { const s = getComputedStyle(e); return { tag: e.tagName, bg: s.backgroundColor, ink: s.color, ph: e.placeholder ? getComputedStyle(e, '::placeholder').color : null } }))

for (const theme of ['dark', 'light']) {
  let total = 0
  for (const path of ['/track', '/shop', '/returns/request', '/checkout']) {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await p.goto(`${BASE}${path === '/checkout' ? '/product/vanquish-tank-navy' : path}${path.includes('?') ? '&' : '?'}lang=ar`)
    await p.evaluate((t) => localStorage.setItem('sporta_theme', t), theme)
    await p.reload(); await p.waitForTimeout(2200)
    if (path === '/checkout') {
      // the bag first, as a customer does it: a size, then Add — the checkout form is empty without one
      await p.locator('button').filter({ hasText: /^L$/ }).first().click()
      await p.locator('button').filter({ hasText: /^أضف$/ }).first().click(); await p.waitForTimeout(2000)
      await p.goto(`${BASE}/checkout?lang=ar`); await p.waitForTimeout(2200)
    }
    const f = await read(p)
    total += f.length
    const notSilver = f.filter((x) => x.bg !== SILVER)
    check(notSilver.length === 0, `${theme} ${path}: every field is soft silver (${f.length})`, JSON.stringify(notSilver.slice(0, 2)))
    const weak = f.filter((x) => ratio(x.ink, x.bg) < 4.5 || (x.ph && ratio(x.ph, x.bg) < 4.5))
    check(weak.length === 0, `${theme} ${path}: the ink and placeholder read at AA on it`, JSON.stringify(weak.slice(0, 2)))
    await p.close()
  }
  check(total >= 8, `${theme}: the scan found fields at all`, `${total}`)
}

// the other half: the panel keeps its own fields
const p = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
await p.locator('input').nth(0).fill('manager@sporta.com.kw'); await p.locator('input').nth(1).fill('correct horse')
await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click(); await p.waitForTimeout(3500)
await p.getByText('Settings', { exact: true }).first().click(); await p.waitForTimeout(2000)
const panel = await p.evaluate(() => [...document.querySelectorAll('.admin-content input[type=text], .admin-content input[type=password], .admin-content textarea, .admin-content select')]
  .filter((e) => e.getBoundingClientRect().width > 0).map((e) => getComputedStyle(e).backgroundColor))
check(panel.length >= 3, 'the panel was found, with fields in it', `${panel.length}`)
check(panel.every((c) => c !== SILVER), 'and none of the panel\'s own fields was turned silver', JSON.stringify([...new Set(panel)]))

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — every field on the website is soft silver; the panel is untouched')
process.exit(fails ? 1 : 0)
