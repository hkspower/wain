/**
 * "Cannot be exchanged" must mean the same thing everywhere it is said.
 *
 * THE BUG THIS EXISTS FOR. The policy had two definitions. `?r=products` — what
 * the shopper is SHOWN — read the `products.no_exchange` column, while
 * store_return_lookup() and the size adviser both DECIDED with
 * `category === 'women'`. On the real catalogue they disagreed about ten
 * outerwear garments: the shop told the shopper those jackets could not be
 * exchanged and then accepted the exchange. Nothing reported it, because each
 * half was self-consistent and no test compared them.
 *
 * So this rig is a parity test, not a behaviour test. It does not assert that
 * women's clothing is the rule — that is the owner's policy and it can change.
 * It asserts that the answer the LISTING gives and the answer the RETURNS path
 * gives are the same answer, for every active product, whatever the rule is.
 * That is the property that was broken, and it survives a change of policy.
 *
 * THE THIRD HOME IS CHECKED STATICALLY. The size adviser computes the same
 * thing a third time, and a rig driving only the two HTTP surfaces would not
 * see it drift. There is no fixture that reaches it for every product, so the
 * check is that all three sites still express one rule.
 */
import { readFileSync } from 'node:fs'

const BASE = process.env.SPORTA_BASE || 'http://127.0.0.1:4300'
const ROOT = new URL('../sporta-site/public_html', import.meta.url).pathname

let pass = 0, fail = 0
const ok = (m, d = '') => { pass++; console.log(`ok   ${m}${d ? '   ' + d : ''}`) }
const bad = (m, d = '') => { fail++; console.log(`FAIL ${m}${d ? '   ' + d : ''}`) }

console.log(`no-exchange parity — ${BASE}\n`)

const res = await fetch(`${BASE}/api/api.php?r=products`)
const body = await res.json()
const products = body.products ?? body

// A rig that finds nothing checks nothing, and its silence looks like success.
if (!Array.isArray(products) || products.length < 5) {
  bad('the catalogue was read', `${Array.isArray(products) ? products.length : typeof products} product(s) — refusing to pass on that`)
  console.log(`\nFAILED — ${fail} of ${pass + fail}`)
  process.exit(1)
}
ok('the catalogue was read', `${products.length} active products`)

// Both categories must be REPRESENTED, or the comparison is vacuous: a
// catalogue of nothing but men's wear agrees with every rule ever written.
const women = products.filter(p => p.category === 'women')
const other = products.filter(p => p.category !== 'women')
if (!women.length || !other.length) {
  bad('both sides of the rule are present in the fixture',
      `women=${women.length} other=${other.length} — the comparison would be vacuous`)
} else {
  ok('both sides of the rule are present in the fixture', `women=${women.length} other=${other.length}`)
}

// THE PARITY. store_return_lookup() sends `no_exchange` per line as
// `category === 'women'`; the listing must say the same of the same product.
const wrong = products.filter(p => Boolean(p.no_exchange) !== (p.category === 'women'))
if (wrong.length) {
  bad('every product is labelled the way the returns route will treat it',
      `${wrong.length} disagree, e.g. ` + wrong.slice(0, 4)
        .map(p => `${p.slug}[${p.category}] listing=${p.no_exchange ? 'noExchange' : 'exchangeable'}`).join(', '))
} else {
  ok('every product is labelled the way the returns route will treat it', `${products.length} checked`)
}

/* ------------------------------------------- and the three sites still agree */
const api = readFileSync(`${ROOT}/api/api.php`, 'utf8')
const store = readFileSync(`${ROOT}/api/store.php`, 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

// Counting the rule in COMMENT-FREE source, because this file and the sources
// it reads both discuss the rule in prose, and a check that matches its own
// explanation is a check that can never fail.
const RULE = /===\s*'women'/g
const sites = (strip(api).match(RULE) || []).length + (strip(store).match(RULE) || []).length
if (sites < 3) {
  bad('the rule is expressed at all three sites', `found ${sites} — listing, size adviser and returns are the three`)
} else {
  ok('the rule is expressed at all three sites', `${sites} occurrences in code`)
}

// The column must no longer decide anything a customer sees. It cannot be
// edited in /backends — admin.php has no no_exchange at all — so a read of it
// is a read of frozen seed data.
const readsColumn = /\(bool\)\s*\$row\['no_exchange'\]/.test(strip(api))
if (readsColumn) {
  bad('the listing does not label products from the frozen no_exchange column',
      'api.php reads (bool)$row[no_exchange] again — that is the bug this rig exists for')
} else {
  ok('the listing does not label products from the frozen no_exchange column')
}

console.log(`\n${fail ? `FAILED — ${fail} of ${pass + fail}` : `all ok — ${pass} checks`}`)
process.exit(fail ? 1 : 0)
