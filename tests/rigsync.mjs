// The rig has three copies downstream of src/game/rig.ts, and nothing
// guarded two of them.
//
//   npm run test:rigsync      (no browser, no dev server)
//
// tools/blender/profiles.json carries the rig block Blender dimensions
// the authored driver from; public/models/driver.glb is what it built;
// build.json is what the game believes shipped. The profiles copy lapsed
// twice — Aug 20 to 28 and Sep 3 to 4 — and was only caught up by
// unrelated car-shell rebuilds. This reads each copy the way its
// consumer does and compares.

import { readFileSync, readdirSync } from "node:fs";
import { readRig } from "../scripts/lib/rig-literal.mjs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

// --- 1. profiles.json carries exactly the rig the game runs ------------
const rig = readRig();
const profiles = JSON.parse(readFileSync("tools/blender/profiles.json", "utf8"));
const flat = (o, p = "", out = []) => {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object") flat(v, `${p}${k}.`, out);
    else out.push([`${p}${k}`, v]);
  }
  return out;
};
{
  const a = new Map(flat(rig)), b = new Map(flat(profiles.rig ?? {}));
  let diffs = 0;
  for (const [k, v] of a) if (!b.has(k) || Math.abs(b.get(k) - v) > 1e-12) { diffs++; if (diffs <= 5) fail.push(`profiles.json rig ${k}: ${b.get(k)} vs rig.ts ${v}`); }
  for (const k of b.keys()) if (!a.has(k)) { diffs++; if (diffs <= 5) fail.push(`profiles.json rig carries ${k}, which rig.ts no longer has`); }
  check(diffs === 0, `${diffs} rig constants differ between rig.ts and tools/blender/profiles.json — run node scripts/export-car-profiles.mjs`);
  console.log(`profiles.json  ${a.size} rig constants, ${diffs} differ from rig.ts`);
}

// --- 2. The authored driver was built from THIS rig --------------------
// Read the GLB's own accessor extents: no three.js, no browser. The
// Wheel is a torus at rim radius + tube; its x extent is the outer edge
// and its y extent the tube, so the centre line is outer − tube.
const glb = (path) => {
  const buf = readFileSync(path);
  check(buf.readUInt32LE(0) === 0x46546c67, `${path} is not a GLB`);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
};
{
  const j = glb("public/models/driver.glb");
  const mesh = (name) => j.meshes.find((m) => m.name === name);
  const extent = (name) => {
    const m = mesh(name);
    check(!!m, `driver.glb has no mesh named ${name}`);
    const acc = j.accessors[m.primitives[0].attributes.POSITION];
    return { min: acc.min, max: acc.max };
  };
  const w = extent("Wheel");
  const outer = w.max[0], tube = w.max[1];
  const rim = outer - tube;
  check(Math.abs(rim - rig.driver.wheelRadius) < 1e-3,
    `driver.glb's rim centre line is ${rim.toFixed(4)} m, the rig solves the hands onto ${rig.driver.wheelRadius} — rebuild the driver`);
  const tris = j.meshes.flatMap((m) => m.primitives).reduce((n, p) => n + j.accessors[p.indices].count / 3, 0);
  const build = JSON.parse(readFileSync("public/models/build.json", "utf8"));
  check(build.assets?.driver?.tris === tris, `build.json says the driver is ${build.assets?.driver?.tris} tris, the GLB holds ${tris}`);
  console.log(`driver.glb     rim centre line ${rim.toFixed(3)} m vs rig ${rig.driver.wheelRadius}; ${tris} tris, manifest ${build.assets?.driver?.tris}`);

  // --- 3. The manifest lists every file that ships, and nothing else ---
  const files = readdirSync("public/models").filter((f) => f.endsWith(".glb")).map((f) => f.replace(/\.glb$/, "")).sort();
  const listed = Object.keys(build.assets ?? {}).sort();
  check(JSON.stringify(files) === JSON.stringify(listed),
    `build.json lists [${listed}] but public/models holds [${files}] — a partial rebuild clobbered the manifest`);
  console.log(`build.json     ${listed.length} assets listed, ${files.length} GLBs on disk`);
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nthe rig's copies are current");
process.exit(fail.length ? 1 : 0);
