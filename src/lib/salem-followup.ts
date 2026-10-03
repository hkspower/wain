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
 *    to the last question and it is asked again. `answerOrder` already knows
 *    what «أرخص» and «بالليل» mean for the order, so nothing here re-ranks.
 *  - «غيره», «شي ثاني» shows the next places of the same answer, never the
 *    same eight twice.
 *  - «الثاني», «رقم ٣» picks one of the places on screen.
 *  - «وين بالضبط؟», «الموقع» answers where — for the place the visitor is
 *    pointing at, or the first one.
 *  - Anything else is a new question, and the memory starts again.
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

export type FollowUp =
  | { kind: "new"; query: string }
  | { kind: "refine"; query: string; added: string }
  | { kind: "more" }
  | { kind: "pick"; slug: string }
  | { kind: "where"; slug: string };

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
const LAST = fold(["الاخير", "الاخيره", "اخر", "اخرها"]);

/**
 * Words that narrow an answer. «مو غالي» is two of them: the negator travels
 * with the word for dear, and `answerOrder` reads the pair.
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
  "قريب", "قريبه",
]);

/** The words of a message, folded, with a leading «و» peeled off a word
 * the lists know: «وللعيال» is «للعيال», «وأرخص» is «أرخص». */
function words(message: string): string[] {
  const known = (w: string) =>
    FILLER.has(w) || MORE.has(w) || WHERE.has(w) || REFINERS.has(w) || ORDINALS.has(w) || LAST.has(w);
  return normalise(message)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => (w.length > 2 && w.startsWith("و") && !known(w) && known(w.slice(1)) ? w.slice(1) : w));
}

/** The longest reply that is read as a follow-up rather than a question. */
const SHORT = 4;

export function readFollowUp(message: string, ctx: ChatContext | null, active?: string | null): FollowUp {
  const text = message.trim();
  if (!ctx || ctx.shown.length === 0) return { kind: "new", query: text };
  const all = words(text);
  const core = all.filter((w) => !FILLER.has(w));
  if (all.length === 0 || all.length > SHORT + 2) return { kind: "new", query: text };

  // A position on screen: «الثاني», «رقم ٢», «الأخير».
  const ordinal = core.find((w) => ORDINALS.has(w));
  if (ordinal !== undefined && core.every((w) => ORDINALS.has(w) || ORDINAL_FILLER.has(w))) {
    const slug = ctx.shown[ORDINALS.get(ordinal)!];
    if (slug) return { kind: "pick", slug };
  }
  if (core.length > 0 && core.some((w) => LAST.has(w)) && core.every((w) => LAST.has(w) || ORDINAL_FILLER.has(w))) {
    return { kind: "pick", slug: ctx.shown[ctx.shown.length - 1] };
  }

  // Where — and only where: «وين بالضبط؟» is a follow-up, «وين أتعشى» is not.
  if (core.length > 0 && core.every((w) => WHERE.has(w))) {
    const slug = active && ctx.shown.includes(active) ? active : ctx.shown[0];
    return { kind: "where", slug };
  }

  // «غيره», «شي ثاني» — and a bare «ثاني» is «another», not «the second».
  if (core.length > 0 && core.every((w) => MORE.has(w))) return { kind: "more" };

  // Narrowing: short, and every word one that narrows.
  if (core.length > 0 && core.length <= SHORT && core.every((w) => REFINERS.has(w))) {
    return { kind: "refine", query: `${ctx.query} ${text}`, added: text };
  }

  return { kind: "new", query: text };
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
