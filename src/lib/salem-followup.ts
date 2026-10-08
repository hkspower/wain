/**
 * What a short reply to سالم means — the chat's memory, in the free build.
 *
 * Every message used to be a new search. «قهوة» answered with eight cafés,
 * and then «أرخص» searched for the word «أرخص» on its own, «غيره» found
 * nothing, and «وين بالضبط؟» was read as a question about the word «وين». A
 * person in a chat answers the last thing said; the chat answered nothing it
 * had said.
 *
 * So a message is read against the last answer first:
 *
 *  - «أرخص», «داخلي», «للعيال», «بس على البحر» narrow it: the words are added
 *    to the last question and it is asked again — and the answer stays inside
 *    the places the last one found (`withinAnswer`). `answerOrder` already
 *    knows what «أرخص» and «بالليل» mean for the order, so nothing here
 *    re-ranks.
 *  - An area name — «السالمية», «بحولي» — narrows it to that area.
 *  - «غيره», «شي ثاني» shows the next places of the same answer, never the
 *    same eight twice.
 *  - «الثاني», «رقم ٣», «أحسن واحد» picks one of the places on screen; «وين
 *    الثاني؟» says where it is.
 *  - «وين بالضبط؟», «الموقع» answers where — for the place the visitor is
 *    pointing at, or the first one.
 *  - Anything else is a new question, and the memory starts again.
 *
 * And a message that is not about places at all is not searched (8 October,
 * read off what the live chat answered while the agent was out of credits):
 * «السلام عليكم» answered «جرّب قصر السلام», «مين أنت؟» a bridge, «شكراً» and
 * «هلا» «ما لقيت شي» — and the «ما لقيت» wiped the memory, so the chips under
 * the answer the visitor had just thanked him for then led somewhere else
 * («وين بالضبط؟» under four cafés → the Grand Mosque). Greetings, thanks,
 * «مين أنت», «شنو تقدر تسوي», goodbyes and «تمام» are `social`, answered in
 * words and never touching the memory; a greeting in front of a question is
 * taken off it and answered first (`opener`); a follow-up with nothing to
 * follow, or «قريب مني» from a page that does not know where you are, is
 * `ask`.
 *
 * Deliberately narrow. A long sentence is a new question even when it starts
 * like a follow-up, because guessing that «أبي مطعم بحري» narrows «قهوة» would
 * answer a question nobody asked. A short reply is the only thing this reads,
 * and every word in it has to be one the lists below know.
 *
 * Imports the search's own `normalise`, so a word is folded here exactly as
 * the index folds it. That makes this module part of the search chunk —
 * SalemChat loads it with the index, never up front.
 */
import type { Place } from "@/lib/places";
import {
  ELSEWHERE_IN_KUWAIT,
  PHRASE_PAIRS,
  declitic,
  normalise,
  tokenize,
  type SearchIndex,
} from "@/lib/search";
import { isKuwaitNight, isSummerMonth } from "@/lib/kuwait-time";

/** What the chat remembers about its last answer. */
export interface ChatContext {
  /** The question that answer was for — refinements included. */
  query: string;
  /** Every place that answer found, in its order (up to 40). */
  ranked: string[];
  /** Those already put on screen, across «غيره» turns. */
  seen: string[];
  /** The ones on screen in the latest turn. */
  shown: string[];
}

/** A greeting said in front of a question, answered before the answer. */
export type Opener = "salam" | "greet" | "morning" | "evening";
/** A message that is not about places. */
export type SocialAct = Opener | "how" | "thanks" | "afia" | "who" | "notShouq" | "help" | "bye" | "ok" | "no";

export type FollowUp =
  | { kind: "new"; query: string; opener?: Opener }
  | { kind: "refine"; query: string; added: string; area?: string; opener?: Opener }
  | { kind: "more"; opener?: Opener }
  | { kind: "pick"; slug: string; opener?: Opener }
  | { kind: "where"; slug: string; opener?: Opener }
  | { kind: "social"; act: SocialAct; opener?: Opener }
  | { kind: "ask"; what: "subject" | "area"; opener?: Opener };

const fold = (words: string[]) => new Set(words.map(normalise));

/** Words that carry nothing: «أبي واحد يكون…», «طيب», «لو سمحت». */
const FILLER = fold([
  "ابي", "ابغى", "ابا", "بغيت", "نبي", "عطني", "عطيني", "وريني", "شي", "شيء", "مكان", "واحد", "وحده", "يكون",
  "تكون", "فيه", "في", "هذا", "هذي", "هذاك", "طيب", "اوكي", "اوك", "ok", "يعني", "و", "بس", "حلو", "زين", "عن",
  "على", "ع", "ال", "انا", "احنا", "لو", "سمحت", "تكفى", "ممكن", "شنو", "شو", "ايش", "عاد", "هم", "بعد", "كذا",
  "اذا", "يا", "سالم", "الله", "يخليك", "لي", "لنا", "حق", "مال",
]);

/** «غيره» — the next places of the same answer. */
const MORE = fold([
  "غيره", "غيرها", "غيرهم", "غير", "ثاني", "ثانيه", "ثانين", "زود", "اكثر", "باقي", "كمان", "المزيد", "مزيد",
  "خيارات", "اقتراحات", "بدايل", "بديل",
]);

/** «وين بالضبط؟» — where, for the place being pointed at. */
const WHERE = fold([
  "وين", "وينه", "وينها", "وينهم", "موقع", "الموقع", "موقعه", "موقعها", "لوكيشن", "اللوكيشن", "طريق",
  "الطريق", "بالضبط", "مكانه", "مكانها", "خريطه", "الخريطه", "العنوان", "عنوانه", "هو", "هي",
]);

/** «الثاني», «رقم ٣» — one of the places on screen, by its position. */
const ORDINALS = new Map<string, number>([
  ...["الاول", "اول", "اولها", "الاولى"].map((w) => [normalise(w), 0] as const),
  ...["الثاني", "الثانيه", "ثانيها"].map((w) => [normalise(w), 1] as const),
  ...["الثالث", "الثالثه", "ثالث", "ثالثها"].map((w) => [normalise(w), 2] as const),
  ...["الرابع", "الرابعه", "رابع"].map((w) => [normalise(w), 3] as const),
  ...["الخامس", "الخامسه", "خامس"].map((w) => [normalise(w), 4] as const),
  ...["1", "2", "3", "4", "5", "6", "7", "8"].map((d) => [d, Number(d) - 1] as const),
]);
const ORDINAL_FILLER = fold(["رقم", "المكان", "اللي", "الي", "خلنا", "ناخذ", "نروح", "ابي", "ودي", "هذا", "واحد"]);
/** «وين» on its own — see readFollowUp. */
const WHERE_ALONE = normalise("وين");
const LAST = fold(["الاخير", "الاخيره", "اخر", "اخرها"]);
/**
 * «أحسن واحد» is the first place: the answer's order IS its best guess. It was
 * searched for the words «أحسن واحد» and answered with a souq.
 */
const BEST = fold(["احسن", "الاحسن", "افضل", "الافضل", "احلى", "الاحلى"]);
/**
 * «كم سعر الأول؟» is the first place, and its card says the price band — the
 * catalogue has no prices, so a card is all an honest answer can show. It was
 * searched for «سعر» and answered with a bridge.
 */
const PRICE = fold(["كم", "بكم", "سعر", "سعره", "سعرها", "اسعار", "الاسعار", "اسعاره", "اسعارها", "السعر"]);
/**
 * «قريب مني», «وين أقرب واحد». The page does not know where the visitor is —
 * on purpose, it never asks for a position — so the only honest answer is a
 * question back. Searched, «قريب مني» answered with a Friday market.
 */
const NEAR = fold(["قريب", "قريبه", "اقرب", "الاقرب", "جنبي", "حذالي", "near", "nearby", "closest", "nearest"]);
const NEAR_FILLER = fold(["مني", "منا", "عندي", "عندنا", "me", "us"]);

/**
 * Words that narrow an answer. «مو غالي» is two of them: the negator travels
 * with the word for dear, and `answerOrder` reads the pair. «قريب» is not one:
 * the order cannot know what is near (see NEAR).
 */
const REFINERS = fold([
  // the price
  "رخيص", "رخيصه", "ارخص", "اقتصادي", "ميزانيه", "بلاش", "غالي", "مو", "ما", "مب",
  // inside or out
  "داخلي", "داخل", "مكيف", "مكيفه", "مسكر", "برا", "بره", "خارجي", "مكشوف",
  // who with
  "عيال", "للعيال", "لعيال", "اطفال", "للاطفال", "صغار", "عائلي", "عائليه", "عايلي", "عائله", "عايله", "شباب",
  "للشباب", "بنات", "ربع", "الربع", "للربع", "شخصين", "زوجتي", "رومانسي",
  // the kind of outing
  "هادي", "هادئ", "هاديه", "زحمه", "رايق", "فخم", "بحر", "البحر", "عالبحر", "بالبحر", "شاطئ", "منظر",
  // the hour
  "ليل", "بالليل", "الليله", "سهره", "عشا", "غدا", "فطور", "ريوق", "الصبح", "العصر", "الحين", "باجر", "الويكند",
]);

/**
 * The things people say to a person and not to a search box. Each phrase is
 * folded the way the message is, so «شكراً» and «شكرا» are one entry, and
 * matched as whole words at a word boundary: «السلام» opens «السلام عليكم» and
 * is never looked for inside «قصر السلام».
 */
const SOCIAL: [SocialAct, string[]][] = [
  ["salam", ["السلام عليكم", "سلام عليكم", "السلام عليكم ورحمه الله", "السلام عليكم ورحمه الله وبركاته", "السلام", "سلام"]],
  ["greet", ["هلا", "هلا والله", "هلا وغلا", "هلا فيك", "هلا بك", "يا هلا", "اهلا", "اهلين", "اهلا وسهلا", "مرحبا", "مرحبتين", "هاي", "هلو", "hi", "hello", "hey", "salam"]],
  ["morning", ["صباح الخير", "صباح النور", "صباح الورد", "صباحو", "good morning"]],
  ["evening", ["مساء الخير", "مساء النور", "مساء الورد", "مسا الخير", "good evening"]],
  ["how", ["شلونك", "شلونكم", "شلونك اليوم", "شلون حالك", "شخبارك", "شخبارك اليوم", "شلون الحال", "كيفك", "كيف حالك", "عساك بخير", "عساك طيب", "how are you"]],
  ["thanks", ["شكرا", "شكرا لك", "شكرا جزيلا", "مشكور", "مشكوره", "تسلم", "تسلم يدك", "تسلم ايدك", "ما قصرت", "كفو", "مرسي", "ميرسي", "ثانكس", "ثانكيو", "جزاك الله خير", "يزاك الله خير", "الله يجزاك خير", "thanks", "thank you", "thx", "ty"]],
  ["afia", ["يعطيك العافيه", "الله يعطيك العافيه", "عطاك الله العافيه"]],
  ["who", ["مين انت", "منو انت", "من انت", "انت مين", "انت منو", "شنو اسمك", "وش اسمك", "شسمك", "شو اسمك", "اسمك", "شنو انت", "انت شنو", "انت بوت", "انت روبوت", "انت انسان", "who are you", "what is your name", "whats your name"]],
  ["notShouq", ["انت شوق", "انتي شوق", "هذي شوق", "انت شوق ولا سالم"]],
  ["help", ["شنو تقدر تسوي", "شنو تسوي", "وش تقدر تسوي", "وش تسوي", "شتسوي", "شنو عندك", "وش عندك", "شعندك", "ساعدني", "كيف استخدمك", "شلون استخدمك", "شلون استخدمه", "help"]],
  ["bye", ["مع السلامه", "باي", "باي باي", "يلا باي", "يلا سلام", "فمان الله", "في امان الله", "تصبح علي خير", "تصبحون علي خير", "الله وياك", "bye", "bye bye", "goodbye"]],
  ["ok", ["اوكي", "اوك", "اوكيه", "ok", "okay", "تمام", "طيب", "زين", "ماشي", "حلو", "ايه", "اي", "اكيد", "نعم", "يب", "يس", "yes", "هه", "ه", "هاها", "lol"]],
  ["no", ["لا", "لا شكرا", "لا مشكور", "no", "no thanks"]],
];
/** Phrase (folded words, space-joined) → what it is. */
const SOCIAL_PHRASES = new Map<string, SocialAct>();
for (const [act, phrases] of SOCIAL) {
  for (const p of phrases) SOCIAL_PHRASES.set(splitWords(normalise(p)).join(" "), act);
}
const LONGEST_PHRASE = Math.max(...[...SOCIAL_PHRASES.keys()].map((k) => k.split(" ").length));
/** Said to a person, around anything: «يا سالم», «والله», «لو سمحت». */
const VOCATIVE = fold([
  "يا", "سالم", "اخوي", "حبيبي", "والله", "بالله", "الله", "يلا", "يالله", "طال", "عمرك", "لو", "سمحت", "بليز",
  "please", "تكفى", "ياخي", "يالغالي", "الغالي",
]);
const OPENERS = new Set<SocialAct>(["salam", "greet", "morning", "evening"]);
/** Taken off the front or the back of a question without a word said back. */
const SILENT = new Set<SocialAct>(["thanks", "afia", "ok"]);
/** When a message is several of these, the one that is answered. */
const PRIORITY: SocialAct[] = [
  "notShouq", "who", "help", "how", "bye", "afia", "thanks", "no", "ok", "salam", "morning", "evening", "greet",
];

function splitWords(folded: string): string[] {
  return folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The social phrase starting at `i`, longest first. */
function phraseAt(words: string[], i: number): { act: SocialAct; len: number } | null {
  for (let len = Math.min(LONGEST_PHRASE, words.length - i); len >= 1; len--) {
    const act = SOCIAL_PHRASES.get(words.slice(i, i + len).join(" "));
    if (act) return { act, len };
  }
  return null;
}
/** The social phrase ending at `j` (exclusive), longest first. */
function phraseBefore(words: string[], j: number, from: number): { act: SocialAct; len: number } | null {
  for (let len = Math.min(LONGEST_PHRASE, j - from); len >= 1; len--) {
    const act = SOCIAL_PHRASES.get(words.slice(j - len, j).join(" "));
    if (act) return { act, len };
  }
  return null;
}

/** A message as words, each folded, and the stretch of the TYPED text it came
 *  from — so the part of a question left after its greeting is handed on in
 *  the visitor's own spelling. */
interface Word {
  w: string;
  unit: number;
}
function wordsOf(message: string): { words: Word[]; units: string[] } {
  const units = message.split(/\s+/).filter(Boolean);
  const words: Word[] = [];
  units.forEach((u, unit) => {
    for (const w of splitWords(normalise(u))) words.push({ w, unit });
  });
  return { words, units };
}

/** The words of a message, folded, with a leading «و» peeled off a word
 * the lists know: «وللعيال» is «للعيال», «وأرخص» is «أرخص». */
function peelWaw(w: string): string {
  return w.length > 2 && w.startsWith("و") && !known(w) && known(w.slice(1)) ? w.slice(1) : w;
}
function known(w: string): boolean {
  return (
    FILLER.has(w) || MORE.has(w) || WHERE.has(w) || REFINERS.has(w) || ORDINALS.has(w) || LAST.has(w) ||
    BEST.has(w) || PRICE.has(w) || NEAR.has(w)
  );
}
function words(message: string): string[] {
  return splitWords(normalise(message)).map(peelWaw);
}

/** The longest reply that is read as a follow-up rather than a question. */
const SHORT = 4;

/** A catalogue area named by the whole of `core` — «السالمية», «بحولي», «في
 *  مدينة الكويت» — as the catalogue spells it, or null. */
function areaNamed(core: string[], areas: Map<string, string> | undefined): string | null {
  if (!areas || core.length === 0 || core.length > 3) return null;
  const joined = core.join(" ");
  const tries = [joined];
  // «بالسالمية», «لحولي» — a particle glued to the first word.
  const m = joined.match(/^(?:بال|لل|ب|ل)(.+)$/);
  if (m) tries.push(m[1], "ال" + m[1]);
  // «سالمية» for «السالمية».
  tries.push("ال" + joined);
  for (const t of tries) {
    const hit = areas.get(t);
    if (hit) return hit;
  }
  return null;
}

/** The catalogue's areas, folded → as written, for `readFollowUp`. */
export function areaIndex(areaNames: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const name of areaNames) map.set(splitWords(normalise(name)).join(" "), name);
  return map;
}

export function readFollowUp(
  message: string,
  ctx: ChatContext | null,
  active?: string | null,
  areas?: Map<string, string>
): FollowUp {
  const text = message.trim();
  const { words: all, units } = wordsOf(text);
  if (all.length === 0) {
    // «؟», «👍» — punctuation or an emoji, nothing to read.
    return text ? { kind: "social", act: ctx && ctx.shown.length ? "ok" : "greet" } : { kind: "new", query: text };
  }

  // What is said to a person, at the front and the back. Every act is noted;
  // only greetings, thanks and «تمام» are taken off a message that goes on to
  // say something else — «لا أبي شي مو غالي» is not a «no».
  const w = all.map((x) => x.w);
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

  // All of it is said to a person: answer that, and read nothing else.
  if (i >= j) {
    const acts = [...lead, ...trail];
    if (acts.length === 0) return { kind: "social", act: "greet" }; // «يا سالم»
    const act = PRIORITY.find((a) => acts.includes(a))!;
    const greeting = acts.find((a) => OPENERS.has(a)) as Opener | undefined;
    return greeting && !OPENERS.has(act) && ["how", "who", "help", "notShouq"].includes(act)
      ? { kind: "social", act, opener: greeting }
      : { kind: "social", act };
  }
  // A greeting in front of a question is answered first; a «no», a «who» or a
  // goodbye in front of one is not a greeting, and the message is read whole.
  const peelable = (acts: SocialAct[]) => acts.every((a) => OPENERS.has(a) || SILENT.has(a));
  if (!peelable(lead)) i = 0;
  if (!peelable(trail)) j = w.length;
  const opener = lead.find((a) => OPENERS.has(a)) as Opener | undefined;
  const withOpener = <T extends FollowUp>(f: T): T => (opener && i > 0 ? ({ ...f, opener } as T) : f);

  const kept = all.slice(i, j);
  // The question as typed, without the greeting: every typed unit with a word
  // left in it.
  const keptUnits = new Set(kept.map((x) => x.unit));
  const rest = i === 0 && j === w.length ? text : units.filter((_, u) => keptUnits.has(u)).join(" ");
  const restWords = kept.map((x) => peelWaw(x.w));
  const core = restWords.filter((x) => !FILLER.has(x));
  const asNew = withOpener({ kind: "new" as const, query: rest });

  // «قريب مني» — there is nothing on this page to be near to.
  if (
    core.some((x) => NEAR.has(x)) &&
    core.every((x) => NEAR.has(x) || NEAR_FILLER.has(x) || WHERE.has(x) || MORE.has(x) || ORDINAL_FILLER.has(x))
  ) {
    return withOpener({ kind: "ask", what: "area" });
  }

  // A follow-up with nothing to follow: «غيره», «وين بالضبط؟», «الثاني» as the
  // first thing said, or after a question that found nothing. Searched, these
  // answered with whatever the words happened to match. «وين» alone is not
  // one — «وين نروح» is the commonest question there is (a pick for the hour,
  // answer-order.ts), and «وين» alone still finds the page about وين.
  const followOnly = (x: string) =>
    MORE.has(x) || WHERE.has(x) || ORDINALS.has(x) || ORDINAL_FILLER.has(x) || LAST.has(x) || BEST.has(x) || PRICE.has(x);
  const followWord = (x: string) =>
    MORE.has(x) || (WHERE.has(x) && x !== WHERE_ALONE) || ORDINALS.has(x) || LAST.has(x) || BEST.has(x) || PRICE.has(x);
  if (!ctx || ctx.shown.length === 0) {
    if (core.length > 0 && core.every(followOnly) && core.some(followWord)) return withOpener({ kind: "ask", what: "subject" });
    // «غيره أرخص» with nothing before it is «أرخص»: there is no «غيره» to give.
    if (core.some((x) => MORE.has(x)) && !core.every((x) => MORE.has(x))) {
      const units2 = new Set(kept.filter((x) => !MORE.has(peelWaw(x.w))).map((x) => x.unit));
      return withOpener({ kind: "new", query: units.filter((_, u) => units2.has(u)).join(" ") });
    }
    return asNew;
  }
  if (restWords.length > SHORT + 2) return asNew;

  // A position on screen: «الثاني», «رقم ٢», «الأخير», «أحسن واحد» — and
  // where it is, when that is what was asked: «وين الثاني؟».
  const positional = (x: string) =>
    ORDINALS.has(x) || ORDINAL_FILLER.has(x) || LAST.has(x) || BEST.has(x) || WHERE.has(x) || PRICE.has(x);
  if (core.length > 0 && core.every(positional)) {
    const ordinal = core.find((x) => ORDINALS.has(x));
    const slug =
      ordinal !== undefined
        ? ctx.shown[ORDINALS.get(ordinal)!]
        : core.some((x) => LAST.has(x))
          ? ctx.shown[ctx.shown.length - 1]
          : core.some((x) => BEST.has(x))
            ? ctx.shown[0]
            : undefined;
    if (slug) {
      return core.some((x) => WHERE.has(x)) ? withOpener({ kind: "where", slug }) : withOpener({ kind: "pick", slug });
    }
  }

  // «كم سعره؟» — the place being pointed at, or the first.
  if (core.length > 0 && core.some((x) => PRICE.has(x)) && core.every((x) => PRICE.has(x) || WHERE.has(x))) {
    return withOpener({ kind: "pick", slug: active && ctx.shown.includes(active) ? active : ctx.shown[0] });
  }

  // Where — and only where: «وين بالضبط؟» is a follow-up, «وين أتعشى» is not.
  if (core.length > 0 && core.every((x) => WHERE.has(x))) {
    const slug = active && ctx.shown.includes(active) ? active : ctx.shown[0];
    return withOpener({ kind: "where", slug });
  }

  // «غيره», «شي ثاني» — and a bare «ثاني» is «another», not «the second».
  if (core.length > 0 && core.every((x) => MORE.has(x))) return withOpener({ kind: "more" });

  // Narrowing: short, and every word one that narrows. «غيره أرخص» is the
  // same narrowing — the «غيره» says nothing the narrowed answer does not.
  const refining = core.filter((x) => !MORE.has(x));
  if (refining.length > 0 && refining.length <= SHORT && refining.every((x) => REFINERS.has(x))) {
    const added = core.length === refining.length ? rest : kept.filter((x) => !MORE.has(peelWaw(x.w))).map((x) => x.w).join(" ");
    return withOpener({ kind: "refine", query: `${ctx.query} ${added}`, added });
  }

  // An area: the last answer, there. «قهوة» then «السالمية» is coffee in
  // Salmiya, not everything in Salmiya.
  const area = areaNamed(core, areas);
  if (area) return withOpener({ kind: "refine", query: `${ctx.query} ${area}`, added: rest, area });

  return asNew;
}

/**
 * A narrowed question's places, kept to the ones the answer it narrows had
 * found, in the narrowed order. «قهوة» then «أرخص» searched «قهوة أرخص», and
 * «أرخص» matched on its own: the zoo came into a list of cafés, and «عشا»
 * then «للعيال» led with the zoo «روح الصبح».
 */
export function withinAnswer(ranked: string[], ctx: ChatContext): string[] {
  const had = new Set(ctx.ranked);
  return ranked.filter((s) => had.has(s));
}

/**
 * The part of Kuwait a question names that this catalogue has nothing in —
 * «الجهراء», «بسلوى», «صباح السالم» — as the visitor wrote it, without the
 * particle glued to its front; or null. search() answers such a question with
 * nothing, which is honest; this is what lets the answer say WHY. سالم used to
 * reply «ما لقيت شي… جرّب اسم منطقة» to the name of a governorate (8 October).
 *
 * Here and not in search.ts, though it is the search's own rule read back:
 * only سالم says it, and an export of search.ts ships on /search whether
 * /search calls it or not — it put /search at 175.9K of its 176K.
 */
export function elsewhereNamed(query: string, index: SearchIndex): string | null {
  const elsewhere = (t: string) => ELSEWHERE_IN_KUWAIT.has(t) && !index.postings.has(t);
  const units = query
    .split(/\s+/)
    .map((u) => u.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  for (const unit of units) {
    const t = tokenize(unit)[0];
    if (!t) continue;
    if (elsewhere(t)) return unit;
    if (declitic(t).some(elsewhere)) {
      // «بالجهراء» → «الجهراء», «للجهراء» → «الجهراء», «بسلوى» → «سلوى».
      if (/^[بوفك]ال/.test(unit)) return unit.slice(1);
      if (unit.startsWith("لل")) return "ال" + unit.slice(2);
      return unit.slice(1);
    }
  }
  for (let i = 0; i + 1 < units.length; i++) {
    const a = tokenize(units[i]).at(-1);
    const b = tokenize(units[i + 1])[0];
    // Adjacent, and only as the search reads them: «صباح السالم», not
    // «بصباح السالم» — which the search does not stop either.
    if (PHRASE_PAIRS.some(([x, y]) => x === a && y === b)) return `${units[i]} ${units[i + 1]}`;
  }
  return null;
}

/** The next places of the same answer, for «غيره». Empty when it has none. */
export function nextPlaces(ctx: ChatContext, count = 8): string[] {
  const seen = new Set(ctx.seen);
  return ctx.ranked.filter((s) => !seen.has(s)).slice(0, count);
}

type Chippable = Pick<Place, "slug" | "priceLevel" | "setting" | "summerOk">;

/**
 * The replies offered under an answer — the ones that would change it.
 *
 * Each is checked against the answer rather than offered every time: «أرخص»
 * under eight places that are all in the cheapest band would return the same
 * eight, and a chip that does nothing teaches people to stop tapping chips.
 * At most four, so the row stays one row on a phone.
 */
export function followUpChips(
  ctx: ChatContext,
  shown: Chippable[],
  clock: { month: number; hour: number }
): string[] {
  const asked = new Set(words(ctx.query));
  const has = (...w: string[]) => w.some((x) => asked.has(normalise(x)));
  const chips: string[] = [];
  if (!has("رخيص", "رخيصه", "ارخص", "اقتصادي", "ميزانيه") && shown.some((p) => p.priceLevel > 1)) chips.push("أرخص");
  if (
    isSummerMonth(clock.month) &&
    !isKuwaitNight(clock.hour) &&
    !has("داخلي", "مكيف", "برا", "بحر") &&
    shown.some((p) => p.setting !== "indoor" && !p.summerOk)
  ) {
    chips.push("داخلي");
  }
  if (!has("عيال", "للعيال", "اطفال", "عائلي") && chips.length < 2) chips.push("للعيال");
  if (nextPlaces(ctx).length > 0) chips.push("غيره");
  chips.push("وين بالضبط؟");
  return chips.slice(0, 4);
}
