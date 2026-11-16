// Centring probe for the product photo viewer and gallery (read-only measurement, not a suite).
//   node scripts/viewer-centring-probe.mjs
// Opens the full-screen viewer on the four-photo product (the live gallery excerpt, the same harness as
// test:images-viewer) at 390, 768 and 1280 px, Arabic and English, and prints how far each element's centre sits from the
// centre of the screen (or of the photo frame it belongs to), in CSS pixels.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as G from './lib/gallery-page.mjs'
import * as PRD from './lib/sizes-product-page.mjs'

const ROOT = G.ROOT
const SH = readFileSync(join(ROOT, 'public/sporta-shadows.css'), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

const PHOTOS = []
{
  const p = await browser.newPage()
  for (const garment of ['rgb(28,36,64)', 'rgb(120,30,40)', 'rgb(40,90,50)', 'rgb(90,70,30)']) {
    PHOTOS.push(Buffer.from(await p.evaluate((garment) => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 900
      const x = c.getContext('2d')
      x.fillStyle = 'rgb(195,192,184)'; x.fillRect(0, 0, 900, 900)
      x.fillStyle = garment; x.fillRect(250, 200, 400, 520)
      return c.toDataURL('image/jpeg', 0.92).split(',')[1]
    }, garment), 'base64'))
  }
  await p.close()
}
const photoFor = (path) => { const m = path.match(/view-(\d)/); return PHOTOS[m ? +m[1] - 1 : 0] }
const PLATE = readFileSync(join(ROOT, 'public/product-photo-unavailable.svg'))
const ref = { current: null }
const srv = await G.serve(ref)
const ALT = { en: 'Denver Nuggets Cap — Navy', ar: 'قبعة دنفر ناغتس — كحلي' }
const DEV = {
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  768: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  1280: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
}

async function open(lang, w) {
  const ctx = await browser.newContext(DEV[w])
  const p = await ctx.newPage()
  await p.route('**/images/products/**', (r) => r.fulfill({ status: 200, contentType: 'image/jpeg', body: photoFor(new URL(r.request().url()).pathname) }))
  await p.route('**/product-photo-unavailable.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: PLATE }))
  ref.current = { addons: { ...PRD.addonFiles(), 'sporta-shadows.css': SH }, extra: G.extraCss() }
  await p.goto(`${srv.base}/__gx/full-${lang}-${w}`)
  await p.addScriptTag({ content: readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8') })
  await p.evaluate(([images, alt, lang]) => window.__fxMount({ images, alt, lang }), [G.SETS.multi.images, ALT[lang], lang])
  await p.waitForTimeout(400)
  if (DEV[w].hasTouch) await p.tap('.catalog-gallery-stage', { force: true }); else await p.click('.catalog-gallery-stage', { force: true })
  await p.waitForSelector('.catalog-product-lightbox', { timeout: 5000 }).catch(() => {})
  await p.waitForTimeout(400)
  return { p, ctx }
}

const measure = (p) => p.evaluate(() => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height } }
  const vw = innerWidth, vh = innerHeight
  const box = document.querySelector('.catalog-product-lightbox')
  const img = box && box.querySelector(':scope > img')
  const byClass = (c) => box && box.querySelector(':scope > .' + c)
  const counter = box && box.querySelector(':scope > p:not(.sporta-viewer-hint)')
  const close = box && box.querySelector(':scope > button:not(.sporta-viewer-btn)')
  const bar = byClass('sporta-viewer-zoombar')
  const prev = byClass('sporta-viewer-prev'), next = byClass('sporta-viewer-next'), zoom = byClass('sporta-viewer-zoom')
  const stage = document.querySelector('.catalog-gallery-stage')
  const stageImg = stage && stage.querySelector('.catalog-gallery-track > img, img')
  return {
    vw, vh,
    lightboxPhoto: R(img), counter: R(counter), close: R(close), zoomBtn: R(zoom), bar: R(bar), prev: R(prev), next: R(next),
    stage: R(stage), stageImg: R(stageImg),
    counterVisible: counter ? getComputedStyle(counter).display !== 'none' : null,
    dir: document.documentElement.getAttribute('dir'),
  }
})

const dx = (r, vw) => (r ? +(r.cx - vw / 2).toFixed(1) : null)
const dy = (r, vh) => (r ? +(r.cy - vh / 2).toFixed(1) : null)

for (const w of [390, 768, 1280]) for (const lang of ['en', 'ar']) {
  const o = await open(lang, w)
  const m = await measure(o.p)
  const rows = {
    'photo (whole, lightbox)': [dx(m.lightboxPhoto, m.vw), dy(m.lightboxPhoto, m.vh)],
    'zoom bar': [dx(m.bar, m.vw), dy(m.bar, m.vh)],
    'counter': [dx(m.counter, m.vw), dy(m.counter, m.vh)],
    'previous (vertical)': [null, dy(m.prev, m.vh)],
    'next (vertical)': [null, dy(m.next, m.vh)],
  }
  console.log(`\n${w}px ${lang} dir=${m.dir} viewport ${m.vw}x${m.vh}`)
  for (const [k, [x, y]] of Object.entries(rows)) console.log(`  ${k.padEnd(26)} x ${x === null ? '  -  ' : String(x).padStart(7)}  y ${y === null ? '  -  ' : String(y).padStart(7)}`)
  console.log(`  close  l/r ${m.close && m.close.l.toFixed(1)}/${m.close && (m.vw - m.close.r).toFixed(1)}  t ${m.close && m.close.t.toFixed(1)}   zoom btn t ${m.zoomBtn && m.zoomBtn.t.toFixed(1)}  ${m.zoomBtn && (m.vw - m.zoomBtn.r).toFixed(1)} from end`)
  console.log(`  stage img centre vs stage centre  x ${m.stageImg && m.stage ? (m.stageImg.cx - m.stage.cx).toFixed(1) : '-'}  y ${m.stageImg && m.stage ? (m.stageImg.cy - m.stage.cy).toFixed(1) : '-'}`)
  await o.ctx.close()
}
await browser.close(); await srv.server.close()
