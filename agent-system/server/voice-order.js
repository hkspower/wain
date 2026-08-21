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
 * ولهذا لا يوجد هنا تطابق تقريبيّ (fuzzy) على أسماء المناطق: التطابق إمّا
 * على الاسم بعد التطبيع أو لا شيء. والتطبيع يكفي لما يقع فعلًا — «السالميه»
 * و«السالمية» سواء — أمّا «السالمي» فليس منطقة، ولا يُخمَّن أنها السالمية.
 */

const ar = require('arabic-kit');
const AREA = require('./areas');
const D = require('./domain');

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
    if (ONES[bare] !== undefined) { total = (total || 0) + ONES[bare]; continue; }
    if (TENS[bare] !== undefined) { total = (total || 0) + TENS[bare]; continue; }
  }
  return total;
}

/* ------------------------------ المناطق ------------------------------ */

/**
 * فهرس المناطق بعد التطبيع — يُبنى مرّةً واحدة.
 * التطبيع يوحّد ة/ه وأ/ا وى/ي، وهو ما يقع فعلًا في نصّ التعرّف على الكلام.
 */
const AREA_INDEX = AREA.ALL_AREAS
  .map((name) => ({ name, key: ar.normalize(name).toLowerCase() }))
  .sort((a, b) => b.key.length - a.key.length); // الأطول أولًا: «أبو حليفة» قبل «أبو»

/** يبحث عن كل منطقة مذكورة في النصّ، ومعها موضعها */
function findAreas(normText) {
  const hits = [];
  const taken = [];
  for (const area of AREA_INDEX) {
    let from = 0;
    for (;;) {
      const at = normText.indexOf(area.key, from);
      if (at < 0) break;
      from = at + area.key.length;
      /* منطقة داخل اسم منطقة أطول سبق التقاطها لا تُحسب مرّتين */
      if (taken.some(([s, e]) => at >= s && at < e)) continue;
      taken.push([at, from]);
      hits.push({ name: area.name, at });
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

/* ------------------------------ الهاتف ------------------------------ */

/**
 * رقم كويتي: ثماني خانات تبدأ بـ٥ أو٦ أو٩، وقد يسبقها مفتاح الدولة.
 * ويُقرأ ولو نُطق مفرّقًا («٩٩ ٨٨ ٧٧ ٦٦») لأن التعرّف يباعد الخانات كثيرًا.
 */
function findPhone(text) {
  const flat = ar.toLatin(String(text || '')).replace(/[\s\-()]/g, '');
  const m = flat.match(/(?:\+?00?965)?([569]\d{7})(?!\d)/);
  return m ? '+965' + m[1] : null;
}

/* ------------------------------ الاسم ------------------------------ */

/**
 * الاسم لا يُلتقط إلّا بعد علامة صريحة («اسمي…»).
 * وبلا علامة لا يُخمَّن: أي كلمتين في الجملة قد تبدوان اسمًا، واسمٌ خاطئ على
 * الطلب يصل الكابتن به إلى الباب فينادي أحدًا لا وجود له.
 */
const NAME_MARKERS = ['اسمي', 'الاسم', 'اسمه', 'اسمها', 'معك', 'معاك', 'انا اسمي'];

function findName(text) {
  const clean = String(text || '').replace(/[،,.؟?!]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ');
  const norm = words.map((w) => ar.normalize(w).toLowerCase());
  for (let i = 0; i < norm.length; i++) {
    if (!NAME_MARKERS.includes(norm[i])) continue;
    const rest = words.slice(i + 1, i + 4);
    /* يقف الاسم عند أول كلمة وظيفية — «اسمي منى من السالمية» ليس اسمًا كلّه.
       وتُجرَّب الكلمة بواوها وبلا واوها: «ورقمي» تُوقف الاسم كما توقفه
       «رقمي»، ولا يضرّ ذلك اسمًا يبدأ بواو لأن «وليد» بلا واوها ليست وقفًا. */
    const stop = ['من', 'الى', 'في', 'ب', 'رقمي', 'رقم', 'هاتفي', 'تلفوني',
                  'ابغى', 'ابي', 'اريد', 'عندي', 'ياخذ', 'وصل'];
    const isStop = (w) => {
      const n = ar.normalize(w).toLowerCase();
      return stop.includes(n) || stop.includes(n.replace(/^و/, ''));
    };
    const out = [];
    for (const w of rest) {
      if (isStop(w)) break;
      out.push(w);
    }
    if (out.length) return out.join(' ');
  }
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

const FROM_WORDS = ['من'];
const TO_WORDS = ['الى', 'ل', 'لين', 'حق', 'عند'];

/** موضع أول كلمة اتجاه قبل موضع المنطقة — أيّهما أقرب */
function directionBefore(normText, at) {
  const before = normText.slice(0, at);
  const words = before.split(/\s+/);
  for (let i = words.length - 1; i >= 0 && i > words.length - 5; i--) {
    const w = words[i];
    if (FROM_WORDS.includes(w)) return 'from';
    if (TO_WORDS.includes(w)) return 'to';
  }
  return null;
}

/** رقم القطعة المذكور بعد منطقةٍ وقبل التي تليها */
function blockNear(normText, at, nextAt) {
  const span = normText.slice(at, nextAt === undefined ? normText.length : nextAt);
  const m = span.match(/قطعه\s+(\S+(?:\s+\S+)?)/);
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

  const norm = ar.normalize(text).toLowerCase().replace(/[،,.؟?!]/g, ' ').replace(/\s+/g, ' ');
  const areas = findAreas(norm);

  /* الاتجاه من كلمة «من»/«إلى» قبل المنطقة. وبلا كلمات: الأولى استلام
     والثانية تسليم — وهو ترتيب الكلام الطبيعي «من كذا إلى كذا». */
  let pickup = null;
  let dropoff = null;
  for (let i = 0; i < areas.length; i++) {
    const dir = directionBefore(norm, areas[i].at);
    const block = blockNear(norm, areas[i].at, areas[i + 1]?.at);
    const entry = { area: areas[i].name, block };
    if (dir === 'from' && !pickup) pickup = entry;
    else if (dir === 'to' && !dropoff) dropoff = entry;
    else if (!pickup) pickup = entry;
    else if (!dropoff) dropoff = entry;
  }

  const fields = {};
  const heard = [];
  const missing = [];

  const name = findName(text);
  if (name) { fields.customer_name = name; heard.push(`الاسم: ${name}`); }
  else missing.push({ field: 'customer_name', why: 'لم يُذكر اسم الزبون' });

  const phone = findPhone(text);
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
  }

  const vehicle = findVehicle(norm);
  if (vehicle) { fields.vehicle = vehicle; heard.push(`المركبة: ${D.VEHICLES[vehicle]}`); }

  const priority = findPriority(norm);
  if (priority) { fields.priority = priority; heard.push(`الأولوية: ${D.PRIORITIES[priority]}`); }

  return { transcript: text, fields, heard, missing };
}

module.exports = { parseOrder, readNumber, findPhone, findName, findAreas, AREA_INDEX };
