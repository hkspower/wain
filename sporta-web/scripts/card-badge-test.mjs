// The best-seller badge sits ABOVE the product photo on a shop card (public/sporta-shadows.css, CARD BADGE).
// Live (2026-11-17, owner's phone screenshot): the photo's layer painted over the badge, so only its top edge showed.
// This renders the card's own structure (frame with overflow hidden, photo at z-index 1 as on the live shop, badge
// absolutely placed) with the real add-on CSS, and asks the browser which element is on top at the badge's centre.
// The mutation removes the rule and must make the check fail.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(join(ROOT, 'public/sporta-shadows.css'), 'utf8')
const RULE = ':root .storefront-root .catalog-card-image .catalog-card-badge {\n  z-index: 3;\n}'
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }

// A 1x1 grey PNG, stretched over the frame (object-fit: cover), so the photo is opaque where the badge sits.
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const card = (lang, css = CSS) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff}
  .storefront-root{font-family:system-ui,sans-serif}
  .product-grid-card{position:relative;width:240px;margin:40px}
  .catalog-card-image{position:relative;overflow:hidden;width:240px;height:240px;border-radius:12px}
  .catalog-card-photo{position:relative;z-index:1;display:block;width:240px;height:240px;object-fit:cover}
  .catalog-card-badge{position:absolute;top:10px;inset-inline-start:10px;padding:4px 10px;background:#171a1e;color:#fff;font-weight:700;font-size:12px;border-radius:8px}
</style><style>${css}</style></head><body>
<div class="storefront-root"><div class="product-grid"><div class="product-grid-card">
  <div class="catalog-card-image"><img class="catalog-card-photo" alt="" src="${PHOTO}"><span class="catalog-card-badge">${lang === 'ar' ? 'الأكثر مبيعًا' : 'Bestseller'}</span></div>
</div></div></div></body></html>`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
async function topAtBadge(html) {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
  await page.setContent(html, { waitUntil: 'load' })
  const r = await page.evaluate(() => {
    const b = document.querySelector('.catalog-card-badge')
    const br = b.getBoundingClientRect()
    const top = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2)
    return { onTop: !!top && (top === b || b.contains(top)), topTag: top ? top.tagName.toLowerCase() + '.' + String(top.className) : null, z: getComputedStyle(b).zIndex }
  })
  await page.close()
  return r
}
for (const lang of ['en', 'ar']) {
  const r = await topAtBadge(card(lang))
  is(r.onTop && r.z === '3', `the best-seller badge is on top of the photo (${lang})`, `top=${r.topTag} z=${r.z}`)
}
// Mutation: the same card with the rule taken out must NOT pass, so the check can tell.
const cut = CSS.replace(RULE, '')
is(cut !== CSS, 'mutation set up: the CARD BADGE rule is found in the add-on')
const m = await topAtBadge(card('en', cut))
is(!m.onTop, 'MUTATION: without the rule the photo covers the badge and the check FAILS (it can tell)', `top=${m.topTag} z=${m.z}`)
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
