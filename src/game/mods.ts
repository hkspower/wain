// The garage — parts catalog, owned/equipped state (localStorage), and
// the tuning effects the engine applies to the handling model.
// Currency is KD, earned by defeating rivals.

import { EngineId, EngineSpec, getEngine } from "./engines";

export type ExclusiveCat =
  | "engine"
  | "aspiration"
  | "brakes"
  | "exhaust"
  | "tires"
  | "gearbox"
  | "paint"
  | "glow";
export type Category = ExclusiveCat | "internals" | "chassis" | "extras";

/** Slots where equipping one part unequips the previous one. */
export const EXCLUSIVE_CATS: ReadonlySet<string> = new Set([
  "engine",
  "aspiration",
  "brakes",
  "exhaust",
  "tires",
  "gearbox",
  "paint",
  "glow",
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
  { id: "exhaust-race", cat: "exhaust", name: "Race Straight-Pipe", ar: "دبة سباق", price: 900, desc: "+11% power. No silencer left: raw, loud, and it spits flame" },
  { id: "exhaust-ti", cat: "exhaust", name: "Titanium Quad", ar: "دبة تيتانيوم", price: 1800, desc: "+14% power. Four burnt-blue tips and a hard metallic rasp" },
  { id: "intake", cat: "internals", name: "Cold Intake", ar: "فلتر مفتوح", price: 250, desc: "+5% power" },
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
  { id: "stickers", cat: "extras", name: "Rally Sticker Pack", ar: "ملصقات", price: 450, desc: "Door roundels, beltline stripes, hood decal, flag on the quarter" },
  // Paint — exclusive, equip freely once owned
  { id: "paint-white", cat: "paint", name: "Factory Finish", ar: "لون الوكالة", price: 0, desc: "The colour it left the showroom in" },
  { id: "paint-black", cat: "paint", name: "Midnight Black", ar: "أسود", price: 150, desc: "" },
  { id: "paint-red", cat: "paint", name: "Falcon Red", ar: "أحمر", price: 150, desc: "" },
  { id: "paint-gold", cat: "paint", name: "Desert Gold", ar: "ذهبي", price: 250, desc: "" },
  { id: "paint-teal", cat: "paint", name: "Towers Teal", ar: "فيروزي", price: 200, desc: "" },
  // Underglow — exclusive
  { id: "glow-none", cat: "glow", name: "No Underglow", ar: "بدون", price: 0, desc: "" },
  { id: "glow-cyan", cat: "glow", name: "Cyan Glow", ar: "سماوي", price: 200, desc: "" },
  { id: "glow-green", cat: "glow", name: "Green Glow", ar: "أخضر", price: 200, desc: "" },
  { id: "glow-purple", cat: "glow", name: "Purple Glow", ar: "بنفسجي", price: 200, desc: "" },
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
  id: "stock" | "sport" | "race" | "titanium";
  /** Tips out the back, and how wide each bore is in metres. */
  tips: number;
  bore: number;
  finish: "steel" | "chrome" | "ceramic" | "titanium";
  /** Multiplier on the exhaust band's centre frequency. Under one is a
   *  deeper car; a straight pipe drops further than a cat-back can. */
  pitch: number;
  /** Resonance and level of the rasp, against stock. */
  rasp: number;
  loud: number;
  /** How hard it barks on a lift: the crack, and the flame with it. */
  pop: number;
  /** Power, as a fraction added to the accel multiplier. */
  power: number;
}

export const EXHAUSTS: Record<string, ExhaustSpec> = {
  stock: { id: "stock", tips: 2, bore: 0.05, finish: "steel", pitch: 1, rasp: 1, loud: 1, pop: 1, power: 0 },
  // A cat-back keeps the catalyst and the silencer: deeper and louder,
  // still civil.
  exhaust: { id: "sport", tips: 2, bore: 0.068, finish: "chrome", pitch: 0.88, rasp: 1.35, loud: 1.3, pop: 1.45, power: 0.07 },
  // Nothing left in the pipe to quieten it. Biggest bore, hardest bark.
  "exhaust-race": { id: "race", tips: 2, bore: 0.09, finish: "ceramic", pitch: 0.76, rasp: 1.9, loud: 1.7, pop: 2.2, power: 0.11 },
  // Four thin-wall tips. Lighter than the race system and higher-strung
  // with it — the rasp is metallic rather than deep.
  "exhaust-ti": { id: "titanium", tips: 4, bore: 0.058, finish: "titanium", pitch: 0.86, rasp: 2.3, loud: 1.75, pop: 2.4, power: 0.14 },
};

export const PAINT_COLORS: Record<string, number> = {
  "paint-white": 0xf2f4f7,
  "paint-black": 0x0d0e11,
  "paint-red": 0xc1121f,
  "paint-gold": 0xc9a227,
  "paint-teal": 0x2e8f96,
};

export const GLOW_COLORS: Record<string, number> = {
  "glow-cyan": 0x38e8ff,
  "glow-green": 0x2eff7a,
  "glow-purple": 0xb84dd6,
};

// ---------------------------------------------------------------- cars

export type CarClass = "supercar" | "sport" | "normal";

export interface CarModel {
  id: string;
  name: string;
  ar: string;
  cls: CarClass;
  price: number;
  /** Body silhouette (cars.ts): sedan, zx wedge, gtr coupe, or rx7. */
  style?: "sedan" | "zx" | "gtr" | "rx7" | "hatch";
  /** Factory-fitted time-attack aero: swan wing, splitter, canards,
   *  vented hood, bronze wheels. Not a garage part — the car IS the kit. */
  kit?: "attack";
  /** What the car left the factory with. Every machine on the corniche
   *  has a heart before anybody opens the bonnet, and the showroom is
   *  where you meet it. */
  engine: EngineId;
  /** Base handling before garage mods. */
  power: number; // accel multiplier
  /** The car's governed top speed in km/h — an absolute limiter, not a
   *  bonus. Every car in the showroom has its own, 180 through 400, and
   *  the engine tunes its thrust curve so the number is the real
   *  terminal speed rather than an advertisement. */
  topSpeedKmh: number;
  grip: number; // lateral grip m/s²
  brake: number; // braking m/s²
  color: number; // factory paint
  desc: string;
}

/** The showroom, richest metal first. */
export const CARS: CarModel[] = [
  {
    id: "efreet-rx-kai",
    name: "Efreet RX Kai",
    ar: "كبير العفاريت",
    cls: "supercar",
    style: "rx7",
    kit: "attack",
    price: 120000,
    engine: "i6-30tt",
    power: 1.66,
    topSpeedKmh: 400,
    grip: 17.5,
    brake: 44,
    color: 0xf2b90d, // competition yellow
    desc: "One-off time-attack build on the twin-turbo six — swan-neck wing, canards, bronze forged wheels. The rarest machine on Gulf Road.",
  },
  {
    id: "sahara-v12",
    name: "Sahara GT-12",
    ar: "صحارى",
    cls: "supercar",
    style: "zx",
    price: 96000,
    engine: "v8-57",
    power: 1.62,
    topSpeedKmh: 385,
    grip: 16.4,
    brake: 42,
    color: 0xb8860b,
    desc: "Quad-cam V8 hypercar. Nothing on the corniche leaves a corner harder.",
  },
  {
    id: "falcon-720",
    name: "Falcon 720 Veloce",
    ar: "الصقر ٧٢٠",
    cls: "supercar",
    style: "zx",
    price: 71000,
    engine: "v8-57",
    power: 1.5,
    topSpeedKmh: 360,
    grip: 15.8,
    brake: 40,
    color: 0xc1121f,
    desc: "Mid-engine V8, feather light, screams past 300.",
  },
  {
    id: "storm-s8",
    name: "Desert Storm S8",
    ar: "عاصفة",
    cls: "supercar",
    price: 54000,
    engine: "i6-30tt",
    power: 1.4,
    topSpeedKmh: 335,
    grip: 15.2,
    brake: 38,
    color: 0x1f2933,
    desc: "All-wheel-drive missile. Launches like a catapult.",
  },
  {
    id: "kaiju-r",
    name: "Kaiju R",
    ar: "كايجو",
    cls: "sport",
    style: "gtr",
    price: 38000,
    engine: "i6-30tt",
    power: 1.34,
    topSpeedKmh: 310,
    grip: 16.2, // AWD monster — nothing in the class sticks like it
    brake: 38,
    color: 0x3f66c4, // that blue
    desc: "Four round tails, boxed arches, AWD bite. Add the GT Wing to complete the legend.",
  },
  {
    id: "efreet-rx",
    name: "Efreet RX",
    ar: "عفريت",
    cls: "sport",
    style: "rx7",
    price: 31000,
    engine: "f6-25",
    power: 1.3,
    topSpeedKmh: 295,
    grip: 14.8,
    brake: 35,
    color: 0xd7263d, // vintage rotary red
    desc: "Flat-six curves — pop-ups up, first light on the horizon, nothing else on the road.",
  },
  {
    id: "zeta-300",
    name: "Zeta 300",
    ar: "زيتا ٣٠٠",
    cls: "sport",
    style: "zx",
    price: 27000,
    engine: "i6-30tt",
    power: 1.26,
    topSpeedKmh: 275,
    grip: 13.9,
    brake: 34,
    color: 0xc1272d, // golden-era JDM red
    desc: "Twin-turbo wedge from the golden era — one light bar, no grille, all nose.",
  },
  {
    id: "gulf-coupe-rs",
    name: "Gulf Coupe RS",
    ar: "كوبيه الخليج",
    cls: "sport",
    style: "hatch",
    price: 33000,
    engine: "i4-20t",
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
    name: "Salmiya Turbo GT",
    ar: "تيربو السالمية",
    cls: "sport",
    price: 24000,
    engine: "i4-20t",
    power: 1.2,
    topSpeedKmh: 255,
    grip: 13.8,
    brake: 32,
    color: 0xb84dd6,
    desc: "The street favourite. Boost from every corner exit.",
  },
  {
    id: "hawally-2t",
    name: "Hawally Sport 2.0T",
    ar: "حولي سبورت",
    cls: "sport",
    price: 16000,
    engine: "i4-20t",
    power: 1.12,
    topSpeedKmh: 240,
    grip: 13.2,
    brake: 30,
    color: 0xf5c211,
    desc: "Cheap thrills with a real chassis under them.",
  },
  {
    id: "deera-sedan",
    name: "Deera Sedan",
    ar: "سيدان الديرة",
    cls: "normal",
    price: 8500,
    engine: "i4-20t",
    power: 1.05,
    topSpeedKmh: 220,
    grip: 12.6,
    brake: 28,
    color: 0xdfe3e8,
    desc: "Comfortable, quiet, quicker than it looks.",
  },
  {
    id: "jahra-pickup",
    name: "Jahra Pickup",
    ar: "ونيت الجهراء",
    cls: "normal",
    price: 6000,
    engine: "v8-57",
    power: 1.0,
    topSpeedKmh: 195,
    grip: 12.0,
    brake: 27,
    color: 0x6e7f8d,
    desc: "Heavy, honest, and it never dies.",
  },
  {
    id: "sharq-hatch",
    name: "Sharq Hatch",
    ar: "شرق هاتش",
    cls: "normal",
    price: 2200,
    engine: "i4-16",
    power: 0.98,
    topSpeedKmh: 205,
    grip: 12.4,
    brake: 27,
    color: 0x16a34a,
    desc: "Tiny, tossable, easy on the wallet.",
  },
  {
    id: "wain-special",
    name: "Wain Special",
    ar: "وين سبيشال",
    cls: "normal",
    price: 0,
    engine: "i4-16",
    power: 1.0,
    topSpeedKmh: 180,
    grip: 12.0,
    brake: 26,
    color: 0xf2f4f7,
    desc: "The car you showed up in. It owes you nothing.",
  },
];

export const CLASS_LABELS: Record<CarClass, string> = {
  supercar: "SUPERCARS · سوبر كار",
  sport: "SPORT CARS · سيارات رياضية",
  normal: "NORMAL CARS · سيارات عادية",
};

export function getCar(id: string): CarModel {
  return CARS.find((c) => c.id === id) ?? CARS[CARS.length - 1];
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
}

export interface GarageState {
  kd: number;
  /** Cars in the driveway, and the one currently being driven. */
  cars: string[];
  car: string;
  /** One build per car, keyed by car id. */
  builds: Record<string, CarBuild>;
}

/** A car as it leaves the lot: factory paint, no glow, nothing fitted. */
export function freshBuild(): CarBuild {
  return {
    owned: ["paint-white", "glow-none"],
    equipped: { paint: "paint-white", glow: "glow-none" },
  };
}

/** A car's build, for reading. Never writes: the shop asks about cars it
 *  has not bought yet, and a read should not conjure a driveway entry. */
export function buildOf(g: GarageState, carId: string = g.car): CarBuild {
  return g.builds[carId] ?? freshBuild();
}

/** The stored build, created on demand — for code that is about to
 *  change it, so a newly bought machine needs no special case. */
export function editBuild(g: GarageState, carId: string = g.car): CarBuild {
  let b = g.builds[carId];
  if (!b) {
    b = freshBuild();
    g.builds[carId] = b;
  }
  return b;
}

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
        }
        return g;
      }
    }
  } catch {}
  return {
    // Enough to leave the dealership with the cheapest car after one win
    kd: 2500,
    cars: ["wain-special"],
    car: "wain-special",
    builds: { "wain-special": freshBuild() },
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
  /** Fraction of impact damage a cage absorbs (0 = none, 1 = all). */
  crashResist: number;
  /** The fitted engine. The sim reads its torque curve every frame and
   *  the sound engine reads its cylinder count — see engines.ts. */
  engine: EngineSpec;
  aspiration: Aspiration;
  boostMult: number; // extra accel fraction at full boost
  hasNos: boolean;
  spoiler: boolean;
  goldRims: boolean;
  /** Full time-attack aero built into the car (cars.ts raceKit). */
  raceKit: boolean;
  /** Rally livery: roundels, stripes, hood decal, quarter flags. */
  stickers: boolean;
  /** The fitted system — geometry, voice and bark in one object. */
  exhaust: ExhaustSpec;
  paint: number;
  glow: number | null;
  bodyStyle: "sedan" | "zx" | "gtr" | "rx7" | "hatch";
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
  let accelMult = car.power * engine.powerMult;
  if (has("ecu")) accelMult += 0.08;
  const exhaust = EXHAUSTS[eq.exhaust ?? ""] ?? EXHAUSTS.stock;
  accelMult += exhaust.power;
  if (has("intake")) accelMult += 0.05;
  if (has("weight")) accelMult += 0.1;

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
  if (has("spoiler")) { gripAccel += 0.5; slipMult *= 0.92; }
  gripAccel *= massTax;
  // Real downforce: the attack kit's wing and splitter plant the car
  if (car.kit === "attack") { gripAccel += 1.0; slipMult *= 0.88; }

  // Gearing: the same engine, aimed at a different part of the road.
  // The ceiling is in m/s, so these numbers are small on purpose: the
  // close box pulls harder at every speed it can still reach, the tall
  // one gives that up for a higher terminal speed.
  if (eq.gearbox === "gearbox-close") { accelMult *= 1.2; topSpeedKmh -= 16; }
  else if (eq.gearbox === "gearbox-tall") { accelMult *= 0.88; topSpeedKmh += 16; }

  // Chassis
  let tractionMult = 1;
  let understeerMult = 1;
  let steerRate = 7; // HANDLING.steerSmoothRate
  let crashResist = 0;
  if (has("lsd")) tractionMult += 0.16;
  if (has("coilovers")) { understeerMult = 0.55; gripAccel += 0.4; }
  if (has("cage")) { crashResist = 0.55; gripAccel += 0.3; accelMult *= 0.97; }
  if (has("rack")) steerRate = 10.5;

  return {
    carId: car.id,
    carName: car.name,
    carNameAr: car.ar,
    bodyStyle: car.style ?? "sedan",
    accelMult,
    topSpeedKmh,
    brakeForce,
    brakeThermalMult,
    hasAbs,
    gripAccel,
    slipMult,
    tractionMult,
    understeerMult,
    driftAngleMult,
    steerRate,
    crashResist,
    engine,
    aspiration,
    boostMult,
    hasNos: has("nos"),
    spoiler: has("spoiler"),
    goldRims: has("gold-rims"),
    raceKit: car.kit === "attack",
    stickers: has("stickers"),
    exhaust,
    // An explicitly bought paint wins; otherwise the car's factory colour
    paint:
      eq.paint && eq.paint !== "paint-white"
        ? PAINT_COLORS[eq.paint] ?? car.color
        : car.color,
    glow: eq.glow && eq.glow !== "glow-none" ? GLOW_COLORS[eq.glow] ?? null : null,
  };
}
