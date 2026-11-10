// The ACCOUNT section of public/sporta-shadows.css ([acc-1] Show button, [acc-2] guest-order link,
// [acc-3] password boxes left-to-right, [acc-4] room for the Show button), proven on the LIVE /account markup under the LIVE rules.
//
//   npm run test:account-form      (no sandbox needed)
//
// scripts/fixtures/account holds the register form (signed out) and the profile (signed in with the
// owner-approved test account), Arabic and English, and live.css: every rule of the live stylesheets that can
// apply to that section, captured from the site with scripts/live-capture.mjs. The capture already contains the
// add-on files as they were live THEN; this suite removes sporta-shadows.css from it and puts back the
// repo's file, either up to the ACCOUNT section ("off": everything else that file does to this page stays) or
// whole ("on"), so each check compares the page with and without that one section.
//
// ADDON_FILE=<path> measures another file as "on" (the mutation check passes one without the ACCOUNT section
// and must FAIL).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FX = join(ROOT, 'scripts/fixtures/account')
const read = (f) => readFileSync(join(FX, f), 'utf8')
const ADDON = readFileSync(process.env.ADDON_FILE || join(ROOT, 'public/sporta-shadows.css'), 'utf8')
// the file up to its ACCOUNT section (the last one)
const BASE = readFileSync(join(ROOT, 'public/sporta-shadows.css'), 'utf8').split('/* ==== ACCOUNT:')[0]
// live.css is "/* ---- <sheet> ---- */" blocks in load order: drop the block of the file under test
const LIVE = read('live.css').split(/(?=\/\* ---- )/).filter((b) => !/^\/\* ---- \/sporta-shadows\.css/.test(b)).join('')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

const doc = (state, lang, css) => {
  const meta = JSON.parse(read(`account-${state}-${lang}.json`))
  return `<!doctype html><html ${meta.html}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${LIVE}</style><style>${css}</style></head><body ${meta.body}>`
    + `${meta.chain.join('')}<div style="height:${Math.round(meta.header)}px"></div>${read(`account-${state}-${lang}.html`)}${meta.chain.map(() => '</div>').join('').replace(/<\/div>$/, '</main>')}</body></html>`
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
async function measure(state, lang, width, css) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const p = await ctx.newPage()
  await p.setContent(doc(state, lang, css), { waitUntil: 'load' })
  const m = await p.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top + scrollY, bottom: b.bottom + scrollY, width: b.width, height: b.height } }
    const pw = [...document.querySelectorAll('input[type=password]')]
    const show = q('.customer-account__password button'), box = q('.customer-account__password input')
    const link = q('.account-dashboard__section-head a')
    let hit = null
    if (link) { link.scrollIntoView({ block: 'center' }); const b = link.getBoundingClientRect(); hit = [-10, 0, 10].map((dy) => { const y = dy < 0 ? b.top + dy : dy > 0 ? b.bottom + dy : b.top + b.height / 2; const e = document.elementFromPoint(b.left + b.width / 2, y); return !!e && (e === link || link.contains(e)) }) }
    const cs = (e) => getComputedStyle(e)
    return {
      overflow: document.documentElement.scrollWidth - innerWidth, dirPage: document.documentElement.dir,
      show: r(show), box: r(box), padL: box ? parseFloat(cs(box).paddingLeft) : 0, padR: box ? parseFloat(cs(box).paddingRight) : 0,
      pw: pw.map((e) => ({ id: e.id, dir: cs(e).direction, align: cs(e).textAlign, h: e.getBoundingClientRect().height })),
      link: r(link), head: r(q('.account-dashboard__section-head')), hit,
      fields: [...document.querySelectorAll('.customer-account__field input')].map((e) => Math.round(e.getBoundingClientRect().height)),
      card: r(q('.customer-account__card')),
    }
  })
  // the box becomes type=text while the password is shown: the rule must still hold
  const shown = await p.evaluate(() => { const e = document.querySelector('.customer-account__password input, #customer-current-password'); if (!e) return null; e.type = 'text'; return getComputedStyle(e).direction })
  await ctx.close()
  return { ...m, shown }
}

for (const lang of ['ar', 'en']) {
  head(`register form (${lang})`)
  for (const w of [320, 390, 1280]) {
    const off = await measure('out', lang, w, BASE), on = await measure('out', lang, w, ADDON)
    is(off.show.height < 44 && on.show.height >= 44, `${w}px [acc-1]: the Show button is 44px tall (it was under)`, `${off.show.height.toFixed(1)} -> ${on.show.height.toFixed(1)}`)
    is(on.show.top >= on.box.top && on.show.bottom <= on.box.bottom && Math.abs(on.box.height - off.box.height) < 0.5 && Math.abs(on.card.height - off.card.height) < 0.5, `${w}px [acc-1]: it stays inside the password box, and neither the box nor the card changes size`, `box ${off.box.height} -> ${on.box.height}, card ${Math.round(off.card.height)} -> ${Math.round(on.card.height)}`)
    is(on.pw.length === 1 && on.pw[0].dir === 'ltr' && on.shown === 'ltr', `${w}px [acc-3]: the password box is left-to-right, hidden and shown`, `${on.pw.map((x) => x.dir).join()} shown=${on.shown}`)
    const onButtonSide = on.dirPage === 'rtl' ? on.padL : on.padR
    const clear = on.dirPage === 'rtl' ? on.show.right - on.box.left : on.box.right - on.show.left
    const offButtonSide = off.dirPage === 'rtl' ? off.padL : off.padR
    is(offButtonSide < clear && onButtonSide >= clear, `${w}px [acc-4]: the box keeps room clear for the Show button on the button's side (before, text ran under it)`, `padding on the button side ${offButtonSide} -> ${onButtonSide}; the button reaches ${clear.toFixed(1)}px into the box`)
    if (lang === 'ar') is(off.pw[0].dir === 'rtl' && on.pw[0].align === 'right', `${w}px [acc-3]: it was right-to-left before, and the text still starts on the right of the Arabic page`, `${off.pw[0].dir} -> ${on.pw[0].dir}, text-align ${on.pw[0].align}`)
    is(on.overflow <= 0 && on.fields.join() === off.fields.join(), `${w}px: no sideways scroll, every field the same height as before`, `overflow ${on.overflow}`)
  }
  head(`profile, signed in (${lang})`)
  for (const w of [390, 1280]) {
    const off = await measure('in', lang, w, BASE), on = await measure('in', lang, w, ADDON)
    is(off.hit.join() === 'false,true,false' && on.hit.join() === 'true,true,true', `${w}px [acc-2]: "Track a guest order" answers a touch 10px above and below its text (44px hit area)`, `off ${off.hit.join()} on ${on.hit.join()}`)
    is(Math.abs(on.head.height - off.head.height) < 0.5 && Math.abs(on.link.height - off.link.height) < 0.5, `${w}px [acc-2]: the heading row and the link text keep their size`, `row ${off.head.height.toFixed(1)} -> ${on.head.height.toFixed(1)}`)
    is(on.pw.length === 3 && on.pw.every((x) => x.dir === 'ltr') && on.shown === 'ltr', `${w}px [acc-3]: the three password boxes are left-to-right`, on.pw.map((x) => x.id + ':' + x.dir).join(' '))
    is(on.overflow <= 0 && Math.abs(on.card.height - off.card.height) < 0.5, `${w}px: no sideways scroll, the card is the same height`, `overflow ${on.overflow}, card ${Math.round(off.card.height)} -> ${Math.round(on.card.height)}`)
  }
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
