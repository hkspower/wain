// READ-ONLY padding audit of the LIVE storefront. For every page x language x width it reads computed padding of the header,
// main's content column, the first and last sections (space under the header / above the footer), cards, buttons, inputs and
// the footer, and prints compact lines plus a final table of VALUES that differ between pages for the same role (the places
// where one page breathes differently from the others). GET only; nothing is clicked or typed.
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const out = (s) => console.log(s)
let slug = ''
try { const j = await (await fetch(B + '/api/api.php?r=products')).json(); slug = '/product/' + (j.products || j)[0].slug } catch (e) {}
const PAGES = ['/', '/shop', slug, '/about', '/contact', '/returns', '/support', '/track', '/cart', '/account', '/privacy', '/terms', '/wishlist'].filter(Boolean)
const browser = await chromium.launch()
const roles = {}   // role -> value -> [labels]
const add = (role, val, label) => { ((roles[role] ||= {})[val] ||= []).push(label) }
for (const lang of ['ar', 'en']) for (const w of [390, 768, 1280]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const p = await ctx.newPage()
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  for (const path of PAGES) {
    await p.goto(B + path + (lang === 'en' ? (path.includes('?') ? '&' : '?') + 'lang=en' : ''), { waitUntil: 'networkidle' }).catch(() => {})
    await p.waitForTimeout(700)
    const d = await p.evaluate(() => {
      const px = (v) => Math.round(parseFloat(v) || 0)
      const P = (e) => { const s = getComputedStyle(e); return px(s.paddingTop) + '/' + px(s.paddingInlineEnd) + '/' + px(s.paddingBottom) + '/' + px(s.paddingInlineStart) }
      const R = (e) => e.getBoundingClientRect()
      const vis = (e) => { const r = R(e); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
      const header = document.querySelector('header'), main = document.querySelector('main'), footer = document.querySelector('footer')
      const o = { hdr: header ? P(header) + ' h' + Math.round(R(header).height) : null, ftr: footer ? P(footer) : null }
      if (main) {
        const kids = [...main.children].filter(vis)
        const first = kids[0], last = kids[kids.length - 1]
        o.main = P(main)
        o.firstChild = first ? first.tagName + '.' + (first.className || '').toString().split(' ')[0] + ' ' + P(first) + ' topGapFromHeader ' + Math.round(R(first).top + scrollY - (header ? R(header).bottom + scrollY : 0)) : null
        o.lastChild = last ? last.tagName + '.' + (last.className || '').toString().split(' ')[0] + ' ' + P(last) + ' bottomGapToFooter ' + (footer ? Math.round(R(footer).top + scrollY - (R(last).bottom + scrollY)) : '-') : null
        // gutter: the inline-start inset of the main column's content
        const cw = document.documentElement.clientWidth
        o.gutter = first ? Math.round(document.documentElement.dir === 'rtl' ? cw - R(first).right : R(first).left) + '/' + Math.round(document.documentElement.dir === 'rtl' ? R(first).left : cw - R(first).right) : null
      }
      const sets = (sel, max = 40) => [...new Set([...document.querySelectorAll(sel)].filter(vis).slice(0, max).map(P))]
      o.cards = sets('.card, .purchase-panel, .why-card, .support-card, .catalog-card-info, .faq-list details, [class*="rounded-2xl"][class*="border"]')
      o.btn = sets('.btn, button.btn-primary, a.btn-primary, .btn-ghost')
      o.input = sets('main input:not([type=checkbox]):not([type=radio]), main select, main textarea')
      return o
    })
    const label = lang + '@' + w + ' ' + path
    out('== ' + label + ' hdr ' + d.hdr + ' | main ' + d.main + ' | gutter ' + d.gutter + ' | first ' + d.firstChild + ' | last ' + d.lastChild + ' | ftr ' + d.ftr)
    out('   cards ' + JSON.stringify(d.cards) + ' btn ' + JSON.stringify(d.btn) + ' input ' + JSON.stringify(d.input))
    add('gutter@' + lang + w, d.gutter, path); add('header@' + w, d.hdr, path); add('footer@' + w, d.ftr, path); add('main-pad@' + w, d.main, path)
    for (const c of d.cards || []) add('card@' + w, c, path); for (const c of d.btn || []) add('btn@' + w, c, path); for (const c of d.input || []) add('input@' + w, c, path)
  }
  await ctx.close()
}
out('\n#### VALUES BY ROLE (padding top/inline-end/bottom/inline-start; pages listed per value)')
for (const [role, vals] of Object.entries(roles)) {
  const e = Object.entries(vals)
  if (e.length < 2) continue
  out(role + ': ' + e.map(([v, pg]) => v + ' x' + pg.length + (pg.length <= 3 ? ' (' + [...new Set(pg)].join(',') + ')' : '')).join(' ; '))
}
await browser.close()
out('PROBE_DONE')
