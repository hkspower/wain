// TILES-1111 in public/sporta-shadows.css, proven on the captured LIVE home page (scripts/fixtures/sizes-screen/home-{ar,en}.html,
// the live compiled rules, the real add-on files, the real category photographs from public/cats):
//   [tiles-1] on a phone the four category tiles are one height (the scan found 180 / 193 / 193 / 180px at 360px);
//   [tiles-2] from 768px the Men and Women photographs keep the whole athlete inside the tile (the live `object-center` cut the
//             man's arm / the woman's arm and hip at 768px).
// Each block is cut in turn and the suite must FAIL (mutation), and the whole section is cut for the "before" numbers.
//   node scripts/cat-tiles-crop-test.mjs        (no server, database or dist/: fixtures + files in the repo)
import { chromium } from 'playwright'
import { addonFiles, serve } from './lib/sizes-screen-page.mjs'

let fails = 0
const ok = (c, m, d = '') => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m + (c || !d ? '' : '  — ' + d)) }

const FILES = addonFiles()
const SH = FILES['sporta-shadows.css']
const a = SH.indexOf('/* ==== TILES-1111'), b = SH.indexOf('/* ==== end TILES-1111 */')
ok(a > 0 && b > a, 'sporta-shadows.css has the TILES-1111 section, before the ICON SET section (which stays last)')
ok(SH.indexOf('/* ==== ICON SET') > b, 'the ICON SET section is still after it')
const SECTION = SH.slice(a, b)
const blockRe = /\/\* \[(tiles-\d)\] \*\/\n@media [^{]+\{[\s\S]*?\n\}\n/g
const BLOCKS = [...SECTION.matchAll(blockRe)].map((m) => ({ id: m[1], text: m[0] }))
ok(BLOCKS.length === 2 && BLOCKS[0].id === 'tiles-1' && BLOCKS[1].id === 'tiles-2', 'the section holds exactly the blocks [tiles-1] and [tiles-2]', BLOCKS.map((x) => x.id).join(','))

// The repo's sporta-cat-tiles.css also equalises phone rows ([gs-t1], unreviewed WIP, NOT live: the live scan measured 180 / 193). The
// "live" cat-tiles file is the repo's without it, so the finding can be reproduced and this section proven on its own.
const CT = FILES['sporta-cat-tiles.css']
const gs = /\/\* \[gs-t1\][\s\S]*?\n\.home-category-grid > \.campaign-category \{ align-self: stretch !important; \}\n/.exec(CT)
ok(!!gs, 'the repo cat-tiles file carries [gs-t1] (removed below to stand for the live file)')
const LIVE_CT = gs ? CT.replace(gs[0], '') : CT

const variants = {
  after: SH,
  before: SH.slice(0, a) + SH.slice(b),
  ...Object.fromEntries(BLOCKS.map((x) => [`no-${x.id}`, SH.replace(x.text, '')])),
}

// Where the athlete stands in each photograph, as a share of the width (measured on the files in public/cats/desktop).
const SUBJECT = { ltr: { men: [0.67, 0.91], women: [0.68, 0.95] }, rtl: { men: [0.10, 0.35], women: [0.11, 0.38] } }

const ref = { current: { ...FILES, 'sporta-cat-tiles.css': LIVE_CT } }
const { server, base } = await serve(ref)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const M = {}
const WIDTHS = [320, 360, 390, 767, 768, 820, 900, 1023, 1024, 1180, 1280, 1440]
for (const lang of ['ar', 'en']) for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const pg = await ctx.newPage()
  await pg.goto(`${base}/__fx/home-${lang}`, { waitUntil: 'load' })
  await pg.evaluate(() => { document.querySelectorAll('img').forEach((i) => { i.loading = 'eager' }) })
  for (const [v, css] of Object.entries(variants)) {
    await pg.evaluate((c) => { document.querySelector('style[data-addon="sporta-shadows.css"]').textContent = c }, css)
    await pg.evaluate(() => document.fonts.ready)
    await pg.waitForFunction(() => [...document.querySelectorAll('.home-category-grid img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 8000 }).catch(() => {})
    ;(M[v] ||= {})[`${lang}|${w}`] = await pg.evaluate(() => {
      const tiles = [...document.querySelectorAll('.home-category-grid > .campaign-category')]
      const dir = document.documentElement.dir
      const cover = (t) => {
        const img = t.querySelector('picture img'), bw = img.clientWidth, bh = img.clientHeight, nw = img.naturalWidth, nh = img.naturalHeight
        const pos = getComputedStyle(img).objectPosition.split(' ').map((s) => (s.endsWith('%') ? parseFloat(s) / 100 : s === 'left' ? 0 : s === 'right' ? 1 : 0.5))
        const k = Math.max(bw / nw, bh / nh), drawn = nw * k, off = (bw - drawn) * pos[0]
        return { src: img.currentSrc.split('/').pop(), nw, nh, bw, bh, posX: pos[0], from: -off / drawn, to: (bw - off) / drawn }
      }
      return {
        dir,
        heights: tiles.map((t) => Math.round(t.getBoundingClientRect().height * 10) / 10),
        men: cover(document.querySelector('.tile-men')), women: cover(document.querySelector('.tile-women')),
        sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
  }
  await ctx.close()
}
await browser.close(); server.close()

const equal = (h) => Math.max(...h) - Math.min(...h) < 0.6
const covers = (m, [s0, s1]) => m.from <= s0 - 0.01 && m.to >= s1 + 0.01
const SUB = (lang, who) => SUBJECT[lang === 'ar' ? 'rtl' : 'ltr'][who]
const subjectsIn = (v, lang, w) => covers(M[v][`${lang}|${w}`].men, SUB(lang, 'men')) && covers(M[v][`${lang}|${w}`].women, SUB(lang, 'women'))

// [tiles-1] phones
const PH = [320, 360, 390, 767]
for (const lang of ['ar', 'en']) for (const w of PH) {
  ok(equal(M.after[`${lang}|${w}`].heights), `${lang} ${w}px: the four tiles are one height`, JSON.stringify(M.after[`${lang}|${w}`].heights))
}
const unevenBefore = []
for (const lang of ['ar', 'en']) for (const w of PH) if (!equal(M.before[`${lang}|${w}`].heights)) unevenBefore.push(`${lang}${w}`)
ok(unevenBefore.length > 0, 'without the section the phone tiles ARE uneven somewhere (the finding reproduces on the captured page)', JSON.stringify(PH.map((w) => M.before[`ar|${w}`].heights)))
for (const lang of ['ar', 'en']) for (const w of PH) {
  const aft = M.after[`${lang}|${w}`].heights[0], bef = Math.max(...M.before[`${lang}|${w}`].heights)
  ok(aft <= bef + 0.6, `${lang} ${w}px: the equal height is the tallest tile's, never taller than before (${aft}px vs ${bef}px)`)
}
// from 768 the existing 2 x 2 rule already made the rows equal: the section must not change it
for (const lang of ['ar', 'en']) for (const w of [768, 820, 1024, 1280, 1440]) {
  ok(JSON.stringify(M.after[`${lang}|${w}`].heights) === JSON.stringify(M.before[`${lang}|${w}`].heights), `${lang} ${w}px: heights unchanged from 768px up`)
}
// [tiles-2] tablets and desktop
const TAB = [768, 820, 900, 1023, 1024, 1180, 1280, 1440]
for (const lang of ['ar', 'en']) for (const w of TAB) {
  const m = M.after[`${lang}|${w}`]
  ok(subjectsIn('after', lang, w), `${lang} ${w}px: the whole athlete is inside the Men and Women tiles (window ${(m.men.from * 100).toFixed(0)}-${(m.men.to * 100).toFixed(0)}% of ${m.men.src}, ${(m.women.from * 100).toFixed(0)}-${(m.women.to * 100).toFixed(0)}% of ${m.women.src})`)
}
const cutBefore = []
for (const lang of ['ar', 'en']) for (const w of TAB) if (!subjectsIn('before', lang, w)) cutBefore.push(`${lang}${w}`)
ok(cutBefore.includes('ar768') && cutBefore.includes('en768'), 'without the section the athlete IS cut at 768px in both languages (the finding reproduces)', cutBefore.join(' '))
// phones keep their own crop: untouched
for (const lang of ['ar', 'en']) for (const w of PH) {
  ok(M.after[`${lang}|${w}`].men.posX === M.before[`${lang}|${w}`].men.posX && M.after[`${lang}|${w}`].women.posX === M.before[`${lang}|${w}`].women.posX, `${lang} ${w}px: the phone photographs keep their object-position`)
}
ok(Object.values(M.after).every((m) => m.sideways <= 0), 'no sideways scroll at any width, either language')
// the photographs are the files the scan named (the subject extents above were measured on them)
ok(M.after['ar|768'].men.src === 'art-men-rtl.jpg' || /art-men-rtl/.test(M.after['ar|768'].men.src), 'Arabic uses art-men-rtl at 768px', M.after['ar|768'].men.src)
ok(/art-men\./.test(M.after['en|768'].men.src), 'English uses art-men at 768px', M.after['en|768'].men.src)

// mutation: each block is load-bearing
const mut1 = []
for (const lang of ['ar', 'en']) for (const w of PH) if (!equal(M['no-tiles-1'][`${lang}|${w}`].heights)) mut1.push(`${lang}${w}`)
ok(mut1.length > 0, 'mutation: without [tiles-1] the phone tiles are uneven (the block is load-bearing)', mut1.join(' '))
const mut2 = []
for (const lang of ['ar', 'en']) for (const w of TAB) if (!subjectsIn('no-tiles-2', lang, w)) mut2.push(`${lang}${w}`)
ok(mut2.includes('ar768') && mut2.includes('en768'), 'mutation: without [tiles-2] the athlete is cut at 768px (the block is load-bearing)', mut2.join(' '))
ok(PH.every((w) => ['ar', 'en'].every((l) => equal(M['no-tiles-2'][`${l}|${w}`].heights))), 'mutation: [tiles-2] alone does not equalise the phone tiles (the blocks do not hide each other)')

console.log(fails ? `\n${fails} FAILED` : '\nall passed')
process.exit(fails ? 1 : 0)
