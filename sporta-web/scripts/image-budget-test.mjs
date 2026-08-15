// Asserts that a phone is never served a desktop image, and that the homepage's
// image weight stays under budget on the devices Sporta's customers use.
//
//   node scripts/image-budget-test.mjs [baseUrl]
//
// WHY THIS EXISTS
// Before public/cats was split into mobile/ and desktop/, the homepage's images
// measured 575 kB on an iPhone 12 and 274 kB on a 1440px desktop — the phone
// paid twice. srcset + sizes multiplies by devicePixelRatio, so a 358px tile at
// DPR3 asked for ~1074px and got the 1600w file, while a 606px desktop tile at
// DPR1 asked for 606px and got the 800w one. The mechanism was working exactly
// as specified; it was the wrong mechanism. <source media> replaced it.
//
// A regression here is silent — the page looks identical and simply costs three
// times as much on the connection least able to afford it — so it is asserted.
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:4173'

// Budgets are the measured figures plus ~25% headroom, in kB. Tight enough that
// re-introducing one desktop-sized file on mobile fails; loose enough that
// re-encoding the art does not.
const DEVICES = [
  { label: 'iPhone 12/13/14', width: 390, dpr: 3, budget: 175 },
  { label: 'iPhone 12 Arabic', width: 390, dpr: 3, lang: 'ar', budget: 175 },
  { label: 'iPhone SE 3', width: 375, dpr: 2, budget: 175 },
  { label: 'Galaxy A / Pixel', width: 412, dpr: 2.625, budget: 175 },
  { label: 'Z Fold 5 folded', width: 344, dpr: 2.6, budget: 175 },
  { label: 'iPad mini portrait', width: 744, dpr: 2, budget: 210 },
  { label: 'Desktop', width: 1440, dpr: 1, budget: 250 },
  { label: 'Desktop retina', width: 1440, dpr: 2, budget: 250 },
]

// The two layouts flip at different widths on purpose: the category grid goes
// 2-up at Tailwind's md (768) and the services strip at sm (640), so each asset
// changes folder where ITS OWN layout changes. Asserting one breakpoint for both
// reports a false failure on a 744pt tablet.
const wantsDesktop = (url, width) => (url.includes('infobar') ? width >= 640 : width >= 768)

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

for (const d of DEVICES) {
  const p = await b.newPage({ viewport: { width: d.width, height: 900 }, deviceScaleFactor: d.dpr })
  await p.addInitScript((l) => localStorage.setItem('lang', l), d.lang ?? 'en')
  const got = []
  p.on('response', async (r) => {
    if (!/\.(webp|jpe?g|png|svg|avif)(\?|$)/i.test(r.url()) || r.status() !== 200) return
    let n = 0
    try { n = (await r.body()).length } catch { /* redirect or aborted */ }
    got.push([r.url().replace(/^https?:\/\/[^/]+/, ''), n])
  })
  await p.goto(BASE + '/', { waitUntil: 'networkidle' })
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await p.waitForTimeout(1500)
  await p.close()

  const kB = Math.round(got.reduce((n, [, s]) => n + s, 0) / 1024)
  const wrong = got
    .filter(([u]) => u.includes('/cats/'))
    .filter(([u]) => (wantsDesktop(u, d.width) ? u.includes('/mobile/') : u.includes('/desktop/')))
  check(wrong.length === 0,
    `${d.label.padEnd(19)} ${String(d.width).padStart(4)}px DPR${d.dpr}  right folder only` +
    (wrong.length ? ` — WRONG: ${wrong.map(([u]) => u).join(', ')}` : ''))
  check(kB <= d.budget, `${d.label.padEnd(19)} ${String(kB).padStart(4)} kB of images (budget ${d.budget} kB)`)
}

await b.close()
console.log(fails ? `\n${fails} failed` : '\nall within budget, no crossed folders')
process.exit(fails ? 1 : 0)
