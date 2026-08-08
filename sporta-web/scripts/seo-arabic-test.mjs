// What a search engine actually gets, in both languages.
//
// THE DEFECT THIS SUITE EXISTS FOR. /?lang=ar rendered Arabic perfectly — right
// lang, right dir, Arabic headings, Arabic body — and then handed the crawler
// an ENGLISH <title> and an ENGLISH <meta description>. Those two lines are the
// entire search result. An Arabic query returning an English snippet is a
// result nobody clicks, and it is the likeliest single reason a bilingual shop
// ranks in one language only.
//
// Nothing on the page looked wrong. Opening /?lang=ar in a browser showed a
// correct Arabic page; the fault was in the two tags a reader never sees.
//
//   npm run test:seo    (needs php -S :8188 router-native)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const SITE = process.env.SITE ?? 'http://127.0.0.1:8188'
const CANON = 'https://www.sporta.com.kw'

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

const ARABIC = /[ء-ي]/
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// Googlebot's actual signals: a US datacentre, en-US, UTC. Every one of those
// is a reason detectLang picks English, which is exactly why the Arabic pages
// have to be reachable by URL rather than by preference.
async function crawl(path) {
  const ctx = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'UTC',
    userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    viewport: { width: 412, height: 892 }, isMobile: true,
  })
  const p = await ctx.newPage()
  await p.goto(SITE + path, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  const out = await p.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    title: document.title,
    desc: document.querySelector('meta[name=description]')?.content ?? '',
    canonical: document.querySelector('link[rel=canonical]')?.href ?? '',
    locale: document.querySelector('meta[property="og:locale"]')?.content ?? '',
    alts: Object.fromEntries([...document.querySelectorAll('link[rel=alternate][hreflang]')]
      .map((l) => [l.hreflang, l.href])),
    h1: document.querySelector('h1')?.innerText ?? '',
  }))
  await ctx.close()
  return out
}

// ------------------------------------------------------- the Arabic result
head('an Arabic page describes itself in Arabic')
{
  const ar = await crawl('/?lang=ar')
  is(ar.lang === 'ar' && ar.dir === 'rtl', 'it renders as Arabic for a crawler with an English locale',
     `lang=${ar.lang} dir=${ar.dir}`)
  // The two that were wrong, and they are the two that ARE the search result.
  is(ARABIC.test(ar.title), 'the TITLE is Arabic', ar.title)
  is(ARABIC.test(ar.desc), 'the DESCRIPTION is Arabic', ar.desc.slice(0, 48) + '…')
  is(ar.locale === 'ar_KW', 'og:locale says Arabic, so a WhatsApp share is Arabic too', ar.locale)
  is(ARABIC.test(ar.h1), 'and the heading matches the language it claims', ar.h1.slice(0, 30))

  // A description that is merely long is not a description. Google truncates
  // around 160 characters and shows nothing useful under about 70.
  is(ar.desc.length >= 70 && ar.desc.length <= 320,
     'and it is a usable length rather than a fragment or an essay', `${ar.desc.length} chars`)
}

head('an English page still describes itself in English')
{
  const en = await crawl('/')
  is(en.lang === 'en', 'English is unchanged at the bare URL', en.lang)
  is(!ARABIC.test(en.title), 'the title is English', en.title)
  is(!ARABIC.test(en.desc), 'and so is the description', en.desc.slice(0, 44) + '…')
  is(en.locale === 'en_KW', 'og:locale follows', en.locale)
}

// ----------------------------------------------------------- the cluster
head('the hreflang cluster is a cluster')
{
  for (const path of ['/', '/shop', '/about']) {
    const en = await crawl(path)
    const ar = await crawl(`${path}?lang=ar`)

    // THREE ANNOTATIONS ON ONE URL IS NOT A SET OF ALTERNATIVES. index.html
    // used to point en, ar and x-default at the same address, which Google
    // discards — so the Arabic version was invisible as a language target to
    // any pass that did not run JavaScript.
    is(en.alts.en !== en.alts.ar, `${path}: en and ar are different URLs`,
       `${en.alts.en?.replace(CANON, '')} vs ${en.alts.ar?.replace(CANON, '')}`)

    // Self-referencing per language. Pointing the Arabic page at the English
    // URL tells Google the Arabic one is a duplicate to drop, which is the
    // usual reason a bilingual shop is found in one language only.
    is(ar.canonical === ar.alts.ar, `${path}: the Arabic page is canonical to ITSELF`,
       ar.canonical.replace(CANON, ''))
    is(en.canonical === en.alts.en, `${path}: and the English page to itself`,
       en.canonical.replace(CANON, ''))

    // Reciprocity: each version must list the same pair, or Google ignores both.
    is(en.alts.ar === ar.alts.ar && en.alts.en === ar.alts.en,
       `${path}: both versions list the same pair — hreflang must be reciprocal`)

    // THE DEFAULT. x-default is what a searcher matching neither language is
    // shown, and for a Kuwaiti shop that is Arabic.
    is(en.alts['x-default'] === en.alts.ar, `${path}: x-default is the ARABIC url`,
       en.alts['x-default']?.replace(CANON, ''))
  }
}

// ------------------------------------------------- the static head agrees
head('the static shell and the rendered page say the same thing')
{
  // Not every crawl executes JavaScript, and the ones that do not read this.
  const raw = await (await fetch(`${SITE}/`)).text()
  const alts = Object.fromEntries(
    [...raw.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]))
  is(alts.en && alts.ar && alts.en !== alts.ar,
     'the raw HTML carries two DIFFERENT alternates', `${alts.en} vs ${alts.ar}`)
  is(alts['x-default'] === alts.ar, 'and the same Arabic x-default the app renders',
     alts['x-default'])

  // The sitemap is the third place this is written. Three sources disagreeing
  // is how an hreflang cluster gets thrown away.
  const map = readFileSync(new URL('../public/sitemap-pages.xml', import.meta.url), 'utf8')
  const first = map.slice(map.indexOf('<url>'), map.indexOf('</url>'))
  is(first.includes(`hreflang="x-default" href="${CANON}/?lang=ar"`),
     'and the sitemap agrees with both')
  is(first.includes(`hreflang="ar" href="${CANON}/?lang=ar"`), 'with the Arabic url spelled the same way')
}

await browser.close()
console.log(fails ? `\n${fails} problem(s) in the Arabic SEO` : '\nArabic pages are findable, and they read as Arabic')
process.exit(fails ? 1 : 0)
