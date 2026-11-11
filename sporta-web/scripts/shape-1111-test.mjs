// npm run test:shape-1111 - proves the SHAPE-1111 section of public/sporta-shadows.css (one corner-radius scale for the storefront) on the
// CAPTURED LIVE MARKUP under the LIVE RULES, scripts/lib/shape-pages.mjs:
//   screen/*   home (hero, brand bar, category tiles, features band, product row, footer chips), about (why-cards, FAQ), terms, cart,
//              checkout, bag drawer                                                  scripts/fixtures/sizes-screen
//   product/*  the product page (gallery, size chips, quantity, brand plate, related cards, buy bar)  scripts/fixtures/sizes-product
//   shop, tiles, essentials   the /shop cards, the home category tiles, the home essentials row      scripts/fixtures/grid
//   contact, account-out, account-in   Contact (support cards), the /account register form and profile   scripts/fixtures/register, account
//   support, returns, track   the live <main> of /support, /returns and /track (+ the Returns route stylesheet)   scripts/fixtures/shape
// Each page is opened with the section ON (the repo file) and OFF (the same file without the section; the ICON SET section that follows it
// stays in both), at 390 / 768 / 1280px, Arabic and English, light and dark. Per page:
//   scale      every box in a role (chip 8, control 12, card 16, large 20 - rem, so x root/16 at 1280px) has exactly that radius on all four
//              corners; an image box inside a card has the card's radius minus the card's padding, never under the chip radius, and its
//              loading shimmer has the same curve
//   untouched  every element OUTSIDE the roles has the same radius ON and OFF (pills, the hero, header, footer, skip link, buy bar, drawer
//              panel, logos and photographs): a radius that moves where no role says so fails
//   geometry   every element has the same rectangle ON and OFF within 0.5px (no box moves or resizes), the page is the same height and
//              width, and nothing scrolls sideways
//   focus      keyboard focus on one control of each role: the ring (outline, offset, box-shadow) is the one OFF has, it is not newly clipped
//              by an ancestor, and the box keeps its radius while focused
// plus the file itself (one section, before ICON SET, border-radius only, scoped, build-iconset --check) and a MUTATION run: the section
// removed must fail the scale checks.
//
//   SHAPE_SHOTS=<dir>   also writes before/after screenshots (device scale 1) of every page at 390 and 1280, Arabic and English, light
//   SHAPE_TABLE=<file>  writes the before / after radius table (JSON)
//   ONLY=<page ids>     narrows the pages (comma list); QUICK=1 narrows widths to 390 and 1280 and themes to light
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { PAGES, start, FILE, MARK, END, ICON_MARK, ROOT, withoutSection } from './lib/shape-pages.mjs'

let pass = 0, fail = 0
const fails = []
let sink = fails
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; sink.push(msg + (detail ? '  - ' + detail : '')) } return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 72 - t.length))}`)

const FULL = readFileSync(FILE, 'utf8')
const OFF = withoutSection(FULL)
const SCALE = { chip: 8, control: 12, card: 16, large: 20 }   // px at a 16px root; the page's rem makes them 8.41 / 12.62 / 16.83 / 21.04 at 1280

// ---- the roles ---------------------------------------------------------------------------------------------------------------------
// [scale, name, selector]. 'concentric' = the card's radius minus the card's padding, floored at the chip radius ([parent selector]).
const ROLES = [
  ['chip', 'card badge', '.catalog-card-badge'],
  ['chip', 'category tile badge', '.campaign-category__badge'],
  ['chip', 'footer payment chip', '.footer-payment'],
  ['chip', 'checkout step number', '.purchase-steps__number'],
  ['chip', 'payment option badge', '.purchase-payment .payment-method__badge'],
  ['chip', 'password Show button', '.customer-account__password button'],
  ['control', 'button (.btn)', '.storefront-root .btn, .campaign-cart-drawer .btn'],
  ['control', 'card heart / add', '.catalog-card-save, .catalog-card-add'],
  ['control', 'quantity stepper', '.catalog-product-quantity, .purchase-quantity'],
  ['control', 'cart line button', '.purchase-cart .cart-line__controls > button'],
  ['control', 'drawer remove', '.cart-drawer__remove'],
  ['control', 'category tile arrow', '.campaign-category__arrow'],
  ['control', 'features icon tile', '.home-feature-icon'],
  ['control', 'field (input, select, textarea)', '.storefront-root :is(input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea):not(.account-dashboard__phone input)'],
  ['control', 'phone / read-only box', '.account-dashboard__phone, .account-dashboard__read-only, .account-dashboard__empty'],
  ['control', 'support tab / primary', '.support-page__tabs button, .support-page__primary, .returns-system__primary'],
  ['control', 'size chip', '#product-size-options [role="group"] > button'],
  ['control', 'legal help link', '.legal-page__support a'],
  ['control', 'callout (notice, error)', '.returns-system__error, .returns-system__notice, .purchase-notice'],
  ['control', 'gallery zoom hint', '.catalog-gallery-zoom'],
  ['control', 'footer social link', '.footer-socials a'],
  ['card', 'product card', '.product-grid-card'],
  ['card', 'category tile', '.campaign-category'],
  ['card', 'gallery stage', '.catalog-gallery-stage'],
  ['card', 'brand bar item', '.brand-bar__item'],
  ['card', 'brand plate', '.campaign-brand-plate'],
  ['card', 'why-card', '.why-card'],
  ['card', 'support card (Contact)', '.support-card'],
  ['card', 'support card (/support)', '.support-page__card, .support-page__ticket, .support-page__success'],
  ['card', 'tracking box', '.tracking-panel'],
  ['card', 'features card', '.home-feature-item'],
  ['card', 'product option / reassurance box', '.catalog-product-options > div, .catalog-product-reassurance'],
  ['card', 'cart line', '.cart-line'],
  ['card', 'checkout note / steps', '.guest-note, .purchase-steps'],
  ['card', 'payment option', '.purchase-payment .payment-method'],
  ['card', 'legal box', '.legal-page__contents, .legal-page__support'],
  ['card', 'account panel', '.account-dashboard__panel, .account-dashboard__welcome'],
  ['card', 'returns list card', '.returns-system__requests > ol > li, .returns-system__item, .returns-system__success'],
  ['card', 'FAQ list', '.faq-list'],
  ['large', 'account card', '.customer-account__card'],
  ['large', 'checkout / cart panel', '.purchase-panel:not(.purchase-cart__summary)'],
  ['large', 'features band', '.home-features, .home-spotlight'],
  ['large', 'returns box', '.returns-system__lookup, .returns-system__order, .returns-system__requests, .returns-system__claim, .returns-system__policy'],
  ['summary', 'cart summary (card, not bar)', '.purchase-cart__summary'],
  ['concentric', 'card image box', '.product-grid-card .catalog-card-image', '.product-grid-card'],
  ['concentric', 'card image shimmer', '.catalog-card-image .image-loading-skeleton', '.catalog-card-image'],
  ['concentric', 'cart line thumbnail', '.cart-line__image', '.cart-line'],
]
// every box the owner said not to touch: ON must equal OFF (the generic "outside the roles" check covers the rest)
const KEEP = [
  ['skip link', '.skip-link'], ['hero CTA and slider', '.campaign-hero-cta, .campaign-hero-cta-icon, .campaign-photo-hero, .campaign-photo-hero *'],
  ['header', '.app-header, .app-header *'], ['footer bar', '.app-footer, .sporta-footer'],
  ['fixed buy / pay bars', '.action-bar, .purchase-paybar'], ['bag drawer panel', '.campaign-cart-drawer'],
  ['logos and photographs', 'img.brand-bar__logo, .campaign-brand-plate img, .catalog-card-photo, .catalog-gallery-photo, .home-features__photo'],
  ['pills', '.rounded-full, .catalog-gallery button[class*="group/dot"], .support-page__ticket header > span, .returns-system__badge'],
]
const ROLESEL = ROLES.map((r) => ({ scale: r[0], name: r[1], sel: r[2], parent: r[3] || '' }))
const KEEPSEL = KEEP.map((k) => ({ name: k[0], sel: k[1] }))
const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'

// ---- in the page ---------------------------------------------------------------------------------------------------------------------
const measure = ({ roles, keep }) => {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const rows = []
  const all = [...document.querySelectorAll('body *')]
  all.forEach((e, i) => {
    const cs = getComputedStyle(e), r = e.getBoundingClientRect()
    const rad = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(parseFloat)
    const matched = []
    roles.forEach((ro, k) => { try { if (e.matches(ro.sel)) matched.push(k) } catch (x) {} })
    const kept = keep.map((ko, k) => { try { return e.matches(ko.sel) ? k : -1 } catch (x) { return -1 } }).filter((k) => k >= 0)
    const par = matched.length && roles[matched[0]].parent ? e.closest(roles[matched[0]].parent) : null
    const pcs = par ? getComputedStyle(par) : null
    const prad = par ? parseFloat(pcs.borderTopLeftRadius) : 0
    const ppad = par ? Math.min(...['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(pcs['padding' + s]))) : 0
    const vis = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    const svgInner = !!e.closest('svg') && e.tagName.toLowerCase() !== 'svg'          // the analog clock's hands turn with the time
    rows.push({ i, svgInner, rad, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, matched, kept, vis, prad, ppad, tag: e.tagName.toLowerCase(), cls: (e.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.'), name: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) })
  })
  const de = document.documentElement
  return { root, rows, sw: de.scrollWidth, cw: de.clientWidth, sh: de.scrollHeight }
}

// focus targets: the first visible element of each role (or the first focusable inside it), focused the way a keyboard does it
const focusProbe = ({ roles, focusable }) => {
  const out = []
  const seen = new Set()
  const ring = (e) => {
    const cs = getComputedStyle(e)
    return { os: cs.outlineStyle, ow: parseFloat(cs.outlineWidth), oc: cs.outlineColor, oo: parseFloat(cs.outlineOffset), bs: cs.boxShadow, rad: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(parseFloat) }
  }
  const clipped = (e, pad) => {
    const r = e.getBoundingClientRect()
    const R = { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad }
    for (let n = e.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      const q = n.getBoundingClientRect()
      const bw = [parseFloat(cs.borderLeftWidth), parseFloat(cs.borderTopWidth), parseFloat(cs.borderRightWidth), parseFloat(cs.borderBottomWidth)]
      if (R.l < q.left + bw[0] - 0.5 || R.t < q.top + bw[1] - 0.5 || R.r > q.right - bw[2] + 0.5 || R.b > q.bottom - bw[3] + 0.5) return true
    }
    return false
  }
  roles.forEach((ro, k) => {
    let e = null
    try { e = [...document.querySelectorAll(ro.sel)].find((x) => { const r = x.getBoundingClientRect(); const cs = getComputedStyle(x); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && (x.matches(focusable) || [...x.querySelectorAll(focusable)].some((y) => y.getBoundingClientRect().width > 0)) }) } catch (x) {}
    if (!e) return
    const t = e.matches(focusable) ? e : [...e.querySelectorAll(focusable)].find((y) => y.getBoundingClientRect().width > 0)
    if (!t || seen.has(t)) return
    seen.add(t)
    const before = ring(t), boxBefore = ring(e)
    t.scrollIntoView({ block: 'center' })
    t.focus({ focusVisible: true })
    t.getAnimations().forEach((x) => x.finish())             // the ring's own colour / shadow transition must not be measured half way
    const after = ring(t), boxAfter = ring(e)
    const pad = (after.os !== 'none' && after.ow > 0 ? Math.max(0, after.oo) + after.ow : 0) + (after.bs !== 'none' ? 4 : 0)
    out.push({ role: k, tag: t.tagName.toLowerCase(), cls: (t.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.'), fv: t.matches(':focus-visible'), before, after, boxBefore, boxAfter, clipped: clipped(t, pad), id: [...document.querySelectorAll(focusable)].indexOf(t) })
    t.blur()
  })
  return out
}

// ---- the file -------------------------------------------------------------------------------------------------------------------------
head('the file')
{
  const i = FULL.indexOf(MARK), j = FULL.indexOf(END), k = FULL.indexOf(ICON_MARK)
  is(i > 0 && FULL.indexOf(MARK, i + 1) < 0 && j > i, 'sporta-shadows.css carries one SHAPE-1111 section with its end marker')
  is(k > j, 'the section sits BEFORE the ICON SET section')
  is(FULL.slice(FULL.indexOf('/* ==== end ICON SET */') + '/* ==== end ICON SET */'.length).trim() === '', 'the ICON SET section is still the last section of the file')
  let chk = ''
  try { chk = execFileSync('node', [join(ROOT, 'scripts/build-iconset.mjs'), '--check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { chk = 'FAILED ' + (e.stderr || e.message) }
  is(!/FAILED/.test(chk), 'node scripts/build-iconset.mjs --check passes (the ICON SET section is byte-for-byte what the sources build)', chk.slice(0, 120))
  const sec = FULL.slice(i, j + END.length)
  const body = sec.replace(/\/\*[\s\S]*?\*\//g, '')
  // every innermost block: "<selector list> { <declarations> }" (an @media wrapper is not one: its braces enclose other blocks)
  const blocks = [...body.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), decl: m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]) }))
  const decls = blocks.flatMap((b) => b.decl)
  is(decls.length > 10, `the section has declarations (${decls.length})`)
  const other = decls.filter(([p]) => !/^(border-radius|--sporta-shape-(chip|control|card|large|inner))$/.test(p))
  is(other.length === 0, 'border-radius only (plus the scale tokens): no size, position, colour, overflow or border rule', other.slice(0, 4).join(' | '))
  is(!/border-(top|bottom|start|end|left|right)-(left|right|start|end)-radius/.test(body), 'single values only (no physical corner): the Arabic page needs no mirror')
  const sels = blocks.map((b) => b.sel)
  const bad = sels.filter((s) => !/^:root (\.storefront-root|:is\(\.storefront-root, \.campaign-cart-drawer\))/.test(s))
  is(sels.length > 10 && bad.length === 0, `every selector starts at :root .storefront-root (or the portalled drawer) (${sels.length} blocks)`, bad.slice(0, 3).join(' | '))
  is(!/admin|backends/.test(body), 'no selector names the admin')
  const imp = blocks.filter((b) => b.decl.some(([, v]) => /!important/.test(v))).map((b) => b.sel)
  is(imp.length === 3 && imp.every((s) => /campaign-category(__badge|__arrow)?$/.test(s)), '!important only on the three category-tile rules sporta-cat-tiles.css already forces', imp.join(' | '))
  is(/--sporta-shape-chip: \.5rem/.test(body) && /--sporta-shape-control: \.75rem/.test(body) && /--sporta-shape-card: 1rem/.test(body) && /--sporta-shape-large: 1\.25rem/.test(body), 'the scale is 8 / 12 / 16 / 20 in rem (.5 / .75 / 1 / 1.25), so it grows with the root font size like the live radii')
  is(!/\d+px/.test(body.replace(/\(max-height: 511\.98px\)/, '').replace(/\(max-width: 479px\)/, '').replace(/\(min-width: 1024px\)/, '')), 'no px radius anywhere (rem only)')
}

// ---- the pages ------------------------------------------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const S = await start(browser)
const QUICK = !!process.env.QUICK
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean)
const WIDTHS = QUICK ? [390, 1280] : [390, 768, 1280]
const THEMES = QUICK ? ['light'] : ['light', 'dark']
const SHOTS = process.env.SHAPE_SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const px16 = (v, root) => v * 16 / root
const seenRoles = new Map()                                  // role index -> first place seen
const table = ROLES.map(() => ({ off: new Set(), on: new Set(), where: '' }))
const keptSeen = new Map()

async function shot(p, pg, lang, w, theme, state) {
  await p.evaluate(async () => { for (const i of document.images) i.loading = 'eager'; await Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r })))) })
  await p.waitForTimeout(120)
  await p.screenshot({ path: `${SHOTS}/${pg.id.replace(/\//g, '-')}-${lang}-${w}-${theme}-${state}.png`, fullPage: true })
}

async function checkPage(onCss, pg, lang, w, theme, opts = {}) {
  const A = await S.open(pg, lang, w, onCss, { theme }), B = await S.open(pg, lang, w, OFF, { theme })
  const arg = { roles: ROLESEL, keep: KEEPSEL }
  const on = await A.p.evaluate(measure, arg), off = await B.p.evaluate(measure, arg)
  const T = `${pg.id} ${lang} ${w}px ${theme}`
  if (opts.shots && SHOTS && theme === 'light' && (w === 390 || w === 1280)) { await shot(A.p, pg, lang, w, theme, 'on'); await shot(B.p, pg, lang, w, theme, 'off') }
  is(on.rows.length === off.rows.length, `${T}: same elements ON and OFF (${on.rows.length})`)
  if (on.rows.length === off.rows.length) {
    // geometry: nothing moves, nothing resizes (the insides of an <svg> are skipped: the header's analog clock turns its hands with the time)
    let worst = 0, at = null
    for (let k = 0; k < on.rows.length; k++) { const a = on.rows[k], b = off.rows[k]; if (a.svgInner) continue; const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h)); if (d > worst) { worst = d; at = `${a.tag}.${a.cls} ${a.name}` } }
    is(worst <= 0.5, `${T}: every element has the same rectangle ON and OFF (worst ${worst.toFixed(2)}px)`, at)
    is(on.sh === off.sh && on.sw === off.sw, `${T}: page height and width unchanged`, `${off.sw}x${off.sh} -> ${on.sw}x${on.sh}`)
    is(on.sw <= on.cw, `${T}: no sideways scroll`, `${on.sw} > ${on.cw}`)
    const f = on.root / 16
    let changedOutside = []
    on.rows.forEach((a, k) => {
      const b = off.rows[k]
      const same = a.rad.every((v, c) => Math.abs(v - b.rad[c]) < 0.01)
      a.matched.forEach((ri) => { if (!seenRoles.has(ri) && a.vis) seenRoles.set(ri, `${T}: ${a.tag}.${a.cls}`) })
      a.kept.forEach((ki) => { if (a.vis && !keptSeen.has(ki)) keptSeen.set(ki, T) })
      if (!a.matched.length) { if (!same) changedOutside.push(`${a.tag}.${a.cls} ${a.name} ${b.rad[0]}->${a.rad[0]}`); return }
      if (!a.vis) return
      // the role (the first that matched: roles do not overlap on one element except by design)
      const ri = a.matched[0], ro = ROLES[ri], T2 = `${T}: ${ro[1]} (${a.tag}.${a.cls})`
      table[ri].off.add(+px16(b.rad[0], off.root).toFixed(2)); table[ri].on.add(+px16(a.rad[0], on.root).toFixed(2)); if (!table[ri].where) table[ri].where = T
      let want
      if (ro[0] === 'concentric') want = ro[1] === 'card image shimmer' ? a.prad : Math.max(SCALE.chip * f, a.prad - a.ppad)
      else if (ro[0] === 'summary') want = b.rad[0] === 0 ? 0 : SCALE.large * f
      else want = SCALE[ro[0]] * f
      // a role box that is a pill or a circle OFF is not a box of the scale (a rounded-full button): it must be unchanged
      const pillOff = b.rad[0] > 0 && b.rad[0] >= Math.min(b.w, b.h) / 2 - 0.5
      if (pillOff) { is(same, `${T2}: a pill stays a pill`, `${b.rad} -> ${a.rad}`); return }
      is(a.rad.every((v) => Math.abs(v - want) < 0.06), `${T2}: radius ${want.toFixed(2)}px (${ro[0]}) on all four corners`, `got ${a.rad.map((v) => v.toFixed(2)).join('/')}, was ${b.rad.map((v) => v.toFixed(2)).join('/')}`)
      if (ro[0] === 'concentric') {
        is(a.rad[0] >= SCALE.chip * f - 0.06, `${T2}: not under the chip radius`, `${a.rad[0]}`)
      }
    })
    is(changedOutside.length === 0, `${T}: no radius changes outside the roles`, changedOutside.slice(0, 5).join(' | '))
    // the owner's keep list: same radius ON and OFF
    on.rows.forEach((a, k) => { const b = off.rows[k]; if (!a.kept.length || !a.vis) return; const cant = a.matched.length && !a.rad.every((v, c) => Math.abs(v - b.rad[c]) < 0.01); if (cant) return /* also a role by design: checked above */; is(a.rad.every((v, c) => Math.abs(v - b.rad[c]) < 0.01), `${T}: kept as it was (${KEEP[a.kept[0]][0]}) ${a.tag}.${a.cls}`, `${b.rad[0]} -> ${a.rad[0]}`) })
  }
  // focus, on a spread of the combinations (a keyboard press first: :focus-visible follows the last input modality)
  if (opts.focus) {
    await A.p.keyboard.press('Tab'); await B.p.keyboard.press('Tab')
    const fa = await A.p.evaluate(focusProbe, { roles: ROLESEL, focusable: FOCUSABLE }), fb = await B.p.evaluate(focusProbe, { roles: ROLESEL, focusable: FOCUSABLE })
    is(fa.length === fb.length && fa.length > 0, `${T}: focus probes on ${fa.length} controls (one per role present)`, `${fa.length}/${fb.length}`)
    fa.forEach((a, k) => {
      const b = fb[k]; if (!b) return
      const T3 = `${T}: focus on ${ROLES[a.role][1]} (${a.tag}.${a.cls})`
      is(a.fv === b.fv, `${T3}: :focus-visible matches as it does OFF`)
      is(a.after.os === b.after.os && a.after.ow === b.after.ow && a.after.oc === b.after.oc && a.after.oo === b.after.oo && a.after.bs === b.after.bs, `${T3}: the ring is the one OFF draws`, `${JSON.stringify(b.after)} vs ${JSON.stringify(a.after)}`)
      const visible = (r) => (r.os !== 'none' && r.ow > 0) || r.bs !== 'none'
      is(visible(a.after) === visible(b.after) && (visible(a.after) || a.fv === false), `${T3}: a ring is visible`, JSON.stringify(a.after))
      is(!(a.clipped && !b.clipped), `${T3}: the ring is not newly clipped by an ancestor`)
      is(Math.abs(a.boxAfter.rad[0] - a.boxBefore.rad[0]) < 0.06, `${T3}: the ${ROLES[a.role][1]} box keeps its radius while it or something in it has focus (the live :focus-visible rule says 6px)`, `${a.boxBefore.rad[0]} -> ${a.boxAfter.rad[0]}`)
    })
  }
  await A.ctx.close(); await B.ctx.close()
}

async function suite(onCss, label, pages, widths, langs, themes, focusSpots) {
  const f0 = fail
  for (const pg of pages) for (const w of widths) for (const lang of langs) for (const theme of themes) {
    const focus = focusSpots && ((w === 390 && lang === 'ar' && theme === 'light') || (w === 1280 && lang === 'en' && theme === 'light') || (w === 390 && lang === 'en' && theme === 'dark'))
    await checkPage(onCss, pg, lang, w, theme, { focus, shots: label === 'on' })
  }
  return fail - f0
}

head('the pages: scale, untouched, geometry, focus')
const PG = PAGES.filter((p) => !ONLY.length || ONLY.includes(p.id))
await suite(FULL, 'on', PG, WIDTHS, ['en', 'ar'], THEMES, true)

head('coverage')
const unseen = ROLES.map((r, i) => [i, r]).filter(([i]) => !seenRoles.has(i)).map(([, r]) => `${r[1]} (${r[2].slice(0, 50)})`)
console.log(`${ROLES.length - unseen.length} of ${ROLES.length} roles were found on the captured pages`)
if (unseen.length) console.log('NOT on any captured page (needs live capture to prove): ' + unseen.join('; '))
for (const [ki, ko] of KEEP.entries()) console.log(`kept: ${ko[0].padEnd(24)} ${keptSeen.has(ki) ? 'present on the captured pages, unchanged' : 'not on any captured page'}`)
is(seenRoles.size >= 40, `the captured pages cover at least 40 of the ${ROLES.length} roles`, `${seenRoles.size}`)

head('before and after (px at a 16px root; x root/16 at 1280)')
const rows = ROLES.map((r, i) => ({ scale: r[0], role: r[1], before: [...table[i].off].sort((a, b) => a - b), after: [...table[i].on].sort((a, b) => a - b), where: table[i].where }))
for (const r of rows) if (r.before.length) console.log(`${r.scale.padEnd(10)} ${r.role.padEnd(34)} ${r.before.join(', ').padEnd(24)} -> ${r.after.join(', ')}`)
if (process.env.SHAPE_TABLE) writeFileSync(process.env.SHAPE_TABLE, JSON.stringify(rows, null, 1))

head('mutation: the section removed must fail')
{
  const f0 = fail, p0 = pass, F0 = fails.length
  const sink0 = sink; const m = []; sink = m
  const pages = PAGES.filter((p) => ['screen/home', 'screen/checkout', 'shop', 'tiles', 'returns', 'account-out'].includes(p.id))
  const n = await suite(OFF, 'mutation', pages, [390], ['en'], ['light'], false)
  sink = sink0
  const scaleFails = m.filter((x) => /radius [\d.]+px \(/.test(x)).length
  fail = f0; pass = p0; fails.length = F0
  console.log(`mutation run: ${scaleFails} scale checks fail without the section (${n} failing checks in all)`)
  is(scaleFails >= 40, 'the suite fails when the SHAPE-1111 section is removed', `${scaleFails} failing scale checks`)
}

await browser.close(); S.close()
if (fails.length) { console.log('\nFAILURES (first 60):'); for (const f of fails.slice(0, 60)) console.log('FAIL ' + f) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
