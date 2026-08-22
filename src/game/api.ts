// The Gulf Road Nights data API payloads.
//
// One builder per resource, all reading the same modules the web game
// runs on — so the JSON an Unreal client fetches can never disagree with
// what the browser is playing. `scripts/export-unreal-data.mjs` bakes the
// same values into GRNTypes.h for offline play; the API is the live path.

import { CONTROL_POINTS, LANES, ROAD_HALF_WIDTH, COAST_U, STATIONS, FORECOURT } from "./track";
import { RIVALS } from "./rivals";
import { CARS, PARTS, PAINT_COLORS, GLOW_COLORS, CLASS_LABELS } from "./mods";
import {
  ENGINES,
  FUEL_RATE,
  FUEL_FILS_PER_LITRE,
  PUMP_LITRES_PER_SEC,
  PUMP_MAX_KMH,
  AIR_G_PER_L,
  AFR,
  FUEL_G_PER_L,
} from "./engines";
import { HANDLING } from "./handling";
import { RIG } from "./rig";

/** Bump when a payload shape changes incompatibly. Clients compare it. */
export const GRN_API_VERSION = 1;

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export function buildTrack() {
  return {
    // One unit = one metre. Unreal multiplies by 100 and swaps axes.
    units: "metres",
    roadHalfWidth: ROAD_HALF_WIDTH,
    lanes: LANES,
    coast: COAST_U,
    /** Petrol stations: metres from the line, and how far off the
     *  centreline the apron sits. The road opens by `forecourt` at each
     *  one, which is what makes them drivable. */
    stations: STATIONS.map((st) => ({ s: st.s, lat: st.lat })),
    forecourt: FORECOURT,
    controlPoints: CONTROL_POINTS.map(([x, y, z]) => ({ x, y, z })),
  };
}

export function buildRivals() {
  return RIVALS.map((r, i) => ({
    index: i,
    id: r.id,
    name: r.name,
    arabicName: r.arabicName,
    crew: r.crew,
    area: r.area,
    country: r.country ?? "Kuwait",
    flag: r.flag ?? "🇰🇼",
    car: r.car ?? "Street Tuned",
    bodyStyle: r.bodyStyle ?? "sedan",
    bodyColor: hex(r.bodyColor),
    accentColor: hex(r.accentColor),
    topSpeedKmh: r.topSpeedKmh,
    taunt: r.taunt,
    rejectLine: r.rejectLine ?? null,
    lines: r.lines,
    voice: r.voice,
    /** Payout for beating them, mirroring the engine's formula. */
    prizeKd: 400 + i * 300,
  }));
}

/** The five engines, with the shape of each torque curve. A port that
 *  has the cars and not these builds every machine with the same
 *  personality. */
export function buildEngines() {
  return ENGINES.map((e) => ({
    id: e.id,
    name: e.name,
    arabicName: e.ar,
    cylinders: e.cylinders,
    layout: e.layout,
    litres: e.litres,
    idleRpm: e.idleRpm,
    redlineRpm: e.redlineRpm,
    peakAt: e.peakAt,
    breadth: e.breadth,
    floor: e.floor,
    powerMult: e.powerMult,
    massKg: e.massKg,
    subMix: e.subMix,
    lopeDepth: e.lopeDepth,
    price: e.price,
    desc: e.desc,
  }));
}

export function buildCars() {
  return CARS.map((c) => ({
    id: c.id,
    name: c.name,
    arabicName: c.ar,
    cls: c.cls,
    classLabel: CLASS_LABELS[c.cls],
    price: c.price,
    power: c.power,
    topSpeedKmh: c.topSpeedKmh,
    grip: c.grip,
    brake: c.brake,
    tankLitres: c.tankLitres,
    /** Overall length, metres. The shell is fitted to this number, so a
     *  port that ignores it ships a fleet of different cars. */
    lengthM: c.lengthM,
    color: hex(c.color),
    bodyStyle: c.style ?? "sedan",
    kit: c.kit,
    accent: c.accent ?? null,
    stripes: c.stripes ?? null,
    engine: c.engine,
    // A car nobody can buy yet is a rule, not a decoration, so it
    // travels with the car. A port that ships the showroom without this
    // sells the one machine the career exists to earn.
    lockedRivals: c.locked?.rivals ?? 0,
    // Parts fitted before it leaves the lot, in catalogue order.
    factoryBuild: c.factoryBuild ?? [],
    desc: c.desc,
  }));
}

export function buildParts() {
  return PARTS.map((p) => ({
    id: p.id,
    cat: p.cat,
    name: p.name,
    arabicName: p.ar,
    price: p.price,
    desc: p.desc,
    paintColor: PAINT_COLORS[p.id] !== undefined ? hex(PAINT_COLORS[p.id]) : null,
    glowColor: GLOW_COLORS[p.id] !== undefined ? hex(GLOW_COLORS[p.id]) : null,
  }));
}

export function buildGameData() {
  return {
    apiVersion: GRN_API_VERSION,
    game: "Gulf Road Nights",
    generatedAt: null as string | null, // static payload: no build stamp
    track: buildTrack(),
    rivals: buildRivals(),
    engines: buildEngines(),
    cars: buildCars(),
    parts: buildParts(),
    handling: HANDLING,
    /** Everything about burning and buying petrol that a port has to
     *  agree with. The burn model itself is displacement x revs x
     *  throttle — see engines.ts — so only its scaling and its price
     *  need publishing. */
    fuel: {
      rateMultiplier: FUEL_RATE,
      filsPerLitre: FUEL_FILS_PER_LITRE,
      pumpLitresPerSecond: PUMP_LITRES_PER_SEC,
      pumpMaxKmh: PUMP_MAX_KMH,
      airGramsPerLitre: AIR_G_PER_L,
      airFuelRatio: AFR,
      petrolGramsPerLitre: FUEL_G_PER_L,
    },
    // The skeletons every port has to reproduce to pose its people the
    // same way: bone lengths, joint offsets, grip angles, pedal travel,
    // and how far a neck turns before the shoulders take over.
    rig: RIG,
  };
}

export type GameData = ReturnType<typeof buildGameData>;
