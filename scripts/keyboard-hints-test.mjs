/** keyboard-hints.js: adds missing keyboard attributes, never overrides. node scripts/keyboard-hints-test.mjs (sandbox on :4300) */
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, w) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}`) }
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
await p.goto(`${BASE}/shop`, { waitUntil: 'networkidle' })
check(await p.evaluate(() => !!document.querySelector('script[src*="keyboard-hints.js"]')), 'the script is on the page')
await p.evaluate(() => {
  const d = document.createElement('div')
  d.innerHTML = `<input id=a type=email><input id=b type=tel><input id=c type=password><input id=d type=text autocomplete=name>
    <input id=e type=text autocomplete=address-line1><input id=f type=search><input id=g type=text autocomplete=one-time-code>
    <input id=h type=email inputmode=text autocapitalize=sentences><textarea id=i></textarea><input id=j type=text name=coupon_code>`
  document.body.appendChild(d)
})
await p.waitForTimeout(600)
const at = (id, k) => p.evaluate(([i, k]) => document.getElementById(i).getAttribute(k), [id, k])
check(await at('a', 'inputmode') === 'email' && await at('a', 'autocapitalize') === 'none' && await at('a', 'autocorrect') === 'off', 'email: email keyboard, no capital, no autocorrect')
check(await at('b', 'inputmode') === 'tel', 'phone: number pad')
check(await at('c', 'autocapitalize') === 'none' && await at('c', 'spellcheck') === 'false', 'password: no capital, no spellcheck')
check(await at('d', 'autocapitalize') === 'words', 'name: capitalise words')
check(await at('e', 'autocapitalize') === 'words', 'address: capitalise words')
check(await at('f', 'enterkeyhint') === 'search', 'search: Search key')
check(await at('g', 'inputmode') === 'numeric', 'one-time code: number pad')
check(await at('h', 'inputmode') === 'text' && await at('h', 'autocapitalize') === 'sentences', 'an attribute the page already set is NOT overridden')
check(await at('i', 'autocapitalize') === null, 'textarea untouched')
check(await at('j', 'autocapitalize') === 'none', 'a code box: no capital')
await b.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
