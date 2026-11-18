// The CRM phone display and the Arabic-digit box (block "ADMIN CRM PHONES", public/sporta-admin-brands.js), on the live, compiled
// CRM's markup (class names read from the live CRM chunk on 2026-11-18). The server half is scripts/crm-phones-test.mjs.
//
//   npm run test:admin-crm-phones   (no database, no PHP: the REAL add-on file runs in Chromium against a fixture of the live markup)
//
// What is asserted:
//   0. static: markers; no interval, observer, HTML sink or console; no storage;
//   1. display: a number the API sent as 96598765432 is shown "+965 9876 5432" in the list row, the phone card and the contact page;
//      eight plain digits too; an e-mail, a name, "No phone recorded", a number the shop could not read, a number with a letter,
//      an element with other children and a phone-looking value outside the CRM are left alone; the WhatsApp link keeps its digits;
//   2. a list that arrives later (a search, "load more") and a row React rewrites are formatted again, with no timer left running;
//   3. the "Add phone contact" box: Arabic-Indic and Persian digits become ASCII as they are typed, the state the screen reads
//      (its own input handler) sees the ASCII digits, a normal number is untouched, and another phone box on the page is not touched;
//   4. nothing happens off /backends; evaluating the file twice changes nothing;
//   5. MUTATION: without the display rule, or without the digit rule, the matching check fails.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = ADDON.indexOf('/* ===== ADMIN CRM PHONES - begin')
const END = ADDON.indexOf('/* ===== ADMIN CRM PHONES - end')
const BLOCK = BEGIN >= 0 && END > BEGIN ? ADDON.slice(BEGIN, ADDON.indexOf('\n', END) + 1) : ''
const CODE = BLOCK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

// the live CRM's markup (list row, phone card, contact page, create form), with a tiny stand-in for React: render() writes the
// screen from `window.fxContacts`, and the create box keeps its state in window.fxState exactly as the screen's onChange does
const PAGE = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"></head><body>
<main class="admin-content"><div class="crm-page admin-page-layout"><header class="crm-head admin-page-header"><h1>Customer CRM</h1></header>
<form id="crm-create" class="crm-create"><label><span>Kuwait mobile number</span><input type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="5XXXXXXX" id="crm-num"></label></form>
<label><span>Other phone</span><input type="tel" id="other-num"></label>
<table><tbody id="rows"></tbody></table><div id="cards"></div><div id="drawer"></div></div></main>
<p dir="ltr" id="outside">96598765432</p>
<script>
window.fxState = { n: '' }
window.fxOther = ''
document.getElementById('crm-num').addEventListener('input', function (e) { window.fxState.n = e.target.value })
document.getElementById('other-num').addEventListener('input', function (e) { window.fxOther = e.target.value })
window.fxContacts = [
  { name: 'Account A', phone: '96598765432', source: 'account', email: 'a@example.test' },
  { name: 'Account B', phone: '98765432', source: 'account', email: 'b@example.test' },
  { name: 'Guest C', phone: '96550001234', source: 'phone', email: '' },
  { name: 'Account D', phone: 'ext 12', source: 'account', email: 'd@example.test' },
  { name: 'Account E', phone: '', source: 'account', email: 'e@example.test' },
  { name: 'Account F', phone: '9659876543A', source: 'account', email: 'f@example.test' },
]
function render() {
  var rows = document.getElementById('rows'), cards = document.getElementById('cards'), html = ''
  rows.textContent = ''; cards.textContent = ''
  window.fxContacts.forEach(function (c) {
    var tr = document.createElement('tr'), td = document.createElement('td'), b = document.createElement('button')
    b.className = 'crm-row-open'; b.type = 'button'; b.appendChild(document.createTextNode(c.name))
    var s = document.createElement('span'); s.setAttribute('dir', 'ltr'); s.textContent = c.phone || (c.source === 'account' ? c.email : '') || '—'
    b.appendChild(s); td.appendChild(b); tr.appendChild(td); rows.appendChild(tr)
    var card = document.createElement('span'); card.className = 'crm-mobile-card__phone'; card.setAttribute('dir', 'ltr'); card.textContent = c.phone || (c.source === 'account' ? c.email : '') || '—'
    cards.appendChild(card)
  })
}
window.fxRender = render
window.fxOpen = function (c) {
  var d = document.getElementById('drawer'); d.textContent = ''
  var back = document.createElement('div'); back.className = 'crm-backdrop'
  var aside = document.createElement('aside'); aside.className = 'crm-drawer'
  var p = document.createElement('p'); p.setAttribute('dir', 'ltr'); p.textContent = c.phone || 'No phone recorded'
  var wa = document.createElement('a'); wa.href = 'https://wa.me/' + c.phone; wa.textContent = 'Open WhatsApp'; wa.id = 'wa'
  var em = document.createElement('p'); em.setAttribute('dir', 'ltr'); em.textContent = c.email || ''
  var mixed = document.createElement('p'); mixed.setAttribute('dir', 'ltr'); mixed.id = 'mixed'; mixed.appendChild(document.createTextNode('96598765432')); mixed.appendChild(document.createElement('b'))
  aside.appendChild(p); aside.appendChild(em); aside.appendChild(wa); aside.appendChild(mixed); back.appendChild(aside); d.appendChild(back)
}
render()
</script>
<script src="/sporta-admin-brands.js"></script></body></html>`

async function open(browser, o = {}) {
  const { addon = ADDON, path = '/backends/crm' } = o
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const errors = [], calls = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { window.__timers = 0; const si = window.setInterval; window.setInterval = function () { window.__timers++; return si.apply(this, arguments) } })
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    if (u.pathname.startsWith('/backends') || u.pathname === '/other') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE })
    if (u.pathname === '/sporta-admin-brands.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: addon })
    calls.push(u.pathname + u.search)
    return route.fulfill({ status: u.pathname === '/api/admin.php' ? 404 : 404, contentType: 'application/json', body: '{}' })
  })
  await page.goto('https://admin.test' + path)
  await page.waitForTimeout(1000)
  return { ctx, page, errors, calls }
}
const texts = (page, sel) => page.$$eval(sel, (es) => es.map((e) => e.textContent))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] })
try {
  head('0. the block')
  is(BEGIN >= 0 && END > BEGIN, 'the block is in public/sporta-admin-brands.js with its begin and end markers')
  is(!/setInterval/.test(CODE) && !/MutationObserver|requestAnimationFrame/.test(CODE), 'no interval, no observer, no animation-frame scan')
  is(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|createElement/.test(CODE), 'no HTML sink, no eval, no element creation: only text nodes are written')
  is(!/console\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest/.test(CODE), 'no console, no storage, no request')

  head('1. the display')
  {
    const { ctx, page, errors, calls } = await open(browser)
    const rows = await texts(page, '.crm-row-open span'), cards = await texts(page, '.crm-mobile-card__phone')
    is(rows[0] === '+965 9876 5432' && cards[0] === '+965 9876 5432', 'a number sent as 96598765432 is shown "+965 9876 5432" in the list and on the phone card', `${rows[0]} | ${cards[0]}`)
    is(rows[1] === '+965 9876 5432', 'eight plain digits are shown the same way', rows[1])
    is(rows[2] === '+965 5000 1234', 'a guest contact', rows[2])
    is(rows[3] === 'ext 12' && cards[3] === 'ext 12', 'a stored value that is not a number is left as written', rows[3])
    is(rows[4] === 'e@example.test', 'an account with no number shows its e-mail, untouched', rows[4])
    is(rows[5] === '9659876543A', 'a value with a letter in it is left alone', rows[5])
    is(await page.$eval('#outside', (e) => e.textContent) === '96598765432', 'a number-looking text outside the CRM is not touched')
    await page.evaluate(() => window.fxOpen(window.fxContacts[0]))
    await page.locator('.crm-row-open').first().click()
    await page.waitForTimeout(200)
    const dr = await texts(page, '.crm-drawer p')
    is(dr[0] === '+965 9876 5432' && dr[1] === 'a@example.test', 'the contact page shows the readable number and leaves the e-mail', JSON.stringify(dr))
    is((await page.getAttribute('#wa', 'href')) === 'https://wa.me/96598765432', 'the WhatsApp link keeps its own digits')
    is((await page.$eval('#mixed', (e) => e.firstChild.nodeValue)) === '96598765432', 'an element that holds more than the number is left alone')
    // (the file's other blocks keep their own timers and read their own routes; this block's code is checked for both above)
    is(errors.length === 0, 'no page error', errors.join('|'))
    await ctx.close()
  }

  head('2. a list that arrives later')
  {
    const { ctx, page } = await open(browser)
    await page.evaluate(() => { window.fxContacts = [{ name: 'New X', phone: '96555221234', source: 'phone', email: '' }, { name: 'New Y', phone: '97766554433', source: 'phone', email: '' }]; window.fxRender() })
    is((await texts(page, '.crm-row-open span'))[0] === '96555221234', 'before anything is pressed the new list is as the API sent it (no observer is watching)')
    await page.locator('.crm-row-open').first().click()
    await page.waitForFunction(() => document.querySelector('.crm-row-open span').textContent === '+965 5522 1234', null, { timeout: 3000 })
    const t = await texts(page, '.crm-row-open span')
    is(t[0] === '+965 5522 1234' && t[1] === '97766554433', 'after the next click or input the new list is formatted; a number that is not a Kuwaiti mobile (977...) is left alone', JSON.stringify(t))
    await page.evaluate(() => { window.fxContacts[0].phone = '96599998888'; window.fxRender() })
    await page.keyboard.press('Tab'); await page.locator('#other-num').fill('1')
    await page.waitForFunction(() => document.querySelector('.crm-row-open span').textContent === '+965 9999 8888', null, { timeout: 3000 })
    is(true, 'a row rewritten by the screen is formatted again after an input')
    await ctx.close()
  }

  head('3. the Arabic-digit box')
  {
    const { ctx, page } = await open(browser)
    const box = page.locator('#crm-num')
    await box.click()
    await page.keyboard.type('٩٨٧٦٥٤٣٢')
    is((await box.inputValue()) === '98765432' && (await page.evaluate(() => window.fxState.n)) === '98765432', 'Arabic-Indic digits become ASCII as they are typed, and the screen\'s state holds the ASCII digits', await box.inputValue())
    await box.fill('')
    await page.keyboard.type('۹۸۷۶۵۴۳۲')
    is((await box.inputValue()) === '98765432' && (await page.evaluate(() => window.fxState.n)) === '98765432', 'Persian digits too')
    await box.fill('')
    await page.keyboard.type('+965 9876-5432')
    is((await box.inputValue()) === '+965 9876-5432' && (await page.evaluate(() => window.fxState.n)) === '+965 9876-5432', 'a number typed in ASCII is left exactly as typed')
    await box.fill('')
    await page.keyboard.type('٥٥٢٢1234')
    is((await box.inputValue()) === '55221234', 'mixed digits are all made ASCII')
    await page.locator('#other-num').click()
    await page.keyboard.type('٩٨٧')
    is((await page.locator('#other-num').inputValue()) === '٩٨٧' && (await page.evaluate(() => window.fxOther)) === '٩٨٧', 'another phone box on the page is not touched')
    await ctx.close()
  }

  head('4. elsewhere, and twice')
  {
    let { ctx, page } = await open(browser, { path: '/other' })
    await page.locator('body').click()
    await page.waitForTimeout(300)
    is((await texts(page, '.crm-row-open span'))[0] === '96598765432', 'off /backends nothing is rewritten')
    await ctx.close()
    ;({ ctx, page } = await open(browser))
    await page.addScriptTag({ content: ADDON })
    await page.locator('.crm-row-open').first().click()
    await page.waitForTimeout(300)
    is((await texts(page, '.crm-row-open span'))[0] === '+965 9876 5432', 'evaluating the file twice changes nothing (one block, one set of listeners)')
    await ctx.close()
  }

  head('5. mutation')
  {
    const mutate = (a, b) => { const out = ADDON.replace(a, b); if (out === ADDON) throw new Error('mutation did not apply: ' + a); return out }
    const shown = async (addon) => { const { ctx, page } = await open(browser, { addon }); const v = (await texts(page, '.crm-row-open span'))[0]; await ctx.close(); return v }
    is((await shown(ADDON)) === '+965 9876 5432' && (await shown(mutate("if (m) n.nodeValue = pretty(m[1])", "if (false) n.nodeValue = pretty(m[1])"))) === '96598765432', 'without the display rule the number stays eleven plain digits')
    const typed = async (addon) => { const { ctx, page } = await open(browser, { addon }); await page.locator('#crm-num').click(); await page.keyboard.type('٩٨'); const v = await page.evaluate(() => window.fxState.n); await ctx.close(); return v }
    is((await typed(ADDON)) === '98' && (await typed(mutate("if (next === t.value) return", "return"))) === '٩٨', 'without the digit rule the screen\'s state holds Arabic digits')
  }
} finally {
  await browser.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
