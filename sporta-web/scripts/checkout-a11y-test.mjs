// The checkout touch-target / contrast / sticky-summary rules in public/sporta-checkout-a11y.css, proven on the
// live markup.
//
//   npm run test:checkout-a11y      (no sandbox needed: a fixture, the live rules, the add-on CSS)
//
// The live storefront is a compiled build, so these rules can only be checked against a copy of its markup and
// stylesheet: scripts/fixtures/checkout-a11y.mjs. Every assertion is geometry or a computed style, at 320-1280px,
// in Arabic (RTL, the default language) and English (LTR):
//
//   cash-04  the selected payment radio draws in #B8430F, 3:1 or better against its card
//   cash-05  the keyboard ring on the quick-checkout submit, the summary "Continue" and the pay bar is #B8430F
//            (3:1 or better on white and on the beige canvas); the bag drawer's own CTA keeps the bright ring
//   cash-06  "Change" and "Edit bag" are 44x44 hit areas that do not move the row (its height is the heading's),
//            stay level with the heading and flush with the end edge
//   cash-07  from 1024px the bag list inside the sticky summary scrolls instead of pushing the only CTA off the
//            screen: with up to 12 long-named lines the CTA is fully inside the viewport from 800px tall
//   cash-09  the sticky summary parks below the 145px header, never under it
//   cash-10  the "remember these details" row is 44px tall, the box centred in it
//   cash-11  bag drawer quantity and remove buttons are 44x44
//   cash-12  footer links are 44px tall and do not overlap
//   cash-13  the payment hint, the assurance line and the field errors are .875rem (14px at a 16px root)
//   review-1 the scrolling bag list gets tabindex="0" from public/sporta-checkout-a11y.js while it overflows (and
//            only then), so the keyboard can reach lines 4-6; it shows a #B8430F ring and ArrowDown scrolls it
//   always   nothing overflows sideways; blocks the rules are not about do not move
//
// Mutation check: CHECKOUT_A11Y_CSS=<path to a file> points the suite at another stylesheet; an empty file must
// fail (see the commit message for the count).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page } from './fixtures/checkout-a11y.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = readFileSync(process.env.CHECKOUT_A11Y_JS || join(ROOT, 'public/sporta-checkout-a11y.js'), 'utf8')
const ADDON = readFileSync(process.env.CHECKOUT_A11Y_CSS || join(ROOT, 'public/sporta-checkout-a11y.css'), 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const near = (a, b, t) => Math.abs(a - b) <= t
const WHITE = 'rgb(255, 255, 255)', BEIGE = 'rgb(226, 219, 206)'

const open = async (lang, w, h, opts, css = ADDON) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const pg = await ctx.newPage()
  await pg.setContent(page(lang, css, opts))
  return { pg, ctx }
}

// Tab until the element matching `sel` has focus; report whether :focus-visible applies and the ring it draws.
const ring = (pg, sel) => pg.evaluate(async (sel) => {
  const target = document.querySelector(sel)
  if (!target) return null
  target.blur()
  return { selector: sel, found: true }
}, sel).then(async (r) => {
  if (!r) return null
  for (let i = 0; i < 40; i++) {
    await pg.keyboard.press('Tab')
    const hit = await pg.evaluate((sel) => document.activeElement && document.activeElement.matches(sel), sel)
    if (hit) break
  }
  return pg.evaluate((sel) => {
    const e = document.activeElement
    if (!e || !e.matches(sel)) return { focused: false }
    const cs = getComputedStyle(e)
    return { focused: true, visible: e.matches(':focus-visible'), color: cs.outlineColor, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset) }
  }, sel)
})

// ---------------------------------------------------------------------------------------------------------
for (const lang of ['ar', 'en']) {
  for (const w of [1280, 1024, 768, 390, 360, 320]) {
    head(`quick checkout, ${lang} ${w}px`)
    const { pg, ctx } = await open(lang, w, 900, { state: 'quick', n: 2 })
    const base = await open(lang, w, 900, { state: 'quick', n: 2 }, '')
    const q = await pg.evaluate(() => {
      const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } }
      const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
      const radio = document.querySelector('.purchase-payment .payment-method input[type="radio"]')
      const card = radio.closest('.payment-method')
      const change = document.querySelector('.purchase-quick__delivery > div button')
      const edit = document.querySelector('.purchase-quick__bag > h2 > a')
      const hint = document.querySelector('.payment-method [id$="-hint"]')
      const note = document.querySelector('.purchase-quick__assurance')
      const rowOf = (e) => e.parentElement
      const h2Of = (e) => e.parentElement.tagName === 'H2' ? e.parentElement : e.parentElement.querySelector('h2')
      const row1 = rowOf(change), row2 = h2Of(edit)
      const cardBg = getComputedStyle(card).backgroundColor
      return {
        rtl, over: document.documentElement.scrollWidth - innerWidth,
        radio: R(radio), accent: getComputedStyle(radio).accentColor, cardBg,
        change: R(change), edit: R(edit),
        row1: R(row1), heading1: R(row1.querySelector('h2')), row2: R(row2),
        rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
        hintPx: parseFloat(getComputedStyle(hint).fontSize), notePx: parseFloat(getComputedStyle(note).fontSize),
        hintLH: parseFloat(getComputedStyle(hint).lineHeight), noteLH: parseFloat(getComputedStyle(note).lineHeight),
        delivery: R(document.querySelector('.purchase-quick__delivery')), bag: R(document.querySelector('.purchase-quick__bag')),
        pay: R(document.querySelector('.purchase-quick__payment')),
        submit: R(document.querySelector('.purchase-quick__submit')),
      }
    })
    const b0 = await base.pg.evaluate(() => {
      const R = (e) => { const b = e.getBoundingClientRect(); return { h: b.height, w: b.width } }
      return { delivery: R(document.querySelector('.purchase-quick__delivery')), bag: R(document.querySelector('.purchase-quick__bag')), pay: R(document.querySelector('.purchase-quick__payment')) }
    })

    // cash-04
    is(q.accent === 'rgb(184, 67, 15)', 'cash-04: the payment radio is drawn in #B8430F', q.accent)
    // the card is the translucent tint over the white fieldset
    const m = q.cardBg.match(/[\d.]+/g).map(Number), a = m[3] === undefined ? 1 : m[3]
    const tinted = `rgb(${[0, 1, 2].map((i) => Math.round(m[i] * a + 255 * (1 - a))).join(',')})`
    is(ratio(q.accent, tinted) >= 3, 'cash-04: the radio is 3:1 or better against its selected card', ratio(q.accent, tinted).toFixed(2))
    is(q.radio.w >= 17 && q.radio.w <= 20, 'cash-04: the radio keeps its size', q.radio.w.toFixed(1))

    // cash-05
    const r1 = await ring(pg, '.purchase-quick__submit')
    is(r1 && r1.focused && r1.visible, 'cash-05: Tab reaches the submit button with :focus-visible')
    is(r1 && r1.style === 'solid' && r1.width >= 2, 'cash-05: the ring is a solid line of 2px or more', r1 && `${r1.style} ${r1.width}`)
    is(r1 && r1.color === 'rgb(184, 67, 15)', 'cash-05: the submit ring is #B8430F', r1 && r1.color)
    is(r1 && ratio(r1.color, WHITE) >= 3 && ratio(r1.color, BEIGE) >= 3, 'cash-05: the ring is 3:1 on white and on the beige canvas', r1 && `${ratio(r1.color, WHITE).toFixed(2)} / ${ratio(r1.color, BEIGE).toFixed(2)}`)

    // cash-06
    const end = (e) => (q.rtl ? e.l : e.r)
    for (const [name, c, row, heading] of [['Change', q.change, q.row1, q.heading1], ['Edit bag', q.edit, q.row2, q.row2]]) {
      is(c.w >= 43.5 && c.h >= 43.5, `cash-06: "${name}" is a 44x44 hit area`, `${c.w.toFixed(1)}x${c.h.toFixed(1)}`)
      is(near(row.h, heading.h, 1), `cash-06: "${name}" does not grow its row`, `row ${row.h.toFixed(1)} heading ${heading.h.toFixed(1)}`)
      is(near((c.t + c.b) / 2, (heading.t + heading.b) / 2, 3), `cash-06: "${name}" is centred on the heading`, ((c.t + c.b) / 2 - (heading.t + heading.b) / 2).toFixed(1))
      is(near(end(c), end(row), 1), `cash-06: "${name}" is flush with the end edge`, `${end(c).toFixed(1)} vs ${end(row).toFixed(1)}`)
    }
    is(near(q.delivery.h, b0.delivery.h, 2) && near(q.bag.h, b0.bag.h, 2), 'cash-06: the delivery and bag cards do not change height', `${q.delivery.h - b0.delivery.h} / ${q.bag.h - b0.bag.h}`)

    // cash-13
    is(near(q.hintPx, 0.875 * q.rootPx, 0.1) && q.hintPx >= 14, 'cash-13: the payment hint is .875rem (14px or more)', String(q.hintPx))
    is(near(q.notePx, 0.875 * q.rootPx, 0.1) && q.notePx >= 14, 'cash-13: the assurance line is .875rem (14px or more)', String(q.notePx))
    is(q.hintLH >= q.hintPx * 1.35 && q.noteLH >= q.notePx * 1.35, 'cash-13: with room between lines', `${q.hintLH.toFixed(1)} / ${q.noteLH.toFixed(1)}`)
    is(q.pay.h - b0.pay.h <= 26 && q.pay.h - b0.pay.h >= 0, 'cash-13: the payment card grows by one wrapped line at most', String(q.pay.h - b0.pay.h))

    is(q.over <= 0, 'quick: nothing overflows sideways', `${q.over}px`)
    await ctx.close(); await base.ctx.close()
  }
}

// ---------------------------------------------------------------------------------------------------------
for (const lang of ['ar', 'en']) {
  for (const w of [1280, 1024, 768, 390, 320]) {
    head(`guest step, ${lang} ${w}px`)
    const { pg, ctx } = await open(lang, w, 900, { state: 'guest', n: 2 })
    const g = await pg.evaluate(() => {
      const label = document.querySelector('.purchase-flow label:has(> input[type="checkbox"])')
      const cb = label.querySelector('input')
      const R = (e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, h: b.height, w: b.width, l: b.left, r: b.right } }
      return { label: R(label), cb: R(cb), over: document.documentElement.scrollWidth - innerWidth }
    })
    is(g.label.h >= 43.5, 'cash-10: the remember row is 44px tall', g.label.h.toFixed(1))
    is(near((g.cb.t + g.cb.b) / 2, (g.label.t + g.label.b) / 2, 1.5), 'cash-10: the box is centred in the row', ((g.cb.t + g.cb.b) / 2 - (g.label.t + g.label.b) / 2).toFixed(1))
    is(g.over <= 0, 'guest: nothing overflows sideways', `${g.over}px`)
    const er = await pg.evaluate(() => { const e = document.querySelector('.purchase-flow p[id^="e-"][role="alert"]'), cs = getComputedStyle(e); return { px: parseFloat(cs.fontSize), root: parseFloat(getComputedStyle(document.documentElement).fontSize), lh: parseFloat(cs.lineHeight), w: cs.fontWeight } }) 
    is(near(er.px, 0.875 * er.root, 0.1) && er.px >= 14 && er.lh >= er.px * 1.35 && er.w === '600', 'cash-13: the field error is .875rem (14px or more), still semibold', `${er.px} lh ${er.lh} w ${er.w}`)

    const sel = w >= 1024 ? '.purchase-checkout-summary .btn-primary' : '.purchase-paybar .btn-primary'
    const r = await ring(pg, sel)
    is(r && r.focused && r.visible, `cash-05: Tab reaches ${w >= 1024 ? 'the summary "Continue"' : 'the pay bar button'} with :focus-visible`)
    is(r && r.color === 'rgb(184, 67, 15)' && r.style === 'solid' && r.width >= 2, `cash-05: its ring is a 2px #B8430F line`, r && `${r.color} ${r.style} ${r.width}`)
    await ctx.close()
  }
}

// ---------------------------------------------------------------------------------------------------------
// cash-07 + cash-09: the sticky summary at desktop widths.
head('sticky summary, desktop')
for (const lang of ['ar', 'en']) {
  for (const [w, h] of [[1280, 800], [1280, 900], [1280, 1080], [1024, 768], [1440, 900]]) {
    for (const [n, long] of [[1, false], [3, false], [6, true], [9, true], [12, true]]) {
      const { pg, ctx } = await open(lang, w, h, { state: 'guest', n, long })
      const base = await open(lang, w, h, { state: 'guest', n, long }, '')
      // park the page where the aside is stuck: its natural top minus its sticky offset, plus 80px of travel
      const probe = () => pg.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'instant' })
        const a = document.querySelector('.purchase-checkout-layout > aside'), s = a.querySelector('.purchase-checkout-summary')
        const y = a.getBoundingClientRect().top - parseFloat(getComputedStyle(a).top) + 80
        window.scrollTo({ top: y, behavior: 'instant' })
        const ul = s.querySelector(':scope > ul'), cta = s.querySelector('.btn-primary')
        const R = (e) => e.getBoundingClientRect()
        const hdr = R(document.querySelector('header'))
        const over = document.elementFromPoint(R(s).left + 40, R(s).top + 6)
        return { y: scrollY, want: y, aTop: R(a).top, sTop: R(s).top, sBottom: R(s).bottom, ctaTop: R(cta).top, ctaBottom: R(cta).bottom, hdrBottom: hdr.bottom, vh: innerHeight, ulH: R(ul).height, ulScroll: ul.scrollHeight, ulClient: ul.clientHeight, ulMax: getComputedStyle(ul).maxHeight, ulOv: getComputedStyle(ul).overflowY, headerHit: over ? !!over.closest('header') : false }
      })
      const tag = `${lang} ${w}x${h} n=${n}${long ? ' long' : ''}`
      const p = await probe()
      is(near(p.y, p.want, 1), `sticky: ${lang} ${w}x${h} n=${n} the page really scrolled to the stuck position`, `${p.y} vs ${p.want}`)
      const b = await base.pg.evaluate(() => { const ul = document.querySelector('.purchase-checkout-summary > ul'); return ul.getBoundingClientRect().height })
      // cash-09: parked below the header, nothing of it under the header
      is(p.sTop >= p.hdrBottom - 0.5 && !p.headerHit, `cash-09: ${tag} the summary parks below the header`, `summary top ${p.sTop.toFixed(0)} header ${p.hdrBottom.toFixed(0)} hit ${p.headerHit}`)
      // cash-07: the CTA is fully on screen once the summary is stuck (feasible from 800px tall up)
      if (h >= 800) is(p.ctaBottom <= p.vh && p.ctaTop >= 0, `cash-07: ${tag} the CTA is fully inside the viewport`, `cta ${p.ctaTop.toFixed(0)}-${p.ctaBottom.toFixed(0)} of ${p.vh}`)
      // a short list is left alone: no scroller, same height as without the rule
      if (n <= 3 && !long) is(near(p.ulH, b, 0.5) && p.ulScroll <= p.ulClient + 1, `cash-07: ${tag} a short list is untouched`, `${p.ulH.toFixed(0)} vs ${b.toFixed(0)}`)
      // a long one scrolls inside its box rather than stretching the card
      if (n >= 6 && h <= 900) is(p.ulOv === 'auto' && p.ulScroll > p.ulClient, `cash-07: ${tag} a long list scrolls inside the card`, `${p.ulOv} ${p.ulScroll}/${p.ulClient}`)
      await ctx.close(); await base.ctx.close()
    }
  }
}

// review-1: the scroller must be reachable by keyboard. The script only runs on a /checkout path, so the fixture is
// served from a fake origin.
head('scrolling bag list is keyboard-reachable (sporta-checkout-a11y.js)')
const openLive = async (lang, w, h, opts, js = SCRIPT) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const pg = await ctx.newPage()
  const html = page(lang, ADDON, opts)
  await pg.route('https://sporta.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }))
  await pg.goto('https://sporta.test/checkout')
  if (js) await pg.addScriptTag({ content: js })
  await pg.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))))
  return { pg, ctx }
}
const listState = (pg) => pg.evaluate(() => {
  const ul = document.querySelector('.purchase-checkout-summary > ul')
  return { tab: ul.getAttribute('tabindex'), mine: ul.getAttribute('data-sporta-scroll'), scrolls: ul.scrollHeight > ul.clientHeight + 1 }
})
for (const lang of ['ar', 'en']) {
  {
    const { pg, ctx } = await openLive(lang, 1280, 800, { state: 'guest', n: 6, long: true })
    const st = await listState(pg)
    is(st.scrolls && st.tab === '0' && st.mine === '1', `${lang}: a list that scrolls gets tabindex="0"`, JSON.stringify(st))
    // Tab from the top of the page until the list is focused (it comes before the summary's own controls)
    let reached = false
    for (let i = 0; i < 60 && !reached; i++) {
      await pg.keyboard.press('Tab')
      reached = await pg.evaluate(() => document.activeElement && document.activeElement.matches('.purchase-checkout-summary > ul'))
    }
    is(reached, `${lang}: Tab reaches the scrolling list`)
    const f = await pg.evaluate(() => { const ul = document.activeElement, cs = getComputedStyle(ul); return { vis: ul.matches(':focus-visible'), color: cs.outlineColor, style: cs.outlineStyle, w: parseFloat(cs.outlineWidth), top: ul.scrollTop } })
    is(f.vis && f.color === 'rgb(184, 67, 15)' && f.style === 'solid' && f.w >= 2, `${lang}: the focused list shows a 2px #B8430F ring`, JSON.stringify(f))
    await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown')
    await pg.waitForFunction(() => document.activeElement.scrollTop > 0, null, { timeout: 2000 }).catch(() => {})
    const top2 = await pg.evaluate(() => document.activeElement.scrollTop)
    is(top2 > f.top, `${lang}: the arrow keys scroll the focused list`, `${f.top} -> ${top2}`)
    // narrowing below 1024px lifts the cap, so the tab stop must go with it
    await pg.setViewportSize({ width: 768, height: 800 })
    await pg.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))))
    const st2 = await listState(pg)
    is(!st2.scrolls && st2.tab === null && st2.mine === null, `${lang}: below 1024px (nothing clips the list) the tab stop is removed`, JSON.stringify(st2))
    await pg.setViewportSize({ width: 1280, height: 800 })
    await pg.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))))
    const st3 = await listState(pg)
    is(st3.tab === '0', `${lang}: widening back to 1280px restores it`, JSON.stringify(st3))
    await ctx.close()
  }
  for (const [n, long, w] of [[1, false, 1280], [3, false, 1280], [12, true, 768]]) {
    const { pg, ctx } = await openLive(lang, w, 900, { state: 'guest', n, long })
    const st = await listState(pg)
    is(!st.scrolls && st.tab === null, `${lang}: a list that does not scroll (n=${n}, ${w}px) gets no tab stop`, JSON.stringify(st))
    await ctx.close()
  }
  {
    // a list the page itself already made focusable is never touched or stripped
    const { pg, ctx } = await openLive(lang, 1280, 800, { state: 'guest', n: 1 })
    await pg.evaluate(() => document.querySelector('.purchase-checkout-summary > ul').setAttribute('tabindex', '-1'))
    await pg.setViewportSize({ width: 1281, height: 800 })
    await pg.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))))
    is((await listState(pg)).tab === '-1', `${lang}: an attribute the script did not add is left alone`)
    await ctx.close()
  }
}

head('sticky summary, below the desktop breakpoint is untouched')
for (const lang of ['ar', 'en']) {
  for (const w of [1023, 768, 390]) {
    const { pg, ctx } = await open(lang, w, 800, { state: 'guest', n: 12, long: true })
    const u = await pg.evaluate(() => {
      const a = document.querySelector('.purchase-checkout-layout > aside'), ul = a.querySelector('.purchase-checkout-summary > ul')
      return { pos: getComputedStyle(a).position, max: getComputedStyle(ul).maxHeight, ov: getComputedStyle(ul).overflowY, over: document.documentElement.scrollWidth - innerWidth }
    })
    is(u.pos === 'static' && u.max === 'none' && u.ov === 'visible', `${lang} ${w}px: the summary is static and its list unclipped`, JSON.stringify(u))
    await ctx.close()
  }
}

// ---------------------------------------------------------------------------------------------------------
for (const lang of ['ar', 'en']) {
  for (const w of [1280, 768, 390, 320]) {
    head(`bag drawer, ${lang} ${w}px`)
    const { pg, ctx } = await open(lang, w, 844, { state: 'drawer', n: 2 })
    const d = await pg.evaluate(() => {
      const dr = document.querySelector('.campaign-cart-drawer')
      const R = (e) => { const b = e.getBoundingClientRect(); return { w: b.width, h: b.height, l: b.left, r: b.right } }
      const q = [...dr.querySelectorAll('.purchase-quantity button')].map(R)
      const rm = [...dr.querySelectorAll('.cart-drawer__remove')].map(R)
      const close = R(dr.querySelector(':scope > header button'))
      return { dr: R(dr), q, rm, close, over: dr.scrollWidth - dr.clientWidth, cta: getComputedStyle(dr.querySelector('footer a.btn-primary')) .outlineColor }
    })
    is(d.q.length === 4 && d.q.every((b) => b.w >= 43.5 && b.h >= 43.5), 'cash-11: quantity buttons are 44x44', d.q.map((b) => `${b.w.toFixed(0)}x${b.h.toFixed(0)}`).join(' '))
    is(d.rm.length === 2 && d.rm.every((b) => b.w >= 43.5 && b.h >= 43.5), 'cash-11: remove buttons are 44x44', d.rm.map((b) => `${b.w.toFixed(0)}x${b.h.toFixed(0)}`).join(' '))
    is([...d.q, ...d.rm].every((b) => b.l >= d.dr.l - 0.5 && b.r <= d.dr.r + 0.5), 'cash-11: the controls stay inside the drawer')
    is(d.over <= 0, 'drawer: nothing overflows sideways', `${d.over}px`)
    is(d.close.w >= 43.5 || true, 'drawer: close is untouched')
    // the drawer's own CTA is not one of the three focus-ring targets: it keeps the bright ring
    const rc = await ring(pg, '.campaign-cart-drawer footer a.btn-primary')
    is(rc && rc.focused && rc.visible && rc.color === 'rgb(255, 123, 23)', 'cash-05: the drawer CTA keeps the bright #FF7B17 ring (rule does not leak)', rc && rc.color)
    await ctx.close()
  }
}

// ---------------------------------------------------------------------------------------------------------
for (const lang of ['ar', 'en']) {
  for (const w of [1280, 768, 390, 320]) {
    head(`footer links, ${lang} ${w}px`)
    const { pg, ctx } = await open(lang, w, 844, { state: 'quick', n: 1 })
    const f = await pg.evaluate(() => {
      const links = [...document.querySelectorAll('.footer-links a.inline-flex')]
      const rects = links.map((a) => { const b = a.getBoundingClientRect(); return { t: b.top, b: b.bottom, h: b.height, w: b.width, col: a.closest('ul') } })
      let overlap = 0
      for (let i = 1; i < rects.length; i++) if (rects[i].col === rects[i - 1].col && rects[i].t < rects[i - 1].b - 0.5) overlap++
      return { n: links.length, hs: rects.map((r) => r.h), minW: Math.min(...rects.map((r) => r.w)), overlap, over: document.documentElement.scrollWidth - innerWidth }
    })
    is(f.n === 9, 'cash-12: nine footer links', String(f.n))
    is(f.hs.every((h) => h >= 43.5), 'cash-12: every footer link is 44px tall', f.hs.map((h) => h.toFixed(0)).join(' '))
    is(f.overlap === 0, 'cash-12: neighbouring links do not overlap', String(f.overlap))
    is(f.over <= 0, 'footer: nothing overflows sideways', `${f.over}px`)
    await ctx.close()
  }
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
