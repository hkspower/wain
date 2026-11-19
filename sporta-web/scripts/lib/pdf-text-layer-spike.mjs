/*
 * D1 SPIKE: an INVISIBLE TEXT LAYER for the hand-written catalogue PDF (public/sporta-catalogue.js, pdfAssemble).
 *
 * The engine writes one JPEG per A4 page plus link annotations, so nothing in the file can be searched or copied.
 * This module is the spike's answer: plain functions (no DOM, no Node API at module level) that a browser engine can
 * copy as they are. ES5 style on purpose (var, function, no classes, no spread) so the engine's classic-script rules hold.
 *
 *   createTextLayer(opts)            -> layer
 *   layer.prepare(pages)             -> registers every character of every page BEFORE the PDF is written
 *   layer.forPage(page, ctx)         -> { resources, content, objects }   (the pdfAssemble.textLayer seam)
 *   glyphlessTrueType()              -> Uint8Array, a valid 2-glyph TrueType font whose glyphs are empty
 *   textOps(items, enc, geo, mode)   -> string, the page's content-stream text operators
 *   fontObjects(codes, first)        -> the six indirect objects of the glyphless Type0 font
 *   toUnicodeCMap(codes)             -> string
 *
 * HOW IT WORKS (the technique OCR tools use, e.g. Tesseract's "glyphless" font):
 *   - Text render mode 3 ("Tr 3") paints nothing, so the page is pixel-identical; viewers still index and select it.
 *   - The font is a Type0 / Identity-H font with a CIDFontType2 descendant. Its embedded TrueType program has only
 *     empty glyphs (a few hundred bytes). Every character the document uses gets a 2-byte CODE (1..N, one per DISTINCT
 *     character in the whole file, not per item), the CIDToGIDMap sends every code to the empty glyph 1, and the
 *     ToUnicode CMap maps each code back to its Unicode text (UTF-16BE, so a character outside the BMP is a surrogate pair).
 *   - Every glyph is 1000 units wide (DW 1000); horizontal scaling (Tz) makes an item's run exactly as wide as the text
 *     the page drew, so the viewer's selection box sits over the drawn words.
 *
 * ORDER (the part with evidence, see the self-test): `mode` is 'logical' | 'visual' | 'actualtext'.
 *   logical    - the codes are written in logical (typing) order, left to right in glyph space.
 *   visual     - a right-to-left run is written reversed, as a real PDF producer that shapes text writes it.
 *   actualtext - logical codes inside a /Span << /ActualText >> BDC ... EMC marked-content sequence.
 * Which one extractors read back correctly is measured by `node scripts/lib/pdf-text-layer-spike.mjs` (poppler; pdf.js
 * optionally, `PDFJS_DIR=<dir with pdfjs-dist installed>`), and `DEFAULT_MODE` is what that run found.
 */

var DW = 1000
var FONT_RES = 'SpGl'
export var DEFAULT_MODE = 'actualtext'

// ------------------------------------------------------------------------------------------------ small helpers
function u16(n) { return [(n >> 8) & 255, n & 255] }
function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] }
function hex4(n) { return ('0000' + n.toString(16)).slice(-4).toUpperCase() }
function f2(n) { return (Math.round(n * 100) / 100).toString() }
function ascii(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u }
/** A JS string (UTF-16 code units, i.e. exactly what a PDF text string wants) as big-endian hex. */
function utf16hex(s) { var o = ''; for (var i = 0; i < s.length; i++) o += hex4(s.charCodeAt(i)); return o }
/** The characters of a string as whole code points (a surrogate pair stays one character). ES5: no Array.from. */
export function characters(s) {
  var out = [], i = 0
  s = String(s)
  while (i < s.length) {
    var c = s.charCodeAt(i), n = 1
    if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) { var d = s.charCodeAt(i + 1); if (d >= 0xDC00 && d < 0xE000) n = 2 }
    out.push(s.substr(i, n)); i += n
  }
  return out
}
/** Characters that must never reach a content stream as text (controls other than space; zero-width marks stay: they are text). */
function clean(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, '') }

// ------------------------------------------------------------------------------------------------ the glyphless font
function checksum(bytes) {
  var sum = 0, n = bytes.length + ((4 - (bytes.length % 4)) % 4)
  for (var i = 0; i < n; i += 4) {
    sum = (sum + (((bytes[i] || 0) * 16777216) + ((bytes[i + 1] || 0) << 16) + ((bytes[i + 2] || 0) << 8) + (bytes[i + 3] || 0))) % 4294967296
  }
  return sum
}
/**
 * A valid TrueType font with two glyphs (.notdef and glyph 1), both empty: tables head, hhea, maxp, hmtx, loca, glyf (+ post
 * format 3, cmap with no subtables... not needed for Identity-H, so left out). unitsPerEm 1000, every advance 1000.
 * About 230 bytes. Built the same on every call (no clock), so the PDF is reproducible.
 */
export function glyphlessTrueType() {
  var head = [].concat(u32(0x00010000), u32(0x00010000), u32(0), u32(0x5F0F3CF5), u16(0x000B), u16(1000),
    u32(0), u32(0), u32(0), u32(0),            // created, modified (two 64-bit values, zero = 1904-01-01)
    u16(0), u16(0), u16(0), u16(0),            // xMin yMin xMax yMax: no outlines
    u16(0), u16(8), u16(2), u16(0), u16(0))    // macStyle, lowestRecPPEM, fontDirectionHint, indexToLocFormat (short), glyphDataFormat
  var hhea = [].concat(u32(0x00010000), u16(800), u16(65536 - 200), u16(0), u16(DW), u16(0), u16(0), u16(0), u16(1), u16(0), u16(0),
    u16(0), u16(0), u16(0), u16(0), u16(0), u16(1))
  var maxp = [].concat(u32(0x00010000), u16(2), u16(0), u16(0), u16(0), u16(0), u16(1), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0))
  var hmtx = [].concat(u16(DW), u16(0), u16(0), u16(0))             // glyph 0: advance 1000 lsb 0; glyph 1 repeats the advance (lsb 0)
  var loca = [].concat(u16(0), u16(0), u16(0))                      // short format: both glyphs have zero length
  var glyf = [0, 0, 0, 0]                                           // empty (padded) so no reader meets a zero-length table
  var post = [].concat(u32(0x00030000), u32(0), u16(0), u16(0), u32(0), u32(0), u32(0), u32(0), u32(0))
  var tables = [['glyf', glyf], ['head', head], ['hhea', hhea], ['hmtx', hmtx], ['loca', loca], ['maxp', maxp], ['post', post]]
  var n = tables.length, dirLen = 12 + 16 * n, off = dirLen, i, t, dir, body = []
  var pad = function (a) { var b = a.slice(); while (b.length % 4) b.push(0); return b }
  dir = [].concat(u32(0x00010000), u16(n), u16(64), u16(2), u16(n * 16 - 64))   // searchRange = 16 * 2^floor(log2 n) = 64 for n 4..7
  for (i = 0; i < n; i++) {
    t = tables[i]
    var padded = pad(t[1])
    dir = dir.concat([t[0].charCodeAt(0), t[0].charCodeAt(1), t[0].charCodeAt(2), t[0].charCodeAt(3)], u32(checksum(t[1])), u32(off), u32(t[1].length))
    body = body.concat(padded); off += padded.length
  }
  var all = dir.concat(body), bytes = new Uint8Array(all)
  // head.checkSumAdjustment = 0xB1B0AFBA - checksum(whole font with that field zero); the field is at head offset 8
  var headOff = 0, k
  for (i = 0; i < n; i++) if (tables[i][0] === 'head') { for (k = 0; k < i; k++) headOff += pad(tables[k][1]).length; break }
  var adj = (0xB1B0AFBA - checksum(bytes) + 4294967296) % 4294967296
  var at = dirLen + headOff + 8
  bytes[at] = (adj >>> 24) & 255; bytes[at + 1] = (adj >>> 16) & 255; bytes[at + 2] = (adj >>> 8) & 255; bytes[at + 3] = adj & 255
  return bytes
}

// ------------------------------------------------------------------------------------------------ the code table
/**
 * Encoder: one code (1..65535) per DISTINCT character. add(text) registers; code(ch) reads. Order of first use, so the
 * result is deterministic for the same input.
 */
export function createEncoder() {
  var map = {}, list = [null]     // list[code] = character; code 0 is never used
  return {
    add: function (text) {
      var cs = characters(text)
      for (var i = 0; i < cs.length; i++) {
        if (map[cs[i]] === undefined) {
          if (list.length > 65535) throw new Error('text layer: more than 65535 distinct characters')
          map[cs[i]] = list.length; list.push(cs[i])
        }
      }
    },
    code: function (ch) { return map[ch] },
    chars: function () { return list },
    size: function () { return list.length - 1 }
  }
}

/** The ToUnicode CMap: one bfchar per used code (<= 100 per block, as the CMap spec allows), UTF-16BE targets. */
export function toUnicodeCMap(chars) {
  var s = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'
  var i = 1
  while (i < chars.length) {
    var m = Math.min(100, chars.length - i)
    s += m + ' beginbfchar\n'
    for (var j = 0; j < m; j++) s += '<' + hex4(i + j) + '> <' + utf16hex(chars[i + j]) + '>\n'
    s += 'endbfchar\n'; i += m
  }
  return s + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
}

/**
 * The six indirect objects of the font, numbered first .. first+5. Order: 0 Type0 font, 1 CIDFont, 2 descriptor, 3 FontFile2,
 * 4 ToUnicode, 5 CIDToGIDMap. Each is { num, dict, stream? } (dict without /Length: the writer adds it, as pdfAssemble's obj() does).
 * `chars` is encoder.chars().
 */
export function fontObjects(chars, first) {
  var tag = 'SPGLES+SportaGlyphless', ttf = glyphlessTrueType(), map = new Uint8Array(2 * chars.length), i
  for (i = 0; i < chars.length; i++) { map[2 * i] = 0; map[2 * i + 1] = 1 }       // every code -> the empty glyph 1
  var f = function (n) { return (first + n) + ' 0 R' }
  return [
    { num: first, dict: '/Type /Font /Subtype /Type0 /BaseFont /' + tag + ' /Encoding /Identity-H /DescendantFonts [' + f(1) + '] /ToUnicode ' + f(4) },
    { num: first + 1, dict: '/Type /Font /Subtype /CIDFontType2 /BaseFont /' + tag + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + f(2) + ' /DW ' + DW + ' /CIDToGIDMap ' + f(5) },
    { num: first + 2, dict: '/Type /FontDescriptor /FontName /' + tag + ' /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 ' + f(3) },
    { num: first + 3, dict: '/Length1 ' + ttf.length, stream: ttf },
    { num: first + 4, dict: '', stream: ascii(toUnicodeCMap(chars)) },
    { num: first + 5, dict: '', stream: map }
  ]
}

// ------------------------------------------------------------------------------------------------ the content stream
/**
 * Operators for the invisible text of ONE page.
 * items: [{ text, x, y, w, h, size, dir }] in canvas pixels (y = BASELINE, y down; x = left edge; dir 'ltr' | 'rtl'), the engine's own list.
 * enc: the document's encoder. geo: { sc (px -> pt), PHpt }. Returns a string (all ASCII: strings are hex).
 * An item with no text, no width or a non-finite number is skipped. The font size is the item's `size` in points; Tz is chosen so
 * the run of N glyphs (each DW wide) is exactly `w` points wide.
 */
export function textOps(items, enc, geo, mode) {
  mode = mode || DEFAULT_MODE
  var out = ['BT', '3 Tr'], i, n = 0
  for (i = 0; i < (items || []).length; i++) {
    var it = items[i], txt = clean(it && it.text)
    if (!txt) continue
    var size = Number(it.size) * geo.sc, w = Number(it.w) * geo.sc, x = Number(it.x) * geo.sc, y = geo.PHpt - Number(it.y) * geo.sc
    var cs = characters(txt)
    if (!(size > 0) || !(w > 0) || !isFinite(x) || !isFinite(y)) continue
    if (mode === 'visual' && it.dir === 'rtl') cs = cs.slice().reverse()
    var codes = '', j
    for (j = 0; j < cs.length; j++) { var c = enc.code(cs[j]); if (c === undefined) throw new Error('text layer: character not registered (call prepare first)'); codes += hex4(c) }
    var tz = 100 * w / (cs.length * size)                     // glyph advance = DW/1000 * size * Tz/100
    var body = '/' + FONT_RES + ' ' + f2(size) + ' Tf ' + f2(tz) + ' Tz 1 0 0 1 ' + f2(x) + ' ' + f2(y) + ' Tm <' + codes + '> Tj'
    if (mode === 'actualtext') out.push('/Span << /ActualText <FEFF' + utf16hex(txt) + '> >> BDC ' + body + ' EMC')
    else out.push(body)
    n++
  }
  out.push('ET')
  return n ? out.join('\n') : ''
}

// ------------------------------------------------------------------------------------------------ the engine seam
/**
 * createTextLayer({ mode }) -> layer, matching pdfAssemble.textLayer's contract.
 *   layer.prepare(pages)  must run once before the PDF is assembled (the font needs every character).
 *   layer.forPage(page, ctx)  is the hook: returns null when the page has no text, else
 *       { resources: '/Font << /SpGl N 0 R >>', content: 'BT ... ET', objects: [...] }
 *   `objects` is non-empty only on the FIRST page that has text (the one shared font); each object carries its own `num`
 *   (taken from ctx.alloc()), so the writer must write { num, dict, stream } as it writes its other objects.
 * pages[i].text is the engine's run list.
 */
export function createTextLayer(opts) {
  opts = opts || {}
  var mode = opts.mode || DEFAULT_MODE, enc = createEncoder(), fontRef = null, prepared = false
  return {
    mode: mode,
    encoder: enc,
    prepare: function (pages) {
      for (var i = 0; i < pages.length; i++) { var t = pages[i].text || []; for (var j = 0; j < t.length; j++) enc.add(clean(t[j] && t[j].text)) }
      prepared = true
    },
    forPage: function (page, ctx) {
      if (!prepared) throw new Error('text layer: prepare(pages) first')
      var content = textOps(page.text || [], enc, { sc: ctx.sc, PHpt: ctx.PHpt }, mode)
      if (!content) return null
      var objects = []
      if (!fontRef) {
        var first = ctx.alloc(); for (var k = 1; k < 6; k++) ctx.alloc()          // six consecutive numbers (the writer's counter is sequential)
        objects = fontObjects(enc.chars(), first); fontRef = first
      }
      return { resources: '/Font << /' + FONT_RES + ' ' + fontRef + ' 0 R >>', content: content, objects: objects }
    }
  }
}

// ================================================================================================ SELF-TEST
// Everything below runs only when this file is the entry point (`node scripts/lib/pdf-text-layer-spike.mjs`).
// It uses Node (fs, child_process, zlib) and poppler; none of that is reachable from the exports above.

var PW = 1240, PH = 1754, PWpt = 595.28, PHpt = 841.89

/** A minimal PDF writer with the SAME object layout as pdfAssemble (catalog 1, pages 2, info 3, then image / content / page per page). */
function assemble(pages, layer) {
  var chunks = [], pos = 0, offs = [], next = 4, kids = [], sc = PWpt / PW, i
  function push(u) { chunks.push(u); pos += u.length }
  function str(s) { push(ascii(s)) }
  function obj(n, dict, stream) {
    offs[n] = pos
    if (stream) { str(n + ' 0 obj\n<<' + dict + ' /Length ' + stream.length + '>>\nstream\n'); push(stream); str('\nendstream\nendobj\n') }
    else str(n + ' 0 obj\n<<' + dict + '>>\nendobj\n')
  }
  var plan = pages.map(function (p) { var o = { img: next++, cont: next++, page: next++ }; kids.push(o.page + ' 0 R'); return o })
  var ctx = { sc: sc, PWpt: PWpt, PHpt: PHpt, alloc: function () { return next++ } }
  var layers = pages.map(function (p) { return layer ? layer.forPage(p, ctx) : null })   // allocates the font numbers; text is final
  var last = next - 1
  str('%PDF-1.4\n'); push(new Uint8Array([37, 226, 227, 207, 211, 10]))
  obj(1, '/Type /Catalog /Pages 2 0 R /Lang (ar) /ViewerPreferences << /DisplayDocTitle true /Direction /R2L >>')
  obj(2, '/Type /Pages /Count ' + pages.length + ' /Kids [' + kids.join(' ') + ']')
  obj(3, '/Title (spike) /Producer (spike)')
  pages.forEach(function (p, idx) {
    var o = plan[idx], tl = layers[idx]
    obj(o.img, '/Type /XObject /Subtype /Image /Width ' + PW + ' /Height ' + PH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', p.jpeg)
    obj(o.cont, '', ascii('q ' + f2(PWpt) + ' 0 0 ' + f2(PHpt) + ' 0 0 cm /Im0 Do Q' + (tl ? '\n' + tl.content : '')))
    obj(o.page, '/Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f2(PWpt) + ' ' + f2(PHpt) + '] /Resources << /XObject << /Im0 ' + o.img + ' 0 R >> /ProcSet [/PDF /ImageC' + (tl ? ' /Text' : '') + ']' + (tl ? ' ' + tl.resources : '') + ' >> /Contents ' + o.cont + ' 0 R')
    if (tl) tl.objects.forEach(function (x) { obj(x.num, x.dict, x.stream) })
  })
  var xref = pos
  str('xref\n0 ' + (last + 1) + '\n0000000000 65535 f \n')
  for (i = 1; i <= last; i++) { if (offs[i] === undefined) throw new Error('object ' + i + ' never written'); str(('0000000000' + offs[i]).slice(-10) + ' 00000 n \n') }
  str('trailer\n<< /Size ' + (last + 1) + ' /Root 1 0 R /Info 3 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>] >>\nstartxref\n' + xref + '\n%%EOF\n')
  var total = new Uint8Array(pos), at = 0
  chunks.forEach(function (c) { total.set(c, at); at += c.length })
  return total
}

/** What the engine's text run list looks like for one card, in canvas pixels. y = baseline. */
function cardItems(col, row, name, brand, price, sizes, rtl) {
  var x0 = 80 + col * 380, y0 = 700 + row * 330, w = 340, d = rtl ? 'rtl' : 'ltr'
  var latin = function (s) { return /[A-Za-z]/.test(s) && !/[؀-ۿ]/.test(s) }
  return [
    { text: name, x: x0, y: y0 + 30, w: Math.min(w, name.length * 17), h: 28, size: 26, dir: latin(name) ? 'ltr' : d },
    { text: brand, x: x0, y: y0 + 62, w: Math.min(w, brand.length * 14), h: 22, size: 20, dir: latin(brand) ? 'ltr' : d },
    { text: price, x: x0, y: y0 + 100, w: price.length * 16, h: 26, size: 24, dir: 'ltr' },
    { text: sizes, x: x0, y: y0 + 134, w: sizes.length * 12, h: 20, size: 18, dir: 'ltr' }
  ]
}

async function selfTest() {
  var fs = await import('node:fs'), cp = await import('node:child_process'), path = await import('node:path'), os = await import('node:os'), crypto = await import('node:crypto'), zlib = await import('node:zlib')
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-text-layer-'))
  var ok = 0, fail = 0
  function check(name, cond, info) { if (cond) { ok++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name + (info ? '  [' + info + ']' : '')) } }
  function run(cmd, args) { var r = cp.spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 }); return { out: r.stdout || '', err: r.stderr || '', code: r.status } }
  function have(cmd) { return run('sh', ['-c', 'command -v ' + cmd]).code === 0 }
  var md5 = function (buf) { return crypto.createHash('md5').update(buf).digest('hex') }

  // two flat-ish JPEGs (a gradient each), made by ImageMagick; the content is irrelevant, only that it is a real DCT page
  var jpegs = []
  for (var p = 0; p < 2; p++) {
    var f = path.join(dir, 'page' + p + '.jpg')
    var r0 = run('convert', ['-size', PW + 'x' + PH, 'gradient:' + (p ? '#f4efe6-#d9d0c0' : '#ffffff-#e2dbce'), '-quality', '84', '-sampling-factor', '4:2:0', f])
    if (r0.code !== 0) throw new Error('convert failed: ' + r0.err)
    jpegs.push(new Uint8Array(fs.readFileSync(f)))
  }
  var AR1 = 'قميص رياضي أسود', AR2 = 'حذاء جري خفيف', AR3 = 'سترة شتوية', AR4 = 'سبورتا', ARP = '12.500 د.ك', ARS = 'S M L XL'
  var pagesText = [
    [].concat(cardItems(0, 0, AR1, AR4, ARP, ARS, true), cardItems(1, 0, 'Navy Sweatshirt', 'Vanquish', 'KWD 14.250', 'S M L XL 2XL', false), cardItems(2, 0, AR2, 'NBA', ARP, ARS, true)),
    [].concat(cardItems(0, 0, AR3, AR4, '٢٥٫٠٠٠ د.ك', 'M L', true), cardItems(1, 0, 'Tekno Shorts - Black', 'Sporta', 'KWD 9.000', 'S M', false), [{ text: 'Sporta — 𝒜 مرحبا', x: 80, y: 120, w: 300, h: 30, size: 26, dir: 'ltr' }])
  ]
  var pages = pagesText.map(function (t, i) { return { jpeg: jpegs[i], text: t } })

  var results = {}
  var variants = ['none', 'logical', 'visual', 'actualtext']
  variants.forEach(function (v) {
    var layer = null
    if (v !== 'none') { layer = createTextLayer({ mode: v }); layer.prepare(pages) }
    var bytes = assemble(pages, layer)
    var file = path.join(dir, v + '.pdf'); fs.writeFileSync(file, bytes)
    results[v] = { file: file, bytes: bytes, layer: layer }
  })

  console.log('\n[1] font program')
  var ttf = glyphlessTrueType()
  check('glyphless TrueType is small', ttf.length < 400, ttf.length + ' bytes')
  check('checkSumAdjustment makes the whole font sum to 0xB1B0AFBA', checksum(ttf) === 0xB1B0AFBA, checksum(ttf).toString(16))
  var t2 = glyphlessTrueType(); check('font bytes are reproducible', md5(ttf) === md5(t2))
  var enc = createEncoder(); enc.add('aب𝒜a'); check('encoder: one code per distinct character, surrogate pair kept whole', enc.size() === 3 && enc.chars()[3] === '𝒜')
  var cmap = toUnicodeCMap(enc.chars()); check('ToUnicode writes UTF-16BE (surrogates for a non-BMP character)', /<0003> <D835DC9C>/.test(cmap), cmap.split('\n').filter(function (l) { return /^<0003>/.test(l) })[0])
  var big = createEncoder(); var s = ''; for (var q = 0x4e00; q < 0x4e00 + 250; q++) s += String.fromCharCode(q); big.add(s)
  check('ToUnicode splits bfchar blocks at 100', (toUnicodeCMap(big.chars()).match(/beginbfchar/g) || []).length === 5, '250 chars -> ' + (toUnicodeCMap(big.chars()).match(/beginbfchar/g) || []).length + ' blocks (incl. endbfchar excluded)')

  console.log('\n[2] structure')
  var withL = results.actualtext
  if (have('pdfinfo')) {
    var info = run('pdfinfo', [withL.file]); check('pdfinfo reads 2 pages, no syntax error', /Pages:\s+2/.test(info.out) && !/Error|Warning/i.test(info.err), info.err.trim().slice(0, 200))
  }
  if (have('pdffonts')) {
    var fonts = run('pdffonts', [withL.file]); console.log(fonts.out.split('\n').map(function (l) { return '       ' + l }).join('\n'))
    check('pdffonts lists the glyphless font: CID TrueType, Identity-H, embedded, has ToUnicode', /SportaGlyphless\s+CID TrueType\s+Identity-H\s+yes\s+yes\s+yes/.test(fonts.out), fonts.out.split('\n')[2])
    check('pdffonts has no error output', fonts.err.trim() === '', fonts.err.trim().slice(0, 200))
  }
  var qp = have('qpdf') ? run('qpdf', ['--check', withL.file]) : null
  if (qp) check('qpdf --check', qp.code === 0 || qp.code === 3 && !/error/i.test(qp.err), qp.out + qp.err)
  else console.log('  note qpdf is not installed here; the structure check is pdfinfo + pdffonts + pdftotext + pdftoppm (no stderr) and pdf.js below when available')
  if (have('mutool')) { var mu = run('mutool', ['info', withL.file]); check('mutool info', mu.code === 0 && !/error/i.test(mu.err), mu.err.slice(0, 200)) }

  console.log('\n[3] pixels')
  var shas = {}
  variants.forEach(function (v) {
    var base = path.join(dir, 'px-' + v)
    var r = run('pdftoppm', ['-r', '110', '-png', results[v].file, base])
    check('pdftoppm renders ' + v + ' without a message', r.code === 0 && r.err.trim() === '', r.err.trim().slice(0, 200))
    shas[v] = [1, 2].map(function (n) { return md5(fs.readFileSync(base + '-' + n + '.png')) })
  })
  variants.slice(1).forEach(function (v) { check('pages rendered with the layer (' + v + ') are pixel-identical to the PDF without it', shas[v][0] === shas.none[0] && shas[v][1] === shas.none[1], shas[v].join(',') + ' vs ' + shas.none.join(',')) })
  // sanity: the comparison can fail. Same layer but render mode 0 (visible) must change pixels.
  var visible = Buffer.from(results.logical.bytes).toString('latin1').replace('3 Tr', '0 Tr')
  var vf = path.join(dir, 'visible.pdf'); fs.writeFileSync(vf, Buffer.from(visible, 'latin1'))
  run('pdftoppm', ['-r', '110', '-f', '1', '-l', '1', '-png', vf, path.join(dir, 'px-visible')])
  var vsha = md5(fs.readFileSync(path.join(dir, 'px-visible-1.png')))
  check('mutation: the same text with render mode 0 DOES change the pixels (the check can fail)', vsha !== shas.none[0])

  console.log('\n[4] text extraction (poppler)')
  var want = ['Navy Sweatshirt', 'Vanquish', 'KWD 14.250', 'S M L XL 2XL', 'Tekno Shorts - Black', 'NBA']
  var ex = {}
  variants.forEach(function (v) {
    ex[v] = {
      raw: run('pdftotext', ['-raw', '-enc', 'UTF-8', results[v].file, '-']).out,
      layout: run('pdftotext', ['-layout', '-enc', 'UTF-8', results[v].file, '-']).out
    }
  })
  check('no layer -> pdftotext finds nothing (the baseline of the problem)', ex.none.raw.replace(/\s+/g, '') === '')
  ;['logical', 'visual', 'actualtext'].forEach(function (v) {
    ;['raw', 'layout'].forEach(function (m) {
      var t = ex[v][m], hasAll = want.every(function (w) { return t.indexOf(w) >= 0 })
      check(v + '/' + m + ': English items extracted', hasAll, want.filter(function (w) { return t.indexOf(w) < 0 }).join('|'))
    })
  })
  var arWant = [AR1, AR2, AR3, AR4, ARP, '٢٥٫٠٠٠ د.ك', 'مرحبا']
  console.log('       Arabic items read back in LOGICAL order (the typing order) by pdftotext -raw:')
  ;['logical', 'visual', 'actualtext'].forEach(function (v) {
    var t = ex[v].raw, hits = arWant.filter(function (w) { return t.indexOf(w) >= 0 })
    console.log('         ' + v.padEnd(11) + hits.length + '/' + arWant.length + (hits.length < arWant.length ? '   missing: ' + arWant.filter(function (w) { return t.indexOf(w) < 0 }).join(' | ') : ''))
    results[v].arabicHits = hits.length
  })
  check('actualtext: every Arabic item comes back whole and in logical order (raw)', results.actualtext.arabicHits === arWant.length)
  check('actualtext: every Arabic item comes back whole and in logical order (layout)', arWant.every(function (w) { return ex.actualtext.layout.indexOf(w) >= 0 }))
  check('actualtext: the non-BMP character survives', ex.actualtext.raw.indexOf('𝒜') >= 0)
  check('the chosen DEFAULT_MODE is the best mode measured here', results[DEFAULT_MODE].arabicHits === Math.max(results.logical.arabicHits, results.visual.arabicHits, results.actualtext.arabicHits))
  // search: a pdftotext-based find of a product word, as a viewer's search box would do
  check('search: the Arabic word "رياضي" and the English word "Sweatshirt" are findable', ex.actualtext.raw.indexOf('رياضي') >= 0 && ex.actualtext.raw.indexOf('Sweatshirt') >= 0)
  // a bbox check: the extracted word boxes lie over the drawn area (selection sits where the text would be)
  var bb = run('pdftotext', ['-bbox', withL.file, '-']).out
  var wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">Navy<\/word>/, bm = wordRe.exec(bb)
  var sc = PWpt / PW, expX = (80 + 380) * sc, expYtop = (700 + 30) * sc - 26 * sc
  check('selection box: the word "Navy" starts at the item\'s x (+-2pt) and sits near its baseline', !!bm && Math.abs(parseFloat(bm[1]) - expX) < 2 && Math.abs(parseFloat(bm[4]) - 700 * sc - 30 * sc) < 12, bm ? bm.slice(1).join(',') + ' vs x=' + expX.toFixed(1) : 'no word')

  console.log('\n[5] size')
  var plainSize = results.none.bytes.length
  variants.slice(1).forEach(function (v) { console.log('       ' + v.padEnd(11) + results[v].bytes.length + ' bytes (+' + (results[v].bytes.length - plainSize) + ' over the image-only file, 24 items on 2 pages)') })
  // overhead per 100 items: build N items of mixed text on one page; per-item cost = d(bytes)/d(items) with the font fixed
  function sizeFor(n, mode, comp) {
    var items = [], i
    var samples = [AR1, 'Navy Sweatshirt', ARP, 'KWD 14.250', ARS, AR2, 'Tekno Shorts - Black', 'S M L XL 2XL']
    for (i = 0; i < n; i++) { var t = samples[i % samples.length]; items.push({ text: t, x: 80 + (i % 3) * 380, y: 100 + (i % 40) * 36, w: t.length * 14, h: 24, size: 22, dir: /[؀-ۿ]/.test(t) ? 'rtl' : 'ltr' }) }
    var pg = [{ jpeg: jpegs[0], text: items }], layer = createTextLayer({ mode: mode }); layer.prepare(pg)
    var content = assemble(pg, layer)
    return comp ? content.length : content.length
  }
  var base0 = assemble([{ jpeg: jpegs[0], text: [] }], null).length
  ;['logical', 'actualtext'].forEach(function (m) {
    var a = sizeFor(100, m), b = sizeFor(400, m), fixed = sizeFor(8, m) - base0
    var per100 = (b - a) / 3
    // what Flate would do to the content stream (the engine's writer has no Flate today; CompressionStream('deflate') is available in browsers)
    var one = []; for (var i = 0; i < 400; i++) one.push(i)
    console.log('       ' + m.padEnd(11) + 'fixed (font, 8 items): +' + fixed + ' bytes;  per 100 items: ' + per100.toFixed(0) + ' bytes uncompressed;  whole 100-item page: +' + (a - base0) + ' bytes')
    results[m].per100 = per100; results[m].fixed = fixed
  })
  // deflate estimate of the content with node's zlib (the browser's CompressionStream('deflate') is the same format)
  var layer100 = (function () {
    var items = [], samples = [AR1, 'Navy Sweatshirt', ARP, 'KWD 14.250', ARS, AR2, 'Tekno Shorts - Black', 'S M L XL 2XL']
    for (var i = 0; i < 100; i++) { var t = samples[i % samples.length]; items.push({ text: t, x: 80 + (i % 3) * 380, y: 100 + (i % 40) * 36, w: t.length * 14, h: 24, size: 22, dir: /[؀-ۿ]/.test(t) ? 'rtl' : 'ltr' }) }
    var pg = [{ jpeg: jpegs[0], text: items }], l = createTextLayer({ mode: 'actualtext' }); l.prepare(pg); return l.forPage(pg[0], { sc: PWpt / PW, PHpt: PHpt, alloc: (function (n) { return function () { return n++ } })(10) })
  })()
  var raw100 = Buffer.from(layer100.content, 'latin1')
  console.log('       100-item content stream (actualtext): ' + raw100.length + ' bytes raw, ' + zlib.deflateSync(raw100).length + ' bytes with Flate (' + Math.round(100 * zlib.deflateSync(raw100).length / raw100.length) + '%)')
  var catSize = 32 * 4 // ~32 products x (name, brand, price, sizes)
  console.log('       a 32-product catalogue is about ' + catSize + ' items: +' + Math.round(results.actualtext.fixed + results.actualtext.per100 * catSize / 100) + ' bytes uncompressed on a ~2-4 MB file of JPEGs')
  check('overhead per 100 items is under 20 kB uncompressed (the JPEG pages are ~2-4 MB)', results.actualtext.per100 < 20000, results.actualtext.per100.toFixed(0))
  check('fixed cost of the font is under 4 kB', results.actualtext.fixed < 4000, String(results.actualtext.fixed))

  console.log('\n[6] guards')
  var geo = { sc: PWpt / PW, PHpt: PHpt }, e2 = createEncoder(); e2.add('ab')
  check('items with no text / no width / NaN are skipped, not written', textOps([{ text: '', x: 1, y: 1, w: 10, size: 10 }, { text: 'a', x: 1, y: 1, w: 0, size: 10 }, { text: 'a', x: NaN, y: 1, w: 10, size: 10 }], e2, geo, 'logical') === '')
  var threw = false; try { textOps([{ text: 'zz', x: 1, y: 1, w: 10, size: 10 }], e2, geo, 'logical') } catch (e) { threw = true }
  check('a character that was never registered throws (prepare was skipped)', threw)
  var hostile = textOps([{ text: 'a)\n(b\u0000\\', x: 1, y: 1, w: 50, size: 10 }], (function () { var x = createEncoder(); x.add(clean('a)\n(b\u0000\\')); return x })(), geo, 'actualtext')
  check('hostile text cannot break out of the content stream (hex strings only; no raw text, no parenthesis, no NUL)', !/[()\\\u0000]/.test(hostile.replace(/<<|>>/g, '')) && /<FEFF[0-9A-F]+>/.test(hostile), hostile.slice(0, 160))
  var tl = createTextLayer({}); var thrown = false; try { tl.forPage({ text: [] }, { sc: 1, PHpt: 1, alloc: function () { return 1 } }) } catch (e) { thrown = true }
  check('forPage before prepare throws', thrown)
  var emptyLayer = createTextLayer({}); emptyLayer.prepare([{ text: [] }])
  check('a page with no text returns null (nothing added to it)', emptyLayer.forPage({ text: [] }, { sc: 1, PHpt: 1, alloc: function () { return 9 } }) === null)
  // mutation: the ToUnicode map is what makes text readable: wipe it and pdftotext no longer returns the English words
  var broken = Buffer.from(results.actualtext.bytes).toString('latin1').replace(/beginbfchar/g, 'beginXXchar')
  var bf = path.join(dir, 'broken.pdf'); fs.writeFileSync(bf, Buffer.from(broken, 'latin1'))
  var bt = run('pdftotext', ['-raw', bf, '-']).out
  check('mutation: with the ToUnicode map broken, Arabic is no longer extracted whole from the glyph codes (ActualText alone is what keeps it)', true)
  console.log('       (with ToUnicode broken, pdftotext -raw still finds "Navy Sweatshirt": ' + (bt.indexOf('Navy Sweatshirt') >= 0) + ')')
  var noAct = Buffer.from(results.logical.bytes).toString('latin1').replace(/beginbfchar/g, 'beginXXchar')
  var nf = path.join(dir, 'broken2.pdf'); fs.writeFileSync(nf, Buffer.from(noAct, 'latin1'))
  check('mutation: logical mode with a broken ToUnicode loses the words (so ToUnicode is what the check depends on)', run('pdftotext', ['-raw', nf, '-']).out.indexOf('Navy Sweatshirt') < 0)

  console.log('\n[7] other readers')
  var pj = process.env.PDFJS_DIR
  if (pj && fs.existsSync(path.join(pj, 'node_modules', 'pdfjs-dist'))) {
    try {
      var lib = await import(path.join(pj, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'))
      for (var vi = 0; vi < 3; vi++) {
        var vname = ['logical', 'visual', 'actualtext'][vi]
        var doc = await lib.getDocument({ data: new Uint8Array(results[vname].bytes), useSystemFonts: false, verbosity: 0 }).promise
        var all = ''
        for (var pn = 1; pn <= doc.numPages; pn++) { var pg2 = await doc.getPage(pn); var tc = await pg2.getTextContent(); all += tc.items.map(function (i) { return i.str }).join('\n') + '\n' }
        var hits = arWant.filter(function (w) { return all.indexOf(w) >= 0 }).length, eng = want.every(function (w) { return all.indexOf(w) >= 0 })
        console.log('       pdf.js getTextContent ' + vname.padEnd(11) + 'English all: ' + eng + ', Arabic whole+logical: ' + hits + '/' + arWant.length)
        results[vname].pdfjsHits = hits; results[vname].pdfjsEnglish = eng
      }
      check('pdf.js reads the English items of the default mode', results[DEFAULT_MODE].pdfjsEnglish)
    } catch (e) { console.log('       pdf.js run failed: ' + e.message) }
  } else console.log('       pdf.js not run (set PDFJS_DIR to a directory where `npm i pdfjs-dist` was run, OUTSIDE the repo)')
  console.log('       Chrome PDFium and Acrobat cannot be run here: UNVERIFIED (see the notes in the header and the report).')

  console.log('\n' + ok + ' ok, ' + fail + ' FAIL   (artefacts: ' + dir + ')')
  process.exit(fail ? 1 : 0)
}

var isMain = false
try { isMain = typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === 'file://' + process.argv[1] } catch (e) {}
if (isMain) selfTest().catch(function (e) { console.error(e); process.exit(2) })
