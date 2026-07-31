// Performance budgets, asserted on a phone in both languages.
//
//   node scripts/perf-budget-test.mjs [baseUrl]
//
// Each budget exists because something was measured over it. The figures in the
// comments are what this file was written against, at 390pt DPR3.
//
//   * CLS in Arabic was 0.4448 — "poor", and it hit the half of the customers
//     this shop is built for. index.html is served dir="ltr" and LanguageContext
//     only switched it after React hydrated, so the whole page flipped. Fixed by
//     an inline head script; asserted here in BOTH languages, because measuring
//     only English is what let it live.
//   * /product parsed 493 kB of JS and executed 148 kB. The worst entry was the
//     Supabase client at 194 kB unused of 201 kB — the whole library, pulled in
//     to read five columns from one view. lib/stock.js now uses fetch().
//   * The remaining shifts were all font-display:swap. With /fonts/*.woff2
//     blocked, CLS measured exactly 0.0000, which is how we know.
//
// Coverage is a UNION of byte ranges. The obvious sum double-counts, because
// V8's ranges nest — that version reported 0% unused for a 208 kB React bundle,
// which is not a believable number and was the tell.
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:4173'

// route -> { requests, unusedPct, worstFileUnusedKb }
//
// The request budgets include one for /sw.js, which every page load now fetches
// so the browser can check the service worker for updates. Leaving it implicit
// put one route exactly on its ceiling and made this suite flaky — and a flaky
// budget test gets ignored, which defeats the point of having one.
const BUDGET = {
  // 26, was 25: the hero's first slide probes for the owner's photograph
  // (/hero/mobile/strength.jpg), the same one-request price the category
  // tiles already pay for their photo slots. Slides 2-3 probe lazily.
  // Arabic pays three more on top of its four font subsets: each slide that
  // loads probes the -rtl composition FIRST and falls back to the base photo,
  // so a server with no photos answers two misses where English answers one.
  '/':                          { requests: 26, requestsAr: 33, unusedPct: 60, worstFile: 150 },
  '/shop':                      { requests: 17, unusedPct: 60, worstFile: 150 },
  '/product/sculpt-top-grey':   { requests: 19, unusedPct: 60, worstFile: 150 },
  '/cart':                      { requests: 18, unusedPct: 60, worstFile: 150 },
  '/checkout':                  { requests: 20, unusedPct: 60, worstFile: 150 },
}
const CLS_MAX = 0.02        // Google's "good" is 0.1; this site measures ~0.002
const SCROLL_MEDIAN_MAX = 18 // ms. 60 FPS is 16.7
const LONG_FRAME_MAX = 0     // frames over 50 ms while scrolling
const FONTS_MAX = 4          // per page, per language

let fails = 0
const ok = (pass, what, detail = '') => {
  if (!pass) fails++
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${detail ? `  — ${detail}` : ''}`)
}

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

for (const [route, budget] of Object.entries(BUDGET)) {
  for (const lang of ['en', 'ar']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
    const p = await ctx.newPage()
    await p.addInitScript((l) => localStorage.setItem('lang', l), lang)
    const reqs = []
    p.on('response', (r) => reqs.push({ type: r.request().resourceType(), url: r.url() }))
    await p.coverage.startJSCoverage({ resetOnNavigation: false })
    await p.goto(BASE + route, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1600)

    // dir must be right from the first paint, not after hydration.
    const dir = await p.evaluate(() => document.documentElement.dir)
    ok(dir === (lang === 'ar' ? 'rtl' : 'ltr'), `${route} [${lang}] dir is ${lang === 'ar' ? 'rtl' : 'ltr'}`, dir)

    const cls = await p.evaluate(() => new Promise((res) => {
      let c = 0
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) c += e.value })
        .observe({ type: 'layout-shift', buffered: true })
      setTimeout(() => res(+c.toFixed(4)), 300)
    }))
    ok(cls <= CLS_MAX, `${route} [${lang}] CLS <= ${CLS_MAX}`, String(cls))

    const scroll = await p.evaluate(() => new Promise((res) => {
      const f = []; let last = performance.now(), y = 0
      const max = document.body.scrollHeight - innerHeight
      if (max <= 0) return res({ median: 0, long: 0, n: 0 })
      const step = () => {
        const now = performance.now(); f.push(now - last); last = now
        y += 30; window.scrollTo(0, y)
        if (y < max && f.length < 600) requestAnimationFrame(step)
        else { const s = f.slice(3).sort((a, c) => a - c)
          res({ median: +s[Math.floor(s.length / 2)].toFixed(1), long: s.filter((x) => x > 50).length, n: s.length }) }
      }
      requestAnimationFrame(step)
    }))
    if (scroll.n) {
      ok(scroll.median <= SCROLL_MEDIAN_MAX, `${route} [${lang}] scroll median <= ${SCROLL_MEDIAN_MAX} ms`, `${scroll.median} ms`)
      ok(scroll.long <= LONG_FRAME_MAX, `${route} [${lang}] no frame over 50 ms`, `${scroll.long}/${scroll.n}`)
    }

    const cov = await p.coverage.stopJSCoverage()
    let total = 0, used = 0, worst = 0, worstUrl = ''
    for (const e of cov) {
      const size = e.source?.length ?? 0
      const hit = new Uint8Array(size)
      for (const fn of e.functions) for (const r of fn.ranges) if (r.count !== 0)
        for (let i = r.startOffset; i < Math.min(r.endOffset, size); i++) hit[i] = 1
      for (const fn of e.functions) for (const r of fn.ranges) if (r.count === 0)
        for (let i = r.startOffset; i < Math.min(r.endOffset, size); i++) hit[i] = 0
      let c = 0
      for (let i = 0; i < size; i++) c += hit[i]
      total += size; used += c
      if (size - c > worst) { worst = size - c; worstUrl = e.url.split('/').pop() }
    }
    const pct = Math.round((1 - used / total) * 100)
    ok(pct <= budget.unusedPct, `${route} [${lang}] unused JS <= ${budget.unusedPct}%`, `${pct}% (${Math.round((total - used) / 1024)} kB)`)
    ok(Math.round(worst / 1024) <= budget.worstFile,
      `${route} [${lang}] no single file over ${budget.worstFile} kB unused`,
      `${Math.round(worst / 1024)} kB in ${worstUrl}`)

    // Arabic gets four more, and they are the four Arabic font subsets — the
    // page genuinely needs both scripts, because prices and size labels are
    // Latin digits while the copy is Arabic. Budgeting one number for both
    // languages would either be too tight for Arabic or too loose for English.
    const allow = lang === 'ar' && budget.requestsAr ? budget.requestsAr : budget.requests + (lang === 'ar' ? 4 : 0)
    const n = reqs.length
    ok(n <= allow, `${route} [${lang}] requests <= ${allow}`, String(n))
    const fonts = reqs.filter((r) => r.type === 'font')
    // Arabic legitimately needs both subsets — the price digits and size labels
    // are Latin — so the ceiling is doubled there rather than pretended away.
    const fontMax = lang === 'ar' ? FONTS_MAX * 2 : FONTS_MAX
    ok(fonts.length <= fontMax, `${route} [${lang}] font files <= ${fontMax}`, String(fonts.length))

    await ctx.close()
  }
}
await b.close()
console.log(fails ? `\n${fails} over budget` : '\nevery route within budget, in both languages')
process.exit(fails ? 1 : 0)
