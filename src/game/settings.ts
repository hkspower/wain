// Player settings — accessibility, quality and feel.
//
// Applied to the document root as data attributes so CSS can react
// without React re-rendering the whole HUD, and mirrored to localStorage
// so a returning player never has to set them twice.

export interface Settings {
  /** Kill non-essential animation (OS setting is also honoured). */
  reducedMotion: boolean;
  /** Swap the rival channel off the red/green confusion pair. */
  colorBlindSafe: boolean;
  /** Vibrate on impacts, challenges and rewards. */
  haptics: boolean;
  /** Render tier: auto follows measured frame rate. */
  quality: "auto" | "ultra" | "high" | "balanced" | "battery";
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
}

export const DEFAULT_SETTINGS: Settings = {
  reducedMotion: false,
  colorBlindSafe: false,
  haptics: true,
  quality: "auto",
  musicVolume: 0.32,
  sfxVolume: 0.75,
  largeHud: false,
  sky: "night",
  frameCap: "display",
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
