// Every car in the catalogue, as the showroom sells it, exported out of
// the running game as a glTF binary — for tools/blender/render_cars.py.
//
//   npm run dev
//   node tools/shots/export-cars.mjs                 # all 17
//   node tools/shots/export-cars.mjs --only black-demon,falcon-720
//
// Writes press/renders/glb/<id>.glb and press/renders/cars.json (the
// catalogue record the render script labels each image from).
//
// WHY OUT OF THE GAME. A car here is not a model file: it is
// createCar() in src/game/cars.ts — nine Blender-lofted shells, the
// hero wheels, the driver, and some thousand lines of procedural trim,
// lamps, kit, paint and decals, with the paint, tint, livery and exhaust
// decided by src/game/mods.ts. The only way to get THE car, rather than
// an approximation of it, is to let the game build it and hand the
// result over. So this boots the game, asks the showroom for each
// record's factory build (window.__grnShowroom.tuneFor — the same call
// the menu's turntable makes, so Black Demon leaves with its titanium
// tips), builds it with the engine's own createCar, waits for the
// authored shells, wheels and driver to land, and serialises the group
// with three's GLTFExporter.
//
// WHAT IS STRIPPED, AND WHY. Everything the car carries for the game's
// renderer and not for a camera: the painted contact-shadow decal, the
// headlamp halo sprites, the additive tail-glow planes, the underglow.
// All of them are marked userData.noShadow — the same flag the length
// fit uses to ignore them — so that one flag is the rule.
//
// THE userData TRAP. The exporter serialises userData as glTF extras,
// and the car's userData holds live THREE objects (the wheel groups,
// the contact mesh, the body material) whose toJSON writes whole
// geometries and canvas textures as data URLs into the file: tens of
// megabytes of extras per car. userData is blanked on every object
// before the export; the car is disposed afterwards, so nothing needs
// putting back.
//
// GLTFExporter is not in the page (the game ships core three only). It
// is one ESM file importing a handful of names from 'three', so it is
// rewritten on the fly to read them off window.__grnThree and injected
// with addScriptTag — no bundler, no import map.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ONLY = arg("only", "").split(",").filter(Boolean);
const OUT = arg("out", "press/renders");
mkdirSync(`${OUT}/glb`, { recursive: true });

// three's exporter, made global.
const require = createRequire(import.meta.url);
const exporterPath = require.resolve("three/examples/jsm/exporters/GLTFExporter.js");
const exporterSrc = readFileSync(exporterPath, "utf8");
const importBlock = exporterSrc.match(/^import \{([\s\S]*?)\} from 'three';\s*$/m);
if (!importBlock) { console.error("GLTFExporter.js no longer has the single import block this rewrites"); process.exit(2); }
const exporterGlobal = exporterSrc
  .replace(importBlock[0], `const {${importBlock[1]}} = window.__grnThree;`)
  .replace(/^export \{ GLTFExporter \};\s*$/m, "window.__grnGLTFExporter = GLTFExporter;");
if (!exporterGlobal.includes("window.__grnGLTFExporter")) { console.error("GLTFExporter.js export statement not found"); process.exit(2); }

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.setDefaultTimeout(600000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug && !!window.__grnBuildCar && !!window.__grnShowroom, null, { timeout: 600000 });
// The engine is only needed for its handles: stop its frame loop and
// shrink the window, so the export has the machine.
await page.evaluate(() => { window.__grnEngine.skipCinematic?.(); window.__grnEngine.setPaused(true); });
await page.setViewportSize({ width: 80, height: 60 });
await page.addScriptTag({ content: exporterGlobal });
const ok = await page.evaluate(() => typeof window.__grnGLTFExporter === "function");
if (!ok) { console.error("the exporter did not load in the page"); await browser.close(); process.exit(2); }

const ids = await page.evaluate(() => window.__grnCars.map((c) => c.id));
const todo = ONLY.length ? ids.filter((id) => ONLY.includes(id)) : ids;
const missing = ONLY.filter((id) => !ids.includes(id));
if (missing.length) console.log(`not in the catalogue: ${missing.join(", ")}`);
console.log(`exporting ${todo.length} car${todo.length === 1 ? "" : "s"}`);

const records = [];
for (const id of todo) {
  const t0 = Date.now();
  const r = await page.evaluate(async (id) => {
    const THREE = window.__grnThree;
    const car = window.__grnCars.find((c) => c.id === id);
    const t = window.__grnShowroom.tuneFor(id);
    // The engine's own record-to-createCar mapping (engine.ts, the
    // player car), minus the racing number: a showroom car wears none.
    const colors = {
      body: t.paint, accent: t.accent ?? 0x007a3d, stripes: t.stripes, style: t.bodyStyle,
      underglow: t.glow ?? undefined, spoiler: t.spoiler, goldRims: t.goldRims, rims: t.rims,
      livery: t.livery, trike: t.trike, face: t.face, tyreSticker: t.tyreSticker,
      engineCover: t.engineCover ?? undefined, carbon: t.carbon, raceKit: t.raceKit, kit: t.kit,
      headlamps: t.headlamps, tint: t.tint, tintFilm: t.tintFilm, finish: t.finish,
      stickers: t.stickers, fullStripe: t.fullStripe, name: t.carName, nameAr: t.carNameAr,
      lengthM: t.lengthM, crew: t.crew ?? undefined, exhaust: t.exhaust,
    };
    const group = window.__grnBuildCar(colors);
    // The authored parts arrive asynchronously. Wait for every shell
    // slot to have a verdict, and every authored wheel and driver part
    // to be authored — models.ts caches the files, so after the first
    // car this is a tick.
    const authoredWheel = new Set(["tire", "barrel", "alloy", "rotor", "lugs"]);
    const authoredDriver = new Set(["helmet", "visor", "glove", "wheel", "pedal"]);
    const settled = () => {
      const v = group.userData.shellSwap ?? {};
      const shells = v.all !== undefined || ["body", "canopy", "roof"].every((k) => v[k] !== undefined);
      let wheelsPending = 0, driverPending = 0;
      group.traverse((o) => {
        if (!o.isMesh) return;
        if (authoredWheel.has(o.userData.wheelPart) && !o.geometry.userData.authored) wheelsPending++;
        if (authoredDriver.has(o.userData.driverPart) && !o.geometry.userData.authored) driverPending++;
      });
      return shells && !wheelsPending && !driverPending;
    };
    const t1 = performance.now();
    while (!settled() && performance.now() - t1 < 30000) await new Promise((r) => setTimeout(r, 50));
    const waited = Math.round(performance.now() - t1);
    const verdict = { ...(group.userData.shellSwap ?? {}) };
    const lengthM = group.userData.lengthM;
    // Strip what is for the game's renderer, not a camera.
    const drop = [];
    group.traverse((o) => { if (o !== group && (o.userData.noShadow || o.isSprite)) drop.push(o); });
    for (const o of drop) o.parent?.remove(o);
    // And the userData, everywhere — see the note at the top of the file.
    group.updateMatrixWorld(true);
    let meshes = 0, tris = 0;
    group.traverse((o) => {
      o.userData = {};
      if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }
    });
    const scene = new THREE.Scene();
    scene.add(group);
    const exporter = new window.__grnGLTFExporter();
    const buf = await exporter.parseAsync(scene, { binary: true, onlyVisible: true, embedImages: true, maxTextureSize: 4096 });
    scene.remove(group);
    // Base64 in chunks: String.fromCharCode over a 10 MB buffer at once
    // blows the argument limit.
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return {
      b64: btoa(s), bytes: bytes.length, meshes, tris: Math.round(tris), dropped: drop.length, waited, verdict, lengthM,
      record: {
        id: car.id, name: car.name, ar: car.ar ?? car.arabicName ?? "", cls: car.cls, price: car.price,
        color: `#${(t.paint >>> 0).toString(16).padStart(6, "0")}`, finish: t.finish, style: t.bodyStyle,
        kit: t.kit, exhaust: t.exhaust ?? null, lengthM,
      },
    };
  }, id);
  writeFileSync(`${OUT}/glb/${id}.glb`, Buffer.from(r.b64, "base64"));
  records.push(r.record);
  const shells = Object.entries(r.verdict).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(
    `  ${id.padEnd(16)} ${(r.bytes / 1e6).toFixed(1).padStart(5)} MB  ${String(r.meshes).padStart(3)} meshes  ${String(r.tris).padStart(7)} tris  ` +
    `dropped ${r.dropped}  waited ${r.waited} ms  ${shells}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`
  );
}
writeFileSync(`${OUT}/cars.json`, JSON.stringify(records, null, 2) + "\n");
await browser.close();
console.log(`\n${records.length} cars in ${OUT}/glb, records in ${OUT}/cars.json`);
