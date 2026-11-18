// SCAN of the storefront footer (owner, 2026-11-18: "scan footer"). READ-ONLY: it changes nothing.
//
//   node scripts/footer-scan-1118.mjs          (needs the captured live storefront: SPORTA_LIVE_CAPTURE=<dir>, see scripts/lib/add-to-cart-ux-live.mjs)
//
// Serves the capture of what the live server answered (the real compiled app, the live /api JSON) under THIS repo's add-on files, so it
// measures what the next deploy would put in front of a shopper, then looks at the footer of five pages in both languages at 320, 390,
// 768 and 1280 px: its landmark, every link (where it goes, what it says, how big the tap target is, whether it opens in a new tab with
// rel=noopener), sideways overflow, text and background contrast, language parity (Arabic copy with Western digits mixed with Arabic-
// Indic ones, English left in the Arabic page), and the footer's position under the content. Findings print as FINDING lines.
import { chromium } from 'playwright'
import { serveLive, liveDir } from './lib/add-to-cart-ux-live.mjs'

if (!liveDir()) { console.log('SKIP no live capture (set SPORTA_LIVE_CAPTURE)'); process.exit(0) }
const srv = await serveLive().catch((e) => { console.log('FAIL could not start the capture server: ' + e.message); process.exit(1) })
const origin = srv.base
const server = { close: () => srv.close() }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const PAGES = ['/', '/shop', '/about', '/contact', '/cart']
const WIDTHS = [320, 390, 768, 1280]
const findings = new Map()
const note = (key, msg) => { if (!findings.has(key)) findings.set(key, { msg, where: [] }); return findings.get(key) }
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

const dump = {}
for (const lang of ['ar', 'en']) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: 1, serviceWorkers: 'block' })
    const pg = await ctx.newPage()
    const errors = []
    pg.on('pageerror', (e) => errors.push(e.message))
    for (const path of PAGES) {
      const where = `${lang} ${w}px ${path}`
      try {
        await pg.goto(`${origin}${path}${path.includes('?') ? '&' : '?'}lang=${lang}`, { waitUntil: 'load' })
        await pg.waitForTimeout(900)
        await pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await pg.waitForTimeout(300)
        const m = await pg.evaluate(() => {
          const f = document.querySelector('footer') || document.querySelector('[role="contentinfo"]')
          if (!f) return { none: true }
          const cs = getComputedStyle(f), r = f.getBoundingClientRect()
          const rgb = (s) => (/rgba?\(([^)]+)\)/.exec(s) || [0, '0,0,0'])[1].split(',').slice(0, 4).map(Number)
          // the first opaque background up the tree, from the element itself (a pill button has its own fill)
          // composite every translucent layer over the next one up, until an opaque one (the page is white if none is)
          const effBg = (el) => {
            const layers = []
            for (let e = el; e; e = e.parentElement) {
              const c = rgb(getComputedStyle(e).backgroundColor), a = c.length > 3 ? c[3] : 1
              if (a > 0) layers.push([c[0], c[1], c[2], a])
              if (a >= 1) break
            }
            let out = [255, 255, 255]
            for (let i = layers.length - 1; i >= 0; i--) { const [r, g, b, a] = layers[i]; out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)] }
            return out
          }
          const bg = effBg(f)
          const links = [...f.querySelectorAll('a,button')].filter((a) => a.getClientRects().length).map((a) => {
            const b = a.getBoundingClientRect(), c = getComputedStyle(a)
            return { tag: a.tagName, text: (a.textContent || '').replace(/\s+/g, ' ').trim(), aria: a.getAttribute('aria-label') || '', href: a.getAttribute('href') || '', target: a.getAttribute('target') || '', rel: a.getAttribute('rel') || '',
              w: Math.round(b.width), h: Math.round(b.height), color: rgb(c.color), bg: effBg(a), size: parseFloat(c.fontSize), weight: c.fontWeight, hasImg: !!a.querySelector('img,svg') }
          })
          const texts = [...f.querySelectorAll('p,li,span,div,h2,h3,h4,small')].filter((e) => e.children.length === 0 && (e.textContent || '').trim()).map((e) => {
            const c = getComputedStyle(e)
            return { t: e.textContent.replace(/\s+/g, ' ').trim(), color: rgb(c.color), bg: effBg(e), size: parseFloat(c.fontSize), tag: e.tagName }
          })
          const imgs = [...f.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src') || '', alt: i.getAttribute('alt'), w: i.getBoundingClientRect().width }))
          return {
            tag: f.tagName, role: f.getAttribute('role') || '', top: Math.round(r.top + scrollY), height: Math.round(r.height), width: Math.round(r.width), sw: f.scrollWidth, cw: f.clientWidth,
            page: document.documentElement.scrollWidth, dir: cs.direction, align: cs.textAlign, bg, links, texts, imgs, text: (f.innerText || '').replace(/\s+/g, ' ').trim(), htmlLang: document.documentElement.lang,
            docH: document.documentElement.scrollHeight, lastBottom: Math.round(r.bottom + scrollY), headings: [...f.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => h.tagName + ':' + h.textContent.trim()),
          }
        })
        dump[where] = m
        if (m.none) { note('no-footer', 'no <footer> / role=contentinfo found').where.push(where); continue }
        if (m.tag !== 'FOOTER' && !m.role) note('landmark', 'the footer is not a <footer> element or role=contentinfo landmark').where.push(where)
        if (m.sw > m.cw + 1 || m.page > w + 1) note('overflow', 'the footer or the page scrolls sideways').where.push(`${where} (footer ${m.sw}/${m.cw}, page ${m.page})`)
        if (Math.abs(m.docH - m.lastBottom) > 140) note('below', 'there is more than 140px of page below the footer').where.push(`${where} (${m.docH - m.lastBottom}px)`)
        for (const l of m.links) {
          const name = l.text || l.aria
          if (!name) note('unnamed-link', 'a footer link or button has no text and no aria-label').where.push(`${where} ${l.href}`)
          if (l.tag === 'A' && (l.href === '' || l.href === '#' || /^javascript:/i.test(l.href))) note('dead-link', 'a footer link goes nowhere (empty, # or javascript:)').where.push(`${where} "${name}" href="${l.href}"`)
          if (w <= 500 && (l.h < 44 || l.w < 44) && !(l.w >= 44 && l.h >= 24)) note('tap-target', 'a footer link is smaller than 44x44 on a phone').where.push(`${where} "${name.slice(0, 30)}" ${l.w}x${l.h}`)
          if (l.target === '_blank' && !/noopener/.test(l.rel)) note('noopener', 'a link opens a new tab without rel=noopener').where.push(`${where} "${name}"`)
          if (/^https?:\/\//i.test(l.href) && !/sporta\.com\.kw|^https:\/\/wa\.me\/965[0-9]{8}$|instagram\.com\/sporta\.kw|tiktok\.com\/@sporta\.kw/.test(l.href)) note('external', 'external link that is not the shop\'s own WhatsApp, Instagram or TikTok').where.push(`${where} "${name}" -> ${l.href}`)
          if (/^tel:/.test(l.href) && !/^tel:\+?[0-9]+$/.test(l.href)) note('tel-shape', 'tel: link with spaces or symbols').where.push(`${where} ${l.href}`)
          if (/^mailto:/.test(l.href) && !/^mailto:[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(l.href)) note('mailto-shape', 'mailto: link that is not a plain address').where.push(`${where} ${l.href}`)
        }
        const seen = {}
        for (const l of m.links) { if (l.href && l.tag === 'A') { (seen[l.href] ||= []).push(l.text) } }
        for (const [h, t] of Object.entries(seen)) if (t.length > 1 && new Set(t).size < t.length) note('dup-link', 'the same link twice in the footer').where.push(`${where} ${h}`)
        for (const t of m.texts) {
          const r = ratio(t.color.slice(0, 3), t.bg)
          const need = t.size >= 18.66 ? 3 : 4.5
          if (r < need) note('contrast', 'footer text under WCAG AA').where.push(`${where} "${t.t.slice(0, 30)}" ${r.toFixed(2)}:1 at ${t.size}px`)
          if (t.size < 12) note('small-text', 'footer text under 12px').where.push(`${where} "${t.t.slice(0, 30)}" ${t.size}px`)
        }
        for (const l of m.links) {
          const r = ratio(l.color.slice(0, 3), l.bg)
          if (r < 4.5 && l.size < 18.66) note('link-contrast', 'footer link under WCAG AA').where.push(`${where} "${l.text.slice(0, 30)}" ${r.toFixed(2)}:1`)
        }
        for (const i of m.imgs) if (i.alt === null) note('img-alt', 'a footer image has no alt attribute').where.push(`${where} ${i.src}`)
        if (lang === 'ar') {
          if (/[٠-٩]/.test(m.text) && /[0-9]/.test(m.text.replace(/\+?965[0-9 ]*/g, '').replace(/[0-9]{4}/g, ''))) note('digits-mixed', 'the Arabic footer mixes Arabic-Indic and Western digits').where.push(where)
          const latinWords = (m.text.match(/[A-Za-z]{4,}/g) || []).filter((x) => !/^(Sporta|SPORTA|WhatsApp|Instagram|TikTok|Facebook|Snapchat|KNET|Visa|Mastercard|Apple|Google|Twitter|YouTube|www|sporta|http|https|com|kw)$/i.test(x))
          if (latinWords.length) note('english-in-arabic', 'English words in the Arabic footer').where.push(`${where}: ${[...new Set(latinWords)].slice(0, 6).join(', ')}`)
          if (m.dir !== 'rtl') note('dir', 'the Arabic footer is not direction rtl').where.push(where)
        } else if (m.dir !== 'ltr') note('dir', 'the English footer is not direction ltr').where.push(where)
        if (m.htmlLang && m.htmlLang.slice(0, 2) !== lang) note('html-lang', '<html lang> does not follow the page language').where.push(`${where} lang=${m.htmlLang}`)
      } catch (e) { note('probe-error', 'the probe could not read a page').where.push(`${where}: ${e.message.slice(0, 80)}`) }
    }
    if (errors.length) note('js-error', 'a page error').where.push(`${lang} ${w}px: ${[...new Set(errors)].slice(0, 2).join(' | ')}`)
    await ctx.close()
  }
}
// one clean reading of the footer's content (home, 1280) for the report
const homeAr = dump['ar 1280px /'], homeEn = dump['en 1280px /']
console.log('--- footer content, home page, 1280px')
for (const [n, d] of [['ar', homeAr], ['en', homeEn]]) {
  if (!d || d.none) { console.log(n, ': no footer'); continue }
  console.log(`[${n}] height ${d.height}px, headings: ${d.headings.join(' | ') || '(none)'}`)
  console.log(`[${n}] text: ${d.text.slice(0, 700)}`)
  console.log(`[${n}] links (${d.links.length}): ${d.links.map((l) => `${(l.text || l.aria || '?').slice(0, 24)} -> ${l.href || '(button)'}`).join(' ; ')}`)
}
console.log('\n--- findings')
if (!findings.size) console.log('none')
for (const [k, f] of findings) {
  const uniq = [...new Set(f.where)]
  console.log(`FINDING ${k}: ${f.msg} (${uniq.length} place${uniq.length === 1 ? '' : 's'})`)
  for (const w of uniq.slice(0, 6)) console.log('    ' + w)
  if (uniq.length > 6) console.log(`    ... and ${uniq.length - 6} more`)
}
await browser.close()
server.close && server.close()
process.exit(0)
