// The Gulf Road Nights data API payloads.
//
// One builder per resource, all reading the same modules the web game
// runs on — so the JSON an Unreal client fetches can never disagree with
// what the browser is playing. `scripts/export-unreal-data.mjs` bakes the
// same values into GRNTypes.h for offline play; the API is the live path.

import { CONTROL_POINTS, LANES, ROAD_HALF_WIDTH, COAST_U } from "./track";
import { RIVALS } from "./rivals";
import { CARS, PARTS, PAINT_COLORS, GLOW_COLORS, CLASS_LABELS } from "./mods";
import { HANDLING } from "./handling";

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
    color: hex(c.color),
    bodyStyle: c.style ?? "sedan",
    kit: c.kit ?? null,
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
    cars: buildCars(),
    parts: buildParts(),
    handling: HANDLING,
  };
}

export type GameData = ReturnType<typeof buildGameData>;
