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

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/** Two rising notes — recognisable across a room, over in half a second. */
export function chime(): void {
  const audio = context();
  if (!audio) return;
  try {
    // Suspended is the normal state before the first gesture, and after the
    // browser has parked a background tab.
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    [
      { hz: 660, at: 0 },
      { hz: 880, at: 0.16 },
    ].forEach(({ hz, at }) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      // Ramped rather than switched: a square edge on a gain node is an
      // audible click, which sounds like a fault rather than a notification.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.18, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.28);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.3);
    });
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
