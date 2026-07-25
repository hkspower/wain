/* Sporta — static site logic: i18n (AR/EN + RTL), theme, cart, wishlist,
   product rendering. Modern ES2022: const/let, arrow functions, template
   literals, optional chaining, logical assignment, Intl.
   Loaded as a classic script (no import/export) so the pages also open
   straight from disk over file:// — modules would be blocked by CORS. */
'use strict'

  // ---------- i18n ----------
const T = {
    en: {
      dir: 'ltr', ann: 'Same-day delivery in Kuwait · KNET & cards accepted',
      nav: { home: 'Home', shop: 'Shop', about: 'About', contact: 'Contact' },
      hero: { kicker: 'Pro performance', l1: 'Lift.', l2: 'Ignite.',
        sub: 'Built for those who accept nothing less than the best.', cta: 'Shop the collection' },
      offer: { badge: 'Exclusive drop', title: 'Summer Offers ’24', cta: 'Discover offers' },
      cats: { men: ['Performance gear', 'Men'], women: ['Move with confidence', 'Women'],
        acc: ['Essential gear', 'Accessories'], outlet: ['Up to 60% off', 'Sporta Outlet'] },
      ess: { k: 'Trending now', t: 'Shop the essentials' },
      svc: { ret: ['Easy returns', 'Return within 14 days'], del: ['Fast delivery', 'Within 24–48 hours'] },
      add: 'Add', cart: 'Your bag', empty: 'Your bag is empty.', total: 'Total',
      checkout: 'Checkout', back: 'Back to shop', shop: 'Shop', size: 'Size',
      trust: { d: 'Same-day delivery in Kuwait', p: 'Secure checkout — KNET, Visa, Mastercard', r: 'Free 14-day returns' },
      tagline: 'The home of premium sport in Kuwait. Performance gear from the world’s leading sports brands.',
      info: 'Information', navT: 'Navigate', rights: 'All rights reserved.',
      links: { about: 'About us', why: 'Why Sporta?', terms: 'Terms', privacy: 'Privacy',
        contact: 'Contact us', shipping: 'Shipping', returns: 'Returns', track: 'Track order' }
    },
    ar: {
      dir: 'rtl', ann: 'توصيل في نفس اليوم داخل الكويت · كي نت وجميع البطاقات',
      nav: { home: 'الرئيسية', shop: 'المتجر', about: 'من نحن', contact: 'اتصل بنا' },
      hero: { kicker: 'أداءُ المحترفين', l1: 'ارفع.', l2: 'اشتعل.',
        sub: 'مصمَّمة لمن لا يقبل بأقل من الأفضل.', cta: 'تسوّق المجموعة' },
      offer: { badge: 'وصول حصري', title: 'عروض الصيف ٢٤', cta: 'اكتشف العروض' },
      cats: { men: ['معدات الأداء', 'رجالي'], women: ['تحركي بثقة', 'نسائي'],
        acc: ['معدات أساسية', 'إكسسوارات'], outlet: ['خصومات تصل إلى ٦٠٪', 'سبورتا أوتلت'] },
      ess: { k: 'الأكثر رواجاً', t: 'تسوق الأساسيات' },
      svc: { ret: ['إرجاع سهل', 'إرجاع خلال ١٤ يوم'], del: ['توصيل سريع', 'خلال ٢٤-٤٨ ساعة'] },
      add: 'أضف', cart: 'حقيبتك', empty: 'حقيبتك فارغة.', total: 'الإجمالي',
      checkout: 'إتمام الشراء', back: 'العودة للمتجر', shop: 'المتجر', size: 'المقاس',
      trust: { d: 'توصيل في نفس اليوم داخل الكويت', p: 'دفع آمن — كي نت، فيزا، ماستركارد', r: 'إرجاع مجاني خلال ١٤ يوم' },
      tagline: 'موطن الرياضة الفاخرة في الكويت. معدات أداء من أبرز ماركات الرياضة عالميًا.',
      info: 'معلومات', navT: 'التنقل', rights: 'جميع الحقوق محفوظة.',
      links: { about: 'من نحن', why: 'لماذا سبورتا؟', terms: 'الشروط', privacy: 'الخصوصية',
        contact: 'اتصل بنا', shipping: 'الشحن', returns: 'الإرجاع', track: 'تتبع الطلب' }
    }
  }

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key) ?? '') ?? fallback } catch { return fallback }
}

const S = {
  lang: localStorage.getItem('lang') ?? 'en',
  theme: localStorage.getItem('sporta_theme') ??
    (matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  cart: read('sporta_cart', []),
  wish: read('sporta_wishlist', []),
}
const t = () => T[S.lang]

// Locale-aware currency via Intl (correct digits + placement per language).
const nf = new Map()
const money = (n) => {
  nf.get(S.lang) ?? nf.set(S.lang, new Intl.NumberFormat(
    S.lang === 'ar' ? 'ar-KW' : 'en-KW',
    { style: 'currency', currency: 'KWD', minimumFractionDigits: 3,
      maximumFractionDigits: 3, numberingSystem: 'latn' }))
  return nf.get(S.lang).format(Number(n) || 0)
}
const PAY_BASE = 'https://www.sporta.com.kw/knet'

  // ---------- icons (inline SVG, currentColor) ----------
const I = {
    bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z M3 6h18 M16 10a4 4 0 0 1-8 0',
    heart: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
    search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z M21 21l-4.3-4.3',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4',
    moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
    globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z',
    truck: 'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2 M15 18H9 M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14 M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
    ret: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5',
    lock: 'M5 11h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z M7 11V7a5 5 0 0 1 10 0v4',
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
    close: 'M18 6 6 18M6 6l12 12', arrow: 'M5 12h14M12 5l7 7-7 7', up: 'M7 17 17 7M7 7h10v10',
    star: 'm12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z',
    ig: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M17.5 6.5h.01',
    tiktok: 'M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5',
    wa: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z'
  }
const icon = (name, size = 20, fill = false) => {
  const paths = I[name].split(' M').map((d, i) => (i ? `M${d}` : d))
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${
    fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.75" `
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
    + paths.map((d) => `<path d="${d}"/>`).join('') + '</svg>'
}

  // ---------- persistence ----------
const save = () => {
  localStorage.setItem('sporta_cart', JSON.stringify(S.cart))
  localStorage.setItem('sporta_wishlist', JSON.stringify(S.wish))
  localStorage.setItem('lang', S.lang)
  localStorage.setItem('sporta_theme', S.theme)
}
const applyShell = () => {
  const { documentElement: el } = document
  el.lang = S.lang
  el.dir = t().dir
  el.dataset.theme = S.theme
}
const count = () => S.cart.reduce((n, i) => n + i.qty, 0)
const total = () => S.cart.reduce((s, i) => s + i.price * i.qty, 0)

  // ---------- cart ----------
const addToCart = (slug, size = null, qty = 1) => {
  const p = window.SPORTA_PRODUCTS.find((x) => x.slug === slug)
  if (!p) return
  const key = `${slug}__${size ?? '-'}`
  const found = S.cart.find((i) => i.key === key)
  if (found) found.qty += qty
  else S.cart.push({ key, slug, size, name: p.name, price: p.price, image: p.image, qty })
  save(); render()
}
const setQty = (key, q) => {
  S.cart = S.cart.flatMap((i) => (i.key === key ? (q <= 0 ? [] : [{ ...i, qty: q }]) : [i]))
  save(); render()
}
const toggleWish = (slug) => {
  const i = S.wish.indexOf(slug)
  i > -1 ? S.wish.splice(i, 1) : S.wish.push(slug)
  save(); render()
}

  // ---------- rendering ----------
const productCard = (p) => {
  const fav = S.wish.includes(p.slug)
  const stars = Array.from({ length: 5 }, () => icon('star', 13, true)).join('')
  return `<article class="card">
    <a class="media" href="product.html?p=${p.slug}">
      <img src="${p.image}" alt="${p.name[S.lang]}" loading="lazy" width="600" height="600">
      ${p.badge ? `<span class="pill u-track">${p.badge[S.lang]}</span>` : ''}
    </a>
    <button class="fav" data-wish="${p.slug}" aria-pressed="${fav}" aria-label="Save to wishlist">
      ${icon('heart', 18, fav)}</button>
    <div class="body">
      <h3><a href="product.html?p=${p.slug}">${p.name[S.lang]}</a></h3>
      <p class="desc">${p.desc[S.lang]}</p>
      <div class="stars" aria-label="Rated 4.8 out of 5">${stars}<small>(4.8)</small></div>
      <div class="row"><span class="price">${money(p.price)}</span>
        <button class="btn btn-sm btn-primary" data-add="${p.slug}">${t().add}</button></div>
    </div></article>`
}

const render = () => {
  applyShell()
  const d = t()
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const v = el.dataset.i18n.split('.').reduce((o, k) => o?.[k], d)
    if (typeof v === 'string') el.textContent = v
  }
  const cb = document.querySelector('[data-cart-count]')
  if (cb) { cb.textContent = count(); cb.style.display = count() ? '' : 'none' }
  const wb = document.querySelector('[data-wish-count]')
  if (wb) { wb.textContent = S.wish.length; wb.style.display = S.wish.length ? '' : 'none' }
  document.querySelector('[data-theme-toggle]')?.replaceChildren()
  const ti = document.querySelector('[data-theme-toggle]')
  if (ti) ti.innerHTML = icon(S.theme === 'dark' ? 'sun' : 'moon', 20)
  const li = document.querySelector('[data-lang-toggle]')
  if (li) li.innerHTML = `${icon('globe', 14)}<span>${S.lang === 'en' ? 'AR' : 'EN'}</span>`

  window.SPORTA_PAGE?.(S, { productCard, money, t, icon })
}

  // ---------- events ----------
document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]')
  if (add) return addToCart(add.dataset.add, add.dataset.size ?? null, 1)

  const wish = e.target.closest('[data-wish]')
  if (wish) { e.preventDefault(); return toggleWish(wish.dataset.wish) }

  const qty = e.target.closest('[data-qty]')
  if (qty) { const [key, n] = qty.dataset.qty.split(':'); return setQty(key, Number.parseInt(n, 10)) }

  if (e.target.closest('[data-theme-toggle]')) {
    S.theme = S.theme === 'dark' ? 'light' : 'dark'; save(); return render()
  }
  if (e.target.closest('[data-lang-toggle]')) {
    S.lang = S.lang === 'en' ? 'ar' : 'en'; save(); return render()
  }
})

window.SPORTA = {
  state: S, render, icon, money, t,
  addToCart, setQty, count, total, productCard, PAY_BASE,
  checkout() {
    // Cryptographically random track id (Math.random is not suitable for ids).
    const track = `SP${[...crypto.getRandomValues(new Uint8Array(4))]
      .map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`
    location.href =
      `${PAY_BASE}/pay.php?amount=${total().toFixed(3)}&trackid=${track}&lang=${S.lang}`
  },
}

// Modules are deferred, so the DOM is ready — but guard for safety.
document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', render)
  : render()
