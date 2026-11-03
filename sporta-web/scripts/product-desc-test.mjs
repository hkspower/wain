// The product page rules in public/sporta-product-fix.css (description, buy row, authenticity plate, tap
// targets), proven on the live markup and the live stylesheet rules.
//
//   npm run test:product-desc      (no sandbox needed: a fixture, the live rules, the add-on CSS)
//
// Real Chromium, Arabic (RTL, the default) and English (LTR), 320 to 1440px. Each rule is measured against
// the same page with the add-on switched off, so a pass means the add-on changed it, not that the fixture
// happened to be fine. Fonts differ from live (no Arabic font here), so the assertions are relative geometry.
//
//   DESC-06  description keeps the owner's line breaks, a long token cannot widen the page, tighter rhythm
//   DESC-09  from 768px the buy row sticks to the bottom of the screen (the fixed bar is gone from there)
//   DESC-10  the authenticity plate is shorter, nothing is hidden, nothing overflows
//   DESC-11  breadcrumb links and the Size guide button reach 44px without moving anything
//   leaks    other elements (title, reassurance list, related cards) are untouched
//
// ADDON_FILE=<path> runs the same checks against another CSS file (the mutation check passes a blank one).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page, DESC } from './fixtures/product-desc.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(process.env.ADDON_FILE || join(ROOT, 'public/sporta-product-fix.css'), 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)
const near = (a, b, t) => Math.abs(a - b) <= t

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// ---- in-page helpers (serialised into the page) -------------------------------------------------------
const H = () => {
  window.$ = (s) => document.querySelector(s)
  window.R = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top + scrollY, bottom: b.bottom + scrollY, width: b.width, height: b.height } }
  window.lines = (e) => { const g = document.createRange(); g.selectNodeContents(e); return new Set([...g.getClientRects()].map((x) => Math.round(x.top))).size }
  // the add-on is the second <style>; "off" empties it without touching the live rules
  window.addon = (on) => { const s = document.querySelectorAll('style')[1]; if (!window.__css) window.__css = s.textContent; s.textContent = on ? window.__css : '' }
  window.setDesc = (t) => { $('.catalog-product-description').textContent = t }
}

const open = async (lang, w, h, desc = DESC[lang]) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const pg = await ctx.newPage()
  await pg.setContent(page(lang, desc, ADDON))
  await pg.evaluate(H)
  return { pg, ctx }
}

const LANGS = ['ar', 'en']

// ---- DESC-06: description ---------------------------------------------------------------------------
for (const lang of LANGS) {
  for (const w of [320, 390, 768, 1280]) {
    head(`description ${lang} ${w}px`)
    const { pg, ctx } = await open(lang, w, 844)
    const OWNER = lang === 'ar' ? 'السطر الأول\nالسطر الثاني\nالسطر الثالث' : 'First line\nSecond line\nThird line'
    const m = await pg.evaluate((OWNER) => {
      const out = {}
      const d = $('.catalog-product-description'), cs = getComputedStyle(d), fs = parseFloat(cs.fontSize)
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize)
      out.cs = { ws: cs.whiteSpace, ow: cs.overflowWrap, mt: parseFloat(cs.marginTop), lh: parseFloat(cs.lineHeight), fs, root, color: cs.color, family: cs.fontFamily, size: cs.fontSize }
      out.h1 = { ow: getComputedStyle($('h1')).overflowWrap }
      // owner's three lines
      setDesc(OWNER); out.three = lines(d)
      // a trailing newline must not add a blank line; runs of spaces still collapse
      setDesc('one line\n'); out.trailing = lines(d)
      setDesc('word word'); const w1 = R(d).height; const g1 = (() => { const g = document.createRange(); g.selectNodeContents(d); return g.getBoundingClientRect().width })()
      setDesc('word     word'); const g2 = (() => { const g = document.createRange(); g.selectNodeContents(d); return g.getBoundingClientRect().width })()
      out.collapse = Math.abs(g1 - g2)
      // a 70-character token: URL, SKU, hashtag
      const tok = 'https://example.com/' + 'a'.repeat(50)
      setDesc(tok)
      out.token = { doc: document.documentElement.scrollWidth, inner: innerWidth, dScroll: d.scrollWidth, dClient: d.clientWidth }
      // a long paragraph still wraps inside the column
      setDesc(Array(40).fill(OWNER.split('\n')[0]).join(' '))
      out.long = { doc: document.documentElement.scrollWidth, inner: innerWidth, lines: lines(d), right: R(d).right, parentRight: R(d.parentElement).right }
      // a short one is one line
      setDesc('short'); out.short = lines(d)
      // leak checks: nothing else got the pre-line / anywhere treatment
      out.leak = {
        li: getComputedStyle($('.catalog-product-reassurance li')).whiteSpace,
        card: getComputedStyle($('.catalog-card-name')).whiteSpace,
        eyebrow: getComputedStyle($('.catalog-eyebrow')).whiteSpace,
        titleLh: getComputedStyle($('h1')).lineHeight,
      }
      return out
    }, OWNER)
    is(m.cs.ws === 'pre-line', 'white-space is pre-line', m.cs.ws)
    is(m.cs.ow === 'anywhere', 'overflow-wrap is anywhere (as the title already is)', `${m.cs.ow} / h1 ${m.h1.ow}`)
    is(m.three === 3, "the owner's 3 lines render as 3 lines", `${m.three}`)
    is(m.trailing === 1, 'a trailing newline adds no blank line', `${m.trailing}`)
    is(m.collapse < 0.5, 'runs of spaces still collapse', `${m.collapse}`)
    is(m.token.doc <= m.token.inner, 'a 70-character token does not widen the page', `scrollWidth ${m.token.doc} vs ${m.token.inner}`)
    is(m.token.dScroll <= m.token.dClient + 0.5, 'the token wraps inside the description', `${m.token.dScroll} vs ${m.token.dClient}`)
    is(m.long.doc <= m.long.inner && m.long.right <= m.long.parentRight + 0.5, 'a long paragraph stays inside the column', `lines ${m.long.lines}`)
    is(m.short === 1, 'a short description is still one line', `${m.short}`)
    is(near(m.cs.mt, 0.5 * m.cs.root, 0.3), 'gap under the title is .5rem (was .75rem)', `${m.cs.mt}px at root ${m.cs.root}`)
    is(near(m.cs.lh, 1.55 * m.cs.fs, 0.3), 'line height is 1.55 (was 1.625)', `${m.cs.lh}px for ${m.cs.fs}px`)
    is(near(m.cs.fs, 0.9375 * m.cs.root, 0.3), 'size is unchanged (.9375rem)', m.cs.size)
    is(m.leak.li === 'normal' && m.leak.card === 'normal' && m.leak.eyebrow === 'normal', 'no other text got pre-line', JSON.stringify(m.leak))
    is(m.leak.titleLh !== '', 'title untouched', m.leak.titleLh)
    await ctx.close()
  }
}

// ---- DESC-09: sticky buy row -------------------------------------------------------------------------
for (const lang of LANGS) {
  for (const [w, h] of [[320, 640], [390, 844], [767, 700], [768, 700], [900, 600], [1000, 600], [1280, 500], [1440, 600]]) {
    head(`buy row ${lang} ${w}x${h}`)
    const { pg, ctx } = await open(lang, w, h)
    const state = (scrollTo) => pg.evaluate((scrollTo) => {
      const row = $('.product-purchase-row'), sum = $('.catalog-product-summary'), bar = $('.action-bar')
      if (scrollTo === 'summary') scrollTo = Math.max(0, R(sum).top - innerHeight / 3)
      if (scrollTo === 'end') scrollTo = document.documentElement.scrollHeight
      if (typeof scrollTo === 'number') window.scrollTo(0, scrollTo)
      const rr = row.getBoundingClientRect(), cs = getComputedStyle(row), s = sum.getBoundingClientRect()
      const rel = $('.catalog-related').getBoundingClientRect()
      return {
        pos: cs.position, bottom: cs.bottom, z: cs.zIndex, bg: cs.backgroundColor, pad: parseFloat(cs.paddingTop), padB: parseFloat(cs.paddingBottom),
        shadow: cs.boxShadow, root: parseFloat(getComputedStyle(document.documentElement).fontSize),
        top: rr.top, rbottom: rr.bottom, left: rr.left, width: rr.width, height: rr.height, rowScrollW: row.scrollWidth, rowClientW: row.clientWidth,
        sumTop: s.top, sumBottom: s.bottom, sumLeft: s.left, sumWidth: s.width, relTop: rel.top,
        barDisplay: getComputedStyle(bar).display, barPos: getComputedStyle(bar).position, barBottom: bar.getBoundingClientRect().bottom,
        inner: innerHeight, docW: document.documentElement.scrollWidth, innerW: innerWidth, cols: cs.gridTemplateColumns.split(' ').length,
      }
    }, scrollTo)
    await pg.evaluate(() => addon(false))
    const base0 = await state(0)
    const baseSum = await state('summary')
    await pg.evaluate(() => addon(true))
    const on0 = await state(0)
    const onSum = await state('summary')
    const onEnd = await state('end')
    is(on0.docW <= on0.innerW, 'nothing overflows sideways', `${on0.docW} vs ${on0.innerW}`)
    if (w < 768) {
      is(on0.pos === 'static', 'under 768px the row is untouched (the fixed bar carries it)', on0.pos)
      is(on0.barDisplay !== 'none' && on0.barPos === 'fixed', 'the fixed buy bar is shown', `${on0.barDisplay}/${on0.barPos}`)
      is(on0.pad === 0 && on0.shadow === 'none', 'no padding or shadow added under 768px', `${on0.pad} ${on0.shadow}`)
    } else {
      is(on0.barDisplay === 'none', 'the fixed bar is gone from 768px', on0.barDisplay)
      is(on0.pos === 'sticky' && on0.bottom === '0px', 'the row is sticky at the bottom', `${on0.pos} ${on0.bottom}`)
      is(on0.z === '5', 'above the content, below the header and the drawers (z-index 5)', on0.z)
      is(on0.bg === 'rgb(255, 255, 255)', 'opaque canvas background (nothing shows through)', on0.bg)
      is(near(on0.pad, 0.75 * on0.root, 0.3) && near(on0.padB, 0.75 * on0.root, 0.3), 'padding .75rem top and bottom', `${on0.pad}/${on0.padB}`)
      is(on0.shadow !== 'none', 'a hairline above it', on0.shadow)
      // the point of it: with the add-on off the row is below the fold, with it on the row is on screen
      is(base0.rbottom > base0.inner || baseSum.rbottom > baseSum.inner, 'precondition: without the add-on the row is below the fold', `${Math.round(base0.rbottom)} / ${Math.round(baseSum.rbottom)} vs ${base0.inner}`)
      is(onSum.rbottom <= onSum.inner + 0.5 && onSum.top >= 0, 'with the add-on the row is on screen once the summary is in view', `bottom ${Math.round(onSum.rbottom)} vs ${onSum.inner}`)
      if (w >= 1024) is(on0.rbottom <= on0.inner + 0.5, 'two columns: on screen at the very top of the page', `bottom ${Math.round(on0.rbottom)} vs ${on0.inner}`)
      is(onSum.top >= onSum.sumTop - 0.5, 'it never leaves its own section upwards', `${Math.round(onSum.top)} vs ${Math.round(onSum.sumTop)}`)
      is(near(onSum.left, onSum.sumLeft, 1) && near(onSum.width, onSum.sumWidth, 1), 'full width of the summary column', `${Math.round(onSum.width)} vs ${Math.round(onSum.sumWidth)}`)
      is(onEnd.rbottom <= onEnd.sumBottom + 0.5 && onEnd.rbottom <= onEnd.relTop + 0.5, 'at the end of the page it rests in its section, not over the related products', `row ${Math.round(onEnd.rbottom)} section ${Math.round(onEnd.sumBottom)} related ${Math.round(onEnd.relTop)}`)
      is(on0.rowScrollW <= on0.rowClientW + 0.5, 'the row content fits (quantity, add, buy now)', `${on0.rowScrollW} vs ${on0.rowClientW}`)
      // dark theme: the background follows --canvas
      await pg.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); document.documentElement.style.setProperty('--canvas', '#171a1e') })
      const dark = await state(null)
      is(dark.bg === 'rgb(23, 26, 30)', 'dark theme: the row follows --canvas', dark.bg)
    }
    await ctx.close()
  }
}

// ---- DESC-10: authenticity plate ---------------------------------------------------------------------
for (const lang of LANGS) {
  for (const [w, variant] of [[390, 'owner only'], [390, 'with maker'], [768, 'owner only'], [1280, 'with maker']]) {
    head(`plate ${lang} ${w}px ${variant}`)
    const { pg, ctx } = await open(lang, w, 844)
    if (variant === 'with maker') await pg.evaluate(() => { const p = $('.campaign-brand-plate'); const a = $('.campaign-brand-plate__authentic'); const s = document.createElement('span'); s.className = 'campaign-brand-plate__maker text-sm font-bold'; s.textContent = 'Gymshark'; p.insertBefore(s, a) })
    const measure = () => {
      const p = $('.campaign-brand-plate'), cs = getComputedStyle(p), root = parseFloat(getComputedStyle(document.documentElement).fontSize)
      const kids = [...p.children].map((c) => ({ r: R(c), vis: getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().height > 0 }))
      const first = document.querySelector('#product-size-options button')
      return {
        h: R(p).height, pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat), rowGap: parseFloat(cs.rowGap), colGap: parseFloat(cs.columnGap), root,
        kids, pr: R(p), sizeTop: first ? R(first).top : 0, scrollW: p.scrollWidth, clientW: p.clientWidth, docW: document.documentElement.scrollWidth, innerW: innerWidth,
        logoH: R($('.campaign-brand-plate__owner img')).height, authW: R($('.campaign-brand-plate__authentic')).width, authBorder: getComputedStyle($('.campaign-brand-plate__authentic')).borderTopWidth,
      }
    }
    await pg.evaluate(() => addon(false))
    const base = await pg.evaluate(measure)
    await pg.evaluate(() => addon(true))
    const on = await pg.evaluate(measure)
    is(on.h <= base.h - 14, 'the plate is at least 14px shorter', `${Math.round(base.h)} -> ${Math.round(on.h)}`)
    is(on.sizeTop <= base.sizeTop - 14, 'the size picker moves up with it', `${Math.round(base.sizeTop)} -> ${Math.round(on.sizeTop)}`)
    is(near(on.pad[0], 0.5 * on.root, 0.3) && near(on.pad[2], 0.5 * on.root, 0.3) && near(on.pad[1], 0.75 * on.root, 0.3) && near(on.pad[3], 0.75 * on.root, 0.3), 'padding .5rem .75rem', on.pad.join(' '))
    is(near(on.rowGap, 0.25 * on.root, 0.3) && near(on.colGap, 0.75 * on.root, 0.3), 'gap .25rem .75rem', `${on.rowGap} ${on.colGap}`)
    is(on.kids.every((k) => k.vis) && on.kids.length === base.kids.length, 'nothing is hidden', `${on.kids.length} children`)
    is(on.kids.every((k) => k.r.left >= on.pr.left - 0.5 && k.r.right <= on.pr.right + 0.5 && k.r.bottom <= on.pr.bottom + 0.5), 'every child sits inside the plate')
    is(on.scrollW <= on.clientW + 0.5 && on.docW <= on.innerW, 'nothing overflows', `${on.scrollW}/${on.clientW}`)
    is(near(on.logoH, base.logoH, 0.5), 'the logo keeps its height', `${base.logoH} -> ${on.logoH}`)
    is(near(on.authW, on.clientW - on.pad[1] - on.pad[3], 1.5) && on.authBorder === '1px', 'the authentic line keeps its own full-width row and rule', `${Math.round(on.authW)} border ${on.authBorder}`)
    await ctx.close()
  }
}

// ---- DESC-11: tap targets ----------------------------------------------------------------------------
for (const lang of LANGS) {
  for (const w of [320, 390, 768, 1280]) {
    head(`tap targets ${lang} ${w}px`)
    const { pg, ctx } = await open(lang, w, 844)
    const measure = () => {
      const links = [...document.querySelectorAll('.catalog-product-page nav a')].map((a) => R(a))
      const guide = [...document.querySelectorAll('.catalog-product-options button.text-accent')].map((b) => R(b))
      const hit = (r, dy) => { const x = (r.left + r.right) / 2, y = r.top - scrollY + dy; const e = document.elementFromPoint(x, y); return !!e && !!e.closest('a,button') }
      const card = $('.catalog-card-info a')
      return {
        links, guide, navH: R($('nav')).height, h1Top: R($('h1')).top, visTop: R($('.catalog-product-visual')).top, eyebrow: R($('.catalog-eyebrow')).top,
        optsH: R($('#product-size-options')).height, optsTop: R($('#product-size-options')).top, cardLink: R(card).height,
        hitTop: links.map((r) => hit(r, 3)), hitBottom: links.map((r) => hit(r, r.height - 3)),
        guideHit: guide.map((r) => hit(r, 3)), docW: document.documentElement.scrollWidth, innerW: innerWidth,
        n: document.querySelectorAll('.catalog-product-page nav a').length,
      }
    }
    await pg.evaluate(() => addon(false))
    const base = await pg.evaluate(measure)
    await pg.evaluate(() => addon(true))
    const on = await pg.evaluate(measure)
    is(on.links.length === 2 && on.guide.length === 1, 'two breadcrumb links and one Size guide button found', `${on.links.length}/${on.guide.length}`)
    is(on.links.every((r) => r.height >= 43.9 && r.width >= 43.9), 'breadcrumb links are 44px or more each way', on.links.map((r) => Math.round(r.width) + 'x' + Math.round(r.height)).join(' ') + '  was ' + base.links.map((r) => Math.round(r.width) + 'x' + Math.round(r.height)).join(' '))
    is(on.guide.every((r) => r.height >= 43.9 && r.width >= 43.9), 'Size guide is 44px or more each way', on.guide.map((r) => Math.round(r.width) + 'x' + Math.round(r.height)).join(' ') + '  was ' + base.guide.map((r) => Math.round(r.width) + 'x' + Math.round(r.height)).join(' '))
    const sorted = [...on.links].sort((a, b) => a.left - b.left)
    is(sorted.every((r, i) => i === 0 || r.left >= sorted[i - 1].right - 1), 'neighbouring link boxes do not overlap', sorted.map((r) => Math.round(r.left) + '-' + Math.round(r.right)).join(' | '))
    is(on.hitTop.every(Boolean) && on.hitBottom.every(Boolean) && on.guideHit.every(Boolean), 'the extra area is really tappable (hit test on the padding)', JSON.stringify([on.hitTop, on.hitBottom, on.guideHit]))
    is(near(on.navH, base.navH, 0.6) && near(on.h1Top, base.h1Top, 0.6) && near(on.visTop, base.visTop, 0.6) && near(on.eyebrow, base.eyebrow, 0.6), 'nothing moves: nav, gallery, eyebrow and title keep their place', `nav ${base.navH}->${on.navH} gallery ${base.visTop}->${on.visTop}`)
    is(near(on.optsH, base.optsH, 0.6) && near(on.optsTop, base.optsTop, 0.6), 'the size box keeps its height and place', `${base.optsH}->${on.optsH}`)
    is(near(on.cardLink, base.cardLink, 0.1), 'related-product links are untouched', `${base.cardLink}->${on.cardLink}`)
    is(on.docW <= on.innerW, 'nothing overflows sideways', `${on.docW} vs ${on.innerW}`)
    await ctx.close()
  }
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
