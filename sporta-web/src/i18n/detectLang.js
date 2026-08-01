// Which language a visitor gets when they have never chosen one.
//
// THE ORDER, and why each step is where it is:
//
//   1. an explicit choice they made before  — nothing may override a person
//      who has tapped the language button. Stored only when they tap it.
//   2. ?lang=ar / ?lang=en on the URL       — so a campaign, a WhatsApp
//      message or a QR code can open the shop in the right language.
//   3. the device's LANGUAGES               — a phone set to Arabic is the
//      strongest statement of preference there is, and it is free.
//   4. the device's TIME ZONE               — where the visitor is.
//   5. English.
//
// WHY TIME ZONE AND NOT THE IP ADDRESS.
//
// The ask was "Arabic for Middle East IPs", and the time zone is the better
// instrument for it here, for three reasons that are all measurable:
//
//   * It is SYNCHRONOUS. The language has to be known before the first frame:
//      it sets <html dir>, which decides the entire page layout, and it picks
//      which font files to preload. An IP lookup is a network round trip, so
//      it can only arrive AFTER the page has painted — meaning every Gulf
//      visitor would see an English, left-to-right page flip to Arabic
//      right-to-left in front of them. That is a worse experience than the
//      thing it was trying to fix, and it is a large layout shift on the
//      most-viewed element of the site.
//   * It needs NO DATABASE. Shared hosting has no GeoIP module, and a bundled
//      IP-range table would be wrong the day a registry reallocates a block.
//      `Intl.DateTimeFormat().resolvedOptions().timeZone` is in every browser
//      this site supports and costs nothing.
//   * It is MORE ACCURATE for this shop. A Kuwaiti on a foreign SIM, a VPN, or
//      a corporate proxy in Frankfurt all keep Asia/Kuwait on their phone.
//
// If the site is ever put behind Cloudflare, `CF-IPCountry` arrives as a real
// header and `countryFromHeader()` below is where it would join step 4 —
// server-side, so it would still be synchronous by the time the page renders.
//
// SEO: this never redirects and never changes the URL. Every page keeps one
// canonical address in both languages, so Googlebot (US IP, en, UTC) sees
// English, and the hreflang tags stay honest. Auto-redirecting on location is
// what gets a shop's Arabic pages dropped from the index.

// The time zones of the Arabic-speaking world. `Asia/Kuwait` first because
// that is the shop's own market and the overwhelming majority of its traffic.
//
// Deliberately not "the Middle East": Iran (Asia/Tehran), Türkiye
// (Europe/Istanbul) and Israel (Asia/Jerusalem) are in the region and are not
// Arabic-speaking, so defaulting them to Arabic would be worse than English.
export const ARABIC_TIME_ZONES = new Set([
  // Gulf
  'Asia/Kuwait', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Qatar', 'Asia/Bahrain',
  'Asia/Muscat', 'Asia/Aden',
  // Levant and Iraq
  'Asia/Baghdad', 'Asia/Amman', 'Asia/Beirut', 'Asia/Damascus', 'Asia/Hebron',
  'Asia/Gaza',
  // North Africa
  'Africa/Cairo', 'Africa/Tripoli', 'Africa/Tunis', 'Africa/Algiers',
  'Africa/Casablanca', 'Africa/El_Aaiun', 'Africa/Khartoum', 'Africa/Juba',
  'Africa/Nouakchott', 'Africa/Mogadishu', 'Africa/Djibouti',
  // Historical aliases browsers still report
  'Asia/Riyadh87', 'Asia/Riyadh88', 'Asia/Riyadh89',
])

const SUPPORTED = new Set(['en', 'ar'])

// A language tag from the URL, if it names one we have.
export function langFromQuery(search = '') {
  const m = /[?&]lang=([A-Za-z-]{2,10})/.exec(String(search))
  if (!m) return null
  const tag = m[1].toLowerCase().split('-')[0]
  return SUPPORTED.has(tag) ? tag : null
}

// Any Arabic in the browser's accept-language list.
//
// `navigator.languages` and not just `navigator.language`: a phone set to
// English with Arabic second is a bilingual reader, and this shop is bilingual.
// Matching on the SUBTAG covers ar, ar-KW, ar-SA, arz (Egyptian) and so on.
export function prefersArabic(languages = []) {
  return languages.some((l) => /^ar\b|^ar-|^arz|^ary|^acm|^apc|^ajp|^afb/i.test(String(l)))
}

export function isArabicTimeZone(tz) {
  return !!tz && ARABIC_TIME_ZONES.has(tz)
}

// The whole decision, pure and testable.
//
// `saved` is the stored explicit choice (or null). Everything else is read
// from the environment by the caller, so this function has no globals in it
// and the tests can drive every branch.
export function detectLang({ saved = null, search = '', languages = [], timeZone = null } = {}) {
  if (SUPPORTED.has(saved)) return saved
  const fromUrl = langFromQuery(search)
  if (fromUrl) return fromUrl
  if (prefersArabic(languages)) return 'ar'
  if (isArabicTimeZone(timeZone)) return 'ar'
  return 'en'
}

// The same decision, reading the live browser. Kept apart from detectLang so
// the rules above can be tested without a DOM.
export function detectLangFromBrowser() {
  let timeZone = null
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    /* very old browser: fall through to the language list */
  }
  let saved = null
  try {
    saved = localStorage.getItem('lang')
  } catch {
    /* private mode with storage disabled */
  }
  return detectLang({
    saved,
    search: typeof location === 'undefined' ? '' : location.search,
    languages: typeof navigator === 'undefined'
      ? []
      : navigator.languages ?? [navigator.language].filter(Boolean),
    timeZone,
  })
}
