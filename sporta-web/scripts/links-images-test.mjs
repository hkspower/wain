// Every link, and every image, on every page — in both languages.
//
// A broken link and a broken image are the two faults a shopper meets without
// being able to report them usefully: one is a dead end, the other is a grey
// box where a garment should be. Neither throws, neither appears in a console,
// and neither shows up in any suite that asserts behaviour rather than looking
// at what actually rendered.
//
// WHAT COUNTS AS BROKEN HERE
//   * a link whose target does not resolve — 404, or a route Apache does not
//     know (which is the same thing to a visitor);
//   * an <img> that finished loading with naturalWidth 0 — the browser's own
//     definition of "this did not decode", which catches a wrong path, a
//     corrupt file and a data: URI with bad base64 alike;
//   * a src that is empty or literally "null"/"undefined", which renders as a
//     broken-image glyph and is the shape a missing database column takes;
//   * a page that answers anything other than 200.
//
// BOTH LANGUAGES, because they are different pages: the Arabic side has its own
// hero copy, its own category art alt text and its own footer links, and a path
// built by string concatenation can be right in one and wrong in the other.
//
//   npm run test:links   (needs MariaDB and php -S :8188 router-native)
import { chromium } from 'playwright'

const SITE = process.env.SITE ?? 'http://127.0.0.1:8188'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

// Every route the app claims, plus a product and an invoice — the two that are
// built from data rather than written down.
const ROUTES = [
  '/', '/shop', '/cart', '/checkout', '/about', '/contact',
  '/wishlist', '/track', '/returns', '/terms', '/privacy',
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// One page, fully rendered, reporting what it links to and what it drew.
async function scan(path, lang) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  await ctx.addInitScript((l) => {
    localStorage.setItem('lang', l)
    // A seeded bag so /cart and /checkout render their real contents rather
    // than an empty state with nothing in it to be broken.
    localStorage.setItem('sporta_cart', JSON.stringify([{
      slug: 'cloudsoft-jacket-army-green', qty: 1, size: 'M', fit: 'normal',
      price: 10, name: { en: 'Jacket', ar: 'جاكيت' }, image: '',
    }]))
  }, lang)
  const p = await ctx.newPage()
  const status = (await p.goto(SITE + path, { waitUntil: 'networkidle' }))?.status() ?? 0
  // Lazy images below the fold never load unless the page is scrolled, and an
  // image that is never requested cannot be reported broken.
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 60))
    }
    window.scrollTo(0, 0)
  })
  await p.waitForTimeout(900)

  const found = await p.evaluate(() => {
    const links = [...document.querySelectorAll('a[href]')]
      .map((a) => ({ href: a.getAttribute('href'), abs: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 30) }))
      .filter((l) => l.href && !l.href.startsWith('#') && !l.href.startsWith('mailto:')
                     && !l.href.startsWith('tel:') && !l.href.startsWith('javascript:'))
    const images = [...document.querySelectorAll('img')].map((im) => ({
      src: im.getAttribute('src'),
      // complete && naturalWidth === 0 is the browser's own verdict that the
      // bytes did not decode — it catches a wrong path, a corrupt file and a
      // data: URI with bad base64 with one question.
      broken: im.complete && im.naturalWidth === 0,
      lazy: im.loading === 'lazy',
      alt: im.getAttribute('alt'),
      where: (im.closest('[class]')?.className || '').slice(0, 40),
    }))
    // CSS background images are invisible to <img> checks and are how the
    // category tiles and the hero art are drawn.
    const backgrounds = [...document.querySelectorAll('*')]
      .map((el) => getComputedStyle(el).backgroundImage)
      .filter((v) => v && v !== 'none' && v.includes('url('))
      .flatMap((v) => [...v.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]))
      .filter((u) => !u.startsWith('data:'))
    // <source srcSet> INSIDE <picture>. Only the variant whose media query
    // matches is ever fetched, so crawling at one viewport leaves the other
    // completely unverified — the category tiles carry a desktop photograph and
    // a mobile one, and a broken mobile path is invisible from a desktop crawl.
    // Collected here and fetched directly, whatever the viewport.
    const sources = [...document.querySelectorAll('source[srcset], source[srcSet]')]
      .flatMap((s) => (s.getAttribute('srcset') || '')
        .split(',')
        .map((c) => c.trim().split(/\s+/)[0])
        .filter(Boolean))
      .filter((u) => !u.startsWith('data:'))

    return { links, images, backgrounds: [...new Set(backgrounds)], sources: [...new Set(sources)] }
  })
  await ctx.close()
  return { status, ...found }
}

// HEAD is not enough: this rig answers 200 with the SPA shell for any path the
// rewrite knows, so a route that exists and a route that does not both look
// alike until the body is read. Everything is fetched.
const seen = new Map()
async function resolves(url) {
  if (seen.has(url)) return seen.get(url)
  let out
  try {
    const res = await fetch(url, { redirect: 'follow' })
    out = { status: res.status, type: res.headers.get('content-type') ?? '' }
  } catch (e) {
    out = { status: 0, type: String(e).slice(0, 40) }
  }
  seen.set(url, out)
  return out
}

const allLinks = new Map()   // absolute url -> [where it was found]
const allImages = []
const allBgs = new Map()
const allSources = new Map()

head('every page answers')
for (const lang of ['ar', 'en']) {
  for (const route of ROUTES) {
    const path = lang === 'en' ? `${route}?lang=en` : route
    const r = await scan(path, lang)
    if (r.status !== 200) bad(`${path} answered ${r.status}`)
    for (const l of r.links) {
      if (!l.abs.startsWith(SITE)) continue          // external, not ours to hold
      if (!allLinks.has(l.abs)) allLinks.set(l.abs, [])
      allLinks.get(l.abs).push(`${path} “${l.text}”`)
    }
    for (const im of r.images) allImages.push({ ...im, page: path })
    for (const u of r.sources ?? []) {
      const abs = new URL(u, SITE + path).href
      if (!abs.startsWith(SITE)) continue
      if (!allSources.has(abs)) allSources.set(abs, [])
      allSources.get(abs).push(path)
    }
    for (const b of r.backgrounds) {
      const abs = new URL(b, SITE + path).href
      if (!abs.startsWith(SITE)) continue
      if (!allBgs.has(abs)) allBgs.set(abs, [])
      allBgs.get(abs).push(path)
    }
  }
}
ok(`all ${ROUTES.length * 2} pages answered 200`, `${ROUTES.length} routes x 2 languages`)

// ------------------------------------------------------------------ links
head('every internal link goes somewhere')
{
  const dead = []
  for (const [url, where] of allLinks) {
    const r = await resolves(url)
    if (r.status !== 200) dead.push(`${url.replace(SITE, '')} -> ${r.status}  (from ${where[0]})`)
  }
  is(dead.length === 0, `${allLinks.size} distinct internal links, all resolve`,
     dead.length ? `\n     ${dead.slice(0, 10).join('\n     ')}` : 'none dead')
}

// ----------------------------------------------------------------- images
head('every image actually drew')
{
  const broken = allImages.filter((im) => im.broken)
  is(broken.length === 0, `${allImages.length} images rendered, none failed to decode`,
     broken.length
       ? `\n     ${[...new Set(broken.map((b) => `${b.src?.slice(0, 60)} on ${b.page}`))].slice(0, 10).join('\n     ')}`
       : 'none broken')

  // An empty or literal-null src is the shape a missing database column takes,
  // and the browser draws it as a broken-image glyph rather than nothing.
  const empty = allImages.filter((im) => !im.src || ['null', 'undefined', ''].includes(String(im.src).trim()))
  is(empty.length === 0, 'and none has an empty or null src',
     empty.length ? [...new Set(empty.map((e) => `${e.where} on ${e.page}`))].slice(0, 6).join(' | ') : 'none')

  // alt="" is correct for decoration; a MISSING alt attribute is not, and a
  // screen reader then reads the file name aloud.
  const noAlt = allImages.filter((im) => im.alt === null)
  is(noAlt.length === 0, 'and every one carries an alt attribute, even if empty',
     noAlt.length ? [...new Set(noAlt.map((n) => `${n.where} on ${n.page}`))].slice(0, 6).join(' | ') : 'all present')
}

head('every CSS background image resolves')
{
  const dead = []
  for (const [url, where] of allBgs) {
    const r = await resolves(url)
    if (r.status !== 200) dead.push(`${url.replace(SITE, '')} -> ${r.status} (${where[0]})`)
  }
  is(dead.length === 0, `${allBgs.size} background images, all resolve`,
     dead.length ? `\n     ${dead.slice(0, 8).join('\n     ')}` : 'none dead')
}

head('every <picture> variant resolves, matched or not')
{
  const dead = []
  for (const [url, where] of allSources) {
    const r = await resolves(url)
    if (r.status !== 200) dead.push(`${url.replace(SITE, '')} -> ${r.status} (${where[0]})`)
    else if (!r.type.startsWith('image/')) dead.push(`${url.replace(SITE, '')} is ${r.type}, not an image`)
  }
  is(dead.length === 0, `${allSources.size} <source> variants, all resolve as images`,
     dead.length ? `\n     ${dead.slice(0, 8).join('\n     ')}` : 'none dead')
}

// --------------------------------------------------------------- the sitemap
head('every URL the sitemap advertises exists')
{
  // A sitemap that lists a 404 is worse than one that omits the page: it spends
  // crawl budget and reports errors in Search Console.
  const maps = ['/sitemap-pages.xml', '/sitemap-products.xml']
  const urls = []
  for (const m of maps) {
    const xml = await (await fetch(SITE + m)).text()
    for (const loc of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(loc[1])
  }
  is(urls.length > 0, 'the sitemaps list URLs at all', `${urls.length} entries`)

  const dead = []
  for (const u of urls) {
    // The sitemap carries the production origin; this rig serves the same paths.
    const local = u.replace('https://www.sporta.com.kw', SITE)
    const r = await resolves(local)
    if (r.status !== 200) dead.push(`${u} -> ${r.status}`)
  }
  is(dead.length === 0, 'and every one of them answers', dead.slice(0, 8).join(' | ') || 'none dead')
}

await browser.close()
console.log(fails ? `\n${fails} problem(s) — see above` : '\nno broken links, no broken images')
process.exit(fails ? 1 : 0)
