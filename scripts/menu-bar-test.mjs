/**
 * The menu bar under the top bar, and the strip's picture + fixed delivery line — 2026-10-02.
 *   bash scripts/sandbox.sh && node scripts/menu-bar-test.mjs
 * Real browser, phone (touch) and desktop, both languages:
 *   - the five links, in order, with the right hrefs, ?lang=en carried;
 *   - the bar is INSIDE the sticky header and the whole header stays at y=0 after a long scroll,
 *     including the bundle's slide-away `.is-hidden` (measured by position, not by the class);
 *   - the page never scrolls sideways; links are >=44px tall; the current page is marked;
 *   - category pages (server-rendered) have the same bar; /backends has none;
 *   - the features strip has its picture, three rows, "1 KWD" on the delivery line, is rebuilt
 *     zero times when nothing changes (it used to re-create itself on every observer tick).
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

const LABELS = { en: ['Men', 'Women', 'Accessories', 'Outlet', 'All products'], ar: ['رجالي', 'نسائي', 'إكسسوارات', 'سبورتا أوتلت', 'كل المنتجات'] }
const PATHS = ['/men', '/women', '/accessories', '/outlet', '/shop']

for (const [name, vp, touch] of [['phone', { width: 390, height: 800 }, true], ['desktop', { width: 1280, height: 800 }, false]]) {
  for (const lang of ['en', 'ar']) {
    for (const page of ['/', '/men']) {
      const tag = `${name} ${lang} ${page}`
      const p = await browser.newPage({ viewport: vp, hasTouch: touch, isMobile: touch })
      await p.goto(`${BASE}${page}?lang=${lang}`, { waitUntil: 'networkidle' })
      await p.waitForSelector('.sp-menubar', { timeout: 8000 }).catch(() => {})
      const bars = await p.locator('.sp-menubar').count()
      check(bars === 1, `${tag}: exactly one menu bar`, `found ${bars}`)
      const links = await p.evaluate(() => [...document.querySelectorAll('.sp-menubar a')].map((a) => ({ t: a.textContent.trim(), h: new URL(a.href).pathname, q: new URL(a.href).search, ht: a.getBoundingClientRect().height, cur: a.getAttribute('aria-current') })))
      check(JSON.stringify(links.map((l) => l.t)) === JSON.stringify(LABELS[lang]), `${tag}: labels`, links.map((l) => l.t).join('|'))
      check(JSON.stringify(links.map((l) => l.h)) === JSON.stringify(PATHS), `${tag}: hrefs`)
      check(links.every((l) => (lang === 'en') === (l.q === '?lang=en')), `${tag}: language carried only for English`)
      check(links.every((l) => l.ht >= 44), `${tag}: every link >= 44px tall`, links.map((l) => Math.round(l.ht)).join(','))
      check(links.filter((l) => l.cur).map((l) => l.h).join() === (page === '/men' ? '/men' : ''), `${tag}: current page marked`)
      // sticky: scroll far, the header (top bar + menu) must still be at y=0
      await p.mouse.wheel(0, 2500)
      await p.waitForTimeout(700)
      await p.mouse.wheel(0, 800)
      await p.waitForTimeout(700)
      const m = await p.evaluate(() => {
        const h = document.querySelector('header.app-header'), b = document.querySelector('.sp-menubar')
        const hr = h.getBoundingClientRect(), br = b.getBoundingClientRect()
        return { top: Math.round(hr.top), insideHeader: h.contains(b), barTop: Math.round(br.top), barBottom: Math.round(br.bottom), hb: Math.round(hr.bottom), sw: document.documentElement.scrollWidth, iw: innerWidth, y: Math.round(scrollY) }
      })
      check(m.y > 500, `${tag}: it really scrolled`, `y=${m.y}`)
      check(m.insideHeader, `${tag}: the bar is inside the sticky header`)
      check(m.top === 0 && m.barTop >= 40 && m.barBottom === m.hb, `${tag}: top bar + menu still at the top after scrolling`, JSON.stringify(m))
      check(m.sw <= m.iw, `${tag}: no sideways scroll`, `${m.sw} > ${m.iw}`)
      await p.close()
    }
  }
}

// /backends has no menu bar
{
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  check(await p.locator('.sp-menubar').count() === 0, '/backends has no menu bar')
  await p.close()
}

// the features strip
for (const lang of ['en', 'ar']) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await p.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.sts-wrap', { timeout: 8000 }).catch(() => {})
  await p.evaluate(() => { window.__swaps = 0; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('sts-wrap')) window.__swaps++ }).observe(document.body, { childList: true, subtree: true }) })
  await p.waitForTimeout(2500)
  const s = await p.evaluate(() => {
    const w = document.querySelector('.sts-wrap'); if (!w) return null
    const img = w.querySelector('img.sts-pic')
    return { rows: w.querySelectorAll('.sts-item').length, texts: [...w.querySelectorAll('.sts-text')].map((t) => t.textContent), img: !!img && img.complete && img.naturalWidth > 0, swaps: window.__swaps,
      titleColour: getComputedStyle(w.querySelector('.sts-title')).color }
  })
  check(!!s, `${lang}: the features section is on the home page`)
  if (!s) { await p.close(); continue }
  check(s.rows === 3, `${lang}: three rows`, String(s.rows))
  check(s.img, `${lang}: the picture loaded`)
  check(s.texts[1] === (lang === 'en' ? 'Delivery 1 KWD to all Kuwait' : 'التوصيل ١ د.ك لجميع مناطق الكويت'), `${lang}: the delivery line`, s.texts[1])
  check(s.swaps === 0, `${lang}: the section is not re-created on every tick`, `${s.swaps} rebuilds in 2.5s`)
  check(s.titleColour !== 'rgb(255, 255, 255)', `${lang}: the title is not white on the white body`, s.titleColour)
  await p.close()
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — menu bar sticky with the top bar; features section has its picture')
process.exit(fails ? 1 : 0)
