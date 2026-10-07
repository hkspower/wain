// Read-only scan of every /backends screen: broken words, wrong language, clipped text, sideways scroll, errors.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EXE = execSync('ls -d /opt/pw-browsers/chromium-1194/*/chrome').toString().trim().split('\n')[0]
const SCREENS = ['Overview', 'Orders', 'Catalogue', 'Brands', 'Slides', 'Promotions', 'Discounts', 'Inventory', 'Settings', 'Payments', 'SEO', 'Setup', 'Reviews', 'Sporta AI', 'Notifications', 'Security']
const b = await chromium.launch({ executablePath: EXE })
const found = []
for (const lang of ['en', 'ar']) for (const [w, dev] of [[1280, 'desktop'], [390, 'phone']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, hasTouch: w < 500, isMobile: w < 500 })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push('JS ' + e.message.slice(0, 120)))
  p.on('response', (r) => { if (r.status() >= 400 && !/cats\/.*art-|favicon/.test(r.url())) errs.push(r.status() + ' ' + r.url().replace(BASE, '').slice(0, 90)) })
  await p.goto(BASE + '/backends?lang=' + lang, { waitUntil: 'networkidle' })
  if (await p.locator('input[type=password]').count()) {
    await p.fill('input[autocomplete^=username], input[type=email]', 'manager@sporta.com.kw')
    await p.fill('input[type=password]', 'correct horse')
    await p.locator('form button[type=submit], form button').first().click(); await p.waitForTimeout(2000)
  }
  // nav buttons in order, read once in this language
  const names = await p.evaluate(() => {
    const nav = document.querySelector('.admin-shell aside, .admin-shell nav') || document
    return [...nav.querySelectorAll('button, a')].filter((e) => e.offsetParent && e.textContent.trim()).map((e) => e.textContent.trim())
  })
  const tag0 = `${lang} ${dev}`
  for (let i = 0; i < SCREENS.length; i++) {
    const want = SCREENS[i]
    const opened = await p.evaluate(([want, i, lang]) => {
      const btns = [...document.querySelectorAll('.admin-shell button, .admin-shell a')].filter((e) => e.offsetParent || e.closest('nav,aside'))
      let el = btns.find((e) => e.textContent.trim() === want)
      if (!el && lang === 'ar') { const nav = document.querySelector('.admin-shell aside') ; if (nav) el = [...nav.querySelectorAll('button')][i] }
      if (!el) return false
      el.click(); return el.textContent.trim()
    }, [want, i, lang])
    if (!opened) { found.push(`${tag0} | ${want} | not found in navigation`); continue }
    await p.waitForTimeout(1300)
    const r = await p.evaluate((lang) => {
      const out = []
      const main = document.querySelector('.admin-content') || document.body
      const txt = main.innerText
      for (const m of txt.matchAll(/\b(undefined|NaN|null|\[object Object\]|Infinity)\b|\{\{|\$\{|TODO|lorem/gi)) out.push('broken word: ' + JSON.stringify(txt.slice(Math.max(0, m.index - 30), m.index + 30)))
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push('sideways scroll ' + document.documentElement.scrollWidth + '>' + innerWidth)
      const seen = new Set()
      for (const el of main.querySelectorAll('*')) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ')
        if (!own || el.closest('input,textarea,select,code,pre,table td')) continue
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetParent) continue
        if (lang === 'ar' && /[A-Za-z]{4,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(own) && !/[؀-ۿ]/.test(own) && !/@|https?:|\.php|\.com/.test(own)) { if (!seen.has(own)) { seen.add(own); out.push('English on Arabic panel: ' + JSON.stringify(own.slice(0, 60))) } }
        if (lang === 'en' && /[؀-ۿ]{3,}/.test(own) && !/[A-Za-z]{3,}/.test(own) && !el.closest('[dir=rtl],[lang=ar]') && own.length > 12) { if (!seen.has(own)) { seen.add(own); out.push('Arabic on English panel: ' + JSON.stringify(own.slice(0, 60))) } }
        const r = el.getBoundingClientRect()
        if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 2 && r.width > 20 && cs.whiteSpace !== 'nowrap') out.push('cut off: ' + JSON.stringify(own.slice(0, 40)))
        const inScroller = (() => { for (let x = el.parentElement; x && x !== main; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && x.scrollWidth > x.clientWidth) return true } return false })()
        if (!inScroller && r.right > innerWidth + 2 && r.width > 4) out.push('past the screen edge: ' + JSON.stringify(own.slice(0, 40)))
      }
      return out.slice(0, 12)
    }, lang)
    for (const x of r) found.push(`${tag0} | ${want} | ${x}`)
  }
  for (const e of [...new Set(errs)]) found.push(`${tag0} | (any) | ${e}`)
  await ctx.close()
}
await b.close()
console.log(found.length ? found.join('\n') : 'nothing found')
