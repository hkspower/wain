// READ-ONLY probe of the REGCONTACT section on the LIVE site: /account (register form) and /contact, ar and en, 390 and
// 1280px. Loads pages and reads the DOM; clicks nothing, types nothing, sends nothing.
import { chromium } from 'playwright'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const b = await chromium.launch()
for (const lang of ['ar', 'en']) for (const w of [390, 1280]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 2400 } })
  const p = await ctx.newPage()
  const q = lang === 'en' ? '?lang=en' : ''
  await p.goto(B + '/account' + q, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  const a = await p.evaluate(() => {
    const R = (e) => e ? e.getBoundingClientRect() : null
    const bday = document.querySelector('.sporta-bday'), email = document.querySelector('#customer-email')
    const ef = email && email.closest('.customer-account__field')
    const sel = [...document.querySelectorAll('.sporta-bday select')].map((e) => Math.round(R(e).height))
    const sw = document.querySelector('.customer-account__card > .customer-account__switch'), sup = document.querySelector('.customer-account__support')
    return { gap: bday && ef ? Math.round(R(ef).top - R(bday).bottom) : null, sel: sel.join('/'), input: Math.round(R(document.querySelector('#customer-name')).height),
      divider: sw ? getComputedStyle(sw).borderTopWidth : null, help: sup ? getComputedStyle(sup).textDecorationLine + ' ' + getComputedStyle(sup).fontSize : null,
      overflow: document.documentElement.scrollWidth - innerWidth }
  })
  await p.goto(B + '/contact' + q, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  const c = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.support-card')]
    const div = cards.filter((x) => x.tagName === 'DIV').map((x) => x.getBoundingClientRect())
    const hit = cards.map((x) => { const r = x.getBoundingClientRect(), l = x.querySelector(':scope > a:last-child'); const e = document.elementFromPoint(r.left + 14, r.top + 14); return !!e && !!l && (e === l || l.contains(e)) })
    const mail = cards.find((x) => x.querySelector(':scope > a[href^="mailto:"]'))
    return { div: div.map((r) => Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)).join(' | '), hit: hit.join(','),
      mailIcon: mail ? getComputedStyle(mail.querySelector('svg')).display + ' ' + (getComputedStyle(mail, '::before').maskImage || '').slice(0, 30) : null, overflow: document.documentElement.scrollWidth - innerWidth }
  })
  console.log('ACCOUNT ' + lang + ' ' + w + ' ' + JSON.stringify(a))
  console.log('CONTACT ' + lang + ' ' + w + ' ' + JSON.stringify(c))
  await ctx.close()
}
await b.close()
console.log('PROBE_DONE')
