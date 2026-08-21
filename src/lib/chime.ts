"use client";

/**
 * A short sound for "a new order just arrived".
 *
 * Synthesised rather than shipped as a file: it is two sine tones, so a 20KB
 * download for something that plays a handful of times a day would be a poor
 * trade, and there is no audio asset to keep in sync with anything.
 *
 * It is not a notification. Asking a shop for notification permission the
 * moment they open the queue is the behaviour browsers now penalise, and a
 * sound plus a count in the tab title reaches somebody in a back room just as
 * well without asking for anything.
 *
 * Autoplay policy means the first sound only works after the page has been
 * interacted with. An admin has signed in, so by the time an order can arrive
 * they have clicked something — and if the browser refuses anyway, the count in
 * the title is still there. Nothing here throws.
 */

import { audioContext, tone } from "@/lib/audio-context";

/** Two rising notes — recognisable across a room, over in half a second. */
export function chime(): void {
  const audio = audioContext();
  if (!audio) return;
  try {
    tone(audio, { hz: 660, at: 0, seconds: 0.28 });
    tone(audio, { hz: 880, at: 0.16, seconds: 0.28 });
  } catch {
    /* no sound is a small loss; the count in the title still tells them */
  }
}

const CHIME_KEY = "wain:admin:chime";

export function chimeEnabled(): boolean {
  try {
    return localStorage.getItem(CHIME_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setChimeEnabled(on: boolean): void {
  try {
    localStorage.setItem(CHIME_KEY, on ? "on" : "off");
  } catch {
    /* private mode — the setting just does not persist */
  }
}
