// AI PANEL 1119 of public/sporta-ui-colours.css (owner, 2026-11-19: "fix sporta ai").
//
//   npm run test:ai-panel      (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// The Sporta AI panel is drawn inside the header, where MONO-1112 paints all text white: the greeting, the question chips, the microphone,
// the typed text and every answer were white on the panel's WHITE body. On the real compiled storefront (the live build's own panel), ar + en,
// 390 and 1280 px, with the panel open:
//   [ai-1] every visible text of the panel (the greeting bubble, the four chips, the typed text, the user's own bubble, the answer / error line,
//          the strip's title and line) is at least 4.5:1 against the ground it sits on; the strip is white on charcoal, the body ink on white
//   [ai-2] the close button and the microphone are at least 44 x 44 px, still named (aria-label untouched), drawn as the shop's line icons
//          (a mask, 1.25rem) with their glyph text hidden; they work (close closes the panel)
// MUTATION: each block is cut in turn and the matching check must fail.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const CSS_F = 'sporta-ui-colours.css'
const CSS = readFileSync(join(PUB, CSS_F), 'utf8')
let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) { pass++; out.push('ok   ' + msg) } else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => out.push(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

const open = async (srv, { w, lang }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' })
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(`${srv.base}/?lang=${lang}`, { waitUntil: 'load' })
  await p.waitForSelector('.navbar-ai', { state: 'attached', timeout: 15000 }).catch(() => {})
  await p.waitForTimeout(1200)
  // the launcher is not shown in the top bar any more (TOPBAR ACCOUNT 1120, owner: "remove sporta ai icons from topbar"): the button is still
  // in the page, so the panel's own look is still proven by opening it the way a person would if it were shown
  await p.evaluate(() => document.querySelector('.navbar-ai').click())
  await p.waitForSelector('.app-header [role="dialog"].fixed.bottom-24', { timeout: 8000 }).catch(() => {})
  await p.waitForTimeout(600)
  return { ctx, p, errs }
}
const MEASURE = () => {
  const d = document.querySelector('.app-header [role="dialog"].fixed.bottom-24')
  if (!d) return null
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const lum = (a) => 0.2126 * lin(a[0]) + 0.7152 * lin(a[1]) + 0.0722 * lin(a[2])
  const rgb = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 4).map(Number)
  const bgOf = (e) => { for (let n = e; n; n = n.parentElement) { const m = rgb(getComputedStyle(n).backgroundColor); if (m.length === 3 || (m.length === 4 && m[3] > 0.99)) return m.slice(0, 3) } return [255, 255, 255] }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const texts = []
  for (const e of d.querySelectorAll('*')) {
    if (e.closest('svg') || e.disabled) continue
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())
    const r = e.getBoundingClientRect()
    if (!own || r.width < 1 || r.height < 1 || getComputedStyle(e).fontSize === '0px') continue
    const cs = getComputedStyle(e)
    texts.push({ text: e.textContent.trim().slice(0, 24), color: cs.color, ratio: ratio(rgb(cs.color), bgOf(e)), strip: !!e.closest('header') })
  }
  const input = d.querySelector('input'); const ic = input ? getComputedStyle(input) : null
  const btn = (sel) => { const b = d.querySelector(sel); if (!b) return null; const r = b.getBoundingClientRect(), cs = getComputedStyle(b), bf = getComputedStyle(b, '::before'); return { w: r.width, h: r.height, label: b.getAttribute('aria-label'), fs: cs.fontSize, mask: (bf.maskImage || bf.webkitMaskImage || ''), bw: parseFloat(bf.width) } }
  const rect = d.getBoundingClientRect()
  return { texts, inputColor: ic ? ic.color : null, inputRatio: ic ? ratio(rgb(ic.color), bgOf(input)) : null, close: btn(':scope > header > button'), mic: btn(':scope > form > button:not(.btn)'), inView: rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight + 1, over: document.documentElement.scrollWidth - innerWidth }
}
const run = async (files, o, fn) => {
  const srv = await serveLive({ css: files.css ? { [CSS_F]: files.css } : {} })
  try { const t = await open(srv, o); try { return await fn(t) } finally { await t.ctx.close() } } finally { await srv.close() }
}
const CHECK = {
  colours: (m) => m && m.texts.length >= 6 && m.texts.every((x) => x.ratio >= 4.5) && m.inputRatio >= 4.5,
  targets: (m) => m && m.close && m.mic && m.close.w >= 43.5 && m.close.h >= 43.5 && m.mic.w >= 43.5 && m.mic.h >= 43.5,
  icons: (m) => m && m.close && m.mic && /svg\+xml/.test(m.close.mask) && /svg\+xml/.test(m.mic.mask) && m.close.fs === '0px' && m.mic.fs === '0px' && Math.abs(m.close.bw - 20) <= 3 && !!m.close.label && !!m.mic.label,
}
const full = async (t) => {
  // type into the input and send a question: the typed text, the user's own bubble and the answer (the capture has no assistant route: the app says so) are all read
  await t.p.fill('.app-header [role="dialog"].fixed.bottom-24 input', 'Where is my order?')
  const typed = await t.p.evaluate(() => getComputedStyle(document.querySelector('.app-header [role="dialog"].fixed.bottom-24 input')).color)
  await t.p.click('.app-header [role="dialog"].fixed.bottom-24 form button.btn')
  await t.p.waitForTimeout(1500)
  const after = await t.p.evaluate(MEASURE)
  return { typed, after }
}

head('the real file, on the real panel')
for (const [w, lang] of [[1280, 'en'], [390, 'en'], [390, 'ar'], [1280, 'ar']]) {
  const tag = `${lang} ${w}px`
  await run({}, { w, lang }, async (t) => {
    const m = await t.p.evaluate(MEASURE)
    is(CHECK.colours(m), `${tag}: every text of the panel is 4.5:1 or better on its ground (greeting, chips, input, title)`, m && JSON.stringify(m.texts.filter((x) => x.ratio < 4.5)))
    is(CHECK.targets(m), `${tag}: the close button and the microphone are 44 x 44 px or more`, m && JSON.stringify([m.close && [m.close.w, m.close.h], m.mic && [m.mic.w, m.mic.h]]))
    is(CHECK.icons(m), `${tag}: both are the shop's line icons (a mask), their glyph text hidden, aria-label kept`, m && JSON.stringify([m.close, m.mic]))
    is(m && m.inView && m.over <= 0, `${tag}: the panel is on the screen, no sideways scroll`)
    const f = await full(t)
    is(/23, 26, 30/.test(f.typed), `${tag}: the words typed in the input are ink (they were white on white)`, f.typed)
    is(f.after && f.after.texts.length >= 5 && f.after.texts.every((x) => x.ratio >= 4.5) && f.after.texts.some((x) => /^Where is my order/.test(x.text)), `${tag}: after a question the user's bubble and the answer line are 4.5:1 or better too`, JSON.stringify(f.after.texts.filter((x) => x.ratio < 4.5)))
    await t.p.click('.app-header [role="dialog"].fixed.bottom-24 > header > button'); await t.p.waitForTimeout(500)
    is(!(await t.p.evaluate(() => !!document.querySelector('.app-header [role="dialog"].fixed.bottom-24'))), `${tag}: the close button closes the panel`)
    is(t.errs.length === 0, `${tag}: no page error`, t.errs.join(' | '))
  })
}

head('mutants: with one block cut, the matching check fails')
const block = (css, n) => {
  const a = css.indexOf(`/* [ai-${n}] */`)
  const next = [css.indexOf(`/* [ai-${n + 1}] */`, a), css.indexOf('/* ==== end AI PANEL 1119 */', a)].filter((x) => x > 0)
  return a < 0 ? css : css.slice(0, a) + css.slice(Math.min(...next))
}
for (const [label, css, check] of [['ai-1 the colours', block(CSS, 1), CHECK.colours], ['ai-2 the 44px icon buttons', block(CSS, 2), (m) => CHECK.targets(m) && CHECK.icons(m)]]) {
  if (css === CSS) { is(false, `mutant "${label}": the cut text was found`); continue }
  const good = check(await run({}, { w: 1280, lang: 'en' }, (t) => t.p.evaluate(MEASURE)))
  const bad = check(await run({ css }, { w: 1280, lang: 'en' }, (t) => t.p.evaluate(MEASURE)))
  is(good === true, `mutant "${label}": the check passes on the real file`)
  is(bad === false, `mutant "${label}": and goes red with it cut`)
}

await browser.close()
console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
