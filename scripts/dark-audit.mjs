/**
 * Colours that are TOO DARK — the other end of the rig glare-audit.mjs guards.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/dark-audit.mjs
 *   THEME=light node scripts/dark-audit.mjs
 *   BASE=https://www.sporta.com.kw node scripts/dark-audit.mjs
 *
 * The shop has three colour rigs and between them they had a hole:
 *
 *   site-contrast.mjs  text against its background, WCAG AA floor
 *   glare-audit.mjs    contrast that is TOO HIGH — halation on a dark screen
 *   this file          things that are not text, and are too dark to find
 *
 * site-contrast only measures TEXT. A shop is also made of edges: the outline
 * that says a box is a box you can type in, the pill around a size, the line
 * under a field. On a theme built from rgb(20,22,25), rgb(26,29,32) and
 * rgb(35,38,42) those edges are a few points apart, and no rig here had ever
 * looked at one.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT ASSERTS, AND WHY IT IS NOT "EVERY BORDER MUST REACH 3:1"
 *
 * WCAG 1.4.11 asks for 3:1 on the visual information REQUIRED TO IDENTIFY a
 * control — not on every edge that happens to be drawn. A pill with a faint
 * outline and white text inside is identified by the text; the outline is
 * decoration, and demanding 3:1 of it would be this rig inventing a rule and
 * calling it a standard.
 *
 * Measured on this shop's dark theme before writing a line of it: the size
 * chips and the sort control sit at 1.84:1, and they are perfectly legible in
 * a screenshot because each carries high-contrast text. Reporting those as
 * failures would have been the "98 tap targets" mistake again — a rig that
 * cries wolf is worse than no rig, because the next real finding is skipped.
 *
 * So the rule is the one the standard actually states: EVERY CONTROL MUST BE
 * IDENTIFIABLE BY SOMETHING. A control passes if its boundary reaches 3:1, OR
 * if it carries text or a glyph that does. It fails only when NOTHING about it
 * reaches 3:1 — a box you cannot see, containing nothing you can read.
 *
 * That is a rule the current design already satisfies, which is the point: it
 * is not a demand for a redesign, it is a floor under the one that exists. It
 * catches the change that would actually hurt — a borderless icon button whose
 * icon is dimmed to rgb(60,60,60), a field that loses its outline in a
 * refactor, a disabled state so faint the control disappears.
 *
 * SURFACES ARE NOT CONTROLS and are reported, never failed. A card one shade
 * off the page is how every dark theme in the world shows elevation, and this
 * one uses 1.07:1 between rgb(26,29,32) and rgb(20,22,25) deliberately. The
 * numbers are printed so a person can judge them; the rig has no opinion.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const THEME = process.env.THEME === 'light' ? 'light' : 'dark'
const PAGES = ['/', '/shop', '/cart', '/contact', '/about']

// WCAG 1.4.11. Not a number chosen here.
const NEEDED = 3.0

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? `\n${extra}` : ''}`)
  return ok
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  colorScheme: THEME,
})
const page = await ctx.newPage()

const measure = async (path) => {
  await page.goto(BASE + path)
  await page.evaluate((t) => { try { localStorage.setItem('sporta_theme', t) } catch {} }, THEME)
  await page.reload()
  await page.waitForTimeout(1700)
  return page.evaluate((NEEDED) => {
    // A 1x1 CANVAS, because Tailwind v4 hands back oklab()/lab() from
    // getComputedStyle and no regex parses those. Painting the value and
    // reading the pixel is the only way to get numbers out of it.
    const c = document.createElement('canvas'); c.width = c.height = 1
    const x = c.getContext('2d', { willReadFrequently: true })
    const rgba = (v) => {
      if (!v || v === 'none' || v === 'transparent') return null
      x.clearRect(0, 0, 1, 1); x.fillStyle = '#000'; x.fillStyle = v
      x.fillRect(0, 0, 1, 1)
      const d = x.getImageData(0, 0, 1, 1).data
      // getImageData is NOT premultiplied — dividing by alpha turns every
      // translucent colour white, which is a bug this repo has already had.
      return d[3] > 0 ? { r: d[0], g: d[1], b: d[2], a: d[3] / 255 } : null
    }
    const lum = (c) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const ratio = (a, b) => { const [m, n] = [lum(a), lum(b)].sort((u, v) => v - u); return (m + 0.05) / (n + 0.05) }
    const over = (f, g) => ({
      r: Math.round(f.r * f.a + g.r * (1 - f.a)), g: Math.round(f.g * f.a + g.g * (1 - f.a)),
      b: Math.round(f.b * f.a + g.b * (1 - f.a)), a: 1,
    })
    const bgOf = (el) => {
      for (let a = el; a; a = a.parentElement) {
        const v = rgba(getComputedStyle(a).backgroundColor)
        if (v && v.a > 0.95) return v
      }
      // RN Web and this SPA both leave body transparent; the page is dark.
      const b = rgba(getComputedStyle(document.documentElement).backgroundColor)
      return b && b.a > 0.95 ? b : { r: 20, g: 22, b: 25, a: 1 }
    }
    const say = (c) => `rgb(${c.r},${c.g},${c.b})`

    const CONTROLS = 'input,select,textarea,button,[role=button],[role=link],'
                   + '[role=checkbox],[role=radio],[role=switch],[role=combobox]'
    const dead = []      // nothing about it reaches 3:1
    const surfaces = []  // reported only

    for (const el of document.querySelectorAll(CONTROLS)) {
      const r = el.getBoundingClientRect()
      if (r.width < 8 || r.height < 8) continue
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.opacity === '0') continue
      const bg = bgOf(el.parentElement || el)

      let best = 0
      const marks = []

      // 1. Its own edge — a border, or a fill that differs from the page.
      const w = parseFloat(s.borderTopWidth)
      if (w && s.borderTopStyle !== 'none') {
        const bc = rgba(s.borderTopColor)
        if (bc && bc.a > 0.02) {
          const e = bc.a < 1 ? over(bc, bg) : bc
          const v = ratio(e, bg); marks.push(['border', v, say(e)]); best = Math.max(best, v)
        }
      }
      const own = rgba(s.backgroundColor)
      if (own && own.a > 0.02) {
        const e = own.a < 1 ? over(own, bg) : own
        if (e.r !== bg.r || e.g !== bg.g || e.b !== bg.b) {
          const v = ratio(e, bg); marks.push(['fill', v, say(e)]); best = Math.max(best, v)
        }
      }

      // 2. WHAT IS INSIDE IT. This is the half that stops the false positives:
      //    a pill with a faint outline and white text is identified by the
      //    text, and WCAG asks for 3:1 on what IDENTIFIES the control, not on
      //    every edge that happens to be drawn.
      const text = (el.textContent || '').trim()
      const inner = own && own.a > 0.95 ? own : bg
      if (text) {
        const fc = rgba(s.color)
        if (fc) {
          const e = fc.a < 1 ? over(fc, inner) : fc
          const v = ratio(e, inner); marks.push(['text', v, say(e)]); best = Math.max(best, v)
        }
      }
      // An icon-only control: an inline <svg> counts as its glyph.
      const svg = el.querySelector('svg')
      if (svg) {
        const sc = rgba(getComputedStyle(svg).color) ?? rgba(getComputedStyle(svg).fill)
        if (sc && sc.a > 0.02) {
          const e = sc.a < 1 ? over(sc, inner) : sc
          const v = ratio(e, inner); marks.push(['icon', v, say(e)]); best = Math.max(best, v)
        }
        else { marks.push(['icon', 99, '(painted, not measurable)']); best = Math.max(best, 99) }
      }
      // 3. A CHILD THAT PAINTS THE CONTROL. This clause exists because leaving
      //    it out produced five false positives on the first run: the hero
      //    carousel's dots reported "nothing drawn at all", and they are drawn
      //    — by a child <span class="block h-2.5 rounded-full"> filled with the
      //    shop's orange, which is 4.4:1 against the page and perfectly
      //    visible. The button itself is a bare hit area, which is how most
      //    component frameworks build a control: the element takes the press,
      //    a child carries the paint.
      for (const kid of el.querySelectorAll('*')) {
        const kr = kid.getBoundingClientRect()
        if (kr.width < 4 || kr.height < 4) continue
        const ks = getComputedStyle(kid)
        const kb = rgba(ks.backgroundColor)
        if (!kb || kb.a < 0.02) continue
        const e = kb.a < 1 ? over(kb, bg) : kb
        if (e.r === bg.r && e.g === bg.g && e.b === bg.b) continue
        const v = ratio(e, bg); marks.push(['child', v, say(e)]); best = Math.max(best, v)
      }

      // An <img> or a background-image is a picture; a static check cannot
      // speak for it, and guessing would be the false positive again.
      if (el.querySelector('img') || s.backgroundImage !== 'none') best = Math.max(best, 99)

      if (best < NEEDED) {
        dead.push({
          tag: el.tagName,
          label: (el.getAttribute('aria-label') || text || '(no label)').slice(0, 34),
          on: say(bg),
          marks: marks.map(([k, v, col]) => `${k} ${v.toFixed(2)}:1 ${col}`).join(', ') || 'nothing drawn at all',
        })
      }
    }

    // Surfaces, for the record only.
    const seenS = new Set()
    for (const el of document.querySelectorAll('div,section,article,aside,header,footer')) {
      const r = el.getBoundingClientRect()
      if (r.width < 80 || r.height < 40) continue
      const own = rgba(getComputedStyle(el).backgroundColor)
      if (!own || own.a < 0.95) continue
      const par = bgOf(el.parentElement || el)
      if (par.r === own.r && par.g === own.g && par.b === own.b) continue
      const k = say(own) + say(par)
      if (seenS.has(k)) continue
      seenS.add(k)
      surfaces.push({ ratio: ratio(own, par), colour: say(own), on: say(par) })
    }
    return { dead, surfaces }
  }, NEEDED)
}

console.log(`--- the ${THEME} theme, at ${BASE}\n`)
const allDead = []
const allSurf = new Map()
for (const path of PAGES) {
  const { dead, surfaces } = await measure(path)
  for (const d of dead) allDead.push({ ...d, page: path })
  for (const s of surfaces) {
    const k = `${s.colour}|${s.on}`
    if (!allSurf.has(k)) allSurf.set(k, { ...s, page: path })
  }
  console.log(`--   ${path.padEnd(9)} ${dead.length === 0 ? 'every control is identifiable' : `${dead.length} control(s) with nothing at ${NEEDED}:1`}`)
}

console.log('')
check(allDead.length === 0,
  `every control can be found: a boundary, its text or its icon reaches ${NEEDED}:1`,
  allDead.slice(0, 10).map((d) =>
    `       ${d.page} ${d.tag} "${d.label}" on ${d.on}\n         ${d.marks}`).join('\n'))

// THE SURFACES, PRINTED AND NOT JUDGED. A card one shade off the page is how
// dark themes show elevation; this shop does it on purpose. The numbers are
// here so a person can look at them, which is the only thing that can decide
// whether a step is too small.
const surf = [...allSurf.values()].sort((a, b) => a.ratio - b.ratio)
console.log(`\n--   how far apart the surfaces sit (${surf.length} distinct pairs, faintest first)`)
for (const s of surf.slice(0, 8)) {
  console.log(`       ${s.ratio.toFixed(2).padStart(5)}:1  ${s.colour.padEnd(18)} on ${s.on}`)
}
console.log('       — reported, not failed: elevation on a dark theme is meant to be subtle.')

await browser.close()
console.log(fails ? `\n${fails} failed` : `\nall ok — nothing in the ${THEME} theme is too dark to find`)
process.exit(fails ? 1 : 0)
