"use client";

/**
 * One AudioContext for the whole page.
 *
 * Both the admin's order chime and شوق's call tones synthesise short sounds,
 * and each used to construct its own context. Browsers cap how many a document
 * may hold (Chrome refuses past six, and a refused constructor throws), they
 * are not cheap, and a suspended one has to be resumed per context — so two of
 * them means two chances for a sound to silently not play. One, shared, is
 * created on first use and never torn down.
 */

let ctx: AudioContext | null = null;

/** The shared context, or null where WebAudio is unavailable or refused. */
export function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    // Suspended is the normal state before the first gesture, and after the
    // browser has parked a background tab.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * A single sine tone, ramped in and out.
 *
 * Ramped rather than switched: a square edge on a gain node is an audible
 * click, which sounds like a fault rather than a sound anyone meant to make.
 */
export function tone(
  audio: AudioContext,
  opts: { hz: number; at: number; seconds: number; gain?: number; type?: OscillatorType }
): void {
  const { hz, at, seconds, gain: peak = 0.18, type = "sine" } = opts;
  const start = audio.currentTime + at;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = hz;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + seconds + 0.02);
}
