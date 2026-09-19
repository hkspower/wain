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

import { readFileSync, readdirSync } from "node:fs";

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
// The handling and rig constants moved into their own engine-free
// header so GRNSim.h can include them without pulling in CoreMinimal.h.
// Read as one document: what this checks is whether the UE side agrees
// with the web build, and which file a constant sits in is bookkeeping.
const header =
  readFileSync(HEADER, "utf8") +
  "\n" +
  readFileSync("unreal/Source/GulfRoadNights/GRNSimConstants.h", "utf8");

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
  /\{ TEXT\("([^"]+)"\), TEXT\("[^"]*"\), TEXT\("([^"]+)"\), TEXT\("[^"]*"\), FColor\(0x(\w\w), 0x(\w\w), 0x(\w\w)\), ([\d.]+)f, EGRNBodyStyle::(\w+), TEXT\("([\w-]*)"\) \},/g
)].map(([, name, crew, r, g, b, top, style, carId]) => ({
  name,
  crew,
  color: `#${(r + g + b).toLowerCase()}`,
  top: +top,
  style: style.toLowerCase(),
  carId,
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
    // The CAR they bring, not just the silhouette. Two rivals can share
    // a body and be a third of a metre apart, and the port built every
    // one of them at the silhouette's reference length while this check
    // stayed green — the same shape of gap the trike left in the car
    // table. The factory fits both the primitive shell and any imported
    // hero body to the length on the card, so this decides the size of a
    // Fab import as well as of the primitives.
    if (h.carId !== (a.carId ?? "")) fail(`rival ${i} car: ${h.carId || "(none)"} vs ${a.carId ?? "(none)"}`);
    if (h.carId && !api.cars.some((c) => c.id === h.carId))
      fail(`rival ${i} brings ${h.carId}, which is not in the showroom`);
  }
  if (!process.exitCode) ok(`rivals: ${hRivals.length} match (name, crew, colour, top speed, body, car)`);
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
  // The drivetrain column arrived with the FWD/RWD/AWD work and this
  // pattern did not, so it stopped matching any row at all — and a
  // regex that matches nothing reports "header 0 vs api 16", which
  // reads as the header being empty rather than as the checker being
  // blind. Every field between the two is unchecked while it lasts,
  // which is the whole point of this file.
  /\{ TEXT\("([^"]+)"\), TEXT\("([^"]+)"\), (\d+), ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, FColor\([^)]*\), EGRNBodyStyle::(\w+), (true|false), (true|false), GRNSim::EDrivetrain::(\w+), (\d+), ([\d.]+)f, ([\d.]+)f, ([\d.]+)f, (\d+), TEXT\("([^"]*)"\), TEXT\("([^"]*)"\) \},/g
)].map(([, id, name, price, power, top, grip, brake, style, kit, trike, drive, engine, tank, lengthM, zeroTo100s, locked, lockedCar, factory]) => ({
  id, name, price: +price, power: +power, top: +top, grip: +grip, brake: +brake,
  style: style.toLowerCase(),
  attack: kit === "true",
  trike: trike === "true",
  drive: drive.toLowerCase(),
  engine: +engine,
  tank: +tank,
  lengthM: +lengthM,
  zeroTo100s: +zeroTo100s,
  lockedRivals: +locked,
  lockedCar,
  factoryBuild: factory ? factory.split(",") : [],
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
    // How many wheels. Nothing compared this until it was noticed that
    // nothing did: `trike` lived in src/game and nowhere else for the
    // whole life of the car that uses it, so this header — and Unity —
    // drew the Black Demon on four wheels while both checks stayed
    // green. A field that changes the silhouette belongs beside the kit.
    if (h.trike !== (a.trike ?? false)) fail(`car ${h.id} trike: ${h.trike} vs ${a.trike ?? false}`);
    // Which wheels the engine drives. The one field where a port that
    // disagrees is not slightly wrong about a number but driving a
    // different car — front and rear are opposite behaviours under
    // power, not neighbouring ones.
    if (h.drive !== (a.drive ?? "rwd")) fail(`car ${h.id} drive: ${h.drive} vs ${a.drive ?? "rwd"}`);
    // The header stores an index into GRNEngines; the API stores the id.
    if (h.tank !== a.tankLitres) fail(`car ${h.id} tankLitres: ${h.tank} vs ${a.tankLitres}`);
    // The rule that makes the rarest car rare, and the build it is sold
    // with. A port that drops either sells a different game.
    if (h.lengthM !== a.lengthM) fail(`car ${h.id} lengthM: ${h.lengthM} vs ${a.lengthM}`);
    // The launch, for the reason the Unity check gives.
    if (h.zeroTo100s !== a.zeroTo100s) {
      fail(`car ${h.id} zeroTo100s: ${h.zeroTo100s} vs ${a.zeroTo100s}`);
    }
    if (h.lockedRivals !== a.lockedRivals) {
      fail(`car ${h.id} lockedRivals: ${h.lockedRivals} vs ${a.lockedRivals}`);
    }
    // Both halves of the lock. A port reading only the count opens the
    // last car in the game to anybody who has finished the roster.
    if (h.lockedCar !== (a.lockedCar ?? "")) {
      fail(`car ${h.id} lockedCar: "${h.lockedCar}" vs "${a.lockedCar ?? ""}"`);
    }
    if (h.factoryBuild.join(",") !== a.factoryBuild.join(",")) {
      fail(`car ${h.id} factoryBuild: [${h.factoryBuild}] vs [${a.factoryBuild}]`);
    }
    if (api.engines[h.engine]?.id !== a.engine) {
      fail(`car ${h.id} engine: header index ${h.engine} (${api.engines[h.engine]?.id}) vs ${a.engine}`);
    }
  }
  if (!process.exitCode) ok(`cars: ${hCars.length} match (id, price, power, topSpeedKmh, grip, brake, body, kit, engine, tank, length, lock, factory build)`);
}

// ---- fuel and forecourts --------------------------------------------
// Petrol is an economy and a distance, so a port that disagrees about
// the pump price or the burn multiplier is a port where the same save
// runs out of money and road at different times.
{
  const hFuel = {
    rateMultiplier: +(header.match(/RateMultiplier = ([\d.]+)f/)?.[1] ?? NaN),
    filsPerLitre: +(header.match(/FilsPerLitre = (\d+)/)?.[1] ?? NaN),
    pumpLitresPerSecond: +(header.match(/PumpLitresPerSecond = ([\d.]+)f/)?.[1] ?? NaN),
    pumpMaxKmh: +(header.match(/PumpMaxKmh = ([\d.]+)f/)?.[1] ?? NaN),
    airGramsPerLitre: +(header.match(/AirGramsPerLitre = ([\d.]+)f/)?.[1] ?? NaN),
    airFuelRatio: +(header.match(/AirFuelRatio = ([\d.]+)f/)?.[1] ?? NaN),
    petrolGramsPerLitre: +(header.match(/PetrolGramsPerLitre = ([\d.]+)f/)?.[1] ?? NaN),
  };
  let bad = 0;
  for (const [k, v] of Object.entries(api.fuel)) {
    if (hFuel[k] !== v) { fail(`fuel ${k}: header ${hFuel[k]} vs api ${v}`); bad++; }
  }
  const hStations = [...header.matchAll(/^\t\{ ([\d.]+)f, ([\d.]+)f \},$/gm)].map(
    ([, s2, lat]) => ({ s: +s2, lat: +lat })
  );
  if (hStations.length !== api.track.stations.length) {
    fail(`stations: header ${hStations.length} vs api ${api.track.stations.length}`);
    bad++;
  } else {
    for (let i = 0; i < hStations.length; i++) {
      const a = api.track.stations[i];
      if (hStations[i].s !== a.s || hStations[i].lat !== a.lat) {
        fail(`station ${i}: header ${JSON.stringify(hStations[i])} vs api ${JSON.stringify(a)}`);
        bad++;
      }
    }
  }
  const hSpan = +(header.match(/GRNForecourtHalfSpan = ([\d.]+)f/)?.[1] ?? NaN);
  const hWide = +(header.match(/GRNForecourtExtraWidth = ([\d.]+)f/)?.[1] ?? NaN);
  if (hSpan !== api.track.forecourt.halfSpan || hWide !== api.track.forecourt.extraWidth) {
    fail(`forecourt: header ${hSpan}/${hWide} vs api ${api.track.forecourt.halfSpan}/${api.track.forecourt.extraWidth}`);
    bad++;
  }
  if (!bad) {
    ok(`fuel: 7 constants match, ${hStations.length} stations, forecourt ${hSpan} x ${hWide} m`);
  }
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


// The car factory's own size table, for the body-shape check below.
const FACTORY = "unreal/Source/GulfRoadNights/GRNCarFactory.cpp";
const factorySrc = readFileSync(FACTORY, "utf8");
/** `case EGRNBodyStyle::X: return 4.31f;` out of one of the two tables. */
const CPP_NAME = {
  sedan: "Sedan", zx: "ZX", gtr: "GTR", rx7: "RX7",
  hatch: "Hatch", pony: "Pony", pickup: "Pickup", super: "Super",
  suv: "SUV",
};
function ueRef(style) {
  // Mirrors styleEnum in scripts/export-unreal-data.mjs. A style missing
  // here is THIS file's gap, not the port's — see the guard below.
  const name = CPP_NAME[style];
  if (!name) return null;
  const arm = (fn) => {
    const body = factorySrc.match(new RegExp("static float " + fn + "\\(EGRNBodyStyle Style\\)[\\s\\S]*?\\n\\}"));
    if (!body) return null;
    if (style === "sedan") {
      const d = body[0].match(/default: return ([0-9.]+)f;/);
      return d ? +d[1] : null;
    }
    const m2 = body[0].match(new RegExp("case EGRNBodyStyle::" + name + ": return ([0-9.]+)f;"));
    return m2 ? +m2[1] : null;
  };
  const l = arm("StyleRefLength");
  const w = arm("StyleRefWidth");
  return l !== null && w !== null ? { l, w } : null;
}

// ---- the tyre -------------------------------------------------------
//
// One number that all three builds had invented separately: 0.40 here,
// 0.33 in Unity, 0.375 in the web. It is published now, so it is checked
// — in both ports, against the same field.
{
  const want = api.bodyShape?.tyreRadiusM;
  const got = +factorySrc.match(/GRN_TYRE_RADIUS_M = ([\d.]+)f;/)?.[1];
  if (want === undefined) fail("the API no longer publishes bodyShape.tyreRadiusM");
  else if (!(Math.abs(got - want) < 1e-6)) fail(`tyre radius: Unreal ${got} m vs web ${want} m`);
  else if (/SpeedMs \/ 0\.\d+f/.test(factorySrc) || /W\.Y, 0\.\d+f \* K/.test(factorySrc)) {
    fail("GRNCarFactory still has a hand-typed tyre radius beside the published one");
  } else ok(`tyre: ${want} m, and the factory reads it in both the size and the spin`);
}

// ---- body shape -----------------------------------------------------
//
// The size of a car, which both ports were guessing at and guessing
// differently. Unreal was the blunter of the two: ONE width, 1.9 m
// before its presence factor, for every machine in the game — a
// supermini and a pickup came out of the factory the same width — and
// two lengths, one for the fastbacks and one for everything else.
// Nothing showed it, because nothing was looking.
//
// The web publishes the LAW rather than a table of answers: the
// reference machine per silhouette and the exponent a width follows a
// length by. A car added to the roster is then sized correctly by a port
// that has never heard of it.
{
  const shape = api.bodyShape;
  if (!shape || !shape.reference) {
    fail("bodyShape: the API is not publishing the size law");
  } else {
    let shapeOk = true;
    const mm = factorySrc.match(/GRN_WIDTH_FOLLOWS_LENGTH = ([0-9.]+)f *\/ *([0-9.]+)f;/);
    const exp = mm ? +mm[1] / +mm[2] : null;
    if (exp === null) {
      fail(`bodyShape: no width exponent in ${FACTORY}`);
      shapeOk = false;
    } else if (Math.abs(exp - shape.lengthExponent) > 1e-4) {
      fail(`bodyShape: ${FACTORY} follows length by ${exp}, the API says ${shape.lengthExponent}`);
      shapeOk = false;
    }
    const styles = Object.keys(shape.reference);
    for (const style of styles) {
      const got = ueRef(style);
      const want = shape.reference[style];
      if (!got) {
  fail(
          CPP_NAME[style]
            ? `bodyShape: ${style} has no reference machine in ${FACTORY} — it falls through to the saloon`
            : `bodyShape: this checker has no C++ name for "${style}" — add it to CPP_NAME`
        );
        shapeOk = false;
        continue;
      }
      if (Math.abs(got.l - want.l) > 1e-3 || Math.abs(got.w - want.w) > 1e-3) {
        fail(`bodyShape ${style}: ${FACTORY} has ${got.l} x ${got.w} m, the API says ${want.l} x ${want.w}`);
        shapeOk = false;
      }
    }
    // And the factory has to USE it, or the table is correct and unread —
    // which is exactly the state the old constants were in.
    if (!/CarWidth = RefWidth \* FMath::Pow\(CarLen \/ RefLen/.test(factorySrc)) {
      fail(`bodyShape: ${FACTORY} carries the table but does not build from it`);
      shapeOk = false;
    }
    if (shapeOk) ok(`body shape: ${styles.length} silhouettes match, and the factory builds from them`);
  }
}

if (process.exitCode) {
  console.error("\nRun `npm run sync:unreal` to regenerate the header from the web source.");
} else {
  console.log("\nWeb API and Unreal header are in sync.");
}

// --- Does the generated header reference only what it declares?
//
// The mirror of the Unity check, and it exists for the same reason: the
// enum and the lookup that names its members were two separate literals,
// and on the Unity side they had already drifted into C# that did not
// compile. Both are generated from one map now; this makes sure it stays
// that way.
{
  const hh = readFileSync(HEADER, "utf8");
  const decl = hh.match(/enum class EGRNBodyStyle : uint8 \{([^}]*)\}/);
  if (!decl) {
    console.error("GRNTypes.h has no EGRNBodyStyle enum");
    process.exitCode = 1;
  } else {
    const declared = new Set(decl[1].split(",").map((x) => x.trim()).filter(Boolean));
    // Across the WHOLE module, not just the generated header. The
    // enumerators the hand-written sources name were unchecked, and
    // GRNHeroArt.cpp's table is a list of them — `::Suv` for `::SUV`
    // compiles nowhere and would have been found by running the editor,
    // which nothing here can do.
    const DIR = "unreal/Source/GulfRoadNights";
    const module = readdirSync(DIR)
      .filter((f) => /\.(h|cpp)$/.test(f))
      .map((f) => readFileSync(`${DIR}/${f}`, "utf8"))
      .join("\n");
    const used = new Set([...module.matchAll(/EGRNBodyStyle::(\w+)/g)].map((m) => m[1]));
    const missing = [...used].filter((u) => !declared.has(u));
    if (missing.length) {
      console.error(
        `the port names EGRNBodyStyle::${missing.join(", EGRNBodyStyle::")} but the enum ` +
          `declares only { ${[...declared].join(", ")} } — that does not compile.`
      );
      process.exitCode = 1;
    } else {
      console.log(`✓ EGRNBodyStyle: ${used.size} used across the module, all of ${declared.size} declared`);
    }
  }
}

// ---- the hand-written port must compile against the header it is given
//
// Everything above compares the generated header with the API: two
// artefacts that are BOTH written by the generator, so they agree by
// construction and agreeing proves very little. What nothing checked is
// the half that is written by hand — GRNVehiclePawn.cpp, GRNRival.cpp,
// GRNDriverRig.cpp — against the constants the generator hands them.
//
// That gap is not hypothetical. The web build moved the driver's
// look-ahead from a flat distance to a time (rig.ts lost lookAheadM and
// gained lookAheadS/MinM/MaxM); sync:unreal duly regenerated the header
// without DriverLookAheadM; and two call sites went on naming it. Every
// check in this file stayed green for as long as that was true, because
// every check in this file was looking at the other two artefacts. The
// UE5 project simply did not compile, and nothing here could say so —
// this repository has no Unreal toolchain, by its own README's account.
//
// A compiler is not needed to catch it. A reference to a constant that
// the generated header does not define is a build error, and both sides
// of that are plain text. Comments and string literals are stripped
// first, so prose naming a constant is prose.
{
  const DIR = "unreal/Source/GulfRoadNights";
  const GENERATED = new Set(["GRNTypes.h", "GRNSimConstants.h"]);
  const files = readdirSync(DIR).filter((f) => /\.(h|cpp)$/.test(f));

  // What the generated headers define, per namespace.
  const defined = {};
  for (const g of files.filter((f) => GENERATED.has(f))) {
    let ns = null;
    for (const line of readFileSync(`${DIR}/${g}`, "utf8").split("\n")) {
      const open = line.match(/^namespace (\w+)/);
      if (open) { ns = open[1]; defined[ns] ??= new Set(); }
      const c = line.match(/constexpr\s+\w+\s+(\w+)\s*=/);
      if (c && ns) defined[ns].add(c[1]);
    }
  }

  const strip = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const missing = [];
  let refs = 0;
  for (const f of files.filter((f) => !GENERATED.has(f))) {
    strip(readFileSync(`${DIR}/${f}`, "utf8")).split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/\b(GRNRig|GRNHandling|GRNFuel|GRNExact)::(\w+)/g)) {
        refs++;
        if (!defined[m[1]]?.has(m[2])) missing.push(`${f}:${i + 1} names ${m[1]}::${m[2]}`);
      }
    });
  }
  for (const m of missing) fail(`the port does not compile: ${m}, which the generated header does not define`);
  if (!missing.length) {
    ok(`port sources: ${refs} references to generated constants, all defined`);
  }

  // And the other direction, reported rather than failed: a generated
  // constant no port source reads is a number kept in step with nothing.
  // Most are features the port has not ported — the plants, the fuel
  // model, the gearbox's shift timing — and that is a fair state for a
  // port to be in. It is worth printing because the IK joint limits and
  // the reach softening sat in this list too, generated and verified and
  // read by nobody, which is how the driver's elbows could lock straight
  // in one engine and not the other with every check passing.
  const src = files.filter((f) => !GENERATED.has(f))
    .map((f) => strip(readFileSync(`${DIR}/${f}`, "utf8"))).join("\n");
  let total = 0;
  const unread = [];
  for (const [ns, names] of Object.entries(defined)) {
    if (ns === "GRNExact") continue; // the double-precision twins, for GRNSim.h's own use
    for (const n of names) {
      total++;
      if (!new RegExp(`\\b${n}\\b`).test(src)) unread.push(`${ns}::${n}`);
    }
  }
  ok(`generated constants: ${total - unread.length}/${total} read by a port source, ${unread.length} unread`);
}

// ---- the imported-art table, and the factory that wears it ----------
//
// GRNHeroArt.cpp maps each silhouette to a mesh in the project's own
// Content/, which nothing outside the editor can resolve — the paths are
// unverifiable here by construction. What IS checkable is their shape,
// and the shape is where the mistakes are: a path that is not
// Package.Asset, a slot index that is not a slot, one silhouette listed
// twice. Each of those is a line nobody would notice until a car came
// out grey in the editor.
{
  const ART = "unreal/Source/GulfRoadNights/GRNHeroArt.cpp";
  const FACTORY = "unreal/Source/GulfRoadNights/GRNCarFactory.cpp";
  const art = readFileSync(ART, "utf8");
  const table = art.match(/GRNHeroArtTable\[\] =\s*\{([\s\S]*?)\n\t\};/)?.[1];
  if (!table) {
    fail(`${ART} no longer has a GRNHeroArtTable this check can read`);
  } else {
    const styles = [];
    for (const row of table.matchAll(/\{\s*EGRNBodyStyle::(\w+),\s*TEXT\("([^"]+)"\)([\s\S]*?)\},/g)) {
      const [, style, path, rest] = row;
      styles.push(style);
      // /Game/Path/Thing.Thing — the trailing object name is the half
      // everyone forgets, and a path without it silently resolves to
      // nothing.
      if (!path.startsWith("/Game/")) fail(`hero art for ${style} is ${path}, which is not under /Game/`);
      const m = path.match(/\/([^/.]+)\.([^/.]+)$/);
      if (!m) fail(`hero art for ${style} is ${path}, which is not Package.Asset`);
      else if (m[1] !== m[2]) {
        fail(`hero art for ${style} is ${path} — the asset name after the dot must repeat the package leaf`);
      }
      for (const n of rest.matchAll(/(-?\d+)/g)) {
        if (+n[1] < -1) fail(`hero art for ${style} has a material slot of ${n[1]}; -1 means "leave it alone"`);
      }
    }
    const dupes = styles.filter((s, i) => styles.indexOf(s) !== i);
    if (dupes.length) fail(`hero art lists ${dupes[0]} more than once — only the first would ever be used`);
    if (!process.exitCode) ok(`hero art: ${styles.length} silhouettes mapped (${styles.join(", ")}), paths well-formed`);
  }

  // The wheel diameter is DERIVED from the radius the web build
  // publishes, in both the hero and the primitive branch. It was typed
  // as 0.8 in both — which is not 2 x 0.375 — so an imported wheel sat
  // 6.67% oversize and the primitive one was an ellipse. The existing
  // tyre rule above guards the radius; this guards the doubling.
  // Comments stripped first. Both rules below are presence tests, and a
  // presence test on raw source is satisfied by prose — the comment
  // above the call explains what CreateDynamicMaterialInstance does, so
  // deleting the call itself and keeping the comment passed. Found by
  // planting that exact fault.
  const factory = readFileSync(FACTORY, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  const derived = [...factory.matchAll(/2\.f \* GRN_TYRE_RADIUS_M \* K/g)].length;
  if (derived < 3) {
    fail(`${FACTORY} derives the wheel diameter ${derived} times; the hero fit and both primitive axes need it`);
  }
  if (/0\.8f \* K/.test(factory)) {
    fail(`${FACTORY} still types 0.8f * K for a wheel — that is a third hand-written tyre radius`);
  }

  // The paint MID must be made FROM the art's own material. Assigning a
  // MID of the engine cube's material over an imported slot is what
  // rendered a scanned car flat grey, and it is a one-word regression.
  if (!/CreateDynamicMaterialInstance/.test(factory)) {
    fail(`${FACTORY} no longer creates a dynamic instance of the art's own material — an import would render grey`);
  }
  if (/Shell->SetMaterial\(/.test(factory)) {
    fail(`${FACTORY} assigns a material over a hero body's slot again; use CreateDynamicMaterialInstance`);
  }
  if (!process.exitCode) ok("hero bodies keep their own material, and the wheel diameter is derived");
}
