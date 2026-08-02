// The Arabic side of the site, checked the way the English side is not:
// automatically, and against rules that a native reader would notice but a
// build never will.
//
//   npm run test:arabic
//   (the browser section needs `php -S 127.0.0.1:8096 scripts/router-native.php`)
//
// Three groups:
//
//   1. THE LANGUAGE DECISION. The rule that picks Arabic for a Gulf visitor
//      exists TWICE — once inlined in index.html (it must run before any
//      module loads, or the page paints in the wrong direction) and once in
//      src/i18n/detectLang.js. Two copies of a rule is two rules unless
//      something forces them to agree. This does.
//
//   2. THE TEXT. Missing keys, English left in the Arabic, mis-typed tanwin,
//      Latin punctuation stranded inside Arabic, and the counting rules.
//
//   3. THE PAGE. Rendered right-to-left in a real browser: direction, the
//      language toggle, and no Latin text left visible where Arabic belongs.
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import {
  detectLang, prefersArabic, isArabicTimeZone, langFromQuery, ARABIC_TIME_ZONES,
} from '../src/i18n/detectLang.js'
import { translations, arabicCount } from '../src/i18n/translations.js'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8096'
let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 56 - t.length))}`)

// ===========================================================================
head('who gets Arabic')

// THE PHONE FIRST. A language list is a setting somebody chose; a location is
// a guess about them, and it must not overrule the setting.
is(detectLang({ languages: ['ar-KW', 'en'], timeZone: 'Europe/London' }) === 'ar',
   'a phone set to Arabic gets Arabic ANYWHERE — the setting outranks the place')
is(detectLang({ languages: ['en-GB'], timeZone: 'Asia/Kuwait' }) === 'en',
   'a phone set to ENGLISH in Kuwait gets English — its own setting is not overruled')
is(detectLang({ languages: ['fil-PH', 'en'], timeZone: 'Asia/Kuwait' }) === 'en',
   'and so does a Tagalog phone in Kuwait — most of the country is expatriate')

// The time zone is the fallback for a device that says nothing at all.
is(detectLang({ languages: [], timeZone: 'Asia/Kuwait' }) === 'ar',
   'with NO language from the device, Kuwait falls back to Arabic')
is(detectLang({ languages: [], timeZone: 'Asia/Riyadh' }) === 'ar'
   && detectLang({ languages: [], timeZone: 'Asia/Dubai' }) === 'ar'
   && detectLang({ languages: [], timeZone: 'Africa/Cairo' }) === 'ar',
   'so do Riyadh, Dubai and Cairo')
is(detectLang({ languages: [], timeZone: 'Europe/London' }) === 'en'
   && detectLang({ languages: [], timeZone: 'America/New_York' }) === 'en',
   'London and New York get English')

// The region is not the language. Getting this wrong would serve Arabic to
// three countries that do not read it.
for (const tz of ['Asia/Tehran', 'Europe/Istanbul', 'Asia/Jerusalem']) {
  is(detectLang({ languages: [], timeZone: tz }) === 'en',
     `${tz} is in the region and is NOT Arabic-speaking — it gets English`)
}

is(detectLang({ languages: ['en-GB', 'ar'] }) === 'ar',
   'Arabic anywhere in the list counts — the reader is bilingual')
is(detectLang({ languages: ['fr-FR'], timeZone: 'Europe/Paris' }) === 'en', 'French in Paris gets English')

is(detectLang({ saved: 'en', timeZone: 'Asia/Kuwait', languages: ['ar'] }) === 'en',
   'an explicit choice beats BOTH signals — nothing overrides a person who tapped the button')
is(detectLang({ saved: 'ar', languages: ['en-GB'] }) === 'ar',
   'including their own phone’s language')
is(detectLang({ saved: 'ar', timeZone: 'Europe/London' }) === 'ar',
   'and it survives leaving the region')

is(detectLang({ search: '?lang=ar' }) === 'ar' && detectLang({ search: '?utm=x&lang=en' }) === 'en',
   '?lang= works, so a WhatsApp link can open the shop in the right language')
is(langFromQuery('?lang=de') === null, 'a language we do not have is ignored, not obeyed')

// ---------------------------------------------------------------------------
// The two copies of the rule.
//
// index.html carries the decision inlined because it has to run before any
// module does — it sets <html dir> and picks which fonts to preload. That is a
// second implementation of the same rule, and a second implementation drifts.
head('index.html and detectLang.js agree')
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const tzRe = /Asia\\\/\(([^)]+)\)|Africa\\\/\(([^)]+)\)/g
  const inHtml = new Set()
  for (const m of html.matchAll(/(Asia|Africa)\\\/\(([^)]+)\)/g)) {
    for (const city of m[2].split('|')) {
      // Riyadh8[789] is a character class standing for three aliases.
      if (city.includes('[')) {
        const [stem, cls] = city.split('[')
        for (const d of cls.replace(']', '')) inHtml.add(`${m[1]}/${stem}${d}`)
      } else inHtml.add(`${m[1]}/${city}`)
    }
  }
  void tzRe
  const missing = [...ARABIC_TIME_ZONES].filter((z) => !inHtml.has(z))
  const extra = [...inHtml].filter((z) => !ARABIC_TIME_ZONES.has(z))
  is(inHtml.size > 0, 'the boot script lists time zones at all', `${inHtml.size} found`)
  is(missing.length === 0, 'every zone in detectLang.js is in the boot script', missing.join(', ') || 'none missing')
  is(extra.length === 0, 'and the boot script invents none of its own', extra.join(', ') || 'none extra')

  is(/window\.__SPORTA_LANG/.test(html),
     'the boot script publishes its answer, so React cannot disagree for a frame')
  is(!/localStorage\.setItem\(\s*'lang'/.test(html),
     'and it never SAVES the detected language — detection is not a choice')
}

// ===========================================================================
head('the Arabic text')

const { en, ar } = translations

// Every key the English side has.
const walk = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' && !Array.isArray(v) ? walk(v, `${p}${k}.`) : [[`${p}${k}`, v]])
const enKeys = walk(en)
const arMap = new Map(walk(ar))
const missingKeys = enKeys.filter(([k]) => !arMap.has(k)).map(([k]) => k)
is(missingKeys.length === 0, 'every English string has an Arabic one', missingKeys.slice(0, 5).join(', ') || 'none missing')

// A string that is byte-identical in both languages is almost always one that
// was never translated. The exceptions are real and are named here.
const SAME_ON_PURPOSE = new Set([
  'dir', 'invoice.print', 'checkout.payNow', 'checkout.methodTpay',
  // The assistant's name is سبورتا AI in BOTH languages, and that is the
  // point: it is the shop's name, and a name that changes with the interface
  // language is two brands. It reads as untranslated to this check precisely
  // because it is untranslated, on purpose.
  'assistant.title',
])
const untranslated = enKeys
  .filter(([k, v]) => typeof v === 'string' && v.length > 3 && arMap.get(k) === v)
  .map(([k]) => k)
  .filter((k) => !SAME_ON_PURPOSE.has(k) && !/\.(sku|sep)$/.test(k))
is(untranslated.length === 0, 'nothing was left in English on the Arabic side',
   untranslated.slice(0, 6).join(', ') || 'none')

// Placeholders have to survive translation or the sentence renders with a
// literal {n} in it.
const placeholderMismatch = enKeys.filter(([k, v]) => {
  if (typeof v !== 'string') return false
  const a = arMap.get(k)
  if (typeof a !== 'string') return false
  const of = (s) => (s.match(/\{[a-z]+\}/gi) ?? []).sort().join(',')
  return of(v) !== of(a)
}).map(([k]) => k)
is(placeholderMismatch.length === 0, 'every {placeholder} survived translation',
   placeholderMismatch.join(', ') || 'none')

// ---------------------------------------------------------------------------
// Typography a reader notices.
const arStrings = [...arMap.entries()].filter(([, v]) => typeof v === 'string' && /[؀-ۿ]/.test(v))

// The tanwin goes on the letter BEFORE the alif (شكرًا), not after it (شكراً).
// Both are read the same aloud; only one is right in print, and mixing them in
// one document is what looks careless.
const badTanwin = arStrings.filter(([, v]) => v.includes('اً')).map(([k]) => k)
is(badTanwin.length === 0, 'tanwin is written ـًا, never ـاً, and consistently',
   badTanwin.join(', ') || 'consistent')

// A Latin comma or question mark between two Arabic words is bidi-neutral: it
// gets dragged to the wrong end of the line the moment a Latin run (a price, a
// block number) sits beside it. The Arabic ones are ، and ؟.
const latinPunct = arStrings
  .filter(([, v]) => /[؀-ۿ]\s*[,?;]\s*[؀-ۿ]/.test(v))
  .map(([k]) => k)
is(latinPunct.length === 0, 'no Latin , ? or ; stranded between Arabic words',
   latinPunct.join(', ') || 'none')

// Arabic-Indic digits are used throughout the copy; a stray Western digit in
// the same sentence looks like a mistake even though both are legible.
const mixedDigits = arStrings
  .filter(([k, v]) => /[٠-٩]/.test(v) && /[0-9]/.test(v) && !/\{/.test(v) && !k.startsWith('invoice.'))
  .map(([k]) => k)
is(mixedDigits.length === 0, 'no sentence mixes ٠١٢ and 012', mixedDigits.join(', ') || 'none')

// ---------------------------------------------------------------------------
// Counting. Arabic has five cases where English has two, and the old code had
// two branches — so "٢ قطع" (should be the dual) and "١٥ قطع" (should be back
// to the singular) both shipped.
head('Arabic counts')
const forms = ['قطعة واحدة', 'قطعتان', 'قطع', 'قطعة']
const c = (n) => arabicCount(n, forms)
is(c(1) === 'قطعة واحدة', 'one is singular and carries the count itself', c(1))
is(c(2) === 'قطعتان', 'two is the DUAL, not "2 plural"', c(2))
is(c(3) === '3 قطع' && c(10) === '10 قطع', 'three to ten take the plural', `${c(3)} / ${c(10)}`)
is(c(11) === '11 قطعة' && c(99) === '99 قطعة', 'eleven and up go BACK to the singular', `${c(11)} / ${c(99)}`)
is(c(103) === '103 قطع', 'and the rule restarts every hundred', c(103))
is(c(0) === 'لا قطعة', 'zero is لا + singular, not "0 items"', c(0))
is(translations.ar.checkout.itemsCount(2) === 'قطعتان',
   'the checkout summary uses it', translations.ar.checkout.itemsCount(2))

// ===========================================================================
head('the page, rendered right-to-left')
{
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  })

  // A phone set to Arabic. This is the case the feature exists for, and the
  // one that has to work without the visitor touching anything.
  const kw = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    locale: 'ar-KW', timezoneId: 'Asia/Kuwait', serviceWorkers: 'block',
  })
  const p = await kw.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(BASE, { waitUntil: 'networkidle' })

  is(await p.evaluate(() => document.documentElement.lang) === 'ar',
     'a phone set to Arabic opens the shop in Arabic, with nothing tapped')
  is(await p.evaluate(() => document.documentElement.dir) === 'rtl', 'and the page is right-to-left')

  // The direction has to be right at the FIRST frame, not after hydration:
  // flipping it later is a full-page relayout the visitor watches happen.
  const early = await p.evaluate(() => window.__SPORTA_LANG)
  is(early === 'ar', 'decided before the app loaded, not after', String(early))

  // Nothing may be persisted, or a traveller is stuck in whatever they landed in.
  is(await p.evaluate(() => localStorage.getItem('lang')) === null,
     'and nothing was written to storage — they have not chosen yet')

  const body = await p.locator('body').innerText()
  is(/[؀-ۿ]/.test(body), 'the page has Arabic on it')
  is(!/Same-day delivery/.test(body), 'and no English promo bar left showing')

  // Tapping the toggle IS a choice, and must stick.
  await p.getByRole('button', { name: /تغيير اللغة|switch language/i }).first().click()
  await p.waitForTimeout(400)
  is(await p.evaluate(() => document.documentElement.lang) === 'en', 'the toggle switches to English')
  is(await p.evaluate(() => localStorage.getItem('lang')) === 'en',
     'and THAT is saved, because it was a decision')
  await p.reload({ waitUntil: 'networkidle' })
  is(await p.evaluate(() => document.documentElement.lang) === 'en',
     'so the shop stays English on the next visit, in Kuwait, forever')

  is(errs.length === 0, 'nothing threw', errs.join(' | ') || 'clean')
  await kw.close()

  // A visitor in London gets English, and ?lang=ar still works for them.
  const uk = await browser.newContext({
    viewport: { width: 1280, height: 800 }, locale: 'en-GB',
    timezoneId: 'Europe/London', serviceWorkers: 'block',
  })
  const up = await uk.newPage()
  await up.goto(BASE, { waitUntil: 'networkidle' })
  is(await up.evaluate(() => document.documentElement.lang) === 'en', 'London gets English')

  // The regression this ordering exists to prevent: an English phone sitting
  // in Kuwait must NOT be flipped to Arabic by its own time zone.
  const expat = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'en-GB',
    timezoneId: 'Asia/Kuwait', serviceWorkers: 'block',
  })
  const ep = await expat.newPage()
  await ep.goto(BASE, { waitUntil: 'networkidle' })
  is(await ep.evaluate(() => document.documentElement.lang) === 'en',
     'an ENGLISH phone in Kuwait stays English — the phone outranks the place')
  is(await ep.evaluate(() => document.documentElement.dir) === 'ltr', 'and the page stays left-to-right')
  await expat.close()
  await up.goto(`${BASE}/?lang=ar`, { waitUntil: 'networkidle' })
  is(await up.evaluate(() => document.documentElement.dir) === 'rtl',
     '?lang=ar opens Arabic for them anyway')
  await uk.close()

  await browser.close()
}

console.log(fails ? `\n${fails} problem(s) in the Arabic` : '\nArabic: correct, and the right people get it')
process.exit(fails ? 1 : 0)
