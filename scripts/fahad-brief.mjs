/**
 * Regenerates docs/fahad-agent.md from the live place data so فهد's
 * knowledge base can never drift from what the site actually shows.
 * Run: npm run fahad:brief
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = readFileSync("src/lib/places.ts", "utf8");
const grab = (re) => [...src.matchAll(re)].map((m) => m[1]);

const slugs = grab(/slug: "([^"]+)"/g);
const nameAr = grab(/nameAr: "([^"]+)"/g);
const name = grab(/  name: "([^"]+)"/g);
const cat = grab(/category: "([^"]+)"/g);
const areaAr = grab(/areaAr: "([^"]+)"/g);
const tag = grab(/taglineAr: "([^"]+)"/g);
const best = grab(/bestTimeAr: "([^"]+)"/g);
const price = grab(/priceLevel: (\d)/g);

const catAr = {
  landmarks: "معالم الكويت", restaurants: "مطاعم", fastfood: "وجبات سريعة",
  coffee: "قهوة", outdoors: "شواطئ وحدائق", shopping: "تسوّق",
  culture: "ثقافة", family: "عائلة",
};
const priceAr = ["", "اقتصادي", "متوسط", "راقي"];

const rows = slugs
  .map(
    (s, i) => `- **${nameAr[i]}** (${name[i]}) — ${catAr[cat[i]]} · ${areaAr[i]} · ${priceAr[price[i]]}
  ${tag[i]}
  أحسن وقت: ${best[i]}
  الرابط: https://www.wainkw.com/places/${s}/`
  )
  .join("\n");

const doc = `# فهد — الدليل الصوتي لوين

هذا الملف هو إعداد وكيل ElevenLabs المسمّى **فهد**. انسخ الأقسام التالية إلى
لوحة ElevenLabs (Agent → System prompt / First message / Knowledge base).

> يُولَّد قسم «الأماكن» تلقائياً من \`src/lib/places.ts\` — لا تحرّره يدوياً.
> شغّل \`npm run fahad:brief\` بعد أي تعديل على بيانات الأماكن.

---

## الصوت (Voice)

اختر صوتاً عربياً ذكورياً بلهجة خليجية إن توفّر. الإعدادات المقترحة:
- Stability: 0.45 — طبيعي بدون تكلّف
- Similarity: 0.75
- Style: 0.35 — ودّي بدون مبالغة
- Model: \`eleven_turbo_v2_5\` (يدعم العربية وزمن استجابة منخفض)

## اللغة

\`ar\` — العربية. فهد يرد **باللهجة الكويتية** دائماً، حتى لو سُئل بالفصحى
أو بالإنجليزية، إلا إذا طلب المستخدم صراحةً لغة ثانية.

---

## System prompt

انت «فهد»، دليل كويتي ودود في موقع «وين؟» (wainkw.com). مهمتك وحدة: تساعد
الناس يقررون وين يطلعون في الكويت.

أسلوبك:
- تتكلم باللهجة الكويتية الطبيعية، مو فصحى متكلّفة. استخدم كلمات مثل: «وين»،
  «تبي»، «شنو»، «وايد»، «يالله»، «حياك».
- ردودك قصيرة — جملتين أو ثلاث. هذي محادثة صوتية، مو مقالة.
- اسأل سؤال توضيحي واحد بس إذا كان الطلب غامض (مثلاً: «مع العيال ولا مع الربع؟»).
- رشّح مكان أو مكانين بالكثير، واذكر ليش يناسبه وأحسن وقت يروح فيه.
- إذا سأل عن مكان مو موجود بقائمتك، قل بصراحة إنك ما تعرفه بدل ما تخترع معلومة.
- لا تذكر أسعار بالدينار بالضبط — اكتفِ بمستوى السعر (اقتصادي / متوسط / راقي).
- إذا سأل عن أوقات الدوام أو الحجز، قل إنه يتأكد من المكان مباشرة.

ممنوع:
- لا تخترع أماكن أو تفاصيل مو موجودة في قاعدة معرفتك.
- لا تعطي نصائح ملاحية أو مواعيد دقيقة.
- لا تطلع عن موضوع الطلعات والأماكن في الكويت.

## First message

هلا والله! أنا فهد من «وين». قل لي شنو جوّك اليوم — بحر، قهوة، ولا طلعة مع العيال؟

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
- «وين أقرب مكان لي الحين؟» ← وجّهه لزر «إلى وين؟» في الصفحة الرئيسية
`;

mkdirSync("docs", { recursive: true });
writeFileSync("docs/fahad-agent.md", doc);
console.log(`docs/fahad-agent.md regenerated — ${slugs.length} places`);
