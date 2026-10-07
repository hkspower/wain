/**
 * Number keyboards on number-only fields — and the digits they type arriving as digits.
 *
 *   bash scripts/sandbox.sh && node scripts/numeric-keyboard-test.mjs
 *
 * WHAT IT HOLDS. Every field whose value can only be digits (a phone, a code, a stock
 * count, a sort order) or a number (a price, a rate) opens a phone's number pad
 * (inputmode numeric / decimal / tel), and what an ARABIC phone's pad types there —
 * ٠-٩, the Persian ۰-۹, ٫ for the decimal point — reaches the form as 0-9 and ".".
 * A headless browser draws no keyboard, so it asserts the attribute that decides
 * which keyboard appears, and then the behaviour: the box shows ASCII and the
 * request the page SENDS carries ASCII. A number pad that types digits the form
 * then throws away is worse than no number pad, which is why the second half exists.
 *
 *   A  attribute matrix: every planned field, on a phone, in both languages
 *   B  digits accepted: typed with the keyboard, read from the box AND the request body
 *   C  an IME composition ends as "45" — not "" and not "445"
 *   D  negatives: letter fields (order references, names, codes, hex, IDs) get no
 *      number pad, a SWEEP of every visited screen fails on any number pad that is not
 *      in the plan, and a name box keeps the Arabic digits typed into it
 *
 * Fields are found with THIS RIG'S OWN classifier (ids, placeholders, structure) —
 * never with keyboard-hints.js's selectors, or a rule and its test would share a
 * mistake. Each group asserts it was FOUND, and a fixed count where the count is
 * fixed, before anything is asserted about it: a check that finds nothing passes.
 *
 * NOTHING IS WRITTEN. A route on every context answers every non-GET with a mock or
 * aborts it, and records its body; the one request let through is ONE real admin
 * sign-in, whose cookies every panel context reuses. Any other non-GET reaching the
 * network fails the run. The sign-in's own admin_login_log row is deleted at the end
 * (only rows above the starting id carrying this rig's user agent). Bank, sale,
 * stock, slide and settings saves are all aborted after their body is read — so the
 * shared sandbox (another rig may be measuring the hero) is never changed.
 * An unnamed 429/503 makes the run INCONCLUSIVE (exit 2): a throttled request is not
 * an answer.
 *
 * MUTATIONS (MUTATE=<name>, served through page.route, each must fail by name):
 *   no-hints        keyboard-hints.js blocked: Persian adviser digits, login_code,
 *                   price 9500, brand Order, drawer attributes … fail
 *   no-number-rule  type=number rule removed: brand, featured and sale attributes fail
 *   no-drawer       drawer rule removed: drawer attributes fail
 *   compose-eager   normalise DURING an IME composition: C fails with 445
 *   card-clean      card.js converts nothing: the /card request check fails
 *   wide-drawer     drawer rule gives every Customer box a number pad: Street fails
 *   fixture-label   the rig's own drawer label renamed: the FOUND check fails
 *
 * Recorded 2026-10-03 (unmutated: 608 checks, all ok, 57 field groups per language):
 *   no-hints        77 failed. Among them, exactly the bugs this exists for: price
 *                   ٩٫٥٠٠ SENT as 9500; brand Order SENT as sort 0; featured Order SENT
 *                   0; Put on sale SENT sale_price "" (clears the sale); the AED rate
 *                   SENT as "٠٫٠٨١٧"; the drawer SENT the phone in Arabic digits;
 *                   size_advice SENT height_cm "" for Persian ۱۷۵; login_code never
 *                   sent; composition "" on both boxes. /card, /returns/request, the
 *                   keypad, inventory and payments still passed their SENT checks —
 *                   they convert where they read, as designed.
 *   no-number-rule  8 failed (ONLY=brands,promotions): brand/featured/sale attributes
 *   no-drawer       10 failed (ONLY=drawer): the four drawer attributes, and the body
 *   compose-eager   4 failed (ONLY=signin-code,discounts): "445" on both boxes
 *   card-clean      4 failed (ONLY=card): nothing sent at all (refused as invalid_phone)
 *   wide-drawer     6 failed (ONLY=drawer): Street, House / Building, and the sweep
 *   fixture-label   4 failed (ONLY=drawer): found drawer.phone (0 of 1), and the sweep
 */
import { execFileSync } from 'node:child_process'
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EXE = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const MUT = process.env.MUTATE ?? ''
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean)
const RIG_UA = 'Mozilla/5.0 (X11; Linux x86_64) numkb-rig'
const ORIGIN = new URL(BASE).origin

let fails = 0
const throttled = []
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && detail ? '   ' + detail : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '--skip-column-names', '-e', q], { encoding: 'utf8' }).trim()
const want = (name) => !ONLY.length || ONLY.includes(name)
// Every field group the plan names, per language: 18 storefront, 3 signed-out panel,
// 36 signed-in panel. A run that checks fewer has had a screen silently not open.
const PLANNED_GROUPS = 57
const PANEL_SECTIONS = ['security', 'settings', 'payments', 'inventory', 'catalogue', 'discounts', 'brands', 'promotions', 'accounting', 'drawer', 'size-charts']

// The two digit sets an Arabic phone types. dig('9.5', AR) -> '٩٫٥'
const AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹'
const dig = (ascii, set) => ascii.replace(/[0-9]/g, (d) => set[+d]).replace(/\./g, '٫')
const setName = (set) => (set === AR ? 'Arabic' : 'Persian')

/* ------------------------------------------------------------- mutations -- */
const TRANSFORMS = {
  'no-number-rule': ['/assets/keyboard-hints.js', (s) => s.replace(/\n\s*if \(e\.type === 'number'\) \{ put\(e, 'inputmode'[^\n]*/, '\n')],
  'no-drawer': ['/assets/keyboard-hints.js', (s) => s.replace('if (panel) drawer()', 'if (false) drawer()')],
  'compose-eager': ['/assets/keyboard-hints.js', (s) => s.replace('if (e.isComposing) {', 'if (e.isComposing) { fix(el); return;')],
  'wide-drawer': ['/assets/keyboard-hints.js', (s) => s.replace("if (Object.prototype.hasOwnProperty.call(DRAWER, key)) put(inp, 'inputmode', DRAWER[key])", "put(inp, 'inputmode', Object.prototype.hasOwnProperty.call(DRAWER, key) ? DRAWER[key] : 'numeric')")],
  'card-clean': ['/assets/card.js', (s) => s.replace("phone: west($('phone').value)", "phone: ($('phone').value)")],
}
if (MUT && !TRANSFORMS[MUT] && !['no-hints', 'fixture-label'].includes(MUT)) { console.log(`FAIL unknown MUTATE=${MUT}`); process.exit(1) }
const DRAWER_LABEL_PHONE = MUT === 'fixture-label' ? 'Phone number' : 'Phone'

/* ------------------------------------------------------------- the guard -- */
// Every context gets this. GETs pass (or are answered by a read mock); every other
// method is recorded and answered by a mock or aborted. ONE real sign-in is let through.
let continuedWrites = 0
function routeOf(url) { try { return new URL(url).searchParams.get('r') || '' } catch { return '' } }
async function guard(ctx, { mocks = {}, reads = {}, allowLogin = false } = {}) {
  const sent = []
  ctx.setDefaultTimeout(9000)
  await ctx.route('**/*', async (rt) => {
    const req = rt.request()
    const url = req.url()
    let u
    try { u = new URL(url) } catch { return rt.continue() }
    const r = u.searchParams.get('r') || ''
    if (req.method() === 'GET' || req.method() === 'HEAD') {
      if (u.origin === ORIGIN) {
        if (MUT === 'no-hints' && u.pathname === '/assets/keyboard-hints.js') return rt.abort()
        const tr = TRANSFORMS[MUT]
        if (tr && u.pathname === tr[0]) {
          const res = await rt.fetch()
          const src = await res.text()
          const out = tr[1](src)
          if (out === src) { console.log(`FAIL MUTATE=${MUT} matched nothing in ${tr[0]} — the mutation would test nothing`); process.exit(1) }
          return rt.fulfill({ response: res, body: out })
        }
        if (reads[r] && /\/api\//.test(u.pathname)) return reads[r](rt, u)
      }
      return rt.continue()
    }
    let body = null
    const raw = req.postData()
    try { body = JSON.parse(raw ?? 'null') } catch { body = raw }
    sent.push({ r, path: u.pathname, body })
    if (allowLogin && u.origin === ORIGIN && r === 'login' && u.pathname === '/api/admin.php') { continuedWrites++; return rt.continue() }
    if (mocks[r]) return mocks[r](rt, body)
    // Refused with a JSON error rather than a network abort, so a screen that disables
    // its button while saving gets it back (an aborted fetch leaves it disabled for ever).
    if (u.origin === ORIGIN && /\/api\//.test(u.pathname)) return rt.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"rig_not_written"}' })
    return rt.abort()
  })
  ctx.on('response', async (res) => {
    const s = res.status()
    if ((s !== 429 && s !== 503) || !res.url().startsWith(ORIGIN + '/api/')) return
    let err = null
    try { err = (await res.json())?.error ?? null } catch { /* not json */ }
    // The limiter refuses without naming an application error (or as too_many_attempts);
    // a feature refusing itself says which feature, and that is an answer.
    if (!err || err === 'too_many_attempts' || err === 'too_many_requests') throttled.push(`${s} ${res.url().replace(ORIGIN, '')}`)
  })
  return sent
}
const json = (obj, status = 200) => (rt) => rt.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) })
const since = (sent) => sent.length
async function waitSent(page, sent, r, from, ms = 4000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const hit = sent.slice(from).filter((x) => x.r === r)
    if (hit.length) return hit[hit.length - 1].body
    await page.waitForTimeout(100)
  }
  return null
}

/* --------------------------------------------------------- the classifier -- */
// Runs in the page. Names each visible input by STRUCTURE the rig chose for itself.
const CLASSIFY = (drawerPhoneLabel) => {
  const NUMKB = (e) => e.type === 'number' || e.type === 'tel' || ['numeric', 'decimal', 'tel'].includes((e.getAttribute('inputmode') || '').toLowerCase())
  const vis = (e) => { if (!e.getClientRects().length) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' }
  const t = (n) => (n ? n.textContent : '').replace(/\s+/g, ' ').trim()
  const ph = (e) => e.getAttribute('placeholder') || ''
  const lab = (e) => t(e.closest('label'))
  const path = location.pathname
  const key = (e) => {
    const id = e.id
    // ---- storefront
    const ids = { 'f-phone': 'checkout.phone', 'f-block': 'checkout.block', 'f-floor': 'checkout.floor', 'f-flat': 'checkout.flat',
      'f-street': 'checkout.street', 'f-building': 'checkout.building', 'f-name': 'checkout.name', 'f-email': 'checkout.email',
      'cua-phone': 'account.phone', 'cua-name': 'account.name', 'cua-email': 'account.email' }
    if (ids[id]) return ids[id]
    if (path === '/checkout' && /كود الخصم|discount code/i.test(ph(e))) return 'checkout.coupon'
    if (e.closest('[role=dialog][aria-modal=true]') && ['175', '75', '100', '88'].includes(ph(e))) return 'adviser'
    if ((path === '/card' || path === '/returns/request') && id === 'phone') return 'flat.phone'
    if ((path === '/card' || path === '/returns/request') && id === 'track') return 'flat.track'
    if (path === '/track' && /SP1A2B3C/.test(ph(e))) return 'track.ref'
    if (path === '/returns' && /SP1A2B3C/.test(ph(e))) return 'returns.ref'
    if (path === '/returns' && /9XXXXXXX/.test(ph(e))) return 'returns.phone'
    // ---- panel, signed out
    if (e.closest('[data-sporta-pass-pad]')) return 'signin.pad'
    if (e.closest('[data-sporta-reset]') && e.getAttribute('autocomplete') === 'one-time-code') return 'reset.code'
    if (!e.closest('.admin-content') && e.getAttribute('autocomplete') === 'one-time-code') return 'signin.code'
    // ---- panel, our overlays
    if (e.closest('[data-sporta-pass-card]') && e.type === 'password') return 'sec.pin'
    if (e.closest('.admin-content') && ph(e) === '000000') return 'sec.code'
    if (e.closest('.admin-content') && e.type === 'tel' && /^Mobile number/.test(lab(e))) return 'sec.phone'
    const spc = e.closest('section[data-sporta-panel=contact] .spc-field')
    if (spc) { const l = t(spc.querySelector('.spc-label')); if (l === 'WhatsApp number') return 'contact.whatsapp'; if (l === 'Phone, as it should be printed') return 'contact.printed' }
    if (e.matches('input.srl-num[data-rule]')) return /_fils$/.test(e.dataset.rule) ? 'rules.money' : 'rules.count'
    const hf = e.closest('.hsl-edit label.hsl-field')
    if (hf && t(hf.querySelector('.hsl-label')) === 'Sort order') return 'slide.sort'
    if (e.matches('[data-spps] input.spps-in')) return [...document.querySelectorAll('[data-spps] input.spps-in')].indexOf(e) === 0 ? 'pay.codOpen' : 'pay.codMax'
    if (e.closest('[data-sporta-inventory]')) {
      if (e.getAttribute('aria-label') === 'Low-stock line') return 'inv.low'
      if (e.hasAttribute('data-sku')) return 'inv.cell'
    }
    if (e.closest('[data-sporta-panel=payment]')) return 'payment.cred'
    // ---- panel, the bundle
    const sec = e.closest('section')
    if (sec && t(sec.querySelector(':scope > h3')) === 'Customer' && e.parentElement && e.parentElement.tagName === 'LABEL') {
      const s = t(e.parentElement.querySelector(':scope > span'))
      const m = { Block: 'drawer.block', Floor: 'drawer.floor', Flat: 'drawer.flat', Street: 'drawer.street', 'House / Building': 'drawer.building' }
      m[drawerPhoneLabel] = 'drawer.phone'
      if (m[s]) return m[s]
    }
    // textContent runs the label into its hint: "OrderLower shows first."
    if (e.type === 'number' && /^Order(?![a-z])/.test(lab(e)) && !e.hasAttribute('step')) return 'brand.order'
    if (e.type === 'number' && e.getAttribute('step') === '1') return 'featured.order'
    if (e.type === 'number' && e.getAttribute('step') === '0.001') return 'sale.price'
    const tb = e.closest('table')
    const head = tb ? t(tb.querySelector('thead')) : ''
    if (/Chest/.test(head) && /Waist/.test(head)) return 'size.cell'
    if (/Debit/i.test(head) && /Credit/i.test(head)) return 'acc.line'
    if (/AED → KWD rate/.test(lab(e))) return 'acc.rate'
    if (ph(e) === '6600') return 'acc.code'
    if (ph(e) === 'SAVE10') return 'disc.code'
    if (/^Percent/.test(lab(e))) return 'disc.percent'
    if (/^Times it may be used/.test(lab(e))) return 'disc.times'
    if (/^Minimum order/.test(lab(e))) return 'disc.min'
    if (/^Price \(KWD\)/.test(lab(e))) return 'product.price'
    if (/^Stock for /.test(e.getAttribute('aria-label') || '') || /^Stock$/.test(lab(e))) return 'stock.row'
    if (/^Cost \(AED/.test(lab(e))) return 'cost.aed'
    if (/apps\.googleusercontent\.com/.test(ph(e))) return 'google.client'
    if (ph(e) === 'com.sporta.web.signin') return 'apple.services'
    if (/^#[0-9a-f]{3,6}$/i.test(e.value || ph(e)) && e.getAttribute('maxlength') === '7') return 'hex'
    if (e.type === 'search') return 'search'
    return null
  }
  const out = []
  for (const e of document.querySelectorAll('input')) {
    if (['hidden', 'checkbox', 'radio', 'file', 'range', 'color', 'submit', 'button', 'date', 'datetime-local', 'time', 'month', 'week', 'image', 'reset'].includes(e.type)) continue
    if (!vis(e)) continue
    out.push({ k: key(e), type: e.type, im: e.getAttribute('inputmode'), ac: e.getAttribute('autocomplete'), num: NUMKB(e),
      name: (ph(e) || e.getAttribute('aria-label') || lab(e) || e.id || e.name || '?').slice(0, 60) })
  }
  return out
}

// key -> [inputmode, type, autocomplete (undefined = not checked, null = absent)]
const NUMERIC = {
  'checkout.phone': ['numeric', 'tel'], 'checkout.block': ['numeric', 'text'], 'checkout.floor': ['numeric', 'text'], 'checkout.flat': ['numeric', 'text'],
  adviser: ['numeric', 'text'], 'account.phone': ['numeric', 'tel'], 'flat.phone': ['numeric', 'tel'], 'returns.phone': ['tel', 'text', 'tel'],
  'signin.code': ['numeric', 'text'], 'signin.pad': ['numeric', 'password'], 'reset.code': ['numeric', 'text'],
  'sec.code': ['numeric', 'text'], 'sec.pin': ['numeric', 'password'], 'sec.phone': ['tel', 'tel'],
  'contact.whatsapp': ['tel', 'text', 'off'],
  'rules.money': ['decimal', 'text'], 'rules.count': ['numeric', 'text'],
  'slide.sort': ['numeric', 'text'], 'pay.codOpen': ['numeric', 'text'], 'pay.codMax': ['decimal', 'text'],
  'inv.low': ['numeric', 'text'], 'inv.cell': ['numeric', 'text'], 'stock.row': ['numeric', 'text'],
  'drawer.phone': ['tel', 'text', null], 'drawer.block': ['numeric', 'text'], 'drawer.floor': ['numeric', 'text'], 'drawer.flat': ['numeric', 'text'],
  'brand.order': ['numeric', 'number'], 'featured.order': ['numeric', 'number'], 'sale.price': ['decimal', 'number'],
  'size.cell': ['numeric', 'text'], 'acc.rate': ['decimal', 'text'], 'acc.line': ['decimal', 'text'], 'acc.code': ['numeric', 'text'],
  'cost.aed': ['decimal', 'text'], 'disc.percent': ['numeric', 'text'], 'disc.times': ['numeric', 'text'], 'disc.min': ['decimal', 'text'], 'product.price': ['decimal', 'text'],
}
const LETTERS = new Set(['checkout.street', 'checkout.building', 'checkout.name', 'checkout.email', 'checkout.coupon', 'account.name', 'account.email',
  'flat.track', 'track.ref', 'returns.ref', 'contact.printed', 'drawer.street', 'drawer.building', 'disc.code', 'google.client', 'apple.services',
  'payment.cred', 'hex', 'search'])

const counted = {}   // lang -> Set of planned keys checked
/**
 * One screen: the planned number fields (key -> exact count, or '+' for at least one),
 * the planned letter fields (must be found, must have no number pad), and the sweep.
 */
async function screen(page, where, lang, numeric, letters = []) {
  const items = await page.evaluate(CLASSIFY, DRAWER_LABEL_PHONE)
  counted[lang] ??= new Set()
  for (const [k, n] of Object.entries(numeric)) {
    const found = items.filter((i) => i.k === k)
    const okCount = n === '+' ? found.length >= 1 : found.length === n
    check(okCount, `${where}: found ${k} (${found.length}${n === '+' ? '' : ' of ' + n})`)
    if (!found.length) continue
    counted[lang].add(k)
    const [im, type, ac] = NUMERIC[k]
    const bad = found.filter((f) => f.im !== im || f.type !== type || (ac !== undefined && f.ac !== ac))
    check(!bad.length, `${where}: ${k} -> inputmode=${im}, type=${type}${ac === undefined ? '' : ', autocomplete=' + ac}`,
      JSON.stringify(bad.map((b) => [b.name, b.im, b.type, b.ac])))
  }
  for (const k of letters) {
    const found = items.filter((i) => i.k === k)
    check(found.length >= 1, `${where}: found letter field ${k}`)
    if (!found.length) continue
    counted[lang].add(k)
    const bad = found.filter((f) => f.num)
    check(!bad.length, `${where}: ${k} gets NO number pad`, JSON.stringify(bad.map((b) => [b.name, b.im, b.type])))
  }
  // THE SWEEP. Every number pad on the screen must be one the plan put there.
  check(items.length > 0, `${where}: the sweep saw ${items.length} input(s)`)
  const stray = items.filter((i) => i.num && !NUMERIC[i.k])
  check(!stray.length, `${where}: sweep — no number pad outside the plan`, JSON.stringify(stray.map((s) => [s.k, s.name, s.im, s.type])))
}

/* ---------------------------------------------------------------- helpers -- */
async function ty(page, loc, text) {
  await loc.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await loc.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(text)
  await page.waitForTimeout(150)
  return loc.inputValue()
}
async function click(page, loc) { await loc.first().evaluate((b) => b.click()); await page.waitForTimeout(900) }
async function section(name, fn) {
  if (!want(name)) return
  console.log(`\n--- ${name}`)
  try { await fn() } catch (e) { check(false, `${name}: ran to the end`, e.message.split('\n')[0]) }
}

/* ------------------------------------------------------------------- run -- */
const alive = await fetch(`${BASE}/api/api.php?r=products`).then((r) => r.ok).catch(() => false)
if (!alive) { console.log(`FAIL the sandbox does not answer at ${BASE} — run: bash scripts/sandbox.sh`); process.exit(1) }

const startLog = Number(sql('select coalesce(max(id), 0) from admin_login_log'))
const br = await chromium.launch({ executablePath: EXE })
const STORE = [['iPhone 13', 'ar', AR], ['iPhone 13', 'en', FA], ['Pixel 7', 'ar', FA], ['Pixel 7', 'en', AR]]
const PANEL = [['iPhone 13', 'ar', AR], ['Pixel 7', 'en', FA]]
const q = (lang) => (lang === 'en' ? '?lang=en' : '')

// The panel follows the SHOP's language choice (localStorage 'lang', read by index.html's boot
// script). Asserted after every panel load: an earlier version wrote a key nothing reads, so both
// panel runs were Arabic while the summary claimed English too.
async function langIs(p, want) {
  const got = await p.evaluate(() => document.documentElement.lang)
  check(got === want, `panel page language is ${want}`, `document lang=${got}`)
}

async function phoneCtx(device, lang, extra = {}) {
  const ctx = await br.newContext({ ...devices[device], locale: lang === 'ar' ? 'ar-KW' : 'en-US', ...extra })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch { /* private */ } }, lang)
  return ctx
}

try {
  /* ============================================================ storefront */
  const stock = await (await fetch(`${BASE}/api/api.php?r=stock`)).json()
  const inStock = stock.find((r) => r.slug === 'vanquish-tank-navy' && r.in_stock && r.stock > 0) || stock.find((r) => r.in_stock && r.stock > 0)
  check(!!inStock, 'the stock read names an in-stock size to reach /checkout with', inStock ? `${inStock.slug} ${inStock.size}` : '')

  for (const [device, lang, set] of STORE) {
    const tag = `${device} ${lang} (${setName(set)} digits)`
    const ctx = await phoneCtx(device, lang)
    const sent = await guard(ctx, {
      mocks: { size_advice: json({ error: 'not_enough' }, 422), discount: json({ error: 'rig' }, 400) },
      reads: { balance: json({ error: 'order_not_found_for_phone' }, 404), return_items: json({ error: 'return_not_found' }, 404) },
    })
    const p = await ctx.newPage()

    await section('product', async () => {
      await p.goto(`${BASE}/product/${inStock.slug}${q(lang)}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
      await p.getByRole('button', { name: lang === 'ar' ? 'شنو مقاسي؟' : 'What is my size?' }).first().click(); await p.waitForTimeout(700)
      await screen(p, `${tag} size adviser`, lang, { adviser: 2 })
      const box = (ph) => p.locator(`[role=dialog][aria-modal=true] input[placeholder="${ph}"]`).first()
      const h = await ty(p, box('175'), dig('175', FA))
      check(h === '175', `${tag}: adviser height typed as Persian ۱۷۵ shows 175`, h)
      const w = await ty(p, box('75'), dig('75', AR))
      check(w === '75', `${tag}: adviser weight typed as Arabic ٧٥ shows 75`, w)
      const from = since(sent)
      await click(p, p.locator('[role=dialog] button').filter({ hasText: lang === 'ar' ? /^بيّن مقاسي$/ : /^Show my size$/ }))
      const body = await waitSent(p, sent, 'size_advice', from)
      check(body && Number(body.height_cm) === 175 && Number(body.weight_kg) === 75, `${tag}: size_advice is SENT height_cm 175, weight_kg 75`, JSON.stringify(body))
      await click(p, p.locator('[role=dialog] button').filter({ hasText: lang === 'ar' ? /^عندي متر قياس$/ : /^I have a tape measure$/ }))
      await screen(p, `${tag} size adviser, tape measure`, lang, { adviser: 3 })
      await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    })

    await section('checkout', async () => {
      if (!/\/product\//.test(p.url())) { await p.goto(`${BASE}/product/${inStock.slug}${q(lang)}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200) }
      await p.locator('button').filter({ hasText: new RegExp('^' + inStock.size + '$') }).first().click(); await p.waitForTimeout(300)
      await p.locator('button').filter({ hasText: lang === 'ar' ? /^اشترِ الآن$/ : /^Buy now$/ }).first().click(); await p.waitForTimeout(2200)
      check(/\/checkout/.test(p.url()), `${tag}: reached /checkout by Buy now`, p.url())
      if (await p.locator('[data-cf-more]').count()) { await click(p, p.locator('[data-cf-more]')) }
      await screen(p, `${tag} checkout`, lang,
        { 'checkout.phone': 1, 'checkout.block': 1, 'checkout.floor': 1, 'checkout.flat': 1 },
        ['checkout.street', 'checkout.building', 'checkout.name', 'checkout.email', 'checkout.coupon'])
      const ph = await ty(p, p.locator('#f-phone'), dig('98765432', set))
      await p.locator('#f-email').focus(); await p.waitForTimeout(300)
      const tick = await p.evaluate(() => { const l = document.querySelector('label[for="f-phone"]'); const m = l && l.parentElement.querySelector('[data-cf-msg]'); return m && !m.hidden ? m.textContent : '' })
      check(ph === '98765432' && tick === '✓', `${tag}: checkout phone typed in ${setName(set)} digits is 98765432 with the tick`, `${ph} ${tick}`)
      const bl = await ty(p, p.locator('#f-block'), dig('98', set))
      check(bl === '98', `${tag}: checkout block ${dig('98', set)} is 98`, bl)
      const st = await ty(p, p.locator('#f-street'), '٩٨')
      check(st === '٩٨', `${tag}: a STREET box keeps the Arabic digits typed into it (the normaliser is scoped)`, st)
    })

    await section('account', async () => {
      await p.goto(`${BASE}/${q(lang)}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
      await click(p, p.locator('[data-cua-btn]'))
      await click(p, p.locator('.cua-tab').nth(1))
      await screen(p, `${tag} account sheet`, lang, { 'account.phone': 1 }, ['account.name', 'account.email'])
      const v = await ty(p, p.locator('#cua-phone'), dig('55512345', set))
      await p.locator('#cua-name').focus(); await p.waitForTimeout(200)
      check(await p.locator('#cua-phone').inputValue() === '55512345' && v === '55512345', `${tag}: account phone in ${setName(set)} digits is 55512345`, v)
      const nm = await ty(p, p.locator('#cua-name'), '٥٥٥١٢٣٤٥')
      check(nm === '٥٥٥١٢٣٤٥', `${tag}: the NAME box keeps Arabic digits (not in scope)`, nm)
      await p.keyboard.press('Escape')
    })

    await section('track', async () => {
      await p.goto(`${BASE}/track${q(lang)}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
      await screen(p, `${tag} /track`, lang, {}, ['track.ref'])
    })

    await section('returns', async () => {
      await p.goto(`${BASE}/returns${q(lang)}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
      await screen(p, `${tag} /returns`, lang, { 'returns.phone': 1 }, ['returns.ref'])
      const v = await ty(p, p.locator('main input[placeholder*="9XXXXXXX"]'), dig('96555123', set))
      check(v === '96555123', `${tag}: /returns pickup phone in ${setName(set)} digits is 96555123`, v)
    })

    for (const [path, r] of [['/card', 'balance'], ['/returns/request', 'return_items']]) {
      await section(path === '/card' ? 'card' : 'returns-request', async () => {
        await p.goto(`${BASE}${path}${q(lang)}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
        await screen(p, `${tag} ${path}`, lang, { 'flat.phone': 1 }, ['flat.track'])
        check(await p.locator('#track').getAttribute('inputmode') === 'latin', `${tag} ${path}: the order reference keeps inputmode=latin`)
        let got = null
        const seen = (req) => { if (routeOf(req.url()) === r) got = new URL(req.url()).searchParams.get('phone') }
        p.on('request', seen)
        await p.locator('#phone').fill(''); await p.locator('#phone').focus(); await p.keyboard.type(dig('55512345', set))
        await p.locator('#track').fill('SP1A2B3C')
        await p.locator('#phone').press('Enter'); await p.waitForTimeout(900)
        p.off('request', seen)
        check(got === '55512345', `${tag} ${path}: a phone typed in ${setName(set)} digits is SENT as phone=55512345`, String(got))
      })
    }
    await ctx.close()
  }

  /* ======================================================== panel, signed out */
  for (const [device, lang, set] of PANEL) {
    const tag = `panel ${device} ${lang} (${setName(set)} digits)`
    await section('signin-code', async () => {
      const ctx = await phoneCtx(device, lang)
      const sent = await guard(ctx, { mocks: { login: json({ email: 'manager@sporta.com.kw', need_code: true, code_via: 'totp' }) } })
      const p = await ctx.newPage()
      await p.goto(`${BASE}/backends`); await p.waitForSelector('input[type=password]'); await langIs(p, typeof lang === 'string' ? lang : 'ar')
      await p.locator('input[type=email]').first().fill('manager@sporta.com.kw')
      await p.locator('input[type=password]').first().fill('not-sent-anywhere')
      await p.keyboard.press('Enter'); await p.waitForTimeout(1200)
      await screen(p, `${tag} sign-in code step`, lang, { 'signin.code': 1 })
      const box = p.locator('input[autocomplete=one-time-code]').first()
      const v = await ty(p, box, dig('123456', set))
      check(v === '123456', `${tag}: the 2FA code box shows 123456`, v)
      const from = since(sent)
      await click(p, p.locator('button').filter({ hasText: /^Verify$/ }))
      const body = await waitSent(p, sent, 'login_code', from)
      check(body && body.code === '123456', `${tag}: login_code is SENT {code:'123456'}`, JSON.stringify(body))
      // C. composition on the React-controlled \D-strip box
      const cdp = await ctx.newCDPSession(p)
      await box.focus(); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.press('Backspace')
      await cdp.send('Input.imeSetComposition', { text: '٤', selectionStart: 1, selectionEnd: 1 })
      await cdp.send('Input.imeSetComposition', { text: '٤٥', selectionStart: 2, selectionEnd: 2 })
      await p.locator('button').filter({ hasText: /^Back$/ }).first().focus(); await p.waitForTimeout(300)
      const c = await box.inputValue()
      check(c === '45', `${tag}: an IME composition of ٤٥ on the 2FA box ends as 45 (not '' and not 445)`, JSON.stringify(c))
      await ctx.close()
    })

    await section('passcode-pad', async () => {
      const ctx = await phoneCtx(device, lang)
      const sent = await guard(ctx, { reads: { passcode_status: json({ trusted: true, locked: false }) }, mocks: { passcode_unlock: json({ error: 'passcode_wrong' }, 401) } })
      const p = await ctx.newPage()
      await p.goto(`${BASE}/backends`); await p.waitForSelector('[data-sporta-pass-pad] input'); await langIs(p, typeof lang === 'string' ? lang : 'ar')
      await screen(p, `${tag} passcode keypad`, lang, { 'signin.pad': 1 })
      const from = since(sent)
      await p.locator('[data-sporta-pass-pad] input').focus(); await p.keyboard.type(dig('123456', set))
      const body = await waitSent(p, sent, 'passcode_unlock', from)
      check(body && body.passcode === '123456', `${tag}: six ${setName(set)} digits auto-submit passcode_unlock {passcode:'123456'}`, JSON.stringify(body))
      await ctx.close()
    })

    await section('password-reset', async () => {
      const ctx = await phoneCtx(device, lang)
      const sent = await guard(ctx, { mocks: { password_reset_request: json({ ok: true }), password_reset_confirm: json({ error: 'reset_refused' }, 400) } })
      const p = await ctx.newPage()
      await p.goto(`${BASE}/backends`); await p.waitForSelector('[data-sporta-reset] button'); await langIs(p, typeof lang === 'string' ? lang : 'ar')
      await click(p, p.locator('[data-sporta-reset] button').first())
      await p.locator('[data-sporta-reset] input[autocomplete=username]').fill('manager@sporta.com.kw')
      await click(p, p.locator('[data-sporta-reset] button').nth(1))
      await screen(p, `${tag} forgot-password code`, lang, { 'reset.code': 1 })
      const code = p.locator('[data-sporta-reset] input[autocomplete=one-time-code]')
      const v = await ty(p, code, dig('12345678', set))
      check(v === '12345678', `${tag}: the emailed code box shows 12345678`, v)
      const pws = p.locator('[data-sporta-reset] input[type=password]')
      await pws.nth(0).fill('a-long-enough-password'); await pws.nth(1).fill('a-long-enough-password')
      const from = since(sent)
      await click(p, p.locator('[data-sporta-reset] button').last())
      const body = await waitSent(p, sent, 'password_reset_confirm', from)
      check(body && body.code === '12345678', `${tag}: password_reset_confirm is SENT code '12345678'`, JSON.stringify(body))
      await ctx.close()
    })
  }

  /* ========================================================= panel, signed in */
  let state = null
  if (!ONLY.length || ONLY.some((x) => PANEL_SECTIONS.includes(x))) {
    // ONE real sign-in; its cookies serve every panel context below.
    const ctx = await br.newContext({ userAgent: RIG_UA, viewport: { width: 1280, height: 900 } })
    await guard(ctx, { allowLogin: true })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/backends`); await p.waitForSelector('input[type=password]'); await langIs(p, typeof lang === 'string' ? lang : 'ar')
    await p.locator('input[type=email]').first().fill('manager@sporta.com.kw')
    await p.locator('input[type=password]').first().fill('correct horse')
    await p.keyboard.press('Enter')
    const inside = await p.waitForSelector('.admin-content', { timeout: 15000 }).then(() => true).catch(() => false)
    check(inside, 'the one real sign-in opens the panel')
    state = inside ? await ctx.storageState() : null
    await ctx.close()
  }

  const nav = async (p, name) => {
    const b = p.locator('.admin-sidebar button, .m-tabbar__item').filter({ hasText: new RegExp('^\\s*' + name + '\\s*$') }).first()
    await b.evaluate((x) => x.click()); await p.waitForTimeout(1700)
  }

  for (const [device, lang, set] of state ? PANEL : []) {
    const tag = `panel ${device} ${lang} (${setName(set)} digits)`
    const flags = { totp: false }
    const ctx = await phoneCtx(device, lang, { storageState: state })
    const withTotp = async (rt) => {
      const res = await rt.fetch(); const j = await res.json().catch(() => null)
      if (j && flags.totp) j.totp = true
      return rt.fulfill({ response: res, body: JSON.stringify(j) })
    }
    const sent = await guard(ctx, {
      reads: {
        me: withTotp, account: withTotp,
        passcode_devices: json({ ready: true, devices: [] }),
        products_all: async (rt) => {   // one product FEATURED, so the Featured list has an Order box
          const res = await rt.fetch(); const j = await res.json().catch(() => null)
          const list = Array.isArray(j) ? j : (j && (j.products || j.rows))
          if (Array.isArray(list) && list.length) { list[0].featured = true; list[0].featured_sort = 3 }
          return rt.fulfill({ response: res, body: JSON.stringify(j) })
        },
      },
      mocks: { totp_begin: json({ secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Sporta:rig?secret=JBSWY3DPEHPK3PXP&issuer=Sporta' }) },
    })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/backends`); await p.waitForSelector('.admin-content', { timeout: 20000 }); await langIs(p, typeof lang === 'string' ? lang : 'ar'); await p.waitForTimeout(1200)
    const body = async (r, from) => waitSent(p, sent, r, from)

    await section('security', async () => {
      await nav(p, 'Security')
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Turn it on$/ }))
      await p.locator('.admin-content input[autocomplete=current-password]').first().fill('correct horse')
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Continue$/ }))
      await screen(p, `${tag} Security (enrolling 2FA)`, lang, { 'sec.pin': 2, 'sec.phone': 1, 'sec.code': 1 }, ['google.client', 'apple.services'])
      let from = since(sent)
      const ec = await ty(p, p.locator('.admin-content input[placeholder="000000"]').first(), dig('123456', set))
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Turn on two-factor$/ }))
      const en = await body('totp_enable', from)
      check(ec === '123456' && en && en.code === '123456', `${tag}: 2FA enrolment code is SENT '123456'`, `${ec} ${JSON.stringify(en)}`)
      const pins = p.locator('[data-sporta-pass-card] input[type=password]')
      const a = await ty(p, pins.nth(0), dig('123457', set)); const b2 = await ty(p, pins.nth(1), dig('123457', set))
      from = since(sent)
      await click(p, p.locator('[data-sporta-pass-card] button').filter({ hasText: /^Trust this device$/ }))
      const pe = await body('passcode_enroll', from)
      check(a === '123457' && b2 === '123457' && pe && pe.passcode === '123457', `${tag}: passcode_enroll is SENT '123457'`, `${a} ${b2} ${JSON.stringify(pe)}`)
      // 2FA ON (me/account answered with totp:true): turn-off code and the code under Save changes
      flags.totp = true
      await p.reload(); await p.waitForSelector('.admin-content'); await p.waitForTimeout(1000)
      await nav(p, 'Security')
      await screen(p, `${tag} Security (2FA on)`, lang, { 'sec.code': 2, 'sec.phone': 1, 'sec.pin': 2 })
      const codes = p.locator('.admin-content input[placeholder="000000"]')
      const cur = p.locator('.admin-content input[autocomplete=current-password]')
      const tel = await ty(p, p.locator('.admin-content input[type=tel][autocomplete=tel]'), '+' + dig('965', set) + ' ' + dig('55512345', set))
      await cur.last().fill('correct horse')
      await ty(p, codes.last(), dig('123456', set))
      from = since(sent)
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Save changes$/ }))
      const au = await body('account_update', from)
      check(tel === '+965 55512345' && au && au.phone === '+965 55512345' && au.code === '123456', `${tag}: account_update is SENT phone '+965 55512345' and code '123456'`, `${tel} ${JSON.stringify(au)}`)
      await cur.first().fill('correct horse')
      await ty(p, codes.first(), dig('123456', set))
      from = since(sent)
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Turn two-factor off$/ }))
      const td = await body('totp_disable', from)
      check(td && td.code === '123456', `${tag}: totp_disable is SENT code '123456'`, JSON.stringify(td))
      flags.totp = false
      await p.reload(); await p.waitForSelector('.admin-content'); await p.waitForTimeout(1000)
    })

    await section('settings', async () => {
      await nav(p, 'Settings')
      await click(p, p.locator('.hsl .hsl-btn').filter({ hasText: /^Edit$/ }))
      await screen(p, `${tag} Settings`, lang, { 'contact.whatsapp': 1, 'slide.sort': 1 }, ['contact.printed', 'hex'])
      // WhatsApp
      const wa = p.locator('section[data-sporta-panel=contact] .spc-field').filter({ has: p.locator('.spc-label', { hasText: /^WhatsApp number$/ }) }).locator('input')
      const wv = await ty(p, wa, dig('96555512345', set))
      let from = since(sent)
      await click(p, p.locator('section[data-sporta-panel=contact] button').filter({ hasText: /^Save contact details$/ }))
      const cs = await body('settings_save', from)
      check(wv === '96555512345' && cs && cs.name === 'contact' && cs.value && cs.value.whatsapp === '96555512345', `${tag}: contact save SENDS whatsapp '96555512345'`, `${wv} ${JSON.stringify(cs && cs.value)}`)
      from = since(sent)
      await click(p, p.locator('button').filter({ hasText: /^Save rules$/ }))
      const rs = await body('settings_save', from)
      const rv = rs && rs.value
      check(rs && rs.name === 'rules' && rv && rv.return_days === 12 && rv.delivery_fee_fils === 1500, `${tag}: rules save SENDS return_days 12 and delivery_fee_fils 1500 (from ${dig('1.500', set)})`, JSON.stringify(rv))
      // Home slides card: sort order
      const sort = p.locator('.hsl-edit label.hsl-field').filter({ has: p.locator('.hsl-label', { hasText: /^Sort order$/ }) }).locator('input')
      const sv = await ty(p, sort, dig('12', set))
      from = since(sent)
      await click(p, p.locator('.hsl-edit .hsl-save'))
      const ss = await body('slide_save', from)
      check(sv === '12' && ss && ss.sort === 12, `${tag}: slide_save is SENT sort 12`, `${sv} ${JSON.stringify(ss && ss.sort)}`)
      await ty(p, sort, 'abc')
      from = since(sent)
      await click(p, p.locator('.hsl-edit .hsl-save'))
      check(!(await body('slide_save', from)), `${tag}: a sort that is not a number is refused, not saved as 0`)
    })

    await section('payments', async () => {
      await nav(p, 'Payments')
      await screen(p, `${tag} Payments`, lang, { 'pay.codOpen': 1, 'pay.codMax': 1, 'rules.money': 2, 'rules.count': 5 }, ['payment.cred'])
      // Shop rules (on the Payments screen since 2026-10-07)
      await ty(p, p.locator('input.srl-num[data-rule=return_days]'), dig('12', set))
      await ty(p, p.locator('input.srl-num[data-rule=delivery_fee_fils]'), dig('1.500', set))
      const ins = p.locator('[data-spps] input.spps-in')
      await ty(p, ins.nth(0), dig('4', set)); await ty(p, ins.nth(1), dig('5.5', set))
      let from = since(sent)
      await click(p, p.locator('[data-spps] button').filter({ hasText: /^Save$/ }))
      const ps = await body('settings_save', from)
      check(ps && ps.value && ps.value.cod_open_max === '4' && ps.value.cod_max_fils === '5500', `${tag}: COD limits SEND cod_open_max '4' and cod_max_fils '5500' (from ${dig('5.5', set)})`, JSON.stringify(ps && ps.value))
      await ty(p, ins.nth(1), '')
      from = since(sent)
      await click(p, p.locator('[data-spps] button').filter({ hasText: /^Save$/ }))
      const none = await waitSent(p, sent, 'settings_save', from, 1200)
      check(!none && /Check the numbers/.test(await p.locator('[data-spps]').innerText()), `${tag}: an EMPTY largest-cash-order box is refused, nothing sent (not read as "no limit")`, JSON.stringify(none))
    })

    await section('inventory', async () => {
      await nav(p, 'Inventory')
      await p.locator('[data-sporta-inventory] select[aria-label="Product to edit"]').selectOption({ index: 1 }); await p.waitForTimeout(600)
      await screen(p, `${tag} Inventory`, lang, { 'inv.low': 1, 'inv.cell': '+', 'stock.row': '+', 'cost.aed': 1 }, ['search'])
      // Its width is the 84px the card's CSS asks for: as a text box it once stretched to ~230px
      // (min-width:auto beats a flex basis) and broke the row onto three lines on a phone.
      const lw = await p.locator('[data-sporta-inventory] input[aria-label="Low-stock line"]').evaluate((e) => e.getBoundingClientRect().width)
      check(lw >= 70 && lw <= 100, `${tag}: the low-stock box keeps its 84px width`, `${Math.round(lw)}px`)
      await ty(p, p.locator('[data-sporta-inventory] input[aria-label="Low-stock line"]'), dig('12', set))
      let from = since(sent)
      await click(p, p.locator('[data-sporta-inventory] button').filter({ hasText: /^Save line$/ }))
      const lo = await body('inventory_low_save', from)
      check(lo && lo.low === 12, `${tag}: inventory_low_save is SENT low 12`, JSON.stringify(lo))
      await p.locator('[data-sporta-inventory] select[aria-label="Product to edit"]').selectOption({ index: 1 }); await p.waitForTimeout(500)
      const cell = p.locator('[data-sporta-inventory] input[data-sku]').first()
      await ty(p, cell, dig('12', set))
      from = since(sent)
      await click(p, p.locator('[data-sporta-inventory] button').filter({ hasText: /^Save all sizes$/ }))
      const ia = await body('inventory_apply', from)
      check(ia && ia.changes && ia.changes[0] && ia.changes[0].stock === '12', `${tag}: inventory_apply is SENT stock '12'`, JSON.stringify(ia))
    })

    await section('catalogue', async () => {
      await nav(p, 'Catalogue')
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Every product in the database$/ }))
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Edit$/ }))
      await screen(p, `${tag} product editor`, lang, { 'product.price': '+' })
      const price = p.locator('label').filter({ hasText: /^Price \(KWD\)/ }).locator('input').first()
      const v = await ty(p, price, dig('9.500', set))
      const from = since(sent)
      await click(p, p.locator('button').filter({ hasText: /^Save product$/ }))
      const ps = await body('product_save', from)
      check(v === '9.500' && ps && Number(ps.price) === 9.5, `${tag}: product_save is SENT price 9.5 from ${dig('9.500', set)} (not 9500)`, `${v} ${JSON.stringify(ps && ps.price)}`)
      await click(p, p.locator('button').filter({ hasText: /^Cancel$/ }))
    })

    await section('discounts', async () => {
      await nav(p, 'Discounts')
      await click(p, p.locator('.admin-content button').filter({ hasText: /^New discount$/ }))
      await screen(p, `${tag} new discount`, lang, { 'disc.percent': 1, 'disc.min': 1, 'disc.times': 1 }, ['disc.code'])
      await p.locator('input[placeholder="SAVE10"]').fill('RIGTEST')
      await p.locator('input[placeholder="10% welcome offer"]').fill('Rig')
      await ty(p, p.locator('label').filter({ hasText: /^Percent/ }).locator('input').first(), dig('10', set))
      const min = p.locator('label').filter({ hasText: /^Minimum order/ }).locator('input').first()
      const mv = await ty(p, min, dig('10.5', set))
      const from = since(sent)
      await click(p, p.locator('button').filter({ hasText: /^Save$/ }).last())
      const ds = await body('discount_save', from)
      check(mv === '10.5' && ds && Number(ds.min_order) === 10.5 && Number(ds.value) === 10, `${tag}: discount_save is SENT min_order 10.5 and value 10`, `${mv} ${JSON.stringify(ds)}`)
      // C. composition on a component-I decimal box
      const cdp = await ctx.newCDPSession(p)
      await min.focus(); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.press('Backspace')
      await cdp.send('Input.imeSetComposition', { text: '٤', selectionStart: 1, selectionEnd: 1 })
      await cdp.send('Input.imeSetComposition', { text: '٤٥', selectionStart: 2, selectionEnd: 2 })
      await p.locator('input[placeholder="SAVE10"]').focus(); await p.waitForTimeout(300)
      const c = await min.inputValue()
      check(c === '45', `${tag}: an IME composition of ٤٥ on a decimal box ends as 45 (not '' and not 445)`, JSON.stringify(c))
      await cdp.detach()
      await click(p, p.locator('button').filter({ hasText: /^Cancel$/ }))
    })

    await section('brands', async () => {
      await nav(p, 'Brands')
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Edit$/ }))
      await screen(p, `${tag} brand dialog`, lang, { 'brand.order': 1 })
      const v = await ty(p, p.locator('label').filter({ hasText: /^Order/ }).locator('input[type=number]').first(), dig('12', set))
      const from = since(sent)
      await click(p, p.locator('button').filter({ hasText: /^Save brand$/ }))
      const bs = await body('brand_save', from)
      check(v === '12' && bs && Number(bs.sort) === 12, `${tag}: brand_save is SENT sort 12 (type=number kept)`, `${v} ${JSON.stringify(bs)}`)
      await click(p, p.locator('button').filter({ hasText: /^Cancel$/ }))
    })

    await section('promotions', async () => {
      await nav(p, 'Promotions')
      const fo = p.locator('.admin-content input[type=number][step="1"]').first()
      await screen(p, `${tag} Promotions`, lang, { 'featured.order': 1 }, ['search'])
      const fv = await ty(p, fo, dig('12', set))
      let from = since(sent)
      await fo.blur(); await p.waitForTimeout(500)
      const f = await body('product_save', from)
      check(fv === '12' && f && Number(f.featured_sort) === 12, `${tag}: a featured Order typed in ${setName(set)} digits SENDS featured_sort 12`, `${fv} ${JSON.stringify(f && f.featured_sort)}`)
      await p.locator('.admin-content input[type=search]').fill('Cloudsoft'); await p.waitForTimeout(1000)
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Put on sale$/ }))
      await screen(p, `${tag} Promotions, sale price`, lang, { 'sale.price': 1, 'featured.order': 1 })
      const sv = await ty(p, p.locator('.admin-content input[type=number][step="0.001"]').first(), dig('5.5', set))
      from = since(sent)
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Set$/ }))
      const s = await body('product_save', from)
      check(sv === '5.5' && s && Number(s.sale_price) === 5.5, `${tag}: Put on sale SENDS sale_price 5.5 from ${dig('5.5', set)} (not a cleared sale)`, `${sv} ${JSON.stringify(s && s.sale_price)}`)
    })

    await section('accounting', async () => {
      await nav(p, 'Accounting')
      await screen(p, `${tag} Accounting`, lang, { 'acc.rate': 1 })
      const rv = await ty(p, p.locator('label').filter({ hasText: /AED → KWD rate/ }).locator('input').first(), dig('0.0817', set))
      let from = since(sent)
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Save$/ }))
      const ar = await body('acc_settings_save', from)
      check(rv === '0.0817' && ar && Number(ar.aed_to_kwd) === 0.0817, `${tag}: the AED → KWD rate is SENT 0.0817`, `${rv} ${JSON.stringify(ar)}`)
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Journal$/ }))
      await click(p, p.locator('.admin-content button').filter({ hasText: /^New entry$/ }))
      await screen(p, `${tag} journal entry`, lang, { 'acc.line': 4 })
      await p.locator('.admin-content input[placeholder="Rent for August"]').fill('Rig')
      const sels = p.locator('.admin-content table select')
      await sels.nth(0).selectOption('6300'); await sels.nth(1).selectOption('1000')
      const cells = p.locator('.admin-content table input[inputmode=decimal]')
      await ty(p, cells.nth(0), dig('5', set)); await ty(p, cells.nth(3), dig('5', set))
      const post = p.locator('.admin-content button').filter({ hasText: /^Post it$/ })
      const totals = (await p.locator('.admin-content').innerText()).match(/5\.000/g) || []
      check(await post.isEnabled() && totals.length >= 2, `${tag}: journal totals read 5.000 and Post it is enabled`, `${totals.length} ${await post.isEnabled()}`)
      from = since(sent)
      await click(p, post)
      const je = await body('acc_entry_add', from)
      check(je && je.lines && je.lines[0].debit === '5' && je.lines[1].credit === '5', `${tag}: acc_entry_add is SENT debit '5' / credit '5'`, JSON.stringify(je))
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Chart of accounts$/ }))
      await screen(p, `${tag} chart of accounts`, lang, { 'acc.code': 1 })
      const cv = await ty(p, p.locator('.admin-content input[placeholder="6600"]'), dig('6600', set))
      await p.locator('.admin-content input[placeholder="Packaging"]').fill('Rig')
      await p.locator('.admin-content input[placeholder="التغليف"]').fill('ريغ')
      from = since(sent)
      await click(p, p.locator('.admin-content button').filter({ hasText: /^Add$/ }))
      const aa = await body('acc_account_save', from)
      check(cv === '6600' && aa && aa.code === '6600', `${tag}: acc_account_save is SENT code '6600'`, `${cv} ${JSON.stringify(aa)}`)
    })

    await section('drawer', async () => {
      await nav(p, 'Orders')
      await screen(p, `${tag} Orders`, lang, {}, ['search'])
      await p.locator('.admin-content .m-row, .admin-content tbody tr').first().evaluate((e) => (e.querySelector('button, a') || e).click()); await p.waitForTimeout(1500)
      await screen(p, `${tag} order drawer`, lang, { 'drawer.phone': 1, 'drawer.block': 1, 'drawer.floor': 1, 'drawer.flat': 1 }, ['drawer.street', 'drawer.building'])
      const sec = p.locator('section').filter({ has: p.locator(':scope > h3', { hasText: /^Customer$/ }) })
      const ph = await ty(p, sec.locator('label').filter({ has: p.locator(':scope > span', { hasText: /^Phone$/ }) }).locator(':scope > input'), dig('96555512345', set))
      const bl = await ty(p, sec.locator('label').filter({ has: p.locator(':scope > span', { hasText: /^Block$/ }) }).locator(':scope > input'), dig('7', set))
      const from = since(sent)
      await click(p, sec.locator('button').filter({ hasText: /^Save details$/ }))
      const cu = await body('customer', from)
      const f = cu && cu.fields
      check(ph === '96555512345' && bl === '7' && f && f.customer_phone === '96555512345' && f.customer_block === '7', `${tag}: the drawer SENDS customer_phone '96555512345' and customer_block '7'`, `${ph} ${bl} ${JSON.stringify(f)}`)
    })
    await ctx.close()
  }

  /* =========================================== panel, desktop: size charts */
  if (state) {
    await section('size-charts', async () => {
      const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, storageState: state })
      await ctx.addInitScript(() => { try { localStorage.setItem('lang', 'ar') } catch { /* private */ } })
      const sent = await guard(ctx)
      const p = await ctx.newPage()
      await p.goto(`${BASE}/backends`); await p.waitForSelector('.admin-content', { timeout: 20000 }); await langIs(p, typeof lang === 'string' ? lang : 'ar'); await p.waitForTimeout(1000)
      await nav(p, 'Size charts')
      await screen(p, 'desktop size charts', 'desktop', { 'size.cell': '+' })
      const cell = p.locator('.admin-content table').filter({ hasText: 'Chest' }).locator('tbody tr').first().locator('input').first()
      const v = await ty(p, cell, dig('90', AR))
      const from = since(sent)
      await click(p, p.locator('.admin-content table').filter({ hasText: 'Chest' }).locator('tbody tr').first().locator('button').filter({ hasText: /^Save$/ }))
      const sc = await waitSent(p, sent, 'size_chart_save', from)
      check(v === '90' && sc && Number(sc.chest_min) === 90, 'desktop: size_chart_save is SENT chest_min 90 from ٩٠', `${v} ${JSON.stringify(sc)}`)
      await ctx.close()
    })
  }

  /* ============================================================== totals */
  console.log('')
  for (const [lang, keys] of Object.entries(counted)) console.log(`checked ${keys.size} planned field groups (${lang}): ${[...keys].sort().join(' ')}`)
  if (!ONLY.length) {
    // Every planned group must have been seen in BOTH languages: a group checked in
    // one language only means a screen silently did not open in the other.
    const ar = counted.ar ?? new Set(), en = counted.en ?? new Set()
    const missing = [...new Set([...ar, ...en])].filter((k) => !ar.has(k) || !en.has(k))
    check(ar.size === PLANNED_GROUPS && en.size === PLANNED_GROUPS && !missing.length,
      `checked ${PLANNED_GROUPS} planned field groups in Arabic AND in English (${ar.size} / ${en.size})`, missing.join(' '))
    check(counted.desktop?.has('size.cell'), 'checked the size-chart cells on a desktop (they are hidden on a phone)')
  }
  if (state || !ONLY.length) check(continuedWrites === 1, `exactly one non-GET request reached the server (the sign-in): ${continuedWrites}`)
  else check(continuedWrites === 0, `no non-GET request reached the server: ${continuedWrites}`)
} finally {
  await br.close().catch(() => {})
  try {
    const n = sql(`delete from admin_login_log where id > ${startLog} and agent like '%numkb-rig%'; select row_count()`)
    console.log(`cleanup: removed ${n} admin_login_log row(s) this run wrote`)
  } catch (e) { console.log('cleanup: could not tidy admin_login_log — ' + e.message.split('\n')[0]) }
}

if (throttled.length) {
  console.log(`\nINCONCLUSIVE: ${throttled.length} request(s) were throttled (${[...new Set(throttled)].slice(0, 4).join(', ')}) — a throttled request is not an answer`)
  process.exit(2)
}
console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
