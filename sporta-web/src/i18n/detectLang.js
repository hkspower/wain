// Which language a visitor gets when they have never chosen one.
//
//   1. an explicit choice they made before  — nothing may override a person
//      who has tapped the language button. Stored only when they tap it.
//   2. ?lang=ar / ?lang=en on the URL       — so a campaign, a WhatsApp
//      message or a QR code can open the shop in the right language.
//   3. ARABIC.
//
// ARABIC IS THE DEFAULT, AND IT IS A DEFAULT RATHER THAN A GUESS.
//
// This used to consult the device's language list and then its time zone. Both
// are gone, and their absence is the point: the bare URL now has ONE answer.
//
// The reason is search, and it is not a preference. sporta.com.kw/ is the
// strongest address the shop has, and Kuwait's market searches for sportswear
// in Arabic. For Google to index that URL as Arabic, that URL has to BE Arabic
// — for everyone, every time. The alternative is serving Arabic to Googlebot
// and English to a visitor at the same address, which is cloaking and risks the
// whole domain.
//
// It also cannot be conditional on the device without lying. If an English
// phone renders English at a URL whose canonical says Arabic, then Googlebot —
// which reports en-US — indexes English under an Arabic canonical, and the two
// contradict each other. A canonical is a promise about what is at an address.
//
// WHAT THIS COSTS, stated plainly because it is real: an English-speaking
// resident — and roughly seventy per cent of Kuwait is expatriate — lands on
// Arabic the first time. One tap on the language button fixes it permanently,
// because step 1 above outranks everything and a tap is stored. English also
// has its own address, /?lang=en, which is what the hreflang tags advertise and
// what an English search result links to.
//
// WHAT WAS REMOVED, AND WHY IT IS NOT COMING BACK.
//
// This file used to consult the device's language list and then its time zone,
// and carried a table of every Arabic-speaking time zone to do it. All of that
// is gone. It was the right design for a site whose bare URL was English and
// whose job was to guess a visitor's language; it is the wrong design for one
// whose bare URL IS Arabic, because a guess and a canonical cannot both decide
// what is at an address.
//
// If a future change ever makes the bare URL language-neutral again, the rule
// to restore is in git — along with the reasoning for reading the time zone
// rather than the IP, which still holds: it is synchronous, so it lands before
// the first paint instead of flipping the layout after it.

const SUPPORTED = new Set(['en', 'ar'])

// A language tag from the URL, if it names one we have.
export function langFromQuery(search = '') {
  const m = /[?&]lang=([A-Za-z-]{2,10})/.exec(String(search))
  if (!m) return null
  const tag = m[1].toLowerCase().split('-')[0]
  return SUPPORTED.has(tag) ? tag : null
}

// The whole decision, pure and testable.
//
// `saved` is the stored explicit choice (or null). Everything else is read
// from the environment by the caller, so this function has no globals in it
// and the tests can drive every branch.
export function detectLang({ saved = null, search = '' } = {}) {
  if (SUPPORTED.has(saved)) return saved

  const fromUrl = langFromQuery(search)
  if (fromUrl) return fromUrl

  // ARABIC. Not because of the device, not because of the time zone — because
  // this address is the Arabic one, and it says so in its own canonical.
  return 'ar'
}

// The same decision, reading the live browser. Kept apart from detectLang so
// the rules above can be tested without a DOM.
export function detectLangFromBrowser() {
  let saved = null
  try {
    saved = localStorage.getItem('lang')
  } catch {
    /* private mode with storage disabled */
  }
  return detectLang({
    saved,
    search: typeof location === 'undefined' ? '' : location.search,
  })
}
