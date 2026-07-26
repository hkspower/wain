import { useEffect } from 'react'

// The admin panel is a separate branch of the router from the public site, so
// none of the storefront's usePageMeta calls ever run for it. What survives is
// whatever index.html declared — and index.html says
// `robots: index, follow` with a canonical pointing at the homepage.
//
// So /admin was inviting crawlers in and claiming to be the storefront's home
// page at the same time. robots.txt alone does not cover it: the named AI-bot
// groups there each carry only `Allow: /`, and a group that matches a crawler
// is the only group it reads, so the `Disallow: /admin` in the wildcard group
// never applied to them.
//
// A meta robots tag is the reliable signal — it travels with the page and does
// not depend on a crawler merging robots.txt groups correctly.
export function useAdminMeta(title = 'Sporta Admin') {
  useEffect(() => {
    const prevTitle = document.title
    document.title = title

    const robots = document.querySelector('meta[name="robots"]')
    const prevRobots = robots?.getAttribute('content') ?? null
    robots?.setAttribute('content', 'noindex, nofollow, noarchive')

    // The homepage canonical must not be asserted from /admin. Detached rather
    // than rewritten: there is no canonical URL for a private panel to claim.
    const canonical = document.querySelector('link[rel="canonical"]')
    const canonicalParent = canonical?.parentNode
    canonical?.remove()

    return () => {
      document.title = prevTitle
      if (robots && prevRobots !== null) robots.setAttribute('content', prevRobots)
      if (canonical && canonicalParent) canonicalParent.appendChild(canonical)
    }
  }, [title])
}
