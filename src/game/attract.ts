import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createCar, TAIL, type CarColors } from "./cars";
import type { DriverRig } from "./characters";
import { solveDriverRig, lookAheadFor } from "./driver";
import { nightEnvironment } from "./env";
import { GradeShader } from "./grade";
import { RIG } from "./rig";
import { pixelRatioFor } from "./render";
import { loadSettings } from "./settings";
import { ParticleSystem, radialSprite } from "./vfx";
import { makeRng } from "./rand";

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
 * fighting for a corner on the corniche at one in the morning — and the
 * menu is the longest a player looks at any single screen before
 * deciding what they think of it. So the menu races: your car and the
 * machine you are about to meet, through one long sweeper at 137, your
 * car held sideways in it, the other tucked up the inside, the lead
 * changing hands, lamps sweeping over both.
 *
 * It is a loop rather than a clip. The cars stay where they are and the
 * WORLD goes past — road, lamps, kerb, sea — with every prop recycled
 * the moment it passes behind the camera, so there is no seam to hide
 * because there is no join.
 *
 * THE CORNER is the thing that looks impossible in a loop and is not.
 * On a constant-radius bend at constant speed, the car's motion is a
 * rigid rotation about the bend's centre — so in the CAR's frame every
 * point of the world slides along a circle concentric with the road.
 * Which is the same recycling as the straight, on an arc: each prop
 * carries a distance along the road and a distance across it, and is
 * put down on the arc every frame. The pair sit at the apex for ever
 * and the whole corniche wraps around them.
 *
 * Every period in the scene divides LOOP_S: the lamps pass every 0.79 s,
 * the lane dashes every 0.39, the fight for the lead and the drift's
 * breathing run on the loop and half of it. Eight seconds in, the
 * picture is the picture you started with, to the pixel.
 *
 * (The wheels and the smoke are the exceptions, and deliberately: 300 m
 * of road is not a whole number of turns of a 0.66 m tyre, and rounding
 * the road speed until it was would be a lie told to make a test pass.
 * They spin at the speed the road is actually moving. The smoke is
 * seeded, so a screenshot is the same screenshot, but it is a fluid and
 * does not owe the loop a period.)
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
  /** The road speed under the pair, m/s. Rolling only; 0 on a turntable. */
  readonly speedMs: number;
  /** The sweeper's radius in metres, and the yaw the hero's car is held
   *  at against the road's tangent — nonzero means it is drifting. */
  readonly bendRadius: number;
  readonly driftAngle: number;
  /** Live tyre-smoke particles. */
  readonly smoke: number;
  /** The scene and what is moving in it, for a test that has to look.
   *  Nothing in the game reads these — the drawing buffer is gone by the
   *  time a script can sample it, so the only way to check that a lamp
   *  went past is to ask the lamp. */
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly cars: THREE.Group[];
  /** The renderer and the post chain, for a tool that has to re-draw
   *  this scene itself — tools/shots/levels.mjs renders an ID pass
   *  through the renderer with every material swapped, then puts the
   *  beauty frame back through the composer. Nothing in the game reads
   *  either. */
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
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

/**
 * The city, from a mile out, painted once.
 *
 * The menu's road is 300 m of scrolling strip and the fog closes it at
 * 186, so anything meant to read as DISTANT cannot be built out of
 * geometry standing on that strip — it would either be inside the fog
 * or outside the far plane. A skyline a mile away barely parallaxes
 * anyway, which is exactly the case a painted backdrop is for.
 *
 * So this is one canvas, hung 265 m ahead with fog switched off: the
 * Gulf's horizon, Kuwait Towers on their promontory, the Liberation
 * Tower behind them, the Sharq waterfront either side, and the lights
 * of all of it doubled in the water.
 *
 * Everything is sized through `sub()` rather than by eye. A backdrop
 * drawn by eye is the classic way to get a skyline that reads as a
 * cardboard cutout twenty metres up the road: the first pass here put
 * the towers at 240 px, which works out at 65 m tall on a plane 265 m
 * away — an object subtending 14 degrees, taller than the frame, and
 * the reason nothing appeared on screen at all. What matters is the
 * ANGLE each thing subtends from where the camera is standing, and the
 * only way to get that right is to write down how big the thing is and
 * how far away it stands and let the arithmetic do the rest.
 */
function skylineTexture(): THREE.CanvasTexture {
  const W = 2048;
  const H = 512;
  /** The plane this is painted on: how tall it is, and how far ahead it
   *  hangs. Both have to match the mesh below or every size is wrong. */
  const PLANE_M = 140;
  const HANG_M = 265;
  /** Pixels, for a thing `m` metres tall standing `dist` metres away.
   *  Its angle from the camera is m/dist; on a plane HANG_M away that
   *  angle covers HANG_M*m/dist metres, and the plane is PLANE_M tall
   *  across H pixels. */
  const sub = (m: number, dist: number) => (H / PLANE_M) * HANG_M * (m / dist);

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);

  /** The waterline, at the vertical middle: the plane is hung with its
   *  centre at eye height, so the middle of the image IS the horizon. */
  const HZ = H / 2;

  // Sky glow over the city — a night sky above a city is not black, and
  // the glow is what puts the towers in front of something.
  const glow = ctx.createLinearGradient(0, HZ - 150, 0, HZ + 4);
  glow.addColorStop(0, "rgba(12,20,34,0)");
  glow.addColorStop(0.62, "rgba(30,44,66,0.55)");
  glow.addColorStop(1, "rgba(62,78,100,0.9)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, HZ - 150, W, 154);

  // The water below it, darkening away from the light it is reflecting.
  const sea = ctx.createLinearGradient(0, HZ, 0, H);
  sea.addColorStop(0, "rgba(30,44,64,0.9)");
  sea.addColorStop(0.5, "rgba(12,20,32,0.85)");
  sea.addColorStop(1, "rgba(6,10,18,0.75)");
  ctx.fillStyle = sea;
  ctx.fillRect(0, HZ, W, H - HZ);

  /** Everything above the waterline is drawn twice: once standing and
   *  once flipped and faded into the water under it. A night skyline on
   *  a bay is half reflection. */
  const both = (draw: () => void) => {
    draw();
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.translate(0, HZ * 2);
    ctx.scale(1, -1);
    draw();
    ctx.restore();
  };

  const SILHOUETTE = "#0b1220";

  // --- Kuwait Towers ---------------------------------------------------
  // 187 m, 147 m and a 113 m unlit mast on the Ras Ajouza promontory,
  // about a kilometre and a third up the bay from where this camera is.
  // The spheres sit where they sit: 82 m and 123 m on the big one.
  const TOWER_D = 1300;
  const towers = (x0: number) => {
    const m = (v: number) => sub(v, TOWER_D);
    const stack = [
      { dx: 0, h: 187, spheres: [82, 123] },
      { dx: m(30), h: 147, spheres: [96] },
      { dx: m(52), h: 113, spheres: [] as number[] },
    ];
    for (const t of stack) {
      const x = x0 + t.dx;
      const top = HZ - m(t.h);
      ctx.fillStyle = SILHOUETTE;
      // The mast tapers — a straight bar reads as a chimney.
      const base = m(9) / 2;
      ctx.beginPath();
      ctx.moveTo(x - base, HZ);
      ctx.lineTo(x + base, HZ);
      ctx.lineTo(x + base * 0.35, top);
      ctx.lineTo(x - base * 0.35, top);
      ctx.closePath();
      ctx.fill();
      for (const [i, sh] of t.spheres.entries()) {
        const y = HZ - m(sh);
        const r = m(i === 0 ? 26 : 15) / 2;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // The blue-green tiling catches the city's own light on the
        // underside. An arc, not a gradient: at this size a gradient is
        // a grey smudge.
        ctx.fillStyle = i === 0 ? "rgba(58,132,144,0.85)" : "rgba(48,104,120,0.75)";
        ctx.beginPath();
        ctx.arc(x, y, r * 0.72, Math.PI * 0.12, Math.PI * 0.88);
        ctx.fill();
        ctx.fillStyle = SILHOUETTE;
      }
      // The aircraft beacon on top of each mast.
      ctx.fillStyle = "rgba(255,80,64,0.95)";
      ctx.fillRect(x - 1.5, top - 3, 3, 3);
      ctx.fillStyle = SILHOUETTE;
    }
  };

  // --- The waterfront, as blocks with lit windows ----------------------
  // Sharq and Dasman: nothing on the bay front is much over 120 m, and
  // it stands two to three kilometres out.
  const blocks = (seed: number, x0: number, x1: number, dist: number) => {
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const tall = sub(120, dist);
    for (let x = x0; x < x1; ) {
      const w = sub(30 + rnd() * 60, dist);
      const h = tall * (0.3 + rnd() * 0.7);
      ctx.fillStyle = SILHOUETTE;
      ctx.fillRect(x, HZ - h, w, h);
      // Windows. Sparse and warm, because at one in the morning most of
      // them are off — a fully lit block reads as daytime. Below about
      // four pixels of storey height there is no window to draw, only a
      // speck, and a speck is what a lit floor looks like from here.
      const storey = Math.max(2, sub(4, dist));
      const bay = Math.max(2, sub(6, dist));
      for (let wy = HZ - h + storey; wy < HZ - storey; wy += storey * 1.6) {
        for (let wx = x + bay; wx < x + w - bay; wx += bay * 1.5) {
          if (rnd() > 0.26) continue;
          ctx.fillStyle = rnd() > 0.7 ? "rgba(206,224,250,0.85)" : "rgba(250,206,130,0.8)";
          ctx.fillRect(wx, wy, Math.max(1, bay * 0.4), Math.max(1, storey * 0.5));
        }
      }
      x += w + sub(12 + rnd() * 40, dist);
    }
  };

  both(() => {
    blocks(7, -30, 880, 2600);
    towers(920);
    // The Liberation Tower behind them: 372 m, taller than anything on
    // the bay, and a needle rather than a block. It stands inland, so it
    // is further away and still the tallest thing in the picture.
    const LIB_D = 1900;
    const lx = 1030;
    const shaft = sub(240, LIB_D);
    const spire = sub(372, LIB_D);
    ctx.fillStyle = SILHOUETTE;
    ctx.beginPath();
    ctx.moveTo(lx - sub(11, LIB_D), HZ);
    ctx.lineTo(lx + sub(11, LIB_D), HZ);
    ctx.lineTo(lx + 1.2, HZ - shaft);
    ctx.lineTo(lx + 0.8, HZ - spire);
    ctx.lineTo(lx - 0.8, HZ - spire);
    ctx.lineTo(lx - 1.2, HZ - shaft);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,80,64,0.95)";
    ctx.fillRect(lx - 1.5, HZ - spire - 3, 3, 3);
    blocks(19, 1080, 2100, 3000);
  });

  // The horizon itself: a hairline of reflected light, which is what
  // stops the sea and the sky being one flat field.
  ctx.fillStyle = "rgba(126,156,190,0.4)";
  ctx.fillRect(0, HZ - 1, W, 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// The shape of the loop. Every distance below divides SPAN, which is
// what makes the last frame of the loop identical to the first.
const ROLL_SPEED = 38; // m/s — 137 km/h, a race rather than a cruise
const LAMP_SPACING = 30; // m  → a lamp every 0.79 s
const LAMPS = 10; // per side
const SPAN = LAMP_SPACING * LAMPS; // 300 m of road, recycled
const BEHIND = 30; // how much of it sits behind the camera
const DASH = 15; // m per lane-dash cycle → 0.39 s
const ROAD_W = 16; // m, kerb to kerb
const LOOP_S = SPAN / ROLL_SPEED; // 7.9 s
// Which lane each car holds. 3.4 m apart, which is a lane, and the
// player takes the one that lands in the clear side of the frame.
const PLAYER_X = -1.7;
const RIVAL_X = 1.7;

/**
 * The corner.
 *
 * BEND_R is the sweeper's radius. 240 m at 38 m/s is 0.6 g of lateral
 * load — a fast corner rather than a hairpin, the kind the corniche
 * actually has — and 300 m of road wraps 72 degrees of it, so the far
 * lamps sweep across the frame before the fog takes them.
 *
 * BEND is which way it turns. This camera looks along +z, so -x is
 * screen RIGHT: the clear side of the frame, with the menu down the
 * left. The corner turns into the clear side, so the road ahead — the
 * thing the whole shot is about — is not hidden behind the buttons.
 * That puts the sea on the inside of the bend, which Gulf Road does at
 * the head of the bay.
 */
const BEND_R = 240;
const BEND = -1;
/** How far the hero's car is held from the road's tangent, in radians.
 *  Twenty degrees reads as a drift from behind; past thirty a car this
 *  size starts to read as sideways. Breathes a little in the loop. */
const DRIFT_ANGLE = 0.34;
/** Front-wheel countersteer, radians, against the drift. */
const COUNTERSTEER = 0.28;
/** How far the lead swings each way across a loop, m. Four metres
 *  nose-to-nose at the peak, less than a car — a fight, not a pass. */
const FIGHT_M = 2.0;
/** Lateral load in the corner, for the drivers' rigs: v^2 / R. */
const CORNER_G = (ROLL_SPEED * ROLL_SPEED) / BEND_R;

/** Where a point of the road is, in the scene: `s` metres along the
 *  road from the pair (negative is behind them), `u` metres across it
 *  (+x in the flat frame). On the arc, a lateral offset is a change of
 *  radius, which is what keeps the kerbs parallel. */
function arcPoint(s: number, u: number, out: THREE.Vector3): THREE.Vector3 {
  const th = s / BEND_R;
  const r = BEND_R - BEND * u;
  return out.set(BEND * (BEND_R - r * Math.cos(th)), 0, r * Math.sin(th));
}
/** The road's heading at `s`, as a yaw for an object whose forward is +z. */
function arcYaw(s: number): number {
  return BEND * (s / BEND_R);
}

/**
 * A strip of ground that follows the corner: a plane, `u0..u1` across
 * the road and `s0..s1` along it, with every vertex put down on the arc.
 * `v` runs 0..1 along the strip so a texture repeats along the road the
 * way it did on the straight, and scrolls the same way.
 */
function ribbon(u0: number, u1: number, s0: number, s1: number, along = 40, across = 1): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const nAlong = along + 1;
  const nAcross = across + 1;
  const pos = new Float32Array(nAlong * nAcross * 3);
  const nrm = new Float32Array(nAlong * nAcross * 3);
  const uv = new Float32Array(nAlong * nAcross * 2);
  const p = new THREE.Vector3();
  for (let j = 0; j < nAlong; j++) {
    const s = s0 + ((s1 - s0) * j) / along;
    for (let i = 0; i < nAcross; i++) {
      const u = u0 + ((u1 - u0) * i) / across;
      const k = j * nAcross + i;
      arcPoint(s, u, p);
      pos[k * 3] = p.x;
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = p.z;
      nrm[k * 3 + 1] = 1;
      uv[k * 2] = i / across;
      uv[k * 2 + 1] = j / along;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < across; i++) {
      const a = j * nAcross + i;
      const b = a + nAcross;
      // Wound to face +y: (b - a) x (b+1 - a) is (0, du*ds, 0).
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

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

  /**
   * The same grade the race runs, on the screen the player judges the
   * game by.
   *
   * The menu used to call renderer.render() straight to the canvas:
   * raw ACES at exposure 1.15 and nothing else. The race, meanwhile,
   * has always finished its picture through grade.ts — a shadow lift,
   * a SOFT black point with a knee under it, contrast, vibrance and a
   * dither. Those first two are exactly the controls that stop dark
   * material collapsing, and the showroom never saw them.
   *
   * Measured on the committed cards before this existed: a mean luma of
   * 37.7 of 255 over the car, with 48% to 69% of each car's own pixels
   * at 16 or below. On the Black Demon, two thirds of the car was
   * nothing. The renders were then being gamma-lifted back up afterwards
   * by scripts/story-images.mjs, which is a patch over this.
   *
   * env.ts says why this had to be the same recipe rather than a second
   * one: the environment bake is shared with the race because "two
   * recipes would mean the car you pick in the menu is lit by a
   * different city than the one you drive into". The grade was the half
   * of that recipe that never got shared.
   *
   * What is deliberately NOT taken from the race:
   *
   * - Bloom. Parked at showroom range the headlamps already blow a
   *   white smear across the menu — see the halo damping in fitCar,
   *   which exists for that — and bloom would put it straight back.
   * - Auto-exposure. The turntable is one subject at one distance, so
   *   an adaptive exposure would drift between cars and leave a black
   *   car and a white one disagreeing about how bright the room is.
   *   A showroom holds one exposure; the grade's fixed curve is it.
   *
   * MSAA moves to the target here. Canvas antialias does nothing once
   * the scene is drawn into a composer buffer instead of the canvas, so
   * without samples on this target the post chain would have cost the
   * menu its edges — a sharper picture that is visibly more jagged is
   * not the trade being made.
   */
  const drawing = renderer.getDrawingBufferSize(new THREE.Vector2());
  const sceneTarget = new THREE.WebGLRenderTarget(
    Math.max(1, drawing.x),
    Math.max(1, drawing.y),
    { type: THREE.HalfFloatType, samples: 4 }
  );
  const composer = new EffectComposer(renderer, sceneTarget);
  // Count triangles across the WHOLE frame, not just the last pass.
  //
  // renderer.info resets itself on every render() call, and a composer
  // makes several per frame — so the handle's `triangles`, which is how
  // tests/intro.mjs proves the menu is drawing a scene rather than a
  // still, came back as the 1 triangle of the final full-screen quad.
  // The scene was fine; the number reporting on it was not. Resetting
  // once per frame instead accumulates every pass, so the figure is the
  // scene's own geometry again (plus a handful of quad triangles).
  renderer.info.autoReset = false;
  composer.addPass(new RenderPass(scene, camera));
  // Tone map and encode BEFORE the grade, the same order the race
  // enforces: grading scene-referred HDR puts the final clamp in the
  // wrong space and clips every emissive above 1.
  composer.addPass(new OutputPass());
  const gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);

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
    /** The person in the seat. createCar builds and rigs one on every
     *  car; nothing here used to ask it for a pose, so the menu and the
     *  showroom both showed a driver with their arms at rest and their
     *  feet off the pedals — in a shot framed on the cabin that is the
     *  first thing anybody sees. */
    driver: DriverRig | null;
    /** World radius of a driven wheel, so it turns at road speed rather
     *  than at a rate that merely looks busy. */
    wheelR: number;
  }
  const makeRig = (x: number): Rig => {
    const holder = new THREE.Group();
    holder.position.x = x;
    table.add(holder);
    return { holder, car: null, wheels: [], driver: null, wheelR: 0.33 };
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
    rig.driver = (built.userData.driver as DriverRig | undefined) ?? null;
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
  /** Scratch for the drivers' look target. One per scene, not one per
   *  frame per driver. */
  const look = new THREE.Vector3();

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
  /** Props put down on the arc every frame: `base` is where each was
   *  laid out along the span, `u` how far across the road it stands. */
  const rollers: Array<{ obj: THREE.Object3D; base: number; u: number }> = [];
  /** The same recycling, the other way down the road. */
  const oncoming: Array<{ obj: THREE.Object3D; base: number; u: number }> = [];
  let roadTex: THREE.CanvasTexture | null = null;
  let skyTex: THREE.CanvasTexture | null = null;
  /** Tyre smoke off the hero's rear arches. Rolling only. */
  let smokeFx: ParticleSystem | null = null;
  if (rolling) {
    // Far enough to hold the whole span, close enough that the lamps at
    // the end of it fade out instead of ending.
    scene.fog = new THREE.Fog(0x070a12, 45, SPAN * 0.62);
    camera.far = SPAN;
    roadTex = roadTexture();
    roadTex.repeat.set(1, SPAN / DASH);
    // The road is a ribbon on the arc now, not a plane: the same
    // texture, the same repeat, the same scroll, following the corner.
    const road = new THREE.Mesh(
      ribbon(-ROAD_W / 2, ROAD_W / 2, -BEHIND, SPAN - BEHIND, 60, 2),
      new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0.05 })
    );
    road.name = "road";
    road.receiveShadow = true;
    scene.add(road);

    // Tyre smoke: the race's recipe, off the same arches, a shade
    // denser — the race's is tuned to be seen through from the driving
    // camera, and this one is looked at from fifteen metres back with
    // a menu beside it.
    smokeFx = new ParticleSystem(120, {
      map: radialSprite(0.0, 1.5),
      colorA: 0xc4c9d2,
      colorB: 0x3c4148,
      grow: 2.4,
      spin: 0.3,
      opacity: 0.24,
      fadeIn: 0.1,
    });
    smokeFx.points.name = "smoke";
    scene.add(smokeFx.points);
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
      // Staggered: the two sides alternate, half a spacing apart, which
      // is what the corniche does and what stops the pair being lit
      // symmetrically from both sides at once.
      const base = Math.floor(i / 2) * LAMP_SPACING + (side < 0 ? LAMP_SPACING / 2 : 0);
      scene.add(g);
      rollers.push({ obj: g, base, u: side * (ROAD_W / 2 + 1.1) });
    }

    // --- The corniche ------------------------------------------------
    //
    // Until now the menu was a road in a void: two lanes, ten lamps a
    // side, black either side of them. It read as a road but not as
    // THIS road, and anyone who played for five minutes and came back
    // to the menu could see that the place they had just been driving
    // was not the place on the menu.
    //
    // What makes Gulf Road Gulf Road is the water on one side and the
    // city on the other, so that is what goes in — at the cost a menu
    // can pay. The near half is geometry, because it moves and has to
    // move with everything else. The far half is one painted backdrop,
    // because a skyline a mile out does not move at all.
    //
    // Sea on the driver's left, which is the frame's RIGHT: this camera
    // looks along +z, so -x is screen right, and it is the clear side
    // of the frame with the menu down the other one. It also matches
    // the game — on the coastal leg the Gulf is west of the road.
    const SEA_X = -(ROAD_W / 2 + 4.5); // where the wall stands
    {
      // Promenade: paved walkway between the kerb and the wall, which
      // is what is actually there.
      const walk = new THREE.Mesh(
        ribbon(-(ROAD_W / 2 + 6), -ROAD_W / 2, -BEHIND, SPAN - BEHIND, 60),
        new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.9 })
      );
      walk.position.y = 0.01;
      walk.receiveShadow = true;
      scene.add(walk);

      // The sea wall. Low, continuous, and the thing that gives the
      // water an edge instead of letting it run under the road. A box
      // cannot bend, so it is laid in ten-metre lengths along the arc,
      // each a roller like the lamps, overlapping a little so the
      // corner never shows a gap between them.
      const WALL_N = 30;
      const wallGeo = new THREE.BoxGeometry(0.5, 0.75, SPAN / WALL_N + 0.6);
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x33373f, roughness: 0.95 });
      for (let i = 0; i < WALL_N; i++) {
        const seg = new THREE.Mesh(wallGeo, wallMat);
        seg.name = "seawall";
        seg.position.y = 0.36;
        scene.add(seg);
        rollers.push({ obj: seg, base: (i + 0.5) * (SPAN / WALL_N), u: SEA_X });
      }

      // The Gulf. Dark, wet and metal — at night the sea is not blue,
      // it is whatever the sky and the lamps are doing to it. Held a
      // little below the road so the wall reads as a wall. On the
      // inside of the bend, so it is an annulus of water rather than a
      // plane — which is what a bay looks like from a road around it.
      const water = new THREE.Mesh(
        ribbon(SEA_X - 422, SEA_X - 2, -BEHIND - SPAN / 2, SPAN * 1.5 - BEHIND, 48, 6),
        new THREE.MeshStandardMaterial({
          color: 0x121c28,
          roughness: 0.14,
          metalness: 0.85,
          emissive: 0x08131f,
          emissiveIntensity: 0.6,
        })
      );
      water.name = "sea";
      water.position.y = -0.55;
      scene.add(water);

      // The moon on the water. Without it the Gulf at night is a dark
      // rectangle that could be a car park: the one thing that says
      // "this is liquid" is a broken path of light running away from
      // the eye, widening as it goes because the further chop is seen
      // at a shallower angle. Additive, so it lights the water rather
      // than painting over it, and unlit so it costs nothing.
      const glint = document.createElement("canvas");
      glint.width = 64;
      glint.height = 256;
      {
        const g = glint.getContext("2d")!;
        g.fillStyle = "#000";
        g.fillRect(0, 0, 64, 256);
        for (let i = 0; i < 900; i++) {
          // Deterministic, like everything else in this scene: a menu
          // whose sea sparkles differently on every reload is a menu
          // whose screenshots never match.
          const y = (i * 104729) % 256;
          const spread = 3 + (y / 256) * 26;
          const x = 32 + (((i * 7919) % 200) / 100 - 1) * spread;
          const v = 40 + ((i * 31) % 150);
          g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 30)})`;
          g.fillRect(x, y, 1 + ((i * 13) % 3), 1);
        }
      }
      const glintTex = new THREE.CanvasTexture(glint);
      glintTex.colorSpace = THREE.SRGBColorSpace;
      const path = new THREE.Mesh(
        // Running out from just past the wall toward the horizon, on the
        // side the moon light comes from.
        ribbon(SEA_X - 49, SEA_X - 3, -9, 201, 30),
        new THREE.MeshBasicMaterial({
          map: glintTex,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0.5,
          fog: true,
        })
      );
      path.position.y = -0.5;
      scene.add(path);

      // The city side keeps its verge, narrowed to the shoulder it
      // actually is now that the other side is water.
      const bank = new THREE.Mesh(
        ribbon(ROAD_W / 2, ROAD_W / 2 + 60, -BEHIND, SPAN - BEHIND, 40, 2),
        new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 1 })
      );
      bank.position.y = -0.02;
      scene.add(bank);

      // Palms along the promenade, one every other lamp. Silhouettes:
      // a trunk and six fronds, unlit, because at this distance in this
      // light that is all a palm is. They are rollers like the lamps —
      // the same recycling, the same period.
      const trunkGeo = new THREE.CylinderGeometry(0.11, 0.19, 6.1, 5);
      // A frond is a blade that tapers and droops, not a stick. Drawn
      // as a flat triangle-ish quad on its side: wide at the shoulder,
      // near-nothing at the tip, pitched down at the end. The first
      // version was a 12 cm box and every palm on the promenade read as
      // a utility pole with cross-arms.
      const frondGeo = new THREE.PlaneGeometry(0.55, 3.1, 1, 3);
      {
        const pos = frondGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const v = pos.getY(i);          // -1.55 (shoulder) .. 1.55 (tip)
          const f = (v + 1.55) / 3.1;     // 0 at the shoulder, 1 at the tip
          pos.setX(i, pos.getX(i) * (1 - f * 0.86));
          pos.setZ(i, -f * f * 1.15);     // the droop
        }
        frondGeo.computeVertexNormals();
      }
      const palmMat = new THREE.MeshStandardMaterial({
        color: 0x1b2028,
        roughness: 1,
      });
      for (let i = 0; i < LAMPS; i++) {
        const g = new THREE.Group();
        g.name = "palm";
        const trunk = new THREE.Mesh(trunkGeo, palmMat);
        trunk.position.y = 3.05;
        g.add(trunk);
        for (let f = 0; f < 7; f++) {
          const frond = new THREE.Mesh(frondGeo, palmMat);
          const a = (f / 7) * Math.PI * 2 + i * 0.4;
          // Laid flat and swung out from the crown, each one a little
          // higher or lower than its neighbour so the head is a head
          // and not a wheel.
          frond.rotation.order = "YXZ";
          frond.rotation.y = a;
          frond.rotation.x = -Math.PI / 2 + 0.34 + (f % 3) * 0.12;
          frond.position.set(Math.cos(a) * 0.28, 6.05 + (f % 2) * 0.14, Math.sin(a) * 0.28);
          g.add(frond);
        }
        // Between the wall and the walkway, offset from the lamps so
        // the two do not arrive together and read as one object.
        scene.add(g);
        rollers.push({ obj: g, base: i * (LAMP_SPACING * 2) + LAMP_SPACING * 0.6, u: SEA_X + 1.4 });
      }

      // And the city, a mile and a half out. One plane, fog switched
      // off, hung at 250 m with its centre at eye height so the middle
      // of the image lands exactly on the horizon.
      //
      // In the corner it has to MOVE. Everything in the car's frame
      // turns about the bend's centre, and a skyline a mile out turns
      // with it — at 38 m/s on a 240 m radius that is nine degrees a
      // second across the view. So the painting scrolls, wrapping, and
      // it wraps exactly once per loop: the offset is travelled/SPAN,
      // which is back at zero when the picture is.
      skyTex = skylineTexture();
      skyTex.wrapS = THREE.RepeatWrapping;
      const sky = new THREE.Mesh(
        new THREE.PlaneGeometry(560, 140),
        new THREE.MeshBasicMaterial({
          map: skyTex,
          transparent: true,
          depthWrite: false,
          fog: false,
          // A plane's front face is +z and this camera looks along +z,
          // so an unrotated backdrop presents its BACK and is culled
          // outright: it was in the frustum, in front of the far plane,
          // with its texture loaded, and drew nothing at all. Rotating
          // it to face back would mirror the city; two-sided costs
          // nothing on one quad.
          side: THREE.DoubleSide,
        })
      );
      sky.name = "skyline";
      sky.position.set(0, 3.1, 250);
      sky.renderOrder = -1;
      scene.add(sky);

      // Oncoming traffic on the far carriageway. Headlights closing —
      // the one thing that says a road is in use rather than closed for
      // the shoot. 25 m/s the other way makes the closing speed 50, so
      // these wrap the 300 m span every six seconds; six divides the
      // twelve the loop runs on, so the picture still comes back to
      // itself exactly.
      const carGeo = new THREE.BoxGeometry(1.75, 1.25, 4.4);
      const carMat = new THREE.MeshStandardMaterial({
        color: 0x0d1016,
        roughness: 0.6,
        metalness: 0.3,
      });
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xf2f6ff });
      const beamGeo = new THREE.PlaneGeometry(0.34, 0.12);
      for (let i = 0; i < 3; i++) {
        const g = new THREE.Group();
        g.name = "oncoming";
        const body = new THREE.Mesh(carGeo, carMat);
        body.position.y = 0.7;
        g.add(body);
        for (const side of [-1, 1]) {
          const beam = new THREE.Mesh(beamGeo, beamMat);
          // On the end of the car the camera is looking at, facing the
          // camera. A plane fronts +z, so this pair is turned round;
          // the group is NOT, because a box has no front and turning it
          // as well put the lamps on the far end pointing away — a
          // black shape sliding past with no lights on it.
          beam.position.set(side * 0.62, 0.72, -2.22);
          beam.rotation.y = Math.PI;
          g.add(beam);
          const lit = new THREE.PointLight(0xdce8ff, 26, 16, 2);
          lit.position.set(side * 0.62, 0.72, -2.6);
          g.add(lit);
        }
        // The far carriageway, alternating between its two lanes.
        scene.add(g);
        oncoming.push({ obj: g, base: i * (SPAN / 3), u: ROAD_W / 2 - (i % 2 === 0 ? 2.1 : 5.5) });
      }
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

  /**
   * The fill a showroom actually has, and this rig did not.
   *
   * The key sits at negative z and the camera at positive z, so the key
   * is a RIM: the face turned towards the viewer is the unlit side of
   * the car. That reads beautifully on a pale car and collapses on a
   * dark one, which is why the fleet's black cars measured worst.
   *
   * Giving the menu the race's grade fixed part of it — the car's own
   * pixels went from 32.6% at-or-below-16 to 24.9%, and the Black Demon
   * from 43.7% to 33.5% — but a grade is a curve over the whole frame,
   * so it lifted the night by 50% while lifting the car by 20%. A tone
   * curve cannot tell a car from the room it is standing in. Only a
   * light can, which is what this is.
   *
   * A SPOT rather than a directional, and that is the entire point: it
   * falls off, so it reaches the car and not the far surround. A
   * directional fill of the same strength would have lifted the
   * backdrop with it and undone what the spot is here to protect.
   *
   * Cool, because the key is warm sodium (0xffcf8a) and a second warm
   * source flattens the modelling into one colour. Cast no shadow: the
   * key owns the contact shadow, and a second shadow under a showroom
   * car is a lighting error you can see from across the room.
   */
  const fillZ = rolling ? -8.6 : 8.6; // whichever side the camera is on
  const front = new THREE.SpotLight(0xd6e4f6, rolling ? 38 : 52, 28, 0.66, 0.9, 1.5);
  front.position.set(rolling ? PLAYER_X - 2.4 : -3.2, 3.8, fillZ);
  front.target.position.set(rolling ? PLAYER_X : 0, 0.7, 0);
  scene.add(front.target);
  scene.add(front);

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
    // thing on the screen. The menu renders two cars against a flat road
    // through three passes rather than the race's seven — it can afford
    // the pixels the race cannot, and this is the screen a player looks
    // at longest before deciding what they think of the game.
    //
    // It follows the resolution ladder for the same reason: a player who
    // has set the game to 4K and finds the menu behind their 4K race
    // rendering at window size has been given two different answers to
    // one question. Read live rather than captured at build time, so
    // changing it in settings takes on the next resize.
    const gl = renderer.getContext();
    const maxBuffer = Math.max(
      2048,
      (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) || 4096
    );
    renderer.setPixelRatio(
      pixelRatioFor(loadSettings().resolution, w, h, window.devicePixelRatio || 1, maxBuffer)
    );
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    // The grain and the unsharp mask are both measured in texels, so
    // the grade has to be told the buffer it is actually working on or
    // both change size with the window.
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    (gradePass.uniforms.uTexel.value as THREE.Vector2).set(1 / buf.x, 1 / buf.y);
    smokeFx?.setPixelScale(buf.y);
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
  /** The hero's yaw against the road's tangent this frame, radians. */
  let drift = 0;
  /** Seeded, so the smoke on a screenshot is the smoke on the last
   *  one; a fluid, so it does not owe the loop a period. */
  const smokeRand = makeRng(0x534d4f4b);
  let smokeAcc = 0;
  const _aim = new THREE.Vector3();
  const _puff = new THREE.Vector3();
  /** A soft bump, 0..1..0, between two phases of the loop. */
  const bump = (phase: number, a: number, b: number) => {
    if (phase <= a || phase >= b) return 0;
    const x = (phase - a) / (b - a);
    return Math.sin(x * Math.PI) ** 2;
  };

  const drawRolling = (dt: number) => {
    // Wrapped, not accumulated. Twenty minutes on the menu is 50 km of
    // road, and a float that large has lost the millimetres the lane
    // markings are positioned in.
    if (parked === null) t = (t + dt) % LOOP_S;
    travelled = t * ROLL_SPEED;
    const phase = t / LOOP_S;

    // The road slides under the pair. Wrapping the offset as well keeps
    // the texture matrix in the first tile for ever.
    if (roadTex) roadTex.offset.y = (travelled / DASH) % 1;
    // And the city turns past, once per loop — see the skyline.
    if (skyTex) skyTex.offset.x = BEND * (travelled / SPAN);
    // Every prop steps toward the camera along the arc and comes back
    // round the front when it passes behind it. This is the seam that
    // is not there: nothing is created, nothing is destroyed, nothing
    // fades in. `s` is kept on the object so a test can ask where a
    // lamp is along the road without undoing the arc.
    for (const r of rollers) {
      const s = (((r.base - travelled) % SPAN) + SPAN) % SPAN - BEHIND;
      // x and z from the arc; y is the prop's own (the wall stands up).
      arcPoint(s, r.u, _aim);
      r.obj.position.x = _aim.x;
      r.obj.position.z = _aim.z;
      r.obj.rotation.y = arcYaw(s);
      r.obj.userData.s = s;
    }
    // Coming the other way. In the scrolling frame everything already
    // moves at -ROLL_SPEED; a car doing the same speed at us moves at
    // -ROLL_SPEED again on top, so it closes at twice the rate. That
    // halves its period, which still divides the loop.
    for (const r of oncoming) {
      const s = (((r.base - travelled * 2) % SPAN) + SPAN) % SPAN - BEHIND;
      arcPoint(s, r.u, _aim);
      r.obj.position.x = _aim.x;
      r.obj.position.z = _aim.z;
      r.obj.rotation.y = arcYaw(s);
      r.obj.userData.s = s;
    }

    // THE FIGHT. The lead swings between them on the loop: your car
    // noses ahead, the other pulls it back up the inside, and neither
    // ever gets more than a car length. The hero holds the corner
    // sideways — nose into the bend past the road's own heading,
    // fronts countersteered, body rolled to the outside — and the
    // drift breathes on the half-loop so it is held, not frozen. The
    // chaser drives it tidy: tucked in, a little steer, and a dab of
    // brake as the lead goes away from it.
    const swing = Math.sin(TAU * phase);
    drift = BEND * DRIFT_ANGLE * (1 + 0.15 * Math.sin(TAU * 2 * phase + 1.1));
    const rigs: Array<[Rig, number, number, number]> = far
      ? [
          [near, PLAYER_X, 0, 1],
          [far, RIVAL_X, 2.1, -1],
        ]
      : [[near, PLAYER_X, 0, 1]];
    for (const [rig, lane, ph, lead] of rigs) {
      const hero = rig === near;
      const s = lead * FIGHT_M * swing;
      // A car in a corner is not rigid: it breathes on its springs and
      // wanders inside its lane, and the two do it out of step or they
      // read as one object.
      const weave = Math.sin(TAU * phase + ph) * 0.22;
      arcPoint(s, lane + weave, rig.holder.position);
      rig.holder.position.y = Math.sin(TAU * 2 * phase + ph * 1.7) * 0.014;
      rig.holder.userData.s = s;
      rig.holder.rotation.y = arcYaw(s) + (hero ? drift : BEND * 0.03);
      // Rolled to the OUTSIDE of the bend, harder for the car that is
      // sliding, with the spring's own breathing on top.
      rig.holder.rotation.z = BEND * (hero ? 0.04 : 0.022) - Math.cos(TAU * phase + ph) * 0.008;
      rig.holder.rotation.x = Math.sin(TAU * 2 * phase + ph * 1.7) * 0.004 + (hero ? 0.006 : 0);
      // Wheels: turning at the speed the road is moving, and the fronts
      // pointed where each driver is pointing them — the hero's against
      // the slide, the chaser's into the corner.
      const steerWheel = hero ? -BEND * COUNTERSTEER : BEND * 0.12;
      const plan = rig.car?.userData.wheelPlan as { front: number } | undefined;
      const frontN = plan?.front ?? 2;
      rig.wheels.forEach((w, i) => {
        w.rotation.x += (ROLL_SPEED / rig.wheelR) * dt;
        if (i < frontN) w.rotation.y = steerWheel;
      });
      // The chaser's brake lamps, as it loses the lead.
      const brake = hero ? 0 : bump(phase, 0.6, 0.74);
      const ud = rig.car?.userData;
      if (ud?.tailMat && ud?.tailCoreMat) {
        (ud.tailMat as THREE.MeshStandardMaterial).emissiveIntensity =
          TAIL.lensIdle + (TAIL.lensBrake - TAIL.lensIdle) * brake;
        (ud.tailCoreMat as THREE.MeshStandardMaterial).emissiveIntensity =
          TAIL.coreIdle + (TAIL.coreBrake - TAIL.coreIdle) * brake;
        for (const g of (ud.tailGlowMats as THREE.MeshBasicMaterial[]) ?? []) {
          g.opacity = TAIL.glowIdle + (TAIL.glowBrake - TAIL.glowIdle) * brake;
        }
      }

      // And the person driving it. The hero's hands are across the
      // rim the other way from the nose — that is what a drift looks
      // like from the driver's seat — and both are looking through the
      // corner rather than down the bonnet. The lateral load passed in
      // is the real one for this radius at this speed, so the lean in
      // the seat is the lean a body actually takes.
      if (rig.driver) {
        const stick = hero ? -BEND * 0.6 : BEND * 0.3;
        rig.holder.updateWorldMatrix(true, false);
        look.set(BEND * (hero ? 1.2 : 2.0), RIG.driver.lookHeight, lookAheadFor(ROLL_SPEED));
        rig.holder.localToWorld(look);
        solveDriverRig(
          rig.driver,
          stick,
          hero ? 1 : RIG.rival.cruiseThrottle,
          brake,
          look,
          dt,
          BEND * CORNER_G,
          0
        );
      }
    }

    // Smoke off the hero's rear arches: thrown to the outside of the
    // corner and left behind at road speed, the race's own recipe. Not
    // while parked — a capture wants the same frame twice.
    if (smokeFx && parked === null) {
      smokeAcc += 80 * dt;
      const n = Math.floor(smokeAcc);
      smokeAcc -= n;
      near.holder.updateWorldMatrix(true, false);
      for (let i = 0; i < n; i++) {
        const side = (i % 2 === 0 ? 0.85 : -0.85) + (smokeRand() - 0.5) * 0.5;
        _puff.set(side, 0.24 + smokeRand() * 0.22, -1.45 + (smokeRand() - 0.5) * 0.5);
        near.holder.localToWorld(_puff);
        smokeFx.spawn(
          _puff.x, _puff.y, _puff.z,
          -BEND * (1.4 + smokeRand()) + (smokeRand() - 0.5),
          1.2 + smokeRand() * 1.4,
          -ROLL_SPEED * 0.85 + (smokeRand() - 0.5) * 2,
          0.9 + smokeRand() * 0.5,
          1.9 + smokeRand() * 0.9
        );
      }
    }
    smokeFx?.update(dt, { drag: 1.6, gravity: -0.35 });

    // Chase: behind, above, on the OUTSIDE of the corner, so the hero's
    // angle reads — from the inside a drifting car is a car pointing at
    // you — and drifting just enough that the frame is never dead. This
    // camera looks along +z, where the turntable's looks along -z, so
    // screen right is -x rather than +x and the aim offset that clears
    // the menu column runs the other way. It is aimed up the road at a
    // point ON the arc, so the corner is what the frame is about.
    const camY = 3.1 + Math.sin(TAU * phase) * 0.09;
    camera.position.set(offsetX * 0.3 - BEND * 2.4, camY, -dist + Math.sin(TAU * phase) * 0.5);
    arcPoint(18, 0, _aim);
    camera.lookAt(_aim.x + offsetX, 1.05, _aim.z);
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
      // A parked car still has somebody sitting in it, and a showroom
      // shot is the closest look anybody ever gets at the cabin. Hands
      // on the rim, feet on the pedals, eyes down the bonnet: the same
      // solve the race runs, given nothing to react to.
      if (near.driver) {
        near.holder.updateWorldMatrix(true, false);
        look.set(0, RIG.driver.lookHeight, lookAheadFor(0));
        near.holder.localToWorld(look);
        solveDriverRig(near.driver, 0, 0, 0, look, dt);
      }
    }
  };

  const draw = (dt: number) => {
    pose(dt);
    // The grain is a function of time, and a still turntable with a
    // frozen grain pattern is a dirty lens rather than film.
    gradePass.uniforms.uTime.value = (performance.now() / 1000) % 100;
    renderer.info.reset();
    composer.render();
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
    get speedMs() {
      return rolling ? ROLL_SPEED : 0;
    },
    get bendRadius() {
      return rolling ? BEND_R : 0;
    },
    get driftAngle() {
      return rolling ? drift : 0;
    },
    get smoke() {
      return smokeFx?.alive ?? 0;
    },
    scene,
    camera,
    // Exposed for the same reason scene and camera are: the measuring
    // tools need to re-render this scene with their own materials (the
    // ID pass in tools/shots/levels.mjs) and to force a frame after
    // parking it.
    renderer,
    composer,
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
      skyTex?.dispose();
      smokeFx?.dispose();
      scene.environment?.dispose();
      composer.dispose();
      sceneTarget.dispose();
      renderer.dispose();
    },
  };
}
