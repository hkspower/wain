// Structured data (schema.org JSON-LD) for the storefront.
//
// Pure functions, no React: the node suites import this file directly, so the claims below are tested
// on the code that ships, not on a copy. src/lib/seo.js re-exports everything here.

export const SITE = 'https://www.sporta.com.kw'
const OG_IMAGE = `${SITE}/og-image.png`

// Third-party brands carried by the store; anything else is the house label.
const KNOWN_BRANDS = ['RHEO', 'Vanquish', 'AHED', 'Gymshark', 'Eyesportwear', 'NBA']
function brandOf(product) {
  const en = product.name?.en || ''
  return KNOWN_BRANDS.find((b) => en.toLowerCase().includes(b.toLowerCase())) || 'SPORTA'
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
  // A claim only when the page knows it. An unknown stock state (null) says NOTHING: the field is left out, rather than
  // stating InStock for a product the shop has no figures for.
  const availability = typeof inStock === 'boolean'
    ? (inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock')
    : null

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
      ...(availability ? { availability } : {}),
      itemCondition: 'https://schema.org/NewCondition',
      url: `${SITE}/product/${product.slug}`,
      hasMerchantReturnPolicy: RETURN_POLICY,
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'KW' },
        // 1.000 KWD flat, every governorate — the same number the checkout
        // quotes and the bank charges (STORE_DELIVERY_FEE_FILS). It said 0
        // while the shop delivered free; a shipping rate that disagrees with
        // the checkout is the kind of thing Merchant Center suspends a feed
        // over, and it earns a "free delivery" badge the shop cannot honour.
        shippingRate: { '@type': 'MonetaryAmount', value: 1, currency: 'KWD' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          // Within 24 hours. handling 0-1 day, transit 0-1 day.
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
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
          // No availability here: the shop list carries no stock figures, so it claims none.
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
