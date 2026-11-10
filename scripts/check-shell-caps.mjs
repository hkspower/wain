#!/usr/bin/env node
// The flat sides of the authored shells, measured the way they are seen:
// after the game has crowned them.
//
//   npm run check:shell-caps            every public/models/car-*.glb
//   npm run check:shell-caps -- --json  the same, as JSON
//   node ... scripts/check-shell-caps.mjs public/models/car-gtr.glb
//
// WHY THIS EXISTS
//
// A shell is a side profile lofted across the car, and each flank is the
// flat face that closes it: one polygon whose only vertices are on its
// outline. The game then crowns the shell (crownShell, src/game/cars.ts)
// — the nose and tail are drawn in, the top edge pulled in by an amount
// that changes along the car — and it can only move vertices. A flank has
// none inside it, so once the outline has moved, the flank IS whatever
// its triangles happen to span. Triangulation is the surface.
//
// On 3 November 2026 the shells were rebuilt with Blender 5.1, whose
// n-gon "BEAUTY" fill had stopped beautifying: every flank came back as
// two fans, half the triangles on one corner each, edges two to four
// metres long. Nothing failed. check:shells looks for holes and mirror
// twins, and a fan has neither fault; check:shell-fit fires its rays
// straight down and never meets a flank. The stills came out with fold
// lines raked across every door, and so did the game.
//
// So the flank is measured here, crowned, for what the eye catches:
//
//   crease   metres of flank edge longer than 0.3 m whose two triangles
//            meet at more than 2 degrees. A long edge with a fold in it
//            is a line across the paint. (Slivers thinner than 2 mm are
//            left out: they have no stable normal and cover no pixels.)
//   fan      the largest share of a flank's triangles that meet at one
//            vertex. The 5.1 fill sat at 50% on every part.
//   facing   every flank triangle faces away from the car. The signed
//            volume the builder checks cannot tell: a flank wound inside
//            out leaves the volume positive, only smaller.
//   count    a flank of n outline points is n - 2 triangles, no more.
//   mirror   the left flank is the right one, triangle for triangle.
//
// The bars are set from the shells as built by tools/blender/
// build_assets.py (worst part: body 30 m, glass 50 m, roof 0 m, fan 28%)
// against the fans they replaced (body 61 to 270 m, fan 50% everywhere).
// They are not a statement about what is beautiful; they are far enough
// from both that a rebuild landing on the wrong side has gone wrong.
import * as THREE from "three";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import "../tests/lib/dom-stub.mjs";
import { crownFor, crownShell } from "../src/game/cars.ts";

const SLOTS = ["body", "canopy", "roof"];
/** Metres of folded edge allowed per flank. */
const MAX_CREASE = { body: 45, canopy: 60, roof: 5 };
const MAX_FAN = 0.35;
const LONG_EDGE = 0.3;   // m: shorter than this is a facet, not a line
const FOLD_DEG = 2;      // degrees between the two triangles of an edge
const THIN = 2e-3;       // m: a triangle lower than this is a sliver
// The flank ring sits exactly at the widest x. The next ring inboard is
// the first step of the bevel: 25 um on a roof, 33 on a canopy, 41 on a
// body. Ten is clear of float32 noise (0.06 um at one metre) and of them.
const ON_FLANK = 1e-5;

const argv = process.argv.slice(2);
const json = argv.includes("--json");
let files = argv.filter((a) => !a.startsWith("--"));
if (!files.length)
  files = readdirSync("public/models").filter((f) => /^car-.+\.glb$/.test(f)).sort().map((f) => `public/models/${f}`);

const loader = new GLTFLoader();
const loadGlb = (file) =>
  new Promise((res) => {
    const buf = readFileSync(file);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    loader.parse(ab, "", (g) => {
      const out = {};
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        out[o.name.toLowerCase()] = geo;
      });
      res({ out });
    }, (e) => res({ error: String(e?.message ?? e) }));
  });

/** One part of one shell: both flanks, picked out flat and measured crowned. */
function measure(geo, style, slot) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const tri = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  const triCount = (idx ? idx.count : pos.count) / 3;

  let capx = 0;
  for (let i = 0; i < pos.count; i++) capx = Math.max(capx, Math.abs(pos.getX(i)));

  // The flanks are found BEFORE the crown, while they are still planes:
  // afterwards x is different at every vertex and "the widest x" picks
  // out a ridge, not a face.
  const flat = new Float32Array(pos.array);
  const key = (i) => `${Math.round(flat[i * 3 + 1] * 1e6)},${Math.round(flat[i * 3 + 2] * 1e6)}`;
  const sides = { right: { sign: 1, tris: [] }, left: { sign: -1, tris: [] } };
  for (let t = 0; t < triCount; t++) {
    const v = [tri(t, 0), tri(t, 1), tri(t, 2)];
    for (const s of Object.values(sides))
      if (v.every((i) => s.sign * flat[i * 3] > capx - ON_FLANK)) s.tris.push(v);
  }

  // Facing, on the flat flank: the normal of a triangle in the plane
  // x = const is +-x exactly, so its sign is the whole answer.
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const at = (arr, i, out) => out.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
  for (const s of Object.values(sides)) {
    s.inward = 0;
    for (const [i, j, k] of s.tris) {
      at(flat, i, a); at(flat, j, b); at(flat, k, c);
      n.crossVectors(b.sub(a), c.sub(a));
      if (n.length() > 1e-12 && n.x * s.sign < 0) s.inward++;
    }
  }

  crownShell(geo, crownFor(style, slot));
  const cr = geo.attributes.position.array;

  const out = {};
  for (const [name, s] of Object.entries(sides)) {
    const edges = new Map();
    const valence = new Map();
    const normals = [], thin = [], shape = new Set();
    s.tris.forEach((v, ti) => {
      at(cr, v[0], a); at(cr, v[1], b); at(cr, v[2], c);
      const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      const nn = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      const twiceArea = nn.length();
      thin.push(twiceArea / Math.max(longest, 1e-12) < THIN);
      normals.push(nn.divideScalar(Math.max(twiceArea, 1e-18)));
      const ks = v.map(key);
      shape.add([...ks].sort().join("|"));
      for (let e = 0; e < 3; e++) {
        const p = ks[e], q = ks[(e + 1) % 3];
        const ek = p < q ? `${p}|${q}` : `${q}|${p}`;
        if (!edges.has(ek)) edges.set(ek, { ts: [], i: v[e], j: v[(e + 1) % 3] });
        edges.get(ek).ts.push(ti);
        valence.set(p, (valence.get(p) ?? 0) + 1);
      }
    });
    let crease = 0, longestFold = 0;
    for (const { ts, i, j } of edges.values()) {
      if (ts.length !== 2 || thin[ts[0]] || thin[ts[1]]) continue;
      at(cr, i, a); at(cr, j, b);
      const len = a.distanceTo(b);
      if (len < LONG_EDGE) continue;
      let deg = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, normals[ts[0]].dot(normals[ts[1]])))));
      if (deg > 90) deg = 180 - deg;
      if (deg > FOLD_DEG) { crease += len; longestFold = Math.max(longestFold, len); }
    }
    out[name] = {
      tris: s.tris.length,
      outline: valence.size,
      inward: s.inward,
      crease,
      longestFold,
      fan: s.tris.length ? Math.max(...valence.values()) / s.tris.length : 0,
      shape,
    };
  }
  return out;
}

const report = [];
const fail = [];
for (const file of files) {
  const style = basename(file).match(/^car-(.+)\.glb$/)?.[1];
  const entry = { file, style, slots: {} };
  report.push(entry);
  if (!style) { entry.error = "cannot tell the style from the file name"; fail.push(`${file}: ${entry.error}`); continue; }
  if (!existsSync(file)) { entry.error = "no such file"; fail.push(`${file}: ${entry.error}`); continue; }
  const got = await loadGlb(file);
  if (got.error) { entry.error = `unreadable: ${got.error}`; fail.push(`${file}: ${entry.error}`); continue; }
  for (const slot of SLOTS) {
    const geo = got.out[slot];
    if (!geo) continue;
    const m = measure(geo, style, slot);
    const where = `${basename(file)} ${slot}`;
    const mirrored = m.right.shape.size === m.left.shape.size && [...m.right.shape].every((k) => m.left.shape.has(k));
    if (!mirrored) fail.push(`${where}: the left flank is not the right one mirrored`);
    for (const [side, s] of Object.entries(m)) {
      if (!s.tris) { fail.push(`${where} ${side}: no flank found at the widest x`); continue; }
      if (s.tris !== s.outline - 2)
        fail.push(`${where} ${side}: ${s.tris} triangles on an outline of ${s.outline} points (expected ${s.outline - 2})`);
      if (s.inward) fail.push(`${where} ${side}: ${s.inward} flank triangle(s) face into the car`);
      if (s.crease > MAX_CREASE[slot])
        fail.push(`${where} ${side}: ${s.crease.toFixed(1)} m of folded edge, over ${MAX_CREASE[slot]} m (longest ${s.longestFold.toFixed(2)} m)`);
      if (s.fan > MAX_FAN)
        fail.push(`${where} ${side}: ${(s.fan * 100).toFixed(0)}% of the flank's triangles meet at one point — a fan`);
      delete s.shape;
    }
    entry.slots[slot] = { ...m, mirrored };
  }
}

if (json) {
  console.log(JSON.stringify({ bars: { crease: MAX_CREASE, fan: MAX_FAN }, ok: fail.length === 0, files: report }, null, 2));
} else {
  console.log(`Shell flanks, crowned: folded edge over ${LONG_EDGE} m and ${FOLD_DEG} degrees, per side; bars body ${MAX_CREASE.body} m, canopy ${MAX_CREASE.canopy} m, roof ${MAX_CREASE.roof} m, fan ${MAX_FAN * 100}%.\n`);
  for (const e of report) {
    if (e.error) { console.log(`${basename(e.file).padEnd(17)} ${e.error}`); continue; }
    for (const slot of SLOTS) {
      const s = e.slots[slot];
      if (!s) continue;
      const r = s.right;
      const ok = s.mirrored && [s.right, s.left].every((x) =>
        x.tris === x.outline - 2 && !x.inward && x.crease <= MAX_CREASE[slot] && x.fan <= MAX_FAN);
      console.log(
        `${basename(e.file).padEnd(17)} ${slot.padEnd(7)} ${String(r.tris).padStart(4)} tris  crease ${r.crease.toFixed(1).padStart(6)} m  ` +
        `longest ${r.longestFold.toFixed(2)} m  fan ${(r.fan * 100).toFixed(0).padStart(3)}%  ` +
        `${s.mirrored ? "mirrored" : "NOT mirrored"}  ${ok ? "ok" : "FAIL"}`
      );
    }
  }
  console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nevery flank is facing out, mirrored, and free of long folds");
}
process.exit(fail.length ? 1 : 0);
