import * as THREE from "three";

// Particles, done properly.
//
// THREE.PointsMaterial has one size and one opacity for the whole pool,
// so every puff of a drift is born and dies at the same instant, the
// same size, facing the same way. That reads as a flickering sheet
// rather than smoke. This module gives each particle its own age, life,
// size and seed, and does the work a particle shader should:
//
//   • alpha fades in fast and out slowly over that particle's own life
//   • size grows with age (smoke expands; sparks do not)
//   • the sprite spins by a per-particle seed, so no two are identical
//   • colour ramps across life — sparks go white-hot → orange → ember
//
// Positions are still integrated on the CPU. At a couple of hundred
// particles that costs nothing, and it keeps collision (sparks bouncing
// off the asphalt) in ordinary readable code.

/** Soft radial sprite. `core` is how much of the disc stays at full
 *  brightness before the falloff starts. */
export function radialSprite(core = 0.12, gamma = 1): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = (x - 31.5) / 31.5;
      const dy = (y - 31.5) / 31.5;
      const d = Math.hypot(dx, dy);
      // Smoothstep rather than a linear ramp: a linear falloff still has
      // slope where it reaches zero, and that shows up as a visible rim
      // on every sprite once a few of them overlap.
      const t = d <= core ? 1 : Math.max(0, 1 - (d - core) / (1 - core));
      const a = Math.pow(t * t * (3 - 2 * t), gamma);
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface ParticleOptions {
  map: THREE.Texture;
  /** Colour at birth and at death — the ramp across each life. */
  colorA: THREE.ColorRepresentation;
  colorB: THREE.ColorRepresentation;
  blending?: THREE.Blending;
  /** Size multiplier at the end of life (1 = no growth). */
  grow?: number;
  /** Sprite spin in turns per life. 0 keeps them still. */
  spin?: number;
  opacity?: number;
  /** Fraction of life spent fading in. */
  fadeIn?: number;
}

export class ParticleSystem {
  readonly points: THREE.Points;
  private pos: THREE.BufferAttribute;
  private age: THREE.BufferAttribute;
  private life: THREE.BufferAttribute;
  private size: THREE.BufferAttribute;
  private vel: Float32Array;
  private head = 0;
  private live = 0;
  private readonly count: number;

  constructor(count: number, o: ParticleOptions) {
    this.count = count;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3).fill(-99999);
    this.pos = new THREE.BufferAttribute(positions, 3);
    this.age = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.life = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.size = new THREE.BufferAttribute(new Float32Array(count), 1);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = Math.random();
    geo.setAttribute("position", this.pos);
    geo.setAttribute("aAge", this.age);
    geo.setAttribute("aLife", this.life);
    geo.setAttribute("aSize", this.size);
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.vel = new Float32Array(count * 3);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: o.map },
        uColorA: { value: new THREE.Color(o.colorA) },
        uColorB: { value: new THREE.Color(o.colorB) },
        uGrow: { value: (o.grow ?? 1) - 1 },
        uSpin: { value: o.spin ?? 0 },
        uOpacity: { value: o.opacity ?? 1 },
        uFadeIn: { value: o.fadeIn ?? 0.12 },
        // Point size is in pixels, so it has to scale with the drawing
        // buffer or particles shrink on a 4K panel.
        uScale: { value: 300 },
      },
      vertexShader: /* glsl */ `
        attribute float aAge;
        attribute float aLife;
        attribute float aSize;
        attribute float aSeed;
        uniform float uGrow;
        uniform float uScale;
        varying float vT;
        varying float vSeed;
        void main() {
          vT = aLife > 0.0 ? clamp(aAge / aLife, 0.0, 1.0) : 2.0;
          vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (1.0 + uGrow * vT) * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uSpin;
        uniform float uOpacity;
        uniform float uFadeIn;
        varying float vT;
        varying float vSeed;
        void main() {
          if (vT >= 1.0) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float ang = uSpin * 6.2831853 * (vSeed + vT);
          float c = cos(ang), s = sin(ang);
          uv = mat2(c, -s, s, c) * uv + 0.5;
          vec4 tex = texture2D(uMap, uv);
          // Fade in over the first slice of life, then out to nothing
          float a = smoothstep(0.0, uFadeIn, vT) * (1.0 - vT) * (1.0 - vT);
          vec3 col = mix(uColorA, uColorB, vT);
          gl_FragColor = vec4(col, tex.a * a * uOpacity);
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: o.blending ?? THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  get material(): THREE.ShaderMaterial {
    return this.points.material as THREE.ShaderMaterial;
  }

  /** Point size is expressed in pixels; without this a particle is half
   *  the apparent size on a display with twice the pixel ratio. */
  setPixelScale(drawingBufferHeight: number): void {
    this.material.uniforms.uScale.value = drawingBufferHeight * 0.42;
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.count;
    this.pos.setXYZ(i, x, y, z);
    this.age.setX(i, 0);
    this.life.setX(i, life);
    this.size.setX(i, size);
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.live++;
  }

  /**
   * Integrate. `bounce` reflects a particle off the road surface with
   * that much energy kept — sparks skittering along the asphalt are
   * most of what sells a wall scrape.
   */
  update(
    dt: number,
    opts: { gravity?: number; drag?: number; bounce?: number; groundY?: number } = {}
  ): void {
    const gravity = opts.gravity ?? 0;
    const drag = opts.drag ?? 0;
    const bounce = opts.bounce ?? 0;
    const groundY = opts.groundY ?? 0.02;
    let any = false;
    const damp = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < this.count; i++) {
      const life = this.life.getX(i);
      if (life <= 0) continue;
      const age = this.age.getX(i) + dt;
      if (age >= life) {
        this.life.setX(i, 0);
        this.pos.setXYZ(i, -99999, -99999, -99999);
        this.live = Math.max(0, this.live - 1);
        continue;
      }
      this.age.setX(i, age);
      const b = i * 3;
      this.vel[b] *= damp;
      this.vel[b + 1] = this.vel[b + 1] * damp - gravity * dt;
      this.vel[b + 2] *= damp;
      let x = this.pos.getX(i) + this.vel[b] * dt;
      let y = this.pos.getY(i) + this.vel[b + 1] * dt;
      let z = this.pos.getZ(i) + this.vel[b + 2] * dt;
      if (bounce > 0 && y < groundY && this.vel[b + 1] < 0) {
        y = groundY;
        this.vel[b + 1] = -this.vel[b + 1] * bounce;
        this.vel[b] *= 0.7;
        this.vel[b + 2] *= 0.7;
      }
      this.pos.setXYZ(i, x, y, z);
      any = true;
    }
    this.pos.needsUpdate = true;
    this.age.needsUpdate = true;
    this.life.needsUpdate = true;
    this.size.needsUpdate = true;
    this.points.visible = any;
  }

  /** Live particle count — for tests and debug readouts. */
  get alive(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.life.getX(i) > 0) n++;
    return n;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
