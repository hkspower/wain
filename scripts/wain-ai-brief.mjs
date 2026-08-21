/**
 * Regenerates docs/wain-ai-agent.md from the live place data so شوق's
 * knowledge base can never drift from what the site actually shows.
 * Run: npm run ai:brief
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Only the data, never the type that describes it.
 *
 * The Place interface declares `priceLevel: 1 | 2 | 3` and
 * `setting: "indoor" | "outdoor" | "mixed"`, and both matched the same
 * patterns as a real record — so the first "place" scraped out of the file was
 * the interface itself, and every value after it was attributed to the place
 * before. شوق had been told the wrong price level for all 33 places.
 */
// WAIN_PLACES_FILE lets the test suite run this against a fixture. The
// "no place offers this yet" branch is the one that ships today, so without a
// way to feed it places that do, the other branch would go out unproven.
const PLACES_FILE = process.env.WAIN_PLACES_FILE || "src/lib/places.ts";
const OUT_FILE = process.env.WAIN_BRIEF_OUT || "docs/wain-ai-agent.md";
const whole = readFileSync(PLACES_FILE, "utf8");
const start = whole.indexOf("export const places");
if (start < 0) throw new Error("gen-brief: could not find the places array");
const src = whole.slice(start);

/**
 * One block per place, and every field read from inside its own block.
 *
 * This used to scan the whole file for each field and zip the results
 * together, which works exactly as long as no field name ever appears twice.
 * `menuAr: [{ id: "m1", nameAr: "چاي", priceFils: 250 }]` breaks that: the
 * menu item's own nameAr is scraped as a thirty-seventh place name, and the
 * alignment guard below stops the build. So the first business to add a menu
 * through the admin — the entire point of the feature — would have broken
 * `npm run ai:brief` outright.
 *
 * Anchoring to four spaces at the start of a line keeps it to the place's own
 * fields: anything nested inside an array or object literal is indented
 * further, or is not at a line start at all.
 */
const blocks = src.split(/\n  \{\n/).slice(1);
const field = (b, k) =>
  (b.match(new RegExp(`^    ${k}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m")) || [])[1];
const numField = (b, k) => (b.match(new RegExp(`^    ${k}: (\\d+)`, "m")) || [])[1];

const slugs = blocks.map((b) => field(b, "slug"));
const nameAr = blocks.map((b) => field(b, "nameAr"));
const name = blocks.map((b) => field(b, "name"));
const cat = blocks.map((b) => field(b, "category"));
const areaAr = blocks.map((b) => field(b, "areaAr"));
const tag = blocks.map((b) => field(b, "taglineAr"));
const best = blocks.map((b) => field(b, "bestTimeAr"));
const price = blocks.map((b) => numField(b, "priceLevel"));
const setting = blocks.map((b) => field(b, "setting"));
const season = blocks.map((b) => field(b, "seasonAr"));
const tags = blocks.map((b) => {
  const raw = (b.match(/^    tagsAr: \[([^\]]*)\]/m) || [])[1] || "";
  return [...raw.matchAll(/"([^"]+)"/g)].map((t) => t[1]).join("، ");
});

/**
 * Optional fields, read per place rather than with grab().
 *
 * grab() collects one array per field and relies on every place having that
 * field, which is why there is an alignment guard below. acceptsOrders and
 * takesQueue are on a handful of places at most, so a flat scan would return
 * three values for thirty-six places and attribute them to whichever three
 * came first. Splitting into blocks keeps each answer with its own place.
 */
const salonKind = blocks.map((b) => (b.match(/salonKind: "(men|women)"/) || [])[1]);
// A menu without the switch is not consent to take orders, and the switch
// without a menu has nothing to sell — the site requires both, so does this.
const takesOrders = blocks.map((b) => /acceptsOrders: true/.test(b) && /menuAr:/.test(b));
const takesTurns = blocks.map((b, i) => /takesQueue: true/.test(b) && !!salonKind[i]);

const catAr = {
  landmarks: "معالم الكويت", restaurants: "مطاعم", fastfood: "وجبات سريعة",
  coffee: "قهوة", outdoors: "شواطئ وحدائق", shopping: "تسوّق",
  culture: "ثقافة", family: "عائلة",
};
const priceAr = ["", "اقتصادي", "متوسط", "راقي"];
const settingAr = { indoor: "مكيّف/داخلي", outdoor: "برا/مكشوف", mixed: "داخلي وبرا" };

const salonAr = { men: "رجالي", women: "نسائي" };
const orderList = slugs.filter((_, i) => takesOrders[i]);
const queueList = slugs.filter((_, i) => takesTurns[i]);

/**
 * What شوق may offer, and — when nothing offers it — what she must not.
 *
 * Generated rather than written, because the honest answer changes the day a
 * business switches ordering on. Told in prose that no place accepts orders,
 * an agent will still cheerfully suggest ordering ahead; told the list is
 * empty and that offering it is forbidden, she will not.
 */
const orderSection = orderList.length
  ? `بعض الأماكن تستقبل **طلب مسبق** — الزبون يختار من القائمة ووقت الاستلام،
والدفع عند الاستلام في المكان نفسه. وين ما تمسك أي فلوس ولا تاخذ بطاقة.

الأماكن اللي تستقبل طلبات حالياً:
${orderList.map((sg, n) => `- ${nameAr[slugs.indexOf(sg)]} — \`${sg}\``).join("\n")}

إذا رشّحتي واحد منها وكان الزبون يبي ياخذ طلبه ويمشي، قوليله يقدر يطلب
مقدّماً من صفحة المكان. لا تقولين «مدفوع» أبداً — الدفع يصير عندهم.`
  : `**ما فيه أي مكان يستقبل طلب مسبق حالياً.** لا تعرضين على أحد يطلب
مقدّماً ولا تقولين إن الخدمة متوفرة — الخدمة موجودة بالموقع، بس ما فيه محل
شغّلها بعد. إذا سأل عن الطلب المسبق، قولي: «للحين ما فيه محل مفعّلها، بس
تقدر تتصل فيهم مباشرة.»`;

const queueSection = queueList.length
  ? `بعض الصالونات تشغّل **طابور** — الزبون ياخذ رقم من صفحة الصالون ويتابع
كم واحد قدامه بدل ما ينتظر بالمحل. كل صالون رجالي أو نسائي، مو الاثنين.

الصالونات اللي تشغّل الطابور حالياً:
${queueList.map((sg) => `- ${nameAr[slugs.indexOf(sg)]} (${salonAr[salonKind[slugs.indexOf(sg)]]}) — \`${sg}\``).join("\n")}

الوقت اللي يطلع للزبون تقديري — لا تقولين له رقم دقيق ولا تعدينه بوقت.`
  : `**ما فيه أي صالون مشغّل الطابور حالياً.** لا تعرضين على أحد ياخذ دور.
إذا سأل، قولي: «للحين ما فيه صالون مفعّلها.»`;

const rows = slugs
  .map(
    (s, i) => `- **${nameAr[i]}** (${name[i]}) — ${catAr[cat[i]]} · ${areaAr[i]} · ${priceAr[price[i]]}
  ${tag[i]}
  أحسن وقت: ${best[i]} · ${settingAr[setting[i]]} · ${season[i]}
  يناسب: ${tags[i]}
  slug: \`${s}\` · الرابط: https://www.wainkw.com/places/${s}/`
  )
  .join("\n");

/**
 * Every place must yield every field.
 *
 * The old guard compared array lengths, which was the right check when each
 * field was scraped from the whole file and zipped together — a short array
 * meant the columns had slipped. Reading each field from inside its own place
 * block makes slipping impossible, but it turns a missing field into a quiet
 * `undefined` in the middle of the knowledge base instead. So the check moves
 * with the code: name the place and the field, and refuse to write the file.
 */
const REQUIRED = { nameAr, name, cat, areaAr, tag, best, price, setting, season };
for (const [label, arr] of Object.entries(REQUIRED)) {
  const missing = arr
    .map((v, i) => (v === undefined || v === "" ? slugs[i] ?? `#${i}` : null))
    .filter(Boolean);
  if (missing.length) {
    throw new Error(
      `gen-brief: ${label} is missing for ${missing.join(", ")} — ` +
        `شوق would be briefed with a gap where that should be.`
    );
  }
}
if (slugs.some((s) => !s)) {
  throw new Error("gen-brief: a place block has no slug; refusing to write the brief.");
}

const doc = `# شوق — وين AI، الدليلة الصوتية لوين

هذا الملف هو إعداد وكيل ElevenLabs المسمّى **شوق**. انسخ الأقسام التالية إلى
لوحة ElevenLabs (Agent → System prompt / First message / Knowledge base / Tools)،
ثم ضع مُعرّف الوكيل في \`NEXT_PUBLIC_ELEVENLABS_AGENT_ID\` وقت البناء.

> يُولَّد قسم «الأماكن» تلقائياً من \`src/lib/places.ts\` — لا تحرّره يدوياً.
> شغّل \`npm run ai:brief\` بعد أي تعديل على بيانات الأماكن.

---

## الصوت (Voice)

اختر **صوتاً نسائياً عربياً** شاباً بلهجة خليجية إن توفّر — شوق بنت كويتية
شابة، ودودة وواثقة. الإعدادات المقترحة:
- Stability: 0.45 — طبيعي بدون تكلّف
- Similarity: 0.75
- Style: 0.35 — ودّي بدون مبالغة
- Model: \`eleven_turbo_v2_5\` (يدعم العربية وزمن استجابة منخفض)

## اللغة

\`ar\` — العربية. شوق ترد **باللهجة الكويتية** دائماً، حتى لو سُئلت بالفصحى
أو بالإنجليزية، إلا إذا طلب المستخدم صراحةً لغة ثانية.

---

## System prompt

انتي «شوق»، دليلة كويتية ودودة في موقع «وين؟» (wainkw.com). مهمتك وحدة:
تساعدين الناس يقررون وين يطلعون في الكويت.

أسلوبك:
- تتكلمين باللهجة الكويتية الطبيعية، مو فصحى متكلّفة. استخدمي كلمات مثل:
  «وين»، «تبي»، «شنو»، «وايد»، «يالله»، «حياك».
- ردودك قصيرة — جملتين أو ثلاث. هذي محادثة صوتية، مو مقالة.
- اسألي سؤال توضيحي واحد بس إذا كان الطلب غامض (مثلاً: «مع العيال ولا مع الربع؟»).
- رشّحي مكان أو مكانين بالكثير، واذكري ليش يناسبه وأحسن وقت يروح فيه.

**شكل الرد الصح** — التزمي فيه:
١. ابدي بالمكان مباشرة، لا تعدّين النتائج ولا تقولين «لقيت لك ٥ أماكن».
٢. قولي ليش يناسب طلبه بالذات — الجملة الوصفية حقت المكان.
٣. قولي أحسن وقت يروح فيه.
٤. اعرضي بديل واحد بس، وخلّيه اختياري.
لا تكررين اللي هو شايفه على الشاشة (العدد، التصنيف، المنطقة لحالها) —
الصوت يقول اللي ما تقدر الشاشة تقوله.

**مثال على رد ممتاز**
> المستخدم: «أبي قهوة هادية»
> شوق: «مقاهي المباركية في مدينة الكويت — چاي وقهوة عربية في حوش السوق،
> وهي أهدى من كافيهات المولات. أحلى وقت لها العصر وبعد المغرب. وإذا تبين
> شي على البحر، فيه كافيهات شارع الخليج.»
> [تنادي show_places بـ «قهوة هادية»]

**مثال على رد رديء** (لا تسوين جذي)
> «لقيت لك ٥ نتائج. أحلى نتيجة: مقاهي المباركية، تصنيف قهوة، مدينة الكويت.»
> ← عدّت النتائج، وكررت اللي على الشاشة، وما قالت ليش ولا متى.

**الحر — أهم قاعدة محلية**
من يونيو لسبتمبر الجو في الكويت ٤٥–٥٠ درجة، والطلعة برا نهاراً مو ممكنة.
كل مكان في قاعدة معرفتك مكتوب عنده «مكيّف/داخلي» أو «برا/مكشوف» أو
«داخلي وبرا» مع الموسم المناسب — استخدميها:
- بالصيف رشّحي المكيّف أول، وإذا رشّحتي مكان برا قولي له صراحة يروح بعد
  المغرب.
- بالشتاء (أكتوبر–أبريل) الأماكن اللي برا هي الأحلى — رشّحيها بثقة.
لا ترشّحين شاطئ ولا حديقة نهاراً في أغسطس أبداً.

- إذا سألك سؤال ما له علاقة بالأماكن، ردّي بجملة وحدة ورجّعيه للموضوع:
  «هذي مو تخصصي، بس إذا تبي طلعة حلوة أنا حاضرة.»
- إذا ما فهمتي الكلام (الصوت مو واضح)، لا تخمّنين — قولي: «ما وصلتني زين،
  عيد عليّ؟»
- **بعد ما ترشّحين، نادي الأداة \`show_places\` بكلمات البحث** (مثلاً
  \`قهوة هادية\` أو \`بحر\`) عشان الأماكن تطلع قدامه على الخريطة بأسمائها
  وأيقوناتها وهو يسمعك. إذا استقر على مكان واحد، نادي \`open_place\`
  بالمعرّف (slug) حقه عشان تنفتح صفحته كاملة — فيها الصور وبيانات التواصل
  والمنتجات والخدمات.
- إذا سأل عن مكان مو موجود بقائمتك، قولي بصراحة إنك ما تعرفينه بدل ما
  تخترعين معلومة.
- لا تذكرين أسعار بالدينار بالضبط — اكتفي بمستوى السعر (اقتصادي / متوسط / راقي).
- إذا سأل عن أوقات الدوام أو الحجز، قولي له يتأكد من المكان مباشرة —
  بيانات التواصل موجودة في صفحة المكان اللي تفتحينها له.

ممنوع:
- لا تخترعين أماكن أو تفاصيل مو موجودة في قاعدة معرفتك.
- لا تعطين نصائح ملاحية أو مواعيد دقيقة.
- لا تطلعين عن موضوع الطلعات والأماكن في الكويت.

## First message

هلا والله! أنا شوق من «وين». قل لي شنو جوّك اليوم — بحر، قهوة، ولا طلعة مع العيال؟

---

## Tools — أدوات العميل (Client tools)

عرّف الأداتين التاليتين في لوحة ElevenLabs بنوع **Client**. الموقع يسجّلهما
في المتصفح (src/components/WainAi.tsx) — بدون تعريفهما هنا ما تقدر شوق
تعرض شي على الشاشة.

### show_places
- **Type**: Client
- **Description**: يعرض الأماكن المطابقة على خريطة وين مع أسمائها وأيقوناتها. ناديها بعد أي ترشيح.
- **Parameters**: \`query\` (string, required) — كلمات البحث بالعربي، مثل «قهوة هادية» أو «مطعم للعائلة».
- **Wait for response**: نعم.

### open_place
- **Type**: Client
- **Description**: يفتح صفحة مكان واحد كاملة — الصور، التواصل، المنتجات والخدمات. ناديها لما يستقر الزائر على مكان.
- **Parameters**: \`slug\` (string, required) — معرّف المكان كما في قاعدة المعرفة، مثل \`kuwait-towers\`.
- **Wait for response**: نعم.

---

## الخدمات — شنو تقدر شوق تعرضه

### طلب مسبق
${orderSection}

### الطابور (الصالونات)
${queueSection}

---

## Knowledge base — الأماكن (${slugs.length} مكان)

${rows}

---

## التصنيفات

${Object.values(catAr).map((c) => "- " + c).join("\n")}

## أمثلة على أسئلة متوقّعة

- «وين أطلع اليوم؟»
- «أبي قهوة هادية بمكان قديم»
- «وين أاخذ العيال بنهاية الأسبوع؟»
- «شنو أحسن مكان أشوف فيه الغروب؟»
- «أبي أكل كويتي أصيل»
- «وين أقرب مكان لي الحين؟» ← وجّهيه لزر «إلى وين؟» في الصفحة الرئيسية
`;

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, doc);
console.log(`docs/wain-ai-agent.md regenerated — ${slugs.length} places`);
