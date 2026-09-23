import * as THREE from "three";
import { assetUrl } from "./cdn";
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
  manifest ??= fetch(assetUrl("/models/build.json"))
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
    //
    // Served cross-origin when NEXT_PUBLIC_ASSET_BASE is set (cdn.ts).
    // No crossOrigin call is needed: three's Loader defaults to
    // "anonymous" and fetches the .glb in CORS mode, so the host's
    // Access-Control-Allow-Origin header is all it takes.
    new GLTFLoader().load(
      assetUrl(`/models/${file}.glb${v ? `?v=${v}` : ""}`),
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
/**
 * Silhouettes with a Blender-authored shell on disk. Asking for one
 * that was never built is a 404 per car per load, which shows up as a
 * runtime error in the race test and tells the player nothing.
 *
 * This is NOT "the styles the pipeline supports" — profiles.json and
 * tools/blender/build_assets.py cover all nine now (see
 * scripts/export-car-profiles.mjs), because a style with no profile
 * was a style whose silhouette changes nothing ever read. This set is
 * only "which of those nine have actually had `npm run sync:models`
 * run and their GLB committed". It is now all nine: hatch, pony,
 * pickup and super were lofted with the same Blender run that
 * reproduces the other four bit for bit, and committed with it; the
 * suv, the first silhouette drawn for traffic rather than for the
 * roster, was lofted the same way when it was added. Add a
 * style here in the same commit as its car-{style}.glb, never before
 * it. scripts/check-blender-coverage.mjs fails if the two disagree.
 */
const AUTHORED_SHELLS: ReadonlySet<BodyStyle> = new Set<BodyStyle>([
  "sedan", "zx", "gtr", "rx7", "hatch", "pony", "pickup", "super", "suv",
]);

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
 * It is a tolerance and not a comment because the shipped shells once
 * did not meet it. Measured against the geometry they replaced, every
 * one of the four was a different car:
 *
 *   zx     body +185 mm at the roof, +100 mm at each end, +80 mm a side
 *   rx7    body +206 mm, +120 mm at each end
 *   sedan  body +173 mm, +90 mm at each end
 *   gtr    body +163 mm, +80 mm at each end
 *
 * with the canopies 143 to 169 mm high. They had been lofted in August
 * from a profiles.json that predated the body drop, the narrower widths
 * and the sharper edges, and nothing noticed, because a silent swap
 * looks identical to a correct one. A roofline 100 to 200 mm above where
 * the game thinks it is puts the roof rails, the third brake light, the
 * aerial and the driver's head inside the paint.
 *
 * So the swap is no longer unconditional. An authored shell that is not
 * the car gets rejected and the procedural one stands, which is the
 * fallback this whole module is built around — and the verdict is
 * recorded on the group rather than dropped, so "rejected as stale" and
 * "never loaded" stop looking the same from outside.
 *
 * All nine are within it today: lofted from the current profiles.json
 * and measured back with tools/shots/shelldrift.mjs, every silhouette
 * lands "authored" at a worst single-face drift of 1 mm. Keep the
 * tolerance anyway. It is cheap, and it is the only thing standing
 * between a stale GLB and a car that quietly stops being itself.
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

/**
 * ...and how far its SKIN sits from the skin it replaces.
 *
 * A bounding box is not a surface, and the gate above can only see a
 * shell that has changed SIZE. The hatch proved what that misses: its
 * rear window finished 23 mm above the tailgate deck — daylight under
 * the backlight, the full width of the car — and correcting it meant
 * dropping the foot of the glass by 48 mm. That point is not an extreme
 * of the canopy in any axis (the windscreen base is lower, the tailgate
 * is no further back), so the bounding box moved by EXACTLY ZERO. The
 * fix reached every traffic hatch and the hero car silently kept the
 * bug, because the stale authored canopy still passed a box test and
 * overwrote the corrected geometry underneath it.
 *
 * That is the same failure the box gate was written to stop — "a silent
 * swap looks identical to a correct one" — one level down. So the shell
 * is also asked where its skin IS: a grid of rays dropped over its own
 * footprint, hitting both surfaces, compared. A resample of the same
 * profile answers within a millimetre or two; a shell lofted from a
 * profile that has since been corrected does not.
 *
 * Twenty-five rays, once per authored geometry per session (the caller
 * memoises through the same WeakSet the crown uses). The shells are
 * 50-70k triangles, so this is a few milliseconds each — against
 * fetching and parsing an 11 MB file, free.
 *
 * Measured across all twenty-seven shipped shells at the moment this
 * was written: twenty-six land between 0.5 and 6.8 mm, which is the
 * 28-against-96 spline resample the box tolerance was already sized
 * for, and the hatch canopy lands at 26.0 mm — the one shell the
 * corrected profile made stale, against a box drift of 1.5 mm that
 * would have waved it through. So the separation is real and the same
 * 10 mm serves both gates; the tightest passing shell (the gtr canopy)
 * keeps 3 mm of headroom, which is worth knowing before anyone
 * re-lofts.
 */
const surfaceProbe = new THREE.MeshBasicMaterial();
/** Once per authored geometry: the file is cached per session and the
 *  extrusion it is judged against is the style's module-level one, so
 *  the answer cannot change between cars. */
const skewOf = new WeakMap<THREE.BufferGeometry, number>();
export function surfaceDrift(a: THREE.BufferGeometry, b: THREE.BufferGeometry): number {
  const memo = skewOf.get(a);
  if (memo !== undefined) return memo;
  if (!a.boundingBox) a.computeBoundingBox();
  const A = a.boundingBox!;
  const ma = new THREE.Mesh(a, surfaceProbe);
  const mb = new THREE.Mesh(b, surfaceProbe);
  ma.updateMatrixWorld(true);
  mb.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const dir = new THREE.Vector3(0, -1, 0);
  const from = new THREE.Vector3();
  const top = A.max.y + 1;
  let worst = 0;
  // Inset off the rim: a shell's own bevel rolls over at its perimeter,
  // so a ray fired at the very edge grazes a curve and reads a
  // difference that is sampling, not drift.
  const N = 5;
  for (let i = 0; i < N; i++) {
    const x = A.min.x + (A.max.x - A.min.x) * (0.15 + 0.7 * (i / (N - 1)));
    for (let j = 0; j < N; j++) {
      const z = A.min.z + (A.max.z - A.min.z) * (0.15 + 0.7 * (j / (N - 1)));
      from.set(x, top, z);
      ray.set(from, dir);
      const ha = ray.intersectObject(ma, false)[0];
      const hb = ray.intersectObject(mb, false)[0];
      // A ray that misses one surface and not the other is itself a
      // difference, but it is also what happens at a shell's waist on a
      // silhouette that tucks hard. Only compare where both answered.
      if (!ha || !hb) continue;
      worst = Math.max(worst, Math.abs(ha.point.y - hb.point.y));
    }
  }
  skewOf.set(a, worst);
  return worst;
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
    // The three slots are decided IN STACK ORDER — body, then the glass
    // on it, then the painted cap on the glass — rather than in whatever
    // order a traverse happens to reach them.
    //
    // It used to be a bare traverse. Order matters once anything is
    // derived per slot — what sits on top has to know what was actually
    // accepted underneath it, and a rejected shell must not leave the
    // one above it fitted to geometry nobody renders.
    const bySlot = new Map<string, THREE.Mesh>();
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const slot = mesh.userData.shell as string | undefined;
      if (slot) bySlot.set(slot, mesh);
    });

    /** The geometry actually on the car for a slot once it is decided —
     *  authored if the file was accepted, the extrusion if it was not.
     *  Anything re-derived from a shell afterwards reads THIS, so a
     *  rejected file never leaves something fitted to geometry nobody
     *  renders. */
    const live = new Map<string, THREE.BufferGeometry>();
    const settle = (slot: string) => {
      const mesh = bySlot.get(slot);
      if (!mesh) return;
      live.set(slot, mesh.geometry);
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
      const off = boxDrift(geo, mesh.geometry);
      if (off > SHELL_FIT_TOL) {
        verdict[slot] = `stale: ${(off * 1000).toFixed(0)} mm off the profile`;
        return;
      }
      // Same tolerance, asked of the skin rather than the box — see
      // surfaceDrift for the 48 mm correction that moved the bounding
      // box by nothing at all.
      const skew = surfaceDrift(geo, mesh.geometry);
      if (skew > SHELL_FIT_TOL) {
        verdict[slot] = `stale: skin ${(skew * 1000).toFixed(0)} mm off the profile`;
        return;
      }
      verdict[slot] = "authored";
      mesh.geometry = geo;
      live.set(slot, geo);
      // The lamps were fitted to the extrude; fit them to this.
      if (slot === "body") {
        (group.userData.refitShell as ((g: THREE.BufferGeometry) => void) | undefined)?.(geo);
      }
    };
    settle("body");
    settle("canopy");
    settle("roof");
    // The cabin was measured against the extruded glass at build time,
    // synchronously, long before this file landed. Re-measure it against
    // the glass the car is actually wearing.
    (group.userData.refitCabin as ((g: THREE.BufferGeometry) => void) | undefined)?.(
      live.get("canopy") ?? bySlot.get("canopy")!.geometry
    );
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
 * Upgrade a patrol car's roof bar.
 *
 * Three parts and two of them are driven: the housing plus its feet, and
 * the two lens banks the engine alternates. Each mesh says which it is
 * in userData, so this is a geometry swap and nothing else — the game
 * keeps owning the materials, which is the same deal every other part in
 * this file has.
 */
export function upgradePoliceBar(bar: THREE.Object3D): Promise<boolean> {
  return parts("police").then((kit) => {
    if (!kit) return false;
    let swapped = 0;
    bar.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const slot = mesh.userData?.barPart as string | undefined;
      if (!mesh.isMesh || !slot) return;
      const geo = kit[slot];
      if (!geo) return;
      mesh.geometry = geo;
      // The authored parts are modelled in the BAR's own frame, already
      // in their places along it. The procedural meshes they replace are
      // centred boxes pushed into place by their node position, so the
      // offset has to go or the authored part lands at its own position
      // PLUS the stand-in's — which put both lens banks half a bar
      // outboard, hanging off the ends of the housing.
      mesh.position.set(0, 0, 0);
      mesh.updateMatrix();
      swapped++;
    });
    return swapped > 0;
  });
}

/**
 * Upgrade the corniche palm crowns. One geometry serves every instance
 * of the InstancedMesh, so this is the cheapest upgrade in the game and
 * the most visible — the crowns line the whole coastal leg.
 */
export function upgradePalmCrowns(mesh: THREE.Mesh): Promise<boolean> {
  return parts("palm").then((kit) => {
    const geo = kit?.crown;
    if (!geo) return false;
    mesh.geometry = geo;
    return true;
  });
}
