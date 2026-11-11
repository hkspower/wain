// READ-ONLY probe of the LIVE product page's fixed buy bar (phone). Loads the page, measures the bar, taps a size chip and
// "Add" (client-side bag only: localStorage, no request to the server, no checkout), clicks nothing else, POSTs nothing.
// Env: BASE, SLUG (default first product in the sitemap), LANGS (ar,en), WIDTHS (320,360,390,430), THEMES (light,dark).
// Run on the VPS in mcr.microsoft.com/playwright:v1.49.0-noble (see CLAUDE.md "Probing the live site").
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const LANGS = (process.env.LANGS || 'ar,en').split(',')
const WIDTHS = (process.env.WIDTHS || '320,360,390,430').split(',').map(Number)
const THEMES = (process.env.THEMES || 'light,dark').split(',')
const out = (s) => process.stdout.write(s + '\n')
let slug = process.env.SLUG || ''
if (!slug) { try { const t = await (await fetch(B + '/sitemap.xml')).text(); let urls = [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]); for (const u of urls.filter((x) => /\.xml/.test(x))) { const tt = await (await fetch(u)).text(); urls = urls.concat([...tt.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])) } const p = urls.find((u) => /\/product\//.test(u) && !/lang=/.test(u)); if (p) slug = p.replace(B, '') } catch (e) { out('SITEMAP_ERR ' + e) } }
out('PRODUCT ' + slug)
const browser = await chromium.launch()
const R = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',') }
const measure = () => {
  const bar = document.querySelector('.catalog-product-page .action-bar')
  if (!bar) return 'NO_BAR'
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } }
  const cs = getComputedStyle(bar), br = R(bar)
  const add = document.querySelector('.catalog-product-page .product-purchase-row > .btn-primary')
  const kids = [...bar.children].map((c) => { const r = R(c), s = getComputedStyle(c); return (c.tagName + '.' + (c.className || '').toString().split(' ').filter((x) => /btn|price/.test(x)).join('.') + ' ' + r.l + ',' + r.t + ',' + r.w + 'x' + r.h + ' fs' + s.fontSize + ' clip=' + (c.scrollWidth > c.clientWidth + 1) + ' "' + (c.textContent || '').trim().slice(0, 28) + '"') })
  const ad = add ? (() => { const r = R(add), s = getComputedStyle(add); return 'ADD ' + r.l + ',' + r.t + ',' + r.w + 'x' + r.h + ' bg ' + s.backgroundColor + ' "' + add.textContent.trim().slice(0, 24) + '" disabled=' + add.disabled })() : 'ADD none'
  // other fixed things that overlap the bar
  const ov = [...document.querySelectorAll('body *')].filter((e) => { if (bar.contains(e) || e === add || add?.contains(e)) return false; const s = getComputedStyle(e); if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') return false; const r = R(e); if (r.w < 8 || r.h < 8) return false; return !(r.l + r.w <= br.l || r.l >= br.l + br.w || r.t + r.h <= br.t || r.t >= br.t + br.h) }).map((e) => e.tagName + '.' + (e.className || '').toString().slice(0, 40) + ' ' + JSON.stringify(R(e)))
  const last = document.querySelector('footer') ? R(document.querySelector('footer')) : null
  const badge = [...document.querySelectorAll('header [class*=badge],header [class*=count],header span')].find((e) => /^\d+$/.test((e.textContent || '').trim()))
  return ['BAR ' + br.l + ',' + br.t + ',' + br.w + 'x' + br.h + ' pos ' + cs.position + ' z' + cs.zIndex + ' bg ' + cs.backgroundColor + ' pb ' + cs.paddingBottom + ' shadow ' + (cs.boxShadow !== 'none') + ' bodyPB ' + getComputedStyle(document.body).paddingBottom, ad, ...kids.map((k) => 'KID ' + k), 'OVERLAP ' + (ov.join(' | ') || 'none'), 'BADGE ' + (badge ? badge.textContent.trim() : 'none'), 'VH ' + innerHeight + ' scrollH ' + document.documentElement.scrollHeight, 'SIDEWAYS ' + (document.documentElement.scrollWidth - document.documentElement.clientWidth)].join('\n  ')
}
for (const theme of THEMES) for (const lang of LANGS) for (const w of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lang', l); localStorage.setItem('sporta_theme', t) } catch (e) {} }, [lang, theme])
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  await p.goto(B + slug + (lang === 'en' ? (slug.includes('?') ? '&' : '?') + 'lang=en' : ''), { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(800)
  out('== ' + theme + ' ' + lang + ' ' + w)
  out('  ' + (await p.evaluate(measure)))
  // choose a size, then Add, then look at feedback
  const chip = await p.$('.catalog-product-page [aria-pressed="false"]:not([disabled])')
  if (chip) { await chip.tap().catch(() => {}); await p.waitForTimeout(300) }
  const add = await p.$('.catalog-product-page .product-purchase-row > .btn-primary:not([disabled])')
  if (add) {
    await add.tap().catch(() => {}); await p.waitForTimeout(350)
    out('  AFTER_ADD 350ms ' + (await p.evaluate(measure)).split('\n').filter((x) => /ADD|BADGE|OVERLAP/.test(x)).join(' // '))
    out('  TOAST ' + (await p.evaluate(() => { const t = document.querySelector('.sporta-u3-toast,[role=status]'); if (!t) return 'none'; const r = t.getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + t.textContent.trim().slice(0, 40) + '"' })))
    await p.waitForTimeout(1500)
    out('  AFTER_ADD 1850ms ' + (await p.evaluate(measure)).split('\n').filter((x) => /ADD|BADGE/.test(x)).join(' // '))
  } else out('  NO_ADD_BUTTON (size not chosen or sold out)')
  await ctx.close()
}
await browser.close()
out('PROBE_DONE')
