/**
 * The city facade's skin: the masonry textures, their uniforms, and the
 * GLSL spliced into three.js's MeshStandardMaterial to wear them.
 *
 * One material and four draw calls, as before. cityBlocks, citySetbacks,
 * cityPodiums and cityDrums all wear the material world.ts builds with
 * glazedMat(windows, ...); what changes is what an opaque facade texel
 * is. The window maps keep the windows — the glass, its bars, its lit
 * rooms at night — and everything the roughness map marks as wall now
 * comes from a masonry layer chosen per building:
 *
 *   roughness map  R = masonry FIELD coverage (the wall between windows)
 *                  G = roughness, unchanged (the glass test still holds)
 *                  B = OPAQUE coverage (anything that is not glass/bars)
 *
 * Both masks are coverage, so the window map's mips average them
 * linearly and the shader reads field = R/B and opaque = B at any
 * distance. A threshold on G instead would have faded the masonry out
 * with distance, because a mip that mixes glass and wall falls below it.
 * Opaque but not field is TRIM — floor bands and window surrounds, the
 * concrete frame a Kuwaiti infill block is — coloured per family.
 *
 * Rejected: a material per family (16 draws, or splitting every instanced
 * mesh four ways) and one 2D atlas (needs fract() and textureGrad, and
 * its mips bleed one family into the next). A DataArrayTexture is one
 * sampler with four layers and exact mips per layer: 6.3 MB for the
 * pair with mips, against ~22 MB for the window maps.
 */
import * as THREE from "three";
import {
  FAMILIES,
  FACADE_ALBEDO_GAIN,
  FACADE_WALL_LUMA,
  GROUND_STOREY_M,
  MASONRY_TILE_M,
  MODULES_PER_TILE,
  STONE_COURSE_M,
  buildMasonry,
  srgbToLinear,
  type MasonryMaps,
} from "./masonry";

/** Bump when the GLSL below changes: three.js caches programs by this. */
export const FACADE_SKIN_CACHE_KEY = "grn-facade-masonry-1";

export interface MasonryTextures {
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
}

/**
 * The two array textures.
 *
 * Linear magnification, deliberately unlike the window maps: three.js
 * r184 skips anisotropic filtering whenever magFilter is Nearest
 * (WebGLTextures.js, "if ( texture.magFilter === NearestFilter ) return"),
 * so the window maps' anisotropy = 16 has never applied. These get it.
 */
export function masonryTextures(maps: MasonryMaps = buildMasonry()): MasonryTextures {
  const mk = (data: Uint8Array, colorSpace: THREE.ColorSpace) => {
    const t = new THREE.DataArrayTexture(data, maps.n, maps.n, maps.layers);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.colorSpace = colorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 16;
    t.needsUpdate = true;
    return t;
  };
  return {
    albedo: mk(maps.albedo, THREE.SRGBColorSpace),
    // Data, not colour: decoded as sRGB, a normal's 0.5 would read 0.21.
    normal: mk(maps.normal, THREE.NoColorSpace),
  };
}

const lin = (c: readonly [number, number, number]) => new THREE.Vector3(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]));
const vec = (c: readonly [number, number, number]) => new THREE.Vector3(c[0], c[1], c[2]);

/**
 * Every uniform the GLSL below declares, by name. Kept on the material
 * (userData.grnMasonry.uniforms) and shared with the compiled program, so
 * a tool can move grnGain or grnDebug without a recompile.
 */
export function facadeSkinUniforms(t: MasonryTextures) {
  return {
    grnAlb: { value: t.albedo },
    grnNrm: { value: t.normal },
    grnTileM: { value: FAMILIES.map(() => MASONRY_TILE_M) },
    grnModule: { value: MODULES_PER_TILE.map(([c, r, b], f) => new THREE.Vector4(c, r, b, FAMILIES[f].jitter)) },
    grnTrim: { value: FAMILIES.map((f) => lin(f.trim)) },
    grnTintA: { value: FAMILIES.map((f) => vec(f.tintA)) },
    grnTintB: { value: FAMILIES.map((f) => vec(f.tintB)) },
    grnNormalScale: { value: FAMILIES.map((f) => f.normalScale) },
    grnGain: { value: FACADE_ALBEDO_GAIN },
    grnWallLuma: { value: FACADE_WALL_LUMA },
    grnBaseM: { value: GROUND_STOREY_M },
    grnBaseCourseM: { value: STONE_COURSE_M },
    grnDebug: { value: 0 },
  };
}
export type FacadeSkinUniforms = ReturnType<typeof facadeSkinUniforms>;

export interface FacadeShaderOpts {
  /** The window maps' tile, metres (world.ts FACADE_TILE_M). */
  tileX: number;
  tileY: number;
  /** The city floor's height (track.ts CITY_GROUND_Y). */
  cityGroundY: number;
}

const f1 = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** The window-map UV scaling every facade has worn since the blocks went
 *  instanced (see the note above STEM_H in world.ts): each face's UVs
 *  scaled by the instance's own span over the window tile. */
const uvScaling = (o: FacadeShaderOpts) => `
  vec3 grnScale = vec3(
    length(instanceMatrix[0].xyz),
    length(instanceMatrix[1].xyz),
    length(instanceMatrix[2].xyz));
  vec3 grnN = abs(normal);
  // Which two of the box's three extents this face actually spans.
  vec2 grnSpan;
  if (grnN.y > 0.5) grnSpan = vec2(grnScale.x, grnScale.z);
  else if (grnN.x > 0.5) grnSpan = vec2(grnScale.z, grnScale.y);
  else grnSpan = vec2(grnScale.x, grnScale.y);
  vec2 grnTile = grnSpan / vec2(${f1(o.tileX)}, ${f1(o.tileY)});
  #ifdef USE_MAP
    vMapUv *= grnTile;
  #endif
  #ifdef USE_EMISSIVEMAP
    vEmissiveMapUv *= grnTile;
  #endif
  // The roughness map rides its own UV in this three.js — left untiled
  // it would put the polished patches off their own panes.
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv *= grnTile;
  #endif`;

// The varyings. Family and seed are flat: they are per instance, and an
// interpolated copy of a constant can come back a hair off it — which
// floor(seed * 4096) would turn into a different brick pattern along a
// triangle edge.
const VARYINGS = `
varying vec2 vGrnMuv;
varying float vGrnY;
flat varying float vGrnFam;
flat varying float vGrnSeed;`;

const VERTEX_COMMON = `
uniform float grnTileM[4];
${VARYINGS}
#ifdef USE_INSTANCING
  attribute vec2 grnMasonry;
#endif`;

const vertexUv = (o: FacadeShaderOpts) => `
#ifdef USE_INSTANCING
${uvScaling(o)}
  // The masonry's own UV: metres along and up the face over its tile,
  // slid sideways by the building's seed so no two buildings start their
  // bond on the same brick.
  int grnF = int(clamp(grnMasonry.x, 0.0, 3.0) + 0.5);
  vGrnFam = grnMasonry.x;
  vGrnSeed = grnMasonry.y;
  vGrnMuv = uv * grnSpan / grnTileM[grnF] + vec2(grnMasonry.y * 5.0, 0.0);
  // Height above the pavement, for the stone plinth.
  vGrnY = (modelMatrix * instanceMatrix * vec4(position, 1.0)).y - (${o.cityGroundY.toFixed(4)});
#else
  vGrnFam = -1.0;
  vGrnSeed = 0.0;
  vGrnMuv = vec2(0.0);
  vGrnY = 0.0;
#endif`;

const FRAGMENT_COMMON = `
uniform sampler2DArray grnAlb;
uniform sampler2DArray grnNrm;
uniform vec4 grnModule[4];
uniform vec3 grnTrim[4];
uniform vec3 grnTintA[4];
uniform vec3 grnTintB[4];
uniform float grnNormalScale[4];
uniform float grnGain;
uniform float grnWallLuma;
uniform float grnBaseM;
uniform float grnBaseCourseM;
uniform float grnDebug;
${VARYINGS}
// A module's tone jitter: an integer hash of its cell. Cells are never
// negative here (uv >= 0 and the seed offset is positive).
float grnHash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)));
  uint h = (q.x * 0x8da6b343u) ^ (q.y * 0xd8163841u);
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return float(h) * (1.0 / 4294967296.0);
}
// three.js's getTangentFrame, which it only compiles for a material with
// a normal map of its own: tangent space from screen derivatives.
mat3 grnTangentFrame(vec3 eye, vec3 n, vec2 uv) {
  vec3 q0 = dFdx(eye);
  vec3 q1 = dFdy(eye);
  vec2 st0 = dFdx(uv);
  vec2 st1 = dFdy(uv);
  vec3 q1perp = cross(q1, n);
  vec3 q0perp = cross(n, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(T * s, B * s, n);
}`;

/**
 * After color_fragment: diffuseColor is map x instance colour here, and
 * the masonry REPLACES it on opaque texels — so the palette tint that
 * still colours the glass and its bars no longer greys every wall. The
 * per-building variety on a wall comes from its seed instead: the
 * family's tint range, and a per-module tone jitter that fades out once a
 * module is under ~2 px, before it can sparkle.
 */
const FRAGMENT_COLOR = `
float grnOpaque = 0.0;
float grnField = 0.0;
int grnL = 0;
vec4 grnN = vec4(0.5, 0.5, 1.0, 1.0);
#if defined( USE_MAP ) && defined( USE_ROUGHNESSMAP )
{
  vec4 grnR = texture2D(roughnessMap, vRoughnessMapUv);
  grnOpaque = step(0.0, vGrnFam) * grnR.b;
  grnField = grnR.b > 0.004 ? clamp(grnR.r / grnR.b, 0.0, 1.0) : 0.0;
  int grnF = int(clamp(vGrnFam, 0.0, 3.0) + 0.5);
  grnL = grnF;
  // A rendered building stands on a stone plinth: whole stone courses up
  // to the one nearest the ground storey.
  if (grnF == 2) {
    float grnSg = vGrnMuv.y * grnModule[1].y;
    float grnTop = vGrnY + (floor(grnSg) + 1.0 - grnSg) * grnBaseCourseM;
    if (grnTop < grnBaseM + 0.5 * grnBaseCourseM) grnL = 1;
  }
  vec4 grnA = texture(grnAlb, vec3(vGrnMuv, float(grnL)));
  grnN = texture(grnNrm, vec3(vGrnMuv, float(grnL)));
  vec4 grnMod = grnModule[grnL];
  vec2 grnG = vGrnMuv * grnMod.xy;
  float grnRow = floor(grnG.y);
  vec2 grnCell = vec2(floor(grnG.x + grnMod.z * mod(grnRow, 2.0)), grnRow);
  // Modules per pixel: past ~0.5 (a module under 2 px) the jitter goes.
  float grnPx = max(length(dFdx(grnG)), length(dFdy(grnG)));
  float grnJit = 1.0 + (grnHash(grnCell + floor(vGrnSeed * 4096.0 + 0.5)) - 0.5)
    * 2.0 * grnMod.w * (1.0 - smoothstep(0.3, 0.6, grnPx));
  vec3 grnWall = mix(grnTrim[grnF] * (0.8 + 0.4 * grnA.a), grnA.rgb * grnJit, grnField)
    * mix(grnTintA[grnF], grnTintB[grnF], vGrnSeed) * grnGain;
  // The window map's own shading of its opaque texels — the floor band's
  // shadow line, the lighter surrounds — kept as a ratio to the old wall,
  // where a texel is wholly opaque (in a mip that mixes in glass the
  // ratio would be the glass's, not the wall's).
  grnWall *= mix(1.0, dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / grnWallLuma,
    smoothstep(0.98, 1.0, grnR.b));
  diffuseColor.rgb = mix(diffuseColor.rgb, grnWall, grnOpaque);
}
#endif`;

const FRAGMENT_ROUGH = `
#ifdef USE_ROUGHNESSMAP
  roughnessFactor = mix(roughnessFactor, roughness * mix(texelRoughness.g, grnN.a, grnField), grnOpaque);
#endif`;

const FRAGMENT_NORMAL = `
{
  vec3 grnNt = grnN.xyz * 2.0 - 1.0;
  grnNt.xy *= grnNormalScale[grnL] * grnField * grnOpaque;
  normal = normalize(grnTangentFrame(-vViewPosition, normal, vGrnMuv) * grnNt);
}`;

// The mask pass for the instruments: red masonry field, green trim, blue
// glass. Set userData.grnMasonry.uniforms.grnDebug.value = 1.
const FRAGMENT_DEBUG = `
if (grnDebug > 0.5) gl_FragColor = vec4(grnOpaque * grnField, grnOpaque * (1.0 - grnField), 1.0 - grnOpaque, 1.0);`;

/** Insert `code` after the one occurrence of `anchor`, or report that
 *  there is not exactly one. */
function after(src: string, anchor: string, code: string): string | null {
  const i = src.indexOf(anchor);
  if (i < 0 || src.indexOf(anchor, i + anchor.length) >= 0) return null;
  const j = i + anchor.length;
  return `${src.slice(0, j)}\n${code}\n${src.slice(j)}`;
}

/** The anchors, in three.js's own chunk names. tests/masonry.mjs checks
 *  each appears exactly once in the shipped MeshStandardMaterial. */
export const FACADE_ANCHORS = {
  vertex: ["#include <common>", "#include <uv_vertex>"],
  fragment: [
    "#include <common>",
    "#include <color_fragment>",
    "#include <roughnessmap_fragment>",
    "#include <normal_fragment_maps>",
    "#include <dithering_fragment>",
  ],
} as const;

/**
 * Splice the facade into a MeshStandardMaterial's shaders.
 *
 * All or nothing. A String.replace whose anchor is missing does nothing
 * and says nothing, and half a splice — a varying written in one stage
 * and not declared in the other — is a shader that does not compile. So
 * if any anchor is missing the masonry is left out whole, the window-map
 * UV scaling is applied alone (the facade as it was before this), and
 * `ok` is false for the caller to report.
 */
export function patchFacadeShaders(vertexShader: string, fragmentShader: string, o: FacadeShaderOpts): { vertexShader: string; fragmentShader: string; ok: boolean } {
  let v: string | null = vertexShader;
  let f: string | null = fragmentShader;
  v = after(v, "#include <common>", VERTEX_COMMON);
  v = v && after(v, "#include <uv_vertex>", vertexUv(o));
  f = after(f, "#include <common>", FRAGMENT_COMMON);
  f = f && after(f, "#include <color_fragment>", FRAGMENT_COLOR);
  f = f && after(f, "#include <roughnessmap_fragment>", FRAGMENT_ROUGH);
  f = f && after(f, "#include <normal_fragment_maps>", FRAGMENT_NORMAL);
  f = f && after(f, "#include <dithering_fragment>", FRAGMENT_DEBUG);
  if (v && f) return { vertexShader: v, fragmentShader: f, ok: true };
  const uvOnly = after(vertexShader, "#include <uv_vertex>", `#ifdef USE_INSTANCING\n${uvScaling(o)}\n#endif`);
  return { vertexShader: uvOnly ?? vertexShader, fragmentShader, ok: false };
}

/**
 * Dress a facade material: the masonry layers, chosen per instance by the
 * geometry's `grnMasonry` attribute (family, seed).
 *
 * Every mesh wearing the material needs that attribute — an instance
 * without one reads (0, 0): brick, seed 0. Non-instanced draws compile
 * the #else branch and keep the window map's wall.
 */
export function applyFacadeSkin(mat: THREE.MeshStandardMaterial, t: MasonryTextures, o: FacadeShaderOpts): FacadeSkinUniforms {
  const uniforms = facadeSkinUniforms(t);
  mat.defines = { ...(mat.defines ?? {}), GRN_MASONRY: "" };
  mat.userData.grnMasonry = { uniforms, albedo: t.albedo, normal: t.normal };
  mat.onBeforeCompile = (shader) => {
    const p = patchFacadeShaders(shader.vertexShader, shader.fragmentShader, o);
    if (!p.ok) console.warn("facadeSkin: a shader anchor is missing in this three.js; facades drawn without masonry");
    else Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = p.vertexShader;
    shader.fragmentShader = p.fragmentShader;
  };
  // Without this the instanced and non-instanced compilations share a
  // cache entry and whichever compiles first wins for both.
  mat.customProgramCacheKey = () => FACADE_SKIN_CACHE_KEY;
  return uniforms;
}
