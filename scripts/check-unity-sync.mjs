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
const SHAPE_FILE = "unity/Assets/Scripts/CarFactory.cs";
const DATA_SHAPE = SHAPE_FILE;
const shapeSrc = readFileSync(SHAPE_FILE, "utf8");
/** One `case BodyStyle.X: return new Reference { L = ..f, W = ..f };` */
function unityRef(s, style) {
  const name = { sedan: "Sedan", zx: "ZX", gtr: "GTR", rx7: "RX7", hatch: "Hatch", pony: "Pony" }[style];
  if (!name) return null;
  const m = s.match(
    new RegExp("case BodyStyle\\." + name + ": return new Reference \\{ L = ([0-9.]+)f, W = ([0-9.]+)f \\};")
  );
  // The saloon is the default arm rather than a case of its own.
  if (!m && style === "sedan") {
    const d = s.match(/default: return new Reference \{ L = ([0-9.]+)f, W = ([0-9.]+)f \};/);
    return d ? { l: +d[1], w: +d[2] } : null;
  }
  return m ? { l: +m[1], w: +m[2] } : null;
}


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

const lanes = (src.match(/Lanes = \{ ([^}]+) \}/)?.[1] ?? "")
  .split(",")
  .map((v) => parseFloat(v));
if (lanes.length !== api.track.lanes.length || lanes.some((v, i) => v !== api.track.lanes[i])) {
  fail(`lanes: [${lanes}] vs [${api.track.lanes}]`);
}

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
  arabic: field(b, /ArabicName = "([^"]*)"/),
  accent: field(b, /Accent = Hex\(0x([0-9A-F]{6})\)/),
  intro: field(b, /IntroAr = "([^"]*)"/),
  win: field(b, /WinAr = "([^"]*)"/),
  lose: field(b, /LoseAr = "([^"]*)"/),
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
    if (u.arabic !== a.arabicName) fail(`rival ${a.id} Arabic name differs`);
    if (`#${u.accent.toLowerCase()}` !== a.accentColor) {
      fail(`rival ${a.id} accent: #${u.accent.toLowerCase()} vs ${a.accentColor}`);
    }
    // The spoken lines are the whole character; a truncated one is a bug
    if (u.intro !== a.lines.intro) fail(`rival ${a.id} intro line differs`);
    if (u.win !== a.lines.win) fail(`rival ${a.id} win line differs`);
    if (u.lose !== a.lines.lose) fail(`rival ${a.id} lose line differs`);
  }
  if (!failed) ok(`rivals: ${rivals.length} match (id, names, crew, area, both colours, speed, body, prize, all 3 voice lines)`);
}

// ---- engines --------------------------------------------------------
// Every parameter of the curve, because the curve IS the engine. One
// stale hundredth of `breadth` and this port is racing a different car.
const engineBlocks = src.split("new Engine {").slice(1);
const engines = engineBlocks.map((b) => ({
  id: field(b, /Id = "([^"]*)"/),
  cylinders: +field(b, /Cylinders = (\d+)/),
  layout: field(b, /Layout = EngineLayout\.(\w+)/).toLowerCase(),
  litres: +field(b, /Litres = ([\d.]+)f/),
  idleRpm: +field(b, /IdleRpm = ([\d.]+)f/),
  redlineRpm: +field(b, /RedlineRpm = ([\d.]+)f/),
  peakAt: +field(b, /PeakAt = ([\d.]+)f/),
  breadth: +field(b, /Breadth = ([\d.]+)f/),
  floor: +field(b, /Floor = ([\d.]+)f/),
  powerMult: +field(b, /PowerMult = ([\d.]+)f/),
  massKg: +field(b, /MassKg = (-?[\d.]+)f/),
  subMix: +field(b, /SubMix = ([\d.]+)f/),
  lopeDepth: +field(b, /LopeDepth = ([\d.]+)f/),
  price: +field(b, /Price = (\d+)/),
  norm: +field(b, /Norm = ([\d.]+)f/),
}));
if (engines.length !== api.engines.length) {
  fail(`engines: Unity ${engines.length} vs api ${api.engines.length}`);
} else {
  const FIELDS = ["cylinders", "layout", "litres", "idleRpm", "redlineRpm", "peakAt",
    "breadth", "floor", "powerMult", "massKg", "subMix", "lopeDepth", "price"];
  for (let i = 0; i < engines.length; i++) {
    const u = engines[i];
    const a = api.engines[i];
    if (u.id !== a.id) fail(`engine ${i} id: ${u.id} vs ${a.id}`);
    for (const k of FIELDS) {
      if (u[k] !== a[k]) fail(`engine ${a.id} ${k}: ${u[k]} vs ${a[k]}`);
    }
    // Norm is derived, so it is recomputed here rather than trusted.
    const N = 256, MIN = 0.12;
    let sum = 0;
    for (let j = 0; j < N; j++) {
      const r = MIN + ((1 - MIN) * (j + 0.5)) / N;
      const d = r - a.peakAt;
      sum += a.floor + (1 - a.floor) * Math.exp(-(d * d) / (2 * a.breadth * a.breadth));
    }
    if (Math.abs(u.norm - sum / N) > 5e-6) {
      fail(`engine ${a.id} norm: Unity ${u.norm} vs ${(sum / N).toFixed(6)}`);
    }
  }
  if (!failed) {
    ok(`engines: ${engines.length} match (13 fields each, plus the baked curve normalisation)`);
  }
}

// ---- cars -----------------------------------------------------------
const carBlocks = src.split("new Car {").slice(1);
const cars = carBlocks.map((b) => ({
  id: field(b, /Id = "([^"]*)"/),
  name: field(b, /Name = "([^"]*)"/),
  price: +field(b, /Price = (\d+)/),
  power: +field(b, /Power = ([\d.]+)f/),
  top: +field(b, /TopSpeedKmh = ([\d.]+)f/),
  grip: +field(b, /Grip = ([\d.]+)f/),
  brake: +field(b, /Brake = ([\d.]+)f/),
  paint: field(b, /Paint = Hex\(0x([0-9A-F]{6})\)/),
  style: field(b, /Style = BodyStyle\.(\w+)/),
  kit: field(b, /AttackKit = (true|false)/) === "true",
  drive: (field(b, /Drive = (?:GRNSim\.)?Drivetrain\.(\w+)/) || "RWD").toLowerCase(),
  engine: +field(b, /Engine = (\d+)/),
  tank: +field(b, /TankLitres = ([\d.]+)f/),
  lengthM: +field(b, /LengthM = ([\d.]+)f/),
  lockedRivals: +(b.match(/LockedRivals = (\d+)/)?.[1] ?? 0),
  factoryBuild: [...(b.match(/FactoryBuild = new\[\] \{([^}]*)\}/)?.[1] ?? "")
    .matchAll(/"([^"]+)"/g)].map((m) => m[1]),
}));

if (cars.length !== api.cars.length) {
  fail(`cars: Unity ${cars.length} vs api ${api.cars.length}`);
} else {
  for (let i = 0; i < cars.length; i++) {
    const u = cars[i];
    const a = api.cars[i];
    if (u.id !== a.id) fail(`car ${i} id: ${u.id} vs ${a.id}`);
    if (u.name !== a.name) fail(`car ${a.id} name: ${u.name} vs ${a.name}`);
    if (u.price !== a.price) fail(`car ${a.id} price: ${u.price} vs ${a.price}`);
    if (u.power !== a.power) fail(`car ${a.id} power: ${u.power} vs ${a.power}`);
    if (u.top !== a.topSpeedKmh) fail(`car ${a.id} topSpeedKmh: ${u.top} vs ${a.topSpeedKmh}`);
    if (u.grip !== a.grip) fail(`car ${a.id} grip: ${u.grip} vs ${a.grip}`);
    if (u.brake !== a.brake) fail(`car ${a.id} brake: ${u.brake} vs ${a.brake}`);
    if (u.style.toLowerCase() !== a.bodyStyle) {
      fail(`car ${a.id} body style: ${u.style.toLowerCase()} vs ${a.bodyStyle}`);
    }
    if (u.tank !== a.tankLitres) fail(`car ${a.id} tankLitres: ${u.tank} vs ${a.tankLitres}`);
    if (api.engines[u.engine]?.id !== a.engine) {
      fail(`car ${a.id} engine: Unity index ${u.engine} (${api.engines[u.engine]?.id}) vs ${a.engine}`);
    }
    if (`#${u.paint.toLowerCase()}` !== a.color) {
      fail(`car ${a.id} paint: #${u.paint.toLowerCase()} vs ${a.color}`);
    }
    if (u.kit !== (a.kit === "attack")) fail(`car ${a.id} attack kit: ${u.kit} vs ${a.kit}`);
    // The C++ side had this checked and this one did not, which is the
    // asymmetry that lets one port drift: front and rear drive are
    // opposite behaviours under power, not neighbouring numbers.
    if (u.drive !== (a.drive ?? "rwd")) fail(`car ${a.id} drive: ${u.drive} vs ${a.drive ?? "rwd"}`);
    // The rule that makes the rarest car rare, and the build it is sold
    // with. A port that drops either sells a different game.
    if (u.lengthM !== a.lengthM) fail(`car ${a.id} lengthM: ${u.lengthM} vs ${a.lengthM}`);
    if (u.lockedRivals !== a.lockedRivals) {
      fail(`car ${a.id} lockedRivals: ${u.lockedRivals} vs ${a.lockedRivals}`);
    }
    if (u.factoryBuild.join(",") !== a.factoryBuild.join(",")) {
      fail(`car ${a.id} factoryBuild: [${u.factoryBuild}] vs [${a.factoryBuild}]`);
    }
  }
  if (!failed) ok(`cars: ${cars.length} match (id, name, price, power, speed, grip, brake, body, kit, drive, engine, tank, length, lock, factory build)`);
}

// ---- fuel and forecourts --------------------------------------------
{
  const uFuel = {
    rateMultiplier: +field(src, /RateMultiplier = ([\d.]+)f/),
    filsPerLitre: +field(src, /FilsPerLitre = (\d+)/),
    pumpLitresPerSecond: +field(src, /PumpLitresPerSecond = ([\d.]+)f/),
    pumpMaxKmh: +field(src, /PumpMaxKmh = ([\d.]+)f/),
    airGramsPerLitre: +field(src, /AirGramsPerLitre = ([\d.]+)f/),
    airFuelRatio: +field(src, /AirFuelRatio = ([\d.]+)f/),
    petrolGramsPerLitre: +field(src, /PetrolGramsPerLitre = ([\d.]+)f/),
  };
  const before = failed;
  for (const [k, v] of Object.entries(api.fuel)) {
    if (uFuel[k] !== v) fail(`fuel ${k}: Unity ${uFuel[k]} vs api ${v}`);
  }
  const uStations = [...src.matchAll(/new Station \{ S = ([\d.]+)f, Lat = ([\d.]+)f \}/g)].map(
    ([, s2, lat]) => ({ s: +s2, lat: +lat })
  );
  if (uStations.length !== api.track.stations.length) {
    fail(`stations: Unity ${uStations.length} vs api ${api.track.stations.length}`);
  } else {
    for (let i = 0; i < uStations.length; i++) {
      const a = api.track.stations[i];
      if (uStations[i].s !== a.s || uStations[i].lat !== a.lat) {
        fail(`station ${i}: Unity ${JSON.stringify(uStations[i])} vs api ${JSON.stringify(a)}`);
      }
    }
  }
  const uSpan = +field(src, /ForecourtHalfSpan = ([\d.]+)f/);
  const uWide = +field(src, /ForecourtExtraWidth = ([\d.]+)f/);
  if (uSpan !== api.track.forecourt.halfSpan || uWide !== api.track.forecourt.extraWidth) {
    fail(`forecourt: Unity ${uSpan}/${uWide} vs api ${api.track.forecourt.halfSpan}/${api.track.forecourt.extraWidth}`);
  }
  if (failed === before) {
    ok(`fuel: 7 constants match, ${uStations.length} stations, forecourt ${uSpan} x ${uWide} m`);
  }
}

// ---- handling -------------------------------------------------------
// Walked from the payload rather than a hand-written list: this used to
// name sixteen constants while the file carried seventy-four, so a whole
// physics subsystem could be published wrong and still print a tick.
{
  const csNs = src.match(/public static class Handling\s*\{([\s\S]*?)\n {4}\}/)?.[1];
  if (!csNs) {
    fail("handling: class Handling missing from GRNData.cs");
  } else {
    const cs = new Map(
      [...csNs.matchAll(/public const float (\w+) = (-?[\d.]+)f;/g)].map(([, k, v]) => [k, +v])
    );
    const want = {};
    for (const [k, v] of Object.entries(api.handling)) {
      want[k[0].toUpperCase() + k.slice(1)] = v;
    }
    let handlingOk = true;
    for (const [k, v] of Object.entries(want)) {
      if (!cs.has(k)) { fail(`handling ${k} missing from GRNData.cs`); handlingOk = false; }
      // Without this, a key the API stops publishing compares against
      // undefined, Math.abs(NaN) > 1e-6 is false, and the check passes.
      else if (typeof v !== "number") { fail(`handling ${k} is not a number in the API payload`); handlingOk = false; }
      else if (Math.abs(cs.get(k) - v) > 1e-6 * Math.max(1, Math.abs(v))) {
        fail(`handling ${k}: GRNData.cs ${cs.get(k)} vs web ${v}`);
        handlingOk = false;
      }
    }
    for (const k of cs.keys()) {
      if (!(k in want)) { fail(`handling ${k} is in GRNData.cs but not the web build`); handlingOk = false; }
    }
    if (handlingOk) ok(`handling: ${Object.keys(want).length} constants match`);
  }
}

// ---- body shape -----------------------------------------------------
//
// The size of a car, which both ports were guessing at and guessing
// differently.
//
// Unity carried a hand-typed table of four shapes and built every car of
// a silhouette at one size, so a 3.95 m hatch and a 4.70 m saloon came
// out identical — and the hatch and the pony were not in the table at
// all, so both fell through to the saloon. Unreal was blunter: ONE
// width, 1.9 m before its presence factor, for every machine in the
// game. None of it showed up here, because nothing was looking.
//
// The web publishes the LAW rather than a table of answers — the
// reference machine per silhouette and the exponent a width follows a
// length by — so a car added to the roster is sized correctly by a port
// that has never heard of it. This checks that both ports carry the same
// law and the same references, and that every silhouette has its own
// entry rather than falling through to a default.
{
  const shape = api.bodyShape;
  if (!shape || !shape.reference) {
    fail("bodyShape: the API is not publishing the size law");
  } else {
    const styles = Object.keys(shape.reference);
    let shapeOk = true;
    const exp = (() => { const m = shapeSrc.match(/WidthFollowsLength = ([0-9.]+)f *\/ *([0-9.]+)f;/); return m ? +m[1] / +m[2] : null; })();
    if (exp === null) {
      fail(`bodyShape: no width exponent found in ${DATA_SHAPE}`);
      shapeOk = false;
    } else if (Math.abs(exp - shape.lengthExponent) > 1e-4) {
      fail(`bodyShape: ${DATA_SHAPE} follows length by ${exp}, the API says ${shape.lengthExponent}`);
      shapeOk = false;
    }
    for (const style of styles) {
      const got = unityRef(shapeSrc, style);
      const want = shape.reference[style];
      if (!got) {
        fail(`bodyShape: ${style} has no reference machine in ${DATA_SHAPE} — it falls through to the saloon`);
        shapeOk = false;
        continue;
      }
      if (Math.abs(got.l - want.l) > 1e-3 || Math.abs(got.w - want.w) > 1e-3) {
        fail(
          `bodyShape ${style}: ${DATA_SHAPE} has ${got.l} x ${got.w} m, the API says ${want.l} x ${want.w}`
        );
        shapeOk = false;
      }
    }
    // And the law, applied: every car on the roster comes out the width
    // the web builds it at. This is the claim a player would notice.
    let worst = 0;
    let worstCar = "";
    for (const car of api.cars) {
      const r = shape.reference[car.bodyStyle];
      if (!r) continue;
      const want = r.w * Math.pow(car.lengthM / r.l, shape.lengthExponent);
      const got = unityRef(shapeSrc, car.bodyStyle);
      if (!got) continue;
      const mine = got.w * Math.pow(car.lengthM / got.l, exp ?? 0);
      const off = Math.abs(mine - want);
      if (off > worst) { worst = off; worstCar = car.name; }
    }
    if (worst > 0.002) {
      fail(`bodyShape: ${worstCar} would be built ${(worst * 1000).toFixed(0)} mm off the web's width`);
      shapeOk = false;
    }
    if (shapeOk) {
      ok(
        `body shape: ${styles.length} silhouettes match, and the law with them ` +
          `(applied across the roster, ${(worst * 1000).toFixed(1)} mm of drift — which follows ` +
          `from the table matching rather than proving anything on its own)`
      );
    }
  }
}

// The verdict lives at the BOTTOM of this file, and it has to. It used
// to sit here, so it printed "in sync" before the last checks had run —
// and everything added after it was reported on by nothing at all.

// ---- rig ------------------------------------------------------------
//
// The Unreal port has checked its rig since it was written; Unity had no
// rig at all, so a driver built in the C# client was built to whatever
// numbers whoever wrote CarFactory had in mind that day. Same flattening
// rule as the UE5 header (driver.upperArm -> DriverUpperArm), so the two
// ports can be read against each other.
{
  const want = {};
  for (const [group, fields] of Object.entries(api.rig ?? {})) {
    for (const [k, v] of Object.entries(fields)) {
      want[`${group[0].toUpperCase()}${group.slice(1)}${k[0].toUpperCase()}${k.slice(1)}`] = v;
    }
  }
  const block = src.match(/public static class Rig\s*\{([\s\S]*?)\n    \}/);
  if (!block) fail("rig: GRNData.cs has no Rig class");
  else {
    const cs = new Map(
      [...block[1].matchAll(/public const float (\w+) = ([-\d.eE]+)f;/g)].map((m) => [m[1], +m[2]])
    );
    let rigOk = true;
    for (const [k, v] of Object.entries(want)) {
      if (!cs.has(k)) { fail(`rig ${k} missing from GRNData.cs`); rigOk = false; }
      // Tolerance is the float32 the C# stores against the double the
      // API sends: PI * 0.72 does not survive the trip exactly, and
      // demanding that it does would report a rounding as a drift.
      else if (Math.abs(cs.get(k) - v) > Math.max(1e-6, Math.abs(v) * 1e-6)) {
        fail(`rig ${k}: Unity ${cs.get(k)} vs web ${v}`);
        rigOk = false;
      }
    }
    for (const k of cs.keys()) {
      if (!(k in want)) { fail(`rig ${k} is in GRNData.cs but not in the web build`); rigOk = false; }
    }
    if (rigOk) ok(`rig: ${Object.keys(want).length} bone and joint constants match`);
  }
}

// ---- the tyre -------------------------------------------------------
//
// One number, and it was different in all three builds: 0.33 in Unity,
// 0.40 in Unreal, 0.375 in the web. Checked here AND checked for being
// generated rather than typed, because the failure was never the value
// — it was that a port is allowed to hold its own copy at all.
{
  const want = api.bodyShape?.tyreRadiusM;
  const got = +src.match(/public const float TyreRadius = ([\d.]+)f;/)?.[1];
  if (want === undefined) fail("the API no longer publishes bodyShape.tyreRadiusM");
  else if (!(Math.abs(got - want) < 1e-6)) fail(`tyre radius: Unity ${got} m vs web ${want} m`);
  else {
    const factory = readFileSync(SHAPE_FILE, "utf8");
    const wired = /public const float WheelRadius = GRNData\.TyreRadius;/.test(factory);
    if (!wired) {
      fail("CarFactory.WheelRadius is a hand-typed number again — it must read GRNData.TyreRadius");
    } else ok(`tyre: ${want} m, and CarFactory reads it rather than holding its own`);
  }
}

// ---- the showroom ---------------------------------------------------
//
// Ninety-eight parts — the whole garage economy — and until now neither
// port carried one of them, so nothing could have noticed a price
// changing on one side of the wire and not the other.
{
  const want = new Map((api.parts ?? []).map((p) => [p.id, p]));
  const cs = new Map(
    [...src.matchAll(/new Part \{ Id = "([^"]+)", Cat = "([^"]+)", Price = (\d+) \}/g)]
      .map((m) => [m[1], { cat: m[2], price: +m[3] }])
  );
  let partsOk = true;
  if (cs.size !== want.size) {
    fail(`parts: Unity has ${cs.size}, the web sells ${want.size}`);
    partsOk = false;
  }
  for (const [id, p] of want) {
    const u = cs.get(id);
    if (!u) { fail(`part ${id} missing from GRNData.cs`); partsOk = false; continue; }
    if (u.cat !== p.cat) { fail(`part ${id}: Unity slot "${u.cat}" vs web "${p.cat}"`); partsOk = false; }
    if (u.price !== p.price) { fail(`part ${id}: Unity ${u.price} KD vs web ${p.price} KD`); partsOk = false; }
  }
  for (const id of cs.keys()) {
    if (!want.has(id)) { fail(`part ${id} is in GRNData.cs but the web does not sell it`); partsOk = false; }
  }
  if (partsOk) ok(`parts: ${want.size} match (id, slot, price)`);
}

// ---- the paints -----------------------------------------------------
{
  const want = new Map((api.palette?.paints ?? []).map((p) => [p.id, p.color.toLowerCase()]));
  const cs = new Map(
    [...src.matchAll(/new Paint \{ Id = "([^"]+)", Color = Hex\(0x([0-9a-fA-F]{6})\) \}/g)]
      .map((m) => [m[1], `#${m[2].toLowerCase()}`])
  );
  let paintOk = true;
  if (cs.size !== want.size) {
    fail(`paints: Unity has ${cs.size}, the web offers ${want.size}`);
    paintOk = false;
  }
  for (const [id, hex] of want) {
    if (!cs.has(id)) { fail(`paint ${id} missing from GRNData.cs`); paintOk = false; }
    else if (cs.get(id) !== hex) { fail(`paint ${id}: Unity ${cs.get(id)} vs web ${hex}`); paintOk = false; }
  }
  if (paintOk) ok(`paints: ${want.size} match (id and colour)`);
}

// ---- nothing is quietly unchecked ------------------------------------
//
// The reason this block exists: before it, this file checked eight of
// the fifteen things the web publishes and said "in sync" — the parts
// catalogue, the palette, the rig, the carbon table and the social runs
// were all outside it, and the report gave no hint that they were. A
// check that covers most of a contract and reports like it covers all of
// it is worse than one that admits its scope.
//
// So every key the API publishes must be named here, exactly once, as
// either CHECKED above or DECLARED ABSENT with the reason the Unity port
// does not carry it. Add a section to the API and this goes red until
// somebody decides which it is — which is the only way "check all" stays
// true after today.
{
  const CHECKED = [
    "apiVersion", "track", "rivals", "engines", "cars", "fuel",
    "handling", "bodyShape", "rig", "parts", "palette",
  ];
  const ABSENT = {
    game: "the title string; nothing in the port renders it from data",
    generatedAt: "a timestamp on the response, not game data — it differs on every request by design",
    carbon: "the carbon-saving readout is a web/hub feature; the Unity client has no results screen that shows it",
    runs: "the social runs are scored by the hub against other players online, which the offline Unity client does not join",
  };
  const keys = Object.keys(api);
  const unclaimed = keys.filter((k) => !CHECKED.includes(k) && !(k in ABSENT));
  const stale = [...CHECKED, ...Object.keys(ABSENT)].filter((k) => !keys.includes(k));
  if (unclaimed.length) {
    fail(
      `coverage: the API publishes ${unclaimed.join(", ")} and this check neither verifies it nor ` +
        `declares the Unity port does without it — decide which, in check-unity-sync.mjs`
    );
  }
  if (stale.length) {
    fail(`coverage: this check still names ${stale.join(", ")}, which the API no longer publishes`);
  }
  if (!unclaimed.length && !stale.length) {
    ok(
      `coverage: all ${keys.length} published sections accounted for — ${CHECKED.length} checked, ` +
        `${Object.keys(ABSENT).length} declared absent with a reason`
    );
  }
}

// --- Does the generated C# actually reference only things it declares?
//
// This exists because it did not. The generator emitted
// `public enum BodyStyle { Sedan, ZX, GTR, RX7 }` from one literal and
// `BodyStyle.Hatch` from a separate lookup table, so the file had not
// compiled since the hatch silhouette was added — and nothing said so,
// because this check compared CONSTANTS and a constant check cannot see
// a name that does not exist. The enum is generated from the lookup
// table now, and this makes sure they can never part again.
{
  const cs = readFileSync("unity/Assets/Scripts/GRNData.cs", "utf8");
  const decl = cs.match(/public enum BodyStyle \{([^}]*)\}/);
  if (!decl) {
    console.error("GRNData.cs has no BodyStyle enum");
    process.exitCode = 1;
  } else {
    const declared = new Set(decl[1].split(",").map((x) => x.trim()).filter(Boolean));
    const used = new Set([...cs.matchAll(/BodyStyle\.(\w+)/g)].map((m) => m[1]));
    const missing = [...used].filter((u) => !declared.has(u));
    if (missing.length) {
      console.error(
        `GRNData.cs uses BodyStyle.${missing.join(", BodyStyle.")} but the enum ` +
          `declares only { ${[...declared].join(", ")} } — the generated C# does not compile.`
      );
      process.exitCode = 1;
    } else {
      console.log(`✓ BodyStyle: ${used.size} used, all of ${declared.size} declared`);
    }
  }
}

// ---- the verdict, once everything above has actually run -------------
if (failed || process.exitCode) {
  console.error("\nRun `npm run sync:unity` to regenerate GRNData.cs from the web source.");
  process.exit(1);
}
console.log("\nWeb API and Unity data are in sync.");
