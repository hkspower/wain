// Rival roster — the bosses of Kuwait's midnight highway, fought in order.
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
  /** The machine they bring to the line. */
  car?: string;
  /** Body silhouette for their car mesh (cars.ts). */
  bodyStyle?: "sedan" | "zx" | "gtr";
  bodyColor: number;
  accentColor: number;
  topSpeedKmh: number;
  taunt: string;
  /** Spoken Kuwaiti lines (browser speech synthesis, Arabic voice). */
  lines: { intro: string; win: string; lose: string };
  /** Voice signature so each character sounds distinct. */
  voice: { pitch: number; rate: number; female?: boolean };
}

export const RIVALS: RivalDef[] = [
  {
    id: "abu-shanab",
    car: "Hawally Sport 2.0T",
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
      intro: "هلا والله! يلا ورني شنو عندك يا بطل",
      win: "هاهاها! روح تعلم السواقة وبعدين تعال",
      lose: "ما شاء الله عليك... خذت الليلة مني",
    },
    voice: { pitch: 1.05, rate: 1.05 },
  },
  {
    id: "bint-aldeera",
    car: "Salmiya Turbo GT",
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
      intro: "تبي تتحداني؟ يلا نشوف شطارتك",
      win: "قلت لك، شارع الخليج لي أنا",
      lose: "زين لعبت... بس هالمرة وبس",
    },
    voice: { pitch: 1.3, rate: 1.1, female: true },
  },
  {
    id: "al-daboos",
    bodyStyle: "zx",
    car: "Gulf Coupe RS",
    country: "Kuwait",
    flag: "🇰🇼",
    rejectLine: "روح تدرب الأول، بعدين نتكلم",
    name: "Al-Daboos",
    arabicName: "الدبوس",
    crew: "Hawally Night Hawks",
    area: "Hawally",
    bodyColor: 0xf5c211,
    accentColor: 0x111111,
    topSpeedKmh: 261,
    taunt: "I've eaten faster cars for futoor.",
    lines: {
      intro: "أنا الدبوس! محد يعديني في حولي",
      win: "ولا يهمك، تدرب زين وتعال مرة ثانية",
      lose: "عيل صدق إنك سريع... احترمتك",
    },
    voice: { pitch: 0.9, rate: 1.15 },
  },
  {
    id: "bu-machboos",
    bodyStyle: "gtr",
    car: "Desert Storm S8",
    country: "Kuwait",
    flag: "🇰🇼",
    rejectLine: "خلها لبعدين، سيارتك ما تسوى",
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
    bodyStyle: "zx",
    car: "Falcon 720 Veloce",
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
    bodyStyle: "zx",
    car: "Zeta 300",
    name: "Bu Torab",
    arabicName: "بو تراب",
    crew: "Doha Dust Devils",
    area: "Doha",
    bodyColor: 0x565f6b,
    accentColor: 0xd97706,
    topSpeedKmh: 301,
    taunt: "I was sideways before you had a licence.",
    rejectLine: "ارجع لما تعرف تفحط",
    lines: {
      intro: "الغبار اللي وراك؟ هذا أنا... بو تراب",
      win: "قلت لك، التراب ما يخون أهله",
      lose: "فحطت علي صج... خذها بشرف",
    },
    voice: { pitch: 0.7, rate: 1.0 },
  },
  {
    id: "al-sayyaf",
    bodyStyle: "gtr",
    car: "Kaiju R",
    name: "Al-Sayyaf",
    arabicName: "السياف",
    crew: "Bayan Blade Runners",
    area: "Bayan",
    bodyColor: 0x0f766e,
    accentColor: 0xe2e8f0,
    topSpeedKmh: 307,
    taunt: "Every cut is clean. Yours will be too.",
    rejectLine: "سيفي ما ينسل لأي أحد",
    lines: {
      intro: "السيف قطع قبلك خمسة... إنت السادس",
      win: "قطعة نظيفة... مثل ما وعدتك",
      lose: "نصلك أحد من نصلي... السيف لك",
    },
    voice: { pitch: 0.62, rate: 0.85 },
  },
  {
    id: "shabah-alkhaleej",
    bodyStyle: "gtr",
    car: "Sahara GT-12",
    country: "???",
    flag: "🏴",
    rejectLine: "لست جاهزاً بعد...",
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
