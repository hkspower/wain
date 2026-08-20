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
const enginesTs = read("src/game/engines.ts");

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
      engine: f(/engine: "([^"]+)"/),
      tank: +f(/tankLitres: ([\d.]+)/),
    };
  })
  .filter(Boolean);
if (cars.length < 5) throw new Error(`car parse failed (${cars.length})`);
for (const c of cars) {
  if (!c.engine) throw new Error(`${c.id}: no stock engine — every car has one`);
}

// -------------------------------------------------------------- engines
// Parsed rather than hand-copied, like everything else here. A port that
// ships the cars without these builds fourteen machines that all pull
// the same way, which is the one thing the engines exist to prevent.
const engBlock = enginesTs.match(/export const ENGINES[^=]*=\s*\[(.*?)\n\];/s)[1];
const engines = engBlock
  .split(/\n  \{\n/)
  .slice(1)
  .map((b) => {
    const f = (re) => b.match(re)?.[1];
    const id = f(/id: "([^"]+)"/);
    if (!id) return null;
    return {
      id,
      name: f(/name: "([^"]+)"/),
      cylinders: +f(/cylinders: (\d+)/),
      layout: f(/layout: "(\w+)"/),
      litres: +f(/litres: ([\d.]+)/),
      idle: +f(/idleRpm: (\d+)/),
      redline: +f(/redlineRpm: (\d+)/),
      peakAt: +f(/peakAt: ([\d.]+)/),
      breadth: +f(/breadth: ([\d.]+)/),
      floor: +f(/floor: ([\d.]+)/),
      powerMult: +f(/powerMult: ([\d.]+)/),
      massKg: +f(/massKg: (-?[\d.]+)/),
      subMix: +f(/subMix: ([\d.]+)/),
      lopeDepth: +f(/lopeDepth: ([\d.]+)/),
      price: +f(/price: (\d+)/),
    };
  })
  .filter(Boolean);
if (engines.length !== 5) throw new Error(`engine parse failed (${engines.length}, want 5)`);
const layoutEnumMap = {
  inline: "EGRNEngineLayout::Inline",
  flat: "EGRNEngineLayout::Flat",
  vee: "EGRNEngineLayout::Vee",
};
/** Same guard as `style` below: an unknown layout must stop the build
 *  rather than write `undefined` into a header and report success. */
const layoutEnum = (l, who) => {
  const v = layoutEnumMap[l];
  if (!v) throw new Error(`${who}: unknown engine layout "${l}" — add it to layoutEnumMap and to EGRNEngineLayout`);
  return v;
};
/** The mean of the raw curve over [MIN_REV_FRACTION, 1], which is what
 *  normalises every engine to the same average. Computed here so the
 *  header can carry a constant instead of integrating at runtime — the
 *  identical sum runs in engines.ts, and check-unreal-sync compares the
 *  two. */
const normOf = (e) => {
  const N = 256;
  const MIN = 0.12;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const r = MIN + ((1 - MIN) * (i + 0.5)) / N;
    const d = r - e.peakAt;
    sum += e.floor + (1 - e.floor) * Math.exp(-(d * d) / (2 * e.breadth * e.breadth));
  }
  return sum / N;
};
/** The fuel constants, read out of engines.ts and track.ts rather than
 *  copied. A port whose pump price has drifted sells petrol at a
 *  different rate to the same player on the same save. */
const num = (src, name) => {
  const m = src.match(new RegExp(`export const ${name} = (-?[\\d.]+)`));
  if (!m) throw new Error(`fuel constant ${name} not found`);
  return +m[1];
};
const fuel = {
  rate: num(enginesTs, "FUEL_RATE"),
  fils: num(enginesTs, "FUEL_FILS_PER_LITRE"),
  pumpLps: num(enginesTs, "PUMP_LITRES_PER_SEC"),
  pumpMaxKmh: num(enginesTs, "PUMP_MAX_KMH"),
  air: num(enginesTs, "AIR_G_PER_L"),
  afr: num(enginesTs, "AFR"),
  petrol: num(enginesTs, "FUEL_G_PER_L"),
};
const stationBlock = trackTs.match(/export const STATIONS[^=]*=\s*\[(.*?)\n\];/s)[1];
const stations = [...stationBlock.matchAll(/\{\s*s:\s*(\d+),\s*lat:\s*(-?[\d.]+)\s*\}/g)].map(
  ([, st, lat]) => ({ s: +st, lat: +lat })
);
if (!stations.length) throw new Error("station parse failed");
const forecourt = {
  halfSpan: +trackTs.match(/FORECOURT = \{ halfSpan: ([\d.]+)/)[1],
  extraWidth: +trackTs.match(/extraWidth: ([\d.]+) \}/)[1],
};

const engIndex = (id, who) => {
  const i = engines.findIndex((e) => e.id === id);
  if (i < 0) throw new Error(`${who}: unknown engine "${id}" — it is not in engines.ts`);
  return i;
};

// ------------------------------------------------------------- emit C++
const styleEnum = {
  sedan: "EGRNBodyStyle::Sedan",
  zx: "EGRNBodyStyle::ZX",
  gtr: "EGRNBodyStyle::GTR",
  rx7: "EGRNBodyStyle::RX7",
  hatch: "EGRNBodyStyle::Hatch",
};
/**
 * A style this map does not know has to stop the build.
 *
 * It did not. Adding a fifth silhouette to the web build wrote
 * `..., undefined, false },` into the header and this script reported
 * success — C++ that cannot compile, delivered by a generator that said
 * it had worked. The Unity exporter beside this one has always thrown on
 * exactly this case; this is that guard, late.
 */
const style = (s, who) => {
  const v = styleEnum[s];
  if (!v) throw new Error(`${who}: unknown bodyStyle "${s}" — add it to styleEnum and to EGRNBodyStyle below`);
  return v;
};
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

enum class EGRNBodyStyle : uint8 { Sedan, ZX, GTR, RX7, Hatch };

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
      `\t{ TEXT("${r.name}"), TEXT("${r.arabic}"), TEXT("${r.crew}"), TEXT("${r.area}"), ${col(r.color)}, ${r.top.toFixed(1)}f, ${style(r.style, r.name)} },`
  )
  .join("\n")}
};
static const int32 GRNRivalCount = UE_ARRAY_COUNT(GRNRivals);

// -------------------------------------------------------------- engines
// Two fours, two sixes and a V8. The curve is a Gaussian bump on a floor,
// normalised so every engine's mean torque across the usable rev range is
// exactly 1.0 — see GRNEngineTorque below, and src/game/engines.ts for
// why that normalisation is the whole design.

enum class EGRNEngineLayout : uint8 { Inline, Flat, Vee };

struct FGRNEngineDef
{
	const TCHAR* Id;
	const TCHAR* Name;
	int32 Cylinders;
	EGRNEngineLayout Layout;
	float Litres;
	float IdleRpm;
	float RedlineRpm;
	/** Torque curve, in rev-range fraction: where it peaks, how wide that
	 *  peak is, and what is left down at idle. */
	float PeakAt;
	float Breadth;
	float Floor;
	float PowerMult;
	float MassKg;
	/** How much of the note sits on the sub-octave. */
	float SubMix;
	/** Cross-plane half-order lope. Non-zero on the V8 alone. */
	float LopeDepth;
	int32 Price;
};

static const FGRNEngineDef GRNEngines[] = {
${engines
  .map(
    (e) =>
      `\t{ TEXT("${e.id}"), TEXT("${e.name}"), ${e.cylinders}, ${layoutEnum(e.layout, e.id)}, ${e.litres.toFixed(1)}f, ${e.idle.toFixed(1)}f, ${e.redline.toFixed(1)}f, ${e.peakAt.toFixed(2)}f, ${e.breadth.toFixed(2)}f, ${e.floor.toFixed(2)}f, ${e.powerMult.toFixed(2)}f, ${e.massKg.toFixed(1)}f, ${e.subMix.toFixed(2)}f, ${e.lopeDepth.toFixed(2)}f, ${e.price} },`
  )
  .join("\n")}
};
static const int32 GRNEngineCount = UE_ARRAY_COUNT(GRNEngines);

/** Lowest rev fraction the gearbox ever asks for — the curve is
 *  normalised over [this, 1], not [0, 1]. */
static const float GRNMinRevFraction = 0.12f;

/** Mean raw torque over the usable range, so the shape can be normalised
 *  without integrating it at runtime. Computed by the generator from the
 *  same numbers above. */
static const float GRNEngineNorm[] = {
${engines.map((e) => `\t${normOf(e).toFixed(6)}f,`).join("\n")}
};

/** Torque multiplier at a point in the rev range. Averages to exactly
 *  1.0 for every engine: a swap redistributes power, it never adds any. */
static FORCEINLINE float GRNEngineTorque(int32 EngineIndex, float Rev)
{
	const FGRNEngineDef& E = GRNEngines[EngineIndex];
	const float R = FMath::Clamp(Rev, 0.0f, 1.0f);
	const float D = R - E.PeakAt;
	const float Raw = E.Floor + (1.0f - E.Floor) * FMath::Exp(-(D * D) / (2.0f * E.Breadth * E.Breadth));
	return Raw / GRNEngineNorm[EngineIndex];
}

/** The note: a four-stroke fires Cylinders/2 times per crank revolution. */
static FORCEINLINE float GRNEngineFiringHz(int32 EngineIndex, float Rev)
{
	const FGRNEngineDef& E = GRNEngines[EngineIndex];
	const float Rpm = E.IdleRpm + (E.RedlineRpm - E.IdleRpm) * FMath::Clamp(Rev, 0.0f, 1.0f);
	return (Rpm / 60.0f) * (E.Cylinders * 0.5f);
}

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
	/** Index into GRNEngines — what the car left the factory with. */
	int32 Engine;
	/** Tank, litres. */
	float TankLitres;
};

static const FGRNCarDef GRNCars[] = {
${cars
  .map(
    (c) =>
      `\t{ TEXT("${c.id}"), TEXT("${c.name}"), ${c.price}, ${c.power.toFixed(2)}f, ${c.top.toFixed(1)}f, ${c.grip.toFixed(1)}f, ${c.brake.toFixed(1)}f, ${col(c.color)}, ${style(c.style, c.id)}, ${c.kit === "attack" ? "true" : "false"}, ${engIndex(c.engine, c.id)}, ${c.tank.toFixed(1)}f },`
  )
  .join("\n")}
};
static const int32 GRNCarCount = UE_ARRAY_COUNT(GRNCars);

// ------------------------------------------------------------------ fuel
//
// An engine is an air pump: it swallows half its displacement every
// crank revolution, and at stoichiometric the petrol follows from the
// air. Nothing here is a thirst figure typed in per engine — the V8
// drinks two and a half times what the 1.6 does because it is two and a
// half times the pump, and for no other reason.

namespace GRNFuel
{
	/** How much faster the game burns than the world does. A tank is a
	 *  session rather than an afternoon. */
	constexpr float RateMultiplier = ${cppf(fuel.rate)};
	/** Kuwait's 91-octane pump price. A thousand fils to the dinar. */
	constexpr int32 FilsPerLitre = ${fuel.fils};
	constexpr float PumpLitresPerSecond = ${cppf(fuel.pumpLps)};
	/** Above this the forecourt is something you drove past. */
	constexpr float PumpMaxKmh = ${cppf(fuel.pumpMaxKmh)};
	constexpr float AirGramsPerLitre = ${cppf(fuel.air)};
	constexpr float AirFuelRatio = ${cppf(fuel.afr)};
	constexpr float PetrolGramsPerLitre = ${cppf(fuel.petrol)};
}

/** How much of each swallow is actually air. A closed throttle is mostly
 *  vacuum, which is why an idling engine burns a litre an hour. */
static FORCEINLINE float GRNVolumetricEfficiency(float Throttle, float Rev)
{
	const float Open = 0.22f + 0.73f * FMath::Clamp(Throttle, 0.0f, 1.0f);
	return Open * (1.0f - 0.12f * FMath::Max(0.0f, Rev - 0.75f));
}

/** Litres per second, before RateMultiplier. */
static FORCEINLINE float GRNFuelLitresPerSecond(int32 EngineIndex, float Throttle, float Rev)
{
	const FGRNEngineDef& E = GRNEngines[EngineIndex];
	const float Rpm = E.IdleRpm + (E.RedlineRpm - E.IdleRpm) * FMath::Clamp(Rev, 0.0f, 1.0f);
	const float AirLitres = (E.Litres * 0.5f) * (Rpm / 60.0f) * GRNVolumetricEfficiency(Throttle, Rev);
	return (AirLitres * GRNFuel::AirGramsPerLitre) /
		(GRNFuel::AirFuelRatio * GRNFuel::PetrolGramsPerLitre);
}

// --------------------------------------------------------------- forecourts
// Both are on the Second Ring: widening the road opens the barrier on
// both sides, which inland means more tarmac and on the corniche would
// mean a lane of asphalt over the beach.

struct FGRNStation { float S; float Lat; };
static const FGRNStation GRNStations[] = {
${stations.map((st) => `\t{ ${cppf(st.s)}, ${cppf(st.lat)} },`).join("\n")}
};
static const int32 GRNStationCount = UE_ARRAY_COUNT(GRNStations);
/** How far a forecourt reaches along the road, and how much wider it
 *  makes the carriageway. */
constexpr float GRNForecourtHalfSpan = ${cppf(forecourt.halfSpan)};
constexpr float GRNForecourtExtraWidth = ${cppf(forecourt.extraWidth)};

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
    `${engines.length} engines, ${cars.length} cars, ${stations.length} stations, ` +
    `${handlingKeys.length} handling constants, ` +
    `${rigKeys.length} rig constants.`
);
