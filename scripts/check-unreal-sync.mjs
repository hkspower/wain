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

// ---- engines --------------------------------------------------------
// The curve shape is the whole feature, so every parameter of it is
// compared. A port whose `breadth` is stale by a hundredth is a port
// where one of the five engines is quietly a different engine.
const hEngines = [...header.matchAll(
  /\{ TEXT\("([^"]+)"\), TEXT\("[^"]+"\), (\d+), EGRNEngineLayout::(\w+), ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, (-?[\d.]+)f, ([\d.]+)f, ([\d.]+)f, (\d+) \},/g
)].map(([, id, cyl, layout, litres, idle, redline, peakAt, breadth, floor, powerMult, massKg, subMix, lopeDepth, price]) => ({
  id, cylinders: +cyl, layout: layout.toLowerCase(), litres: +litres,
  idleRpm: +idle, redlineRpm: +redline, peakAt: +peakAt, breadth: +breadth,
  floor: +floor, powerMult: +powerMult, massKg: +massKg, subMix: +subMix,
  lopeDepth: +lopeDepth, price: +price,
}));
if (hEngines.length !== api.engines.length) {
  fail(`engines: header ${hEngines.length} vs api ${api.engines.length}`);
} else {
  const FIELDS = ["cylinders", "layout", "litres", "idleRpm", "redlineRpm", "peakAt",
    "breadth", "floor", "powerMult", "massKg", "subMix", "lopeDepth", "price"];
  for (let i = 0; i < hEngines.length; i++) {
    const h = hEngines[i];
    const a = api.engines[i];
    if (h.id !== a.id) fail(`engine ${i} id: ${h.id} vs ${a.id}`);
    for (const k of FIELDS) {
      if (h[k] !== a[k]) fail(`engine ${h.id} ${k}: ${h[k]} vs ${a[k]}`);
    }
  }
  // The baked normalisation constant is derived, not copied, so it gets
  // its own check: recompute it from the API's own numbers and compare.
  // Scoped to the block by name. A bare "one float per line" match would
  // happily pick up any other such table that appears later and then
  // compare the wrong numbers.
  const normBlock = header.match(/GRNEngineNorm\[\] = \{([^}]*)\}/)?.[1] ?? "";
  const hNorm = [...normBlock.matchAll(/([\d.]+)f,/g)].map((m) => +m[1]);
  const wantNorm = api.engines.map((e) => {
    const N = 256, MIN = 0.12;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const r = MIN + ((1 - MIN) * (i + 0.5)) / N;
      const d = r - e.peakAt;
      sum += e.floor + (1 - e.floor) * Math.exp(-(d * d) / (2 * e.breadth * e.breadth));
    }
    return sum / N;
  });
  if (hNorm.length !== wantNorm.length) {
    fail(`engine norms: header has ${hNorm.length}, want ${wantNorm.length}`);
  } else {
    for (let i = 0; i < hNorm.length; i++) {
      if (Math.abs(hNorm[i] - wantNorm[i]) > 5e-6) {
        fail(`engine ${api.engines[i].id} norm: header ${hNorm[i]} vs ${wantNorm[i].toFixed(6)}`);
      }
    }
  }
  if (!process.exitCode) {
    ok(`engines: ${hEngines.length} match (13 fields each, plus the baked curve normalisation)`);
  }
}

// ---- cars -----------------------------------------------------------
const hCars = [...header.matchAll(
  /\{ TEXT\("([^"]+)"\), TEXT\("([^"]+)"\), (\d+), ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, FColor\([^)]*\), EGRNBodyStyle::(\w+), (true|false), (\d+) \},/g
)].map(([, id, name, price, power, top, grip, brake, style, kit, engine]) => ({
  id, name, price: +price, power: +power, top: +top, grip: +grip, brake: +brake,
  style: style.toLowerCase(),
  attack: kit === "true",
  engine: +engine,
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
    // Parsed but never compared until now — and it is the governed top
    // speed, which is the most visible number a car has.
    if (h.top !== a.topSpeedKmh) fail(`car ${h.id} topSpeedKmh: ${h.top} vs ${a.topSpeedKmh}`);
    if (h.grip !== a.grip) fail(`car ${h.id} grip: ${h.grip} vs ${a.grip}`);
    if (h.brake !== a.brake) fail(`car ${h.id} brake: ${h.brake} vs ${a.brake}`);
    if (h.style !== a.bodyStyle) fail(`car ${h.id} body style: ${h.style} vs ${a.bodyStyle}`);
    if (h.attack !== (a.kit === "attack")) fail(`car ${h.id} attack kit: ${h.attack} vs ${a.kit}`);
    // The header stores an index into GRNEngines; the API stores the id.
    if (api.engines[h.engine]?.id !== a.engine) {
      fail(`car ${h.id} engine: header index ${h.engine} (${api.engines[h.engine]?.id}) vs ${a.engine}`);
    }
  }
  if (!process.exitCode) ok(`cars: ${hCars.length} match (id, price, power, topSpeedKmh, grip, brake, body, kit, engine)`);
}

// ---- handling -------------------------------------------------------
// Walked from the payload, not from a hand-written list — the same rule
// the rig block below is written under, and for the same reason. This
// check used to name eight constants explicitly while the header carried
// seventy-four, so the drift and brake models could be published wrong
// in their entirety and every line of this script would still print a
// tick. A contract test that only tests the part you remembered to list
// is a contract test that passes for the wrong reason.
{
  const hNs = header.match(/namespace GRNHandling\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!hNs) {
    fail("handling: namespace GRNHandling missing from header");
  } else {
    const cpp = new Map(
      [...hNs.matchAll(/constexpr float (\w+) = (-?[\d.]+)f;/g)].map(([, k, v]) => [k, +v])
    );
    // handling.ts key `driftAngleBase` → header `DriftAngleBase`.
    const want = {};
    for (const [k, v] of Object.entries(api.handling)) {
      want[k[0].toUpperCase() + k.slice(1)] = v;
    }
    let handlingOk = true;
    for (const [k, v] of Object.entries(want)) {
      if (!cpp.has(k)) { fail(`handling ${k} missing from header`); handlingOk = false; }
      else if (Math.abs(cpp.get(k) - v) > 1e-6 * Math.max(1, Math.abs(v))) {
        fail(`handling ${k}: header ${cpp.get(k)} vs web ${v}`);
        handlingOk = false;
      }
    }
    for (const k of cpp.keys()) {
      if (!(k in want)) { fail(`handling ${k} is in the header but not the web build`); handlingOk = false; }
    }
    if (handlingOk) ok(`handling: ${Object.keys(want).length} constants match`);
  }
}

// ---- rig ------------------------------------------------------------
// Every field, walked from the payload rather than a hand-written list.
// Twice now a check in this repo has parsed a value and then never
// compared it, so the list is not allowed to be hand-maintained: if
// src/game/rig.ts grows a bone, this fails until the header has it too.
{
  const rigNs = header.match(/namespace GRNRig\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!rigNs) {
    fail("rig: namespace GRNRig missing from header");
  } else if (!api.rig) {
    fail("rig: payload carries no rig block");
  } else {
    const cpp = new Map(
      [...rigNs.matchAll(/constexpr float (\w+) = (-?[\d.]+)f;/g)].map(([, k, v]) => [k, +v])
    );
    // Same flattening rule as flatRig() in src/game/rig.ts and the
    // generator: `driver.upperArm` → `DriverUpperArm`.
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    const want = {};
    for (const [group, fields] of Object.entries(api.rig)) {
      for (const [k, v] of Object.entries(fields)) want[cap(group) + cap(k)] = v;
    }
    let rigOk = true;
    for (const [k, v] of Object.entries(want)) {
      if (!cpp.has(k)) { fail(`rig ${k} missing from header`); rigOk = false; }
      // Tolerance is a hair looser than the handling block's: the header
      // carries nine significant figures, and Math.PI * 0.72 does not
      // round-trip through a float literal exactly.
      else if (Math.abs(cpp.get(k) - v) > 1e-6 * Math.max(1, Math.abs(v))) {
        fail(`rig ${k}: header ${cpp.get(k)} vs web ${v}`);
        rigOk = false;
      }
    }
    for (const k of cpp.keys()) {
      if (!(k in want)) { fail(`rig ${k} is in the header but not the web build`); rigOk = false; }
    }
    if (rigOk) ok(`rig: ${Object.keys(want).length} bone and joint constants match`);
  }
}

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
