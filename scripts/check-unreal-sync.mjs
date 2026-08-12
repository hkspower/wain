#!/usr/bin/env node
// Contract test: the live JSON API and the baked C++ header must describe
// the same game. The Unreal client trusts either one at runtime, so a
// disagreement between them is a real bug — a player on a plane would
// race a different roster than a player online.
//
//   npm run check:unreal          (against a running dev server)
//   BASE=https://wain.example npm run check:unreal
//
// Exits non-zero on the first mismatch.

import { readFileSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const HEADER = "unreal/Source/GulfRoadNights/GRNTypes.h";

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`✓ ${msg}`);

const res = await fetch(`${BASE}/api/grn/v1/gamedata`).catch((e) => {
  console.error(`Could not reach ${BASE}: ${e.message}`);
  console.error("Start the dev server first: npm run dev");
  process.exit(2);
});
if (!res.ok) {
  console.error(`API returned ${res.status}`);
  process.exit(2);
}
const api = await res.json();
const header = readFileSync(HEADER, "utf8");

// ---- track ----------------------------------------------------------
const hPoints = [...header.matchAll(/^\t\{ (-?\d+), (-?\d+) \},$/gm)].map(
  ([, x, z]) => [+x, +z]
);
if (hPoints.length !== api.track.controlPoints.length) {
  fail(`track points: header ${hPoints.length} vs api ${api.track.controlPoints.length}`);
} else {
  const bad = api.track.controlPoints.findIndex(
    (p, i) => hPoints[i][0] !== p.x || hPoints[i][1] !== p.z
  );
  if (bad >= 0) fail(`track point ${bad} differs`);
  else ok(`track: ${hPoints.length} control points match`);
}

// ---- rivals ---------------------------------------------------------
const hRivals = [...header.matchAll(
  /\{ TEXT\("([^"]+)"\), TEXT\("[^"]*"\), TEXT\("([^"]+)"\), TEXT\("[^"]*"\), FColor\(0x(\w\w), 0x(\w\w), 0x(\w\w)\), ([\d.]+)f, EGRNBodyStyle::(\w+) \},/g
)].map(([, name, crew, r, g, b, top, style]) => ({
  name,
  crew,
  color: `#${(r + g + b).toLowerCase()}`,
  top: +top,
  style: style.toLowerCase(),
}));
if (hRivals.length !== api.rivals.length) {
  fail(`rivals: header ${hRivals.length} vs api ${api.rivals.length}`);
} else {
  for (let i = 0; i < hRivals.length; i++) {
    const h = hRivals[i];
    const a = api.rivals[i];
    if (h.name !== a.name) fail(`rival ${i} name: ${h.name} vs ${a.name}`);
    if (h.crew !== a.crew) fail(`rival ${i} crew differs`);
    if (h.color !== a.bodyColor) fail(`rival ${i} colour: ${h.color} vs ${a.bodyColor}`);
    if (h.top !== a.topSpeedKmh) fail(`rival ${i} top speed: ${h.top} vs ${a.topSpeedKmh}`);
    if (h.style !== a.bodyStyle) fail(`rival ${i} body style: ${h.style} vs ${a.bodyStyle}`);
  }
  if (!process.exitCode) ok(`rivals: ${hRivals.length} match (name, crew, colour, top speed, body)`);
}

// ---- cars -----------------------------------------------------------
const hCars = [...header.matchAll(
  /\{ TEXT\("([^"]+)"\), TEXT\("([^"]+)"\), (\d+), ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, FColor\([^)]*\), EGRNBodyStyle::(\w+) \},/g
)].map(([, id, name, price, power, top, grip, brake, style]) => ({
  id, name, price: +price, power: +power, top: +top, grip: +grip, brake: +brake,
  style: style.toLowerCase(),
}));
if (hCars.length !== api.cars.length) {
  fail(`cars: header ${hCars.length} vs api ${api.cars.length}`);
} else {
  for (let i = 0; i < hCars.length; i++) {
    const h = hCars[i];
    const a = api.cars[i];
    if (h.id !== a.id) fail(`car ${i} id: ${h.id} vs ${a.id}`);
    if (h.price !== a.price) fail(`car ${h.id} price: ${h.price} vs ${a.price}`);
    if (h.power !== a.power) fail(`car ${h.id} power: ${h.power} vs ${a.power}`);
    if (h.grip !== a.grip) fail(`car ${h.id} grip: ${h.grip} vs ${a.grip}`);
    if (h.brake !== a.brake) fail(`car ${h.id} brake: ${h.brake} vs ${a.brake}`);
    if (h.style !== a.bodyStyle) fail(`car ${h.id} body style: ${h.style} vs ${a.bodyStyle}`);
  }
  if (!process.exitCode) ok(`cars: ${hCars.length} match (id, price, power, grip, brake, body)`);
}

// ---- handling -------------------------------------------------------
const hConst = (name) => {
  const m = header.match(new RegExp(`constexpr float ${name} = ([\\d.]+)f;`));
  return m ? +m[1] : undefined;
};
const pairs = [
  ["Ceiling", "ceiling"], ["ThrustK", "thrustK"], ["DragA", "dragA"], ["DragB", "dragB"],
  ["FlashRangeM", "flashRangeM"], ["DriftMinSpeed", "driftMinSpeed"],
  ["DriftYawClamp", "driftYawClamp"], ["DriftDriveLoss", "driftDriveLoss"],
];
let handlingOk = true;
for (const [cpp, js] of pairs) {
  const h = hConst(cpp);
  const a = api.handling[js];
  if (h === undefined) { fail(`handling ${cpp} missing from header`); handlingOk = false; }
  else if (Math.abs(h - a) > 1e-6) { fail(`handling ${cpp}: ${h} vs ${a}`); handlingOk = false; }
}
if (handlingOk) ok(`handling: ${pairs.length} constants match`);

// ---- api version ----------------------------------------------------
const clientVersion = readFileSync(
  "unreal/Source/GulfRoadNights/GRNApi.h", "utf8"
).match(/#define GRN_API_VERSION (\d+)/)?.[1];
if (+clientVersion !== api.apiVersion) {
  fail(`apiVersion: UE client ${clientVersion} vs server ${api.apiVersion}`);
} else {
  ok(`apiVersion ${api.apiVersion} agreed by both sides`);
}

if (process.exitCode) {
  console.error("\nRun `npm run sync:unreal` to regenerate the header from the web source.");
} else {
  console.log("\nWeb API and Unreal header are in sync.");
}
