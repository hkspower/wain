import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Procedural sedans with a real silhouette: the body and glasshouse are
// bevel-extruded side profiles (smoothed normals), riding on spoked
// wheels the engine spins with road speed. Built facing +Z; footprint
// stays ~1.9 x 4.4 m so gameplay collision sizes are unchanged.
//
// group.userData: { wheels: Group[4] (fl, fr, rl, rr), tailMat }

export interface CarColors {
  body: number;
  accent?: number;
}

/** Extrude a side profile (x = length, y = height) across the car's width. */
function extrudeProfile(
  points: Array<[number, number]>,
  width: number,
  bevel: number
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 6,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo = mergeVertices(geo, 1e-3);
  geo.computeVertexNormals();
  // Profile length axis (x) onto the car's forward axis (+Z)
  geo.rotateY(-Math.PI / 2);
  return geo;
}

// Beltline-down body: bumper > hood wedge > trunk, with rounded edges
const bodyGeo = extrudeProfile(
  [
    [2.2, 0.34],
    [2.26, 0.62],
    [2.12, 0.78],
    [1.35, 0.9],
    [0.4, 0.97],
    [-1.45, 0.95],
    [-2.18, 0.86],
    [-2.27, 0.62],
    [-2.2, 0.34],
    [-1.85, 0.24],
    [1.85, 0.24],
  ],
  1.84,
  0.14
);

// Raked glasshouse: windshield, roofline, rear window
const canopyGeo = extrudeProfile(
  [
    [1.02, 0.93],
    [0.42, 1.4],
    [-0.78, 1.42],
    [-1.5, 0.94],
  ],
  1.6,
  0.1
);

// Painted roof panel over the glass
const roofGeo = extrudeProfile(
  [
    [0.38, 1.41],
    [0.28, 1.47],
    [-0.68, 1.48],
    [-0.76, 1.42],
  ],
  1.42,
  0.06
);

const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 22);
tireGeo.rotateZ(Math.PI / 2);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.92 });

const rimGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.27, 14);
rimGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.29, 8);
hubGeo.rotateZ(Math.PI / 2);
const spokeGeo = new THREE.BoxGeometry(0.27, 0.3, 0.06);
const rimMat = new THREE.MeshStandardMaterial({
  color: 0xc8cdd4,
  roughness: 0.2,
  metalness: 0.95,
  envMapIntensity: 1.5,
});
const rimDarkMat = new THREE.MeshStandardMaterial({
  color: 0x23262b,
  roughness: 0.5,
  metalness: 0.6,
});

const archGeo = new THREE.TorusGeometry(0.45, 0.085, 8, 14, Math.PI);
const archMat = new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.9 });

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x0c1018,
  roughness: 0.06,
  metalness: 0.9,
  envMapIntensity: 1.6,
});

const headlightMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff6cf,
  emissiveIntensity: 2.6,
});
const grilleMat = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.6 });
const chromeMat = new THREE.MeshStandardMaterial({
  color: 0xd8dde3,
  roughness: 0.12,
  metalness: 1,
  envMapIntensity: 1.6,
});

function plateTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f2f3f5";
  ctx.fillRect(0, 0, 128, 32);
  ctx.strokeStyle = "#888";
  ctx.strokeRect(1, 1, 126, 30);
  ctx.fillStyle = "#16191e";
  ctx.font = "bold 19px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("KWT 8198", 64, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
let sharedPlateTex: THREE.CanvasTexture | null = null;
function plateMat(): THREE.MeshStandardMaterial {
  if (!sharedPlateTex) sharedPlateTex = plateTexture();
  return new THREE.MeshStandardMaterial({ map: sharedPlateTex, roughness: 0.5 });
}

function buildWheel(): THREE.Group {
  const w = new THREE.Group();
  w.add(new THREE.Mesh(tireGeo, tireMat));
  w.add(new THREE.Mesh(rimGeo, rimDarkMat));
  for (let i = 0; i < 5; i++) {
    const holder = new THREE.Group();
    holder.rotation.x = (i / 5) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    spoke.position.y = 0.1;
    holder.add(spoke);
    w.add(holder);
  }
  w.add(new THREE.Mesh(hubGeo, rimMat));
  return w;
}

export function createCar(colors: CarColors): THREE.Group {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: colors.body,
    roughness: 0.28,
    metalness: 0.75,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.3,
  });

  group.add(new THREE.Mesh(bodyGeo, bodyMat));
  group.add(new THREE.Mesh(canopyGeo, glassMat));
  group.add(new THREE.Mesh(roofGeo, bodyMat));

  if (colors.accent !== undefined) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.03, 4.3),
      new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.35 })
    );
    stripe.position.y = 1.0;
    group.add(stripe);
  }

  // Lights: lens strips front and rear
  for (const sx of [-0.62, 0.62]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.13, 0.07), headlightMat);
    head.position.set(sx, 0.7, 2.24);
    group.add(head);
  }
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x550000,
    emissive: 0xff2222,
    emissiveIntensity: 2.0,
  });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.06), tailMat);
  tail.position.set(0, 0.78, -2.26);
  group.add(tail);

  // Grille, chrome trim, plates, exhausts
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.17, 0.07), grilleMat);
  grille.position.set(0, 0.52, 2.25);
  group.add(grille);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.025, 0.08), chromeMat);
  trim.position.set(0, 0.61, 2.25);
  group.add(trim);
  for (const z of [2.27, -2.29]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.13, 0.02), plateMat());
    plate.position.set(0, 0.38, z);
    group.add(plate);
  }
  for (const sx of [-0.45, 0.45]) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.055, 0.18, 10),
      grilleMat
    );
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(sx, 0.27, -2.25);
    group.add(pipe);
  }

  // Side mirrors
  for (const sx of [-1.0, 1.0]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.2), bodyMat);
    mirror.position.set(sx, 1.04, 0.82);
    group.add(mirror);
  }

  // Wheels with arches; fronts steer, all spin (engine drives userData.wheels)
  const wheels: THREE.Group[] = [];
  for (const [wx, wz] of [
    [-0.84, 1.42],
    [0.84, 1.42],
    [-0.84, -1.42],
    [0.84, -1.42],
  ]) {
    const wheel = buildWheel();
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
    wheels.push(wheel);

    const arch = new THREE.Mesh(archGeo, archMat);
    arch.rotation.y = Math.PI / 2;
    arch.position.set(wx, 0.4, wz);
    group.add(arch);
  }

  group.userData.wheels = wheels;
  group.userData.tailMat = tailMat;

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });

  return group;
}
