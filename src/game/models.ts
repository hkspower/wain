import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BodyStyle } from "./cars";

// Blender-authored car shells.
//
// The car factory (cars.ts) builds every machine procedurally and tags
// its three shell meshes — body, canopy, roof — via userData.shell. This
// module fetches the matching authored shells from public/models/
// (built by tools/blender/build_cars.py from the same profiles) and
// swaps the *geometry* of those tagged meshes in place.
//
// Geometry-only replacement is the point: the mesh objects, their
// materials (paint with the live reflection probe, glass), shadow flags
// and every anchored detail hung around them stay untouched. If a file
// is missing or fails to parse, the procedural extrusion simply stands —
// the game never waits on, or breaks because of, an asset.

type ShellSet = Partial<Record<string, THREE.BufferGeometry>>;

/** One fetch per style per session, shared across every car using it. */
const cache = new Map<BodyStyle, Promise<ShellSet | null>>();

function shellsFor(style: BodyStyle): Promise<ShellSet | null> {
  let entry = cache.get(style);
  if (!entry) {
    entry = new Promise((resolve) => {
      new GLTFLoader().load(
        `/models/car-${style}.glb`,
        (gltf) => {
          const out: ShellSet = {};
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const geo = mesh.geometry.clone();
            // Bake the node transform so the geometry lives in the same
            // car-local frame the procedural extrusions use
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
    cache.set(style, entry);
  }
  return entry;
}

/**
 * Upgrade a built car's shells to the authored meshes, asynchronously.
 * The procedural geometries are module-shared constants in cars.ts (the
 * traffic fleet keeps using them), so they are never disposed here.
 */
export function upgradeCarShells(group: THREE.Group, style: BodyStyle): void {
  void shellsFor(style).then((shells) => {
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
