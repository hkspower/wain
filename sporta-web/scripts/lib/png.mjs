// Minimal PNG reader for the test suites (no dependency): 8-bit greyscale, grey+alpha, RGB, RGBA and
// palette images, no interlacing. That is what Chromium's screenshots and every PNG in public/ are.
// png(buffer) -> { w, h, bitDepth, colorType, hasAlpha, at(x, y) -> {r,g,b,a} (a is 0..255), data (unfiltered samples), chans }
// pngHeader(buffer) -> { w, h, bitDepth, colorType, interlace } without inflating anything.
import { inflateSync } from 'node:zlib'

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const pngHeader = (buf) => {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG) || buf.toString('ascii', 12, 16) !== 'IHDR') throw new Error('not a PNG')
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25], interlace: buf[28] }
}

export const png = (buf) => {
  const hd = pngHeader(buf)
  if (hd.interlace) throw new Error('interlaced PNG not supported')
  if (hd.bitDepth !== 8) throw new Error('only 8-bit PNG supported')
  const chans = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[hd.colorType]
  const idat = []; let plte = null, trns = null
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8)
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len))
    if (type === 'PLTE') plte = buf.subarray(p + 8, p + 8 + len)
    if (type === 'tRNS') trns = buf.subarray(p + 8, p + 8 + len)
    p += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = hd.w * chans, out = Buffer.alloc(hd.h * stride)
  for (let y = 0; y < hd.h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= chans ? out[dst + x - chans] : 0, b = y ? out[dst - stride + x] : 0, c = x >= chans && y ? out[dst - stride + x - chans] : 0
      let v = raw[src + x]
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      out[dst + x] = v & 255
    }
  }
  const at = (x, y) => {
    const i = y * stride + x * chans
    switch (hd.colorType) {
      case 0: return { r: out[i], g: out[i], b: out[i], a: 255 }
      case 4: return { r: out[i], g: out[i], b: out[i], a: out[i + 1] }
      case 2: return { r: out[i], g: out[i + 1], b: out[i + 2], a: 255 }
      case 3: { const k = out[i]; return { r: plte[k * 3], g: plte[k * 3 + 1], b: plte[k * 3 + 2], a: trns && k < trns.length ? trns[k] : 255 } }
      default: return { r: out[i], g: out[i + 1], b: out[i + 2], a: out[i + 3] }
    }
  }
  return { ...hd, hasAlpha: hd.colorType === 4 || hd.colorType === 6 || (hd.colorType === 3 && !!trns), at, data: out, chans }
}

// Encoder: 8-bit RGBA from a Buffer of w*h*4 bytes (Sub filter, deflate level 9). Deterministic.
import { deflateSync, crc32 } from 'node:zlib'
export const encodePng = (w, h, rgba) => {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 1
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = (rgba[y * stride + x] - (x >= 4 ? rgba[y * stride + x - 4] : 0)) & 255
  }
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)) >>> 0, 8 + data.length); return b }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
