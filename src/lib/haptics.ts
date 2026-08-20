"use client";

/**
 * Touch feedback.
 *
 * A caveat worth stating plainly rather than burying: this is the Vibration
 * API, which **iOS Safari does not implement**. On an iPhone every call here is
 * a no-op. Android Chrome supports it, so that is who feels this. There is no
 * web API that reaches the Taptic Engine from Safari, so the honest options
 * were "works on Android, silent on iOS" or "nothing at all".
 *
 * Because of that, haptics are only ever an *accompaniment*. Nothing here is
 * the sole feedback for anything — every interaction that buzzes also changes
 * something on screen, so an iPhone loses nothing but the buzz.
 *
 * Durations are deliberately short. A tap is 8ms, which reads as a tick rather
 * than a vibration; anything longer starts to feel like a phone call.
 */

const PREF_KEY = "wain:haptics";

type Pattern = number | number[];

const PATTERNS = {
  /** Selection changed — a chip, a tab, a toggle. */
  tap: 8,
  /** Something committed — a filter applied, a file accepted. */
  select: 14,
  /** A submission went through. */
  success: [12, 45, 22] as number[],
  /** Rejected input, a failed submit. */
  error: [24, 55, 24] as number[],
} satisfies Record<string, Pattern>;

export type HapticKind = keyof typeof PATTERNS;

function supported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/** Off means off, including for the very first tap of a session. */
export function enabled(): boolean {
  if (!supported()) return false;
  if (typeof window === "undefined") return false;
  // Someone who has asked the OS for less motion has not asked for a buzzing
  // phone either.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  return window.localStorage?.getItem(PREF_KEY) !== "0";
}

export function setEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    // Private mode, or storage disabled. Not worth failing a tap over.
  }
}

/** Available at all, on this device? Lets UI hide a toggle that would lie. */
export function isSupported(): boolean {
  return supported();
}

export function haptic(kind: HapticKind = "tap"): void {
  if (!enabled()) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Some browsers throw if called without a user gesture. A missed tick is
    // never worth an exception reaching the page.
  }
}
