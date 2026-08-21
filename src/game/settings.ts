// Player settings — accessibility, quality and feel.
//
// Applied to the document root as data attributes so CSS can react
// without React re-rendering the whole HUD, and mirrored to localStorage
// so a returning player never has to set them twice.

import type { Resolution } from "./render";

export interface Settings {
  /** Kill non-essential animation (OS setting is also honoured). */
  reducedMotion: boolean;
  /** Swap the rival channel off the red/green confusion pair. */
  colorBlindSafe: boolean;
  /** Vibrate on impacts, challenges and rewards. */
  haptics: boolean;
  /** Render tier: auto follows measured frame rate. */
  quality: "auto" | "ultra" | "high" | "balanced" | "battery";
  /**
   * What the game renders at, as a line count — 2160 is 4K, 1080 is Full
   * HD — or "native" for one buffer pixel per display pixel.
   *
   * A separate axis from `quality` on purpose. They were the same knob:
   * dropping to Battery to buy frames also took bloom, shadows and the
   * paint probe with it, and there was no way to say "keep the effects,
   * render fewer pixels" or the reverse. This is the pixels; that is the
   * effects.
   */
  resolution: Resolution;
  /** 0..1 master levels. */
  musicVolume: number;
  sfxVolume: number;
  /** Bigger HUD for small screens or low vision. */
  largeHud: boolean;
  /** Time of day on the corniche. */
  /** A fixed hour, or "cycle" to let the clock run. */
  sky: "night" | "dawn" | "noon" | "dusk" | "cycle";
  /**
   * Frame pacing. "display" follows the panel's own refresh rate — the
   * right default, and on a VRR/G-Sync panel it also keeps the game
   * inside the variable-refresh window. "vrr" caps a few frames below
   * refresh, which is the standard G-Sync practice: crossing the ceiling
   * drops you out of VRR and back onto v-sync's latency.
   */
  frameCap: "display" | "vrr" | 30 | 60 | 120 | 144 | 165 | 240 | 0;
  /**
   * Picture controls. Exposure is in stops over the automatic metering
   * (or over the shipped default when auto is off); contrast is a gamma
   * about mid-grey; highlights recovers (-) or pushes (+) the top end.
   */
  autoExposure: boolean;
  exposure: number;
  contrast: number;
  highlights: number;
  /** Global saturation. Moderate by default — see DEFAULTS. */
  saturation: number;
}

export const DEFAULT_SETTINGS: Settings = {
  reducedMotion: false,
  colorBlindSafe: false,
  haptics: true,
  quality: "auto",
  // The display's own pixels, which is what a player who has not been
  // asked expects. The ladder is for the two cases the default cannot
  // serve: a window smaller than the GPU can fill, and a panel larger
  // than the GPU can hold.
  resolution: "native",
  musicVolume: 0.32,
  sfxVolume: 0.75,
  largeHud: false,
  sky: "night",
  frameCap: "display",
  autoExposure: true,
  exposure: 0,
  // Moderate, deliberately. A little contrast over neutral gives the
  // night some snap without crushing the shadow detail the fill light
  // exists to put there, and a little saturation over neutral makes
  // sodium orange and neon read as colours rather than as tints —
  // stopping well short of the poster look that turns every lamp into a
  // flat blob of orange.
  contrast: 1.06,
  highlights: 0,
  saturation: 1.08,
};

const KEY = "gulf-road-nights-settings";

export function loadSettings(): Settings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
  applySettings(s);
}

/** Push the CSS-visible settings onto <html>. */
export function applySettings(s: Settings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.reducedMotion = s.reducedMotion ? "1" : "0";
  root.dataset.cvd = s.colorBlindSafe ? "1" : "0";
  root.dataset.largeHud = s.largeHud ? "1" : "0";
}

/** Short, purposeful haptics. Silently absent on desktop and iOS Safari. */
export function haptic(pattern: number | readonly number[], enabled: boolean): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern as number | number[]);
  } catch {}
}

/** Named taps so feedback stays consistent across the game. */
export const HAPTIC = {
  tap: 10,
  impact: 35,
  challenge: [20, 40, 20],
  reward: [15, 30, 15, 30, 60],
} as const;
