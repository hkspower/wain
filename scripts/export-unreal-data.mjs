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
      top: +f(/topSpeed: ([\d.]+)/),
      grip: +f(/grip: ([\d.]+)/),
      brake: +f(/brake: ([\d.]+)/),
      color: f(/color: 0x([0-9a-fA-F]{6})/),
      style: f(/style: "(\w+)"/) ?? "sedan",
    };
  })
  .filter(Boolean);
if (cars.length < 5) throw new Error(`car parse failed (${cars.length})`);

// ------------------------------------------------------------- emit C++
const styleEnum = { sedan: "EGRNBodyStyle::Sedan", zx: "EGRNBodyStyle::ZX", gtr: "EGRNBodyStyle::GTR" };
const col = (hex) =>
  `FColor(0x${hex.slice(0, 2).toUpperCase()}, 0x${hex.slice(2, 4).toUpperCase()}, 0x${hex.slice(4, 6).toUpperCase()})`;

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

enum class EGRNBodyStyle : uint8 { Sedan, ZX, GTR };

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
	float TopSpeed;
	float Grip;
	float Brake;
	FColor Paint;
	EGRNBodyStyle Style;
};

static const FGRNCarDef GRNCars[] = {
${cars
  .map(
    (c) =>
      `\t{ TEXT("${c.id}"), TEXT("${c.name}"), ${c.price}, ${c.power.toFixed(2)}f, ${c.top.toFixed(1)}f, ${c.grip.toFixed(1)}f, ${c.brake.toFixed(1)}f, ${col(c.color)}, ${styleEnum[c.style]} },`
  )
  .join("\n")}
};
static const int32 GRNCarCount = UE_ARRAY_COUNT(GRNCars);

// -------------------------------------------------------- handling model
// Mirrors src/game/engine.ts. If tuning changes there, update here (the
// generator owns this block, so edit the generator).

namespace GRNHandling
{
	constexpr float Ceiling = 115.f;
	constexpr float ThrustK = 19.f;
	constexpr float DragA = 0.0012f;
	constexpr float DragB = 1.2f;
	constexpr float SteerSmoothRate = 7.f;
	constexpr float CasterRate = 2.4f;
	constexpr float HeadingClamp = 0.45f;
	constexpr float FlashRangeM = 60.f;

	constexpr float DriftMinSpeed = 14.f;
	constexpr float DriftAngleBase = 0.38f;
	constexpr float DriftAngleSpeedK = 0.28f;
	constexpr float DriftEngageRate = 3.4f;
	constexpr float DriftRecoverRate = 2.3f;
	constexpr float DriftYawClamp = 0.75f;
	constexpr float DriftLatScrub = 0.5f;
	constexpr float DriftDriveLoss = 1.1f;
}
`;

writeFileSync("unreal/Source/GulfRoadNights/GRNTypes.h", header);
console.log(
  `GRNTypes.h regenerated: ${points.length} track points, ${rivals.length} rivals, ${cars.length} cars.`
);
