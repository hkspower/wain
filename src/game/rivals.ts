// Rival roster — the bosses of Kuwait's midnight highway, fought in order.
import { CARS, type CarModel } from "./mods";
import type { TeamLogo } from "./teams";
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
  /**
   * The crew's emblem, in the same four fields a player's crew uses.
   *
   * Every one of these crews has had a NAME since the roster was
   * written — Salmiya Street Kings, Hawally Night Hawks — and it is
   * printed in nine places: the roster, the dossier, the VS splash, the
   * results screen, both cinematic cards and the website. It was text in
   * all nine. Meanwhile teams.ts has drawn crests since the crew feature
   * landed, and only the PLAYER ever had one, so the one crew in the
   * game with an emblem was yours and the seven you fight had none.
   *
   * Deliberately the same TeamLogo the player builds from rather than a
   * richer format of its own: two crest systems in one game is two
   * things to keep in step and two ways for a crest to look wrong, and
   * whatever renders a player's crew already renders these for free —
   * including the roof decal in cars.ts.
   *
   * The colours are not chosen for the crest. They are the rival's own
   * body and accent, so the emblem on the card is the car that turns up,
   * and the two teach each other.
   */
  crest?: TeamLogo;
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
    // Kings. The crown is the whole name, so the crest says it and stops.
    crest: { shape: "shield", symbol: "👑", bg: "#c8cdd6", fg: "#16a34a" },
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
    // Gazelles: the fastest thing that runs on this coast. A diamond because the shape leans the way the animal does.
    crest: { shape: "diamond", symbol: "🐆", bg: "#b84dd6", fg: "#ffffff" },
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
    // Night Hawks, on hazard yellow and black — the only crest here that reads at a hundred metres, which suits a crew named after a workshop.
    crest: { shape: "hex", symbol: "🦅", bg: "#f5c211", fg: "#111111" },
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
    // Phantoms. A moon, and the only round field on the roster: nothing to catch hold of.
    crest: { shape: "circle", symbol: "🌙", bg: "#e8641b", fg: "#ffffff" },
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
    // Junoon is madness, not passion. Fire on red.
    crest: { shape: "diamond", symbol: "🔥", bg: "#c1121f", fg: "#111111" },
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
    // Dust Devils, out of Doha. The scorpion is the desert's own, and Bu Torab means father of dust.
    crest: { shape: "shield", symbol: "🦂", bg: "#565f6b", fg: "#d97706" },
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
    // Blade Runners, led by a man called the swordsman. The bolt is the nearest thing to a blade in the set.
    crest: { shape: "hex", symbol: "⚡", bg: "#0f766e", fg: "#e2e8f0" },
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
    // NO CREST, and that is the point rather than an omission.
    //
    // Every other crew on this roster is a place and a set of people:
    // Salmiya, Hawally, Jahra, and a name they gave themselves. This one
    // answers "???" to country and to crew, runs a black car and a black
    // flag, and is the last thing on the road. An emblem is what a crew
    // paints on itself to be recognised; the Ghost of the Gulf is the
    // one driver here who does not want to be. tests/crests.mjs asserts
    // this absence so nobody later "completes the set".
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
