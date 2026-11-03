// Fixtures for the admin Save bar (public/sporta-admin-brands.js, block "ADMIN SAVE BAR"), one per Save
// pattern measured on the LIVE compiled /backends by scripts/admin-save-scan.mjs (2026-11-03):
//
//   topbar-window     one long page form, window scrolls, Save is DISABLED and says "Saved" while clean (Topbar)
//   topbar-inner      the same form inside an inner scroll box (the admin content scrolls, not the window)
//   orders-drawer     div.fixed.inset-0.z-50 > aside (scrolls inside itself); TWO type=button Saves, no form,
//                     "Save status" disabled until the select changes; busy = disabled + aria-busy + "Saving..."
//   catalogue-modal   div.fixed.inset-0.z-40 > form.admin-editor-modal with the sticky .admin-editor-actions row;
//                     on a phone the fixed .m-tabbar (z40, later in the DOM) sits ON TOP of that row
//   slides-modal      div.fixed.inset-0.z-50 that scrolls itself, form.max-w-2xl, Save last, native `required`
//   support-drawer    z80 backdrop > aside; "Save ticket" in view, "Send customer reply" far down, disabled until typed
//   short-form        a page form whose Save is always in view (no bar)
//   short-modal       a small modal whose Save is in view (no bar)
//   crm-inline        a 2-field inline "Create contact" form at the top of a long list
//   no-save           autosave toggles + a Search/Apply filter form (no bar, ever)
//   confirm-over-form the Topbar page with a Cancel/Delete confirm dialog on top (no bar while it is open)
//
// The markup follows the structure and class names the scan recorded; the fields are made up. Tailwind is
// compiled for the classes used (admin-save-test.mjs), the rules the compiled admin ships as its own CSS
// (.admin-editor-modal, .admin-editor-actions, .m-tabbar ...) are written out in FIXTURE_CSS from the scan.

const field = (i, extra = '') => `<label class="block text-sm"><span class="mb-1 block font-medium">Field ${i}</span><input class="w-full rounded-lg border border-slate-300 px-3 py-2" name="f${i}" value="" ${extra}></label>`
const fields = (n, from = 1, req = false) => Array.from({ length: n }, (_, i) => field(from + i, req && i === 0 ? 'required' : (i === n - 1 ? 'data-last="1"' : ''))).join('\n')
const para = (n) => Array.from({ length: n }, (_, i) => `<p class="text-sm text-slate-600">Order line ${i + 1}: Test tee, size M, qty 1, 9.000 KWD</p>`).join('\n')
const TABBAR = `<nav class="m-tabbar" aria-label="Admin tabs">${['Overview', 'Orders', 'Catalogue', 'Slides', 'More'].map((t) => `<button type="button" class="m-tabbar__item">${t}</button>`).join('')}</nav>`
const SIDEBAR = `<aside class="admin-sidebar"><nav aria-label="Admin"><ul>${['Overview', 'Orders', 'Catalogue', 'Topbar'].map((t) => `<li><a href="#">${t}</a></li>`).join('')}</ul></nav></aside>`
const shell = (main, extra = '') => `<div class="admin-shell">${SIDEBAR}<main class="admin-content">${main}</main>${extra}${TABBAR}</div>`

// A screen that is a 12-field form with the Save at the bottom (Topbar).
const topbarForm = `<form class="topbar-editor admin-page-layout panel space-y-4 rounded-2xl border border-slate-200 bg-white p-5" data-save="topbar" data-enable="Save changes">
<h1 class="text-xl font-bold">Top bar</h1>
${fields(12)}
<div class="flex justify-end"><button type="submit" class="topbar-editor__save rounded-xl bg-slate-900 px-4 py-2 font-bold text-white" disabled>Saved</button></div>
</form>`

export const PAGES = {
  'topbar-window': { main: topbarForm },
  'topbar-inner': { inner: true, main: topbarForm },

  'orders-drawer': {
    main: '<h1 class="text-xl font-bold">Orders</h1><p>List behind the drawer.</p>',
    extra: `<div class="fixed inset-0 z-50 bg-black/40" id="orders-overlay"><aside class="flex h-full w-full max-w-xl flex-col gap-6 overflow-y-auto bg-white p-5 ml-auto panel">
<h2 class="text-lg font-bold">Order SPTEST1000</h2>
<section class="space-y-3"><h3 class="font-semibold">Customer details</h3>${fields(10)}
<button type="button" class="font-semibold rounded-xl bg-slate-900 px-4 py-2 text-white" data-save="customer" data-busy="700">Save customer details</button></section>
<section>${para(8)}</section>
<div class="flex flex-wrap items-center gap-3"><select class="rounded-lg border px-3 py-2" data-enables="status-save"><option>unfulfilled</option><option>packed</option></select>
<button type="button" id="status-save" class="font-bold rounded-xl bg-slate-900 px-4 py-2 text-white" data-save="status" data-busy="700" disabled style="opacity:.4">Save status</button></div>
<button type="button" class="rounded-xl border px-4 py-2" id="cod-block">Block cash on delivery</button>
</aside></div>`,
  },

  'catalogue-modal': {
    main: '<h1 class="text-xl font-bold">Catalogue</h1><p>46 products</p>',
    modal: `<div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 md:p-6" id="cat-overlay">
<form class="admin-editor-modal panel" data-save="product">
<h2 class="text-lg font-bold">Edit product</h2>
<div class="space-y-3">${fields(15)}</div>
<div class="admin-editor-actions"><button type="button" class="rounded-xl border px-4 py-2">Cancel</button><button type="submit" class="rounded-xl bg-slate-900 px-4 py-2 font-bold text-white">Save product</button></div>
</form></div>`,
  },

  'slides-modal': {
    main: '<h1 class="text-xl font-bold">Slides</h1><p>2 slides</p>',
    extra: `<div class="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4" id="slides-overlay"><form class="w-full max-w-2xl space-y-5 rounded-2xl bg-white p-5 mx-auto panel" data-save="slide" data-busy-form="1">
<h2 class="text-lg font-bold">Edit slide</h2>${fields(10, 1, true)}
<div class="flex justify-end gap-3"><button type="button" class="rounded-xl border px-4 py-2 font-semibold">Cancel</button><button type="submit" class="font-bold rounded-xl bg-slate-900 px-4 py-2 text-white">Save slide</button></div>
</form></div>`,
  },

  'support-drawer': {
    main: '<h1 class="text-xl font-bold">Support</h1>',
    extra: `<div class="support-admin__backdrop" id="support-overlay"><aside class="support-admin__drawer panel">
<h2 class="text-lg font-bold">Ticket ST510000</h2>
<form class="support-admin__editor space-y-3" data-save="ticket"><label class="block text-sm">Status<select class="w-full rounded-lg border px-3 py-2"><option>open</option><option>closed</option></select></label>
<label class="block text-sm">Priority<select class="w-full rounded-lg border px-3 py-2"><option>normal</option></select></label>
<button type="submit" class="support-admin__primary rounded-xl bg-slate-900 px-4 py-2 font-bold text-white">Save ticket</button></form>
<section>${para(30)}</section>
<form class="support-admin__reply space-y-3" data-save="reply"><textarea class="w-full rounded-lg border px-3 py-2" rows="4" name="reply" data-enables="reply-save" data-last="1"></textarea>
<button type="submit" id="reply-save" class="support-admin__primary rounded-xl bg-slate-900 px-4 py-2 font-bold text-white" disabled>Send customer reply</button></form>
</aside></div>`,
  },

  'short-form': {
    main: `<form class="panel space-y-3 rounded-2xl border bg-white p-5" data-save="short"><h1 class="text-xl font-bold">Delivery fee</h1>${fields(3)}<button type="submit" class="rounded-xl bg-slate-900 px-4 py-2 font-bold text-white">Save</button></form>`,
  },

  'short-modal': {
    main: '<h1 class="text-xl font-bold">Discounts</h1>',
    extra: `<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><form class="w-full max-w-lg space-y-4 rounded-2xl bg-white p-5 panel" data-save="discount"><h2 class="font-bold">New discount</h2>${fields(2)}<button type="submit" class="font-bold rounded-xl bg-slate-900 px-4 py-2 text-white">Save</button></form></div>`,
  },

  'crm-inline': {
    main: `<h1 class="text-xl font-bold">CRM</h1>
<form id="crm-create" class="crm-create panel flex flex-wrap gap-3 rounded-xl border bg-white p-4" data-save="crm"><input class="rounded-lg border px-3 py-2" name="name" placeholder="Name"><input class="rounded-lg border px-3 py-2" name="phone" placeholder="Phone"><button type="submit" class="crm-primary rounded-xl bg-slate-900 px-4 py-2 font-bold text-white">Create contact</button></form>
<ul class="mt-6 space-y-2">${Array.from({ length: 40 }, (_, i) => `<li class="panel rounded-lg border bg-white p-4">Contact ${i + 1}</li>`).join('')}</ul>`,
  },

  'no-save': {
    main: `<h1 class="text-xl font-bold">Catalogue</h1>
<form class="panel flex flex-wrap gap-3 rounded-xl border bg-white p-4" data-save="filter"><input class="rounded-lg border px-3 py-2" type="search" placeholder="Search"><select class="rounded-lg border px-3 py-2"><option>All</option></select><input class="rounded-lg border px-3 py-2" placeholder="Min price"><button type="submit" class="rounded-xl bg-slate-900 px-4 py-2 text-white">Search</button><button type="button" class="rounded-xl border px-4 py-2">Apply</button></form>
<ul class="mt-6 space-y-2">${Array.from({ length: 30 }, (_, i) => `<li class="panel flex items-center justify-between rounded-lg border bg-white p-4">Product ${i + 1}<label><input type="checkbox" checked> On sale</label><button type="button" class="rounded-lg border px-3 py-1">Delete</button></li>`).join('')}</ul>
<button type="button" class="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-white">Push 30 products</button>`,
  },

  'confirm-over-form': { main: topbarForm, confirm: true },
}

export const CONFIRM = `<div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" id="confirm-overlay"><div class="panel rounded-2xl bg-white p-6" role="alertdialog"><p class="font-semibold">Remove this?</p><div class="mt-4 flex gap-3"><button type="button" class="rounded-xl border px-4 py-2">Cancel</button><button type="button" class="rounded-xl bg-rose-600 px-4 py-2 text-white">Delete</button></div></div></div>`

export const render = (name) => {
  const p = PAGES[name]
  const main = p.inner ? `<div class="inner-scroll" id="inner">${p.main}</div>` : p.main
  return shell(main, (p.extra || '') + (p.modal || ''))
}

// Everything Tailwind has to know about.
export const ALL_HTML = Object.keys(PAGES).map(render).join('\n') + CONFIRM

export const FIXTURE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{color-scheme:light dark}
body{margin:0;font:14px/1.45 system-ui,sans-serif;background:#f8fafc;color:#0f172a}
.m-tabbar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;height:60px;background:#fff;border-top:1px solid #e2e8f0;padding-bottom:env(safe-area-inset-bottom)}
.m-tabbar__item{flex:1;border:0;background:transparent;font:inherit;color:inherit}
.admin-sidebar{display:none;position:fixed;left:0;top:0;bottom:0;width:240px;background:#fff;border-right:1px solid #e2e8f0;z-index:30;padding:16px}
.admin-content{padding:16px 16px 80px}
.inner-scroll{height:calc(100vh - 100px);overflow-y:auto;padding:4px 4px 24px}
@media(min-width:768px){.m-tabbar{display:none}.admin-sidebar{display:block}.admin-content{margin-left:240px;padding:24px 32px}.inner-scroll{height:calc(100vh - 48px)}}
.admin-editor-modal{width:100%;max-width:42rem;height:100%;overflow-y:auto;background:#fff;padding:1.25rem;border-radius:0}
@media(min-width:768px){.admin-editor-modal{height:auto;max-height:min(90vh,760px);border-radius:16px}}
.admin-editor-actions{position:sticky;bottom:-1.25rem;z-index:15;display:flex;justify-content:flex-end;gap:.75rem;margin:1rem -1.25rem -1.25rem;padding:1rem 1.25rem;background:#fff;border-top:1px solid #e2e8f0}
.support-admin__backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.4);display:flex;justify-content:flex-end}
.support-admin__drawer{width:100%;max-width:34rem;height:100%;overflow-y:auto;background:#fff;padding:1.25rem;display:flex;flex-direction:column;gap:1.5rem}
@media(prefers-color-scheme:dark){
 body{background:#0b1120;color:#e2e8f0}
 .panel,.bg-white,.m-tabbar,.admin-sidebar,.admin-editor-modal,.admin-editor-actions,.support-admin__drawer{background:#111827;color:#e2e8f0;border-color:#334155}
 input,select,textarea{background:#0f172a;color:#e2e8f0}
}
`

// The mini "React": delegated handlers, so replacing a node loses nothing, the busy cycle the live buttons show
// (disabled + aria-busy + opacity + "Saving..."), a disabled-until-dirty Save, and re-render helpers.
export const FIXTURE_JS = `
(function () {
  var saves = {}
  function count(n) { saves[n] = (saves[n] || 0) + 1 }
  function busy(btn, ms) {
    var was = btn.textContent, id = btn.id
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.style.opacity = '.4'; btn.textContent = 'Saving\\u2026'
    setTimeout(function () {
      var fresh = btn.cloneNode(true)
      fresh.disabled = false; fresh.removeAttribute('aria-busy'); fresh.style.opacity = ''; fresh.textContent = was
      if (btn.isConnected) btn.replaceWith(fresh)
    }, ms)
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-save]')
    if (!b || b.disabled || e.defaultPrevented) return
    count(b.getAttribute('data-save'))
    if (b.getAttribute('data-busy')) busy(b, +b.getAttribute('data-busy'))
  })
  document.addEventListener('submit', function (e) {
    e.preventDefault()
    var f = e.target, n = f.getAttribute('data-save')
    if (!n) return
    count(n)
    var s = e.submitter || f.querySelector('button[type=submit]')
    if (f.hasAttribute('data-busy-form') && s) busy(s, 700)
  })
  document.addEventListener('input', function (e) {
    var t = e.target, f = t.closest('form[data-enable]')
    if (f) { var s = f.querySelector('button[type=submit]'); if (s && s.disabled) { s.disabled = false; s.textContent = f.getAttribute('data-enable') } }
    var id = t.getAttribute && t.getAttribute('data-enables')
    if (id && t.tagName === 'TEXTAREA') { var x = document.getElementById(id); if (x) x.disabled = !t.value.trim() }
  })
  document.addEventListener('change', function (e) {
    var id = e.target.getAttribute && e.target.getAttribute('data-enables')
    if (id && e.target.tagName === 'SELECT') { var x = document.getElementById(id); if (x) { x.disabled = false; x.style.opacity = '' } }
  })
  window.fx = {
    saves: saves,
    // React replacing the Save button (or its whole row) with an identical new node
    rerender: function (sel) { var e = document.querySelector(sel); var c = e.cloneNode(true); e.replaceWith(c); return !!c },
    // the whole screen re-rendered from scratch
    rerenderAll: function () { var r = document.getElementById('root'); var h = r.innerHTML.replace(/ style="padding-bottom:[^"]*"/g, ''); r.innerHTML = ''; r.innerHTML = h },
    confirm: function (on) { var o = document.getElementById('confirm-overlay'); if (o) o.remove(); if (on) document.getElementById('root').insertAdjacentHTML('beforeend', window.FX_CONFIRM) },
    mount: function (html) { document.getElementById('root').innerHTML = html },
    noise: function (frames, per) {
      var host = document.getElementById('fx-noise') || document.getElementById('root').appendChild(Object.assign(document.createElement('div'), { id: 'fx-noise' }))
      var f = 0
      return new Promise(function (res) {
        (function step() {
          for (var i = 0; i < per; i++) { var s = document.createElement('span'); s.textContent = 'n'; host.appendChild(s); if (host.childNodes.length > 400) host.firstChild.remove() }
          if (++f < frames) requestAnimationFrame(step); else res(f)
        })()
      })
    },
    navigate: function (url, html) { history.pushState(null, '', url); window.fx.mount(html) }
  }
})()
`
