// Procedural sound design — zero audio assets, pure WebAudio synthesis,
// works offline in the Electron/Steam build.
//
// Layers: a three-oscillator engine (fundamental, detuned octave, sub)
// through soft distortion and a throttle-following lowpass; an induction
// growl that tracks load rather than revs, so pinned throttle sounds
// different from coasting at the same speed; exhaust rasp (bandpassed
// noise tracking RPM) with overrun burble on lift; wind roar (speed²);
// a two-band tire slide whose pitch and warble follow how far the body
// is hung out; brakes as pad rumble plus a resonant rotor squeal; and
// one-shot impacts, scrapes, blow-off, horn and battle stings.

export interface SoundFrame {
  speedKmh: number;
  throttle: number; // 0..1
  rpmFrac: number; // 0..1 within the current gear
  gear: number; // 1..6 (0 = neutral)
  skid: number; // 0..1 tire slide intensity
  boost?: number; // 0..1 turbo boost (drives the whistle)
  nosActive?: boolean;
  brake?: number; // 0..1 pedal pressure — drives disc squeal and pad rumble
  driftYaw?: number; // |body slip| in radians — colours the squeal
  /**
   * 0..1 — the car is away from the driver, not being steered.
   *
   * A drift and a spin are different noises and this game made the same
   * one for both. A drift is one axle scrubbing at an angle you chose:
   * a squeal, high and singing, which is what the skid voice below is
   * built to be. A spin is all four tyres dragging sideways across
   * their tread at once, and that is broader, lower and rougher — less
   * a note than a roar. The physics has known the difference all along
   * (`spinning` out of solveDrift, which the engine uses to decide the
   * camera and the steering) and the ear was never told.
   */
  spin?: number;
  /** 1 when the governor is holding the car back — the limiter bounce. */
  limited?: number;
  /** Throttle travel closed per second, computed by the simulation from
   *  its own dt. Not derived here: how fast the driver's foot moved is
   *  a fact about the car, and the audio thread's idea of elapsed time
   *  is not the simulation's — a suite that steps update() faster than
   *  real time would read every lift as instant. */
  liftRate?: number;
  /** How far off the racing surface the tires are running, 0..1: the
   *  kerb and shoulder rumble. */
  rumble?: number;
  /** Where the listener is and which way it faces, for the 3D bus. */
  listener?: {
    x: number; y: number; z: number;
    fx: number; fy: number; fz: number;
    ux: number; uy: number; uz: number;
  };
  /** The rival's machine as a positioned source. */
  rival?: { x: number; y: number; z: number; speedKmh: number; throttle: number } | null;
  /**
   * Everyone else near enough to hear, nearest first.
   *
   * There are forty-six cars on this road and exactly one of them made a
   * sound. You could pull alongside a saloon at a hundred and eighty and
   * hear nothing but your own engine, which is the moment the world
   * stops being a place and becomes a backdrop with pictures of cars on
   * it. The caller sorts and truncates; the pool below is the limit on
   * how many are actually voiced.
   */
  others?: ReadonlyArray<{ x: number; y: number; z: number; speedKmh: number }>;
  /** 0 = deep inland, 1 = right on the corniche: cross-fades the sea
   *  against the city. `seaX/seaZ` place the surf on the seaward side. */
  coast?: number;
  seaX?: number;
  seaZ?: number;
}

/** One positioned engine: two oscillators, a lowpass, a gain, a panner. */
interface CarVoice {
  osc: OscillatorNode[];
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: PannerNode;
}

/** How many of the other cars are actually voiced. The ear cannot follow
 *  more than a few engines at once, and forty-six panners would be a
 *  budget spent on the ones nobody can pick out. */
const TRAFFIC_VOICES = 4;

/**
 * The noise the whole bed is built from — wind, tyre roll, skid, scrub,
 * induction, rumble, brakes, sea, city, NOS. Twelve looping sources draw
 * on this.
 *
 * It used to be ONE buffer of 1.5 seconds, and every one of those twelve
 * sources played it from the same instant. Nothing about that clicks —
 * white noise has no seam, since any two adjacent samples are already
 * independent — but it means the entire noise bed REPEATS, in lockstep,
 * every 1.5 seconds. Measured on the bus: at idle, where noise is most of
 * what you hear, the output correlated 0.83 with itself at a lag of
 * exactly 1.500 s, against ±0.09 at every neighbouring lag. That is not a
 * subtle statistical artefact; it is the same second and a half of wind
 * and tyre roar playing over and over, and it is the "chuffing" texture
 * that makes synthesised noise sound cheap.
 *
 * Three things break it, and all three are needed:
 *
 *   - A POOL of independent buffers rather than one, so sources are not
 *     playing literally the same numbers as each other.
 *   - LONGER buffers, so a single source's own repeat is far enough apart
 *     to stop reading as a pattern.
 *   - A per-source playback rate offset (applied in `loopNoise`), which
 *     is the part that actually matters: sources sharing one period sum
 *     to something with THAT period no matter how they are staggered, so
 *     only giving them different periods removes the repeat from the mix.
 */
const NOISE_SECONDS = 4;
const NOISE_POOL = 4;

/** Rev-limiter stutter, radians per second: 33 rad/s is 5.3 cuts a
 *  second, which is what the old per-frame constant produced at 60 fps. */
const LIMITER_STUTTER = 33;
/** How far the note drops on the cut half of the stutter, when the car
 *  is fully against the limiter. */
const LIMITER_CUT_DEPTH = 0.45;

/**
 * How fast the throttle has to close to count as a LIFT, in units of
 * pedal travel per SECOND.
 *
 * Per second, and that is the whole point. This used to compare the
 * throttle against its value on the previous FRAME — `lastThrottle -
 * throttle > 0.35` — which is not a speed, it is a speed multiplied by
 * however long the browser took to draw. Measured: the same 40 ms flick
 * off the pedal fired the backfire twice at 60 fps, once at 30 and not
 * at all at 144, and a normal 120 ms release of an analogue trigger
 * fired at none of them. Only a keyboard was reliable, because a key
 * release is 1 to 0 in a single frame at any rate — which is why
 * nobody testing with the arrow keys ever saw it.
 *
 * The numbers are what a foot does. A flick straight off the pedal is
 * about 40 ms of travel, so 25 per second; a brisk analogue release is
 * 120 ms, so 8; a lazy roll-off is 400 ms, so 2.5. A threshold of 4.5
 * takes the first two and leaves the last one alone, which is the
 * distinction the sound is trying to draw: lifting off pops, easing
 * off does not.
 *
 * sound.ts already carries this exact lesson for the rev limiter, whose
 * stutter rate was a function of frame rate until it was pinned to the
 * clock. This is the same bug, one screen further down, in the code
 * that decides whether the car has an overrun at all.
 */
const BURBLE_LIFT_RATE = 4.5;

function makeNoisePool(ctx: AudioContext): AudioBuffer[] {
  const pool: AudioBuffer[] = [];
  for (let k = 0; k < NOISE_POOL; k++) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    pool.push(buf);
  }
  return pool;
}

/**
 * The output ceiling: identity below the knee, asymptotic above it.
 *
 * A DynamicsCompressorNode is a COMPRESSOR, and calling it a limiter
 * does not make it one. Measured: driven six times past the mix's
 * staging it pulled 12.4 dB — working exactly as specified — and the
 * output still peaked at 2.69, because a 20:1 ratio reduces overs
 * rather than stopping them, and a 3 ms attack lets transients through
 * underneath it entirely.
 *
 * This is the actual brick wall. Below `knee` it is the identity, so at
 * the levels this game really runs (peaks around 0.44) it is bit for
 * bit transparent and does nothing at all. Above it the curve bends
 * toward 1 and never reaches it — and because a WaveShaper clamps any
 * input beyond +/-1 to the curve's endpoint, the output cannot exceed
 * 1.0 no matter what arrives. That is a guarantee rather than a
 * tendency, which is what "cannot clip" has to mean.
 */
function ceilingCurve(knee = 0.85): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  const span = 1 - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

function softClipCurve(): Float32Array {
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2);
  }
  return curve;
}

/**
 * Where the whole mix sits, before the limiter.
 *
 * 0.75, unchanged — and it is worth saying why, because it was briefly
 * 12 on the strength of a measurement that was wrong.
 *
 * An analyser on the output appeared to show the game peaking at 0.025
 * flat out at 300 km/h in a slide, about 32 dB below full scale, and
 * barely louder than an idling car. Both readings came from a MUTED
 * master: the test paused the game to control the frame, engine
 * setPaused() forwards to sound setPaused(), and that sets this gain to
 * zero. The only thing still reaching the tap was the music, which is a
 * soundtrack playing at a steady level — measured correctly, and
 * mistaken for the mix.
 *
 * Measured properly, with the game paused and the sound explicitly
 * un-paused, the mix runs 0.048 RMS at idle and 0.154 flat out. That is
 * about -16 dBFS with a threefold swing between resting and working,
 * which is a healthy game mix and needed no gain at all. Sixteen times
 * it would have pinned the limiter permanently and flattened every
 * dynamic the rest of this file exists to create.
 */
const MASTER_GAIN = 0.75;

export class SoundEngine {
  private ctx: AudioContext;
  private master: GainNode;
  /** Final stage. Everything, music included, passes through it. */
  private limiter: DynamicsCompressorNode;
  /** The hard ceiling after the limiter — see ceilingCurve. */
  private ceiling: WaveShaperNode;
  /** The continuous bed: engine, exhaust, tires, wind, ambience. This is
   *  what ducks under a voice line — the layers a listener stops needing
   *  when someone is talking to them. */
  private bed!: GainNode;
  /** One-shots and recorded samples. Ducks a little, never to nothing:
   *  an impact you cannot hear because a rival is talking is a bug. */
  private sfx!: GainNode;
  /** Where the bed sits when nothing is ducking it. */
  private bedLevel = 1;
  private sfxLevel = 1;
  private noise: AudioBuffer[];
  /** Which buffer and which detuning the next looping source gets. */
  private noiseTurn = 0;
  muted = false;

  // Engine layers
  private engOscs: OscillatorNode[] = [];
  /** Per-layer gains, kept so a swap can re-voice the mix: a big engine
   *  is carried by its sub-octave, a small one by its fundamental. */
  private engLayerGains: GainNode[] = [];
  /** The fitted engine's voice. A four-stroke fires cylinders/2 times
   *  per crank revolution, so this is what sets the pitch — not the
   *  engine speed, and not a curve fitted by ear. */
  private engCylinders = 4;
  private engIdleRpm = 800;
  private engRedlineRpm = 6800;
  private engSubMix = 0.3;
  /** Cross-plane lope: half-order amplitude modulation of the exhaust.
   *  Zero for everything that is not a cross-plane V8. */
  private lopeOsc: OscillatorNode | null = null;
  private lopeAmt: GainNode | null = null;
  private lopeDepth = 0;
  private engGain: GainNode;
  private engFilter: BiquadFilterNode;
  /**
   * The exhaust, in three bands.
   *
   * `exhaustFilter`/`exhaustGain` are the MID band and keep their old
   * names deliberately: the cross-plane lope is summed into that gain,
   * and the lope belongs in the middle of the spectrum where a burble is
   * actually audible. Renaming it would have moved the lope onto a band
   * chosen by alphabet rather than by ear.
   */
  private exLowGain: GainNode;
  private exLowFilter: BiquadFilterNode;
  private exhaustGain: GainNode;
  private exhaustFilter: BiquadFilterNode;
  private exHighGain: GainNode;
  private exHighFilter: BiquadFilterNode;
  /** The fitted system's voice, against stock. Set by setExhaust(). */
  private exPitch = 1;
  private exRasp = 1;
  private exLoud = 1;
  /** Balance of the three bands. Stock is flat. */
  private exLow = 1;
  private exMid = 1;
  private exHigh = 1;
  private windGain: GainNode;
  private windFilter: BiquadFilterNode;
  private skidGain: GainNode;
  private skidFilter: BiquadFilterNode;
  private skidWarble: OscillatorNode;
  /** Second warble at an incommensurate rate — one LFO reads as a siren. */
  private skidWarble2: OscillatorNode;
  /** The squeal's harmonic. A slipping tyre is a stick-slip oscillator,
   *  so it rings at a fundamental AND its overtone, not one band. */
  private skidHarm: BiquadFilterNode;
  private skidHarmGain: GainNode;
  /** Roughness: the tearing amplitude modulation of rubber letting go. */
  private skidRough: OscillatorNode;
  private skidRoughAmt: GainNode;
  private scrubGain: GainNode;
  // Induction: the intake growl that swells with load
  private inductionGain: GainNode;
  private inductionFilter: BiquadFilterNode;
  // Brakes: pad rumble + rotor squeal
  private brakeRumbleGain: GainNode;
  private brakeRumbleFilter: BiquadFilterNode;
  private brakeSquealGain: GainNode;
  private brakeSquealFilter: BiquadFilterNode;
  private hornOscs: OscillatorNode[] = [];
  private hornGain: GainNode | null = null;
  private lastGear = 0;
  private revUntil = 0;
  private paused = false;
  private lastThrottle = 0;
  private nextBurbleAt = 0;
  // Forced-induction layers (created on demand by configureAspiration)
  private whineOsc: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;
  private whineMode: "none" | "turbo" | "super" = "none";
  private nosGain: GainNode | null = null;

  // 3D bus — everything positional hangs off these
  private panners = new Map<string, { panner: PannerNode; gain: GainNode }>();
  private rivalVoice: CarVoice | null = null;
  private trafficVoices: CarVoice[] = [];
  // Environment
  private seaGain: GainNode | null = null;
  private seaFilter: BiquadFilterNode | null = null;
  private cityGain: GainNode | null = null;
  // Tire roll on the road surface, and the kerb rumble over it
  private rollGain: GainNode;
  private rollFilter: BiquadFilterNode;
  private rumbleGain: GainNode;
  private rumbleLfo: OscillatorNode;
  /** Rev-limiter stutter phase, advanced while the governor holds. */
  private limiterPhase = 0;
  /** Audio-clock time of the last update(), for rate-independent phase. */
  private limiterLast = 0;

  /** Recorded one-shots from public/sfx (ElevenLabs or any authored
   *  audio), decoded at boot. Each event checks here first and falls
   *  back to its synth voice — the game never waits on, or breaks
   *  because of, an audio file. */
  private samples = new Map<string, { buf: AudioBuffer; gain: number }>();
  /** Looped skid bed, when the manifest ships one. */
  private sampleSkidGain: GainNode | null = null;
  /** The recorded slide bed's own source, kept so a spin can pull its
   *  pitch down the way it pulls the synth squeal's. */
  private sampleSkidSrc: AudioBufferSourceNode | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.noise = makeNoisePool(this.ctx);
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    /**
     * The limiter, and the reason there is now a bus to put it on.
     *
     * Before this the master was a gain wired straight to the
     * destination, and the music was not even wired to the master — it
     * connected to the destination on its own. So the game had no final
     * bus at all: the summing point was the DAC, and nothing can meter,
     * compress or limit a DAC. Every level in this file was authored
     * blind to what the sum of them did.
     *
     * Configured as a limiter rather than a compressor: hard knee, high
     * ratio, fast attack, and a release long enough not to pump on the
     * engine's own beat. It should be doing nothing at all most of the
     * time — it exists so that a crash, a backfire and a redline landing
     * on the same frame cannot clip, which is exactly when a mix without
     * one falls apart.
     */
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    // ...and the ceiling after it. The compressor does the musical work
    // — riding a loud passage down gently — and this catches whatever it
    // was too slow or too gentle to stop. Oversampled, because
    // saturating a signal generates harmonics and the ones above Nyquist
    // fold back down as aliasing if they are not run at a higher rate.
    this.ceiling = this.ctx.createWaveShaper();
    this.ceiling.curve = ceilingCurve() as Float32Array<ArrayBuffer>;
    this.ceiling.oversample = "4x";
    this.master.connect(this.limiter).connect(this.ceiling).connect(this.ctx.destination);
    // Two sub-buses under the master, so the mix has somewhere to move.
    // Before this everything connected straight to the master and there
    // was no way to duck one thing under another — which is the whole
    // job of a mix.
    this.bed = this.ctx.createGain();
    this.bed.gain.value = this.bedLevel;
    this.bed.connect(this.master);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = this.sfxLevel;
    this.sfx.connect(this.master);
    void this.loadSfxManifest();

    // --- Engine: saw fundamental + detuned octave + square sub,
    // soft-clipped, through a lowpass that opens with throttle/RPM
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = softClipCurve() as Float32Array<ArrayBuffer>;
    this.engFilter = this.ctx.createBiquadFilter();
    this.engFilter.type = "lowpass";
    this.engFilter.frequency.value = 400;
    this.engGain = this.ctx.createGain();
    this.engGain.gain.value = 0;
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.bed);

    const layers: Array<[OscillatorType, number, number]> = [
      ["sawtooth", 1, 0.5], // fundamental
      ["sawtooth", 2.02, 0.25], // beating octave
      ["square", 0.5, 0.35], // sub thump
    ];
    for (const [type, ratio, level] of layers) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 55 * ratio;
      const g = this.ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(shaper);
      osc.start();
      this.engOscs.push(osc);
      this.engLayerGains.push(g);
    }

    // --- Exhaust: boom, bark and rasp
    //
    // This was one bandpass at 180 Hz, and one band can only ever say
    // "more exhaust". Every system in the shop sounded like the same pipe
    // at a different volume, because that is literally what it was — the
    // spec's pitch/rasp/loud slid one filter around and nothing else.
    //
    // A real pipe speaks in three places at once. There is a boom you
    // feel rather than hear, near the firing order's low harmonics; a
    // bark in the middle of your hearing where the silencer either eats
    // it or does not; and a metallic rasp on top that a thin-wall
    // titanium system has and a stock cast silencer never will. What
    // separates two exhausts is the BALANCE of those three, not the
    // level of one, so the shop now sells a balance.
    const band = (freq: number, q: number): [BiquadFilterNode, GainNode] => {
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      this.loopNoise().connect(f).connect(g).connect(this.bed);
      return [f, g];
    };
    // Low Q on the top band on purpose: rasp is broadband hiss with a
    // tilt, not a whistle. A high Q up there rings like a kettle.
    [this.exLowFilter, this.exLowGain] = band(75, 1.6);
    [this.exhaustFilter, this.exhaustGain] = band(430, 1.2);
    [this.exHighFilter, this.exHighGain] = band(2100, 0.9);

    // --- Cross-plane lope.
    //
    // A cross-plane V8 does not fire evenly within a bank: two of its
    // eight pulses land on the wrong side of the beat, and the half-crank-
    // order thump that produces IS the burble. At idle it is about six
    // beats a second and unmistakable; at road speed it climbs into the
    // note as roughness. Both come out of the same one oscillator,
    // because both are the same phenomenon.
    //
    // Summed into the exhaust gain rather than multiplied through a
    // second stage: an oscillator connected to an AudioParam adds to it,
    // so a depth of d swings the exhaust between (1-d) and (1+d) of its
    // level and costs one node.
    this.lopeOsc = this.ctx.createOscillator();
    this.lopeOsc.type = "sine";
    this.lopeOsc.frequency.value = 6;
    this.lopeAmt = this.ctx.createGain();
    this.lopeAmt.gain.value = 0;
    this.lopeOsc.connect(this.lopeAmt).connect(this.exhaustGain.gain);
    this.lopeOsc.start();

    // --- Wind / road roar
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 350;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.bed);

    // --- Tire squeal: warbled bandpass noise. Two bands, because a real
    // slide is a high rotor-like squeal riding on a broad rubber scrub —
    // one band alone reads as a kettle whistle.
    this.skidFilter = this.ctx.createBiquadFilter();
    this.skidFilter.type = "bandpass";
    this.skidFilter.frequency.value = 1100;
    this.skidFilter.Q.value = 7;
    this.skidWarble = this.ctx.createOscillator();
    this.skidWarble.frequency.value = 9;
    const warbleAmt = this.ctx.createGain();
    warbleAmt.gain.value = 170;
    this.skidWarble.connect(warbleAmt).connect(this.skidFilter.frequency);
    this.skidWarble.start();
    // Second warble, deliberately not a multiple of the first. Two
    // incommensurate rates never line up, so the squeal wanders the way
    // a real one does; a single LFO reads as a siren within a second.
    this.skidWarble2 = this.ctx.createOscillator();
    this.skidWarble2.frequency.value = 13.7;
    const warbleAmt2 = this.ctx.createGain();
    warbleAmt2.gain.value = 130;
    this.skidWarble2.connect(warbleAmt2).connect(this.skidFilter.frequency);
    this.skidWarble2.start();

    this.skidGain = this.ctx.createGain();
    this.skidGain.gain.value = 0;

    // ROUGHNESS. A tyre at the limit is a stick-slip oscillator: it grips,
    // tears free, grips again, tens of times a second. That buzz is what
    // separates a tyre letting go from a kettle, and no amount of filter
    // tuning produces it — it has to be amplitude modulation. Modulating
    // around unity rather than from zero keeps the squeal continuous
    // instead of gating it on and off.
    this.skidRough = this.ctx.createOscillator();
    this.skidRough.type = "sawtooth";
    this.skidRough.frequency.value = 42;
    this.skidRoughAmt = this.ctx.createGain();
    this.skidRoughAmt.gain.value = 0;
    this.skidRough.connect(this.skidRoughAmt).connect(this.skidGain.gain);
    this.skidRough.start();

    const skidSrc = this.loopNoise();
    skidSrc.connect(this.skidFilter).connect(this.skidGain).connect(this.bed);

    // The overtone, a fifth above and narrower. Real squeal energy sits
    // in a stack of peaks; one band alone is a whistle.
    this.skidHarm = this.ctx.createBiquadFilter();
    this.skidHarm.type = "bandpass";
    this.skidHarm.frequency.value = 1650;
    this.skidHarm.Q.value = 14;
    this.skidHarmGain = this.ctx.createGain();
    this.skidHarmGain.gain.value = 0;
    skidSrc.connect(this.skidHarm).connect(this.skidHarmGain).connect(this.bed);

    // Broad low scrub under the squeal — the tire's contact patch tearing
    const scrubFilter = this.ctx.createBiquadFilter();
    scrubFilter.type = "bandpass";
    scrubFilter.frequency.value = 320;
    scrubFilter.Q.value = 1.4;
    this.scrubGain = this.ctx.createGain();
    this.scrubGain.gain.value = 0;
    this.loopNoise().connect(scrubFilter).connect(this.scrubGain).connect(this.bed);

    // --- Induction: airbox growl. Tracks load rather than road speed, so
    // it separates "pinned throttle" from "coasting at the same revs" —
    // the cue that makes acceleration feel like effort instead of pitch.
    this.inductionFilter = this.ctx.createBiquadFilter();
    this.inductionFilter.type = "bandpass";
    this.inductionFilter.frequency.value = 480;
    this.inductionFilter.Q.value = 0.9;
    this.inductionGain = this.ctx.createGain();
    this.inductionGain.gain.value = 0;
    this.loopNoise().connect(this.inductionFilter).connect(this.inductionGain).connect(this.bed);

    // --- Tire roll: the broad hiss of rubber on asphalt. It is what
    // makes a car sound like it is on a road rather than in a vacuum,
    // and it rises with speed independently of engine revs.
    this.rollFilter = this.ctx.createBiquadFilter();
    this.rollFilter.type = "bandpass";
    this.rollFilter.frequency.value = 700;
    this.rollFilter.Q.value = 0.6;
    this.rollGain = this.ctx.createGain();
    this.rollGain.gain.value = 0;
    this.loopNoise().connect(this.rollFilter).connect(this.rollGain).connect(this.bed);

    // --- Kerb/shoulder rumble: the roll noise chopped by a fast LFO, so
    // running wide over the rumble strip buzzes through the floor.
    {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 260;
      this.rumbleGain = this.ctx.createGain();
      this.rumbleGain.gain.value = 0;
      const depth = this.ctx.createGain();
      depth.gain.value = 0.85;
      this.rumbleLfo = this.ctx.createOscillator();
      this.rumbleLfo.type = "square";
      this.rumbleLfo.frequency.value = 22;
      this.rumbleLfo.connect(depth).connect(this.rumbleGain.gain);
      this.rumbleLfo.start();
      this.loopNoise().connect(f).connect(this.rumbleGain).connect(this.bed);
    }

    // --- Brakes: a low pad-on-rotor rumble plus a high metallic squeal
    // that only appears under real pressure at speed
    this.brakeRumbleFilter = this.ctx.createBiquadFilter();
    this.brakeRumbleFilter.type = "lowpass";
    this.brakeRumbleFilter.frequency.value = 260;
    this.brakeRumbleGain = this.ctx.createGain();
    this.brakeRumbleGain.gain.value = 0;
    this.loopNoise()
      .connect(this.brakeRumbleFilter)
      .connect(this.brakeRumbleGain)
      .connect(this.bed);

    this.brakeSquealFilter = this.ctx.createBiquadFilter();
    this.brakeSquealFilter.type = "bandpass";
    this.brakeSquealFilter.frequency.value = 2400;
    // Resonant enough to read as rotor ring rather than hiss, but not so
    // narrow that it passes no energy — at Q 14 the squeal measured only
    // 3% over coasting and simply vanished under the engine.
    this.brakeSquealFilter.Q.value = 7;
    this.brakeSquealGain = this.ctx.createGain();
    this.brakeSquealGain.gain.value = 0;
    this.loopNoise()
      .connect(this.brakeSquealFilter)
      .connect(this.brakeSquealGain)
      .connect(this.bed);

    // Autoplay-policy recovery: contexts created outside a gesture call
    // stack (we start after an async chunk import) can come up suspended,
    // especially on Safari. Try now, and again on the next real gesture.
    if (this.ctx.state !== "running") this.resume();
  }

  /** The shared AudioContext — the music player rides on this one. */
  /**
   * A positioned source on the 3D bus. WebAudio's panner does the
   * distance law and the stereo placement for us; everything that has a
   * location in the world goes through one of these rather than being
   * mixed flat into the master.
   */
  private makePanner(name: string, refDistance = 8, rolloff = 1.1): GainNode {
    const hit = this.panners.get(name);
    if (hit) return hit.gain;
    const panner = this.ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = refDistance;
    panner.rolloffFactor = rolloff;
    panner.maxDistance = 400;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(panner).connect(this.bed);
    this.panners.set(name, { panner, gain });
    return gain;
  }

  private setPannerPos(name: string, x: number, y: number, z: number): void {
    const p = this.panners.get(name);
    if (!p) return;
    const t = this.ctx.currentTime;
    // setPosition is deprecated; the AudioParams glide instead of
    // jumping, which also stops fast movement from clicking.
    if (p.panner.positionX) {
      p.panner.positionX.setTargetAtTime(x, t, 0.02);
      p.panner.positionY.setTargetAtTime(y, t, 0.02);
      p.panner.positionZ.setTargetAtTime(z, t, 0.02);
    } else {
      (p.panner as unknown as { setPosition(x: number, y: number, z: number): void })
        .setPosition(x, y, z);
    }
  }

  /**
   * The world outside the car. Surf on the seaward side of the corniche
   * and a broad city hum inland, cross-faded by how coastal the road is
   * — the Gulf Road's whole character is that the sea is on your left
   * for half the lap.
   */
  private ensureAmbience(): void {
    if (this.seaGain) return;
    // Sea: filtered noise with a slow swell, placed out on the water
    const seaBus = this.makePanner("sea", 26, 0.5);
    this.seaFilter = this.ctx.createBiquadFilter();
    this.seaFilter.type = "lowpass";
    this.seaFilter.frequency.value = 900;
    this.seaGain = this.ctx.createGain();
    this.seaGain.gain.value = 0;
    const swell = this.ctx.createOscillator();
    swell.frequency.value = 0.12; // the long breath of surf
    const swellAmt = this.ctx.createGain();
    swellAmt.gain.value = 320;
    swell.connect(swellAmt).connect(this.seaFilter.frequency);
    swell.start();
    this.loopNoise().connect(this.seaFilter).connect(this.seaGain).connect(seaBus);
    seaBus.gain.value = 1;

    // City: a low un-positioned hum — it is everywhere, not somewhere
    const cityFilter = this.ctx.createBiquadFilter();
    cityFilter.type = "lowpass";
    cityFilter.frequency.value = 220;
    this.cityGain = this.ctx.createGain();
    this.cityGain.gain.value = 0;
    this.loopNoise().connect(cityFilter).connect(this.cityGain).connect(this.bed);
  }

  /**
   * One car's engine, positioned on the 3D bus.
   *
   * The rival had this and nothing else did. Written once and used for
   * both, so a car in the next lane is made of the same thing the rival
   * is — two oscillators through a soft clip and a lowpass — rather than
   * a second, thinner idea of what an engine sounds like.
   */
  private makeCarVoice(name: string): CarVoice {
    const bus = this.makePanner(name, 6, 1.4);
    bus.gain.value = 1;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = softClipCurve() as Float32Array<ArrayBuffer>;
    shaper.connect(filter).connect(gain).connect(bus);
    const osc: OscillatorNode[] = [];
    for (const [type, ratio, level] of [
      ["sawtooth", 1, 0.5],
      ["square", 0.5, 0.3],
    ] as Array<[OscillatorType, number, number]>) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = 60 * ratio;
      const g = this.ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(shaper);
      o.start();
      osc.push(o);
    }
    return { osc, gain, filter, panner: this.panners.get(name)!.panner };
  }

  /** Set a voice going at a speed and a load, or fade it out. */
  private driveVoice(
    v: CarVoice,
    at: { x: number; y: number; z: number } | null,
    speedKmh: number,
    throttle: number,
    peak: number,
    t: number
  ): void {
    if (!at) {
      v.gain.gain.setTargetAtTime(0, t, 0.2);
      return;
    }
    v.panner.positionX.setTargetAtTime(at.x, t, 0.05);
    v.panner.positionY.setTargetAtTime(at.y, t, 0.05);
    v.panner.positionZ.setTargetAtTime(at.z, t, 0.05);
    const rpm = Math.min(1, speedKmh / 220);
    for (let i = 0; i < v.osc.length; i++) {
      const ratio = i === 0 ? 1 : 0.5;
      v.osc[i].frequency.setTargetAtTime((46 + rpm * 120) * ratio, t, 0.06);
    }
    v.filter.frequency.setTargetAtTime(300 + throttle * 900 + rpm * 600, t, 0.08);
    v.gain.gain.setTargetAtTime(peak * (0.5 + throttle * 0.5), t, 0.08);
  }

  /** The rival's engine, positioned. Hearing them come up behind you is
   *  half of what makes a chase a chase. */
  private ensureRival(): void {
    if (this.rivalVoice) return;
    this.rivalVoice = this.makeCarVoice("rival");
    // The traffic pool is built with it: four voices, because the ear
    // cannot follow more than a few engines and forty-six panners is a
    // budget spent on nothing. The nearest few are the ones you would
    // hear anyway.
    for (let i = 0; i < TRAFFIC_VOICES; i++) {
      this.trafficVoices.push(this.makeCarVoice(`traffic${i}`));
    }
  }

  /**
   * Where anything outside this class should connect.
   *
   * The music used to connect straight to ctx.destination, so the game
   * had two independent outputs and no place where the whole mix
   * existed. Routing it here puts it under the same limiter as
   * everything else, which is what makes a crash duck the soundtrack
   * for free rather than pile on top of it.
   */
  get mixBus(): GainNode {
    return this.master;
  }

  /**
   * The last node before the destination — what actually leaves.
   *
   * Exposed because a test that taps `master` is measuring the bus and
   * not the output, and the difference is the entire limiter and
   * ceiling. That mistake was made here: a proof that the ceiling holds
   * the output under full scale was read off the master, showed a peak
   * of 2.5, and looked like the ceiling had failed when it had simply
   * never been in the measured path.
   */
  get outputTap(): AudioNode {
    return this.ceiling;
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }

  /** Safe to call from any user-gesture handler; no-op when running. */
  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
  }

  /**
   * Fit an engine. Cylinder count, rev range and voicing — everything
   * that makes a four sound like a four.
   *
   * The layer mix moves with the engine because the same three
   * oscillators have to carry a 1.6 that lives on its fundamental and a
   * 5.7 that is felt on the octave below it. A single fixed mix makes
   * every engine the same engine at a different pitch.
   */
  setEngine(e: {
    cylinders: number;
    idleRpm: number;
    redlineRpm: number;
    subMix: number;
    lopeDepth: number;
  }): void {
    this.engCylinders = e.cylinders;
    this.engIdleRpm = e.idleRpm;
    this.engRedlineRpm = e.redlineRpm;
    this.engSubMix = e.subMix;
    this.lopeDepth = e.lopeDepth;
    // Fundamental gives up what the sub takes, so the total stays put and
    // a swap changes the colour rather than the volume.
    if (this.engLayerGains.length === 3) {
      this.engLayerGains[0].gain.value = 0.85 - e.subMix;
      this.engLayerGains[1].gain.value = 0.25;
      this.engLayerGains[2].gain.value = e.subMix;
    }
  }

  /** Wire up the whistle/whine layer for the equipped aspiration mod. */
  configureAspiration(mode: "none" | "turbo" | "super"): void {
    this.whineMode = mode;
    if (mode === "none" || this.whineOsc) {
      if (this.whineGain && mode === "none") this.whineGain.gain.value = 0;
      return;
    }
    this.whineOsc = this.ctx.createOscillator();
    this.whineOsc.type = "sine";
    this.whineOsc.frequency.value = 900;
    this.whineGain = this.ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain).connect(this.bed);
    this.whineOsc.start();
  }

  /** Turbo blow-off — the psshh on throttle lift at boost. */
  /**
   * Fit an exhaust system.
   *
   * Until now the catalogue sold a "deeper voice" that no code read: the
   * tune carried an exhaustLevel nobody consumed, so every car sounded
   * identical whatever was bolted to the back of it.
   */
  setExhaust(
    pitch: number,
    rasp: number,
    loud: number,
    tone?: { low: number; mid: number; high: number }
  ): void {
    this.exPitch = pitch;
    this.exRasp = rasp;
    this.exLoud = loud;
    this.exLow = tone?.low ?? 1;
    this.exMid = tone?.mid ?? 1;
    this.exHigh = tone?.high ?? 1;
  }

  /**
   * The crack on a hard lift.
   *
   * Unburnt fuel lighting in a hot pipe: a sharp low thump with a spit of
   * high noise over it. The flame has been drawn at the tips for a while
   * with nothing to hear, which is the one thing a straight pipe is
   * bought for. `strength` is the system's pop, 1 stock to about 2.4.
   */
  backfire(strength = 1): void {
    if (this.ctx.state !== "running") return;
    const s = Math.min(2.6, Math.max(0.5, strength));
    if (this.playSample("backfire", 0.5 * s)) return;
    const t = this.ctx.currentTime;
    // The thump: a short body resonance falling as the pressure leaves.
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(150 * (1 + (s - 1) * 0.12), t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16 * s, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.16);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + 0.18);
    // The spit over the top: bigger systems crack harder and brighter.
    this.oneShotNoise("highpass", 1500 + s * 700, 0.07 * s, 0.07 + s * 0.02);
    this.oneShotNoise("bandpass", 420, 0.05 * s, 0.12, 3);
  }

  blowOff(): void {
    if (this.playSample("blowoff")) return;
    this.oneShotNoise("bandpass", 1500, 0.22, 0.35, 3);
    this.oneShotNoise("highpass", 3800, 0.12, 0.25);
  }

  /** NOS hiss while the bottle is open. */
  setNos(active: boolean): void {
    if (!this.nosGain) {
      this.nosGain = this.ctx.createGain();
      this.nosGain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 2200;
      this.loopNoise().connect(filter).connect(this.nosGain).connect(this.bed);
    }
    this.nosGain.gain.setTargetAtTime(active ? 0.09 : 0, this.ctx.currentTime, 0.04);
  }

  /** One buffer out of the pool, at random — a one-shot that reaches for
   *  noise gets some variety for free instead of always popping the same
   *  numbers. */
  private noiseOne(): AudioBuffer {
    return this.noise[(Math.random() * this.noise.length) | 0];
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    const buf = this.noise[this.noiseTurn % this.noise.length];
    src.buffer = buf;
    src.loop = true;
    // A different period per source, so no two ever realign and the sum
    // has no short repeat of its own. Noise is scale-free, so resampling
    // it by a few percent costs nothing audible — every one of these is
    // filtered downstream anyway.
    const rate = 0.93 + (this.noiseTurn % 7) * 0.023 + Math.random() * 0.01;
    src.playbackRate.value = rate;
    // ...and a different starting point, so they do not all begin on the
    // same sample of the same buffer.
    src.start(0, Math.random() * buf.duration);

    // And then a slow drift on top, which is what finally kills it. A
    // fixed rate still gives a source ONE period, so the bed still
    // returns to the same samples at the same lag forever — measured at
    // idle, where noise is most of the mix, the bus still correlated 0.36
    // with itself every 3.8 seconds after the detuning alone. Drifting
    // the rate by half a percent over half a minute smears that lag by
    // tens of milliseconds, and a repeat that never lands in the same
    // place is not a repeat. Half a percent of pitch on filtered noise is
    // inaudible; the periodicity it removes is not.
    const drift = this.ctx.createOscillator();
    drift.type = "sine";
    drift.frequency.value = 0.02 + Math.random() * 0.05;
    const depth = this.ctx.createGain();
    depth.gain.value = rate * 0.006;
    drift.connect(depth).connect(src.playbackRate);
    drift.start();

    this.noiseTurn++;
    return src;
  }

  /**
   * Recorded effects drop in through public/sfx/manifest.json:
   * `{ "bump": { "file": "impact.mp3", "gain": 1 }, ... }` — generated by
   * tools/elevenlabs/generate-sfx.mjs or authored by hand. An entry with
   * `loop: true` named "skid" becomes the looping slide bed; everything
   * else is a one-shot keyed by event name. The shipping default is an
   * empty manifest and the synth voices stand.
   */
  private async loadSfxManifest(): Promise<void> {
    interface Entry { file: string; gain?: number; loop?: boolean }
    let manifest: Record<string, Entry>;
    try {
      const res = await fetch("/sfx/manifest.json", { cache: "no-cache" });
      if (!res.ok) return;
      const parsed: unknown = await res.json();
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return;
      manifest = parsed as Record<string, Entry>;
    } catch {
      return;
    }
    await Promise.all(
      Object.entries(manifest).map(async ([name, e]) => {
        if (!e?.file) return;
        try {
          const data = await (await fetch(`/sfx/${e.file}`)).arrayBuffer();
          const buf = await this.ctx.decodeAudioData(data);
          if (name === "skid" && e.loop) {
            // The slide bed loops forever at zero gain; update() rides it
            const src = this.ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            this.sampleSkidGain = this.ctx.createGain();
            this.sampleSkidGain.gain.value = 0;
            (this.sampleSkidGain as GainNode & { userData?: unknown }).userData = e.gain ?? 1;
            src.connect(this.sampleSkidGain).connect(this.sfx);
            src.start();
            this.sampleSkidSrc = src;
          } else {
            this.samples.set(name, { buf, gain: e.gain ?? 1 });
          }
        } catch {
          // A missing or undecodable file silently leaves the synth voice
        }
      })
    );
  }

  /** Fire a recorded one-shot; false = caller should use its synth
   *  voice. A few cents of random detune keeps rapid repeats from
   *  machine-gunning the identical waveform. */
  /**
   * Duck the mix under a voice line.
   *
   * The single most useful move in a game mix: when someone talks to
   * the player, the bed steps back so the words are intelligible, and
   * comes back when they stop. The bed drops hard because a listener
   * stops needing engine detail mid-sentence; the one-shot bus barely
   * moves, because an impact you cannot hear because a rival is talking
   * is a bug rather than a mix. setTargetAtTime rather than a ramp, so
   * overlapping lines re-duck smoothly instead of stepping.
   */
  duckForVoice(on: boolean): void {
    const t = this.ctx.currentTime;
    // -8 dB on the bed, -2.5 dB on the one-shots
    this.bed.gain.setTargetAtTime(on ? this.bedLevel * 0.4 : this.bedLevel, t, on ? 0.08 : 0.34);
    this.sfx.gain.setTargetAtTime(on ? this.sfxLevel * 0.75 : this.sfxLevel, t, on ? 0.08 : 0.34);
  }

  /** Balance between the recorded/one-shot layer and the synth bed, for
   *  the settings panel. Both are clamped to something sane. */
  setMixLevels(bed: number, sfx: number): void {
    this.bedLevel = Math.max(0, Math.min(1.5, bed));
    this.sfxLevel = Math.max(0, Math.min(1.5, sfx));
    const t = this.ctx.currentTime;
    this.bed.gain.setTargetAtTime(this.bedLevel, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.sfxLevel, t, 0.05);
  }

  /** Live bus levels, for the mix test. */
  get mix(): { bed: number; sfx: number; master: number } {
    return {
      bed: +this.bed.gain.value.toFixed(4),
      sfx: +this.sfx.gain.value.toFixed(4),
      master: +this.master.gain.value.toFixed(4),
    };
  }

  private playSample(name: string, gain = 1): boolean {
    const s = this.samples.get(name);
    if (!s) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = 0.96 + Math.random() * 0.08;
    const g = this.ctx.createGain();
    g.gain.value = s.gain * gain;
    src.connect(g).connect(this.sfx);
    src.start();
    return true;
  }

  /** Per-frame follow of the car state (smoothed inside WebAudio). */
  update(f: SoundFrame): void {
    // A suspended context never prunes automation timelines — scheduling
    // against its frozen clock would grow memory without bound.
    if (this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    const revving = t < this.revUntil;
    const rpm = revving ? 0.85 : f.rpmFrac;
    const throttle = revving ? 1 : f.throttle;

    // Rev limiter: when the governor is holding the car at its top
    // speed, the ECU cuts and restores fuel many times a second. That
    // stutter is the sound of a car against its limiter, and it is the
    // only audible difference between "fast" and "as fast as it goes".
    //
    // The phase advances per SECOND, not per frame. It used to be
    // `+= limited * 0.55` on every call to update(), which makes the
    // stutter rate a function of how fast the machine renders: 5.3 Hz at
    // 60 fps, 12.6 Hz at 144. Two players holding the same car against
    // the same limiter heard two different engines, and the faster one
    // heard a buzz rather than a cut. LIMITER_STUTTER is the old 60 fps
    // behaviour pinned to the clock, so it sounds as it always did on the
    // machine it was tuned on and now sounds that way everywhere.
    const limited = Math.min(1, Math.max(0, f.limited ?? 0));
    const dt = this.limiterLast > 0 ? Math.min(0.1, t - this.limiterLast) : 0;
    this.limiterLast = t;
    this.limiterPhase += limited * LIMITER_STUTTER * dt;
    // Depth scales with how hard the car is leaning on the stop, rather
    // than snapping to full at the first frame over it. `limited` used
    // to be binary and only ever meant the top-gear governor, so this
    // was a switch; now that it ramps and fires at every redline, a
    // switch would make the limiter arrive as a click. Fully on it
    // alternates between full and 0.45, which is the bark; brushing it
    // is a flutter you can hear but would not call a cut.
    const stutter = Math.sin(this.limiterPhase) > 0.1 ? 0 : 1;
    const limiterCut = 1 - (1 - LIMITER_CUT_DEPTH) * limited * stutter;

    // The note is the FIRING rate, not the crank rate: a four-stroke
    // fires cylinders/2 times per revolution. At the same rpm a V8
    // therefore sounds an octave above a four — and still reads as the
    // deeper engine on the road, because it gets there at 6,200 rpm
    // while the little four is at 8,400 and because half its energy is
    // sitting on the sub-octave. Both of those fall out of this one
    // line and the mix above it, which is the argument for using the
    // real formula instead of a curve fitted by ear.
    const crankRpm = this.engIdleRpm + (this.engRedlineRpm - this.engIdleRpm) * rpm;
    const freq = (crankRpm / 60) * (this.engCylinders / 2);
    this.engOscs[0].frequency.setTargetAtTime(freq, t, 0.04);
    this.engOscs[1].frequency.setTargetAtTime(freq * 2.02, t, 0.04);
    this.engOscs[2].frequency.setTargetAtTime(freq * 0.5, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(280 + throttle * 900 + rpm * 700, t, 0.06);
    const idle = 0.05;
    this.engGain.gain.setTargetAtTime(
      (idle + throttle * 0.12 + rpm * 0.03) * limiterCut,
      t,
      limited > 0 ? 0.012 : 0.05
    );

    // The fitted system colours all three bands: where each sits, how
    // resonant the middle one is, and how much of each reaches the bed.
    // All three centres ride exPitch together, so a deep system is deep
    // everywhere rather than deep in one band and stock in the others.
    this.exLowFilter.frequency.setTargetAtTime((55 + rpm * 48) * this.exPitch, t, 0.05);
    this.exhaustFilter.frequency.setTargetAtTime((140 + rpm * 260) * this.exPitch, t, 0.05);
    this.exHighFilter.frequency.setTargetAtTime((1500 + rpm * 1800) * this.exPitch, t, 0.05);
    this.exhaustFilter.Q.setTargetAtTime(1.2 * this.exRasp, t, 0.09);

    // Each band answers to a different thing about how the car is being
    // driven, which is what stops the three from being one fader.
    //
    //   low  — LOAD. An engine pulling hard at 2,000 rpm booms; the same
    //          engine free-revving in neutral does not, and that
    //          difference is most of what "it sounds like it's working"
    //          means.
    //   mid  — the old mixture of throttle and revs. Unchanged, so a
    //          stock car still sounds like it did.
    //   high — REVS. The metallic edge only arrives near the top of a
    //          gear, and it arrives whether or not you are still on the
    //          throttle, because it is gas velocity and not fuelling.
    const exLevel = (throttle * 0.05 + rpm * 0.01) * this.exLoud;
    this.exLowGain.gain.setTargetAtTime(
      (throttle * 0.055 + rpm * 0.004) * this.exLoud * this.exLow,
      t,
      0.07
    );
    this.exhaustGain.gain.setTargetAtTime(exLevel * this.exMid, t, 0.06);
    this.exHighGain.gain.setTargetAtTime(
      (rpm * rpm * 0.028 + throttle * 0.006) * this.exLoud * this.exHigh,
      t,
      0.05
    );
    // Lope at half crank order — 700 rpm idle is 5.8 beats a second,
    // which is the burble; 6,000 rpm is 50 Hz, which is the roughness
    // the same engine has at the top of a gear. Depth rides the exhaust
    // level so it cannot modulate a silent bus into audibility.
    if (this.lopeOsc && this.lopeAmt) {
      this.lopeOsc.frequency.setTargetAtTime(Math.max(1, crankRpm / 120), t, 0.08);
      this.lopeAmt.gain.setTargetAtTime(exLevel * this.lopeDepth, t, 0.08);
    }

    // Induction growl: load × revs. Attacks fast and decays slower, so
    // stabbing the throttle barks and lifting off falls away naturally.
    const load = throttle * (0.35 + rpm * 0.65);
    this.inductionFilter.frequency.setTargetAtTime(320 + rpm * 900, t, 0.05);
    this.inductionGain.gain.setTargetAtTime(load * 0.055, t, load > 0.3 ? 0.03 : 0.12);

    // Wind: speed-squared roar, with a slow buffet on top so it breathes
    // instead of sitting as a flat hiss.
    const windAmt = Math.pow(Math.min(f.speedKmh / 330, 1), 2);
    const buffet = 1 + Math.sin(t * 1.7) * 0.12 + Math.sin(t * 0.41) * 0.08;
    this.windFilter.frequency.setTargetAtTime(300 + f.speedKmh * 7, t, 0.1);
    this.windGain.gain.setTargetAtTime(windAmt * 0.24 * buffet, t, 0.1);

    // Tire roll on asphalt: the ever-present hiss that says "road".
    const roll = Math.min(f.speedKmh / 190, 1);
    this.rollFilter.frequency.setTargetAtTime(420 + f.speedKmh * 3.4, t, 0.08);
    this.rollGain.gain.setTargetAtTime(Math.pow(roll, 1.4) * 0.1, t, 0.08);

    // Kerb strip: buzz frequency tracks how fast the ribs go past
    const rumble = Math.min(Math.max(f.rumble ?? 0, 0), 1);
    this.rumbleLfo.frequency.setTargetAtTime(14 + f.speedKmh * 0.55, t, 0.05);
    this.rumbleGain.gain.setTargetAtTime(rumble * Math.min(1, f.speedKmh / 40) * 0.22, t, 0.04);

    // --- The world: surf to seaward, city hum inland
    if (f.coast !== undefined) {
      this.ensureAmbience();
      const coast = Math.min(Math.max(f.coast, 0), 1);
      // The car's own noise masks the environment at speed, so duck it
      const duck = 1 - Math.min(0.75, f.speedKmh / 240);
      // Left at 0.5. The surf IS the largest single gain in this file,
      // and it was briefly cut to 0.16 on the theory that it was
      // flattening the mix — but the output says otherwise: idle 0.048
      // RMS against 0.154 flat out is a threefold swing, so the car
      // overtakes the sea perfectly well already. The theory was built
      // on a measurement of the music with the master muted. A number
      // this audible does not get changed on an argument.
      this.seaGain!.gain.setTargetAtTime(coast * 0.5 * duck, t, 0.6);
      this.cityGain!.gain.setTargetAtTime((1 - coast) * 0.22 * duck, t, 0.6);
      if (f.seaX !== undefined && f.seaZ !== undefined) {
        this.setPannerPos("sea", f.seaX, 0, f.seaZ);
      }
    }

    // --- Every other car on the road, in space
    //
    // The rival used to be the only one. Forty-six machines went past in
    // silence, which is the moment a world stops being a place: you can
    // draw a saloon in the next lane at a hundred and eighty and the ear
    // will not believe it is there.
    //
    // The rival keeps the louder voice — a chase is a chase because you
    // can hear it coming — and traffic gets the pool, nearest first,
    // through exactly the same synthesis. Slots not filled this frame
    // fade out rather than cut, so a car dropping out of range leaves
    // the way it arrived.
    if (f.rival || (f.others && f.others.length)) this.ensureRival();
    if (this.rivalVoice) {
      const r = f.rival;
      this.driveVoice(this.rivalVoice, r ?? null, r?.speedKmh ?? 0, r?.throttle ?? 0, 0.2, t);
    }
    for (let i = 0; i < this.trafficVoices.length; i++) {
      const o = f.others?.[i];
      // Traffic is not racing you, so it sits under the rival: a fixed
      // load rather than a throttle, and half the level. The panner's
      // own distance rolloff does the rest.
      this.driveVoice(this.trafficVoices[i], o ?? null, o?.speedKmh ?? 0, 0.35, 0.085, t);
    }

    // --- Listener: the ears ride the camera, not the car
    if (f.listener) {
      const l = this.ctx.listener;
      const L = f.listener;
      if (l.positionX) {
        l.positionX.setTargetAtTime(L.x, t, 0.02);
        l.positionY.setTargetAtTime(L.y, t, 0.02);
        l.positionZ.setTargetAtTime(L.z, t, 0.02);
        l.forwardX.setTargetAtTime(L.fx, t, 0.02);
        l.forwardY.setTargetAtTime(L.fy, t, 0.02);
        l.forwardZ.setTargetAtTime(L.fz, t, 0.02);
        l.upX.setTargetAtTime(L.ux, t, 0.02);
        l.upY.setTargetAtTime(L.uy, t, 0.02);
        l.upZ.setTargetAtTime(L.uz, t, 0.02);
      } else {
        const legacy = l as unknown as {
          setPosition(x: number, y: number, z: number): void;
          setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
        };
        legacy.setPosition(L.x, L.y, L.z);
        legacy.setOrientation(L.fx, L.fy, L.fz, L.ux, L.uy, L.uz);
      }
    }

    // Tire slide: a hard drift squeals higher and warbles faster than a
    // little scrub, so the ear can tell how far out the back end is.
    const skid = Math.min(f.skid, 1);
    const yaw = Math.min(Math.abs(f.driftYaw ?? 0) / 0.6, 1);
    // A SPIN PULLS THE VOICE DOWN AND OPENS IT OUT.
    //
    // Everything below is written for a drift, where the squeal rises
    // with the angle — 900 Hz at the limit of grip up to 1600 at full
    // slip. Follow that curve into a spin and the car sings its highest
    // note at the exact moment it has stopped being driven, which is
    // backwards: a tyre dragged sideways across its whole tread is a
    // broad, low roar, not a note. So a spin bends the fundamental back
    // DOWN below where a scrub starts, and the roar layer under it
    // comes up to meet it.
    const spin = Math.min(Math.max(f.spin ?? 0, 0), 1);
    const fund = (900 + yaw * 700) * (1 - spin * 0.62);
    this.skidFilter.frequency.setTargetAtTime(fund, t, 0.08);
    // The overtone tracks the fundamental at a fixed ratio, so the two
    // peaks move together and stay one voice rather than two.
    this.skidHarm.frequency.setTargetAtTime(fund * 1.5, t, 0.08);
    this.skidWarble.frequency.setTargetAtTime(7 + yaw * 9, t, 0.1);
    this.skidWarble2.frequency.setTargetAtTime(13.7 + yaw * 6, t, 0.1);
    // The slide is this game's signature sound — a big drift should sing
    // over the engine, not hide under it. When a recorded skid bed is
    // loaded it carries the slide and the synth squeal ducks to a
    // supporting layer; otherwise the synth sings alone as before.
    const synthShare = this.sampleSkidGain ? 0.35 : 1;
    // Four tyres instead of two, so a spin is louder than the drift it
    // came out of even as its pitch falls.
    const tyreSqueal = skid * (0.2 + yaw * 0.18) * (1 + spin * 0.5) * synthShare;
    this.skidGain.gain.setTargetAtTime(tyreSqueal, t, 0.05);
    // Roughness climbs with the slide: a gentle scrub barely buzzes, a
    // full slide tears. The modulation adds to the carrier's own gain, so
    // its depth has to be a FRACTION of that carrier — a fixed depth
    // against a ducked carrier swings past zero and gates the squeal on
    // and off, which is a machine gun rather than a tyre.
    // Rougher in a spin, and slower with it: the tread is juddering
    // across the road rather than singing along it.
    this.skidRough.frequency.setTargetAtTime((34 + yaw * 30) * (1 - spin * 0.45), t, 0.12);
    this.skidRoughAmt.gain.setTargetAtTime(
      tyreSqueal * (0.3 + yaw * 0.35 + spin * 0.4), t, 0.06);
    // The overtone only really appears once the tyre is properly over,
    // which is what makes a big drift sound different in kind from a
    // scrub rather than merely louder.
    // The overtone is the drift's own singing quality, so it goes away
    // as the slide stops being a drift.
    this.skidHarmGain.gain.setTargetAtTime(
      skid * yaw * 0.085 * (1 - spin * 0.8) * synthShare, t, 0.06);
    // And the broadband scrub — the roar — comes up in its place.
    this.scrubGain.gain.setTargetAtTime(
      skid * (0.1 + spin * 0.26) * synthShare, t, 0.05);
    if (this.sampleSkidGain) {
      const bedGain = ((this.sampleSkidGain as GainNode & { userData?: number }).userData ?? 1);
      this.sampleSkidGain.gain.setTargetAtTime(
        skid * (0.28 + yaw * 0.22) * (1 + spin * 0.5) * bedGain, t, 0.05);
      // And the RECORDING follows the spin too.
      //
      // Everything above bends the synth voice down when the car gets
      // away — lower fundamental, no singing overtone, more roar. With a
      // recorded bed installed the synth is ducked to a third of the
      // mix, so leaving the bed at its drift pitch would have most of
      // the sound carry on squealing exactly as before and quietly undo
      // the spin. The bed is a slide recorded at one speed; playing it
      // slower is what a tyre dragged across its tread rather than along
      // it actually sounds like.
      if (this.sampleSkidSrc) {
        this.sampleSkidSrc.playbackRate.setTargetAtTime(1 - spin * 0.3, t, 0.09);
      }
    }

    // Brakes: rumble needs pressure and rotation; the squeal only sings
    // above a threshold, which keeps gentle braking silent.
    const brake = Math.min(Math.max(f.brake ?? 0, 0), 1);
    const rolling = Math.min(f.speedKmh / 60, 1);
    this.brakeRumbleFilter.frequency.setTargetAtTime(180 + f.speedKmh * 1.6, t, 0.08);
    this.brakeRumbleGain.gain.setTargetAtTime(brake * rolling * 0.22, t, 0.05);
    const squeal = Math.max(0, brake - 0.35) / 0.65;
    this.brakeSquealFilter.frequency.setTargetAtTime(1900 + rolling * 1400, t, 0.09);
    this.brakeSquealGain.gain.setTargetAtTime(squeal * rolling * 0.19, t, 0.06);

    // Overrun burble: lifting off at revs pops the exhaust — the JDM
    // signature. Rate-limited so it crackles rather than machine-guns.
    if (
      (f.liftRate ?? 0) > BURBLE_LIFT_RATE &&
      rpm > 0.55 &&
      f.speedKmh > 40 &&
      t > this.nextBurbleAt
    ) {
      this.nextBurbleAt = t + 0.5;
      this.burble();
    }
    this.lastThrottle = throttle;

    // Forced-induction voice: turbo whistle rises with boost pressure,
    // supercharger whine tracks RPM
    if (this.whineOsc && this.whineGain) {
      if (this.whineMode === "turbo") {
        const boost = f.boost ?? 0;
        this.whineOsc.frequency.setTargetAtTime(1200 + boost * 2600, t, 0.06);
        this.whineGain.gain.setTargetAtTime(boost * 0.035, t, 0.06);
      } else if (this.whineMode === "super") {
        this.whineOsc.frequency.setTargetAtTime(700 + rpm * 2400, t, 0.05);
        this.whineGain.gain.setTargetAtTime(throttle * 0.03 + rpm * 0.01, t, 0.05);
      }
    }

    // Upshift blow-off
    if (f.gear > this.lastGear && this.lastGear > 0 && f.throttle > 0.5) {
      if (this.whineMode === "turbo" && (f.boost ?? 0) > 0.4) this.blowOff();
      else this.shiftHiss();
    }
    this.lastGear = f.gear;
  }

  /** Ignition rev flourish when the race starts. */
  revStart(): void {
    this.revUntil = this.ctx.currentTime + 0.9;
  }

  /** Decel pops: three or four irregular cracks over half a second. */
  private burble(): void {
    const t0 = this.ctx.currentTime;
    const pops = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < pops; i++) {
      const t = t0 + i * (0.055 + Math.random() * 0.07);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseOne();
      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 220 + Math.random() * 260;
      filter.Q.value = 2.4;
      const g = this.ctx.createGain();
      const level = 0.1 + Math.random() * 0.08;
      g.gain.setValueAtTime(level, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      src.connect(filter).connect(g).connect(this.sfx);
      src.start(t, Math.random() * (src.buffer.duration - 0.2));
      src.stop(t + 0.12);
    }
  }

  private oneShotNoise(
    type: BiquadFilterType,
    freq: number,
    gain: number,
    duration: number,
    q = 1
  ): void {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseOne();
    src.loop = false;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  /** Crash thump: pitch-dropping sine + debris noise. */
  /**
   * A hit. `intensity` runs from about 0.5 for a kerb to 1.5 for a
   * full-lock arrival at a barrier.
   *
   * An impact is three things happening in order, and this used to be
   * one of them: a falling sine with a noise burst under it, which is a
   * thump. A thump is right for a kerb and wrong for the thing the
   * crash solver actually models — a car meeting a concrete barrier
   * hard enough to be spun 136 degrees in 1.18 seconds. That arrived
   * sounding like a dropped box.
   *
   * So it is built the way the event is:
   *
   *   CRACK   the first few milliseconds, when the bumper skin gives.
   *           High, bright, and over almost before it starts. This is
   *           what makes a hit sound sudden rather than soft, and it is
   *           the layer that was missing.
   *   BOOM    the shell itself, a falling sine — what was already here.
   *           It carries the weight and the severity.
   *   TAIL    the debris and the panel ring afterwards, a filtered
   *           rattle that decays over a quarter of a second. Only on
   *           real hits: a kerb strike has nothing to shed.
   *
   * Only the crack and the boom fire below half intensity, so a scuff
   * against a kerb is still a scuff.
   */
  bump(intensity = 1): void {
    const t = this.ctx.currentTime;
    const hard = Math.min(Math.max((intensity - 0.5) / 1.0, 0), 1);

    // A RECORDING CANNOT SCALE, SO THE SYNTH STAYS FOR THE PART THAT DOES.
    //
    // With impact.mp3 installed this used to return here and the three
    // layers below never played — installing the audio would have
    // quietly deleted the severity in a crash. One recording is one
    // hit: gain makes it louder, not bigger, and a kerb strike and a
    // full-lock arrival at a barrier are not the same event at two
    // volumes.
    //
    // So the sample carries the body of it, and the synth keeps the two
    // layers that answer to how hard it was — the crack at the front
    // and the debris tail behind. On a hard hit both are added over the
    // recording; on a graze the sample plays alone, which is what a
    // graze is.
    const sampled = this.playSample("bump", intensity);
    if (sampled && hard <= 0.05) return;

    // CRACK — 6 ms of bright noise. Short enough to read as an edge
    // rather than as a hiss.
    this.oneShotNoise("highpass", 2400, 0.16 + 0.3 * hard, 0.006 + 0.02 * hard);

    // BOOM — the shell. Starts higher and falls further on a hard hit:
    // a big impact excites the whole body, and a body is a bigger, more
    // slowly falling voice than a bumper corner. Skipped when a
    // recording is providing the body already, or the two stack into a
    // hit twice as heavy as either.
    if (!sampled) {
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140 + 60 * hard, t);
    osc.frequency.exponentialRampToValueAtTime(38 - 12 * hard, t + 0.18 + 0.1 * hard);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22 + 0.12 * hard);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + 0.36);
    this.oneShotNoise("lowpass", 700, 0.32 * intensity, 0.16);
    }

    // TAIL — trim and glass letting go, and the panel still ringing.
    // Nothing at all under half intensity.
    if (hard > 0.05) {
      this.oneShotNoise("bandpass", 1500, 0.05 + 0.12 * hard, 0.12 + 0.2 * hard, 2.5);
      const ring = this.ctx.createOscillator();
      ring.type = "triangle";
      ring.frequency.setValueAtTime(320 + 120 * hard, t + 0.01);
      const rg = this.ctx.createGain();
      rg.gain.setValueAtTime(0.0001, t + 0.01);
      rg.gain.exponentialRampToValueAtTime(0.06 * hard, t + 0.03);
      rg.gain.exponentialRampToValueAtTime(0.0005, t + 0.28 + 0.2 * hard);
      ring.connect(rg).connect(this.sfx);
      ring.start(t + 0.01);
      ring.stop(t + 0.55);
    }
  }

  /** Guardrail scrape. `severity` is how hard the car went in: a graze
   *  is a short hiss, a full-lock arrival is a long tearing screech. */
  scrape(severity = 1): void {
    const sev = Math.min(Math.max(severity, 0), 1);
    if (this.playSample("scrape", 0.55 + sev * 0.7)) return;
    this.oneShotNoise("highpass", 2600, 0.12 + sev * 0.16, 0.18 + sev * 0.3);
    this.oneShotNoise("bandpass", 3000 + sev * 900, 0.06 + sev * 0.09, 0.15 + sev * 0.25, 8);
    // A hard hit rings the shell as well as grinding the paint
    if (sev > 0.45) this.oneShotNoise("lowpass", 420, 0.18 * sev, 0.22);
  }

  private shiftHiss(): void {
    if (this.playSample("shift")) return;
    this.oneShotNoise("highpass", 4200, 0.12, 0.16);
  }

  /** Headlight flash click. */
  flashClick(): void {
    if (this.playSample("flash")) return;
    this.oneShotNoise("bandpass", 2200, 0.15, 0.05, 4);
  }

  private sting(notes: number[], step: number, type: OscillatorType = "triangle", level = 0.12): void {
    const t0 = this.ctx.currentTime;
    notes.forEach((freq, i) => {
      const t = t0 + i * step;
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + step * 2.2);
      osc.connect(g).connect(this.sfx);
      osc.start(t);
      osc.stop(t + step * 2.4);
    });
  }

  /** A slide reversed into another one. The pip climbs with the chain,
   *  so the multiplier is something you hear while your eyes are on the
   *  road rather than a number you have to look away to read. */
  driftLink(chain: number): void {
    const step = Math.max(0, Math.min(4, chain - 1));
    const root = 523 * Math.pow(2, step / 12); // a semitone per link
    this.sting([root, root * 1.5], 0.055, "triangle", 0.055);
  }

  battleSting(): void {
    this.sting([220, 262, 330, 440], 0.09, "sawtooth", 0.07);
    this.oneShotNoise("highpass", 1800, 0.1, 0.5);
  }

  winSting(): void {
    this.sting([262, 330, 392, 523], 0.11);
  }

  loseSting(): void {
    this.sting([196, 156, 131], 0.22);
  }

  championFanfare(): void {
    this.sting([262, 330, 392, 523, 659, 784], 0.13, "triangle", 0.14);
  }

  hornOn(): void {
    if (this.hornGain) return;
    const t = this.ctx.currentTime;
    this.hornGain = this.ctx.createGain();
    this.hornGain.gain.setValueAtTime(0.0001, t);
    this.hornGain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    this.hornGain.connect(this.sfx);
    for (const freq of [425, 530]) {
      const osc = this.ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = freq;
      osc.connect(this.hornGain);
      osc.start();
      this.hornOscs.push(osc);
    }
  }

  hornOff(): void {
    if (!this.hornGain) return;
    const t = this.ctx.currentTime;
    this.hornGain.gain.setTargetAtTime(0.0001, t, 0.03);
    const oscs = this.hornOscs;
    const gain = this.hornGain;
    this.hornOscs = [];
    this.hornGain = null;
    setTimeout(() => {
      oscs.forEach((o) => o.stop());
      gain.disconnect();
    }, 200);
  }

  /** What the master gain is heading for. Read this rather than the live
   *  node: for a few milliseconds after a mute or a pause the node is
   *  mid-ramp and reads something in between. */
  get masterTarget(): number {
    return this.muted || this.paused ? 0 : MASTER_GAIN;
  }

  // Muted and paused are independent flags; silence wins whenever either
  // is set.
  //
  // This used to assign master.gain.value directly, which cuts the whole
  // mix — half of full scale, mid-waveform — to zero between one sample
  // and the next. That is a click on the master bus every time anyone
  // pauses, and it is the one fault class the glitch tool says outright
  // it cannot see, because it happens while the mix is loud. Twelve
  // milliseconds is still instant to a listener and has no edge in it.
  //
  // The direct set stays as the fallback for a context that is not
  // rendering: nothing scheduled runs while it is suspended, so a ramp
  // would leave the mute untaken.
  private applyMaster(): void {
    const target = this.masterTarget;
    if (this.ctx.state === "running") {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.012);
    } else {
      this.master.gain.value = target;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyMaster();
    return this.muted;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyMaster();
  }

  /** For headless verification. */
  debugState(): {
    ctx: string;
    engineFreq: number;
    masterGain: number;
    muted: boolean;
    paused: boolean;
    exhaust: {
      lowHz: number;
      midHz: number;
      highHz: number;
      low: number;
      mid: number;
      high: number;
    };
  } {
    return {
      ctx: this.ctx.state,
      engineFreq: this.engOscs[0].frequency.value,
      masterGain: this.master.gain.value,
      muted: this.muted,
      paused: this.paused,
      exhaust: {
        lowHz: this.exLowFilter.frequency.value,
        midHz: this.exhaustFilter.frequency.value,
        highHz: this.exHighFilter.frequency.value,
        low: this.exLowGain.gain.value,
        mid: this.exhaustGain.gain.value,
        high: this.exHighGain.gain.value,
      },
    };
  }

  dispose(): void {
    this.hornOff();
    this.ctx.close().catch(() => {});
  }
}
