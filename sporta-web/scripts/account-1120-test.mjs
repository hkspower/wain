// ACCOUNT 1120 (owner, 2026-11-19: "full inprove register and user profile"):
//   the block ACCOUNT 1120 at the end of public/sporta-features.js, the section ACCOUNT 1120 of public/sporta-shadows.css and the
//   "Save birthday" label of public/birthday.js, proven on the REAL compiled /account page.
//
//   npm run test:account-1120     (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// The capture lacks the account page's stylesheet, so the real one (scripts/fixtures/account/Account-DqFbZs-H.css, fetched read-only from
// the live site on 2026-11-19, 7,697 bytes) is served in its place; the customer API (/api/customer.php) is a fake that records every call.
//
//   VERIFICATION  a signed-in customer whose address is NOT verified gets a banner under the welcome card (title, the address in a left-to-
//                 right span, a 44px "Resend link" button, a polite status line); a verified one gets a "Verified" chip under the address;
//                 nothing is drawn before the server has answered (the page's own `me` is fast, ours is held back 0.8 s); a `me` answer for
//                 ANOTHER address changes nothing; `me` is asked once, with the compiled client's headers.
//   RESEND        one POST (JSON {} and X-Sporta-Customer: 1), never two for two quick clicks; sent -> the address in the status and the
//                 button aria-disabled for the minute; the server's 429 retry_after in minutes (the Arabic dual and plural); 503, 401,
//                 `sent: false`, no connection each have their sentence; `already` turns the banner into the chip.
//   NOTICES       ?verified=1 / ?verified=0, signed in or out, both languages: the right sentence, a sign-in link (44px) only when signed
//                 out, the notice right under the title; any other value, none.
//   PASSWORDS     register (and reset, and change password): "7 of 12 characters" as you type, "Long enough" at 12 (counted in code points
//                 like the compiled rule), the bar, ink once met; the live region speaks only the moment it becomes true; none on the
//                 sign-in form; the confirm box says match / do not match yet; the compiled hint text is untouched; no password value leaves
//                 the page except in the one request the page itself makes.
//   LIFE          sign out removes every node; another customer signing in starts clean; a new account shows the banner at once; the
//                 language follows <html lang>; no other page gets a node or a request; no sideways scroll from 320px; AA contrast in
//                 both themes.
//   POLISH        the order cards' three links, the "Track a guest order" link and the Terms / Privacy links are 44px; the birthday panel's
//                 button says "Save birthday".
//   MUTATION      each numbered CSS rule ([av-1]..[av-7]) and each rule of the script (the ask, the address match, the double-click guard, the
//                 cooldown, `already`, the retry words, the Arabic dual, the notices, the sign-in-form guard, the code-point count, the
//                 announcement, the confirm match, the input listener, the birthday label) is cut in turn and its check must go red.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const FEAT_F = 'sporta-features.js', CSS_F = 'sporta-shadows.css', BDAY_F = 'birthday.js'
const FEAT = readFileSync(join(PUB, FEAT_F), 'utf8'), CSS = readFileSync(join(PUB, CSS_F), 'utf8'), BDAY = readFileSync(join(PUB, BDAY_F), 'utf8')
const ACCOUNT_CSS = readFileSync(new URL('./fixtures/account/Account-DqFbZs-H.css', import.meta.url), 'utf8')
const B0 = FEAT.indexOf('/* ===== ACCOUNT 1120 ('), B1 = FEAT.indexOf('/* ===== ACCOUNT 1120 - end')
const BLOCK = B0 >= 0 && B1 > B0 ? FEAT.slice(B0, B1) : ''

let pass = 0, fail = 0
// a scenario that hangs must end the run with a failing line, not hold the release gate until its own timeout
setTimeout(() => { console.log('FAIL watchdog: the suite did not finish in 20 minutes'); process.exit(1) }, 20 * 60 * 1000).unref()
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + String(detail).slice(0, 420) : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const note = (t) => console.log('note ' + t)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const limit = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000} s`)), ms).unref())
const closeQuietly = (ctx) => Promise.race([ctx.close().catch(() => {}), new Promise((r) => setTimeout(r, 10000).unref())])
// a check that reads a field a broken page does not have is a check that fails, not a crash
const holds = (check, ...a) => { try { return check(...a) === true } catch (e) { return false } }
const ad = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d])

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
const withServer = async (opts, fn) => {
  const srv = await serveLive({ ...opts, css: { 'assets/Account-DqFbZs-H.css': ACCOUNT_CSS, ...(opts.css || {}) } })
  try { return await fn(srv) } finally { await srv.close() }
}

// ---------------------------------------------------------------------------------------------------------------- the words
const W = {
  en: {
    title: 'Verify your email address', text: (e) => `Open the link we sent to ${e}. Cannot find it? Check your spam folder or ask for a new link.`,
    btn: 'Resend link', again: 'Send again', sent: (e) => `A new link is on its way to ${e}. Check your inbox and spam folder.`,
    failed: 'We could not send the email right now. Please try again in a few minutes.', many: (t) => `Too many requests. Please try again in ${t}.`,
    unavailable: 'Verification is temporarily unavailable. Please try again later.', expired: 'Your sign-in has expired. Please sign in again.',
    network: 'We could not reach the shop. Check your connection and try again.', verified: 'Verified',
    okIn: 'Your email address is verified. Thank you!', okOut: 'Your email address is verified. Sign in to continue',
    badIn: 'This verification link has expired or was already used.', badAsk: 'This verification link has expired or was already used. You can ask for a new one below.',
    badOut: 'This verification link has expired or was already used. Sign in to ask for a new link',
    count: (n) => `${n} of 12 characters`, ok: 'Long enough', match: 'Passwords match', noMatch: 'Passwords do not match yet', save: 'Save birthday', saveDetails: 'Save details'
  },
  ar: {
    title: 'أكّد بريدك الإلكتروني', text: (e) => `افتح الرابط الذي أرسلناه إلى ${e}. إن لم تجده فتحقّق من البريد غير المرغوب أو اطلب رابطًا جديدًا.`,
    btn: 'إعادة إرسال الرابط', again: 'إرسال مرة أخرى', sent: (e) => `تم إرسال رابط جديد إلى ${e}. تحقّق من صندوق الوارد والبريد غير المرغوب.`,
    failed: 'تعذّر إرسال الرسالة الآن. حاول مجددًا بعد دقائق.', many: (t) => `محاولات كثيرة. حاول مجددًا بعد ${t}.`,
    unavailable: 'التأكيد غير متاح مؤقتًا. حاول مجددًا لاحقًا.', expired: 'انتهت صلاحية تسجيل دخولك. سجّل الدخول مرة أخرى.',
    network: 'تعذّر الاتصال بالمتجر. تحقّق من اتصالك وحاول مرة أخرى.', verified: 'تم التأكيد',
    okIn: 'تم تأكيد بريدك الإلكتروني. شكرًا لك!', okOut: 'تم تأكيد بريدك الإلكتروني. سجّل الدخول للمتابعة',
    badIn: 'انتهت صلاحية رابط التأكيد أو استُخدم بالفعل.', badAsk: 'انتهت صلاحية رابط التأكيد أو استُخدم بالفعل. يمكنك طلب رابط جديد أدناه.',
    badOut: 'انتهت صلاحية رابط التأكيد أو استُخدم بالفعل. سجّل الدخول لطلب رابط جديد',
    count: (n) => `${ad(n)} من ١٢ حرفًا`, ok: 'طول كلمة المرور مناسب', match: 'كلمتا المرور متطابقتان', noMatch: 'كلمتا المرور غير متطابقتين بعد', save: 'حفظ تاريخ الميلاد', saveDetails: 'حفظ البيانات'
  }
}
const EMAIL = 'sara@example.com'

// ---------------------------------------------------------------------------------------------------------------- the fake customer API
const USER = (o = {}) => ({ name: 'Sara Al-Ahmad', email: EMAIL, phone: '55123456', email_verified: false, ...o })
const ME_OF = (u) => (u ? { name: u.name, email: u.email, phone: u.phone || '', email_verified: !!u.email_verified } : null)
const ORDERS = [
  { track_id: 'SPT2611190042', created_at: '2026-11-19T09:12:00Z', amount: 13.5, payment_status: 'pending', payment_method: 'cod', fulfilment_status: 'packed', items: [{ qty: 2, name_en: 'Sgomma T-Shirt - Navy', name_ar: 'تيشيرت سغوما - كحلي' }] },
  { track_id: 'SPT2611010007', created_at: '2026-11-01T18:30:00Z', amount: 8, payment_status: 'paid', payment_method: 'knet', fulfilment_status: 'delivered', items: [{ qty: 1, name_en: 'Cloudsoft Top - Navy', name_ar: 'توب كلاود سوفت - كحلي' }] },
]
const SENT = () => ({ status: 200, body: { ok: true, sent: true } })
const newFake = (o = {}) => ({
  user: o.user || null, orders: o.orders || [], slowMe: o.slowMe || 0, meBody: o.meBody || null, resend: o.resend || SENT, loginAs: o.loginAs || null,
  holdPageMe: !!o.holdPageMe, oursDone: false,
  calls: [], meCalls: 0,
})
const routeOf = (F) => async (r) => {
  const req = r.request(), u = new URL(req.url()), rt = (u.searchParams.get('r') || '').split('&')[0]
  let body = null; try { body = req.postData() ? JSON.parse(req.postData()) : null } catch (e) { body = req.postData() }
  F.calls.push({ rt, method: req.method(), headers: req.headers(), body, raw: req.postData() })
  const json = (b, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) })
  // two readers ask `me`: the page (its client always sends a Content-Type, even on a GET) and the block (it sends none). The block asks FIRST
  // (before the page has drawn the dashboard), so they are told apart by that header: only the block's asks are held back (slowMe) or
  // answered with another address (meBody), and the page's own can be held until the block's answer is in (holdPageMe)
  if (rt === 'me') {
    F.meCalls++
    const ours = !req.headers()['content-type']
    // slowMe: the block's ask is held until the scene has read what the page shows without an answer (F.release), never for more than 8 s:
    // the block now asks at DOMContentLoaded, so a fixed delay would depend on how long the page takes to load
    if (ours && F.slowMe) { const t0 = Date.now(); while (!F.release && Date.now() - t0 < 8000) await sleep(20) }
    if (!ours && F.holdPageMe) { const t0 = Date.now(); while (!F.oursDone && Date.now() - t0 < 1500) await sleep(20); await sleep(60) }
    const out = ours && F.meBody ? F.meBody(F) : ME_OF(F.user)
    if (!ours) return json(out)
    await json(out); F.oursDone = true; return
  }
  if (rt === 'orders') return F.user ? json({ orders: F.orders, has_more: false, page: 1 }) : json({ error: 'not_authenticated' }, 401)
  if (rt === 'logout') { F.user = null; return json({ ok: true }) }
  if (rt === 'register') { F.user = { name: body.name, email: body.email, phone: '', email_verified: false }; return json(ME_OF(F.user), 201) }
  if (rt === 'login') { F.user = F.loginAs || F.user; return F.user ? json(ME_OF(F.user)) : json({ error: 'invalid_credentials' }, 401) }
  if (rt === 'verify_resend') { const x = await F.resend(F); if (x === 'abort') return r.abort('failed'); return json(x.body, x.status) }
  return json({ error: 'unavailable' }, 503)
}

// ---------------------------------------------------------------------------------------------------------------- the page
const open = async (srv, o = {}) => {
  const { path = '/account', lang = 'en', w = 390, h = 900, theme = 'light' } = o
  const F = newFake({ user: o.signedIn ? USER(o.user) : null, orders: o.orders, slowMe: o.slowMe, meBody: o.meBody, resend: o.resend, loginAs: o.loginAs, holdPageMe: o.holdPageMe })
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lang', l); localStorage.setItem('sporta_theme', t); localStorage.setItem('sporta_theme_explicit', '1') } catch (e) { /* no storage */ } }, [lang, theme])
  // what is on the page in every frame whose layout changed, read after layout and before paint (a ResizeObserver runs there): a frame that
  // shows the dashboard WITHOUT the banner / chip is a frame the shopper sees before the block's node pushes the orders down
  if (o.frames) await ctx.addInitScript(() => {
    window.__frames = []
    const snap = () => { const q = (s) => !!document.querySelector(s); window.__frames.push({ dash: q('.account-dashboard'), banner: q('.spv'), chip: q('.spv-chip') }) }
    const go = () => { try { const ro = new ResizeObserver(snap); ro.observe(document.documentElement); ro.observe(document.body) } catch (e) { /* no observer */ } }
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go, { once: true })
  })
  await ctx.route('**/api/customer.php**', routeOf(F))
  await ctx.route('**/api/birthday.php**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ birthday: '', gift: { percent: 10, days: 7 } }) }))
  const p = await ctx.newPage(); const errs = [], reqs = []
  p.setDefaultTimeout(12000)
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('request', (q) => reqs.push({ url: q.url(), method: q.method(), body: q.postData() }))
  await p.goto(srv.base + path, { waitUntil: 'load' })
  await p.waitForSelector(o.waitFor || (o.signedIn ? '.account-dashboard' : '.customer-account form, .customer-account__card'))
  if (o.settle !== 0) await p.waitForTimeout(o.settle ?? 900)
  return { ctx, p, F, errs, reqs }
}
// one scene = one page; it hands back what it measured even when a step cannot finish, with the reason in `error`
const scene = (body) => async (opts = {}, o = {}) => withServer(opts, async (srv) => {
  const f = { errs: [] }
  try { await Promise.race([body(srv, f, o), limit(90000, 'the scene')]) } catch (e) { f.error = String((e && e.message) || e).split('\n')[0] }
  if (f.t) { f.errs = f.t.errs; f.reqs = f.t.reqs; f.calls = f.t.F.calls; await closeQuietly(f.t.ctx); delete f.t }
  return f
})
// a scene that could not finish is run once more (a loaded machine is the usual reason); a broken rule fails both times
const run = async (sc, opts, o) => { const f = await sc(opts, o); return f.error ? sc(opts, o) : f }
const memo = new Map()
const real = (id, sc, o) => { const k = id + JSON.stringify(o); if (!memo.has(k)) memo.set(k, run(sc, {}, o)); return memo.get(k) }

// ---------------------------------------------------------------------------------------------------------------- in-page readers
const FACTS = () => {
  const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)]
  const R = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } }
  const banner = q('.spv'), welcome = q('.account-dashboard__welcome'), grid = q('.account-dashboard__grid'), chip = q('.spv-chip'), notice = q('.spv-notice')
  const btn = q('.spv__btn'), h1 = q('.customer-account__card h1'), emailEl = q('.customer-account__email')
  const link = notice && notice.querySelector('a'), bcs = banner && getComputedStyle(banner), ccs = chip && getComputedStyle(chip), lcs = link && getComputedStyle(link)
  return {
    counts: { banners: qa('.spv').length, chips: qa('.spv-chip').length, notices: qa('.spv-notice').length, meters: qa('.spv-pw').length },
    banner: banner && {
      title: q('.spv__title').textContent, text: q('.spv__text').textContent, status: q('.spv__status').textContent, statusRole: q('.spv__status').getAttribute('role'), statusLive: q('.spv__status').getAttribute('aria-live'),
      v: banner.querySelector('.spv__v') && { dir: banner.querySelector('.spv__v').getAttribute('dir'), text: banner.querySelector('.spv__v').textContent },
      btn: { text: btn.textContent, aria: btn.getAttribute('aria-disabled'), tag: btn.tagName, type: btn.type, r: R(btn), display: getComputedStyle(btn).display, border: getComputedStyle(btn).borderTopWidth, radius: parseFloat(getComputedStyle(btn).borderTopLeftRadius), opacity: getComputedStyle(btn).opacity },
      afterWelcome: banner.previousElementSibling === welcome, beforeGrid: banner.nextElementSibling === grid, r: R(banner),
      css: { display: bcs.display, beforeW: parseFloat(getComputedStyle(banner, '::before').width), mb: parseFloat(bcs.marginBottom), dir: bcs.direction },
      gap: grid && grid.getBoundingClientRect().top - banner.getBoundingClientRect().bottom,
    },
    chip: chip && { text: chip.textContent, afterEmail: chip.previousElementSibling === emailEl, display: ccs.display, radius: ccs.borderTopLeftRadius, border: ccs.borderTopWidth, beforeW: parseFloat(getComputedStyle(chip, '::before').width), r: R(chip) },
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    notice: notice && { text: notice.textContent, cls: notice.className, role: notice.getAttribute('role'), afterH1: notice.previousElementSibling === h1,
      link: link && { href: link.getAttribute('href'), text: link.textContent, r: R(link), mt: lcs.marginTop, pt: lcs.paddingTop } },
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.dir,
    orderLinks: qa('.account-dashboard__order-links a').map((a) => R(a).h), guestLinks: qa('.account-dashboard__section-head > a').map((a) => R(a).h), termsLinks: qa('.customer-account__terms a').map((a) => { const r = R(a); return Math.min(r.w, r.h) }),
    // where the WORDS of the register sentence are (the text of each link, not its padded box) and how tall the sentence is
    termsText: qa('.customer-account__terms a').map((a) => { const g = document.createRange(); g.selectNodeContents(a); const r = g.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10] }),
    termsParaH: q('.customer-account__terms') ? Math.round(q('.customer-account__terms').getBoundingClientRect().height * 10) / 10 : null,
    sectionHeadH: q('.account-dashboard__section-head') ? Math.round(q('.account-dashboard__section-head').getBoundingClientRect().height * 10) / 10 : null,
    bdayBtn: q('.sporta-bday-panel .btn') && q('.sporta-bday-panel .btn').textContent, detailsBtn: qa('.account-dashboard__panel button[type="submit"]').map((b) => b.textContent),
  }
}
const METERS = () => [...document.querySelectorAll('.spv-pw')].map((m) => {
  const bar = m.querySelector('.spv-pw__bar > i'), track = m.querySelector('.spv-pw__bar'), txt = m.querySelector('.spv-pw__txt'), live = m.querySelector('.spv-pw__live'), prev = m.previousElementSibling
  return { for: m.getAttribute('data-for'), kind: m.getAttribute('data-kind'), txt: txt.textContent, live: live.textContent, liveRole: live.getAttribute('role'), liveAria: live.getAttribute('aria-live'), met: m.hasAttribute('data-met'),
    fill: m.style.getPropertyValue('--spv-fill'), barW: bar ? bar.getBoundingClientRect().width : null, trackW: track ? track.getBoundingClientRect().width : null, trackH: track ? track.getBoundingClientRect().height : null,
    barColor: bar ? getComputedStyle(bar).backgroundColor : null, txtMin: parseFloat(getComputedStyle(txt).minWidth), rem: parseFloat(getComputedStyle(document.documentElement).fontSize), liveW: live.getBoundingClientRect().width, after: prev ? (prev.className || prev.tagName) : null, inputH: document.getElementById(m.getAttribute('data-for')).getBoundingClientRect().height }
})
const CONTRAST = (sels) => {
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { c: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 } }
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const bgOf = (e) => { const layers = []; for (let x = e; x; x = x.parentElement) { const c = parse(getComputedStyle(x).backgroundColor); if (c && c.a > 0) layers.push(c); if (c && c.a >= 0.99) break } let base = [255, 255, 255]; for (let i = layers.length - 1; i >= 0; i--) { const L = layers[i]; base = base.map((v, k) => v * (1 - L.a) + L.c[k] * L.a) } return base }
  return sels.map((s) => { const e = document.querySelector(s); if (!e || !e.textContent.trim()) return { s, ratio: null }; const fg = parse(getComputedStyle(e).color), a = lum(fg.c), b = lum(bgOf(e)); return { s, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) } })
}

// ---------------------------------------------------------------------------------------------------------------- the scenes
// a signed-in dashboard: what is on screen the moment it appears (our own ask held back), and later
const dashScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, { ...o, signedIn: true, orders: ORDERS, settle: 0 })), p = t.p
  f.early = await p.evaluate(FACTS)
  if (o.slowMe) { t.F.release = true; await p.waitForSelector('.spv, .spv-chip', { timeout: 8000 }) }
  else await p.waitForTimeout(900)
  await p.waitForTimeout(350)
  f.late = await p.evaluate(FACTS)
  f.contrast = await p.evaluate(CONTRAST, ['.spv__title', '.spv__text', '.spv__btn', '.spv-chip', '.account-dashboard__order-links a'])
  f.me = t.F.calls.filter((c) => c.rt === 'me')
  if (o.frames) f.frames = await p.evaluate(() => window.__frames || [])
})
// the banner's button, pressed: what the server was asked and what the page says
const resendScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, { ...o, signedIn: true, orders: ORDERS })), p = t.p
  await p.waitForSelector('.spv__btn')
  f.before = await p.evaluate(FACTS)
  await p.locator('.spv__btn').click()
  if (o.twice) await p.locator('.spv__btn').click({ force: true })
  await p.waitForFunction(() => document.querySelector('.spv__status') ? document.querySelector('.spv__status').textContent.length > 0 : !document.querySelector('.spv'), null, { timeout: 8000 }).catch(() => {})
  await p.waitForTimeout(500)
  f.after = await p.evaluate(FACTS)
  f.posts = t.F.calls.filter((c) => c.rt === 'verify_resend')
  if (o.again) { await p.locator('.spv__btn').click({ force: true }).catch(() => {}); await p.waitForTimeout(500); f.posts2 = t.F.calls.filter((c) => c.rt === 'verify_resend') }
})
const noticeScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, { ...o, waitFor: o.signedIn ? '.account-dashboard' : '.customer-account form' })), p = t.p
  await p.waitForTimeout(500)
  f.facts = await p.evaluate(FACTS)
})
// the register form, typed in steps; the sign-in form; the switch between them
const typeScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, o)), p = t.p, box = p.locator('#customer-password')
  f.hint = await p.locator('#customer-password-hint').textContent()
  f.m = {}
  for (const [k, v] of Object.entries(o.steps)) { await box.fill(v); await p.waitForTimeout(250); f.m[k] = await p.evaluate(METERS) }
  f.facts = await p.evaluate(FACTS); f.hintAfter = await p.locator('#customer-password-hint').textContent().catch(() => null)
  f.inputBox = await box.evaluate((e) => { const b = e.getBoundingClientRect(); return { h: b.height, w: b.width } })
  f.secret = o.secret || null
})
const loginScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, { ...o, path: '/account?mode=login' })), p = t.p
  await p.locator('#customer-password').fill('Sporta2026!abc'); await p.waitForTimeout(300)
  f.login = await p.evaluate(METERS)
  f.autocomplete = await p.locator('#customer-password').getAttribute('autocomplete')
  // the switch to "Quick registration" brings the meter, the switch back takes it away
  await p.locator('.customer-account__switch button').click(); await p.waitForSelector('#customer-name'); await p.waitForTimeout(400)
  f.register = await p.evaluate(METERS)
  await p.locator('.customer-account__switch button').click(); await p.waitForSelector('#customer-name', { state: 'detached' }); await p.waitForTimeout(400)
  f.back = await p.evaluate(METERS)
})
const resetScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, { ...o, path: '/account?mode=reset#token=' + 'a'.repeat(64), waitFor: '#customer-new-password' })), p = t.p
  f.empty = await p.evaluate(METERS)
  await p.locator('#customer-new-password').fill('Sporta2026!ab'); await p.locator('#customer-confirm-password').fill('Sporta2026'); await p.waitForTimeout(300)
  f.differ = await p.evaluate(METERS)
  await p.locator('#customer-confirm-password').fill('Sporta2026!ab'); await p.waitForTimeout(300)
  f.same = await p.evaluate(METERS)
  await p.locator('#customer-new-password').fill('Sporta2026!abc'); await p.waitForTimeout(300)
  f.changed = await p.evaluate(METERS)
})
const changeScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, { ...o, signedIn: true, orders: ORDERS })), p = t.p
  await p.locator('#customer-new-password').fill('Sporta2026!ab'); await p.waitForTimeout(300)
  f.meters = await p.evaluate(METERS)
  f.current = await p.evaluate(() => ({ has: !!document.getElementById('customer-current-password'), meter: !!document.querySelector('.spv-pw[data-for="customer-current-password"]') }))
})
// sign out, sign in as someone else, register: the nodes follow the session
const cycleScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, { ...o, signedIn: true, orders: ORDERS, loginAs: USER({ name: 'Omar', email: 'omar@example.com', email_verified: true }) })), p = t.p
  await p.waitForSelector('.spv')
  f.first = await p.evaluate(FACTS)
  await p.locator('.account-dashboard__links .customer-account__link').click()
  await p.waitForSelector('#customer-email'); await p.waitForTimeout(500)
  f.out = await p.evaluate(FACTS)
  await p.locator('.customer-account__switch button').click(); await p.waitForTimeout(500)
  await p.locator('#customer-email').fill('omar@example.com'); await p.locator('#customer-password').fill('Sporta2026!abc')
  await p.locator('.customer-account__submit').click()
  await p.waitForSelector('.account-dashboard'); await p.waitForSelector('.spv-chip', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(400)
  f.second = await p.evaluate(FACTS)
  f.meCalls = t.F.calls.filter((c) => c.rt === 'me').length
})
const signupScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, o)), p = t.p
  const secret = 'Sporta2026!ab-zz'
  await p.locator('#customer-name').fill('Sara Al-Ahmad'); await p.locator('#customer-email').fill(EMAIL); await p.locator('#customer-password').fill(secret)
  await p.waitForTimeout(300)
  f.typed = await p.evaluate(METERS)
  await p.locator('.customer-account__submit').click()
  await p.waitForSelector('.account-dashboard'); await p.waitForSelector('.spv', { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(400)
  f.facts = await p.evaluate(FACTS)
  f.leak = t.reqs.filter((q) => q.body && q.body.includes(secret)).map((q) => q.url)
  f.leakCalls = t.F.calls.filter((c) => c.raw && c.raw.includes(secret)).map((c) => c.rt)
})
const otherScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, { ...o, path: o.path, signedIn: true, waitFor: 'main' })), p = t.p
  await p.waitForTimeout(700)
  f.facts = await p.evaluate(FACTS)
  f.guard = await p.evaluate(() => window.__sportaAccount1120 === 1)
  f.customerCalls = t.reqs.filter((q) => /customer\.php/.test(q.url)).length
})
const langScene = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, { ...o, signedIn: true, orders: ORDERS })), p = t.p
  await p.waitForSelector('.spv')
  f.en = await p.evaluate(FACTS)
  await p.evaluate(() => { document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl' }); await p.waitForTimeout(500)
  f.ar = await p.evaluate(FACTS)
  await p.evaluate(() => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr' }); await p.waitForTimeout(500)
  f.en2 = await p.evaluate(FACTS)
})
const registerPage = scene(async (srv, f, o) => {
  const t = (f.t = await open(srv, o)), p = t.p
  await p.locator('#customer-password').fill('abc'); await p.waitForTimeout(250)
  f.facts = await p.evaluate(FACTS); f.m = await p.evaluate(METERS)
  f.contrast = await p.evaluate(CONTRAST, ['.spv-pw__txt', '.customer-account__terms a'])
})

// ---------------------------------------------------------------------------------------------------------------- the checks
const CK = {
  // the banner of an unverified address
  banner: (f, lang) => { const b = f.late.banner, w = W[lang]; return !!b && f.late.counts.banners === 1 && b.title === w.title && b.text === w.text(EMAIL) && b.v.dir === 'ltr' && b.v.text === EMAIL && b.btn.text === w.btn && b.btn.tag === 'BUTTON' && b.btn.type === 'button' && b.statusRole === 'status' && b.statusLive === 'polite' && b.status === '' && b.afterWelcome && b.beforeGrid && f.late.counts.chips === 0 },
  // the page's root font size follows the window (1rem is 16px on a phone, 16.8px at 1280): sizes are asked in rem
  bannerLook: (f) => { const b = f.late.banner, rem = f.late.rem; return !!b && b.css.display === 'grid' && Math.abs(b.css.beforeW - 1.25 * rem) < 0.6 && Math.abs(b.css.mb - 1.5 * rem) < 0.6 && Math.abs(b.gap - 1.5 * rem) <= 1 },
  button: (f) => { const b = f.late.banner.btn, rem = f.late.rem; return b.r.h >= 43.5 && b.r.w >= 43.5 && b.display === 'inline-flex' && b.border === '1px' && Math.abs(b.radius - 0.75 * rem) < 0.6 },
  chip: (f, lang) => { const c = f.late.chip; return !!c && f.late.counts.chips === 1 && f.late.counts.banners === 0 && c.text === W[lang].verified && c.afterEmail },
  chipLook: (f) => { const c = f.late.chip; return !!c && c.display === 'inline-flex' && c.radius === '999px' && c.border === '1px' && Math.abs(c.beforeW - 0.875 * f.late.rem) < 0.6 },
  quiet: (f) => f.early.counts.banners === 0 && f.early.counts.chips === 0 && f.late.counts.banners + f.late.counts.chips === 1,
  // every frame that showed the dashboard already carried the banner (unverified) or the chip (verified): the nodes were never pushed in after a paint
  sameFrame: (f, kind) => { const s = (f.frames || []).filter((x) => x.dash); return s.length > 0 && s.every((x) => (kind === 'banner' ? x.banner && !x.chip : x.chip && !x.banner)) },
  asked: (f) => f.me.length === 2 && f.me.every((c) => c.headers['x-sporta-customer'] === '1' && c.method === 'GET'),
  tap: (f) => f.late.orderLinks.length >= 3 && f.late.orderLinks.every((h) => h >= 43.5) && f.late.guestLinks.length === 1 && f.late.guestLinks.every((h) => h >= 43.5),
  contrast: (f, sels) => sels.every((s) => { const x = f.contrast.find((c) => c.s === s); return !x || x.ratio === null || x.ratio >= 4.5 }),
  sideways: (f) => f.early.scrollX <= 0 && f.late.scrollX <= 0,
  // the resend
  sent: (f, lang) => f.posts.length === 1 && f.posts[0].method === 'POST' && f.posts[0].headers['x-sporta-customer'] === '1' && /application\/json/.test(f.posts[0].headers['content-type']) && f.posts[0].raw === '{}' && f.after.banner.status === W[lang].sent(EMAIL) && f.after.banner.btn.aria === 'true' && f.after.banner.btn.text === W[lang].again,
  disabledLook: (f) => f.after.banner.btn.opacity === '0.6',
  once: (f) => f.posts.length === 1,
  text: (f, key) => !!f.after.banner && f.after.banner.status === key && f.posts.length === 1,
  already: (f, lang) => f.after.counts.banners === 0 && !!f.after.chip && f.after.chip.text === W[lang].verified,
  // notices
  notice: (f, text, link) => { const n = f.facts.notice; return !!n && n.text === text && n.role === 'status' && n.afterH1 && f.facts.counts.notices === 1 && (link ? !!n.link && n.link.href === '/account?mode=login' && n.link.r.h >= 43.5 : !n.link) },
  noNotice: (f) => f.facts.counts.notices === 0 && !f.facts.notice,
  noticeLook: (f) => !!f.facts.notice.link && f.facts.notice.link.mt === '-12px' && f.facts.notice.link.pt === '12px',
  // the meters
  count: (m, lang, n) => { const x = m && m.find((y) => y.for === 'customer-password'); return !!x && x.kind === 'new' && x.txt === (n >= 12 ? W[lang].ok : W[lang].count(n)) && x.met === (n >= 12) },
  fill: (m, n) => { const x = m && m.find((y) => y.for === 'customer-password'); return !!x && Math.abs(x.barW / x.trackW - Math.min(n, 12) / 12) < 0.02 },
  bar: (m) => { const x = m.find((y) => y.for === 'customer-password'); return !!x && x.trackH === 4 && Math.abs(x.txtMin - 7.5 * x.rem) < 0.6 && x.liveW <= 1 },
  colour: (m, met) => { const x = m.find((y) => y.for === 'customer-password'); return !!x && x.barColor === (met ? 'rgb(23, 26, 30)' : 'rgb(255, 123, 23)') },
  speaks: (m, lang, n) => { const x = m.find((y) => y.for === 'customer-password'); return !!x && x.liveRole === 'status' && x.liveAria === 'polite' && x.live === (n >= 12 ? W[lang].ok : '') },
  after: (m) => { const x = m.find((y) => y.for === 'customer-password'); return !!x && /customer-account__password/.test(x.after) },
}

// ================================================================================================================ 1. the banner and the chip
head('the e-mail verification banner (unverified) and chip (verified) on the real dashboard')
for (const [w, lang] of [[390, 'en'], [390, 'ar'], [1280, 'en'], [1280, 'ar']]) {
  const tag = `${lang} ${w}px`, f = await real('dash', dashScene, { w, lang, slowMe: 800 })
  if (f.error) note(`${tag}: ${f.error}`)
  is(holds(CK.quiet, f), `${tag}: nothing is drawn before the server has answered (our own ask held back until that is read), then exactly one of banner / chip appears`, JSON.stringify([f.early && f.early.counts, f.late && f.late.counts]))
  is(holds(CK.banner, f, lang), `${tag}: the banner under the welcome card: title, the line with the address in a left-to-right span, "${W[lang].btn}", an empty polite status line`, JSON.stringify(f.late && f.late.banner).slice(0, 300))
  is(holds(CK.bannerLook, f) && holds(CK.button, f), `${tag}: a grid with the 20px envelope and 24px above the two columns; the button is 44px, 1px line, 12px corners`, JSON.stringify(f.late && f.late.banner && [f.late.banner.css, f.late.banner.btn.r, f.late.banner.btn.border, f.late.banner.btn.radius]))
  is(holds(CK.asked, f), `${tag}: \`me\` is asked once by the block (the page asked once), GET, with the compiled client's X-Sporta-Customer header`, JSON.stringify((f.me || []).map((c) => [c.method, c.headers['x-sporta-customer']])))
  is(holds(CK.tap, f), `${tag}: the order cards' links (Track order, View invoice, Return or exchange) and the "Track a guest order" link are 44px tall`, JSON.stringify(f.late && [f.late.orderLinks, f.late.guestLinks]))
  is(holds(CK.sideways, f) && f.errs.length === 0, `${tag}: no sideways scroll, no page error`, `${f.late && f.late.scrollX} ${f.errs.join(' | ')}`)
}
for (const [w, lang] of [[390, 'en'], [390, 'ar']]) {
  const tag = `${lang} ${w}px verified`, f = await real('dash-ok', dashScene, { w, lang, user: { email_verified: true } })
  is(holds(CK.chip, f, lang) && holds(CK.chipLook, f), `${tag}: no banner; the "${W[lang].verified}" chip under the address (a 999px pill, 1px line, 14px check)`, JSON.stringify(f.late && [f.late.counts, f.late.chip]))
}
for (const [label, user, kind] of [['unverified', {}, 'banner'], ['verified', { email_verified: true }, 'chip']]) {
  // the block asks `me` before the compiled page has drawn the dashboard (measured: asked after the paint the banner moved the orders
  // down by its own height, layout shift 0.056 -> 0.196 on a phone): the page's own answer is held until ours is in, and no frame may
  // show the dashboard without the node
  const f = await real('dash-frames', dashScene, { w: 390, lang: 'en', user, holdPageMe: true, frames: true })
  is(!f.error && holds(CK.sameFrame, f, kind) && holds(CK.asked, f), `${label}: the ${kind} is already there in the first frame that shows the dashboard (asked early, two reads of \`me\` in all)`, JSON.stringify(f.frames && f.frames.slice(0, 8)) + (f.error || ''))
}
{
  // a `me` answer that is about ANOTHER address changes nothing (the customer signed in elsewhere meanwhile)
  const f = await real('dash-other', dashScene, { w: 390, lang: 'en', meBody: () => ({ name: 'Omar', email: 'omar@example.com', phone: '', email_verified: false }) })
  is(!f.error && f.late.counts.banners === 0 && f.late.counts.chips === 0, 'an answer about another address draws nothing', JSON.stringify(f.late && f.late.counts) + (f.error || ''))
}
{
  // dark theme and a 320px phone with a very long address: AA contrast, no sideways scroll
  for (const [theme, lang, w, long] of [['dark', 'en', 390, false], ['dark', 'ar', 390, false], ['light', 'ar', 320, true], ['dark', 'en', 320, true]]) {
    const f = await real('dash-theme', dashScene, { w, lang, theme, user: long ? { email: 'a-very-long-address-for-a-narrow-phone@an-example-company-name.example.com', email_verified: false } : {} })
    const tag = `${lang} ${w}px ${theme}${long ? ' long address' : ''}`
    is(holds(CK.contrast, f, ['.spv__title', '.spv__text', '.spv__btn', '.account-dashboard__order-links a']), `${tag}: banner title, line, button and the order links read at 4.5:1 or more`, JSON.stringify(f.contrast && f.contrast.map((c) => [c.s, c.ratio && +c.ratio.toFixed(2)])))
    is(holds(CK.sideways, f) && f.errs.length === 0, `${tag}: no sideways scroll`, `${f.late && f.late.scrollX} ${f.error || ''}`)
  }
  const f = await real('dash-theme-ok', dashScene, { w: 390, lang: 'en', theme: 'dark', user: { email_verified: true } })
  is(holds(CK.contrast, f, ['.spv-chip']), 'dark theme: the verified chip reads at 4.5:1 or more', JSON.stringify(f.contrast && f.contrast.map((c) => [c.s, c.ratio && +c.ratio.toFixed(2)])))
}

// ================================================================================================================ 2. the resend
head('"Resend link": one POST, the sentence for each answer')
for (const [lang, w] of [['en', 390], ['ar', 390]]) {
  const tag = `${lang} ${w}px`, f = await real('resend', resendScene, { w, lang, again: true })
  if (f.error) note(`${tag}: ${f.error}`)
  is(holds(CK.sent, f, lang), `${tag}: sent -> one POST (JSON {}, X-Sporta-Customer: 1), the address in the status, the button "${W[lang].again}" and aria-disabled`, JSON.stringify(f.after && f.after.banner && [f.after.banner.status, f.after.banner.btn.aria, f.after.banner.btn.text, f.posts && f.posts.length]))
  is(holds(CK.disabledLook, f), `${tag}: the waiting button is dimmed (opacity .6)`, f.after && f.after.banner && f.after.banner.btn.opacity)
  is(f.posts2 && f.posts2.length === 1, `${tag}: pressing it again during the minute sends nothing`, f.posts2 && f.posts2.length)
}
{
  const f = await real('resend-twice', resendScene, { w: 390, lang: 'en', twice: true })
  is(holds(CK.once, f), 'two quick presses are one request', f.posts && f.posts.length)
}
const ANSWERS = [
  ['en', 'many 780 s', (F) => ({ status: 429, body: { error: 'too_many_attempts', retry_after: 780 } }), W.en.many('13 minutes')],
  ['en', 'many 45 s', (F) => ({ status: 429, body: { error: 'too_many_attempts', retry_after: 45 } }), W.en.many('a minute')],
  ['ar', 'many 780 s', (F) => ({ status: 429, body: { error: 'too_many_attempts', retry_after: 780 } }), W.ar.many('١٣ دقيقة')],
  ['ar', 'many 120 s (the dual)', (F) => ({ status: 429, body: { error: 'too_many_attempts', retry_after: 120 } }), W.ar.many('دقيقتين')],
  ['ar', 'many 300 s (3-10)', (F) => ({ status: 429, body: { error: 'too_many_attempts', retry_after: 300 } }), W.ar.many('٥ دقائق')],
  ['ar', 'many 60 s', (F) => ({ status: 429, body: { error: 'too_many_attempts', retry_after: 60 } }), W.ar.many('دقيقة واحدة')],
  ['en', 'the mail did not go (sent: false)', (F) => ({ status: 200, body: { ok: true, sent: false } }), W.en.failed],
  ['en', '503 verification_unavailable', (F) => ({ status: 503, body: { error: 'verification_unavailable' } }), W.en.unavailable],
  ['ar', '503 verification_unavailable', (F) => ({ status: 503, body: { error: 'verification_unavailable' } }), W.ar.unavailable],
  ['en', '401 not_authenticated', (F) => ({ status: 401, body: { error: 'not_authenticated' } }), W.en.expired],
  ['en', 'no connection', () => 'abort', W.en.network],
  ['ar', 'no connection', () => 'abort', W.ar.network],
]
for (const [lang, name, resend, expect] of ANSWERS) {
  const f = await real('answer', resendScene, { w: 390, lang, resend, key: name })
  is(holds(CK.text, f, expect), `${lang}: ${name} -> "${expect}"`, JSON.stringify(f.after && f.after.banner && f.after.banner.status))
}
{
  const f = await real('already', resendScene, { w: 390, lang: 'en', resend: () => ({ status: 200, body: { ok: true, already: true } }) })
  is(holds(CK.already, f, 'en'), 'the server says `already` verified -> the banner goes and the chip comes', JSON.stringify(f.after && [f.after.counts, f.after.chip]))
}

// ================================================================================================================ 3. the ?verified notice
head('?verified=1 and ?verified=0')
for (const lang of ['en', 'ar']) {
  const w = W[lang]
  let f = await real('notice', noticeScene, { lang, path: '/account?verified=1' })
  is(holds(CK.notice, f, w.okOut, true), `${lang}, signed out, ?verified=1: "${w.okOut}" with the sign-in link (/account?mode=login, 44px), right under the title`, JSON.stringify(f.facts && f.facts.notice))
  f = await real('notice', noticeScene, { lang, path: '/account?verified=0' })
  is(holds(CK.notice, f, w.badOut, true) && /customer-account__error/.test(f.facts.notice.cls), `${lang}, signed out, ?verified=0: "${w.badOut}" in the error look`, JSON.stringify(f.facts && f.facts.notice))
}
{
  let f = await real('notice', noticeScene, { lang: 'en', path: '/account?verified=1', signedIn: true, user: { email_verified: true } })
  is(holds(CK.notice, f, W.en.okIn, false) && !!f.facts.chip && /customer-account__notice/.test(f.facts.notice.cls), 'signed in, ?verified=1: "Your email address is verified. Thank you!", no link, and the chip', JSON.stringify(f.facts && [f.facts.notice, f.facts.counts]))
  f = await real('notice', noticeScene, { lang: 'en', path: '/account?verified=0', signedIn: true })
  is(holds(CK.notice, f, W.en.badAsk, false) && f.facts.counts.banners === 1, 'signed in and not verified, ?verified=0: "...You can ask for a new one below." and the banner is there', JSON.stringify(f.facts && [f.facts.notice, f.facts.counts]))
  f = await real('notice', noticeScene, { lang: 'ar', path: '/account?verified=0', signedIn: true })
  is(holds(CK.notice, f, W.ar.badAsk, false) && f.facts.counts.banners === 1, 'the same in Arabic', JSON.stringify(f.facts && f.facts.notice))
  f = await real('notice', noticeScene, { lang: 'en', path: '/account?verified=0', signedIn: true, user: { email_verified: true } })
  is(holds(CK.notice, f, W.en.badIn, false) && f.facts.counts.banners === 0, 'signed in and already verified, ?verified=0: only "expired or already used"', JSON.stringify(f.facts && f.facts.notice))
  f = await real('notice', noticeScene, { lang: 'en', path: '/account?verified=2' })
  is(holds(CK.noNotice, f), '?verified=2 or no value: no notice', JSON.stringify(f.facts && f.facts.counts))
  f = await real('notice', noticeScene, { lang: 'en', path: '/account?verified=1' })
  is(holds(CK.noticeLook, f), 'the notice\'s sign-in link grows its hit area with padding and a matching negative margin (no line moves)', JSON.stringify(f.facts && f.facts.notice && f.facts.notice.link))
}

// ================================================================================================================ 4. the password meters
head('the password meters: register, sign in, reset, change password')
const STEPS = { empty: '', one: 'S', seven: 'Sporta7', eleven: 'Sporta2026!', twelve: 'Sporta2026!a', thirteen: 'Sporta2026!ab', emoji: '😀'.repeat(12), elevenEmoji: '😀'.repeat(11) }
for (const [w, lang] of [[390, 'en'], [390, 'ar']]) {
  const tag = `${lang} ${w}px`, f = await real('type', typeScene, { w, lang, steps: STEPS })
  if (f.error) note(`${tag}: ${f.error}`)
  const N = { empty: 0, one: 1, seven: 7, eleven: 11, twelve: 12, thirteen: 13 }
  is(Object.entries(N).every(([k, n]) => holds(CK.count, f.m[k], lang, n)), `${tag}: the count reads "${W[lang].count(7)}" ... "${W[lang].ok}" at 12 (0, 1, 7, 11 | 12, 13)`, JSON.stringify(Object.entries(N).map(([k]) => f.m && f.m[k] && f.m[k][0] && f.m[k][0].txt)))
  is(Object.entries(N).every(([k, n]) => holds(CK.fill, f.m[k], n)), `${tag}: the bar fills n/12 of its track and stops at 12`, JSON.stringify(Object.entries(N).map(([k, n]) => f.m && f.m[k] && f.m[k][0] && +(f.m[k][0].barW / f.m[k][0].trackW).toFixed(2))))
  is(holds(CK.bar, f.m.seven) && holds(CK.after, f.m.seven), `${tag}: a 4px track, the count 120px wide at least, a 1px live region; it sits right under the password box`, JSON.stringify(f.m && f.m.seven))
  is(holds(CK.colour, f.m.seven, false) && holds(CK.colour, f.m.twelve, true), `${tag}: the logo orange (#FF7B17) while short, the ink once the 12 are there`, JSON.stringify([f.m.seven && f.m.seven[0].barColor, f.m.twelve && f.m.twelve[0].barColor]))
  is(Object.entries(N).every(([k, n]) => holds(CK.speaks, f.m[k], lang, n)), `${tag}: the live region says "${W[lang].ok}" only when the 12 are there (silent before)`, JSON.stringify(Object.entries(N).map(([k]) => f.m && f.m[k] && f.m[k][0] && f.m[k][0].live)))
  is(holds(CK.count, f.m.emoji, lang, 12) && holds(CK.count, f.m.elevenEmoji, lang, 11), `${tag}: counted in code points like the compiled rule (12 emoji = long enough, 11 = 11 of 12)`, JSON.stringify([f.m.emoji && f.m.emoji[0].txt, f.m.elevenEmoji && f.m.elevenEmoji[0].txt]))
  is(f.hint === f.hintAfter && f.hint.length > 20, `${tag}: the compiled hint text is untouched`, JSON.stringify([f.hint, f.hintAfter]))
  is(f.m.empty.length === 1 && f.facts.counts.meters === 1 && f.errs.length === 0 && f.facts.scrollX <= 0, `${tag}: one meter, no sideways scroll, no page error`, JSON.stringify([f.facts && f.facts.counts, f.errs]))
}
{
  const f = await real('login', loginScene, { w: 390, lang: 'en' })
  is(f.autocomplete === 'current-password' && f.login.length === 0, 'sign-in form: the password box (current-password) gets no meter', JSON.stringify([f.autocomplete, f.login]))
  is(f.register.length === 1 && f.register[0].for === 'customer-password', 'switching to "Quick registration" brings the meter', JSON.stringify(f.register))
  is(f.back.length === 0, 'switching back to sign in takes it away', JSON.stringify(f.back))
}
for (const lang of ['en', 'ar']) {
  const w = W[lang], f = await real('reset', resetScene, { w: 390, lang })
  const row = (m, id) => m && m.find((x) => x.for === id)
  is(!!row(f.empty, 'customer-new-password') && !!row(f.empty, 'customer-confirm-password') && row(f.empty, 'customer-confirm-password').txt === '' && row(f.empty, 'customer-new-password').txt === w.count(0), `${lang}, reset form: a meter under the new password, an empty line under the confirm box`, JSON.stringify(f.empty))
  is(row(f.differ, 'customer-new-password').txt === w.ok && row(f.differ, 'customer-confirm-password').txt === w.noMatch && row(f.differ, 'customer-confirm-password').live === '', `${lang}: the confirm box says "${w.noMatch}" and says it silently`, JSON.stringify(row(f.differ, 'customer-confirm-password')))
  is(row(f.same, 'customer-confirm-password').txt === w.match && row(f.same, 'customer-confirm-password').live === w.match && row(f.same, 'customer-confirm-password').met, `${lang}: equal boxes -> "${w.match}", spoken once`, JSON.stringify(row(f.same, 'customer-confirm-password')))
  is(row(f.changed, 'customer-confirm-password').txt === w.noMatch, `${lang}: changing the NEW box re-checks the confirm box at once`, JSON.stringify(row(f.changed, 'customer-confirm-password')))
}
{
  const f = await real('change', changeScene, { w: 390, lang: 'en' })
  is(f.meters.length === 2 && f.meters.some((m) => m.for === 'customer-new-password' && m.txt === W.en.ok) && f.meters.some((m) => m.for === 'customer-confirm-password') && f.current.has && !f.current.meter, 'dashboard "Password and security": the new and confirm boxes get meters, the current password box does not', JSON.stringify([f.meters.map((m) => m.for), f.current]))
}
{
  const f = await real('signup', signupScene, { w: 390, lang: 'en' })
  is(f.leak.length === 1 && /customer\.php\?r=register/.test(f.leak[0]) && f.leakCalls.length === 1, 'the typed password leaves the page only in the page\'s own register request (never in a request of ours)', JSON.stringify([f.leak, f.leakCalls]))
  is(f.typed.length === 1 && f.typed[0].txt === W.en.ok, 'register end to end: the meter said "Long enough" for the password typed', JSON.stringify(f.typed))
  is(holds((x) => x.facts.counts.banners === 1 && x.facts.banner.v.text === EMAIL && x.facts.banner.btn.text === W.en.btn, f), 'a new account lands on the dashboard WITH the verification banner for its address', JSON.stringify(f.facts && f.facts.counts))
}
{
  const f = await real('reg-look', registerPage, { w: 390, lang: 'en' })
  is(holds(CK.contrast, { contrast: f.contrast }, ['.spv-pw__txt']) && f.contrast.every((c) => c.ratio === null || c.ratio >= 4.5), 'the meter text reads at 4.5:1 or more on the card (light)', JSON.stringify(f.contrast && f.contrast.map((c) => [c.s, c.ratio && +c.ratio.toFixed(2)])))
  is(f.facts.termsLinks.length === 2 && f.facts.termsLinks.every((h) => h >= 43.5), 'register: the Terms and Privacy links inside the sentence have a 44px hit area', JSON.stringify(f.facts.termsLinks))
  const d = await real('reg-look-dark', registerPage, { w: 390, lang: 'ar', theme: 'dark' })
  is(d.contrast.every((c) => c.ratio === null || c.ratio >= 4.5), 'the meter text reads at 4.5:1 or more on the dark card (Arabic)', JSON.stringify(d.contrast && d.contrast.map((c) => [c.s, c.ratio && +c.ratio.toFixed(2)])))
  const n = await real('reg-320', registerPage, { w: 320, lang: 'ar' })
  is(n.facts.scrollX <= 0, 'register at 320px (Arabic) with the meter: no sideways scroll', n.facts.scrollX)
}

// ================================================================================================================ 5. the page's life
head('sign out, another customer, the language, other pages')
{
  const f = await real('cycle', cycleScene, { w: 390, lang: 'en' })
  is(f.first.counts.banners === 1 && f.out.counts.banners === 0 && f.out.counts.chips === 0 && f.out.counts.notices === 0, 'sign out removes the banner (no node is left on the sign-in form)', JSON.stringify([f.first && f.first.counts, f.out && f.out.counts]))
  is(f.second.counts.chips === 1 && f.second.counts.banners === 0 && f.second.chip && f.second.chip.afterEmail && f.meCalls >= 3, 'another (verified) customer signing in starts clean: the chip, no banner, a fresh `me`', JSON.stringify([f.second && f.second.counts, f.meCalls]))
}
{
  const f = await real('lang', langScene, { w: 390, lang: 'en' })
  is(f.en.banner.title === W.en.title && f.ar.banner.title === W.ar.title && f.ar.banner.text === W.ar.text(EMAIL) && f.ar.banner.btn.text === W.ar.btn && f.en2.banner.title === W.en.title, 'the words follow <html lang> in both directions, without a second banner', JSON.stringify([f.en && f.en.banner.title, f.ar && f.ar.banner.title, f.en2 && f.en2.counts]))
}
for (const path of ['/shop', '/']) {
  const f = await real('other', otherScene, { w: 390, lang: 'en', path })
  is(f.facts.counts.banners + f.facts.counts.chips + f.facts.counts.notices + f.facts.counts.meters === 0 && f.customerCalls === 0 && f.guard === true, `${path}: no node and no customer request from the block (it only stands guard)`, JSON.stringify([f.facts && f.facts.counts, f.customerCalls, f.guard]))
}
{
  const f = await real('dash', dashScene, { w: 390, lang: 'en', slowMe: 800 })
  is(f.late.bdayBtn === W.en.save && !f.late.detailsBtn.includes(W.en.save) && f.late.detailsBtn.includes(W.en.saveDetails), `the birthday panel's button says "${W.en.save}", the details form's says "${W.en.saveDetails}"`, JSON.stringify([f.late.bdayBtn, f.late.detailsBtn]))
  const a = await real('dash', dashScene, { w: 390, lang: 'ar', slowMe: 800 })
  is(a.late.bdayBtn === W.ar.save && a.late.detailsBtn.includes(W.ar.saveDetails), `Arabic: "${W.ar.save}" and "${W.ar.saveDetails}"`, JSON.stringify([a.late.bdayBtn, a.late.detailsBtn]))
}

// ================================================================================================================ 6. the source
head('the block as written')
{
  const noSink = !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage|sessionStorage|console\./.test(BLOCK)
  is(BLOCK.length > 4000 && noSink, 'the block writes with DOM calls and textContent only; it uses no storage and no console', String(BLOCK.length))
  is(/X-Sporta-Customer/.test(BLOCK) && /credentials: 'include'/.test(BLOCK) && /cache: 'no-store'/.test(BLOCK) && /'\{\}'/.test(BLOCK), 'its requests carry the compiled client\'s headers, include the cookie and are never cached; the resend body is {}')
  is(B0 > 0 && B1 > B0 && /\;\(function \(\) \{\n  'use strict'\n  try \{/.test(BLOCK) && /\} catch \(e\) \{\}\n\}\)\(\)\n$/.test(BLOCK), 'the block is one guarded IIFE (use strict, one try / catch; test:js-guard holds the whole file to it)')
  is(!/\bvalue\b[^\n]*(fetch|send|post|push)/i.test(BLOCK.replace(/Array\.from\(input\.value/g, '')), 'the password boxes\' values are only counted and compared, never sent')
  is([1, 2, 3, 4, 5, 6, 7].every((n) => CSS.includes(`/* [av-${n}]`)) && CSS.includes('/* ==== end ACCOUNT 1120 */'), 'the stylesheet section carries its seven numbered rules and its end marker')
}

// ================================================================================================================ 7. mutants
head('mutants: with one rule cut, the matching check fails')
const cutCss = (n) => {
  const a = CSS.indexOf(`/* [av-${n}]`), next = [CSS.indexOf(`/* [av-${n + 1}]`, a), CSS.indexOf('/* ==== end ACCOUNT 1120 */', a)].filter((x) => x > 0)
  return a < 0 ? CSS : CSS.slice(0, a) + CSS.slice(Math.min(...next))
}
const subst = (text, from, to) => (text.includes(from) ? text.replace(from, to) : text)
// every cut of the script is made INSIDE this block: sporta-features.js has other blocks with identical lines (observers, helpers), and
// a cut of the first match in the whole file would break one of those and leave this block whole. Pairs [from, to] apply in turn.
const JSM = (...pairs) => {
  const list = Array.isArray(pairs[0]) ? pairs : [pairs]
  const cut = list.reduce((t, [from, to]) => subst(t, from, to), BLOCK)
  return { file: FEAT_F, text: FEAT.slice(0, B0) + cut + FEAT.slice(B1), changed: list.every(([from]) => BLOCK.includes(from)) && cut !== BLOCK }
}
const CSSM = (n) => ({ file: CSS_F, text: cutCss(n), changed: cutCss(n) !== CSS })
const BDM = (from, to) => ({ file: BDAY_F, text: subst(BDAY, from, to), changed: BDAY.includes(from) })
const asOpts = (m) => (m.file.endsWith('.css') ? { css: { [m.file]: m.text } } : { js: { [m.file]: m.text } })
const DASH = { w: 390, lang: 'en', slowMe: 800 }
const MUT = [
  // [label, the cut, the scene, its options, the check]
  ['av-1 the banner grid', CSSM(1), dashScene, DASH, CK.bannerLook],
  ['av-2 the button', CSSM(2), dashScene, DASH, (f) => CK.button(f)],
  ['av-3 the chip', CSSM(3), dashScene, { w: 390, lang: 'en', user: { email_verified: true } }, (f) => CK.chipLook(f)],
  ['av-4 the notice link', CSSM(4), noticeScene, { lang: 'en', path: '/account?verified=1' }, CK.noticeLook],
  ['av-5 the meter bar', CSSM(5), typeScene, { w: 390, lang: 'en', steps: { seven: 'Sporta7', twelve: 'Sporta2026!a' } }, (f) => holds(CK.fill, f.m.seven, 7) && holds(CK.bar, f.m.seven) && holds(CK.colour, f.m.twelve, true)],
  ['av-6 the tap targets', CSSM(6), dashScene, DASH, CK.tap],
  ['av-6 the Terms and Privacy hit area', CSSM(6), registerPage, { w: 390, lang: 'en' }, (f) => f.facts.termsLinks.length === 2 && f.facts.termsLinks.every((h) => h >= 43.5)],
  ['av-7 the dark banner', CSSM(7), dashScene, { w: 390, lang: 'en', theme: 'dark' }, (f) => CK.contrast(f, ['.spv__title', '.spv__text', '.spv__btn'])],
  ['av-7 the dark chip', CSSM(7), dashScene, { w: 390, lang: 'en', theme: 'dark', user: { email_verified: true } }, (f) => CK.contrast(f, ['.spv-chip'])],
  ['script: `me` is never asked', JSM(['    preAsk()\n    var card', '    var card'], ['      else ask(email)\n', '\n']), dashScene, DASH, (f) => CK.banner(f, 'en')],
  ['script: no early ask (the banner is asked for after the dashboard is painted)', JSM('    preAsk()\n    var card', '    var card'), dashScene, { w: 390, lang: 'en', holdPageMe: true, frames: true }, (f) => CK.sameFrame(f, 'banner')],
  ['script: the early answer is believed for any address', JSM('if (early && early.email === email.toLowerCase() && Date.now() - early.at < 60000)', 'if (early && Date.now() - early.at < 60000)'), dashScene, { w: 390, lang: 'en', meBody: () => ({ name: 'Omar', email: 'omar@example.com', phone: '', email_verified: false }) }, (f) => f.late.counts.banners === 0 && f.late.counts.chips === 0],
  ['script: any `me` answer is believed (no address match)', JSM("if (String(d.email || '').toLowerCase() !== email.toLowerCase()) return   // another customer signed in meanwhile", ''), dashScene, { w: 390, lang: 'en', meBody: () => ({ name: 'Omar', email: 'omar@example.com', phone: '', email_verified: false }) }, (f) => f.late.counts.banners === 0 && f.late.counts.chips === 0],
  ['script: nothing waits for the answer (the banner is drawn for "unknown")', JSM('if (S.verified === false) {', 'if (S.verified !== true) {'), dashScene, DASH, CK.quiet],
  ['script: no guard against a second press', JSM("if (S.send === 'sending' || S.cool) return", ''), resendScene, { w: 390, lang: 'en', twice: true }, CK.once],
  ['script: no minute of waiting after a send', JSM("else if (j.sent === true) { S.send = 'sent'; hold(COOL) }", "else if (j.sent === true) { S.send = 'sent' }"), resendScene, { w: 390, lang: 'en' }, (f) => CK.sent(f, 'en')],
  ['script: `already` is not understood', JSM("if (j.already === true) { S.verified = true; S.send = '' }", "if (false) { S.verified = true; S.send = '' }"), resendScene, { w: 390, lang: 'en', resend: () => ({ status: 200, body: { ok: true, already: true } }) }, (f) => CK.already(f, 'en')],
  ['script: the rate limit is not told', JSM("else if (x.status === 429) { S.send = 'many';", "else if (x.status === 0) { S.send = 'many';"), resendScene, { w: 390, lang: 'en', resend: () => ({ status: 429, body: { error: 'too_many_attempts', retry_after: 780 } }), key: 'm1' }, (f) => CK.text(f, W.en.many('13 minutes'))],
  ['script: no Arabic dual for two minutes', JSM("if (m === 2) return 'دقيقتين'", ''), resendScene, { w: 390, lang: 'ar', resend: () => ({ status: 429, body: { error: 'too_many_attempts', retry_after: 120 } }), key: 'm2' }, (f) => CK.text(f, W.ar.many('دقيقتين'))],
  ['script: a refused session is not told', JSM("else if (x.status === 401 || j.error === 'not_authenticated') S.send = 'expired'", ''), resendScene, { w: 390, lang: 'en', resend: () => ({ status: 401, body: { error: 'not_authenticated' } }), key: 'm3' }, (f) => CK.text(f, W.en.expired)],
  ['script: the ?verified notice is never drawn', JSM("notice(card, !!card.querySelector('.account-dashboard'))", ''), noticeScene, { lang: 'en', path: '/account?verified=1' }, (f) => CK.notice(f, W.en.okOut, true)],
  ['script: a meter on the sign-in form too', JSM("return input.id === 'customer-password' && input.getAttribute('autocomplete') !== 'new-password' ? '' : 'new'", "return 'new'"), loginScene, { w: 390, lang: 'en' }, (f) => f.login.length === 0],
  ['script: characters counted in UTF-16 units, not code points', JSM("Array.from(input.value || '').length", "(input.value || '').length"), typeScene, { w: 390, lang: 'en', steps: { emoji: '😀'.repeat(12), elevenEmoji: '😀'.repeat(11) } }, (f) => holds(CK.count, f.m.emoji, 'en', 12) && holds(CK.count, f.m.elevenEmoji, 'en', 11)],
  ['script: "Long enough" is spoken all the time', JSM("var announce = met ? words : ''", 'var announce = words'), typeScene, { w: 390, lang: 'en', steps: { seven: 'Sporta7', twelve: 'Sporta2026!a' } }, (f) => holds(CK.speaks, f.m.seven, 'en', 7)],
  ['script: the confirm box always matches', JSM('met = !!other && input.value === other.value', 'met = true'), resetScene, { w: 390, lang: 'en' }, (f) => f.differ && f.differ.find((x) => x.for === 'customer-confirm-password').txt === W.en.noMatch],
  ['script: typing does not update the meter', JSM("document.addEventListener('input', onInput, true)", ''), typeScene, { w: 390, lang: 'en', steps: { seven: 'Sporta7' } }, (f) => holds(CK.count, f.m.seven, 'en', 7)],
  ['birthday.js: the button is plain "Save"', BDM("save: 'Save birthday'", "save: 'Save'"), dashScene, DASH, (f) => f.late.bdayBtn === W.en.save],
]
for (const [label, m, sc, o, check] of MUT) {
  if (!m.changed) { is(false, `mutant "${label}": the text to cut was found`); continue }
  const good = await run(sc, {}, o)
  is(holds(check, good), `mutant "${label}": the check passes on the real files`, good.error || '')
  const bad = await run(sc, asOpts(m), o)
  is(!holds(check, bad), `mutant "${label}": and goes red with it cut`, bad.error || '')
}
// the hit-area rules take no room: with [av-6] cut the words of the register sentence, its height and the orders header are where they were
for (const lang of ['en', 'ar']) {
  const on = await real('reg-look', registerPage, { w: 390, lang }), off = await run(registerPage, asOpts({ file: CSS_F, text: cutCss(6) }), { w: 390, lang })
  is(!on.error && !off.error && on.facts.termsText.length === 2 && JSON.stringify(on.facts.termsText) === JSON.stringify(off.facts.termsText) && on.facts.termsParaH === off.facts.termsParaH && on.facts.termsParaH > 0,
    `${lang}: the Terms and Privacy hit area moves no word and no line (the text positions and the sentence's height equal the ones with the rule cut)`,
    JSON.stringify([on.facts && [on.facts.termsText, on.facts.termsParaH], off.facts && [off.facts.termsText, off.facts.termsParaH], on.error, off.error]))
}
{
  const hd = async (cut) => { const f = await run(dashScene, cut ? asOpts({ file: CSS_F, text: cutCss(6) }) : {}, { w: 390, lang: 'en' }); return f }
  const on = await hd(false), off = await hd(true)
  const sec = (f) => f.late && f.late.sectionHeadH
  is(!on.error && !off.error && sec(on) > 0 && sec(on) === sec(off), 'the "Track a guest order" hit area moves nothing: the orders header is as tall as with the rule cut', JSON.stringify([sec(on), sec(off), on.error, off.error]))
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
