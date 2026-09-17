/**
 * The website panel's cards: one shape, one direction, and no two overlays
 * claiming the same names.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/panel-cards-test.mjs
 *
 * WHY IT EXISTS. /backends is a prebuilt bundle with no source here, and a
 * growing pile of hand-written overlays add cards to it. On 2026-09-17 the
 * owner asked to "make alignment and padding for backends" and there were
 * three separate faults, none of which any rig could see:
 *
 *   - payment.js and product-photos.js BOTH used the `.spp` prefix AND the same
 *     `spp-css` <style> element id. Each overlay bails out of injecting its
 *     stylesheet if that id is already present, so whichever mounted first won
 *     and the other card rendered in the WRONG overlay's rules. Measured: open
 *     Catalogue then Settings and the payment card came back with padding 14px,
 *     radius 14px and a translucent background instead of its own. Open
 *     Settings first and it was fine. A bug whose appearance depended on which
 *     tab you clicked first.
 *   - three cards hardcoded `background:#fff` on a dark panel.
 *   - three different card geometries sat on one screen.
 *
 * THE STATIC HALF IS THE IMPORTANT ONE, and it is what would have caught the
 * collision at commit time rather than in a screenshot. It DERIVES both the ids
 * and the class prefixes from the assets directory, so an overlay added
 * tomorrow is covered the day it lands — the lesson sw-version-test already
 * learned when its hand-copied list of seven files had grown to fifteen. It
 * asserts the derivation found something first, because a scan that matches
 * nothing passes every comparison under it.
 *
 * THE BROWSER HALF asks whether the cards actually LOOK like the panel: every
 * overlay card must carry the same padding and radius as the bundle's OWN card,
 * read off the bundle at run time rather than compared with a number written
 * here. If the panel is ever restyled this keeps testing the truth.
 *
 * AND IT GUARDS THE OWNER'S OWN CONTENT. The panel was flipped to LTR because
 * every word of its chrome is English; the Catalogue carries Arabic PRODUCT
 * NAMES, which are data, and those must still render right-to-left inside it.
 * That is the one thing the direction change could have broken and the one
 * thing nobody would have checked.
 *
 * It writes nothing.
 */
import { chromium } from 'playwright'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ASSETS = new URL('../sporta-site/public_html/assets/', import.meta.url).pathname
const EMAIL = 'manager@sporta.com.kw'
const PASSWORD = 'correct horse'

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

/* ============================ 1. the static half ========================== */
// Every hand-written overlay that injects a stylesheet, and what it claims.
const files = readdirSync(ASSETS).filter((f) => f.endsWith('.js'))
const overlays = []
for (const f of files) {
  const src = readFileSync(join(ASSETS, f), 'utf8')
  // The id it gives its <style>, written as `s.id = 'xxx-css'`.
  const id = src.match(/\.id\s*=\s*'([a-z0-9-]+-css)'/)?.[1]
  if (!id) continue
  // The class prefixes it defines in its own CSS, e.g. '.spk{' and '.spk-h{'.
  const prefixes = new Set(
    [...src.matchAll(/'\.([a-z]{2,4})(?:-[a-z0-9-]+)?\s*\{/g)].map((m) => m[1]))
  overlays.push({ file: f, id, prefixes: [...prefixes] })
}

console.log(`--- ${overlays.length} overlay(s) inject a stylesheet\n`)
check(overlays.length >= 5, 'the overlay scan found the panel overlays',
  overlays.length ? overlays.map((o) => `${o.file}=${o.id}`).join(' ') : 'NOTHING FOUND — every check below would pass by measuring nothing')

// (a) no two overlays may share a <style> id — that is a silent total loss of
//     one overlay's styling, not a clash.
{
  const byId = new Map()
  for (const o of overlays) {
    if (!byId.has(o.id)) byId.set(o.id, [])
    byId.get(o.id).push(o.file)
  }
  const clashes = [...byId].filter(([, fs]) => fs.length > 1)
  check(clashes.length === 0, 'no two overlays share a <style> element id',
    clashes.map(([id, fs]) => `${id} claimed by ${fs.join(' and ')}`).join('; ')
      + (clashes.length ? ' — the second one injects NOTHING and renders in the first one\'s rules' : ''))
}

// (b) no two overlays may claim the same class prefix, which is the same bug
//     one layer down: the styles that DO load land on the wrong elements.
{
  const byPrefix = new Map()
  for (const o of overlays) {
    for (const p of o.prefixes) {
      if (!byPrefix.has(p)) byPrefix.set(p, [])
      byPrefix.get(p).push(o.file)
    }
  }
  const clashes = [...byPrefix].filter(([, fs]) => new Set(fs).size > 1)
  check(clashes.length === 0, 'no two overlays claim the same class prefix',
    clashes.map(([p, fs]) => `.${p} used by ${[...new Set(fs)].join(' and ')}`).join('; '))
}

// (c) a card must not hardcode a light background: the panel is dark, and the
//     three that did were the visible half of this complaint.
{
  const light = []
  for (const o of overlays) {
    const src = readFileSync(join(ASSETS, o.file), 'utf8')
    // Only the CARD ROOT rule, `.xxx{...}` — a white button is not a fault.
    const root = src.match(new RegExp(`'\\.(?:${o.prefixes.join('|')})\\{([^']*)'`))?.[1] ?? ''
    if (/background:\s*#fff\b/i.test(root)) light.push(`${o.file} card is #fff`)
  }
  check(light.length === 0, 'no overlay card hardcodes a white background', light.join('; '))
}

/* ============================ 2. the browser half ======================== */
const cardClasses = [...new Set(overlays.flatMap((o) => o.prefixes))]

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const p = await browser.newPage({ viewport: { width: 1280, height: 1300 } })

try {
  await p.goto(`${BASE}/backends`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1800)
  await p.locator('input').nth(0).fill(EMAIL)
  await p.locator('input').nth(1).fill(PASSWORD)
  await p.getByRole('button').filter({ hasText: /^Sign in$/ }).last().click()
  await p.waitForTimeout(3500)

  // Catalogue FIRST, then Settings. That order is the point: it is the order
  // that exposed the shared-id collision, and a rig that only ever opens
  // Settings would have reported the panel healthy throughout.
  await p.getByText('Catalogue', { exact: true }).first().click()
  await p.waitForTimeout(2200)

  const arabic = await p.evaluate(() => {
    const els = [...document.querySelectorAll('.admin-shell *')]
      .filter((e) => e.children.length === 0 && /[؀-ۿ]/.test(e.textContent || ''))
    return { n: els.length, rtl: els.filter((e) => getComputedStyle(e).direction === 'rtl').length }
  })
  check(arabic.n > 0, 'the Catalogue has Arabic product names to check', `${arabic.n} found`)
  check(arabic.n > 0 && arabic.rtl === arabic.n,
    'and every one still renders right-to-left inside the LTR panel',
    `${arabic.rtl} of ${arabic.n} — the owner\'s own data must not be flipped by a chrome decision`)

  await p.getByText('Settings', { exact: true }).first().click()
  await p.waitForTimeout(2200)

  const m = await p.evaluate((classes) => {
    const shell = document.querySelector('.admin-shell')
    // The bundle's OWN card, whatever it currently looks like.
    const own = document.querySelector('.admin-shell .rounded-2xl.border')
    const geo = (el) => {
      const s = getComputedStyle(el)
      return { pad: Math.round(parseFloat(s.paddingTop)), radius: Math.round(parseFloat(s.borderTopLeftRadius)) }
    }
    const cards = []
    for (const c of classes) {
      for (const el of document.querySelectorAll(`.admin-shell .${c}`)) {
        // card roots only — the ones that actually carry a border and padding
        const s = getComputedStyle(el)
        if (parseFloat(s.paddingTop) < 4 || parseFloat(s.borderTopWidth) < 1) continue
        cards.push({ cls: c, ...geo(el), bg: s.backgroundColor })
      }
    }
    return {
      dir: shell ? getComputedStyle(shell).direction : 'no-shell',
      own: own ? geo(own) : null,
      cards,
    }
  }, cardClasses)

  check(m.dir === 'ltr', 'the panel reads left-to-right',
    `direction=${m.dir} — its chrome is English, so RTL put full stops at the start of the line`)
  check(!!m.own, 'the bundle\'s own card was found, to compare against',
    m.own ? `padding ${m.own.pad}px, radius ${m.own.radius}px` : 'not found — nothing below is a measurement')
  check(m.cards.length > 0, 'overlay cards are on the Settings screen', `${m.cards.length} found`)

  if (m.own && m.cards.length) {
    const off = m.cards.filter((c) => Math.abs(c.pad - m.own.pad) > 1 || Math.abs(c.radius - m.own.radius) > 1)
    check(off.length === 0,
      'every overlay card has the bundle\'s own padding and radius',
      off.map((c) => `.${c.cls} ${c.pad}px/${c.radius}px vs ${m.own.pad}px/${m.own.radius}px`).join(', '))

    const white = m.cards.filter((c) => c.bg === 'rgb(255, 255, 255)')
    check(white.length === 0, 'and none of them is a white slab on the dark panel',
      white.map((c) => `.${c.cls}`).join(', '))
  }

  console.log(fails ? `\n${fails} failed` : '\nall ok — one card shape, one direction, and no two overlays fighting')
} finally {
  await browser.close()
}

process.exit(fails ? 1 : 0)
