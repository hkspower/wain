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
  return value
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
};

/** A typed token plus its synonyms, kept grouped under the token they came
 * from so scoring can tell which *query word* a match satisfies. */
function variantsOf(token: string): string[] {
  return [...new Set([token, ...(SYNONYMS[token] ?? []).map(normalise)])];
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
      keywords: [p.name, p.area, cat?.ar ?? "", cat?.en ?? "", ...p.highlightsAr],
      body: `${p.taglineAr} ${p.descriptionAr} ${p.bestTimeAr}`,
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
  return { docs, postings, docLen, avgLen, terms: [...postings.keys()] };
}

/* ------------------------------------------------------------------ */
/* Query                                                               */
/* ------------------------------------------------------------------ */

const K1 = 1.2;
const B = 0.75;

/** Resolve one query token to index terms: exact, then prefix, then fuzzy. */
function candidates(term: string, index: SearchIndex): { term: string; boost: number }[] {
  if (index.postings.has(term)) return [{ term, boost: 1 }];

  const prefix = index.terms.filter((t) => t.startsWith(term));
  if (prefix.length) return prefix.slice(0, 12).map((t) => ({ term: t, boost: 0.82 }));

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

  const hits: SearchHit[] = [];
  for (const [docIndex, score] of scores) {
    const doc = index.docs[docIndex];
    if (kinds && !kinds.includes(doc.kind)) continue;
    // Reward covering more of the query — two matching words beats one twice.
    const coverage = (hitTokens.get(docIndex)?.size ?? 0) / raw.length;
    // Places are what people are looking for; pages are navigation.
    const kindBoost = doc.kind === "place" ? 1.15 : doc.kind === "page" ? 0.7 : 1;
    hits.push({
      doc,
      score: score * (0.65 + 0.35 * Math.min(1, coverage)) * kindBoost,
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
