#!/usr/bin/env node
// ADMIN POLISH TEST — the /backends add-on stylesheet against the live markup.
//
//   npm run test:admin-polish
//
// The live admin is a compiled build whose source is not in this repo, so its
// look is fixed only through public/sporta-admin-knet.css (the one add-on its
// index.html loads). This suite renders the exact class strings measured on
// the live admin (scripts/admin-style-scan.mjs) inside the cascade that fights
// the add-on:
//   1. real Tailwind v4 (the repo's own, compiled for exactly these classes,
//      in its @layer theme/base/utilities) — so .hidden, md:hidden, hover:,
//      dark: and min-h-11 behave as they do live;
//   2. the live build's own UNLAYERED rules, each read off Chrome's
//      matched-styles data on www.sporta.com.kw/backends — e.g.
//      `.admin-shell button { font-weight: inherit; font-size: inherit }`,
//      which is why every button rendered at weight 400;
//   3. public/sporta-admin-knet.css, and nothing else.
// Then it asserts computed styles in headless Chromium at 1366px (1rem =
// 16.92px, as live) and 390px (1rem = 16px). Elements the add-on must NOT
// touch are compared against the same page rendered without it.
// If the live build changes, re-measure with the scan tool; this keeps the
// add-on honest against what was measured.
//
// Not covered, on purpose: CRM's header toggle, which reads "Cancel" while the
// add-contact form is open but keeps class crm-primary. Nothing in its markup
// as measured lets CSS tell it from "Create contact"; it needs a JS hook.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(join(ROOT, 'public/sporta-admin-knet.css'), 'utf8')

const BODY = `
<div class="admin-shell">
<aside class="admin-sidebar"><button id="nav" class="admin-nav-item rounded-lg px-3 py-2 text-start">Orders</button></aside>
<header class="m-header"><small id="mh-small">Sporta Operations</small></header>
<main class="admin-content admin-page">
  <span id="mix-ref" style="background-color: color-mix(in srgb, #9a452c 84%, #000)">ref</span>

  <!-- primaries -->
  <button id="primary" class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">Save product</button>
  <button id="primary-off" disabled class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Save product</button>
  <button id="push" disabled class="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-wait disabled:opacity-60">Push 46 products</button>
  <button id="emerald" class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">Cash collected — mark paid</button>
  <button id="amber" class="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700">Confirm paid</button>
  <span id="emerald-badge" class="rounded-full bg-emerald-600 px-2 text-xs text-white">Paid</span>
  <button id="crm-add" class="crm-primary">Create contact</button>
  <button id="topbar-save" class="topbar-editor__save">Save top bar</button>

  <!-- Orders toolbar -->
  <div class="flex flex-wrap items-center gap-2">
    <button id="pill-on" class="min-h-11 rounded-full px-3 py-1.5 text-sm font-semibold capitalize bg-indigo-600 text-white">All</button>
    <button id="pill-off" class="min-h-11 rounded-full px-3 py-1.5 text-sm font-semibold capitalize bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">Paid</button>
    <select id="ord-select" class="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold sm:w-auto"><option>All methods</option></select>
    <button id="refresh" class="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 sm:flex-none">Refresh</button>
  </div>

  <!-- secondary and bordered buttons -->
  <button id="inv-refresh" class="inventory-refresh">Refresh</button>
  <button id="crm-refresh" class="crm-refresh">Refresh</button>
  <button id="hover-indigo" class="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-indigo-50">Export</button>
  <button id="edit-product" class="min-h-11 rounded-xl border border-indigo-200 px-4 py-2 text-sm font-bold text-indigo-700 dark:border-slate-600 dark:text-orange-300">Edit product</button>
  <button id="block-cod" class="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Block cash on delivery</button>
  <button id="block-all" class="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50">Block entirely</button>
  <label id="upload" class="admin-product-upload-button rounded-xl px-4 py-2 text-sm font-bold"><input id="upload-input" type="file" style="position:absolute;width:1px;height:1px;opacity:0">Add photo</label>

  <!-- quiet -->
  <button id="cancel" class="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button>
  <button id="cancel2" class="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-600">Cancel</button>
  <button id="cancel-off" disabled class="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">Cancel</button>

  <!-- picker cards: not buttons in the toolbar sense -->
  <button id="slide-card" class="rounded-xl border p-3 text-start text-sm border-slate-200 text-slate-700 hover:border-slate-300"><b>Short</b><span>Compact — the category</span></button>
  <button id="theme-card" class="theme-editor__scheme theme-editor__scheme--active">Sporta Terracotta<small id="theme-small">A softer athletic orange</small></button>

  <!-- row actions: stacked (Catalogue) and side by side (Brands card) -->
  <div class="flex flex-col items-end" style="gap:.75rem">
    <button id="edit" class="text-xs font-bold text-indigo-600 hover:underline">Edit</button>
    <button id="remove" type="button" class="text-xs font-bold text-red-600 hover:underline">Remove</button>
  </div>
  <div class="flex items-center gap-3">
    <button id="b-edit" class="text-xs font-bold text-indigo-600 hover:underline">Edit</button>
    <button id="b-remove" class="text-xs font-bold text-red-600 hover:underline">Remove</button>
  </div>
  <button id="remove-off" disabled class="text-xs font-bold text-red-600 hover:underline">Remove</button>
  <button id="edit-hidden" class="hidden text-xs font-bold text-indigo-600 hover:underline">Edit</button>

  <!-- modal header -->
  <div class="flex items-center justify-between"><h2>Edit product</h2>
    <button id="close" aria-label="Close" class="text-slate-400 hover:text-slate-700">✕</button>
    <button id="close-hidden" class="hidden text-slate-400 hover:text-slate-700">✕</button>
    <button id="close-md" class="text-slate-400 md:hidden">✕</button></div>

  <!-- tables -->
  <table class="admin-table"><thead><tr><th id="th">Track ID</th></tr></thead>
    <tbody><tr><td><button id="track" class="rounded text-start font-mono font-semibold text-slate-800 underline-offset-2 hover:underline">SP1000</button></td></tr></tbody></table>
  <table><tbody><tr>
    <td id="name-cell" class="py-2.5">Cagliari Calcio Backpack<span id="name-ar" class="block text-xs text-slate-500">حقيبة ظهر كالياري كالتشو</span></td>
    <td class="p-3"><span id="name-vis" class="font-semibold text-slate-800">Vanquish Tank — Navy</span><span id="name-vis-ar" class="block text-xs text-slate-500">تانك فانكويش — كحلي</span></td>
    <td class="p-3"><span id="name-hidden" class="text-slate-400">Define Jacket — Onyx Black</span><span id="name-hidden-ar" class="block text-xs text-slate-500">جاكيت ديفاين — أسود</span></td>
  </tr></tbody></table>
  <table><tbody><tr><td id="compare-name" class="py-2.5">Vanquish Tank — Navy</td><td class="py-2.5 font-mono">vanquish-tank-navy</td></tr></tbody></table>

  <!-- Inventory and the phone rows -->
  <div class="inventory-product-cell"><strong id="inv-name">Vanquish Tank — Navy</strong><span id="inv-ar" class="inventory-product-arabic">تانك فانكويش — كحلي</span>
    <span id="ledger" class="inventory-ledger-mini">Sold 3</span><span id="inv-meta" class="inventory-product-meta">accessories</span><span id="size-chip" class="inventory-size-chip">2XL</span></div>
  <span id="badge-low" class="inventory-stock-badge inventory-stock-badge--low"><span id="badge-text">Low stock</span></span>
  <div class="m-row"><div class="min-w-0"><p id="m-title" class="m-row__title break-words">Cagliari Calcio Backpack</p><p id="m-ar" class="text-xs text-slate-600 dark:text-slate-300">حقيبة ظهر كالياري كالتشو</p></div>
    <span id="m-badge" class="m-row__badge m-row__badge--paid">in sync</span></div>
  <div class="m-row"><div class="min-w-0"><p id="m-title-hidden" class="m-row__title break-words text-slate-500">Define Jacket — Onyx Black</p><p id="m-ar-hidden" class="text-xs text-slate-600 dark:text-slate-300">جاكيت ديفاين — أسود</p></div></div>

  <!-- notices -->
  <div id="warn" class="admin-notice admin-notice--warn rounded-xl border p-4"><p id="warn-p">46 products are not in the database</p>
    <button id="warn-push" class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white"><span id="warn-push-label">Push</span></button></div>
  <div dir="rtl"><div id="warn-rtl" class="admin-notice admin-notice--warn rounded-xl border p-4"><p>٤٦ منتجًا ليست في قاعدة البيانات</p></div></div>
  <div id="info" class="admin-notice admin-notice--info rounded-xl border p-4"><p>Products sync from the site</p></div>

  <!-- meta text, previews, sizes -->
  <p id="meta" class="text-xs text-slate-400">Direct</p>
  <p id="meta5" class="text-xs text-slate-500">Updated 2 min ago</p>
  <div class="bg-slate-100 p-3"><p id="meta-tint" class="text-xs text-slate-500">On a tint</p></div>
  <div class="theme-editor__preview-topbar"><small id="preview-small">Delivery across Kuwait</small><span id="preview-meta" class="text-slate-400">Free</span></div>
  <p id="b-parent" class="text-sm">Shown on <b id="b-word">3 pages</b> right now.</p>
  <span id="topbar-status" class="topbar-editor__status topbar-editor__status--live">Visible now</span>

  <!-- orange, matched as whole tokens only -->
  <span id="dot" class="bg-orange-500 text-white">NEW</span>
  <a id="tag" href="#x" class="text-indigo-700 dark:text-orange-300">accent link</a>
  <span id="orange-text" class="text-orange-600">orange text</span>
  <div id="orange-bg" class="bg-orange-50 border border-orange-300 p-2">tint</div>

  <!-- fields -->
  <label class="block"><span id="label" class="mb-1.5 block text-xs font-bold text-slate-600">Name (English)</span>
    <input id="field" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400" placeholder="Product name"></label>
  <label class="block"><span class="mb-1.5 block text-xs font-bold text-slate-600">Slug</span>
    <input id="field-ro" readonly value="cagliari-backpack" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-indigo-400"></label>
  <input id="field-dis" disabled value="SP-1000" class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400">
  <input id="field-mono" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none" placeholder="product-name">
  <input id="field-num" type="number" class="w-20 rounded-lg border border-[#7d8799] px-2 py-1.5 text-sm tabular-nums" value="3">
  <select id="field-select" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option>Men</option></select>
  <textarea id="field-area" class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"></textarea>
  <div class="mt-1 flex overflow-hidden rounded-xl border"><input id="field-embedded" class="min-w-0 flex-1 px-1 text-sm font-mono uppercase outline-none" value="#C76A42"></div>
  <label class="crm-filter"><span id="crm-label">Status</span><select id="crm-sel"><option>All</option></select></label>
  <label class="seo-editor__field seo-editor__image"><span id="seo-label">Image path</span><input id="seo-input" placeholder="/images/products/photo.webp"></label>
  <input id="check" type="checkbox">
</main></div>`

// 1. Real Tailwind, for exactly the classes above.
const classes = [...new Set([...BODY.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'admin-polish-fixture.css') })).css

// 2. The live build's own unlayered rules that matter here, as measured.
const LIVE = `
html { font-size: 16.92px; font-family: system-ui, sans-serif; }
.admin-shell { --admin-action: #9a452c; --brand-deep: #9a452c; color: #18212a; }
.admin-shell button, .admin-shell input, .admin-shell select, .admin-shell textarea { font-weight: inherit; font-size: inherit; }
.admin-shell .bg-indigo-600 { background-color: var(--admin-action) !important; color: #fff !important; }
.admin-shell .text-indigo-600 { color: var(--brand-deep) !important; }
.admin-shell .text-red-600 { color: #18212a; }
.admin-shell .admin-page :where(button, .btn) { border-radius: .7rem; }
.admin-shell .admin-page .admin-table > thead > tr > th { color: #5d6975; font-size: .69rem; font-weight: 800; }
.inventory-ledger-mini { color: #64748b; font-size: .67rem; font-weight: 600; }
.inventory-product-meta { font-size: .7rem; font-weight: 500; }
.inventory-size-chip { font-size: .68rem; font-weight: 800; }
.inventory-refresh { color: #9a452c; border: 1px solid #ff7b17; font-size: .8125rem; font-weight: 700; min-height: 2.5rem; border-radius: .75rem; }
.crm-refresh { border: 1px solid #aeb8c2; background: #fff; color: #334155; border-radius: .7rem; padding: .6rem 1rem; }
.crm-primary { background: #b8430f; color: #fff; border-radius: .75rem; padding: .6rem 1.125rem; }
.topbar-editor__save { background: #e0561c; color: #fff; border-radius: .75rem; padding: .6rem 1rem; }
.topbar-editor__status { color: #65717d; font-size: .64rem; font-weight: 800; }
.inventory-stock-badge--low { color: #92400e; background: #fffbeb; }
.admin-notice--warn { color: #765010; background: #fffbeb; border: 1px solid #ffd230; }
.admin-notice--info { background: #fff; border: 1px solid #bd7c5b; }
.admin-product-upload-button { display: inline-flex; cursor: pointer; border: 1px dashed #bd7c5b; }
.admin-sidebar { background: linear-gradient(#151b21, #10151a); color: #acb8c4; }
.m-header small { font-size: .61rem; font-weight: 700; }
.m-row__badge { font-size: .68rem; font-weight: 700; }
.theme-editor__preview-topbar { font-size: .64rem; }
.theme-editor__scheme { display: grid; text-align: start; padding: .8rem; border: 1px solid #aeb8c2; border-radius: 1rem; background: #fff; }
.theme-editor__scheme--active { background: #fdf5f1; }
.theme-editor__scheme small { font-size: .7rem; }
.seo-editor__field { display: block; font-size: .8rem; font-weight: 750; }
.seo-editor__field input { border: 1px solid #aeb8c2; border-radius: .7rem; padding: .7rem .85rem; }
.crm-filter { display: block; font-size: .72rem; font-weight: 700; color: #64748b; }
.crm-filter select { border: 1px solid #aeb8c2; border-radius: .7rem; padding: .4rem .7rem; }
#b-word { color: #be123c; }
/* The scan measured every phone button at 44px or more, Edit/Remove with no
   min-h class included; the rule itself was not visible to it. Stand-in: */
@media (max-width: 767px) { .admin-shell button { min-height: 44px; } }
`
const html = (addon) => `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${TW}</style><style>${LIVE}</style>${addon ? `<style>${ADDON}</style>` : ''}</head><body>${BODY}</body></html>`

let pass = 0, fail = 0
const is = (ok, msg) => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg) } }

const ACCENT = 'rgb(154, 69, 44)', WHITE = 'rgb(255, 255, 255)', CHARCOAL = 'rgb(24, 33, 42)', META = 'rgb(85, 98, 116)'
const EDGE = 'rgb(125, 135, 153)', EDGE_HOVER = 'rgb(100, 116, 139)', CHIP = 'rgb(241, 245, 249)', CLEAR = 'rgba(0, 0, 0, 0)'
const SLATE700 = 'rgb(51, 65, 85)', SLATE600 = 'rgb(71, 85, 105)', SLATE800 = 'rgb(30, 41, 59)', ROSE = 'rgb(190, 18, 60)'

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
for (const [vn, w, rem] of [['desktop', 1366, 16.92], ['phone', 390, 16]]) {
  const phone = vn === 'phone'
  const open = async (addon) => {
    const pg = await browser.newPage({ viewport: { width: w, height: 900 } })
    await pg.setContent(html(addon))
    if (phone) await pg.addStyleTag({ content: 'html { font-size: 16px }' })
    return pg
  }
  const read = (pg) => (id, ...props) => pg.evaluate(([id, props]) => { const e = document.getElementById(id), c = getComputedStyle(e), r = e.getBoundingClientRect(); return Object.fromEntries([...props.map((p) => [p, c.getPropertyValue(p)]), ['h', r.height], ['w', r.width]]) }, [id, props])
  // The page without the add-on: what "untouched" means.
  const basePg = await open(false), base = read(basePg)
  const pg = await open(true), cs = read(pg)
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message))
  const hover = async (id, ...props) => { await pg.hover('#' + id, { force: true }); await pg.waitForTimeout(220); return cs(id, ...props) }
  const ph = (id) => pg.evaluate((id) => getComputedStyle(document.getElementById(id), '::placeholder').color, id)
  const near = (px, r) => Math.abs(parseFloat(px) - r * rem) < 0.6
  const MIX = (await cs('mix-ref', 'background-color'))['background-color']
  console.log(`\n== ${vn} (${w}px, 1rem = ${rem}px)`)

  // ---- keyboard focus first, before any pointer interaction
  // (waits: buttons transition colour and box-shadow over .15s)
  await pg.keyboard.press('Tab'); await pg.waitForTimeout(220)
  let s = await cs('nav', 'outline-color', 'outline-style', 'box-shadow')
  is((await pg.evaluate(() => document.activeElement.id)) === 'nav' && s['outline-style'] === 'solid' && s['outline-color'] === 'rgb(255, 123, 23)' && /rgb\(16, 21, 26\) 0px 0px 0px 4px/.test(s['box-shadow']),
    `sidebar focus: #ff7b17 outline over a 4px #10151a ring (passes on the dark sidebar and the white drawer) — got ${s['outline-color']} / ${s['box-shadow']}`)
  await pg.keyboard.press('Tab'); await pg.waitForTimeout(220)
  s = await cs('primary', 'outline-color', 'outline-style', 'outline-width')
  is((await pg.evaluate(() => document.activeElement.id)) === 'primary' && s['outline-style'] === 'solid' && s['outline-color'] === ACCENT && s['outline-width'] === '2px', `content focus: 2px accent outline — got ${s['outline-width']} ${s['outline-style']} ${s['outline-color']}`)
  await pg.focus('#upload-input')
  s = await cs('upload', 'outline-color', 'outline-style'); is(s['outline-style'] === 'solid' && s['outline-color'] === ACCENT, `photo-upload label shows a ring while its file input has focus — got ${s['outline-style']} ${s['outline-color']}`)
  await pg.evaluate(() => document.activeElement.blur())

  // ---- a. primary
  s = await cs('primary', 'font-weight', 'font-size', 'background-color', 'color')
  is(s['font-weight'] === '700', `primary button is bold (700), not the live 400 — got ${s['font-weight']}`)
  is(near(s['font-size'], 0.875), `primary button text-sm (.875rem) — got ${s['font-size']}`)
  is(s['background-color'] === ACCENT && s.color === WHITE, `primary is the --admin-action accent with white text — got ${s['background-color']} / ${s.color}`)
  is(s.h >= 44, `primary is at least 44px tall — got ${s.h}`)
  s = await hover('primary', 'background-color'); is(s['background-color'] === MIX, `primary hover: accent mixed 84% with black — got ${s['background-color']}`)
  s = await cs('primary-off', 'opacity', 'cursor'); is(parseFloat(s.opacity) <= 0.5 && s.cursor === 'not-allowed', `disabled primary is faded and says not-allowed — got ${s.opacity} / ${s.cursor}`)
  s = await cs('push', 'cursor'); is(s.cursor === 'wait', `"Push 46 products" (disabled:cursor-wait) says busy, not forbidden — got ${s.cursor}`)
  for (const id of ['emerald', 'amber', 'crm-add', 'topbar-save']) {
    s = await cs(id, 'background-color', 'color', 'font-weight')
    is(s['background-color'] === ACCENT && s.color === WHITE && s['font-weight'] === '700', `${id}: a primary — accent, white, 700 (no #4f46e5, no #b8430f/#e0561c) — got ${s['background-color']} ${s.color} ${s['font-weight']}`)
  }
  s = await hover('emerald', 'background-color'); is(s['background-color'] === MIX, `emerald primary hover is the accent mix, not #4338ca — got ${s['background-color']}`)
  s = await cs('emerald-badge', 'background-color'); is(s['background-color'] === ACCENT, `a non-button bg-emerald-600 is the accent too — got ${s['background-color']}`)
  // Live, the build's own `.admin-page :where(button) { border-radius: .7rem }`
  // already squares the filter pills; the add-on must not change them further.
  s = await cs('pill-on', 'border-radius', 'padding-left', 'font-weight')
  is(near(s['border-radius'], 0.7) && near(s['padding-left'], 0.75) && s['font-weight'] === '600', `the active filter pill keeps the live radius, padding and 600 — got ${s['border-radius']} ${s['padding-left']} ${s['font-weight']}`)
  s = await cs('pill-off', 'background-color', 'border-top-width'); const b0 = await base('pill-off', 'background-color', 'border-top-width')
  is(s['background-color'] === b0['background-color'] && s['border-top-width'] === b0['border-top-width'], 'the inactive pill is untouched by the secondary rule')

  // ---- b. secondary, b2. destructive
  s = await cs('refresh', 'background-color', 'border-top-color', 'color', 'font-weight')
  is(s['background-color'] === WHITE && s['border-top-color'] === EDGE && s.color === SLATE800 && s['font-weight'] === '600', `secondary: white, #7d8799 edge (3.62:1, as efea155c), 600 — got ${s['background-color']} ${s['border-top-color']} ${s.color} ${s['font-weight']}`)
  is(s.h >= 2.75 * rem - 0.5, `Refresh keeps min-h-11 (2.75rem) — got ${s.h}`)
  s = await hover('refresh', 'background-color', 'border-top-color'); is(s['background-color'] === CHIP && s['border-top-color'] === EDGE_HOVER, `secondary hover: #f1f5f9 + #64748b — got ${s['background-color']} ${s['border-top-color']}`)
  for (const id of ['inv-refresh', 'crm-refresh', 'hover-indigo', 'block-cod', 'upload']) {
    s = await cs(id, 'border-top-color', 'color', 'background-color')
    is(s['border-top-color'] === EDGE && s.color === SLATE800 && s['background-color'] === WHITE, `${id}: secondary (one edge, no orange/terracotta outline) — got ${s['border-top-color']} ${s.color} ${s['background-color']}`)
  }
  s = await cs('inv-refresh', 'font-weight'); is(s['font-weight'] === '600', `Inventory Refresh at 600 — got ${s['font-weight']}`)
  s = await cs('edit-product', 'border-top-color', 'color'); is(s['border-top-color'] === EDGE && s.color === SLATE800, `phone "Edit product" (dark:text-orange-300 in its class) is a plain secondary — got ${s['border-top-color']} ${s.color}`)
  is(s.h >= 2.75 * rem - 0.5, `"Edit product" keeps min-h-11 (2.75rem; 44px on a phone) — got ${s.h}`)
  s = await cs('block-all', 'color', 'border-top-color', 'background-color')
  is(s.color === ROSE && s['border-top-color'] === EDGE && s['background-color'] === WHITE, `bordered destructive "Block entirely" keeps rose text #be123c on the secondary box — got ${s.color} ${s['border-top-color']} ${s['background-color']}`)
  s = await hover('block-all', 'border-top-color', 'background-color'); is(s['border-top-color'] === ROSE && s['background-color'] === CHIP, `destructive hover rings it in rose — got ${s['border-top-color']} ${s['background-color']}`)

  // ---- c. quiet
  for (const id of ['cancel', 'cancel2']) {
    s = await cs(id, 'color', 'font-weight')
    is(s.color === SLATE700 && s['font-weight'] === '600', `${id}: quiet Cancel is slate-700 at 600 (lighter than the 700 primary) — got ${s.color} ${s['font-weight']}`)
    if (phone) is(s.h >= 44, `${id}: 44px on a phone — got ${s.h}`)
  }
  s = await hover('cancel', 'background-color'); is(s['background-color'] === CHIP, `Cancel hover #f1f5f9 — got ${s['background-color']}`)
  s = await hover('cancel-off', 'background-color'); is(s['background-color'] === CLEAR, `a disabled Cancel does not light up — got ${s['background-color']}`)

  // ---- picker cards
  s = await cs('slide-card', 'padding-top', 'font-weight', 'border-top-color'); const sc0 = await base('slide-card', 'padding-top', 'border-top-color')
  is(s['padding-top'] === sc0['padding-top'], `the slide-size picker card keeps its padding (not restyled as a button) — got ${s['padding-top']}`)
  is(s['font-weight'] === '400', 'the picker card description is not bolded')
  s = await cs('theme-card', 'padding-top', 'border-top-color'); const tc0 = await base('theme-card', 'padding-top', 'border-top-color')
  is(s['padding-top'] === tc0['padding-top'] && s['border-top-color'] === tc0['border-top-color'], 'the theme scheme card keeps its own padding and edge')

  // ---- d. row actions
  const e1 = await cs('edit', 'color', 'font-weight', 'padding-top', 'padding-left', 'padding-right', 'padding-bottom', 'margin-top', 'margin-left'), r1 = await cs('remove', 'color')
  is(e1.h >= (phone ? 44 : 32), `Edit is a ${phone ? 44 : 32}px target — got ${e1.h}`)
  is(e1.color === ACCENT && e1['font-weight'] === '700', `Edit is accent and bold — got ${e1.color} ${e1['font-weight']}`)
  is(r1.color === ROSE, `Remove says delete in rose — got ${r1.color}`)
  is(['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].every((p) => near(e1[p], 0.375)), `row-action padding is .375rem on every side — got ${e1['padding-top']} ${e1['padding-right']} ${e1['padding-bottom']} ${e1['padding-left']}`)
  is(near(e1['margin-left'], -0.375) && (phone ? e1['margin-top'] === '0px' : near(e1['margin-top'], -0.375)), `row-action margin -.375rem inline${phone ? ', 0 block on a phone' : ' and block'} — got ${e1['margin-left']} / ${e1['margin-top']}`)
  const stack = await pg.evaluate(() => { const a = document.getElementById('edit').getBoundingClientRect(), b = document.getElementById('remove').getBoundingClientRect(); return b.top - a.bottom })
  is(stack >= -0.5, `stacked Edit and Remove do not overlap — gap ${stack.toFixed(2)}px`)
  const hit = await pg.evaluate(() => {
    const a = document.getElementById('b-edit'), b = document.getElementById('b-remove')
    a.scrollIntoView({ block: 'center' })
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(), y = ra.top + ra.height / 2
    return { overlap: ra.right - rb.left, atEdit: document.elementFromPoint(ra.right - 1.5, y)?.id, atRemove: document.elementFromPoint(rb.left + 1.5, y)?.id }
  })
  is(hit.overlap <= 0.5, `side-by-side Edit and Remove (gap-3) touch without overlapping — overlap ${hit.overlap.toFixed(2)}px`)
  is(hit.atEdit === 'b-edit' && hit.atRemove === 'b-remove', `a tap 1.5px inside Edit's trailing edge hits Edit, not Remove — got ${hit.atEdit} / ${hit.atRemove}`)
  s = await hover('edit', 'background-color', 'text-decoration-line'); is(s['background-color'] === CHIP && s['text-decoration-line'].includes('underline'), `Edit hover: #f1f5f9 chip AND the underline — got ${s['background-color']} ${s['text-decoration-line']}`)
  s = await hover('remove-off', 'background-color'); is(s['background-color'] === CLEAR, `a disabled Remove does not light up — got ${s['background-color']}`)
  s = await cs('edit-hidden', 'display'); is(s.display === 'none', `a .hidden row action stays hidden — got ${s.display}`)
  s = await cs('track', 'padding-left'); is(s.h >= (phone ? 44 : 32) && near(s['padding-left'], 0.375), `order number is a ${phone ? 44 : 32}px target — got ${s.h} ${s['padding-left']}`)
  s = await hover('track', 'text-decoration-line', 'background-color'); is(s['text-decoration-line'].includes('underline') && s['background-color'] === CHIP, `order number hover keeps its underline (its only clickable cue) — got ${s['text-decoration-line']}`)

  // ---- e. Close
  s = await cs('close', 'color', 'display'); is(s.h >= (phone ? 44 : 36) && s.w >= (phone ? 44 : 36), `Close is a ${phone ? 44 : 36}px target — got ${s.w.toFixed(1)}x${s.h.toFixed(1)}`)
  is(s.color === META, `Close is the meta colour #556274 (6.2:1, was 2.6:1) — got ${s.color}`)
  is(s.display === (await base('close', 'display')).display, `Close keeps its display (no inline-grid) — got ${s.display}`)
  s = await hover('close', 'color', 'background-color'); is(s.color === CHARCOAL && s['background-color'] === CHIP, `Close hover darkens to #18212a on #f1f5f9 (beats the meta rule) — got ${s.color} ${s['background-color']}`)
  s = await cs('close-hidden', 'display'); is(s.display === 'none', `a .hidden Close stays hidden — got ${s.display}`)
  s = await cs('close-md', 'display'); is(phone ? s.display !== 'none' : s.display === 'none', `md:hidden Close: ${phone ? 'shown on a phone' : 'hidden on desktop'} — got ${s.display}`)

  // ---- tables and names
  s = await cs('th', 'font-size', 'font-weight'); is(parseFloat(s['font-size']) >= 12 && s['font-weight'] === '700', `table headers ≥12px at 700 — got ${s['font-size']} ${s['font-weight']}`)
  s = await cs('name-cell', 'font-weight', 'color'); is(s['font-weight'] === '600' && s.color === CHARCOAL, `Catalogue product name is 600 charcoal — got ${s['font-weight']} ${s.color}`)
  s = await cs('name-ar', 'font-weight', 'color'); is(s['font-weight'] === '400' && s.color === SLATE600, `Arabic name is 400 #475569 — got ${s['font-weight']} ${s.color}`)
  s = await cs('name-vis-ar', 'color'); is(s.color === SLATE600, `a visible product's Arabic line is #475569 — got ${s.color}`)
  s = await cs('name-hidden', 'font-weight', 'color'); is(s['font-weight'] === '400' && s.color === META, `a hidden product's name: 400 in the meta colour (was 600 at 4.76:1) — got ${s['font-weight']} ${s.color}`)
  s = await cs('name-hidden-ar', 'color'); is(s.color === META, `its Arabic line is no stronger than the name — got ${s.color}`)
  s = await cs('compare-name', 'font-weight'); is(s['font-weight'] === '600', 'the comparison-table name is 600 too')
  s = await cs('inv-name', 'font-weight'); is(s['font-weight'] === '600', 'Inventory name 600')
  s = await cs('inv-ar', 'font-weight', 'color'); is(s['font-weight'] === '400' && s.color === SLATE600, 'Inventory Arabic name 400 #475569')
  s = await cs('m-title', 'font-weight', 'color'); const ma = await cs('m-ar', 'color'); is(s['font-weight'] === '600' && s.color === CHARCOAL && ma.color === SLATE600, `phone row: title 600 charcoal, Arabic #475569 — got ${s['font-weight']} ${s.color} / ${ma.color}`)
  s = await cs('m-title-hidden', 'color'); const mh = await cs('m-ar-hidden', 'color'); is(s.color === META && mh.color === META, `hidden phone row: title and Arabic line both #556274 — got ${s.color} / ${mh.color}`)

  // ---- colour
  for (const id of ['meta', 'meta5', 'meta-tint', 'theme-small', 'inv-meta']) {
    s = await cs(id, 'color'); is(s.color === META, `${id}: meta text is the one #556274 (≥5:1 on every tint) — got ${s.color}`)
  }
  s = await cs('topbar-status', 'color'); is(s.color === SLATE600, `top-bar "Visible now" #475569 — got ${s.color}`)
  s = await cs('preview-meta', 'color'); is(s.color === (await base('preview-meta', 'color')).color, 'the Theme preview keeps the storefront colours')
  s = await cs('badge-low', 'color', 'background-color', 'border-top-color', 'border-top-width')
  is(s.color === ACCENT && s['background-color'] === WHITE && s['border-top-color'] === ACCENT && s['border-top-width'] === '1px', `low-stock badge: accent on white with a 1px accent hairline — got ${s.color} ${s['background-color']} ${s['border-top-width']} ${s['border-top-color']}`)
  s = await cs('warn', 'background-color', 'border-top-color', 'border-left-width', 'border-left-color', 'border-right-width')
  is(s['background-color'] === 'rgb(248, 250, 252)' && s['border-top-color'] === EDGE && s['border-left-width'] === '4px' && s['border-left-color'] === SLATE700 && s['border-right-width'] === '1px',
    `warning notice: #f8fafc, #7d8799 edge, 4px #334155 inline-start bar — got ${s['background-color']} ${s['border-top-color']} ${s['border-left-width']} ${s['border-left-color']}`)
  s = await cs('warn-rtl', 'border-right-width', 'border-left-width'); is(s['border-right-width'] === '4px' && s['border-left-width'] === '1px', `in Arabic the bar flips to the right — got right ${s['border-right-width']} left ${s['border-left-width']}`)
  s = await cs('warn-p', 'color'); is(s.color === SLATE700, 'warning notice text is #334155, not amber')
  s = await cs('warn-push-label', 'color'); is(s.color === WHITE, `a button inside the warning keeps its white label — got ${s.color}`)
  s = await cs('info', 'border-top-color'); is(s['border-top-color'] === 'rgb(203, 213, 225)', `info notice edge #cbd5e1, not terracotta — got ${s['border-top-color']}`)
  s = await cs('dot', 'background-color'); is(s['background-color'] === (await base('dot', 'background-color'))['background-color'], `bg-orange-500 is untouched (a bare [class*="bg-orange-5"] made it #f8fafc) — got ${s['background-color']}`)
  s = await cs('tag', 'color'); is(s.color === (await base('tag', 'color')).color, `a link carrying dark:text-orange-300 keeps its light-mode colour — got ${s.color}`)
  s = await cs('orange-text', 'color'); is(s.color === SLATE700, `text-orange-600 still goes neutral — got ${s.color}`)
  s = await cs('orange-bg', 'background-color', 'border-top-color'); is(s['background-color'] === 'rgb(248, 250, 252)' && s['border-top-color'] === 'rgb(226, 232, 240)', `bg-orange-50 / border-orange-300 still go neutral — got ${s['background-color']} ${s['border-top-color']}`)

  // ---- sizes
  for (const id of ['ledger', 'inv-meta', 'size-chip', 'm-badge', 'mh-small', 'badge-text', 'topbar-status']) {
    s = await cs(id, 'font-size'); is(parseFloat(s['font-size']) >= 12, `${id} ≥12px — got ${s['font-size']}`)
  }
  s = await cs('b-word', 'font-size'); const bp = await cs('b-parent', 'font-size'); is(s['font-size'] === bp['font-size'], `a <b> in a text-sm sentence keeps the sentence's size (a floor, not a setting) — got ${s['font-size']} in ${bp['font-size']}`)
  s = await cs('preview-small', 'font-size'); is(parseFloat(s['font-size']) < 12 && s['font-size'] === (await base('preview-small', 'font-size'))['font-size'], `the Theme preview keeps the storefront's own small size — got ${s['font-size']}`)

  // ---- labels and fields
  s = await cs('label', 'font-size', 'font-weight', 'color'); is(near(s['font-size'], 0.8125) && s['font-weight'] === '600' && s.color === SLATE700, `field labels 13px-ish / 600 / #334155 — got ${s['font-size']} ${s['font-weight']} ${s.color}`)
  s = await cs('crm-label', 'font-size', 'font-weight', 'color'); is(near(s['font-size'], 0.8125) && s['font-weight'] === '600' && s.color === SLATE700, `a class-less label span matches the other labels — got ${s['font-size']} ${s['font-weight']} ${s.color}`)
  s = await cs('seo-label', 'font-size'); is(s['font-size'] === (await base('seo-label', 'font-size'))['font-size'], `the SEO editor's label keeps its own size — got ${s['font-size']}`)
  for (const id of ['field', 'field-mono', 'field-num', 'field-select', 'field-area', 'field-embedded', 'crm-sel', 'seo-input', 'ord-select']) {
    s = await cs(id, 'font-size', 'font-weight', 'color')
    is(s['font-size'] === '16px', `${id}: 16px (no iOS zoom, one size) — got ${s['font-size']}`)
    is(s.color === CHARCOAL, `${id}: charcoal text — got ${s.color}`)
    const sel = /select|sel$/.test(id)
    is(s['font-weight'] === (sel ? '500' : '400'), `${id}: weight ${sel ? '500' : '400'} — got ${s['font-weight']}`)
  }
  for (const id of ['field', 'field-num', 'field-select', 'field-area', 'crm-sel', 'seo-input', 'ord-select']) {
    s = await cs(id, 'border-top-color'); is(s['border-top-color'] === EDGE, `${id}: the one #7d8799 field edge — got ${s['border-top-color']}`)
  }
  s = await cs('ord-select', 'min-height'); is(s.h >= 2.75 * rem - 0.5, `the Orders filter select keeps min-h-11 (no longer shorter than the pills) — got ${s.h}`)
  is((await ph('field')) === 'rgb(100, 116, 139)', 'placeholder is #64748b (4.76:1, was 3.0:1)')
  s = await cs('field-embedded', 'border-top-width'); is(s['border-top-width'] === '0px', 'an input embedded in a bordered wrapper gets no border of its own')
  s = await cs('field-ro', 'background-color', 'color'); is(s['background-color'] === CHIP && s.color === SLATE600, `read-only field: #f1f5f9 with #475569 text — got ${s['background-color']} ${s.color}`)
  s = await cs('field-dis', 'background-color', 'color', 'cursor'); is(s['background-color'] === CHIP && s.color === SLATE600 && s.cursor === 'not-allowed', `disabled field: #f1f5f9, #475569, not-allowed — got ${s['background-color']} ${s.color} ${s.cursor}`)
  s = await hover('field', 'border-top-color'); is(s['border-top-color'] === EDGE_HOVER, `field hover #64748b — got ${s['border-top-color']}`)
  s = await hover('field-ro', 'border-top-color'); is(s['border-top-color'] === EDGE, `a read-only field does not darken on hover — got ${s['border-top-color']}`)
  await pg.mouse.move(w - 2, 2)
  for (const id of ['field', 'crm-sel']) {
    await pg.focus('#' + id)
    s = await cs(id, 'border-top-color', 'box-shadow')
    is(s['border-top-color'] === ACCENT && /0px 0px 0px 1px/.test(s['box-shadow']) && /0px 0px 0px 4px/.test(s['box-shadow']), `${id} focused: accent edge + 1px accent ring + 4px halo — got ${s['border-top-color']} / ${s['box-shadow'].slice(0, 70)}`)
  }
  s = await cs('check', 'font-size'); is(s['font-size'] === (await base('check', 'font-size'))['font-size'], 'checkboxes are left out of the field rule')
  is(!errs.length, 'no page errors')
  await pg.close(); await basePg.close()
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
