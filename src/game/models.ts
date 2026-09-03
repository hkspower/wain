import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { crownFor, crownShell, TIRE_HALF_W, WHEEL_R_K, WHEEL_W_K, type BodyStyle } from "./cars";

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

/**
 * What the build actually shipped.
 *
 * `build.json` is written by the Blender build and lists every file it
 * produced, so it is already the manifest — this just reads it as one.
 * The point is the file that is NOT there: asking for a model that was
 * never shipped works fine (the procedural version stands) but costs a
 * 404 on every page load and a loader error in the console, which is
 * indistinguishable from a real broken asset to anyone reading the log.
 *
 * If the manifest itself cannot be read, every file is assumed shipped:
 * a missing manifest must not silently downgrade a build that has all
 * its geometry.
 */
/**
 * ...and which build produced it.
 *
 * The .glb files are 11 MB and every one of them was revalidated on
 * every single page load, because Next serves public/ with
 * `Cache-Control: public, max-age=0` and nothing here overrode it. The
 * browser had the bytes and asked permission to use them anyway, once
 * per model, before the game could swap in a single piece of geometry.
 *
 * They cannot simply be cached for a year: the filenames are stable
 * across rebuilds, so a long max-age on `car-gtr.glb` serves last
 * month's geometry until someone clears their cache. What is needed is a
 * key that changes when the models do — and build.json already is one.
 * It lists every file with its triangle count and size, plus the quality
 * settings they were built at, so any rebuild that changes the geometry
 * changes this JSON. Fingerprinting the manifest we were downloading
 * anyway costs one pass over 4 KB of text and turns the asset URLs into
 * content-addressed ones.
 *
 * FNV-1a, the same hash community.ts derives invite codes with. It is
 * not a security boundary — it is a cache key, and the only failure mode
 * is a collision serving stale geometry, which needs two different
 * builds to hash identically.
 */
export interface ModelBuild {
  have: Set<string> | null;
  /** Short hex fingerprint, or "" when the manifest could not be read. */
  v: string;
}

export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

let manifest: Promise<ModelBuild> | null = null;
function shipped(): Promise<ModelBuild> {
  manifest ??= fetch("/models/build.json")
    .then((r) => (r.ok ? r.text() : null))
    .then((text) => {
      if (!text) return { have: null, v: "" };
      const j = JSON.parse(text) as { assets?: Record<string, unknown> };
      return {
        have: j?.assets ? new Set(Object.keys(j.assets)) : null,
        v: fingerprint(text),
      };
    })
    .catch(() => ({ have: null, v: "" }));
  return manifest;
}

function parts(file: string): Promise<PartSet | null> {
  let entry = cache.get(file);
  if (!entry) {
    entry = shipped().then(({ have, v }) => {
      if (have && !have.has(file)) return null;
      return load(file, v);
    });
    cache.set(file, entry);
  }
  return entry;
}

function load(file: string, v: string): Promise<PartSet | null> {
  return new Promise((resolve) => {
    // The fingerprint rides on the URL so the file can be cached
    // immutably: a rebuild changes the manifest, which changes this, and
    // the browser fetches a URL it has never seen rather than being asked
    // to re-check one it has. Empty when the manifest could not be read,
    // and then the bare path is requested exactly as before.
    new GLTFLoader().load(
      `/models/${file}.glb${v ? `?v=${v}` : ""}`,
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
}

/**
 * Cylindrical texture coordinates for an authored tire.
 *
 * The Blender wheel is exported without any, because it was modelled
 * when a tire was one flat colour and did not need them — so the tread
 * texture had nowhere to land and the authored tire stayed a black
 * shape no matter what material it was given.
 *
 * The mapping is not a guess: the tire is a surface of revolution about
 * X, so `u` is the angle around the axle and `v` is the position across
 * the section. That puts the crown in the middle of the image and both
 * flanks at its edges, which is exactly the tread/sidewall layout of the
 * texture — because on a real tire section the widest points ARE the
 * sidewalls, and the crown sits between them.
 *
 * The wrap seam is fixed rather than tolerated. A triangle spanning
 * u≈1 back to u≈0 interpolates backwards across the whole image and
 * paints one column of the tire with a smear of the entire tread. The
 * vertices on the low side of such a triangle are duplicated at u+1,
 * which repeat wrapping then resolves correctly.
 */
function addTireUvs(geo: THREE.BufferGeometry, halfWidth = 0.13): void {
  if (geo.getAttribute("uv")) return;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const n0 = pos.count;
  const u = new Float64Array(n0);
  const v = new Float64Array(n0);
  for (let i = 0; i < n0; i++) {
    u[i] = Math.atan2(pos.getZ(i), pos.getY(i)) / (Math.PI * 2) + 0.5;
    v[i] = Math.min(1, Math.max(0, 0.5 + pos.getX(i) / (2 * halfWidth)));
  }

  const idx = geo.getIndex();
  const clones: number[] = []; // original vertex index per appended copy
  if (idx) {
    const arr = idx.array as Uint16Array | Uint32Array;
    const dupOf = new Map<number, number>();
    for (let t = 0; t < arr.length; t += 3) {
      const a = arr[t], b = arr[t + 1], c = arr[t + 2];
      const lo = Math.min(u[a], u[b], u[c]);
      const hi = Math.max(u[a], u[b], u[c]);
      if (hi - lo <= 0.5) continue; // does not cross the seam
      for (let k = 0; k < 3; k++) {
        const vi = arr[t + k];
        if (u[vi] >= 0.5) continue;
        let dup = dupOf.get(vi);
        if (dup === undefined) {
          dup = n0 + clones.length;
          clones.push(vi);
          dupOf.set(vi, dup);
        }
        arr[t + k] = dup;
      }
    }
    idx.needsUpdate = true;
  }

  const n = n0 + clones.length;
  if (clones.length) {
    // Every attribute has to grow together, or the copies read another
    // vertex's normal.
    for (const [name, attr] of Object.entries(geo.attributes)) {
      const a = attr as THREE.BufferAttribute;
      const size = a.itemSize;
      const next = new Float32Array(n * size);
      next.set(a.array as ArrayLike<number>);
      clones.forEach((src, j) => {
        for (let c = 0; c < size; c++) {
          next[(n0 + j) * size + c] = (a.array as ArrayLike<number>)[src * size + c];
        }
      });
      geo.setAttribute(name, new THREE.BufferAttribute(next, size));
    }
  }

  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n0; i++) {
    uv[i * 2] = u[i];
    uv[i * 2 + 1] = v[i];
  }
  clones.forEach((src, j) => {
    uv[(n0 + j) * 2] = u[src] + 1; // the far side of the seam
    uv[(n0 + j) * 2 + 1] = v[src];
  });
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
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
/** Silhouettes with a Blender-authored shell on disk. Asking for one
 *  that was never built is a 404 per car per load, which shows up as a
 *  runtime error in the race test and tells the player nothing. */
const AUTHORED_SHELLS: ReadonlySet<BodyStyle> = new Set<BodyStyle>(["sedan", "zx", "gtr", "rx7"]);

/** Crowned once per file, not once per car. The GLBs are fetched and
 *  cached per session and the surfacing pass is a walk over every
 *  vertex; doing it inside the swap would redo it for the player's car,
 *  the rival's, and every traffic car that happens to share a
 *  silhouette. */
const crowned = new WeakSet<THREE.BufferGeometry>();

/**
 * How far an authored shell may sit from the shell it replaces, in
 * metres, on any one face of its bounding box.
 *
 * The loft is meant to be the same car, only smoother: same profile,
 * same width, same bevel, resampled. So the two boxes should agree to
 * within the difference between 28 spline segments and 96, which is
 * millimetres. 10 mm is generous.
 *
 * It is a tolerance and not a comment because the shipped shells do not
 * meet it. Measured against the geometry they replace, every one of the
 * four is a different car:
 *
 *   zx     body +185 mm at the roof, +100 mm at each end, +80 mm a side
 *   rx7    body +206 mm, +120 mm at each end
 *   sedan  body +173 mm, +90 mm at each end
 *   gtr    body +163 mm, +80 mm at each end
 *
 * with the canopies 143 to 169 mm high. They were lofted in August from
 * a profiles.json that predates the body drop, the narrower widths and
 * the sharper edges, and nothing noticed, because a silent swap looks
 * identical to a correct one. A roofline 100 to 200 mm above where the
 * game thinks it is puts the roof rails, the third brake light, the
 * aerial and the driver's head inside the paint.
 *
 * So the swap is no longer unconditional. An authored shell that is not
 * the car gets rejected and the procedural one stands, which is the
 * fallback this whole module is built around — and the verdict is
 * recorded on the group rather than dropped, so "rejected as stale" and
 * "never loaded" stop looking the same from outside.
 */
const SHELL_FIT_TOL = 0.01;

function boxDrift(a: THREE.BufferGeometry, b: THREE.BufferGeometry): number {
  if (!a.boundingBox) a.computeBoundingBox();
  if (!b.boundingBox) b.computeBoundingBox();
  const A = a.boundingBox!;
  const B = b.boundingBox!;
  return Math.max(
    Math.abs(A.min.x - B.min.x), Math.abs(A.max.x - B.max.x),
    Math.abs(A.min.y - B.min.y), Math.abs(A.max.y - B.max.y),
    Math.abs(A.min.z - B.min.z), Math.abs(A.max.z - B.max.z)
  );
}

export function upgradeCarShells(group: THREE.Group, style: BodyStyle): void {
  const verdict: Record<string, string> = (group.userData.shellSwap ??= {});
  if (!AUTHORED_SHELLS.has(style)) {
    verdict.all = "no authored shell for this silhouette";
    return;
  }
  void parts(`car-${style}`).then((shells) => {
    if (!shells) {
      verdict.all = "file missing or unreadable";
      return;
    }
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const slot = mesh.userData.shell as string | undefined;
      if (!slot) return;
      const geo = shells[slot];
      if (!geo) {
        verdict[slot] = "not in the file";
        return;
      }
      // The authored shells are lofted by tools/blender/build_assets.py
      // from the same profiles, with the same bevel — and therefore with
      // the same flat flanks. Crowning them here rather than only in
      // cars.ts is what stops the four styles that HAVE an authored
      // shell from showing a flat hero car in front of curved traffic.
      //
      // The Blender loft should grow this when it is next run — the
      // crown is exported in profiles.json now, so it can — and until
      // then this is where the surface is decided, once for both builds.
      if (!crowned.has(geo)) {
        crowned.add(geo);
        crownShell(geo, crownFor(style, slot));
      }
      // Crowned first: the crown moves vertices, and a shell judged
      // before it is surfaced is judged as a shape it never renders as.
      const off = boxDrift(geo, mesh.geometry);
      if (off > SHELL_FIT_TOL) {
        verdict[slot] = `stale: ${(off * 1000).toFixed(0)} mm off the profile`;
        return;
      }
      verdict[slot] = "authored";
      mesh.geometry = geo;
    });
  });
}

/**
 * Upgrade a car's hero wheels: tire, barrel, alloy face, rotor and lugs.
 * Five- and six-spoke alloys are separate files, so the wheel group says
 * which it is; the outboard-face parts are mirrored for the left side.
 */
const fittedWheelGeo = new WeakSet<THREE.BufferGeometry>();

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
        // Fit the authored wheel to the wheel the game actually runs.
        //
        // The GLB is modelled at the section's own radius — 0.36 m
        // rolling, 0.26 m across, documented in public/models/README.md
        // — and the game now fits that section to a larger wheel. Without
        // this the authored swap would quietly SHRINK every wheel back
        // to the old size the moment the file finished loading, which is
        // the worst kind of bug: correct on first frame, wrong later,
        // and only on the machines fast enough to load the models.
        //
        // Once per geometry. These are shared out of the parts cache, so
        // scaling in place on every car would compound.
        if (!fittedWheelGeo.has(geo)) {
          fittedWheelGeo.add(geo);
          // x is along the axle.
          geo.scale(WHEEL_W_K, WHEEL_R_K, WHEEL_R_K);
        }
        // The tire is the one authored part that carries a texture, and
        // the export has no coordinates for it. Done here, once, before
        // the mirrored copy is taken from it.
        // ...and with the half width it now HAS, not the one it was
        // authored at, or the sidewall bands land off the edge of the map.
        if (slot === "tire") addTireUvs(geo, TIRE_HALF_W);
        mesh.geometry = (mesh.userData.wheelSide as number) < 0 ? mirrorX(geo) : geo;
      });
    });
  }
}

/**
 * Upgrade the driver at the wheel: helmet, visor, gloves, the rim and
 * the pedal faces.
 *
 * These meshes hang off joints an IK solver is moving every frame, so
 * the authored parts are modelled in each joint's OWN frame and simply
 * replace the geometry there — the solve is untouched, and a missing
 * file leaves the procedural driver in the seat.
 */
export function upgradeDriver(group: THREE.Object3D): void {
  void parts("driver").then((kit) => {
    if (!kit) return;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const slot = mesh.userData.driverPart as string | undefined;
      const geo = slot ? kit[slot] : undefined;
      if (geo) mesh.geometry = geo;
    });
  });
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
