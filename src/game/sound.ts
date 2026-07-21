// Procedural sound design — zero audio assets, pure WebAudio synthesis,
// works offline in the Electron/Steam build.
//
// Layers: a three-oscillator engine (fundamental, detuned octave, sub)
// through soft distortion and a throttle-following lowpass; exhaust rasp
// (bandpassed noise tracking RPM); wind roar (speed²); tire squeal
// (warbled bandpass noise while sliding); one-shot impacts, scrapes,
// gear-shift blow-off, horn, and little musical stings for battles.

export interface SoundFrame {
  speedKmh: number;
  throttle: number; // 0..1
  rpmFrac: number; // 0..1 within the current gear
  gear: number; // 1..6 (0 = neutral)
  skid: number; // 0..1 tire slide intensity
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
  private hornOscs: OscillatorNode[] = [];
  private hornGain: GainNode | null = null;
  private lastGear = 0;
  private revUntil = 0;
  private paused = false;

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

    // --- Tire squeal: warbled bandpass noise
    const skidFilter = this.ctx.createBiquadFilter();
    skidFilter.type = "bandpass";
    skidFilter.frequency.value = 1100;
    skidFilter.Q.value = 7;
    const warble = this.ctx.createOscillator();
    warble.frequency.value = 9;
    const warbleAmt = this.ctx.createGain();
    warbleAmt.gain.value = 170;
    warble.connect(warbleAmt).connect(skidFilter.frequency);
    warble.start();
    this.skidGain = this.ctx.createGain();
    this.skidGain.gain.value = 0;
    this.loopNoise().connect(skidFilter).connect(this.skidGain).connect(this.master);

    // Autoplay-policy recovery: contexts created outside a gesture call
    // stack (we start after an async chunk import) can come up suspended,
    // especially on Safari. Try now, and again on the next real gesture.
    if (this.ctx.state !== "running") this.resume();
  }

  /** Safe to call from any user-gesture handler; no-op when running. */
  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
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

    const windAmt = Math.pow(Math.min(f.speedKmh / 330, 1), 2);
    this.windFilter.frequency.setTargetAtTime(300 + f.speedKmh * 7, t, 0.1);
    this.windGain.gain.setTargetAtTime(windAmt * 0.24, t, 0.1);

    this.skidGain.gain.setTargetAtTime(Math.min(f.skid, 1) * 0.2, t, 0.05);

    // Upshift blow-off
    if (f.gear > this.lastGear && this.lastGear > 0 && f.throttle > 0.5) this.shiftHiss();
    this.lastGear = f.gear;
  }

  /** Ignition rev flourish when the race starts. */
  revStart(): void {
    this.revUntil = this.ctx.currentTime + 0.9;
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
