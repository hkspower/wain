// READ-ONLY audit of border-radius ("round border box shape") on the LIVE storefront: every visible box that has a border, a
// background that differs from its parent, or a shadow, grouped by role, with its computed radius (all four corners), size and
// where it sits. Prints the distinct radius values per role and the pages/elements that break the pattern.
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const out = (s) => console.log(s)
let slug = ''
try { const j = await (await fetch(B + '/api/api.php?r=products')).json(); slug = '/product/' + (j.products || j)[0].slug } catch (e) {}
const PAGES = ['/', '/shop', slug, '/about', '/contact', '/returns', '/support', '/track', '/cart', '/account', '/checkout'].filter(Boolean)
const browser = await chromium.launch()
const roles = {}
const add = (role, val, label) => { ((roles[role] ||= {})[val] ||= []).push(label) }
for (const lang of ['ar', 'en']) for (const w of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  for (const path of PAGES) {
    await p.goto(B + path + (lang === 'en' ? (path.includes('?') ? '&' : '?') + 'lang=en' : ''), { waitUntil: 'networkidle' }).catch(() => {})
    await p.waitForTimeout(700)
    const rows = await p.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width >= 24 && r.height >= 16 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0 }
      const role = (e) => {
        const t = e.tagName, c = (e.className || '').toString()
        if (t === 'BUTTON' || /(^|\s)btn(\s|-|$)/.test(c) || e.getAttribute('role') === 'button') return 'button'
        if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return 'field'
        if (t === 'IMG') return 'image'
        if (/category-tile|campaign-category/.test(c)) return 'category-tile'
        if (/product-grid-card|catalog-card/.test(c)) return 'product-card'
        if (/badge|chip|pill|catalog-card-badge|footer-payment/.test(c)) return 'badge/chip'
        if (/card|panel|why-card|support-card|purchase-panel|faq|details/.test(c) || t === 'DETAILS' || t === 'ARTICLE') return 'card/panel'
        if (t === 'SECTION' || t === 'ASIDE' || t === 'FORM') return 'section/box'
        return 'other'
      }
      const out = []
      for (const e of document.querySelectorAll('body *')) {
        if (!vis(e)) continue
        const s = getComputedStyle(e)
        const hasBorder = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none'
        const hasShadow = s.boxShadow !== 'none'
        const bg = s.backgroundColor, pbg = e.parentElement ? getComputedStyle(e.parentElement).backgroundColor : ''
        const hasBg = bg !== 'rgba(0, 0, 0, 0)' && bg !== pbg
        if (!(hasBorder || hasShadow || hasBg || e.tagName === 'IMG')) continue
        const r = e.getBoundingClientRect()
        const tl = s.borderTopLeftRadius, tr = s.borderTopRightRadius, br = s.borderBottomRightRadius, bl = s.borderBottomLeftRadius
        const rad = tl === tr && tr === br && br === bl ? tl : [tl, tr, br, bl].join(' ')
        const full = r.width > 1400
        if (full) continue
        out.push({ role: role(e), rad, w: Math.round(r.width), h: Math.round(r.height), cls: (e.className || '').toString().split(' ')[0].slice(0, 30), tag: e.tagName.toLowerCase(), pill: parseFloat(tl) >= Math.min(r.width, r.height) / 2 - 0.5 })
      }
      return out
    })
    for (const r of rows) add(r.role, r.rad + (r.pill ? ' (pill)' : ''), r.tag + '.' + r.cls + ' ' + r.w + 'x' + r.h + ' @' + lang + w + path)
  }
  await ctx.close()
}
for (const [role, vals] of Object.entries(roles)) {
  const e = Object.entries(vals).sort((a, b) => b[1].length - a[1].length)
  out('#### ' + role + ' — ' + e.length + ' distinct radii')
  for (const [v, ex] of e.slice(0, 8)) out('   ' + v + ' x' + ex.length + '  e.g. ' + ex[0] + (ex.length > 1 ? ' | ' + ex[Math.floor(ex.length / 2)] : ''))
}
await browser.close()
out('PROBE_DONE')
