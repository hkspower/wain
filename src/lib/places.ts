export type CategoryId =
  | "landmarks"
  | "restaurants"
  | "fastfood"
  | "coffee"
  | "outdoors"
  | "shopping"
  | "culture"
  | "family";

export interface Category {
  id: CategoryId;
  ar: string;
  en: string;
  /** Key consumed by <CategoryIcon /> */
  icon: string;
  blurbAr: string;
}

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
  gradient: string;
  taglineAr: string;
  descriptionAr: string;
  highlightsAr: string[];
  bestTimeAr: string;
  featured?: boolean;
}

/** Ordered the way the category rail reads on the home page. */
export const categories: Category[] = [
  {
    id: "landmarks",
    ar: "معالم الكويت",
    en: "Landmarks",
    icon: "tower",
    blurbAr: "أيقونات المدينة",
  },
  {
    id: "restaurants",
    ar: "مطاعم",
    en: "Restaurants",
    icon: "cutlery",
    blurbAr: "غدا وعشا",
  },
  {
    id: "fastfood",
    ar: "وجبات سريعة",
    en: "Fast bites",
    icon: "burger",
    blurbAr: "على السريع",
  },
  {
    id: "coffee",
    ar: "قهوة",
    en: "Coffee",
    icon: "coffee",
    blurbAr: "قهوة وچاي",
  },
  {
    id: "outdoors",
    ar: "شواطئ وحدائق",
    en: "Outdoors",
    icon: "palm",
    blurbAr: "بحر وخضرة",
  },
  {
    id: "shopping",
    ar: "تسوّق",
    en: "Shopping",
    icon: "bag",
    blurbAr: "أسواق ومولات",
  },
  {
    id: "culture",
    ar: "ثقافة",
    en: "Culture",
    icon: "masks",
    blurbAr: "متاحف وفنون",
  },
  {
    id: "family",
    ar: "عائلة",
    en: "Family",
    icon: "ferris",
    blurbAr: "طلعة العيال",
  },
];

export const places: Place[] = [
  {
    slug: "kuwait-towers",
    name: "Kuwait Towers",
    nameAr: "أبراج الكويت",
    category: "landmarks",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3897,
    lng: 48.0022,
    rating: 4.7,
    priceLevel: 2,
    emoji: "🗼",
    gradient: "from-sky-400 via-cyan-500 to-sea-700",
    taglineAr: "أيقونة الكويت، على ارتفاع ١٨٧ متر فوق الخليج.",
    descriptionAr:
      "الأبراج الثلاثة على ساحل الخليج العربي هي أشهر معلم في الكويت. اطلع للكرة الدوّارة وشوف المدينة والبحر من ٣٦٠ درجة، وإذا جيت وقت المغرب بتشوف الأبراج وهي تضوّي.",
    highlightsAr: ["كرة المشاهدة ٣٦٠°", "مطعم دوّار", "ممشى على البحر"],
    bestTimeAr: "وقت الغروب، لمّا تضوّي الأبراج",
    featured: true,
  },
  {
    slug: "souq-al-mubarakiya",
    name: "Souq Al-Mubarakiya",
    nameAr: "سوق المباركية",
    category: "shopping",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3759,
    lng: 47.9774,
    rating: 4.8,
    priceLevel: 1,
    emoji: "🏮",
    gradient: "from-amber-400 via-orange-500 to-coral-600",
    taglineAr: "قرنين من التجارة والبهارات والحكايات.",
    descriptionAr:
      "من أقدم أسواق الكويت. أزقّة مليانة بسطات بهارات ودكاكين ذهب وبياعين تمر ومطاعم صغيرة. يا ليتك تجي وأنت جوعان، وتختم السهرة بچاي في الحوش القديم.",
    highlightsAr: ["أكل كويتي أصيل", "سوق البهارات والذهب", "أحواش تراثية"],
    bestTimeAr: "بالليل، بعد الخامسة",
    featured: true,
  },
  {
    slug: "al-shaheed-park",
    name: "Al Shaheed Park",
    nameAr: "حديقة الشهيد",
    category: "outdoors",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3689,
    lng: 47.9884,
    rating: 4.6,
    priceLevel: 1,
    emoji: "🌳",
    gradient: "from-lime-400 via-emerald-500 to-palm-700",
    taglineAr: "الرئة الخضراء للعاصمة.",
    descriptionAr:
      "أكبر حديقة في الكويت، فيها حدائق نباتية وبحيرات ومتحفين ومسارات مشي وحفلات في الهواء الطلق. مكان ممتاز لمشية عصرية في قلب المدينة.",
    highlightsAr: ["حدائق نباتية", "متحف الحبيتات والذاكرة", "مسار مشي حول البحيرة"],
    bestTimeAr: "الصبح بدري أو بعد المغرب",
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
    gradient: "from-coral-400 via-coral-500 to-coral-700",
    taglineAr: "مطعم كويتي عريق على شارع الخليج.",
    descriptionAr:
      "من أقدم وأشهر المطاعم الكويتية، معروف بالمشاوي والمقبّلات والأكل الشامي والكويتي. مكان يعرفه كل أهل الكويت، ومناسب للعزايم العائلية.",
    highlightsAr: ["مشاوي ومقبّلات", "إطلالة على شارع الخليج", "مناسب للعوائل"],
    bestTimeAr: "العشاء، ويفضّل الحجز",
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
    gradient: "from-amber-500 via-orange-600 to-coral-800",
    taglineAr: "أكل كويتي في أجواء الفريج القديم.",
    descriptionAr:
      "مطعم كويتي بديكور تراثي يرجّعك للفريج القديم. القائمة كويتية أصيلة من مچبوس ومرقوق وتشريب، والجلسة نفسها جزء من التجربة.",
    highlightsAr: ["مچبوس ومرقوق", "ديكور تراثي", "أجواء كويتية"],
    bestTimeAr: "الغدا، خصوصاً نهاية الأسبوع",
  },
  {
    slug: "mubarakiya-tea-houses",
    name: "Mubarakiya Tea Houses",
    nameAr: "مقاهي المباركية",
    category: "coffee",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3765,
    lng: 47.9781,
    rating: 4.7,
    priceLevel: 1,
    emoji: "☕",
    gradient: "from-sand-400 via-amber-600 to-coral-800",
    taglineAr: "چاي وقهوة عربية في حوش السوق.",
    descriptionAr:
      "في قلب المباركية أحواش وجلسات شعبية تقدّم الچاي والقهوة العربية والكرك. أرخص وأصدق تجربة قهوة في الكويت، وأحلى مكان تقعد فيه بعد جولة السوق.",
    highlightsAr: ["چاي كرك", "قهوة عربية وهيل", "جلسات شعبية"],
    bestTimeAr: "العصر وبعد المغرب",
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
    gradient: "from-yellow-400 via-orange-500 to-coral-600",
    taglineAr: "شارع الأكل السريع والسهرات في السالمية.",
    descriptionAr:
      "أشهر شارع في السالمية، مليان مطاعم وجبات سريعة ومحلات حلا وكافيهات. مكان الطلعة السريعة إذا تبي تاكل شي على الماشي وتتمشى بعدها.",
    highlightsAr: ["برجر ووجبات سريعة", "محلات حلا وآيس كريم", "مفتوح لوقت متأخر"],
    bestTimeAr: "بالليل، بعد الثامنة",
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
    gradient: "from-fuchsia-400 via-purple-500 to-indigo-600",
    taglineAr: "مدينة داخل مدينة — أكبر مول في الخليج.",
    descriptionAr:
      "أكثر من ١١٠٠ محل موزّعة على مناطق مختلفة، كل وحدة لها طابعها. من الماركات العالمية في البرستيج إلى الجراند أفنيو اللي يشبه السوق المفتوح. يوم كامل ما يكفيه.",
    highlightsAr: ["مناطق تسوّق متنوّعة", "مطاعم عالمية", "ممشى داخلي مكيّف"],
    bestTimeAr: "الصبح في أيام الدوام، عشان الزحمة",
  },
  {
    slug: "souq-sharq",
    name: "Souq Sharq",
    nameAr: "سوق شرق",
    category: "shopping",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3811,
    lng: 47.9903,
    rating: 4.4,
    priceLevel: 2,
    emoji: "⛵",
    gradient: "from-sky-300 via-sea-400 to-sea-700",
    taglineAr: "مول على البحر مع مارينا وقوارب.",
    descriptionAr:
      "مول على الواجهة البحرية مع مارينا وقوارب راسية وكافيهات مطلّة على الماء. مكان هادي للتسوّق ومشية على البحر في نفس الطلعة.",
    highlightsAr: ["إطلالة على المارينا", "كافيهات على البحر", "ممشى بحري"],
    bestTimeAr: "العصر، قبل الغروب",
  },
  {
    slug: "grand-mosque",
    name: "The Grand Mosque",
    nameAr: "المسجد الكبير",
    category: "culture",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3759,
    lng: 47.986,
    rating: 4.9,
    priceLevel: 1,
    emoji: "🕌",
    gradient: "from-teal-400 via-sea-500 to-sea-800",
    taglineAr: "أكبر مساجد الكويت، وتحفة في الفن الإسلامي.",
    descriptionAr:
      "على مساحة ٤٥ ألف متر مربع، المسجد الكبير يبهرك بالخط العربي والزخارف الأندلسية والقبة الضخمة والأحواش الهادية. فيه جولات مجانية بمرشد لكل الزوّار.",
    highlightsAr: ["جولات مجانية بمرشد", "خط عربي وقبة مذهلة", "أحواش هادية"],
    bestTimeAr: "مواعيد الجولات الصباحية",
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
    gradient: "from-cyan-300 via-sky-400 to-blue-600",
    taglineAr: "رمل ناعم ومطاعم على بحر السالمية.",
    descriptionAr:
      "شاطئ نظيف ومناسب للعوائل، مربوط بمول المارينا بجسر مشاة. اسبح أو استأجر كاياك، أو بس تمشّى على الكرسنت وقت الذهبي واختر كافيه على البحر.",
    highlightsAr: ["سباحة وكاياك", "كافيهات على الواجهة", "ممشى المارينا كرسنت"],
    bestTimeAr: "العصر المتأخر",
    featured: true,
  },
  {
    slug: "jacc",
    name: "Sheikh Jaber Cultural Centre",
    nameAr: "مركز الشيخ جابر الثقافي",
    category: "culture",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3662,
    lng: 47.9885,
    rating: 4.8,
    priceLevel: 2,
    emoji: "🎭",
    gradient: "from-slate-400 via-slate-500 to-sea-900",
    taglineAr: "دار الأوبرا في الخليج.",
    descriptionAr:
      "مجمّع مسارح وقاعات موسيقية بتصميم مغطّى بزخارف هندسية إسلامية. احضر أوبرا أو حفل سيمفوني، أو بس تعال شوف المعمار وهو ينعكس على المسطحات المائية.",
    highlightsAr: ["عروض عالمية", "معمار مميّز", "إضاءة مسائية"],
    bestTimeAr: "ليالي العروض — احجز مقدّماً",
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
    gradient: "from-blue-400 via-indigo-500 to-violet-700",
    taglineAr: "آثار يونانية قديمة، على بعد رحلة عبّارة.",
    descriptionAr:
      "كانت موطن حضارة من العصر البرونزي وفيها قلعة هلنستية. فيلكا تجمع بين الآثار والشواطئ الهادية. خذ العبّارة من السالمية، لف على الآثار، واقعد لشواء على البحر.",
    highlightsAr: ["آثار هلنستية", "رحلات عبّارة يومية", "شواطئ هادية"],
    bestTimeAr: "الربيع والشتاء، نهاية الأسبوع",
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
    gradient: "from-zinc-300 via-slate-400 to-slate-700",
    taglineAr: "بيت مغطّى بالمرايا من داخله وخارجه.",
    descriptionAr:
      "الفنانة ليديا القطان قضت عقود وهي تغطّي كل سطح في بيت عائلتها بفسيفساء المرايا. النتيجة وحدة من أغرب المتاحف في الشرق الأوسط، والزيارة بموعد مسبق ومع جولة شخصية.",
    highlightsAr: ["غرف فسيفساء المرايا", "جولة مع عائلة الفنانة", "تجربة فريدة في الخليج"],
    bestTimeAr: "بموعد مسبق",
  },
  {
    slug: "aqua-park",
    name: "Aqua Park Kuwait",
    nameAr: "أكوا بارك",
    category: "family",
    area: "Kuwait City",
    areaAr: "مدينة الكويت",
    lat: 29.3856,
    lng: 47.9958,
    rating: 4.3,
    priceLevel: 2,
    emoji: "🎢",
    gradient: "from-cyan-400 via-teal-400 to-emerald-600",
    taglineAr: "أول مدينة ألعاب مائية في الخليج، جنب الأبراج.",
    descriptionAr:
      "زحاليق ومسابح أمواج وأنهار كسولة ممتدة على الواجهة البحرية. طلعة عائلية سهلة، مع أماكن أكل وجلسات مظلّلة، وكلها جنب أبراج الكويت.",
    highlightsAr: ["مسبح أمواج وزحاليق", "مناطق ألعاب للصغار", "موقع على البحر"],
    bestTimeAr: "الصبح في أيام الدوام صيفاً",
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
    gradient: "from-amber-500 via-sand-600 to-sand-900",
    taglineAr: "كنز خاص من الفن الإسلامي.",
    descriptionAr:
      "آلاف القطع من الخط العربي والخزف والمجوهرات والآلات الموسيقية، مجموعة على مدى خمسين سنة. متحف هادي ومنسّق بعناية، ومعروف إنه نجا من الغزو وهو مخبّى خلف جدار وهمي.",
    highlightsAr: ["خط عربي نادر", "مجوهرات ذهب وفضة", "قصة مذهلة"],
    bestTimeAr: "عصر أيام الدوام",
  },
  {
    slug: "green-island",
    name: "Green Island",
    nameAr: "الجزيرة الخضراء",
    category: "family",
    area: "Gulf Road",
    areaAr: "شارع الخليج",
    lat: 29.3652,
    lng: 48.0076,
    rating: 4.2,
    priceLevel: 1,
    emoji: "🏝️",
    gradient: "from-emerald-400 via-green-500 to-teal-700",
    taglineAr: "جزيرة صناعية فيها حدائق وبحيرات.",
    descriptionAr:
      "أول جزيرة صناعية في الخليج، مربوطة بالكورنيش بممشى. مساحات خضراء وبحيرة سباحة وبرج مشاهدة ومدرّج، تكفي لنص يوم مع العيال.",
    highlightsAr: ["بحيرة سباحة", "برج مشاهدة", "مساحات خضراء للتنزّه"],
    bestTimeAr: "الأشهر الباردة، وقت العصر",
  },
];

export function getPlace(slug: string): Place | undefined {
  return places.find((p) => p.slug === slug);
}

export function getFeaturedPlaces(): Place[] {
  return places.filter((p) => p.featured);
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

/** Arabic-Indic digits, so numbers match the rest of the UI. */
export function toArabicDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}
