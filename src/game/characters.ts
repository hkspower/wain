import * as THREE from "three";

// The people of Gulf Road Nights: spectators on the corniche and the
// racers who stand beside their machines. Everything here is built from
// primitives at roughly 1.75 m tall — these are read at 20-plus metres
// through a windscreen at night, so they are silhouettes with the right
// proportions and the right dress, not portraits.

/** The red-and-white check of a Kuwaiti shemagh, tiling. */
export function ghutraCheckTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f4f2ec";
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "#b32428";
  for (let i = 4; i <= 64; i += 8) {
    ctx.lineWidth = i % 16 === 4 ? 2.5 : 1;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 64);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(64, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The flag of Kuwait — green, white and red bands behind a black hoist
 *  trapezoid. Flown on the corniche masts and worn as a sleeve patch. */
export function flagTexture(): THREE.CanvasTexture {
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

const SKIN = () => new THREE.MeshStandardMaterial({ color: 0xb9895f, roughness: 0.75 });

/** Ghutra over the crown with a fall down the back, cinched by the agal.
 *  Added to `g` around a head centred at `headY`. */
function addGhutra(g: THREE.Group, headY: number, headdress: "white" | "check"): void {
  const clothMat =
    headdress === "check"
      ? new THREE.MeshStandardMaterial({ map: ghutraCheckTexture(), roughness: 0.85 })
      : new THREE.MeshStandardMaterial({ color: 0xf6f4ee, roughness: 0.85 });
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.132, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    clothMat
  );
  cap.position.y = headY + 0.005;
  g.add(cap);
  // The fall reaches the shoulders — a ghutra that stops at the ears
  // reads as a swimming cap, which is exactly how it looked before.
  const drape = new THREE.Mesh(new THREE.ConeGeometry(0.175, 0.46, 10, 1, true), clothMat);
  drape.position.set(0, headY - 0.16, -0.05);
  g.add(drape);
  const agal = new THREE.Mesh(
    new THREE.TorusGeometry(0.125, 0.017, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.6 })
  );
  agal.rotation.x = Math.PI / 2;
  agal.position.y = headY + 0.06;
  g.add(agal);
}

/** A spectator in Kuwaiti dress, ~1.75 m tall. Men wear the white
 *  dishdasha with a ghutra (plain white or red check) held by a black
 *  agal; the woman wears an abaya and hijab. */
export function kuwaitiFigure(
  kind: "dishdasha" | "abaya",
  headdress: "white" | "check"
): THREE.Group {
  const g = new THREE.Group();
  const cloth =
    kind === "dishdasha"
      ? new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.85 })
      : new THREE.MeshStandardMaterial({ color: 0x17171b, roughness: 0.9 });
  const skin = SKIN();

  // Robe: one tapered fall from the shoulders to the ground
  const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.295, 1.3, 10), cloth);
  robe.position.y = 0.65;
  g.add(robe);
  // Shoulders round the top of the robe off
  const shoulders = new THREE.Mesh(
    new THREE.SphereGeometry(0.165, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    cloth
  );
  shoulders.position.y = 1.3;
  g.add(shoulders);
  // Arms resting at the sides
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 0.56, 6), cloth);
    arm.position.set(side * 0.2, 1.02, 0);
    arm.rotation.z = side * 0.13;
    g.add(arm);
  }

  const headY = 1.5;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 9), skin);
  head.position.y = headY;
  g.add(head);

  if (kind === "dishdasha") {
    addGhutra(g, headY, headdress);
  } else {
    // Hijab: the head wrapped in the abaya's black, the face open
    const wrap = new THREE.Mesh(new THREE.SphereGeometry(0.128, 12, 9), cloth);
    wrap.position.y = headY;
    g.add(wrap);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.068, 12), skin);
    face.position.set(0, headY + 0.01, 0.126);
    g.add(face);
  }

  for (const m of g.children) m.castShadow = true;
  return g;
}

export interface RacerLook {
  /** Suit colour and the contrast of its yoke, cuffs and helmet stripe. */
  suitColor: number;
  accentColor: number;
  /** Woman racers wear a hijab under the helmet, or on show when the
   *  helmet is carried; men wear the ghutra between runs. */
  woman?: boolean;
  /** Helmet on the head, ready to run — or tucked under the arm, which
   *  is what leaves the Kuwaiti headdress on show. */
  helmet: "worn" | "carried";
  headdress?: "white" | "check";
}

/** A racer standing by their car: fireproof suit, gloves, boots, and a
 *  painted helmet either worn or carried at the hip. Between runs the
 *  men put the ghutra back on and the woman keeps her hijab, so the grid
 *  reads as Kuwaiti even with the helmets off. */
export function kuwaitiRacer(look: RacerLook): THREE.Group {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: look.suitColor, roughness: 0.62 });
  const accent = new THREE.MeshStandardMaterial({ color: look.accentColor, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x121216, roughness: 0.55 });
  const skin = SKIN();

  // Legs: a race suit has two of them, unlike the robed spectators
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.068, 0.84, 7), suit);
    leg.position.set(side * 0.1, 0.44, 0);
    g.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.26), dark);
    boot.position.set(side * 0.1, 0.05, 0.03);
    g.add(boot);
  }

  // Torso, with the contrast yoke across the shoulders
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.155, 0.6, 9), suit);
  torso.position.y = 1.15;
  g.add(torso);
  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.181, 0.181, 0.13, 9), accent);
  yoke.position.y = 1.4;
  g.add(yoke);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.163, 0.163, 0.07, 9), dark);
  belt.position.y = 0.9;
  g.add(belt);
  // Kuwait flag on the chest — the patch every driver here wears
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(0.13, 0.075),
    new THREE.MeshStandardMaterial({ map: flagTexture(), roughness: 0.7 })
  );
  patch.position.set(0.055, 1.24, 0.168);
  g.add(patch);

  const headY = 1.64;
  const helmetR = 0.145;

  // Arms are rigged as groups pivoting at the shoulder, with the glove
  // (and the carried helmet) as children at the wrist — placed in world
  // space they drift off the end of the limb the moment the arm rotates.
  const carrySide = -1;
  const armPivots: Record<number, THREE.Group> = {};
  for (const side of [-1, 1]) {
    const carrying = look.helmet === "carried" && side === carrySide;
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.19, 1.4, 0);
    pivot.rotation.z = side * (carrying ? 0.16 : 0.1);
    pivot.rotation.x = carrying ? -0.5 : 0;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.044, 0.54, 6), suit);
    arm.position.y = -0.27;
    pivot.add(arm);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), accent);
    glove.position.y = -0.56;
    pivot.add(glove);
    g.add(pivot);
    armPivots[side] = pivot;
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 9), skin);
  head.position.y = headY;
  g.add(head);

  const buildHelmet = (): THREE.Group => {
    const h = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(helmetR, 14, 11),
      new THREE.MeshStandardMaterial({
        color: look.suitColor,
        roughness: 0.18,
        metalness: 0.25,
        envMapIntensity: 1.4,
      })
    );
    h.add(shell);
    // Centre stripe over the crown, in the suit's accent
    const stripe = new THREE.Mesh(
      new THREE.SphereGeometry(helmetR + 0.004, 14, 11, -0.16, 0.32, 0, Math.PI),
      accent
    );
    h.add(stripe);
    // Smoked visor: a band of the sphere facing forward
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(helmetR + 0.008, 14, 10, Math.PI * 0.32, Math.PI * 0.36, Math.PI * 0.34, Math.PI * 0.3),
      new THREE.MeshStandardMaterial({
        color: 0x141a26,
        roughness: 0.08,
        metalness: 0.85,
        envMapIntensity: 2.0,
      })
    );
    visor.rotation.y = -Math.PI / 2;
    h.add(visor);
    // Chin bar closing the front of the shell
    const chin = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.07, 0.08), dark);
    chin.position.set(0, -0.095, 0.105);
    h.add(chin);
    return h;
  };

  const helmet = buildHelmet();
  if (look.helmet === "worn") {
    helmet.position.y = headY + 0.022;
    g.add(helmet);
    if (look.woman) {
      // The hijab worn under the helmet still shows at the neck
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.115, 0.145, 0.17, 10),
        new THREE.MeshStandardMaterial({ color: look.accentColor, roughness: 0.88 })
      );
      neck.position.y = headY - 0.16;
      g.add(neck);
    }
  } else {
    // Held at the hip in the gloved hand, visor turned outward. Hung off
    // the arm pivot so hand and helmet stay together.
    helmet.position.set(0, -0.68, 0.05);
    helmet.rotation.y = carrySide * 0.6;
    armPivots[carrySide].add(helmet);
    if (look.woman) {
      const wrapMat = new THREE.MeshStandardMaterial({
        color: look.accentColor,
        roughness: 0.88,
      });
      const wrap = new THREE.Mesh(new THREE.SphereGeometry(0.128, 12, 9), wrapMat);
      wrap.position.y = headY;
      g.add(wrap);
      // The hijab drapes over the shoulders, which is what separates it
      // from a plain skullcap at a glance
      const fall = new THREE.Mesh(new THREE.ConeGeometry(0.185, 0.5, 12, 1, true), wrapMat);
      fall.position.set(0, headY - 0.18, -0.03);
      g.add(fall);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.068, 12), skin);
      face.position.set(0, headY + 0.01, 0.126);
      g.add(face);
    } else {
      addGhutra(g, headY, look.headdress ?? "white");
    }
  }

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}
