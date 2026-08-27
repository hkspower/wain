import * as THREE from "three";
import { RIG } from "./rig";
import { flagTexture as countryFlag, type FlagId } from "./flags";

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

/**
 * The flag of Kuwait, for the callers that only ever wanted that one.
 *
 * The drawing moved to flags.ts, which draws seventeen of them from
 * their own specifications at four times this resolution. Kept as a
 * name because the mast at the start line and the patch on a driver's
 * chest both ask for it by this name, and neither of them cares that
 * there are now sixteen others.
 */
export function flagTexture(): THREE.CanvasTexture {
  return countryFlag("kw");
}

const SKIN = () => new THREE.MeshStandardMaterial({ color: 0xb9895f, roughness: 0.75 });

/** Ghutra over the crown with a fall down the back, cinched by the agal.
 *  Added to `g` around a head centred at `headY`. */
function addGhutra(g: THREE.Object3D, headY: number, headdress: "white" | "check"): void {
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
  // Arms as two-bone chains resting at the sides. The crowd does more
  // than stand now — a hand goes up when the race goes past — and a
  // cylinder glued to the robe cannot wave.
  const armUpper = RIG.spectator.upperArm;
  const armLower = RIG.spectator.foreArm;
  const arms: ArmChain[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Object3D();
    shoulder.position.set(side * RIG.spectator.shoulderX, RIG.spectator.shoulderY, 0);
    shoulder.rotation.z = side * RIG.spectator.armAbduction;
    g.add(shoulder);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.044, armUpper, 6), cloth);
    sleeve.position.y = -armUpper / 2;
    shoulder.add(sleeve);
    const elbow = new THREE.Object3D();
    elbow.position.y = -armUpper;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.04, armLower, 6), cloth);
    fore.position.y = -armLower / 2;
    elbow.add(fore);
    const hand = new THREE.Object3D();
    hand.position.y = -armLower;
    elbow.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), skin);
    hand.add(palm);
    arms.push({ shoulder, elbow, hand, upper: armUpper, lower: armLower, side });
  }
  g.userData.arms = arms;

  const headY = RIG.spectator.headY;
  // The head is a joint, not a ball glued to a robe: the crowd turns to
  // watch a car go past, and the neck has to be able to do that.
  const headJoint = new THREE.Object3D();
  headJoint.position.y = headY;
  g.add(headJoint);
  g.userData.head = headJoint;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 9), skin);
  headJoint.add(head);

  if (kind === "dishdasha") {
    addGhutra(headJoint, 0, headdress);
  } else {
    // Hijab: the head wrapped in the abaya's black, the face open
    const wrap = new THREE.Mesh(new THREE.SphereGeometry(0.128, 12, 9), cloth);
    headJoint.add(wrap);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.068, 12), skin);
    face.position.set(0, 0.01, 0.126);
    headJoint.add(face);
  }

  g.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    o.castShadow = true;
    // And receives. A person cast but did not receive, so a driver sat
    // in full moonlight inside a car that was itself in shadow, and a
    // spectator standing under a flyover was lit as if it were not
    // there. Casting without receiving is how a figure ends up looking
    // pasted onto the scene rather than standing in it.
    o.receiveShadow = true;
  });
  return g;
}

/** One two-bone limb an IK solver can drive: root → mid → end with the
 *  bone lengths between them. The field names read as an arm; a leg
 *  threads hip/knee/foot through the same shape, because the solver
 *  neither knows nor cares which limb it is straightening. */
export interface ArmChain {
  shoulder: THREE.Object3D;
  elbow: THREE.Object3D;
  hand: THREE.Object3D;
  upper: number;
  lower: number;
  side: number;
}

/** The rig an IK solver needs: joints, bone lengths, and the parts a
 *  caller animates. */
export interface DriverRig {
  group: THREE.Group;
  /** The driver's body, minus the wheel and pedals they are holding.
   *  Rotating this leans the whole person and lets the IK put their
   *  hands and feet back where they were. */
  lean: THREE.Group;
  arms: ArmChain[];
  /** Hip → knee → foot, read through the ArmChain field names. */
  legs: ArmChain[];
  head: THREE.Object3D;
  wheel: THREE.Object3D;
  /** Rim radius, so the caller can put hands at ten-to-two. */
  wheelRadius: number;
  /** Pedal faces the feet are solved onto. Each remembers its rest
   *  position in userData (restY/restZ) so a press can sink it and the
   *  foot can follow the moving face. */
  pedals: { throttle: THREE.Object3D; brake: THREE.Object3D };
  /** The handbrake lever, pivoting at its base; userData.restRotX holds
   *  the rest rake so a pull can raise it and the inboard hand can be
   *  solved onto the moving grip. A stub on lean rigs — background cars
   *  never pull it, and a lever nobody reaches for is a draw call. */
  handbrake: THREE.Object3D;
  /** How far the inboard hand is committed to the lever, 0 on the rim
   *  to 1 on the grip. State lives on the rig because the solver is a
   *  free function: it must ease identically whichever engine, menu or
   *  film happens to be calling it this frame. */
  hbBlend: number;
}

/**
 * The driver, seated, with arms built as real two-bone chains so IK can
 * put their hands on the wheel rather than parenting them there. Seen
 * through the glass and in the versus film, so the pose matters more
 * than the polygon count.
 */
export function kuwaitiDriver(
  suitColor = 0x1d2026,
  skinTone = 0xb9895f,
  /**
   * Background cars get a lean build: torso, head, helmet and the two
   * arms that hold the wheel — no legs, no pedal box, no visor. Those
   * exist for the cabin you can actually look into. A traffic driver is
   * a silhouette behind glass at thirty metres, and thirty of them
   * carrying a full footwell is draw calls spent where no one is
   * looking. The ARMS stay, because the hands on the wheel are the
   * whole point: an empty driver's seat in the next lane is what this
   * change is fixing.
   */
  lean = false
): DriverRig {
  const group = new THREE.Group();
  /**
   * The person, as distinct from the car parts they are touching.
   *
   * The wheel and the pedal box live on `group` because they are bolted
   * to the car; the torso, head, shoulders and hips live in here because
   * they are not. Under cornering load a driver moves and the wheel does
   * not, and with the two on the same node there was no way to say so.
   *
   * Leaning THIS is what makes the whole body answer to g: the arms and
   * legs are solved by IK onto world-space targets on the wheel and the
   * pedals, so moving their roots makes the limbs re-solve to stay where
   * they are gripping. That is the entire reason to have IK rather than
   * a parented pose, and until now nothing had ever asked it for that.
   */
  const body = new THREE.Group();
  group.add(body);
  const suit = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: skinTone, roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.55 });

  // Torso, leaned back into the seat the way a driver sits
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.185, 0.46, 9), suit);
  torso.position.set(0, 0.23, -0.02);
  torso.rotation.x = -0.16;
  body.add(torso);

  const head = new THREE.Object3D();
  head.position.set(0, RIG.driver.headY, RIG.driver.headZ);
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.112, 12, 9), skin);
  // Sealed inside the helmet below, which is what a helmet is for. The
  // mesh audit looks for geometry that never paints a pixel; this is the
  // one case where that is the intended result, so say so here rather
  // than let it come back as a finding on every car in the fleet.
  skull.userData.hiddenBy = "helmet";
  head.add(skull);
  // A helmet, because this is a race and the ghutra is for the pit lane
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.135, 14, 10),
    new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.2, metalness: 0.3 })
  );
  helmet.userData.driverPart = "helmet";
  head.add(helmet);
  if (!lean) {
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.139, 14, 10, Math.PI * 0.32, Math.PI * 0.36, Math.PI * 0.34, Math.PI * 0.3),
      new THREE.MeshStandardMaterial({ color: 0x141a26, roughness: 0.08, metalness: 0.85 })
    );
    visor.rotation.y = -Math.PI / 2;
    visor.userData.driverPart = "visor";
    head.add(visor);
  }

  // The wheel the hands will be solved onto
  const wheelRadius = RIG.driver.wheelRadius;
  const wheel = new THREE.Object3D();
  wheel.position.set(0, RIG.driver.wheelY, RIG.driver.wheelZ);
  wheel.rotation.x = RIG.driver.wheelRake; // raked toward the driver, like a real column
  group.add(wheel);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(wheelRadius, 0.018, 8, 24),
    dark
  );
  rim.userData.driverPart = "wheel";
  wheel.add(rim);
  // Spokes are three draw calls that only read at cabin range. Thirty
  // background cars carrying them is ninety calls spent on detail no
  // one can resolve; the rim alone is what the hands need.
  for (let i = 0; i < (lean ? 0 : 3); i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.022, wheelRadius, 0.012), dark);
    spoke.position.y = -wheelRadius / 2;
    const holder = new THREE.Object3D();
    holder.rotation.z = (i / 3) * Math.PI * 2;
    holder.add(spoke);
    wheel.add(holder);
  }

  // Arms as chains: shoulder → elbow → hand, each bone along -Y so the
  // solver's default bone axis applies without special cases.
  // Adult arm: upper 0.29, forearm 0.26. The first pass used 0.20/0.19,
  // which cannot reach a steering wheel from a seat — the solver
  // correctly straightened the arm and the hand hung 36 cm short.
  const upper = RIG.driver.upperArm;
  const lower = RIG.driver.foreArm;
  const arms: DriverRig["arms"] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Object3D();
    shoulder.position.set(side * RIG.driver.shoulderX, RIG.driver.shoulderY, RIG.driver.shoulderZ);
    body.add(shoulder);
    const upperMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.042, upper, 6), suit);
    upperMesh.position.y = -upper / 2;
    shoulder.add(upperMesh);

    const elbow = new THREE.Object3D();
    elbow.position.y = -upper;
    shoulder.add(elbow);
    const foreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, lower, 6), suit);
    foreMesh.position.y = -lower / 2;
    elbow.add(foreMesh);

    const hand = new THREE.Object3D();
    hand.position.y = -lower;
    elbow.add(hand);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), dark);
    glove.userData.driverPart = "glove";
    hand.add(glove);

    arms.push({ shoulder, elbow, hand, upper, lower, side });
  }

  // Pedal box, right-hand drive: throttle outboard, brake inboard. Each
  // pedal remembers where it sits at rest so the engine can press it in
  // and the foot's IK target rides the moving face.
  const mkPedal = (x: number): THREE.Object3D => {
    const pedal = new THREE.Object3D();
    pedal.position.set(x, RIG.driver.pedalY, RIG.driver.pedalZ);
    pedal.rotation.x = RIG.driver.pedalPitch;
    pedal.userData.restY = pedal.position.y;
    pedal.userData.restZ = pedal.position.z;
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.02), dark);
    face.userData.driverPart = "pedal";
    pedal.add(face);
    group.add(pedal);
    return pedal;
  };
  const pedals = lean
    ? { throttle: new THREE.Object3D(), brake: new THREE.Object3D() }
    : { throttle: mkPedal(RIG.driver.pedalThrottleX), brake: mkPedal(RIG.driver.pedalBrakeX) };

  // The handbrake, between the seats. A pivot at the base, the lever
  // rising back toward the driver at its rest rake, a knob at the top —
  // the one control in the cab a hand LEAVES the wheel for, which is
  // exactly why it has to exist: a drift with both hands at ten-to-two
  // is a car sliding with nobody making it.
  const handbrake = new THREE.Object3D();
  if (!lean) {
    handbrake.position.set(RIG.driver.handbrakeX, RIG.driver.handbrakeY, RIG.driver.handbrakeZ);
    handbrake.rotation.x = RIG.driver.handbrakeTilt;
    handbrake.userData.restRotX = handbrake.rotation.x;
    const hbLen = RIG.driver.handbrakeLen;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, hbLen, 6), dark);
    rod.position.y = hbLen / 2;
    handbrake.add(rod);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), suit);
    knob.userData.driverPart = "handbrake-grip";
    knob.position.y = hbLen;
    handbrake.add(knob);
    group.add(handbrake);
  }

  // Legs: hip → knee → foot, the same two-bone chains as the arms, so
  // the feet can be solved onto the pedals and follow them as they
  // press. The rest pose reads as seated even before a solver runs —
  // garage and film cars are built, not updated every frame.
  const thigh = RIG.driver.thigh;
  const shin = RIG.driver.shin;
  const legs: ArmChain[] = [];
  for (const side of lean ? [] : [-1, 1]) {
    const hip = new THREE.Object3D();
    hip.position.set(side * RIG.driver.hipX, RIG.driver.hipY, RIG.driver.hipZ);
    hip.rotation.x = RIG.driver.hipPitch;
    body.add(hip);
    const thighMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.054, thigh, 7), suit);
    thighMesh.position.y = -thigh / 2;
    hip.add(thighMesh);
    const knee = new THREE.Object3D();
    knee.position.y = -thigh;
    knee.rotation.x = RIG.driver.kneePitch;
    hip.add(knee);
    const shinMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, shin, 7), suit);
    shinMesh.position.y = -shin / 2;
    knee.add(shinMesh);
    const foot = new THREE.Object3D();
    foot.position.y = -shin;
    knee.add(foot);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.15), dark);
    shoe.position.set(0, 0, 0.04);
    foot.add(shoe);
    legs.push({ shoulder: hip, elbow: knee, hand: foot, upper: thigh, lower: shin, side });
  }

  group.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    o.castShadow = true;
    // And receives. A person cast but did not receive, so a driver sat
    // in full moonlight inside a car that was itself in shadow, and a
    // spectator standing under a flyover was lit as if it were not
    // there. Casting without receiving is how a figure ends up looking
    // pasted onto the scene rather than standing in it.
    o.receiveShadow = true;
  });
  return { group, lean: body, arms, legs, head, wheel, wheelRadius, pedals , handbrake, hbBlend: 0 };
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

  const headY = RIG.racer.headY;
  const helmetR = 0.145;

  // Arms as shoulder → elbow → hand chains — the same rig the solver
  // drives everywhere else, with the glove (and the carried helmet) as
  // children at the wrist so they stay on the limb however it is posed.
  // A racer can wave the free arm at a passing run while the other
  // keeps its hold on the helmet.
  const carrySide = -1;
  const armUpper = RIG.racer.upperArm;
  const armLower = RIG.racer.foreArm;
  const arms: ArmChain[] = [];
  for (const side of [-1, 1]) {
    const carrying = look.helmet === "carried" && side === carrySide;
    const shoulder = new THREE.Object3D();
    shoulder.position.set(side * RIG.racer.shoulderX, RIG.racer.shoulderY, 0);
    shoulder.rotation.z = side * (carrying ? 0.16 : 0.1);
    shoulder.rotation.x = carrying ? -0.5 : 0;
    g.add(shoulder);
    const armMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.046, armUpper, 6), suit);
    armMesh.position.y = -armUpper / 2;
    shoulder.add(armMesh);
    const elbow = new THREE.Object3D();
    elbow.position.y = -armUpper;
    shoulder.add(elbow);
    const foreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.042, armLower, 6), suit);
    foreMesh.position.y = -armLower / 2;
    elbow.add(foreMesh);
    const hand = new THREE.Object3D();
    hand.position.y = -armLower;
    elbow.add(hand);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), accent);
    hand.add(glove);
    arms.push({ shoulder, elbow, hand, upper: armUpper, lower: armLower, side });
  }
  g.userData.arms = arms;
  // The helmet hand is spoken for; the wave comes from the other one.
  g.userData.waveSide = -carrySide;

  // The head is a joint here too — the crew at the line turn to follow
  // a run exactly like the corniche crowd does, so the skull, helmet
  // and headdress all have to ride one neck.
  const headJoint = new THREE.Object3D();
  headJoint.position.y = headY;
  g.add(headJoint);
  g.userData.head = headJoint;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 9), skin);
  headJoint.add(head);

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
    helmet.position.y = 0.022;
    headJoint.add(helmet);
    // Enclosed by design — see the note on the lean driver's skull.
    head.userData.hiddenBy = "helmet";
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
    // Held at the hip in the gloved hand, visor turned outward. Hung
    // off the wrist joint so hand and helmet stay together whatever the
    // arm does.
    helmet.position.set(0, -0.13, 0.05);
    helmet.rotation.y = carrySide * 0.6;
    arms.find((a) => a.side === carrySide)!.hand.add(helmet);
    if (look.woman) {
      const wrapMat = new THREE.MeshStandardMaterial({
        color: look.accentColor,
        roughness: 0.88,
      });
      const wrap = new THREE.Mesh(new THREE.SphereGeometry(0.128, 12, 9), wrapMat);
      headJoint.add(wrap);
      // The hijab drapes over the shoulders, which is what separates it
      // from a plain skullcap at a glance
      const fall = new THREE.Mesh(new THREE.ConeGeometry(0.185, 0.5, 12, 1, true), wrapMat);
      fall.position.set(0, -0.18, -0.03);
      headJoint.add(fall);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.068, 12), skin);
      face.position.set(0, 0.01, 0.126);
      headJoint.add(face);
    } else {
      addGhutra(headJoint, 0, look.headdress ?? "white");
    }
  }

  g.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    o.castShadow = true;
    // And receives. A person cast but did not receive, so a driver sat
    // in full moonlight inside a car that was itself in shadow, and a
    // spectator standing under a flyover was lit as if it were not
    // there. Casting without receiving is how a figure ends up looking
    // pasted onto the scene rather than standing in it.
    o.receiveShadow = true;
  });
  return g;
}
