// The garage — parts catalog, owned/equipped state (localStorage), and
// the tuning effects the engine applies to the handling model.
// Currency is KD, earned by defeating rivals.

export type ExclusiveCat = "aspiration" | "brakes" | "tires" | "paint" | "glow";
export type Category = ExclusiveCat | "internals" | "extras";

/** Slots where equipping one part unequips the previous one. */
export const EXCLUSIVE_CATS: ReadonlySet<string> = new Set([
  "aspiration",
  "brakes",
  "tires",
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
  // Aspiration — exclusive; the heart of the build
  { id: "turbo", cat: "aspiration", name: "Turbo Kit", ar: "تيربو", price: 1200, desc: "+25% power on boost, spools with throttle, blow-off on lift" },
  { id: "supercharger", cat: "aspiration", name: "Supercharger", ar: "سوبرتشارج", price: 1500, desc: "+30% power everywhere, instant response, whine included" },
  { id: "twin-turbo", cat: "aspiration", name: "Twin Turbo", ar: "تيربو مزدوج", price: 2800, desc: "+45% on full boost, fast spool, +12 km/h top end" },
  // Internals — additive, always active once owned
  { id: "ecu", cat: "internals", name: "ECU Tune", ar: "برمجة", price: 400, desc: "+8% power" },
  { id: "exhaust", cat: "internals", name: "Race Exhaust", ar: "دبة رياضية", price: 350, desc: "+7% power, deeper voice" },
  { id: "intake", cat: "internals", name: "Cold Intake", ar: "فلتر مفتوح", price: 250, desc: "+5% power" },
  // Brakes — exclusive tiers
  { id: "brakes-sport", cat: "brakes", name: "Sport Brakes", ar: "بريك رياضي", price: 500, desc: "Braking 26 → 32" },
  { id: "brakes-race", cat: "brakes", name: "Racing Brakes", ar: "بريك سباق", price: 1000, desc: "Braking 26 → 38" },
  { id: "brakes-carbon", cat: "brakes", name: "Carbon Ceramic", ar: "سيراميك", price: 1800, desc: "Braking 26 → 44" },
  // Tires — exclusive tiers (grip + curve stability)
  { id: "tires-sport", cat: "tires", name: "Sport Tires", ar: "تواير رياضية", price: 400, desc: "More grip, calmer sweepers" },
  { id: "tires-race", cat: "tires", name: "Racing Tires", ar: "تواير سباق", price: 900, desc: "Serious grip" },
  { id: "tires-slick", cat: "tires", name: "Slicks", ar: "سليك", price: 1600, desc: "Maximum grip, glued to the corniche" },
  // Extras — additive
  { id: "weight", cat: "extras", name: "Weight Reduction", ar: "تخفيف وزن", price: 800, desc: "+10% power, +3 braking" },
  { id: "nos", cat: "extras", name: "NOS Kit", ar: "نيتروجين", price: 1000, desc: "Hold N for a 3-second shove; recharges slowly" },
  { id: "spoiler", cat: "extras", name: "GT Wing", ar: "جناح", price: 300, desc: "Downforce: steadier at speed" },
  { id: "gold-rims", cat: "extras", name: "Gold Rims", ar: "رنجات ذهب", price: 600, desc: "Pure Salmiya energy" },
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
  /** Base handling before garage mods. */
  power: number; // accel multiplier
  topSpeed: number; // ceiling bonus (km/h-ish units)
  grip: number; // lateral grip m/s²
  brake: number; // braking m/s²
  color: number; // factory paint
  desc: string;
}

/** The showroom, richest metal first. */
export const CARS: CarModel[] = [
  {
    id: "sahara-v12",
    name: "Sahara GT-12",
    ar: "صحارى",
    cls: "supercar",
    price: 96000,
    power: 1.62,
    topSpeed: 26,
    grip: 16.4,
    brake: 42,
    color: 0xb8860b,
    desc: "V12 hypercar. Nothing on the corniche pulls harder.",
  },
  {
    id: "falcon-720",
    name: "Falcon 720 Veloce",
    ar: "الصقر ٧٢٠",
    cls: "supercar",
    price: 71000,
    power: 1.5,
    topSpeed: 21,
    grip: 15.8,
    brake: 40,
    color: 0xc1121f,
    desc: "Mid-engine, feather light, screams past 300.",
  },
  {
    id: "storm-s8",
    name: "Desert Storm S8",
    ar: "عاصفة",
    cls: "supercar",
    price: 54000,
    power: 1.4,
    topSpeed: 17,
    grip: 15.2,
    brake: 38,
    color: 0x1f2933,
    desc: "All-wheel-drive missile. Launches like a catapult.",
  },
  {
    id: "gulf-coupe-rs",
    name: "Gulf Coupe RS",
    ar: "كوبيه الخليج",
    cls: "sport",
    price: 33000,
    power: 1.28,
    topSpeed: 13,
    grip: 14.6,
    brake: 35,
    color: 0x2e8f96,
    desc: "Track-bred coupe. Rewards a clean line.",
  },
  {
    id: "salmiya-turbo",
    name: "Salmiya Turbo GT",
    ar: "توربو السالمية",
    cls: "sport",
    price: 24000,
    power: 1.2,
    topSpeed: 10,
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
    power: 1.12,
    topSpeed: 7,
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
    power: 1.05,
    topSpeed: 4,
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
    power: 1.0,
    topSpeed: 2,
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
    power: 0.98,
    topSpeed: 1,
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
    power: 1.0,
    topSpeed: 0,
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

export interface GarageState {
  kd: number;
  owned: string[];
  equipped: Partial<Record<ExclusiveCat, string>>;
  /** Cars in the driveway, and the one currently being driven. */
  cars: string[];
  car: string;
}

const KEY = "gulf-road-nights-garage";

export function loadGarage(): GarageState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const g = JSON.parse(raw) as GarageState;
      if (typeof g.kd === "number" && Array.isArray(g.owned)) {
        g.equipped = g.equipped ?? {};
        // Saves from before the dealership existed start in the freebie
        if (!Array.isArray(g.cars) || g.cars.length === 0) g.cars = ["wain-special"];
        if (!g.car || !g.cars.includes(g.car)) g.car = g.cars[0];
        return g;
      }
    }
  } catch {}
  return {
    // Enough to leave the dealership with the cheapest car after one win
    kd: 2500,
    owned: ["paint-white", "glow-none"],
    equipped: { paint: "paint-white", glow: "glow-none" },
    cars: ["wain-special"],
    car: "wain-special",
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
  accelMult: number; // multiplies base acceleration
  topSpeedBonus: number; // added to the accel-curve ceiling (km/h-ish units)
  brakeForce: number; // m/s²
  gripAccel: number; // lateral grip for yaw authority (base 12)
  slipMult: number; // scales centrifugal slip (base 1)
  aspiration: Aspiration;
  boostMult: number; // extra accel fraction at full boost
  hasNos: boolean;
  spoiler: boolean;
  goldRims: boolean;
  exhaustLevel: number; // 0..1 sound character
  paint: number;
  glow: number | null;
}

export function computeEffects(g: GarageState): TuneEffects {
  const has = (id: string) => g.owned.includes(id);
  const eq = g.equipped;
  const car = getCar(g.car);

  let accelMult = car.power;
  if (has("ecu")) accelMult += 0.08;
  if (has("exhaust")) accelMult += 0.07;
  if (has("intake")) accelMult += 0.05;
  if (has("weight")) accelMult += 0.1;

  let aspiration: Aspiration = "none";
  let boostMult = 0;
  let topSpeedBonus = 0;
  if (eq.aspiration === "turbo") { aspiration = "turbo"; boostMult = 0.25; topSpeedBonus = 6; }
  else if (eq.aspiration === "supercharger") { aspiration = "super"; accelMult += 0.3; topSpeedBonus = 4; }
  else if (eq.aspiration === "twin-turbo") { aspiration = "twin"; boostMult = 0.45; topSpeedBonus = 12; }
  topSpeedBonus += car.topSpeed;

  let brakeForce = car.brake;
  if (eq.brakes === "brakes-sport") brakeForce = 32;
  else if (eq.brakes === "brakes-race") brakeForce = 38;
  else if (eq.brakes === "brakes-carbon") brakeForce = 44;
  if (has("weight")) brakeForce += 3;

  let gripAccel = car.grip;
  let slipMult = 1;
  if (eq.tires === "tires-sport") { gripAccel += 1.5; slipMult = 0.86; }
  else if (eq.tires === "tires-race") { gripAccel += 3; slipMult = 0.73; }
  else if (eq.tires === "tires-slick") { gripAccel += 4.5; slipMult = 0.59; }
  if (has("spoiler")) { gripAccel += 0.5; slipMult *= 0.92; }

  return {
    carId: car.id,
    carName: car.name,
    accelMult,
    topSpeedBonus,
    brakeForce,
    gripAccel,
    slipMult,
    aspiration,
    boostMult,
    hasNos: has("nos"),
    spoiler: has("spoiler"),
    goldRims: has("gold-rims"),
    exhaustLevel: has("exhaust") ? 1 : 0,
    // An explicitly bought paint wins; otherwise the car's factory colour
    paint:
      eq.paint && eq.paint !== "paint-white"
        ? PAINT_COLORS[eq.paint] ?? car.color
        : car.color,
    glow: eq.glow && eq.glow !== "glow-none" ? GLOW_COLORS[eq.glow] ?? null : null,
  };
}
