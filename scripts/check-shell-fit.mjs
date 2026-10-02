// Would the game accept these car shells? Asked offline, exactly as the
// game asks it at load.
//
//   npm run check:shell-fit                          # every public/models/car-*.glb
//   npm run check:shell-fit -- path/to/car-gtr.glb   # one file (style from its name)
//   npm run check:shell-fit -- --style gtr x.glb     # a file named otherwise
//   npm run check:shell-fit -- --json ...            # machine-readable, for tools/max/import.mjs
//
// models.ts swaps an authored Body, Canopy or Roof onto a car only if,
// once crowned, it sits within SHELL_FIT_TOL (10 mm) of the shell the
// game extrudes itself — by bounding box and by skin. Past that it is
// rejected SILENTLY, and the car quietly wears the extrusion. This runs
// the same test (shellFit, from models.ts) against the same procedural
// shells (createCar, in node, as tests/glassfit.mjs builds them), so a
// file can be judged before it ships rather than after nobody notices.
import * as THREE from "three";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import "../tests/lib/dom-stub.mjs";
import { createCar, crownFor, crownShell } from "../src/game/cars.ts";
import { shellFit, SHELL_FIT_TOL } from "../src/game/models.ts";

const SLOTS = ["body", "canopy", "roof"];
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const si = argv.indexOf("--style");
const forced = si >= 0 ? argv[si + 1] : null;
let files = argv.filter((a, i) => !a.startsWith("--") && !(si >= 0 && i === si + 1));
if (!files.length)
  files = readdirSync("public/models").filter((f) => /^car-.+\.glb$/.test(f)).sort().map((f) => `public/models/${f}`);

const loader = new GLTFLoader();
const loadGlb = (file) =>
  new Promise((res) => {
    const buf = readFileSync(file);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    loader.parse(ab, "", (g) => {
      const out = {}, names = [];
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        names.push(o.name.toLowerCase());
        out[o.name.toLowerCase()] = geo;
      });
      res({ out, names });
    }, (e) => res({ error: String(e?.message ?? e) }));
  });

/** Which face of the box is furthest out, for a message a modeller can act on. */
function worstFace(a, b) {
  a.computeBoundingBox(); b.computeBoundingBox();
  const A = a.boundingBox, B = b.boundingBox;
  const faces = [
    ["left (-x)", A.min.x - B.min.x], ["right (+x)", A.max.x - B.max.x],
    ["bottom (-y)", A.min.y - B.min.y], ["top (+y)", A.max.y - B.max.y],
    ["tail (-z)", A.min.z - B.min.z], ["nose (+z)", A.max.z - B.max.z],
  ];
  return faces.reduce((w, f) => (Math.abs(f[1]) > Math.abs(w[1]) ? f : w));
}

const report = [];
let bad = 0;
for (const file of files) {
  const style = forced ?? basename(file).match(/^car-(.+)\.glb$/)?.[1];
  const entry = { file, style, slots: {} };
  report.push(entry);
  if (!style) { entry.error = "cannot tell the style from the file name; pass --style"; bad++; continue; }
  if (!existsSync(file)) { entry.error = "no such file"; bad++; continue; }
  let car;
  try { car = createCar({ style, body: 0xffffff, accent: 0x222222, kit: "street" }); }
  catch (e) { entry.error = `no such body style (${e.message})`; bad++; continue; }
  const proc = {};
  car.traverse((o) => { if (o.isMesh && o.userData.shell) proc[o.userData.shell] = o.geometry; });
  const got = await loadGlb(file);
  if (got.error) { entry.error = `unreadable: ${got.error}`; bad++; continue; }
  for (const n of SLOTS) {
    const count = got.names.filter((x) => x === n).length;
    if (count > 1) entry.slots[n] = { ok: false, reason: `${count} meshes named ${n}; the game keeps only the last` };
  }
  for (const slot of SLOTS) {
    if (entry.slots[slot]) { bad++; continue; }
    const geo = got.out[slot];
    if (!proc[slot]) { entry.slots[slot] = { ok: true, reason: "the procedural car has no such shell" }; continue; }
    if (!geo) { entry.slots[slot] = { ok: false, reason: "not in the file" }; bad++; continue; }
    crownShell(geo, crownFor(style, slot));
    const fit = shellFit(geo, proc[slot]);
    const [face, by] = worstFace(geo, proc[slot]);
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    entry.slots[slot] = { ...fit, face, faceBy: by, tris };
    if (!fit.ok) bad++;
  }
  const extra = got.names.filter((n) => !SLOTS.includes(n));
  if (extra.length) entry.ignored = extra;
}

if (json) {
  console.log(JSON.stringify({ tolerance: SHELL_FIT_TOL, ok: bad === 0, files: report }, null, 2));
} else {
  const mm = (v) => (Number.isFinite(v) ? `${(v * 1000).toFixed(1)} mm` : "--");
  console.log(`Shell fit: the game accepts a shell within ${SHELL_FIT_TOL * 1000} mm of its own, by box and by skin.\n`);
  for (const e of report) {
    console.log(`${e.file}${e.style ? ` (${e.style})` : ""}`);
    if (e.error) { console.log(`  REJECTED  ${e.error}`); continue; }
    for (const slot of SLOTS) {
      const s = e.slots[slot];
      if (!s) continue;
      const head = `  ${s.ok ? "ok      " : "REJECTED"}  ${slot.padEnd(6)}`;
      if (s.box === undefined) { console.log(`${head}  ${s.reason}`); continue; }
      const where = s.ok ? "" : s.box > SHELL_FIT_TOL
        ? `  — box: worst at the ${s.face}, ${(s.faceBy * 1000).toFixed(0)} mm`
        : "  — skin: the surface has moved inside the box";
      console.log(`${head}  box ${mm(s.box).padStart(8)}  skin ${mm(s.skin).padStart(8)}  ${String(s.tris).padStart(7)} tris${where}`);
    }
    if (e.ignored) console.log(`  (ignored by the game: ${e.ignored.join(", ")})`);
  }
  console.log(bad ? `\n${bad} shell${bad === 1 ? "" : "s"} the game would reject.` : "\nevery shell fits; the game will use them.");
}
process.exit(bad ? 1 : 0);
