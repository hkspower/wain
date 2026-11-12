// The BUTTONS-1112 section of addons-src/sporta-admin-knet.css: one button system on /backends (owner, 2026-11-12, "improve
// backends buttons").
//
//   npm run test:admin-buttons     (rig-free: no sandbox, no database, no server; Chromium at /opt/pw-browsers/chromium)
//                                  ADDON_FILE=<source file> measures another SOURCE file as "on"; BUTTONS_VERBOSE=1 lists every miss
//
// WHAT IS MEASURED. Every visible button (and the photo-upload label, which is a button for the hand) of the 24 captured live
// /backends screens - scripts/fixtures/sizes-admin (13 screens, 4 editor modals) and scripts/fixtures/admin-css-full (Orders sheet,
// Returns, CRM, Support, Profiles, Theme, SEO): the real compiled markup under the real compiled rules, every add-on stylesheet the
// live index.html links in its order (scripts/lib/admin-css-full-page.mjs), the live build's real dark rules on a dark page - WITH
// the real public/sporta-admin-brands.js running on them (every /api/ call answered inside the browser: the Payments routes with the
// shapes the live admin returns, everything else 404), so the panels the add-on builds are on the page as they are live: the bulk
// photo uploader, "New product", "New promotion", the KNET identifiers, the brand tagger, the floating Save bar, and - opened from
// their entry buttons - the Database, Social and Shipping centres and SEO health. At 390x900 (touch, isMobile) and 1280x900 (mouse),
// light and dark theme (html.dark + data-theme="dark", a dark device). The add-on CSS goes through the repo's own slim build
// (scripts/build-addon-css.mjs generated()), because that is the file that ships.
//
// WHAT IS ASSERTED (each with the section, "after"; the before/after table prints the same figures without it):
//   [1] ONE primary fill per theme: every enabled primary (the accent classes, the five off-accent saves, the add-on panels'
//       --primary buttons) paints --admin-action #9a452c under white text. Before: five fills.
//   [2] the floating Save bar, enabled, wears the same accent with white text at 4.5:1 or better. Before: raw indigo #4f46e5.
//   [3] ONE secondary weight (600). Before: 600 and 700.
//   [4] ONE disabled look on the compiled buttons: not-allowed cursor (cursor-wait kept for "Push"), opacity .45.
//   [5] ONE radius (.75rem) on every boxed button that is not a pill, a tab, a picker card or a list row.
//   [6] mouse screen: every boxed control is 40px (the SIZES density), add-on panels included. Before: 40 and 46px.
//   [7] "New product" / "New promotion" / "SEO health" are the height of "Add a slide" (40px on a mouse screen) and centred on
//       their header row, not stretched to the title block (they stay after the title: see [buttons-6] for why not at its end).
//   [8] phone: every button of the shell (content, header, tab bar) is 44px or more each way. Before: the menu was 14px wide.
//   [9] (not a mutation target; must hold with and without) every enabled button shows a solid focus ring of 2px or more in both
//       themes; hovering any enabled button never changes its box; no label overflows its button; on the Payments screen every
//       button computes the same colours in the dark theme as in the light (light only, CLAUDE.md); text on a filled button is
//       4.5:1 or better.
//  [10] static: the section exists once, before SIZES (which stays the last section), every selector starts at .admin-shell or at
//       the Save bar (body > [data-sporta-savebar]), logical properties only, the served file is the build of the source.
// MUTATION CHECK: [1] to [8] run again on the source with the section cut out; each must FAIL there, or the suite fails.
import { chromium } from 'playwright'
import postcss from 'postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, addons, knetServed, ALL } from './lib/admin-css-full-page.mjs'
import { generated } from './build-addon-css.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_PATH = process.env.ADDON_FILE || join(ROOT, 'addons-src/sporta-admin-knet.css')
const SRC = readFileSync(SRC_PATH, 'utf8')
const JS = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const VERBOSE = process.env.BUTTONS_VERBOSE === '1'
const SEC_A = '/* ==== BUTTONS-1112:', SEC_END = '/* ==== end BUTTONS-1112 */', SIZES = '/* ==== SIZES:'
const a = SRC.indexOf(SEC_A), b = SRC.indexOf(SEC_END)
const SECTION = a >= 0 && b > a ? SRC.slice(a, b + SEC_END.length) : ''
const OFF_SRC = SECTION ? SRC.slice(0, a) + SRC.slice(b + SEC_END.length) : SRC

let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`)

// ------------------------------------------------------------------------------------------------------------------- [10] static
head('Static: the section')
is(SECTION.length > 0 && SRC.split(SEC_A).length === 2, 'the BUTTONS-1112 section is in the source, once')
is(a > 0 && SRC.indexOf(SIZES) > b, 'it sits before the SIZES section')
is(!SRC.slice(SRC.indexOf(SIZES) + 1).includes('\n/* ==== '), 'SIZES is still the last section of the file')
if (!process.env.ADDON_FILE) is(generated('sporta-admin-knet', SRC) === knetServed(), 'public/sporta-admin-knet.css is exactly the build of addons-src (npm run build:addon-css)')
{
  const bad = [], physical = [], dark = [], hues = []
  postcss.parse(SECTION).walkRules((r) => {
    for (const s of r.selectors) {
      const t = s.replace(/\s+/g, ' ').trim()
      if (!t.startsWith('.admin-shell') && !t.startsWith('body > [data-sporta-savebar]')) bad.push(t)
      if (/html\.dark|data-theme/.test(t)) dark.push(t)
    }
    r.walkDecls((d) => {
      if (/^(padding|margin|border)-(left|right)|^(left|right)$|^text-align$/.test(d.prop)) physical.push(d.prop)
      // every colour it sets is the accent token, white, black (for the hover mix) or transparent
      if (/color|background|outline/.test(d.prop) && d.value.replace(/var\(--admin-action, #9a452c\)|var\(--brand-bright, #ff7b17\)|#fff\b|#000\b|transparent|rgba\(15, 23, 42, \.1\)|!important|color-mix\(in srgb,|84%|[(),\s]/g, '').length) hues.push(`${d.prop}: ${d.value}`)
    })
  })
  is(!bad.length, 'every selector starts at .admin-shell or at the Save bar: nothing reaches the storefront', bad.slice(0, 3).join(' | '))
  is(!physical.length, 'logical properties only: it mirrors in Arabic', physical.join())
  is(!dark.length, 'no rule keys on the dark theme (the Payments screen stays light; the bar answers its own data-tone)', dark.join(' | '))
  is(!hues.length, 'no new colour: only the --admin-action accent (and the brand orange for the dark bar\'s ring), white and black', hues.join(' | '))
}

// ----------------------------------------------------------------------------------------------------------------- the harness
const ORIGIN = 'https://admin.test'
const SHAPE = { knet: { installed: true, env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://kpay.com.kw/kpg/PaymentHTTP.htm', response_url: 'https://www.sporta.com.kw/knet/callback.php', error_url: 'https://www.sporta.com.kw/knet/callback.php', result_page_url: 'https://www.sporta.com.kw/payment/result', has_tranportal_id: true, has_tranportal_password: true, has_resource_key: true, credentials: {} }, tpay: { installed: true, env: 'test', test_base: 'https://pgtest.cbk.com/cbkgateway', production_base: 'https://pg.cbk.com/cbkgateway', return_url: 'https://www.sporta.com.kw/pay/return', result_page_url: 'https://www.sporta.com.kw/payment/result', has_client_id: true, has_client_secret: true, has_encrp_key: false } }
// [screen, entry buttons to click] - every screen as captured, plus the add-on centres opened from their entry buttons
const SCENES = [...ALL.map((n) => [n, []]), ['settings', ['.sdb-open']], ['settings', ['.ssoc-open']], ['settings', ['.ssh-open']], ['seo', ['.ssh-open']]]
const VIEWS = [{ id: '390', w: 390, touch: true }, { id: '1280', w: 1280, touch: false }]

// The kinds, as CSS selectors (matched in the page). PRIMARY leaves out the two sub-panel saves of the KNET editor ("Save IDs",
// "Save IPs", "Save CBK connection"), which are the quiet outlined save on purpose (section 7 of the file).
const FAM = ['sab', 'sai', 'sdb', 'sfe', 'sph', 'spn', 'ssc', 'ssh', 'ssoc']
const SEL = {
  primary: `.admin-content button:is(.bg-indigo-600, .bg-emerald-600, .bg-amber-600, .crm-primary, .topbar-editor__save, .inventory-primary-button, [class~="bg-brand"], [class~="bg-brand-bright"], [class~="bg-slate-800"], .theme-editor__save, .admin-passcode__primary, .seo-editor__save, ${FAM.map((f) => `.${f}-btn--primary`).join(', ')}, .sdb-open, .ssh-open, .ssoc-open):not(:is([data-sporta-knet-ids], [data-sporta-tpay-ips], [data-sporta-cbk]) *):not([class*="__preview"] *)`,
  secondary: '.admin-content button:is(.border, .inventory-refresh, .inventory-adjust-button, .crm-refresh):not(.text-start):not(.theme-editor__scheme):not([class^="bg-indigo-"]):not([class*=" bg-indigo-"]):not(.bg-emerald-600):not(.bg-amber-600):not([class^="text-rose-"]):not([class*=" text-rose-"]):not([class^="text-red-"]):not([class*=" text-red-"])',
  addon: `.admin-content :is(${FAM.map((f) => `.${f}-btn`).join(', ')}, .sdb-open, .ssh-open, .ssoc-open)`,
  // a boxed control: a fill or an edge of its own, not a pill / tab / chip / picker card / list row / switch / icon close / upload tile
  boxed: '.admin-content button:not(.rounded-full):not(.text-start):not(.theme-editor__scheme):not(.m-row):not([class*="-tab"]):not([class*="-chip"]):not([class*="segbtn"]):not([class*="-tile"]):not(.text-slate-400):not([class~="h-11"]):not([role="switch"]):not([aria-pressed]):not([class*="__preview"] *)',
  header: '.admin-page-header > button:is([data-sporta-np-open], [data-sporta-promo-new], [data-sporta-seo-btn])',
}

function measureInPage(SEL) {
  const list = [...document.querySelectorAll('.admin-shell button, .admin-shell label.admin-product-upload-button, body > [data-sporta-savebar] button')]
  const out = []
  list.forEach((e, i) => {
    const r = e.getBoundingClientRect()
    if (!r.width || !r.height || e.closest('[class*="__preview"]') || e.closest('[hidden]')) return
    const c = getComputedStyle(e)
    if (c.visibility === 'hidden' || +c.opacity === 0) return
    const zone = e.closest('[data-sporta-savebar]') ? 'bar' : e.closest('.admin-sidebar') ? 'sidebar' : e.closest('.m-tabbar') ? 'tabbar' : e.closest('.m-header') ? 'mheader' : e.closest('.admin-content') ? 'content' : 'other'
    const kinds = Object.keys(SEL).filter((k) => e.matches('.admin-shell ' + SEL[k]))
    let bg = c.backgroundColor, n = e
    while (n && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { n = n.parentElement; bg = n ? getComputedStyle(n).backgroundColor : 'rgb(255, 255, 255)' }
    const hdr = e.closest('.admin-page-header'), hb = hdr && hdr.getBoundingClientRect(), title = hdr && hdr.querySelector('h1'), tb = title && title.parentElement.getBoundingClientRect()
    out.push({ i, zone, kinds, tag: e.tagName, cls: typeof e.className === 'string' ? e.className : '', text: (e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      h: r.height, w: r.width, l: r.left, r: r.right, t: r.top, b: r.bottom, root: parseFloat(getComputedStyle(document.documentElement).fontSize),
      bg: c.backgroundColor, under: bg, fg: c.color, fw: c.fontWeight, fs: c.fontSize, rad: parseFloat(c.borderTopLeftRadius), bw: parseFloat(c.borderTopWidth), bc: c.borderTopColor,
      op: +c.opacity, cursor: c.cursor, disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true', over: e.scrollWidth > e.clientWidth + 1 && c.overflow !== 'visible' ? true : e.scrollWidth > e.clientWidth + 2,
      hdr: hb ? { r: hb.right, l: hb.left, cy: (tb.top + tb.bottom) / 2 } : null, tone: e.closest('[data-sporta-savebar]') ? e.closest('[data-sporta-savebar]').getAttribute('data-tone') : null,
      payments: !!e.closest('.payment-settings') })
  })
  return out
}

async function run(browser, src, { deep = false } = {}) {
  const files = addons(generated('sporta-admin-knet', src))
  const rows = [], focus = [], hover = []
  for (const v of VIEWS) for (const dark of [false, true]) for (const [name, clicks] of SCENES) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: 900 }, hasTouch: v.touch, isMobile: v.touch, colorScheme: dark ? 'dark' : 'light', serviceWorkers: 'block' })
    const p = await ctx.newPage()
    await p.route(ORIGIN + '/**', (r) => {
      const u = new URL(r.request().url()), j = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      if (u.pathname === '/backends') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: page(name, files, { dark }).replace('</body>', '<script src="/addon.js"></script></body>') })
      if (u.pathname === '/addon.js') return r.fulfill({ contentType: 'application/javascript', body: JS })
      const route = u.searchParams.get('r')
      if (route === 'payment_config') return j(SHAPE)
      if (route === 'payment_identifiers') return j({ env: 'test', test: { merchant_id: '6261', terminal_id: '626101' }, production: { merchant_id: '', terminal_id: '' } })
      if (route === 'payment_server_ips') return j({ server_ip_1: '187.7.78.123', server_ip_2: '' })
      if (route === 'payment_knet_via_cbk') return j({ enabled: false, tpay_ready: true })
      if (u.pathname.startsWith('/api/')) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      try { return r.fulfill({ body: readFileSync(join(ROOT, 'public', decodeURIComponent(u.pathname))) }) } catch { return r.fulfill({ status: 404, body: '' }) }
    })
    await p.goto(ORIGIN + '/backends'); await p.waitForTimeout(1100)
    for (const c of clicks) { await p.locator(c).first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(700) }
    const scene = name + (clicks.length ? '+' + clicks.join('') : '')
    const m = await p.evaluate(measureInPage, SEL)
    for (const x of m) rows.push({ ...x, view: v.id, dark, scene })
    if (deep) {
      // focus ring: a key press first, so a programmatic focus counts as keyboard focus (:focus-visible)
      await p.keyboard.press('Shift')
      const f = await p.evaluate(() => [...document.querySelectorAll('.admin-shell button, body > [data-sporta-savebar] button')].map((e) => {
        const r = e.getBoundingClientRect(); if (!r.width || !r.height || e.disabled || e.closest('[class*="__preview"]') || e.closest('[hidden]') || getComputedStyle(e).visibility === 'hidden') return null
        e.focus(); const c = getComputedStyle(e), o = { text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), cls: String(e.className).slice(0, 60), took: document.activeElement === e, fv: e.matches(':focus-visible'), style: c.outlineStyle, width: parseFloat(c.outlineWidth), r2: e.getBoundingClientRect() }
        const moved = Math.abs(o.r2.width - r.width) > 0.5 || Math.abs(o.r2.height - r.height) > 0.5; e.blur(); return { ...o, moved, r2: undefined }
      }).filter(Boolean))
      for (const x of f) focus.push({ ...x, view: v.id, dark, scene })
      if (v.id === '1280' && !clicks.length) {
        // hover: every enabled button of the content area, one at a time; its box must not change
        const n = await p.evaluate(() => { const l = [...document.querySelectorAll('.admin-shell .admin-content button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.disabled && !e.closest('[class*="__preview"],[hidden]') && r.top >= 0 && r.bottom <= innerHeight }); l.forEach((e, i) => e.setAttribute('data-hv', i)); return l.length })
        for (let i = 0; i < Math.min(n, 40); i++) {
          const sel = `[data-hv="${i}"]`
          const before = await p.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { w: r.width, h: r.height } }, sel)
          await p.hover(sel, { timeout: 1500, force: true }).catch(() => {})
          const after = await p.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, text: e.textContent.trim().slice(0, 30) } }, sel)
          // the size, not the position: the add-on keeps inserting its panels while the page is up, which moves what is below them
          hover.push({ scene, dark, text: after.text, moved: ['w', 'h'].some((k) => Math.abs(after[k] - before[k]) > 0.5) })
        }
        await p.mouse.move(0, 0)
      }
    }
    await ctx.close()
  }
  return { rows, focus, hover }
}

// ------------------------------------------------------------------------------------------------------------------ the checks
const ACCENT = 'rgb(154, 69, 44)', WHITE = 'rgb(255, 255, 255)'
const lum = (c) => { const v = (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
const contrast = (x, y) => { const p = lum(x), q = lum(y); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05) }
const solid = (c) => /^rgb\(/.test(c) || (/^rgba\(/.test(c) && +c.match(/[\d.]+/g)[3] === 1)
const label = (x) => `${x.scene}@${x.view}${x.dark ? 'D' : 'L'} "${x.text.slice(0, 26)}"`
const uniq = (a) => [...new Set(a)]
const of = (rows, k) => rows.filter((x) => x.kinds.includes(k))
const COMPILED = (x) => !new RegExp(`(^|\\s)(${FAM.join('|')})-`).test(x.cls)

// each returns { ok, before-figure-string, misses }
const CHECKS = {
  '[1] one primary fill per theme, white text': (R) => {
    const p = of(R, 'primary').filter((x) => x.zone === 'content' && !x.disabled && !x.payments)
    const fills = uniq(p.map((x) => `${x.bg}/${x.fg}`)), miss = p.filter((x) => x.bg !== ACCENT || x.fg !== WHITE)
    return { ok: p.length > 100 && !miss.length, fig: `${fills.length} fill/text pairs over ${p.length} primaries`, miss: miss.map((x) => `${label(x)} ${x.bg} ${x.fg}`) }
  },
  '[2] the Save bar wears the accent, white text 4.5:1+': (R) => {
    const s = R.filter((x) => x.zone === 'bar' && !x.disabled)
    const miss = s.filter((x) => x.bg !== ACCENT || x.fg !== WHITE || contrast(x.bg, x.fg) < 4.5)
    return { ok: s.length >= 2 && !miss.length, fig: `${uniq(s.map((x) => x.bg)).join(' ')} (${s.length} bars)`, miss: miss.map((x) => `${label(x)} ${x.bg} tone=${x.tone}`) }
  },
  '[3] one secondary weight, 600': (R) => {
    const s = of(R, 'secondary').filter((x) => x.zone === 'content')
    const miss = s.filter((x) => x.fw !== '600')
    return { ok: s.length > 50 && !miss.length, fig: `weights ${uniq(s.map((x) => x.fw)).sort().join('/')} over ${s.length}`, miss: miss.map((x) => `${label(x)} ${x.fw}`) }
  },
  '[4] one disabled look: not-allowed, opacity .45': (R) => {
    const d = R.filter((x) => x.zone === 'content' && x.disabled && COMPILED(x))
    const miss = d.filter((x) => (x.cursor !== 'not-allowed' && !/disabled:cursor-wait/.test(x.cls)) || (/disabled:opacity-|bg-brand|bg-slate-800|__save|passcode__primary|bg-indigo-600/.test(x.cls) && Math.abs(x.op - 0.45) > 0.001))
    return { ok: d.length >= 8 && !miss.length, fig: uniq(d.map((x) => `${x.op}/${x.cursor}`)).sort().join(' '), miss: miss.map((x) => `${label(x)} op=${x.op} ${x.cursor}`) }
  },
  '[5] one radius, .75rem, on boxed buttons': (R) => {
    const s = of(R, 'boxed').filter((x) => x.zone === 'content' && (x.bw > 0 || solid(x.bg) && x.bg !== 'rgba(0, 0, 0, 0)') && x.rad > 9)
    const miss = s.filter((x) => Math.abs(x.rad / x.root - 0.75) > 0.01)
    return { ok: s.length > 100 && !miss.length, fig: `radii ${uniq(s.map((x) => (x.rad / x.root).toFixed(3) + 'rem')).sort().join(' ')} over ${s.length}`, miss: uniq(miss.map((x) => `${label(x)} ${(x.rad / x.root).toFixed(3)}rem ${x.cls.slice(0, 40)}`)) }
  },
  '[6] mouse screen: boxed controls 40px, add-on panels included': (R) => {
    const s = R.filter((x) => x.view === '1280' && x.zone === 'content' && (x.kinds.includes('primary') || x.kinds.includes('secondary') || x.kinds.includes('addon')) && x.kinds.includes('boxed') && x.h < 60)
    const miss = s.filter((x) => x.h < 39.5 || x.h > 42.5)
    return { ok: s.length > 100 && !miss.length, fig: `heights ${uniq(s.map((x) => Math.round(x.h))).sort((p, q) => p - q).join('/')}px over ${s.length}`, miss: uniq(miss.map((x) => `${label(x)} ${x.h.toFixed(1)}px`)) }
  },
  '[6b] one text size on boxed buttons: .875rem (.8125rem for text-xs)': (R) => {
    const s = R.filter((x) => x.zone === 'content' && (x.kinds.includes('primary') || x.kinds.includes('secondary')) && x.kinds.includes('boxed') && COMPILED(x))
    const miss = s.filter((x) => ![0.875, 0.8125].some((v) => Math.abs(parseFloat(x.fs) / x.root - v) < 0.005))
    return { ok: s.length > 100 && !miss.length, fig: `sizes ${uniq(s.map((x) => (parseFloat(x.fs) / x.root).toFixed(4) + 'rem')).sort().join(' ')} over ${s.length}`, miss: uniq(miss.map((x) => `${label(x)} ${x.fs}`)) }
  },
  '[7] New product / New promotion / SEO health: the height of Add a slide, centred on the header row': (R) => {
    const s = of(R, 'header').filter((x) => x.view === '1280')
    const miss = s.filter((x) => x.h < 39.5 || x.h > 42.5 || Math.abs((x.t + x.b) / 2 - x.hdr.cy) > 3)
    return { ok: s.length >= 8 && !miss.length, fig: s.length ? `${uniq(s.map((x) => Math.round(x.h))).join('/')}px, centre ${uniq(s.map((x) => Math.round((x.t + x.b) / 2 - x.hdr.cy))).join('/')}px off the title block's` : 'none found', miss: miss.map((x) => `${label(x)} h=${x.h.toFixed(1)} dy=${((x.t + x.b) / 2 - x.hdr.cy).toFixed(1)}`) }
  },
  '[8] phone: every button of the shell is 44px or more each way': (R) => {
    const s = R.filter((x) => x.view === '390' && x.zone !== 'sidebar' && x.zone !== 'other')
    const miss = s.filter((x) => x.h < 43.5 || x.w < 43.5)
    return { ok: s.length > 300 && !miss.length, fig: `smallest ${Math.min(...s.map((x) => x.w)).toFixed(0)} x ${Math.min(...s.map((x) => x.h)).toFixed(0)}px over ${s.length}`, miss: uniq(miss.map((x) => `${label(x)} ${x.w.toFixed(1)}x${x.h.toFixed(1)} ${x.cls.slice(0, 30)}`)) }
  },
}
const report = (name, r) => is(r.ok, `${name}: ${r.fig}`, r.miss.length ? `${r.miss.length} miss: ` + (VERBOSE ? r.miss.join(' | ') : r.miss.slice(0, 4).join(' | ')) : '')

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const t0 = Date.now()
const ON = await run(browser, SRC, { deep: true })
const OFF = SECTION ? await run(browser, OFF_SRC) : ON
await browser.close()

head(`After: ${ON.rows.length} buttons measured (${SCENES.length} scenes x 390/1280 x light/dark)`)
const after = {}, before = {}
for (const [k, f] of Object.entries(CHECKS)) { after[k] = f(ON.rows); before[k] = f(OFF.rows); report(k, after[k]) }

head('[9] holds with and without the section')
{
  const f = ON.focus.filter((x) => x.took), skipped = uniq(ON.focus.filter((x) => !x.took).map((x) => `"${x.text}"`))
  if (skipped.length) console.log(`     (not focusable, skipped: ${skipped.join(', ')} - inside a closed <details> summary or covered)`)
  const nf = f.filter((x) => !x.fv || x.style !== 'solid' || x.width < 2)
  is(f.length > 1000 && !nf.length, `every enabled button that takes focus shows a solid focus ring of 2px or more, both themes (${f.length} focused)`, uniq(nf.map((x) => `${x.scene}@${x.view}${x.dark ? 'D' : 'L'} "${x.text}" ${x.style} ${x.width}`)).slice(0, 4).join(' | '))
  const fm = f.filter((x) => x.moved)
  is(!fm.length, 'focusing a button never changes its box', uniq(fm.map((x) => `${x.scene} "${x.text}"`)).slice(0, 4).join(' | '))
  const hv = ON.hover, hm = hv.filter((x) => x.moved)
  is(hv.length > 200 && !hm.length, `hovering a button never changes its box (${hv.length} hovered, 1280px, both themes)`, uniq(hm.map((x) => `${x.scene}${x.dark ? 'D' : 'L'} "${x.text}"`)).slice(0, 4).join(' | '))
  const ov = ON.rows.filter((x) => x.zone === 'content' && x.over && !/m-row/.test(x.cls))
  is(!ov.length, 'no label overflows its button', uniq(ov.map(label)).slice(0, 4).join(' | '))
  const key = (x) => `${x.scene}|${x.view}|${x.text}|${x.cls}`
  const light = new Map(ON.rows.filter((x) => x.payments && !x.dark).map((x) => [key(x), x]))
  const pd = ON.rows.filter((x) => x.payments && x.dark), diff = pd.filter((x) => { const l = light.get(key(x)); return !l || l.bg !== x.bg || l.fg !== x.fg || l.bc !== x.bc })
  is(pd.length >= 10 && !diff.length, `Payments: every button (${pd.length}) computes the same colours in the dark theme as in the light`, diff.slice(0, 3).map((x) => `${label(x)} ${x.bg} ${x.fg}`).join(' | '))
  const filled = ON.rows.filter((x) => (x.zone === 'content' || x.zone === 'bar') && !x.disabled && solid(x.bg) && x.text && !x.payments)
  const low = filled.filter((x) => contrast(x.bg, x.fg) < 4.5)
  is(filled.length > 200 && !low.length, `text on every filled button is 4.5:1 or better (${filled.length})`, uniq(low.map((x) => `${label(x)} ${contrast(x.bg, x.fg).toFixed(2)}`)).slice(0, 4).join(' | '))
  const red = ON.rows.filter((x) => x.zone === 'content' && !x.disabled && /rgb\((190, 18, 60|255, 154, 168)\)/.test(x.fg) && !/remove|delete|block|cancel order|void|reject/i.test(x.text))
  is(!red.length, 'red text only on destructive buttons', uniq(red.map(label)).slice(0, 4).join(' | '))
}

head('Before -> after (the same checks on the source without the section)')
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n)
for (const k of Object.keys(CHECKS)) console.log(`  ${pad(k, 58)} ${pad(before[k].fig, 46)} -> ${after[k].fig}`)

head('Mutation: each check must fail without the section')
for (const k of Object.keys(CHECKS)) is(!before[k].ok, `without BUTTONS-1112, ${k} fails (${before[k].miss.length} misses)`)

console.log(`\n${pass} passed, ${fail} failed  (${Math.round((Date.now() - t0) / 1000)}s)`)
process.exitCode = fail ? 1 : 0
