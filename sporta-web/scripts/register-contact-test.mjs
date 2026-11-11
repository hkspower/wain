// The REGCONTACT section of public/sporta-shadows.css (register form on /account, and /contact), proven on the LIVE
// markup under the LIVE rules (scripts/fixtures/register, captured 2026-11-11; scripts/lib/register-page.mjs builds the
// page). Every check compares the page with the file up to the section ("off") and the whole file ("on"), Arabic and
// English, at 320, 390, 768 and 1280px.
//
//   npm run test:register-contact
//
// MUTATION: the section's checks are run once more with the section removed as "on"; at least 30 of them must fail
// (a suite that passes without the CSS proves nothing).
import { chromium } from 'playwright'
import { open, SHADOWS } from './lib/register-page.mjs'

const MARK = '/* ==== REGCONTACT:'
if (!SHADOWS.includes(MARK)) { console.error('no REGCONTACT section in public/sporta-shadows.css'); process.exit(1) }
const OFF = SHADOWS.split(MARK)[0]
let pass = 0, fail = 0, silent = false
const is = (ok, msg, detail = '') => { if (ok) { pass++; if (!silent) console.log('ok   ' + msg) } else { fail++; if (!silent) console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => { if (!silent) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`) }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

async function account(lang, w, css) {
  const { p, ctx } = await open(browser, 'account', lang, w, css)
  const m = await p.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top + scrollY, b: b.bottom + scrollY, w: b.width, h: b.height } }
    const cs = (e) => getComputedStyle(e)
    const bday = q('.sporta-bday'), email = q('#customer-email').closest('.customer-account__field')
    const name = q('#customer-name').closest('.customer-account__field')
    const sw = q('.customer-account__switch'), sup = q('.customer-account__support'), card = q('.customer-account__card')
    const sel = [...document.querySelectorAll('.sporta-bday select')]
    // links inside a sentence (Terms, Privacy policy) are exempt from the 44px target rule (WCAG 2.5.8, inline)
    const taps = [...document.querySelectorAll('.customer-account button, .customer-account a:not(.customer-account__terms a), .customer-account input, .customer-account select')].map((e) => ({ n: (e.textContent || e.id || '').trim().slice(0, 20), h: e.getBoundingClientRect().height }))
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      gapAfterBday: R(email).t - R(bday).b, gapAfterName: R(bday).t - R(name).b,
      sel: sel.map((e) => R(e).h), input: R(q('#customer-name')).h, inputs: [...document.querySelectorAll('.customer-account__field input')].map((e) => Math.round(R(e).h)),
      selBorder: sel.map((e) => cs(e).borderTopColor + ' ' + cs(e).borderTopLeftRadius), inputBorder: cs(q('#customer-name')).borderTopColor + ' ' + cs(q('#customer-name')).borderTopLeftRadius,
      selRow: sel.map((e) => [Math.round(R(e).t), Math.round(R(e).l), Math.round(R(e).r)]), bdayRow: R(q('.sporta-bday__row')),
      swBorder: cs(sw).borderTopWidth + ' ' + cs(sw).borderTopStyle, swGap: R(sw).t - R(q('.customer-account__submit')).b,
      sup: { td: cs(sup).textDecorationLine, fs: parseFloat(cs(sup).fontSize), swFs: parseFloat(cs(sw).fontSize), h: R(sup).h, c: cs(sup).color },
      card: R(card), taps,
    }
  })
  await p.focus('#customer-email'); await p.waitForTimeout(250)
  const focus = await p.evaluate(() => { const c = getComputedStyle(document.activeElement); return { style: c.outlineStyle, width: parseFloat(c.outlineWidth), color: c.outlineColor } })
  await ctx.close()
  return { ...m, focus }
}

async function contact(lang, w, css) {
  const { p, ctx } = await open(browser, 'contact', lang, w, css, 2400)  // tall enough that every card is on screen (the fixture page does not scroll)
  const m = await p.evaluate(() => {
    const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top + scrollY, b: b.bottom + scrollY, w: b.width, h: b.height } }
    const cs = (e) => getComputedStyle(e)
    const sec = document.querySelector('.editorial-page')
    const cards = [...document.querySelectorAll('.support-card')]
    const div = cards.filter((c) => c.tagName === 'DIV')
    // a tap 14px in from each corner of every card: what does it land on?
    const hits = cards.map((c) => {
      const b = c.getBoundingClientRect(), link = c.querySelector(':scope > a:last-child')
      return [[b.left + 14, b.top + 14], [b.right - 14, b.bottom - 14]].map(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && (e === link || link.contains(e)) })
    })
    const icon = (c) => { const svg = c.querySelector(':scope > svg'), bf = getComputedStyle(c, '::before'); return { svg: svg ? cs(svg).display : 'none', mask: (bf.maskImage || bf.webkitMaskImage || '') + '', w: parseFloat(bf.width), bg: bf.backgroundColor, svgColor: svg ? cs(svg).color : '' } }
    const mail = cards.find((c) => c.querySelector(':scope > a[href^="mailto:"]')), sup = cards.find((c) => c.querySelector(':scope > a[href="/support"]')), wa = cards.find((c) => c.querySelector(':scope > a[href^="https://wa.me/"]'))
    return {
      overflow: document.documentElement.scrollWidth - innerWidth, sec: R(sec),
      cards: cards.map(R), div: div.map(R), hits,
      first: [...document.querySelectorAll('.support-cards > .support-card')].map(R),
      heads: ['.page-eyebrow', 'h1', '.page-lead', '.support-cards'].map((s) => R(sec.querySelector(s))),
      mail: icon(mail), sup: icon(sup), wa: icon(wa),
      fw: [...document.querySelectorAll('.support-card > a:not(.btn)')].map((a) => +cs(a).fontWeight),
      linkH: [...document.querySelectorAll('.support-card > a')].map((a) => R(a).h),
      texts: cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
    }
  })
  // keyboard focus on a card's link outlines the card
  await p.focus('.support-card > a[href^="mailto:"]'); await p.waitForTimeout(250)
  const ring = await p.evaluate(() => { const c = getComputedStyle(document.activeElement.closest('.support-card')); return { style: c.outlineStyle, width: parseFloat(c.outlineWidth) } })
  await ctx.close()
  return { ...m, ring }
}

async function checks() {
  for (const lang of ['ar', 'en']) {
    head(`register form (${lang})`)
    for (const w of [320, 390, 768, 1280]) {
      const off = await account(lang, w, OFF), on = await account(lang, w, SHADOWS)
      const fieldGap = on.gapAfterName
      is(off.gapAfterBday < 4 && Math.abs(on.gapAfterBday - fieldGap) < 1, `${w}px [rc-1]: the birthday hint is followed by the same gap as every field (it touched the Email label)`, `${off.gapAfterBday.toFixed(1)} -> ${on.gapAfterBday.toFixed(1)}, field gap ${fieldGap.toFixed(1)}`)
      is(off.sel.some((h) => Math.abs(h - off.input) > 1) && on.sel.every((h) => Math.abs(h - on.input) < 1), `${w}px [rc-2]: the three birthday dropdowns are as tall as the text boxes (they were taller)`, `${off.sel.map((h) => h.toFixed(1)).join('/')} vs ${off.input.toFixed(1)} -> ${on.sel.map((h) => h.toFixed(1)).join('/')} vs ${on.input.toFixed(1)}`)
      is(on.sel.every((h) => h >= 44) && new Set(on.selRow.map((r) => r[0])).size === 1 && on.selRow.every((r) => r[1] >= on.bdayRow.l - 0.5 && r[2] <= on.bdayRow.r + 0.5), `${w}px [rc-2]: still one row, inside the field, every dropdown at least 44px`, JSON.stringify(on.selRow))
      is(off.focus.style === 'none' && on.focus.style === 'solid' && on.focus.width >= 2, `${w}px [rc-3]: a focused text box gets a 2px ring like the dropdowns (it had none)`, `${off.focus.style} -> ${on.focus.style} ${on.focus.width}px ${on.focus.color}`)
      is(off.swBorder.startsWith('0px') && on.swBorder === '1px solid' && on.swGap >= off.swGap, `${w}px [rc-4]: a hairline separates the form from "sign in / guest / help"`, `${off.swBorder} -> ${on.swBorder}, gap ${off.swGap.toFixed(0)} -> ${on.swGap.toFixed(0)}`)
      is(off.sup.td === 'none' && on.sup.td === 'underline' && Math.abs(on.sup.fs - on.sup.swFs) < 0.5 && on.sup.h >= 44, `${w}px [rc-4]: "Need help signing in?" is underlined, as large as the line above it, 44px tall`, `${off.sup.td}/${off.sup.fs} -> ${on.sup.td}/${on.sup.fs}, h ${on.sup.h}`)
      is(on.overflow <= 0 && on.inputs.join() === off.inputs.join() && Math.abs(on.card.w - off.card.w) < 0.5, `${w}px: no sideways scroll, text boxes and card width unchanged`, `overflow ${on.overflow}, inputs ${on.inputs.join('/')}`)
      const small = on.taps.filter((t) => t.h < 43.5 && t.n)
      is(small.length === 0, `${w}px: every control on the form is at least 44px tall`, small.map((t) => t.n + ' ' + t.h.toFixed(0)).join(', '))
    }
    head(`contact (${lang})`)
    for (const w of [320, 390, 768, 1280]) {
      const off = await contact(lang, w, OFF), on = await contact(lang, w, SHADOWS)
      const [a, b] = on.div, [a0, b0] = off.div
      const offTouch = Math.abs(b0.t - a0.b) < 1 && Math.abs(b0.l - a0.l) < 1
      if (w < 768) {
        is(offTouch && b.t - a.b >= 19.5, `${w}px [rc-5]: "Track order" and "Support centre" have 1.25rem between them (they touched)`, `${(b0.t - a0.b).toFixed(1)} -> ${(b.t - a.b).toFixed(1)}`)
        is(Math.abs(a.w - a0.w) < 0.5 && Math.abs(b.w - b0.w) < 0.5, `${w}px [rc-5]: one column, card widths unchanged`)
      } else {
        const gapX = lang === 'ar' ? a.l - b.r : b.l - a.r
        is(offTouch && Math.abs(a.t - b.t) < 0.5 && Math.abs(a.h - b.h) < 0.5 && gapX >= 19.5, `${w}px [rc-5]: the two cards sit side by side, same top, same height, 1.25rem apart (they were full width and touching)`, `top ${a.t.toFixed(0)}/${b.t.toFixed(0)} h ${a.h.toFixed(0)}/${b.h.toFixed(0)} gap ${gapX.toFixed(1)}`)
        const [f1, f2] = on.first
        is(Math.abs(a.w - f1.w) < 1 && Math.abs(b.w - f2.w) < 1 && Math.abs(Math.min(a.l, b.l) - Math.min(f1.l, f2.l)) < 1 && Math.abs(Math.max(a.r, b.r) - Math.max(f1.r, f2.r)) < 1, `${w}px [rc-5]: they line up with the WhatsApp / Email cards above (same columns)`, `${a.w.toFixed(0)}/${b.w.toFixed(0)} vs ${f1.w.toFixed(0)}/${f2.w.toFixed(0)}`)
        is(lang === 'ar' ? a.r > b.r : a.l < b.l, `${w}px [rc-5]: "Track order" comes first in the reading direction`)
      }
      is(on.heads.every((h, i) => Math.abs(h.t - off.heads[i].t) < 0.5 && Math.abs(h.w - off.heads[i].w) < 0.5) && on.first.every((c, i) => Math.abs(c.t - off.first[i].t) < 0.5 && Math.abs(c.w - off.first[i].w) < 0.5), `${w}px [rc-5]: heading, intro and the first row of cards are exactly where they were`)
      is(off.hits.every((h) => h.join() === 'false,false') && on.hits.every((h) => h.join() === 'true,true'), `${w}px [rc-6]: a tap anywhere on each of the four cards opens its link (only the link text did)`, `off ${JSON.stringify(off.hits)} on ${JSON.stringify(on.hits)}`)
      is(off.ring.style === 'none' && on.ring.style === 'solid' && on.ring.width >= 2, `${w}px [rc-6]: keyboard focus on a card's link outlines the whole card`, `${off.ring.style} -> ${on.ring.style}`)
      is(on.linkH.every((h, i) => Math.abs(h - off.linkH[i]) < 0.5) && on.texts.join('|') === off.texts.join('|'), `${w}px [rc-6]: no link changes size, no text changes`)
      is(off.fw.every((x) => x < 600) && on.fw.every((x) => x >= 600), `${w}px [rc-7]: the WhatsApp number and the e-mail address are semibold`, `${off.fw.join('/')} -> ${on.fw.join('/')}`)
      is(off.mail.svg !== 'none' && on.mail.svg === 'none' && /rect/.test(decodeURIComponent(on.mail.mask)) && Math.abs(on.mail.w - 26) < 0.5 && on.mail.bg === off.mail.svgColor, `${w}px [rc-8]: the Email card shows an envelope (not the arrow), 26px, in the arrow's orange`, `${on.mail.svg} ${on.mail.w} ${on.mail.bg} vs ${off.mail.svgColor}`)
      // [rc-8] draws its own bubble; the ICON SET section after it swaps in the Sporta set's bubble (data-glyph='chat'): either is a bubble
      is(off.sup.svg !== 'none' && on.sup.svg === 'none' && /M13 8H7|data-glyph='chat'/.test(decodeURIComponent(on.sup.mask)) && Math.abs(on.sup.w - 26) < 0.5, `${w}px [rc-8]: the support-centre card shows a speech bubble (not the arrow)`)
      is(on.wa.svg !== 'none' && !on.wa.mask.includes('url'), `${w}px [rc-8]: the WhatsApp card keeps its own icon`)
      is(on.overflow <= 0, `${w}px: no sideways scroll`, String(on.overflow))
    }
  }
}

await checks()
const P = pass, F = fail
head('mutation: without the section the checks must fail')
silent = true; pass = 0; fail = 0
const keep = SHADOWS
// "on" becomes the file without the section: the section's own checks must fail
const mod = await import('./lib/register-page.mjs')
Object.defineProperty(globalThis, '__rcMut', { value: true })
const saved = { account, contact }
const accountM = (lang, w) => saved.account(lang, w, OFF), contactM = (lang, w) => saved.contact(lang, w, OFF)
for (const lang of ['ar', 'en']) for (const w of [390, 1280]) {
  const off = await accountM(lang, w), on = await accountM(lang, w)
  is(Math.abs(on.gapAfterBday - on.gapAfterName) < 1, 'm rc-1'); is(on.sel.every((h) => Math.abs(h - on.input) < 1), 'm rc-2'); is(on.focus.style === 'solid', 'm rc-3'); is(on.swBorder === '1px solid', 'm rc-4'); is(on.sup.td === 'underline', 'm rc-4b')
  const c = await contactM(lang, w)
  is(c.div[1].t - c.div[0].b >= 19.5 || Math.abs(c.div[0].t - c.div[1].t) < 0.5, 'm rc-5'); is(c.hits.every((h) => h.join() === 'true,true'), 'm rc-6'); is(c.ring.style === 'solid', 'm rc-6b'); is(c.fw.every((x) => x >= 600), 'm rc-7'); is(c.mail.svg === 'none', 'm rc-8')
  void off; void keep; void mod
}
const mf = fail, mt = pass + fail
silent = false; pass = P; fail = F
is(mf === mt, `without the REGCONTACT section all ${mt} section checks fail`, `${mf} of ${mt} failed`)

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
