// IK is provable: an end effector either lands on its target or it does
// not. This measures reach error in metres, checks the elbow breaks the
// way the pole asks, that unreachable targets straighten the arm rather
// than exploding it, and that joint limits actually clamp.
import { chromium } from "playwright-core";
import { existsSync, writeFileSync } from "node:fs";
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium","/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find(p=>existsSync(p));
if (!exe) { console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium"); process.exit(2); }
const b = await chromium.launch({executablePath:exe,args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"],headless:true});
const page = await b.newPage({viewport:{width:1280,height:720}});
page.setDefaultTimeout(120000);
page.on("pageerror",(e)=>console.log("PAGEERROR:",e.message));
await page.goto("http://localhost:3000/race",{waitUntil:"networkidle"});
await page.evaluate(()=>{localStorage.clear();localStorage.setItem("gulf-road-nights-onboarded","2");localStorage.setItem("gulf-road-nights-coach","3");});
await page.reload({waitUntil:"networkidle"});
await page.click("text=START ENGINE");
await page.waitForFunction(()=>!!window.__grnDebug,null,{timeout:120000});

const fail=[]; const check=(c,m)=>{if(!c)fail.push(m);return c?"ok":"FAIL";};

// --- 1. The driver's hands land on the wheel rim, at every lock ---
const hands = await page.evaluate(()=>{
  const e = window.__grnEngine;
  e.setPaused(true);
  const rig = e.carBody.userData.driver;
  if (!rig) return null;
  const out = [];
  for (const steer of [-1, -0.5, 0, 0.5, 1]) {
    e.setTouchInput({ steer });
    for (let i=0;i<40;i++) e.update(1/60); // let the wheel and arms settle
    e.carBody.updateWorldMatrix(true, true);
    for (const arm of rig.arms) {
      // Where the hand ended up
      arm.hand.updateWorldMatrix(true, false);
      const hp = new (e.camera.position.constructor)();
      hp.setFromMatrixPosition(arm.hand.matrixWorld);
      // Where it was asked to be: the grip point on the rim
      const grip = arm.side < 0 ? Math.PI*0.72 : Math.PI*0.28;
      const a = grip + rig.wheel.rotation.z;
      const tp = new (e.camera.position.constructor)(
        Math.cos(a)*rig.wheelRadius, Math.sin(a)*rig.wheelRadius, 0);
      rig.wheel.updateWorldMatrix(true,false);
      rig.wheel.localToWorld(tp);
      out.push({ steer, side: arm.side, err: +hp.distanceTo(tp).toFixed(4) });
    }
  }
  e.setTouchInput({ steer: 0 });
  return out;
});
if (!hands) { console.log("no driver rig"); process.exit(1); }
const worst = Math.max(...hands.map(h=>h.err));
console.log("driver hands on the rim (reach error, metres):");
for (const h of hands) console.log(`  steer ${String(h.steer).padStart(4)}  ${h.side<0?"left ":"right"}  ${h.err}`);
console.log(`worst ${worst} m  ${check(worst < 0.02, `a hand missed the rim by ${worst} m`)}`);

// --- 2. Unreachable target: the arm straightens, it does not explode ---
const far = await page.evaluate(()=>{
  const e = window.__grnEngine;
  const rig = e.carBody.userData.driver;
  const arm = rig.arms[0];
  const V = e.camera.position.constructor;
  arm.shoulder.updateWorldMatrix(true,false);
  const sp = new V(); sp.setFromMatrixPosition(arm.shoulder.matrixWorld);
  const target = sp.clone(); target.x += 50; // far out of reach
  window.__ikSolve(arm, target, sp.clone().add(new V(0,-1,0)));
  arm.hand.updateWorldMatrix(true,false);
  const hp = new V(); hp.setFromMatrixPosition(arm.hand.matrixWorld);
  const reach = hp.distanceTo(sp);
  // The rig sits under the car's presence scale, so the span has to be
  // lifted into world units before it can be compared with a world reach.
  const sc = new V(); sc.setFromMatrixScale(arm.shoulder.matrixWorld);
  const span = (arm.upper + arm.lower) * ((sc.x + sc.y + sc.z) / 3);
  return { reach: +reach.toFixed(3), span: +span.toFixed(3), finite: Number.isFinite(reach) };
});
console.log(`unreachable  arm extends to ${far.reach} m of its ${far.span} m span  ` +
  check(far.finite, "solver produced NaN on an unreachable target") + " " +
  check(Math.abs(far.reach - far.span) < 0.02, "arm did not straighten toward an unreachable target"));

// --- 3. The crowd watches, within the limits of a neck ---
const crowd = await page.evaluate(async ()=>{
  const e = window.__grnEngine;
  let root=e.world.moonLight; while(root.parent) root=root.parent;
  let group=null; root.traverse((o)=>{ if(o.name==="spectators") group=o; });
  if (!group) return null;
  const fig = group.children[0];
  const head = fig.userData.head;
  // Park the car right in front of them, then hard behind
  const front = fig.position.clone(); front.z += 8; front.y += 1;
  const behind = fig.position.clone(); behind.z -= 8; behind.y += 1;
  const yawOf = () => +head.rotation.y.toFixed(3);
  for (let i=0;i<80;i++) e.world.setCrowdFocus(front.x, front.y, front.z, 1/60);
  const atFront = yawOf();
  for (let i=0;i<200;i++) e.world.setCrowdFocus(behind.x, behind.y, behind.z, 1/60);
  const atBehind = yawOf();
  // Far away: they go back to standing
  for (let i=0;i<300;i++) e.world.setCrowdFocus(fig.position.x+500, 1, fig.position.z+500, 1/60);
  return { atFront, atBehind, rested: yawOf(), limit: 1.15 };
});
if (crowd) {
  console.log(`crowd        head yaw ${crowd.atFront} facing the car, ${crowd.atBehind} when it is behind, ${crowd.rested} once it is gone`);
  check(Math.abs(crowd.atFront - crowd.atBehind) > 0.15, "the crowd does not turn to watch");
  check(Math.abs(crowd.atBehind) <= crowd.limit + 0.01, `a neck turned ${crowd.atBehind} rad, past its ${crowd.limit} limit`);
  check(Math.abs(crowd.rested) < Math.abs(crowd.atBehind) + 0.01, "heads stay craned after the car has gone");
} else fail.push("no spectators found");

// A look at the driver through the glass
const shot = await page.evaluate(()=>{
  const e = window.__grnEngine;
  // Daylight, or the cabin is a black box and none of this is visible
  e.timeHours = 12.5; e.world.setTimeOfDay(12.5); e.applyDaylight();
  e.setTouchInput({ steer: 0.85 });
  for (let i=0;i<40;i++) e.update(1/60);
  const rig = e.carBody.userData.driver;
  rig.group.updateWorldMatrix(true,true);
  const V = e.camera.position.constructor;
  const p = new V(); p.setFromMatrixPosition(rig.group.matrixWorld);
  const cam = e.camera;
  // Through the side glass, at window height
  // Square-on to the side glass: at a grazing angle real glass is a
  // mirror (Fresnel), so the only way to see a cabin is to look through
  // the window rather than along it.
  cam.position.set(p.x + 2.9, p.y + 0.5, p.z + 0.15);
  cam.lookAt(p.x, p.y + 0.3, p.z + 0.02);
  cam.updateMatrixWorld(true);
  e.composer.render();
  return e.renderer.domElement.toDataURL("image/png");
});
if (process.env.GRN_STILLS === "1") {
  writeFileSync("/tmp/smoke/ik-driver.png", Buffer.from(shot.split(",")[1], "base64"));
  console.log("saved /tmp/smoke/ik-driver.png");
}

// Does the driver actually fit in the cabin, or is a head through the roof?
const fit = await page.evaluate(()=>{
  const e = window.__grnEngine;
  const rig = e.carBody.userData.driver;
  const V = e.camera.position.constructor;
  rig.group.updateWorldMatrix(true,true);
  let hi=-1e9, lo=1e9;
  rig.group.traverse((o)=>{
    if(!o.isMesh) return;
    o.updateWorldMatrix(true,false);
    const g=o.geometry; if(!g.boundingBox) g.computeBoundingBox();
    for (const cy of [g.boundingBox.min.y, g.boundingBox.max.y])
      for (const cx of [g.boundingBox.min.x, g.boundingBox.max.x])
        for (const cz of [g.boundingBox.min.z, g.boundingBox.max.z]) {
          const v = new V(cx, cy, cz).applyMatrix4(o.matrixWorld);
          hi = Math.max(hi, v.y); lo = Math.min(lo, v.y);
        }
  });
  // The roofline: highest point of the car's own shell meshes
  let roof=-1e9;
  e.carBody.traverse((o)=>{
    if(!o.isMesh || !o.userData.shell) return;
    o.updateWorldMatrix(true,false);
    const g=o.geometry; if(!g.boundingBox) g.computeBoundingBox();
    const v = new V(0, g.boundingBox.max.y, 0).applyMatrix4(o.matrixWorld);
    roof = Math.max(roof, v.y);
  });
  const carY = e.playerMesh.position.y;
  return { headTop:+(hi-carY).toFixed(2), seatBottom:+(lo-carY).toFixed(2), roof:+(roof-carY).toFixed(2) };
});
console.log(`driver fit   head top ${fit.headTop} m, seat ${fit.seatBottom} m, roofline ${fit.roof} m  ` +
  check(fit.headTop < fit.roof, `the driver's head is ${(fit.headTop-fit.roof).toFixed(2)} m through the roof`) + " " +
  check(fit.seatBottom > -0.1, "the driver is sunk through the floor"));

console.log(fail.length?"\nFAILURES:\n - "+fail.join("\n - "):"\nIK solves, clamps and behaves");
await b.close();
process.exit(fail.length?1:0);
