// Does the driver fit under the roof — and by how much?
//
//   npm run dev
//   node tools/shots/driverfit.mjs
//
// tests/ik.mjs already asks the yes/no question, and answers it with the
// highest shell VERTEX inside a 0.8 m box around the seat. That is a
// proxy, and a coarse one: an extruded shell carries vertices only at
// its profile points and bevel rings, so the number it returns is the
// height of whatever ring happened to fall in the box, which on a
// fastback is the roof's outer edge and not the ceiling over the head
// at all. It can be metres of z away from the head and tens of
// millimetres below the surface the head would actually touch.
//
// This asks the surface directly. For each silhouette it finds where the
// driver's head is in the car's own frame, then evaluates the top skin
// of each shell AT THAT (x, z) by walking the triangles: the ones whose
// XZ projection contains the point, interpolated for height. That is the
// ceiling, at the place the head is, with no box and no proxy.
//
// Three heights matter and they are not the same:
//   canopy   the glasshouse. The head is INSIDE this shell, so its top
//            skin is the real ceiling — the roof panel sits above it.
//   roof     the painted panel on top of the glass.
//   column   what the test measures, printed alongside so the two can
//            be compared rather than confused.
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

const measure = (carId) => page.evaluate(async (carId)=>{
  const e = window.__grnEngine;
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: carId, cars: [carId], owned: [], kd: 99999,
    equipped: { paint: "paint-white", glow: "glow-none" },
  }));
  e.applyGarage();
  await new Promise(r=>setTimeout(r,150));
  const car = e.carBody;
  const rig = car.userData.driver;
  if (!rig) return null;
  const V = e.camera.position.constructor;
  car.updateWorldMatrix(true,true);
  const inv = car.matrixWorld.clone().invert();
  const toCar = (o, v) => v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);

  // Where the head is, and how high it reaches, in the car's own frame.
  // VERTICES, not bounding-box corners. A box corner is only the top of
  // the mesh when the mesh is unrotated, and every bone in a posed rig
  // is rotated: the highest corner in this driver belongs to an upper
  // arm swung up to the wheel, 87 mm above the helmet it is nowhere
  // near. That corner is what "the driver's head is through the roof"
  // was measuring.
  let hi=-1e9, headMesh=null, boxHi=-1e9;
  rig.group.traverse((o)=>{
    if(!o.isMesh) return;
    const g=o.geometry; if(!g.boundingBox) g.computeBoundingBox();
    for (const cy of [g.boundingBox.min.y, g.boundingBox.max.y])
      for (const cx of [g.boundingBox.min.x, g.boundingBox.max.x])
        for (const cz of [g.boundingBox.min.z, g.boundingBox.max.z])
          boxHi = Math.max(boxHi, toCar(o, new V(cx, cy, cz)).y);
    const pos = g.attributes.position; const v = new V();
    for (let i=0;i<pos.count;i++) {
      toCar(o, v.fromBufferAttribute(pos,i));
      if (v.y > hi) { hi = v.y; headMesh = o.userData.driverPart || o.name || o.geometry.type; }
    }
  });
  const head = new V().setFromMatrixPosition(rig.head.matrixWorld).applyMatrix4(inv);
  const cabin = car.userData.cabin || null;
  const seat = new V().setFromMatrixPosition(rig.group.matrixWorld).applyMatrix4(inv);

  // The top skin of a shell at (x, z): every triangle whose XZ shadow
  // contains the point, interpolated, highest wins. A shell is a closed
  // extrusion, so the point is covered by a top triangle and a bottom
  // one; the top is the ceiling.
  const surfaceAt = (mesh, x, z) => {
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const n = idx ? idx.count : pos.count;
    const a=new V(), bb=new V(), c=new V();
    let best = null;
    for (let i=0;i<n;i+=3) {
      const i0 = idx?idx.getX(i):i, i1 = idx?idx.getX(i+1):i+1, i2 = idx?idx.getX(i+2):i+2;
      toCar(mesh, a.fromBufferAttribute(pos,i0));
      toCar(mesh, bb.fromBufferAttribute(pos,i1));
      toCar(mesh, c.fromBufferAttribute(pos,i2));
      const d = (bb.z-c.z)*(a.x-c.x) + (c.x-bb.x)*(a.z-c.z);
      if (Math.abs(d) < 1e-12) continue;
      const w0 = ((bb.z-c.z)*(x-c.x) + (c.x-bb.x)*(z-c.z)) / d;
      const w1 = ((c.z-a.z)*(x-c.x) + (a.x-c.x)*(z-c.z)) / d;
      const w2 = 1-w0-w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0*a.y + w1*bb.y + w2*c.y;
      if (best === null || y > best) best = y;
    }
    return best;
  };

  const shells = {};
  const column = {};
  car.traverse((o)=>{
    if(!o.isMesh || !o.userData.shell) return;
    shells[o.userData.shell] = surfaceAt(o, head.x, head.z);
    // What tests/ik.mjs measures, for comparison.
    const pos = o.geometry.attributes.position; const v = new V();
    let m = -1e9, hits = 0;
    for (let i=0;i<pos.count;i++){
      toCar(o, v.fromBufferAttribute(pos,i));
      if (Math.abs(v.z-seat.z) > 0.4 || Math.abs(v.x-seat.x) > 0.4) continue;
      hits++; m = Math.max(m, v.y);
    }
    column[o.userData.shell] = hits ? +m.toFixed(3) : null;
  });
  // The roofline along the car, at the driver's own x: where the cabin
  // actually is, rather than where the seat happens to have been put.
  const line = [];
  {
    let canopy=null; car.traverse((o)=>{ if(o.isMesh && o.userData.shell==="canopy") canopy=o; });
    if (canopy) for (let z=-1.6; z<=1.61; z+=0.1) {
      const y = surfaceAt(canopy, head.x, z);
      line.push([+z.toFixed(2), y===null?null:+y.toFixed(3)]);
    }
  }
  const round = (o)=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k, v===null?null:+v.toFixed(3)]));
  return {
    headTop:+hi.toFixed(3), headMesh, boxTop:+boxHi.toFixed(3),
    headX:+head.x.toFixed(3), headY:+head.y.toFixed(3), headZ:+head.z.toFixed(3),
    seatY:+seat.y.toFixed(3),
    shells: round(shells), column, line, cabin,
  };
}, carId);

console.log("head top vs the skin directly over it, in the car's own frame (metres)\n");
for (const [style, c] of bySilhouette) {
  const f = await measure(c.id);
  if (!f) { console.log(`${style}: no driver`); continue; }
  const ceil = f.shells.canopy;
  const clr = ceil === null ? null : ceil - f.headTop;
  console.log(`${(c.name+" ("+style+")").padEnd(28)} top of him ${f.headTop} (${f.headMesh}), box-corner ${f.boxTop} at x ${f.headX} z ${f.headZ}, seat ${f.seatY}`);
  console.log(`${"".padEnd(28)} skin over the head: canopy ${f.shells.canopy}  roof ${f.shells.roof}  body ${f.shells.body}`);
  console.log(`${"".padEnd(28)} test's column max:  canopy ${f.column.canopy}  roof ${f.column.roof}  body ${f.column.body}`);
  console.log(`${"".padEnd(28)} head joint y ${f.headY}, engine's fit ${JSON.stringify(f.cabin)}`);
  console.log(`${"".padEnd(28)} clearance under the glass: ${clr===null?"n/a":(clr*1000).toFixed(0)+" mm"}`);
  console.log(`${"".padEnd(28)} roofline at x ${f.headX}: ${f.line.filter(([,y])=>y!==null).map(([z,y])=>z+":"+y).join(" ")}\n`);
}
await b.close();
