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

// Update per-route title, description, canonical, and optional JSON-LD.
// Static index.html already carries the global meta + store schema; this
// enriches routes for engines that execute JS.
export function usePageMeta({ title, description, path = '', jsonLd } = {}) {
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
  }, [title, description, path, jsonLd])
}

// Build a schema.org Product object for a product detail page.
export function productJsonLd(product, lang = 'en') {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name?.[lang] || product.name?.en,
    description: product.desc?.[lang] || product.desc?.en,
    image: product.image?.startsWith('http') ? product.image : undefined,
    category: product.category,
    brand: { '@type': 'Brand', name: 'Sporta' },
    offers: {
      '@type': 'Offer',
      price: Number(product.price).toFixed(3),
      priceCurrency: 'KWD',
      availability: 'https://schema.org/InStock',
      url: `${SITE}/product/${product.slug}`,
    },
  }
}
