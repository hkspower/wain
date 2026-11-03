// Fixture for the Photos panel (public/sporta-admin-brands.js, block "ADMIN PHOTO UPLOADER"): the admin
// Catalogue screen with its product list, and the data the fake admin API answers with.
//
// PROVENANCE, said plainly. The live compiled /backends Catalogue screen could not be dumped for this fixture:
// the Hostinger connector the read-only probes run through asked to be signed in again (2026-11-03), and a
// session cannot do that. So the markup is rebuilt from the two places that record it:
//   - src/admin/Catalog.jsx and src/admin/Products.jsx, the source of the screen ("Every product in the database",
//     a table headed Product / Web name / Price / On sale, an Edit button per row, an empty last header);
//   - public/sporta-admin-knet.css, whose selectors were written against the live DOM (td:has(> span.block.text-xs
//     .text-slate-500) for the name cell, .admin-table, div.overflow-x-auto.rounded-2xl.border, .m-tabbar,
//     .admin-sidebar) and scripts/fixtures/admin-save.mjs (the catalogue modal, the tab bar).
// The panel finds the screen by its table headers or its heading, not by a class, so a live DOM that differs in
// classes still works; a live table that renames those headers would need the one-line change in findTable().
// Re-dump it with the read-only probe described in CLAUDE.md the next time the connector is signed in, and
// replace SCREEN below with the dump.
import { LIVE } from './admin-payments.mjs'
export { LIVE }

const long = (s) => (s + ' ').repeat(40).slice(0, 300)

// What products_all answers: PDO-style strings for the numbers, newest id first. Six products.
export const PRODUCTS = [
  { id: 6, slug: 'vanquish-tee-white', name_en: 'Vanquish Tee White', name_ar: 'تيشيرت فانكويش أبيض', desc_en: 'Soft cotton tee.', desc_ar: 'قطن ناعم.', price: '9.500', sale_price: null, sale_starts_at: null, sale_ends_at: null, featured: '0', featured_sort: '0', category: 'tops', brand_slug: 'vanquish', image: null, images: null, active: '1' },
  { id: 5, slug: 'air-max-90', name_en: 'Air Max 90', name_ar: 'اير ماكس ٩٠', desc_en: 'Running shoe.', desc_ar: 'حذاء جري.', price: '42.000', sale_price: '35.500', sale_starts_at: '2026-11-01 00:00:00', sale_ends_at: '2026-11-30 23:59:00', featured: '1', featured_sort: '3', category: 'shoes', brand_slug: 'nike', image: '/images/products/air-max-90-old0000001.jpg', images: '/images/products/air-max-90-old0000002.jpg', active: '1' },
  { id: 4, slug: 'air-max', name_en: 'Air Max', name_ar: 'اير ماكس', desc_en: null, desc_ar: null, price: '39.000', sale_price: null, sale_starts_at: null, sale_ends_at: null, featured: '0', featured_sort: '0', category: 'shoes', brand_slug: null, image: null, images: null, active: '1' },
  { id: 3, slug: 'long-desc-hoodie', name_en: 'Team Hoodie', name_ar: 'هودي الفريق', desc_en: long('A long description that product_save would cut at 280 characters.'), desc_ar: 'وصف.', price: '24.000', sale_price: null, sale_starts_at: null, sale_ends_at: null, featured: '0', featured_sort: '0', category: 'tops', brand_slug: null, image: null, images: null, active: '1' },
  { id: 2, slug: 'hidden-cap', name_en: 'Team Hoodie', name_ar: 'قبعة مخفية', desc_en: 'Cap.', desc_ar: 'قبعة.', price: '5.000', sale_price: null, sale_starts_at: null, sale_ends_at: null, featured: '0', featured_sort: '0', category: 'caps', brand_slug: null, image: null, images: null, active: '0' },
  { id: 1, slug: 'run-shorts', name_en: 'Run Shorts', name_ar: 'شورت الجري', desc_en: 'Light shorts.', desc_ar: 'شورت خفيف.', price: '11.250', sale_price: null, sale_starts_at: null, sale_ends_at: null, featured: '0', featured_sort: '0', category: 'shorts', brand_slug: null, image: null, images: '/images/products/run-shorts-aaaa000001.jpg,/images/products/run-shorts-aaaa000002.jpg', active: '1' },
]
export const BRANDS = ['vanquish', 'nike']

const SIDEBAR = `<aside class="admin-sidebar w-60"><nav aria-label="Admin"><ul>${['Overview', 'Orders', 'Catalogue', 'Brands'].map((t) => `<li><a href="#" data-go="${t.toLowerCase()}" class="text-slate-500">${t}</a></li>`).join('')}</ul></nav></aside>`
const TABBAR = `<nav class="m-tabbar" aria-label="Admin tabs">${['Overview', 'Orders', 'Catalogue', 'Brands'].map((t) => `<button type="button" class="m-tabbar__item" data-go="${t.toLowerCase()}">${t}</button>`).join('')}</nav>`

const rows = PRODUCTS.map((p) => `<tr class="border-b border-slate-50 last:border-0"><td class="p-3"><span class="${Number(p.active) ? 'font-semibold text-slate-800' : 'text-slate-500'}">${p.name_en}</span><span class="block text-xs text-slate-500" dir="rtl">${p.name_ar}</span></td><td class="p-3 font-mono text-xs text-slate-500">${p.slug}</td><td class="p-3 text-end tabular-nums">${p.price}</td><td class="p-3"><label class="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" class="h-4 w-4 accent-indigo-600" ${Number(p.active) ? 'checked' : ''}>${Number(p.active) ? 'On sale' : 'Off sale'}</label></td><td class="p-3 text-end"><button type="button" class="text-xs font-bold text-indigo-600 hover:underline">Edit</button></td></tr>`).join('')

const COMPARISON = `<section><div class="mb-2 flex items-baseline gap-3"><h2 class="text-sm font-bold text-slate-700">Comparison</h2><span class="text-xs text-slate-500">6 in sync · 0 differ · 0 missing</span></div>
<table class="admin-table w-full border-collapse text-sm"><thead><tr class="border-b border-slate-300 text-slate-500"><th class="py-2 text-start font-semibold">Product</th><th class="py-2 text-start font-semibold">Slug</th><th class="py-2 text-end font-semibold">Site price</th><th class="py-2 text-end font-semibold">Database</th><th class="py-2 text-start font-semibold">State</th></tr></thead>
<tbody><tr class="border-b border-slate-100"><td class="py-2.5">Vanquish Tee White</td><td class="py-2.5 font-mono text-xs text-slate-500">vanquish-tee-white</td><td class="py-2.5 text-end tabular-nums">9.500</td><td class="py-2.5 text-end tabular-nums">9.500</td><td class="py-2.5"><span class="rounded-full px-2 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-800">in sync</span></td></tr></tbody></table></section>`

// The product list: header, then the framed table. This is what the panel anchors to.
export const LIST = `<section class="mt-8" id="product-list"><header class="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 class="font-bold text-slate-800">Every product in the database</h3><p class="text-sm text-slate-600">5 on sale · 1 off sale</p></div><button type="button" class="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700">Add a product</button></header>
<div class="overflow-x-auto rounded-2xl border border-slate-300 bg-white" id="product-table-wrap"><table class="admin-table w-full text-sm"><thead><tr class="border-b border-slate-100 text-start text-xs font-bold uppercase text-slate-500"><th class="p-3 text-start">Product</th><th class="p-3 text-start">Web name</th><th class="p-3 text-end">Price</th><th class="p-3 text-start">On sale</th><th class="p-3"></th></tr></thead><tbody>${rows}</tbody></table></div></section>`

export const SCREEN = `<section class="admin-page"><div class="admin-page-layout space-y-6"><header class="admin-page-header"><h1 class="text-2xl font-bold text-slate-900">Catalogue</h1></header>
<div class="admin-notice rounded-xl border p-4" role="status"><p class="font-bold">Catalogue is in sync</p><p class="text-sm">All 6 products exist in the database at the expected price.</p></div>
<section class="rounded-xl border border-slate-300 bg-white p-4"><div class="flex flex-wrap items-center justify-between gap-3"><div><p class="font-bold text-slate-800">Push the site catalogue to the database</p><p class="mt-0.5 text-sm text-slate-500">Inserts what is missing and updates what differs.</p></div><button type="button" class="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">Push 6 products</button></div></section>
${COMPARISON}
<section class="border-t border-slate-300 pt-6">${LIST}</section></div></section>`

export const ORDERS = `<section class="admin-page"><div class="admin-page-layout space-y-6"><header class="admin-page-header"><h1 class="text-2xl font-bold text-slate-900">Orders</h1></header><div class="overflow-x-auto rounded-2xl border border-slate-300 bg-white"><table class="admin-table w-full text-sm"><thead><tr><th class="p-3 text-start">Track ID</th><th class="p-3 text-start">Customer</th><th class="p-3 text-end">Amount</th></tr></thead><tbody><tr><td class="p-3">SP1000</td><td class="p-3">Test</td><td class="p-3 text-end">9.500</td></tr></tbody></table></div></div></section>`

export const screenHtml = (inner = SCREEN) => `<div class="admin-shell min-h-screen bg-slate-50">${SIDEBAR}<main class="admin-content flex-1" id="main">${inner}</main>${TABBAR}</div>`

// The layout the build gives the shell, minimal: a sidebar from 768px, the tab bar below it.
export const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#f3f5f7;font:14px/1.45 system-ui,sans-serif}
.admin-shell{min-height:100vh}
.m-tabbar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;height:60px;background:#fff;border-top:1px solid #e2e8f0}
.m-tabbar__item{flex:1;border:0;background:transparent;font:inherit;color:inherit}
.admin-sidebar{display:none;position:fixed;inset:0 auto 0 0;width:240px;background:#fff;border-inline-end:1px solid #e2e8f0;padding:16px;z-index:30}
.admin-sidebar ul{list-style:none;margin:0;padding:0}
.admin-content{padding:16px 16px 84px}
@media(min-width:768px){.m-tabbar{display:none}.admin-sidebar{display:block}.admin-content{margin-inline-start:240px;padding:24px 32px}}
`

// The mini "React": re-render the whole main (a tab switch), swap screens, replace just the table wrapper.
export const FIXTURE_JS = `
(function () {
  var screens = {}   // replaced by the test with the screens' markup
  window.fx = {
    screens: screens,
    go: function (name) { var m = document.getElementById('main'); var all = window.fx.screens; m.innerHTML = all[name] || all.catalogue },
    // The framework re-renders ITS nodes; it never serialises ours into its markup. So the panel is left out of the copy.
    strip: function (root) { root.querySelectorAll('[data-sporta-photos]').forEach(function (n) { n.remove() }); return root },
    rerenderMain: function () { var m = document.getElementById('main'); var h = window.fx.strip(m.cloneNode(true)).innerHTML; m.innerHTML = ''; m.innerHTML = h; return true },
    replaceTable: function () { var w = document.getElementById('product-table-wrap'); var c = w.cloneNode(true); w.replaceWith(c); return true },
    replaceList: function () { var w = document.getElementById('product-list'); var c = window.fx.strip(w.cloneNode(true)); w.replaceWith(c); return true }
  }
  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]'); if (!g) return
    e.preventDefault(); window.fx.go(g.getAttribute('data-go'))
  })
})()
`
