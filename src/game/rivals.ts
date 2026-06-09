// Rival roster — the bosses of Kuwait's midnight highway, fought in order.
// Speeds are top speeds in km/h; the engine rubber-bands them so every
// battle stays close until someone's SP (Spirit Points) runs out.

export interface RivalDef {
  id: string;
  name: string;
  arabicName: string;
  crew: string;
  area: string;
  bodyColor: number;
  accentColor: number;
  topSpeedKmh: number;
  taunt: string;
}

export const RIVALS: RivalDef[] = [
  {
    id: "abu-shanab",
    name: "Abu Shanab",
    arabicName: "أبو شنب",
    crew: "Salmiya Street Kings",
    area: "Salmiya",
    bodyColor: 0xc8cdd6,
    accentColor: 0x16a34a,
    topSpeedKmh: 232,
    taunt: "Yalla, let's see what you've got!",
  },
  {
    id: "bint-aldeera",
    name: "Bint Al-Deera",
    arabicName: "بنت الديرة",
    crew: "Gulf Road Gazelles",
    area: "Sharq",
    bodyColor: 0xb84dd6,
    accentColor: 0xffffff,
    topSpeedKmh: 246,
    taunt: "You drive like you're going to Friday Market.",
  },
  {
    id: "al-daboos",
    name: "Al-Daboos",
    arabicName: "الدبوس",
    crew: "Hawally Night Hawks",
    area: "Hawally",
    bodyColor: 0xf5c211,
    accentColor: 0x111111,
    topSpeedKmh: 261,
    taunt: "I've eaten faster cars for futoor.",
  },
  {
    id: "bu-machboos",
    name: "Bu Machboos",
    arabicName: "بو مجبوس",
    crew: "Fahaheel Phantoms",
    area: "Fahaheel",
    bodyColor: 0xe8641b,
    accentColor: 0xffffff,
    topSpeedKmh: 277,
    taunt: "When I win, the machboos is on you.",
  },
  {
    id: "al-saqer",
    name: "Al-Saqer",
    arabicName: "الصقر",
    crew: "Jahra Junoon",
    area: "Jahra",
    bodyColor: 0xc1121f,
    accentColor: 0x111111,
    topSpeedKmh: 293,
    taunt: "The falcon hunts at midnight.",
  },
  {
    id: "shabah-alkhaleej",
    name: "Shabah Al-Khaleej",
    arabicName: "شبح الخليج",
    crew: "???",
    area: "Gulf Road",
    bodyColor: 0x0a0a0c,
    accentColor: 0x38e8ff,
    topSpeedKmh: 318,
    taunt: "...",
  },
];
