/**
 * Wain's search engine.
 *
 * Small corpus (places, categories, areas, pages), so the whole index is built
 * in the browser at startup and every query is answered locally — no network,
 * no service, works offline, and results appear as fast as you can type.
 *
 * The pieces that matter for Arabic:
 *   - normalisation folds alef/ya/ta-marbuta variants and strips diacritics
 *     and tatweel, so «المباركيه» and «المُباركية» reach the same token;
 *   - synonyms map how people actually ask («مقهى», «كوفي» → قهوة);
 *   - ranking is BM25 over weighted fields rather than substring matching, so
 *     a hit on a name outranks a passing mention in a description;
 *   - unmatched tokens fall back to prefix and edit-distance matching, so
 *     partial words and typos still find the place.
 */
import { toStandardArabic } from "@/lib/arabic";
import {
  categories,
  countAr,
  places as snapshot,
  PLACES_COUNT,
  type CategoryId,
  type Place,
} from "@/lib/places";

export type DocKind = "place" | "category" | "area" | "page";

export interface SearchDoc {
  id: string;
  kind: DocKind;
  title: string;
  subtitle: string;
  url: string;
  category?: CategoryId;
  /** Extra terms that should match but are not shown. */
  keywords: string[];
  body: string;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
  /** Which query tokens actually matched, for highlighting. */
  matched: string[];
}

/* ------------------------------------------------------------------ */
/* Text handling                                                       */
/* ------------------------------------------------------------------ */

/** Fold Arabic orthographic variants so equivalent spellings collide. */
export function normalise(value: string): string {
  // Kuwaiti spellings first: چ/ی/ک are not Arabic letters, and the last two are
  // the same GLYPH as ي and ك — a word spelled correctly on a Farsi keyboard
  // found nothing, with nothing on screen to explain why. See lib/arabic.
  return toStandardArabic(value)
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, "") // harakat
    .replace(/ـ/g, "") // tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    /* And the Latin half, which had no folding at all.
     *
     * The catalogue calls one place «Gulf Road Cafés», so the index held
     * `cafés` and nothing else — and «cafe», which is how anybody types it,
     * matched nothing. Not a near miss either: with no `cafe` term to be near,
     * the fuzzy pass had nothing to reach, so the commonest English word for
     * the thing returned an empty page.
     *
     * Safe to apply to the whole string at this point rather than to the Latin
     * runs alone: every Arabic combining mark and precomposed form above has
     * already been folded by the replacements before it, so there is nothing
     * left here for NFD to take apart. It also catches the Arabic marks the
     * harakat range misses, which is a gain rather than a risk. */
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    /* A letter held for emphasis — «ابيييي بحرررر», «مطاعممم» — is one
     * letter. Three or more, because no Arabic word and no index term
     * carries a letter three times running, so nothing real is folded;
     * two is a real word as often as not («الله»). */
    .replace(/(\p{L})\1{2,}/gu, "$1")
    .trim();
}

/**
 * Leading particles carry no meaning for retrieval.
 *
 * Compared AFTER normalise(), so an entry only works if it is written in its
 * folded form — and two of these are not. «على» folds to «علي» and «الى» to
 * «الي», so neither has ever been dropped. Not corrected here, deliberately:
 * this set also tokenises the index, so editing it re-scores every document.
 * The query-side filler list in search() drops the folded forms instead.
 *
 * «ذا» is «The» as Arabic spells a brand — «ذا أفنيوز» — and appears in no
 * document, so it costs the index nothing; left in, it prefix-matched
 * «ذاكرة» and put the martyrs' park beside the Avenues.
 */
export const STOP = new Set(["ال", "في", "من", "على", "الى", "عن", "مع", "او", "و", "the", "a", "of", "in", "ذا"]);

export function tokenize(value: string): string[] {
  return normalise(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 3 && t.startsWith("ال") ? t.slice(2) : t));
}

/** How people actually phrase things → the vocabulary the data uses. */
export const SYNONYMS: Record<string, string[]> = {
  مقهى: ["قهوه", "كافيه"],
  كوفي: ["قهوه", "كافيه"],
  كافي: ["قهوه", "كافيه"],
  شاي: ["قهوه", "چاي", "كرك"],
  كرك: ["قهوه", "چاي"],
  مطعم: ["مطاعم", "اكل", "غدا", "عشا"],
  اكل: ["مطاعم", "مطعم"],
  عشاء: ["مطاعم", "عشا"],
  غداء: ["مطاعم", "غدا"],
  // «فطار» was a value here. No place says it, so the fuzzy pass took it one
  // letter to «فنار» and every breakfast search lifted الفنار مول.
  فطور: ["مطاعم"],
  برجر: ["وجبات", "سريعه"],
  بحر: ["شواطئ", "شاطئ", "ساحل", "بحري"],
  سباحه: ["شواطئ", "شاطئ"],
  حديقه: ["حدائق", "خضره", "بارك"],
  بارك: ["حدائق", "حديقه"],
  متحف: ["ثقافه", "متاحف", "فن"],
  اثار: ["ثقافه", "تاريخ", "تراث"],
  تسوق: ["مول", "سوق", "اسواق"],
  مول: ["تسوق", "اسواق"],
  سوق: ["تسوق", "اسواق"],
  عيال: ["عائله", "عوائل"],
  اطفال: ["عائله", "عيال"],
  معلم: ["معالم", "برج", "ابراج"],
  برج: ["معالم", "ابراج"],
  رخيص: ["اقتصادي"],
  غالي: ["راقي"],
  طلعه: ["مكان", "زياره"],

  // «كافيه» reached one beach, because the word appears in its description
  // while every actual coffee place is tagged «كافيهات». Both forms now lead
  // to the same set.
  كافيه: ["قهوه", "كافيهات", "مقاهي"],
  كافيهات: ["قهوه", "مقاهي"],
  مقاهي: ["قهوه", "كافيهات"],

  // Kuwaitis ask with the verb, not the noun — «وين نتعشى» found nothing at
  // all, and «نتغدى» likewise. These are the forms people actually say.
  //
  // Both persons, because both get said. The «we» forms were here and the
  // «I» forms were not, so «أبي أتغدى» — as ordinary a sentence as exists —
  // returned nothing at all while «وين نتغدى» worked. The hamza folds to a
  // bare alif in normalise(), so one key covers أتغدى and اتغدى alike.
  نتعشى: ["عشا", "مطاعم", "مطعم"],
  أتعشى: ["عشا", "مطاعم", "مطعم"],
  تعشى: ["عشا", "مطاعم"],
  نتغدى: ["غدا", "مطاعم", "مطعم"],
  أتغدى: ["غدا", "مطاعم", "مطعم"],
  تغدى: ["غدا", "مطاعم"],
  نفطر: ["فطور", "مطاعم"],
  أفطر: ["فطور", "مطاعم"],
  // «أتقهوى» is the Kuwaiti verb for going out for coffee.
  نتقهوى: ["قهوه", "كافيهات", "مقاهي"],
  أتقهوى: ["قهوه", "كافيهات", "مقاهي"],
  نشرب: ["قهوه", "كافيهات"],
  نروح: ["مكان", "طلعه"],
  نطلع: ["مكان", "طلعه"],
  سمچ: ["سمك"],
  /**
   * The national dish, and the four ways it gets written.
   *
   * The catalogue spells it «مچبوس», which is the Kuwaiti spelling and the
   * right one on the page. «مجبوس» and «مكبوس» used to reach it anyway — by
   * accident, through the edit-distance fallback, one letter apart. Folding چ
   * to تش for the index (see lib/arabic) makes it «متشبوس», two edits away,
   * and both spellings started finding nothing. Measured, and the reason these
   * are here rather than left to the fuzzy matcher: a fallback that happened to
   * work is not the same as knowing the word.
   *
   * «كبسة» is the Saudi name for the same plate, which the fuzzy matcher was
   * never going to reach from any spelling.
   */
  مجبوس: ["مچبوس", "اكل", "كويتي"],
  مكبوس: ["مچبوس", "اكل", "كويتي"],
  كبسه: ["مچبوس", "اكل", "كويتي"],
  حلويات: ["حلا"],

  /* ── More of the Kuwaiti a person actually says ──────────────────────────
   *
   * Forty-five everyday Kuwaiti words were run through the index. Thirty
   * answered; these are the ones that came back with nothing while the
   * CONCEPT was sitting in the catalogue under a different word. Same rule as
   * the block below: every value here was grepped out of places.ts first, and
   * a word whose concept is genuinely absent is left empty rather than
   * pointed at something nearby.
   *
   * «زعفران» is the example of that. It is the obvious partner to «هيل» and
   * it is not in places.ts at all, so it gets no entry — an entry would move
   * the empty result rather than answer it. */

  // «ريوق» is the Kuwaiti word for breakfast and «فطور» is what the catalogue
  // says. Two words, one meal, and the Kuwaiti one found nothing.
  ريوق: ["فطور", "مطاعم"],
  نتريق: ["فطور", "مطاعم"],
  أتريق: ["فطور", "مطاعم"],

  // The same چ problem as «مچبوس», in the other direction: «شاليه» reaches
  // two places, and «چالت» — the spelling a Kuwaiti writes — reached none,
  // because چ folds to تش for the index and «تشالت» is nowhere near it.
  // Kept to «شاليه» alone: adding «بحر» as well pulled the answer to whatever
  // beach scored highest and buried الخيران and مدينة صباح الأحمد, which are
  // the two places that actually have chalets. Measured, then narrowed.
  چالت: ["شاليه"],
  چالية: ["شاليه"],

  // The catalogue tags «عزايم»; people say «عزيمة». A plural/singular miss,
  // invisible until somebody types the singular.
  عزيمة: ["عزايم", "مطاعم", "عوائل"],

  // A غبقة is the late Ramadan sitting after taraweeh. No venue is tagged for
  // it — what the asker wants is somewhere open late, which the catalogue
  // does carry as «سهرة».
  غبقة: ["سهرة", "مطاعم"],

  // «نلعب» is what a parent says; «ألعاب» is what the catalogue says.
  نلعب: ["ألعاب", "عيال", "عائله"],
  يلعبون: ["ألعاب", "عيال", "عائله"],

  // «هيل» IS in the catalogue — inside the highlight «قهوة عربية وهيل», where
  // it is glued to the leading و and so is unreachable by prefix. Stripping a
  // leading و in the tokeniser would be the general fix and is not safe:
  // «وايد» would become «ايد». So the word is mapped instead.
  هيل: ["قهوه", "كرك"],

  /**
   * A judgement call, written down because it is the kind the rule above
   * would otherwise forbid.
   *
   * «كشتة» is winter camping in the desert. There is no campsite in the
   * catalogue — but «صحراء» is there (مزارع الوفرة), and the desert is
   * genuinely the thing being asked about. This is not «merely nearby» in the
   * way that answering «صيدلية» with a mall would be; it is the same place,
   * under the word the catalogue happens to use. If a campsite is ever added,
   * this should point at it instead.
   */
  كشتة: ["صحراء", "طبيعه"],

  /* ── Broken plurals ──────────────────────────────────────────────────────
   *
   * Arabic does not form most plurals by adding a suffix, so no amount of
   * stemming gets from «أسواق» to «سوق» — they share three letters in a
   * different order. The tokeniser strips a leading «ال» and stops there,
   * which is correct and not nearly enough.
   *
   * Measured across fifteen singular/plural pairs; these six were the ones
   * where the two forms answered materially differently, and the plural was
   * always the loser. «سوق» found fourteen places and «أسواق» found one. The
   * pairs that already agreed — مطعم/مطاعم, مركز/مراكز, مجمع/مجمعات — are
   * left alone rather than pinned for the sake of symmetry.
   *
   * One direction only. The singular already reaches everything, so mapping
   * it onto the plural would add nothing and dilute it. */
  أسواق: ["سوق"],
  مولات: ["مول"],
  متاحف: ["متحف"],
  جزر: ["جزيره"],
  بيوت: ["بيت"],
  شوارع: ["شارع"],

  /* ── The words people search with that the catalogue does not use ────────
   *
   * `npm run audit:search` tries 35 everyday queries. Twelve came back empty,
   * and the useful question was not "why is the search failing" — it is not —
   * but "is the CONCEPT in the catalogue at all". For half of them it is:
   * every place is described in the vocabulary of a listing («موعد», «ربع»,
   * «ماركات») while people type the vocabulary of an intention («رومانسي»,
   * «شباب», «ملابس»). Same idea, different register, no overlap.
   *
   * Each entry below maps to a word that is VERIFIABLY somewhere in
   * places.ts — checked, not assumed. Mapping a query to a tag no place
   * carries would move the empty result rather than fix it, and mapping it to
   * a tag that is merely nearby would make the search confidently wrong,
   * which is worse than empty.
   *
   * The other six — جيم، صيدلية، مستشفى، بنك، سوشي، صحراء — are still empty
   * and should stay that way. There is no gym, pharmacy or sushi in the
   * catalogue, and no synonym invents one. */

  // «وين أطلع رومانسي» — the tag for this is «موعد», which two places carry.
  رومانسي: ["موعد", "هدوء"],
  رومنسي: ["موعد", "هدوء"],
  موعد: ["هدوء"],
  // «ربع» is what a Kuwaiti calls the friend group; «شباب» is how the same
  // outing gets described to anyone else.
  شباب: ["ربع", "سهرة"],
  اصحاب: ["ربع", "سهرة"],
  ربيع: ["ربع"],
  // Shopping, by what you are shopping FOR rather than where.
  ملابس: ["ماركات", "تسوق", "مول"],
  هدوم: ["ماركات", "تسوق", "مول"],
  ماركات: ["تسوق", "مول"],
  // سوق الجمعة really is where secondhand books are sold, and «عتيق» is the
  // tag it already carries for exactly that stall row.
  كتب: ["عتيق", "مساومة"],
  // Both spellings of the family word people actually type.
  عائلي: ["عوائل", "عائله"],
  عايلي: ["عوائل", "عائله"],
  // Summer in Kuwait is a search term. «مكيّف» is the tag that answers it.
  مكيف: ["مكيّف", "داخلي"],
  حر: ["مكيّف", "داخلي"],
  بارد: ["مكيّف", "داخلي"],
  // Walking, which the catalogue tags as «ممشى» and «مشي داخلي». The second
  // tag is not a value here: values go through tokenize() now, which would
  // make it «مشي» + «داخلي» and tilt every walk indoors — measured, the
  // Avenues came second for «مشي». «مشي» reaches the tag by itself anyway.
  مشي: ["ممشى", "حدائق"],
  رياضه: ["ممشى"],
  /**
   * Shisha, under every name it is asked for.
   *
   * One thing with five words: «شيشة» is what most people type, «نرجيلة» and
   * «أرجيلة» are what the Levant says and half of Hawally with it, «معسل» is
   * the tobacco and stands in for the whole, and «حقة» is the Gulf word older
   * customers use. A place tagged under one of them and searched under
   * another is not found, and «ما فيه نتائج» reads as «there is nowhere»
   * rather than «you used the other word».
   */
  نرجيله: ["شيشة"],
  ارجيله: ["شيشة"],
  معسل: ["شيشة"],
  حقه: ["شيشة"],
  شيشه: ["شيشة"],
  // A Latin keyboard is a supported way in — the index already carries every
  // place's English name — and these have no Arabic stem to fold to, so each
  // spelling needs its own entry.
  shisha: ["شيشة"],
  sheesha: ["شيشة"],
  hookah: ["شيشة"],
  narghile: ["شيشة"],

  /* ── English that the catalogue never says ───────────────────────────────
   *
   * A Latin keyboard is a supported way in, and the index carries every
   * place's English name — which covers «restaurant», «museum», «mall»,
   * «beach» by accident, because those words are IN the names. The words that
   * are not anybody's name return nothing at all, and they are the ordinary
   * ones: a parent types «kids», not «Sheikh Abdullah Al Salem Cultural
   * Centre».
   *
   * Each was checked against the catalogue before being written down — the
   * Arabic on the right is a term that actually appears there, and a synonym
   * pointing at nothing is worse than no synonym, because it looks handled.
   * «cheap» is here and «budget» is not, for that reason: «رخيص» is in the
   * data and no word for a price bracket is. */
  kids: ["عيال", "عوائل"],
  kid: ["عيال", "عوائل"],
  children: ["عيال", "عوائل"],
  seafood: ["سمك", "بحري"],
  cheap: ["رخيص"],
  food: ["مطاعم", "اكل"],
  // Arabizi — Arabic typed on a Latin keyboard, digits for the letters it
  // lacks (٣ ع, ٧ ح, ٩ ص/ق). «kahwa», «ba7ar», «mat3am» each found nothing
  // (8 October); the words they spell are all in the catalogue.
  kahwa: ["قهوه"],
  gahwa: ["قهوه"],
  qahwa: ["قهوه"],
  "9ahwa": ["قهوه"],
  ba7ar: ["بحر", "شاطئ", "شواطئ", "ساحل"],
  ba7r: ["بحر", "شاطئ", "شواطئ", "ساحل"],
  bahar: ["بحر", "شاطئ", "شواطئ", "ساحل"],
  bahr: ["بحر", "شاطئ", "شواطئ", "ساحل"],
  mat3am: ["مطعم", "مطاعم"],
  mata3em: ["مطاعم"],

  /* ── More words checked against the catalogue, not against a guess ───────
   *
   * A batch of everyday Kuwaiti and Arabizi terms was run through the built
   * index the same way `audit:search`'s coverage check is — each of these
   * came back empty while the underlying word was sitting in places.ts,
   * verbatim, under something else. Two candidates from the same batch —
   * «تخفيضات» (there is no discount data anywhere) and «فطاير» (savoury
   * pastries; «فطور» covers breakfast generally but no place is written up
   * for فطاير specifically) — are left out for the same reason «زعفران» is
   * above: the obvious partner is not the same as a word actually there. */

  // «فيو» is how the phrase gets typed on a phone; «إطلالة» is the tag every
  // scenic place already carries (برج التحرير, مطلّ الخليج, …).
  فيو: ["إطلالة"],

  // «شلة» is at least as common as «ربع» for a friend group and reached
  // nothing — «ربع» is the tag (فيلكا, دار السدو الفني, …).
  شلة: ["ربع"],

  // «أثري» is the adjective form of «آثار», which is already a synonym key
  // above (see «اثار») — but a query normalises to «أثري», not «اثار», so
  // the adjective needs its own entry to the same targets.
  أثري: ["ثقافه", "تاريخ", "تراث"],

  // «ونسة»/«ونيت» — hanging out, the word itself, not a description of an
  // activity. «قعدة» is literally in the catalogue's own prose («قعدة على
  // الماء» — مارينا كريسنت; «تقعد» — المباركية, شارع الخليج).
  ونسة: ["قعدة"],
  ونيت: ["قعدة"],

  // «ببلاش» is the Kuwaiti word for free, and «مجاني» — MSA, already
  // reachable — is what the catalogue writes («جولات مجانية», المسجد الكبير;
  // «مجاناً», برج التحرير).
  ببلاش: ["مجاني"],

  // «انستقرام» alone found nothing; only paired with «تصوير» did, because
  // «تصوير» is the tag doing the work. Instagram-worthy and photogenic are
  // the same question here, so the bare word reaches it too now.
  انستقرام: ["تصوير"],

  /* ── What 225 typed questions found missing — 1 October ──────────────────
   *
   * A battery of questions written the way people actually type to سالم —
   * slang, chat spelling, English, who they are going with, what time — was
   * run through this engine and 134 of 225 passed. The largest single cause
   * was no entry at all: a word with an obvious meaning whose tag is in the
   * catalogue under another word. Every value below was checked against the
   * built index's postings before it was written, the rule of the blocks
   * above.
   *
   * Three candidates were measured and left out, which is the useful part:
   *  - «زوجتي/زوجي/مرتي» → «موعد، هدوء». «مع زوجتي والعيال» is the common
   *    sentence, and the spouse word diluted its kids half: the zoo and the
   *    cultural centre gave way to a street. «خطيبتي/خطيبي» stay — an engaged
   *    couple's outing is the date the tag describes.
   *  - «اطلع» → «مكان، طلعه». «مكان» is in nearly every description, so the
   *    entry reordered «وين أطلع» around a fairground and fixed nothing.
   *  - «حار». Its one posting is مدينة صباح الأحمد البحرية's own WARNING,
   *    «الصيف حار جداً», so the typed word pulls up the one outdoor place
   *    that says not to come in summer. A synonym cannot fix that, because
   *    the typed word is still searched beside it; REWRITE below replaces it.
   *
   * Read twice: «date» is also the fruit (so «dates» is left unmapped),
   * «يونس» is also a man's name, and «حال» means cheap only in «على قد
   * الحال» — which is how it is nearly always said. */

  // The evening, by the words for it. «سهرة» is the catalogue's tag.
  اسهر: ["سهرة"],
  نسهر: ["سهرة"],
  سهر: ["سهرة"],
  ليله: ["سهرة", "بالليل"],
  ليل: ["سهرة", "بالليل"],
  عصريه: ["عصر"],
  فجر: ["صبح"],
  ويكند: ["نهايه", "اسبوع"],

  // Price, the way it is said rather than written.
  ارخص: ["رخيص"],
  حال: ["رخيص", "اقتصادي"],
  // «ببلاش» above points at «مجاني», which reaches «مجانية» by prefix and
  // never «مجاناً» — the word three places use. These name both.
  بلاش: ["مجاناً", "مجانية"],

  // Who is coming. Kuwaiti has five words for the children and the
  // catalogue has one tag, «عيال»; «يهال» is «جهال» as it is said here.
  اهل: ["عوائل", "عائله"],
  اهلي: ["عوائل", "عائله"],
  يهال: ["عيال"],
  ياهل: ["عيال"],
  جهال: ["عيال"],
  بزارين: ["عيال"],
  صغار: ["عيال"],
  خطيبتي: ["موعد", "هدوء"],
  خطيبي: ["موعد", "هدوء"],
  بنات: ["ربع"],
  // «مع ربعي», «وين أروح مع خوياي» — the friend group with «my» on it, which
  // the bare words above never reached (8 October: «ما لقيت شي»).
  ربعي: ["ربع", "سهرة"],
  ربعنا: ["ربع", "سهرة"],
  اصحابي: ["ربع", "سهرة"],
  خوياي: ["ربع"],
  اخوياي: ["ربع"],
  بروحي: ["هدوء"],
  لحالي: ["هدوء"],
  // «يونّس» — it's fun.
  يونس: ["ألعاب", "ترفيهية"],
  ونيس: ["ألعاب", "ترفيهية"],
  وناسه: ["ألعاب", "ترفيهية"],

  /* 3 October, from a review of what she actually answered. Each of these
   * had nothing to land on and fell to the fuzzy pass, which found a real
   * word one letter away and answered that instead: «ملاهي» → «مقاهي» (a tea
   * house for «amusement park»), «مكان هادي» → a modern-art museum on the
   * word «هادي» in its prose, «سائح أول مرة» → the Amricani centre on
   * «بالكويت». */
  هادي: ["هدوء"],
  هاديه: ["هدوء"],
  هادئ: ["هدوء"],
  رايق: ["هدوء"],
  ملاهي: ["ترفيهية", "ألعاب"],
  سائح: ["سياحة", "معلم"],
  سياح: ["سياحة", "معلم"],
  سواح: ["سياحة", "معلم"],
  تمشيه: ["ممشى", "مشي"],
  اتمشى: ["ممشى", "مشي"],
  نتمشى: ["ممشى", "مشي"],

  // Food by the dish. «عشا»/«غدا» are the Kuwaiti spellings of the meals
  // the hamza forms above already reach — «عشاء» keeps its ء through
  // normalise(), so the two never met.
  عشا: ["مطاعم", "مطعم"],
  غدا: ["مطاعم", "مطعم"],
  ايسكريم: ["ايس", "كريم"],
  كباب: ["مشاوي"],
  مشوي: ["مشاوي"],
  مشويات: ["مشاوي"],
  هامور: ["سمك"],
  روبيان: ["سمك"],

  // «البر» is the desert, to a Kuwaiti; «صحراء» is the catalogue's word.
  بر: ["صحراء", "طبيعه"],

  // What speech-to-text writes for two English words in a Kuwaiti sentence:
  // «بيتش» found three houses called بيت, and «ثري سكستي» found nothing.
  بيتش: ["شاطئ", "شواطئ", "بحر"],
  سكستي: ["٣٦٠"],

  // English, beyond the block above. «café» folds to «cafe» in normalise().
  cafe: ["قهوه", "كافيهات"],
  restaurant: ["مطاعم", "مطعم"],
  family: ["عوائل", "عائله"],
  breakfast: ["فطور"],
  dinner: ["عشا", "مطاعم"],
  lunch: ["غدا", "مطاعم"],
  desert: ["صحراء"],
  cinema: ["سينما"],
  movies: ["سينما"],
  sunset: ["غروب"],
  romantic: ["موعد", "هدوء"],
  date: ["موعد"],
  ice: ["ايس"],
  cream: ["كريم"],
  icecream: ["ايس", "كريم"],
  summer: ["صيف", "مكيّف"],
  conditioned: ["مكيّف"],
  tonight: ["سهرة", "بالليل"],
  night: ["سهرة", "بالليل"],
  pizza: ["بيتزا"],
  burger: ["برجر"],
  shawarma: ["شاورما"],
  quiet: ["هدوء"],
  free: ["مجاناً", "مجانية"],
};

/**
 * The synonym table, keyed the way lookups actually arrive.
 *
 * Query tokens are normalised before they get here — ى folds to ي, ة to ه —
 * so a key written «مقهى» could never be found, and that entry sat dead in the
 * table. Normalising the keys once at load closes the whole class rather than
 * the one instance, and merges any entries that collide once folded.
 *
 * The VALUES go through tokenize(), the same path a typed word takes, and
 * for the same reason one level down. A value was only normalised, which
 * kept its «ال»: «ألعاب» became «العاب», a term with no postings, while the
 * index holds «عاب» — so every entry pointing at the games was dead, and
 * looked handled. A two-word value could never equal one token either.
 */
const SYNONYM_LOOKUP: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [key, values] of Object.entries(SYNONYMS)) {
    const k = normalise(key);
    m.set(k, [...new Set([...(m.get(k) ?? []), ...values.flatMap((v) => tokenize(v))])]);
  }
  return m;
})();

/** A typed token plus its synonyms, kept grouped under the token they came
 * from so scoring can tell which *query word* a match satisfies. */
function variantsOf(token: string): string[] {
  return [...new Set([token, ...synonymsOf(token)])];
}

/**
 * The synonyms of a token as typed, or — when it has none — of the word under
 * its clitic. «للبنات» has no entry and «بنات» does; looked up only as typed,
 * the glued form never reached it, fell to the fuzzy pass, and «مكان للبنات»
 * answered with مزارع الوفرة on «للناس».
 */
function synonymsOf(token: string): string[] {
  return SYNONYM_LOOKUP.get(token) ?? declitic(token).flatMap((t) => SYNONYM_LOOKUP.get(t) ?? []);
}

/**
 * Arabic glues short function words onto the next word: و (and), ب (in/with),
 * ل (for), ك (like), ف (so), and those again in front of ال — بال، وال، لل…
 * «بالسالمية» is one token to a tokeniser but "in Salmiya" to a reader, and
 * before this it matched nothing at all.
 *
 * Returns progressively shorter readings, longest prefix first. Only consulted
 * when the token itself is not in the index, so a real word that merely starts
 * with one of these letters — بحر, ليلة, كرك — is never mangled.
 */
export function declitic(token: string): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    if (t.length > 1 && !out.includes(t) && t !== token) out.push(t);
  };
  for (const p of ["بال", "وال", "فال", "كال", "لل"]) {
    if (token.startsWith(p) && token.length > p.length + 1) add(token.slice(p.length));
  }
  for (const p of ["و", "ب", "ل", "ك", "ف"]) {
    if (token.startsWith(p) && token.length > 3) {
      const rest = token.slice(1);
      add(rest);
      if (rest.startsWith("ال") && rest.length > 3) add(rest.slice(2));
    }
  }
  return out;
}

/** Bounded Levenshtein — returns maxDist+1 as soon as it is exceeded. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/* ------------------------------------------------------------------ */
/* Index                                                               */
/* ------------------------------------------------------------------ */

/** Field weights: a name hit should beat a description hit. */
const FIELD_WEIGHT = { title: 4, subtitle: 2, keywords: 3, body: 1 } as const;

interface Posting {
  docIndex: number;
  weighted: number;
}

export interface SearchIndex {
  docs: SearchDoc[];
  postings: Map<string, Posting[]>;
  docLen: number[];
  avgLen: number;
  terms: string[];
  /**
   * The tokens that name an area, e.g. «السالمية», «حولي», «الزهراء».
   *
   * Held apart from the rest of the vocabulary because a place name is the
   * one kind of word where "nearly right" is not a typo — it is a different
   * place, twenty kilometres away. Two things depend on knowing which terms
   * these are: fuzzy matching refuses to reach them, and a result that
   * matched nothing but the area is not allowed to outrank one that matched
   * what was actually being looked for. See `candidates` and `search`.
   */
  areaTerms: Set<string>;
  /**
   * Tokens that name a category, mapped to it: «قهوه» → coffee.
   *
   * Lets the scorer tell "this place IS a coffee place" from "this place's
   * description happens to contain the word". Without it a beach whose blurb
   * mentions a café outranked every actual café, because the typed word beat
   * the synonym that resolved to the category.
   */
  categoryTerms: Map<string, CategoryId>;
}

/**
 * Price and rating live as numbers, so "رخيص" or "أحسن تقييم" — both ordinary
 * ways to ask — used to return nothing at all. These turn them into the words
 * people actually type.
 */
/**
 * The words people reach for when the weather is the real question.
 *
 * Derived from `setting` rather than written per place, so a place can never
 * be tagged "مكيّف" while being an open-air zoo. This is what makes «طلعة
 * بالصيف» stop returning the hottest places on the list: indoor places carry
 * the summer words, outdoor ones carry the winter words, and the ranking
 * follows without any special-casing in the scorer.
 */
const SETTING_WORDS: Record<"indoor" | "outdoor" | "mixed", string[]> = {
  indoor: ["مكيّف", "مكيف", "داخلي", "صيف", "بارد", "برد", "حر", "مغلق"],
  outdoor: ["برا", "خارجي", "شتاء", "هوا", "طبيعة", "مكشوف"],
  // Deliberately thinner than either pure set. A mall with a waterfront is a
  // fair answer to both "صيف" and "برا", but it should not outrank a park for
  // "برا بالشتاء" merely by claiming every word on both sides.
  mixed: ["مكيّف", "برا"],
};

/**
 * One word, and the synonym table carries the other nine.
 *
 * This started as eleven — every Arabic spelling and every Latin one — and
 * that broke something a long way from shisha: a search for «مارينا كريسنت»
 * started returning شاطئ المارينا first, because the beach's highlights
 * mention «ممشى المارينا كريسنت» and the crescent's own keyword field had
 * just been diluted by ten extra terms. The scorer normalises by field
 * length, so every keyword added to a place makes each of its existing
 * keywords count for less. Eleven words about shisha cost a place its own
 * name — and شوق reads the top hit aloud, so second place is the wrong
 * answer, not a near miss.
 *
 * Two fixes, and both were needed — trimming to one word alone was not
 * enough, because on this pair even a single extra keyword tipped it.
 *
 * The first is that the query side was already doing the spelling work:
 * tokens are normalised (ة folds to ه) and then run through SYNONYMS, so
 * «نرجيلة», «معسل», «hookah» and the rest all arrive as «شيشة» before the
 * lookup. The document needs the one canonical term they arrive as.
 *
 * The second is where that term goes. It rides in `body` with the price and
 * rating words, for the reason written there: body lets a place be FOUND by
 * a word without letting that word outrank a name match. That is exactly the
 * trade shisha wants — «وين فيه شيشة» must return all three, and «مارينا
 * كريسنت» must still return مارينا كريسنت.
 */
const SHISHA_WORDS = ["شيشة"];

const PRICE_WORDS: Record<number, string> = {
  1: "رخيص اقتصادي بسيط",
  2: "متوسط معقول",
  3: "غالي راقي فخم",
};

function ratingWords(rating: number | undefined): string {
  // An unrated place gets no rating words at all. Defaulting it to "جيد"
  // would let a place we know nothing about answer «تقييم جيد» — inventing a
  // judgement and ranking on it.
  if (rating === undefined) return "";
  if (rating >= 4.7) return "الأعلى تقييماً ممتاز أحسن أفضل تقييم";
  if (rating >= 4.4) return "تقييم عالي حلو زين";
  return "تقييم جيد";
}

export function buildDocs(list: Place[] = snapshot): SearchDoc[] {
  const byCategory = new Map<CategoryId, number>();
  const areas = new Map<string, { ar: string; en: string; n: number }>();

  const docs: SearchDoc[] = list.map((p) => {
    byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
    const a = areas.get(p.areaAr) ?? { ar: p.areaAr, en: p.area, n: 0 };
    a.n += 1;
    areas.set(p.areaAr, a);
    const cat = categories.find((c) => c.id === p.category);
    return {
      id: `place:${p.slug}`,
      kind: "place",
      title: p.nameAr,
      subtitle: `${cat?.ar ?? ""}، ${p.areaAr}`,
      url: `/places/${p.slug}/`,
      category: p.category,
      keywords: [
        p.name,
        p.area,
        cat?.ar ?? "",
        cat?.en ?? "",
        ...p.highlightsAr,
        ...p.tagsAr,
        ...SETTING_WORDS[p.setting],
      ],
      // Price and rating sit in the body rather than keywords: they should
      // let a place be *found* by "رخيص", not outrank a name match for it.
      body: `${p.taglineAr} ${p.descriptionAr} ${p.bestTimeAr} ${p.seasonAr} ${
        PRICE_WORDS[p.priceLevel] ?? ""
      } ${ratingWords(p.rating)}${p.shisha ? ` ${SHISHA_WORDS.join(" ")}` : ""}`,
    };
  });

  for (const c of categories) {
    docs.push({
      id: `category:${c.id}`,
      kind: "category",
      title: c.ar,
      subtitle: `تصنيف، ${countAr(byCategory.get(c.id) ?? 0, PLACES_COUNT)}`,
      url: `/explore/?category=${c.id}`,
      category: c.id,
      keywords: [c.en, c.blurbAr],
      body: c.blurbAr,
    });
  }

  for (const [ar, a] of areas) {
    docs.push({
      id: `area:${ar}`,
      kind: "area",
      title: ar,
      subtitle: `منطقة، ${countAr(a.n, PLACES_COUNT)}`,
      url: `/explore/?q=${encodeURIComponent(ar)}`,
      keywords: [a.en, "منطقة", "area"],
      body: `${ar} ${a.en}`,
    });
  }

  docs.push(
    {
      id: "page:explore",
      kind: "page",
      title: "استكشف الكويت",
      subtitle: "صفحة",
      url: "/explore/",
      keywords: ["explore", "كل الأماكن", "تصفح"],
      body: "استكشف كل الأماكن في الكويت مع البحث والتصنيفات",
    },
    {
      id: "page:about",
      kind: "page",
      title: "عن وين",
      subtitle: "صفحة",
      url: "/about/",
      keywords: ["about", "من نحن"],
      body: "ليش صار فيه وين وكيف يجاوب على سؤال الطلعة",
    },
    {
      id: "page:privacy",
      kind: "page",
      title: "الخصوصية والكوكيز",
      subtitle: "صفحة",
      url: "/privacy/",
      keywords: ["privacy", "cookies", "كوكيز", "بيانات"],
      body: "وين ما يستخدم كوكيز ولا يجمع بيانات",
    }
  );

  return docs;
}

export function buildIndex(list: Place[] = snapshot): SearchIndex {
  const docs = buildDocs(list);
  const postings = new Map<string, Posting[]>();
  const docLen: number[] = [];

  docs.forEach((doc, i) => {
    const counts = new Map<string, number>();
    let len = 0;
    const add = (text: string, weight: number) => {
      for (const t of tokenize(text)) {
        counts.set(t, (counts.get(t) ?? 0) + weight);
        len += weight;
      }
    };
    add(doc.title, FIELD_WEIGHT.title);
    add(doc.subtitle, FIELD_WEIGHT.subtitle);
    add(doc.keywords.join(" "), FIELD_WEIGHT.keywords);
    add(doc.body, FIELD_WEIGHT.body);

    docLen.push(len || 1);
    for (const [term, weighted] of counts) {
      const list_ = postings.get(term) ?? [];
      list_.push({ docIndex: i, weighted });
      postings.set(term, list_);
    }
  });

  const avgLen = docLen.reduce((a, b) => a + b, 0) / (docLen.length || 1);
  // Taken from the area docs' own titles rather than a hand-written list, so
  // adding a place in a new area protects that area's name automatically.
  const areaTerms = new Set<string>();
  for (const doc of docs) {
    if (doc.kind === "area") for (const t of tokenize(doc.title)) areaTerms.add(t);
  }
  const categoryTerms = new Map<string, CategoryId>();
  for (const c of categories) {
    for (const t of [...tokenize(c.ar), ...tokenize(c.en)]) categoryTerms.set(t, c.id);
  }
  return {
    docs,
    postings,
    docLen,
    avgLen,
    terms: [...postings.keys()],
    areaTerms,
    categoryTerms,
  };
}

/* ------------------------------------------------------------------ */
/* Query                                                               */
/* ------------------------------------------------------------------ */

const K1 = 1.2;
const B = 0.75;

/** Resolve one query token to index terms: exact, then prefix, then fuzzy. */
/**
 * Real places in Kuwait that this catalogue has nothing in — yet.
 *
 * These are named, not inferred, because the failure they cause cannot be
 * detected from the string. «الجهراء» is a governorate of half a million
 * people; one edit away sits «الزهراء», which is also real and about twenty
 * kilometres from it. So «أماكن في الجهراء» answered with a mall in the wrong
 * town, and said nothing about having substituted anything — the same class
 * of fault as the pharmacy that used to return الصالحية, and worse, because
 * the visitor is standing in the place they just named.
 *
 * Banning fuzzy matching on every area name would fix it and cost too much:
 * it also lost «اليران» → «الخيران», an ordinary typo the engine should
 * absolutely still catch. The distinction is not spelling, it is knowledge —
 * whether a near-miss is a slip of the thumb or a different town — and only a
 * list can carry that. A token here matches nothing at all: no exact, no
 * prefix, no fuzzy. Empty is the honest answer, and it is the one that lets
 * the caller hear «ما عندي شي بالجهراء» instead of being sent somewhere else.
 *
 * Delete an entry the moment a place there is added to the catalogue; the
 * audit checks that none of these is also a real area, so a stale entry
 * cannot silently hide new content.
 */
export const ELSEWHERE_IN_KUWAIT = new Set(
  [
    // governorates. «الجهرا» too: the final hamza is usually left off when
    // typed, and without it «مطعم بالجهرا» answered with restaurants in other
    // towns and nothing to say they were somewhere else.
    "الجهراء", "الجهرا", "الفروانية", "الأحمدي", "العاصمة",
    // large residential areas people would reasonably name
    "خيطان", "سلوى", "بيان", "الرقة", "المنقف", "الفنطاس", "الفنيطيس",
    "الأندلس", "العارضية", "الرابية", "كيفان", "الشامية", "الروضة", "السرة",
    "الفيحاء", "اليرموك", "القرين", "العدان", "الصليبية",
  ]
    /* One word each, deliberately.
     *
     * The first draft listed «مبارك الكبير» and «صباح السالم» too and split
     * every entry into tokens, which put «كبير» and «سالم» on the list —
     * words that are the actual names of places in the catalogue. «المسجد
     * الكبير» and «شارع سالم المبارك» both stopped being findable, and the
     * ranking floor caught it. A multi-word area cannot be blocked a token at
     * a time without taking real words with it, so it is not attempted. */
    .filter((name) => tokenize(name).length === 1)
    .map((name) => tokenize(name)[0])
);

function candidates(term: string, index: SearchIndex): { term: string; boost: number }[] {
  /* A place we know we have nothing in resolves to nothing, rather than to
   * whatever it happens to be nearest to. See ELSEWHERE_IN_KUWAIT.
   *
   * Guarded on the term being absent from the corpus, which is the whole
   * point: if the word is real content somewhere — a place called الروضة, a
   * description mentioning بيان — then it is not a gap and must be searched
   * normally. The ban only bites where the alternative was a guess. */
  if (ELSEWHERE_IN_KUWAIT.has(term) && !index.postings.has(term)) return [];

  // The glued and unglued readings are both wanted, and taking the glued one
  // alone is not a shortcut — it is a bug. «بالشتاء» appears verbatim in two
  // places' season text, which put it in the index and so ended the search
  // there: every place that legitimately matched «شتاء» was dropped, and
  // «برا بالشتاء» returned two waterfront malls and no park at all. Whether a
  // prose field happens to spell a word glued must not decide what the query
  // means, so both readings are searched whenever both exist.
  const found: { term: string; boost: number }[] = [];
  if (index.postings.has(term)) found.push({ term, boost: 1 });
  for (const stripped of declitic(term)) {
    if (index.postings.has(stripped)) found.push({ term: stripped, boost: 0.95 });
  }
  if (found.length) return found;

  /* A word the synonym table knows is not a typo, and must not be read as
   * one. Measured 3 October: «اسهر» has «سهرة» and still fuzzed onto «اسهل»
   * and «اشهر»; «ملاهي», given its entry, still fuzzed onto «مقاهي» at the
   * full weight of a typed word, and beat its own meaning. Its synonyms are
   * searched beside it (variantsOf), so nothing is lost but the guess.
   *
   * Under three letters the prefix pass is a guess too: «بر» (the desert)
   * reached «برد», «برجر» and «برستيج» and answered with the Avenues, and
   * «حر» reached «حرف». A short word with a meaning of its own gets that
   * meaning and no prefixes. */
  const known = synonymsOf(term).length > 0;
  if (term.length < 3 && known) return [];

  const prefix = index.terms.filter((t) => t.startsWith(term));
  if (prefix.length) return prefix.slice(0, 12).map((t) => ({ term: t, boost: 0.82 }));

  // Below four letters a single edit reaches too much of the vocabulary —
  // «قق» would "correct" to any two-letter term — so short tokens get exact,
  // prefix and synonym matching only.
  if (term.length < 4 || known) return [];

  const max = term.length >= 6 ? 2 : 1;
  const fuzzy: { term: string; boost: number }[] = [];
  for (const t of index.terms) {
    // And not ONTO a short word either, for the reason above from the other
    // side: one letter dropped from «جديد» is «جيد», the rating word, and
    // «مكان جديد» answered with whichever places are rated «جيد».
    if (t.length < 4) continue;
    const d = editDistance(term, t, max);
    if (d <= max) fuzzy.push({ term: t, boost: d === 1 ? 0.62 : 0.42 });
  }
  return fuzzy.sort((a, b) => b.boost - a.boost).slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Reading a query                                                     */
/* ------------------------------------------------------------------ */

/* Every table here is written the way people type it and folded at load,
 * and `audit:search` checks each entry survives tokenize() as itself — STOP
 * above is what a list written in the wrong form looks like: two of its
 * entries have never matched anything. All of them are generated into the
 * app's search, so the two engines read a question the same way. */

/**
 * Words that say nothing about WHERE, dropped from the query alone.
 *
 * «وين», «ابي», «شي», «فيه»… are in nearly every question and in a good
 * share of the descriptions, so they matched everywhere: «جو» prefix-matched
 * «جولة» and brought the mosque and the mirror house into «الجو حار». Not
 * STOP, which also tokenises the index and would re-score every document.
 * When the filler is ALL there is — «وين؟» — it is kept, so a question made
 * of nothing else still answers as it did.
 *
 * «أودي/نودي» (take someone) and «أطلع/نطلع» (go out) were not on the first
 * list, and dropping «وين» is what exposed them. «وين اودي اهلي» lost the
 * word that had carried it by luck, and «اودي» fuzzed onto «أهدى» and
 * answered with two malls; «وين أطلع» shrank to the one place whose prose
 * says «اطلع». As filler, a question made only of them reads as it always
 * did, and a question with a real word in it is about that word.
 */
export const FILLER = [
  "على", "إلى", "أبي", "أبغي", "أبا", "نبي", "ودي", "أودي", "نودي", "أطلع", "نطلع", "وين", "شي", "أكو", "ماكو", "حق",
  "فيه", "وايد", "جو", "ممكن", "عطني", "دلني", "شنو",
  // «أروح/نروح» and «حين» — «الحين» as tokenize() leaves it — and the words
  // for being bored. «وين أروح الحين» searched «اروح» and «حين», found
  // nothing, and she said «ما لقيت شي» to the commonest question there is.
  // As filler they are dropped beside a real word («زهقان أبي بحر» is «بحر»),
  // and a question made only of them is TOPICLESS — see isTopicless().
  "أروح", "نروح", "حين", "زهقان", "زهقانة", "طفشان", "طفشانة", "ملل", "مليت",
  "to", "do", "for", "and", "with", "at", "on", "is", "some", "where", "want",
  "things", "near", "me",
  /* What is said around a question rather than in it (8 October, read off
   * سالم's answers while the agent was out of credits). «والله زهقان» was
   * not topicless — «والله» was a word to search — and answered with the
   * Friday market; «يلا وين نروح» found nothing at all; «لو» prefix-matched
   * «لوذان», so «أبي قهوة لو سمحت» brought بيت لوذان in with the cafés. And
   * «قريب مني»: the page does not know where anybody is, so «قريب» can only
   * match the one description that says it — dropped beside a real word, and
   * سالم answers a question made of nothing else by asking for the area. */
  "والله", "بالله", "يلا", "يالله", "لو", "سمحت", "بليز", "please", "قريب", "قريبة", "أقرب", "مني", "جنبي",
];

/**
 * «مو غالي» is read as «غالي» without these — the one word the visitor said
 * they did not want, searched for — and two of the catalogue's dearest malls
 * were in its first four. So the word after a negator is taken out of the
 * query; the places that carry it (or a synonym of it, exactly) are pushed to
 * the bottom rather than removed, in case they are all there is; and when the
 * word has a known opposite, the opposite is searched as if typed.
 *
 * «ما عندي فلوس» is the example from her own prompt, and it answered with a
 * beach first because «فلوس» fuzzed onto «جلوس». Now it answers with the
 * three places that are free. A question that is ONLY a negation — «بدون
 * شيشة» — finds nothing, which is honest: there is no word left to search,
 * and the empty-result line asks for one.
 *
 * Not idiom-proof: «مو طبيعي» is praise in Kuwaiti and now reads as «not
 * nature». Measured as noise either way.
 */
export const NEGATORS = ["مو", "ما", "مب", "مش", "بدون", "بلا", "غير", "no", "not", "without"];
/** Skipped between a negator and the word it negates: «ما ابي مول». */
export const WANT_WORDS = [
  "أبي", "أبغي", "أبا", "نبي", "ودي", "أحب", "فيه", "يبي", "أريد", "عندي", "عندنا", "want", "need",
];
export const ANTONYMS: Record<string, string[]> = {
  غالي: ["رخيص"],
  مكلف: ["رخيص"],
  فخم: ["رخيص"],
  راقي: ["رخيص"],
  فلوس: ["مجاناً", "مجانية"],
  برا: ["داخلي", "مكيف"],
  خارجي: ["داخلي", "مكيف"],
  داخلي: ["برا"],
  مكيف: ["برا"],
  زحمة: ["هدوء"],
  زحام: ["هدوء"],
  expensive: ["رخيص"],
  crowded: ["هدوء"],
};

/**
 * A typed word replaced by what it means, rather than searched as itself.
 *
 * «حار» has exactly one posting: مدينة صباح الأحمد البحرية's own WARNING,
 * «الصيف حار جداً». Searched literally, «الجو حار» answered with the one
 * outdoor place that tells you not to come in summer. What the visitor wants
 * is out of the heat, and that is what the replacement searches, at the weight
 * of a typed word. «حارة» (an alley) folds differently and is not touched.
 */
export const REWRITE: Record<string, string[]> = {
  حار: ["مكيف", "داخلي"],
};

/**
 * Areas of two words, which ELSEWHERE_IN_KUWAIT cannot hold — its own comment
 * records the first draft that tried, and lost «المسجد الكبير». As an adjacent
 * PAIR they are safe: «صباح السالم» is a town and «صباح» alone, or «صباح
 * الأحمد», is not touched. Deliberately not «صباح الأحمد» or «جابر الأحمد»,
 * which are names in the catalogue.
 */
export const ELSEWHERE_PHRASES = [
  ["صباح", "السالم"],
  ["مبارك", "الكبير"],
  ["سعد", "العبدالله"],
  ["صباح", "الناصر"],
  ["عبدالله", "المبارك"],
];

/**
 * The words that ask to GO somewhere without saying where. A question made of
 * these and other filler — «وين أروح الحين», «وين نطلع», «زهقان», «ملل» — has
 * no topic to search, and is answered with a default pick for the hour
 * (answer-order.ts) instead of «ما لقيت شي». «وين» alone is not one of them:
 * it is also the site's name, and still finds the page about it.
 */
export const GOING_OUT = ["أروح", "نروح", "أطلع", "نطلع", "زهقان", "زهقانة", "طفشان", "طفشانة", "ملل", "مليت"];

const FILLER_SET = new Set(FILLER.map(normalise));
const GOING_OUT_SET = new Set(GOING_OUT.map(normalise));

/** «وين أروح الحين?» — a wish to go out, with nothing to search for. */
export function isTopicless(query: string): boolean {
  const raw = tokenize(query);
  return raw.length > 0 && raw.every((t) => FILLER_SET.has(t)) && raw.some((t) => GOING_OUT_SET.has(t));
}

const NEGATOR_SET = new Set(NEGATORS.map(normalise));
const WANT_SET = new Set(WANT_WORDS.map(normalise));
const foldTable = (t: Record<string, string[]>) =>
  new Map(Object.entries(t).map(([k, v]) => [normalise(k), v.flatMap((x) => tokenize(x))]));
const ANTONYM_LOOKUP = foldTable(ANTONYMS);
const REWRITE_LOOKUP = foldTable(REWRITE);
export const PHRASE_PAIRS = ELSEWHERE_PHRASES.map((pair) => pair.map((w) => tokenize(w)[0]));

/**
 * «مطعمسمك», «سوقالمباركية» — two words with the space lost, which a phone
 * keyboard does often. Only for a token the index cannot place at all (no
 * exact, glued, synonym or prefix reading), and only into two words it does
 * know, at least three letters each: two-letter halves split ordinary typos
 * instead — «سالمهي» became «سالم» + «هي» and found a street for a Salmiya
 * typo.
 */
function splitGlued(token: string, index: SearchIndex): string[] {
  const known = (t: string) => t.length > 1 && (index.postings.has(t) || SYNONYM_LOOKUP.has(t));
  if (token.length < 5 || known(token) || declitic(token).some(known)) return [token];
  if (index.terms.some((t) => t.startsWith(token))) return [token];
  for (let i = token.length - 3; i >= 3; i--) {
    const left = token.slice(0, i);
    let right = token.slice(i);
    if (right.length > 3 && right.startsWith("ال")) right = right.slice(2);
    if (right.length >= 3 && known(left) && known(right)) return [left, right];
  }
  return [token];
}

/**
 * «مطعن» is «مطعم» with a slipped finger, and was searched as a stranger: the
 * fuzzy pass reached the word «مطعم» in prose — أبراج الكويت mentions its
 * restaurant — but none of what «مطعم» MEANS (مطاعم، اكل، غدا، عشا), so the
 * towers came first for «restaurant». A token the index cannot place at all
 * (no exact, glued, synonym or prefix reading), one letter from a word the
 * synonym table knows, is read as that word. Four letters at least on both
 * sides, the fuzzy pass's own floor; the first key in the table at distance
 * one wins, so the reading does not depend on the index.
 */
function misspeltKey(token: string, index: SearchIndex): string {
  if (token.length < 4 || index.postings.has(token) || synonymsOf(token).length) return token;
  if (declitic(token).some((t) => index.postings.has(t))) return token;
  if (index.terms.some((t) => t.startsWith(token))) return token;
  for (const key of SYNONYM_LOOKUP.keys()) {
    if (key.length >= 4 && editDistance(token, key, 1) <= 1) return key;
  }
  return token;
}

/**
 * The query as the engine should read it: filler out, «حار» rewritten,
 * negations turned into an opposite and a list of places to push down, glued
 * words split. Null when the question names a place this catalogue has
 * nothing in — glued («بالجهراء») or two words («صباح السالم») — because the
 * honest answer is none: «كافيه بسلوى» used to answer with coffee in other
 * areas and say nothing about it. One case costs something: «مول بالأحمدي»
 * finds nothing although الكوت مول is in Fahaheel, which is in Ahmadi
 * governorate. People mean the town, and there is no governorate data to do
 * better with.
 */
function readQuery(query: string, index: SearchIndex): { raw: string[]; pushedDown: Set<number> } | null {
  let raw = tokenize(query);
  const meaningful = raw.filter((t) => !FILLER_SET.has(t));
  if (meaningful.length) raw = meaningful;
  raw = raw.flatMap((t) => REWRITE_LOOKUP.get(t) ?? [t]);

  const pushedDown = new Set<number>();
  const kept: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (!NEGATOR_SET.has(raw[i])) {
      kept.push(raw[i]);
      continue;
    }
    let j = i + 1;
    while (j < raw.length && WANT_SET.has(raw[j])) j++;
    if (j >= raw.length) break;
    const unwanted = raw[j];
    for (const v of variantsOf(unwanted)) {
      for (const { term, boost } of candidates(v, index)) {
        if (boost < 0.95) continue; // exact or glued; a guess must not exclude anything
        for (const { docIndex } of index.postings.get(term) ?? []) pushedDown.add(docIndex);
      }
    }
    kept.push(...(ANTONYM_LOOKUP.get(unwanted) ?? []));
    i = j;
  }
  raw = kept.flatMap((t) => splitGlued(t, index)).map((t) => misspeltKey(t, index));

  const elsewhere = (t: string) => ELSEWHERE_IN_KUWAIT.has(t) && !index.postings.has(t);
  if (raw.some((t) => [t, ...declitic(t)].some(elsewhere))) return null;
  if (PHRASE_PAIRS.some(([a, b]) => raw.some((t, i) => t === a && raw[i + 1] === b))) return null;
  return { raw, pushedDown };
}

export function search(
  query: string,
  index: SearchIndex,
  { limit = 20, kinds }: { limit?: number; kinds?: DocKind[] } = {}
): SearchHit[] {
  const read = readQuery(query, index);
  if (!read || read.raw.length === 0) return [];
  const { raw, pushedDown } = read;
  const N = index.docs.length;
  const scores = new Map<number, number>();
  /** Index terms that matched — drives highlighting. */
  const hitTerms = new Map<number, Set<string>>();
  /** Which *query words* a doc satisfied — drives coverage. Kept separate
   * because one token can expand (prefix, fuzzy, synonym) to many index
   * terms; counting those as coverage let a doc matching half the query
   * claim full credit. */
  const hitTokens = new Map<number, Set<string>>();

  for (const rawToken of raw) {
    for (const token of variantsOf(rawToken)) {
      // Synonyms should help, not outrank what the visitor actually typed.
      const isTyped = token === rawToken;
      for (const { term, boost } of candidates(token, index)) {
        const postings = index.postings.get(term);
        if (!postings) continue;
        const idf = Math.log(1 + (N - postings.length + 0.5) / (postings.length + 0.5));
        for (const { docIndex, weighted } of postings) {
          const dl = index.docLen[docIndex] ?? index.avgLen;
          const tf = (weighted * (K1 + 1)) / (weighted + K1 * (1 - B + B * (dl / index.avgLen)));
          const add = idf * tf * boost * (isTyped ? 1 : 0.55);
          scores.set(docIndex, (scores.get(docIndex) ?? 0) + add);
          if (!hitTerms.has(docIndex)) hitTerms.set(docIndex, new Set());
          hitTerms.get(docIndex)!.add(term);
          if (!hitTokens.has(docIndex)) hitTokens.set(docIndex, new Set());
          hitTokens.get(docIndex)!.add(rawToken);
        }
      }
    }
  }

  /* «شاطئ في الفحيحيل» — a beach in Fahaheel — used to answer with الكوت مول,
   * a shopping centre, because the area name is rare and therefore scores
   * enormously, while «شاطئ» is spread over several beaches and none of them
   * is in Fahaheel. Same for «كافيه بالسالمية», which returned a mall.
   *
   * The two halves of such a query are not equal. The noun is WHAT is wanted
   * and the area is WHERE; a result that satisfies only the where has not
   * answered the question, it has only agreed about the map. So when the
   * query names an area *and* asks for something else, a document that
   * matched nothing but the area name is pushed below everything that matched
   * the thing itself. It is damped rather than dropped, because when nothing
   * in the area fits, the right neighbours are still the best fallback there
   * is — they just must not come first.
   *
   * A query that is only an area («السالمية») has no other half to lose to,
   * and nothing here applies to it. */
  const areaTokens = new Set(raw.filter((t) => index.areaTerms.has(t)));
  const asksForMore = areaTokens.size > 0 && areaTokens.size < raw.length;

  /* Which categories the query is actually asking for.
   *
   * Read through the synonyms, so «كافيه» and «كوفي» and «نتقهوى» all arrive
   * at coffee, and a place that IS a coffee place is then ranked above one
   * whose description merely says the word. That ordering was upside down:
   * «كافيه بالسالمية» answered with a mall and then a BEACH, because the
   * typed word scored full weight against the beach's prose while the
   * synonym that resolved to the category was discounted to 0.55.
   *
   * Only a modest boost. It settles ties between things that all matched;
   * it is not a filter, and a strong match on the name or the tags can still
   * beat it — which is right, because someone typing a place's actual name
   * wants that place whatever category it sits in. */
  const wantedCategories = new Set<CategoryId>();
  for (const rawToken of raw) {
    for (const token of variantsOf(rawToken)) {
      const id = index.categoryTerms.get(token);
      if (id) wantedCategories.add(id);
    }
  }

  const hits: SearchHit[] = [];
  for (const [docIndex, score] of scores) {
    const doc = index.docs[docIndex];
    if (kinds && !kinds.includes(doc.kind)) continue;
    // Reward covering more of the query — two matching words beats one twice.
    const coverage = (hitTokens.get(docIndex)?.size ?? 0) / raw.length;
    const matchedTokens = hitTokens.get(docIndex) ?? new Set<string>();
    const onlyArea =
      asksForMore && [...matchedTokens].every((t) => areaTokens.has(t));
    // Places are what people are looking for; pages are navigation.
    const kindBoost = doc.kind === "place" ? 1.15 : doc.kind === "page" ? 0.7 : 1;
    hits.push({
      doc,
      score:
        score *
        (0.65 + 0.35 * Math.min(1, coverage)) *
        kindBoost *
        (onlyArea ? 0.2 : 1) *
        (doc.category && wantedCategories.has(doc.category) ? 1.5 : 1) *
        (pushedDown.has(docIndex) ? 0.1 : 1),
      matched: [...(hitTerms.get(docIndex) ?? [])],
    });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Split text so matched terms can be wrapped without dangerous HTML. */
export function highlight(text: string, matched: string[]): { text: string; hit: boolean }[] {
  if (!matched.length) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  const words = text.split(/(\s+)/);
  for (const w of words) {
    const n = normalise(w.replace(/[^\p{L}\p{N}]/gu, ""));
    const hit = n.length > 1 && matched.some((m) => n === m || n.startsWith(m) || m.startsWith(n));
    parts.push({ text: w, hit });
  }
  return parts;
}
