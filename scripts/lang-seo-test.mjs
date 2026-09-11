/**
 * Both languages, as a search engine meets them.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/lang-seo-test.mjs
 *
 * The shop serves Arabic and English from ONE set of addresses: /shop is the
 * Arabic one, /shop?lang=en the English one. That is a real bilingual site
 * rather than a query-string afterthought, and everything it needs is in place
 * — but ALL OF IT IS WRITTEN BY JAVASCRIPT AT RUNTIME, and nothing checked it.
 *
 * The bundle REMOVES the canonical link that index.html ships and writes its
 * own, per route, from a helper. Measured: `link[rel="canonical"]` is
 * `.remove()`d in the built JS. So the tag a crawler reads on /shop?lang=en is
 * not in any file in this repository — it exists only after React has run.
 *
 * WHAT THAT MAKES POSSIBLE, and why it is worth a rig of its own:
 *
 *   IF THE ENGLISH PAGE EVER STOPS BEING SELF-CANONICAL — if /shop?lang=en
 *   comes to say its canonical is /shop — every English page on the shop is
 *   declared a duplicate of the Arabic one and Google drops it. The site looks
 *   perfect to a human the whole time. The English half simply stops appearing
 *   in results, and there is nothing on any screen that says so.
 *
 * That is the failure this file exists for. It is not hypothetical arithmetic:
 * it is one wrong argument in a helper nobody would think to look at, in
 * compiled output this repository cannot rebuild.
 *
 * WHAT IT CHECKS, per route, in a real browser:
 *
 *   the page renders in the language its address asked for (lang, dir, and
 *     the actual script on the page — Arabic letters or Latin ones, because
 *     `lang="ar"` on an English page is exactly the bug worth catching)
 *   the canonical is the address that was requested, not the other language's
 *   the hreflang pair names BOTH languages of THIS route, not of the home page
 *   x-default points at the Arabic address, which is what the shop serves to
 *     someone whose language it does not speak
 *
 * The Arabic side is checked as carefully as the English one. A canonical that
 * pointed the Arabic page at the English one would be the same bug in mirror
 * image, and it is the half nobody would think to test.
 */
import { chromium } from 'playwright'

const SITE = process.env.SITE_BASE ?? 'http://127.0.0.1:4300'
// The live host, because canonicals are absolute and are written against it
// whatever host actually served the page.
const CANON = 'https://www.sporta.com.kw'

// One entry per route the sitemap offers in both languages. `/` is here twice
// over — it is the page most likely to be special-cased in the helper, and the
// one whose canonical a mistake would hurt most.
const ROUTES = ['/', '/shop', '/about', '/contact']

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

const read = async (path) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(SITE + path)
  await page.waitForTimeout(2200)
  const out = await page.evaluate(() => {
    const alts = {}
    for (const a of document.querySelectorAll('link[rel=alternate][hreflang]')) {
      alts[a.getAttribute('hreflang')] = a.getAttribute('href')
    }
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      canonical: document.querySelector('link[rel=canonical]')?.getAttribute('href') ?? '',
      alts,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    }
  })
  await ctx.close()
  return out
}

for (const route of ROUTES) {
  const ar = `${CANON}${route}`
  const en = `${CANON}${route}?lang=en`
  console.log(`\n--- ${route}`)

  for (const [label, path, want, wantCanon, wantDir] of [
    ['ar', route, 'ar', ar, 'rtl'],
    ['en', `${route}?lang=en`, 'en', en, 'ltr'],
  ]) {
    const r = await read(path)

    check(r.lang === want, `${label}: the page declares lang="${want}" (${r.lang})`)
    check(r.dir === wantDir, `${label}: and dir="${wantDir}" (${r.dir})`)

    // THE SCRIPT ON THE PAGE, not just the attribute. lang="en" over Arabic
    // text is a page that lies to a screen reader and to a crawler, and the
    // attribute alone cannot catch it.
    const arabic = /[؀-ۿ]/.test(r.text)
    check(arabic === (want === 'ar'),
      `${label}: and is actually written in ${want === 'ar' ? 'Arabic' : 'Latin'} script`,
      `"${r.text.slice(0, 60)}"`)

    // THE ONE THAT MATTERS. Self-canonical, or this language is declared a
    // duplicate of the other and stops being indexed.
    check(r.canonical === wantCanon,
      `${label}: names ITSELF as canonical`,
      `says ${r.canonical || '(none)'}, should be ${wantCanon}`)

    check(r.alts.ar === ar, `${label}: hreflang ar points at this route's Arabic address`,
      `${r.alts.ar ?? '(none)'} ≠ ${ar}`)
    check(r.alts.en === en, `${label}: hreflang en points at this route's English address`,
      `${r.alts.en ?? '(none)'} ≠ ${en}`)
    check(r.alts['x-default'] === ar, `${label}: x-default falls back to Arabic`,
      `${r.alts['x-default'] ?? '(none)'} ≠ ${ar}`)
  }
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — both languages are indexable, and each speaks for itself')
process.exit(fails ? 1 : 0)
