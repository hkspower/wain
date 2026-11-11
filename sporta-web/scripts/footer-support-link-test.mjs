// The Support link in the footer (public/sporta-footer-call.js, third block), proven on the captured LIVE footer markup
// (scripts/fixtures/sizes-screen/*.html: the rendered home / about / terms / cart pages in ar and en).
//   node scripts/footer-support-link-test.mjs
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let fails = 0
const ok = (c, m, d = '') => { if (!c) fails++; console.log((c ? 'ok   ' : 'FAIL ') + m + (c || !d ? '' : '  — ' + d)) }
const JS = readFileSync(join(ROOT, 'public/sporta-footer-call.js'), 'utf8')
const cut = JS.indexOf('/* Sporta — Support link in the footer'), end = JS.indexOf('/* Sporta — bag accessibility')
const SUPPORT_BLOCK = JS.slice(cut, end)
ok(cut > 0 && end > cut, 'the Support block is present in public/sporta-footer-call.js')
const WITHOUT = JS.slice(0, cut) + JS.slice(end)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const run = async (name, script, check) => {
  for (const f of ['home-ar', 'about-en', 'terms-en', 'cart-ar']) {
    const html = readFileSync(join(ROOT, 'scripts/fixtures/sizes-screen', f + '.html'), 'utf8')
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
    await page.setContent(html.replace(/<script[\s\S]*?<\/script>/g, ''), { waitUntil: 'load' })
    await page.evaluate((l) => { document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr' }, /-en$/.test(f) ? 'en' : 'ar')   // what /boot.js sets before the first paint
    page.__before = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    await page.addScriptTag({ content: script })
    await page.waitForTimeout(150)
    await check(page, f)
    await page.close()
  }
}
await run('with', JS, async (page, f) => {
  const en = /-en$/.test(f)
  const info = await page.evaluate(() => {
    const links = [...document.querySelectorAll('footer a[href="/support"]')]
    const a = links[0], li = a && a.closest('li'), track = document.querySelector('footer a[href="/track"]')
    const trackLi = track && track.closest('li')
    return { n: links.length, text: a && a.textContent, id: a && a.id, after: !!(li && trackLi && li.previousElementSibling === trackLi), cls: a && a.className, trackCls: track && track.className, liCls: li && li.className, trackLiCls: trackLi && trackLi.className, h: a && Math.round(a.getBoundingClientRect().height), trackH: track && Math.round(track.getBoundingClientRect().height), tag: li && li.parentElement.tagName, discover: a && a.hasAttribute('data-discover') }
  })
  ok(info.n === 1, f + ': exactly one Support link in the footer', JSON.stringify(info))
  ok(info.text === (en ? 'Support' : 'الدعم'), f + ': label in the page language', info.text)
  ok(info.after, f + ': placed right after Track')
  ok(info.cls === info.trackCls && info.liCls === info.trackLiCls, f + ': same classes as its neighbour (same look, same 24px+ tap height)')
  ok(info.h === info.trackH, f + ': same height as Track (its 24px minimum comes from the live stylesheet, which this fixture does not carry)', info.h + ' vs ' + info.trackH)
  ok(info.tag === 'UL' && !info.discover, f + ': sits in the list; no router attribute copied')
  // idempotent + survives a React-like re-render of the footer + language switch
  const again = await page.evaluate(async () => {
    const ul = document.querySelector('footer a[href="/track"]').closest('ul'); const html = ul.innerHTML
    ul.innerHTML = html.replace(/<li[^>]*><a[^>]*id="sporta-footer-support"[\s\S]*?<\/li>/, '')   // the app re-renders the list without our item
    await new Promise((r) => setTimeout(r, 250))
    const a = document.querySelectorAll('footer a[href="/support"]').length
    document.documentElement.lang = document.documentElement.lang === 'en' ? 'ar' : 'en'
    await new Promise((r) => setTimeout(r, 250))
    return { a, b: document.querySelectorAll('footer a[href="/support"]').length, text: document.getElementById('sporta-footer-support').textContent, lang: document.documentElement.lang }
  })
  ok(again.a === 1 && again.b === 1, f + ': put back after a re-render, never duplicated', JSON.stringify(again))
  ok(again.text === (again.lang === 'en' ? 'Support' : 'الدعم'), f + ': follows a language switch')
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(sideways <= page.__before, f + ': adds no sideways scroll', sideways + ' vs ' + page.__before + ' before')
})
await run('without', WITHOUT, async (page, f) => {
  ok((await page.evaluate(() => document.querySelectorAll('footer a[href="/support"]').length)) === 0, 'MUTATION ' + f + ': with the block removed there is no Support link')
})
// when the app links /support itself, the add-on steps aside
{
  const html = readFileSync(join(ROOT, 'scripts/fixtures/sizes-screen/home-ar.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '')
  const page = await browser.newPage(); await page.setContent(html)
  await page.evaluate(() => { const li = document.querySelector('footer a[href="/track"]').closest('li'); const n = li.cloneNode(true); n.querySelector('a').setAttribute('href', '/support'); li.after(n) })
  await page.addScriptTag({ content: JS }); await page.waitForTimeout(200)
  ok((await page.evaluate(() => document.querySelectorAll('footer a[href="/support"]').length)) === 1, 'a native /support link is left alone (no second one)')
  await page.close()
}
await browser.close()
console.log(fails ? fails + ' FAILED' : 'all passed')
process.exit(fails ? 1 : 0)
