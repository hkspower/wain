// Mock data for the /backends admin, in the shapes admin.php returns (copied from scripts/admin-style-scan.mjs, which
// fetches the public lists from the live site; this version reads the CAPTURE of them, so it runs offline).
// Used by scripts/make-sizes-admin-fixtures.mjs to render the REAL compiled admin locally. Nothing here is a real
// customer, order or secret: made-up names, SPTEST track ids, example.com addresses, 9650000xxxx phones.
export function buildMock({ pub, BASE }) {
  const [products, brands, stock, theme] = ['products', 'brands', 'stock', 'theme'].map(pub)
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
  return MOCK
}
