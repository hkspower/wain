// Make every authored car shell mirror-symmetric, in place.
//
//   node scripts/mirror-shells.mjs            # rewrites public/models/car-*.glb
//   node scripts/mirror-shells.mjs --dry-run  # reports, writes nothing
//
// The loft in tools/blender/build_assets.py mirrors its VERTICES to the
// micron and its FACES not at all. Rings run from one flank to the other
// and the exporter splits every quad on the same index diagonal, which in
// space is the opposite diagonal on the two halves. On a flat quad that
// is nothing. On the bevel the quads are not flat, and the two diagonals
// are two different surfaces — measured on the shipped sedan, the left
// flank sat up to 40 mm from the right at the rear shoulder, and only 1%
// of the triangles in any shell had a mirrored twin. Every lamp and every
// trim piece is hung symmetrically off the centreline, so a body that is
// not symmetric makes all of them look crooked.
//
// The loft now triangulates on the shorter diagonal, which is symmetric
// by construction, but Blender is not available everywhere this repo is
// worked on. So the shipped files are repaired here, without Blender and
// without moving a vertex: the right half's triangles are mirrored onto
// the left, replacing the left half's own. Triangles that straddle the
// centreline (the flat middle of the loft) are kept as they are — they
// are planar, so their diagonal is invisible.
//
// build.json gains a "faces" line so its fingerprint — the cache key the
// game loads the .glb files under (models.ts) — changes with the bytes.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DRY = process.argv.includes("--dry-run");
const DIR = "public/models";
const EPS = 0.002; // m: a centroid this close to x=0 straddles the seam

const readGlb = (buf) => {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binLen = dv.getUint32(20 + jsonLen, true);
  const bin = buf.subarray(20 + jsonLen + 8, 20 + jsonLen + 8 + binLen);
  return { json, bin };
};

const compSize = (t) => (t === 5126 || t === 5125 ? 4 : t === 5123 ? 2 : 1);
const readAccessor = (json, bin, idx) => {
  const a = json.accessors[idx];
  const bv = json.bufferViews[a.bufferView];
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const size = compSize(a.componentType);
  const stride = bv.byteStride ?? comps * size;
  const out = a.componentType === 5126 ? new Float32Array(a.count * comps) : new Uint32Array(a.count * comps);
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < comps; c++) {
      const o = off + i * stride + c * size;
      out[i * comps + c] =
        a.componentType === 5126 ? bin.readFloatLE(o)
        : a.componentType === 5125 ? bin.readUInt32LE(o)
        : a.componentType === 5123 ? bin.readUInt16LE(o)
        : bin.readUInt8(o);
    }
  }
  return out;
};

/** For each vertex, the index of its mirror twin: same |x|, y, z to half
 *  a millimetre, and — where the position is shared by several split
 *  vertices — the one whose normal is the mirror of this one's. */
const mirrorMap = (pos, nrm) => {
  const n = pos.length / 3;
  const key = (x, y, z) => `${Math.round(x * 2000)}:${Math.round(y * 2000)}:${Math.round(z * 2000)}`;
  const at = new Map();
  for (let i = 0; i < n; i++) {
    const k = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    let l = at.get(k);
    if (!l) at.set(k, (l = []));
    l.push(i);
  }
  const m = new Int32Array(n).fill(-1);
  let missing = 0;
  for (let i = 0; i < n; i++) {
    const cands = at.get(key(-pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
    if (!cands) { missing++; continue; }
    let best = cands[0], bestD = Infinity;
    if (nrm) {
      for (const j of cands) {
        const d = Math.hypot(nrm[j * 3] + nrm[i * 3], nrm[j * 3 + 1] - nrm[i * 3 + 1], nrm[j * 3 + 2] - nrm[i * 3 + 2]);
        if (d < bestD) { bestD = d; best = j; }
      }
    }
    m[i] = best;
  }
  return { m, missing };
};

const symmetrise = (json, bin, prim) => {
  const pos = readAccessor(json, bin, prim.attributes.POSITION);
  const nrm = prim.attributes.NORMAL !== undefined ? readAccessor(json, bin, prim.attributes.NORMAL) : null;
  const idx = readAccessor(json, bin, prim.indices);
  const { m, missing } = mirrorMap(pos, nrm);
  if (missing) throw new Error(`${missing} vertices have no mirror twin — this is not a mirrored mesh`);
  const tris = idx.length / 3;
  const out = [];
  let right = 0, left = 0, middle = 0;
  // Which side a triangle is on is decided by ALL THREE of its vertices,
  // not by its centroid. The loft's innermost rings sit either side of
  // the centreline with nothing between them, so the quads across the
  // flat middle have two vertices on one ring and one on the other: a
  // centroid puts each of those triangles on a side, and mirroring the
  // "right" one onto the "left" replaces a triangle from one diagonal
  // with a triangle from the other — the pair then overlaps in the
  // middle and leaves a hole at the far edge. The first version of this
  // did exactly that, along the whole centre band of every shell. A
  // triangle that touches both sides is kept as it is: those quads are
  // planar (the two rings carry the same contour), so their diagonal is
  // invisible and their symmetry does not matter.
  const sideOf = (i) => (pos[i * 3] > EPS ? 1 : pos[i * 3] < -EPS ? -1 : 0);
  const classify = (a, b, c) => {
    const s = [sideOf(a), sideOf(b), sideOf(c)];
    if (s.every((v) => v >= 0) && s.some((v) => v > 0)) return 1;
    if (s.every((v) => v <= 0) && s.some((v) => v < 0)) return -1;
    return 0;
  };
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const k = classify(a, b, c);
    if (k > 0) { right++; out.push(a, b, c); }
    else if (k < 0) { left++; }
    else { middle++; out.push(a, b, c); }
  }
  // The left half, as the mirror of the right: reflection reverses the
  // winding, so the order is put back or every left face turns inward.
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (classify(a, b, c) > 0) out.push(m[a], m[c], m[b]);
  }
  if (left !== right) throw new Error(`left ${left} and right ${right} triangles differ — this is not a mirrored loft`);
  return { indices: Uint32Array.from(out), before: { right, left, middle }, after: out.length / 3, pos };
};

const pad4 = (n) => (n + 3) & ~3;

/** Re-pack the binary chunk with one bufferView replaced, and write the
 *  GLB back out. Every other view keeps its bytes and its stride. */
const writeGlb = (path, json, bin, replaced) => {
  const views = json.bufferViews;
  let cursor = 0;
  const parts = [];
  for (let i = 0; i < views.length; i++) {
    const bv = views[i];
    const bytes = replaced.get(i) ?? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    bv.byteOffset = cursor;
    bv.byteLength = bytes.length;
    parts.push(bytes);
    cursor += bytes.length;
    const padN = pad4(cursor) - cursor;
    if (padN) { parts.push(Buffer.alloc(padN)); cursor += padN; }
  }
  const newBin = Buffer.concat(parts);
  json.buffers[0].byteLength = newBin.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jpad = pad4(jsonBuf.length) - jsonBuf.length;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const total = 12 + 8 + jsonBuf.length + 8 + newBin.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(newBin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([head, jh, jsonBuf, bh, newBin]));
};

const files = readdirSync(DIR).filter((f) => /^car-.*\.glb$/.test(f)).sort();
let changed = 0;
for (const f of files) {
  const path = join(DIR, f);
  const { json, bin } = readGlb(readFileSync(path));
  const replaced = new Map();
  const notes = [];
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes[node.mesh];
    for (const prim of mesh.primitives) {
      if (prim.indices === undefined) throw new Error(`${f}: ${node.name} has no index buffer`);
      const r = symmetrise(json, bin, prim);
      const acc = json.accessors[prim.indices];
      const bv = json.bufferViews[acc.bufferView];
      if (bv.byteStride) throw new Error(`${f}: strided index view`);
      if (acc.byteOffset) throw new Error(`${f}: index accessor with an offset`);
      // The narrowest index type that holds the vertex count, the same
      // choice the exporter makes, so the file does not grow for nothing.
      const wide = r.pos.length / 3 > 65535;
      const bytes = Buffer.alloc(r.indices.length * (wide ? 4 : 2));
      for (let i = 0; i < r.indices.length; i++) {
        if (wide) bytes.writeUInt32LE(r.indices[i], i * 4);
        else bytes.writeUInt16LE(r.indices[i], i * 2);
      }
      acc.componentType = wide ? 5125 : 5123;
      acc.count = r.indices.length;
      delete acc.min; delete acc.max;
      replaced.set(acc.bufferView, bytes);
      notes.push(`${String(node.name).padEnd(7)} right ${r.before.right} left ${r.before.left} seam ${r.before.middle} -> ${r.after} tris`);
    }
  }
  console.log(`${f}`);
  for (const n of notes) console.log(`  ${n}`);
  if (!DRY) { writeGlb(path, json, bin, replaced); changed++; }
}
if (!DRY) {
  const bp = join(DIR, "build.json");
  const build = JSON.parse(readFileSync(bp, "utf8"));
  build.faces = "mirrored";
  writeFileSync(bp, JSON.stringify(build, null, 2) + "\n");
  console.log(`\nrewrote ${changed} shells; build.json marked faces: mirrored (new cache key)`);
} else {
  console.log("\ndry run: nothing written");
}
