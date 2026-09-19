// Every authored car shell is the same surface on both sides.
//
//   npm run check:shells
//
// A body is hung with symmetric parts — two lamps, two mirrors, two
// arches — and it only reads as built if the two sides it hangs them on
// are the same shape. The shipped shells were not: their vertices were
// mirrored to the micron and their triangles were not, so the left flank
// was a different surface from the right by up to 40 mm on the bevel
// (see scripts/mirror-shells.mjs for the mechanism). Nothing caught it
// because a mirrored point cloud looks symmetric to every bounding-box
// test in the repo.
//
// This checks the FACES: for each mesh, the share of triangles whose
// mirror image is also a triangle of the mesh. A mirrored loft is at
// 100%; the old files were at 1%. Static, offline, no Blender.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "public/models";
const MIN_TWINS = 0.995;

const readGlb = (buf) => {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const bin = buf.subarray(20 + jsonLen + 8);
  return { json, bin };
};
const compSize = (t) => (t === 5126 || t === 5125 ? 4 : t === 5123 ? 2 : 1);
const acc = (json, bin, idx) => {
  const a = json.accessors[idx]; const bv = json.bufferViews[a.bufferView];
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const size = compSize(a.componentType);
  const stride = bv.byteStride ?? comps * size;
  const out = a.componentType === 5126 ? new Float32Array(a.count * comps) : new Uint32Array(a.count * comps);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
    const o = off + i * stride + c * size;
    out[i * comps + c] = a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : bin.readUInt8(o);
  }
  return out;
};

const fail = [];
const files = readdirSync(DIR).filter((f) => /^car-.*\.glb$/.test(f)).sort();
console.log("shell             part     twins     tris  edges");
for (const f of files) {
  const { json, bin } = readGlb(readFileSync(join(DIR, f)));
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes[node.mesh];
    for (const prim of mesh.primitives) {
      const p = acc(json, bin, prim.attributes.POSITION);
      const idx = prim.indices !== undefined ? acc(json, bin, prim.indices) : null;
      const nv = p.length / 3;
      const key = (x, y, z) => `${Math.round(x * 2000)}:${Math.round(y * 2000)}:${Math.round(z * 2000)}`;
      const canon = new Map(); const cid = new Int32Array(nv);
      for (let i = 0; i < nv; i++) { const k = key(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); if (!canon.has(k)) canon.set(k, canon.size); cid[i] = canon.get(k); }
      const mir = new Int32Array(nv);
      for (let i = 0; i < nv; i++) { const k = key(-p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); mir[i] = canon.has(k) ? canon.get(k) : -1; }
      const tris = idx ? idx.length / 3 : nv / 3;
      const faces = new Set();
      const fk = (a, b, c) => [a, b, c].sort((x, y) => x - y).join(",");
      const list = [];
      for (let t = 0; t < tris; t++) {
        const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
        faces.add(fk(cid[a], cid[b], cid[c])); list.push([a, b, c]);
      }
      // Triangles that touch both sides of the centreline are the flat
      // middle of the loft — planar quads whose diagonal can run either
      // way without changing the surface — so they are not asked for a
      // twin. Everything else is.
      const EPS = 0.002;
      const sideOf = (i) => (p[i * 3] > EPS ? 1 : p[i * 3] < -EPS ? -1 : 0);
      let twins = 0, sided = 0, straddle = 0;
      for (const [a, b, c] of list) {
        const s = [sideOf(a), sideOf(b), sideOf(c)];
        if (s.some((v) => v > 0) && s.some((v) => v < 0)) { straddle++; continue; }
        sided++;
        if (mir[a] >= 0 && mir[b] >= 0 && mir[c] >= 0 && faces.has(fk(mir[a], mir[b], mir[c]))) twins++;
      }
      // And it is still a closed surface. A loft is a solid: every edge
      // is shared by exactly two triangles. An edge on one triangle is a
      // hole, an edge on three is an overlap — and a repair that mirrors
      // the wrong triangles produces both at once while keeping every
      // face perfectly twinned. Counted on welded vertices, so a seam of
      // split normals is not mistaken for an opening.
      const edges = new Map();
      for (const [a, b, c] of list) {
        for (const [p0, p1] of [[cid[a], cid[b]], [cid[b], cid[c]], [cid[c], cid[a]]]) {
          const k = p0 < p1 ? `${p0},${p1}` : `${p1},${p0}`;
          edges.set(k, (edges.get(k) ?? 0) + 1);
        }
      }
      let open = 0, over = 0;
      for (const n of edges.values()) { if (n === 1) open++; else if (n > 2) over++; }
      // Open edges fail. Over-shared ones are only reported: the roof
      // shells ship with hundreds where the offset rings self-touch at
      // the sharp tips (build_assets.py says so), and that is the loft's
      // to fix, not a hole a repair put there.
      const share = twins / Math.max(1, sided);
      const ok = share >= MIN_TWINS && open === 0;
      if (share < MIN_TWINS) fail.push(`${f} ${node.name}: only ${(share * 100).toFixed(1)}% of one-sided triangles have a mirrored twin — the two sides are different surfaces`);
      if (open) fail.push(`${f} ${node.name}: ${open} open edge(s) — the shell has holes`);
      console.log(`${f.padEnd(17)} ${String(node.name).padEnd(8)} ${(share * 100).toFixed(1).padStart(5)}%  ${String(tris).padStart(6)}  (${straddle} across the seam)  open ${String(open).padStart(4)}  over ${String(over).padStart(4)}  ${ok ? "ok" : "FAIL"}`);
    }
  }
}
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const m of fail) console.log(`  - ${m}`);
  process.exit(1);
}
console.log("\nevery shell is the same surface on both sides");
