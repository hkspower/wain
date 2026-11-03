// READ-ONLY: how the LIVE /backends phone shell treats the notch and the home indicator.
//
//   node scripts/admin-safe-area-scan.mjs        (on the VPS, Playwright image; BASEURL / CHROMIUM_PATH optional)
//
// Chrome can fake env(safe-area-inset-*) over CDP (Emulation.setSafeAreaInsetsOverride), so this opens the
// admin with a 47px top + 34px bottom inset (portrait), a landscape phone (47px each side, 21px bottom) and
// no inset at all, then prints where the header, the bottom tab bar and its tabs, the content's last block
// and the bottom-sheet menu sit relative to the inset zones. The admin API is answered in the browser.
import { chromium } from 'playwright'
const B = process.env.BASEURL || 'https://www.sporta.com.kw'
const MOCK = { me: { email: 'owner@example.com' }, google_available: { available: false }, stats: { paid_count: 6, paid_revenue: '61.000', pending_count: 5, review_count: 1, failed_count: 2, unfulfilled_count: 3, paid_today: 1, revenue_today: '9.000', paid_7d: 4, revenue_7d: '38.000', cod_awaiting_count: 2, cod_awaiting_amount: '13.000' }, revenue: [], orders: [], mfa_status: { enabled: false } }
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] })
const RUNS = [['portrait 390x844 notch+home', 390, 844, { top: 47, bottom: 34, left: 0, right: 0 }], ['landscape 844x390 notch both sides', 844, 390, { top: 0, bottom: 21, left: 47, right: 47 }], ['no insets 390x844', 390, 844, { top: 0, bottom: 0, left: 0, right: 0 }]]
for (const [name, w, h, ins] of RUNS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, deviceScaleFactor: 2 })
  const pg = await ctx.newPage()
  await pg.route('**/*', (route) => { const req = route.request(), u = new URL(req.url()); if (u.origin !== new URL(B).origin) return route.continue()
    if (u.pathname.includes('/api/admin')) { const r = u.searchParams.get('r') || ''; if (req.method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK[r] ?? []) }) }
    if (req.method() !== 'GET' && req.method() !== 'HEAD') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }); return route.continue() })
  const cdp = await ctx.newCDPSession(pg)
  let ok = 'cdp-ok'
  try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: ins }) } catch (e) { ok = 'CDP-FAIL ' + String(e.message).slice(0, 60) }
  await pg.goto(B + '/backends', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
  const probe = () => pg.evaluate((ins) => {
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) } }
    const head = document.querySelector('.m-header'), bar = document.querySelector('.m-tabbar'), main = document.querySelector('.admin-content')
    const cs = (e, p) => e ? getComputedStyle(e)[p] : null
    const tabs = bar ? [...bar.querySelectorAll('a, button')].map((e) => { const b = e.getBoundingClientRect(); const lab = e.querySelector('span:last-child'); return (e.textContent || '').trim().slice(0, 6) + ' ' + Math.round(b.left) + '-' + Math.round(b.right) + ' y' + Math.round(b.top) + '-' + Math.round(b.bottom) }).join(' | ') : ''
    const homeZoneTop = innerHeight - ins.bottom
    const labelsInZone = bar ? [...bar.querySelectorAll('a, button')].filter((e) => { const b = e.getBoundingClientRect(); const kids = [...e.children].filter((k) => k.getBoundingClientRect().height > 0); const low = kids.length ? Math.max(...kids.map((k) => k.getBoundingClientRect().bottom)) : b.bottom; return ins.bottom > 0 && low > homeZoneTop }).length : 0
    const content = main ? main.lastElementChild : null
    return { header: r(head), headerPadTop: cs(head, 'paddingTop'), headerH: cs(head, 'height'), bar: r(bar), barPadBottom: cs(bar, 'paddingBottom'), barH: cs(bar, 'height'), barPadL: cs(bar, 'paddingLeft'), barPadR: cs(bar, 'paddingRight'), tabs, tabLabelsUnderHomeIndicator: labelsInZone, homeZoneTop, mainPadBottom: cs(main, 'paddingBottom'), lastBlockBottom: content ? Math.round(content.getBoundingClientRect().bottom) : null, headerChildren: head ? [...head.children].map((k) => (k.textContent || '').trim().slice(0, 10) + ' ' + Math.round(k.getBoundingClientRect().left) + '-' + Math.round(k.getBoundingClientRect().right)).join(' | ') : '' }
  }, ins)
  console.log('SAFE ' + name + ' ' + ok + ' insets ' + JSON.stringify(ins) + ' :: ' + JSON.stringify(await probe()))
  const mb = pg.locator('button:visible').filter({ hasText: new RegExp('Open menu|' + String.fromCharCode(9776)) }).first()
  if (await mb.count()) {
    await mb.click({ timeout: 3000 }).catch(() => {}); await pg.waitForTimeout(500)
    const m = await pg.evaluate((ins) => { const l = document.querySelector('.m-menu-layer'); if (!l) return 'no layer'; const p = l.querySelector('.m-menu-panel') || l; const items = [...p.querySelectorAll('a, button')].filter((e) => e.getBoundingClientRect().height > 1); const sc = [p].concat([...p.querySelectorAll('*')]).find((e) => { const k = getComputedStyle(e); return (k.overflowY === 'auto' || k.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 1 }); if (sc) sc.scrollTop = 1e6; const last = items[items.length - 1].getBoundingClientRect(); const pb = p.getBoundingClientRect(); const x = items.find((e) => /close/i.test((e.textContent || '') + (e.getAttribute('aria-label') || ''))); const xb = x ? x.getBoundingClientRect() : null; return { panelTop: Math.round(pb.top), panelBottom: Math.round(pb.bottom), panelPadBottom: getComputedStyle(p).paddingBottom, panelScrolls: !!sc, lastItemBottomAfterScroll: Math.round(last.bottom), homeZoneTop: innerHeight - ins.bottom, lastItemUnderIndicator: ins.bottom > 0 && last.bottom > innerHeight - ins.bottom, closeBtn: xb ? Math.round(xb.left) + '-' + Math.round(xb.right) + ' y' + Math.round(xb.top) + '-' + Math.round(xb.bottom) : null, layerPadTop: getComputedStyle(l).paddingTop, notchOverlapTop: ins.top > 0 && pb.top < ins.top } }, ins)
    console.log('SAFE-MENU ' + name + ' :: ' + JSON.stringify(m))
  }
  await ctx.close()
}
await browser.close()
console.log('SAFE_DONE')
