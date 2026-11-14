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
// A second fixture (BOXES + TABLES, below) holds every box and table of the
// scan's BOX and TABLE sections and checks the add-on's boxes-and-tables
// section against the polish alone.
//
// Not covered, on purpose: CRM's header toggle, which reads "Cancel" while the
// add-contact form is open but keeps class crm-primary. Nothing in its markup
// as measured lets CSS tell it from "Create contact"; it needs a JS hook. And
// sticky table headers: each table frame is overflow-x:auto, so a sticky
// header sticks to the frame, and making the frame stop scrolling only where
// the table fits would hang on data (Inventory's widths move with its SKUs and
// figures) and on scroll ancestors the scan does not show — a table one wide
// row too wide would lose its Actions column with no way to scroll to it.
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

  // The SIZES section of the add-on (owner request 2026-11-03, "reduce over sizes all"; proven by sizes-admin-test.mjs) brings the
  // 44px floors (primary buttons, the controls that carry min-h-11) down to 40px (2.4rem when the root font is bigger) on a MOUSE
  // screen (min-width 768px and pointer: fine; this desktop run); a phone keeps 2.75rem / 44px.
  const MINH = phone ? 2.75 * rem : Math.max(40, 2.4 * rem)
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
  is(s.h >= (phone ? 44 : MINH) - 0.5, `primary is at least ${phone ? '44px' : '40px (2.4rem; the SIZES section, mouse screens)'} tall — got ${s.h}`)
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
  is(s.h >= MINH - 0.5, `Refresh keeps its min-h-11 floor (${phone ? '2.75rem' : '2.4rem / 40px on a mouse screen, SIZES 8'}) — got ${s.h}`)
  s = await hover('refresh', 'background-color', 'border-top-color'); is(s['background-color'] === CHIP && s['border-top-color'] === EDGE_HOVER, `secondary hover: #f1f5f9 + #64748b — got ${s['background-color']} ${s['border-top-color']}`)
  for (const id of ['inv-refresh', 'crm-refresh', 'hover-indigo', 'block-cod', 'upload']) {
    s = await cs(id, 'border-top-color', 'color', 'background-color')
    is(s['border-top-color'] === EDGE && s.color === SLATE800 && s['background-color'] === WHITE, `${id}: secondary (one edge, no orange/terracotta outline) — got ${s['border-top-color']} ${s.color} ${s['background-color']}`)
  }
  s = await cs('inv-refresh', 'font-weight'); is(s['font-weight'] === '600', `Inventory Refresh at 600 — got ${s['font-weight']}`)
  s = await cs('edit-product', 'border-top-color', 'color'); is(s['border-top-color'] === EDGE && s.color === SLATE800, `phone "Edit product" (dark:text-orange-300 in its class) is a plain secondary — got ${s['border-top-color']} ${s.color}`)
  is(s.h >= MINH - 0.5, `"Edit product" keeps its min-h-11 floor (44px on a phone; 40px on a mouse screen, SIZES 8) — got ${s.h}`)
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
  // Neutral: the low-stock badge is ink on white with a 1px ink hairline (the admin shows fewer colours).
  is(s.color === 'rgb(51, 65, 85)' && s['background-color'] === WHITE && s['border-top-color'] === 'rgb(51, 65, 85)' && s['border-top-width'] === '1px', `low-stock badge: neutral ink on white with a 1px ink hairline — got ${s.color} ${s['background-color']} ${s['border-top-width']} ${s['border-top-color']}`)
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
  s = await cs('ord-select', 'min-height'); is(s.h >= MINH - 0.5, `the Orders filter select keeps its min-h-11 floor (no shorter than the pills, which carry it too) — got ${s.h}`)
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
// ============================================================== BOXES + TABLES
// A second fixture: every box and table measured by the BOX and TABLE
// sections of the scan, with its exact class strings and (where the scan
// printed it) its wrapper chain, on a page laid out like the live one — a
// 15rem sidebar and a 1018px content column at 1366px, IBM Plex Sans Arabic
// from public/fonts, so widths (Inventory!) come out close to live.
// Three renders per viewport: no add-on, the add-on WITHOUT its boxes-and-
// tables section (the polish alone: "untouched" means equal to this), and the
// whole add-on. Markup the facts do not show (what sits between two stacked
// boxes, which rows are clickable, the cell text) is marked "assumed".
// The section boundary is a COMMENT, so it is found in the commented source (addons-src); the behaviour file is the served one.
const SRC = readFileSync(join(ROOT, 'addons-src/sporta-admin-knet.css'), 'utf8')
const CUT = SRC.lastIndexOf('/*', SRC.indexOf('/backends boxes and tables'))
const POLISH = SRC.slice(0, CUT)
const FONTS = readFileSync(join(ROOT, 'src/styles/fonts.css'), 'utf8')
  .match(/@font-face\s*{[^}]*IBM Plex Sans Arabic[^}]*}/g)
  .map((f) => f.replace(/url\('\/fonts\/([^']+)'\)/, (_, n) => `url(data:font/woff2;base64,${readFileSync(join(ROOT, 'public/fonts', n)).toString('base64')})`)).join('\n')

const ROWS = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('')
const BOXES = `
<div class="admin-shell flex">
<aside class="admin-sidebar hidden w-60 shrink-0 md:block"><div id="sb-card" class="rounded-xl border p-4">Sporta Operations</div></aside>
<main class="admin-content min-w-0 flex-1">

<!-- Overview -->
<section class="admin-page"><div class="admin-page-layout space-y-6">
  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <div id="kpi" data-box="tile" class="admin-kpi rounded-xl border p-4 border-slate-200 bg-white"><p class="text-xs font-semibold text-slate-500">Paid revenue</p><p class="admin-kpi__value mt-1 text-xl font-extrabold tabular-nums">61.000 <span class="admin-kpi__currency">KWD</span></p></div>
    <div id="kpi-accent" data-box="tile" class="admin-kpi rounded-xl border p-4 border-indigo-200 bg-indigo-50"><p class="text-xs font-semibold text-slate-500">Awaiting cash</p><p class="mt-1 text-xl font-extrabold tabular-nums">13.000</p></div>
    <div id="kpi-amber" data-box="tile" class="admin-kpi rounded-xl border p-4 border-amber-200 bg-amber-50"><p class="text-xs font-semibold text-slate-500">Needs review</p><p class="mt-1 text-xl font-extrabold tabular-nums">1</p></div>
  </div>
  <div class="flex flex-wrap gap-2">
    <div id="ov-chip" data-box="chip" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">Paid today <b>1</b></div>
    <div class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">Last 7 days <b>4</b></div>
  </div>
  <section id="ov-card" data-box="card" class="rounded-xl border border-slate-200 bg-white p-4"><h2 class="text-sm font-bold">Revenue, last 14 days</h2><p class="text-xs text-slate-500">38.000 KWD</p><span id="badge-full" class="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs">+12%</span></section>
</div></section>

<!-- Orders: div.admin-table-surface < div.admin-page-layout.space-y-5 < section.admin-page -->
<section class="admin-page"><div class="admin-page-layout space-y-5">
  <div id="orders-frame" data-box="frame" class="admin-table-surface">
    <table id="t-orders" class="admin-table w-full border-collapse text-sm"><thead><tr>
      <th class="py-2 text-start font-semibold">Track ID</th><th class="py-2 text-start font-semibold">Placed</th><th class="py-2 text-start font-semibold">Customer</th><th class="py-2 text-end font-semibold">Amount</th>
      <th class="py-2 text-start font-semibold">Payment</th><th class="py-2 text-start font-semibold">Method</th><th class="py-2 text-start font-semibold">Fulfilment</th><th class="py-2 text-start font-semibold">Area</th></tr></thead>
      <tbody>${ROWS(4, (i) => `<tr class="border-b border-slate-100"><td class="py-2"><button class="rounded text-start font-mono font-semibold text-slate-800 underline-offset-2 hover:underline">SPTEST${1000 + i}</button></td><td class="py-2">2026-10-${30 - i} 1${i}:2${i}</td><td class="py-2">Test Customer ${'ABCD'[i]}</td><td class="py-2 text-end tabular-nums">${5 + i}.000 KWD</td><td class="py-2"><span class="inline-block rounded-full px-2 py-0.5 text-xs">paid</span></td><td class="py-2">knet</td><td class="py-2">packed</td><td class="py-2">Salmiya</td></tr>`)}</tbody></table>
  </div>
</div></section>

<!-- Returns / Support / Profiles: th unclassed -->
<section class="admin-page"><div class="admin-returns admin-page-layout">
  <div id="returns-frame" data-box="frame" class="admin-returns__table-wrap"><table id="t-returns" class="admin-table admin-returns__table"><thead><tr><th>Request</th><th>Order</th><th>Customer</th><th>Status</th><th>Created</th></tr></thead>
    <tbody>${ROWS(3, (i) => `<tr><td><b>RR26000${i}</b><span class="block text-xs text-slate-500">eligible</span></td><td>SPTEST${1000 + i}</td><td>Test Customer ${'ABC'[i]}<span class="block text-xs text-slate-500">96500001000</span></td><td>requested</td><td>2026-10-${30 - i}</td></tr>`)}</tbody></table></div>
</div></section>
<section class="admin-page"><div class="support-admin">
  <!-- assumed: ticket rows are clickable (cursor-pointer) -->
  <div id="support-frame" data-box="frame" class="support-admin__table"><table id="t-support" class="admin-table"><thead><tr><th>Ticket</th><th>Subject</th><th>Customer</th><th>Status</th><th>Priority</th></tr></thead>
    <tbody>${ROWS(3, (i) => `<tr id="sup-row-${i}" class="cursor-pointer"><td>ST51000${i}</td><td>Where is my order?<span class="block text-xs text-slate-500">SPTEST100${i}</span></td><td>customer${i}@example.com</td><td>open</td><td>normal</td></tr>`)}</tbody></table></div>
</div></section>
<section class="admin-page"><div class="profiles-admin">
  <div id="profiles-frame" data-box="frame" class="profiles-admin__table"><table id="t-profiles" class="admin-table"><thead><tr><th>Customer</th><th>Phone</th><th>Orders</th><th>Payments received</th><th>Last order</th></tr></thead>
    <tbody>${ROWS(3, (i) => `<tr><td>Test Customer ${'ABC'[i]}<span class="block text-xs text-slate-500">customer${i}@example.com</span></td><td>9650000100${i}</td><td>${i * 7 + 1}</td><td>${(9.5 * i * 11).toFixed(3)} KWD</td><td>2026-10-${30 - i}</td></tr>`)}</tbody></table></div>
</div></section>

<!-- Catalogue -->
<section class="admin-page"><div class="admin-page-layout space-y-6">
  <!-- assumed: the two notices share a space-y-5 column (measured 21px apart) -->
  <div class="space-y-5">
    <div id="cat-warn" data-box="notice" class="admin-notice admin-notice--warn rounded-xl border p-4"><p>46 products are not in the database</p><button class="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Push 46 products</button></div>
    <div id="cat-info" data-box="notice" class="admin-notice admin-notice--info rounded-xl border p-4"><p>Products sync from the site</p></div>
  </div>
  <!-- div.admin-table-surface < section < div.admin-page-layout.space-y-6 -->
  <section><h2 class="text-lg font-bold">Site vs database</h2>
    <div id="sitedb-frame" data-box="frame" class="admin-table-surface mt-3"><table id="t-sitedb" class="admin-table w-full border-collapse text-sm"><thead><tr>
      <th class="py-2 text-start font-semibold">Product</th><th class="py-2 text-start font-semibold">Slug</th><th class="py-2 text-end font-semibold">Site price</th><th class="py-2 text-end font-semibold">Database</th><th class="py-2 text-start font-semibold">State</th></tr></thead>
      <tbody>${ROWS(3, (i) => `<tr class="border-t border-slate-100"><td class="py-2.5">Vanquish Tank — Navy ${i}</td><td class="py-2.5 font-mono">vanquish-tank-navy-${i}</td><td class="py-2.5 text-end tabular-nums">9.000</td><td class="py-2.5 text-end tabular-nums">9.000</td><td class="py-2.5">in sync</td></tr>`)}</tbody></table></div>
  </section>
  <!-- div.hidden.overflow-x-auto.rounded-2xl.border.border-slate-200 < section.admin-section-block.mt-8 < section.min-w-0 < div.admin-page-layout.space-y-6 -->
  <section class="min-w-0"><section class="admin-section-block mt-8"><header class="mb-4 flex items-center justify-between"><h2 class="text-lg font-bold">Products</h2></header>
    <div id="list-frame" data-box="frame" class="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white md:block"><table id="t-list" class="admin-table w-full text-sm"><thead><tr>
      <th class="p-3 text-start">Product</th><th class="p-3 text-start">Web name</th><th class="p-3 text-end">Price</th><th class="p-3 text-start">On sale</th><th class="p-3"></th></tr></thead>
      <tbody>${ROWS(4, (i) => `<tr${i % 2 ? ' class="border-b border-slate-50"' : ''}><td class="p-3"><span class="font-semibold text-slate-800">Vanquish Tank — Navy</span><span class="block text-xs text-slate-500">تانك فانكويش — كحلي</span></td><td class="p-3 font-mono text-xs">vanquish-tank-navy</td><td class="p-3 text-end tabular-nums">9.000</td><td class="p-3">—</td><td class="p-3 text-end"><div class="flex flex-col items-end gap-3"><button class="text-xs font-bold text-indigo-600 hover:underline">Edit</button><button class="text-xs font-bold text-red-600 hover:underline">Remove</button></div></td></tr>`)}</tbody></table></div>
  </section></section>
</div></section>

<!-- Brands -->
<section class="admin-page"><ul class="grid gap-3">
  <li id="brand-card" data-box="card" class="admin-brand-card flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"><b>Kappa</b><span class="text-xs text-slate-500">12 products</span></li>
  <li class="admin-brand-card flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"><b>Joma</b></li>
</ul></section>

<!-- CRM: assumed the create form and the error notice share a space-y-5 column (measured 21px) -->
<section class="admin-page"><div class="crm-admin space-y-5">
  <form id="crm-form" class="crm-create"><label class="crm-filter"><span>Name</span><input class="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"></label></form>
  <div id="crm-error" data-box="notice" class="admin-notice admin-notice--error rounded-xl border p-4"><p class="font-bold">Could not load contacts</p><div class="mt-1 text-sm leading-relaxed">Try again.</div></div>
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">${ROWS(4, (i) => `<div ${i ? '' : 'id="crm-tile" data-box="tile" '}class="crm-tile"><p class="crm-kicker">Contacts</p><p class="text-xl font-bold">${6 + i}</p></div>`)}</div>
</div></section>

<!-- Slides -->
<section class="admin-page"><div class="admin-page-layout space-y-6">
  <div id="slides-empty" data-box="empty" class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm">No slides yet — the home page shows the default hero.</div>
  <form id="slides-form" data-box="panel" class="w-full max-w-2xl space-y-5 rounded-2xl bg-white p-6 shadow-sm"><label class="block"><span class="text-xs font-semibold text-slate-600">Headline</span><input class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"></label></form>
</div></section>

<!-- Top bar: editor + preview side by side (214 / 696 live) -->
<section class="admin-page"><div class="grid items-start gap-5 lg:grid-cols-2">
  <section id="tb-editor" data-box="panel" class="rounded-2xl border border-slate-200 bg-white p-5"><label class="block"><span class="text-xs font-bold text-slate-600">Text (English)</span><input class="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"></label>
    <div id="tb-actions" class="admin-form-actions topbar-editor__actions mt-4"><button class="topbar-editor__save">Save top bar</button></div></section>
  <section id="tb-preview" data-box="panel" class="rounded-2xl border border-slate-200 bg-white p-5"><div class="topbar-editor__preview" style="height: 30rem">
    <div id="tb-pv-card" class="rounded-2xl border border-slate-200 bg-white p-5">a storefront card</div>
    <div id="tb-pv-strip" class="topbar-editor__preview-strip flex min-w-0 items-center gap-1.5 rounded-xl border p-3">Delivery across Kuwait</div></div></section>
</div></section>

<!-- Payments: KNET + T-Pay editors -->
<section class="admin-page"><div class="grid items-start gap-5 xl:grid-cols-2">
  <form id="pay-knet" data-box="panel" class="payment-gateway-editor rounded-2xl border border-slate-200 bg-white p-5 md:p-6"><h2 class="text-base font-bold">KNET</h2>
    <div id="knet-toggle" data-box="card" class="payment-knet-toggle-row mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 border-slate-200 bg-slate-50"><p class="text-sm font-bold">KNET at checkout</p><input type="checkbox"></div>
    <div class="mt-5 grid gap-4 md:grid-cols-2">
      <label class="block"><span class="payment-secret-field__label flex items-center justify-between gap-3 text-xs font-bold text-slate-600">Test Tranportal ID<span id="st-ok" class="payment-secret-field__state text-emerald-600">Saved</span></span><input type="password" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm outline-none" placeholder="Enter value from the bank"></label>
      <label class="block"><span class="payment-secret-field__label flex items-center justify-between gap-3 text-xs font-bold text-slate-600">Production Tranportal password<span id="st-req" class="payment-secret-field__state text-amber-600">Required</span></span><input type="password" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm outline-none"></label>
      <label class="block"><span class="payment-secret-field__label flex items-center justify-between gap-3 text-xs font-bold text-slate-600">Test resource key<span id="st-err" class="payment-secret-field__state text-rose-600">Must be 16 bytes</span></span><input type="password" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm outline-none"></label>
      <label class="block"><span class="payment-secret-field__label flex items-center justify-between gap-3 text-xs font-bold text-slate-600">Production resource key<span id="st-req2" class="payment-secret-field__state text-amber-600">Required</span></span><input type="password" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm outline-none"></label>
    </div></form>
  <form id="pay-tpay" data-box="panel" class="payment-gateway-editor rounded-2xl border border-slate-200 bg-white p-5 md:p-6"><h2 class="text-base font-bold">T-Pay</h2>
    <div class="mt-5 grid gap-4 md:grid-cols-2">
      <label class="block"><span class="payment-secret-field__label flex items-center justify-between gap-3 text-xs font-bold text-slate-600">Production ENCRP_KEY<span id="st-req3" class="payment-secret-field__state text-amber-600">Required</span></span><input type="password" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm outline-none"></label>
      <label class="block"><span class="payment-secret-field__label flex items-center justify-between gap-3 text-xs font-bold text-slate-600">Production ClientSecret<span id="st-req4" class="payment-secret-field__state text-amber-600">Required</span></span><input type="password" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm outline-none"></label>
    </div></form>
</div></section>

<!-- Checkout: the accent callout -->
<section class="admin-page"><div id="co-accent" data-box="notice" class="rounded-xl border p-3 text-sm font-semibold border-indigo-200 bg-indigo-50 text-indigo-900">KNET is the default payment method</div></section>

<!-- Inventory: div.inventory-table-wrap < div.inventory-page.admin-page-layout.space-y-6 < section.admin-page -->
<section class="admin-page"><div class="inventory-page admin-page-layout space-y-6">
  <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
    <div id="tile1" data-box="tile" class="inventory-tile rounded-xl border p-4 border-orange-200 bg-orange-50"><p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock at cost</p><p id="tile1-fig" class="mt-1 text-xl font-extrabold tabular-nums text-orange-700">KWD&nbsp;1,654.350</p><p class="mt-0.5 text-xs text-slate-500">120 SKUs</p></div>
    <div id="tile2" data-box="tile" class="inventory-tile rounded-xl border p-4 border-orange-200 bg-orange-50"><p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock at price</p><p id="tile2-fig" class="mt-1 text-xl font-extrabold tabular-nums text-orange-700">KWD&nbsp;4,203.700</p><p class="mt-0.5 text-xs text-slate-500">retail</p></div>
    <div id="tile3" data-box="tile" class="inventory-tile rounded-xl border p-4 border-slate-200 bg-white"><p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Projected margin</p><p id="tile3-fig" class="mt-1 text-xl font-extrabold tabular-nums text-slate-800">KWD&nbsp;2,549.350</p><p class="mt-0.5 text-xs text-slate-500">60.6%</p></div>
    <div id="tile4" data-box="tile" class="inventory-tile rounded-xl border p-4 border-amber-200 bg-amber-50"><p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Needs attention</p><p class="mt-1 text-xl font-extrabold tabular-nums text-amber-700">49</p><p class="mt-0.5 text-xs text-slate-500">4 out · 45 low</p></div>
  </div>
  <!-- assumed: the six expense fields are a borderless input in an unclassed div (live: 6 unclassed divs at 11.8px, #cbd5e1, no padding; 6 inputs with no border, label.inventory-money) -->
  <div class="grid gap-3 sm:grid-cols-3">${ROWS(3, (i) => `<label class="inventory-money">${['Delivery', 'Ads', 'Fixed'][i]} expense<div${i ? '' : ' id="money"'}><input${i ? '' : ' id="money-input"'} type="number" class="" value="0"></div></label>`)}</div>
  <div id="inv-frame" data-box="frame" class="inventory-table-wrap"><table id="t-inv" class="admin-table inventory-table w-full text-sm"><thead><tr>
    <th class="text-start">Product</th><th class="text-start">Size / SKU</th><th class="text-end">Stock</th><th class="text-end">Movements</th><th class="text-end">Cost / Price</th><th class="text-end">Projected margin</th><th class="text-end">Actions</th></tr></thead>
    <tbody>${ROWS(6, (i) => `<tr><td class="inventory-product-cell"><strong>${['Cagliari Calcio Backpack — Navy', 'Vanquish Tank — Navy', 'Define Jacket — Onyx Black', 'Cagliari Calcio Sweatshirt — Navy', 'Kappa Track Top', 'Joma Shorts — White'][i]}</strong><span class="inventory-product-arabic">${['حقيبة ظهر كالياري كالتشو — كحلي', 'تانك فانكويش — كحلي', 'جاكيت ديفاين — أسود', 'سويت شيرت كالياري كالتشو — كحلي', 'جاكيت كابا', 'شورت جوما — أبيض'][i]}</span><span class="inventory-product-meta">${['accessories', 'tops', 'outerwear', 'tops', 'outerwear', 'shorts'][i]}</span></td>
      <td><span class="inventory-size-chip">${['ONE', 'M', 'L', '2XL', 'XL', 'S'][i]}</span><span class="inventory-sku">${['CAGLIARI-CALCIO-BACKPACK-NAVY', 'A-VAN-NA-M', 'A-DEF-BK-L', 'CAGLIARI-CALCIO-SWEATSHIRT-N-2XL', 'K-TRK-XL', 'J-SHO-WH-S'][i]}</span></td>
      <td class="text-end"><span class="inventory-stock-badge inventory-stock-badge--${i % 3 ? 'ok' : 'low'}">${i % 3 ? 'In stock' : 'Low stock'}</span><span class="inventory-stock-control tabular-nums">${i % 3 ? 12 : 2} on hand</span></td>
      <td class="text-end"><span class="inventory-ledger-mini">Sold ${i * 3} · Returned 0</span><span class="inventory-ledger-mini">In 10 · Damaged 0</span></td>
      <td class="text-end tabular-nums">KWD 3.350<span class="inventory-ledger-mini">Price 9.000</span></td>
      <td class="text-end tabular-nums">KWD 5.650<span class="inventory-ledger-mini">62.8%</span></td>
      <td class="text-end"><button class="button inventory-adjust-button">Adjust</button></td></tr>`)}</tbody></table></div>
</div></section>

<!-- Theme: two panels side by side (440 / 382 live); assumed the sections share a space-y-5 column (21px live) -->
<section class="admin-page"><div class="theme-editor grid items-start gap-5 lg:grid-cols-2">
  <section id="th-panel" data-box="panel" class="theme-editor__panel"><div class="space-y-5">
    <section id="th-sec1" data-box="card" class="admin-product-section"><h3 class="text-sm font-bold">Colours</h3>
      <div class="mt-3 grid gap-3 sm:grid-cols-3">${ROWS(3, (i) => `<div ${i ? '' : 'id="color-ctl" data-box="chip" '}class="theme-editor__color-control"><input type="color" value="#c76a42"><input ${i ? '' : 'id="color-hex" '}class="min-w-0 flex-1 px-1 text-sm font-mono uppercase outline-none" value="#C76A42"></div>`)}</div></section>
    <section id="th-sec2" data-box="card" class="admin-product-section mt-4"><h3 class="text-sm font-bold">Fonts</h3><p class="text-xs text-slate-500">Plex for body text</p></section>
  </div><div class="admin-form-actions mt-4"><button class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white">Save theme</button></div></section>
  <section id="th-preview" data-box="panel" class="theme-editor__panel"><div class="theme-editor__preview-topbar"><small>Delivery across Kuwait</small></div><div id="th-pv-card" class="rounded-xl border border-slate-200 bg-white p-4" style="height: 8rem">a storefront tile</div></section>
</div></section>

<!-- SEO: editor + preview side by side (274 / 319 live) -->
<section class="admin-page"><div class="seo-editor grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
  <section id="seo-panel" data-box="panel" class="seo-editor__panel">
    <fieldset id="seo-fs" data-box="card" class="space-y-3"><legend class="text-sm font-bold">English</legend><label class="seo-editor__field">Title<input></label></fieldset>
    <fieldset class="mt-4 space-y-3"><legend class="text-sm font-bold">العربية</legend><label class="seo-editor__field">العنوان<input></label></fieldset></section>
  <aside id="seo-preview" data-box="panel" class="seo-editor__panel seo-editor__preview"><div id="seo-result" class="seo-editor__search-result">www.sporta.com.kw › shop<p class="text-base">Shop sportswear — Sporta</p></div></aside>
</div></section>

<!-- Catalogue / form: the product editor in its overlay -->
<div id="overlay" class="fixed inset-0 z-40 flex items-end bg-slate-900/40 sm:items-center sm:justify-center" style="pointer-events: none">
  <form id="modal" data-box="modal" class="admin-editor-modal max-h-[92vh] w-full max-w-3xl overflow-y-auto">
    <div class="flex items-center justify-between"><h2 class="text-lg font-bold">Edit product</h2><button class="text-slate-400">✕</button></div>
    <section id="ps1" data-box="card" class="admin-product-section mt-4"><h3 class="text-sm font-bold">Basics</h3></section>
    <div id="gallery" class="admin-image-gallery mt-3"><p class="text-xs font-bold uppercase tracking-wide text-slate-500">Product gallery preview</p><p class="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs">Add an internal image path</p></div>
    <section id="ps2" data-box="card" class="admin-product-section mt-4"><h3 class="text-sm font-bold">Price</h3></section>
  </form>
</div>
</main></div>`

// The live build's own unlayered rules for these boxes, as stand-ins that
// reproduce the scan's numbers (radius, edge, shadow, padding at 1366px).
const LIVE_BOX = `${FONTS}
html { font-size: 16.92px; font-family: 'IBM Plex Sans Arabic', system-ui, sans-serif; }
.admin-shell { --admin-action: #9a452c; --brand-deep: #9a452c; color: #18212a; }
.admin-shell button, .admin-shell input, .admin-shell select, .admin-shell textarea { font-weight: inherit; font-size: inherit; }
.admin-shell .bg-indigo-600 { background-color: var(--admin-action) !important; color: #fff !important; }
.admin-shell .border-indigo-200 { border-color: #d8a38b; } .admin-shell .bg-indigo-50 { background-color: #f8ece6; }
.admin-sidebar { background: linear-gradient(#151b21, #10151a); color: #acb8c4; }
.admin-content { padding: 1.5rem 47px; } .admin-page + .admin-page { margin-top: 2rem; }
.admin-shell .admin-page .rounded-2xl.border { border-radius: .875rem; border-color: #d9dfe5; box-shadow: 0 1px 2px rgb(0 0 28 / .1), 0 8px 24px rgb(0 0 42 / .08); }
.admin-shell .admin-page :is(li.admin-brand-card, section.rounded-2xl.border.p-5, .payment-gateway-editor) { padding: 1.13rem; }
.admin-shell .admin-page .admin-kpi { padding: 1.13rem; box-shadow: 0 1px 2px rgb(0 17 34 / .06); }
.crm-tile { border: 1px solid #d9dfe5; border-radius: .9rem; padding: 1.13rem; background: #fff; }
.crm-kicker { font-size: .7rem; font-weight: 800; color: #b8430f; }
.admin-product-section { border: 1px solid #d9dfe5; border-radius: 1rem; padding: 1rem; background: #fff; }
.admin-table-surface { border: 1px solid #e2e8f0; border-radius: .875rem; overflow-x: auto; background: #fff; box-shadow: 0 1px 2px rgb(0 17 34 / .06); }
:is(.admin-returns__table-wrap, .support-admin__table, .profiles-admin__table) { border: 1px solid #d9dfe5; border-radius: .875rem; overflow-x: auto; background: #fff; box-shadow: 0 1px 2px rgb(0 0 28 / .1), 0 8px 24px rgb(0 0 42 / .08); }
.inventory-table-wrap { border: 1px solid #cbd5e1; border-radius: .7rem; overflow-x: auto; background: #fff; } /* assumed: its look is not in the scan */
.inventory-money { display: block; font-size: .72rem; font-weight: 750; color: #475569; }
.inventory-money > div { border: 1px solid #cbd5e1; border-radius: .7rem; }
.inventory-money input { display: block; width: 100%; border: 0; border-radius: .7rem; padding: .5rem .65rem; outline: none; }
.admin-shell .admin-page .admin-table > thead > tr > th { color: #5d6975; font-size: .69rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; padding: .75rem 1rem; }
/* An unclassed th reads as start-aligned live while th.text-end reads end, so
   the start sits below the utilities: */
@layer base { .admin-table th { text-align: start; } }
.admin-shell .admin-page .admin-table > tbody > tr > td { padding: .75rem 1rem; font-size: .8125rem; vertical-align: middle; }
.inventory-table th { white-space: nowrap; }
.inventory-product-cell > strong { min-width: 13rem; } /* the name measured 221px wide */
.inventory-product-cell > * { display: block; }
.inventory-product-arabic { font-size: .8125rem; color: #475569; }
.inventory-product-meta { font-size: .7rem; font-weight: 500; }
.inventory-size-chip { display: inline-block; font-size: .68rem; font-weight: 800; border: 1px solid #cbd5e1; border-radius: .4rem; padding: 0 .3rem; }
.inventory-sku { display: block; font-size: .68rem; font-weight: 600; color: #64748b; }
.inventory-ledger-mini { display: block; color: #64748b; font-size: .67rem; font-weight: 600; }
.inventory-stock-badge { display: inline-block; border-radius: 999px; padding: .1rem .5rem; font-size: .68rem; font-weight: 800; white-space: nowrap; background: #f1f5f9; }
.inventory-stock-badge--low { color: #92400e; background: #fffbeb; }
.inventory-stock-control { display: block; width: 7rem; margin-inline-start: auto; } /* assumed: what holds STOCK at 151px live, whatever the font */
.inventory-adjust-button { border: 1px solid #cbd5e1; border-radius: .7rem; padding: .55rem .85rem; background: #fff; color: #334155; font-size: .8125rem; }
.admin-form-actions { background: #f2f4f6; padding: .85rem 0; }
.topbar-editor__save { background: #e0561c; color: #fff; border-radius: .75rem; padding: .6rem 1rem; }
.theme-editor__panel { border: 1px solid #d9dfe5; border-radius: 1rem; padding: 1.13rem; background: #fff; box-shadow: 0 1px 2px rgb(0 0 28 / .1), 0 8px 24px rgb(0 0 42 / .08); }
.theme-editor__color-control { display: flex; gap: .5rem; align-items: center; border: 1px solid #aeb8c2; border-radius: .875rem; padding: .5rem; }
.theme-editor__preview-topbar { font-size: .64rem; background: #c76a42; color: #fff; padding: .4rem; }
.seo-editor__panel { border: 1px solid #d9dfe5; border-radius: 1.15rem; padding: 1.5rem; background: #fff; box-shadow: 0 10px 28px rgb(15 23 42 / .08); }
.seo-editor__panel fieldset { border: 1px solid #e2e8f0; border-radius: .85rem; padding: .9rem 1rem; }
.seo-editor__search-result { border: 1px solid #e2e8f0; border-radius: .85rem; padding: .9rem 1rem; }
.seo-editor__field { display: block; font-size: .8rem; font-weight: 750; }
.seo-editor__field input { display: block; width: 100%; border: 1px solid #aeb8c2; border-radius: .7rem; padding: .7rem .85rem; }
.admin-notice--warn { color: #765010; background: #fffbeb; border: 1px solid #ffd230; }
.admin-notice--info { background: #fff6f0; border: 1px solid #bd7c5b; }
.admin-notice--error { background: #fff0f2; border: 1px solid #e9a0a9; color: #8d2435; }
.crm-filter { display: block; font-size: .72rem; font-weight: 700; color: #64748b; }
.admin-editor-modal { background: #fff; border-radius: 1rem; padding: 1.25rem; box-shadow: 0 28px 80px rgb(15 23 42 / .28); }
.admin-image-gallery { background: #f7f8fa; border-radius: .75rem; padding: .75rem; margin-inline: .125rem; } /* assumed: the 2px is its own margin */
.payment-secret-field__label { white-space: nowrap; } /* assumed: why "Required" ran into the padding */
@media (max-width: 767px) {
  .admin-shell button { min-height: 44px; }
  .admin-content { padding: 1rem; }
  .admin-editor-modal { padding: .75rem; }
}
`

const boxClasses = [...new Set([...BOXES.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TWB = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${boxClasses.join(' ')}");`, { from: join(ROOT, 'admin-boxes-fixture.css') })).css
const boxHtml = (addon) => `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${TWB}</style><style>${LIVE_BOX}</style>${addon ? `<style>${addon}</style>` : ''}</head><body style="margin:0">${BOXES}</body></html>`

const SOFT = 'rgba(16, 24, 40, 0.06) 0px 1px 2px 0px, rgba(16, 24, 40, 0.04) 0px 1px 3px 0px'
const NEUTRAL = 'rgb(217, 223, 229)', HAIR = '1px solid rgb(226, 232, 240)'
for (const [vn, w, rem] of [['desktop', 1366, 16.92], ['phone', 390, 16]]) {
  const phone = vn === 'phone'
  const open = async (addon) => {
    const pg = await browser.newPage({ viewport: { width: w, height: 900 } })
    await pg.setContent(boxHtml(addon))
    if (phone) await pg.addStyleTag({ content: 'html { font-size: 16px }' })
    await pg.evaluate(async () => { for (const wt of [400, 600, 700]) await document.fonts.load(`${wt} 16px "IBM Plex Sans Arabic"`); await document.fonts.ready })
    return pg
  }
  const PROPS = ['border-top-left-radius', 'border-top-width', 'border-top-style', 'border-top-color', 'border-left-width', 'box-shadow', 'padding-top', 'padding-left', 'background-color', 'color', 'text-align', 'font-variant-numeric']
  const geo = (pg) => (id) => pg.evaluate(([id, props]) => {
    const e = document.getElementById(id), c = getComputedStyle(e), r = e.getBoundingClientRect()
    return Object.assign(Object.fromEntries(props.map((p) => [p, c.getPropertyValue(p)])), { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height })
  }, [id, PROPS])
  const bPg = await open(''), pPg = await open(POLISH), pg = await open(ADDON)
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message))
  const base = geo(bPg), pol = geo(pPg), g = geo(pg)
  const near = (px, r) => Math.abs(parseFloat(px) - r * rem) < 0.6
  console.log(`\n== boxes and tables, ${vn} (${w}px, 1rem = ${rem}px)`)

  // ---- 1-4. every box by role: radius, edge, elevation, padding
  const boxes = await pg.evaluate(() => [...document.querySelectorAll('[data-box]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => [e.id, e.dataset.box]))
  const radii = new Set()
  for (const [id, role] of boxes) {
    if (!id) continue
    const s = await g(id), p0 = await pol(id), rad = parseFloat(s['border-top-left-radius']) / rem
    radii.add(rad.toFixed(3))
    // RADIUS-1114 (owner, 2026-11-14, "reduce over large border radius"): panels and modals 12px (.75rem), cards, tiles, notices,
    // frames and empty states 10px (.625rem), chips and controls unchanged at 8px. The polish's own 16px / 14px were the old scale.
    const want = { panel: 0.75, modal: 0.75, card: 0.625, tile: 0.625, notice: 0.625, frame: 0.625, empty: 0.625, chip: 0.5 }[role]
    is(near(s['border-top-left-radius'], want), `${id} (${role}): radius ${want}rem — got ${s['border-top-left-radius']} (polish alone ${p0['border-top-left-radius']})`)
    // section 6 gave 1.25rem / 1rem (panels, 1rem on a phone), 1rem (cards, tiles, notices) and 2rem (empty states); the SIZES section
    // (sizes-admin-2) replaces them with 1rem / .875rem, .875rem and 1.25rem. Frames stay at 0.
    const pad = { panel: phone ? 0.875 : 1, modal: phone ? 0.875 : 1, card: 0.875, tile: 0.875, notice: 0.875, frame: 0, empty: 1.25 }[role]
    if (pad !== undefined) is(near(s['padding-top'], pad) && near(s['padding-left'], pad), `${id} (${role}): padding ${pad}rem — got ${s['padding-top']} / ${s['padding-left']} (polish alone ${p0['padding-top']})`)
    if (['panel', 'card', 'tile', 'frame'].includes(role) && id !== 'kpi-accent') {
      is(s['border-top-width'] === '1px' && s['border-top-style'] === 'solid' && s['border-top-color'] === NEUTRAL, `${id} (${role}): the one neutral edge, 1px #d9dfe5 — got ${s['border-top-width']} ${s['border-top-style']} ${s['border-top-color']} (polish alone ${p0['border-top-color']})`)
    }
    const nested = ['knet-toggle', 'th-sec1', 'th-sec2', 'seo-fs', 'ps1', 'ps2'].includes(id)
    const sh = role === 'modal' ? p0['box-shadow'] : ['tile', 'notice', 'chip'].includes(role) || nested ? 'none' : ['panel', 'card', 'frame'].includes(role) ? SOFT : null
    if (sh) is(s['box-shadow'] === sh && (role !== 'modal' || /0px 28px 80px/.test(sh)), `${id} (${role}${nested ? ', inside a panel' : ''}): ${role === 'modal' ? 'keeps its deep shadow' : sh === 'none' ? 'flat' : 'the one soft raise'} — got ${s['box-shadow'].slice(0, 90)}`)
  }
  is([...radii].every((r) => ['0.500', '0.625', '0.750'].includes(r)), `three radii only (.5 / .625 / .75rem) across ${boxes.length} boxes — got ${[...radii].join(', ')}rem`)
  let s = await g('kpi-accent'), s0 = await pol('kpi-accent')
  is(s['border-top-color'] === s0['border-top-color'] && s['background-color'] === s0['background-color'], `the accent KPI keeps its terracotta tint — got ${s['border-top-color']} on ${s['background-color']}`)
  for (const id of ['cat-warn', 'cat-info', 'crm-error', 'co-accent']) {
    s = await g(id); s0 = await pol(id)
    is(s['border-top-color'] === s0['border-top-color'] && s['background-color'] === s0['background-color'] && s['border-left-width'] === s0['border-left-width'], `${id}: a notice keeps its own colours and edge — got ${s['border-top-color']} / ${s['background-color']} / ${s['border-left-width']}`)
  }
  s = await g('color-ctl'); is(s['border-top-color'] === EDGE, `Theme colour control: the fields' #7d8799 edge (3.62:1, was #aeb8c2) — got ${s['border-top-color']}`)
  await pg.focus('#color-hex'); s = await g('color-ctl'); s0 = await (async () => { await pPg.focus('#color-hex'); return pol('color-ctl') })()
  is(s['border-top-color'] === ACCENT && /0px 0px 0px 4px/.test(s['box-shadow']), `…and its hex field (outline-none, no edge of its own) shows the accent focus on the control — got ${s['border-top-color']} (polish alone ${s0['border-top-color']} / ${s0['box-shadow'].slice(0, 30)})`)
  await pg.evaluate(() => document.activeElement.blur()); await pPg.evaluate(() => document.activeElement.blur())
  s = await g('money'); s0 = await pol('money')
  is(s['border-top-color'] === EDGE && s['border-top-left-radius'] === s0['border-top-left-radius'], `Inventory expense field: the #7d8799 edge (was #cbd5e1, 1.48:1), the fields' radius kept — got ${s['border-top-color']} ${s['border-top-left-radius']}`)
  await pg.focus('#money-input'); s = await g('money')
  is(s['border-top-color'] === ACCENT && /0px 0px 0px 4px/.test(s['box-shadow']), `…and the fields' accent focus — got ${s['border-top-color']} / ${s['box-shadow'].slice(0, 60)}`)
  await pg.evaluate(() => document.activeElement.blur())
  // Left alone: the overlay, the storefront previews, the sidebar, the action bars, a rounded-full badge.
  for (const id of ['overlay', 'tb-pv-card', 'tb-pv-strip', 'th-pv-card', 'seo-result', 'sb-card', 'tb-actions', 'badge-full']) {
    s = await g(id); s0 = await pol(id)
    const same = ['border-top-left-radius', 'border-top-color', 'box-shadow', 'padding-top', 'padding-left', 'background-color'].every((p) => s[p] === s0[p])
    is(same, `${id} is untouched by the boxes section — got ${s['border-top-left-radius']} ${s['padding-top']} ${s['box-shadow'].slice(0, 40)}`)
  }

  // ---- 5. rhythm: stacked boxes in a space-y column 1rem apart; a grid keeps its gap
  const gap = async (get, a, b) => { const x = await get(a), y = await get(b); return y.top - x.bottom }
  for (const [a, b] of [['cat-warn', 'cat-info'], ['th-sec1', 'th-sec2'], ['crm-form', 'crm-error']]) {
    const v = await gap(g, a, b), v0 = await gap(pol, a, b)
    is(Math.abs(v - rem) < 0.6, `${a} → ${b}: 1rem apart — got ${v.toFixed(1)}px (polish alone ${v0.toFixed(1)}px)`)
  }
  s = await g('brand-card'); const nextBrand = await pg.evaluate(() => { const a = document.getElementById('brand-card'), b = a.nextElementSibling; return b.getBoundingClientRect().top - a.getBoundingClientRect().bottom })
  is(Math.abs(nextBrand - 0.75 * rem) < 0.6, `brand cards in a grid keep its gap-3 (no margin added to grid items) — got ${nextBrand.toFixed(1)}px`)

  // ---- 6. Inventory tiles: every figure inside its tile
  for (const id of ['tile1', 'tile2', 'tile3']) {
    const over = (p) => p.evaluate((id) => {
      const t = document.getElementById(id), c = getComputedStyle(t), r = t.getBoundingClientRect()
      const inL = r.left + parseFloat(c.borderLeftWidth) + parseFloat(c.paddingLeft), inR = r.right - parseFloat(c.borderRightWidth) - parseFloat(c.paddingRight)
      let worst = -Infinity
      for (const d of t.querySelectorAll('*')) { const rg = document.createRange(); rg.selectNodeContents(d); const dr = rg.getBoundingClientRect(); if (dr.width) worst = Math.max(worst, dr.right - inR, inL - dr.left) }
      return { worst, fs: getComputedStyle(t.querySelector('.text-xl')).fontSize, w: r.width }
    }, id)
    const o = await over(pg), o0 = await over(pPg)
    is(o.worst <= 0.5, `${id}: no text past the tile's padding (${o.w.toFixed(0)}px tile, figure ${o.fs}) — worst ${o.worst.toFixed(1)}px (polish alone ${o0.worst.toFixed(1)}px at ${o0.fs})`)
    if (phone) is(o0.worst > 0.5, `${id}: the fixture reproduces the phone spill without this section (${o0.worst.toFixed(1)}px past the tile's padding)`)
  }

  // ---- 7. Payments: every state inside the form's padding, in the palette
  const formPad = (phone ? 0.875 : 1) * rem   // the form's padding after the SIZES section (section 6 gave 1rem / 1.25rem)
  let worst0 = Infinity
  for (const id of ['st-ok', 'st-req', 'st-err', 'st-req2', 'st-req3', 'st-req4']) {
    const d = (p) => p.evaluate((id) => {
      const e = document.getElementById(id), f = e.closest('form'), r = e.getBoundingClientRect(), fr = f.getBoundingClientRect(), fc = getComputedStyle(f)
      return Math.min(r.left - fr.left - parseFloat(fc.borderLeftWidth), fr.right - parseFloat(fc.borderRightWidth) - r.right)
    }, id)
    const v = await d(pg), v0 = await d(pPg); worst0 = Math.min(worst0, v0)
    is(v >= formPad - 0.5, `${id}: ${v.toFixed(1)}px from the form's edge, inside its ${formPad.toFixed(1)}px padding (polish alone ${v0.toFixed(1)}px)`)
  }
  if (!phone) is(worst0 < formPad - 0.5, `the fixture reproduces "Required" in the padding without this section (${worst0.toFixed(1)}px)`)
  s = await g('st-req'); is(s.color === ACCENT, `"Required" is the accent, not amber — got ${s.color}`)
  s = await g('st-req3'); is(s.color === ACCENT, `T-Pay "Required" is the accent too — got ${s.color}`)
  s = await g('st-err'); is(s.color === ROSE, `an error state is rose #be123c — got ${s.color}`)
  s = await g('st-ok'); is(s.color === SLATE700, `the saved state is slate, not emerald — got ${s.color}`)

  // ---- 8. the photo gallery lines up with the sections around it
  const al = async (p) => (await geo(p)('gallery')).left - (await geo(p)('ps1')).left
  const a1 = await al(pg), a0 = await al(pPg)
  is(Math.abs(a1) < 0.5, `Catalogue form: the gallery starts where its sections do — off by ${a1.toFixed(1)}px (polish alone ${a0.toFixed(1)}px)`)

  // ---- 9. editor + preview side by side: top-aligned, not stretched
  if (!phone) for (const [a, b] of [['tb-editor', 'tb-preview'], ['th-panel', 'th-preview'], ['seo-panel', 'seo-preview']]) {
    const x = await g(a), y = await g(b)
    is(Math.abs(x.top - y.top) < 0.5 && Math.abs(x.h - y.h) > 20, `${a} / ${b}: tops aligned, heights their own (${x.h.toFixed(0)} / ${y.h.toFixed(0)}), not stretched`)
  }

  // ---- 10-13. tables (the phone shows cards; tables are measured at 1366)
  if (!phone) {
    const fit = (p) => p.evaluate(() => {
      const t = document.getElementById('t-inv'), f = document.getElementById('inv-frame'), cols = [...t.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().width))
      const w = t.style.width; t.style.width = '1px'; const min = t.getBoundingClientRect().width; t.style.width = w   // the narrowest it can be
      return { t: t.getBoundingClientRect().width, f: f.clientWidth, fw: f.getBoundingClientRect().width, min, cols }
    })
    const f = await fit(pg), f0 = await fit(pPg), fb = await fit(bPg)
    is(fb.t <= fb.f + 0.5, `Inventory fits its frame with no add-on (${fb.t.toFixed(0)}px in a ${fb.fw.toFixed(0)}px frame), as live (1016 in 1018)`)
    is(f0.t > f0.f + 0.5, `the fixture reproduces the overflow with the polish alone: ${f0.t.toFixed(0)}px in a ${f0.fw.toFixed(0)}px frame (live 1039 in 1018) — columns ${f0.cols.join('/')}`)
    is(f.t <= f.f + 0.5, `Inventory fits its ${f.fw.toFixed(0)}px frame at 1366px: ${f.t.toFixed(0)}px — columns ${f.cols.join('/')}`)
    // MOVEMENTS: does a ledger line still break, and could it fit at all?
    const wraps = (p) => p.evaluate(() => {
      const rows = [...document.querySelectorAll('#t-inv tbody tr')], c4 = rows[0].children[3], cs = getComputedStyle(c4)
      const n = rows.filter((tr) => [...tr.children[3].querySelectorAll('.inventory-ledger-mini')].some((e) => { const rg = document.createRange(); rg.selectNodeContents(e); return new Set([...rg.getClientRects()].map((r) => Math.round(r.top))).size > 1 })).length
      const probe = c4.querySelector('.inventory-ledger-mini').cloneNode(true); probe.style.cssText = 'position:absolute;white-space:nowrap;width:auto'; c4.appendChild(probe)
      const need = probe.getBoundingClientRect().width; probe.remove()
      return { n, need, have: c4.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }
    })
    const wr = await wraps(pg), wr0 = await wraps(pPg)
    is(wr.n <= wr0.n, `MOVEMENTS wraps on no more rows than before (${wr.n} vs ${wr0.n} of 6): a whole ledger line needs ${wr.need.toFixed(0)}px, the column gets ${wr.have.toFixed(0)} (${wr0.have.toFixed(0)} before); of the ${(f.f - f.min).toFixed(0)}px the table has to spare, the browser gives most to SIZE / SKU`)

    const tables = ['t-orders', 't-returns', 't-support', 't-profiles', 't-sitedb', 't-list', 't-inv']
    const sigs = await pg.evaluate((ids) => ids.flatMap((id) => [...document.querySelectorAll(`#${id} > thead > tr > th`)].map((th) => { const c = getComputedStyle(th); return `${c.color}|${c.fontSize}|${c.fontWeight}|${c.textTransform}|${c.letterSpacing}|${c.borderBottomWidth} ${c.borderBottomStyle} ${c.borderBottomColor}` })), tables)
    const one = [...new Set(sigs)]
    is(one.length === 1, `one header style on all ${sigs.length} headers of ${tables.length} tables — got ${one.length}: ${one.join(' ;; ').slice(0, 160)}`)
    const [col, fs, fw, tt, ls, bb] = one[0].split('|')
    is(col === META && parseFloat(fs) >= 12 && fw === '700' && tt === 'uppercase' && Math.abs(parseFloat(ls) - 0.04 * parseFloat(fs)) < 0.05 && bb === HAIR, `header: #556274 (6.20:1), ≥12px, 700, uppercase, .04em, 1px #e2e8f0 under it — got ${one[0]}`)
    for (const id of tables) {
      const d = (p) => p.evaluate((id) => {
        const rows = [...document.querySelectorAll(`#${id} > tbody > tr`)]
        const cell = (tr) => { const c = getComputedStyle(tr.children[0]); return `${c.borderBottomWidth} ${c.borderBottomStyle} ${c.borderBottomColor}` }
        return { mid: [...new Set(rows.slice(0, -1).flatMap((tr) => [...tr.children].map((td) => { const c = getComputedStyle(td); return `${c.borderBottomWidth} ${c.borderBottomStyle} ${c.borderBottomColor}|${c.borderTopWidth}` })))], last: cell(rows.at(-1)), tr: [...new Set(rows.map((tr) => getComputedStyle(tr).borderBottomWidth + '/' + getComputedStyle(tr).borderTopWidth))] }
      }, id)
      const v = await d(pg), v0 = await d(pPg)
      is(v.mid.length === 1 && v.mid[0] === HAIR + '|0px' && v.last.startsWith('0px') && v.tr.join() === '0px/0px', `${id}: one divider, 1px #e2e8f0 under every row but the last — got ${v.mid.join(' ; ')} / last ${v.last} (polish alone ${v0.mid.join(' ; ').slice(0, 60)})`)
      const m = await pg.evaluate((id) => {
        const t = document.getElementById(id), side = (e) => { const a = getComputedStyle(e).textAlign; return /end|right/.test(a) ? 'end' : 'start' }
        const r1 = t.querySelector('tbody > tr')
        return [...t.querySelectorAll('thead th')].map((th, i) => [th.textContent.trim() || '(actions)', side(th), side(r1.children[i])]).filter(([, a, b]) => a !== b)
      }, id)
      is(!m.length, `${id}: every header lines up with its cells — mismatched ${m.map((x) => x.join(' ')).join(', ') || 'none'}`)
    }
    const pr = await pg.evaluate(() => [...document.querySelectorAll('#t-profiles tr')].map((tr) => [...tr.children].slice(1, 4).map((c) => { const s = getComputedStyle(c); return `${/end|right/.test(s.textAlign) ? 'end' : 'start'}${/tabular-nums/.test(s.fontVariantNumeric) ? '+tab' : ''}` }).join(' ')))
    is(pr.every((r) => r === 'start+tab end+tab end+tab'), `Profiles: PHONE start, ORDERS and PAYMENTS RECEIVED end, all three in tabular figures — got ${[...new Set(pr)].join(' | ')}`)
    await pg.hover('#sup-row-1 td:nth-child(2)'); await pg.waitForTimeout(50)
    s = await g('sup-row-1'); is(s['background-color'] === 'rgb(248, 250, 252)', `a clickable row lights up #f8fafc on hover — got ${s['background-color']}`)
    await pg.mouse.move(2, 2)
  }
  is(!errs.length, `boxes page: no page errors ${errs.join(' ')}`)
  await pg.close(); await pPg.close(); await bPg.close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
