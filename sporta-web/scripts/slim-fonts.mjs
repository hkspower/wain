#!/usr/bin/env node
// SLIM FONTS - ship only the font weights the site draws, and prove no pixel changes.
//
//   node scripts/slim-fonts.mjs                  build public/fonts/*.woff2 from the masters, verify, print the table
//   node scripts/slim-fonts.mjs --check          rebuild into a temp dir and compare with public/fonts (exit 1 on any difference): the same
//                                                bytes, or - when only the WOFF2 compression differs, which another machine's brotli does -
//                                                the same tables in every file. --strict-bytes asks for the very same bytes.
//   node scripts/slim-fonts.mjs --plan           read-only: say what each file would become, write nothing
//   node scripts/slim-fonts.mjs --stage2 DIR --corpus FILE   optional glyph subset into DIR only (see below), never into public/fonts
//
// WHY THIS EXISTS (owner, 2026-11-04: "use only font weight used")
//   The site ships 8 WOFF2 files. IBM Plex Sans Arabic is static (400, 600, 700, one file per weight and script) and
//   every one of those weights is drawn, so no Plex weight file can go. Alexandria is a VARIABLE font whose wght axis
//   runs 100-900, but nothing on the site asks it for a weight under 400, so the axis is cut to the range that is
//   really used (brand/fonts-original/used-weights.json, written from a crawl by test:fonts-used --write-used).
//   Cutting the lower half of an axis is lossless for the kept half: the font's default master IS 400 and the used
//   maximum is the font's own maximum (900), so nothing in 400-900 is re-scaled, only the 100-399 half is dropped.
//
// WHAT IT DOES, in this order, to each master in brand/fonts-original/
//   1. Alexandria (alexandria-var-*.woff2): the wght axis is limited to [min, max] of used-weights.json. fontTools'
//      instancer rewrites fvar, avar, HVAR, GDEF, GPOS and STAT (their variation data keeps the kept regions' integer deltas
//      as they were), but NOT gvar, the outline variations: the instancer's own gvar would re-run IUP optimisation (default,
//      moved one glyph by up to 0.5 unit) or expand every inferred delta to a rounded integer (moved 46 glyphs by up to 0.5
//      unit). So gvar is put back from the master with only the lower-half (negative-peak) tuples removed: every kept tuple is
//      the master's own, and the proof below finds zero differing glyphs at every weight in 400-900.
//   2. Every file: drops the glyph NAMES (post table format 3.0). Browsers draw by glyph index; names are only read by
//      font editors and PDF tools. This is the biggest saving in the three Plex Arabic files (4.1 kB each, 15.8 kB over all
//      eight files; the weight cut alone is 15.7 kB). --keep-glyph-names turns it off.
//   3. woff2 with brotli (fontTools), head.modified left alone so the same input is the same bytes every time.
//   4. A file that did not come out smaller is written as the master's own bytes (never grows a file).
//   5. A Plex face whose weight is not in used-weights.json is reported UNUSED and the run stops (exit 2): the live
//      compiled stylesheet declares an @font-face for every file, so deleting one would leave a declared face whose file
//      404s. --drop-unused deletes it from the output anyway, for the day the stylesheet that declares it is yours.
//
// WHAT IS KEPT, deliberately: every glyph, every OpenType feature (kern, mark, mkmk, ccmp, locl, liga, init/medi/fina,
//   tnum/pnum, ...), hinting programs (fpgm/prep/cvt), gasp, the name table (the fonts audit identifies faces by it),
//   unicode ranges, and the file NAMES (the compiled stylesheet refers to them).
//
// NOT DONE, measured: glyph subsetting ("stage 2"). The Arabic Plex files carry 681 code points. --stage2 builds a subset into a
//   scratch directory only. Measured on top of this script's output (221,968 B): keeping only what the shop's own files emit
//   (193 code points: ASCII, 72 Arabic-script, 16 punctuation/symbols) gives 119,976 B (-102 kB, -46%) but a customer's own
//   name, address or note would fall back to a device font for any other letter; keeping in addition the whole basic Arabic,
//   Persian, Urdu, Pashto and Sindhi letter set, Latin-1 and the general punctuation block (521 code points) gives 182,480 B
//   (-39.5 kB, -17.8%) and still cannot promise every letter somebody types. Neither is applied; it is the owner's decision.
//
// PROOF built in (every run, unless --no-verify): for each output, cmap (code point to glyph index), glyph count, GSUB/GPOS
//   feature tags, names and every non-variation table are compared with the master; for each Alexandria file, in the way a
//   rasteriser reads the font, EVERY glyph's outline and advance at every used weight plus a sweep (400-900 step 25) must be
//   identical to the master's, and the master and the slim file pinned to a static instance at each used weight must give
//   byte-identical glyf/hmtx/GPOS/GDEF/GSUB/cmap/gasp. The browser-level proof (pixels, platform fonts, text widths) is
//   npm run test:fonts-used.
//
// Needs python3 with fontTools and brotli (pip install fonttools brotli). No npm dependency.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, mkdtempSync, copyFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(HERE, '..')
const REPO = path.resolve(WEB, '..')
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }

const MASTERS = path.resolve(opt('--masters', path.join(REPO, 'brand', 'fonts-original')))
const USED = path.resolve(opt('--used', path.join(MASTERS, 'used-weights.json')))
const OUT = path.resolve(opt('--out', path.join(WEB, 'public', 'fonts')))
const STAGE2 = opt('--stage2', '')
const sha = (b) => createHash('sha256').update(b).digest('hex')

// ---------------------------------------------------------------------------------------------------------------
// The Python half. One script, driven by JSON on stdin, answering JSON on stdout. `python3 -I` so a stray file in the
// current directory cannot shadow fontTools.
// ---------------------------------------------------------------------------------------------------------------
const PY = String.raw`
import sys, json, io, os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

def load(p):
    return TTFont(p, recalcBBoxes=False, recalcTimestamp=False)

def save(t, p):
    t.flavor = 'woff2'
    t.recalcTimestamp = False
    t.save(p)

def table_bytes(t, tag):
    return t.getTableData(tag) if hasattr(t, 'getTableData') else t.reader[tag]

def tags(t, tab):
    if tab not in t: return []
    return sorted({f.FeatureTag for f in t[tab].table.FeatureList.FeatureRecord}) if t[tab].table.FeatureList else []

def info(p):
    t = load(p)
    o = {'glyphs': len(t.getGlyphOrder()), 'cmap': len(t.getBestCmap()), 'tables': sorted(k for k in t.keys() if k != 'GlyphOrder'),
         'weightClass': t['OS/2'].usWeightClass, 'gsub': tags(t, 'GSUB'), 'gpos': tags(t, 'GPOS'),
         'post': t['post'].formatType, 'name': t['name'].getDebugName(4), 'ps': t['name'].getDebugName(6),
         'sizes': {k: v.length for k, v in t.reader.tables.items()}}
    if 'fvar' in t:
        o['axes'] = [{'tag': a.axisTag, 'min': a.minValue, 'default': a.defaultValue, 'max': a.maxValue} for a in t['fvar'].axes]
    cps = sorted(t.getBestCmap().keys())
    o['codepoints'] = cps
    return o

def slim(a):
    t = load(a['src'])
    if a.get('limit') and 'fvar' in t:
        lo, hi = a['limit']
        ax = [x for x in t['fvar'].axes if x.axisTag == 'wght'][0]
        if lo > ax.minValue or hi < ax.maxValue:
            if lo < ax.defaultValue or hi < ax.defaultValue:
                raise SystemExit('range %s-%s is not on one side of the default %s: only a cut of the lower half is implemented' % (lo, hi, ax.defaultValue))
            # gvar is NOT left to the instancer. Its default (optimize=True) re-runs IUP optimisation with a 0.5 unit tolerance on
            # the kept tuples (moved 'degree' by 0.5 unit), and optimize=False expands every inferred delta to a rounded
            # integer (moved 46 glyphs by up to 0.5 unit). Either way the kept half is no longer the master's. So: let the
            # instancer rewrite fvar/avar/HVAR/GDEF/GPOS (variation stores keep integer deltas of the kept regions
            # untouched), then put back the master's own gvar with the lower-half (negative-peak) tuples removed.
            gv = t['gvar']
            keep = {}
            for g, vs in gv.variations.items():
                out = []
                for v in vs:
                    a_ = v.axes.get('wght')
                    if a_ is None: out.append(v); continue
                    s_, p_, e_ = a_
                    if p_ < 0 and e_ <= 0: continue            # lower half only: dropped
                    if s_ < 0: raise SystemExit('tuple of %s spans the default master (%s): cannot cut it exactly' % (g, a_))
                    out.append(v)
                keep[g] = out
            inst = instancer.instantiateVariableFont(t, {'wght': (lo, hi)}, inplace=False, optimize=False,
                                                     overlap=instancer.OverlapMode.KEEP_AND_DONT_SET_FLAGS, updateFontNames=False)
            gv2 = inst['gvar']
            gv2.variations = keep
            t = inst
    if not a.get('glyphNames', False):
        p = t['post']
        p.formatType = 3.0
        p.extraNames = []
        p.mapping = {}
    save(t, a['dst'])
    return {'bytes': os.path.getsize(a['dst'])}

STATIC_SAME = ['glyf', 'hmtx', 'cmap', 'GSUB', 'gasp', 'prep', 'fpgm', 'cvt ', 'hhea', 'maxp', 'OS/2', 'name']
INST_SAME = ['glyf', 'hmtx', 'GPOS', 'GDEF', 'GSUB', 'cmap', 'gasp']

def bytes_of(t, tag):
    return t.getTableData(tag)

def verify(a):
    m = load(a['master']); s = load(a['slim'])
    res = {'checks': 0, 'failures': []}
    def ck(name, ok, detail=''):
        res['checks'] += 1
        if not ok: res['failures'].append(name + (': ' + str(detail) if detail else ''))
    ck('glyph count', len(m.getGlyphOrder()) == len(s.getGlyphOrder()), (len(m.getGlyphOrder()), len(s.getGlyphOrder())))
    # glyph NAMES differ on purpose (post 3.0), so compare code point -> glyph index
    mo = {n: i for i, n in enumerate(m.getGlyphOrder())}; so = {n: i for i, n in enumerate(s.getGlyphOrder())}
    ck('cmap (code point -> glyph index)', {c: mo[n] for c, n in m.getBestCmap().items()} == {c: so[n] for c, n in s.getBestCmap().items()})
    ck('GSUB features', tags(m, 'GSUB') == tags(s, 'GSUB'))
    ck('GPOS features', tags(m, 'GPOS') == tags(s, 'GPOS'))
    ck('upem', m['head'].unitsPerEm == s['head'].unitsPerEm)
    ck('hhea metrics', (m['hhea'].ascent, m['hhea'].descent, m['hhea'].lineGap) == (s['hhea'].ascent, s['hhea'].descent, s['hhea'].lineGap))
    ck('OS/2 metrics', all(getattr(m['OS/2'], k) == getattr(s['OS/2'], k) for k in ('sTypoAscender', 'sTypoDescender', 'sTypoLineGap', 'usWinAscent', 'usWinDescent', 'fsSelection', 'usWeightClass')))
    ck('name table text', {(n.nameID, n.platformID, n.langID): str(n) for n in m['name'].names if n.nameID in (1, 2, 4, 6, 16, 17)} ==
                          {(n.nameID, n.platformID, n.langID): str(n) for n in s['name'].names if n.nameID in (1, 2, 4, 6, 16, 17)})
    ck('same table set modulo post names', sorted(k for k in m.keys() if k != 'GlyphOrder') == sorted(k for k in s.keys() if k != 'GlyphOrder'))
    isvar = 'fvar' in m
    ck('variable-ness', isvar == ('fvar' in s))
    if not isvar:
        for tag in ['glyf', 'hmtx', 'cmap', 'GSUB', 'GPOS', 'GDEF', 'gasp', 'prep', 'fpgm', 'cvt ']:
            if tag in m:
                ck('table ' + tag + ' identical', tag in s and bytes_of(m, tag) == bytes_of(s, tag))
    else:
        for tag in ['glyf', 'hmtx', 'cmap', 'GSUB', 'gasp', 'prep']:
            ck('table ' + tag + ' identical', bytes_of(m, tag) == bytes_of(s, tag))
        lo, hi = a['limit']
        sa = [x for x in s['fvar'].axes if x.axisTag == 'wght'][0]
        ck('slim axis range', (sa.minValue, sa.maxValue) == (lo, hi), (sa.minValue, sa.maxValue))
        # (1) the sweep, in the spec path (what a rasteriser does): every glyph's outline and advance, master vs slim
        from fontTools.pens.recordingPen import DecomposingRecordingPen
        mo_names = m.getGlyphOrder(); so_names = s.getGlyphOrder()
        for w in a['sweep']:
            gm = m.getGlyphSet(location={'wght': w}); gs = s.getGlyphSet(location={'wght': w})
            bad = 0; badw = 0
            for x, y in zip(mo_names, so_names):
                pa = DecomposingRecordingPen(gm); gm[x].draw(pa)
                pb = DecomposingRecordingPen(gs); gs[y].draw(pb)
                if pa.value != pb.value: bad += 1
                if gm[x].width != gs[y].width: badw += 1
            ck('wght=%g outlines (%d glyphs)' % (w, len(mo_names)), bad == 0, '%d glyphs differ' % bad)
            ck('wght=%g advances' % w, badw == 0, '%d glyphs differ' % badw)
        # (2) the used weights, pinned to a static instance: the compiled glyf/hmtx/GPOS/GDEF must be the same bytes
        for w in a['weights']:
            mi = instancer.instantiateVariableFont(load(a['master']), {'wght': w}, inplace=False, optimize=False, overlap=instancer.OverlapMode.KEEP_AND_DONT_SET_FLAGS)
            si = instancer.instantiateVariableFont(load(a['slim']), {'wght': w}, inplace=False, optimize=False, overlap=instancer.OverlapMode.KEEP_AND_DONT_SET_FLAGS)
            for tag in INST_SAME:
                if tag in mi:
                    ck('wght=%g static %s' % (w, tag), tag in si and bytes_of(mi, tag) == bytes_of(si, tag))
    return res

def sametables(a):
    # Same font, possibly compressed differently: every table of both files, after the WOFF2 container is undone, is the same bytes.
    # (The WOFF2 bytes depend on the brotli build and on fontTools' choices, so they can differ between two machines that agree on
    # every glyph, every table and every pixel.)
    x = load(a['a']); y = load(a['b'])
    kx = sorted(k for k in x.keys() if k != 'GlyphOrder'); ky = sorted(k for k in y.keys() if k != 'GlyphOrder')
    if kx != ky:
        return {'same': False, 'why': 'table sets differ: %s vs %s' % (kx, ky)}
    bad = [k for k in kx if x.getTableData(k) != y.getTableData(k)]
    return {'same': not bad, 'why': ('tables differ: ' + ' '.join(bad)) if bad else '', 'tables': len(kx),
            'brotli': getattr(__import__('brotli'), '__version__', '?'), 'fonttools': __import__('fontTools').version}

def stage2(a):
    from fontTools import subset
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = True
    opts.name_IDs = ['*']
    opts.name_languages = ['*']
    opts.legacy_kern = True
    opts.recalc_bounds = False
    opts.recalc_timestamp = False
    opts.flavor = 'woff2'
    f = subset.load_font(a['src'], opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=a['unicodes'])
    sub.subset(f)
    subset.save_font(f, a['dst'], opts)
    return {'bytes': os.path.getsize(a['dst']), 'cmap': len(f.getBestCmap())}

a = json.load(sys.stdin)
cmd = a.pop('cmd')
print(json.dumps({'info': info, 'slim': slim, 'verify': verify, 'stage2': stage2, 'sametables': sametables}[cmd](a['path'] if cmd == 'info' else a)))
`

export const py = (payload) => {
  const r = spawnSync('python3', ['-I', '-c', PY], { input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 1 << 28, timeout: 15 * 60 * 1000 })
  if (r.status !== 0) throw new Error('python3 failed (' + payload.cmd + '): ' + (r.stderr || r.error || '').toString().trim().split('\n').slice(-4).join(' | '))
  return JSON.parse(r.stdout.trim().split('\n').pop())
}

// ---------------------------------------------------------------------------------------------------------------
// Which weights are used: brand/fonts-original/used-weights.json
// ---------------------------------------------------------------------------------------------------------------
export function readUsed(file = USED) {
  if (!existsSync(file)) throw new Error('used-weights file missing: ' + file + ' (npm run test:fonts-used -- --write-used writes it from a crawl)')
  const j = JSON.parse(readFileSync(file, 'utf8'))
  const w = j.alexandria?.wght?.used
  if (!Array.isArray(w) || !w.length || !w.every((x) => Number.isFinite(x) && x >= 1 && x <= 1000)) throw new Error('used-weights.json: alexandria.wght.used must be a non-empty list of weights')
  const plex = Object.keys(j.plex?.faces || {}).map(Number)
  if (!plex.length) throw new Error('used-weights.json: plex.faces is empty')
  // wght.range = [min, max] is what the file must keep. It is the used list widened by every declared weight the crawl could
  // not tie to a Plex-only element, so an unresolved rule can only widen the range, never narrow it.
  const r = j.alexandria.wght.range
  const lo = Array.isArray(r) ? Math.min(r[0], ...w) : Math.min(...w), hi = Array.isArray(r) ? Math.max(r[1], ...w) : Math.max(...w)
  return { raw: j, alexandria: { used: [...new Set(w)].sort((a, b) => a - b), min: lo, max: hi }, plex: new Set(plex) }
}

const kind = (name) => {
  let m = name.match(/^alexandria-var-(latin|arabic)\.woff2$/)
  if (m) return { type: 'alexandria', script: m[1] }
  m = name.match(/^plex-(\d+)-(latin|arabic)\.woff2$/)
  if (m) return { type: 'plex', weight: Number(m[1]), script: m[2] }
  return null
}

// Build every output into dir; returns the rows. Throws on UNUSED (exit 2) unless --drop-unused.
export const fontInfo = (file) => py({ cmd: 'info', path: file })

export function build(dir, { used = readUsed(), glyphNames = flag('--keep-glyph-names'), verify = !flag('--no-verify'), dropUnused = flag('--drop-unused'), plan = false } = {}) {
  const rows = []
  const names = readdirSync(MASTERS).filter((n) => n.endsWith('.woff2')).sort()
  if (!names.length) throw new Error('no masters in ' + MASTERS)
  const unused = []
  for (const n of names) {
    const k = kind(n)
    if (!k) throw new Error('unrecognised master ' + n + ' (expected alexandria-var-<script>.woff2 or plex-<weight>-<script>.woff2)')
    const src = path.join(MASTERS, n)
    const masterBytes = readFileSync(src)
    const row = { file: n, ...k, master: masterBytes.length, masterSha: sha(masterBytes).slice(0, 16) }
    if (k.type === 'plex' && !used.plex.has(k.weight)) { row.action = 'UNUSED'; unused.push(n); if (!dropUnused) { rows.push(row); continue } else { row.action = 'dropped'; rows.push(row); continue } }
    row.action = k.type === 'alexandria' ? `wght ${used.alexandria.min}-${used.alexandria.max}` : 'weight ' + k.weight + ' kept'
    if (plan) { rows.push(row); continue }
    const dst = path.join(dir, n)
    const r = py({ cmd: 'slim', src, dst, limit: k.type === 'alexandria' ? [used.alexandria.min, used.alexandria.max] : null, glyphNames })
    let out = readFileSync(dst)
    if (out.length >= masterBytes.length) { copyFileSync(src, dst); out = masterBytes; row.action += ' (not smaller: master bytes kept)' }
    row.out = out.length
    row.outSha = sha(out).slice(0, 16)
    if (verify && out !== masterBytes && sha(out) !== sha(masterBytes)) {
      const v = py({ cmd: 'verify', master: src, slim: dst, limit: k.type === 'alexandria' ? [used.alexandria.min, used.alexandria.max] : null,
        weights: used.alexandria.used,
        sweep: [...new Set([...used.alexandria.used, ...Array.from({ length: Math.floor((used.alexandria.max - used.alexandria.min) / 25) + 1 }, (_, i) => used.alexandria.min + i * 25)])].sort((a, b) => a - b) })
      row.checks = v.checks
      row.failures = v.failures
    } else if (verify) { row.checks = 0; row.failures = [] }
    rows.push(row)
    void r
  }
  if (unused.length && !dropUnused) {
    const e = new Error('UNUSED plex face(s): ' + unused.join(', ') + '. Nothing on the crawl draws them, but the compiled stylesheet declares an @font-face for each, so deleting the file would leave a declared face that 404s. Remove the @font-face first (or pass --drop-unused).')
    e.code = 'UNUSED'; e.rows = rows
    throw e
  }
  return rows
}

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
function table(rows) {
  const pad = (s, n) => String(s).padEnd(n)
  let tm = 0, to = 0
  const lines = [pad('file', 28) + pad('master', 9) + pad('slim', 9) + pad('saved', 8) + pad('%', 7) + 'what']
  for (const r of rows) {
    if (r.out == null) { lines.push(pad(r.file, 28) + pad(fmt(r.master), 9) + pad('-', 9) + pad('-', 8) + pad('-', 7) + r.action); continue }
    tm += r.master; to += r.out
    lines.push(pad(r.file, 28) + pad(fmt(r.master), 9) + pad(fmt(r.out), 9) + pad(fmt(r.master - r.out), 8) + pad((100 * (r.master - r.out) / r.master).toFixed(1), 7) + r.action + (r.checks ? `  [${r.checks} checks, ${r.failures.length} failed]` : ''))
  }
  lines.push(pad('TOTAL', 28) + pad(fmt(tm), 9) + pad(fmt(to), 9) + pad(fmt(tm - to), 8) + pad(tm ? (100 * (tm - to) / tm).toFixed(1) : '0', 7))
  return lines.join('\n')
}

// ---------------------------------------------------------------------------------------------------------------
async function main() {
  const used = readUsed()
  console.log(`masters ${path.relative(REPO, MASTERS)}  used-weights ${path.relative(REPO, USED)}  Alexandria wght ${used.alexandria.min}-${used.alexandria.max} (used: ${used.alexandria.used.join(' ')})  Plex faces ${[...used.plex].sort().join(' ')}`)
  if (flag('--plan')) { console.log(table(build(OUT, { used, plan: true }))); return }

  if (STAGE2) {
    // Optional second stage, scratch only. Codepoints = the corpus file (JSON array of numbers) unioned with ASCII and the
    // punctuation/number blocks, so a glyph the shop prints is never lost. Never writes into public/fonts.
    const corpus = JSON.parse(readFileSync(opt('--corpus', path.join(MASTERS, 'corpus-codepoints.json')), 'utf8'))
    mkdirSync(STAGE2, { recursive: true })
    for (const n of readdirSync(MASTERS).filter((x) => x.endsWith('.woff2')).sort()) {
      const k = kind(n)
      const base = path.join(OUT, n)
      const src = existsSync(base) ? base : path.join(MASTERS, n)
      const i = py({ cmd: 'info', path: src })
      const want = corpus.filter((c) => i.codepoints.includes(c))
      const r = py({ cmd: 'stage2', src, dst: path.join(STAGE2, n), unicodes: want })
      console.log(`stage2 ${n}: ${fmt(statSync(src).size)} -> ${fmt(r.bytes)} B, ${i.cmap} -> ${r.cmap} code points (${k.type} ${k.script})`)
    }
    console.log('stage 2 written to ' + STAGE2 + ' ONLY. Not applied: see the header of this file.')
    return
  }

  if (flag('--check')) {
    const tmp = mkdtempSync(path.join(tmpdir(), 'slim-fonts-'))
    try {
      const rows = build(tmp, { used, verify: false })
      let bad = 0, recompressed = 0
      for (const r of rows) {
        const have = existsSync(path.join(OUT, r.file)) ? sha(readFileSync(path.join(OUT, r.file))).slice(0, 16) : 'MISSING'
        let ok = have === r.outSha, how = ''
        // Same bytes is the strong answer. Different bytes are still the same font when every table is the same once the WOFF2 container
        // is undone: that is what a different brotli build or fontTools release does to a rebuild made on another machine. --strict-bytes
        // refuses that and asks for the very same bytes.
        if (!ok && have !== 'MISSING' && !flag('--strict-bytes')) {
          const c = py({ cmd: 'sametables', a: path.join(OUT, r.file), b: path.join(tmp, r.file) })
          if (c.same) { ok = true; recompressed++; how = `  (same ${c.tables} tables, other compression; this machine: brotli ${c.brotli}, fontTools ${c.fonttools})` }
          else how = '  ' + c.why
        }
        if (!ok) bad++
        console.log((ok ? 'ok    ' : 'DIFF  ') + r.file + '  shipped ' + have + '  rebuilt ' + r.outSha + how)
      }
      console.log(bad ? `FAIL: ${bad} shipped file(s) are not the rebuild of the masters. Run: node scripts/slim-fonts.mjs`
        : recompressed ? `ok: public/fonts is the rebuild of brand/fonts-original (${recompressed} file(s) compressed differently by this machine's brotli; every table is the same)`
        : 'ok: public/fonts is exactly the rebuild of brand/fonts-original')
      process.exitCode = bad ? 1 : 0
    } finally { rmSync(tmp, { recursive: true, force: true }) }
    return
  }

  mkdirSync(OUT, { recursive: true })
  let rows
  try { rows = build(OUT, { used }) } catch (e) {
    if (e.code === 'UNUSED') { console.error(table(e.rows)); console.error('\n' + e.message); process.exit(2) }
    throw e
  }
  console.log(table(rows))
  const failed = rows.filter((r) => r.failures?.length)
  for (const r of failed) console.error('VERIFY FAILED ' + r.file + ':\n  ' + r.failures.join('\n  '))
  if (failed.length) process.exit(1)
  console.log(`\nwritten to ${path.relative(REPO, OUT)}. Verified: ${rows.reduce((a, r) => a + (r.checks || 0), 0)} font-level checks, 0 failed.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1) })
}
