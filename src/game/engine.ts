import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Track, ROAD_HALF_WIDTH, LANES } from "./track";
import { buildWorld, areaAt, WorldHandle } from "./world";
import { createCar } from "./cars";
import { RIVALS, RivalDef } from "./rivals";
import { VoiceBox } from "./voice";
import { SoundEngine } from "./sound";
import { GEARS } from "./gears";

// Tokyo-Xtreme-Racer-style rules, Kuwait edition: cruise the loop, find the
// rival, flash your headlights (F) to start a battle. Both drivers have SP
// (Spirit Points); the one trailing bleeds SP, crashes bleed more. Empty
// the rival's bar to take their crown and move up the roster.

const KMH = 3.6;
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
  speedKmh: number;
  areaName: string;
  areaArabic: string;
  rivalDist: number | null;
  canFlash: boolean;
  battle: BattleHud | null;
  defeated: number;
  total: number;
  map: { px: number; py: number; rx: number; ry: number } | null;
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
}

interface RemotePlayer {
  mesh: THREE.Group;
  s: number;
  lat: number;
  snapS: number;
  snapLat: number;
  snapSpeed: number;
  snapAt: number;
}

interface TrafficCar {
  mesh: THREE.Group;
  s: number;
  lat: number;
  speed: number;
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
}

const TRAFFIC_COLORS = [0x8a96a3, 0x5d6770, 0xb0a890, 0x6e7f8d, 0x4a5560, 0x9c8f7a];

// Unsharp-mask crispening + film vignette + animated grain, in linear
// space before output.
const VignetteGrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uTexel;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 13.0) * 43758.5453);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Unsharp mask against a 4-tap cross blur
      vec3 blur = 0.25 * (
        texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb +
        texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb +
        texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb +
        texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb);
      c.rgb += (c.rgb - blur) * 0.4;
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - 0.38 * smoothstep(0.38, 0.85, d);
      c.rgb += (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * 0.025;
      gl_FragColor = c;
    }`,
};

/** Spin a car's wheels with road speed; fronts also take a steer angle. */
function spinWheels(car: THREE.Object3D, speed: number, dt: number, steer = 0): void {
  const wheels = car.userData.wheels as THREE.Group[] | undefined;
  if (!wheels) return;
  const dRot = (speed / 0.36) * dt; // tire radius 0.36 m
  for (let i = 0; i < wheels.length; i++) {
    wheels[i].rotation.x += dRot;
    if (i < 2) wheels[i].rotation.y = steer;
  }
}

/** Soft white radial texture for the headlight splash on the asphalt. */
function headlightPoolTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(255,246,215,0.55)");
  g.addColorStop(0.5, "rgba(255,240,200,0.2)");
  g.addColorStop(1, "rgba(255,235,190,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Floating name banner above an online player's car. */
function makeNameTag(name: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.roundRect(8, 10, 240, 44, 12);
  ctx.fill();
  ctx.fillStyle = "#7ee8ff";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.slice(0, 16), 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
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
  private events: EngineEvents;

  // Player — spawns just past the start-line gantry
  private player = { s: 40, lat: LANES[1], speed: 0, sp: 100 };
  private playerMesh: THREE.Group;
  private carBody: THREE.Group;
  private headlight: THREE.SpotLight;

  private traffic: TrafficCar[] = [];
  private rival: Rival | null = null;
  private rivalIndex = 0;
  private inBattle = false;
  private locked = false; // input locked after defeat / championship

  // Online cruise
  private remotes = new Map<number, RemotePlayer>();

  // Lap timing
  private lapStartAt = 0;
  private lapDistance = 0;

  private bumpCooldown = 0;
  private scrapeCooldown = 0;
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
  private fpsEma = 60;
  private qualityLocked = false; // user took manual control with G
  private startedAt = 0;
  private moonDir = new THREE.Vector3(-300, 500, 200).normalize();

  // Scrape/bump sparks
  private sparks: THREE.Points;
  private sparkVel = new Float32Array(60 * 3);
  private sparkLife = 0;

  // Minimap
  private mapBounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };

  // Audio
  private sound: SoundEngine | null = null;
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
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(62, canvas.clientWidth / canvas.clientHeight, 0.5, 4000);

    this.buildEnvironment();
    this.world = buildWorld(this.scene, this.track);
    this.computeMapBounds();

    // Moonlight shadows: a compact ortho frustum that the loop keeps
    // centred on the player, so nearby cars, rails, and poles all throw
    // long moon shadows across the asphalt.
    const moon = this.world.moonLight;
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -80;
    moon.shadow.camera.right = 80;
    moon.shadow.camera.top = 80;
    moon.shadow.camera.bottom = -80;
    moon.shadow.camera.near = 50;
    moon.shadow.camera.far = 900;
    moon.shadow.bias = -0.0006;
    this.scene.add(moon.target);

    // Bloom makes the night work: lamps, taillights, cat-eyes and the
    // tower spheres all halo. Auto-disabled on weak machines (see loop).
    // MSAA render target: the renderer's antialias flag doesn't apply to
    // post-processing buffers, so without this every edge shimmers
    const bufSize = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(bufSize.x, bufSize.y, {
        samples: 4,
        type: THREE.HalfFloatType,
      })
    );
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      0.5,
      0.45,
      0.8
    );
    this.composer.addPass(this.bloomPass);
    this.grainPass = new ShaderPass(VignetteGrainShader);
    this.composer.addPass(this.grainPass);
    this.composer.addPass(new OutputPass());

    // Spark pool for scrapes and shunts
    {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
      this.sparks = new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          color: 0xffc46a,
          size: 0.14,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      this.sparks.visible = false;
      this.sparks.frustumCulled = false;
      this.scene.add(this.sparks);
    }

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
    this.carBody = createCar({ body: 0xf2f4f7, accent: 0x007a3d });
    this.playerMesh = new THREE.Group();
    this.playerMesh.add(this.carBody);
    this.scene.add(this.playerMesh);

    this.headlight = new THREE.SpotLight(0xfff2cc, 90, 90, 0.42, 0.45, 1.4);
    this.headlight.position.set(0, 1.1, 1.8);
    this.headlight.target.position.set(0, 0, 40);
    this.playerMesh.add(this.headlight, this.headlight.target);

    // Visible beam cones + a splash of light on the road ahead
    {
      const beamGeo = new THREE.ConeGeometry(1.5, 13, 12, 1, true);
      beamGeo.rotateX(-Math.PI / 2); // apex toward the car, opening forward
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xfff3cf,
        transparent: true,
        opacity: 0.045,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      for (const sx of [-0.7, 0.7]) {
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(sx, 0.8, 8.7);
        this.playerMesh.add(beam);
      }
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 17),
        new THREE.MeshBasicMaterial({
          map: headlightPoolTexture(),
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        })
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(0, 0.07, 10.5);
      this.playerMesh.add(pool);
    }

    this.spawnTraffic(22);

    this.rivalIndex = this.loadProgress();
    this.spawnRival();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /** A tiny HDR night scene baked into reflections: moonlight on car
   *  paint and a sodium-orange skyline streak on the damp asphalt. */
  private buildEnvironment(): void {
    const env = new THREE.Scene();
    env.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(50, 16, 8),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setRGB(0.04, 0.06, 0.13),
          side: THREE.BackSide,
        })
      )
    );
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(4, 8, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(6, 5.6, 4.4) })
    );
    moon.position.set(-30, 26, -10);
    env.add(moon);
    const skyline = new THREE.Mesh(
      new THREE.CylinderGeometry(40, 40, 3, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(1.1, 0.65, 0.22),
        side: THREE.BackSide,
      })
    );
    skyline.position.y = 3;
    env.add(skyline);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(env, 0.05).texture;
    pmrem.dispose();
  }

  // ---------------------------------------------------------------- public

  start(): void {
    try {
      this.sound = new SoundEngine();
      this.sound.revStart();
    } catch {
      this.sound = null;
    }
    this.clock.getDelta();
    this.lapStartAt = performance.now();
    this.startedAt = performance.now();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const raw = this.clock.getDelta();
      if (raw > 0) this.fpsEma = this.fpsEma * 0.95 + (1 / raw) * 0.05;
      this.autoQuality();
      const dt = Math.min(raw, 0.05);
      if (!this.paused) this.update(dt);
      // One pipeline for both quality modes keeps colour grading identical
      this.composer.render();
    };
    loop();
    const r = this.rival;
    if (r) {
      this.events.onMessage(
        `Find ${r.def.name} — ${r.def.arabicName}`,
        `${r.def.crew} · close in and press F to flash`
      );
      this.voice.speak("يلا! دور على خصمك"); // announcer: go find your rival
    } else if (this.rivalIndex >= RIVALS.length) {
      // Reloaded as a reigning champion — straight to the crown screen.
      // Deferred: the caller sets its "playing" state right after start().
      setTimeout(() => {
        if (!this.disposed) this.events.onChampion();
      }, 0);
    }
  }

  setPaused(p: boolean): void {
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Re-target the composer's multisample count (0 disables MSAA). */
  private setMsaa(samples: number): void {
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) {
        rt.samples = samples;
        rt.dispose(); // lazily recreated with the new sample count
      }
    }
  }

  /** Drop the expensive effects once it's clear the machine can't keep up. */
  private autoQuality(): void {
    if (this.qualityLocked || performance.now() - this.startedAt < 6000) return;
    this.qualityLocked = true;
    if (this.fpsEma < 32) {
      this.bloomPass.enabled = false;
      this.world.moonLight.castShadow = false;
      this.setMsaa(0);
      if (this.fpsEma < 18) {
        this.renderer.setPixelRatio(1);
        this.composer.setPixelRatio(1);
        this.resize();
      }
      this.events.onMessage("Performance mode", "Glow & shadows off — press G to toggle them back");
    }
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
    const mesh = createCar({ body: hex, underglow: hex });
    mesh.add(makeNameTag(name));
    mesh.visible = false; // until the first state snapshot lands
    this.scene.add(mesh);
    this.remotes.set(id, {
      mesh,
      s: 0,
      lat: 0,
      snapS: 0,
      snapLat: 0,
      snapSpeed: 0,
      snapAt: 0,
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
    this.scene.remove(r.mesh);
    this.remotes.delete(id);
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
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.sound?.dispose();
    this.voice.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- input

  private onKeyDown = (e: KeyboardEvent) => {
    // Any trusted gesture may be our only chance to un-suspend audio
    this.sound?.resume();
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    this.keys.add(k);
    if (k === "f") this.tryFlash();
    if (k === "m" && !e.repeat && this.sound) {
      const muted = this.sound.toggleMute();
      this.events.onMessage(muted ? "Sound off 🔇" : "Sound on 🔊");
    }
    if (k === "h" && !e.repeat) this.sound?.hornOn();
    if (k === "v" && !e.repeat) {
      const on = this.voice.toggle();
      this.events.onMessage(on ? "Voices on — الأصوات شغالة 🗣️" : "Voices off");
      if (on) this.voice.speak("الأصوات شغالة");
    }
    if (k === "g" && !e.repeat) {
      this.qualityLocked = true;
      this.bloomPass.enabled = !this.bloomPass.enabled;
      this.world.moonLight.castShadow = this.bloomPass.enabled;
      this.setMsaa(this.bloomPass.enabled ? 4 : 0);
      this.events.onMessage(
        this.bloomPass.enabled ? "Glow & shadows on ✨" : "Glow & shadows off"
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
    this.sound?.hornOff();
  };

  private get throttle(): number {
    if (this.locked) return 0;
    return this.keys.has("arrowup") || this.keys.has("w") ? 1 : 0;
  }
  private get brake(): number {
    if (this.locked) return 0;
    return this.keys.has("arrowdown") || this.keys.has("s") ? 1 : 0;
  }
  private get steer(): number {
    if (this.locked) return 0;
    let s = 0;
    if (this.keys.has("arrowleft") || this.keys.has("a")) s -= 1;
    if (this.keys.has("arrowright") || this.keys.has("d")) s += 1;
    return s;
  }

  // ---------------------------------------------------------------- spawning

  private spawnTraffic(count: number): void {
    for (let i = 0; i < count; i++) {
      const mesh = createCar({ body: TRAFFIC_COLORS[i % TRAFFIC_COLORS.length], simple: true });
      this.scene.add(mesh);
      this.traffic.push({
        mesh,
        s: this.track.wrap(120 + (i / count) * this.track.length),
        lat: LANES[i % LANES.length],
        speed: 21 + Math.random() * 9, // 75–108 km/h
      });
    }
  }

  private spawnRival(): void {
    if (this.rival) {
      this.scene.remove(this.rival.mesh);
      this.rival = null;
    }
    if (this.rivalIndex >= RIVALS.length) return;
    const def = RIVALS[this.rivalIndex];
    const mesh = createCar({
      body: def.bodyColor,
      accent: def.accentColor,
      underglow: def.accentColor,
    });
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
    };
  }

  // ---------------------------------------------------------------- battle

  private tryFlash(): void {
    const r = this.rival;
    if (!r || this.inBattle || this.locked || r.state !== "cruise") return;
    const gap = this.track.deltaAhead(this.player.s, r.s);
    if (gap < 2 || gap > FLASH_RANGE) return;

    this.inBattle = true;
    r.state = "battle";
    this.player.sp = 100;
    r.sp = 100;
    this.flashHeadlights();
    this.sound?.flashClick();
    this.sound?.battleSting();
    this.voice.speak(r.def.lines.intro, r.def.voice);
    if (this.events.onBattleStart) this.events.onBattleStart(r.def);
    else this.events.onMessage(`⚡ BATTLE — ${r.def.name} ${r.def.arabicName}`, `"${r.def.taunt}"`);
  }

  private flashHeadlights(): void {
    const base = this.headlight.intensity;
    let n = 0;
    const id = setInterval(() => {
      this.headlight.intensity = this.headlight.intensity > 1 ? 0 : base;
      if (++n >= 6) {
        clearInterval(id);
        this.headlight.intensity = base;
      }
    }, 90);
  }

  private winBattle(): void {
    const r = this.rival!;
    r.state = "defeated";
    this.inBattle = false;
    this.rivalIndex++;
    this.saveProgress();
    this.voice.speak(r.def.lines.lose, r.def.voice);
    if (this.rivalIndex >= RIVALS.length) {
      this.events.onMessage("👑 KING OF GULF ROAD", "كل الشوارع لك — every street is yours");
      this.sound?.championFanfare();
      this.locked = false;
      // Let the ghost concede before the announcer crowns you
      setTimeout(() => this.voice.speak("مبروك! إنت ملك شارع الخليج"), 3200);
      setTimeout(() => this.events.onChampion(), 1800);
    } else {
      this.sound?.winSting();
      this.events.onMessage(`VICTORY — ${r.def.name} defeated`, `${r.def.crew} bows out`);
      setTimeout(() => {
        if (this.disposed) return;
        this.spawnRival();
        const next = this.rival;
        if (next) {
          this.events.onMessage(
            `Next: ${next.def.name} — ${next.def.arabicName}`,
            `${next.def.crew} · flash (F) to battle`
          );
        }
      }, 2600);
    }
  }

  private loseBattle(): void {
    const r = this.rival!;
    r.state = "cruise";
    this.inBattle = false;
    this.locked = true;
    this.sound?.loseSting();
    this.voice.speak(r.def.lines.win, r.def.voice);
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
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    this.scrapeCooldown = Math.max(0, this.scrapeCooldown - dt);

    this.updatePlayer(dt);
    this.updateTraffic(dt);
    this.updateRival(dt);
    this.updateRemotes(dt);
    if (this.inBattle) this.updateBattle(dt);
    this.updateCamera(dt);
    this.updateStreaks();
    this.updateAudio();
    this.world.tick(dt);
    this.updateEffects(dt);
    this.emitHud();
  }

  private updatePlayer(dt: number): void {
    const p = this.player;

    // Accel/drag equilibrium sits at ~92 m/s (≈330 km/h) — keep it above
    // every rival's chase speed or late battles become unwinnable.
    const accel = this.throttle * Math.max(0, 19 * (1 - p.speed / 115));
    const braking = this.brake * 26;
    const drag = 0.0012 * p.speed * p.speed + 1.2;
    p.speed = Math.max(0, p.speed + (accel - braking - drag * (this.throttle ? 0.35 : 1)) * dt);

    // --- Steering: the car carries a heading relative to the lane.
    // Yaw authority is grip-limited, so it shrinks as speed rises.
    this.steerSmooth += (this.steer - this.steerSmooth) * Math.min(1, dt * 7);
    const yawRateMax = Math.min(1.6, 12 / Math.max(p.speed, 2)); // a_lat ≈ 12 m/s²
    this.heading += this.steerSmooth * yawRateMax * dt;
    // Caster self-centering when the wheel is released
    if (Math.abs(this.steer) < 0.1) {
      this.heading -= this.heading * Math.min(1, dt * 2.4);
    }
    this.heading = THREE.MathUtils.clamp(this.heading, -0.45, 0.45);

    // --- Centrifugal push: sweepers shove the car toward the outside,
    // demanding counter-steer at speed.
    this.track.tangentAt(p.s, this.v1);
    this.track.tangentAt(p.s + 8, this.v2);
    const crossY = this.v1.z * this.v2.x - this.v1.x * this.v2.z;
    const curvature = -Math.asin(THREE.MathUtils.clamp(crossY, -1, 1)) / 8;
    const pushAccel = THREE.MathUtils.clamp(curvature * p.speed * p.speed * 0.22, -8, 8);
    this.slipVel += (pushAccel - this.slipVel * 2.5) * dt;
    this.curvature = curvature;

    p.lat += (Math.sin(this.heading) * p.speed + this.slipVel) * dt;

    const maxLat = ROAD_HALF_WIDTH - 1.1;
    if (Math.abs(p.lat) > maxLat) {
      p.lat = THREE.MathUtils.clamp(p.lat, -maxLat, maxLat);
      this.heading *= 0.15;
      this.slipVel *= 0.2;
      p.speed *= 1 - 0.9 * dt;
      if (this.scrapeCooldown <= 0) {
        this.scrapeCooldown = 0.5;
        this.events.onBump();
        this.spawnSparks();
        this.sound?.scrape();
        this.shake = Math.max(this.shake, 0.55);
        if (this.inBattle) p.sp = Math.max(0, p.sp - 4);
      }
    }

    // Lap timing: a lap counts when the start line is crossed after
    // covering (almost) the full circuit since the previous crossing.
    this.lapDistance += p.speed * dt;
    const unwrapped = p.s + p.speed * dt;
    if (unwrapped >= this.track.length) {
      const now = performance.now();
      if (this.lapDistance >= this.track.length * 0.995) {
        this.events.onLap?.(now - this.lapStartAt);
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
    this.carBody.rotation.y = -this.heading * 0.85;
    this.carBody.rotation.z = this.heading * 0.06;
    const pitchTarget = this.brake * 0.035 * Math.min(1, p.speed / 20) - this.throttle * 0.014;
    this.pitch += (pitchTarget - this.pitch) * Math.min(1, dt * 6);
    this.carBody.rotation.x = this.pitch;
    spinWheels(this.carBody, p.speed, dt, -this.steerSmooth * 0.3);
    (this.carBody.userData.tailMat as THREE.MeshStandardMaterial).emissiveIntensity = this.brake
      ? 7
      : 2;

    // Traffic collisions
    if (this.bumpCooldown <= 0) {
      for (const t of this.traffic) {
        const ds = this.track.deltaAhead(p.s, t.s);
        if (Math.abs(ds) < 4.2 && Math.abs(t.lat - p.lat) < 2.0) {
          this.bumpCooldown = 1;
          p.speed = Math.min(p.speed * 0.55, t.speed * 0.9);
          // Knock the player out of the hitbox, or the cooldown re-bumps
          // forever and glues them to the traffic car's tail.
          if (ds >= 0) p.s = this.track.wrap(t.s - 4.5);
          this.events.onBump();
          this.spawnSparks();
          this.sound?.bump();
          this.shake = 1;
          if (this.inBattle) p.sp = Math.max(0, p.sp - 8);
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
  }

  private updateRival(dt: number): void {
    const r = this.rival;
    if (!r) return;

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
    }
  }

  private updateBattle(dt: number): void {
    const r = this.rival!;
    const gap = this.track.deltaAhead(this.player.s, r.s); // >0 → rival ahead

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

    if (r.sp <= 0) this.winBattle();
    else if (this.player.sp <= 0) this.loseBattle();
  }

  private updateCamera(dt: number): void {
    const p = this.player;
    this.track.pose(p.s, p.lat, this.v1, this.v2);
    this.track.tangentAt(p.s, this.v3);

    // Chase position pulls back and rises with speed
    const dist = 9.5 + p.speed * 0.02;
    this.v4
      .copy(this.v1)
      .addScaledVector(this.v3, -dist)
      .add(this.v2.set(0, 3.4 + p.speed * 0.014, 0));
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
    const amp = Math.pow(p.speed / PLAYER_TOP_SPEED, 3) * 0.055 + this.shake * 0.32;
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
      THREE.MathUtils.clamp(this.heading * (p.speed / PLAYER_TOP_SPEED), -0.5, 0.5) * 0.14 +
      THREE.MathUtils.clamp(this.slipVel * 0.012, -0.03, 0.03);
    this.camRoll += (rollTarget - this.camRoll) * Math.min(1, dt * 4);
    this.camera.rotateZ(this.camRoll + Math.sin(t * 23.7) * this.shake * 0.02);

    // FOV: speed stretch + a launch kick under throttle from low speed
    const launchKick = this.throttle * THREE.MathUtils.clamp(1 - p.speed / 40, 0, 1) * 5;
    const targetFov = 62 + (p.speed / PLAYER_TOP_SPEED) * 18 + launchKick;
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, dt * 3);
    this.camera.fov = this.fovCurrent;
    this.camera.updateProjectionMatrix();
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
    // Keep the moon's shadow frustum centred on the player
    const moon = this.world.moonLight;
    moon.position.copy(this.playerMesh.position).addScaledVector(this.moonDir, 400);
    moon.target.position.copy(this.playerMesh.position);

    this.grainPass.uniforms.uTime.value = (performance.now() / 1000) % 100;

    if (this.sparkLife > 0) {
      this.sparkLife = Math.max(0, this.sparkLife - dt);
      const pos = this.sparks.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
          i,
          pos.getX(i) + this.sparkVel[i * 3] * dt,
          Math.max(0.02, pos.getY(i) + this.sparkVel[i * 3 + 1] * dt),
          pos.getZ(i) + this.sparkVel[i * 3 + 2] * dt
        );
        this.sparkVel[i * 3 + 1] -= 18 * dt;
      }
      pos.needsUpdate = true;
      (this.sparks.material as THREE.PointsMaterial).opacity = this.sparkLife / 0.6;
      this.sparks.visible = true;
    } else {
      this.sparks.visible = false;
    }
  }

  /** Burst of sparks at the car — wall scrapes and traffic shunts. */
  private spawnSparks(): void {
    this.sparkLife = 0.6;
    const pos = this.sparks.geometry.getAttribute("position") as THREE.BufferAttribute;
    const p = this.playerMesh.position;
    this.track.tangentAt(this.player.s, this.v3);
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, p.x + (Math.random() - 0.5), 0.3 + Math.random() * 0.4, p.z + (Math.random() - 0.5));
      const back = -(6 + Math.random() * 10);
      this.sparkVel[i * 3] = this.v3.x * back + (Math.random() - 0.5) * 6;
      this.sparkVel[i * 3 + 1] = 2 + Math.random() * 5;
      this.sparkVel[i * 3 + 2] = this.v3.z * back + (Math.random() - 0.5) * 6;
    }
    pos.needsUpdate = true;
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
    // Tires complain when the heading fights the lane at speed
    const skid = Math.max(
      0,
      Math.abs(this.heading) * (speedKmh / 140) + Math.abs(this.slipVel) * 0.12 - 0.22
    );
    this.sound.update({
      speedKmh,
      throttle: this.throttle,
      rpmFrac,
      gear: speedKmh < 2 ? 0 : gear + 1,
      skid,
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
      canFlash = !this.inBattle && gap >= 2 && gap <= FLASH_RANGE;
      this.track.pointAt(r.s, this.v1);
      const [rx, ry] = this.toMap(this.v1.x, this.v1.z);
      map = { px, py, rx, ry };
    } else {
      map = { px, py, rx: -1, ry: -1 };
    }

    this.events.onHud({
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
    });
  }
}
