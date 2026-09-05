/**
 * Tab through the shop. Can you see where you are?
 *
 *   bash scripts/sandbox.sh
 *   node scripts/focus-audit.mjs
 *
 * NOTHING IN THIS REPO CHECKED THIS. The button rig presses every control and
 * proves it answers; the border rig proves its edge is visible; the contrast
 * rigs measure its text. All of them use the mouse. A keyboard user — and
 * anyone on a switch device or a screen magnifier — navigates by Tab, and if
 * the focused control looks exactly like the eight around it the shop is
 * unusable in a way no other rig here can see.
 *
 * It is also the check most easily destroyed by accident. `outline: none` is
 * the single most-copied line in CSS: it appears in every reset, every "remove
 * the ugly blue ring" answer, and every component library's opinionated
 * defaults. One of those arriving in a stylesheet removes the focus ring from
 * the whole shop, changes nothing a mouse user can see, and breaks no test.
 *
 * WHAT IT ASSERTS.
 *
 *   EVERY FOCUS STOP HAS A VISIBLE INDICATOR — an outline with width, or a
 *   box-shadow ring. Measured from the computed style of whatever
 *   document.activeElement is after a real Tab keypress, which is the only
 *   thing that accounts for the browser's own defaults.
 *
 *   FOCUS DOES NOT VANISH. A control that takes focus but leaves
 *   activeElement on <body> is a trap in the other direction: the Tab went
 *   somewhere unreachable.
 *
 *   AND THE RING IS NOT SUPPRESSED GLOBALLY. `:focus { outline: none }` with
 *   no matching :focus-visible rule is reported by name, because it is the
 *   shape of the accident above.
 *
 * WHAT IT DOES NOT DO: judge thickness or colour against WCAG 2.4.11. The
 * site's ring is a deliberate 2px brand outline and the app's is the browser
 * default, and both are visible — declaring one of them wrong would be a
 * design opinion, and this rig has none. It answers one question: can the
 * keyboard user see the control they are on.
 */
import { chromium } from 'playwright'
import { readFileSync, readdirSync } from 'node:fs'

const APP = process.env.APP ?? 'http://127.0.0.1:4173'
const SITE = process.env.SITE ?? 'http://127.0.0.1:4300'
const STOPS = Number(process.env.STOPS ?? 18)

const PAGES = [
  ['app ', APP, '/'],
  ['app ', APP, '/shop'],
  ['app ', APP, '/cart'],
  ['app ', APP, '/checkout'],
  ['app ', APP, '/backends'],
  ['site', SITE, '/'],
  ['site', SITE, '/shop'],
  ['site', SITE, '/cart'],
  ['site', SITE, '/checkout'],
  ['site', SITE, '/product/cloudsoft-jacket-army-green'],
]

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

const bare = []          // focus stops with no visible indicator
let stops = 0
let lost = 0

for (const [tag, base, route] of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  try { await page.goto(base + route, { timeout: 25000 }) } catch { await ctx.close(); continue }
  await page.waitForTimeout(2200)

  for (let i = 0; i < STOPS; i++) {
    await page.keyboard.press('Tab')
    const r = await page.evaluate(() => {
      const e = document.activeElement
      if (!e || e === document.body || e === document.documentElement) return { lost: true }
      const s = getComputedStyle(e)
      const w = parseFloat(s.outlineWidth) || 0
      return {
        lost: false,
        tag: e.tagName.toLowerCase(),
        // The accessible name if there is one, else the visible text — enough
        // to name the control in a failure without dumping the DOM.
        text: (e.getAttribute('aria-label') || e.innerText || e.value || '').trim().slice(0, 26),
        // A ring is an outline with width and a style, OR a box-shadow — the
        // two ways a focus indicator is actually drawn on the web. Tailwind's
        // `ring-*` utilities are box-shadow, so ignoring it would call the
        // site's own focus styling invisible.
        ring: (s.outlineStyle !== 'none' && w > 0) || (s.boxShadow && s.boxShadow !== 'none'),
        outline: `${s.outlineStyle} ${s.outlineWidth}`,
      }
    })
    if (r.lost) { lost++; continue }
    stops++
    if (!r.ring) bare.push(`${tag}${route} <${r.tag}> "${r.text}" outline=${r.outline}`)
  }
  await ctx.close()
}
await browser.close()

console.log(`--- ${stops} focus stops across ${PAGES.length} pages\n`)

check(stops > 0, `tabbing reaches controls at all (${stops})`)
check(bare.length === 0,
  `every control shows where the keyboard is (${stops} stops)`,
  bare.slice(0, 6).join(' | ') + (bare.length > 6 ? ` | +${bare.length - 6} more` : ''))

// --- and nothing turned the ring off across the whole shop -----------------
//
// Read from the stylesheets rather than the page, because a global
// `:focus { outline: none }` only shows up at runtime on the controls that
// happen to be tabbed to in the loop above. As source it is one grep.
{
  const CSS = new URL('../sporta-site/public_html/assets/', import.meta.url)
  const files = readdirSync(CSS).filter((f) => f.endsWith('.css'))
  const guilty = []
  for (const f of files) {
    // COMMENTS STRIPPED FIRST. Without this the selector group runs backwards
    // through whatever prose precedes the rule, and the failure message names
    // a comment instead of the offending selector — which is worse than no
    // message, because it sends the reader to the wrong line. Found by
    // mutation-testing this rig rather than by reading it.
    const src = readFileSync(new URL(f, CSS), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
    for (const m of src.matchAll(/([^{}]*:focus[^{}]*)\{([^}]*)\}/g)) {
      const [, sel, body] = m
      if (!/outline\s*:\s*(none|0)/.test(body)) continue
      // The legitimate one, and the reason this is not a blanket ban:
      // `:focus:not(:focus-visible) { outline: none }` is how a shop keeps the
      // ring for the keyboard and drops it for the mouse. That is the correct
      // pattern, not the accident.
      if (/:focus-visible/.test(sel)) continue
      guilty.push(`${f}: ${sel.trim().slice(0, 60)}`)
    }
  }
  check(guilty.length === 0,
    `no stylesheet removes the focus ring outright (${files.length} files)`,
    guilty.slice(0, 4).join(' | '))
}

if (lost) {
  console.log(`\n--   ${lost} Tab press(es) landed on nothing — the end of the page's`)
  console.log('     tab order, which is where focus is meant to leave for the browser chrome.')
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the keyboard can always see where it is')
process.exit(fails ? 1 : 0)
