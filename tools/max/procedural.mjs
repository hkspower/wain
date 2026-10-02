// What the 3ds Max panel checks against, written out of the game itself.
//
//   node --experimental-strip-types --import ./tools/parity/ts-resolve.mjs tools/max/procedural.mjs [--out press/max] [--dump dir]
//
// For each body style:
//
//   car-<style>-target.glb  the game's own Body, Canopy and Roof as it builds
//                           them (createCar), CROWNED: the shapes models.ts
//                           holds an authored shell to, within 10 mm.
//   car-<style>.nr.json     the crown spec per slot (crownFor), the tolerance,
//                           the shipped file's triangle counts, and how the
//                           game judges the shipped file today (shellFit).
//
// tools/max/nightracer/core.py crowns the shells being modelled with the
// same specs and compares them with the target, so the panel's numbers are
// the game's numbers. --dump also writes the shipped shells crowned by the
// game's crownShell, as raw float32, for tools/max/test_core.py to hold the
// Python port to.
import * as THREE from "three";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import "../../tests/lib/dom-stub.mjs";
import { createCar, crownFor, crownShell } from "../../src/game/cars.ts";
import { shellFit, SHELL_FIT_TOL } from "../../src/game/models.ts";

const STYLES = ["sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv"];
const SLOTS = ["body", "canopy", "roof"];
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = opt("--out", "press/max");
const DUMP = opt("--dump", null);
mkdirSync(OUT, { recursive: true });
if (DUMP) mkdirSync(DUMP, { recursive: true });

const loader = new GLTFLoader();
const loadGlb = (file) =>
  new Promise((res) => {
    const buf = readFileSync(file);
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", (g) => {
      const out = {};
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        out[o.name.toLowerCase()] = geo;
      });
      res(out);
    }, () => res(null));
  });

/** A minimal GLB: one node per mesh, POSITION + uint32 indices, no materials. */
function writeGlb(file, meshes) {
  const json = { asset: { version: "2.0", generator: "night-racer tools/max/procedural.mjs" },
    scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = [];
  let off = 0;
  const view = (bytes, target) => {
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.byteLength, target });
    chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), Buffer.alloc(pad));
    off += bytes.byteLength + pad;
    return json.bufferViews.length - 1;
  };
  for (const [name, geo] of meshes) {
    const pos = new Float32Array(geo.attributes.position.array);
    const n = pos.length / 3;
    const idx = geo.index ? new Uint32Array(geo.index.array) : Uint32Array.from({ length: n }, (_, i) => i);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
      const v = pos[i * 3 + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
    json.accessors.push({ bufferView: view(pos, 34962), componentType: 5126, count: n, type: "VEC3", min, max });
    json.accessors.push({ bufferView: view(idx, 34963), componentType: 5125, count: idx.length, type: "SCALAR" });
    json.meshes.push({ name, primitives: [{ attributes: { POSITION: json.accessors.length - 2 }, indices: json.accessors.length - 1 }] });
    json.nodes.push({ name, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }
  const bin = Buffer.concat(chunks);
  json.buffers.push({ byteLength: bin.length });
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  writeFileSync(file, Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]));
}

const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

for (const style of STYLES) {
  const car = createCar({ style, body: 0xffffff, accent: 0x222222, kit: "street" });
  car.updateMatrixWorld(true);
  const proc = {};
  car.traverse((o) => { if (o.isMesh && o.userData.shell) proc[o.userData.shell] = o.geometry; });
  writeGlb(join(OUT, `car-${style}-target.glb`), SLOTS.filter((s) => proc[s]).map((s) => [`Target_${cap(s)}`, proc[s]]));

  const shippedFile = `public/models/car-${style}.glb`;
  const shipped = existsSync(shippedFile) ? await loadGlb(shippedFile) : null;
  const info = { style, tolerance: SHELL_FIT_TOL, frame: "game: metres, y up, nose +z", slots: {} };
  for (const slot of SLOTS) {
    const spec = { tuck: 0, roof: 0, shoulder: 0.5, plan: 0, smooth: false, ...crownFor(style, slot) };
    const entry = { crown: spec };
    const geo = shipped?.[slot];
    if (geo) {
      entry.shippedTris = tris(geo);
      if (DUMP) writeFileSync(join(DUMP, `${style}-${slot}-raw.f32`), Buffer.from(new Float32Array(geo.attributes.position.array).buffer));
      crownShell(geo, crownFor(style, slot));
      if (DUMP) writeFileSync(join(DUMP, `${style}-${slot}-crowned.f32`), Buffer.from(new Float32Array(geo.attributes.position.array).buffer));
      if (proc[slot]) {
        const f = shellFit(geo, proc[slot]);
        entry.shipped = { ok: f.ok, box: f.box, skin: Number.isFinite(f.skin) ? f.skin : null, reason: f.reason };
      }
    }
    info.slots[slot] = entry;
  }
  writeFileSync(join(OUT, `car-${style}.nr.json`), JSON.stringify(info, null, 2) + "\n");
  const bad = SLOTS.filter((s) => info.slots[s].shipped && !info.slots[s].shipped.ok);
  console.log(`car-${style}: target + nr.json${bad.length ? `  (shipped ${bad.join(", ")} rejected by the game today)` : ""}`);
}
