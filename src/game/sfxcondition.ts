// The recorded effects, made fit to play before they are played.
//
// public/sfx carries six ElevenLabs renders. Decoded and measured
// (tools/shots/sfxscan in the session that wrote this; the numbers are
// in tests/sfxcondition.mjs), they had three faults the game could hear
// and none of the synth voices have:
//
//   overs    impact, scrape and blowoff decode to +0.2 to +0.6 dBFS —
//            MP3's inter-sample peaks, 2 to 4 samples at full scale each.
//            Played at their manifest gain on top of an engine and a
//            skid, those are the samples that hit the master ceiling.
//   clicks   impact starts at 0.31 of full scale on its first sample and
//            scrape at 0.26: the render was cut mid-waveform, so every
//            hit began with a step from silence.
//   the seam the skid bed is a 6 s loop whose last 50 ms run 2.3 dB
//            louder than its first — a level bump every six seconds of
//            any slide, which is exactly the length of a long drift.
//
// This fixes them once, at load, on the decoded samples. What it cannot
// fix is said below rather than papered over: the skid render has 88
// samples already flat-topped in the file, and no gain change after the
// fact gives those back. A fresh render (tools/elevenlabs/generate-sfx.mjs)
// is the only cure for that, and it needs the API this box cannot reach.

/** Peaks are trimmed to this: -1 dBFS, room for MP3's own overs. */
export const PEAK_CEILING = 0.891;
/** A one-shot whose first sample is louder than this starts with a click. */
export const CLICK_FLOOR = 0.01;
/** Fade applied to such a start, and guard fade on every end, seconds. */
export const FADE_IN_S = 0.003;
export const FADE_OUT_S = 0.005;
/** Loop crossfade: the last this-many seconds are folded into the first. */
export const LOOP_XFADE_S = 0.25;

export interface Conditioned {
  channels: Float32Array[];
  /** What was done, for the loader's log and the test. */
  report: {
    peakIn: number;
    gain: number;
    fadedIn: boolean;
    seamIn: number;
    seamOut: number;
    lengthIn: number;
    lengthOut: number;
  };
}

/**
 * Condition one decoded effect. `channels` are not modified; new arrays
 * are returned. A loop is crossfaded into itself (and comes back
 * LOOP_XFADE_S shorter); a one-shot gets its start and end de-clicked.
 */
export function conditionSfx(channels: Float32Array[], sampleRate: number, loop: boolean): Conditioned {
  const n = channels[0]?.length ?? 0;
  let peak = 0;
  for (const c of channels) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(c[i]));
  const gain = peak > PEAK_CEILING ? PEAK_CEILING / peak : 1;
  const seamOf = (cs: Float32Array[]) => {
    let s = 0;
    for (const c of cs) s = Math.max(s, Math.abs(c[0] - c[c.length - 1]));
    return s;
  };
  const seamIn = n ? seamOf(channels) : 0;

  let out: Float32Array[];
  let fadedIn = false;
  if (loop) {
    // Fold the tail into the head with an equal-power crossfade and drop
    // the tail. The new loop's last sample is the one that used to sit
    // just before the tail began, and its first sample IS the tail's
    // first sample (the head is at zero weight there) — so the seam is
    // two samples that were already neighbours, and whatever level
    // difference there was between the ends is spread across the fade
    // instead of arriving in one step.
    const L = Math.min(Math.round(LOOP_XFADE_S * sampleRate), Math.floor(n / 3));
    out = channels.map((c) => {
      const o = new Float32Array(n - L);
      for (let i = 0; i < n - L; i++) o[i] = c[i];
      for (let i = 0; i < L; i++) {
        const t = (i + 0.5) / L;
        const wIn = Math.sin((t * Math.PI) / 2);
        const wOut = Math.cos((t * Math.PI) / 2);
        o[i] = c[i] * wIn + c[n - L + i] * wOut;
      }
      return o;
    });
  } else {
    out = channels.map((c) => c.slice());
    let start = 0;
    for (const c of out) start = Math.max(start, Math.abs(c[0] ?? 0));
    const fin = Math.min(Math.round(FADE_IN_S * sampleRate), Math.floor(n / 4));
    const fout = Math.min(Math.round(FADE_OUT_S * sampleRate), Math.floor(n / 4));
    fadedIn = start > CLICK_FLOOR && fin > 0;
    for (const c of out) {
      if (fadedIn) for (let i = 0; i < fin; i++) c[i] *= i / fin;
      for (let i = 0; i < fout; i++) c[n - 1 - i] *= i / fout;
    }
  }
  if (gain !== 1) for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= gain;
  return {
    channels: out,
    report: {
      peakIn: peak,
      gain,
      fadedIn,
      seamIn,
      seamOut: out[0]?.length ? seamOf(out) : 0,
      lengthIn: n,
      lengthOut: out[0]?.length ?? 0,
    },
  };
}
