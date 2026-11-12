// node scripts/make-gallery-fixtures.mjs <live index-*.css>
// Writes scripts/fixtures/gallery/live-extra.css: the rules of the LIVE compiled stylesheet that style the product gallery
// of a several-photo product (arrows, dots, thumbnails) and the open full-screen lightbox, which the product page capture
// (scripts/fixtures/sizes-product/live.css, one-photo products, lightbox closed) does not hold. The live gallery
// (fixtures/gallery/live-gallery.mjs) is mounted on the captured page under the WHOLE live stylesheet, the lightbox is
// opened, and every rule whose selector matches an element of the gallery or the lightbox (in English light and Arabic
// dark, so rtl: and dark: variants are seen; state pseudo-classes ignored for the match) is kept, in source order with
// its @media / @supports / @layer wrappers, minus what live.css already carries. Read-only on the live site: the
// stylesheet is a file captured from it earlier (the suites never fetch the live site).
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as G from './lib/gallery-page.mjs'
import * as PRD from './lib/sizes-product-page.mjs'

const src = process.argv[2]
if (!src) { console.error('usage: node scripts/make-gallery-fixtures.mjs <live index-*.css>'); process.exit(2) }
const LIVE_CSS = readFileSync(src, 'utf8')

const ref = { current: { addons: PRD.addonFiles(), extra: LIVE_CSS } }
const srv = await G.serve(ref)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const keep = new Map()   // index in source order -> text
for (const [lang, dark] of [['en', false], ['ar', true]]) for (const w of [390, 1280]) {
  const p = await browser.newPage({ viewport: { width: w, height: 900 } })
  await p.goto(`${srv.base}/__gx/full-${lang}-${w}${dark ? '-dark' : ''}`)
  await p.evaluate(([images, lang]) => window.__fxMount({ images, alt: 'Denver Nuggets Cap', lang }), [G.SETS.multi.images, lang])
  await p.click('.catalog-gallery-stage')
  await p.waitForSelector('.catalog-product-lightbox')
  const got = await p.evaluate(() => {
    const els = [...document.querySelectorAll('.catalog-gallery, .catalog-gallery *, .catalog-product-lightbox, .catalog-product-lightbox *')]
    const sheet = [...document.styleSheets].find((s) => s.ownerNode && s.ownerNode.id === 'fx-gallery-live')
    const cap = [...document.styleSheets].find((s) => s.ownerNode && s.ownerNode.id === 'fx-live')
    const strip = (sel) => sel.replace(/::?(hover|focus-visible|focus-within|focus|active|before|after|placeholder|disabled)\b/g, '')
    const out = []
    let n = 0
    const walk = (rules, wrap, all) => {
      for (const r of rules) {
        n++
        if (r.cssRules && !(r instanceof CSSStyleRule)) {
          const head = r instanceof CSSMediaRule ? `@media ${r.conditionText}` : r instanceof CSSSupportsRule ? `@supports ${r.conditionText}` : r instanceof CSSLayerBlockRule ? `@layer ${r.name}` : null
          if (head) walk(r.cssRules, [...wrap, head], all)
          continue
        }
        if (!(r instanceof CSSStyleRule)) continue
        let hit = !!all
        if (!all) for (const sel of r.selectorText.split(/,(?![^(]*\))/)) {
          const s = strip(sel.trim()) || '*'
          try { if (els.some((e) => e.matches(s))) { hit = true; break } } catch (e) {}
        }
        if (hit) out.push([n, wrap.reduceRight((acc, h) => `${h} { ${acc} }`, r.cssText)])
      }
    }
    walk(cap.cssRules, [], true)
    const had = new Set(out.map((o) => o[1].replace(/\s+/g, '')))
    out.length = 0; n = 0
    walk(sheet.cssRules, [])
    return out.filter((o) => !had.has(o[1].replace(/\s+/g, '')))
  })
  for (const [i, t] of got) keep.set(i, t)
  await p.close()
}
await browser.close(); srv.server.close()
const rules = [...keep.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t)
writeFileSync(join(G.GX, 'live-extra.css'), `/* The rules of the live compiled stylesheet (${src.split('/').pop()}, captured from https://www.sporta.com.kw) that style the several-photo product gallery (arrows, dots, thumbnails) and the open full-screen lightbox, minus those in ../sizes-product/live.css; dumped by scripts/make-gallery-fixtures.mjs. Do not edit by hand. */\n` + rules.join('\n') + '\n')
console.log(`${rules.length} rules -> scripts/fixtures/gallery/live-extra.css`)
