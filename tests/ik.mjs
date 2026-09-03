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

// --- 1. Hands on the rim: carried to the comfortable arc, sliding past it ---
//
// The law being pinned, in two halves. Up to gripCarryMax the grips ride
// the wheel's own frame — the fix for the old double-counting bug where
// hands orbited at twice the spoke rate. PAST it the hand lets the rim
// slide through its grip and holds station in the car's frame, because a
// hand carried the full 2.4 rad ends up at the bottom of the wheel with
// the arms crossed. The expected value here is the LAW (rest grip plus
// clamp(rot) - rot), not the engine's own position arithmetic: restating
// a design rule is what a test is for, and copying sin/cos is exactly
// what hid the double-count for months.
const hands = await page.evaluate(()=>{
  const e = window.__grnEngine;
  e.setPaused(true);
  const rig = e.carBody.userData.driver;
  if (!rig) return null;
  const out = { samples: [], carryMax: window.__grnRig?.driver?.gripCarryMax ?? null,
                radius: rig.wheelRadius };
  for (const steer of [-1, -0.4, 0, 0.4, 1]) {
    e.setTouchInput({ steer });
    for (let i=0;i<40;i++) e.update(1/60); // let the wheel and arms settle
    e.carBody.updateWorldMatrix(true, true);
    rig.wheel.updateWorldMatrix(true, true);
    for (const arm of rig.arms) {
      arm.hand.updateWorldMatrix(true, false);
      const hp = new (e.camera.position.constructor)();
      hp.setFromMatrixPosition(arm.hand.matrixWorld);
      const lp = hp.clone();
      rig.wheel.worldToLocal(lp);
      out.samples.push({
        steer, side: arm.side,
        rot: +rig.wheel.rotation.z.toFixed(3),
        // Still ON the rim: distance from the wheel's axis, measured in
        // the wheel's own plane. No target arithmetic to copy wrong.
        rimR: +Math.hypot(lp.x, lp.y).toFixed(4),
        localAng: +Math.atan2(lp.y, lp.x).toFixed(3),
      });
    }
  }
  e.setTouchInput({ steer: 0 });
  return out;
});
if (!hands) { console.log("no driver rig"); process.exit(1); }
{
  const carryMax = hands.carryMax ?? 1.05;
  const wrap = (a)=>{ while(a>Math.PI)a-=2*Math.PI; while(a<-Math.PI)a+=2*Math.PI; return a; };
  const rest = {};
  for (const h of hands.samples) if (h.steer === 0) rest[h.side] = h.localAng;
  console.log(`driver hands (carry arc ${carryMax} rad, rim radius ${hands.radius}):`);
  let worstR = 0, worstLaw = 0;
  for (const h of hands.samples) {
    const slide = Math.max(-carryMax, Math.min(carryMax, h.rot)) - h.rot;
    const want = wrap(rest[h.side] + slide);
    const lawErr = Math.abs(wrap(h.localAng - want));
    worstR = Math.max(worstR, Math.abs(h.rimR - hands.radius));
    worstLaw = Math.max(worstLaw, lawErr);
    console.log(`  steer ${String(h.steer).padStart(4)}  ${h.side<0?"left ":"right"}  wheel ${String(h.rot).padStart(6)}  r ${h.rimR}  ang ${h.localAng}  want ${want.toFixed(3)}  err ${lawErr.toFixed(3)}`);
  }
  console.log(`worst radius error ${worstR.toFixed(4)} m  ` +
    check(worstR < 0.02, `a hand left the rim by ${worstR.toFixed(3)} m`));
  console.log(`worst law error ${worstLaw.toFixed(3)} rad  ` +
    check(worstLaw < 0.08, `a hand is ${worstLaw.toFixed(2)} rad off the carry-then-slide law`));
  // Both regimes have to be exercised, or the law is half-tested: at 0.4
  // the wheel is inside the carry arc, at full lock it is well past it.
  const ride = hands.samples.find(h=>h.steer===0.4 && h.side<0);
  const lock = hands.samples.find(h=>h.steer===1 && h.side<0);
  check(Math.abs(ride.rot) <= carryMax + 0.05,
    `steer 0.4 puts the wheel at ${ride.rot} rad, past the carry arc — the ride regime is untested`);
  check(Math.abs(lock.rot) > carryMax + 0.1,
    `full lock only reaches ${lock.rot} rad — the slide regime is untested`);
}

// --- 1b. Which way the joint breaks ---
//
// The header of this file has claimed since the day it was written that
// it "checks the elbow breaks the way the pole asks". It did not. There
// was one line printing a quaternion component and nothing asserting
// anything about it, and in that gap both of the driver's elbows sat
// 236 mm ABOVE his shoulders, crossed over the centreline above his
// head, on every car in the game. The hands were on the rim to the
// millimetre the whole time — that is what an inverted pole gives you:
// the mirror-image solution to the same triangle, exact and wrong.
//
// Two checks, because one alone is not enough.
//
// Straight-ahead, the law can be said in the words the rig says it in —
// "elbows break outward and down", "knees break up and forward" — and
// measured in the car's own frame with no pole arithmetic anywhere near
// it. That is the version that would have caught this.
//
// Through the steering range it cannot: at full lock a hand slides
// round to the far side of the rim and the arm reaches across, so an
// elbow can be inboard of its own shoulder and still be perfectly
// posed. There the law is the definition of a pole vector — the elbow
// lands on the POLE's side of the line from shoulder to hand — which
// is the solver's input, not the solver's arithmetic.
const breaks = await page.evaluate(()=>{
  const e = window.__grnEngine;
  const car = e.carBody;
  const rig = car.userData.driver;
  if (!rig) return null;
  const R = window.__grnRig.driver;
  const V = e.camera.position.constructor;
  const read = () => {
    car.updateWorldMatrix(true,true);
    const inv = car.matrixWorld.clone().invert();
    const at = (o) => new V().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    const seat = at(rig.group);
    const arms = rig.arms.map((a)=>{
      const S = at(a.shoulder), E = at(a.elbow), H = at(a.hand);
      const P = new V(a.side * R.armPoleX, R.armPoleY, R.armPoleZ);
      rig.group.localToWorld(P); P.applyMatrix4(inv);
      // Side of the shoulder-to-hand line, with that line projected out
      // of both. Positive = the elbow is where the pole asked for it.
      const u = H.clone().sub(S); const len = u.length() || 1; u.multiplyScalar(1/len);
      const perp = (v) => v.clone().sub(S).addScaledVector(u, -v.clone().sub(S).dot(u));
      const side = perp(E).dot(perp(P));
      return {
        side: a.side,
        out: +((E.x - S.x) * Math.sign(S.x - seat.x)).toFixed(3),
        drop: +(S.y - E.y).toFixed(3),
        poleSide: +side.toFixed(4),
      };
    });
    const legs = rig.legs.map((l)=>{
      const H = at(l.shoulder), K = at(l.elbow);
      return { side: l.side, rise: +(K.y - H.y).toFixed(3), fwd: +(K.z - H.z).toFixed(3) };
    });
    return { arms, legs };
  };
  const settle = (steer) => {
    e.setTouchInput({ steer });
    for (let i=0;i<40;i++) e.update(1/60);
  };
  settle(0);
  const straight = read();
  const swept = [];
  for (const steer of [-1, -0.4, 0.4, 1]) { settle(steer); swept.push({ steer, ...read() }); }
  settle(0);
  return { straight, swept };
});
if (!breaks) { console.log("no rig to check joint breaks on"); process.exit(1); }
{
  const a = breaks.straight.arms, l = breaks.straight.legs;
  console.log(`elbows       straight ahead: out ${a.map(x=>x.out).join("/")} m, below the shoulder ${a.map(x=>x.drop).join("/")} m  ` +
    check(Math.min(...a.map(x=>x.out)) > 0.02,
      `an elbow broke ${(-Math.min(...a.map(x=>x.out))).toFixed(3)} m INWARD, across the driver's chest`) + " " +
    check(Math.min(...a.map(x=>x.drop)) > 0.02,
      `an elbow sits ${(-Math.min(...a.map(x=>x.drop))).toFixed(3)} m above its own shoulder`));
  console.log(`knees        above the hip ${l.map(x=>x.rise).join("/")} m, ahead of it ${l.map(x=>x.fwd).join("/")} m  ` +
    check(Math.min(...l.map(x=>x.fwd)) > 0.02, "a knee broke backward, into the seat") + " " +
    check(Math.min(...l.map(x=>x.rise)) > 0.02, "a knee broke downward, through the floor"));
  const all = [breaks.straight, ...breaks.swept];
  const worstPole = Math.min(...all.flatMap(r=>r.arms.map(x=>x.poleSide)));
  console.log(`             on the pole's side of the shoulder-to-hand line at every angle: ${worstPole > 0 ? "yes" : "NO"}  ` +
    check(worstPole > 0, `an elbow broke away from its pole (${worstPole})`));
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
// in the garage: the six bodies differ by 350 mm of roofline and the
// driver is seated off the cabin he is in.
//
// Both halves of this measurement used to be proxies, and both lied.
//
// The DRIVER was measured by the corners of each mesh's bounding box. A
// box corner is the top of a mesh only when the mesh is unrotated, and
// every bone in a posed rig is rotated: the highest corner in this
// driver belonged to an upper arm, 87 mm above a helmet it is nowhere
// near. So: real vertices.
//
// The ROOF was the highest shell VERTEX inside a 0.8 m box around the
// seat. An extruded shell carries vertices only at its profile points
// and its bevel rings, so that returned whichever ring fell in the box —
// on a fastback the roof's outer edge, metres of z from the head. It
// reported the pony's driver clearing his roof by 30 mm when his head
// was 187 mm out through the glass. So: the skin AT the head, found by
// walking the triangles whose shadow contains it.
//
// The ceiling is the CANOPY, not the highest shell: the head is inside
// the glasshouse and the painted roof panel sits on top of it.
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
  // depends on which way the car happens to be pointing.
  const inv = car.matrixWorld.clone().invert();
  const toCar = (o, v) => v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);
  let hi=-1e9, lo=1e9;
  rig.group.traverse((o)=>{
    if(!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const v = new V();
    for (let i=0;i<pos.count;i++){
      toCar(o, v.fromBufferAttribute(pos,i));
      if (v.y > hi) hi = v.y;
      if (v.y < lo) lo = v.y;
    }
  });
  const head = new V().setFromMatrixPosition(rig.head.matrixWorld).applyMatrix4(inv);
  // The top skin of a shell at a point: every triangle whose XZ shadow
  // contains it, interpolated for height, highest wins.
  const surfaceAt = (mesh, x, z) => {
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const n = idx ? idx.count : pos.count;
    const a=new V(), b=new V(), c=new V();
    let best = null;
    for (let i=0;i<n;i+=3) {
      const i0 = idx?idx.getX(i):i, i1 = idx?idx.getX(i+1):i+1, i2 = idx?idx.getX(i+2):i+2;
      toCar(mesh, a.fromBufferAttribute(pos,i0));
      toCar(mesh, b.fromBufferAttribute(pos,i1));
      toCar(mesh, c.fromBufferAttribute(pos,i2));
      const d = (b.z-c.z)*(a.x-c.x) + (c.x-b.x)*(a.z-c.z);
      if (Math.abs(d) < 1e-12) continue;
      const w0 = ((b.z-c.z)*(x-c.x) + (c.x-b.x)*(z-c.z)) / d;
      const w1 = ((c.z-a.z)*(x-c.x) + (a.x-c.x)*(z-c.z)) / d;
      const w2 = 1-w0-w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0*a.y + w1*b.y + w2*c.y;
      if (best === null || y > best) best = y;
    }
    return best;
  };
  let roof = null;
  car.traverse((o)=>{
    if(!o.isMesh || o.userData.shell !== "canopy") return;
    roof = surfaceAt(o, head.x, head.z);
  });
  return { headTop:+hi.toFixed(3), seatBottom:+lo.toFixed(3), roof: roof===null?null:+roof.toFixed(3) };
}, carId);

{
  const cars = await page.evaluate(()=>fetch("/api/grn/v1/cars").then(r=>r.json()));
  // One car per silhouette is enough — the fit is a property of the body.
  const bySilhouette = new Map();
  for (const c of cars.cars) if (!bySilhouette.has(c.bodyStyle)) bySilhouette.set(c.bodyStyle, c);
  for (const [style, c] of bySilhouette) {
    const fit = await measureFit(c.id);
    const air = fit.roof === null ? null : fit.roof - fit.headTop;
    console.log(`driver fit   ${(c.name+" ("+style+")").padEnd(28)} top of him ${fit.headTop} m, lowest ${fit.seatBottom} m, glass over his head ${fit.roof} m, air ${air===null?"n/a":(air*1000).toFixed(0)+" mm"}  ` +
      check(air !== null && air > 0.02,
        `${c.name}: the driver is ${air===null?"under no measurable roof":((-air)*1000).toFixed(0)+" mm through the glass"}`) + " " +
      // A cabin he rattles around in is the same bug the other way up:
      // before this was fitted the saloon's driver sat 221 mm low, with
      // his shoulders below his own door line.
      check(air !== null && air < 0.25, `${c.name}: ${((air??0)*1000).toFixed(0)} mm of air over the helmet — the driver is sunk in the cabin`) + " " +
      check(fit.seatBottom > -0.1, `${c.name}: the driver is sunk through the floor`));
  }
}

// --- 9. Every car on the road has a driver, and the near ones solve ---
// Thirty driverless cars was the last place an empty seat could be
// seen. They all carry a rig now. In-range rigs are solved stalest
// first on a fixed budget, so nobody freezes mid-lock when they drop
// out of the set; and every rig gets one full solve at build (dt=1
// snaps all the eases), so even a car that is never scheduled sits
// with its hands on the rim rather than hanging its arms through the
// dash — which is what the position-only shoulder rest pose does
// without a solver.
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
        // ON the rim, measured as distance from the wheel's axis in the
        // wheel's own plane — not against a target this test computes
        // for itself.
        //
        // It used to rebuild the grip point from gripLeft/gripRight and
        // compare, which is the copy-the-arithmetic trap this file warns
        // about at the top, and it duly went stale: the hands now ride
        // the rim only to the comfortable arc and slide past it, so on a
        // hard sweeper the hand is correctly 0.16 m from the axis and
        // 0.158 m from where this used to expect it. The radius is the
        // property that actually matters — a hand off the rim is a hand
        // in the air — and it cannot go out of date with the law.
        const lp = arm.hand.getWorldPosition(new THREE.Vector3());
        rig.wheel.worldToLocal(lp);
        hands = Math.max(hands, Math.abs(Math.hypot(lp.x, lp.y) - rig.wheelRadius));
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
    `             through all of it hands stay ${worstHands} m off the rim (radius), feet ${worstFeet} m off the pedals`
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
      // Published so the assertion can scale with the physics rather
      // than with a literal — see the check that reads it.
      foldPerG: window.__grnRig.driver.foldPerG,
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
    // THE LAW IS THE RATIO, NOT A NUMBER. The fixture asks for a 120 ms
    // gap between two snapshots and gets whatever this machine delivers:
    // 4,658 ms once (recorded in engine.ts), 33,774 ms today on a box
    // that runs the game loop at two frames a second. -28 m/s over 33.8 s
    // is -0.83 m/s2, and a hard bar of -1 called that "thrown away" when
    // the engine had computed it exactly. Wall clock IS the wire's clock
    // for a real client, so the engine is right; the test asserted a
    // value it never controlled. What it means is that the derived
    // deceleration equals the wire's own speed change over the wire's
    // own interval, and that the foot answers it in proportion.
    const wanted = (12 - 40) / remote.gap;
    check(Math.abs(remote.accel - wanted) < 0.25,
      `the wire's own deceleration was thrown away (got ${remote.accel}, the wire said ${wanted.toFixed(2)} over ${remote.gap}s)`);
    // Braking is a response to a decel worth braking for. Below one metre
    // per second squared the foot correctly stays off — that is a lift,
    // not a stop — so the brake is only demanded when the wire delivered
    // something to brake for, and forbidden when it did not.
    if (wanted < -1) check(remote.brake > 0.05, "the remote driver's foot never went near the brake");
    else check(remote.brake < 0.05, `the remote driver braked (${remote.brake}) for a ${wanted.toFixed(2)} m/s2 lift`);
    // The FOLD is checked against the acceleration that actually
    // arrived, not against a fixed number of radians.
    //
    // Two snapshots are a quotient and the divisor is wall-clock: the
    // test asks for a 120 ms gap and gets whatever the machine gives
    // it — 4.6 s once, 25.5 s here. So the deceleration reaching the
    // driver ranges over two orders of magnitude between machines, and
    // an absolute threshold tests the machine rather than the game. It
    // failed exactly that way: -1.1 m/s2 folded the body 0.008 rad
    // against a 0.01 floor, with nothing wrong except the CPU.
    //
    // What the game promises is the TRANSFER — the wire's deceleration
    // reaches the body through solveDriverRig's foldPerG — so that is
    // what is asserted, scaled by the number that actually came off the
    // wire. Half of it, because the lean eases and sixty frames need
    // not converge.
    const wantFold = Math.min(1, -remote.accel / 10) * remote.foldPerG;
    console.log(
      `             ${remote.accel} m/s2 asks for ${wantFold.toFixed(4)} rad of fold; ` +
      `the body gave ${remote.fold}`
    );
    check(
      remote.fold > wantFold * 0.5,
      `the wire's ${remote.accel} m/s2 should fold the driver about ${wantFold.toFixed(4)} rad, ` +
      `and it folded ${remote.fold} — the deceleration is not reaching the body`
    );
  }
}


// --- The handbrake hand: off the rim, onto the lever, and home again ---
//
// The one move in this cab where a hand goes somewhere other than the
// wheel, and the move the game is named for. Pulled through touchDrift,
// the same path a phone uses, so the debounce and the stale-press guard
// are inside the loop being tested rather than bypassed by poking a
// field.
const hb = await page.evaluate(()=>{
  const e = window.__grnEngine;
  const rig = e.carBody.userData.driver;
  if (!rig) return null;
  const V = e.camera.position.constructor;
  let knob = null;
  rig.handbrake.traverse((o)=>{ if (o.userData?.driverPart === "handbrake-grip") knob = o; });
  const inboard = rig.arms.find((a)=>a.side < 0);
  const handAt = () => {
    inboard.hand.updateWorldMatrix(true, false);
    return new V().setFromMatrixPosition(inboard.hand.matrixWorld);
  };
  const rimR = () => {
    const lp = handAt();
    rig.wheel.updateWorldMatrix(true, true);
    rig.wheel.worldToLocal(lp);
    return +Math.hypot(lp.x, lp.y).toFixed(3);
  };
  e.setTouchInput({ steer: 0, throttle: 0.6 });
  e.player.speed = 30;
  for (let i=0;i<40;i++) e.update(1/60);
  const before = { rimR: rimR(), lever: rig.handbrake.rotation.x };
  e.touchDrift(true);
  for (let i=0;i<50;i++) e.update(1/60);
  knob?.updateWorldMatrix(true, false);
  const kp = knob ? new V().setFromMatrixPosition(knob.matrixWorld) : null;
  const pulled = {
    toKnob: kp ? +handAt().distanceTo(kp).toFixed(3) : null,
    lever: rig.handbrake.rotation.x,
    blend: +rig.hbBlend.toFixed(2),
  };
  e.touchDrift(false);
  for (let i=0;i<60;i++) e.update(1/60);
  const after = { rimR: rimR(), blend: +rig.hbBlend.toFixed(2) };
  e.setTouchInput({ throttle: 0 });
  return { before, pulled, after, rest: rig.handbrake.userData.restRotX, radius: rig.wheelRadius };
});
if (!hb) { console.log("no rig for the handbrake check"); process.exit(1); }
console.log(`\nhandbrake  rim ${hb.before.rimR} -> knob ${hb.pulled.toKnob} m (blend ${hb.pulled.blend}, lever ${hb.pulled.lever.toFixed(2)} from rest ${hb.rest.toFixed(2)}) -> rim ${hb.after.rimR} (blend ${hb.after.blend})`);
check(Math.abs(hb.before.rimR - hb.radius) < 0.02, "the inboard hand is not on the rim before the pull");
check(hb.pulled.toKnob !== null && hb.pulled.toKnob < 0.05,
  `pulled, the hand is ${hb.pulled.toKnob} m from the lever grip — it never left the wheel`);
check(hb.pulled.lever < hb.rest - 0.2, "the lever does not rise under the pull");
check(hb.after.blend < 0.1 && Math.abs(hb.after.rimR - hb.radius) < 0.03,
  "released, the hand does not come home to the rim");


// --- 5. Joints stay inside a human range ---
//
// The two-bone solver had no limits: the elbow could lock dead straight
// and the shoulder could fold the arm through the torso to reach a
// target behind it. Neither is a pose a person can hold. The law is the
// RANGE, read off the joints the solver actually set — not off the
// targets it was given, and not off the constants it was handed.
const limits = await page.evaluate(() => {
  const e = window.__grnEngine;
  const rig = e.carBody.userData.driver;
  const R = window.__grnRig.driver;
  const V = e.camera.position.constructor;
  const out = [];
  // Ask for the impossible: a hand behind the shoulder, a hand on the
  // shoulder, a hand overhead. A limited chain refuses gracefully; an
  // unlimited one contorts.
  for (const arm of rig.arms) {
    arm.shoulder.updateWorldMatrix(true, false);
    const sp = new V(); sp.setFromMatrixPosition(arm.shoulder.matrixWorld);
    for (const [name, off] of [["behind", [0, 0, -0.6]], ["on the shoulder", [0, 0.01, 0]], ["overhead", [0, 0.7, 0]]]) {
      window.__ikSolve(arm, sp.clone().add(new V(...off)), sp.clone().add(new V(arm.side, -1, 0)));
      const bend = 2 * Math.acos(Math.min(1, Math.abs(arm.elbow.quaternion.w)));
      out.push({ side: arm.side, ask: name, bendDeg: +(bend * 180 / Math.PI).toFixed(1) });
    }
  }
  return { out, elbowMin: R.elbowMinDeg, elbowMax: R.elbowMaxDeg };
});
{
  const bad = limits.out.filter((r) => r.bendDeg < limits.elbowMin - 0.5 || r.bendDeg > limits.elbowMax + 0.5);
  console.log(`joint limits  elbow bends ${limits.out.map((r) => r.bendDeg).join("/")} deg for impossible targets  ` +
    check(bad.length === 0, `an elbow left its ${limits.elbowMin}-${limits.elbowMax} deg range: ${bad.map((r) => `${r.ask} -> ${r.bendDeg}`).join(", ")}`));
}

// --- 6. The reach edge is smooth ---
//
// At full extension acos has an infinite derivative, so a target that
// crosses the reach boundary made the elbow SNAP from bent to straight:
// a pop on every full-lock turn and every far pedal. The law: elbow bend
// is continuous and monotone through the edge — no step, no reversal —
// while a far target still straightens the arm to within 20 mm of full
// span (check 2 above), so the softening is an approach, not a cap.
const soft = await page.evaluate(() => {
  const e = window.__grnEngine;
  const rig = e.carBody.userData.driver;
  const arm = rig.arms[0];
  const V = e.camera.position.constructor;
  arm.shoulder.updateWorldMatrix(true, false);
  const sp = new V(); sp.setFromMatrixPosition(arm.shoulder.matrixWorld);
  const sc = new V(); sc.setFromMatrixScale(arm.shoulder.matrixWorld);
  const span = (arm.upper + arm.lower) * ((sc.x + sc.y + sc.z) / 3);
  const rows = [];
  for (let f = 0.70; f <= 1.30; f += 0.01) {
    window.__ikSolve(arm, sp.clone().add(new V(0, -span * f, 0)), sp.clone().add(new V(arm.side, -0.5, 0.5)));
    const bend = 2 * Math.acos(Math.min(1, Math.abs(arm.elbow.quaternion.w)));
    rows.push({ f: +f.toFixed(2), bendDeg: +(bend * 180 / Math.PI).toFixed(2) });
  }
  return { rows, span: +span.toFixed(3) };
});
{
  let biggestStep = 0, at = null, reversals = 0;
  for (let i = 1; i < soft.rows.length; i++) {
    const d = soft.rows[i - 1].bendDeg - soft.rows[i].bendDeg; // bend should FALL as the target moves out
    if (d < -0.05) reversals++;
    if (Math.abs(d) > biggestStep) { biggestStep = Math.abs(d); at = soft.rows[i].f; }
  }
  console.log(`reach edge    biggest one-percent step in elbow bend ${biggestStep.toFixed(2)} deg at ${at} of reach, ${reversals} reversals  ` +
    check(biggestStep < 6, `the elbow snaps ${biggestStep.toFixed(1)} deg in a 1% move of the target at ${at} of reach — a pop, not a straighten`) + " " +
    check(reversals === 0, "the elbow re-bends as the target moves further away"));
}

console.log(fail.length?"\nFAILURES:\n - "+fail.join("\n - "):"\nIK solves, clamps and behaves");
await b.close();
process.exit(fail.length?1:0);
