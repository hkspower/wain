#!/usr/bin/env node
// ADMIN SAVE SCAN — read-only. Run ON the VPS in the Playwright image (the
// sandbox cannot reach www.sporta.com.kw):
//
//   npm i playwright@1.49.0 && node admin-save-scan.mjs [base]
//
// Question it answers (owner, 2026-11-03: "add save buttons every page
// backends"): on every screen of the LIVE compiled /backends admin, where does
// the owner EDIT something, what is the Save control of that edit surface, and
// is that control within reach — on a desktop (1280x800) and on a phone
// (390x844)? It is the evidence for a "mirror Save bar" add-on (a slim sticky
// bar that appears while the screen's own Save is out of view and clicks the
// real one), and for the screens where no Save exists at all.
//
// Same safety model as admin-style-scan.mjs: nothing signs in, every
// /api/admin.php call is answered from a mock in the browser, and ANY non-GET
// request is answered locally, so a button the scan presses cannot write
// anything. The mock below is copied from admin-style-scan.mjs (that file is
// not edited) and extended with the routes the edit modals ask for.
//
// What it does, per nav item, per viewport:
//   1. takes the nav list FROM THE PAGE (on the phone the sidebar is behind the
//      menu button; the items are read from the DOM, the menu is opened for the
//      click) and opens the screen;
//   2. STEPS: the screen as loaded, then every Edit / Add / New / tab / first
//      table row (a fresh load for each), so edit modals, drawers and inline
//      editors are on the page when it measures;
//   3. in each step finds every EDIT SURFACE by walking from the Save-like
//      buttons to the smallest ancestor that holds fields (a <form>, a modal
//      form, a card, a table row), then claims what is left over as an
//      "orphan" (fields with no Save: autosave, or nothing to press);
//   4. per surface and Save button: text, selector, <button type=submit> in a
//      <form> or onClick-only, disabled / aria-busy / classes, the y of its
//      bottom edge at scroll 0, visible without scrolling, how far to scroll,
//      the sticky / fixed ancestor, the scroll container it lives in;
//   5. (desktop) PROBES: change the first few fields and watch for a write
//      within 700 ms (autosave on change or on blur); press the first Save with
//      the mock holding the answer for 1.4 s and sample the button while it is
//      pending (the busy markup a mirror must copy). The browser's own
//      confirm()/alert() are logged, not answered with yes.
//   6. DOM patterns: modal construction, main scroll container, fixed and
//      sticky elements, the phone's safe bottom area, direction, tab order of
//      Save buttons.
//
// Output lines start with S| (surface), N| (nav), P| (pattern), B| (buttons of a
// step), W| (warning) so it greps cleanly; everything is printed at the END
// (the VPS log keeps only the last 300 entries). Env: SCAN_ONLY=Payments,Orders
// SCAN_VIEWS=desktop,phone SCAN_DEBUG=1 SCAN_PROBE=0 CHROMIUM_PATH=<chrome>.
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const BASE = (args.find((a) => !a.startsWith('--')) || 'https://www.sporta.com.kw').replace(/\/$/, '')
const ONLY = process.env.SCAN_ONLY ? process.env.SCAN_ONLY.split(',').map((s) => s.trim().toLowerCase()) : null
const DEBUG = !!process.env.SCAN_DEBUG
const PROBE = process.env.SCAN_PROBE !== '0'
const PROBE_PHONE = process.env.SCAN_PROBE_PHONE === '1'
const MAX_OPENERS = Number(process.env.SCAN_MAX_OPENERS || 6)

// ---------------------------------------------------------------- mock data
// Copied from admin-style-scan.mjs: synthetic, plausible, and in the shapes
// admin.php returns. Products, brands, stock and the theme come from the public
// API (read-only GETs, the same ones any visitor makes).
const pub = async (r) => { try { return await (await fetch(`${BASE}/api/api.php?r=${r}`)).json() } catch { return [] } }
const [products, brands, stock, theme] = await Promise.all([pub('products'), pub('brands'), pub('stock'), pub('theme')])
const P = Array.isArray(products) ? products : []
const day = (n) => `2026-10-${String(30 - n).padStart(2, '0')} 1${n % 10}:2${n % 6}:00`
const AREAS = ['Salmiya', 'Hawalli', 'Jabriya', 'Mishref', 'Kuwait City', 'Fahaheel']
const NAMES = ['Test Customer A', 'Test Customer B', 'عميل تجريبي', 'Test Customer C', 'Sample Buyer', 'عميلة تجريبية']
const PAY = [['paid', 'knet'], ['pending', 'cod'], ['failed', 'knet'], ['paid', 'tpay'], ['pending', 'knet'], ['paid', 'cod']]
const FUL = ['unfulfilled', 'packed', 'shipped', 'delivered', 'cancelled']
const orders = Array.from({ length: 14 }, (_, i) => ({
  id: 900 + i, track_id: 'SPTEST' + String(1000 + i), amount: 5 + i, subtotal: 4 + i, discount_amount: i % 4 === 0 ? 1 : 0,
  discount_code: i % 4 === 0 ? 'WELCOME' : null, delivery_fee: 1, payment_status: PAY[i % 6][0], payment_method: PAY[i % 6][1],
  fulfilment_status: FUL[i % 5], paid_at: PAY[i % 6][0] === 'paid' ? day(i) : null, created_at: day(i),
  customer_name: NAMES[i % 6], customer_phone: '9650000' + String(1000 + i), customer_area: AREAS[i % 6], customer_note: i % 3 ? null : 'Call before arriving',
  customer_governorate: 'hawalli', customer_block: '1', customer_street: '2', customer_building: '3', customer_floor: null, customer_flat: null,
  cbk_paymentid: null, cbk_reference: null, cbk_status: null, utm_source: i % 2 ? 'instagram' : null, utm_medium: null, utm_campaign: null, referrer_host: null,
}))
const productsAll = P.map((p, i) => ({ id: i + 1, slug: p.slug, name_en: p.name_en, name_ar: p.name_ar, desc_en: p.desc_en || '', desc_ar: p.desc_ar || '',
  price: Number(p.price || 0).toFixed(3), sale_price: p.on_sale ? Number(p.price).toFixed(3) : null, sale_starts_at: null, sale_ends_at: null,
  featured: p.featured ? 1 : 0, featured_sort: p.featured_sort || 0, category: p.category, brand_slug: p.brand_slug || null,
  image: p.image || null, images: p.images || null, active: i % 9 === 8 ? 0 : 1 }))
const S = Array.isArray(stock) ? stock : []
const variants = S.slice(0, 120).map((v, i) => {
  const p = P.find((x) => x.slug === v.slug) || {}
  return { sku: v.sku || `SKU-${i}`, slug: v.slug, name_en: p.name_en || v.slug, name_ar: p.name_ar || '', category: p.category || 'men', price: Number(p.price || 9),
    size: v.size, stock: v.stock ?? 5, cost_aed: 40, unit_cost_kwd: 3.35, low_stock_threshold: 2, inventory_version: 10 + i, sold_qty: i % 4, received_qty: 10, returned_qty: 0, damaged_qty: 0 }
})
const logo = {}
for (const b of Array.isArray(brands) ? brands : []) {
  if (!+b.has_logo) continue
  try { const r = await fetch(`${BASE}/api/api.php?r=brand_logo&slug=${b.slug}&v=${b.logo_v}`); logo[b.slug] = `data:${r.headers.get('content-type')};base64,` + Buffer.from(await r.arrayBuffer()).toString('base64') } catch {}
}
const MOCK = {
  me: { email: 'owner@example.com' },
  google_available: { available: false },
  stats: { paid_count: 6, paid_revenue: '61.000', pending_count: 5, review_count: 1, failed_count: 2, unfulfilled_count: 3, paid_today: 1, revenue_today: '9.000', paid_7d: 4, revenue_7d: '38.000', cod_awaiting_count: 2, cod_awaiting_amount: '13.000' },
  revenue: Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(17 + i).padStart(2, '0')}`, revenue: String(5 + (i * 7) % 23) })),
  products_state: P.map((p) => ({ slug: p.slug, price: Number(p.price || 0).toFixed(3), active: 1 })),
  products_all: productsAll,
  orders,
  variants,
  brands: (Array.isArray(brands) ? brands : []).map((b, i) => ({ id: i + 1, slug: b.slug, name_en: b.name_en, name_ar: b.name_ar, logo: logo[b.slug] || null, active: 1, sort: i,
    products: P.filter((p) => p.brand_slug === b.slug).length, products_active: P.filter((p) => p.brand_slug === b.slug).length })),
  brand_products: productsAll.map((p) => ({ slug: p.slug, name_en: p.name_en, name_ar: p.name_ar, brand_slug: p.brand_slug, active: p.active, category: p.category })),
  discounts: [
    { id: 1, code: 'WELCOME', kind: 'percent', value: 10, min_subtotal: 0, auto: 0, active: 1, single_use: 0, uses: 4, max_uses: null, starts_at: null, ends_at: null, label_en: 'Welcome 10%', label_ar: 'خصم ترحيبي ١٠٪' },
    { id: 2, code: null, kind: 'fixed', value: 2, min_subtotal: 20, auto: 1, active: 0, single_use: 0, uses: 0, max_uses: null, starts_at: null, ends_at: null, label_en: '2 KWD off 20+', label_ar: 'خصم ٢ د.ك' },
  ],
  slides: { slides: [
    { id: 1, sort: 0, active: 1, title_en: 'New season', title_ar: 'موسم جديد', subtitle_en: 'Fresh drops', subtitle_ar: 'جديد', cta_en: 'Shop now', cta_ar: 'تسوق', href: '/shop', has_image: 0, image_v: 0, image_alt_en: '', image_alt_ar: '', starts_at: null, ends_at: null },
    { id: 2, sort: 1, active: 0, title_en: 'Training gear', title_ar: 'معدات', subtitle_en: '', subtitle_ar: '', cta_en: '', cta_ar: '', href: '/shop', has_image: 0, image_v: 0, image_alt_en: '', image_alt_ar: '', starts_at: null, ends_at: null },
  ], hero: { speed_ms: 6500, shuffle: false, size: 'tall', autoplay: true } },
  checkout_settings: { delivery_fee: 1, methods: ['knet', 'tpay', 'cod'], default_method: 'knet', notice_en: '', notice_ar: '' },
  theme_settings: theme && !Array.isArray(theme) && theme.brand ? theme : { brand: '#c76a42', accent: '#99452b', canvas: '#ffffff', radius: '16', dark: false, fonts: { body_en: 'plex', display_en: 'alexandria', body_ar: 'plex', display_ar: 'alexandria' } },
  topbar_settings: { enabled: true, text_en: 'Delivery within 24 hours in Kuwait', text_ar: 'التوصيل خلال ٢٤ ساعة داخل الكويت', href: '/shop', starts_at: null, ends_at: null, tone: 'brand', show_dot: true, alignment: 'center' },
  seo_settings: { pages: Object.fromEntries(['/', '/shop', '/about', '/contact', '/returns', '/terms', '/privacy'].map((p) => [p, { title_en: '', title_ar: '', description_en: '', description_ar: '', image: '' }])) },
  return_requests: { requests: Array.from({ length: 6 }, (_, i) => ({ id: 70 + i, reference: 'RR' + String(260000 + i), status: ['requested', 'approved', 'pickup_scheduled', 'received', 'completed', 'declined'][i], eligibility: i % 3 ? 'eligible' : 'review',
    created_at: day(i), updated_at: day(i), track_id: 'SPTEST' + (1000 + i), customer_name: NAMES[i % 6], customer_phone: '9650000' + (1000 + i), payment_method: PAY[i % 6][1], fulfilment_status: 'delivered' })), page: 1, has_more: false, total: 6 },
  support_list: { tickets: Array.from({ length: 6 }, (_, i) => ({ id: 40 + i, reference: 'ST' + String(510000 + i), customer_name: NAMES[i % 6], customer_email: `customer${i}@example.com`, customer_phone: '9650000' + (1000 + i),
    order_track_id: i % 2 ? 'SPTEST' + (1000 + i) : null, subject: ['Where is my order?', 'Size exchange for the black tee', 'Payment question', 'Wrong colour delivered — can I swap it?', 'استفسار عن الطلب', 'Invoice copy'][i],
    status: ['open', 'pending', 'resolved', 'open', 'closed', 'pending'][i], priority: ['urgent', 'high', 'normal', 'normal', 'low', 'normal'][i], assigned_to: i % 3 ? null : 'owner@example.com',
    last_customer_at: day(i), last_staff_at: i % 2 ? day(i) : null, created_at: day(i), updated_at: day(i) })) },
  crm_list: { contacts: NAMES.map((n, i) => ({ key: 'phone:9650000' + (1000 + i), source: 'phone', name: n, display_name: '', phone: '9650000' + (1000 + i), email: '', order_count: 1 + i, order_total: 9 * (1 + i), paid_total: 9 * i, open_cod_count: i % 2, open_cod_total: (i % 2) * 9, last_order_at: day(i), last_area: AREAS[i], last_track_id: 'SPTEST' + (1000 + i), status: ['new', 'contacted', 'vip'][i % 3], tags: i % 2 ? ['vip'] : [], follow_up_at: null, note_count: i % 3, updated_at: null, updated_by: null })) },
  profiles_list: { profiles: Array.from({ length: 6 }, (_, i) => ({ id: 300 + i, name: NAMES[i % 6], email: `customer${i}@example.com`, phone: '9650000' + (1000 + i), created_at: day(i + 3), last_login_at: day(i),
    order_count: i, paid_total: 9.5 * i, last_order_at: i ? day(i) : null })), page: 1, has_more: false },
  activity_log: { events: Array.from({ length: 12 }, (_, i) => ({ id: 500 - i, actor_email: 'owner@example.com', action_key: ['login', 'product_save', 'brand_save', 'settings_save'][i % 4], created_at: day(i) })), page: 1, has_more: false },
  inventory_movements: variants.slice(0, 8).map((v, i) => ({ id: 20 - i, sku: v.sku, type: ['receive', 'sale', 'adjust'][i % 3], before_stock: 10, after_stock: 9, delta: -1, before_unit_cost_kwd: 3.35, after_unit_cost_kwd: 3.35, before_low_stock_threshold: 2, after_low_stock_threshold: 2, inventory_version: 5, note: 'Scan sample', actor_admin_id: null, actor_email: 'owner@example.com', created_at: day(i) })),
  inventory_finance: { delivery_expense: 0, ads_expense: 0, fixed_expense: 0, variable_expense: 0, returns_expense: 0, damage_expense: 0 },
  blocked: [], font_list: [], mfa_status: { enabled: false }, google_status: { configured: false, linked: false },
  payment_config: {
    knet: { installed: true, enabled: true, env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://www.kpay.com.kw/kpg/PaymentHTTP.htm', response_url: BASE + '/knet/callback.php', error_url: BASE + '/knet/callback.php', result_page_url: BASE + '/payment-result', has_tranportal_id: false, has_tranportal_password: false, has_resource_key: false, credentials: { test: { has_tranportal_id: false, has_tranportal_password: false, has_resource_key: false }, production: { has_tranportal_id: false, has_tranportal_password: false, has_resource_key: false } } },
    tpay: { installed: true, env: 'test', test_base: 'https://pgtest.cbk.com', production_base: 'https://pg.cbk.com', return_url: BASE + '/pay/callback.php', result_page_url: BASE + '/payment-result', has_client_id: false, has_client_secret: false, has_encrp_key: false },
  },
  payment_status: {
    knet: { installed: true, ready: false, mode: 'test', gateway_host: 'kpaytest.com.kw', checks: { merchant_credentials: false, resource_key: false, return_urls: true, orders_database: true, environment: true } },
    tpay: { installed: true, ready: false, mode: 'test', gateway_host: 'pgtest.cbk.com', checks: { merchant_credentials: false, encrypted_account_key: false, return_urls: true, orders_database: true, environment: true } },
  },
  payment_identifiers: { env: 'test', test: { merchant_id: '', terminal_id: '' }, production: { merchant_id: '', terminal_id: '' } },
  payment_server_ips: { server_ip_1: '', server_ip_2: '' },
  payment_knet_via_cbk: { enabled: false, tpay_ready: false },
}

// ---------------------------------------------------------------- in-page code
// These functions run inside the page (pg.evaluate serialises them), so each is
// self-contained: nothing from the module scope is visible there.

// Where is the navigation, and what is in it? Read from the DOM whether or not it
// is visible (on the phone it sits behind the menu button).
function inPageNav() {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  // visible = painted AND on the screen (the phone's sidebar sits off-canvas, translated out of view)
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && r.right > 1 && r.left < innerWidth - 1 && r.bottom > 1 && r.top < innerHeight - 1 && c.visibility !== 'hidden' && c.display !== 'none' }
  const rect = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
  const sels = ['.admin-sidebar', 'aside', 'nav', '[role=navigation]']
  let side = null
  for (const s of sels) { side = document.querySelector(s); if (side) break }
  const out = { side: null, items: [], menuBtn: null, drawer: null, tabbar: null, header: null }
  // The phone layout of the older admin build had a sticky header (.m-header) and a bottom tab bar
  // (.m-tabbar): record whatever of that kind is painted, with its position.
  const bar = (q) => { for (const e of document.querySelectorAll(q)) { if (!vis(e)) continue; const c = getComputedStyle(e); return { sel: e.tagName.toLowerCase() + '.' + clean(e.className).split(' ').slice(0, 3).join('.'), pos: c.position, z: c.zIndex, rect: rect(e), bottom: c.bottom, top: c.top, padB: c.paddingBottom, items: [...e.querySelectorAll('a, button')].map((x) => clean(x.textContent || x.getAttribute('aria-label')).slice(0, 20)).filter(Boolean) } } return null }
  out.tabbar = bar('.m-tabbar, [class*="tabbar"], [class*="bottom-nav"], [class*="bottomnav"]')
  out.header = bar('.m-header, header[class*="m-"], [class*="mobile-header"]')
  if (side) {
    const c = getComputedStyle(side)
    out.side = { tag: side.tagName.toLowerCase(), cls: clean(side.className).slice(0, 90), vis: vis(side), pos: c.position, z: c.zIndex, transform: c.transform === 'none' ? '' : c.transform.slice(0, 40), rect: rect(side), top: c.top, h: c.height }
    for (const e of side.querySelectorAll('a, button, [role=tab], [role=menuitem]')) {
      const text = clean(e.textContent || e.getAttribute('aria-label'))
      if (!text) continue
      out.items.push({ text: text.slice(0, 40), tag: e.tagName.toLowerCase(), href: e.getAttribute('href'), target: e.getAttribute('target'), vis: vis(e), active: e.getAttribute('aria-current') || (/\b(active|is-active)\b/.test(String(e.className)) ? 'class' : ''), idx: out.items.length })
    }
  }
  // The menu button: a visible control OUTSIDE the sidebar called menu.
  for (const e of document.querySelectorAll('button, [role=button]')) {
    if (side && side.contains(e)) continue
    const t = clean(e.textContent) + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')
    if (/menu|☰|≡|navigation|\bmore\b|المزيد/i.test(t) && !/close/i.test(t) && vis(e)) { out.menuBtn = { text: clean(e.textContent).slice(0, 20), aria: e.getAttribute('aria-label') || '', rect: rect(e), cls: clean(e.className).slice(0, 80) }; break }
  }
  return out
}

// Click the nav item with this key (href when it has one, else its text), from
// inside the page, so an item hidden behind the phone menu still gets its click.
function inPageClickNav(key) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const roots = [document.querySelector('.admin-sidebar'), document.querySelector('aside'), document.querySelector('nav'), document.querySelector('[role=navigation]'), document.querySelector('.m-tabbar'), document.querySelector('[class*="tabbar"]')].filter(Boolean)
  for (const side of roots) {
    for (const e of side.querySelectorAll('a, button, [role=tab], [role=menuitem]')) {
      const text = clean(e.textContent || e.getAttribute('aria-label')).slice(0, 40)
      if (text === key.text && (e.getAttribute('href') || '') === (key.href || '')) { e.click(); return true }
    }
  }
  return false
}

// The page's fixed / sticky furniture and its scroll structure — what a bar that
// sticks to the bottom has to live with.
function inPageShell() {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const rect = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
  const sel = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + clean(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(' ').filter(Boolean).slice(0, 4).join('.')
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.visibility !== 'hidden' && c.display !== 'none' }
  const side = document.querySelector('.admin-sidebar') || document.querySelector('aside')
  const fixed = []
  for (const e of document.body.querySelectorAll('*')) {
    const c = getComputedStyle(e)
    if (c.position !== 'fixed' && c.position !== 'sticky') continue
    if (!vis(e)) continue
    const r = e.getBoundingClientRect()
    fixed.push({ sel: sel(e).slice(0, 90), pos: c.position, z: c.zIndex, rect: rect(e), inSide: !!(side && side.contains(e)), fields: e.querySelectorAll('input:not([type=hidden]), select, textarea').length, buttons: e.querySelectorAll('button').length, atBottom: Math.round(innerHeight - r.bottom) <= 2 && r.height < 160, atTop: r.top <= 2 && r.height < 160, text: clean(e.textContent).slice(0, 28), bottom: c.bottom, top: c.top, parent: e.parentElement ? e.parentElement.tagName.toLowerCase() + (e.parentElement.id ? '#' + e.parentElement.id : '') : '' })
    if (fixed.length >= 14) break
  }
  // Which element scrolls? An inner one (overflow auto/scroll that overflows) or the window.
  const scrollers = []
  for (let e = document.querySelector('.admin-content') || document.querySelector('main'); e && e !== document.documentElement; e = e.parentElement) {
    const c = getComputedStyle(e)
    if (/(auto|scroll|overlay)/.test(c.overflowY)) scrollers.push({ sel: sel(e).slice(0, 70), overflowY: c.overflowY, client: e.clientHeight, scroll: e.scrollHeight, overflows: e.scrollHeight > e.clientHeight + 1 })
  }
  const se = document.scrollingElement
  const before = se.scrollTop
  scrollTo(0, 99999)
  const winMoved = se.scrollTop > 0
  scrollTo(0, before)
  const cs = (s) => { const e = document.querySelector(s); if (!e) return null; const c = getComputedStyle(e); return { sel: s, pos: c.position, display: c.display, h: c.height, minH: c.minHeight, maxH: c.maxHeight, overflow: c.overflow, padB: c.paddingBottom, padT: c.paddingTop, padL: c.paddingLeft, transform: c.transform === 'none' ? '' : 'T', rect: rect(e) } }
  // env() probe: does the browser give a value, and does the page ask for it?
  const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;padding-bottom:env(safe-area-inset-bottom);visibility:hidden'
  document.body.appendChild(probe); const envBottom = getComputedStyle(probe).paddingBottom; probe.remove()
  const vp = document.querySelector('meta[name=viewport]')
  const manifest = document.querySelector('link[rel=manifest]')
  return {
    w: innerWidth, h: innerHeight, docH: se.scrollHeight, winScrolls: winMoved, scrollers,
    dir: { html: document.documentElement.dir || '', htmlComputed: getComputedStyle(document.documentElement).direction, lang: document.documentElement.lang, body: getComputedStyle(document.body).direction },
    viewportMeta: vp ? vp.getAttribute('content') : null, manifest: manifest ? manifest.getAttribute('href') : null,
    envBottom, shell: cs('.admin-shell'), content: cs('.admin-content'), main: cs('main'), body: cs('body'), root: cs('#root'), html: cs('html'),
    fixed,
  }
}

// Find the ways to open an edit surface from the screen as loaded: Edit / Add /
// New buttons, tabs, and the first table row. Nothing destructive.
function inPageOpeners() {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.visibility !== 'hidden' && c.display !== 'none' }
  const side = document.querySelector('.admin-sidebar') || document.querySelector('aside')
  const root = document.querySelector('.admin-content') || document.querySelector('main') || document.body
  const OPEN = /^(edit|add|new|create|manage|configure|details?|view|open|reply|change|set up|setup|upload|import|write|compose|schedule|customi[sz]e|rename|assign|update|adjust|receive|add stock)\b/i
  const NOT = /delete|remove|cancel|clear|reset|block|ban|refund|void|revoke|log ?out|sign ?out|disconnect|unlink|archive|empty|purge|wipe|call|whatsapp|print|download|export|copy|view site|view on site|next|prev|more|load/i
  const out = [], seen = new Map()
  for (const e of root.querySelectorAll('button, [role=tab], a[href^="#"], summary')) {
    if (side && side.contains(e)) continue
    if (!vis(e)) continue
    const text = clean(e.textContent || e.getAttribute('aria-label')).slice(0, 40)
    if (!text) continue
    const isTab = e.getAttribute('role') === 'tab' || e.hasAttribute('aria-selected')
    if (!(isTab || (OPEN.test(text) && !NOT.test(text)))) continue
    if (isTab && e.getAttribute('aria-selected') === 'true') continue
    const key = (isTab ? 'tab:' : '') + text.toLowerCase()
    const n = seen.get(key) || 0
    seen.set(key, n + 1)
    if (n > 0) continue            // the first Edit stands for all the Edits
    // Position among the buttons with the same text, so it can be found again after a reload.
    const same = [...root.querySelectorAll('button, [role=tab], a[href^="#"], summary')].filter((x) => !(side && side.contains(x)) && clean(x.textContent || x.getAttribute('aria-label')).slice(0, 40) === text && vis(x))
    out.push({ kind: isTab ? 'tab' : 'button', text, nth: same.indexOf(e) })
  }
  const row = root.querySelector('table tbody tr')
  if (row && vis(row)) out.push({ kind: 'row', text: 'first row', nth: 0 })
  return out
}

function inPageClickOpener(op) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.visibility !== 'hidden' && c.display !== 'none' }
  const side = document.querySelector('.admin-sidebar') || document.querySelector('aside')
  const root = document.querySelector('.admin-content') || document.querySelector('main') || document.body
  if (op.kind === 'row') {
    const row = root.querySelector('table tbody tr')
    if (!row) return false
    const cell = [...row.children].find((c) => !c.querySelector('button, input, select, a')) || row.children[0] || row
    cell.click(); return true
  }
  const same = [...root.querySelectorAll('button, [role=tab], a[href^="#"], summary')].filter((x) => !(side && side.contains(x)) && clean(x.textContent || x.getAttribute('aria-label')).slice(0, 40) === op.text && vis(x))
  const e = same[op.nth] || same[0]
  if (!e) return false
  e.scrollIntoView({ block: 'center' }); e.click(); return true
}

// THE MEASUREMENT. One call per step: every edit surface on the page or in an
// overlay, its fields, its Save controls, and where those sit at scroll 0.
function inPageMeasure() {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const cn = (e) => clean(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className)
  const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.visibility !== 'hidden' && c.display !== 'none' && +c.opacity > 0.02 }
  const SEM = /^(admin|payment|theme|seo|crm|inventory|support|profiles|topbar|returns|brand|promo|slide|font|activity|checkout|settings|catalog|product|order|discount|overview|modal|drawer|panel|btn|m-|toast|tab)/
  const short = (e) => {
    if (e === document.body) return 'body'
    const cl = cn(e).split(' ').filter(Boolean)
    const sem = cl.filter((c) => SEM.test(c) || c.includes('__') || c.includes('--'))
    const pick = (sem.length ? sem : cl).slice(0, 3)
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + pick.map((c) => '.' + c.replace(/([^\w-])/g, '\\$1')).join('')
  }
  // scrolling of the page and of the admin shell back to the top, so every y below is "at scroll 0"
  window.scrollTo(0, 0); document.scrollingElement.scrollTop = 0
  for (const e of document.querySelectorAll('.admin-content, main, .admin-shell, [class*="overflow-y"], [class*="overflow-auto"]')) { try { e.scrollTop = 0 } catch (x) {} }

  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const rgba = (c) => { if (!c || c === 'transparent') return [0, 0, 0, 0]; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const hex = (p) => '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

  const side = document.querySelector('.admin-sidebar') || document.querySelector('aside')
  const content = document.querySelector('.admin-content') || document.querySelector('main') || document.body
  const inSide = (e) => !!(side && side.contains(e))

  // Overlays: fixed boxes that cover a good part of the screen and are not the sidebar.
  const overlays = []
  for (const e of document.body.querySelectorAll('*')) {
    if (inSide(e)) continue
    const c = getComputedStyle(e)
    if (c.position !== 'fixed' && !(e.matches && e.matches('dialog[open], [role=dialog], [aria-modal=true]') && c.position !== 'static')) continue
    if (!vis(e)) continue
    if (e.contains(content) || (side && e.contains(side))) continue      // an app shell pinned to the viewport is not a modal
    const r = e.getBoundingClientRect()
    if (r.width < innerWidth * 0.45 || r.height < innerHeight * 0.3) continue
    if (overlays.some((o) => o.el.contains(e) || e.contains(o.el))) continue   // the outermost one stands for a nest
    overlays.push({ el: e, z: c.zIndex, r })
  }
  const inOverlay = (e) => overlays.find((o) => o.el.contains(e)) || null

  // fields: visible (a switch's own checkbox is often sr-only, so its label counts)
  const FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]), select, textarea, [contenteditable=true], [role=switch], [role=checkbox], [role=slider], [role=combobox]'
  const labelOf = (f) => clean((f.closest('label') && f.closest('label').textContent) || f.getAttribute('aria-label') || f.getAttribute('placeholder') || f.name || (f.id && document.querySelector('label[for="' + f.id + '"]') ? document.querySelector('label[for="' + f.id + '"]').textContent : '') || '').slice(0, 30)
  const isFilter = (f) => {
    const t = (f.getAttribute('type') || '').toLowerCase()
    const s = (f.getAttribute('placeholder') || '') + ' ' + (f.getAttribute('aria-label') || '') + ' ' + (f.name || '')
    return t === 'search' || /search|filter|find|بحث/i.test(s) || !!f.closest('[role=search]')
  }
  const fields = []
  for (const f of document.querySelectorAll(FIELD)) {
    if (inSide(f)) continue
    const t = (f.getAttribute('type') || f.tagName).toLowerCase()
    const own = vis(f) || ((t === 'checkbox' || t === 'radio') && f.closest('label') && vis(f.closest('label')))
    if (!own) continue
    const kind = f.getAttribute('role') === 'switch' ? 'switch' : f.getAttribute('contenteditable') ? 'editable' : f.tagName === 'SELECT' ? 'select' : f.tagName === 'TEXTAREA' ? 'textarea' : t
    fields.push({ el: f, kind, filter: isFilter(f), label: labelOf(f), disabled: f.disabled || f.getAttribute('aria-disabled') === 'true', readonly: f.readOnly === true })
  }
  const real = fields.filter((f) => !f.filter)

  // buttons: all visible ones outside the sidebar
  const SAVE_STRONG = /\b(save|update|apply|publish|confirm|done|submit|store|keep|حفظ)\b/i
  const SAVE_WEAK = /\b(create|add|send|post|upload|import|register|schedule|set|assign|resolve|reply|approve|mark|ok|yes|continue|next|finish|activate|enable)\b/i
  const NOTSAVE = /\b(cancel|close|discard|back|reset|clear|delete|remove|dismiss|edit|no|skip|hide|show|open|view|filter|search|sort|refresh|reload|copy|print|download|export|log ?out|sign ?out|menu)\b/i
  const buttons = []
  for (const b of document.querySelectorAll('button, input[type=submit], input[type=button], [role=button]')) {
    if (inSide(b) || !vis(b)) continue
    const text = clean(b.tagName === 'INPUT' ? b.value : b.textContent) || clean(b.getAttribute('aria-label') || b.getAttribute('title'))
    const form = b.form || b.closest('form')
    const typeAttr = b.getAttribute('type')
    // b.type is the effective type: a <button> with no type attribute says "submit" even outside any form,
    // where it submits nothing — so a submit button needs a form.
    const submit = (b.tagName === 'BUTTON' || b.tagName === 'INPUT') && b.type === 'submit' && !!form
    const inForm = form ? fields.filter((f) => form.contains(f.el)) : []
    const searchOnly = !!form && inForm.length > 0 && inForm.every((f) => f.filter)     // a search box's own button
    const ov = inOverlay(b)
    const strong = SAVE_STRONG.test(text) && !/\b(delete|remove|cancel|discard)\b/i.test(text)
    const weak = SAVE_WEAK.test(text) && !NOTSAVE.test(text) && (!!form || !!ov)
    const saveLike = !searchOnly && ((submit && !/\b(cancel|close|discard|back|reset|clear|delete|remove|dismiss)\b/i.test(text)) || strong || weak)
    buttons.push({ el: b, text: text.slice(0, 40), form, submit, typeAttr, saveLike, strong, ov })
  }

  // scopes: from each Save-like button, the smallest ancestor holding real fields
  const scopeOf = (b) => {
    if (b.submit && b.form && real.some((f) => b.form.contains(f.el))) return b.form
    const stop = b.ov ? b.ov.el : content.contains(b.el) ? content : document.body
    for (let a = b.el.parentElement; a; a = a.parentElement) {
      if (real.some((f) => a.contains(f.el))) return a
      if (a === stop) break
    }
    return null
  }
  const scopes = new Map()
  for (const b of buttons) {
    if (!b.saveLike) continue
    const s = scopeOf(b)
    if (!s) continue
    if (!scopes.has(s)) scopes.set(s, [])
    scopes.get(s).push(b)
  }
  // A save-like button with no fields near it is an ACTION (mark shipped, approve): listed apart.
  const actions = buttons.filter((b) => b.saveLike && !scopeOf(b)).map((b) => b.text)

  // fields of a scope, without those that belong to a nested scope
  const keys = [...scopes.keys()]
  const nested = (s) => keys.filter((k) => k !== s && s.contains(k))
  const claimed = new Set()
  const surfaces = []
  const scrollParentOf = (e) => {
    for (let p = e.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const c = getComputedStyle(p)
      if (/(auto|scroll|overlay)/.test(c.overflowY)) return { sel: short(p).slice(0, 60), scrolls: p.scrollHeight > p.clientHeight + 1, client: p.clientHeight, scroll: p.scrollHeight, top: Math.round(p.getBoundingClientRect().top), bottom: Math.round(p.getBoundingClientRect().bottom) }
    }
    return null
  }
  const stickyOf = (e, stop) => {
    for (let p = e; p && p !== document.documentElement; p = p.parentElement) {
      const c = getComputedStyle(p)
      if (c.position === 'sticky' || c.position === 'fixed') return { sel: short(p).slice(0, 60), pos: c.position, top: c.top, bottom: c.bottom, z: c.zIndex }
      if (p === stop) break
    }
    return null
  }
  const clipOf = (e) => {
    const r = e.getBoundingClientRect()
    let L = Math.max(0, r.left), T = Math.max(0, r.top), R = Math.min(innerWidth, r.right), B = Math.min(innerHeight, r.bottom)
    for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (p === document.body) continue
      const c = getComputedStyle(p)
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') { const pr = p.getBoundingClientRect(); L = Math.max(L, pr.left); T = Math.max(T, pr.top); R = Math.min(R, pr.right); B = Math.min(B, pr.bottom) }
    }
    return { L, T, R, B, r }
  }
  let sid = 0
  const describeBtn = (b, stop) => {
    const e = b.el
    const k = clipOf(e), r = k.r
    const visibleArea = Math.max(0, k.R - k.L) * Math.max(0, k.B - k.T)
    const full = visibleArea >= r.width * r.height - 2
    const hit = (() => { if (visibleArea <= 0) return false; const h = document.elementFromPoint((k.L + k.R) / 2, (k.T + k.B) / 2); return !!h && (h === e || e.contains(h)) })()
    const c = getComputedStyle(e)
    const bg = rgba(c.backgroundColor)
    const mx = Math.max(bg[0], bg[1], bg[2]), mn = Math.min(bg[0], bg[1], bg[2])
    return {
      text: b.text, sel: short(e) + (b.typeAttr ? '[type=' + b.typeAttr + ']' : ''), type: e.type || '', typeAttr: b.typeAttr || '(none)', submit: b.submit, inForm: !!(b.form && b.form.contains(e)), formAttr: e.hasAttribute('form'),
      disabled: e.disabled === true, ariaDisabled: e.getAttribute('aria-disabled') || '', ariaBusy: e.getAttribute('aria-busy') || '', dataState: e.getAttribute('data-state') || e.getAttribute('data-loading') || '',
      primary: bg[3] > 0.3 && mx - mn > 60, bg: bg[3] > 0.3 ? hex(bg) : '-', cls: cn(e).slice(0, 110),
      top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height),
      visible: visibleArea > 0, fully: full, hit, need: Math.max(0, Math.round(r.bottom - k.B)),
      sticky: stickyOf(e, stop), scroller: scrollParentOf(e),
    }
  }
  const rootInfo = (s) => {
    const r = s.getBoundingClientRect()
    return { sel: short(s).slice(0, 80), tag: s.tagName.toLowerCase(), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }
  }
  const fieldSummary = (list) => {
    const kinds = {}
    for (const f of list) kinds[f.kind] = (kinds[f.kind] || 0) + 1
    return { n: list.length, kinds, labels: list.slice(0, 5).map((f) => f.label).filter(Boolean), disabled: list.filter((f) => f.disabled).length }
  }
  const tag = (list, id) => {
    // prefer a switch / select / checkbox (an autosave suspect), then a plain text field, then any
    const rank = (f) => ({ switch: 0, checkbox: 0, radio: 1, select: 1, number: 3, text: 3, textarea: 4 }[f.kind] ?? 5)
    const pick = [...list].filter((f) => !f.disabled && !f.readonly).sort((a, b) => rank(a) - rank(b))
    const chosen = []
    const sw = pick.find((f) => rank(f) <= 1), tx = pick.find((f) => rank(f) >= 3)
    if (sw) chosen.push(sw); if (tx && tx !== sw) chosen.push(tx)
    chosen.forEach((f, i) => f.el.setAttribute('data-scan-f', id + '.' + i))
    return chosen.length
  }

  for (const [s, bs] of scopes) {
    const inner = nested(s)
    const mine = real.filter((f) => s.contains(f.el) && !inner.some((n) => n.contains(f.el)))
    if (!mine.length) continue            // everything in it belongs to a nested surface
    mine.forEach((f) => claimed.add(f.el))
    const id = 's' + (++sid)
    const ov = inOverlay(s) || (bs[0] && bs[0].ov)
    const stop = ov ? ov.el : null
    const inRow = !!s.closest('tr')
    const isForm = s.tagName === 'FORM'
    const kind = ov ? (isForm ? 'modal-form' : 'modal-group') : inRow ? 'row' : isForm ? 'form' : 'group'
    // the Save to mirror: a submit button of the form, else the last primary Save-like button
    const ranked = [...bs].sort((a, c) => (Number(c.submit) - Number(a.submit)) || (Number(c.strong) - Number(a.strong)))
    const primaryList = bs.filter((b) => { const bg = rgba(getComputedStyle(b.el).backgroundColor); return bg[3] > 0.3 && Math.max(bg[0], bg[1], bg[2]) - Math.min(bg[0], bg[1], bg[2]) > 60 })
    const best = (primaryList.length ? primaryList[primaryList.length - 1] : ranked[0])
    best.el.setAttribute('data-scan-save', id)
    surfaces.push({
      id, kind, root: rootInfo(s), overlay: ov ? { sel: short(ov.el).slice(0, 70), z: ov.z, parent: ov.el.parentElement === document.body ? 'body' : ov.el.parentElement.tagName.toLowerCase() + (ov.el.parentElement.id ? '#' + ov.el.parentElement.id : ''), rect: [Math.round(ov.r.left), Math.round(ov.r.top), Math.round(ov.r.width), Math.round(ov.r.height)], role: ov.el.getAttribute('role') || '', ariaModal: ov.el.getAttribute('aria-modal') || '' } : null,
      fields: fieldSummary(mine), filters: fields.filter((f) => f.filter && s.contains(f.el)).length,
      probeFields: tag(mine, id),
      saves: bs.map((b) => describeBtn(b, stop)), save: describeBtn(best, stop), nSaves: bs.length,
      otherButtons: [...new Set(buttons.filter((b) => s.contains(b.el) && !bs.includes(b)).map((b) => b.text).filter(Boolean))].slice(0, 8),
      hasNestedSurface: inner.length,
    })
  }
  // Orphans: fields claimed by no Save. One per form / card.
  const orphanGroups = new Map()
  for (const f of real) {
    if (claimed.has(f.el)) continue
    let g = f.el.closest('form')
    if (!g) { for (let a = f.el.parentElement; a && a !== content && a !== document.body; a = a.parentElement) { const c = getComputedStyle(a); const card = a.matches('section, fieldset, li, article, tr, [role=dialog]') || (parseFloat(c.borderTopWidth) > 0 && parseFloat(c.borderLeftWidth) > 0) || (c.boxShadow && c.boxShadow !== 'none'); if (card) { g = a; break } } }
    if (!g) g = (inOverlay(f.el) || {}).el || content
    if (!orphanGroups.has(g)) orphanGroups.set(g, [])
    orphanGroups.get(g).push(f)
  }
  for (const [g, list] of orphanGroups) {
    const id = 's' + (++sid)
    const ov = inOverlay(g) || inOverlay(list[0].el)
    const inRow = !!g.closest('tr')
    const kind = (ov ? 'modal-' : '') + (inRow ? 'cell' : g.tagName === 'FORM' ? 'form' : 'group') + '-nosave'
    surfaces.push({
      id, kind, root: rootInfo(g), overlay: ov ? { sel: short(ov.el).slice(0, 70), z: ov.z, parent: ov.el.parentElement === document.body ? 'body' : ov.el.parentElement.tagName.toLowerCase(), rect: [Math.round(ov.r.left), Math.round(ov.r.top), Math.round(ov.r.width), Math.round(ov.r.height)], role: ov.el.getAttribute('role') || '', ariaModal: ov.el.getAttribute('aria-modal') || '' } : null,
      fields: fieldSummary(list), filters: 0, probeFields: tag(list, id), saves: [], save: null, nSaves: 0,
      otherButtons: [...new Set(buttons.filter((b) => g.contains(b.el)).map((b) => b.text).filter(Boolean))].slice(0, 8), hasNestedSurface: 0,
    })
  }
  // Filters (search boxes) are not edit surfaces; counted so nobody wonders.
  const filterCount = fields.filter((f) => f.filter).length
  // Every overlay on the page with what is in it: modals with fields are surfaces above; the rest
  // are confirm dialogs, the phone nav drawer, detail drawers.
  const quiet = overlays.map((o) => {
    const fc = [...o.el.querySelectorAll(FIELD)].filter(vis).length
    const cs = getComputedStyle(o.el)
    return { sel: short(o.el).slice(0, 70), z: o.z, fields: fc, buttons: [...o.el.querySelectorAll('button')].filter(vis).map((b) => clean(b.textContent).slice(0, 18)).slice(0, 6), rect: [Math.round(o.r.left), Math.round(o.r.top), Math.round(o.r.width), Math.round(o.r.height)], parent: o.el.parentElement === document.body ? 'body' : o.el.parentElement.tagName.toLowerCase() + (o.el.parentElement.id ? '#' + o.el.parentElement.id : ''), scrolls: o.el.scrollHeight > o.el.clientHeight + 1, ovY: cs.overflowY, bodyOverflow: getComputedStyle(document.body).overflow }
  })
  const allButtons = [...new Set(buttons.map((b) => b.text).filter(Boolean))]
  const h1 = document.querySelector('h1, h2')
  return { surfaces, actions: [...new Set(actions)], overlays: quiet, filterCount, buttons: allButtons, heading: h1 ? clean(h1.textContent).slice(0, 40) : '', docH: document.scrollingElement.scrollHeight, innerH: innerHeight, innerW: innerWidth, fieldTotal: real.length }
}

// ---------------------------------------------------------------- the walk
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] })
const VIEWS = [['desktop', 1280, 800, false], ['phone', 390, 844, true]].filter((v) => !process.env.SCAN_VIEWS || process.env.SCAN_VIEWS.split(',').includes(v[0]))
const result = {}   // vn -> { nav, shell, screens: [{ name, href, steps: [{ name, m }] }] , dialogs, listeners, unknown }

for (const [vn, w, h, mob] of VIEWS) {
  // serviceWorkers blocked: the live site registers sw.js, and a worker's own fetches would bypass the mock below
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1, locale: 'en-US', serviceWorkers: 'block' })
  const pg = await ctx.newPage()
  pg.setDefaultTimeout(5000)
  const R = result[vn] = { nav: null, navAfterOpen: null, shell: {}, screens: [], dialogs: [], listeners: new Set(), unknown: new Map(), errs: new Set(), writes: [] }
  let hold = 0                       // ms the mock holds a write's answer (the busy probe)
  let context = ''                   // what the scan is doing, for the logs
  await pg.addInitScript(() => {
    window.__scanL = []
    const add = EventTarget.prototype.addEventListener
    EventTarget.prototype.addEventListener = function (type, fn, opts) { if (type === 'beforeunload' || type === 'popstate' || type === 'keydown' && this === window) window.__scanL.push(type + (this === window ? '@window' : this === document ? '@document' : '')); return add.call(this, type, fn, opts) }
  })
  pg.on('pageerror', (e) => R.errs.add(e.message.slice(0, 80)))
  pg.on('dialog', (d) => { R.dialogs.push(`${context}: ${d.type()} "${d.message().slice(0, 70)}"`); d.dismiss().catch(() => {}) })
  await pg.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url())
    if (u.origin !== BASE) return route.continue()
    const method = req.method()
    if (u.pathname.includes('/api/admin')) {
      const r = u.searchParams.get('r') || ''
      if (method !== 'GET') {
        R.writes.push({ r, t: Date.now(), ctx: context })
        if (hold) await wait(hold)
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      }
      if (!(r in MOCK)) R.unknown.set(r, (R.unknown.get(r) || new Set()).add(context.split('/')[0]))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK[r] ?? []) })
    }
    if (method !== 'GET' && method !== 'HEAD') { R.writes.push({ r: u.pathname, t: Date.now(), ctx: context }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) }
    return route.continue()
  })

  const load = async () => {
    await pg.goto(BASE + '/backends', { waitUntil: 'networkidle' })
    await pg.waitForTimeout(700)
  }
  const openMenu = async () => {
    const m = pg.locator('button:visible, [role=button]:visible').filter({ hasText: /Open menu|☰|≡|menu|\bmore\b|المزيد/i }).first()
    if (await m.count()) { await m.click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(450); return true }
    const a = pg.locator('button[aria-label*="menu" i]:visible').first()
    if (await a.count()) { await a.click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(450); return true }
    return false
  }
  const closeMenu = async () => {
    const c = pg.locator('button:visible').filter({ hasText: /Close menu|✕/ }).first()
    if (await c.count()) await c.click({ timeout: 3000 }).catch(() => {})
    else await pg.keyboard.press('Escape').catch(() => {})
    await pg.waitForTimeout(350)
  }
  const goScreen = async (item) => {
    await load()
    let ok = await pg.evaluate(inPageClickNav, item)
    if (!ok && mob) { await openMenu(); ok = await pg.evaluate(inPageClickNav, item) }
    await pg.waitForTimeout(1200)
    if (mob) await closeMenu()
    return ok
  }

  // ---- nav, from the page
  await load()
  R.nav = await pg.evaluate(inPageNav)
  R.shell.load = await pg.evaluate(inPageShell)
  if (mob && R.nav.items.every((i) => !i.vis)) {
    if (await openMenu()) { R.navAfterOpen = await pg.evaluate(inPageNav); R.shell.menuOpen = await pg.evaluate(inPageShell); await closeMenu() }
  }
  const items = []
  for (const it of R.nav.items) {
    if (/^(sign ?out|log ?out|view (site|store)|open (site|store)|close menu|open menu|عربي|العربية|English)$/i.test(it.text)) continue
    if (it.href && !/^\/backends|^#/.test(it.href) && !/^\/?$/.test(it.href)) continue      // leaves the admin
    if (it.target === '_blank') continue
    if (items.some((x) => x.text === it.text && (x.href || '') === (it.href || ''))) continue
    items.push({ text: it.text, href: it.href || '' })
  }
  if (DEBUG) console.log(`.. ${vn} nav ${items.length}: ${items.map((i) => i.text).join(' | ')}`)

  for (const item of items) {
    if (ONLY && !ONLY.includes(item.text.toLowerCase())) continue
    const scr = { name: item.text, href: item.href, steps: [], opened: false, shell: null, buttonsAll: new Set() }
    R.screens.push(scr)
    context = item.text
    if (!(await goScreen(item))) { scr.error = 'nav item could not be clicked'; continue }
    scr.opened = true
    scr.shell = await pg.evaluate(inPageShell)
    const openers = (await pg.evaluate(inPageOpeners)).slice(0, MAX_OPENERS)
    const seen = new Set()
    const stepList = [{ name: 'load', op: null }, ...openers.map((op) => ({ name: op.kind === 'row' ? 'row' : op.kind === 'tab' ? 'tab:' + op.text : op.text, op }))]
    for (let si = 0; si < stepList.length; si++) {
      const st = stepList[si]
      context = `${item.text}/${st.name}`
      if (si > 0) {
        if (!(await goScreen(item))) break
        const clicked = await pg.evaluate(inPageClickOpener, st.op)
        await pg.waitForTimeout(clicked ? 900 : 100)
        if (!clicked) { scr.steps.push({ name: st.name, skipped: 'opener not found after reload' }); continue }
      }
      let m
      try { m = await pg.evaluate(inPageMeasure) } catch (e) { scr.steps.push({ name: st.name, error: e.message.slice(0, 100) }); continue }
      // only what this step adds: a surface seen in an earlier step is not repeated
      const sig = (s) => [s.kind, s.root.sel, s.fields.n, s.save ? s.save.text : '-'].join('|')
      // new in this step; repeated rows share a signature, so only the first of each is probed
      const freshSigs = new Set(m.surfaces.map(sig).filter((g) => !seen.has(g)))
      const fresh = []
      for (const s of m.surfaces) if (freshSigs.has(sig(s)) && !fresh.some((f) => sig(f) === sig(s))) fresh.push(s)
      m.surfaces.forEach((s) => seen.add(sig(s)))
      const step = { name: st.name, m, fresh: fresh.map((s) => s.id), freshSigs: [...freshSigs], sig }
      m.buttons.forEach((b) => scr.buttonsAll.add(b))
      // ---- probes (desktop): does a change write by itself? what does a pending Save look like?
      if ((vn === 'desktop' ? PROBE : PROBE_PHONE) && fresh.length) {
        for (const s of fresh) {
          s.auto = []
          for (let k = 0; k < s.probeFields; k++) {
            const sel = `[data-scan-f="${s.id}.${k}"]`
            const info = await pg.evaluate((q) => { const e = document.querySelector(q); return e ? { tag: e.tagName.toLowerCase(), type: (e.getAttribute('type') || '').toLowerCase(), value: e.value, checked: e.checked, options: e.options ? e.options.length : 0, role: e.getAttribute('role') || '' } : null }, sel)
            if (!info) continue
            const before = R.writes.length
            let how = ''
            try {
              if (info.type === 'checkbox' || info.type === 'radio' || info.role === 'switch' || info.role === 'checkbox') { how = 'click'; await pg.evaluate((q) => document.querySelector(q).click(), sel) }
              else if (info.tag === 'select' && info.options > 1) { how = 'select'; await pg.locator(sel).selectOption({ index: 1 }, { timeout: 1500 }) }
              else if (info.tag === 'input' || info.tag === 'textarea') {
                if (info.type === 'number') { how = 'type'; await pg.locator(sel).fill(String((Number(info.value) || 0) + 1), { timeout: 1500 }) }
                else { how = 'type'; await pg.locator(sel).fill((info.value || '') + 'x', { timeout: 1500 }) }
              }
            } catch (e) { s.auto.push(`${how || 'probe'}:err`); continue }
            await pg.waitForTimeout(650)
            const onChange = R.writes.slice(before)
            let res = onChange.length ? `${how}->WRITE(${onChange.map((x) => x.r).join(',')})` : `${how}->none`
            if (!onChange.length && how === 'type') {
              const b2 = R.writes.length
              await pg.locator(sel).blur({ timeout: 1000 }).catch(() => {}); await pg.evaluate((q) => { const e = document.querySelector(q); if (e) e.blur() }, sel)
              await pg.waitForTimeout(550)
              const onBlur = R.writes.slice(b2)
              res = onBlur.length ? `type->blur->WRITE(${onBlur.map((x) => x.r).join(',')})` : 'type->none(+blur)'
            }
            s.auto.push(res)
          }
        }
        // busy probe on the first fresh surface with an enabled Save: hold the answer, sample the button
        const target = fresh.find((s) => s.save && !s.save.disabled)
        if (target) {
          const q = `[data-scan-save="${target.id}"]`
          const sample = () => pg.evaluate((qq) => { const e = document.querySelector(qq); if (!e) return null; const c = getComputedStyle(e); return { text: (e.textContent || '').trim().slice(0, 24), dis: e.disabled, aria: e.getAttribute('aria-disabled') || '', busy: e.getAttribute('aria-busy') || '', opacity: c.opacity, cursor: c.cursor, cls: String(e.className).slice(0, 90), spinner: !!e.querySelector('svg.animate-spin, .animate-spin, [class*="spin"]'), form: e.form ? e.form.checkValidity() : null } }, q)
          const pre = await sample()
          hold = 1400
          const before = R.writes.length
          let how = 'click'
          try { await pg.evaluate((qq) => document.querySelector(qq).click(), q) } catch (e) { how = 'click-err' }
          await pg.waitForTimeout(220)
          const mid = await sample()
          const fired = R.writes.length > before
          await pg.waitForTimeout(1500)
          hold = 0
          const post = await sample()
          target.busy = { how, pre, mid, post, fired }
        }
      }
      scr.steps.push(step)
    }
  }
  R.listeners = new Set(await pg.evaluate(() => window.__scanL || []).catch(() => []))
  await ctx.close()
}
await browser.close()

// ---------------------------------------------------------------- report
// Desktop and phone are merged: one line per surface with both positions. The
// VPS keeps only the last 300 log lines, so the screens come first and the
// patterns (nav, shell, fixed bars, dialogs) last.
const L = []
const out = (s) => L.push(s)
const j = (o) => JSON.stringify(o)
const posOf = (b) => b ? `y${b.bottom}${b.visible ? (b.fully ? '' : '~part') : '~HIDDEN'}${b.hit ? '' : '~COVERED'}${b.need ? ' +' + b.need + 'px' : ' inview'}${b.sticky ? ' STICKY(' + b.sticky.pos + ' ' + b.sticky.sel + ')' : ''}${b.scroller ? ' [scroller ' + (b.scroller.scrolls ? 'scrolls ' : 'fits ') + b.scroller.sel + ']' : ''}` : '-'
const fieldsTxt = (f) => `${f.n}f{${Object.entries(f.kinds).map(([k, v]) => k + (v > 1 ? 'x' + v : '')).join(',')}}${f.disabled ? ' dis' + f.disabled : ''}`
const btnTxt = (b) => b ? `"${b.text}" ${b.sel.slice(0, 64)} ${b.inForm ? (b.submit ? 'SUBMIT-in-form' : 'btn-in-form') : 'onClick-only'}${b.formAttr ? '(form=)' : ''} ${b.disabled ? 'DISABLED' : 'on'}${b.primary ? ' ' + b.bg : ''} ${b.w}x${b.h}` : 'NO-SAVE'
const st1 = (x) => x ? `${x.text}/${x.dis ? 'dis' : 'en'}${x.aria ? '/aria-disabled=' + x.aria : ''}${x.busy ? '/aria-busy=' + x.busy : ''}/op${x.opacity}/${x.cursor}${x.spinner ? '/spinner' : ''}` : 'gone'

const both = VIEWS.map((v) => v[0])
const D = result.desktop || result[both[0]], Ph = result.phone
for (const sd of D.screens) {
  const sp = Ph ? Ph.screens.find((x) => x.name === sd.name) : null
  if (!sd.opened) { out(`S|${sd.name}|NOT OPENED ${sd.error || ''}`); continue }
  const f = sd.shell ? `docH ${sd.shell.docH}${sp && sp.shell ? '/' + sp.shell.docH : ''} fixed:${sd.shell.fixed.filter((x) => !x.inSide).map((x) => x.sel.slice(0, 34) + (x.atBottom ? '@bottom' : x.atTop ? '@top' : '')).join(',') || '-'}` : ''
  out(`S|${sd.name}|${sd.href}| ${f}`)
  for (const st of sd.steps) {
    if (st.skipped || st.error) { out(`  step "${st.name}": ${st.skipped || st.error}`); continue }
    const m = st.m
    const stp = sp ? sp.steps.find((x) => x.name === st.name) : null
    const mp = stp && stp.m ? stp.m : null
    const fresh = m.surfaces.filter((x) => st.freshSigs.includes(st.sig(x)))
    if (st.name !== 'load' && !fresh.length && !m.overlays.length) { out(`  step "${st.name}": nothing new (fields ${m.fieldTotal}, actions[${m.actions.join('/')}])`); continue }
    out(`  step "${st.name}": fields ${m.fieldTotal} filters ${m.filterCount} surfaces ${m.surfaces.length}${mp ? '/' + mp.surfaces.length + 'ph' : ''} overlays ${m.overlays.length} actions[${m.actions.join('/')}]`)
    for (const ov of m.overlays) out(`    overlay ${j(ov)}`)
    // rows that repeat (one per product, one per SKU) stand for each other: print the first, count the rest
    const sigOf = (x) => [x.kind, x.root.sel, x.fields.n, x.save ? x.save.text : '-'].join('|')
    const groups = new Map()
    for (const x of fresh) groups.set(sigOf(x), [...(groups.get(sigOf(x)) || []), x])
    for (const [, grp] of groups) {
      const su = grp[0]
      const pu = mp ? mp.surfaces[m.surfaces.indexOf(su)] : null
      out(`    ${su.id}${grp.length > 1 ? ' x' + grp.length : ''} ${su.kind} ${su.root.sel} ${su.root.w}x${su.root.h}@y${su.root.top} ${fieldsTxt(su.fields)} [${su.fields.labels.join('; ')}] saves ${su.nSaves}${su.hasNestedSurface ? ' nested' + su.hasNestedSurface : ''}${su.overlay ? ' IN-OVERLAY ' + su.overlay.sel + ' z' + su.overlay.z + ' parent ' + su.overlay.parent : ''}`)
      if (su.save) {
        out(`      SAVE ${btnTxt(su.save)}`)
        out(`      D ${posOf(su.save)}`)
        out(`      P ${pu && pu.save ? posOf(pu.save) : pu ? 'phone surface has no save' : 'no matching phone surface'}`)
      } else out(`      NO-SAVE; buttons nearby: ${su.otherButtons.join(' / ') || 'none'}${pu ? '; phone kind ' + pu.kind : ''}`)
      for (const b of su.saves.filter((x) => su.save && (x.sel !== su.save.sel || x.text !== su.save.text))) out(`      also ${btnTxt(b)} | D ${posOf(b)}`)
      if (su.auto && su.auto.length) out(`      autosave: ${su.auto.join(' ; ')}`)
      if (su.busy) out(`      busy(${su.busy.how}, write fired ${su.busy.fired}): pre ${st1(su.busy.pre)} | pending ${st1(su.busy.mid)} | after ${st1(su.busy.post)}${su.busy.mid && su.busy.mid.form === false ? ' | form invalid -> native validation blocks' : ''}`)
    }
  }
  out(`  buttons: ${[...sd.buttonsAll].slice(0, 36).join(' / ')}`)
}
const pat = (R, vn) => {
  out(`P|${vn}|sidebar ${j(R.nav.side)}`)
  out(`P|${vn}|nav items ${R.nav.items.length}: ${R.nav.items.map((i) => i.text + (i.vis ? '' : '*') + (i.href ? ' ' + i.href : '')).join(' | ').slice(0, 700)}  (* = not visible at load)`)
  if (R.nav.menuBtn) out(`P|${vn}|menu button ${j(R.nav.menuBtn)}`)
  out(`P|${vn}|tab bar ${j(R.nav.tabbar)} | header ${j(R.nav.header)}`)
  if (R.navAfterOpen) out(`P|${vn}|menu open: sidebar ${j(R.navAfterOpen.side)}; visible items ${R.navAfterOpen.items.filter((i) => i.vis).length}/${R.navAfterOpen.items.length}`)
  out(`P|${vn}|walked ${R.screens.filter((s) => s.opened).length}/${R.screens.length}; not opened: ${R.screens.filter((s) => !s.opened).map((s) => s.name).join(', ') || 'none'}; page errors: ${[...R.errs].join(' ; ') || 'none'}`)
  out(`P|${vn}|unmocked GET r=: ${[...R.unknown.entries()].map(([k, v]) => k + '(' + [...v].join('/') + ')').join(' ') || 'none'}`)
  out(`P|${vn}|browser dialogs: ${R.dialogs.slice(0, 10).join(' ; ') || 'none'} | listeners: ${[...R.listeners].join(',') || 'none'}`)
  for (const [name, sh] of Object.entries(R.shell)) if (sh) {
    out(`P|${vn}|shell@${name} ${sh.w}x${sh.h} docH ${sh.docH} windowScrolls ${sh.winScrolls} dir ${j(sh.dir)} viewportMeta "${sh.viewportMeta}" manifest ${sh.manifest} env(safe-area-inset-bottom)=${sh.envBottom}`)
    out(`P|${vn}|scrollers@${name}: ${sh.scrollers.map((x) => `${x.sel} ${x.overflowY} ${x.client}/${x.scroll}${x.overflows ? ' OVERFLOWS' : ''}`).join(' ; ') || 'none (the window scrolls)'}`)
    out(`P|${vn}|boxes@${name}: shell ${j(sh.shell)} content ${j(sh.content)} body ${j(sh.body)} root ${j(sh.root)}`)
    out(`P|${vn}|fixed@${name}: ${sh.fixed.map((x) => `${x.sel} ${x.pos} z${x.z} [${x.rect}]${x.atBottom ? ' AT-BOTTOM' : ''}${x.atTop ? ' at-top' : ''}${x.inSide ? ' in-sidebar' : ''} f${x.fields}b${x.buttons} "${x.text}"`).join(' ;; ') || 'none'}`)
  }
}
for (const [vn] of VIEWS) pat(result[vn], vn)
for (const l of L) console.log(l.length > 1400 ? l.slice(0, 1400) + '…' : l)
console.log('ADMIN_SAVE_SCAN_DONE')
