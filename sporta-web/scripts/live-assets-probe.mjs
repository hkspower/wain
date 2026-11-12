#!/usr/bin/env node
// LIVE ASSETS PROBE — every asset the live web root holds and serves. READ-ONLY.
//
// Made for one-shot VPS jobs (node:24-alpine for MODE=disk|http, the Playwright image for MODE=browser),
// with /docker/sporta mounted READ-ONLY at /sporta. It lstat()s and reads files under /sporta/site and
// lists names/sizes under /sporta/private/media (public product photos; first bytes only, for the image
// header). It never writes, never follows a symlink, and over the network sends GET requests only.
// Nothing under /sporta/private other than media/ is opened or listed.
//
//   MODE=disk     tree, /assets reachability (orphans), raw/gzip/brotli sizes, duplicates, strays,
//                 fonts (@font-face, preloads), images (dimensions, weight, variants), manifests, case
//   MODE=http     what the server SENDS per tier: status, content-encoding for br / gzip / identity,
//                 cache-control, content-type, vary, size on the wire
//   MODE=browser  per page x language x width: fonts fetched and used, images displayed vs natural,
//                 unused preloads, 404s, JS/CSS coverage on the home page
//
// Output is compact (a job log keeps 300 entries). Run:
//   node live-assets-probe.mjs            (MODE env picks the part; default disk)
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import https from 'node:https'
import { createHash } from 'node:crypto'

const MODE = process.env.MODE || 'disk'
const SITE = process.env.SITE_ROOT || '/sporta/site'
const MEDIA = process.env.MEDIA_ROOT || '/sporta/private/media'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const say = (s) => console.log(String(s).slice(0, 900))
const kb = (n) => (n / 1024).toFixed(1)

// ------------------------------------------------------------------ helpers
function walk(root, skip) {
  const out = new Map()
  ;(function w(dir) {
    let ents
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const abs = path.join(dir, e.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (skip && skip(rel)) continue
      if (e.isSymbolicLink()) { out.set(rel, { size: 0, link: true, mtime: 0 }); continue }
      if (e.isDirectory()) { w(abs); continue }
      if (!e.isFile()) continue
      let st; try { st = fs.lstatSync(abs) } catch { continue }
      out.set(rel, { size: st.size, mtime: st.mtimeMs, link: false })
    }
  })(root)
  return out
}
const readHead = (abs, n) => { try { const fd = fs.openSync(abs, 'r'); const b = Buffer.alloc(n); const k = fs.readSync(fd, b, 0, n, 0); fs.closeSync(fd); return b.subarray(0, k) } catch { return Buffer.alloc(0) } }
const day = (ms) => new Date(ms).toISOString().slice(0, 10)

function imgDims(buf, ext) {
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50) return { f: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue }
        const m = buf[i + 1]
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { f: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), prog: m === 0xc2 }
        i += 2 + buf.readUInt16BE(i + 2)
      }
      return { f: 'jpeg', w: 0, h: 0 }
    }
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const c = buf.toString('ascii', 12, 16)
      if (c === 'VP8X') return { f: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
      if (c === 'VP8L') { const b = buf.readUInt32LE(21); return { f: 'webp', w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) } }
      if (c === 'VP8 ') return { f: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
    }
    if (buf.toString('ascii', 0, 3) === 'GIF') return { f: 'gif', w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
    if (buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) {
      const n = buf.readUInt16LE(4); const s = []
      for (let k = 0; k < n && 6 + 16 * k + 16 <= buf.length; k++) { const w = buf[6 + 16 * k] || 256; const h = buf[7 + 16 * k] || 256; const fmt = buf.readUInt32BE(buf.readUInt32LE(6 + 16 * k + 12)) === 0x89504e47 ? 'png' : 'bmp'; s.push(w + 'x' + h + (fmt === 'png' ? 'p' : '')) }
      return { f: 'ico', w: 0, h: 0, ico: s.join(',') }
    }
    if (ext === '.svg') {
      const t = buf.toString('utf8')
      const w = /<svg[^>]*\swidth="([\d.]+)/.exec(t), h = /<svg[^>]*\sheight="([\d.]+)/.exec(t), vb = /viewBox="([^"]+)"/.exec(t)
      return { f: 'svg', w: w ? +w[1] : 0, h: h ? +h[1] : 0, vb: vb ? vb[1] : '' }
    }
    if (buf.toString('ascii', 4, 12).includes('ftypavif')) return { f: 'avif', w: 0, h: 0 }
  } catch {}
  return { f: '?', w: 0, h: 0 }
}

// reference extraction (loose, like old-files-inventory.mjs: errs towards "referenced")
function refsOf(text, fromRel) {
  const out = new Set()
  const add = (u) => {
    if (!u) return
    u = u.trim().replace(/^['"]|['"]$/g, '')
    if (/^(data:|blob:|mailto:|tel:|javascript:|#)/i.test(u)) return
    if (/^https?:\/\//i.test(u)) { if (!u.startsWith('https://www.sporta.com.kw/')) return; u = u.slice('https://www.sporta.com.kw'.length) }
    u = u.split('#')[0].split('?')[0]
    if (!u || u.length > 200) return
    if (!/\.[a-z0-9]{2,12}$/i.test(u)) return
    let p
    if (u.startsWith('/')) p = u.slice(1)
    else p = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), u))
    if (p.startsWith('..')) return
    out.add(p)
  }
  for (const m of text.matchAll(/(?:src|href|content|poster|srcset|data-src)\s*=\s*["']([^"']+)["']/gi)) for (const part of m[1].split(',')) add(part.trim().split(/\s+/)[0])
  for (const m of text.matchAll(/url\(\s*([^)]+?)\s*\)/gi)) add(m[1])
  for (const m of text.matchAll(/@import\s+["']([^"']+)["']/gi)) add(m[1])
  for (const m of text.matchAll(/["'`]((?:\.{0,2}\/)?[\w@.\/-]*[\w-]+\.(?:m?js|css|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico|json|webmanifest|txt|xml|html))["'`]/gi)) add(m[1])
  return out
}

// ======================================================================== DISK
async function disk() {
  if (!fs.existsSync(path.join(SITE, 'index.html'))) { say('ASSETS_FAIL no ' + SITE + '/index.html'); process.exit(1) }
  const SECRET = /(^|\/)(config\.php|\.env[\w.-]*|\.cbk_token\.json|.*\.pem|.*\.key)$/i
  const all = walk(SITE)
  // ---- tree
  const top = new Map()
  for (const [rel, f] of all) { const t = rel.includes('/') ? rel.split('/')[0] + '/' : '(root files)'; const v = top.get(t) || { n: 0, b: 0 }; v.n++; v.b += f.size; top.set(t, v) }
  say('TREE files=' + all.size + ' bytes=' + kb([...all.values()].reduce((a, f) => a + f.size, 0)) + 'k  ' + [...top].sort((a, b) => b[1].b - a[1].b).map(([t, v]) => t + ' ' + v.n + 'f/' + kb(v.b) + 'k').join(' | '))
  const rootFiles = [...all.keys()].filter((r) => !r.includes('/')).sort()
  say('ROOTFILES ' + rootFiles.map((r) => r + '(' + kb(all.get(r).size) + 'k)').join(' '))

  // ---- reachability from the platform roots
  const ROOTS = ['index.html', '.htaccess', 'robots.txt', 'sitemap.xml', 'site.webmanifest', 'sw.js', 'llms.txt', 'backends-offline.html', 'backends.webmanifest', 'favicon.ico']
  const TEXT = /\.(m?js|css|html?|json|webmanifest|xml|txt|svg)$|^\.htaccess$/i
  const reached = new Map() // rel -> referrer
  const missing = new Map() // rel -> referrer
  const lower = new Map(); for (const r of all.keys()) lower.set(r.toLowerCase(), r)
  const q = []
  for (const r of ROOTS) if (all.has(r)) { reached.set(r, '(root)'); q.push(r) }
  while (q.length) {
    const r = q.shift()
    if (!TEXT.test(path.basename(r)) && r !== '.htaccess') continue
    if (all.get(r).size > 6e6) continue
    let t; try { t = fs.readFileSync(path.join(SITE, r), 'utf8') } catch { continue }
    for (const p of refsOf(t, r)) {
      if (all.has(p)) { if (!reached.has(p)) { reached.set(p, r); q.push(p) } }
      else if (lower.has(p.toLowerCase())) { const real = lower.get(p.toLowerCase()); say('CASE ref=' + p + ' disk=' + real + ' <- ' + r); if (!reached.has(real)) { reached.set(real, r); q.push(real) } }
      else if (/^(assets|fonts|images|hero|cats|icons|brand)\//.test(p) || /\.(woff2?|png|jpe?g|webp|svg|ico|css|js)$/.test(p)) { if (!missing.has(p) && !/^(api|knet|pay)\//.test(p)) missing.set(p, r) }
    }
  }
  const inBackup = (r) => /^(backups?|rollback|old|bak)\//i.test(r)
  // ---- /assets
  const assets = [...all].filter(([r]) => r.startsWith('assets/'))
  const byExt = new Map()
  for (const [r, f] of assets) { const e = path.extname(r) || '(none)'; const v = byExt.get(e) || { n: 0, b: 0, rn: 0, rb: 0 }; v.n++; v.b += f.size; if (reached.has(r)) { v.rn++; v.rb += f.size }; byExt.set(e, v) }
  say('ASSETS total=' + assets.length + ' ' + [...byExt].map(([e, v]) => e + ' ' + v.n + 'f/' + kb(v.b) + 'k reached ' + v.rn + 'f/' + kb(v.rb) + 'k').join(' | '))
  const orphans = assets.filter(([r]) => !reached.has(r)).sort((a, b) => b[1].size - a[1].size)
  const ob = orphans.reduce((a, [, f]) => a + f.size, 0)
  const omonths = new Map(); for (const [, f] of orphans) { const m = day(f.mtime).slice(0, 7); omonths.set(m, (omonths.get(m) || 0) + 1) }
  say('ORPHAN_ASSETS n=' + orphans.length + ' bytes=' + kb(ob) + 'k by-month ' + [...omonths].sort().map(([m, n]) => m + ':' + n).join(' '))
  say('ORPHAN_TOP ' + orphans.slice(0, 30).map(([r, f]) => r.slice(7) + ' ' + kb(f.size) + 'k ' + day(f.mtime)).join(' ; '))
  // which entry
  const idx = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8')
  const tags = [...idx.matchAll(/<(script|link)\b[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, ' '))
  say('INDEX bytes=' + idx.length + ' tags=' + tags.length)
  for (const t of tags) say('  TAG ' + t.slice(0, 220))
  // reachable js/css sizes with compression
  const comp = (buf) => ({ g: zlib.gzipSync(buf, { level: 9 }).length, br: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length })
  const rows = []
  for (const [r] of reached) {
    if (!/\.(m?js|css|svg|json|webmanifest|html|xml|txt)$/i.test(r) || inBackup(r)) continue
    const f = all.get(r); if (f.size > 8e6) continue
    const buf = fs.readFileSync(path.join(SITE, r)); const c = comp(buf)
    const hasMap = /sourceMappingURL=/.test(buf.subarray(Math.max(0, buf.length - 300)).toString())
    const pre = all.has(r + '.br') ? 'br' : '', preg = all.has(r + '.gz') ? 'gz' : ''
    const minified = /\.(js|css)$/.test(r) ? (buf.toString().split('\n').length / Math.max(1, buf.length / 1000)) : 0
    rows.push({ r, raw: f.size, g: c.g, br: c.br, hasMap, pre: pre + preg, lpk: minified })
  }
  rows.sort((a, b) => b.raw - a.raw)
  const sum = (k, rr) => rr.reduce((a, x) => a + x[k], 0)
  const js = rows.filter((x) => /\.m?js$/.test(x.r)), css = rows.filter((x) => /\.css$/.test(x.r))
  say('REACHED_JS n=' + js.length + ' raw=' + kb(sum('raw', js)) + 'k gz=' + kb(sum('g', js)) + 'k br=' + kb(sum('br', js)) + 'k | CSS n=' + css.length + ' raw=' + kb(sum('raw', css)) + 'k gz=' + kb(sum('g', css)) + 'k br=' + kb(sum('br', css)) + 'k')
  for (const x of rows.slice(0, 45)) say('  SZ ' + x.r + ' raw=' + kb(x.raw) + ' gz=' + kb(x.g) + ' br=' + kb(x.br) + ' lines/kB=' + x.lpk.toFixed(1) + (x.hasMap ? ' MAPREF' : '') + (x.pre ? ' pre=' + x.pre : '') + ' <- ' + reached.get(x.r))
  // add-ons (root-level css/js) not reached
  for (const r of rootFiles) if (/\.(js|css|html?|json|txt|xml|svg|png|jpe?g|webp|ico|webmanifest)$/i.test(r) && !reached.has(r)) say('ROOT_UNREACHED ' + r + ' ' + kb(all.get(r).size) + 'k ' + day(all.get(r).mtime))
  for (const [p, r] of [...missing].slice(0, 30)) say('MISSING ' + p + ' <- ' + r)

  // ---- duplicates (sha256), outside backups
  const hashes = new Map()
  for (const [r, f] of all) {
    if (f.link || f.size === 0 || SECRET.test(r) || inBackup(r) || f.size > 20e6) continue
    if (/^(api|knet|pay)\//.test(r) && /\.php$/.test(r)) continue
    const h = createHash('sha256').update(fs.readFileSync(path.join(SITE, r))).digest('hex').slice(0, 12)
    const v = hashes.get(h) || []; v.push(r); hashes.set(h, v)
  }
  const dups = [...hashes].filter(([, v]) => v.length > 1).sort((a, b) => all.get(b[1][0]).size * b[1].length - all.get(a[1][0]).size * a[1].length)
  say('DUP_GROUPS n=' + dups.length + ' wasted=' + kb(dups.reduce((a, [, v]) => a + all.get(v[0]).size * (v.length - 1), 0)) + 'k')
  for (const [h, v] of dups.slice(0, 20)) say('  DUP ' + kb(all.get(v[0]).size) + 'k x' + v.length + ' ' + v.slice(0, 5).join(' = '))
  // same chunk stem, many hashes (old builds)
  const stems = new Map()
  for (const [r] of assets) { const m = /^assets\/(.+?)-[\w-]{8}\.(js|css)$/.exec(r); if (m) { const k = m[1] + '.' + m[2]; const v = stems.get(k) || []; v.push(r); stems.set(k, v) } }
  const multi = [...stems].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length)
  say('STEMS_MULTI n=' + multi.length + ' ' + multi.slice(0, 25).map(([k, v]) => k + ' x' + v.length + '(' + v.filter((r) => reached.has(r)).length + ' live)').join(' '))

  // ---- strays (names only)
  const STRAY = [
    ['appledouble', /(^|\/)\._/], ['ds_store', /(^|\/)\.DS_Store$/], ['thumbs', /(^|\/)(Thumbs\.db|desktop\.ini)$/i],
    ['map', /\.map$/i], ['backup_ext', /\.(bak|old|orig|save|swp|tmp|temp)$|~$/i], ['archive', /\.(zip|tar|tgz|gz|rar|7z|bz2)$/i],
    ['dump', /\.(sql|sqlite|db|dump|log|csv)$/i], ['php_outside', /^(?!(api|knet|pay)\/).*\.(php\d?|phtml)$/i], ['copy_name', /( copy|\(\d\)|-copy|_copy|\.copy)\./i],
    ['source_design', /\.(psd|ai|sketch|fig|xcf|tiff?|heic|raw|cr2|mov|mp4)$/i], ['wordpress', /(^|\/)(wp-|xmlrpc|wp-content)/i], ['dotfile', /(^|\/)\.(?!htaccess$|well-known)[^/]+$/],
    ['html_page', /^(?!index\.html$|backends-offline\.html$)[^/]+\.html?$/i], ['vcs', /(^|\/)\.(git|svn|hg)(\/|$)/], ['readme', /(^|\/)(readme|changelog|license)(\.\w+)?$/i],
  ]
  const strays = new Map()
  for (const [r, f] of all) {
    if (inBackup(r)) continue
    for (const [k, re] of STRAY) if (re.test(r)) { if (k === 'archive' && all.has(r.replace(/\.gz$/, ''))) continue; const v = strays.get(k) || []; v.push(r + ' ' + kb(f.size) + 'k ' + day(f.mtime) + (SECRET.test(r) ? ' [secret-shaped:not-read]' : '')); strays.set(k, v) }
  }
  for (const [k, v] of strays) say('STRAY ' + k + ' n=' + v.length + ' :: ' + v.slice(0, 25).join(' ; '))
  const bk = [...all].filter(([r]) => inBackup(r)); say('BACKUPS_IN_WEBROOT files=' + bk.length + ' bytes=' + kb(bk.reduce((a, [, f]) => a + f.size, 0)) + 'k')
  const links = [...all].filter(([, f]) => f.link); if (links.length) say('SYMLINKS ' + links.map(([r]) => r).join(' '))
  // empty files
  const empty = [...all].filter(([r, f]) => f.size === 0 && !f.link); if (empty.length) say('EMPTY_FILES ' + empty.map(([r]) => r).slice(0, 30).join(' '))

  // ---- fonts
  const fonts = [...all].filter(([r]) => /\.(woff2?|ttf|otf|eot)$/i.test(r) && !inBackup(r))
  say('FONTS_ON_DISK n=' + fonts.length + ' ' + fonts.map(([r, f]) => r + ' ' + kb(f.size) + 'k' + (reached.has(r) ? '' : ' UNREF')).join(' ; '))
  const faces = []
  for (const x of css.concat(rows.filter((x) => /\.html$/.test(x.r)))) {
    const t = fs.readFileSync(path.join(SITE, x.r), 'utf8')
    for (const m of t.matchAll(/@font-face\s*{([^}]*)}/gi)) {
      const body = m[1]
      const fam = (/font-family\s*:\s*([^;]+)/i.exec(body) || [])[1] || '', w = (/font-weight\s*:\s*([^;]+)/i.exec(body) || [])[1] || '', ur = (/unicode-range\s*:\s*([^;]+)/i.exec(body) || [])[1] || '', disp = (/font-display\s*:\s*([^;]+)/i.exec(body) || [])[1] || ''
      const src = [...body.matchAll(/url\(\s*['"]?([^'")]+)/gi)].map((u) => u[1].replace(location0, ''))
      faces.push(x.r + ' :: ' + fam.trim().slice(0, 30) + ' w=' + w.trim() + ' disp=' + disp.trim() + ' ur=' + ur.trim().slice(0, 40) + ' src=' + src.join(',').slice(0, 120))
    }
  }
  say('FONT_FACES n=' + faces.length)
  for (const f of faces.slice(0, 40)) say('  FF ' + f)
  for (const t of tags.filter((t) => /preload|preconnect|prefetch|modulepreload/i.test(t))) {
    const href = (/href="([^"]+)"/.exec(t) || [])[1] || ''
    const p = href.replace(/^https:\/\/www\.sporta\.com\.kw/, '').replace(/^\//, '').split('?')[0]
    say('PRELOAD ' + t.slice(0, 200) + (href.startsWith('http') && !href.includes('sporta.com.kw') ? ' [external]' : all.has(p) ? ' exists ' + kb(all.get(p).size) + 'k' : ' NOT-ON-DISK') + (/as="font"/.test(t) && !/crossorigin/.test(t) ? ' NO-CROSSORIGIN' : ''))
  }

  // ---- images in the web root
  const imgs = [...all].filter(([r]) => /\.(png|jpe?g|webp|avif|gif|svg|ico)$/i.test(r) && !inBackup(r))
  const idirs = new Map()
  const ilines = []
  for (const [r, f] of imgs) {
    const d = imgDims(readHead(path.join(SITE, r), /\.svg$/i.test(r) ? 4096 : 65536), path.extname(r).toLowerCase())
    const dir = r.includes('/') ? r.split('/').slice(0, r.split('/').length > 2 ? 2 : 1).join('/') : '(root)'
    const v = idirs.get(dir) || { n: 0, b: 0, ref: 0 }; v.n++; v.b += f.size; if (reached.has(r)) v.ref++; idirs.set(dir, v)
    const mism = d.f !== '?' && !path.extname(r).toLowerCase().includes(d.f === 'jpeg' ? 'jp' : d.f)
    ilines.push({ r, s: f.size, d, mism, ref: reached.has(r) })
  }
  say('IMAGES_WEBROOT n=' + imgs.length + ' bytes=' + kb(imgs.reduce((a, [, f]) => a + f.size, 0)) + 'k by-dir ' + [...idirs].map(([d, v]) => d + ' ' + v.n + 'f/' + kb(v.b) + 'k ref' + v.ref).join(' | '))
  ilines.sort((a, b) => b.s - a.s)
  for (const x of ilines.slice(0, 60)) say('  IMG ' + x.r + ' ' + kb(x.s) + 'k ' + x.d.f + ' ' + (x.d.ico || (x.d.w + 'x' + x.d.h)) + (x.d.vb ? ' vb=' + x.d.vb : '') + (x.d.prog ? ' progressive' : '') + (x.mism ? ' EXT-MISMATCH' : '') + (x.ref ? '' : ' unref'))
  if (ilines.length > 60) say('  IMG_REST ' + ilines.slice(60).map((x) => x.r + ':' + kb(x.s) + 'k:' + (x.d.w + 'x' + x.d.h)).join(' ').slice(0, 880))

  // ---- product media (names, sizes, first bytes only)
  if (fs.existsSync(MEDIA)) {
    const med = walk(MEDIA)
    const orig = [], resp = new Set(), other = []
    for (const [r, f] of med) {
      if (r.includes('/responsive/')) { resp.add(path.basename(r)); continue }
      if (/\.(png|jpe?g|webp|avif|gif)$/i.test(r)) orig.push([r, f]); else other.push(r + ' ' + f.size)
    }
    const dimsHist = new Map(); let ob2 = 0; const big = []; const noVar = []; const fmt = new Map()
    for (const [r, f] of orig) {
      ob2 += f.size
      const d = imgDims(readHead(path.join(MEDIA, r), 65536), path.extname(r).toLowerCase())
      fmt.set(d.f, (fmt.get(d.f) || 0) + 1)
      const k = Math.max(d.w, d.h); const bucket = k >= 2000 ? '>=2000' : k >= 1200 ? '1200-1999' : k >= 800 ? '800-1199' : '<800'
      dimsHist.set(bucket, (dimsHist.get(bucket) || 0) + 1)
      if (f.size > 300 * 1024) big.push(r + ' ' + kb(f.size) + 'k ' + d.w + 'x' + d.h)
      const stem = path.basename(r).replace(/\.[^.]+$/, '')
      const has = ['320', '640'].map((w) => resp.has(stem + '-' + w + '.webp'))
      if (!has[0] || !has[1]) noVar.push(r + (has[0] || has[1] ? '(partial)' : ''))
    }
    say('MEDIA originals=' + orig.length + ' bytes=' + kb(ob2) + 'k formats ' + [...fmt].map(([k, v]) => k + ':' + v).join(' ') + ' longest-side ' + [...dimsHist].map(([k, v]) => k + ':' + v).join(' ') + ' responsive-files=' + resp.size + ' variants.txt=' + (med.has('products/responsive/variants.txt') || [...med.keys()].some((r) => r.endsWith('responsive/variants.txt'))))
    say('MEDIA_TOP_DIRS ' + [...new Set([...med.keys()].map((r) => r.split('/').slice(0, 2).join('/')))].slice(0, 12).join(' '))
    say('MEDIA_NO_VARIANTS n=' + noVar.length + ' :: ' + noVar.slice(0, 60).join(' ').slice(0, 860))
    say('MEDIA_OVER_300K n=' + big.length + ' :: ' + big.slice(0, 20).join(' ; '))
    if (other.length) say('MEDIA_OTHER ' + other.slice(0, 20).join(' ; '))
    const respOrphan = [...resp].filter((n) => /-(320|640)\.webp$/.test(n) && !orig.some(([r]) => path.basename(r).replace(/\.[^.]+$/, '') === n.replace(/-(320|640)\.webp$/, '')))
    say('MEDIA_VARIANTS_WITHOUT_ORIGINAL n=' + respOrphan.length + ' ' + respOrphan.slice(0, 20).join(' '))
  } else say('MEDIA not mounted at ' + MEDIA)
  // site-level images/products (if any in web root)
  const respSite = [...all.keys()].filter((r) => r.startsWith('images/products/responsive/'))
  say('SITE_images/products/responsive n=' + respSite.length + ' variants.txt=' + all.has('images/products/responsive/variants.txt'))

  // ---- manifests
  for (const mf of ['site.webmanifest', 'backends.webmanifest', 'manifest.webmanifest', 'manifest.json']) {
    if (!all.has(mf)) continue
    try {
      const j = JSON.parse(fs.readFileSync(path.join(SITE, mf), 'utf8'))
      const ic = (j.icons || []).map((i) => {
        const p = String(i.src || '').replace(/^\//, '').split('?')[0]
        const d = all.has(p) ? imgDims(readHead(path.join(SITE, p), 65536), path.extname(p).toLowerCase()) : null
        return i.src + ' decl=' + i.sizes + ' ' + (i.purpose || '') + ' -> ' + (d ? d.f + ' ' + (d.ico || d.w + 'x' + d.h) + ' ' + kb(all.get(p).size) + 'k' + (i.sizes && !String(i.sizes).split(' ').includes(d.w + 'x' + d.h) && d.f !== 'svg' && d.f !== 'ico' ? ' SIZE-MISMATCH' : '') : 'MISSING')
      })
      say('MANIFEST ' + mf + ' name=' + (j.short_name || j.name) + ' start=' + j.start_url + ' theme=' + j.theme_color + ' bg=' + j.background_color + ' :: ' + ic.join(' ; '))
    } catch (e) { say('MANIFEST ' + mf + ' PARSE-ERROR') }
  }
  // icons/og named in index.html
  for (const m of idx.matchAll(/<(?:link|meta)\b[^>]*(?:icon|og:image|twitter:image|apple-touch)[^>]*>/gi)) {
    const t = m[0]; const u = ((/(?:href|content)="([^"]+)"/.exec(t) || [])[1] || '')
    const p = u.replace(/^https:\/\/www\.sporta\.com\.kw/, '').replace(/^\//, '').split('?')[0]
    const d = all.has(p) ? imgDims(readHead(path.join(SITE, p), 65536), path.extname(p).toLowerCase()) : null
    say('ICON_TAG ' + t.replace(/\s+/g, ' ').slice(0, 160) + ' -> ' + (d ? d.f + ' ' + (d.ico || d.w + 'x' + d.h) + ' ' + kb(all.get(p).size) + 'k' : 'NOT-ON-DISK'))
  }
  say('ASSETS_DISK_DONE')
}
const location0 = /^https:\/\/www\.sporta\.com\.kw/

// ======================================================================== HTTP
function raw(url, enc) {
  return new Promise((res) => {
    const req = https.request(url, { method: 'GET', headers: { 'accept-encoding': enc, 'user-agent': 'Mozilla/5.0 (assets-probe; read-only)' }, timeout: 20000 }, (r) => {
      let n = 0; r.on('data', (c) => { n += c.length }); r.on('end', () => res({ s: r.statusCode, h: r.headers, n }))
    })
    req.on('error', () => res({ s: 0, h: {}, n: 0 })); req.on('timeout', () => { req.destroy(); res({ s: 0, h: {}, n: 0 }) }); req.end()
  })
}
async function http() {
  const idx = await raw(B + '/', 'identity')
  const html = await (await fetch(B + '/')).text()
  const urls = new Set(['/', '/shop', '/index.html', '/backends', '/no-such-page-xyz', '/no-such.js', '/assets/no-such-AAAAAAAA.js', '/robots.txt', '/sitemap.xml', '/sitemap-products.xml', '/llms.txt', '/site.webmanifest', '/backends.webmanifest', '/sw.js', '/config.js', '/boot.js', '/favicon.ico', '/favicon.png', '/favicon-32.png', '/favicon-192.png', '/apple-touch-icon.png', '/og-image.png', '/logo.png', '/logo-white.png', '/logo-white.webp', '/product-photo-unavailable.svg', '/backends-icon.svg', '/backends-offline.html', '/images/products/responsive/variants.txt', '/sporta-admin-brands.full.js', '/.htaccess', '/.DS_Store', '/index.html.map'])
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) { const u = m[1]; if (u.startsWith('/') && !u.startsWith('//')) urls.add(u.split('#')[0]); else if (u.startsWith(B)) urls.add(u.slice(B.length)) }
  // a few chunks named by the entry
  const entry = [...urls].find((u) => /^\/assets\/index-.*\.js$/.test(u))
  if (entry) {
    const t = await (await fetch(B + entry)).text()
    const ch = [...new Set([...t.matchAll(/["'`](?:\.\/|\/assets\/|assets\/)([\w.-]+\.(?:js|css))["'`]/g)].map((m) => '/assets/' + m[1]))]
    say('ENTRY ' + entry + ' names ' + ch.length + ' chunks')
    for (const c of ch.slice(0, 12)) urls.add(c)
    for (const m of t.matchAll(/["'`](\/(?:fonts|images|hero|cats|icons|brand)\/[^"'`]+?\.(?:woff2|png|jpe?g|webp|svg))["'`]/g)) urls.add(m[1])
  }
  // CSS-named fonts / images
  for (const u of [...urls].filter((u) => /\.css$/.test(u))) {
    try { const t = await (await fetch(B + u)).text(); for (const m of t.matchAll(/url\(\s*['"]?(\/[^'")]+)/g)) urls.add(m[1].split('?')[0]) } catch {}
  }
  for (const u of ['/api/api.php?r=products']) urls.add(u)
  try { const j = await (await fetch(B + '/api/api.php?r=products')).json(); const p = (j.products || j).find((x) => x.slug); if (p) { urls.add('/images/products/' + p.slug + '.jpg'); urls.add('/images/products/responsive/' + p.slug + '-320.webp'); urls.add('/images/products/responsive/' + p.slug + '-640.webp') } } catch {}
  try { const j = await (await fetch(B + '/api/api.php?r=slides')).json(); const s = JSON.stringify(j); const m = /api\.php\?r=slide_image[^"\\]*/.exec(s); if (m) urls.add('/api/' + m[0].replace(/\\u0026/g, '&')) } catch {}
  say('HTTP urls=' + urls.size)
  const tierOf = (u) => /^\/assets\//.test(u) ? 'hashed' : /\.(woff2?)$/.test(u) ? 'font' : /\.(png|jpe?g|webp|svg|ico|gif|avif)(\?|$)/.test(u) ? 'image' : /\.(css|js)(\?|$)/.test(u) ? 'addon' : /^\/api\//.test(u) ? 'api' : 'page/fixed'
  const rows = []
  for (const u of [...urls].sort()) {
    const br = await raw(B + u, 'br, gzip'), gz = await raw(B + u, 'gzip'), id = await raw(B + u, 'identity')
    const h = br.h
    rows.push({ u, tier: tierOf(u), s: br.s, ct: String(h['content-type'] || '').split(';')[0], ceBr: h['content-encoding'] || '-', ceGz: gz.h['content-encoding'] || '-', nBr: br.n, nGz: gz.n, nId: id.n, cc: h['cache-control'] || '-', vary: h['vary'] || '-', exp: h['expires'] ? 'Y' : '', etag: h['etag'] ? 'E' : '', lm: h['last-modified'] ? 'L' : '', xct: h['x-content-type-options'] || '' })
  }
  for (const t of ['page/fixed', 'addon', 'hashed', 'font', 'image', 'api']) {
    say('TIER ' + t)
    for (const r of rows.filter((x) => x.tier === t)) say('  H ' + r.s + ' ' + r.u.slice(0, 70) + ' ct=' + r.ct + ' br:' + r.ceBr + '/' + kb(r.nBr) + 'k gz:' + r.ceGz + '/' + kb(r.nGz) + 'k id:' + kb(r.nId) + 'k cc="' + r.cc + '" vary=' + r.vary + ' ' + r.etag + r.lm + r.exp)
  }
  say('ASSETS_HTTP_DONE')
}

// ======================================================================== BROWSER
async function browser() {
  const { chromium } = await import('playwright')
  let slug = ''
  try { const j = await (await fetch(B + '/api/api.php?r=products')).json(); const ps = (j.products || j); slug = (ps.find((p) => p.image || (p.images && p.images.length)) || ps[0]).slug } catch {}
  const PAGES = (process.env.PAGES ? process.env.PAGES.split(',') : ['/', '/shop', '/product/' + slug, '/about', '/account', '/checkout', '/backends'])
  const b = await chromium.launch({ args: ['--no-sandbox'] })
  const fontAgg = new Map(), imgAgg = new Map(), notFound = new Map(), preloadWarn = new Set()
  for (const lang of ['ar', 'en']) for (const [w, dpr] of [[390, 2], [1280, 1]]) for (const p of PAGES) {
    const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 844 : 800 }, deviceScaleFactor: dpr, isMobile: w < 500, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
    const page = await ctx.newPage()
    await page.route('**/*', (r) => (['GET', 'HEAD', 'OPTIONS'].includes(r.request().method()) ? r.continue() : r.abort()))
    const reqs = []
    page.on('response', async (r) => { try { const s = await r.request().sizes(); reqs.push({ u: r.url(), s: r.status(), t: r.request().resourceType(), n: s.responseBodySize, ce: (await r.allHeaders())['content-encoding'] || '' }) } catch { reqs.push({ u: r.url(), s: r.status(), t: r.request().resourceType(), n: 0 }) } })
    page.on('console', (m) => { const t = m.text(); if (/preload/i.test(t)) preloadWarn.add(t.slice(0, 220)) })
    const cov = lang === 'ar' && w === 390 && p === '/'
    if (cov) { await page.coverage.startJSCoverage({ resetOnNavigation: false }); await page.coverage.startCSSCoverage({ resetOnNavigation: false }) }
    const url = B + p + (lang === 'en' ? (p.includes('?') ? '&' : '?') + 'lang=en' : '')
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null)
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)) } scrollTo(0, 0) }).catch(() => null)
    await page.waitForTimeout(1500)
    const m = await page.evaluate(() => {
      const fonts = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '') + ':' + f.weight + (f.style !== 'normal' ? f.style : ''))
      const used = new Set(); for (const el of document.querySelectorAll('body *')) { if (!el.childNodes.length) continue; let txt = false; for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { txt = true; break } if (!txt) continue; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; used.add(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() + ':' + cs.fontWeight) }
      const imgs = [...document.images].filter((i) => i.complete && i.naturalWidth && i.getBoundingClientRect().width > 0).map((i) => { const r = i.getBoundingClientRect(); return { u: (i.currentSrc || i.src).replace(location.origin, '').slice(0, 90), bw: Math.round(r.width), bh: Math.round(r.height), nw: i.naturalWidth, nh: i.naturalHeight, lz: i.loading, fold: r.top < innerHeight } })
      const bgs = []; for (const el of document.querySelectorAll('*')) { const bi = getComputedStyle(el).backgroundImage; if (bi && bi.startsWith('url(') && !bi.includes('data:')) { const r = el.getBoundingClientRect(); if (r.width) bgs.push(bi.slice(5, 95).replace(location.origin, '') + ' box=' + Math.round(r.width) + 'x' + Math.round(r.height)) } }
      const pre = [...document.querySelectorAll('link[rel=preload],link[rel=modulepreload]')].map((l) => l.getAttribute('href'))
      return { fonts, used: [...used], imgs, bgs: bgs.slice(0, 8), pre, dpr: devicePixelRatio }
    }).catch(() => ({ fonts: [], used: [], imgs: [], bgs: [], pre: [] }))
    const tag = lang + '@' + w + ' ' + p.slice(0, 40)
    const fontReqs = reqs.filter((r) => r.t === 'font' || /\.woff2?($|\?)/.test(r.u))
    for (const f of fontReqs) { const k = f.u.replace(B, ''); const v = fontAgg.get(k) || { n: 0, size: f.n, pages: new Set() }; v.n++; v.pages.add(lang + '@' + w); fontAgg.set(k, v) }
    for (const r of reqs) if (r.s >= 400) { const k = r.s + ' ' + r.u.replace(B, '').slice(0, 90); notFound.set(k, (notFound.get(k) || 0) + 1) }
    const by = {}; for (const r of reqs) { const k = r.t; by[k] = by[k] || [0, 0]; by[k][0]++; by[k][1] += r.n || 0 }
    say('PG ' + tag + ' reqs=' + reqs.length + ' ' + Object.entries(by).map(([k, v]) => k + ':' + v[0] + '/' + kb(v[1]) + 'k').join(' ') + ' | fonts-fetched ' + fontReqs.map((f) => f.u.split('/').pop().slice(0, 34) + '(' + kb(f.n) + 'k)').join(',') + ' | faces-loaded ' + [...new Set(m.fonts)].join(',') + ' | text-uses ' + m.used.slice(0, 10).join(','))
    const over = []
    for (const i of m.imgs) {
      const need = Math.max(i.bw, 1) * (m.dpr || dpr); const ratio = i.nw / need
      const k = i.u; const v = imgAgg.get(k) || { nw: i.nw, nh: i.nh, maxBox: 0, n: 0, lazyAbove: 0, minRatio: 99 }; v.maxBox = Math.max(v.maxBox, i.bw); v.n++; v.minRatio = Math.min(v.minRatio, ratio); if (i.fold && i.lz === 'lazy') v.lazyAbove++; imgAgg.set(k, v)
      if (ratio > 2.5) over.push(i.u.split('/').pop().slice(0, 40) + ' ' + i.nw + 'w>' + i.bw + 'box')
      if (ratio < 0.8) over.push('UPSCALED ' + i.u.split('/').pop().slice(0, 40) + ' ' + i.nw + 'w<' + i.bw + 'box@' + dpr)
    }
    if (over.length) say('  IMGSIZE ' + over.slice(0, 10).join(' ; '))
    if (m.bgs.length && w === 390) say('  BG ' + m.bgs.join(' ; ').slice(0, 500))
    if (cov) {
      const jc = await page.coverage.stopJSCoverage(), cc = await page.coverage.stopCSSCoverage()
      const usedOf = (e) => { let u = 0; if (e.functions) { /* js */ const rs = []; for (const f of e.functions) for (const r of f.ranges) if (r.count > 0) rs.push([r.startOffset, r.endOffset]); rs.sort((a, b) => a[0] - b[0]); let end = -1; for (const [s, t] of rs) { if (s > end) { u += t - s; end = t } else if (t > end) { u += t - end; end = t } } } else for (const r of e.ranges) u += r.end - r.start; return u }
      const line = (e) => e.url.replace(B, '').slice(0, 60) + ' ' + kb((e.source || e.text || '').length) + 'k used~' + Math.round(100 * Math.min(1, usedOf(e) / Math.max(1, (e.source || e.text || '').length))) + '%'
      say('COVERAGE_JS (home ar 390, after scroll; JS % is block-level and overstates use) ' + jc.filter((e) => e.url.startsWith(B)).sort((a, b) => (b.source || '').length - (a.source || '').length).slice(0, 14).map(line).join(' ; '))
      say('COVERAGE_CSS ' + cc.filter((e) => e.url.startsWith(B)).sort((a, b) => (b.text || '').length - (a.text || '').length).slice(0, 18).map(line).join(' ; '))
    }
    await ctx.close()
  }
  say('FONT_REQUESTS ' + [...fontAgg].map(([k, v]) => k + ' ' + kb(v.size) + 'k on ' + [...v.pages].join('/') + ' x' + v.n).join(' ; '))
  for (const [k, v] of [...imgAgg].sort((a, b) => b[1].nw / b[1].maxBox - a[1].nw / a[1].maxBox).slice(0, 30)) say('IMGAGG ' + k + ' natural=' + v.nw + 'x' + v.nh + ' maxbox=' + v.maxBox + ' seen=' + v.n + (v.lazyAbove ? ' lazy-above-fold=' + v.lazyAbove : ''))
  for (const [k, n] of notFound) say('HTTP4xx ' + k + ' x' + n)
  for (const t of preloadWarn) say('PRELOAD_WARN ' + t)
  await b.close()
  say('ASSETS_BROWSER_DONE')
}

if (MODE === 'disk') await disk()
else if (MODE === 'http') await http()
else if (MODE === 'browser') await browser()
else { say('unknown MODE'); process.exit(2) }
