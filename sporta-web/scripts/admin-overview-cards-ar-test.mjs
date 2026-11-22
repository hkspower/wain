// OVERVIEW CARDS IN ARABIC (owner request 2026-11-22: "make cards setup ar backends"): the words on the Overview screen's cards are shown
// in Arabic when the admin page is Arabic, the numbers and the other screens are not changed, and English comes back when the page is
// English (public/sporta-admin-brands.js, block "ADMIN OVERVIEW CARDS AR").
//
//   npm run test:admin-overview-cards-ar   (rig-free: the page is a fixture with the Overview's markup; the REAL add-on block is on it)
//
// What is asserted:
//   ar        - the title, the line, the four figure cards and the five small cards are in Arabic; "3 orders" becomes "3 طلب"; the numbers
//               and money are unchanged; nothing the block does not know is touched (a chart title stays English)
//   en        - on an English page the same words are English (the page as it was)
//   revert    - switching the page from Arabic to English puts the English words back exactly (data-spt-ov-en)
//   screens   - on another screen (Orders) nothing is translated
//   errors    - no page error
//   MUTATIONS - the number notes ("N orders") and the revert are each cut in turn; each must turn its check red
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRANDS_JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const ORIGIN = 'https://sporta.test'
const BEGIN = '/* ===== ADMIN OVERVIEW CARDS AR - begin'
const END = '/* ===== ADMIN OVERVIEW CARDS AR - end'
const BLOCK = BRANDS_JS.slice(BRANDS_JS.indexOf(BEGIN), BRANDS_JS.indexOf('*/', BRANDS_JS.indexOf(END)) + 2)
if (BRANDS_JS.indexOf(BEGIN) < 0 || BRANDS_JS.indexOf(END) < 0 || BRANDS_JS.indexOf(BEGIN) !== BRANDS_JS.lastIndexOf(BEGIN)) {
  console.log('FAIL the ADMIN OVERVIEW CARDS AR block is missing or appears twice'); process.exit(1)
}

let pass = 0, fail = 0, pageErrors = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)

const OVERVIEW = `<section class="admin-page"><header><h1>Overview</h1><p class="mt-1">Live figures from the orders table.</p></header>
<div class="grid"><div class="kpi"><p>Revenue (paid)</p><p>KWD 1,250.000</p><p>3 orders</p></div>
<div class="kpi"><p>Today</p><p>KWD 40.000</p><p>2 paid today</p></div>
<div class="kpi"><p>Last 7 days</p><p>KWD 300.000</p><p>9 paid</p></div>
<div class="kpi"><p>Awaiting shipment</p><p>4</p><p>paid, not yet sent</p></div></div>
<div class="chart"><p>Revenue, last 14 days</p></div>
<div class="grid"><div><p>Pending</p><p>5</p></div><div><p>Cash to collect</p><p>2</p><p>KWD 8.000</p></div>
<div><p>Needs review</p><p>0</p></div><div><p>Failed</p><p>1</p></div><div><p>Products live</p><p>32</p></div></div></section>`
const ORDERS = `<section class="admin-page"><header><h1>Orders</h1></header><p>Pending</p><p>3 orders</p></section>`

function pageHtml(lang, body) {
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>Sporta admin</title></head>`
    + `<body><div class="admin-shell">${body}</div><script src="/sporta-ov.js"></script></body></html>`
}
async function open(lang, body, js) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', () => { pageErrors++ })
  await page.route('**/sporta-ov.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: js }))
  await page.route(`${ORIGIN}/backends**`, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml(lang, body) }))
  await page.goto(`${ORIGIN}/backends?tab=overview`, { waitUntil: 'load' })
  await page.waitForTimeout(250)
  return { ctx, page }
}
let browser
const texts = (page) => page.evaluate(() => Array.from(document.querySelectorAll('p,h1')).map((e) => e.textContent.trim()))

async function runAll(js, print) {
  const r = {}
  const ok = (name, cond, msg, detail) => { r[name] = !!cond; if (print) is(!!cond, msg, detail) }

  const A = await open('ar', OVERVIEW, js)
  const ar = await texts(A.page)
  ok('title', ar.includes('نظرة عامة') && ar.includes('أرقام حيّة من جدول الطلبات.'), 'the title and its line are in Arabic')
  ok('kpis', ar.includes('الإيراد (المدفوع)') && ar.includes('اليوم') && ar.includes('آخر 7 أيام') && ar.includes('بانتظار الشحن') && ar.includes('مدفوع، لم يُرسل بعد'),
    'the four figure cards are in Arabic')
  ok('minis', ar.includes('قيد الانتظار') && ar.includes('نقد للتحصيل') && ar.includes('يحتاج مراجعة') && ar.includes('فشلت') && ar.includes('منتجات معروضة'),
    'the five small cards are in Arabic')
  ok('notes', ar.includes('3 طلب') && ar.includes('2 مدفوع اليوم') && ar.includes('9 مدفوع'), 'the notes keep their number: "3 طلب", "2 مدفوع اليوم", "9 مدفوع"', ar.join(' | '))
  ok('numbers', ar.includes('KWD 1,250.000') && ar.includes('4') && ar.includes('32') && ar.includes('KWD 8.000'), 'the money and the numbers are unchanged')
  ok('unknown', ar.includes('Revenue, last 14 days'), 'a text the block does not know (the chart title) stays English')
  await A.ctx.close()

  const E = await open('en', OVERVIEW, js)
  const en = await texts(E.page)
  ok('english', en.includes('Overview') && en.includes('Today') && en.includes('3 orders') && !en.includes('نظرة عامة'), 'on an English page the words are English')
  await E.ctx.close()

  const S = await open('ar', OVERVIEW, js)
  await S.page.evaluate(() => { document.documentElement.setAttribute('lang', 'en'); document.documentElement.setAttribute('dir', 'ltr') })
  await S.page.evaluate(() => { document.querySelector('.admin-page').appendChild(document.createElement('i')) })
  await S.page.waitForTimeout(300)
  const back = await texts(S.page)
  ok('revert', back.includes('Overview') && back.includes('Awaiting shipment') && back.includes('3 orders') && back.includes('Pending') && !back.includes('نظرة عامة'),
    'switching the page to English puts the English words back', back.slice(0, 6).join(' | '))
  await S.ctx.close()

  const O = await open('ar', ORDERS, js)
  const ord = await texts(O.page)
  ok('screens', ord.includes('Orders') && ord.includes('Pending') && ord.includes('3 orders'), 'on another screen nothing is translated')
  await O.ctx.close()

  ok('errors', pageErrors === 0, 'no page error', String(pageErrors))
  return r
}

browser = await chromium.launch()
head('the Overview cards')
await runAll(BLOCK, true)

head('MUTATIONS (each must turn its check red)')
const MUTANTS = [
  { name: 'the number notes are not translated', from: "[/^(\\d+) orders$/, '$1 طلب'],", to: '', check: 'notes' },
  { name: 'the English words are not put back', from: "e.textContent = e.getAttribute(ATTR)", to: '', check: 'revert' }
]
for (const m of MUTANTS) {
  const at = BLOCK.indexOf(m.from)
  if (at < 0 || BLOCK.indexOf(m.from, at + 1) >= 0) { is(false, `mutant "${m.name}" applies to exactly one place`); continue }
  const res = await runAll(BLOCK.replace(m.from, m.to), false)
  is(res[m.check] === false, `mutant "${m.name}" turns "${m.check}" red`, `check was ${res[m.check]}`)
}
await browser.close()
console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
