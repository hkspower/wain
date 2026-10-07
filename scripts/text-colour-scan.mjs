/**
 * Every text colour on the shop, in the states site-contrast.mjs never opens. node scripts/text-colour-scan.mjs
 *
 * site-contrast.mjs reads ten pages at 1280px, in English, at rest. This adds: phones, Arabic, the category
 * pages, /track with a result and its progress panel, /wishlist, the 404, the stand-alone returns form, a
 * filled checkout with its live hints showing, and the things that only exist once opened — the account
 * sheet (both views), the quick-add size panel, the bag drawer and the notification-free storefront header.
 *
 * MEASURED THE SAME WAY (WCAG 2.1 luminance, AA: 4.5:1, or 3:1 for 24px / 18.66px bold), with one
 * correction: a translucent background is COMPOSITED onto what is under it rather than skipped, because
 * this shop paints cards as rgba(255,255,255,.05) on a dark page and skipping them measures the text
 * against the wrong colour. Text over a photograph or gradient is counted and skipped, as there.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0, checked = 0, photo = 0
const bad = new Map()
const check = (ok, w, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${w}${d ? '   ' + d : ''}`) }

const MEASURE = () => {
  const lum = (c) => { const v = c.slice(0, 3).map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true }); const memo = new Map()
  const parse = (s) => { if (memo.has(s)) return memo.get(s); let v
    if (/^rgba?\(/.test(s)) { v = (s.match(/[\d.]+/g) || []).map(Number); if (v.length === 3) v.push(1) }
    else { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; v = [d[0], d[1], d[2], d[3] / 255] }
    memo.set(s, v); return v }
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) }
  const ground = (el) => {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage !== 'none' && !/^none$/.test(cs.backgroundImage)) return { photo: true }
      const c = parse(cs.backgroundColor)
      if (c[3] > 0.01) { layers.push(c); if (c[3] >= 0.99) break }
    }
    let base = [255, 255, 255, 1]
    if (!layers.length || layers[layers.length - 1][3] < 0.99) base = parse(getComputedStyle(document.body).backgroundColor).slice(0, 3).concat(1)
    for (let i = layers.length - 1; i >= 0; i--) base = layers[i][3] >= 0.99 ? layers[i] : over(layers[i], base)
    return { rgb: base }
  }
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('script,style,noscript,svg,[aria-hidden="true"]')) continue
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity < 0.2) continue
    let fg = parse(cs.color); if (fg[3] < 0.3) continue
    const g = ground(el); const text = el.textContent.trim().slice(0, 28)
    if (g.photo) { out.push({ photo: 1 }); continue }
    if (fg[3] < 0.99) fg = over(fg, g.rgb)
    const [x, y] = [lum(fg), lum(g.rgb)].sort((a, b) => b - a)
    const size = parseFloat(cs.fontSize), boldish = parseInt(cs.fontWeight, 10) >= 700
    const need = size >= 24 || (boldish && size >= 18.66) ? 3 : 4.5
    out.push({ ratio: (x + 0.05) / (y + 0.05), need, text, fg: 'rgb(' + fg.slice(0, 3).map(Math.round).join(',') + ')', bg: 'rgb(' + g.rgb.slice(0, 3).map(Math.round).join(',') + ')', cls: (el.className && el.className.toString ? el.className.toString() : el.tagName).slice(0, 36) })
  }
  return out
}

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const record = (label, rows) => {
  for (const r of rows) {
    if (r.photo) { photo++; continue }
    checked++
    if (r.ratio + 1e-6 < r.need) {
      const k = `${r.cls}|${r.fg} on ${r.bg}`
      if (!bad.has(k)) bad.set(k, { ...r, where: label })
    }
  }
}
sql("delete from orders where track_id='SPCOLRIG1'")
sql("insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, created_at) values ('SPCOLRIG1', 9, 'pending', 'cod', 'shipped', 'Colour Rig', '55512345', now())")
try {
  for (const [w, touch] of [[390, true], [1280, false]]) for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, hasTouch: touch, isMobile: touch }); const p = await ctx.newPage()
    const go = async (u) => { await p.goto(`${BASE}${u}${u.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(900) }
    const L = (s) => `${w}px ${lang} ${s}`
    for (const u of ['/', '/shop', '/men', '/women', '/product/cheetahs-rugby-t-shirt', '/about', '/contact', '/returns', '/terms', '/privacy', '/wishlist', '/nope', '/returns/request', '/cart']) { await go(u); record(L(u), await p.evaluate(MEASURE)) }
    // track result + progress
    await go('/track'); await p.locator('main form input').first().fill('SPCOLRIG1'); await p.locator('main form button').first().click(); await p.waitForTimeout(1500)
    record(L('/track result'), await p.evaluate(MEASURE))
    // quick-add panel open
    await go('/shop'); const qa = p.locator('.qas-btn').first(); if (await qa.count()) { await qa.click(); await p.waitForTimeout(400); record(L('quick-add panel'), await p.evaluate(MEASURE)) }
    // bag drawer + checkout with hints
    await go('/product/cheetahs-rugby-t-shirt'); await p.locator('button').filter({ hasText: /^L$/ }).first().click().catch(() => {})
    await p.locator('button').filter({ hasText: lang === 'ar' ? /^أضف$/ : /^Add$/ }).first().click().catch(() => {}); await p.waitForTimeout(1200)
    record(L('bag drawer'), await p.evaluate(MEASURE))
    await go('/checkout'); await p.locator('#f-phone').fill('123').catch(() => {}); await p.locator('#f-name').fill('A').catch(() => {}); await p.locator('#f-email').focus().catch(() => {}); await p.waitForTimeout(400)
    record(L('checkout with hints'), await p.evaluate(MEASURE))
    // account sheet: sign-in form with an error
    await go('/'); await p.locator('[data-cua-btn]').click(); await p.locator('#cua-email').fill('x@example.com'); await p.locator('#cua-pw').fill('wrong-password-1'); await p.locator('.cua-go').click(); await p.waitForTimeout(900)
    record(L('account sheet'), await p.evaluate(MEASURE))
    await ctx.close()
  }
} finally { sql("delete from orders where track_id='SPCOLRIG1'"); sql('delete from rate_limit; delete from rate_bucket'); await b.close() }

console.log(`     ${checked} runs of text measured, ${photo} over a photograph (skipped)`)
const list = [...bad.values()].sort((a, b) => a.ratio - b.ratio)
for (const r of list) console.log(`  ${r.ratio.toFixed(2)}:1 < ${r.need}  "${r.text}"  ${r.fg} on ${r.bg}  .${r.cls}  (${r.where})`)
check(checked > 3000, 'a real number of text runs was measured', String(checked))
check(list.length === 0, 'every text colour meets WCAG AA against what is really behind it', `${list.length} distinct failing pairs`)
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
