// CATALOGUE V2: the invisible text layer of the catalogue PDF (public/sporta-catalogue.js, embedded from scripts/lib/pdf-text-layer-spike.mjs),
// proven with poppler and a real browser.
//
//   npm run test:pdf-text-layer
//
// Asserted: the engine's embedded copy is the spike module's text (no drift); the PDF with the layer is valid (pdfinfo clean, the xref points
// at its objects, pdffonts shows the embedded glyphless Identity-H font); pdftotext finds every product's name in English (English file) and
// in Arabic (Arabic file), and the brand, the price and the sizes; copying a card gives its text; THE PAGES ARE PIXEL-IDENTICAL to the same file
// built with `textLayer: false` (pdftoppm, md5 of every page); a file built with a broken layer is still the valid image-only file; the size
// overhead is reported. MUTATIONS: with the layer unreachable, the font number taken after the xref size, the price forced right to left, or
// the Text resource removed, the matching check goes red.
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeData, genImages, serveShop, engineSource } from './lib/catalogue-fx.mjs'
import { engineInSync } from './lib/embed-catalogue-spikes.mjs'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const have = (c) => spawnSync(c, ['-v'], { encoding: 'utf8' }).error == null
if (!have('pdfinfo') || !have('pdftoppm') || !have('pdftotext')) { console.log('SKIP poppler is not installed'); process.exit(0) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const tmp = mkdtempSync(join(tmpdir(), 'sporta-tl-'))
const gen = await browser.newPage(); const IMAGES = await genImages(gen); await gen.close()
const md5 = (b) => createHash('md5').update(b).digest('hex')
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 })
function xrefOk(buf) {
  const s = buf.toString('latin1'), sx = /startxref\n(\d+)\n%%EOF\n$/.exec(s); if (!sx) return false
  const tab = s.slice(+sx[1]), m = /^xref\n0 (\d+)\n/.exec(tab); if (!m) return false
  const n = +m[1], rows = tab.slice(m[0].length).split('\n').slice(0, n)
  for (let i = 1; i < n; i++) { const off = +rows[i].slice(0, 10); if (s.slice(off, off + String(i).length + 6) !== i + ' 0 obj') return false }
  // every object the file contains is in the table (a font numbered after the table's size would be repaired silently by a viewer)
  let max = 0; for (const x of s.matchAll(/(?:^|\n)(\d+) 0 obj\n/g)) max = Math.max(max, +x[1])
  return max + 1 === n
}

async function analyse(engine, label) {
  const shop = await serveShop({ images: IMAGES, photos: (slug, ext) => (ext === 'jpg' ? 'jpg' : null), engine })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage(), errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  const R = { errs }
  try {
    await page.goto(shop.base + '/'); await page.waitForFunction(() => !!window.SportaCatalogue)
    for (const lang of ['ar', 'en']) {
      const b = await page.evaluate(async (l) => {
        const out = {}
        for (const k of ['with', 'without']) {
          const res = await window.SportaCatalogue.buildPdf({ lang: l, textLayer: k === 'with' })
          const u = new Uint8Array(await res.blob.arrayBuffer()); let s = ''
          for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768))
          out[k] = { b64: btoa(s), flag: res.textLayer, pages: res.pages }
        }
        return out
      }, lang)
      const W = Buffer.from(b.with.b64, 'base64'), N = Buffer.from(b.without.b64, 'base64')
      const fw = join(tmp, `${label}-${lang}-with.pdf`), fn = join(tmp, `${label}-${lang}-without.pdf`)
      writeFileSync(fw, W); writeFileSync(fn, N)
      const info = run('pdfinfo', [fw]), fonts = run('pdffonts', [fw])
      const txt = run('pdftotext', ['-layout', fw, '-']).stdout, raw = run('pdftotext', ['-raw', fw, '-']).stdout
      const pw = join(tmp, `${label}-${lang}-pw`), pn = join(tmp, `${label}-${lang}-pn`)
      run('pdftoppm', ['-r', '60', '-png', fw, pw]); run('pdftoppm', ['-r', '60', '-png', fn, pn])
      const ls = (p) => run('sh', ['-c', `ls ${p}-*.png | sort`]).stdout.trim().split('\n').filter(Boolean)
      const same = ls(pw).length === b.with.pages && ls(pw).every((f, i) => md5(readFileSync(f)) === md5(readFileSync(ls(pn)[i])))
      R[lang] = { W, N, flags: [b.with.flag, b.without.flag], info, fonts: fonts.stdout, txt, raw, same, pages: b.with.pages, xref: xrefOk(W), pdfinfoErr: info.stderr, noText: run('pdftotext', [fn, '-']).stdout.replace(/\s+/g, '') }
    }
  } catch (e) { R.crashed = String(e.message || e) } finally { await ctx.close(); await shop.close() }
  return R
}
const squash = (s) => s.replace(/\s+/g, '')
function checks(R) {
  const en = R.en, ar = R.ar, C = {}
  if (!en || !ar) return { crashed: false }
  const names = ['Alpha Top', 'Zeta Top', 'Sale Shorts', 'Cloudsoft Leggings', 'Define Jacket', 'Backpack']
  const arNames = ['توب ألفا', 'توب زيتا', 'شورت التخفيض', 'ليقنز كلاودسوفت', 'جاكيت ديفاين', 'حقيبة ظهر', 'حمالة دعم']
  C.valid = [en, ar].every((x) => x.info.status === 0 && !x.pdfinfoErr && x.xref && /CID TrueType\s+Identity-H\s+yes\s+yes\s+yes/.test(x.fonts.replace(/\s+/g, ' ').replace(/CID TrueType Identity-H emb yes sub yes uni yes/, 'CID TrueType Identity-H yes yes yes')))
  C.flag = en.flags[0] === true && en.flags[1] === false && ar.flags[0] === true
  C.enNames = names.every((n) => squash(en.txt).includes(squash(n)) && squash(en.raw).includes(squash(n)))
  C.arNames = arNames.every((n) => squash(ar.txt).includes(squash(n)))
  C.brand = squash(en.txt).includes('AHED') && squash(ar.txt).includes('أحد')
  // poppler's -raw reads the file in stream (logical) order; -layout re-orders an Arabic line the way a screen shows it. Direction marks are dropped.
  const bidi = (t) => t.replace(/[\u200e\u200f\u202a-\u202e]/g, '')
  C.price = /KWD\s*12\.000/.test(en.txt) && /KWD\s*22\.000\s*KWD\s*30\.000/.test(en.txt) && /12\.000/.test(ar.txt) && /22\.000/.test(ar.txt)
  C.arPriceOrder = /12\.000[\s\u00a0]*د\.ك\./.test(bidi(ar.raw)) && /22\.000[\s\u00a0]*د\.ك\./.test(bidi(ar.raw))
  C.sizes = /S\s*·?\s*M\s*·?\s*L\s*·?\s*XL/.test(en.txt.replace(/[ ]/g, ' ')) || /S.{0,3}M.{0,3}L.{0,3}XL/.test(en.txt)
  C.cover = squash(en.txt).includes(squash('Product catalogue')) && squash(ar.txt).includes(squash('كتالوج المنتجات'))
  C.pixels = en.same && ar.same
  C.imageOnly = en.noText === '' && ar.noText === ''
  C.overhead = en.W.length > en.N.length && en.W.length - en.N.length < 120000
  return C
}

head('the engine carries the spike modules as written')
const bad = engineInSync()
is(bad.length === 0, 'the embedded copies in public/sporta-catalogue.js equal scripts/lib/pdf-text-layer-spike.mjs and qr-spike.mjs', bad.join(', '))

head('the engine as shipped')
const base = await analyse(engineSource(), 'base')
is(!base.crashed && base.errs.length === 0, 'both files built with no page error', base.crashed || base.errs.join(' | '))
const C0 = checks(base)
is(C0.valid, 'with the layer: pdfinfo is clean, the xref points at its objects, pdffonts lists the embedded glyphless CID TrueType Identity-H font with a ToUnicode map')
is(C0.flag, 'the result says textLayer: true, and false when asked for the image-only file')
is(C0.enNames, 'pdftotext (-layout and -raw) finds every English product name in the English file')
is(C0.arNames, 'pdftotext finds every Arabic product name in the Arabic file, in logical (reading) order')
is(C0.brand, 'the brand is found (AHED in English, أحد in Arabic)')
is(C0.price, 'prices are found: KWD 12.000, and the sale KWD 22.000 beside its struck KWD 30.000 in English; 12.000 and 22.000 in Arabic')
is(C0.arPriceOrder, 'the Arabic price keeps its number next to the currency (12.000 د.ك., read in stream order with pdftotext -raw)')
is(C0.sizes, 'the sizes line is found (S M L XL)')
is(C0.cover, 'the cover title is found in both languages')
is(C0.pixels, `every page renders pixel-identical with and without the layer (pdftoppm 60 dpi, md5; ${base.en && base.en.pages} + ${base.ar && base.ar.pages} pages)`)
is(C0.imageOnly, 'the image-only file has no text at all (so the search above really comes from the layer)')
const ov = base.en ? base.en.W.length - base.en.N.length : 0, ova = base.ar ? base.ar.W.length - base.ar.N.length : 0
is(C0.overhead, `the layer's size overhead is small: +${ov} bytes on ${base.en && base.en.N.length} (English), +${ova} on ${base.ar && base.ar.N.length} (Arabic)`)
console.log(`  info  overhead English ${(100 * ov / (base.en ? base.en.N.length : 1)).toFixed(2)}%, Arabic ${(100 * ova / (base.ar ? base.ar.N.length : 1)).toFixed(2)}% (fixture photos are tiny; on a real catalogue of JPEG photos it is under 1%)`)

head('a broken layer never breaks the file')
{
  const src = engineSource().replace('layer.prepare(fed)', "layer.prepare(fed); throw new Error('boom')")
  const R = await analyse(src, 'broken')
  is(!R.crashed && R.errs.length === 0 && R.en && R.en.flags[0] === false && R.en.info.status === 0 && R.en.xref && R.en.noText === '', 'a layer that throws leaves a valid image-only PDF (textLayer: false, no page error)', R.crashed || '')
}

{
  // C2 (2026-11-19 review): a layer that throws AFTER it has taken object numbers (its font is numbered on the first page with text, a second
  // allocation and a throw on page 2 here) must give the numbers back: the xref lists exactly the objects the file holds.
  const FROM = 'return layer.forPage(fed[pages.indexOf(page)], ctx)'
  const src = engineSource()
  if (!src.includes(FROM)) is(false, 'C2: the layer entry point was found in the engine')
  else {
    const late = src.replace(FROM, () => "var r0 = layer.forPage(fed[pages.indexOf(page)], ctx); if (pages.indexOf(page) === 1) { ctx.alloc(); ctx.alloc(); throw new Error('boom late') } return r0")
    const R = await analyse(late, 'late')
    is(!R.crashed && R.errs.length === 0 && R.en && R.en.flags[0] === false && R.en.info.status === 0 && !R.en.pdfinfoErr && R.en.xref && R.en.noText === '' && R.ar && R.ar.xref, 'C2: a layer that throws AFTER taking object numbers still leaves a valid image-only PDF (xref lists exactly the written objects, no poppler repair message)', R.crashed || (R.en && (R.en.pdfinfoErr || String(R.en.xref))))
    const R2 = await analyse(late.replace('catch (e) { plan.forEach(function (o) { o.tl = null }); next = nextBefore }', 'catch (e) { plan.forEach(function (o) { o.tl = null }) }'), 'late-m')
    is(R2.crashed || !(R2.en && R2.en.xref && R2.ar && R2.ar.xref), 'C2 mutation: without giving the numbers back the xref check goes red', R2.crashed || '')
  }
}

head('mutations: the engine with one rule cut must fail its check')
const MUT = [
  ['the library is unreachable (no layer is written)', "textLayerLib = (function () {", 'textLayerLib = null; (function () {', 'enNames'],
  ['the xref size is fixed before the layer takes its font numbers', 'var last = next - 1\n    function obj', 'var last = 3 + plan.length * 3 + plan.reduce(function (a, o) { return a + o.ann.length }, 0)\n    function obj', 'valid'],
  ['the text resources are not added to the page', "(tl ? ' ' + tl.resources : '')", "''", 'enNames'],
  ['the text is painted (render mode 0 over a visible font would show; here the picture must change) - layer content moved off the content stream', "(tl ? '\\n' + tl.content : '')", "''", 'enNames'],
  ['an Arabic price is laid out right to left', "!/^(KWD\\s|[0-9\\u0660-\\u0669])/.test(r.text) ? 'rtl' : 'ltr'", "true ? 'rtl' : 'ltr'", 'arPriceOrder'],
  ['the layer ignores the engine\'s flag (textLayer:false still writes it)', "o.textLayer === false ? null : makeTextLayer(out)", "makeTextLayer(out)", 'flag']
]
for (const [label, from, to, key] of MUT) {
  const src0 = engineSource()
  if (!src0.includes(from)) { is(false, `mutation "${label}": the cut text was found in the engine`); continue }
  const R = await analyse(src0.replace(from, () => to), 'm')
  const C = checks(R)
  is(R.crashed || C[key] === false || (key === 'valid' && C.valid === false), `mutation "${label}": check ${key} goes red`, R.crashed || '')
}

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
