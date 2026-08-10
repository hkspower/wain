// Driver profile — career level, XP and lifetime stats.
//
// KD (in mods.ts) is the spendable currency; XP is the thing that only
// ever goes up. Keeping them in separate stores means a bad night at the
// stakes table never erases progress, which is what makes the results
// screen feel worth reading even after a loss.

export interface Profile {
  xp: number;
  races: number;
  wins: number;
  losses: number;
  /** Fastest speed ever recorded, km/h. */
  topSpeed: number;
  /** Best lap, ms. 0 = none yet. */
  bestLapMs: number;
  /** Wins taken without touching another car. */
  cleanWins: number;
  /** Longest run of wins. */
  streak: number;
  bestStreak: number;
}

export const DEFAULT_PROFILE: Profile = {
  xp: 0,
  races: 0,
  wins: 0,
  losses: 0,
  topSpeed: 0,
  bestLapMs: 0,
  cleanWins: 0,
  streak: 0,
  bestStreak: 0,
};

// NOTE: distinct from "gulf-road-nights-profile", which net.ts owns for
// the online identity (name, colour, flag).
const KEY = "gulf-road-nights-career";

/** XP needed to leave level `l`. Gently superlinear: 400, 620, 840, … */
export function xpForLevel(l: number): number {
  return 400 + (l - 1) * 220;
}

export interface LevelInfo {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level costs in total. */
  need: number;
  /** 0..1 fill of the level bar. */
  pct: number;
}

export function levelInfo(xp: number): LevelInfo {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  // Levels are cheap enough that a straight walk is faster than the
  // closed form is readable, and it never runs more than ~40 times.
  for (;;) {
    const need = xpForLevel(level);
    if (rest < need || level >= 99) return { level, into: rest, need, pct: Math.min(1, rest / need) };
    rest -= need;
    level++;
  }
}

/** Titles the player earns as the level climbs — shown on the results card. */
export function rankTitle(level: number): { en: string; ar: string } {
  if (level >= 30) return { en: "Legend of the Corniche", ar: "أسطورة الكورنيش" };
  if (level >= 22) return { en: "Gulf Road King", ar: "ملك شارع الخليج" };
  if (level >= 16) return { en: "Night Boss", ar: "زعيم الليل" };
  if (level >= 11) return { en: "Corniche Veteran", ar: "خبير الكورنيش" };
  if (level >= 7) return { en: "Salmiya Runner", ar: "حريف السالمية" };
  if (level >= 4) return { en: "Street Racer", ar: "متسابق شوارع" };
  return { en: "Rookie", ar: "مبتدئ" };
}

export function loadProfileStats(): Profile {
  if (typeof window === "undefined") return { ...DEFAULT_PROFILE };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {}
  return { ...DEFAULT_PROFILE };
}

export function saveProfileStats(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

/** Apply the outcome of one race and return the profile before and after. */
export function recordRace(
  gain: number,
  outcome: "win" | "loss",
  extra: { topSpeed: number; clean: boolean }
): { before: Profile; after: Profile } {
  const before = loadProfileStats();
  const after: Profile = { ...before };
  after.xp += Math.max(0, Math.round(gain));
  after.races += 1;
  after.topSpeed = Math.max(before.topSpeed, Math.round(extra.topSpeed));
  if (outcome === "win") {
    after.wins += 1;
    after.streak = before.streak + 1;
    after.bestStreak = Math.max(before.bestStreak, after.streak);
    if (extra.clean) after.cleanWins += 1;
  } else {
    after.losses += 1;
    after.streak = 0;
  }
  saveProfileStats(after);
  return { before, after };
}

/** Record a lap time; returns true when it is a new personal best. */
export function recordLap(ms: number): boolean {
  const p = loadProfileStats();
  if (p.bestLapMs === 0 || ms < p.bestLapMs) {
    p.bestLapMs = Math.round(ms);
    saveProfileStats(p);
    return true;
  }
  return false;
}
