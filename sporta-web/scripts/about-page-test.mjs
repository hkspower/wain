// The About page (/about): one scale for its numbers, and brand names that come live from the backend.
//
//   npm run test:about-page      (rig-free: a fixture of the LIVE markup, the live rules, the REAL add-on files)
//
// Files under test (the live storefront is a compiled build, so these are the only way to change it):
//   public/sporta-home-trim.css   the "About page" section at the end: indices, Arabic-Indic digit faces, tracking
//   public/sporta-features.js     section 4 of the brands block: the brand-name run in the lead, the "Brands worth
//                                 training in" card, the FAQ answer, and the FAQPage JSON-LD
// Fixture: scripts/fixtures/about-page.mjs (markup, ld+json, rules and @font-face dumped from the live site).
// /api/api.php?r=brands is answered by a route handler that behaves like the PHP: shown brands with a listed
// product only, ordered by sort then name_en.
//
// NUMBERS, at 320 360 390 768 1024 1280 px in Arabic (RTL) and English (LTR):
//   - the four indices are the size and weight of the card titles, tabular and equally wide
//   - an Arabic-Indic figure is as tall as the alef beside it (live: 0.80-0.93), in the titles and in the sentences
//   - the English titles have no negative tracking
//   - line boxes of every title and sentence are what they were; each card moves 1px and the page 4px at most (the
//     index grows 12 -> 16px), nothing overflows sideways,
//     the phone and "1 KWD" stay on one line
//   - nothing outside the About page changes (a Terms-like .editorial-page page is untouched), and the new CSS
//     sets no colour or background (so the storefront's light and dark themes stay in charge)
// BRANDS, with 7, 3, 1 and 0 brands, API failure, SPORTA first/last, hidden and empty brands left out by the API:
//   exact text of the three sentences in both languages, only the brand-name run differs from the live text,
//   JSON-LD valid and equal to the visible answer, idempotent (the script twice), survives React re-rendering the
//   nodes (text only, whole section, language toggle, JSON-LD rewrite) with no mutation storm, one request, only
//   on /about, the static text is on the page before the API answers.
// MUTATIONS: the number checks fail without the CSS; the brand checks fail without the JS.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page as fixturePage, MARKUP, LD_ROUTE, LD_STATIC } from './fixtures/about-page.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public')
const CSS = readFileSync(join(PUB, 'sporta-home-trim.css'), 'utf8')
const JS = readFileSync(join(PUB, 'sporta-features.js'), 'utf8')
const ORIGIN = 'http://sporta.test'

let pass = 0, fail = 0, silent = false
const is = (ok, msg, detail = '') => {
  if (ok) pass++; else fail++
  if (!silent) console.log((ok ? 'ok   ' : 'FAIL ') + msg + (!ok && detail ? '  — ' + detail : ''))
}
const head = (t) => { if (!silent) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// ----------------------------------------------------------------- the API, as the PHP answers it
// The master table has a hidden brand and one with no listed product; r=brands leaves both out.
const MASTER = [
  { slug: 'sporta', name_en: 'SPORTA', name_ar: 'سبورتا', active: 1, sort: 99, products: 4 },
  { slug: 'ahed', name_en: 'AHED', name_ar: 'عهد', active: 1, sort: 1, products: 2 },
  { slug: 'rheo', name_en: 'RHEO', name_ar: 'ريو', active: 1, sort: 2, products: 9 },
  { slug: 'vanquish', name_en: 'Vanquish', name_ar: 'فانكويش', active: 1, sort: 3, products: 5 },
  { slug: 'gymshark', name_en: 'Gymshark', name_ar: 'جيم شارك', active: 1, sort: 5, products: 6 },
  { slug: 'eyesportwear', name_en: 'Eyesportwear', name_ar: 'آي سبورت وير', active: 1, sort: 6, products: 3 },
  { slug: 'nba', name_en: 'NBA', name_ar: 'إن بي إيه', active: 1, sort: 7, products: 1 },
  { slug: 'puma', name_en: 'Puma', name_ar: 'بوما', active: 0, sort: 4, products: 8 },      // hidden by the admin
  { slug: 'ate', name_en: 'ATE', name_ar: 'إيه تي إي', active: 1, sort: 4, products: 0 },    // shown, nothing tagged
]
const api = (master) => master
  .filter((b) => b.active === 1 && b.products >= 1)
  .sort((a, b) => a.sort - b.sort || a.name_en.localeCompare(b.name_en))
  .map((b) => ({ slug: b.slug, name_en: b.name_en, name_ar: b.name_ar, has_logo: false, logo_v: 'x', products: b.products }))
const pick = (...slugs) => slugs.map((s) => MASTER.find((b) => b.slug === s))

// What each sentence must say. Built from the live text by replacing ONLY the static brand run, so "the rest is
// the live build's own" is part of the expectation and not something the code under test can bend.
const STATIC = {
  en: 'RHEO, Vanquish, ATE, Gymshark, Eyesportwear and our own SPORTA label',
  lead_ar: 'ريو، فانكويش، ATE، جيمشارك، آي سبورت وعلامتنا الخاصة سبورتا',
  card_ar: 'ريو وفانكويش وATE وجيمشارك وآي سبورت وماركتنا الخاصة سبورتا',
  faq_ar: 'ريو، فانكويش، ATE، جيمشارك، آي سبورت وماركتنا الخاصة سبورتا',
}
const live = (lang, kind) => {
  const re = { lead: /<p class="page-lead">([^<]*)<\/p>/, card: /ماركات تستحق التمرين بها<\/h3><p[^>]*>([^<]*)<\/p>|Brands worth training in<\/h3><p[^>]*>([^<]*)<\/p>/, faq: /(?:ما الماركات المتوفرة لديكم؟|Which brands do you carry\?)<\/summary><p[^>]*>([^<]*)<\/p>/ }[kind]
  const m = re.exec(MARKUP[lang]); return m[1] || m[2]
}
const withRun = (lang, kind, run) => live(lang, kind).replace(lang === 'en' ? STATIC.en : STATIC[kind + '_ar'], run)
const WANT = {
  // 7 shown brands, the API sorts SPORTA (sort 99) last
  seven: { en: 'AHED, RHEO, Vanquish, Gymshark, Eyesportwear, NBA and our own SPORTA label',
    lead: 'عهد، ريو، فانكويش، جيم شارك، آي سبورت وير، إن بي إيه وعلامتنا الخاصة سبورتا',
    // commas in the card too: with a bare "و" between all, "جيم شارك و..." cannot be told from two names
    card: 'عهد، ريو، فانكويش، جيم شارك، آي سبورت وير، إن بي إيه وماركتنا الخاصة سبورتا',
    faq: 'عهد، ريو، فانكويش، جيم شارك، آي سبورت وير، إن بي إيه وماركتنا الخاصة سبورتا' },
  // 3: a Latin name inside the Arabic text (name_ar empty → falls back to name_en)
  three: { en: 'RHEO, ATE and our own SPORTA label',
    lead: 'ريو، ATE وعلامتنا الخاصة سبورتا', card: 'ريو، ATE وماركتنا الخاصة سبورتا', faq: 'ريو، ATE وماركتنا الخاصة سبورتا' },
  one: { en: 'RHEO', lead: 'ريو', card: 'ريو', faq: 'ريو' },
  // SPORTA listed FIRST (what the live API does: sort 0): still the shop's own label, named last, never a "leading brand"
  sportaFirst: { en: 'RHEO and our own SPORTA label', lead: 'ريو وعلامتنا الخاصة سبورتا', card: 'ريو وماركتنا الخاصة سبورتا', faq: 'ريو وماركتنا الخاصة سبورتا' },
  // ... and the real list: SPORTA first of seven, SPORTA in the middle of seven: the same sentences as SPORTA last
  liveOrder: null, sportaMiddle: null,
  // SPORTA alone: the own-label wording, as before
  sportaOnly: { en: 'our own SPORTA label', lead: 'علامتنا الخاصة سبورتا', card: 'ماركتنا الخاصة سبورتا', faq: 'ماركتنا الخاصة سبورتا' },
  // no SPORTA row at all
  noOwn: { en: 'RHEO and Vanquish', lead: 'ريو وفانكويش', card: 'ريو وفانكويش', faq: 'ريو وفانكويش' },
}
WANT.liveOrder = WANT.sportaMiddle = WANT.seven
const withSort = (slug, sort) => MASTER.map((b) => (b.slug === slug ? { ...b, sort } : b))
const runFor = (w, lang, kind) => (lang === 'en' ? w.en : w[kind])

// ------------------------------------------------------------------------------ the browser rig
// opts: lang, width, css/js (false = served empty, for the mutation checks), brands (rows | 'fail' | 'down'),
// path (default /about), delay (ms before the API answers), master
async function open(opts = {}) {
  const o = { lang: 'ar', width: 1280, css: true, js: true, brands: api(MASTER), path: '/about', delay: 0, ...opts }
  const ctx = await browser.newContext({ viewport: { width: o.width, height: 900 }, locale: o.lang === 'ar' ? 'ar-KW' : 'en-US' })
  const state = { hits: 0, unmatched: [], errors: [], o }
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== ORIGIN) { state.unmatched.push(u.href); return route.abort() }
    if (u.pathname === o.path.split('?')[0] && route.request().resourceType() === 'document') {
      const html = fixturePage(o.lang, '<link rel="stylesheet" href="/sporta-home-trim.css"><script src="/sporta-features.js" defer></script>')
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    }
    if (u.pathname === '/sporta-home-trim.css') return route.fulfill({ status: 200, contentType: 'text/css', body: o.css ? CSS : '/* off */' })
    if (u.pathname === '/sporta-features.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: o.js ? JS : '/* off */' })
    if (u.pathname.startsWith('/fonts/')) {
      try { return route.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(join(PUB, u.pathname)) }) } catch { /* fall through */ }
    }
    if (u.pathname === '/api/api.php' && u.searchParams.get('r') === 'brands') {
      state.hits++
      if (o.delay) await sleep(o.delay)
      if (o.brands === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' })
      if (o.brands === 'down') return route.abort()
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(o.brands) })
    }
    // sporta-features.js asks for the small-copies list (2026-11-03, scripts/make-image-variants.mjs) on every storefront page; here, as on a
    // server where nobody has run the maker yet, there is none, and the block must then do nothing at all (npm run test:sizes-weight proves that).
    if (u.pathname === '/images/products/responsive/variants.txt') return route.fulfill({ status: 404, contentType: 'text/html; charset=utf-8', body: 'no' })
    state.unmatched.push(u.pathname + u.search)
    return route.fulfill({ status: 404, body: 'no' })
  })
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => state.errors.push('pageerror: ' + e.message))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) state.errors.push('console: ' + m.text()) })
  await pg.goto(ORIGIN + o.path + (o.lang === 'en' ? (o.path.includes('?') ? '&' : '?') + 'lang=en' : ''), { waitUntil: 'load' })
  return { pg, ctx, state }
}
// The three sentences + the FAQPage answer, as the visitor and a crawler read them.
const read = (pg) => pg.evaluate(() => {
  const t = (s) => { const e = document.querySelector(s); return e ? e.textContent : null }
  let ld = null, ldOk = false, ldAll = []
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    ldAll.push(s.textContent)
    if (s.textContent.includes('FAQPage')) {
      try { const j = JSON.parse(s.textContent); ldOk = true; ld = JSON.stringify(j['@graph'].find((x) => x['@type'] === 'FAQPage').mainEntity.map((q) => q.acceptedAnswer.text)) } catch { ld = 'INVALID' }
    }
  }
  const details = [...document.querySelectorAll('.faq-list > details')]
  return {
    lead: t('p.page-lead'),
    card: t('.why-card:nth-child(4) > p'),
    faq: details[4] ? details[4].querySelector('p').textContent : null,
    ld, ldOk, ldAll,
    marks: [...document.querySelectorAll('[data-sporta-brands]')].map((e) => e.tagName + ':' + e.getAttribute('data-sporta-brands')),
  }
})
const noMarks = (s) => (s == null ? s : s.replace(/[⁨⁩]/g, ''))
let WAIT = 4000                                       // shortened for the mutation run, where nothing will ever be applied
const waitApplied = (pg, n = 1) => pg.waitForFunction((k) => document.querySelectorAll('[data-sporta-brands]').length >= k, n, { timeout: WAIT }).catch(() => {})
const settle = async (pg) => { await pg.waitForLoadState('load'); await sleep(450) }

// ============================================================================ BRANDS
async function brandsGroup(o = {}) {
  for (const lang of ['ar', 'en']) {
    head(`brands, ${lang}: 7 shown brands (a hidden and an empty brand are left out by the API)`)
    {
      const { pg, ctx, state } = await open({ lang, ...o })
      await waitApplied(pg, 4); await settle(pg)
      const r = await read(pg), w = WANT.seven
      is(noMarks(r.lead) === withRun(lang, 'lead', runFor(w, lang, 'lead')), `${lang}: lead sentence`, noMarks(r.lead))
      is(noMarks(r.card) === withRun(lang, 'card', runFor(w, lang, 'card')), `${lang}: "Brands worth training in" card`, noMarks(r.card))
      is(noMarks(r.faq) === withRun(lang, 'faq', runFor(w, lang, 'faq')), `${lang}: FAQ answer for the brands question`, noMarks(r.faq))
      is(!/Puma|بوما/.test(r.lead + r.card + r.faq), `${lang}: the hidden brand is not named`)
      is(!/\bATE\b|إيه تي إي/.test(r.lead + r.card + r.faq), `${lang}: the brand with no listed product is not named`)
      const q = JSON.parse(r.ld)
      is(r.ldOk && q[4] === noMarks(withRun(lang, 'faq', runFor(w, lang, 'faq'))), `${lang}: FAQPage JSON-LD carries the same answer, plain`, q[4])
      is(JSON.stringify(q.slice(0, 4)) === JSON.stringify(JSON.parse(LD_ROUTE[lang])['@graph'][1].mainEntity.slice(0, 4).map((x) => x.acceptedAnswer.text)), `${lang}: the other four answers in the JSON-LD are untouched`)
      is(r.ldAll[0] === LD_STATIC, `${lang}: the static OnlineStore ld+json is untouched`)
      is(state.hits === 1, `${lang}: the list is fetched once`, String(state.hits))
      is(r.marks.length === 4, `${lang}: lead, card, FAQ answer and JSON-LD are marked`, r.marks.join(' '))
      is(state.errors.length === 0 && state.unmatched.length === 0, `${lang}: no page error, no unanswered request`, state.errors.concat(state.unmatched).join(' | '))
      await ctx.close()
    }
    head(`brands, ${lang}: 3, 1 and the SPORTA position`)
    for (const [name, rows] of [['three', [pick('rheo')[0], { ...MASTER.find((b) => b.slug === 'ate'), name_ar: '', products: 2, sort: 4 }, pick('sporta')[0]]],
      ['one', pick('rheo')], ['sportaFirst', [{ ...pick('sporta')[0], sort: 0 }, pick('rheo')[0]]], ['noOwn', pick('rheo', 'vanquish')],
      ['liveOrder', withSort('sporta', 0)], ['sportaMiddle', withSort('sporta', 4.5)], ['sportaOnly', pick('sporta')]]) {
      const { pg, ctx } = await open({ lang, brands: api(rows), ...o })
      await waitApplied(pg, 4); await settle(pg)
      const r = await read(pg), w = WANT[name]
      is(noMarks(r.lead) === withRun(lang, 'lead', runFor(w, lang, 'lead')), `${lang}/${name}: lead`, noMarks(r.lead))
      is(noMarks(r.card) === withRun(lang, 'card', runFor(w, lang, 'card')), `${lang}/${name}: card`, noMarks(r.card))
      is(noMarks(r.faq) === withRun(lang, 'faq', runFor(w, lang, 'faq')), `${lang}/${name}: FAQ`, noMarks(r.faq))
      is(r.ldOk && JSON.parse(r.ld)[4] === noMarks(withRun(lang, 'faq', runFor(w, lang, 'faq'))), `${lang}/${name}: JSON-LD equals the FAQ`)
      if (name === 'three') {
        // Latin name inside Arabic text is isolated; in English there is nothing to isolate.
        is(lang === 'ar' ? /⁨ATE⁩/.test(r.lead) && /⁨ATE⁩/.test(r.card) && /⁨ATE⁩/.test(r.faq) : !/[⁨⁩]/.test(r.lead + r.card + r.faq), `${lang}/three: bidi isolation only where the script differs`)
        is(!/[⁨⁩]/.test(r.ld), `${lang}/three: the JSON-LD has no bidi marks`)
      }
      await ctx.close()
    }
    head(`brands, ${lang}: nothing to say leaves the live text untouched`)
    for (const [name, brands] of [['no brands', []], ['API answers 500', 'fail'], ['API unreachable', 'down'], ['not a list', { error: 'x' }], ['rows without names', [{ slug: 'x' }, null, 7]]]) {
      const { pg, ctx, state } = await open({ lang, brands, ...o })
      await sleep(700)
      const r = await read(pg)
      is(r.lead === live(lang, 'lead') && r.card === live(lang, 'card') && r.faq === live(lang, 'faq'), `${lang}: ${name}: the three sentences are the live text`)
      is(r.ld === JSON.stringify(JSON.parse(LD_ROUTE[lang])['@graph'][1].mainEntity.map((x) => x.acceptedAnswer.text)), `${lang}: ${name}: JSON-LD unchanged`)
      is(r.marks.length === 0, `${lang}: ${name}: nothing marked`)
      is(state.errors.length === 0, `${lang}: ${name}: no page error`, state.errors.join(' | '))
      await ctx.close()
    }
  }

  head('brands: only /about, only once the page is there, never before first paint')
  {
    const { pg, ctx, state } = await open({ path: '/shop', ...o })
    await sleep(600)
    const r = await read(pg)
    is(state.hits === 0, '/shop: r=brands is not even asked by the About module (the banner needs ?brand)', String(state.hits))
    is(r.lead === live('ar', 'lead') && r.marks.length === 0, '/shop: an .editorial-page look-alike is not touched')
    await ctx.close()
    const b = await open({ path: '/about/', ...o })
    await waitApplied(b.pg, 4)
    is((await read(b.pg)).marks.length === 4, '/about/ with a trailing slash is the About page too')
    await b.ctx.close()
  }
  {
    const { pg, ctx, state } = await open({ delay: 900, ...o })
    const early = await read(pg)
    is(early.lead === live('ar', 'lead') && early.card === live('ar', 'card'), 'while the API is still answering, the page already reads the live (static) text', early.lead)
    await waitApplied(pg, 4)
    const late = await read(pg)
    is(noMarks(late.faq) === withRun('ar', 'faq', WANT.seven.faq) && state.hits === 1, 'and the live names replace it when the answer arrives')
    await ctx.close()
  }

  head('brands: idempotent, and survives React re-rendering the nodes')
  {
    const { pg, ctx, state } = await open({ lang: 'ar', ...o })
    await waitApplied(pg, 4); await settle(pg)
    const after1 = await read(pg)
    // the whole module a second time, as a double include would
    await pg.addScriptTag({ url: '/sporta-features.js' })
    await sleep(600)
    const after2 = await read(pg)
    is(after2.lead === after1.lead && after2.card === after1.card && after2.faq === after1.faq && after2.ld === after1.ld, 'the script run twice changes nothing: one replacement, not two')
    is(noMarks(after2.faq) === withRun('ar', 'faq', WANT.seven.faq), 'and the sentence is still exactly right (no doubled names)')

    // count every mutation from here on
    await pg.evaluate(() => {
      window.__m = 0
      new MutationObserver((l) => { window.__m += l.length }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true })
    })
    const m = () => pg.evaluate(() => window.__m)
    // 1. React rewrites a text node (language toggle, or a re-render with a changed string)
    await pg.evaluate(([card]) => { document.querySelector('.why-card:nth-child(4) > p').firstChild.nodeValue = card }, [live('ar', 'card')])
    await sleep(600)
    is(noMarks((await read(pg)).card) === withRun('ar', 'card', WANT.seven.card), 're-applied after React rewrites the text node')
    // 2. a new node, as a keyed list re-render creates
    await pg.evaluate(([faq]) => { const p = document.querySelector('.faq-list > details:nth-child(5) > p'); const n = p.cloneNode(false); n.textContent = faq; p.replaceWith(n) }, [live('ar', 'faq')])
    await sleep(600)
    is(noMarks((await read(pg)).faq) === withRun('ar', 'faq', WANT.seven.faq), 're-applied after React replaces the paragraph')
    // 3. the whole page, as a route change re-renders it
    const before = await m()
    await pg.evaluate(([html]) => { document.querySelector('main#main').innerHTML = html }, [MARKUP.ar])
    await sleep(600)
    const r3 = await read(pg)
    is(noMarks(r3.lead) === withRun('ar', 'lead', WANT.seven.lead) && noMarks(r3.card) === withRun('ar', 'card', WANT.seven.card) && noMarks(r3.faq) === withRun('ar', 'faq', WANT.seven.faq), 're-applied in all three sentences after the whole section is re-rendered')
    is(state.hits === 1 || state.hits === 2, 'the list is not fetched again for a re-render', String(state.hits))   // 2 = the duplicate script's own copy
    // 4. the route rewrites the FAQPage script
    await pg.evaluate(([ld]) => { document.querySelector('script[data-route]').textContent = ld }, [LD_ROUTE.ar])
    await sleep(600)
    const r4 = await read(pg)
    is(r4.ldOk && JSON.parse(r4.ld)[4] === noMarks(withRun('ar', 'faq', WANT.seven.faq)), 're-applied to the JSON-LD after the route rewrites it')
    // 5. the language toggle: <html lang> flips and React renders the English wording
    await pg.evaluate(([html, ld]) => {
      document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'
      document.querySelector('main#main').innerHTML = html
      document.querySelector('script[data-route]').textContent = ld
    }, [MARKUP.en, LD_ROUTE.en])
    await sleep(600)
    const r5 = await read(pg)
    is(r5.lead === withRun('en', 'lead', WANT.seven.en) && r5.card === withRun('en', 'card', WANT.seven.en) && r5.faq === withRun('en', 'faq', WANT.seven.en), 'toggling to English re-renders English names, localised')
    is(r5.ldOk && JSON.parse(r5.ld)[4] === withRun('en', 'faq', WANT.seven.en), 'and the JSON-LD follows')
    // no storm: after the re-render, quiet. Mutations stop growing.
    const m1 = await m(); await sleep(1000); const m2 = await m(); await sleep(1000); const m3 = await m()
    is(m1 === m2 && m2 === m3, 'no observer storm: no mutation at all in the 2 s after the last re-render', `${m1} → ${m2} → ${m3}`)
    is(m1 - before < 60, 'and the whole series of re-renders cost a bounded number of mutations', String(m1 - before))
    is(state.errors.length === 0, 'no page error through any of it', state.errors.join(' | '))
    await ctx.close()
  }
  {
    // a single module: each target's text node is written exactly once on load
    const { pg, ctx } = await open({ lang: 'en', delay: 300, ...o })
    await pg.evaluate(() => {
      window.__w = 0
      new MutationObserver((l) => { for (const r of l) if (r.type === 'characterData') window.__w++ }).observe(document, { subtree: true, characterData: true })
    })
    await waitApplied(pg, 4); await sleep(1500)
    // (the JSON-LD script is rewritten with textContent, a childList change, so it is not counted here)
    is(await pg.evaluate(() => window.__w) === 3, 'on load each of the lead, card and FAQ answer text nodes is written exactly once', String(await pg.evaluate(() => window.__w)))
    await ctx.close()
  }

  head('brands: nothing else on the page changes (DOM diff)')
  for (const lang of ['ar', 'en']) {
    const base = await open({ lang, brands: [], ...o }); await sleep(500)
    const bodyBase = await base.pg.evaluate(() => document.documentElement.outerHTML)
    await base.ctx.close()
    const { pg, ctx } = await open({ lang, ...o }); await waitApplied(pg, 4); await settle(pg)
    let html = await pg.evaluate(() => document.documentElement.outerHTML)
    html = html.replace(/ data-sporta-brands="[^"]*"/g, '')
    const w = WANT.seven
    for (const kind of ['lead', 'card', 'faq']) html = html.split(withRun(lang, kind, runFor(w, lang, kind))).join(live(lang, kind))
    // JSON-LD answer back to the live wording as well
    html = html.split(noMarks(withRun(lang, 'faq', runFor(w, lang, 'faq')))).join(live(lang, 'faq'))
    // the page's only differences are in text we replaced: <style> of the add-on, head and the rest are equal
    is(html === bodyBase, `${lang}: with the three sentences and the JSON-LD put back, the document is byte-identical to the live one`)
    if (html !== bodyBase && !silent) { let i = 0; while (html[i] === bodyBase[i]) i++; console.log('   first difference at', i, JSON.stringify(html.slice(i - 40, i + 80)), 'vs', JSON.stringify(bodyBase.slice(i - 40, i + 80))) }
    await ctx.close()
  }
}

// ============================================================================ NUMBERS
// Ink height of a string in the element's own font, via canvas (the same @font-face rules the page uses).
const INK = `(async (sel, text) => {
  const el = document.querySelector(sel)
  const cs = getComputedStyle(el)
  // measured at 400px and scaled back: canvas rounds ink bounds to whole pixels at small sizes
  const font = cs.fontStyle + ' ' + cs.fontWeight + ' 400px ' + cs.fontFamily
  await document.fonts.load(font, text)
  await document.fonts.ready
  const c = document.createElement('canvas').getContext('2d')
  c.font = font
  return c.measureText(text).actualBoundingBoxAscent * parseFloat(cs.fontSize) / 400
})`

async function numbersGroup(o = {}) {
  const WIDTHS = [320, 360, 390, 768, 1024, 1280]
  const heights = {}                                          // per lang+width: element heights WITH and WITHOUT the css
  for (const lang of ['ar', 'en']) {
    for (const width of WIDTHS) {
      head(`numbers, ${lang} ${width}px`)
      const { pg, ctx, state } = await open({ lang, width, brands: [], ...o })
      await pg.evaluate(() => document.fonts.ready); await sleep(250)
      const m = await pg.evaluate(() => {
        const rect = (e) => e.getBoundingClientRect()
        const cards = [...document.querySelectorAll('.why-card')].map((c) => {
          const i = c.querySelector('.why-card-index'), h = c.querySelector('h3')
          const si = getComputedStyle(i), sh = getComputedStyle(h)
          return { idxPx: parseFloat(si.fontSize), idxW: si.fontWeight, idxNum: si.fontVariantNumeric, idxBox: rect(i).width, idxColor: si.color,
            h3Px: parseFloat(sh.fontSize), h3Tracking: sh.letterSpacing, h3H: rect(h).height, pH: rect(c.querySelector('p')).height }
        })
        const faq = [...document.querySelectorAll('.faq-list > details > p')].map((p) => rect(p).height)
        const phone = (() => {
          const p = document.querySelector('.faq-list > details:nth-child(3) > p')
          const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); const n = w.nextNode()
          const at = n.nodeValue.indexOf('+965'); const r = document.createRange(); r.setStart(n, at); r.setEnd(n, at + 14)
          return { text: r.toString().replace(/‎/g, ''), lines: new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size }
        })()
        const h3 = document.querySelector('.why-card h3'); const kwd = (() => {
          const r = document.createRange(); r.selectNodeContents(h3); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size
        })()
        return { cards, faq, phone, h3Lines: kwd, over: document.documentElement.scrollWidth - innerWidth, rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize) }
      })
      heights[`${lang}${width}${o.css === false ? 'off' : 'on'}`] = m
      is(m.cards.every((c) => Math.abs(c.idxPx - c.h3Px) < 0.01), `${lang} ${width}: every index is exactly the size of its card title`, m.cards.map((c) => `${c.idxPx}/${c.h3Px}`).join(' '))
      is(m.cards.every((c) => c.idxW === '700'), `${lang} ${width}: every index is weight 700 (a weight Plex ships)`, m.cards.map((c) => c.idxW).join(' '))
      is(m.cards.every((c) => /tabular-nums/.test(c.idxNum) && /lining-nums/.test(c.idxNum)), `${lang} ${width}: the indices are tabular lining figures`, m.cards[0].idxNum)
      is(new Set(m.cards.map((c) => Math.round(c.idxBox * 100))).size === 1, `${lang} ${width}: 01 02 03 04 are equally wide`, m.cards.map((c) => c.idxBox).join(' '))
      is(m.cards.every((c) => c.idxColor === 'rgb(184, 67, 15)'), `${lang} ${width}: the index colour is still the brand deep orange (#B8430F)`, m.cards[0].idxColor)
      is(m.cards.every((c) => c.h3Tracking === 'normal' || parseFloat(c.h3Tracking) === 0), `${lang} ${width}: card titles have no negative tracking`, m.cards.map((c) => c.h3Tracking).join(' '))
      is(m.over <= 0, `${lang} ${width}: no sideways overflow`, String(m.over))
      is(m.phone.lines === 1 && /^\+965 2209 1914/.test(m.phone.text), `${lang} ${width}: the phone number stays on one line`, JSON.stringify(m.phone))
      // digit height against the letter beside it
      const spots = lang === 'ar'
        ? [['.why-card:nth-child(1) > h3', '٢٤', 'ا', 'card 1 title ٢٤'], ['.why-card:nth-child(1) > h3', '١', 'ا', 'card 1 title ١'],
          ['.why-card:nth-child(2) > p', '١٤', 'ا', 'card 2 sentence ١٤'], ['.faq-list > details:nth-child(1) > p', '٢٤', 'ا', 'FAQ 1 ٢٤'],
          ['.faq-list > details:nth-child(3) > p', '١٤', 'ا', 'FAQ 3 ١٤']]
        : [['.why-card:nth-child(1) > h3', '24', 'H', 'card 1 title 24'], ['.why-card:nth-child(2) > p', '14', 'H', 'card 2 sentence 14'], ['.faq-list > details:nth-child(3) > p', '14', 'H', 'FAQ 3 14']]
      const ink = {}
      for (const [sel, dg, ref, name] of spots) {
        const d = await pg.evaluate(`${INK}(${JSON.stringify(sel)}, ${JSON.stringify(dg)})`)
        const l = await pg.evaluate(`${INK}(${JSON.stringify(sel)}, ${JSON.stringify(ref)})`)
        ink[name] = d
        is(d / l >= 0.97 && d / l <= 1.03, `${lang} ${width}: ${name} is as tall as the ${lang === 'ar' ? 'alef' : 'capital'} beside it`, `${d.toFixed(2)} / ${l.toFixed(2)} = ${(d / l).toFixed(3)}`)
      }
      if (lang === 'ar') {
        // Alexandria (titles) has a taller alef than Plex (sentences) at the same font-size, so the same figure can only be
        // as tall as the letters it sits with: the gap between the two is the typefaces' own (live: digits 1.30x, now 1.19x).
        const gap = ink['card 1 title ٢٤'] / ink['FAQ 1 ٢٤']
        is(gap < 1.22, `${lang} ${width}: ٢٤ in the title is no more than the typefaces' own 1.19x its height in the FAQ (live: 1.30x)`, gap.toFixed(3))
      }
      is(state.errors.length === 0, `${lang} ${width}: no page error`, state.errors.join(' | '))
      await ctx.close()
    }
  }
  return heights
}

async function layoutStability(heightsOn) {
  head('numbers: no layout shift — every title and sentence keeps its line box')
  for (const lang of ['ar', 'en']) {
    for (const width of [320, 390, 768, 1280]) {
      const { pg, ctx } = await open({ lang, width, css: false, brands: [] })
      await pg.evaluate(() => document.fonts.ready); await sleep(250)
      const off = await pg.evaluate(() => ({
        h3: [...document.querySelectorAll('.why-card h3')].map((h) => h.getBoundingClientRect().height),
        p: [...document.querySelectorAll('.why-card p')].map((h) => h.getBoundingClientRect().height),
        faq: [...document.querySelectorAll('.faq-list > details > p')].map((h) => h.getBoundingClientRect().height),
        lead: document.querySelector('.page-lead').getBoundingClientRect().height,
        card: [...document.querySelectorAll('.why-card')].map((h) => h.getBoundingClientRect().height),
        page: document.documentElement.getBoundingClientRect().height,
      }))
      await ctx.close()
      const { pg: pg2, ctx: ctx2 } = await open({ lang, width, brands: [] })
      await pg2.evaluate(() => document.fonts.ready); await sleep(250)
      const on = await pg2.evaluate(() => ({
        h3: [...document.querySelectorAll('.why-card h3')].map((h) => h.getBoundingClientRect().height),
        p: [...document.querySelectorAll('.why-card p')].map((h) => h.getBoundingClientRect().height),
        faq: [...document.querySelectorAll('.faq-list > details > p')].map((h) => h.getBoundingClientRect().height),
        lead: document.querySelector('.page-lead').getBoundingClientRect().height,
        card: [...document.querySelectorAll('.why-card')].map((h) => h.getBoundingClientRect().height),
        page: document.documentElement.getBoundingClientRect().height,
      }))
      await ctx2.close()
      const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.5)
      is(same(off.p, on.p) && same(off.faq, on.faq) && Math.abs(off.lead - on.lead) < 0.5, `${lang} ${width}: sentences (cards, FAQ, lead) are the same height with and without the digit faces`, JSON.stringify([off.p, on.p, off.faq, on.faq]))
      // the title's tracking is the only thing allowed to change a title's wrap; it never makes one taller
      is(on.h3.every((v, i) => v <= off.h3[i] + 0.5), `${lang} ${width}: card titles are not taller than before`, JSON.stringify([off.h3, on.h3]))
      // The declared shift (the index grows from 12 to 16px): bounded, so a later rule cannot move the page by more.
      // Measured on this fixture (live markup and rules), NOT on the live page: the live before/after was not run.
      is(on.card.every((v, i) => Math.abs(v - off.card[i]) <= 1), `${lang} ${width}: each card moves by 1px at most`, JSON.stringify([off.card, on.card]))
      is(Math.abs(on.page - off.page) <= 4, `${lang} ${width}: the whole page moves by 4px at most`, `${off.page} -> ${on.page}`)
    }
  }
  void heightsOn
}

async function scopeAndColour() {
  head('numbers: scope and colour')
  // an .editorial-page that is not the About page (Terms, Privacy, Returns share the class)
  const other = `<section class="editorial-page mx-auto px-4 py-16"><h1 class="page-heading mb-5 font-black">الشروط</h1><p class="page-lead">لديك ١٤ يومًا.</p><div class="legal"><h3 class="font-bold">١. من نحن</h3><p>التوصيل خلال ٢٤ ساعة</p></div></section>`
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    if (u.pathname === '/terms') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixturePage('ar', '<link rel="stylesheet" href="/sporta-home-trim.css">').replace(MARKUP.ar, other) })
    if (u.pathname === '/sporta-home-trim.css') return route.fulfill({ status: 200, contentType: 'text/css', body: CSS })
    if (u.pathname.startsWith('/fonts/')) return route.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(join(PUB, u.pathname)) })
    return route.fulfill({ status: 404, body: '' })
  })
  const pg = await ctx.newPage()
  await pg.goto(ORIGIN + '/terms'); await pg.evaluate(() => document.fonts.ready)
  const t = await pg.evaluate(() => ({ p: getComputedStyle(document.querySelector('.legal p')).fontFamily, h3: getComputedStyle(document.querySelector('.legal h3')).fontFamily, lead: getComputedStyle(document.querySelector('.page-lead')).fontFamily, tr: getComputedStyle(document.querySelector('.legal h3')).letterSpacing }))
  is(!/About Digits/.test(t.p + t.h3 + t.lead), 'a Terms-like .editorial-page has none of the About digit faces', JSON.stringify(t))
  await ctx.close()

  const section = CSS.slice(CSS.indexOf('/* About page: one scale'))
  const decls = section.replace(/\/\*[\s\S]*?\*\//g, '')
  is(section.length > 500 && !/(^|[;{\s])(color|background(-color|-image)?|border-color|fill|stroke)\s*:/.test(decls), 'the About section declares no colour, background, border colour, fill or stroke (themes stay in charge)')
  is(!/!important/.test(decls), 'and no !important')
  is(!/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(decls), 'no colour literal at all in the About section')
}

// ==================================================================================== run
await brandsGroup()
const heights = await numbersGroup()
await layoutStability(heights)
await scopeAndColour()

// MUTATIONS: the same checks, with the add-on file served empty, must fail.
head('mutation: the number checks must fail without the CSS')
{
  const p0 = pass, f0 = fail
  silent = true
  await numbersGroup({ css: false })
  silent = false
  const failed = fail - f0, total = failed + (pass - p0)
  pass = p0; fail = f0                                       // those failures are the point; they are not this suite's
  is(failed >= 40, `without sporta-home-trim.css ${failed} of ${total} number checks fail`, String(failed))
}
head('mutation: the brand checks must fail without the JS')
{
  const p0 = pass, f0 = fail
  silent = true; WAIT = 300
  await brandsGroup({ js: false })
  silent = false; WAIT = 4000
  const failed = fail - f0, total = failed + (pass - p0)
  pass = p0; fail = f0
  is(failed >= 40, `without sporta-features.js ${failed} of ${total} brand checks fail`, String(failed))
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
