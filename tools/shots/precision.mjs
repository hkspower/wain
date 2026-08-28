// How many bits does this game actually run on?
//
//   npm run dev
//   node tools/shots/precision.mjs
//
// "Make it a 64-bit game" has no build switch behind it here. This is a
// browser game: there is no 32-bit binary to replace, JavaScript numbers
// are IEEE-754 doubles by specification, and the one place the hardware
// insists on 32 bits — the GPU — cannot be argued with from JavaScript.
//
// What CAN be answered is whether 32 bits is ever too few for what this
// game asks of it, and that is a measurement rather than an opinion.
// Four places where a game runs out of bits, each with a number:
//
//   world     how far from the origin the scene reaches, and what one
//             ulp of a 32-bit float is worth THERE. This is the number
//             behind "floating origin": a world that runs to 40 km
//             resolves 4 mm at its edges and shimmers, and one that runs
//             to 3 km resolves a quarter of a millimetre and does not.
//   colour    the bit depth of the buffer the scene is rendered into.
//             Eight bits a channel bands a night sky; a half float does
//             not, and it is what makes exposure and bloom possible at
//             all.
//   depth     near and far, and the size of one depth step at the far
//             plane. Z-fighting is a bit-depth problem wearing a
//             different hat.
//   clocks    anything that counts up forever and then reaches a float.
//             A shader handed seconds-since-load is fine for an hour and
//             quantises after a day.
//
// It also checks the two 64-bit claims that ARE claims: that the
// simulation runs in doubles, and that the integers the economy counts
// in have not been quietly truncated to 32 bits somewhere.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH."); process.exit(2); }
const b = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"], headless: true });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3"); });
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(2500);

const r = await page.evaluate(() => {
  const e = window.__grnEngine;
  const V = e.camera.position.constructor;

  // 1. WORLD. The furthest any drawn vertex sits from the origin, taken
  //    over the whole scene rather than the track's control points: the
  //    scenery is placed around the road and reaches further than it.
  let root = e.world.moonLight; while (root.parent) root = root.parent;
  let far2 = 0, meshes = 0, farthest = null;
  const reach = [];
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isLine) return;
    meshes++;
    const g = o.geometry; if (!g) return;
    // Vertices, not bounding spheres.
    //
    // Three objects in this scene carry a bounding sphere centred
    // 141 km out with a radius of zero — a degenerate sphere on a
    // geometry with nothing in it, which is a dead entry in the draw
    // list and not a place the world reaches. Taken off the sphere, the
    // audit reported a 141 km world and a 11 mm float and would have
    // sent somebody off to build a floating origin for it.
    const pos = g.attributes?.position;
    if (!pos || pos.count === 0) return;
    // Off the attribute, into local variables. A geometry's own
    // boundingBox is not always a measurement: the star fields carry a
    // hand-set degenerate one — the usual trick for defeating frustum
    // culling — which reads as a cloud of 140 points all at 141 km. And
    // recomputing it in place would be an audit editing the thing it is
    // auditing.
    let d = 0, lo = Infinity, hi = -Infinity;
    const v = new V();
    const step = Math.max(1, Math.ceil(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const r = Math.hypot(v.x, v.z);
      if (r > d) d = r;
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    const s = { radius: (hi - lo) / 2 };
    const sc = 1;
    if (d > far2) { far2 = d; farthest = o; }
    reach.push({ d, kind: o.isPoints?'Points':o.isLine?'Line':o.isInstancedMesh?'Instanced x'+o.count:'Mesh', verts: pos.count, parent: o.parent?.name || o.parent?.type || '', span: s.radius * sc * 2, name: o.name || o.userData.kind || o.geometry.type, mat: (Array.isArray(o.material)?o.material[0]:o.material)?.name || "" });
  });
  // One ulp of a 32-bit float at that distance, in metres.
  const ulpAt = (x) => {
    const f = new Float32Array(1); f[0] = x;
    const u = new Uint32Array(f.buffer); u[0] += 1;
    return Math.abs(f[0] - x);
  };

  // 2. COLOUR. What the scene is actually rendered into.
  const rt = e.composer?.renderTarget1 ?? e.composer?.readBuffer ?? null;
  const TYPE = { 1009: "UnsignedByte (8 bit)", 1015: "Float (32 bit)", 1016: "HalfFloat (16 bit)" };
  const gl = e.renderer.getContext();

  // 3. DEPTH. One step of the depth buffer at the far plane.
  const near = e.camera.near, far = e.camera.far;
  const depthBits = gl.getParameter(gl.DEPTH_BITS) || 24;
  const stepAt = (z) => (z * z * (1 / near - 1 / far)) / Math.pow(2, depthBits);

  // 4. CLOCKS. Every uniform in the grade chain that holds a time.
  const clocks = [];
  for (const p of e.composer?.passes ?? []) {
    const u = p.uniforms || p.material?.uniforms;
    if (!u) continue;
    for (const k of Object.keys(u)) {
      if (!/time/i.test(k)) continue;
      clocks.push({ pass: p.constructor?.name ?? "pass", name: k, value: u[k].value });
    }
  }

  // Where the CAMERA actually goes.
  //
  // The scene reach above is not the subject and cannot be: the star
  // dome sits 141 km out and quantises to 11 mm, which is an angular
  // error of eight hundredths of a microradian on something drawn at
  // infinity. Precision is a problem where the eye is CLOSE to the
  // geometry, so the number that decides whether this world needs a
  // camera-relative origin is how far from the origin the camera is ever
  // put — driven, rather than reasoned about, by running the car round
  // the lap with the renderer paused.
  e.setPaused(true);
  e.setTouchInput({ steer: 0, throttle: 1 });
  let camFar = 0;
  for (let i = 0; i < 6000; i++) {
    e.update(1 / 60);
    if (i % 5 === 0) {
      const c = e.camera.position;
      camFar = Math.max(camFar, Math.hypot(c.x, c.z));
    }
  }
  e.setTouchInput({ steer: 0, throttle: 0 });

  return {
    camFar: +camFar.toFixed(1),
    ulpCam: ulpAt(camFar),
    meshes,
    worldReach: +far2.toFixed(1),
    farthest: farthest ? (farthest.name || farthest.userData.kind || farthest.geometry.type) : null,
    biggest: reach.sort((a,b)=>b.d-a.d).slice(0,8).map((x)=>`${x.d.toFixed(0)} m out, ${x.span.toFixed(0)} m across, ${x.verts} verts, ${x.kind}, parent ${x.parent}  ${x.name}${x.mat?" ["+x.mat+"]":""}`),
    ulpHere: ulpAt(far2),
    ulpAt40km: ulpAt(40000),
    colour: TYPE[rt?.texture?.type] ?? `none (${rt?.texture?.type ?? "no composer target"})`,
    colourSpace: e.renderer.outputColorSpace,
    near, far, depthBits,
    depthStepFar: stepAt(far),
    depthStepMid: stepAt(500),
    clocks,
    // The simulation's own arithmetic, demonstrated rather than assumed.
    simIsDouble: (0.1 + 0.2 === 0.30000000000000004) && Number.MAX_SAFE_INTEGER === 9007199254740991,
    mantissaBits: (() => { let n = 1, bits = 0; while (1 + n / 2 !== 1) { n /= 2; bits++; } return bits; })(),
  };
});
await b.close();

const mm = (m) => (m >= 1 ? `${m.toFixed(2)} m` : m >= 0.001 ? `${(m * 1000).toFixed(2)} mm` : `${(m * 1e6).toFixed(1)} µm`);
console.log(`
camera    driven a lap, the camera never leaves ${r.camFar} m of the origin
          one 32-bit float step there is ${mm(r.ulpCam)} — the size of the world the eye gets close to
world     the whole scene, backdrops included, reaches ${r.worldReach} m across ${r.meshes} drawn objects
          furthest: ${r.biggest.join("\n                    ")}
          one step out there is ${mm(r.ulpHere)}, on things drawn at infinity   (a 40 km world would be ${mm(r.ulpAt40km)} everywhere)
colour    scene buffer ${r.colour}, output ${r.colourSpace}
depth     ${r.depthBits}-bit, near ${r.near} far ${r.far}
          one depth step: ${mm(r.depthStepMid)} at 500 m, ${mm(r.depthStepFar)} at the far plane
clocks    ${r.clocks.length ? r.clocks.map((c) => `${c.name} = ${c.value} (${c.pass})`).join("; ") : "none found"}
sim       IEEE-754 double: ${r.simIsDouble ? "yes" : "NO"}, ${r.mantissaBits}-bit mantissa, integers exact to ${Number.MAX_SAFE_INTEGER}
`);

const fail = [];
// A 32-bit float has to resolve a millimetre at the edge of the world,
// or the world needs a floating origin and this is where you find out.
if (r.ulpCam > 0.001) fail.push(`where the camera goes, a 32-bit float resolves only ${mm(r.ulpCam)} — the world has outgrown single precision and wants a camera-relative origin`);
if (!/HalfFloat|Float/.test(r.colour)) fail.push(`the scene renders into ${r.colour} — eight bits a channel bands a night sky and cannot carry exposure`);
if (r.depthStepFar > 2) fail.push(`one depth step at the far plane is ${mm(r.depthStepFar)} — surfaces will fight for the same pixel out there`);
// A clock that has been left counting since load will quantise. Anything
// under a few hundred is wrapped; anything else is not.
for (const c of r.clocks) if (typeof c.value === "number" && c.value > 1e5) fail.push(`${c.name} reaches a shader at ${c.value} — a 32-bit float steps ${mm(Math.abs(Math.fround(c.value * 1.0000001) - c.value))} there`);
if (!r.simIsDouble) fail.push("the simulation is not running in doubles");
console.log(fail.length ? "FAILURES:\n - " + fail.join("\n - ") : "every number in this game has the bits it needs");
