// The authored loft, put on a car in node the way the game puts it on.
//
// createCar builds the EXTRUDED body. The body the player sees is the
// authored loft (public/models/car-<style>.glb), which models.ts swaps in a
// moment later and then calls refitShell / refitCabin so everything that
// was laid against the extrusion is laid again. The two shells disagree by
// millimetres at the bonnet and by centimetres at the flank, so a test that
// measures only the extrusion measures a car nobody sees.
//
// This does models.ts's settle(), slot for slot: crown the loft once, refuse
// it if shellFit would, put it on the car, refit. tests/demonmarks.mjs does
// the same for the one car it measures.
import { readFileSync, existsSync } from "node:fs";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { crownFor, crownShell } from "../../src/game/cars.ts";
import { shellFit } from "../../src/game/models.ts";

const loader = new GLTFLoader();
const lofts = new Map();

/** The three authored shells of a style, crowned, by slot; null if the file
 *  is missing or unreadable. Shared between cars, as the game shares them. */
export async function loftOf(style) {
  if (lofts.has(style)) return lofts.get(style);
  const file = `public/models/car-${style}.glb`;
  let out = null;
  if (existsSync(file)) {
    const buf = readFileSync(file);
    out = await new Promise((res) => {
      loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", (g) => {
        const shells = {};
        g.scene.updateMatrixWorld(true);
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          const geo = o.geometry.clone();
          geo.applyMatrix4(o.matrixWorld);
          shells[o.name.toLowerCase()] = geo;
        });
        res(shells);
      }, () => res(null));
    });
    if (out) for (const slot of ["body", "canopy", "roof"]) if (out[slot]) crownShell(out[slot], crownFor(style, slot));
  }
  lofts.set(style, out);
  return out;
}

/** Put the loft on a car just built by createCar, as models.ts does, and
 *  return what each slot ended up wearing: "loft", or why it stayed on the
 *  extrusion. Call it before the car is scaled to 1: the game swaps at the
 *  scale the car is fitted to. */
export async function wearLoft(car, style) {
  const worn = {};
  const loft = await loftOf(style);
  const by = {};
  car.traverse((o) => { if (o.isMesh && o.userData.shell) by[o.userData.shell] = o; });
  for (const slot of ["body", "canopy", "roof"]) {
    const geo = loft?.[slot];
    if (!by[slot] || !geo) { worn[slot] = "extruded: not in the file"; continue; }
    const fit = shellFit(geo, by[slot].geometry);
    if (!fit.ok) { worn[slot] = `extruded: ${fit.reason}`; continue; }
    by[slot].geometry = geo;
    worn[slot] = "loft";
    if (slot === "body") car.userData.refitShell?.(geo);
  }
  car.userData.refitCabin?.(by.canopy.geometry);
  return worn;
}
