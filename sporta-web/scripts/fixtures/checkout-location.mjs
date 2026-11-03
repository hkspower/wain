// The live checkout's delivery form as a fixture for scripts/checkout-location-test.mjs.
//
// MARKUP is the live www.sporta.com.kw /checkout "details" step as measured read-only on 2026-11-03 (Arabic and
// English, 390 and 1280): form.purchase-checkout-layout, the Contact and Address fieldsets, the Address grid
// div.mt-3.grid.gap-3.sm:grid-cols-2 whose five children end with the note wrapper
// <div class="purchase-field sm:col-span-2"><label for="f-note">..<textarea id="f-note" name="note" rows="2"
// maxlength="280" autocomplete="off" enterkeyhint="done">..</div>, then label.tap-row ("remember these details").
// The CSS here is NOT the live stylesheet: it is the handful of rules that decide the geometry the add-on cares
// about (grid columns from 640px, 16px textarea, 12px radius, #7b8793 control border) and the :root tokens the
// live page defines (the same values as scripts/fixtures/checkout-a11y.mjs). The fonts are the machine's.
//
// The page script is a REACT-LIKE controlled textarea, because that is what the live note is
// (hasValueProp=true, onChange): a state variable, a render that writes state back into the node, and an input
// listener that only accepts a change when the node's value differs from state. So:
//   - ta.value = "x" without an input event is undone by the next render (the bug the native setter avoids);
//   - the native prototype setter + a bubbling input event moves state;
//   - window.__rerender('node')  replaces the note wrapper with a brand-new node (what a keyed remount does);
//   - window.__rerender('grid')  replaces every child of the grid (the add-on's own node is wiped too);
//   - window.__go(path)          is the SPA router: /checkout renders the form, anything else a shop page;
//   - window.__lang('en'|'ar')   relabels in place and flips html lang/dir (the live toggle does the same);
//   - window.__state             exposes the state; window.__submits counts submit events (must stay 0).
//
// "Remember these details" (the live storefront's behaviour, measured in the compiled bundle): the whole form,
// note included, is written as JSON to localStorage "sporta.delivery"; the next visit reads it back, and with
// every required field present shows the QUICK checkout (form.purchase-quick: the saved address and the saved
// note as text, NO textarea, no location control) instead of the form. The fixture models that:
//   - opts.saved     a profile object seeded into localStorage BEFORE the page script runs (once per browser
//                    session; opts.savedRaw seeds an exact string instead)
//   - opts.appAfter  boot the app AFTER the add-on (a deferred module script placed behind it) instead of before
//   - window.__save(remember)  what the storefront does on "continue": writes the form to the key, NOT submitting
//   - window.__showForm()      the quick checkout's "edit details" button
const RAW = String.raw

const TOKENS = RAW`
:root{--brand:#e0561c;--brand-bright:#ff7b17;--brand-deep:#b8430f;--ink:#171a1e;--text-primary:#171a1e;--canvas:#fff;--canvas-muted:#f6f7f8;--surface:#fff;--line-strong:#7b8793;--text-muted:#596571}
*,::before,::after{box-sizing:border-box}
html{font-size:16px}
body{margin:0;background:var(--canvas-muted);color:var(--ink);font-family:'DejaVu Sans',sans-serif}
header.site{height:64px;background:#171a1e;color:#fff;display:flex;align-items:center;padding:0 16px}
main{max-width:72rem;margin:0 auto;padding:16px}
form.purchase-checkout-layout{display:grid;gap:16px}
fieldset{border:1px solid #171a1e24;border-radius:16px;background:var(--surface);padding:16px;margin:0;min-width:0}
legend{font-weight:800;font-size:15px;padding:0 4px}
.mt-3{margin-top:.75rem}.mt-4{margin-top:1rem}.grid{display:grid}.gap-3{gap:.75rem}.mb-1\.5{margin-bottom:.375rem}.block{display:block}
.grid-cols-1{grid-template-columns:minmax(0,1fr)}
@media (min-width:640px){.sm\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.sm\:col-span-2{grid-column:span 2/span 2}}
label.l{display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#596571}
input,select,textarea{width:100%;border:1px solid #7b8793;border-radius:12px;background:#fff;color:var(--ink);padding:10px 12px;font:inherit;font-size:16px;line-height:1.4}
textarea{resize:vertical}
.tap-row{display:flex;gap:10px;min-height:44px;align-items:center;font-size:14px;color:#475569}
.tap-row input{width:20px;height:20px}
button.go{min-height:48px;border-radius:12px;background:#e0561c;color:#171a1e;font-weight:700;border:0;padding:0 16px}
.shop{padding:24px}
`

const COPY = {
  ar: {
    contact: 'بيانات التواصل', address: 'العنوان', name: 'الاسم الكامل', phone: 'رقم الهاتف', gov: 'المحافظة', pick: 'اختر المحافظة',
    area: 'المنطقة', block: 'قطعة', street: 'شارع', building: 'منزل / بناية', floor: 'الدور', flat: 'الشقة', optional: 'اختياري',
    note: 'ملاحظة للتوصيل', notePh: 'علامة مميزة، لون البوابة، أنسب وقت للاتصال…', remember: 'احفظ هذه البيانات على هذا الجهاز',
    next: 'المتابعة إلى الدفع', h1: 'إتمام الشراء', shop: 'المتجر',
  },
  en: {
    contact: 'Contact', address: 'Address', name: 'Full name', phone: 'Mobile number', gov: 'Governorate', pick: 'Choose governorate',
    area: 'Area', block: 'Block', street: 'Street', building: 'House / Building', floor: 'Floor', flat: 'Flat', optional: 'optional',
    note: 'Delivery note', notePh: 'Landmark, gate colour, best time to call…', remember: 'Remember these details on this device',
    next: 'Continue to payment', h1: 'Checkout', shop: 'Shop',
  },
}

// opts: { note, maxlength, themeDark }
export function page(lang, opts = {}) {
  const seedValue = opts.savedRaw !== undefined ? opts.savedRaw : opts.saved ? JSON.stringify(opts.saved) : null
  const seed = seedValue === null ? '' : `<script>try { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem('sporta.delivery', ${JSON.stringify(seedValue)}); } } catch (e) {}</script>`
  const maxlength = opts.maxlength === undefined ? 280 : opts.maxlength
  const dark = opts.themeDark
    ? `:root{--surface:#171a1e;--ink:#f3efe6;--text-muted:#b9c1c9;--line-strong:#8a96a2;--canvas:#0f1114;--canvas-muted:#0f1114}`
    : ''
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout</title>
<style>${TOKENS}${dark}</style></head>
<body><header class="site">SPORTA</header><div id="root"></div>
${seed}
${opts.appAfter ? '<script defer src="/sporta-gov-autopick.js"></script>' : ''}
<script${opts.appAfter ? ' type="module" data-after' : ''}>
var COPY = ${JSON.stringify(COPY)};
var STORE_KEY = 'sporta.delivery', REMEMBER_KEY = 'sporta.delivery.remember';
var FIELDS = ['name', 'phone', 'governorate', 'area', 'block', 'street', 'building', 'floor', 'flat'];
function loadSaved() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { return {}; } }
var saved = loadSaved();
var state = { note: ${JSON.stringify(opts.note || '')} || (typeof saved.note === 'string' ? saved.note : '') };
FIELDS.forEach(function (k) { state[k] = typeof saved[k] === 'string' ? saved[k] : ''; });
var quickMode = FIELDS.slice(0, 7).every(function (k) { return state[k].trim() !== ''; });
window.__state = state; window.__submits = 0; window.__renders = 0;
var MAXLEN = ${maxlength === null ? 'null' : maxlength};
function L() { return COPY[document.documentElement.lang] || COPY.en; }

function field(id, label, inner, cls, optional) {
  var d = document.createElement('div');
  d.className = 'purchase-field' + (cls ? ' ' + cls : '');
  d.innerHTML = '<label for="f-' + id + '" class="mb-1.5 block text-xs font-bold text-slate-600 l"><span data-t="' + id + '"></span>' +
    (optional ? '<span class="ms-1.5 font-medium text-slate-600" style="margin-inline-start:6px;font-weight:500" data-t="optional"></span>' : '') + '</label>' + inner;
  return d;
}
function noteWrapper() {
  var w = field('note', 'note',
    '<textarea id="f-note" name="note" rows="2" ' + (MAXLEN === null ? '' : 'maxlength="' + MAXLEN + '" ') + 'autocomplete="off" enterkeyhint="done" class="w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition focus:ring-2 border-slate-200 resize-y"></textarea>',
    'sm:col-span-2', true);
  var ta = w.querySelector('textarea');
  ta.value = state.note;
  // React's value tracker: it replaces the node's own "value" property so that every assignment made THROUGH THE
  // NODE (ta.value = x, which is what React itself does when it renders) is remembered, and an input event only
  // becomes state when the node's real value differs from what was remembered. A script that assigns ta.value and
  // fires an input event is therefore ignored; one that uses the prototype's native setter is seen. (This is the
  // reason the add-on writes through HTMLTextAreaElement.prototype.)
  var proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  var tracked = proto.get.call(ta);
  Object.defineProperty(ta, 'value', { configurable: true, get: function () { return proto.get.call(ta); }, set: function (v) { tracked = String(v); proto.set.call(ta, v); } });
  ta.addEventListener('input', function () {
    var now = proto.get.call(ta);
    if (now === tracked) return;
    tracked = now; state.note = now; window.__renders++; sync();
  });
  return w;
}
function sync() {   // a controlled render: state wins over the node
  var ta = document.getElementById('f-note');
  if (ta && ta.value !== state.note) ta.value = state.note;
  label();
}
function label() {
  var c = L();
  document.querySelectorAll('[data-t]').forEach(function (n) { var k = n.getAttribute('data-t'); if (c[k] !== undefined && n.textContent !== c[k]) n.textContent = c[k]; });
  var ta = document.getElementById('f-note'); if (ta && ta.placeholder !== c.notePh) ta.placeholder = c.notePh;
}
function gridChildren() {
  var g1 = field('governorate', '', '<select id="f-governorate" name="address-level1"><option value="">' + L().pick + '</option><option value="hawalli">Hawalli</option></select>');
  g1.querySelector('[data-t]').setAttribute('data-t', 'gov');
  var g2 = field('area', '', '<input id="f-area" name="address-level2" maxlength="60" autocomplete="address-level2">');
  g2.querySelector('[data-t]').setAttribute('data-t', 'area');
  var row = document.createElement('div'); row.className = 'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:col-span-2';
  row.appendChild(field('block', '', '<input id="f-block" name="address-line2" maxlength="12" inputmode="numeric">'));
  row.appendChild(field('street', '', '<input id="f-street" name="address-line1" maxlength="40">'));
  row.appendChild(field('building', '', '<input id="f-building" name="address-line3" maxlength="24">'));
  var row2 = document.createElement('div'); row2.className = 'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:col-span-2';
  row2.appendChild(field('floor', '', '<input id="f-floor" name="floor" maxlength="16">', '', true));
  row2.appendChild(field('flat', '', '<input id="f-flat" name="flat" maxlength="16">', '', true));
  return [g1, g2, row, row2, noteWrapper()];
}
function formFromDom() {
  var f = {};
  FIELDS.forEach(function (k) { var e = document.getElementById('f-' + k); f[k] = e ? e.value : state[k]; });
  f.note = state.note;
  return f;
}
// What the storefront's saveDelivery does on "continue": the WHOLE form, note included, as JSON under one key.
window.__save = function (remember) {
  var f = document.getElementById('f-name') ? formFromDom() : (function () { var o = {}; FIELDS.forEach(function (k) { o[k] = state[k]; }); o.note = state.note; return o; })();
  localStorage.setItem(REMEMBER_KEY, remember === false ? '0' : '1');
  if (remember === false) localStorage.removeItem(STORE_KEY); else localStorage.setItem(STORE_KEY, JSON.stringify(f));
  return f;
};
window.__showForm = function () { quickMode = false; route(); };
function quick() {
  var root = document.getElementById('root');
  root.innerHTML = '';
  var main = document.createElement('main'); main.className = 'purchase-flow';
  main.innerHTML = '<h1 data-t="h1"></h1>';
  var form = document.createElement('form'); form.className = 'purchase-quick'; form.noValidate = true;
  form.addEventListener('submit', function (e) { e.preventDefault(); window.__submits++; });
  form.innerHTML = '<p id="quick-name"></p><p id="quick-addr"></p><p id="quick-note"></p><button type="button" id="quick-edit">edit</button>';
  form.querySelector('#quick-name').textContent = state.name;
  form.querySelector('#quick-addr').textContent = state.area + ' ' + state.block + ' ' + state.street + ' ' + state.building;
  form.querySelector('#quick-note').textContent = state.note;
  form.querySelector('#quick-edit').addEventListener('click', window.__showForm);
  main.appendChild(form); root.appendChild(main);
  label();
}
function checkout() {
  if (quickMode) { quick(); return; }
  var root = document.getElementById('root');
  root.innerHTML = '';
  var main = document.createElement('main'); main.className = 'purchase-flow';
  main.innerHTML = '<h1 data-t="h1"></h1>';
  var form = document.createElement('form'); form.className = 'purchase-checkout-layout'; form.noValidate = true;
  form.addEventListener('submit', function (e) { e.preventDefault(); window.__submits++; });
  var f1 = document.createElement('fieldset'); f1.className = 'purchase-panel';
  f1.innerHTML = '<legend data-t="contact"></legend><div class="mt-3 grid gap-3 sm:grid-cols-2"></div>';
  f1.lastChild.appendChild(field('name', '', '<input id="f-name" name="name" autocomplete="name" maxlength="80">'));
  f1.lastChild.lastChild.querySelector('[data-t]').setAttribute('data-t', 'name');
  f1.lastChild.appendChild(field('phone', '', '<input id="f-phone" name="tel" autocomplete="tel-national" inputmode="numeric" maxlength="17">'));
  f1.lastChild.lastChild.querySelector('[data-t]').setAttribute('data-t', 'phone');
  var f2 = document.createElement('fieldset'); f2.className = 'purchase-panel';
  f2.innerHTML = '<legend data-t="address"></legend><div class="mt-3 grid gap-3 sm:grid-cols-2" id="addr-grid"></div>' +
    '<label class="tap-row mt-4 flex cursor-pointer gap-2.5 text-sm text-slate-600"><input type="checkbox" checked><span data-t="remember"></span></label>';
  var grid = f2.querySelector('#addr-grid');
  gridChildren().forEach(function (c) { grid.appendChild(c); });
  var next = document.createElement('button'); next.type = 'submit'; next.className = 'go'; next.setAttribute('data-t', 'next');
  form.appendChild(f1); form.appendChild(f2); form.appendChild(next);
  main.appendChild(form); root.appendChild(main);
  FIELDS.forEach(function (k) { var e = document.getElementById('f-' + k); if (e && state[k]) e.value = state[k]; });
  label();
}
function shop() { document.getElementById('root').innerHTML = '<div class="shop"><h1 data-t="shop"></h1><a id="to-checkout" href="/checkout">checkout</a></div>'; label(); }
function route() { if (location.pathname === '/checkout') checkout(); else shop(); }
window.__go = function (p) { history.pushState({}, '', p); route(); };
window.addEventListener('popstate', route);
window.__lang = function (l) { document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'; label(); };
window.__rerender = function (how) {
  var grid = document.getElementById('addr-grid'); if (!grid) return;
  window.__renders++;
  if (how === 'node') {
    var old = document.getElementById('f-note').parentElement;
    var w = noteWrapper(); grid.replaceChild(w, old); label();
  } else if (how === 'grid') {
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    gridChildren().forEach(function (c) { grid.appendChild(c); }); label();
  }
};
route();
</script>
${opts.appAfter ? '' : '<script defer src="/sporta-gov-autopick.js"></script>'}
</body></html>`
}
