import * as THREE from "three";
import { Track, ROAD_HALF_WIDTH, COAST_U } from "./track";

// Night-time Gulf Road: the corniche leg runs right along the water —
// beach, palms, Green Island, the Salmiya marina, the Scientific Center
// and the Ras Al-Ard light — with the city skyline and water towers on
// the inland return leg.

// Districts in lap order: down the coast, around the point, back inland.
export const AREAS = [
  { name: "Sharq", arabic: "شرق" },
  { name: "Bneid Al-Gar", arabic: "بنيد القار" },
  { name: "Salmiya", arabic: "السالمية" },
  { name: "Ras Al-Ard", arabic: "رأس الأرض" },
  { name: "Hawally", arabic: "حولي" },
  { name: "Kuwait City", arabic: "مدينة الكويت" },
];

export function areaAt(track: Track, s: number) {
  const u = track.wrap(s) / track.length;
  return AREAS[Math.min(AREAS.length - 1, Math.floor(u * AREAS.length))];
}

/** Flat ribbon following the track between lateral offsets a..b at height y,
 *  optionally only over the lap fraction u0..u1. */
function buildRibbon(
  track: Track,
  a: number,
  b: number,
  y: number,
  step = 8,
  u0 = 0,
  u1 = 1
): THREE.BufferGeometry {
  const span = (u1 - u0) * track.length;
  const n = Math.ceil(span / step);
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();

  for (let i = 0; i <= n; i++) {
    const s = u0 * track.length + (i / n) * span;
    track.pointAt(s, p);
    track.sideAt(s, side);
    const o = i * 6;
    positions[o] = p.x + side.x * a;
    positions[o + 1] = y;
    positions[o + 2] = p.z + side.z * a;
    positions[o + 3] = p.x + side.x * b;
    positions[o + 4] = y;
    positions[o + 5] = p.z + side.z * b;
    const ou = i * 4;
    uvs[ou] = 0;
    uvs[ou + 1] = s / 14; // one texture tile per ~14 m of road
    uvs[ou + 2] = 1;
    uvs[ou + 3] = s / 14;
    if (i < n) {
      const v = i * 2;
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Vertical band (guardrail face) following the track at lateral offset. */
function buildWall(track: Track, lateral: number, y0: number, y1: number, step = 8): THREE.BufferGeometry {
  const n = Math.ceil(track.length / step);
  const positions = new Float32Array((n + 1) * 2 * 3);
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  for (let i = 0; i <= n; i++) {
    const s = (i / n) * track.length;
    track.pose(s, lateral, p, tmp);
    const o = i * 6;
    positions[o] = p.x;
    positions[o + 1] = y0;
    positions[o + 2] = p.z;
    positions[o + 3] = p.x;
    positions[o + 4] = y1;
    positions[o + 5] = p.z;
    if (i < n) {
      const v = i * 2;
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function asphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#1d1f24";
  ctx.fillRect(0, 0, 256, 256);
  // Aggregate speckle
  for (let i = 0; i < 5200; i++) {
    const g = 24 + Math.random() * 36;
    ctx.fillStyle = `rgba(${g},${g},${g + 4},${0.25 + Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4);
  }
  // Tire-polished wear bands where the wheels run in each lane
  ctx.fillStyle = "rgba(12,13,16,0.5)";
  for (const u of [0.125, 0.375, 0.625, 0.875]) {
    for (const off of [-0.045, 0.045]) {
      ctx.fillRect((u + off) * 256 - 5, 0, 10, 256);
    }
  }
  // Cracks and patches
  ctx.strokeStyle = "rgba(10,10,12,0.55)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    let x = Math.random() * 256;
    let y = Math.random() * 256;
    ctx.moveTo(x, y);
    for (let j = 0; j < 6; j++) {
      x += (Math.random() - 0.5) * 40;
      y += Math.random() * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function seaTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a2236";
  ctx.fillRect(0, 0, 256, 256);
  // Wave crests catching the moon
  for (let i = 0; i < 420; i++) {
    const a = 0.04 + Math.random() * 0.12;
    ctx.strokeStyle = `rgba(${140 + Math.random() * 60},${190 + Math.random() * 40},${
      215 + Math.random() * 40
    },${a})`;
    ctx.lineWidth = 0.8 + Math.random() * 1.4;
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 14, y + (Math.random() - 0.5) * 5, x + 22 + Math.random() * 22, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function lightPoolTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(255,190,110,0.5)");
  g.addColorStop(0.5, "rgba(255,165,80,0.18)");
  g.addColorStop(1, "rgba(255,150,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function glowTexture(r: number, g: number, b: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
  grad.addColorStop(0.35, `rgba(${r},${g},${b},0.25)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a0d13";
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (Math.random() < 0.42) {
        ctx.fillStyle = Math.random() < 0.75 ? "#ffd27f" : "#9ad1ff";
        ctx.globalAlpha = 0.55 + Math.random() * 0.45;
        ctx.fillRect(x, y, 5, 4);
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function signTexture(en: string, ar: string, sub?: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a4da3";
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 144);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = "bold 52px sans-serif";
  ctx.fillText(ar, 256, 64);
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(en, 256, 116);
  if (sub) {
    ctx.font = "24px sans-serif";
    ctx.fillText(sub, 256, 146);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function stripeTexture(colorA: string, colorB: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    ctx.fillRect(0, i * 8, 8, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function flagTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#007a3d";
  ctx.fillRect(0, 0, 256, 43);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 43, 256, 42);
  ctx.fillStyle = "#ce1126";
  ctx.fillRect(0, 85, 256, 43);
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(72, 43);
  ctx.lineTo(72, 85);
  ctx.lineTo(0, 128);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function kuwaitTowers(): THREE.Group {
  const g = new THREE.Group();
  const spireMat = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.5 });
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0x2e8f96,
    roughness: 0.35,
    metalness: 0.3,
    emissive: 0x0e4a50,
    emissiveIntensity: 0.7,
  });

  const main = new THREE.Group();
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 3.2, 113, 10), spireMat);
  spire.position.y = 56.5;
  main.add(spire);
  const bigBall = new THREE.Mesh(new THREE.SphereGeometry(11, 18, 14), ballMat);
  bigBall.position.y = 58;
  main.add(bigBall);
  const smallBall = new THREE.Mesh(new THREE.SphereGeometry(6.5, 16, 12), ballMat);
  smallBall.position.y = 88;
  main.add(smallBall);
  g.add(main);

  const second = new THREE.Group();
  const spire2 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.6, 92, 10), spireMat);
  spire2.position.y = 46;
  second.add(spire2);
  const ball2 = new THREE.Mesh(new THREE.SphereGeometry(8.5, 16, 12), ballMat);
  ball2.position.y = 62;
  second.add(ball2);
  second.position.set(-34, 0, 14);
  g.add(second);

  const third = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.2, 76, 10), spireMat);
  third.position.set(-62, 38, 30);
  g.add(third);

  return g;
}

function waterTowers(stripes: THREE.CanvasTexture): THREE.Group {
  const g = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.6 });
  const capMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.5 });
  for (let i = 0; i < 5; i++) {
    const t = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 19, 8), stemMat);
    stem.position.y = 9.5;
    t.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(6, 14, 10), capMat);
    cap.scale.y = 0.8;
    cap.position.y = 20;
    t.add(cap);
    t.position.set((i % 3) * 22 - 22, 0, Math.floor(i / 3) * 20 - 10);
    g.add(t);
  }
  return g;
}

function liberationTower(windows: THREE.CanvasTexture): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb9bfc7, roughness: 0.6 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7, 95, 12), mat);
  shaft.position.y = 47.5;
  g.add(shaft);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(12, 12, 7, 14),
    new THREE.MeshStandardMaterial({ map: windows, color: 0xffffff, roughness: 0.5 })
  );
  disc.position.y = 72;
  g.add(disc);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.8, 38, 6), mat);
  antenna.position.y = 114;
  g.add(antenna);
  return g;
}

function alHamra(windows: THREE.CanvasTexture): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    map: windows,
    color: 0xdddddd,
    roughness: 0.4,
  });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(26, 118, 24), mat);
  tower.position.y = 59;
  return tower;
}

function mosque(): THREE.Group {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xd9cba8,
    roughness: 0.8,
    emissive: 0x4a3c1e,
    emissiveIntensity: 0.25,
  });
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x2e8f96,
    roughness: 0.4,
    emissive: 0x0e4a50,
    emissiveIntensity: 0.5,
  });
  const hall = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 22), wallMat);
  hall.position.y = 4.5;
  g.add(hall);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(8, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.y = 9;
  g.add(dome);
  const minaret = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.7, 27, 8), wallMat);
  minaret.position.set(17, 13.5, 8);
  g.add(minaret);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(1.8, 4, 8), domeMat);
  tip.position.set(17, 29, 8);
  g.add(tip);
  return g;
}

function greenIsland(): THREE.Group {
  const g = new THREE.Group();
  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(95, 100, 1.2, 24),
    new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 1 })
  );
  sand.position.y = 0.3;
  g.add(sand);
  const lawn = new THREE.Mesh(
    new THREE.CylinderGeometry(78, 82, 1.4, 24),
    new THREE.MeshStandardMaterial({ color: 0x1e4d22, roughness: 1 })
  );
  lawn.position.y = 0.7;
  g.add(lawn);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4327, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2c5e2e, roughness: 1 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 25 + (i % 3) * 18;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 6, 6), trunkMat);
    trunk.position.set(Math.cos(a) * r, 4.4, Math.sin(a) * r);
    g.add(trunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.7, 7), crownMat);
    crown.position.set(Math.cos(a) * r, 7.8, Math.sin(a) * r);
    g.add(crown);
  }
  // Observation tower at the centre
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2.2, 16, 8),
    new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.8, emissive: 0x3a2e16, emissiveIntensity: 0.4 })
  );
  tower.position.y = 8.7;
  g.add(tower);
  return g;
}

function marinaBoats(): THREE.Group {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.5 });
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x9fb4c8, roughness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 7 + (i % 3) * 2), hullMat);
    hull.position.y = 0.55;
    boat.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 2.4), cabinMat);
    cabin.position.set(0, 1.5, -0.8);
    boat.add(cabin);
    boat.position.set((i % 2) * 9 - 4, 0, Math.floor(i / 2) * 12 - 12);
    boat.rotation.y = (i * 0.9) % (Math.PI * 2);
    g.add(boat);
  }
  return g;
}

function scientificCenter(): THREE.Group {
  // The sail-shaped aquarium on the Salmiya waterfront, stylized as a
  // glassy pyramid wedge.
  const g = new THREE.Group();
  const sailMat = new THREE.MeshStandardMaterial({
    color: 0x9fc4d8,
    roughness: 0.25,
    metalness: 0.5,
    emissive: 0x14323f,
    emissiveIntensity: 0.6,
  });
  const sail = new THREE.Mesh(new THREE.CylinderGeometry(0, 24, 34, 4), sailMat);
  sail.position.y = 17;
  sail.rotation.y = Math.PI / 4;
  sail.scale.z = 0.45;
  g.add(sail);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(50, 7, 26),
    new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.8, emissive: 0x3a2e16, emissiveIntensity: 0.3 })
  );
  base.position.y = 3.5;
  g.add(base);
  return g;
}

function lighthouse(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 2.1, 17, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.6 })
  );
  body.position.y = 8.5;
  g.add(body);
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 2.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xff5544, emissive: 0xff3322, emissiveIntensity: 2.5, fog: false })
  );
  lamp.position.y = 18.1;
  g.add(lamp);
  return g;
}

/** Place an object beside the track: distance s along, `offset` metres right (+) or left (-). */
function placeBeside(track: Track, obj: THREE.Object3D, s: number, offset: number) {
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  track.pointAt(s, p);
  track.sideAt(s, side);
  obj.position.set(p.x + side.x * offset, 0, p.z + side.z * offset);
}

export interface WorldHandle {
  /** Advance animated scenery (sea shimmer, tower beacons). */
  tick(dt: number): void;
  /** The moon — the engine drives its shadow frustum along with the player. */
  moonLight: THREE.DirectionalLight;
}

/** Pulsing red aircraft-warning beacon for tower tops. */
function makeBeacon(beacons: THREE.MeshStandardMaterial[]): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x330000,
    emissive: 0xff1a1a,
    emissiveIntensity: 2.5,
    fog: false,
  });
  beacons.push(mat);
  return new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), mat);
}

export function buildWorld(scene: THREE.Scene, track: Track): WorldHandle {
  const L = track.length;
  const beacons: THREE.MeshStandardMaterial[] = [];

  // Fog and light
  scene.fog = new THREE.FogExp2(0x05070f, 0.0021);
  scene.add(new THREE.HemisphereLight(0x3a4a6b, 0x1a140c, 0.65));
  const moonLight = new THREE.DirectionalLight(0xbfd0ff, 0.8);
  moonLight.position.set(-300, 500, 200);
  scene.add(moonLight);

  // Gradient night-sky dome with city glow at the horizon
  {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vPos;
        void main() {
          float h = clamp(vPos.y / 600.0, 0.0, 1.0);
          vec3 top = vec3(0.012, 0.018, 0.05);
          vec3 horizon = vec3(0.07, 0.09, 0.16);
          vec3 col = mix(horizon, top, smoothstep(0.0, 0.6, h));
          // sodium light pollution hugging the skyline
          col += vec3(0.10, 0.055, 0.012) * (1.0 - smoothstep(0.0, 0.18, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3400, 24, 12), skyMat);
    sky.position.set(1200, 0, -1400);
    sky.renderOrder = -2;
    scene.add(sky);

    // The moon over the Gulf, with a soft halo
    const moonDisc = new THREE.Mesh(
      new THREE.CircleGeometry(70, 32),
      new THREE.MeshBasicMaterial({ color: 0xfdf3d3, fog: false })
    );
    moonDisc.position.set(-1450, 950, -300);
    moonDisc.lookAt(1200, 100, -1400);
    moonDisc.renderOrder = -1;
    scene.add(moonDisc);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(225, 220, 195),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        opacity: 0.5,
      })
    );
    halo.scale.set(700, 700, 1);
    halo.position.copy(moonDisc.position);
    scene.add(halo);
  }

  // Stars
  {
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * 0.45 + 0.08;
      const r = 3000;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r + 1200;
      pos[i * 3 + 1] = Math.sin(e) * r * 0.5;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r - 1400;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xcdd8ff, size: 2.4, sizeAttenuation: false, fog: false })
    );
    scene.add(stars);
  }

  // City floor inland of the corniche
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ color: 0x241d12, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(2700, -0.08, -1400);
  ground.receiveShadow = true;
  scene.add(ground);

  // The Gulf — runs along the whole coastal leg (road x ≈ 760–850,
  // water everywhere west of it down to the horizon)
  const seaMap = seaTexture();
  seaMap.repeat.set(36, 64);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(3300, 5800),
    new THREE.MeshStandardMaterial({
      map: seaMap,
      color: 0xb8c4cc,
      roughness: 0.18,
      metalness: 0.55,
      emissive: 0x06283f,
      emissiveIntensity: 0.5,
    })
  );
  sea.rotation.x = -Math.PI / 2;
  // Eastern edge at x ≈ 770 so the water always reaches under the beach
  sea.position.set(-880, -0.04, -1400);
  scene.add(sea);

  // Corniche: paved walkway then beach sand between the road and the water
  const walkway = new THREE.Mesh(
    buildRibbon(track, -(ROAD_HALF_WIDTH + 0.8), -(ROAD_HALF_WIDTH + 4.5), 0.06, 10, COAST_U.from, COAST_U.to),
    new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.95 })
  );
  scene.add(walkway);

  const beach = new THREE.Mesh(
    buildRibbon(track, -(ROAD_HALF_WIDTH + 4.5), -(ROAD_HALF_WIDTH + 48), 0.0, 10, COAST_U.from, COAST_U.to),
    new THREE.MeshStandardMaterial({ color: 0x6e6044, roughness: 1 })
  );
  beach.receiveShadow = true;
  scene.add(beach);

  // Road surface — textured asphalt with a faintly damp sheen so the
  // streetlights and skyline catch on it; darker (tire-polished) areas
  // read as smoother via the roughness map
  const asphalt = asphaltTexture();
  const road = new THREE.Mesh(
    buildRibbon(track, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0.02, 6),
    new THREE.MeshStandardMaterial({
      map: asphalt,
      roughnessMap: asphalt,
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0.25,
      envMapIntensity: 0.9,
    })
  );
  road.receiveShadow = true;
  scene.add(road);

  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xaaaaaa,
    emissiveIntensity: 0.5,
  });
  scene.add(new THREE.Mesh(buildRibbon(track, -(ROAD_HALF_WIDTH - 0.35), -(ROAD_HALF_WIDTH - 0.15), 0.03), lineMat));
  scene.add(new THREE.Mesh(buildRibbon(track, ROAD_HALF_WIDTH - 0.35, ROAD_HALF_WIDTH - 0.15, 0.03), lineMat));

  {
    const dashGeo = new THREE.PlaneGeometry(0.18, 3);
    dashGeo.rotateX(-Math.PI / 2);
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0xd8d8d8,
      emissive: 0x888888,
      emissiveIntensity: 0.4,
    });
    const boundaries = [-3.5, 0, 3.5];
    const spacing = 14;
    const perLine = Math.floor(L / spacing);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, perLine * boundaries.length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const side = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const fwd = new THREE.Vector3(0, 0, 1);
    let idx = 0;
    for (const b of boundaries) {
      for (let i = 0; i < perLine; i++) {
        const s = i * spacing;
        track.pose(s, b, p, side);
        track.tangentAt(s, tan);
        q.setFromUnitVectors(fwd, tan);
        p.y = 0.03;
        m.compose(p, q, new THREE.Vector3(1, 1, 1));
        dashes.setMatrixAt(idx++, m);
      }
    }
    dashes.instanceMatrix.needsUpdate = true;
    scene.add(dashes);
  }

  // Guardrails
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2ab,
    roughness: 0.4,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });
  scene.add(new THREE.Mesh(buildWall(track, -(ROAD_HALF_WIDTH + 0.6), 0.3, 0.95), railMat));
  scene.add(new THREE.Mesh(buildWall(track, ROAD_HALF_WIDTH + 0.6, 0.3, 0.95), railMat));

  // Streetlights: poles + sodium lamps, alternating sides
  {
    const spacing = 42;
    const count = Math.floor(L / spacing);
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.2, 8.4, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.7 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, count);
    const lampGeo = new THREE.SphereGeometry(0.42, 8, 6);
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xffc873,
      emissive: 0xffaa40,
      emissiveIntensity: 3.2,
      fog: false,
    });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, count);
    // Warm pool of lamplight thrown onto the asphalt below each lamp
    const poolGeo = new THREE.CircleGeometry(8.5, 20);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({
      map: lightPoolTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, count);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const s = i * spacing;
      const sideSign = i % 2 === 0 ? 1 : -1;
      track.pose(s, sideSign * (ROAD_HALF_WIDTH + 1.6), p, tmp);
      m.makeTranslation(p.x, 4.2, p.z);
      poles.setMatrixAt(i, m);
      track.pose(s, sideSign * (ROAD_HALF_WIDTH + 0.6), p, tmp);
      m.makeTranslation(p.x, 8.3, p.z);
      lamps.setMatrixAt(i, m);
      track.pose(s, sideSign * (ROAD_HALF_WIDTH - 2.5), p, tmp);
      m.makeTranslation(p.x, 0.045, p.z);
      pools.setMatrixAt(i, m);
    }
    poles.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
    poles.castShadow = true;
    scene.add(poles, lamps, pools);
  }

  // Cat-eye road studs along both edge lines — they sparkle into the
  // distance under the headlights
  {
    const spacing = 18;
    const count = Math.floor(L / spacing) * 2;
    const studGeo = new THREE.SphereGeometry(0.07, 6, 4);
    const studMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff2c0,
      emissiveIntensity: 1.6,
    });
    const studs = new THREE.InstancedMesh(studGeo, studMat, count);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    let idx = 0;
    for (let i = 0; i < count / 2; i++) {
      const s = i * spacing;
      for (const sideSign of [-1, 1]) {
        track.pose(s, sideSign * (ROAD_HALF_WIDTH - 0.25), p, tmp);
        m.makeTranslation(p.x, 0.06, p.z);
        studs.setMatrixAt(idx++, m);
      }
    }
    studs.instanceMatrix.needsUpdate = true;
    scene.add(studs);
  }

  // City blocks with lit windows
  const windows = windowTexture();
  {
    const count = 230;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ map: windows, color: 0xffffff, roughness: 0.8 });
    const blocks = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const tint = new THREE.Color();
    // Facade variety: concrete grey to warm beige to blue glass
    const palette = [0x8a8f99, 0x9c937e, 0x7c828e, 0x6e7686, 0xa39a85];
    for (let i = 0; i < count; i++) {
      const s = Math.random() * L;
      const u = track.wrap(s) / L;
      // Never on the sea side of the corniche; both sides inland.
      const onCoast = u >= COAST_U.from && u <= COAST_U.to;
      const sideSign = onCoast ? 1 : Math.random() < 0.5 ? 1 : -1;
      const dist = 32 + Math.random() * 110;
      track.pose(s, sideSign * dist, p, tmp);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      // Taller skyline near the city at the top of the lap
      const cityBoost = u > 0.88 || u < 0.06 ? 2.1 : 1;
      const h = (10 + Math.random() * Math.random() * 55) * cityBoost;
      scale.set(12 + Math.random() * 20, h, 12 + Math.random() * 20);
      m.compose(p, q, scale);
      blocks.setMatrixAt(i, m);
      tint.setHex(palette[i % palette.length]).multiplyScalar(0.85 + Math.random() * 0.3);
      blocks.setColorAt(i, tint);
    }
    blocks.instanceMatrix.needsUpdate = true;
    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
    blocks.castShadow = true;
    blocks.receiveShadow = true;
    scene.add(blocks);
  }

  // Palm rows lining the corniche walkway, the whole length of the coast
  {
    const coastLen = (COAST_U.to - COAST_U.from) * L;
    const count = Math.floor(coastLen / 26);
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 6, 6);
    trunkGeo.translate(0, 3, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4327, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const crownGeo = new THREE.ConeGeometry(2.1, 1.6, 7);
    crownGeo.translate(0, 6.4, 0);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2c5e2e, roughness: 1 });
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const s = COAST_U.from * L + (i / count) * coastLen;
      // Sea-side walkway edge, with the occasional inland palm
      const lateral =
        i % 5 === 4
          ? ROAD_HALF_WIDTH + 3 + Math.random() * 4
          : -(ROAD_HALF_WIDTH + 2.6);
      track.pose(s + Math.random() * 6, lateral, p, tmp);
      m.makeTranslation(p.x, 0, p.z);
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    scene.add(trunks, crowns);
  }

  // Landmarks, in real Gulf Road order heading south down the coast
  const towers = kuwaitTowers();
  placeBeside(track, towers, L * 0.016, -52); // Ras Ajouza promontory, ahead of the spawn
  const towersBeacon = makeBeacon(beacons);
  towersBeacon.position.y = 114;
  towers.add(towersBeacon);
  scene.add(towers);
  const towersPad = new THREE.Mesh(
    new THREE.CylinderGeometry(70, 75, 0.8, 20),
    new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 1 })
  );
  towersPad.position.copy(towers.position).setY(0.1);
  scene.add(towersPad);

  const grandMosque = mosque();
  placeBeside(track, grandMosque, L * 0.02, 55); // opposite Souq Sharq
  grandMosque.rotation.y = Math.PI / 5;
  scene.add(grandMosque);

  const island = greenIsland();
  placeBeside(track, island, L * 0.1, -200); // Green Island, out in the water
  scene.add(island);

  const marina = marinaBoats();
  placeBeside(track, marina, L * 0.27, -38); // Salmiya marina bay
  scene.add(marina);

  const sciCenter = scientificCenter();
  placeBeside(track, sciCenter, L * 0.385, -48); // the sail on the waterfront
  scene.add(sciCenter);

  const rasLight = lighthouse();
  placeBeside(track, rasLight, L * 0.465, -28); // Ras Al-Ard point
  scene.add(rasLight);

  const wt = waterTowers(stripeTexture("#7ec8e3", "#ffffff"));
  placeBeside(track, wt, L * 0.62, 65); // inland leg, Hawally side
  scene.add(wt);

  const m2 = mosque();
  placeBeside(track, m2, L * 0.75, -60);
  m2.rotation.y = Math.PI / 3;
  scene.add(m2);

  const lib = liberationTower(windows);
  placeBeside(track, lib, L * 0.9, 130); // city centre, inland of the top curve
  const libBeacon = makeBeacon(beacons);
  libBeacon.position.y = 134;
  lib.add(libBeacon);
  scene.add(lib);

  const hamra = alHamra(windows);
  placeBeside(track, hamra, L * 0.96, 80); // Sharq skyline by the start
  const hamraBeacon = makeBeacon(beacons);
  hamraBeacon.position.y = 60; // local to the 118 m box, centred at 59
  hamra.add(hamraBeacon);
  scene.add(hamra);

  // Kuwait flag at the start line
  {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 14, 6),
      new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.4, metalness: 0.6 })
    );
    pole.position.y = 7;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 3),
      new THREE.MeshStandardMaterial({
        map: flagTexture(),
        side: THREE.DoubleSide,
        emissive: 0x444444,
      })
    );
    flag.position.set(3.1, 12.2, 0);
    const g = new THREE.Group();
    g.add(pole, flag);
    placeBeside(track, g, 0, -(ROAD_HALF_WIDTH + 4));
    scene.add(g);
  }

  // Area gantry signs at each district boundary
  AREAS.forEach((area, i) => {
    const s = (i / AREAS.length) * L;
    const g = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6 });
    for (const sideSign of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 7.5, 8), postMat);
      post.position.set(sideSign * (ROAD_HALF_WIDTH + 1.2), 3.75, 0);
      g.add(post);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry((ROAD_HALF_WIDTH + 1.5) * 2, 0.5, 0.5),
      postMat
    );
    beam.position.y = 7.3;
    g.add(beam);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 3.1),
      new THREE.MeshStandardMaterial({
        map: signTexture(area.name.toUpperCase(), area.arabic),
        emissive: 0x666666,
        side: THREE.DoubleSide,
      })
    );
    board.position.y = 5.4;
    g.add(board);

    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    track.pointAt(s, p);
    track.tangentAt(s, tan);
    g.position.copy(p);
    // Face the board toward oncoming traffic.
    g.lookAt(p.clone().sub(tan));
    scene.add(g);
  });

  let time = 0;
  return {
    moonLight,
    tick(dt: number) {
      time += dt;
      // Slow drift of the wave crests across the bay
      seaMap.offset.x += dt * 0.008;
      seaMap.offset.y -= dt * 0.013;
      // Aircraft-warning beacons pulse out of phase
      beacons.forEach((b, i) => {
        b.emissiveIntensity = 0.25 + 2.75 * Math.max(0, Math.sin(time * 1.8 + i * 2.1));
      });
    },
  };
}
