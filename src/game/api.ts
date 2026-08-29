// The Gulf Road Nights data API payloads.
//
// One builder per resource, all reading the same modules the web game
// runs on — so the JSON an Unreal client fetches can never disagree with
// what the browser is playing. `scripts/export-unreal-data.mjs` bakes the
// same values into GRNTypes.h for offline play; the API is the live path.

import { CONTROL_POINTS, LANES, ROAD_HALF_WIDTH, COAST_U, STATIONS, FORECOURT } from "./track";
import { RIVALS } from "./rivals";
import {
  QUESTS, TOGETHER_M, MET_M, MATCHED_KMH, MATCHED_FLOOR_KMH,
} from "./quests";
import { CARS, PARTS, PAINT_COLORS, GLOW_COLORS, classLabel } from "./mods";
import { PAINTS, GLOWS, swatch } from "./paints";
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
import { STYLE_REAL, WIDTH_FOLLOWS_LENGTH } from "./cars";
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
    classLabel: classLabel(c.cls),
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
    /** Which wheels the engine drives. Not a trim detail: front and rear
     *  do opposite things under power, so a port that does not carry
     *  this ships a fleet that all behaves like rear-drive whatever the
     *  showroom says. The generated header has had it since the
     *  drivetrain work; this side had not, and the sync check could not
     *  say so because its car pattern had stopped matching any row. */
    drive: c.drive ?? "rwd",
    kit: c.kit,
    accent: c.accent ?? null,
    stripes: c.stripes ?? null,
    finish: c.finish ?? null,
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
    /**
     * How big a car of each silhouette is.
     *
     * Published because both ports were guessing, and guessing
     * differently. Unity carried a hand-typed table of four shapes and
     * built every car of a style at one size, so a 3.95 m hatch and a
     * 4.70 m saloon came out identical — and the hatch and the pony were
     * not in the table at all, so they fell through to the saloon. Unreal
     * was blunter still: one width, 1.9 m before its presence factor, for
     * every car in the game.
     *
     * The web fits each car to the length on its own card and then fits
     * the WIDTH to this law, because width is not a constant per class
     * and not a slave to length either — a longer car in a class is a
     * little wider, and the exponent is the whole of that claim. Sending
     * the law rather than a table of answers means a car added to the
     * roster is sized correctly by a port that has never heard of it.
     */
    bodyShape: {
      reference: STYLE_REAL,
      lengthExponent: WIDTH_FOLLOWS_LENGTH,
    },
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
    /**
     * The online runs: what they are called, what they ask for, and how
     * close two cars have to be for any of it to count.
     *
     * Published as targets and thresholds rather than as progress,
     * because progress belongs to a save and this payload is the same
     * for everybody. A port that wires up its own hub needs the numbers
     * to agree — two clients that disagree about what "together" means
     * would credit the same two cars differently for the same drive.
     */
    /**
     * The paint booth as a palette rather than as a shopping list.
     *
     * buildParts already carries a paintColor on each tin, which is
     * enough to render a shop and not enough to build one: it says
     * nothing about which colours belong together, and a port reading it
     * has to guess an order. This is the palette in the order a swatch
     * grid wants, grouped the way the garage groups it, with the two
     * finishes of the same fact — the integer a renderer wants and the
     * CSS string a UI wants — rather than each port writing its own
     * conversion and one of them getting the padding wrong.
     */
    palette: {
      paints: PAINTS.map((p) => ({
        id: p.id,
        family: p.family,
        color: hex(p.hex),
        css: swatch(p.hex),
      })),
      glows: GLOWS.map((g) => ({ id: g.id, color: hex(g.hex), css: swatch(g.hex) })),
      /**
       * The floor every pair of paints clears, as CIEDE2000 in CIELAB.
       * Published because it is the rule a port has to keep when it adds
       * a colour of its own, and because "no two of these look alike" is
       * a claim worth stating in units rather than leaving to taste.
       */
      minPerceptualDistance: 12,
    },
    runs: {
      togetherM: TOGETHER_M,
      metM: MET_M,
      matchedKmh: MATCHED_KMH,
      matchedFloorKmh: MATCHED_FLOOR_KMH,
      list: QUESTS.map((q) => ({
        id: q.id,
        name: q.name,
        arabicName: q.ar,
        hint: q.hint,
        arabicHint: q.hintAr,
        metric: q.metric,
        target: q.target,
        unit: q.unit,
        rewardKd: q.reward,
      })),
    },
    // The skeletons every port has to reproduce to pose its people the
    // same way: bone lengths, joint offsets, grip angles, pedal travel,
    // and how far a neck turns before the shoulders take over.
    rig: RIG,
  };
}

export type GameData = ReturnType<typeof buildGameData>;
