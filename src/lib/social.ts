/**
 * The things people say to a person and not to a search box — one table,
 * read by سالم's chat (salem-followup.ts) and by /search (answer-order.ts).
 *
 * It lived inside salem-followup.ts until 8 October, so only the chat knew a
 * greeting from a question. /search — and with it the free call, which lands
 * its heard words on /search — answered «السلام عليكم» with «ما لقيت شي
 * بهالكلمة» and «شكراً» the same, read off a battery of 52 questions against
 * the live build. The reading is the chat's, moved and shared: a greeting is
 * answered as a greeting, and a greeting in front of a question is taken off
 * it before the question is searched.
 *
 * Each phrase is folded the way a message is, so «شكراً» and «شكرا» are one
 * entry, and matched as whole words at a word boundary: «السلام» opens
 * «السلام عليكم» and is never looked for inside «قصر السلام».
 *
 * Imports the search's own `normalise`, so a word is folded here exactly as
 * the index folds it. Nothing here reads the catalogue.
 */
import { normalise } from "@/lib/search";

/** A greeting said in front of a question, answered before the answer. */
export type Opener = "salam" | "greet" | "morning" | "evening";
/** A message that is not about places. */
export type SocialAct = Opener | "how" | "thanks" | "afia" | "who" | "notShouq" | "help" | "bye" | "ok" | "no";

const fold = (words: string[]) => new Set(words.map(normalise));

/*
 * 14 October, from a replay of the free chat: «يعطيك الصحة» answered «جرّب
 * بيت ديكسون», «حياك الله» a house in Hawalli, «الله يحفظك» another, and
 * «مشكورين», «ابشر» and «خلاص» «ما لقيت شي» — which wiped the chat's memory,
 * so the «غيره» after them asked «عن شنو؟». The ways a Kuwaiti closes a
 * message are many more than «شكراً»; the common ones are here, each folded
 * the way a message is («الصحة» and «الصحه» are one entry).
 */
const SOCIAL: [SocialAct, string[]][] = [
  ["salam", ["السلام عليكم", "سلام عليكم", "السلام عليكم ورحمه الله", "السلام عليكم ورحمه الله وبركاته", "السلام", "سلام"]],
  ["greet", ["هلا", "هلا والله", "هلا وغلا", "هلا فيك", "هلا بك", "يا هلا", "اهلا", "اهلين", "اهلا وسهلا", "مرحبا", "مرحبتين", "هاي", "هلو", "hi", "hello", "hey", "salam",
    "حياك", "حياك الله", "حياكم", "حياكم الله", "الله يحييك", "الله يحييكم", "سلامات"]],
  ["morning", ["صباح الخير", "صباح النور", "صباح الورد", "صباحو", "good morning"]],
  ["evening", ["مساء الخير", "مساء النور", "مساء الورد", "مسا الخير", "good evening"]],
  ["how", ["شلونك", "شلونكم", "شلونك اليوم", "شلون حالك", "شخبارك", "شخبارك اليوم", "شلون الحال", "كيفك", "كيف حالك", "عساك بخير", "عساك طيب", "how are you"]],
  ["thanks", ["شكرا", "شكرا لك", "شكرا جزيلا", "مشكور", "مشكوره", "تسلم", "تسلم يدك", "تسلم ايدك", "ما قصرت", "كفو", "مرسي", "ميرسي", "ثانكس", "ثانكيو", "جزاك الله خير", "يزاك الله خير", "الله يجزاك خير", "thanks", "thank you", "thx", "ty",
    "مشكورين", "تسلمون", "تسلمين", "يسلمو", "يسلموا", "يسلمو ايدك", "ما تقصر", "ما تقصرون", "ما قصرتوا", "كفيت ووفيت",
    "الله يحفظك", "الله يحفظكم", "الله يسعدك", "الله يسعدكم", "الله يوفقك", "الله يوفقكم", "الله يخليك", "ربي يحفظك",
    "ربي يسعدك", "عساك على القوه", "عساك عالقوه", "ممنون", "ممنونك", "ممنونين", "تشكر", "thank u"]],
  ["afia", ["يعطيك العافيه", "الله يعطيك العافيه", "عطاك الله العافيه", "يعطيكم العافيه", "الله يعطيكم العافيه",
    "يعطيك الف عافيه", "الله يعطيك الف عافيه", "يعطيك الصحه", "الله يعطيك الصحه"]],
  ["who", ["مين انت", "منو انت", "من انت", "انت مين", "انت منو", "شنو اسمك", "وش اسمك", "شسمك", "شو اسمك", "اسمك", "شنو انت", "انت شنو", "انت بوت", "انت روبوت", "انت انسان", "who are you", "what is your name", "whats your name"]],
  ["notShouq", ["انت شوق", "انتي شوق", "هذي شوق", "انت شوق ولا سالم"]],
  // «ما فهمت», «ما أدري» — lost, not refusing: told what to type, never read
  // as a «no» to the answer (salem-followup.ts reads «ما…» that way).
  ["help", ["شنو تقدر تسوي", "شنو تسوي", "وش تقدر تسوي", "وش تسوي", "شتسوي", "شنو عندك", "وش عندك", "شعندك", "ساعدني", "كيف استخدمك", "شلون استخدمك", "شلون استخدمه", "help",
    "ما فهمت", "ما فهمتك", "مو فاهم", "ما ادري", "مادري", "ما اعرف", "محتار"]],
  ["bye", ["مع السلامه", "باي", "باي باي", "يلا باي", "يلا سلام", "فمان الله", "في امان الله", "تصبح علي خير", "تصبحون علي خير", "الله وياك", "bye", "bye bye", "goodbye"]],
  // «ابشر», «خلاص», «بس» and «يلا» on their own are a nod, not a search and
  // not a hello: «يلا» alone was answered «هلا والله!», and «بس» with a beach.
  ["ok", ["اوكي", "اوك", "اوكيه", "ok", "okay", "تمام", "طيب", "زين", "ماشي", "حلو", "ايه", "اي", "اكيد", "نعم", "يب", "يس", "yes", "هه", "ه", "هاها", "lol",
    "ابشر", "ابشري", "ابشروا", "خلاص", "تم", "بس", "عدل", "يلا", "يالله", "يلا يلا", "انزين",
    // Praise and «never mind»: three of them open with «ما» and are no «no».
    "ما شاء الله", "ماشاء الله", "ماشالله", "تبارك الله", "حلوه", "روعه", "رهيب", "واو", "wow", "nice",
    "ما يخالف", "مايخالف", "ما عليه", "ماعليه", "لا باس", "مو مشكله", "عادي"]],
  ["no", ["لا", "لا شكرا", "لا مشكور", "no", "no thanks"]],
];
/** Phrase (folded words, space-joined) → what it is. */
const SOCIAL_PHRASES = new Map<string, SocialAct>();
for (const [act, phrases] of SOCIAL) {
  for (const p of phrases) SOCIAL_PHRASES.set(splitWords(normalise(p)).join(" "), act);
}
const LONGEST_PHRASE = Math.max(...[...SOCIAL_PHRASES.keys()].map((k) => k.split(" ").length));
/** Said to a person, around anything: «يا سالم», «والله», «لو سمحت». */
export const VOCATIVE = fold([
  "يا", "سالم", "شوق", "اخوي", "اختي", "حبيبي", "حبيبتي", "والله", "بالله", "الله", "يلا", "يالله", "طال", "عمرك",
  "لو", "سمحت", "سمحتي", "بليز", "please", "تكفى", "تكفين", "ياخي", "يالغالي", "الغالي", "الغاليه",
]);
export const OPENERS = new Set<SocialAct>(["salam", "greet", "morning", "evening"]);
/** Taken off the front or the back of a question without a word said back. */
export const SILENT = new Set<SocialAct>(["thanks", "afia", "ok"]);
/** When a message is several of these, the one that is answered. */
export const PRIORITY: SocialAct[] = [
  "notShouq", "who", "help", "how", "bye", "afia", "thanks", "no", "ok", "salam", "morning", "evening", "greet",
];

export function splitWords(folded: string): string[] {
  return folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The social phrase starting at `i`, longest first. */
export function phraseAt(words: string[], i: number): { act: SocialAct; len: number } | null {
  for (let len = Math.min(LONGEST_PHRASE, words.length - i); len >= 1; len--) {
    const act = SOCIAL_PHRASES.get(words.slice(i, i + len).join(" "));
    if (act) return { act, len };
  }
  return null;
}
/** The social phrase ending at `j` (exclusive), longest first. */
export function phraseBefore(words: string[], j: number, from: number): { act: SocialAct; len: number } | null {
  for (let len = Math.min(LONGEST_PHRASE, j - from); len >= 1; len--) {
    const act = SOCIAL_PHRASES.get(words.slice(j - len, j).join(" "));
    if (act) return { act, len };
  }
  return null;
}

/**
 * What is said to a person at the front and the back of a message, and where
 * the message itself starts and ends (`i`, `j` — exclusive). Every act is
 * noted; the caller decides what to take off.
 */
export function socialFrame(w: string[]): { lead: SocialAct[]; trail: SocialAct[]; i: number; j: number } {
  const lead: SocialAct[] = [];
  let i = 0;
  while (i < w.length) {
    const p = phraseAt(w, i);
    if (p) {
      lead.push(p.act);
      i += p.len;
    } else if (VOCATIVE.has(w[i])) {
      i += 1;
    } else break;
  }
  const trail: SocialAct[] = [];
  let j = w.length;
  while (j > i) {
    const p = phraseBefore(w, j, i);
    if (p) {
      trail.unshift(p.act);
      j -= p.len;
    } else if (VOCATIVE.has(w[j - 1])) {
      j -= 1;
    } else break;
  }
  return { lead, trail, i, j };
}

/** Of several acts in one message, the one that is answered, and the greeting
 *  that opens it when the act is one a greeting goes with. */
export function socialAct(acts: SocialAct[]): { act: SocialAct; opener?: Opener } {
  // «يا سالم» alone — a vocative with nothing said: a hello.
  if (acts.length === 0) return { act: "greet" };
  const act = PRIORITY.find((a) => acts.includes(a))!;
  const greeting = acts.find((a) => OPENERS.has(a)) as Opener | undefined;
  return greeting && !OPENERS.has(act) && ["how", "who", "help", "notShouq"].includes(act)
    ? { act, opener: greeting }
    : { act };
}

/**
 * A message read for what is said to a person: all of it (`social`), or a
 * greeting in front of a question (`opener`, with the question left in the
 * visitor's own spelling as `rest`), or nothing of the kind. The chat and
 * /search both read a message this way first; only greetings, thanks and
 * «تمام» are taken off a message that goes on to say something else — «لا
 * أبي شي مو غالي» is not a «no».
 */
export function readSocial(message: string): {
  social: { act: SocialAct; opener?: Opener } | null;
  opener?: Opener;
  rest: string;
} {
  const text = message.trim();
  const units = text.split(/\s+/).filter(Boolean);
  const words: { w: string; unit: number }[] = [];
  units.forEach((u, unit) => {
    for (const w of splitWords(normalise(u))) words.push({ w, unit });
  });
  if (words.length === 0) return { social: null, rest: text };
  const w = words.map((x) => x.w);
  const frame = socialFrame(w);
  const { trail } = frame;
  let { lead, i, j } = frame;
  if (i >= j) return { social: socialAct([...lead, ...trail]), rest: "" };
  const peelable = (acts: SocialAct[]) => acts.every((a) => OPENERS.has(a) || SILENT.has(a));
  if (!peelable(lead)) {
    i = 0;
    lead = [];
  }
  if (!peelable(trail)) j = w.length;
  if (i === 0 && j === w.length) return { social: null, rest: text };
  const keptUnits = new Set(words.slice(i, j).map((x) => x.unit));
  const rest = units.filter((_, u) => keptUnits.has(u)).join(" ");
  const opener = lead.find((a) => OPENERS.has(a)) as Opener | undefined;
  return opener && i > 0 ? { social: null, opener, rest } : { social: null, rest };
}
