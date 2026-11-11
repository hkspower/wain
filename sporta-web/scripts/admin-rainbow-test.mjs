// The RAINBOW section of addons-src/sporta-admin-knet.css: no admin screen paints amber, green, sky, indigo or violet.
//
//   npm run test:admin-rainbow        (no sandbox; ADDON_FILE=<source file> measures another file: the one without the section must FAIL)
//
// Every /backends screen the repo has a capture of (scripts/fixtures/sizes-admin and admin-css-full: 15 screens, the live markup and the
// live rules), light theme, 1280px, with the add-on applied. Every text, background and border colour of every visible element is read
// from getComputedStyle and classified by hue and chroma. Allowed: neutral slate (low chroma), the admin accent and brand orange
// (hue under 35), red and rose (errors and deletes, hue 340-25 incl. the error notice's border). Anything else is a rainbow colour.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { serve, addons, knetSource, ALL } from './lib/admin-css-full-page.mjs'

const knet = process.env.ADDON_FILE ? readFileSync(process.env.ADDON_FILE, 'utf8') : knetSource()
const { server, base } = await serve({ current: addons(knet) })
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }

// the admin accent and the brand orange, as the build and the add-on paint them (rgb of the computed colour)
const BRAND = new Set(['rgb(154,69,44)', 'rgb(184,67,15)', 'rgb(224,86,28)', 'rgb(255,123,23)', 'rgb(199,106,66)', 'rgb(189,124,91)', 'rgb(199,106,66)'])
// returns the hue family of an rgb() colour, or null when it is neutral or an allowed family
export function rainbow(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)
  if (!m) return null
  const [r, g, b] = [1, 2, 3].map((i) => +m[i] / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (d < 0.1) return null                                  // neutral: slate, white, black, grey
  if (BRAND.has(c.replace(/\s+/g, ''))) return null         // the accent and the brand orange, exactly
  let h
  if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4
  h = (h * 60 + 360) % 360
  if (h < 25 || h >= 340) return null                       // red / rose (errors and deletes), terracotta family
  if (h >= 25 && h < 75) return 'amber/yellow'
  if (h >= 75 && h < 170) return 'green'
  if (h >= 170 && h < 225) return d > 0.3 ? 'sky/cyan' : null   // slate's blue-grey stays neutral
  if (h >= 225 && h < 340) return d > 0.25 ? 'indigo/violet' : null
  return null
}

const found = new Map()
let screens = 0
for (const name of ALL) {
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await p.goto(`${base}/__fx/${name}`, { waitUntil: 'load' }); await p.waitForTimeout(200)
  const cols = await p.evaluate(() => {
    const out = []
    for (const e of document.querySelectorAll('.admin-content *')) {
      if (!e.getBoundingClientRect().width) continue
      const c = getComputedStyle(e)
      out.push(['text', c.color], ['bg', c.backgroundColor])
      if (parseFloat(c.borderTopWidth)) out.push(['border', c.borderTopColor])
    }
    return out
  })
  screens++
  for (const [kind, c] of cols) {
    const fam = rainbow(c)
    if (!fam) continue
    const k = `${fam} ${kind} ${c}`
    if (!found.has(k)) found.set(k, name)
  }
  await p.context().close()
}
await browser.close(); server.close()

is(screens === ALL.length && screens >= 15, `every admin screen was measured (${screens})`)
for (const [k, where] of found) console.log('     rainbow: ' + k + '  on ' + where)
is(found.size === 0, 'no admin screen paints amber, green, sky, indigo or violet (text, background or border)', [...found.keys()].join(' | '))
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
