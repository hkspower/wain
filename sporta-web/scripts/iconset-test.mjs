// npm run test:iconset - proves the ICON SET section of public/sporta-shadows.css (the Sporta icon set, built by
// scripts/build-iconset.mjs from /brand/iconset/*.svg) on the CAPTURED LIVE MARKUP under the LIVE RULES:
//   scripts/fixtures/sizes-screen   home, about, cart, checkout, bag drawer (header, footer, features band, hero)
//   scripts/fixtures/sizes-product  the product page (gallery, wishlist, size guide, quantity, reassurance, swatches)
//   scripts/fixtures/grid           the /shop cards and the home category tiles
//   scripts/fixtures/register       the Contact page cards
// Arabic and English, 390 and 1280px, each page with the section ON and OFF (the file without it). Two icons the
// captures do not hold in the needed state are added to the drawer page identically in both states, with the live
// build's own markup: a SAVED wishlist heart (the build writes fill="currentColor" and aria-pressed="true") and the
// bin the build draws as "remove" on some screens (scripts/fixtures/words-colours.mjs).
//
// Checks, per page:
//   inventory   every visible storefront icon is one the set knows (none left in the old drawing), and is painted with
//               the glyph the set assigns to it (read back from the mask: data-glyph=...)
//   swap        the old shapes are invisible and the new glyph is drawn exactly once (never both, never neither)
//   box         the box is the old box: same size, same position within 0.5px, and the page is the same height
//   colour      the glyph is painted in currentColor (or the colour the old drawing hard-coded), also on hover
//   direction   mirroring is unchanged except the two glyphs this section mirrors, which turn in RTL only; the
//               directional glyphs point the other way in Arabic, the symmetric ones never turn
//   names       every control keeps its accessible name; every icon stays aria-hidden
//   ink         the mask really paints (pixels inside the box), and the line is 1.5px on a 16px box
// plus: the section is what the sources build (no drift), and a MUTATION run: the section removed must fail.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, CSS_FILE, START, END, RULES, MIRROR, glyphs, section, splice, preview, SET } from './build-iconset.mjs'
import * as SCR from './lib/sizes-screen-page.mjs'
import * as PRD from './lib/sizes-product-page.mjs'
import { png } from './lib/png.mjs'

let pass = 0, fail = 0
const fails = []
const is = (ok, msg, detail = '') => { if (ok) pass++; else { fail++; fails.push(msg + (detail ? '  - ' + detail : '')) } return ok }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)

const FULL = readFileSync(CSS_FILE, 'utf8')
const OFF = splice(FULL, '').replace(/\n+$/, '\n')
const DIRECTIONAL = new Set(Object.values(glyphs()).filter((g) => g.directional).map((g) => g.name))

// ---- static checks --------------------------------------------------------------------------------------------------
head('the section and its sources')
{
  const i = FULL.indexOf(START), j = FULL.indexOf(END)
  is(i > 0 && FULL.indexOf(START, i + 1) < 0 && j > i, 'sporta-shadows.css carries one ICON SET section with its end marker')
  is(FULL.slice(j + END.length).trim() === '', 'the ICON SET section is the last section of the file')
  is(FULL === splice(FULL, section()), 'the section is exactly what scripts/build-iconset.mjs builds from /brand/iconset (no hand edits, no drift)')
  let pv = ''; try { pv = readFileSync(join(SET, 'preview.html'), 'utf8') } catch {}
  is(pv === preview(), '/brand/iconset/preview.html is current')
  const sec = FULL.slice(i, j)
  is(!sec.includes('/* ==== ICONS'), 'the section name does not collide with the ICONS section marker (icons-polish cuts at it)')
  is(!/admin/.test(sec.replace(/\/\*[\s\S]*?\*\//g, '')), 'no selector names the admin')
  is(/:root \.storefront-root|\.sf /.test(sec) && sec.replace(/\/\*[\s\S]*?\*\//g, '').split('{').slice(1).length > 0, 'selectors are scoped to the storefront (or the features band it owns)')
  is(!/https?:\/\//.test(sec.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), 'no external URL: every glyph is an inline data: URI')
  const G = glyphs()
  for (const g of Object.values(G)) {
    is(/viewBox="0 0 24 24"/.test(g.src) && /stroke-linecap="round"/.test(g.src) && /stroke-linejoin="round"/.test(g.src) && /stroke="currentColor"/.test(g.src), `${g.name}.svg: 24 grid, round caps and joins, currentColor`)
    is(!/stroke-width="(?!1\.75")/.test(g.src), `${g.name}.svg: one stroke weight (1.75 at 24px in the source)`)
  }
  for (const r of RULES) is(!!G[r.g], `rule glyph "${r.g}" has a source`)
  console.log(`${Object.keys(G).length} glyphs, ${RULES.length} rules, section ${(j - i)} bytes`)
}

// ---- pages ----------------------------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const scrRef = { current: null }, prdRef = { current: null }
const scr = await SCR.serve(scrRef), prd = await PRD.serve(prdRef)
const withShadows = (files, css) => ({ ...files, 'sporta-shadows.css': css })
const SCR_ADDONS = SCR.addonFiles(), PRD_ADDONS = PRD.addonFiles()

// capture-format pages (grid, register): live.css blocks in load order, the live sporta-shadows block swapped for ours
const capture = (dir, base, cssFile) => (lang, css) => {
  const rd = (f) => readFileSync(join(ROOT, 'scripts/fixtures', dir, f), 'utf8')
  const meta = JSON.parse(rd(`${base}-${lang}.json`))
  const live = rd(cssFile).split(/(?=\/\* ---- )/).map((b) => /^\/\* ---- \/sporta-shadows\.css/.test(b) ? '/* ---- repo sporta-shadows.css ---- */\n' + css + '\n' : b).join('')
  const tag = (s) => (s.match(/^<(\w+)/) || [])[1]
  return `<!doctype html><html ${meta.html}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${live}</style></head><body ${meta.body}>`
    + `${meta.chain.join('')}<div style="height:${Math.round(meta.header)}px"></div>${rd(`${base}-${lang}.html`)}${[...meta.chain].reverse().map((c) => `</${tag(c)}>`).join('')}</body></html>`
}
const CAP = { shop: capture('grid', 'shop-out', 'shop-live.css'), tiles: capture('grid', 'tiles-home-out', 'tiles-live.css'), essentials: capture('grid', 'essentials-home-out', 'essentials-live.css'), contact: capture('register', 'contact-out', 'live.css') }

const PAGES = [
  ...['home', 'about', 'cart', 'checkout', 'drawer'].map((n) => ({ id: `screen/${n}`, kind: 'scr', n })),
  // the features band sporta-features.js builds is hidden by sporta-home-trim.css while the compiled band is on the page;
  // shown here (same style in both states) so its glyphs are proven for the day it is the band on show
  { id: 'screen/home+sf', kind: 'scr', n: 'home', sf: true },
  ...['full', 'two'].map((n) => ({ id: `product/${n}`, kind: 'prd', n })),
  ...Object.keys(CAP).map((n) => ({ id: `${n}`, kind: 'cap', n })),
]
const WIDTHS = [390, 1280]

// the two states the captures lack, added to the drawer page with the build's own markup (identical ON and OFF)
const EXTRAS = `<div data-iconset-extra style="display:flex;gap:8px;padding:8px"><button type="button" aria-label="Saved" aria-pressed="true" class="catalog-card-save flex h-11 w-11 items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle " aria-hidden="true" focusable="false"><path d="M12 20.5 4 12.5a5 5 0 0 1 8-6.5 5 5 0 0 1 8 6.5Z"></path></svg></button><button type="button" aria-label="Remove" class="cart-drawer__remove text-slate-400"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle " aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"></path></svg></button></div>`

async function open(pg, lang, w, css, dpr = 1) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: dpr })
  const p = await ctx.newPage()
  if (pg.kind === 'scr') { scrRef.current = withShadows(SCR_ADDONS, css); await p.goto(`${scr.base}/__fx/${pg.n}-${lang}`) }
  else if (pg.kind === 'prd') { prdRef.current = withShadows(PRD_ADDONS, css); await p.goto(`${prd.base}/__fx/${pg.n}-${lang}-${w}`) }
  else {
    const html = CAP[pg.n](lang, css)
    await p.route('http://fx.test/**', (r) => new URL(r.request().url()).pathname === '/' ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.fulfill({ status: 404, body: '' }))
    await p.goto('http://fx.test/')
  }
  if (pg.sf) await p.addStyleTag({ content: '#sporta-features#sporta-features.sf { display: block !important; }' })
  if (pg.n === 'drawer') await p.evaluate((x) => (document.querySelector('.campaign-cart-drawer header') || document.body).insertAdjacentHTML('afterend', x), EXTRAS)
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(50)
  return { p, ctx }
}

const RULESEL = RULES.map((r) => ({ g: r.g, sel: r.sel.join(','), color: r.color || '' }))
const MIRRORSEL = MIRROR.join(',')
const measure = ({ rules, mirror }) => {
  const flip = (el) => { let s = 1; for (let n = el; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.transform && cs.transform !== 'none' && new DOMMatrix(cs.transform).a < 0) s *= -1; if (cs.scale && cs.scale !== 'none' && parseFloat(cs.scale) < 0) s *= -1; if (cs.rotate && /^(180deg|0.5turn)/.test(cs.rotate)) s *= -1 } return s < 0 }
  const out = []
  document.querySelectorAll('body svg').forEach((el, idx) => {
    if (el.closest('.clock, [data-hand]') || el.closest('svg') !== el) return
    let want = null, color = ''
    for (const r of rules) if (el.matches(r.sel)) { want = r.g; color = r.color }
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    const mask = cs.maskImage || cs.webkitMaskImage || ''
    const got = (decodeURIComponent(mask).match(/data-glyph='([\w-]+)'/) || [])[1] || null
    const kids = [...el.children].filter((k) => !/^(title|desc|defs)$/i.test(k.tagName))
    const ctl = el.closest('a, button, [role="img"], [role="button"], [aria-label]')
    out.push({
      idx, want, got, color, cls: el.getAttribute('class') || '', sig: (el.querySelector('path, circle, rect, ellipse') || {}).outerHTML?.slice(0, 70) || '',
      visible: el.checkVisibility({ visibilityProperty: true }) && r.width > 0, display: cs.display,
      kidsHidden: kids.length > 0 && kids.every((k) => getComputedStyle(k).visibility === 'hidden' || getComputedStyle(k).display === 'none'),
      kidsShown: kids.some((k) => getComputedStyle(k).visibility !== 'hidden' && getComputedStyle(k).display !== 'none'),
      rect: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }, fg: cs.color, bg: cs.backgroundColor,
      flipped: flip(el), mirror: el.matches(mirror), hidden: el.getAttribute('aria-hidden'),
      name: ctl ? (ctl.getAttribute('aria-label') || ctl.textContent.trim().replace(/\s+/g, ' ').slice(0, 60)) : '',
    })
  })
  return { icons: out, height: document.documentElement.scrollHeight, dir: document.documentElement.dir || getComputedStyle(document.documentElement).direction }
}
const norm = (c) => c.replace(/\s+/g, '').toLowerCase()
const hex2rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`

// ---- the suite (onCss = the file as shipped; the mutation passes the file without the section) ----------------------
async function suite(onCss, label, pages = PAGES, widths = WIDTHS, quiet = false) {
  const p0 = pass, f0 = fail
  const seen = new Map() // glyph -> where
  const byLang = {}
  for (const pg of pages) for (const w of widths) for (const lang of ['en', 'ar']) {
    const A = await open(pg, lang, w, onCss), B = await open(pg, lang, w, OFF)
    const on = await A.p.evaluate(measure, { rules: RULESEL, mirror: MIRRORSEL }), off = await B.p.evaluate(measure, { rules: RULESEL, mirror: MIRRORSEL })
    const T = `${label} ${pg.id} ${lang} ${w}px`
    is(on.icons.length === off.icons.length, `${T}: same icons on and off (${on.icons.length})`)
    is(Math.abs(on.height - off.height) < 0.5, `${T}: page height unchanged (no layout shift)`, `${off.height} -> ${on.height}`)
    let replaced = 0
    on.icons.forEach((a, k) => {
      const b = off.icons[k]; if (!b) return
      const id = `${T} #${a.idx} ${a.want || a.sig}`
      const storefront = /sporta-icon/.test(a.cls) || a.want
      if (a.visible && storefront && a.display !== 'none') {
        is(!!a.want, `${id}: is in the inventory (the set has a glyph for it)`, a.sig)
        if (!a.want) return
        replaced++
        is(a.got === a.want, `${id}: is painted with the "${a.want}" glyph`, `mask glyph ${a.got}`)
        is(a.kidsHidden && !(a.got && a.kidsShown), `${id}: the old shapes are hidden and the glyph is drawn once`)
        is(b.kidsShown && !b.got, `${id}: (off) the old drawing is what shows without the section`)
        const want = a.color ? hex2rgb(a.color) : norm(a.fg)
        is(norm(a.bg) === want, `${id}: painted in ${a.color ? 'the old hard-coded colour ' + a.color : 'currentColor'}`, `${a.bg} vs ${want}`)
        if (!seen.has(a.want)) seen.set(a.want, `${pg.id} ${lang} ${w}`)
      }
      const dx = Math.max(Math.abs(a.rect.x - b.rect.x), Math.abs(a.rect.y - b.rect.y), Math.abs(a.rect.w - b.rect.w), Math.abs(a.rect.h - b.rect.h))
      is(dx <= 0.5, `${id}: same box and position as before`, `off ${JSON.stringify(b.rect)} on ${JSON.stringify(a.rect)}`)
      is(a.name === b.name && a.hidden === b.hidden, `${id}: accessible name and aria-hidden unchanged`, `${b.name}/${b.hidden} -> ${a.name}/${a.hidden}`)
      const rtl = on.dir === 'rtl'
      const expectFlip = a.mirror && rtl ? !b.flipped : b.flipped
      is(a.flipped === expectFlip, `${id}: ${a.mirror && rtl ? 'mirrored in RTL by the section' : 'mirroring unchanged'}`, `off ${b.flipped} on ${a.flipped}`)
      if (a.mirror) is(a.flipped === rtl, `${id}: points the reading direction (${rtl ? 'mirrored' : 'not mirrored'} in ${rtl ? 'Arabic' : 'English'})`)
      if (a.want && !DIRECTIONAL.has(a.want) && a.visible) is(!a.flipped || /rotate-180/.test(a.cls), `${id}: a symmetric glyph is not mirrored`)
    })
    is(pages !== PAGES || replaced > 0 || pg.id === 'screen/terms', `${T}: icons replaced on the page: ${replaced}`)
    byLang[`${pg.id}|${w}|${lang}`] = on
    byLang[`${pg.id}|${w}|${lang}|off`] = off
    // ink: each glyph once per page actually paints inside its box
    if (w === 390 && onCss === FULL) {
      const done = new Set()
      for (const a of on.icons) {
        if (!a.want || !a.visible || done.has(a.want) || a.rect.w < 8) continue
        done.add(a.want)
        const clip = await A.p.evaluate((i) => { const e = document.querySelectorAll('body svg')[i].getBoundingClientRect(); return { x: e.left + scrollX, y: e.top + scrollY, width: e.width, height: e.height } }, a.idx)
        const P = png(await A.p.screenshot({ fullPage: true, clip }))
        // ink = pixels that differ clearly from the background at the box corner (the glyph never reaches a corner)
        const corner = P.at(0, 0); let ink = 0
        for (let y = 0; y < P.h; y++) for (let x = 0; x < P.w; x++) { const q = P.at(x, y); if (Math.abs(q.r - corner.r) + Math.abs(q.g - corner.g) + Math.abs(q.b - corner.b) > 60) ink++ }
        is(ink >= 4, `${T}: the "${a.want}" glyph paints (${ink} ink px in its ${a.rect.w}px box)`)
      }
    }
    // hover: the glyph follows the control's hover colour
    if (w === 1280 && lang === 'en') {
      let n = 0
      for (const a of on.icons) {
        if (!a.want || !a.visible || n >= 6) continue
        const sel = `body svg >> nth=${a.idx}`
        const ok = await A.p.evaluate((i) => { const s = document.querySelectorAll('body svg')[i]; const c = s.closest('a, button'); if (!c) return false; const r = c.getBoundingClientRect(); return r.width > 0 && getComputedStyle(c).pointerEvents !== 'none' }, a.idx)
        if (!ok) continue
        n++
        await A.p.evaluate((i) => document.querySelectorAll('body svg')[i].closest('a, button').scrollIntoView({ block: 'center' }), a.idx)
        await A.p.locator(sel).locator('xpath=ancestor::*[self::a or self::button][1]').hover({ force: true, timeout: 2000 }).catch(() => {})
        await A.p.waitForTimeout(260)
        const h = await A.p.evaluate((i) => { const s = document.querySelectorAll('body svg')[i], cs = getComputedStyle(s); return { fg: cs.color, bg: cs.backgroundColor } }, a.idx)
        is(norm(h.bg) === (a.color ? hex2rgb(a.color) : norm(h.fg)), `${T} #${a.idx} ${a.want}: on hover the glyph is still in the control's colour`, `${h.bg} vs ${h.fg}`)
      }
    }
    await A.ctx.close(); await B.ctx.close()
  }
  // direction across languages: the same icon in Arabic and English
  let skipped = 0
  for (const key of Object.keys(byLang).filter((k) => k.endsWith('|en'))) {
    const en = byLang[key], ar = byLang[key.replace(/\|en$/, '|ar')]
    if (!ar || ar.icons.length !== en.icons.length) continue
    en.icons.forEach((e, k) => {
      const a = ar.icons[k]
      if (!e.want || !a.want || !e.visible) return
      const id = `${label} ${key.replace(/\|en$/, '')} #${e.idx} ${e.want}`
      const offAr = byLang[key.replace(/\|en$/, '|ar|off')].icons[k], offEn = byLang[key + '|off'].icons[k]
      if (e.want === 'arrow-right' || e.want === 'arrow-up-right' || e.want === 'returns') {
        // the build mirrors these with its own rtl: classes; a capture whose stylesheet lacks that rule (grid/tiles) cannot show it
        if (offAr.flipped === offEn.flipped && !a.mirror) { skipped++; return }
        is(a.flipped !== e.flipped, `${id}: points the other way in Arabic (directional)`)
      }
      else if (/^chevron-(left|right)$/.test(e.want)) is(a.want !== e.want && !a.flipped && !e.flipped, `${id}: the Arabic page draws the opposite chevron (picked by language, not mirrored)`, `${e.want}/${a.want}`)
      else is(a.flipped === e.flipped, `${id}: same orientation in both languages (not directional)`)
    })
  }
  if (skipped && !quiet) console.log(`note: ${skipped} directional icons on captures without the build's RTL rule (grid/tiles) were not compared across languages; the same icons are compared on screen/home`)
  if (!quiet) console.log(`${label}: ${pass - p0} passed, ${fail - f0} failed; glyphs seen live: ${[...seen.keys()].sort().join(', ')}`)
  return { pass: pass - p0, fail: fail - f0, seen }
}

head('the set on the live pages')
const main = process.env.SKIPMAIN ? { seen: new Map() } : await suite(FULL, 'on')

const inventoried = new Set(RULES.map((r) => r.g))
for (const g of inventoried) {
  if (g === 'heart-filled' || g === 'trash') { is(main.seen.has(g), `"${g}" is replaced on the drawer page (state added with the build's markup)`); continue }
  is(main.seen.has(g), `inventoried glyph "${g}" was found and replaced on a captured page`)
}

head('the line is 1.5px on a 16px box (quantity plus, product page)')
{
  const pg = PAGES.find((x) => x.id === 'product/full')
  const { p, ctx } = await open(pg, 'en', 390, FULL, 2)
  const c = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label="Increase quantity"] svg')].find((e) => e.checkVisibility() && e.getBoundingClientRect().width > 0)
    b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
  })
  if (process.env.DBG2) console.log(c)
  // a column through the horizontal bar, clear of the vertical one (bar from 5.25 to 18.75 of 24)
  const P = png(await p.screenshot({ fullPage: true, clip: { x: Math.round(c.x + c.w * 0.3), y: Math.floor(c.y), width: 1, height: Math.ceil(c.h) } }))
  const bgp = P.at(0, 0); let ink = 0, maxd = 0
  for (let y = 0; y < P.h; y++) maxd = Math.max(maxd, Math.abs(P.at(0, y).r - bgp.r))
  for (let y = 0; y < P.h; y++) ink += Math.abs(P.at(0, y).r - bgp.r) / (maxd || 1)
  is(c.w === 16 && Math.abs(ink / 2 - 1.5) < 0.25, `the plus is drawn with a ${(ink / 2).toFixed(2)}px line on a ${c.w}px box (token 1.5px)`)
  console.log(`stroke: ${(ink / 2).toFixed(2)}px on a ${c.w}px box`)
  await ctx.close()
}

head('mutation: the section removed must fail')
{
  const f0 = fail, p0 = pass, F0 = fails.length
  const m = await suite(OFF, 'mutation', PAGES.filter((x) => ['screen/home', 'screen/drawer', 'product/full', 'tiles', 'contact'].includes(x.id)), [390], true)
  fails.length = F0; fail = f0; pass = p0
  console.log(`mutation run: ${m.fail} checks fail without the section (${m.pass} still pass)`)
  is(m.fail > 50, 'the suite fails when the ICON SET section is removed', `${m.fail} failing checks`)
}

await browser.close(); scr.server.close(); prd.server.close()
if (fails.length) { console.log('\nFAILURES (first 60):'); for (const f of fails.slice(0, 60)) console.log('FAIL ' + f) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
