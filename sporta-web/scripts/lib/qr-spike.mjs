/*
 * qr-spike.mjs - a compact QR Code encoder (ISO/IEC 18004), no dependency, no Node API.
 *
 *   qr(text, { ecc: 'M' }) -> { size, version, ecc, mask, rows } | null
 *
 * rows: array of `size` strings of '0'/'1' ('1' = dark module). The quiet zone is NOT included
 * (draw 4 modules of light around it). null when the text does not fit version 10 at that level.
 * Byte mode only (text is encoded as UTF-8, so ASCII URLs are one byte per character), versions
 * 1-10 (the smallest that fits), levels L M Q H, Reed-Solomon over GF(256) (poly 0x11D), the
 * eight masks with the four-rule penalty choice, format + version information, finder, timing
 * and alignment patterns. Written in ES5 style (var, function, no classes, no TextEncoder), so
 * the same source can be inlined into a browser add-on.
 * Capacity (bytes, byte mode): v10 = L 271, M 213, Q 151, H 119.
 */

// Per version 1..10: raw codewords, alignment centres.
var RAW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
// Block table per level: version -> [ecPerBlock, blocksA, dataA, blocksB, dataB]
var BLK = {
  L: [0, [7,1,19,0,0], [10,1,34,0,0], [15,1,55,0,0], [20,1,80,0,0], [26,1,108,0,0], [18,2,68,0,0], [20,2,78,0,0], [24,2,97,0,0], [30,2,116,0,0], [18,2,68,2,69]],
  M: [0, [10,1,16,0,0], [16,1,28,0,0], [26,1,44,0,0], [18,2,32,0,0], [24,2,43,0,0], [16,4,27,0,0], [18,4,31,0,0], [22,2,38,2,39], [22,3,36,2,37], [26,4,43,1,44]],
  Q: [0, [13,1,13,0,0], [22,1,22,0,0], [18,2,17,0,0], [26,2,24,0,0], [18,2,15,2,16], [24,4,19,0,0], [18,2,14,4,15], [22,4,18,2,19], [20,4,16,4,17], [24,6,19,2,20]],
  H: [0, [17,1,9,0,0], [28,1,16,0,0], [22,2,13,0,0], [16,4,9,0,0], [22,2,11,2,12], [28,4,15,0,0], [26,4,13,1,14], [26,4,14,2,15], [24,4,12,4,13], [28,6,15,2,16]]
};
var FMT = { L: 1, M: 0, Q: 3, H: 2 };

// GF(256) tables.
var EXP = [], LOG = [];
(function () {
  var x = 1, i;
  for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
  for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }

// Remainder of data * x^n divided by the generator (x - a^0)...(x - a^(n-1)).
function rsEncode(data, n) {
  var gen = [1], i, j;
  for (i = 0; i < n; i++) {
    var next = [];
    for (j = 0; j <= gen.length; j++) next[j] = 0;
    for (j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= gmul(gen[j], EXP[i]); }
    gen = next; // gen[0] is the leading 1
  }
  var rem = [];
  for (i = 0; i < n; i++) rem[i] = 0;
  for (i = 0; i < data.length; i++) {
    var f = data[i] ^ rem[0];
    rem.shift(); rem.push(0);
    if (f) for (j = 0; j < n; j++) rem[j] ^= gmul(gen[j + 1], f);
  }
  return rem;
}

function utf8(s) {
  var out = [], i, c, d;
  for (i = 0; i < s.length; i++) {
    c = s.charCodeAt(i);
    if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) {
      d = s.charCodeAt(i + 1);
      if (d >= 0xDC00 && d < 0xE000) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function dataCapacity(v, lvl) { var b = BLK[lvl][v]; return b[1] * b[2] + b[3] * b[4]; }

// Interleaved data + error-correction codewords for a version and level.
function codewords(bytes, v, lvl) {
  var b = BLK[lvl][v], cap = dataCapacity(v, lvl), bits = [], i, j;
  function put(val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >> k) & 1); }
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
  for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
  for (i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  var data = [];
  for (i = 0; i < bits.length; i += 8) { var w = 0; for (j = 0; j < 8; j++) w = (w << 1) | bits[i + j]; data.push(w); }
  for (i = 0; data.length < cap; i++) data.push(i % 2 ? 0x11 : 0xEC);
  var blocks = [], ecs = [], pos = 0, nb = b[1] + b[3], maxLen = 0;
  for (i = 0; i < nb; i++) {
    var len = i < b[1] ? b[2] : b[4];
    var d = data.slice(pos, pos + len); pos += len;
    blocks.push(d); ecs.push(rsEncode(d, b[0]));
    if (len > maxLen) maxLen = len;
  }
  var out = [];
  for (i = 0; i < maxLen; i++) for (j = 0; j < nb; j++) if (i < blocks[j].length) out.push(blocks[j][i]);
  for (i = 0; i < b[0]; i++) for (j = 0; j < nb; j++) out.push(ecs[j][i]);
  return out;
}

function formatBits(lvl, mask) {
  var data = (FMT[lvl] << 3) | mask, rem = data, i;
  for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
function versionBits(v) {
  var rem = v, i;
  for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
  return (v << 12) | rem;
}

// Build the matrix. m = module values (0/1), fn = function-pattern flags.
function build(v, lvl, cw, maskFixed) {
  var size = 17 + 4 * v, m = [], fn = [], x, y, i, j;
  for (y = 0; y < size; y++) { m.push([]); fn.push([]); for (x = 0; x < size; x++) { m[y].push(0); fn[y].push(0); } }
  function set(px, py, dark) { m[py][px] = dark ? 1 : 0; fn[py][px] = 1; }
  function finder(cx, cy) {
    for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
      var px = cx + dx, py = cy + dy;
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      var d = Math.max(Math.abs(dx), Math.abs(dy));
      set(px, py, d !== 2 && d !== 4);
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  for (i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  var al = ALIGN[v];
  for (i = 0; i < al.length; i++) for (j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
      set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // reserve format areas (real bits are drawn per mask below)
  function drawFormat(mask) {
    var bits = formatBits(lvl, mask);
    function bit(k) { return (bits >> k) & 1; }
    for (var k = 0; k <= 5; k++) set(8, k, bit(k));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (k = 9; k < 15; k++) set(14 - k, 8, bit(k));
    for (k = 0; k < 8; k++) set(size - 1 - k, 8, bit(k));
    for (k = 8; k < 15; k++) set(8, size - 15 + k, bit(k));
    set(8, size - 8, 1);
  }
  drawFormat(0);
  if (v >= 7) {
    var vb = versionBits(v);
    for (i = 0; i < 18; i++) {
      var a = size - 11 + (i % 3), b2 = Math.floor(i / 3), bt = (vb >> i) & 1;
      set(a, b2, bt); set(b2, a, bt);
    }
  }
  // zigzag data placement
  var k2 = 0, up = true;
  for (x = size - 1; x > 0; x -= 2) {
    if (x === 6) x = 5;
    for (var n = 0; n < size; n++) {
      y = up ? size - 1 - n : n;
      for (j = 0; j < 2; j++) {
        var cx = x - j;
        if (!fn[y][cx]) { m[y][cx] = k2 < cw.length * 8 ? (cw[k2 >> 3] >> (7 - (k2 & 7))) & 1 : 0; k2++; }
      }
    }
    up = !up;
  }
  function applyMask(mask) {
    for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) {
      if (fn[yy][xx]) continue;
      var inv;
      switch (mask) {
        case 0: inv = (xx + yy) % 2 === 0; break;
        case 1: inv = yy % 2 === 0; break;
        case 2: inv = xx % 3 === 0; break;
        case 3: inv = (xx + yy) % 3 === 0; break;
        case 4: inv = (Math.floor(xx / 3) + Math.floor(yy / 2)) % 2 === 0; break;
        case 5: inv = (xx * yy) % 2 + (xx * yy) % 3 === 0; break;
        case 6: inv = ((xx * yy) % 2 + (xx * yy) % 3) % 2 === 0; break;
        default: inv = ((xx + yy) % 2 + (xx * yy) % 3) % 2 === 0;
      }
      if (inv) m[yy][xx] ^= 1;
    }
  }
  var best = -1, bestScore = 1e9, mask;
  for (mask = 0; mask < 8; mask++) {
    if (maskFixed !== undefined && maskFixed !== null && mask !== maskFixed) continue;
    applyMask(mask); drawFormat(mask);
    var s = penalty(m, size);
    if (s < bestScore) { bestScore = s; best = mask; }
    applyMask(mask); // undo
  }
  applyMask(best); drawFormat(best);
  return { m: m, size: size, mask: best };
}

function penalty(m, size) {
  var p = 0, x, y, i, run, dark = 0;
  function line(get) {
    var res = 0, r = 1, last = get(0), k, hist = [0, 0, 0, 0, 0, 0, 0];
    // N1 runs
    for (k = 1; k < size; k++) {
      var c = get(k);
      if (c === last) { r++; } else { if (r >= 5) res += r - 2; r = 1; last = c; }
    }
    if (r >= 5) res += r - 2;
    // N3 finder-like 1011101 with 4 light on either side (window of 11)
    var s = '';
    for (k = 0; k < size; k++) s += get(k);
    var a = '10111010000', b = '00001011101', at = -1;
    while ((at = s.indexOf(a, at + 1)) >= 0) res += 40;
    at = -1;
    while ((at = s.indexOf(b, at + 1)) >= 0) res += 40;
    return res;
  }
  for (y = 0; y < size; y++) p += line(function (k) { return m[y][k]; });
  for (x = 0; x < size; x++) p += line(function (k) { return m[k][x]; });
  // N2 2x2 blocks
  for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
    var c0 = m[y][x];
    if (c0 === m[y][x + 1] && c0 === m[y + 1][x] && c0 === m[y + 1][x + 1]) p += 3;
  }
  // N4 balance
  for (y = 0; y < size; y++) for (x = 0; x < size; x++) dark += m[y][x];
  var pct = dark * 100 / (size * size);
  p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

function qr(text, opts) {
  var lvl = (opts && opts.ecc) || 'M';
  if (!BLK[lvl]) throw new Error('qr: ecc must be L, M, Q or H');
  var bytes = utf8(String(text)), v;
  for (v = 1; v <= 10; v++) {
    var need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
    if (need <= dataCapacity(v, lvl) * 8) break;
  }
  if (v > 10) return null;
  var r = build(v, lvl, codewords(bytes, v, lvl), opts && opts.mask);
  var rows = [], y, x;
  for (y = 0; y < r.size; y++) rows.push(r.m[y].join(''));
  return { size: r.size, version: v, ecc: lvl, mask: r.mask, rows: rows };
}

export { qr, RAW, BLK, ALIGN, dataCapacity, rsEncode, formatBits, versionBits, codewords, utf8 };
export default qr;
