// READ-ONLY probe of the LIVE site: (1) HTTPS: certificate, redirects, HSTS, security headers, mixed content;
// (2) the About page (من نحن) in ar and en: status, h1/headings, text, images, links, overflow, console errors;
// (3) the "مميزات سبورتا" / features content on / and /about: where it appears, items, text, links, tap sizes.
// GET only; nothing is clicked, typed or submitted. Run on the VPS in mcr.microsoft.com/playwright:v1.49.0-noble.
import tls from 'node:tls'
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
const out = (s) => process.stdout.write(s + '\n')
// 1. certificate and TLS
await new Promise((res) => {
  const s = tls.connect({ host: 'www.sporta.com.kw', port: 443, servername: 'www.sporta.com.kw' }, () => {
    const c = s.getPeerCertificate()
    const days = Math.round((new Date(c.valid_to) - new Date()) / 864e5)
    out('CERT subject ' + (c.subject && c.subject.CN) + ' issuer ' + (c.issuer && c.issuer.O) + ' valid_to ' + c.valid_to + ' (' + days + ' days) SAN ' + String(c.subjectaltname).slice(0, 80))
    out('TLS ' + s.getProtocol() + ' cipher ' + s.getCipher().name)
    s.end(); res()
  })
  s.on('error', (e) => { out('TLS_ERR ' + e.message); res() })
})
const hop = async (u) => { const r = await fetch(u, { redirect: 'manual' }); return r.status + ' ' + (r.headers.get('location') || '') }
for (const u of ['http://www.sporta.com.kw/about', 'http://sporta.com.kw/', 'https://sporta.com.kw/about', 'http://187.7.78.123/']) { try { out('REDIR ' + u + ' -> ' + (await hop(u))) } catch (e) { out('REDIR ' + u + ' ERR ' + e.message) } }
const r1 = await fetch(B + '/about')
const H = (k) => r1.headers.get(k)
out('HEADERS hsts=' + H('strict-transport-security') + ' | xcto=' + H('x-content-type-options') + ' | xfo=' + H('x-frame-options') + ' | refpol=' + H('referrer-policy') + ' | perm=' + H('permissions-policy'))
out('CSP ' + String(H('content-security-policy')).slice(0, 300))
out('CACHE ' + H('cache-control') + ' | enc ' + H('content-encoding') + ' | server ' + H('server') + ' | xpb ' + H('x-powered-by') + ' | http2? ' + (r1.headers.get('alt-svc') || 'n/a'))
const browser = await chromium.launch()
const PAGES = [['/', 'ar'], ['/about', 'ar'], ['/about', 'en'], ['/', 'en']]
for (const [path, lang] of PAGES) for (const w of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const p = await ctx.newPage()
  const errs = [], mixed = [], bad = []
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
  p.on('pageerror', (e) => errs.push('PAGEERR ' + String(e).slice(0, 120)))
  p.on('request', (rq) => { if (rq.url().startsWith('http://')) mixed.push(rq.url().slice(0, 100)) })
  p.on('response', (rs) => { if (rs.status() >= 400) bad.push(rs.status() + ' ' + rs.url().replace(B, '').slice(0, 90)) })
  await p.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
  await p.goto(B + path + (lang === 'en' ? '?lang=en' : ''), { waitUntil: 'networkidle' }).catch(() => {})
  await p.waitForTimeout(1200)
  const d = await p.evaluate(() => {
    const t = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim()
    const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
    const heads = [...document.querySelectorAll('h1,h2,h3')].filter(vis).map((h) => h.tagName + ':' + t(h).slice(0, 60))
    const feat = [...document.querySelectorAll('[class*="feature"],[class*="why-card"]')].filter(vis).map((e) => e.className.toString().split(' ')[0] + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height) + ' "' + t(e).slice(0, 70) + '"')
    const find = [...document.querySelectorAll('h1,h2,h3,h4,p,span,div')].filter((e) => e.children.length === 0 && /مميزات سبورتا|Why Sporta|Sporta features|من نحن|About/i.test(t(e)) && vis(e)).slice(0, 6).map((e) => e.tagName + '.' + e.className.toString().slice(0, 30) + ' "' + t(e).slice(0, 60) + '"')
    const imgs = [...document.images].filter(vis).map((i) => ({ s: i.currentSrc.slice(-50), ok: i.complete && i.naturalWidth > 0, alt: i.alt }))
    const links = [...document.querySelectorAll('main a[href]')].filter(vis).map((a) => ({ h: a.getAttribute('href'), w: Math.round(a.getBoundingClientRect().width), hh: Math.round(a.getBoundingClientRect().height) }))
    const main = document.querySelector('main')
    return { title: document.title, h1: [...document.querySelectorAll('h1')].map(t), heads, feat, find, imgsBad: imgs.filter((i) => !i.ok).length, imgsNoAlt: imgs.filter((i) => !i.alt).length, imgs: imgs.length, linksSmall: links.filter((l) => l.hh < 44).length, links: links.length, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth, dir: document.documentElement.dir, lang: document.documentElement.lang, canon: (document.querySelector('link[rel=canonical]') || {}).href, mainText: main ? t(main).length : 0, mainSample: main ? t(main).slice(0, 200) : '' }
  })
  out('== ' + path + ' ' + lang + ' ' + w + ' title="' + d.title + '" dir=' + d.dir + ' lang=' + d.lang + ' canon=' + d.canon)
  out('   h1=' + JSON.stringify(d.h1) + ' headings=' + JSON.stringify(d.heads.slice(0, 14)))
  out('   FIND ' + JSON.stringify(d.find))
  out('   FEATURES(' + d.feat.length + ') ' + JSON.stringify(d.feat.slice(0, 8)))
  out('   imgs ' + d.imgs + ' broken ' + d.imgsBad + ' noAlt ' + d.imgsNoAlt + ' | links ' + d.links + ' under44px ' + d.linksSmall + ' | sideways ' + d.sideways + ' | mainText ' + d.mainText)
  out('   mixed=' + (mixed.join(' ') || 'none') + ' | http>=400: ' + (bad.join(' ; ') || 'none') + ' | console: ' + (errs.join(' ; ') || 'none'))
  if (w === 390) out('   SAMPLE ' + d.mainSample)
  await ctx.close()
}
await browser.close()
out('PROBE_DONE')
