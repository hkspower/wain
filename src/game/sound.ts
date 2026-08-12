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

  constructor() {
    this.ctx = new AudioContext();
    this.noise = makeNoiseBuffer(this.ctx);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(this.ctx.destination);

    // --- Engine: saw fundamental + detuned octave + square sub,
    // soft-clipped, through a lowpass that opens with throttle/RPM
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = softClipCurve() as Float32Array<ArrayBuffer>;
    this.engFilter = this.ctx.createBiquadFilter();
    this.engFilter.type = "lowpass";
    this.engFilter.frequency.value = 400;
    this.engGain = this.ctx.createGain();
    this.engGain.gain.value = 0;
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.master);

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
    this.loopNoise().connect(this.exhaustFilter).connect(this.exhaustGain).connect(this.master);

    // --- Wind / road roar
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 350;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    this.loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);

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
    this.skidGain = this.ctx.createGain();
    this.skidGain.gain.value = 0;
    this.loopNoise().connect(this.skidFilter).connect(this.skidGain).connect(this.master);

    // Broad low scrub under the squeal — the tire's contact patch tearing
    const scrubFilter = this.ctx.createBiquadFilter();
    scrubFilter.type = "bandpass";
    scrubFilter.frequency.value = 320;
    scrubFilter.Q.value = 1.4;
    this.scrubGain = this.ctx.createGain();
    this.scrubGain.gain.value = 0;
    this.loopNoise().connect(scrubFilter).connect(this.scrubGain).connect(this.master);

    // --- Induction: airbox growl. Tracks load rather than road speed, so
    // it separates "pinned throttle" from "coasting at the same revs" —
    // the cue that makes acceleration feel like effort instead of pitch.
    this.inductionFilter = this.ctx.createBiquadFilter();
    this.inductionFilter.type = "bandpass";
    this.inductionFilter.frequency.value = 480;
    this.inductionFilter.Q.value = 0.9;
    this.inductionGain = this.ctx.createGain();
    this.inductionGain.gain.value = 0;
    this.loopNoise().connect(this.inductionFilter).connect(this.inductionGain).connect(this.master);

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
      .connect(this.master);

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
      .connect(this.master);

    // Autoplay-policy recovery: contexts created outside a gesture call
    // stack (we start after an async chunk import) can come up suspended,
    // especially on Safari. Try now, and again on the next real gesture.
    if (this.ctx.state !== "running") this.resume();
  }

  /** The shared AudioContext — the music player rides on this one. */
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
    this.whineOsc.connect(this.whineGain).connect(this.master);
    this.whineOsc.start();
  }

  /** Turbo blow-off — the psshh on throttle lift at boost. */
  blowOff(): void {
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
      this.loopNoise().connect(filter).connect(this.nosGain).connect(this.master);
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

  /** Per-frame follow of the car state (smoothed inside WebAudio). */
  update(f: SoundFrame): void {
    // A suspended context never prunes automation timelines — scheduling
    // against its frozen clock would grow memory without bound.
    if (this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    const revving = t < this.revUntil;
    const rpm = revving ? 0.85 : f.rpmFrac;
    const throttle = revving ? 1 : f.throttle;

    const freq = 42 + rpm * 96 + f.gear * 3;
    this.engOscs[0].frequency.setTargetAtTime(freq, t, 0.04);
    this.engOscs[1].frequency.setTargetAtTime(freq * 2.02, t, 0.04);
    this.engOscs[2].frequency.setTargetAtTime(freq * 0.5, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(280 + throttle * 900 + rpm * 700, t, 0.06);
    const idle = 0.05;
    this.engGain.gain.setTargetAtTime(idle + throttle * 0.12 + rpm * 0.03, t, 0.05);

    this.exhaustFilter.frequency.setTargetAtTime(140 + rpm * 260, t, 0.05);
    this.exhaustGain.gain.setTargetAtTime(throttle * 0.05 + rpm * 0.01, t, 0.06);

    // Induction growl: load × revs. Attacks fast and decays slower, so
    // stabbing the throttle barks and lifting off falls away naturally.
    const load = throttle * (0.35 + rpm * 0.65);
    this.inductionFilter.frequency.setTargetAtTime(320 + rpm * 900, t, 0.05);
    this.inductionGain.gain.setTargetAtTime(load * 0.055, t, load > 0.3 ? 0.03 : 0.12);

    const windAmt = Math.pow(Math.min(f.speedKmh / 330, 1), 2);
    this.windFilter.frequency.setTargetAtTime(300 + f.speedKmh * 7, t, 0.1);
    this.windGain.gain.setTargetAtTime(windAmt * 0.24, t, 0.1);

    // Tire slide: a hard drift squeals higher and warbles faster than a
    // little scrub, so the ear can tell how far out the back end is.
    const skid = Math.min(f.skid, 1);
    const yaw = Math.min(Math.abs(f.driftYaw ?? 0) / 0.6, 1);
    this.skidFilter.frequency.setTargetAtTime(900 + yaw * 700, t, 0.08);
    this.skidWarble.frequency.setTargetAtTime(7 + yaw * 9, t, 0.1);
    // The slide is this game's signature sound — a big drift should sing
    // over the engine, not hide under it.
    this.skidGain.gain.setTargetAtTime(skid * (0.2 + yaw * 0.18), t, 0.05);
    this.scrubGain.gain.setTargetAtTime(skid * 0.1, t, 0.05);

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
      src.connect(filter).connect(g).connect(this.master);
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
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  /** Crash thump: pitch-dropping sine + debris noise. */
  bump(intensity = 1): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.55 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.25);
    this.oneShotNoise("lowpass", 700, 0.32 * intensity, 0.16);
  }

  /** Guardrail scrape: metallic hiss. */
  scrape(): void {
    this.oneShotNoise("highpass", 2600, 0.2, 0.3);
    this.oneShotNoise("bandpass", 3400, 0.1, 0.25, 8);
  }

  private shiftHiss(): void {
    this.oneShotNoise("highpass", 4200, 0.12, 0.16);
  }

  /** Headlight flash click. */
  flashClick(): void {
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
      osc.connect(g).connect(this.master);
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
    this.hornGain.connect(this.master);
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
