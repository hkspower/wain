// test:checkout-pay — the checkout's payment methods (2026-10-07): an unselected radio is not
// dark-filled, the chosen row is orange-edged, each method has a picture, the pay button names
// the chosen method, a trust line is shown, no sideways scroll. Phone and desktop, ar and en.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const BASE = process.env.BASE || 'http://127.0.0.1:4300'
const exe = execSync('ls -d /opt/pw-browsers/chromium-*/*/chrome | head -1').toString().trim()
const browser = await chromium.launch({ executablePath: exe })
let fails = 0
const ok = (c, m, x = '') => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m + (c ? '' : '   ' + x)) }
for (const [w, h] of [[390, 844], [1280, 900]]) for (const lang of ['ar', 'en']) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 768 })
  await ctx.addInitScript(l => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  const p = await ctx.newPage()
  const stock = await (await fetch(BASE + '/api/api.php?r=stock')).json()
  const it = stock.find(r => r.in_stock && r.stock > 0)
  await p.goto(BASE + '/product/' + it.slug + '?lang=' + lang, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  await p.locator('button').filter({ hasText: new RegExp('^' + it.size + '$') }).first().click({ force: true }); await p.waitForTimeout(300)
  await p.locator('button').filter({ hasText: lang === 'ar' ? /^اشترِ الآن$/ : /^Buy now$/ }).first().click({ force: true }); await p.waitForTimeout(2200)
  try { await p.waitForSelector('input[name=paymethod]', { timeout: 15000 }) } catch (e) { console.log('CART', await p.evaluate(() => localStorage.getItem('sporta_cart')), (await p.textContent('main')).slice(0, 300)); throw e }
  await p.waitForTimeout(400)
  const tag = `${w} ${lang}:`
  const r = await p.evaluate(() => {
    const rs = [...document.querySelectorAll('input[name=paymethod]')].filter(x => x.offsetParent)
    const st = x => getComputedStyle(x)
    const off = rs.find(x => !x.checked), on = rs.find(x => x.checked)
    return {
      n: rs.length, offBg: off && st(off).backgroundColor, onBorder: on && st(on.closest('label')).borderTopColor,
      icons: rs.filter(x => x.closest('label').querySelector('[data-cpay-icon]')).length,
      trust: (document.querySelector('.cpay-trust') || {}).textContent || '',
      wide: document.documentElement.scrollWidth > innerWidth + 1, on: on && on.value
    }
  })
  ok(r.n >= 2, `${tag} at least two methods`, r.n)
  ok(r.offBg === 'rgb(255, 255, 255)', `${tag} an unselected radio is white, not dark`, r.offBg)
  ok(r.onBorder === 'rgb(224, 86, 28)', `${tag} the chosen row has an orange edge`, r.onBorder)
  ok(r.icons === r.n, `${tag} every method has a picture`, r.icons + '/' + r.n)
  ok(r.trust.length > 20, `${tag} the trust line is shown`)
  ok(!r.wide, `${tag} no sideways scroll`)
  const label = () => p.evaluate(() => [...document.querySelectorAll('button[data-cpay-label]')].filter(b => b.offsetParent).map(b => b.getAttribute('data-cpay-label')))
  const order = await p.evaluate(() => [...document.querySelectorAll('label:has(> input[name=paymethod])')].filter(l => l.offsetParent).map(l => [l.querySelector('input').value, Math.round(l.getBoundingClientRect().top), l.querySelector('input').checked]).sort((x, y) => x[1] - y[1]))
  ok(order.map(o => o[0]).join() === 'tpay,knet,cod', `${tag} painted order: T-Pay, KNET, then cash (2026-10-07)`, JSON.stringify(order))
  ok(order.find(o => o[0] === 'knet')?.[2] === true, `${tag} KNET is still the pre-selected method`, JSON.stringify(order))
  const gap = await p.evaluate(() => { const l = [...document.querySelectorAll('label:has(> input[name=paymethod])')].filter(x => x.offsetParent); const b = (v) => l.find(x => x.querySelector('input').value === v).getBoundingClientRect(); return [Math.round(b('cod').top - b('knet').bottom), Math.round(b('knet').top - b('tpay').bottom)] })
  ok(gap[0] > gap[1] + 4, `${tag} cash sits further from KNET than KNET from T-Pay (a visible break)`, JSON.stringify(gap))
  const k = await label()
  ok(k.length >= 1 && /KNET|كي نت/.test(k[0]) && !/CBK/.test(k[0]), `${tag} the pay button names KNET`, JSON.stringify(k))
  const cod = p.locator('input[name=paymethod][value=cod]')
  if (await cod.count() && await cod.isVisible()) {
    await cod.click({ force: true }); await p.waitForTimeout(300)
    const c = await p.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && /delivery|الاستلام/.test(b.textContent)).map(b => b.hasAttribute('data-cpay-label')))
    ok(c.length >= 1 && c.every(x => !x), `${tag} choosing cash: the button says pay on delivery, unlabelled`, JSON.stringify(c))
    await p.locator('input[name=paymethod][value=knet]').click({ force: true }); await p.waitForTimeout(300)
    const vis = await p.evaluate(() => { const b = [...document.querySelectorAll('button[data-cpay-label]')].find(b => b.offsetParent); if (!b) return false; const s = getComputedStyle(b, '::after'); return s.content !== 'none' && parseFloat(s.fontSize) > 10 })
    ok(vis, `${tag} back on KNET, the new words are drawn`)
  } else ok(false, `${tag} cash on delivery offered in the sandbox`)
  await ctx.close()
}
await browser.close()
console.log(fails ? `${fails} failed` : 'all ok')
process.exit(fails ? 1 : 0)
