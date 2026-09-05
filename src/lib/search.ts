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
    .trim();
}

/** Leading particles carry no meaning for retrieval. */
const STOP = new Set(["ال", "في", "من", "على", "الى", "عن", "مع", "او", "و", "the", "a", "of", "in"]);

export function tokenize(value: string): string[] {
  return normalise(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => (t.length > 3 && t.startsWith("ال") ? t.slice(2) : t));
}

/** How people actually phrase things → the vocabulary the data uses. */
const SYNONYMS: Record<string, string[]> = {
  مقهى: ["قهوه", "كافيه"],
  كوفي: ["قهوه", "كافيه"],
  كافي: ["قهوه", "كافيه"],
  شاي: ["قهوه", "چاي", "كرك"],
  كرك: ["قهوه", "چاي"],
  مطعم: ["مطاعم", "اكل", "غدا", "عشا"],
  اكل: ["مطاعم", "مطعم"],
  عشاء: ["مطاعم", "عشا"],
  غداء: ["مطاعم", "غدا"],
  فطور: ["مطاعم", "فطار"],
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
  عيال: ["عائله", "اطفال", "عوائل"],
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
  موعد: ["رومانسي", "هدوء"],
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
  // Walking, which the catalogue tags as «ممشى» and «مشي داخلي».
  مشي: ["ممشى", "مشي داخلي", "حدائق"],
  رياضه: ["ممشى", "مشي داخلي"],
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
};

/**
 * The synonym table, keyed the way lookups actually arrive.
 *
 * Query tokens are normalised before they get here — ى folds to ي, ة to ه —
 * so a key written «مقهى» could never be found, and that entry sat dead in the
 * table. Normalising the keys once at load closes the whole class rather than
 * the one instance, and merges any entries that collide once folded.
 */
const SYNONYM_LOOKUP: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [key, values] of Object.entries(SYNONYMS)) {
    const k = normalise(key);
    m.set(k, [...new Set([...(m.get(k) ?? []), ...values.map(normalise)])]);
  }
  return m;
})();

/** A typed token plus its synonyms, kept grouped under the token they came
 * from so scoring can tell which *query word* a match satisfies. */
function variantsOf(token: string): string[] {
  return [...new Set([token, ...(SYNONYM_LOOKUP.get(token) ?? [])])];
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
function declitic(token: string): string[] {
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
const ELSEWHERE_IN_KUWAIT = new Set(
  [
    // governorates
    "الجهراء", "الفروانية", "الأحمدي", "العاصمة",
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

  const prefix = index.terms.filter((t) => t.startsWith(term));
  if (prefix.length) return prefix.slice(0, 12).map((t) => ({ term: t, boost: 0.82 }));

  // Below four letters a single edit reaches too much of the vocabulary —
  // «قق» would "correct" to any two-letter term — so short tokens get exact,
  // prefix and synonym matching only.
  if (term.length < 4) return [];

  const max = term.length >= 6 ? 2 : 1;
  const fuzzy: { term: string; boost: number }[] = [];
  for (const t of index.terms) {
    const d = editDistance(term, t, max);
    if (d <= max) fuzzy.push({ term: t, boost: d === 1 ? 0.62 : 0.42 });
  }
  return fuzzy.sort((a, b) => b.boost - a.boost).slice(0, 8);
}

export function search(
  query: string,
  index: SearchIndex,
  { limit = 20, kinds }: { limit?: number; kinds?: DocKind[] } = {}
): SearchHit[] {
  const raw = tokenize(query);
  if (raw.length === 0) return [];
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
        (doc.category && wantedCategories.has(doc.category) ? 1.5 : 1),
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
