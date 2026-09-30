// The game's numbers in one file, for charts and anything else that
// wants them without importing the game.
//
//   node --experimental-strip-types --import ./tools/parity/ts-resolve.mjs tools/game-data.mjs
//
// Writes press/data/game-data.json: every catalogue car (from the press
// record press/cars/cars.json, which tools/shots/cars.mjs writes from the
// game's own catalogue), the eight rivals in the order you meet them, and
// the six engines — read from src/game, not typed in here, so the file
// cannot drift from the game.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { RIVALS, rivalCar } from "../src/game/rivals.ts";
import { ENGINES } from "../src/game/engines.ts";

const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, "0")}`;
const cars = JSON.parse(readFileSync("press/cars/cars.json", "utf8")).map((c) => ({
  id: c.id, name: c.name, ar: c.arabicName, cls: c.cls, price: c.price,
  topSpeedKmh: c.topSpeedKmh, zeroTo100s: c.zeroTo100s, power: c.power,
  grip: c.grip, brake: c.brake, tankLitres: c.tankLitres, lengthM: c.lengthM,
  color: c.color, drive: c.drive, engine: c.engine,
}));
const rivals = RIVALS.map((r, i) => {
  const car = rivalCar(r);
  return {
    order: i + 1, id: r.id, name: r.name, ar: r.arabicName, crew: r.crew, area: r.area,
    distance: r.distance, topSpeedKmh: r.topSpeedKmh, carId: r.carId, car: car?.name ?? r.carId,
    body: hex(r.bodyColor), accent: hex(r.accentColor),
  };
});
const engines = ENGINES.map((e) => ({
  id: e.id, name: e.name, ar: e.ar, cylinders: e.cylinders, layout: e.layout,
  litres: e.litres, idleRpm: e.idleRpm, redlineRpm: e.redlineRpm,
}));
mkdirSync("press/data", { recursive: true });
writeFileSync("press/data/game-data.json", JSON.stringify({ cars, rivals, engines }, null, 2) + "\n");
console.log(`press/data/game-data.json: ${cars.length} cars, ${rivals.length} rivals, ${engines.length} engines`);
