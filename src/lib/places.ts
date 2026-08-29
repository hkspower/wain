import type { MenuItem } from "@/lib/orders";

import { categories, type Category, type CategoryId } from "@/lib/place-kit";

/**
 * The catalogue itself.
 *
 * Everything that describes a place WITHOUT needing one — the category list,
 * the prep and service clamps, the Arabic-Indic numerals, the counting forms —
 * moved to `place-kit.ts`, and is re-exported here so every existing import
 * keeps working unchanged.
 *
 * The reason is measured: the Footer, OrdersLink, `orders.ts` and `queue.ts`
 * all import from this module and none of them reads a single place record,
 * but all four are reachable from the root layout — so every page shipped all
 * 36 places. The privacy page carried the whole catalogue to render two
 * paragraphs about cookies.
 *
 * Import from `@/lib/place-kit` when you need the vocabulary, and from here
 * when you need the places. The re-export below is for compatibility, not an
 * invitation: a new import of `categories` from this file quietly puts the
 * catalogue back on whatever page it lands in.
 */
export * from "@/lib/place-kit";

export interface Place {
  slug: string;
  name: string;
  nameAr: string;
  category: CategoryId;
  area: string;
  areaAr: string;
  /** Approximate coordinates, used for the "nearby" search. */
  lat: number;
  lng: number;
  rating: number;
  priceLevel: 1 | 2 | 3;
  emoji: string;
  taglineAr: string;
  descriptionAr: string;
  highlightsAr: string[];
  bestTimeAr: string;

  /**
   * Whether the place works when it is 48°C outside.
   *
   * In Kuwait this is the decisive fact about an outing for four months of the
   * year, and nothing here encoded it: searching «طلعة بالصيف» returned an
   * open-air zoo, and «مكان بارد» returned an outdoor amusement park — the
   * hottest possible answers to the question actually being asked. bestTimeAr
   * hints at it in prose, which neither the search index nor شوق can reason
   * with.
   *
   * "mixed" is for places with a real indoor refuge — a souq with covered
   * alleys, a mall on the waterfront — not for a street with air-conditioned
   * shops along it.
   */
  setting: "indoor" | "outdoor" | "mixed";
  /** When it is actually pleasant, in words, for people to read. */
  seasonAr: string;
  /**
   * True for the rare open-air place the heat does not ruin — a water park is
   * outdoors, but summer is the entire point of going. Without this, شوق read
   * "outdoor" as "warn about the heat" and told people to visit a water park
   * after sunset, which is worse advice than saying nothing.
   */
  summerOk?: boolean;
  /**
   * What someone would type or say to look for this — the occasion, the crowd,
   * the food. Distinct from highlightsAr, which is prose shown on the page:
   * these exist to be matched. «مع الربع», «فطور» and «بيتزا» all returned
   * nothing before them.
   */
  tagsAr: string[];

  featured?: boolean;

  /* --- Business profile. Absent on the places the site ships with, so those
     pages render exactly as before; filled in when a business registers and an
     admin approves what it sent. --- */

  /** Public URL of the brand mark. */
  logoUrl?: string;
  /** The business in its own words, as opposed to descriptionAr, which is ours. */
  bioAr?: string;
  /** Public URLs of photos an admin has approved. Never shown unapproved. */
  imageUrls?: string[];

  /* How to reach the business. These are the PLACE's public channels, given by
     the owner for display — entirely separate from the submitter's personal
     contact details, which never leave the submissions table. */
  phone?: string;
  /** Bare handle, no @ and no URL. */
  instagram?: string;
  /** http(s) URL — scheme-checked at the database so it is safe in an href. */
  website?: string;
  /** What the business sells or offers, one short line each. */
  productsAr?: string[];

  /* --- طلب مسبق. Order ahead, pay on collection. See src/lib/orders.ts --- */

  /**
   * Priced items a customer can order ahead. Separate from productsAr, which
   * is a description of what the place does and carries no price: a barber
   * lists "حلاقة" as a service without wanting a shopping cart attached to it.
   */
  menuAr?: MenuItem[];
  /**
   * The business's own switch. A menu alone is not consent to take orders —
   * it can be published for reading while ordering stays off, and turning it
   * off must never delete the menu.
   */
  acceptsOrders?: boolean;
  /** Anything the customer should know before collecting. */
  orderNoteAr?: string;
  /**
   * How long the business needs before an order can be collected, in minutes.
   * Defaults to 30 when unset. A karak is ready in ten minutes; a mixed grill
   * is not, and offering it in half an hour only sets the customer up to stand
   * around waiting.
   */
  orderPrepMinutes?: number;

  /* --- الطابور. Take your turn at the salon. See src/lib/queue.ts --- */

  /**
   * A salon is men's or women's, never both — they are separate premises with
   * separate staff. Unset on anything that is not a salon.
   */
  salonKind?: "men" | "women";
  /** The salon's own switch, the same bargain as acceptsOrders. */
  takesQueue?: boolean;
  /** Roughly how long one customer takes. Used only to estimate a wait. */
  queueServiceMinutes?: number;
}

export const places: Place[] = [
  {
    slug: "kuwait-towers",
    name: "Kuwait Towers",
    nameAr: "أبراج الكويت",
    category: "landmarks",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.389,
    lng: 48.0034,
    rating: 4.7,
    priceLevel: 2,
    emoji: "🗼",
    taglineAr: "أيقونة الكويت، على ارتفاع ١٨٧ متر فوق الخليج.",
    descriptionAr:
      "الأبراج الثلاثة على ساحل الخليج العربي هي أشهر معلم في الكويت. اطلع للكرة الدوّارة وشوف المدينة والبحر من ٣٦٠ درجة، وإذا جيت وقت المغرب بتشوف الأبراج وهي تضوّي.",
    highlightsAr: ["كرة المشاهدة ٣٦٠°", "مطعم دوّار", "ممشى على البحر"],
    bestTimeAr: "وقت الغروب، لمّا تضوّي الأبراج",
    setting: "mixed",
    seasonAr: "طول السنة، وأحلى شي وقت الغروب",
    tagsAr: ["إطلالة", "تصوير", "معلم", "سياحة", "عوائل", "ربع"],
    featured: true,
  },
  {
    slug: "souq-al-mubarakiya",
    name: "Souq Al-Mubarakiya",
    nameAr: "سوق المباركية",
    category: "shopping",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3741,
    lng: 47.9788,
    rating: 4.8,
    priceLevel: 1,
    emoji: "🏮",
    taglineAr: "قرنين من التجارة والبهارات والحكايات.",
    descriptionAr:
      "من أقدم أسواق الكويت. أزقّة مليانة بسطات بهارات ودكاكين ذهب وبياعين تمر ومطاعم صغيرة. يا ليتك تجي وأنت جوعان، وتختم السهرة بچاي في الحوش القديم.",
    highlightsAr: ["أكل كويتي أصيل", "سوق البهارات والذهب", "أحواش تراثية"],
    bestTimeAr: "بالليل، بعد الخامسة",
    setting: "mixed",
    seasonAr: "من أكتوبر لأبريل، وبالليل صيفاً",
    tagsAr: ["تراث", "بهارات", "ذهب", "أكل شعبي", "تصوير", "رخيص", "سهرة"],
    featured: true,
  },
  {
    slug: "al-shaheed-park",
    name: "Al Shaheed Park",
    nameAr: "حديقة الشهيد",
    category: "outdoors",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3648,
    lng: 47.9906,
    rating: 4.6,
    priceLevel: 1,
    emoji: "🌳",
    taglineAr: "الرئة الخضراء للعاصمة.",
    descriptionAr:
      "أكبر حديقة في الكويت، فيها حدائق نباتية وبحيرات ومتحفين ومسارات مشي وحفلات في الهواء الطلق. مكان ممتاز لمشية عصرية في قلب المدينة.",
    highlightsAr: ["حدائق نباتية", "متحف الحبيتات ومتحف الذاكرة", "مسار مشي حول البحيرة"],
    bestTimeAr: "الصبح بدري أو بعد المغرب",
    setting: "outdoor",
    seasonAr: "من أكتوبر لأبريل",
    tagsAr: ["مشي", "طبيعة", "هدوء", "تصوير", "عوائل", "رياضة"],
    featured: true,
  },
  {
    slug: "mais-alghanim",
    name: "Mais Alghanim",
    nameAr: "ميس الغانم",
    category: "restaurants",
    area: "Gulf Road",
    areaAr: "شارع الخليج",
    lat: 29.3665,
    lng: 48.0003,
    rating: 4.6,
    priceLevel: 2,
    emoji: "🍢",
    taglineAr: "مطعم كويتي عريق على شارع الخليج.",
    descriptionAr:
      "من أقدم وأشهر المطاعم الكويتية، معروف بالمشاوي والمقبّلات والأكل الشامي والكويتي. مكان يعرفه كل أهل الكويت، ومناسب للعزايم العائلية.",
    highlightsAr: ["مشاوي ومقبّلات", "إطلالة على شارع الخليج", "مناسب للعوائل"],
    bestTimeAr: "العشاء، ويفضّل الحجز",
    setting: "indoor",
    seasonAr: "طول السنة",
    tagsAr: ["مشاوي", "عزايم", "عوائل", "شامي", "عشا", "حجز", "غدا"],
    featured: true,
  },
  {
    slug: "freej-swaileh",
    name: "Freej Swaileh",
    nameAr: "فريج صويلح",
    category: "restaurants",
    area: "Salmiya",
    areaAr: "السالمية",
    lat: 29.3339,
    lng: 48.0709,
    rating: 4.5,
    priceLevel: 2,
    emoji: "🍛",
    taglineAr: "أكل كويتي في أجواء الفريج القديم.",
    descriptionAr:
      "مطعم كويتي بديكور تراثي يرجّعك للفريج القديم. القائمة كويتية أصيلة من مچبوس ومرقوق وتشريب، والجلسة نفسها جزء من التجربة.",
    highlightsAr: ["مچبوس ومرقوق", "ديكور تراثي", "أجواء كويتية"],
    bestTimeAr: "الغدا، خصوصاً نهاية الأسبوع",
    setting: "indoor",
    seasonAr: "طول السنة",
    tagsAr: ["مچبوس", "أكل كويتي", "غدا", "عوائل", "تراث", "عزايم"],
  },
  {
    slug: "mubarakiya-tea-houses",
    name: "Mubarakiya Tea Houses",
    nameAr: "مقاهي المباركية",
    category: "coffee",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3746,
    lng: 47.9783,
    rating: 4.7,
    priceLevel: 1,
    emoji: "☕",
    taglineAr: "چاي وقهوة عربية في حوش السوق.",
    descriptionAr:
      "في قلب المباركية أحواش وجلسات شعبية تقدّم الچاي والقهوة العربية والكرك. أرخص وأصدق تجربة قهوة في الكويت، وأحلى مكان تقعد فيه بعد جولة السوق.",
    highlightsAr: ["چاي كرك", "قهوة عربية وهيل", "جلسات شعبية"],
    bestTimeAr: "العصر وبعد المغرب",
    setting: "outdoor",
    seasonAr: "من أكتوبر لأبريل، وبالليل صيفاً",
    tagsAr: ["چاي", "كرك", "قهوة عربية", "رخيص", "ربع", "هدوء", "سهرة"],
    featured: true,
  },
  {
    slug: "salem-al-mubarak-street",
    name: "Salem Al Mubarak Street",
    nameAr: "شارع سالم المبارك",
    category: "fastfood",
    area: "Salmiya",
    areaAr: "السالمية",
    lat: 29.3369,
    lng: 48.0664,
    rating: 4.3,
    priceLevel: 1,
    emoji: "🍔",
    taglineAr: "شارع الأكل السريع والسهرات في السالمية.",
    descriptionAr:
      "أشهر شارع في السالمية، مليان مطاعم وجبات سريعة ومحلات حلا وكافيهات. مكان الطلعة السريعة إذا تبي تاكل شي على الماشي وتتمشى بعدها.",
    highlightsAr: ["برجر ووجبات سريعة", "محلات حلا وآيس كريم", "مفتوح لوقت متأخر"],
    bestTimeAr: "بالليل، بعد الثامنة",
    setting: "mixed",
    seasonAr: "من أكتوبر لأبريل، وبالليل صيفاً",
    tagsAr: ["برجر", "بيتزا", "شاورما", "سناك", "حلا", "آيس كريم", "ربع", "سهرة", "رخيص"],
  },
  {
    slug: "the-avenues",
    name: "The Avenues",
    nameAr: "الأفنيوز",
    category: "shopping",
    area: "Al Rai",
    areaAr: "الري",
    lat: 29.3025,
    lng: 47.937,
    rating: 4.7,
    priceLevel: 3,
    emoji: "🛍️",
    taglineAr: "مدينة داخل مدينة — أكبر مول في الخليج.",
    descriptionAr:
      "أكثر من ١١٠٠ محل موزّعة على مناطق مختلفة، كل وحدة لها طابعها. من الماركات العالمية في البرستيج إلى الجراند أفنيو اللي يشبه السوق المفتوح. يوم كامل ما يكفيه.",
    highlightsAr: ["مناطق تسوّق متنوّعة", "مطاعم عالمية", "ممشى داخلي مكيّف"],
    bestTimeAr: "الصبح في أيام الدوام، عشان الزحمة",
    setting: "indoor",
    seasonAr: "طول السنة — مكيّف بالكامل",
    tagsAr: ["مكيّف", "ماركات", "سينما", "مطاعم", "فطور", "برجر", "بيتزا", "عوائل", "مشي داخلي"],
  },
  {
    slug: "souq-sharq",
    name: "Souq Sharq",
    nameAr: "سوق شرق",
    category: "shopping",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3838,
    lng: 47.9925,
    rating: 4.4,
    priceLevel: 2,
    emoji: "⛵",
    taglineAr: "مول على البحر مع مارينا وقوارب.",
    descriptionAr:
      "مول على الواجهة البحرية مع مارينا وقوارب راسية وكافيهات مطلّة على الماء. مكان هادي للتسوّق ومشية على البحر في نفس الطلعة.",
    highlightsAr: ["إطلالة على المارينا", "كافيهات على البحر", "ممشى بحري"],
    bestTimeAr: "العصر، قبل الغروب",
    setting: "mixed",
    seasonAr: "طول السنة، والممشى أحلى بالشتاء",
    tagsAr: ["مكيّف", "بحر", "مارينا", "كافيهات", "عوائل", "هدوء"],
  },
  {
    slug: "grand-mosque",
    name: "The Grand Mosque",
    nameAr: "المسجد الكبير",
    category: "culture",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3792,
    lng: 47.9857,
    rating: 4.9,
    priceLevel: 1,
    emoji: "🕌",
    taglineAr: "أكبر مساجد الكويت، وتحفة في الفن الإسلامي.",
    descriptionAr:
      "على مساحة ٤٥ ألف متر مربع، المسجد الكبير يبهرك بالخط العربي والزخارف الأندلسية والقبة الضخمة والأحواش الهادية. فيه جولات مجانية بمرشد لكل الزوّار.",
    highlightsAr: ["جولات مجانية بمرشد", "خط عربي وقبة مذهلة", "أحواش هادية"],
    bestTimeAr: "مواعيد الجولات الصباحية",
    setting: "indoor",
    seasonAr: "طول السنة",
    tagsAr: ["عمارة", "تصوير", "جولة", "هدوء", "مجاناً", "دين"],
  },
  {
    slug: "marina-beach",
    name: "Marina Beach & Crescent",
    nameAr: "شاطئ المارينا",
    category: "outdoors",
    area: "Salmiya",
    areaAr: "السالمية",
    lat: 29.3411,
    lng: 48.0673,
    rating: 4.5,
    priceLevel: 1,
    emoji: "🏖️",
    taglineAr: "رمل ناعم ومطاعم على بحر السالمية.",
    descriptionAr:
      "شاطئ نظيف ومناسب للعوائل، مربوط بمول المارينا بجسر مشاة. اسبح أو استأجر كاياك، أو بس تمشّى على الكرسنت وقت الذهبي واختر كافيه على البحر.",
    highlightsAr: ["سباحة وكاياك", "كافيهات على الواجهة", "ممشى المارينا كرسنت"],
    bestTimeAr: "العصر المتأخر",
    setting: "outdoor",
    seasonAr: "من أكتوبر لأبريل",
    tagsAr: ["بحر", "سباحة", "كاياك", "ممشى", "عوائل", "غروب"],
    featured: true,
  },
  {
    slug: "jacc",
    name: "Sheikh Jaber Cultural Centre",
    nameAr: "مركز الشيخ جابر الثقافي",
    category: "culture",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3589,
    lng: 48.0004,
    rating: 4.8,
    priceLevel: 2,
    emoji: "🎭",
    taglineAr: "دار الأوبرا في الخليج.",
    descriptionAr:
      "مجمّع مسارح وقاعات موسيقية بتصميم مغطّى بزخارف هندسية إسلامية. احضر أوبرا أو حفل سيمفوني، أو بس تعال شوف المعمار وهو ينعكس على المسطحات المائية.",
    highlightsAr: ["عروض عالمية", "معمار مميّز", "إضاءة مسائية"],
    bestTimeAr: "ليالي العروض — احجز مقدّماً",
    setting: "indoor",
    seasonAr: "طول السنة — مواسم العروض بالشتاء",
    tagsAr: ["مكيّف", "أوبرا", "حفلات", "عمارة", "موعد", "راقي"],
  },
  {
    slug: "failaka-island",
    name: "Failaka Island",
    nameAr: "جزيرة فيلكا",
    category: "outdoors",
    area: "Arabian Gulf",
    areaAr: "الخليج العربي",
    lat: 29.4457,
    lng: 48.3318,
    rating: 4.4,
    priceLevel: 2,
    emoji: "⛵",
    taglineAr: "آثار يونانية قديمة، على بعد رحلة عبّارة.",
    descriptionAr:
      "كانت موطن حضارة من العصر البرونزي وفيها قلعة هلنستية. فيلكا تجمع بين الآثار والشواطئ الهادية. خذ العبّارة من السالمية، لف على الآثار، واقعد لشواء على البحر.",
    highlightsAr: ["آثار هلنستية", "رحلات عبّارة يومية", "شواطئ هادية"],
    bestTimeAr: "الربيع والشتاء، نهاية الأسبوع",
    setting: "outdoor",
    seasonAr: "الربيع والشتاء",
    tagsAr: ["آثار", "عبّارة", "بحر", "شواء", "ربع", "رحلة"],
  },
  {
    slug: "mirror-house",
    name: "The Mirror House",
    nameAr: "بيت المرايا",
    category: "culture",
    area: "Qadsiya",
    areaAr: "القادسية",
    lat: 29.3486,
    lng: 47.9932,
    rating: 4.6,
    priceLevel: 1,
    emoji: "🪞",
    taglineAr: "بيت مغطّى بالمرايا من داخله وخارجه.",
    descriptionAr:
      "الفنانة ليديا القطان قضت عقود وهي تغطّي كل سطح في بيت عائلتها بفسيفساء المرايا. النتيجة وحدة من أغرب المتاحف في الشرق الأوسط، والزيارة بموعد مسبق ومع جولة شخصية.",
    highlightsAr: ["غرف فسيفساء المرايا", "جولة مع عائلة الفنانة", "تجربة فريدة في الخليج"],
    bestTimeAr: "بموعد مسبق",
    setting: "indoor",
    seasonAr: "طول السنة — بموعد مسبق",
    tagsAr: ["فن", "تصوير", "فريد", "جولة", "حجز", "هدوء"],
  },
  {
    slug: "aqua-park",
    name: "Aqua Park Kuwait",
    nameAr: "أكوا بارك",
    category: "family",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3878,
    lng: 48.0004,
    rating: 4.3,
    priceLevel: 2,
    emoji: "🎢",
    taglineAr: "أول مدينة ألعاب مائية في الخليج، جنب الأبراج.",
    descriptionAr:
      "زحاليق ومسابح أمواج وأنهار كسولة ممتدة على الواجهة البحرية. طلعة عائلية سهلة، مع أماكن أكل وجلسات مظلّلة، وكلها جنب أبراج الكويت.",
    highlightsAr: ["مسبح أمواج وزحاليق", "مناطق ألعاب للصغار", "موقع على البحر"],
    bestTimeAr: "الصبح في أيام الدوام صيفاً",
    setting: "outdoor",
    seasonAr: "الصيف للمي، والربيع أحلى للجو",
    summerOk: true,
    tagsAr: ["عيال", "مي", "زحاليق", "عوائل", "صيف", "سباحة"],
  },
  {
    slug: "tareq-rajab-museum",
    name: "Tareq Rajab Museum",
    nameAr: "متحف طارق رجب",
    category: "culture",
    area: "Jabriya",
    areaAr: "الجابرية",
    lat: 29.3222,
    lng: 48.0231,
    rating: 4.7,
    priceLevel: 1,
    emoji: "🏺",
    taglineAr: "كنز خاص من الفن الإسلامي.",
    descriptionAr:
      "آلاف القطع من الخط العربي والخزف والمجوهرات والآلات الموسيقية، مجموعة على مدى خمسين سنة. متحف هادي ومنسّق بعناية، ومعروف إنه نجا من الغزو وهو مخبّى خلف جدار وهمي.",
    highlightsAr: ["خط عربي نادر", "مجوهرات ذهب وفضة", "قصة مذهلة"],
    bestTimeAr: "عصر أيام الدوام",
    setting: "indoor",
    seasonAr: "طول السنة",
    tagsAr: ["مكيّف", "فن إسلامي", "خط", "مجوهرات", "هدوء", "تاريخ"],
  },
  {
    slug: "green-island",
    name: "Green Island",
    nameAr: "الجزيرة الخضراء",
    category: "family",
    area: "Gulf Road",
    areaAr: "شارع الخليج",
    lat: 29.3699,
    lng: 48.0092,
    rating: 4.2,
    priceLevel: 1,
    emoji: "🏝️",
    taglineAr: "جزيرة صناعية فيها حدائق وبحيرات.",
    descriptionAr:
      "أول جزيرة صناعية في الخليج، مربوطة بالكورنيش بممشى. مساحات خضراء وبحيرة سباحة وبرج مشاهدة ومدرّج، تكفي لنص يوم مع العيال.",
    highlightsAr: ["بحيرة سباحة", "برج مشاهدة", "مساحات خضراء للتنزّه"],
    bestTimeAr: "الأشهر الباردة، وقت العصر",
    setting: "outdoor",
    seasonAr: "الأشهر الباردة",
    tagsAr: ["بحر", "مشي", "عوائل", "تصوير", "سباحة", "هدوء"],
  },

  /* ---------------------------------------------------------------------
     معالم
     --------------------------------------------------------------------- */
  {
    slug: "liberation-tower",
    name: "Liberation Tower",
    nameAr: "برج التحرير",
    category: "landmarks",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3797,
    lng: 47.9861,
    rating: 4.4,
    priceLevel: 1,
    emoji: "🗼",
    taglineAr: "برج الاتصالات اللي سُمّي على التحرير.",
    descriptionAr:
      "ثاني أطول برج في الكويت، بُني بعد التحرير وسُمّي على اسمه. تصميمه مغطّى بالفسيفساء ويطلّ على قلب العاصمة، ومنظره بالليل من شارع الخليج من أحلى مناظر المدينة.",
    highlightsAr: ["فسيفساء تغطّي البرج", "إطلالة على العاصمة", "منظره بالليل"],
    bestTimeAr: "بعد المغرب، لمّا تشتغل الإضاءة",
    setting: "outdoor",
    seasonAr: "طول السنة — أحلى بالليل",
    tagsAr: ["إطلالة", "تصوير", "معلم", "سهرة", "عمارة", "مجاناً"],
  },
  {
    slug: "seif-palace",
    name: "Seif Palace",
    nameAr: "قصر السيف",
    category: "landmarks",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3776,
    lng: 47.9718,
    rating: 4.3,
    priceLevel: 1,
    emoji: "🏛️",
    taglineAr: "القصر التاريخي وبرج ساعته الأزرق.",
    descriptionAr:
      "مقر الحكم التاريخي على الواجهة البحرية، معروف ببرج ساعته المغطّى بالبلاط الأزرق والذهبي. ما يُدخل له، بس الواجهة والساحة قدّامه من أشهر مناظر العاصمة والتصوير من برّا مسموح.",
    highlightsAr: ["برج الساعة الأزرق", "عمارة كويتية تقليدية", "على الواجهة البحرية"],
    bestTimeAr: "الصبح، قبل ما تشتد الشمس",
    setting: "outdoor",
    seasonAr: "من أكتوبر لأبريل، الصبح",
    tagsAr: ["تصوير", "تاريخ", "معلم", "عمارة", "بحر", "مجاناً"],
  },
  {
    slug: "al-hamra-tower",
    name: "Al Hamra Tower",
    nameAr: "برج الحمراء",
    category: "landmarks",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3785,
    lng: 47.9915,
    rating: 4.5,
    priceLevel: 2,
    emoji: "🏙️",
    taglineAr: "أطول برج في الكويت، ملتوي مثل عباية.",
    descriptionAr:
      "أطول مبنى في الكويت على ارتفاع ٤١٤ متر، وتصميمه الملتوي صار من أشهر الأبراج في العالم. تحته مجمّع فيه محلات وسينما ومطاعم، والبرج نفسه مكاتب.",
    highlightsAr: ["أطول مبنى في الكويت", "تصميم ملتوي مميّز", "مجمّع ومطاعم تحته"],
    bestTimeAr: "بالليل، عشان الإضاءة",
    setting: "indoor",
    seasonAr: "طول السنة — مكيّف",
    tagsAr: ["مكيّف", "سينما", "مطاعم", "ماركات", "إطلالة", "تصوير", "راقي"],
  },

  /* ---------------------------------------------------------------------
     ثقافة
     --------------------------------------------------------------------- */
  {
    slug: "kuwait-national-museum",
    name: "Kuwait National Museum",
    nameAr: "المتحف الوطني الكويتي",
    category: "culture",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3737,
    lng: 47.9757,
    rating: 4.1,
    priceLevel: 1,
    emoji: "🏺",
    taglineAr: "تاريخ الكويت وآثارها، مع قبة فلكية.",
    descriptionAr:
      "المتحف الوطني يجمع آثار الكويت من فيلكا والحياة البحرية والبيت الكويتي القديم، وفيه قبة فلكية. تضرّر وقت الغزو ورجع يفتح تدريجياً، وزيارته تفهّمك من وين جت الديرة.",
    highlightsAr: ["آثار فيلكا", "القبة الفلكية", "بوم الغوص في الساحة"],
    bestTimeAr: "الصبح في أيام الأسبوع",
    setting: "indoor",
    seasonAr: "طول السنة",
    tagsAr: ["مكيّف", "تاريخ", "آثار", "قبة فلكية", "عوائل", "عيال"],
  },
  {
    slug: "sadu-house",
    name: "Sadu House",
    nameAr: "بيت السدو",
    category: "culture",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3743,
    lng: 47.9748,
    rating: 4.3,
    priceLevel: 1,
    emoji: "🧶",
    taglineAr: "بيت طيني يحفظ نسيج السدو البدوي.",
    descriptionAr:
      "بيت تراثي من الطين على شارع الخليج، صار مركز يحفظ حرفة السدو — النسيج البدوي بخيوط الصوف وألوانه. فيه معروضات وورش، وتقدر تشتري قطع منسوجة بيد حرفيات كويتيات.",
    highlightsAr: ["نسيج سدو أصلي", "ورش وعروض حيّة", "بيت طيني تراثي"],
    bestTimeAr: "العصر، أيام الأسبوع",
    setting: "indoor",
    seasonAr: "طول السنة",
    tagsAr: ["مكيّف", "تراث", "سدو", "حرف", "ورش", "هدوء", "تسوّق"],
  },
  {
    slug: "abdullah-al-salem-cultural-centre",
    name: "Sheikh Abdullah Al Salem Cultural Centre",
    nameAr: "مركز الشيخ عبدالله السالم الثقافي",
    category: "culture",
    area: "Shuwaikh",
    areaAr: "الشويخ",
    lat: 29.3517,
    lng: 47.9647,
    rating: 4.6,
    priceLevel: 2,
    emoji: "🔭",
    taglineAr: "أكبر مجمّع متاحف في الشرق الأوسط.",
    descriptionAr:
      "مجمّع ضخم فيه متاحف للعلوم والفضاء والتاريخ الطبيعي والفنون الإسلامية، مع مسرح وقبة فلكية. يوم كامل ما يكفي كل الأجنحة، وأحلى مكان تودّي فيه العيال ويستفيدون.",
    highlightsAr: ["متحف علوم وفضاء", "قبة فلكية", "أجنحة تناسب العيال"],
    bestTimeAr: "الصبح، وخصوصاً أيام الدوام",
    setting: "indoor",
    seasonAr: "طول السنة — مكيّف بالكامل",
    tagsAr: ["مكيّف", "علوم", "فضاء", "عيال", "عوائل", "تعليمي", "يوم كامل"],
  },
  {
    slug: "bait-al-othman",
    name: "Bait Al Othman Museum",
    nameAr: "بيت العثمان",
    category: "culture",
    area: "Hawalli",
    areaAr: "حولي",
    // Moved to sit inside حولي rather than 5.8km south of the other place
    // labelled with it — the audit could tell the two disagreed, and the area
    // label is the half I am more sure of. Still worth a look on the map.
    lat: 29.3325,
    lng: 48.0295,
    rating: 4.4,
    priceLevel: 1,
    emoji: "🏚️",
    taglineAr: "أكبر متحف يحكي حياة الكويت القديمة.",
    descriptionAr:
      "بيت قديم تحوّل لمتحف يعرض الحياة الكويتية قبل النفط — الفريج والغوص والسوق والبيت — بمجسّمات ومشاهد كاملة. فيه بعد جناح يوثّق الغزو والتحرير.",
    highlightsAr: ["مشاهد الفريج القديم", "جناح الغزو والتحرير", "مناسب للعوائل"],
    bestTimeAr: "العصر، ويفضّل الحجز للمجموعات",
    setting: "indoor",
    seasonAr: "طول السنة",
    tagsAr: ["مكيّف", "تراث", "تاريخ", "عيال", "عوائل", "تعليمي"],
  },

  /* ---------------------------------------------------------------------
     تسوّق
     --------------------------------------------------------------------- */
  {
    slug: "marina-mall",
    name: "Marina Mall",
    nameAr: "مارينا مول",
    category: "shopping",
    area: "Salmiya",
    areaAr: "السالمية",
    lat: 29.3395,
    lng: 48.0678,
    rating: 4.3,
    priceLevel: 2,
    emoji: "🛍️",
    taglineAr: "مول على البحر مربوط بالشاطئ والكرسنت.",
    descriptionAr:
      "مول على واجهة السالمية البحرية، مربوط بشاطئ المارينا وممشى الكرسنت بجسر مشاة. محلات ومطاعم مطلّة على الماء، وأسهل طلعة تجمع بين التسوّق والبحر.",
    highlightsAr: ["مربوط بشاطئ المارينا", "مطاعم على الواجهة", "ممشى الكرسنت"],
    bestTimeAr: "العصر، وبعدها مشية على البحر",
    setting: "mixed",
    seasonAr: "طول السنة، والشاطئ أحلى بالشتاء",
    tagsAr: ["مكيّف", "بحر", "كافيهات", "مطاعم", "عوائل", "ممشى"],
  },
  {
    slug: "mall-360",
    name: "360 Mall",
    nameAr: "مجمع ٣٦٠",
    category: "shopping",
    area: "Zahra",
    areaAr: "الزهراء",
    lat: 29.2707,
    lng: 47.9459,
    rating: 4.4,
    priceLevel: 3,
    emoji: "🛒",
    taglineAr: "مول راقي على الدائري السادس.",
    descriptionAr:
      "مجمّع أنيق فيه ماركات عالمية ومطاعم وسينما ونادي رياضي، وتصميمه الداخلي مفتوح وفيه نخيل تحت الإضاءة الطبيعية. أهدأ من الأڤنيوز وأرقى في المحلات.",
    highlightsAr: ["ماركات عالمية", "تصميم داخلي مفتوح", "أقل زحمة"],
    bestTimeAr: "أيام الأسبوع، بعد العصر",
    setting: "indoor",
    seasonAr: "طول السنة — مكيّف",
    tagsAr: ["مكيّف", "ماركات", "سينما", "هدوء", "راقي", "مطاعم", "رياضة"],
  },
  {
    slug: "friday-market",
    name: "Friday Market",
    nameAr: "سوق الجمعة",
    category: "shopping",
    area: "Al Rai",
    areaAr: "الري",
    lat: 29.3126,
    lng: 47.9188,
    rating: 4.0,
    priceLevel: 1,
    emoji: "🧺",
    taglineAr: "سوق شعبي مفتوح، كل شي فيه وبسعر.",
    descriptionAr:
      "سوق أسبوعي ضخم في الري، تلقى فيه أثاث وسجاد وعتيقيات وأدوات وحيوانات ونباتات. المساومة جزء من التجربة، والصيد الحلو يبي له صبر ولفّة كاملة.",
    highlightsAr: ["عتيقيات وأنتيكات", "أسعار تنفاوض", "لفّة تاخذ ساعات"],
    bestTimeAr: "نهاية الأسبوع من الصبح",
    setting: "outdoor",
    seasonAr: "من أكتوبر لأبريل، الصبح",
    tagsAr: ["رخيص", "عتيق", "أثاث", "مساومة", "تسوّق", "نهاية الأسبوع"],
  },

  /* ---------------------------------------------------------------------
     عائلة
     --------------------------------------------------------------------- */
  {
    slug: "entertainment-city",
    name: "Entertainment City",
    nameAr: "المدينة الترفيهية",
    category: "family",
    area: "Doha",
    areaAr: "الدوحة",
    lat: 29.3799,
    lng: 47.7757,
    rating: 3.9,
    priceLevel: 2,
    emoji: "🎡",
    taglineAr: "أقدم مدينة ألعاب في الكويت.",
    descriptionAr:
      "مدينة ألعاب كبيرة شمال العاصمة، مقسّمة لعوالم فيها ألعاب للصغار والكبار. جيل كامل من الكويتيين تربّى عليها، ولها طابع خاص لأهل الديرة.",
    highlightsAr: ["ألعاب لكل الأعمار", "مساحات خضراء", "طابع نوستالجي"],
    bestTimeAr: "الأشهر الباردة، وبالليل",
    setting: "outdoor",
    seasonAr: "الأشهر الباردة",
    tagsAr: ["عيال", "ألعاب", "عوائل", "نوستالجيا", "يوم كامل", "رحلة"],
  },
  {
    slug: "kuwait-zoo",
    name: "Kuwait Zoo",
    nameAr: "حديقة حيوان الكويت",
    category: "family",
    area: "Omariya",
    areaAr: "العمرية",
    lat: 29.3011,
    lng: 47.9333,
    rating: 3.8,
    priceLevel: 1,
    emoji: "🦁",
    taglineAr: "طلعة العيال الكلاسيكية.",
    descriptionAr:
      "حديقة حيوان فيها أكثر من مئة نوع، مع مساحات ظليلة وأماكن جلوس. طلعة سهلة ورخيصة مع العيال، وأحلى وقت لها الصبح لمّا تكون الحيوانات نشيطة والجو أبرد.",
    highlightsAr: ["أكثر من ١٠٠ نوع", "أسعار رمزية", "مسارات ظليلة"],
    bestTimeAr: "الصبح بدري في الشتاء",
    setting: "outdoor",
    seasonAr: "من أكتوبر لأبريل، الصبح",
    tagsAr: ["عيال", "حيوانات", "رخيص", "عوائل", "مشي", "تعليمي"],
  },

  /* ---------------------------------------------------------------------
     شواطئ وحدائق
     --------------------------------------------------------------------- */
  {
    slug: "messilah-beach",
    name: "Messilah Beach",
    nameAr: "شاطئ المسيلة",
    category: "outdoors",
    area: "Messilah",
    areaAr: "المسيلة",
    lat: 29.2856,
    lng: 48.0722,
    rating: 4.2,
    priceLevel: 1,
    emoji: "🏖️",
    taglineAr: "رمل واسع وبحر هادي جنوب السالمية.",
    descriptionAr:
      "شاطئ عام واسع ورمله ناعم، أهدأ من شواطئ السالمية وأنسب للعوائل والمشي على البحر. فيه أماكن جلوس وممشى، والغروب منه من أحلى ما في الساحل.",
    highlightsAr: ["رمل ناعم وواسع", "أهدأ من شواطئ السالمية", "غروب على البحر"],
    bestTimeAr: "العصر لين الغروب",
    setting: "outdoor",
    seasonAr: "من أكتوبر لأبريل",
    tagsAr: ["بحر", "رمل", "مشي", "عوائل", "غروب", "هدوء"],
  },
  {
    slug: "khiran",
    name: "Al Khiran",
    nameAr: "الخيران",
    category: "outdoors",
    area: "Al Khiran",
    areaAr: "الخيران",
    lat: 28.6486,
    lng: 48.3766,
    rating: 4.5,
    priceLevel: 2,
    emoji: "⛵",
    taglineAr: "قنوات مائية وشاليهات في أقصى الجنوب.",
    descriptionAr:
      "منتجع في أقصى جنوب الكويت، فيه قنوات مائية محفورة وشاليهات ومرسى قوارب. أبعد طلعة عن العاصمة، بس مياهه أصفى والجو فيه أهدأ — مناسب لنهاية أسبوع كاملة.",
    highlightsAr: ["قنوات مائية وشاليهات", "مياه صافية", "مرسى قوارب"],
    bestTimeAr: "الربيع ونهاية الأسبوع",
    setting: "outdoor",
    seasonAr: "الربيع والشتاء",
    tagsAr: ["بحر", "شاليه", "قوارب", "ربع", "عوائل", "نهاية الأسبوع", "سباحة"],
  },

  /* ---------------------------------------------------------------------
     قهوة ومطاعم
     --------------------------------------------------------------------- */
  {
    slug: "gulf-road-cafes",
    name: "Gulf Road Cafés",
    nameAr: "كافيهات شارع الخليج",
    category: "coffee",
    area: "Gulf Road",
    areaAr: "شارع الخليج",
    lat: 29.3628,
    lng: 48.0006,
    rating: 4.4,
    priceLevel: 2,
    emoji: "☕",
    taglineAr: "قهوة على البحر، من الشويخ لين السالمية.",
    descriptionAr:
      "شارع الخليج مصفوف بكافيهات مطلّة على البحر، من الكرك السريع لين القهوة المختصة. أحلى طريقة تجرّبه إنك تمشي على الكورنيش وتختار مكان يعجبك وقت الغروب.",
    highlightsAr: ["جلسات على البحر", "كرك وقهوة مختصة", "مربوط بالكورنيش"],
    bestTimeAr: "من العصر لين بعد المغرب",
    setting: "outdoor",
    seasonAr: "من أكتوبر لأبريل، وبالليل صيفاً",
    tagsAr: ["قهوة", "كرك", "بحر", "ربع", "هدوء", "سهرة", "ممشى"],
  },
  {
    slug: "marina-crescent",
    name: "Marina Crescent",
    nameAr: "مارينا كريسنت",
    category: "restaurants",
    area: "Salmiya",
    areaAr: "السالمية",
    lat: 29.3413,
    lng: 48.0709,
    rating: 4.4,
    priceLevel: 2,
    emoji: "🍽️",
    taglineAr: "مطاعم على الواجهة، وقعدة على الماء.",
    descriptionAr:
      "ممشى مفتوح على بحر السالمية مصفوف بالمطاعم والكافيهات، ملتصق بمارينا مول ومطلّ على المرسى. من أشهر أماكن العشا في الكويت، خصوصاً بالشتاء لمّا تنفتح الجلسات الخارجية.",
    highlightsAr: ["جلسات على الماء", "مطاعم متنوّعة", "ممشى المرسى"],
    bestTimeAr: "العشاء، وخصوصاً نهاية الأسبوع",
    setting: "mixed",
    seasonAr: "طول السنة، والجلسات الخارجية من أكتوبر لأبريل",
    tagsAr: ["عشا", "بحر", "مطاعم", "كافيهات", "موعد", "عوائل", "ربع", "ممشى"],
  },
  {
    slug: "fish-market",
    name: "Sharq Fish Market",
    nameAr: "سوق السمك",
    category: "restaurants",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3812,
    lng: 47.9945,
    rating: 4.3,
    priceLevel: 2,
    emoji: "🐟",
    taglineAr: "تختار سمكتك، وتاكلها طازجة.",
    descriptionAr:
      "سوق السمك على واجهة الشرق البحرية، تلقى فيه صيد اليوم من الزبيدي والهامور والروبيان. تختار بنفسك وتشتري، وفيه مطاعم جنبه تنظّفه وتشويه لك على طول — أقرب شي لتجربة الأكل الكويتي الأصلي.",
    highlightsAr: ["صيد اليوم طازج", "زبيدي وهامور وروبيان", "يشوونه لك بالمكان"],
    bestTimeAr: "الصبح للصيد الطازج، والغدا بعده",
    setting: "mixed",
    seasonAr: "طول السنة",
    tagsAr: ["سمك", "أكل كويتي", "غدا", "طازج", "بحر", "تراث", "عوائل"],
  },
  {
    slug: "hamad-al-mubarak-street",
    name: "Hamad Al Mubarak Street",
    nameAr: "شارع حمد المبارك",
    category: "coffee",
    area: "Salmiya",
    areaAr: "السالمية",
    lat: 29.3345,
    lng: 48.0692,
    rating: 4.2,
    priceLevel: 2,
    emoji: "☕",
    taglineAr: "شارع الكافيهات في السالمية.",
    descriptionAr:
      "شارع تجاري مليان كافيهات ومحلات حلا ومطاعم صغيرة، وأغلبها بجلسات خارجية. مكان القهوة بعد الدوام والسهرة القصيرة، وأهدى من زحمة شارع سالم المبارك اللي جنبه.",
    highlightsAr: ["كافيهات بجلسات خارجية", "محلات حلا", "أهدى من الشوارع المجاورة"],
    bestTimeAr: "بعد العصر، وبالليل",
    setting: "mixed",
    seasonAr: "طول السنة، والجلسات الخارجية بالشتاء",
    tagsAr: ["قهوة", "كافيهات", "حلا", "هدوء", "ربع", "سهرة", "موعد"],
  },
  {
    slug: "tunis-street",
    name: "Tunis Street",
    nameAr: "شارع تونس",
    category: "restaurants",
    area: "Hawalli",
    areaAr: "حولي",
    lat: 29.3336,
    lng: 48.0206,
    rating: 4.1,
    priceLevel: 1,
    emoji: "🍽️",
    taglineAr: "شارع الأكل الشعبي في حولي.",
    descriptionAr:
      "من أشهر شوارع الأكل في الكويت، مليان مطاعم شامية ومصرية وهندية وحلويات، وأغلبها بأسعار بسيطة. مكان تجرّب فيه أكل من كل الجاليات في لفّة وحدة.",
    highlightsAr: ["مطبخ شامي ومصري وهندي", "أسعار بسيطة", "مفتوح لوقت متأخر"],
    bestTimeAr: "بالليل، خصوصاً نهاية الأسبوع",
    setting: "mixed",
    seasonAr: "طول السنة — أحلى بالليل",
    tagsAr: ["شاورما", "فطور", "حلويات", "رخيص", "شامي", "مصري", "هندي", "سهرة", "سناك"],
  },
];

export function getPlace(slug: string): Place | undefined {
  return places.find((p) => p.slug === slug);
}

export function getFeaturedPlaces(): Place[] {
  return places.filter((p) => p.featured);
}

export function categoryGradient(id: CategoryId): string {
  return getCategory(id)?.gradient ?? "from-sand-600 via-sand-700 to-sand-900";
}

/**
 * Stable 0-3 derived from the slug. Places in one category share a single
 * hand-drawn scene, so without this every تسوّق card rendered the identical
 * image; the variant drives a mirrored or shifted composition plus a
 * different gradient direction, making each place's art its own.
 *
 * The constants (×38 mod 65521) were chosen so that no two places in the
 * same category land on the same variant with the current dataset — verify
 * again if that ever seems off after adding places.
 */
export function placeVariant(slug: string): 0 | 1 | 2 | 3 {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 38 + slug.charCodeAt(i)) % 65521;
  return (h % 4) as 0 | 1 | 2 | 3;
}

const GRADIENT_DIRECTION = [
  "bg-gradient-to-br",
  "bg-gradient-to-tr",
  "bg-gradient-to-b",
  "bg-gradient-to-bl",
] as const;

/**
 * The place hero: one hue per category, on the ink ramp's own lightnesses.
 *
 * The first version of this took each category's ramp directly, and the ramps
 * were not comparable — coral sits at chroma 0.21, sea at 0.086 — so the same
 * hero read twice as loud on a restaurant as on a landmark, and the heroes as
 * a group ran far more saturated than any other route. Dropping to ink fixed
 * the inconsistency by removing the variable.
 *
 * These ramps are generated instead of picked (see --color-hero-* in
 * globals.css): identical lightness and identical chroma at every step, hue
 * the only difference. So the black point and the white-stroke contrast the
 * monochrome pass established both survive, and a category is once again
 * recognisable before you have read anything.
 *
 * Written out in full because Tailwind scans for literal class names — built
 * from a template these would never be emitted.
 */
const HERO_GRADIENT: Record<CategoryId, string> = {
  landmarks: "from-hero-landmarks-1 via-hero-landmarks-2 to-hero-landmarks-3",
  restaurants: "from-hero-restaurants-1 via-hero-restaurants-2 to-hero-restaurants-3",
  fastfood: "from-hero-fastfood-1 via-hero-fastfood-2 to-hero-fastfood-3",
  coffee: "from-hero-coffee-1 via-hero-coffee-2 to-hero-coffee-3",
  outdoors: "from-hero-outdoors-1 via-hero-outdoors-2 to-hero-outdoors-3",
  shopping: "from-hero-shopping-1 via-hero-shopping-2 to-hero-shopping-3",
  culture: "from-hero-culture-1 via-hero-culture-2 to-hero-culture-3",
  family: "from-hero-family-1 via-hero-family-2 to-hero-family-3",
};

export function placeGradient(place: Pick<Place, "slug" | "category">): string {
  return `${GRADIENT_DIRECTION[placeVariant(place.slug)]} ${HERO_GRADIENT[place.category]}`;
}

/**
 * Tile and mark colour for a place's icon, so a thumbnail carries its
 * category before the name has been read. Literal strings for the same
 * reason as HERO_GRADIENT — Tailwind only emits classes it can see.
 */
const CATEGORY_TINT: Record<CategoryId, string> = {
  landmarks: "bg-cat-landmarks-tint text-cat-landmarks-ink",
  restaurants: "bg-cat-restaurants-tint text-cat-restaurants-ink",
  fastfood: "bg-cat-fastfood-tint text-cat-fastfood-ink",
  coffee: "bg-cat-coffee-tint text-cat-coffee-ink",
  outdoors: "bg-cat-outdoors-tint text-cat-outdoors-ink",
  shopping: "bg-cat-shopping-tint text-cat-shopping-ink",
  culture: "bg-cat-culture-tint text-cat-culture-ink",
  family: "bg-cat-family-tint text-cat-family-ink",
};

export function categoryTint(id: CategoryId): string {
  return CATEGORY_TINT[id];
}

export function getCategory(id: CategoryId): Category | undefined {
  return categories.find((c) => c.id === id);
}

export function countByCategory(id: CategoryId): number {
  return places.filter((p) => p.category === id).length;
}

/** Great-circle distance in kilometres. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
