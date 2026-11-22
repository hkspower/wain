import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4173'
const SLUG = process.env.SLUG || 'cagliari-calcio-sweatshirt-navy'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
for (const lang of ['en', 'ar']) for (const w of [320, 390, 768, 1024, 1280]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 })
  await page.goto(`${BASE}/product/${SLUG}${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top) } }
    const pick = (sel) => document.querySelector(sel)
    const h1 = pick('main h1') || pick('h1')
    const crumb = pick('nav[aria-label]') || pick('nav')
    const imgs = [...document.querySelectorAll('main img')].filter((i) => i.getBoundingClientRect().width > 150)
    const img = imgs.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
    const main = pick('main')
    return { vw, title: box(h1), crumb: box(crumb), photo: box(img), main: box(main), sw: document.documentElement.scrollWidth - vw }
  })
  const g = (b) => (b ? `L${b.l} R${r.vw - b.r}` : '-')
  console.log(`${lang} ${w}px  main ${g(r.main)} | title ${g(r.title)} | crumb ${g(r.crumb)} | photo ${g(r.photo)} | sideways ${r.sw}`)
  await page.close()
}
await browser.close()
