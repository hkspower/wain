// The Payments screen rules (section 8 of public/sporta-admin-knet.css), proven on the live markup.
//
//   npm run test:admin-payments     (no sandbox needed: a fixture, real Tailwind, the add-on CSS)
//
// The fixture (scripts/fixtures/admin-payments.mjs) is the exact element tree and class list dumped from the
// live /backends Payments screen, so a rule is checked against what the build really emits. What it asserts,
// each at 1280, 390, 360 and 320px wide:
//
//   1. the Mode / Gateway tiles keep their edge (section 6's #d9dfe5, .875rem), sit two to a row, and the
//      gateway host is never truncated: smaller type at 360-399px, one column below 360;
//   2. the Merchant ID / Terminal ID and Merchant Server IP blocks are panels of their own, and their save
//      button is the outlined one (white, accent text and edge, no shadow) while the form's own save stays
//      filled; hover tints the outlined one, but not while it is disabled;
//   3. the "take KNET through this CBK setup" card keeps its checkbox on the row, square, whether it sits
//      before the IP panel (as the script now builds it) or inside it (as it did);
//   4. every field label has one line height;
//   5. the loose sky-blue note is hidden only while the IP panel it repeats exists;
//   6. nothing overflows sideways.
//
// Every width is run twice: as the light admin, and as a device set to dark with the live build's REAL dark rules
// on the page (scripts/fixtures/admin-dark-rules.css, html.dark + data-theme=dark). The Payments screen is light
// only (owner decision 2026-11-03), so every number above must hold in both; the colour side of that is
// asserted in full by admin-payments-light-test.mjs, this re-run proves the layout rules survive it.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BODY_HTML, LIVE } from './fixtures/admin-payments.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

const classes = [...new Set([...BODY_HTML.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'admin-payments-fixture.css') })).css
const DARK = readFileSync(join(ROOT, 'scripts/fixtures/admin-dark-rules.css'), 'utf8')
const cutAt = DARK.indexOf('/* ---- build /assets/AdminApp')
const DARK_INDEX = DARK.slice(DARK.indexOf('/* ---- build /assets/index'), cutAt) // linked before the add-ons
const DARK_ADMIN = DARK.slice(cutAt)                                                // the lazy admin chunk: after them
const page = (w, dark) => `<!doctype html><html lang="en" dir="ltr"${dark ? ' class="dark" data-theme="dark"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=${w},initial-scale=1"><style>${TW}</style><style>${LIVE}</style>${dark ? `<style>${DARK_INDEX}</style>` : ''}<style>${ADDON}</style>${dark ? `<style>${DARK_ADMIN}</style>` : ''}</head><body style="margin:0">${BODY_HTML}</body></html>`

const EDGE = 'rgb(217, 223, 229)', ACCENT = 'rgb(154, 69, 44)', WHITE = 'rgb(255, 255, 255)', TINT = 'rgb(253, 245, 241)'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

for (const [dark, w] of [false, true].flatMap((d) => [1280, 390, 360, 320].map((x) => [d, x]))) {
  head(`${w}px${dark ? ', dark device and dark theme' : ''}`)
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: dark ? 'dark' : 'light' })
  const pg = await ctx.newPage()
  await pg.setContent(page(w, dark))

  // 1. status tiles
  const t = await pg.evaluate(() => {
    const dl = document.querySelector('.payment-gateway-card > dl')
    const tile = dl.firstElementChild
    const c = getComputedStyle(tile)
    const hosts = [...document.querySelectorAll('.payment-gateway-card dd.font-mono')]
    return { cols: getComputedStyle(dl).gridTemplateColumns.split(' ').length, edge: c.borderTopColor, width: c.borderTopWidth, radius: c.borderTopLeftRadius,
      trunc: hosts.filter((h) => h.scrollWidth > h.clientWidth + 0.5).map((h) => `${h.textContent} ${h.scrollWidth}>${h.clientWidth}`) }
  })
  is(t.cols === (w < 360 ? 1 : 2), `status tiles: ${w < 360 ? 'one column below 360px' : 'two to a row'}`, `${t.cols} columns`)
  is(t.edge === EDGE && t.width === '1px' && t.radius === '14px', 'tiles keep a 1px #d9dfe5 edge and the .875rem radius', `${t.width} ${t.edge} ${t.radius}`)
  is(t.trunc.length === 0, 'the gateway host is not truncated', t.trunc.join(' | '))

  // 2. panels and their buttons
  const pn = await pg.evaluate(() => [...document.querySelectorAll('[data-sporta-knet-ids], [data-sporta-tpay-ips]')].map((p) => {
    const c = getComputedStyle(p), b = getComputedStyle(p.querySelector('button'))
    return { child: p.parentElement.matches('form.payment-gateway-editor'), edge: c.borderTopColor, width: c.borderTopWidth, radius: c.borderTopLeftRadius, pad: c.paddingTop,
      bg: b.backgroundColor, color: b.color, bEdge: b.borderTopColor, bWidth: b.borderTopWidth, shadow: b.boxShadow }
  }))
  is(pn.length === 2 && pn.every((p) => p.child), 'both blocks are direct children of their editor', JSON.stringify(pn.map((p) => p.child)))
  is(pn.every((p) => p.edge === EDGE && p.width === '1px' && p.radius === '14px' && p.pad === '16px'), 'both are panels: 1px #d9dfe5, .875rem, 1rem padding', JSON.stringify(pn[0]))
  is(pn.every((p) => p.bg === WHITE && p.color === ACCENT && p.bEdge === ACCENT && p.bWidth === '1px' && p.shadow === 'none'), 'their save button is outlined: white, accent text and edge, no shadow', JSON.stringify(pn[0]))
  const prim = await pg.evaluate(() => {
    const f = document.querySelector('form.payment-gateway-editor:has(.payment-knet-toggle-row)')
    const b = [...f.querySelectorAll('button')].filter((x) => !x.closest('[data-sporta-knet-ids]')).pop()
    const c = getComputedStyle(b)
    return { text: b.textContent, bg: c.backgroundColor, color: c.color }
  })
  is(prim.text === 'Save KNET' && prim.bg === ACCENT && prim.color === WHITE, "the form's own save stays the filled one", JSON.stringify(prim))

  const sel = '[data-sporta-knet-ids] button'
  // Buttons animate background-color over 150ms (section 4): read after it has settled.
  const settle = () => pg.waitForTimeout(350)
  await pg.hover(sel); await settle()
  is(await pg.$eval(sel, (b) => getComputedStyle(b).backgroundColor) === TINT, 'hover tints the outlined button')
  await pg.$eval(sel, (b) => { b.disabled = true })
  await pg.mouse.move(0, 0); await settle()
  await pg.hover(sel, { force: true }); await settle()
  const dis = await pg.$eval(sel, (b) => ({ bg: getComputedStyle(b).backgroundColor, op: getComputedStyle(b).opacity }))
  is(dis.bg === WHITE && Number(dis.op) < 0.5, 'disabled: no hover tint, and dimmed', JSON.stringify(dis))
  await pg.$eval(sel, (b) => { b.disabled = false })

  // 3. the CBK card, in both placements
  for (const placement of ['before the IP panel', 'inside the IP panel']) {
    if (placement === 'inside the IP panel') await pg.evaluate(() => {
      const label = document.querySelector('#__none, form.payment-gateway-editor > label.rounded-2xl') || document.querySelector('label.rounded-2xl:has(> input[type=checkbox])')
      document.querySelector('[data-sporta-tpay-ips]').appendChild(label)
    })
    const c = await pg.evaluate(() => {
      const label = document.querySelector('label.rounded-2xl:has(> input[type=checkbox])')
      const box = label.querySelector('input'), lr = label.getBoundingClientRect(), br = box.getBoundingClientRect()
      const pad = parseFloat(getComputedStyle(label).paddingRight)
      return { wrap: getComputedStyle(label).flexWrap, w: Math.round(br.width), h: Math.round(br.height), atEnd: Math.abs(lr.right - pad - br.right) <= 1.5, sameRow: br.top < lr.top + lr.height / 2 }
    })
    is(c.wrap === 'nowrap' && c.atEnd && c.sameRow, `CBK card (${placement}): checkbox at the end of the row, not wrapped under the text`, JSON.stringify(c))
    is(Math.abs(c.w - c.h) <= 1, `CBK card (${placement}): checkbox is square`, `${c.w}x${c.h}`)
  }

  // 4. one label line height
  const ratios = await pg.evaluate(() => [...new Set([...document.querySelectorAll('.payment-gateway-editor label > span:first-child:not(.sr-only)')]
    .filter((e) => e.getBoundingClientRect().height > 0)
    .map((e) => { const c = getComputedStyle(e); return (parseFloat(c.lineHeight) / parseFloat(c.fontSize)).toFixed(2) }))])
  is(ratios.length === 1 && ratios[0] === '1.30', 'every field label has line height 1.3', ratios.join(' '))

  // 5. the duplicate note goes only with the panel it repeats
  const note = await pg.evaluate(() => {
    const p = document.querySelector('p.bg-sky-50')
    const shown = () => getComputedStyle(p).display
    const withPanel = shown()
    document.querySelector('[data-sporta-tpay-ips]').remove()
    return { withPanel, without: shown() }
  })
  is(note.withPanel === 'none', 'the sky-blue note is hidden while the IP panel exists')
  is(note.without !== 'none', 'and visible again without it (the script has not run)', note.without)

  // 6. no sideways overflow
  const sw = await pg.evaluate(() => [document.documentElement.scrollWidth, innerWidth])
  is(sw[0] <= sw[1], 'nothing overflows sideways', `${sw[0]} in ${sw[1]}`)
  await ctx.close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
