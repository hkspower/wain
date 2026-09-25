// What each engine sounds like, derived from how it fires.
//
// The engine note was three oscillators — a sawtooth at the firing
// frequency, a second one detuned to 2.02 times it, a square an octave
// below — identical for all six engines, and a swap changed only how
// much of each was in the mix. So a flat-six and an inline six, both
// firing three times a revolution, were the same instrument: measured,
// the closest pair in the collection were 1.3 dB apart. An engine's
// voice is not its pitch. It is the pattern its cylinders fire in and the
// pipes that pattern arrives through.
//
// So each voice here is built from the engine itself:
//
//   firing    the crank angle each cylinder fires at, in the 720-degree
//             four-stroke cycle, in firing order
//   banks     which exhaust bank each pulse leaves through, and how far
//             one bank's pipe is from the listener compared to the other:
//             a level and a delay. On an engine whose banks do not fire
//             evenly — a cross-plane V8 — this is where the burble comes
//             from; on a flat-six it is the howl.
//   pulse     how sharp each exhaust pulse is. A blowdown pulse is short
//             and bright; a turbine in the way smears it, which is why a
//             turbo engine is the duller one of any pair.
//
// The sum of those pulses over one engine cycle is a spectrum in
// harmonics of the CYCLE frequency (half the crank rate). It is split,
// exactly, across the three oscillators the engine already runs, each a
// PeriodicWave at an integer fraction of the firing frequency f:
//
//   firing    at f      the harmonics that are multiples of N (cylinders)
//   bank      at f/2    multiples of N/2 that are not multiples of N — the
//                       half-orders, where a flat-six's 1.5 order lives
//   cycle     at f/N    everything else — the uneven-firing content, the
//                       cross-plane lope
//
// Because the three frequencies are exact integer ratios of the same f
// and all three start together, the sum is the engine's cycle, not three
// instruments playing at once.

import type { EngineId } from "./engines";

export interface VoiceSpec {
  cylinders: 4 | 6 | 8;
  /** Crank angle of each firing, degrees in the 720-degree cycle. */
  fireDeg: number[];
  /** Which exhaust bank (0 or 1) each of those firings leaves through. */
  bank: number[];
  /** Bank 1's level and extra path delay (degrees) against bank 0. */
  bankLevel: number;
  bankDelayDeg: number;
  /** Pulse decay, as a fraction of the cycle: short is bright. */
  pulseTau: number;
  /** A resonance in the pipes, applied before the soft clip. */
  formant: { hz: number; q: number; gainDb: number };
}

/**
 * Harmonics of the cycle frequency computed: 24 firing orders' worth.
 * The pulse shape rolls the top off on its own; stopping at 6 made a four
 * at idle a 170 Hz hum where the sawtooth it replaces had a full edge.
 */
export const HARMONICS_PER_CYLINDER = 24;

/**
 * The six engines.
 *
 * Firing angles are the real layouts' — the ORDER a cylinder fires in
 * matters only through which bank it is on, so each list is the angles in
 * firing order with the bank of the cylinder that fires there.
 */
export const ENGINE_VOICES: Record<EngineId, VoiceSpec> = {
  // Inline four, 1-3-4-2: one every 180 degrees into a 4-2-1 header,
  // which pairs cylinders 1+4 and 2+3 before the last junction. The two
  // pairs are never quite the same length, and that mismatch is the
  // order-1 edge on a small NA four's rasp; a short sharp pulse does the
  // rest.
  "i4-16": {
    cylinders: 4,
    // 1 fires at 0, 3 at 180, 4 at 360, 2 at 540: the 1+4 pair is
    // 0/360, the 2+3 pair 180/540.
    fireDeg: [0, 180, 360, 540],
    bank: [0, 1, 0, 1],
    bankLevel: 0.88, bankDelayDeg: 14,
    pulseTau: 0.012,
    formant: { hz: 1400, q: 1.1, gainDb: 4 },
  },
  // The same four with a turbine between the ports and the pipe: every
  // pulse goes through one wheel, so the pairs arrive as one even train,
  // smeared — the duller voice of the pair, and a smoother one.
  "i4-20t": {
    cylinders: 4,
    fireDeg: [0, 180, 360, 540],
    bank: [0, 0, 0, 0],
    bankLevel: 1, bankDelayDeg: 0,
    pulseTau: 0.04,
    formant: { hz: 900, q: 0.9, gainDb: 2 },
  },
  // Flat-six, 1-6-2-4-3-5: every 120 degrees, alternating banks, each bank
  // even within itself. Its two banks reach the tail through different
  // lengths of pipe, and that mismatch puts energy on the 1.5 crank order
  // — the howl a boxer six is known by.
  "f6-25": {
    cylinders: 6,
    fireDeg: [0, 120, 240, 360, 480, 600],
    bank: [0, 1, 0, 1, 0, 1],
    bankLevel: 0.85, bankDelayDeg: 30,
    pulseTau: 0.016,
    formant: { hz: 1100, q: 1.3, gainDb: 5 },
  },
  // Inline six, 1-5-3-6-2-4, two turbos fed front three and rear three.
  // The most balanced layout there is, and two turbines in the way: a
  // smooth, even third order and very little else.
  "i6-30tt": {
    cylinders: 6,
    fireDeg: [0, 120, 240, 360, 480, 600],
    bank: [0, 1, 0, 1, 0, 1],
    bankLevel: 0.98, bankDelayDeg: 4,
    pulseTau: 0.035,
    formant: { hz: 700, q: 0.8, gainDb: 3 },
  },
  // Cross-plane V8, 1-8-4-3-6-5-7-2, one pipe per bank. Every 90 degrees
  // overall — but the left bank fires at 0, 270, 450 and 540, the right at
  // 90, 180, 360 and 630: neither bank is even, and heard through two
  // pipes of different length the unevenness is the burble.
  "v8-57": {
    cylinders: 8,
    fireDeg: [0, 90, 180, 270, 360, 450, 540, 630],
    bank: [0, 1, 1, 0, 1, 0, 0, 1],
    bankLevel: 0.85, bankDelayDeg: 22,
    pulseTau: 0.016,
    formant: { hz: 320, q: 1.2, gainDb: 5 },
  },
  // Flat-plane V8: each bank is an even four, every 180 degrees, the two
  // banks interleaved 90 apart. No burble at all — two small fours
  // screaming in step, and the brightest voice in the collection.
  "v8-40fp": {
    cylinders: 8,
    fireDeg: [0, 90, 180, 270, 360, 450, 540, 630],
    bank: [0, 1, 0, 1, 0, 1, 0, 1],
    bankLevel: 0.985, bankDelayDeg: 2,
    pulseTau: 0.008,
    formant: { hz: 1800, q: 1.2, gainDb: 5 },
  },
};

/** One engine cycle's complex spectrum, harmonics 1..H of the cycle rate. */
export function cycleSpectrum(v: VoiceSpec): { re: number[]; im: number[] } {
  const H = HARMONICS_PER_CYLINDER * v.cylinders;
  const re = new Array(H + 1).fill(0);
  const im = new Array(H + 1).fill(0);
  for (let h = 1; h <= H; h++) {
    // The pulse: a one-sided exponential, whose spectrum rolls off above
    // 1/(2 pi tau) cycles. Complex, so a slower pulse also lags.
    const w = 2 * Math.PI * h * v.pulseTau;
    const pRe = 1 / (1 + w * w);
    const pIm = -w / (1 + w * w);
    let sRe = 0, sIm = 0;
    for (let k = 0; k < v.fireDeg.length; k++) {
      const b = v.bank[k];
      const amp = b ? v.bankLevel : 1;
      const deg = v.fireDeg[k] + (b ? v.bankDelayDeg : 0);
      const ph = (-2 * Math.PI * h * deg) / 720;
      sRe += amp * Math.cos(ph);
      sIm += amp * Math.sin(ph);
    }
    re[h] = sRe * pRe - sIm * pIm;
    im[h] = sRe * pIm + sIm * pRe;
  }
  return { re, im };
}

export interface VoiceTables {
  /** PeriodicWave coefficients, index 0 is DC and always 0. */
  firing: { real: Float32Array; imag: Float32Array };
  bank: { real: Float32Array; imag: Float32Array };
  cycle: { real: Float32Array; imag: Float32Array };
}

/**
 * The spectrum split across the three oscillators, scaled so the voice's
 * RMS is the RMS the legacy mix had for this engine (`targetRms`): a swap
 * changes the colour of the note, not its volume, and the bed stays at
 * the levels the mix was measured at.
 */
export function voiceTables(v: VoiceSpec, targetRms: number): VoiceTables {
  const { re, im } = cycleSpectrum(v);
  const N = v.cylinders, half = N / 2;
  const H = re.length - 1;
  // Parseval: a real signal sum_h (a cos + b sin) has mean square
  // sum_h (a^2 + b^2) / 2.
  let ms = 0;
  for (let h = 1; h <= H; h++) ms += (re[h] * re[h] + im[h] * im[h]) / 2;
  const k = ms > 0 ? targetRms / Math.sqrt(ms) : 0;
  const mk = (len: number) => ({ real: new Float32Array(len), imag: new Float32Array(len) });
  const firing = mk(Math.floor(H / N) + 1);
  const bank = mk(Math.floor(H / half) + 1);
  const cycle = mk(H + 1);
  for (let h = 1; h <= H; h++) {
    // PeriodicWave is sum (real cos + imag sin); the spectrum above is
    // the complex amplitude re + i im of e^{-i w t}-style phase, so the
    // cosine term is re and the sine term is -im. k was computed from the
    // same coefficients, so the voice lands exactly on targetRms.
    const a = re[h] * k, b = -im[h] * k;
    if (h % N === 0) { firing.real[h / N] = a; firing.imag[h / N] = b; }
    else if (h % half === 0) { bank.real[h / half] = a; bank.imag[h / half] = b; }
    else { cycle.real[h] = a; cycle.imag[h] = b; }
  }
  return { firing, bank, cycle };
}

/** The RMS of the legacy three-oscillator mix for an engine's subMix:
 *  saws at (0.85 - subMix) and 0.25, uncorrelated, and a square at subMix. */
export function legacyRms(subMix: number): number {
  const g0 = 0.85 - subMix, g1 = 0.25, g2 = subMix;
  return Math.sqrt((g0 * g0 + g1 * g1) / 3 + g2 * g2);
}

/**
 * One engine cycle as samples, from the tables exactly as the three
 * oscillators would play them — for tests and tools, and the proof that
 * the split loses nothing.
 */
export function renderCycle(t: VoiceTables, cylinders: number, n = 2048): Float32Array {
  const out = new Float32Array(n);
  const half = cylinders / 2;
  const add = (tbl: { real: Float32Array; imag: Float32Array }, mult: number) => {
    for (let j = 1; j < tbl.real.length; j++) {
      const a = tbl.real[j], b = tbl.imag[j];
      if (!a && !b) continue;
      for (let i = 0; i < n; i++) {
        const ph = (2 * Math.PI * j * mult * i) / n;
        out[i] += a * Math.cos(ph) + b * Math.sin(ph);
      }
    }
  };
  add(t.firing, cylinders);
  add(t.bank, half);
  add(t.cycle, 1);
  return out;
}

/** The engine bus's soft clip, as sound.ts builds it: tanh(2.2x) over a
 *  curve that holds its end value past full scale. */
export function softClip(x: number): number {
  return Math.tanh(2.2 * Math.max(-1, Math.min(1, x)));
}

/**
 * The legacy mix for an engine's subMix, one period of its lowest
 * oscillator: sawtooths at f and (near enough) 2f, a square at f/2.
 */
export function legacyCycle(subMix: number, n = 4096): Float32Array {
  const out = new Float32Array(n);
  const g0 = 0.85 - subMix, g1 = 0.25, g2 = subMix;
  for (let i = 0; i < n; i++) {
    const p = i / n; // phase of the f/2 square
    const saw = (x: number) => 2 * (x - Math.floor(x)) - 1;
    out[i] = g0 * saw(2 * p) + g1 * saw(4 * p) + g2 * (p < 0.5 ? 1 : -1);
  }
  return out;
}

const rmsOf = (a: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length));
};
const peakOf = (a: ArrayLike<number>) => {
  let p = 0;
  for (let i = 0; i < a.length; i++) p = Math.max(p, Math.abs(a[i]));
  return p;
};

/**
 * How loud to play a voice, so an engine swap changes its colour and not
 * its level or how hard it drives the clip.
 *
 * A pulse train is peakier than three sawtooths: at the legacy RMS these
 * voices would hit the soft clip at 1.3 to 2.3 times full scale, and a
 * voice clipped that hard is a different sound from the one designed.
 * So the voice goes INTO the clip at the legacy mix's own peak
 * (`inGain`), and a make-up gain after it (`makeup`) restores the level
 * the legacy mix came out of the clip at.
 */
export function voiceLevels(v: VoiceSpec, subMix: number): { inGain: number; makeup: number } {
  const legacy = legacyCycle(subMix);
  const legacyPeak = peakOf(legacy);
  const legacyOut = rmsOf(Array.from(legacy, softClip));
  const unit = renderCycle(voiceTables(v, 1), v.cylinders);
  const inGain = legacyPeak / Math.max(1e-9, peakOf(unit));
  const out = rmsOf(Array.from(unit, (x) => softClip(x * inGain)));
  return { inGain, makeup: out > 0 ? legacyOut / out : 1 };
}
