"use client";

import { audioContext, tone } from "@/lib/audio-context";

/**
 * The three sounds of a phone call, synthesised.
 *
 * A call that makes no sound is not a call, it is a panel. The ring-back is
 * what tells someone the thing they tapped is *going* somewhere while the
 * browser is still deciding whether to grant the microphone — that wait is a
 * second or two of nothing otherwise, and a second or two of nothing reads as
 * broken. The connect and hang-up tones mark the two moments the visitor
 * cannot see: when شوق starts listening, and when she has stopped.
 *
 * Kuwait's ring-back is the ITU-standard 425Hz, one second on and three
 * seconds off. That is used here at low gain rather than something invented,
 * because everyone in the country already knows what it means without being
 * told.
 *
 * Every function is safe to call when WebAudio is missing, refused, or the
 * page has never been touched — the call still works, it is just quieter.
 */

/** Ring-back until the returned function is called. */
export function ringback(): () => void {
  const audio = audioContext();
  if (!audio) return () => {};
  let live = true;
  let timer: number | undefined;

  const burst = () => {
    if (!live) return;
    try {
      // 425Hz for a second, at a third of the chime's gain: this plays next to
      // someone's ear on a phone, and it repeats.
      tone(audio, { hz: 425, at: 0, seconds: 1, gain: 0.06 });
    } catch {
      /* silent ring is still a working call */
    }
    timer = window.setTimeout(burst, 4000);
  };
  burst();

  return () => {
    live = false;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

/** Two quick rising notes: she is on the line. */
export function connected(): void {
  const audio = audioContext();
  if (!audio) return;
  try {
    tone(audio, { hz: 587, at: 0, seconds: 0.14, gain: 0.12 });
    tone(audio, { hz: 880, at: 0.11, seconds: 0.18, gain: 0.12 });
  } catch {
    /* nothing to do */
  }
}

/** One falling note: the call is over. */
export function hangup(): void {
  const audio = audioContext();
  if (!audio) return;
  try {
    tone(audio, { hz: 480, at: 0, seconds: 0.16, gain: 0.1 });
    tone(audio, { hz: 320, at: 0.13, seconds: 0.22, gain: 0.1 });
  } catch {
    /* nothing to do */
  }
}

/** mm:ss in Arabic-Indic digits, for the running call timer. */
export function callDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  // Not toArabicDigits from places.ts on the whole string: it would leave the
  // colon alone, which is what we want, but importing the place data module
  // into a component that renders on every page pulls the entire catalogue
  // into that chunk. Ten characters of mapping is cheaper than 36 places.
  const ar = (t: string) => t.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
  return `${ar(mm)}:${ar(ss)}`;
}
