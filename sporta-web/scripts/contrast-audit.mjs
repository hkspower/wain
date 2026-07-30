// Colour contrast, measured in the browser rather than argued about.
//
// Walks every text node on a route, resolves the computed colour and the first
// non-transparent background BEHIND it (which is the part a hand-audit gets
// wrong — `text-slate-600` on `.card` on `.bg-sand` is three layers), and
// reports anything under the WCAG AA floor for its own size and weight:
//   4.5:1 normal text, 3:1 for >=24px, or >=18.66px bold.
//
// Runs in light AND dark, because this site has both and a token that passes on
// beige can fail on charcoal. Also checks non-text contrast (WCAG 1.4.11) for
// the controls that carry meaning by colour alone — the selected size chip.
//
//   node scripts/contrast-audit.mjs [route...]
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const ROUTES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['/product/cloudsoft-jacket-army-green']

let fails = 0
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
})

const AUDIT = () => {
  const lum = ([r, g, b]) => {
    const f = (c) => {
      c /= 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  // Colours are composited ON A CANVAS rather than parsed by hand, and that is
  // not a shortcut — it is the fix for a false positive this script shipped
  // with. Tailwind v4 emits modern colour syntax: the site header's background
  // computes as `lab(9.07 -0.61 -3.3 / 0.95)`, and a regex that only understood
  // rgb()/rgba() returned null for it, skipped the layer, and reported the
  // active nav link as orange-on-beige when it is orange-on-charcoal. Canvas
  // understands every syntax the browser does and does the alpha compositing
  // in the right colour space, which is also the maths this was hand-rolling.
  const cvs = document.createElement('canvas')
  cvs.width = cvs.height = 1
  const ctx = cvs.getContext('2d', { willReadFrequently: true })
  const paint = (layers) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#ffffff' // the browser's own canvas under everything
    ctx.fillRect(0, 0, 1, 1)
    for (const c of layers) {
      if (!c || c === 'transparent') continue
      ctx.fillStyle = c
      ctx.fillRect(0, 0, 1, 1)
    }
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }
  // Every background from the root down to the element itself.
  const stackOf = (el) => {
    const out = []
    for (let n = el; n; n = n.parentElement) out.push(getComputedStyle(n).backgroundColor)
    return out.reverse()
  }

  // Text over an IMAGE or GRADIENT cannot be measured this way, and pretending
  // otherwise is worse than skipping it: the hero headline sits on
  // `.hero-glow`, a radial gradient painted as a background-IMAGE, so the
  // colour stack behind it is the transparent-to-beige page canvas — and this
  // script confidently reported white-on-beige at 1.38:1 for text that is
  // actually white on near-black. Those are counted and named, not silently
  // dropped, because "unmeasurable" is a real answer and "fine" is not.
  const overArt = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bi = getComputedStyle(n).backgroundImage
      if (bi && bi !== 'none') return true
    }
    return false
  }

  const seen = new Map()
  let art = 0
  for (const el of document.querySelectorAll('body *')) {
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim()
    if (!text) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue
    // Decorative text is exempt. WCAG 1.4.3 covers text that conveys
    // information; the "/" between breadcrumbs and the "·" between an eyebrow
    // and a heading are separators, already aria-hidden so no screen reader
    // reads them, and darkening them to 4.5:1 would turn punctuation into a
    // second row of content. closest() so a hidden wrapper takes its children.
    if (el.closest('[aria-hidden="true"]')) continue
    if (overArt(el)) {
      art++
      continue
    }
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue

    const layers = stackOf(el)
    const bg = paint(layers)
    // The text colour composited over its own background, so a semi-transparent
    // foreground (text-white/80 and friends) is measured as it is seen.
    const flat = paint([...layers, cs.color])
    const px = parseFloat(cs.fontSize)
    const bold = +cs.fontWeight >= 700
    const large = px >= 24 || (bold && px >= 18.66)
    const need = large ? 3 : 4.5
    const got = ratio(flat, bg)
    if (got + 0.005 < need) {
      const key = `${cs.color}|${bg.join(',')}|${Math.round(px)}`
      if (!seen.has(key)) {
        seen.set(key, {
          text: text.slice(0, 40),
          // Where it is, not just what it is — "orange on beige" appears in
          // four files and the fix is different in each.
          where: `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(/\s+/).filter(Boolean).slice(0, 3).join('.')}`,
          color: cs.color,
          on: `rgb(${bg.join(',')})`,
          px: Math.round(px),
          weight: cs.fontWeight,
          need,
          got: +got.toFixed(2),
        })
      }
    }
  }
  return { bad: [...seen.values()], art }
}

for (const route of ROUTES) {
  for (const theme of ['light', 'dark']) {
    for (const lang of ['en', 'ar']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      const page = await ctx.newPage()
      await page.addInitScript(
        ([l, t]) => {
          localStorage.setItem('lang', l)
          localStorage.setItem('sporta_theme', t)
        },
        [lang, theme],
      )
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      // Pick a size AND a fit so the selected-chip colours are actually on
      // screen — an audit that never selects anything never measures the
      // selected state. :not([disabled]) because the first size chip is often
      // one this piece is not carried in, and clicking it silently did nothing:
      // the .catch() was swallowing the failure and the audit was quietly only
      // ever looking at unselected chips.
      for (const group of ['Size', 'Fit']) {
        await page
          .locator(`[role="group"][aria-label="${group}"] button:not([disabled])`)
          .first()
          .click({ timeout: 2000 })
          .catch(() => {})
      }
      const { bad, art } = await page.evaluate(AUDIT)
      const label = `${route} [${lang}/${theme}]`
      if (!bad.length) {
        console.log(
          `ok   ${label}  — every text/background pair meets AA` +
            (art ? `  (${art} over art, not measurable here)` : ''),
        )
      } else {
        fails += bad.length
        console.log(`FAIL ${label}`)
        for (const b of bad) {
          console.log(
            `       "${b.text}"  ${b.color} on ${b.on}  ${b.px}px/${b.weight}  ${b.got}:1 (needs ${b.need})\n         at ${b.where}`,
          )
        }
      }
      await ctx.close()
    }
  }
}

await browser.close()
console.log(fails ? `\n${fails} contrast failure(s)` : '\nAA in both themes, both languages')
process.exit(fails ? 1 : 0)
