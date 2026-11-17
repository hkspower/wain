import { useEffect } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { SITE, OG_IMAGE } from './jsonld'

export { SITE, productJsonLd, itemListJsonLd, breadcrumbJsonLd, faqJsonLd, graph } from './jsonld'


// THE TITLE AND THE DESCRIPTION ARE THE RESULT. They are the two lines a
// searcher reads before deciding whether to click, and until now both were a
// single English constant — so /?lang=ar rendered Arabic properly and then
// described itself in English to anyone searching in Arabic. Both now come from
// the translations, in the language of the page.


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
// The site is bilingual on ONE path. The BARE URL IS ARABIC — deterministically,
// for a crawler as much as for a customer — and English has its own address. So
// each page has two indexable URLs, and saying so is the whole job of hreflang:
//
//   ar        /shop
//   en        /shop?lang=en
//   x-default /shop
//
// This was the other way round until Arabic became the default. The bare path
// is the strongest address the shop has, and Kuwait's market searches for
// sportswear in Arabic; it now carries the language those searches are in.
//
// The canonical is SELF-referencing per language. Pointing the Arabic page at
// the English URL — which is what listing one canonical for both did — tells
// Google the Arabic version is a duplicate to be dropped, and it is the usual
// reason a bilingual shop is only ever found in one language.
function urlsFor(path, lang) {
  const base = SITE + (path || '/')
  const en = `${base}?lang=en`
  // x-default is the BARE url, which is now the Arabic one — the version Google
  // shows a searcher who matches neither listed language. It must match
  // index.html and the sitemap, or the three describe different sites and
  // Google trusts none of them.
  return { canonical: lang === 'en' ? en : base, ar: base, en, xDefault: base }
}

export function usePageMeta({ title, description, path = '', jsonLd, robots, image, type } = {}) {
  const { lang, t } = useLang()
  useEffect(() => {
    const BASE_TITLE = t.seo.baseTitle
    const BASE_DESC = t.seo.baseDesc
    // The brand suffix is the brand's own name and is NOT translated — it is
    // written سبورتا on the Arabic side of the wordmark, and a title that says
    // "— Sporta" in an Arabic result still reads as the shop it is.
    document.title = title ? `${title} — ${lang === 'ar' ? 'سبورتا' : 'Sporta'}` : BASE_TITLE

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
  }, [title, description, path, jsonLd, robots, image, type, lang, t])
}

