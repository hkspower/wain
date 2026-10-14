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
import { normalise } from "@/lib/search";
import { isKuwaitNight, isSummerMonth } from "@/lib/kuwait-time";
import {
  OPENERS,
  SILENT,
  socialAct,
  socialFrame,
  splitWords,
  type Opener,
  type SocialAct,
} from "@/lib/social";

/* The social table and the part of Kuwait a question names moved out on
 * 8 October, so /search reads both the same way: social.ts, and
 * `elsewhereNamed` in answer-order.ts. Re-exported here so the chat and the
 * fixture generator keep their imports. */
export type { Opener, SocialAct };
export { elsewhereNamed } from "@/lib/answer-order";

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

/*
 * Three more kinds, 14 October, off a replay of the free chat in which each
 * of these was searched: «كم مكان فيه؟» opened the first place, «الخامس»
 * under four cafés answered with a souq, and «مو هذي» — narrowed by the word
 * «مو» — gave the same eight beaches back.
 *
 *  - `count`: «كم مكان فيه؟», «كم عددهم؟» — how many the last answer found,
 *    or the catalogue holds when nothing is on screen.
 *  - `beyond`: a position past the end of what is on screen; `at` is the
 *    number asked for, counted from one.
 *  - `reject`: «مو هذي», «ما عجبني», «ما أبي بحر» — a «no» to the answer. The
 *    answer stays, and he asks what instead.
 *
 * And `pick` carries `price` when the question was «كم سعره؟»: the catalogue
 * holds a price band, not a price, and the answer says so.
 */
export type FollowUp =
  | { kind: "new"; query: string; opener?: Opener }
  | { kind: "refine"; query: string; added: string; area?: string; opener?: Opener }
  | { kind: "more"; opener?: Opener }
  | { kind: "pick"; slug: string; price?: true; opener?: Opener }
  | { kind: "where"; slug: string; opener?: Opener }
  | { kind: "count"; opener?: Opener }
  | { kind: "beyond"; at: number; opener?: Opener }
  | { kind: "reject"; opener?: Opener }
  | { kind: "social"; act: SocialAct; opener?: Opener }
  | { kind: "ask"; what: "subject" | "area"; opener?: Opener };

const fold = (words: string[]) => new Set(words.map(normalise));

/** Words that carry nothing: «أبي واحد يكون…», «طيب», «لو سمحت», «عندك…؟». */
const FILLER = fold([
  "ابي", "ابغى", "ابا", "بغيت", "نبي", "عطني", "عطيني", "وريني", "شي", "شيء", "مكان", "واحد", "وحده", "يكون",
  "تكون", "فيه", "في", "هذا", "هذي", "هذاك", "طيب", "اوكي", "اوك", "ok", "يعني", "و", "بس", "حلو", "زين", "عن",
  "على", "ع", "ال", "انا", "احنا", "لو", "سمحت", "تكفى", "ممكن", "شنو", "شو", "ايش", "عاد", "هم", "بعد", "كذا",
  "اذا", "يا", "سالم", "الله", "يخليك", "لي", "لنا", "حق", "مال", "عندك", "عندكم", "يوجد", "موجود", "موجوده",
  // «مافيه…؟» typed as one word: the question about what there is (THERE_IS).
  "مافيه", "مافي", "ماعندك", "ماعندكم",
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

/**
 * «الثاني», «رقم ٣» — one of the places on screen, by its position. To the
 * tenth by name and to forty by number (an answer holds up to forty), so a
 * position past the end of what is on screen is read as one — `beyond` —
 * rather than searched: «رقم ٩» under eight places, and «الخامس» under four,
 * each went to the search and came back with a stranger (14 October).
 */
const ORDINALS = new Map<string, number>([
  ...["الاول", "اول", "اولها", "الاولى"].map((w) => [normalise(w), 0] as const),
  ...["الثاني", "الثانيه", "ثانيها"].map((w) => [normalise(w), 1] as const),
  ...["الثالث", "الثالثه", "ثالث", "ثالثها"].map((w) => [normalise(w), 2] as const),
  ...["الرابع", "الرابعه", "رابع"].map((w) => [normalise(w), 3] as const),
  ...["الخامس", "الخامسه", "خامس"].map((w) => [normalise(w), 4] as const),
  ...["السادس", "السادسه", "سادس"].map((w) => [normalise(w), 5] as const),
  ...["السابع", "السابعه", "سابع"].map((w) => [normalise(w), 6] as const),
  ...["الثامن", "الثامنه", "ثامن"].map((w) => [normalise(w), 7] as const),
  ...["التاسع", "التاسعه", "تاسع"].map((w) => [normalise(w), 8] as const),
  ...["العاشر", "العاشره", "عاشر"].map((w) => [normalise(w), 9] as const),
  ...Array.from({ length: 40 }, (_, i) => [String(i + 1), i] as const),
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
 * the order cannot know what is near (see NEAR). The negators are here so that
 * «وما»/«ومو» lose their «و» (`known`); a negator on its own narrows nothing
 * — see NEGATORS_CHAT.
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
 * «كم مكان فيه؟», «كم عددهم؟», «عدد الأماكن» — a count. It needs a word for
 * what is counted: «كم» alone, and «كم سعره؟», stay price questions (PRICE).
 */
const COUNT_ASK = fold(["كم", "عدد", "العدد", "عددهم", "عددها"]);
const COUNT_NOUN = fold([
  "مكان", "اماكن", "الاماكن", "واحد", "عدد", "العدد", "عددهم", "عددها", "خيار", "خيارات", "نتيجه", "نتايج", "نتائج",
  "محل", "محلات",
]);
const COUNT_WORDS = fold(["لقيت", "طلع", "طلعت", "كلها", "كلهم", "بالكل", "تقريبا"]);

/**
 * A «no» to the answer, and the words it is said with. A negator reads with
 * the next word that says something (wants and fillers skipped):
 *
 *  - «غالي» → the pair stays, because `answerOrder` reads «مو غالي» itself;
 *  - «برا», «داخلي», «زحمة» → their opposite, so «مو برا» is «داخلي» — read
 *    as a narrowing by the word, it was narrowed TO the outdoors;
 *  - anything else, and nothing at all — «مو هذي», «ما أبي», «ما عجبني»,
 *    «مو قهوة», «ما أبي بحر» — is `reject`, when it is the whole message.
 *
 * «مو» and «ما» were in REFINERS for «مو غالي», so on their own they were a
 * narrowing by nothing, and «مو هذي» gave the same eight beaches back.
 * «ولا» is not one: it is «or», and is never peeled to «لا».
 */
const NEGATORS_CHAT = fold(["مو", "ما", "مب", "مش", "موب", "مهوب", "لا"]);
/** Skipped between a negator and what it negates: «ما أبي أروح البحر». */
const WANT = fold(["ابي", "ابغى", "ابا", "نبي", "نبغى", "ودي", "بغيت", "اروح", "نروح", "اطلع", "نطلع"]);
/** What a «no» says after its negator, and needs nothing after it. */
const NOT_THIS = fold([
  "هذا", "هذي", "هذاك", "هذيك", "هذول", "هذولا", "هاذي", "هاذا", "ذا", "ذي", "اللي", "الي", "كذا", "عجبني",
  "يعجبني", "عاجبني", "عجبتني", "تعجبني", "عاجبتني", "حبيته", "حبيتها", "احبه", "احبها", "ابيه", "ابيها", "ابيهم",
  "ابغاه", "ابغاها", "حلو", "حلوه", "زين", "زينه", "صح", "مناسب", "مناسبه", "يصلح", "ينفع",
]);
/** «غلط», «خايس» — a «no» with no negator. */
const WRONG = fold(["غلط", "خطا", "سيء", "سيئ", "سيئه", "خايس", "خايسه", "زفت", "بايخ", "بايخه"]);
/** «مو غالي» — the one pair `answerOrder` reads (readAsks, «not dear»). */
const DEAR = fold(["غالي", "غاليه", "مكلف"]);
/** A word that a negator turns into another narrowing. */
const OPPOSITE = new Map<string, string>([
  ...["برا", "بره", "خارجي", "مكشوف"].map((w) => [normalise(w), "داخلي"] as const),
  ...["داخلي", "داخل", "مكيف", "مكيفه", "مسكر"].map((w) => [normalise(w), "برا"] as const),
  [normalise("زحمه"), "هادي"],
]);
/**
 * «ما فيه…؟», «ما في…؟», «ما عندك…؟» — a question about what there is, not
 * a «no»: its «ما» says nothing and is dropped before anything reads it. «ما
 * فيه شي بالسالمية؟» after an answer was searched whole and found nothing.
 */
const THERE_IS = fold(["فيه", "في", "عندك", "عندكم", "يوجد", "موجود"]);
const MA = normalise("ما");

type Negation = { kind: "none" | "keep" | "reject" } | { kind: "swap"; words: string[] };
const NO_NEGATION: Negation = { kind: "none" };

/** What the negators in a short reply do — see NEGATORS_CHAT. */
function readNegation(words: string[]): Negation {
  if (!words.some((w) => NEGATORS_CHAT.has(w))) return { kind: "none" };
  const says = (w: string) => !FILLER.has(w) && !WANT.has(w) && !NEGATORS_CHAT.has(w);
  const out: string[] = [];
  let swapped = false;
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (!NEGATORS_CHAT.has(w)) {
      out.push(w);
      continue;
    }
    let n = k + 1;
    while (n < words.length && !NOT_THIS.has(words[n]) && !says(words[n])) n++;
    const next = words[n];
    if (next !== undefined && DEAR.has(next)) {
      out.push(w);
      continue;
    }
    const opposite = next === undefined ? undefined : OPPOSITE.get(next);
    if (opposite) {
      out.push(opposite);
      swapped = true;
      k = n;
      continue;
    }
    // A «no»: only when nothing after it asks for something else — «ما أبي
    // بحر، أبي مطعم» is a question, and is read as one.
    const after = words.slice(n + 1).filter((x) => says(x) && !NOT_THIS.has(x));
    return after.length === 0 ? { kind: "reject" } : { kind: "none" };
  }
  return swapped ? { kind: "swap", words: out } : { kind: "keep" };
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
    BEST.has(w) || PRICE.has(w) || NEAR.has(w) || COUNT_ASK.has(w) || COUNT_NOUN.has(w) || WRONG.has(w) ||
    NOT_THIS.has(w)
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
    // «؟», «👍» — punctuation or an emoji: a nod, never a search. With nothing
    // on screen a thumbs-up was answered «هلا والله!» (14 October).
    return text ? { kind: "social", act: "ok" } : { kind: "new", query: text };
  }

  // What is said to a person, at the front and the back. Every act is noted;
  // only greetings, thanks and «تمام» are taken off a message that goes on to
  // say something else.
  const w = all.map((x) => x.w);
  const frame = socialFrame(w);
  const { lead, trail } = frame;
  let { i, j } = frame;

  // All of it is said to a person: answer that, and read nothing else.
  if (i >= j) return { kind: "social", ...socialAct([...lead, ...trail]) };
  // A greeting in front of a question is answered first; a «who» or a goodbye
  // in front of one is not a greeting, and the message is read whole. A «لا» in
  // front is the «no» to the last answer said before what is wanted instead:
  // «لا، أبي مطعم» asks for a restaurant, and «لا مو هذا» is a «no» either way,
  // so it is taken off too and the rest is read.
  const peelable = (acts: SocialAct[]) => acts.every((a) => OPENERS.has(a) || SILENT.has(a));
  if (!lead.every((a) => OPENERS.has(a) || SILENT.has(a) || a === "no")) i = 0;
  if (!peelable(trail)) j = w.length;
  const opener = lead.find((a) => OPENERS.has(a)) as Opener | undefined;
  const withOpener = <T extends FollowUp>(f: T): T => (opener && i > 0 ? ({ ...f, opener } as T) : f);

  // «ما فيه…؟», «ما عندك…؟» — a question about what there is: its «ما» says
  // nothing. Read as a «no», «ما فيه شي بالسالمية؟» after an answer was
  // searched whole and found nothing (14 October).
  const framed = all.slice(i, j);
  const kept = framed.filter(
    (x, k) => !(peelWaw(x.w) === MA && k + 1 < framed.length && THERE_IS.has(peelWaw(framed[k + 1].w)))
  );
  // The question as typed, without the greeting: every typed unit with a word
  // left in it.
  const keptUnits = new Set(kept.map((x) => x.unit));
  const rest =
    i === 0 && j === w.length && kept.length === all.length
      ? text
      : units.filter((_, u) => keptUnits.has(u)).join(" ");
  const restWords = kept.map((x) => peelWaw(x.w));
  const core = restWords.filter((x) => !FILLER.has(x));
  const asNew = withOpener({ kind: "new" as const, query: rest });
  const onScreen = !!ctx && ctx.shown.length > 0;

  // How many: «كم مكان فيه؟», «عددهم كم؟» — the last answer's, or the
  // catalogue's with nothing on screen. «كم سعره؟» is not one: a count names
  // what it counts. Read as a price, «كم مكان فيه؟» opened the first place.
  if (
    restWords.some((x) => COUNT_ASK.has(x)) &&
    restWords.some((x) => COUNT_NOUN.has(x)) &&
    restWords.every((x) => COUNT_ASK.has(x) || COUNT_NOUN.has(x) || COUNT_WORDS.has(x) || FILLER.has(x))
  ) {
    return withOpener({ kind: "count" });
  }

  // A «no» to the answer: «مو هذي», «ما عجبني», «ما أبي بحر», «غلط». The
  // answer stays and he asks what instead; with nothing on screen there is no
  // answer to say no to, so he asks what about.
  const negation = restWords.length <= SHORT + 2 ? readNegation(restWords) : NO_NEGATION;
  const wrong = core.some((x) => WRONG.has(x)) && core.every((x) => WRONG.has(x) || NOT_THIS.has(x));
  if (negation.kind === "reject" || wrong) {
    return withOpener(onScreen ? { kind: "reject" } : { kind: "ask", what: "subject" });
  }
  // «مو برا» is «داخلي», «ما أبي مكان زحمة» is «هادي» — the opposite, asked
  // for (readNegation). Narrowed by the words themselves, «مو برا» was
  // narrowed TO the outdoors.
  if (negation.kind === "swap") {
    const said = negation.words.filter((x) => !FILLER.has(x) && !MORE.has(x));
    const narrowing = said.filter((x) => !NEGATORS_CHAT.has(x));
    if (narrowing.length > 0 && said.length <= SHORT && narrowing.every((x) => REFINERS.has(x))) {
      const added = said.join(" ");
      return withOpener(onScreen ? { kind: "refine", query: `${ctx!.query} ${added}`, added } : { kind: "new", query: added });
    }
  }

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
  // where it is, when that is what was asked: «وين الثاني؟». A position past
  // the end of what is on screen is `beyond`, never a search.
  const positional = (x: string) =>
    ORDINALS.has(x) || ORDINAL_FILLER.has(x) || LAST.has(x) || BEST.has(x) || WHERE.has(x) || PRICE.has(x);
  const price = core.some((x) => PRICE.has(x)) ? ({ price: true } as const) : {};
  if (core.length > 0 && core.every(positional)) {
    const ordinal = core.find((x) => ORDINALS.has(x));
    const at = ordinal === undefined ? undefined : ORDINALS.get(ordinal)!;
    if (at !== undefined && at >= ctx.shown.length) return withOpener({ kind: "beyond", at: at + 1 });
    const slug =
      at !== undefined
        ? ctx.shown[at]
        : core.some((x) => LAST.has(x))
          ? ctx.shown[ctx.shown.length - 1]
          : core.some((x) => BEST.has(x))
            ? ctx.shown[0]
            : undefined;
    if (slug) {
      return core.some((x) => WHERE.has(x))
        ? withOpener({ kind: "where", slug })
        : withOpener({ kind: "pick", slug, ...price });
    }
  }

  // «كم سعره؟» — the place being pointed at, or the first.
  if (core.length > 0 && core.some((x) => PRICE.has(x)) && core.every((x) => PRICE.has(x) || WHERE.has(x))) {
    return withOpener({ kind: "pick", slug: active && ctx.shown.includes(active) ? active : ctx.shown[0], price: true });
  }

  // Where — and only where: «وين بالضبط؟» is a follow-up, «وين أتعشى» is not.
  if (core.length > 0 && core.every((x) => WHERE.has(x))) {
    const slug = active && ctx.shown.includes(active) ? active : ctx.shown[0];
    return withOpener({ kind: "where", slug });
  }

  // «غيره», «شي ثاني» — and a bare «ثاني» is «another», not «the second».
  if (core.length > 0 && core.every((x) => MORE.has(x))) return withOpener({ kind: "more" });

  // Narrowing: short, and every word one that narrows. «غيره أرخص» is the
  // same narrowing — the «غيره» says nothing the narrowed answer does not. A
  // negator narrows nothing by itself: it travels with the word it negates
  // («مو غالي», read by `answerOrder`).
  const refining = core.filter((x) => !MORE.has(x));
  const narrowing = refining.filter((x) => !NEGATORS_CHAT.has(x));
  if (narrowing.length > 0 && refining.length <= SHORT && narrowing.every((x) => REFINERS.has(x))) {
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
 * Where a place is, as he says it: its name and its area — once. «شاطئ الشعب
 * — الشعب.» said the area twice, because the place is named after it
 * (14 October). Matched as whole words, folded, so an area inside a longer
 * word is not taken for the area itself.
 */
export function whereLine(p: Pick<Place, "nameAr" | "areaAr">): string {
  const name = ` ${splitWords(normalise(p.nameAr)).join(" ")} `;
  const area = ` ${splitWords(normalise(p.areaAr)).join(" ")} `;
  return name.includes(area) ? `${p.nameAr}.` : `${p.nameAr} — ${p.areaAr}.`;
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
