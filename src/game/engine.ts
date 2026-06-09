import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Track, ROAD_HALF_WIDTH, LANES } from "./track";
import { buildWorld, areaAt, WorldHandle } from "./world";
import { createCar } from "./cars";
import { RIVALS, RivalDef } from "./rivals";

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
  private steerVel = 0;
  private fovCurrent = 62;
  private camInit = false;

  // Rendering quality
  private world: WorldHandle;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private fpsEma = 60;
  private qualityLocked = false; // user took manual control with G
  private startedAt = 0;

  // Minimap
  private mapBounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };

  // Audio
  private audioCtx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private muted = false;

  // scratch
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private v4 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, events: EngineEvents) {
    this.events = events;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.camera = new THREE.PerspectiveCamera(62, canvas.clientWidth / canvas.clientHeight, 0.5, 4000);

    this.buildEnvironment();
    this.world = buildWorld(this.scene, this.track);
    this.computeMapBounds();

    // Bloom makes the night work: lamps, taillights, cat-eyes and the
    // tower spheres all halo. Auto-disabled on weak machines (see loop).
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      0.5,
      0.45,
      0.8
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    // Player car — Kuwait flag colours: white body, green stripe
    this.carBody = createCar({ body: 0xf2f4f7, accent: 0x007a3d });
    this.playerMesh = new THREE.Group();
    this.playerMesh.add(this.carBody);
    this.scene.add(this.playerMesh);

    this.headlight = new THREE.SpotLight(0xfff2cc, 90, 90, 0.42, 0.45, 1.4);
    this.headlight.position.set(0, 1.1, 1.8);
    this.headlight.target.position.set(0, 0, 40);
    this.playerMesh.add(this.headlight, this.headlight.target);

    this.spawnTraffic(22);

    this.rivalIndex = this.loadProgress();
    this.spawnRival();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
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
    this.initAudio();
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
    if (this.engineGain) {
      this.engineGain.gain.value = p || this.muted ? 0 : 0.035;
    }
  }

  resize(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Drop the expensive effects once it's clear the machine can't keep up. */
  private autoQuality(): void {
    if (this.qualityLocked || performance.now() - this.startedAt < 6000) return;
    this.qualityLocked = true;
    if (this.fpsEma < 32) {
      this.bloomPass.enabled = false;
      if (this.fpsEma < 18) {
        this.renderer.setPixelRatio(1);
        this.composer.setPixelRatio(1);
        this.resize();
      }
      this.events.onMessage("Performance mode", "Glow effects off — press G to toggle them back");
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
    const mesh = createCar({ body: new THREE.Color(color).getHex() });
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
    this.audioCtx?.close().catch(() => {});
    this.composer.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- input

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    this.keys.add(k);
    if (k === "f") this.tryFlash();
    if (k === "m") this.toggleMute();
    if (k === "g") {
      this.qualityLocked = true;
      this.bloomPass.enabled = !this.bloomPass.enabled;
      this.events.onMessage(this.bloomPass.enabled ? "Glow effects on ✨" : "Glow effects off");
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
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

  // ---------------------------------------------------------------- audio

  private initAudio(): void {
    if (this.audioCtx) return;
    try {
      this.audioCtx = new AudioContext();
      this.engineOsc = this.audioCtx.createOscillator();
      this.engineOsc.type = "sawtooth";
      const filter = this.audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 420;
      this.engineGain = this.audioCtx.createGain();
      this.engineGain.gain.value = 0.035;
      this.engineOsc.connect(filter).connect(this.engineGain).connect(this.audioCtx.destination);
      this.engineOsc.start();
    } catch {
      this.audioCtx = null;
    }
  }

  private toggleMute(): void {
    this.muted = !this.muted;
    if (this.engineGain) this.engineGain.gain.value = this.muted ? 0 : 0.035;
  }

  // ---------------------------------------------------------------- spawning

  private spawnTraffic(count: number): void {
    for (let i = 0; i < count; i++) {
      const mesh = createCar({ body: TRAFFIC_COLORS[i % TRAFFIC_COLORS.length] });
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
    const mesh = createCar({ body: def.bodyColor, accent: def.accentColor });
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
    this.events.onMessage(`⚡ BATTLE — ${r.def.name} ${r.def.arabicName}`, `"${r.def.taunt}"`);
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
    if (this.rivalIndex >= RIVALS.length) {
      this.events.onMessage("👑 KING OF GULF ROAD", "كل الشوارع لك — every street is yours");
      this.locked = false;
      setTimeout(() => this.events.onChampion(), 1800);
    } else {
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
    this.updateAudio();
    this.world.tick(dt);
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

    const steerSpeed = Math.min(3.5 + p.speed * 0.09, 11);
    const target = this.steer * steerSpeed * (p.speed > 1 ? 1 : 0);
    this.steerVel += (target - this.steerVel) * Math.min(1, dt * 9);
    p.lat += this.steerVel * dt;

    const maxLat = ROAD_HALF_WIDTH - 1.1;
    if (Math.abs(p.lat) > maxLat) {
      p.lat = THREE.MathUtils.clamp(p.lat, -maxLat, maxLat);
      this.steerVel *= 0.3;
      p.speed *= 1 - 0.9 * dt;
      if (this.scrapeCooldown <= 0) {
        this.scrapeCooldown = 0.5;
        this.events.onBump();
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
    this.carBody.rotation.y = -this.steerVel * 0.022;
    this.carBody.rotation.z = this.steerVel * 0.012;

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

    this.v4
      .copy(this.v1)
      .addScaledVector(this.v3, -9.5)
      .add(this.v2.set(0, 3.4 + p.speed * 0.012, 0));
    if (!this.camInit) {
      this.camInit = true;
      this.camera.position.copy(this.v4);
    } else {
      this.camera.position.lerp(this.v4, Math.min(1, dt * 5.5));
    }

    this.v4.copy(this.v1).addScaledVector(this.v3, 14);
    this.v4.y += 1.4;
    this.camera.lookAt(this.v4);

    const targetFov = 62 + (p.speed / PLAYER_TOP_SPEED) * 18;
    this.fovCurrent += (targetFov - this.fovCurrent) * Math.min(1, dt * 3);
    this.camera.fov = this.fovCurrent;
    this.camera.updateProjectionMatrix();
  }

  private updateAudio(): void {
    if (!this.engineOsc || !this.audioCtx) return;
    const f = 65 + this.player.speed * 2.1 + this.throttle * 18;
    this.engineOsc.frequency.setTargetAtTime(f, this.audioCtx.currentTime, 0.05);
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
