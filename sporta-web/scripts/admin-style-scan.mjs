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
//   NAME    how product names render in Catalogue (size, weight, truncation).
//
// --css injects a stylesheet (bypassCSP) before scanning, so a fix can be
// measured on the live admin before it is deployed. Lines start with == / ok /
// WARN so the output greps cleanly.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const cssAt = args.indexOf('--css')
const CSS = cssAt >= 0 ? readFileSync(args[cssAt + 1], 'utf8') : (process.env.SCAN_CSS_B64 ? Buffer.from(process.env.SCAN_CSS_B64, 'base64').toString() : '')
const BASE = (args.find((a, i) => !a.startsWith('--') && !(cssAt >= 0 && i === cssAt + 1)) || 'https://www.sporta.com.kw').replace(/\/$/, '')
const ONLY = process.env.SCAN_ONLY ? process.env.SCAN_ONLY.split(',') : null

const pub = async (r) => { try { return await (await fetch(`${BASE}/api/api.php?r=${r}`)).json() } catch { return [] } }
const [products, brands, stock] = await Promise.all([pub('products'), pub('brands'), pub('stock')])
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
  theme_settings: { brand: '#e0561c', accent: '#b8430f', canvas: '#ffffff', radius: '16', dark: false, fonts: { body_en: 'plex', display_en: 'alexandria', body_ar: 'plex', display_ar: 'alexandria' } },
  topbar_settings: { enabled: true, text_en: 'Delivery within 24 hours in Kuwait', text_ar: 'التوصيل خلال ٢٤ ساعة داخل الكويت', href: '/shop', starts_at: null, ends_at: null, tone: 'brand', show_dot: true, alignment: 'center' },
  seo_settings: { pages: Object.fromEntries(['/', '/shop', '/about', '/contact', '/returns', '/terms', '/privacy'].map((p) => [p, { title_en: '', title_ar: '', description_en: '', description_ar: '', image: '' }])) },
  return_requests: { requests: [], page: 1, has_more: false, total: 0 },
  support_list: { tickets: [] },
  crm_list: { contacts: NAMES.map((n, i) => ({ key: 'phone:9650000' + (1000 + i), source: 'phone', name: n, display_name: '', phone: '9650000' + (1000 + i), email: '', order_count: 1 + i, order_total: 9 * (1 + i), paid_total: 9 * i, open_cod_count: i % 2, open_cod_total: (i % 2) * 9, last_order_at: day(i), last_area: AREAS[i], last_track_id: 'SPTEST' + (1000 + i), status: ['new', 'contacted', 'vip'][i % 3], tags: i % 2 ? ['vip'] : [], follow_up_at: null, note_count: i % 3, updated_at: null, updated_by: null })) },
  profiles_list: { profiles: [] },
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
  const out = { inputs: [], buttons: [], text: [], colours: [], names: [], radii: [] }
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
  const side = document.querySelector('.admin-sidebar, aside, nav')
  if (side) { const c = getComputedStyle(side); out.side = `${side.tagName.toLowerCase()}.${klass(side).slice(0, 60)} bg-color ${c.backgroundColor} bg-image ${c.backgroundImage.slice(0, 120)} -> effective ${hex(bgOf(side))}` }
  return out
}

// ---------------------------------------------------------------- the walk
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
      if (!(await b.count())) return false
      await b.click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(1300)
      if (mob) { const close = pg.locator('button:visible').filter({ hasText: /Close menu|✕/ }).first(); if (await close.count()) await close.click({ timeout: 3000 }).catch(() => {}) }
      return true
    }
    if (!(await go())) { report.push({ vn, screen: name, missing: true }); continue }
    const t0 = Date.now()
    report.push({ vn, screen: name, data: await pg.evaluate(collect) })
    if (process.env.SCAN_DEBUG) console.log(`.. ${vn} ${name} collected in ${Date.now() - t0}ms`)
    done.push(name)
    // Open the screen's first form (Edit / Add / New) to reach its inputs.
    const opener = pg.locator('.admin-content button:visible, main button:visible').filter({ hasText: /^\s*(Edit|Add[^\n]{0,24}|New[^\n]{0,20})\s*$/ }).first()
    if (await opener.count()) {
      await opener.click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(900)
      report.push({ vn, screen: name + '/form', data: await pg.evaluate(collect) })
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
  const names = flat('names')
  console.log(`-- NAME product names: ${names.length}, cut off ${names.filter((n) => n.cut).length}`)
  for (const [k, g] of group(names.map((n) => ({ ...n, ex: n.t })), (n) => `${n.sig} at ${n.at}`, () => ({})).slice(0, 8)) console.log(`${g.last.cut ? 'WARN ' : 'ok   '}×${g.n} ${k} w~${g.last.w}px [${scr(g.screens)}] "${g.ex.join('" "')}"`)
    if (process.env.SCAN_CLASSES) console.log(`       class="${g.last.cl}" parent="${g.last.pcl}"`)
}
console.log('\nADMIN_STYLE_SCAN_DONE')
