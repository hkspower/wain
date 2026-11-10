// The SCAN-1110 section of public/sporta-shadows.css, on the live markup (captured 2026-11-10 by the probes
// behind live-site-scan.mjs): [scan-1] /account footer under the fold from the first paint, [scan-2] gallery
// dots 44px tall to the finger, [scan-3] contact links 44px tall.
//   npm run test:scan-1110        (ADDON_FILE=<path> runs another file; the section removed must FAIL)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADDON = readFileSync(process.env.ADDON_FILE || join(ROOT, 'public/sporta-shadows.css'), 'utf8')
let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }
const BASE = '*{box-sizing:border-box}body{margin:0;font:16px/1.5 sans-serif}.flex{display:flex}.justify-center{justify-content:center}.grid{display:grid}.place-items-center{place-items:center}.h-6{height:1.5rem}.min-w-6{min-width:1.5rem}.mt-3{margin-top:.75rem}.block{display:block}.h-1\\.5{height:.375rem}.w-5{width:1.25rem}.w-1\\.5{width:.375rem}.gap-0\\.5{gap:.125rem}button{border:0;background:none;padding:0}.mt-16{margin-top:4rem}'
const page = (lang, css, body) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${BASE}${css}</style></head><body><div class="storefront-root"><header style="height:126px"></header><main>${body}</main><footer class="app-footer sporta-footer mt-16" style="height:485px"></footer></div></body></html>`
const SHELL = '<section class="customer-account" aria-labelledby="customer-account-title"><div class="customer-account__card" style="height:120px"><h1 id="customer-account-title">x</h1></div></section>'
const FULL = SHELL.replace('height:120px', 'height:1400px')
const DOTS = '<div class="catalog-gallery"><div class="mt-3 flex justify-center gap-0.5 lg:hidden"><button type="button" aria-label="1" aria-current="true" class="group/dot grid h-6 min-w-6 place-items-center"><span aria-hidden="true" class="block h-1.5 rounded-full transition-all w-5 bg-ink dark:bg-white"></span></button><button type="button" aria-label="2" class="group/dot grid h-6 min-w-6 place-items-center"><span aria-hidden="true" class="block h-1.5 rounded-full transition-all w-1.5"></span></button><button type="button" aria-label="3" class="group/dot grid h-6 min-w-6 place-items-center"><span aria-hidden="true" class="block h-1.5 rounded-full transition-all w-1.5"></span></button></div></div>'
const CARD = '<div class="support-cards"><article class="support-card"><h2>x</h2><p><a href="tel:+96522091914" dir="ltr">+965 2209 1914</a></p><p><a href="mailto:cs@example.com" dir="ltr">cs@example.com</a></p><p><a href="/track">track</a></p></article></div>'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
for (const lang of ['ar', 'en']) for (const [w, h] of [[390, 844], [360, 640], [1280, 800]]) {
  const run = async (css, body, fn) => { const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); await p.setContent(page(lang, css, body)); const r = await p.evaluate(fn); await ctx.close(); return r }
  const foot = () => ({ y: document.querySelector('footer').getBoundingClientRect().top, vh: innerHeight, sec: document.querySelector('.customer-account').getBoundingClientRect().height })
  const off = await run('', SHELL, foot), on = await run(ADDON, SHELL, foot)
  is(off.y < off.vh, `${lang} ${w}x${h}, add-on off: the footer is on the first screen while the page is a shell (the live defect)`, `footer y ${off.y}`)
  is(on.y >= on.vh, `${lang} ${w}x${h}: the footer starts under the fold in the shell state`, `footer y ${on.y} window ${on.vh}`)
  const fo = await run('', FULL, foot), fn2 = await run(ADDON, FULL, foot)
  is(Math.abs(fo.sec - fn2.sec) < 0.5, `${lang} ${w}x${h}: a page already taller than the window is unchanged`, `${fo.sec} -> ${fn2.sec}`)
  if (w < 1024) {
    const hit = () => { const bs = [...document.querySelectorAll('.catalog-gallery button')]; return bs.map((b) => { const q = b.getBoundingClientRect(); const cx = q.left + q.width / 2; const up = document.elementFromPoint(cx, q.top - 9), dn = document.elementFromPoint(cx, q.bottom + 9); const a = getComputedStyle(b, '::after'); return { w: q.width, h: q.height, up: up === b, dn: dn === b, left: document.elementFromPoint(q.left + 1, q.top + 12) === b, right: document.elementFromPoint(q.right - 1, q.top + 12) === b, dot: b.firstElementChild.getBoundingClientRect().height, ah: parseFloat(a.height) } }) }
    const d0 = await run('', DOTS, hit), d1 = await run(ADDON, DOTS, hit)
    is(d0.every((x) => !x.up && !x.dn), `${lang} ${w}: add-on off, a touch 9px above or below a dot misses it`)
    is(d1.every((x) => x.up && x.dn && x.ah >= 44), `${lang} ${w}: every dot answers a touch 9px above and below it (44px tall)`, JSON.stringify(d1.map((x) => [x.up, x.dn, x.ah])))
    is(d1.every((x, i) => x.left && x.right && x.w === d0[i].w && x.h === d0[i].h && x.dot === d0[i].dot), `${lang} ${w}: each dot still owns its own edges, and nothing changed size`)
  }
  const links = () => [...document.querySelectorAll('.support-card a')].map((a) => ({ href: a.getAttribute('href'), h: a.getBoundingClientRect().height, r: a.getBoundingClientRect().right, l: a.getBoundingClientRect().left, vw: innerWidth }))
  const l0 = await run('', CARD, links), l1 = await run(ADDON, CARD, links)
  is(l0.slice(0, 2).every((x) => x.h < 40) && l1.slice(0, 2).every((x) => x.h >= 44 && x.l >= 0 && x.r <= x.vw), `${lang} ${w}: the phone and e-mail links are 44px tall (they were under 40) and stay inside the page`, l1.map((x) => x.h).join())
  is(Math.abs(l1[2].h - l0[2].h) < 0.5, `${lang} ${w}: an ordinary link in the card is unchanged`)
}
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
