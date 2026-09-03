// What an impact does to a car — measured, not assumed.
//
//   npm run test:crash        (no browser, no dev server)
//
// The model this joins already spins a car properly: lose the tail and
// drift.ts hands it a rate set by how fast it was rotating and how much
// speed there was to turn into rotation, then four sliding tyres take it
// back out. Nothing but a slide could ever enter that. So a barrier at
// 200 km/h sideways scaled the heading by a number and drove on, while
// the same speed lost on the throttle went round twice — the violent
// event was the one that did not rotate.
//
// The laws below are about the lever arm, because that is what was
// missing. An impulse through the centre of mass does not turn anything;
// one through a corner does, and WHICH corner decides the sign.

import { HANDLING as H } from "../src/game/handling.ts";
import { solveWallImpact, solveTrafficImpact, scrapeDrag } from "../src/game/crash.ts";
import { newDriftState, spinFromImpact, solveDrift } from "../src/game/drift.ts";
import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
const F = (n, d = 2) => Number(n).toFixed(d);

const wall = (into, heading, side = 1, crashResist = 0) =>
  solveWallImpact({ into, heading, side, crashResist });

// --- 1. Severity is the speed INTO the obstacle ----------------------
{
  check(wall(0, 0.3).severity === 0, "a car not moving into the wall crashes at severity 0");
  check(Math.abs(wall(H.crashLatFull / 2, 0.3).severity - 0.5) < 1e-9,
    "half the full-severity speed is half severity");
  check(wall(H.crashLatFull, 0.3).severity === 1, "crashLatFull is severity 1");
  check(wall(H.crashLatFull * 4, 0.3).severity === 1, "severity saturates rather than running away");
  console.log(`severity: 0 / ${F(wall(H.crashLatFull / 2, 0.3).severity)} / 1 at 0, ${H.crashLatFull / 2}, ${H.crashLatFull} m/s into the barrier`);
}

// --- 2. A crash never manufactures energy ----------------------------
// The one law that must hold for every input in the space, because a
// crash that can speed the car up is an exploit and not a mistake.
{
  let worst = 0;
  for (let into = 0; into <= 40; into += 0.5)
    for (let hd = -1.5; hd <= 1.5; hd += 0.1)
      for (const side of [-1, 1])
        for (const cr of [0, 0.5, 1]) {
          const r = wall(into, hd, side, cr);
          worst = Math.max(worst, r.speedMul);
          check(r.speedMul <= 1, `speedMul ${r.speedMul} > 1 at into=${into} hd=${F(hd)}`);
          check(Number.isFinite(r.yaw), `yaw not finite at into=${into} hd=${F(hd)}`);
        }
  console.log(`over 2,196 barrier hits the worst speedMul is ${F(worst, 4)} — never above 1`);
}

// --- 3. A parallel scrape does not rotate the car --------------------
// This is the whole reason rotation reads the ANGLE and not the speed:
// a car sliding dead flat along the steel is hit square through its
// side, and square through the side is through the centre of mass.
{
  const flat = wall(H.crashLatFull, 0);
  check(Math.abs(flat.yaw) < 1e-12, `a parallel graze imparted ${F(flat.yaw, 4)} rad/s`);
  check(!flat.spin, "a parallel graze must never spin the car");
  const angled = wall(H.crashLatFull, 0.6);
  check(Math.abs(angled.yaw) > 0.5, "an angled hit at the same speed must rotate the car");
  console.log(`same ${H.crashLatFull} m/s: parallel ${F(flat.yaw, 3)} rad/s, 34° ${F(angled.yaw, 2)} rad/s`);
}

// --- 4. Rotation grows with both angle and severity ------------------
{
  let prev = -1, mono = true;
  for (let hd = 0; hd <= H.crashLeverRef; hd += 0.05) {
    const y = Math.abs(wall(H.crashLatFull, hd).yaw);
    if (y < prev - 1e-12) mono = false;
    prev = y;
  }
  check(mono, "rotation must not fall as the car is angled further over");
  prev = -1; mono = true;
  for (let into = 0; into <= H.crashLatFull; into += 0.5) {
    const y = Math.abs(wall(into, 0.5).yaw);
    if (y < prev - 1e-12) mono = false;
    prev = y;
  }
  check(mono, "rotation must not fall as the hit gets harder");
  console.log("rotation rises with angle and with severity, both monotonically");
}

// --- 5. Which end touches decides which way the car turns ------------
// The barrier pushes whatever touches it away from itself. Nose first
// and the car is straightened along the wall; tail first and the back is
// thrown out while the nose tucks in. Opposite signs from one fact.
{
  const nose = wall(H.crashLatFull, 0.6, 1);   // pointed INTO the right wall
  const tail = wall(H.crashLatFull, -0.6, 1);  // pointed away, tail arrives
  check(nose.noseFirst, "pointed into the wall is a nose-first contact");
  check(!tail.noseFirst, "pointed away from the wall is a tail-first contact");
  check(Math.sign(nose.yaw) !== Math.sign(tail.yaw),
    `nose and tail contacts must rotate opposite ways (${F(nose.yaw, 2)} vs ${F(tail.yaw, 2)})`);
  check(Math.abs(tail.yaw) > Math.abs(nose.yaw),
    "a tail-first clip must rotate the car harder than a nose-first one");
  console.log(`nose-first ${F(nose.yaw, 2)} rad/s, tail-first ${F(tail.yaw, 2)} rad/s — opposite, and the tail is worse`);
}

// --- 6. The asymmetry that matters: only one of them lets go ---------
// The constants are set so a square tail-first clip at the full-severity
// speed goes round and the mirror-image nose-first one does not. If that
// stops being true the constants have drifted and the crash model has
// quietly become symmetric again.
{
  const nose = wall(H.crashLatFull, 0.6, 1);
  const tail = wall(H.crashLatFull, -0.6, 1);
  check(tail.spin, "a square tail-first clip at full severity must spin the car");
  check(!nose.spin, "the mirror-image nose-first clip must NOT spin the car");
  const gentle = wall(2, 0.6, 1);
  check(!gentle.spin, "a 2 m/s clip must never spin the car");
  console.log(`spin threshold ${H.crashSpinRate} rad/s: tail ${F(tail.yaw, 2)} spins, nose ${F(nose.yaw, 2)} does not`);
}

// --- 7. A cage resists damage, and only damage -----------------------
// Rotation is angular momentum, not damage, and a cage does not change
// the impulse the barrier applies. Letting it scale the yaw was measured
// and reverted: at the catalogue's 0.55 it dropped a full-severity
// tail-first clip from 3.74 to 1.68 rad/s — under the threshold — so the
// one part sold as surviving crashes also made the car unspinnable by
// any impact at all. That is a far bigger handling change than the part
// is sold as, and it would have arrived by accident.
{
  const CAGE = 0.55; // mods.ts: the only thing that sets crashResist
  const bare = wall(H.crashLatFull, -0.6, 1, 0);
  const caged = wall(H.crashLatFull, -0.6, 1, CAGE);
  check(caged.yaw === bare.yaw, "a cage must not change the rotation an impact imparts");
  check(caged.spin === bare.spin, "a cage must not make a spinning impact non-spinning");
  check(caged.speedMul > bare.speedMul, "a cage must cost less speed than none");
  check(caged.spLoss === bare.spLoss, "spLoss is quoted before the cage's share; the caller takes it off");
  console.log(`cage ${CAGE}: yaw unchanged at ${F(bare.yaw, 2)} rad/s, speed kept ${F(bare.speedMul, 3)} -> ${F(caged.speedMul, 3)}`);
}

// --- 8. The rotation reaches the spin solver, and that spin ends -----
// A rate handed in must behave like one the car arrived at by sliding:
// it decays under sliding-tyre friction and stops. A spin that never
// ends is worse than no spin at all.
{
  const s = newDriftState();
  const tail = wall(H.crashLatFull, -0.6, 1);
  check(spinFromImpact(s, tail.yaw), "a spinning impact must enter the spin solver");
  check(!spinFromImpact(s, tail.yaw),
    "a second contact must NOT restart a spin already running — that holds the car spinning down the barrier");
  const dt = 1 / 60;
  let t = 0, deg = 0, spinning = true;
  const step = { dt, speed: 55, steer: 0, throttle: 0, handbrake: false,
    wheelspin: 0, brakeRotate: 0, driftAngleMult: 1 };
  while (t < 12 && spinning) {
    const r = solveDrift(s, step);
    spinning = r.spinning;
    deg = r.spinDeg || deg;
    t += dt;
  }
  check(!spinning, `the spin never ended (still going after ${F(t, 1)} s)`);
  check(deg > 90, `a full-severity tail clip should go somewhere: only ${F(deg, 0)}°`);
  console.log(`impact spin at 200 km/h: ${F(deg, 0)}° swept, stopped after ${F(t, 2)} s`);
}

// --- 9. Traffic: a rear shunt turns you more than a nose-on -----------
{
  const rear = solveTrafficImpact({ closing: H.trafficClosingFull, heading: 0.2, shove: 1, fromBehind: true, crashResist: 0 });
  const front = solveTrafficImpact({ closing: H.trafficClosingFull, heading: 0.2, shove: 1, fromBehind: false, crashResist: 0 });
  check(Math.abs(rear.yaw) > Math.abs(front.yaw),
    "being hit from behind must turn the car more than running into the back of one");
  check(solveTrafficImpact({ closing: 1, heading: 0.2, shove: 1, fromBehind: true, crashResist: 0 }).spin === false,
    "a 1 m/s nudge must never spin the car");
  console.log(`shunt at ${H.trafficClosingFull} m/s: from behind ${F(rear.yaw, 2)} rad/s, nose-on ${F(front.yaw, 2)} rad/s`);
}

// --- 10. The engine reads the constants, not its own copies ----------
// Every crash number in handling.ts was read by NOTHING here: engine.ts
// had 12, 0.28, 5 and 22 typed into it while the UE5 pawn read the
// published names. They agreed by luck, and editing handling.ts moved
// the ports and left the web build alone. This fails if that returns.
{
  const eng = readFileSync("src/game/engine.ts", "utf8");
  const crashBlock = eng.slice(eng.indexOf("const hit = solveWallImpact"), eng.indexOf("Lap timing"));
  for (const lit of ["/ 12", "0.28", "1.2 + 5", "/ 22"]) {
    check(!crashBlock.includes(lit), `engine.ts has the literal "${lit}" back in the crash path`);
  }
  check(eng.includes("solveWallImpact") && eng.includes("solveTrafficImpact"),
    "engine.ts must route both crash kinds through crash.ts");
  check(scrapeDrag(0) === H.crashScrapeBase && scrapeDrag(1) === H.crashScrapeBase + H.crashScrapeK,
    "scrapeDrag must be built from the published constants");
  console.log("engine.ts routes both crash kinds through crash.ts, with no literals left in the path");
}

// --- 10b. The kick is an impulse, not a per-frame nudge ---------------
// A hit too soft to spin the car still turns it, and the drift model
// holds a non-spinning car as an ANGLE while a spinning one is a RATE —
// so the impulse has to be converted. The first wiring of this used the
// frame's own dt, which made the kick both negligible and frame-rate
// dependent: the identical crash turned the car half as far at 120 fps
// as at 60. Nothing about an impact may depend on when it landed.
{
  const h = wall(H.crashLatFull, 0.6, 1);
  check(Math.abs(h.kick - h.yaw * H.crashKickTime) < 1e-12,
    "the kick must be the impulse over a fixed timescale");
  check(Math.abs(h.kick) > 0.15,
    `a full-severity clip should turn the car meaningfully, not by ${F(h.kick, 4)} rad`);
  // What the dt-scaled version would have produced, for the record.
  const at60 = h.yaw / 60, at120 = h.yaw / 120;
  check(Math.abs(at60 - at120) > 1e-6, "sanity: the dt-scaled kick really did differ by frame rate");
  console.log(`kick ${F(h.kick, 3)} rad (${F((h.kick * 180) / Math.PI, 1)}°), frame-rate independent — dt-scaled it was ${F(at60, 3)} at 60fps and ${F(at120, 3)} at 120`);
}

// --- 10c. The dead-constant ratchet -----------------------------------
// handling.ts used to claim its constants were checked against the web
// build's local copies by scripts/check-unreal-sync.mjs. That script
// never opens engine.ts: it compares the JSON API to the C++ header, and
// both are generated FROM handling.ts, so it can only prove that file
// agrees with itself. Under that false assurance every crash constant sat
// published and unread on the web for as long as it existed.
//
// This does not demand that all 139 be live — some are genuinely
// duplicated in engine.ts for hot-path clarity, which is a defensible
// choice. It ratchets: the number read by nothing may go down, never up.
{
  const KNOWN_DEAD = 14;
  const dir = "src/game";
  const { readdirSync } = await import("node:fs");
  const src = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && f !== "handling.ts")
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
    .join("\n");
  // The instrument first: a check that cannot fail proves nothing, and a
  // regex that matches nothing would report every constant dead.
  check(/\bbrakeLockMargin\b/.test(src), "instrument broken — a constant known to be used reads as dead");
  check(/\bcrashYawK\b/.test(src), "instrument broken — crashYawK reads as dead");

  const dead = Object.keys(H).filter((k) => !new RegExp(`\\b${k}\\b`).test(src));
  check(dead.length <= KNOWN_DEAD,
    `${dead.length} handling constants are read by nothing, up from ${KNOWN_DEAD}: ${dead.slice(KNOWN_DEAD).join(", ")}`);
  for (const k of Object.keys(H).filter((k) => k.startsWith("crash") || k.startsWith("traffic")))
    check(!dead.includes(k), `${k} is published but read by nothing — the bug crash.ts was written to fix`);
  console.log(`${Object.keys(H).length} published constants, ${dead.length} read by nothing (ratchet: ${KNOWN_DEAD}), every crash constant live`);
}

// --- 11. The UE5 port computes the same crash -------------------------
// The pawn used to carry its own copy of this: a heading multiplier, no
// rotation, and the constants read by name while the web build had them
// typed in as literals. The solver lives in GRNSim.h now, which a bare
// g++ can compile precisely so this claim is checkable — the most anyone
// could verify before was that a table of numbers matched, which is the
// check that passed while the two builds drifted apart.
{
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ladder } = await import("../tools/parity/crash-ladder.mjs");

  let cc = null;
  for (const c of ["g++", "clang++"]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); cc = c; break; } catch {}
  }
  if (!cc) {
    console.log("the UE5 port agrees\n  skip  no C++ compiler; install g++ to check the port");
  } else {
    const dir = mkdtempSync(join(tmpdir(), "grn-crash-"));
    const bin = join(dir, "ladder");
    execFileSync(cc, ["-std=c++17", "-I", "unreal/Source/GulfRoadNights",
      "-O0", "-o", bin, "tools/parity/crash-ladder.cpp"]);
    const cpp = execFileSync(bin, { encoding: "utf8" }).trimEnd().split("\n");
    const ts = ladder();
    check(cpp.length === ts.length, `port printed ${cpp.length} rows, the web build ${ts.length}`);
    let same = 0;
    for (let i = 0; i < Math.min(cpp.length, ts.length); i++) {
      if (cpp[i] === ts[i]) same++;
      else fail.push(`row ${i + 1} differs:\n      web  ${ts[i]}\n      UE5  ${cpp[i]}`);
    }
    console.log(`the UE5 port agrees on all ${same} rows, to six decimal places`);
  }
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
