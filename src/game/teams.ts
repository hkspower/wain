// Crews — player-made teams with a name, tag and a procedurally drawn
// emblem. The logo is described by a few fields (shape, symbol, colours)
// rather than an uploaded image, so it travels over the hub socket as a
// few bytes and can be redrawn at any size: lobby card, roster row, or
// a decal baked onto the car's roof.

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
    ctx.font = `700 ${Math.round(size * 0.17)}px sans-serif`;
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
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
}
