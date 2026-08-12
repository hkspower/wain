import * as THREE from "three";

// External art drop-in.
//
// Every surface in the game ships a procedural texture, which is what you
// see by default. This module lets authored artwork — a Photoshop export,
// a scan, a photograph — replace any of those maps without touching the
// world builder: drop the files in `public/textures/`, list them in
// `public/textures/manifest.json`, and they win at boot.
//
// If the manifest is absent (the shipping default) exactly one request is
// made, it 404s, and the procedural textures stand. Nothing else is
// fetched, so the drop-in path costs nothing when unused.

const BASE = "/textures/";

/** The three maps a PBR surface can override. Values are file names
 *  relative to `public/textures/`. */
export interface SurfaceMaps {
  /** Base colour / albedo. Authored in sRGB. */
  map?: string;
  /** Tangent-space normals. */
  normalMap?: string;
  /** Linear roughness, 0 = mirror, 255 = matte. */
  roughnessMap?: string;
}

/** `{ "<surface>": { map, normalMap, roughnessMap } }` — surface keys are
 *  the names the world builder registers, currently just "road". */
export type TextureManifest = Record<string, SurfaceMaps>;

/**
 * Colour maps carry sRGB; normal and roughness maps are *data* and must
 * stay linear. Tagging a roughness map sRGB applies the transfer curve to
 * the sampled value — a 0.5 roughness reads as ~0.21 and the asphalt turns
 * into a black mirror. This project has hit that exact bug before; the
 * split here is what prevents it recurring through the drop-in path.
 */
function adopt(tex: THREE.Texture, previous: THREE.Texture | null, colour: boolean): void {
  tex.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (previous) {
    // Inherit the tiling the world builder chose for this surface — an
    // override that ignores it would tile once across seven kilometres.
    tex.wrapS = previous.wrapS;
    tex.wrapT = previous.wrapT;
    tex.repeat.copy(previous.repeat);
    tex.offset.copy(previous.offset);
    tex.anisotropy = previous.anisotropy;
  } else {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 16;
  }
  tex.needsUpdate = true;
}

/**
 * Swap authored maps into a live material. Loading is asynchronous and
 * failure is silent by design: a missing or corrupt file leaves the
 * procedural texture in place rather than dropping the surface to
 * untextured white mid-race.
 */
export function overrideSurface(
  mat: THREE.MeshStandardMaterial,
  maps: SurfaceMaps,
  loader: THREE.TextureLoader = new THREE.TextureLoader()
): void {
  const slots: Array<[keyof SurfaceMaps & keyof THREE.MeshStandardMaterial, string | undefined, boolean]> = [
    ["map", maps.map, true],
    ["normalMap", maps.normalMap, false],
    ["roughnessMap", maps.roughnessMap, false],
  ];
  for (const [slot, file, colour] of slots) {
    if (!file) continue;
    const previous = (mat[slot] ?? null) as THREE.Texture | null;
    loader.load(
      BASE + file,
      (tex) => {
        adopt(tex, previous, colour);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mat as any)[slot] = tex;
        mat.needsUpdate = true;
        // The procedural original is no longer referenced by any material
        previous?.dispose();
      },
      undefined,
      () => {
        /* absent or unreadable — the procedural map stands */
      }
    );
  }
}

/**
 * Read the manifest and apply whatever it names to the registered
 * surfaces. Safe to call unconditionally: with no manifest present it
 * resolves after a single 404 and changes nothing.
 */
export async function applyTextureManifest(
  surfaces: Record<string, THREE.MeshStandardMaterial>
): Promise<number> {
  let manifest: TextureManifest;
  try {
    const res = await fetch(BASE + "manifest.json", { cache: "no-cache" });
    if (!res.ok) return 0;
    manifest = (await res.json()) as TextureManifest;
  } catch {
    return 0; // offline, static export without the folder, malformed JSON
  }
  const loader = new THREE.TextureLoader();
  let applied = 0;
  for (const [name, maps] of Object.entries(manifest)) {
    const mat = surfaces[name];
    if (!mat || !maps) continue;
    overrideSurface(mat, maps, loader);
    applied++;
  }
  return applied;
}
