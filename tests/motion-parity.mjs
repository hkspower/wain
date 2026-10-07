// The body's motion in the UE5 port is the web build's.
//
//   npm run test:motion      (needs g++; no dev server, no browser)
//
// GRNMotion.h carries attitude.ts's springs, suspension.ts's hub solve and
// Ackermann. Both are driven through the same scripted cases and compared:
// the springs through a 3000-step swing past their clamps, four hundred
// random hubs and two hundred steering geometries. The frames differ — Unreal
// has X forward and Y right, the web z forward and x left; roll is shared
// (right side down) and pitch is negated — so the cases are mapped here and
// the mapping is part of what is being proved.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { stepAttitude, ATTITUDE } from "../src/game/attitude.ts";
import { hubHeight, solveSuspension, steerAngles } from "../src/game/suspension.ts";
import { rollMaxFor } from "../src/game/mods.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

let cxx = null;
for (const c of ["g++", "clang++"]) {
  try { execFileSync(c, ["--version"], { stdio: "ignore" }); cxx = c; break; } catch {}
}
if (!cxx) { console.error("no C++ compiler — this test needs g++ or clang++"); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), "grn-motion-"));
const bin = join(dir, "motion");
execFileSync(cxx, ["-O2", "-std=c++17", "-I", "unreal/Source/GulfRoadNights", "tools/parity/motion.cpp", "-o", bin], { stdio: "pipe" });
const rows = execFileSync(bin, [], { encoding: "utf8" }).trim().split("\n").slice(1)
  .map((l) => { const [k, ...v] = l.split(","); return { k, v: v.map(Number) }; });
rmSync(dir, { recursive: true, force: true });
console.log(`built    GRNMotion.h with ${cxx}`);

const worst = { att: 0, hub: 0, cam: 0, ack: 0 };
const n = { att: 0, hub: 0, cam: 0, ack: 0 };

// The springs, hubs and steering: the C++ script's stream, replayed.
// The constants must be the web's, or the match below is vacuous.
check(ATTITUDE.rollK === 95 && ATTITUDE.pitchK === 120, "attitude.ts constants moved; update GRNMotion.h");
{
  let s = 20261007n;
  const U = () => { s = (1103515245n * s + 12345n) & 0xffffffffn; return Number(s) / 4294967296; };
  const R = (lo, hi) => lo + U() * (hi - lo);
  const a = { roll: 0, pitch: 0, rollVel: 0, pitchVel: 0 };
  const att = rows.filter((r) => r.k === "att");
  let row = 0;
  for (let i = 0; i < 3000; i++) {
    const lat = Math.sin(i * 0.013) * 22 + R(-2, 2);
    const lng = Math.cos(i * 0.021) * 14 + R(-1, 1);
    stepAttitude(a, lat, lng, rollMaxFor("gtr"), 1 / 120);
    if (i % 10 === 0) {
      const [, , roll, pitch, rv, pv] = att[row++].v;
      for (const [x, y] of [[a.roll, roll], [a.pitch, pitch], [a.rollVel, rv], [a.pitchVel, pv]]) {
        worst.att = Math.max(worst.att, Math.abs(x - y)); n.att++;
      }
    }
  }
  // The dropped frame: a half-second step must be clamped to 1/30.
  stepAttitude(a, 9, -6, rollMaxFor("sedan"), 0.5);
  const [, , roll, pitch] = att[row].v;
  worst.att = Math.max(worst.att, Math.abs(a.roll - roll), Math.abs(a.pitch - pitch));
  // U and R above consumed the stream in the C++ order, so the hubs and the
  // steering follow from the same generator.
  for (let i = 0; i < 400; i++) {
    const xw = R(-1, 1), zw = R(-1.6, 1.6), rest = R(0.3, 0.55), roll = R(-0.12, 0.12), pitch = R(-0.06, 0.06);
    const [, , , , , z] = rows.filter((r) => r.k === "hub")[i].v;
    const [, , , , , cam] = rows.filter((r) => r.k === "cam")[i].v;
    const solved = solveSuspension({ roll, pitch, wheels: [{ x: xw, z: zw, restY: rest }] })[0];
    worst.hub = Math.max(worst.hub, Math.abs(solved.y - z)); n.hub++;
    worst.cam = Math.max(worst.cam, Math.abs(solved.camber - cam)); n.cam++;
    // And the closed form itself, uncapped, where the stroke never bites.
    const free = hubHeight(rest, xw, zw, roll, pitch);
    if (Math.abs(free - rest) < 0.17) worst.hub = Math.max(worst.hub, Math.abs(free - z));
  }
  const ack = rows.filter((r) => r.k === "ack");
  for (let i = 0; i < 200; i++) {
    const inner = R(-0.52, 0.52), L = R(2.2, 3.4), T = R(1.4, 1.9);
    const [, , , left, right] = ack[i].v;
    const web = steerAngles(-inner, L, T);
    worst.ack = Math.max(worst.ack, Math.abs(-web.plusX - left), Math.abs(-web.minusX - right)); n.ack++;
  }
}

for (const k of Object.keys(worst)) {
  console.log(`  ${k.padEnd(4)} ${String(n[k]).padStart(5)} values, worst difference ${worst[k].toExponential(2)}  ${check(worst[k] < 1e-9, `${k} differs from the web build by ${worst[k]}`)}`);
}
// The physics the match is of: a right turn leans the body left (roll
// negative), braking dives the nose (pitch positive), and a level car does
// not move its hubs.
{
  const a = { roll: 0, pitch: 0, rollVel: 0, pitchVel: 0 };
  for (let i = 0; i < 240; i++) stepAttitude(a, 12, -20, 0.1, 1 / 120);
  check(a.roll < 0, `a right-hand corner (lateral +) rolled the body to ${a.roll}, not left`);
  check(a.pitch > 0, `braking pitched the body to ${a.pitch}, not nose down`);
  console.log(`  signs    right turn roll ${a.roll.toFixed(4)}, hard braking pitch ${a.pitch.toFixed(4)}  ok`);
}

if (fail.length) {
  console.error(`\n${fail.length} FAILED\n  ` + fail.join("\n  "));
  process.exit(1);
}
console.log("\nthe port moves its body the way the web build does");
