// Interface sound effects.
//
// If `scripts/generate-sfx.mjs` has been run with an ElevenLabs key, the
// clips in public/sfx/ are used. If not, every call is a silent no-op and
// the procedural stings in sound.ts carry the game — so the interface is
// never broken by a missing asset, only less rich.
//
// That silence is a design, and it has to be a design rather than an
// accident: for a long time it was an accident, and the difference is
// invisible from outside. See ensureManifest.
//
// The eight names below are the interface's own vocabulary and none of
// them is in the shipped manifest, which carries the six IN-GAME effects
// (bump, scrape, blowoff, shift, flash, skid) that sound.ts consumes. So
// the interface is silent today because those clips have not been
// rendered — which is the documented fallback — and not because the
// reader could not read the file.

export type SfxName =
  | "ui-tap"
  | "ui-confirm"
  | "xp-tick"
  | "level-up"
  | "unlock"
  | "victory"
  | "defeat"
  | "challenge";

/** Name -> the file that IS that sound, from the manifest. */
let manifest: Map<string, string> | null = null;
let loading: Promise<void> | null = null;
const cache = new Map<string, HTMLAudioElement>();
let volume = 0.75;

/**
 * Fetch the manifest once; absent manifest means "no generated sfx".
 *
 * TWO READERS, ONE FILE. sound.ts reads /sfx/manifest.json as an OBJECT
 * — `{ bump: { file, gain }, ... }` — which is the shape the generator
 * writes and the shape that ships. This reader expected an ARRAY of
 * names, so `Array.isArray` was false on every real manifest, the set
 * came back empty, and every interface sound in the game — tap, confirm,
 * xp tick, level up, unlock, victory, defeat, challenge — was a silent
 * no-op for as long as a manifest existed. Not a missing asset: a schema
 * mismatch between two readers of one filename, which is why nobody
 * noticed. The array shape is still accepted, because a generator that
 * writes one is not wrong, only older.
 */
function ensureManifest(): Promise<void> {
  if (loading) return loading;
  loading = fetch("/sfx/manifest.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((parsed: unknown) => {
      // NAME -> FILE, not just the names.
      //
      // The names and the files are not the same strings and were never
      // meant to be: the manifest says `bump` is `impact.mp3` and `skid`
      // is `skid-loop.mp3`, which is the whole reason it has a `file`
      // field. This reader kept only the keys and then built its URLs as
      // `/sfx/${name}.mp3`, so preloading the shipped set asked for
      // /sfx/bump.mp3 and /sfx/skid.mp3 — two 404s on every single page
      // load, for two of the six effects the game actually ships.
      //
      // The array shape still works and maps a name to itself, because a
      // generator that writes one is not wrong, only older.
      manifest = new Map();
      if (Array.isArray(parsed)) {
        for (const n of parsed as string[]) manifest.set(n, `${n}.mp3`);
      } else if (parsed && typeof parsed === "object") {
        for (const [n, e] of Object.entries(parsed as Record<string, { file?: string }>)) {
          manifest.set(n, e?.file ?? `${n}.mp3`);
        }
      }
    })
    .catch(() => {
      manifest = new Map();
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
    const file = manifest?.get(name);
    if (!file) return;
    let base = cache.get(name);
    if (!base) {
      base = new Audio(`/sfx/${file}`);
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
    for (const [name, file] of manifest) {
      if (cache.has(name)) continue;
      const a = new Audio(`/sfx/${file}`);
      a.preload = "auto";
      cache.set(name, a);
    }
  });
}
