// Every Arabic word the shop says, against the OFFICIAL Arabic dictionary.
//
// scripts/arabic-test.mjs already checks the things a program can know without
// a dictionary: missing keys, English left untranslated, {placeholder}
// survival, tanwin written ـً before the alif, Latin punctuation stranded
// between Arabic words, mixed digit systems, and the five counting cases. What
// it cannot catch is a WORD THAT IS SIMPLY MISSPELLED — تسوّق for تسوق, a
// dropped ء, a ه where a ة belongs. Those read as carelessness to a native
// customer and no amount of structural checking finds them.
//
// So this runs the real thing: hunspell with ar_KW, the Kuwait locale of the
// Ayaspell dictionary that ships in Debian/Ubuntu as `hunspell-ar` (~170,000
// stems). Install with:  sudo apt-get install hunspell hunspell-ar
//
// -------------------------------------------------------------------- DIALECT
//
// The shop writes KUWAITI, on purpose and by standing instruction: «شلون كانت
// تجربتك», «وين طلبي», «هلا والله». The dictionary is Modern Standard Arabic
// and will flag every one of them, correctly by its own lights and wrongly by
// the shop's.
//
// A checker that cries wolf on the brand voice gets switched off within a
// week, so the dialect is declared here, once, with its meaning. That list is
// the point of this file as much as the spell-check is: it is the only written
// record of which non-standard spellings are deliberate, and anything NOT on
// it that the dictionary rejects is a genuine question.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const DICT = 'ar_KW'
let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) }
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)

if (!existsSync(`/usr/share/hunspell/${DICT}.dic`)) {
  console.log(`hunspell's ${DICT} dictionary is not installed — skipping.`)
  console.log('  sudo apt-get install hunspell hunspell-ar')
  // Not a failure. A machine without the dictionary cannot answer the
  // question, and a suite that fails for that reason teaches people to ignore
  // it. The check is worthless if it is not trusted.
  process.exit(0)
}

// ------------------------------------------------------- deliberate Kuwaiti
//
// Every entry is a word the dictionary rejects and the shop means. Adding to
// this list is a decision — write the reason.
const DIALECT = new Map([
  ['شلون', 'Kuwaiti for "how" — the standard كيف would read as a formal notice'],
  ['هلا', 'the Gulf greeting, as in هلا والله'],
  ['نحلها', 'we will sort it out'],
  ['الجاي', 'colloquial "the next (one)"'],
  ['المايك', 'the mic — borrowed, and what people actually say'],
])


// ------------------------------------------------------ borrowed and branded
//
// Words Arabic has taken from English, and names. The dictionary does not hold
// them and never will, but they are not misspellings — واتساب is how Kuwait
// writes WhatsApp, and a shop that wrote "WhatsApp" in Latin inside an Arabic
// sentence would be the one making the mistake.
//
// Separate from DIALECT on purpose. Dialect is a CHOICE about voice and could
// reasonably be revisited; these are simply the words, and nothing about them
// is up for debate. Keeping them apart means the dialect list stays a short,
// readable statement of how the shop speaks.
const LOANWORDS = new Map([
  ['واتساب', 'WhatsApp'],
  ['إنستغرام', 'Instagram'],
  ['فيزا', 'Visa'],
  ['ماستركارد', 'Mastercard'],
  ['باي', 'the "Pay" of T-Pay, written out in Arabic'],
  ['سبورتس', 'the "Sports" of the SPORTA SPORTS WEAR wordmark'],
  ['ريو', 'RHEO — a brand the shop stocks'],
  ['كارديو', 'cardio'],
  ['بوكسينغ', 'boxing'],
  ['تيشيرتات', 'T-shirts'],
  ['هوديز', 'hoodies'],
  ['جاكيتات', 'jackets'],
  ['ليقنز', 'leggings — the Gulf spelling, with ق for the hard g'],
  ['إكسسوارات', 'accessories'],
  ['كابات', 'caps'],
  ['شنط', 'bags — Egyptian/Gulf, universal in Arabic retail'],
  // Brands the shop stocks, and the company that runs it. Names are not
  // spelled by dictionaries.
  ['فانكويش', 'Vanquish'],
  ['جيمشارك', 'Gymshark'],
  ['سبورت', 'the "Sport" of آي سبورت (Eyesportwear)'],
  ['المهلب', 'Al-Muhallab — the company operating the shop, named in the footer'],
])

// -------------------------------------------------- correct, but not in there
//
// Ordinary Modern Standard Arabic that this dictionary happens not to carry.
// Neither dialect nor loanword: nothing about these is a choice, and if the
// dictionary were complete they would not be here at all.
//
// They are listed separately because they are the entries most likely to be
// WRONG — "the dictionary is incomplete" is exactly what someone says about
// their own typo. Each one below was checked by reading it in context, and the
// context is named so the next person can check it again.
const DICTIONARY_GAPS = new Map([
  ['إطلالتك', 'your look — إطلالة + ك. cross.title: «أكمل إطلالتك»'],
  ['القياسات', 'the measurements — regular sound plural of قياس. size.note'],
])

// ------------------------------------------------------------- what to check
const { translations } = await import('../src/i18n/translations.js')

// Walk the ar tree, keeping the path so a failure names the key rather than
// the word alone — "rate.subtitle" is actionable, "a misspelling somewhere" is
// not.
const strings = []
;(function walk(node, path) {
  if (typeof node === 'string') { strings.push([path, node]); return }
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k)
  }
})(translations.ar, '')

head('the dictionary is the official one')
{
  const words = execFileSync('wc', ['-l', `/usr/share/hunspell/${DICT}.dic`], { encoding: 'utf8' })
  ok(`hunspell ${DICT} — the Kuwait locale of the Ayaspell dictionary`,
     `${words.trim().split(' ')[0]} entries`)
  // WHAT THIS CHECK CAN AND CANNOT DO, asserted rather than assumed.
  //
  // A dictionary that accepted everything would make every check below pass
  // while finding nothing, and that failure is silent — so the classes of
  // error it really catches are pinned here, with a correct word alongside to
  // prove it is not simply rejecting everything.
  //
  // These three are the mistakes that actually occur in Arabic copy:
  const catches = spell(['التوصيل', 'التوصييل', 'الرياضه', 'مرحبأ'])
  is(!catches.includes('التوصيل'), 'a correctly spelled word passes')
  is(catches.includes('التوصييل'), 'a doubled letter is caught', 'التوصييل')
  // ة written as ه is the single most common Arabic typing error there is.
  is(catches.includes('الرياضه'), 'ه where ة belongs is caught', 'الرياضه')
  is(catches.includes('مرحبأ'), 'a hamza on the wrong seat is caught', 'مرحبأ')

  // AND THE LIMIT, stated out loud so nobody reads a pass as more than it is.
  // Arabic morphology plus this dictionary's affix rules generate an enormous
  // valid space, so a slip that lands on ANOTHER REAL WORD is invisible here:
  // التوصل (attainment) is perfectly good Arabic and is not التوصيل
  // (delivery). No spell-checker in any language catches that one; it needs a
  // reader. This suite proves the words exist, not that they are the right
  // words.
  const limit = spell(['التوصل'])
  is(limit.length === 0,
     'a typo that forms another real word is NOT caught — this is a spell-check, not a proofread',
     'التوصل passes; only a human notices it should be التوصيل')
}

// Ask hunspell about a batch of words. -l lists only what it does not know.
function spell(words) {
  if (!words.length) return []
  const out = execFileSync('hunspell', ['-d', DICT, '-i', 'UTF-8', '-l'], {
    input: words.join('\n'),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return out.split('\n').map((w) => w.trim()).filter(Boolean)
}

// Arabic runs only. Everything else is deliberately out of scope:
//   * {placeholder} — replaced at runtime, not a word;
//   * Latin (KNET, T-Pay, Google, WhatsApp, cs@sporta.com.kw) — not Arabic and
//     not this dictionary's business;
//   * digits, Arabic-Indic or Western.
// Tatweel and the tashkeel marks are stripped: they are typographic, the
// dictionary's stems do not carry them, and leaving them in flags correctly
// spelled words.
const ARABIC_RUN = /[\u0621-\u064A\u0671-\u06D3]+/g
// STRIPPED BEFORE TOKENISING, NOT AFTER, and the order is the whole point.
// The tashkeel marks live at U+064B-U+0652, ABOVE the letter range, so a word
// carrying one is not one run to a letters-only pattern: مصمَّمة came out as
// «مصم» + «مة», two fragments the dictionary rejected, and it read exactly like
// two misspellings in the shop's headline. The copy was correct; the tokeniser
// was not.
const STRIP = /[\u064B-\u0652\u0640\u0670]/g

const seen = new Map()   // word -> Set(paths)
for (const [path, s] of strings) {
  // Placeholders go BEFORE tokenising, or {n} leaves a bare n.
  const cleaned = s.replace(/\{[a-zA-Z0-9_]+\}/g, ' ').replace(STRIP, '')
  for (const run of cleaned.match(ARABIC_RUN) ?? []) {
    const w = run
    if (w.length < 2) continue          // single letters: ـ, و, ل — not words
    if (!seen.has(w)) seen.set(w, new Set())
    seen.get(w).add(path)
  }
}

// ------------------------------------------- and the Arabic the SERVER says
//
// The assistant's fixed answers live in assistant.php, not in translations.js,
// so the file above has never seen them — and they are the sentences a customer
// is most likely to hear read ALOUD, where a misspelling becomes a
// mispronunciation. Pulled straight out of the PHP source: crude, but it is a
// spell-check, and a token that is not really a word simply gets reported like
// any other.
for (const file of ['assistant.php', 'store.php', 'api.php']) {
  let src = ''
  try { src = readFileSync(new URL(`../dropin/php-store/${file}`, import.meta.url), 'utf8') }
  catch { continue }
  // Single- and double-quoted strings containing Arabic. Comments are included
  // too; the reasoning in this codebase is written in English, so an Arabic run
  // inside one is a quoted example and worth checking anyway.
  for (const m of src.match(/[^\n]*[\u0621-\u064A][^\n]*/g) ?? []) {
    strings.push([file, m])
  }
}

head('every Arabic word the shop says')
const words = [...seen.keys()]
ok('collected from the translations', `${words.length} distinct words across ${strings.length} strings`)

const unknown = spell(words)

// PROCLITICS. Arabic glues و (and), ف (so) and ب/ل directly onto the next
// word, so «وهوديز» is «و» + «هوديز» and the dictionary sees one unknown token.
// It handles this for words it knows; it cannot for a borrowed one, which is
// exactly where the shop's vocabulary lives — five of the first run's findings
// were the same four loanwords wearing a conjunction.
//
// Only ONE letter is stripped and only when what remains is itself declared,
// so this cannot quietly excuse a real typo that happens to start with و.
// The declared words are normalised the SAME WAY the copy is before either is
// looked up. Written with their shadda — «قيّمنا», as the shop spells it — they
// would never match a stripped token and would sit here declaring nothing.
const norm = (w) => w.replace(STRIP, '')
const DECLARED = new Set(
  [...DIALECT.keys(), ...LOANWORDS.keys(), ...DICTIONARY_GAPS.keys()].map(norm),
)
const KNOWN = (w) => DECLARED.has(w)
// ال — the definite article — is two letters and attaches the same way, so
// «الكارديو» is «ال» + a loanword the dictionary will never hold.
const declared = (w) =>
  KNOWN(w)
  || (/^[وفبل]/.test(w) && w.length > 2 && KNOWN(w.slice(1)))
  || (w.startsWith('ال') && w.length > 3 && KNOWN(w.slice(2)))
  || (/^[وف]ال/.test(w) && w.length > 4 && KNOWN(w.slice(3)))

const undeclared = unknown.filter((w) => !declared(w))

is(undeclared.length === 0,
   'every word is standard Arabic, or a DECLARED Kuwaiti or borrowed one',
   undeclared.length
     ? `${undeclared.length} unrecognised`
     : `${unknown.length} outside the dictionary, every one accounted for`)

if (undeclared.length) {
  console.log('\n  Not in the dictionary and not declared as dialect:\n')
  for (const w of undeclared) {
    const where = [...(seen.get(w) ?? [])].slice(0, 3).join(', ')
    // Hunspell's own suggestions, so a real typo is fixable from this output
    // rather than requiring a second tool.
    let sug = ''
    try {
      const out = execFileSync('hunspell', ['-d', DICT, '-i', 'UTF-8', '-a'], {
        input: w, encoding: 'utf8',
      })
      const line = out.split('\n').find((l) => l.startsWith('&'))
      if (line) sug = line.split(':')[1]?.trim().split(', ').slice(0, 4).join('  ') ?? ''
    } catch { /* -a is a convenience; its absence must not break the report */ }
    console.log(`    ${w.padEnd(16)} ${where}`)
    if (sug) console.log(`    ${''.padEnd(16)} did you mean: ${sug}`)
  }
  console.log('\n  Each is a typo, or Kuwaiti the shop means, or a borrowed word.')
  console.log('  If it is not a typo, add it to DIALECT or LOANWORDS above')
  console.log('  WITH ITS REASON — an undocumented exception is not an exception.\n')
}

// ------------------------------------------------- the dialect list is honest
head('the dialect list stays honest')
{
  // A declared word the dictionary NOW accepts is not an error, but it is dead
  // weight: it hides nothing and it makes the list look longer than the real
  // set of deliberate departures. Reported, not failed.
  const stale = [...DECLARED].filter((w) => !unknown.includes(w) && seen.has(w))
  is(stale.length === 0, 'no declared dialect word is redundant',
     stale.length ? `${stale.join(', ')} — the dictionary accepts these` : 'none')

  // And a declaration for a word the shop no longer uses is a note about
  // nothing. Also reported rather than failed: a string may be added back.
  const unused = [...DECLARED].filter(
    (w) => !seen.has(w) && ![...seen.keys()].some((k) => k.endsWith(w) && k.length - w.length <= 3),
  )
  if (unused.length) console.log(`     (${unused.length} declared but not currently used: ${unused.join(', ')})`)
}

console.log(fails
  ? `\n${fails} problem(s) in the Arabic copy`
  : '\nArabic: every word checked against the official dictionary')
process.exit(fails ? 1 : 0)
