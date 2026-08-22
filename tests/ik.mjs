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
      // Where it was asked to be: a MATERIAL point on the rim, i.e. a
      // marker parented to the wheel at a fixed local angle. Rebuilding
      // the engine's own arithmetic here would only prove the test can
      // copy-paste — it did exactly that, and hid a bug where the
      // hands orbited at twice the wheel's rate for months.
      const grip = arm.side < 0 ? Math.PI*0.72 : Math.PI*0.28;
      let marker = rig.wheel.getObjectByName(`grip${arm.side}`);
      if (!marker) {
        marker = new (rig.wheel.constructor)();
        marker.name = `grip${arm.side}`;
        marker.position.set(Math.cos(grip)*rig.wheelRadius, Math.sin(grip)*rig.wheelRadius, 0);
        rig.wheel.add(marker);
      }
      rig.wheel.updateWorldMatrix(true, true);
      const tp = new (e.camera.position.constructor)();
      tp.setFromMatrixPosition(marker.matrixWorld);
      // The hand's angle in the wheel's own frame: constant if the
      // hands ride the rim, drifting if the rotation is counted twice.
      const lp = hp.clone();
      rig.wheel.worldToLocal(lp);
      out.push({ steer, side: arm.side, err: +hp.distanceTo(tp).toFixed(4),
                 localAng: +Math.atan2(lp.y, lp.x).toFixed(3) });
    }
  }
  e.setTouchInput({ steer: 0 });
  return out;
});
if (!hands) { console.log("no driver rig"); process.exit(1); }
const worst = Math.max(...hands.map(h=>h.err));
console.log("driver hands on the rim (reach error, metres):");
for (const h of hands) console.log(`  steer ${String(h.steer).padStart(4)}  ${h.side<0?"left ":"right"}  ${h.err}  grip angle in wheel frame ${h.localAng}`);
console.log(`worst ${worst} m  ${check(worst < 0.02, `a hand missed the rim by ${worst} m`)}`);
// Each hand keeps its station on the rim through the whole lock: the
// grip angle measured in the wheel's own frame must not move.
for (const side of [-1, 1]) {
  const angs = hands.filter(h=>h.side===side).map(h=>h.localAng);
  const drift = Math.max(...angs) - Math.min(...angs);
  console.log(`  ${side<0?"left ":"right"} hand grip drifts ${drift.toFixed(3)} rad across full lock  ` +
    check(drift < 0.05, `the ${side<0?"left":"right"} hand slides ${drift.toFixed(2)} rad around the rim as the wheel turns`));
}

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

// --- 3. Feet on the pedals, and the pedals answer the inputs ---
const feet = await page.evaluate(()=>{
  const e = window.__grnEngine;
  const rig = e.carBody.userData.driver;
  if (!rig.legs || !rig.pedals) return null;
  const V = e.camera.position.constructor;
  const measure = () => rig.legs.map((leg)=>{
    const pedal = leg.side > 0 ? rig.pedals.throttle : rig.pedals.brake;
    pedal.updateWorldMatrix(true,false);
    const tp = new V(); tp.setFromMatrixPosition(pedal.matrixWorld);
    leg.hand.updateWorldMatrix(true,false);
    const fp = new V(); fp.setFromMatrixPosition(leg.hand.matrixWorld);
    return { side: leg.side, err: +fp.distanceTo(tp).toFixed(4), z: +pedal.position.z.toFixed(3) };
  });
  e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
  for (let i=0;i<30;i++) e.update(1/60);
  const idle = measure();
  e.setTouchInput({ throttle: 1 });
  for (let i=0;i<30;i++) e.update(1/60);
  const wot = measure();
  e.setTouchInput({ throttle: 0, brake: 1 });
  for (let i=0;i<30;i++) e.update(1/60);
  const braking = measure();
  e.setTouchInput({ throttle: 0, brake: 0 });
  return { idle, wot, braking };
});
if (feet) {
  const worstFoot = Math.max(...[...feet.idle, ...feet.wot, ...feet.braking].map(f=>f.err));
  const t = (set)=>set.find(f=>f.side>0), b = (set)=>set.find(f=>f.side<0);
  console.log(`feet         worst reach error ${worstFoot} m; throttle pedal ${t(feet.idle).z}→${t(feet.wot).z} at WOT, brake ${b(feet.idle).z}→${b(feet.braking).z} braking`);
  check(worstFoot < 0.02, `a foot missed its pedal by ${worstFoot} m`);
  check(t(feet.wot).z - t(feet.idle).z > 0.03, "the throttle pedal does not sink under full throttle");
  check(b(feet.braking).z - b(feet.idle).z > 0.03, "the brake pedal does not sink under braking");
} else fail.push("driver rig has no legs/pedals");

// --- 4. The rival's driver is solved too, not a mannequin ---
const rivalIk = await page.evaluate(()=>{
  const e = window.__grnEngine;
  const r = e.rival;
  if (!r) return null;
  const rig = r.mesh.userData.driver;
  if (!rig) return { noRig: true };
  // Push the rival into a lane change so the wheel is off-centre mid-solve
  r.targetLat = r.lat + 4;
  for (let i=0;i<12;i++) e.update(1/60);
  const V = e.camera.position.constructor;
  const hands = [];
  for (const arm of rig.arms) {
    // Same material-point marker as the player's rig, not a re-run of
    // the engine's arithmetic
    const grip = arm.side < 0 ? Math.PI*0.72 : Math.PI*0.28;
    let marker = rig.wheel.getObjectByName(`grip${arm.side}`);
    if (!marker) {
      marker = new (rig.wheel.constructor)();
      marker.name = `grip${arm.side}`;
      marker.position.set(Math.cos(grip)*rig.wheelRadius, Math.sin(grip)*rig.wheelRadius, 0);
      rig.wheel.add(marker);
    }
    rig.wheel.updateWorldMatrix(true, true);
    const tp = new V(); tp.setFromMatrixPosition(marker.matrixWorld);
    arm.hand.updateWorldMatrix(true,false);
    const hp = new V(); hp.setFromMatrixPosition(arm.hand.matrixWorld);
    hands.push(+hp.distanceTo(tp).toFixed(4));
  }
  const feet = rig.legs.map((leg)=>{
    const pedal = leg.side > 0 ? rig.pedals.throttle : rig.pedals.brake;
    pedal.updateWorldMatrix(true,false);
    const tp = new V(); tp.setFromMatrixPosition(pedal.matrixWorld);
    leg.hand.updateWorldMatrix(true,false);
    const fp = new V(); fp.setFromMatrixPosition(leg.hand.matrixWorld);
    return +fp.distanceTo(tp).toFixed(4);
  });
  return { hands, feet, wheelZ: +rig.wheel.rotation.z.toFixed(3) };
});
if (rivalIk && !rivalIk.noRig) {
  const worstR = Math.max(...rivalIk.hands, ...rivalIk.feet);
  console.log(`rival driver hands ${rivalIk.hands.join("/")} m, feet ${rivalIk.feet.join("/")} m off target, wheel at ${rivalIk.wheelZ} rad in a lane change`);
  check(worstR < 0.02, `the rival driver missed wheel or pedal by ${worstR} m`);
  check(Math.abs(rivalIk.wheelZ) > 0.02, "the rival's wheel does not turn for a lane change");
} else fail.push(rivalIk ? "rival car carries no driver rig" : "no rival spawned");

// --- 5. Alongside, the rival looks over at you ---
const glance = await page.evaluate(()=>{
  const e = window.__grnEngine;
  const r = e.rival;
  if (!r) return null;
  const rig = r.mesh.userData.driver;
  // Far behind: eyes on the road
  e.player.s = e.track.wrap(r.s - 200);
  for (let i=0;i<40;i++) e.update(1/60);
  const eyesOnRoad = +rig.head.rotation.y.toFixed(3);
  // Pull alongside — pinned every frame, before the update, so the AI
  // cannot drive out of the window while the head is still easing over.
  for (let i=0;i<40;i++) {
    e.player.s = e.track.wrap(r.s - 6);
    e.player.lat = r.lat - 3.4;
    e.update(1/60);
  }
  const alongside = +rig.head.rotation.y.toFixed(3);
  return { eyesOnRoad, alongside };
});
if (glance) {
  console.log(`rival glance head yaw ${glance.eyesOnRoad} on the road, ${glance.alongside} with you alongside`);
  check(Math.abs(glance.alongside) > 0.3, "the rival never looks over when you pull alongside");
  check(Math.abs(glance.alongside - glance.eyesOnRoad) > 0.2, "the rival's glance is indistinguishable from cruising");
} else fail.push("no rival for the glance test");

// --- 6. The crowd watches, within the limits of a neck ---
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

// --- 7. The grid crew have necks too ---
const crew = await page.evaluate(()=>{
  const e = window.__grnEngine;
  let root=e.world.moonLight; while(root.parent) root=root.parent;
  let group=null; root.traverse((o)=>{ if(o.name==="racers") group=o; });
  if (!group) return null;
  const fig = group.children[0];
  if (!fig.userData.head) return { noHead: true };
  const head = fig.userData.head;
  const front = fig.position.clone(); front.x += 8; front.y += 1;
  const behind = fig.position.clone(); behind.x -= 8; behind.y += 1;
  for (let i=0;i<80;i++) e.world.setCrowdFocus(front.x, front.y, front.z, 1/60);
  const atFront = +head.rotation.y.toFixed(3);
  for (let i=0;i<200;i++) e.world.setCrowdFocus(behind.x, behind.y, behind.z, 1/60);
  const atBehind = +head.rotation.y.toFixed(3);
  for (let i=0;i<300;i++) e.world.setCrowdFocus(fig.position.x+500, 1, fig.position.z+500, 1/60);
  return { atFront, atBehind, hasArms: !!fig.userData.arms };
});
if (crew && !crew.noHead) {
  console.log(`grid crew    head yaw ${crew.atFront} car in front, ${crew.atBehind} car behind`);
  check(Math.abs(crew.atFront - crew.atBehind) > 0.15, "the grid crew do not turn to follow a run");
  check(crew.hasArms, "racers carry no arm chains");
} else fail.push(crew ? "racers have no head joint — they cannot watch" : "no racers group found");

// --- 8. A hand goes up for a passing car, and comes down after ---
const wave = await page.evaluate(()=>{
  const e = window.__grnEngine;
  let root=e.world.moonLight; while(root.parent) root=root.parent;
  let group=null; root.traverse((o)=>{ if(o.name==="spectators") group=o; });
  if (!group) return null;
  const fig = group.children[0];
  const arms = fig.userData.arms;
  if (!arms) return { noArms: true };
  const V = e.camera.position.constructor;
  const arm = arms.find((a)=>a.side===1); // watcher 0 waves with the right hand
  const handPos = () => { arm.hand.updateWorldMatrix(true,false); const p=new V(); p.setFromMatrixPosition(arm.hand.matrixWorld); return p; };
  const restY = handPos().y;
  const p = fig.position;
  const shoulderPos = () => { arm.shoulder.updateWorldMatrix(true,false); const q=new V(); q.setFromMatrixPosition(arm.shoulder.matrixWorld); return q; };
  const span = (arm.upper + arm.lower) * fig.scale.x;
  // The car pulls up close: the hand should rise — and the arm must
  // stay extended through the whole swing. Blending the hand's
  // POSITION from hanging to raised drags the target past the
  // shoulder, folding the arm into the armpit mid-wave; sampling only
  // the endpoints cannot see that, so sample the transit.
  let minReach = 1e9;
  for (let i=0;i<300;i++) {
    e.world.setCrowdFocus(p.x+6, p.y+1, p.z+4, 1/60);
    minReach = Math.min(minReach, handPos().distanceTo(shoulderPos()));
  }
  const upY = handPos().y;
  // ...and wave — the hand travels laterally while the car sits there
  let wag = 0; const first = handPos();
  for (let i=0;i<30;i++) {
    e.world.setCrowdFocus(p.x+6, p.y+1, p.z+4, 1/60);
    const q = handPos();
    wag = Math.max(wag, Math.hypot(q.x-first.x, q.z-first.z));
  }
  // The car leaves: the arm settles back where it was built
  for (let i=0;i<700;i++) e.world.setCrowdFocus(p.x+800, 1, p.z+800, 1/60);
  const downY = handPos().y;
  return { restY:+restY.toFixed(3), upY:+upY.toFixed(3), wag:+wag.toFixed(3), downY:+downY.toFixed(3),
           minReach:+minReach.toFixed(3), span:+span.toFixed(3) };
});
if (wave && !wave.noArms) {
  console.log(`wave         hand at ${wave.restY} rest, ${wave.upY} waving (wag ${wave.wag} m), ${wave.downY} after the car has gone`);
  console.log(`             arm stayed ${wave.minReach} m from the shoulder through the swing (span ${wave.span} m)`);
  check(wave.upY - wave.restY > 0.5, "no hand went up for a car parked alongside");
  check(wave.wag > 0.05, "the raised hand holds still — that is a salute, not a wave");
  check(Math.abs(wave.downY - wave.restY) < 0.12, "the arm never comes back down");
  check(wave.minReach > wave.span * 0.75,
    `the arm folded to ${wave.minReach} m of its ${wave.span} m span mid-wave — that is a chicken-wing, not a swing`);
} else fail.push(wave ? "spectators have no arm chains" : "no spectators found for the wave");

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

// Does the driver actually fit in the cabin, or is a head through the
// roof? Asked of EVERY silhouette, not just whichever car happened to be
// in the garage: the four bodies differ by 210 mm of roofline and the
// driver is seated off one anchor, so a fit measured on the saloon says
// nothing about the fastbacks. Checking one car passed for months while
// the lowest-roofed car in the fleet wore its driver's head outside.
const measureFit = (carId) => page.evaluate(async (carId)=>{
  const e = window.__grnEngine;
  if (carId) {
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      car: carId, cars: [carId], owned: [], kd: 99999,
      equipped: { paint: "paint-white", glow: "glow-none" },
    }));
    e.applyGarage();
    await new Promise(r=>setTimeout(r,150));
  }
  const car = e.carBody;
  const rig = car.userData.driver;
  const V = e.camera.position.constructor;
  car.updateWorldMatrix(true,true);
  // Everything in the CAR's own frame. Measured in world space, "the
  // column above the driver" is a box filter on world x and z, and the
  // car has a heading — so which of the roof's vertices fall inside it
  // depends on which way the car happens to be pointing. That reported
  // the Efreet's driver 0.17 m through a roof he in fact clears by 0.16.
  const inv = car.matrixWorld.clone().invert();
  const toCar = (o, v) => v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);
  let hi=-1e9, lo=1e9;
  rig.group.traverse((o)=>{
    if(!o.isMesh) return;
    const g=o.geometry; if(!g.boundingBox) g.computeBoundingBox();
    for (const cy of [g.boundingBox.min.y, g.boundingBox.max.y])
      for (const cx of [g.boundingBox.min.x, g.boundingBox.max.x])
        for (const cz of [g.boundingBox.min.z, g.boundingBox.max.z]) {
          const v = toCar(o, new V(cx, cy, cz));
          hi = Math.max(hi, v.y); lo = Math.min(lo, v.y);
        }
  });
  // The roof OVER THE DRIVER, not the highest point anywhere on the
  // shell: on a fastback the roof falls away behind the cabin, so its
  // peak is nowhere near the head. Taken over all three shells and off
  // their vertices — an extruded shell has no vertices across the middle
  // of its width, only at the bevel rings, so a narrow column can come
  // up empty on one shell and has to be allowed to.
  const seat = new V().setFromMatrixPosition(rig.group.matrixWorld).applyMatrix4(inv);
  let roof=-1e9;
  car.traverse((o)=>{
    if(!o.isMesh || !o.userData.shell) return;
    const pos = o.geometry.attributes.position;
    const v = new V();
    for (let i=0;i<pos.count;i++){
      toCar(o, v.fromBufferAttribute(pos,i));
      if (Math.abs(v.z-seat.z) > 0.4 || Math.abs(v.x-seat.x) > 0.4) continue;
      roof = Math.max(roof, v.y);
    }
  });
  return { headTop:+hi.toFixed(2), seatBottom:+lo.toFixed(2), roof:+roof.toFixed(2) };
}, carId);

{
  const cars = await page.evaluate(()=>fetch("/api/grn/v1/cars").then(r=>r.json()));
  // One car per silhouette is enough — the fit is a property of the body.
  const bySilhouette = new Map();
  for (const c of cars.cars) if (!bySilhouette.has(c.bodyStyle)) bySilhouette.set(c.bodyStyle, c);
  for (const [style, c] of bySilhouette) {
    const fit = await measureFit(c.id);
    console.log(`driver fit   ${(c.name+" ("+style+")").padEnd(24)} head ${fit.headTop} m, seat ${fit.seatBottom} m, roof over him ${fit.roof} m  ` +
      check(fit.headTop < fit.roof, `${c.name}: the driver's head is ${(fit.headTop-fit.roof).toFixed(2)} m through the roof`) + " " +
      check(fit.seatBottom > -0.1, `${c.name}: the driver is sunk through the floor`));
  }
}

// --- 9. Every car on the road has a driver, and the near ones solve ---
// Thirty driverless cars was the last place an empty seat could be
// seen. They all carry a rig now; only the nearest few are solved, and
// the rest hold the authored seated rest pose — which is why that pose
// was authored to read as seated without a solver.
const traffic = await page.evaluate(async ()=>{
  const e = window.__grnEngine;
  e.setPaused(true);
  const V = e.camera.position.constructor;
  const withRig = e.traffic.filter((t)=>!!t.mesh.userData.driver).length;
  // Park a few right next to the player and the rest far away
  e.player.s = 2203;
  e.traffic.forEach((t,i)=>{ t.s = e.track.wrap(e.player.s + (i<4 ? 20+i*12 : 900+i*30)); });
  for (let i=0;i<40;i++) e.update(1/60);
  // How far is each near driver's hand from its own wheel rim?
  const err = [];
  for (const t of e.traffic.slice(0,4)) {
    const rig = t.mesh.userData.driver; if (!rig) continue;
    for (const arm of rig.arms) {
      const grip = arm.side < 0 ? Math.PI*0.72 : Math.PI*0.28;
      let m = rig.wheel.getObjectByName(`g${arm.side}`);
      if (!m) { m = new (rig.wheel.constructor)(); m.name = `g${arm.side}`;
        m.position.set(Math.cos(grip)*rig.wheelRadius, Math.sin(grip)*rig.wheelRadius, 0);
        rig.wheel.add(m); }
      rig.wheel.updateWorldMatrix(true,true);
      const tp = new V(); tp.setFromMatrixPosition(m.matrixWorld);
      arm.hand.updateWorldMatrix(true,false);
      const hp = new V(); hp.setFromMatrixPosition(arm.hand.matrixWorld);
      err.push(+hp.distanceTo(tp).toFixed(4));
    }
  }
  // A far car must be left in its rest pose, not solved
  const far = e.traffic[e.traffic.length-1];
  const farRig = far.mesh.userData.driver;
  const farElbow = farRig ? +farRig.arms[0].elbow.quaternion.x.toFixed(4) : null;
  return { total: e.traffic.length, withRig, err,
           lean: farRig ? farRig.legs.length : -1, farElbow };
});
console.log(`traffic      ${traffic.withRig}/${traffic.total} cars carry a driver; lean rig has ${traffic.lean} legs`);
console.log(`             near drivers' hands off the rim: ${traffic.err.join(", ")} m`);
check(traffic.withRig === traffic.total, `${traffic.total - traffic.withRig} cars still have an empty seat`);
check(traffic.err.length > 0 && Math.max(...traffic.err) < 0.02,
  `a traffic driver missed its wheel by ${Math.max(...traffic.err)} m`);
check(traffic.lean === 0, "traffic drivers carry legs — the lean build is not being used");

// ---- the body answers to g, and the limbs keep hold ------------------
//
// The car rolls and pitches on its springs; until now the driver inside
// it sat rigid, which is the one thing a mannequin does that a person
// does not. They now lean away from the cornering force and fold forward
// under braking.
//
// The half that matters is the second one. Hands are solved onto grips
// ON the wheel and feet onto the pedal faces, and neither moves with the
// driver — so leaning the torso is only correct if the arms and legs
// re-solve to stay where they are gripping. That is the whole reason to
// have IK rather than a parented pose, and nothing had ever asked it for
// anything but steering.
{
  const r = await page.evaluate(async () => {
    const THREE = window.__grnThree;
    const e = window.__grnEngine;
    e.setPaused(true);
    const rig = e.carBody.userData.driver;
    const park = () => {
      const away = e.track.wrap(2400 + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.s = 2400;
      e.player.lat = 0;
    };
    // Hand and foot error against the things they are supposed to be
    // holding, in world space.
    const hold = () => {
      rig.wheel.updateWorldMatrix(true, true);
      let hands = 0;
      for (const arm of rig.arms) {
        const grip = arm.side < 0 ? window.__grnRig.driver.gripLeft : window.__grnRig.driver.gripRight;
        const want = new THREE.Vector3(
          Math.cos(grip) * rig.wheelRadius,
          Math.sin(grip) * rig.wheelRadius,
          0
        );
        rig.wheel.localToWorld(want);
        const got = arm.hand.getWorldPosition(new THREE.Vector3());
        hands = Math.max(hands, got.distanceTo(want));
      }
      let feet = 0;
      for (const leg of rig.legs) {
        const pedal = leg.side > 0 ? rig.pedals.throttle : rig.pedals.brake;
        pedal.updateWorldMatrix(true, false);
        const want = new THREE.Vector3().setFromMatrixPosition(pedal.matrixWorld);
        const got = leg.hand.getWorldPosition(new THREE.Vector3());
        feet = Math.max(feet, got.distanceTo(want));
      }
      return { hands: +hands.toFixed(4), feet: +feet.toFixed(4) };
    };
    // Where the car actually is matters. Holding lock on a STRAIGHT
    // settles into a constant crab angle, which is not a turn and
    // generates no cornering force at all — the first version of this
    // measured there and reported the lean as 0.013 rad in both
    // directions, which is not a bug in the driver, it is a question
    // asked in a place with no answer.
    //
    // So: the peak is captured at the frame of peak load, and the sign
    // of the lean is compared against the sign of the force AT THAT
    // FRAME. That is well defined wherever the car is, and it does not
    // care whether the load is a transient or a steady state.
    const run = (steer, brake, speed, at, frames = 150) => {
      e.roll = 0; e.rollVel = 0; e.pitch = 0; e.pitchVel = 0;
      e.heading = 0; e.driftYaw = 0; e.prevBeta = 0;
      rig.lean.rotation.set(0, 0, 0);
      e.player.speed = speed;
      e.prevSpeed = speed;
      let peak = { lat: 0, lean: 0, head: 0 };
      let fold = 0;
      let worst = { hands: 0, feet: 0 };
      for (let i = 0; i < frames; i++) {
        const away = e.track.wrap(at + e.track.length / 2);
        for (const t of e.traffic) t.s = away;
        if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
        e.player.s = at;
        e.player.lat = 0;
        if (brake === 0) e.player.speed = speed;
        e.setTouchInput({ throttle: 0, brake, steer });
        e.update(1 / 60);
        e.scene.updateMatrixWorld(true);
        // Sampled at peak LEAN, not peak force. The body is damped —
        // it takes about a fifth of a second to be pushed — so at the
        // instant of peak load it has barely started to move, and
        // reading there understates the lean by a factor of five. What
        // matters is the moment the driver is most displaced and which
        // way the force was pushing them then.
        if (Math.abs(rig.lean.rotation.z) > Math.abs(peak.lean)) {
          peak = {
            lat: e.latAccel,
            lean: rig.lean.rotation.z,
            head: rig.head.rotation.z,
          };
        }
        if (Math.abs(rig.lean.rotation.x) > Math.abs(fold)) fold = rig.lean.rotation.x;
        const h = hold();
        worst = { hands: Math.max(worst.hands, h.hands), feet: Math.max(worst.feet, h.feet) };
      }
      return {
        lean: +peak.lean.toFixed(4),
        lat: +peak.lat.toFixed(2),
        headRoll: +peak.head.toFixed(4),
        fold: +fold.toFixed(4),
        hands: +worst.hands.toFixed(4),
        feet: +worst.feet.toFixed(4),
      };
    };
    return {
      // 3060 is the Ras Al-Ard sweep, the tightest corner on the lap.
      straight: run(0, 0, 36, 2400),
      left: run(-0.9, 0, 40, 2400),
      right: run(0.9, 0, 40, 2400),
      sweeper: run(0, 0, 36, 3060),
      braking: run(0, 1, 44, 2400, 40),
    };
  });

  console.log(
    `\ndriver lean  peak: left ${r.left.lean} rad at ${r.left.lat} m/s2, ` +
      `right ${r.right.lean} at ${r.right.lat}, sweeper ${r.sweeper.lean} at ${r.sweeper.lat}; ` +
      `braking folds ${r.braking.fold}`
  );
  check(
    Math.abs(r.sweeper.lean) > 0.01,
    `the tightest corner on the lap leans the driver ${r.sweeper.lean} rad — they are still a mannequin`
  );
  // Every loaded case has to lean AWAY from the force, and there have to
  // be cases of both signs — otherwise "it leans the right way" is a
  // claim about one direction that the other has never been asked about.
  const loaded = [r.left, r.right, r.sweeper].filter((x) => Math.abs(x.lat) > 5);
  const wrongWay = loaded.filter((x) => Math.sign(x.lean) !== -Math.sign(x.lat));
  check(
    loaded.length >= 2 &&
      new Set(loaded.map((x) => Math.sign(x.lat))).size === 2,
    `the cases only ever loaded the car one way (${loaded.map((x) => x.lat).join(", ")} m/s2) — ` +
      `the other direction has never been tested`
  );
  check(
    wrongWay.length === 0,
    `the driver leans INTO the corner in ${wrongWay.length} case(s): ` +
      wrongWay.map((x) => `${x.lean} rad at ${x.lat} m/s2`).join(", ")
  );
  check(r.braking.fold > 0.005, `braking folds the driver ${r.braking.fold} rad — the belts do it all`);
  // The neck fights the lean, so the head stays closer to level.
  check(
    Math.abs(r.left.headRoll) > 1e-4 &&
      Math.sign(r.left.headRoll) === -Math.sign(r.left.lean),
    `the head rolls with the body (${r.left.headRoll} against ${r.left.lean}) instead of resisting it`
  );

  const all = [r.straight, r.left, r.right, r.sweeper, r.braking];
  const worstHands = Math.max(...all.map((x) => x.hands));
  const worstFeet = Math.max(...all.map((x) => x.feet));
  console.log(
    `             through all of it hands stay ${worstHands} m off the rim, feet ${worstFeet} m off the pedals`
  );
  check(
    worstHands < 0.02,
    `leaning pulls a hand ${worstHands} m off the wheel — the arms are not re-solving`
  );
  check(
    worstFeet < 0.02,
    `leaning pulls a foot ${worstFeet} m off the pedal — the legs are not re-solving`
  );
}

// --- 6. EVERY driver, not just the two anyone was watching ---
//
// The player's rig and the rival's were tested; traffic and the remote
// cruisers were not, and that is exactly where the gap was. Both were
// solved with a hard-coded zero for brake and for longitudinal g, so a
// civilian standing on the pedal behind a slower car, and a remote
// player braking for the roundabout, both sat perfectly upright with a
// foot in the air. The lateral axis had been fixed for them; nobody had
// checked the other one.
//
// What is asserted is the BODY, not the plumbing: fold the car up under
// braking and the driver has to fold with it. A test that only read the
// argument being passed would pass on a number that never reached a
// joint.
{
  const traffic = await page.evaluate(async () => {
    const e = window.__grnEngine;
    // Put a civilian right in front of another one, in the same lane,
    // and let it close: that is the only thing that makes traffic brake.
    const a = e.traffic[0], b = e.traffic[1];
    if (!a || !b) return { none: true };
    const rig = a.mesh.userData.driver;
    if (!rig) return { noRig: true };
    // Solved only within range of the player, so stand next to them.
    e.player.s = a.s;
    e.player.lat = a.lat;

    a.lat = b.lat;
    a.s = e.track.wrap(b.s - 10);
    a.speed = 30;
    b.speed = 8;
    let peakFold = 0, peakBrake = 0, peakAccel = 0;
    for (let i = 0; i < 90; i++) {
      e.player.s = a.s;
      e.update(1 / 60);
      peakFold = Math.max(peakFold, Math.abs(rig.lean.rotation.x));
      peakBrake = Math.max(peakBrake, a.brakeVis ?? 0);
      peakAccel = Math.min(peakAccel, a.accel ?? 0);
    }
    return {
      fold: +peakFold.toFixed(4),
      brake: +peakBrake.toFixed(3),
      accel: +peakAccel.toFixed(2),
    };
  });

  if (traffic.none || traffic.noRig) {
    fail.push(traffic.noRig ? "traffic carries no driver rig" : "no traffic spawned");
  } else {
    console.log(
      `\ntraffic      closing on a slower car: ${traffic.accel} m/s2, ` +
      `brake ${traffic.brake}, body folds ${traffic.fold} rad`
    );
    check(traffic.accel < -1, `traffic never actually braked (${traffic.accel} m/s2)`);
    check(traffic.brake > 0.05, "the traffic driver's foot never went near the brake");
    check(traffic.fold > 0.01, "the traffic driver does not fold under braking");
  }

  const remote = await page.evaluate(async () => {
    const e = window.__grnEngine;
    e.upsertRemote(9901, "Tester", "#cc2222");
    // Two snapshots ARE the acceleration — that is the whole mechanism,
    // so the test feeds two and nothing else.
    const r0 = e.remotes.get(9901);
    e.updateRemoteState(9901, 400, 0, 40);
    // The interval is REPORTED rather than assumed. This asked for
    // 120 ms and got 4,658 — the page is running a game loop and a
    // timer is a lower bound, not a duration — which is worth having on
    // screen, because the number below is a quotient and the divisor
    // is not what the test asked for.
    const t0 = performance.now();
    await new Promise((res) => setTimeout(res, 120));
    e.updateRemoteState(9901, 405, 0, 12);
    const wireGap = +((performance.now() - t0) / 1000).toFixed(3);
    const r = [...e.remotes.values()].find((x) => x.name === "Tester");
    if (!r) return { none: true };
    const rig = r.mesh.userData.driver;
    if (!rig) return { noRig: true };
    // Read the acceleration HERE, at the moment the second snapshot
    // produced it. The first version of this read it after sixty
    // updates and got zero: the page's own loop is still running during
    // the await, the net layer pushes its own snapshots for any car it
    // knows about, and by the time the frames were done a later pair
    // had overwritten this one with a steady cruise. The derivative is
    // an event, not a state, and it has to be sampled where it happens.
    const wireAccel = r.accel;

    e.player.s = r.snapS;
    let peakFold = 0, peakBrake = 0;
    for (let i = 0; i < 60; i++) {
      e.update(1 / 60);
      peakFold = Math.max(peakFold, Math.abs(rig.lean.rotation.x));
      peakBrake = Math.max(peakBrake, r.brakeVis ?? 0);
    }
    const out = {
      gap: wireGap,
      accel: +wireAccel.toFixed(1),
      brake: +peakBrake.toFixed(3),
      fold: +peakFold.toFixed(4),
    };
    e.removeRemote(9901);
    return out;
  });

  if (remote.none || remote.noRig) {
    fail.push(remote.noRig ? "a remote car carries no driver rig" : "the remote car never appeared");
  } else {
    console.log(
      `remote       40 -> 12 m/s over ${remote.gap}s reads as ${remote.accel} m/s2, ` +
      `brake ${remote.brake}, body folds ${remote.fold} rad`
    );
    check(remote.accel < -1, `the wire's own deceleration was thrown away (${remote.accel})`);
    check(remote.brake > 0.05, "the remote driver's foot never went near the brake");
    check(remote.fold > 0.01, "the remote driver does not fold under braking");
  }
}

console.log(fail.length?"\nFAILURES:\n - "+fail.join("\n - "):"\nIK solves, clamps and behaves");
await b.close();
process.exit(fail.length?1:0);
