/**
 * test:page-language — every page speaks the language it was asked in, 2026-10-07.
 *
 * Found by scanning all pages' text: /card was Arabic-only (no English at all) and the returns box on
 * the English /returns page was Arabic. Two shapes of fault are checked on every page, in both
 * languages: an ENGLISH page with a line that is mostly Arabic, and an ARABIC page with a run of English
 * sentence words. Broken placeholders (undefined, NaN, {{ }}, [object) and mojibake fail any page.
 * Product, brand and size names are Latin on Arabic pages by design, so only a run of FOUR or more
 * plain English words counts there.
 *
 * Also: /card shows a real balance in both languages (a paid order is read from the database, the
 * expected words are the page's own dictionary's, not typed from the overlay), and its refusals speak.
 *
 * Category pages follow ?lang= in the URL (the English menu links carry it), so they are asked that way.
 * MUTATE=1 blocks card.js and returns-link.js (must fail).
 */
import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '-N', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
sql('delete from rate_limit; delete from rate_bucket')
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const BAD = /\b(undefined|NaN)\b|\[object|\{\{|\}\}|%[sd]\b|\$\{|\bTODO\b|lorem ipsum|�|Ã.|â€/i
const ar = (s) => (s.match(/[؀-ۿ]/g) || []).length, la = (s) => (s.match(/[A-Za-z]/g) || []).length
const PAGES = ['/', '/shop', '/about', '/contact', '/privacy', '/terms', '/returns', '/returns/request', '/track', '/cart', '/checkout', '/wishlist', '/card', '/men', '/women', '/accessories', '/outlet']

async function ctx(lang) {
  const c = await b.newContext(devices['Pixel 7'])
  await c.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  if (process.env.MUTATE === '1') { await c.route('**/assets/card.js', (r) => r.abort()); await c.route('**/assets/returns-link.js', (r) => r.abort()) }
  return c
}
async function lines(p) {
  return p.evaluate(() => {
    const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) {
      const n = w.currentNode, e = n.parentElement, t = n.textContent.replace(/\s+/g, ' ').trim()
      if (!t || !e || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(e.tagName)) continue
      const s = getComputedStyle(e), r = e.getBoundingClientRect()
      if (s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0) out.push(t)
    }
    return { lines: out, lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title }
  })
}

for (const lang of ['en', 'ar']) {
  const c = await ctx(lang), p = await c.newPage()
  for (const path of PAGES) {
    const url = BASE + path + (lang === 'en' && /^\/(men|women|accessories|outlet)$/.test(path) ? '?lang=en' : '')
    await p.goto(url, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
    const r = await lines(p)
    const broken = r.lines.filter((l) => BAD.test(l)).concat(BAD.test(r.title) ? [r.title] : [])
    const wrong = [...new Set(r.lines.filter((l) => lang === 'en' ? (ar(l) >= 4 && ar(l) > la(l)) : (/(?:[A-Za-z']{2,}[ ,.-]+){3}[A-Za-z']{2,}/.test(l) && ar(l) < la(l))))]
    check(!broken.length && !wrong.length, `[${lang}] ${path}`, JSON.stringify(broken.concat(wrong)).slice(0, 220))
  }
  await c.close()
}

// /card: the page itself, both languages
const paid = sql("select right(o.customer_phone, 8), o.track_id from orders o where o.payment_status = 'paid' and o.customer_phone regexp '^965[0-9]{8}$' order by o.id desc limit 1").split('\t')
check(paid.length === 2 && !!paid[1], 'the sandbox has a paid order to look up on /card', paid.join(' / '))
for (const lang of ['en', 'ar']) {
  const c = await ctx(lang), p = await c.newPage()
  await p.goto(`${BASE}/card`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  const h = await p.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir, h1: document.querySelector('h1').textContent, ph: document.getElementById('phone').placeholder, title: document.title }))
  check(h.lang === lang && h.dir === (lang === 'ar' ? 'rtl' : 'ltr'), `[${lang}] /card sets its language and direction`, `${h.lang} ${h.dir}`)
  check(lang === 'en' ? /^Loyalty card/.test(h.h1) && /Loyalty card/.test(h.title) && /^\d{8}$/.test(h.ph) : /بطاقة/.test(h.h1) && /[٠-٩]/.test(h.ph), `[${lang}] its heading, title and placeholder are in that language`, `${h.h1} | ${h.ph}`)
  // an empty submit speaks the page's language
  await p.locator('#go').click(); await p.waitForTimeout(300)
  const err = await p.locator('#error').textContent()
  check(lang === 'en' ? /not valid/.test(err) && !ar(err) : ar(err) > 5 && !/[A-Za-z]{4,}/.test(err), `[${lang}] a refusal speaks the page's language`, err.slice(0, 70))
  if (paid[1]) {
    await p.fill('#phone', paid[0]); await p.fill('#track', paid[1]); await p.locator('#go').click(); await p.waitForTimeout(1500)
    const res = await p.evaluate(() => ({ shown: !document.getElementById('result').hidden, who: document.getElementById('who').textContent, orders: document.getElementById('orders').textContent, tier: document.getElementById('tier').textContent, points: document.getElementById('points').textContent, back: document.querySelector('footer a').textContent }))
    check(res.shown, `[${lang}] a real lookup shows the balance`, `${res.points} points`)
    check(lang === 'en' ? /^(Hello|Welcome)/.test(res.who) && /paid order/.test(res.orders) && /^Level: /.test(res.tier) && /^[\d,]+$/.test(res.points) && /Back to the shop/.test(res.back)
      : /^أهل/.test(res.who) && /مدفوع/.test(res.orders) && /^المستوى: /.test(res.tier) && /[٠-٩]/.test(res.points), `[${lang}] its balance, orders and level are in that language`, `${res.who} | ${res.orders} | ${res.tier} | ${res.points}`)
  }
  await c.close()
}
// the returns box follows the page's language, both ways
for (const lang of ['en', 'ar']) {
  const c = await ctx(lang), p = await c.newPage()
  await p.goto(`${BASE}/returns`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
  const box = await p.evaluate(() => { const a = document.querySelector('a[data-sporta="returns-request"]'); return a ? { t: a.textContent, href: a.getAttribute('href'), lang: a.getAttribute('data-lang') } : null })
  check(!!box && box.href === '/returns/request' && box.lang === lang && (lang === 'en' ? /Request a return/.test(box.t) && !ar(box.t) : /اطلب الإرجاع/.test(box.t) && !/[A-Za-z]{4,}/.test(box.t)), `[${lang}] the returns box is in the page's language and still links to the request form`, box ? box.t.slice(0, 60) : 'missing')
  await c.close()
}
await b.close()
sql('delete from rate_limit; delete from rate_bucket')
console.log(fails ? `\n${fails} failed` : '\nall ok — every page speaks the language it was asked in')
process.exit(fails ? 1 : 0)
