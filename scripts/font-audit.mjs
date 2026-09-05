/**
 * The fonts the shop ships, against the fonts it actually uses.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/font-audit.mjs
 *
 * The typography here is better built than most: Alexandria as a variable face,
 * IBM Plex Sans Arabic alongside it, each split into a Latin and an Arabic file
 * gated by `unicode-range` so a shopper downloads only the script they are
 * reading, `font-display: swap` on every face, and two metric-overridden local
 * fallbacks (`ascent-override`, `descent-override`) so the swap does not move
 * the page. None of that needed fixing. What it did not have was anything
 * checking that the LIST stayed true.
 *
 * WHAT IT ASSERTS.
 *
 *   EVERY SHIPPED FILE IS USED. A font file nobody downloads is not free —
 *   it is bytes in the deploy, a line in the upload, and a thing the next
 *   reader assumes is load-bearing. Measured by driving every route in both
 *   languages and recording which files the browser actually asks for.
 *
 *   EVERY FILE THE SITE ASKS FOR EXISTS. The opposite failure and the worse
 *   one: a face whose src 404s falls silently to the local fallback, so the
 *   page still looks approximately right and nobody notices the real face is
 *   gone. This is the assertion that makes the one above safe to act on.
 *
 *   font-display IS swap ON EVERY FACE. Without it a slow connection gets a
 *   block period of invisible text — the shop appears empty rather than
 *   unstyled.
 *
 *   AND THE FALLBACKS ARE METRIC-MATCHED, because that is the difference
 *   between a swap you notice and one you do not.
 *
 * REPORTED, NOT FAILED: characters rendered in the shop's own stacks that fall
 * outside every declared unicode-range. They land on whatever the system
 * offers, which is what `sans-serif` at the end of the stack is for — a
 * deliberate fallback, not a bug. It is worth printing because the failure
 * mode when a device has no glyph is a tofu box in the middle of the shop, and
 * that is a thing to know about before a customer reports it.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('../sporta-site/public_html/', import.meta.url).pathname

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}

const onDisk = readdirSync(ROOT + 'fonts').filter((f) => /\.woff2?$/.test(f)).sort()
const track = (() => {
  try {
    return execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-B', '-e',
      'select track_id from orders order by id desc limit 1'], { encoding: 'utf8' }).trim()
  } catch { return '' }
})()

// EVERY ROUTE, BOTH LANGUAGES. A font used on one page in one language is a
// font that is used; anything narrower would call a live file dead.
const routes = ['/', '/shop', '/product/vanquish-tank-navy', '/cart', '/checkout', '/about',
  '/contact', '/terms', '/privacy', '/returns', '/track', '/wishlist', '/backends',
  '/payment/result?status=cod', '/exchange', '/nope-404',
  ...(track ? [`/invoice/${track}`, `/order/${track}`] : [])]

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

const fetched = new Map()   // file -> Set(status)
const uncovered = new Map()
const arabicTracked = []
let arabicRuns = 0
let faces = []

for (const lang of ['ar', 'en']) {
  const ctx = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  page.on('response', (r) => {
    const m = r.url().match(/([^/]+\.woff2?)$/)
    if (!m) return
    if (!fetched.has(m[1])) fetched.set(m[1], new Set())
    fetched.get(m[1]).add(r.status())
  })
  for (const r of routes) {
    const url = BASE + r + (lang === 'en' ? (r.includes('?') ? '&' : '?') + 'lang=en' : '')
    try { await page.goto(url, { timeout: 15000 }) } catch { continue }
    await page.waitForTimeout(1400)

    const got = await page.evaluate(() => {
      // Every @font-face the document actually has, read from the CSSOM rather
      // than by parsing the stylesheet — what the browser resolved is the
      // thing that matters, and the build's CSS is minified on one line.
      const ranges = [], faces = []
      for (const sh of document.styleSheets) {
        let rules; try { rules = sh.cssRules } catch { continue }
        for (const r of rules || []) {
          if (r.constructor.name !== 'CSSFontFaceRule') continue
          const s = r.style
          const src = s.getPropertyValue('src')
          const file = (src.match(/([^/'")]+\.woff2?)/) || [])[1] || ''
          faces.push({
            family: s.getPropertyValue('font-family').replace(/["']/g, ''),
            weight: s.getPropertyValue('font-weight'),
            display: s.getPropertyValue('font-display'),
            ascent: s.getPropertyValue('ascent-override'),
            file,
          })
          const ur = s.getPropertyValue('unicode-range')
          for (const part of (ur || '').split(',')) {
            const t = part.trim().replace(/^U\+/i, ''); if (!t) continue
            if (t.includes('-')) { const [a, z] = t.split('-'); ranges.push([parseInt(a, 16), parseInt(z, 16)]) }
            else if (t.includes('?')) ranges.push([parseInt(t.replace(/\?/g, '0'), 16), parseInt(t.replace(/\?/g, 'F'), 16)])
            else { const v = parseInt(t, 16); ranges.push([v, v]) }
          }
        }
      }
      const covered = (cp) => ranges.some(([a, z]) => cp >= a && cp <= z)
      const stray = []
      const tracked = []
      let arabic = 0
      const isArabic = (s) => /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(s)
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let n
      while ((n = w.nextNode())) {
        const t = n.textContent; if (!t.trim()) continue
        const e = n.parentElement, s = getComputedStyle(e)
        if (s.display === 'none' || s.visibility === 'hidden') continue
        if (isArabic(t)) {
          arabic++
          if ((parseFloat(s.letterSpacing) || 0) > 0) {
            tracked.push({ ls: s.letterSpacing, t: t.trim().slice(0, 18),
              sel: `${e.tagName.toLowerCase()}.${(e.className || '').toString().slice(0, 22)}` })
          }
        }
        if (!/Alexandria|Plex/.test(s.fontFamily)) continue
        for (const ch of [...t]) {
          const cp = ch.codePointAt(0)
          if (cp < 33 || covered(cp)) continue
          stray.push({ ch, cp, ctx: t.trim().slice(0, 22) })
        }
      }
      return { faces, stray, tracked, arabic }
    })
    if (got.faces.length > faces.length) faces = got.faces
    arabicRuns += got.arabic
    for (const a of got.tracked) if (!arabicTracked.some((x) => x.sel === a.sel)) arabicTracked.push(a)
    for (const s of got.stray) {
      if (!uncovered.has(s.cp)) uncovered.set(s.cp, { ...s, n: 0 })
      uncovered.get(s.cp).n++
    }
  }
  await ctx.close()
}
await browser.close()

console.log(`--- ${routes.length} routes x 2 languages, ${faces.length} @font-face rules, ${onDisk.length} files on disk\n`)

// --- every file the browser asked for came back ----------------------------
const bad = [...fetched.entries()].filter(([, st]) => ![...st].every((s) => s === 200))
check(bad.length === 0, 'every font the shop asks for actually answers',
  bad.map(([f, st]) => `${f} ${[...st].join('/')}`).join(' | '))

// --- every file on disk earns its place ------------------------------------
const unused = onDisk.filter((f) => !fetched.has(f))
check(unused.length === 0,
  `every shipped font file is used by some page (${onDisk.length} files)`,
  `never fetched on any route in either language: ${unused.join(', ')}`)

// --- swap, on every face ---------------------------------------------------
const noSwap = faces.filter((f) => f.file && f.display !== 'swap')
check(noSwap.length === 0, 'every face swaps rather than blocking',
  noSwap.map((f) => `${f.family} ${f.weight}: ${f.display || '(unset)'}`).join(' | '))

// --- and the fallbacks are metric-matched ----------------------------------
const fallbacks = faces.filter((f) => /Fallback/i.test(f.family))
check(fallbacks.length > 0 && fallbacks.every((f) => f.ascent),
  `the local fallbacks carry metric overrides, so the swap does not move the page (${fallbacks.length})`,
  fallbacks.map((f) => `${f.family}:${f.ascent || 'none'}`).join(' | '))

// --- and no tracking on the cursive script ---------------------------------
// Arabic joins. Its letters are not discrete shapes with air between them the
// way Latin's are — a word is one connected stroke — so letter-spacing does not
// loosen a word, it pulls the joins apart. Latin tracking added for a bilingual
// row lands on both halves unless it is scoped to the document's language, and
// that is exactly what had happened: 28 Arabic nav links carrying 0.155px.
check(arabicTracked.length === 0,
  `no Arabic text carries letter-spacing (${arabicRuns} runs measured)`,
  arabicTracked.slice(0, 4).map((a) => `${a.ls} on ${a.sel} "${a.t}"`).join(' | '))

// --- reported, not failed --------------------------------------------------
if (uncovered.size) {
  console.log(`\n--   ${uncovered.size} character(s) render outside every declared unicode-range,`)
  console.log('     so they fall to the system sans-serif at the end of the stack:')
  for (const v of [...uncovered.values()].sort((a, b) => b.n - a.n)) {
    console.log(`       U+${v.cp.toString(16).toUpperCase().padStart(4, '0')} "${v.ch}" x${v.n}  in "${v.ctx}"`)
  }
  console.log('     Deliberate — that is what the trailing sans-serif is for — but a device')
  console.log('     without the glyph shows a tofu box, so it is worth knowing they are there.')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the font list is the font list')
process.exit(fails ? 1 : 0)
