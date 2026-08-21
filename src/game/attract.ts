import * as THREE from "three";
import { createCar, type CarColors } from "./cars";
import { nightEnvironment } from "./env";

// The main menu's turntable.
//
// A menu that opens on a flat gradient tells you nothing; a menu that
// opens on YOUR car, the one you bought and modified, lit like a
// showroom at 2 a.m., is the game introducing itself. This is a small
// self-contained scene — one car, a pool of light, a ring of lamps —
// not the race world, so the menu appears immediately and costs a
// fraction of a frame instead of the full city.
//
// It shares the race's environment map (env.ts), so the paint here
// mirrors the same night you are about to drive into.

/**
 * THE ROLLING LOOP
 *
 * A turntable is a showroom. The game is not a showroom — it is two cars
 * side by side on the corniche at one in the morning — and the menu is
 * the longest a player looks at any single screen before deciding what
 * they think of it. So the menu rolls: your car and the machine you are
 * about to meet, abreast at 90, lamps sweeping over both, road running
 * out from under them.
 *
 * It is a loop rather than a clip. The cars stay where they are and the
 * WORLD scrolls past — road texture, lamps, kerb — with every prop
 * recycled the moment it passes behind the camera, so there is no seam
 * to hide because there is no join. Every period in the scene divides
 * LOOP_S: the lamps pass every 1.2 s, the lane dashes every 0.6, the
 * camera breathes and the pair weaves on 6 and 12. Twelve seconds in,
 * the picture is the picture you started with, to the pixel.
 *
 * (The wheels are the one exception, and deliberately: 300 m of road is
 * not a whole number of turns of a 0.66 m tyre, and rounding the road
 * speed until it was would be a lie told to make a test pass. They spin
 * at the speed the road is actually moving.)
 */
export interface AttractOptions {
  /** "rolling" is the menu; "turntable" is the showroom capture, which
   *  needs one car held at a fixed angle to compare fifteen of them. */
  mode?: "turntable" | "rolling";
  /** The machine alongside — the next legend's car. Rolling only. */
  second?: CarColors;
}

export interface AttractHandle {
  /** Rebuild the car — the garage changed underneath the menu. */
  setCar(colors: CarColors): void;
  resize(): void;
  /** Frames drawn so far. The menu test watches this to prove the
   *  turntable is live rather than a still — reading the canvas back
   *  cannot prove it, since WebGL discards the drawing buffer on
   *  composite and hands a scripted readPixels a screenful of zeros. */
  readonly frames: number;
  /** Triangles submitted by the last frame: nonzero means the car is
   *  genuinely in front of the camera and not merely built. */
  readonly triangles: number;
  /** Turntable angle, for a test that wants to see it actually turn.
   *  In rolling mode this is the loop phase, 0 to 1. */
  readonly angle: number;
  /** How far the world has scrolled, in metres. Rolling only; 0 on a
   *  turntable. A test cannot read the canvas back, so the scene says
   *  where it is. */
  readonly travelled: number;
  /** Seconds for the picture to come back around. */
  readonly loopSeconds: number;
  /** The scene and what is moving in it, for a test that has to look.
   *  Nothing in the game reads these — the drawing buffer is gone by the
   *  time a script can sample it, so the only way to check that a lamp
   *  went past is to ask the lamp. */
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly cars: THREE.Group[];
  /** Freeze the turntable at a fixed angle, or pass null to let it sweep
   *  again. The showroom capture uses this so all fourteen cars are
   *  caught at the same three-quarter view instead of at fourteen
   *  different moments of the same sweep, which is the difference
   *  between a comparison and a set of unrelated photographs. */
  park(angle: number | null): void;
  dispose(): void;
}

/** A soft round pool of light for the car to stand in. */
function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0, "rgba(120,140,170,0.5)");
  g.addColorStop(0.35, "rgba(70,90,120,0.22)");
  g.addColorStop(0.72, "rgba(30,40,60,0.06)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** One tile of corniche: two lanes, a dashed centre, solid edges.
 *  ROAD_W metres across by DASH metres along, so the tile repeats
 *  exactly once per dash cycle and the markings never drift. */
function roadTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#1a1c20";
  ctx.fillRect(0, 0, W, H);
  // Aggregate. Deterministic on purpose — a menu whose asphalt is
  // different on every reload is a menu whose screenshots never match.
  for (let i = 0; i < 2600; i++) {
    const x = (i * 7919) % W;
    const y = (i * 104729) % H;
    const v = 26 + ((i * 31) % 26);
    ctx.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
    ctx.fillRect(x, y, 1 + ((i * 13) % 2), 1);
  }
  // Lane edges at the shoulders, dashed line down the middle.
  ctx.fillStyle = "#c9ccd2";
  const edge = Math.round(W * 0.085);
  ctx.fillRect(edge, 0, 3, H);
  ctx.fillRect(W - edge - 3, 0, 3, H);
  // One dash per tile: 40% painted, 60% gap, which is what a road does.
  ctx.fillStyle = "#d8dbe0";
  ctx.fillRect(W / 2 - 2, 0, 4, Math.round(H * 0.4));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// The shape of the loop. Every number below divides LOOP_S, which is
// what makes the twelfth second identical to the zeroth.
const ROLL_SPEED = 25; // m/s — 90 km/h, a cruise rather than a race
const LAMP_SPACING = 30; // m  → a lamp every 1.2 s
const LAMPS = 10; // per side
const SPAN = LAMP_SPACING * LAMPS; // 300 m of road, recycled
const BEHIND = 30; // how much of it sits behind the camera
const DASH = 15; // m per lane-dash cycle → 0.6 s
const ROAD_W = 16; // m, kerb to kerb
const LOOP_S = SPAN / ROLL_SPEED; // 12 s
// Which lane each car holds. 3.4 m apart, which is a lane, and the
// player takes the one that lands in the clear side of the frame.
const PLAYER_X = -1.7;
const RIVAL_X = 1.7;

/**
 * Build the menu turntable on its own canvas.
 *
 * `reduced` draws a single frame and stops — the same courtesy the
 * versus film pays to prefers-reduced-motion, and the reason the
 * headless test suite never pays for this scene.
 */
export function buildAttract(
  canvas: HTMLCanvasElement,
  colors: CarColors,
  reduced = false,
  opts: AttractOptions = {}
): AttractHandle {
  const rolling = opts.mode !== "turntable";
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    // The race asks for low-power because it runs for minutes on end.
    // A menu is a single still-ish frame of one object; ask for the
    // real GPU and spend it on looking right.
    powerPreference: "high-performance",
  });
  // A real contact shadow under the car. Without one the turntable was
  // a car floating a few centimetres over a painted pool of light —
  // the single thing that most gave away that it was not a photograph.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.environment = nightEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

  // The car sits on a turntable rather than the camera orbiting it: the
  // horizon band in the environment map then sweeps along the flank,
  // which is the whole reason the paint reads as lacquer.
  const table = new THREE.Group();
  scene.add(table);

  /** One car and the things about it the loop has to drive. */
  interface Rig {
    holder: THREE.Group;
    car: THREE.Group | null;
    wheels: THREE.Object3D[];
    /** World radius of a driven wheel, so it turns at road speed rather
     *  than at a rate that merely looks busy. */
    wheelR: number;
  }
  const makeRig = (x: number): Rig => {
    const holder = new THREE.Group();
    holder.position.x = x;
    table.add(holder);
    return { holder, car: null, wheels: [], wheelR: 0.33 };
  };
  // Side by side: 3.4 m between centre lines, which is a lane.
  const near = makeRig(rolling ? PLAYER_X : 0);
  const far = rolling ? makeRig(RIVAL_X) : null;

  const fitCar = (rig: Rig, c: CarColors) => {
    if (rig.car) {
      rig.holder.remove(rig.car);
      rig.car.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    const built = createCar(c);
    built.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    // The headlight halo and diffraction star are sized for an oncoming
    // car at night. Parked at showroom range they blow a white smear
    // across half the menu; rolling away from the camera almost none of
    // it is pointed this way, so the pair keeps a little more of it.
    for (const m of (built.userData.headGlowMats as THREE.SpriteMaterial[]) ?? []) {
      m.opacity *= rolling ? 0.3 : 0.18;
    }
    rig.car = built;
    rig.wheels = (built.userData.wheels as THREE.Object3D[]) ?? [];
    // Measured off the built wheel, not assumed: the silhouettes carry
    // different scale factors, so the same tyre is a different size on
    // each of them.
    const w = rig.wheels[0];
    if (w) {
      built.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(w);
      const r = (box.max.y - box.min.y) / 2;
      if (r > 0.05) rig.wheelR = r;
    }
    rig.holder.add(built);
  };
  const buildCar = (c: CarColors) => fitCar(near, c);
  buildCar(colors);
  if (far) fitCar(far, opts.second ?? colors);

  // Ground: a dark disc with a pool of light under the car, fading out
  // before it reaches an edge the camera could catch. On the road it is
  // the pair's own pool, following them rather than marking a stage.
  const pool = poolTexture();
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(14, 48),
    new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.005;
  // On the road there is nothing for it to do. A pool of light that
  // travels with the cars is a stage light, and a stage light following
  // two cars down a motorway is the one thing in the shot that could not
  // happen — the street lamps light this scene now.
  if (!rolling) scene.add(ground);
  // The pool of light is unlit basic material and cannot take a shadow,
  // so the shadow lands on its own catcher just beneath it.
  const catcher = new THREE.Mesh(
    new THREE.CircleGeometry(9, 40),
    new THREE.ShadowMaterial({ opacity: 0.5 })
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.004;
  catcher.receiveShadow = true;
  if (!rolling) scene.add(catcher);

  // ------------------------------------------------------------- the road
  /** Props whose z is rewritten every frame, in the order they were laid
   *  out along the span. */
  const rollers: Array<{ obj: THREE.Object3D; base: number }> = [];
  let roadTex: THREE.CanvasTexture | null = null;
  if (rolling) {
    // Far enough to hold the whole span, close enough that the lamps at
    // the end of it fade out instead of ending.
    scene.fog = new THREE.Fog(0x070a12, 45, SPAN * 0.62);
    camera.far = SPAN;
    roadTex = roadTexture();
    roadTex.repeat.set(1, SPAN / DASH);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, SPAN),
      new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0.05 })
    );
    road.name = "road";
    road.rotation.x = -Math.PI / 2;
    road.position.z = SPAN / 2 - BEHIND;
    road.receiveShadow = true;
    scene.add(road);
    // The desert either side, so the road has an edge rather than a void.
    const verge = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W * 7, SPAN),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 1 })
    );
    verge.rotation.x = -Math.PI / 2;
    verge.position.set(0, -0.02, SPAN / 2 - BEHIND);
    scene.add(verge);

    // Lamps down both shoulders. These are what actually sell the motion:
    // the road texture alone slides, but a lamp arriving, passing over
    // the roof and leaving is a thing the eye can count.
    const mastGeo = new THREE.CylinderGeometry(0.07, 0.1, 8, 6);
    const armGeo = new THREE.BoxGeometry(1.5, 0.12, 0.12);
    const headGeo = new THREE.BoxGeometry(0.85, 0.16, 0.34);
    const mastMat = new THREE.MeshStandardMaterial({
      color: 0x2b2f38,
      roughness: 0.75,
      metalness: 0.4,
    });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd08a });
    for (let i = 0; i < LAMPS * 2; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const g = new THREE.Group();
      g.name = "lamp";
      const mast = new THREE.Mesh(mastGeo, mastMat);
      mast.position.y = 4;
      g.add(mast);
      const arm = new THREE.Mesh(armGeo, mastMat);
      arm.position.set(-side * 0.75, 7.9, 0);
      g.add(arm);
      const head = new THREE.Mesh(headGeo, lampMat);
      head.position.set(-side * 1.45, 7.8, 0);
      g.add(head);
      // The light itself, not a glowing box pretending to be one.
      //
      // The number matters more than it looks. These fall off with the
      // square of distance and the road is seven and a half metres below
      // the lamp, so an intensity that reads bright at the head arrives
      // at the asphalt as nothing: 26 put roughly half a lux on the road
      // and the whole scene was a dark rectangle with two tail lights in
      // it. This is what actually lights the shot.
      const lit = new THREE.PointLight(0xffc078, 460, 52, 2);
      lit.position.set(-side * 1.45, 7.4, 0);
      g.add(lit);
      g.position.x = side * (ROAD_W / 2 + 1.1);
      // Staggered: the two sides alternate, half a spacing apart, which
      // is what the corniche does and what stops the pair being lit
      // symmetrically from both sides at once.
      const base = Math.floor(i / 2) * LAMP_SPACING + (side < 0 ? LAMP_SPACING / 2 : 0);
      scene.add(g);
      rollers.push({ obj: g, base });
    }
  }

  // Lighting: warm sodium key from behind one shoulder, cool gulf fill
  // from the other, and a tight top light to put a line down the roof.
  // On the road the lamps do most of the work, so the studio rig steps
  // back to a rim and a fill and stops looking like a photo shoot.
  const key = new THREE.DirectionalLight(0xffcf8a, rolling ? 1.9 : 2.6);
  key.position.set(-5, 5.5, -3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  // A tight frustum around the car: the whole shadow budget spent on
  // the only object that casts one.
  const sc = key.shadow.camera;
  sc.left = -6; sc.right = 6; sc.top = 4; sc.bottom = -4;
  sc.near = 0.5; sc.far = 22;
  key.shadow.bias = -0.0016;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x5fc9ee, rolling ? 1.2 : 1.5);
  fill.position.set(5.5, 2.6, 4.5);
  scene.add(fill);
  if (rolling) {
    // A cold wash from overhead and ahead, so the roofs and screens are
    // not simply the absence of the lamps.
    const moon = new THREE.DirectionalLight(0xaec6ee, 0.85);
    moon.position.set(2, 9, 14);
    scene.add(moon);
  } else {
    const top = new THREE.SpotLight(0xdfe9ff, 34, 22, 0.55, 0.65, 1.6);
    top.position.set(0.6, 8.5, 1.2);
    scene.add(top);
  }
  scene.add(new THREE.AmbientLight(0x2b3a58, rolling ? 0.9 : 0.8));

  // Stars, so the space above the car is night rather than nothing
  {
    const n = 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Deterministic scatter: a menu that twinkles differently on every
      // reload is a menu whose screenshots never match.
      const a = i * 2.39996;
      const r = 40 + ((i * 7919) % 30);
      const y = 6 + ((i * 6151) % 34);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(
      new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: 0x9fb6d8, size: 0.22, sizeAttenuation: true })
      )
    );
  }

  let raf = 0;
  let frames = 0;
  /** Non-null while the turntable is held still — see park(). */
  let parked: number | null = null;
  let disposed = false;
  let t = 0;
  let last = 0;

  // How far the shot is pushed left of the car, so the car sits in the
  // clear right-hand side of the frame with the menu down the left.
  // A narrow screen has no clear side, so there the car centres and
  // retreats behind the scrim instead.
  let offsetX = -2.6;
  let dist = 10.4;

  const resize = () => {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    // Render at the display's real density, up to 2x.
    //
    // This used to cap at 1.25 to save cost, and that cap was the whole
    // reason the menu looked soft: on any retina panel the turntable was
    // being drawn at roughly half the resolution of the text sitting on
    // top of it, so the one 3D thing on the screen was the blurriest
    // thing on the screen. The menu renders ONE car against a flat
    // ground with no post chain — it can afford the pixels the race
    // cannot, and this is the screen a player looks at longest before
    // deciding what they think of the game.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    const aspect = w / Math.max(1, h);
    camera.aspect = aspect;
    const wide = aspect >= 1.15;
    // The rolling shot is wider on purpose: a chase down a road is a
    // deep frame, and a long lens on it flattens the road into a wall.
    camera.fov = rolling ? (wide ? 36 : 46) : wide ? 34 : 42;
    // Enough push to clear the menu column, not so much that the nose
    // runs off the edge — the car turns, so the silhouette it has to
    // fit inside is its diagonal, not its length. The rolling camera
    // faces the other way, so its push is the other sign.
    offsetX = wide ? (rolling ? 3.7 : -1.8) : 0;
    dist = rolling ? (wide ? 15 : 18) : wide ? 12 : 13.5;
    camera.updateProjectionMatrix();
  };

  /** Metres of road that have gone under the pair. */
  let travelled = 0;
  const TAU = Math.PI * 2;

  const drawRolling = (dt: number) => {
    // Wrapped, not accumulated. Twenty minutes on the menu is 30 km of
    // road, and a float that large has lost the millimetres the lane
    // markings are positioned in.
    if (parked === null) t = (t + dt) % LOOP_S;
    travelled = t * ROLL_SPEED;

    // The road slides under the pair. Wrapping the offset as well keeps
    // the texture matrix in the first tile for ever.
    if (roadTex) roadTex.offset.y = (travelled / DASH) % 1;
    // Every prop steps toward the camera and comes back round the front
    // when it passes behind it. This is the seam that is not there:
    // nothing is created, nothing is destroyed, nothing fades in.
    for (const r of rollers) {
      r.obj.position.z = (((r.base - travelled) % SPAN) + SPAN) % SPAN - BEHIND;
    }

    // The pair. A car at a steady 90 is not rigid: it breathes on its
    // springs and wanders a few centimetres inside its lane, and the two
    // of them have to do it out of step or they read as one object.
    const rigs: Array<[Rig, number, number]> = far
      ? [
          [near, PLAYER_X, 0],
          [far, RIVAL_X, 2.1],
        ]
      : [[near, PLAYER_X, 0]];
    for (const [rig, lane, phase] of rigs) {
      const weave = Math.sin(TAU * (t / 12) + phase);
      rig.holder.position.x = lane + weave * 0.14;
      rig.holder.position.y = Math.sin(TAU * (t / 6) + phase * 1.7) * 0.014;
      // The body leans against the way it is drifting, which is what a
      // soft spring does and what makes the wander read as a car rather
      // than as a sliding sprite.
      rig.holder.rotation.z = -Math.cos(TAU * (t / 12) + phase) * 0.012;
      rig.holder.rotation.x = Math.sin(TAU * (t / 6) + phase * 1.7) * 0.004;
      // Turning at the speed the road is moving. Same sign convention as
      // the race (engine.ts rollWheels): forward is +x.
      for (const w of rig.wheels) w.rotation.x += (ROLL_SPEED / rig.wheelR) * dt;
    }

    // Chase: behind, above, and drifting just enough that the frame is
    // never dead. This camera looks along +z, where the turntable's
    // looks along -z, so screen right is -x rather than +x and the aim
    // offset that clears the menu column runs the other way. Same trick,
    // opposite sign — which is exactly the sort of thing that is wrong
    // until you look at it.
    const camY = 3.1 + Math.sin(TAU * (t / 12)) * 0.09;
    camera.position.set(offsetX * 0.3, camY, -dist + Math.sin(TAU * (t / 12)) * 0.5);
    camera.lookAt(offsetX, 1.05, 16);
  };

  /**
   * Advance the scene by dt and put everything where it belongs. Split
   * from the render so park() can move the loop to a given second and
   * have the scene actually be there — a test that has to step through a
   * whole loop cannot afford a full render per step, and one that reads
   * the scene before it has been posed reads the previous frame.
   */
  const pose = (dt: number) => {
    if (rolling) {
      drawRolling(dt);
    } else {
      t += dt;
      // A slow three-quarter sweep, easing at the ends rather than
      // spinning like a display stand in a shop window.
      table.rotation.y = parked ?? (0.55 + Math.sin(t * 0.12) * 0.85);
      // The camera breathes a little so the shot is never dead still
      const h = 1.9 + Math.sin(t * 0.19) * 0.12;
      camera.position.set(offsetX * 0.35, h, dist + Math.sin(t * 0.09) * 0.4);
      // Aiming left of the car pushes it into the right of the frame
      camera.lookAt(offsetX, 0.72, 0);
    }
  };

  const draw = (dt: number) => {
    pose(dt);
    renderer.render(scene, camera);
    frames++;
  };

  resize();
  if (reduced) {
    draw(0);
  } else {
    const loop = (now: number) => {
      if (disposed) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      draw(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  return {
    setCar(c) {
      buildCar(c);
    },
    resize,
    get frames() {
      return frames;
    },
    get triangles() {
      return renderer.info.render.triangles;
    },
    get angle() {
      // Where the loop is, 0 to 1 — the rolling equivalent of a
      // turntable's heading, and the thing a test can watch advance.
      return rolling ? (t % LOOP_S) / LOOP_S : table.rotation.y;
    },
    get travelled() {
      return rolling ? travelled : 0;
    },
    get loopSeconds() {
      return rolling ? LOOP_S : 0;
    },
    scene,
    camera,
    get cars() {
      return [near.car, far?.car].filter(Boolean) as THREE.Group[];
    },
    park(angle) {
      parked = angle;
      // On the road, park() means "hold this second of the loop", so a
      // capture tool can put two builds at the same frame of it.
      if (rolling && angle !== null) t = (((angle % 1) + 1) % 1) * LOOP_S;
      // Pose immediately: the scene is where park() says it is as soon
      // as park() returns, whether or not a frame has been drawn since.
      pose(0);
      if (reduced) draw(0); // a single-frame scene must be redrawn
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh || (o as THREE.Points).isPoints) m.geometry?.dispose();
      });
      pool.dispose();
      roadTex?.dispose();
      scene.environment?.dispose();
      renderer.dispose();
    },
  };
}
