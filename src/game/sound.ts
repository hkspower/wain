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
  /** 1 when the governor is holding the car back — the limiter bounce. */
  limited?: number;
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
  /** 0 = deep inland, 1 = right on the corniche: cross-fades the sea
   *  against the city. `seaX/seaZ` place the surf on the seaward side. */
  coast?: number;
  seaX?: number;
  seaZ?: number;
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
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

export class SoundEngine {
  private ctx: AudioContext;
  private master: GainNode;
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
  private noise: AudioBuffer;
  muted = false;

  // Engine layers
  private engOscs: OscillatorNode[] = [];
  private engGain: GainNode;
  private engFilter: BiquadFilterNode;
  private exhaustGain: GainNode;
  private exhaustFilter: BiquadFilterNode;
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
  private rivalOsc: OscillatorNode[] = [];
  private rivalGain: GainNode | null = null;
  private rivalFilter: BiquadFilterNode | null = null;
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

  /** Recorded one-shots from public/sfx (ElevenLabs or any authored
   *  audio), decoded at boot. Each event checks here first and falls
   *  back to its synth voice — the game never waits on, or breaks
   *  because of, an audio file. */
  private samples = new Map<string, { buf: AudioBuffer; gain: number }>();
  /** Looped skid bed, when the manifest ships one. */
  private sampleSkidGain: GainNode | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.noise = makeNoiseBuffer(this.ctx);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(this.ctx.destination);
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
    }

    // --- Exhaust rasp
    this.exhaustFilter = this.ctx.createBiquadFilter();
    this.exhaustFilter.type = "bandpass";
    this.exhaustFilter.frequency.value = 180;
    this.exhaustFilter.Q.value = 1.2;
    this.exhaustGain = this.ctx.createGain();
    this.exhaustGain.gain.value = 0;
    this.loopNoise().connect(this.exhaustFilter).connect(this.exhaustGain).connect(this.bed);

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

  /** The rival's engine, positioned. Hearing them come up behind you is
   *  half of what makes a chase a chase. */
  private ensureRival(): void {
    if (this.rivalGain) return;
    const bus = this.makePanner("rival", 6, 1.4);
    bus.gain.value = 1;
    this.rivalFilter = this.ctx.createBiquadFilter();
    this.rivalFilter.type = "lowpass";
    this.rivalFilter.frequency.value = 700;
    this.rivalGain = this.ctx.createGain();
    this.rivalGain.gain.value = 0;
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = softClipCurve() as Float32Array<ArrayBuffer>;
    shaper.connect(this.rivalFilter).connect(this.rivalGain).connect(bus);
    for (const [type, ratio, level] of [
      ["sawtooth", 1, 0.5],
      ["square", 0.5, 0.3],
    ] as Array<[OscillatorType, number, number]>) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = 60 * ratio;
      const g = this.ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(shaper);
      osc.start();
      this.rivalOsc.push(osc);
    }
  }

  get audioContext(): AudioContext {
    return this.ctx;
  }

  /** Safe to call from any user-gesture handler; no-op when running. */
  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
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

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
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
    const limited = Math.min(1, Math.max(0, f.limited ?? 0));
    this.limiterPhase += limited * 0.55;
    const limiterCut = limited > 0 ? (Math.sin(this.limiterPhase) > 0.1 ? 1 : 0.45) : 1;

    const freq = 42 + rpm * 96 + f.gear * 3;
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

    this.exhaustFilter.frequency.setTargetAtTime(140 + rpm * 260, t, 0.05);
    this.exhaustGain.gain.setTargetAtTime(throttle * 0.05 + rpm * 0.01, t, 0.06);

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
      this.seaGain!.gain.setTargetAtTime(coast * 0.5 * duck, t, 0.6);
      this.cityGain!.gain.setTargetAtTime((1 - coast) * 0.22 * duck, t, 0.6);
      if (f.seaX !== undefined && f.seaZ !== undefined) {
        this.setPannerPos("sea", f.seaX, 0, f.seaZ);
      }
    }

    // --- The rival, in space
    if (f.rival) {
      this.ensureRival();
      const r = f.rival;
      this.setPannerPos("rival", r.x, r.y, r.z);
      const rRpm = Math.min(1, r.speedKmh / 260);
      for (let i = 0; i < this.rivalOsc.length; i++) {
        const ratio = i === 0 ? 1 : 0.5;
        this.rivalOsc[i].frequency.setTargetAtTime((46 + rRpm * 120) * ratio, t, 0.06);
      }
      this.rivalFilter!.frequency.setTargetAtTime(300 + r.throttle * 900 + rRpm * 600, t, 0.08);
      this.rivalGain!.gain.setTargetAtTime(0.1 + r.throttle * 0.1, t, 0.08);
    } else if (this.rivalGain) {
      this.rivalGain.gain.setTargetAtTime(0, t, 0.2);
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
    const fund = 900 + yaw * 700;
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
    const tyreSqueal = skid * (0.2 + yaw * 0.18) * synthShare;
    this.skidGain.gain.setTargetAtTime(tyreSqueal, t, 0.05);
    // Roughness climbs with the slide: a gentle scrub barely buzzes, a
    // full slide tears. The modulation adds to the carrier's own gain, so
    // its depth has to be a FRACTION of that carrier — a fixed depth
    // against a ducked carrier swings past zero and gates the squeal on
    // and off, which is a machine gun rather than a tyre.
    this.skidRough.frequency.setTargetAtTime(34 + yaw * 30, t, 0.12);
    this.skidRoughAmt.gain.setTargetAtTime(tyreSqueal * (0.3 + yaw * 0.35), t, 0.06);
    // The overtone only really appears once the tyre is properly over,
    // which is what makes a big drift sound different in kind from a
    // scrub rather than merely louder.
    this.skidHarmGain.gain.setTargetAtTime(skid * yaw * 0.085 * synthShare, t, 0.06);
    this.scrubGain.gain.setTargetAtTime(skid * 0.1 * synthShare, t, 0.05);
    if (this.sampleSkidGain) {
      const bedGain = ((this.sampleSkidGain as GainNode & { userData?: number }).userData ?? 1);
      this.sampleSkidGain.gain.setTargetAtTime(skid * (0.28 + yaw * 0.22) * bedGain, t, 0.05);
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
      this.lastThrottle - throttle > 0.35 &&
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
      src.buffer = this.noise;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 220 + Math.random() * 260;
      filter.Q.value = 2.4;
      const g = this.ctx.createGain();
      const level = 0.1 + Math.random() * 0.08;
      g.gain.setValueAtTime(level, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      src.connect(filter).connect(g).connect(this.sfx);
      src.start(t, Math.random());
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
    src.buffer = this.noise;
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
  bump(intensity = 1): void {
    if (this.playSample("bump", intensity)) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + 0.25);
    this.oneShotNoise("lowpass", 700, 0.32 * intensity, 0.16);
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

  // Direct set (not a scheduled ramp): must apply even when the audio
  // clock is throttled, e.g. in background tabs. Muted and paused are
  // independent flags; silence wins whenever either is set. Nothing else
  // ever schedules on master gain, so no cancelScheduledValues needed.
  private applyMaster(): void {
    this.master.gain.value = this.muted || this.paused ? 0 : 0.75;
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
  } {
    return {
      ctx: this.ctx.state,
      engineFreq: this.engOscs[0].frequency.value,
      masterGain: this.master.gain.value,
      muted: this.muted,
      paused: this.paused,
    };
  }

  dispose(): void {
    this.hornOff();
    this.ctx.close().catch(() => {});
  }
}
