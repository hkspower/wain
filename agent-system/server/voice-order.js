'use strict';
/**
 * وكيل الطلب الصوتي — من كلام الزبون إلى حقول الطلب.
 *
 * ── ما هو، وما ليس هو ───────────────────────────────────────────────
 * هذا **مستخرِج قاعديّ**، لا نموذج لغويّ. لا يتعلّم ولا يستنتج ما لم يُقَل،
 * وسلوكه واحد على المدخل الواحد دائمًا. سُمّي «وكيلًا» لأنه يقوم بعمل كان
 * يقوم به موظّف: يسمع الطلب فيملأ الحقول. وحدود ذلك مكتوبة هنا صراحةً حتى
 * لا يُظَنّ به ما لا يفعل.
 *
 * ── يقترح ولا يُنشئ ─────────────────────────────────────────────────
 * لا ينشئ طلبًا أبدًا. يقترح، ويقرأ الموظّف الاقتراح ويضغط الزرّ.
 *
 * وهذا ليس تحفّظًا زائدًا: التعرّف على الكلام يخطئ في أسماء الأماكن أكثر ما
 * يخطئ، و«السالمية» و«السالمي» كلمتان متقاربتان في السمع بعيدتان على الأرض.
 * لو أنشأ الوكيل الطلب وحده لذهب كابتن إلى منطقة لم يطلبها أحد، ولا يكتشف
 * الخطأ إلّا الزبون الذي لم يصله شيء. الموظّف يقرأ في ثانية ما يكلّف تصحيحه
 * ساعة.
 *
 * ── ما لا يسمعه لا يخمّنه ───────────────────────────────────────────
 * الحقل الذي لم يُذكر يبقى فارغًا ومعه سببه في `missing`، ولا يُملأ بأقرب
 * احتمال. حقلٌ فارغ يراه الموظّف فيسأل عنه؛ وحقلٌ مملوء بالخطأ لا يسأل عنه
 * أحد.
 *
 * ولهذا لا يوجد هنا تطابق تقريبيّ (fuzzy) **يملأ حقلًا**: الملء إمّا على
 * الاسم بعد التطبيع أو لا شيء. والتطبيع يكفي لما يقع فعلًا — «السالميه»
 * و«السالمية» سواء.
 *
 * لكنّ الصمت ليس أمانة. ما قارب اسمًا ولم يطابقه يُعرض سؤالًا في `missing`:
 * **«هل تقصد الفحيحيل؟»** — سؤالٌ لا قيمةٌ تُوضع في حقل. والفرق أن الخطأ
 * المعروض يُصحَّح، والمُطبَّق يمرّ. (انظر `similar.js`.)
 *
 * ── وتصحيحٌ لِما كان مكتوبًا هنا ──────────────────────────────────────
 * كان في هذا الموضع أنّ «السالمي» **ليست منطقة**. وهي منطقة: في محافظة
 * الجهراء على الحدود السعودية، وطريق ٧٠ يحمل اسمها. عُرف ذلك بمراجعة
 * مصادر خارجية، وكان النظام يقول للزبون «ليست من مناطق الكويت» — وهو قولٌ
 * غير صحيح يجعله يشكّ فيما كتبه صوابًا. انظر `CONFUSABLE` في `areas.js`.
 */

const ar = require('arabic-kit');
const AREA = require('./areas');
const D = require('./domain');
const SIM = require('./similar');

/* ------------------------------ الأعداد ------------------------------ */

/**
 * أعداد منطوقة كما تُقال في الكويت، لا كما تُكتب في الكتب.
 * التعرّف على الكلام يعيد «قطعة أربعة» نصًّا و«قطعة ٤» رقمًا، فيُقبل الاثنان.
 */
const ONES = {
  'صفر': 0,
  'واحد': 1, 'وحده': 1, 'احد': 1, 'اول': 1,
  'اثنين': 2, 'اثنان': 2, 'ثنتين': 2, 'ثنين': 2, 'اثنتين': 2,
  'ثلاثه': 3, 'ثلاث': 3, 'تلاته': 3,
  'اربعه': 4, 'اربع': 4,
  'خمسه': 5, 'خمس': 5,
  'سته': 6, 'ست': 6,
  'سبعه': 7, 'سبع': 7,
  'ثمانيه': 8, 'ثمان': 8, 'ثمانه': 8, 'ثمانيا': 8,
  'تسعه': 9, 'تسع': 9,
  'عشره': 10, 'عشر': 10,
};

/** أحد عشر إلى تسعة عشر — بصيغها الفصيحة والدارجة */
const TEENS = {
  'احد عشر': 11, 'احدعشر': 11, 'حداعش': 11, 'حدعش': 11, 'احدعش': 11,
  'اثنا عشر': 12, 'اثني عشر': 12, 'اثنعش': 12, 'ثنعش': 12, 'اطنعش': 12,
  'ثلاثه عشر': 13, 'ثلاث عشره': 13, 'ثلثعش': 13, 'ثلاثطعش': 13,
  'اربعه عشر': 14, 'اربع عشره': 14, 'اربعطعش': 14, 'اربعتعش': 14,
  'خمسه عشر': 15, 'خمس عشره': 15, 'خمسطعش': 15, 'خمستعش': 15,
  'سته عشر': 16, 'ست عشره': 16, 'سطعش': 16, 'ستعش': 16,
  'سبعه عشر': 17, 'سبع عشره': 17, 'سبعطعش': 17, 'سبعتعش': 17,
  'ثمانيه عشر': 18, 'ثمان عشره': 18, 'ثمنطعش': 18, 'ثمانتعش': 18,
  'تسعه عشر': 19, 'تسع عشره': 19, 'تسعطعش': 19, 'تسعتعش': 19,
};

const TENS = {
  'عشرين': 20, 'ثلاثين': 30, 'تلاتين': 30, 'اربعين': 40, 'خمسين': 50,
  'ستين': 60, 'سبعين': 70, 'ثمانين': 80, 'تسعين': 90, 'مايه': 100, 'مئه': 100,
};

/**
 * القطعة تُنطق ترتيبًا لا عددًا: «القطعة الرابعة» لا «قطعة أربعة».
 * وهذه صيغة الكلام الغالبة، وكانت تسقط كلّها فتصل القطعة فارغةً إلى
 * الكابتن — وهي أهمّ من اسم المنطقة عند الباب.
 *
 * وجمعُ المفردات يقرأ الترتيب المركّب بلا جدولٍ ثانٍ:
 * «الحادية عشرة» = ١ + ١٠، و«الثانية عشرة» = ٢ + ١٠.
 *
 * والمفاتيح تُكتب هنا **بصورتها المكتوبة** ثمّ تمرّ على المطبِّع، لا
 * تُكتب مطبَّعةً باليد: «الأولى» تصير «الاولي» لا «الاولى»، فكُتبت أوّل
 * مرّةٍ بألفها المقصورة فلم تُطابَق أبدًا. وهو خطأٌ وقع من قبل في «إلى»،
 * ولا يظهر في القراءة — إنّما في القياس.
 */
const normKeys = (o) =>
  Object.fromEntries(Object.entries(o).map(([w, n]) => [ar.normalize(w), n]));

const ORDINALS = normKeys({
  'الأولى': 1, 'أولى': 1, 'الأول': 1, 'الحادية': 1, 'حادية': 1,
  'الثانية': 2, 'ثانية': 2, 'التانية': 2,
  'الثالثة': 3, 'ثالثة': 3, 'التالتة': 3,
  'الرابعة': 4, 'رابعة': 4,
  'الخامسة': 5, 'خامسة': 5,
  'السادسة': 6, 'سادسة': 6,
  'السابعة': 7, 'سابعة': 7,
  'الثامنة': 8, 'ثامنة': 8, 'التامنة': 8,
  'التاسعة': 9, 'تاسعة': 9,
  'العاشرة': 10, 'عاشرة': 10,
});

/**
 * يقرأ عددًا من نصّ عربيّ منطوق أو مكتوب بالأرقام.
 * «٤» و«4» و«أربعة» و«خمسة وعشرين» و«اثنعش» كلّها تُقرأ.
 * يعيد عددًا، أو `null` إن لم يكن في النصّ عدد.
 */
function readNumber(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  /* الرقم المكتوب أولًا — أوضح من أي تخمين على الكلمات */
  const digit = ar.toLatin(raw).match(/\d+/);
  if (digit) return Number(digit[0]);

  const words = ar.normalize(raw).replace(/[^ء-ي\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  /* «عشرة» بعد وحدة هي جزء من «أربعة عشر»، فتُجرَّب الأزواج قبل الأفراد */
  let total = null;
  for (let i = 0; i < words.length; i++) {
    const pair = words[i] + ' ' + (words[i + 1] || '');
    if (TEENS[pair] !== undefined) { total = (total || 0) + TEENS[pair]; i++; continue; }
    if (TEENS[words[i]] !== undefined) { total = (total || 0) + TEENS[words[i]]; continue; }
    if (TENS[words[i]] !== undefined) { total = (total || 0) + TENS[words[i]]; continue; }

    /* «وخمسة وعشرين» — الواو تصل الوحدة بالعشرة */
    const bare = words[i].replace(/^و/, '');
    if (ONES[words[i]] !== undefined) { total = (total || 0) + ONES[words[i]]; continue; }
    if (ORDINALS[words[i]] !== undefined) { total = (total || 0) + ORDINALS[words[i]]; continue; }
    if (ONES[bare] !== undefined) { total = (total || 0) + ONES[bare]; continue; }
    if (ORDINALS[bare] !== undefined) { total = (total || 0) + ORDINALS[bare]; continue; }
    if (TENS[bare] !== undefined) { total = (total || 0) + TENS[bare]; continue; }
  }
  return total;
}

/* ------------------------------ المناطق ------------------------------ */

/**
 * ── لماذا لم يعد البحث بـ`indexOf` ──────────────────────────────────
 * كان الاسم يُبحث عنه نصًّا داخل نصّ، بلا حدّ كلمة. و«السلام» منطقة في حولي،
 * فكانت **«السلام عليكم» تُقرأ منطقة استلام** — وهي تفتتح كل رسالة واتساب
 * تقريبًا. جُرّبت هذه الجملة كما تُكتب فعلًا:
 *
 *     «السلام عليكم، أبغى توصيل من السالمية قطعة ٤ إلى الجابرية قطعة ٧»
 *     الاستلام: السلام  ·  التسليم: السالمية  ·  والجابرية سقطت
 *
 * أي أن التحيّة أزاحت الطلب كلّه خانةً: الكابتن يستلم من مكانٍ لم يُذكر
 * ويسلّم في مكان الاستلام. ولم يكن ذلك يُرى في الشاشة، لأن ما يُعرض صحيحُ
 * الشكل: منطقتان من القائمة وقطعة.
 *
 * فصار النصّ يُقسَّم كلماتٍ أولًا، ولا يُطابَق إلّا على كلمةٍ كاملة أو عدّة
 * كلمات كاملة. و«عليكم» ليست كلمةً في «السلام»، فلا تلتقي بها.
 *
 * ── والزمن ──────────────────────────────────────────────────────────
 * كان الأمر ‏١١٥ بحثًا في النصّ لكل جملة، وصار جدولًا واحدًا (‏Map) يُبنى
 * مرّةً عند الإقلاع فيُسأل عن الكلمة وما بعدها سؤالًا واحدًا. فالزمن الآن
 * بعدد كلمات الرسالة لا بعدد مناطق الكويت — وهو ما يسمح بأن تكبر القائمة
 * والأسماء الدارجة معها بلا ثمنٍ في كل طلب.
 *
 * لكنّ أوّل صياغةٍ لهذا كانت **أبطأ** من المسح الخطّي الذي حلّت محلّه
 * (‏٣٣ جزءًا من المليون مقابل ١٥ على رسالةٍ واقعية)، لأن كل كلمةٍ كانت
 * تُوحَّد وقت القراءة وتُبنى منها أربع سلاسل تُسأل عنها. فنُقل التوحيد إلى
 * وقت البناء — تُخزَّن الصيغة بهمزتها وبلا همزتها معًا — وسُبق البحث بسؤالٍ
 * رخيص: هل هذه الكلمة أوّلُ اسمِ منطقةٍ أصلًا؟ وأكثرُ كلمات أي رسالة ليست
 * كذلك، فتُتخطّى بلا بحث. القياس هو ما دلّ على هذا، لا الشكل.
 */

/** أطول اسم منطقة بالكلمات («ضاحية عبدالله السالم» ثلاث) — يُحسب لا يُخمَّن */
let GRAM_MAX = 1;

/**
 * صيغة المفتاح: التطبيع نفسه الذي يمرّ به نصّ الرسالة، لا أكثر.
 *
 * وإسقاط الهمزة ليس هنا بل في `put`، لأن الصيغتين تُخزَّنان معًا: «الجهراء»
 * كما تُكتب، و«الجهرا» كما تُكتب مستعجلًا. ولو أُسقطت الهمزة هنا لضاعت
 * الصيغة الصحيحة نفسها — وهو ما وقع: سقطت الجهراء والزهراء والشهداء
 * والفيحاء وتيماء وميناء عبدالله من الجدول، ولم يبقَ إلّا خطأُ كتابتها.
 */
const key = (s) => ar.normalize(String(s)).toLowerCase().trim();

/**
 * الجدول: صيغةٌ مكتوبة ← { الاسم الرسمي، وهل تحتاج إشارة مكان }.
 *
 * تُولَّد لكل اسم صيغُه كما تُكتب فعلًا: باللاصقات العربية («بالسالمية»،
 * «للسالمية»، «والسالمية»)، وبلا أداة تعريف («سالمية»)، وملصوقًا بلا مسافة
 * («بنيدالقار») لأن التعرّف على الكلام يلصق ويفصل بلا قاعدة.
 *
 * والصيغة المجرّدة من «ال» **تحتاج إشارة مكان دائمًا**: «شرق» و«قبلة»
 * و«صديق» و«عيون» كلماتٌ عربية قبل أن تكون مناطق، ولا تصير مناطق إلّا حين
 * يسبقها «من» أو «إلى» أو تتبعها قطعة.
 */
const INDEX = new Map();

/**
 * يضيف مفتاحًا. والصيغة المولَّدة لا تطمس صيغةً مكتوبة: لو صادف أن لاصقةً
 * على اسمٍ أنتجت حروف اسمٍ آخر، فالمكتوب أولى بالمعنى من المولَّد.
 */
function put(key, name, needsSignal, primary, road) {
  if (!key) return;
  /* بهمزتها وبلا همزتها معًا: «الجهراء» و«الجهرا» مكانٌ واحد، والفرق يقع
     في الكتابة السريعة. وتُخزَّن الصيغتان هنا لئلّا تُوحَّد كلُّ كلمةٍ من
     كل رسالة وقت القراءة — التوحيد مرّةً عند البناء أرخص من ملايين المرّات. */
  for (const k of new Set([key, key.replace(/[ءـ]/g, '')])) {
    const had = INDEX.get(k);
    if (had && had.primary && !primary) continue;
    INDEX.set(k, { name, needsSignal, primary: !!primary, road: !!road });
    FIRST.add(k.split(' ', 1)[0]);
  }
}

/** أوّل كلمةٍ من كل مفتاح — يُسأل عنها قبل البحث فتُتخطّى أكثرُ الكلمات */
const FIRST = new Set();

/** لاصقات أداة التعريف كما تُكتب: «بالسالمية»، «للسالمية»، «والسالمية» */
const ARTICLE = ['ال', 'لل', 'بال', 'وال', 'فال', 'كال', 'بالـ'];
/** لاصقات على الاسم كما هو: «وحولي»، «لحولي» */
const BARE = ['و', 'ف', 'ب', 'ل', 'ك'];

function index(written, official, { road = false } = {}) {
  const k = key(written);
  if (!k) return;
  const soft = AREA.AMBIGUOUS.has(official) || AREA.AMBIGUOUS.has(written);
  GRAM_MAX = Math.max(GRAM_MAX, k.split(' ').length);

  put(k, official, soft, true, road);                    // مكتوبة كما هي
  put(k.replace(/ /g, ''), official, soft, false, road); // «بنيدالقار»
  for (const p of BARE) put(p + k, official, soft, false, road);   // «وحولي»

  /* والطريق لا يُجرَّد من أداته: «طريق الفحيحيل» تُقال بها دائمًا، وتجريدها
     يُنتج «الفحيحيل» فيعود العطبُ الذي وُجد الجدولُ لأجله. */
  if (!road && k.startsWith('ال')) {
    const stem = k.slice(2);
    /* المجرّدة من «ال» ظنّ لا يقين: تُقبل بإشارة مكان وحدها */
    put(stem, official, true);
    for (const p of ARTICLE) put(p + stem, official, soft);
    for (const p of BARE) put(p + stem, official, true);
  }
}

for (const name of AREA.ALL_AREAS) index(name, name);
for (const [said, official] of Object.entries(AREA.ALIASES)) index(said, official);

/* الطرق تدخل الجدول لتُبتلع أسماؤها كاملة، لا لتُملأ بها حقول. واسم الطريق
   أطول من اسم المنطقة التي بداخله، والمطابقة تأخذ الأطول — فـ«طريق
   الفحيحيل» تغلب «الفحيحيل» ولا يبقى منها ما يُلتقط. */
for (const road of AREA.ROADS) index(road, road, { road: true });

/* والاسم الملتبس يخرج من الفهرس أصلًا: لا يُملأ به حقل بحال، ويُترك
   لـ«هل تقصد؟» يسأل صاحبه.
   لكنّ السؤال يحتاج جوابًا يُفهم: لو ضغط الزبون «السالمي» فأُعيد إرسال
   الكلمة نفسها لعادت ملتبسةً ودار السؤال بلا نهاية. فيُفهرَس لكل خيارٍ
   شكلٌ مقيَّد بمحافظته («السالمي الجهراء»)، وهو ما يرسله الزرّ. */
for (const written of Object.keys(AREA.CONFUSABLE)) {
  for (const k of [key(written), key(written).replace(/[ءـ]/g, '')]) INDEX.delete(k);
}
for (const options of Object.values(AREA.CONFUSABLE)) {
  for (const name of options) index(`${name} ${AREA.AREA_TO_GOV[name]}`, name);
}

/** الشكل الذي يُرسل حين يختار الزبون: مقيَّدٌ بالمحافظة إن كان الاسم ملتبسًا */
const qualified = (name) =>
  AREA.CONFUSABLE[name] ? `${name} ${AREA.AREA_TO_GOV[name]}` : name;

/* اسمٌ دارجٌ يشير إلى منطقةٍ ليست في القائمة خطأٌ صامت: يُملأ حقلٌ بقيمةٍ
   يرفضها الخادم لاحقًا («… ليست من مناطق الكويت») فيُحرم الزبون طلبه بلا
   سبب مفهوم. فيُكشف عند الإقلاع لا عند أوّل زبون. */
for (const official of Object.values(AREA.ALIASES)) {
  if (!AREA.AREA_TO_GOV[official]) {
    throw new Error(`جدول الأسماء الدارجة يشير إلى «${official}» وليست في قائمة المناطق`);
  }
}

/**
 * كلمات تجعل ما بعدها مكانًا — إشارةٌ صريحة لا استنتاج.
 *
 * وتُطبَّع الكلمات هنا كما يُطبَّع النصّ الذي تُقارَن به، ولا تُكتب مطبَّعةً
 * باليد: «إلى» تصير «الي» بعد التطبيع (ى ← ي)، وكانت مكتوبةً «الى» في
 * قوائم الاتجاه فلم تُطابِق شيئًا قطّ. أثر ذلك أن «توصيل إلى الجابرية» كان
 * يملأ **الاستلام** بعنوان التسليم — فيذهب الكابتن ليستلم من حيث يجب أن
 * يسلّم. وما كان ليُرى: الحقل ممتلئ بمنطقةٍ صحيحة من القائمة.
 *
 * والقاعدة العامّة: ما يُقارَن بنصٍّ مطبَّع يُطبَّع بالأداة نفسها، لا بالنظر.
 */
const normSet = (words) => new Set(words.map((w) => ar.normalize(w).toLowerCase()));

/* «يوصل» و«توصيل» ليستا إشارتَي مكان: «أبغى أوصل هدية» ليس عنوانًا. جُرّبتا
   ثمّ نُزعتا لمّا التقطتا «قبل الظهر» في جملةٍ عن الوقت. */
const PLACE_BEFORE = normSet([
  'من', 'إلى', 'الى', 'في', 'عند', 'لين', 'حق', 'صوب', 'باتجاه',
  'منطقة', 'بمنطقة', 'لمنطقة', 'ضاحية', 'محافظة',
  'الاستلام', 'التسليم', 'العنوان', 'الوجهة', 'موقع',
]);

const NUMBER = /^[٠-٩0-9]+$/;

/**
 * يقسم النصّ كلماتٍ ومعها مواضعها.
 *
 * الكلمة تُؤخذ كما وردت في النصّ المطبَّع، بلا توحيدٍ إضافيّ هنا: الجدول
 * يحمل الصيغتين (بهمزة وبلا همزة) فيلتقيان عنده. ولو وُحِّدت الكلمة هنا
 * لدُفع ثمن ذلك في كل كلمةٍ من كل رسالة.
 *
 * وقد وقع الخطأ المقابل أوّل مرّة: وُحِّدت مفاتيح الجدول ولم تُوحَّد كلمات
 * النصّ، فصار مفتاح «ميناء الأحمدي» بلا همزة والنصّ بهمزة فلم يلتقيا،
 * وسقطت معهما كل منطقةٍ في اسمها همزة — الجهراء والزهراء والشهداء
 * والفيحاء وتيماء. الطرفان يلتقيان أو لا يلتقي أحد.
 */
/* حرفٌ مكرَّر ثلاثًا فأكثر مطُّ كتابةٍ لا هجاء: «الساااالمية» و«السالمية»
   مكانٌ واحد، ولا كلمة عربية فيها ثلاثة أحرفٍ متطابقة متتالية — فالطيّ
   آمن. ويُجرَّب أوّلًا بفحصٍ رخيص فلا يدفع ثمنَه إلّا ما فيه مطّ. */
const STRETCHED = /(.)\1\1/;
const unstretch = (w) => w.replace(/(.)\1{2,}/g, '$1');

function words(normText) {
  const out = [];
  const re = /[^\s،,.؟?!؛;:()"'\-–—/\\]+/g;
  let m;
  while ((m = re.exec(normText))) {
    const raw = m[0];
    out.push({ w: STRETCHED.test(raw) ? unstretch(raw) : raw, raw, at: m.index });
  }
  return out;
}

/**
 * يبحث عن كل منطقة مذكورة في النصّ، ومعها موضعها.
 *
 * `addressed`: النصّ كلّه عنوانٌ صريح («الاستلام: هدية») فلا تُطلَب إشارة
 * مكان — من كتب «الاستلام:» قال ما بعدها مكانٌ صراحةً.
 */
function findAreas(text, { addressed = false } = {}) {
  /* الدالّة مصدَّرة، وعقدها «نصٌّ مطبَّع» عقدٌ يُنسى: من مرّر نصًّا خامًا لم
     يحصل على خطأ بل على **لا شيء** — والصمت لا يُقرأ عطبًا. فيُفحص المدخل
     فحصًا رخيصًا مرّةً واحدة: إن كان فيه ما يغيّره التطبيع طُبِّع هنا،
     ومواضعُ ما يُعاد تكون في النصّ المطبَّع. والمستدعي الداخليّ يمرّر
     مطبَّعًا أصلًا فلا يدفع شيئًا. */
  const normText = /[ةأإآىؤئًٌٍَُِّْـ]/.test(text) ? ar.normalize(text) : text;
  const toks = words(normText);
  const hits = [];

  for (let i = 0; i < toks.length; i++) {
    /* السؤال الرخيص أوّلًا: أكثرُ كلمات الرسالة ليست أوّلَ اسمِ منطقة،
       فتُتخطّى بلا بناء سلاسل ولا بحثٍ في الجدول. */
    if (!FIRST.has(toks[i].w)) continue;

    /* تُبنى السلسلة كلمةً كلمةً ويُحتفَظ بأطول ما طابق: «صباح الأحمد
       البحرية» تغلب «صباح الأحمد». والبناء تراكميّ بلا نسخ مصفوفات. */
    let gram = toks[i].w;
    let best = null;
    const span = Math.min(GRAM_MAX, toks.length - i);
    for (let n = 1; n <= span; n++) {
      if (n > 1) gram += ' ' + toks[i + n - 1].w;
      const hit = INDEX.get(gram);
      if (hit && (addressed || !hit.needsSignal || hasPlaceSignal(toks, i, n))) best = { hit, n };
    }
    if (!best) continue;

    /* الطريق يُبتلع ولا يُملأ: مُنع اسمُ المنطقة الذي بداخله من الالتقاط
       (لأن المطابقة أخذت الأطول)، وهذا وحده هو المطلوب منه. والطريق نفسه
       يبقى في نصّ الشارع حيث يفيد الكابتن. */
    if (best.hit.road) { i += best.n - 1; continue; }

    const last = toks[i + best.n - 1];
    /* طول ما قُرئ لا طول الاسم الرسميّ: «الجليب» ستّة أحرف و«جليب الشيوخ»
       أحد عشر، ومن نزع الاسم الرسميّ من النصّ نزع ما ليس فيه. */
    /* الطول من النصّ كما ورد لا من صيغة المطابقة: المطّ يقصّر الصيغة
       («الساااالمية» ← «السالمية») ومن قصّ بها قصّ أقلّ ممّا في النصّ. */
    hits.push({ name: best.hit.name, at: toks[i].at, len: last.at + last.raw.length - toks[i].at });
    i += best.n - 1;                     // ما التُقط لا يُقرأ ثانيةً
  }
  return hits;
}

/**
 * هل في النصّ اسمٌ يحتمل موضعين؟ يعيد الكلمة وخياريها، أو `null`.
 * (انظر `CONFUSABLE` في `areas.js`: «السالمي» و«السالمية» بينهما مئةٌ
 * وخمسة وعشرون كيلومترًا، والكلمة التي يكتبها الزبون واحدة.)
 */
function findConfusable(text) {
  const toks = words(ar.normalize(String(text || '')).toLowerCase());
  for (const t of toks) {
    for (const [written, options] of Object.entries(AREA.CONFUSABLE)) {
      if (t.w === key(written)) return { word: written, options };
    }
  }
  return null;
}

/** إشارة مكان: كلمةُ اتجاهٍ قبلها، أو قطعةٌ بعدها */
function hasPlaceSignal(toks, i, n) {
  for (let k = 1; k <= 2 && i - k >= 0; k++) {
    if (PLACE_BEFORE.has(toks[i - k].w)) return true;
  }
  for (let k = 0; k < 3; k++) {
    const t = toks[i + n + k];
    if (!t) break;
    if (t.w === 'قطعه' || t.w === 'قطعة' || /^ق[٠-٩0-9]+$/.test(t.w)) return true;
    if (t.w === 'ق' && toks[i + n + k + 1] && NUMBER.test(toks[i + n + k + 1].w)) return true;
  }
  return false;
}

/* ------------------------------ الهاتف ------------------------------ */

/**
 * رقم كويتي: ثماني خانات تبدأ بـ٥ أو٦ أو٩، وقد يسبقها مفتاح الدولة.
 * ويُقرأ ولو نُطق مفرّقًا («٩٩ ٨٨ ٧٧ ٦٦») لأن التعرّف يباعد الخانات كثيرًا.
 */
function findPhone(text) {
  const flat = ar.toLatin(String(text || '')).replace(/[\s\-()]/g, '');
  const m = flat.match(/(?:\+?00?965)?([569]\d{7})(?!\d)/);
  if (m) return '+965' + m[1];
  return spokenPhone(text);
}

/** خاناتٌ منطوقةٌ واحدةً واحدة، بلا رقمٍ في النصّ */
const DIGIT_WORD = Object.fromEntries(
  Object.entries(ONES).filter(([w, n]) => n <= 9 && w !== 'اول'),
);

/**
 * الرقم يُملى خانةً خانة: «خمسة خمسة خمسة صفر واحد صفر اثنين صفر».
 * والتعرّف على الكلام يعيده أرقامًا في الغالب، لكنّه يعيده كلماتٍ حين
 * يتردّد المتكلّم أو يفصل بين الخانات — فيصل الطلب بلا رقم، ويُسأل
 * الزبون عن رقمٍ نطقه للتوّ كاملًا.
 *
 * ولا يُقرأ إلّا **ثماني خاناتٍ متتابعة** أوّلها ٥ أو ٦ أو ٩، فما دون
 * ذلك أعدادٌ في الكلام لا رقم: «قطعة خمسة» خانةٌ واحدة، و«خمسة وعشرين»
 * ليستا متتابعتين بهذا المعنى. والتتابع ينقطع بأيّ كلمةٍ ليست خانة.
 */
function spokenPhone(text) {
  const words = ar.normalize(String(text || '')).replace(/[^ء-ي\s]/g, ' ').split(/\s+/).filter(Boolean);
  /* التتابع يُقرأ بعد تمامه لا عند بلوغه الثامنة: من نطق مفتاح الدولة
     «تسعة ستة خمسة» ثمّ رقمه، تكون الخانات الثماني الأولى منه مفتاحًا
     وخمسًا من الرقم — فتؤخذ الأخيرة من التتابع لا الأولى. */
  const runs = [[]];
  for (const w of words) {
    const d = DIGIT_WORD[w] !== undefined ? DIGIT_WORD[w] : DIGIT_WORD[w.replace(/^و/, '')];
    if (d === undefined) { if (runs[runs.length - 1].length) runs.push([]); continue; }
    runs[runs.length - 1].push(d);
  }
  for (const run of runs) {
    if (run.length < 8) continue;
    const eight = run.slice(-8);
    if ([5, 6, 9].includes(eight[0])) return '+965' + eight.join('');
  }
  return null;
}

/* ------------------------------ الاسم ------------------------------ */

/**
 * الاسم لا يُلتقط إلّا بعد علامة صريحة («اسمي…»).
 * وبلا علامة لا يُخمَّن: أي كلمتين في الجملة قد تبدوان اسمًا، واسمٌ خاطئ على
 * الطلب يصل الكابتن به إلى الباب فينادي أحدًا لا وجود له.
 */
const NAME_MARKERS = ['اسمي', 'الاسم', 'اسمه', 'اسمها', 'معك', 'معاك', 'انا اسمي'];

/**
 * حشوُ الكلام وتحيّاته — ليس اسمًا وإن وقع موقع الجواب.
 *
 * سأل الوكيل «ما اسمك؟» فقال الزبون «اممم» وهو يفكّر، فصار **اسمَ صاحب
 * الطلب**: «تمام — الاسم اممم». وهو يمضي إلى الكابتن فينادي به أحدًا عند
 * الباب. وكذلك من ردّ بـ«هلا» أو «شكرًا» أو «لا أدري».
 *
 * ولا يُوسَّع هذا الجدول بالظنّ: كلُّ كلمةٍ فيه تمنع اسمًا حقيقيًّا لو
 * كانت اسمًا. فـ«زين» و«أمل» و«نور» ليست منه وإن جاز أن تكون حشوًا.
 */
const FILLER = normSet([
  'امم', 'ام', 'اه', 'اها', 'هم', 'همم', 'اوف', 'يعني', 'يعنى',
  'ايه', 'اي', 'ايوه', 'ايوا', 'نعم', 'لا', 'اوك', 'اوكي', 'اوكيه',
  'طيب', 'ماشي', 'خلاص', 'بس', 'تمام', 'زبده', 'عادي',
  'هلا', 'هلو', 'مرحبا', 'اهلا', 'السلام', 'شكرا', 'مشكور', 'مشكوره', 'تسلم',
  'شنو', 'وش', 'ليش', 'وين', 'متى', 'كم', 'ها', 'ادري', 'ماادري',
  'ok', 'okay', 'hi', 'hello', 'hmm', 'yes', 'no', 'thanks',
]);

/** أهذا حشوٌ لا اسم؟ يُقاس على الكلمات كلّها: «لا ادري» حشوٌ بكلمتيه */
function isFiller(text) {
  const w = words(ar.normalize(String(text || '')).toLowerCase()).map((t) => t.w).filter(Boolean);
  if (!w.length) return true;
  return w.every((x) => FILLER.has(x));
}

/* فاصلٌ يقف عنده الاسم. كان يُمحى محوًا، فيمتدّ الاسم عبر الجملة التالية
   ما لم تبدأ بكلمةٍ وظيفية: «اسمي نورة، الاستلام من السالمية» أعطت الاسم
   «نورة الاستلام» — والكابتن ينادي به على الباب. والاسم لا يعبر فاصلة. */
const BREAK = '\u0000';

function findName(text) {
  const clean = String(text || '')
    .replace(/[،,.؟?!؛;\n]/g, ` ${BREAK} `)
    .replace(/\s+/g, ' ').trim();
  const words = clean.split(' ');
  const norm = words.map((w) => ar.normalize(w).toLowerCase());
  let found = null;
  for (let i = 0; i < norm.length; i++) {
    if (!NAME_MARKERS.includes(norm[i])) continue;
    const rest = words.slice(i + 1, i + 4);
    /* يقف الاسم عند أول كلمة وظيفية — «اسمي منى من السالمية» ليس اسمًا كلّه.
       وتُجرَّب الكلمة بواوها وبلا واوها: «ورقمي» تُوقف الاسم كما توقفه
       «رقمي»، ولا يضرّ ذلك اسمًا يبدأ بواو لأن «وليد» بلا واوها ليست وقفًا. */
    const stop = ['من', 'الى', 'في', 'ب', 'رقمي', 'رقم', 'هاتفي', 'تلفوني',
                  'ابغى', 'ابي', 'اريد', 'عندي', 'ياخذ', 'وصل'];
    /* تُجرَّد الواو وأداة التعريف معًا: «ورقمي» كانت تقف، و«والرقم» لا —
       لأن الواو وحدها تُنزع فيبقى «الرقم» وليس في القائمة. فكان
       «اسمي منى والرقم ٦٦٧٧٨٨٩٩» يعطي الاسم «منى والرقم ٦٦٧٧٨٨٩٩»،
       فينادي الكابتن على الباب باسمٍ فيه رقم هاتف. */
    const isStop = (w) => {
      const n = ar.normalize(w).toLowerCase();
      const noWaw = n.replace(/^و/, '');
      return stop.includes(n) || stop.includes(noWaw) || stop.includes(noWaw.replace(/^ال/, ''));
    };
    /* ورقمٌ ليس جزءًا من اسم: يقف الاسم عنده مهما كانت الكلمة التي قبله */
    const isNumber = (w) => /^[٠-٩0-9+()\-\s]+$/.test(w);
    const out = [];
    for (const w of rest) {
      if (w === BREAK || isStop(w) || isNumber(w)) break;
      out.push(w);
    }
    /* **الأخير يفوز، لا الأوّل.**
       الحديث يتراكم، والاسم قد يُقال مرّتين: مرّةً خطأً ومرّةً تصحيحًا. وكان
       يُؤخذ أوّل ما وُجد، فيبقى الخطأ الأوّل مهما صحّح الزبون. قِيس ذلك في
       حوارٍ كامل: صحّح اسمه فرآه صحيحًا دورةً واحدة، ثمّ عاد الخطأ في الدورة
       التالية بلا سبب ظاهر — لأن الجملة الأحدث لم تعد هي «آخر ما قيل».
       وآخرُ ما قاله المرء عن اسمه هو اسمه. */
    if (out.length) found = out.join(' ');
  }
  return found;
  return null;
}

/* ------------------------------ المركبة ------------------------------ */

const VEHICLE_WORDS = [
  { key: 'reefer', words: ['مبرد', 'مبرده', 'مبردة', 'ثلاجه', 'مثلج', 'بارد'] },
  { key: 'van', words: ['فان', 'ونيت', 'بكب', 'شاحنه', 'نقل'] },
  { key: 'bike', words: ['دراجه', 'دباب', 'موتر سايكل', 'موتسكل'] },
  { key: 'sedan', words: ['سيدان', 'سياره', 'تاكسي'] },
];

function findVehicle(normText) {
  for (const v of VEHICLE_WORDS) {
    for (const w of v.words) {
      if (new RegExp('(^|\\s)' + ar.normalize(w) + '(\\s|$)').test(normText)) return v.key;
    }
  }
  return null;
}

const URGENT_WORDS = ['مستعجل', 'عاجل', 'بسرعه', 'ضروري', 'الحين', 'حالا'];

function findPriority(normText) {
  return URGENT_WORDS.some((w) => normText.includes(ar.normalize(w))) ? 'urgent' : null;
}

/* ------------------------------ القراءة ------------------------------ */

/* ------------------------- السطور المعنونة ------------------------- */

/**
 * الطلب يصل ملصوقًا من واتساب في سطور معنونة أكثر ممّا يصل جملةً واحدة:
 *
 *     الاسم: منى الصباح
 *     الهاتف: ٩٩٨٨٧٧٦٦
 *     الاستلام: السالمية ق٤ ش سالم المبارك
 *     المبلغ: ١٢٫٥٠٠
 *
 * والعنوان أوثق من أي استنتاج: من كتب «الاسم:» قال ما بعدها اسمٌ صراحةً.
 * فتُقرأ السطور المعنونة أولًا، ويبقى الاستنتاج الحرّ لما لم يُعنون.
 *
 * لكنّ العنوان **لا يتخطّى التحقّق**: «الهاتف: ٤» عنوانٌ صريح وقيمةٌ ليست
 * هاتفًا، فتُهمل. العنوان يقترح، والمدقّق يحكم.
 */
const LABELS = [
  ['customer_name', ['الاسم', 'اسم العميل', 'اسم الزبون', 'العميل', 'الزبون', 'المستلم']],
  ['customer_phone', ['الهاتف', 'التلفون', 'الجوال', 'الموبايل', 'رقم العميل', 'الرقم', 'رقم']],
  ['pickup', ['الاستلام', 'موقع الاستلام', 'عنوان الاستلام', 'من', 'الاستقبال', 'المصدر']],
  ['dropoff', ['التسليم', 'موقع التسليم', 'عنوان التسليم', 'الى', 'التوصيل', 'الوجهه', 'العنوان']],
  ['cod_amount', ['المبلغ', 'التحصيل', 'المبلغ المطلوب تحصيله', 'المطلوب تحصيله', 'قيمه الطلب', 'المبلغ المطلوب']],
  ['delivery_fee', ['رسوم التوصيل', 'الرسوم', 'اجره التوصيل', 'الاجره', 'التوصيله']],
  ['notes', ['ملاحظات', 'ملاحظه', 'الملاحظات', 'تفاصيل', 'التفاصيل']],
  ['vehicle', ['المركبه', 'نوع المركبه', 'السياره']],
  ['priority', ['الاولويه', 'الاستعجال']],
];

/** يقسم النصّ إلى `{ عنوان: قيمة }` وما بقي بلا عنوان */
function splitLabelled(text) {
  const found = {};
  const rest = [];
  /* السطر، أو ما بين فاصلتين — الملصوق يأتي بالسطور وبالفواصل معًا */
  for (const piece of String(text).split(/[\n\r]+|(?<=\S)\s*[،,]\s*(?=[^\s:،,]{2,12}\s*:)/)) {
    const m = piece.match(/^\s*([^:：\n]{2,24})\s*[:：]\s*(.+)$/);
    if (!m) { rest.push(piece); continue; }
    const key = ar.normalize(m[1]).trim().toLowerCase().replace(/^ال(?=.{3})/, 'ال');
    const hit = LABELS.find(([, names]) => names.some((n) => ar.normalize(n).toLowerCase() === key));
    if (!hit) { rest.push(piece); continue; }
    if (found[hit[0]] === undefined) found[hit[0]] = m[2].trim();
    else rest.push(piece);
  }
  return { found, rest: rest.join('\n') };
}

/** يقرأ مبلغًا بالدينار — «١٢٫٥٠٠» و«12.5» و«٣ د.ك» سواء */
function readMoney(text) {
  const m = ar.toLatin(String(text || '')).match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * يقرأ عنوانًا مكتوبًا في سطر واحد: «السالمية ق٤ ش سالم المبارك».
 * ما ليس منطقةً ولا قطعةً هو الشارع والمبنى — لا تُحصر أسماء الشوارع.
 */
function parseAddressValue(value) {
  const text = String(value || '');
  const norm = ar.normalize(text).toLowerCase().replace(/\s+/g, ' ');
  /* السطر كلّه عنوانٌ صريح: من كتب «الاستلام:» قال ما بعدها مكان، فلا يُطلب
     دليلٌ إضافيّ على أن «هدية» منطقة. */
  const hit = findAreas(norm, { addressed: true })[0] || null;

  /* «قطعة ٤» و«ق٤» و«ق ٤» — والاختصار شائع في الملصوق.
     و«ق» تُشترط في أوّل كلمةٍ ويتلوها رقم، وإلّا التقطت القافَ **داخل اسم
     المنطقة نفسها**: «المنقف قطعة ٩» طابقت قاف «المنقف» فقرأت ما بعدها
     «ف قطعه» فلم تجد رقمًا — فسقطت القطعة من كل منطقةٍ في اسمها قاف:
     المنقف والقبلة والقصور والرقة والعقيلة والقادسية وغيرها. */
  const bm = norm.match(/(?:قطعه\s*[.:]?\s*|(?<![ء-ي])ق\s*[.:]?\s*(?=[٠-٩0-9]))(\S+(?:\s+\S+)?)/);
  const block = bm ? readNumber(bm[1]) : null;

  /* الشارع = ما بقي بعد نزع اسم المنطقة وعبارة القطعة */
  let street = text;
  if (hit) street = street.slice(0, hit.at) + ' ' + street.slice(hit.at + hit.len);
  street = street
    .replace(/(?:قطعه|قطعة|ق)\s*[.:]?\s*[٠-٩0-9]+/g, ' ')
    .replace(/^[\s،,.\-–—]+|[\s،,.\-–—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { area: hit?.name || null, block, street: street.length >= 2 ? street : null };
}

/* تُطبَّع كما يُطبَّع النصّ — انظر `normSet` أعلاه: «إلى» المكتوبة باليد
   لا تساوي «الي» التي تصل من التطبيع. */
const FROM_WORDS = normSet(['من']);
const TO_WORDS = normSet(['إلى', 'الى', 'ل', 'لين', 'حق', 'عند']);

/** موضع أول كلمة اتجاه قبل موضع المنطقة — أيّهما أقرب */
function directionBefore(normText, at) {
  const before = normText.slice(0, at);
  const words = before.split(/\s+/);
  for (let i = words.length - 1; i >= 0 && i > words.length - 5; i--) {
    const w = words[i];
    if (FROM_WORDS.has(w)) return 'from';
    if (TO_WORDS.has(w)) return 'to';
  }
  return null;
}

/**
 * أدوات النفي التي تسبق الاسم في الكلام الكويتي.
 * و«لا» ليست منها عمدًا: هي في الغالب فاتحةُ تصحيحٍ لا نفيَ اسمٍ بعينه
 * («لا، الاستلام من حولي») — فعدُّها نفيًا يُسقط المنطقة الصحيحة نفسها.
 */
const NEGATE = new Set(['مو', 'موب', 'مب', 'مهو', 'ماهو', 'مش', 'ليس', 'ليست']);

/**
 * منطقةٌ منفيّةٌ صراحةً: «مو السالمية».
 *
 * وهذا قيس لا تخمين. الزبون يصحّح فيقول «لا من حولي **مو السالمية**»،
 * فكانت السالمية — وهي التي نفاها بلفظه — تقع في خانة التسليم لأنها
 * ثاني منطقةٍ في الجملة وليس قبلها كلمةُ اتجاه. أي أن **نفيَ المكان كان
 * يصيّره وجهةَ التسليم**، ويمضي الكابتن إلى بابٍ استثناه الزبون نصًّا.
 *
 * فالمنفيّ يُسقط ولا يُملأ به شيء، ويبقى ما ثبت في الأدوار السابقة.
 */
function negatedBefore(normText, at) {
  const words = normText.slice(0, at).trim().split(/\s+/);
  const last = words[words.length - 1];
  if (NEGATE.has(last)) return true;
  /* «مو من السالمية» — أداةُ نفيٍ ثمّ كلمةُ اتجاه */
  const prev = words[words.length - 2];
  return !!prev && NEGATE.has(prev) && (FROM_WORDS.has(last) || TO_WORDS.has(last));
}

/**
 * رقم القطعة المذكور بعد منطقةٍ وقبل التي تليها.
 * و«ق٤» و«ق ٤» تُقرآن كما تُقرأ «قطعة ٤»: الاختصار هو ما يُكتب فعلًا في
 * الرسائل، وكان يُهمل هنا وإن قُرئ في العنوان المعنون — فيُسأل الزبون عن
 * قطعةٍ كتبها.
 */
function blockNear(normText, at, nextAt) {
  const span = normText.slice(at, nextAt === undefined ? normText.length : nextAt);
  const m = span.match(/(?:قطعه\s*[.:]?\s*|(?<![ء-ي])ق\s*[.:]?\s*(?=[٠-٩0-9]))(\S+(?:\s+\S+)?)/);
  if (!m) return null;
  return readNumber(m[1]);
}

/**
 * يقرأ نصّ الطلب المنطوق ويقترح حقوله.
 *
 * يعيد `{ fields, heard, missing, transcript }`:
 *   fields   — ما فُهم، وكل حقل لم يُفهم قيمته `null`
 *   heard    — ما التُقط، بصيغة يقرأها الموظّف ويقارنها بالتسجيل
 *   missing  — ما لم يُذكر ولماذا يُسأل عنه
 */
function parseOrder(transcript) {
  const text = String(transcript || '').trim();
  if (!text) {
    return {
      transcript: '', fields: {}, heard: [],
      missing: [{ field: 'transcript', why: 'لا نصّ — لم يصل من التسجيل كلام' }],
    };
  }

  /* المعنون أولًا، ثمّ الاستنتاج الحرّ على ما بقي بلا عنوان */
  const { found, rest } = splitLabelled(text);
  const free = found.pickup !== undefined || found.dropoff !== undefined ? rest : text;

  const norm = ar.normalize(free).toLowerCase().replace(/[،,.؟?!]/g, ' ').replace(/\s+/g, ' ');
  const areas = findAreas(norm);

  /* الاتجاه من كلمة «من»/«إلى» قبل المنطقة. وبلا كلمات: الأولى استلام
     والثانية تسليم — وهو ترتيب الكلام الطبيعي «من كذا إلى كذا». */
  let pickup = null;
  let dropoff = null;
  /* المصرَّح به يعلو على ما وقع في خانته بالترتيب وحده. الناس يكرّرون:
     «من السالمية… يعني من السالمية إلى حولي» — فكانت السالميةُ الثانية
     تملأ خانة التسليم بالترتيب، وتسقط «حولي» وقد صُرّح بها بـ«إلى». */
  let pickupSaid = false;
  let dropoffSaid = false;
  for (let i = 0; i < areas.length; i++) {
    if (negatedBefore(norm, areas[i].at)) continue;   // «مو السالمية» ليست وجهة
    const dir = directionBefore(norm, areas[i].at);
    const block = blockNear(norm, areas[i].at, areas[i + 1]?.at);
    const entry = { area: areas[i].name, block, street: null };
    if (dir === 'from' && !pickupSaid) { pickup = entry; pickupSaid = true; }
    else if (dir === 'to' && !dropoffSaid) { dropoff = entry; dropoffSaid = true; }
    else if (!pickup) pickup = entry;
    else if (!dropoff) dropoff = entry;
  }

  /* العنوان الصريح يغلب المستنتج */
  if (found.pickup !== undefined) pickup = parseAddressValue(found.pickup);
  if (found.dropoff !== undefined) dropoff = parseAddressValue(found.dropoff);

  const fields = {};
  const heard = [];
  const missing = [];

  const name = found.customer_name || findName(text);
  if (name) { fields.customer_name = name; heard.push(`الاسم: ${name}`); }
  else missing.push({ field: 'customer_name', why: 'لم يُذكر اسم الزبون' });

  /* العنوان يقترح والمدقّق يحكم: «الهاتف: ٤» عنوانٌ صريح وقيمةٌ ليست هاتفًا،
     فتُهمل ولا تُملأ. ولا يُبحث عن هاتف في النصّ كلّه إلّا إن لم يُعنون. */
  const phone = found.customer_phone !== undefined
    ? findPhone(found.customer_phone)
    : findPhone(text);
  /* الهاتف يُعلَّم يسارَ الاتجاه، وإلّا قفزت «+» إلى آخر الرقم في سطر عربي */
  if (phone) { fields.customer_phone = phone; heard.push(`الهاتف: ${ar.ltr(ar.digits(phone))}`); }
  else missing.push({ field: 'customer_phone', why: 'لم يُذكر رقم هاتف كويتي واضح' });

  for (const [side, got, label, prefix] of [
    ['pickup', pickup, 'الاستلام', 'pickup'],
    ['dropoff', dropoff, 'التسليم', 'dropoff'],
  ]) {
    if (!got) {
      missing.push({ field: `${prefix}_area`, why: `لم تُذكر منطقة ${label} بين مناطق الكويت` });
      continue;
    }

    /* سطرٌ معنون بمنطقة لا تُعرف. الشارع يُحفظ — فيه معلومة — أمّا المنطقة
       فتبقى فارغة ويُقال ذلك: أسوأ ما يقع أن يمرّ سطرٌ كُتب فيه مكانٌ ولم
       يُفهم، فلا يُملأ حقلٌ ولا يُنبَّه أحد. */
    if (!got.area) {
      if (got.street) { fields[`${prefix}_street`] = got.street; heard.push(`شارع ${label}: ${got.street}`); }
      /* «هل تقصد…؟» ولا يُملأ: الاقتراح سؤال يُعرض على الموظّف، لا قيمة
         تُوضع في حقل. والفرق أن الخطأ المعروض يُصحَّح، والمُطبَّق يمرّ. */
      const said = String(found[side] || '').trim();
      const near = SIM.closestInText(said, AREA.ALL_AREAS, { skip: isFiller });
      missing.push({
        field: `${prefix}_area`,
        why: near
          ? `منطقة ${label}: «${near.word}» ليست من مناطق الكويت — هل تقصد «${near.name}»؟`
          : `منطقة ${label} غير معروفة — «${said}» ليست من مناطق الكويت`,
        /* الكلمة المخطئة بقيت في «الشارع» لأنها لم تُعرف منطقةً. فإن قُبل
           الاقتراح وجب أن تخرج منه، وإلّا صار العنوان «السالمية، السالمي». */
        ...(near ? { hint: near.name, hintFrom: near.word } : {}),
      });
      continue;
    }

    fields[`${prefix}_area`] = got.area;
    const gov = AREA.AREA_TO_GOV[got.area];
    if (side === 'pickup') fields.governorate = gov;
    else fields.dropoff_governorate = gov;

    if (got.block === null) {
      heard.push(`${label}: ${got.area} (بلا قطعة)`);
      missing.push({ field: `${prefix}_block`, why: `لم تُذكر قطعة ${label}` });
    } else {
      const read = AREA.readBlock(got.block, got.area);
      if (read.ok) {
        fields[`${prefix}_block`] = String(read.block);
        heard.push(`${label}: ${got.area}، قطعة ${ar.digits(read.block)}`);
      } else {
        /* رقم سُمع لكنه خارج المدى — يُقال ولا يُملأ */
        heard.push(`${label}: ${got.area}`);
        missing.push({ field: `${prefix}_block`, why: read.message });
      }
    }

    if (got.street) {
      fields[`${prefix}_street`] = got.street;
      heard.push(`شارع ${label}: ${got.street}`);
    }
  }

  /* المبالغ لا تُلتقط إلّا معنونةً.
     في «قطعة ٤ شارع ١٢» ثلاثة أرقام لا علاقة لها بالمال، وأيّها اخترتُ
     كمبلغٍ كنتُ مخطئًا. وخطأ المال يُصرف من جيب أحدهم قبل أن ينتبه له
     أحد — بخلاف خطأ العنوان الذي يظهر ساعة التسليم. فلا تخمين هنا. */
  for (const [key, label, hint] of [
    ['cod_amount', 'المبلغ المطلوب تحصيله', 'المبلغ'],
    ['delivery_fee', 'رسوم التوصيل', 'الرسوم'],
  ]) {
    if (found[key] === undefined) continue;
    const money = readMoney(found[key]);
    if (money === null) {
      missing.push({ field: key, why: `«${hint}» مكتوب ولم يُفهم منه مبلغ` });
      continue;
    }
    fields[key] = money;
    heard.push(`${label}: ${ar.money ? ar.money(money) : ar.digits(money)}`);
  }

  if (found.notes) { fields.notes = found.notes; heard.push(`ملاحظات: ${found.notes}`); }

  const vehicle = found.vehicle ? findVehicle(ar.normalize(found.vehicle).toLowerCase()) : findVehicle(norm);
  if (vehicle) { fields.vehicle = vehicle; heard.push(`المركبة: ${D.VEHICLES[vehicle]}`); }

  const priority = findPriority(ar.normalize(text).toLowerCase());
  if (priority) { fields.priority = priority; heard.push(`الأولوية: ${D.PRIORITIES[priority]}`); }

  /* `stated`: هل صُرّح بالجهة بحرفٍ («من كذا»، «إلى كذا») أم وقعت في خانتها
     بالترتيب وحده؟ يحتاجه المسار العامّ: عنده استدلالٌ على الجهة من كلماتٍ
     في الجملة، وذلك الاستدلال يجب ألّا يعلو على تصريحٍ صريح. */
  /* **اسمٌ يحتمل موضعين لا يُقال عنه إنّه ليس منطقة.**
     «السالمي» منطقةٌ في الجهراء فعلًا، وقول الوكيل «ليست من مناطق الكويت»
     كذبٌ على الزبون يجعله يشكّ في نفسه ويعيد كتابة ما كتبه صحيحًا. الصواب
     أن يُقال ما هو حقّ: الاسم معروف، والملتبس أيّ الموضعين أراد. */
  const confused = findConfusable(text);
  /* ولا يُعاد السؤال بعد أن أُجيب: من اختار «السالمي» صار في حقله، وبقاء
     الكلمة الملتبسة في نصّ الحديث كان يُعيد السؤال على الحقل التالي —
     فيرى الزبون سؤالًا أجاب عنه للتوّ معلّقًا على غير موضعه. */
  const answeredIt = confused && confused.options.some(
    (o) => fields.pickup_area === o || fields.dropoff_area === o);
  if (confused && !answeredIt) {
    const [a, b] = confused.options;
    const where = (n) => `${n} (${AREA.AREA_TO_GOV[n] || '—'})`;
    for (const m of missing) {
      if (!m.field.endsWith('_area') || m.hint) continue;
      m.why = `«${confused.word}» تحتمل موضعين متباعدين: ${where(a)} أو ${where(b)}. أيّهما؟`;
      m.choices = confused.options;
      /* ما يُرسل عند الاختيار — مقيَّدٌ بالمحافظة للاسم الملتبس، وإلّا عاد
         السؤال على نفسه. والمعروض يبقى الاسم وحده. */
      m.choiceValues = confused.options.map(qualified);
      m.choiceFrom = confused.word;
      break;
    }
  }

  return { transcript: text, fields, heard, missing,
    stated: { pickup: pickupSaid, dropoff: dropoffSaid } };
}

module.exports = {
  parseOrder, readNumber, readMoney, findPhone, findName, findAreas, isFiller,
  splitLabelled, parseAddressValue, LABELS, AREA_INDEX: INDEX,
};
