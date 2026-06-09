import * as THREE from "three";

// Low-poly arcade cars with physically-based paint: clearcoat bodies
// pick up the moon, streetlights, and bloom at night. Built facing +Z
// (the engine orients them with Object3D.lookAt along the track tangent).

export interface CarColors {
  body: number;
  accent?: number;
}

const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 14);
wheelGeo.rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9 });

const rimGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.32, 10);
rimGeo.rotateZ(Math.PI / 2);
const rimMat = new THREE.MeshStandardMaterial({
  color: 0xb8bdc4,
  roughness: 0.25,
  metalness: 0.95,
});

const headlightMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff6cf,
  emissiveIntensity: 2.4,
});
const taillightMat = new THREE.MeshStandardMaterial({
  color: 0x550000,
  emissive: 0xff2222,
  emissiveIntensity: 2.0,
});
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x0c1018,
  roughness: 0.08,
  metalness: 0.9,
  envMapIntensity: 1.4,
});

export function createCar(colors: CarColors): THREE.Group {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: colors.body,
    roughness: 0.32,
    metalness: 0.75,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.2,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.4), bodyMat);
  body.position.y = 0.62;
  group.add(body);

  // Sloped hood and trunk caps soften the brick silhouette
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.3, 1.0), bodyMat);
  hood.position.set(0, 0.93, 1.55);
  hood.rotation.x = 0.1;
  group.add(hood);
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.28, 0.8), bodyMat);
  trunk.position.set(0, 0.94, -1.7);
  trunk.rotation.x = -0.09;
  group.add(trunk);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.5, 2.1), glassMat);
  cabin.position.set(0, 1.1, -0.25);
  group.add(cabin);

  if (colors.accent !== undefined) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.05, 4.42),
      new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.4 })
    );
    stripe.position.y = 0.92;
    group.add(stripe);
  }

  for (const sx of [-0.75, 0.75]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), headlightMat);
    head.position.set(sx, 0.66, 2.21);
    group.add(head);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.08), taillightMat);
    tail.position.set(sx, 0.7, -2.21);
    group.add(tail);
  }

  for (const [wx, wz] of [
    [-0.92, 1.45],
    [0.92, 1.45],
    [-0.92, -1.45],
    [0.92, -1.45],
  ]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, 0.34, wz);
    group.add(wheel);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.set(wx, 0.34, wz);
    group.add(rim);
  }

  return group;
}
