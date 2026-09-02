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
const blocks = src.split(/\n {2}\{\n/).slice(1);
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
const tagList = blocks.map((b) => {
  const raw = (b.match(/^ {4}tagsAr: \[([^\]]*)\]/m) || [])[1] || "";
  return [...raw.matchAll(/"([^"]+)"/g)].map((t) => t[1]);
});
const tags = tagList.map((t) => t.join("، "));

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
${orderList.map((sg) => `- ${nameAr[slugs.indexOf(sg)]} — \`${sg}\``).join("\n")}

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

/**
 * Two indexes over the same 44 records, because a list is only searchable in
 * the order it is written in.
 *
 * The place rows below are sorted the way places.ts is, which answers «حدثيني
 * عن أبراج الكويت» and nothing else. A visitor does not arrive with a place;
 * they arrive with an interest («أبي أصوّر») or a constraint («شي قريب من
 * الفحيحيل»), and answering either from the rows means reading all forty-four
 * and hoping. Both indexes are derived — every name in them comes out of
 * places.ts — so neither can claim a place the site does not have.
 */

// Only tags carried by two or more places. A tag on exactly one place adds
// nothing an index can do that its own row does not already do, and 49 of the
// 106 tags are that.
const byTag = new Map();
tagList.forEach((ts, i) => {
  for (const t of ts) byTag.set(t, [...(byTag.get(t) ?? []), nameAr[i]]);
});
const interestRows = [...byTag.entries()]
  .filter(([, list]) => list.length > 1)
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ar"))
  .map(([t, list]) => `- **${t}** (${list.length}) — ${list.join(" · ")}`)
  .join("\n");

// Areas, not governorates. The governorate of every area is a fact I would be
// asserting rather than reading — الري and الدوحة alone are easy to place in
// the wrong one — and a confidently wrong «هذا في محافظة حولي» is worse than
// no grouping at all. The area is in the data; the governorate is not.
const byArea = new Map();
areaAr.forEach((a, i) => byArea.set(a, [...(byArea.get(a) ?? []), nameAr[i]]));
const areaRows = [...byArea.entries()]
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ar"))
  .map(([a, list]) => `- **${a}** (${list.length}) — ${list.join(" · ")}`)
  .join("\n");

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

**الوكيل موجود ومبني.** ما عاد تحتاج تنسخ شي بيدك — اللي تحت هو المرجع
والمصدر، ونسخة منه تنزل على الوكيل نفسه.

| | |
| --- | --- |
| Agent ID | \`agent_1701m1gcrccrethae9y3nyv1e116\` |
| اللغة | \`ar\` · نموذج الصوت \`eleven_turbo_v2_5\` |
| الأدوات | \`show_places\` = \`tool_8701m1gccbbkf0288efab76729ac\` · \`open_place\` = \`tool_6101m1gccq94ey3b7hkx4sebhnr9\` |
| قاعدة المعرفة | \`WzkQSLRq7en4DX17AIyL\` |
| الأصول المسموحة | wainkw.com · www.wainkw.com · localhost · 127.0.0.1 |

حط \`NEXT_PUBLIC_ELEVENLABS_AGENT_ID\` = الـ Agent ID وقت البناء، عشان زر
الاتصال يشتغل بالوكيل بدل الـ speech recognition حق المتصفح.

**الصوت لسه ناقص خطوة وحدة.** الوكيل انبنى على الصوت الافتراضي للحساب — صوت
إنجليزي — لأن الصوت المختار لشوق (Maryam Essa، \`w0uhBAmNIG5kUDeaFEsA\`) صوت
مكتبة مو صوت ورك سبيس، والـ API يرفضه بـ \`voice_not_found\`. ضيفه من
Voice Library ← Add to my voices، وبعدها بدّله على الوكيل. ليش هو بالذات، وشنو
اللي تنازلنا عنه: \`docs/voice-setup.md\`.

**الأصول مقفولة عن قصد.** الموقع تصدير ثابت، يعني الـ Agent ID يوصل المتصفح
ولازم يوصله — فأي أحد يقدر ينسخه من الصفحة. \`require_origin_header\` مفعّل مع
القائمة فوق، عشان نسخة من المعرّف ما تشغّل مكالمات من موقع ثاني على حساب
الاشتراك.

> يُولَّد هذا الملف كامل من \`scripts/wain-ai-brief.mjs\` — لا تحرّره يدوياً،
> أي تعديل هنا ينمسح. عدّل القالب هناك، وشغّل \`npm run ai:brief\` بعد أي
> تغيير على بيانات الأماكن، وبعدها حدّث مستند قاعدة المعرفة في ElevenLabs
> بنفس محتوى قسم «الأماكن».

---

## الصوت (Voice)

الإعدادات المضبوطة على الوكيل الحين — ونفسها في \`RENDITION\` بـ
\`scripts/gen-voice.mjs\`، عشان الصوت المسجّل مسبقاً والمكالمة الحيّة يطلعون
نفس الشخص:
- Stability: 0.35 — أقل ثبات = أكثر تعبيراً، والتعبير أكثر شي يقرأ «شبابي»
- Similarity: 0.80
- Speed: 1.06 — الدليل يمشي أسرع من الراوي
- Model: \`eleven_turbo_v2_5\` — مطلوب، الـ API يرفض أي وكيل غير إنجليزي
  على غيره وغير flash v2_5

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

## حسب الاهتمام — من الرغبة إلى المكان

الزائر ما يجي باسم مكان، يجي برغبة. هذا الفهرس يحوّل الرغبة إلى أماكن، مرتّب
من الأكثر تغطية للأقل. الاهتمامات اللي عند مكان واحد بس مو هنا — سطر المكان
نفسه يكفيها.

${interestRows}

## حسب المنطقة

${areaRows}

**مناطق مو محافظات.** الجدول فوق من بيانات الموقع نفسه؛ محافظة كل منطقة مو
منها، وقول «هذا في محافظة حولي» غلط أسوأ من عدم التجميع أصلاً. إذا سأل عن
محافظة، اسأليه عن المنطقة أو رشّحي بالمنطقة.

## الكويت — التقويم والعادات

هذي القواعد اللي تفرق بين جواب عام وجواب كويتي. **ما عندك تقويم**: تعرفين
التاريخ والوقت من النظام، بس ما تعرفين إذا اليوم رمضان ولا عيد إلا إذا الزائر
قالها أو الشهر معروف. لا تخمّنين — إذا ذكرها، طبّقي القاعدة.

**نهاية الأسبوع الجمعة والسبت.** الجمعة الصبح كل شي هادي وكثير أماكن مسكّرة
لين بعد صلاة الجمعة؛ الحركة تبدأ من العصر. لا ترشّحين طلعة الجمعة الصبح.

**رمضان يقلب اليوم.** النهار هادي والمطاعم مسكّرة وقت الصيام، وكل شي يبدأ بعد
المغرب ويطول لين الفجر. الغبقة بعد العشا. لا ترشّحين أبداً طلعة برا بالنهار في
رمضان، ولا مطعم قبل المغرب. المولات والكافيهات تفتح متأخر وايد.

**العيد زحمة.** المولات والمدن الترفيهية تنفجر بالناس أول ثلاثة أيام. رشّحي
الصبح بدري، أو مكان أهدى.

**الأعياد الوطنية ٢٥ و٢٦ فبراير.** «هلا فبراير» طول الشهر، وشارع الخليج يمتلئ
بالليل — رشاشات مي وزحمة وأعلام. إذا يبي الجو هذا، هذا مكانه؛ وإذا يبي هدوء،
تجنّبي الخليج بالليل في فبراير.

**الصيف من يونيو لسبتمبر ٤٥–٥٠ درجة.** برا بالنهار مو ممكن — مكيّف بالنهار،
والمكشوف بعد المغرب بس. وكثير عوائل مسافرة في يوليو وأغسطس، فالبلد أهدى.

**الشتاء من ديسمبر لفبراير هو الموسم.** أحلى وقت لكل شي مكشوف، ووقت الكشتة
والبر والشاليهات.

**السرايات** — أمطار ورعد قوي بالربيع، غالباً أواخر مارس وأبريل. تجي بسرعة
وتغرّق الشوارع وتروح. إذا الجو ممطر، رشّحي مكيّف.

**وقت الصلاة** بعض المحلات تسكّر دقايق. مو مشكلة، بس لا تعطينه موعد دقيق.

## كلمات كويتية لازم تفهمينها

ما تحتاجين تستخدمينها كلها — تحتاجين تعرفين وش يقصد لما يقولها.

- **طلعة** خروج · **كشتة** تخييم بالبر، شتوي · **البر** الصحراء · **الچالت /
  الشاليه** بيت البحر · **الفريج** الحي القديم · **الديوانية** قعدة رجال
  بالبيت بالليل — عادة، مو مكان تقدرين ترشّحينه
- **الربع** الأصحاب · **العيال** الأطفال · **الأهل** العائلة · **عزيمة** دعوة
  أكل · **غبقة** قعدة رمضان بعد العشا
- الأكل: **مچبوس** · **هريس** · **تشريب** · **مرقوق** · **جريش** · **رقاق** ·
  **بلاليط** · **درابيل** · **لقيمات** · **مسحب** — كلها أكل كويتي، وجّهيها
  لتصنيف «مطاعم» و«أكل كويتي»
- الشرب: **كرك** چاي بالحليب والهيل · **قهوة عربية** قهوة عربية بالهيل والزعفران
- **وايد** كثير · **شنو** ماذا · **وين** أين · **جذي** كذا · **زين** طيب

## التصنيفات

${Object.values(catAr).map((c) => "- " + c).join("\n")}

## أمثلة على أسئلة متوقّعة

- «وين أطلع اليوم؟»
- «أبي قهوة هادية بمكان قديم»
- «وين آخذ العيال بنهاية الأسبوع؟»
- «شنو أحسن مكان أشوف فيه الغروب؟»
- «أبي أكل كويتي أصيل»
- «وين أقرب مكان لي الحين؟» ← وجّهيه لزر «إلى وين؟» في الصفحة الرئيسية
`;

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, doc);
console.log(`docs/wain-ai-agent.md regenerated — ${slugs.length} places`);
