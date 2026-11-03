// FONTS AUDIT - what the browser REALLY draws, page by page. READ-ONLY.
//
// A stylesheet says which font a page ASKS for. Only the browser knows which font drew each
// glyph (the web font, the metric-matched fallback, or whatever the device happened to have),
// so this crawl asks the browser: for every element that owns text it records the computed
// type settings AND Chrome's own answer to "which platform font rendered these glyphs"
// (CDP CSS.getPlatformFontsForNode - the same data the DevTools "Rendered Fonts" pane shows).
// A flag only fires on that measured answer or on a computed value, never on a guess.
//
//   node scripts/fonts-audit.mjs                 crawl every route and state, then the throttled pass
//   node scripts/fonts-audit.mjs --selftest      run the tool against a deliberately broken fixture
//   node scripts/fonts-audit.mjs --summarize DIR print tables from an existing data directory
//   node scripts/fonts-audit.mjs --list          print the route/state catalogue and exit
//
// Environment (all optional):
//   BASE      origin to audit, e.g. https://www.sporta.com.kw. Unset = this tool starts the local
//             mirror of the captured live storefront on a free port (MIRROR, below) and stops it
//             at the end. With BASE set the tool only ever sends GET requests to it, so it can run
//             on the VPS in the Playwright image (npm i playwright@1.49.0) against the real site.
//   LANGS     default "ar,en". Arabic is the bare URL (RTL); English is ?lang=en (LTR).
//   WIDTHS    default "390,1280" (CSS px). Below 768 counts as a phone for the size check.
//   ROUTES    default all. Comma list of catalogue ids ("home,shop,bag-open") or raw paths ("/foo").
//   OUT       where the JSON goes (one file per page-state). Default ./fonts-audit-data
//   PAGES     parallel pages, 1 or 2 (never more: the machine is shared). Default 2. ONE browser.
//   THROTTLE  the slow-network pass: "0" skips it, "1" forces it. Unset = it runs after a FULL crawl (no ROUTES) and
//             not after a partial one. It visits /, /shop and a product page in each language at THROTTLE_WIDTH
//             (390) on 1.6 Mbps down / 0.75 Mbps up / 150 ms, one page at a time (parallel pages would bend the
//             timings), with the CPU slowed THROTTLE_CPU times (default 4, the profile test:perf uses) so the
//             numbers are comparable. THROTTLE_CPU=1 = network only. In this pass the page freezes for a few
//             milliseconds in the frame its first text appears (a `debugger` statement; a no-op without a
//             debugger attached) so Chrome can be asked which font drew that first screen with no web font able
//             to land mid-question.
//   EXTERNAL  "block" (default when this tool starts the mirror) or "allow" (default with BASE).
//             Blocked third-party requests (the Adobe Fonts kits) are listed, not silently lost.
//   STUB_MISSING_CSS  "1"/"0": answer a 404 for /assets/*.css with an empty stylesheet (default 1 with the mirror, 0 with BASE).
//             The mirror lacks three lazy route stylesheets; without the stub /returns, /exchange, /account and /backends
//             show the app's error page. Stubbed files are listed per state (stubbedCss) and mean "that page's route CSS is not measured".
//   MIRROR    path of the mirror server script. CHROMIUM_PATH the browser binary (unset = the first of the known
//             local paths, else Playwright's own). FONTS_DIR the brand font files the self-test serves (default ../public/fonts).
//
// On the VPS (Playwright image): copy this file into a directory that has `npm i playwright@1.49.0`
// (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1), then  BASE=https://www.sporta.com.kw OUT=/work/out node fonts-audit.mjs
// The import below resolves "playwright" from the script's own directory, so it must sit beside that node_modules.
//
// What it will NOT do: send anything but GET (every other method is aborted and listed), press an
// Order/Pay button, submit a form, type into a field or sign in. The only clicks are the layout
// states a visitor opens before buying anything: bag drawer, Sporta AI panel, language toggle,
// size chip, size guide, menu/search if the build has them. Its only changes to the page are
// scratch attributes (data-fa / data-fp) and off-screen probe <span>s, both removed afterwards (the slow pass
// also tags its first-screen elements data-fa-ft and leaves them until its page closes).
//
// Flags (code: meaning - threshold):
//   F-NONBRAND    glyphs drawn by a platform font that is not the brand set. Brand = a WEB font
//                 whose internal name starts "Alexandria" or "IBM Plex Sans". Culprit characters are
//                 found by re-rendering each distinct character alone with the run's own font settings.
//   F-WEIGHT      the requested weight is not inside any face of the family that heads the stack, so
//                 CSS font matching snaps it to another face (500 -> 400 on Plex, which ships 400/600/700).
//   F-SYNTH-BOLD  requested >= 600 but the best face is < 600: Chrome smears a fake bold.
//   F-STYLE       italic/oblique asked, the family has no italic face: Chrome slants the upright glyphs.
//   F-AR-ITALIC / F-AR-SPACING / F-AR-UPPER   Arabic letters with italic, with letter-spacing of 0.01em or more either way
//                 (positive gaps the joins, negative overlaps them; anything under 0.01em is only noted in info[]),
//                 or with text-transform upper/capitalize (does nothing to Arabic, hides intent).
//   F-AR-LEADING  Arabic text on >= 2 lines with line-height < 1.5 (crowds the dots and marks). det.leadingFor
//                 says heading or text: tight display headings are often deliberate, tight body copy rarely is.
//   F-CTL-FAMILY  an input/select/textarea/button whose font stack is not one the page's own text uses.
//   F-CTL-LT16    a text-entry control under 16px on a phone (iOS Safari zooms the page on focus).
//   F-PRICE-PROP  a price whose digits are not tabular. A price = an element whose whole text is a number with an
//                 optional KD / dinar sign, or a bare number inside a price/total/amount box (a sentence that mentions
//                 a price is not one). Raised when font-variant-numeric lacks tabular-nums AND the font's own digits
//                 differ in width (measured: Alexandria's Western digits do, Plex's do not), so columns of prices
//                 would not line up.
//   F-SMALL       visible text under 14px on a phone, unless the ALLOW-LIST below excuses it (then
//                 the run carries allowed=<reason> instead and F-SMALL is not raised).
//   F-MIXED-DIGITS Western and Arabic-Indic digits in one run.
//   F-NOPF        visible text for which Chrome reported no platform font (a measurement gap, counted
//                 so a clean result cannot hide it).
//
// Small-text allow-list (the ONLY things excused from F-SMALL, each recorded on the run):
//   promo-bar    anything inside .topbar (the owner's compact promo strip)
//   count-badge  a pill of at most 3 characters with a digit (bag count)
//   sup-sub      <sup>/<sub>
//   legal-line   footer text containing the copyright sign or the operator line
// Everything else under 14px on a phone is reported; whether it is deliberate is the owner's call.
//
// Slow-network numbers (all ms from navigation start, one clock): firstTextMs = first frame with visible text in the
// viewport (the shell has an image but no text, so FCP is not a text paint); firstTextGlyphsNonBrand / Total = how many
// of the first screenful's glyphs a fallback font drew at that instant (FOUT in glyphs, not a guess); brandFacesLate =
// brand faces that finished after that frame (text needing them was in a fallback until then); clsFromFontSwap = layout
// shift that started within 300 ms after a brand face finished; foitRiskAtFirstText = faces still loading whose
// font-display is auto/block (they would HIDE text; every shipped face says swap, so it should be empty).
//
// Limits (nothing here pretends otherwise): text that is not a DOM text node is invisible to it
// (CSS ::before/::after content, canvas, images of text); an <option> list or date picker is browser UI;
// which fallback font a device substitutes is that device's choice - the data says what THIS
// machine drew; font loading from a third-party host is only measurable when EXTERNAL=allow.
import { chromium } from 'playwright'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENV = process.env
const ARGV = process.argv.slice(2)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRATCH = '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad'
const MIRROR = ENV.MIRROR || SCRATCH + '/mirror/serve.mjs'
const list = (s, d) => String(s ?? d).split(',').map((x) => x.trim()).filter(Boolean)
const LANGS = list(ENV.LANGS, 'ar,en')
const WIDTHS = list(ENV.WIDTHS, '390,1280').map(Number)
const OUT = path.resolve(ENV.OUT || 'fonts-audit-data')
const PAGES = Math.max(1, Math.min(2, Number(ENV.PAGES || 2)))
const THROTTLE_ON = ENV.THROTTLE !== '0'
const THROTTLE_WIDTH = Number(ENV.THROTTLE_WIDTH || 390)
const THROTTLE_CPU = Number(ENV.THROTTLE_CPU || 4)
const NET = { latency: 150, down: 1.6e6 / 8, up: 0.75e6 / 8 } // bytes per second, as CDP wants them
const STATE_TIMEOUT = Number(ENV.STATE_TIMEOUT || 90000)
const PHONE_MAX = 767 // widths up to this are phones for F-SMALL / F-CTL-LT16
const MIN_PHONE_PX = 14
const PX = (n) => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------------------------
// WHAT TO VISIT. Routes come from the compiled router in the live bundle (index-*.js: /, /shop,
// /product/:slug, /cart, /checkout, /payment/result, /about, /contact, /wishlist, /track, /review,
// /invoice/:trackId, /returns, /exchange, /account, /support, /terms, /privacy, /backends/*, 404)
// and public/.htaccess. A bag is put in exactly the way the app stores it: localStorage
// "sporta_cart" = JSON array of {key, slug, size, fit, name, price, image, qty}.
// ---------------------------------------------------------------------------------------------
const PRODUCT = '/product/energy-t-shirt-red-white' // 8 sizes in stock, KD 5
const SOLDOUT = '/product/cagliari-calcio-backpack' // one size, none left
const CART = [
  { key: 'energy-t-shirt-red-white__M__-', slug: 'energy-t-shirt-red-white', size: 'M', fit: null, name: 'Energy T-Shirt', price: 5, image: '/product-photo-unavailable.svg', qty: 2 },
  { key: 'flash-shorts-green__L__-', slug: 'flash-shorts-green', size: 'L', fit: null, name: 'Flash Shorts', price: 3, image: '/product-photo-unavailable.svg', qty: 1 },
  { key: 'cloudsoft-leggings-grey__L__-', slug: 'cloudsoft-leggings-grey', size: 'L', fit: null, name: 'Cloudsoft Leggings', price: 4.5, image: '/product-photo-unavailable.svg', qty: 1 }, // 4.500 shows the decimals
]
const WISHLIST = ['energy-t-shirt-red-white', 'vanquish-t-shirt-white', 'flash-shorts-red']
// "Remember these details" saved: this is what puts the QUICK checkout card on screen.
const DELIVERY = { name: 'Test Shopper', phone: '99887766', governorate: 'capital', area: 'Sharq', block: '1', street: '2', building: '3', floor: '', flat: '', note: '' }

const skipped = (why) => ({ skipped: why })
const clickFirst = async (page, selectors, what) => {
  for (const s of selectors) {
    const el = await page.$(s)
    if (el && (await el.isVisible().catch(() => false))) { await el.click({ timeout: 4000 }); return null }
  }
  return skipped('no ' + what + ' control in this build (looked for ' + selectors.join(' | ') + ')')
}
const ACT = {
  // Bag drawer: the button in the header; the drawer is an <aside role=dialog> that loses aria-hidden/inert when open.
  async openBag(page) {
    const s = await clickFirst(page, ['button.navbar-cart', 'header button[aria-label*="bag" i]', 'header button[aria-label*="\u0627\u0644\u062d\u0642\u064a\u0628\u0629"]'], 'bag')
    if (s) return s
    await page.waitForSelector('aside[role=dialog]:not([aria-hidden=true]):not([inert])', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(600)
  },
  // Sporta AI: a lazy chunk arrives on the first click, then a dialog.
  async openAI(page) {
    const s = await clickFirst(page, ['button.navbar-ai', 'button.assistant-launcher', 'button[aria-label*="assistant" i]', 'button[aria-label*="\u0645\u0633\u0627\u0639\u062f"]'], 'Sporta AI')
    if (s) return s
    await page.waitForSelector('div[role=dialog]', { timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(900)
  },
  async toggleLang(page) {
    const before = await page.evaluate(() => document.documentElement.lang)
    const s = await clickFirst(page, ['button.navbar-language', 'header button[aria-label*="language" i]', 'header button[aria-label*="\u0627\u0644\u0644\u063a\u0629"]'], 'language toggle')
    if (s) return s
    await page.waitForFunction((b) => document.documentElement.lang !== b, before, { timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(700)
    return { toggledTo: await page.evaluate(() => document.documentElement.lang) }
  },
  // A size chip is a <button> whose whole text is a size; take the first one that is enabled.
  async pickSize(page) {
    const ok = await page.evaluate(() => {
      const b = [...document.querySelectorAll('main button')].find((x) => /^(XS|S|M|L|XL|[2-6]XL|ONE)$/.test((x.textContent || '').trim()) && !x.disabled && x.getAttribute('aria-disabled') !== 'true')
      if (b) b.click()
      return !!b
    })
    if (!ok) return skipped('no enabled size chip on this page')
    await page.waitForTimeout(500)
  },
  async openSizeGuide(page) {
    const ok = await page.evaluate(() => {
      const b = [...document.querySelectorAll('main button')].find((x) => /size guide|\u062f\u0644\u064a\u0644|\u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a/i.test(x.textContent || ''))
      if (b) b.click()
      return !!b
    })
    if (!ok) return skipped('no size-guide button on this page')
    await page.waitForTimeout(800)
  },
  // The live build has no hamburger and no search button (the nav links are always visible); the state stays in the
  // catalogue so a future build that grows them is measured the day it does.
  // Closed <details> answers draw no text; a visitor opens them, so the FAQ state is measured open.
  async openDetails(page) {
    const n = await page.evaluate(() => { const d = [...document.querySelectorAll('details:not([open])')]; d.forEach((x) => (x.open = true)); return d.length })
    if (!n) return skipped('no closed <details> on this page')
    await page.waitForTimeout(500)
  },
  async openMenu(page) {
    const s = await clickFirst(page, ['header button[aria-label*="menu" i]', 'header button[aria-label*="\u0627\u0644\u0642\u0627\u0626\u0645\u0629"]', 'header button[aria-controls]'], 'menu')
    if (s) return s
    await page.waitForTimeout(500)
  },
  async openSearch(page) {
    const s = await clickFirst(page, ['header button[aria-label*="search" i]', 'header button[aria-label*="\u0628\u062d\u062b"]'], 'search')
    if (s) return s
    await page.waitForTimeout(700)
  },
}
const CATALOGUE = [
  { id: 'home', path: '/' },
  { id: 'shop', path: '/shop' },
  { id: 'shop-brand', path: '/shop?brand=vanquish' },
  { id: 'shop-category', path: '/shop?category=women' },
  { id: 'product', path: PRODUCT },
  { id: 'product-size', path: PRODUCT, act: 'pickSize' },
  { id: 'product-sizeguide', path: PRODUCT, act: 'openSizeGuide' },
  { id: 'product-soldout', path: SOLDOUT },
  { id: 'cart', path: '/cart', seed: { cart: 1 } },
  { id: 'cart-empty', path: '/cart' },
  { id: 'checkout', path: '/checkout', seed: { cart: 1 } },
  { id: 'checkout-quick', path: '/checkout', seed: { cart: 1, delivery: 1 } },
  { id: 'about', path: '/about' },
  { id: 'about-faq', path: '/about', act: 'openDetails' }, // the FAQ answers are closed <details> until a visitor opens them
  { id: 'contact', path: '/contact' },
  { id: 'wishlist', path: '/wishlist', seed: { wishlist: 1 } },
  { id: 'wishlist-empty', path: '/wishlist' },
  { id: 'track', path: '/track' },
  { id: 'returns', path: '/returns' },

  { id: 'exchange', path: '/exchange' },
  { id: 'terms', path: '/terms' },
  { id: 'privacy', path: '/privacy' },
  { id: 'account', path: '/account' },
  { id: 'support', path: '/support' },
  { id: 'review', path: '/review' },
  { id: 'payment-result', path: '/payment/result' },
  { id: 'invoice', path: '/invoice/SP000000' },
  { id: 'notfound', path: '/no-such-page' },
  { id: 'backends', path: '/backends' },
  // layout states
  { id: 'bag-open', path: '/', seed: { cart: 1 }, act: 'openBag' },
  { id: 'bag-open-empty', path: '/', act: 'openBag' },
  { id: 'ai-open', path: '/', act: 'openAI' },
  { id: 'ai-open-product', path: PRODUCT, act: 'openAI' },
  { id: 'lang-toggle', path: '/', act: 'toggleLang' },
  { id: 'lang-toggle-shop', path: '/shop', act: 'toggleLang' },
  { id: 'menu-open', path: '/', act: 'openMenu' },
  { id: 'search-open', path: '/', act: 'openSearch' },
]
const THROTTLED = [{ id: 'home', path: '/' }, { id: 'shop', path: '/shop' }, { id: 'product', path: PRODUCT }]

// Runs for the stable id of a (state, lang, width) triple; also the file name.
const stateName = (id, lang, w) => `${id}__${lang}__${w}`
const withLang = (p, lang) => (lang === 'en' ? p + (p.includes('?') ? '&' : '?') + 'lang=en' : p)
const pickCatalogue = () => {
  const want = list(ENV.ROUTES, '')
  if (!want.length) return CATALOGUE
  return want.flatMap((w) => {
    if (w.startsWith('/')) return [{ id: 'path' + w.replace(/[^a-z0-9]+/gi, '-'), path: w }]
    const hit = CATALOGUE.filter((c) => c.id === w)
    if (!hit.length) console.error('unknown route id: ' + w)
    return hit
  })
}

// ---------------------------------------------------------------------------------------------
// IN-PAGE FUNCTIONS. They are serialised into the browser, so each is self-contained.
// ---------------------------------------------------------------------------------------------

// Tag every element that owns visible-able text with data-fa=<index> and return what the DOM and the CSSOM know:
// computed type settings (deduplicated into a style table), geometry, visibility, role, script mix. The platform
// font each tagged element really used is asked from Chrome afterwards, over CDP, by that same index.
function COLLECT() {
  const SKIP = 'script,style,noscript,template,head,title,option,optgroup,datalist,textarea'
  const vw = document.documentElement.clientWidth
  const vh = window.innerHeight
  const TEXT_INPUTS = /^(|text|search|tel|email|password|number|url|date|datetime-local|time|month|week)$/
  const BUTTON_INPUTS = /^(submit|button|reset)$/
  const scripts = (s) => {
    let ar = 0, lat = 0, dw = 0, da = 0, oth = 0, sp = 0
    for (const ch of s) {
      const c = ch.codePointAt(0)
      if ((c >= 0x660 && c <= 0x669) || (c >= 0x6f0 && c <= 0x6f9)) da++
      else if ((c >= 0x600 && c <= 0x6ff) || (c >= 0x750 && c <= 0x77f) || (c >= 0x8a0 && c <= 0x8ff) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) ar++
      else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0xc0 && c <= 0x24f)) lat++
      else if (c >= 48 && c <= 57) dw++
      else if (c === 32 || c === 0xa0 || c === 9 || c === 10) sp++
      else oth++
    }
    return { ar, lat, dw, da, oth, sp }
  }
  const seg = (e) => {
    let s = e.tagName.toLowerCase()
    if (e.id) s += '#' + e.id
    const cls = (e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2)
    return s + (cls.length ? '.' + cls.join('.') : '')
  }
  const pathOf = (e) => {
    const out = []
    for (let n = e, i = 0; n && n.nodeType === 1 && i < 3 && n !== document.body; n = n.parentElement, i++) out.push(seg(n))
    return out.join(' < ')
  }
  // 1. owners of text: the parent of every non-blank text node, plus form controls (their text lives in the
  //    browser's own shadow tree, not in a text node).
  const groups = new Map()
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n; (n = tw.nextNode()); ) {
    if (!/\S/.test(n.nodeValue)) continue
    const el = n.parentElement
    if (!el || el.closest(SKIP)) continue
    if (!groups.has(el)) groups.set(el, { texts: [], ctl: false })
    groups.get(el).texts.push(n)
  }
  for (const el of document.querySelectorAll('input,textarea,select')) {
    const t = el.tagName === 'INPUT' ? el.type : el.tagName
    if (el.tagName === 'INPUT' && !TEXT_INPUTS.test(t) && !BUTTON_INPUTS.test(t)) continue
    if (!groups.has(el)) groups.set(el, { texts: [], ctl: true })
    else groups.get(el).ctl = true
  }
  // the sr-only / visually-hidden pattern: a 1px box that clips its overflow. The TEXT inside still lays out at full
  // size (one word per line), so the text rectangle alone cannot tell; look for the clipping ancestor.
  const clippedBy = (el) => {
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 6; n = n.parentElement, i++) {
      const b = n.getBoundingClientRect()
      const c = getComputedStyle(n)
      if ((b.width <= 1.5 || b.height <= 1.5) && (c.overflow !== 'visible' || c.clip !== 'auto' || c.clipPath !== 'none')) return true
    }
    return false
  }
  const inClosedDetails = (el) => !!el.closest('details:not([open])') && !el.closest('summary')
  const styles = []
  const styleIds = new Map()
  const bodyCs = getComputedStyle(document.body)
  const runs = []
  let idx = 0
  for (const [el, g] of groups) {
    const cs = getComputedStyle(el)
    const tag = el.tagName
    let own = g.texts.map((t) => t.nodeValue).join('')
    let ctlInfo = null
    if (g.ctl) {
      let v = ''
      if (tag === 'SELECT') v = el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent : ''
      else v = el.value || el.placeholder || ''
      own = own || v
      ctlInfo = { type: tag === 'INPUT' ? el.type : tag.toLowerCase(), hasValue: !!el.value, hasPlaceholder: !!el.placeholder }
      if (el.placeholder) {
        const ph = getComputedStyle(el, '::placeholder')
        ctlInfo.placeholderFamily = ph.fontFamily
        ctlInfo.placeholderSize = parseFloat(ph.fontSize)
        ctlInfo.placeholderStyle = ph.fontStyle
      }
    }
    const txt = own.replace(/\s+/g, ' ').trim()
    // geometry of the TEXT (not the box): the range over its text nodes
    let rect = null
    let lines = 1
    if (g.texts.length) {
      const r = document.createRange()
      r.setStartBefore(g.texts[0])
      r.setEndAfter(g.texts[g.texts.length - 1])
      const b = r.getBoundingClientRect()
      rect = [Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height)]
      lines = new Set([...r.getClientRects()].map((q) => Math.round(q.top / 3))).size || 1
    } else {
      const b = el.getBoundingClientRect()
      rect = [Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height)]
    }
    let op = 1
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity) || 0
    let vis = 'visible'
    const left = rect[0], right = rect[0] + rect[2]
    if (rect[2] === 0 && rect[3] === 0) vis = 'nobox'
    else if (cs.visibility !== 'visible') vis = 'hidden'
    else if (op < 0.05) vis = 'transparent'
    else if (rect[2] <= 1.5 || rect[3] <= 1.5 || clippedBy(el)) vis = 'clipped'
    else if (inClosedDetails(el)) vis = 'hidden' // a closed <details> keeps its answer as a box but draws no text
    else if (right <= 0 || left >= vw) vis = 'offscreen'
    else if (el.closest('[inert]')) vis = 'inert'
    const roles = []
    if (g.ctl) roles.push('control')
    if (/^H[1-6]$/.test(tag)) roles.push('heading')
    if (tag === 'BUTTON' || el.closest('button')) roles.push('button')
    if (tag === 'A' || el.closest('a')) roles.push('link')
    if (el.closest('svg')) roles.push('svg')
    const region = el.closest('dialog,[role=dialog],aside') ? 'dialog' : el.closest('footer') ? 'footer' : el.closest('header') ? 'header' : el.closest('nav') ? 'nav' : el.closest('main') ? 'main' : 'other'
    // A price is a number with an optional currency ("KD 5.000", "5.000 د.ك."), not a sentence that happens to mention
    // one ("Delivery 24h, 1 KD"). The bidi marks the app wraps prices in are stripped first.
    const bare = txt.replace(/[‎‏؜‪-‮]/g, '').trim()
    const CUR = '(?:KD|KWD|\\u062f\\.\\u0643\\.?|\\u062f\\u064a\\u0646\\u0627\\u0631)'
    const NUM = '[0-9\\u0660-\\u0669][0-9\\u0660-\\u0669.,\\u066b\\u066c ]*'
    const numberish = bare.length <= 24 && new RegExp('^(?:' + CUR + '\\s*)?' + NUM + '(?:\\s*' + CUR + ')?$', 'i').test(bare)
    // a bare number ("404", a result count, a step number) is a price only inside a price/total/amount box
    const price = numberish && (new RegExp(CUR, 'i').test(bare) || !!el.closest('[class*=price i],[class*=total i],[class*=amount i]'))
    const radius = parseFloat(cs.borderTopLeftRadius) || 0
    const pill = radius >= Math.min(rect[2], rect[3]) / 2 - 1 && radius > 6
    const st = {
      ff: cs.fontFamily, fs: parseFloat(cs.fontSize), fw: Number(cs.fontWeight) || 400, fst: cs.fontStyle,
      lh: cs.lineHeight === 'normal' ? 'normal' : parseFloat(cs.lineHeight),
      ls: cs.letterSpacing === 'normal' ? 'normal' : parseFloat(cs.letterSpacing),
      ws: cs.wordSpacing === 'normal' ? 'normal' : parseFloat(cs.wordSpacing),
      tt: cs.textTransform, fvn: cs.fontVariantNumeric, fsyn: cs.fontSynthesis || '',
      ffs: cs.fontFeatureSettings, fvs: cs.fontVariationSettings, fstr: cs.fontStretch, ta: cs.textAlign, dir: cs.direction,
    }
    const key = JSON.stringify(st)
    if (!styleIds.has(key)) { styleIds.set(key, styles.length); styles.push(st) }
    el.setAttribute('data-fa', String(idx))
    const langEl = el.closest('[lang]')
    runs.push({
      i: idx, sel: pathOf(el), tag: tag.toLowerCase(), region, roles, txt: txt.slice(0, 70), n: txt.length,
      sc: scripts(own), st: styleIds.get(key), lang: langEl ? langEl.getAttribute('lang') : null,
      rect, lines, vis, a11yHidden: !!el.closest('[aria-hidden=true]'), inert: !!el.closest('[inert]'),
      price, pill, ctl: ctlInfo, topbar: !!el.closest('.topbar'), chars: [...new Set(own)].join('').slice(0, 120),
    })
    idx++
  }
  // every control, text or not: the F-CTL-* checks compare the control's own stack with the page's
  const controls = [...document.querySelectorAll('input,select,textarea,button')]
    .filter((e) => !(e.tagName === 'INPUT' && /^(hidden|checkbox|radio|file|range|color|image)$/.test(e.type)))
    .map((e) => {
      const cs = getComputedStyle(e)
      const b = e.getBoundingClientRect()
      return { sel: pathOf(e), tag: e.tagName.toLowerCase(), type: e.type || null, ff: cs.fontFamily, fs: parseFloat(cs.fontSize), fw: Number(cs.fontWeight) || 400, w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.left),
        textEntry: e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || (e.tagName === 'INPUT' && TEXT_INPUTS.test(e.type)), inert: !!e.closest('[inert]'), a11yHidden: !!e.closest('[aria-hidden=true]'), offscreen: b.left + b.width <= 0 || b.left >= vw }
    })
  const faces = [...document.fonts].map((f) => ({ family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, style: f.style, stretch: f.stretch, display: f.display, status: f.status, unicodeRange: f.unicodeRange }))
  const rules = []
  for (const sh of document.styleSheets) {
    let rs
    try { rs = sh.cssRules } catch { rules.push({ sheet: sh.href, unreadable: true }); continue }
    for (const r of rs) {
      if (r.constructor.name !== 'CSSFontFaceRule') continue
      const g = (p) => r.style.getPropertyValue(p).trim()
      rules.push({ sheet: sh.href ? sh.href.replace(location.origin, '') : '<inline>', family: g('font-family').replace(/^["']|["']$/g, ''), weight: g('font-weight'), style: g('font-style'), display: g('font-display'), src: g('src').slice(0, 200), unicodeRange: g('unicode-range').slice(0, 80), sizeAdjust: g('size-adjust'), ascent: g('ascent-override'), descent: g('descent-override'), lineGap: g('line-gap-override') })
    }
  }
  const links = [...document.querySelectorAll('link[rel~=preload],link[rel~=stylesheet],link[rel~=preconnect]')]
    .map((l) => ({ rel: l.rel, as: l.getAttribute('as'), href: l.getAttribute('href'), type: l.getAttribute('type'), crossorigin: l.getAttribute('crossorigin'), media: l.getAttribute('media') }))
    .filter((l) => l.as === 'font' || /typekit|fonts\.(googleapis|gstatic)|adobe/i.test(l.href || '') || l.rel.includes('preconnect'))
  return {
    vw, vh, htmlLang: document.documentElement.lang, htmlDir: document.documentElement.dir, title: document.title,
    rootFs: parseFloat(getComputedStyle(document.documentElement).fontSize), bodyFf: bodyCs.fontFamily, bodyFs: parseFloat(bodyCs.fontSize),
    docHeight: document.documentElement.scrollHeight, mounted: !document.querySelector('#root > .boot'),
    skeletons: document.querySelectorAll('.skeleton').length, styles, runs, controls, faces, rules, links,
  }
}

// Off-screen <span> probes. mode 'width': return each probe's width. mode 'node': leave them tagged data-fp=<i>
// so the platform font of each can be asked over CDP. Each item carries the full font settings of a real run.
function PROBE([items, mode]) {
  document.querySelectorAll('[data-fa-probe]').forEach((n) => n.remove())
  const host = document.createElement('div')
  host.setAttribute('data-fa-probe', '1')
  host.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;white-space:pre;contain:layout;'
  const out = []
  items.forEach((it, i) => {
    const s = document.createElement('span')
    s.style.cssText = `font-family:${it.ff};font-weight:${it.fw};font-style:${it.fst};font-variant-numeric:${it.fvn || 'normal'};font-feature-settings:${it.ffs || 'normal'};font-size:${it.fs || 40}px;letter-spacing:normal;text-transform:none;`
    s.textContent = it.text
    if (mode === 'node') s.setAttribute('data-fp', String(i))
    host.appendChild(s)
  })
  document.body.appendChild(host)
  if (mode === 'width') for (const s of host.children) out.push(s.getBoundingClientRect().width)
  else out.push(0)
  if (mode === 'width') host.remove()
  return out
}

function CLEAN() {
  document.querySelectorAll('[data-fa]').forEach((n) => n.removeAttribute('data-fa'))
  document.querySelectorAll('[data-fa-probe]').forEach((n) => n.remove())
}

// Scroll the whole page once (lazy sections and images mount on approach) and come back to the top, where the
// sticky header is shown again. Restores nothing else.
async function SCROLL_PASS() {
  const h = document.documentElement.scrollHeight
  const step = Math.max(200, Math.floor(window.innerHeight * 0.8))
  for (let y = 0; y < h; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 70)) }
  window.scrollTo(0, 0)
  await new Promise((r) => setTimeout(r, 350))
}

// Installed BEFORE any page script (addInitScript) for the throttled pass: records what a visitor on a slow phone
// sees while the fonts arrive. Everything lands in window.__fa and is read once at the end.
function INSTALL_PROBE() {
  const fa = (window.__fa = { paint: {}, lcp: null, shifts: [], faces: {}, firstText: null, frames: 0, err: [] })
  const seg = (e) => {
    let s = e.tagName.toLowerCase()
    if (e.id) s += '#' + e.id
    const cls = (e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2)
    return s + (cls.length ? '.' + cls.join('.') : '')
  }
  const pathOf = (e) => { const o = []; for (let n = e, i = 0; n && n.nodeType === 1 && i < 3; n = n.parentElement, i++) o.push(seg(n)); return o.join(' < ') }
  const rc = (r) => (r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null)
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) fa.paint[e.name] = e.startTime }).observe({ type: 'paint', buffered: true }) } catch (e) { fa.err.push('paint') }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) fa.lcp = { t: e.startTime, size: e.size, el: e.element ? pathOf(e.element) : null, url: e.url || null } }).observe({ type: 'largest-contentful-paint', buffered: true }) } catch (e) { fa.err.push('lcp') }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) fa.shifts.push({ t: e.startTime, v: e.value, input: e.hadRecentInput, sources: (e.sources || []).map((s) => ({ node: s.node && s.node.nodeType === 1 ? pathOf(s.node) : null, prev: rc(s.previousRect), cur: rc(s.currentRect) })) }) }).observe({ type: 'layout-shift', buffered: true }) } catch (e) { fa.err.push('layout-shift') }
  const faceRec = (f) => (fa.faces[f.family + '|' + f.weight + '|' + f.style + '|' + f.unicodeRange.slice(0, 24)] ||= { family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, style: f.style, display: f.display, ur: f.unicodeRange.slice(0, 40), loading: null, loaded: null, error: null })
  const stamp = (faces, k) => { const t = performance.now(); for (const f of faces) { const r = faceRec(f); if (r[k] == null) r[k] = t } }
  try {
    document.fonts.addEventListener('loading', (e) => stamp(e.fontfaces, 'loading'))
    document.fonts.addEventListener('loadingdone', (e) => stamp(e.fontfaces, 'loaded'))
    document.fonts.addEventListener('loadingerror', (e) => stamp(e.fontfaces, 'error'))
  } catch (e) { fa.err.push('fonts-events') }
  const SKIPT = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|TITLE)$/
  // The first frame in which visible text exists in the viewport: collect up to 24 owners of it (distinct parents) so the
  // Node side can ask Chrome which font each was drawn with AT THAT MOMENT (see __faSnap below), not what it ends up with.
  const firstText = () => {
    const root = document.body || document.documentElement
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const seen = new Set()
    const items = []
    for (let n; items.length < 24 && (n = tw.nextNode()); ) {
      if (!/\S/.test(n.nodeValue)) continue
      const el = n.parentElement
      if (!el || seen.has(el) || SKIPT.test(el.tagName) || el.closest('head,noscript,template')) continue
      const cs = getComputedStyle(el)
      if (cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.05 || !el.getClientRects().length) continue
      const r = document.createRange()
      r.selectNodeContents(n)
      const b = r.getBoundingClientRect()
      if (b.width < 2 || b.height < 2 || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue
      seen.add(el)
      el.setAttribute('data-fa-ft', String(items.length))
      items.push({ sel: pathOf(el), txt: n.nodeValue.trim().slice(0, 40), ff: cs.fontFamily.slice(0, 120), fs: cs.fontSize, fw: cs.fontWeight })
    }
    return items.length ? items : null
  }
  const tick = () => {
    fa.frames++
    const now = performance.now()
    try {
      for (const f of document.fonts) { const r = faceRec(f); if (f.status === 'loading' && r.loading == null) r.loading = now; if (f.status === 'loaded' && r.loaded == null) r.loaded = now; if (f.status === 'error' && r.error == null) r.error = now }
      if (!fa.firstText) {
        const items = firstText()
        if (items) {
          fa.firstText = { t: now, sel: items[0].sel, text: items[0].txt, ff: items[0].ff, fs: items[0].fs, n: items.length }
          fa.firstText.faces = [...document.fonts].map((f) => ({ family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, display: f.display, status: f.status }))
          fa.ftItems = items
          // Freeze the page right here (a no-op unless a debugger is attached): the Node side reads the platform fonts
          // while no web font can land, so the snapshot is exact instead of racing the network.
          debugger // eslint-disable-line no-debugger
        }
      }
    } catch (e) { fa.err.push(String(e).slice(0, 80)) }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// ---------------------------------------------------------------------------------------------
// NODE-SIDE ANALYSIS. Pure functions over what the page and Chrome reported; no browser here.
// ---------------------------------------------------------------------------------------------

// Chrome reports the font FILE's internal name, not the CSS family: the shipped Plex files are all "IBM Plex Sans
// Arabic [Weight]" and Alexandria (variable) is "Alexandria". isCustomFont says it came down as a web font, so a
// system font that merely shares the name does not pass.
const BRAND_NAMES = [/^Alexandria\b/i, /^IBM Plex Sans\b/i]
const isBrand = (f) => !!f.isCustomFont && BRAND_NAMES.some((re) => re.test(f.familyName || ''))

const splitStack = (ff) => (ff.match(/"[^"]*"|'[^']*'|[^,]+/g) || []).map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)

// FontFace.weight is "400", "normal", "bold" or a range "100 900".
const weightRange = (w) => {
  w = String(w || '400').trim()
  if (w === 'normal') return [400, 400]
  if (w === 'bold') return [700, 700]
  const p = w.split(/\s+/).map(Number).filter(Number.isFinite)
  return p.length < 2 ? [p[0] ?? 400, p[0] ?? 400] : [Math.min(...p), Math.max(...p)]
}
// CSS Fonts 4 section 5.2: which face a requested weight lands on. exact = the request is inside a face's range.
function matchWeight(req, ranges) {
  if (!ranges.length) return null
  if (ranges.some(([lo, hi]) => req >= lo && req <= hi)) return { used: req, exact: true }
  const cands = [...new Set(ranges.map(([lo, hi]) => (req < lo ? lo : hi)))].sort((a, b) => a - b)
  const up = (from, to) => cands.filter((c) => c >= from && c <= to)
  const down = (from) => cands.filter((c) => c < from).reverse()
  let order
  if (req >= 400 && req <= 500) order = [...up(req, 500), ...down(req), ...cands.filter((c) => c > 500)]
  else if (req < 400) order = [...cands.filter((c) => c <= req).reverse(), ...cands.filter((c) => c > req)]
  else order = [...cands.filter((c) => c >= req), ...down(req)]
  return { used: order[0], exact: false }
}
const hasDigit = (s) => /[0-9\u0660-\u0669]/.test(s)

// Why a small run is excused (see the allow-list in the header), or null.
function smallAllow(r) {
  if (r.topbar) return 'promo-bar'
  if (r.tag === 'sup' || r.tag === 'sub') return 'sup-sub'
  if (r.n <= 3 && hasDigit(r.txt) && r.pill) return 'count-badge'
  if (r.region === 'footer' && /\u00a9|all rights|\u062d\u0642\u0648\u0642|Al-Muhallab|\u0627\u0644\u0645\u0647\u0644\u0628/i.test(r.txt)) return 'legal-line'
  return null
}

// Which (style, digit kind) pairs still need a "are these digits tabular?" measurement.
function tabularNeeds(raw) {
  const need = new Map()
  for (const r of raw.runs) {
    if (!r.price || r.vis === 'nobox') continue
    const st = raw.styles[r.st]
    if (/tabular/.test(st.fvn)) continue
    for (const kind of [r.sc.dw ? 'w' : null, r.sc.da ? 'a' : null].filter(Boolean)) need.set(r.st + '|' + kind, { st, kind })
  }
  return need
}
const DIGITS = { w: '0123456789', a: '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669' }

// Turn the raw page data + Chrome's platform fonts into runs with flags. widths: tabular map. culprits: Map(runIdx -> [..]).
function analyse(raw, pfByIdx, width, tabular, culprits) {
  const phone = width <= PHONE_MAX
  const fonts = []
  const fontIds = new Map()
  const fontId = (f) => {
    const k = f.familyName + '|' + f.postScriptName + '|' + !!f.isCustomFont
    if (!fontIds.has(k)) { fontIds.set(k, fonts.length); fonts.push({ name: f.familyName, ps: f.postScriptName || null, web: !!f.isCustomFont, brand: isBrand(f) }) }
    return fontIds.get(k)
  }
  // the faces the page declared, by lower-case family
  const faceBy = new Map()
  for (const f of raw.faces) {
    const k = f.family.toLowerCase()
    if (!faceBy.has(k)) faceBy.set(k, [])
    faceBy.get(k).push(f)
  }
  // stacks the page's own brand-drawn text uses (what a control is compared with)
  const brandStacks = new Set([raw.bodyFf])
  for (const r of raw.runs) {
    const pf = pfByIdx[r.i] || []
    if (r.vis === 'visible' && !r.roles.includes('control') && pf.length && pf.every(isBrand)) brandStacks.add(raw.styles[r.st].ff)
  }
  const runs = []
  for (const r of raw.runs) {
    const st = raw.styles[r.st]
    const pf = pfByIdx[r.i] || []
    const flags = []
    const det = {}
    let info = null
    const brand = pf.filter(isBrand)
    const non = pf.filter((f) => !isBrand(f))
    const glyphs = pf.reduce((a, f) => a + f.glyphCount, 0)
    if (non.length) { flags.push('F-NONBRAND'); det.nonBrand = non.map((f) => `${f.familyName}${f.isCustomFont ? ' (web)' : ''}:${f.glyphCount}`) }
    if (!pf.length && r.vis === 'visible' && r.n > 0 && !(r.ctl && !r.ctl.hasValue && !r.ctl.hasPlaceholder)) flags.push('F-NOPF')
    // (b) weight / style against the faces of the family that heads the stack
    const head = splitStack(st.ff).find((n) => faceBy.has(n.toLowerCase()))
    if (head && r.vis !== 'nobox') {
      const faces = faceBy.get(head.toLowerCase())
      const wantItalic = /italic|oblique/.test(st.fst)
      const italicFaces = faces.filter((f) => /italic|oblique/.test(f.style))
      const group = wantItalic && italicFaces.length ? italicFaces : faces.filter((f) => !/italic|oblique/.test(f.style))
      const m = matchWeight(st.fw, group.map((f) => weightRange(f.weight)))
      const synthW = !st.fsyn || /weight/.test(st.fsyn)
      const synthS = !st.fsyn || /style/.test(st.fsyn)
      if (m && !m.exact) { flags.push('F-WEIGHT'); det.weight = `requested ${st.fw}, ${head} has no such face; Chrome uses ${m.used}`; det.weightRequested = st.fw; det.weightUsed = m.used }
      if (m && st.fw >= 600 && m.used < 600 && synthW) { flags.push('F-SYNTH-BOLD'); det.synthBold = `${head} best face ${m.used} < 600 for requested ${st.fw}` }
      if (wantItalic && !italicFaces.length && synthS) { flags.push('F-STYLE'); det.style = `${st.fst} requested, ${head} has no italic face: synthetic slant` }
    }
    // (c) Arabic typography
    if (r.sc.ar > 0) {
      if (/italic|oblique/.test(st.fst)) flags.push('F-AR-ITALIC')
      // 0.01em is the line: below it (0.005em on a 14px label = 0.07px) nothing can be seen, so it is only noted in info[]
      if (st.ls !== 'normal' && Math.abs(st.ls) / st.fs >= 0.01) { flags.push('F-AR-SPACING'); det.letterSpacing = `${PX(st.ls)}px = ${PX(st.ls / st.fs)}em` }
      else if (st.ls !== 'normal' && Math.abs(st.ls) > 0.001) (info ||= []).push(`ar-spacing-tiny ${PX(st.ls)}px = ${Math.round((st.ls / st.fs) * 1000) / 1000}em`)
      if (/uppercase|capitalize/.test(st.tt)) flags.push('F-AR-UPPER')
      if (r.lines >= 2 && st.lh !== 'normal' && st.lh / st.fs < 1.5) { flags.push('F-AR-LEADING'); det.leading = `${PX(st.lh / st.fs)} over ${r.lines} lines`; det.leadingFor = r.roles.includes('heading') ? 'heading' : 'text' }
    }
    if (r.sc.dw && r.sc.da) flags.push('F-MIXED-DIGITS')
    // (e) small text on phones
    if (phone && r.vis === 'visible' && st.fs < MIN_PHONE_PX - 0.01) {
      const why = smallAllow(r)
      if (why) r.allowed = why
      else flags.push('F-SMALL')
    }
    // (f) price digits
    if (r.price && r.vis !== 'nobox' && !/tabular/.test(st.fvn)) {
      const bad = []
      if (r.sc.dw && tabular.get(r.st + '|w') === false) bad.push('western')
      if (r.sc.da && tabular.get(r.st + '|a') === false) bad.push('arabic-indic')
      if (bad.length) { flags.push('F-PRICE-PROP'); det.priceDigits = `font-variant-numeric "${st.fvn}"; ${bad.join('+')} digits differ in width` }
    }
    const out = { i: r.i, sel: r.sel, tag: r.tag, region: r.region, roles: r.roles, txt: r.txt, n: r.n, sc: r.sc, dom: r.sc.ar >= r.sc.lat && r.sc.ar > 0 ? 'arabic' : r.sc.lat > 0 ? 'latin' : r.sc.dw + r.sc.da > 0 ? 'digits' : 'symbol', mixed: r.sc.ar > 0 && r.sc.lat > 0, st: r.st, lang: r.lang, rect: r.rect, lines: r.lines, vis: r.vis, pf: pf.map((f) => [fontId(f), f.glyphCount]), glyphs, brandGlyphs: brand.reduce((a, f) => a + f.glyphCount, 0) }
    if (r.price) out.price = true
    if (r.ctl) out.ctl = r.ctl
    if (r.allowed) out.allowed = r.allowed
    if (flags.length) { out.flags = flags; out.det = det }
    if (info) out.info = info
    const cu = culprits && culprits.get(r.i)
    if (cu) out.culprits = cu
    runs.push(out)
  }
  // (d) controls
  const ctlFlags = []
  for (const c of raw.controls) {
    const seen = c.w > 0 && c.h > 0 && !c.offscreen && !c.inert
    const f = []
    if (seen && !brandStacks.has(c.ff)) f.push('F-CTL-FAMILY')
    if (seen && phone && c.textEntry && c.fs < 16 - 0.01) f.push('F-CTL-LT16')
    c.flags = f
    c.seen = seen
    if (f.length) ctlFlags.push(c)
  }
  for (const r of runs) {
    if (r.ctl && r.ctl.placeholderFamily && r.ctl.placeholderFamily !== raw.styles[r.st].ff) { (r.flags ||= []).push('F-CTL-FAMILY'); (r.det ||= {}).placeholder = `placeholder family differs: ${r.ctl.placeholderFamily}` }
  }
  return { fonts, runs, controls: raw.controls }
}

// Per-state numbers a reader wants first.
function summarise(runs, fonts, controls) {
  const s = { runs: runs.length, visibleRuns: 0, vis: {}, glyphs: {}, glyphsVisible: {}, flags: {}, flagsVisible: {}, nonBrandRunsVisible: 0, smallAllowed: {}, ctl: { total: controls.length, seen: 0, flagged: 0 } }
  for (const r of runs) {
    s.vis[r.vis] = (s.vis[r.vis] || 0) + 1
    if (r.vis === 'visible') s.visibleRuns++
    for (const [fi, g] of r.pf) {
      const n = (fonts[fi].ps || fonts[fi].name) + (fonts[fi].web ? '' : ' [system]') // the PostScript name tells Regular from Bold, the family name does not
      s.glyphs[n] = (s.glyphs[n] || 0) + g
      if (r.vis === 'visible') s.glyphsVisible[n] = (s.glyphsVisible[n] || 0) + g
    }
    for (const f of r.flags || []) {
      s.flags[f] = (s.flags[f] || 0) + 1
      if (r.vis === 'visible') s.flagsVisible[f] = (s.flagsVisible[f] || 0) + 1
    }
    if (r.vis === 'visible' && (r.flags || []).includes('F-NONBRAND')) s.nonBrandRunsVisible++
    if (r.allowed) s.smallAllowed[r.allowed] = (s.smallAllowed[r.allowed] || 0) + 1
  }
  for (const c of controls) { if (c.seen) s.ctl.seen++; if (c.flags && c.flags.length) s.ctl.flagged++ }
  return s
}

// Bounded parallel map.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i) }
  }))
  return out
}

// ---------------------------------------------------------------------------------------------
// BROWSER PLUMBING
// ---------------------------------------------------------------------------------------------
const ctxOptions = (width, lang) => {
  const phone = width <= PHONE_MAX
  return {
    viewport: { width, height: phone ? 844 : 900 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US', timezoneId: 'Asia/Kuwait',
    colorScheme: 'light', deviceScaleFactor: 1,
    // a phone is a touch device: the add-on CSS keys several sizes on (pointer: coarse)
    isMobile: phone, hasTouch: phone,
    serviceWorkers: 'block', // a worker could answer from its cache and hide the network
  }
}

// Read-only guard: anything but GET is aborted and listed; third-party hosts are aborted when EXTERNAL=block.
let EXTERNAL_BLOCK = false
// STUB_MISSING_CSS (default ON with the mirror, OFF with BASE): the mirror was captured without three lazy route
// stylesheets, and without them the app's error boundary replaces /returns, /exchange, /account and /backends (the
// audit would then measure an error page). With this on, a /assets/*.css the server answers 404 to is answered with an
// EMPTY stylesheet instead, so the real page renders; each such file is listed in the state's stubbedCss. What the
// missing route CSS would have set (sizes, weights, spacing on those pages) is then NOT measured - the state says so.
let STUB_CSS = false
async function guard(ctx, base, rec) {
  const origin = new URL(base).origin
  rec.stubbed = []
  await ctx.route('**/*', async (route) => {
    const req = route.request()
    let u
    try { u = new URL(req.url()) } catch { return route.continue() }
    if (req.method() !== 'GET') { rec.blocked.push({ method: req.method(), url: req.url().slice(0, 160) }); return route.abort('blockedbyclient') }
    if (EXTERNAL_BLOCK && u.origin !== origin) { rec.external.push({ url: req.url().slice(0, 160), type: req.resourceType() }); return route.abort('blockedbyclient') }
    if (STUB_CSS && u.origin === origin && /^\/assets\/[^/]+\.css$/.test(u.pathname)) {
      try {
        const resp = await route.fetch()
        if (resp.status() === 404) { rec.stubbed.push(u.pathname); return route.fulfill({ status: 200, contentType: 'text/css', body: '/* fonts-audit: stub for a stylesheet the server does not have */' }) }
        return route.fulfill({ response: resp })
      } catch { return route.continue() }
    }
    return route.continue()
  })
}

// Every request with its status, size and headers, from CDP (the page cannot see headers or failures).
function netRecorder(cdp) {
  const reqs = new Map()
  let t0 = null
  const get = (id) => reqs.get(id)
  cdp.on('Network.requestWillBeSent', (e) => {
    if (t0 == null && e.type === 'Document') t0 = e.timestamp
    reqs.set(e.requestId, { url: e.request.url, method: e.request.method, type: e.type, t: e.timestamp, initiator: e.initiator && e.initiator.type })
  })
  cdp.on('Network.responseReceived', (e) => {
    const r = get(e.requestId)
    if (!r) return
    r.status = e.response.status; r.mime = e.response.mimeType; r.headers = e.response.headers; r.fromCache = !!(e.response.fromDiskCache || e.response.fromPrefetchCache); r.protocol = e.response.protocol
  })
  cdp.on('Network.dataReceived', (e) => { const r = get(e.requestId); if (r) r.decoded = (r.decoded || 0) + e.dataLength })
  cdp.on('Network.loadingFinished', (e) => { const r = get(e.requestId); if (r) { r.encoded = e.encodedDataLength; r.tEnd = e.timestamp } })
  cdp.on('Network.loadingFailed', (e) => { const r = get(e.requestId); if (r) { r.failed = e.errorText; r.blockedReason = e.blockedReason || null; r.tEnd = e.timestamp } })
  return { reqs, t0: () => t0 }
}
const FONT_URL = /\.(woff2?|ttf|otf|eot)(\?|$)/i
const FONT_HOST = /typekit\.net|fonts\.(googleapis|gstatic)\.com|fonts\.adobe\.com|use\.fontawesome|kit\.fontawesome/i
const KEEP_HEADERS = ['content-type', 'content-length', 'content-encoding', 'cache-control', 'expires', 'etag', 'last-modified', 'age', 'vary', 'access-control-allow-origin', 'x-content-type-options', 'accept-ranges', 'server']
function fontRequests(net) {
  const t0 = net.t0()
  const pick = (h) => Object.fromEntries(Object.entries(h || {}).filter(([k]) => KEEP_HEADERS.includes(k.toLowerCase())).map(([k, v]) => [k.toLowerCase(), v]))
  const row = (r) => ({ url: r.url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, ''), type: r.type, status: r.status ?? null, mime: r.mime || null, transferred: r.encoded ?? null, decoded: r.decoded ?? null, fromCache: !!r.fromCache, failed: r.failed || null, blockedReason: r.blockedReason || null, startMs: t0 != null ? Math.round((r.t - t0) * 1000) : null, endMs: t0 != null && r.tEnd ? Math.round((r.tEnd - t0) * 1000) : null, headers: pick(r.headers) })
  const files = [], hosts = []
  for (const r of net.reqs.values()) {
    if (r.type === 'Font' || /^font\/|font-woff|x-font/.test(r.mime || '') || FONT_URL.test(r.url.split('?')[0])) files.push(row(r))
    else if (FONT_HOST.test(r.url)) hosts.push(row(r))
  }
  return { files, hosts }
}

// Chrome's own answer to "which font file drew the text of the elements tagged <attr>=<index>".
async function platformFonts(cdp, attr, count) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `[${attr}]` })
  const out = Array.from({ length: count }, () => [])
  await mapLimit(nodeIds, 24, async (nodeId) => {
    const { attributes } = await cdp.send('DOM.getAttributes', { nodeId })
    const i = Number(attributes[attributes.indexOf(attr) + 1])
    const r = await cdp.send('CSS.getPlatformFontsForNode', { nodeId }).catch(() => ({ fonts: [] }))
    if (Number.isInteger(i) && i >= 0 && i < count) out[i] = r.fonts || []
  })
  return out
}

const fontsSettled = (page) => page.evaluate(async () => {
  await document.fonts.ready
  const t = performance.now()
  while ([...document.fonts].some((f) => f.status === 'loading') && performance.now() - t < 5000) await new Promise((r) => setTimeout(r, 100))
  await document.fonts.ready
})

// Wait for the app to be what a visitor sees: shell replaced, lazy route chunk in, skeletons gone, network quiet,
// every font the visible text needs downloaded. Each wait is bounded and records why it gave up.
async function settle(page, rec) {
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => rec.notes.push('load event not seen in 30s'))
  await page.waitForFunction(() => !document.querySelector('#root > .boot'), null, { timeout: 15000 }).catch(() => rec.notes.push('boot shell still on screen after 15s'))
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => rec.notes.push('network not idle in 10s'))
  await page.waitForFunction(() => document.querySelectorAll('.skeleton').length === 0, null, { timeout: 8000 }).catch(() => rec.notes.push('skeletons still on screen after 8s'))
  await page.evaluate(SCROLL_PASS)
  await fontsSettled(page)
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(250)
}

// ---------------------------------------------------------------------------------------------
// MEASURE ONE LOADED PAGE (shared by the crawl and the self-test)
// ---------------------------------------------------------------------------------------------
async function measure(page, cdp, width) {
  const raw = await page.evaluate(COLLECT)
  const pf = await platformFonts(cdp, 'data-fa', raw.runs.length)
  // are a price's digits tabular in the font as it really is? one probe per (style, digit kind), each digit repeated
  const need = tabularNeeds(raw)
  const tabular = new Map()
  if (need.size) {
    const items = [], owners = []
    for (const [k, { st, kind }] of need) for (const d of DIGITS[kind]) { items.push({ ff: st.ff, fw: st.fw, fst: st.fst, fvn: st.fvn, ffs: st.ffs, fs: 40, text: d.repeat(8) }); owners.push(k) }
    const widths = await page.evaluate(PROBE, [items, 'width'])
    const by = new Map()
    widths.forEach((w, i) => { (by.get(owners[i]) || by.set(owners[i], []).get(owners[i])).push(w / 8) })
    for (const [k, ws] of by) tabular.set(k, Math.max(...ws) - Math.min(...ws) < 0.05)
  }
  // which CHARACTERS go to a non-brand font: re-render each distinct character of a flagged run alone, same font settings
  let culprits = null
  const first = analyse(raw, pf, width, tabular, null)
  const nb = first.runs.filter((r) => (r.flags || []).includes('F-NONBRAND'))
  if (nb.length) {
    const items = [], at = new Map()
    for (const r of nb) {
      const st = raw.styles[r.st]
      for (const ch of raw.runs[r.i].chars) {
        const k = r.st + '|' + ch
        if (!at.has(k) && items.length < 1500) { at.set(k, items.length); items.push({ ff: st.ff, fw: st.fw, fst: st.fst, fvn: st.fvn, ffs: st.ffs, fs: 24, text: ch }) }
      }
    }
    await page.evaluate(PROBE, [items, 'node'])
    const ppf = await platformFonts(cdp, 'data-fp', items.length)
    culprits = new Map()
    for (const r of nb) {
      const list = []
      const chars = raw.runs[r.i].chars
      for (const ch of chars) {
        const i = at.get(r.st + '|' + ch)
        if (i == null) continue
        const bad = ppf[i].filter((f) => !isBrand(f))
        if (bad.length) list.push({ ch, cp: 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), font: bad.map((f) => f.familyName).join('+') })
      }
      culprits.set(r.i, { count: list.length, of: chars.length, list: list.slice(0, 16) })
    }
  }
  await page.evaluate(CLEAN)
  const a = analyse(raw, pf, width, tabular, culprits)
  return { raw, ...a, summary: summarise(a.runs, a.fonts, a.controls) }
}

// ---------------------------------------------------------------------------------------------
// ONE PAGE-STATE
// ---------------------------------------------------------------------------------------------
const seedScript = (a) => {
  try {
    if (a.cart && !localStorage.getItem('sporta_cart')) localStorage.setItem('sporta_cart', JSON.stringify(a.cart))
    if (a.wishlist && !localStorage.getItem('sporta_wishlist')) localStorage.setItem('sporta_wishlist', JSON.stringify(a.wishlist))
    if (a.delivery && !localStorage.getItem('sporta.delivery')) { localStorage.setItem('sporta.delivery', JSON.stringify(a.delivery)); localStorage.setItem('sporta.delivery.remember', '1') }
  } catch {}
}
const writeJson = (file, obj) => writeFileSync(path.join(OUT, file), JSON.stringify(obj))

async function auditState(browser, base, spec, lang, width) {
  const name = stateName(spec.id, lang, width)
  const rec = { blocked: [], external: [], notes: [], errors: [], console: [] }
  const ctx = await browser.newContext(ctxOptions(width, lang))
  const head = { tool: 'fonts-audit.mjs', version: 1, kind: 'page-state', name, state: { id: spec.id, path: spec.path, act: spec.act || null, seed: spec.seed ? Object.keys(spec.seed) : [] }, lang, width, height: ctxOptions(width, lang).viewport.height }
  try {
    await guard(ctx, base, rec)
    if (spec.seed) await ctx.addInitScript(seedScript, { cart: spec.seed.cart ? CART : null, wishlist: spec.seed.wishlist ? WISHLIST : null, delivery: spec.seed.delivery ? DELIVERY : null })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => rec.errors.push(String(e.message).slice(0, 200)))
    page.on('console', (m) => { if (m.type() === 'error' || /font/i.test(m.text())) rec.console.push(m.type() + ': ' + m.text().slice(0, 200)) })
    rec.navigations = 0
    page.on('domcontentloaded', () => rec.navigations++) // one per DOCUMENT load (a client-side route change does not count)
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable'); await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
    const net = netRecorder(cdp)
    const resp = await page.goto(base + withLang(spec.path, lang), { waitUntil: 'load', timeout: 45000 })
    await settle(page, rec)
    let act = null
    if (spec.act) {
      act = await ACT[spec.act](page)
      if (act && act.skipped) { const out = { ...head, skipped: act.skipped }; writeJson(name + '.json', out); return out }
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
      await fontsSettled(page)
      await page.waitForTimeout(200)
    }
    const m = await measure(page, cdp, width)
    const fr = fontRequests(net)
    // Things that make a state's numbers less trustworthy, said out loud: a lazy route's own stylesheet that did not
    // load (the page then renders without it), and the app reloading itself once after a failed chunk preload.
    const failed = [...net.reqs.values()].filter((r) => (r.failed && !r.blockedReason && !/typekit/.test(r.url)) || r.status >= 400).map((r) => ({ url: r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 120), status: r.status ?? null, failed: r.failed || null }))
    const cssMissing = rec.console.filter((c) => /Unable to preload CSS/.test(c)).length > 0
    if (rec.stubbed.length) rec.notes.push('route stylesheet(s) the server lacks were replaced by EMPTY stubs (' + rec.stubbed.join(', ') + '): what they would set on this page is not measured')
    if (cssMissing) rec.notes.push('a lazy route stylesheet failed to load (Unable to preload CSS): this page rendered WITHOUT its route CSS')
    if (rec.navigations > 1) rec.notes.push('the document loaded ' + rec.navigations + ' times (the app reloads once after a failed chunk preload): font files may show as requested twice')
    const { raw } = m
    const out = {
      ...head, status: resp ? resp.status() : null, url: base + withLang(spec.path, lang), finalUrl: page.url().replace(base, ''), actResult: act,
      page: { title: raw.title, htmlLang: raw.htmlLang, htmlDir: raw.htmlDir, rootFontPx: raw.rootFs, bodyFamily: raw.bodyFf, bodyFontPx: raw.bodyFs, docHeight: raw.docHeight, mounted: raw.mounted, skeletonsLeft: raw.skeletons },
      summary: m.summary, platformFonts: m.fonts, styles: raw.styles, runs: m.runs, controls: m.controls,
      documentFonts: raw.faces, fontFaceRules: raw.rules, fontLinks: raw.links, fontRequests: fr.files, fontHostRequests: fr.hosts,
      blockedWrites: rec.blocked, externalBlocked: rec.external, pageErrors: rec.errors, console: rec.console.slice(0, 10), failedRequests: failed.slice(0, 20),
      routeCssMissing: cssMissing, stubbedCss: rec.stubbed, navigations: rec.navigations, notes: rec.notes,
    }
    writeJson(name + '.json', out)
    return out
  } catch (e) {
    const out = { ...head, error: String(e && e.message || e).slice(0, 400), notes: rec.notes }
    writeJson(name + '.json', out)
    return out
  } finally {
    await ctx.close().catch(() => {})
  }
}

// ---------------------------------------------------------------------------------------------
// THE SLOW-NETWORK PASS: what a shopper on a weak phone sees while the fonts arrive.
// FOUT = text visible in the fallback before the web font lands. FOIT = text hidden while it loads (only a face
// with font-display auto/block does that; every face in the shipped CSS says swap). Times are ms from navigation
// start, read in the page with performance.now() and ResourceTiming so they share one clock.
// "First text" is the first animation frame in which a visible text node exists in the viewport (a frame's
// resolution, ~16ms before CPU slowdown): the shell has an image but no text, so FCP is not a text paint.
// A layout shift is attributed to fonts when it starts within SWAP_WINDOW ms after a brand face finished loading.
// ---------------------------------------------------------------------------------------------
const SWAP_WINDOW = 300
async function throttledState(browser, base, spec, lang, width) {
  const name = 'throttled__' + stateName(spec.id, lang, width)
  const rec = { blocked: [], external: [], notes: [], errors: [], console: [] }
  const ctx = await browser.newContext(ctxOptions(width, lang))
  const head = { tool: 'fonts-audit.mjs', version: 1, kind: 'throttled', name, state: { id: spec.id, path: spec.path }, lang, width, profile: { downKbps: NET.down * 8 / 1000, upKbps: NET.up * 8 / 1000, latencyMs: NET.latency, cpuSlowdown: THROTTLE_CPU } }
  try {
    await guard(ctx, base, rec)
    await ctx.addInitScript(INSTALL_PROBE)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => rec.errors.push(String(e.message).slice(0, 200)))
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable'); await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
    const net = netRecorder(cdp)
    // The page hits a `debugger` statement in the very frame its first text appears. While it is frozen there no web
    // font can arrive, so this side asks Chrome which platform font drew each of those elements at that exact moment
    // (a fallback standing in for a web font that has not landed shows up here), then lets the page go on.
    let snap = null
    await cdp.send('Debugger.enable')
    cdp.on('Debugger.paused', (e) => {
      if (snap) { cdp.send('Debugger.resume').catch(() => {}); return }
      snap = (async () => {
        try {
          const ev = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: e.callFrames[0].callFrameId, expression: 'JSON.stringify(window.__fa.ftItems)', returnByValue: true })
          const items = JSON.parse(ev.result.value)
          const pf = await platformFonts(cdp, 'data-fa-ft', items.length)
          return items.map((it, i) => ({ ...it, fonts: pf[i].map((f) => ({ name: f.familyName, ps: f.postScriptName || null, web: !!f.isCustomFont, brand: isBrand(f), glyphs: f.glyphCount })) }))
        } catch (err) {
          return { error: String(err).slice(0, 160) }
        } finally {
          await cdp.send('Debugger.resume').catch(() => {})
        }
      })()
    })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: NET.latency, downloadThroughput: NET.down, uploadThroughput: NET.up })
    if (THROTTLE_CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE_CPU })
    const wall = Date.now()
    await page.goto(base + withLang(spec.path, lang), { waitUntil: 'load', timeout: 120000 })
    await page.waitForLoadState('networkidle', { timeout: 40000 }).catch(() => rec.notes.push('network not idle in 40s'))
    await page.waitForTimeout(2500) // late swaps and the shifts they cause
    const fa = await page.evaluate(() => window.__fa)
    const firstTextFonts = snap ? await snap : null
    const preloads = await page.evaluate(() => [...document.querySelectorAll('link[rel~=preload][as=font]')].map((l) => l.getAttribute('href')))
    const timing = await page.evaluate(() => {
      const res = performance.getEntriesByType('resource')
      const font = res.filter((e) => /\.(woff2?|ttf|otf)(\?|$)|typekit|fonts\.(googleapis|gstatic)/.test(e.name)).map((e) => ({ url: e.name.replace(location.origin, ''), start: Math.round(e.startTime), end: Math.round(e.responseEnd), encoded: e.encodedBodySize, decoded: e.decodedBodySize }))
      const css = res.filter((e) => e.initiatorType === 'link' && /\.css(\?|$)/.test(e.name)).map((e) => Math.round(e.responseEnd))
      const nav = performance.getEntriesByType('navigation')[0]
      return { font, stylesheetsDoneMs: css.length ? Math.max(...css) : null, ttfbMs: nav ? Math.round(nav.responseStart) : null, loadMs: nav ? Math.round(nav.loadEventEnd) : null, htmlLang: document.documentElement.lang, mounted: !document.querySelector('#root > .boot') }
    })
    const faces = Object.values(fa.faces)
    const brand = faces.filter((f) => !/fallback/i.test(f.family))
    const loaded = brand.map((f) => f.loaded).filter((x) => x != null)
    const firstBrand = loaded.length ? Math.min(...loaded) : null
    const lastBrand = loaded.length ? Math.max(...loaded) : null
    const ft = fa.firstText
    const shifts = fa.shifts.map((s) => {
      const near = loaded.filter((t) => s.t >= t && s.t - t <= SWAP_WINDOW).sort((a, b) => b - a)[0]
      const face = near != null ? brand.find((f) => f.loaded === near) : null
      return { ...s, nearFontSwap: near != null, fontLoadedAtMs: near != null ? Math.round(near) : null, face: face ? `${face.family} ${face.weight} ${face.ur.slice(0, 14)}` : null }
    })
    const cls = shifts.filter((s) => !s.input).reduce((a, s) => a + s.v, 0)
    const clsFont = shifts.filter((s) => !s.input && s.nearFontSwap).reduce((a, s) => a + s.v, 0)
    const fontFirstStart = timing.font.length ? Math.min(...timing.font.map((f) => f.start)) : null
    // Brand faces that finished AFTER the first text was already on screen: text that needed them was drawn in a fallback until then.
    const late = ft ? brand.filter((f) => f.loaded != null && f.loaded > ft.t).map((f) => ({ face: `${f.family} ${f.weight} ${f.ur.slice(0, 14)}`, loadedMs: Math.round(f.loaded), afterFirstTextMs: Math.round(f.loaded - ft.t) })).sort((a, b) => a.loadedMs - b.loadedMs) : []
    // What the first screenful of text was drawn with, glyph by glyph, at the moment it appeared.
    const ftGlyphs = {}
    if (Array.isArray(firstTextFonts)) for (const it of firstTextFonts) for (const f of it.fonts) { const k = (f.ps || f.name) + (f.web ? '' : ' [system]'); ftGlyphs[k] = (ftGlyphs[k] || 0) + f.glyphs }
    const derived = {
      fcpMs: fa.paint['first-contentful-paint'] != null ? Math.round(fa.paint['first-contentful-paint']) : null,
      lcpMs: fa.lcp ? Math.round(fa.lcp.t) : null, lcpElement: fa.lcp ? fa.lcp.el : null,
      firstTextMs: ft ? Math.round(ft.t) : null, firstTextElement: ft ? ft.sel : null, firstTextSample: ft ? ft.text : null, firstTextFamily: ft ? ft.ff : null,
      preloadedFontFiles: preloads, firstTextGlyphsByFont: ftGlyphs,
      firstTextGlyphsNonBrand: Array.isArray(firstTextFonts) ? firstTextFonts.reduce((a, it) => a + it.fonts.filter((f) => !f.brand).reduce((b, f) => b + f.glyphs, 0), 0) : null,
      firstTextGlyphsTotal: Array.isArray(firstTextFonts) ? firstTextFonts.reduce((a, it) => a + it.fonts.reduce((b, f) => b + f.glyphs, 0), 0) : null,
      brandFacesLateAfterFirstText: late,
      brandFacesLoadedAtFirstText: ft ? ft.faces.filter((f) => !/fallback/i.test(f.family) && f.status === 'loaded').length : null,
      textShownBeforeBrandFont: ft && firstBrand != null ? ft.t < firstBrand : null,
      foutMs: ft && firstBrand != null ? Math.max(0, Math.round(firstBrand - ft.t)) : null,
      fullSwapMs: ft && lastBrand != null ? Math.max(0, Math.round(lastBrand - ft.t)) : null,
      foitRiskAtFirstText: ft ? ft.faces.filter((f) => f.status === 'loading' && (f.display === 'auto' || f.display === 'block')).map((f) => f.family + ' ' + f.weight) : null,
      declaredDisplay: [...new Set(faces.map((f) => f.display || 'auto'))],
      firstBrandLoadedMs: firstBrand != null ? Math.round(firstBrand) : null, lastBrandLoadedMs: lastBrand != null ? Math.round(lastBrand) : null,
      fontFirstRequestMs: fontFirstStart, stylesheetsDoneMs: timing.stylesheetsDoneMs,
      fontStartLagAfterCssMs: fontFirstStart != null && timing.stylesheetsDoneMs != null ? fontFirstStart - timing.stylesheetsDoneMs : null,
      fontBytesBeforeFirstText: ft ? timing.font.filter((f) => f.end <= ft.t).reduce((a, f) => a + (f.encoded || 0), 0) : null,
      fontBytesTotal: timing.font.reduce((a, f) => a + (f.encoded || 0), 0),
      clsTotal: PX(cls), clsFromFontSwap: PX(clsFont), shiftCount: shifts.length,
    }
    const out = { ...head, derived, firstText: ft, firstTextFonts, faces: faces.map((f) => ({ ...f, loading: f.loading != null ? Math.round(f.loading) : null, loaded: f.loaded != null ? Math.round(f.loaded) : null })), shifts, lcp: fa.lcp, paint: fa.paint, timing, fontRequests: fontRequests(net), probeErrors: fa.err, htmlLang: timing.htmlLang, mounted: timing.mounted, wallClockMs: Date.now() - wall, blockedWrites: rec.blocked, externalBlocked: rec.external, pageErrors: rec.errors, notes: rec.notes }
    writeJson(name + '.json', out)
    return out
  } catch (e) {
    const out = { ...head, error: String(e && e.message || e).slice(0, 400), notes: rec.notes }
    writeJson(name + '.json', out)
    return out
  } finally {
    await ctx.close().catch(() => {})
  }
}

// ---------------------------------------------------------------------------------------------
// RUNNING: one browser, at most PAGES contexts at a time, each task bounded by STATE_TIMEOUT.
// ---------------------------------------------------------------------------------------------
async function startMirror() {
  if (!existsSync(MIRROR)) throw new Error(`no BASE given and the mirror script is missing: ${MIRROR} (set BASE=https://... or MIRROR=<path to serve.mjs>)`)
  const child = spawn(process.execPath, [MIRROR], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] })
  const base = await new Promise((resolve, reject) => {
    let buf = ''
    const t = setTimeout(() => reject(new Error('the mirror did not report MIRROR_UP within 10s')), 10000)
    child.stdout.on('data', (d) => { buf += d; const m = buf.match(/MIRROR_UP (\S+)/); if (m) { clearTimeout(t); resolve(m[1]) } })
    child.on('exit', (c) => reject(new Error('the mirror exited with code ' + c)))
  })
  return { base, stop: () => { try { child.kill('SIGTERM') } catch {} } }
}
const launch = () => {
  const exe = ENV.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'].find(existsSync)
  return chromium.launch({ args: ['--no-sandbox'], ...(exe ? { executablePath: exe } : {}) })
}
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timed out after ' + ms + 'ms')), ms))])

// ---------------------------------------------------------------------------------------------
// SELF-TEST: the tool run against a page that is wrong on purpose. A clean report on the real site only means
// something if the same tool, shown a forced Arial, an Arabic run with letter-spacing and an input in the browser's
// default font, says so. Exit code 1 if any expectation fails. The brand faces come from public/fonts.
// ---------------------------------------------------------------------------------------------
const FX_LAT = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF'
const FX_ARB = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC'
const FX_PLEX = [400, 600, 700].flatMap((w) => [['latin', FX_LAT], ['arabic', FX_ARB]].map(([n, ur]) => `@font-face{font-family:FxPlex;font-weight:${w};font-display:swap;src:url(/fonts/plex-${w}-${n}.woff2) format("woff2");unicode-range:${ur}}`)).join('\n')
const FX_CSS = `
@font-face{font-family:FxAlex;font-weight:100 900;font-display:swap;src:url(/fonts/alexandria-var-latin.woff2) format("woff2-variations");unicode-range:${FX_LAT}}
@font-face{font-family:FxAlex;font-weight:100 900;font-display:swap;src:url(/fonts/alexandria-var-arabic.woff2) format("woff2-variations");unicode-range:${FX_ARB}}
${FX_PLEX}
@font-face{font-family:FxOnly400;font-weight:400;font-display:swap;src:url(/fonts/plex-400-latin.woff2) format("woff2");unicode-range:${FX_LAT}}
body{margin:0;padding:8px;font:16px/1.7 FxPlex,sans-serif}
.d{font-family:FxAlex,sans-serif;font-weight:800;line-height:1.3}
.i{font:inherit}
p{margin:4px 0}
`
// [id, element html, flags it must raise ([] = must raise none), where ('run' or 'control')]
const FX_OK = [
  ['ok-h', '<h1 id="ok-h" class="d" style="font-size:28px">Strong heading</h1>'],
  ['ok-latin', '<p id="ok-latin">Plex body text, regular weight.</p>'],
  ['ok-semibold', '<p id="ok-semibold" style="font-weight:600">Plex 600.</p>'],
  ['ok-bold', '<p id="ok-bold" style="font-weight:700">Plex bold 700.</p>'],
  ['ok-ar', '<p id="ok-ar">\u0646\u0635 \u0639\u0631\u0628\u064a \u0639\u0627\u062f\u064a \u0641\u064a \u0635\u0641\u062d\u0629 \u0627\u0644\u0645\u062a\u062c\u0631</p>'],
  ['ok-ar-wrap', '<p id="ok-ar-wrap" style="width:150px">\u0646\u0635 \u0639\u0631\u0628\u064a \u0637\u0648\u064a\u0644 \u064a\u0644\u062a\u0641 \u0639\u0644\u0649 \u0639\u062f\u0629 \u0623\u0633\u0637\u0631 \u062f\u0627\u062e\u0644 \u0639\u0645\u0648\u062f \u0636\u064a\u0642</p>'],
  ['ok-price', '<span id="ok-price" class="d" style="font-weight:600;font-size:18px;font-variant-numeric:tabular-nums">KD 12.500</span>'],
  ['ok-price-plex', '<p id="ok-price-plex">KD 12.500</p>'],
  ['ok-input', '<input id="ok-input" class="i" placeholder="Name">'],
  ['ok-button', '<button id="ok-button" class="i" type="button">Apply</button>'],
  ['ok-promo', '<p id="ok-promo" class="topbar" style="font-size:11px">Delivery within 24 hours</p>'],
  // a SENTENCE that mentions a price in the display font is not a price column (it used to be flagged as one)
  ['ok-sentence', '<p id="ok-sentence" class="d" style="font-size:16px;font-weight:600">\u0627\u0644\u062a\u0648\u0635\u064a\u0644 \u062e\u0644\u0627\u0644 \u0662\u0664 \u0633\u0627\u0639\u0629 \u00b7 \u0661 \u062f.\u0643</p>'],
  // 0.005em is invisible: noted in info[], not flagged
  // a bare number outside any price box is not a price either (the 404 numeral, a result count, a step number)
  ['ok-number', '<p id="ok-number" class="d" style="font-size:40px">404</p>'],
  ['ok-spacing-tiny', '<p id="ok-spacing-tiny" style="letter-spacing:.005em">\u0646\u0635 \u0639\u0631\u0628\u064a</p>'],
  // a closed <details> answer draws no text: hidden, so no measurement gap is reported for it
  ['ok-details', '<details><summary id="ok-summary">Q</summary><p id="ok-details">Closed answer text</p></details>'],
]
const FX_BAD = [
  ['bad-arial', '<p id="bad-arial" style="font-family:Arial,Helvetica,sans-serif">Forced into Arial</p>', ['F-NONBRAND']],
  ['bad-glyph', '<p id="bad-glyph">Next \u2192 step</p>', ['F-NONBRAND'], { culprit: '\u2192' }],
  ['bad-spacing', '<p id="bad-spacing" style="letter-spacing:.08em">\u0646\u0635 \u0639\u0631\u0628\u064a \u0628\u062a\u0628\u0627\u0639\u062f \u062d\u0631\u0648\u0641</p>', ['F-AR-SPACING']],
  ['bad-italic', '<p id="bad-italic" style="font-style:italic">\u0646\u0635 \u0639\u0631\u0628\u064a \u0645\u0627\u0626\u0644</p>', ['F-AR-ITALIC', 'F-STYLE']],
  ['bad-upper', '<p id="bad-upper" style="text-transform:uppercase">\u0646\u0635 \u0639\u0631\u0628\u064a \u0628\u062d\u0631\u0648\u0641 \u0643\u0628\u064a\u0631\u0629</p>', ['F-AR-UPPER']],
  ['bad-leading', '<p id="bad-leading" style="width:130px;line-height:1.1">\u0646\u0635 \u0639\u0631\u0628\u064a \u0637\u0648\u064a\u0644 \u064a\u0644\u062a\u0641 \u0639\u0644\u0649 \u0639\u062f\u0629 \u0623\u0633\u0637\u0631</p>', ['F-AR-LEADING']],
  ['bad-input', '<input id="bad-input" value="Default font here">', ['F-NONBRAND'], { control: ['F-CTL-FAMILY', 'F-CTL-LT16'] }],
  ['bad-lt16', '<input id="bad-lt16" class="i" style="font-size:13px" value="x">', [], { control: ['F-CTL-LT16'] }],
  ['bad-weight', '<p id="bad-weight" style="font-weight:500">Weight 500 on a 400/600/700 family</p>', ['F-WEIGHT']],
  ['bad-synth', '<p id="bad-synth" style="font-family:FxOnly400,sans-serif;font-weight:700">Bold asked, only 400 shipped</p>', ['F-WEIGHT', 'F-SYNTH-BOLD']],
  ['bad-italic-latin', '<p id="bad-italic-latin" style="font-style:italic">Latin italic, no italic face</p>', ['F-STYLE']],
  ['bad-small', '<p id="bad-small" style="font-size:11px">Eleven pixel text</p>', ['F-SMALL']],
  ['bad-price', '<span id="bad-price" class="d" style="font-weight:600;font-size:18px">KD 18.888</span>', ['F-PRICE-PROP']],
  ['bad-digits', '<p id="bad-digits">12 \u0661\u0662</p>', ['F-MIXED-DIGITS']],
]
const fixtureHtml = (clean) => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>fixture</title><style>${FX_CSS}</style></head><body>${FX_OK.map((x) => x[1]).join('\n')}${clean ? '' : FX_BAD.map((x) => x[1]).join('\n')}</body></html>`

async function selftest() {
  const fonts = ENV.FONTS_DIR || path.join(HERE, '..', 'public', 'fonts')
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x')
    if (u.pathname.startsWith('/fonts/')) {
      const f = path.join(fonts, path.basename(u.pathname))
      if (existsSync(f)) { s.writeHead(200, { 'content-type': 'font/woff2' }); return s.end(readFileSync(f)) }
    }
    if (u.pathname === '/' || u.pathname === '/clean') { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return s.end(fixtureHtml(u.pathname === '/clean')) }
    s.writeHead(404); s.end()
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + srv.address().port
  const browser = await launch()
  let pass = 0, fail = 0
  const check = (ok, what) => { ok ? pass++ : fail++; console.log((ok ? '  PASS ' : '  FAIL ') + what) }
  try {
    for (const where of ['/', '/clean']) {
      const ctx = await browser.newContext(ctxOptions(390, 'ar'))
      const page = await ctx.newPage()
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
      await page.goto(base + where, { waitUntil: 'load' })
      await fontsSettled(page)
      const m = await measure(page, cdp, 390)
      const run = (id) => m.runs.find((r) => r.sel.split(' < ')[0].includes('#' + id))
      const ctl = (id) => m.controls.find((c) => c.sel.split(' < ')[0].includes('#' + id))
      console.log(where === '/' ? 'broken fixture:' : 'clean fixture (only the ok-* elements):')
      for (const [id] of FX_OK) { const r = run(id); const c = ctl(id); const fl = [...((r && r.flags) || []), ...((c && c.flags) || [])]; check(!!r && !fl.length, `${id} raises nothing` + (fl.length ? ` (got ${fl.join(',')})` : r ? '' : ' (run not found)')) }
      if (where === '/clean') {
        const all = m.runs.reduce((a, r) => a + (r.flags || []).length, 0) + m.controls.reduce((a, c) => a + (c.flags || []).length, 0)
        check(all === 0, 'the clean page has zero flags in total (' + all + ')')
        check(m.runs.filter((r) => r.vis === 'visible').every((r) => r.pf.length), 'every visible run got a platform font from Chrome')
        check(run('ok-details') && run('ok-details').vis === 'hidden', 'text inside a closed <details> is classed hidden')
        check(run('ok-sentence') && !run('ok-sentence').price, 'a sentence that mentions a price is not treated as a price')
        check(run('ok-number') && !run('ok-number').price, 'a bare number outside a price box is not treated as a price')
        check(run('ok-spacing-tiny') && (run('ok-spacing-tiny').info || []).length > 0, 'letter-spacing under 0.01em is noted in info[] only')
      } else {
        for (const [id, , want, extra] of FX_BAD) {
          const r = run(id)
          for (const f of want) check(!!r && (r.flags || []).includes(f), `${id} raises ${f}` + (r ? '' : ' (run not found)') + (r && !(r.flags || []).includes(f) ? ` (got ${(r.flags || []).join(',') || 'nothing'})` : ''))
          for (const f of (extra && extra.control) || []) { const c = ctl(id); check(!!c && (c.flags || []).includes(f), `${id} control raises ${f}` + (c ? '' : ' (control not found)')) }
          if (extra && extra.culprit) check(!!r && !!r.culprits && r.culprits.list.some((c) => c.ch === extra.culprit), `${id} names ${extra.culprit} as the character drawn by a non-brand font`)
        }
        check(run('bad-price') && run('bad-price').price, 'a number with a currency is treated as a price')
        const arial = run('bad-arial')
        const names = arial ? arial.pf.map(([i]) => m.fonts[i].name) : []
        console.log('  (forced-Arial run was drawn by: ' + names.join(', ') + ')')
        check(!!arial && arial.pf.every(([i]) => !m.fonts[i].brand), 'the forced-Arial run is drawn ONLY by non-brand fonts')
        check(m.runs.filter((r) => /#ok-/.test(r.sel) && (r.flags || []).length).length === 0, 'no ok-* element is flagged on the broken page either')
      }
      await ctx.close()
    }
  } finally {
    await browser.close().catch(() => {})
    srv.close()
  }
  console.log(`\nself-test: ${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
}

// ---------------------------------------------------------------------------------------------
// SUMMARY: tables from a data directory (also run automatically at the end of a crawl).
// ---------------------------------------------------------------------------------------------
const bump = (m, k, n = 1) => { m[k] = (m[k] || 0) + n }
function summarizeDir(dir, print = true) {
  const all = readdirSync(dir).filter((f) => f.endsWith('.json') && !/^(index|summary)\.json$/.test(f)).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')))
  const pageStates = all.filter((d) => d.kind === 'page-state')
  const ok = pageStates.filter((d) => d.runs)
  const thr = all.filter((d) => d.kind === 'throttled')
  const S = {
    tool: 'fonts-audit.mjs', dir,
    counts: { pageStatesMeasured: ok.length, skippedStates: pageStates.filter((d) => d.skipped).length, erroredStates: all.filter((d) => d.error).length, throttledRuns: thr.filter((d) => d.derived).length, textRuns: 0, visibleTextRuns: 0, controlsSeen: 0, glyphsAll: 0, glyphsVisible: 0 },
    glyphsVisibleByFont: {}, glyphsAllByFont: {}, weights: {}, caveats: [], duplicateFontFetches: [], byLang: {}, flags: {}, flagExamples: {}, culprits: {}, typeScale: {}, fontFiles: {}, faceStatus: {}, skipped: [], errors: [], allowedSmall: {}, controlFlags: {}, externalBlocked: {}, blockedWrites: 0, pageErrors: [], fontHostRequests: {},
    throttled: [],
  }
  for (const d of all) if (d.error) S.errors.push({ name: d.name, error: d.error })
  for (const d of pageStates) if (d.skipped) S.skipped.push({ name: d.name, why: d.skipped })
  for (const d of ok) {
    const L = (S.byLang[d.lang + '@' + d.width] ||= { states: 0, runs: 0, visibleRuns: 0, nonBrandVisible: 0, flagsVisible: {} })
    L.states++; L.runs += d.runs.length; L.visibleRuns += d.summary.visibleRuns; L.nonBrandVisible += d.summary.nonBrandRunsVisible
    S.counts.textRuns += d.runs.length; S.counts.visibleTextRuns += d.summary.visibleRuns; S.counts.controlsSeen += d.summary.ctl.seen
    for (const [k, v] of Object.entries(d.summary.glyphsVisible)) { bump(S.glyphsVisibleByFont, k, v); S.counts.glyphsVisible += v }
    for (const [k, v] of Object.entries(d.summary.glyphs)) { bump(S.glyphsAllByFont, k, v); S.counts.glyphsAll += v }
    for (const [k, v] of Object.entries(d.summary.flagsVisible)) bump(L.flagsVisible, k, v)
    for (const [k, v] of Object.entries(d.summary.smallAllowed)) bump(S.allowedSmall, k, v)
    S.blockedWrites += (d.blockedWrites || []).length
    for (const e of d.externalBlocked || []) bump(S.externalBlocked, e.url.replace(/\?.*/, ''))
    for (const e of d.pageErrors || []) if (S.pageErrors.length < 20 && !S.pageErrors.includes(e)) S.pageErrors.push(e)
    for (const h of d.fontHostRequests || []) { const k = h.url.replace(/\?.*/, ''); const o = (S.fontHostRequests[k] ||= { status: h.status, failed: h.failed, states: 0 }); o.states++ }
    for (const r of d.runs) {
      for (const f of r.flags || []) {
        const F = (S.flags[f] ||= { runs: 0, visibleRuns: 0, states: new Set() })
        F.runs++; if (r.vis === 'visible') F.visibleRuns++; F.states.add(d.name)
        if (r.vis === 'visible') {
          const ex = (S.flagExamples[f] ||= {})
          const k = r.sel
          const e = (ex[k] ||= { sel: r.sel, count: 0, states: new Set(), sample: r.txt, style: d.styles[r.st], det: r.det || null, culprits: r.culprits ? r.culprits.list.slice(0, 5) : null, fonts: r.pf.map(([i]) => d.platformFonts[i].name) })
          e.count++; e.states.add(d.lang + '@' + d.width + ' ' + d.state.id)
        }
      }
      if (r.vis === 'visible' && r.det && r.det.weightRequested != null) { const k = `${(d.styles[r.st].ff.match(/"[^"]*"|[^,]+/) || [''])[0].replace(/"/g, '').trim()} requested ${r.det.weightRequested} -> face ${r.det.weightUsed}`; bump(S.weights, k) }
      if (r.vis === 'visible' && r.culprits) for (const c of r.culprits.list) { const k = `${c.cp} ${c.ch} -> ${c.font}`; const e = (S.culprits[k] ||= { runs: 0, states: new Set(), example: r.txt, sel: r.sel }); e.runs++; e.states.add(d.name) }
      if (r.vis === 'visible') {
        const st = d.styles[r.st]
        const head = (st.ff.match(/"[^"]*"|[^,]+/) || [''])[0].replace(/"/g, '').trim()
        const k = `${d.lang}@${d.width}|${head}|${st.fs}px|w${st.fw}|${st.fst}|lh ${st.lh === 'normal' ? 'normal' : PX(st.lh / st.fs)}`
        const e = (S.typeScale[k] ||= { runs: 0, glyphs: 0 })
        e.runs++; e.glyphs += r.glyphs
      }
    }
    for (const c of d.controls) if (c.flags && c.flags.length) for (const f of c.flags) { const k = f + ' ' + c.sel + ' ' + c.fs + 'px'; const e = (S.controlFlags[k] ||= { states: new Set(), ff: c.ff }); e.states.add(d.name) }
    if (d.routeCssMissing || d.navigations > 1 || (d.stubbedCss || []).length) S.caveats.push({ name: d.name, routeCssMissing: !!d.routeCssMissing, stubbedCss: d.stubbedCss || [], documentLoads: d.navigations })
    { const cc = {}; for (const r of d.fontRequests) cc[r.url] = (cc[r.url] || 0) + 1; if (Object.values(cc).some((n) => n > 1)) S.duplicateFontFetches.push({ name: d.name, navigations: d.navigations }) }
    for (const r of d.fontRequests) {
      const o = (S.fontFiles[r.url] ||= { status: r.status, mime: r.mime, transferred: r.transferred, decoded: r.decoded, 'cache-control': r.headers['cache-control'] || null, 'content-encoding': r.headers['content-encoding'] || null, states: 0 })
      o.states++
    }
    for (const f of d.documentFonts) { const k = `${f.family} | ${f.weight} | ${f.style} | ${f.unicodeRange.slice(0, 18)}`; const o = (S.faceStatus[k] ||= { display: f.display, loaded: 0, unloaded: 0, other: 0 }); f.status === 'loaded' ? o.loaded++ : f.status === 'unloaded' ? o.unloaded++ : o.other++ }
  }
  for (const d of thr) if (d.derived) S.throttled.push({ name: d.name, ...d.derived, wallClockMs: d.wallClockMs })
  // plain data out
  for (const F of Object.values(S.flags)) F.states = F.states.size
  for (const ex of Object.values(S.flagExamples)) for (const e of Object.values(ex)) e.states = [...e.states].slice(0, 12)
  for (const e of Object.values(S.culprits)) e.states = e.states.size
  for (const e of Object.values(S.controlFlags)) e.states = [...e.states].slice(0, 6)
  const top = (obj, n, by) => Object.entries(obj).sort((a, b) => by(b[1]) - by(a[1])).slice(0, n)
  const lines = []
  const w = (s = '') => lines.push(s)
  w(`FONTS AUDIT SUMMARY  (${dir})`)
  w(`page-states measured ${S.counts.pageStatesMeasured}; skipped ${S.counts.skippedStates} (control absent in this build); errored ${S.counts.erroredStates}; throttled runs ${S.counts.throttledRuns}`)
  w(`text runs ${S.counts.textRuns} (${S.counts.visibleTextRuns} visible); controls on screen ${S.counts.controlsSeen}; glyphs ${S.counts.glyphsAll} (${S.counts.glyphsVisible} visible)`)
  w(`non-GET requests aborted: ${S.blockedWrites}; page errors: ${S.pageErrors.length}`)
  w(); w('FONTS THAT DREW GLYPHS (visible text; all text in brackets)')
  for (const [k, v] of top(S.glyphsVisibleByFont, 30, (x) => x)) w(`  ${String(v).padStart(8)}  [${String(S.glyphsAllByFont[k]).padStart(8)}]  ${k}`)
  w(); w('PER LANGUAGE x WIDTH')
  for (const [k, L] of Object.entries(S.byLang).sort()) w(`  ${k.padEnd(8)} states ${String(L.states).padStart(3)}  runs ${String(L.runs).padStart(6)}  visible ${String(L.visibleRuns).padStart(6)}  non-brand visible ${String(L.nonBrandVisible).padStart(5)}  flags(visible) ${JSON.stringify(L.flagsVisible)}`)
  w(); w('FLAGS (runs / visible runs / page-states)')
  for (const [k, F] of Object.entries(S.flags).sort()) w(`  ${k.padEnd(14)} ${String(F.runs).padStart(6)} ${String(F.visibleRuns).padStart(6)} ${String(F.states).padStart(4)}`)
  for (const [f, ex] of Object.entries(S.flagExamples).sort()) {
    w(); w(`  ${f}: top selectors (visible)`)
    for (const [k, e] of top(ex, 8, (x) => x.count)) w(`    x${String(e.count).padStart(4)}  ${k}  "${e.sample}"  ${e.style.fs}px/w${e.style.fw}${e.det ? '  ' + JSON.stringify(e.det) : ''}${e.culprits ? '  chars ' + e.culprits.map((c) => c.cp).join(' ') : ''}`)
  }
  w(); w('WEIGHTS ASKED FOR THAT THE FAMILY HAS NO FACE FOR (visible runs)')
  for (const [k, n] of top(S.weights, 20, (x) => x)) w(`  ${String(n).padStart(6)}  ${k}`)
  w(); w('CHARACTERS DRAWN BY A NON-BRAND FONT (visible runs)')
  for (const [k, e] of top(S.culprits, 25, (x) => x.runs)) w(`  ${String(e.runs).padStart(5)} runs / ${String(e.states).padStart(3)} states  ${k}   e.g. ${e.sel} "${e.example}"`)
  w(); w('CONTROLS WITH A PROBLEM')
  for (const [k, e] of Object.entries(S.controlFlags).slice(0, 25)) w(`  ${k}   (${e.states.length}+ states)`)
  w(); w('STATES WITH A CAVEAT (their numbers are less trustworthy): ' + S.caveats.length)
  for (const c of S.caveats) w(`  ${c.name}  routeCssMissing=${c.routeCssMissing}  documentLoads=${c.documentLoads}  stubbed: ${c.stubbedCss.join(' ') || '-'}`)
  w('  states where a font file was fetched twice: ' + S.duplicateFontFetches.length + ' (of which the document had loaded more than once: ' + S.duplicateFontFetches.filter((x) => x.navigations > 1).length + ')')
  w(); w('SMALL-TEXT ALLOW-LIST HITS: ' + JSON.stringify(S.allowedSmall))
  w(); w('TYPE SCALE (visible runs): top 25 by runs')
  for (const [k, e] of top(S.typeScale, 25, (x) => x.runs)) w(`  ${String(e.runs).padStart(6)}  ${k}`)
  w(); w('FONT FILES REQUESTED')
  for (const [k, o] of Object.entries(S.fontFiles).sort()) w(`  ${k}  ${o.status}  ${o.mime}  transferred ${o.transferred}  cache-control ${o['cache-control']}  encoding ${o['content-encoding']}  in ${o.states} states`)
  w(); w('FONT FACES (document.fonts) AND HOW OFTEN EACH LOADED')
  for (const [k, o] of Object.entries(S.faceStatus).sort()) w(`  loaded ${String(o.loaded).padStart(3)} / unloaded ${String(o.unloaded).padStart(3)} / other ${o.other}  display ${o.display || '-'}  ${k}`)
  w(); w('THIRD-PARTY FONT HOSTS: requested ' + JSON.stringify(S.fontHostRequests) + '; blocked by this run ' + JSON.stringify(S.externalBlocked))
  w(); w('SLOW NETWORK (first text vs brand font, ms from navigation start)')
  for (const t of S.throttled) w(`  ${t.name.replace('throttled__', '').padEnd(24)} FCP ${t.fcpMs}  firstText ${t.firstTextMs}  brandFont ${t.firstBrandLoadedMs}..${t.lastBrandLoadedMs}  FOUT ${t.foutMs}ms  swap ${t.fullSwapMs}ms  firstScreenGlyphsInFallback ${t.firstTextGlyphsNonBrand}/${t.firstTextGlyphsTotal}  late faces ${(t.brandFacesLateAfterFirstText || []).length}  LCP ${t.lcpMs}  CLS ${t.clsTotal} (fonts ${t.clsFromFontSwap}, ${t.shiftCount} shifts)  fontBytes ${t.fontBytesTotal} (before text ${t.fontBytesBeforeFirstText})  fontStartLagAfterCss ${t.fontStartLagAfterCssMs}ms  foitRisk ${JSON.stringify(t.foitRiskAtFirstText)}`)
  if (S.skipped.length) { w(); w('SKIPPED STATES'); for (const s of S.skipped) w(`  ${s.name}: ${s.why}`) }
  if (S.errors.length) { w(); w('ERRORS'); for (const s of S.errors) w(`  ${s.name}: ${s.error}`) }
  const text = lines.join('\n') + '\n'
  writeFileSync(path.join(dir, 'summary.txt'), text)
  writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(S, null, 1))
  if (print) console.log(text)
  return S
}

const README = `FONTS AUDIT DATA (written by scripts/fonts-audit.mjs)

One JSON per page-state: <state id>__<lang>__<width>.json  (lang ar = bare URL, RTL; en = ?lang=en, LTR).
throttled__<id>__<lang>__<width>.json = the slow-network pass. index.json lists every file. summary.txt / summary.json aggregate them.
A state skipped because the build has no such control is a stub with "skipped":"why". An "error" key means the state did not measure.

PAGE-STATE FILE
  state{id,path,act,seed}  lang  width  height  url  finalUrl  status  actResult  page{title,htmlLang,htmlDir,rootFontPx,bodyFamily,bodyFontPx,docHeight,mounted,skeletonsLeft}
  platformFonts[]   the fonts Chrome says drew glyphs: {name (the font FILE's internal name), ps, web (came down as a web font), brand}
                    brand = web font named Alexandria* or IBM Plex Sans*. Everything else is a fallback or system font.
  styles[]          deduplicated computed type settings: ff (family stack as resolved), fs px, fw, fst, lh px|"normal", ls px|"normal", ws, tt, fvn (font-variant-numeric),
                    fsyn (font-synthesis), ffs, fvs, fstr, ta, dir
  runs[]            one per element that owns text (and every input/select/textarea):
                    i, sel (tag#id.class < parent < grandparent), tag, region (header|nav|main|footer|dialog|other), roles[], txt (first 70 chars), n (chars),
                    sc{ar,lat,dw (Western digits),da (Arabic-Indic digits),oth,sp}, dom (arabic|latin|digits|symbol), mixed (Arabic and Latin), st (index into styles[]),
                    lang (closest lang attribute), rect [x, y(document), w, h] of the TEXT, lines,
                    vis: visible | offscreen (outside the viewport horizontally, e.g. the closed bag drawer) | inert | hidden | transparent | clipped | nobox
                    pf [[platformFonts index, glyph count]...], glyphs, brandGlyphs, price, ctl{type,placeholder...}, allowed (small-text allow-list reason),
                    flags[] and det{} (the numbers behind each flag), culprits{count,of,list[{ch,cp,font}]} (characters a non-brand font drew)
  controls[]        every input/select/textarea/button: sel, tag, type, ff, fs, fw, w, h, x, textEntry, seen, flags[] (F-CTL-FAMILY, F-CTL-LT16)
  documentFonts[]   document.fonts after the page settled: family, weight, style, display, status (loaded|unloaded|error), unicodeRange
  fontFaceRules[]   the @font-face rules in readable stylesheets (cross-origin sheets are listed as unreadable)
  fontLinks[]       <link> preload/stylesheet/preconnect elements for fonts and font hosts
  fontRequests[]    each font file: url, status, mime, transferred (encoded bytes incl. headers), decoded, fromCache, startMs/endMs, headers{cache-control, etag, content-encoding, ...}
  fontHostRequests[] third-party font hosts (Adobe Fonts / Google): status, failed (net::ERR_BLOCKED_BY_CLIENT when this tool blocked it), blockedReason
  summary           counts: glyphs by font (all/visible), flags (all/visible), non-brand runs, allow-list hits, controls
  blockedWrites[] (non-GET requests the guard aborted), externalBlocked[], pageErrors[], console[], failedRequests[] (4xx/5xx or failed, non-font),
  notes[] (waits that gave up, stubbed or missing route CSS, reloads), stubbedCss[] (lazy route stylesheets the server lacked, answered with an EMPTY stub:
  that page's route CSS is not measured), routeCssMissing (the app reported "Unable to preload CSS"), navigations (document loads; 2+ = the app reloaded itself)
  info on a run: observations that are not flags (letter-spacing under 0.01em on Arabic)

FLAGS   F-NONBRAND F-WEIGHT F-SYNTH-BOLD F-STYLE F-AR-ITALIC F-AR-SPACING F-AR-UPPER F-AR-LEADING F-CTL-FAMILY F-CTL-LT16 F-PRICE-PROP F-SMALL F-MIXED-DIGITS F-NOPF
        (definitions and thresholds: the header of scripts/fonts-audit.mjs). Count a flag with vis === "visible" unless you mean the closed drawer too.

THROTTLED FILE
  profile (kbps, latency, cpuSlowdown)   derived{fcpMs, lcpMs, firstTextMs, firstTextElement, brandFacesLoadedAtFirstText, textShownBeforeBrandFont, foutMs, fullSwapMs,
  foitRiskAtFirstText, declaredDisplay, preloadedFontFiles, firstTextGlyphsByFont, firstTextGlyphsNonBrand, firstTextGlyphsTotal, brandFacesLateAfterFirstText[],
  firstBrandLoadedMs, lastBrandLoadedMs, fontFirstRequestMs, stylesheetsDoneMs, fontStartLagAfterCssMs (negative = fonts were requested before the CSS finished,
  i.e. preloaded), fontBytesBeforeFirstText, fontBytesTotal, clsTotal, clsFromFontSwap, shiftCount}
  firstText{sel,text,ff,faces[]}   firstTextFonts[]{sel,txt,fs,fw,fonts[{name,ps,web,brand,glyphs}]} (the platform font of up to 24 elements of the first screen,
  read while the page was frozen in the first-text frame)   faces[]{family,weight,display,loading,loaded,error (ms)}
  shifts[]{t, v, input, nearFontSwap, fontLoadedAtMs, face, sources[{node, prev[x,y,w,h], cur[x,y,w,h]}]}   timing{font[], stylesheetsDoneMs, ttfbMs, loadMs}   fontRequests

MEASURED ON THIS MACHINE, SO: the fallback a device substitutes is that device's; the data says what this one drew.
Re-run:  node scripts/fonts-audit.mjs   (BASE=https://www.sporta.com.kw to audit the real site; GET only)
`

async function main() {
  if (ARGV.includes('--selftest')) return selftest()
  if (ARGV.includes('--list')) { for (const c of CATALOGUE) console.log(c.id.padEnd(20), c.path.padEnd(40), c.act || '', c.seed ? JSON.stringify(Object.keys(c.seed)) : ''); return }
  const si = ARGV.indexOf('--summarize')
  if (si >= 0) { const dir = path.resolve(ARGV[si + 1] || OUT); writeFileSync(path.join(dir, 'README.txt'), README); summarizeDir(dir); return }
  mkdirSync(OUT, { recursive: true })
  let mirror = null
  let base = ENV.BASE ? ENV.BASE.replace(/\/+$/, '') : null
  if (base) { EXTERNAL_BLOCK = (ENV.EXTERNAL || 'allow') === 'block'; STUB_CSS = ENV.STUB_MISSING_CSS === '1' }
  else { mirror = await startMirror(); base = mirror.base; EXTERNAL_BLOCK = (ENV.EXTERNAL || 'block') !== 'allow'; STUB_CSS = ENV.STUB_MISSING_CSS !== '0' }
  const stop = () => mirror && mirror.stop()
  process.on('exit', stop)
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130) })
  console.log(`BASE ${base}${mirror ? ' (mirror started by this run)' : ''}; langs ${LANGS}; widths ${WIDTHS}; external hosts ${EXTERNAL_BLOCK ? 'BLOCKED' : 'allowed'}; missing route CSS ${STUB_CSS ? 'STUBBED' : 'not stubbed'}; out ${OUT}`)
  const browser = await launch()
  const rows = []
  try {
    const specs = pickCatalogue()
    const tasks = specs.flatMap((spec) => LANGS.flatMap((lang) => WIDTHS.map((w) => ({ kind: 'state', spec, lang, w }))))
    const total = tasks.length
    let done = 0
    const runTask = async (t) => {
      const fn = t.kind === 'state' ? auditState : throttledState
      const r = await withTimeout(fn(browser, base, t.spec, t.lang, t.w), STATE_TIMEOUT, stateName(t.spec.id, t.lang, t.w)).catch((e) => ({ name: stateName(t.spec.id, t.lang, t.w), error: String(e.message) }))
      done++
      const line = r.error ? 'ERROR ' + r.error : r.skipped ? 'skipped: ' + r.skipped.slice(0, 60) : r.derived ? `FOUT ${r.derived.foutMs}ms firstText ${r.derived.firstTextMs} CLS ${r.derived.clsTotal}` : `runs ${r.runs.length} visible ${r.summary.visibleRuns} nonBrand ${r.summary.nonBrandRunsVisible} flags ${JSON.stringify(r.summary.flagsVisible)}`
      console.log(`[${done}/${total}] ${(t.kind === 'state' ? '' : 'throttled ') + stateName(t.spec.id, t.lang, t.w)}  ${line}`)
      rows.push({ file: (r.name || '') + '.json', kind: t.kind, error: r.error || null, skipped: r.skipped || null })
    }
    await mapLimit(tasks, PAGES, runTask)
    // the slow pass runs ONE page at a time: parallel pages would compete for the same CPU and bend the timings
    const slow = THROTTLE_ON && (!ENV.ROUTES || ENV.THROTTLE === '1')
    if (slow) {
      const th = THROTTLED.flatMap((spec) => LANGS.map((lang) => ({ kind: 'throttled', spec, lang, w: THROTTLE_WIDTH })))
      let n = 0
      for (const t of th) {
        const r = await withTimeout(throttledState(browser, base, t.spec, t.lang, t.w), 240000, 'throttled ' + t.spec.id).catch((e) => ({ name: 'throttled__' + stateName(t.spec.id, t.lang, t.w), error: String(e.message) }))
        n++
        console.log(`[slow ${n}/${th.length}] ${stateName(t.spec.id, t.lang, t.w)}  ${r.error ? 'ERROR ' + r.error : `firstText ${r.derived.firstTextMs} brand fonts ${r.derived.firstBrandLoadedMs}..${r.derived.lastBrandLoadedMs} first-screen glyphs in fallback ${r.derived.firstTextGlyphsNonBrand}/${r.derived.firstTextGlyphsTotal} CLS ${r.derived.clsTotal} (fonts ${r.derived.clsFromFontSwap})`}`)
        rows.push({ file: r.name + '.json', kind: 'throttled', error: r.error || null })
      }
    }
  } finally {
    await browser.close().catch(() => {})
    stop()
  }
  const index = readdirSync(OUT).filter((f) => f.endsWith('.json') && !/^(index|summary)\.json$/.test(f)).sort().map((f) => {
    const d = JSON.parse(readFileSync(path.join(OUT, f), 'utf8'))
    return { file: f, kind: d.kind, error: d.error || null, skipped: d.skipped || null, runs: d.runs ? d.runs.length : null, visibleRuns: d.summary ? d.summary.visibleRuns : null, flagsVisible: d.summary ? d.summary.flagsVisible : null, routeCssMissing: d.routeCssMissing || false }
  })
  writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1))
  writeFileSync(path.join(OUT, 'README.txt'), README)
  summarizeDir(OUT, false)
  console.log(`FONTS_AUDIT_DONE ${rows.length} files in ${OUT} (summary.txt)`)
}
main().then(() => process.exit(process.exitCode || 0), (e) => { console.error(e); process.exit(1) })
