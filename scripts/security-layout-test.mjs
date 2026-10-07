#!/usr/bin/env node
/**
 * The /backends Security screen, measured (2026-10-07, "improve security page layout"). Three faults it had:
 *  1. four overlay cards (sign-in history, Google, Apple, passcode) were inserted INSIDE the first card's flex header,
 *     so they sat in a row beside its title, squeezed to a few pixels, and the page ran 11,000px tall;
 *  2. the "Jump to" bar's pills made the whole content area 347px wider than the window (flex item, min-width auto);
 *  3. every signed-in browser was listed (42 rows of "Linux Chrome").
 * Asserts, at phone and desktop width: no card sits in a header, the content area fits the window, every card on the
 * screen is the same width (desktop), the page has no sideways scroll, and at most six sessions show until "Show all".
 */
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EXE = process.env.CHROME_PATH ?? execSync('ls -d /opt/pw-browsers/chromium-1194/*/chrome').toString().trim().split('\n')[0]
let bad = 0
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ' ' + extra}`); if (!ok) bad++ }
const b = await chromium.launch({ executablePath: EXE })
for (const [w, h, tag] of [[390, 844, 'phone'], [1280, 900, 'desktop']]) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500, isMobile: w < 500 })).newPage()
  await p.goto(BASE + '/backends', { waitUntil: 'networkidle' })
  if (await p.locator('input[type=password]').count()) {
    await p.fill('input[autocomplete^=username], input[type=email]', 'manager@sporta.com.kw')
    await p.fill('input[type=password]', 'correct horse')
    await p.locator('form button, button').first().click(); await p.waitForTimeout(1800)
  }
  await p.locator('button:visible, a:visible').filter({ hasText: /^Security$/ }).first().click()
  await p.waitForSelector('.spsec', { timeout: 8000 }); await p.waitForTimeout(1200)
  const m = await p.evaluate(() => {
    const ac = document.querySelector('.admin-content'), r = (e) => e.getBoundingClientRect()
    const cards = [...document.querySelectorAll('[data-sporta-loginlog],[data-sporta-gsi-setup],[data-sporta-asi-setup],[data-sporta-pass-card]')]
    const secs = [...ac.querySelectorAll(':scope > div.mx-auto > section, :scope > section.spsec')]
    return {
      inHeader: cards.filter((c) => c.closest('header')).length, cards: cards.length,
      acRight: Math.round(r(ac).right), vw: innerWidth, sw: document.documentElement.scrollWidth,
      widths: secs.map((s) => Math.round(r(s).width)), pageH: document.documentElement.scrollHeight,
      sessions: document.querySelectorAll('[data-spsec-sessions] [data-session]').length,
    }
  })
  check(m.cards === 4, `${tag}: all four overlay cards are on the screen`, String(m.cards))
  check(m.inHeader === 0, `${tag}: none of them is inside a card's header row`, String(m.inHeader))
  check(m.acRight <= m.vw, `${tag}: the content area fits the window (right edge ${m.acRight}, window ${m.vw})`)
  check(m.sw <= m.vw, `${tag}: no sideways scroll (${m.sw} in ${m.vw})`)
  if (w > 800) check(Math.max(...m.widths) - Math.min(...m.widths) <= 2, `${tag}: every card is the same width`, m.widths.join(','))
  check(m.sessions <= 6, `${tag}: at most six sessions show before "Show all" (${m.sessions})`)
  check(m.pageH < 6000, `${tag}: the screen is not thousands of pixels tall (${m.pageH}px)`)
}
await b.close()
process.exit(bad ? 1 : 0)
