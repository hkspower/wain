/**
 * The site-wording editor, end to end, in a real browser.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/site-text-test.mjs
 *
 * WHAT IT HAS TO PROVE. The storefront's vocabulary is compiled into a bundle
 * this repository has no source for, so the only way to change a word is to
 * swap it in the DOM after the page has rendered. Three things make that
 * either work or quietly not:
 *
 *   THE SWAP HAPPENS AT ALL. The catalogue is extracted from the bundle file
 *   statically, so the "original" a swap matches on is a string read at
 *   tooling time and used at run time. If those drift by one character it
 *   matches nothing — and matching nothing looks exactly like a shop that has
 *   not been edited yet.
 *
 *   IT SURVIVES THE LANGUAGE TOGGLE. This is the one that breaks naive
 *   implementations. Pressing AR/EN does not reload: the bundle re-renders
 *   every string straight from its own dictionary, wiping any DOM edit. So
 *   this rig presses the REAL control rather than navigating to ?lang=, which
 *   would reload and prove nothing about the case that actually fails.
 *
 *   IT LEAVES THE PANEL ALONE. /backends is where these words are edited, and
 *   an editor whose own labels have been rewritten by the edit under way is
 *   one you cannot read.
 *
 * THE STRING UNDER TEST IS DISCOVERED, NOT NAMED. A hard-coded key is a
 * fixture that rots: the bundle decides what is on the home page, and a rig
 * asserting about a string that has moved to another page passes by testing
 * nothing. This finds a catalogue entry that is visibly on the page in BOTH
 * languages, and fails if it cannot — because "no suitable string" and "the
 * swap is broken" must not produce the same green line.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const CATALOGUE = 'sporta-site/public_html/assets/site-strings.json'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ` — ${extra}` : ''}`)
}
const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '--default-character-set=utf8mb4', '-e', q],
    { encoding: 'utf8' }).trim()

const clear = () => sql(`delete from settings where name = 'site_text'`)
const setRow = (obj) => {
  // Through a file rather than an -e string: these values are Arabic, carry
  // quotes, and would need escaping twice over on the way through a shell.
  writeFileSync('/tmp/site-text-rig.json', JSON.stringify(obj))
  sql(`insert into settings (name, value) values ('site_text', load_file('/tmp/site-text-rig.json'))
       on duplicate key update value = values(value)`)
}

/**
 * The home page, in a language this rig is sure of.
 *
 * `?lang=` IS NOT ENOUGH, and finding that out cost a failing check that was
 * about the test rather than the code. The bundle picks its language as
 * `localStorage.lang` first and the query parameter second — so once this rig
 * presses the AR toggle, localStorage says `ar` and every later `?lang=en`
 * navigation is still Arabic. The English string it then went looking for was
 * correctly absent, and the rig called that a failed swap.
 *
 * Setting the key explicitly rather than removing it: removing falls back to
 * the shop's default, which is Arabic, so half the checks would still be
 * asking the wrong page.
 */
const open = async (page, lang) => {
  await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate((l) => { try { localStorage.setItem('lang', l) } catch { /* private mode */ } }, lang)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
}

/** Every trimmed text node on the page — what a reader can actually see. */
const visible = (page) => page.evaluate(() => {
  const out = new Set()
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
  let n
  while ((n = w.nextNode())) {
    const t = (n.nodeValue || '').trim()
    if (t) out.add(t)
  }
  return [...out]
})

/** Put a node carrying `text` on the page and report whether it was swapped.
 *  This is what makes the /backends assertion mean something: the string under
 *  test need not appear there naturally, and a check that cannot fail is not a
 *  check. */
const injectAndSee = async (page, text) => {
  await page.evaluate((t) => {
    const d = document.createElement('div')
    d.id = 'rig-injected'
    d.textContent = t
    document.body.appendChild(d)
  }, text)
  await page.waitForTimeout(700)
  return page.evaluate(() => {
    const d = document.getElementById('rig-injected')
    const seen = d ? d.textContent : null
    if (d) d.remove()
    return seen
  })
}

const NEW_EN = 'RIG WORDING EN'
const NEW_AR = 'صياغة الاختبار'

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8')).strings
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

try {
  clear()

  // ---- 0. find a string that is genuinely on the page, in both languages ---
  await open(page, 'en')
  const seenEn = new Set(await visible(page))

  await open(page, 'ar')
  const seenAr = new Set(await visible(page))

  const usable = Object.keys(catalogue).filter((k) => {
    const s = catalogue[k]
    return !s.fixed && seenEn.has(s.en) && seenAr.has(s.ar)
  })

  console.log(`--- ${seenEn.size} English and ${seenAr.size} Arabic strings on the home page`)
  check(usable.length > 0,
    `the catalogue and the page agree on at least one string (${usable.length} found)`,
    'nothing the catalogue lists is visible on the page — the extraction has drifted from the bundle')
  if (!usable.length) throw new Error('no testable string')

  const key = usable.sort()[0]
  const orig = catalogue[key]
  console.log(`    testing on ${key}   en="${orig.en}"  ar="${orig.ar}"\n`)

  // ---- 1. nothing saved: the shop says what it was built to say ------------
  check(seenEn.has(orig.en), `before: the shop says "${orig.en}"`)
  check(seenAr.has(orig.ar), `before: and "${orig.ar}"`)

  // ---- 2. an override reaches the page, in English ------------------------
  setRow({ [key]: { en: [orig.en, NEW_EN], ar: [orig.ar, NEW_AR] } })

  await open(page, 'en')
  let now = new Set(await visible(page))
  check(now.has(NEW_EN), `the English rewrite is on the page ("${NEW_EN}")`)
  check(!now.has(orig.en), `and the built wording is gone ("${orig.en}")`)

  // ---- 3. AND IT SURVIVES THE LANGUAGE TOGGLE -----------------------------
  // The real control, not a reload. Pressing it re-renders every string from
  // the bundle's dictionary, which is precisely what a one-shot swap loses to.
  const toggle = page.locator('button[aria-label="Switch language"]').first()
  check((await toggle.count()) === 1, 'the language control is on the page')
  await toggle.click()
  await page.waitForTimeout(1800)
  now = new Set(await visible(page))
  check((await page.evaluate(() => document.documentElement.lang)) === 'ar',
    'pressing it switched the shop to Arabic')
  check(now.has(NEW_AR), `the Arabic rewrite survived the switch ("${NEW_AR}")`,
    'the swap was applied once at load and lost on re-render')
  check(!now.has(orig.ar), `and the built Arabic wording is gone ("${orig.ar}")`)

  // ---- 4. a node added AFTER load is swapped too ---------------------------
  // The shop is a single-page app; most of what a shopper reads arrives after
  // the first paint. Injecting proves the observer is live rather than that
  // one pass happened to catch everything.
  await open(page, 'en')
  check(await injectAndSee(page, orig.en) === NEW_EN,
    'text that arrives after the first paint is swapped as well')

  // ---- 5. the panel is left alone -----------------------------------------
  await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  check(await injectAndSee(page, orig.en) === orig.en,
    'the same text on /backends is NOT swapped',
    'the panel is where these words are edited — it must show what the shop really says')

  // ---- 6. clearing is the way back ----------------------------------------
  clear()
  await open(page, 'en')
  now = new Set(await visible(page))
  check(now.has(orig.en), `cleared: the built wording is back ("${orig.en}")`)
  check(!now.has(NEW_EN), 'and the rewrite is gone')

  // ---- 7. the panel: search for a line, rewrite it, save -------------------
  // The half the owner actually touches. Everything above proves the shop
  // obeys a row in the database; this proves the card can put one there.
  clear()
  await page.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.locator('input').nth(0).fill(process.env.ADMIN_EMAIL ?? 'manager@sporta.com.kw')
  await page.locator('input').nth(1).fill(process.env.ADMIN_PASSWORD ?? 'correct horse')
  await page.getByRole('button').filter({ hasText: /Sign in/ }).last().click()
  await page.waitForTimeout(3000)
  await page.getByText('Settings', { exact: true }).first().click()
  await page.waitForTimeout(2500)

  check((await page.locator('.stx').count()) === 1, 'the wording card is on the Settings screen')

  // NOTHING LISTED UNTIL ASKED. Four hundred rows is not a list anyone reads,
  // and this screen has a prose cap it has already been trimmed for twice.
  check((await page.locator('.stx-row').count()) === 0, 'and it lists nothing until it is searched')

  await page.locator('.stx-search').fill(key)
  await page.waitForTimeout(600)
  const row = page.locator('.stx-row').filter({ has: page.locator('.stx-key', { hasText: key }) }).first()
  check((await row.count()) === 1, `searching for "${key}" finds it`)

  const enBox = row.locator('.stx-in').first()
  check(await enBox.inputValue() === orig.en,
    'the box starts at what the shop says today', await enBox.inputValue())

  const PANEL_EN = 'RIG PANEL WORDING'
  await enBox.fill(PANEL_EN)

  // A SEARCH MUST NOT EAT AN EDIT. The rows are rebuilt on every keystroke in
  // the search box, so anything typed into them has to live outside the DOM —
  // two cards in this directory shipped the version of this that loses the
  // owner's work, and here the list changes far more often than a refusal.
  await page.locator('.stx-search').fill('zzz-nothing-matches')
  await page.waitForTimeout(400)
  await page.locator('.stx-search').fill(key)
  await page.waitForTimeout(600)
  check(await page.locator('.stx-row .stx-in').first().inputValue() === PANEL_EN,
    'searching away and back keeps what was typed',
    'the rows were rebuilt from the catalogue and the edit was lost')

  await page.locator('.stx-save').click()
  await page.waitForTimeout(2000)

  const stored = sql(`select value from settings where name = 'site_text'`)
  check(stored.includes(PANEL_EN) && stored.includes(key),
    'saving writes the rewrite to the shop',
    stored ? stored.slice(0, 120) : '(no row)')
  // The original travels with it: the storefront has no way to read the
  // bundle's dictionary, so the text to match on can only come from here.
  check(stored.includes(orig.en),
    'and stores the original beside it, which is what the shop matches on')

  console.log(
    fails === 0
      ? '\nall ok — the owner’s wording reaches the shop, in both languages, and clearing puts it back'
      : `\n${fails} failed`,
  )
} finally {
  clear()
  await browser.close()
}

process.exit(fails === 0 ? 0 : 1)
