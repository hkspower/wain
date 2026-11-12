// Mobile audit of the CAPTURED LIVE storefront pages (scripts/lib/shape-pages.mjs: home, about, terms, cart, checkout, bag drawer,
// product, /shop, contact, /account, /support, /returns, /track, quick checkout) under the LIVE compiled rules and the repo's add-ons,
// at phone sizes. Read-only, prints findings; it asserts nothing (the proof of each fix is scripts/mobile-1112-test.mjs).
//   node scripts/mobile-1112-audit.mjs            ONLY=<page ids>  SIZES=320x640,...  THEMES=light,dark  ADDON_FILE=<shadows css>
// Per page, language, theme and size: sideways scroll, tap targets under 44px (visible, own box), text under 14px, form fields
// (font size under 16px = iOS zoom on focus, type / inputmode / autocomplete), and fixed/sticky bars against an emulated notch and
// home bar (--sa-top 47, --sa-bottom 34; --sa-left/right 47 when landscape).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { PAGES, start, FILE } from './lib/shape-pages.mjs'

const CSS = readFileSync(process.env.ADDON_FILE || FILE, 'utf8')
const SIZES = (process.env.SIZES || '320x640,360x740,390x844,430x932,844x390').split(',').map((s) => s.split('x').map(Number))
const THEMES = (process.env.THEMES || 'light,dark').split(',')
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const pages = PAGES.filter((p) => !ONLY || ONLY.includes(p.id))

const probe = (land) => {
  const r = document.documentElement
  r.style.setProperty('--sa-top', '47px'); r.style.setProperty('--sa-bottom', '34px')
  if (land) { r.style.setProperty('--sa-left', '47px'); r.style.setProperty('--sa-right', '47px') }
  const vw = r.clientWidth, vh = innerHeight
  const name = (e) => {
    const t = (e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28)
    const c = (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter((x) => x && !/[:\[\/]/.test(x)).slice(0, 3).join('.')
    return `${e.tagName.toLowerCase()}${c ? '.' + c : ''}${t ? ' "' + t + '"' : ''}`
  }
  const hidden = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden' || c.opacity === '0') return true; if (n.getAttribute('aria-hidden') === 'true' && n !== e) return true } return false }
  const out = { docW: r.scrollWidth - vw, taps: [], small: [], fields: [], bars: [], over: [] }
  document.querySelectorAll('a[href], button, summary, select, textarea, input:not([type=hidden]), [role="button"], [role="option"], label:has(> input[type=checkbox]), label:has(> input[type=radio])').forEach((e) => {
    const b = e.getBoundingClientRect()
    if (b.width < 2 || b.height < 2 || hidden(e)) return
    if (e.matches('input[type=checkbox], input[type=radio]') && e.closest('label')) return
    if (e.closest('.sr-only') || (b.width <= 1)) return
    if (e.closest('[inert]')) return
    // hit area: what elementFromPoint answers around the centre (a ::after hit area counts)
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2
    const hit = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h)) }
    let hh = b.height, ww = b.width
    if (cy > 0 && cy < vh) {
      let up = 0, dn = 0, lf = 0, rt = 0
      while (up < 30 && hit(cx, b.top - up - 1)) up++
      while (dn < 30 && hit(cx, b.bottom + dn + 1)) dn++
      while (lf < 30 && hit(b.left - lf - 1, cy)) lf++
      while (rt < 30 && hit(b.right + rt + 1, cy)) rt++
      hh += up + dn; ww += lf + rt
    }
    const inline = getComputedStyle(e).display === 'inline' && e.closest('p, li > p, .legal-page__body, .editorial-page p')
    if ((hh < 43.5 || ww < 43.5) && !inline) out.taps.push(`${name(e)} ${Math.round(ww)}x${Math.round(hh)} @${Math.round(b.left)},${Math.round(b.top + scrollY)}`)
  })
  document.querySelectorAll('body *').forEach((e) => {
    if (e.closest('svg') || e.closest('.sr-only')) return
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim())
    if (!own) return
    const b = e.getBoundingClientRect(); if (b.width < 2 || hidden(e)) return
    const fs = parseFloat(getComputedStyle(e).fontSize)
    if (fs < 13.95) out.small.push(`${name(e)} ${fs.toFixed(1)}px`)
    if (b.right > vw + 0.5 || b.left < -0.5) { let clip = false; for (let n = e.parentElement; n; n = n.parentElement) { const c = getComputedStyle(n); if (/(hidden|auto|scroll|clip)/.test(c.overflowX)) { clip = true; break } } if (!clip) out.over.push(`${name(e)} ${Math.round(b.left)}..${Math.round(b.right)}`) }
  })
  document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea').forEach((e) => {
    const b = e.getBoundingClientRect(); if (b.width < 2 || hidden(e)) return
    const c = getComputedStyle(e)
    out.fields.push({ n: name(e), id: e.id || e.name, fs: parseFloat(c.fontSize), type: e.getAttribute('type') || e.tagName.toLowerCase(), im: e.getAttribute('inputmode') || '', ac: e.getAttribute('autocomplete') || '', h: Math.round(b.height), enter: e.getAttribute('enterkeyhint') || '' })
  })
  document.querySelectorAll('body *').forEach((e) => {
    const c = getComputedStyle(e)
    if (c.position !== 'fixed' && c.position !== 'sticky') return
    const b = e.getBoundingClientRect(); if (b.width < 50 || b.height < 20 || hidden(e)) return
    const kids = [...e.querySelectorAll('a,button,input')].filter((k) => { const q = k.getBoundingClientRect(); return q.width > 2 && !hidden(k) }).map((k) => k.getBoundingClientRect())
    const minL = kids.length ? Math.min(...kids.map((q) => q.left)) : null, maxR = kids.length ? Math.max(...kids.map((q) => q.right)) : null, maxB = kids.length ? Math.max(...kids.map((q) => q.bottom)) : null, minT = kids.length ? Math.min(...kids.map((q) => q.top)) : null
    out.bars.push(`${name(e).slice(0, 50)} ${c.position} y${Math.round(b.top)}-${Math.round(b.bottom)} h${Math.round(b.height)} ctl[${minL && Math.round(minL)}..${maxR && Math.round(maxR)}, ${minT && Math.round(minT)}..${maxB && Math.round(maxB)}] pb${c.paddingBottom} pt${c.paddingTop}`)
  })
  return out
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const S = await start(browser)
for (const pg of pages) for (const lang of ['ar', 'en']) for (const theme of THEMES) for (const [w, h] of SIZES) {
  if (pg.kind === 'prd' && ![320, 360, 390].includes(w)) continue
  let o
  try {
    const { p, ctx } = await S.open(pg, lang, w, CSS, { theme, h })
    o = await p.evaluate(probe, w > h)
    await ctx.close()
  } catch (e) { console.log(`${pg.id} ${lang} ${theme} ${w}x${h}: ERROR ${e.message.split('\n')[0]}`); continue }
  const uniq = (a) => [...new Set(a)]
  console.log(`\n## ${pg.id} ${lang} ${theme} ${w}x${h}  sideways ${o.docW}px`)
  if (o.over.length) console.log('  over-edge: ' + uniq(o.over).slice(0, 8).join(' | '))
  if (o.taps.length) console.log('  taps<44: ' + uniq(o.taps).slice(0, 40).join('\n           '))
  if (o.small.length) console.log('  text<14: ' + uniq(o.small).slice(0, 30).join(' | '))
  const bad = o.fields.filter((f) => f.fs < 16)
  if (bad.length) console.log('  field<16px: ' + bad.map((f) => `${f.n} ${f.fs}`).join(' | '))
  if (o.fields.length && w === 390 && theme === 'light') console.log('  fields: ' + o.fields.map((f) => `${f.id}[${f.type}${f.im ? ' im=' + f.im : ''}${f.ac ? ' ac=' + f.ac : ''}${f.enter ? ' ek=' + f.enter : ''} h${f.h} ${f.fs}px]`).join(' '))
  if (o.bars.length) console.log('  bars: ' + o.bars.join('\n        '))
}
S.close()
await browser.close()
