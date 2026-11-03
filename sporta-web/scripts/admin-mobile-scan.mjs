// READ-ONLY look at the LIVE /backends admin on a phone and a small tablet, in light and dark, every screen.
//
//   VW=390 VH=844 SCHEME=light node scripts/admin-mobile-scan.mjs        (SCHEME=dark for the dark pass)
//   VW=768 VH=1024 SCHEME=dark ONLY=Orders,CRM NOFOCUS=1 node scripts/admin-mobile-scan.mjs
//   BASEURL=<origin> LOC=ar-KW QS=?lang=en CHROMIUM_PATH=/usr/bin/google-chrome  (optional)
//
// Run it ON the VPS in the Playwright image (mcr.microsoft.com/playwright:v1.49.0-noble, npm i playwright@1.49.0):
// the sandbox cannot reach www.sporta.com.kw. Every /api/admin call is answered in the browser with made-up data
// (long Arabic and English names, a 70-character unbroken token and an 82-character e-mail are in it on purpose),
// every non-GET request to the site is answered locally, nothing is typed into a form and nothing signs in.
//
// Per screen (and per screen's first Edit / Add / View form) it measures: sideways overflow (the leaf-most
// element past the edge), content cut off by an overflow:hidden parent, ellipsis/line-clamp truncation (and
// whether a title says the rest), controls under 44x44, text under 12px, contrast of every text run (canvas
// colour parse, so lab()/oklch() work), field gutters / 16px iOS zoom / edge contrast, every table's scroll
// box (scrolls? first column sticky? actions reachable? hint?), fixed and sticky layers, what a fixed bar hides
// at the end of the page, a modal taller than the screen, and (dark) every surface that stayed light.
// Light pass only: the bottom-sheet menu (role, focus, Tab trap, Escape, tap outside, last tile reachable)
// and, on every screen, a 16-press Tab walk that checks the focus indicator and whether the focused control
// is under a fixed bar or off screen. Output is grouped, so a 19-screen run is a few dozen lines.
//
// The live admin is a compiled build with no source here: the fixes this finds are add-on CSS in
// public/sporta-admin-knet.css (colours inside the colour-scheme media query, npm run test:admin-dark) or
// copy / markup the owner has to decide. The shell it expects: header.m-header, nav.m-tabbar, a
// .m-menu-layer > .m-menu-panel bottom sheet, main.admin-content (measured 2026-11-03).
//
// The file is 47 KB of one-line-per-statement JavaScript with no double quote or backslash in it on
// purpose: the Hostinger compose API takes at most 8192 characters per project, so it is staged in seven
// parts through a bind mount and cat-ed together on the server. Keep it that way when editing.
import { chromium } from 'playwright'
const B = process.env.BASEURL || 'https://www.sporta.com.kw'
const VW = +(process.env.VW || 390), VH = +(process.env.VH || 844), SCHEME = process.env.SCHEME || 'light'
const LOC = process.env.LOC || 'en-US', QS = process.env.QS || ''
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const NOFOCUS = process.env.NOFOCUS === '1'
const phone = VW < 600
const MG = String.fromCharCode(9776), XG = String.fromCharCode(10005) + '|' + String.fromCharCode(215)
const RE_OPEN = new RegExp('Open menu|' + MG + '|Menu'), RE_CLOSE = new RegExp('Close menu|' + XG)
const pub = async (r) => { try { return await (await fetch(B + '/api/api.php?r=' + r)).json() } catch (e) { return [] } }
const [products, brands, stock, theme] = await Promise.all([pub('products'), pub('brands'), pub('stock'), pub('theme')])
const P = Array.isArray(products) ? products : []
const W = [[1587,1576,1608,1585,1578,1575],[1605,1604,1575,1576,1587],[1585,1610,1575,1590,1610,1577],[1601,1575,1582,1585,1577],[1593,1605,1610,1604],[1578,1580,1585,1610,1576,1610]].map((c) => String.fromCharCode(...c))
const arL = (n) => Array.from({ length: n }, (_, i) => W[i % W.length]).join(' ')
const enL = 'Premium compression training tights with moisture control, reflective details and a zipped key pocket'
const TOK = 'SPORTA-ULTRA-TRAIL-RUNNING-JACKET-WATERPROOF-XL-BLACK-ORANGE-0123456789'
const EM = 'a.very.long.customer.name.with.dots.1234567890@a-long-subdomain.example-domain.com'
const day = (n) => '2026-10-' + String(30 - n).padStart(2, '0') + ' 1' + (n % 10) + ':2' + (n % 6) + ':00'
const AREAS = ['Salmiya', 'Hawalli', 'Jabriya', 'Mishref', 'Kuwait City', 'Fahaheel']
const NAMES = ['Test Customer A', arL(9), 'Averyveryveryverylongcustomernamewithoutanyspacesatalltogether', 'Test Customer C', 'Sample Buyer', arL(2)]
const PAY = [['paid', 'knet'], ['pending', 'cod'], ['failed', 'knet'], ['paid', 'tpay'], ['pending', 'knet'], ['paid', 'cod']]
const FUL = ['unfulfilled', 'packed', 'shipped', 'delivered', 'cancelled']
const orders = Array.from({ length: 14 }, (_, i) => ({ id: 900 + i, track_id: 'SPTEST' + String(1000 + i), amount: 5 + i, subtotal: 4 + i, discount_amount: i % 4 === 0 ? 1 : 0,
discount_code: i % 4 === 0 ? 'WELCOME' : null, delivery_fee: 1, payment_status: PAY[i % 6][0], payment_method: PAY[i % 6][1], fulfilment_status: FUL[i % 5],
paid_at: PAY[i % 6][0] === 'paid' ? day(i) : null, created_at: day(i), customer_name: NAMES[i % 6], customer_phone: '9650000' + String(1000 + i),
customer_area: i === 1 ? arL(4) : AREAS[i % 6], customer_note: i % 3 ? null : (i === 3 ? enL + ' ' + arL(8) : 'Call before arriving'),
customer_governorate: 'hawalli', customer_block: '1', customer_street: '2', customer_building: '3', customer_floor: null, customer_flat: null,
cbk_paymentid: null, cbk_reference: null, cbk_status: null, utm_source: i % 2 ? 'instagram' : null, utm_medium: null, utm_campaign: null, referrer_host: null }))
const productsAll = P.map((p, i) => ({ id: i + 1, slug: p.slug, name_en: i === 1 ? enL : (i === 2 ? TOK : p.name_en), name_ar: i === 1 ? arL(9) : p.name_ar, desc_en: p.desc_en || '', desc_ar: p.desc_ar || '',
price: Number(p.price || 0).toFixed(3), sale_price: p.on_sale ? Number(p.price).toFixed(3) : null, sale_starts_at: null, sale_ends_at: null,
featured: p.featured ? 1 : 0, featured_sort: p.featured_sort || 0, category: p.category, brand_slug: p.brand_slug || null, image: p.image || null, images: p.images || null, active: i % 9 === 8 ? 0 : 1 }))
const S = Array.isArray(stock) ? stock : []
const variants = S.slice(0, 60).map((v, i) => { const p = P.find((x) => x.slug === v.slug) || {}
return { sku: i === 1 ? TOK : (v.sku || 'SKU-' + i), slug: v.slug, name_en: i === 1 ? enL : (p.name_en || v.slug), name_ar: i === 1 ? arL(9) : (p.name_ar || ''), category: p.category || 'men', price: Number(p.price || 9),
size: v.size, stock: v.stock ?? 5, cost_aed: 40, unit_cost_kwd: 3.35, low_stock_threshold: 2, inventory_version: 10 + i, sold_qty: i % 4, received_qty: 10, returned_qty: 0, damaged_qty: 0 } })
const logo = {}
for (const b of Array.isArray(brands) ? brands : []) { if (!+b.has_logo) continue
try { const r = await fetch(B + '/api/api.php?r=brand_logo&slug=' + b.slug + '&v=' + b.logo_v); logo[b.slug] = 'data:' + r.headers.get('content-type') + ';base64,' + Buffer.from(await r.arrayBuffer()).toString('base64') } catch (e) {} }
const MOCK = {
me: { email: 'owner@example.com' }, google_available: { available: false },
stats: { paid_count: 6, paid_revenue: '61.000', pending_count: 5, review_count: 1, failed_count: 2, unfulfilled_count: 3, paid_today: 1, revenue_today: '9.000', paid_7d: 4, revenue_7d: '38.000', cod_awaiting_count: 2, cod_awaiting_amount: '13.000' },
revenue: Array.from({ length: 14 }, (_, i) => ({ day: '2026-10-' + String(17 + i).padStart(2, '0'), revenue: String(5 + (i * 7) % 23) })),
products_state: P.map((p) => ({ slug: p.slug, price: Number(p.price || 0).toFixed(3), active: 1 })), products_all: productsAll, orders, variants,
brands: (Array.isArray(brands) ? brands : []).map((b, i) => ({ id: i + 1, slug: b.slug, name_en: b.name_en, name_ar: b.name_ar, logo: logo[b.slug] || null, active: 1, sort: i, products: P.filter((p) => p.brand_slug === b.slug).length, products_active: P.filter((p) => p.brand_slug === b.slug).length })),
brand_products: productsAll.map((p) => ({ slug: p.slug, name_en: p.name_en, name_ar: p.name_ar, brand_slug: p.brand_slug, active: p.active, category: p.category })),
discounts: [{ id: 1, code: 'WELCOME', kind: 'percent', value: 10, min_subtotal: 0, auto: 0, active: 1, single_use: 0, uses: 4, max_uses: null, starts_at: null, ends_at: null, label_en: 'Welcome 10%', label_ar: arL(4) },
{ id: 2, code: null, kind: 'fixed', value: 2, min_subtotal: 20, auto: 1, active: 0, single_use: 0, uses: 0, max_uses: null, starts_at: null, ends_at: null, label_en: '2 KWD off 20+', label_ar: arL(3) }],
slides: { slides: [], hero: { speed_ms: 6500, shuffle: false, size: 'tall', autoplay: true } },
checkout_settings: { delivery_fee: 1, methods: ['knet', 'tpay', 'cod'], default_method: 'knet', notice_en: '', notice_ar: '' },
theme_settings: theme && !Array.isArray(theme) && theme.brand ? theme : { brand: '#c76a42', accent: '#99452b', canvas: '#ffffff', radius: '16', dark: false, fonts: { body_en: 'plex', display_en: 'alexandria', body_ar: 'plex', display_ar: 'alexandria' } },
topbar_settings: { enabled: true, text_en: 'Delivery within 24 hours in Kuwait', text_ar: arL(6), href: '/shop', starts_at: null, ends_at: null, tone: 'brand', show_dot: true, alignment: 'center' },
seo_settings: { pages: Object.fromEntries(['/', '/shop', '/about', '/contact', '/returns', '/terms', '/privacy'].map((p) => [p, { title_en: '', title_ar: '', description_en: '', description_ar: '', image: '' }])) },
return_requests: { requests: Array.from({ length: 6 }, (_, i) => ({ id: 70 + i, reference: 'RR' + String(260000 + i), status: ['requested', 'approved', 'pickup_scheduled', 'received', 'completed', 'declined'][i], eligibility: i % 3 ? 'eligible' : 'review',
created_at: day(i), updated_at: day(i), track_id: 'SPTEST' + (1000 + i), customer_name: NAMES[i % 6], customer_phone: '9650000' + (1000 + i), payment_method: PAY[i % 6][1], fulfilment_status: 'delivered' })), page: 1, has_more: false, total: 6 },
support_list: { tickets: Array.from({ length: 6 }, (_, i) => ({ id: 40 + i, reference: 'ST' + String(510000 + i), customer_name: NAMES[i % 6], customer_email: i === 1 ? EM : 'customer' + i + '@example.com', customer_phone: '9650000' + (1000 + i),
order_track_id: i % 2 ? 'SPTEST' + (1000 + i) : null, subject: ['Where is my order?', enL + ' - ' + arL(8), 'Payment question', 'Wrong colour delivered', arL(7), 'Invoice copy'][i],
status: ['open', 'pending', 'resolved', 'open', 'closed', 'pending'][i], priority: ['urgent', 'high', 'normal', 'normal', 'low', 'normal'][i], assigned_to: i % 3 ? null : 'owner@example.com',
last_customer_at: day(i), last_staff_at: i % 2 ? day(i) : null, created_at: day(i), updated_at: day(i) })) },
crm_list: { contacts: NAMES.map((n, i) => ({ key: 'phone:9650000' + (1000 + i), source: 'phone', name: n, display_name: '', phone: '9650000' + (1000 + i), email: i === 1 ? EM : '', order_count: 1 + i, order_total: 9 * (1 + i), paid_total: 9 * i,
open_cod_count: i % 2, open_cod_total: (i % 2) * 9, last_order_at: day(i), last_area: AREAS[i], last_track_id: 'SPTEST' + (1000 + i), status: ['new', 'contacted', 'vip'][i % 3], tags: i % 2 ? ['vip'] : [], follow_up_at: null, note_count: i % 3, updated_at: null, updated_by: null })) },
profiles_list: { profiles: Array.from({ length: 6 }, (_, i) => ({ id: 300 + i, name: NAMES[i % 6], email: i === 1 ? EM : 'customer' + i + '@example.com', phone: '9650000' + (1000 + i), created_at: day(i + 3), last_login_at: day(i), order_count: i, paid_total: 9.5 * i, last_order_at: i ? day(i) : null })), page: 1, has_more: false },
activity_log: { events: Array.from({ length: 12 }, (_, i) => ({ id: 500 - i, actor_email: i === 1 ? EM : 'owner@example.com', action_key: ['login', 'product_save', 'brand_save', 'settings_save'][i % 4], created_at: day(i) })), page: 1, has_more: false },
inventory_movements: variants.slice(0, 8).map((v, i) => ({ id: 20 - i, sku: v.sku, type: ['receive', 'sale', 'adjust'][i % 3], before_stock: 10, after_stock: 9, delta: -1, before_unit_cost_kwd: 3.35, after_unit_cost_kwd: 3.35, before_low_stock_threshold: 2, after_low_stock_threshold: 2, inventory_version: 5, note: 'Scan sample', actor_admin_id: null, actor_email: 'owner@example.com', created_at: day(i) })),
inventory_finance: { delivery_expense: 0, ads_expense: 0, fixed_expense: 0, variable_expense: 0, returns_expense: 0, damage_expense: 0 },
blocked: [], font_list: [], mfa_status: { enabled: false }, google_status: { configured: false, linked: false },
payment_config: { knet: { installed: true, enabled: true, env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://www.kpay.com.kw/kpg/PaymentHTTP.htm', response_url: B + '/knet/callback.php', error_url: B + '/knet/callback.php', result_page_url: B + '/payment-result', has_tranportal_id: false, has_tranportal_password: false, has_resource_key: false, credentials: { test: { has_tranportal_id: false, has_tranportal_password: false, has_resource_key: false }, production: { has_tranportal_id: false, has_tranportal_password: false, has_resource_key: false } } },
tpay: { installed: true, env: 'test', test_base: 'https://pgtest.cbk.com', production_base: 'https://pg.cbk.com', return_url: B + '/pay/callback.php', result_page_url: B + '/payment-result', has_client_id: false, has_client_secret: false, has_encrp_key: false } },
payment_identifiers: { env: 'test', test: { merchant_id: '', terminal_id: '' }, production: { merchant_id: '', terminal_id: '' } }, payment_server_ips: { server_ip_1: '', server_ip_2: '' }, payment_knet_via_cbk: { enabled: false, tpay_ready: false },
}
function COLLECT(o) {
const iw = innerWidth, ih = innerHeight, dark = o.dark
const out = { dw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, iw, ih, dh: document.documentElement.scrollHeight, over: [], clip: [], trunc: [], tgt: [], tiny: [], con: [], fld: [], tbl: [], fix: [], light: [], edge: [] }
const cs = new Map(), S = (e) => { let c = cs.get(e); if (!c) { c = getComputedStyle(e); cs.set(e, c) } return c }
const cv = document.createElement('canvas'); cv.width = cv.height = 1
const cx = cv.getContext('2d', { willReadFrequently: true }), memo = new Map()
const rgba = (c) => { if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return [0, 0, 0, 0]; if (memo.has(c)) return memo.get(c)
cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data, v = [d[0], d[1], d[2], d[3] / 255]; memo.set(c, v); return v }
const lum = (p) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]) }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const stops = (img) => (img.match(/(?:rgba?|oklch|oklab|lab|hsla?|color)[(][^()]*(?:[(][^()]*[)][^()]*)*[)]|#[0-9a-f]{3,8}(?![0-9a-f])/gi) || []).map(rgba).filter((c) => c[3] > 0.5)
const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = S(e); const g = c.backgroundImage && c.backgroundImage.indexOf('gradient') >= 0 ? stops(c.backgroundImage) : []
if (g.length) return [0, 1, 2].map((i) => Math.round(g.reduce((a, x) => a + x[i], 0) / g.length)); const p = rgba(c.backgroundColor); if (p[3] > 0.85) return p.slice(0, 3) } return dark ? [13, 18, 23] : [255, 255, 255] }
const blend = (c, bg) => (c[3] < 1 ? [0, 1, 2].map((i) => Math.round(c[i] * c[3] + bg[i] * (1 - c[3]))) : c.slice(0, 3))
const hex = (p) => '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const kl = (e) => String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).trim().split(' ').filter(Boolean).slice(0, 4).join('.')
const sig = (e) => e.tagName.toLowerCase() + (kl(e) ? '.' + kl(e) : '')
const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let a = e; a && a !== document.documentElement; a = a.parentElement) { const c = S(a); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return false } return true }
const hid = (e) => !!e.closest('[aria-hidden=true], [inert]')
const svgIn = (e) => e instanceof SVGElement && e.tagName.toLowerCase() !== 'svg'
const txt = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim().replace(/ +/g, ' ')
const inFixed = (e) => { for (let a = e; a && a !== document.body; a = a.parentElement) if (S(a).position === 'fixed') return true; return false }
const inView = (r) => r.right > 0 && r.left < iw && r.bottom > 0 && r.top < ih
const all = [...document.body.querySelectorAll('*')].filter((e) => !svgIn(e) && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION'].includes(e.tagName))
const live = all.filter((e) => vis(e))
const clipper = (e, r) => { for (let a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) { const c = S(a)
if (c.overflowX !== 'visible') { const ar = a.getBoundingClientRect(); if (r.right > ar.right + 1.5 || r.left < ar.left - 1.5) return { a, k: c.overflowX } } } return null }
const ov = []
for (const e of live) { if (inFixed(e)) continue; const r = e.getBoundingClientRect(); if (r.right <= iw + 1 && r.left >= -1) { const k = clipper(e, r)
if (k && (k.k === 'hidden' || k.k === 'clip') && (txt(e) || e.matches('button,a,input,select,textarea,img'))) out.clip.push({ s: sig(e), t: (txt(e) || e.getAttribute('aria-label') || '').slice(0, 30), by: sig(k.a), w: Math.round(r.width), aw: Math.round(k.a.getBoundingClientRect().width) })
continue }
const k = clipper(e, r)
if (k) { if ((k.k === 'hidden' || k.k === 'clip') && (txt(e) || e.matches('button,a,input,select,textarea,img'))) out.clip.push({ s: sig(e), t: (txt(e) || e.getAttribute('aria-label') || '').slice(0, 30), by: sig(k.a), w: Math.round(r.width), aw: Math.round(k.a.getBoundingClientRect().width) }); continue }
ov.push({ e, r }) }
for (const x of ov.slice(0, 80)) if (!ov.some((y) => y.e !== x.e && x.e.contains(y.e))) out.over.push({ s: sig(x.e), l: Math.round(x.r.left), r: Math.round(x.r.right), w: Math.round(x.r.width), t: (txt(x.e) || '').slice(0, 30) })
out.over = out.over.slice(0, 6); out.clip = out.clip.slice(0, 8)
for (const e of live) { const t = txt(e); if (t.length < 3) continue; const c = S(e)
if ((c.overflowX === 'hidden' || c.overflowX === 'clip' || c.textOverflow === 'ellipsis') && c.display !== 'inline' && e.scrollWidth > e.clientWidth + 1) out.trunc.push({ s: sig(e), t: t.slice(0, 34), w: e.clientWidth, sw: e.scrollWidth, ti: !!(e.title || e.getAttribute('aria-label')), k: c.textOverflow === 'ellipsis' ? 'ellipsis' : 'hidden' })
else if (c.webkitLineClamp && c.webkitLineClamp !== 'none' && e.scrollHeight > e.clientHeight + 1) out.trunc.push({ s: sig(e), t: t.slice(0, 34), w: e.clientWidth, sw: e.scrollWidth, ti: !!e.title, k: 'clamp' + c.webkitLineClamp }) }
out.trunc = out.trunc.slice(0, 12)
const tsel = 'button, a[href], [role=button], [role=tab], [role=menuitem], [role=switch], select, textarea, summary, input:not([type=hidden])'
for (const e of document.body.querySelectorAll(tsel)) { if (!vis(e) || hid(e)) continue; let t = e
if (e.matches('input[type=checkbox], input[type=radio], input[type=file]')) { const l = e.closest('label') || (e.id && document.querySelector('label[for=' + CSS.escape(e.id) + ']')); if (l) t = l }
const r = t.getBoundingClientRect(); if (r.width >= 44 && r.height >= 44) continue
const inline = e.tagName === 'A' && S(e).display === 'inline' && e.parentElement && e.parentElement.textContent.trim().length > e.textContent.trim().length + 8
out.tgt.push({ s: sig(t), w: Math.round(r.width), h: Math.round(r.height), t: (t.textContent || t.getAttribute('aria-label') || t.getAttribute('placeholder') || t.type || '').trim().replace(/ +/g, ' ').slice(0, 20), inl: inline, nav: !!t.closest('nav, aside, .admin-sidebar') }) }
const seen = new Set(), walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
for (let n = walker.nextNode(); n; n = walker.nextNode()) { const e = n.parentElement
if (!e || seen.has(e) || !n.textContent.trim() || svgIn(e) || !vis(e) || hid(e) || ['SCRIPT', 'STYLE', 'OPTION'].includes(e.tagName)) continue; seen.add(e)
const c = S(e), fs = parseFloat(c.fontSize), bg = bgOf(e), col = blend(rgba(c.color), bg), dis = e.closest(':disabled, [aria-disabled=true]')
if (fs < 12) out.tiny.push({ fs, s: sig(e), t: n.textContent.trim().slice(0, 24) })
const need = fs >= 24 || (fs >= 18.66 && +c.fontWeight >= 700) ? 3 : 4.5, r = ratio(col, bg)
if (r < need && !dis) out.con.push({ r: Math.round(r * 100) / 100, need, fg: hex(col), bg: hex(bg), fs, s: sig(e), t: n.textContent.trim().slice(0, 24) }) }
for (const e of document.body.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]), select, textarea')) { if (!vis(e)) continue
const r = e.getBoundingClientRect(), c = S(e), par = e.parentElement || document.body, pbg = bgOf(par), fbg = blend(rgba(c.backgroundColor), pbg)
const bw = parseFloat(c.borderTopWidth), edge = Math.max(bw > 0 && c.borderTopStyle !== 'none' ? ratio(blend(rgba(c.borderTopColor), pbg), pbg) : 1, ratio(fbg, pbg))
out.fld.push({ s: sig(e), l: Math.round(r.left), rt: Math.round(iw - r.right), w: Math.round(r.width), h: Math.round(r.height), fs: parseFloat(c.fontSize), ty: e.type || e.tagName.toLowerCase() })
if (edge < 3 && !e.closest('[class*=sr-only]')) out.edge.push({ s: sig(e), edge: Math.round(edge * 100) / 100, bd: hex(blend(rgba(c.borderTopColor), pbg)), bg: hex(fbg), pbg: hex(pbg) }) }
for (const t of document.body.querySelectorAll('table')) { if (!vis(t)) continue
let sc = null; for (let a = t.parentElement; a && a !== document.body; a = a.parentElement) { const ox = S(a).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { sc = a; break } }
const tr = t.getBoundingClientRect(), sr = sc ? sc.getBoundingClientRect() : { left: 0, right: iw, width: iw }, rows = t.querySelectorAll('tbody tr'), first = t.querySelector('tbody tr') || t.querySelector('tr')
const cells = first ? [...first.children] : [], lastc = cells[cells.length - 1], fc = cells[0]
const lr = lastc ? lastc.getBoundingClientRect() : null, fr = fc ? fc.getBoundingClientRect() : null
out.tbl.push({ s: sig(t), cols: cells.length, rows: rows.length, tw: Math.round(tr.width), cw: Math.round(sr.width), sc: sc ? S(sc).overflowX : 'none', scrolls: !!sc && sc.scrollWidth > sc.clientWidth + 1, hold: sc ? sig(sc) : '-',
lastIn: lr ? (lr.right <= sr.right + 1 && lr.left >= sr.left - 1) : null, firstIn: fr ? (fr.right <= sr.right + 1 && fr.left >= sr.left - 1) : null, fSticky: fc ? S(fc).position === 'sticky' : false, hSticky: !!t.querySelector('th') && S(t.querySelector('th')).position === 'sticky',
cut: sc && (S(sc).overflowX === 'hidden' || S(sc).overflowX === 'clip') && sc.scrollWidth > sc.clientWidth + 1, hint: sc ? (S(sc).backgroundImage !== 'none' || S(sc).maskImage !== 'none' && S(sc).maskImage !== undefined) : false, minRow: rows.length ? Math.round(Math.min(...[...rows].map((r) => r.getBoundingClientRect().height))) : 0 }) }
for (const e of live) { const c = S(e); if (c.position !== 'fixed' && c.position !== 'sticky') continue; const r = e.getBoundingClientRect(); if (!inView(r) || r.width < 40) continue
out.fix.push({ s: sig(e), p: c.position, top: Math.round(r.top), bot: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), z: c.zIndex, pb: c.paddingBottom, bg: hex(bgOf(e)) }) }
out.fix = out.fix.slice(0, 8)
if (dark) for (const e of live) { if (e.matches('img, svg, canvas, video, input, button, option')) continue; const c = S(e), p = rgba(c.backgroundColor); if (p[3] < 0.9) continue
const r = e.getBoundingClientRect(); if (r.width * r.height < 2500) continue; if (lum(p) > 0.5) out.light.push({ s: sig(e), bg: hex(p), w: Math.round(r.width), h: Math.round(r.height) }) }
out.light = out.light.slice(0, 8)
return out
}
const FIND = {
look: () => { const e = document.activeElement; if (!e || e === document.body) return null; const c = getComputedStyle(e), r = e.getBoundingClientRect()
return { s: e.tagName.toLowerCase() + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).trim().split(' ').slice(0, 3).join('.'), t: (e.textContent || e.getAttribute('aria-label') || e.placeholder || '').trim().replace(/ +/g, ' ').slice(0, 18),
key: [c.outlineStyle, c.outlineWidth, c.outlineColor, c.boxShadow, c.borderTopColor, c.backgroundColor, c.color, c.textDecorationLine].join('|'), ow: c.outlineStyle === 'none' ? 0 : parseFloat(c.outlineWidth), os: c.outlineStyle, oc: c.outlineColor, sh: c.boxShadow, bc: c.borderTopColor,
x: r.left, y: r.top, w: r.width, h: r.height, vh: innerHeight, vw: innerWidth, onscreen: r.left + r.width / 2 > 0 && r.left + r.width / 2 < innerWidth && r.top + r.height / 2 > 0 && r.top + r.height / 2 < innerHeight, on: (() => { const px = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), py = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1); const t = document.elementFromPoint(px, py); return t === e || e.contains(t) || (t && t.contains(e)) ? '' : t ? t.tagName.toLowerCase() + '.' + String(t.className && t.className.baseVal !== undefined ? t.className.baseVal : t.className).trim().split(' ').slice(0, 3).join('.') : 'none' })() } },
}
const findings = []
const add = (type, key, screen, d) => findings.push({ type, key, screen, d })
const layerOpen = () => pg.evaluate(() => { const l = document.querySelector('.m-menu-layer'); if (!l) return false; const r = l.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(l).display !== 'none' && getComputedStyle(l).visibility !== 'hidden' })
async function menuDeep(pg, tag) {
const o = pg.locator('button:visible').filter({ hasText: RE_OPEN }).first()
if (!(await o.count())) { console.log('MENU ' + tag + ' no menu button visible'); return }
const ob = await o.evaluate((e) => { const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top) + ' expanded=' + e.getAttribute('aria-expanded') + ' controls=' + e.getAttribute('aria-controls') + ' haspopup=' + e.getAttribute('aria-haspopup') })
await o.click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(500)
const st = await pg.evaluate(() => {
const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.visibility !== 'hidden' && c.display !== 'none' }
const layer = document.querySelector('.m-menu-layer'); if (!layer) return { none: true }
const panel = layer.querySelector('.m-menu-panel') || layer, r = panel.getBoundingClientRect(), lc = getComputedStyle(layer), pc = getComputedStyle(panel)
const items = [...panel.querySelectorAll('a, button')].filter(vis), hs = items.map((e) => Math.round(e.getBoundingClientRect().height)), ws = items.map((e) => Math.round(e.getBoundingClientRect().width))
const scroller = [panel].concat([...panel.querySelectorAll('*')]).find((e) => { const k = getComputedStyle(e); return (k.overflowY === 'auto' || k.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 1 })
const before = items.length ? Math.round(items[items.length - 1].getBoundingClientRect().bottom) : 0
let after = before, sh = 0, ch = 0; if (scroller) { sh = scroller.scrollHeight; ch = scroller.clientHeight; scroller.scrollTop = 1e6; after = Math.round(items[items.length - 1].getBoundingClientRect().bottom); scroller.scrollTop = 0 }
const last = items.length ? items[items.length - 1] : null
return { panel: panel.tagName.toLowerCase() + '.' + String(panel.className).trim().split(' ').slice(0, 3).join('.'), l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, layerBg: lc.backgroundColor, layerZ: lc.zIndex, pb: pc.paddingBottom, mh: pc.maxHeight, ov: pc.overflowY,
role: layer.getAttribute('role') || panel.getAttribute('role'), modal: layer.getAttribute('aria-modal') || panel.getAttribute('aria-modal'), label: layer.getAttribute('aria-label') || panel.getAttribute('aria-label'), n: items.length, minH: Math.min.apply(null, hs), minW: Math.min.apply(null, ws), scrolls: !!scroller, sh, ch, lastBefore: before, lastAfter: after, lastTxt: last ? last.textContent.trim().slice(0, 12) : '',
bodyLock: getComputedStyle(document.body).overflow + '/' + getComputedStyle(document.documentElement).overflow, scrollY: Math.round(scrollY), cover: Math.round(100 * r.width * r.height / (innerWidth * innerHeight)),
focus: document.activeElement ? document.activeElement.tagName.toLowerCase() + (layer.contains(document.activeElement) ? ' (inside menu)' : ' (outside menu: ' + String(document.activeElement.className).trim().split(' ').slice(0, 2).join('.') + ')') : 'none', tabbarCovered: !!document.querySelector('.m-tabbar') && document.elementFromPoint(innerWidth / 2, innerHeight - 10) !== null && layer.contains(document.elementFromPoint(innerWidth / 2, innerHeight - 10)) }
})
console.log('MENU ' + tag + ' opener ' + ob + ' | open: ' + JSON.stringify(st))
if (st.none) return
if (!st.role && !st.modal) add('MENU', 'the open menu is not a dialog (no role=dialog / aria-modal): a screen reader keeps reading the page behind it', 'menu', st.panel)
if (!/inside/.test(st.focus)) add('MENU', 'opening the menu does not move keyboard focus into it (focus stays ' + st.focus.replace(/.*[(]/, '').replace(')', '') + ')', 'menu', '')
if (st.scrolls && st.lastAfter > st.vh) add('MENU', 'last menu item stays below the screen even after scrolling the panel to the end (' + st.lastAfter + ' > ' + st.vh + ')', 'menu', '')
if (st.minH < 44) add('MENU', 'menu items as short as ' + st.minH + 'px', 'menu', '')
if (st.bodyLock.indexOf('hidden') < 0) add('MENU', 'page behind the open menu can still scroll (body overflow ' + st.bodyLock + ')', 'menu', '')
let left = '', n = 0
for (; n < st.n + 8; n++) { await pg.keyboard.press('Tab'); left = await pg.evaluate(() => { const l = document.querySelector('.m-menu-layer'); const a = document.activeElement; return a && l && l.contains(a) ? '' : (a ? a.tagName.toLowerCase() + '.' + String(a.className).trim().split(' ').slice(0, 3).join('.') : 'none') }); if (left) break }
console.log('MENU ' + tag + ' Tab: ' + (left ? 'focus LEFT the menu after ' + (n + 1) + ' presses (' + st.n + ' items) onto ' + left : 'stayed inside for ' + n + ' presses (trapped)'))
if (left) add('MENU', 'Tab leaves the open menu and lands on the page behind it (' + left + ')', 'menu', 'after ' + (n + 1) + ' of ' + st.n + ' items')
await pg.keyboard.press('Escape'); await pg.waitForTimeout(400)
const esc = (await layerOpen()) ? 'STILL OPEN' : 'closed'
console.log('MENU ' + tag + ' Escape -> ' + esc)
if (esc === 'STILL OPEN') add('MENU', 'Escape does not close the menu', 'menu', '')
if (esc === 'STILL OPEN') {
if (st.t > 24) { await pg.mouse.click(st.vw / 2, st.t / 2); await pg.waitForTimeout(400); const c2 = (await layerOpen()) ? 'STILL OPEN' : 'closed'; console.log('MENU ' + tag + ' tap on the dimmed strip above the panel (' + st.t + 'px) -> ' + c2); if (c2 === 'STILL OPEN') add('MENU', 'tapping outside the menu does not close it', 'menu', 'strip ' + st.t + 'px') }
else console.log('MENU ' + tag + ' no strip above the panel (' + st.t + 'px)')
}
await pg.waitForTimeout(200)
}
async function focusPass(pg, screen, N) {
await pg.evaluate(() => { window.scrollTo(0, 0); const c = document.querySelector('.admin-content') || document.body; const t = document.createElement('span'); t.tabIndex = -1; c.prepend(t); t.focus(); t.remove() })
for (let i = 0; i < N; i++) {
await pg.keyboard.press('Tab')
const a = await pg.evaluate(FIND.look); if (!a) continue
const z = await pg.evaluate(() => { const e = document.activeElement; window.__fe = e; e.blur(); const c = getComputedStyle(e); return [c.outlineStyle, c.outlineWidth, c.outlineColor, c.boxShadow, c.borderTopColor, c.backgroundColor, c.color, c.textDecorationLine].join('|') })
await pg.evaluate(() => { window.__fe.focus() })
const q = '<' + a.t + '>'
if (!a.onscreen) { add('FOCUS', 'Tab lands on a control that is off-screen (closed menu still in the tab order?): ' + a.s, screen, q + ' @' + Math.round(a.x) + ',' + Math.round(a.y)); continue }
if (z === a.key) add('FOCUS', 'NO INDICATOR on ' + a.s, screen, q)
else if (a.ow === 0 && a.sh === 'none') add('FOCUS', 'only a colour change (no outline, no ring) on ' + a.s, screen, q)
else if (a.ow > 0 && a.ow < 2 && a.sh === 'none' && a.os !== 'auto') add('FOCUS', 'thin ' + a.ow + 'px outline on ' + a.s, screen, q)
if (a.on) add('FOCUS', 'focused control hidden under ' + a.on, screen, a.s + ' ' + q)
}
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, isMobile: false, hasTouch: true, deviceScaleFactor: 1, colorScheme: SCHEME, locale: LOC, reducedMotion: 'reduce' })
const pg = await ctx.newPage()
const errs = [], unknown = new Set()
pg.on('pageerror', (e) => errs.push(e.message.slice(0, 80)))
pg.on('dialog', (d) => d.dismiss().catch(() => {}))
pg.setDefaultTimeout(5000)
await pg.route('**/*', (route) => {
const req = route.request(), u = new URL(req.url())
if (u.origin !== new URL(B).origin) return route.continue()
if (u.pathname.includes('/api/admin')) { const r = u.searchParams.get('r') || ''
if (req.method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
if (!(r in MOCK)) unknown.add(r)
return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK[r] ?? []) }) }
if (req.method() !== 'GET' && req.method() !== 'HEAD') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
return route.continue()
})
const TAG = VW + 'x' + VH + '/' + SCHEME
const open = async () => { await pg.goto(B + '/backends' + QS, { waitUntil: 'networkidle' }); await pg.waitForTimeout(900) }
await open()
if (SCHEME === 'light') await menuDeep(pg, TAG)
await open()
const SCREENS = ['Overview', 'Orders', 'Returns', 'CRM', 'Support', 'Profiles', 'Catalogue', 'Brands', 'Slides', 'Topbar', 'Promotions', 'Discounts', 'Inventory', 'Payments', 'Checkout', 'Theme', 'SEO', 'Activity', 'Settings']
const pickNav = (name) => pg.evaluate((n) => { const els = [...document.querySelectorAll('button, a')]; const ok = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.visibility !== 'hidden' && c.display !== 'none' }
const t = (e) => (e.textContent || '').trim().replace(/ +/g, ' ')
const i = els.findIndex((e) => ok(e) && (t(e) === n || (t(e).indexOf(n) === 0 && t(e).slice(n.length).trim().replace(/[0-9]/g, '') === ''))); if (i < 0) return false
els[i].setAttribute('data-probe-nav', '1'); return true }, name)
const menuOpen = () => layerOpen()
const closeMenu = async () => { const cl = pg.locator('.m-menu-layer button:visible').filter({ hasText: RE_CLOSE }).first(); if (await cl.count()) { await cl.click({ timeout: 2000 }).catch(() => {}); return } await pg.keyboard.press('Escape') }
const navTo = async (name) => {
await pg.evaluate(() => { for (const e of document.querySelectorAll('[data-probe-nav]')) e.removeAttribute('data-probe-nav') })
let opened = false
if (!(await pickNav(name))) { const m = pg.locator('button:visible').filter({ hasText: RE_OPEN }).first(); const m2 = pg.locator('button[aria-label*=enu i]:visible').first(); const mm = (await m.count()) ? m : m2
if (await mm.count()) { await mm.click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(400); opened = true } if (!(await pickNav(name))) return 'missing' }
await pg.locator('[data-probe-nav]').first().click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(1100)
if (opened && (await menuOpen())) { add('MENU', 'menu stays open after choosing a screen (the page behind stays covered until the owner closes it)', name, ''); await closeMenu(); await pg.waitForTimeout(300) }
return 'ok'
}
const record = async (screen) => {
const d = await pg.evaluate(COLLECT, { dark: SCHEME === 'dark' })
const head = screen + ' doc ' + d.dw + '/' + d.cw + (d.dw > d.cw + 1 ? ' HSCROLL' : '') + ' h=' + d.dh + ' tbl=' + d.tbl.length + ' tgt<44=' + d.tgt.length + ' tiny=' + d.tiny.length + ' lowcon=' + d.con.length + ' fld=' + d.fld.length
if (d.dw > d.cw + 1) add('HSCROLL', 'page scrolls sideways', screen, d.dw + ' in ' + d.cw)
for (const x of d.over) add('OVERFLOW', x.s + ' runs past the screen edge (' + x.l + '..' + x.r + ' of ' + d.iw + ')', screen, '<' + x.t + '> w' + x.w)
for (const x of d.clip) add('CLIPPED', x.s + ' cut off by ' + x.by, screen, '<' + x.t + '> ' + x.w + ' in ' + x.aw)
for (const x of d.trunc) add('TRUNC', x.k + ' ' + x.s + (x.ti ? ' (has title)' : ' (NO title)'), screen, '<' + x.t + '> ' + x.sw + ' in ' + x.w)
for (const x of d.tgt) add(x.inl ? 'TAP-INLINE' : 'TAP', (x.nav ? 'nav ' : '') + x.s, screen, x.w + 'x' + x.h + ' <' + x.t + '>')
for (const x of d.tiny) add('TINY', x.fs + 'px ' + x.s, screen, '<' + x.t + '>')
for (const x of d.con) add('CONTRAST', x.fg + ' on ' + x.bg + ' ' + x.r + ':1 (needs ' + x.need + ') ' + x.fs + 'px ' + x.s, screen, '<' + x.t + '>')
for (const x of d.edge) add('FIELD-EDGE', x.s + ' edge ' + x.edge + ':1 (bd ' + x.bd + ' bg ' + x.bg + ' on ' + x.pbg + ')', screen, '')
const f = d.fld
if (f.length) { const minl = Math.min(...f.map((x) => x.l)), minr = Math.min(...f.map((x) => x.rt)), wid = f.filter((x) => x.l < -1 || x.rt < -1)
if (wid.length) add('FIELD-PAST-EDGE', wid.length + ' field(s) past the screen edge, e.g. ' + wid[0].s, screen, 'left ' + wid[0].l + ' right-gap ' + wid[0].rt)
if (minl < 12 || minr < 12) add('FIELD-GUTTER', 'a field sits ' + Math.min(minl, minr) + 'px from the screen edge', screen, 'left ' + minl + ' right ' + minr)
const small = f.filter((x) => x.fs < 16); if (small.length && phone) add('FIELD-ZOOM', small.length + ' field(s) under 16px (iOS zooms on focus), e.g. ' + small[0].s + ' ' + small[0].fs + 'px', screen, '') }
for (const t of d.tbl) { const k = t.s + ' ' + t.cols + 'c'
if (t.sc === 'none' && t.tw > d.iw + 1) add('TABLE', 'NO SCROLL BOX, ' + t.tw + 'px table on a ' + d.iw + 'px screen', screen, k)
if (t.cut) add('TABLE', 'scroll box is overflow:hidden, columns cut off', screen, k + ' ' + t.tw + ' in ' + t.cw)
if (t.scrolls) { add('TABLE-SCROLLS', 'scrolls inside ' + t.hold + (t.hint ? ' (has hint)' : ' (NO scroll hint)') + (t.lastIn ? '' : ', last column (actions) off-screen until scrolled') + (t.fSticky ? ', first column sticky' : ', first column NOT sticky'), screen, k + ' ' + t.tw + ' in ' + t.cw) }
else if (t.sc !== 'none') add('TABLE-FITS', 'fits in ' + t.hold, screen, k + ' ' + t.tw + ' in ' + t.cw) }
for (const x of d.fix) add('FIXED', x.p + ' ' + x.s + ' h' + x.h + ' (' + Math.round(100 * x.h / d.ih) + '% of screen) ' + (x.top < 5 ? 'at top' : x.bot > d.ih - 5 ? 'at bottom, padding-bottom ' + x.pb : 'mid'), screen, 'z' + x.z + ' bg ' + x.bg)
for (const x of d.light) add('LIGHT-IN-DARK', x.s + ' ' + x.bg, screen, x.w + 'x' + x.h)
return d
}
const afterScroll = async (screen) => {
const r = await pg.evaluate(() => { window.scrollTo(0, 1e6); const ih = innerHeight; const fx = [...document.querySelectorAll('body *')].filter((e) => { const c = getComputedStyle(e); const b = e.getBoundingClientRect(); return c.position === 'fixed' && b.width > innerWidth * 0.5 && b.bottom > ih - 4 && b.height < ih * 0.4 && b.height > 20 && c.visibility !== 'hidden' && c.display !== 'none' })
const content = document.querySelector('.admin-content') || document.body; const ctl = [...content.querySelectorAll('button, a[href], input, select, textarea')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 1 && b.height > 1 && b.bottom > 0 && !e.closest('.fixed') }).sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0]
const lb = ctl ? ctl.getBoundingClientRect().bottom : 0, ft = fx.length ? Math.min(...fx.map((e) => e.getBoundingClientRect().top)) : ih
const lastEl = content.lastElementChild ? content.lastElementChild.getBoundingClientRect().bottom : 0
window.scrollTo(0, 0); return { lb: Math.round(lb), ft: Math.round(ft), bars: fx.length, ih, lastEl: Math.round(lastEl), over: Math.round(lb - ft) } })
if (r.bars && r.over > 0) add('OBSCURED-END', 'at the end of the page the last control is ' + r.over + 'px under a fixed bar', screen, 'control bottom ' + r.lb + ' bar top ' + r.ft)
else if (r.bars && r.lastEl > r.ft) add('OBSCURED-END', 'the end of the content is ' + (r.lastEl - r.ft) + 'px under a fixed bar (no bottom padding)', screen, 'content bottom ' + r.lastEl + ' bar top ' + r.ft)
}
const modalProbe = async (screen) => {
const m = await pg.evaluate(() => {
const ih = innerHeight, iw = innerWidth, vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.visibility !== 'hidden' && c.display !== 'none' }
const cl = (e) => e.tagName.toLowerCase() + '.' + String(e.className).trim().split(' ').slice(0, 4).join('.')
const mod = [...document.querySelectorAll('[role=dialog], [aria-modal=true], dialog[open], body *')].filter((e) => { const c = getComputedStyle(e), b = e.getBoundingClientRect(); return (c.position === 'fixed' && b.width >= iw * 0.9 && b.height >= ih * 0.9 && !e.closest('.admin-sidebar') && e.querySelector('input, button, textarea, select')) || e.matches('[role=dialog], [aria-modal=true], dialog[open]') }).filter(vis)
if (!mod.length) return null
const root = mod[0], panels = [...root.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return vis(e) && b.width > 150 && b.height > 100 && e.querySelector('input, textarea, select, button') }).sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)
const pn = panels.length ? panels[panels.length - 1] : root, b = pn.getBoundingClientRect()
let scroller = null; for (let a = pn; a && a !== document.body; a = a.parentElement) { const c = getComputedStyle(a); if ((c.overflowY === 'auto' || c.overflowY === 'scroll') && a.scrollHeight > a.clientHeight + 1) { scroller = a; break } }
const inner = [...pn.querySelectorAll('*')].find((a) => { const c = getComputedStyle(a); return (c.overflowY === 'auto' || c.overflowY === 'scroll') && a.scrollHeight > a.clientHeight + 1 })
const btns = [...pn.querySelectorAll('button')].filter(vis), close = btns.find((e) => new RegExp('close|' + String.fromCharCode(10005) + '|' + String.fromCharCode(215) + '|cancel', 'i').test((e.textContent || '') + (e.getAttribute('aria-label') || ''))), save = btns.filter((e) => /save|add|create|confirm|apply|send/i.test(e.textContent || '')).pop()
const cb = close ? close.getBoundingClientRect() : null, sb = save ? save.getBoundingClientRect() : null
return { root: cl(root), panel: cl(pn), ph: Math.round(b.height), pw: Math.round(b.width), top: Math.round(b.top), bot: Math.round(b.bottom), ih, iw, taller: b.height > ih + 1, scrolls: !!(scroller || inner), maxh: getComputedStyle(pn).maxHeight, lock: getComputedStyle(document.body).overflow, role: root.getAttribute('role'), aria: root.getAttribute('aria-modal'),
closeVis: cb ? (cb.top >= 0 && cb.bottom <= ih) : null, closeSz: cb ? Math.round(cb.width) + 'x' + Math.round(cb.height) : null, saveVis: sb ? (sb.top >= 0 && sb.bottom <= ih) : null, saveSz: sb ? Math.round(sb.width) + 'x' + Math.round(sb.height) : null, saveBot: sb ? Math.round(sb.bottom) : null }
})
if (!m) return false
console.log('MODAL ' + TAG + ' ' + screen + ' ' + JSON.stringify(m))
if (m.taller && !m.scrolls) add('MODAL', 'modal ' + m.ph + 'px tall on a ' + m.ih + 'px screen and does NOT scroll (parts unreachable)', screen, m.panel)
if (m.closeVis === false) add('MODAL', 'close button is below the fold of the modal', screen, m.panel)
if (m.closeSz && (parseInt(m.closeSz) < 44 || parseInt(m.closeSz.split('x')[1]) < 44)) add('MODAL', 'close button ' + m.closeSz, screen, m.panel)
if (m.saveVis === false) add('MODAL', 'save/confirm button is below the fold (needs scrolling; not sticky)', screen, m.panel + ' bottom ' + m.saveBot)
if (!m.role && !m.aria) add('MODAL', 'dialog without role=dialog / aria-modal', screen, m.root)
if (m.lock !== 'hidden') add('MODAL', 'page behind still scrolls (body overflow ' + m.lock + ')', screen, '')
return true
}
const info = await pg.evaluate(() => { const walk = (rules, f) => { for (const r of rules) { if (r.cssRules && !r.selectorText) walk(r.cssRules, f); else f(r) } }
const has = (sel, tok) => { let hit = false; for (const sh of document.styleSheets) { try { walk(sh.cssRules, (r) => { if (r.selectorText && r.selectorText.indexOf(sel) >= 0 && r.cssText.indexOf(tok) >= 0) hit = true }) } catch (e) {} } return hit }
let all = ''; for (const sh of document.styleSheets) { try { walk(sh.cssRules, (r) => { all += r.cssText + ' ' }) } catch (e) {} }
const n = (x) => all.split(x).length - 1
return { vp: (document.querySelector('meta[name=viewport]') || {}).content, dir: document.documentElement.dir, lang: document.documentElement.lang, sheets: document.styleSheets.length, safeB: n('safe-area-inset-bottom'), safeT: n('safe-area-inset-top'), tabbarB: has('m-tabbar', 'safe-area-inset-bottom'), panelB: has('m-menu', 'safe-area-inset-bottom'), headerT: has('m-header', 'safe-area-inset-top'), contentB: has('admin-content', 'safe-area-inset-bottom'), dvh: n('100dvh') + n('100svh'), vh100: n('100vh') } })
console.log('PAGE ' + TAG + ' ' + JSON.stringify(info))
if (/viewport-fit=cover/.test(info.vp || '')) {
if (!info.tabbarB) add('SAFE-AREA', 'viewport-fit=cover is on but no .m-tabbar rule uses env(safe-area-inset-bottom): on an iPhone the bottom tabs sit under the home indicator', 'page', 'safe-area-inset-bottom used in ' + info.safeB + ' rules')
if (!info.panelB) add('SAFE-AREA', 'no .m-menu-* rule uses env(safe-area-inset-bottom): the last menu tiles can sit under the home indicator', 'page', '')
if (!info.headerT) add('SAFE-AREA', 'viewport-fit=cover is on but no .m-header rule uses env(safe-area-inset-top): the header sits under the notch', 'page', '')
} else add('SAFE-AREA', 'no viewport-fit=cover in the viewport meta (' + info.vp + ')', 'page', '')
if (info.dir === 'rtl' && info.lang === 'ar') add('LANG', 'the admin renders <html dir=rtl lang=ar> but every label is English: screen readers read the English with the Arabic voice, and numbers/punctuation follow RTL rules', 'page', 'dir ' + info.dir + ' lang ' + info.lang)
for (const name of SCREENS) {
if (ONLY && !ONLY.includes(name)) continue
try {
const r = await navTo(name)
if (r === 'missing') { console.log('SCR ' + TAG + ' ' + name + ' UNREACHABLE'); add('NAV', 'screen not reachable by its label', name, ''); continue }
await record(name)
await afterScroll(name)
if (!NOFOCUS) await focusPass(pg, name, 16)
const clicked = await pg.evaluate(() => { const c = document.querySelector('.admin-content') || document.body; const vis = (e) => { const r = e.getBoundingClientRect(), k = getComputedStyle(e); return r.width > 1 && r.height > 1 && k.visibility !== 'hidden' && k.display !== 'none' }
const ok = /^(Edit|Add|New|Create|View|Details?|Manage)/; let b = [...c.querySelectorAll('button')].find((e) => vis(e) && e.textContent.trim().length <= 30 && ok.test(e.textContent.trim()))
if (!b) b = [...c.querySelectorAll('table tbody tr a, table tbody tr button, ul li button')].find(vis)
if (!b) return ''; b.scrollIntoView({ block: 'center' }); b.click(); return b.textContent.trim().slice(0, 20) })
if (clicked) { await pg.waitForTimeout(900); await modalProbe(name); await record(name + '/form'); await afterScroll(name + '/form') }
await open()
} catch (e) { console.log('ERR ' + name + ' ' + String(e.message).slice(0, 90)); await open().catch(() => {}) }
}
const groups = new Map()
for (const f of findings) { const k = f.type + '|' + f.key; const g = groups.get(k) || { type: f.type, key: f.key, screens: [], ex: [], n: 0 }; g.n++; if (!g.screens.includes(f.screen)) g.screens.push(f.screen); if (g.ex.length < 2 && f.d && !g.ex.includes(f.d)) g.ex.push(f.d); groups.set(k, g) }
const DARKONLY = ['CONTRAST', 'LIGHT-IN-DARK', 'FIELD-EDGE', 'FOCUS']
const order = ['LANG', 'HSCROLL', 'OVERFLOW', 'CLIPPED', 'TABLE', 'TABLE-SCROLLS', 'TABLE-FITS', 'MODAL', 'MENU', 'OBSCURED-END', 'FIELD-PAST-EDGE', 'FIELD-GUTTER', 'FIELD-ZOOM', 'FIELD-EDGE', 'TRUNC', 'FIXED', 'SAFE-AREA', 'NAV', 'FOCUS', 'CONTRAST', 'LIGHT-IN-DARK', 'TINY', 'TAP', 'TAP-INLINE']
const cap = { CONTRAST: 40, TAP: 40, 'TAP-INLINE': 6, TINY: 14, FOCUS: 24, TRUNC: 24, 'TABLE-FITS': 6, 'TABLE-SCROLLS': 26, FIXED: 14, 'FIELD-EDGE': 10, 'LIGHT-IN-DARK': 14 }
for (const t of order) { if (SCHEME === 'dark' && !DARKONLY.includes(t)) continue; const gs = [...groups.values()].filter((g) => g.type === t).sort((a, b) => b.n - a.n); if (!gs.length) continue
console.log('== ' + t + ' (' + gs.length + ' kinds, ' + gs.reduce((a, g) => a + g.n, 0) + ' hits)')
for (const g of gs.slice(0, cap[t] || 30)) console.log(t + ' x' + g.n + ' ' + g.key + ' [' + g.screens.slice(0, 8).join(',') + (g.screens.length > 8 ? ',+' + (g.screens.length - 8) : '') + ']' + (g.ex.length ? ' e.g. ' + g.ex.join(' / ') : '')) }
console.log('ERRS ' + (errs.join(' | ') || 'none') + ' UNMOCKED ' + ([...unknown].join(' ') || 'none'))
console.log('PROBE_DONE ' + TAG)
await browser.close()
