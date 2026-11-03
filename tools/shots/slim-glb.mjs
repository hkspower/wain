// Strip what the car GLBs carry for nobody.
//
//   node tools/shots/slim-glb.mjs press/renders/glb            # a directory
//   node tools/shots/slim-glb.mjs press/renders/glb/zeta-300.glb
//
// export-cars.mjs serialises every mesh with the TEXCOORD_0 the game's
// geometries happen to carry, but most car materials sample no texture at
// all — measured across the 17 cars, 17.7 MB of the 161 MB was UV data on
// untextured primitives. And a car whose hood decal was never drawn still
// ships the full-size canvas as a 100%-transparent PNG. Neither is read by
// anything: the Unity reader treats TEXCOORD_0 as optional per primitive
// (CarAsset.cs), and Blender and Unreal import UV-less primitives as plain
// glTF.
//
// So, in place and losslessly for every reader:
//   - TEXCOORD_0 is dropped from primitives whose material references no
//     texture anywhere (base colour, emissive, clearcoat — any {index}
//     under a key ending "Texture", extensions included);
//   - an image whose every alpha byte is zero becomes a 1x1 transparent
//     PNG (same look: fully transparent either way);
//   - accessors and bufferViews nothing references any more are dropped
//     and the binary chunk is repacked.
//
// The JSON is otherwise untouched, so a slimmed file parses exactly like
// the original everywhere the original did.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

// The smallest transparent PNG sharp will write deterministically.
const EMPTY_PNG = await sharp({
  create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
}).png().toBuffer();

const texturedKeys = (o) => {
  if (!o || typeof o !== "object") return false;
  for (const [k, v] of Object.entries(o)) {
    if (k.endsWith("Texture") && v && typeof v === "object" && "index" in v) return true;
    if (typeof v === "object" && texturedKeys(v)) return true;
  }
  return false;
};

export async function slim(path) {
  const file = readFileSync(path);
  if (file.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const jsonLen = file.readUInt32LE(12);
  const j = JSON.parse(file.subarray(20, 20 + jsonLen).toString());
  const binOff = 20 + jsonLen + 8;
  const bin = file.subarray(binOff, binOff + file.readUInt32LE(20 + jsonLen));

  // 1. Drop TEXCOORD_0 where the material never samples a texture.
  const mats = j.materials ?? [];
  let uvDropped = 0;
  for (const mesh of j.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const at = prim.attributes ?? {};
      if (!("TEXCOORD_0" in at)) continue;
      const m = prim.material != null ? mats[prim.material] : null;
      if (!texturedKeys(m)) { delete at.TEXCOORD_0; uvDropped++; }
    }
  }

  // 2. Blank out fully transparent images.
  const views = j.bufferViews ?? [];
  const blanks = new Map(); // bufferView index -> replacement bytes
  for (const im of j.images ?? []) {
    const bv = views[im.bufferView];
    const blob = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    try {
      const alpha = await sharp(blob).ensureAlpha().extractChannel(3).raw().toBuffer();
      if (!alpha.some((v) => v > 0)) blanks.set(im.bufferView, EMPTY_PNG);
    } catch { /* not decodable: leave it be */ }
  }

  // 3. Garbage-collect accessors, then bufferViews, and repack the binary.
  const usedAcc = new Set();
  for (const mesh of j.meshes ?? [])
    for (const prim of mesh.primitives ?? []) {
      for (const a of Object.values(prim.attributes ?? {})) usedAcc.add(a);
      if (prim.indices != null) usedAcc.add(prim.indices);
      for (const t of prim.targets ?? []) for (const a of Object.values(t)) usedAcc.add(a);
    }
  const accMap = new Map();
  j.accessors = (j.accessors ?? []).filter((_, i) => usedAcc.has(i));
  let n = 0;
  for (const i of [...usedAcc].sort((a, b) => a - b)) accMap.set(i, n++);

  const usedBv = new Set();
  for (const a of j.accessors) if (a.bufferView != null) usedBv.add(a.bufferView);
  for (const im of j.images ?? []) usedBv.add(im.bufferView);

  const keptBv = [...usedBv].sort((a, b) => a - b);
  const bvMap = new Map(keptBv.map((old, i) => [old, i]));
  const parts = [];
  let off = 0;
  const newViews = keptBv.map((old) => {
    const bv = views[old];
    const bytes = blanks.get(old) ?? bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const pad = (4 - (off % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
    parts.push(bytes);
    const nv = { ...bv, byteOffset: off, byteLength: bytes.length };
    off += bytes.length;
    return nv;
  });
  j.bufferViews = newViews;
  for (const a of j.accessors) if (a.bufferView != null) a.bufferView = bvMap.get(a.bufferView);
  for (const im of j.images ?? []) im.bufferView = bvMap.get(im.bufferView);
  for (const mesh of j.meshes ?? [])
    for (const prim of mesh.primitives ?? []) {
      for (const k of Object.keys(prim.attributes ?? {})) prim.attributes[k] = accMap.get(prim.attributes[k]);
      if (prim.indices != null) prim.indices = accMap.get(prim.indices);
      for (const t of prim.targets ?? []) for (const k of Object.keys(t)) t[k] = accMap.get(t[k]);
    }

  let newBin = Buffer.concat(parts);
  const binPad = (4 - (newBin.length % 4)) % 4;
  if (binPad) newBin = Buffer.concat([newBin, Buffer.alloc(binPad)]);
  j.buffers = [{ byteLength: newBin.length }];

  let jsonBuf = Buffer.from(JSON.stringify(j));
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.from(" ".repeat(jsonPad))]);

  const head = Buffer.alloc(12 + 8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8);
  head.writeUInt32LE(jsonBuf.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(newBin.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([head, jsonBuf, binHead, newBin]);
  writeFileSync(path, out);
  return { before: file.length, after: out.length, uvDropped, blanked: blanks.size };
}

// CLI
const self = process.argv[1] ?? "";
if (self.endsWith("slim-glb.mjs")) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error("usage: node tools/shots/slim-glb.mjs <file.glb | dir>..."); process.exit(2); }
  const files = args.flatMap((a) =>
    statSync(a).isDirectory() ? readdirSync(a).filter((f) => f.endsWith(".glb")).map((f) => join(a, f)) : [a]);
  let b = 0, c = 0;
  for (const f of files) {
    const r = await slim(f);
    b += r.before; c += r.after;
    console.log(`${f}  ${(r.before / 1e6).toFixed(1)} -> ${(r.after / 1e6).toFixed(1)} MB  (uv off ${r.uvDropped} prims, ${r.blanked} blank image${r.blanked === 1 ? "" : "s"})`);
  }
  console.log(`${files.length} files: ${(b / 1e6).toFixed(1)} -> ${(c / 1e6).toFixed(1)} MB`);
}
