// The live /backends Payments screen, as a fixture: the exact element tree and classes dumped from the
// live page at 390px (scripts/admin-payments-scan.mjs MODE=dom, 2026-11-03), with made-up data. Used by
// admin-payments-test.mjs to prove the section-8 rules of public/sporta-admin-knet.css on the real markup.
//
// The Merchant ID / Terminal ID panel, the Merchant Server IP panel and the "Take KNET payments through
// this CBK setup" card are built by public/sporta-admin-brands.js on the live page; they are reproduced
// here as they come out (the card BEFORE the IP panel, as build() now places it).
const SI = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
const UI = SI.replace('text-sm', 'text-xs')
const LBL = 'payment-secret-field__label flex items-center justify-between gap-3 text-xs font-bold text-slate-600'
const secret = (t, state, name) => `<label class="block"><span class="${LBL}">${t}<span class="payment-secret-field__state text-amber-600">${state}</span></span><input class="${SI}" type="password" placeholder="Enter value from the bank" value="" name="${name}"></label>`
const url = (t, v, hidden) => `<label class="block"${hidden ? ' style="display:none"' : ''}><span class="text-xs font-bold text-slate-600">${t}</span><input class="${UI}" type="url" value="${v}"></label>`
const ident = (t, state, hide) => `<label class="block"><span class="${LBL}">${t}<span class="payment-secret-field__state"${hide ? ' style="display:none"' : ''}>${state}</span></span><input class="${SI}" type="text" placeholder="Not set"></label>`
const check = (l, s, c) => `<li class="payment-gateway-card__check flex items-center justify-between gap-4 py-3 text-sm"><span class="payment-gateway-card__check-label text-slate-600">${l}</span><span class="payment-gateway-card__check-status font-bold ${c}">${s}</span></li>`
const logo = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"><rect width="120" height="48" rx="6" fill="#0b6fa4"/><text x="60" y="31" font-size="22" font-family="Arial" font-weight="700" fill="#fff" text-anchor="middle">KNET</text></svg>')
const card = (name, sub, mode, host, checks, withLogo) => `<section class="payment-gateway-card rounded-2xl border border-slate-200 bg-white p-5 md:p-6"><div class="payment-gateway-card__head flex flex-wrap items-start justify-between gap-3"><div class="payment-gateway-card__identity flex min-w-0 items-center gap-3">${withLogo ? `<span class="payment-gateway-card__brand inline-flex h-12 w-[4.4rem] shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5"><img class="block max-w-full object-contain h-full w-auto" src="${logo}" alt=""></span>` : ''}<div class="min-w-0"><h2 class="text-lg font-bold text-slate-900">${name}</h2><p class="mt-1 text-sm text-slate-500">${sub}</p></div></div><span class="payment-gateway-card__status rounded-full px-3 py-1 text-xs font-bold bg-amber-100 text-amber-800">Needs attention</span></div><dl class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2"><div class="rounded-xl bg-slate-50 p-3"><dt class="text-xs font-semibold uppercase tracking-wide text-slate-400">Mode</dt><dd class="mt-1 font-bold text-slate-800">${mode}</dd></div><div class="min-w-0 rounded-xl bg-slate-50 p-3"><dt class="text-xs font-semibold uppercase tracking-wide text-slate-400">Gateway</dt><dd class="mt-1 truncate font-mono text-sm font-semibold text-slate-700">${host}</dd></div></dl><ul class="payment-gateway-card__checks mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 px-3">${checks}</ul></section>`
const OK = 'text-orange-700', FIX = 'text-rose-700'
const saveRow = (t, p, top) => `<div class="mt-5 flex flex-col items-stretch gap-3 ${top ? 'border-t border-slate-100 pt-4 ' : ''}sm:flex-row sm:items-center sm:justify-between">${p}<button type="button" class="min-h-11 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 sm:w-auto">${t}</button></div>`
const BODY = `<div class="admin-shell"><main class="admin-content flex-1"><section class="admin-page"><div class="payment-settings admin-page-layout admin-page-layout--form space-y-6">
<header class="admin-page-header flex flex-wrap items-start justify-between gap-3"><div><h1 class="text-2xl font-bold text-slate-900">Payments</h1><p class="mt-1 text-sm text-slate-500">Check gateway readiness and settings.</p></div><button type="button" class="min-h-11 w-full rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 sm:w-auto">Check again</button></header>
<div class="grid gap-5 lg:grid-cols-2">
${card('KNET', 'Kuwait debit-card payment', 'Test', 'kpaytest.com.kw', check('Merchant ID and password', 'Fix', FIX) + check('16-byte terminal resource key', 'Fix', FIX) + check('Secure Sporta return URLs', 'OK', OK) + check('Connected to the shop orders database', 'OK', OK) + check('Valid test or production mode', 'OK', OK), true)}
${card('T-Pay', 'CBK hosted payment gateway', 'Test', 'pgtest.cbk.com', check('Merchant ID and password', 'Fix', FIX) + check('Encrypted account key', 'Fix', FIX) + check('Secure Sporta return URLs', 'OK', OK) + check('Connected to the shop orders database', 'OK', OK) + check('Valid test or production mode', 'OK', OK), false)}
</div>
<div class="grid gap-5 xl:grid-cols-2">
<form class="payment-gateway-editor rounded-2xl border border-slate-200 bg-white p-5 md:p-6"><div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><h2 class="text-lg font-bold text-slate-900">KNET editor</h2><p class="mt-1 text-sm text-slate-500">Replace credentials or switch the active environment.</p></div><div class="inline-flex w-full rounded-xl border border-slate-300 bg-slate-100 p-1 sm:w-auto"><button type="button" class="min-h-11 flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition sm:flex-none bg-indigo-600 text-white shadow-sm">Test</button><button type="button" class="min-h-11 flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition sm:flex-none text-slate-500 hover:bg-white">Production</button></div></div>
<div class="payment-knet-toggle-row mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 border-slate-200 bg-slate-50"><div class="payment-knet-toggle-copy"><p class="text-sm font-bold text-slate-900">KNET at checkout</p><p class="mt-0.5 text-xs text-slate-500">Switch off to hide KNET from customers and reject new KNET checkout requests.</p></div><button type="button" role="switch" aria-checked="false" class="relative h-11 w-16 shrink-0 rounded-full transition focus:outline-none focus:ring-4 focus:ring-orange-200 disabled:opacity-50 bg-slate-300"><span class="absolute top-2 h-7 w-7 rounded-full bg-white shadow transition-all start-2"></span><span class="sr-only">Switch KNET on</span></button><span class="w-full text-xs font-bold text-slate-500">KNET is switched off</span></div>
<div class="mt-5 grid gap-4 md:grid-cols-2"><p class="md:col-span-2 rounded-xl border p-3 text-sm font-semibold border-indigo-200 bg-indigo-50 text-indigo-800">Test mode uses the KNET test gateway and its separate test credential set.</p>
${secret('Test Tranportal ID', 'Required', 'a')}${secret('Test Tranportal password', 'Required', 'b')}
<div class="md:col-span-2"><label class="block"><span class="${LBL}">Test Terminal Resource Key<span class="payment-secret-field__state text-amber-600">Required</span></span><input class="${SI}" type="password" placeholder="Enter value from the bank" value="" name="c"><span class="mt-1 block text-xs text-slate-400">Exactly 16 bytes. Test and Production use different keys. Spaces and copied line breaks are not accepted.</span></label></div>
${url('Test gateway URL', 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm')}${url('Production gateway URL', 'https://www.kpay.com.kw/kpg/PaymentHTTP.htm')}${url('Response URL', 'https://www.sporta.com.kw/knet/callback.php')}${url('Error URL', 'https://www.sporta.com.kw/knet/callback.php')}<div class="md:col-span-2">${url('Customer result page', 'https://www.sporta.com.kw/payment-result')}</div></div>
<div class="mt-5 border-t border-slate-100 pt-4" data-sporta-knet-ids="1"><p class="text-sm font-bold text-slate-900">Merchant ID and Terminal ID</p><p class="mt-0.5 text-xs text-slate-500">Identifiers from the bank, kept with this configuration. KNET takes payment with the Tranportal ID and password above; these are for your records and the bank's paperwork.</p><div class="mt-5 grid gap-4 md:grid-cols-2">${ident('Test Merchant ID', 'Active')}${ident('Test Terminal ID', 'Active')}${ident('Production Merchant ID', 'Active', true)}${ident('Production Terminal ID', 'Active', true)}</div>${saveRow('Save IDs', '<p class="text-xs text-slate-500"></p>', false)}</div>
${saveRow('Save KNET', '<p class="text-xs text-slate-500">Blank secret fields keep the saved value.</p>', true)}</form>
<form class="payment-gateway-editor rounded-2xl border border-slate-200 bg-white p-5 md:p-6"><div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><h2 class="text-lg font-bold text-slate-900">T-Pay editor</h2><p class="mt-1 text-sm text-slate-500">Replace credentials or switch the active environment.</p></div><select class="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold sm:w-auto"><option>Test mode</option><option>Production mode</option></select></div>
<div class="mt-5 grid gap-4 md:grid-cols-2">${secret('Merchant API ID (ClientId)', 'Required', 'd')}${secret('Merchant API Password (ClientSecret)', 'Required', 'e')}
<div class="md:col-span-2"><label class="block"><span class="${LBL}">Merchant Encrypted Account Key (ENCRP_KEY)<span class="payment-secret-field__state text-amber-600">Required</span></span><input class="${SI}" type="password" placeholder="Enter value from the bank" value="" name="f"><span class="mt-1 block text-xs text-slate-400">Stored exactly as issued by CBK. This is not the 16-byte KNET key.</span></label></div>
${url('Test API base', 'https://pgtest.cbk.com')}${url('Production API base', 'https://pg.cbk.com')}${url('Merchant return URL', 'https://www.sporta.com.kw/pay/callback.php')}${url('Customer result page', 'https://www.sporta.com.kw/payment-result')}
<p class="md:col-span-2 rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-800"><strong>Merchant Server IP 1 and 2:</strong> register the hosting server IPs with CBK during onboarding. They are allowlist values and are not secret.</p></div>
<label class="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 border-slate-200 bg-slate-50"><div class="min-w-0" style="flex:1 1 16rem"><p class="text-sm font-bold text-slate-900">Take KNET payments through this CBK setup</p><p class="mt-0.5 text-xs text-slate-500">One setup for both: KNET and T-Pay use the same Client ID, Client Secret and Encrypted Account Key.</p><p class="mt-0.5 text-xs"></p></div><input type="checkbox" style="width:1.5rem;height:1.5rem;flex:none;accent-color:var(--admin-action,#9a452c);cursor:pointer"></label>
<div class="mt-5 border-t border-slate-100 pt-4" data-sporta-tpay-ips="1"><p class="text-sm font-bold text-slate-900">Merchant Server IP 1 and 2</p><p class="mt-0.5 text-xs text-slate-500">The server addresses registered with CBK during onboarding. They are an allowlist, not secrets.</p><div class="mt-5 grid gap-4 md:grid-cols-2"><label class="block"><span class="${LBL}">Merchant Server IP 1</span><input class="${SI}" type="text" placeholder="Not set"></label><label class="block"><span class="${LBL}">Merchant Server IP 2</span><input class="${SI}" type="text" placeholder="Not set"></label></div>${saveRow('Save IPs', '<p class="text-xs text-slate-500"></p>', false)}</div>

${saveRow('Save T-Pay', '<p class="text-xs text-slate-500">Blank secret fields keep the saved value.</p>', true)}</form>
</div></div></section></main></div>`


export const BODY_HTML = BODY

// The live build's own unlayered rules that matter here, as measured (the base is the one admin-polish-test
// uses), plus what the Payments screen needs from it.
export const LIVE = `
html { font-size: 16px; font-family: system-ui, sans-serif; }
.admin-shell { --admin-action: #9a452c; --brand-deep: #9a452c; color: #18212a; }
/* The build's LIGHT custom properties on .admin-shell, as measured on the live page (2026-11-03, probe job in
   a read-only container: getComputedStyle of .admin-shell with the device and the stored theme both light). In dark
   the build redefines every one of them; the Light only section of the add-on puts these back. */
.admin-shell { --admin-bg: #f3f5f7; --admin-surface: #fff; --admin-surface-soft: #f7f8fa; --admin-border: #d9dfe5; --admin-border-strong: #aeb8c2;
  --admin-text: #18212a; --admin-muted: #65717d; --admin-accent-soft: #f8ece6; --admin-accent-border: #d8a38b;
  --admin-focus: color-mix(in srgb, #e0561c 16%, transparent); --admin-shadow: 0 1px 2px #0f172a0a, 0 10px 28px #0f172a09; }
/* The live LIGHT mappings the fixture lacked: the build paints the indigo utilities and orange-700 with the accent
   terracotta. Measured: text-orange-700 rgb(154,69,44); the mode note (bg-indigo-50, border-indigo-200, text-indigo-800)
   rgb(248,236,230) / rgb(216,163,139) / rgb(184,67,15); the admin-wide error notice rgb(141,36,53) on rgb(255,240,242)
   with an edge of rgb(233,160,169). Without them the fixture's light state is raw Tailwind, a light that does not exist. */
.text-orange-700 { color: #9a452c; }
.text-indigo-700 { color: #9a452c; }
.text-indigo-800 { color: #b8430f; }
.admin-shell .bg-indigo-50 { background-color: var(--admin-accent-soft); }
.admin-shell .border-indigo-200 { border-color: var(--admin-accent-border); } /* a base rule that reads the custom property, as the build's does */
/* Measured on the live page, theme light: the headings of the screen (h1 'Payments', every h2) are the ink rgb(24,33,42) = --admin-text,
   whatever text-slate-* class they carry: the build's non-!important ".admin-page h1, h2, h3 { color: var(--admin-text) }" outranks the utility. A
   class-less control (the CBK card's checkbox) is white: the build's base field rule. */
.admin-shell .admin-page :is(h1, h2, h3) { color: var(--admin-text); }
.admin-shell .admin-page :where(input, select, textarea) { background-color: var(--admin-surface); }
.admin-notice { border: 1px solid; }
.admin-notice--error { color: #8d2435; background-color: #fff0f2; border-color: #e9a0a9; }
.admin-shell button, .admin-shell input, .admin-shell select, .admin-shell textarea { font-weight: inherit; font-size: inherit; }
.admin-shell .bg-indigo-600 { background-color: var(--admin-action) !important; color: #fff !important; }
.admin-shell .text-indigo-600 { color: var(--brand-deep) !important; }
.admin-shell .admin-page :where(button, .btn) { border-radius: .7rem; }
.admin-content { padding: 14px 16px; }
.admin-page-layout { display: grid; gap: 1rem; }
.admin-page-header { display: flex; flex-direction: column; gap: .7rem; }
@media (min-width: 640px) { .admin-page-header { flex-direction: row; } }
.payment-gateway-card__head { display: grid; gap: .75rem; }
@media (min-width: 640px) { .payment-gateway-card__head { display: flex; } }
.payment-gateway-card__status { justify-self: start; }
.payment-knet-toggle-copy { flex: 1 1 9rem; min-width: 0; }
@media (max-width: 767px) { .admin-shell button { min-height: 44px; } }
/* Stand-in for a control floor measured on the live screen at 1280px: a checkbox came out 25x46. */
@media (min-width: 768px) { .admin-shell input { min-height: 2.75rem; } }
`