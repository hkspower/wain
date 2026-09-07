// What a car is made of, and whether all of it is there.
//
// A car in this game is not one file. It is a record in mods.ts, a
// silhouette shared with other cars, an authored GLB for that silhouette
// (or not — two of the six are procedural only), a shop image, one or
// two press renders, a paint colour, a finish, and whatever the factory
// bolted on. Those live in five different places and nothing has ever
// shown them together, so "which cars are missing their shop image" has
// only ever been answerable by listing two directories and comparing
// them by eye.
//
// This is that comparison, done once and from the roster outwards: for
// every car the game sells, what each of its assets is and whether it
// exists. It reports rather than judges — a silhouette with no authored
// GLB is a real state this game ships in, not a fault — but it says so
// plainly enough that a gap is visible.

import { existsSync, statSync, readFileSync } from "node:fs";
import { readCars } from "./car-source.mjs";

/** Where each kind of car asset lives, and what it is called there. */
export const ASSET_PATHS = {
  /** The shop's own picture of the car. */
  shop: (car) => `public/cars/${car.id}.webp`,
  /** The press render, and the second angle when a car has one. */
  press: (car) => `press/cars/${car.id}.png`,
  pressRear: (car) => `press/cars/${car.id}-rear.png`,
  /** The authored shell for this car's silhouette. Shared: sixteen cars
   *  over six silhouettes, and only four of those are authored. */
  shell: (car) => `public/models/car-${car.fields.style ?? "sedan"}.glb`,
};

const stat = (p) => {
  if (!existsSync(p)) return { path: p, present: false };
  const s = statSync(p);
  return { path: p, present: true, kb: +(s.size / 1024).toFixed(1) };
};

/** The Blender manifest, for the tri count of an authored shell. Read
 *  once: sixteen cars share four shells and reading it per car would be
 *  the same file sixteen times. */
function buildManifest() {
  try {
    return JSON.parse(readFileSync("public/models/build.json", "utf8")).assets ?? {};
  } catch {
    return {};
  }
}

/**
 * Every car, with its record and the state of each of its assets.
 *
 * `silhouetteShared` is the count of cars on the same shell, and it is
 * there because it changes what an edit means: changing a car's `style`
 * does not give it a new body, it moves it onto a body fifteen other
 * cars may also be using, and editing that shell changes all of them.
 */
export function carInventory() {
  const cars = readCars();
  const build = buildManifest();
  const perStyle = {};
  for (const c of cars) {
    const s = c.fields.style ?? "sedan";
    perStyle[s] = (perStyle[s] ?? 0) + 1;
  }
  return cars.map((car) => {
    const style = car.fields.style ?? "sedan";
    const shell = stat(ASSET_PATHS.shell(car));
    const key = `car-${style}`;
    return {
      id: car.id,
      fields: car.fields,
      silhouette: style,
      silhouetteShared: perStyle[style],
      assets: {
        shop: stat(ASSET_PATHS.shop(car)),
        press: stat(ASSET_PATHS.press(car)),
        pressRear: stat(ASSET_PATHS.pressRear(car)),
        shell: {
          ...shell,
          // Absent is a state this game ships in: the hatch and the pony
          // have no authored shell and are built procedurally. Said here
          // so it reads as a fact about those two rather than as damage.
          authored: shell.present,
          tris: build[key]?.tris ?? null,
        },
      },
    };
  });
}

/** The one-line summary: what is missing, across the whole roster. */
export function inventoryGaps(inv = carInventory()) {
  const gaps = [];
  for (const c of inv) {
    if (!c.assets.shop.present) gaps.push(`${c.id} has no shop image (${c.assets.shop.path})`);
    if (!c.assets.press.present) gaps.push(`${c.id} has no press render (${c.assets.press.path})`);
  }
  const styles = [...new Set(inv.map((c) => c.silhouette))];
  for (const s of styles) {
    const one = inv.find((c) => c.silhouette === s);
    if (!one.assets.shell.authored) {
      const n = one.silhouetteShared;
      gaps.push(
        `the ${s} silhouette has no authored shell, so ${n} car${n === 1 ? " is" : "s are"} built procedurally`
      );
    }
  }
  return gaps;
}
