// Rival roster — the bosses of Kuwait's midnight highway, fought in order.
import { CARS, type CarModel } from "./mods";
// Speeds are top speeds in km/h; the engine rubber-bands them so every
// battle stays close until someone's SP (Spirit Points) runs out.

export interface RivalDef {
  id: string;
  name: string;
  arabicName: string;
  crew: string;
  area: string;
  /** Shown on the challenge card. */
  country?: string;
  flag?: string;
  /** Spoken when they turn a challenge down. */
  rejectLine?: string;
  /**
   * The machine they bring to the line, by the car's ID.
   *
   * An id and not the display name. This used to hold the name — the
   * literal string "Desert Storm S8" — and engine.ts found the car with
   * `CARS.find((c) => c.name === def.car)`, so the rival's machine was
   * joined to the showroom through a label meant for a human to read.
   * Rename a car and the find returns undefined, silently: the rival
   * keeps their line, their crew and their colour, and turns up in a
   * default shell with none of the numbers they were balanced against.
   * Nothing throws and nothing logs.
   *
   * That is not hypothetical — three cars were renamed in the same change
   * that introduced this field, and under the old scheme all three of
   * those rivals would have lost their cars. tests/names.mjs now fails if
   * an id here is not in CARS.
   */
  carId?: string;
  /** Body silhouette for their car mesh (cars.ts). */
  bodyStyle?: "sedan" | "zx" | "gtr" | "rx7" | "hatch" | "pony";
  bodyColor: number;
  accentColor: number;
  topSpeedKmh: number;
  taunt: string;
  /** Spoken Kuwaiti lines (browser speech synthesis, Arabic voice). */
  lines: { intro: string; win: string; lose: string };
  /** Voice signature so each character sounds distinct. */
  voice: { pitch: number; rate: number; female?: boolean };
  /**
   * The length this one calls you out at — an id from distances.ts.
   *
   * It is what the roster shows beside their name, and what the
   * challenge card opens on. It is NOT a restriction: the player can
   * pick any distance, and picking a different one is how you beat
   * somebody who has your number at their own game. A rival who only
   * ever races at 2 km is a rival you fight once and then farm.
   *
   * The ladder walks up it — the first two are sprints, the middle is
   * five, and the last man on the roster wants twenty. That is the
   * roster's difficulty curve expressed in something the player can
   * read, rather than in top speeds they cannot.
   */
  distance: string;
}

/**
 * The car a rival brings, and what to call it.
 *
 * One place, so the id-to-car join exists once rather than at each of the
 * six call sites that used to do `CARS.find((c) => c.name === def.car)`
 * for themselves. `carName` falls back to a generic label rather than to
 * an empty string, because a rival card with a blank where the machine
 * goes reads as a bug and a rival with no listed car reads as a privateer.
 */
export function rivalCar(def: Pick<RivalDef, "carId">): CarModel | undefined {
  return def.carId ? CARS.find((c) => c.id === def.carId) : undefined;
}

export function rivalCarName(def: Pick<RivalDef, "carId">): string {
  return rivalCar(def)?.name ?? "Street Tuned";
}

export const RIVALS: RivalDef[] = [
  {
    id: "abu-shanab",
    distance: "sprint",
    carId: "hawally-2t",
    country: "Kuwait",
    flag: "🇰🇼",
    rejectLine: "مو الحين... جيب سرعة وتعال",
    name: "Abu Shanab",
    arabicName: "أبو شنب",
    crew: "Salmiya Street Kings",
    area: "Salmiya",
    bodyColor: 0xc8cdd6,
    accentColor: 0x16a34a,
    topSpeedKmh: 232,
    taunt: "Yalla, let's see what you've got!",
    lines: {
      intro: "هلا والله! يلا ورّني شنو عندك يا بطل",
      win: "هاهاها! روح تعلّم السواقة وبعدين تعال",
      lose: "ما شاء الله عليك... خذت الليلة مني",
    },
    voice: { pitch: 1.05, rate: 1.05 },
  },
  {
    id: "bint-aldeera",
    distance: "sprint",
    carId: "salmiya-turbo",
    country: "Kuwait",
    flag: "🇰🇼",
    rejectLine: "لا، ما عندي وقت للمبتدئين",
    name: "Bint Al-Deera",
    arabicName: "بنت الديرة",
    crew: "Gulf Road Gazelles",
    area: "Sharq",
    bodyColor: 0xb84dd6,
    accentColor: 0xffffff,
    topSpeedKmh: 246,
    taunt: "You drive like you're going to Friday Market.",
    lines: {
      intro: "تبي تتحدّاني؟ يلا نشوف شطارتك",
      win: "قلت لك، شارع الخليج لي أنا",
      lose: "زين لعبت... بس هالمرة وبس",
    },
    voice: { pitch: 1.3, rate: 1.1, female: true },
  },
  {
    id: "al-daboos",
    distance: "standard",
    bodyStyle: "zx",
    carId: "gulf-coupe-rs",
    country: "Kuwait",
    flag: "🇰🇼",
    rejectLine: "روح تدرّب الأول، بعدين نتكلم",
    name: "Al-Daboos",
    arabicName: "الدبوس",
    crew: "Hawally Night Hawks",
    area: "Hawally",
    bodyColor: 0xf5c211,
    accentColor: 0x111111,
    topSpeedKmh: 261,
    taunt: "I've eaten faster cars for futoor.",
    lines: {
      intro: "أنا الدبوس! محد يعدّيني في حولي",
      win: "ولا يهمك، تدرّب زين وتعال مرة ثانية",
      lose: "عيل صدق إنك سريع... احترمتك",
    },
    voice: { pitch: 0.9, rate: 1.15 },
  },
  {
    id: "bu-machboos",
    distance: "standard",
    bodyStyle: "gtr",
    carId: "storm-s8",
    country: "Kuwait",
    flag: "🇰🇼",
    rejectLine: "خلّها لبعدين، سيارتك ما تسوى",
    name: "Bu Machboos",
    arabicName: "بو مجبوس",
    crew: "Fahaheel Phantoms",
    area: "Fahaheel",
    bodyColor: 0xe8641b,
    accentColor: 0xffffff,
    topSpeedKmh: 277,
    taunt: "When I win, the machboos is on you.",
    lines: {
      intro: "اللي يخسر يعزم على المجبوس... اتفقنا؟",
      win: "يلا! المجبوس عليك الليلة، هاهاها",
      lose: "خذ فوزك... بس مجبوسي أطيب، صدقني",
    },
    voice: { pitch: 0.8, rate: 0.95 },
  },
  {
    id: "al-saqer",
    distance: "long",
    bodyStyle: "zx",
    carId: "falcon-720",
    country: "Kuwait",
    flag: "🇰🇼",
    rejectLine: "الصقر ما يطارد الضعيف",
    name: "Al-Saqer",
    arabicName: "الصقر",
    crew: "Jahra Junoon",
    area: "Jahra",
    bodyColor: 0xc1121f,
    accentColor: 0x111111,
    topSpeedKmh: 293,
    taunt: "The falcon hunts at midnight.",
    lines: {
      intro: "الصقر يصيد في الليل... انتبه لنفسك",
      win: "الصقر ما يطيح مرتين",
      lose: "صدت الصقر... لك كل الاحترام",
    },
    voice: { pitch: 0.75, rate: 0.9 },
  },
  {
    id: "bu-torab",
    distance: "standard",
    bodyStyle: "zx",
    carId: "zeta-300",
    name: "Bu Torab",
    arabicName: "بو تراب",
    crew: "Doha Dust Devils",
    area: "Doha",
    bodyColor: 0x565f6b,
    accentColor: 0xd97706,
    topSpeedKmh: 301,
    taunt: "I was sideways before you had a licence.",
    rejectLine: "ارجع لما تعرف تفحّط",
    lines: {
      intro: "الغبار اللي وراك؟ هذا أنا... بو تراب",
      win: "قلت لك، التراب ما يخون أهله",
      lose: "فحّطت عليّ صج... خذها بشرف",
    },
    voice: { pitch: 0.7, rate: 1.0 },
  },
  {
    id: "al-sayyaf",
    distance: "long",
    bodyStyle: "gtr",
    carId: "kaiju-r",
    name: "Al-Sayyaf",
    arabicName: "السياف",
    crew: "Bayan Blade Runners",
    area: "Bayan",
    bodyColor: 0x0f766e,
    accentColor: 0xe2e8f0,
    topSpeedKmh: 307,
    taunt: "Every cut is clean. Yours will be too.",
    rejectLine: "سيفي ما ينسلّ لأي أحد",
    lines: {
      intro: "السيف قطع قبلك خمسة... إنت السادس",
      win: "قطعة نظيفة... مثل ما وعدتك",
      lose: "نصلك أحدّ من نصلي... السيف لك",
    },
    voice: { pitch: 0.62, rate: 0.85 },
  },
  {
    id: "shabah-alkhaleej",
    distance: "marathon",
    bodyStyle: "gtr",
    carId: "sahara-v12",
    country: "???",
    flag: "🏴",
    rejectLine: "بعدك ما أنت جاهز...",
    name: "Shabah Al-Khaleej",
    arabicName: "شبح الخليج",
    crew: "???",
    area: "Gulf Road",
    bodyColor: 0x0a0a0c,
    accentColor: 0x38e8ff,
    topSpeedKmh: 318,
    taunt: "...",
    lines: {
      intro: "وصلت للنهاية... بس الشبح ما ينهزم",
      win: "ارجع لما تكون جاهز",
      lose: "الشارع لك... يا ملك الخليج",
    },
    voice: { pitch: 0.5, rate: 0.8 },
  },
];
