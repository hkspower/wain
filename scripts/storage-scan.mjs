/**
 * Everywhere the shop keeps something — the customer's device, and its own
 * database and disk.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/storage-scan.mjs
 *
 * Nothing else here asks this question. The rigs check what the shop SHOWS and
 * what it REFUSES; none of them opens the box afterwards and reads what was
 * left behind. Two kinds of thing hide there:
 *
 *   WHAT IS KEPT ON SOMEONE ELSE'S PHONE. localStorage has no expiry. Anything
 *   written to it stays until the customer clears their browser, on a device
 *   that may be shared, and the shop's privacy policy makes specific promises
 *   about which of it is opt-in.
 *
 *   WHAT GROWS FOR EVER ON THE SERVER. Five outbox tables keep their sent rows
 *   deliberately, photographs are base64 inside MySQL, and the two payment logs
 *   are opened with FILE_APPEND and never rotated. None of that is wrong; all
 *   of it has a ceiling worth knowing before it is met on shared hosting.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'

const SITE = process.env.SITE ?? 'http://127.0.0.1:4300'
const APP = process.env.APP ?? 'http://127.0.0.1:4173'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
}
const note = (what) => console.log(`--   ${what}`)

/** What a name, a phone, an email or a Kuwaiti address looks like in a blob. */
const PERSONAL = [
  [/"name"\s*:\s*"[^"]{2,}"/, 'a name'],
  [/"phone"\s*:\s*"[^"]{6,}"/, 'a phone number'],
  [/"email"\s*:\s*"[^"]*@[^"]+"/, 'an email address'],
  [/"(block|street|building|flat|floor|area|governorate)"\s*:\s*"[^"]{1,}"/, 'part of an address'],
]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

// ====================================================== the customer's device
console.log('--- what is left on the customer\'s device')

for (const [label, base, routes] of [
  ['website', SITE, ['/', '/shop', '/product/cloudsoft-jacket-army-green', '/cart', '/checkout', '/returns/request']],
  ['app    ', APP, ['/', '/shop', '/cart', '/account', '/exchange']],
]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const p = await ctx.newPage()
  try {
    for (const r of routes) {
      await p.goto(base + r, { waitUntil: 'networkidle', timeout: 25000 })
      await p.waitForTimeout(700)
    }
  } catch (e) {
    check(false, `${label} could be walked`, String(e).slice(0, 70))
    await ctx.close()
    continue
  }

  const store = await p.evaluate(async () => ({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
    dbs: (await (indexedDB.databases?.() ?? Promise.resolve([]))).map((d) => d.name),
    caches: 'caches' in window ? await caches.keys() : [],
    workers: navigator.serviceWorker
      ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  }))
  const cookies = await ctx.cookies()

  note(`${label}: ${Object.keys(store.local).length} localStorage keys, ` +
       `${Object.keys(store.session).length} sessionStorage, ${cookies.length} cookies, ` +
       `${store.dbs.length} indexedDB, ${store.caches.length} caches, ${store.workers} service workers`)
  for (const [k, v] of Object.entries(store.local)) note(`    local   ${k} (${v.length} chars)`)
  for (const [k, v] of Object.entries(store.session)) note(`    session ${k} (${v.length} chars)`)

  // NOTHING PERMANENT MAY HOLD A CUSTOMER'S DETAILS. A basket of slugs is
  // fine; a name, a phone and a street are not the same thing, and
  // localStorage does not expire.
  for (const [k, v] of Object.entries(store.local)) {
    const found = PERSONAL.filter(([re]) => re.test(v)).map(([, what]) => what)
    check(found.length === 0,
      `${label}: localStorage ${k} holds nothing personal`,
      `it holds ${found.join(' and ')}`)
  }

  // A COOKIE THAT CARRIES A SESSION must be unreadable by script and must not
  // travel cross-site. Secure cannot be asserted against a sandbox with no
  // TLS — the server sets it from the request's own scheme — so it is noted.
  for (const c of cookies) {
    check(c.httpOnly && c.sameSite === 'Strict',
      `${label}: cookie ${c.name} is httpOnly and SameSite=Strict`,
      `httpOnly=${c.httpOnly} sameSite=${c.sameSite}`)
    if (!c.secure) note(`    ${c.name} is not Secure — expected over plain http; the server sets it from the scheme`)
  }
  await ctx.close()
}

// ---------------------------- the address kept on the device, and the promise
//
// TWO HALVES OF ONE QUESTION, so they are one check.
//
// The bundle writes `sporta.delivery` to localStorage — name, phone, email and
// the full address — and localStorage has no expiry, so it stays on that phone
// until the browser is cleared. That is a perfectly ordinary convenience and
// most shops do it. What makes it a fault or not is whether the customer was
// asked.
//
// The privacy page says, in both languages, that the address is kept "if you
// tick remember my address at checkout". The build has no such tick box — the
// phrase appears only in the privacy prose — and the flag it would set defaults
// to ON: the code reads `!== '0'`, so the address is remembered unless
// something opts out, and nothing can.
//
// So the check is conditional, which is the only honest shape for it: a
// permanent key holding an address is fine WHEN a control exists, and it
// passes the moment either the checkbox is added or the policy stops
// describing one. Failing the storage on its own would be wrong the day the
// owner adds the control.
//
// THE KEY IS READ FROM THE BUNDLE, not from whatever this walk happened to
// leave behind. A walk that never types an address never writes the
// interesting key, and the first version of this file passed on five harmless
// keys while never once producing `sporta.delivery`.
{
  const { readFileSync, readdirSync } = await import('node:fs')
  const dir = 'sporta-site/public_html/assets'
  const keys = new Map()
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.js')) continue
    const src = readFileSync(`${dir}/${f}`, 'utf8')
    // `X=\`sporta.delivery\`` then `localStorage.getItem(X)` — the key is a
    // literal assigned to a minified name, so the two are paired up.
    for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*[`'"](sporta[._][\w.-]{2,40})[`'"]/g)) {
      const [, varName, key] = m
      if (new RegExp(`localStorage\\.(set|get|remove)Item\\(${varName}\\b`).test(src)) keys.set(key, f)
    }
  }
  note(`the bundle writes ${keys.size} localStorage keys: ${[...keys.keys()].join(', ')}`)
  const addressy = [...keys.keys()]
    .filter((k) => /delivery|address|customer|contact/i.test(k) && !/draft|remember/.test(k))

  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const p = await ctx.newPage()
  let promises = false, offers = false
  try {
    await p.goto(`${SITE}/privacy`, { waitUntil: 'networkidle', timeout: 25000 })
    await p.waitForTimeout(1200)
    promises = await p.evaluate(() =>
      /تذكّر عنواني|تذكر عنواني|remember my address/i.test(document.body.innerText))
    await p.goto(`${SITE}/checkout`, { waitUntil: 'networkidle', timeout: 25000 })
    await p.waitForTimeout(1500)
    offers = await p.evaluate(() =>
      [...document.querySelectorAll('input[type=checkbox], [role="checkbox"], [role="switch"]')]
        .some((e) => /تذكّر|تذكر|remember|احفظ|save/i.test(
          e.closest('label')?.textContent || e.getAttribute('aria-label') ||
          e.parentElement?.textContent || '')))
  } catch (e) {
    note(`the checkout and privacy pages could not be read — ${String(e).slice(0, 60)}`)
    await ctx.close()
  }
  if (!p.isClosed()) await ctx.close()

  note(`the privacy page ${promises ? 'promises' : 'does not mention'} a "remember my address" choice; ` +
       `the checkout ${offers ? 'offers one' : 'offers none'}`)
  check(addressy.length === 0 || offers,
    'an address is only kept on the device if the customer was given the choice',
    `${addressy.join(', ')} is written to localStorage, which never expires, and the checkout offers no control` +
    (promises ? ' — while the privacy page tells the customer it is kept only if they tick a box' : ''))
}

// ================================================================ the server
console.log('\n--- what the shop keeps of its own')

const sql = (q) => {
  try {
    return execFileSync('mariadb',
      ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '-e', q],
      { encoding: 'utf8' })
  } catch { return '' }
}
const rows = (q) => {
  const out = sql(q).trim().split('\n')
  if (out.length < 2) return []
  const head = out[0].split('\t')
  return out.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v])))
}

const tables = rows(`select table_name as t, table_rows as n,
    round((data_length+index_length)/1024/1024, 2) as mb
  from information_schema.tables where table_schema='sporta'
  order by (data_length+index_length) desc`)
if (!tables.length) note('the sandbox database could not be read — server half skipped')
else {
  const total = tables.reduce((s, r) => s + Number(r.mb || 0), 0)
  note(`${tables.length} tables, ${total.toFixed(1)} MB in total`)
  for (const r of tables.slice(0, 8)) note(`    ${String(r.t).padEnd(24)} ${String(r.n).padStart(7)} rows  ${r.mb} MB`)

  // THE TABLES THAT ONLY GROW. Every one of these is deliberate — an outbox
  // row is the record that the warehouse was told — but they hold customer
  // contact details and nothing ever deletes them, so the shop should know
  // they are there before a hosting quota tells it.
  const forever = ['fulfilment_outbox', 'customer_mail_outbox', 'whatsapp_outbox',
                   'push_outbox', 'assistant_outbox', 'size_advice_log', 'reviews']
  const present = tables.filter((r) => forever.includes(r.t))
  note(`kept for ever, by design: ${present.map((r) => `${r.t} (${r.n} rows)`).join(', ')}`)

  // PHOTOGRAPHS LIVE IN MYSQL, base64 in a longtext. The cap is 900 kB of
  // base64 per photograph and 24 photographs per product, so 46 products can
  // legitimately ask for about a gigabyte of database. Worth knowing on shared
  // hosting, where the database quota is usually the smaller one.
  const imgs = rows(`select count(*) as n, round(coalesce(sum(length(image)),0)/1024/1024, 2) as mb
                     from product_images`)[0]
  const products = Number(rows('select count(*) as n from products')[0]?.n ?? 0)
  if (imgs) {
    note(`product photographs: ${imgs.n} stored, ${imgs.mb} MB of base64 inside MySQL`)
    note(`    the ceiling as configured: ${products} products x 24 photos x 900 kB = ` +
         `${((products * 24 * 900000) / 1024 / 1024 / 1024).toFixed(1)} GB`)
  }
}

// ------------------------------------------------------------ the disk files
//
// The payment logs are opened with FILE_APPEND and nothing rotates them. What
// matters most is not their size but their PLACE: config.example.php puts them
// two levels above public_html, outside anything Apache serves. A payment log
// inside the docroot would be every track id and amount on a public URL.
for (const [name, rel] of [['CBK T-Pay', 'cbk-payments.log'], ['KNET', 'knet-payments.log']]) {
  const inRoot = `sporta-site/public_html/${rel}`
  check(!existsSync(inRoot), `the ${name} log is not inside the docroot`, `${inRoot} exists and Apache would serve it`)
  const outside = `sporta-site/${rel}`
  if (existsSync(outside)) {
    note(`${name} log: ${(statSync(outside).size / 1024).toFixed(1)} kB, appended to and never rotated`)
  }
}

// And neither may be fetchable, whatever the configuration says.
for (const rel of ['cbk-payments.log', 'knet-payments.log', 'api/config.php']) {
  try {
    const r = await fetch(`${SITE}/${rel}`, { redirect: 'manual' })
    // The sandbox's built-in server reads no .htaccess and answers the SPA for
    // an unknown path, so a 200 here is only damning if it is really the file.
    const body = await r.text().catch(() => '')
    const leaked = /db_pass|trackid=|resource_key|client_secret/i.test(body)
    check(!leaked, `/${rel} does not serve its contents (${r.status})`)
  } catch { note(`/${rel} could not be fetched`) }
}

console.log(fails
  ? `\n${fails} to answer for`
  : '\nall ok — nothing personal kept permanently, nothing servable that should not be')
process.exit(fails ? 1 : 0)
