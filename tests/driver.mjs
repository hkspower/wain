// The driver has mass.
//
//   npm run test:driver          (no browser, no dev server)
//
// The torso and the head were first-order lerps toward the load: they
// arrived and stopped, while the car under them — a mass on a spring —
// overshot. This drives the rig headlessly at sixty hertz and asks for
// the things only a spring can do: overshoot a step and settle, lag the
// head behind the shoulders, throw the body into the belt on a spike
// and bring it back. And the feet, which now share the pedals the way
// a person's do: one foot for throttle and brake, the other for the
// clutch.
import * as THREE from "three";
import { kuwaitiDriver } from "../src/game/characters.ts";
import { solveDriverRig } from "../src/game/driver.ts";
import { RIG } from "../src/game/rig.ts";
import { stepOvershoot, springHz } from "../src/game/spring.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const D = RIG.driver;
const look = new THREE.Vector3(0, D.lookHeight, D.lookAheadM);
const DT = 1 / 60;

const fresh = () => kuwaitiDriver();
const at = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const footOf = (rig, side) => { const leg = rig.legs.find((l) => l.side === side); return at(leg.hand); };

// --- 1. A step of lateral load overshoots once and settles ------------
{
  const rig = fresh();
  const target = -D.leanPerG; // 1.43 g to the left leans the body right
  let peak = 0, peakAt = 0, settledAt = -1;
  const trace = [];
  for (let i = 0; i < 180; i++) {
    solveDriverRig(rig, 0, 0.3, 0, look, DT, D.leanRefAccel, 0);
    const x = rig.lean.rotation.z;
    trace.push(x);
    if (Math.abs(x) > Math.abs(peak)) { peak = x; peakAt = i; }
  }
  for (let i = 0; i < trace.length; i++) {
    if (Math.abs(trace[i] - target) > Math.abs(target) * 0.02) settledAt = i;
  }
  const over = peak / target;
  const expect = stepOvershoot(D.torsoK, D.torsoC);
  console.log(`torso     ${springHz(D.torsoK).toFixed(2)} Hz; step to ${target.toFixed(3)} rad peaks at ${peak.toFixed(4)} (${over.toFixed(3)}x, law says ${expect.toFixed(3)}x) at ${(peakAt * DT).toFixed(2)} s, settled by ${((settledAt + 1) * DT).toFixed(2)} s`);
  console.log(`  ${check(Math.sign(peak) === Math.sign(target), "the body leans INTO the corner")}  leans away from the force`);
  console.log(`  ${check(over > 1.05 && over < 1.25, `overshoot ${over.toFixed(3)}x — a lerp cannot pass its target and a passenger would swing further`)}  overshoots once, like a braced body`);
  console.log(`  ${check(Math.abs(over - expect) < 0.03, `peak ${over.toFixed(3)}x disagrees with the spring law's ${expect.toFixed(3)}x`)}  the peak is the one the constants predict`);
  console.log(`  ${check(settledAt * DT < 1.5, `still ringing at ${(settledAt * DT).toFixed(2)} s`)}  settled inside 1.5 s`);
}

// --- 2. The head follows the shoulders, later, and crosses them --------
{
  const rig = fresh();
  let torsoPeakAt = -1, headPeakAt = -1, torsoPeak = 0, headPeak = 0;
  let crossed = false;
  for (let i = 0; i < 180; i++) {
    solveDriverRig(rig, 0, 0.3, 0, look, DT, D.leanRefAccel, 0);
    const t = rig.lean.rotation.z, h = rig.crown.rotation.z;
    if (Math.abs(t) > Math.abs(torsoPeak)) { torsoPeak = t; torsoPeakAt = i; }
    if (Math.abs(h) > Math.abs(headPeak)) { headPeak = h; headPeakAt = i; }
    // The neck keeps the eyes level: the head rolls the other way to the
    // torso, and being the lighter pendulum it passes its own target.
    if (Math.abs(h) > Math.abs(t) * D.headCounter * 1.02) crossed = true;
  }
  console.log(`head      ${springHz(D.neckK).toFixed(2)} Hz; counter-roll peaks ${headPeak.toFixed(4)} at ${(headPeakAt * DT).toFixed(3)} s, torso ${torsoPeak.toFixed(4)} at ${(torsoPeakAt * DT).toFixed(3)} s`);
  console.log(`  ${check(Math.sign(headPeak) === -Math.sign(torsoPeak), "the head rolls with the torso instead of fighting it")}  the neck fights the lean`);
  console.log(`  ${check(headPeakAt > torsoPeakAt, `the head peaked at frame ${headPeakAt}, the torso at ${torsoPeakAt} — no lag`)}  the head arrives after the shoulders`);
  console.log(`  ${check(crossed, "the head never passes its counter-roll target — that is a lerp, not a neck")}  and overshoots its own target`);
}

// --- 3. A spike throws the torso into the belt, and it comes back ------
{
  const rig = fresh();
  for (let i = 0; i < 60; i++) solveDriverRig(rig, 0, 0.3, 0, look, DT, 0, 0);
  let peak = 0, headPeak = 0;
  // Three frames of a wall: 30 m/s² of deceleration, then nothing.
  for (let i = 0; i < 120; i++) {
    solveDriverRig(rig, 0, 0, 0, look, DT, 0, i < 3 ? -30 : 0);
    peak = Math.max(peak, rig.lean.rotation.x);
    headPeak = Math.min(headPeak, rig.crown.rotation.x);
  }
  const rest = rig.lean.rotation.x;
  console.log(`spike     three frames at 30 m/s² fold the torso to ${peak.toFixed(4)} rad (braking figure ${D.foldPerG}, belt at ${(D.foldPerG * D.foldSpikeK).toFixed(3)}), head whips ${headPeak.toFixed(4)}, back to ${rest.toFixed(4)} after 2 s`);
  console.log(`  ${check(peak > D.foldPerG * 0.5, `a wall folded the torso only ${peak.toFixed(4)} rad — the spike was lerped away`)}  the spike reaches the body`);
  console.log(`  ${check(peak <= D.foldPerG * D.foldSpikeK + 1e-6, `the torso passed the belt at ${peak.toFixed(4)}`)}  the belt stops it`);
  console.log(`  ${check(headPeak < 0, "the head did not whip forward")}  the head whips`);
  console.log(`  ${check(Math.abs(rest) < 0.005, `torso still at ${rest.toFixed(4)} rad two seconds after the hit`)}  and the body comes back`);
}

// --- 4. One foot for throttle and brake, the other for the clutch ------
{
  const rig = fresh();
  const R = -1, L = 1;
  for (let i = 0; i < 60; i++) solveDriverRig(rig, 0, 1, 0, look, DT, 0, 0);
  const wotR = footOf(rig, R).distanceTo(at(rig.pedals.throttle));
  const wotL = footOf(rig, L).distanceTo(at(rig.pedals.rest));
  for (let i = 0; i < 60; i++) solveDriverRig(rig, 0, 0, 1, look, DT, 0, -8);
  const brkR = footOf(rig, R).distanceTo(at(rig.pedals.brake));
  const brkRthr = footOf(rig, R).distanceTo(at(rig.pedals.throttle));
  const brkL = footOf(rig, L).distanceTo(at(rig.pedals.rest));
  console.log(`feet      right foot ${wotR.toFixed(3)} m from the throttle at WOT, ${brkR.toFixed(3)} m from the brake braking (${brkRthr.toFixed(3)} from the throttle); left ${wotL.toFixed(3)}/${brkL.toFixed(3)} m from the rest`);
  console.log(`  ${check(wotR < 0.02 && brkR < 0.02, "the right foot is not on the pedal it is pressing")}  the right foot works both pedals`);
  console.log(`  ${check(brkRthr > 0.1, "the right foot never left the throttle for the brake")}  and actually moves between them`);
  console.log(`  ${check(wotL < 0.02 && brkL < 0.02, "the left foot is not on the dead pedal")}  the left foot rests`);

  // A downshift under braking: the left foot goes to the clutch, the
  // right heel rolls toward the throttle, the throttle pedal blips.
  let clutchMin = 1, heelMax = 0, blip = 0, clutchSink = 0;
  const restZ = rig.pedals.throttle.userData.restZ;
  for (let i = 0; i < 40; i++) {
    const k = Math.min(1, i / 12);
    const pulse = -Math.sin(Math.PI * k); // a 0.2 s downshift pulse
    solveDriverRig(rig, 0, 0, 1, look, DT, 0, -8, 0, i < 12 ? pulse : 0);
    clutchMin = Math.min(clutchMin, footOf(rig, L).distanceTo(at(rig.pedals.clutch)));
    heelMax = Math.max(heelMax, rig.heelToe);
    blip = Math.max(blip, rig.pedals.throttle.position.z - restZ);
    clutchSink = Math.max(clutchSink, rig.pedals.clutch.position.z - rig.pedals.clutch.userData.restZ);
  }
  for (let i = 0; i < 60; i++) solveDriverRig(rig, 0, 0, 1, look, DT, 0, -8);
  const homeL = footOf(rig, L).distanceTo(at(rig.pedals.rest));
  const homeR = footOf(rig, R).distanceTo(at(rig.pedals.brake));
  console.log(`downshift left foot within ${clutchMin.toFixed(3)} m of the clutch (pedal sank ${clutchSink.toFixed(3)}), heel-toe ${heelMax.toFixed(2)}, throttle blipped ${blip.toFixed(3)} m; after: left ${homeL.toFixed(3)} m from rest, right ${homeR.toFixed(3)} m from brake`);
  console.log(`  ${check(clutchMin < 0.03, `the left foot came no nearer the clutch than ${clutchMin.toFixed(3)} m`)}  the clutch goes in`);
  console.log(`  ${check(clutchSink > 0.02, "the clutch pedal did not sink")}  and the pedal sinks`);
  console.log(`  ${check(heelMax > 0.5 && blip > 0.01, `heel-toe ${heelMax.toFixed(2)}, blip ${blip.toFixed(3)} — no blip on a braking downshift`)}  heel-and-toe blips the throttle`);
  console.log(`  ${check(homeL < 0.02 && homeR < 0.02, "the feet did not come home after the shift")}  both feet come home`);

  // An UPSHIFT on the throttle: clutch, no blip.
  let heelUp = 0;
  for (let i = 0; i < 12; i++) solveDriverRig(rig, 0, 1, 0, look, DT, 0, 3, 0, Math.sin(Math.PI * i / 12));
  heelUp = rig.heelToe;
  console.log(`  ${check(heelUp < 0.05, `heel-toe ${heelUp.toFixed(2)} on an upshift with no brake`)}  no blip on an upshift`);
}

// --- 5. Time is time: a big dt is integrated, a whole second snaps ----
{
  const a = fresh(), b = fresh();
  for (let i = 0; i < 15; i++) solveDriverRig(a, 0, 0.3, 0, look, DT, D.leanRefAccel, 0);
  solveDriverRig(b, 0, 0.3, 0, look, 0.25, D.leanRefAccel, 0);
  const diff = Math.abs(a.lean.rotation.z - b.lean.rotation.z);
  console.log(`time      fifteen frames ${a.lean.rotation.z.toFixed(4)} rad, one quarter-second step ${b.lean.rotation.z.toFixed(4)} rad`);
  console.log(`  ${check(diff < 0.01 && Number.isFinite(b.lean.rotation.z), `a 0.25 s step lands ${diff.toFixed(4)} rad away from fifteen frames of the same time`)}  a traffic rig's accumulated dt is integrated, not clamped`);
  const c = fresh();
  solveDriverRig(c, 0, 0.3, 0, look, 1, D.leanRefAccel, 0);
  console.log(`  ${check(Math.abs(c.lean.rotation.z + D.leanPerG) < 1e-6, `dt=1 left the lean at ${c.lean.rotation.z} instead of the rest pose`)}  a whole second settles the rig`);
}

// --- 6. A lean rig still solves with the short call --------------------
{
  const rig = kuwaitiDriver(0x333333, 0xc09070, true);
  let threw = false;
  try { for (let i = 0; i < 10; i++) solveDriverRig(rig, 0.3, 0.2, 0, look, DT, 4, -1); } catch { threw = true; }
  console.log(`  ${check(!threw, "a lean rig throws")}  lean rigs solve`);
}

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe driver has mass");
process.exit(fail.length ? 1 : 0);
