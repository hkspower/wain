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
import { detectLang, langFromQuery } from '../src/i18n/detectLang.js'
import { translations, arabicCount } from '../src/i18n/translations.js'

const BASE = process.env.BASE ?? 'http://127.0.0.1:8096'
let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 56 - t.length))}`)

// ===========================================================================
head('who gets Arabic')

// ARABIC IS THE DEFAULT, and the rule is now deliberately short: an explicit
// choice, then ?lang=, then Arabic.
//
// THIS SECTION USED TO ASSERT THE OPPOSITE, and the assertions were right for
// the design they described — "the phone decides", an English phone in Kuwait
// stays English, the time zone as a fallback. That design guessed a visitor's
// language at a URL that belonged to neither. The bare URL is now the ARABIC
// one and says so in its own canonical, so it has to be Arabic for everyone: a
// page that renders English at an address canonical to Arabic contradicts
// itself, and Googlebot — which reports en-US — is exactly the visitor that
// would see the contradiction.
is(detectLang({}) === 'ar', 'with no signal at all, the answer is ARABIC')
is(detectLang({ search: '' }) === 'ar', 'the bare URL is Arabic')

// The device is no longer consulted, and that is the change. An English phone
// gets Arabic at the bare URL — one tap on the toggle fixes it for good, and
// English has its own address for a link or a search result to point at.
is(detectLang({ saved: null, search: '' }) === 'ar',
   'and a device that would once have chosen English does not get a vote')

// EXPLICIT CHOICES STILL WIN, both of them, and that is what keeps this humane.
is(detectLang({ search: '?lang=en' }) === 'en',
   '?lang=en opens English — what an English search result links to')
is(detectLang({ search: '?utm=spring&lang=en' }) === 'en',
   'alongside other query parameters, so a campaign link works')
is(detectLang({ saved: 'en' }) === 'en',
   'a visitor who TAPPED English keeps English — a tap is stored, and it outranks the default')
is(detectLang({ saved: 'en', search: '?lang=ar' }) === 'en',
   'and their saved choice even outranks ?lang= — the person beats the link')
is(detectLang({ saved: 'ar' }) === 'ar', 'a saved Arabic choice is honoured too')
is(langFromQuery('?lang=de') === null, 'a language we do not have is ignored, not obeyed')
is(detectLang({ saved: 'de' }) === 'ar', 'and a stored junk value falls back to the default')

// ---------------------------------------------------------------------------
// The two copies of the rule.
//
// index.html carries the decision inlined because it has to run before any
// module does — it sets <html dir> and picks which fonts to preload. That is a
// second implementation of the same rule, and a second implementation drifts.
head('index.html and detectLang.js agree')
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

  // The boot script must reach the SAME answer as the module. It used to be
  // compared table-for-table against a list of Arabic time zones; there is no
  // table any more, so what is checked now is the rule itself — that it falls
  // back to Arabic, and that neither of the two signals that were removed has
  // quietly returned.
  is(/if \(!lang\) lang = 'ar'/.test(html),
     'the boot script falls back to ARABIC, exactly as detectLang does')
  is(!/navigator\.languages/.test(html),
     'and it does NOT consult the device language — that would contradict the canonical')
  is(!/resolvedOptions\(\)\.timeZone/.test(html),
     'nor the time zone')
  is(/<html lang="ar" dir="rtl">/.test(html),
     'the raw HTML is Arabic, for a crawler that runs no JavaScript')

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

// And the reverse: an Arabic key with no English twin is an ORPHAN — dead copy
// left behind when the English side was renamed, or a key only ever added to
// ar. The forward check above cannot see it (it walks English), so a stray
// Arabic string could sit in the bundle, shipped and unreachable, forever.
const enMap = new Map(enKeys)
const orphanKeys = walk(ar).filter(([k]) => !enMap.has(k)).map(([k]) => k)
is(orphanKeys.length === 0, 'every Arabic string has an English twin — no orphans', orphanKeys.slice(0, 5).join(', ') || 'none orphaned')

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

  // A VISITOR IN LONDON ON AN ENGLISH LAPTOP ALSO GETS ARABIC, and that is the
  // whole change rather than an oversight. The bare URL is the Arabic one; the
  // device no longer votes, anywhere. English is reached by ?lang=en — which is
  // what the hreflang tags advertise and what an English search result links
  // to — or by one tap on the toggle, which is then remembered.
  const uk = await browser.newContext({
    viewport: { width: 1280, height: 800 }, locale: 'en-GB',
    timezoneId: 'Europe/London', serviceWorkers: 'block',
  })
  const up = await uk.newPage()
  await up.goto(BASE, { waitUntil: 'networkidle' })
  is(await up.evaluate(() => document.documentElement.lang) === 'ar',
     'an English laptop in London gets ARABIC at the bare URL — the device does not vote')

  await up.goto(`${BASE}/?lang=en`, { waitUntil: 'networkidle' })
  is(await up.evaluate(() => document.documentElement.lang) === 'en',
     'and ?lang=en is how they get English')
  is(await up.evaluate(() => document.documentElement.dir) === 'ltr',
     'left to right, as English must be')
  await uk.close()
  // ---------------------------------- the policy says the same thing everywhere
  // THE RETURNS POLICY LIVES IN FIVE PLACES and they have to agree, because a
  // customer meets whichever one they happen to open: /returns, /terms,
  // /about, the footer badge, and the assistant's answer. They drifted —
  // /returns and /terms both stated the window, but /returns said
  // «الاستبدال والإرجاع مجاني» where the other two said «مجانيان». Two nouns
  // joined by و are a DUAL subject, so the adjective is dual; the page that
  // defines the policy was the one with the error.
  //
  // The assistant had the bigger problem: it named the window and the
  // condition but never said the returns were FREE, in either language, while
  // every other surface promised it. Someone who asked the shop assistant
  // instead of reading the page was quietly told less than the shop offers.
  {
    const { readFileSync } = await import('node:fs')
    // Comments stripped, or the check reads a code comment as shipped copy —
    // and the English window must be matched as "14 days"/"14-day", never a
    // bare 14: the shop's own phone number ends 1914, which passed a looser
    // pattern on a page whose FAQ never mentioned the window at all.
    const src = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')
    const surfaces = {
      '/returns':   src('src/pages/Returns.jsx'),
      '/terms':     src('src/pages/Terms.jsx'),
      '/about':     src('src/pages/About.jsx'),
      'assistant':  src('dropin/php-store/assistant.php'),
    }
    for (const [name, text] of Object.entries(surfaces)) {
      // Arabic: the window, in Arabic-Indic digits, and the word "free".
      const win = /١٤\s*يومًا/.test(text)
      // «مجاني» singular is CORRECT when the subject is one noun
      // («الاستبدال مجاني»); it is only wrong for the two-noun compound, and
      // that is what the dedicated check below catches. Accept all three forms
      // here, or this check starts failing on correct Arabic.
      const free = /مجانيان|مجانًا|مجاني/.test(text)
      is(win,  `${name} states the 14-day window in Arabic`)
      is(free, `${name} says returns are free in Arabic`)
      // and never the singular form for the two-noun subject
      is(!/(الاستبدال والإرجاع|الإرجاع والاستبدال)\s+(مجاني|متاح)(?![يا])/.test(text),
         `${name} uses the DUAL form, not «مجاني»/«متاح», for the two-noun subject`)
    }
    // English has to carry the same two facts.
    for (const [name, text] of Object.entries(surfaces)) {
      is(/within 14 days|14-day/.test(text), `${name} states the 14-day window in English`)
      is(/free/i.test(text), `${name} says returns are free in English`)
    }
  }

  const expat = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'en-GB',
    timezoneId: 'Asia/Kuwait', serviceWorkers: 'block',
  })
  const ep = await expat.newPage()
  await ep.goto(BASE, { waitUntil: 'networkidle' })
  // THE COST OF THE DEFAULT, ASSERTED RATHER THAN LEFT IMPLIED. Roughly seventy
  // per cent of Kuwait is expatriate, and an English phone here now lands on
  // Arabic. That is the accepted trade for the bare URL being the Arabic one;
  // writing it down as a passing check means nobody later reads it as a bug.
  is(await ep.evaluate(() => document.documentElement.lang) === 'ar',
     'an English phone IN KUWAIT also gets Arabic — the accepted cost of the default')

  // And the way out is one tap, remembered for good.
  await ep.getByRole('button', { name: /تغيير اللغة|switch language/i }).first().click()
  await ep.waitForTimeout(400)
  is(await ep.evaluate(() => document.documentElement.lang) === 'en', 'one tap gives them English')
  is(await ep.evaluate(() => document.documentElement.dir) === 'ltr', 'left to right with it')
  await ep.reload({ waitUntil: 'networkidle' })
  is(await ep.evaluate(() => document.documentElement.lang) === 'en',
     'and it survives a reload — they never meet the default twice')
  await expat.close()

  await browser.close()
}

console.log(fails ? `\n${fails} problem(s) in the Arabic` : '\nArabic: correct, and the right people get it')
process.exit(fails ? 1 : 0)
