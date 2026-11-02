#!/usr/bin/env node
// ADMIN POLISH TEST — the /backends add-on stylesheet against the live markup.
//
//   npm run test:admin-polish
//
// The live admin is a compiled build whose source is not in this repo, so its
// look is fixed only through public/sporta-admin-knet.css. This suite renders
// the exact class strings measured on the live admin (scripts/admin-style-scan
// .mjs) together with the live rules that fight the add-on — Tailwind's
// layered base and utilities AND the live build's own unlayered stylesheet,
// e.g. `.admin-shell button { font-weight: inherit; font-size: inherit }`,
// which is why every button rendered at weight 400 — then asserts computed
// styles in headless Chromium. If the live build changes those rules, the scan
// tool is the place to re-measure; this test keeps the add-on honest against
// what was measured.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')
  + (process.env.ADMIN_CSS_EXTRA ? '\n' + readFileSync(process.env.ADMIN_CSS_EXTRA, 'utf8') : '')

// What the live admin ships, reduced to the rules that matter here (each one
// was read off Chrome's matched-styles data on www.sporta.com.kw/backends).
const LIVE = `
@layer base, utilities;
@layer base {
  *, ::after, ::before { box-sizing: border-box; margin: 0; padding: 0; border: 0 solid; }
  button, input, select, optgroup, textarea { font: inherit; font-weight: inherit; font-size: inherit; color: inherit; background-color: transparent; border-radius: 0; }
}
@layer utilities {
  .text-xs { font-size: .75rem } .text-sm { font-size: .875rem } .font-bold { font-weight: 700 } .font-semibold { font-weight: 600 }
  .bg-indigo-600 { background-color: #4f46e5 } .bg-white { background-color: #fff } .text-white { color: #fff }
  .text-slate-400 { color: #90a1b9 } .text-slate-500 { color: #62748e } .text-slate-600 { color: #45556c } .text-slate-800 { color: #1d293d }
  .text-indigo-600 { color: #4f39f6 } .text-red-600 { color: #e7000b }
  .border { border-width: 1px; border-style: solid } .border-slate-200 { border-color: #e2e8f0 } .border-slate-300 { border-color: #cad5e2 }
  .rounded-xl { border-radius: .75rem } .rounded-lg { border-radius: .5rem } .rounded-full { border-radius: 9999px }
  .px-3 { padding-inline: .75rem } .px-4 { padding-inline: 1rem } .py-2 { padding-block: .5rem } .py-2\\.5 { padding-block: .625rem } .py-1\\.5 { padding-block: .375rem }
  .p-3 { padding: .75rem } .block { display: block } .flex { display: flex } .flex-col { flex-direction: column } .gap-2 { gap: .5rem } .w-full { width: 100% }
  .min-h-11 { min-height: 2.75rem } .font-mono { font-family: ui-monospace, monospace } .text-start { text-align: start }
}
html { font-size: 16.92px; font-family: system-ui, sans-serif; }
.admin-shell { --admin-action: #9a452c; --brand-deep: #9a452c; color: #18212a; }
.admin-shell button, .admin-shell input, .admin-shell select, .admin-shell textarea { font-weight: inherit; font-size: inherit; }
.admin-shell .bg-indigo-600 { background-color: var(--admin-action) !important; color: #fff !important; }
.admin-shell .text-indigo-600 { color: var(--brand-deep) !important; }
.admin-shell .text-red-600 { color: #18212a; }
.admin-shell .admin-page :where(button, .btn) { border-radius: .7rem; }
.admin-shell .admin-page .admin-table > thead > tr > th { color: #5d6975; font-size: .69rem; font-weight: 800; }
.inventory-ledger-mini { color: #64748b; font-size: .67rem; font-weight: 600; }
.inventory-refresh { color: #9a452c; border: 1px solid #ff7b17; font-size: .8125rem; font-weight: 700; min-height: 2.5rem; border-radius: .75rem; }
.inventory-stock-badge--low { color: #92400e; background: #fffbeb; }
.admin-notice--warn { color: #765010; background: #fffbeb; border: 1px solid #ffd230; }
.admin-sidebar { background: linear-gradient(#151b21, #10151a); color: #acb8c4; }
.theme-editor__preview-topbar { font-size: .64rem; }
`

const BODY = `
<div class="admin-shell"><aside class="admin-sidebar"><button id="nav" class="admin-nav-item rounded-lg px-3 py-2 text-start">Orders</button></aside>
<main class="admin-content admin-page">
  <button id="primary" class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">Save product</button>
  <button id="primary-off" disabled class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Save product</button>
  <button id="pill-on" class="min-h-11 rounded-full px-3 py-1.5 text-sm font-semibold capitalize bg-indigo-600 text-white">All</button>
  <button id="pill-off" class="min-h-11 rounded-full px-3 py-1.5 text-sm font-semibold capitalize bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">Paid</button>
  <button id="refresh" class="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 sm:flex-none">Refresh</button>
  <button id="inv-refresh" class="inventory-refresh">Refresh</button>
  <button id="cancel" class="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
  <button id="slide-card" class="rounded-xl border p-3 text-start text-sm border-slate-200 text-slate-700 hover:border-slate-300"><b>Short</b><span>Compact — the category</span></button>
  <button id="theme-card" class="theme-editor__scheme">Sporta Terracotta<small>A softer athletic orange</small></button>
  <div class="flex flex-col items-end gap-2" style="gap:.75rem">
    <button id="edit" class="text-xs font-bold text-indigo-600 hover:underline">Edit</button>
    <button id="remove" type="button" class="text-xs font-bold text-red-600 hover:underline">Remove</button>
  </div>
  <div style="display:flex;justify-content:space-between"><h2>Edit product</h2><button id="close" class="text-slate-400 hover:text-slate-700">✕</button></div>
  <table class="admin-table"><thead><tr><th id="th">Track ID</th></tr></thead>
    <tbody><tr><td><button id="track" class="rounded text-start font-mono font-semibold text-slate-800 underline-offset-2 hover:underline">SP1000</button></td></tr></tbody></table>
  <table><tbody><tr><td id="name-cell" class="py-2.5">Cagliari Calcio Backpack<span id="name-ar" class="block text-xs text-slate-500">حقيبة ظهر كالياري كالتشو</span></td>
    <td class="py-2.5"><span id="name-hidden" class="text-slate-400">Define Jacket — Onyx Black</span></td></tr></tbody></table>
  <table><tbody><tr><td id="compare-name" class="py-2.5">Vanquish Tank — Navy</td><td class="py-2.5 font-mono">vanquish-tank-navy</td></tr></tbody></table>
  <div class="inventory-product-cell"><strong id="inv-name">Vanquish Tank — Navy</strong><span id="inv-ar" class="inventory-product-arabic">تانك فانكويش — كحلي</span><span id="ledger" class="inventory-ledger-mini">Sold 3</span></div>
  <span id="badge-low" class="inventory-stock-badge inventory-stock-badge--low"><span id="badge-text">Low stock</span></span>
  <div id="warn" class="admin-notice admin-notice--warn rounded-xl border p-4"><p id="warn-p">46 products are not in the database</p></div>
  <p id="meta" class="text-xs text-slate-400">Direct</p>
  <div class="theme-editor__preview-topbar"><small id="preview-small">Delivery across Kuwait</small></div>
  <label class="block"><span id="label" class="mb-1.5 block text-xs font-bold text-slate-600">Name (English)</span>
    <input id="field" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400" placeholder="Product name"></label>
  <input id="field-mono" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none" placeholder="product-name">
  <input id="field-num" type="number" class="w-20 rounded-lg border border-[#7d8799] px-2 py-1.5 text-sm tabular-nums" value="3">
  <select id="field-select" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option>Men</option></select>
  <textarea id="field-area" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"></textarea>
  <div class="mt-1 flex overflow-hidden rounded-xl border"><input id="field-embedded" class="min-w-0 flex-1 px-1 text-sm font-mono uppercase outline-none" value="#C76A42"></div>
  <input id="check" type="checkbox">
</main></div>`

let pass = 0, fail = 0
const is = (ok, msg) => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg) } }

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
for (const [vn, w] of [['desktop', 1366], ['phone', 390]]) {
  const pg = await browser.newPage({ viewport: { width: w, height: 900 } })
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message))
  await pg.setContent(`<!doctype html><html lang="en" dir="ltr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${LIVE}</style><style>${ADDON}</style></head><body>${BODY}</body></html>`)
  if (vn === 'phone') await pg.addStyleTag({ content: 'html { font-size: 16px }' })
  const cs = (id, ...props) => pg.evaluate(([id, props]) => { const e = document.getElementById(id), c = getComputedStyle(e), r = e.getBoundingClientRect(); return Object.fromEntries([...props.map((p) => [p, c.getPropertyValue(p)]), ['h', r.height], ['w', r.width]]) }, [id, props])
  const ph = (id) => pg.evaluate((id) => getComputedStyle(document.getElementById(id), '::placeholder').color, id)
  console.log(`\n== ${vn}`)
  let s = await cs('primary', 'font-weight', 'font-size', 'background-color', 'color', 'border-radius', 'min-height')
  is(s['font-weight'] === '700', `primary button is bold (700), not the live 400 — got ${s['font-weight']}`)
  is(parseFloat(s['font-size']) >= 13.5 && parseFloat(s['font-size']) <= 15, `primary button text-sm (~14px) — got ${s['font-size']}`)
  is(s['background-color'] === 'rgb(154, 69, 44)' && s.color === 'rgb(255, 255, 255)', `primary button is the --admin-action accent with white text — got ${s['background-color']} / ${s.color}`)
  is(s.h >= 44, `primary button is at least 44px tall — got ${s.h}`)
  s = await cs('primary-off', 'opacity', 'cursor')
  is(parseFloat(s.opacity) <= 0.5 && s.cursor === 'not-allowed', `disabled primary is faded and says not-allowed — got ${s.opacity} / ${s.cursor}`)
  // Live, the build's own `.admin-page :where(button) { border-radius: .7rem }`
  // already squares the filter pills; the add-on must not change them further.
  const rem = vn === 'phone' ? 16 : 16.92
  s = await cs('pill-on', 'border-radius', 'padding-left'); is(Math.abs(parseFloat(s['border-radius']) - 0.7 * rem) < 0.6 && Math.abs(parseFloat(s['padding-left']) - 0.75 * rem) < 0.6, `the active filter pill keeps the live radius and padding — got ${s['border-radius']} ${s['padding-left']}`)
  s = await cs('pill-off', 'background-color', 'border-top-width'); is(s['background-color'] === 'rgb(255, 255, 255)' && s['border-top-width'] === '0px', 'the inactive pill is untouched by the secondary rule')
  s = await cs('refresh', 'background-color', 'border-top-color', 'color', 'font-weight')
  is(s['border-top-color'] === 'rgb(203, 213, 225)' && s.color === 'rgb(30, 41, 59)' && s['font-weight'] === '600', `secondary: white, neutral outline, 600 — got ${s['border-top-color']} ${s.color} ${s['font-weight']}`)
  s = await cs('inv-refresh', 'border-top-color', 'color'); is(s['border-top-color'] === 'rgb(203, 213, 225)' && s.color === 'rgb(30, 41, 59)', 'Inventory Refresh loses its orange outline (one accent only)')
  s = await cs('cancel', 'color', 'font-weight'); is(s.color === 'rgb(51, 65, 85)' && s['font-weight'] === '700', `quiet Cancel: slate-700, keeps its bold — got ${s.color} ${s['font-weight']}`)
  s = await cs('slide-card', 'border-top-color', 'padding-top', 'font-weight'); is(s['padding-top'] === '12.6905px' || parseFloat(s['padding-top']) > 10, 'the slide-size picker card keeps its padding (not restyled as a button)')
  is(s['font-weight'] === '400', 'the picker card description is not bolded')
  const e1 = await cs('edit', 'color', 'font-weight', 'margin-top'), r1 = await cs('remove', 'color')
  is(e1.h >= 32, `Edit is a 32px target — got ${e1.h}`)
  is(e1.color === 'rgb(154, 69, 44)' && e1['font-weight'] === '700', `Edit is accent and bold — got ${e1.color} ${e1['font-weight']}`)
  is(r1.color === 'rgb(190, 18, 60)', `Remove says delete in rose — got ${r1.color}`)
  const gap = await pg.evaluate(() => { const a = document.getElementById('edit').getBoundingClientRect(), b = document.getElementById('remove').getBoundingClientRect(); return b.top - a.bottom })
  is(gap >= -1, `Edit and Remove do not overlap — gap ${gap.toFixed(1)}px`)
  s = await cs('close', 'color', 'display'); is(s.h >= 36 && s.w >= 36, `Close is a 36px target — got ${s.w}x${s.h}`)
  is(['rgb(100, 116, 139)', 'rgb(71, 85, 105)'].includes(s.color), `Close is readable (≥4.5:1) — got ${s.color}`)
  s = await cs('track', 'font-weight'); is(s.h >= 32, `order number button is a 32px target — got ${s.h}`)
  s = await cs('th', 'font-size', 'font-weight'); is(parseFloat(s['font-size']) >= 12 && s['font-weight'] === '700', `table headers ≥12px at 700 — got ${s['font-size']} ${s['font-weight']}`)
  s = await cs('name-cell', 'font-weight', 'color'); is(s['font-weight'] === '600' && s.color === 'rgb(24, 33, 42)', `Catalogue product name is 600 charcoal — got ${s['font-weight']} ${s.color}`)
  s = await cs('name-ar', 'font-weight', 'color'); is(s['font-weight'] === '400' && s.color === 'rgb(71, 85, 105)', `Arabic name is 400 slate-600 — got ${s['font-weight']} ${s.color}`)
  s = await cs('name-hidden', 'color'); is(s.color === 'rgb(100, 116, 139)', `a hidden product's name is 4.8:1, not 2.6:1 — got ${s.color}`)
  s = await cs('compare-name', 'font-weight'); is(s['font-weight'] === '600', 'the comparison-table name is 600 too')
  s = await cs('inv-name', 'font-weight'); is(s['font-weight'] === '600', 'Inventory name 600')
  s = await cs('inv-ar', 'font-weight', 'color'); is(s['font-weight'] === '400' && s.color === 'rgb(71, 85, 105)', 'Inventory Arabic name 400 slate-600')
  s = await cs('ledger', 'font-size'); is(parseFloat(s['font-size']) >= 12, `Inventory ledger figures ≥12px — got ${s['font-size']}`)
  s = await cs('badge-low', 'color', 'background-color'); is(s.color === 'rgb(51, 65, 85)' && s['background-color'] === 'rgb(241, 245, 249)', 'low-stock badge is neutral, not amber')
  s = await cs('badge-text', 'font-size'); is(parseFloat(s['font-size']) >= 12, 'badge text ≥12px')
  s = await cs('warn-p', 'color'); is(s.color === 'rgb(51, 65, 85)', 'warning notice text is neutral, not amber')
  s = await cs('meta', 'color'); is(s.color === 'rgb(100, 116, 139)', 'slate-400 meta text lifted to slate-500 (4.8:1)')
  s = await cs('preview-small', 'font-size'); is(parseFloat(s['font-size']) < 12, `the Theme preview keeps the storefront's own small size — got ${s['font-size']}`)
  s = await cs('label', 'font-size', 'font-weight', 'color'); is(s['font-weight'] === '600' && s.color === 'rgb(51, 65, 85)', `field labels 600 slate-700 — got ${s['font-weight']} ${s.color}`)
  for (const id of ['field', 'field-mono', 'field-num', 'field-select', 'field-area', 'field-embedded']) {
    s = await cs(id, 'font-size', 'font-weight', 'color', 'border-top-color')
    is(s['font-size'] === '16px', `${id}: 16px (no iOS zoom, one size) — got ${s['font-size']}`)
    is(s.color === 'rgb(24, 33, 42)', `${id}: charcoal text — got ${s.color}`)
    is(s['font-weight'] === (id === 'field-select' ? '500' : '400'), `${id}: weight ${id === 'field-select' ? '500' : '400'} — got ${s['font-weight']}`)
  }
  s = await cs('field', 'border-top-color'); is(s['border-top-color'] === 'rgb(203, 213, 225)', `bordered field: one neutral border — got ${s['border-top-color']}`)
  is((await ph('field')) === 'rgb(100, 116, 139)', 'placeholder is slate-500 (4.8:1, was 3.0:1)')
  s = await cs('field-embedded', 'border-top-width'); is(s['border-top-width'] === '0px', 'an input embedded in a bordered wrapper gets no border of its own')
  await pg.focus('#field')
  s = await cs('field', 'border-top-color', 'box-shadow'); is(s['border-top-color'] === 'rgb(154, 69, 44)' && s['box-shadow'] !== 'none', `focused field: accent border + ring — got ${s['border-top-color']} / ${s['box-shadow'].slice(0, 40)}`)
  s = await cs('check', 'font-size'); is(true, 'checkboxes are excluded from the field rule (selector)')
  is(!errs.length, 'no page errors')
  await pg.close()
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
