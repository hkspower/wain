// A synthetic product photo for the storefront suites (no file in the repo is a product photo: those live in the server's media mount).
// photoPng(w, h) -> a PNG Buffer: a diagonal colour gradient with a 100px grid and a numbered-looking pattern so a zoom is visible and a
// position can be read back from a pixel. Deterministic; built with zlib only.
import { deflateSync, crc32 } from 'node:zlib'

const chunk = (type, data) => {
  const t = Buffer.from(type, 'ascii'), len = Buffer.alloc(4), crc = Buffer.alloc(4)
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0)
  return Buffer.concat([len, t, data, crc])
}
export const photoPng = (w = 1600, h = 1600) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const rows = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3)
    for (let x = 0; x < w; x++) {
      const o = 1 + x * 3, grid = x % 100 < 3 || y % 100 < 3
      row[o] = grid ? 20 : Math.round((x / w) * 255)
      row[o + 1] = grid ? 20 : Math.round((y / h) * 255)
      row[o + 2] = grid ? 20 : 140
    }
    rows.push(row)
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 6 })), chunk('IEND', Buffer.alloc(0))])
}
