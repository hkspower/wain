import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { Track, ROAD_HALF_WIDTH, LANES, DRIFT_PLAZA, COAST_U } from "./track";
import { buildWorld, areaAt, STREETS, WorldHandle } from "./world";
import { createCar } from "./cars";
import { RIVALS, RivalDef } from "./rivals";
import { VoiceBox } from "./voice";
import { SoundEngine } from "./sound";
import { ParticleSystem, radialSprite } from "./vfx";
import { solveTwoBone, aimConstrained } from "./ik";
import { nightEnvironment } from "./env";
import { RIG } from "./rig";
import { textTexture, arabicUI } from "./text";
import { GradeShader, AutoExposure, ExposurePass } from "./grade";
import type { DriverRig } from "./characters";
import { Music } from "./music";
import {
  solveDrift,
  newDriftState,
  breakChain,
  type DriftState,
} from "./drift";
import {
  solveBrakes,
  newBrakeState,
  brakeCeiling,
  type BrakeState,
  type BrakeResult,
} from "./brakes";
import { GEARS } from "./gears";
import { loadGarage, saveGarage, computeEffects, addKd, TuneEffects, getCar, CARS } from "./mods";
import { levelInfo, recordRace, recordLap, loadProfileStats, LevelInfo } from "./profile";

// Tokyo-Xtreme-Racer-style rules, Kuwait edition: cruise the loop, find the
// rival, flash your headlights (F) to start a battle. Both drivers have SP
// (Spirit Points); the one trailing bleeds SP, crashes bleed more. Empty
// the rival's bar to take their crown and move up the roster.

const KMH = 3.6;
const SMOKE_N = 110;
/** Pre-battle cinematic length in real seconds (shots at 1.8 / 3.6):
 *  the rival's close-up, the side-by-side two-shot at the line, and the
 *  pull up into the chase as the flag drops. */
const CINE_LEN = 5.6;
/** Fallback normaliser for speed-driven camera effects, used only
 *  before a tune is applied. The live value follows the car's own
 *  governor (see topSpeedRef), so a 180 km/h hatch feels as fast at its
 *  limit as a 400 km/h flagship does at its. */
const PLAYER_TOP_SPEED = 92; // m/s ≈ 331 km/h
const FLASH_RANGE = 60;
const SAVE_KEY = "gulf-road-nights-progress";

export interface BattleHud {
  playerSp: number;
  rivalSp: number;
  rivalName: string;
  rivalArabic: string;
  rivalCrew: string;
}

export interface HudData {
  /** Headlight flashes landed so far in the current challenge window (0-3). */
  flashCount: number;
  speedKmh: number;
  areaName: string;
  areaArabic: string;
  rivalDist: number | null;
  canFlash: boolean;
  battle: BattleHud | null;
  defeated: number;
  total: number;
  map: { px: number; py: number; rx: number; ry: number } | null;
  /** Nearest online player within challenge range, if any. */
  nearestRemote: { id: number; name: string; dist: number } | null;
  /** Live PvP duel state, or null when not duelling. */
  duel: { you: number; them: number; gap: number; opponent: string } | null;
  /** Turbo boost 0..1, or null when no turbo is fitted. */
  boost: number | null;
  /** NOS charge 0..1, or null when no kit is fitted. */
  nos: number | null;
  /** Live drift readout — non-null while sliding (and briefly after).
   *  `chain` is the link multiplier; `spinning` means it got away. */
  drift: {
    deg: number;
    score: number;
    active: boolean;
    chain: number;
    spinning: boolean;
  } | null;
  /** Brake state the driver needs to see: locked wheels, ABS, fade. */
  brakes: { lock: number; fade: number; abs: boolean };
}

export interface DriverCard {
  name: string;
  arabicName?: string;
  crew: string;
  level: number;
  country: string;
  flag: string;
  color: number;
  /** Machine on the line. */
  car: string;
}

/** One line of the post-race reward reel. */
export interface RewardLine {
  /** An icon NAME the UI draws (see race/Icons.tsx), never a glyph:
   *  an emoji here is artwork chosen by the operating system. */
  icon: string;
  title: string;
  sub: string;
}

/** Everything the results sequence needs, computed once when a race ends. */
export interface RaceResult {
  outcome: "win" | "loss";
  /** 1st or 2nd — the podium line at the top of the card. */
  position: 1 | 2;
  rival: DriverCard;
  /** KD staked by each side. */
  purse: number;
  /** Signed KD change (prize + purse, or the purse lost). */
  kd: number;
  balance: number;
  xpGain: number;
  /** Level bar before and after the XP is applied — drives the fill. */
  levelBefore: LevelInfo;
  levelAfter: LevelInfo;
  /** How the XP was earned, itemised. */
  xpBreakdown: Array<{ label: string; value: number }>;
  stats: {
    topSpeedKmh: number;
    durationMs: number;
    contacts: number;
    clean: boolean;
    /** Biggest SP gap held over the rival, 0..100. */
    maxLeadSp: number;
    distanceM: number;
  };
  career: { races: number; wins: number; streak: number; bestStreak: number };
  rewards: RewardLine[];
  champion: boolean;
  /** Who is waiting next, when the roster continues. */
  nextRival: { name: string; arabicName: string; crew: string } | null;
}

export interface EngineEvents {
  onHud(d: HudData): void;
  onMessage(title: string, sub?: string): void;
  onBump(): void;
  onDefeat(rival: RivalDef): void;
  onChampion(): void;
  /** Fired when a full lap is completed, with the lap time in ms. */
  onLap?(ms: number): void;
  /** Fired the moment a battle begins — drives the VS splash. */
  onBattleStart?(rival: RivalDef): void;
  /** Three flashes landed: both cars revealed, race setup opens. */
  onChallenge?(player: DriverCard, rival: DriverCard, maxWager: number): void;
  /** The rival's answer to the challenge. */
  onChallengeResult?(accepted: boolean, reason: string): void;
  /** A race ended — drives the full results sequence. */
  onResult?(r: RaceResult): void;
  /** Pre-battle cinematic begins/ends — drives the letterbox and the
   *  versus cards. `stake` is the KD each side has up (0 = pride only);
   *  `you` is the player's own card for the right side of the VS frame. */
  onCinematic?(active: boolean, rival: DriverCard, stake: number, you?: DriverCard): void;
  /** The controller's Start button — the UI opens its pause menu. */
  onPauseRequest?(): void;
}

interface RemotePlayer {
  name: string;
  mesh: THREE.Group;
  s: number;
  lat: number;
  snapS: number;
  snapLat: number;
  snapSpeed: number;
  snapAt: number;
  /** Smoothed visible steer for the remote car's driver rig. */
  steerVis: number;
}

interface TrafficCar {
  mesh: THREE.Group;
  s: number;
  lat: number;
  speed: number;
  /** Smoothed visible steer for this car's driver. */
  steerVis: number;
}

interface Rival {
  def: RivalDef;
  mesh: THREE.Group;
  s: number;
  lat: number;
  targetLat: number;
  speed: number;
  sp: number;
  state: "cruise" | "battle" | "defeated";
  // What the rival's driver is seen doing: smoothed steer and pedal
  // work derived from the AI's own kinematics, fed to the same IK that
  // animates the player's driver.
  steerVis: number;
  throttleVis: number;
  brakeVis: number;
}

/** Traffic drivers are solved inside this range, nearest first. */
const TRAFFIC_DRIVER_RANGE = 120;
const TRAFFIC_DRIVERS_SOLVED = 6;

/**
 * How many civilians share the road.
 *
 * Raised from 30. Every one of them now carries a driver rig, and the
 * measurement that made this safe was that thirty of those cost no draw
 * calls at all once the steering spokes came off the lean build — so
 * the ceiling here is not the GPU, it is the O(n^2) scan below where
 * each car checks every other for the one ahead in its lane. At 46 that
 * is ~2,100 comparisons a frame against a CPU update budget measured at
 * 1 ms median, which is room to spare; at a few hundred cars it would
 * need a lane bucket instead of a nested loop.
 */
const TRAFFIC_COUNT = 46;

const TRAFFIC_COLORS = [0x8a96a3, 0x5d6770, 0xb0a890, 0x6e7f8d, 0x4a5560, 0x9c8f7a];

// Unsharp-mask crispening + film vignette + animated grain, in linear
// space before output.
// Final grade: unsharp crispen, vignette, luminance-weighted grain, then a
// hard black point. Order matters — the black point runs last so nothing
// downstream can lift the shadows back up.
/** Spin a car's wheels with road speed; fronts also take a steer angle. */
/**
 * Roll the wheels.
 *
 * The rate is the real one, omega = v / r against the tire's own 0.36 m
 * radius, but a wheel is not always doing v / r. Two cases matter and
 * both are things the player is deliberately causing:
 *
 *   `lock` — a wheel past the tire's limit under braking has stopped
 *   turning and is sliding. Everything else already said so — the smoke,
 *   the squeal, the stopping distance — and four wheels spinning happily
 *   through a locked stop was the one thing still giving it away.
 *
 *   `spin` — torque the driven axle could not put down. Only the REAR
 *   wheels get it: a burnout with all four spinning is a four-wheel-drive
 *   car, and none of these are.
 */
function spinWheels(
  car: THREE.Object3D,
  speed: number,
  dt: number,
  steer = 0,
  lock = 0,
  spin = 0
): void {
  const wheels = car.userData.wheels as THREE.Group[] | undefined;
  if (!wheels) return;
  const R = 0.36; // tire radius, metres — matches tireGeo in cars.ts
  const rolling = speed * (1 - lock);
  for (let i = 0; i < wheels.length; i++) {
    const driven = i >= 2; // 0,1 front · 2,3 rear
    const surface = rolling + (driven ? spin * 0.8 : 0);
    wheels[i].rotation.x += (surface / R) * dt;
    if (i < 2) wheels[i].rotation.y = steer;
  }
}

/**
 * The headlight splash on the asphalt: two overlapping lobes rather than
 * one blob, because a car has two lamps and the pair reads as a wide hot
 * bar near the bumper that merges into a single pool further out. The
 * near edge is cut off sharply — light does not wrap back under the car.
 */
function headlightPoolTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  // v runs 0 at the near (bumper) edge to 1 far up the road
  const lobe = (cx: number, cy: number, rx: number, ry: number, a: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(255,248,222,${a})`);
    g.addColorStop(0.45, `rgba(255,242,205,${a * 0.42})`);
    g.addColorStop(1, "rgba(255,236,190,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  ctx.globalCompositeOperation = "lighter";
  // Two lamp lobes, splayed and reaching up the road
  lobe(S * 0.36, S * 0.56, S * 0.3, S * 0.42, 0.5);
  lobe(S * 0.64, S * 0.56, S * 0.3, S * 0.42, 0.5);
  // The shared hot spot where both beams overlap
  lobe(S * 0.5, S * 0.44, S * 0.26, S * 0.3, 0.34);
  // Fade the very near edge so the pool does not start under the nose
  const cut = ctx.createLinearGradient(0, S, 0, S * 0.74);
  cut.addColorStop(0, "rgba(0,0,0,1)");
  cut.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = cut;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Length-wise gradient for the visible beam cone. A cone painted a flat
 * colour reads as a solid wedge of plastic; real light in dusty air is
 * brightest at the lamp and dissolves as it spreads.
 */
function beamGradientTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  // The cone is additive and double-sided, so the eye sums both walls —
  // and those walls converge at the apex, piling the accumulation into a
  // bright dome sitting on top of the car. So the shaft fades to nothing
  // at BOTH ends: out at the apex to kill that dome, and out at the far
  // end where the light should dissolve into the night.
  // v runs 0 at the wide far end to 1 at the apex. The profile is kept
  // deliberately FLAT between the end fades: from the chase camera you
  // look straight down the cone's axis, and any peak along its length
  // accumulates into a defined bright lens floating over the road. Even
  // haze reads as air; a shaped core reads as a solid object.
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0.0, "rgba(255,238,195,0)"); // far end, dissolved
  g.addColorStop(0.22, "rgba(255,242,205,0.5)");
  g.addColorStop(0.78, "rgba(255,244,210,0.55)");
  g.addColorStop(1.0, "rgba(255,244,210,0)"); // apex, hidden at the lamp
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Floating name banner above an online player's car.
 *
 * Players on a Kuwaiti server type their names in Arabic, and this drew
 * them in a bare `sans-serif` on a raw canvas — the exact failure
 * text.ts was written to prevent. Two things went wrong at once: the
 * generic face has no Arabic coverage, so the shaper fell back per
 * glyph and the letters came out unjoined; and a raw canvas is painted
 * once and uploaded to the GPU, so even after the real face loaded the
 * texture kept whatever it had. textTexture() repaints when the fonts
 * land, and the Arabic stack now carries the Latin face after it, so
 * one call covers a name in either script or a name in both.
 */
function makeNameTag(name: string): THREE.Sprite {
  const tex = textTexture(256, 64, (ctx) => {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.roundRect(8, 10, 240, 44, 12);
    ctx.fill();
    ctx.fillStyle = "#7ee8ff";
    ctx.font = `700 28px ${arabicUI()}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.slice(0, 16), 128, 33);
  });
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  sprite.scale.set(5, 1.25, 1);
  sprite.position.y = 3;
  return sprite;
}

export class GameEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private track = new Track();
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;
  private paused = false;

  private keys = new Set<string>();
  /** On-screen (touch) controls, merged with the keyboard. */
  private touch = { throttle: 0, brake: 0, steer: 0, drift: false };
  // Gamepad: polled every frame, merged into the same input model as
  // keys/touch. Sticks steer, triggers drive, face buttons do the rest.
  private pad = { steer: 0, throttle: 0, brake: 0, drift: false, nos: false };
  private padButtons: boolean[] = [];
  private padSeen = false;
  /** RAF throttles hard on hidden/paused pages; a timer keeps the Start
   *  button responsive there. Edges are consumed per poll, so the two
   *  callers can never double-fire one press. */
  private padTimer: ReturnType<typeof setInterval> | null = null;
  private events: EngineEvents;

  // Player — spawns just past the start-line gantry
  private player = { s: 40, lat: LANES[1], speed: 0, sp: 100 };
  private playerMesh: THREE.Group;
  private carBody: THREE.Group;
  private headlight: THREE.SpotLight;
  /** Visible beam cones — flared with the lamps during the flash ritual. */
  private beamMat: THREE.MeshBasicMaterial | null = null;
  private beamBaseOpacity = 0.05;
  /** The night-time values the daylight response scales down from. */
  private beamBaseOpacityNight = 0.05;
  private headlightBase = 1;
  private beamCamDir = new THREE.Vector3();
  private beamCarDir = new THREE.Vector3();
  // Live reflection probe: a low-res cube camera rides with the player so
  // streetlights, towers and neon actually sweep across the paint.
  private cubeRT!: THREE.WebGLCubeRenderTarget;
  private cubeCam!: THREE.CubeCamera;
  /** Every car in the scene — player, rival, traffic, other players — so
   *  one reflection policy dresses all of them. See dressReflections. */
  private carGroups = new Set<THREE.Object3D>();
  private cubeFrame = 0;
  private liveReflections = true;
  // Dynamic resolution: a continuous governor scales the internal render
  // resolution to hold frame rate; the tier sets the ceiling.
  private baseRatio = 1;
  private renderScale = 1;
  private drsEnabled = true;
  private drsAt = 0;

  private traffic: TrafficCar[] = [];
  private rival: Rival | null = null;
  private rivalIndex = 0;
  private inBattle = false;
  /** One critical-SP radio call per battle, not one per frame. */
  private spWarned = false;
  private locked = false; // input locked after defeat / championship

  // Challenge ritual: three headlight flashes inside a rolling window
  private flashCount = 0;
  private flashWindowUntil = 0;
  private challengePending = false;
  private challengeTimers: ReturnType<typeof setTimeout>[] = [];
  private challengePace = 0;
  private challengeAccepted = false;
  /** KD staked on the current race (each side puts it up). */
  private wager = 0;
  /** Per-battle telemetry, reset at the green light, read at the finish. */
  private bstat = { startAt: 0, dist: 0, topSpeed: 0, contacts: 0, maxLead: 0, driftScore: 0 };

  /** Set when a film ends; cleared the first frame nothing is held. */
  private handbrakeStale = false;

  // Drift: the handbrake breaks the rear loose. driftYaw is how far the
  // body points past the direction of travel; the velocity heading is
  // dragged after it, which is what actually carries the car around.
  // The balance that holds it there — and the spin that ends one that got
  // away — live in drift.ts; this is the state it carries between frames.
  private ds: DriftState = newDriftState();
  private bs: BrakeState = newBrakeState();
  /** Last frame's brake solve, for the HUD, the squeal and the smoke. */
  private brakeOut: BrakeResult | null = null;
  /** The angle itself. An accessor rather than a field because the whole
   *  engine — camera, body pose, smoke, sound, the debug surface — reads
   *  and writes it, and the solver needs it in one object. */
  private get driftYaw(): number {
    return this.ds.angle;
  }
  private set driftYaw(v: number) {
    this.ds.angle = v;
  }
  /** The current car's governed speed in m/s — what the camera, FOV and
   *  rumble normalise against. */
  private get topSpeedRef(): number {
    return Math.max(20, (this.tune?.topSpeedKmh ?? PLAYER_TOP_SPEED * KMH) / KMH);
  }

  /** m/s² of engine torque the driven tires could NOT transmit this
   *  frame — the launch-burnout signal for wheels, smoke and power-over. */
  private wheelspin = 0;
  /** Style points for the current, still-unbanked slide. */
  private get driftRun(): number {
    return this.ds.run;
  }
  private set driftRun(v: number) {
    this.ds.run = v;
  }
  /** Seconds the readout lingers after the slide ends. */
  private driftFlash = 0;

  // Pre-battle rival cinematic: wall-clock start for the camera timeline,
  // world in slow motion underneath. Null when not playing.
  private cine: { start: number; r: Rival } | null = null;

  // Online cruise
  private remotes = new Map<number, RemotePlayer>();
  /** Live duel, mirrored from the hub referee for the HUD. */
  private duel: { you: number; them: number; gap: number; opponent: string } | null = null;

  // Lap timing (wall clock, credited back for pauses and film slow-mo)
  private lapStartAt = 0;
  private pausedAt = 0;
  private lapDistance = 0;

  private bumpCooldown = 0;
  private scrapeCooldown = 0;
  // Garage tuning (loaded once at engine start; edit in the menu garage)
  private tune: TuneEffects = computeEffects(loadGarage());
  private boost = 0; // turbo spool 0..1
  private nosCharge = 1; // 0..1, drains while N is held
  private nosActive = false;
  // Handling model: heading relative to the track tangent, smoothed
  // steering input, centrifugal slip in curves, weight-transfer pitch
  private heading = 0;
  private steerSmooth = 0;
  private slipVel = 0;
  private pitch = 0;
  private fovCurrent = 62;
  private camInit = false;

  // Rendering quality
  private world: WorldHandle;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private grainPass: ShaderPass;
  private autoExp!: AutoExposure;
  private exposurePass!: ExposurePass;
  private fxaaPass: ShaderPass;
  private fpsEma = 60;
  /**
   * Frame pacing. The browser hands us requestAnimationFrame, which is
   * already v-sync locked and cannot be turned off from JS — there is no
   * web API for v-sync or for G-Sync/VRR. What we CAN do is choose how
   * often we accept a frame, which is the half of the problem that
   * actually matters here.
   */
  /**
   * What this device can actually do. Ceilings were hardcoded — an 8192
   * shadow map on Ultra, a 256 cube probe — which is simultaneously too
   * large for a GPU reporting a 4096 texture limit (the allocation fails
   * or is silently clamped) and too small for one that could serve four
   * times that. Read the limits and scale to them.
   */
  private caps = {
    maxTexture: 4096,
    maxCube: 4096,
    memoryGB: 4,
    cores: 4,
  };
  private refreshHz = 0;          // measured panel refresh, 0 until known
  private refreshSamples: number[] = [];
  private frameMinMs = 0;         // 0 = accept every frame the browser offers
  private lastFrameAt = 0;
  private frameCap: "display" | "vrr" | number = "display";
  private qualityLocked = false; // user took manual control with G
  private startedAt = 0;
  private moonDir = new THREE.Vector3(-300, 500, 200).normalize();
  private lightRight = new THREE.Vector3();
  private lightUp = new THREE.Vector3();

  // Drift tire smoke spawn accumulator (see updateEffects)
  private sparkFx!: ParticleSystem;
  private smokeFx!: ParticleSystem;
  private flameFx!: ParticleSystem;
  /** Brake-rotor temperature, 0..1, per wheel — heat in, heat out. */
  private rotorHeat = 0;
  /** Rising edge detector for backfires on throttle lift. */
  private lastThrottleFx = 0;
  private smokeAcc = 0;

  // Minimap
  private mapBounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };

  // Audio
  private sound: SoundEngine | null = null;
  private music: Music | null = null;
  private voice = new VoiceBox();

  // Camera motion
  private shake = 0; // impact jolt energy, decays
  private camBase = new THREE.Vector3(); // lerped chase position, pre-shake
  private camRoll = 0;
  private curvature = 0; // signed, from the handling model
  private streaks!: THREE.LineSegments;
  private streakData: Array<{ s: number; lat: number; y: number; len: number }> = [];

  // scratch
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, events: EngineEvents, opts?: { startS?: number }) {
    this.events = events;
    if (opts?.startS !== undefined && Number.isFinite(opts.startS)) {
      this.player.s = Math.max(0, opts.startS);
    }
    // Ask for the discrete GPU by name.
    //
    // Without this hint the browser picks the "default" adapter, and on
    // a hybrid laptop — an NVIDIA card alongside the CPU's integrated
    // graphics, which is most gaming laptops — default frequently means
    // the integrated one. The game then runs on the weaker GPU while
    // the NVIDIA card idles, and nothing in the game can tell you that
    // is happening. It is the single largest performance lever
    // available to a browser game and it costs one property.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    // Full native resolution — on a 4K panel this renders 4K, not an
    // upscaled 1080p. Adaptive quality drops it if the GPU can't hold up.
    this.baseRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this.baseRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    {
      const gl = this.renderer.getContext();
      const nav = navigator as Navigator & { deviceMemory?: number };
      this.caps = {
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        maxCube: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE) as number,
        // deviceMemory is coarse and absent on Safari/Firefox; 4 GB is the
        // conservative read, not an optimistic one.
        memoryGB: nav.deviceMemory ?? 4,
        cores: navigator.hardwareConcurrency || 4,
      };
    }
    // Colour management on, explicitly. It has defaulted to on since
    // three r152, but every material colour in this project is authored
    // as an sRGB hex and every canvas texture is tagged sRGB — the whole
    // build assumes the renderer converts those to linear before it
    // lights them and back on the way out. Leaving that to a library
    // default is leaving the accuracy of every colour in the game to a
    // default.
    THREE.ColorManagement.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Exposure is applied by ExposurePass, in the chain, so the renderer
    // itself stays neutral — otherwise the two would multiply.
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    // PCF, not PCFSoft: three 0.184 deprecated PCFSoftShadowMap and its
    // shadow map silently overwrites the type with PCFShadowMap on the
    // first render. Asking for soft and receiving hard is worse than
    // asking for what you get — this is the filter that actually runs.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Far plane is matched to the fog, not to the track. FogExp2 at density
    // 0.0009 has hidden everything by ~2,550 m, so anything past that was
    // being rasterised for nothing. Clipping there costs no visible range
    // and buys back depth precision (near:far 5200:1 instead of 14000:1),
    // which also steadies the road markings against z-fighting.
    this.camera = new THREE.PerspectiveCamera(62, canvas.clientWidth / canvas.clientHeight, 0.6, 2600);

    this.buildEnvironment();
    this.world = buildWorld(this.scene, this.track);
    this.computeMapBounds();

    // Moonlight shadows: a compact ortho frustum that the loop keeps
    // centred on the player, so nearby cars, rails, and poles all throw
    // long moon shadows across the asphalt.
    const moon = this.world.moonLight;
    moon.castShadow = true;
    moon.shadow.mapSize.setScalar(this.budget(4096));
    moon.shadow.camera.left = -90;
    moon.shadow.camera.right = 90;
    moon.shadow.camera.top = 90;
    moon.shadow.camera.bottom = -90;
    moon.shadow.camera.near = 50;
    moon.shadow.camera.far = 1000;
    // Acne vs peter-panning: lean on normalBias (surface-slope aware)
    // rather than a large constant depth bias
    moon.shadow.bias = -0.0003;
    moon.shadow.normalBias = 0.05;
    this.scene.add(moon.target);
    // Basis for texel-snapping the shadow frustum as it follows the car
    this.lightRight.crossVectors(this.moonDir, new THREE.Vector3(0, 1, 0)).normalize();
    this.lightUp.crossVectors(this.lightRight, this.moonDir).normalize();

    // Bloom makes the night work: lamps, taillights, cat-eyes and the
    // tower spheres all halo. Auto-disabled on weak machines (see loop).
    // NOTE: no multisampled render target here — an MSAA composer buffer
    // silently breaks the shadow-map pass on some GL stacks (shadows
    // vanish entirely). Edge smoothing comes from a final FXAA pass,
    // which leaves shadows alone.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Exposure sits here on purpose: after the scene, before bloom and
    // tone mapping. It is the only point in the chain where the numbers
    // are still scene-referred light rather than picture, and putting it
    // ahead of the bloom means the bloom thresholds against exposed
    // light the way a real camera's would.
    this.autoExp = new AutoExposure();
    this.exposurePass = new ExposurePass(this.autoExp);
    this.composer.addPass(this.exposurePass);
    // Comfort-tuned: enough halo to sell the sodium lamps, tight enough
    // that bright edges never smear across dark areas and tire the eye.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      0.42,
      0.4,
      0.85
    );
    this.composer.addPass(this.bloomPass);
    // OutputPass (tone map + sRGB encode) must run BEFORE the grade.
    // Grading scene-referred HDR meant the final clamp(0,1) clipped every
    // emissive above 1 — lamps, taillights and beacons lost their ACES
    // shoulder and the black point was operating in the wrong space.
    this.composer.addPass(new OutputPass());
    this.grainPass = new ShaderPass(GradeShader);
    this.composer.addPass(this.grainPass);
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaaPass);
    this.updateFxaaResolution();

    // Sparks: white-hot at birth, ember by death, and they skitter along
    // the asphalt instead of sinking through it.
    // Sparks are additive, and sixty of them overlap in the same square
    // of screen during a scrape — so each one's brightness is not what
    // reaches the eye, the SUM is. At full opacity with a near-white
    // core the pile saturated: 210 pixels pinned to pure white on a
    // single wall hit, before bloom had its turn on them. A spark is the
    // brightest thing in a night frame and should read that way, but a
    // white hole with no shape in it is not a shower of sparks.
    // Held down so a lone spark still punches and a shower stacks into
    // hot amber instead of flat paper white.
    //
    // Metered since: a full-severity scrape run twice, once with the
    // sparks drawn and once with them hidden, moves about ten pixels of
    // a 129,600-pixel frame across the clipping point. They are not
    // blowing the picture out — what makes them read hot is that they
    // are the only thing in a night frame at full luminance, and the
    // bloom threshold sits below them. Stepped down once more here
    // rather than reaching for the bloom, which the sodium lamps share.
    this.sparkFx = new ParticleSystem(140, {
      map: radialSprite(0.35, 1.4),
      colorA: 0xffdf9e, // hot, with headroom left above it
      colorB: 0xff5a12,
      blending: THREE.AdditiveBlending,
      grow: 0.5, // sparks shrink as they cool
      opacity: 0.4,
      fadeIn: 0.02,
    });
    this.scene.add(this.sparkFx.points);

    // Tire smoke: each puff expands, turns and thins on its own clock.
    this.smokeFx = new ParticleSystem(SMOKE_N, {
      map: radialSprite(0.0, 1.5),
      colorA: 0xc4c9d2,
      colorB: 0x3c4148,
      grow: 2.2,
      spin: 0.3,
      opacity: 0.13,
      fadeIn: 0.12,
    });
    this.scene.add(this.smokeFx.points);

    // Exhaust: backfire on lift, and the nitrous flame while it is open.
    this.flameFx = new ParticleSystem(90, {
      map: radialSprite(0.25, 1.2),
      colorA: 0xffd9a0,
      colorB: 0xff2a00,
      blending: THREE.AdditiveBlending,
      grow: 2.2,
      opacity: 0.9,
      fadeIn: 0.05,
    });
    this.scene.add(this.flameFx.points);

    // Wind streaks — motion lines that fade in past ~220 km/h
    {
      const N = 40;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      this.streaks = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color: 0xcfe8ff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      this.streaks.frustumCulled = false;
      this.scene.add(this.streaks);
      for (let i = 0; i < N; i++) this.streakData.push(this.newStreak(this.player.s));
    }

    // Player car — Kuwait flag colours: white body, green stripe
    this.carBody = this.trackCar(createCar({
      body: this.tune.paint,
      accent: 0x007a3d,
      style: this.tune.bodyStyle,
      underglow: this.tune.glow ?? undefined,
      spoiler: this.tune.spoiler,
      goldRims: this.tune.goldRims,
      raceKit: this.tune.raceKit,
      stickers: this.tune.stickers,
      stickerNumber: this.stickerNumber(),
    }));
    this.playerMesh = new THREE.Group();
    this.playerMesh.add(this.carBody);
    // The contact blob must stay flat on the road — carBody pitches and
    // rolls with weight transfer, which would tilt it into the asphalt
    const contact = this.carBody.userData.contact as THREE.Object3D | undefined;
    if (contact) this.playerMesh.add(contact);
    this.scene.add(this.playerMesh);

    this.headlight = new THREE.SpotLight(0xfff2cc, 90, 90, 0.42, 0.45, 1.4);
    this.headlightBase = 90;
    this.headlight.position.set(0, 1.1, 1.8);
    this.headlight.target.position.set(0, 0, 40);
    // Your own headlights throw real moving shadows off traffic and rails
    this.headlight.castShadow = true;
    this.headlight.shadow.mapSize.set(1024, 1024);
    this.headlight.shadow.camera.near = 2;
    // (shadow far is governed by the light's distance, 90 m)
    this.headlight.shadow.bias = -0.002;
    this.headlight.shadow.normalBias = 0.03;

    // Cool rim light riding behind the roofline — the body edge reads
    // against dark asphalt instead of dissolving into it.
    const rim = new THREE.PointLight(0x86a9ff, 4.5, 13, 1.8);
    rim.position.set(0, 2.6, -4.4);
    this.playerMesh.add(rim);

    // The live paint probe. HalfFloat so HDR lamp emissives survive into
    // the clearcoat as real hot streaks — with an LDR fallback where float
    // render targets don't exist. No mip chain: physical materials read
    // the cube through a PMREM conversion, which filters for itself.
    const floatOk =
      this.renderer.extensions.has("EXT_color_buffer_float") ||
      this.renderer.extensions.has("EXT_color_buffer_half_float");
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    this.cubeCam = new THREE.CubeCamera(0.5, 420, this.cubeRT);
    this.scene.add(this.cubeCam);
    this.applyLiveReflections();
    this.playerMesh.add(this.headlight, this.headlight.target);

    // Visible beam cones + a splash of light on the road ahead
    {
      const beamGeo = new THREE.ConeGeometry(1.5, 13, 14, 1, true);
      beamGeo.rotateX(-Math.PI / 2); // apex toward the car, opening forward
      const beamMat = new THREE.MeshBasicMaterial({
        map: beamGradientTexture(),
        color: 0xfff3cf,
        transparent: true,
        opacity: 0.05, // barely-there haze; the road pool does the work
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.beamMat = beamMat;
      this.beamBaseOpacity = beamMat.opacity;
      this.beamBaseOpacityNight = beamMat.opacity;
      for (const sx of [-0.7, 0.7]) {
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(sx, 0.8, 8.7);
        // Splay each beam outward a touch so the pair diverges down the
        // road instead of running as two parallel tubes
        beam.rotation.y = sx > 0 ? -0.035 : 0.035;
        this.playerMesh.add(beam);
      }
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 17),
        new THREE.MeshBasicMaterial({
          map: headlightPoolTexture(),
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        })
      );
      pool.rotation.x = -Math.PI / 2;
      // Rotated flat, the plane's +v axis points back toward the car, so
      // the texture's near-edge cut lands at the bumper end.
      pool.rotation.z = Math.PI;
      pool.position.set(0, 0.07, 10.5);
      this.playerMesh.add(pool);
    }

    this.spawnTraffic(TRAFFIC_COUNT);

    this.rivalIndex = this.loadProgress();
    this.spawnRival();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /** The night the paint reflects — see env.ts. Shared with the main
   *  menu's turntable so both are lit by the same city. */
  private buildEnvironment(): void {
    this.scene.environment = nightEnvironment(this.renderer);
  }

  // ---------------------------------------------------------------- public

  start(): void {
    try {
      this.sound = new SoundEngine();
      this.sound.configureAspiration(
        this.tune.aspiration === "super" ? "super" : this.tune.boostMult > 0 ? "turbo" : "none"
      );
      this.sound.revStart();
      this.music = new Music(this.sound.audioContext);
      // Wire the voice into the mix: whenever anyone speaks — a recorded
      // ElevenLabs line or the synthesized fallback — the bed and the
      // score step back, and come home when they stop.
      this.voice.onSpeaking = (speaking) => {
        this.sound?.duckForVoice(speaking);
        this.music?.duckForVoice(speaking);
      };
      this.music.start();
    } catch {
      this.sound = null;
    }
    this.clock.getDelta();
    this.lapStartAt = performance.now();
    this.startedAt = performance.now();
    this.padTimer = setInterval(() => this.pollGamepad(), 50);
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const nowMs = performance.now();
      this.measureRefresh(nowMs);
      // Frame limiter. The half-millisecond slack matters: without it a
      // cap set equal to the refresh rate loses the race with itself
      // every other frame and the game runs at exactly half rate.
      if (this.frameMinMs > 0) {
        // Frame limiting on a fixed schedule, not on arrival times.
        //
        // Re-basing the next deadline on the moment a frame happened to
        // arrive lets the error accumulate, and when the cap sits near
        // the panel's own rate the two beat against each other: most
        // frames pass, then one lands a hair early and is dropped, so a
        // steady 60 becomes a visible 60/30 judder while the average
        // still reads 60. Advancing the deadline by whole frame periods
        // keeps the cadence locked to the target instead.
        const due = this.lastFrameAt + this.frameMinMs;
        if (nowMs < due - 0.5) return;
        // Resync rather than sprint to catch up if we fell more than a
        // frame behind — a hidden tab or a long stall must not be repaid
        // with a burst of frames.
        this.lastFrameAt = nowMs - due > this.frameMinMs ? nowMs : due;
      }
      const raw = this.clock.getDelta();
      if (raw > 0) this.fpsEma = this.fpsEma * 0.95 + (1 / raw) * 0.05;
      this.autoQuality();
      this.updateDrs(performance.now());
      const dt = Math.min(raw, 0.05);
      // Polled outside update() so Start still works while paused
      this.pollGamepad();
      if (!this.paused) this.update(dt);
      // Refresh the paint's reflection probe — ONE cube face per frame.
      //
      // CubeCamera.update() renders the whole scene six times in a single
      // call. Doing that on a stride gave the probe a full refresh every
      // sixth frame and made that frame cost roughly seven times its
      // neighbours: the average frame rate looked fine while every sixth
      // frame missed its vsync deadline, which is what a player feels as
      // a stutter rather than as a low number. Rendering face n on frame
      // n keeps exactly the same refresh cadence — all six faces inside
      // six frames — with the cost spread flat.
      //
      // Every face render would redraw the shadow maps too, so freeze
      // them for the probe (the main render's maps are reused), and
      // re-convolve the PMREM cache once per completed sweep or the
      // paint keeps the first frame forever.
      if (this.liveReflections && !this.paused) {
        this.renderProbeFace();
      }
      // One pipeline for both quality modes keeps colour grading identical
      this.composer.render();
    };
    loop();
    const r = this.rival;
    if (r) {
      this.events.onMessage(
        `Find ${r.def.name} — ${r.def.arabicName}`,
        `${r.def.crew} · close in and flash 3× to challenge`
      );
      this.voice.speak("يلا! دور على خصمك", {}, "announcer-start"); // announcer
    } else if (this.rivalIndex >= RIVALS.length) {
      // Reloaded as a reigning champion — straight to the crown screen.
      // Deferred: the caller sets its "playing" state right after start().
      setTimeout(() => {
        if (!this.disposed) this.events.onChampion();
      }, 0);
    }
  }

  setPaused(p: boolean): void {
    if (p && !this.paused) this.pausedAt = performance.now();
    else if (!p && this.paused) this.lapStartAt += performance.now() - this.pausedAt;
    this.paused = p;
    this.sound?.setPaused(p);
  }

  resize(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    (this.grainPass.uniforms.uTexel.value as THREE.Vector2).set(1 / buf.x, 1 / buf.y);
    this.updateFxaaResolution();
    const bufH = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.sparkFx?.setPixelScale(bufH);
    this.smokeFx?.setPixelScale(bufH);
    this.flameFx?.setPixelScale(bufH);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private updateFxaaResolution(): void {
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const res = this.fxaaPass.material.uniforms["resolution"].value as THREE.Vector2;
    res.set(1 / buf.x, 1 / buf.y);
  }

  /**
   * Render one face of the reflection probe, advancing round the cube.
   * Mirrors what CubeCamera.update() does per face, minus the five it
   * would do in the same frame.
   */
  /** Test hook: run one frame of the probe exactly as the loop does. */
  renderProbe(): void {
    this.renderProbeFace();
  }

  /** Which cube face the probe will render next, 0..5. */
  get probeFace(): number {
    return this.cubeFrame % 6;
  }

  private renderProbeFace(): void {
    const cams = this.cubeCam.children as THREE.PerspectiveCamera[];
    const face = this.cubeFrame % 6;
    const cam = cams[face];
    if (!cam) return;

    const shadowAuto = this.renderer.shadowMap.autoUpdate;
    const prevTarget = this.renderer.getRenderTarget();
    const prevFace = this.renderer.getActiveCubeFace();
    const prevMip = this.renderer.getActiveMipmapLevel();
    // Mipmaps are generated on the last write to the target, so only the
    // face that completes the sweep may generate them.
    const genMips = this.cubeRT.texture.generateMipmaps;

    this.renderer.shadowMap.autoUpdate = false;
    this.playerMesh.visible = false; // the car must not reflect itself
    // And nor may any of the others, now that all of them sample this
    // cube. A car drawn INTO the target its own material is reading is a
    // framebuffer feedback loop, and the renderer resolves it by dropping
    // the object — which made the probe's per-face cost lurch between 348
    // draw calls and 132 depending on when the convolution landed. That
    // unevenness is exactly what the frame-pacing check exists to catch.
    // No loss: at probe resolution the rest of the fleet is a few dark
    // smears, and the world — road, lamps, towers, sky — is what a
    // reflection is for.
    const hidden: THREE.Object3D[] = [];
    for (const g of this.carGroups) {
      if (g.visible) {
        g.visible = false;
        hidden.push(g);
      }
    }
    try {
      this.cubeCam.position.copy(this.playerMesh.position);
      this.cubeCam.position.y += 1.2;
      this.cubeCam.updateMatrixWorld(true);
      this.cubeRT.texture.generateMipmaps = face === 5 ? genMips : false;
      this.renderer.setRenderTarget(this.cubeRT, face);
      this.renderer.render(this.scene, cam);
    } finally {
      this.cubeRT.texture.generateMipmaps = genMips;
      this.renderer.setRenderTarget(prevTarget, prevFace, prevMip);
      this.playerMesh.visible = true;
      // Restore only what this call hid: a remote player waiting on its
      // first snapshot is invisible on purpose.
      for (const g of hidden) g.visible = true;
      this.renderer.shadowMap.autoUpdate = shadowAuto;
    }

    // A sweep is complete: convolve it once, not once per face.
    if (face === 5) this.cubeRT.texture.needsPMREMUpdate = true;
    this.cubeFrame++;
  }

  private applyRenderScale(): void {
    const r = this.baseRatio * this.renderScale;
    this.renderer.setPixelRatio(r);
    this.composer.setPixelRatio(r);
    this.resize();
  }

  /**
   * Dynamic resolution: walk the internal render scale down 10% at a
   * time while the frame rate is under target, and back up 5% at a time
   * once there is headroom. Runs continuously (Auto tier), unlike the
   * one-shot effects governor below.
   */
  /**
   * Learn the panel's refresh rate from the frames it gives us. Median of
   * the first 40 intervals rather than a mean: a single scheduling hitch
   * during startup would drag a mean far enough to mistake a 120 Hz panel
   * for a 90 Hz one and cap the game below its display for the session.
   */
  private measureRefresh(now: number): void {
    if (this.refreshHz > 0 || this.lastRefreshSample === 0) {
      this.lastRefreshSample = now;
      return;
    }
    const gap = now - this.lastRefreshSample;
    this.lastRefreshSample = now;
    this.refreshFrames++;
    // Accept anything from 4 Hz up. A tighter window looks reasonable
    // until the machine is genuinely slow or the tab is throttled, at
    // which point every sample is rejected and the probe never resolves
    // at all — leaving the governors guessing 60 Hz forever.
    if (gap > 2 && gap < 250) this.refreshSamples.push(gap);
    // Commit on enough samples, or bail out — bounded by BOTH frames and
    // wall clock. A frame budget alone is unbounded in time: at the ~1.4 Hz
    // a throttled tab delivers, 240 frames is nearly three minutes, and the
    // governors would spend all of it aiming at a guessed rate.
    if (this.refreshProbeStart === 0) this.refreshProbeStart = now;
    const elapsed = now - this.refreshProbeStart;
    if (this.refreshSamples.length < 40 && this.refreshFrames < 240 && elapsed < 2000) return;
    if (this.refreshSamples.length < 5) {
      // Nothing usable at all: assume the common case rather than stall.
      this.refreshHz = 60;
      this.refreshSamples = [];
      this.applyFrameCap();
      return;
    }
    const sorted = [...this.refreshSamples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    // Snap to the common panel rates; anything else is reported as-is
    const raw = 1000 / median;
    const known = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
    const near = known.find((h) => Math.abs(h - raw) / h < 0.06);
    this.refreshHz = near ?? Math.round(raw);
    this.refreshSamples = [];
    this.applyFrameCap(); // re-resolve "display"/"vrr" now the rate is known
  }
  private lastRefreshSample = 0;
  private refreshFrames = 0;
  private refreshProbeStart = 0;

  /** What the GPU and device report they can carry. */
  get deviceCaps(): { maxTexture: number; maxCube: number; memoryGB: number; cores: number } {
    return { ...this.caps };
  }

  /**
   * The texture budget for a tier, scaled to the hardware rather than
   * assumed. A machine reporting 8 GB and a 16384 texture limit gets
   * shadow maps twice the size of one reporting 4 GB — and neither is
   * handed an allocation its driver will refuse.
   */
  private budget(want: number, kind: "texture" | "cube" = "texture"): number {
    const limit = kind === "cube" ? this.caps.maxCube : this.caps.maxTexture;
    // Below 4 GB, halve — those devices are usually sharing memory with
    // the system and an oversized map costs more than it shows.
    const lean = this.caps.memoryGB < 4 ? 0.5 : 1;
    // Only ever clamps DOWN. An earlier floor of 512 quietly raised the
    // lower tiers instead — the high tier's 128 probe became 512, costing
    // memory on exactly the machines that asked for less.
    return Math.max(64, Math.min(limit, Math.floor(want * lean)));
  }

  /** Panel refresh in Hz once measured, else 0. */
  get displayHz(): number {
    return this.refreshHz;
  }

  /** The frame rate the governors are aiming at. */
  get targetFps(): number {
    return this.frameMinMs > 0 ? 1000 / this.frameMinMs : this.refreshHz || 60;
  }

  /**
   * Choose the pacing. Browser v-sync is always on and not ours to
   * disable, so the only real lever is how often we accept a frame.
   */
  /**
   * Which GPU the browser actually handed us.
   *
   * powerPreference is a HINT. The browser can ignore it, and on a
   * hybrid laptop the difference between the NVIDIA card and the
   * integrated one is the difference between the game running well and
   * badly — with nothing on screen to say which you got. This reads the
   * driver's own unmasked string so the answer is checkable rather than
   * assumed.
   */
  gpuName(): string {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
      return String(gl.getParameter(gl.RENDERER));
    } catch {
      return "unknown";
    }
  }

  setFrameCap(cap: "display" | "vrr" | number): void {
    this.frameCap = cap;
    this.applyFrameCap();
  }

  private applyFrameCap(): void {
    const hz = this.refreshHz || 60;
    let target: number;
    if (this.frameCap === "display") target = 0; // take every frame offered
    else if (this.frameCap === "vrr") {
      // Standard G-Sync/FreeSync practice: sit a few frames under the
      // ceiling. Crossing it hands you back to v-sync and its queued
      // frame of latency, which is the thing VRR exists to avoid.
      target = Math.max(30, hz - 3);
    } else target = this.frameCap;
    this.frameMinMs = target > 0 ? 1000 / target : 0;
    this.lastFrameAt = 0;
  }

  private updateDrs(now: number): void {
    if (!this.drsEnabled || this.paused) return;
    if (now - this.startedAt < 4000 || now - this.drsAt < 1500) return;
    // Thresholds relative to what we are actually aiming at. Fixed 50/58
    // numbers silently assumed a 60 Hz panel: on a 144 Hz display,
    // holding 58 fps is a failure, yet it read as headroom and the
    // governor would keep pushing resolution up.
    const target = this.targetFps;
    const floor = target * 0.83;
    const ceiling = target * 0.97;
    if (this.fpsEma < floor && this.renderScale > 0.6) {
      this.drsAt = now;
      this.renderScale = Math.max(0.6, this.renderScale - 0.1);
      this.applyRenderScale();
    } else if (this.fpsEma > ceiling && this.renderScale < 1) {
      this.drsAt = now;
      this.renderScale = Math.min(1, this.renderScale + 0.05);
      this.applyRenderScale();
    }
  }

  /** Drop the expensive effects once it's clear the machine can't keep up. */
  private autoQuality(): void {
    if (this.qualityLocked || performance.now() - this.startedAt < 6000) return;
    this.qualityLocked = true;
    // Also relative: 32 fps is a crisis on a 60 Hz panel but merely
    // half-rate on a 144 Hz one, where the machine is plainly coping.
    if (this.fpsEma < this.targetFps * 0.53) {
      this.bloomPass.enabled = false;
      this.world.moonLight.castShadow = false;
      this.headlight.castShadow = false;
      this.fxaaPass.enabled = false;
      this.liveReflections = false;
      this.applyLiveReflections();
      this.events.onMessage("Performance mode", "Glow & shadows off — press G to toggle them back");
    }
  }

  /** Repaint the world for midnight or dawn (settings screen). */
  /**
   * The three grading controls, in the order a colourist reaches for
   * them. Exposure acts before tone mapping because that is where
   * exposure physically acts; contrast and highlights act on the
   * picture afterwards.
   */
  setExposure(stops: number, auto = true): void {
    const u = this.autoExp.exposureMat.uniforms;
    u.uBias.value = THREE.MathUtils.clamp(stops, -2, 2);
    u.uAuto.value = auto ? 1 : 0;
    // Manual sits at 1.15, the hand-set exposure this game shipped with,
    // so zero on the slider is exactly the look it always had.
    u.uManual.value = 1.15;
  }

  /** Current exposure and metered luminance. Reads back from the GPU, so
   *  it is for debug readouts and tests — never per frame. */
  sampleExposure(): Promise<{ exposure: number; luminance: number }> {
    return this.autoExp.sample(this.renderer);
  }

  setContrast(v: number): void {
    this.grainPass.uniforms.uContrast.value = THREE.MathUtils.clamp(v, 0.7, 1.5);
  }

  /** Global saturation, 0.6 (washed) to 1.4 (poster). */
  setSaturation(v: number): void {
    this.grainPass.uniforms.uSaturation.value = THREE.MathUtils.clamp(v, 0.6, 1.4);
  }

  /** -1 recovers the highlights, +1 pushes them toward clipping. */
  setHighlights(v: number): void {
    const h = THREE.MathUtils.clamp(v, -1, 1);
    this.grainPass.uniforms.uHighlights.value = h;
    // Recovering highlights also brings the shoulder down to meet them,
    // so the roll starts earlier instead of only shrinking what is above it.
    this.grainPass.uniforms.uKnee.value = 0.86 - Math.max(0, -h) * 0.16;
  }

  /** Hours 0..24. Fixed looks are hours too; "cycle" lets it run. */
  private timeHours = 22.5;
  private timeCycling = false;
  private skyAccum = 0;
  /** Minutes of play for a full 24-hour turn. Long enough that a race
   *  happens in one light, short enough to see the sun move. */
  private static readonly CYCLE_MINUTES = 16;

  setSky(mode: "night" | "dawn" | "noon" | "dusk" | "cycle"): void {
    const HOURS: Record<string, number> = {
      night: 22.5,
      dawn: 5.6,
      noon: 12.5,
      dusk: 18.2,
    };
    this.timeCycling = mode === "cycle";
    // A cycle starts where the eye expects this game to start: dusk,
    // with the lights just coming on.
    this.timeHours = this.timeCycling ? 18.2 : HOURS[mode] ?? 22.5;
    this.world.setTimeOfDay(this.timeHours);
    this.applyDaylight();
  }

  /**
   * How much daylight there is, 0..1 — the sun's altitude, clamped.
   * Everything that only makes sense in the dark reads this.
   */
  private get daylight(): number {
    const alt = Math.sin(((this.timeHours - 6) / 24) * Math.PI * 2);
    return THREE.MathUtils.clamp(alt * 3.2, 0, 1);
  }

  /**
   * Headlights, beams and lamp glare exist because it is dark. In broad
   * daylight a spot light throws no visible pool and a volumetric beam
   * is just a grey cone hanging off the bumper, so both fade out — the
   * lamps themselves stay lit, which is what Gulf drivers do anyway.
   */
  private applyDaylight(): void {
    const dark = 1 - this.daylight;
    this.headlight.intensity = this.headlightBase * (0.25 + 0.75 * dark);
    this.beamBaseOpacity = this.beamBaseOpacityNight * dark;
    const glows = (this.carBody?.userData.headGlowMats as THREE.SpriteMaterial[]) ?? [];
    for (const g of glows) g.opacity = 0.9 * dark;
  }

  /**
   * Player-chosen quality tier from the settings screen. "auto" hands
   * control back to the frame-rate governor; the explicit tiers lock it.
   */
  applyQualityTier(tier: "auto" | "ultra" | "high" | "balanced" | "battery"): void {
    if (tier === "auto") {
      this.qualityLocked = false;
      this.drsEnabled = true;
      this.renderScale = 1;
      this.baseRatio = Math.min(window.devicePixelRatio, 2);
      this.applyRenderScale();
      this.startedAt = performance.now(); // give the governors a fresh window
      return;
    }
    this.qualityLocked = true;
    this.drsEnabled = false; // explicit tiers pin their resolution
    const ultra = tier === "ultra";
    const high = tier === "high" || ultra;
    const balanced = tier === "balanced";
    this.bloomPass.enabled = high || balanced;
    this.world.moonLight.castShadow = high || balanced;
    this.headlight.castShadow = high || balanced;
    this.fxaaPass.enabled = high || balanced;
    // The live paint probe is the most expensive single toy — high only
    this.liveReflections = high;
    this.applyLiveReflections();
    // Ultra is for desktop GPUs driving a 4K panel. A 4K monitor usually
    // reports devicePixelRatio 1, so "native" already means 3840x2160 and
    // the only way further up is supersampling: render above the panel and
    // let the downsample do the anti-aliasing, which resolves the lamp
    // filaments and lane edges that even TSR-class upscalers soften.
    this.baseRatio = ultra
      ? Math.min(window.devicePixelRatio * 1.5, 2)
      : tier === "high"
        ? Math.min(window.devicePixelRatio, 2)
        : balanced
          ? Math.min(window.devicePixelRatio, 1.5)
          : 1;
    // Sharper shadow cascades to match the extra pixels
    const shadowSize = this.budget(ultra ? 4096 : 1024);
    if (this.headlight.shadow.mapSize.x !== shadowSize) {
      this.headlight.shadow.mapSize.setScalar(shadowSize);
      this.headlight.shadow.map?.dispose();
      this.headlight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    const moonSize = this.budget(ultra ? 16384 : 4096);
    if (this.world.moonLight.shadow.mapSize.x !== moonSize) {
      this.world.moonLight.shadow.mapSize.setScalar(moonSize);
      this.world.moonLight.shadow.map?.dispose();
      this.world.moonLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    if (this.liveReflections) this.setProbeResolution(this.budget(ultra ? 512 : 128, "cube"));
    this.renderScale = 1;
    this.applyRenderScale();
  }

  /** After a defeat: refill SP and rematch the same rival. */
  retryBattle(): void {
    this.player.sp = 100;
    this.locked = false;
    this.inBattle = false;
    this.spawnRival();
    const r = this.rival!;
    this.events.onMessage(`Rematch — ${r.def.name}`, "Catch up and press F to flash");
  }

  /** Wipe progress and start over from the first rival. */
  resetProgress(): void {
    this.rivalIndex = 0;
    this.saveProgress();
    this.player.sp = 100;
    this.locked = false;
    this.inBattle = false;
    this.spawnRival();
  }

  // ------------------------------------------------------------- online

  /** Add (or re-style) another player's car in the shared cruise. */
  upsertRemote(id: number, name: string, color: string): void {
    this.removeRemote(id);
    const hex = new THREE.Color(color).getHex();
    const mesh = this.trackCar(createCar({ body: hex, underglow: hex }));
    mesh.add(makeNameTag(name));
    mesh.visible = false; // until the first state snapshot lands
    this.scene.add(mesh);
    this.remotes.set(id, {
      name,
      mesh,
      s: 0,
      lat: 0,
      snapS: 0,
      snapLat: 0,
      snapSpeed: 0,
      snapAt: 0,
      steerVis: 0,
    });
  }

  updateRemoteState(id: number, s: number, lat: number, speed: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    if (!r.mesh.visible) {
      r.mesh.visible = true;
      r.s = s;
      r.lat = lat;
    }
    r.snapS = s;
    r.snapLat = lat;
    r.snapSpeed = speed;
    r.snapAt = performance.now();
  }

  removeRemote(id: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.untrackCar(r.mesh);
    this.scene.remove(r.mesh);
    this.remotes.delete(id);
  }

  /** Feed the referee's SP numbers into the HUD. */
  setDuel(d: { you: number; them: number; gap: number; opponent: string } | null): void {
    this.duel = d;
  }

  getLocalState(): { s: number; lat: number; speed: number } {
    return { s: this.player.s, lat: this.player.lat, speed: this.player.speed };
  }

  getMapPath(): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    const p = new THREE.Vector3();
    for (let i = 0; i <= 120; i++) {
      this.track.curve.getPointAt(i / 120, p);
      pts.push(this.toMap(p.x, p.z));
    }
    return pts;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const t of this.challengeTimers) clearTimeout(t);
    this.challengeTimers = [];
    if (this.padTimer) clearInterval(this.padTimer);
    this.cubeRT?.dispose();
    this.sparkFx?.dispose();
    this.smokeFx?.dispose();
    this.flameFx?.dispose();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.music?.dispose();
    this.sound?.dispose();
    this.voice.dispose();
    this.exposurePass?.dispose();
    this.autoExp?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- input

  private onKeyDown = (e: KeyboardEvent) => {
    // Any trusted gesture may be our only chance to un-suspend audio
    this.sound?.resume();
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (this.cine && (k === "enter" || k === " ") && !e.repeat) {
      this.skipCinematic();
      return; // deliberately not added to this.keys — Space is the handbrake
    }
    this.keys.add(k);
    if (k === "f") this.tryFlash();
    if (k === "m" && !e.repeat && this.sound) {
      const muted = this.sound.toggleMute();
      this.events.onMessage(muted ? "Sound off" : "Sound on");
    }
    if (k === "h" && !e.repeat) this.sound?.hornOn();
    if (k === "b" && !e.repeat && this.music) {
      const on = this.music.toggle();
      this.events.onMessage(on ? "Music on" : "Music off");
    }
    if (k === "v" && !e.repeat) {
      const on = this.voice.toggle();
      this.events.onMessage(on ? "Voices on — الأصوات شغالة" : "Voices off");
      if (on) this.voice.speak("الأصوات شغالة", {}, "voices-on");
    }
    if (k === "g" && !e.repeat) {
      this.qualityLocked = true;
      this.bloomPass.enabled = !this.bloomPass.enabled;
      this.world.moonLight.castShadow = this.bloomPass.enabled;
      this.headlight.castShadow = this.bloomPass.enabled;
      this.fxaaPass.enabled = this.bloomPass.enabled;
      this.liveReflections = this.bloomPass.enabled;
      this.applyLiveReflections();
      this.events.onMessage(
        this.bloomPass.enabled ? "Glow & shadows on" : "Glow & shadows off"
      );
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    if (k === "h") this.sound?.hornOff();
  };

  /** Focus loss eats keyup events — release everything or the throttle
   *  sticks and the horn drones forever. */
  private onBlur = () => {
    this.keys.clear();
    this.touch = { throttle: 0, brake: 0, steer: 0, drift: false };
    this.sound?.hornOff();
  };

  private get throttle(): number {
    if (this.locked || this.cine) return 0;
    const key = this.keys.has("arrowup") || this.keys.has("w") ? 1 : 0;
    return Math.max(key, this.touch.throttle, this.pad.throttle);
  }
  private get brake(): number {
    if (this.locked || this.cine) return 0;
    const key = this.keys.has("arrowdown") || this.keys.has("s") ? 1 : 0;
    return Math.max(key, this.touch.brake, this.pad.brake);
  }
  private get steer(): number {
    if (this.locked || this.cine) return 0;
    let s = 0;
    if (this.keys.has("arrowleft") || this.keys.has("a")) s -= 1;
    if (this.keys.has("arrowright") || this.keys.has("d")) s += 1;
    return THREE.MathUtils.clamp(s + this.touch.steer + this.pad.steer, -1, 1);
  }

  private get handbrake(): boolean {
    if (this.locked || this.cine) return false;
    const held = this.keys.has(" ") || this.touch.drift || this.pad.drift;
    // A hold carried through the film (key auto-repeat re-adds it) must
    // not drag the handbrake at the green flag — demand a fresh press.
    if (!held) this.handbrakeStale = false;
    return held && !this.handbrakeStale;
  }

  /**
   * Standard pad layout: left stick steers (deadzone + a gentle curve so
   * small corrections stay small), triggers drive, A = NOS, B = drift,
   * X = flash, LB = horn, Start = pause. Merged with keyboard/touch, so
   * plugging a pad in never disables anything else.
   */
  private pollGamepad(): void {
    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() : null;
    const gp = pads ? Array.from(pads).find((p) => p && p.connected) : null;
    if (!gp) {
      if (this.padSeen) this.pad = { steer: 0, throttle: 0, brake: 0, drift: false, nos: false };
      this.padSeen = false;
      return;
    }
    this.padSeen = true;
    const edge = (i: number) => {
      const now = gp.buttons[i]?.pressed ?? false;
      const was = this.padButtons[i] ?? false;
      this.padButtons[i] = now;
      return now && !was;
    };

    if (!this.paused) {
      const x = gp.axes[0] ?? 0;
      const dz = 0.15;
      this.pad.steer =
        Math.abs(x) < dz ? 0 : Math.sign(x) * Math.pow((Math.abs(x) - dz) / (1 - dz), 1.3);
      this.pad.throttle = gp.buttons[7]?.value ?? 0; // RT
      this.pad.brake = gp.buttons[6]?.value ?? 0; // LT
      this.pad.nos = gp.buttons[0]?.pressed ?? false; // A / Cross
      this.pad.drift = gp.buttons[1]?.pressed ?? false; // B / Circle
      if (edge(2)) this.tryFlash(); // X / Square
      const hornNow = gp.buttons[4]?.pressed ?? false; // LB
      if (hornNow && !this.padButtons[4]) this.sound?.hornOn();
      if (!hornNow && this.padButtons[4]) this.sound?.hornOff();
      this.padButtons[4] = hornNow;
    } else {
      this.pad = { steer: 0, throttle: 0, brake: 0, drift: false, nos: false };
      this.padButtons[2] = gp.buttons[2]?.pressed ?? false;
      this.padButtons[4] = gp.buttons[4]?.pressed ?? false;
    }
    if (edge(9)) {
      // Start: during the film it skips; otherwise the UI takes over
      if (this.cine) this.skipCinematic();
      else this.events.onPauseRequest?.();
    }
  }

  // ---------------------------------------------------------- touch API

  /** Drive from on-screen controls (phones, tablets, Steam Deck touch). */
  setTouchInput(v: Partial<{ throttle: number; brake: number; steer: number }>): void {
    if (v.throttle !== undefined) this.touch.throttle = THREE.MathUtils.clamp(v.throttle, 0, 1);
    if (v.brake !== undefined) this.touch.brake = THREE.MathUtils.clamp(v.brake, 0, 1);
    if (v.steer !== undefined) this.touch.steer = THREE.MathUtils.clamp(v.steer, -1, 1);
    this.sound?.resume();
  }

  /** Touch equivalents of the keyboard actions. */
  touchFlash(): void {
    this.sound?.resume();
    this.tryFlash();
  }
  touchDrift(on: boolean): void {
    this.touch.drift = on;
    this.sound?.resume();
  }
  touchNos(on: boolean): void {
    if (on) this.keys.add("n");
    else this.keys.delete("n");
  }
  touchHorn(on: boolean): void {
    if (on) this.sound?.hornOn();
    else this.sound?.hornOff();
  }

  // ---------------------------------------------------------------- spawning

  private spawnTraffic(count: number): void {
    for (let i = 0; i < count; i++) {
      const mesh = this.trackCar(
        createCar({ body: TRAFFIC_COLORS[i % TRAFFIC_COLORS.length], simple: true })
      );
      this.scene.add(mesh);
      this.traffic.push({
        mesh,
        s: this.track.wrap(120 + (i / count) * this.track.length),
        lat: LANES[i % LANES.length],
        speed: 21 + Math.random() * 9, // 75–108 km/h
        steerVis: 0,
      });
    }
  }

  private spawnRival(): void {
    if (this.rival) {
      this.untrackCar(this.rival.mesh);
      this.scene.remove(this.rival.mesh);
      this.rival = null;
    }
    if (this.rivalIndex >= RIVALS.length) return;
    const def = RIVALS[this.rivalIndex];
    const mesh = this.trackCar(
      createCar({
        body: def.bodyColor,
        accent: def.accentColor,
        style: def.bodyStyle,
        spoiler: def.bodyStyle === "gtr",
        underglow: def.accentColor,
      })
    );
    this.scene.add(mesh);
    this.rival = {
      def,
      mesh,
      s: this.track.wrap(this.player.s + 260),
      lat: LANES[2],
      targetLat: LANES[2],
      speed: 27,
      sp: 100,
      state: "cruise",
      steerVis: 0,
      throttleVis: 0,
      brakeVis: 0,
    };
  }

  // ---------------------------------------------------------------- battle

  /** Headlight flash. Three inside 3 s while alongside a rival issues a
   *  challenge — the TXR ritual: reveal, size each other up, answer. */
  private tryFlash(): void {
    const r = this.rival;
    if (!r || this.inBattle || this.locked || this.challengePending || this.cine) return;
    // A live duel is refereed on the wall clock by the hub — pausing into
    // the setup card + film mid-duel would forfeit it.
    if (this.duel) return;
    if (r.state !== "cruise") return;
    const gap = this.track.deltaAhead(this.player.s, r.s);
    if (gap < 2 || gap > FLASH_RANGE) return;

    const now = performance.now();
    if (now > this.flashWindowUntil) this.flashCount = 0;
    this.flashWindowUntil = now + 3000;
    this.flashCount++;
    this.flashHeadlights();
    this.sound?.flashClick();

    if (this.flashCount >= 3) {
      this.flashCount = 0;
      this.issueChallenge();
    }
  }

  private playerCard(): DriverCard {
    let name = "You";
    let country = "Kuwait";
    let flag = "🇰🇼";
    try {
      const raw = localStorage.getItem("gulf-road-nights-profile");
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.name === "string" && p.name.trim()) name = p.name.trim();
        if (typeof p.country === "string" && p.country.trim()) country = p.country.trim();
        if (typeof p.flag === "string" && p.flag.trim()) flag = p.flag.trim();
      }
    } catch {}
    return {
      name,
      arabicName: "أنت",
      crew: "Privateer",
      level: levelInfo(loadProfileStats().xp).level,
      country,
      flag,
      color: this.tune.paint,
      car: this.tune.carName,
    };
  }

  private rivalCard(def: RivalDef): DriverCard {
    return {
      name: def.name,
      arabicName: def.arabicName,
      crew: def.crew,
      level: RIVALS.indexOf(def) + 1,
      country: def.country ?? "Kuwait",
      flag: def.flag ?? "🇰🇼",
      color: def.bodyColor,
      car: def.car ?? "Street Tuned",
    };
  }

  /** Both cars reveal, then the race-setup screen opens: the player
   *  picks the car and the stake before the rival is asked. */
  private issueChallenge(): void {
    const r = this.rival;
    if (!r) return;
    this.challengePending = true;
    this.flashRival(r);
    this.sound?.battleSting();

    // Pace is judged at the moment of the flash, before the game pauses
    this.challengePace = Math.max(r.speed * 0.85, 8);
    this.challengeAccepted = this.player.speed >= this.challengePace;

    // Bigger names play for bigger money
    const garage = loadGarage();
    const rivalCeiling = 1000 * Math.pow(2, this.rivalIndex);
    const maxWager = Math.max(0, Math.min(garage.kd, rivalCeiling));

    this.setPaused(true);
    this.events.onChallenge?.(this.playerCard(), this.rivalCard(r.def), maxWager);
  }

  /** UI callback: the player confirmed a car and a stake. */
  confirmChallenge(wager: number, carId?: string): void {
    const r = this.rival;
    if (!r || !this.challengePending) return;

    if (carId) {
      const g = loadGarage();
      if (g.cars.includes(carId) && g.car !== carId) {
        g.car = carId;
        saveGarage(g);
        this.applyGarage();
      }
    }
    this.wager = Math.max(0, Math.round(wager));
    this.setPaused(false);

    this.challengeTimers.push(
      setTimeout(() => {
        if (this.disposed || !this.rival) return;
        const rv = this.rival;
        this.challengePending = false;
        if (this.challengeAccepted) {
          this.events.onChallengeResult?.(
            true,
            this.wager > 0 ? `Stakes: ${this.wager} KD each` : "Pride only"
          );
          this.beginBattleCinematic(rv);
        } else {
          this.wager = 0;
          this.events.onChallengeResult?.(
            false,
            `Keep pace with them — ${Math.round(this.challengePace * KMH)} km/h or better`
          );
          this.voice.speak(
            rv.def.rejectLine ?? "مو الحين",
            rv.def.voice,
            `${rv.def.id}-reject`
          );
        }
      }, 2200)
    );
  }

  /** UI callback: the player backed out of the race setup. */
  cancelChallenge(): void {
    this.challengePending = false;
    this.wager = 0;
    this.setPaused(false);
  }

  /**
   * Re-read the garage and rebuild the car. Public so the UI can open the
   * garage mid-session and have the change take effect immediately.
   */
  refreshGarage(): void {
    this.applyGarage();
  }

  /** Point the player's paint at the live probe (or back at the baked
   *  environment when the probe is off for performance). */
  /**
   * Rebuild the paint's reflection probe at a new face resolution.
   * 128 is plenty at 1080p, but on a 4K panel the probe is the limiting
   * factor in how the clearcoat reads — the lamp streaks that slide along
   * the bodywork are literally probe texels, and at 128 they are visibly
   * chunky once the frame carries four times the pixels.
   */
  private setProbeResolution(size: number): void {
    if (this.cubeRT.width === size) return;
    const previous = this.cubeRT;
    const floatOk =
      this.renderer.extensions.has("EXT_color_buffer_float") ||
      this.renderer.extensions.has("EXT_color_buffer_half_float");
    this.cubeRT = new THREE.WebGLCubeRenderTarget(size, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    this.scene.remove(this.cubeCam);
    this.cubeCam = new THREE.CubeCamera(0.5, 420, this.cubeRT);
    this.scene.add(this.cubeCam);
    // Re-point the paint at the new target before dropping the old one,
    // or the material spends a frame sampling a disposed texture.
    this.applyLiveReflections();
    previous.dispose();
  }

  /** Racing number for the sticker pack — stable per machine, so the
   *  Kaiju is always the same car on the door no matter the paint. */
  private stickerNumber(): number {
    let h = 0;
    for (const ch of this.tune.carId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return (h % 90) + 10;
  }

  /**
   * Dress one car's paint and metal with the current reflection policy.
   *
   * Every car on the road gets the SAME source and the same gains, which
   * is the only way they can be guaranteed to match. Only the player's
   * car used to be dressed at all; rivals, traffic and other players ran
   * on the materials' own defaults against the baked environment, and
   * the two setups do not land in the same place. Measured on one car
   * under one camera, swapping only these settings: the player's tuned
   * pair clipped 14 pixels of the frame, the untuned one every other car
   * was wearing clipped 72 and sat 11% brighter overall. The hero car
   * was the only one on the street that was not blown out.
   *
   * Sharing the player's probe with traffic reflects the player's
   * surroundings on a car fifty metres away, which is wrong in principle
   * and invisible in practice: it is the same road, the same lamps and
   * the same sky, at a resolution where the paint shows a smear of
   * sodium rather than a picture of anything.
   */
  private dressReflections(group: THREE.Object3D): void {
    // The player's car is built before the probe exists, so this runs
    // once with nothing to point at; applyLiveReflections dresses every
    // car again as soon as the target is up.
    const env = this.liveReflections && this.cubeRT ? this.cubeRT.texture : null;
    const body = group.userData.bodyMat as THREE.MeshPhysicalMaterial | undefined;
    if (body) {
      body.envMap = env;
      // The live probe carries real HDR lamps — rein the gain back in.
      body.envMapIntensity = this.liveReflections ? 1.35 : 2.1;
      body.needsUpdate = true;
    }
    // The rims, chrome and brake discs mirror the same world the paint
    // does. Higher gain than the paint: the probe is mostly night sky,
    // and a near-pure metal goes black under it — the lamps it does
    // carry need amplifying for the alloy to read as alloy.
    const metals = group.userData.reflectMats as
      | THREE.MeshStandardMaterial[]
      | undefined;
    for (const m of metals ?? []) {
      const base = (m.userData.baseEnvIntensity as number) ?? 1.5;
      m.envMap = env;
      m.envMapIntensity = this.liveReflections ? base * 1.9 : base;
      m.needsUpdate = true;
    }
  }

  /** Start dressing this car, and dress it now. */
  private trackCar<T extends THREE.Object3D>(group: T): T {
    this.carGroups.add(group);
    this.dressReflections(group);
    return group;
  }

  /** Stop dressing a car that is being disposed — its materials are
   *  about to go, and a policy change must not reach into them. */
  private untrackCar(group: THREE.Object3D | null | undefined): void {
    if (group) this.carGroups.delete(group);
  }

  private applyLiveReflections(): void {
    for (const g of this.carGroups) this.dressReflections(g);
  }

  /** Rebuild the player car after a garage change (new model, paint, mods). */
  private applyGarage(): void {
    this.tune = computeEffects(loadGarage());
    const contact = this.carBody.userData.contact as THREE.Object3D | undefined;
    if (contact) this.playerMesh.remove(contact);
    this.playerMesh.remove(this.carBody);
    // The old car is gone for good — release its per-car materials, or a
    // player cycling paints leaks a shader program per visit. Geometries
    // and module-shared materials stay (other cars still use them).
    // Out of the reflection registry before its materials are released.
    this.untrackCar(this.carBody);
    for (const key of ["bodyMat", "tailMat", "headMat"] as const) {
      (this.carBody.userData[key] as THREE.Material | undefined)?.dispose();
    }
    this.carBody = this.trackCar(
      createCar({
        body: this.tune.paint,
        accent: 0x007a3d,
        style: this.tune.bodyStyle,
        underglow: this.tune.glow ?? undefined,
        spoiler: this.tune.spoiler,
        goldRims: this.tune.goldRims,
        raceKit: this.tune.raceKit,
        stickers: this.tune.stickers,
        stickerNumber: this.stickerNumber(),
      })
    );
    this.playerMesh.add(this.carBody);
    const newContact = this.carBody.userData.contact as THREE.Object3D | undefined;
    if (newContact) this.playerMesh.add(newContact);
    this.sound?.configureAspiration(
      this.tune.aspiration === "super" ? "super" : this.tune.boostMult > 0 ? "turbo" : "none"
    );
  }

  /**
   * The short pre-battle film: slow-motion orbit of the rival's machine,
   * a side pass of yours, then the camera falls back into the chase and
   * the fight is on. Skippable; reduced motion goes straight to battle.
   */
  private beginBattleCinematic(r: Rival): void {
    const reduced =
      typeof document !== "undefined" &&
      (document.documentElement.dataset.reducedMotion === "1" ||
        (typeof matchMedia !== "undefined" &&
          matchMedia("(prefers-reduced-motion: reduce)").matches));
    if (reduced || !this.events.onCinematic) {
      this.startBattle(r);
      return;
    }
    this.cine = { start: performance.now(), r };
    // The intro line plays over the film instead of after it
    this.voice.speak(r.def.lines.intro, r.def.voice, `${r.def.id}-intro`);
    this.events.onCinematic(true, this.rivalCard(r.def), this.wager, this.playerCard());
  }

  /** UI callback: the player tapped through the intro film. */
  skipCinematic(): void {
    if (this.cine) this.endCinematic();
  }

  private endCinematic(): void {
    const r = this.cine?.r ?? null;
    this.cine = null;
    // A key or pad held through the film must not fire at the green flag
    this.handbrakeStale = true;
    // Snap the chase camera home instead of lerping across the map
    this.camInit = false;
    if (r) {
      this.events.onCinematic?.(false, this.rivalCard(r.def), this.wager, this.playerCard());
      this.startBattle(r, true);
    }
  }

  private startBattle(r: Rival, fromCine = false): void {
    this.inBattle = true;
    r.state = "battle";
    this.player.sp = 100;
    r.sp = 100;
    this.bstat = { startAt: performance.now(), dist: 0, topSpeed: 0, contacts: 0, maxLead: 0, driftScore: 0 };
    this.spWarned = false;
    // Style points earned cruising before the flag don't count in the race
    breakChain(this.ds);
    this.driftFlash = 0;
    if (fromCine) {
      // The film already introduced them — just drop the green flag.
      this.events.onMessage("GO — يلا!", `"${r.def.taunt}"`);
      // The crew, over the radio, as the flag drops
      this.voice.radioSpeak("يلا، خله وراك — روح!", { pitch: 1.05, rate: 1.2 });
    } else {
      this.voice.speak(r.def.lines.intro, r.def.voice, `${r.def.id}-intro`);
      if (this.events.onBattleStart) this.events.onBattleStart(r.def);
      else this.events.onMessage(`BATTLE — ${r.def.name} ${r.def.arabicName}`, `"${r.def.taunt}"`);
    }
  }

  /** The rival flashes back — the reveal. */
  private flashRival(r: Rival): void {
    const mat = r.mesh.userData.headMat as THREE.MeshStandardMaterial | undefined;
    if (!mat) return;
    const glows = (r.mesh.userData.headGlowMats as THREE.SpriteMaterial[]) ?? [];
    const base = mat.emissiveIntensity;
    const baseGlow = glows.map((m) => m.opacity);
    let n = 0;
    const id = setInterval(() => {
      const on = mat.emissiveIntensity <= base;
      mat.emissiveIntensity = on ? base * 4 : base;
      glows.forEach((m, i) => (m.opacity = on ? Math.min(1, baseGlow[i] * 2.1) : baseGlow[i]));
      if (++n >= 6 || this.disposed) {
        clearInterval(id);
        mat.emissiveIntensity = base;
        glows.forEach((m, i) => (m.opacity = baseGlow[i]));
      }
    }, 110);
  }

  private flashHeadlights(): void {
    // The flash has to be visible from outside the car, not just in the
    // pool it throws: blink the lamp faces, their glare sprites and the
    // beam cones together with the spot light.
    const base = this.headlight.intensity;
    const headMat = this.carBody.userData.headMat as THREE.MeshStandardMaterial | undefined;
    const glows = (this.carBody.userData.headGlowMats as THREE.SpriteMaterial[]) ?? [];
    const baseEmissive = headMat?.emissiveIntensity ?? 0;
    const baseGlow = glows.map((m) => m.opacity);
    const baseBeam = this.beamMat?.opacity ?? 0;
    let n = 0;
    const id = setInterval(() => {
      const on = this.headlight.intensity <= 1;
      this.headlight.intensity = on ? base : 0;
      if (headMat) headMat.emissiveIntensity = on ? baseEmissive * 2.2 : baseEmissive * 0.15;
      glows.forEach((m, i) => (m.opacity = on ? Math.min(1, baseGlow[i] * 1.9) : baseGlow[i] * 0.1));
      if (this.beamMat) this.beamMat.opacity = on ? baseBeam : baseBeam * 0.12;
      if (++n >= 6 || this.disposed) {
        clearInterval(id);
        this.headlight.intensity = base;
        if (headMat) headMat.emissiveIntensity = baseEmissive;
        glows.forEach((m, i) => (m.opacity = baseGlow[i]));
        if (this.beamMat) this.beamMat.opacity = baseBeam;
      }
    }, 90);
  }

  /** Snapshot the battle telemetry and settle XP, stats and rewards. */
  private buildResult(
    r: Rival,
    outcome: "win" | "loss",
    money: { purse: number; kd: number; balance: number },
    champion: boolean
  ): RaceResult {
    // A slide still in progress at the flag counts too
    this.bstat.driftScore += this.driftRun;
    this.driftRun = 0;
    const clean = this.bstat.contacts === 0;
    const durationMs = Math.max(0, performance.now() - this.bstat.startAt);
    const topSpeedKmh = Math.round(this.bstat.topSpeed);
    const tier = RIVALS.indexOf(r.def);

    // XP is itemised so the player can see exactly where it came from —
    // the breakdown is what teaches the scoring, not a tooltip.
    const xpBreakdown: Array<{ label: string; value: number }> = [];
    if (outcome === "win") {
      xpBreakdown.push({ label: "Race won", value: 150 });
      xpBreakdown.push({ label: `Rival tier ${tier + 1}`, value: 40 * (tier + 1) });
      if (clean) xpBreakdown.push({ label: "Clean run — no contact", value: 75 });
      if (this.bstat.maxLead >= 60) xpBreakdown.push({ label: "Dominant lead", value: 60 });
      if (topSpeedKmh >= 280) xpBreakdown.push({ label: `Top speed ${topSpeedKmh} km/h`, value: 40 });
      if (this.bstat.driftScore >= 250)
        xpBreakdown.push({
          label: `Drift style ${Math.round(this.bstat.driftScore)}`,
          value: Math.min(120, Math.round(this.bstat.driftScore / 25)),
        });
      if (money.purse > 0) xpBreakdown.push({ label: "Stakes race", value: 50 });
      if (champion) xpBreakdown.push({ label: "King of Gulf Road", value: 500 });
    } else {
      xpBreakdown.push({ label: "Race completed", value: 30 });
      if (this.bstat.maxLead > 0) xpBreakdown.push({ label: "Led the battle", value: 20 });
      if (durationMs > 45000) xpBreakdown.push({ label: "Went the distance", value: 25 });
    }
    const xpGain = xpBreakdown.reduce((a, b) => a + b.value, 0);
    const { before, after } = recordRace(xpGain, outcome, { topSpeed: topSpeedKmh, clean });

    // Rewards: only things that actually changed state get a card.
    const rewards: RewardLine[] = [];
    const lvlBefore = levelInfo(before.xp);
    const lvlAfter = levelInfo(after.xp);
    if (lvlAfter.level > lvlBefore.level) {
      rewards.push({
        icon: "star",
        title: `Level ${lvlAfter.level}`,
        sub: "Driver level up — مستوى جديد",
      });
    }
    if (outcome === "win" && !champion) {
      const next = RIVALS[this.rivalIndex];
      if (next) {
        rewards.push({
          icon: "flag",
          title: `${next.name} unlocked`,
          sub: next.crew,
        });
      }
    }
    if (champion) {
      rewards.push({ icon: "crown", title: "King of Gulf Road", sub: "ملك شارع الخليج" });
    }
    // Anything newly affordable is worth telling them about — it is the
    // difference between "I won money" and "I can buy the GT-R now".
    const owned = new Set(loadGarage().cars);
    const unlockable = CARS.filter(
      (c) => !owned.has(c.id) && c.price <= money.balance && c.price > money.balance - money.kd
    ).sort((a, b) => b.price - a.price)[0];
    if (unlockable) {
      rewards.push({
        icon: "key",
        title: `${unlockable.name} affordable`,
        sub: `${unlockable.price.toLocaleString()} KD in the showroom`,
      });
    }
    if (after.streak >= 3 && outcome === "win") {
      rewards.push({ icon: "streak", title: `${after.streak}-race streak`, sub: "On a run — ما يوقف" });
    }

    return {
      outcome,
      position: outcome === "win" ? 1 : 2,
      rival: this.rivalCard(r.def),
      purse: money.purse,
      kd: money.kd,
      balance: money.balance,
      xpGain,
      levelBefore: lvlBefore,
      levelAfter: lvlAfter,
      xpBreakdown,
      stats: {
        topSpeedKmh,
        durationMs,
        contacts: this.bstat.contacts,
        clean,
        maxLeadSp: Math.round(Math.max(0, this.bstat.maxLead)),
        distanceM: Math.round(this.bstat.dist),
      },
      career: {
        races: after.races,
        wins: after.wins,
        streak: after.streak,
        bestStreak: after.bestStreak,
      },
      rewards,
      champion,
      nextRival: champion
        ? null
        : RIVALS[this.rivalIndex]
          ? {
              name: RIVALS[this.rivalIndex].name,
              arabicName: RIVALS[this.rivalIndex].arabicName,
              crew: RIVALS[this.rivalIndex].crew,
            }
          : null,
    };
  }

  private winBattle(): void {
    const r = this.rival!;
    r.state = "defeated";
    this.inBattle = false;
    // Prize money scales with the roster depth, plus the staked purse
    const payout = 400 + this.rivalIndex * 300 + this.wager;
    const balance = addKd(payout);
    const staked = this.wager;
    this.wager = 0;
    this.rivalIndex++;
    this.saveProgress();
    this.voice.speak(r.def.lines.lose, r.def.voice, `${r.def.id}-lose`);
    const champion = this.rivalIndex >= RIVALS.length;
    const result = this.buildResult(r, "win", { purse: staked, kd: payout, balance }, champion);

    if (champion) {
      this.sound?.championFanfare();
      this.locked = false;
      // Let the ghost concede before the announcer crowns you
      setTimeout(() => this.voice.speak("مبروك! إنت ملك شارع الخليج", {}, "announcer-champion"), 3200);
    } else {
      this.sound?.winSting();
    }

    if (this.events.onResult) {
      // The results screen owns the moment: pause the world behind it.
      this.setPaused(true);
      this.events.onResult(result);
      return;
    }
    // Fallback for hosts without a results screen (e.g. the Unity shim).
    if (champion) {
      this.events.onMessage("KING OF GULF ROAD", "كل الشوارع لك — every street is yours");
      setTimeout(() => this.events.onChampion(), 1800);
    } else {
      this.events.onMessage(`VICTORY — ${r.def.name} defeated`, `+${payout} KD · balance ${balance} KD`);
      setTimeout(() => this.advanceToNextRival(), 2600);
    }
  }

  /**
   * Leave the results screen: spawn the next rival, or hand the
   * championship screen over to the UI.
   */
  resumeAfterResult(): void {
    if (this.disposed) return;
    this.setPaused(false);
    if (this.rivalIndex >= RIVALS.length) {
      this.events.onChampion();
      return;
    }
    if (this.rival?.state === "defeated" || !this.rival) this.advanceToNextRival();
  }

  private advanceToNextRival(): void {
    if (this.disposed) return;
    this.spawnRival();
    const next = this.rival;
    if (next) {
      this.events.onMessage(
        `Next: ${next.def.name} — ${next.def.arabicName}`,
        `${next.def.crew} · flash (F) to battle`
      );
    }
  }

  private loseBattle(): void {
    const r = this.rival!;
    r.state = "cruise";
    this.inBattle = false;
    this.locked = true;
    const staked = this.wager;
    let balance = loadGarage().kd;
    if (staked > 0) {
      balance = addKd(-staked);
      this.wager = 0;
    }
    this.sound?.loseSting();
    this.voice.speak(r.def.lines.win, r.def.voice, `${r.def.id}-win`);
    const result = this.buildResult(r, "loss", { purse: staked, kd: -staked, balance }, false);
    if (this.events.onResult) {
      this.setPaused(true);
      this.events.onResult(result);
      return;
    }
    if (staked > 0) this.events.onMessage(`Lost the purse — ${staked} KD`, `Balance ${balance} KD`);
    this.events.onDefeat(r.def);
  }

  private saveProgress(): void {
    try {
      localStorage.setItem(SAVE_KEY, String(this.rivalIndex));
    } catch {}
  }

  private loadProgress(): number {
    try {
      // RIVALS.length (one past the roster) is a persisted championship.
      const v = parseInt(localStorage.getItem(SAVE_KEY) ?? "0", 10);
      return Number.isFinite(v) ? Math.min(Math.max(v, 0), RIVALS.length) : 0;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------- update

  private update(dt: number): void {
    // Pre-battle cinematic: the camera runs on wall time (so the film is
    // always CINE_LEN seconds, whatever the frame rate) while the world
    // underneath drops into slow motion.
    if (this.cine) {
      if ((performance.now() - this.cine.start) / 1000 >= CINE_LEN) this.endCinematic();
      else {
        // The lap clock is wall-time; credit back what slow-mo swallows
        this.lapStartAt += dt * (1 - 0.22) * 1000;
        dt *= 0.22;
      }
    }
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    this.scrapeCooldown = Math.max(0, this.scrapeCooldown - dt);

    // The clock. A full day turns in CYCLE_MINUTES of play, so a single
    // race happens in one light while a session sees the sun come round.
    if (this.timeCycling) {
      this.timeHours = (this.timeHours + (24 / (GameEngine.CYCLE_MINUTES * 60)) * dt) % 24;
      // The sky is a handful of uniform writes; at 4 Hz it is free and
      // still smooth, because every value it sets is interpolated.
      this.skyAccum += dt;
      if (this.skyAccum >= 0.25) {
        this.skyAccum = 0;
        this.world.setTimeOfDay(this.timeHours);
        this.applyDaylight();
      }
    }

    // The meter and the adaptation run on the GPU inside the pass; it
    // only needs to know how much time this frame took.
    this.exposurePass.dt = dt;

    this.updatePlayer(dt);
    this.updateTraffic(dt);
    this.updateRival(dt);
    this.updateRemotes(dt);
    if (this.inBattle) this.updateBattle(dt);
    this.music?.setMood(this.inBattle || this.duel || this.cine ? "battle" : "cruise");
    // Intensity: how fast, how close, how nearly lost. A comfortable
    // battle and a two-second-from-defeat battle share a mood; they
    // should not share a temperature.
    {
      const speedPart = Math.min(1, this.player.speed / (this.tune.topSpeedKmh / KMH)) * 0.45;
      let fightPart = 0;
      if (this.inBattle && this.rival) {
        const gap = Math.abs(this.track.deltaAhead(this.player.s, this.rival.s));
        const close = 1 - Math.min(1, gap / 120); // side by side = 1
        const desperate = 1 - this.player.sp / 100;
        fightPart = 0.3 * close + 0.35 * desperate;
      }
      this.music?.setIntensity(Math.min(1, speedPart + fightPart));
    }
    this.updateCamera(dt);
    this.updateBeamVisibility();
    this.updateStreaks();
    this.updateAudio();
    this.world.setCrowdFocus(
      this.playerMesh.position.x,
      this.playerMesh.position.y + 1,
      this.playerMesh.position.z,
      dt
    );
    this.world.tick(dt);
    this.updateEffects(dt);
    this.emitHud();
  }

  private updatePlayer(dt: number): void {
    const p = this.player;

    // Accel/drag equilibrium sits at ~92 m/s (≈330 km/h) stock — garage
    // mods raise the multiplier, ceiling, and brake force from there.
    // Turbo spool: pressure builds under throttle, dumps on lift.
    if (this.tune.boostMult > 0 && !this.cine) {
      const spoolRate = this.tune.aspiration === "twin" ? 2.6 : 1.5;
      const target = this.throttle > 0.5 && p.speed > 4 ? 1 : 0;
      if (target < this.boost - 0.4 && this.boost > 0.5) this.sound?.blowOff();
      this.boost += (target - this.boost) * Math.min(1, dt * spoolRate);
    }
    // NOS: hold N for a shove; the bottle refills slowly
    this.nosActive =
      this.tune.hasNos &&
      (this.keys.has("n") || this.pad.nos) &&
      this.nosCharge > 0.02 &&
      this.throttle > 0;
    if (this.nosActive) this.nosCharge = Math.max(0, this.nosCharge - dt / 3);
    else this.nosCharge = Math.min(1, this.nosCharge + dt * 0.06);
    this.sound?.setNos(this.nosActive);

    const power =
      this.tune.accelMult * (1 + this.boost * this.tune.boostMult);
    // Every car is governed at its own number (180-400 km/h), and the
    // thrust curve is solved so that at exactly that speed thrust equals
    // drag — the limiter is where the car naturally runs out of road,
    // not a figure printed on a card it never reaches. If a build lacks
    // the power to hold its governor, the curve simply tops out lower;
    // the governor is a ceiling, never a promise of thrust.
    const limitMs = this.tune.topSpeedKmh / KMH;
    const dragAtLimit = (0.0012 * limitMs * limitMs + 1.2) * 0.35;
    const headroom = 1 - dragAtLimit / (19 * power);
    // The curve keeps its old shape (115 m/s asymptote) unless the car's
    // governor needs more room than that. Tying it *down* to a slow car's
    // limiter would flatten the mid-range until the tires never lit up.
    const ceiling = Math.max(115, headroom > 0.08 ? limitMs / headroom : limitMs * 12);
    // Sideways tires can't put all the power down — a slide trades a
    // little speed for the angle, so gripping is always the faster line.
    const driveGrip = 1 - Math.min(0.55, Math.abs(this.driftYaw) * 1.1);
    // The engine proposes, the tires dispose: torque beyond what the
    // driven axle can transmit becomes wheelspin, not thrust. Traction
    // climbs as speed builds (weight settles, aero starts working), so
    // launches are traction-limited and the top end stays power-limited —
    // which is why the big-power cars leave the line in smoke instead of
    // teleporting.
    const engineAccel =
      this.throttle * Math.max(0, 19 * power * (1 - p.speed / ceiling));
    const tractionCap =
      this.tune.gripAccel *
      (0.8 + 0.2 * Math.min(1, p.speed / 22)) *
      this.tune.tractionMult;
    this.wheelspin = Math.max(0, engineAccel - tractionCap) * driveGrip;
    const accel =
      Math.min(engineAccel, tractionCap) * driveGrip + (this.nosActive ? 14 : 0);

    // Brakes are grip-limited, not pad-limited: pads can out-torque the
    // tire, but the tire cannot out-grip the road. Better pads still pay
    // — they reach the tires' limit and hold it — the tires just set
    // most of the ceiling. Everything past that ceiling — locking,
    // anti-lock, fade, and the rotation a light rear gives up — is
    // brakes.ts; this is where its answer is applied.
    const latDemand = Math.min(1, (Math.abs(this.steerSmooth) * p.speed) / 40);
    const brakeCap = brakeCeiling(this.tune, latDemand);
    const bk = solveBrakes(this.bs, {
      dt,
      brake: this.brake,
      speed: p.speed,
      latDemand,
      steer: this.steerSmooth,
      throttle: this.throttle,
      tune: this.tune,
    });
    this.brakeOut = bk;
    const braking = bk.decel;
    const drag = 0.0012 * p.speed * p.speed + 1.2;
    p.speed = Math.max(0, p.speed + (accel - braking - drag * (this.throttle ? 0.35 : 1)) * dt);
    // The governor cuts fuel: nitrous and a tow can get you here faster,
    // but not past it.
    if (p.speed > limitMs) p.speed = limitMs;

    // --- Steering: the car carries a heading relative to the lane.
    // Yaw authority is grip-limited, so it shrinks as speed rises — and
    // friction circle, half two: heavy braking or a spinning rear axle
    // leaves less grip to turn with, so the car pushes wide instead of
    // holding an impossible arc.
    this.steerSmooth +=
      (this.steer - this.steerSmooth) * Math.min(1, dt * this.tune.steerRate);
    const longDemand = Math.min(1, (braking + this.wheelspin) / (brakeCap || 1));
    const yawRateMax =
      Math.min(1.6, this.tune.gripAccel / Math.max(p.speed, 2)) *
      (1 - 0.35 * this.tune.understeerMult * longDemand) *
      // Locked front tires are erasers: they do not steer at all, which
      // is why the car that goes straight on into the barrier is nearly
      // always the one with the pedal buried rather than modulated.
      bk.steerScale;
    this.heading += this.steerSmooth * yawRateMax * dt;
    // Cornering isn't free: held near the limit, the front tires scrub
    // speed off — the reason real drivers straighten before they send it
    p.speed *= 1 - Math.abs(this.heading) * Math.min(1, p.speed / 40) * 0.3 * dt;
    // Caster self-centering when the wheel is released
    if (Math.abs(this.steer) < 0.1) {
      this.heading -= this.heading * Math.min(1, dt * 2.4);
    }
    this.heading = THREE.MathUtils.clamp(this.heading, -0.45, 0.45);

    // --- Drift. The handbrake breaks the rear tires loose: the body
    // rotates past the direction of travel (driftYaw) while the velocity
    // heading is dragged behind it, so the car goes through the corner
    // sideways. Everything that decides how far it goes, what holds it
    // there, and what happens when nobody catches it is drift.ts.
    const dr = solveDrift(this.ds, {
      dt,
      speed: p.speed,
      steer: this.steerSmooth,
      throttle: this.throttle,
      handbrake: this.handbrake,
      wheelspin: this.wheelspin,
      brakeRotate: bk.rotate,
      driftAngleMult: this.tune.driftAngleMult,
    });
    p.speed *= 1 - dr.scrubRate * dt;
    if (dr.jolt > 0) this.shake = Math.max(this.shake, dr.jolt);
    if (dr.spun) {
      // Losing it is an event, not a slow fade — the camera and the tires
      // both say so, and the run that was building is gone.
      this.shake = Math.max(this.shake, 0.55);
      this.sound?.scrape(0.8);
      this.driftFlash = 0;
    }
    // A trail-braked entry rotates the car's line as well as its body:
    // this is the difference between pointing sideways and going there.
    if (!dr.spinning && Math.abs(bk.rotate) > 0.05) {
      this.heading += bk.yaw * dt;
    }
    if (dr.gained > 0) this.driftFlash = 1.2;
    else if (this.driftFlash > 0) this.driftFlash -= dt;
    if (dr.banked > 0 && this.inBattle) this.bstat.driftScore += dr.banked;
    if (dr.linked) this.sound?.driftLink(dr.chain);

    // --- Centrifugal push: sweepers shove the car toward the outside,
    // demanding counter-steer at speed.
    this.track.tangentAt(p.s, this.v1);
    this.track.tangentAt(p.s + 8, this.v2);
    const crossY = this.v1.z * this.v2.x - this.v1.x * this.v2.z;
    const curvature = -Math.asin(THREE.MathUtils.clamp(crossY, -1, 1)) / 8;
    const pushAccel = THREE.MathUtils.clamp(
      curvature * p.speed * p.speed * 0.22 * this.tune.slipMult,
      -8,
      8
    );
    this.slipVel += (pushAccel - this.slipVel * 2.5) * dt;
    this.curvature = curvature;

    // Sideways tires translate less of the heading into lateral travel —
    // the body hangs out while the trajectory stays controllable.
    const driftScrub = 1 - 0.5 * Math.min(1, Math.abs(this.driftYaw) / 0.5);
    p.lat += (Math.sin(this.heading) * p.speed * driftScrub + this.slipVel) * dt;

    // The wall follows the drivable width — constant four lanes except
    // through the Sharq plaza, where the road swells into the circle
    const maxLat = this.track.halfWidthAt(p.s) - 1.1;
    let hitKerb = Math.abs(p.lat) > maxLat;
    if (hitKerb) p.lat = THREE.MathUtils.clamp(p.lat, -maxLat, maxLat);

    // The plaza island is solid too: push out radially in (s, lat) space
    {
      const ds = this.track.deltaAhead(DRIFT_PLAZA.u * this.track.length, p.s);
      if (Math.abs(ds) < DRIFT_PLAZA.islandRadius + 4) {
        const dLat = p.lat - DRIFT_PLAZA.islandLat;
        const dist = Math.hypot(ds, dLat);
        const minR = DRIFT_PLAZA.islandRadius + 0.9; // half a car of margin
        if (dist < minR) {
          const push = minR - dist;
          p.s = this.track.wrap(p.s + (ds / (dist || 1)) * push);
          p.lat += (dLat / (dist || 1)) * push;
          hitKerb = true;
        }
      }
    }

    if (hitKerb) {
      // A wall hit is not one thing. The speed component INTO the
      // barrier decides what happened: near-parallel contact is a scrape
      // that grinds the door, a steep arrival is a crash that deflects
      // the nose, kills real speed and bounces the car back off.
      const side = Math.sign(p.lat) || 1;
      const intoWall = Math.max(
        0,
        (Math.sin(this.heading) * p.speed * driftScrub + this.slipVel) * side
      );
      const severity = Math.min(1, intoWall / 12);
      // Sustained rubbing: friction scales with how hard the car is
      // pressed into the steel, not a flat rate
      p.speed *= 1 - (0.35 + 1.3 * severity) * dt;
      if (Math.sign(this.heading) === side) {
        // The barrier turns the nose away — steeper arrivals rebound more
        this.heading *= -(0.1 + 0.3 * severity);
      }
      this.slipVel *= 0.2;
      // The wall ends the slide — and takes the unbanked style points
      // and the multiplier with it. A chain you can carry through a
      // barrier is a chain that rewards bouncing off one.
      this.driftYaw *= 0.25;
      breakChain(this.ds);
      if (this.scrapeCooldown <= 0) {
        this.scrapeCooldown = 0.5;
        // The impact itself, once per contact: energy loss and a shove
        // off the barrier, both scaled by how hard it was hit — and by
        // how much of it a cage absorbs
        p.speed *= 1 - 0.28 * severity * (1 - this.tune.crashResist);
        this.slipVel = -side * (1.2 + 5 * severity);
        this.events.onBump();
        if (this.inBattle) this.bstat.contacts++;
        this.spawnSparks(Math.sign(p.lat) || 1, severity);
        this.sound?.scrape(severity);
        this.shake = Math.max(this.shake, 0.3 + 0.9 * severity);
        if (this.inBattle)
          p.sp = Math.max(
            0,
            p.sp - Math.round((2 + 8 * severity) * (1 - this.tune.crashResist))
          );
      }
    }

    // Lap timing: a lap counts when the start line is crossed after
    // covering (almost) the full circuit since the previous crossing.
    this.lapDistance += p.speed * dt;
    const unwrapped = p.s + p.speed * dt;
    if (unwrapped >= this.track.length) {
      const now = performance.now();
      if (this.lapDistance >= this.track.length * 0.995) {
        const ms = now - this.lapStartAt;
        recordLap(ms);
        this.events.onLap?.(ms);
      }
      this.lapStartAt = now;
      this.lapDistance = 0;
    }
    p.s = this.track.wrap(unwrapped);

    this.track.pose(p.s, p.lat, this.v1, this.v2);
    this.track.tangentAt(p.s, this.v3);
    this.playerMesh.position.copy(this.v1);
    this.v4.copy(this.v1).add(this.v3);
    this.playerMesh.lookAt(this.v4);
    // Body language: nose follows the heading, weight transfer pitches
    // under braking/throttle, body rolls in the turn
    this.carBody.rotation.y = -(this.heading * 0.85 + this.driftYaw);
    this.carBody.rotation.z = this.heading * 0.06 + this.driftYaw * 0.1;
    const pitchTarget = this.brake * 0.035 * Math.min(1, p.speed / 20) - this.throttle * 0.014;
    this.pitch += (pitchTarget - this.pitch) * Math.min(1, dt * 6);
    this.carBody.rotation.x = this.pitch;
    // Lit-up rears visibly overspin the road speed — the launch tell
    spinWheels(
      this.carBody,
      p.speed,
      dt,
      // Road wheels turn about 30 degrees at full lock. This was 0.3 rad
      // — 17 degrees — which reads as a car that never quite commits to
      // the corner it is visibly taking.
      -this.steerSmooth * 0.52,
      this.brakeOut?.lock ?? 0,
      this.wheelspin
    );
    this.updateDriver(dt);
    if (typeof window !== "undefined" && !(window as unknown as { __ikSolve?: unknown }).__ikSolve) {
      // Debug hook: lets the IK test drive the solver directly
      (window as unknown as { __ikSolve: unknown }).__ikSolve = (
        arm: { shoulder: THREE.Object3D; elbow: THREE.Object3D; upper: number; lower: number },
        target: THREE.Vector3,
        pole: THREE.Vector3
      ) =>
        solveTwoBone({
          root: arm.shoulder,
          mid: arm.elbow,
          upper: arm.upper,
          lower: arm.lower,
          target,
          pole,
        });
    }
    const brakeLit = this.brake > 0 || this.handbrake;
    (this.carBody.userData.tailMat as THREE.MeshStandardMaterial).emissiveIntensity = brakeLit
      ? 7
      : 2;
    // The glow halos behind the lenses flare with them
    const tailGlows = this.carBody.userData.tailGlowMats as THREE.MeshBasicMaterial[] | undefined;
    if (tailGlows) {
      for (const g of tailGlows) g.opacity = brakeLit ? 0.85 : 0.3;
    }

    // Traffic collisions. Severity comes from the closing speed, the way
    // it does on a real bumper: matching the flow and tapping a car is a
    // shunt; arriving 80 km/h faster is a wreck.
    if (this.bumpCooldown <= 0) {
      for (const t of this.traffic) {
        const ds = this.track.deltaAhead(p.s, t.s);
        // Margins sized to the 1.12x presence scale in cars.ts — the
        // hitbox stays a touch inside the visual metal (forgiving beats
        // phantom contact), but not so far that bumpers overlap.
        if (Math.abs(ds) < 4.4 && Math.abs(t.lat - p.lat) < 2.1) {
          this.bumpCooldown = 1;
          const rel = p.speed - t.speed; // + = we ran into them
          const closing = Math.abs(rel);
          const sev = Math.min(1, closing / 22);
          if (rel >= 0) {
            // We hit them: the closing speed is mostly shed, and a harder
            // hit sheds proportionally more of it
            p.speed = Math.max(
              0,
              t.speed + rel * (0.4 - 0.25 * sev * (1 - this.tune.crashResist))
            );
            // Knock the player out of the hitbox, or the cooldown
            // re-bumps forever and glues them to the traffic car's tail.
            if (ds >= 0) p.s = this.track.wrap(t.s - 5.0);
          } else {
            // They hit us: a rear shunt shoves the car forward by a share
            // of the striker's closing momentum — not to its full speed,
            // which would be a free elastic slingshot off every bumper.
            p.speed += closing * 0.45;
            if (ds < 0) p.s = this.track.wrap(t.s + 5.0);
          }
          // The nose glances off toward the open side and the body gets
          // kicked off line — a shunt is never perfectly square
          const shove = Math.sign(p.lat - t.lat) || 1;
          p.lat += shove * (0.4 + 0.9 * sev);
          this.heading += shove * 0.06 * (0.5 + sev);
          this.driftYaw = this.driftYaw * 0.25 + shove * 0.12 * sev;
          breakChain(this.ds);
          this.events.onBump();
          if (this.inBattle) this.bstat.contacts++;
          this.spawnSparks(Math.sign(p.lat - t.lat) || 0, sev);
          this.sound?.bump(0.5 + sev);
          this.shake = 0.5 + 0.7 * sev;
          if (this.inBattle)
            p.sp = Math.max(
              0,
              p.sp - Math.round((4 + 8 * sev) * (1 - this.tune.crashResist))
            );
          break;
        }
      }
    }
  }

  private updateTraffic(dt: number): void {
    for (const t of this.traffic) {
      // Ease off if another civilian is right ahead in the same lane.
      for (const o of this.traffic) {
        if (o === t) continue;
        const ds = this.track.deltaAhead(t.s, o.s);
        if (ds > 0 && ds < 14 && Math.abs(o.lat - t.lat) < 2) {
          t.speed = Math.max(o.speed * 0.95, t.speed - 6 * dt);
        }
      }
      t.s = this.track.wrap(t.s + t.speed * dt);
      this.track.pose(t.s, t.lat, this.v1, this.v2);
      this.track.tangentAt(t.s, this.v3);
      t.mesh.position.copy(this.v1);
      this.v4.copy(this.v1).add(this.v3);
      t.mesh.lookAt(this.v4);
      spinWheels(t.mesh, t.speed, dt);
    }
    this.solveTrafficDrivers(dt);
  }

  /**
   * Pose the traffic's drivers — but only the ones close enough to be
   * seen doing it.
   *
   * Every car on this road carries a driver now, which is thirty rigs.
   * Solving all of them every frame would spend most of the work on
   * cars behind the camera or half a kilometre up the road. The nearest
   * few are solved properly; the rest keep the seated rest pose the rig
   * is authored in, which is exactly why that rest pose was authored to
   * read as seated on its own. Nobody can tell the difference at the
   * distance where it stops.
   */
  private solveTrafficDrivers(dt: number): void {
    const near: TrafficCar[] = [];
    for (const t of this.traffic) {
      const rig = t.mesh.userData.driver as DriverRig | undefined;
      if (!rig) continue;
      // Signed gap, so a car just behind you counts as close too
      const gap = Math.abs(this.track.deltaAhead(this.player.s, t.s));
      if (gap < TRAFFIC_DRIVER_RANGE) near.push(t);
    }
    // Cap the count as well as the range: a queue in one lane could put
    // a dozen cars inside the radius at once.
    near.sort(
      (a, b) =>
        Math.abs(this.track.deltaAhead(this.player.s, a.s)) -
        Math.abs(this.track.deltaAhead(this.player.s, b.s))
    );
    for (let i = 0; i < near.length && i < TRAFFIC_DRIVERS_SOLVED; i++) {
      const t = near[i];
      const rig = t.mesh.userData.driver as DriverRig;
      // Traffic holds its lane, so there is no lane-change signal to
      // read — but a car following a curving road still holds lock, and
      // this road curves. Take the steer from the road itself: the
      // change in tangent heading over the next stretch.
      this.track.tangentAt(t.s, this.v3);
      this.track.tangentAt(this.track.wrap(t.s + 30), this.v4);
      let dHead = Math.atan2(this.v4.x, this.v4.z) - Math.atan2(this.v3.x, this.v3.z);
      while (dHead > Math.PI) dHead -= Math.PI * 2;
      while (dHead < -Math.PI) dHead += Math.PI * 2;
      const steerWant = THREE.MathUtils.clamp(dHead * 2.2, -1, 1);
      t.steerVis += (steerWant - t.steerVis) * Math.min(1, dt * RIG.rival.steerRate);
      this.track.pose(
        t.s + RIG.driver.lookAheadM,
        t.lat * RIG.driver.lookLatK,
        this.v1,
        this.v2
      );
      this.v1.y += RIG.driver.lookHeight;
      this.solveDriverRig(rig, t.steerVis, RIG.rival.cruiseThrottle, 0, this.v1, dt);
    }
  }

  private updateRival(dt: number): void {
    const r = this.rival;
    if (!r) return;

    // During the intro film the rival holds formation on the player's
    // flank — the two-shot needs both cars filling the frame, not the
    // rival cruising off on its own errand. AI resumes at the flag.
    if (this.cine && this.cine.r === r) {
      const p = this.player;
      r.speed = p.speed;
      r.s = this.track.wrap(p.s + 1.2);
      const lane = THREE.MathUtils.clamp(
        p.lat > 0 ? p.lat - 3.5 : p.lat + 3.5,
        -(this.track.halfWidthAt(r.s) - 1.4),
        this.track.halfWidthAt(r.s) - 1.4
      );
      r.lat += (lane - r.lat) * Math.min(1, dt * 6);
      r.targetLat = lane;
      this.track.pose(r.s, r.lat, this.v1, this.v2);
      this.track.tangentAt(r.s, this.v3);
      r.mesh.position.copy(this.v1);
      this.v4.copy(this.v1).add(this.v3);
      r.mesh.lookAt(this.v4);
      spinWheels(r.mesh, r.speed, dt);
      // Holding formation is still driving: hands on the wheel for the
      // two-shot, feet steady on a cruise throttle.
      this.animateRivalDriver(r, 0, dt);
      return;
    }

    const top = r.def.topSpeedKmh / KMH;
    let targetSpeed: number;

    if (r.state === "cruise") {
      // Hang around the player so the chase never gets dull.
      const gap = this.track.deltaAhead(this.player.s, r.s);
      targetSpeed = gap > 350 ? 18 : gap > 120 ? 26 : 33;
    } else if (r.state === "battle") {
      const gap = this.track.deltaAhead(this.player.s, r.s);
      if (gap > 0) {
        // Rival leads: let the player claw back unless they're slow.
        targetSpeed = top * (gap > 120 ? 0.86 : 0.97);
      } else {
        // Chasing — capped below the player's ~92 m/s ceiling so a clean
        // driver can hold a lead against every rival, boss included.
        targetSpeed = Math.min(top * 1.05, 90);
      }
    } else {
      targetSpeed = Math.max(0, r.speed - 8 * dt); // defeated: pull over
      r.targetLat = ROAD_HALF_WIDTH - 1.4;
    }

    const prevSpeed = r.speed;
    r.speed += THREE.MathUtils.clamp(targetSpeed - r.speed, -22 * dt, 13 * dt);

    // Lane choice: dodge traffic ahead.
    if (r.state !== "defeated") {
      let blocked = false;
      for (const t of this.traffic) {
        const ds = this.track.deltaAhead(r.s, t.s);
        if (ds > 0 && ds < 42 && Math.abs(t.lat - r.targetLat) < 2.4) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        let bestLane = r.targetLat;
        let bestClear = -1;
        for (const lane of LANES) {
          let clear = 200;
          for (const t of this.traffic) {
            const ds = this.track.deltaAhead(r.s, t.s);
            if (ds > -6 && Math.abs(t.lat - lane) < 2.4) clear = Math.min(clear, ds);
          }
          if (clear > bestClear) {
            bestClear = clear;
            bestLane = lane;
          }
        }
        r.targetLat = bestLane;
      }
    }
    r.lat += THREE.MathUtils.clamp(r.targetLat - r.lat, -6 * dt, 6 * dt);

    r.s = this.track.wrap(r.s + r.speed * dt);
    this.track.pose(r.s, r.lat, this.v1, this.v2);
    this.track.tangentAt(r.s, this.v3);
    r.mesh.position.copy(this.v1);
    this.v4.copy(this.v1).add(this.v3);
    r.mesh.lookAt(this.v4);
    spinWheels(r.mesh, r.speed, dt);
    this.animateRivalDriver(r, dt > 0 ? (r.speed - prevSpeed) / dt : 0, dt);
  }

  private updateRemotes(dt: number): void {
    if (this.remotes.size === 0) return;
    const now = performance.now();
    for (const r of this.remotes.values()) {
      if (!r.mesh.visible) continue;
      // Dead-reckon from the last snapshot, then ease the shown car onto it.
      const age = Math.min((now - r.snapAt) / 1000, 1.5);
      const predicted = this.track.wrap(r.snapS + r.snapSpeed * age);
      const blend = Math.min(1, dt * 8);
      r.s = this.track.wrap(r.s + this.track.deltaAhead(r.s, predicted) * blend);
      r.lat += (r.snapLat - r.lat) * blend;

      this.track.pose(r.s, r.lat, this.v1, this.v2);
      this.track.tangentAt(r.s, this.v3);
      r.mesh.position.copy(this.v1);
      this.v4.copy(this.v1).add(this.v3);
      r.mesh.lookAt(this.v4);
      spinWheels(r.mesh, r.snapSpeed, dt);

      // Remote cruisers carry drivers too: steer dead-reckoned from the
      // lane blend, a steady cruise throttle, eyes on the road ahead.
      const rig = r.mesh.userData.driver as DriverRig | undefined;
      if (rig) {
        const steerWant = THREE.MathUtils.clamp((r.snapLat - r.lat) * 0.6, -1, 1);
        r.steerVis += (steerWant - r.steerVis) * Math.min(1, dt * RIG.rival.steerRate);
        this.track.pose(
          r.s + RIG.driver.lookAheadM,
          r.lat * RIG.driver.lookLatK,
          this.v1,
          this.v2
        );
        this.v1.y += RIG.driver.lookHeight;
        this.solveDriverRig(
          rig,
          r.steerVis,
          r.snapSpeed > 0.5 ? RIG.rival.cruiseThrottle * 1.5 : 0,
          0,
          this.v1,
          dt
        );
      }
    }
  }

  private updateBattle(dt: number): void {
    const r = this.rival!;
    const gap = this.track.deltaAhead(this.player.s, r.s); // >0 → rival ahead

    // Telemetry for the results card
    this.bstat.dist += this.player.speed * dt;
    this.bstat.topSpeed = Math.max(this.bstat.topSpeed, this.player.speed * KMH);
    this.bstat.maxLead = Math.max(this.bstat.maxLead, this.player.sp - r.sp);

    if (gap > 4) {
      let drain = 1.7 + Math.min(gap, 160) * 0.04;
      if (gap > 230) drain += 16;
      this.player.sp = Math.max(0, this.player.sp - drain * dt);
    } else if (gap < -4) {
      const lead = -gap;
      let drain = 1.7 + Math.min(lead, 160) * 0.04;
      if (lead > 230) drain += 16;
      r.sp = Math.max(0, r.sp - drain * dt);
    }

    // One radio warning when the fight turns critical — once per battle,
    // not every frame the bar is low.
    if (!this.spWarned && this.player.sp < 25 && this.player.sp > 0) {
      this.spWarned = true;
      this.voice.radioSpeak("انتبه! نقاطك تروح — قرّب عليه", { rate: 1.22 });
    }

    if (r.sp <= 0) this.winBattle();
    else if (this.player.sp <= 0) this.loseBattle();
  }

  /**
   * three.js FOV is vertical, which starves the horizontal view on
   * screens narrower than 16:9 (portrait phones, 4:3 monitors): the road
   * ahead vanishes. Widen the vertical FOV on narrow aspects so the
   * horizontal field never drops below its 16:9 equivalent. Wider
   * screens get standard Hor+ (more world, the ultrawide payoff) up to
   * ~21.5:9 — past that the horizontal field is held, because on a 32:9
   * panel uncapped Hor+ stretches the road edges into a fisheye.
   */
  private aspectFov(vFovDeg: number): number {
    const aspect = this.camera.aspect;
    if (!Number.isFinite(aspect)) return vFovDeg;
    const HOR_CAP = 21.5 / 9;
    if (aspect > HOR_CAP) {
      const narrowed =
        2 *
        Math.atan(
          Math.tan(THREE.MathUtils.degToRad(vFovDeg) / 2) * (HOR_CAP / aspect)
        );
      return THREE.MathUtils.radToDeg(narrowed);
    }
    if (aspect >= 16 / 9 - 1e-3) return vFovDeg;
    const widened =
      2 *
      Math.atan(
        Math.tan(THREE.MathUtils.degToRad(vFovDeg) / 2) * ((16 / 9) / aspect)
      );
    return Math.min(108, THREE.MathUtils.radToDeg(widened));
  }

  /**
   * A light shaft is air made visible, and air only shows when you look
   * ACROSS it. From the chase camera you look straight down the beams'
   * axis, where an additive cone accumulates its full depth into a disc
   * hanging over the road — no opacity is low enough to fix that, only
   * hiding it is. So the shafts fade out as the view aligns with them and
   * return in side and head-on views, where they read as real light.
   */
  private updateBeamVisibility(): void {
    if (!this.beamMat) return;
    this.camera.getWorldDirection(this.beamCamDir);
    this.playerMesh.getWorldDirection(this.beamCarDir);
    // +1 = looking the same way the car points (down the beams from
    // behind); 0 = across them; -1 = head-on into them, which should
    // stay bright because that is what oncoming headlights do.
    const align = this.beamCamDir.dot(this.beamCarDir);
    const behind = Math.max(0, align);
    const hide = behind * behind * (3 - 2 * behind); // smoothstep
    this.beamMat.opacity = this.beamBaseOpacity * (1 - hide);
  }

  private updateCamera(dt: number): void {
    if (this.cine) {
      this.updateCineCamera();
      return;
    }
    const p = this.player;
    this.track.pose(p.s, p.lat, this.v1, this.v2);
    this.track.tangentAt(p.s, this.v3);

    // Chase position pulls back and rises with speed
    const dist = 9.5 + p.speed * 0.02;
    this.v4
      .copy(this.v1)
      .addScaledVector(this.v3, -dist)
      .add(this.v2.set(0, 3.4 + p.speed * 0.007, 0));
    if (!this.camInit) {
      this.camInit = true;
      this.camBase.copy(this.v4);
    } else {
      this.camBase.lerp(this.v4, Math.min(1, dt * 5.5));
    }

    // Impact jolt + speed rumble as smooth pseudo-noise, applied on top of
    // the lerped base — never fed back into it, or it compounds
    this.shake = Math.max(0, this.shake - this.shake * 3.5 * dt);
    const t = performance.now() / 1000;
    const amp = Math.pow(p.speed / this.topSpeedRef, 3) * 0.055 + this.shake * 0.32;
    this.camera.position.copy(this.camBase);
    this.camera.position.x += (Math.sin(t * 31.7) + Math.sin(t * 17.3)) * 0.5 * amp;
    this.camera.position.y += (Math.sin(t * 27.1) + Math.sin(t * 13.9)) * 0.5 * amp;

    // Look ahead into the curve so sweepers read like sweepers
    const lookAside = THREE.MathUtils.clamp(this.curvature * p.speed * p.speed * 0.045, -4, 4);
    this.track.sideAt(p.s, this.v2);
    this.v4.copy(this.v1).addScaledVector(this.v3, 14).addScaledVector(this.v2, lookAside);
    this.v4.y += 1.4;
    this.camera.lookAt(this.v4);

    // Lateral-G camera roll
    const rollTarget =
      THREE.MathUtils.clamp(this.heading * (p.speed / this.topSpeedRef), -0.5, 0.5) * 0.14 +
      THREE.MathUtils.clamp(this.slipVel * 0.012, -0.03, 0.03) +
      this.driftYaw * 0.1;
    this.camRoll += (rollTarget - this.camRoll) * Math.min(1, dt * 4);
    this.camera.rotateZ(this.camRoll + Math.sin(t * 23.7) * this.shake * 0.02);

    // FOV: speed stretch + a launch kick under throttle from low speed
    const launchKick = this.throttle * THREE.MathUtils.clamp(1 - p.speed / 40, 0, 1) * 5;
    const targetFov = 62 + (p.speed / this.topSpeedRef) * 18 + launchKick;
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, dt * 3);
    this.camera.fov = this.aspectFov(this.fovCurrent);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Three shots on the real-time clock:
   *   A 0.0–1.8s  orbit of the rival, rear quarter sweeping to the nose
   *   B 1.8–3.1s  low side pass of the player's own machine
   *   C 3.1–4.2s  pull back and settle into the chase camera
   */
  private updateCineCamera(): void {
    const c = this.cine!;
    const t = (performance.now() - c.start) / 1000;
    const p = this.player;

    const ease = (x: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(x, 0, 1), 2);

    if (t < 1.8) {
      const k = ease(t / 1.8);
      this.track.pose(c.r.s, c.r.lat, this.v1, this.v2); // v1 = rival
      this.track.tangentAt(c.r.s, this.v3);
      const a = 2.55 - 1.35 * k; // rear-quarter → front-side sweep
      const radius = 6.2 - 1.2 * k;
      const sx = -this.v3.z;
      const sz = this.v3.x;
      this.camera.position.set(
        this.v1.x + (this.v3.x * Math.cos(a) + sx * Math.sin(a)) * radius,
        this.v1.y + 1.5 - 0.7 * k,
        this.v1.z + (this.v3.z * Math.cos(a) + sz * Math.sin(a)) * radius
      );
      this.v4.set(this.v1.x, this.v1.y + 0.6, this.v1.z);
      this.camera.lookAt(this.v4);
    } else if (t < 3.6) {
      // The two-shot: both machines side by side at speed. The camera
      // hangs ahead of the pair, low over the asphalt, dollying slowly
      // back toward them and aimed at the midpoint so player and rival
      // share the frame with their names on the bars below.
      const k = ease((t - 1.8) / 1.8);
      this.track.pose(p.s, p.lat, this.v1, this.v2); // v1 = player
      this.track.pose(c.r.s, c.r.lat, this.v4, this.v2); // v4 = rival
      const midX = (this.v1.x + this.v4.x) / 2;
      const midZ = (this.v1.z + this.v4.z) / 2;
      const midY = (this.v1.y + this.v4.y) / 2;
      this.track.tangentAt(p.s, this.v3);
      const ahead = 9.5 - 1.6 * k; // dolly drifts back toward the cars
      this.camera.position.set(
        midX + this.v3.x * ahead,
        midY + 0.95,
        midZ + this.v3.z * ahead
      );
      this.v4.set(midX, midY + 0.7, midZ);
      this.camera.lookAt(this.v4);
    } else {
      const k = ease((t - 3.6) / (CINE_LEN - 3.6));
      this.track.pose(p.s, p.lat, this.v1, this.v2);
      this.track.tangentAt(p.s, this.v3);
      const sx = -this.v3.z;
      const sz = this.v3.x;
      // From the side-rear up into the standard chase position
      const dist = 9.5 + p.speed * 0.02;
      const chaseY = this.v1.y + 3.4 + p.speed * 0.007;
      this.camera.position.set(
        this.v1.x + THREE.MathUtils.lerp(sx * 4.2 - this.v3.x * 2.5, -this.v3.x * dist, k),
        THREE.MathUtils.lerp(this.v1.y + 1.1, chaseY, k),
        this.v1.z + THREE.MathUtils.lerp(sz * 4.2 - this.v3.z * 2.5, -this.v3.z * dist, k)
      );
      this.v4.set(
        this.v1.x + this.v3.x * (k * 14),
        this.v1.y + THREE.MathUtils.lerp(0.55, 1.4, k),
        this.v1.z + this.v3.z * (k * 14)
      );
      this.camera.lookAt(this.v4);
    }
    // The film is framed at the lens's resting focal length
    if (this.fovCurrent !== 58) {
      this.fovCurrent += (58 - this.fovCurrent) * 0.1;
      this.camera.fov = this.aspectFov(this.fovCurrent);
      this.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------ streaks

  private newStreak(baseS: number): { s: number; lat: number; y: number; len: number } {
    const side = Math.random() < 0.5 ? -1 : 1;
    return {
      s: this.track.wrap(baseS + 25 + Math.random() * 75),
      lat: side * (2.5 + Math.random() * 13),
      y: 1 + Math.random() * 5.5,
      len: 2.5 + Math.random() * 2,
    };
  }

  private updateStreaks(): void {
    const speedKmh = this.player.speed * 3.6;
    const mat = this.streaks.material as THREE.LineBasicMaterial;
    mat.opacity = THREE.MathUtils.clamp((speedKmh - 190) / 110, 0, 1) * 0.4;
    // Skip the draw call entirely below the fade-in speed
    this.streaks.visible = mat.opacity > 0;
    if (!this.streaks.visible) return;

    const pos = this.streaks.geometry.getAttribute("position") as THREE.BufferAttribute;
    const len = 2 + this.player.speed * 0.06;
    for (let i = 0; i < this.streakData.length; i++) {
      let st = this.streakData[i];
      if (this.track.deltaAhead(this.player.s, st.s) < -15) {
        st = this.streakData[i] = this.newStreak(this.player.s);
      }
      // One point + one tangent eval per streak; right vector = (-Tz, 0, Tx)
      this.track.pointAt(st.s, this.v1);
      this.track.tangentAt(st.s, this.v3);
      const px = this.v1.x - this.v3.z * st.lat;
      const pz = this.v1.z + this.v3.x * st.lat;
      pos.setXYZ(i * 2, px, st.y, pz);
      pos.setXYZ(i * 2 + 1, px + this.v3.x * len, st.y, pz + this.v3.z * len);
    }
    pos.needsUpdate = true;
  }

  private updateEffects(dt: number): void {
    // Keep the moon's shadow frustum centred on the player, snapped to
    // shadow-map texels — a continuously sliding ortho frustum makes
    // every shadow edge crawl and flicker at speed
    const moon = this.world.moonLight;
    const texel = 180 / moon.shadow.mapSize.x; // ortho width / map size
    const p = this.playerMesh.position;
    const u = p.dot(this.lightRight);
    const v = p.dot(this.lightUp);
    this.v1
      .copy(p)
      .addScaledVector(this.lightRight, Math.round(u / texel) * texel - u)
      .addScaledVector(this.lightUp, Math.round(v / texel) * texel - v);
    moon.position.copy(this.v1).addScaledVector(this.moonDir, 400);
    moon.target.position.copy(this.v1);

    this.grainPass.uniforms.uTime.value = (performance.now() / 1000) % 100;

    // Sky dome, stars and moon ride with the camera — they are backdrop,
    // not geometry, so they must never fall outside the far plane. Each
    // keeps the offset it was authored with, so the moon stays off to one
    // side instead of being dragged overhead.
    for (const o of this.world.skyFollowers) {
      const off = o.userData.skyOffset as THREE.Vector3;
      o.position.x = this.camera.position.x + off.x;
      o.position.z = this.camera.position.z + off.z;
    }

    // --- Sparks: they cool, fall, and skitter along the asphalt
    this.sparkFx.update(dt, { gravity: 17, drag: 0.7, bounce: 0.42, groundY: 0.03 });

    // --- Tire smoke while drifting: pour from both rear arches, rise,
    // spread downwind of the slide, die in about a second. A launch with
    // the rears lit up smokes the same arches before the car is moving
    // fast enough to drift.
    const burnout = this.wheelspin > 3 && this.player.speed < 22;
    // Locked wheels smoke as surely as spinning ones: same rubber, same
    // road, and the only difference is which way the mismatch runs.
    const locked = (this.brakeOut?.lock ?? 0) > 0.4 && this.player.speed > 14;
    const drifting =
      ((Math.abs(this.driftYaw) > 0.14 && this.player.speed > 12) ||
        burnout ||
        locked) &&
      !this.cine;
    if (drifting) {
      this.track.tangentAt(this.player.s, this.v3);
      const px = this.playerMesh.position.x;
      const pz = this.playerMesh.position.z;
      // Rear axle sits behind the car centre; ± the side vector per wheel
      const bx = px - this.v3.x * 1.6;
      const bz = pz - this.v3.z * 1.6;
      const sx = -this.v3.z;
      const sz = this.v3.x;
      // Time-budgeted so density is refresh-rate independent
      this.smokeAcc += (Math.abs(this.driftYaw) > 0.4 ? 85 : 55) * dt;
      const spawn = Math.floor(this.smokeAcc);
      this.smokeAcc -= spawn;
      const out = Math.sign(this.driftYaw) || 1;
      // A slide throws its smoke sideways because the tyre is travelling
      // across itself. A locked wheel is travelling straight down the
      // road, so its smoke just boils up off the patch and gets left
      // behind — the same particles, thrown a different way.
      const sideways = Math.min(1, Math.abs(this.driftYaw) / 0.25);
      const lockOnly = 1 - sideways;
      // Locked fronts smoke at the front axle, not behind the rears.
      const ax = bx + this.v3.x * 3.2 * lockOnly;
      const az = bz + this.v3.z * 3.2 * lockOnly;
      for (let n = 0; n < spawn; n++) {
        const side = (n % 2 === 0 ? 0.85 : -0.85) + (Math.random() - 0.5) * 0.5;
        this.smokeFx.spawn(
          ax + sx * side + (Math.random() - 0.5) * 0.55,
          0.24 + Math.random() * 0.22,
          az + sz * side + (Math.random() - 0.5) * 0.55,
          (sx * out * (1.2 + Math.random()) + (Math.random() - 0.5)) * sideways -
            this.v3.x * 2.2 * lockOnly,
          1.3 + Math.random() * 1.5,
          (sz * out * (1.2 + Math.random()) + (Math.random() - 0.5)) * sideways -
            this.v3.z * 2.2 * lockOnly,
          0.95 + Math.random() * 0.55,
          1.9 + Math.random() * 0.9
        );
      }
    }
    // Billowing smoke sheds its outward speed as it expands
    this.smokeFx.update(dt, { drag: 1.6, gravity: -0.35 });

    // --- Exhaust. A backfire is unburnt fuel lighting in the pipe on a
    // hard lift, so it fires on the throttle's falling edge at revs; the
    // nitrous flame burns continuously while the bottle is open.
    if (!this.cine && this.carBody.userData.exhaust) {
      const tips = this.carBody.userData.exhaust as THREE.Vector3[];
      const lift = this.lastThrottleFx - this.throttle;
      // A hard lift at revs always pops — the randomness belongs in how
      // big the flame is, not in whether the car has an exhaust.
      const backfire = lift > 0.4 && this.player.speed > 14;
      const nos = this.nosActive;
      if (backfire || nos) {
        const n = nos ? 2 : 3 + Math.floor(Math.random() * 4);
        for (const tip of tips) {
          // The anchor is car-local; carBody carries the presence scale
          // and the drift yaw, so ask it for the world position.
          this.carBody.localToWorld(this.v4.copy(tip));
          for (let k = 0; k < n; k++) {
            const back = -(2 + Math.random() * 5);
            this.track.tangentAt(this.player.s, this.v3);
            this.flameFx.spawn(
              this.v4.x + (Math.random() - 0.5) * 0.12,
              this.v4.y + (Math.random() - 0.5) * 0.08,
              this.v4.z + (Math.random() - 0.5) * 0.12,
              this.v3.x * back + (Math.random() - 0.5) * 1.2,
              0.4 + Math.random() * 0.8,
              this.v3.z * back + (Math.random() - 0.5) * 1.2,
              nos ? 0.14 + Math.random() * 0.08 : 0.16 + Math.random() * 0.12,
              nos ? 0.22 : 0.3
            );
          }
        }
      }
    }
    this.lastThrottleFx = this.throttle;
    this.flameFx.update(dt, { drag: 3.2, gravity: -1.2 });

    // --- Brake rotors glow with the heat they are actually absorbing.
    // Energy in scales with pedal pressure and road speed; it radiates
    // away on its own clock, so the discs stay orange down the straight
    // after a hard stop and cool through the corner.
    {
      const heatIn = this.brake * Math.min(1, this.player.speed / 28);
      this.rotorHeat = THREE.MathUtils.clamp(
        this.rotorHeat + (heatIn * 1.35 - this.rotorHeat * 0.55) * dt,
        0,
        1
      );
      const wheels = this.carBody.userData.wheels as THREE.Group[] | undefined;
      if (wheels) {
        for (const w of wheels) {
          const m = w.userData.rotorMat as THREE.MeshStandardMaterial | undefined;
          // Front discs do most of the work, so they run hotter
          if (m) m.emissiveIntensity = this.rotorHeat * this.rotorHeat * 2.6;
        }
      }
    }
  }

  /**
   * One driver rig, fully solved: the wheel to the steer angle, both
   * hands IK'd onto the rim where they grip it, both feet on the pedals
   * riding the press, eyes on the look target. Shared by every car that
   * carries a driver — the player's, the rival's, the remote cruisers'
   * — because a cabin with a mannequin bolted in it reads as an empty
   * car the moment it pulls alongside.
   */
  private solveDriverRig(
    rig: DriverRig,
    steer: number,
    throttle: number,
    brake: number,
    look: THREE.Vector3,
    dt: number
  ): void {
    // Lock-to-lock is about a turn and a half each way in a road car;
    // steer is -1..1, so this is the visible wheel angle.
    const lock = steer * RIG.driver.steerLock;
    rig.wheel.rotation.z +=
      (-lock - rig.wheel.rotation.z) * Math.min(1, dt * RIG.driver.wheelRate);

    // Eyes first: `look` may live in a scratch vector this method is
    // about to reuse for grips and poles.
    aimConstrained(rig.head, look, {
      maxYaw: RIG.driver.neckYaw,
      maxPitch: RIG.driver.neckPitch,
      ease: Math.min(1, dt * RIG.driver.neckRate),
    });

    // Ten-to-two, carried round with the rim. The grips are points ON
    // the wheel — fixed in its LOCAL frame — so localToWorld carries
    // them round as it turns. Adding rotation.z to the local angle as
    // well counts the wheel twice: the hands then orbit at double the
    // spoke rate and cross over each other at full lock.
    rig.wheel.updateWorldMatrix(true, false);
    for (const arm of rig.arms) {
      const grip = arm.side < 0 ? RIG.driver.gripLeft : RIG.driver.gripRight;
      this.v1.set(Math.cos(grip) * rig.wheelRadius, Math.sin(grip) * rig.wheelRadius, 0);
      rig.wheel.localToWorld(this.v1);

      // Elbows break outward and down — the pole is what stops a solved
      // arm from bending like a flamingo's knee. Offset in the rig's
      // own frame, so the pose holds whichever way the car is heading.
      this.v2.set(arm.side * RIG.driver.armPoleX, RIG.driver.armPoleY, RIG.driver.armPoleZ);
      rig.group.localToWorld(this.v2);

      solveTwoBone({
        root: arm.shoulder,
        mid: arm.elbow,
        upper: arm.upper,
        lower: arm.lower,
        target: this.v1,
        pole: this.v2,
        weight: 1,
      });
    }

    // Feet on the pedals — throttle under the outboard foot in a
    // right-hand-drive car. The pedal itself sinks with the press and
    // the foot is solved onto the moving face, so a stab of brake reads
    // all the way down the driver's leg.
    for (const leg of rig.legs) {
      const pedal = leg.side > 0 ? rig.pedals.throttle : rig.pedals.brake;
      const press = leg.side > 0 ? throttle : brake;
      pedal.position.z = (pedal.userData.restZ as number) + press * RIG.driver.pedalTravelZ;
      pedal.position.y = (pedal.userData.restY as number) - press * RIG.driver.pedalTravelY;
      pedal.updateWorldMatrix(true, false);
      this.v1.setFromMatrixPosition(pedal.matrixWorld);
      // Knees break up and forward, not sideways into the tunnel
      this.v2.set(leg.side * RIG.driver.legPoleX, RIG.driver.legPoleY, RIG.driver.legPoleZ);
      rig.group.localToWorld(this.v2);
      solveTwoBone({
        root: leg.shoulder,
        mid: leg.elbow,
        upper: leg.upper,
        lower: leg.lower,
        target: this.v1,
        pole: this.v2,
        weight: 1,
      });
    }
  }

  /**
   * The player's driver, solved from the real inputs. The head looks
   * where the car is going, not where it is pointing.
   */
  private updateDriver(dt: number): void {
    const rig = this.carBody.userData.driver as DriverRig | undefined;
    if (!rig) return;
    this.track.pose(
      this.player.s + RIG.driver.lookAheadM,
      this.player.lat * RIG.driver.lookLatK,
      this.v1,
      this.v2
    );
    this.v1.y += RIG.driver.lookHeight;
    this.solveDriverRig(rig, this.steerSmooth, this.throttle, this.brake, this.v1, dt);
  }

  /**
   * The rival's driver, driven off the rival's own kinematics: steer
   * follows the lane change, the feet follow the speed change, and
   * within a couple of car lengths the helmet turns to size you up —
   * the look-over before the headlight flash is half the ritual.
   */
  private animateRivalDriver(r: Rival, accel: number, dt: number): void {
    const rig = r.mesh.userData.driver as DriverRig | undefined;
    if (!rig) return;
    const R = RIG.rival;
    const steerWant = THREE.MathUtils.clamp((r.targetLat - r.lat) * R.steerPerLat, -1, 1);
    r.steerVis += (steerWant - r.steerVis) * Math.min(1, dt * R.steerRate);
    const wantThrottle =
      accel > R.throttleAccel
        ? Math.min(1, accel / R.throttleScale)
        : r.speed > 1
          ? R.cruiseThrottle
          : 0;
    const wantBrake = accel < R.brakeAccel ? Math.min(1, -accel / R.brakeScale) : 0;
    r.throttleVis += (wantThrottle - r.throttleVis) * Math.min(1, dt * R.pedalRate);
    r.brakeVis += (wantBrake - r.brakeVis) * Math.min(1, dt * R.pedalRate);

    const gap = this.track.deltaAhead(r.s, this.player.s);
    if (Math.abs(gap) < R.glanceGapM && Math.abs(this.player.lat - r.lat) > R.glanceLatM) {
      this.v1.copy(this.playerMesh.position);
      this.v1.y += 0.6;
    } else {
      this.track.pose(
        r.s + RIG.driver.lookAheadM,
        r.lat * RIG.driver.lookLatK,
        this.v1,
        this.v2
      );
      this.v1.y += RIG.driver.lookHeight;
    }
    this.solveDriverRig(rig, r.steerVis, r.throttleVis, r.brakeVis, this.v1, dt);
  }

  /**
   * Burst of sparks at the car. `side` is which flank made contact
   * (-1 left, +1 right, 0 centre/rear) so the shower comes off the
   * panel that actually hit something instead of the car's middle.
   */
  private spawnSparks(side = 0, intensity = 1): void {
    const p = this.playerMesh.position;
    this.track.tangentAt(this.player.s, this.v3);
    const sx = -this.v3.z;
    const sz = this.v3.x;
    const n = Math.round(26 + 34 * intensity);
    for (let i = 0; i < n; i++) {
      const along = -0.6 + Math.random() * 1.2;
      const lat = side * (0.95 + Math.random() * 0.15);
      const back = -(5 + Math.random() * 12) * (0.6 + intensity * 0.6);
      this.sparkFx.spawn(
        p.x + sx * lat + this.v3.x * along,
        0.22 + Math.random() * 0.3,
        p.z + sz * lat + this.v3.z * along,
        this.v3.x * back + sx * side * (1 + Math.random() * 4) + (Math.random() - 0.5) * 3,
        // Upward throw. This was 1.5-6.5 m/s, which against the 17 m/s^2
        // the spark system pulls puts the apex 1.2 m ABOVE the sill it
        // came off: measured, sparks reached 1.48 m and a tenth of them
        // spent their life above a metre — arcing over the roof of the
        // car that made them. Grinding steel on a barrier throws sparks
        // out and back along the panel, not into the air. 0.5-3.5 m/s
        // tops out around 0.36 m of climb, so they skip along the flank
        // and die on the asphalt where they belong.
        0.5 + Math.random() * 3,
        this.v3.z * back + sz * side * (1 + Math.random() * 4) + (Math.random() - 0.5) * 3,
        0.35 + Math.random() * 0.5,
        0.09 + Math.random() * 0.07
      );
    }
  }

  private updateAudio(): void {
    if (!this.sound) return;
    const speedKmh = this.player.speed * 3.6;
    let gear = 0;
    while (gear < GEARS.length - 2 && speedKmh >= GEARS[gear + 1]) gear++;
    const rpmFrac = Math.min(
      1,
      Math.max(0.12, (speedKmh - GEARS[gear]) / (GEARS[gear + 1] - GEARS[gear]))
    );
    // Tires complain when the heading fights the lane at speed — and a
    // locked wheel is the loudest complaint of all, because it is one
    // patch of rubber being erased at road speed instead of rolling.
    const skid = Math.max(
      0,
      Math.abs(this.heading) * (speedKmh / 140) +
        Math.abs(this.slipVel) * 0.12 +
        Math.abs(this.driftYaw) * (speedKmh / 95) +
        (this.brakeOut?.lock ?? 0) * Math.min(1, speedKmh / 60) * 0.85 -
        0.22
    );
    // Against the governor: within a hair of the car's limit on full
    // throttle is the car fighting its own ECU.
    const limitMs = this.tune.topSpeedKmh / KMH;
    const limited =
      this.throttle > 0.6 && this.player.speed > limitMs - 0.4 ? 1 : 0;

    // Running wide onto the shoulder — the kerb buzz through the floor
    const edge = this.track.halfWidthAt(this.player.s) - 1.35;
    const rumble = THREE.MathUtils.clamp(
      (Math.abs(this.player.lat) - edge) / 0.8,
      0,
      1
    );

    // The ears ride the camera, not the car
    this.camera.getWorldDirection(this.v3);
    const cam = this.camera.position;

    // How coastal the road is here, and where the water lies. The sea is
    // on the left of the coastal leg, which is the Gulf Road's whole
    // character — it should be audible, not just visible.
    const u = this.track.wrap(this.player.s) / this.track.length;
    const coastal =
      u >= COAST_U.from && u <= COAST_U.to
        ? 1
        : Math.max(0, 1 - Math.min(Math.abs(u - COAST_U.to), Math.abs(u - COAST_U.from)) * 12);
    this.track.pose(this.player.s, -55, this.v1, this.v2); // 55 m to seaward

    const r = this.rival;
    this.sound.update({
      speedKmh,
      throttle: this.throttle,
      rpmFrac,
      gear: speedKmh < 2 ? 0 : gear + 1,
      skid,
      boost: this.boost,
      nosActive: this.nosActive,
      brake: this.brake,
      driftYaw: this.driftYaw,
      limited,
      rumble,
      listener: {
        x: cam.x, y: cam.y, z: cam.z,
        fx: this.v3.x, fy: this.v3.y, fz: this.v3.z,
        ux: 0, uy: 1, uz: 0,
      },
      rival: r
        ? {
            x: r.mesh.position.x,
            y: r.mesh.position.y + 0.5,
            z: r.mesh.position.z,
            speedKmh: r.speed * KMH,
            throttle: r.state === "battle" ? 1 : 0.55,
          }
        : null,
      coast: coastal,
      seaX: this.v1.x,
      seaZ: this.v1.z,
    });
  }

  // ---------------------------------------------------------------- hud

  private computeMapBounds(): void {
    const p = new THREE.Vector3();
    const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i <= 200; i++) {
      this.track.curve.getPointAt(i / 200, p);
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x);
      b.minZ = Math.min(b.minZ, p.z);
      b.maxZ = Math.max(b.maxZ, p.z);
    }
    this.mapBounds = b;
  }

  private toMap(x: number, z: number): [number, number] {
    const b = this.mapBounds;
    const pad = 0.08;
    const nx = pad + ((x - b.minX) / (b.maxX - b.minX)) * (1 - pad * 2);
    const nz = pad + ((z - b.minZ) / (b.maxZ - b.minZ)) * (1 - pad * 2);
    return [nx, nz];
  }

  private emitHud(): void {
    const area = areaAt(this.track, this.player.s);
    const r = this.rival;

    // Dev/tuning handle — inspect live state from the console.
    let nearest: { ds: number; lat: number } | null = null;
    for (const t of this.traffic) {
      const ds = this.track.deltaAhead(this.player.s, t.s);
      if (ds > 0 && ds < 90 && (!nearest || ds < nearest.ds)) nearest = { ds, lat: t.lat };
    }
    // Dev handles: the live state snapshot plus the engine itself, so
    // scripted play-tests can stage situations the sim reaches slowly.
    (window as unknown as { __grnEngine: GameEngine }).__grnEngine = this;
    (window as unknown as { __grnGpu: string }).__grnGpu = this.gpuName();
    // THREE itself and the layout constants, so a test can raycast the
    // world it is looking at rather than re-derive where things ought to
    // be — the street-network test walks the city with these.
    (window as unknown as { __grnThree: typeof THREE }).__grnThree = THREE;
    (window as unknown as { __grnStreets: typeof STREETS }).__grnStreets = STREETS;
    (window as unknown as { __grnCoastU: typeof COAST_U }).__grnCoastU = COAST_U;
    (window as unknown as { __grnRoadHalf: number }).__grnRoadHalf = ROAD_HALF_WIDTH;
    (window as unknown as { __grnDebug: object }).__grnDebug = {
      playerSpeed: this.player.speed,
      playerLat: this.player.lat,
      rivalSpeed: r?.speed,
      rivalState: r?.state,
      gap: r ? this.track.deltaAhead(this.player.s, r.s) : null,
      inBattle: this.inBattle,
      locked: this.locked,
      trafficAhead: nearest,
      remotes: this.remotes.size,
      lapDistance: this.lapDistance,
      s: this.player.s,
      heading: this.heading,
      slipVel: this.slipVel,
      shake: this.shake,
      streakOpacity: (this.streaks.material as THREE.LineBasicMaterial).opacity,
      driftYaw: this.driftYaw,
      driftRun: this.driftRun,
      driftChain: this.ds.chain,
      spinning: this.ds.spinT > 0,
      brakeLock: this.brakeOut?.lock ?? 0,
      brakeTemp: Math.round(this.brakeOut?.temp ?? 0),
      brakeFade: this.brakeOut?.fade ?? 0,
      abs: this.brakeOut?.abs ?? false,
      cine: this.cine ? (performance.now() - this.cine.start) / 1000 : null,
      renderScale: this.renderScale,
      fpsEma: Math.round(this.fpsEma),
      sound: this.sound?.debugState() ?? null,
    };

    let rivalDist: number | null = null;
    let canFlash = false;
    let map: HudData["map"] = null;

    this.track.pointAt(this.player.s, this.v1);
    const [px, py] = this.toMap(this.v1.x, this.v1.z);

    if (r && r.state !== "defeated") {
      const gap = this.track.deltaAhead(this.player.s, r.s);
      rivalDist = gap;
      canFlash = !this.inBattle && !this.challengePending && gap >= 2 && gap <= FLASH_RANGE;
      this.track.pointAt(r.s, this.v1);
      const [rx, ry] = this.toMap(this.v1.x, this.v1.z);
      map = { px, py, rx, ry };
    } else {
      map = { px, py, rx: -1, ry: -1 };
    }

    let nearestRemote: HudData["nearestRemote"] = null;
    for (const [id, r] of this.remotes) {
      if (!r.mesh.visible) continue;
      const d = this.track.deltaAhead(this.player.s, r.s);
      if (Math.abs(d) > 70) continue;
      if (!nearestRemote || Math.abs(d) < Math.abs(nearestRemote.dist)) {
        nearestRemote = { id, name: r.name, dist: d };
      }
    }

    this.events.onHud({
      nearestRemote,
      duel: this.duel,
      flashCount: performance.now() > this.flashWindowUntil ? 0 : this.flashCount,
      speedKmh: this.player.speed * KMH,
      areaName: area.name,
      areaArabic: area.arabic,
      rivalDist,
      canFlash,
      battle:
        this.inBattle && r
          ? {
              playerSp: this.player.sp,
              rivalSp: r.sp,
              rivalName: r.def.name,
              rivalArabic: r.def.arabicName,
              rivalCrew: r.def.crew,
            }
          : null,
      defeated: this.rivalIndex,
      total: RIVALS.length,
      map,
      boost: this.tune.boostMult > 0 ? this.boost : null,
      nos: this.tune.hasNos ? this.nosCharge : null,
      drift:
        this.driftFlash > 0 || Math.abs(this.driftYaw) > 0.06
          ? {
              deg: Math.round((Math.abs(this.driftYaw) * 180) / Math.PI),
              score: Math.round(this.driftRun),
              active: Math.abs(this.driftYaw) > 0.14,
              chain: this.ds.chain,
              spinning: this.ds.spinT > 0,
            }
          : null,
      brakes: {
        lock: this.brakeOut?.lock ?? 0,
        fade: this.brakeOut?.fade ?? 0,
        abs: this.brakeOut?.abs ?? false,
      },
    });
  }
}
