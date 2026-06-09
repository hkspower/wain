import * as THREE from "three";
import { Track, ROAD_HALF_WIDTH } from "./track";

// Night-time Kuwait: sand, sea, sodium streetlights, and the skyline —
// Kuwait Towers by the water, Liberation Tower, Al Hamra, the striped
// mushroom water towers, palms along the corniche and a mosque inland.

export const AREAS = [
  { name: "Kuwait City", arabic: "مدينة الكويت" },
  { name: "Sharq", arabic: "شرق" },
  { name: "Salmiya", arabic: "السالمية" },
  { name: "Hawally", arabic: "حولي" },
  { name: "Fahaheel", arabic: "الفحيحيل" },
  { name: "Jahra", arabic: "الجهراء" },
];

export function areaAt(track: Track, s: number) {
  const u = track.wrap(s) / track.length;
  return AREAS[Math.min(AREAS.length - 1, Math.floor(u * AREAS.length))];
}

/** Flat ribbon following the track between lateral offsets a..b at height y. */
function buildRibbon(track: Track, a: number, b: number, y: number, step = 8): THREE.BufferGeometry {
  const n = Math.ceil(track.length / step);
  const positions = new Float32Array((n + 1) * 2 * 3);
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();

  for (let i = 0; i <= n; i++) {
    const s = (i / n) * track.length;
    track.pointAt(s, p);
    track.sideAt(s, side);
    const o = i * 6;
    positions[o] = p.x + side.x * a;
    positions[o + 1] = y;
    positions[o + 2] = p.z + side.z * a;
    positions[o + 3] = p.x + side.x * b;
    positions[o + 4] = y;
    positions[o + 5] = p.z + side.z * b;
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

/** Place an object beside the track: distance s along, `offset` metres right (+) or left (-). */
function placeBeside(track: Track, obj: THREE.Object3D, s: number, offset: number) {
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  track.pointAt(s, p);
  track.sideAt(s, side);
  obj.position.set(p.x + side.x * offset, 0, p.z + side.z * offset);
}

export function buildWorld(scene: THREE.Scene, track: Track): void {
  const L = track.length;

  // Sky, fog, light
  scene.background = new THREE.Color(0x05070f);
  scene.fog = new THREE.FogExp2(0x05070f, 0.0021);
  scene.add(new THREE.HemisphereLight(0x3a4a6b, 0x1a140c, 0.55));
  const moon = new THREE.DirectionalLight(0xbfd0ff, 0.5);
  moon.position.set(-300, 500, 200);
  scene.add(moon);

  // Stars
  {
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * 0.45 + 0.08;
      const r = 2600;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r + 550;
      pos[i * 3 + 1] = Math.sin(e) * r * 0.5;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r - 600;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xcdd8ff, size: 2.4, sizeAttenuation: false, fog: false })
    );
    scene.add(stars);
  }

  // Desert floor and the Gulf
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(7000, 7000),
    new THREE.MeshStandardMaterial({ color: 0x241d12, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(550, -0.08, -600);
  scene.add(ground);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(2200, 3200),
    new THREE.MeshStandardMaterial({
      color: 0x0a2236,
      roughness: 0.25,
      metalness: 0.4,
      emissive: 0x06283f,
      emissiveIntensity: 0.4,
    })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(2480, -0.04, -600);
  scene.add(sea);

  // Road surface, edge lines, lane dashes
  const road = new THREE.Mesh(
    buildRibbon(track, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.95 })
  );
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
    }
    poles.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    scene.add(poles, lamps);
  }

  // City blocks with lit windows
  const windows = windowTexture();
  {
    const count = 230;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ map: windows, color: 0x8a8f99, roughness: 0.8 });
    const blocks = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const s = Math.random() * L;
      const u = track.wrap(s) / L;
      // Leave the seaside straight (first sixth) sparse — that's the corniche.
      const sideSign = u < 1 / 6 ? -1 : Math.random() < 0.5 ? 1 : -1;
      const dist = 32 + Math.random() * 110;
      track.pose(s, sideSign * dist, p, tmp);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      const h = 10 + Math.random() * Math.random() * 55;
      scale.set(12 + Math.random() * 20, h, 12 + Math.random() * 20);
      m.compose(p, q, scale);
      blocks.setMatrixAt(i, m);
    }
    blocks.instanceMatrix.needsUpdate = true;
    scene.add(blocks);
  }

  // Palms along the corniche (seaside stretch) median-free roadside
  {
    const count = 110;
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
      const s = (i / count) * L * 0.35 + L * 0.0;
      const sideSign = i % 2 === 0 ? 1 : -1;
      track.pose(s + Math.random() * 8, sideSign * (ROAD_HALF_WIDTH + 4 + Math.random() * 5), p, tmp);
      m.makeTranslation(p.x, 0, p.z);
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    scene.add(trunks, crowns);
  }

  // Landmarks
  const towers = kuwaitTowers();
  placeBeside(track, towers, L * 0.06, 70);
  scene.add(towers);

  const wt = waterTowers(stripeTexture("#7ec8e3", "#ffffff"));
  placeBeside(track, wt, L * 0.3, -60);
  scene.add(wt);

  const lib = liberationTower(windows);
  placeBeside(track, lib, L * 0.93, -120);
  scene.add(lib);

  const hamra = alHamra(windows);
  placeBeside(track, hamra, L * 0.97, 90);
  scene.add(hamra);

  const m1 = mosque();
  placeBeside(track, m1, L * 0.55, -55);
  m1.rotation.y = Math.PI / 3;
  scene.add(m1);

  const m2 = mosque();
  placeBeside(track, m2, L * 0.78, 60);
  scene.add(m2);

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
}
