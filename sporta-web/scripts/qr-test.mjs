// CATALOGUE V2: the QR encoder in the catalogue engine (SportaCatalogue.qr, embedded from scripts/lib/qr-spike.mjs) and its use on the PDF cover.
//
//   npm run test:qr
//
// Independent reader: zbarimg (zbar-tools). Asserted: the embedded copy equals the module; 120 links (the page and PDF links of many views, Arabic
// searches percent-encoded, lengths 20 to 200) at every level the engine may choose decode back IDENTICAL; text that does not fit, an empty text and a
// non-string give null (never a throw); a level the caller asks for is tried first and a longer link falls back to a lower level; THE PDF COVER carries a
// QR that decodes to the page link of the view the file was built for, in both languages, and is a link annotation to the same address.
// MUTATIONS: a wrong field polynomial, a wrong format word, no level fallback and a cover pointing at the wrong address each turn a check red.
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { genImages, serveShop, engineSource } from './lib/catalogue-fx.mjs'
import { engineInSync } from './lib/embed-catalogue-spikes.mjs'

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 })
if (run('zbarimg', ['--version']).error || run('pdftoppm', ['-v']).error) { console.log('SKIP zbarimg / poppler is not installed'); process.exit(0) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const tmp = mkdtempSync(join(tmpdir(), 'sporta-qr-'))
const gen = await browser.newPage(); const IMAGES = await genImages(gen); await gen.close()

/** A grey PGM of the code, `scale` px a module, a 4-module quiet zone: what a screen or a print shows. */
function pgm(q, scale = 6) {
  const n = (q.size + 8) * scale, buf = Buffer.alloc(n * n, 255)
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.rows[y][x] === '1') for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) buf[((y + 4) * scale + dy) * n + (x + 4) * scale + dx] = 0
  return Buffer.concat([Buffer.from(`P5\n${n} ${n}\n255\n`), buf])
}
function decodeFiles(files) {
  const o = run('zbarimg', ['--quiet', '--raw', '-Sdisable', '-Sqrcode.enable', '--oneshot', ...files])
  return o
}
function decodeOne(file) { const o = run('zbarimg', ['--quiet', '--raw', '-Sdisable', '-Sqrcode.enable', file]); return o.stdout.replace(/\n$/, '') }

const LINKS = []
{
  const views = ['', '?cat=men', '?cat=women&sale=1', '?brand=vanquish&stock=1', '?q=%D9%82%D9%85%D9%8A%D8%B5&sort=price_asc', '?min=5&max=20.5&sort=name', '?cat=men&brand=ahed&q=hello%20world&sale=1&stock=1&sort=price_desc&min=5&max=20.5']
  for (const v of views) for (const pre of ['https://www.sporta.com.kw/catalogue', 'https://www.sporta.com.kw/catalogue?lang=en', 'https://www.sporta.com.kw/catalogue?pdf=ar', 'https://www.sporta.com.kw/catalogue?pdf=en']) LINKS.push(pre + (v ? (pre.includes('?') ? '&' + v.slice(1) : v) : ''))
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const A = 'abcdefghijklmnopqrstuvwxyz0123456789-_'
  while (LINKS.length < 120) { const len = 20 + Math.floor(rnd() * 180); let s = 'https://www.sporta.com.kw/product/'; while (s.length < len) s += A[Math.floor(rnd() * A.length)]; LINKS.push(s) }
}

async function openEngine(engine) {
  const shop = await serveShop({ images: IMAGES, photos: (slug, ext) => (ext === 'jpg' ? 'jpg' : null), engine })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await ctx.newPage(), errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(shop.base + '/'); await page.waitForFunction(() => !!window.SportaCatalogue)
  return { shop, ctx, page, errs, close: async () => { await ctx.close(); await shop.close() } }
}

async function measure(engine, label) {
  const R = { label }, s = await openEngine(engine)
  try {
    const codes = await s.page.evaluate((links) => links.map((u) => { const q = window.SportaCatalogue.qr(u); return q && { size: q.size, rows: q.rows, ecc: q.ecc, version: q.version } }), LINKS)
    R.codes = codes
    const files = codes.map((q, i) => { if (!q) return null; const f = join(tmp, `${label}-${i}.pgm`); writeFileSync(f, pgm(q)); return f })
    R.bad = []; let n = 0
    for (let i = 0; i < files.length; i++) { if (!files[i]) { R.bad.push(i + ' null'); continue } const got = decodeOne(files[i]); n++; if (got !== LINKS[i]) R.bad.push(i + ' ' + got.slice(0, 40)) }
    R.decoded = n
    R.misc = await s.page.evaluate(() => {
      const E = window.SportaCatalogue, long = 'https://www.sporta.com.kw/' + 'a'.repeat(300), mid = 'https://www.sporta.com.kw/catalogue?q=' + 'x'.repeat(130)
      let thrown = false, nulls
      try { nulls = [E.qr(''), E.qr(null), E.qr(undefined), E.qr(12), E.qr({}), E.qr(long)] } catch (e) { thrown = true }
      const h = E.qr(mid, 'H'), m = E.qr(mid), q = E.qr('x', 'Q')
      return { thrown, nulls, hEcc: h && h.ecc, mEcc: m && m.ecc, qEcc: q && q.ecc, small: E.qr('x') && E.qr('x').size }
    })
    // the cover of the PDF carries the QR of the page link of the view the file was built for
    R.cover = {}
    for (const lang of ['ar', 'en']) {
      const b = await s.page.evaluate(async (l) => {
        const E = window.SportaCatalogue, view = E.viewOf('?cat=men&sale=1&sort=price_asc')
        const res = await E.buildPdf({ lang: l, view })
        const u = new Uint8Array(await res.blob.arrayBuffer()); let str = ''
        for (let i = 0; i < u.length; i += 32768) str += String.fromCharCode.apply(null, u.subarray(i, i + 32768))
        return { b64: btoa(str), want: E.pageLink(l, view) }
      }, lang)
      const file = join(tmp, `${label}-${lang}.pdf`); writeFileSync(file, Buffer.from(b.b64, 'base64'))
      const pre = join(tmp, `${label}-${lang}-cover`); run('pdftoppm', ['-r', '150', '-png', '-f', '1', '-l', '1', file, pre])
      const png = run('sh', ['-c', `ls ${pre}*.png`]).stdout.trim().split('\n')[0]
      R.cover[lang] = { got: png ? decodeOne(png) : '', want: b.want, annot: readFileSync(file).toString('latin1').includes('/URI (' + b.want + ')') }
    }
  } catch (e) { R.crashed = String(e.message || e) } finally { R.errs = s.errs; await s.close() }
  return R
}

head('the engine carries the encoder as written')
{ const bad = engineInSync(); is(bad.length === 0, 'the embedded copy in public/sporta-catalogue.js equals scripts/lib/qr-spike.mjs', bad.join(', ')) }

head('the encoder inside the engine')
const base = await measure(engineSource(), 'base')
is(!base.crashed && base.errs.length === 0, 'the engine loads and builds with no page error', base.crashed || base.errs.join(' | '))
is(base.codes && base.codes.every(Boolean), `${LINKS.length} links of 20 to 200 characters all encode`)
const levels = {}; (base.codes || []).forEach((q) => { if (q) levels[q.ecc + q.version] = 1 })
is(base.decoded === LINKS.length && base.bad.length === 0, `zbarimg decodes all ${LINKS.length} codes back identical (${Object.keys(levels).length} level/version combinations, 6 px a module, 4-module quiet zone)`, base.bad.slice(0, 3).join(' | '))
is(base.misc && base.misc.thrown === false && base.misc.nulls.every((x) => x === null), 'an empty text, null, undefined, a number, an object and a 300-character link give null and never throw')
is(base.misc && base.misc.hEcc === 'M' && base.misc.mEcc === 'M' && base.misc.qEcc === 'Q' && base.misc.small === 21, 'level M by default, a level asked for is tried first (Q), and a link too long for H falls back to M', JSON.stringify(base.misc))
is(base.cover && ['ar', 'en'].every((l) => base.cover[l].got === base.cover[l].want && /\/catalogue/.test(base.cover[l].want)), 'the PDF cover carries a QR that decodes (zbarimg on the 150 dpi page) to the page link of the view, in Arabic and in English', base.cover && JSON.stringify(['ar', 'en'].map((l) => [base.cover[l].got, base.cover[l].want])))
is(base.cover && base.cover.ar.want.includes('cat=men') && base.cover.en.want.includes('lang=en') && base.cover.en.want.includes('sale=1'), 'the link in the QR is the view of the file (category, sale, sort) and the language')
is(base.cover && base.cover.ar.annot && base.cover.en.annot, 'the QR on the cover is also a clickable link to the same address')

head('mutations: the encoder or its use with one rule cut must fail its check')
const MUT = [
  ['a wrong field polynomial (0x11B)', 'x ^= 0x11D', 'x ^= 0x11B', (R) => R.bad.length === 0 && R.decoded === LINKS.length],
  ['a wrong format word (the mask bits flipped)', 'function formatBits(lvl, mask) {', 'function formatBits(lvl, mask) { mask = (mask + 1) & 7;', (R) => R.bad.length === 0 && R.decoded === LINKS.length],
  ['no level fallback', "var levels = ecc && /^[LMQH]$/.test(ecc) ? [ecc, 'M', 'L'] : ['M', 'L']", "var levels = ecc && /^[LMQH]$/.test(ecc) ? [ecc] : ['M']", (R) => R.misc && R.misc.hEcc === 'M'],
  ['the cover points at the wrong address', 'qrUrl: pageLink(lang, view)', "qrUrl: ORIGIN + '/'", (R) => R.cover && R.cover.en.got === R.cover.en.want],
  ['the cover has no QR', 'var qc = o.qrUrl ? qr(o.qrUrl) : null', 'var qc = null', (R) => R.cover && R.cover.en.got === R.cover.en.want]
]
for (const [label, from, to, ok] of MUT) {
  const src0 = engineSource()
  if (!src0.includes(from)) { is(false, `mutation "${label}": the cut text was found in the engine`); continue }
  const R = await measure(src0.replace(from, () => to), 'm')
  is(R.crashed || !ok(R), `mutation "${label}": a check goes red`, R.crashed ? '' : JSON.stringify({ bad: R.bad.length, misc: R.misc }).slice(0, 120))
}
console.log(`\n${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
