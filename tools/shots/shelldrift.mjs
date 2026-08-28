// How far have the authored shells drifted from the car the game builds?
//
//   npm run dev
//   node tools/shots/shelldrift.mjs
//
// public/models/car-{sedan,zx,gtr,rx7}.glb are lofted by
// tools/blender/build_assets.py from tools/blender/profiles.json, which
// scripts/export-car-profiles.mjs exports from src/game/cars.ts. Four
// steps, three of which can go stale without anything going red: the
// swap in models.ts is silent by design, so a shell lofted from last
// year's profile looks exactly like a shell lofted from this one.
//
// This measures the difference. For each silhouette it reads the shell's
// bounding box the instant the car is built — the procedural shape,
// which is what every anchor, decal, light and now the driver's seat is
// positioned against — and again once the GLB has landed on it.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium","/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find(p=>existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }
const b = await chromium.launch({executablePath:exe,args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"],headless:true});
const page = await b.newPage({viewport:{width:1280,height:720}});
page.setDefaultTimeout(120000);
page.on("pageerror",(e)=>console.log("PAGEERROR:",e.message));
await page.goto("http://localhost:3000/race",{waitUntil:"networkidle"});
await page.evaluate(()=>{localStorage.clear();localStorage.setItem("gulf-road-nights-onboarded","2");localStorage.setItem("gulf-road-nights-coach","3");});
await page.reload({waitUntil:"networkidle"});
await page.click("text=START ENGINE");
await page.waitForFunction(()=>!!window.__grnDebug,null,{timeout:120000});

const cars = await page.evaluate(()=>fetch("/api/grn/v1/cars").then(r=>r.json()));
const bySilhouette = new Map();
for (const c of cars.cars) if (!bySilhouette.has(c.bodyStyle)) bySilhouette.set(c.bodyStyle, c);

const SHELLS_PAGE = ["body","canopy","roof"];
const measure = (carId) => page.evaluate(async (carId)=>{
  const SHELLS = ["body","canopy","roof"];
  const e = window.__grnEngine;
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: carId, cars: [carId], owned: [], kd: 99999,
    equipped: { paint: "paint-white", glow: "glow-none" },
  }));
  const read = () => {
    const out = {};
    e.carBody.traverse((o)=>{
      const s = o.userData.shell;
      if (!o.isMesh || !s) return;
      const g = o.geometry; g.computeBoundingBox();
      const bb = g.boundingBox;
      out[s] = {
        tris: (g.index ? g.index.count : g.attributes.position.count) / 3,
        min: [bb.min.x, bb.min.y, bb.min.z].map(n=>+n.toFixed(3)),
        max: [bb.max.x, bb.max.y, bb.max.z].map(n=>+n.toFixed(3)),
      };
    });
    out.verdict = e.carBody.userData.shellSwap || null;
    return out;
  };
  // Paused. This browser renders the game at a couple of frames a second
  // on software GL, and parsing a 156k-triangle GLB competes with that
  // for the same thread: measured warm, the swap took twenty seconds
  // with the loop running. A fixed wait here does not measure the asset,
  // it measures the frame rate.
  e.setPaused(true);
  e.applyGarage();
  const before = read();          // procedural: the swap is a promise
  // Poll rather than sleep. A 2.8 MB GLB fetched cold and parsed in a
  // software-GL browser takes several seconds, and a fixed wait reports
  // "no authored shell landed" for exactly the files that are slowest —
  // which is every file that was not already warm from page load.
  const same = () => SHELLS.every((s)=>!before[s] || !read()[s] || before[s].tris === read()[s].tris);
  const t0 = Date.now();
  while (same() && Date.now() - t0 < 60000) await new Promise(r=>setTimeout(r,250));
  return { before, after: read(), waitedMs: Date.now() - t0 };
}, carId);

const SHELLS = ["body", "canopy", "roof"];
let worst = 0;
for (const [style, c] of bySilhouette) {
  const m = await measure(c.id);
  console.log(`\n${c.name} (${style})  ${JSON.stringify(m.after.verdict)}`);
  for (const s of SHELLS) {
    const a = m.before[s], z = m.after[s];
    if (!a || !z) { console.log(`  ${s.padEnd(7)} missing`); continue; }
    if (a.tris === z.tris && a.max[1] === z.max[1] && a.min[1] === z.min[1] && a.max[0] === z.max[0]) {
      console.log(`  ${s.padEnd(7)} procedural only (${a.tris} tris) — no authored shell landed`);
      continue;
    }
    const d = (i) => [
      +(z.min[i]-a.min[i]).toFixed(3), +(z.max[i]-a.max[i]).toFixed(3),
    ];
    const drift = Math.max(...[0,1,2].flatMap(i=>d(i).map(Math.abs)));
    worst = Math.max(worst, drift);
    console.log(`  ${s.padEnd(7)} ${a.tris} -> ${z.tris} tris; box moved x ${d(0)}  y ${d(1)}  z ${d(2)} m`);
  }
}
console.log(`\nworst single-face drift ${(worst*1000).toFixed(0)} mm`);
await b.close();
