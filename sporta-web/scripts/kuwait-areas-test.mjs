// The area -> governorate inference in src/lib/kuwait.js is only sound while the
// 97 area names are unique across all six governorates. If two governorates ever
// list the same area, the checkout would silently pick whichever comes first and
// send an order to the wrong half of the country.
//
//   node scripts/kuwait-areas-test.mjs
import { GOVERNORATES, governorateOfArea, normalisePhone, toAsciiDigits } from '../src/lib/kuwait.js'

let fails = 0
const check = (ok, what) => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

// 1. no area name appears in two governorates, in either language
for (const key of ['en', 'ar']) {
  const seen = new Map()
  const clashes = []
  for (const g of GOVERNORATES) {
    for (const a of g.areas) {
      const name = a[key].trim().toLowerCase()
      if (seen.has(name) && seen.get(name) !== g.id) clashes.push(`${a[key]}: ${seen.get(name)} + ${g.id}`)
      seen.set(name, g.id)
    }
  }
  check(clashes.length === 0, `${key}: area names unique across governorates ${clashes.join('; ')}`)
}

// 2. every area resolves back to its own governorate, in both languages
const all = GOVERNORATES.flatMap((g) => g.areas.map((a) => [a, g.id]))
const wrong = all.filter(([a, id]) =>
  governorateOfArea(a.en)?.id !== id || governorateOfArea(a.ar)?.id !== id)
check(wrong.length === 0, `all ${all.length} areas resolve to their own governorate` +
  (wrong.length ? ` — wrong: ${wrong.map(([a]) => a.en).join(', ')}` : ''))

// 3. nothing resolves for input that is not an area
for (const junk of ['', ' ', 'a', 'Zzzz', 'Riyadh', '12']) {
  check(governorateOfArea(junk) === null, `"${junk}" resolves to nothing`)
}

// 4. Arabic-Indic and Eastern Arabic-Indic digits reach the phone validator.
// Half the customers read the site in Arabic and their keyboard types ٩, which
// /\D/ deletes — the phone field silently refused every keystroke.
check(toAsciiDigits('٠١٢٣٤٥٦٧٨٩') === '0123456789', 'Arabic-Indic digits map to ASCII')
check(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹') === '0123456789', 'Eastern Arabic-Indic digits map to ASCII')
check(toAsciiDigits('قطعة ٤') === 'قطعة 4', 'letters are left alone')
for (const [input, want] of [
  ['٩٩٨٨٧٧٦٦', '96599887766'],
  ['۹۹۸۸۷۷۶۶', '96599887766'],
  ['٩٩٨٨ ٧٧٦٦', '96599887766'],
  ['+965 ٩٩٨٨٧٧٦٦', '96599887766'],
  ['9988 7766', '96599887766'],
  ['١٢٣', null],
]) check(normalisePhone(input) === want, `normalisePhone("${input}") -> ${want}`)

console.log(fails ? `\n${fails} failed` : '\nall good')
process.exit(fails ? 1 : 0)
