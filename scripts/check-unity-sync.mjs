#!/usr/bin/env node
// Contract test: the live JSON API and the generated Unity data must
// describe the same game. The Unity client trusts either one at runtime,
// so a disagreement is a real bug — a player offline would race a
// different roster than a player online.
//
//   npm run check:unity            (against a running dev server)
//   BASE=https://wain.example npm run check:unity
//
// This is the Unity twin of check-unreal-sync.mjs, and it exists because
// the hand-maintained Unity roster had silently fallen two rivals and an
// entire showroom behind the game before anyone noticed.
//
// Exits non-zero on the first mismatch.

import { readFileSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const DATA = "unity/Assets/Scripts/GRNData.cs";

let failed = 0;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  failed++;
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
const src = readFileSync(DATA, "utf8");

// ---- api version ----------------------------------------------------
const version = +src.match(/public const int ApiVersion = (\d+);/)?.[1];
if (version !== api.apiVersion) {
  fail(`apiVersion: Unity ${version} vs server ${api.apiVersion}`);
} else {
  ok(`apiVersion ${version} agreed by both sides`);
}

// ---- track ----------------------------------------------------------
const points = [...src.matchAll(/new TrackPoint \{ X = (-?[\d.]+)f, Z = (-?[\d.]+)f \}/g)].map(
  ([, x, z]) => [+x, +z]
);
if (points.length !== api.track.controlPoints.length) {
  fail(`track points: Unity ${points.length} vs api ${api.track.controlPoints.length}`);
} else {
  const bad = api.track.controlPoints.findIndex(
    (p, i) => points[i][0] !== p.x || points[i][1] !== p.z
  );
  if (bad >= 0) fail(`track point ${bad} differs`);
  else ok(`track: ${points.length} control points match`);
}

const half = +src.match(/RoadHalfWidth = ([\d.]+)f/)?.[1];
if (half !== api.track.roadHalfWidth) fail(`roadHalfWidth ${half} vs ${api.track.roadHalfWidth}`);

// ---- rivals ---------------------------------------------------------
// Each generated entry spans several lines; split on the constructor and
// pull fields per block so a reordered emitter cannot fool the match.
const rivalBlocks = src.split("new Rival {").slice(1);
const field = (b, re) => b.match(re)?.[1];
const rivals = rivalBlocks.map((b) => ({
  id: field(b, /Id = "([^"]*)"/),
  name: field(b, /Name = "([^"]*)"/),
  crew: field(b, /Crew = "([^"]*)"/),
  area: field(b, /Area = "([^"]*)"/),
  body: field(b, /Body = Hex\(0x([0-9A-F]{6})\)/),
  top: +field(b, /TopSpeedKmh = ([\d.]+)f/),
  style: field(b, /Style = BodyStyle\.(\w+)/),
  prize: +field(b, /PrizeKd = (\d+)/),
  intro: field(b, /IntroAr = "([^"]*)"/),
}));

if (rivals.length !== api.rivals.length) {
  fail(`rivals: Unity ${rivals.length} vs api ${api.rivals.length}`);
} else {
  for (let i = 0; i < rivals.length; i++) {
    const u = rivals[i];
    const a = api.rivals[i];
    if (u.id !== a.id) fail(`rival ${i} id: ${u.id} vs ${a.id}`);
    if (u.name !== a.name) fail(`rival ${i} name: ${u.name} vs ${a.name}`);
    if (u.crew !== a.crew) fail(`rival ${a.id} crew differs`);
    if (u.area !== a.area) fail(`rival ${a.id} area: ${u.area} vs ${a.area}`);
    if (`#${u.body.toLowerCase()}` !== a.bodyColor) {
      fail(`rival ${a.id} colour: #${u.body.toLowerCase()} vs ${a.bodyColor}`);
    }
    if (u.top !== a.topSpeedKmh) fail(`rival ${a.id} top speed: ${u.top} vs ${a.topSpeedKmh}`);
    if (u.style.toLowerCase() !== a.bodyStyle) {
      fail(`rival ${a.id} body style: ${u.style.toLowerCase()} vs ${a.bodyStyle}`);
    }
    if (u.prize !== a.prizeKd) fail(`rival ${a.id} prize: ${u.prize} vs ${a.prizeKd}`);
    // The spoken lines are the whole character; a truncated one is a bug
    if (u.intro !== a.lines.intro) fail(`rival ${a.id} intro line differs`);
  }
  if (!failed) ok(`rivals: ${rivals.length} match (id, name, crew, area, colour, speed, body, prize, voice line)`);
}

// ---- cars -----------------------------------------------------------
const carBlocks = src.split("new Car {").slice(1);
const cars = carBlocks.map((b) => ({
  id: field(b, /Id = "([^"]*)"/),
  name: field(b, /Name = "([^"]*)"/),
  price: +field(b, /Price = (\d+)/),
  power: +field(b, /Power = ([\d.]+)f/),
  top: +field(b, /TopSpeed = ([\d.]+)f/),
  grip: +field(b, /Grip = ([\d.]+)f/),
  brake: +field(b, /Brake = ([\d.]+)f/),
  style: field(b, /Style = BodyStyle\.(\w+)/),
  kit: field(b, /AttackKit = (true|false)/) === "true",
}));

if (cars.length !== api.cars.length) {
  fail(`cars: Unity ${cars.length} vs api ${api.cars.length}`);
} else {
  for (let i = 0; i < cars.length; i++) {
    const u = cars[i];
    const a = api.cars[i];
    if (u.id !== a.id) fail(`car ${i} id: ${u.id} vs ${a.id}`);
    if (u.price !== a.price) fail(`car ${a.id} price: ${u.price} vs ${a.price}`);
    if (u.power !== a.power) fail(`car ${a.id} power: ${u.power} vs ${a.power}`);
    if (u.top !== a.topSpeed) fail(`car ${a.id} topSpeed: ${u.top} vs ${a.topSpeed}`);
    if (u.grip !== a.grip) fail(`car ${a.id} grip: ${u.grip} vs ${a.grip}`);
    if (u.brake !== a.brake) fail(`car ${a.id} brake: ${u.brake} vs ${a.brake}`);
    if (u.style.toLowerCase() !== a.bodyStyle) {
      fail(`car ${a.id} body style: ${u.style.toLowerCase()} vs ${a.bodyStyle}`);
    }
    if (u.kit !== (a.kit === "attack")) fail(`car ${a.id} attack kit: ${u.kit} vs ${a.kit}`);
  }
  if (!failed) ok(`cars: ${cars.length} match (id, price, power, speed, grip, brake, body, kit)`);
}

// ---- handling -------------------------------------------------------
const pairs = [
  ["Ceiling", "ceiling"], ["ThrustK", "thrustK"], ["DragA", "dragA"], ["DragB", "dragB"],
  ["SteerSmoothRate", "steerSmoothRate"], ["CasterRate", "casterRate"],
  ["HeadingClamp", "headingClamp"], ["FlashRangeM", "flashRangeM"],
  ["DriftMinSpeed", "driftMinSpeed"], ["DriftAngleBase", "driftAngleBase"],
  ["DriftAngleSpeedK", "driftAngleSpeedK"], ["DriftEngageRate", "driftEngageRate"],
  ["DriftRecoverRate", "driftRecoverRate"], ["DriftYawClamp", "driftYawClamp"],
  ["DriftLatScrub", "driftLatScrub"], ["DriftDriveLoss", "driftDriveLoss"],
];
let handlingOk = true;
for (const [cs, js] of pairs) {
  const v = src.match(new RegExp(`public const float ${cs} = ([\\d.]+)f;`))?.[1];
  const a = api.handling[js];
  if (v === undefined) { fail(`handling ${cs} missing from GRNData.cs`); handlingOk = false; }
  // Without this, a key the API stops publishing compares against
  // undefined, Math.abs(NaN) > 1e-6 is false, and the check passes.
  else if (typeof a !== "number") { fail(`handling ${js} missing from the API payload`); handlingOk = false; }
  else if (Math.abs(+v - a) > 1e-6) {
    fail(`handling ${cs}: ${v} vs ${a}`);
    handlingOk = false;
  }
}
if (handlingOk) ok(`handling: ${pairs.length} constants match`);

if (failed) {
  console.error("\nRun `npm run sync:unity` to regenerate GRNData.cs from the web source.");
  process.exit(1);
}
console.log("\nWeb API and Unity data are in sync.");
