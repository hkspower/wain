#!/usr/bin/env node
// Regenerates the app icons from the brand master, into brand/icons-polish/ (NEVER into public/: the owner copies what
// they want, see brand/icons-polish/README.md).
//
//   node scripts/make-icons-polish.mjs            write the PNGs
//   node scripts/make-icons-polish.mjs --preview  also write brand/icons-polish/preview.png (needs Chromium)
//
// Why: the S mark in public/favicon*.png and apple-touch-icon.png was cropped from the logo with its right bowl cut
// flat (a 58px vertical edge at 512), touches the top and bottom of the canvas (0% padding), is transparent, and is the
// file the manifest declares as BOTH "any" and "maskable" although its ink reaches 58.8% of the width from the centre
// (a maskable icon must keep its ink inside the central 80% circle, radius 40%). Everything here is cut from the 7131 x
// 2193 master (brand/logo-original.png), whole, and area-averaged down, so no pixel is upscaled.
//
// The S is taken from the master as it is: the first run of columns that holds any ink (the S ends in a gap before the P).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { png, encodePng } from './lib/png.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const OUT = join(REPO, 'brand', 'icons-polish')
export const CHARCOAL = [23, 26, 30]   // #171A1E

// ---- the S, from the master -------------------------------------------------------------------------------
const master = png(readFileSync(join(REPO, 'brand', 'logo-original.png')))
const colInk = (x) => { for (let y = 0; y < master.h; y += 2) if (master.data[(y * master.w + x) * 4 + 3] > 8) return true; return false }
let sx1 = 0; while (sx1 < master.w && !colInk(sx1)) sx1++
let sx2 = sx1; for (let gap = 0; sx2 < master.w && gap < 40; sx2++) gap = colInk(sx2) ? 0 : gap + 1
sx2 -= 40
// tight bbox of the S
let y1 = master.h, y2 = -1
for (let y = 0; y < master.h; y++) for (let x = sx1; x <= sx2; x++) if (master.data[(y * master.w + x) * 4 + 3] > 8) { if (y < y1) y1 = y; if (y > y2) y2 = y }
const S = { x1: sx1, x2: sx2, y1, y2, w: sx2 - sx1 + 1, h: y2 - y1 + 1 }
// farthest ink pixel from the bbox centre (in master px) - what decides the maskable scale
let maxR = 0; const cx = (S.x1 + S.x2) / 2, cy = (S.y1 + S.y2) / 2
for (let y = S.y1; y <= S.y2; y += 2) for (let x = S.x1; x <= S.x2; x += 2) if (master.data[(y * master.w + x) * 4 + 3] > 40) maxR = Math.max(maxR, Math.hypot(x - cx, y - cy))
export const SHAPE = { ...S, maxR }

// ---- render: box-filter the S at scale k (target px per master px) onto a size x size canvas ----------------
const render = (size, k, bg) => {
  const out = Buffer.alloc(size * size * 4)
  const ox = size / 2 - cx * k, oy = size / 2 - cy * k      // master -> canvas
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    // master footprint of this pixel
    const mx1 = (px - ox) / k, mx2 = (px + 1 - ox) / k, my1 = (py - oy) / k, my2 = (py + 1 - oy) / k
    const ix1 = Math.max(S.x1, Math.floor(mx1)), ix2 = Math.min(S.x2, Math.ceil(mx2) - 1), iy1 = Math.max(S.y1, Math.floor(my1)), iy2 = Math.min(S.y2, Math.ceil(my2) - 1)
    let r = 0, g = 0, b = 0, a = 0, n = 0
    for (let y = iy1; y <= iy2; y++) for (let x = ix1; x <= ix2; x++) {
      const i = (y * master.w + x) * 4, al = master.data[i + 3]
      r += master.data[i] * al; g += master.data[i + 1] * al; b += master.data[i + 2] * al; a += al
    }
    const cover = (Math.max(0, ix2 - ix1 + 1) * Math.max(0, iy2 - iy1 + 1)) / ((mx2 - mx1) * (my2 - my1))   // part of the footprint inside the S's box
    const o = (py * size + px) * 4
    const cnt = Math.max(0, ix2 - ix1 + 1) * Math.max(0, iy2 - iy1 + 1)
    const alpha = cnt ? (a / cnt / 255) * Math.min(1, cover) : 0
    const col = a ? [r / a, g / a, b / a] : [0, 0, 0]
    if (bg) { for (let c = 0; c < 3; c++) out[o + c] = Math.round(col[c] * alpha + bg[c] * (1 - alpha)); out[o + 3] = 255 }
    else { out[o] = Math.round(col[0]); out[o + 1] = Math.round(col[1]); out[o + 2] = Math.round(col[2]); out[o + 3] = Math.round(alpha * 255) }
  }
  return out
}

// The set. frac = the S's height as a share of the canvas (any); radius = the farthest ink may reach this share of the width (maskable).
export const SET = [
  { file: 'favicon-32.png', size: 32, frac: 0.88 },
  { file: 'favicon-192.png', size: 192, frac: 0.84 },
  { file: 'favicon.png', size: 512, frac: 0.84 },
  { file: 'favicon-maskable-192.png', size: 192, radius: 0.38, bg: CHARCOAL },
  { file: 'favicon-maskable-512.png', size: 512, radius: 0.38, bg: CHARCOAL },
  { file: 'apple-touch-icon.png', size: 180, radius: 0.41, bg: CHARCOAL },
]
export const build = () => SET.map((s) => {
  const k = s.radius ? (s.radius * s.size) / maxR : (s.frac * s.size) / S.h
  return { ...s, k, png: encodePng(s.size, s.size, render(s.size, k, s.bg)) }
})

if (process.argv[1] && process.argv[1].endsWith('make-icons-polish.mjs')) {
  mkdirSync(OUT, { recursive: true })
  for (const f of build()) { writeFileSync(join(OUT, f.file), f.png); console.log(`${f.file.padEnd(28)} ${f.size}x${f.size}  ${f.png.length} bytes  S height ${(S.h * f.k).toFixed(1)}px`) }
  console.log(`master S: ${S.w} x ${S.h} px at x ${S.x1}..${S.x2}; farthest ink ${maxR.toFixed(0)}px from the centre (${((maxR / S.h) * 100).toFixed(1)}% of its height)`)
  if (process.argv.includes('--preview')) {
    const { chromium } = await import('playwright')
    const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
    const pg = await (await br.newContext({ viewport: { width: 980, height: 520 }, deviceScaleFactor: 1 })).newPage()
    const u = (f) => 'data:image/png;base64,' + readFileSync(join(OUT, f)).toString('base64')
    const old = (f) => 'data:image/png;base64,' + readFileSync(join(REPO, 'sporta-web', 'public', f)).toString('base64')
    const row = (label, items) => `<div style="margin:10px 0"><div style="font:12px sans-serif;margin-bottom:4px">${label}</div><div style="display:flex;gap:14px;align-items:center">${items.join('')}</div></div>`
    const sq = (src, s, bg, mask) => `<span style="display:inline-block;width:${s}px;height:${s}px;background:${bg};${mask ? `border-radius:50%;overflow:hidden;` : ''}"><img src="${src}" width="${s}" height="${s}" style="display:block"></span>`
    await pg.setContent(`<body style="margin:12px;background:#fff">
      ${row('BEFORE (public/): any 512 on white, on charcoal, then the same file cropped to a maskable circle; apple-touch 180 as iOS shows it (transparent -> black)', [sq(old('favicon.png'), 150, '#fff'), sq(old('favicon.png'), 150, '#171a1e'), sq(old('favicon.png'), 150, '#e2dbce', true), sq(old('apple-touch-icon.png'), 150, '#000')])}
      ${row('AFTER (brand/icons-polish/): any 512 on white, on charcoal; maskable 512 in a circle; apple-touch 180', [sq(u('favicon.png'), 150, '#fff'), sq(u('favicon.png'), 150, '#171a1e'), sq(u('favicon-maskable-512.png'), 150, '#fff', true), sq(u('apple-touch-icon.png'), 150, '#fff')])}
      ${row('tab sizes, after: 32 / 16 on white and charcoal', [sq(u('favicon-32.png'), 32, '#fff'), sq(u('favicon-32.png'), 16, '#fff'), sq(u('favicon-32.png'), 32, '#171a1e'), sq(u('favicon-32.png'), 16, '#171a1e')])}
    </body>`)
    await pg.screenshot({ path: join(OUT, 'preview.png') })
    await br.close(); console.log('preview.png written')
  }
}
