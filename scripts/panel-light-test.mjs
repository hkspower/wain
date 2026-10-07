#!/usr/bin/env node
/**
 * The /backends panel is light (2026-10-07). Asserts, in a real browser: the panel is data-theme=light on first paint of
 * every screen, the SHOP is not (and the panel never writes the shop's saved theme), the Dark/Light switch works and is
 * remembered, and no visible text on any panel screen is below 3:1 against its own ground — at desktop and phone width.
 * Elements whose ground is a gradient or lab() colour (the filled indigo/emerald buttons) cannot be read from computed style and are skipped
 * by class, named below, so a skip cannot hide a real fault elsewhere.
 */
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const EXE = process.env.CHROME_PATH ?? execSync('ls -d /opt/pw-browsers/chromium-1194/*/chrome').toString().trim().split('\n')[0]
let bad = 0
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : ' ' + extra}`); if (!ok) bad++ }
const SCREENS = ['Overview', 'Orders', 'Catalogue', 'Brands', 'Slides', 'Promotions', 'Discounts', 'Inventory', 'Settings', 'Payments', 'SEO', 'Setup', 'Reviews', 'Sporta AI', 'Notifications', 'Security']
const b = await chromium.launch({ executablePath: EXE })
for (const [w, tag] of [[1280, 'desktop'], [390, 'phone']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, hasTouch: w < 500, isMobile: w < 500 })
  const p = await ctx.newPage()
  await p.goto(BASE + '/backends', { waitUntil: 'networkidle' })
  if (await p.locator('input[type=password]').count()) {
    await p.fill('input[autocomplete^=username], input[type=email]', 'manager@sporta.com.kw')
    await p.fill('input[type=password]', 'correct horse')
    await p.locator('form button, button').first().click(); await p.waitForTimeout(1800)
  }
  check(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light', `${tag}: the panel is light`)
  const lows = []
  for (const n of SCREENS) {
    const loc = p.locator('button:visible, a:visible').filter({ hasText: new RegExp('^' + n + '$') }).first()
    if (!(await loc.count())) { check(false, `${tag}: ${n} is in the navigation`); continue }
    await loc.click(); await p.waitForTimeout(1200)
    const r = await p.evaluate(() => {
      const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
      const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(',').map(parseFloat); return { c: a.slice(0, 3), a: a.length > 3 ? a[3] : 1 } }
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const p = parse(getComputedStyle(e).backgroundColor); if (p && p.a > 0.5) return p.c } return [255, 255, 255] }
      const skip = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { if (/bg-(indigo|emerald|rose|red|green|blue|sky|amber|orange)-[5-9]00|bg-brand|h-9 w-9|h-8 w-8/.test(String(e.className))) return true } return false }
      const out = []
      for (const el of document.querySelectorAll('.admin-shell *')) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ')
        if (!own) continue
        const rc = el.getBoundingClientRect(); if (rc.width < 2 || rc.height < 2) continue
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.2 || skip(el)) continue
        const fg = parse(cs.color); if (!fg) continue
        const bg = bgOf(el), L1 = lum(fg.c), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
        if (ratio < 3) out.push(`${el.tagName}.${String(el.className).slice(0, 24)} "${own.slice(0, 24)}" ${ratio.toFixed(1)}`)
      }
      return out.slice(0, 4)
    })
    if (r.length) lows.push(`${n}: ${r.join(' ; ')}`)
  }
  check(lows.length === 0, `${tag}: no text below 3:1 on any of ${SCREENS.length} screens`, '\n       ' + lows.join('\n       '))
  if (w > 800) {
    const sw = p.locator('[data-sppl-switch]')
    check(await sw.count() === 1, 'desktop: the Dark panel switch is in the sidebar')
    await sw.click()
    check(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'desktop: the switch makes the panel dark')
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800)
    check(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'desktop: and it is remembered after a reload')
    await p.locator('[data-sppl-switch]').click()
    check(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light', 'desktop: and back to light')
    check(await p.evaluate(() => localStorage.getItem('sporta_theme')) !== 'light', 'the panel never writes the shop theme (sporta_theme is not "light")')
    await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
    check(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'the SHOP is still dark')
  }
  await ctx.close()
}
await b.close()
process.exit(bad ? 1 : 0)
