// The five things asked for at checkout, asserted on a phone in both languages:
// guest checkout, autofill, a numeric keyboard for the phone, one column, and a
// progress indicator.
//
//   node scripts/checkout-mobile-test.mjs [baseUrl]
//
// Each check corresponds to something that was measured wrong at 390pt before:
//   * block / street / building shared one row at 97px each — three adjacent
//     targets too narrow to show the word "Street", never mind a value;
//   * not one field carried a `name`, which is autofill's main heuristic;
//   * the governorate had no autocomplete at all, so a browser could not fill
//     the administrative area;
//   * the area field was `disabled` until a governorate was chosen, so a browser
//     filling a whole saved address could not write to it;
//   * nothing carried enterKeyHint, so the keyboard's action key never said Next;
//   * an Arabic keyboard types 9 as U+0669 and /\D/ deleted it, so the phone
//     field silently refused every keystroke from half the shop's customers.
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:4173'
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
let fails = 0
const check = (ok, what) => { if (!ok) fails++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`) }

for (const lang of ['en', 'ar']) {
  const p = await b.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 3 })
  await p.addInitScript((l) => localStorage.setItem('lang', l), lang)
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e)))
  await p.goto(BASE + '/product/sculpt-top-grey', { waitUntil: 'networkidle' })
  // :not([disabled]) matters: the size ladder now draws S..5XL and strikes out
  // the ones this piece is not carried in, so "the first chip" is often a size
  // that cannot be clicked at all.
  await p.click('[role=group] button:not([disabled])')
  // By role+position, not by label: the Arabic label carries a diacritic and
  // matching localised copy in a test is a way to fail on a copy edit.
  await p.locator('.action-bar button').first().click()
  await p.waitForTimeout(700)
  console.log(`\n--- ${lang} @390pt`)
  check(p.url().endsWith('/checkout'), 'reached /checkout')

  // One column: no two form controls may share a horizontal band.
  const boxes = await p.$$eval('#f-block,#f-street,#f-building,#f-floor,#f-flat,#f-name,#f-area',
    (els) => els.map((e) => ({ id: e.id, x: Math.round(e.getBoundingClientRect().x), w: Math.round(e.getBoundingClientRect().width), y: Math.round(e.getBoundingClientRect().y) })))
  const rows = {}
  for (const bx of boxes) { (rows[bx.y] ??= []).push(bx.id) }
  const shared = Object.entries(rows).filter(([, ids]) => ids.length > 1)
  check(shared.length === 0, `one field per row (${shared.length ? JSON.stringify(shared) : 'all stacked'})`)
  check(boxes.every((bx) => bx.w > 250), `every field wider than 250px (narrowest ${Math.min(...boxes.map((x) => x.w))}px)`)

  // Autofill + keyboard attributes
  const attrs = await p.$$eval('#f-name,#f-phone,#f-governorate,#f-area,#f-block,#f-street,#f-building',
    (els) => els.map((e) => ({ id: e.id, name: e.getAttribute('name'), ac: e.getAttribute('autocomplete'),
      im: e.getAttribute('inputmode'), ekh: e.getAttribute('enterkeyhint'), disabled: e.disabled })))
  check(attrs.every((a) => a.name), 'every field has a name attribute')
  check(attrs.every((a) => a.ac), 'every field has autocomplete')
  // Not the <select>: a native picker has no soft keyboard, so enterKeyHint is
  // meaningless on it — asserting it there would be asserting noise.
  check(attrs.filter((a) => a.id !== 'f-governorate').every((a) => a.ekh),
    'every text field has enterKeyHint')
  check(!attrs.find((a) => a.id === 'f-area').disabled, 'area is not disabled (autofill can write it)')
  const ph = attrs.find((a) => a.id === 'f-phone')
  check(ph.im === 'numeric' && ph.ac === 'tel-national', 'phone: numeric keyboard + tel-national')

  // Guest checkout stated, progress indicator present
  const txt = await p.textContent('body')
  check(/No account needed|لا حاجة لإنشاء حساب/.test(txt), 'guest checkout is stated')
  check(await p.$('nav[aria-label*="Step"], nav[aria-label*="الخطوة"]') !== null, 'progress indicator present')
  const step = await p.$eval('[aria-current=step]', (e) => e.textContent.trim())
  check(/Delivery|التوصيل/.test(step), `current step is Delivery (got "${step}")`)

  // Arabic-Indic digits must reach the phone field
  await p.fill('#f-phone', '')
  await p.type('#f-phone', '٩٩٨٨٧٧٦٦')
  check((await p.inputValue('#f-phone')) === '99887766', `Arabic digits accepted (got "${await p.inputValue('#f-phone')}")`)
  await p.fill('#f-phone', '+965 9988 7766')
  check((await p.inputValue('#f-phone')) === '99887766', `pasted international number cleaned (got "${await p.inputValue('#f-phone')}")`)

  // Typing the area alone should resolve the governorate
  await p.fill('#f-area', lang === 'ar' ? 'السالمية' : 'Salmiya')
  check((await p.inputValue('#f-governorate')) === 'hawalli', `area fills governorate (got "${await p.inputValue('#f-governorate')}")`)

  check(errs.length === 0, `no console errors ${errs.length ? errs.join(' | ') : ''}`)
  await p.close()
}
await b.close()
console.log(fails ? `\n${fails} FAILED` : '\nall checks passed')
process.exitCode = fails ? 1 : 0
