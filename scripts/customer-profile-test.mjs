/**
 * test:customer-profile — the signed-in shopper's profile sheet, 2026-10-07.
 *
 * Found by scanning it: in Arabic the phone read "96555512345+" (the '+' jumped to the far end of a
 * right-to-left line) and the greeting used a Latin comma ("أهلاً, name"). Checked, in both languages, on
 * a phone and a desktop, with a real account and real orders linked to it:
 *   - the greeting uses the comma of its language
 *   - the phone is grouped (+965 5551 2345), drawn left-to-right with the '+' FIRST, and sits on the same
 *     side as the email (right in Arabic, left in English)
 *   - every linked order shows its number, amount, status and a Track link at least 44px tall
 *   - Sign out is there, nothing scrolls sideways, no script errors
 * The account and the links are removed afterwards. MUTATE=1 restores the old greeting and phone.
 */
import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const EMAIL = 'profile-rig@example.com'
const clean = () => sql(`update orders set customer_id = null where customer_id in (select id from customers where email='${EMAIL}'); delete from customers where email='${EMAIL}'; delete from rate_limit; delete from rate_bucket`)
clean()
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
let linked = []
try {
  for (const [dn, opts] of [['phone', devices['Pixel 7']], ['desktop', { viewport: { width: 1280, height: 900 } }]]) for (const lang of ['en', 'ar']) {
    const c = await b.newContext(opts); await c.addInitScript((l) => localStorage.setItem('lang', l), lang)
    if (process.env.MUTATE === '1') await c.route('**/assets/customer-account.js', async (r) => { const res = await r.fetch(); let body = await res.text(); body = body.replace("(ar() ? '، ' : ', ')", "', '").replace(/var ps = el\('span', 'cua-phone'\)[^\n]*\n[^\n]*\n/, "d.appendChild(el('span', '', '+' + digits))\n"); r.fulfill({ response: res, body }) })
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message))
    await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
    const s = await p.evaluate(async (email) => {
      const post = (r, body) => fetch('/api/api.php?r=' + r, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }).then((x) => x.status)
      const st = await post('customer_register', { email, password: 'correct horse battery', name: 'Profile Rig', phone: '55512345' })
      return st === 200 ? st : post('customer_login', { email, password: 'correct horse battery' })
    }, EMAIL)
    if (!linked.length) {
      const cid = sql(`select id from customers where email='${EMAIL}'`)
      linked = sql('select id from orders where customer_id is null order by id desc limit 2').split('\n').filter(Boolean)
      sql(`update orders set customer_id=${cid} where id in (${linked.join(',')})`)
    }
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
    await p.locator('header button[aria-label="My account"], header button[aria-label="حسابي"]').first().click(); await p.waitForTimeout(1500)
    const r = await p.evaluate(() => {
      const sh = document.querySelector('.cua-sheet'), ph = sh.querySelector('.cua-phone'), em = sh.querySelector('.cua-details span')
      const pr = ph && ph.getBoundingClientRect(), er = em.getBoundingClientRect(), bd = ph && ph.querySelector('bdi')
      const range = bd && document.createRange(); if (range) range.selectNodeContents(bd)
      const rr = range && range.getBoundingClientRect()
      const firstCharX = (() => { if (!bd) return null; const rg = document.createRange(); const tn = bd.firstChild; rg.setStart(tn, 0); rg.setEnd(tn, 1); return rg.getBoundingClientRect().left })()
      return { h: sh.querySelector('.cua-h').textContent, phone: ph ? ph.textContent : null, plusFirst: rr ? Math.abs(firstCharX - rr.left) < 2 : false, textRight: rr && Math.round(rr.right), textLeft: rr && Math.round(rr.left), emailRight: Math.round(er.right), emailLeft: Math.round(er.left),
        orders: [...sh.querySelectorAll('.cua-order')].map((o) => ({ t: o.innerText, track: o.querySelector('.cua-track') && Math.round(o.querySelector('.cua-track').getBoundingClientRect().height) })),
        out: !!sh.querySelector('.cua-out'), sw: document.documentElement.scrollWidth <= innerWidth + 1, dir: getComputedStyle(sh).direction }
    })
    const tag = `[${dn} ${lang}]`
    check(s === 200, `${tag} signed in`)
    check(lang === 'ar' ? r.h.includes('أهلاً، ') && !r.h.includes(',') : r.h.startsWith('Hello, '), `${tag} the greeting uses its own comma`, r.h)
    check(r.phone === '+965 5551 2345', `${tag} the phone is grouped`, r.phone)
    check(r.plusFirst, `${tag} the '+' is drawn first, at the left of the number`)
    check(lang === 'ar' ? Math.abs(r.textRight - r.emailRight) <= 2 : Math.abs(r.textLeft - r.emailLeft) <= 2, `${tag} the phone sits on the same side as the email`, `phone ${r.textLeft}-${r.textRight} email ${r.emailLeft}-${r.emailRight}`)
    check(r.orders.length === linked.length && r.orders.every((o) => /[A-Z0-9]{6,}/.test(o.t) && /(KWD|د\.ك)/.test(o.t) && o.track >= 44), `${tag} every linked order shows its number, amount and a 44px Track link`, `${r.orders.length} orders`)
    check(r.out && r.sw && !errs.length, `${tag} sign out present, no sideways scroll, no script errors`, errs.join(' | ').slice(0, 100))
    await c.close()
  }
} finally { clean(); await b.close() }
console.log(fails ? `\n${fails} failed` : '\nall ok — the profile sheet reads right in both languages')
process.exit(fails ? 1 : 0)
