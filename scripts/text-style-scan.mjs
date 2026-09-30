/**
 * The website's text, as the browser actually sets it.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/text-style-scan.mjs
 *   BASE=http://127.0.0.1:4300 LANGS=ar,en node scripts/text-style-scan.mjs
 *
 * WHAT THIS ASKS THAT THE OTHER RIGS DO NOT. site-contrast asks whether text
 * can be READ against its ground; font-audit asks whether every face the pages
 * REQUEST actually answers; css-audit reads the stylesheet. None of them asks
 * the question a person asks when they look at a page — is this text the size,
 * the weight and the FACE it was meant to be, and is any of it cut off?
 *
 * Three faults, each of which is invisible to every other check here:
 *
 *  1. TEXT THE DECLARED FACE DOES NOT COVER. `assets/index-*.css` declares
 *     eight @font-face rules for IBM Plex Sans Arabic and only two weights were
 *     ever shipped — CLAUDE.md records the four that 404'd. A browser fetches a
 *     face only when text USES that family at that weight, so the audit that
 *     asked "does everything the page requests answer?" passed truthfully while
 *     the first `font-weight: 400` on a Plex element would have dropped to
 *     Arial mid-paragraph. This asks the other question: for each run of text,
 *     can the browser set it in the family the CSS names, at the weight the CSS
 *     names? The FIRST declared family alone, because asking about the whole
 *     list is asking whether a fallback exists, and one always does — that is
 *     exactly why the fault is silent. And MEASURED rather than asked: the
 *     first version used `document.fonts.check`, and its own mutation test
 *     walked past a rule naming a face that does not exist. See `applies()`.
 *
 *  2. TEXT THAT IS CLIPPED. An element whose own text overflows a box that
 *     hides the overflow. A price with its last digit gone, a button whose
 *     label is cut in half. Measured as scrollWidth/scrollHeight against the
 *     client box, and only where `overflow` actually hides — an element that
 *     scrolls is not a fault, and a `line-clamp` truncation is deliberate
 *     design, so both are excluded by name rather than by hoping.
 *
 *  3. TEXT TOO SMALL TO READ. Under 11px of rendered size. Not a style
 *     opinion: below that a label is a texture.
 *
 * THE INVENTORY IS PRINTED AND NEVER FAILED. Sizes, weights and families, with
 * counts, both languages. "Do not redesign without approval" — a rig that
 * failed on eleven distinct type sizes would be deciding the shop's typography
 * on its own. It reports; the owner decides.
 *
 * IT ASSERTS IT SAW TEXT. A walk that matches nothing produces no faults and no
 * inventory, and reads exactly like a clean shop. This repository has paid for
 * that shape more than once — the suite that found 0 controls, the watcher
 * attached to nothing — so the element count is checked BEFORE the results that
 * depend on it.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const LANGS = (process.env.LANGS ?? 'ar,en').split(',')
const PAGES = ['/', '/shop', '/cart', '/checkout', '/about', '/contact',
               '/product/cloudsoft-jacket-army-green', '/returns', '/track',
               '/privacy', '/terms']

const MIN_PX = 11

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await b.newPage({ viewport: { width: 1280, height: 1000 } })

const sizes = new Map(), weights = new Map(), families = new Map()
const unsettable = [], clipped = [], tiny = []
let seen = 0, pagesWalked = 0, srOnlyCount = 0

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)

for (const lang of LANGS) {
  for (const path of PAGES) {
    const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}lang=${lang}`
    await p.goto(url, { waitUntil: 'networkidle' }).catch(() => {})
    await p.waitForTimeout(900)
    // The faces have to be IN before any of this is asked, or every element
    // reads as unsettable on a page that was merely still loading.
    await p.evaluate(() => document.fonts.ready).catch(() => {})

    const rows = await p.evaluate(() => {
      // DOES THIS FAMILY ACTUALLY APPLY? Measured, not asked.
      //
      // The first version of this used `document.fonts.check(...)`, and its
      // mutation test walked straight past: a rule naming "NoSuchFaceHere" was
      // reported as perfectly settable. check() answers about @font-face rules
      // the document has LOADED — for a family it has never heard of it says
      // true, because something will render the text. Which is the fallback,
      // and the fallback is the whole fault.
      //
      // So the browser is made to draw it. The declared family is measured
      // against TWO sentinels with very different metrics; if the string comes
      // out the same width as both, the family contributed nothing and the text
      // is being set in something else. Two sentinels rather than one because a
      // real face matching monospace by accident is unlikely and matching
      // monospace AND serif is not a thing.
      const _c = document.createElement('canvas')
      const _x = _c.getContext('2d')
      const SAMPLE = 'Wمق5aAسلط—iIl1 gjy'
      const _fam = new Map()
      const applies = (family, weight, style) => {
        const key = `${style}|${weight}|${family}`
        if (_fam.has(key)) return _fam.get(key)
        const w = (f) => { _x.font = `${style} ${weight} 72px ${f}`; return _x.measureText(SAMPLE).width }
        const mono = w('monospace'), serif = w('serif')
        const a = w(`"${family}", monospace`), b = w(`"${family}", serif`)
        // Equal to BOTH its fallbacks means the family added nothing.
        const v = !(Math.abs(a - mono) < 0.5 && Math.abs(b - serif) < 0.5)
        _fam.set(key, v)
        return v
      }

      const out = []
      for (const el of document.querySelectorAll('*')) {
        // Text of its OWN. A wrapper measured once per descendant turns one
        // clipped price into twenty findings.
        const own = [...el.childNodes]
          .filter((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
          .map((n) => n.textContent.trim()).join(' ')
        if (!own) continue

        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue
        const box = el.getBoundingClientRect()
        if (box.width < 1 || box.height < 1) continue

        const px = parseFloat(cs.fontSize) || 0
        const weight = cs.fontWeight
        const list = cs.fontFamily
        // The FIRST declared family — the one the design asked for. Asking
        // about the whole list asks whether a fallback exists, and one always
        // does, which is precisely why this class of fault is silent.
        const first = (list.split(',')[0] || '').trim().replace(/^["']|["']$/g, '')

        // Can the browser set this text in that face at that weight?
        let settable = true
        if (first && !/^(system-ui|sans-serif|serif|monospace|cursive|fantasy|-apple-system|ui-[a-z]+)$/i.test(first)) {
          try { settable = applies(first, weight, cs.fontStyle) } catch { settable = true }
        }

        // A 1x1 BOX IS NOT A LAYOUT BOX, IT IS A HIDING TECHNIQUE. The first
        // run of this rig reported twelve clipped headings and every one was
        // `in 1x1` — the screen-reader-only pattern, `width:1px;height:1px;
        // overflow:hidden`, which is CORRECT accessibility markup doing exactly
        // what it is for. The rig found the shape it was written to find and
        // the shape was not the fault: the same mistake as reading a lazy
        // attribute as a slow image, one surface over. Counted, so the
        // exclusion is visible rather than silent.
        const srOnly = el.clientWidth < 4 || el.clientHeight < 4

        // Clipped: overflowing a box that HIDES the overflow. A scrollable box
        // is not a fault and a line-clamp is deliberate, so both are excluded.
        const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none'
        const hidesX = /hidden|clip/.test(cs.overflowX)
        const hidesY = /hidden|clip/.test(cs.overflowY)
        const overX = hidesX && el.scrollWidth > el.clientWidth + 1
        const overY = hidesY && !clamped && el.scrollHeight > el.clientHeight + 1
        const ellipsis = cs.textOverflow === 'ellipsis'

        out.push({
          px: Math.round(px * 10) / 10, weight, first, settable, srOnly,
          clip: (overX || overY) && !ellipsis && !srOnly
            ? `${overX ? 'x' : 'y'} ${el.scrollWidth}x${el.scrollHeight} in ${Math.round(el.clientWidth)}x${Math.round(el.clientHeight)}`
            : '',
          tag: el.tagName.toLowerCase(),
          text: own.slice(0, 40),
        })
      }
      return out
    }).catch(() => [])

    if (rows.length) pagesWalked++
    for (const r of rows) {
      seen++
      if (r.srOnly) { srOnlyCount++; continue }   // hidden from sight on purpose
      bump(sizes, r.px)
      bump(weights, r.weight)
      bump(families, r.first || '(none)')
      const where = `${lang} ${path} <${r.tag}> "${r.text}"`
      if (!r.settable) unsettable.push(`${where} — ${r.weight} ${r.first}`)
      if (r.clip) clipped.push(`${where} — ${r.clip}`)
      if (r.px > 0 && r.px < MIN_PX) tiny.push(`${where} — ${r.px}px`)
    }
  }
}

await b.close()

/* ---------------------------------------------------- did it see anything */
check(pagesWalked === PAGES.length * LANGS.length,
  `every page rendered text (${pagesWalked}/${PAGES.length * LANGS.length})`,
  pagesWalked ? '' : 'the sandbox is not answering — nothing below is a measurement')
check(seen > 500, `${seen} runs of text measured`,
  seen > 500 ? '' : 'too few to have walked the shop; a scan that finds nothing reports its own environment')

/* -------------------------------------------------------------- the faults */
const uniq = (a) => [...new Set(a)]
const u = uniq(unsettable), c = uniq(clipped), t = uniq(tiny)

check(u.length === 0,
  u.length
    ? `${u.length} run(s) of text ask for a face the browser cannot set — they fall back silently:\n       `
      + u.slice(0, 12).join('\n       ')
    : 'every run of text can be set in the family and weight the CSS names')

check(c.length === 0,
  c.length
    ? `${c.length} run(s) of text are CLIPPED by a box that hides the overflow:\n       `
      + c.slice(0, 12).join('\n       ')
    : 'no text is cut off by its own box')

check(t.length === 0,
  t.length
    ? `${t.length} run(s) of text render under ${MIN_PX}px:\n       ` + t.slice(0, 12).join('\n       ')
    : `no text renders under ${MIN_PX}px`)

/* --------------------------------------------- the inventory, never failed */
const top = (m, n = 14) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
  .map(([k, v]) => `${k}×${v}`).join('  ')
console.log(`\n--- the type, as rendered (reported, not judged)`)
console.log(`sizes     ${top(sizes)}`)
console.log(`weights   ${top(weights)}`)
console.log(`families  ${top(families, 8)}`)
console.log(`skipped   ${srOnlyCount} screen-reader-only runs (1x1 boxes — hidden on purpose, not clipped)`)

console.log(fails ? `\n${fails} failed` : `\nall ok — ${seen} runs of text, nothing clipped, nothing falling back`)
process.exit(fails ? 1 : 0)
