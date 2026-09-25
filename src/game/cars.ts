import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TessellateModifier } from "three/examples/jsm/modifiers/TessellateModifier.js";
import { EXHAUSTS, FINISHES, kitAtLeast, type ExhaustSpec, type KitLevel, type PaintFinish } from "./mods";
import { PAINTS, currentPaintHex, type CarbonLevel } from "./paints";
import { upgradeCarShells, upgradeWheels, upgradeDriver, upgradePoliceBar } from "./models";
import { arabicUI, arabicSign, latinDisplay, textTexture } from "./text";
import { kuwaitiDriver } from "./characters";
import { RIG } from "./rig";
import { solveDriverRig, lookAheadFor } from "./driver";
import { pointGlowTexture, poolGlowTexture } from "./glow";
import { drawTeamLogo, type TeamLogo } from "./teams";
import { glassLook, type TintFilm } from "./tint";
import { BODY_EULER_ORDER, WHEEL_EULER_ORDER } from "./suspension";

// Procedural sedans with a real silhouette: the body and glasshouse are
// bevel-extruded side profiles (smoothed normals), riding on spoked
// wheels the engine spins with road speed. Built facing +Z; footprint
// stays ~1.9 x 4.4 m so gameplay collision sizes are unchanged.
//
// group.userData: { wheels: Group[4] (fl, fr, rl, rr), tailMat }

/** Silhouette family. "zx" is the long-nose fastback wedge of a Z32
 *  300ZX; "gtr" is the boxy, high-decked muscle of an R34 Skyline. */
export type BodyStyle =
  | "sedan" | "zx" | "gtr" | "rx7" | "hatch" | "pony" | "pickup" | "super" | "suv";

export interface CarColors {
  body: number;
  accent?: number;
  /** Body silhouette; default is the original sedan. */
  style?: BodyStyle;
  /** Neon underglow colour — TXR rival style. */
  underglow?: number;
  /** Skip the fine detailing (seams, trim, interior) — used for traffic. */
  simple?: boolean;
  /** GT wing on the trunk (garage mod). */
  spoiler?: boolean;
  /** The fitted exhaust system: sets the tips and where flame comes out. */
  exhaust?: ExhaustSpec;
  /**
   * Three wheels instead of four: one on the centreline at the front,
   * two big ones driving at the back.
   *
   * A property of the MACHINE rather than of a kit — you cannot bolt a
   * wheel on or take one off — so it rides on the car record and the
   * builder reads it here. Everything downstream was already written to
   * loop over whatever wheels exist (applySuspension maps over the
   * array); the one place that counted to four was spinWheels, and it
   * reads the plan now instead of the indices.
   */
  trike?: boolean;
  /** Gold rims (garage mod). */
  goldRims?: boolean;
  /** The wheel the car was DELIVERED on, when it came with its own.
   *  Absent means the kit decides. See wheelFinishFor for the order. */
  rims?: WheelFinish;
  /** This car's own front face. Absent falls back to the silhouette's,
   *  which is what traffic and any caller that predates this gets. */
  face?: FaceSpec;
  /**
   * A livery the car was built wearing.
   *
   * Distinct from `stickers`, which is the Rally Sticker Pack — a thing
   * bought in the garage and fitted to whatever you own. This is a
   * finish that came with the machine and cannot be taken off it, and
   * it is why the two are separate fields rather than one enum: a car
   * can wear both, and the pack going on a liveried car must not read
   * as the livery being replaced.
   */
  livery?: Livery;
  /** Sidewall lettering — the tyre sticker package. Cosmetic: it changes
   *  nothing about how the car drives, and the shop says so. */
  tyreSticker?: TyreSticker;
  /**
   * What has been done to the headlamps.
   *
   * - `stock` — as it left the showroom.
   * - `smoked` — tinted lenses. The lamp still lights and still throws
   *   a beam; it just does it through dark glass, so the face reads as
   *   two dark slots by day and two dull ambers at night.
   * - `single` — one lamp taken out and the housing left open. The
   *   one-eye look, and the car really does drive on one beam: the
   *   removed side is not recorded in `lampPositions`, so the engine
   *   has nothing to hang a light on there.
   * - `round` — a pair of round lamps in chrome rings, conversion
   *   buckets cut into the nose. Replaces whatever face the silhouette
   *   came with, on every silhouette.
   * - `laser` — one continuous line across the whole nose, cold white,
   *   with a hotter filament running inside it. Also replaces the face.
   *
   * The last two are face swaps rather than lens treatments, which is
   * why they are handled before the per-silhouette branch: a car with
   * round lamps has no Z32 light bar, and pop-up doors have nothing to
   * lift if what is under them runs the width of the car.
   */
  headlamps?: "stock" | "smoked" | "single" | "round" | "laser";
  /** Window tint, 0-100 per cent. Absent is factory glass. */
  tint?: number;
  /** Which film that tint is. Absent is bare glass — the darkness above
   *  is a free slider and the film is the part that was bought, so
   *  without one the car wears factory glass whatever the slider says. */
  tintFilm?: TintFilm;
  /** Lacquer finish: gloss, satin or matte. Absent is gloss. */
  finish?: PaintFinish;
  /**
   * Racing stripes.
   *
   * `single` is the centre bar this build has always had — bonnet, and
   * boot where the body has one.
   *
   * `twin` is the pair that runs OVER THE TOP: up the nose, along the
   * hood, across the roof, down the rear glass and onto the deck, in
   * one unbroken run. It is a different thing from two single stripes,
   * because the whole point of it is that it does not stop at the
   * windscreen — and making it not stop means following whichever shell
   * happens to be the top surface at each point along the car.
   */
  stripes?: "single" | "twin";
  /** Full time-attack aero: swan-neck wing, splitter, canards, vented
   *  hood, skirts, diffuser, bronze six-spokes and teal calipers.
   *  Equivalent to `kit: "attack"`, and kept because most callers only
   *  ever asked the yes/no question. */
  raceKit?: boolean;
  /**
   * How far this car is built: street, sport or attack. Absent means
   * street, which is the weakest step rather than "stock" — there is no
   * stock step, because nothing on this road at two in the morning is
   * stock.
   *
   * Drives the arch flares and the track width, and gates the aero that
   * is not part of the full attack kit.
   */
  kit?: KitLevel;
  /** Rally sticker pack: door roundels, beltline stripes, hood decal,
   *  Kuwait flags on the rear quarters. */
  stickers?: boolean;
  /** Racing number for the roundels; derived from the paint if absent. */
  stickerNumber?: number;
  /** The full-length side graphic: one sticker, nose to tail, following
   *  the body rather than hung off it. Bought on its own — it is not
   *  part of the rally pack and does not arrive with a kit. */
  fullStripe?: boolean;
  /** The car's own name, for the flank wordmark in the sticker pack. */
  name?: string;
  nameAr?: string;
  /** Overall length in metres. When given, the shell is SCALED until it
   *  measures this — see the fit at the end of createCar. */
  lengthM?: number;
  /** The crew this car runs for: emblem and name on the roof.
   *  Absent means a privateer, which is what every car was until now. */
  crew?: { name: string; tag: string; logo: TeamLogo };
  /**
   * The cam cover's colour, or absent for the stock black plastic.
   *
   * Setting this also cuts vents in the bonnet, because a cover under a
   * sealed bonnet is a thing nobody can see. The two are one purchase in
   * the shop and one field here for the same reason.
   */
  engineCover?: number;
  /** How much of the bodywork is cloth rather than steel. */
  carbon?: CarbonLevel;
}

/**
 * How hard the rear lamps burn, in one place.
 *
 * These were six numbers spread across two files: three baked into the
 * materials here and three assigned every frame by the engine's brake
 * flare, with nothing naming them and nothing to stop the two drifting
 * apart. They are also the numbers most likely to be wrong, because
 * emissive intensity is not brightness — it is input to ACES and then to
 * the bloom, and both of them have opinions.
 *
 * Measured from behind the car at night, the old set put 15 to 21% of
 * the lit pixels of a braking lamp at a saturation under 0.3: a red lamp
 * reading white, which is what "too much shine on the back light" looks
 * like from the driver's seat. A brake light is a saturated red source
 * behind a red lens and it should never be white at any distance.
 *
 * The brake step is still a step — that is the whole job of a brake
 * light — it is just a step between two reds now.
 */
export const TAIL = {
  /** Pure red, and it has to be. ACES walks every bright colour toward
   *  white, so the only headroom a lamp has is whatever its green and
   *  blue start at: 0xff2222 begins at 13% of each and was reading
   *  (255, 211, 172) at the old brake intensity. Starting at zero is the
   *  difference between a lamp that goes orange as it brightens and one
   *  that goes white. */
  lensColor: 0xff0000,
  lensIdle: 0.55,
  lensBrake: 1.7,
  /** The filament behind it. A shade hotter, not a different colour:
   *  there is no white-hot element visible through a red lens, because
   *  the lens is red glass and everything behind it comes out red. The
   *  old core was 0xff7048 at intensity 10 and measured (255, 248, 234),
   *  which is not a red lamp at all — it is a white one. */
  coreColor: 0xff1a05,
  coreIdle: 0.9,
  coreBrake: 2.8,
  /** The additive halo hung behind each lens. This is the piece that
   *  grows the lamp's footprint under braking, so it is the piece that
   *  decides whether the back of the car is a pair of lamps or one
   *  bright smear. */
  glowColor: 0xff2a0a,
  glowIdle: 0.16,
  glowBrake: 0.5,
} as const;

let goldRimMat: THREE.MeshStandardMaterial | null = null;
function getGoldRimMat(): THREE.MeshStandardMaterial {
  if (!goldRimMat) {
    goldRimMat = new THREE.MeshStandardMaterial({
      // Named like every other rim material. It was the only one
      // without a name, which mattered twice: models.ts swaps authored
      // geometry by material name, and a test asking "what wheel is
      // this car wearing" got an empty string back for the one finish a
      // player actually pays for.
      name: "rim-gold",
      color: 0xd4af37,
      roughness: 0.18,
      metalness: 1,
      envMapIntensity: 2.4,
    });
  }
  return goldRimMat;
}

/** Four-point diffraction star — what a bright lamp does to an eye or a
 *  lens. Drawn once and shared by every headlight in the scene. */
let starTexShared: THREE.CanvasTexture | null = null;
function headlightStarTexture(): THREE.CanvasTexture {
  if (starTexShared) return starTexShared;
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const mid = S / 2;
  // Spikes: long and thin, horizontal pair longer than the vertical, the
  // asymmetry real headlamp optics and camera irises both produce
  const arm = (len: number, thick: number, angle: number, alpha: number) => {
    ctx.save();
    ctx.translate(mid, mid);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(-len, 0, len, 0);
    g.addColorStop(0, "rgba(255,238,205,0)");
    g.addColorStop(0.5, `rgba(255,248,230,${alpha})`);
    g.addColorStop(1, "rgba(255,238,205,0)");
    ctx.fillStyle = g;
    // Taper the spike toward its tips so it reads as a ray, not a bar
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(0, -thick);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, thick);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  arm(mid * 0.98, 3.4, 0, 0.95); // horizontal, the dominant flare
  arm(mid * 0.62, 2.6, Math.PI / 2, 0.75); // vertical
  arm(mid * 0.34, 1.8, Math.PI / 4, 0.4); // faint diagonals
  arm(mid * 0.34, 1.8, -Math.PI / 4, 0.4);
  // Blown-out core
  const core = ctx.createRadialGradient(mid, mid, 0.5, mid, mid, mid * 0.28);
  core.addColorStop(0, "rgba(255,255,250,1)");
  core.addColorStop(0.35, "rgba(255,246,215,0.75)");
  core.addColorStop(1, "rgba(255,238,200,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, S, S);
  starTexShared = new THREE.CanvasTexture(c);
  starTexShared.colorSpace = THREE.SRGBColorSpace;
  return starTexShared;
}

// Glow shapes live in glow.ts: a lamp seen directly and a pool of neon
// on the tarmac need opposite falloffs, and they used to share one.

// The occlusion under every car — what actually grounds it on the
// asphalt at midnight, where the moon's own shadow is nearly nothing.
//
// Shared by SILHOUETTE rather than by car. The old pair was one geometry
// and one material for the whole game, which is cheaper still but meant
// every car in the fleet — a 3.9 m hatch and a 5.35 m pickup — sat on
// the same 2.9 x 5.8 m oval. Cars are fitted to real lengths now (see
// the length fit below), so one plane cannot be right for two of them.
// Six shells means at most six of each, built once and handed out.
const contactGeoCache = new Map<string, THREE.PlaneGeometry>();
const contactMatCache = new Map<string, THREE.MeshBasicMaterial>();
const contactMats: THREE.MeshBasicMaterial[] = [];
function contactPlane(
  style: BodyStyle,
  bodyW: number,
  bodyL: number,
  frontZ: number,
  rearZ: number,
  trackHalf: number
): { geo: THREE.PlaneGeometry; mat: THREE.MeshBasicMaterial } {
  const w = bodyW + CONTACT_REACH_M * 2;
  const l = bodyL + CONTACT_REACH_M * 2;
  const key = style;
  let geo = contactGeoCache.get(key);
  if (!geo) {
    geo = new THREE.PlaneGeometry(w, l);
    contactGeoCache.set(key, geo);
  }
  let mat = contactMatCache.get(key);
  if (!mat) {
    // Plane space: u across the width, v along the length. The plane is
    // rotated -90° about x when it is added, which puts +v at the NOSE,
    // so the axle v's are measured from the nose the same way.
    mat = new THREE.MeshBasicMaterial({
      map: contactShadowTexture(
        bodyW / 2 / w,
        bodyL / 2 / l,
        0.5 - frontZ / l,
        0.5 - rearZ / l,
        trackHalf / w
      ),
      transparent: true,
      opacity: contactStrength,
      depthWrite: false,
      // Never lit and never in anyone's shadow: this IS a shadow. Left
      // to the default it would be darkened by the moon shadow it is
      // standing in for, which is a shadow of a shadow.
      fog: true,
    });
    contactMatCache.set(key, mat);
    contactMats.push(mat);
  }
  return { geo, mat };
}

/**
 * How strongly the contact shadow shows, 0..1.
 *
 * One number, applied when a material is built and to every material
 * already built. It used to be left to whoever called last: the material
 * was created at its own default and the engine set it during a quality
 * change, so a session where the tier never changed ran a different
 * contact shadow from one where it did, and neither was written down as
 * the intended one.
 */
let contactStrength = 1;
/*
 * WHY 1, AND NOT 0.5 UNDER A REAL SHADOW.
 *
 * The engine used to halve this whenever the moon was casting, on the
 * grounds that the painted blob was "swallowing 40%" of the real shadow
 * they share the asphalt with. That was measured, and it was true of the
 * thing it was measured on: a 2.9 x 5.8 m oval, larger than most of the
 * cars in the game and centred on the same patch of road.
 *
 * Re-measured against the footprint above, at night, from a raking
 * three-quarter, by rendering the frame twice and differencing:
 *
 *   the cast shadow, blob on   10,793 px   mean -5.8   peak -22.1
 *   the cast shadow, blob off  10,913 px   mean -5.8   peak -22.1
 *
 * The blob costs the cast shadow 1.1% of its pixels and nothing at all
 * of its depth. Halving the contact to buy that back cost a third of its
 * mean (8.2 -> 5.5) and half its peak (108 -> 54) — paying a lot for
 * almost nothing, against a figure that stopped being true when the
 * shape changed. So the halving is gone, and this is the one number.
 */

/**
 * How strongly the painted-on contact blob shows, 0..1.
 *
 * The blob was drawn for a game whose cars cast no visible shadow: the
 * key light sat 56 degrees up, every real shadow landed under the floor
 * of the thing casting it, and this decal was the only thing keeping
 * fifteen cars from looking like they were hovering.
 *
 * Now that the key rakes and the shadow is real, the two are painted on
 * the same patch of road and the fake one wins — measured at 40% of the
 * real shadow's area swallowed. So the engine turns it down where a real
 * shadow is being drawn and leaves it at full strength on the tiers that
 * switch shadow casting off, where it is still the only thing there.
 *
 * The material is shared across every car on purpose, so this is one
 * assignment for the whole road.
 */
export function setContactStrength(v: number): void {
  contactStrength = v;
  for (const m of contactMats) m.opacity = v;
}
/**
 * How far the occlusion reaches past the sill, in metres.
 *
 * The whole visible part of a contact shadow is this band. Under the car
 * is hidden by the car, so however dark it is there costs nothing and
 * shows nothing — measured, the old blob put 0.29% of the frame on
 * screen against the cast shadow's 2.26%, because nearly all of it was
 * beneath the bodywork.
 */
const CONTACT_REACH_M = 0.44;

/**
 * The contact shadow, shaped like the car that casts it.
 *
 * WHAT WAS HERE: one 128px radial gradient, stretched onto a 2.9 x 5.8 m
 * plane for every car in the game. A radial gradient on a rectangle is
 * an OVAL, which is not the plan view of anything with wheels, and its
 * alpha peaked at 0.5 in the middle and reached zero exactly at the
 * edge — so the strongest part was under the car where nothing can see
 * it, and the part sticking out past the sill, which is the only part
 * anyone ever sees, had faded to nothing by the time it got there.
 *
 * Measured at night from a raking three-quarter: the car darkened 0.29%
 * of the frame by a mean of 5.6/255. A car on a road it is not touching.
 *
 * WHY THIS AND NOT A BIGGER SHADOW MAP: the moon's cast shadow removes
 * 5.8/255 at night, and it is faint for a real reason rather than a
 * fixable one — the moon contributes little of the asphalt's brightness
 * next to ambient, street lamps and the car's own headlight bounce, so
 * taking the moon away barely changes the pixel. What actually grounds a
 * car at midnight is AMBIENT OCCLUSION: the body is a lid over that
 * patch of road, and no amount of shadow-map resolution models a lid.
 *
 * So this draws the lid. A rounded footprint the size of the body, four
 * darker patches where the tyres meet the road, and a blurred falloff
 * that is still strong where it emerges from under the sill.
 *
 * Cached per silhouette rather than per car: the shape is the same for
 * every car on a given shell and the plane is what carries the size.
 */
const contactTexCache = new Map<string, THREE.CanvasTexture>();
function contactShadowTexture(
  /** Half-width and half-length of the BODY within the plane, 0..0.5. */
  bodyU: number,
  bodyV: number,
  /** Axle centres along the plane, 0..1 from the nose. */
  frontV: number,
  rearV: number,
  /** Track half-width as a fraction of the plane, 0..0.5. */
  trackU: number
): THREE.CanvasTexture {
  const key = [bodyU, bodyV, frontV, rearV, trackU].map((n) => n.toFixed(3)).join("/");
  const hit = contactTexCache.get(key);
  if (hit) return hit;

  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;

  // Everything is drawn hard and blurred once at the end. Compositing a
  // stack of soft gradients gives a muddy edge; one blur over solid
  // shapes gives a penumbra with a consistent width, which is what a
  // contact shadow has.
  const soft = document.createElement("canvas");
  soft.width = soft.height = S;
  const sx = soft.getContext("2d")!;

  // The body, as a rounded rectangle. 0.62 rather than the old 0.5:
  // this is the level the band OUTSIDE the sill inherits, and it is the
  // only level that ends up on screen.
  sx.fillStyle = "rgba(0,0,0,0.62)";
  const bw = bodyU * 2 * S;
  const bh = bodyV * 2 * S;
  const bx = (S - bw) / 2;
  const by = (S - bh) / 2;
  sx.beginPath();
  sx.roundRect(bx, by, bw, bh, Math.min(bw, bh) * 0.28);
  sx.fill();

  // The tyres. Darkest and tightest: a contact patch is the one place
  // under a car where the gap to the road is zero, and it is what makes
  // the eye read four wheels rather than a hovering slab.
  sx.fillStyle = "rgba(0,0,0,0.95)";
  for (const v of [frontV, rearV]) {
    for (const sgn of [-1, 1]) {
      sx.beginPath();
      sx.ellipse(S / 2 + sgn * trackU * S, v * S, S * 0.055, S * 0.085, 0, 0, Math.PI * 2);
      sx.fill();
    }
  }

  // One blur, sized so the penumbra is about the reach. Chromium's
  // canvas filter is a real Gaussian, so this is a proper falloff rather
  // than a stack of stops approximating one.
  ctx.filter = `blur(${Math.round(S * 0.055)}px)`;
  ctx.drawImage(soft, 0, 0);
  ctx.filter = "none";

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  contactTexCache.set(key, tex);
  return tex;
}

/** Chamfered box. Real sheet metal never meets at a sharp 90 degrees —
 *  every panel edge carries a small radius that catches a bright
 *  specular line, and that highlight is most of what makes a car read as
 *  a car. Built as a rounded rectangle extruded with a bevel, so the
 *  rounding wraps all three axes. */
// seg 4 (was 3): the chamfer is the specular line that sells every panel
// edge; at 4 subdivisions it reads as a true curve at showroom distance.
function roundedBox(w: number, h: number, d: number, r = 0.035, seg = 4): THREE.BufferGeometry {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const shape = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-3, d - r * 2),
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelSegments: seg,
    curveSegments: 3,
  });
  geo.translate(0, 0, -(d - r * 2) / 2);
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Map a roundedBox's flat faces to 0..1 so a texture on it is the whole
 * texture.
 *
 * THREE.ExtrudeGeometry's default UV generator writes WORLD UNITS. On a
 * 0.52 x 0.13 m number plate that means the face samples u 0..0.52 and
 * v 0..0.13 of its own image — and with ClampToEdge, everything outside
 * 0..1 pins to the border pixel. The plate was reading 133 of its
 * texture's 512 columns and EIGHT of its 128 rows: a 512x128 Kuwaiti
 * registration, drawn correctly, and then shown as a grey rectangle
 * with a pale strip along the top. Every car in the game, front and
 * back.
 *
 * It hid for so long because nothing about it looks like a bug. The
 * texture is right, the material is right, the mesh is right, the plate
 * is the right size in the right place, and a blank plate at chase
 * distance reads as a plate you cannot make out yet.
 *
 * Only the flat faces are remapped. The 20 mm rim keeps the generator's
 * own UVs: it is an edge, it is never read, and rewriting it would need
 * a second guess about which axis of a bevel is which.
 */
function faceUV(geo: THREE.BufferGeometry, w: number, h: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv;
  const nor = geo.attributes.normal;
  if (!uv || !nor) return geo;
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(nor.getZ(i)) < 0.99) continue;      // rim, not face
    uv.setXY(i, (uv.getX(i) + w / 2) / w, (uv.getY(i) + h / 2) / h);
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * CROWNING — the pass that makes an extrusion look like bodywork.
 *
 * Every shell in this game is an ExtrudeGeometry: a side profile pushed
 * across the car's width with a bevel round the edge. That gives a
 * rounded EDGE around a perfectly FLAT slab, and a flat slab is what a
 * bar of soap looks like. Real bodywork has none of it:
 *
 *   the roof and the bonnet are CROWNED across, by two or three
 *   centimetres over a metre and a half — which is what puts the long
 *   highlight down the middle of a bonnet instead of a flat grey field;
 *
 *   the flanks BULGE at the shoulder and TUCK at the rocker, so a
 *   cross-section is closer to an egg than to a rectangle;
 *
 *   and the glasshouse leans IN above the belt, which is why a car
 *   photographed head-on is narrower at the roof than at the doors.
 *
 * All three come out of one pass over the vertices, and it works in the
 * car\'s own frame (x across, y up, z along) so the same function can be
 * applied to an authored GLB shell after it loads — see models.ts. If
 * only the procedural build were crowned, the four styles with authored
 * shells would show a flat hero car and curved traffic.
 *
 * The widest point is DELIBERATELY left where it was. Everything hung
 * on the flanks — mirrors, arch lips, side markers, the flag, a crew\'s
 * decal — is anchored against the half-width the profile tables were
 * written with, so a section that bulged outward would leave every one
 * of them sunk inside the paint. Pulling in above and below the
 * shoulder gets the same curvature and can only ever leave a detail a
 * few millimetres proud, which is invisible.
 */
export interface CrownSpec {
  /**
   * How much the section pulls IN at the top and bottom, as a fraction
   * of the half-width. The shoulder keeps its full width, so this never
   * moves the car's bounding box — only the shape between its edges.
   *
   * NOT the reason these cars read as boxy, and that is worth writing
   * down because the numbers look like it is. caredges reports flank%,
   * the share of a body whose normal is within fifteen degrees of dead
   * sideways, and across the fleet it tracks this value almost exactly:
   * hatch 0.034 -> 25.0%, pickup 0.042 -> 24.2%, sedan 0.045 -> 23.5%,
   * against zx 0.075 -> 18.2%, rx7 0.075 -> 16.6%, super 0.095 -> 14.3%.
   *
   * It is a coincidence. Raised as a controlled change — sedan 0.045 to
   * 0.080, hatch 0.034 to 0.072, better than double — flank% moved by
   * under one point on both, and the rendered cards were
   * indistinguishable side by side. The arithmetic says why: a surface
   * drawn in 74 mm over 730 mm of body height is tilted about six
   * degrees, which is still well inside a fifteen degree gate, so it
   * cannot move the measure and it barely moves the silhouette.
   *
   * What does make them boxy is `plan`. See below.
   */
  tuck: number;
  /** How far down the top surface falls at its edges, in metres. */
  roof: number;
  /**
   * How far the section pulls in over the NOSE and TAIL overhangs, as a
   * fraction of the half-width — the car's shape in plan view.
   *
   * Every shell here is an extrusion of a side profile, so without this
   * its cross-section is identical from nose to tail and the car is a
   * rectangle seen from above. A real car is a lozenge in plan, and
   * that is most of what the eye reads as a car rather than a box.
   * (tuck, above, cannot do it: doubling it moved caredges' flank% by
   * under a point and the cards were indistinguishable.)
   *
   * FULL WIDTH ACROSS THE WHOLE ARCH, not just across the wheel centre.
   * The first version held the taper clear of the arch CENTRES and ate
   * the front wing: an arch opening is a 450 mm radius circle, its
   * forward half sat inside the taper, and because the lip, the well
   * and the flare are hung off flankX — the car's widest point — they
   * stayed put while the paint pulled in under them, and the lip stood
   * detached from the bodywork. PLAN_HOLD keeps the taper outside the
   * arch's full extent on every wheelbase in the fleet, so it acts on
   * the overhangs only — which is where a real car narrows hardest.
   *
   * Zero, or absent, is the old constant-section behaviour.
   */
  plan?: number;
  /** Where the widest point sits, 0 at the bottom of the shell and 1 at
   *  the top. A door\'s shoulder is a little above the middle. */
  shoulder: number;
  /**
   * Interpolate the station profile instead of stepping between the 32
   * buckets. See crownShell: stepping makes the displacement a step
   * function, so every station boundary is a ridge.
   *
   * On at present every shell in the game, which is why nothing sets
   * this false. It is a flag rather than the rule because a stepped
   * crown is what every anchor on the car was placed against, and the
   * flag is what makes "did that matter?" a question with an answer:
   * the stripes, the decals, the carbon panels and the cabin fit all
   * ask the shell where it is (deckY, skinAt, flankRibbon all raycast
   * it), so they follow the surface wherever it moves — measured, and
   * not assumed. See the commit that turned it on for the bodies.
   */
  smooth?: boolean;
}

export const CROWN: Record<"body" | "canopy" | "roof", CrownSpec> = {
  // The body: bulging doors, tucked rocker, a crowned bonnet and boot.
  body: { tuck: 0.055, roof: 0.03, shoulder: 0.62, plan: 0.24, smooth: true },
  // The glasshouse leans in hard — tumblehome is most of what makes a
  // greenhouse read as glass rather than as a box.
  canopy: { tuck: 0.085, roof: 0.026, shoulder: 0.25 },
  // A roof panel is nearly all crown and barely any tuck.
  roof: { tuck: 0.03, roof: 0.034, shoulder: 0.5 },
};

/**
 * The crown, per silhouette.
 *
 * CROWN above is one spec per SHELL TYPE — body, canopy, roof — and
 * every one of the six silhouettes was handed the same three. So a
 * pickup's doors bulged exactly as far as a mid-engined coupe's, and the
 * glasshouse leaned in by the same 85 mm on a saloon as on a low sports
 * car. The cross-section was the one thing about these bodies that did
 * not vary at all; the differences between them came entirely from the
 * side profile.
 *
 * What actually differs between these shapes:
 *
 *   the low coupes tuck hard and lean their glass in hard — tumblehome
 *     is most of what separates a sports car's greenhouse from a box —
 *     and carry the shoulder low down the flank.
 *   a pony coupe is about haunches: less tuck than a sports car, but the
 *     widest point sits HIGH, which is what reads as a shoulder over the
 *     rear wheel.
 *   a saloon is upright. Softer tuck, flatter roof, glass that stands
 *     much nearer vertical.
 *   a hatch and a pickup are nearly slab-sided, and their roofs are
 *     close to flat, because that is what a tall practical body is.
 *
 * Each is the base spec scaled rather than a fresh set of numbers, so
 * the relationship CROWN describes — a body that bulges, a canopy that
 * leans, a roof that is nearly all crown — survives on every car.
 */
const CROWN_BY_STYLE: Record<BodyStyle, Record<"body" | "canopy" | "roof", CrownSpec>> = {
  zx: {
    body: { tuck: 0.075, roof: 0.032, shoulder: 0.58, plan: 0.28, smooth: true },
    canopy: { tuck: 0.105, roof: 0.028, shoulder: 0.24, smooth: true },
    roof: { tuck: 0.034, roof: 0.036, shoulder: 0.5, smooth: true },
  },
  rx7: {
    body: { tuck: 0.075, roof: 0.032, shoulder: 0.58, plan: 0.28, smooth: true },
    canopy: { tuck: 0.105, roof: 0.028, shoulder: 0.24, smooth: true },
    roof: { tuck: 0.034, roof: 0.036, shoulder: 0.5, smooth: true },
  },
  gtr: {
    body: { tuck: 0.068, roof: 0.030, shoulder: 0.60, plan: 0.28, smooth: true },
    canopy: { tuck: 0.098, roof: 0.027, shoulder: 0.25, smooth: true },
    roof: { tuck: 0.032, roof: 0.035, shoulder: 0.5, smooth: true },
  },
  pony: {
    body: { tuck: 0.062, roof: 0.028, shoulder: 0.68, plan: 0.24, smooth: true },
    canopy: { tuck: 0.090, roof: 0.026, shoulder: 0.27, smooth: true },
    roof: { tuck: 0.030, roof: 0.032, shoulder: 0.5, smooth: true },
  },
  sedan: {
    body: { tuck: 0.045, roof: 0.026, shoulder: 0.62, plan: 0.24, smooth: true },
    canopy: { tuck: 0.072, roof: 0.024, shoulder: 0.28, smooth: true },
    roof: { tuck: 0.026, roof: 0.028, shoulder: 0.5, smooth: true },
  },
  // A pickup is a slab. The sides are nearly flat from the rocker to
  // the bed rail, which is the single thing that separates a working
  // body from a styled one, so it gets the least tuck and the least
  // crown of anything in the fleet — and its shoulder sits HIGH,
  // because the widest point of a truck is its bed rail.
  // Mid-engined proportions: the widest point is low and far back, over
  // the rear tyre, and the cabin is a bubble on top of it. So the body
  // gets the deepest tuck in the fleet and the shoulder sits LOW —
  // the opposite end of the same dial the pickup is at.
  super: {
    body: { tuck: 0.095, roof: 0.034, shoulder: 0.44, plan: 0.32, smooth: true },
    canopy: { tuck: 0.118, roof: 0.030, shoulder: 0.22, smooth: true },
    roof: { tuck: 0.036, roof: 0.038, shoulder: 0.5, smooth: true },
  },
  pickup: {
    body: { tuck: 0.042, roof: 0.020, shoulder: 0.70, plan: 0.12, smooth: true },
    canopy: { tuck: 0.072, roof: 0.024, shoulder: 0.30, smooth: true },
    roof: { tuck: 0.026, roof: 0.030, shoulder: 0.5, smooth: true },
  },
  hatch: {
    body: { tuck: 0.034, roof: 0.022, shoulder: 0.64, plan: 0.20, smooth: true },
    canopy: { tuck: 0.060, roof: 0.022, shoulder: 0.30, smooth: true },
    roof: { tuck: 0.022, roof: 0.024, shoulder: 0.5, smooth: true },
  },
  // A two-box on a truck's floor. The flank is tall and nearly flat like
  // the pickup's, so it gets the pickup's tuck; but the widest point is
  // the door skin under the belt rather than a bed rail, so the shoulder
  // sits where a saloon's does. The roof is the longest in the fleet
  // and a long flat roof needs a touch MORE crown, not less, or it reads
  // as a lid.
  suv: {
    body: { tuck: 0.040, roof: 0.024, shoulder: 0.62, plan: 0.16, smooth: true },
    canopy: { tuck: 0.066, roof: 0.026, shoulder: 0.30, smooth: true },
    roof: { tuck: 0.026, roof: 0.034, shoulder: 0.5, smooth: true },
  },
};

/**
 * The cross-section a shell of this silhouette is given.
 *
 * Exported because models.ts crowns the Blender-authored shells at load
 * time and was doing it with the shared CROWN — the one spec the whole
 * fleet used before the silhouettes were given their own. A hero car
 * crowned by the old table in front of traffic crowned by the new one is
 * the same bug the per-style table was written to end, one layer up.
 */
export function crownFor(style: BodyStyle, slot: string): CrownSpec {
  const set = CROWN_BY_STYLE[style] ?? CROWN_BY_STYLE.sedan;
  return slot === "canopy" ? set.canopy : slot === "roof" ? set.roof : set.body;
}



/**
 * Reshape a shell\'s cross-section in place. Car frame: x across, y up,
 * z along the length.
 *
 * Stationed along the length rather than applied globally, because the
 * shell\'s height changes from nose to tail: doming "the top" by a fixed
 * amount would dome the bonnet and the roof by the same absolute drop
 * even though one is half the width of the other. Each station gets its
 * own half-width and its own top, and the crown is measured against
 * those.
 */
/**
 * Half the span, as a fraction of the shell's length, that the plan
 * taper leaves at full width.
 *
 * 0.41 holds 0.09 to 0.91 of the length. The wheel centres sit at 0.20
 * and 0.80 on this fleet's wheelbases and an arch opening reaches about
 * 0.094 of the length either side of its centre, so the arches span
 * 0.106..0.294 and 0.706..0.894 — inside the hold with 7 to 8 cm to
 * spare. 0.32 was not enough; see CrownSpec.plan for what that did.
 */
const PLAN_HOLD = 0.41;

export function crownShell(geo: THREE.BufferGeometry, c: CrownSpec): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  if (!n) return geo;

  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const z0 = bb.min.z;
  const z1 = bb.max.z;
  const span = z1 - z0;
  if (!(span > 1e-4)) return geo;

  // Thirty-two stations along the car: fine enough that a windscreen
  // base and a roof do not share one, coarse enough that a single stray
  // vertex cannot define a station on its own.
  const N = 32;
  const maxX = new Float32Array(N).fill(1e-4);
  const maxY = new Float32Array(N).fill(-1e9);
  const minY = new Float32Array(N).fill(1e9);
  const station = (z: number) =>
    Math.min(N - 1, Math.max(0, Math.floor(((z - z0) / span) * N)));

  for (let i = 0; i < n; i++) {
    const k = station(pos.getZ(i));
    const ax = Math.abs(pos.getX(i));
    if (ax > maxX[k]) maxX[k] = ax;
    const y = pos.getY(i);
    if (y > maxY[k]) maxY[k] = y;
    if (y < minY[k]) minY[k] = y;
  }
  // Smooth the station profile. A station that happened to catch only
  // the inside of a wheel arch reports a half-width of nothing, and an
  // unsmoothed pass would pinch the car\'s waist there.
  const sm = (a: Float32Array, fill: number) => {
    const out = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      let sum = 0;
      let w = 0;
      for (let d = -1; d <= 1; d++) {
        const j = k + d;
        if (j < 0 || j >= N) continue;
        if (!Number.isFinite(a[j]) || a[j] === fill) continue;
        sum += a[j];
        w++;
      }
      out[k] = w ? sum / w : a[k];
    }
    return out;
  };
  const halfW = sm(maxX, 1e-4);
  const topY = sm(maxY, -1e9);
  const botY = sm(minY, 1e9);

  /**
   * Where a vertex sits BETWEEN stations, not which one it fell in.
   *
   * This is the whole difference between bodywork and a corrugated
   * roof. Measuring in 32 buckets is right — the comment above says
   * why — but APPLYING the measurement by bucket makes the
   * displacement a step function: two vertices a millimetre apart on
   * either side of a boundary get a different half-width, a different
   * top and a different bottom, so the surface jumps. Thirty-two
   * boundaries, thirty-two ridges.
   *
   * It is worst on the CANOPY, which is barely two metres of z with the
   * roofline climbing through all of it, so topY moves hard from one
   * station to the next and every boundary shows. But it is on the
   * BONNET too, and that is the one people look at: probed down the
   * centreline of the Deera's hood, the skin climbed for five or six
   * samples and then dropped 10 to 18 mm, over and over, with a period
   * of 140 mm — 4.5 m of car over 32 stations. On screen that is a
   * venetian blind, and every car in this game was wearing one.
   *
   * Sampling at the station's CENTRE (the 0.5) keeps the interpolation
   * symmetric, so the crown still peaks where it was measured to.
   */
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  for (let i = 0; i < n; i++) {
    // Stations are measured in buckets either way; `smooth` decides
    // whether they are APPLIED as a step or as a ramp.
    let k0: number, k1: number, kt: number;
    if (c.smooth) {
      const f = Math.min(N - 1, Math.max(0, ((pos.getZ(i) - z0) / span) * N - 0.5));
      k0 = Math.floor(f);
      k1 = Math.min(N - 1, k0 + 1);
      kt = f - k0;
    } else {
      k0 = k1 = station(pos.getZ(i));
      kt = 0;
    }
    const hw = lerp(halfW[k0], halfW[k1], kt);
    const hi = lerp(topY[k0], topY[k1], kt);
    const lo = lerp(botY[k0], botY[k1], kt);
    if (!(hw > 1e-3) || !(hi - lo > 1e-3)) continue;

    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = Math.min(1, Math.abs(x) / hw);                  // across
    const t = Math.min(1, Math.max(0, (y - lo) / (hi - lo))); // up

    // Flank: full width at the shoulder, pulled in above and below it.
    // Cosine rather than a sine bump so the widest point is a smooth
    // maximum instead of a crease.
    const d = (t - c.shoulder) / (t >= c.shoulder ? 1 - c.shoulder : c.shoulder || 1);
    const pull = c.tuck * (1 - Math.cos(Math.min(1, Math.abs(d)) * Math.PI)) * 0.5;

    // Plan taper: full width across the wheelbase and both arches, drawn
    // in over the overhangs. Same cosine as the tuck so the transition
    // is a smooth maximum rather than a crease, and zero across the hold
    // band so the car's own half-width — its bounding box, its widthFix
    // and every part hung off flankX — is untouched.
    const zf = (pos.getZ(i) - z0) / span;
    const past = Math.max(0, Math.abs(zf - 0.5) - PLAN_HOLD);
    const nip =
      (c.plan ?? 0) *
      (1 - Math.cos(Math.min(1, past / (0.5 - PLAN_HOLD)) * Math.PI)) *
      0.5;
    pos.setX(i, x * (1 - pull) * (1 - nip));

    // Top surface: dome it. Weighted by how near the top of ITS OWN
    // station the vertex is, so the rocker is untouched and the roof
    // takes the full drop, and by u squared so the fall is a parabola
    // across the car — which is the shape a stamped panel actually is.
    if (t > 0.5) {
      const w = (t - 0.5) / 0.5;
      pos.setY(i, y - c.roof * u * u * w * w);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Extrude a side profile (x = length, y = height) across the car's width.
 *
 * Sheet metal is never a polyline: the whole top run — nose, hood,
 * roofline, tail — is threaded through a Catmull-Rom spline so the
 * silhouette is one continuous curve, while the rocker line along the
 * bottom stays dead straight. `bottomPoints` is how many trailing points
 * belong to that straight underbody run.
 */
function extrudeProfile(
  points: Array<[number, number]>,
  width: number,
  bevel: number,
  bottomPoints = 2,
  /** Which crown to give the finished section. Omitted leaves the old
   *  flat-sided extrusion, which is right for anything that genuinely
   *  is a slab. */
  crown?: CrownSpec
): THREE.BufferGeometry {
  // Every profile is authored as if the car sat on the wheels it used to
  // have; BODY_DROP is what puts it back on the ones it has now.
  points = points.map(([x, y]) => [x, y - BODY_DROP] as [number, number]);
  const shape = new THREE.Shape();
  const top = points.slice(0, points.length - bottomPoints);
  shape.moveTo(top[0][0], top[0][1]);
  // Uniform Catmull-Rom, which is what splineThru is — and MEASURED
  // against the centripetal variant, which is the textbook cure for
  // Catmull-Rom overshoot and was proposed here for exactly that.
  // Sampled 800 points per shell on the authored profiles, overshoot
  // above the crest went the wrong way on nearly every one: roof caps
  // 0.1 -> 9.3 mm (zx), 1.1 -> 11.3 (pony), 3.7 -> 24.5 (gtr), 0.4 ->
  // 11.4 (rx7), 3.7 -> 29.3 (hatch); canopies 30 -> 31 (zx), 47 -> 57
  // (gtr). Only the pony and rx7 canopies improved. The reason is the
  // spacing: these profiles are authored with near-even spans, which is
  // the case uniform parameterisation is right for, and centripetal
  // trades that for robustness on spacing these profiles do not have.
  shape.splineThru(top.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
  for (let i = points.length - bottomPoints; i < points.length; i++) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    // 9, not 5. The bevel IS the panel edge, and the panel edge is
    // where the specular line lives — at 5 segments a headlight sweeping
    // along a flank walks across the facets one at a time instead of
    // running along them. These geometries are shared by every instance
    // of a silhouette, player car and thirty traffic cars alike, so the
    // extra vertices are paid once each rather than once per car.
    bevelSegments: 9,
    // The spline spans the whole body top, so it needs real sampling
    // density or the curve degenerates back into a polyline.
    curveSegments: 28,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  // Merged BEFORE crowning, not after. Crowning moves vertices by a few
  // millimetres, and a 1e-3 weld applied afterwards would fuse pairs the
  // crown had just pushed apart — which shows up as a torn normal along
  // the shoulder line.
  geo = mergeVertices(geo, 1e-3);
  // Profile length axis (x) onto the car's forward axis (+Z)
  geo.rotateY(-Math.PI / 2);
  if (crown) crownShell(geo, crown);
  else geo.computeVertexNormals();
  /**
   * The forwardmost point of the roof, recorded on the geometry.
   *
   * On a canopy this is the windscreen header — where the screen stops
   * being a screen and the roof starts — and it is the one landmark in
   * a cabin that says where the person in it goes: a driver's head sits
   * a fixed distance behind the header on every car ever built, because
   * that is what a windscreen has to clear.
   *
   * Taken as the most forward of the control points within 60 mm of the
   * profile's highest, rather than the highest point outright. On the
   * fastbacks the highest point IS the header, but a saloon's roof
   * peaks over the back seat and a hatch's over the rear axle, and
   * seating a driver at those puts him in the boot. Recorded here, in
   * the shifted coordinates the shell is actually built in, so it can
   * never drift from the profile the way a hand-copied number does.
   */
  const topY = Math.max(...points.map(([, y]) => y));
  const header = points
    .filter(([, y]) => y >= topY - 0.06)
    .reduce((a, b) => (b[0] > a[0] ? b : a));
  geo.userData.headerZ = header[0];
  geo.userData.headerY = header[1];
  return geo;
}

/**
 * How far the whole body sits down from where it was authored.
 *
 * This exists BECAUSE of the number above, and the two only make sense
 * together. Fitting a smaller wheel drops the axle by the radius lost —
 * 35 mm — but it does NOT drop the body, which is authored in absolute
 * coordinates with y=0 at the road. The tyre's crown falls twice that,
 * 70 mm, so the arch gap opens by 70 mm and the car ends up looking
 * jacked up on small wheels. That is also what happens to a real car
 * fitted with smaller rims and nothing else, which is why people fit
 * bigger ones to fill the arch.
 *
 * So the body comes down by more than the tyre's own 70 mm: the car sits
 * 51 mm closer to its own axles than it did — a lowered car on smaller
 * wheels, which is the shape this game is about. Ground clearance goes
 * from 190 mm to 104 mm, a lowered street car rather than a scraped one.
 *
 * 86 rather than 70 because 70 only HOLDS the gap, and holding it is not
 * enough: the same daylight over a smaller tyre is a bigger fraction of
 * its radius, and gap/radius landed on the 0.30 ceiling with two cars
 * tipping over it. The extra 16 mm closes the gap to about 84 mm and
 * puts the fleet mid-band instead of against the wall.
 *
 * It is applied in two places and both are needed: the profile points in
 * extrudeProfile, which are the shells, and STYLE_DIMS, which is every
 * anchor hung off them — beltline, crease, lights, mirrors, dash, roof.
 * Dropping one without the other slides the details up the bodywork.
 */
const BODY_DROP = 0.086;

/**
 * Where the driver sits, and how much air is over his head.
 *
 * He used to be put at `dashY - 0.34` and one of two fixed stations —
 * `bCabBack ? -0.28 : 0.08` — for all six silhouettes. Both halves of
 * that were wrong, and the check that was supposed to catch it could not
 * see either: tests/ik.mjs took the highest shell VERTEX inside a 0.8 m
 * box around the seat, and an extruded shell carries vertices only at
 * its profile points and bevel rings, so the number it returned was
 * whichever ring fell in the box rather than the ceiling over the head.
 *
 * Asked of the surface directly, at the driver's own x, the fleet read:
 *
 *   pony    187 mm THROUGH the glass — seated 420 mm forward of its own
 *           roof peak, under the steep screen, head out in the weather
 *   zx       23 mm through
 *   hatch     0 mm — scalp on the glass
 *   rx7      12 mm of clearance
 *   gtr      64 mm
 *   sedan   221 mm, sunk so low his shoulders sat BELOW the door line
 *
 * So stop placing him by hand. The canopy records its own windscreen
 * header, a driver's head goes a fixed distance behind it, and the seat
 * drops until the helmet clears the skin measured at that exact point.
 * Every silhouette then gets the same air over the helmet whatever its
 * roof does, and a new body inherits the fit instead of needing a
 * number.
 */
const DRIVER_X = 0.38;
/** Head centre behind the windscreen header. A screen has to clear the
 *  head it rakes over, so this distance is a property of people and
 *  windscreens rather than of any one car. */
const CABIN_HEAD_BACK = 0.2;
/** Air between the top of the helmet and the glass. */
const CABIN_HEADROOM = 0.06;

/**
 * How far the top of a driver's helmet sits above the seat he is bolted
 * to. Measured off a rig rather than written down: the figure is built
 * in characters.ts, and a helmet that grew there would otherwise quietly
 * push every head in the game back through a roof. One throwaway rig for
 * the life of the process.
 */
let driverHeadTopM: number | null = null;
function driverHeadTop(): number {
  if (driverHeadTopM === null) {
    const probe = kuwaitiDriver(0x000000, undefined, true);
    driverHeadTopM = new THREE.Box3().setFromObject(probe.group).max.y;
  }
  return driverHeadTopM;
}

/**
 * The radius on a panel edge, in metres.
 *
 * These were 0.13 to 0.17 on the bodies — a 130 to 170 mm roll on an
 * edge that a real car turns in ten or twenty. At that radius there is
 * no edge left to catch a light: the shoulder line is a slow gradient
 * across a sixth of the car's width, which is why the fleet read as
 * soap. Measured before the change, only 19 to 26% of a body faced
 * squarely out of its own side.
 *
 * Not zero, and not one number for everything. The bevel is where the
 * specular line lives, so it has to be wide enough for a headlight
 * sweeping past to run ALONG it rather than pop across it — with the 9
 * segments extrudeProfile uses, 50 mm is five and a half millimetres a
 * facet, which is finer than the shell's own curvature elsewhere. And
 * the three shells are different things: a body has real panel edges, a
 * canopy is glass in a frame, a roof is a pressing that genuinely rolls.
 *
 * What this costs, measured rather than left to be rediscovered: the
 * bevel expands the profile outward in EVERY direction, so tightening it
 * makes the painted shell SHORTER — sedan 4.82 to 4.64 m, rx7 4.89 to
 * 4.65. At the beltline the loss is bigger again, because a tight corner
 * lets the body fall away at that height instead of being carried out by
 * a fat roll: the rx7's run at the side graphic's height went 4.63 to
 * 3.65 m, and the graphic's share of the whole car with it, 94-96% down
 * to 78-90%. It still covers 99% of the body available at its own
 * height, which is all it claims, and the stretch it gave up is the
 * extreme nose and tail where a side graphic does not go on a real car
 * either. Overall car length is untouched — lengthM normalises the shell
 * after this.
 */
/*
 * Halved again, and this time against a shoulder measurement that works.
 *
 * caredges.mjs claimed 1 to 6 mm of roll on every body in the fleet,
 * which would have been sharper than any car ever pressed. It was
 * reporting its own sampling step: the walk started at the widest sample
 * — a spike on the last ring before the surface turns over — and stopped
 * one step later. Measured properly, from the flat of the bonnet down to
 * the flank, these bevels were rolling the shoulder over 40 to 61 mm.
 *
 * A real car turns its bonnet shoulder in fifteen to twenty-five
 * millimetres. The bevel still has nine segments across it whatever its
 * width, so the specular line a headlight draws still runs ALONG the
 * edge instead of popping across it — that argument was always about
 * segment count and never about millimetres.
 */
const BODY_EDGE = 0.026;
const CANOPY_EDGE = 0.021;
const ROOF_EDGE = 0.016;

// Beltline-down body: bumper > hood wedge > trunk, with rounded edges
const bodyGeo = extrudeProfile(
  [
    [2.2, 0.34],
    [2.26, 0.62],
    [2.12, 0.78],
    [1.35, 0.9],
    [0.4, 0.97],
    [-1.45, 0.95],
    [-2.18, 0.86],
    [-2.27, 0.62],
    [-2.2, 0.34],
    [-1.85, 0.24],
    [1.85, 0.24],
  ],
  1.840,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.sedan.body,
);

/**
 * How wide a cabin is, and how wide the roof that caps it is.
 *
 * These were twelve unrelated numbers, and every roof came out at about
 * 89% of the glass it sat on. Measured on the built cars, that left 69
 * to 103 mm of glass showing down EACH SIDE of every painted roof in the
 * fleet — a strip of window running the full length of the roof, where a
 * real car has a rail. It is the same mistake six times, which is what a
 * pair of numbers that ought to be related but are typed separately
 * always turns into.
 *
 * So the roof is derived from the cabin. A roof meets the side glass at
 * a rail and stops; the only glass that should show past it is the seal.
 */
const ROOF_SEAL = 0.015;
const roofWidth = (cabin: number): number => cabin - ROOF_SEAL * 2;

const SEDAN_CABIN_W = 1.6;
const ZX_CABIN_W = 1.776;
const PONY_CABIN_W = 1.63;
const GTR_CABIN_W = 1.701;
const RX7_CABIN_W = 1.635;
const HATCH_CABIN_W = 1.556;
const PICKUP_CABIN_W = 1.70;
const SUPER_CABIN_W = 1.60;
const SUV_CABIN_W = 1.68;

// Raked glasshouse: windshield, roofline, rear window
const canopyGeo = extrudeProfile(
  [
    [1.02, 0.93],
    [0.42, 1.4],
    [-0.78, 1.42],
    [-1.5, 0.94],
  ],
  SEDAN_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.sedan.canopy,
);

// Painted roof panel over the glass
const roofGeo = extrudeProfile(
  [
    [0.38, 1.41],
    [0.28, 1.47],
    [-0.68, 1.48],
    [-0.76, 1.42],
  ],
  roofWidth(SEDAN_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.sedan.roof,
);

// ---- Mid-engined two-seater: cab-forward, a low flat nose, and a deck
// that rises behind the cabin over the engine.
//
// The Storm S8 is a supercar and was drawn as a SALOON. Every other
// machine in its class here is a front-engined coupe on one of the
// three wedge shells; this one had a boot, four doors' worth of flank
// and a bonnet long enough to put an engine under, which is the one
// thing a mid-engined car does not have.
//
// What separates this from the wedges is where the cabin sits. On a
// front-engined coupe the screen is behind a long bonnet; here the
// screen is almost over the front axle and the length behind the
// cabin is engine rather than boot — so the deck is HIGHER than the
// bonnet, which is true of no other silhouette in this game.
const superBodyGeo = extrudeProfile(
  [
    [2.14, 0.28],
    [2.2, 0.5], // a low, flat nose with nothing under it
    [2.05, 0.6],
    [1.3, 0.66], // the short bonnet, over a boot rather than a motor
    [0.72, 0.74], // and up into the screen base
    [-0.5, 0.9],
    [-1.35, 0.94], // the deck over the engine — the high point of the body
    [-2.02, 0.9],
    [-2.2, 0.72],
    [-2.26, 0.42],
    [-2.16, 0.26],
    [-1.85, 0.2],
    [1.8, 0.2],
  ],
  2.055,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.super.body,
);
const superCanopyGeo = extrudeProfile(
  [
    // The screen base, down ONTO the cowl. This was 0.76, and measured
    // on the built car the foot of the windscreen finished 8 mm above
    // the body's top skin: the tightest junction in the fleet and the
    // only other one besides the hatch's tailgate that does not close.
    // A mid-engined car rakes its screen hard and meets the cowl at a
    // shallow angle, which is exactly the geometry that turns a few
    // millimetres of drift into a visible line, so this wants the bite
    // the rest of the fleet has rather than the least it can get away
    // with. 30 mm; the resulting bite is +22 mm, against 31 on the
    // saloon and 12 on the gtr.
    [0.78, 0.73],
    [0.06, 1.2], // the peak is barely behind the front axle
    [-0.72, 1.16],
    [-1.42, 0.9], // and the glass runs down onto the engine deck
  ],
  SUPER_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.super.canopy,
);
const superRoofGeo = extrudeProfile(
  [
    [0.0, 1.19],
    [-0.08, 1.23],
    [-0.62, 1.2],
    [-0.7, 1.15],
  ],
  roofWidth(SUPER_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.super.roof,
);

// ---- Half-tonne single cab: tall slab sides, a short upright cab well
// forward, and a flat load bed running from behind it to a squared tail.
//
// THE ONE CAR IN THE FLEET WHOSE SHAPE WAS WRONG
//
// The Jahra Pickup was a saloon. It carried the saloon's side profile —
// a boot lid, a raked rear screen, a 4.7 m body — scaled up to its
// 5.35 m length, so the game's only truck was a stretched Deera with a
// different name and a V8. Every other mismatch in this fleet is a
// shared body between cars of the same KIND; this one was a different
// kind of vehicle entirely, and it is the single thing you would notice
// first if you looked at the roster and asked what did not belong.
//
// What makes it read as a truck at a glance, in order of how much each
// is worth: the deck line running dead flat from the cab to the tail,
// the cab being SHORT and standing UPRIGHT, and the whole thing sitting
// about 100 mm higher than anything else here. The bed is a solid deck
// rather than a well, which is the same simplification the saloon makes
// about its boot — an extruded side profile cannot express a recess,
// and at the distance one car sees another it is the deck LINE that
// carries the shape rather than what is under it.
const pickupBodyGeo = extrudeProfile(
  [
    [2.5, 0.4],
    [2.58, 0.76], // a tall, upright nose — no wedge anywhere on it
    [2.46, 0.94],
    [1.55, 1.04], // the bonnet, long and dead flat
    [0.92, 1.07], // cowl, where the cab starts
    [-0.58, 1.07],
    [-0.66, 1.0], // the step down onto the bed rail
    [-2.42, 0.99], // and the bed, flat all the way to the tail
    [-2.56, 0.92],
    [-2.62, 0.52],
    [-2.5, 0.3],
    [-2.1, 0.24],
    [2.1, 0.24],
  ],
  1.960,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.pickup.body,
);
const pickupCanopyGeo = extrudeProfile(
  [
    [0.88, 1.03],
    [0.3, 1.56], // a steep screen, because a cab is a box
    [-0.5, 1.58],
    [-0.62, 1.03],
  ],
  PICKUP_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.pickup.canopy,
);
const pickupRoofGeo = extrudeProfile(
  [
    [0.26, 1.55],
    [0.18, 1.62],
    [-0.44, 1.63],
    [-0.52, 1.56],
  ],
  roofWidth(PICKUP_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.pickup.roof,
);

// ---- Mid-size SUV: a two-box on a raised floor. Tall upright nose, a
// short high bonnet, and then one long glasshouse from the cowl almost
// to the tail, closed by a near-vertical tailgate.
//
// The most common shape on the road this game is set on, and until now
// the one shape the game could not draw: every civilian was the street
// saloon. What makes it read as an SUV rather than a tall hatch, in
// order of how much each is worth: the FLOOR is 40 mm higher than any
// car's (daylight under the sills), the roof runs flat and long over a
// glasshouse that ends in a tailgate instead of a boot, and the belt
// is up at the pickup's height rather than the saloon's.
const suvBodyGeo = extrudeProfile(
  [
    [2.3, 0.42],
    [2.4, 0.8], // tall, upright nose
    [2.3, 1.0],
    [1.5, 1.08], // a short bonnet, high and nearly flat
    [0.95, 1.12], // cowl
    [-2.18, 1.12], // the belt runs dead flat to the tail — a two-box
    [-2.34, 1.04],
    [-2.42, 0.58],
    [-2.3, 0.36],
    [-1.95, 0.28], // the raised floor: 40 mm more than a car's
    [1.95, 0.28],
  ],
  1.93,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.suv.body,
);
const suvCanopyGeo = extrudeProfile(
  [
    [0.92, 1.1],
    [0.36, 1.7], // a steeper screen than any car's
    [-0.6, 1.76],
    [-1.8, 1.74], // the longest roof in the fleet
    [-2.06, 1.64], // and a tailgate, raked only just off vertical
    [-2.18, 1.1],
  ],
  SUV_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.suv.canopy,
);
const suvRoofGeo = extrudeProfile(
  [
    [0.3, 1.69],
    [0.2, 1.77],
    [-1.76, 1.78],
    [-1.88, 1.7],
  ],
  roofWidth(SUV_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.suv.roof,
);

// ---- Z32-style wedge: long flat nose, cab-back glasshouse, fastback
// tail. The whole car sits lower and the glass flows almost to the tail.
const zxBodyGeo = extrudeProfile(
  [
    [2.36, 0.3],
    [2.42, 0.54], // slim, flush nose — no upright grille face
    [2.3, 0.64],
    [1.0, 0.78], // the long hood
    [0.2, 0.87],
    [-1.6, 0.86], // rear haunch
    [-2.26, 0.76], // kicked tail
    [-2.34, 0.48],
    [-2.26, 0.28],
    [-1.9, 0.2],
    [1.95, 0.2],
  ],
  2.080,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.zx.body,
);
const zxCanopyGeo = extrudeProfile(
  [
    [0.48, 0.84],
    [-0.12, 1.24], // peak just over the driver
    [-0.95, 1.19],
    [-2.0, 0.78], // fastback all the way down
  ],
  ZX_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.zx.canopy,
);
const zxRoofGeo = extrudeProfile(
  [
    [-0.16, 1.24],
    [-0.24, 1.29],
    [-0.82, 1.25],
    [-0.9, 1.2],
  ],
  roofWidth(ZX_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.zx.roof,
);

// ---- The American pony coupe: a very long, very low nose, a windscreen
// that starts almost over the front wheels, and a fastback that runs
// unbroken from the roof to a short high deck. Wide at the hips.
//
// The proportion that makes this silhouette is the DASH-TO-AXLE: the
// cowl sits a long way back, so two thirds of the car is in front of
// the driver. Nothing else here does that — the zx is long-nosed but
// its glasshouse sits further forward, and the gtr is upright.
const ponyBodyGeo = extrudeProfile(
  [
    [2.42, 0.26], // the nose is LOW: this car looks along the road, not over it
    [2.47, 0.42],
    [2.38, 0.55],
    [1.62, 0.66], // the long flat hood
    [0.52, 0.79], // cowl, a long way back
    [-0.62, 0.86],
    [-1.72, 0.885], // rear haunch, the widest and highest point of the body
    [-2.32, 0.85], // short deck
    [-2.45, 0.58],
    [-2.38, 0.3],
    [-2.0, 0.2],
    [2.0, 0.2],
  ],
  1.92,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.pony.body,
);
const ponyCanopyGeo = extrudeProfile(
  [
    [0.64, 0.79], // the windscreen starts here, and it is steep
    [-0.32, 1.26], // roof peak, over the driver's head
    [-0.98, 1.235],
    [-2.16, 0.87], // and the hatch glass runs all the way to the deck
  ],
  PONY_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.pony.canopy,
);
const ponyRoofGeo = extrudeProfile(
  [
    [-0.36, 1.26],
    [-0.44, 1.31],
    [-0.9, 1.29],
    [-0.98, 1.24],
  ],
  roofWidth(PONY_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.pony.roof,
);

// ---- R34-style coupe: short deck up high, upright glasshouse, thick
// haunches. The silhouette is a brick with intent.
const gtrBodyGeo = extrudeProfile(
  [
    [2.28, 0.3],
    [2.36, 0.68], // deep bumper face
    [2.18, 0.82],
    [1.1, 0.94], // short power-bulge hood
    [0.45, 1.0],
    [-1.3, 1.0], // dead-flat beltline
    [-2.1, 0.97], // the high R34 trunk deck
    [-2.28, 0.66],
    [-2.2, 0.32],
    [-1.88, 0.22],
    [1.88, 0.22],
  ],
  1.985,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.gtr.body,
);
const gtrCanopyGeo = extrudeProfile(
  [
    [1.0, 0.97],
    [0.34, 1.42],
    [-0.66, 1.44],
    [-1.32, 0.99],
  ],
  GTR_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.gtr.canopy,
);
const gtrRoofGeo = extrudeProfile(
  [
    [0.3, 1.43],
    [0.2, 1.49],
    [-0.56, 1.5],
    [-0.64, 1.44],
  ],
  roofWidth(GTR_CABIN_W),
  ROOF_EDGE,
  0,
  CROWN_BY_STYLE.gtr.roof,
);

// ---- FD-style curves: a low pop-up nose, a bubble glasshouse and
// haunches that roll into a short rounded tail. The spline profile is
// where this body earns its keep — almost no straight lines anywhere.
const rx7BodyGeo = extrudeProfile(
  [
    [2.28, 0.28],
    [2.34, 0.48], // low, flush nose
    [2.22, 0.58],
    [1.3, 0.7], // the pop-up shelf
    [0.5, 0.85],
    [-1.1, 0.88], // rear haunch peak
    [-1.95, 0.78],
    [-2.2, 0.52], // rounded kick
    [-2.14, 0.28],
    [-1.82, 0.2],
    [1.88, 0.2],
  ],
  1.961,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.rx7.body,
);
const rx7CanopyGeo = extrudeProfile(
  [
    [0.8, 0.83],
    [0.1, 1.28], // bubble peak over the driver
    // The roof-chord midpoint, collinear by construction. The glasshouse
    // was drawn with straight lines and two hard knuckles — 35 degrees
    // at the header, 23 at the C-pillar — because the spline only ever
    // ran through the first two points and lineTo'd the rest. One
    // derived pin with near-equal spacing either side keeps uniform
    // Catmull-Rom tame while the whole run curves; measured on the built
    // geometry, the screen bows 38.7 mm off its chord (the fleet runs
    // 37-54) and the glass peak stays under the painted cap.
    [-0.31, 1.26],
    [-0.72, 1.24],
    [-1.68, 0.78], // long rounded hatch glass
  ],
  RX7_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.rx7.canopy,
);
const rx7RoofGeo = extrudeProfile(
  [
    [0.06, 1.28],
    [-0.02, 1.33],
    [-0.6, 1.3],
    [-0.68, 1.25],
  ],
  roofWidth(RX7_CABIN_W),
  ROOF_EDGE,
  // 0, like the sedan/zx/pony/gtr roofs already pass: the painted cap
  // must balloon WITH the glass. Flipping the canopy alone left the
  // glass skin 6.8 mm proud of a straight-chord cap at z=-0.31.
  0,
  CROWN_BY_STYLE.rx7.roof,
);

// ---- Hot hatch: the shape a fast three-door has had for fifty years.
// Everything that makes it read as a hatch rather than as a short saloon
// is at the two ends — almost no overhang past either axle, and a
// tailgate that comes down nearly vertically instead of running out into
// a boot. The cabin sits tall and upright over it, which is why these
// cars look small and roomy at the same time.
const hatchBodyGeo = extrudeProfile(
  [
    [2.02, 0.34],
    [2.12, 0.68], // blunt, upright bumper face — the overhang is tiny
    [1.98, 0.84],
    [1.52, 0.94], // the bonnet is SHORT and climbs fast
    [1.04, 1.0], // cowl, well forward — this is what makes it a hatch
    [-1.38, 1.0], // beltline dead flat the length of the cabin
    [-1.94, 0.97], // haunch over the rear axle
    [-2.08, 0.64], // tailgate drops away almost vertically
    [-2.0, 0.34],
    [-1.7, 0.22],
    [1.7, 0.22],
  ],
  1.811,
  BODY_EDGE,
  2,
  CROWN_BY_STYLE.hatch.body,
);
// The cabin sits FORWARD. Authored first with the screen base back at
// z 0.74 it came out with a long bonnet and the glasshouse pushed over
// the rear axle, which is coupe proportion — the shape read as a short
// muscle car rather than a hatch. A hot hatch puts its windscreen where
// a saloon puts the back of its bonnet, and spends everything it saves
// on roof.
const hatchCanopyGeo = extrudeProfile(
  [
    // Pinned, then splined. The profile used to be a pure polyline —
    // with bottomPoints=2 the "spline" ran through exactly two points,
    // which is a straight line — so the header carried a 35-degree
    // crease and the C-pillar a 26, across the widest flat surfaces on
    // the car. Every pin below sits ON an authored chord (the exact 1/3
    // and 2/3 points of the roof, the screen and tailgate chords at
    // their own y), so the roof stays dead flat between them and the
    // curve deviates only at the two former knuckles, by 10-14 mm —
    // which is the fillet a real header has. The authored corners stay
    // authored: headerZ still finds [0.40, 1.44], so the driver's
    // seating anchor does not move.
    [1.02, 0.99],
    [0.65, 1.2585], // on the screen chord
    [0.40, 1.44], // short, steep screen
    [-0.05, 1.4467], // roof chord, 1/3
    [-0.50, 1.4533], // roof chord, 2/3
    [-0.95, 1.46], // long flat roof
    [-1.40, 1.2286], // on the tailgate chord
    // The tailgate glass, down ONTO the deck rather than near it.
    //
    // This was 1.04, and measured on the built car the foot of the rear
    // window finished 23 mm ABOVE the body's rear deck — daylight under
    // the backlight, the full width of the tailgate, on every hatch in
    // the game. It is the only junction in the fleet that does not
    // close: the other eight silhouettes bury their glass 7 to 63 mm
    // into the panel beneath it.
    //
    // Nothing caught it because nothing measured it. tests/roofline.mjs
    // is a regex over this file that checks the painted roof is as wide
    // as the glass; tools/shots/glasshouse.mjs measures the real thing
    // and has no assertions. Neither had ever asked where the glass
    // COMES DOWN. tests/glassfit.mjs does now.
    //
    // 48 mm, which is the shortfall plus the bite the rest of the fleet
    // carries. It stays above the screen base at 0.99, so the canopy's
    // bounding box does not move — see the note in models.ts about why
    // that is a problem rather than a convenience.
    [-1.86, 0.992],
  ],
  HATCH_CABIN_W,
  CANOPY_EDGE,
  0,
  CROWN_BY_STYLE.hatch.canopy,
);
const hatchRoofGeo = extrudeProfile(
  [
    [0.34, 1.44],
    [0.24, 1.5],
    [-0.82, 1.49],
    [-0.92, 1.43],
  ],
  roofWidth(HATCH_CABIN_W),
  ROOF_EDGE,
  // 0, matching the other four roofs: a faceted painted sliver over a
  // curved glasshouse reads as a plank laid on a dome.
  0,
  CROWN_BY_STYLE.hatch.roof,
);

/**
 * Per-silhouette scale. The RATIOS between styles come from the real
 * cars each shape evokes — a generic saloon (4.70 x 1.80 m), a Z32
 * 300ZX (4.31 x 1.80), an R34 Skyline (4.60 x 1.79), an FD RX-7
 * (4.30 x 1.76) — so the Z still parks visibly shorter than the R34.
 * The whole fleet then wears a 1.12 presence factor on top: from the
 * chase camera a spec-sheet car reads small and distant, and every
 * arcade racer up-sizes its metal for exactly this reason. Applied to
 * the whole group in createCar; collision constants in the engine were
 * re-margined for it (traffic hitbox and knock-out spacing).
 */
// Was 1.12: a flat up-size over the whole fleet so a spec-sheet car did
// not read small from the chase camera. It is 1 now, because every car
// in the showroom carries a real length in metres and is fitted to it —
// see the scale at the end of createCar — and a car that is 12% longer
// than the machine it evokes is not that machine. What is left below is
// the fallback for a shell built without a length: traffic, and the
// showroom capture tool.
const PRESENCE = 1;
const STYLE_SCALE: Record<BodyStyle, number> = {
  sedan: 0.934 * PRESENCE,
  zx: 0.825 * PRESENCE,
  // Base 0.912 (was 0.926): the R34 measured +11% on height, the worst
  // residual in the fleet. Trading a little length brings the roof down
  // while width lands within 1% of proportion — the closest a uniform
  // scale can get this profile to 4.60 x 1.79 x 1.36.
  gtr: 0.895 * PRESENCE,
  rx7: 0.853 * PRESENCE,
  // The pony shell is authored at 4.92 m raw; every car on it carries a
  // real lengthM, so this is only the fallback for a shell built
  // without one.
  pony: 0.9 * PRESENCE,
  // A hot hatch is the small car in this fleet and has to park like one:
  // 4.28 x 1.79 x 1.47 m, which is 40 cm shorter than the saloon and
  // 10 cm taller. The profile is authored close to those numbers, so the
  // factor here is near one.
  hatch: 0.935 * PRESENCE,
  // The pickup profile is authored at 5.28 m raw against a 5.35 m
  // truck, so this is close to one for the same reason the hatch's is.
  pickup: 0.987 * PRESENCE,
  // Authored at 4.82 m raw against a 4.85 m truck.
  suv: 1.006 * PRESENCE,
  super: 0.9 * PRESENCE,
};

/**
 * How wide the machine each silhouette evokes actually is.
 *
 * Width used to be a side effect. buildCar fits a car to the length on
 * its card with a UNIFORM scale, so a short car came out narrow and a
 * long one came out wide, in exact proportion — and real cars do not
 * work like that at all. A 3.95 m hatch and a 4.28 m hatch are within
 * 30 mm of each other across the doors; ours were 190 mm apart, and the
 * Sharq Hatch ended up 1.56 m wide, narrower across the body than a
 * Fiat 500. The saloons spread from 1.63 m to 1.89 m for the same
 * reason. Nobody chose any of those numbers.
 *
 * STYLE_SCALE's own comment on the gtr says it out loud — "the closest a
 * uniform scale can get this profile to 4.60 x 1.79 x 1.36" — because a
 * uniform scale has one degree of freedom and there are two numbers to
 * hit.
 *
 * So width gets its own fit. It is not simply held constant per
 * silhouette either: a longer car in a class IS a little wider, just
 * nothing like proportionally. The exponent is the whole law — 0 would
 * make every saloon exactly as wide as every other, 1 is the uniform
 * scale this replaces, and a third is what the real fleets do.
 */
export const STYLE_REAL: Record<BodyStyle, { l: number; w: number }> = {
  sedan: { l: 4.7, w: 1.8 },
  zx: { l: 4.31, w: 1.8 },
  gtr: { l: 4.6, w: 1.79 },
  rx7: { l: 4.3, w: 1.76 },
  hatch: { l: 4.28, w: 1.79 },
  pony: { l: 4.9, w: 1.88 },
  // A single-cab half-tonne. Longer and wider than anything else here,
  // which is the whole reason it needed its own shape: on the saloon
  // body it was a 5.35 m car drawn as a 4.7 m one and stretched.
  pickup: { l: 5.35, w: 1.95 },
  // Wide and short: a mid-engined two-seater is the only shape here
  // whose width is close to its wheelbase.
  super: { l: 4.55, w: 1.94 },
  // A mid-size SUV: a saloon's length on a truck's width and floor.
  suv: { l: 4.85, w: 1.93 },
};
export const WIDTH_FOLLOWS_LENGTH = 1 / 3;

/** The body width, across the doors, a car of this silhouette and this
 *  length should be built to. */
export function bodyWidthFor(style: BodyStyle, lengthM: number): number {
  const r = STYLE_REAL[style] ?? STYLE_REAL.sedan;
  return r.w * Math.pow(lengthM / r.l, WIDTH_FOLLOWS_LENGTH);
}

/** Per-silhouette anchor points so every detail lands on its body. */
interface StyleDims {
  nose: number;
  tail: number;
  /** Sunroof / antenna anchors on the roof panel: [z, y]. */
  roof: [number, number];
  noseTopY: number; // headlight centre height
  grilleY: number;
  beltY: number; // chrome beltline
  hoodY: number; // hood surface (shut lines, wipers)
  tailY: number; // tail light centre height
  deckY: number; // trunk deck (wing base)
  /** Side mirror: how far PROUD of the flank, then its height and how
   *  far forward. The first number used to be an absolute x, which meant
   *  it had to be re-derived by hand every time a body changed width. */
  mirror: [number, number, number];
  dashY: number;
  wiperZ: number;
  bPillar: [number, number, number];
  creaseY: number;
}
const STYLE_DIMS: Record<BodyStyle, StyleDims> = {
  sedan: {
    nose: 2.37, tail: -2.38, roof: [-0.2, 1.49], noseTopY: 0.7, grilleY: 0.52, beltY: 0.94,
    hoodY: 0.98, tailY: 0.78, deckY: 0.96, mirror: [0.03, 1.04, 0.82],
    dashY: 1.0, wiperZ: 0.93, bPillar: [0.77, 1.14, -0.2], creaseY: 0.72,
  },
  zx: {
    nose: 2.5, tail: -2.44, roof: [-0.53, 1.3], noseTopY: 0.56, grilleY: 0.42, beltY: 0.85,
    hoodY: 0.82, tailY: 0.66, deckY: 0.79, mirror: [0.03, 0.92, 0.4],
    dashY: 0.9, wiperZ: 0.5, bPillar: [0.8, 1.02, -0.75], creaseY: 0.6,
  },
  rx7: {
    nose: 2.44, tail: -2.32, roof: [-0.31, 1.34], noseTopY: 0.5, grilleY: 0.38,
    beltY: 0.8, hoodY: 0.72, tailY: 0.6, deckY: 0.76, mirror: [0.03, 0.9, 0.35],
    dashY: 0.86, wiperZ: 0.45, bPillar: [0.78, 0.98, -0.6], creaseY: 0.55,
  },
  gtr: {
    nose: 2.46, tail: -2.4, roof: [-0.18, 1.51], noseTopY: 0.76, grilleY: 0.5, beltY: 0.99,
    hoodY: 1.0, tailY: 0.84, deckY: 0.98, mirror: [0.03, 1.08, 0.85],
    dashY: 1.02, wiperZ: 0.95, bPillar: [0.79, 1.16, -0.16], creaseY: 0.76,
  },
  // The lamps sit high and the cabin sits forward: a hatch puts its
  // windscreen where a saloon puts its bonnet.
  hatch: {
    nose: 2.18, tail: -2.12, roof: [-0.3, 1.47], noseTopY: 0.76, grilleY: 0.56, beltY: 1.0,
    hoodY: 0.96, tailY: 0.84, deckY: 0.99, mirror: [0.03, 1.1, 0.86],
    dashY: 1.06, wiperZ: 1.12, bPillar: [0.78, 1.22, -0.32], creaseY: 0.76,
  },
  // Everything on this one sits LOW. The lamps are almost in the bumper,
  // the belt is under a metre, and the mirror is level with a saloon's
  // door handle.
  pony: {
    nose: 2.47, tail: -2.45, roof: [-0.44, 1.31], noseTopY: 0.5, grilleY: 0.38, beltY: 0.9,
    hoodY: 0.7, tailY: 0.78, deckY: 0.85, mirror: [0.03, 0.94, 0.62],
    dashY: 0.9, wiperZ: 0.6, bPillar: [0.73, 1.06, -0.52], creaseY: 0.6,
  },
  // Everything on this one sits HIGH, and the cabin sits FORWARD: the
  // belt is where a saloon's roof rail is, the mirror is above a
  // saloon's glass, and the deck behind the cab is a load bed rather
  // than a boot lid — which is why deckY is close to beltY here and
  // 180 mm below it on every other body.
  pickup: {
    nose: 2.62, tail: -2.66, roof: [-0.11, 1.62], noseTopY: 0.92, grilleY: 0.66, beltY: 1.04,
    hoodY: 1.06, tailY: 0.95, deckY: 1.0, mirror: [0.03, 1.2, 0.74],
    dashY: 1.12, wiperZ: 0.9, bPillar: [0.84, 1.3, -0.5], creaseY: 0.8,
  },
  // The cabin is FORWARD and the deck is behind it, which is the whole
  // difference between this and the three front-engined coupes: the
  // windscreen is where a saloon's bonnet is and the engine is where
  // its back seat is. Everything sits low, and the deck sits high,
  // because there is a motor under it.
  super: {
    nose: 2.28, tail: -2.32, roof: [-0.34, 1.22], noseTopY: 0.46, grilleY: 0.4, beltY: 0.82,
    hoodY: 0.66, tailY: 0.74, deckY: 0.92, mirror: [0.03, 0.86, 0.62],
    dashY: 0.82, wiperZ: 0.72, bPillar: [0.76, 0.98, -0.78], creaseY: 0.56,
  },
  // The pickup's heights on a saloon's layout: belt, mirror and dash
  // all sit where the truck's do, but the deck is a tailgate at the
  // very back rather than a bed behind the cab, so deckY is the roof
  // rail's neighbour and the B-pillar is a long way back under the
  // longest roof here.
  suv: {
    nose: 2.44, tail: -2.46, roof: [-0.8, 1.77], noseTopY: 0.96, grilleY: 0.7, beltY: 1.08,
    hoodY: 1.1, tailY: 1.0, deckY: 1.1, mirror: [0.03, 1.26, 0.76],
    dashY: 1.16, wiperZ: 0.94, bPillar: [0.84, 1.4, -0.42], creaseY: 0.82,
  },
};

/**
 * The rolling radius, in the CAR'S OWN units, before the silhouette's
 * scale and its length fit are applied.
 *
 * It is a contract rather than a number: ride height, wheel arches,
 * brake glow, skid marks and the authored GLB wheel are all dimensioned
 * against it (see public/models/README.md). Exported because something
 * outside this file has to know how fast to turn it, and guessing
 * produced a game whose wheels skidded.
 *
 * It was 0.36, and that was too small — measurably, not as a matter of
 * taste. tools/shots/wheels.mjs builds every car and divides its body
 * length by its wheel diameter, which is the ratio a real car fixes
 * within a narrow range whatever else about it changes:
 *
 *   Skyline R34 on 245/40R18   4600 / 653 = 7.0
 *   Supra A80 on 255/40R17     4514 / 636 = 7.1
 *   RX-7 FD on 225/50R16       4295 / 631 = 6.8
 *   Huracan on 305/30R20       4459 / 691 = 6.5
 *
 * Every car in this game came back at 8.05 — the same answer on all
 * sixteen, because the wheel was one fixed size and the bodies had been
 * fitted to real metres around it. 8.05 is a 4.5 m car on 560 mm
 * wheels, which is why they read as castors under it. The seven low
 * silhouettes were worse still on the other ratio: wheel diameter over
 * body height came out at 0.42 where a modern coupe is about 0.49.
 *
 * 0.41 puts the fleet at 7.07 and 0.48. The section below is unchanged —
 * it is still a real tyre's section — it is simply fitted to a bigger
 * wheel, which is what the whole SECTION_R / WHEEL_R_K pair exists to
 * express.
 */
export const TIRE_RADIUS = 0.375;

/*
 * Two things about the paragraph above, both measured since it was
 * written, for whoever comes at this next.
 *
 * The 7.07 is stale. It came from the measurement wheels.mjs was later
 * found to be making wrong — the body box counted the contact-shadow
 * decal and the whip aerial, inflating the car's length and flattering
 * the ratio. Corrected, the fleet sits at 6.13 to 6.15
 * length-over-diameter, one hundredth above the 6.1 floor that same tool
 * enforces. Real cars run 6.5 to 7.2 (a GT-R 6.5, a Golf 6.8, a Camry
 * 7.2), so the wheels are modestly LARGE and every car reads a little
 * stubby for it. That is a real deficit, not a rounding one.
 *
 * And it cannot be fixed by editing this number, which the comment above
 * implies it can because ARCH_Y and ARCH_MESH_Y are offsets from it.
 * Tried: 0.41 -> 0.375 puts length-over-diameter at a correct ~6.7 and
 * breaks 23 other measurements. dia/height drops under its band on seven
 * cars, and the arch gap goes out on all sixteen in BOTH directions at
 * once — 0.03 on the low silhouettes where the floor is 0.08, and 0.43 on
 * the tall ones where the ceiling is 0.3. The arch opening is cut into
 * the body, so moving the wheel down moves it into a different part of
 * each profile; the offsets keep the arch attached to the wheel, they do
 * not keep the CUT the right size. Trimming the wheels means re-cutting
 * the arches on all five silhouettes, which is a much larger job than
 * this constant makes it look.
 */

/**
 * How fat the tyre is, as a half width.
 *
 * It grows less than the radius does — 6% against 14%. That is not a
 * compromise, it is the constraint the same tool measured: the tyre's
 * outer wall already stands 10 to 20 mm proud of the bodywork over it,
 * which is flush fitment and looks right, and a tyre widened in
 * proportion to its new diameter would hang out of the arch instead.
 * The arch moves out by the same 8 mm to keep that gap where it was.
 */
export const TIRE_HALF_W = 0.1325;

/**
 * The radius and half width TIRE_SECTION below is AUTHORED at, and the
 * scale from there to the wheel actually fitted.
 *
 * Keeping the section in real millimetres and stating the fitment
 * separately means the profile stays readable as a tyre's profile — the
 * alternative, normalising every number to a fraction of the radius,
 * turns a bead at 218 mm into 0.6056 and makes the one thing this data
 * is FOR impossible to check by eye.
 *
 * Everything else in the wheel — barrel, spokes, hub, rotor, lugs — is
 * written the same way: the authored number, times the scale.
 */
const SECTION_R = 0.36;
const SECTION_HALF_W = 0.13;
const WHEEL_R_K = TIRE_RADIUS / SECTION_R;
const WHEEL_W_K = TIRE_HALF_W / SECTION_HALF_W;
export { WHEEL_R_K, WHEEL_W_K };

// The traffic tire: the same section, revolved coarsely.
//
// It used to be a bare barrel, which meant it read the tread band of the
// texture across its whole width and sampled the sidewall bands at its
// edges — hence the remapV(0.2, 0.8) that used to live here to shove the
// tread back into the middle. Sharing the hero's profile makes that
// unnecessary: the lathe puts the tread where the texture expects it,
// and a background car gets a shouldered tire for the same one draw.
//
// Declared after tireLathe, so the definition order is: section, lathe
// helper, then the two tires that use it.
let tireGeo: THREE.BufferGeometry;

/**
 * The hero tire, as a LATHED CROSS-SECTION rather than a barrel with two
 * rings stuck on it.
 *
 * What was here: a straight 30-segment cylinder for the tread and a
 * torus at each end for the shoulders. Three pieces, and it showed —
 * a cylinder meets its end cap at a hard ninety degrees, so the tread
 * had a machined edge with a separate doughnut floating beside it. No
 * tire has ever had that section. A tire is one continuous curve from
 * bead to bead: it rises off the rim, bulges out through the sidewall,
 * turns over a radiused shoulder and crowns very slightly across the
 * tread, and every one of those transitions is smooth.
 *
 * So: one profile, revolved. The numbers are a real tire's section.
 *
 *   The crown touches SECTION_R exactly and nothing else reaches it, so
 *   that after tireLathe scales the profile the outermost point of the
 *   tyre is TIRE_RADIUS to the millimetre. That is the contract — ride
 *   height, the wheel arches, the brake glow, the skid marks and the
 *   authored GLB wheel are all dimensioned against it, and a tyre that
 *   came out even a millimetre proud would lift every car in the game
 *   off its own shadow.
 *
 *   The half width is SECTION_HALF_W for the same reason, and the widest
 *   LATERAL point is the sidewall rather than the tread, which is what
 *   makes a tire look inflated instead of turned on a lathe.
 *
 * The UVs come out right for free. LatheGeometry runs v along the
 * profile, so laying the points out four / thirteen / four puts the
 * tread band at exactly v 0.2 to 0.8 — the same band the old three
 * pieces had to be remapped into by hand.
 */
const TIRE_SECTION: Array<[number, number]> = [
  // radius, axial — inner bead outward
  [0.218, -0.118], // bead, tucked onto the rim
  [0.258, -0.127],
  [0.298, -0.130], // the bulge: widest point of the whole tire
  [0.332, -0.122],
  [0.351, -0.101], // shoulder — tread band starts here (v = 0.2)
  [0.3572, -0.088],
  [0.3596, -0.074],
  [0.36, -0.058],
  [0.36, -0.038],
  [0.36, -0.019],
  [0.36, 0.0], // crown
  [0.36, 0.019],
  [0.36, 0.038],
  [0.36, 0.058],
  [0.3596, 0.074],
  [0.3572, 0.088],
  [0.351, 0.101], // shoulder — tread band ends here (v = 0.8)
  [0.332, 0.122],
  [0.298, 0.13],
  [0.258, 0.127],
  [0.218, 0.118],
];

function tireLathe(radialSegments: number): THREE.BufferGeometry {
  // Authored section, fitted wheel. Radially and axially by different
  // factors, because a tyre that gets 14% taller does not get 14% fatter
  // — see TIRE_HALF_W.
  const pts = TIRE_SECTION.map(
    ([r, y]) => new THREE.Vector2(r * WHEEL_R_K, y * WHEEL_W_K)
  );
  const g = new THREE.LatheGeometry(pts, radialSegments);
  // Lathe spins about Y; the axle is X.
  g.rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

// 44 rather than 30. A 30-sided silhouette is 2 mm off a circle at this
// radius and the tire is the roundest thing on the car — it is the one
// place where faceting is read as faceting rather than as style.
const tireGeoHi = tireLathe(44);
// 22 for traffic — the cars behind you at a lane's distance, where the
// silhouette is a dozen pixels across and nobody has ever counted its
// sides.
tireGeo = tireLathe(22);
// Brake hardware behind the spokes — a wheel with nothing inside it
// reads as a toy the moment the camera drops low. Radially by
// WHEEL_R_K, axially by WHEEL_W_K: a bigger wheel gets a bigger disc,
// which is exactly what happens when a real car goes up a rim size and
// the reason people go up a rim size in the first place.
const discGeo = new THREE.CylinderGeometry(
  0.2 * WHEEL_R_K, 0.2 * WHEEL_R_K, 0.022 * WHEEL_W_K, 22
);
discGeo.rotateZ(Math.PI / 2);
const lugGeo = new THREE.CylinderGeometry(
  0.016 * WHEEL_R_K, 0.016 * WHEEL_R_K, 0.026 * WHEEL_W_K, 6
);
lugGeo.rotateZ(Math.PI / 2);
const discMat = new THREE.MeshStandardMaterial({ name: "disc",
  color: 0x9aa0a8,
  metalness: 0.9,
  roughness: 0.35,
  envMapIntensity: 1.2,
});
/**
 * The tire's surface.
 *
 * A tire was one flat colour at a single roughness, which at any distance
 * reads as a black rubber donut. Real rubber differs from that in three
 * ways, and all three are visible from the chase camera: the tread has a
 * pattern with actual depth, the sidewall is smoother and glossier than
 * the tread, and there is a shoulder where the two meet.
 *
 * One height field drives colour, roughness and normals together, so the
 * groove that shows in the picture is the same groove the streetlight
 * catches — three maps authored separately drift apart and read as dirt
 * rather than geometry.
 *
 * The image is ONE lateral block period wide and the whole tire width
 * tall, tiled around the circumference. `v` runs across the tire: outer
 * bands are sidewall, the middle is tread. The wheel's UVs are remapped
 * to match (see remapV), which is what lets the tread barrel and both
 * shoulder bulges read from the right part of one image — and so keeps
 * the tire a single mesh, which the authored-asset swap and the wheel
 * test both rely on.
 */
/** Lateral tread blocks around the tire. At a 2.26 m circumference this
 *  puts a block every ~12 cm, which is what a road tire actually runs. */
const TREAD_BLOCKS = 18;

let tireSurfShared: {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} | null = null;

function tireSurface() {
  if (tireSurfShared) return tireSurfShared;
  const W = 192;
  const H = 256;
  const h = new Float32Array(W * H);
  // Deterministic hash noise: a tire that is grainy differently on every
  // reload is a tire whose screenshots never match.
  const grain = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const ridge = (t: number, c: number, w: number) => Math.max(0, 1 - Math.abs(t - c) / w);

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let e: number;
      if (v < 0.2 || v > 0.8) {
        // Sidewall: gently domed, carrying the fine concentric ribbing a
        // mould leaves, strongest out near the shoulder.
        const d = v < 0.5 ? v / 0.2 : (1 - v) / 0.2;
        e = 0.4 + 0.09 * Math.sin(v * 190) * (0.3 + 0.7 * d) + 0.08 * d;
      } else {
        // Tread: three circumferential grooves, and one lateral sipe per
        // tile raked across so the blocks are not a chequerboard.
        const t = (v - 0.2) / 0.6;
        e = 0.74;
        for (const c of [0.22, 0.5, 0.78]) e -= 0.55 * ridge(t, c, 0.055);
        const raked = (u + (t - 0.5) * 0.14 + 1) % 1;
        e -= 0.4 * Math.max(0, 1 - Math.abs(raked - 0.5) / 0.07);
        // Where the tread turns over the edge it breaks into shoulder
        // blocks — the part you actually see when the car is sideways.
        if (t < 0.12 || t > 0.88) {
          e -= 0.2 * Math.max(0, 1 - Math.abs(((u * 2) % 1) - 0.5) / 0.18);
        }
      }
      h[y * W + x] = Math.min(1, Math.max(0, e + (grain(x, y) - 0.5) * 0.05));
    }
  }

  const canvas = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
  };
  const colC = canvas();
  const rghC = canvas();
  const nrmC = canvas();
  const col = colC.getContext("2d")!.createImageData(W, H);
  const rgh = rghC.getContext("2d")!.createImageData(W, H);
  const nrm = nrmC.getContext("2d")!.createImageData(W, H);

  const at = (x: number, y: number) =>
    h[Math.min(H - 1, Math.max(0, y)) * W + ((x + W) % W)];

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const sidewall = v < 0.2 || v > 0.8;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const e = h[y * W + x];
      // Rubber is never pure black: it sits around 8-12% reflectance with
      // a faint blue-grey cast. Pure black reads as a hole in the frame.
      const base = sidewall ? 13 : 10;
      const lit = base + e * (sidewall ? 15 : 26);
      col.data[i] = lit * 0.98;
      col.data[i + 1] = lit;
      col.data[i + 2] = lit * 1.1;
      col.data[i + 3] = 255;
      // Sidewall rubber has a sheen; tread blocks are scuffed matte and
      // the groove floors, which never touch the road, rougher still.
      const r = sidewall ? 0.6 + (1 - e) * 0.14 : 0.86 + (1 - e) * 0.12;
      const rv = Math.round(Math.min(1, r) * 255);
      rgh.data[i] = rgh.data[i + 1] = rgh.data[i + 2] = rv;
      rgh.data[i + 3] = 255;
      // Normals by central difference on the same field.
      const dx = (at(x + 1, y) - at(x - 1, y)) * 3.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 3.2;
      const len = Math.hypot(dx, dy, 1);
      nrm.data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      nrm.data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      nrm.data[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      nrm.data[i + 3] = 255;
    }
  }
  colC.getContext("2d")!.putImageData(col, 0, 0);
  rghC.getContext("2d")!.putImageData(rgh, 0, 0);
  nrmC.getContext("2d")!.putImageData(nrm, 0, 0);

  const map = new THREE.CanvasTexture(colC);
  const roughnessMap = new THREE.CanvasTexture(rghC);
  const normalMap = new THREE.CanvasTexture(nrmC);
  map.colorSpace = THREE.SRGBColorSpace;
  // Linear data, both of them. A roughness or normal map tagged sRGB is
  // silently decoded through the EOTF and comes out wrong — the same
  // trap the road surface fell into.
  roughnessMap.colorSpace = THREE.NoColorSpace;
  normalMap.colorSpace = THREE.NoColorSpace;
  for (const t of [map, roughnessMap, normalMap]) {
    // Around the circumference it tiles; across the width it must not,
    // or the sidewall wraps onto the opposite shoulder.
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(TREAD_BLOCKS, 1);
    t.anisotropy = 8; // read at a glancing angle, always
  }
  tireSurfShared = { map, normalMap, roughnessMap };
  return tireSurfShared;
}

/** Rewrite a geometry's V coordinates into the [lo, hi] band of the tire
 *  texture, so tread barrel and shoulders share one image. */
function remapV(geo: THREE.BufferGeometry, lo: number, hi: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, lo + uv.getY(i) * (hi - lo));
  uv.needsUpdate = true;
  return geo;
}

/**
 * Tyre sidewall lettering — the sticker package.
 *
 * WHY IT IS NOT PART OF THE TYRE TEXTURE
 *
 * The obvious place is tireSurface(), which already draws the sidewall.
 * It cannot go there: that texture repeats TREAD_BLOCKS times around the
 * circumference, because a tread block every 12 cm is what a road tyre
 * runs — so a brand name baked into it would appear eighteen times around
 * each wheel, a third of a centimetre tall. Lettering belongs on its own
 * surface at its own repeat, which is also what it is in life: a moulded
 * band, not part of the tread pattern.
 *
 * WHY IT FOLLOWS THE PROFILE
 *
 * A sidewall is not flat. Across the radii this band covers, TIRE_SECTION
 * moves 8 mm axially — it bulges out at the widest point and tucks back
 * in at the bead — so a flat ring at a constant x would bury itself in
 * the rubber in the middle and float clear of it at both edges. The strip
 * below is lathed from the tyre's OWN section points, offset along the
 * surface normal. That is the principle the full-length side graphic
 * already follows on the body: a decal that follows the shape rather than
 * being hung in front of it.
 *
 * WHICH SIDE IT GOES ON
 *
 * The outboard one. TIRE_SECTION runs axially from -0.118 to +0.118 and
 * tireLathe rotates the result 90 degrees about Z, which maps +Y to -X —
 * so the section's first point lands at +X. The tyre geometry is shared
 * between all four wheels without mirroring, which makes +X outboard on
 * the right of the car and INBOARD on the left. The band is placed from
 * `side`, the wheel's own idea of which way is out, so it is the face you
 * can see on all four rather than on two.
 */
const TYRE_STICKERS = {
  /** Raised white letters: the street look, and the reason the phrase
   *  exists at all. */
  rwl: { ink: "#efeae0", name: "KHALEEJ", sub: "GT-R1" },
  /** The amber-lettered retro fitment. */
  retro: { ink: "#e8b34a", name: "RIMAL", sub: "SPORT" },
  /** Moulded and unpainted — the letters are there, in rubber, catching
   *  the light and nothing else. What a tyre looks like from the mould. */
  moulded: { ink: "#2a2a2e", name: "SAQR", sub: "RADIAL" },
} as const;

export type TyreSticker = keyof typeof TYRE_STICKERS;

const stickerTexCache = new Map<TyreSticker, THREE.CanvasTexture>();

/**
 * The band, unrolled: brand and fitment code, twice around.
 *
 * Twice rather than once, because a single name on a spinning wheel is
 * absent for half of every rotation; and rather than four, because at
 * four the words stop being words.
 */
function tyreStickerTexture(id: TyreSticker): THREE.CanvasTexture {
  const hit = stickerTexCache.get(id);
  if (hit) return hit;
  const spec = TYRE_STICKERS[id];
  // Long and thin, because the surface is: this wraps a band about 2.3 m
  // around and 60 mm tall, so the canvas is sized to give the letters
  // real texels rather than to be square.
  const W = 2048;
  const H = 64;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  // Transparent everywhere the letters are not: this is a decal laid on
  // the rubber, not a replacement for it.
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = spec.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 2; i++) {
    const cx = (i + 0.5) * (W / 2);
    ctx.font = `700 40px ${latinDisplay()}`;
    ctx.fillText(spec.name, cx - 150, H / 2);
    // The fitment code, smaller and set apart the way it is on a real
    // sidewall: the name is what you read at a glance, the code is what
    // you read standing still.
    ctx.font = `600 22px ${latinDisplay()}`;
    ctx.fillText(spec.sub, cx + 190, H / 2 + 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  stickerTexCache.set(id, t);
  return t;
}

const stickerMatCache = new Map<TyreSticker, THREE.MeshStandardMaterial>();
function tyreStickerMat(id: TyreSticker): THREE.MeshStandardMaterial {
  const hit = stickerMatCache.get(id);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({
    name: `tire-sticker-${id}`,
    map: tyreStickerTexture(id),
    transparent: true,
    // Moulded letters are rubber, and rubber is not glossy. Painted ones
    // are paint over rubber, and only slightly less matt.
    roughness: id === "moulded" ? 0.95 : 0.72,
    metalness: 0,
    // It sits 3.5 mm off a surface curving away from it: depth-test
    // against the tyre, but do not fight it.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  stickerMatCache.set(id, m);
  return m;
}

/**
 * A strip lathed from the tyre's own sidewall, lifted off it.
 *
 * `from` and `to` index into TIRE_SECTION. The lift is along the 2D
 * normal at each point, so the band stands the same distance proud all
 * the way across a surface that bulges at one end of it and tucks in at
 * the other.
 */
function tyreStickerBand(from: number, to: number, lift = 0.0035, seg = 48): THREE.BufferGeometry {
  const pts: Array<[number, number]> = [];
  for (let i = from; i <= to; i++) {
    const [r, a] = TIRE_SECTION[i];
    const [rp, ap] = TIRE_SECTION[Math.max(from, i - 1)];
    const [rn, an] = TIRE_SECTION[Math.min(to, i + 1)];
    const dr = rn - rp;
    const da = an - ap;
    const len = Math.hypot(dr, da) || 1;
    const nr = -da / len;
    const na = dr / len;
    // Outward is +axial on this band; the far wheel gets it mirrored.
    const sgn = na >= 0 ? 1 : -1;
    pts.push([r + nr * lift * sgn, a + na * lift * sgn]);
  }
  const n = pts.length - 1;
  const pos = new Float32Array((n + 1) * (seg + 1) * 3);
  const uv = new Float32Array((n + 1) * (seg + 1) * 2);
  const idx: number[] = [];
  for (let j = 0; j <= n; j++) {
    const [r, a] = pts[j];
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const o = (j * (seg + 1) + i) * 3;
      // Built straight into the wheel's own frame, where the axle is X —
      // the same frame tireLathe reaches by rotating.
      pos[o] = a * WHEEL_W_K;
      pos[o + 1] = Math.cos(th) * r * WHEEL_R_K;
      pos[o + 2] = Math.sin(th) * r * WHEEL_R_K;
      const ou = (j * (seg + 1) + i) * 2;
      uv[ou] = i / seg;
      uv[ou + 1] = j / n;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < seg; i++) {
      const v = j * (seg + 1) + i;
      idx.push(v, v + 1, v + seg + 1, v + 1, v + seg + 2, v + seg + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Section indices 18..21 are the outboard sidewall between the shoulder
 *  and the bead — the band a real tyre carries its name on. Built once
 *  and shared: never dispose it. */
let tyreBandGeo: THREE.BufferGeometry | null = null;
function getTyreBandGeo(): THREE.BufferGeometry {
  tyreBandGeo ??= tyreStickerBand(18, 21);
  return tyreBandGeo;
}

/**
 * Lay the lettering band on the wheel's OUTBOARD face.
 *
 * The geometry is built once on the +axial sidewall and the far side is
 * that band mirrored in x. Mirroring inverts the winding, so the material
 * is DoubleSide — cheaper and less breakable than lathing a second
 * geometry the other way round.
 */
function addTyreSticker(w: THREE.Group, side: number, sticker?: TyreSticker): void {
  if (!sticker) return;
  const band = new THREE.Mesh(getTyreBandGeo(), tyreStickerMat(sticker));
  if (side < 0) band.scale.x = -1;
  band.userData.wheelPart = "tire-sticker";
  band.userData.wheelSide = side;
  w.add(band);
}

let tireMatShared: THREE.MeshStandardMaterial | null = null;
function getTireMat(): THREE.MeshStandardMaterial {
  if (tireMatShared) return tireMatShared;
  const s = tireSurface();
  tireMatShared = new THREE.MeshStandardMaterial({
    // Named, like every other material on the car. It was the one
    // unnamed material in the build, which meant every tool that groups
    // meshes by what they wear filed four tyres per car under
    // "unnamed" — and a tool measuring tyres could not find the tyre.
    name: "tire",
    map: s.map,
    normalMap: s.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: s.roughnessMap,
    color: 0xffffff,
    roughness: 1, // the map carries the real range
    metalness: 0,
    envMapIntensity: 2.4, // rubber picks up the night, faintly
  });
  return tireMatShared;
}

const rimGeo = new THREE.CylinderGeometry(
  0.205 * WHEEL_R_K, 0.205 * WHEEL_R_K, 0.27 * WHEEL_W_K, 14
);
rimGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(
  0.06 * WHEEL_R_K, 0.06 * WHEEL_R_K, 0.29 * WHEEL_W_K, 8
);
hubGeo.rotateZ(Math.PI / 2);
// x is along the axle here, so it takes the axial scale and the other
// two take the radial one.
const spokeGeo = roundedBox(
  0.27 * WHEEL_W_K, 0.3 * WHEEL_R_K, 0.06 * WHEEL_R_K, 0.018 * WHEEL_R_K
);
/**
 * The inside of the pipe.
 *
 * Darker than any tip finish and completely matte, because that is what
 * a bore is: unburnt fuel and carbon baked onto steel, in shadow, with
 * nothing to reflect. It is the only part of an exhaust that is the same
 * colour whatever the tip is made of — chrome, titanium and ceramic all
 * look identical two centimetres down the tube.
 */
const boreMat = new THREE.MeshStandardMaterial({
  name: "exhaust-bore",
  color: 0x0a0908,
  roughness: 1,
  metalness: 0,
  // Seen from OUTSIDE the cylinder's wall, because the camera is looking
  // down a tube at the far side of it. Without this the inner wall is
  // back-face culled and the pipe is a hole with nothing in it.
  side: THREE.BackSide,
});
/** The blind end of the bore, so a tip is a tube rather than a window
 *  through the bumper. Front-facing: this one is looked at directly. */
const boreCapMat = new THREE.MeshStandardMaterial({
  name: "exhaust-bore-cap",
  color: 0x080706,
  roughness: 1,
  metalness: 0,
});

/** Ceramic-coated race tip: matte black, soot-dulled. */
const ceramicTipMat = new THREE.MeshStandardMaterial({ name: "exhaust-tip-ceramic",
  color: 0x1a1a1c,
  roughness: 0.62,
  metalness: 0.35,
});
/** Titanium, burnt blue-violet at the tip the way heat leaves it. */
const titaniumTipMat = new THREE.MeshStandardMaterial({ name: "exhaust-tip-titanium",
  color: 0x6b7ea8,
  roughness: 0.3,
  metalness: 0.95,
  envMapIntensity: 1.4,
});
const rimMat = new THREE.MeshStandardMaterial({ name: "rim",
  color: 0xc8cdd4,
  roughness: 0.2,
  metalness: 0.95,
  envMapIntensity: 1.5,
});
/** A plastic wheel cover: grey, dull, and nothing like a machined face.
 *  Low metalness is the whole point — a hubcap that catches a highlight
 *  the way an alloy does is just a cheap-looking alloy. */
const hubcapMat = new THREE.MeshStandardMaterial({
  name: "hubcap",
  color: 0xa8adb4,
  roughness: 0.55,
  metalness: 0.15,
  envMapIntensity: 0.5,
});
const rimDarkMat = new THREE.MeshStandardMaterial({ name: "rim-dark",
  color: 0x23262b,
  roughness: 0.5,
  metalness: 0.6,
});

/**
 * The hubcap's dish: a shallow cone across most of the rim's face.
 *
 * Sized to the FITTED wheel like everything else in this section, so a
 * cover stays a cover when the wheel changes size rather than becoming
 * a saucer floating in front of one.
 */
const hubcapGeo = new THREE.CylinderGeometry(
  0.2 * WHEEL_R_K, 0.185 * WHEEL_R_K, 0.03 * WHEEL_W_K, 20
);
hubcapGeo.rotateZ(Math.PI / 2);

const lipGeo = new THREE.TorusGeometry(
  0.195 * WHEEL_R_K, 0.014 * WHEEL_R_K, 6, 20
);
lipGeo.rotateY(Math.PI / 2);
/**
 * Wheel arches.
 *
 * The body is one extruded shell with no opening cut in it, so the arch
 * has to be built ON its surface: a dark disc that reads as the shadowed
 * recess, and a body-coloured lip standing proud of it that reads as the
 * formed edge of the fender. The wheel's outer face sits at 0.97, past
 * both, which is what sells the opening.
 *
 * All of this used to be drawn at the WHEEL's centre rather than at the
 * body's surface: the lip spanned x 0.785-0.895 and the well sat at
 * 0.756, against a shell 0.92 wide. Every car in the game carried two
 * hidden meshes on each of its four corners, and the wheel read as a
 * hubcap glued to a flat painted wall.
 *
 * The front arch is the larger of the two and carries a flare, the way a
 * front fender is a wider panel than the rear quarter it runs back into.
 */
// How far outside the shell's own flank the opening and its lip sit.
// These were absolute numbers taken from the sedan's 0.92 half-width,
// which put both of them INSIDE the flank on the four wide silhouettes —
// the zx, rx7 and gtr shells run 0.96 to 0.98. Offsets from the shell's
// measured width work on every body.
// They also carry the tyre's extra half width, so that widening the
// tread did not simply push it out through the fender: the measured
// poke — how far the tyre's outer wall stands proud of the bodywork
// over it — stays where it was at 10 to 20 mm, which is flush fitment.
const TREAD_OUT = TIRE_HALF_W - SECTION_HALF_W;
const ARCH_OUT = 0.005 + TREAD_OUT;
const LIP_OUT = 0.009 + TREAD_OUT;
/**
 * How high the arch sits over the tyre.
 *
 * Measured before this was touched: the opening's top edge stood 165 mm
 * above the tyre at the front and 140 mm at the rear. A road car runs 40
 * to 90 mm, and a street car on this road runs less than that — 165 mm
 * is the gap of something with a lift kit, and it made every machine in
 * the showroom look like it was on stilts however low its roofline was.
 *
 * Two things were wrong at once and they added up. The arch was centred
 * 40 mm ABOVE the wheel centre, and its radius was 125 mm larger than
 * the tyre's. Real arches do sit a little above centre — the opening is
 * not concentric with the wheel — but nothing like the sum of those.
 *
 * The arch is now centred just above the wheel and radiused to leave
 * about 70 mm at the crown, which is what a car looks like sitting on
 * its own springs.
 *
 * All of it is now written as an OFFSET from TIRE_RADIUS rather than as
 * an absolute number, and additively rather than proportionally. That
 * choice is the whole reason a wheel could be made 14% bigger without
 * re-tuning any of this: an additive offset keeps the crown gap at
 * exactly the 70 mm this comment describes whatever the tyre's radius
 * is, where scaling the arch in proportion would have grown the gap by
 * 14% too and undone the fix.
 */
/** How far the arch centre sits above the axle. An opening is not
 *  concentric with its wheel; a real one rides a little high. */
const ARCH_RISE = 0.015;
const ARCH_Y = TIRE_RADIUS + ARCH_RISE;
/** Where the arch meshes sit, and how much bigger than the tyre each
 *  opening is. Front is the larger of the two. */
const ARCH_MESH_Y = TIRE_RADIUS + 0.04;
const ARCH_R_R = TIRE_RADIUS + 0.04;
const ARCH_R_F = TIRE_RADIUS + 0.055;
// 44 segments, not 22. At 22 the well's rim moved in ~114 mm chords —
// 16 degrees per facet on the one curve the eye traces around every
// wheel — while the body shells hold themselves to ~5.5 mm per facet.
const archWellGeo = new THREE.CircleGeometry(TIRE_RADIUS + 0.025, 44);
const archWellGeoF = new THREE.CircleGeometry(ARCH_R_R, 44);
// A rolled panel edge, not a hoop. The first pass used a 0.03-0.038 tube
// standing 18 mm proud and it read as a roll bar bolted over the wheel;
// a real arch lip is a few millimetres of turned-over steel that catches
// one thin highlight.
// 60/64 tubular segments over the half-turn (was 28/30 — 45 mm facets
// catching that "one thin highlight" as a string of straight glints),
// and 12 radial so the rolled edge is round in section. The radii, the
// tube sizes and every mesh position are untouched: the bounding
// extremes land on exact vertices under both old and new counts, so
// nothing measured moves.
const archLipGeo = new THREE.TorusGeometry(ARCH_R_R, 0.016, 12, 60, Math.PI);
archLipGeo.rotateY(Math.PI / 2);
const archLipGeoF = new THREE.TorusGeometry(ARCH_R_F, 0.021, 12, 64, Math.PI);
// The outer edge of each arch — the lip's radius plus its tube — and the
// height its centre sits at. Anything running along the flank has to
// stop here, so the numbers are named rather than repeated.
const ARCH_EDGE_F = ARCH_R_F + 0.021;
const ARCH_EDGE_R = ARCH_R_R + 0.016;
archLipGeoF.rotateY(Math.PI / 2);
const wellMat = new THREE.MeshBasicMaterial({ name: "arch-well", color: 0x060708 });

/**
 * The wide-body kit: over-fenders, and the track to fill them.
 *
 * A wide body is not a re-stamped door skin. Nobody widens a car by
 * making the doors wider — they rivet a flare over the arch and run more
 * wheel offset, and the door between the arches is the panel it always
 * was. That is exactly what this build wants to hear, because `flankX`
 * is measured off the shell (see the comment where it is taken) and
 * every detail on the flank is an offset from it. Widen the shell and
 * all of that has to be re-measured; bolt a flare over the arch and
 * none of it moves.
 *
 * `proud` is how far the flare's outermost paint stands past the door
 * skin, per side. The ceiling is not taste, it is measured:
 * tests/size.mjs allows an arch 0.1 m proud of the doors per side and
 * requires the mirrors to stay the widest thing on the car, and the
 * mirrors sit at flankX + 0.11. So 0.086 is the widest arch this game
 * can have without the mirrors disappearing inside the bodywork.
 *
 * `track` pushes each wheel outward to fill the new arch. It cannot
 * simply match `proud` — the same test requires the tyre to stay inside
 * the arch within 0.12 m, and the wheel already stands 0.068 proud of
 * the flank at its lugs. Half the flare is about right and leaves the
 * tyre tucked under the lip, which is what a fitted arch looks like.
 *
 * The tube radius is what does the standing-proud, so the flare is
 * positioned inboard of its own outer face by exactly that.
 */
export interface WideSpec {
  /** Outermost paint, past the door skin, per side (metres). */
  proud: number;
  /** How much further out each wheel sits (metres). */
  track: number;
  /** Rivets around each arch. Zero for a moulded street flare, which is
   *  bonded and painted rather than bolted on. */
  rivets: number;
}

export const WIDE: Record<KitLevel, WideSpec> = {
  // A street flare is a modest bonded lip — the arch looks fuller and
  // nothing about the car says workshop.
  //
  // Each level grew by the same amount on BOTH numbers — +8, +17 and
  // +26 mm — which is the only direction this table can safely move.
  // proud is where the flare stands and track is where the tyre stands,
  // so equal deltas keep the measured 40-90 mm poke exactly where the
  // fitment tool passed it, while the whole car plants wider: an attack
  // build now carries 112 mm of arch and 70 mm of track per side, which
  // reads as a widebody instead of a trim ring.
  street: { proud: 0.042, track: 0.02, rivets: 0 },
  // A sport arch is a bolt-on with the fasteners showing.
  sport: { proud: 0.077, track: 0.045, rivets: 7 },
  // And the attack arch is as wide as the rules of this game allow —
  // literally: tests/size.mjs holds every flare to 0.1 m per side of
  // the doors, and the first draft of this widening put the Storm S8 at
  // 0.107. 0.104 raw landed at 0.099 after the car's own scale — one
  // millimetre under, which stopped being enough the moment the doors
  // were fitted to a real width: the Storm's skin came out 62 mm wider
  // and carried its own flare out with it, to 0.102. A flare is authored
  // in the car's own units and a wider car has a proportionally wider
  // one, so the fix is here rather than in the ceiling. 0.100 raw lands
  // at 0.096 on the widest car that wears this kit; the track keeps the
  // same 42 mm offset so the measured poke does not move.
  attack: { proud: 0.1, track: 0.062, rivets: 9 },
};

/** How much of `proud` is the tube itself. The rest is standoff, so the
 *  flare reads as a separate piece sitting over the arch rather than as
 *  a fat lip growing out of it. */
const FLARE_TUBE_FRAC = 0.62;

/**
 * A flare traces the SAME arc as the arch lip it sits over — same radius,
 * same half-turn — just fatter and further out. Tracing a different curve
 * is what made the first attempt at this read as scaffolding: two arches
 * over one wheel, disagreeing about where the wheel was.
 *
 * Six of them (three kit levels x front/rear), built once and shared,
 * the way every other shell in this file is.
 */
const flareGeoCache = new Map<string, THREE.BufferGeometry>();
function flareGeo(kit: KitLevel, front: boolean): THREE.BufferGeometry {
  const key = `${kit}:${front ? "f" : "r"}`;
  const hit = flareGeoCache.get(key);
  if (hit) return hit;
  const tube = WIDE[kit].proud * FLARE_TUBE_FRAC;
  // The same counts as the lip each flare sits over, raised with it:
  // the measured rule here is that flare and lip must trace the same
  // arc — "two arcs that agree about where the wheel is read as one
  // fender" — and that now includes agreeing about the tessellation.
  // The flare tube is two to four times fatter than the lip's, so
  // smoothing only the lip would have left the WORST faceting on the
  // most visible torus of every kitted car.
  const geo = new THREE.TorusGeometry(
    front ? ARCH_R_F : ARCH_R_R,
    tube,
    12,
    front ? 64 : 60,
    Math.PI
  );
  geo.rotateY(Math.PI / 2);
  flareGeoCache.set(key, geo);
  return geo;
}

/** One rivet head. Shared across every arch on every car. */
const RIVET_R = 0.011;
const rivetGeo = new THREE.SphereGeometry(RIVET_R, 6, 5);
// The hot-hatch nose stripe: painted red, not a lamp, but it carries a
// little glow so it still reads at night when nothing is lighting the
// bumper directly.
const hotStripeMat = new THREE.MeshStandardMaterial({ name: "hot-stripe",
  color: 0xc8102e,
  roughness: 0.35,
  emissive: 0x3a0409,
  emissiveIntensity: 0.6,
});

/**
 * Where the painted skin actually is.
 *
 * A style's anchors are the control points of its 2D profile. The
 * extrusion then bevels that profile, and the spline bows between the
 * points, so the surface ends up tens of millimetres away from the
 * anchor — outward at the nose, upward over the deck. Detail placed by
 * eye at "anchor, minus a bit" therefore kept landing inside the
 * bodywork: the Z32's entire headlight bar, both pop-up lamps and their
 * doors on the FD, the cooling slot on both cab-back noses, the third
 * brake light on the fastbacks, the front plate on the FD.
 *
 * So stop guessing and ask the geometry. Fire one ray at the shell from
 * outside the car; the first hit is the skin. Memoised on the geometry
 * and the ray, because the shells are module-level and shared — this
 * runs a handful of times for the life of the process, not once per car.
 */
const surfaceCache = new Map<string, number | null>();
function shellSurface(
  geo: THREE.BufferGeometry,
  key: string,
  from: [number, number, number],
  dir: [number, number, number]
): number | null {
  const cached = surfaceCache.get(key);
  if (cached !== undefined) return cached;
  const probe = new THREE.Mesh(geo);
  probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(from[0], from[1], from[2]),
    new THREE.Vector3(dir[0], dir[1], dir[2]).normalize()
  );
  const hit = ray.intersectObject(probe, false)[0];
  // A miss means the caller aimed off the body, which is its bug to fix.
  // Returning null lets it fall back to the old constant rather than
  // flinging the part to infinity.
  const at = hit
    ? dir[1] !== 0
      ? hit.point.y
      : dir[2] !== 0
        ? hit.point.z
        : hit.point.x
    : null;
  surfaceCache.set(key, at);
  return at;
}
/** The body's outer face at a height, on the centreline, front or rear. */
function noseFaceZ(geo: THREE.BufferGeometry, style: BodyStyle, y: number, front: boolean): number | null {
  const far = front ? 6 : -6;
  return shellSurface(geo, `${style}:z${front ? "+" : "-"}${y}`, [0, y, far], [0, 0, front ? -1 : 1]);
}
/** The rear face OFF the centreline: the skin a lamp at (x, y) actually
 *  sits against. A tail is not flat — the corners are bevelled in, so
 *  the face at the outer lamp is forward of the face behind the plate. */
function tailFaceZ(geo: THREE.BufferGeometry, style: BodyStyle, x: number, y: number, tag = ""): number | null {
  return shellSurface(geo, `${style}${tag}:z-${y}@${x}`, [x, y, -6], [0, 0, 1]);
}
/** The same at the FRONT, and off the centreline for the same reason:
 *  a nose is not flat either. Measured, the stock lamp sat 53 to 121 mm
 *  ahead of the bodywork at its own x, because it was pinned to `d.nose`
 *  — the silhouette's centreline anchor — while the panel it is supposed
 *  to be set into falls away toward the corner. noseFaceZ answers for the
 *  centreline only and is what the mod branches already use. */
function noseFaceAt(geo: THREE.BufferGeometry, style: BodyStyle, x: number, y: number, tag = ""): number | null {
  return shellSurface(geo, `${style}${tag}:z+${y}@${x}`, [x, y, 6], [0, 0, -1]);
}
/**
 * A part of the face, bent onto the nose.
 *
 * `src` is built flat around its own centre; it is placed at (cx, cy) and
 * every vertex is pushed along z so the part's FRONT stands `proud` off
 * the skin directly behind that vertex. A nose is curved both ways — it
 * falls back toward its corners and slopes under toward the valance — so
 * a flat part pinned to the skin at its centre buries its edges, and one
 * pinned to its most forward point floats clear of the paint everywhere
 * else. Sampled on a grid across the part's footprint and interpolated;
 * each sample is one cached ray against the shell.
 *
 * Returns geometry in the car's own coordinates (place the mesh at 0,0,0).
 * Cached per shell, part and position, so the traffic sharing a
 * silhouette shares the buffer.
 */
const onNoseCache = new Map<string, THREE.BufferGeometry>();
/**
 * The front half-metre of a shell, for firing many rays at it.
 *
 * A ray from ahead of the car meets the nose first, and the nose is all
 * within a few hundred millimetres of the body's furthest point — so the
 * rest of the shell (the flanks, the cabin, the tail) can never be the
 * first hit and is only cost. Cached per shell. The answers are exactly
 * the full shell's for any ray that meets the nose; one that misses it
 * (above the bonnet line) gets null here where the full shell would
 * answer with the windscreen, so the two keep separate cache keys.
 */
const noseSubCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function noseRegion(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const hit = noseSubCache.get(geo);
  if (hit) return hit;
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeBoundingBox();
  const cut = flat.boundingBox!.max.z - 0.5;
  const src = flat.attributes.position as THREE.BufferAttribute;
  const keep: number[] = [];
  for (let t = 0; t < src.count; t += 3) {
    if (Math.max(src.getZ(t), src.getZ(t + 1), src.getZ(t + 2)) < cut) continue;
    for (let k = 0; k < 3; k++) keep.push(src.getX(t + k), src.getY(t + k), src.getZ(t + k));
  }
  const sub = new THREE.BufferGeometry();
  sub.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
  sub.computeBoundingSphere();
  noseSubCache.set(geo, sub);
  return sub;
}
function onNose(
  src: THREE.BufferGeometry,
  key: string,
  geo: THREE.BufferGeometry,
  style: BodyStyle,
  tag: string,
  cx: number,
  cy: number,
  proud: number,
  fallbackZ: number
): THREE.BufferGeometry {
  const id = `${style}${tag}|${key}|${cx.toFixed(3)},${cy.toFixed(3)}|${proud}`;
  const hit = onNoseCache.get(id);
  if (hit) return hit;
  // Tessellated first. A box has vertices only at its edges, so bent
  // onto a nose that bows forward in the middle its front stayed a flat
  // plane between them, and the paint came through it — measured, the
  // middle of a 1.3 m aperture was behind the skin on car after car.
  // 30 mm edges follow the curvature at any size this face is built.
  const g = new TessellateModifier(0.03, 8).modify(src);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const x0 = bb.min.x, x1 = bb.max.x, y0 = bb.min.y, y1 = bb.max.y;
  // A sample every 60 mm across and 30 mm up: a nose's vertical curve is
  // tighter than its plan curve, and the layers stand only 1.5-5 mm off
  // the paint, so an under-sampled bulge between two samples is enough
  // to bury a part.
  const NX = Math.min(25, Math.max(3, Math.ceil((x1 - x0) / 0.06) + 1));
  const NY = Math.min(12, Math.max(2, Math.ceil((y1 - y0) / 0.03) + 1));
  const nose = noseRegion(geo);
  const ntag = `${tag}:nose`;
  // A sample is nose skin only if it is within 450 mm of the nose's own
  // front. At a mouth's outer corner a ray can run along the flank and
  // clip a long flank triangle a metre or more back — measured, a brake
  // duct was bent into a sheet 2.4 m long running down the inside of the
  // car. Anything behind that is not the skin this part sits on.
  const sane = (z: number | null): z is number => z !== null && z > fallbackZ - 0.45;
  const c0 = noseFaceAt(nose, style, +cx.toFixed(3), +cy.toFixed(3), ntag);
  const centre = sane(c0) ? c0 : fallbackZ;
  const S: number[][] = [];
  for (let j = 0; j < NY; j++) {
    const raw: Array<number | null> = [];
    for (let i = 0; i < NX; i++) {
      const x = +(cx + x0 + ((x1 - x0) * i) / (NX - 1)).toFixed(3);
      const y = +(cy + y0 + ((y1 - y0) * j) / (NY - 1)).toFixed(3);
      const z = noseFaceAt(nose, style, x, y, ntag);
      raw.push(sane(z) ? z : null);
    }
    // A miss or a rejected sample — the corner of a wide mouth past a
    // rounded nose — takes the nearest good sample in its row, and the
    // part's centre if the whole row is bad.
    S.push(raw.map((z, i) => {
      if (z !== null) return z;
      for (let k = 1; k < NX; k++) {
        const a = raw[i - k], b = raw[i + k];
        if (a !== undefined && a !== null) return a;
        if (b !== undefined && b !== null) return b;
      }
      return centre;
    }));
  }
  const front = bb.max.z;
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const vx = pos.getX(k), vy = pos.getY(k);
    const u = Math.min(1, Math.max(0, x1 > x0 ? (vx - x0) / (x1 - x0) : 0.5)) * (NX - 1);
    const v = Math.min(1, Math.max(0, y1 > y0 ? (vy - y0) / (y1 - y0) : 0.5)) * (NY - 1);
    const i0 = Math.min(NX - 2, Math.floor(u)), j0 = Math.min(NY - 2, Math.floor(v));
    const fu = u - i0, fv = v - j0;
    const z =
      S[j0][i0] * (1 - fu) * (1 - fv) + S[j0][i0 + 1] * fu * (1 - fv) +
      S[j0 + 1][i0] * (1 - fu) * fv + S[j0 + 1][i0 + 1] * fu * fv;
    pos.setXYZ(k, vx + cx, vy + cy, pos.getZ(k) - front + z + proud);
  }
  pos.needsUpdate = true;
  // Normals kept as built: the shift is small and smooth, and recomputing
  // them would round off the hard edges that make a slat read as a slat.
  g.computeBoundingBox();
  g.computeBoundingSphere();
  onNoseCache.set(id, g);
  return g;
}
/** The flank at a point: how far out the skin is at this height and this
 *  distance along the car. Fired from the driver's side; the shell is
 *  symmetric, so one side answers for both. `tag` keeps the authored
 *  shell's answers apart from the extrude's in the cache. */
function flankXAt(geo: THREE.BufferGeometry, style: BodyStyle, y: number, z: number, tag = ""): number | null {
  return shellSurface(geo, `${style}${tag}:x${y}/${z}`, [6, y, z], [-1, 0, 0]);
}
/** A panel's upper surface at a point along the car, on the centreline.
 *  `tag` names which panel, so the roof and the body do not share a
 *  cache entry when they are asked about the same z. */
function deckY(geo: THREE.BufferGeometry, style: BodyStyle, z: number, tag = "body"): number | null {
  return shellSurface(geo, `${style}:${tag}:y${z}`, [0, 6, z], [0, -1, 0]);
}
/** The same, off the centreline: the skin above a point on the car.
 *  A cabin is asked about at the DRIVER's x, not at x=0, because the
 *  crown pulls a roof in toward its edges and the difference over half a
 *  seat's width is tens of millimetres — the whole of a head's
 *  clearance. */
function skinAt(
  geo: THREE.BufferGeometry,
  style: BodyStyle,
  x: number,
  z: number,
  tag: string
): number | null {
  return shellSurface(geo, `${style}:${tag}:y${x}/${z}`, [x, 6, z], [0, -1, 0]);
}

// Tinted glass, not a mirror. The intent here was always to silhouette
// the interior, but metalness 0.9 made the surface behave like polished
// chrome: a metal has no diffuse transmission, so the reflection won
// every pixel and the cabin was a black box with a driver invisible
// inside it. Glass is a dielectric — metalness near zero, a real index
// of refraction, and enough transparency to see a shape through.
const glassMat = new THREE.MeshPhysicalMaterial({ name: "glass",
  color: 0x121722,
  roughness: 0.05,
  metalness: 0.12,
  ior: 1.5,
  envMapIntensity: 1.35,
  transparent: true,
  opacity: 0.62,
});

/**
 * Window tint, as a material.
 *
 * Two things have to move together or it does not read as tint.
 *
 * OPACITY is what you cannot see through. Factory glass shows the
 * interior, the seats, the driver's shoulders; limo black shows a
 * shape. Raising opacity alone gets most of the way there.
 *
 * COLOUR is the half people forget. Real tint film is a neutral-to-warm
 * grey laid over glass that is already blue-green, and it kills the
 * blue: a heavily tinted window is not a darker version of a light one,
 * it is a different colour. Darkening the existing 0x121722 without
 * pulling the blue out gives you a car with navy windows, which is what
 * a cheap tint job actually looks like and not what anyone is buying.
 *
 * Reflectivity comes up a little too, because a tinted window shows you
 * the street instead of the cabin — that is most of why they look the
 * way they do from outside.
 */
function tintedGlass(tintPct: number, film: TintFilm | undefined): THREE.MeshPhysicalMaterial {
  // The arithmetic lives in src/game/tint.ts and this applies it. The
  // numbers used to be typed here — one charcoal, one reflectivity, one
  // roughness — which was fine while there was one film and no way to
  // check any of it without a renderer. There are three now, they are
  // sold at three prices, and a test has to be able to hold the shop to
  // what it is claiming about them.
  const look = glassLook(film, tintPct);
  const m = glassMat.clone();
  m.opacity = look.opacity;
  m.color = new THREE.Color(look.color);
  m.envMapIntensity = look.envMapIntensity;
  m.roughness = look.roughness;
  m.clearcoat = look.clearcoat;
  m.clearcoatRoughness = look.clearcoatRoughness;
  m.metalness = look.metalness;
  return m;
}

const seamMat = new THREE.MeshStandardMaterial({ name: "seam", color: 0x0a0b0d, roughness: 0.85 });
// Panel gaps read almost black and swallow light — that contrast against
// the lit chamfer beside them is what sells a shut line.
const gapMat = new THREE.MeshStandardMaterial({ name: "panel-gap", color: 0x050506, roughness: 1 });
const interiorMat = new THREE.MeshStandardMaterial({ name: "interior", color: 0x14161a, roughness: 0.95 });
const indicatorMat = new THREE.MeshStandardMaterial({ name: "indicator",
  color: 0xffa020,
  emissive: 0xff8c1a,
  emissiveIntensity: 0.8,
});
const reverseMat = new THREE.MeshStandardMaterial({ name: "reverse-lamp",
  color: 0xd8d8d8,
  emissive: 0xbbbbbb,
  emissiveIntensity: 0.3,
});
const caliperMat = new THREE.MeshStandardMaterial({ name: "caliper", color: 0xb01818, roughness: 0.5 });
const towHookMat = new THREE.MeshStandardMaterial({
  name: "tow-hook",
  color: 0xc42020,
  roughness: 0.45,
});
// Big-brake teal — the time-attack kit's signature peeking through bronze
const tealCaliperMat = new THREE.MeshStandardMaterial({ name: "caliper-race",
  color: 0x18b09a,
  roughness: 0.4,
  emissive: 0x073b33,
  emissiveIntensity: 0.3,
});
// Forged bronze, matte like a shot-peened TE37 — not jewellery gold
const bronzeRimMat = new THREE.MeshStandardMaterial({ name: "rim-bronze",
  color: 0x9c6b2f,
  roughness: 0.45,
  metalness: 0.85,
  envMapIntensity: 1.2,
});
/**
 * Satin black forged — the wheel a black car is delivered on.
 *
 * NOT 0x000000, for the reason the whole car is not: a wheel at true
 * black has no shading left to describe its spokes with, so it stops
 * being a wheel and becomes a dark disc in an arch. This is dark enough
 * to read as black against the tyre beside it and light enough that the
 * spoke faces still catch a street lamp, which is what tells you it is
 * turning. The metalness stays high — it is a machined face, not a
 * painted steelie — and the roughness sits between the bronze forge and
 * the polished silver: powder-coated, not lacquered.
 */
const blackRimMat = new THREE.MeshStandardMaterial({ name: "rim-black",
  color: 0x1a1a1e,
  roughness: 0.38,
  metalness: 0.9,
  envMapIntensity: 1.1,
});
/** The metal for a finish. A hubcap is not a rim and has none — see
 *  buildWheel, which reaches for the plastic instead. */
function rimMatFor(finish: WheelFinish): THREE.MeshStandardMaterial {
  return finish === "gold"
    ? getGoldRimMat()
    : finish === "bronze"
      ? bronzeRimMat
      : finish === "black"
        ? blackRimMat
        : rimMat;
}
// Dry carbon for the aero: near-black, a hint of weave sheen
/**
 * A thin strip of surface that FOLLOWS a surface.
 *
 * The first version of the carbon panels was a row of pitched boxes,
 * which is the trick the racing stripes use — and it does not survive
 * being made wide. A box can only take one angle over its whole length,
 * so on anything curved consecutive boxes meet at their corners and the
 * panel becomes a staircase; the pitch is clamped as well, so on a steep
 * run they stay flat and stand proud of the paint. At the stripe's 46 cm
 * that reads as a stripe. At a bonnet's 1.3 m it read as nine steps
 * hovering over the boot, which is what the first render showed.
 *
 * A ribbon has no such problem, because its VERTICES are on the surface:
 * it is sampled rather than approximated, so it lies flush by
 * construction however the panel underneath curves.
 *
 * UVs are in metres, so the weave comes out the same size on a hatch's
 * bonnet and a saloon's roof rather than being stretched to fit each.
 */
function surfaceRibbon(
  zRear: number,
  zFront: number,
  halfW: number,
  lift: number,
  topAt: (z: number) => number,
  steps = 24
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const span = zFront - zRear;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = zRear + span * t;
    const y = topAt(z) + lift;
    pos.push(-halfW, y, z, halfW, y, z);
    const v = t * Math.abs(span);
    uv.push(0, v, halfW * 2, v);
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A carbon twill, drawn rather than described.
 *
 * The kit pieces in this game have been "carbon" since the kit existed,
 * and what that meant was a flat dark grey box — which is what carbon
 * looks like when nobody drew the cloth. Real 2x2 twill is two families
 * of tows crossing at right angles, and the thing that makes it read as
 * carbon at a glance is not the colour: it is that the two families
 * catch the light at ninety degrees to each other, so half the weave is
 * bright while the other half is dark, and which half swaps as the car
 * turns.
 *
 * So the weave is a NORMAL map and not a colour map. A painted-on
 * checkerboard is flat under every light in the scene; a normal map
 * makes the tows shift as the sun crosses them, which is the whole
 * effect. The colour stays the near-black the resin actually is.
 *
 * Built once, lazily, and shared: it is the same cloth on every car, and
 * a 128px tile repeated is indistinguishable from a large one at any
 * distance this game ever draws a car from.
 */
let weaveTex: THREE.Texture | null = null;
function carbonWeave(): THREE.Texture | null {
  if (weaveTex) return weaveTex;
  if (typeof document === "undefined") return null; // no DOM: traffic on a server
  const N = 128;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  if (!g) return null;
  // Flat normal is (0.5, 0.5, 1) in RGB — no tilt anywhere — and the
  // tows are drawn as tilts away from it.
  g.fillStyle = "#8080ff";
  g.fillRect(0, 0, N, N);
  const TOW = N / 8; // eight tows across the tile, which is 2x2 twill
  for (let ty = 0; ty < 8; ty++) {
    for (let tx = 0; tx < 8; tx++) {
      // 2x2 twill: the float steps one tow along on each successive row,
      // which is what gives carbon its diagonal.
      const warpOnTop = ((tx + ty) & 3) < 2;
      const x = tx * TOW, y = ty * TOW;
      // A tow is a rounded ridge, so its normal sweeps from one edge to
      // the other across its width. Drawn as a gradient along whichever
      // axis the tow runs ACROSS.
      const grad = warpOnTop
        ? g.createLinearGradient(x, 0, x + TOW, 0)
        : g.createLinearGradient(0, y, 0, y + TOW);
      if (warpOnTop) {
        grad.addColorStop(0, "#3a3aff");   // tilted left
        grad.addColorStop(0.5, "#8080ff"); // crown, flat
        grad.addColorStop(1, "#c6c6ff");   // tilted right
      } else {
        grad.addColorStop(0, "#80c6ff");
        grad.addColorStop(0.5, "#8080ff");
        grad.addColorStop(1, "#803aff");
      }
      g.fillStyle = grad;
      g.fillRect(x, y, TOW, TOW);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  weaveTex = t;
  return t;
}

const carbonMat = new THREE.MeshStandardMaterial({ name: "carbon",
  color: 0x101215,
  roughness: 0.35,
  metalness: 0.55,
  envMapIntensity: 1.1,
});

/**
 * The bodywork version of the same cloth.
 *
 * Separate from carbonMat because a panel is not a wing: a bonnet is
 * lacquered over the weave and a diffuser usually is not, so this one
 * carries a clearcoat and reads wetter. The weave is attached here
 * rather than on carbonMat so that a car with no carbon package does not
 * pay for a texture upload it never shows.
 */
let carbonPanelMatCache: THREE.MeshStandardMaterial | null = null;
function carbonPanelMat(): THREE.MeshStandardMaterial {
  if (carbonPanelMatCache) return carbonPanelMatCache;
  const m = new THREE.MeshStandardMaterial({
    name: "carbon-panel",
    color: 0x0c0e11,
    roughness: 0.22,
    metalness: 0.45,
    envMapIntensity: 1.35,
  });
  const w = carbonWeave();
  if (w) {
    m.normalMap = w;
    // Shallow. A weave that stands proud enough to see from the pavement
    // is a weave nobody wove — the tows are half a millimetre.
    m.normalScale = new THREE.Vector2(0.55, 0.55);
  }
  carbonPanelMatCache = m;
  return m;
}

// Smoked lamp housing: the dark bezel the lenses live in. The contrast
// between this and the lit lens is what makes a lamp read as an assembly
// instead of a painted-on rectangle.
const housingMat = new THREE.MeshStandardMaterial({ name: "lamp-housing",
  color: 0x17090b,
  roughness: 0.25,
  metalness: 0.5,
  envMapIntensity: 1.2,
});
// Passive rear reflectors: catch light, never emit
const reflectorMat = new THREE.MeshStandardMaterial({ name: "reflector",
  color: 0x7a1016,
  roughness: 0.25,
  metalness: 0.3,
  emissive: 0x30060a,
  emissiveIntensity: 0.4,
});
const amberReflectorMat = new THREE.MeshStandardMaterial({ name: "reflector-amber",
  color: 0xa66414,
  roughness: 0.25,
  emissive: 0x5a3208,
  emissiveIntensity: 0.4,
});

/**
 * The lens. Deliberately calmer than it was.
 *
 * At 2.6 every headlamp on every car clipped to flat white and then
 * bloomed, so the shape of the lamp — which is most of what tells one
 * car's face from another's — was gone before it reached the screen.
 * The tail lamps were rebuilt as three-layer assemblies a while back and
 * carry their lens at 2.0 with a hotter core inside it; this brings the
 * heads to the same standard rather than leaving one end of every car
 * built to a different one.
 */
const headlightMat = new THREE.MeshStandardMaterial({ name: "headlamp-lens",
  color: 0xffffff,
  emissive: 0xfff6cf,
  emissiveIntensity: 1.7,
});
/** The projector inside the lens: small, hot, and the only part that is
 *  allowed to blow out. A lamp with a focal point reads as a lamp; a
 *  uniform slab reads as a strip of tape. */
const headCoreMat = new THREE.MeshStandardMaterial({ name: "headlamp-core",
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 4.2,
});
const grilleMat = new THREE.MeshStandardMaterial({ name: "grille", color: 0x0e0f12, roughness: 0.6 });
/**
 * The lip of paint between a tail lamp's housing and the rear corner,
 * in the car's own units. The same on every silhouette and on both
 * sides, which is what makes a lamp read as fitted into the panel
 * rather than stuck onto it — see the tail block in buildCar.
 */
const TAIL_PAD = 0.07;
/** The same lip, at the other end of the car. The front had none: every
 *  lamp sat at a hand-picked x whatever the nose was doing, and on the
 *  pony the result hung 162 mm outboard of the car's own flank. */
const HEAD_PAD = 0.055;

/**
 * THE FACE.
 *
 * Six of the nine silhouettes wore the SAME headlamp — a 540 x 155 mm
 * lens with its outer edge at 890 mm, on the saloon, the hatch, the
 * pickup, the SUV, the supercar and the GT-R alike. A 5.35 m half-tonne
 * truck and a 4.28 m hot hatch met the world with the same eyes. Only
 * the Z32's bar and the FD's pop-ups were ever drawn for their own car,
 * and both of those exist because their real machines are unmistakable
 * from the front and nothing else would have read as them.
 *
 * This file already says what the problem is, in the block that built
 * the lamps as three-layer assemblies: "no way to tell one car's face
 * from another's. Four silhouettes, four different slabs, all identical
 * once lit." The assemblies fixed the slab. They did not give anybody a
 * face.
 *
 * So: one package per silhouette, the way FACE_FALLBACK already gives
 * each one its own grille. The shapes are the ones the machines they
 * evoke actually wear — four round lamps on the pony car because that
 * is the pony-car face, a tall upright pair on the truck, a slim blade
 * on the mid-engined car, stacked lamps on the SUV.
 *
 * `w` and `h` are ONE lens. A quad states one of its four; a stack one
 * of its two. The outer edge is not here, because it is not a number
 * anybody should type: it comes off the shell at HEAD_PAD, the way the
 * tail lamps come off theirs.
 */
export type LampShape = "pod" | "quad" | "stack" | "slit" | "bar" | "popup";
export interface LampSpec {
  shape: LampShape;
  /** One lens, metres. */
  w: number;
  h: number;
  /** Inboard companions — the GT-R's projector eyes. */
  eyes?: boolean;
}
export const LAMPS_BY_STYLE: Record<BodyStyle, LampSpec> = {
  // A saloon's lamp is a wide, shallow rectangle and always has been.
  sedan: { shape: "pod", w: 0.5, h: 0.115 },
  // The Z32's full-width channel, six segments across the nose.
  zx: { shape: "bar", w: 0.222, h: 0.078 },
  // Pod plus the inner projector pair that makes an R34 an R34.
  gtr: { shape: "pod", w: 0.46, h: 0.125, eyes: true },
  // Pop-ups, up for the night run.
  rx7: { shape: "popup", w: 0.124, h: 0.124 },
  // A hot hatch's lamp is deeper than a saloon's and swept back into
  // the wing, so it reads tall rather than wide.
  hatch: { shape: "pod", w: 0.36, h: 0.155 },
  // FOUR ROUND LAMPS. The one face on this list that is not a
  // rectangle at all, and the reason a pony car is recognisable at
  // fifty metres in the dark.
  pony: { shape: "quad", w: 0.15, h: 0.15 },
  // A half-tonne truck's lamp is nearly square and stands upright,
  // because the panel it goes in is upright.
  pickup: { shape: "pod", w: 0.34, h: 0.22 },
  // A blade. A mid-engined car has no room for a lamp and says so.
  super: { shape: "slit", w: 0.42, h: 0.055 },
  // Stacked: a tall nose can carry two lamps where a saloon carries
  // one, and every SUV on this road does.
  suv: { shape: "stack", w: 0.34, h: 0.095 },
};
const chromeMat = new THREE.MeshStandardMaterial({ name: "chrome",
  color: 0xd8dde3,
  roughness: 0.12,
  metalness: 1,
  envMapIntensity: 1.6,
});


/*
 * METALLIC FLAKE AND ORANGE PEEL: TRIED, MEASURED, REMOVED.
 *
 * Both were built — a sparse platelet field for the flake, value noise
 * for the peel, each turned into a normal map by finite difference — and
 * both did precisely nothing, which took four measurements to establish
 * and is worth writing down so nobody builds them again.
 *
 * With the maps on and off, the mean luma gradient across the body
 * panels was 7.93 and 7.94. Forcing the normal scale from 0.28 to 4 —
 * fourteen times — moved it from 8.64 to 8.65. Coarsening the flake
 * repeat from 38 to 3, in case minification was averaging it away,
 * moved it to 8.59. And forcing the body colour to red moved it from
 * 8.63 to 5.37, which is how it is known that the override path worked
 * and the maps were the thing doing nothing.
 *
 * The reason is the same one that made the buildings blurry, seen from
 * the other side: a mirror can only show you detail that exists in what
 * it is reflecting. This car is lit almost entirely by an image-based
 * environment which is a smooth gradient dome plus eight small lamps.
 * Perturbing a surface normal by a fraction of a degree samples a
 * near-identical part of a near-uniform image, so nothing changes.
 * Flake sparkles in real life because the world is full of small hard
 * light sources; here there are eight, and they are 34 m away.
 *
 * No micro-surface trick can fix that — roughness variation integrates a
 * constant over a wider lobe and gets the same constant back. What would
 * fix it is a busier environment, which is a much larger change than a
 * texture, and not one to make by accident while adjusting paint.
 *
 * TRIED A SECOND TIME, ON THE CLEARCOAT NORMAL, AND IT IS WORSE THAN
 * NOTHING.
 *
 * The paragraph above was read as being about the BODY normal, and the
 * argument was that perturbing only the lacquer above the paint is a
 * different proposition: it leaves the basecoat flat and the colour
 * even, and moves nothing but the reflection. That reasoning is sound
 * and the result still does not care, because the objection was never
 * about which normal was bent — it is about there being nothing in the
 * environment for a bent normal to find.
 *
 * Measured through tools/shots/paint.mjs, on body pixels only, under the
 * lamps, on gloss #c1272d, sweeping the wavelength as well as the depth
 * in case the peel was simply too fine to resolve:
 *
 *   peel          body   spec   grain
 *   off           57.2   158.9  13.85
 *   11  (11 mm)   54.6   147.7  11.94
 *   6   (21 mm)   53.3   153.0  11.78
 *   3   (42 mm)   52.4   151.9  11.49
 *   1.5 (83 mm)   51.6   149.7  11.26
 *
 * Monotone, in the wrong direction, at every wavelength tried. The peel
 * does not fail to do anything — it darkens the bodywork and takes
 * texture OFF it, and coarsening it makes both worse rather than better.
 * A tilted clearcoat normal costs specular energy at that pixel and buys
 * back a sample of the same near-uniform dome, so the trade is a pure
 * loss. By 83 mm it is not orange peel any more anyway; that is
 * coachwork waviness, and it was only reached to prove the trend had no
 * turning point.
 *
 * The sub-pixel theory was the obvious defence of the idea and it is
 * dead: if minification were eating the effect, coarsening it would have
 * recovered the grain, and it does the opposite. Do not build this a
 * third time without first changing what the car is reflecting.
 */


/**
 * THE NUMBER PLATE, WHICH WAS ONE PLATE.
 *
 * Every car in this game wore "KWT 8198". The same registration on all
 * seventeen models, on all eight rivals, on the traffic — which is the
 * kind of thing nobody notices until two of them are stopped side by
 * side at a light, and then it is the only thing they notice.
 *
 * It was also a long way under this file's own sharpness rule. The plate
 * mesh is 0.52 m wide and the canvas was 128 px: 246 texels to the
 * metre, against the 900 that DECAL_TEXELS_PER_M sets three hundred
 * lines below and that every sticker on the car is held to. A plate is
 * the one decal a player gets close enough to read.
 *
 * 512 x 128 over 0.52 m is 985/m, just clear of the floor.
 */
const PLATE_W = 512;
const PLATE_H = 128;

/**
 * A registration for this car, derived rather than stored.
 *
 * CarColors has no id on it — it describes how a car LOOKS, and adding
 * an identity field would ripple through every caller including traffic,
 * which does not have one to give. So the plate comes out of the thing
 * the car already is: its body, its accent and its silhouette. Rivals
 * all carry distinct colour pairs — tests/crests.mjs asserts exactly
 * that, because their crests are painted from them — so no two rivals
 * can collide here without that test going red first.
 *
 * Deterministic, because a car whose plate changes when it is rebuilt is
 * worse than one that shares.
 */
function plateReg(colors: CarColors): string {
  let h = 2166136261 >>> 0;
  const feed = `${colors.body}|${colors.accent ?? 0}|${colors.style ?? "sedan"}`;
  for (let i = 0; i < feed.length; i++) {
    h ^= feed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Kuwaiti registrations run to six digits and are issued plain, with
  // no letter series — so this is a number, not a pattern invented to
  // look like one. 1 to 999999, never zero-padded, because a real plate
  // is not.
  return String((h % 999999) + 1);
}

const plateTexCache = new Map<string, THREE.CanvasTexture>();
function plateTexture(reg: string): THREE.CanvasTexture {
  const hit = plateTexCache.get(reg);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = PLATE_W;
  c.height = PLATE_H;
  const ctx = c.getContext("2d")!;
  // The field, and a plate is not paper white — it is a reflective sheet
  // that goes slightly warm-grey under sodium.
  ctx.fillStyle = "#eceee9";
  ctx.fillRect(0, 0, PLATE_W, PLATE_H);
  // Pressed edge: a dark rule with a lighter one inside it, which is the
  // shadow and the highlight of an embossed rim.
  ctx.strokeStyle = "rgba(26,28,32,0.85)";
  ctx.lineWidth = 5;
  ctx.strokeRect(2.5, 2.5, PLATE_W - 5, PLATE_H - 5);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(7, 7, PLATE_W - 14, PLATE_H - 14);

  // The country band on the left, which is what makes it read as a Gulf
  // plate at fifty metres rather than as a white rectangle. Arabic over
  // Latin, the order every sign in this country uses.
  const bandW = Math.round(PLATE_W * 0.24);
  ctx.fillStyle = "#123a6b";
  ctx.fillRect(9, 9, bandW, PLATE_H - 18);
  ctx.fillStyle = "#f4f6fa";
  ctx.textAlign = "center";
  ctx.font = `700 34px ${arabicUI()}`;
  ctx.fillText("الكويت", 9 + bandW / 2, 56);
  ctx.font = `700 20px ${latinDisplay()}`;
  ctx.fillText("KUWAIT", 9 + bandW / 2, 88);

  // The number. Black, heavy, and sized to the space that is left rather
  // than to a constant — a six-digit registration and a one-digit one
  // are both legal and they cannot be set at the same size.
  const room = PLATE_W - bandW - 40;
  ctx.fillStyle = "#15181d";
  let size = 82;
  do {
    ctx.font = `800 ${size}px ${latinDisplay()}`;
    if (ctx.measureText(reg).width <= room) break;
    size -= 3;
  } while (size > 30);
  ctx.textAlign = "right";
  ctx.fillText(reg, PLATE_W - 20, PLATE_H / 2 + 28);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  plateTexCache.set(reg, tex);
  return tex;
}
// ------------------------------------------------------------- stickers
/**
 * How far under the crease the flank wordmark hangs, and how tall it is.
 *
 * Named because two things need them: the wordmark itself, and the
 * full-length graphic that has to stay clear of it. Measured on the
 * fleet, the wordmark's bottom edge IS the floor of the rally pack —
 * 0.222 m on the rx7 up to 0.432 on the gtr — so a second copy of these
 * numbers somewhere else would be a clearance rule that silently stops
 * being true the first time the wordmark moves.
 */
const WORDMARK_DROP = 0.22;
const WORDMARK_H = 0.215;
/** The beltline stripe's lane: how far under the beltline it sits, and
 *  how deep it is. The full-length graphic uses the same lane, because a
 *  side graphic belongs where the eye is — see the note at its
 *  placement. */
const BELT_STRIPE_DROP = 0.16;
const BELT_STRIPE_H = 0.14;

// The rally pack. Canvas-drawn, cached, and deliberately brand-free —
// a roundel, a beltline stripe, an abstract falcon swoosh and the flag.

/**
 * HOW SHARP A STICKER HAS TO BE
 *
 * Texels per metre of car, and it is a rule rather than a number typed
 * into each texture because it was a number typed into each texture:
 * the roundel got 512 px on 340 mm (1500/m), the hood swoosh got 256 on
 * 850 (301/m) and the flag got 96 on 240 (400/m). The flag at 400 read
 * as three stripes with a blob on the end, and it took a render and a
 * measurement to find out — the hood decal was worse and nobody had
 * looked, because nothing in this file said what sharp meant.
 *
 * 900 is the floor at which a hard edge survives the mipmap at the
 * distance one car sees another. Anything carrying TYPE wants more, and
 * asks for it by passing a multiplier.
 */
const DECAL_TEXELS_PER_M = 900;

/**
 * The longest flank a decal has to run down, in metres.
 *
 * The two full-length graphics are built as ONE module-level texture
 * shared by every car, so they have to be sized for the longest shell in
 * the fleet rather than for an average. flankRibbon runs them from
 * `d.tail - 0.25` to `d.nose + 0.25`, and the longest car is 5.16 m, so
 * the run is 5.66 m. Rounded up.
 */
const FLANK_RUN_M = 5.7;

/**
 * The hard ceiling on a decal's long axis.
 *
 * A `let` rather than a constant because it is a property of the GPU,
 * not of the artwork: WebGL2 only GUARANTEES 2048, and a device that
 * stops there cannot upload a 4096-wide texture at all. setMaxDecalPx
 * lowers this from the renderer's own capabilities before any car is
 * built, so a phone that cannot take 4096 gets the old size instead of a
 * failed upload.
 */
let maxDecalPx = 4096;

/** Called once, from the engine, with renderer.capabilities.maxTextureSize. */
export function setMaxDecalPx(limit: number): void {
  if (Number.isFinite(limit) && limit >= 512) maxDecalPx = Math.min(4096, limit);
}

/**
 * The canvas size for a decal worn at `metres`, rounded up to a power of
 * two and capped.
 *
 * Powers of two because a non-power-of-two canvas silently loses its
 * mipmaps in WebGL, and a decal without mipmaps is the same aliasing
 * this rule exists to avoid, arriving by a different road.
 *
 * THE CAP WAS MEASURING THE WRONG THING.
 *
 * It was a flat 2048 on the strength of "a sticker is not a wall", which
 * is right about stickers and wrong about the two graphics that run the
 * whole length of the car. The effect was that the rule above could not
 * be satisfied by ANY decal longer than 2048/900 = 2.27 m — and the
 * beltline stripe asks for decalPx(4), wants 3600 px, and was silently
 * handed 2048. A rule that reports compliance while being overruled by
 * its own cap is worse than no rule, because the call site looks right.
 *
 * Measured over the real flank run, both full-length graphics were
 * landing at 362 to 460 texels per metre against a floor of 900 — and
 * that floor is not a preference, it is documented above as "the
 * distance one car sees another", which is the view this game is played
 * in.
 *
 * The cap is also on the wrong AXIS. What a texture costs is area, and a
 * long thin ribbon is cheap: 4096x96 is 393,216 texels, which is less
 * than the flag decal already spends at 1024x512 (524,288). The old cap
 * forbade a texture cheaper than one it allowed. So the long axis may go
 * to 4096 when the caller says the decal really is that long, and the
 * default stays 2048 for everything that is honestly a sticker.
 */
function decalPx(metres: number, sharpness = 1, cap = 2048): number {
  const want = metres * DECAL_TEXELS_PER_M * sharpness;
  return Math.min(
    Math.min(cap, maxDecalPx),
    Math.max(128, 2 ** Math.ceil(Math.log2(want)))
  );
}

const roundelCache = new Map<number, THREE.CanvasTexture>();
function roundelTexture(num: number): THREE.CanvasTexture {
  const hit = roundelCache.get(num);
  if (hit) return hit;
  // 512, not 256. This decal is 440 mm across on a car the player spends
  // the whole game two metres behind, and at 256 the number's edges were
  // the softest thing on the machine — every panel gap around it was
  // sharper than the digit it framed.
  const S = 512;
  // textTexture, not a bare canvas: the Arabic-Indic twin under the
  // number is drawn with the Arabic face, and a texture rasterised
  // before that font arrives bakes the fallback in permanently. Every
  // decal in this pack had that bug; the flags module was built to avoid
  // it and the stickers never got the same treatment.
  const tex = textTexture(S, S, (ctx) => {
    ctx.clearRect(0, 0, S, S);
    const c2 = S / 2;
    // A rally roundel has to read against ANY paint. White on a white
    // car and black on a black one both vanish, so the disc gets a dark
    // ring AND a light keyline outside it: whichever way the paint goes,
    // one of the two edges separates.
    ctx.beginPath();
    ctx.arc(c2, c2, S * 0.474, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = S * 0.028;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c2, c2, S * 0.452, 0, Math.PI * 2);
    ctx.fillStyle = "#f6f6f2";
    ctx.fill();
    ctx.lineWidth = S * 0.042;
    ctx.strokeStyle = "#15161a";
    ctx.stroke();
    ctx.fillStyle = "#15161a";
    ctx.textAlign = "center";
    // Heavier and larger than it was: 800 weight at 0.5 of the disc
    // rather than 700 at 0.46. A door number is the one piece of type on
    // a car that is meant to be read from another car.
    ctx.font = `800 ${Math.round(S * 0.5)}px ${latinDisplay()}`;
    ctx.fillText(String(num), c2, S * 0.615);
    const arDigits = "٠١٢٣٤٥٦٧٨٩";
    const ar = String(num).split("").map((d) => arDigits[+d]).join("");
    ctx.font = `700 ${Math.round(S * 0.17)}px ${arabicUI()}`;
    ctx.fillText(ar, c2, S * 0.82);
  });
  tex.anisotropy = 16;
  roundelCache.set(num, tex);
  return tex;
}

let beltStripeTex: THREE.CanvasTexture | null = null;
/**
 * The beltline stripe.
 *
 * It was 512 by 64 for a graphic that runs most of the length of a car —
 * 128 texels to the metre, the lowest density of anything in the pack —
 * and it got away with it because it is two flat bands. What it did not
 * get away with was its ENDS: the swept tail is the only diagonal in it,
 * and a diagonal at 128/m is a staircase the mipmap turns to mush, so
 * the stripe faded out rather than tapering.
 *
 * Now sized by the rule, and given the keyline every real one has —
 * without it a white band on a white car is a band nobody can see,
 * which is the argument the roundel already makes about its two edges.
 */
function beltStripeTexture(): THREE.CanvasTexture {
  if (beltStripeTex) return beltStripeTex;
  // Sized for the longest flank in the fleet.
  // The real run, not 4. That 4 predates the fleet having real lengths in
  // metres — the shells are 3.95 m to 5.16 m now, and the ribbon is half
  // a metre longer than the shell at both ends together.
  const W = decalPx(FLANK_RUN_M, 1, 4096);
  const H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  const kx = W / 512, ky = H / 64;
  const band = (y: number, h: number, col: string, grow = 0) => {
    const yy = (y - grow) * ky;
    const hh = (h + grow * 2) * ky;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(26 * kx, yy);
    ctx.lineTo(486 * kx, yy);
    ctx.lineTo(506 * kx, yy + hh / 2);
    ctx.lineTo(486 * kx, yy + hh);
    ctx.lineTo(26 * kx, yy + hh);
    ctx.lineTo(6 * kx, yy + hh / 2);
    ctx.closePath();
    ctx.fill();
  };
  // Keyline first, bands over it, so the outline is a border rather
  // than a third stripe.
  band(10, 20, "rgba(12,13,16,0.75)", 2.5);
  band(38, 14, "rgba(12,13,16,0.75)", 2.5);
  band(10, 20, "#f2f4f7");
  band(38, 14, "#c1121f");
  beltStripeTex = new THREE.CanvasTexture(c);
  beltStripeTex.colorSpace = THREE.SRGBColorSpace;
  beltStripeTex.anisotropy = 16;
  return beltStripeTex;
}

/**
 * A decal strip that FOLLOWS the body instead of floating in front of it.
 *
 * Every other sticker in this pack is a flat PlaneGeometry hung a
 * centimetre off the flank, which is fine for something the size of a
 * door roundel: over 340 mm the body is near enough flat. A full-length
 * graphic is not. It runs the whole car, and a car is widest at the
 * doors and tapers into the nose and the tail — hold a plane at the
 * widest half-width and its ends hang in mid air outside the bodywork;
 * push it in far enough to stay buried at the ends and it disappears
 * inside the doors.
 *
 * So the shell is asked where its surface actually is. Two rays per
 * sample column, at the top and bottom edge of the strip, fired inward
 * from well outside the car; the ribbon is built through the hits with a
 * small standoff. Columns where the ray finds nothing are dropped, which
 * is what makes the run self-limiting: the graphic reaches exactly as far
 * as there is body to carry it, on whichever silhouette it is put on,
 * without a table of per-body lengths to keep in step.
 *
 * Returns null if the band is off the body entirely — the caller is
 * expected to check rather than add an empty mesh.
 */
function flankRibbon(
  shell: THREE.Mesh,
  side: 1 | -1,
  zA: number,
  zB: number,
  yMid: number,
  height: number,
  standoff: number,
  samples = 96,
  /**
   * Run u the other way.
   *
   * u is nose-consistent by default — 0 at the tail, 1 at the nose on
   * BOTH flanks — which is right for a wedge or a mark, whose point
   * should land on the front wing whichever side it is on. It is wrong
   * for TYPE: the same texture on the two flanks comes out reading
   * front-to-back on one and back-to-front on the other, and the patrol
   * car's near side came out of the render with POLICE spelled
   * backwards. The sticker pack's own sheet states the rule this
   * restores — the far side is the same artwork mirrored, so a wordmark
   * reads front-to-back on both flanks.
   */
  mirrorU = false
): THREE.BufferGeometry | null {
  const ray = new THREE.Raycaster();
  ray.far = 60;
  const dir = new THREE.Vector3(-side, 0, 0);
  const org = new THREE.Vector3();
  const yTop = yMid + height / 2;
  const yBot = yMid - height / 2;
  const surfaceX = (y: number, z: number): number | null => {
    org.set(side * 30, y, z);
    ray.set(org, dir);
    const hits = ray.intersectObject(shell, false);
    return hits.length ? hits[0].point.x : null;
  };
  const cols: { z: number; xt: number; xb: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const z = zA + ((zB - zA) * i) / samples;
    const xt = surfaceX(yTop, z);
    const xb = surfaceX(yBot, z);
    if (xt === null || xb === null) continue;
    cols.push({ z, xt, xb });
  }
  if (cols.length < 2) return null;

  const n = cols.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const zFirst = cols[0].z, zLast = cols[n - 1].z;
  const span = zLast - zFirst || 1;
  for (let i = 0; i < n; i++) {
    const c = cols[i];
    const off = side * standoff;
    pos[i * 6 + 0] = c.xt + off; pos[i * 6 + 1] = yTop; pos[i * 6 + 2] = c.z;
    pos[i * 6 + 3] = c.xb + off; pos[i * 6 + 4] = yBot; pos[i * 6 + 5] = c.z;
    // u runs 0 at the tail to 1 at the nose so the artwork's point lands
    // on the front wing whichever way the samples were walked.
    const raw = (c.z - zFirst) / span;
    const u = mirrorU ? 1 - raw : raw;
    uv[i * 4 + 0] = u; uv[i * 4 + 1] = 1;
    uv[i * 4 + 2] = u; uv[i * 4 + 3] = 0;
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, dd = (i + 1) * 2 + 1;
    // Wound so the face looks OUTWARD on the side it is on: a decal
    // showing its back is invisible under a FrontSide material, and the
    // two flanks mirror, so the order has to flip with them.
    //
    // These two were the wrong way round and the render is what caught
    // it. With (a, b, c) on the right-hand side the cross product of
    // (b - a) and (c - a) is (-h*dz, 0, h*dx) — pointing INTO the car —
    // so the whole graphic faced inwards and all but vanished while
    // every number the geometry test printed stayed green. Position was
    // right; facing is not a position.
    if (side > 0) { idx.push(a, c, b, b, c, dd); }
    else { idx.push(a, b, c, b, dd, c); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

let fullStripeTex: THREE.CanvasTexture | null = null;
/**
 * The full-length side graphic: one sticker from the nose to the tail.
 *
 * Long and thin, so the canvas is too — 2048 by 96. This decal covers
 * about 4.6 metres of bodywork, and the beltline stripe's 512 would put
 * 111 texels on a metre of it, a quarter of what the door roundel gets.
 * At 2048 it is 445 to the metre and the diagonal cuts stay cuts instead
 * of turning into staircases.
 *
 * u=0 is the tail and u=1 the nose, so the wedge is deepest at the left
 * of the canvas and comes to its point at the right. The taper is not
 * linear: it holds full depth across the rear quarter and the door, then
 * falls away over the front wing, which is the difference between a
 * racing graphic and a triangle. Two colours and a hairline, no type —
 * this runs over five silhouettes and any wordmark would be legible on
 * one of them and squashed on the rest.
 */
function fullStripeTexture(): THREE.CanvasTexture {
  if (fullStripeTex) return fullStripeTex;
  // On the rule rather than typed. This one never asked decalPx anything
  // — it hard-coded the same 2048 the cap was handing its sibling, which
  // is why the two looked consistent and were both wrong.
  const W = decalPx(FLANK_RUN_M, 1, 4096);
  const H = 96;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  // Holds full depth further forward than it first did, and tapers to a
  // sliver rather than to nothing. At hold 0.42 falling to zero, the
  // front half of the car was carried by the hairline alone, so on a
  // navy car the graphic read as a stripe over the rear quarter and the
  // "full length" of it was invisible. It ends at 0.14 of its depth: a
  // point that reaches the headlight, which is what a side graphic does.
  const depth = (u: number): number => {
    const t = Math.max(0, Math.min(1, u));
    const hold = 0.5;
    if (t <= hold) return 1;
    const k = (t - hold) / (1 - hold);
    return 0.14 + 0.86 * Math.max(0, 1 - k * k * (3 - 2 * k));
  };
  const wedge = (top: number, bot: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, top);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, bot - (bot - top) * depth(x / W));
    ctx.lineTo(W, bot);
    ctx.lineTo(0, bot);
    ctx.closePath();
    ctx.fill();
  };
  // The body of the graphic, a narrower accent inside it, then a hairline
  // along the bottom that carries the whole length even where the wedge
  // above it has run out — without it the front half of the car reads as
  // having no sticker at all.
  wedge(14, 74, "#f2f4f7");
  wedge(34, 74, "#c1121f");
  // The bottom edge has to read against ANY paint, the same problem the
  // door roundel solves with a dark ring inside a light keyline: a dark
  // hairline vanishes on a black car and a light one vanishes on a white
  // one. Both, stacked, so whichever way the paint goes one of the two
  // separates.
  ctx.fillStyle = "#f2f4f7";
  ctx.fillRect(0, 74, W, 4);
  ctx.fillStyle = "rgba(20,21,26,0.92)";
  ctx.fillRect(0, 78, W, 4);
  fullStripeTex = new THREE.CanvasTexture(c);
  fullStripeTex.colorSpace = THREE.SRGBColorSpace;
  fullStripeTex.anisotropy = 16;
  return fullStripeTex;
}

let hoodDecalTex: THREE.CanvasTexture | null = null;
/**
 * The falcon on the bonnet.
 *
 * Two things were wrong with it and both were invisible from the code.
 *
 * It was 256 px on an 850 mm panel — 301 texels to the metre, against
 * the 400 that made the Kuwait flag read as a smear and the 1500 the
 * door roundel gets. It carried two lines of TYPE at that density,
 * which is the least forgiving thing you can put on a sticker.
 *
 * And it was rasterised onto a bare canvas rather than through
 * textTexture, so the Arabic line was drawn with whatever face the
 * browser had at that instant and baked in. The roundel's comment says
 * "every decal in this pack had that bug"; this is the one that still
 * did.
 *
 * The bird is drawn as a bird now — swept wings with a leading edge and
 * a trailing edge, a body, a head and a tail — rather than as two
 * quadratics meeting at a point, which at any size above a thumbnail
 * read as a moustache.
 */
function hoodDecalTexture(): THREE.CanvasTexture {
  if (hoodDecalTex) return hoodDecalTex;
  // 1.2x the floor because it carries type. Not more: at 1.6 the rule
  // rounds up to a 2048 square, which is 16 MB of canvas for a sticker
  // the size of a dinner plate, and 2410 texels to the metre against
  // the 1506 the door roundel is sharp at. 1024 gives 1205, which is
  // the same order as the roundel and a quarter of the memory.
  const S = decalPx(0.85, 1.2);
  hoodDecalTex = textTexture(S, S, (ctx) => {
    ctx.clearRect(0, 0, S, S);
    const k = S / 256; // the art below is drawn in 256-space
    ctx.scale(k, k);
    const INK = "#f2f4f7";
    const RED = "#c1121f";

    // The falcon, wings back, seen from above — which is the view a
    // bonnet decal is actually looked at from.
    ctx.fillStyle = INK;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(128, 74);
      // leading edge, swept out and back
      ctx.bezierCurveTo(128 + dir * 46, 66, 128 + dir * 96, 82, 128 + dir * 122, 126);
      // wingtip, squared off the way a primary feather is
      ctx.lineTo(128 + dir * 112, 138);
      // trailing edge, notched back toward the body
      ctx.bezierCurveTo(128 + dir * 84, 116, 128 + dir * 52, 108, 128 + dir * 26, 116);
      ctx.lineTo(128 + dir * 18, 96);
      ctx.closePath();
      ctx.fill();
    }
    // Body and tail: one tapering shape from the shoulders to a fanned end.
    ctx.beginPath();
    ctx.moveTo(118, 78);
    ctx.lineTo(138, 78);
    ctx.lineTo(146, 140);
    ctx.lineTo(128, 168);
    ctx.lineTo(110, 140);
    ctx.closePath();
    ctx.fill();
    // Head and hooked beak, which is the whole reason it reads as a
    // falcon rather than as an aeroplane.
    ctx.beginPath();
    ctx.arc(128, 66, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(128, 54);
    ctx.lineTo(142, 60);
    ctx.lineTo(132, 72);
    ctx.closePath();
    ctx.fill();
    // The eye, in the one colour on the car that is not the paint.
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(133, 63, 4.2, 0, Math.PI * 2);
    ctx.fill();

    // The wordmark, under the bird and clear of its tail.
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    ctx.font = `700 32px ${arabicUI()}`;
    ctx.fillText("ليالي الخليج", 128, 206);
    ctx.direction = "ltr";
    ctx.font = `600 17px ${latinDisplay()}`;
    ctx.fillText("GULF ROAD NIGHTS", 128, 230);
  });
  hoodDecalTex.anisotropy = 16;
  return hoodDecalTex;
}

let flagDecalTex: THREE.CanvasTexture | null = null;
/**
 * The flag of Kuwait, drawn to its own construction.
 *
 * It was 96 by 48 — four `fillRect`s and a quadrilateral — on a plane
 * 240 mm long. That is 400 texels to the metre, and the one edge in the
 * flag that is not horizontal is the hoist trapezoid's, which at that
 * size is a nine-pixel staircase softened into a smear by the mipmap
 * before it ever reaches the screen. It read as three coloured stripes
 * with a dark blob at one end.
 *
 * This is the 1961 construction: two by one, three equal horizontal
 * bands of green, white and red, and a black trapezoid at the hoist
 * whose base is a QUARTER of the length — the old one used 29%, which is
 * close enough to look right and wrong enough to be wrong — with its
 * slanted edges meeting the band boundaries at a third and two thirds of
 * the height.
 */
function flagDecalTexture(): THREE.CanvasTexture {
  if (flagDecalTex) return flagDecalTex;
  const W = 1024;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const third = H / 3;
  ctx.fillStyle = "#007a3d";
  ctx.fillRect(0, 0, W, third);
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, third, W, third);
  ctx.fillStyle = "#ce1126";
  ctx.fillRect(0, third * 2, W, H - third * 2);
  ctx.fillStyle = "#0a0a0a";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W / 4, third);
  ctx.lineTo(W / 4, third * 2);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  // A printed decal has an edge. Without one the white band runs
  // straight into white paint and the flag loses its top and bottom on
  // exactly the cars the sticker pack is most often bought for.
  ctx.strokeStyle = "#15161a";
  ctx.lineWidth = W * 0.008;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);
  flagDecalTex = new THREE.CanvasTexture(c);
  flagDecalTex.colorSpace = THREE.SRGBColorSpace;
  // Anisotropy is what keeps the hoist edge from smearing when the flank
  // is seen at a glancing angle, which on a car's side is nearly always.
  flagDecalTex.anisotropy = 16;
  return flagDecalTex;
}

/**
 * THE FACE
 *
 * What a car looks like from in front, which is the only view a rival
 * gets of you all night and the one the shop card leads with.
 *
 * Until now every car in this game had the same one: a 1050 x 170 dark
 * rounded box sunk into the nose, with a chrome strip over it. Seventeen
 * machines, six silhouettes, and one face — so a Deera Sedan and a Storm
 * S8 were the same rectangle at different heights, and the only thing
 * telling them apart at a hundred metres was the paint.
 *
 * A grille is also not a dark rectangle. It is an APERTURE with
 * something behind it, and the something is what makes it read as a way
 * into the engine rather than as a sticker: slats you can count, a mesh
 * that catches a headlamp, a honeycomb that goes flat black at an angle.
 * That is the part that was missing, and it is why the old nose looked
 * closed even on the cars that are mostly radiator.
 *
 * So: an aperture per car, a pattern behind it, a surround around it,
 * and optionally the two things that separate a fast face from a slow
 * one — brake ducts either side and a mouth under the splitter.
 */
export type GrillePattern = "slat" | "mesh" | "honeycomb" | "bar" | "open";

export interface FaceSpec {
  /** Aperture width and height, metres, and its centre above the road.
   *  Absent height/y take the silhouette's own grille line. */
  w: number;
  h: number;
  /** Offset from the style's grilleY, so a car can sit its mouth high or
   *  low on the nose it shares with another. */
  dy?: number;
  pattern: GrillePattern;
  /** Pitch of the slats or the mesh, metres. Smaller is finer, and fine
   *  is expensive: this is bar count, and bar count is draw distance. */
  pitch: number;
  surround: "chrome" | "carbon" | "body" | "none";
  /** Brake ducts either side of the mouth. */
  ducts?: boolean;
  /** A second mouth under the bumper, splitter height. */
  lower?: boolean;
  /** A badge in the middle of the aperture. */
  badge?: boolean;
}

/** Dark anodised metal behind the aperture — the thing the mesh is made
 *  of, distinct from the black hole the aperture used to be. */
const meshMat = new THREE.MeshStandardMaterial({
  name: "grille-mesh",
  color: 0x2a2d33,
  roughness: 0.42,
  metalness: 0.85,
  envMapIntensity: 0.9,
});
/** The shadow behind the mesh. Not pure black: an aperture with nothing
 *  in it reads as a hole cut in the car, and a radiator is a surface. */
const apertureMat = new THREE.MeshStandardMaterial({
  name: "grille-void",
  color: 0x0a0b0d,
  roughness: 0.95,
  metalness: 0.1,
});

/**
 * The face a body wears when nobody has said otherwise.
 *
 * Traffic, the intro loop's filler cars and every caller written before
 * a car could state its own face all arrive here. It is per SILHOUETTE
 * rather than one shared spec because the six bodies have their noses
 * in different places and at different widths — a saloon's mouth on an
 * FD's nose is 200 mm wider than the nose.
 */
export const FACE_FALLBACK: Record<BodyStyle, FaceSpec> = {
  sedan: { w: 1.12, h: 0.19, pattern: "slat", pitch: 0.045, surround: "chrome", badge: true },
  gtr: { w: 1.2, h: 0.22, pattern: "mesh", pitch: 0.04, surround: "body", ducts: true, lower: true },
  // The Z32 nose is famously grille-less: a slot under the bumper and
  // nothing above it. Kept as the fallback for that body because it is
  // the shape's whole signature, not an omission.
  zx: { w: 1.26, h: 0.075, dy: -0.02, pattern: "slat", pitch: 0.03, surround: "none", lower: true },
  rx7: { w: 1.0, h: 0.11, pattern: "mesh", pitch: 0.03, surround: "none", ducts: true, lower: true },
  hatch: { w: 0.96, h: 0.14, pattern: "honeycomb", pitch: 0.04, surround: "body", badge: true },
  pony: { w: 1.3, h: 0.24, pattern: "bar", pitch: 0.1, surround: "chrome", badge: true },
  pickup: { w: 1.4, h: 0.3, pattern: "bar", pitch: 0.13, surround: "chrome", badge: true },
  super: { w: 0.86, h: 0.1, dy: -0.02, pattern: "mesh", pitch: 0.026, surround: "carbon", ducts: true, lower: true },
  // A tall chrome-framed mesh: the family SUV's face, and the widest
  // aperture here after the truck's.
  suv: { w: 1.34, h: 0.26, pattern: "mesh", pitch: 0.05, surround: "chrome", badge: true },
};

/** The front splitter every detailed car wears: a 50 mm lip centred
 *  200 mm up, standing well clear of the nose. The face keeps its lower
 *  mouth above it. */
const SPLITTER_Y = 0.2;
const SPLITTER_H = 0.05;
const SPLITTER_R = 0.016;
/** Where the splitter actually ends. roundedBox grows a box by its corner
 *  radius on every side (the bevel extends OUT from the outline), so the
 *  50 mm lip stands 82 mm tall; measured, its top is at 241 mm, not 225. */
const SPLITTER_TOP = SPLITTER_Y + SPLITTER_H / 2 + SPLITTER_R;
/** How far a face's outermost part reaches past its aperture's nominal
 *  top or bottom edge: the frame (26 mm bars, grown 8 mm by their own
 *  rounding) when there is one, else the aperture's own rounding. */
function faceReach(h: number, surround: FaceSpec["surround"]): number {
  return surround !== "none" ? 0.026 + 0.008 : Math.min(0.018, h / 2 - 1e-3);
}

/** The number plates: 520 x 130 mm, centred 380 mm up, front and rear. */
const PLATE_Y = 0.38;
const PLATE_W_M = 0.52;
const PLATE_H_M = 0.13;

const faceCache = new Map<string, THREE.BufferGeometry>();

/**
 * The bars behind an aperture, as ONE geometry.
 *
 * Merged rather than added one mesh per bar, because a fine mesh is
 * forty bars each way and eighty draw calls on the front of a car is
 * eighty draw calls on the front of every car on the road. Cached by
 * shape, so the sixteen cars sharing a pattern share the buffer.
 */
function grillePattern(
  pattern: GrillePattern,
  w: number,
  h: number,
  pitch: number
): THREE.BufferGeometry | null {
  if (pattern === "open") return null;
  const key = `${pattern}|${w.toFixed(3)}|${h.toFixed(3)}|${pitch.toFixed(3)}`;
  const hit = faceCache.get(key);
  if (hit) return hit;

  const parts: THREE.BufferGeometry[] = [];
  const T = Math.min(0.012, pitch * 0.34); // bar thickness
  const D = 0.022; // how deep the bars stand in the aperture
  const at = (g: THREE.BufferGeometry, x: number, y: number, z = 0) => {
    g.translate(x, y, z);
    parts.push(g);
  };
  if (pattern === "bar") {
    // Two or three heavy horizontal blades. The face of a big saloon.
    const n = Math.max(2, Math.round(h / pitch));
    for (let i = 0; i < n; i++) {
      const y = -h / 2 + (h * (i + 0.5)) / n;
      at(new THREE.BoxGeometry(w, Math.min(0.05, (h / n) * 0.5), D), 0, y);
    }
  } else if (pattern === "slat") {
    // Horizontal slats, close together. The classic radiator.
    const n = Math.max(2, Math.floor(h / pitch));
    for (let i = 0; i < n; i++) {
      const y = -h / 2 + (h * (i + 0.5)) / n;
      at(new THREE.BoxGeometry(w, T, D), 0, y);
    }
  } else if (pattern === "mesh") {
    // A woven grid: bars both ways, the fronts of the vertical set a
    // little proud so the weave reads as depth rather than as a crossed
    // line drawing.
    const rows = Math.max(2, Math.floor(h / pitch));
    const cols = Math.max(2, Math.floor(w / pitch));
    for (let i = 0; i < rows; i++) {
      at(new THREE.BoxGeometry(w, T, D * 0.7), 0, -h / 2 + (h * (i + 0.5)) / rows, -D * 0.15);
    }
    for (let i = 0; i < cols; i++) {
      at(new THREE.BoxGeometry(T, h, D * 0.7), -w / 2 + (w * (i + 0.5)) / cols, 0, D * 0.15);
    }
  } else {
    // Honeycomb, drawn as offset rows of short bars: real hexagons at
    // this size are geometry nobody can resolve, and the thing the eye
    // actually reads at a car's length is the STAGGER.
    const rows = Math.max(2, Math.floor(h / pitch));
    const cols = Math.max(2, Math.floor(w / pitch));
    for (let r = 0; r < rows; r++) {
      const y = -h / 2 + (h * (r + 0.5)) / rows;
      at(new THREE.BoxGeometry(w, T, D * 0.6), 0, y, -D * 0.15);
      const off = r % 2 ? (w / cols) * 0.5 : 0;
      for (let c = 0; c < cols; c++) {
        const x = -w / 2 + (w * (c + 0.5)) / cols + off;
        if (Math.abs(x) > w / 2) continue;
        at(new THREE.BoxGeometry(T, h / rows, D * 0.6), x, y, D * 0.15);
      }
    }
  }
  const merged = parts.length ? mergeGeometries(parts, false) : null;
  if (merged) faceCache.set(key, merged);
  return merged;
}

/** Sticker plane: lit like paint, slightly emissive so it reads at night,
 *  polygon-offset so it never z-fights the panel it sits on. */
const demonMarkTex = new Map<number, THREE.CanvasTexture>();
/**
 * The crew mark: a horned skull, drawn here rather than borrowed.
 *
 * The fleet is already full of jinn — an Efreet, a Kaiju, a rival called
 * Bu Torab running with the Dust Devils — so the sticker pack gets a
 * devil's head to match. Every line of it is a path in this function;
 * there is no real emblem behind it.
 *
 * Drawn at a size the caller asks for, because the same mark is worn at
 * two very different ones. At 256 px it is the 320 mm crew badge on a
 * rear quarter — 800 texels to the metre. The Black Demon wears it at
 * more than half a metre on four panels, and 256 px across that is 460
 * texels to the metre, which is the density the Kuwait flag was at when
 * it read as a smear with a blob on one end. One drawing, two sizes:
 * the alternative is a second copy of the artwork that drifts from this
 * one the first time a horn changes.
 */
function demonMarkTexture(px = 256, bold = false): THREE.CanvasTexture {
  const key = bold ? -px : px;
  const hit = demonMarkTex.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, px, px);
  // Every path below is written in the 256-space it was drawn in, and
  // the canvas is scaled to whatever was asked for. Line widths scale
  // with it, which is the point — a 9 px stroke at 512 would be half
  // the mark it is at 256.
  ctx.scale(px / 256, px / 256);
  // The badge is drawn to sit on a car of any colour: near-black ink
  // with an ember keyline, so it is a solid shape on pale paint and an
  // outline on dark paint. The Black Demon is the case that breaks it.
  // Ink at #14121a on paint at #0b0a0d is the same colour twice, and
  // the keyline that carries the mark at 320 mm on a red car is a
  // hairline at half a metre on a black one. Rendered and looked at,
  // the first cut of this livery was a black car with four faint orange
  // scratches on it — a livery in the record and nowhere else.
  //
  // So the bold cut inverts the mark instead of thickening it. Bone
  // where the badge is ink, and the ember keeps the keyline, the eyes
  // and the teeth: a skull rather than a silhouette, which is what
  // reads on black at the distance one car sees another. Same paths,
  // same mark, drawn to be seen against the paint it was made for.
  const INK = bold ? "#a9a3b4" : "#14121a";
  const EMBER = bold ? "#ff6a24" : "#ff5a1f";

  // Horns first, so the skull sits over their roots and they read as
  // growing out of it rather than being stuck on the sides.
  const horn = (s: number) => {
    ctx.beginPath();
    ctx.moveTo(128 + s * 46, 106);
    ctx.quadraticCurveTo(128 + s * 124, 88, 128 + s * 116, 18);
    ctx.quadraticCurveTo(128 + s * 88, 60, 128 + s * 60, 76);
    ctx.closePath();
  };
  // Skull: heavy brow, hard cheekbones, a long jaw
  const skull = () => {
    ctx.beginPath();
    ctx.moveTo(128, 238);
    ctx.lineTo(72, 160);
    ctx.lineTo(56, 102);
    ctx.quadraticCurveTo(128, 58, 200, 102);
    ctx.lineTo(184, 160);
    ctx.closePath();
  };
  // Stroked in ember before it is filled in ink. The mark goes on paint
  // that is often nearly black at night, and an all-ink silhouette on
  // dark paint is a hole rather than a badge.
  ctx.lineJoin = "round";
  ctx.strokeStyle = EMBER;
  ctx.lineWidth = bold ? 20 : 9;
  for (const s of [-1, 1]) { horn(s); ctx.stroke(); }
  skull();
  ctx.stroke();
  ctx.fillStyle = INK;
  for (const s of [-1, 1]) { horn(s); ctx.fill(); }
  skull();
  ctx.fill();

  // Eyes: angled slits, lit from inside
  ctx.fillStyle = EMBER;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(128 + s * 26, 114);
    ctx.lineTo(128 + s * 74, 130);
    ctx.lineTo(128 + s * 68, 152);
    ctx.lineTo(128 + s * 30, 134);
    ctx.closePath();
    ctx.fill();
  }
  // A row of teeth rather than a drawn smile — a curve at this size
  // turns to mush, and the sawtooth still reads at a car's length.
  ctx.beginPath();
  ctx.moveTo(98, 176);
  for (let i = 0; i < 6; i++) {
    ctx.lineTo(98 + (i + 0.5) * 10, 194);
    ctx.lineTo(98 + (i + 1) * 10, 176);
  }
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  demonMarkTex.set(key, tex);
  return tex;
}

/** How big the mark is drawn for a car that WEARS it rather than badges
 *  itself with it. */
const LIVERY_MARK_PX = 512;

const nameDecalCache = new Map<string, THREE.CanvasTexture>();
/** The car's own name, laid out as a flank wordmark: Latin over Arabic. */
function nameDecalTexture(name: string, ar?: string): THREE.CanvasTexture {
  const key = `${name}|${ar ?? ""}`;
  const hit = nameDecalCache.get(key);
  if (hit) return hit;
  // Doubled to 1024 x 256, and through textTexture so the Arabic half
  // repaints when its font lands instead of being frozen as whatever
  // the fallback drew.
  const W = 1024, H = 256;
  const tex = textTexture(W, H, (ctx) => {
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center";
    // Letter-spaced caps, because a wordmark on a flank is read side-on
    // at speed and tight tracking closes up to a smear.
    ctx.letterSpacing = "12px";
    // A dark backing stroke under every glyph. This is the whole fix
    // for legibility: the wordmark is near-white, and on a white,
    // silver or gold car it used to disappear into the paint entirely.
    // Stroking first and filling over it gives each letter its own edge
    // whatever it is standing on, which is what a real cut-vinyl decal
    // gets from its own thickness and shadow.
    ctx.font = `800 108px ${latinDisplay()}`;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(10,12,16,0.9)";
    ctx.lineWidth = 12;
    ctx.strokeText(name.toUpperCase(), W / 2, 116);
    ctx.fillStyle = "#f4f6fa";
    ctx.fillText(name.toUpperCase(), W / 2, 116);
    ctx.letterSpacing = "0px";
    // The rule under it, with its own dark edge for the same reason.
    ctx.fillStyle = "rgba(10,12,16,0.9)";
    ctx.fillRect(W / 2 - 218, 138, 436, 10);
    ctx.fillStyle = "#ff5a1f";
    ctx.fillRect(W / 2 - 214, 140, 428, 6);
    if (ar) {
      ctx.direction = "rtl";
      ctx.font = `700 76px ${arabicUI()}`;
      ctx.strokeStyle = "rgba(10,12,16,0.9)";
      ctx.lineWidth = 10;
      ctx.strokeText(ar, W / 2, 216);
      ctx.fillStyle = "#f4f6fa";
      ctx.fillText(ar, W / 2, 216);
    }
  });
  tex.anisotropy = 16;
  nameDecalCache.set(key, tex);
  return tex;
}

const crewDecalCache = new Map<string, THREE.CanvasTexture>();
function crewDecalTexture(logo: TeamLogo, tag: string, name: string): THREE.CanvasTexture {
  const key = `${logo.shape}|${logo.symbol}|${logo.bg}|${logo.fg}|${tag}|${name}`;
  const cached = crewDecalCache.get(key);
  if (cached) return cached;
  // 512 x 640: the crew mark carries the crew's NAME, and a name is
  // the thing on a car people try hardest to read.
  const W = 512;
  const H = 640;
  const tex = textTexture(W, H, (ctx) => {
  ctx.clearRect(0, 0, W, H);
  drawTeamLogo(ctx, logo, W, tag);
  // The crew's own name under the shield. An Arabic name is set with the
  // Arabic stack and laid out right-to-left; the tag inside the shield
  // already goes through the same sanitiser both scripts share.
  const ar = /[؀-ۿ]/.test(name);
  const label = name.trim().slice(0, 18).toUpperCase();
  if (label) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.direction = ar ? "rtl" : "ltr";
    // Shrink to fit rather than run off the panel — a long crew name is
    // a normal thing to pick and it should not be cropped to "AL MUB".
    let px = 92;
    ctx.font = `700 ${px}px ${ar ? arabicUI() : latinDisplay()}`;
    while (px > 36 && ctx.measureText(label).width > W - 24) {
      px -= 2;
      ctx.font = `700 ${px}px ${ar ? arabicUI() : latinDisplay()}`;
    }
    // A dark plate behind it, because the paint under the roof decal is
    // whatever colour the player chose and white-on-white is nothing.
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = logo.bg;
    ctx.strokeStyle = logo.fg;
    ctx.lineWidth = 4;
    const bw = Math.min(W - 8, tw + 30);
    ctx.beginPath();
    ctx.roundRect((W - bw) / 2, W + 6, bw, H - W - 14, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = logo.fg;
    ctx.fillText(label, W / 2, W + 6 + (H - W - 14) / 2 + 1);
  }
  });
  tex.anisotropy = 16;
  crewDecalCache.set(key, tex);
  return tex;
}

/**
 * How metallic a paint should be, from its own colour.
 *
 * Pale paints go solid. The physics is not a preference: at metalness
 * near 1 the diffuse term vanishes and all you see is the environment
 * tinted by the base colour, so a white car becomes a mirror wearing
 * whatever the sky is doing — which here is a warm sodium band, and the
 * car comes out gold.
 *
 * The threshold is on luminance rather than on saturation, because it is
 * lightness that kills the diffuse: a pale blue has the same problem as
 * a white, and a saturated red does not.
 */
export function paintMetalness(hex: number): number {
  // A DECLARED solid is a solid. The luminance law below is a guess that
  // has to work for any colour a rival or the hub throws at the
  // renderer; a colour off the wall does not need guessing at, because
  // paints.ts says what it is. Looked up by hex rather than plumbed
  // through createCar's `body: number` — the hexes are unique and
  // tests/paints.mjs is what keeps them that way.
  //
  // 0, and not the 0.16 this used to be. A solid coat is pigment under
  // lacquer, and the lacquer IS a reflective surface — but in
  // MeshPhysicalMaterial the lacquer is the clearcoat, its own layer with
  // its own reflection, sitting on top of this basecoat. Giving the
  // basecoat metalness as well counted the lacquer twice, and paid for it
  // in diffuse: every point of metalness takes the same point of
  // diffuse away. Measured at 2:30 at the 0.55 exposure players get,
  // satin, sky in the probe, 0.128 (0.16 x satin) -> 0:
  //
  //   white    median 173 -> 183.5, less blue (saturation 0.44 -> 0.39)
  //   black    67.2% of the bodywork dead -> 64.6% (54.3% with its lift)
  //   diver    22.4% -> 16.7%;   olive, molasses, mudbrick, sage brighter
  //
  // Old swatches a client may still send are mapped to today's paint
  // first (RETIRED_SWATCHES), so they keep the treatment.
  const known = PAINTS.find((p) => p.hex === currentPaintHex(hex));
  if (known?.solid) return 0;
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Metallic in the mid-tones, falling away at BOTH ends.
  //
  // The paragraph above argues that a solid white "or a solid black" is
  // pigment under lacquer rather than flake, and then the code only ever
  // implemented the white half: everything at or below mid luminance got
  // a flat 0.95. Measured on a real car really painted, paint-black came
  // back with 56.3% of its bodywork at or under 8/255 and a tonal range
  // across the panels of 22.8 against white's 107.9. More than half of a
  // black car was a hole.
  //
  // (Those numbers were taken against a stale reflection probe at the
  // manual 1.15 exposure — see tools/shots/paintcolors.mjs. At 2:30, at
  // the 0.55 players actually get, a satin black car is 74.8% dead with
  // the probe as it was, 67.2% with the sky in it, and 54.3% with the
  // sky, metalness 0 for solids (above) and paint-black's lift to
  // 0x1a1b1f together.)
  //
  // The physics says why. In a metalness workflow F0 IS the base colour,
  // so a near-black basecoat reflects what it is: 0x0d0e11 is about half
  // a percent of the light in linear terms (the 5% sometimes quoted for
  // it is the sRGB byte, 13/255, not the light) — and metalness takes the
  // diffuse away as well, leaving a surface that neither reflects nor
  // shades. Real metallic black is aluminium flake, which
  // is bright, suspended in a dark binder; calling the whole thing a
  // black metal is the part that was wrong.
  //
  // The dark knee is deliberately low. Dark does not mean unmetallic —
  // metallic reds and navies are real and common, and this fleet's red
  // sits at 0.22, its navy at 0.18 and its purple at 0.23, all of which
  // keep the full 0.95. Only the near-blacks, where F0 stops being
  // physical at all, come down to a dielectric basecoat and let the
  // clearcoat above do the work it is already there to do.
  if (lum >= 0.5) return Math.max(0.18, 0.95 - (lum - 0.5) * 1.9);
  const DARK_KNEE = 0.16;
  if (lum >= DARK_KNEE) return 0.95;
  return 0.18 + (0.95 - 0.18) * (lum / DARK_KNEE);
}

function seg0Pitch(p: number): number {
  return Math.max(-1.2, Math.min(1.2, p));
}

function decalMat(map: THREE.CanvasTexture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: "decal",
    map,
    transparent: true,
    roughness: 0.5,
    metalness: 0.1,
    emissive: 0xffffff,
    emissiveMap: map,
    emissiveIntensity: 0.16,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
}

function plateMat(colors: CarColors): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: "plate",
    map: plateTexture(plateReg(colors)),
    // Retroreflective sheeting, not painted metal: a plate is the
    // brightest thing on a car in somebody else's headlights, and at
    // 0.5 it was reading as a slightly shiny sticker.
    roughness: 0.34,
  });
}

/**
 * What the wheel is.
 *
 * "steel" is not a colour, it is a different WHEEL: a pressed steel rim
 * with a plastic cover clipped over it, which is what a base-model car
 * leaves the showroom on and what half the cars on this road are still
 * wearing. It reads from ten metres and it is the single strongest cue
 * that a machine has not been got at yet — far stronger than the badge
 * or the power figure, because it is the one thing an owner changes
 * FIRST when they start spending.
 */
export type WheelFinish = "silver" | "gold" | "bronze" | "steel" | "black";

/**
 * Which wheel a car wears — asked in one place because it was asked in
 * two, in different orders, and they disagreed.
 *
 * The material was chosen a thousand lines before the finish was, and
 * once a factory wheel existed the two orders parted company: a Black
 * Demon with bought gold rims came out as a gold wheel with black
 * spokes, because one site said gold and the other said black and the
 * spoke material is passed to the wheel the finish built. Neither was
 * wrong on its own; having two of them was.
 *
 * The order, and why:
 *
 *   gold     A purchase, and purchases win. Somebody who has spent on
 *            wheels is telling you so, and burying that because the car
 *            came on something else is the game overruling a decision
 *            the player paid for.
 *   factory  What the machine was delivered on. Part of the car the way
 *            its paint is, not a stage of tune — so it comes ahead of
 *            the kit, or a car built around black forged wheels would
 *            wear the attack kit's bronze for the crime of also
 *            carrying the aero.
 *   bronze   The full attack kit's forge. A stage of tune: it says how
 *            far this car has been built.
 *   steel    A street car with nothing bought — a pressed cover, which
 *            is the strongest signal in the game that a machine has not
 *            been got at yet.
 *   silver   Everything else: a cast alloy.
 */
export function wheelFinishFor(colors: CarColors, kit: KitLevel): WheelFinish {
  if (colors.goldRims) return "gold";
  if (colors.rims) return colors.rims;
  if (colors.raceKit) return "bronze";
  return kit === "street" ? "steel" : "silver";
}

/** A livery a car is BUILT with, as opposed to a sticker pack bought for
 *  it in the garage: the Black Demon's marks, and a patrol car's. */
export type Livery = "demon" | "police";

/**
 * A patrol car, and what it deliberately is NOT.
 *
 * The word is شرطة — "police", the common noun, the one painted on the
 * side of a patrol car in every Arabic-speaking country there is. It is
 * not a ministry, not a force, not a crest and not an emergency number,
 * and that is the same decision STREET_NAMES in world.ts records for the
 * road names: a real institution's markings are a claim about a real
 * institution, this game cannot check that claim, and a wrong one reads
 * to a Kuwaiti as a statement about their own city. A generic patrol car
 * is honest and reads as police anywhere.
 */
export const POLICE = {
  /**
   * Silver, not white. A modern patrol car is a light metallic with the
   * livery laid over it, and that is also what the reference this was
   * rebuilt against actually is.
   *
   * White is not ruled out because it "reflects nothing" — it does not.
   * Its lacquer is a full clearcoat, so it mirrors the lamps like any
   * gloss. What it lacks is CONTRAST in the reflection:
   * three quarters of the light that reaches a white panel comes back as
   * diffuse, which swamps the reflection running along the flank, where
   * a light silver keeps that reflection visible as the car turns. At
   * night the diffuse is also the wrong colour: every light that reaches
   * a car body is the blue moon rig or the blue player rim (street lamps
   * are emissive heads and pools on the road; they light no objects), so
   * a white car renders pale blue.
   */
  silver: 0xd3d8de,
  /**
   * The wrap.
   *
   * Two greens rather than one: the wrap is a printed vinyl with a
   * darker core and a brighter leading edge, which is what gives it an
   * edge you can see across a lane at night instead of a flat slab.
   */
  green: 0x00873c,
  greenLit: 0x18b257,
  /** Both lamp colours start one channel at zero for the reason
   *  TAIL.lensColor gives: ACES walks a bright colour toward white, so a
   *  lamp with headroom in every channel goes white as it brightens
   *  instead of staying the colour it is. */
  blue: 0x0030ff,
  /** How hard a lamp burns when it is on. Well past 1: this is the
   *  brightest thing on the road at night and it is meant to bloom. */
  lampOn: 3.2,
  lampOff: 0.02,
  /**
   * How tall the wrap is, and where it sits.
   *
   * 0.22 m once, which is a pinstripe: on the render it read as a
   * bootlace with unreadable type on it. A real patrol wrap covers most
   * of the door — from under the glass to the sill — and the lettering
   * inside it is the height of a hand. This is most of the flank's
   * clear lane, and the type is sized off the wrap rather than typed in.
   */
  bandH: 0.46,
  /** The bar, matching the authored one in tools/blender: a low-profile
   *  strip, not a beacon. Half-width as a fraction of the shell's own
   *  half-width, then height and depth in metres. */
  barHalfK: 0.74,
  barH: 0.085,
  barD: 0.17,
  barLift: 0.028,
} as const;

/**
 * Which way a patrol car's bar is burning at time `t`.
 *
 * One side at a time, two quick pulses each, then over to the other —
 * which is what a real bar does and what a plain on/off alternation
 * does not. A pure sine reads as a car with a lamp on a dimmer.
 *
 * Left and right, not red and blue. Both banks are the same blue now:
 * a two-colour bar is a North American convention and the car this was
 * rebuilt against runs blue on both ends, which is also what reads as
 * one light bar rather than as two separate lamps bolted together.
 *
 * Pure arithmetic and exported so the pattern can be checked without a
 * renderer: the engine writes what this returns onto two materials and
 * has no opinion of its own.
 */
export function policeLamps(t: number): { left: number; right: number } {
  const CYCLE = 0.94;
  const u = ((t % CYCLE) + CYCLE) % CYCLE;
  const half = CYCLE / 2;
  // Which side has the floor this half-cycle, and how far into it.
  const onRed = u < half;
  const v = onRed ? u : u - half;
  // Two pulses inside the first two thirds of the half, then dark while
  // the other side goes.
  const lit = v < 0.1 || (v > 0.16 && v < 0.26);
  const level = lit ? POLICE.lampOn : POLICE.lampOff;
  return {
    left: onRed ? level : POLICE.lampOff,
    right: onRed ? POLICE.lampOff : level,
  };
}

let policeBandTex: THREE.CanvasTexture | null = null;
/**
 * The flank wrap, with the word in it.
 *
 * One texture and therefore one ribbon per flank rather than a wrap mesh
 * plus a lettering mesh: a patrol car is traffic, there are several of
 * them on the road at once, and traffic is built `simple` precisely
 * because it is not worth two of anything.
 *
 * The SHAPE is in the alpha, not in the geometry. A patrol wrap is not a
 * rectangle — it sweeps: low and thin at the nose, deep through the
 * doors, kicking up over the rear arch. Cutting that out of the texture
 * costs nothing and is the difference between a livery and a stripe,
 * and it means the ribbon underneath stays the simple constant-height
 * band that flankRibbon is good at.
 */
function policeBandTexture(): THREE.CanvasTexture {
  if (policeBandTex) return policeBandTex;
  const W = 2048, H = 256;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
  // u runs 0 at the TAIL to 1 at the NOSE — flankRibbon's own convention.
  // The wrap's top and bottom edge as a function of u, in texture rows.
  const topAt = (u: number) => H * (0.66 - 0.60 * Math.pow(u, 1.7));
  const botAt = (u: number) => H * (1.04 - 0.30 * Math.pow(u, 2.4));
  const sweep = (off: number) => {
    g.beginPath();
    for (let i = 0; i <= 128; i++) {
      const u = i / 128;
      g.lineTo(u * W, topAt(u) + off);
    }
    for (let i = 128; i >= 0; i--) {
      const u = i / 128;
      g.lineTo(u * W, botAt(u));
    }
    g.closePath();
  };
  // The body of the wrap, then a brighter leading edge along its top.
  sweep(0);
  g.fillStyle = hex(POLICE.green);
  g.fill();
  g.save();
  sweep(0);
  g.clip();
  sweep(H * 0.085);
  g.fillStyle = hex(POLICE.greenLit);
  g.globalCompositeOperation = "destination-over";
  g.fillRect(0, 0, W, H);
  g.restore();
  // A white hairline on top of the sweep, which is what a printed wrap
  // has and what stops the green meeting the silver in a muddy seam.
  g.beginPath();
  for (let i = 0; i <= 128; i++) {
    const u = i / 128;
    g.lineTo(u * W, topAt(u));
  }
  g.strokeStyle = "rgba(255,255,255,0.85)";
  g.lineWidth = 5;
  g.stroke();

  // The word, sized off the wrap rather than typed in: as tall as the
  // wrap is deep at the door, which is where it goes on a real one.
  const uWord = 0.46;
  const cx = uWord * W;
  const top = topAt(uWord), bot = botAt(uWord);
  const deep = bot - top;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#ffffff";
  // Arabic above, Latin below — the same order every bilingual surface
  // in this game uses.
  g.font = `700 ${Math.round(deep * 0.46)}px ${arabicSign()}`;
  g.fillText("شرطة", cx, top + deep * 0.34);
  g.font = `700 ${Math.round(deep * 0.30)}px ${latinDisplay()}`;
  g.fillText("POLICE", cx, top + deep * 0.72);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  policeBandTex = tex;
  return tex;
}

/** Hero wheel parts, merged to one geometry per material so a Blender
 *  build can replace each in a single swap (models.ts) — and so four
 *  wheels cost five draw calls instead of fifteen. Keyed by spoke count
 *  and side, since the lip, rotor and lugs sit on the outboard face. */
const heroWheelCache = new Map<string, Record<string, THREE.BufferGeometry>>();

function heroWheelParts(nSpokes: number, side: number) {
  const key = `${nSpokes}|${side}`;
  let parts = heroWheelCache.get(key);
  if (parts) return parts;

  const at = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
    const g = geo.clone();
    g.translate(x, y, z);
    return g;
  };
  // Tire: one lathed section, so tread and both sidewalls are a single
  // continuous surface. The lathe's own v already runs bead to bead
  // with the tread landing at 0.2-0.8, so the three hand-remapped
  // pieces this replaced are not needed and neither are their seams.
  const tire = tireGeoHi.clone();
  // Alloy face: machined lip, spokes, hub — everything wearing the
  // finish colour
  const alloyParts: THREE.BufferGeometry[] = [
    at(lipGeo, side * 0.135 * WHEEL_W_K),
    hubGeo.clone(),
  ];
  for (let i = 0; i < nSpokes; i++) {
    const g = spokeGeo.clone();
    g.translate(0, 0.1 * WHEEL_R_K, 0);
    g.rotateX((i / nSpokes) * Math.PI * 2);
    alloyParts.push(g);
  }
  const alloy = mergeGeometries(alloyParts)!;
  const lugParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    lugParts.push(
      at(
        lugGeo,
        side * 0.148 * WHEEL_W_K,
        Math.cos(a) * 0.058 * WHEEL_R_K,
        Math.sin(a) * 0.058 * WHEEL_R_K
      )
    );
  }
  parts = {
    tire,
    barrel: rimGeo,
    alloy,
    rotor: at(discGeo, -side * 0.055 * WHEEL_W_K),
    lugs: mergeGeometries(lugParts)!,
  };
  heroWheelCache.set(key, parts);
  return parts;
}

function buildWheel(
  finish: WheelFinish = "silver",
  side = 1,
  opts?: {
    detailed?: boolean;
    spokeMat?: THREE.MeshStandardMaterial;
    /** Sidewall lettering, if the player has bought any. */
    sticker?: TyreSticker;
  }
): THREE.Group {
  const steel = finish === "steel";
  const spokeMat = steel
    ? hubcapMat
    : opts?.spokeMat ??
      rimMatFor(finish);
  const detailed = opts?.detailed ?? false;
  // Six straight spokes on the forged bronze wheel, five on the street
  // cast — and four on a hubcap, because a pressed cover has a few wide
  // flat vanes rather than a spoke pattern, and that difference in
  // COUNT is what the eye reads at speed even when the shape is coarse.
  const nSpokes = finish === "bronze" || finish === "black" ? 6 : steel ? 4 : 5;
  const w = new THREE.Group();
  // Spin, steer and camber are three writes on this one node; the order
  // they compose in is what keeps the spin on the axle. See suspension.ts.
  w.rotation.order = WHEEL_EULER_ORDER;

  if (detailed) {
    // One mesh per material, each tagged for the authored swap. The
    // geometries are shared module-level merges — never dispose them.
    const parts = heroWheelParts(nSpokes, side);
    // Rotors get a per-wheel clone: they glow with brake heat, and the
    // shared material would light up the whole fleet at once.
    const rotorMat = discMat.clone();
    rotorMat.emissive = new THREE.Color(0xff3a00);
    rotorMat.emissiveIntensity = 0;
    const mats: Record<string, THREE.Material> = {
      tire: getTireMat(),
      barrel: rimDarkMat,
      alloy: spokeMat,
      rotor: rotorMat,
      lugs: rimDarkMat,
    };
    for (const name of ["tire", "barrel", "alloy", "rotor", "lugs"]) {
      const mesh = new THREE.Mesh(parts[name], mats[name]);
      mesh.userData.wheelPart = name;
      mesh.userData.wheelSide = side;
      w.add(mesh);
    }
    // The cover itself: a shallow dish clipped over the face of the
    // rim, which is what makes a steel wheel read as a steel wheel
    // rather than as a dull alloy. It sits PROUD of the spokes, hiding
    // most of them — a hubcap covers the wheel, that is its whole job.
    if (steel) {
      const cap = new THREE.Mesh(hubcapGeo, hubcapMat);
      cap.position.x = side * 0.135 * WHEEL_W_K;
      cap.userData.wheelPart = "hubcap";
      w.add(cap);
    }
    addTyreSticker(w, side, opts?.sticker);
    w.userData.spokes = nSpokes;
    w.userData.rotorMat = rotorMat;
    return w;
  }

  // Traffic wheel: the cheap build, unchanged
  w.add(new THREE.Mesh(tireGeo, getTireMat()));
  w.add(new THREE.Mesh(rimGeo, rimDarkMat));
  const lip = new THREE.Mesh(lipGeo, spokeMat);
  lip.position.x = side * 0.135 * WHEEL_W_K;
  w.add(lip);
  for (let i = 0; i < nSpokes; i++) {
    const holder = new THREE.Group();
    holder.rotation.x = (i / nSpokes) * Math.PI * 2;
    const spoke = new THREE.Mesh(spokeGeo, spokeMat);
    spoke.position.y = 0.1 * WHEEL_R_K;
    holder.add(spoke);
    w.add(holder);
  }
  w.add(new THREE.Mesh(hubGeo, spokeMat));
  addTyreSticker(w, side, opts?.sticker);
  return w;
}

export function createCar(colors: CarColors): THREE.Group {
  const group = new THREE.Group();
  // The engine yaws, pitches and rolls the shell on this node. Yaw has
  // to be the outermost of the three or the hub solve is wrong at every
  // heading but straight ahead. See suspension.ts.
  group.rotation.order = BODY_EULER_ORDER;
  const style: BodyStyle = colors.style ?? "sedan";
  // The same drop, applied to every anchor hung off the shells. Heights
  // only: nose, tail, wiperZ and the z halves of roof/mirror/bPillar are
  // stations along the car and must not move.
  const raw = STYLE_DIMS[style];
  const d: StyleDims = {
    ...raw,
    noseTopY: raw.noseTopY - BODY_DROP,
    grilleY: raw.grilleY - BODY_DROP,
    beltY: raw.beltY - BODY_DROP,
    hoodY: raw.hoodY - BODY_DROP,
    tailY: raw.tailY - BODY_DROP,
    deckY: raw.deckY - BODY_DROP,
    dashY: raw.dashY - BODY_DROP,
    creaseY: raw.creaseY - BODY_DROP,
    roof: [raw.roof[0], raw.roof[1] - BODY_DROP],
    mirror: [raw.mirror[0], raw.mirror[1] - BODY_DROP, raw.mirror[2]],
    bPillar: [raw.bPillar[0], raw.bPillar[1] - BODY_DROP, raw.bPillar[2]],
  };
  // How far this one is built. `raceKit` is the old yes/no form of the
  // same question and still wins if a caller only set that — the menu
  // hardcodes it for the prize car, and the showroom capture reads it
  // straight off the roster.
  //
  // Validated rather than trusted. Two suites were passing
  // `kit: car.kit === "attack"` — a boolean — which was silently ignored
  // while CarColors had no `kit` field, and became a hard crash the
  // moment it had one: WIDE[false] is undefined and every car in the
  // game stopped building. A caller getting this wrong should get the
  // weakest kit, not a broken scene.
  const asked = colors.kit;
  const kit: KitLevel =
    asked && asked in WIDE ? asked : colors.raceKit ? "attack" : "street";

  // Automotive paint is two layers: a metallic basecoat with flake, and a
  // hard clearcoat over it. The clearcoat is what throws the sharp
  // reflection of the world; the basecoat carries the colour and sparkle.
  // Two coats, and they are different materials doing different jobs.
  //
  // The basecoat is aluminium flake in a tinted binder: rough, so its
  // lobe is broad and dim, and it is what gives the car its colour. The
  // clearcoat is smooth dielectric lacquer, and it is what gives the car
  // its highlight — a small, white, near-mirror reflection of whatever
  // is actually there.
  //
  // At roughness 0.34 and metalness 0.9 a quarter of every panel sat
  // inside the highlight — measured, 23.7% of body pixels above half the
  // peak. That is a satin sheen, not gloss: gloss is a SMALL bright
  // thing on a DARKER field, and this was a large medium thing on a
  // medium field.
  //
  // The first attempt at fixing it went the wrong way, on the theory
  // that a real basecoat is rough and the clearcoat should carry the
  // highlight. Roughness 0.52 and metalness 0.78 took the highlight from
  // 23.7% of the panel to 43.4% and the contrast from 3.1 to 2.1 — more
  // diffuse, brighter, flatter, worse in every direction. Scanning five
  // settings against the same frame settled it: tighter and more
  // metallic is what gloss is here. 0.18/0.95 gives 18.6% and 3.7.
  //
  // clearcoatRoughness comes UP slightly all the same. 0.03 is optically
  // perfect, which nothing sprayed by a human has ever been, and a
  // flawless mirror is a large part of why a rendered highlight reads as
  // a neon strip rather than as a reflection of one.
  const bodyMat = new THREE.MeshPhysicalMaterial({
    name: "paint",
    color: colors.body,
    // Gloss, pulled back.
    //
    // These were the numbers of a show car under studio lights: a 0.18
    // basecoat under a clearcoat at 0.05 is very close to a mirror, and
    // envMapIntensity 2.4 then multiplies whatever that mirror finds by
    // nearly two and a half. On the showroom turntable it made every
    // machine look wet.
    //
    // Worth recording what this did NOT fix, because it was measured:
    // out on the road at night the paint's environment reflection adds
    // -0.004 mean luminance to the car and lifts 0.3% of it by more
    // than 0.2. Reflections are not what makes a car bright in the
    // race — the headlamps, their glare sprites and the tail lamps are,
    // and none of those are paint. So this is a showroom and menu
    // change by measurement, whatever it looks like it should be.
    // The finish decides the lacquer. gloss is the mirror this game has
    // always drawn; satin spreads the highlight so it follows a curve
    // instead of skipping across it; matte takes the clearcoat away
    // entirely and lets the shape do the work.
    // 0.18, and measured rather than picked — see tools/shots/paint.mjs,
    // which segments the body panels and reports the distribution rather
    // than one "is it shiny" number.
    //
    // At 0.29 the paint was matte by that instrument's own definition:
    // under the lamps, 68% of body pixels sat above half the highlight
    // and the median panel was within 1.5x of the brightest point. A
    // glossy surface puts its highlight in a SMALL area; this smeared it
    // across two thirds of the car.
    //
    // Swept against one live frame, 0.29 -> 0.10:
    //
    //   0.29/0.13   ratio 1.5   highlight  68%    dead 0%     grain 11.3
    //   0.22/0.09   ratio 2.2   highlight  44%    dead 0%     grain 12.1
    //   0.18/0.06   ratio 4.6   highlight  17%    dead 0.6%   grain 14.2
    //   0.14/0.04   ratio 6.6   highlight 7.7%    dead 1.4%   grain 11.4
    //   0.10/0.03   ratio 6.2   highlight 7.8%    dead 1.0%   grain  8.5
    //
    // 0.18 is the knee and three separate numbers agree on it. Past it
    // the ratio keeps climbing for the wrong reason: the median panel
    // collapses to 36 and dead pixels more than double, which is a
    // searing streak on a car gone black between highlights — the exact
    // failure paint.mjs was written to catch. The highlight itself also
    // gets DIMMER past the knee (spec 254 -> 235 -> 221), and grain, the
    // flake and orange-peel texture, peaks at 0.18 and falls away either
    // side.
    //
    // This does undo half of an earlier decision to pull the gloss back,
    // and that decision is worth remembering: it was taken when
    // envMapIntensity was 2.4, which "made every machine look wet" on
    // the showroom turntable. The gain is 1.5 now. A tight lobe and a
    // loud environment are different things, and only one of them was
    // the problem.
    roughness: 0.18 + FINISHES[colors.finish ?? "gloss"].roughnessAdd,
    // Metalness by how LIGHT the paint is.
    //
    // At 0.95 across the board, a metal's reflection is tinted by its
    // own colour and almost nothing diffuse survives — so a white car
    // shows you the environment map and nothing else, and this game's
    // environment map has a sodium horizon band in it. Every pale car
    // in the fleet was coming out GOLD. The Anniversary is supposed to
    // be arctic white with orange over the top and it rendered as a tan
    // coupe with orange over the top.
    //
    // Real paint agrees: a solid white or a solid black is not a
    // metallic finish, it is pigment under lacquer, and the gloss comes
    // from the clearcoat above rather than from flake below. Mid-tone
    // colours are where metallic paint actually lives, and they keep it.
    // The finish scales the metalness — see FinishSpec.metalScale for
    // why matte HAS to: a matte car that kept the paint's metalness had
    // no diffuse term and rendered as a dim mirror, not as pigment.
    metalness: paintMetalness(colors.body) * FINISHES[colors.finish ?? "gloss"].metalScale,
    clearcoat: FINISHES[colors.finish ?? "gloss"].clearcoat,
    clearcoatRoughness: FINISHES[colors.finish ?? "gloss"].clearcoatRoughness,
    envMapIntensity: 1.5 * FINISHES[colors.finish ?? "gloss"].envScale,
    // No sheen here, and that is a MEASURED decision rather than an
    // omission. The edges of a car in this game were the suspected
    // cause of "no volume", so a grazing-angle sheen lobe was fitted
    // and swept at 0.35 / 0.55 / 0.75 / 0.95 — and with the measurement
    // finally taken against a pinned exposure it made the rim ratio
    // slightly WORSE at every setting (2.13 without, 2.08 at 0.55,
    // 2.07 at 0.8). The upper silhouette already runs at twice the
    // luminance of the middle of the same panel; the clearcoat and the
    // envmap's horizon band were doing the job all along.
  });

  // Per-car metal clones for everything that should mirror the world.
  // The shared module materials must stay shared — the live reflection
  // probe carries the player's own surroundings, and binding it to a
  // shared material would paint the player's reflections onto every car
  // on the road. Traffic keeps the shared mats and skips the cost.
  const spokeBase = rimMatFor(wheelFinishFor(colors, kit));
  const spokeLocal = colors.simple ? undefined : spokeBase.clone();
  const chromeLocal = colors.simple ? chromeMat : chromeMat.clone();
  chromeLocal.name = "chrome";
  const reflectMats: THREE.MeshStandardMaterial[] = [];
  if (spokeLocal) {
    spokeLocal.userData.baseEnvIntensity = spokeLocal.envMapIntensity;
    reflectMats.push(spokeLocal);
  }
  if (chromeLocal !== chromeMat) {
    chromeLocal.userData.baseEnvIntensity = chromeLocal.envMapIntensity;
    reflectMats.push(chromeLocal);
  }

  const bCabBack = style === "zx" || style === "rx7";
  const [bGeo, cGeo, rGeo] =
    style === "super"
      ? [superBodyGeo, superCanopyGeo, superRoofGeo]
      : style === "pickup"
      ? [pickupBodyGeo, pickupCanopyGeo, pickupRoofGeo]
      : style === "suv"
      ? [suvBodyGeo, suvCanopyGeo, suvRoofGeo]
      : style === "pony"
      ? [ponyBodyGeo, ponyCanopyGeo, ponyRoofGeo]
      : style === "zx"
      ? [zxBodyGeo, zxCanopyGeo, zxRoofGeo]
      : style === "rx7"
        ? [rx7BodyGeo, rx7CanopyGeo, rx7RoofGeo]
        : style === "gtr"
          ? [gtrBodyGeo, gtrCanopyGeo, gtrRoofGeo]
          : style === "hatch"
            ? [hatchBodyGeo, hatchCanopyGeo, hatchRoofGeo]
            : [bodyGeo, canopyGeo, roofGeo];
  // The three shells are tagged so models.ts can swap in Blender-authored
  // geometry (same profiles, denser sampling) once it loads.
  const bodyShell = new THREE.Mesh(bGeo, bodyMat);
  bodyShell.userData.shell = "body";
  group.add(bodyShell);
  // The shell's own half-width. Everything that mounts on the flank —
  // arch openings, arch lips, side markers — is an offset from this
  // rather than from the sedan's 0.92, which is what the wide bodies
  // were being measured against while their skin sat 40-60 mm further
  // out. Cheap: extrudeProfile caches its bounding box after the first
  // car of a silhouette.
  bGeo.computeBoundingBox();
  const flankX = bGeo.boundingBox!.max.x;
  /**
   * The painted top skin at a point along the car, on the centreline.
   *
   * `hoodY` and `deckY` are the profile's top LINE. The extrusion's
   * bevel carries the actual surface 20 to 160 mm above it, depending on
   * the body — so everything that lies on the hood was lying inside it.
   * Measured on all four silhouettes: the sticker pack's hood decal was
   * 23 mm under the skin on the gtr and 170 mm under it on the rx7, and
   * had therefore never been seen on any car in the game.
   */
  const skinY = (z: number, fallback: number): number => deckY(bGeo, style, z) ?? fallback;
  // Per-car glass when the tint is not factory. The shared material has
  // to stay shared for everything else — thirty traffic cars pointing at
  // one material is the whole reason it is a module constant — but a
  // tinted window belongs to ONE car, and cloning the shared one would
  // tint every pane on the road.
  const tintPct = colors.tint ?? 0;
  // No film is factory glass, whatever the slider was left on: the
  // darkness is free and the roll is not.
  const glassLocal =
    tintPct > 0 && colors.tintFilm ? tintedGlass(tintPct, colors.tintFilm) : glassMat;
  const canopyShell = new THREE.Mesh(cGeo, glassLocal);
  canopyShell.userData.shell = "canopy";
  group.add(canopyShell);
  const roofShell = new THREE.Mesh(rGeo, bodyMat);
  roofShell.userData.shell = "roof";
  group.add(roofShell);

  // The cabin fit: head behind the header, seat under the ceiling.
  // Both the driver and the interior behind him hang off these, so the
  // headrest cannot end up somewhere the head is not.
  const headerZ = cGeo.userData.headerZ as number | undefined;
  const headZ = headerZ !== undefined ? headerZ - CABIN_HEAD_BACK : bCabBack ? -0.26 : 0.1;
  const cabinRoofY = skinAt(cGeo, style, DRIVER_X, headZ, "canopy");
  const seatY =
    cabinRoofY !== null ? cabinRoofY - CABIN_HEADROOM - driverHeadTop() : d.dashY - 0.34;
  // The fit, published. A cabin is the one thing on this car measured
  // from the shell at build time rather than authored, so the numbers it
  // came out with are worth being able to read back.
  group.userData.cabin = { headZ, cabinRoofY, seatY, headTop: driverHeadTop() };
  // ...and re-measurable, because the glass this was read off is not
  // necessarily the glass the car ends up wearing. createCar runs
  // synchronously against the extrusion; the authored canopy arrives
  // later, over the network, and models.ts swaps it in underneath a
  // driver already seated. The two shells agree to about a millimetre
  // today, so nothing is visibly wrong — but "the driver is seated
  // against a shell nobody renders" is the same latent bug refitShell
  // was written to close for the lamps, and it costs one hook to shut.
  // Everything that hangs off the seat moves together or not at all.
  const seatRiders: THREE.Object3D[] = [];
  group.userData.refitCabin = (glass: THREE.BufferGeometry) => {
    const roofY = skinAt(glass, style, DRIVER_X, headZ, "canopy:authored");
    if (roofY === null) return;
    const want = roofY - CABIN_HEADROOM - driverHeadTop();
    const dy = want - seatY;
    // Sub-millimetre is the shells agreeing, not a fit to redo.
    if (Math.abs(dy) < 0.001) return;
    for (const o of seatRiders) o.position.y += dy;
    group.userData.cabin = { headZ, cabinRoofY: roofY, seatY: want, headTop: driverHeadTop() };
  };

  /** Top of the bonnet stripe at a point along it, when the car wears one. */
  let hoodStripeTop: ((z: number) => number) | null = null;

  /**
   * The topmost painted surface at a point along the car — bonnet,
   * glass or roof, whichever is highest there.
   *
   * A stripe that runs over the top of a car crosses three separate
   * shells, and each of them is the top one for part of the length.
   * Asking only the body puts the stripe under the windscreen for the
   * whole of the cabin; asking only the roof puts it in the air over
   * the bonnet. Taking the max of all three is the only thing that
   * follows the car.
   */
  const topSkinY = (z: number): number => {
    const b = deckY(bGeo, style, z) ?? -Infinity;
    const c = deckY(cGeo, style, z, "canopy") ?? -Infinity;
    const r = deckY(rGeo, style, z, "roof") ?? -Infinity;
    const top = Math.max(b, c, r);
    return Number.isFinite(top) ? top : d.hoodY;
  };

  // --- Twin over-the-top stripes.
  if (colors.accent !== undefined && colors.stripes === "twin") {
    const stripeMat = new THREE.MeshStandardMaterial({
      name: "accent-stripe",
      color: colors.accent,
      roughness: 0.4,
    });
    // Laid in many short pieces for the same reason the single stripe
    // is: a panel is not a ramp, and a long board levelled against its
    // two ends sinks through everything curved in between. Over the top
    // of a car that is most of the run — the windscreen and the hatch
    // glass are the two steepest surfaces on the machine.
    const PIECES = 26;
    const zFront = d.nose - 0.1;
    const zRear = d.tail + 0.16;
    const step = (zFront - zRear) / PIECES;
    // Half the gap between the two stripes. Narrow, because these sit
    // either side of the centreline rather than out on the panels.
    const GAP = 0.135;
    const WIDE = 0.2;
    for (let i = 0; i < PIECES; i++) {
      const a = zRear + i * step;
      const b = a + step;
      const mid = (a + b) / 2;
      const yA = topSkinY(a);
      const yB = topSkinY(b);
      // Pitch, clamped: the windscreen is steep enough that an
      // unclamped asin would flip a piece onto its edge.
      const pitch = Math.atan2(yA - yB, step);
      for (const sx of [-1, 1]) {
        const seg = new THREE.Mesh(
          roundedBox(WIDE, 0.011, step * 1.06, 0.004),
          stripeMat
        );
        seg.position.set(
          sx * (GAP + WIDE / 2),
          (yA + yB) / 2 + 0.008,
          mid
        );
        seg.rotation.x = Math.max(-1.2, Math.min(1.2, pitch));
        group.add(seg);
      }
      if (mid > 0) {
        const y0 = (yA + yB) / 2 + 0.008;
        const sinA = Math.sin(seg0Pitch(pitch));
        const prev: ((z: number) => number) | null = hoodStripeTop;
        hoodStripeTop = (z: number): number =>
          Math.max(y0 + (mid - z) * sinA + 0.011, prev ? prev(z) : -Infinity);
      }
    }
  }

  if (colors.accent !== undefined && colors.stripes !== "twin") {
    // A bonnet-and-boot stripe, seated on the panels it lies on. It was
    // one 4.3 m bar held at a fixed height for the whole length of the
    // car, which is a straight line laid through a curved body: it broke
    // the surface over the nose, sank into the hood, ran under the
    // cabin, and never reached the boot. On screen it read as a green
    // rectangle stuck to the bumper.
    const accentMat = new THREE.MeshStandardMaterial({
      name: "accent-stripe",
      color: colors.accent,
      roughness: 0.35,
    });
    // Each run is laid in short pieces rather than as one long board.
    // A panel is not a ramp: levelled against its two ends only, a 0.9 m
    // stripe sinks into the crown between them, which broke the boot
    // stripe into two green patches with the middle missing.
    const PIECES = 4;
    // Where the stripe runs, derived from the body rather than typed in.
    //
    // Both runs were hardcoded saloon numbers, and the whole block was
    // gated on `style === "sedan"` — so nine of the fifteen cars in the
    // showroom accepted an accent colour and drew nothing with it. Found
    // by counting the fleet against itself: accent-stripe came out on
    // six cars and absent from nine, and the nine had one thing in
    // common, which was not being a saloon.
    //
    // The bonnet run is the same on every body: from just ahead of the
    // wiper line to just short of the nose. The BOOT run is not — a
    // fastback has no boot lid to put a stripe on, its glass runs to the
    // tail — so it is only laid where the profile actually has a deck,
    // and the fastbacks get the bonnet alone. That is what those cars
    // look like with a stripe on them, rather than a green rectangle
    // stuck across a rear window.
    const runs: Array<[number, number]> = [[d.wiperZ + 0.06, d.nose - 0.23]];
    if (style === "sedan" || style === "gtr") {
      runs.push([d.tail + 0.22, d.roof[0] - 0.9]);
    }
    for (const [zRear, zFront] of runs) {
      const step = (zFront - zRear) / PIECES;
      for (let i = 0; i < PIECES; i++) {
        const a = zRear + i * step;
        const b = a + step;
        const mid = (a + b) / 2;
        const yA = skinY(a, d.hoodY);
        const yB = skinY(b, d.hoodY);
        // 12 mm thick, not 30: this is paint, and a stripe standing 3 cm
        // off the bonnet is a spoiler.
        const seg = new THREE.Mesh(roundedBox(0.46, 0.012, step * 1.02, 0.005), accentMat);
        seg.position.set(0, (yA + yB) / 2 + 0.009, mid);
        seg.rotation.x = Math.asin(Math.min(0.6, (yA - yB) / step));
        group.add(seg);
        // The hood decal has to clear whichever piece it lands on, or
        // the stripe covers the falcon's middle. Measured at the decal's
        // own z: the pieces are pitched, so the height at the centre of
        // one is a centimetre off the height where the decal sits.
        if (zFront > 0) {
          const y0 = seg.position.y;
          const sinA = Math.sin(seg.rotation.x);
          const prev: ((z: number) => number) | null = hoodStripeTop;
          hoodStripeTop = (z: number): number =>
            Math.max(y0 + (mid - z) * sinA + 0.011, prev ? prev(z) : -Infinity);
        }
      }
    }
  }

  // --- Carbon bodywork.
  //
  // Panels laid over the shell rather than the shell re-materialised.
  // The body is one extruded skin from nose to tail — there is no bonnet
  // object to swap — so carbon is a set of thin plates that follow the
  // top surface, pitched piece by piece, the same technique the racing
  // stripes use for exactly the same reason.
  //
  // Only the panels a car actually has in carbon get one. A fastback has
  // no boot lid, so it gets no boot panel; putting one across its rear
  // glass would be a black rectangle stuck on a window, which is the
  // mistake the stripe code already learned not to make.
  const carbon: CarbonLevel = colors.carbon ?? "none";
  if (carbon !== "none" && !colors.simple) {
    const cMat = carbonPanelMat();
    /**
     * Lay a panel along z, following whatever the top surface does.
     *
     * `topAt` is passed in rather than assumed, because "the top
     * surface" is two different shells: under the bonnet and the boot it
     * is the body, and over the greenhouse it is the roof. Sampling the
     * body shell at a roof z returns the floor of the cabin, and a roof
     * panel seated on that would be inside the car.
     */
    const panel = (
      zRear: number, zFront: number, halfW: number, lift: number,
      topAt: (z: number) => number
    ): void => {
      if (zFront <= zRear) return;
      const m = new THREE.Mesh(surfaceRibbon(zRear, zFront, halfW, lift, topAt), cMat);
      m.userData.trim = "carbon";
      group.add(m);
    };
    const bodyTop = (z: number): number => skinY(z, d.hoodY);
    // The bonnet, on every car. Narrower than the body so the painted
    // wings still show either side of it — a carbon bonnet that reached
    // the arches would read as a black nose rather than as a panel.
    panel(d.wiperZ + 0.06, d.nose - 0.3, flankX * 0.66, 0.006, bodyTop);
    // The boot lid, where the profile has one. The run is the stripe's
    // own, which stops short of the backlight: a panel that carried on
    // up the rear glass is a black sheet over a window.
    if (style === "sedan" || style === "gtr") {
      panel(d.tail + 0.24, d.roof[0] - 0.94, flankX * 0.62, 0.006,
        (z) => skinY(z, d.deckY));
    }
    // Mirror caps: the cheapest carbon anybody buys and the first thing
    // they buy, so it is in the base package.
    for (const sxSign of [-1, 1]) {
      const cap = new THREE.Mesh(roundedBox(0.17, 0.055, 0.21, 0.03), cMat);
      cap.position.set(sxSign * (flankX + d.mirror[0]), d.mirror[1] + 0.03, d.mirror[2]);
      cap.userData.trim = "carbon";
      group.add(cap);
    }
    if (carbon === "full") {
      // The roof skin. Highest mass on the car and the one panel whose
      // weight a driver can feel in a change of direction, which is why
      // it is the step up rather than part of the base package.
      // The roof's z span comes from the roof shell's own bounds.
      //
      // NOT from d.roof. That is [z, y] — the sunroof and antenna ANCHOR
      // POINT, one z and one height — and reading it as a pair of z
      // values asks for the roof surface at z = 1.3, which is out over
      // the windscreen. deckY returns null there, the guard below
      // skipped the panel, and Full Dry Carbon quietly delivered exactly
      // the same four pieces as the cheaper package. It cost 3,200 KD
      // and added nothing, and it took measuring the built car to find
      // out, because nothing about it looked wrong.
      rGeo.computeBoundingBox();
      const roofBox = rGeo.boundingBox!;
      const seatedRoof = (z: number): number | null => deckY(rGeo, style, z, "roof");
      const a = roofBox.min.z + 0.18;
      const b = roofBox.max.z - 0.18;
      // Still guarded: a shell that cannot be measured gets no panel
      // rather than a panel on a guessed height, which is a slab
      // hovering over the glass.
      if (b > a && seatedRoof(a) !== null && seatedRoof(b) !== null) {
        panel(a, b, flankX * 0.55, 0.005, (z) => seatedRoof(z) ?? seatedRoof(a)!);
      }
    }
  }

  // --- The engine cover, and the vents that let you see it.
  //
  // A cam cover under a shut bonnet is money spent on a thing that is
  // not there, so the part does both: it cuts two openings in the
  // bonnet and puts something worth looking at underneath them. The
  // opening is a dark recess — the bay — with the cover sitting in it,
  // which is what gives the vent depth instead of making it a black
  // sticker.
  if (colors.engineCover !== undefined && !colors.simple) {
    const coverMat = new THREE.MeshStandardMaterial({
      name: "engine-cover",
      color: colors.engineCover,
      // Crackle and wrinkle finishes are the opposite of bodywork:
      // rough, barely metallic, and they hold no reflection at all.
      // Polished alloy is the exception and it is close enough to this
      // that a second material is not worth the draw call.
      roughness: 0.55,
      metalness: 0.35,
      envMapIntensity: 0.8,
    });
    const bayMat = new THREE.MeshStandardMaterial({
      name: "engine-bay",
      color: 0x05060a,
      roughness: 0.95,
      metalness: 0,
    });
    // Where the engine sits: back of the bonnet, ahead of the wipers,
    // which is where a bay is on a front-engined car.
    const bayZ = d.wiperZ + 0.55;
    const bayY = skinY(bayZ, d.hoodY);
    // Every piece is placed as a depth BELOW the bonnet skin, and the
    // depths are written down here rather than as offsets at each use,
    // because the first version had the cover's top three centimetres
    // ABOVE the skin — an engine growing out through a shut bonnet. That
    // is invisible in a night render of a dark car and obvious the
    // moment the bounding boxes are printed.
    const BAY_FLOOR = 0.11;  // the dark floor of the recess
    const COVER_TOP = 0.03;  // the cam cover's crown, safely under the skin
    const COVER_H = 0.06;
    for (const sx of [-0.33, 0.33]) {
      // The hole: a dark floor deep enough that the eye reads a recess
      // rather than a painted patch.
      const hole = new THREE.Mesh(roundedBox(0.3, 0.02, 0.44, 0.01), bayMat);
      hole.position.set(sx, bayY - BAY_FLOOR, bayZ);
      hole.userData.trim = "hood-vent";
      group.add(hole);
      // The cover, sitting in the recess with its crown a clear
      // centimetres below the bonnet line.
      const cover = new THREE.Mesh(roundedBox(0.25, COVER_H, 0.38, 0.015), coverMat);
      cover.position.set(sx, bayY - COVER_TOP - COVER_H / 2, bayZ);
      cover.userData.trim = "engine-cover";
      group.add(cover);
      // Ribs across it. A cam cover is ribbed, and the ribs are what
      // catch the one grazing light that reaches down a vent — without
      // them the cover is a flat coloured lozenge at any distance.
      for (const rz of [-0.12, 0, 0.12]) {
        const rib = new THREE.Mesh(roundedBox(0.22, 0.018, 0.04, 0.008), coverMat);
        rib.position.set(sx, bayY - COVER_TOP - 0.004, bayZ + rz);
        group.add(rib);
      }
      // The vent surround, in body colour: the lip of pressed steel the
      // opening is cut into. It is what stops the hole reading as a
      // decal painted on the bonnet.
      for (const ex of [-1, 1]) {
        const edge = new THREE.Mesh(roundedBox(0.02, 0.03, 0.46, 0.008), bodyMat);
        edge.position.set(sx + ex * 0.16, bayY + 0.002, bayZ);
        group.add(edge);
      }
    }
  }

  // Lights: lens strips front and rear. The head material is cloned per
  // car so a single rival can flash back without lighting up traffic.
  const headMat = headlightMat.clone();

  // --- The headlamp mods.
  const lamps = colors.headlamps ?? "stock";
  // Which side keeps its lamp when one has been taken out. The kerb
  // side, because that is the one a passer-by sees and the whole point
  // of the look is that people notice.
  const LAMP_GONE = 1;
  const lampGone = (sx: number): boolean => lamps === "single" && Math.sign(sx) === LAMP_GONE;
  if (lamps === "smoked") {
    // Smoked lenses. The glass goes dark and the emissive comes most of
    // the way down — but NOT to nothing, because a smoked lamp is still
    // a lamp: at night it glows a dull amber through the tint, and that
    // dirty glow is the entire look. Killing the emissive outright would
    // just give the car two black rectangles.
    headMat.color = new THREE.Color(0x1a1c20);
    headMat.emissive = new THREE.Color(0xffb257);
    headMat.emissiveIntensity = 0.42;
  } else if (lamps === "laser") {
    // Laser white. The stock lens is warm — 0xfff6cf, a halogen
    // colour — and a laser lamp is the opposite end of the scale: the
    // blue-white that makes oncoming traffic flash you. Half a stop
    // hotter than stock, too, because a line 18 mm tall has a tenth of
    // the lit area of a pair of lamps and would otherwise be the
    // dimmest face in the game rather than the brightest.
    headMat.color = new THREE.Color(0xe8f0ff);
    headMat.emissive = new THREE.Color(0xd2e2ff);
    headMat.emissiveIntensity = 2.1;
  }

  // Every lamp carries a soft bloom and a diffraction star. Sprites, so
  // the flare always faces the camera — an oncoming car's lights spike
  // properly whichever way it is pointing. Traffic skips them: thirty
  // background cars do not need sixty extra additive sprites.
  const headGlowMats: THREE.SpriteMaterial[] = [];
  /** Where this shell's lamps actually are, in body space.
   *
   *  Recorded so the engine can put its light sources at the lamps
   *  rather than at an average guess: every silhouette carries them at a
   *  different height and a different point in the nose, and a beam that
   *  starts somewhere other than the lamp it is supposed to be coming
   *  out of is the thing that makes headlights look painted on. */
  const lampPositions: THREE.Vector3[] = [];
  const addHeadGlare = (x: number, y: number, z: number, size = 1) => {
    // Recorded before the early return: traffic cars skip the sprites,
    // and they still have headlamps.
    lampPositions.push(new THREE.Vector3(x, y, z));
    if (colors.simple) return;
    // A tinted lens flares less, and the flare is most of what a
    // headlight IS at a distance — so the tint has to reach the sprites
    // or a smoked car looks stock from fifty metres.
    const flare = lamps === "smoked" ? 0.34 : 1;
    const halo = new THREE.SpriteMaterial({
      map: pointGlowTexture(),
      // The flare has to be the colour of the lamp behind it or the mod
      // stops at ten metres: a laser car with a warm halo is a warm car
      // with a cold line painted on its nose.
      color: lamps === "smoked" ? 0xffc98a : lamps === "laser" ? 0xdceaff : 0xfff2cc,
      transparent: true,
      opacity: 0.5 * flare,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const h = new THREE.Sprite(halo);
    h.scale.setScalar(0.85 * size);
    h.position.set(x, y, z + 0.06);
    h.userData.noShadow = true;
    group.add(h);
    headGlowMats.push(halo);

    const starMat = new THREE.SpriteMaterial({
      map: headlightStarTexture(),
      color: lamps === "smoked" ? 0xffd9a0 : lamps === "laser" ? 0xeaf2ff : 0xfff6e0,
      transparent: true,
      opacity: 0.62 * flare,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const star = new THREE.Sprite(starMat);
    star.scale.setScalar(1.7 * size);
    star.position.set(x, y, z + 0.07);
    star.userData.noShadow = true;
    group.add(star);
    headGlowMats.push(starMat);
  };

  // Every headlamp is an assembly, the way the tail lamps already were:
  // a dark housing set into the bodywork, a lens inside it, and a hot
  // projector inside that. Each piece is SMALLER than the one around it
  // and therefore sits FURTHER OUT, or it is swallowed whole — the same
  // stacking rule the rear lamps are built to.
  //
  // Before this, every headlamp on every car was a single emissive box
  // at intensity 2.6. It clipped to flat white, bloomed, and arrived on
  // screen as a featureless glowing slab stuck to the nose: no bezel, no
  // lens, no focal point, and no way to tell one car's face from
  // another's. Four silhouettes, four different slabs, all identical
  // once lit.
  //
  // `bulb` is the piece that is allowed to blow out. Everything else has
  // to keep its shape.
  /**
   * What sits in the hole where a headlamp was.
   *
   * Not nothing. A deleted lamp on a street car is an open pan with a
   * mesh screen over it — that is how it stays legal-ish, how the intake
   * behind it breathes, and how anyone looking at the car can tell it
   * was DONE rather than broken. A smooth black rectangle reads as a
   * missing texture; a screen with a visible weave reads as a decision.
   */
  const addLampDelete = (x: number, y: number, z: number, w2: number, h2: number): void => {
    // The recessed backing, darker than the housing so the socket has
    // depth rather than being a flat patch.
    const back = new THREE.Mesh(roundedBox(w2, h2, 0.02, 0.012), gapMat);
    back.position.set(x, y, z - 0.02);
    group.add(back);
    if (colors.simple) return;
    // The screen: horizontal wires, because a coarse weave at this scale
    // is two sets of bars and only one of them survives being seen from
    // a car length away.
    const bars = Math.max(3, Math.round(h2 / 0.022));
    for (let i = 0; i < bars; i++) {
      const wire = new THREE.Mesh(
        new THREE.BoxGeometry(w2 * 0.94, 0.006, 0.008),
        seamMat
      );
      wire.position.set(x, y - h2 / 2 + (h2 * (i + 0.5)) / bars, z);
      group.add(wire);
    }
    // And a frame around it, so the screen has an edge instead of
    // fading into the pan.
    const frame = new THREE.Mesh(roundedBox(w2 + 0.018, h2 + 0.018, 0.014, 0.008), housingMat);
    frame.position.set(x, y, z - 0.006);
    group.add(frame);
  };

  const bulb = (x: number, y: number, z: number, r = 0.042, len = 0.05) => {
    const core = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.86, len, 14), headCoreMat);
    core.rotation.x = Math.PI / 2;
    core.position.set(x, y, z);
    core.name = "lamp-core";
    group.add(core);
  };

  /**
   * Where the nose actually is at lamp height.
   *
   * Both face swaps below land on it rather than on `d.nose`, which is
   * the silhouette's anchor point and not the panel: on the Z32 that
   * difference put the lamps 100 mm inside the bumper and three cars
   * drove the lap with no headlights on screen at all.
   */
  const faceY = d.noseTopY;
  const faceZ = (noseFaceZ(bGeo, style, faceY, true) ?? d.nose) - 0.02;

  if (lamps === "round") {
    // Round headlights: the conversion, not a restyle.
    //
    // Every silhouette in this fleet wears a rectangular lamp, because
    // every one of them is drawn from a machine of the decade that
    // stopped fitting round ones. This puts them back — one 7-inch
    // lamp a side, 190 mm across the glass, which is the size the part
    // is really sold in.
    const R = 0.095;
    for (const sx of [-0.6, 0.6]) {
      // The bucket: wider than the lamp, deeper than it, and dark. A
      // round lamp that is not set INTO something is a headlight
      // sticker.
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.09, 24), housingMat);
      pan.rotation.x = Math.PI / 2;
      pan.position.set(sx, faceY, faceZ - 0.03);
      pan.name = "lamp-housing";
      group.add(pan);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.96, 0.06, 24), headMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(sx, faceY, faceZ + 0.012);
      lens.name = "lamp-lens";
      group.add(lens);
      // THE RING, and the ring is the entire mod. A lit cylinder is a
      // glowing dot at any distance at all; what makes a round
      // headlight read as ROUND is the hard bright circle of the rim
      // around it, which is there in daylight with the lamps off and
      // still there at night when the glass has blown out to white.
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.013, 0.015, 8, 30), chromeLocal);
      rim.position.set(sx, faceY, faceZ + 0.048);
      group.add(rim);
      // The projector sits dead centre, where a round lamp's is. On the
      // rectangular lamps below it is set inboard, because theirs is.
      bulb(sx, faceY, faceZ + 0.04, 0.032, 0.04);
      addHeadGlare(sx, faceY, faceZ + 0.03, 1.05);
    }
  } else if (lamps === "laser") {
    // One laser line, the full width of the nose.
    //
    // The Z32 bar below this is deliberately SEGMENTED, and the note
    // beside it says why: a continuous strip of emissive is a
    // fluorescent tube. That is true of a bar 78 mm tall. It stops
    // being true at 20 mm — past that thinness the eye reads a LINE
    // rather than a lit panel — and what finishes the job is the
    // filament: a 7 mm core running the length of the blade, hotter
    // than the glass around it. A laser lamp is a line with a brighter
    // line inside it, and the two together are the whole look.
    //
    // MIND THE BEVEL. roundedBox takes its corner radius as
    // ExtrudeGeometry's bevelSize, which grows the shape by r on EVERY
    // side — so the numbers below are the shape, and the part that
    // gets built is 2r taller and wider than they read. The first
    // version asked for 18 mm and built 32, which is a panel; the test
    // measures the bounding box for exactly this reason.
    //
    // Sized off flankX (the shell's own half-width) rather than a
    // literal, so it spans the nose of a 1.76 m coupe and a 1.95 m
    // truck alike instead of stopping short on one and hanging off the
    // corners of the other.
    // 0.74 rather than 0.8: at four-fifths of the half-width the blade
    // ran into the corner markers on the saloon and the SUV, and a
    // light bar that overlaps the indicator is one panel, not two.
    const halfW = flankX * 0.74;
    const ly = faceY + 0.012;
    const lz = (noseFaceZ(bGeo, style, ly, true) ?? d.nose) - 0.02;
    // The channel it is recessed into: 54 mm of dark as built, so there
    // is a shadow above and below the line. Without it the blade floats
    // on the paint.
    const channel = new THREE.Mesh(roundedBox(halfW * 2 + 0.05, 0.03, 0.055, 0.012), housingMat);
    channel.position.set(0, ly, lz - 0.012);
    channel.name = "lamp-housing";
    group.add(channel);
    const blade = new THREE.Mesh(roundedBox(halfW * 2, 0.012, 0.05, 0.004), headMat);
    blade.position.set(0, ly, lz + 0.012);
    blade.name = "lamp-lens";
    group.add(blade);
    const filament = new THREE.Mesh(roundedBox(halfW * 2 - 0.07, 0.004, 0.04, 0.0015), headCoreMat);
    filament.position.set(0, ly, lz + 0.03);
    filament.name = "lamp-core";
    group.add(filament);
    // And the emitters, where the beam actually leaves the car. A line
    // across the whole nose still has to throw light from two points —
    // the engine hangs its spotlights on lampPositions, and a single
    // source on the centreline would light the road like a motorcycle.
    for (const sx of [-halfW * 0.55, halfW * 0.55]) {
      bulb(sx, ly, lz + 0.038, 0.022, 0.03);
      addHeadGlare(sx, ly, lz + 0.03, 0.85);
    }
  } else if (style === "zx") {
    // Z32 signature: one flush light bar across the whole nose. Pinned
    // 80 mm behind the nose anchor it was 100 mm inside the bumper — the
    // three cars on this silhouette had no headlights on screen at all.
    const barY = d.noseTopY + 0.03;
    const barZ = (noseFaceZ(bGeo, style, barY, true) ?? d.nose) - 0.018;
    // The housing first: a dark channel the bar sits down inside.
    const channel = new THREE.Mesh(roundedBox(1.62, 0.14, 0.06, 0.03), housingMat);
    channel.position.set(0, barY, barZ - 0.014);
    channel.rotation.x = -0.09;
    channel.name = "lamp-housing";
    group.add(channel);
    // Then the bar itself, SEGMENTED. A continuous strip of emissive is
    // a fluorescent tube; a row of elements with the housing showing
    // between them is a light bar. This is the whole difference on this
    // silhouette.
    const SEGS = 6;
    const segW = 1.5 / SEGS - 0.028;
    for (let i = 0; i < SEGS; i++) {
      const cx = -0.75 + (1.5 / SEGS) * (i + 0.5);
      // A light BAR cannot lose one of two lamps, because it does not
      // have two. Half the bar goes dark instead, which is the same
      // statement in this silhouette's own language.
      if (lamps === "single" && Math.sign(cx) === LAMP_GONE) {
        addLampDelete(cx, barY, barZ + 0.004, segW, 0.078);
        continue;
      }
      const seg = new THREE.Mesh(roundedBox(segW, 0.078, 0.06, 0.022), headMat);
      seg.position.set(cx, barY + Math.sin(-0.09) * 0, barZ + 0.004);
      seg.rotation.x = -0.09;
      seg.name = "lamp-lens";
      group.add(seg);
    }
    // Two projectors in the bar, where the main beams actually come from.
    for (const sx of [-0.5, 0.5]) {
      if (lampGone(sx)) continue;
      bulb(sx, barY, barZ + 0.03, 0.03, 0.045);
      addHeadGlare(sx, barY, barZ, 0.95);
    }
  } else if (style === "rx7") {
    // Pop-up headlights, up for the night run: a body-colour door tilted
    // out of the hood with the lamp shining from under it. Both sat
    // under the hood skin, so the FD ran dark as well.
    const hood = deckY(bGeo, style, d.nose - 0.4) ?? d.noseTopY + 0.08;
    for (const sx of [-0.58, 0.58]) {
      const door = new THREE.Mesh(roundedBox(0.44, 0.05, 0.3, 0.02), bodyMat);
      door.position.set(sx, hood + 0.075, d.nose - 0.42);
      door.rotation.x = -0.62;
      group.add(door);
      // The bucket the lamp sits in, then a round lens, then the bulb.
      // A pop-up is a round sealed beam in a black pan, and the pan is
      // what makes it read as one.
      const pan = new THREE.Mesh(roundedBox(0.4, 0.15, 0.07, 0.03), housingMat);
      pan.position.set(sx, hood + 0.05, d.nose - 0.375);
      pan.name = "lamp-housing";
      group.add(pan);
      if (lampGone(sx)) {
        // A pop-up with the lamp out: the door stays DOWN, because
        // there is nothing to raise. The pan is what you see.
        door.rotation.x = 0;
        door.position.set(sx, hood + 0.028, d.nose - 0.44);
        addLampDelete(sx, hood + 0.05, d.nose - 0.35, 0.34, 0.12);
        continue;
      }
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 18), headMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(sx, hood + 0.05, d.nose - 0.345);
      lens.name = "lamp-lens";
      group.add(lens);
      // Far enough forward to clear the raised door above it. The mesh
      // audit is what caught this: the bulb was proud of its lens and
      // still painted nothing, because the pop-up door tilted up over
      // the top of it.
      bulb(sx, hood + 0.05, d.nose - 0.295, 0.03, 0.04);
      addHeadGlare(sx, hood + 0.05, d.nose - 0.32, 0.9);
    }
  } else {
    // The silhouette's own package, fitted to its own nose.
    //
    // Both halves of that are new. The shape comes from LAMPS_BY_STYLE
    // instead of one pair of literals shared by six of the nine cars,
    // and the PLACE comes off the shell instead of off `d.nose` and a
    // hand-picked 0.62.
    //
    // Measured before this: the lens stood 53 to 121 mm ahead of the
    // bodywork at its own x, because a nose falls away toward its
    // corners and the lamp did not; and on the pony the lamp's outer
    // edge sat 162 mm OUTBOARD of the car's own flank. Asking the shell
    // is the idiom the tail lamps have used since they were refitted —
    // tailFaceZ and flankXAt there, noseFaceAt and flankXAt here.
    const spec = LAMPS_BY_STYLE[style];
    const ly = d.noseTopY;
    /** Where the panel is, at a lamp's own station and height. */
    const faceAt = (x: number, y: number) =>
      noseFaceAt(bGeo, style, +x.toFixed(3), y) ?? noseFaceZ(bGeo, style, y, true) ?? d.nose;
    /**
     * How far out a lamp at this height may reach: the half-width of the
     * nose just behind its tip, less the pad.
     *
     * Walked back from the nose rather than solved, and deliberately so.
     * The flank and the nose face are each defined in terms of the
     * other, and iterating between them diverges on a nose that tapers
     * hard — worse, every miss falls back to `flankX`, the bounding-box
     * maximum this whole block exists to stop using, so a diverging
     * solve lands exactly on the bug. Stepping backwards takes the
     * FIRST height at which the body has a flank at all, which is the
     * narrowest place a lamp has to fit into and the only honest bound.
     */
    const outerAt = (y: number): number => {
      for (let i = 0; i <= 30; i++) {
        const z = +(d.nose - 0.06 - i * 0.02).toFixed(3);
        const x = flankXAt(bGeo, style, y, z, "");
        if (x !== null) return x - HEAD_PAD;
      }
      return flankX - HEAD_PAD;
    };

    /** One lens, with its housing behind it and its projector in it. */
    const lamp = (cx: number, cy: number, w: number, h: number, round = false) => {
      const fz = faceAt(cx, cy);
      const pod = round
        ? new THREE.Mesh(new THREE.CylinderGeometry(w / 2 + 0.022, w / 2 + 0.022, 0.07, 20), housingMat)
        : new THREE.Mesh(roundedBox(w + 0.06, h + 0.05, 0.07, 0.03), housingMat);
      if (round) pod.rotation.x = Math.PI / 2;
      pod.position.set(cx, cy, fz - 0.05);
      pod.name = "lamp-housing";
      group.add(pod);
      if (lampGone(cx)) {
        addLampDelete(cx, cy, fz - 0.03, w, h);
        return;
      }
      const lens = round
        ? new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2 * 0.96, 0.06, 20), headMat)
        : new THREE.Mesh(roundedBox(w, h, 0.065, 0.02), headMat);
      if (round) lens.rotation.x = Math.PI / 2;
      lens.position.set(cx, cy, fz - 0.026);
      lens.name = "lamp-lens";
      group.add(lens);
      // The projector, set toward the inboard end where a real one is.
      bulb(cx - Math.sign(cx) * Math.min(0.13, w * 0.26), cy, fz + 0.004);
      addHeadGlare(cx, cy, fz - 0.004, Math.min(1.2, Math.max(0.6, w / 0.5)));
    };

    // roundedBox grows the shape by its corner radius on every side, so
    // the lens a player sees is 40 mm wider than the number above. Taken
    // off here, once, rather than folded into nine typed widths.
    const LENS_R = 0.02;
    for (const side of [-1, 1]) {
      if (spec.shape === "quad") {
        // Four round lamps, two a side, the outboard one a touch
        // larger — which is how they were actually fitted.
        const r = spec.w;
        const outer = side * outerAt(ly);
        lamp(outer - side * (r / 2), ly, r, r, true);
        lamp(outer - side * (r * 1.58), ly, r * 0.86, r * 0.86, true);
      } else if (spec.shape === "stack") {
        // Two lenses in one socket, main over dip. Each row asks the
        // flank about its own height — a tall nose is not a slab.
        for (const dy of [spec.h * 0.62, -spec.h * 0.62]) {
          const cy = ly + dy;
          const outer = side * (outerAt(cy) - spec.w / 2 - LENS_R);
          lamp(outer, cy, spec.w, spec.h);
        }
      } else {
        const outer = side * (outerAt(ly) - spec.w / 2 - LENS_R);
        lamp(outer, ly, spec.w, spec.h);
      }
      if (spec.eyes) {
        // Inner projector eyes beside the main lamps, each in its own
        // dark bezel so they read as a second pair rather than as two
        // more bright dots on the paint.
        const ex = side * 0.3;
        const fz = faceAt(ex, ly);
        const bezel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.072, 0.072, 0.04, 16),
          housingMat
        );
        bezel.rotation.x = Math.PI / 2;
        bezel.position.set(ex, ly, fz - 0.04);
        bezel.name = "lamp-housing";
        group.add(bezel);
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12), headMat);
        eye.rotation.x = Math.PI / 2;
        eye.position.set(ex, ly, fz - 0.023);
        eye.name = "lamp-lens";
        group.add(eye);
        bulb(ex, ly, fz + 0.008, 0.026, 0.035);
      }
    }
  }
  const tailMat = new THREE.MeshStandardMaterial({
    name: "taillamp-lens",
    color: 0x550000,
    emissive: TAIL.lensColor,
    emissiveIntensity: TAIL.lensIdle,
  });
  // The hot element inside each lamp. It used to share tailMat with the
  // lens, which made it invisible twice over: the same flat emissive
  // colour, and geometry sitting wholly inside the lens. Now it is a
  // hotter, oranger red and it stands proud, so it reads as the filament
  // rather than as more of the same red plastic.
  const tailCoreMat = new THREE.MeshStandardMaterial({
    name: "taillamp-core",
    color: 0x330000,
    emissive: TAIL.coreColor,
    emissiveIntensity: TAIL.coreIdle,
  });
  // The rear lamps are built as assemblies — smoked housing, outer lens,
  // and a hotter inner core — with additive glow halos hung behind them
  // that the engine flares when the brakes bite.
  const tailGlowMats: THREE.MeshBasicMaterial[] = [];
  const addTailGlow = (x: number, y: number, z: number, w = 0.55, h = 0.4) => {
    const m = new THREE.MeshBasicMaterial({
      map: pointGlowTexture(),
      color: TAIL.glowColor,
      transparent: true,
      opacity: TAIL.glowIdle,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    glow.position.set(x, y, z - 0.12);
    glow.rotation.y = Math.PI; // faces the following traffic
    glow.userData.noShadow = true;
    tailGroup.add(glow);
    tailGlowMats.push(m);
  };

  // Every lamp assembly is a stack: a smoked outer housing, a lens
  // inside it, a hotter core inside that. Each element is SMALLER than
  // the one around it, so each must sit FURTHER OUT or it is swallowed
  // whole. All four silhouettes had the stack the other way round —
  // outer piece deepest, core shallowest — which put the core inside the
  // lens on every car in the fleet. The offsets below step outward by
  // 12–20 mm a layer; the mesh audit checks they still do.
  //
  // WHERE THE LAMPS SIT, and it is asked rather than typed.
  //
  // Every lamp used to hang at `d.tail` minus a step, and every housing
  // was centred at a number chosen per silhouette by eye: 0.52 on a
  // saloon, 0.7 on a hatch, 0.72 and 0.76 for the round pairs, a 1.86 m
  // band on the fastback. Two things are wrong with that, and both are
  // the same thing that was wrong with the hood and the plates before
  // they were fixed the same way.
  //
  // The FACE. `d.tail` is the profile's anchor, and the extrusion bevels
  // the tail in behind it — by more at the corners than on the
  // centreline. A lamp pinned to the anchor stands off the skin behind
  // the plate and sinks into it at the corner, on the same car, and the
  // lamp on the left does not match the lamp on the right unless both
  // happen to land at the same depth of bevel.
  //
  // The EDGE. The housings were sized against the widest point of the
  // whole car, and the tail is narrower than that. On the fastback the
  // band ran clean past both rear corners; on the saloon the housing
  // finished exactly at the skin with no margin at all. A lamp is a part
  // that is FITTED into a panel, and what says "fitted" from behind is a
  // consistent lip of paint around it — the same on the left and the
  // right, and the same on every car.
  //
  // So the geometry is asked twice: where the rear skin is at the lamp's
  // own x, and how far out the flank is at lamp height just inboard of
  // the tail. Every element is then stepped out from that face by the
  // same 12-20 mm ladder as before, and every housing's outer edge is
  // set TAIL_PAD in from that flank. The widths that follow are the
  // widths the housings had; only their centres move.
  //
  // And asked TWICE. The shell this is built against is the extrude;
  // the shell the player sees is the authored loft that models.ts swaps
  // in once its file arrives, and at lamp height the two flanks differ
  // by up to 40 mm (measured on the hatch). So the tail is built as a
  // unit that can be built again: models.ts calls refitShell with the
  // authored body and the lamps move to the skin that is actually there.
  const tailGroup = new THREE.Group();
  tailGroup.name = "tail-lamps";
  group.add(tailGroup);
  const buildTail = (geo: THREE.BufferGeometry, tag: string) => {
  const tailAt = (x: number) => tailFaceZ(geo, style, x, d.tailY, tag) ?? d.tail;
  const tailHalf =
    flankXAt(geo, style, d.tailY, tailAt(0) + 0.14, tag) ?? flankX;
  if (style === "gtr") {
    // The R34 calling card: four round afterburners, each a dark ring
    // with a hot core — the classic double-circle look.
    const outer = tailHalf - TAIL_PAD - 0.115;
    const inner = outer - 0.28;
    const garnish = new THREE.Mesh(roundedBox(2 * (tailHalf - TAIL_PAD * 0.5), 0.3, 0.05, 0.02), grilleMat);
    garnish.position.set(0, d.tailY, tailAt(0) + 0.005);
    tailGroup.add(garnish);
    for (const sx of [-outer, -inner, inner, outer]) {
      const tz = tailAt(sx);
      const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.04, 16), housingMat);
      bezel.rotation.x = Math.PI / 2;
      bezel.position.set(sx, d.tailY, tz - 0.022);
      tailGroup.add(bezel);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.05, 16), tailMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(sx, d.tailY, tz - 0.03);
      tailGroup.add(ring);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10), tailCoreMat);
      core.rotation.x = Math.PI / 2;
      core.position.set(sx, d.tailY, tz - 0.042);
      tailGroup.add(core);
    }
    const mid = (outer + inner) / 2;
    addTailGlow(-mid, d.tailY, tailAt(mid), 0.75, 0.45);
    addTailGlow(mid, d.tailY, tailAt(mid), 0.75, 0.45);
  } else if (style === "rx7") {
    // The FD tail: a full-width smoked garnish with twin round lamps at
    // each corner, tucked tight in pairs
    const outer = tailHalf - TAIL_PAD - 0.095;
    const inner = outer - 0.24;
    const frame = new THREE.Mesh(roundedBox(2 * (tailHalf - TAIL_PAD * 0.5), 0.2, 0.05, 0.04), housingMat);
    frame.position.set(0, d.tailY, tailAt(0) - 0.015);
    tailGroup.add(frame);
    for (const sx of [-outer, -inner, inner, outer]) {
      const tz = tailAt(sx);
      const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.04, 14), housingMat);
      bezel.rotation.x = Math.PI / 2;
      bezel.position.set(sx, d.tailY, tz - 0.032);
      tailGroup.add(bezel);
      // The red lens. It was not here: this was the only tail in the
      // fleet built as bezel-then-core with nothing between them, so
      // the FD's four lamps were a hot orange element sitting in a
      // smoked ring with no red around it, while every other silhouette
      // has three layers. Found by counting the fleet against itself —
      // taillamp-lens came out 0 on this body and 1 to 5 on the rest.
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.05, 14), tailMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(sx, d.tailY, tz - 0.044);
      tailGroup.add(lens);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.055, 14), tailCoreMat);
      lamp.rotation.x = Math.PI / 2;
      lamp.position.set(sx, d.tailY, tz - 0.056);
      tailGroup.add(lamp);
    }
    const mid = (outer + inner) / 2;
    addTailGlow(-mid, d.tailY, tailAt(mid), 0.7, 0.42);
    addTailGlow(mid, d.tailY, tailAt(mid), 0.7, 0.42);
  } else if (style === "zx") {
    // Full-width assembly under the fastback glass: smoked housing frame,
    // the band, and a hotter inner strip running its length. Flat, at
    // the centreline's face: a full-width lamp is one flat part, and it
    // is the corners' job to be inside it, not the band's job to bend.
    const fh = tailHalf - TAIL_PAD;
    const tz = tailAt(0);
    const frame = new THREE.Mesh(roundedBox(2 * fh, 0.19, 0.05, 0.03), housingMat);
    frame.position.set(0, d.tailY, tz - 0.015);
    tailGroup.add(frame);
    const band = new THREE.Mesh(roundedBox(2 * (fh - 0.04), 0.13, 0.06, 0.025), tailMat);
    band.position.set(0, d.tailY, tz - 0.028);
    tailGroup.add(band);
    const core = new THREE.Mesh(roundedBox(2 * (fh - 0.13), 0.045, 0.065, 0.02), tailCoreMat);
    core.position.set(0, d.tailY, tz - 0.045);
    tailGroup.add(core);
    addTailGlow(-fh * 0.65, d.tailY, tz, 0.8, 0.4);
    addTailGlow(fh * 0.65, d.tailY, tz, 0.8, 0.4);
  } else if (style === "hatch") {
    // A hatch wears its lamps in the corners of the tailgate opening,
    // standing tall rather than lying wide: they wrap the D-pillar and
    // they are most of what you recognise the car by from behind.
    const hc = tailHalf - TAIL_PAD - 0.17;
    for (const sxSign of [-1, 1]) {
      const sx = sxSign * hc;
      const tz = tailAt(sx);
      const housing = new THREE.Mesh(roundedBox(0.34, 0.3, 0.05, 0.035), housingMat);
      housing.position.set(sx, d.tailY, tz - 0.005);
      tailGroup.add(housing);
      const lens = new THREE.Mesh(roundedBox(0.28, 0.24, 0.06, 0.03), tailMat);
      lens.position.set(sx, d.tailY, tz - 0.015);
      tailGroup.add(lens);
      // The lit element is an L: a bar across the top and one down the
      // outboard edge, which is the shape these have carried for decades.
      const bar = new THREE.Mesh(roundedBox(0.24, 0.05, 0.05, 0.016), tailCoreMat);
      bar.position.set(sx, d.tailY + 0.08, tz - 0.032);
      tailGroup.add(bar);
      const post = new THREE.Mesh(roundedBox(0.05, 0.2, 0.05, 0.016), tailCoreMat);
      post.position.set(sxSign * (hc + 0.09), d.tailY - 0.02, tz - 0.032);
      tailGroup.add(post);
      addTailGlow(sx, d.tailY, tz, 0.5, 0.5);
    }
  } else {
    // Two wrap-around housings with lens + core, split by the boot lid.
    // The housing keeps its width unless the tail is too narrow to hold
    // it with the pad AND a hand's width of paint between the pair.
    const w = Math.min(0.78, tailHalf - TAIL_PAD - 0.14);
    const hc = tailHalf - TAIL_PAD - w / 2;
    for (const sxSign of [-1, 1]) {
      const sx = sxSign * hc;
      const tz = tailAt(sx);
      const housing = new THREE.Mesh(roundedBox(w, 0.17, 0.05, 0.03), housingMat);
      housing.position.set(sx, d.tailY, tz - 0.005);
      tailGroup.add(housing);
      const lens = new THREE.Mesh(roundedBox(w - 0.08, 0.11, 0.06, 0.02), tailMat);
      lens.position.set(sx, d.tailY, tz - 0.015);
      tailGroup.add(lens);
      const core = new THREE.Mesh(roundedBox(w - 0.16, 0.04, 0.05, 0.015), tailCoreMat);
      core.position.set(sx, d.tailY, tz - 0.032);
      tailGroup.add(core);
      addTailGlow(sx, d.tailY, tz, 0.7, 0.4);
    }
  }
  };
  buildTail(bGeo, "");
  group.userData.refitShell = (geo: THREE.BufferGeometry) => {
    for (const o of [...tailGroup.children]) {
      tailGroup.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
    }
    tailGlowMats.length = 0;
    buildTail(geo, ":authored");
  };

  // High-mount third brake light: sedan/gtr at the rear-glass base, and
  // for the gtr a second element in the wing itself; zx on the fastback.
  {
    const cherry = new THREE.Mesh(roundedBox(0.5, 0.035, 0.05, 0.015), tailMat);
    // On the fastbacks it sits on the bodywork itself, which arches
    // 100-160 mm above the profile line it was pinned to; on the sedan
    // and gtr it sits at the base of the rear glass, well above the
    // shell, so those two keep their measured heights.
    if (style === "zx") cherry.position.set(0, (deckY(bGeo, style, -1.98) ?? 0.86) + 0.02, -1.98);
    else if (style === "rx7") cherry.position.set(0, (deckY(bGeo, style, -1.86) ?? 0.8) + 0.02, -1.86);
    else if (style === "gtr") cherry.position.set(0, d.deckY + 0.05, -1.7);
    else cherry.position.set(0, 1.36, -1.28);
    cherry.rotation.x = bCabBack ? -0.5 : -0.2;
    group.add(cherry);
  }

  // ------------------------------------------------------------- the face
  //
  // The aperture, what is behind it, and what frames it — each part BENT
  // ONTO the nose (onNose), its front a few millimetres off the skin
  // right behind it.
  //
  // It used to be sunk INTO the nose: the void's front 20 mm behind the
  // skin and the mesh 19 mm behind it, on the idea that you would see
  // into the aperture. You would, through a hole — and the body shell has
  // no hole in it. Measured by firing rays straight at each part from in
  // front of the car, 13 of the 17 cars showed 0% of their aperture and
  // 0% of their mesh; what you saw of the "grille" was the surround's
  // proud edge and a badge floating on bare paint. So the depth is built
  // the other way: the void is a dark panel ON the skin, the mesh stands
  // in front of it, the surround in front of that, and the badge last —
  // all inside the 5 mm the face may stand off the paint (test:faces).
  //
  // Built as a unit that can be rebuilt, for the reason the tail lamps
  // are: the shell this is fitted to is the extrude, and hero cars swap
  // in an authored loft once its file lands (models.ts, refitShell).
  // The face as recorded, FITTED to the nose it is built on.
  //
  // A record says how big a mouth is; it cannot know what else the nose
  // is carrying. On the low noses — super and pony — the headlamp package
  // runs nearly the full width at 290-480 mm and the splitter stands clear
  // of the nose at 175-225 mm, which leaves a band about 65 mm tall. The
  // Storm S8 wears "the big saloon's face", 1.3 x 0.26 m, on the super
  // body: measured from ahead, 27% of its aperture could be seen, the
  // rest behind the lamps and the splitter. So the mouth is fitted into
  // the band that is actually free — shrunk and re-centred, and if the
  // band is too thin for a frame, framed by nothing rather than buried.
  // What changed is recorded on the car (userData.faceFit).
  const faceSpec = ((): FaceSpec => {
    const want = colors.face ?? FACE_FALLBACK[style] ?? FACE_FALLBACK.sedan;
    const T = faceReach(want.h, want.surround);
    const cy = d.grilleY + (want.dy ?? 0);
    const half = want.w / 2 + T;
    let top = Infinity;
    const bottom = cy - want.h / 2 - T;
    const wasTop = cy + want.h / 2 + T;
    group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as THREE.Material | undefined)?.name;
      if (name !== "lamp-housing" && name !== "headlamp-lens") return;
      box.setFromObject(mesh);
      if (box.min.z < d.nose - 0.6) return; // a tail lamp
      if (box.max.x < -half || box.min.x > half) return;
      if (box.max.y < bottom || box.min.y > wasTop) return;
      // Only a lamp ABOVE the mouth's centre can be cleared by lowering
      // its top; one that spans it cannot be fitted around.
      if (box.min.y > cy - want.h / 4) top = Math.min(top, box.min.y - 0.015);
    });
    // The free band: above the splitter, below any lamp the mouth ran
    // into. Moved first — kept at its recorded size and slid as little as
    // it takes to clear both — and shrunk only when the band is smaller
    // than the mouth. The saloons' mouths ran 40-50 mm up into their
    // headlamp pans and had room to spare below; shrinking them was the
    // wrong fix, and the first cut of this did exactly that.
    const floor = SPLITTER_TOP + 0.01;
    const ceiling = top;
    const need = want.h + 2 * T;
    const was = { top: cy + want.h / 2 + T, bottom: cy - want.h / 2 - T };
    if (was.bottom >= floor - 1e-6 && was.top <= ceiling + 1e-6) return want;
    let fitted: FaceSpec;
    let how: string;
    if (ceiling - floor >= need) {
      const c = Math.min(Math.max(cy, floor + need / 2), ceiling - need / 2);
      fitted = { ...want, dy: c - d.grilleY };
      how = `${c > cy ? "up" : "down"} ${Math.round(Math.abs(c - cy) * 1000)} mm`;
    } else if (ceiling - floor - 2 * T >= 0.05) {
      fitted = { ...want, h: ceiling - floor - 2 * T, dy: (ceiling + floor) / 2 - d.grilleY };
      how = `${Math.round(want.h * 1000)} -> ${Math.round(fitted.h * 1000)} mm tall`;
    } else {
      // Unframed, the aperture reaches its own rounding past its edge.
      const h = Math.max(0.04, ceiling - floor - 2 * 0.018);
      fitted = { ...want, h, dy: (ceiling + floor) / 2 - d.grilleY, surround: "none" };
      how = `${Math.round(want.h * 1000)} -> ${Math.round(h * 1000)} mm tall`;
      if (want.surround !== "none") {
        (group.userData.faceOmitted ??= []).push(`surround: no room for a ${want.surround} frame`);
      }
    }
    group.userData.faceFit = how;
    return fitted;
  })();
  const faceGroup = new THREE.Group();
  faceGroup.name = "face";
  group.add(faceGroup);
  /** How far each layer's front stands off the skin, metres. */
  const PROUD = { void: 0.0015, mesh: 0.0035, surround: 0.0045, badge: 0.005 } as const;
  /** Every face part's footprint as seen from ahead, [x0, x1, y0, y1], so
   *  the trim built after the face can keep out of the way of it. */
  const faceRects: Array<[number, number, number, number]> = [];
  /** Parts the record asked for that there is no room to build, and why. */
  const faceOmitted: string[] = (group.userData.faceOmitted ??= []);
  const badgeY = d.grilleY + (faceSpec.dy ?? 0);
  const badgeBehindPlate = Math.abs(badgeY - PLATE_Y) < (PLATE_H_M + 0.1) / 2;
  const buildFace = (geo: THREE.BufferGeometry, tag: string) => {
    const f = faceSpec;
    const y = d.grilleY + (f.dy ?? 0);
    const fallback = noseFaceZ(geo, style, y, true) ?? d.nose;
    const place = (
      src: THREE.BufferGeometry,
      key: string,
      mat: THREE.Material,
      cx: number,
      cy: number,
      proud: number,
      role: string
    ) => {
      const m = new THREE.Mesh(onNose(src, key, geo, style, tag, cx, cy, proud, fallback), mat);
      m.userData.face = role;
      if (!tag) {
        src.computeBoundingBox();
        const b = src.boundingBox!;
        faceRects.push([cx + b.min.x, cx + b.max.x, cy + b.min.y, cy + b.max.y]);
      }
      faceGroup.add(m);
      return m;
    };
    // The void: a dark panel on the skin, the shadow the mesh sits in.
    if (f.pattern !== "open") {
      place(roundedBox(f.w, f.h, 0.05, 0.018), `void|${f.w}|${f.h}`, apertureMat, 0, y, PROUD.void, "aperture");
    }
    const bars = grillePattern(f.pattern, f.w - 0.03, f.h - 0.03, f.pitch);
    if (bars) {
      place(bars, `bars|${f.pattern}|${f.w}|${f.h}|${f.pitch}`, meshMat, 0, y, PROUD.mesh, "mesh");
    }
    // The surround. A frame, not a bar across the top: a mouth with a
    // line over it is a mouth with a line over it, and a mouth with an
    // edge all the way round is a mouth.
    if (f.surround !== "none") {
      const mat =
        f.surround === "chrome" ? chromeLocal : f.surround === "carbon" ? carbonMat : bodyMat;
      const T = 0.026;
      const DEPTH = 0.055;
      for (const [w, h, ox, oy] of [
        [f.w + T * 2, T, 0, f.h / 2 + T / 2],
        [f.w + T * 2, T, 0, -f.h / 2 - T / 2],
        [T, f.h, -f.w / 2 - T / 2, 0],
        [T, f.h, f.w / 2 + T / 2, 0],
      ] as const) {
        place(roundedBox(w, h, DEPTH, 0.008), `frame|${w}|${h}`, mat, ox, y + oy, PROUD.surround, "surround");
      }
    }
    // Brake ducts. Two small mouths outboard of the main one, at the
    // same height — the single cue that says a car was built to be
    // driven hard rather than to look like it was.
    if (f.ducts) {
      const dw = 0.19, dh = Math.min(0.13, f.h * 0.72);
      const dm = grillePattern("mesh", dw - 0.03, dh - 0.03, 0.032);
      for (const sx of [-1, 1] as const) {
        const x = sx * (f.w / 2 + 0.16);
        place(roundedBox(dw, dh, 0.05, 0.016), `duct|${dw}|${dh}`, apertureMat, x, y, PROUD.void, "duct");
        if (dm) place(dm, `ductmesh|${dw}|${dh}`, meshMat, x, y, PROUD.mesh, "duct-mesh");
      }
    }
    // The lower mouth, at splitter height. Wider than the upper one on
    // every car that has both, because that is where the air actually
    // goes on anything made after about 1995.
    //
    // Between the splitter and the grille, not across the splitter. It
    // was built at splitter height, and the splitter is a lip standing
    // 160 mm clear of the nose across exactly that band: from ahead,
    // every lower mouth in the game measured 0% visible. Where the
    // grille itself already sits down at the splitter there is no room
    // for a second mouth, and the car says so rather than burying one.
    if (f.lower) {
      const upperBottom = y - f.h / 2 - faceReach(f.h, f.surround) - 0.02;
      const top = Math.min(y - f.h / 2 - 0.08, upperBottom);
      // The mouth's own rounding (16 mm) grows it past both edges.
      const bottom = SPLITTER_TOP + 0.01 + 0.016;
      const lh = Math.min(0.1, top - 0.016 - bottom);
      if (lh >= 0.045) {
        const ly = bottom + lh / 2;
        const lw = f.w * 1.18;
        place(roundedBox(lw, lh, 0.05, 0.016), `lower|${lw}|${lh.toFixed(3)}`, apertureMat, 0, ly, PROUD.void, "lower");
        const lm = grillePattern("mesh", lw - 0.03, lh - 0.02, 0.036);
        if (lm) place(lm, `lowermesh|${lw}|${lh.toFixed(3)}`, meshMat, 0, ly, PROUD.mesh, "lower-mesh");
      } else if (!tag) {
        faceOmitted.push(`lower: ${Math.round(Math.max(0, top - bottom) * 1000)} mm between the splitter and the grille`);
      }
    }
    // The badge sits in the middle of the mouth — unless the number
    // plate hangs over the middle of the mouth, which on a car whose
    // grille has had to slide down clear of its headlamps it does. A
    // badge behind a plate is not a badge; the car wears its roundel on
    // the nose instead (see the detailing below), the way cars with a
    // low mouth do.
    if (f.badge && !badgeBehindPlate) {
      place(roundedBox(0.1, 0.1, 0.03, 0.03), "badge", chromeLocal, 0, y, PROUD.badge, "badge");
    } else if (f.badge && !tag) {
      faceOmitted.push("badge: behind the number plate; worn on the nose instead");
    }
    if (style === "hatch") {
      // The stripe across the nose. Every fast version of a hatch has
      // worn one since the seventies, and it is the single cue that
      // separates the quick one from the shopping one at a distance.
      const sy = y + f.h / 2 + 0.05;
      const stripe = new THREE.Mesh(
        onNose(roundedBox(1.44, 0.035, 0.05, 0.012), "stripe", geo, style, tag, 0, sy, 0.002, fallback),
        hotStripeMat
      );
      faceGroup.add(stripe);
    }
  };
  buildFace(bGeo, "");
  {
    // Chain onto the tail's refit rather than replacing it: both are
    // fitted to the extrude and both have to move to the authored skin.
    const refitTail = group.userData.refitShell as ((g: THREE.BufferGeometry) => void) | undefined;
    group.userData.refitShell = (geo: THREE.BufferGeometry) => {
      refitTail?.(geo);
      // The face's geometry is cached and shared between cars, so it is
      // detached here, never disposed.
      for (const o of [...faceGroup.children]) faceGroup.remove(o);
      buildFace(geo, ":authored");
    };
  }
  // Plates hang on the bumper faces. The anchors are the profile's
  // corner points, and the bumper bows out past them by up to 40 mm, so
  // "anchor plus 20" left the front plate inside the FD's nose.
  for (const front of [true, false]) {
    const face = noseFaceZ(bGeo, style, PLATE_Y, front);
    const z =
      face !== null ? face + (front ? 0.008 : -0.008) : front ? d.nose + 0.02 : d.tail - 0.03;
    const plate = new THREE.Mesh(faceUV(roundedBox(PLATE_W_M, PLATE_H_M, 0.02, 0.007), PLATE_W_M, PLATE_H_M), plateMat(colors));
    plate.position.set(0, PLATE_Y, z);
    group.add(plate);
  }
  // --- Exhaust.
  //
  // Stock keeps whatever arrangement the body style was drawn with — the
  // R34's big bores, the FD's single rotary can, the Z's pair on the left.
  // An aftermarket system replaces all of that with its own, because a
  // system you can hear and not see is half a purchase.
  //
  // The tips also decide where the backfire comes from. That used to be a
  // hardcoded pair at x +-0.34, z -2.08 — which is not where any of these
  // styles put a pipe, and 30 cm forward of the bumper besides, so the
  // flame lit up underneath the boot floor.
  {
    const ex = colors.exhaust ?? EXHAUSTS.stock;
    let xs: number[];
    let r: number;
    let len: number;
    let y: number;
    let mat: THREE.Material;
    let shape: "round" | "square" | "oval" = "round";
    let perSide = 1;
    if (ex.id !== "stock") {
      // Where the CLUSTERS sit, not where the tubes sit. A twin-tube
      // system is one exit split in two, so it hangs two pipes off each
      // of two positions rather than punching four separate holes
      // across the bumper — which is the difference between a car with
      // a split system and a car with four exhausts.
      const clusters = ex.tips / ex.perSide;
      xs =
        clusters === 4
          ? [-0.64, -0.42, 0.42, 0.64]
          : clusters === 1
            ? [-0.5]
            : [-0.5, 0.5];
      r = ex.bore;
      len = 0.24;
      y = 0.26;
      shape = ex.shape;
      perSide = ex.perSide;
      mat =
        ex.finish === "chrome"
          ? chromeLocal
          : ex.finish === "ceramic"
            ? ceramicTipMat
            : ex.finish === "titanium"
              ? titaniumTipMat
              : grilleMat;
    } else if (style === "gtr") {
      xs = [-0.55, 0.55]; r = 0.08; len = 0.22; y = 0.26; mat = chromeLocal;
    } else if (style === "rx7") {
      xs = [-0.5]; r = 0.09; len = 0.24; y = 0.26; mat = chromeLocal;
    } else if (style === "zx") {
      xs = [-0.55, -0.36]; r = 0.057; len = 0.2; y = 0.25; mat = chromeLocal;
    } else {
      xs = [-0.45, 0.45]; r = 0.052; len = 0.18; y = 0.27; mat = grilleMat;
    }
    const z = d.tail + 0.02;
    const origins: THREE.Vector3[] = [];
    /**
     * One tip. Round is a cylinder; square is the same tube with four
     * sides and a chamfer instead of a radius, which is what a squared
     * tip actually is — a rolled edge on a rectangular section, not a
     * box stuck on a pipe. Oval is a cylinder squashed on one axis.
     */
    // An exhaust tip is a TUBE, and every one of these was a solid peg.
    //
    // CylinderGeometry is capped by default, so the mouth was a flat
    // metal disc facing the camera. That is the one part of the car a
    // player looks at for the whole race — you spend it behind your own
    // bumper or behind a rival's — and it read as a stud screwed into
    // the valance rather than as something an engine breathes through.
    //
    // Three parts now: an open outer wall, an inner wall seen from
    // inside it, and a blind floor a little way down. The bore is only
    // built for cars that get detailing; nobody is ever close enough to
    // a traffic car to look down its exhaust, and there are 46 of them.
    const SEG = shape === "oval" ? 18 : 14;
    const bore = r * 0.78;
    const tip = (px: number, py: number): void => {
      let geo: THREE.BufferGeometry;
      if (shape === "square") {
        // A rounded box, so the mouth catches the same specular line a
        // real rolled edge does. Slightly wider than tall, like every
        // squared tip ever fitted to anything.
        geo = roundedBox(r * 2.1, r * 1.55, len, Math.min(r * 0.34, 0.022), 3);
      } else {
        geo = new THREE.CylinderGeometry(r, r * 1.1, len, SEG, 1, !colors.simple);
        geo.rotateX(Math.PI / 2);
        if (shape === "oval") geo.scale(1.5, 0.72, 1);
      }
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, z);
      if (!colors.simple) {
        // The inner wall. Slightly shorter than the outer so the rolled
        // lip of the mouth stays the outer material rather than turning
        // black right at the edge.
        const wall = new THREE.Mesh(
          new THREE.CylinderGeometry(bore, bore, len * 0.92, SEG, 1, true),
          boreMat
        );
        wall.geometry.rotateX(Math.PI / 2);
        if (shape === "oval") wall.geometry.scale(1.5, 0.72, 1);
        wall.position.set(px, py, z + len * 0.04);
        group.add(wall);
        // The blind end, set back down the tube. Depth is what sells it:
        // flush with the mouth it is a black sticker, and a tube you can
        // see through is a hole in the car.
        const floor = new THREE.Mesh(new THREE.CircleGeometry(bore, SEG), boreCapMat);
        if (shape === "oval") floor.geometry.scale(1.5, 0.72, 1);
        // Turned to face OUT of the pipe. A circle's normal is +Z and
        // the tail is at -Z, so an unturned floor shows the camera its
        // back face, gets culled, and the tube reads as a hole through
        // the car — which is worse than the solid peg it replaced.
        floor.rotation.y = Math.PI;
        floor.position.set(px, py, z + len * 0.42);
        group.add(floor);
      }
      // Tagged so the mod test can read the finish off the mesh that was
      // actually built, rather than fishing for a cylinder of the right
      // height — which missed the stock pipes entirely and reported their
      // finish as null.
      m.userData.exhaustPipe = true;
      m.userData.tipShape = shape;
      group.add(m);
      // Just outside the exit face, which is the tail-most end of the pipe.
      origins.push(new THREE.Vector3(px, py, z - len / 2 - 0.04));
    };
    for (const sx of xs) {
      if (perSide === 2) {
        // Stacked rather than side by side: a split system runs one tube
        // over the other out of a single hanger, and stacked is also the
        // only way two tubes fit behind a bumper cut for one.
        tip(sx, y + r * 1.15);
        tip(sx, y - r * 1.15);
      } else {
        tip(sx, y);
      }
    }
    group.userData.exhaustTips = origins;
  }

  // --- Roof furniture: a glass sunroof inset, slim side rails along the
  // panel edges, and an antenna. The bare painted rectangle up top was
  // the last place the car still looked like a toy from above.
  {
    const [rz, ry] = d.roof;
    const sunroofZ = rz + (bCabBack ? 0.28 : 0.18);
    // A crew car wears its colours on the roof, and the roof is not big
    // enough for both. Measured: the panel runs 0.88 m on a Z32 and
    // 1.10 m on an R34, the sunroof eats 0.62 of it, and the R34 puts a
    // shark fin in the 0.22 m behind that — which leaves 0.12 m for an
    // emblem, i.e. a postage stamp. Racing a crew's colours is a choice
    // the player makes deliberately, so it takes the whole panel and the
    // glass roof is what it costs.
    if (!colors.crew || colors.simple) {
      const sunroof = new THREE.Mesh(roundedBox(0.72, 0.02, 0.62, 0.015), glassLocal);
      // On the roof's measured surface, like the rails below it. Seated on
      // the roof ANCHOR — the profile's top line — the glass sat 26 mm
      // under the paint on the saloons and never appeared.
      sunroof.position.set(
        0,
        (deckY(rGeo, style, sunroofZ, "roof") ?? ry) - 0.008,
        sunroofZ
      );
      group.add(sunroof);
    }
    // Roof rails, and only on the saloon roof. They were pinned to the
    // roof anchor, which is the profile's top line — the extrusion's
    // bevel lifts the painted surface ~50 mm above it, so they sat
    // inside the paint on every car in the fleet. Seating them on the
    // measured surface fixes the saloon; on the three sports bodies it
    // makes the problem visible instead, because a fastback roof falls
    // away under a straight rail and it ends up hovering over the glass.
    // A Z32, an FD and an R34 do not have roof rails. So they don't now.
    if (style === "sedan") {
      rGeo.computeBoundingBox();
      const roofBox = rGeo.boundingBox!;
      // Sampled at the rail's own midpoint rather than at the roof's
      // highest point, which is not the same place on a curved panel.
      const seat = deckY(rGeo, style, rz, "roof") ?? roofBox.max.y;
      for (const sxSign of [-1, 1]) {
        const rail = new THREE.Mesh(roundedBox(0.035, 0.025, 1.0, 0.012), housingMat);
        rail.position.set(sxSign * (roofBox.max.x - 0.075), seat + 0.006, rz);
        group.add(rail);
      }
    }
    /** The forward face of anything already standing on the roof. */
    let roofClutterZ = -Infinity;
    if (style === "gtr") {
      // Shark fin at the trailing edge of the roof
      const fin = new THREE.Mesh(roundedBox(0.035, 0.1, 0.22, 0.012), bodyMat);
      fin.position.set(0, ry + 0.04, rz - 0.42);
      fin.rotation.x = -0.25;
      group.add(fin);
      // Measured, not derived. The fin leans back 0.25 rad and carries a
      // 12 mm bevel, so where its nose actually ends is not rz - 0.42
      // plus half of anything — and 6 mm was all the room the crew decal
      // had left beside it when that was assumed rather than asked.
      fin.updateMatrix();
      fin.geometry.computeBoundingBox();
      roofClutterZ = fin.geometry.boundingBox!.clone().applyMatrix4(fin.matrix).max.z;
    } else if (style === "zx") {
      // Period-correct power antenna on the rear quarter
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.42, 6), chromeLocal);
      mast.position.set(0.82, 1.0, -1.86);
      mast.rotation.x = 0.16;
      group.add(mast);
    }

    // --- The crew's colours.
    //
    // The top of teams.ts has promised "a decal baked onto the car's
    // roof" since the file was written, and it had never been built: a
    // crew lived in the hub server's memory, showed up on one lobby
    // card, and no part of the game the player actually drives had heard
    // of it. This is that decal.
    if (colors.crew && !colors.simple) {
      rGeo.computeBoundingBox();
      const roofBox = rGeo.boundingBox!;
      // Fitted to the clear run of panel it lies on rather than to a
      // fixed number: the roofs are 0.88 to 1.40 m long, and on the R34
      // the shark fin takes the back of one. 4:5, emblem over name.
      const rear = Math.max(roofBox.min.z + 0.07, roofClutterZ + 0.04);
      const front = roofBox.max.z - 0.07;
      const depth = Math.min(0.72, front - rear, (roofBox.max.x - 0.05) * 2 * 1.25);
      const width = depth * 0.8;
      const zc = (rear + front) / 2;
      const HALF = depth / 2;
      // A roof crowns across AND along. Levelled against its own two
      // ends, the same way the bonnet decal is, or it sinks into the
      // middle of the panel at one end and lifts off it at the other.
      const yBack = deckY(rGeo, style, zc - HALF, "roof") ?? ry;
      const yFront = deckY(rGeo, style, zc + HALF, "roof") ?? ry;
      const yMid = deckY(rGeo, style, zc, "roof") ?? ry;
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        decalMat(crewDecalTexture(colors.crew.logo, colors.crew.tag, colors.crew.name))
      );
      plaque.rotation.z = Math.PI; // reads upright from the chase camera
      plaque.rotation.x = -Math.PI / 2 + Math.asin(Math.min(0.6, (yBack - yFront) / depth));
      plaque.position.set(
        0,
        Math.max((yBack + yFront) / 2, yMid) + 0.006,
        zc
      );
      group.add(plaque);
      group.userData.crewDecal = plaque;
    }
  }

  // Side mirrors.
  //
  // Anchored to the flank rather than to an absolute number. The x in
  // StyleDims is now how far PROUD of the bodyside the mirror sits, not
  // where it is — so narrowing a body brings its mirrors in with it
  // instead of leaving them hanging in space, and every silhouette gets
  // the same 90 mm of stalk whatever its width. Over-mirror width is
  // what a driver actually has to thread through a gap, and it was the
  // widest thing on every car in the fleet.
  for (const sxSign of [-1, 1]) {
    const mirror = new THREE.Mesh(roundedBox(0.16, 0.1, 0.2, 0.035), bodyMat);
    mirror.position.set(sxSign * (flankX + d.mirror[0]), d.mirror[1], d.mirror[2]);
    group.add(mirror);
  }

  // Wheels with arches; fronts steer, all spin (engine drives userData.wheels)
  const wheels: THREE.Group[] = [];
  // Where the axles are. A pickup's wheelbase is the longest thing about
  // it — 3.2 m under a 5.35 m body against a saloon's 2.84 under 4.7 —
  // and it is most of what makes a truck read as a truck from the side:
  // the front wheel is right under the cab and there is a long flat run
  // of body behind the rear one.
  const wzF =
    style === "super" ? 1.36 : style === "pickup" ? 1.62 : style === "suv" ? 1.5 : style === "zx" ? 1.52 : style === "gtr" || style === "rx7" ? 1.45 : 1.42;
  const wzR =
    style === "super" ? -1.4 : style === "pickup" ? -1.58 : style === "suv" ? -1.46 : style === "zx" ? -1.48 : style === "gtr" || style === "rx7" ? -1.45 : -1.42;

  /**
   * How long a feature running along the flank is allowed to be.
   *
   * The character line, the beltline and the rocker are panel features:
   * they run between the wheel arches and butt into them. They were
   * fixed at 2.7 and 3.1 m regardless of where the wheels are, so on the
   * short-wheelbase bodies they carried straight on across the arches —
   * 0.41 m into the Zeta's front arch and 0.62 m into its rear one,
   * which is what made the car look like it had two rails bolted down
   * its side.
   *
   * An arch is a circle, so where it starts depends on the height of the
   * feature meeting it: the rocker runs into it half a metre from the
   * wheel centre, the beltline only a quarter of one — and on the taller
   * saloon the beltline clears the arches entirely and is free to run
   * almost the whole flank. One rule gives all three of those.
   */
  const archReach = (edge: number, y: number): number => {
    const dy = Math.abs(y - ARCH_Y);
    return dy >= edge ? 0 : Math.sqrt(edge * edge - dy * dy);
  };
  const FLANK_GAP = 0.03; // panel gap where the feature meets the arch
  /** [length, centre z] for a flank feature at height y. */
  const flankRun = (y: number): [number, number] => {
    const back = wzR + archReach(ARCH_EDGE_R, y) + FLANK_GAP;
    const front = wzF - archReach(ARCH_EDGE_F, y) - FLANK_GAP;
    return [Math.max(0.2, front - back), (front + back) / 2];
  };

  /**
   * How far out the wheels sit.
   *
   * This was 0.84 on every body, which is the number the SALOON wants.
   * The arch opening is drawn on the body's own surface, so on the wider
   * shells it moved outboard with the paint while the wheels stayed put,
   * and the black arch interior came up flush with the tyre: 45 mm of
   * tyre stood proud of it on the saloon, 5 mm on the zx, and on the gtr
   * the opening was 15 mm IN FRONT of the tyre. That is why the Zeta's
   * wheels read as an alloy floating on a flat black hole — there was no
   * tyre left to see, and nothing to give the arch any depth.
   *
   * Held 80 mm inboard of the flank, every car keeps the saloon's
   * relationship: tyre 45 mm proud of the opening, alloy 68 mm proud.
   *
   * The kit then pushes it back out to fill the arch it just gained. A
   * wide arch over a standard track is the one way to make a car look
   * WORSE than it did before the kit: the flare hangs over nothing and
   * the tyre sits at the bottom of a tunnel.
   */
  const wide = WIDE[kit];
  const wheelX = flankX - 0.08 + wide.track;
  /**
   * Where the wheels go, and how big each one is.
   *
   * Four in the usual order — (-x front, +x front, -x rear, +x rear) —
   * or three in a delta: one steering wheel on the centreline and two
   * driving wheels at the back, bigger than it. A trike carries almost
   * all of its weight and all of its drive on the rear pair, and the
   * back tyre being visibly the bigger one is most of what makes the
   * shape read as deliberate rather than as a car missing a wheel.
   *
   * The third number is a radius multiplier. buildWheel has no size
   * parameter and does not need one: a wheel is a self-contained group,
   * so scaling it scales the tyre, the rim and the sidewall lettering
   * together, and the only other thing that has to follow is how high
   * the hub sits.
   */
  const TRIKE_FRONT_R = 0.86;
  const TRIKE_REAR_R = 1.2;
  const layout: Array<[number, number, number]> = colors.trike
    ? [
        [0, wzF, TRIKE_FRONT_R],
        [-wheelX, wzR, TRIKE_REAR_R],
        [wheelX, wzR, TRIKE_REAR_R],
      ]
    : [
        [-wheelX, wzF, 1],
        [wheelX, wzF, 1],
        [-wheelX, wzR, 1],
        [wheelX, wzR, 1],
      ];
  /** How many of the above steer. The rest drive. */
  const frontCount = colors.trike ? 1 : 2;
  for (const [wx, wz, rMul] of layout) {
    const wheelFinish = wheelFinishFor(colors, kit);
    const wheel = buildWheel(wheelFinish, Math.sign(wx), {
      sticker: colors.tyreSticker,
      detailed: !colors.simple,
      // A bought finish overrides the material; a hubcap does not take
      // one, because the point of it is that nothing was bought.
      spokeMat: wheelFinish === "steel" ? undefined : spokeLocal,
    });
    // Scaled as a unit, and the hub raised to sit on the road at its own
    // radius rather than at the fleet's. A wheel left at TIRE_RADIUS
    // while its tyre grew would be buried; one left there while it
    // shrank would hover.
    if (rMul !== 1) wheel.scale.setScalar(rMul);
    wheel.position.set(wx, TIRE_RADIUS * rMul, wz);
    // How much bigger or smaller than the car's own wheelR this one is —
    // a MULTIPLIER, not a radius. wheelR is already in world units and
    // was arrived at by a length fit; recomputing an absolute radius here
    // would quietly re-derive it from the group scale and change the
    // rolling rate of every four-wheeled car in the game to fix a
    // three-wheeler.
    if (rMul !== 1) wheel.userData.rMul = rMul;
    group.add(wheel);
    wheels.push(wheel);
    // A wheel on the centreline has no flank to cut an arch into. The
    // opening below is placed at +/-flankX, so on a centre wheel it
    // would appear on both sides of a car that has no wheel there.
    if (Math.abs(wx) < 0.2) continue;

    // The opening, then the lip around it — both on the body's surface,
    // not at the wheel's centre where they were invisible.
    const front = wz > 0;
    const side = Math.sign(wx);
    const well = new THREE.Mesh(front ? archWellGeoF : archWellGeo, wellMat);
    well.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    well.position.set(side * (flankX + ARCH_OUT), ARCH_MESH_Y, wz);
    well.userData.archWell = true;
    group.add(well);

    // Body-coloured, so it reads as the panel's own edge rather than as
    // a black ring stuck around the wheel — WHERE IT CAN BE SEEN.
    //
    // The over-fender below is a tube of radius `tube` centred at
    // flankX + proud - tube, so it occupies everything from
    // flankX + proud - 2*tube outwards. The lip sits at flankX +
    // LIP_OUT, which is 11.5 mm — inside that span for every kit in the
    // game, street included. So the lip has been drawn inside the flare
    // on every car ever built here: tools/shots/audit-cars.mjs found it
    // as a 1440-triangle torus that never paints a pixel, once or twice
    // per car, and it was most of 81 invisible meshes across the fleet.
    //
    // Not deleted, because the lip is the right piece when nothing
    // covers it. Skipped when something does.
    const flareTube = wide.proud * FLARE_TUBE_FRAC;
    const flareInner = wide.proud - 2 * flareTube;
    const lipR = front ? 0.021 : 0.016;
    if (!(LIP_OUT + lipR <= wide.proud && LIP_OUT - lipR >= flareInner)) {
      const lip = new THREE.Mesh(front ? archLipGeoF : archLipGeo, bodyMat);
      lip.position.set(side * (flankX + LIP_OUT), ARCH_MESH_Y, wz);
      group.add(lip);
      lip.userData.archLip = true;
    }

    // The over-fender.
    //
    // Still not a box. A rounded box laid over the arch does not follow
    // it — it sits across the top with two hard ends and reads as
    // scaffolding. So the flare is the lip's own shape again: the same
    // radius, the same half-turn, a fatter tube and further out. Two
    // arcs that agree about where the wheel is read as one fender with
    // an edge rolled over it, which is what a flare is.
    const tube = flareTube;
    const flare = new THREE.Mesh(flareGeo(kit, front), bodyMat);
    flare.position.set(side * (flankX + wide.proud - tube), ARCH_MESH_Y, wz);
    flare.userData.archFlare = true;
    group.add(flare);

    // Rivets, on the kits that bolt their arches on rather than bonding
    // them. They are the tell: a moulded flare is smooth and a riveted
    // one is a row of heads following the curve, and at ten metres the
    // row is the only part of it you can actually see.
    if (wide.rivets && !colors.simple) {
      const R = front ? ARCH_R_F : ARCH_R_R;
      for (let i = 0; i < wide.rivets; i++) {
        // Inset from both ends: a rivet on the very end of the arc sits
        // where the flare has already died back into the door.
        const a = ((i + 0.5) / wide.rivets) * Math.PI;
        const rivet = new THREE.Mesh(rivetGeo, seamMat);
        // ON the fender, not in it. The flare's outermost skin is at
        // flankX + proud; this used to sit at proud - 0.15*tube, which
        // is 0.85 of a tube radius UNDER that skin — 53 mm inside the
        // arch on an attack kit, against an 11 mm rivet. Every rivet on
        // every car in the game was buried in the panel it was meant to
        // be bolted through, which is why the audit counted them by the
        // dozen as geometry that never paints a pixel. Seated with most
        // of the head proud, the way a fastener sits.
        rivet.position.set(
          side * (flankX + wide.proud - RIVET_R * 0.35),
          ARCH_MESH_Y + R * Math.sin(a),
          wz - R * Math.cos(a)
        );
        group.add(rivet);
      }
    }
  }

  // --- Bumper assemblies: a black lower valance front and rear so the
  // bumpers read as fitted parts, amber corner reflectors up front and
  // red ones behind — the details every road car actually carries.
  {
    // Seated on the bumper, and as wide as the bumper.
    //
    // Both of these were 1.62 and 1.66 m wide at the profile's nose and
    // tail ANCHOR, plus twenty millimetres. Neither number was a
    // measurement of anything.
    //
    // The anchor is a control point of the 2D profile, and the extrusion
    // carries the painted skin out past it — the comment beside the
    // number plates says exactly this about the same two anchors, "the
    // bumper bows out past them by up to 40 mm". Measured at the height
    // the valance sits at, it is not 40: the skin at the rear runs 125
    // to 180 mm inside where the valance was hung, and at the front up
    // to 424 mm. They were planks floating off each end of the car.
    //
    // And a fixed width fits one silhouette. 1.66 m on bodies whose own
    // half-width runs from 0.9 to 1.04 m covered 83% of the tail on the
    // widest and left a valance visibly narrower than the bumper above
    // it on all of them.
    //
    // So: ask the shell where its skin is at that height, sit the trim's
    // outer face flush with it, and take the width off the flank the
    // same way every other detail on this car does.
    const VALANCE_Y = 0.3;
    const VALANCE_D = 0.1;
    const noseSkinZ = noseFaceZ(bGeo, style, VALANCE_Y, true) ?? d.nose;
    const tailSkinZ = noseFaceZ(bGeo, style, VALANCE_Y, false) ?? d.tail;
    const valanceW = flankX * 2 - 0.14; // inset 70 mm a side, like a real one
    // At the front it stops short of the face. It is a flat bar flush
    // with the skin at 300 mm only, so wherever the nose falls away above
    // or below that it stands proud of the paint — and on the low-nosed
    // cars (the grille sits at 180-470 mm) it ran straight across the
    // mouth, the single biggest thing hiding their grilles. Where the
    // face crosses its band it is two pieces, one each side of it.
    const VALANCE_H = 0.09;
    let faceHalf = 0;
    for (const [x0, x1, y0, y1] of faceRects) {
      if (y1 < VALANCE_Y - VALANCE_H / 2 || y0 > VALANCE_Y + VALANCE_H / 2) continue;
      faceHalf = Math.max(faceHalf, Math.abs(x0), Math.abs(x1));
    }
    const valancePieces: Array<[number, number]> =
      faceHalf > 0 ? [[-valanceW / 2, -faceHalf - 0.03], [faceHalf + 0.03, valanceW / 2]] : [[-valanceW / 2, valanceW / 2]];
    for (const [xa, xb] of valancePieces) {
      if (xb - xa < 0.08) continue;
      const frontValance = new THREE.Mesh(roundedBox(xb - xa, VALANCE_H, VALANCE_D, 0.03), seamMat);
      frontValance.position.set((xa + xb) / 2, VALANCE_Y, noseSkinZ - VALANCE_D / 2);
      frontValance.userData.trim = "valance-front";
      group.add(frontValance);
    }
    const rearValance = new THREE.Mesh(roundedBox(valanceW, 0.1, VALANCE_D, 0.03), seamMat);
    rearValance.position.set(0, VALANCE_Y, tailSkinZ + VALANCE_D / 2);
    rearValance.userData.trim = "valance-rear";
    group.add(rearValance);
    // Corner markers. These were mounted on the nose and tail faces at a
    // fixed inset from the anchor, which buried them 30–60 mm inside the
    // bumper on every silhouette: four meshes per car, on fourteen cars,
    // that never painted a pixel. They are side markers now — out on the
    // flank ahead of the front arch and behind the rear one, where the
    // body runs at full width, which is both where a real car carries
    // them and a place that can be derived from the shell's own bounds
    // instead of guessed per style.
    const markerGeo = roundedBox(0.016, 0.07, 0.16, 0.006);
    for (const sxSign of [-1, 1]) {
      const amber = new THREE.Mesh(markerGeo, amberReflectorMat);
      amber.position.set(sxSign * (flankX + 0.002), 0.5, d.nose - 0.34);
      group.add(amber);
      const red = new THREE.Mesh(markerGeo, reflectorMat);
      red.position.set(sxSign * (flankX + 0.002), 0.5, d.tail + 0.34);
      group.add(red);
    }
  }

  // The contact shadow — all cars, traffic included. Sits above the lane
  // paint (y 0.03) so it darkens markings like a real shadow does.
  // Exposed via userData so the engine can re-parent it off the pitching
  // player body.
  //
  // Sized from THIS car: the body's own extents and its own axles, so a
  // hatch gets a hatch's footprint and a pickup gets a pickup's long
  // wheelbase with a flat run of shadow behind the rear wheel. It used
  // to be one 2.9 x 5.8 m plane for the whole fleet.
  bGeo.computeBoundingBox();
  const bb = bGeo.boundingBox!;
  const { geo: contactG, mat: contactM } = contactPlane(
    style,
    flankX * 2,
    bb.max.z - bb.min.z,
    wzF,
    wzR,
    flankX * 0.92
  );
  const contact = new THREE.Mesh(contactG, contactM);
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.035;
  contact.userData.noShadow = true;
  group.add(contact);
  group.userData.contact = contact;

  // ---- Fine detailing (skipped for traffic to keep draw calls down)
  if (!colors.simple) {
    // Shut lines: hood, doors and trunk. Real panel gaps are dark slots
    // between two lit chamfers, so they get their own near-black material.
    // Every one of these rides on the flank, and every one of them was
    // pinned to 0.925 — five millimetres outside the SEDAN's skin, and
    // 35 to 55 mm inside the skin of the four wide silhouettes. Offsets
    // from the shell's own half-width keep the same relationship to the
    // panel on all of them. Their LENGTHS come from the arches — see
    // flankRun — so each one ends where the wheel opening starts.
    const [creaseLen, creaseZ] = flankRun(d.creaseY);
    const [rockerLen, rockerZ] = flankRun(0.25);

    /**
     * The top of the painted flank at a station: the highest point a ray
     * fired at the side of the car still finds bodywork.
     *
     * The beltline is where paint stops and glass starts, and `beltY` is
     * a number typed per style to say where that is. On the pony it says
     * 0.90 and the body's own top line runs 0.695 to 0.799, so the chrome
     * strip was floating 31 to 119 mm ABOVE the bodywork for the whole
     * length of the car — a brightwork trim with nothing behind it. The
     * flank stripe and the police band get away with the same number
     * because flankRibbon drops any column where it finds no shell; a
     * box does not have that mercy.
     */
    const flankTopY = (z: number, from: number): number => {
      for (let i = 0; i <= 60; i++) {
        const y = +(from - i * 0.01).toFixed(3);
        if (y < 0.2) break;
        if (flankXAt(bGeo, style, y, z, ":top") !== null) return y;
      }
      return from;
    };
    // Clamped, not retyped: beltY is read by the stripe, the police
    // band, the crew mark and the sun band, and all of them sit BELOW
    // it. This moves the one thing that was above the paint.
    const beltProbeZ = flankRun(d.beltY)[1];
    const beltY = Math.min(d.beltY, flankTopY(beltProbeZ, d.beltY) - 0.03);
    const [beltLen, beltZ] = flankRun(beltY);

    /**
     * THE DOOR FURNITURE SITS ON THE DOOR.
     *
     * Everything on the flank was pinned to `flankX` — the body's
     * WIDEST half-width, taken off its bounding box — and then sat at a
     * height and a station where the body is not that wide. A shell
     * tumbles home above the shoulder and tucks under it, and tapers in
     * plan over both overhangs, so the widest point is one line around
     * the middle of the car and nothing else is on it.
     *
     * Measured, before this, on the built cars:
     *
     *   shutlines    55 to 258 mm outside the paint
     *   handles      61 to 231 mm outside the paint
     *
     * On the saloon the flank at the shutline's own height is at 0.781
     * and the shutline was at 0.933: a door gap floating 152 mm off the
     * door, and a handle you could not have reached from inside the
     * car. The previous pass on this block moved them off a hard-coded
     * 0.925 and onto `flankX`, which fixed the difference BETWEEN
     * silhouettes and left the error within each one untouched — the
     * comment above still describes that change.
     *
     * So ask the shell, the way the tail lamps already do (buildTail →
     * flankXAt) and the belt stripe already does (flankRibbon). One ray
     * per detail, at the detail's own height and station.
     */
    const flankAt = (y: number, z: number, out: number): number => {
      const x = flankXAt(bGeo, style, y, z, ":flank") ?? flankX;
      return x + out;
    };

    /**
     * ...and a car has as many doors as it has doors.
     *
     * Two shutlines and TWO HANDLES went on every side of every car in
     * the fleet — on the coupes, on the three-door hatch, and on the
     * half-tonne single cab, whose second door line landed out in the
     * load bed. Seven of the nine silhouettes were wearing a rear door
     * they do not have, and this file names them itself: "four doors'
     * worth of flank" for the saloon, "Half-tonne single cab", "the
     * shape a fast three-door has had for fifty years", "R34-style
     * coupe", "the American pony coupe".
     *
     * Derived rather than tabulated, so it follows each body instead of
     * being a second set of numbers to keep in step with the first. The
     * door's leading edge comes from `flankRun`, which already knows
     * where the front arch stops; its trailing edge is the B-pillar,
     * which STYLE_DIMS already carries. A four-door splits the run at
     * the pillar into two doors of equal length.
     */
    const FOUR_DOOR = style === "sedan" || style === "suv";
    const SHUT_Y = 0.58;
    const [shutLen, shutMid] = flankRun(SHUT_Y);
    const doorFront = shutMid + shutLen / 2 - 0.02;
    const doorBack = shutMid - shutLen / 2 + 0.02;
    const pillarZ = Math.min(doorFront - 0.3, Math.max(doorBack + 0.3, d.bPillar[2]));
    const cuts = FOUR_DOOR
      ? [doorFront, pillarZ, Math.max(doorBack, pillarZ - (doorFront - pillarZ))]
      : [doorFront, pillarZ];
    // A handle sits near the trailing edge of the door it opens, which
    // is the one place it can be and still be reachable from the seat.
    const handles: number[] = [];
    for (let i = 1; i < cuts.length; i++) handles.push(Math.min(cuts[i] + 0.28, cuts[i - 1] - 0.1));

    for (const sxSign of [-1, 1]) {
      for (const sz of cuts) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.5, 0.012), gapMat);
        // Set so the outer face lands a millimetre proud of the paint
        // rather than the whole 16 mm bar standing on it: a panel gap is
        // a dark slot IN a surface, and one sitting 13 mm out from the
        // door reads as a rib. The millimetre is z-fighting clearance.
        seam.position.set(sxSign * flankAt(SHUT_Y, sz, 0.001 - 0.008), SHUT_Y, sz);
        seam.userData.flank = "shutline";
        group.add(seam);
      }
      // Character line — the crease that runs the flank of every modern
      // car and catches a long highlight as the world slides past
      const crease = new THREE.Mesh(roundedBox(0.035, 0.05, creaseLen, 0.016), bodyMat);
      crease.position.set(sxSign * flankAt(d.creaseY, creaseZ, 0.01), d.creaseY, creaseZ);
      crease.userData.flank = "crease";
      group.add(crease);
      const belt = new THREE.Mesh(roundedBox(0.015, 0.02, beltLen, 0.006), chromeLocal);
      belt.position.set(sxSign * flankAt(beltY, beltZ, 0.005), beltY, beltZ);
      belt.userData.flank = "belt";
      group.add(belt);
      for (const hz of handles) {
        const handle = new THREE.Mesh(roundedBox(0.03, 0.035, 0.14, 0.012), chromeLocal);
        const hy = d.creaseY + 0.08;
        handle.position.set(sxSign * flankAt(hy, hz, 0.005), hy, hz);
        handle.userData.flank = "handle";
        group.add(handle);
      }
      const skirt = new THREE.Mesh(roundedBox(0.06, 0.12, rockerLen, 0.02), seamMat);
      skirt.position.set(sxSign * flankAt(0.25, rockerZ, -0.023), 0.25, rockerZ);
      skirt.userData.flank = "skirt";
      group.add(skirt);
    }

    // Hood and trunk shut lines across the top surfaces
    const hoodGap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.012, 0.016), gapMat);
    const hoodGapZ = bCabBack ? 0.65 : 1.06;
    hoodGap.position.set(0, skinY(hoodGapZ, d.hoodY) + 0.002, hoodGapZ);
    group.add(hoodGap);
    const trunkGap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.012, 0.016), gapMat);
    trunkGap.position.set(0, skinY(-1.42, d.deckY) + 0.002, -1.42);
    group.add(trunkGap);
    for (const sx of [-0.86, 0.86]) {
      const hoodSide = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 1.0), gapMat);
      const hsZ = bCabBack ? 1.2 : 1.55;
      hoodSide.position.set(sx, skinY(hsZ, d.hoodY) + 0.002, hsZ);
      group.add(hoodSide);
    }

    if (style === "gtr") {
      // Power bulge and the NACA-ish vents either side of it
      const bulge = new THREE.Mesh(roundedBox(0.72, 0.06, 1.0, 0.03), bodyMat);
      bulge.position.set(0, skinY(1.55, d.hoodY) + 0.02, 1.55);
      group.add(bulge);
      for (const sx of [-0.55, 0.55]) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.4), gapMat);
        vent.position.set(sx, skinY(1.5, d.hoodY) + 0.004, 1.5);
        group.add(vent);
      }
      // The boxed fender flares that used to live here are gone: every
      // car in the game wears a real arch flare now, traced on the arch
      // itself, and these sat across the top of the same four wheels at
      // a hardcoded ±0.96 — inboard of this silhouette's own 0.9925
      // flank. Two flares over one wheel, one of them sunk in the paint.
      // The gtr keeps its calling card by being in the widest band.
    }
    if (style === "zx") {
      // Cooling slats let into the long hood
      for (const sx of [-0.5, 0.5]) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.014, 0.5), gapMat);
        slat.position.set(sx, skinY(1.45, d.hoodY) + 0.004, 1.45);
        group.add(slat);
      }
    }

    // Front splitter, rear diffuser fins, antenna, grille badge
    const splitter = new THREE.Mesh(roundedBox(1.72, SPLITTER_H, 0.3, SPLITTER_R), seamMat);
    splitter.position.set(0, SPLITTER_Y, d.nose + 0.01);
    group.add(splitter);
    for (const fx of style === "gtr" ? [-0.6, -0.2, 0.2, 0.6] : [-0.45, 0, 0.45]) {
      const fin = new THREE.Mesh(roundedBox(0.04, 0.11, 0.28, 0.013), seamMat);
      fin.position.set(fx, 0.21, d.tail + 0.02);
      group.add(fin);
    }
    if (style === "sedan") {
      const fin = new THREE.Mesh(roundedBox(0.035, 0.11, 0.24, 0.012), bodyMat);
      fin.position.set(0, 1.5, -0.72);
      fin.rotation.x = -0.25;
      group.add(fin);
    }
    // The maker's roundel on the nose — unless the face already wears a
    // badge in its grille, which is where a car carries it. Both made a
    // car with two badges, one above the other.
    if (!faceSpec.badge || badgeBehindPlate) {
      const bz = noseFaceZ(bGeo, style, d.noseTopY, true) ?? d.nose;
      const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), chromeLocal);
      badge.rotation.x = Math.PI / 2;
      badge.position.set(0, d.noseTopY, bz + 0.004 - 0.01);
      group.add(badge);
    }

    // Indicators + reverse lights
    for (const sx of [-0.86, 0.86]) {
      const ind = new THREE.Mesh(roundedBox(0.13, 0.08, 0.05, 0.015), indicatorMat);
      ind.position.set(sx, d.grilleY + 0.06, d.nose - 0.03);
      group.add(ind);
    }
    for (const sx of [-0.55, 0.55]) {
      const rev = new THREE.Mesh(roundedBox(0.16, 0.06, 0.04, 0.013), reverseMat);
      rev.position.set(sx, d.tailY - 0.14, d.tail + 0.01);
      group.add(rev);
    }

    // Interior silhouettes behind the glass: dashboard + headrests
    const dash = new THREE.Mesh(roundedBox(1.45, 0.13, 0.34, 0.03), interiorMat);
    dash.position.set(0, d.dashY, bCabBack ? 0.15 : 0.5);
    group.add(dash);
    // Behind the head, at the height of the head — off the same fit the
    // driver is seated by, not off the dash. Hung off the dash it stayed
    // put while he moved, which on the pony left a headrest 400 mm in
    // front of the man it was supposed to be behind.
    for (const sx of [-DRIVER_X, DRIVER_X]) {
      const headrest = new THREE.Mesh(roundedBox(0.26, 0.22, 0.12, 0.04), interiorMat);
      headrest.position.set(sx, seatY + driverHeadTop() - 0.14, headZ - 0.15);
      group.add(headrest);
      seatRiders.push(headrest);
    }

    // Brake calipers peeking through the spokes.
    //
    // Taken from wheelX rather than the sedan's old 0.84, because a
    // caliper lives inside a wheel and the wheels are not where they
    // were: the wide kits push the track out by up to 70 mm, and on the
    // zx the flank is 120 mm outboard of that constant to begin with. A
    // caliper that does not follow its own wheel is a caliper floating
    // in the middle of the car.
    for (const [wx, wz] of [
      [-wheelX, wzF],
      [wheelX, wzF],
      [-wheelX, wzR],
      [wheelX, wzR],
    ]) {
      const caliper = new THREE.Mesh(
        roundedBox(0.06, 0.17, 0.11, 0.02),
        colors.raceKit ? tealCaliperMat : caliperMat
      );
      caliper.position.set(wx * 0.93, 0.42, wz + 0.11);
      group.add(caliper);
    }

    // B-pillars split the side glass into door windows.
    //
    // On the GLASS, which is what it divides. This was the last anchor
    // on the whole flank still carrying an absolute x — every other one
    // was moved onto the shell years ago and this was missed, so the
    // pillar sat 63 mm INSIDE the zx's glass and 54 mm off the suv's.
    // The canopy tumbles home hard (a coupe leans its glass in more than
    // a saloon does; see CROWN_BY_STYLE), which is exactly why a number
    // typed per style cannot follow it.
    for (const sxSign of [-1, 1]) {
      const pillar = new THREE.Mesh(roundedBox(0.025, 0.44, 0.07, 0.008), bodyMat);
      const px =
        (flankXAt(cGeo, style, d.bPillar[1], d.bPillar[2], ":pillar") ?? d.bPillar[0]) - 0.004;
      pillar.position.set(sxSign * px, d.bPillar[1], d.bPillar[2]);
      pillar.userData.flank = "pillar";
      group.add(pillar);
    }

    // Windshield wipers parked at the glass base
    for (const [wxp, rz] of [
      [-0.35, 0.12],
      [0.28, 0.18],
    ]) {
      const wiper = new THREE.Mesh(roundedBox(0.5, 0.014, 0.025, 0.005), seamMat);
      wiper.position.set(wxp, skinY(d.wiperZ, d.hoodY) + 0.008, d.wiperZ);
      wiper.rotation.x = -0.66;
      wiper.rotation.z = rz;
      group.add(wiper);
    }

    // Fog lamps, set into the valance.
    //
    // They used to sit in front of a "lower intake": a 1.3-1.5 m black
    // slab from before cars had faces, pinned at the nose's furthest
    // point and so standing 20 mm clear of the paint across the whole
    // front — in front of the grille the face system builds, which is
    // what hid it (the gtr's slab covered its mouth exactly). A car that
    // wants a lower mouth says so in its face; the slab is gone. The
    // lamps are seated on the skin at their own x, which falls back
    // toward the corners, instead of 35 mm ahead of the car's extreme.
    //
    // And outboard of the face. A mouth that slid down clear of its
    // headlamps can arrive at fog-lamp height, and a lamp inside a
    // grille's frame is two parts in one place. Moved out past the face;
    // if the nose ends before there is room, the car has no fog lamps.
    const FOG_Y = 0.36, FOG_R = 0.05;
    let fogX = 0.66;
    for (const [x0, x1, y0, y1] of faceRects) {
      if (y1 < FOG_Y - FOG_R || y0 > FOG_Y + FOG_R) continue;
      const reach = Math.max(Math.abs(x0), Math.abs(x1));
      if (reach + FOG_R > fogX - 0.01) fogX = reach + FOG_R + 0.03;
    }
    if (fogX + FOG_R <= flankX - 0.08) {
      for (const sx of [-fogX, fogX]) {
        const fz = noseFaceAt(bGeo, style, sx, FOG_Y);
        if (fz === null || fz < d.nose - 0.45) continue;
        const fog = new THREE.Mesh(new THREE.CylinderGeometry(FOG_R, FOG_R, 0.03, 10), reverseMat);
        fog.rotation.x = Math.PI / 2;
        fog.position.set(sx, FOG_Y, fz + 0.004 - 0.015);
        group.add(fog);
      }
    }

    // Mirror glass + a muffler box feeding the exhaust tips
    for (const sxSign of [-1, 1]) {
      // Same anchor as the housing it sits in. When d.mirror[0] changed
      // from an absolute x to an offset from the flank, this line kept
      // reading it as an absolute — so both mirror glasses moved to
      // within 30 mm of the centreline and sat inside the bodywork. The
      // mesh audit found them; nothing else would have.
      const mGlass = new THREE.Mesh(roundedBox(0.12, 0.07, 0.012, 0.005), chromeMat);
      mGlass.position.set(sxSign * (flankX + d.mirror[0]), d.mirror[1], d.mirror[2] - 0.1);
      group.add(mGlass);
    }
    const muffler = new THREE.Mesh(roundedBox(1.0, 0.1, 0.3, 0.03), grilleMat);
    muffler.position.set(0, 0.23, -1.92);
    group.add(muffler);
    // Where backfire and nitrous flames are born, in car-local space:
    // the tips themselves, recorded when they were built.

    // Fuel filler door on the right rear quarter.
    //
    // Both numbers here used to be absolute — x 0.945 and z -1.55 — and
    // both were wrong in the way this file keeps finding: 0.945 is the
    // saloon's flank, so on the four wide silhouettes the cap sank into
    // the paint, and -1.55 is only 150 mm behind the rear axle, which
    // puts a fuel filler INSIDE the rear tyre. It went unseen because
    // the tyre used to be small enough to leave 65 mm of daylight round
    // it; the moment the wheels were fitted to the cars, six machines
    // came back from check:fleet with a filler cap buried in the rubber.
    //
    // So it is placed the way every other flank detail on the car is:
    // on the shell's own surface, and behind where the arch actually
    // reaches AT THIS HEIGHT — which is what archReach answers.
    const FILLER_R = 0.055;
    const fillerY = d.creaseY + 0.09;
    const fillerZ =
      wzR - archReach(ARCH_EDGE_R, fillerY) - FLANK_GAP - FILLER_R;
    const filler = new THREE.Mesh(
      new THREE.CylinderGeometry(FILLER_R, FILLER_R, 0.012, 12),
      bodyMat
    );
    filler.rotation.z = Math.PI / 2;
    filler.position.set(flankX + 0.005, fillerY, fillerZ);
    group.add(filler);
    const fillerRing = new THREE.Mesh(
      new THREE.TorusGeometry(FILLER_R, 0.006, 6, 14),
      gapMat
    );
    fillerRing.rotation.y = Math.PI / 2;
    fillerRing.position.set(flankX + 0.008, fillerY, fillerZ);
    group.add(fillerRing);

    if (style === "gtr") {
      // Rear wiper parked across the hatch glass
      const rwiper = new THREE.Mesh(roundedBox(0.34, 0.013, 0.022, 0.005), seamMat);
      rwiper.position.set(0.12, 1.12, -1.42);
      rwiper.rotation.x = 0.9;
      rwiper.rotation.z = 0.25;
      group.add(rwiper);
    }
  }

  // Time-attack aero — the whole catalogue at once, factory-fitted.
  // Modelled on the classic yellow FD time-attack formula: swan-neck GT
  // wing, front splitter, canards, vented hood, skirts and a diffuser.
  // --- The sport kit: a real wing, a splitter and skirts.
  //
  // Everything between the street flare and the full attack build. It is
  // its own step rather than "attack minus some parts" because the two
  // are different intentions: this is a fast road car that has been got
  // at, and the attack kit is a car built to a regulation. A post wing
  // and a lip splitter say the first; canards and a swan neck say the
  // second, and putting canards on a Salmiya Turbo says neither.
  //
  // Skipped on traffic, which never gets closer than a lane away.
  if (kitAtLeast(kit, "sport") && !colors.raceKit && !colors.simple) {
    // A two-post wing on the deck: taller and wider than the factory
    // blade, nothing like the swan-neck plank the attack cars carry.
    const wingY = d.deckY + 0.3;
    for (const sx of [-0.6, 0.6]) {
      const post = new THREE.Mesh(roundedBox(0.045, 0.26, 0.14, 0.014), carbonMat);
      post.position.set(sx, d.deckY + 0.14, -1.92);
      group.add(post);
    }
    const plane = new THREE.Mesh(roundedBox(1.62, 0.042, 0.36, 0.014), bodyMat);
    plane.position.set(0, wingY, -1.95);
    plane.rotation.x = -0.14;
    group.add(plane);
    for (const sx of [-0.81, 0.81]) {
      const endplate = new THREE.Mesh(roundedBox(0.026, 0.2, 0.4, 0.01), carbonMat);
      endplate.position.set(sx, wingY, -1.95);
      group.add(endplate);
    }
    // Lip splitter — a blade off the bumper, not the full undertray.
    const lip = new THREE.Mesh(roundedBox(1.74, 0.03, 0.34, 0.011), carbonMat);
    lip.position.set(0, 0.17, d.nose - 0.02);
    group.add(lip);
    // Side skirts, seated on the same flank run the attack skirts use so
    // they stop at the arches instead of running through them.
    for (const sxSign of [-1, 1]) {
      const [kitLen, kitZ] = flankRun(0.17);
      const skirt = new THREE.Mesh(roundedBox(0.06, 0.08, kitLen, 0.018), carbonMat);
      skirt.position.set(sxSign * (flankX + 0.012), 0.17, kitZ);
      group.add(skirt);
    }
  }

  // --- The street kit: a boot lip and nothing that needs a spanner.
  //
  // The cheapest cars in the game are still built — they just are not
  // built LOUD. A ducktail lip and the arches are the whole of it, which
  // is what a first car on this road actually looks like.
  if (kit === "street" && !colors.spoiler && !colors.simple) {
    const lipZ = d.tail + 0.34;
    const seat = skinY(lipZ, d.deckY);
    const duck = new THREE.Mesh(roundedBox(1.44, 0.055, 0.26, 0.02), bodyMat);
    duck.position.set(0, seat + 0.03, lipZ);
    duck.rotation.x = -0.22;
    group.add(duck);
  }

  // ----------------------------------------------- the base-spec car
  //
  // A street car used to differ from a built one only by ABSENCE: no
  // flares, no skirts, no wing, and otherwise the same machine. That is
  // how you make the cheap cars look unfinished rather than cheap.
  //
  // These are the three things a base-model car on this road actually
  // HAS that a built one does not, and each reads from ten metres:
  // covers over steel wheels (above), a whip aerial on the roof, and
  // the sun band across the top of the windscreen that half the cars in
  // this country wear because the sun here is not a metaphor.
  if (kit === "street" && !colors.simple) {
    // The aerial. A thin mast is nearly invisible in a still and
    // unmistakable in motion, because it is the one part of the car
    // that moves against the sky.
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.011, 0.52, 5),
      seamMat
    );
    mast.position.set(flankX - 0.16, d.roof[1] + 0.24, d.roof[0] + 0.18);
    mast.rotation.z = 0.12; // raked back, the way a whip sits
    mast.rotation.x = -0.16;
    group.add(mast);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, 0.035, 8),
      seamMat
    );
    base.position.set(flankX - 0.16, d.roof[1] + 0.005, d.roof[0] + 0.18);
    group.add(base);

    // The sun band: a tinted strip across the top of the screen, dark
    // at the edges and clearing toward the middle where a driver
    // actually looks out. Emissive-free and nearly opaque, so at night
    // it reads as a black band rather than as glass.
    const band = new THREE.Mesh(
      roundedBox(1.28, 0.16, 0.02, 0.008),
      new THREE.MeshStandardMaterial({
        name: "sun-band",
        color: 0x0d1014,
        roughness: 0.35,
        metalness: 0.1,
        transparent: true,
        opacity: 0.82,
      })
    );
    band.position.set(0, d.beltY + 0.42, d.wiperZ + 0.16);
    band.rotation.x = -0.5; // lies along the screen's rake
    group.add(band);
  }

  if (colors.raceKit) {
    // Swan-neck GT wing, twice the garage part: tall carbon stays, a
    // body-colour main plane and big endplates
    const wingY = d.deckY + 0.58;
    const STAY_LEN = 0.55, STAY_RAKE = 0.16;
    for (const sx of [-0.55, 0.55]) {
      const stay = new THREE.Mesh(roundedBox(0.05, STAY_LEN, 0.22, 0.016), carbonMat);
      stay.position.set(sx, d.deckY + 0.28, -1.88);
      stay.rotation.x = STAY_RAKE; // swept back into the plane
      group.add(stay);
    }
    // The wing itself hangs from a pivot at the top of the stays — the
    // swan-neck mount — so the engine can pitch it: up as an airbrake
    // under braking, flatter at speed (aero.ts). Everything below sits
    // at the same place it did when it was five loose meshes; the pivot
    // rests at zero, so a fresh build measures exactly as before.
    const wing = new THREE.Group();
    wing.name = "wing";
    wing.userData.wing = true;
    const pivotY = d.deckY + 0.28 + (STAY_LEN / 2) * Math.cos(STAY_RAKE);
    const pivotZ = -1.88 - (STAY_LEN / 2) * Math.sin(STAY_RAKE);
    wing.position.set(0, pivotY, pivotZ);
    group.add(wing);
    group.userData.wing = wing;
    const plane = new THREE.Mesh(roundedBox(1.95, 0.045, 0.5, 0.015), bodyMat);
    plane.position.set(0, wingY - pivotY, -2.02 - pivotZ);
    plane.rotation.x = -0.18; // rest incidence; the pivot carries the rest
    wing.add(plane);
    // Gurney flap on the trailing edge + brake strip beneath it
    const gurney = new THREE.Mesh(roundedBox(1.9, 0.05, 0.02, 0.006), carbonMat);
    gurney.position.set(0, wingY + 0.06 - pivotY, -2.25 - pivotZ);
    wing.add(gurney);
    // Brake strip on the wing's trailing edge. Slung under the main
    // plane it was in the plane's own shadow from every angle above the
    // car — which is every angle the game is ever seen from. It tucks
    // under the gurney and projects past the trailing edge instead, so a
    // following car actually sees it light up.
    const strip = new THREE.Mesh(roundedBox(1.0, 0.028, 0.09, 0.008), tailMat);
    strip.position.set(0, wingY + 0.028 - pivotY, -2.285 - pivotZ);
    wing.add(strip);
    for (const sx of [-0.99, 0.99]) {
      const endplate = new THREE.Mesh(roundedBox(0.03, 0.3, 0.54, 0.012), carbonMat);
      endplate.position.set(sx, wingY - pivotY, -2.02 - pivotZ);
      wing.add(endplate);
    }

    // Front splitter jutting past the bumper, low enough to scrape
    const splitter = new THREE.Mesh(roundedBox(1.95, 0.035, 0.7, 0.012), carbonMat);
    splitter.position.set(0, 0.14, d.nose - 0.18);
    group.add(splitter);

    // Canards: two per corner, biting the air off the bumper sides
    for (const sxSign of [-1, 1]) {
      for (const [cy, cz] of [
        [0.34, -0.14],
        [0.47, -0.22],
      ]) {
        const canard = new THREE.Mesh(roundedBox(0.3, 0.018, 0.18, 0.007), carbonMat);
        // On the bumper's own corner, not at the sedan's old 0.85 —
        // which is 190 mm inside the front of a zx and hangs off a
        // hatch. A canard bites the air coming off the corner; put it
        // anywhere else and it is a carbon shelf.
        canard.position.set(sxSign * (flankX - 0.06), cy, d.nose + cz);
        canard.rotation.z = sxSign * 0.3;
        canard.rotation.x = -0.25;
        group.add(canard);
      }
    }

    // Vented hood: twin extraction louvres and a pair of intake scoops
    for (const sx of [-0.36, 0.36]) {
      const louvre = new THREE.Mesh(roundedBox(0.34, 0.025, 0.5, 0.009), carbonMat);
      louvre.position.set(sx, skinY(1.15, d.hoodY) + 0.015, 1.15);
      louvre.rotation.x = -0.06; // follows the hood's fall
      group.add(louvre);
      const scoop = new THREE.Mesh(roundedBox(0.16, 0.07, 0.22, 0.02), carbonMat);
      scoop.position.set(sx * 1.4, skinY(0.62, d.hoodY) + 0.05, 0.62);
      group.add(scoop);
    }

    // Side skirts hugging the rockers
    for (const sxSign of [-1, 1]) {
      const [kitLen, kitZ] = flankRun(0.16);
      const skirt = new THREE.Mesh(roundedBox(0.08, 0.1, kitLen, 0.022), carbonMat);
      skirt.position.set(sxSign * (flankX + 0.01), 0.16, kitZ);
      group.add(skirt);
    }

    // Rear diffuser kicking up between the exhaust and the bumper
    const diffuser = new THREE.Mesh(roundedBox(1.7, 0.03, 0.5, 0.01), carbonMat);
    diffuser.position.set(0, 0.18, d.tail + 0.12);
    diffuser.rotation.x = 0.35;
    group.add(diffuser);
    for (const fx of [-0.4, 0, 0.4]) {
      const fin = new THREE.Mesh(roundedBox(0.02, 0.1, 0.4, 0.007), carbonMat);
      fin.position.set(fx, 0.2, d.tail + 0.1);
      fin.rotation.x = 0.35;
      group.add(fin);
    }

    // Red tow hook on the splitter — scrutineering says so. Its own
    // material rather than the caliper's: it was borrowing that one for
    // the colour, which made every kit car read as having five brake
    // calipers on four wheels to anything counting parts.
    const hook = new THREE.Mesh(roundedBox(0.1, 0.035, 0.12, 0.012), towHookMat);
    hook.position.set(0.45, 0.19, d.nose + 0.08);
    group.add(hook);
  }

  // The zx leaves the factory with a rear wing on the hatch — a low
  // two-post blade, not a bolt-on GT plank. Without it the tail is a
  // bare sheet from the glass to the bumper, which is the one thing that
  // made this silhouette read as unfinished from behind. It steps aside
  // for either aftermarket wing rather than stacking with them.
  // A hatch's spoiler is a lip off the roof's trailing edge, over the
  // glass — not a plank on a boot it does not have. Seated on the roof
  // panel's own measured surface so it sits ON the car whatever the
  // extrusion's bevel does.
  if (style === "hatch" && !colors.spoiler && !colors.raceKit) {
    const [rz] = d.roof;
    const lipZ = rz - 0.62;
    const seat = deckY(rGeo, style, Math.min(lipZ + 0.1, rz), "roof") ?? d.roof[1];
    const lip = new THREE.Mesh(roundedBox(1.42, 0.05, 0.34, 0.018), bodyMat);
    lip.position.set(0, seat - 0.02, lipZ);
    lip.rotation.x = 0.32; // follows the hatch glass down
    group.add(lip);
    for (const sx of [-0.66, 0.66]) {
      const fin = new THREE.Mesh(roundedBox(0.05, 0.09, 0.26, 0.016), bodyMat);
      fin.position.set(sx, seat - 0.05, lipZ - 0.02);
      fin.rotation.x = 0.32;
      group.add(fin);
    }
  }

  if (style === "zx" && !colors.spoiler && !colors.raceKit) {
    const wz = -1.98;
    const deck = deckY(bGeo, style, wz) ?? d.deckY + 0.12;
    for (const sx of [-0.66, 0.66]) {
      const post = new THREE.Mesh(roundedBox(0.07, 0.13, 0.2, 0.02), bodyMat);
      post.position.set(sx, deck + 0.05, wz);
      group.add(post);
    }
    const blade = new THREE.Mesh(roundedBox(1.66, 0.045, 0.36, 0.016), bodyMat);
    blade.position.set(0, deck + 0.125, wz - 0.02);
    blade.rotation.x = -0.07;
    group.add(blade);
    // A lip turned up at the trailing edge, which is what the real ones
    // have and what stops the blade reading as a shelf.
    const lip = new THREE.Mesh(roundedBox(1.62, 0.05, 0.02, 0.008), bodyMat);
    lip.position.set(0, deck + 0.15, wz - 0.19);
    group.add(lip);
  }

  // GT wing — always the player's choice: equip the part or run clean
  // (the attack kit brings its own swan-neck; don't stack two wings)
  if (colors.spoiler && !colors.raceKit) {
    const baseY = d.deckY + 0.18;
    for (const sx of [-0.62, 0.62]) {
      const strut = new THREE.Mesh(roundedBox(0.06, 0.26, 0.16, 0.016), seamMat);
      strut.position.set(sx, baseY, -1.95);
      group.add(strut);
    }
    const wing = new THREE.Mesh(roundedBox(1.8, 0.04, 0.42, 0.013), bodyMat);
    wing.position.set(0, baseY + 0.15, -1.98);
    wing.rotation.x = -0.12;
    group.add(wing);
    // Brake strip on the wing's trailing edge — behind it and just under
    // it, not inside it. At z -2.17 it sat within the blade's own depth
    // and never showed on any car that fitted this wing.
    const strip = new THREE.Mesh(roundedBox(0.9, 0.025, 0.09, 0.008), tailMat);
    strip.position.set(0, baseY + 0.155, -2.245);
    group.add(strip);
    for (const sx of [-0.88, 0.88]) {
      const endplate = new THREE.Mesh(roundedBox(0.03, 0.16, 0.4, 0.01), seamMat);
      endplate.position.set(sx, baseY + 0.15, -1.98);
      group.add(endplate);
    }
  }

  // ------------------------------------------------------------ stickers
  // The rally pack, hung a centimetre off the panels. Decal planes rather
  // than UV work because the shells are swapped for Blender geometry at
  // runtime — planes survive that swap untouched.
  // A livery comes with the kit from the sport step up. The Rally
  // Sticker Pack is still a garage part and still the only way a BASIC
  // car gets one — which is the point of it: on the bottom shelf a
  // livery is something you chose, and further up it is what the car
  // came wearing. Buying the pack for a car that already has one is
  // idempotent rather than doubled, because this is one flag.
  // The full-length graphic goes on FIRST and low, under the rally pack's
  // lane rather than in it. Everything that pack places lives between the
  // crease and the beltline; this sits below the crease on the lower
  // door, so the two can be worn together without a clearance rule
  // between them — which is the only way five silhouettes stay safe
  // without a table of exceptions per body.
  if (colors.fullStripe && !colors.simple) {
    // In the BELTLINE lane, not down by the sill.
    //
    // It was at the sill first, tucked into the clear band under the
    // wordmark so that nothing had to give way to it. The measurements
    // were all green and the render settled it: at that height the
    // graphic sits in the shade under the body with the wheels across
    // it, and a full-length sticker nobody can see is not a sticker. The
    // numbers said "it fits"; they cannot say "you can see it".
    //
    // So it takes the lane a side graphic actually occupies, and passes
    // UNDER the pack's roundel, flag and wordmark rather than dodging
    // them — 12 mm off the paint against their 22, which is how a real
    // livery is built: the stripe runs the length of the car and the
    // numbers sit on top of it. The pack's own beltline stripe is the
    // one thing that does give way, because two stripes in one lane is
    // just a shorter stripe drawn over a longer one.
    const yMid = d.beltY - BELT_STRIPE_DROP;
    const skin = decalMat(fullStripeTexture());
    for (const sign of [-1, 1] as const) {
      // Sampled past both bumpers on purpose: columns that find no body
      // are dropped, so the run ends itself exactly where the shell does.
      const geo = flankRibbon(bodyShell, sign, d.tail - 0.25, d.nose + 0.25, yMid, BELT_STRIPE_H, 0.012, 192);
      if (!geo) continue;
      const strip = new THREE.Mesh(geo, skin);
      strip.userData.decal = "full-stripe";
      group.add(strip);
    }
  }

  // ------------------------------------------------------- factory livery
  //
  // Stickers the car was BUILT with, not ones bought for it. One so far:
  // the Black Demon's mark, worn on all four sides.
  //
  // Four sides means four, and a car has two of them that are the same
  // shape and two that are not: the flanks take a plane hung off the
  // measured half-width, and the bonnet and the deck take one laid on a
  // slope. Both of those already exist here — the rally pack's quarter
  // badge and its hood swoosh — so this places the same mark by the same
  // two methods rather than inventing a third.
  //
  // Where this lands on a panel the rally pack also wants, the PACK
  // gives way (see wearsLivery below). Not because the livery is more
  // important, but because they are the same mark: a car wearing the
  // Demon's badge at 580 mm on its rear quarter does not also want the
  // crew's 320 mm one 20 mm away, and the alternative is a clearance
  // rule per silhouette, which is what the rest of this section has
  // spent its comments avoiding.
  const wearsDemon = colors.livery === "demon" && !colors.simple;
  if (wearsDemon) {
    const mark = decalMat(demonMarkTexture(LIVERY_MARK_PX, true));
    // Lit from inside, more than a sticker is. The ember in this mark is
    // the only thing on the car that is not black, and on a road whose
    // light is one sodium lamp every thirty metres a decal at the shared
    // 0.16 is as dark as the paint around it for most of a lap.
    mark.emissiveIntensity = 0.42;
    // Flanks. The rear quarter, which is the one panel clear on every
    // silhouette in this fleet: no arch through it, no door handle, and
    // the beltline stripe already stops short of it.
    //
    // FOLLOWING the panel, not hung off the car's widest point. Every
    // flat decal on a flank here is placed at `flankX + 14 mm`, and
    // flankX is the bounding box — the widest the body ever gets, which
    // is at the arches. Measured on the quarter, that convention leaves
    // the sticker 65 mm proud of the paint it is supposed to be stuck
    // to: at any angle but dead side-on it reads as floating beside the
    // car. The full-length stripe already solved this by sampling the
    // shell per column and standing 12 mm off whatever it finds, so the
    // mark is built the same way. (The rally pack's own flank decals
    // still use the old placement; moving those moves five silhouettes'
    // worth of decisions and is not this car's job.)
    // Centred in the flank's clear middle — between the character crease
    // and the chrome belt — rather than on the beltline itself, which is
    // where the crew badge sits and is a moulding rather than a panel.
    // In the flank's clear lane, between the character crease and the
    // chrome belt. Dropping it lower buys height — there is bodywork all
    // the way to the sill — and spends it: the arch is a circle, so the
    // lower the band the further it reaches, and a 400 mm mark centred
    // just above the crease came out with its bottom third behind the
    // rear tyre. Height that is behind a wheel is not height.
    const QY = (d.creaseY + d.beltY) / 2;
    // And placed off the run rather than at a z typed in here. -1.45 is
    // the rear quarter of the body this was developed against and the
    // middle of the arch on the shortest one in the fleet. flankRun
    // already knows where each silhouette's arches are; the mark goes
    // just forward of the rear one, which is the same place on all six.
    const [qRun, qCtr] = flankRun(QY);
    const qBack = qCtr - qRun / 2;
    // As big as the quarter will honestly carry, found by asking it.
    //
    // A number picked here is a number picked for one silhouette. The
    // first one was 580 mm, which is what the run WIDTH allows and has
    // nothing to do with the height: at that size the top edge is up in
    // the glasshouse, the ribbon finds no bodywork to follow, and both
    // flanks came out with no mark at all rather than with a bad one —
    // which is the failure mode worth having, and is how this was
    // caught. So the sizes are tried largest first and the first one
    // the panel accepts is the one worn. Six bodies, no table.
    for (const sign of [-1, 1] as const) {
      for (const h of [0.46, 0.40, 0.34, 0.28, 0.22]) {
        // Nothing wider than the run itself, whatever the panel height
        // would allow.
        if (h > qRun - 0.06) continue;
        const zc = qBack + 0.03 + h / 2;
        const geo = flankRibbon(bodyShell, sign, zc - h / 2, zc + h / 2, QY, h, 0.012, 48);
        if (!geo) continue;
        const m = new THREE.Mesh(geo, mark);
        m.userData.decal = "demon-flank";
        group.add(m);
        break;
      }
    }
    // Bonnet and deck. Both are slopes, so both are levelled the way the
    // hood swoosh is: the skin is measured at the plane's front and back
    // edge and the plane is pitched to the fall between them. A flat
    // plane set to the height at its centre has one end buried and the
    // other floating, and on the long-nosed bodies that is 100 mm of
    // error across the decal.
    // The top surface at a point, INCLUDING whatever is bolted to it.
    //
    // skinY reads the body shell, which is the right answer for a bare
    // bonnet and the wrong one for this car: the attack kit lays a
    // power bulge down the middle of the hood, 700 mm wide and 35 mm
    // proud, and a mark levelled against the shell underneath it is
    // inside it. Rendered, the bonnet was blank and the decal was in
    // there the whole time — the ray from above hit paint, then the
    // sticker, then the shell.
    //
    // So the ray is cast here too. Everything already in the group is
    // fair game except other decals, which is what "lay it on the car"
    // actually means.
    // World matrices first. Nothing has needed them during the build so
    // far, so every child still carries the identity it was created
    // with — the first version of this ray was cast at a car whose
    // parts were all at the origin, hit nothing above the shell, and
    // silently fell back to exactly the answer it was written to
    // replace. It reported no change and looked like a no-op fix.
    group.updateMatrixWorld(true);
    const solids: THREE.Mesh[] = [];
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !o.userData?.decal) solids.push(m);
    });
    const downRay = new THREE.Raycaster();
    const DOWN = new THREE.Vector3(0, -1, 0);
    // Bounded, or the rule reads "the tallest thing over this point" and
    // the mark on the deck came out levelled against the rear WING —
    // 300 mm above the boot lid, floating over the car it belongs to.
    // What is wanted is the panel plus whatever is bolted flush to it:
    // a bulge, a vent, a stripe.
    //
    // 160 mm, measured rather than guessed. The first cut was 90 and it
    // read as no change at all: the attack kit's power bulge runs level
    // down a bonnet that falls 105 mm from the scuttle to the nose, so
    // at the front edge of the mark it stands 113 mm off the shell
    // beneath it — a bulge by any description, and outside a 90 mm
    // band. The wing that has to stay excluded is at 300.
    const FLUSH = 0.16;
    const topAt = (z: number, fallback: number): number => {
      const base = skinY(z, fallback);
      downRay.set(new THREE.Vector3(0, 4, z), DOWN);
      for (const hit of downRay.intersectObjects(solids, false)) {
        if (hit.point.y <= base + FLUSH) return Math.max(hit.point.y, base);
      }
      return base;
    };
    const lay = (z: number, size: number, faceRear: boolean, tag: string) => {
      const half = size / 2;
      const yBack = topAt(z - half, d.hoodY);
      const yFront = topAt(z + half, d.hoodY);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mark);
      // Read from where it is looked at: the bonnet from the driver's
      // seat, the deck from the car behind — which is the whole reason
      // anybody puts a mark back there.
      m.rotation.z = faceRear ? 0 : Math.PI;
      m.rotation.x = -Math.PI / 2 + Math.asin(Math.min(0.6, (yBack - yFront) / (2 * half)));
      m.position.set(0, (yBack + yFront) / 2 + 0.022, z);
      m.userData.decal = tag;
      group.add(m);
    };
    // Forward of the wipers so it sits on bonnet rather than on the
    // scuttle, and back from the nose's drop-off. bCabBack is the
    // cab-backward measure the hood swoosh already uses to tell a
    // long-nosed body from a short one.
    lay(bCabBack ? 1.15 : 1.45, 0.8, false, "demon-hood");
    // And on the deck, clear of a wing's feet at z -1.98.
    lay(-1.62, 0.55, true, "demon-deck");
  }

  // --- The patrol car.
  //
  // Unlike the Demon's, this livery is allowed on a `simple` build,
  // because `simple` IS the use case: patrol cars are traffic. It costs
  // two ribbon meshes and one bar, and the band texture is module-level
  // so the fifth patrol car on the road costs no more than the first.
  const wearsPolice = colors.livery === "police";
  if (wearsPolice) {
    // The wrap, in the flank's clear lane. The SHAPE of it is cut out of
    // the texture's alpha (policeBandTexture) — a patrol wrap sweeps, and
    // cutting the sweep out of a constant-height ribbon is free, where
    // building it into geometry is a second law to keep in step with the
    // eight silhouettes flankRibbon already handles.
    const bandMat = new THREE.MeshStandardMaterial({
      name: "police-band",
      map: policeBandTexture(),
      transparent: true,
      alphaTest: 0.35,
      roughness: 0.34,
      metalness: 0.06,
      // Printed vinyl over paint. It is not as wet as the lacquer around
      // it, but it is not matte either, and with no envMapIntensity of
      // its own it was the one surface on the car reflecting nothing.
      envMapIntensity: 1.15,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    // How DEEP the wrap is, asked of the body rather than typed in.
    //
    // POLICE.bandH is what it wants, and 0.46 m is most of a door — but
    // the flank's clear lane between the crease and the belt is 0.23 m
    // on the saloon, so a band asked for at its full depth put its top
    // edge up in the glasshouse, flankRibbon found no bodywork to follow
    // and BOTH flanks came out with no wrap at all. That is the same
    // failure the Demon's quarter mark records two hundred lines up, and
    // the same cure: try the depths largest first and wear the first one
    // the panel accepts. Eight bodies, no table.
    //
    // Anchored from the TOP, just under the belt, so the wrap fills the
    // door downward the way a real one does instead of floating in the
    // middle of the flank.
    for (const sign of [-1, 1] as const) {
      for (const h of [POLICE.bandH, 0.4, 0.34, 0.28, 0.22, 0.17]) {
        const bandY = d.beltY - 0.035 - h / 2;
        // Nose to tail: the sweep needs the length to sweep over, and
        // flankRibbon drops any column where the ray finds no bodywork,
        // so it still ends itself on whichever silhouette it is put on.
        const geo = flankRibbon(bodyShell, sign, d.tail + 0.16, d.nose - 0.2,
          bandY, h, 0.010, 160, sign > 0);
        if (!geo) continue;
        const m = new THREE.Mesh(geo, bandMat);
        m.userData.decal = "police-band";
        group.add(m);
        break;
      }
    }

    // The bar, off the ROOF SHELL's own extent — not off d.roof, which
    // are the profile's control points rather than the panel's edges. On
    // the saloon d.roof[1] is 1.49 and the roof shell ends at 0.41, so a
    // bar placed from the table landed on the wiper cowl.
    rGeo.computeBoundingBox();
    const roofBox = rGeo.boundingBox!;
    const barZ = roofBox.max.z - 0.26;
    const roofY = topSkinY(barZ);
    const bar = new THREE.Group();
    bar.position.set(0, roofY, barZ);
    const halfW = flankX * POLICE.barHalfK;
    // A low-profile strip, the same silhouette as the authored bar in
    // tools/blender/build_assets.py, so the car does not change shape
    // when that lands. Every mesh says which authored part it is.
    const shellMat = new THREE.MeshStandardMaterial({
      name: "police-bar",
      color: 0x15171c,
      roughness: 0.3,
      metalness: 0.5,
      envMapIntensity: 1.4,
    });
    const housing = new THREE.Mesh(
      roundedBox(halfW * 2, POLICE.barH, POLICE.barD, 0.028), shellMat);
    housing.position.y = POLICE.barLift + POLICE.barH / 2;
    housing.userData.barPart = "bar";
    bar.add(housing);
    for (const sx of [-1, 1] as const) {
      const foot = new THREE.Mesh(
        roundedBox(0.1, POLICE.barLift, POLICE.barD * 0.56, 0.01), shellMat);
      foot.position.set(sx * halfW * 0.52, POLICE.barLift / 2, 0);
      bar.add(foot);
    }
    // Two lens banks, each its own material so each patrol car can be on
    // its own beat. Shared materials would cost less and put every bar
    // in the city in step, which real ones never are.
    const lamp = () =>
      new THREE.MeshStandardMaterial({
        name: "police-lamp",
        color: POLICE.blue,
        emissive: POLICE.blue,
        emissiveIntensity: POLICE.lampOff,
        // A lens is moulded acrylic: it reflects the street even when it
        // is dark, which is most of the time.
        roughness: 0.12,
        metalness: 0,
        envMapIntensity: 1.6,
      });
    const leftMat = lamp();
    const rightMat = lamp();
    for (const [sx, mat, part] of [[-1, leftMat, "lampl"], [1, rightMat, "lampr"]] as const) {
      const lens = new THREE.Mesh(
        roundedBox(halfW * 0.86, POLICE.barH * 0.5, POLICE.barD * 1.04, 0.012), mat);
      lens.position.set(sx * halfW * 0.5, POLICE.barLift + POLICE.barH * 0.55, 0);
      lens.userData.barPart = part;
      bar.add(lens);
    }
    group.add(bar);
    // The authored bar, when it arrives. A geometry swap per part; the
    // game keeps owning the materials, so the beat carries on running
    // through it without noticing.
    void upgradePoliceBar(bar);
    // What the engine needs to run it, and what a test needs to find it.
    // The BEAT is not set here: every patrol car is the same silver, so
    // anything derived from the build put all five bars in lockstep.
    // Whoever spawns them knows how many there are and spaces them.
    group.userData.police = { bar, left: leftMat, right: rightMat, phase: 0 };
  }

  // The kit's own livery — and a car that came with one of its own does
  // not also get it.
  //
  // From the sport step up, a car wears the rally pack for free: it is
  // what "built" looks like at that band. That is right for fifteen
  // cars and wrong for the one that arrives already painted, which came
  // out of the showroom render wearing a red-and-green beltline stripe,
  // a racing roundel and a Kuwait flag over the top of its own black
  // livery. Two liveries is not twice the livery.
  //
  // Buying the Rally Sticker Pack still puts it on, because that is a
  // decision the player made and paid for. What gives way is the kit's
  // free default, which is nobody's decision.
  const wearsLivery =
    colors.stickers ||
    (kitAtLeast(kit, "sport") && !colors.simple && !wearsDemon && !wearsPolice);
  if (wearsLivery && !colors.simple) {
    // Off the shell's measured flank, not a hand-kept table of the four
    // half-widths. The table happened to be right, but it was a second
    // place to remember when a body changes.
    const sideX = flankX + 0.014;
    const num =
      colors.stickerNumber ??
      ((((colors.body * 2654435761) >>> 0) % 90) + 10);

    const roundel = decalMat(roundelTexture(num));
    const stripe = decalMat(beltStripeTexture());
    const flag = decalMat(flagDecalTexture());
    const demon = decalMat(demonMarkTexture());
    const nameDecal = colors.name
      ? decalMat(nameDecalTexture(colors.name, colors.nameAr))
      : null;
    // Four decals and a stripe on one flank need lanes, or they land on
    // each other: the wordmark went straight under the roundel and the
    // horned mark disappeared into the stripe's tail. Front fender, door,
    // rear quarter — and the stripe stops before the quarter so the mark
    // has clean paint to sit on. The roundel is the deliberate exception,
    // interrupting the stripe the way a rally door number does.
    // The beltline stripe and the flag share the front of this run, and
    // the stripe gives way to it.
    //
    // The flag is 440 mm now rather than 240, and there is nowhere else
    // for it to go: measured on all five bodies, the band below the
    // stripe is already the wordmark's, and the clear flank at that
    // lower height stops 130 mm sooner than it does at the belt, because
    // a wheel arch is widest at the bottom. So the flag takes the front
    // of the beltline run and the stripe stops short of it — which is
    // what the stripe already does at the other end for the crew mark,
    // and reads as rally livery rather than as two decals fighting.
    const stripeY = d.beltY - BELT_STRIPE_DROP;
    const [beltRun, beltCtr] = flankRun(stripeY);
    const runFront = beltCtr + beltRun / 2;
    const runBack = beltCtr - beltRun / 2;
    // How tall a flag the fender will actually take.
    //
    // A flank is not a blank panel. The character crease is a 35 mm
    // moulding 50 mm tall standing proud of the paint, and the chrome
    // belt is another above it, and a flat decal cannot follow either of
    // them — put a 220 mm flag across the crease and the crease draws
    // over its bottom third, which is exactly how the first bigger
    // version came out. So the flag is sized to the CLEAR BAND between
    // the two mouldings, with a 15 mm margin off each, and comes out
    // 310 to 370 mm long depending on the body. That is a third to a
    // half again on the 240 mm it was, and it is as big as the panel
    // will honestly carry.
    const bandBot = d.creaseY + 0.025 + 0.015;
    const bandTop = d.beltY - 0.01 - 0.015;
    const FLAG_H = Math.min(0.2, bandTop - bandBot);
    const FLAG_L = FLAG_H * 2;
    const flagY = (bandBot + bandTop) / 2;
    const flagZ = runFront - 0.04 - FLAG_L / 2;
    const stripeFront = flagZ - FLAG_L / 2 - 0.06;
    const stripeLen = Math.max(0.3, stripeFront - runBack);
    const stripeZ = (stripeFront + runBack) / 2;
    for (const sign of [-1, 1]) {
      const x = sign * (sideX + 0.008);
      const flipY = sign * (Math.PI / 2);
      // Beltline stripe: the spine everything else is placed around. It
      // stops at the arches like the panel features do, rather than
      // running over a wheel opening.
      if (!colors.fullStripe) {
        const st = new THREE.Mesh(new THREE.PlaneGeometry(stripeLen, BELT_STRIPE_H), stripe);
        st.position.set(sign * sideX, stripeY, stripeZ);
        st.rotation.y = flipY;
        group.add(st);
      }
      // Kuwait flag on the front fender, behind the arch. 440 mm long
      // rather than 240: a flag on a rally car is a flag, and at the old
      // size it was a coloured smudge you had to be told about.
      //
      // Its height is measured DOWN FROM THE BELTLINE STRIPE rather than
      // taken off the crease, so it cannot collide with the stripe by
      // construction. At the new size, hung off the crease, it did on
      // every silhouette in the fleet — the sedan by a centimetre, the
      // FD by three.
      const f = new THREE.Mesh(new THREE.PlaneGeometry(FLAG_L, FLAG_H), flag);
      f.position.set(x, flagY, flagZ);
      f.rotation.y = flipY;
      group.add(f);
      // Door: racing number over the car's own name. Its z is held
      // behind whatever the stripe now ends at, so on the shortest flank
      // in the fleet — the FD's, where the run gives the flag 130 mm
      // less to work with — the number slides back rather than ending up
      // under the flag's trailing edge.
      const roundelZ = Math.min(0.35, stripeFront - 0.19);
      const r = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), roundel);
      r.position.set(x, d.creaseY + 0.12, roundelZ);
      r.rotation.y = flipY;
      group.add(r);
      if (colors.name) {
        const word = new THREE.Mesh(new THREE.PlaneGeometry(0.86, WORDMARK_H), nameDecal!);
        word.position.set(sign * (sideX + 0.004), d.creaseY - WORDMARK_DROP, roundelZ);
        word.rotation.y = flipY;
        group.add(word);
      }
      // The crew's horned mark on the rear quarter, clear of the stripe
      // — unless the car was built wearing the same mark at twice the
      // size on the same panel, in which case this is the pack badging a
      // car that is already badged.
      if (!wearsDemon) {
        const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), demon);
        mark.position.set(x, d.beltY - 0.02, -1.45);
        mark.rotation.y = flipY;
        mark.userData.decal = "crew-mark";
        group.add(mark);
      }
    }
    // Falcon swoosh flat on the hood, nosed toward the windshield — and
    // not at all if the livery has already claimed the bonnet.
    if (!wearsDemon) {
      const hood = new THREE.Mesh(
        new THREE.PlaneGeometry(0.85, 0.85),
        decalMat(hoodDecalTexture())
      );
      // Laid ON the hood, which is a slope and not a table. A flat plane
      // set to the skin height at its centre has its back half inside the
      // bonnet and its front half floating: 0.85 m of decal spans 100 mm
      // of fall on the long-nosed bodies. Both ends are measured and the
      // plane is pitched to match.
      const hoodDecalZ = bCabBack ? 1.15 : 1.45;
      const HALF = 0.425;
      const yBack = skinY(hoodDecalZ - HALF, d.hoodY);
      const yFront = skinY(hoodDecalZ + HALF, d.hoodY);
      hood.rotation.z = Math.PI; // read the right way up from the driver's seat
      hood.rotation.x = -Math.PI / 2 + Math.asin(Math.min(0.6, (yBack - yFront) / (2 * HALF)));
      // A little more than a decal's clearance, because the bonnet bows
      // between the two points this is levelled against.
      hood.position.set(
        0,
        Math.max(
          (yBack + yFront) / 2 + 0.022,
          hoodStripeTop ? hoodStripeTop(hoodDecalZ) + 0.005 : -Infinity
        ),
        hoodDecalZ
      );
      group.add(hood);
    }
  }

  // The body's own anchor points, so a camera bolted to this shell can
  // sit on ITS bonnet and behind ITS screen rather than at an average of
  // five silhouettes. Unscaled, like everything else on the car — the
  // rig is a child of the body and inherits the fit.
  group.userData.dims = d;
  group.userData.wheels = wheels;
  group.userData.tailMat = tailMat;
  group.userData.tailCoreMat = tailCoreMat;
  group.userData.headMat = headMat;
  // Flashed with the lamps by the engine's challenge ritual
  group.userData.headGlowMats = headGlowMats;
  group.userData.lampPositions = lampPositions;
  // The paint is per-car (glass/chrome/rims are shared modules), so the
  // engine can feed the player's paint a live reflection probe without
  // leaking it onto every car on the road.
  group.userData.bodyMat = bodyMat;
  // How much of the world this finish is allowed to mirror. The engine
  // sets the paint's envMapIntensity itself when it dresses the car for
  // the reflection probe, and it used to set one flat number for every
  // car — which threw away the envScale set two thousand lines above
  // this and made a matte car mirror the street exactly as hard as a
  // gloss one. The finish's scale travels with the car so the engine
  // can multiply by it rather than overwrite it.
  group.userData.envScale = FINISHES[colors.finish ?? "gloss"].envScale;
  // Metals that should mirror the player's actual surroundings — the
  // engine points these at the live cube probe alongside the paint.
  group.userData.reflectMats = reflectMats;
  // Brake-glow halos: the engine flares these with the tail lamps
  group.userData.tailGlowMats = tailGlowMats;

  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = !o.userData.noShadow;
    // And a car RECEIVES. It never used to — not one mesh on any car in
    // the game — so a car drove under a flyover in full moonlight, and
    // the car alongside you in a battle stayed lit through your own
    // shadow. Cars are the only thing on this road the player is looking
    // at; they were the one thing shadows could not touch.
    //
    // Same exclusion as casting: an unlit glow sprite or a lamp lens has
    // no business being darkened, and MeshBasicMaterial ignores this
    // anyway.
    o.receiveShadow = !o.userData.noShadow;
  });

  // Real-world sizing. The profiles are authored a little oversized, and
  // a flat 1.12 "presence" multiplier on top left every car 15-31% larger
  // than the machine it evokes — a 2.15 m wide RX-7 is wider than a
  // pickup, and the tyres came out 0.81 m across. Each style now carries
  // the factor that lands it on its real dimensions.
  //
  // The scale stays uniform on purpose: the wheels spin about their own
  // axis, so a non-uniform group scale would sweep them into ellipses.
  // That means length and width cannot both be exact, so the factor is
  // the geometric mean of the two corrections — every car ends up within
  // ~5% on all three axes, with tyres at a correct 0.64-0.70 m.
  //
  // Collision sizes are engine constants and are deliberately untouched.
  //
  // A car with a published length is FITTED to it rather than scaled by
  // a table: the shell is measured nose to tail exactly the way the size
  // test measures it — solid, shadow-casting bodywork, no glass and no
  // contact blob — and scaled until that measurement is the number on
  // the card. Two things follow from doing it this way. The length is
  // exact by construction rather than exact until somebody edits a
  // profile, and the WIDTH lands on the real machine's width for free,
  // because the extrusion depths were tuned to be right at a scale that
  // carried the 1.12 presence factor and this scale is that one divided
  // by 1.12.
  let scale = STYLE_SCALE[style];
  if (colors.lengthM && colors.lengthM > 1) {
    // World boxes, not local ones. Plenty of this car is nested — the
    // wheels are groups, the driver is a rig — and a child's own matrix
    // is relative to its parent, so measuring with it puts a wheel at
    // the origin and a bumper somewhere it is not.
    group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    let minZ = Infinity;
    let maxZ = -Infinity;
    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.noShadow) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && (m.transparent || (m.opacity ?? 1) < 1)) return;
      box.setFromObject(o);
      if (box.min.z < minZ) minZ = box.min.z;
      if (box.max.z > maxZ) maxZ = box.max.z;
    });
    const raw = maxZ - minZ;
    if (raw > 1) scale = colors.lengthM / raw;
  }
  /**
   * And the width, which the length fit cannot also get right.
   *
   * One more scale factor, on x alone, taking the door skin to the width
   * a car of this silhouette and this length actually is. The shell's
   * own half-width is already measured — flankX, which everything on the
   * flank is hung off — so this is the fit the length gets, applied to
   * the other axis.
   *
   * The wheels and the driver take it back off again. A tyre stretched
   * 12% along its axis is a tyre that is 12% too fat, and a person 12%
   * wider is a person; the body widening is the point, and they are
   * bolted to it rather than part of it. Their POSITIONS still move
   * outboard with the body, which is what widening a car does to its
   * track, and only their own geometry is held.
   */
  let widthFix = 1;
  if (colors.lengthM && colors.lengthM > 1) {
    const want = bodyWidthFor(style, colors.lengthM);
    const have = flankX * 2 * scale;
    if (have > 0.5) widthFix = THREE.MathUtils.clamp(want / have, 0.8, 1.25);
  }
  group.scale.set(scale * widthFix, scale, scale);
  if (widthFix !== 1) {
    for (const w of wheels) w.scale.x = 1 / widthFix;
  }
  group.userData.bodyWidth = flankX * 2 * scale * widthFix;
  /**
   * The wheel's radius IN THE WORLD, after that scale.
   *
   * Recorded rather than assumed, because the assumption was wrong on
   * every car in the game. The engine turned every wheel at v / 0.36 —
   * the local radius, correct before these cars were fitted to their
   * real lengths — and the scale that fit ranges from 0.826 to 1.064,
   * so the wheels were 5.5% to 21.8% out. A wheel turning 22% too
   * slowly is a wheel skidding forward down a dry road at every speed,
   * which is the one thing about a car nobody has to be told to look
   * for.
   *
   * attract.ts had this right from the day it was written — it measures
   * the built wheel because "the silhouettes carry different scale
   * factors, so the same tyre is a different size on each of them". The
   * menu rolled correctly and the game did not.
   */
  group.userData.wheelR = TIRE_RADIUS * scale;
  // And its silhouette, so a road full of built cars can be asked what
  // it is made of (tests/police.mjs counts the traffic mix off this).
  group.userData.style = style;
  // And its length, for the verge: a car's wake pushes the planting
  // beside it and pulls it back in behind, and where "beside" ends is
  // this number. Absent on a shell built without a model (4.5 m then).
  if (colors.lengthM && colors.lengthM > 1) group.userData.lengthM = colors.lengthM;
  /**
   * The wheel layout, stated rather than inferred.
   *
   * spinWheels used to read the car's geometry out of the ARRAY ORDER —
   * wheels[0].z minus wheels[2].z for the wheelbase, wheels[1].x minus
   * wheels[0].x for the track, and `i >= 2` for which ones drive. That
   * is correct for four wheels in the order this file happens to build
   * them and silently wrong for anything else: on a three-wheeler the
   * track comes out half of itself and negative, and one of the two
   * driven wheels reads as a steering wheel.
   *
   * So the builder says what it built. It is the only thing that knows.
   */
  group.userData.wheelPlan = {
    /** How many of the leading entries steer; the rest are driven. */
    front: frontCount,
    /** Axle to axle, in the group's own units. */
    wheelbase: wzF - wzR,
    /** Centre to centre across the DRIVEN axle, which is the one that
     *  always has two wheels on it — a delta's front has one, and a
     *  track measured across it would be zero. */
    track: wheelX * 2,
  };

  // Swap in the Blender-authored shells and wheels when they arrive.
  // Traffic keeps the cheap procedural build — thirty cars don't need
  // the density, and they never come close enough to the camera to show it.
  // Somebody is driving this — every car, not just the hero ones.
  // Right-hand drive, hands on the wheel by IK rather than parented to
  // it, so the arms answer the steering. Traffic gets the lean build
  // (torso, head, helmet, two arms) because a background driver is a
  // silhouette behind glass; what matters is that the seat is not
  // empty, which is what thirty driverless cars looked like.
  {
    // The demon's driver wears the car. livery rather than trike: it is
    // the MARK that makes this machine what it is, and if the horned
    // badge ever goes on something with four wheels the driver should
    // still match it.
    const demonDriver = colors.livery === "demon";
    const driver = kuwaitiDriver(
      demonDriver ? 0x0e0d11 : 0x1d2026,
      undefined,
      colors.simple === true,
      demonDriver
    );
    driver.group.position.set(DRIVER_X, seatY, headZ - RIG.driver.headZ);
    seatRiders.push(driver.group);
    // Seated in a car that has been widened, not widened with it.
    if (widthFix !== 1) driver.group.scale.x = 1 / widthFix;
    group.add(driver.group);
    group.userData.driver = driver;
    // One solve at build, so the rest pose IS a driving pose.
    //
    // The shoulders are created with a position and no rotation
    // (characters.ts), so until a solver runs, both arms hang straight
    // down through the dash. The legs never had this problem — they get
    // authored rest angles — which is how the "reads as seated before a
    // solver runs" promise came to be true only below the waist. The
    // engine solves the six nearest traffic rigs and every hero car, so
    // the bug lived exclusively on traffic car seven and beyond: close
    // enough to see, never close enough to be solved.
    //
    // dt=1 turns every ease factor min(1, dt*rate) into 1 — the slowest
    // rig rate is 5 — so one call snaps the whole rig to a settled
    // straight-ahead pose: hands on the rim, eyes down the road.
    driver.group.updateWorldMatrix(true, false);
    const restLook = new THREE.Vector3(0, RIG.driver.lookHeight, lookAheadFor(0));
    driver.group.localToWorld(restLook);
    solveDriverRig(driver, 0, 0, 0, restLook, 1);
  }

  if (!colors.simple) {
    upgradeCarShells(group, style);
    upgradeWheels(group);
    // The driver too — helmet, visor, gloves, rim and pedal faces. The
    // rig is a child of this group, so one call covers every car that
    // carries one: yours, the rival's, and the cruisers online.
    upgradeDriver(group);
  }

  if (colors.underglow !== undefined) {
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 5.6),
      new THREE.MeshBasicMaterial({
        map: poolGlowTexture(),
        color: colors.underglow,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    glow.castShadow = false;
    group.add(glow);
  }

  return group;
}
