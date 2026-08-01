import { useEffect } from 'react'
import { useLang } from '../i18n/LanguageContext'

export const SITE = 'https://www.sporta.com.kw'
const BASE_TITLE = 'Sporta — Sports & Fitness Store in Kuwait'
const BASE_DESC =
  'Sporta (سبورتا) is a Kuwait sportswear store — activewear, gym clothing, hoodies, caps, and sports accessories from brands like Gymshark, RHEO & more. Fast delivery, free returns, KNET checkout. Arabic & English.'
const OG_IMAGE = `${SITE}/og-image.png`

// Third-party brands carried by the store; anything else is the house label.
const KNOWN_BRANDS = ['RHEO', 'Vanquish', 'ATE', 'Gymshark', 'Eyesportwear', 'NBA']
function brandOf(product) {
  const en = product.name?.en || ''
  return KNOWN_BRANDS.find((b) => en.toLowerCase().includes(b.toLowerCase())) || 'SPORTA'
}

function setTag(selector, attrs) {
  let el = document.head.querySelector(selector)
  if (!el) {
    el = document.createElement(attrs.tag)
    document.head.appendChild(el)
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (k !== 'tag') el.setAttribute(k, v)
  }
  return el
}

// Update per-route title, description, canonical + hreflang, robots, and
// optional JSON-LD. Static index.html already carries the global meta + store
// schema; this enriches routes for engines that execute JS.
// The two addresses every page has.
//
// The site is bilingual on ONE path, with the language chosen in the browser —
// but `?lang=ar` renders Arabic deterministically, for a crawler as much as for
// a customer. So each page has two indexable URLs, and saying so is the whole
// job of hreflang:
//
//   en        /shop
//   ar        /shop?lang=ar
//   x-default /shop
//
// The canonical is SELF-referencing per language. Pointing the Arabic page at
// the English URL — which is what listing one canonical for both did — tells
// Google the Arabic version is a duplicate to be dropped, and it is the usual
// reason a bilingual shop is only ever found in one language.
function urlsFor(path, lang) {
  const base = SITE + (path || '/')
  const ar = `${base}?lang=ar`
  return { canonical: lang === 'ar' ? ar : base, en: base, ar, xDefault: base }
}

export function usePageMeta({ title, description, path = '', jsonLd, robots, image, type } = {}) {
  const { lang } = useLang()
  useEffect(() => {
    document.title = title ? `${title} — Sporta` : BASE_TITLE

    // Always reset the description so a product page's copy never leaks onto
    // the next route (routes that pass none get the site default back).
    const desc = description || BASE_DESC
    setTag('meta[name="description"]', { tag: 'meta', name: 'description', content: desc })
    setTag('meta[property="og:description"]', { tag: 'meta', property: 'og:description', content: desc })
    const urls = urlsFor(path, lang)
    const url = urls.canonical
    setTag('meta[property="og:url"]', { tag: 'meta', property: 'og:url', content: url })
    setTag('meta[property="og:title"]', { tag: 'meta', property: 'og:title', content: title || BASE_TITLE })
    // `product` where it is one: a shared product link is a different kind of
    // object from the shop's front page, and the crawlers that build shopping
    // previews read this to decide which.
    setTag('meta[property="og:type"]', { tag: 'meta', property: 'og:type', content: type || 'website' })
    // The locale must follow what is actually rendered. It was pinned to
    // en_US, so every Arabic page shared as English.
    setTag('meta[property="og:locale"]', {
      tag: 'meta', property: 'og:locale', content: lang === 'ar' ? 'ar_KW' : 'en_KW',
    })
    setTag('meta[property="og:locale:alternate"]', {
      tag: 'meta', property: 'og:locale:alternate', content: lang === 'ar' ? 'en_KW' : 'ar_KW',
    })
    // A per-page picture where one exists, the brand card where it does not.
    // Never a data: URI — a share card has to be a URL the crawler can fetch.
    const card = image && /^https?:/.test(image) ? image : OG_IMAGE
    setTag('meta[property="og:image"]', { tag: 'meta', property: 'og:image', content: card })
    setTag('meta[name="twitter:image"]', { tag: 'meta', name: 'twitter:image', content: card })
    setTag('meta[name="twitter:title"]', { tag: 'meta', name: 'twitter:title', content: title || BASE_TITLE })
    setTag('meta[name="twitter:description"]', { tag: 'meta', name: 'twitter:description', content: desc })
    // Alt text on a share card is read aloud by screen readers on X and
    // LinkedIn, and it is the one accessibility surface a shared link has.
    setTag('meta[property="og:image:alt"]', {
      tag: 'meta', property: 'og:image:alt', content: title || BASE_TITLE,
    })
    setTag('meta[name="twitter:image:alt"]', {
      tag: 'meta', name: 'twitter:image:alt', content: title || BASE_TITLE,
    })
    const noindex = Boolean(robots?.includes('noindex'))
    if (noindex) {
      // A noindex page should not advertise a canonical or alternates.
      document.head.querySelector('link[rel="canonical"]')?.remove()
      document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => el.remove())
    } else {
      setTag('link[rel="canonical"]', { tag: 'link', rel: 'canonical', href: urls.canonical })
      for (const [hl, href] of [['en', urls.en], ['ar', urls.ar], ['x-default', urls.xDefault]]) {
        setTag(`link[rel="alternate"][hreflang="${hl}"]`, { tag: 'link', rel: 'alternate', hreflang: hl, href })
      }
    }
    // Cart/checkout/result pages pass robots: 'noindex, follow'.
    setTag('meta[name="robots"]', {
      tag: 'meta',
      name: 'robots',
      content: robots || 'index, follow, max-image-preview:large, max-snippet:-1',
    })

    // Per-page JSON-LD (e.g. Product). Removed on unmount to avoid stale data.
    let script
    if (jsonLd) {
      script = document.createElement('script')
      script.type = 'application/ld+json'
      script.dataset.route = 'true'
      script.textContent = JSON.stringify(jsonLd)
      document.head.appendChild(script)
    }
    return () => {
      if (script) script.remove()
    }
  }, [title, description, path, jsonLd, robots, image, type, lang])
}

// Build a schema.org Product object for a product detail page.
// The shop's published policy, stated once. Google asks for it on merchant
// listings, and the numbers here have to match /returns — a return window in
// the structured data that the page contradicts is worse than none.
const RETURN_POLICY = {
  '@type': 'MerchantReturnPolicy',
  applicableCountry: 'KW',
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: 14,
  returnMethod: 'https://schema.org/ReturnByMail',
  returnFees: 'https://schema.org/FreeReturn',
}

// `inStock` is optional: pass it when the page actually knows.
//
// It used to be hard-coded to InStock for everything, which is a claim the
// shop cannot make — the size ladder on the product page has been reading real
// per-size availability from the database for months. Telling a search engine
// that a sold-out item is in stock is a Google Merchant policy breach, and
// worse than that it is a customer who clicks through to nothing.
export function productJsonLd(product, lang = 'en', { inStock = null } = {}) {
  const availability = inStock === null
    ? 'https://schema.org/InStock'
    : inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'

  return {
    '@type': 'Product',
    name: product.name?.[lang] || product.name?.en,
    alternateName: lang === 'ar' ? product.name?.en : product.name?.ar,
    description: product.desc?.[lang] || product.desc?.en,
    // Real product photos are still pending; fall back to the brand image so
    // the required Product.image property is never missing.
    image: product.image?.startsWith('http') ? product.image : OG_IMAGE,
    // The slug IS the shop's product identifier — it is what order_items joins
    // on and what the packing slip prints.
    sku: product.slug,
    category: product.category,
    brand: { '@type': 'Brand', name: brandOf(product) },
    offers: {
      '@type': 'Offer',
      price: Number(product.price).toFixed(3),
      priceCurrency: 'KWD',
      // Google warns when an Offer has no expiry. A year out is honest for a
      // list price and gets re-stamped on every crawl.
      priceValidUntil: priceValidUntil(),
      availability,
      itemCondition: 'https://schema.org/NewCondition',
      url: `${SITE}/product/${product.slug}`,
      hasMerchantReturnPolicy: RETURN_POLICY,
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'KW' },
        // Free, same-day, inside Kuwait — the same promise the header makes.
        shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'KWD' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 2, unitCode: 'DAY' },
        },
      },
    },
  }
}

function priceValidUntil() {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

// BreadcrumbList from [name, path] pairs, e.g. [['Home','/'],['Shop','/shop']].
export function breadcrumbJsonLd(crumbs) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map(([name, path], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name,
      item: SITE + path,
    })),
  }
}

// ItemList for the shop page — lets engines see the whole catalog in one hop.
export function itemListJsonLd(products, lang = 'en') {
  return {
    '@type': 'ItemList',
    name: 'Sporta catalog',
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.name?.[lang] || p.name?.en,
        url: `${SITE}/product/${p.slug}`,
        image: p.image?.startsWith('http') ? p.image : OG_IMAGE,
        brand: { '@type': 'Brand', name: brandOf(p) },
        offers: {
          '@type': 'Offer',
          price: Number(p.price).toFixed(3),
          priceCurrency: 'KWD',
          priceValidUntil: priceValidUntil(),
          availability: 'https://schema.org/InStock',
        },
      },
    })),
  }
}

// FAQPage from [{q, a}] in the active language (content must be visible on
// the page — Google requires the schema to match rendered text).
export function faqJsonLd(items) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }
}

// Compose several JSON-LD nodes into one @graph document.
export function graph(...nodes) {
  return { '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) }
}
