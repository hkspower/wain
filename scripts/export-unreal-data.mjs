#!/usr/bin/env node
// Regenerates unreal/Source/GulfRoadNights/GRNTypes.h from the web
// build's TypeScript — the single source of truth for track geometry,
// the rival roster, the showroom and the handling constants.
//
//   node scripts/export-unreal-data.mjs
//   npm run sync:unreal
//
// Run it whenever src/game/{track,rivals,mods}.ts change; commit the
// regenerated header alongside. The UE5 project never edits this data
// by hand.

import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const trackTs = read("src/game/track.ts");
const rivalsTs = read("src/game/rivals.ts");
const modsTs = read("src/game/mods.ts");

// ---------------------------------------------------------------- track
const cpBlock = trackTs.match(/const CONTROL_POINTS[^=]*=\s*\[([^;]*)\];/s)[1];
const points = [...cpBlock.matchAll(/\[\s*(-?\d+)\s*,\s*0\s*,\s*(-?\d+)\s*\]/g)].map(
  ([, x, z]) => ({ x: +x, z: +z })
);
if (points.length < 10) throw new Error("track parse failed");

const roadHalf = +trackTs.match(/ROAD_HALF_WIDTH\s*=\s*([\d.]+)/)[1];
const lanes = trackTs
  .match(/LANES\s*=\s*\[([^\]]+)\]/)[1]
  .split(",")
  .map((v) => +v.trim());

// --------------------------------------------------------------- rivals
const rivalBlocks = rivalsTs.split(/\n  \{\n/).slice(1);
const rivals = rivalBlocks
  .map((b) => {
    const f = (re) => b.match(re)?.[1];
    const name = f(/\bname: "([^"]+)"/);
    if (!name) return null;
    return {
      name,
      arabic: f(/arabicName: "([^"]+)"/),
      crew: f(/crew: "([^"]+)"/),
      area: f(/area: "([^"]+)"/),
      color: f(/bodyColor: 0x([0-9a-fA-F]{6})/),
      top: +f(/topSpeedKmh: ([\d.]+)/),
      style: f(/bodyStyle: "(\w+)"/) ?? "sedan",
    };
  })
  .filter(Boolean);
if (rivals.length < 6) throw new Error(`rival parse failed (${rivals.length})`);

// ----------------------------------------------------------------- cars
const carsBlock = modsTs.match(/export const CARS[^=]*=\s*\[(.*?)\n\];/s)[1];
const cars = carsBlock
  .split(/\n  \{\n/)
  .slice(1)
  .map((b) => {
    const f = (re) => b.match(re)?.[1];
    const id = f(/id: "([^"]+)"/);
    if (!id) return null;
    return {
      id,
      name: f(/name: "([^"]+)"/),
      price: +f(/price: (\d+)/),
      power: +f(/power: ([\d.]+)/),
      top: +f(/topSpeedKmh: ([\d.]+)/),
      grip: +f(/grip: ([\d.]+)/),
      brake: +f(/brake: ([\d.]+)/),
      color: f(/color: 0x([0-9a-fA-F]{6})/),
      style: f(/style: "(\w+)"/) ?? "sedan",
      kit: f(/kit: "(\w+)"/) ?? null,
    };
  })
  .filter(Boolean);
if (cars.length < 5) throw new Error(`car parse failed (${cars.length})`);

// ------------------------------------------------------------- emit C++
const styleEnum = { sedan: "EGRNBodyStyle::Sedan", zx: "EGRNBodyStyle::ZX", gtr: "EGRNBodyStyle::GTR", rx7: "EGRNBodyStyle::RX7" };
const col = (hex) =>
  `FColor(0x${hex.slice(0, 2).toUpperCase()}, 0x${hex.slice(2, 4).toUpperCase()}, 0x${hex.slice(4, 6).toUpperCase()})`;


// Handling constants come from src/game/handling.ts itself; a hardcoded
// twin of that table is exactly the rot this generator exists to prevent.
const handlingTsU = readFileSync("src/game/handling.ts", "utf8");
const handlingKeys = [...handlingTsU.matchAll(/^\s{2}(\w+):\s*([\d.]+),/gm)].map(
  ([, k, v]) => [k, +v]
);
if (handlingKeys.length < 16) throw new Error(`handling parse failed (${handlingKeys.length})`);
const cppf = (v) => (Number.isInteger(v) ? `${v}.f` : `${v}f`);

// The rig — bone lengths, joint offsets, grip angles, pedal travel, neck
// limits. Unlike handling this one is nested and carries expressions
// (`Math.PI * 0.72` says ten-to-two far better than 2.26194671 does), so
// it is evaluated rather than regexed. The file is a single plain object
// literal of numbers by construction; anything else here should fail
// loudly rather than emit a half-populated header.
const rigSrc = readFileSync("src/game/rig.ts", "utf8");
const rigBody = rigSrc.match(/export const RIG = (\{[\s\S]*?\n\}) as const;/)?.[1];
if (!rigBody) throw new Error("rig parse failed: could not find `export const RIG = {...} as const;`");
const rigObj = new Function(`"use strict"; return ${rigBody};`)();
/** `driver.upperArm` → `DriverUpperArm`, the C++ constant's name. The
 *  identical rule lives in flatRig() in src/game/rig.ts and in
 *  check-unreal-sync.mjs; all three must agree or the contract check
 *  compares two different sets of names and reports every field twice. */
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const flatten = (obj) => {
  const out = {};
  for (const [group, fields] of Object.entries(obj)) {
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        throw new Error(`rig ${group}.${k} is not a finite number: ${v}`);
      }
      out[cap(group) + cap(k)] = v;
    }
  }
  return out;
};
const rigKeys = Object.entries(flatten(rigObj));
if (rigKeys.length < 40) throw new Error(`rig parse thin (${rigKeys.length} fields)`);
// Bone lengths need full precision: the solver's law of cosines is
// exact, so a rounded arm lands the hand somewhere else entirely.
const cppr = (v) => (Number.isInteger(v) ? `${v}.f` : `${Number(v.toPrecision(9))}f`);

const header = `#pragma once

// GENERATED FILE — do not edit by hand.
// Produced by scripts/export-unreal-data.mjs from the web build's
// src/game/{track,rivals,mods}.ts. Regenerate with:  npm run sync:unreal
//
// One web unit = one metre = 100 UE units (GRN_M). The handling block
// at the bottom mirrors src/game/engine.ts; the generator carries it so
// a regeneration never loses it.

#include "CoreMinimal.h"

#define GRN_M(x) ((x) * 100.0f)

static const float GRNRoadHalfWidth = GRN_M(${roadHalf.toFixed(1)}f);
static const float GRNLanes[${lanes.length}] = { ${lanes.map((l) => `GRN_M(${l.toFixed(2)}f)`).join(", ")} };

struct FGRNTrackPoint { float X; float Z; };
static const FGRNTrackPoint GRNControlPoints[] = {
${points.map((p) => `\t{ ${p.x}, ${p.z} },`).join("\n")}
};

// ------------------------------------------------------------- rivals

enum class EGRNBodyStyle : uint8 { Sedan, ZX, GTR, RX7 };

struct FGRNRivalDef
{
	const TCHAR* Name;
	const TCHAR* ArabicName;
	const TCHAR* Crew;
	const TCHAR* Area;
	FColor BodyColor;
	float TopSpeedKmh;
	EGRNBodyStyle Style;
};

static const FGRNRivalDef GRNRivals[] = {
${rivals
  .map(
    (r) =>
      `\t{ TEXT("${r.name}"), TEXT("${r.arabic}"), TEXT("${r.crew}"), TEXT("${r.area}"), ${col(r.color)}, ${r.top.toFixed(1)}f, ${styleEnum[r.style]} },`
  )
  .join("\n")}
};
static const int32 GRNRivalCount = UE_ARRAY_COUNT(GRNRivals);

// ------------------------------------------------------------- showroom

struct FGRNCarDef
{
	const TCHAR* Id;
	const TCHAR* Name;
	int32 Price;
	float Power;
	float TopSpeedKmh; // governed limit, km/h
	float Grip;
	float Brake;
	FColor Paint;
	EGRNBodyStyle Style;
	/** Factory time-attack aero (wing, splitter, bronze wheels). */
	bool bAttackKit;
};

static const FGRNCarDef GRNCars[] = {
${cars
  .map(
    (c) =>
      `\t{ TEXT("${c.id}"), TEXT("${c.name}"), ${c.price}, ${c.power.toFixed(2)}f, ${c.top.toFixed(1)}f, ${c.grip.toFixed(1)}f, ${c.brake.toFixed(1)}f, ${col(c.color)}, ${styleEnum[c.style]}, ${c.kit === "attack" ? "true" : "false"} },`
  )
  .join("\n")}
};
static const int32 GRNCarCount = UE_ARRAY_COUNT(GRNCars);

// -------------------------------------------------------- handling model
// Mirrors src/game/handling.ts — parsed from it, never hand-copied. If a
// constant is added there, rerunning this generator publishes it here.

namespace GRNHandling
{
${handlingKeys
  .map(([k, v]) => `\tconstexpr float ${k[0].toUpperCase()}${k.slice(1)} = ${cppf(v)};`)
  .join("\n")}
}

// ------------------------------------------------------------------ rigs
// Mirrors src/game/rig.ts. Every figure in this game is posed by the
// analytic IK in GRNDriverRig.cpp rather than by an animation asset, and
// a solver is only as portable as the numbers it solves against. Lengths
// are metres — multiply by GRN_M for UE centimetres. Angles are radians
// and rates are per-second, in both engines.

namespace GRNRig
{
${rigKeys.map(([k, v]) => `\tconstexpr float ${k} = ${cppr(v)};`).join("\n")}
}
`;

writeFileSync("unreal/Source/GulfRoadNights/GRNTypes.h", header);
console.log(
  `GRNTypes.h regenerated: ${points.length} track points, ${rivals.length} rivals, ` +
    `${cars.length} cars, ${handlingKeys.length} handling constants, ${rigKeys.length} rig constants.`
);
