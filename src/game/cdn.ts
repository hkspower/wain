// Where the game's static assets are served from.
//
// Every model, texture, music bed, voice line, effect and card image is
// addressed by a root-relative path — `/models/car-gtr.glb` — and for as
// long as Next served public/ from the same origin as the page that was
// the whole story. It still is, by default: with NEXT_PUBLIC_ASSET_BASE
// unset every helper here returns the path it was given, byte for byte,
// so the dev server, the Capacitor bundle and the Electron build keep
// loading from their own public/ exactly as before.
//
// Set it — `NEXT_PUBLIC_ASSET_BASE=https://nr.mawsoool.com` at build
// time, the same way NEXT_PUBLIC_HUB_WS points at the hub (net.ts) — and
// the web build fetches the same paths from that host instead. Next
// inlines the value at build time, which is why it is read through a
// literal `process.env.NEXT_PUBLIC_ASSET_BASE` member access and nowhere
// else; scripts/deploy-assets.mjs is what puts the files there.
//
// A base is an origin plus an optional path prefix, never a trailing
// slash, and always an absolute http(s) URL: anything else — a bare
// host, a typo, an empty string — resolves to "" and the game stays on
// its own origin rather than building URLs against garbage.

/** What a raw NEXT_PUBLIC_ASSET_BASE value resolves to. "" = same origin. */
export function resolveAssetBase(raw: string | undefined): string {
  const s = (raw ?? "").trim().replace(/\/+$/, "");
  if (!s) return "";
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return s;
  } catch {
    return "";
  }
}

/** The base this build was made with. Inlined by Next; must stay a
 *  literal member access. */
export const ASSET_BASE = resolveAssetBase(process.env.NEXT_PUBLIC_ASSET_BASE);

/** `/models/x.glb` → `https://nr.mawsoool.com/models/x.glb`, or the path
 *  unchanged when there is no base. */
export function assetUrl(path: string, base: string = ASSET_BASE): string {
  return base + (path.startsWith("/") ? path : "/" + path);
}

/**
 * The asset host's origin, for a <link rel="preconnect"> — or null when
 * there is nothing remote to warm. Mirrors hubHintOrigin in net.ts: the
 * first model is requested the moment the engine boots, and a hint in
 * the head lets DNS, TCP and TLS happen while the page is still parsing
 * rather than in front of the first .glb.
 */
export function assetHintOrigin(base: string = ASSET_BASE): string | null {
  if (!base) return null;
  try {
    const u = new URL(base);
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
      return null;
    }
    return u.origin;
  } catch {
    return null;
  }
}
