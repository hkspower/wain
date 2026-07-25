import { useEffect } from 'react'

const SITE = 'https://www.sporta.com.kw'
const BASE_TITLE = 'Sporta — Sports & Fitness Store in Kuwait'

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
export function usePageMeta({ title, description, path = '', jsonLd, robots } = {}) {
  useEffect(() => {
    document.title = title ? `${title} — Sporta` : BASE_TITLE

    if (description) {
      setTag('meta[name="description"]', { tag: 'meta', name: 'description', content: description })
      setTag('meta[property="og:description"]', { tag: 'meta', property: 'og:description', content: description })
    }
    const url = SITE + (path || '/')
    setTag('link[rel="canonical"]', { tag: 'link', rel: 'canonical', href: url })
    setTag('meta[property="og:url"]', { tag: 'meta', property: 'og:url', content: url })
    setTag('meta[property="og:title"]', { tag: 'meta', property: 'og:title', content: title || BASE_TITLE })
    // The site is bilingual on the same URL (client-side toggle), so every
    // route lists en + ar + x-default alternates pointing at itself.
    for (const hl of ['en', 'ar', 'x-default']) {
      setTag(`link[rel="alternate"][hreflang="${hl}"]`, { tag: 'link', rel: 'alternate', hreflang: hl, href: url })
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
  }, [title, description, path, jsonLd, robots])
}

// Build a schema.org Product object for a product detail page.
export function productJsonLd(product, lang = 'en') {
  return {
    '@type': 'Product',
    name: product.name?.[lang] || product.name?.en,
    alternateName: lang === 'ar' ? product.name?.en : product.name?.ar,
    description: product.desc?.[lang] || product.desc?.en,
    image: product.image?.startsWith('http') ? product.image : undefined,
    category: product.category,
    brand: { '@type': 'Brand', name: 'Sporta' },
    offers: {
      '@type': 'Offer',
      price: Number(product.price).toFixed(3),
      priceCurrency: 'KWD',
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      url: `${SITE}/product/${product.slug}`,
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'KW' },
      },
    },
  }
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
        brand: { '@type': 'Brand', name: 'Sporta' },
        offers: {
          '@type': 'Offer',
          price: Number(p.price).toFixed(3),
          priceCurrency: 'KWD',
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
