// Crews — player-made teams with a name, tag and a procedurally drawn
// emblem. The logo is described by a few fields (shape, symbol, colours)
// rather than an uploaded image, so it travels over the hub socket as a
// few bytes and can be redrawn at any size: lobby card, roster row, or
// a decal baked onto the car's roof.

import { arabicUI } from "./fonts";

export type LogoShape = "shield" | "circle" | "hex" | "diamond";

export interface TeamLogo {
  shape: LogoShape;
  symbol: string; // emoji or 1-2 glyphs
  bg: string; // hex
  fg: string; // hex (border + symbol tint backdrop)
}

export interface TeamMember {
  id: number;
  name: string;
  online: boolean;
}

export interface Team {
  id: string;
  name: string;
  tag: string; // 2-4 chars, shown next to driver names
  logo: TeamLogo;
  founder: string;
  members: TeamMember[];
}

export const LOGO_SHAPES: LogoShape[] = ["shield", "circle", "hex", "diamond"];

export const LOGO_SYMBOLS = [
  "🦅", "🐆", "🔥", "⚡", "🌙", "⭐", "🏁", "👑",
  "🐫", "🌴", "🦂", "💎", "🛞", "🀄", "☕", "⚓",
];

export const LOGO_COLORS = [
  "#f5a524", "#38c9ee", "#16a34a", "#c1121f", "#b84dd6",
  "#ffffff", "#0d0e11", "#c9a227", "#2e8f96", "#e8641b",
];

export const DEFAULT_LOGO: TeamLogo = {
  shape: "shield",
  symbol: "🦅",
  bg: "#0d1b2a",
  fg: "#f5a524",
};

/** Trace the emblem outline into the current path. */
function shapePath(ctx: CanvasRenderingContext2D, shape: LogoShape, s: number): void {
  const p = s * 0.06; // padding
  const w = s - p * 2;
  ctx.beginPath();
  switch (shape) {
    case "circle":
      ctx.arc(s / 2, s / 2, w / 2, 0, Math.PI * 2);
      break;
    case "hex": {
      const r = w / 2;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const x = s / 2 + Math.cos(a) * r;
        const y = s / 2 + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case "diamond":
      ctx.moveTo(s / 2, p);
      ctx.lineTo(s - p, s / 2);
      ctx.lineTo(s / 2, s - p);
      ctx.lineTo(p, s / 2);
      ctx.closePath();
      break;
    default: {
      // shield: flat shoulders, curved point
      const top = p;
      const bottom = s - p;
      ctx.moveTo(p, top + w * 0.06);
      ctx.lineTo(s - p, top + w * 0.06);
      ctx.lineTo(s - p, s * 0.55);
      ctx.quadraticCurveTo(s - p, bottom, s / 2, bottom);
      ctx.quadraticCurveTo(p, bottom, p, s * 0.55);
      ctx.closePath();
    }
  }
}

/** Draw the emblem onto a canvas context at size×size. */
export function drawTeamLogo(
  ctx: CanvasRenderingContext2D,
  logo: TeamLogo,
  size: number,
  tag?: string
): void {
  ctx.clearRect(0, 0, size, size);
  shapePath(ctx, logo.shape, size);
  ctx.fillStyle = logo.bg;
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.055);
  ctx.strokeStyle = logo.fg;
  ctx.stroke();

  // Symbol sits high when a tag is stamped underneath
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const symbolY = tag ? size * 0.42 : size * 0.5;
  ctx.font = `${Math.round(size * (tag ? 0.4 : 0.48))}px sans-serif`;
  ctx.fillText(logo.symbol, size / 2, symbolY);

  if (tag) {
    ctx.fillStyle = logo.fg;
    ctx.font = `700 ${Math.round(size * 0.17)}px ${arabicUI()}`;
    ctx.fillText(tag.toUpperCase().slice(0, 4), size / 2, size * 0.74);
  }
}

/** Render the emblem to a data URL (car decals, <img> previews). */
export function teamLogoDataUrl(logo: TeamLogo, size = 128, tag?: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  drawTeamLogo(ctx, logo, size, tag);
  return c.toDataURL();
}

export function sanitizeTag(raw: string): string {
  // Arabic letters and Arabic-Indic digits count as tag characters.
  //
  // This used to strip everything but A-Z0-9, which meant a crew in a
  // game set on the Gulf Road, whose menus and rivals are all in Arabic,
  // could not write its own name in Arabic: the tag came back empty, and
  // the server — which applies the same rule and then drops any team
  // with an empty tag — threw the whole creation away without saying so.
  // toUpperCase is a no-op on Arabic, which has no letter case.
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9\u0621-\u064A\u0660-\u0669]/g, "")
    .slice(0, 4);
}

/**
 * YOUR CREW, KEPT LOCALLY
 *
 * A team used to exist in exactly one place: the hub server's memory. It
 * followed that you could not have a crew unless a hub was running and
 * you were connected to it, that your crew vanished when that process
 * restarted, and that nothing in the actual game — not the car, not the
 * HUD, not the garage — had ever heard of it. The emblem this file goes
 * to the trouble of drawing was visible on one lobby page and nowhere
 * else, including "a decal baked onto the car's roof", which is written
 * at the top of this file and had never been built.
 *
 * So the crew is a LOCAL identity now, saved beside the garage. You
 * build one in the garage, it goes on your car, and it is there whether
 * or not anything is listening on a socket. The hub is how a crew gets
 * SHARED — it publishes what you already have and gathers the members —
 * rather than the only place one can exist.
 */
export interface Crew {
  name: string;
  tag: string;
  logo: TeamLogo;
}

const CREW_KEY = "gulf-road-nights-crew";
/** Where the hub used to mirror a crew: three loose fields on the
 *  profile, written on every team update and read by nothing. Kept only
 *  so a save made before this file owned the crew still has one. */
const LEGACY_PROFILE_KEY = "gulf-road-nights-profile";

/** The crew this save is flying, or null for a privateer. */
export function loadCrew(): Crew | null {
  try {
    const raw = localStorage.getItem(CREW_KEY) ?? legacyCrewJson();
    if (!raw) return null;
    const c = JSON.parse(raw) as Crew;
    if (!c || typeof c.name !== "string" || typeof c.tag !== "string") return null;
    if (!c.logo || typeof c.logo.shape !== "string") return null;
    // A crew with an empty tag is one the hub would silently throw away,
    // so it is not a crew here either.
    const tag = sanitizeTag(c.tag);
    if (!tag || !c.name.trim()) return null;
    return { name: c.name.slice(0, 24), tag, logo: c.logo };
  } catch {
    return null;
  }
}

function legacyCrewJson(): string | null {
  try {
    const raw = localStorage.getItem(LEGACY_PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { teamName?: string; teamTag?: string; teamLogo?: TeamLogo };
    if (!p?.teamName || !p?.teamTag || !p?.teamLogo) return null;
    return JSON.stringify({ name: p.teamName, tag: p.teamTag, logo: p.teamLogo });
  } catch {
    return null;
  }
}

export function saveCrew(c: Crew | null): void {
  try {
    if (c) {
      localStorage.setItem(CREW_KEY, JSON.stringify(c));
      return;
    }
    localStorage.removeItem(CREW_KEY);
    // Leaving a crew has to clear the old mirror too, or the migration
    // above hands it straight back on the next read and "race solo" is a
    // button that does nothing.
    const raw = localStorage.getItem(LEGACY_PROFILE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (p.teamName === undefined && p.teamTag === undefined && p.teamLogo === undefined) return;
    delete p.teamName;
    delete p.teamTag;
    delete p.teamLogo;
    localStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify(p));
  } catch {}
}
