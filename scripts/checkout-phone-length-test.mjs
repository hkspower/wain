/**
 * test:checkout-phone-length — CA-01 (2026-10-14, owner's choice: refuse with a message).
 *
 * The bundle keeps the first 8 digits of a phone and drops the rest on input, so a 9th digit used to
 * vanish under a green tick. checkout-fields.js now refuses an edit that would make the phone more than
 * 8 digits, before the bundle sees it, and says why under the field.
 *
 *   A  typing a 9th digit is refused: the field stays at 8 and the message says why, with no tick
 *   B  pasting 9 digits is refused the same way
 *   C  Arabic-Indic digits count the same: 9 of them are refused
 *   D  a +965 prefix with 8 digits is allowed and tidied on blur (the prefix is not counted)
 *   E  8 digits give the tick, and deleting back under the limit clears the refusal
 *
 * Run `bash scripts/sandbox.sh` first; uses the sandbox's checkout as a guest.
 * MUTATE=1 removes the refusal and A, B and C must fail.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname
const file = ROOT + 'sporta-site/public_html/assets/checkout-fields.js'

let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const orig = readFileSync(file, 'utf8')
if (process.env.MUTATE) {
  // Both guards: the beforeinput refusal and the input put-back. Without both, nothing refuses the 9th digit.
  writeFileSync(file, orig
    .replace("e.preventDefault(); e.stopImmediatePropagation(); overflow = true; touched.phone = true; paint('phone')", '')
    .replace('if (phoneDigits(el.value).length > 8) {', 'if (false) {'))
}

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const state = (p) => p.evaluate(() => {
  const f = document.getElementById('f-phone')
  const l = document.querySelector('label[for="f-phone"]')
  const c = l && l.parentElement
  const m = c && c.querySelector('[data-cf-msg]')
  return { value: f.value, cf: c && c.getAttribute('data-cf'), msg: m && !m.hidden ? m.textContent : '' }
})

try {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
  await p.goto(`${BASE}/product/vanquish-tank-navy?lang=en`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1800)
  await p.locator('button').filter({ hasText: /^L$/ }).first().click()
  await p.waitForTimeout(300)
  await p.locator('button').filter({ hasText: /^Buy now$/ }).first().click()
  await p.waitForTimeout(2500)
  const f = p.locator('#f-phone')
  check(await f.count() === 1, 'the checkout phone field is on the page')

  // A — type 8 valid digits, then a 9th
  await f.click(); await p.keyboard.type('55512345', { delay: 30 }); await p.waitForTimeout(200)
  await p.keyboard.type('6', { delay: 30 }); await p.waitForTimeout(250)
  let s = await state(p)
  check(s.value === '55512345', 'A a 9th digit is refused and the field keeps its 8', JSON.stringify(s.value))
  check(s.cf === 'bad' && /Only 8 digits/.test(s.msg), 'A the refusal says why, and there is no green tick', `${s.cf} "${s.msg}"`)

  // E (part) — deleting back under the limit clears the refusal, and 8 valid digits show the tick
  await p.keyboard.press('Backspace'); await p.waitForTimeout(250)
  s = await state(p)
  check(s.value === '5551234' && s.msg !== 'Only 8 digits: remove the extra digit', 'E deleting a digit clears the refusal', JSON.stringify(s))
  await p.keyboard.type('5', { delay: 30 }); await p.waitForTimeout(250)
  s = await state(p)
  check(s.value === '55512345' && s.cf === 'ok' && s.msg === '✓', 'E 8 valid digits show the tick', `${s.cf} "${s.msg}"`)

  // B — pasting 9 digits is refused too
  await f.fill(''); await p.waitForTimeout(150)
  await f.click()
  await p.evaluate(() => { const i = document.getElementById('f-phone'); const dt = new DataTransfer(); dt.setData('text', '998877661'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) })
  await p.keyboard.insertText('998877661'); await p.waitForTimeout(250)
  s = await state(p)
  check(s.value.length <= 8 && !(s.cf === 'ok' && s.value.length === 9), 'B nine pasted digits never reach the field as a valid number', JSON.stringify(s))

  // C — Arabic-Indic digits count the same
  await f.fill(''); await p.waitForTimeout(150)
  await f.click(); await p.keyboard.insertText('٩٩٨٨٧٧٦٦١'); await p.waitForTimeout(250)
  s = await state(p)
  check(s.cf !== 'ok' && s.value.length <= 8, 'C nine Arabic digits are refused', JSON.stringify(s))

  // D — +965 plus 8 digits is allowed, and is tidied on blur
  await f.fill(''); await p.waitForTimeout(150)
  await f.click(); await p.keyboard.insertText('+96555512345'); await p.waitForTimeout(250)
  await f.blur(); await p.waitForTimeout(300)
  s = await state(p)
  check(s.value === '55512345' && s.cf === 'ok', 'D +965 plus 8 digits is accepted and tidied to 8', JSON.stringify(s))
} finally {
  if (process.env.MUTATE) writeFileSync(file, orig)
  await b.close()
  console.log(fails ? `\n${fails} FAILED` : '\nall checkout phone-length checks passed')
  process.exitCode = fails ? 1 : 0
}
