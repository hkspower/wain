// The garage — parts catalog, owned/equipped state (localStorage), and
// the tuning effects the engine applies to the handling model.
// Currency is KD, earned by defeating rivals.

// The two type-only names are imported as types, which is not a style
// preference: node's --experimental-strip-types erases them at runtime,
// so a value import of `EngineId` makes this module unloadable outside a
// bundler. That blocked every node-side test of anything downstream of
// mods.ts — the drivetrain and area-guide tests both hit it — for a
// reason that had nothing to do with what they were testing.
import { getEngine } from "./engines";
import type { EngineId, EngineSpec } from "./engines";
import { loadCrew, type Crew } from "./teams";
import type { Drivetrain } from "./grip";
import { HANDLING } from "./handling";
import {
  PAINTS, PAINT_HEX, GLOW_HEX, COVER_HEX, CARBON_KG, NOMINAL_CAR_KG,
  swatch, type PaintFamily, type CarbonLevel,
} from "./paints";

export type ExclusiveCat =
  | "engine"
  | "lamps"
  | "finish"
  | "aspiration"
  | "intake"
  | "brakes"
  | "exhaust"
  | "tires"
  | "gearbox"
  | "paint"
  | "glow"
  | "cover"
  | "carbon";
export type Category = ExclusiveCat | "internals" | "chassis" | "extras";

/** Slots where equipping one part unequips the previous one. */
export const EXCLUSIVE_CATS: ReadonlySet<string> = new Set([
  "engine",
  "aspiration",
  "intake",
  "brakes",
  "exhaust",
  "tires",
  "gearbox",
  "paint",
  "glow",
  "lamps",
  "finish",
  "cover",
  "carbon",
]);

export interface Part {
  id: string;
  cat: Category;
  name: string;
  ar: string;
  price: number;
  desc: string;
}

export const PARTS: Part[] = [
  // Engine — exclusive, and the deepest choice in the garage. Written
  // out rather than generated from ENGINES: a spread is invisible to
  // every static tool that reads this file, and check:parts caught
  // exactly that — five parts in the catalogue that it could not see and
  // therefore could not tell you were unreachable. The drift risk that
  // buys is covered instead by an assertion, in check-catalogue.mjs,
  // that these ids and engines.ts agree in both directions.
  { id: "engine-i4-16", cat: "engine", name: "Sadu 1.6 VTC · I4", ar: "سدو ١٫٦", price: 900, desc: "4 cylinders, 1.6L, 8,400 rpm. Dead below half revs, then it screams — keep it on the cam or it does nothing at all" },
  { id: "engine-i4-20t", cat: "engine", name: "Bahri 2.0T · I4", ar: "بحري ٢٫٠ تيربو", price: 2200, desc: "4 cylinders, 2.0L, 6,800 rpm. A hard shove through the middle of every gear and nothing left up top" },
  { id: "engine-f6-25", cat: "engine", name: "Nejma Flat-Six · F6", ar: "نجمة ٢٫٥", price: 3800, desc: "6 cylinders, 2.5L, 7,800 rpm. Pulls from the middle and keeps going — and sits lower in the car than anything else here" },
  { id: "engine-i6-30tt", cat: "engine", name: "Sahil 3.0 TT · I6", ar: "ساحل ٣٫٠", price: 5200, desc: "6 cylinders, 3.0L, 7,000 rpm. Flat as a table from 2,000 to the limiter — no gear is the wrong gear" },
  { id: "engine-v8-57", cat: "engine", name: "Ghazi 5.7 V8 · V8", ar: "غازي ٥٫٧", price: 6500, desc: "8 cylinders, 5.7L, 6,200 rpm. Torque from idle, done by 6,200, and it lopes at every traffic light on the corniche" },
  // Aspiration — exclusive; the heart of the build
  { id: "turbo", cat: "aspiration", name: "Turbo Kit", ar: "تيربو", price: 1200, desc: "+25% power on boost, +20 km/h governor, blow-off on lift" },
  { id: "supercharger", cat: "aspiration", name: "Supercharger", ar: "سوبرتشارج", price: 1500, desc: "+30% power everywhere, +14 km/h governor, whine included" },
  { id: "twin-turbo", cat: "aspiration", name: "Twin Turbo", ar: "تيربو مزدوج", price: 2800, desc: "+45% on full boost, fast spool, +40 km/h governor" },
  // Internals — additive, always active once owned
  { id: "ecu", cat: "internals", name: "ECU Tune", ar: "برمجة", price: 400, desc: "+8% power" },
  // Exhaust — exclusive tiers. Every one of them is audible before it is
  // visible, which is the point of buying one.
  { id: "exhaust", cat: "exhaust", name: "Sport Cat-Back", ar: "دبة رياضية", price: 350, desc: "+7% power. Drops the voice and lets it bark on a lift" },
  { id: "exhaust-square", cat: "exhaust", name: "Square Twin-Tip", ar: "دبة مربعة", price: 520, desc: "+8% power. Two squared-off tips — a different car from behind" },
  { id: "exhaust-race", cat: "exhaust", name: "Race Straight-Pipe", ar: "دبة سباق", price: 900, desc: "+11% power. No silencer left: raw, loud, and it spits flame" },
  { id: "exhaust-twin", cat: "exhaust", name: "Twin-Tube Split", ar: "دبة مزدوجة", price: 1350, desc: "+12% power. One straight-through split into four: two tubes a side, and it barks" },
  { id: "exhaust-ti", cat: "exhaust", name: "Titanium Quad", ar: "دبة تيتانيوم", price: 1800, desc: "+14% power. Four burnt-blue tips and a hard metallic rasp" },
  // Intake — exclusive tiers. The basic one is free and comes fitted to
  // every new car, so the very first thing a player sees in the shop is
  // something they already own rather than a wall of things they cannot
  // afford. It also gives the Cold Intake something to be better THAN,
  // which a lone 250 KD part never had.
  { id: "intake-basic", cat: "intake", name: "Panel Filter", ar: "فلتر عادي", price: 0, desc: "+2% power. The basic panel filter, fitted from new — yours already" },
  { id: "intake", cat: "intake", name: "Cold Intake", ar: "فلتر مفتوح", price: 250, desc: "+5% power. Open cone, cold feed, and an induction growl you can hear" },
  // Brakes — exclusive tiers
  { id: "brakes-sport", cat: "brakes", name: "Sport Brakes", ar: "بريك رياضي", price: 500, desc: "Braking 26 → 32" },
  { id: "brakes-race", cat: "brakes", name: "Racing Brakes", ar: "بريك سباق", price: 1000, desc: "Braking 26 → 38" },
  { id: "brakes-carbon", cat: "brakes", name: "Carbon Ceramic", ar: "سيراميك", price: 1800, desc: "Braking 26 → 44" },
  // Tires — exclusive tiers (grip + curve stability)
  { id: "tires-sport", cat: "tires", name: "Sport Tires", ar: "تواير رياضية", price: 400, desc: "More grip, calmer sweepers" },
  { id: "tires-race", cat: "tires", name: "Racing Tires", ar: "تواير سباق", price: 900, desc: "Serious grip" },
  { id: "tires-slick", cat: "tires", name: "Slicks", ar: "سليك", price: 1600, desc: "Maximum grip, glued to the corniche" },
  { id: "tires-drift", cat: "tires", name: "Drift Tires", ar: "تواير تفحيط", price: 1100, desc: "Less grip on purpose: bigger angles, slower to snap back, more style points" },
  // Gearbox — exclusive. The same engine, geared for a different fight.
  { id: "gearbox-close", cat: "gearbox", name: "Close-Ratio Box", ar: "قير قصير", price: 1400, desc: "+20% acceleration, 16 km/h off the governor — for the corniche, not the straight" },
  { id: "gearbox-tall", cat: "gearbox", name: "Tall Final Drive", ar: "قير طويل", price: 1400, desc: "−12% acceleration for 16 km/h more governor — for the long inland run" },
  // Chassis — additive, always active once fitted. These are the parts
  // that argue with the tire model rather than the engine.
  { id: "lsd", cat: "chassis", name: "Limited-Slip Diff", ar: "دفرنس", price: 1300, desc: "Both rear tires pull: far less wheelspin off the line, and a slide you can steer" },
  { id: "coilovers", cat: "chassis", name: "Coilovers", ar: "مساعدات", price: 900, desc: "Stiffer platform: the nose still turns in under heavy braking" },
  { id: "cage", cat: "chassis", name: "Roll Cage", ar: "قفص حماية", price: 1500, desc: "Rigid shell: contact costs far less speed and SP — the price is a little weight" },
  { id: "rack", cat: "chassis", name: "Quick Steering Rack", ar: "دركسون سريع", price: 700, desc: "Faster hands: the car answers the wheel almost immediately" },
  // Extras — additive
  { id: "weight", cat: "extras", name: "Weight Reduction", ar: "تخفيف وزن", price: 800, desc: "+10% power, +3 braking" },
  { id: "nos", cat: "extras", name: "NOS Kit", ar: "نيترو", price: 1000, desc: "Hold N for a 3-second shove; recharges slowly" },
  { id: "spoiler", cat: "extras", name: "GT Wing", ar: "جناح", price: 300, desc: "Downforce: steadier at speed" },
  { id: "gold-rims", cat: "extras", name: "Gold Rims", ar: "رنجات ذهب", price: 600, desc: "Pure Salmiya energy" },
  { id: "stickers", cat: "extras", name: "Rally Sticker Pack", ar: "ملصقات", price: 450, desc: "Door roundels, beltline stripes, hood decal, Kuwait flag on the fender" },
  { id: "sticker-full", cat: "extras", name: "Full-Length Side Graphic", ar: "ملصق جانبي كامل", price: 380, desc: "One sticker from the nose to the tail, cut to follow the body. Sits under the rally pack, so the two can be worn together" },
  // Headlamps. Exclusive, because a lamp is either tinted, missing or
  // neither — you cannot smoke a headlight you have taken out.
  { id: "lamps-smoked", cat: "lamps", name: "Smoked Headlights", ar: "شمعات مدخنة", price: 550, desc: "Tinted lenses. Two dark slots by day, a dull amber at night — and the beam dims with them" },
  { id: "lamps-single", cat: "lamps", name: "One-Eye Delete", ar: "شمعة وحدة", price: 700, desc: "One headlight out, mesh screen over the hole. The car really does run on one beam" },
  // Paint — exclusive, equip freely once owned
  { id: "paint-white", cat: "paint", name: "Factory Finish", ar: "لون الوكالة", price: 0, desc: "The colour it left the showroom in" },
  { id: "paint-black", cat: "paint", name: "Midnight Black", ar: "أسود", price: 150, desc: "" },
  { id: "paint-red", cat: "paint", name: "Falcon Red", ar: "أحمر", price: 150, desc: "" },
  { id: "paint-gold", cat: "paint", name: "Desert Gold", ar: "ذهبي", price: 250, desc: "" },
  { id: "paint-teal", cat: "paint", name: "Towers Teal", ar: "فيروزي", price: 200, desc: "" },
  { id: "paint-silver", cat: "paint", name: "Corniche Silver", ar: "فضي", price: 150, desc: "" },
  { id: "paint-gunmetal", cat: "paint", name: "Gunmetal", ar: "رصاصي", price: 200, desc: "" },
  { id: "paint-navy", cat: "paint", name: "Deep Navy", ar: "كحلي", price: 200, desc: "" },
  { id: "paint-orange", cat: "paint", name: "Sunset Orange", ar: "برتقالي", price: 250, desc: "" },
  { id: "paint-purple", cat: "paint", name: "Salmiya Purple", ar: "بنفسجي", price: 250, desc: "" },
  { id: "paint-lime", cat: "paint", name: "Acid Lime", ar: "ليموني", price: 300, desc: "" },
  { id: "paint-sand", cat: "paint", name: "Desert Sand", ar: "رملي", price: 200, desc: "" },
  { id: "paint-maroon", cat: "paint", name: "Maroon", ar: "عنابي", price: 200, desc: "" },
  // The rest of the booth. Every one of these had to clear a CIEDE2000
  // floor against every colour already here before it was allowed in —
  // see tests/paints.mjs. Two of them did not on the first try: the
  // yellow was nine units from Desert Gold and the coral nine from
  // Sunset Orange, which is one colour sold twice.
  { id: "paint-slate", cat: "paint", name: "Slate Grey", ar: "رمادي", price: 200, desc: "" },
  { id: "paint-bronze", cat: "paint", name: "Bronze", ar: "برونزي", price: 200, desc: "" },
  { id: "paint-olive", cat: "paint", name: "Olive Drab", ar: "زيتي", price: 200, desc: "" },
  { id: "paint-palm", cat: "paint", name: "Palm Green", ar: "أخضر النخل", price: 250, desc: "" },
  { id: "paint-gulf", cat: "paint", name: "Gulf Blue", ar: "أزرق الخليج", price: 250, desc: "" },
  { id: "paint-mint", cat: "paint", name: "Mint", ar: "نعناعي", price: 250, desc: "" },
  { id: "paint-ice", cat: "paint", name: "Ice Blue", ar: "ثلجي", price: 250, desc: "" },
  { id: "paint-rose", cat: "paint", name: "Rose", ar: "وردي", price: 250, desc: "" },
  { id: "paint-coral", cat: "paint", name: "Coral", ar: "مرجاني", price: 250, desc: "" },
  { id: "paint-yellow", cat: "paint", name: "Sun Yellow", ar: "أصفر", price: 250, desc: "" },
  // Finish — exclusive, and orthogonal to colour. Any colour can be had
  // in any of the three.
  { id: "finish-gloss", cat: "finish", name: "Gloss Lacquer", ar: "لمعة", price: 0, desc: "Clearcoat over metallic base — the way it left the showroom" },
  { id: "finish-satin", cat: "finish", name: "Satin / Low Gloss", ar: "نص لمعة", price: 700, desc: "A soft sheen instead of a mirror. Reflections spread out and follow the curve of a panel rather than skipping across it" },
  { id: "finish-matte", cat: "finish", name: "Matte Wrap", ar: "مطفي", price: 1100, desc: "No clearcoat at all. Reads as pigment, and the shape of the bodywork does all the work" },
  // Underglow — exclusive
  { id: "glow-none", cat: "glow", name: "No Underglow", ar: "بدون", price: 0, desc: "" },
  { id: "glow-cyan", cat: "glow", name: "Cyan Glow", ar: "سماوي", price: 200, desc: "" },
  { id: "glow-green", cat: "glow", name: "Green Glow", ar: "أخضر", price: 200, desc: "" },
  { id: "glow-purple", cat: "glow", name: "Purple Glow", ar: "بنفسجي", price: 200, desc: "" },
  { id: "glow-red", cat: "glow", name: "Red Glow", ar: "أحمر", price: 200, desc: "" },
  { id: "glow-amber", cat: "glow", name: "Amber Glow", ar: "كهرماني", price: 200, desc: "" },
  { id: "glow-pink", cat: "glow", name: "Pink Glow", ar: "زهري", price: 200, desc: "" },
  { id: "glow-white", cat: "glow", name: "White Glow", ar: "أبيض", price: 250, desc: "" },
  // Engine covers — exclusive. The cam cover is the only part of an
  // engine anybody outside the car ever sees, and buying one cuts the
  // vents in the bonnet that let you see it: a cover under a sealed
  // bonnet is money spent on a thing that is not there.
  { id: "cover-none", cat: "cover", name: "Stock Cover", ar: "غطاء عادي", price: 0, desc: "Black plastic, bonnet shut over it" },
  { id: "cover-red", cat: "cover", name: "Crackle Red", ar: "أحمر مجعد", price: 350, desc: "Wrinkle-finish red, and vents cut in the bonnet to see it through" },
  { id: "cover-blue", cat: "cover", name: "Cobalt Cover", ar: "أزرق", price: 350, desc: "" },
  { id: "cover-black", cat: "cover", name: "Wrinkle Black", ar: "أسود مجعد", price: 300, desc: "" },
  { id: "cover-gold", cat: "cover", name: "Gold Cam Cover", ar: "ذهبي", price: 450, desc: "" },
  { id: "cover-alloy", cat: "cover", name: "Polished Alloy", ar: "ألمنيوم ملمع", price: 400, desc: "" },
  { id: "cover-green", cat: "cover", name: "Racing Green Cover", ar: "أخضر", price: 350, desc: "" },
  // Carbon — exclusive, and the only mod in the game that is bought for
  // what it TAKES OFF the car. Every car can wear it; nothing is
  // reserved for a class.
  { id: "carbon-none", cat: "carbon", name: "Steel Panels", ar: "حديد", price: 0, desc: "What it left the factory with" },
  { id: "carbon-panels", cat: "carbon", name: "Carbon Package", ar: "باكيج كاربون", price: 1800, desc: "Dry carbon bonnet, boot lid and mirror caps — 22 kg off the car, and the weave shows" },
  { id: "carbon-full", cat: "carbon", name: "Full Dry Carbon", ar: "كاربون كامل", price: 3200, desc: "The package plus the roof skin and every aero panel — 38 kg off, most of it high up where it matters most" },
];

/**
 * An exhaust system, as the car and the ear see it.
 *
 * Every field here is consumed somewhere: `tips`/`bore`/`finish` by the
 * geometry in cars.ts, `pitch`/`rasp`/`loud` by the exhaust voice in
 * sound.ts, `pop` by the backfire — its crack and the size of the flame.
 * The old build had a single `exhaustLevel: 0 | 1` that nothing read at
 * all, so the part that advertised "+7% power, deeper voice" delivered
 * the power and none of the voice.
 */
export interface ExhaustSpec {
  id: "stock" | "sport" | "race" | "titanium" | "square" | "twin";
  /** Tips out the back, and how wide each bore is in metres. */
  tips: number;
  bore: number;
  /**
   * The shape of the tip itself.
   *
   * Every exhaust in this game used to be a round cylinder and only the
   * count, the bore and the finish changed — which is not how exhausts
   * differ. A squared-off quad and a stack of round tubes read as
   * completely different cars from ten metres behind, and that view is
   * the one a rival spends the whole race looking at.
   */
  shape: "round" | "square" | "oval";
  /**
   * Tubes per exit. One is a tip; two is a pair clustered on each side
   * of the car, the way a straight-through system that has been split
   * comes out. `tips` is the total, so four tips at two per side is two
   * clusters and not four separate holes across the bumper.
   */
  perSide: number;
  finish: "steel" | "chrome" | "ceramic" | "titanium";
  /** Multiplier on the exhaust band's centre frequency. Under one is a
   *  deeper car; a straight pipe drops further than a cat-back can. */
  pitch: number;
  /** Resonance and level of the rasp, against stock. */
  rasp: number;
  loud: number;
  /**
   * The balance of the three bands the pipe speaks in, against stock.
   *
   * An exhaust is not one sound with a volume knob. It is a boom you
   * feel in the floor, a bark in the middle of your hearing, and a rasp
   * on top — and what makes a straight pipe different from a titanium
   * quad is not that one is louder, it is WHICH of those three it leans
   * on. A single band could only ever say "more exhaust"; three can say
   * deep, or hard, or metallic, which is the difference a player is
   * actually buying.
   *
   * low  — the boom. Rises with LOAD, not revs: an engine pulling hard
   *        at 2,000 rpm booms, and the same engine free-revving does not.
   * mid  — the bark. The old single band, and still where the cross-plane
   *        lope is applied, because that is where it is audible.
   * high — the rasp. Rises with revs; this is the metallic edge that only
   *        arrives near the top of a gear.
   */
  tone: { low: number; mid: number; high: number };
  /** How hard it barks on a lift: the crack, and the flame with it. */
  pop: number;
  /** Power, as a fraction added to the accel multiplier. */
  power: number;
}

export const EXHAUSTS: Record<string, ExhaustSpec> = {
  stock: { id: "stock", tips: 2, perSide: 1, bore: 0.05, shape: "round", finish: "steel", pitch: 1, rasp: 1, loud: 1, pop: 1, power: 0, tone: { low: 1, mid: 1, high: 1 } },
  // A cat-back keeps the catalyst and the silencer: deeper and louder,
  // still civil.
  exhaust: { id: "sport", tips: 2, perSide: 1, bore: 0.068, shape: "round", finish: "chrome", pitch: 0.88, rasp: 1.35, loud: 1.3, pop: 1.45, power: 0.07, tone: { low: 1.5, mid: 1.15, high: 0.8 } },
  // Squared tips, one a side. A different car from the back for the
  // same money as the round one, which is the point of it — the tone is
  // a cat-back's tone because the plumbing ahead of the tip is a
  // cat-back's plumbing.
  "exhaust-square": { id: "square", tips: 2, perSide: 1, bore: 0.082, shape: "square", finish: "chrome", pitch: 0.86, rasp: 1.4, loud: 1.35, pop: 1.5, power: 0.08, tone: { low: 1.5, mid: 1.15, high: 0.8 } },
  // Nothing left in the pipe to quieten it. Biggest bore, hardest bark.
  "exhaust-race": { id: "race", tips: 2, perSide: 1, bore: 0.09, shape: "round", finish: "ceramic", pitch: 0.76, rasp: 1.9, loud: 1.7, pop: 2.2, power: 0.11, tone: { low: 1.7, mid: 1.5, high: 1.9 } },
  // Twin tubes each side: one straight-through split into two, so four
  // holes in two clusters. Two smaller bores flow like one big one and
  // resonate higher, which is why a twin-tube system barks rather than
  // booms.
  "exhaust-twin": { id: "twin", tips: 4, perSide: 2, bore: 0.062, shape: "round", finish: "chrome", pitch: 0.82, rasp: 2.0, loud: 1.6, pop: 2.0, power: 0.12, tone: { low: 1.05, mid: 1.6, high: 1.7 } },
  // Four thin-wall tips. Lighter than the race system and higher-strung
  // with it — the rasp is metallic rather than deep.
  "exhaust-ti": { id: "titanium", tips: 4, perSide: 1, bore: 0.058, shape: "round", finish: "titanium", pitch: 0.86, rasp: 2.3, loud: 1.75, pop: 2.4, power: 0.14, tone: { low: 0.6, mid: 1.25, high: 2.4 } },
};

/**
 * How far a body leans, in degrees per g of cornering force.
 *
 * Body roll used to be one static constant in engine.ts, so a Jahra
 * Pickup leaned exactly as far as a race-kitted Zeta 300 GTR: 3.15
 * degrees at 1.43 g, every car in the fleet, which is about 2.2 deg/g.
 * That is a well-sorted sports car's figure handed to a pickup.
 *
 * Real roll gradients run from about 1 deg/g on a stiff track car to 6
 * or more on something tall on soft springs, and the physics is no
 * mystery: roll goes as the centre of gravity's height over the roll
 * stiffness. The two things this build knows that stand in for those are
 * the silhouette and what has been bolted to it.
 *
 * Known limit, stated rather than hidden: the Jahra Pickup is built on
 * the `sedan` silhouette, so it takes the saloon's 4.2 rather than the 6
 * or 7 a real pickup would lean. Fixing that properly means the pickup
 * getting a body style of its own, which is a bigger change than this.
 */
const ROLL_DEG_PER_G: Record<"sedan" | "zx" | "gtr" | "rx7" | "hatch" | "pony", number> = {
  // The low, wide coupes. Stiff by construction.
  zx: 2.4,
  rx7: 2.4,
  gtr: 2.6,
  // A long-nosed pony coupe sits higher and softer than a mid-engined car.
  pony: 3.0,
  // Road cars, and the ones that should visibly take a set in a corner.
  hatch: 4.0,
  sedan: 4.2,
};

/** What a wide-body kit does to that: arches come with the springs and
 *  bars to match. */
const ROLL_KIT_MULT: Record<KitLevel, number> = {
  street: 1,
  sport: 0.85,
  attack: 0.72,
};

/** Coilovers. Less lean is the single most VISIBLE thing stiffer springs
 *  do, and until now the part changed understeer and grip while the body
 *  went on leaning exactly as far as it had before. */
const ROLL_COILOVER_MULT = 0.65;

/** Degrees per g to the radians the renderer wants, at the 1.43 g the
 *  roll target is expressed against in engine.ts. */
const ROLL_REF_G = 14 / 9.81;
const rollMaxRad = (degPerG: number) => (degPerG * ROLL_REF_G * Math.PI) / 180;

/**
 * id to hex, for the renderer.
 *
 * Re-exported rather than defined here: the swatches live in paints.ts,
 * which owns nothing but colour, and this file owns nothing but what a
 * thing costs. Two files each holding half a paint was how the hub ended
 * up with a second, anonymous palette that did not match this one.
 */
export const PAINT_COLORS: Record<string, number> = PAINT_HEX;

/**
 * The palette, with its names, for anything that shows swatches outside
 * the garage — the hub's cruise-colour picker, chiefly.
 *
 * The join lives here rather than in paints.ts so that paints.ts imports
 * nothing: it is the bottom of the stack, and a colour that had to know
 * about the shop to know its own name would put a cycle in it.
 *
 * Picking a colour to be seen in online is not buying a tin, so this
 * carries no price and implies no ownership. What it fixes is that the
 * hub used to hold eight anonymous hexes of its own, which meant the
 * colour a player chose to be seen in was one the game could not name
 * and did not sell.
 */
export const PAINT_SWATCHES: Array<{
  id: string;
  hex: number;
  css: string;
  name: string;
  ar: string;
  family: PaintFamily;
}> = PAINTS.map((p) => {
  const part = PARTS.find((x) => x.id === p.id);
  return {
    id: p.id,
    hex: p.hex,
    css: swatch(p.hex),
    name: p.asColor ?? part?.name ?? p.id,
    ar: p.asColorAr ?? part?.ar ?? "",
    family: p.family,
  };
});

/**
 * How the lacquer is finished — and it is a separate axis from colour.
 *
 * Every car in this game has been a mirror, because there was one paint
 * material and its clearcoat was pinned at 1 with a near-zero roughness.
 * That is a gloss finish and it is only one of the three anybody
 * actually orders.
 *
 * - `gloss` — clearcoat over metallic base. What a car leaves a
 *   showroom in, and what this game has always drawn.
 * - `satin` — a low-gloss lacquer. Reflections are there but spread
 *   out; the horizon band becomes a soft sweep down the flank instead
 *   of a hard line. This is the finish that flatters bodywork, because
 *   a diffuse highlight follows a curve where a sharp one skips across
 *   it.
 * - `matte` — no clearcoat at all. Reads as pigment, kills the
 *   reflection almost entirely, and is the only finish where the SHAPE
 *   of a panel does all the work.
 *
 * Numbers, not adjectives: each is a clearcoat strength, a clearcoat
 * roughness and a basecoat roughness, so "low gloss" means something a
 * renderer can act on.
 */
export type PaintFinish = "gloss" | "satin" | "matte";

export interface FinishSpec {
  clearcoat: number;
  clearcoatRoughness: number;
  /** Added to the basecoat's own roughness. */
  roughnessAdd: number;
  /** Scales the environment contribution. */
  envScale: number;
}

export const FINISHES: Record<PaintFinish, FinishSpec> = {
  gloss: { clearcoat: 1, clearcoatRoughness: 0.13, roughnessAdd: 0, envScale: 1 },
  satin: { clearcoat: 0.45, clearcoatRoughness: 0.42, roughnessAdd: 0.16, envScale: 0.62 },
  matte: { clearcoat: 0, clearcoatRoughness: 1, roughnessAdd: 0.38, envScale: 0.3 },
};

/** The garage part id for each finish, and back again. */
export const FINISH_OF_PART: Record<string, PaintFinish> = {
  "finish-gloss": "gloss",
  "finish-satin": "satin",
  "finish-matte": "matte",
};

export const GLOW_COLORS: Record<string, number> = GLOW_HEX;

// ---------------------------------------------------------------- cars

export type CarClass = "supercar" | "sport" | "normal";

/**
 * How far a car is built. One step per band, and every car has one.
 *
 * - `street` — the basic shelf. A lip, a modest set of over-fenders,
 *   a stripe and a number. What a first car looks like after a month.
 * - `sport` — high performance. A real wing on posts, a splitter,
 *   skirts, arches you can see from the front, and a full livery.
 * - `attack` — supercars. The time-attack build: swan-neck wing,
 *   splitter, canards, vented hood, diffuser, the widest arches in the
 *   game, bronze wheels and teal calipers.
 *
 * Ordered, and the order is used — `kitAtLeast` compares by index rather
 * than by a chain of string equalities, so a part that belongs on sport
 * AND attack is written once.
 */
export type KitLevel = "street" | "sport" | "attack";

/** The ladder, weakest first. Index is the comparison. */
export const KIT_ORDER: KitLevel[] = ["street", "sport", "attack"];

/** Is `kit` at least `want`? The whole reason KitLevel is ordered. */
export function kitAtLeast(kit: KitLevel, want: KitLevel): boolean {
  return KIT_ORDER.indexOf(kit) >= KIT_ORDER.indexOf(want);
}

/** The kit a band wears. The band IS the kit level — that is what makes
 *  the showroom ladder mean something rather than being a price list. */
export const KIT_FOR_CLASS: Record<CarClass, KitLevel> = {
  normal: "street",
  sport: "sport",
  supercar: "attack",
};

export interface CarModel {
  id: string;
  name: string;
  ar: string;
  cls: CarClass;
  price: number;
  /** Body silhouette (cars.ts): sedan, zx wedge, gtr coupe, or rx7. */
  style?: "sedan" | "zx" | "gtr" | "rx7" | "hatch" | "pony";
  /**
   * How far the car is built, as a body kit. Every machine on this road
   * has been got at — nobody on the corniche at two in the morning is
   * driving something the way it left the showroom — so this is not
   * optional and there is no "stock" step in it.
   *
   * The three steps are the three bands, and they read from ten metres
   * away, which is the point: you should be able to tell what class of
   * thing has pulled alongside you before you can read its badge.
   */
  kit: KitLevel;
  /**
   * Which wheels it drives.
   *
   * Absent means rear, because that is what every car in this game was
   * until the physics could tell the difference — and one of them said
   * "AWD monster" in its own catalogue text while driving exactly like
   * the rear-driver parked beside it.
   *
   * It is not a performance number. It decides which axle's load the
   * engine may use, and the load transfer already being solved does the
   * rest: a rear-driver squats onto its driven wheels and finds grip, a
   * front-driver squats off them and loses it, and an all-wheel-drive
   * car barely notices pitch at all and pays a transfer case for the
   * privilege.
   */
  drive?: Drivetrain;
  /** A second colour, for cars that wear one from the factory. Drives
   *  the racing stripes; absent means the car is one colour. */
  accent?: number;
  /** Which stripes, when there is an accent. Absent is the centre bar. */
  stripes?: "single" | "twin";
  /** The finish it leaves the showroom in. Absent is gloss. */
  finish?: PaintFinish;
  /** What the car left the factory with. Every machine on the corniche
   *  has a heart before anybody opens the bonnet, and the showroom is
   *  where you meet it. */
  engine: EngineId;
  /**
   * Overall length, in metres. Nose to tail, the way a spec sheet
   * quotes it.
   *
   * This is DATA, not decoration: the shell is scaled until it measures
   * this, so the number on the card and the car in the mirror are the
   * same car. It replaced a hand-tuned scale factor per silhouette plus
   * a flat 1.12 "presence" multiplier over the whole fleet — which made
   * every machine in the game 12% longer than the one it evokes, and
   * meant the only way to know how long a car was was to measure it.
   */
  lengthM: number;
  /** Tank, litres. Real sizes for the shape of car: a three-door
   *  carries forty-odd, a pickup eighty. With the burn model in
   *  engines.ts this is what decides how far the machine goes between
   *  forecourts — and it is why the V8 pickup is not the free lunch its
   *  torque curve makes it look. */
  tankLitres: number;
  /** Base handling before garage mods. */
  power: number; // accel multiplier
  /** The car's governed top speed in km/h — an absolute limiter, not a
   *  bonus. Every car in the showroom has its own, 180 through 405, and
   *  the engine tunes its thrust curve so the number is the real
   *  terminal speed rather than an advertisement. */
  topSpeedKmh: number;
  grip: number; // lateral grip m/s²
  brake: number; // braking m/s²
  color: number; // factory paint
  desc: string;
  /**
   * Legends you have to beat before the showroom will sell it.
   *
   * Rarity had exactly one meaning here until now, and that meaning was
   * "expensive" — every machine on the corniche was for sale on the
   * first screen to anyone with the money, so the rarest car in the game
   * was a number with more zeros on it. A car nobody can have yet is a
   * different thing from a car nobody can afford yet.
   */
  locked?: { rivals: number };
  /**
   * Parts fitted before it leaves the lot, on top of the factory basics.
   *
   * For a machine that is sold already built. Bought, not free: the
   * price of the car IS the price of the build, which is why the one car
   * that has this costs more than the two next most expensive combined.
   */
  factoryBuild?: string[];
}

/** The showroom, richest metal first. */
export const CARS: CarModel[] = [
  {
    // THE ONE YOU CANNOT BUY
    //
    // The GTR homologation of the Zeta 300: the same long-nose wedge,
    // rebuilt around the twin-turbo six with the whole outside of the
    // car turned into aerodynamics — swan-neck wing, splitter, canards,
    // dive planes, skirts and a diffuser — and delivered with the full
    // house already bolted in. Nothing else in the game is quicker,
    // stops harder or holds on longer.
    //
    // Its price is not what makes it rare. The showroom will not sell it
    // at any price until every legend on the roster has been beaten,
    // which is the only thing in this game that money cannot buy.
    id: "zeta-300-gtr",
    drive: "awd",
    finish: "gloss",
    name: "Zeta 300 GTR",
    ar: "زيتا ٣٠٠ جي تي آر",
    cls: "supercar",
    kit: "attack",
    style: "zx",
    price: 240000,
    locked: { rivals: 8 },
    engine: "i6-30tt",
    lengthM: 4.53,
    tankLitres: 70,
    power: 1.7,
    topSpeedKmh: 405,
    grip: 18,
    brake: 46,
    color: 0x3b2a5a, // midnight purple, and only ever midnight purple
    desc: "The homologation car. Full aero shell, twin-turbo six, and the entire catalogue fitted at the factory. Beat every legend on the road and it is yours to buy — until then it is not for sale.",
    // Everything that is strictly an upgrade. Both gearboxes are
    // deliberately absent: close-ratio trades 16 km/h of governor for
    // acceleration and tall trades the other way, so neither is an
    // improvement on a car built to do both — they are choices, and
    // this one is delivered with the factory's.
    factoryBuild: [
      "twin-turbo",
      "intake",
      "ecu",
      "exhaust-ti",
      "brakes-carbon",
      "tires-slick",
      "lsd",
      "coilovers",
      "cage",
      "rack",
      "weight",
      "nos",
    ],
  },
  {
    id: "efreet-rx-kai",
    drive: "rwd",
    finish: "satin",
    name: "Efreet RX Kai",
    ar: "كبير العفاريت",
    cls: "supercar",
    kit: "attack",
    style: "rx7",
    price: 120000,
    engine: "i6-30tt",
    lengthM: 4.42,
    tankLitres: 55,
    power: 1.66,
    topSpeedKmh: 400,
    grip: 17.5,
    brake: 44,
    color: 0xf2b90d, // competition yellow
    desc: "One-off time-attack build on the twin-turbo six — swan-neck wing, canards, bronze forged wheels. The fastest thing on Gulf Road that money alone can buy.",
  },
  {
    id: "sahara-v12",
    drive: "rwd",
    finish: "gloss",
    name: "Sahara GT-12",
    ar: "صحارى",
    cls: "supercar",
    kit: "attack",
    style: "zx",
    price: 96000,
    engine: "v8-57",
    lengthM: 4.62,
    tankLitres: 90,
    power: 1.62,
    topSpeedKmh: 385,
    grip: 16.4,
    brake: 42,
    color: 0xb8860b,
    desc: "Quad-cam V8 hypercar. Nothing on the corniche leaves a corner harder.",
  },
  {
    id: "falcon-720",
    drive: "rwd",
    finish: "matte",
    name: "Falcon 720 Veloce",
    ar: "الصقر ٧٢٠",
    cls: "supercar",
    kit: "attack",
    style: "zx",
    price: 71000,
    engine: "v8-57",
    lengthM: 4.54,
    tankLitres: 72,
    power: 1.5,
    topSpeedKmh: 360,
    grip: 15.8,
    brake: 40,
    color: 0xc1121f,
    desc: "Mid-engine V8, feather light, screams past 300.",
  },
  {
    id: "storm-s8",
    drive: "awd",
    finish: "gloss",
    name: "Desert Storm S8",
    ar: "عاصفة",
    cls: "supercar",
    kit: "attack",
    price: 54000,
    engine: "i6-30tt",
    lengthM: 4.8,
    tankLitres: 68,
    power: 1.4,
    topSpeedKmh: 335,
    grip: 15.2,
    brake: 38,
    color: 0x1f2933,
    desc: "All-wheel-drive missile. Launches like a catapult.",
  },
  {
    id: "anniversary-30",
    drive: "rwd",
    finish: "gloss",
    name: "Bareed 30 Anniversary",
    ar: "بريد ٣٠",
    cls: "sport",
    kit: "sport",
    style: "pony",
    price: 35000,
    engine: "v8-57",
    // 4.92 m of it, and almost none of that behind the driver.
    lengthM: 4.92,
    tankLitres: 61,
    power: 1.31,
    topSpeedKmh: 300,
    // Live rear axle and a lot of torque: it goes where it is pointed
    // until it does not, and then it goes sideways.
    grip: 12.4,
    brake: 33,
    color: 0xf2f2ee, // arctic white, and it wears the stripes
    accent: 0xf04b16, // the orange over the top
    stripes: "twin",
    desc: "Anniversary white with twin orange over the top. Long nose, live axle, 5.7 V8 — it turns in like a boat and leaves like a train.",
  },
  {
    id: "kaiju-r",
    drive: "awd",
    finish: "gloss",
    name: "Kaiju R",
    ar: "كايجو",
    cls: "supercar",
    kit: "attack",
    style: "gtr",
    price: 38000,
    engine: "i6-30tt",
    lengthM: 4.6,
    tankLitres: 74,
    power: 1.34,
    topSpeedKmh: 310,
    grip: 16.2, // AWD monster — nothing in the class sticks like it
    brake: 38,
    color: 0x3f66c4, // that blue
    desc: "Four round tails, boxed arches, AWD bite. Add the GT Wing to complete the legend.",
  },
  {
    id: "efreet-rx",
    drive: "rwd",
    finish: "satin",
    name: "Efreet RX",
    ar: "عفريت",
    cls: "sport",
    kit: "sport",
    style: "rx7",
    price: 31000,
    engine: "f6-25",
    lengthM: 4.3,
    tankLitres: 60,
    power: 1.3,
    topSpeedKmh: 295,
    grip: 14.8,
    brake: 35,
    color: 0xd7263d, // vintage rotary red
    desc: "Flat-six curves — pop-ups up, first light on the horizon, nothing else on the road.",
  },
  {
    id: "zeta-300",
    drive: "awd",
    finish: "gloss",
    name: "Zeta 300",
    ar: "زيتا ٣٠٠",
    cls: "sport",
    kit: "sport",
    style: "zx",
    price: 27000,
    engine: "i6-30tt",
    lengthM: 4.31,
    tankLitres: 70,
    power: 1.26,
    topSpeedKmh: 275,
    grip: 13.9,
    brake: 34,
    color: 0xc1272d, // golden-era JDM red
    desc: "Twin-turbo wedge from the golden era — one light bar, no grille, all nose.",
  },
  {
    id: "gulf-coupe-rs",
    drive: "fwd",
    finish: "gloss",
    name: "Gulf Coupe RS",
    ar: "كوبيه الخليج",
    cls: "sport",
    kit: "sport",
    style: "hatch",
    price: 33000,
    engine: "i4-20t",
    lengthM: 4.28,
    tankLitres: 50,
    power: 1.28,
    topSpeedKmh: 285,
    grip: 14.6,
    brake: 35,
    // The colour a fast three-door is supposed to be.
    color: 0xcb2027,
    desc: "Three-door hot hatch: short, upright, red stripe across the nose. Small car, big hurry."
  },
  {
    id: "salmiya-turbo",
    drive: "fwd",
    finish: "gloss",
    name: "Salmiya Turbo GT",
    ar: "تيربو السالمية",
    cls: "sport",
    kit: "sport",
    price: 24000,
    engine: "i4-20t",
    lengthM: 4.64,
    tankLitres: 60,
    power: 1.2,
    topSpeedKmh: 255,
    grip: 13.8,
    brake: 32,
    color: 0xb84dd6,
    desc: "The street favourite. Boost from every corner exit.",
  },
  {
    id: "hawally-2t",
    drive: "fwd",
    finish: "satin",
    name: "Hawally Sport 2.0T",
    ar: "حولي سبورت",
    cls: "normal",
    kit: "street",
    price: 16000,
    engine: "i4-20t",
    lengthM: 4.56,
    tankLitres: 55,
    power: 1.12,
    topSpeedKmh: 240,
    grip: 13.2,
    brake: 30,
    color: 0xf5c211,
    desc: "Cheap thrills with a real chassis under them.",
  },
  {
    id: "deera-sedan",
    drive: "fwd",
    finish: "gloss",
    name: "Deera Sedan",
    ar: "سيدان الديرة",
    cls: "normal",
    kit: "street",
    price: 8500,
    engine: "i4-20t",
    lengthM: 4.7,
    tankLitres: 60,
    power: 1.05,
    topSpeedKmh: 220,
    grip: 12.6,
    brake: 28,
    color: 0xdfe3e8,
    desc: "Comfortable, quiet, quicker than it looks.",
  },
  {
    id: "jahra-pickup",
    drive: "rwd",
    finish: "matte",
    name: "Jahra Pickup",
    ar: "ونيت الجهراء",
    cls: "normal",
    kit: "street",
    price: 6000,
    engine: "v8-57",
    // 5.16, and the number is a treaty between three measurements. This
    // car has no authored profile — it rides the sedan shell, and a
    // uniform scale carries width along with length, so at 5.35 m it
    // came out 2.27 m across, the widest thing in the game by 28 cm.
    // But the fleet-spread rule needs the pickup to stay the long end
    // of the range (a supermini and a pickup should not be within 1.2 m
    // of each other), which pins the length above 5.15. 5.16 lands the
    // width at 2.19 — a truck's honest share of a lane, banded as such
    // in the fitment tool — while keeping the spread the roster claims.
    // The real fix is an authored pickup profile, longer and narrower
    // than the sedan it borrows; until then this is the best the shell
    // can be.
    lengthM: 5.16,
    tankLitres: 80,
    power: 1.0,
    topSpeedKmh: 195,
    grip: 12.0,
    brake: 27,
    color: 0x6e7f8d,
    desc: "Heavy, honest, and it never dies.",
  },
  {
    id: "sharq-hatch",
    drive: "fwd",
    finish: "gloss",
    name: "Sharq Hatch",
    // It is called a hatch and it was built as a saloon. The hatch
    // profile is authored shorter and proportionally wider, which is
    // also the only way a 3.95 m car comes out 1.65 m wide instead of
    // 1.51 — a uniform scale carries width along with length.
    style: "hatch",
    ar: "شرق هاتش",
    cls: "normal",
    kit: "street",
    price: 2200,
    engine: "i4-16",
    lengthM: 3.95,
    tankLitres: 42,
    power: 0.98,
    topSpeedKmh: 205,
    grip: 12.4,
    brake: 27,
    color: 0x16a34a,
    desc: "Tiny, tossable, easy on the wallet.",
  },
  {
    id: "wain-special",
    drive: "rwd",
    finish: "satin",
    name: "Wain Special",
    ar: "وين سبيشال",
    cls: "normal",
    kit: "street",
    price: 0,
    engine: "i4-16",
    lengthM: 4.45,
    tankLitres: 50,
    power: 1.0,
    topSpeedKmh: 180,
    grip: 12.0,
    brake: 26,
    color: 0xf2f4f7,
    desc: "The car you showed up in. It owes you nothing.",
  },
];

/**
 * The three bands, in the words the showroom uses for them.
 *
 * Read from the cheap end, the fleet now runs five basic, four high
 * performance and six supercars. It used to be four, six and five, which
 * put a 16,000 KD saloon in the same band as a 38,000 KD coupe and left
 * the top of the showroom looking thin — two cars into the supercar
 * shelf and you had already met most of it.
 *
 * "SPORT CARS" became HIGH PERFORMANCE because the middle band is what
 * it is by what it does, not by what it looks like: a Salmiya Turbo is
 * not a sports car, it is a fast saloon, and so is most of that shelf.
 */
/*
 * Two scripts, two strings.
 *
 * These were one string each — "SUPERCARS · سوبر كار" — set in a label
 * class that letterspaces at 0.16em. Latin letterspacing is a typographic
 * choice; Arabic letterspacing is a typographic ERROR, because the script
 * is cursive and the letters join. Spacing them apart does not track the
 * word, it breaks it into disconnected glyphs. In one text node there is
 * no way to say so — the tracking applies to the whole run — so the two
 * halves are separate now and the Arabic half is set in .grn-ar, which
 * puts the spacing back to normal and reaches for the Arabic face.
 */
export const CLASS_LABELS: Record<CarClass, { en: string; ar: string }> = {
  supercar: { en: "SUPERCARS", ar: "سوبر كار" },
  sport: { en: "HIGH PERFORMANCE", ar: "أداء عالي" },
  normal: { en: "BASIC", ar: "أساسي" },
};

/** The pair as one string, for anywhere that can only carry one — the
 *  public API's `classLabel`, which is a data field and not type. */
export function classLabel(cls: CarClass): string {
  return `${CLASS_LABELS[cls].en} · ${CLASS_LABELS[cls].ar}`;
}

export function getCar(id: string): CarModel {
  return CARS.find((c) => c.id === id) ?? CARS[CARS.length - 1];
}

/**
 * How far the career has got — the number of legends beaten.
 *
 * The engine has owned this key since the day it was written and kept it
 * to itself, which was fine while nothing else needed to know. The
 * showroom needs to know now, and two files each holding their own copy
 * of a storage key is how a save ends up with two answers to the same
 * question. It lives here, next to the cars it gates.
 */
export const PROGRESS_KEY = "gulf-road-nights-progress";

export function rivalsBeaten(): number {
  try {
    const v = parseInt(localStorage.getItem(PROGRESS_KEY) ?? "0", 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function saveRivalsBeaten(n: number): void {
  try {
    localStorage.setItem(PROGRESS_KEY, String(n));
  } catch {}
}

/** How many more legends stand between the player and this car, or 0 if
 *  the showroom will sell it. */
export function lockedBy(car: CarModel, beaten = rivalsBeaten()): number {
  return Math.max(0, (car.locked?.rivals ?? 0) - beaten);
}

/** Stake tiers offered before a race; higher rivals allow bigger money. */
export const WAGERS = [250, 500, 1000, 2500, 5000, 10000, 25000];

/**
 * What has been bought for ONE car, and what that car is wearing.
 *
 * Parts belong to a machine, not to a player. A turbo in the Zeta is not
 * a turbo in the Deera — you buy it again, for that car, the way you
 * would have to. The garage used to hold a single owned list that
 * followed you into whatever you drove, so the first turbo upgraded all
 * fourteen cars at once and every car after your first arrived fully
 * built. That left the shop with nothing to sell and the driveway with
 * no reason to hold more than one machine.
 */
export interface CarBuild {
  owned: string[];
  equipped: Partial<Record<ExclusiveCat, string>>;
  /** Litres left in the tank, saved with the car.
   *
   * Fuel that resets on every load is fuel nobody has to think about,
   * and a petrol station nobody has to visit. Saved, it is a thing you
   * left in a state — which is the point of having it at all.
   *
   * Undefined means "never driven": a car leaves the lot full. */
  fuel?: number;
  /**
   * Window tint, 0 to 100 per cent.
   *
   * A slider rather than a part, because tint is not a thing you own —
   * it is a thing you chose, anywhere on a continuum, and three
   * purchasable steps would be a worse answer to the same question. 0
   * is factory glass; 100 is limo black, where you cannot make out the
   * driver at all.
   *
   * Per CAR rather than per save: tint is bodywork, and a player with
   * two cars has two opinions about it. Optional, so every save written
   * before this existed still loads as factory.
   */
  tint?: number;
}

/** Factory glass, for a build that has never been to the tint shop. */
export const DEFAULT_TINT = 0;

/** Clamp whatever a save or a slider hands us into 0..100. */
export function clampTint(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_TINT;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export interface GarageState {
  kd: number;
  /** Cars in the driveway, and the one currently being driven. */
  cars: string[];
  car: string;
  /** One build per car, keyed by car id. */
  builds: Record<string, CarBuild>;
}

/** A car as it leaves the lot: factory paint, no glow, nothing fitted —
 *  unless the car is sold already built, in which case its factory kit
 *  is bolted in and equipped here rather than left as a list somebody
 *  has to remember to apply. */
export function freshBuild(carId?: string): CarBuild {
  const build: CarBuild = {
    // The basic panel filter comes with the car, like the paint does.
    owned: ["paint-white", "glow-none", "intake-basic"],
    equipped: { paint: "paint-white", glow: "glow-none", intake: "intake-basic" },
  };
  const factory = carId ? CARS.find((c) => c.id === carId)?.factoryBuild : undefined;
  for (const id of factory ?? []) {
    const part = PARTS.find((p) => p.id === id);
    if (!part || build.owned.includes(id)) continue;
    build.owned.push(id);
    // An exclusive part is not fitted by owning it, which is exactly the
    // trap here: a "fully built" car whose parts were all in the boot.
    if (EXCLUSIVE_CATS.has(part.cat)) {
      build.equipped[part.cat as keyof CarBuild["equipped"]] = id;
    }
  }
  return build;
}

/**
 * Litres in the tank right now.
 *
 * The floor is the kind part. A car saved bone dry would load stranded
 * on the hard shoulder with no way to reach a pump and no way to earn
 * the KD for one — a save file that has locked itself. Anything below a
 * tenth of a tank comes back with a tenth, which is a few kilometres:
 * enough to reach a forecourt and not enough to pretend nothing
 * happened.
 */
export function fuelOf(g: GarageState, carId: string = g.car): number {
  const car = getCar(carId);
  const saved = buildOf(g, carId).fuel;
  if (saved === undefined) return car.tankLitres;
  return Math.max(car.tankLitres * 0.1, Math.min(car.tankLitres, saved));
}

/** Write the tank back. Called when a race ends and at the pump. */
export function setFuel(litres: number, carId?: string): number {
  const g = loadGarage();
  const id = carId ?? g.car;
  const capped = Math.max(0, Math.min(getCar(id).tankLitres, litres));
  editBuild(g, id).fuel = capped;
  saveGarage(g);
  return capped;
}

/** A car's build, for reading. Never writes: the shop asks about cars it
 *  has not bought yet, and a read should not conjure a driveway entry. */
export function buildOf(g: GarageState, carId: string = g.car): CarBuild {
  return g.builds[carId] ?? freshBuild(carId);
}

/** The stored build, created on demand — for code that is about to
 *  change it, so a newly bought machine needs no special case. */
export function editBuild(g: GarageState, carId: string = g.car): CarBuild {
  let b = g.builds[carId];
  if (!b) {
    b = freshBuild(carId);
    g.builds[carId] = b;
  }
  return b;
}

/** What a new save starts with, in KD. Also the referral bonus — see
 *  REFERRAL_KD — because doubling a new player's money is a real
 *  welcome and 10 KD to somebody with 4,000 is not. */
export const STARTING_KD = 10;

const KEY = "gulf-road-nights-garage";

export function loadGarage(): GarageState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const g = JSON.parse(raw) as GarageState;
      // A save from before builds were per-car carried one owned list at
      // the top level. It belongs to whatever was being driven when it
      // was written — nobody loses a part they paid for, and the rest of
      // the driveway starts clean, which is what it should have been.
      const legacy = g as unknown as Partial<CarBuild>;
      if (typeof g.kd === "number" && (Array.isArray(legacy.owned) || g.builds)) {
        // Saves from before the dealership existed start in the freebie
        if (!Array.isArray(g.cars) || g.cars.length === 0) g.cars = ["wain-special"];
        if (!g.car || !g.cars.includes(g.car)) g.car = g.cars[0];
        g.builds = g.builds ?? {};
        if (Array.isArray(legacy.owned)) {
          g.builds[g.car] = {
            owned: legacy.owned,
            equipped: legacy.equipped ?? {},
          };
          delete legacy.owned;
          delete legacy.equipped;
        }
        for (const id of g.cars) editBuild(g, id);
        for (const b of Object.values(g.builds)) {
          b.owned = b.owned ?? [];
          b.equipped = b.equipped ?? {};
          // The exhaust used to be an always-on internals part; it is an
          // exclusive slot now. A player who bought the old one keeps it,
          // fitted, rather than finding their car quiet and their money
          // gone.
          if (b.owned.includes("exhaust") && !b.equipped.exhaust) {
            b.equipped.exhaust = "exhaust";
          }
          // The same thing has now happened to the intake: it was an
          // always-on internals part and is an exclusive tier now. A
          // player who paid 250 KD for the Cold Intake keeps it fitted;
          // everybody else gets the free basic filter they would have
          // started with, so no existing save is left with an empty
          // slot and less power than a brand new one.
          if (!b.owned.includes("intake-basic")) b.owned.push("intake-basic");
          if (!b.equipped.intake) {
            b.equipped.intake = b.owned.includes("intake") ? "intake" : "intake-basic";
          }
        }
        return g;
      }
    }
  } catch {}
  return {
    // Ten dinars and the car you showed up in.
    //
    // It used to be 2,500, which bought the cheapest machine in the
    // showroom and a set of tyres before the player had turned a wheel —
    // and a game that hands you the shop on the first screen has spent
    // its progression before the first race. Ten buys nothing at all.
    // The first rival is worth 400, which is the point: the money comes
    // from the road.
    kd: STARTING_KD,
    cars: ["wain-special"],
    car: "wain-special",
    builds: { "wain-special": freshBuild("wain-special") },
  };
}

export function saveGarage(g: GarageState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {}
}

export function addKd(amount: number): number {
  const g = loadGarage();
  g.kd += amount;
  saveGarage(g);
  return g.kd;
}

// ------------------------------------------------------------ the shop
//
// Buying has been here since the showroom existed; this is the other
// half of a dealership. Selling is what turns a driveway into an
// economy: the choice between keeping the built-up Salmiya Turbo and
// trading it against the Falcon is a real decision only if the trade
// pays something, and it is only a DECISION if it pays less than you
// put in — a dealer who refunds the sticker is an undo button, and an
// undo button makes every purchase weightless.

/** What the dealer pays against the sticker price of the car itself. */
export const RESALE_CAR_FRAC = 0.62;

/** ...and against the aftermarket parts bolted to it. Lower, because a
 *  used mod is worth less than a used car: the next owner did not
 *  choose it. */
export const RESALE_PART_FRAC = 0.4;

/**
 * What the dealer will pay for this car, as it stands, parts included.
 *
 * Factory-fitted parts are deliberately NOT counted: on the one machine
 * that ships built — the GTR arrives with twelve parts bolted in — the
 * sticker price already paid for them, and pricing them again on the
 * way out would make buy-and-flip profitable, which is a money printer
 * wearing a dealership sign. Free launch parts price at zero and fall
 * out on their own.
 */
export function tradeInValue(g: GarageState, carId: string): number {
  const car = getCar(carId);
  const b = buildOf(g, carId);
  const factory = new Set(car.factoryBuild ?? []);
  let parts = 0;
  for (const id of b.owned) {
    if (factory.has(id)) continue;
    const p = PARTS.find((x) => x.id === id);
    if (p) parts += p.price;
  }
  return Math.round(car.price * RESALE_CAR_FRAC + parts * RESALE_PART_FRAC);
}

/**
 * Sell a car back to the dealer. Mutates `g`; the caller saves.
 *
 * Two refusals, both rules of the game rather than of the UI:
 * a car you do not own is not yours to sell, and the driveway can
 * never be empty — this is a driving game, and a player who sells
 * their last car has softlocked themselves out of it. Selling the car
 * being driven is allowed; the seat moves to the first machine left.
 * The build goes with the car — buying it back later delivers a fresh
 * one, the way a dealership works and a pawnbroker does not.
 */
export function sellCar(
  g: GarageState,
  carId: string
): { ok: boolean; paid: number; reason?: string } {
  if (!g.cars.includes(carId)) return { ok: false, paid: 0, reason: "not owned" };
  if (g.cars.length <= 1) return { ok: false, paid: 0, reason: "last car" };
  const paid = tradeInValue(g, carId);
  g.cars = g.cars.filter((id) => id !== carId);
  delete g.builds[carId];
  g.kd += paid;
  if (g.car === carId) g.car = g.cars[0];
  return { ok: true, paid };
}

export type Aspiration = "none" | "turbo" | "super" | "twin";

export interface TuneEffects {
  carId: string;
  carName: string;
  /** The car's name in Arabic, for the flank wordmark decal. */
  carNameAr: string;
  accelMult: number; // multiplies base acceleration
  /** Governed top speed in km/h after mods — the engine will not let
   *  the car past it, and tunes its thrust curve to reach it. */
  topSpeedKmh: number;
  brakeForce: number; // m/s²
  /** Heat the discs take before they fade, relative to stock pads. */
  brakeThermalMult: number;
  /** Anti-lock fitted: pressure is modulated instead of locking. */
  hasAbs: boolean;
  gripAccel: number; // lateral grip for yaw authority (base 12)
  /** Which wheels this build drives. Rear unless the car says otherwise. */
  drive: Drivetrain;
  /** Aerodynamic grip, in m/s² delivered at HANDLING.downforceRefSpeed
   *  (70 m/s, about 250 km/h) and scaling with v² either side of it.
   *  Quoted at a speed rather than as a coefficient so the number in the
   *  catalogue means something you can check against a corner. */
  downforce: number;
  slipMult: number; // scales centrifugal slip (base 1)
  /** Scales what the driven axle can transmit — an LSD puts both rear
   *  tires to work, so less torque is wasted as wheelspin. */
  tractionMult: number;
  /** Scales how much braking/wheelspin blunts turn-in (base 1). */
  understeerMult: number;
  /** Scales the drift angle cap: drift tires let the tail out further. */
  driftAngleMult: number;
  /** Steering smoothing rate — higher is a faster-answering rack. */
  steerRate: number;
  /** Body lean at full cornering force, radians — see ROLL_DEG_PER_G. */
  rollMax: number;
  /** The same thing before conversion, for tools that want to read it. */
  rollDegPerG: number;
  /** Fraction of impact damage a cage absorbs (0 = none, 1 = all). */
  crashResist: number;
  /** The fitted engine. The sim reads its torque curve every frame and
   *  the sound engine reads its cylinder count — see engines.ts. */
  engine: EngineSpec;
  /** Tank size, litres — the car's, not the engine's. */
  tankLitres: number;
  /** Overall length in metres — the shell is fitted to it. */
  lengthM: number;
  aspiration: Aspiration;
  boostMult: number; // extra accel fraction at full boost
  hasNos: boolean;
  spoiler: boolean;
  goldRims: boolean;
  /** What has been done to the headlamps — see cars.ts CarColors. */
  headlamps: "stock" | "smoked" | "single";
  /** Window tint, 0-100 per cent. */
  tint: number;
  /** Factory second colour and which stripes it draws, or undefined. */
  accent?: number;
  stripes?: "single" | "twin";
  /** Lacquer finish — a bought part wins over the factory one. */
  finish: PaintFinish;
  /** Full time-attack aero built into the car (cars.ts raceKit). Kept
   *  as a boolean because a lot of call sites only ever asked "is this
   *  the full kit"; `kit` below is the real answer. */
  raceKit: boolean;
  /** How far this car is built, as a body kit — street, sport or
   *  attack. Comes from the car, not from the garage: a body kit is
   *  what the machine IS, the way its silhouette is. */
  kit: KitLevel;
  /** Rally livery: roundels, stripes, hood decal, quarter flags. */
  stickers: boolean;
  /** The full-length side graphic, bought on its own. */
  fullStripe: boolean;
  /** The crew this save flies, or null for a privateer. Not a bought
   *  part and not per-car — it is who you are, so every car you own
   *  wears it. The car build reads it for the roof livery. */
  crew: Crew | null;
  /** The fitted system — geometry, voice and bark in one object. */
  exhaust: ExhaustSpec;
  paint: number;
  glow: number | null;
  /** The cam cover's colour, or null for the stock black plastic. */
  engineCover: number | null;
  /** How much of the bodywork is cloth rather than steel. */
  carbon: CarbonLevel;
  bodyStyle: "sedan" | "zx" | "gtr" | "rx7" | "hatch" | "pony";
}

/** The numbers a car actually races with: its own base, plus the parts
 *  bought for IT. Pass a carId to price up a machine you are not
 *  currently sitting in. */
export function computeEffects(g: GarageState, carId: string = g.car): TuneEffects {
  const build = buildOf(g, carId);
  const has = (id: string) => build.owned.includes(id);
  const eq = build.equipped;
  const car = getCar(carId);

  // The block itself, before anything is bolted to it. A swap replaces
  // the car's factory engine; with nothing bought, you race what it came
  // with.
  const engine = getEngine(eq.engine?.replace(/^engine-/, "") ?? car.engine);
  // Engine mass, against the 2.0T benchmark. A hundred and fifteen kilos
  // of V8 over the front axle is not free, and the tyres and the brakes
  // are where it gets charged. Small numbers on purpose — this is a tax
  // on the big engines, not a reason to avoid them.
  const massTax = 1 - engine.massKg / 4000;
  // Carbon, charged the other way round: kilos OFF rather than on.
  //
  // Its own line rather than a share of massTax, because massTax is
  // calibrated against engine mass alone and folding a body panel into
  // it would silently rescale every engine. And expressed as kilos over
  // a nominal car rather than as a flat percentage, because a percentage
  // would make a carbon bonnet worth more on a heavy car than on a light
  // one, which is exactly backwards.
  //
  // It is a small number and it is meant to be. Twenty-two kilos off
  // fourteen hundred is one and a half per cent, which is what carbon
  // panels are actually worth — the reason to buy them is that you can
  // see the weave.
  const carbonLevel: CarbonLevel =
    eq.carbon === "carbon-full" ? "full" : eq.carbon === "carbon-panels" ? "panels" : "none";
  const lightness = 1 + CARBON_KG[carbonLevel] / NOMINAL_CAR_KG;
  let accelMult = car.power * engine.powerMult;
  if (has("ecu")) accelMult += 0.08;
  const exhaust = EXHAUSTS[eq.exhaust ?? ""] ?? EXHAUSTS.stock;
  accelMult += exhaust.power;
  if (eq.intake === "intake") accelMult += 0.05;
  else if (eq.intake === "intake-basic") accelMult += 0.02;
  if (has("weight")) accelMult += 0.1;
  // Less to push is more to push it with. The same fraction the brakes
  // and the tyres get, so a kilo means one thing in this file.
  accelMult *= lightness;

  // Mods move the governor in km/h, so the showroom number and the
  // garage number are the same units the speedo reads.
  let aspiration: Aspiration = "none";
  let boostMult = 0;
  let topSpeedKmh = car.topSpeedKmh;
  if (eq.aspiration === "turbo") { aspiration = "turbo"; boostMult = 0.25; topSpeedKmh += 20; }
  else if (eq.aspiration === "supercharger") { aspiration = "super"; accelMult += 0.3; topSpeedKmh += 14; }
  else if (eq.aspiration === "twin-turbo") { aspiration = "twin"; boostMult = 0.45; topSpeedKmh += 40; }

  // Brakes buy three separate things, and the tiers spend differently on
  // each: how hard they bite, how much heat they take before they stop
  // biting, and whether they will let a wheel stop turning at all.
  let brakeForce = car.brake;
  let brakeThermalMult = 1;
  // Every road car leaves the factory with anti-lock. Race hardware does
  // not, on purpose: the extra bite and the heat capacity come at the
  // price of a pedal that will lock a wheel if you ask it to. Upgrading
  // past sport is a decision about who is modulating the brakes, you or
  // the car — which is the only reason the cheaper part stays on the list.
  let hasAbs = true;
  if (eq.brakes === "brakes-sport") { brakeForce = 32; brakeThermalMult = 1.4; }
  else if (eq.brakes === "brakes-race") { brakeForce = 38; brakeThermalMult = 2.1; hasAbs = false; }
  else if (eq.brakes === "brakes-carbon") { brakeForce = 44; brakeThermalMult = 3.4; hasAbs = false; }
  if (has("weight")) {
    // Less car to stop: the same pads bite harder and heat slower.
    brakeForce += 3;
    brakeThermalMult *= 1.15;
  }
  brakeForce *= massTax; // the same kilos, charged again where they stop
  brakeForce *= lightness; // ...and the ones carbon took back off

  let gripAccel = car.grip;
  let slipMult = 1;
  let driftAngleMult = 1;
  if (eq.tires === "tires-sport") { gripAccel += 1.5; slipMult = 0.86; }
  else if (eq.tires === "tires-race") { gripAccel += 3; slipMult = 0.73; }
  else if (eq.tires === "tires-slick") { gripAccel += 4.5; slipMult = 0.59; }
  else if (eq.tires === "tires-drift") {
    // Not a worse slick — a different tool. Less grip to hold the line,
    // much more angle once the tail is out, and it stays out.
    gripAccel -= 1.2;
    slipMult = 1.1;
    driftAngleMult = 1.45;
  }
  // Aero is a v² term now, not a constant. The GT wing used to add a
  // flat +0.5 m/s² of grip — the same +0.5 parked in the garage as at
  // 300 km/h, which is not a wing. Sized so it delivers roughly the old
  // figure at 200 km/h, nothing at walking pace, and twice as much on
  // the coastal sweepers. A splitter does a little mechanical work at
  // any speed, and that little is what is left flat.
  let downforce = 0;
  if (has("spoiler")) { gripAccel += 0.1; downforce += 0.8; slipMult *= 0.92; }
  gripAccel *= massTax;
  gripAccel *= lightness;
  // Real downforce: the attack kit's wing and splitter plant the car
  if (car.kit === "attack") { gripAccel += 0.2; downforce += 1.6; slipMult *= 0.88; }

  // Gearing: the same engine, aimed at a different part of the road.
  // The ceiling is in m/s, so these numbers are small on purpose: the
  // close box pulls harder at every speed it can still reach, the tall
  // one gives that up for a higher terminal speed.
  if (eq.gearbox === "gearbox-close") { accelMult *= 1.2; topSpeedKmh -= 16; }
  else if (eq.gearbox === "gearbox-tall") { accelMult *= 0.88; topSpeedKmh += 16; }

  // Chassis
  let tractionMult = 1;
  let understeerMult = 1;
  // Read from HANDLING, not copied out of it. This was `= 7` with a
  // comment naming its source, which is a value that drifts silently the
  // first time the source moves — and it did: HANDLING said 13 while
  // this still said 7, so nothing in the game would have felt the change.
  let steerRate: number = HANDLING.steerSmoothRate;
  let crashResist = 0;
  let rollDegPerG =
    ROLL_DEG_PER_G[car.style ?? "sedan"] * ROLL_KIT_MULT[car.kit ?? "street"];
  if (has("lsd")) tractionMult += 0.16;
  if (has("coilovers")) { understeerMult = 0.55; gripAccel += 0.4; rollDegPerG *= ROLL_COILOVER_MULT; }
  if (has("cage")) { crashResist = 0.55; gripAccel += 0.3; accelMult *= 0.97; }
  // The quick rack is a MULTIPLE of the standard one, so it stays a
  // genuine upgrade whatever the base becomes. 1.4x of 13 is 18.2, which
  // is 127 ms to 90% against the standard rack's 177.
  if (has("rack")) steerRate = HANDLING.steerSmoothRate * 1.4;

  return {
    carId: car.id,
    carName: car.name,
    carNameAr: car.ar,
    drive: car.drive ?? "rwd",
    bodyStyle: car.style ?? "sedan",
    accelMult,
    topSpeedKmh,
    brakeForce,
    brakeThermalMult,
    hasAbs,
    gripAccel,
    downforce,
    slipMult,
    tractionMult,
    understeerMult,
    driftAngleMult,
    steerRate,
    rollMax: rollMaxRad(rollDegPerG),
    rollDegPerG,
    crashResist,
    engine,
    tankLitres: car.tankLitres,
    lengthM: car.lengthM,
    aspiration,
    boostMult,
    hasNos: has("nos"),
    spoiler: has("spoiler"),
    goldRims: has("gold-rims"),
    headlamps: eq.lamps === "lamps-smoked" ? "smoked" : eq.lamps === "lamps-single" ? "single" : "stock",
    tint: clampTint(build.tint),
    accent: car.accent,
    stripes: car.stripes,
    // A bought finish beats the factory one; otherwise the car wears
    // what it was built with.
    finish: FINISH_OF_PART[eq.finish ?? ""] ?? car.finish ?? "gloss",
    raceKit: car.kit === "attack",
    kit: car.kit,
    stickers: has("stickers"),
    fullStripe: has("sticker-full"),
    // Read here rather than passed in, because a crew is not part of a
    // car build: it is saved beside the garage and belongs to the save,
    // so every caller that asks what this car races with gets it without
    // having to know it exists.
    crew: loadCrew(),
    exhaust,
    // An explicitly bought paint wins; otherwise the car's factory colour
    paint:
      eq.paint && eq.paint !== "paint-white"
        ? PAINT_COLORS[eq.paint] ?? car.color
        : car.color,
    glow: eq.glow && eq.glow !== "glow-none" ? GLOW_COLORS[eq.glow] ?? null : null,
    /** The cam cover's colour, or null for the stock black plastic —
     *  which is also the signal not to cut the bonnet vents. */
    engineCover: eq.cover && eq.cover !== "cover-none" ? COVER_HEX[eq.cover] ?? null : null,
    /** How much of the bodywork is cloth rather than steel. */
    carbon: carbonLevel,
  };
}
