/**
 * The areas of Kuwait, as a way in.
 *
 * «وين الطلعة اليوم؟» is answered by a category («أبي قهوة») or by a place
 * («ودّيني الأفنيوز»), and the site had both. It is also answered by a part of
 * town — «أنا بالسالمية» — which is the way people actually say it, and the
 * catalogue carried that information all along in `areaAr` without ever
 * offering it as a door.
 *
 * NOTHING HERE MAY IMPORT THE CATALOGUE — same rule as `place-kit.ts` and
 * `wain-hub.ts`, same reason: this is reachable from the hub, the hub is
 * reachable from the search button, and the search button is in the root
 * layout. `npm run audit:js` fails if place records follow it there.
 *
 * So `ar` is the join key and it is a STRING MATCH against `Place.areaAr`.
 * That is a seam two files can drift across, which is why
 * `npm run audit:areas` exists: it reads the areas from this file and the
 * areas from `places.ts`, each by its own path, and fails naming any that is
 * in one and not the other. An area with no places would be a door onto
 * nothing — the same objection `wain-hub.ts` records against a «طلباتي» row —
 * and a place whose area has no entry would be unreachable from here.
 *
 * `hero` is the place whose drawing the card wears. It must be a place IN
 * this area, which the audit also checks: a card for حولي showing the Avenues
 * would be the «one of those photographs» problem from `photos.ts` drawn
 * instead of photographed. Where that place has its own scene in `PlaceArt`
 * the card gets it; otherwise it falls back to the place's category art, the
 * same chain every place page already uses.
 */

export interface Area {
  /** URL-safe, Latin — it appears in `?area=` and must survive a WAF. */
  id: string;
  /** EXACTLY `Place.areaAr`. The join key; `audit:areas` holds them together. */
  ar: string;
  /** For an MCP client, and for anyone whose working language is not Arabic. */
  en: string;
  /** One line, Kuwaiti, saying what the area is FOR — not where it is. */
  blurbAr: string;
  /** A place in this area whose drawing the card wears. */
  hero: string;
}

/**
 * Ordered by how much of the catalogue each holds, which is the closest
 * honest proxy for «famous» this file has. A hand-ranked order would be an
 * opinion that nothing could check; this one is a fact about the data, and it
 * re-sorts itself the day a place is added.
 */
export const AREAS: Area[] = [
  {
    id: "kuwait-city",
    ar: "مدينة الكويت",
    en: "Kuwait City",
    blurbAr: "العاصمة: الأبراج والسوق والمتاحف، كلها بمشوار واحد.",
    hero: "kuwait-towers",
  },
  {
    id: "salmiya",
    ar: "السالمية",
    en: "Salmiya",
    blurbAr: "بحر ومولات وكافيهات، وأكثر منطقة فيها حركة.",
    hero: "marina-beach",
  },
  {
    id: "gulf-road",
    ar: "شارع الخليج",
    en: "Gulf Road",
    blurbAr: "من الشويخ لين السالمية، والبحر معك على طول.",
    hero: "green-island",
  },
  {
    id: "sharq",
    ar: "شرق",
    en: "Sharq",
    blurbAr: "بيوت الطين القديمة، وأول واجهة بحر عرفتها الكويت.",
    hero: "amricani-cultural-centre",
  },
  {
    id: "hawally",
    ar: "حولي",
    en: "Hawally",
    blurbAr: "أكل شعبي وأسواق، وبيت العثمان بوسطها.",
    hero: "bait-al-othman",
  },
  {
    id: "al-rai",
    ar: "الري",
    en: "Al Rai",
    blurbAr: "الأفنيوز وسوق الجمعة، على بعد دقايق من بعض.",
    hero: "the-avenues",
  },
  {
    id: "khiran",
    ar: "الخيران",
    en: "Khiran",
    blurbAr: "أقصى الجنوب: قنوات وشاليهات وهدوء.",
    hero: "sabah-al-ahmad-sea-city",
  },
  {
    id: "shuwaikh",
    ar: "الشويخ",
    en: "Shuwaikh",
    blurbAr: "أكبر مجمّع متاحف في الشرق الأوسط، بمبنى واحد.",
    hero: "abdullah-al-salem-cultural-centre",
  },
  {
    id: "fahaheel",
    ar: "الفحيحيل",
    en: "Fahaheel",
    blurbAr: "الكوت والنافورة الراقصة، على بحر الجنوب.",
    hero: "al-kout-mall",
  },
  {
    id: "jabriya",
    ar: "الجابرية",
    en: "Jabriya",
    blurbAr: "متحف طارق رجب، كنز خاص من الفن الإسلامي.",
    hero: "tareq-rajab-museum",
  },
  {
    id: "messila",
    ar: "المسيلة",
    en: "Messila",
    blurbAr: "رمل واسع وبحر هادي جنوب السالمية.",
    hero: "messilah-beach",
  },
  {
    id: "shaab",
    ar: "الشعب",
    en: "Shaab",
    blurbAr: "أقرب بحر لأهل العاصمة.",
    hero: "al-shaab-beach",
  },
  {
    id: "mishref",
    ar: "مشرف",
    en: "Mishref",
    blurbAr: "وين تصير المعارض الكبيرة كلها.",
    hero: "kuwait-fairground",
  },
  {
    id: "bneid-al-gar",
    ar: "بنيد القار",
    en: "Bneid Al Gar",
    blurbAr: "قصر السلام، من دار ضيافة لمتحف.",
    hero: "al-salam-palace",
  },
  {
    id: "qadsiya",
    ar: "القادسية",
    en: "Qadsiya",
    blurbAr: "بيت المرايا، وما فيه مثله بالعالم.",
    hero: "mirror-house",
  },
  {
    id: "zahra",
    ar: "الزهراء",
    en: "Zahra",
    blurbAr: "مجمع ٣٦٠ على الدائري السادس.",
    hero: "mall-360",
  },
  {
    id: "doha",
    ar: "الدوحة",
    en: "Doha",
    blurbAr: "المدينة الترفيهية، أقدم ألعاب في الكويت.",
    hero: "entertainment-city",
  },
  {
    id: "omariya",
    ar: "العمرية",
    en: "Omariya",
    blurbAr: "حديقة الحيوان، طلعة العيال الكلاسيكية.",
    hero: "kuwait-zoo",
  },
  {
    id: "wafra",
    ar: "الوفرة",
    en: "Wafra",
    blurbAr: "مزارع وخضرة وسط الصحراء.",
    hero: "wafra-farms",
  },
  {
    id: "subiya",
    ar: "الصبية",
    en: "Subiya",
    blurbAr: "جسر الشيخ جابر، ستة وثلاثين كيلومتر فوق البحر.",
    hero: "sheikh-jaber-causeway",
  },
  {
    id: "gulf",
    ar: "الخليج العربي",
    en: "The Gulf",
    blurbAr: "جزيرة فيلكا، على بعد رحلة عبّارة.",
    hero: "failaka-island",
  },
];

/** The area with this id, if there is one. */
export function getArea(id: string): Area | undefined {
  return AREAS.find((a) => a.id === id);
}

/** The area whose `ar` is exactly this — the join, in the one direction used. */
export function areaByName(ar: string): Area | undefined {
  return AREAS.find((a) => a.ar === ar);
}
