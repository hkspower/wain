// Interface sound effects.
//
// If `scripts/generate-sfx.mjs` has been run with an ElevenLabs key, the
// clips in public/sfx/ are used. If not, every call is a silent no-op and
// the procedural stings in sound.ts carry the game — so the interface is
// never broken by a missing asset, only less rich.

export type SfxName =
  | "ui-tap"
  | "ui-confirm"
  | "xp-tick"
  | "level-up"
  | "unlock"
  | "victory"
  | "defeat"
  | "challenge";

let manifest: Set<string> | null = null;
let loading: Promise<void> | null = null;
const cache = new Map<string, HTMLAudioElement>();
let volume = 0.75;

/** Fetch the manifest once; absent manifest means "no generated sfx". */
function ensureManifest(): Promise<void> {
  if (loading) return loading;
  loading = fetch("/sfx/manifest.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((list: string[]) => {
      manifest = new Set(Array.isArray(list) ? list : []);
    })
    .catch(() => {
      manifest = new Set();
    });
  return loading;
}

export function setSfxVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  for (const a of cache.values()) a.volume = volume;
}

/**
 * Play a named effect. Fire-and-forget: overlapping calls clone the
 * element so a rapid sequence (an XP counter, say) never cuts itself off.
 */
export function playSfx(name: SfxName, gain = 1): void {
  if (typeof window === "undefined") return;
  void ensureManifest().then(() => {
    if (!manifest?.has(name)) return;
    let base = cache.get(name);
    if (!base) {
      base = new Audio(`/sfx/${name}.mp3`);
      base.preload = "auto";
      cache.set(name, base);
    }
    const node = base.cloneNode() as HTMLAudioElement;
    node.volume = Math.max(0, Math.min(1, volume * gain));
    // Autoplay policy: before the first gesture this rejects. That is
    // fine — the first sound a player hears is after they tap anyway.
    void node.play().catch(() => {});
  });
}

/** Warm the cache so the first play is not late. */
export function preloadSfx(): void {
  if (typeof window === "undefined") return;
  void ensureManifest().then(() => {
    if (!manifest) return;
    for (const name of manifest) {
      if (cache.has(name)) continue;
      const a = new Audio(`/sfx/${name}.mp3`);
      a.preload = "auto";
      cache.set(name, a);
    }
  });
}
