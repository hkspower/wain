#!/usr/bin/env node
// ADMIN STYLE SCAN — read-only. Run ON the VPS in the Playwright image (the
// sandbox cannot reach www.sporta.com.kw):
//
//   npm i playwright@1.49.0 && node admin-style-scan.mjs [base] [--css file.css]
//
// Opens /backends, answers EVERY /api/admin.php call from a mock in the browser
// (synthetic orders and customers; products, brands and stock come from the
// public API), and walks each screen of the live compiled admin on a desktop
// and a phone viewport. Nothing signs in and nothing reaches the real admin:
// any non-GET request to the site is answered locally too, so a button the
// scan presses cannot write anything.
//
// For each screen it inventories, as grouped "signatures" with counts:
//   INPUT   text inputs, selects, textareas: font size, line height, colour,
//           placeholder colour, height, padding, border, radius, contrast;
//   BUTTON  every visible button-like control: size, padding, radius, colours,
//           contrast, and tap-target height;
//   FONT    the font-size histogram of all visible text;
//   COLOUR  every non-neutral colour still in use (the owner asked for slate +
//           indigo only, rose for errors), with where it comes from;
//   LOW     text whose contrast against its real background is under WCAG AA;
//   NAME    how product names render in Catalogue (size, weight, truncation);
//   BOX     every card, panel, notice, table frame and modal: radius, border,
//           shadow, fill, padding, nesting — and what is wrong with them
//           (content spilling or clipped, off the phone screen, text touching
//           the edge, near-miss left edges, uneven rows, uneven gaps);
//   TABLE   every table: frame vs its box (scrolls? spills?), header and cell
//           styles, row heights, and per column the header/cell alignment,
//           numeric share (and tabular figures), wrapping, cut-off cells, width.
//
// --css (or SCAN_CSS_GZ, gzip+base64) injects a stylesheet (bypassCSP) before scanning, so a fix can be
// measured on the live admin before it is deployed. Lines start with == / ok /
// WARN so the output greps cleanly.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const args = process.argv.slice(2)
const cssAt = args.indexOf('--css')
const CSS = cssAt >= 0 ? readFileSync(args[cssAt + 1], 'utf8')
  : process.env.SCAN_CSS_GZ ? gunzipSync(Buffer.from(process.env.SCAN_CSS_GZ, 'base64')).toString()
  : process.env.SCAN_CSS_B64 ? Buffer.from(process.env.SCAN_CSS_B64, 'base64').toString() : ''
const BASE = (args.find((a, i) => !a.startsWith('--') && !(cssAt >= 0 && i === cssAt + 1)) || 'https://www.sporta.com.kw').replace(/\/$/, '')
const ONLY = process.env.SCAN_ONLY ? process.env.SCAN_ONLY.split(',') : null

const pub = async (r) => { try { return await (await fetch(`${BASE}/api/api.php?r=${r}`)).json() } catch { return [] } }
const [products, brands, stock, theme] = await Promise.all([pub('products'), pub('brands'), pub('stock'), pub('theme')])
const P = Array.isArray(products) ? products : []

// ---------------------------------------------------------------- mock data
// Synthetic, plausible, and in the shapes admin.php returns (checked against
// the sandbox): enough rows that tables, badges and buttons actually render.
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
  slides: { slides: [], hero: { speed_ms: 6500, shuffle: false, size: 'tall', autoplay: true } },
  checkout_settings: { delivery_fee: 1, methods: ['knet', 'tpay', 'cod'], default_method: 'knet', notice_en: '', notice_ar: '' },
  // The live theme is public (api.php?r=theme), so the Theme screen shows the real one.
  theme_settings: theme && !Array.isArray(theme) && theme.brand ? theme : { brand: '#c76a42', accent: '#99452b', canvas: '#ffffff', radius: '16', dark: false, fonts: { body_en: 'plex', display_en: 'alexandria', body_ar: 'plex', display_ar: 'alexandria' } },
  topbar_settings: { enabled: true, text_en: 'Delivery within 24 hours in Kuwait', text_ar: 'التوصيل خلال ٢٤ ساعة داخل الكويت', href: '/shop', starts_at: null, ends_at: null, tone: 'brand', show_dot: true, alignment: 'center' },
  seo_settings: { pages: Object.fromEntries(['/', '/shop', '/about', '/contact', '/returns', '/terms', '/privacy'].map((p) => [p, { title_en: '', title_ar: '', description_en: '', description_ar: '', image: '' }])) },
  // Returns, Support and Profiles get rows too, in the shapes returns.php,
  // support.php and profiles.php return — an empty table measures nothing.
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
  payment_identifiers: { env: 'test', test: { merchant_id: '', terminal_id: '' }, production: { merchant_id: '', terminal_id: '' } },
  payment_server_ips: { server_ip_1: '', server_ip_2: '' },
  payment_knet_via_cbk: { enabled: false, tpay_ready: false },
}

// ---------------------------------------------------------------- collector
// Runs in the page. Returns raw per-element records; Node groups them.
function collect() {
  const out = { inputs: [], buttons: [], text: [], colours: [], names: [], radii: [], boxes: [], boxIssues: [], tables: [] }
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const c = getComputedStyle(el); return c.visibility !== 'hidden' && c.display !== 'none' && +c.opacity > 0.05 }
  // Colours come back as oklch()/oklab() from Tailwind v4, so parse nothing
  // by hand: paint the colour into a 1x1 canvas and read the pixel back.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true }), memo = new Map()
  const rgba = (c) => {
    if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return [0, 0, 0, 0]
    if (memo.has(c)) return memo.get(c)
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1)
    const d = cx.getImageData(0, 0, 1, 1).data, v = [d[0], d[1], d[2], d[3] / 255]
    memo.set(c, v); return v
  }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  // The colour actually behind an element: first opaque background up the tree.
  // A gradient counts: average its colour stops (the sidebar is a gradient on a
  // transparent background-color, and ignoring it reads white-on-white).
  const stops = (img) => (img.match(/(?:rgba?|oklch|oklab|hsla?|color)\([^()]*(?:\([^()]*\)[^()]*)*\)|#[0-9a-f]{3,8}\b/gi) || []).map(rgba).filter((c) => c[3] > 0.5)
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e); const img = c.backgroundImage && c.backgroundImage !== 'none' && /gradient/.test(c.backgroundImage) ? stops(c.backgroundImage) : []; if (img.length) return [0, 1, 2].map((i) => Math.round(img.reduce((a, x) => a + x[i], 0) / img.length)); const p = rgba(c.backgroundColor); if (p[3] > 0.85) return p.slice(0, 3) } return [255, 255, 255] }
  const klass = (el) => String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).trim().replace(/\s+/g, ' ').slice(0, 220)
  const fg = (c) => rgba(c)
  const blend = (c, bg) => (c.length >= 4 && c[3] < 1 ? [0, 1, 2].map((i) => Math.round(c[i] * c[3] + bg[i] * (1 - c[3]))) : c.slice(0, 3))
  const hex = (p) => '#' + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const cls = (el) => `${el.tagName.toLowerCase()}.${String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).trim().split(/\s+/).slice(0, 5).join('.')}`
  // hue of an rgb triple; null when (near) neutral.
  // Chroma (max-min) under 60 is neutral: Tailwind v4's slate is faintly blue
  // (slate-500 #62748e has chroma 44), amber/rose/indigo are all over 180.
  const hue = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 60 || mx < 30) return null; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return h < 0 ? h + 360 : h }
  const family = (h) => h === null ? 'neutral' : (h >= 222 && h <= 262) ? 'indigo' : (h >= 330 || h <= 12) ? 'rose/red' : 'OTHER'
  const root = document.querySelector('.admin-content') || document.querySelector('main') || document.body
  const shell = document.querySelector('.admin-shell') || document.body

  for (const el of root.querySelectorAll('input, select, textarea')) {
    const t = (el.getAttribute('type') || el.tagName).toLowerCase()
    if (['checkbox', 'radio', 'hidden', 'file', 'range', 'color', 'submit', 'button'].includes(t) || !vis(el)) continue
    const c = getComputedStyle(el), r = el.getBoundingClientRect(), bg = bgOf(el), col = blend(fg(c.color), bg)
    let ph = null; try { ph = el.placeholder ? blend(fg(getComputedStyle(el, '::placeholder').color), bg) : null } catch {}
    const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`))
    const lc = lab ? getComputedStyle(lab.querySelector('span') || lab) : null
    out.inputs.push({ sig: `${t} fs ${c.fontSize} lh ${c.lineHeight} fw ${c.fontWeight} col ${hex(col)} h ${Math.round(r.height)} pad ${c.paddingTop}/${c.paddingLeft} bd ${c.borderTopWidth} ${hex(rgba(c.borderTopColor))} rad ${c.borderTopLeftRadius} bg ${hex(bg)}${c.fontFamily.includes('mono') ? ' MONO' : ''}`,
      fs: parseFloat(c.fontSize), h: r.height, text: ratio(col, bg), ph: ph ? ratio(ph, bg) : null, phcol: ph ? hex(ph) : '', label: lc ? `${lc.fontSize}/${lc.fontWeight}/${hex(blend(fg(lc.color), bgOf(lab)))}` : '-', cl: klass(el), lcl: lab ? klass(lab) + ' > ' + (lab.querySelector('span') ? klass(lab.querySelector('span')) : '') : '', ex: (el.placeholder || el.name || el.getAttribute('aria-label') || '').slice(0, 24) })
  }
  const btnSel = 'button, [role="button"], a[class*="rounded"][class*="px-"], a[class*="btn"], label[class*="rounded"][class*="px-"]'
  for (const el of shell.querySelectorAll(btnSel)) {
    if (!vis(el)) continue
    const c = getComputedStyle(el), r = el.getBoundingClientRect(), bg = bgOf(el), col = blend(fg(c.color), bg)
    const own = rgba(c.backgroundColor), solid = own[3] > 0.3
    const kind = solid && hue(own.slice(0, 3)) !== null ? 'solid' : solid && lum(own.slice(0, 3)) < 0.3 ? 'dark' : (parseFloat(c.borderTopWidth) > 0 && c.borderTopStyle !== 'none') ? 'outline' : solid ? 'tint' : 'text'
    out.buttons.push({ sig: `${kind} fs ${c.fontSize} fw ${c.fontWeight} h ${Math.round(r.height)} pad ${c.paddingTop}/${c.paddingLeft} rad ${c.borderTopLeftRadius} bg ${solid ? hex(own) : '-'} col ${hex(col)}${kind === 'outline' ? ' bd ' + hex(rgba(c.borderTopColor)) : ''}`,
      h: r.height, w: r.width, text: ratio(col, solid ? blend(own, bg) : bg), label: (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 22), nav: !!el.closest('nav, aside'), cl: el.tagName.toLowerCase() + ' ' + klass(el) })
  }
  const walker = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || seen.has(el) || !n.textContent.trim() || !vis(el)) continue
    seen.add(el)
    const c = getComputedStyle(el), bg = bgOf(el), col = blend(fg(c.color), bg), fs = parseFloat(c.fontSize), bold = +c.fontWeight >= 600
    const need = fs >= 24 || (fs >= 18.66 && bold) ? 3 : 4.5
    out.text.push({ fs: c.fontSize, fw: c.fontWeight, col: hex(col), r: ratio(col, bg), need, t: n.textContent.trim().slice(0, 26), at: cls(el), bg: hex(bg) })
  }
  for (const el of shell.querySelectorAll('*')) {
    if (!vis(el)) continue
    const c = getComputedStyle(el)
    for (const [k, v] of [['text', c.color], ['bg', c.backgroundColor], ['border', parseFloat(c.borderTopWidth) > 0 ? c.borderTopColor : '']]) {
      if (!v) continue; const p = rgba(v); if (p[3] < 0.15) continue
      const f = family(hue(p.slice(0, 3)))
      if (f !== 'neutral' && f !== 'indigo') out.colours.push({ f, k, c: hex(p), at: cls(el) })
    }
    const rad = parseFloat(c.borderTopLeftRadius) > 9999 ? 'full' : c.borderTopLeftRadius; if (rad !== '0px' && (c.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(c.borderTopWidth) > 0)) out.radii.push({ rad })
  }
  const names = new Set((window.__scanNames || []).map((s) => s.trim()))
  for (const el of root.querySelectorAll('p, span, div, td, h3, h4, a, strong, b')) {
    if (el.children.length > 1 || !vis(el)) continue
    const t = el.textContent.trim(); if (!names.has(t)) continue
    const c = getComputedStyle(el), r = el.getBoundingClientRect()
    out.names.push({ sig: `${el.tagName.toLowerCase()} fs ${c.fontSize} fw ${c.fontWeight} lh ${c.lineHeight} col ${hex(blend(fg(c.color), bgOf(el)))} ws ${c.whiteSpace} ov ${c.textOverflow}${c.webkitLineClamp && c.webkitLineClamp !== 'none' ? ' clamp ' + c.webkitLineClamp : ''} ls ${c.letterSpacing}`, cut: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2, w: Math.round(r.width), t: t.slice(0, 30), at: cls(el), cl: klass(el), pcl: el.parentElement ? el.parentElement.tagName.toLowerCase() + ' ' + klass(el.parentElement) : '' })
  }
  // BOXES — cards, panels, notices, table frames and modals: anything that
  // draws its own edge. An edge is a FULL border (all four sides; a one-sided
  // border is a divider, not a box), a box-shadow, or an opaque background
  // that differs from what the element sits on. Controls are not boxes (the
  // BUTTON and INPUT sections cover them), and nothing under 80×32 px is
  // (that is a chip or a badge).
  const W = innerWidth
  const ctl = 'button, input, select, textarea, option, label, svg, img, canvas, video, [role="button"], td, th, tr, thead, tbody, tfoot, span, b, strong, small, code'
  const dif = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
  const shadowOf = (v) => (v === 'none' ? '-' : v.replace(/rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)/g, (m) => hex(rgba(m))).replace(/\s+/g, ' ').slice(0, 46))
  const boxSet = new Map()
  // List items and link tiles are cards too when they draw an edge; a link
  // under 120×48 is a button-like control and is left to BUTTON.
  const cands = [...root.querySelectorAll('div, section, article, aside, form, fieldset, header, footer, details, dialog, table, ul, ol, li, a, [role="dialog"]')]
    .filter((el) => el.tagName !== 'A' || (el.getBoundingClientRect().width >= 120 && el.getBoundingClientRect().height >= 48))
  for (const el of shell.querySelectorAll('[role="dialog"], dialog, .fixed')) if (!cands.includes(el)) cands.push(el)
  for (const el of cands) {
    if (el.matches(ctl) || !vis(el) || el.closest('.admin-sidebar, aside.admin-sidebar, nav')) continue
    const r = el.getBoundingClientRect(); if (r.width < 80 || r.height < 32) continue
    const c = getComputedStyle(el)
    const bws = [c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth].map(parseFloat)
    const bcol = rgba(c.borderTopColor)
    const border = bws.every((w) => w > 0) && c.borderTopStyle !== 'none' && bcol[3] > 0.1
    const shadow = c.boxShadow && c.boxShadow !== 'none'
    const own = rgba(c.backgroundColor), under = el.parentElement ? bgOf(el.parentElement) : [255, 255, 255]
    const fill = own[3] > 0.85 && dif(own, under) > 6
    const modal = (c.position === 'fixed' || el.matches('[role="dialog"], dialog')) && r.width > 200 && r.height > 100
    const table = el.tagName === 'TABLE'
    if (!border && !shadow && !fill && !modal && !table) continue
    const kind = modal ? 'modal' : table ? 'table' : 'card'
    const bg = own[3] > 0.85 ? own.slice(0, 3) : bgOf(el)
    const rad = parseFloat(c.borderTopLeftRadius) > 9999 ? 'full' : c.borderTopLeftRadius
    const bd = border ? `${c.borderTopWidth} ${hex(bcol)}` : '-'
    const look = `rad ${rad} bd ${bd} sh ${shadowOf(c.boxShadow)} bg ${hex(bg)}`
    const pad = `${c.paddingTop} ${c.paddingRight} ${c.paddingBottom} ${c.paddingLeft}`
    boxSet.set(el, { kind, look, pad, r, c, bg, under, border, bcol })
  }
  const parentBox = (el) => { for (let e = el.parentElement; e; e = e.parentElement) if (boxSet.has(e)) return e; return null }
  const issue = (type, el, detail) => out.boxIssues.push({ type, at: cls(el), cl: klass(el), detail })
  for (const [el, b] of boxSet) {
    const pb = parentBox(el), r = b.r
    let depth = 0; for (let e = pb; e; e = parentBox(e)) depth++
    // Contrast of the edge against what it sits on (3:1 makes the edge itself
    // readable as a boundary — WCAG 1.4.11 asks it of fields, not of cards, so
    // this is information, not a warning).
    const edge = b.border ? ratio(blend(b.bcol, b.under), b.under).toFixed(2) : '-'
    out.boxes.push({ kind: b.kind, sig: `${b.kind} ${b.look} pad ${b.pad}`, look: b.look, pad: b.pad, rad: b.look.split(' ')[1], bd: b.look.split(' bd ')[1].split(' sh ')[0], sh: b.look.split(' sh ')[1].split(' bg ')[0], depth, edge, w: Math.round(r.width), cl: cls(el) })
    // Content wider than the box: scrolls (fine for a table frame), clipped,
    // or spilling out over its edge.
    const ox = b.c.overflowX, wide = el.scrollWidth - el.clientWidth
    if (wide > 2) {
      if (ox === 'auto' || ox === 'scroll') { if (b.kind !== 'table' && !el.querySelector('table')) issue('SCROLLS', el, `${wide}px wider, scrolls sideways`) }
      else if (ox === 'hidden' || ox === 'clip') issue('CLIPPED', el, `${wide}px of content cut off`)
      else issue('SPILL', el, `content ${wide}px wider than the box`)
    }
    // Off the screen (phone), unless a scrolling ancestor owns it.
    let scroller = false; for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'scroll') { scroller = true; break } }
    if (!scroller && b.kind !== 'modal' && (r.right > W + 1 || r.left < -1)) issue('OFFSCREEN', el, `x ${Math.round(r.left)}..${Math.round(r.right)} of ${W}`)
    // Text touching the edge: the nearest text to the box's inner edge, for
    // boxes that draw a visible edge (a border or a fill).
    if ((b.border || b.kind === 'modal' || boxSet.get(el).look.includes('bg ') && b.c.backgroundColor !== 'rgba(0, 0, 0, 0)') && b.kind !== 'table') {
      const bl = parseFloat(b.c.borderLeftWidth) || 0, br = parseFloat(b.c.borderRightWidth) || 0
      let minX = Infinity, n = 0
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let t = tw.nextNode(); t && n < 60; t = tw.nextNode()) {
        if (!t.textContent.trim()) continue
        const pe = t.parentElement; if (!pe || parentBox(pe) !== el && pe !== el && boxSet.has(parentBox(pe)) && parentBox(pe) !== el) continue
        if (pe.closest('button, input, select, textarea, a, table') && !el.matches('table')) continue
        const rg = document.createRange(); rg.selectNodeContents(t); const rr = rg.getBoundingClientRect(); if (rr.width < 1) continue
        n++; minX = Math.min(minX, rr.left - (r.left + bl), (r.right - br) - rr.right)
      }
      if (n && minX < 6) issue('CRAMPED', el, `text ${Math.round(minX)}px from the edge (padding ${b.pad})`)
    }
    // A box inside an identical box draws the same edge twice.
    if (pb && boxSet.get(pb).look === b.look && b.kind === 'card') issue('NESTED-SAME', el, `inside an identical ${boxSet.get(pb).look}`)
  }
  // Siblings: near-miss left edges, uneven heights in one row, and the gaps
  // between stacked boxes — grouped per parent box (or the page).
  const fam = new Map()
  for (const [el, b] of boxSet) { if (b.kind === 'modal') continue; const k = parentBox(el) || root; if (!fam.has(k)) fam.set(k, []); fam.get(k).push([el, b.r]) }
  for (const [p, kids] of fam) {
    if (kids.length < 2) continue
    const rows = new Map(); for (const [el, r] of kids) { const k = Math.round(r.top / 3); (rows.get(k) || rows.set(k, []).get(k)).push([el, r]) }
    for (const row of rows.values()) { if (row.length < 2) continue; const hs = row.map(([, r]) => Math.round(r.height)); if (Math.max(...hs) - Math.min(...hs) > 6) issue('UNEVEN-ROW', row[0][0], `${row.length} boxes side by side, heights ${hs.join('/')}`) }
    const col = kids.filter(([, a]) => kids.some(([, b]) => b !== a && b.left < a.right && a.left < b.right && Math.abs(a.top - b.top) > 3)).sort((a, b) => a[1].top - b[1].top)
    const lefts = [...new Set(col.map(([, r]) => Math.round(r.left)))].sort((a, b) => a - b)
    for (let i = 1; i < lefts.length; i++) if (lefts[i] - lefts[i - 1] >= 1 && lefts[i] - lefts[i - 1] <= 8) issue('MISALIGNED', col[0][0], `stacked boxes start at x=${lefts.join('/')} (off by ${lefts[i] - lefts[i - 1]}px)`)
    const gaps = []; for (let i = 1; i < col.length; i++) { const g = Math.round(col[i][1].top - col[i - 1][1].bottom); if (g >= 0 && g < 120) gaps.push(g) }
    const gs = [...new Set(gaps)]; if (gs.length > 1 && Math.max(...gs) - Math.min(...gs) > 4) issue('GAPS', col[0][0], `gaps between stacked boxes: ${gaps.join('/')}px`)
  }
  // TABLES — one record per visible table: its frame (width against the box
  // it sits in, whether that box scrolls), header and cell styles, row
  // heights, and per column the alignment of header and cells, how numeric the
  // column is, how often its cells wrap or get cut, and how wide it is.
  const side2 = (a, dir) => a === 'start' ? (dir === 'rtl' ? 'right' : 'left') : a === 'end' ? (dir === 'rtl' ? 'left' : 'right') : a === 'justify' || a === '-webkit-auto' ? 'left' : a.replace('-webkit-', '')
  const NUM = /^[\s(+\-−]*(?:KWD|KD|د\.ك\.?|SP)?\s*[\d٠-٩][\d٠-٩.,٫٬:\/\s×x%-]*(?:KWD|KD|د\.ك\.?|%|×|pcs|units?)?\s*\)?$/i
  // Lines of the most-wrapped single text run inside el. Counting the whole
  // cell would call a name stacked over its Arabic line "wrapped", which is
  // layout, not a column that is too narrow.
  const lines = (el) => {
    let most = 0; const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = tw.nextNode(), k = 0; n && k < 40; n = tw.nextNode(), k++) {
      if (!n.textContent.trim()) continue
      const rg = document.createRange(); rg.selectNodeContents(n)
      const tops = new Set([...rg.getClientRects()].filter((r) => r.width > 0.5).map((r) => Math.round(r.top)))
      most = Math.max(most, tops.size)
    }
    return most
  }
  for (const t of root.querySelectorAll('table')) {
    if (!vis(t)) continue
    const tc = getComputedStyle(t), tr = t.getBoundingClientRect(), dir = tc.direction
    let scroller = null; for (let e = t.parentElement; e && e !== document.body; e = e.parentElement) { const ox = getComputedStyle(e).overflowX; if (ox === 'auto' || ox === 'scroll') { scroller = e; break } }
    const cont = scroller || t.parentElement, cr = cont.getBoundingClientRect()
    const rows = [...t.querySelectorAll('tbody > tr, :scope > tr')].filter(vis)
    let head = [...t.querySelectorAll('thead th, thead td')].filter(vis)
    if (!head.length && rows[0] && rows[0].querySelector('th')) head = [...rows.shift().children]
    const ncol = Math.max(head.length, ...rows.map((r) => r.children.length), 0)
    const hc = head[0] ? getComputedStyle(head[0]) : null
    const cell0 = rows[0] && rows[0].children[0] ? getComputedStyle(rows[0].children[0]) : null
    const rh = rows.map((r) => Math.round(r.getBoundingClientRect().height)).sort((a, b) => a - b)
    const pads = new Set(), valigns = new Set(), divs = new Set()
    const cols = []
    for (let i = 0; i < ncol; i++) {
      const th = head[i], cells = rows.map((r) => r.children[i]).filter((c) => c && vis(c))
      const thc = th ? getComputedStyle(th) : null
      const al = {}; let num = 0, txt = 0, wrap = 0, wrap3 = 0, cut = 0, empty = 0, tab = 0, ctl = 0
      for (const c of cells) {
        const cc = getComputedStyle(c)
        pads.add(`${cc.paddingTop} ${cc.paddingRight} ${cc.paddingBottom} ${cc.paddingLeft}`); valigns.add(cc.verticalAlign); divs.add(parseFloat(cc.borderBottomWidth) > 0 ? hex(rgba(cc.borderBottomColor)) : (parseFloat(getComputedStyle(c.parentElement).borderBottomWidth) > 0 ? hex(rgba(getComputedStyle(c.parentElement).borderBottomColor)) : '-'))
        const tx = (c.innerText || '').trim()
        if (!tx || tx === '—' || tx === '-') { if (!c.querySelector('button, a, input, select, img')) { empty++; continue } }
        if (c.querySelector('button, a[class*="rounded"], input, select')) ctl++
        txt++
        const a = side2(cc.textAlign, cc.direction); al[a] = (al[a] || 0) + 1
        if (NUM.test(tx)) { num++; if (/tabular-nums/.test(cc.fontVariantNumeric) || /tabular-nums/.test(getComputedStyle(c.querySelector('*') || c).fontVariantNumeric)) tab++ }
        const n = lines(c); if (n >= 2) wrap++; if (n >= 3) wrap3++
        for (const e of [c, ...c.querySelectorAll('*')]) { if (e.scrollWidth > e.clientWidth + 1 && /hidden|clip/.test(getComputedStyle(e).overflowX) && !e.title && !c.title) { cut++; break } }
      }
      const tdAl = Object.entries(al).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
      const w = th ? th.getBoundingClientRect().width : (cells[0] ? cells[0].getBoundingClientRect().width : 0)
      cols.push({ h: th ? (th.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 18) : '', thAl: thc ? side2(thc.textAlign, thc.direction) : '-', tdAl, mixed: Object.keys(al).length > 1,
        num: txt ? num / txt : 0, tab: num ? tab / num : 1, wrap: txt ? wrap / txt : 0, wrap3: txt ? wrap3 / txt : 0, cut, empty: cells.length ? empty / cells.length : 0, ctl: txt ? ctl / txt : 0,
        w: Math.round(w), hlines: th ? lines(th) : 0, nowrap: thc ? thc.whiteSpace : '' })
    }
    out.tables.push({ at: cls(t), cl: klass(t), dir, cols, rows: rows.length, ncol, w: Math.round(tr.width), cw: Math.round(cr.width), vw: innerWidth,
      scrolls: !!scroller && t.scrollWidth > (scroller.clientWidth + 1), scroller: !!scroller, layout: tc.tableLayout, collapse: tc.borderCollapse,
      head: hc ? `fs ${hc.fontSize} fw ${hc.fontWeight} col ${hex(blend(fg(hc.color), bgOf(head[0])))} bg ${hex(bgOf(head[0]))} tt ${hc.textTransform} ls ${hc.letterSpacing} pad ${hc.paddingTop}/${hc.paddingLeft} h ${Math.round(head[0].getBoundingClientRect().height)}${hc.position === 'sticky' ? ' STICKY' : ''}` : 'none',
      cell: cell0 ? `fs ${cell0.fontSize} lh ${cell0.lineHeight} col ${hex(blend(fg(cell0.color), bgOf(rows[0].children[0])))}` : '-',
      pads: [...pads], valigns: [...valigns], divs: [...divs], rh: rh.length ? [rh[0], rh[Math.floor(rh.length / 2)], rh[rh.length - 1]] : [],
      zebra: rows.length > 3 && hex(bgOf(rows[0].children[0] || rows[0])) !== hex(bgOf(rows[1].children[0] || rows[1])) })
  }
  const side = document.querySelector('.admin-sidebar, aside, nav')
  if (side) { const c = getComputedStyle(side); out.side = `${side.tagName.toLowerCase()}.${klass(side).slice(0, 60)} bg-color ${c.backgroundColor} bg-image ${c.backgroundImage.slice(0, 120)} -> effective ${hex(bgOf(side))}` }
  return out
}

// ---------------------------------------------------------------- the walk
// SCAN_EXPLAIN='[{"screen":"Catalogue","form":false,"sel":"td.py-2.5"}]' prints, for the
// first element matching each selector, every CSS rule that sets the box's
// font, colour and size properties — in cascade order, with !important and the
// @layer it sits in — straight from Chrome's own matched-styles data. That is
// the answer to "why does my rule not win".
const EXPLAIN = process.env.SCAN_EXPLAIN ? JSON.parse(process.env.SCAN_EXPLAIN) : []
const PROPS = ['font-size', 'font-weight', 'color', 'background-color', 'border-color', 'border-top-color', 'padding-top', 'padding-left', 'padding-inline', 'margin-top', 'min-height', 'display', 'border-radius']
async function explain(pg, vn, screen, form) {
  for (const t of EXPLAIN.filter((t) => t.screen === screen && !!t.form === form)) {
    const cdp = await pg.context().newCDPSession(pg)
    try {
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
      const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: t.sel })
      if (!nodeId) { console.log(`EXPLAIN ${vn} ${screen}${form ? '/form' : ''} ${t.sel}: no element`); continue }
      const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId })
      const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId })
      const comp = Object.fromEntries(computedStyle.filter((c) => PROPS.includes(c.name)).map((c) => [c.name, c.value]))
      console.log(`EXPLAIN ${vn} ${screen}${form ? '/form' : ''} ${t.sel} computed: ${PROPS.filter((p) => comp[p]).map((p) => p + '=' + comp[p]).join(' ')}`)
      for (const r of m.matchedCSSRules || []) {
        const decl = (r.rule.style.cssProperties || []).filter((c) => PROPS.includes(c.name) && c.value && !c.disabled && c.parsedOk !== false)
        if (!decl.length) continue
        const layer = (r.rule.layers || []).map((l) => l.text).join('.') || '-'
        console.log(`   ${r.rule.origin} layer=${layer} ${r.rule.selectorList.text.slice(0, 110)} { ${decl.map((c) => c.name + ':' + c.value + (c.important ? ' !' : '')).join('; ').slice(0, 200)} }`)
      }
      const inl = (m.inlineStyle && m.inlineStyle.cssProperties || []).filter((c) => PROPS.includes(c.name) && c.value)
      if (inl.length) console.log(`   INLINE ${inl.map((c) => c.name + ':' + c.value).join('; ')}`)
    } catch (e) { console.log(`EXPLAIN ${t.sel} failed: ${e.message.slice(0, 90)}`) } finally { await cdp.detach().catch(() => {}) }
  }
}

const SCREENS = ['Overview', 'Orders', 'Returns', 'CRM', 'Support', 'Profiles', 'Catalogue', 'Brands', 'Slides', 'Topbar', 'Promotions', 'Discounts', 'Inventory', 'Payments', 'Checkout', 'Theme', 'SEO', 'Activity', 'Settings']
// CHROMIUM_PATH: run it elsewhere than the Playwright image (e.g. the sandbox).
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {})
const report = []
const VIEWS = [['desktop', 1366, 900, false], ['phone', 390, 844, true]].filter((v) => !process.env.SCAN_VIEWS || process.env.SCAN_VIEWS.split(',').includes(v[0]))
for (const [vn, w, h, mob] of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, bypassCSP: !!CSS })
  const pg = await ctx.newPage()
  const errs = [], unknown = new Set()
  pg.on('pageerror', (e) => errs.push(e.message.slice(0, 90)))
  pg.on('dialog', (d) => d.dismiss().catch(() => {}))
  pg.setDefaultTimeout(5000)
  await pg.route('**/*', (route) => {
    const req = route.request(), u = new URL(req.url())
    if (u.origin !== BASE) return route.continue()
    if (u.pathname.endsWith('/api/admin.php') || u.pathname.includes('/api/admin')) {
      const r = u.searchParams.get('r') || ''
      if (req.method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      if (!(r in MOCK)) unknown.add(r)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK[r] ?? []) })
    }
    if (req.method() !== 'GET' && req.method() !== 'HEAD') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    return route.continue()
  })
  await pg.goto(BASE + '/backends', { waitUntil: 'networkidle' })
  await pg.evaluate((n) => { window.__scanNames = n }, P.flatMap((p) => [p.name_en, p.name_ar]).filter(Boolean))
  if (CSS) await pg.addStyleTag({ content: CSS })
  await pg.waitForTimeout(800)
  const done = []
  for (const name of SCREENS) {
    if (ONLY && !ONLY.includes(name)) continue
    const go = async () => {
      let b = pg.locator('button:visible, a:visible').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first()
      if (!(await b.count())) { const m = pg.locator('button:visible').filter({ hasText: /Open menu|☰/ }).first(); if (await m.count()) { await m.click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(400) } b = pg.locator('button:visible, a:visible').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first() }
      if (!(await b.count())) {
        // Why a screen could not be reached: what the menu button is, what
        // sits on top of it, and what the open menu offers. Printed always —
        // a missing screen is exactly when this is needed.
        const why = await pg.evaluate((want) => {
          const vis = (e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.visibility !== 'hidden' && c.display !== 'none' }
          const tag = (e) => e ? `${e.tagName.toLowerCase()}.${String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).trim().split(/\s+/).slice(0, 4).join('.')}` : 'none'
          const all = [...document.querySelectorAll('button, a')]
          const menu = all.filter((e) => /Open menu|☰|Close menu|✕|More|المزيد/.test(e.textContent || e.getAttribute('aria-label') || ''))
          const m = menu.map((e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return `${tag(e)} "${(e.textContent || '').trim().slice(0, 14)}" vis ${vis(e)} @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} top=${top === e || e.contains(top) ? 'itself' : tag(top)}` })
          const hit = all.filter((e) => (e.textContent || '').trim() === want).map((e) => { const r = e.getBoundingClientRect(); return `${tag(e)} vis ${vis(e)} @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} disp ${getComputedStyle(e).display} parent ${tag(e.parentElement)} pdisp ${getComputedStyle(e.parentElement).display}` })
          const fixed = [...document.querySelectorAll('body *')].filter((e) => { const c = getComputedStyle(e); return (c.position === 'fixed' || c.position === 'sticky') && vis(e) }).slice(0, 8).map((e) => { const r = e.getBoundingClientRect(); return `${tag(e)} z ${getComputedStyle(e).zIndex} @${Math.round(r.top)} h${Math.round(r.height)}` })
          return { menu: m, target: hit, fixed, scrollY: Math.round(scrollY), docH: document.documentElement.scrollHeight }
        }, name)
        console.log(`.. UNREACHABLE ${vn} ${name}: ${JSON.stringify(why)}`)
        return false
      }
      await b.click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(1300)
      if (mob) { const close = pg.locator('button:visible').filter({ hasText: /Close menu|✕/ }).first(); if (await close.count()) await close.click({ timeout: 3000 }).catch(() => {}) }
      return true
    }
    if (!(await go())) { report.push({ vn, screen: name, missing: true }); continue }
    const t0 = Date.now()
    report.push({ vn, screen: name, data: await pg.evaluate(collect) })
    if (process.env.SCAN_DEBUG) console.log(`.. ${vn} ${name} collected in ${Date.now() - t0}ms`)
    await explain(pg, vn, name, false)
    done.push(name)
    // Open the screen's first form (Edit / Add / New) to reach its inputs.
    const opener = pg.locator('.admin-content button:visible, main button:visible').filter({ hasText: /^\s*(Edit|Add[^\n]{0,24}|New[^\n]{0,20})\s*$/ }).first()
    if (await opener.count()) {
      await opener.click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(900)
      report.push({ vn, screen: name + '/form', data: await pg.evaluate(collect) })
      await explain(pg, vn, name, true)
      // A form can stay open (a modal or an inline editor): start the next
      // screen from a fresh load so nothing leaks into its inventory.
      await pg.goto(BASE + '/backends', { waitUntil: 'networkidle' })
      await pg.evaluate((n) => { window.__scanNames = n }, P.flatMap((p) => [p.name_en, p.name_ar]).filter(Boolean))
      if (CSS) await pg.addStyleTag({ content: CSS })
      await pg.waitForTimeout(500)
    }
  }
  report.push({ vn, meta: { done, errs: [...new Set(errs)].slice(0, 6), unknown: [...unknown] } })
  await ctx.close()
}
await browser.close()

// ---------------------------------------------------------------- report
const group = (rows, key, extra) => { const m = new Map(); for (const r of rows) { const k = key(r); const g = m.get(k) || { n: 0, screens: new Set(), ex: [], ...extra() }; g.n++; g.screens.add(r.screen); if (g.ex.length < 3 && r.ex !== undefined) g.ex.push(r.ex); m.set(k, g); g.last = r } return [...m.entries()].sort((a, b) => b[1].n - a[1].n) }
const scr = (s) => [...s].slice(0, 6).join(',') + (s.size > 6 ? `,+${s.size - 6}` : '')
for (const [vn] of VIEWS) {
  const rows = report.filter((r) => r.vn === vn && r.data)
  const meta = report.find((r) => r.vn === vn && r.meta)?.meta || {}
  console.log(`\n== ${vn}: screens ${meta.done?.length || 0} (${(meta.done || []).join(' ')}) · missing ${report.filter((r) => r.vn === vn && r.missing).map((r) => r.screen).join(' ') || 'none'} · page errors ${meta.errs?.join(' | ') || 'none'} · unmocked GET r= ${meta.unknown?.join(' ') || 'none'}`)
  const flat = (k) => rows.flatMap((r) => r.data[k].map((x) => ({ ...x, screen: r.screen })))
  const sides = [...new Set(rows.map((r) => r.data.side).filter(Boolean))]
  for (const sd of sides.slice(0, 2)) console.log('-- SIDEBAR ' + sd)
  const inputs = flat('inputs')
  console.log(`-- INPUT ${inputs.length} fields, ${new Set(inputs.map((i) => i.sig)).size} styles`)
  for (const [sig, g] of group(inputs, (i) => i.sig, () => ({})).slice(0, 14)) {
    const x = g.last, flags = [x.fs < 16 && vn === 'phone' ? 'iOS-ZOOM(<16px)' : '', x.h < (vn === 'phone' ? 44 : 38) ? 'SHORT' : '', x.text < 4.5 ? `TEXT ${x.text.toFixed(1)}:1` : '', x.ph !== null && x.ph < 3 ? `PLACEHOLDER ${x.ph.toFixed(1)}:1 ${x.phcol}` : (x.ph !== null ? `ph ${x.ph.toFixed(1)}:1 ${x.phcol}` : '')].filter(Boolean).join(' ')
    console.log(`${/ZOOM|SHORT|TEXT|PLACEHOLDER/.test(flags) ? 'WARN ' : 'ok   '}×${g.n} ${sig} · label ${x.label} · ${flags} · [${scr(g.screens)}] e.g. ${g.ex.filter(Boolean).join(' / ')}`)
    if (process.env.SCAN_CLASSES) console.log(`       class="${x.cl}" label="${x.lcl}"`)
  }
  const buttons = flat('buttons').filter((b) => !b.nav)
  console.log(`-- BUTTON ${buttons.length} (excl. nav), ${new Set(buttons.map((b) => b.sig)).size} styles`)
  for (const [sig, g] of group(buttons.map((b) => ({ ...b, ex: b.label })), (b) => b.sig, () => ({})).slice(0, 26)) {
    const x = g.last, flags = [x.h < (vn === 'phone' ? 44 : 32) ? `SMALL h${Math.round(x.h)}` : '', x.text < 4.5 ? `CONTRAST ${x.text.toFixed(1)}:1` : ''].filter(Boolean).join(' ')
    console.log(`${flags ? 'WARN ' : 'ok   '}×${g.n} ${sig} ${flags} [${scr(g.screens)}] "${[...new Set(g.ex)].join('" "')}"`)
    if (process.env.SCAN_CLASSES) console.log(`       class="${x.cl}"`)
  }
  const nav = flat('buttons').filter((b) => b.nav)
  for (const [sig, g] of group(nav.map((b) => ({ ...b, ex: b.label })), (b) => b.sig, () => ({})).slice(0, 4)) console.log(`nav  ×${g.n} ${sig} "${[...new Set(g.ex)].slice(0, 3).join('" "')}"`)
  const text = flat('text')
  const hist = {}; for (const t of text) hist[t.fs] = (hist[t.fs] || 0) + 1
  console.log(`-- FONT sizes: ${Object.entries(hist).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([k, v]) => `${k}×${v}`).join(' ')}`)
  const tiny = text.filter((t) => parseFloat(t.fs) < 12)
  console.log(`-- FONT under 12px: ${tiny.length} runs`)
  for (const [k, g] of group(tiny.map((t) => ({ ...t, ex: t.t })), (t) => `${t.fs}/${t.fw} at ${t.at}`, () => ({})).slice(0, 12)) console.log(`WARN ×${g.n} ${k} [${scr(g.screens)}] "${[...new Set(g.ex)].slice(0, 3).join('" "')}"`)
  const wh = {}; for (const t of text) wh[t.fw] = (wh[t.fw] || 0) + 1
  console.log(`-- FONT weights: ${Object.entries(wh).map(([k, v]) => `${k}×${v}`).join(' ')}`)
  const tc = {}; for (const t of text) tc[t.col] = (tc[t.col] || 0) + 1
  console.log(`-- TEXT colours: ${Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => `${k}×${v}`).join(' ')}`)
  const low = text.filter((t) => t.r < t.need)
  console.log(`-- LOW contrast: ${low.length} of ${text.length} text runs`)
  for (const [k, g] of group(low.map((t) => ({ ...t, ex: t.t })), (t) => `${t.col} on ${t.bg} ${t.fs}/${t.fw} ${t.r.toFixed(2)}:1 (needs ${t.need}) at ${t.at}`, () => ({})).slice(0, 14)) console.log(`WARN ×${g.n} ${k} [${scr(g.screens)}] "${g.ex.join('" "')}"`)
  const col = flat('colours')
  console.log(`-- COLOUR non-neutral (not slate/indigo): ${col.length}`)
  for (const [k, g] of group(col.map((c) => ({ ...c, ex: c.at })), (c) => `${c.f} ${c.k} ${c.c}`, () => ({})).slice(0, 16)) console.log(`${/OTHER/.test(k) ? 'WARN ' : 'ok   '}×${g.n} ${k} [${scr(g.screens)}] at ${[...new Set(g.ex)].join(' | ')}`)
  const rad = {}; for (const r of flat('radii')) rad[r.rad] = (rad[r.rad] || 0) + 1
  console.log(`-- RADII: ${Object.entries(rad).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' ')}`)
  const boxes = flat('boxes')
  const kinds = {}; for (const b of boxes) kinds[b.kind] = (kinds[b.kind] || 0) + 1
  console.log(`-- BOX ${boxes.length} boxes (${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')}), ${new Set(boxes.map((b) => b.look)).size} looks, ${new Set(boxes.map((b) => b.sig)).size} look+padding styles, nesting up to ${Math.max(0, ...boxes.map((b) => b.depth))}`)
  for (const [k, g] of group(boxes.map((b) => ({ ...b, ex: b.cl })), (b) => `${b.kind} ${b.look}`, () => ({})).slice(0, 22)) {
    const pads = {}; for (const b of boxes.filter((x) => `${x.kind} ${x.look}` === k)) pads[b.pad] = (pads[b.pad] || 0) + 1
    console.log(`box  ×${g.n} ${k} · edge ${g.last.edge}:1 · pad ${Object.entries(pads).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, n]) => `${p}×${n}`).join(' | ')} [${scr(g.screens)}] e.g. ${[...new Set(g.ex)].slice(0, 2).join(' | ')}`)
  }
  const tally = (f) => { const m = {}; for (const b of boxes) m[f(b)] = (m[f(b)] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' ') }
  console.log(`-- BOX radii: ${tally((b) => b.rad)}`)
  console.log(`-- BOX borders: ${tally((b) => b.bd)}`)
  console.log(`-- BOX shadows: ${tally((b) => b.sh)}`)
  console.log(`-- BOX paddings: ${tally((b) => b.pad).split(' ').slice(0, 40).join(' ')}`)
  const bi = flat('boxIssues')
  console.log(`-- BOX issues: ${bi.length} (${Object.entries(bi.reduce((m, i) => (m[i.type] = (m[i.type] || 0) + 1, m), {})).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`)
  for (const [k, g] of group(bi.map((i) => ({ ...i, ex: i.detail })), (i) => `${i.type} at ${i.at}`, () => ({})).slice(0, 40)) {
    console.log(`${/SCROLLS|GAPS|UNEVEN/.test(k) ? 'info ' : 'WARN '}×${g.n} ${k} [${scr(g.screens)}] ${[...new Set(g.ex)].slice(0, 2).join(' | ')}`)
    if (process.env.SCAN_CLASSES) console.log(`       class="${g.last.cl}"`)
  }
  const tables = flat('tables')
  console.log(`-- TABLE ${tables.length} tables on ${new Set(tables.map((t) => t.screen)).size} screens`)
  const tIssues = []
  for (const t of tables) {
    console.log(`tbl  [${t.screen}] ${t.at} ${t.ncol} cols × ${t.rows} rows · ${t.w}px in ${t.cw}px${t.scroller ? (t.scrolls ? ' (scrolls sideways)' : ' (scroll box, fits)') : ''} · layout ${t.layout} · ${t.dir}`)
    console.log(`       head ${t.head} · cell ${t.cell} · pad ${t.pads.slice(0, 3).join(' | ')}${t.pads.length > 3 ? ` +${t.pads.length - 3}` : ''} · rows h ${t.rh.join('/')} · valign ${t.valigns.join(',')} · divider ${t.divs.join(',')}${t.zebra ? ' · zebra' : ''}`)
    console.log('       ' + t.cols.map((c, i) => `${i + 1}"${c.h}" ${c.w}px th:${c.thAl} td:${c.tdAl}${c.mixed ? '~' : ''}${c.num >= 0.6 ? ` NUM${Math.round(c.num * 100)}%${c.tab < 0.9 ? '(prop)' : ''}` : ''}${c.wrap > 0 ? ` wrap${Math.round(c.wrap * 100)}%` : ''}${c.cut ? ` cut${c.cut}` : ''}${c.empty >= 0.5 ? ` empty${Math.round(c.empty * 100)}%` : ''}${c.hlines > 1 ? ` head${c.hlines}lines` : ''}`).join(' · '))
    const I = (sev, type, d) => tIssues.push({ sev, type, d, at: t.at, screen: t.screen })
    if (!t.scroller && t.w > t.cw + 1) I('WARN', 'SPILL', `${t.w}px table in a ${t.cw}px box with no scroll`)
    if (t.w > t.vw + 1 && !t.scroller) I('WARN', 'OFFSCREEN', `${t.w}px on a ${t.vw}px screen`)
    if (t.scrolls && t.vw >= 1000) I('info', 'SCROLLS', `scrolls sideways on desktop (${t.w}px in ${t.cw}px)`)
    if (t.rows > 15 && !/STICKY/.test(t.head)) I('info', 'NO-STICKY-HEAD', `${t.rows} rows, header scrolls away`)
    if (t.pads.length > 2) I('info', 'PADDING', `${t.pads.length} different cell paddings: ${t.pads.slice(0, 4).join(' | ')}`)
    if (t.valigns.length > 1) I('info', 'VALIGN', `cells mix vertical-align ${t.valigns.join('/')}`)
    if (t.rh.length && t.rh[2] > 2.5 * t.rh[0] && t.rh[0] > 0) I('info', 'ROW-HEIGHT', `rows ${t.rh[0]}…${t.rh[2]}px`)
    t.cols.forEach((c, i) => {
      const nm = `col ${i + 1} "${c.h}"`
      // Digits run left-to-right inside Arabic too, so the units digit is at
      // a number's RIGHT edge in both directions: a figures column lines up
      // only when it is physically right-aligned, whatever the page's dir.
      if (c.num >= 0.6 && c.tdAl !== 'right' && c.ctl < 0.5) I('WARN', 'NUM-ALIGN', `${nm} is ${Math.round(c.num * 100)}% numbers but aligned ${c.tdAl} (figures line up only on the right)`)
      if (c.num >= 0.6 && c.tab < 0.9) I('info', 'NUM-FIGURES', `${nm}: numbers in proportional figures (no tabular-nums), digits do not line up`)
      if (c.h && c.thAl !== '-' && c.tdAl !== '-' && c.thAl !== c.tdAl) I('WARN', 'HEAD-ALIGN', `${nm}: header ${c.thAl}, cells ${c.tdAl}`)
      if (c.mixed) I('info', 'MIXED-ALIGN', `${nm}: cells aligned differently from row to row`)
      if (c.wrap3 >= 0.3) I('WARN', 'TOO-NARROW', `${nm} ${c.w}px: ${Math.round(c.wrap3 * 100)}% of cells wrap to 3+ lines`)
      else if (c.wrap >= 0.5 && c.num >= 0.6) I('WARN', 'NUM-WRAPS', `${nm}: a number column wraps (${Math.round(c.wrap * 100)}%)`)
      if (c.hlines > 1) I('info', 'HEAD-WRAPS', `${nm}: header on ${c.hlines} lines at ${c.w}px`)
      if (c.cut) I('WARN', 'CUT', `${nm}: ${c.cut} cells cut off with no title to read them`)
      if (c.empty >= 0.8 && t.rows >= 5) I('info', 'EMPTY-COL', `${nm}: ${Math.round(c.empty * 100)}% empty`)
      if (c.w > 0.45 * t.w && t.ncol > 3) I('info', 'WIDE-COL', `${nm} takes ${Math.round((c.w / t.w) * 100)}% of the table`)
    })
  }
  console.log(`-- TABLE issues: ${tIssues.length} (${Object.entries(tIssues.reduce((m, i) => (m[i.type] = (m[i.type] || 0) + 1, m), {})).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`)
  for (const i of tIssues) console.log(`${i.sev === 'WARN' ? 'WARN' : 'info'} ${i.type} [${i.screen}] ${i.at}: ${i.d}`)
  const names = flat('names')
  console.log(`-- NAME product names: ${names.length}, cut off ${names.filter((n) => n.cut).length}`)
  for (const [k, g] of group(names.map((n) => ({ ...n, ex: n.t })), (n) => `${n.sig} at ${n.at}`, () => ({})).slice(0, 8)) {
    console.log(`${g.last.cut ? 'WARN ' : 'ok   '}×${g.n} ${k} w~${g.last.w}px [${scr(g.screens)}] "${g.ex.join('" "')}"`)
    if (process.env.SCAN_CLASSES) console.log(`       class="${g.last.cl}" parent="${g.last.pcl}"`)
  }
}
console.log('\nADMIN_STYLE_SCAN_DONE')
