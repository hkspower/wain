import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const CF = JSON.parse(process.env.CFG || '{}')
const log = (...a) => console.log(a.join(' '))
const J = (o) => JSON.stringify(o)
const br = await chromium.launch({ args: ['--no-sandbox'] })
const lang = CF.lang || 'ar'
const vw = CF.vw || 1280
const ctx = await br.newContext({ viewport: { width: vw, height: 800 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
await ctx.route('**/*', (r) => { const q = r.request(); if (!['GET', 'HEAD'].includes(q.method()) || /\/(backends|knet\/|pay\/)/.test(q.url())) return r.abort(); return r.continue() })
const pg = await ctx.newPage()
const U = (p) => B + p + (lang === 'en' ? (p.includes('?') ? '&' : '?') + 'lang=en' : '')
const go = async (p) => { await pg.goto(U(p), { waitUntil: 'load', timeout: 90000 }); await pg.waitForTimeout(2200) }
const chain = () => {
  const out = []
  const re = /نفذت|sold out/i
  const sp = [...document.querySelectorAll('span.absolute')].find((s) => re.test(s.textContent.trim()) && s.closest('a'))
  if (!sp) return ['no sold-out span']
  for (let el = sp, i = 0; el && i < 6; el = el.parentElement, i++) {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    const b = getComputedStyle(el, '::before'); const a = getComputedStyle(el, '::after')
    out.push([el.tagName.toLowerCase() + '.' + [...el.classList].slice(0, 6).join('.'), 'pos=' + cs.position, 'bg=' + cs.backgroundColor, 'bgi=' + cs.backgroundImage.slice(0, 60), 'op=' + cs.opacity, 'col=' + cs.color, 'rect=' + [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(','), 'bef=' + b.content + '/' + b.backgroundColor, 'aft=' + a.content + '/' + a.backgroundColor, 'bf=' + cs.backdropFilter.slice(0, 20), 'z=' + cs.zIndex].join(' '))
  }
  const card = sp.closest('a')
  const im = card && card.querySelector('img')
  out.push('IMG ' + (im ? [im.currentSrc.slice(-50), im.naturalWidth + 'x' + im.naturalHeight, 'complete=' + im.complete, getComputedStyle(im).opacity, getComputedStyle(im).filter].join(' ') : 'none'))
  out.push('SIBLINGS ' + JSON.stringify([...sp.parentElement.children].map((c) => c.tagName.toLowerCase() + '.' + [...c.classList].slice(0, 4).join('.') + ':' + getComputedStyle(c).backgroundColor + ':' + getComputedStyle(c).backgroundImage.slice(0, 50))))
  return out
}

const stack = () => {
  const out = []
  const re = /\u0646\u0641\u0630\u062a|sold out/i
  const sps = [...document.querySelectorAll('span.absolute')].filter((s) => re.test(s.textContent.trim()) && s.closest('a')).slice(0, 3)
  for (const sp of sps) {
    sp.scrollIntoView({ block: 'center' })
    const r = sp.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    const card = sp.closest('article')
    const img = card && card.querySelector('img.catalog-card-photo')
    out.push(JSON.stringify({ label: Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height), hit: hit ? hit.tagName.toLowerCase() + '.' + [...hit.classList].slice(0, 4).join('.') : null, hitIsLabel: hit === sp || sp.contains(hit), imgZ: img ? getComputedStyle(img).zIndex + '/' + getComputedStyle(img).position + '/' + (img.currentSrc || '').slice(-34) : 'noimg', imgOpacity: img ? getComputedStyle(img).opacity : null }))
  }
  return out
}
const hero = () => {
  const out = []
  const h = document.querySelector('.campaign-photo-hero')
  if (!h) return ['no hero']
  const R = (e) => { if (!e) return 'none'; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',') }
  const root = h.parentElement
  out.push('HEROROOT ' + root.tagName.toLowerCase() + '.' + [...root.classList].slice(0, 4).join('.') + ' ' + R(root))
  for (const s of root.querySelectorAll('.campaign-photo-hero')) {
    const sc = s.querySelector('.campaign-photo-hero-scrim'); const cp = s.querySelector('.campaign-hero-copy'); const im = s.querySelector('img')
    const op = getComputedStyle(s).opacity
    if (+op < 0.5) continue
    out.push('SLIDE ' + [...s.classList].join('.').slice(0, 90) + ' rect=' + R(s) + ' op=' + op + ' vis=' + getComputedStyle(s).visibility + ' scrim=' + (sc ? getComputedStyle(sc).backgroundImage.slice(0, 120) : 'none') + ' scrimRect=' + R(sc) + ' copy=' + R(cp) + ' img=' + (im ? im.currentSrc.slice(-40) + ' ' + im.naturalWidth + 'x' + im.naturalHeight + ' of=' + getComputedStyle(im).objectFit + '/' + getComputedStyle(im).objectPosition : 'none') + ' title=' + R(s.querySelector('.campaign-hero-title')) + ' sub=' + R(s.querySelector('.campaign-hero-sub')))
  }
  return out
}
try {
  if (CF.task === 'sold') { await go('/shop'); for (const l of await pg.evaluate(chain)) log('SOLD', l) }
  if (CF.task === 'sold2') { await go('/shop'); for (const l of await pg.evaluate(stack)) log('STACK', l) }
  if (CF.task === 'hero') {
    await go('/')
    await pg.evaluate(() => { const p = [...document.querySelectorAll('button')].find((x) => /pause|إيقاف/i.test(x.getAttribute('aria-label') || '')); if (p) p.click() })
    const n = await pg.evaluate(() => document.querySelectorAll('button[class*="group/dot"]').length)
    for (let i = 0; i < n; i++) {
      await pg.evaluate((k) => { document.querySelectorAll('button[class*="group/dot"]')[k].click() }, i)
      await pg.waitForTimeout(1100)
      log('HERO' + (i + 1), J(await pg.evaluate(hero)))
    }
  }
} catch (e) { log('FAIL', String(e.message).slice(0, 300)) }
await br.close()
log('DONE')
