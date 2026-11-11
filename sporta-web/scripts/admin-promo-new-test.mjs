// The "New promotion" button on the Promotions screen (public/sporta-admin-brands.js, block 9).
// Synthetic page: a sidebar with Overview / Promotions / Discounts, a header per screen, and a Discounts screen with a
// "New discount" button that counts its presses. Checks: the button shows only on Promotions; one click opens Discounts
// and presses its "New discount" exactly once; it is removed when the screen changes; a page without Promotions gets none.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public', 'sporta-admin-brands.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, name, info = '') => { if (c) { pass++; console.log('ok   ' + name) } else { fail++; console.log('FAIL ' + name + (info ? '  — ' + info : '')) } }

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
.admin-sidebar{position:fixed;left:0;top:0;width:200px}.admin-nav-item{display:block;padding:8px}
.admin-page{margin-left:220px}[hidden]{display:none!important}button{min-height:34px;padding:0 12px}
</style></head><body>
<aside class="admin-sidebar">
  <button class="admin-nav-item" data-go="overview">Overview</button>
  <button class="admin-nav-item" data-go="promotions">Promotions</button>
  <button class="admin-nav-item" data-go="discounts">Discounts</button>
</aside>
<main class="admin-content">
  <section class="admin-page" id="overview"><header class="admin-page-header"><div><h1>Overview</h1></div></header></section>
  <section class="admin-page" id="promotions" hidden><header class="admin-page-header"><div><h1>Promotions</h1></div></header><p>On sale</p></section>
  <section class="admin-page" id="discounts" hidden><header class="admin-page-header"><div><h1>Discounts</h1></div><button id="newd">New discount</button></header></section>
</main>
<script>
  window.__presses = 0
  document.getElementById('newd').addEventListener('click', function () { window.__presses++ })
  document.querySelectorAll('[data-go]').forEach(function (b) { b.addEventListener('click', function () {
    document.querySelectorAll('.admin-page').forEach(function (s) { s.hidden = s.id !== b.getAttribute('data-go') })
  }) })
</script></body></html>`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)))
await page.setContent(HTML)
await page.addScriptTag({ content: ADDON })
const go = (id) => page.click(`[data-go="${id}"]`)
const btnCount = () => page.evaluate(() => document.querySelectorAll('[data-sporta-promo-new]').length)

await page.waitForTimeout(700)
ok((await btnCount()) === 0, 'Overview has no "New promotion" button')

await go('promotions')
await page.waitForTimeout(700)
ok((await btnCount()) === 1, 'Promotions has exactly one "New promotion" button in its header',
  `count=${await btnCount()}`)
const inHeader = await page.evaluate(() => { const b = document.querySelector('[data-sporta-promo-new]'); return !!b && !!b.closest('.admin-page-header') && b.textContent.trim() === 'New promotion' })
ok(inHeader, 'the button sits in the page header and reads "New promotion"')

await page.click('[data-sporta-promo-new]')
await page.waitForTimeout(600)
const after = await page.evaluate(() => ({ disc: !document.getElementById('discounts').hidden, presses: window.__presses }))
ok(after.disc, 'one click opens the Discounts screen')
ok(after.presses === 1, 'and presses its "New discount" exactly once', `presses=${after.presses}`)

await go('promotions')
await page.waitForTimeout(700)
ok((await btnCount()) === 1, 'back on Promotions the button is there again (one, not two)', `count=${await btnCount()}`)

await go('overview')
await page.waitForTimeout(700)
ok((await btnCount()) === 0, 'leaving Promotions removes the button')

ok(errors.length === 0, 'no page errors', errors.join(' ; '))
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
