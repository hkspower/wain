import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

// The grade — the last thing that happens to a frame, and most of what
// separates a render from a photograph.
//
// Three controls, in the order a colourist would reach for them:
//
//   Exposure    how much light the camera let in. Applied BEFORE tone
//               mapping, because that is where exposure physically acts;
//               brightening a tone-mapped image instead just washes it
//               out. Metered from the scene when auto is on.
//   Contrast    a gamma about a mid-grey pivot, so the pivot holds still
//               and the ends move — darks fall away, brights lift, and
//               the exposure of the subject does not drift as you turn
//               it up.
//   Highlights  what happens to everything above the shoulder: how much
//               is there at all, how hard the roll into white is, and
//               how fast colour bleeds out of it. Real sensors
//               desaturate as they clip, which is why a bright lamp
//               reads as light rather than as coloured paint.

export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    /** Everything below this maps to true zero. Display-referred, so this
     *  is a literal lift-kill rather than an HDR-space guess.
     *
     *  It was 0.02 — five 8-bit steps — which is more than a night sky
     *  is worth. Measured: the zenith arrives here at 0.017 after the
     *  toe, so the subtraction took the entire upper sky to exactly zero
     *  and 63-68% of every sky pixel with it. The lift this exists to
     *  kill is the grain and the dither, and both are already an 8-bit
     *  step or less, so it only needs to be about that big. */
    uBlackPoint: { value: 0.006 },
    /** Shadow toe: >1 pushes the darks down without touching highlights. */
    uToe: { value: 1.06 },
    /**
     * Shadow lift — a gamma, but only where the picture is already dark.
     *
     * Below 1 this raises what it touches. Applied through the same
     * weight as uLift below, so it fades out by uLiftRange and daylight
     * never sees it at all.
     *
     * Both of those properties were learned the hard way. A flat OFFSET
     * lift broke the exposure ladder outright: as exposure came down the
     * lift grew to fill in exactly what had been removed, and the frame
     * stopped darkening. Replacing it with a GLOBAL gamma broke it
     * again, in the other regime — a daylight frame sits up on the
     * filmic shoulder, and a gamma of 0.84 there compresses the whole
     * upper range toward white and flattens the response to a stop.
     * Measured on a night frame the same gamma was perfectly healthy:
     * -15% for a stop down, +112% for a stop up.
     *
     * So it is proportional (black still maps to black, and the mapping
     * is strictly increasing, which is what keeps exposure working) and
     * it is confined to the shadows (which is where the missing picture
     * was).
     */
    uShadowLift: { value: 0.8 },
    /**
     * Lift — light grey poured into the floor.
     *
     * The game reads too dark: measured at 22:30 on the corniche, 37.6%
     * of every road pixel sat at 2/255 or below, which is not shadow, it
     * is missing picture. This is the control that fixes that, and it is
     * display-referred like everything else here, so 0.03 puts the
     * darkest pixel at about 8/255.
     *
     * It is deliberately NOT a flat offset. A constant added everywhere
     * is what makes a night scene look milky — the same reason the grain
     * above is scaled by luminance rather than added flat. This one
     * fades out by uLiftRange, so it fills the dead shadows and leaves
     * the midtones and every light in the frame exactly where they were.
     *
     * Small on purpose. The proportional work is done by uToe above;
     * this exists only to put a floor under the literal blacks, which a
     * gamma cannot do because it maps zero to zero. At 0.008 that floor
     * is about two 8-bit steps — enough that nothing in the frame is
     * dead, little enough that it cannot argue with the exposure.
     */
    uLift: { value: 0.008 },
    /**
     * How much of a night this is, 0..1 — driven from the sun's altitude
     * by applyDaylight(), and the master switch on both lifts above.
     *
     * The lift exists to rescue a NIGHT frame, and a daylight frame not
     * only does not need it but cannot afford it: sitting up on the
     * filmic shoulder, daylight has almost no downward exposure response
     * left (measured -1% to -3% for a whole stop), so a lift that grows
     * as the frame dims is enough to reverse it outright. It did: a stop
     * DOWN came back 6% brighter, which is an exposure control that has
     * stopped being one.
     *
     * Gating on the sun rather than on the metered frame luminance on
     * purpose. Auto-exposure is a GPU feedback loop; hanging a look
     * control off its output makes the look part of the loop.
     */
    uNight: { value: 1 },
    /** Luma at which the lift has faded to nothing. */
    uLiftRange: { value: 0.3 },
    /** Where the highlight shoulder starts. Below this nothing changes,
     *  so midtones and the scene's colour intent are untouched. */
    uKnee: { value: 0.86 },
    /** Gamma about the pivot. 1 = untouched. */
    uContrast: { value: 1.0 },
    /**
     * The grey that does not move when contrast changes.
     *
     * 0.42 — a photographic mid-grey — and wrong for this game, which is
     * a game about night. Measured on the corniche at 22:30 the median
     * pixel is 20/255 and the 95th percentile is 87, so a pivot at 107
     * sat above almost the entire picture: every real pixel was on the
     * darkening side of the curve and the contrast slider was a
     * brightness slider pointing the wrong way.
     *
     * 0.22 is where this picture's upper midtones actually are — the
     * lit road, a lamp's falloff, a wall catching sodium — so turning
     * contrast up now deepens the shadows AND opens the lights, which
     * is what the control is for.
     */
    uPivot: { value: 0.22 },
    /** -1 recovers highlights, +1 pushes them. 0 = untouched. */
    uHighlights: { value: 0.0 },
    /** How completely the top end bleeds to white as it clips. */
    uHighlightDesat: { value: 0.55 },
    /** Where that bleed starts. Ramping only from the shoulder makes it
     *  a no-op: by then the pixel is nearly white and has little colour
     *  left to lose. A real sensor starts desaturating well before it
     *  clips, which is why the core of a lamp is white and its falloff
     *  carries the hue. */
    uDesatStart: { value: 0.55 },
    /** Global saturation. 1 leaves the picture as graded; the shipped
     *  look sits a little above neutral, and the slider spans a washed
     *  0.6 to an oversaturated 1.4. */
    uSaturation: { value: 1.0 },
    /** Colour balance, as a per-channel gain. 1,1,1 is neutral.
     *
     *  This is what the situation grade steers: cool and hard for a
     *  battle, warm for a win, drained for a loss. It is a gain rather
     *  than a mix so it behaves like a white balance — it moves the
     *  whole picture's colour without touching what is neutral about a
     *  headlight. The engine normalises whatever it sets against its own
     *  luma, so a tint changes the colour of the frame and not its
     *  exposure. */
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    /** Dither amplitude in 8-bit steps. 0 disables it (A/B testing). */
    uDither: { value: 1.0 },
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
    uniform float uBlackPoint;
    uniform float uToe;
    uniform float uLift;
    uniform float uLiftRange;
    uniform float uShadowLift;
    uniform float uNight;
    uniform float uKnee;
    uniform float uContrast;
    uniform float uPivot;
    uniform float uHighlights;
    uniform float uHighlightDesat;
    uniform float uDesatStart;
    uniform float uSaturation;
    uniform vec3 uTint;
    uniform float uDither;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 13.0) * 43758.5453);
    }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
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
      // Vignette. This was 0.38 — the corners delivered at 62% of what
      // was rendered there, which on a night frame is most of a stop and
      // a real part of why the game reads dark.
      c.rgb *= 1.0 - 0.26 * smoothstep(0.38, 0.85, d);

      // Grain scaled by luminance. A flat +/- offset lifts every black
      // pixel off zero and is what makes a night scene look milky; real
      // film grain lives in the midtones and dies out in the shadows.
      float l0 = luma(c.rgb);
      float grainAmt = 0.02 * sqrt(clamp(l0, 0.0, 1.0));
      c.rgb += (hash(vUv * vec2(1920.0, 1080.0)) - 0.5) * grainAmt;

      // Shadow toe, then crush the remaining lift to true black and
      // rescale so highlights keep their range.
      c.rgb = pow(max(c.rgb, 0.0), vec3(uToe));
      c.rgb = max(c.rgb - uBlackPoint, 0.0) / max(1.0 - uBlackPoint, 1e-4);

      // Colour balance, before contrast and the shoulder, which is where
      // a colourist puts it: everything downstream then works on the
      // balanced picture rather than arguing with it. After the black
      // point, so a tint cannot lift a black off zero.
      c.rgb *= uTint;

      // The lift, after the tint so the grey it pours in stays grey: a
      // battle's cool balance should change the colour of the picture,
      // not the colour of its floor.
      //
      // One weight drives both halves: full in the blacks, nothing by
      // uLiftRange, so everything below is opened up and everything a
      // headlight has already lit is left exactly where it was.
      float lLift = luma(c.rgb);
      float wLift = (1.0 - smoothstep(0.0, max(uLiftRange, 1e-4), lLift)) * uNight;
      // Proportional first — this is the part that does the work.
      c.rgb = mix(c.rgb, pow(max(c.rgb, 0.0), vec3(uShadowLift)), wLift);
      // Then a floor under the literal blacks, which a gamma cannot give
      // because it maps zero to zero.
      c.rgb += uLift * wLift;

      // Contrast as an S-curve about a pivot, not a one-sided gamma.
      //
      // It was p * (c/p)^k, which holds the pivot and never clips — but
      // it only ever darkens what is below the pivot, and above it the
      // curve runs away past 1.0 and lands on the knee. With the pivot
      // where it was, that made "more contrast" mean "darker": measured
      // on a night frame the median pixel sits at 20/255 and the pivot
      // was at 107, so ninety-five per cent of the picture was on the
      // darkening side of the curve and turning the knob up took the
      // standard deviation DOWN.
      //
      // Mirrored, it is a real S: the same gamma below the pivot and its
      // reflection above, so 0 maps to 0, 1 maps to 1, the pivot holds,
      // and the slope through the middle is what the knob controls. Both
      // ends are safe by construction rather than by the knee catching
      // an overshoot.
      {
        vec3 lo = uPivot * pow(max(c.rgb / uPivot, 1e-5), vec3(uContrast));
        vec3 hi = 1.0 - (1.0 - uPivot) *
          pow(max((1.0 - c.rgb) / (1.0 - uPivot), 1e-5), vec3(uContrast));
        c.rgb = mix(lo, hi, step(uPivot, c.rgb));
      }

      // Highlights: how much there is above the shoulder, then the
      // shoulder itself. Two things push pixels past 1.0 here — the
      // black-point rescale multiplies everything by 1/(1-bp), and the
      // unsharp mask overshoots hard at bright edges (a headlamp against
      // dark asphalt is the worst case). Clamping flat blows those to
      // paper white AND bends their colour, because whichever channel
      // reaches 1.0 first stops while the others keep climbing. This
      // compresses asymptotically instead: uKnee maps to itself and
      // everything above approaches 1.0 without reaching it.
      vec3 over = max(c.rgb - uKnee, 0.0) * (1.0 + uHighlights * 0.6);
      c.rgb = min(c.rgb, uKnee) + (1.0 - uKnee) * (over / (over + (1.0 - uKnee)));

      // Highlight desaturation. A sensor's channels clip one at a time,
      // so a bright coloured source loses its colour as it saturates —
      // which is why the core of a real lamp photographs white and only
      // its falloff carries the hue. Without this the brightest pixels
      // stay fully saturated and read as luminous paint.
      float l1 = luma(c.rgb);
      float t = smoothstep(uDesatStart, 1.0, l1);
      c.rgb = mix(c.rgb, vec3(l1), t * uHighlightDesat);

      // Global saturation, after the highlight desaturation and before
      // the dither. Done as a mix toward the pixel's own luminance
      // rather than in HSV: converting to HSV and scaling S shifts hue
      // on anything near a primary, and a night scene is mostly sodium
      // orange and neon cyan, which are exactly the cases that shift.
      // Rec.709 luma weights, so the grey it collapses toward is the
      // grey the eye agrees is the same brightness.
      float lg = luma(c.rgb);
      c.rgb = max(mix(vec3(lg), c.rgb, uSaturation), 0.0);

      // Triangular-PDF dither, applied last, immediately before the 8-bit
      // quantisation it exists to hide. The frame buffer is half-float all
      // the way here, but the display is 8-bit, and a slow gradient across
      // a dark sky quantises into wide flat bands with visible contour
      // edges. Two summed uniform randoms give a triangular distribution,
      // which decorrelates the quantisation error from the signal rather
      // than merely masking it. Amplitude is one 8-bit step with zero
      // mean, so blacks stay black.
      float d1 = hash(vUv + vec2(0.11, 0.37));
      float d2 = hash(vUv + vec2(0.73, 0.19));
      c.rgb += (d1 + d2 - 1.0) * uDither / 255.0;

      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

/** Averages the HDR frame down to an 8x8 log-luminance buffer. */
const DownsampleShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uCell: { value: new THREE.Vector2(1 / 8, 1 / 8) },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uCell;
    varying vec2 vUv;
    void main() {
      // 16 taps across this texel's slice of the screen. At 8x8 that is
      // 1024 samples of the frame — far more than metering needs, in one
      // cheap draw.
      float sum = 0.0;
      for (int y = 0; y < 4; y++) {
        for (int x = 0; x < 4; x++) {
          vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * uCell / 4.0 - uCell * 0.5;
          vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          // Log average is the geometric mean, so one bright lamp cannot
          // drag the whole exposure the way an arithmetic mean would.
          sum += log2(max(l, 0.0002));
        }
      }
      gl_FragColor = vec4(sum / 16.0, 0.0, 0.0, 1.0);
    }`,
};

/** Adapts last frame's exposure toward what the meter is asking for. */
const AdaptShader = {
  uniforms: {
    tLum: { value: null as THREE.Texture | null },
    tPrev: { value: null as THREE.Texture | null },
    uDt: { value: 1 / 60 },
    // Calibrated against the game rather than against a textbook. A
    // generic key of 0.115 is right for a scene that fills its range,
    // but this one is a night racer: metered at ~0.015 it asked for the
    // full 2.4x, which lifted midnight a stop above the look the game
    // ships with and bleached the road paint. This key puts the staged
    // night frame back at ~1.15 — the hand-set exposure this game had
    // before it could meter — and lets daylight stop down from there.
    uKey: { value: 0.017 },
    // The meter sits on this floor at nearly every hour, which makes it
    // close to a fixed exposure — and that is deliberate, not an
    // oversight to open up. Tried at 0.34: the meter then chased the
    // brighter city and stopped the NIGHT down to 0.446, which put 55%
    // of the road at 0/255 — worse than before any of this work. A night
    // racer wants its nights pinned, not metered away. Daylight's blown
    // sky is fixed where it is made, in the sky's own palette.
    uRange: { value: new THREE.Vector2(0.55, 1.25) },
    uRates: { value: new THREE.Vector2(2.2, 0.7) }, // down (fast), up (slow)
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: `
    uniform sampler2D tLum;
    uniform sampler2D tPrev;
    uniform float uDt;
    uniform float uKey;
    uniform vec2 uRange;
    uniform vec2 uRates;
    varying vec2 vUv;
    void main() {
      float sum = 0.0;
      for (int y = 0; y < 8; y++) {
        for (int x = 0; x < 8; x++) {
          sum += texture2D(tLum, (vec2(float(x), float(y)) + 0.5) / 8.0).r;
        }
      }
      float lum = exp2(sum / 64.0);
      float target = clamp(uKey / max(lum, 1e-4), uRange.x, uRange.y);
      float prev = texture2D(tPrev, vec2(0.5)).r;
      if (prev <= 0.0) prev = target; // first frame: start where we are
      // Asymmetric on purpose: an eye stops down in about a second when
      // you walk into the sun and takes far longer to open up in the
      // dark. Adapting symmetrically feels like a light switch.
      float rate = target < prev ? uRates.x : uRates.y;
      float next = prev + (target - prev) * (1.0 - exp(-rate * uDt));
      gl_FragColor = vec4(next, lum, 0.0, 1.0);
    }`,
};

/** Multiplies the scene by the adapted exposure, before tone mapping. */
const ExposureShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tExposure: { value: null as THREE.Texture | null },
    /** Player compensation in stops, over whatever the meter decided. */
    uBias: { value: 0 },
    /** 0 = manual (uManual), 1 = follow the meter. */
    uAuto: { value: 1 },
    uManual: { value: 1.15 },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tExposure;
    uniform float uBias;
    uniform float uAuto;
    uniform float uManual;
    varying vec2 vUv;
    void main() {
      float e = mix(uManual, texture2D(tExposure, vec2(0.5)).r, uAuto);
      gl_FragColor = texture2D(tDiffuse, vUv) * (e * exp2(uBias));
    }`,
};

/**
 * Auto-exposure, entirely on the GPU.
 *
 * Meters the scene in HDR — before tone mapping, the only point in the
 * chain where the numbers are still light rather than picture —
 * downsamples it to 8x8 log-luminance, adapts a 1x1 exposure value
 * against the previous frame's, and multiplies the scene by it.
 *
 * Nothing is read back to the CPU. The obvious implementation meters on
 * the GPU and reads the result with readRenderTargetPixels so JavaScript
 * can own the exposure, and it costs a full pipeline flush every time:
 * measured here at 3.4 SECONDS per read on a software GL stack against a
 * 25 ms frame. Keeping the value in a 1x1 texture and feeding it
 * straight back into the chain costs nothing at all.
 */
export class AutoExposure {
  private lumTarget: THREE.WebGLRenderTarget;
  private expTargets: THREE.WebGLRenderTarget[];
  private ping = 0;
  private downMat: THREE.ShaderMaterial;
  private adaptMat: THREE.ShaderMaterial;
  readonly exposureMat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  /** Frames metered — proof the rig is actually running. */
  frames = 0;

  constructor() {
    const rtOpts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    };
    this.lumTarget = new THREE.WebGLRenderTarget(8, 8, rtOpts);
    this.expTargets = [
      new THREE.WebGLRenderTarget(1, 1, rtOpts),
      new THREE.WebGLRenderTarget(1, 1, rtOpts),
    ];
    this.downMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(DownsampleShader.uniforms),
      vertexShader: DownsampleShader.vertexShader,
      fragmentShader: DownsampleShader.fragmentShader,
    });
    this.adaptMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(AdaptShader.uniforms),
      vertexShader: AdaptShader.vertexShader,
      fragmentShader: AdaptShader.fragmentShader,
    });
    this.exposureMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(ExposureShader.uniforms),
      vertexShader: ExposureShader.vertexShader,
      fragmentShader: ExposureShader.fragmentShader,
    });
    this.quad = new FullScreenQuad(this.downMat);
    this.exposureMat.uniforms.tExposure.value = this.expTargets[0].texture;
  }

  /** Meter and adapt from an HDR frame. Called by the pass below. */
  step(renderer: THREE.WebGLRenderer, source: THREE.Texture, dt: number): void {
    const prev = renderer.getRenderTarget();

    this.downMat.uniforms.tDiffuse.value = source;
    this.quad.material = this.downMat;
    renderer.setRenderTarget(this.lumTarget);
    this.quad.render(renderer);

    const src = this.expTargets[this.ping];
    const dst = this.expTargets[1 - this.ping];
    this.adaptMat.uniforms.tLum.value = this.lumTarget.texture;
    this.adaptMat.uniforms.tPrev.value = src.texture;
    this.adaptMat.uniforms.uDt.value = Math.min(dt, 0.25);
    this.quad.material = this.adaptMat;
    renderer.setRenderTarget(dst);
    this.quad.render(renderer);

    this.ping = 1 - this.ping;
    this.exposureMat.uniforms.tExposure.value = dst.texture;
    renderer.setRenderTarget(prev);
    this.frames++;
  }

  /**
   * The current exposure and metered luminance, for the HUD or a test.
   * This is the one path that touches the CPU, so it is on demand only
   * and never per frame.
   */
  async sample(renderer: THREE.WebGLRenderer): Promise<{ exposure: number; luminance: number }> {
    const rt = this.expTargets[this.ping];
    // The target is half-float, so the readback buffer must be 16-bit —
    // handing readRenderTargetPixels a Float32Array returns zeros with
    // no error, which reads exactly like an exposure loop that never ran.
    const buf = new Uint16Array(4);
    const r = renderer as unknown as {
      readRenderTargetPixelsAsync?: (
        rt: THREE.WebGLRenderTarget, x: number, y: number, w: number, h: number, b: ArrayBufferView
      ) => Promise<ArrayBufferView>;
    };
    if (r.readRenderTargetPixelsAsync) {
      await r.readRenderTargetPixelsAsync.call(renderer, rt, 0, 0, 1, 1, buf);
    } else {
      renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, buf);
    }
    return {
      exposure: THREE.DataUtils.fromHalfFloat(buf[0]),
      luminance: THREE.DataUtils.fromHalfFloat(buf[1]),
    };
  }

  dispose(): void {
    this.lumTarget.dispose();
    for (const t of this.expTargets) t.dispose();
    this.downMat.dispose();
    this.adaptMat.dispose();
    this.exposureMat.dispose();
    this.quad.dispose();
  }
}

/**
 * The pass that runs the meter and applies its result. It sits between
 * the scene and the bloom, so bloom thresholds against exposed light the
 * way a real camera's would.
 */
export class ExposurePass extends Pass {
  private quad: FullScreenQuad;
  dt = 1 / 60;

  constructor(readonly auto: AutoExposure) {
    super();
    this.quad = new FullScreenQuad(auto.exposureMat);
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    this.auto.step(renderer, readBuffer.texture, this.dt);
    this.auto.exposureMat.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.quad.render(renderer);
  }

  dispose(): void {
    this.quad.dispose();
  }
}
