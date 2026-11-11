// READ-ONLY probe of the LIVE checkout's governorate and area controls (ar + en, 390 wide). A throwaway browser context
// adds ONE in-stock item to the bag (client side only), opens /checkout, lists every form control (id, type, label,
// options), then picks each governorate in turn and records the area list it offers. Non-GET requests are aborted before
// they leave the browser; the order button is never pressed; nothing is submitted; nobody signs in.
import { chromium } from 'playwright'
const BASE = 'https://www.sporta.com.kw'
const out = (s) => console.log(s)
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const q = (lang, p) => BASE + p + (lang === 'en' ? (p.includes('?') ? '&' : '?') + 'lang=en' : '')
async function slugs(page) {
  const j = await (await page.request.get(BASE + '/api/api.php?r=products')).json()
  const l = j.products || j.items || j.data || j
  return l.map((p) => p.slug).slice(0, 14)
}
async function addItem(page, lang) {
  for (const slug of await slugs(page)) {
    await page.goto(q(lang, '/product/' + slug), { waitUntil: 'load' }); await page.waitForTimeout(2000)
    await page.evaluate(() => { const SZ = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'ONE SIZE', 'FREE SIZE']; const b = [...document.querySelectorAll('main button')].find((x) => !x.disabled && SZ.includes((x.textContent || '').trim().toUpperCase())); if (b) b.click() })
    await page.waitForTimeout(400)
    const r = await page.evaluate(() => { const t = (x) => (x.textContent || '').replace(/\s+/g, ' ').trim(); const b = [...document.querySelectorAll('main button')].filter((x) => !x.disabled).find((x) => !/wish|favou?rite|save|buy now|size|المفضلة|مقاس/i.test(t(x)) && /^(add|أضف|اضف)/i.test(t(x))); if (b) { b.click(); return 'clicked' } return 'no' })
    await page.waitForTimeout(1200)
    if (r === 'clicked') return slug
  }
  return null
}
for (const lang of ['ar', 'en']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const page = await ctx.newPage()
  let blocked = 0
  await page.route('**/*', (r) => { const m = r.request().method(); if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') { blocked++; return r.abort() } return r.continue() })
  const slug = await addItem(page, lang)
  out('== ' + lang + ' bag item: ' + slug)
  await page.goto(q(lang, '/checkout'), { waitUntil: 'load' }); await page.waitForTimeout(3500)
  const controls = await page.evaluate(() => [...document.querySelectorAll('form input, form select, form textarea')].map((e) => {
    const lab = e.labels && e.labels[0] ? e.labels[0].textContent.trim() : (e.getAttribute('aria-label') || e.placeholder || '')
    return { id: e.id, tag: e.tagName.toLowerCase(), type: e.type, name: e.name, req: e.required, ac: e.autocomplete, label: lab.slice(0, 40), opts: e.tagName === 'SELECT' ? e.options.length : undefined }
  }))
  out('CONTROLS ' + JSON.stringify(controls))
  const sels = await page.evaluate(() => [...document.querySelectorAll('form select')].map((s) => ({ id: s.id, label: (s.labels && s.labels[0] ? s.labels[0].textContent.trim() : ''), options: [...s.options].map((o) => o.value + '=' + o.textContent.trim()) })))
  for (const s of sels) out('SELECT ' + s.id + ' [' + s.label + '] ' + s.options.length + ': ' + s.options.slice(0, 12).join(' | ') + (s.options.length > 12 ? ' ...' : ''))
  // pick every governorate and record the dependent select's options
  const govId = (sels.find((s) => /gov|محافظ/i.test(s.id + s.label)) || {}).id
  const areaId = (sels.find((s) => /area|منطق/i.test(s.id + s.label)) || {}).id
  out('GOV_ID ' + govId + ' AREA_ID ' + areaId)
  if (govId) {
    const govs = (sels.find((s) => s.id === govId).options).filter((o) => o.split('=')[0] !== '')
    for (const g of govs) {
      const val = g.split('=')[0]
      await page.selectOption('#' + govId, val).catch(() => {}); await page.waitForTimeout(250)
      const areas = areaId ? await page.evaluate((id) => { const s = document.getElementById(id); return s ? (s.tagName === 'SELECT' ? [...s.options].map((o) => o.textContent.trim()) : ['(input)']) : ['(none)'] }, areaId) : []
      out('GOV ' + g + ' -> ' + areas.length + ' areas: ' + areas.join(', '))
    }
  }
  const dl = await page.evaluate(() => [...document.querySelectorAll('datalist')].map((d) => d.id + ':' + d.options.length))
  out('DATALISTS ' + JSON.stringify(dl) + ' blockedNonGET=' + blocked)
  await ctx.close()
}
await browser.close()
out('PROBE_DONE')
