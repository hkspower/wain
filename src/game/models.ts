import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BodyStyle } from "./cars";

// Blender-authored graphics.
//
// The game builds everything procedurally first — car shells, hero
// wheels, palm crowns — and tags the meshes that have an authored
// counterpart. This module fetches the matching file from public/models/
// (built by tools/blender/build_assets.py) and swaps the *geometry* of
// those tagged meshes in place.
//
// Geometry-only replacement is the point: the mesh objects, their
// materials (paint with the live reflection probe, glass, the wheel
// finish the player bought), shadow flags and every anchored detail hung
// around them stay untouched. If a file is missing or fails to parse,
// the procedural build simply stands — the game never waits on, or
// breaks because of, an asset.

type PartSet = Partial<Record<string, THREE.BufferGeometry>>;

/** One fetch per file per session, shared by everything that wants it. */
const cache = new Map<string, Promise<PartSet | null>>();

function parts(file: string): Promise<PartSet | null> {
  let entry = cache.get(file);
  if (!entry) {
    entry = new Promise((resolve) => {
      new GLTFLoader().load(
        `/models/${file}.glb`,
        (gltf) => {
          const out: PartSet = {};
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const geo = mesh.geometry.clone();
            // Bake the node transform so the geometry lives in the same
            // local frame the procedural build uses
            geo.applyMatrix4(mesh.matrixWorld);
            geo.userData.authored = true;
            out[mesh.name.toLowerCase()] = geo;
          });
          resolve(out);
        },
        undefined,
        () => resolve(null) // 404 / parse failure → procedural stands
      );
    });
    cache.set(file, entry);
  }
  return entry;
}

/** Mirror a geometry across the wheel axis, winding and normals with it.
 *  The wheel is authored once, for the right-hand side; scaling the mesh
 *  instead would invert the direction it appears to spin. */
const mirrored = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function mirrorX(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let m = mirrored.get(geo);
  if (m) return m;
  m = geo.clone();
  const pos = m.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
  pos.needsUpdate = true;
  const nrm = m.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (nrm) {
    for (let i = 0; i < nrm.count; i++) nrm.setX(i, -nrm.getX(i));
    nrm.needsUpdate = true;
  }
  // Reflection reverses triangle winding; put it back, or every face
  // turns inside out under backface culling.
  const idx = m.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
    idx.needsUpdate = true;
  }
  m.computeBoundingSphere();
  m.userData.authored = geo.userData.authored;
  mirrored.set(geo, m);
  return m;
}

/**
 * Upgrade a built car's shells to the authored meshes, asynchronously.
 * The procedural geometries are module-shared constants in cars.ts (the
 * traffic fleet keeps using them), so they are never disposed here.
 */
export function upgradeCarShells(group: THREE.Group, style: BodyStyle): void {
  void parts(`car-${style}`).then((shells) => {
    if (!shells) return;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const slot = mesh.userData.shell as string | undefined;
      const geo = slot ? shells[slot] : undefined;
      if (geo) mesh.geometry = geo;
    });
  });
}

/**
 * Upgrade a car's hero wheels: tire, barrel, alloy face, rotor and lugs.
 * Five- and six-spoke alloys are separate files, so the wheel group says
 * which it is; the outboard-face parts are mirrored for the left side.
 */
export function upgradeWheels(group: THREE.Group): void {
  const wanted = new Set<number>();
  group.traverse((o) => {
    const n = (o.userData.spokes as number | undefined) ?? 0;
    if (n) wanted.add(n);
  });
  for (const spokes of wanted) {
    void parts(`wheel-${spokes}`).then((kit) => {
      if (!kit) return;
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const slot = mesh.userData.wheelPart as string | undefined;
        if (!slot || (mesh.parent?.userData.spokes ?? 0) !== spokes) return;
        const geo = kit[slot];
        if (!geo) return;
        mesh.geometry = (mesh.userData.wheelSide as number) < 0 ? mirrorX(geo) : geo;
      });
    });
  }
}

/**
 * Upgrade the corniche palm crowns. One geometry serves every instance
 * of the InstancedMesh, so this is the cheapest upgrade in the game and
 * the most visible — the crowns line the whole coastal leg.
 */
export function upgradePalmCrowns(mesh: THREE.Mesh): void {
  void parts("palm").then((kit) => {
    const geo = kit?.crown;
    if (geo) mesh.geometry = geo;
  });
}
