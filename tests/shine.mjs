// The picture's bright end, as anything that reads the canvas sees it.
//
//   npm run test:shine      (no browser, no dev server)
//
// Two defects made the game's highlights read as blown in every frame
// that left the browser, and neither was in the light:
//
//   ALPHA  The grade, the last pass that writes the canvas, passed the
//          scene's alpha through, and the scene's alpha is not coverage:
//          the sky dome and every blended surface leave it under 1 (at
//          noon every pixel of the frame, the zenith at 140/255). On
//          screen that is invisible over the black backdrop. But
//          toDataURL (the 4K stills, the film frames) and drawImage
//          (every instrument in tools/shots) UN-premultiply, dividing
//          the colour by alpha: a 60,141,222 zenith came back
//          109,255,255. Read off the GPU the noon frame was 0.01% blown;
//          through the canvas, 8%.
//
//   FLOORS The cars' night floors — the small emissive that keeps a
//          livery, a plate, a painted stripe or a passive reflector
//          readable between street lamps — stayed on in the sun, on top
//          of the sunlight, where the world's own floors switch off.
//
// What this cannot see is the pixels; tools/shots/highlights.mjs drives
// the game and measures the blown share, the single-channel clips and the
// frame-to-frame sparkle on the chase camera at night and at noon.
import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c; };
const ok = (c) => (c ? "ok" : "FAIL");

// --- ALPHA -------------------------------------------------------------
const grade = readFileSync("src/game/grade.ts", "utf8");
const start = grade.indexOf("export const GradeShader");
const end = grade.indexOf("\n};", start);
const gradeSrc = grade.slice(start, end);
const writes = [...gradeSrc.matchAll(/gl_FragColor\s*=\s*([^;]+);/g)].map((m) => m[1].replace(/\s+/g, " "));
check(writes.length === 1, `the grade writes gl_FragColor ${writes.length} times, expected once`);
const opaque = writes.length === 1 && /,\s*1\.0\s*\)$/.test(writes[0]);
check(opaque, `the grade's output alpha is not 1.0: ${writes[0]}`);
// The arithmetic of the defect, so the reason stays on record: what a
// canvas read returns for a premultiplied pixel at alpha a.
const unpremul = (v, a) => Math.min(255, Math.round((v * 255) / a));
const zenith = [60, 141, 222].map((v) => unpremul(v, 140));
check(zenith[1] === 255 && zenith[2] === 255, "the un-premultiply model no longer reproduces the blown zenith");
console.log(`alpha       grade writes ${writes[0] ?? "?"}  ${ok(opaque)}`);
console.log(`            (at alpha 140 a canvas read turns 60,141,222 into ${zenith.join(",")})`);

// --- FLOORS ------------------------------------------------------------
const cars = readFileSync("src/game/cars.ts", "utf8");
const engine = readFileSync("src/game/engine.ts", "utf8");
const FLOORS = [
  ["decals", /function decalMat\([^)]*\)[^{]*\{[\s\S]{0,200}?return nightFloor\(new THREE\.MeshStandardMaterial/],
  ["plates", /function plateMat\([^)]*\)[^{]*\{[\s\S]{0,400}?return nightFloor\(new THREE\.MeshStandardMaterial/],
  ["hot stripe", /const hotStripeMat = nightFloor\(/],
  ["red reflector", /const reflectorMat = nightFloor\(/],
  ["amber reflector", /const amberReflectorMat = nightFloor\(/],
  ["police band", /const bandMat = nightFloor\(new THREE\.MeshStandardMaterial\(\{\s*name: "police-band"/],
  ["demon mark", /nightFloor\(mark, 0\.42\)/],
];
for (const [name, re] of FLOORS) {
  const has = re.test(cars);
  check(has, `${name}: not registered as a night floor`);
  console.log(`floor       ${name.padEnd(16)} ${ok(has)}`);
}
// Lamps that are ON by day must not be in the set.
for (const lamp of ["indicatorMat", "reverseMat"]) {
  const re = new RegExp(`const ${lamp} = nightFloor\\(`);
  check(!re.test(cars), `${lamp} is a lamp, not a floor`);
}
// The registry scales from the base it stored, so a second call cannot
// compound; and the engine drives it from the world's own lamp level.
const scales = /m\.emissiveIntensity = \(m\.userData\.nightFloor as number\) \* nightFloorLevel/.test(cars);
check(scales, "setCarNightFloors does not scale from the stored base");
const driven = /setCarNightFloors\(this\.world\?\.lampLevel\?\.\(\) \?\? dark\)/.test(engine);
check(driven, "applyDaylight does not drive the car floors from the world's lamp level");
console.log(`floor       scaled from base ${ok(scales)}, driven by lampLevel ${ok(driven)}`);

if (fail.length) {
  console.log(`\nFAIL\n  ${fail.join("\n  ")}`);
  process.exit(1);
}
console.log("\nok");
