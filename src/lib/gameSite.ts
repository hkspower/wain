/**
 * Every word on the Gulf Road Nights site, in both languages, in one
 * place.
 *
 * ONE PLACE is the whole design. A bilingual page written the obvious
 * way — an English block, then an Arabic block, somewhere else in the
 * markup — drifts within a week: somebody fixes a number in the English
 * and the Arabic keeps quoting the old one, and nobody notices because
 * the two halves are never read by the same person. Here a fact exists
 * once, as a pair, and tests/site.mjs fails if either half is missing.
 *
 * What is NOT here is anything the game already knows. The cars, the
 * rivals and the race lengths are imported from src/game — the same
 * arrays the game itself ships — so the roster on the website cannot
 * disagree with the roster in the showroom. Only prose lives in this
 * file.
 */

/** A fact, said twice. Both halves are required; neither may be empty. */
export interface Bi {
  en: string;
  ar: string;
}

export interface Shot {
  /** File under public/game/. */
  src: string;
  alt: Bi;
  caption: Bi;
}

export interface Pillar {
  icon: string;
  title: Bi;
  body: Bi;
}

export interface Faq {
  q: Bi;
  a: Bi;
}

export const NAME: Bi = {
  en: "Gulf Road Nights",
  ar: "ليالي شارع الخليج",
};

export const TAGLINE: Bi = {
  en: "Kuwait's corniche, from midnight to ten to six.",
  ar: "كورنيش الكويت، من منتصف الليل إلى الساعة ٥:٥٠.",
};

export const INTRO: Bi = {
  en:
    "An 8.5 km lap of Arabian Gulf Street and the Second Ring Road, driven at " +
    "the hour Kuwait actually drives it. Flash your headlights at someone who " +
    "is worth the trouble, agree a distance and a stake, and settle it between " +
    "the roundabouts. It runs in a browser — there is nothing to install.",
  ar: "لفة طولها ٨٫٥ كيلومتر على شارع الخليج العربي والدائري الثاني، في الساعة التي تقاد فيها فعلا. غمّض أضويتك لأحدهم يستاهل، اتفقوا على المسافة والمبلغ، وخلّصوها بين الدوارات. تشتغل داخل المتصفح — ما في شي تنزّله.",
};

/**
 * The gallery, in the order it reads.
 *
 * Every one of these is a real frame from the game, taken by
 * tools/shots/capture.mjs at a pinned hour and a pinned place on the lap
 * — not a render, not a mock-up and not a lucky screenshot. `npm run
 * shots` regenerates the lot, and scripts/build-site-images.mjs is what
 * turns them into the WebP files this list names.
 */
export const GALLERY: Shot[] = [
  {
    src: "night.webp",
    alt: { en: "The corniche at half past two in the morning", ar: "الكورنيش الساعة ٢:٣٠ فجرا" },
    caption: {
      en: "Half past two on Arabian Gulf Street — the hour the game is set at.",
      ar: "الثانية والنصف فجرا على شارع الخليج العربي — الساعة اللي تدور فيها اللعبة.",
    },
  },
  {
    src: "towers.webp",
    alt: { en: "Kuwait Towers on the approach", ar: "أبراج الكويت على الطريق" },
    caption: {
      en: "Kuwait Towers, on the approach. The landmarks are where they are in life.",
      ar: "أبراج الكويت على الطريق. المعالم في مواضعها الحقيقية.",
    },
  },
  {
    src: "rain.webp",
    alt: { en: "Rain on the coastal road", ar: "مطر على الطريق الساحلي" },
    caption: {
      en: "Rain. The road soaks over about a minute and gives grip back just as slowly.",
      ar: "مطر. الشارع يتشرّب خلال دقيقة تقريبا، ويرجع التماسك ببطء مثله.",
    },
  },
  {
    src: "city.webp",
    alt: { en: "The city skyline behind the road", ar: "أفق المدينة خلف الشارع" },
    caption: {
      en: "Kuwait City behind the barrier, lit the way it is lit at night.",
      ar: "مدينة الكويت خلف الحاجز، بإضاءتها الليلية.",
    },
  },
  {
    src: "coast.webp",
    alt: { en: "The seaward leg with the Gulf on the left", ar: "المقطع الساحلي والخليج على اليسار" },
    caption: {
      en: "The seaward leg. The water is on your left for the first 3.4 km.",
      ar: "المقطع الساحلي. البحر على يسارك أول ٣٫٤ كيلومتر.",
    },
  },
  {
    src: "love.webp",
    alt: { en: "Love Street at its own sign", ar: "شارع الحب عند لوحته" },
    caption: {
      en: "Love Street, at its own sign.",
      ar: "شارع الحب، عند لوحته.",
    },
  },
  {
    src: "station.webp",
    alt: { en: "Pulling on to the forecourt of a petrol station", ar: "الدخول إلى محطة وقود" },
    caption: {
      en: "The pumps in Shuwaikh. Fuel is real: the tank empties and you stop to fill it.",
      ar: "محطة الشويخ. الوقود حقيقي: التانكي ينقص ولازم تقف وتعبّي.",
    },
  },
  {
    src: "drift.webp",
    alt: { en: "The car sideways on the drift plaza", ar: "في ساحة الدرِفت" },
    caption: {
      en: "Sideways. Grip, load transfer and the handbrake are all solved, not animated.",
      ar: "عرضي. التماسك ونقل الحمل والهاند بريك محسوبة فيزيائيا، مو حركة جاهزة.",
    },
  },
  {
    src: "ring.webp",
    alt: { en: "The Second Ring Road through Mansuriya", ar: "الدائري الثاني عبر المنصورية" },
    caption: {
      en: "The Second Ring through Mansuriya — the way back from the point.",
      ar: "الدائري الثاني عبر المنصورية — طريق الرجعة من رأس الأرض.",
    },
  },
  {
    src: "dawn.webp",
    alt: { en: "First light over the road", ar: "أول ضوء على الشارع" },
    caption: {
      en: "05:50. The night is over — roll home.",
      ar: "٥:٥٠. خلص الليل — روح.",
    },
  },
  {
    src: "menu.webp",
    alt: { en: "The main menu with two cars rolling past", ar: "القائمة الرئيسية وسيارتان تمرّان" },
    caption: {
      en: "The menu is the game running: two cars on the corniche, not a picture of them.",
      ar: "القائمة هي اللعبة نفسها شغالة: سيارتان على الكورنيش، مو صورة لهما.",
    },
  },
  {
    src: "towersday.webp",
    alt: { en: "The same view by day", ar: "نفس المنظر نهارا" },
    caption: {
      en: "The same frame in daylight. The world is open around the clock; racing is not.",
      ar: "نفس اللقطة بضوء النهار. العالم مفتوح طوال اليوم؛ السباق لا.",
    },
  },
];

/** What the game is, in four claims. */
export const PILLARS: Pillar[] = [
  {
    icon: "🕛",
    title: { en: "It runs on Kuwait's clock", ar: "تمشي على توقيت الكويت" },
    body: {
      en:
        "The sky is the real sky over Kuwait, to the second, and racing is open " +
        "from midnight until 05:50 — because that is when this happens. Drive the " +
        "road at any hour you like; you will not find anyone to race at four in " +
        "the afternoon. If your afternoon is Kuwait's afternoon, the settings let " +
        "you pin the hour.",
      ar: "السماء هي سماء الكويت الحقيقية بالثانية، والسباق مفتوح من منتصف الليل إلى ٥:٥٠ — لأن هذا وقته. سق الشارع في أي ساعة تبي؛ بس ما راح تلقى أحد يسابقك الساعة أربع العصر. وإذا كان عصرك هو عصر الكويت، الإعدادات تخليك تثبّت الساعة.",
    },
  },
  {
    icon: "💡",
    title: { en: "Flash them, then settle it", ar: "غمّض له، وبعدها خلّصوها" },
    body: {
      en:
        "Pull within 60 m of a rival and flash your headlights three times inside " +
        "three seconds. They answer, you agree a length and a stake, and the two " +
        "of you go. Spirit Points drain from whoever is behind, so a battle is " +
        "over when someone breaks — not when a lap counter says so.",
      ar: "قرّب لمسافة ٦٠ متر من الخصم وغمّض أضويتك ثلاث مرات خلال ثلاث ثوان. يرد عليك، تتفقون على المسافة والمبلغ، وتنطلقون. نقاط العزيمة تنقص من اللي وراء، فالمواجهة تنتهي لما ينكسر أحدهم — مو لما يخلص عدّاد اللفات.",
    },
  },
  {
    icon: "🛠️",
    title: { en: "A garage that changes the car", ar: "كراج يغيّر السيارة فعلا" },
    body: {
      en:
        "Engines with their own torque curves and their own number of cylinders " +
        "to listen to. Headlight bulbs that throw 95, 138 or 181 metres. Tyre " +
        "sidewall lettering, paint finishes, body kits and brakes. Every part is " +
        "a number the physics reads, not a badge on a card.",
      ar: "محركات لكل واحد منحنى عزم خاص وعدد أسطوانات تسمعه. لمبات كشافات ترمي الضوء ٩٥ أو ١٣٨ أو ١٨١ متر. كتابة على جدار الإطار، ودهانات، وأطقم بودي، وبريكات. كل قطعة رقم تقرأه الفيزياء، مو شعار على كرت.",
    },
  },
  {
    icon: "🌧️",
    title: { en: "Weather you have to drive around", ar: "جو لازم تحسب حسابه" },
    body: {
      en:
        "Rain does not fall on the picture, it falls on the road. The surface " +
        "soaks over about a minute and dries far more slowly, and a soaked road " +
        "takes a corner off your speed and adds half again to your braking " +
        "distance. Under the Second Ring underpass, nothing changes at all.",
      ar: "المطر ما ينزل على الصورة، ينزل على الشارع. السطح يتشرّب خلال دقيقة تقريبا وينشف أبطأ بكثير، والشارع المبلول ياخذ من سرعتك في المنعطف ويزيد مسافة الفرملة نص مرة. وتحت نفق الدائري الثاني، ما يتغيّر شي.",
    },
  },
];

export const ROAD: { heading: Bi; body: Bi; districtsLabel: Bi; roadsLabel: Bi } = {
  heading: { en: "The road", ar: "الشارع" },
  body: {
    en:
      "One lap is two roads: 3.4 km of Arabian Gulf Street with the water on " +
      "your left, then the Second Ring Road back through the city. Ten districts, " +
      "in the order you pass them. The district boundaries are the real ones and " +
      "the landmarks are where they are in life — Kuwait Towers, Love Street, the " +
      "Ras Al-Ard point, the forecourts in Shuwaikh.",
    ar: "اللفة الواحدة شارعان: ٣٫٤ كيلومتر من شارع الخليج العربي والبحر على يسارك، ثم الدائري الثاني رجوعا عبر المدينة. عشر مناطق، بالترتيب اللي تمر فيه عليها. حدود المناطق هي الحدود الحقيقية، والمعالم في مواضعها — أبراج الكويت، وشارع الحب، ورأس الأرض، ومحطات الشويخ.",
  },
  districtsLabel: { en: "Districts, in lap order", ar: "المناطق بترتيب اللفة" },
  roadsLabel: { en: "The two roads", ar: "الشارعان" },
};

/**
 * The districts, in lap order.
 *
 * A copy of AREAS in src/game/world.ts, which cannot be imported here:
 * world.ts pulls in three.js to build the world, and a marketing page
 * has no business loading a renderer. tests/site.mjs reads world.ts and
 * fails if this list stops matching it — both the names and the Arabic.
 */
export const DISTRICTS: Bi[] = [
  { en: "Sharq", ar: "شرق" },
  { en: "Bneid Al-Gar", ar: "بنيد القار" },
  { en: "Salmiya", ar: "السالمية" },
  { en: "Ras Al-Ard", ar: "رأس الأرض" },
  { en: "Shuwaikh Residential", ar: "الشويخ السكنية" },
  { en: "Shamiya", ar: "الشامية" },
  { en: "Mansuriya", ar: "المنصورية" },
  { en: "Da'iya", ar: "الدعية" },
  { en: "Dasma", ar: "الدسمة" },
  { en: "Kuwait City", ar: "مدينة الكويت" },
];

/** Also a copy, also guarded by tests/site.mjs — see DISTRICTS. */
export const ROAD_NAMES: Bi[] = [
  { en: "Arabian Gulf Street", ar: "شارع الخليج العربي" },
  { en: "Second Ring Road", ar: "الدائري الثاني" },
];

export const FLEET: { heading: Bi; body: Bi; classes: Record<string, Bi>; locked: Bi } = {
  heading: { en: "The showroom", ar: "المعرض" },
  body: {
    en:
      // No count in the prose. There were fifteen cars in this sentence
      // until the showroom turned out to hold sixteen — the number came
      // off a regex over mods.ts that had quietly folded two entries into
      // one. The figure in the hero is read from CARS at render time, so
      // it cannot be wrong; a number typed here can only ever be right by
      // luck.
      "From a hatchback you are given for nothing to a homologation special " +
      "that money alone will not buy. Every one has a real length in metres, a " +
      "governed top speed, its own engine and its own tank, and the shell you " +
      "see is scaled to the length on the card.",
    ar: "من هاتشباك تاخذها ببلاش إلى نسخة سباق ما يشتريها المال وحده. لكل واحدة طول حقيقي بالأمتار، وسرعة قصوى محدودة، ومحرك وتانكي خاصين فيها، والهيكل اللي تشوفه مقيس على الطول المكتوب في الكرت.",
  },
  classes: {
    supercar: { en: "Supercar", ar: "سوبر" },
    sport: { en: "Sport", ar: "رياضية" },
    normal: { en: "Street", ar: "عادية" },
  },
  locked: {
    en: "Locked until every legend on the roster has been beaten",
    ar: "مقفلة إلى أن تهزم كل أساطير القائمة",
  },
};

export const RIVALS_SECTION: { heading: Bi; body: Bi; crewLabel: Bi; carLabel: Bi; callsLabel: Bi } = {
  heading: { en: "The roster", ar: "القائمة" },
  body: {
    en:
      "Eight names, fought in order, each with a crew, a district and a length " +
      "they like to call you out at. They speak — in Kuwaiti Arabic, before the " +
      "race and after it — and they mean it either way.",
    ar: "ثمانية أسماء، تواجههم بالترتيب، لكل واحد شلّته ومنطقته والمسافة اللي يحب يتحداك عليها. ويتكلمون — بالكويتي، قبل السباق وبعده — وكلامهم في الحالتين مقصود.",
  },
  crewLabel: { en: "Crew", ar: "الشلّة" },
  carLabel: { en: "Drives", ar: "يسوق" },
  callsLabel: { en: "Calls you out at", ar: "يتحداك على" },
};

export const LENGTHS: { heading: Bi; body: Bi } = {
  heading: { en: "Four lengths", ar: "أربع مسافات" },
  body: {
    en:
      "You pick the distance, not the rival — and picking a different one is how " +
      "you beat somebody who has your number at their own game.",
    ar: "أنت تختار المسافة، مو الخصم — واختيار مسافة ثانية هي طريقتك تغلب واحد يعرف كيف يغلبك على مسافته.",
  },
};

export const HOWTO: { heading: Bi; steps: Pillar[] } = {
  heading: { en: "Getting on the road", ar: "كيف تبدأ" },
  steps: [
    {
      icon: "1",
      title: { en: "Open it and drive", ar: "افتحها وسق" },
      body: {
        en:
          "Arrow keys or WASD, or the on-screen pedals on a phone, or a gamepad " +
          "with rumble if you have one. Nothing to download, no account to make.",
        ar: "أسهم الكيبورد أو WASD، أو الدواسات على شاشة الجوال، أو يد تحكّم بالاهتزاز إذا عندك. ما في تنزيل، ولا حساب تسجّله.",
      },
    },
    {
      icon: "2",
      title: { en: "Find someone worth it", ar: "دوّر واحد يستاهل" },
      body: {
        en:
          "Rivals cruise the lap. Size one up from behind to see their car and " +
          "their numbers before you commit, then get within 60 m and flash — F on " +
          "a keyboard.",
        ar: "الخصوم يلفّون على الشارع. شوف واحد منهم من وراه واطّلع على سيارته وأرقامه قبل لا تدخل، بعدين قرّب ٦٠ متر وغمّض — زر F على الكيبورد.",
      },
    },
    {
      icon: "3",
      title: { en: "Take the money to the garage", ar: "ودّ الفلوس الكراج" },
      body: {
        en:
          "Wins pay in KD. The garage sells engines, brakes, tyres, bulbs and " +
          "paint, and the showroom sells the next car — although the last one on " +
          "the list is not for sale until the roster is finished.",
        ar: "الفوز يدفع بالدينار. الكراج يبيع محركات وبريكات وإطارات ولمبات ودهان، والمعرض يبيع السيارة اللي بعدها — إلا الأخيرة، ما تنباع إلا إذا خلّصت القائمة.",
      },
    },
  ],
};

export const FAQ: Faq[] = [
  {
    q: { en: "Do I need to install anything?", ar: "لازم أنزّل شي؟" },
    a: {
      en:
        "No. It is a web page — open it and it runs. It works on a phone, and it " +
        "keeps your garage, your money and your progress in the browser you " +
        "played it in.",
      ar: "لا. هي صفحة ويب — تفتحها وتشتغل. تشتغل على الجوال، وتحفظ كراجك وفلوسك وتقدّمك في نفس المتصفح اللي لعبت فيه.",
    },
  },
  {
    q: { en: "Is the whole game in Arabic?", ar: "اللعبة كلها بالعربي؟" },
    a: {
      en:
        "Yes — menus, the HUD, the road signs and the rivals' spoken lines. The " +
        "signage is set in naskh because that is what Gulf road signs are set in, " +
        "and the rivals speak Kuwaiti rather than textbook Arabic.",
      ar: "إيه — القوائم والشاشة واللوحات وكلام الخصوم. اللوحات بخط النسخ لأن هذا خط لوحات الطرق في الخليج، والخصوم يتكلمون كويتي مو عربي كتب.",
    },
  },
  {
    q: { en: "Why can't I race in the daytime?", ar: "ليش ما أقدر أسابق في النهار؟" },
    a: {
      en:
        "Because nobody does. The world is open at every hour — drive it, look at " +
        "it, fill up — but the rivals are out from midnight to 05:50 Kuwait time. " +
        "The settings will pin the sky to a fixed night if your day does not line " +
        "up with Kuwait's.",
      ar: "لأن ما أحد يسابق فيه. العالم مفتوح كل ساعة — سق فيه، وتفرّج، وعبّي — بس الخصوم موجودون من منتصف الليل إلى ٥:٥٠ بتوقيت الكويت. والإعدادات تثبّت السماء على ليل دائم إذا كان يومك ما يتوافق مع يوم الكويت.",
    },
  },
  {
    q: { en: "Can I race other people?", ar: "أقدر أسابق ناس؟" },
    a: {
      en:
        "There is an online hub with crews and a board. The eight rivals are the " +
        "career, and they are offline — the hub is where the people are.",
      ar: "في هب أونلاين فيه شلل ولوحة نتائج. الخصوم الثمانية هم المشوار، وهم أوفلاين — والهب هو مكان الناس.",
    },
  },
  {
    q: { en: "Is this a real place?", ar: "هذا مكان حقيقي؟" },
    a: {
      en:
        "The road is. The lap follows Arabian Gulf Street and the Second Ring " +
        "Road, the district boundaries are the real boundaries, and the landmarks " +
        "sit where they sit. The cars and the rivals are invented — none of them " +
        "is a real make, model or person.",
      ar: "الشارع حقيقي. اللفة تمشي على شارع الخليج العربي والدائري الثاني، وحدود المناطق هي الحقيقية، والمعالم في مواضعها. أما السيارات والخصوم فمن الخيال — ما فيهم ماركة ولا موديل ولا شخص حقيقي.",
    },
  },
];

export const CTA: { heading: Bi; body: Bi; play: Bi; hub: Bi } = {
  heading: { en: "The road is open", ar: "الشارع مفتوح" },
  body: {
    en: "Half past twelve, the corniche, and whoever else is out.",
    ar: "الثانية عشرة والنصف، والكورنيش، ومن طلع غيرك.",
  },
  play: { en: "Play now", ar: "العب الحين" },
  hub: { en: "Online hub", ar: "الهب" },
};

export const LABELS = {
  gallery: { en: "From the road", ar: "من الشارع" },
  garage: { en: "The garage", ar: "الكراج" },
  faq: { en: "Questions", ar: "أسئلة" },
  price: { en: "Price", ar: "السعر" },
  free: { en: "Free", ar: "مجانا" },
  topSpeed: { en: "Top speed", ar: "السرعة القصوى" },
  length: { en: "Length", ar: "الطول" },
  kd: { en: "KD", ar: "د.ك" },
  km: { en: "km", ar: "كم" },
  kmh: { en: "km/h", ar: "كم/س" },
  m: { en: "m", ar: "م" },
  cars: { en: "cars", ar: "سيارة" },
  rivals: { en: "rivals", ar: "خصوم" },
  lapKm: { en: "km lap", ar: "كم لفة" },
  window: { en: "racing window", ar: "وقت السباق" },
} satisfies Record<string, Bi>;
