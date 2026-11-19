// HERO FEEL 1119 (public/sporta-home-trim.css) + HERO FEEL-1119 (public/sporta-features.js), owner 2026-11-19: "improve slider change feel".
//
//   npm run test:hero-feel      (rig-free; needs the capture of the live storefront, SPORTA_LIVE_CAPTURE=<dir>; without it: SKIP, exit 0)
//
// On the REAL compiled home page (7 slides, the live build's own slider), a frame-by-frame trace of what a visitor sees:
//   1  the move: 800 ms with an in-out curve (slow start: at 100 ms the track has gone a few percent of the way, not a third; monotonic;
//      settles at exactly one slide with no overshoot); the build's own ease-out is the "before"
//   2  the copy of a slide: hidden while it is not current, rises into place after the photo has arrived, the leaving slide lets go of
//      its copy; the first slide at page load is already fully drawn (nothing hidden or delayed at first paint)
//   3  the photo of the arriving slide settles from 1.06x to 1x; the dots change over 500 ms
//   4  a jump of two or more slides (a far dot, the last slide to the first) is a dissolve: no frame shows a slide in between; one slide
//      is still a slide
//   5  a finger (a phone, ar and en): the track follows it one to one, with resistance past the first and last slide, eases back from a
//      short or mostly vertical drag, carries on to the next slide from where the finger left it, and ends on the build's own transform
//   6  prefers-reduced-motion: no transition, no dissolve, no finger-follow, no hidden copy
// MUTATION: each [hf-N] block, the dissolve and the resistance are cut in turn and the matching check must fail.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PUB, serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'

if (!liveDir()) { console.log('SKIP: no capture of the live storefront on this machine (set SPORTA_LIVE_CAPTURE=<dir>); nothing was measured'); process.exit(0) }
const CHROME = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium-1243/chrome-linux64/chrome') ? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' : '/opt/pw-browsers/chromium')
const JS_F = 'sporta-features.js', CSS_F = 'sporta-home-trim.css'
const JS = readFileSync(join(PUB, JS_F), 'utf8'), CSS = readFileSync(join(PUB, CSS_F), 'utf8')
let pass = 0, fail = 0
const out = []
const is = (ok, msg, detail = '') => { if (ok) { pass++; out.push('ok   ' + msg) } else { fail++; out.push('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => out.push(`\n=== ${t} ${'='.repeat(Math.max(0, 70 - t.length))}`)
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

const open = async (srv, { w = 1280, lang = 'en', touch = false, calm = false }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: touch, hasTouch: touch, serviceWorkers: 'block', reducedMotion: calm ? 'reduce' : 'no-preference' })
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(`${srv.base}/?lang=${lang}`, { waitUntil: 'load' })
  await p.waitForSelector('section[aria-roledescription="carousel"] .campaign-photo-hero', { timeout: 15000 }).catch(() => {})
  await p.waitForTimeout(1800)
  return { ctx, p, errs }
}
const run = async (files, o, fn) => {
  const srv = await serveLive({ js: files.js ? { [JS_F]: files.js } : {}, css: files.css ? { [CSS_F]: files.css } : {} })
  try { const t = await open(srv, o); try { return await fn(t) } finally { await t.ctx.close() } } finally { await srv.close() }
}
const dotSel = (n) => `section[aria-roledescription="carousel"] button[class*="group/dot"]:nth-of-type(${n})`

// click a dot and sample every frame for `ms`: the track's progress, every slide's position, the copy and photo of slide `watch`, the track's opacity
const trace = (p, n, ms, watch) => p.evaluate(([sel, ms, watch]) => new Promise((res) => {
  const sec = document.querySelector('section[aria-roledescription="carousel"]'), track = sec.querySelector(':scope > div[aria-live]'), slides = [...track.children]
  const vw = innerWidth, first0 = slides[0].getBoundingClientRect().left, rows = [], from = slides.findIndex((s) => s.getAttribute('aria-hidden') === 'false')
  const t0 = performance.now(); document.querySelector(sel).click()
  const f = () => {
    const t = performance.now() - t0
    const pos = slides.map((s) => s.getBoundingClientRect().left)
    const w = slides[watch]
    rows.push({ t, prog: Math.abs(pos[0] - first0) / vw, onScreen: pos.map((l, i) => (l < vw - 1 && l + vw > 1 ? i : -1)).filter((i) => i >= 0), op: parseFloat(getComputedStyle(track).opacity),
      copy: parseFloat(getComputedStyle(w.querySelector('.campaign-hero-title')).opacity), copy1: parseFloat(getComputedStyle(slides[0].querySelector('.campaign-hero-title')).opacity),
      img: (() => { const i = w.querySelector('img'); if (!i) return 1; const m = /matrix\(([\d.]+)/.exec(getComputedStyle(i).transform); return m ? parseFloat(m[1]) : 1 })() })
    if (t < ms) requestAnimationFrame(f); else res({ rows, from, inline: track.style.transition, tf: track.style.transform, active: slides.findIndex((s) => s.getAttribute('aria-hidden') === 'false') })
  }
  requestAnimationFrame(f)
}), [dotSel(n), ms, watch])
const at = (rows, ms) => rows.reduce((b, r) => (Math.abs(r.t - ms) < Math.abs(b.t - ms) ? r : b), rows[0])

// a touch gesture on the section: events dispatched as the browser does (the build listens to touchstart / touchend on the section)
const touch = (p, kind, x, y) => p.evaluate(([kind, x, y]) => {
  const sec = document.querySelector('section[aria-roledescription="carousel"]')
  const t = new Touch({ identifier: 7, target: sec, clientX: x, clientY: y, pageX: x, pageY: y })
  const ev = new TouchEvent(kind, { touches: kind === 'touchend' || kind === 'touchcancel' ? [] : [t], targetTouches: kind === 'touchend' || kind === 'touchcancel' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true })
  sec.dispatchEvent(ev); return ev.defaultPrevented
}, [kind, x, y])
const state = (p) => p.evaluate(() => {
  const sec = document.querySelector('section[aria-roledescription="carousel"]'), track = sec.querySelector(':scope > div[aria-live]'), slides = [...track.children]
  return { left: slides[0].getBoundingClientRect().left, tf: track.style.transform, trans: track.style.transition, active: slides.findIndex((s) => s.getAttribute('aria-hidden') === 'false'), vw: innerWidth }
})

// -------------------------------------------------------------------------------------------------------------------- the real files
const timing = (p) => p.evaluate(() => { const tr = document.querySelector('section[aria-roledescription="carousel"] > div[aria-live]'), cs = getComputedStyle(tr), dot = document.querySelector('section[aria-roledescription="carousel"] button[class*="group/dot"] > span'); return { dur: cs.transitionDuration, fn: cs.transitionTimingFunction, prop: cs.transitionProperty, dot: getComputedStyle(dot).transitionDuration } })
const copyAtLoad = (p) => p.evaluate(() => { const s = document.querySelector('.campaign-photo-hero'); return [...s.querySelectorAll('.campaign-hero-copy > *')].map((e) => [getComputedStyle(e).opacity, getComputedStyle(e).transform]) })

head('the move, the copy, the photo, the dots (1280px, en and ar)')
for (const lang of ['en', 'ar']) {
  await run({}, { lang }, async (t) => {
    const tm = await timing(t.p)
    is(tm.dur === '0.8s' && /cubic-bezier\(0\.65, 0\.02, 0\.2, 1\)/.test(tm.fn), `${lang}: the track moves 800 ms with the in-out curve`, JSON.stringify(tm))
    is(/0\.5s/.test(tm.dot), `${lang}: the dots change over 500 ms`, tm.dot)
    const c0 = await copyAtLoad(t.p)
    is(c0.length >= 3 && c0.every(([o, tf]) => o === '1' && /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/.test(tf)), `${lang}: at page load the first slide's copy is fully drawn (nothing hidden or delayed)`, JSON.stringify(c0))
    const r = await trace(t.p, 2, 2000, 1)
    const row = (ms) => at(r.rows, ms)
    is(row(100).prog >= 0.005 && row(100).prog <= 0.2, `${lang}: slow start: at 100 ms the track has gone ${(row(100).prog * 100).toFixed(1)}% of the way (an ease-out would be about a third)`, JSON.stringify(row(100)))
    let mono = true, over = 0; for (let i = 1; i < r.rows.length; i++) { if (r.rows[i].prog + 0.002 < r.rows[i - 1].prog) mono = false; over = Math.max(over, r.rows[i].prog) }
    is(mono && over <= 1.003, `${lang}: the progress never goes back and does not overshoot`, `max ${over}`)
    const done = r.rows.find((x) => x.prog >= 0.99)
    is(done && done.t >= 600 && done.t <= 1000, `${lang}: it settles on the slide after about 800 ms`, done ? done.t.toFixed(0) + ' ms' : 'never')
    is(row(120).copy < 0.2 && row(700).copy > 0.05 && row(700).copy < 1 && row(1900).copy === 1, `${lang}: the arriving slide's copy waits for the photo, then rises into place (${row(120).copy.toFixed(2)} -> ${row(700).copy.toFixed(2)} -> ${row(1900).copy})`)
    is(row(700).copy1 <= 0.05, `${lang}: the leaving slide lets go of its copy`, String(row(700).copy1))
    is(row(100).img > 1.03 && row(1950).img <= 1.001, `${lang}: the arriving photo settles from 1.06x to 1x (${row(100).img.toFixed(3)} -> ${row(1950).img.toFixed(3)})`)
    is(r.active === 1 && /^translateX\((-?100)%\)$/.test(r.tf), `${lang}: it ends on slide 2 with the build's own transform`, r.tf)
    is(t.errs.length === 0, `${lang}: no page error`, t.errs.join(' | '))
  })
}

head('a jump of several slides is a dissolve; one slide is still a slide')
await run({}, { lang: 'en' }, async (t) => {
  const r = await trace(t.p, 5, 1000, 4)
  is(r.rows.every((x) => x.onScreen.every((i) => i === r.from || i === r.active)), 'a far dot: no frame shows a slide in between', JSON.stringify(r.rows.map((x) => x.onScreen).filter((o) => o.some((i) => i !== r.from && i !== r.active)).slice(0, 3)))
  is(at(r.rows, 40).op < 0.4 && at(r.rows, 900).op === 1, 'it fades in from the dark ground (the track\'s opacity goes up to 1)', `${at(r.rows, 40).op.toFixed(2)} -> ${at(r.rows, 900).op}`)
  is(r.inline === '' && r.active === 4 && r.tf === 'translateX(-400%)', 'the inline transition is cleared afterwards and the build\'s own transform stands', JSON.stringify([r.inline, r.tf, r.active]))
  const back = await trace(t.p, 1, 1000, 0)
  is(back.rows.every((x) => x.onScreen.every((i) => i === back.from || i === back.active)) && back.active === 0, 'a way back to the first slide is a dissolve too')
  const one = await trace(t.p, 2, 1000, 1)
  is(one.rows.some((x) => x.prog > 0.1 && x.prog < 0.9) && at(one.rows, 40).op === 1, 'one slide is still a slide (frames in between, no fade)')
})

head('a finger on a phone (en and ar)')
for (const lang of ['en', 'ar']) {
  await run({}, { w: 390, lang, touch: true }, async (t) => {
    const sgn = lang === 'ar' ? -1 : 1            // toward the NEXT slide: left in English, right in Arabic
    const base = await state(t.p)
    await touch(t.p, 'touchstart', 200, 300)
    const prevented = await touch(t.p, 'touchmove', 200 - sgn * 120, 302)
    const next = await state(t.p)
    is(Math.abs(next.left - (-sgn * 120)) <= 2 && /calc\(/.test(next.tf) && next.trans === 'none', `${lang}: toward the next slide the track follows the finger one to one (${next.left.toFixed(1)}px for 120px)`, JSON.stringify(next))
    is(prevented, `${lang}: a sideways drag does not scroll the page`)
    await touch(t.p, 'touchmove', 200 + sgn * 120, 302)
    const prev = await state(t.p)
    is(Math.abs(Math.abs(prev.left) - 120 * 0.35) <= 2, `${lang}: pulled past the first slide it resists (${prev.left.toFixed(1)}px for 120px)`, JSON.stringify(prev))
    await touch(t.p, 'touchmove', 200 + sgn * 20, 302); await touch(t.p, 'touchend', 200 + sgn * 20, 302); await t.p.waitForTimeout(900)
    const s1 = await state(t.p)
    is(s1.active === 0 && Math.abs(s1.left) <= 0.5 && s1.tf === 'translateX(0%)' && s1.trans === '', `${lang}: a pull the other way, let go short, eases back and leaves the build's transform`, JSON.stringify(s1))
    await touch(t.p, 'touchstart', 200, 300); await touch(t.p, 'touchmove', 200 - sgn * 30, 301); await touch(t.p, 'touchend', 200 - sgn * 30, 301); await t.p.waitForTimeout(900)
    const s2 = await state(t.p)
    is(s2.active === 0 && Math.abs(s2.left) <= 0.5 && s2.tf === 'translateX(0%)', `${lang}: a short drag (30px) eases back`, JSON.stringify(s2))
    await touch(t.p, 'touchstart', 200, 300); const vert = await touch(t.p, 'touchmove', 205, 360); const sv = await state(t.p); await touch(t.p, 'touchend', 205, 360)
    is(!/calc\(/.test(sv.tf) && !vert, `${lang}: a mostly vertical drag is left to the page`, JSON.stringify(sv))
    await touch(t.p, 'touchstart', 200, 300); await touch(t.p, 'touchmove', 200 - sgn * 90, 301); await touch(t.p, 'touchcancel', 200 - sgn * 90, 301); await t.p.waitForTimeout(900)
    const s3 = await state(t.p)
    is(s3.active === 0 && Math.abs(s3.left) <= 0.5, `${lang}: a cancelled touch eases back`, JSON.stringify(s3))
    await touch(t.p, 'touchstart', 200, 300); await touch(t.p, 'touchmove', 200 - sgn * 70, 301); await touch(t.p, 'touchmove', 200 - sgn * 120, 301); await touch(t.p, 'touchend', 200 - sgn * 120, 301)
    await t.p.waitForTimeout(1300)
    const s4 = await state(t.p)
    is(s4.active === 1 && Math.abs(s4.left + base.vw * sgn) <= 1 && /^translateX\(-?100%\)$/.test(s4.tf) && s4.trans === '', `${lang}: a 120px drag carries on to slide 2 and ends on the build's own transform`, JSON.stringify(s4))
    is(t.errs.length === 0, `${lang}: no page error`, t.errs.join(' | '))
  })
}

head('reduced motion')
await run({}, { calm: true }, async (t) => {
  const tm = await timing(t.p)
  is(parseFloat(tm.dur) <= 0.001, 'no transition on the track (the shop\'s reduced-motion rule makes every transition instant)', JSON.stringify(tm))
  const c = await copyAtLoad(t.p)
  is(c.every(([o]) => o === '1'), 'the copy is drawn')
  const copy2 = await t.p.evaluate(() => { const s = document.querySelectorAll('.campaign-photo-hero')[1]; return getComputedStyle(s.querySelector('.campaign-hero-title')).opacity })
  is(copy2 === '1', 'the copy of a slide that is not current is not hidden either', copy2)
  const r = await trace(t.p, 5, 600, 4)
  is(r.active === 4 && r.inline === '' && r.rows.every((x) => x.op === 1), 'a far dot just changes the slide: no dissolve, no fade')
})
await run({}, { w: 390, touch: true, calm: true }, async (t) => {
  await touch(t.p, 'touchstart', 200, 300); await touch(t.p, 'touchmove', 80, 302)
  const s = await state(t.p); await touch(t.p, 'touchend', 80, 302)
  is(!/calc\(/.test(s.tf), 'no finger-follow', s.tf)
})

head('mutants: with one part cut, the matching check fails')
const cut = (text, from, to, label) => { const c = text.replace(from, to); if (c === text) throw new Error('mutation did not apply: ' + label); return c }
const block = (css, n) => {
  const a = css.indexOf(`/* [hf-${n}] */`)
  const next = [css.indexOf(`/* [hf-${n + 1}] */`, a), css.indexOf('}\n/* ==== end HERO FEEL 1119 */', a)].filter((x) => x > 0)
  return css.slice(0, a) + css.slice(Math.min(...next))
}
const probe = async (files) => run(files, { lang: 'en' }, async (t) => {
  const tm = await timing(t.p)
  const r = await trace(t.p, 2, 2000, 1), row = (ms) => at(r.rows, ms)
  const far = await trace(t.p, 7, 1000, 6)
  return { curve: tm.dur === '0.8s' && row(100).prog >= 0.005 && row(100).prog <= 0.2, copy: row(120).copy < 0.2 && row(1900).copy === 1, photo: row(100).img > 1.03, dots: /0\.5s/.test(tm.dot), dissolve: far.rows.every((x) => x.onScreen.every((i) => i === far.from || i === far.active)) }
})
const fingerProbe = async (files) => run(files, { w: 390, lang: 'en', touch: true }, async (t) => {
  await touch(t.p, 'touchstart', 200, 300); await touch(t.p, 'touchmove', 320, 302)
  const s = await state(t.p); await touch(t.p, 'touchend', 320, 302)
  return Math.abs(s.left - 120 * 0.35) <= 2
})
const MUT = [
  ['hf-1 the in-out move', { css: block(CSS, 1) }, (r) => r.curve],
  ['hf-2 the copy waits for the photo', { css: block(CSS, 2) }, (r) => r.copy],
  ['hf-3 the photo settles', { css: block(CSS, 3) }, (r) => r.photo],
  ['hf-4 the dots', { css: block(CSS, 4) }, (r) => r.dots],
  ['the dissolve of a jump', { js: cut(JS, 'if (Math.abs(now - was) / 100 < 1.5) return', 'return', 'dissolve') }, (r) => r.dissolve],
]
const real = await probe({})
for (const [label, files, check] of MUT) {
  const bad = await probe(files)
  is(check(real) === true, `mutant "${label}": the check passes on the real files`)
  is(check(bad) === false, `mutant "${label}": and goes red with it cut`)
}
{
  const good = await fingerProbe({}), bad = await fingerProbe({ js: cut(JS, 'var RESIST = 0.35', 'var RESIST = 1', 'resist') })
  is(good === true, 'mutant "the resistance past the first slide": the check passes on the real file')
  is(bad === false, 'mutant "the resistance past the first slide": and goes red with it cut')
}

await browser.close()
console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
