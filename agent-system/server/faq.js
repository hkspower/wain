'use strict';
/**
 * معرفة وكيل موصول — أسئلة الزبائن وأجوبتها.
 *
 * ── لماذا وُجدت ─────────────────────────────────────────────────────
 * وكيل الصفحة كان يجمع حقول الطلب ولا يفعل غير ذلك. فمن سأل «كم السعر؟»
 * أو «توصلون الجهراء؟» لم يُجَب — وأسوأ من ألّا يُجاب: كان سؤاله **يُبتلع
 * طلبًا**. قِيس ذلك: سؤالان لا طلب فيهما أنتجا بطاقة اسمها «توصلون
 * الجهراء» واستلامها الجهراء. أي أنّ سؤالًا عن التغطية كان يوشك أن يُرسل
 * كابتنًا إلى عنوانٍ لم يطلبه أحد.
 *
 * ── لماذا في القاعدة لا في ملفّ ─────────────────────────────────────
 * كانت الأجوبة مثبّتة في `website/assistant.js`، فتصحيح جوابٍ واحد يحتاج
 * نشر الموقع كلّه. والمكتب هو من يعرف ما يُسأل عنه فعلًا، لا من ينشر.
 * فصارت هنا: يحرّرها المكتب من اللوحة وتسري في الحال، ويبقى سجلٌّ لكل
 * تعديل. والمحتوى الأوّل مبذور من تلك القائمة نفسها فلا يبدأ فارغًا.
 *
 * ── لا يخمّن ────────────────────────────────────────────────────────
 * لا مطابقة تقريبية تُخرج جوابًا «قريبًا». دون عتبةٍ واضحة يقول الوكيل إنه
 * لا يعرف ويعطي طريق الإنسان، ويُسجَّل السؤال في «أسئلة بلا جواب» ليصير
 * مدخلة. جوابٌ خاطئ بثقة أسوأ من لا جواب.
 */
const ar = require('arabic-kit');
const { db, now } = require('./db');
const { badRequest, notFound } = require('./lib/http');

/* ------------------------------ التطبيع ------------------------------ */

/**
 * التطبيع العربي من حزمة اللغة، وما يخصّ المطابقة وحدها يُبنى فوقها.
 * (النسخة نفسها التي يستعملها مساعد الموقع — تعريفان للتطبيع لا يستقيمان:
 * من يكتب «مومنه» تفهمه الحزمة ولا تفهمه نسخةٌ محلّية تخالفها في حرفين.)
 */
function norm(s) {
  return ar.normalize(String(s || ''))
    .replace(/چ/g, 'ج')
    .replace(/[^ء-يa-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * تجريد أداة التعريف وواو العطف لأجل المطابقة وحدها.
 *
 * بغيره تسقط أكثر الصيغ الطبيعية: مفتاح «السعر» لا يصيب «كم سعر التوصيل»،
 * ومفتاح «كم السعر» لا يصيب الجملة نفسها — لأن «ال» في أحد الطرفين دون
 * الآخر. قِيست الحالتان قبل هذا التجريد فسقطتا معًا.
 *
 * والتجريد مشروط بأن يبقى للكلمة جذعٌ ذو معنى (ثلاثة أحرف فأكثر)، وإلّا
 * صارت «الله» ← «له». ويُطبَّق على الطرفين معًا فلا يميل لأحدهما.
 */
function stem(word) {
  let w = word;
  /* أدوات تسبق التعريف: «للسعودية» «بالسالمية» «كالسابق» «فالسعر» «والسعر».
     تُقشَّر حين تلي «ال» وحدها، فالتركيب حينئذٍ لا يلتبس — أمّا تقشير «ك»
     من «كويت» أو «ب» من «بيت» فيُتلف الكلمة، ولذلك لا يُقشَّر حرفٌ مفرد
     إلّا واو العطف. قِيست الحاجة: «توصلون للسعودية؟» لم تكن تصيب مفتاح
     «السعودية» لأن «لل» في أحد الطرفين دون الآخر. */
  if (w.length > 4 && w.startsWith('لل')) w = w.slice(2);
  else if (w.length > 5 && /^[بكف]ال/.test(w)) w = w.slice(3);
  else if (w.length > 3 && w.startsWith('و')) w = w.slice(1);
  if (w.length > 4 && w.startsWith('ال')) w = w.slice(2);
  return w;
}
const stemmed = (s) => norm(s).split(' ').map(stem).join(' ');

/* ------------------------------ المطابقة ------------------------------ */

const splitKeys = (s) => String(s || '').split('\n').map((k) => k.trim()).filter(Boolean);

/**
 * تجهيز مدخلة للمطابقة. سؤالها المعروض يُضاف إلى مفاتيحها تلقائيًّا: هو
 * بالتعريف صياغةٌ صحيحة له، فلا يُترك تكرارُه لذاكرة من يحرّر.
 */
function prep(row) {
  const keys = splitKeys(row.keys).concat([row.question]).map(stemmed).filter(Boolean);
  return {
    row,
    phrases: keys.filter((k) => k.includes(' ')),
    words: keys.filter((k) => !k.includes(' ') && k.length >= 3),
  };
}

/** عتبة الثقة: عبارة كاملة (١٠) أو كلمة دالّة كاملة (٥). دونها لا يُجاب. */
const THRESHOLD = 5;

/**
 * المدخلات مجهّزةً للمطابقة، محفوظةً بين الرسائل.
 *
 * كان كلّ ما يقوله الزبون — سؤالًا كان أو وصفَ طلب — يُعيد قراءة الجدول من
 * القاعدة ويُعيد تجذير كل مفتاحٍ في كل مدخلة: نحو مئة عملية تطبيعٍ وتجذير
 * في كلّ رسالة، وكلُّها على محتوًى لم يتغيّر. وقيس أثر ذلك: جوابُ المعرفة
 * ‏٢٨٠ جزءًا من المليون من الثانية، خمسةَ أضعاف قراءةِ الطلب كلّه.
 *
 * فتُجهَّز مرّةً وتُبطَل عند كل تعديل. والإبطال في مكانٍ واحد (`touch`)
 * تستدعيه كلُّ كتابة: ذاكرةٌ تُملأ ولا تُبطَل تجعل المكتب يعدّل جوابًا في
 * اللوحة فلا يتغيّر شيء عند الزبون — وهو عطبٌ لا يُرى إلّا بعد فوات وقته.
 */
let PREPPED = null;
const touch = () => { PREPPED = null; };
const prepared = () => (PREPPED || (PREPPED = active().map(prep)));

/**
 * أفضل مدخلة تطابق كلام الزبون، أو `null`.
 *
 * المطابقة **بالكلمة كاملةً لا بجزئها**: «موظف» داخل «موظفيكم» ليست
 * الكلمة، وكانت المطابقة الجزئية تردّ على «كم عدد موظفيكم» بجواب التواصل.
 */
function match(text, rows) {
  const q = stemmed(text);
  if (q.length < 3) return null;
  const toks = q.split(' ');
  /* المدخلات المعطاة صراحةً (تجربةُ اللوحة) لا تُخزَّن: قد تكون مسوّدةً
     لم تُحفظ بعد، وحفظُها في الذاكرة يجعلها تجيب زبونًا لم تُعتمد له. */
  const list = rows ? rows.map(prep) : prepared();

  let best = null;
  let bestScore = 0;
  for (const p of list) {
    let score = 0;
    for (const k of p.phrases) if (q.includes(k)) score += 10;
    for (const w of p.words) if (toks.includes(w)) score += 5;
    if (score > bestScore) { bestScore = score; best = p.row; }
  }
  return bestScore >= THRESHOLD ? { entry: best, score: bestScore } : null;
}

/* ------------------------------ القراءة ------------------------------ */

const shape = (r) => ({
  id: r.id,
  question: r.question,
  answer: r.answer,
  keys: splitKeys(r.keys),
  handoff: !!r.handoff,
  active: !!r.active,
  seeded: !!r.seed_id,
  updated_at: r.updated_at,
  updated_by_name: r.updated_by_name || '',
});

const active = () => db.prepare('SELECT * FROM faq WHERE active = 1 ORDER BY id').all();

function list() {
  return db.prepare(
    `SELECT f.*, a.name AS updated_by_name FROM faq f
       LEFT JOIN agents a ON a.id = f.updated_by
      ORDER BY f.active DESC, f.id`
  ).all().map(shape);
}

function get(id) {
  const row = db.prepare('SELECT * FROM faq WHERE id = ?').get(id);
  if (!row) throw notFound('السؤال غير موجود');
  return row;
}

function history(limit = 60) {
  return db.prepare(
    `SELECT e.*, a.name AS actor_name, f.question FROM faq_events e
       LEFT JOIN agents a ON a.id = e.actor_id
       LEFT JOIN faq f ON f.id = e.faq_id
      ORDER BY e.id DESC LIMIT ?`
  ).all(limit);
}

/* --------------------------- التحقّق والكتابة --------------------------- */

const DIGITS = /[0-9٠-٩۰-۹]/;

function readFields({ question, answer, keys, handoff, active: isActive }, previous) {
  const q = question === undefined ? previous.question : String(question).trim();
  const a = answer === undefined ? previous.answer : String(answer).trim();
  if (q.length < 3) throw badRequest('السؤال قصير');
  if (q.length > 200) throw badRequest('السؤال طويل — اجعله سطرًا واحدًا');
  if (a.length < 3) throw badRequest('الجواب قصير');
  if (a.length > 1200) throw badRequest('الجواب طويل — اختصره');

  const rawKeys = keys === undefined ? splitKeys(previous.keys)
    : (Array.isArray(keys) ? keys : String(keys).split('\n'));
  const list_ = [...new Set(rawKeys.map((k) => String(k).trim()).filter(Boolean))];
  if (list_.some((k) => k.length > 120)) throw badRequest('صيغة سؤال أطول من اللازم');

  return {
    question: q,
    answer: a,
    keys: list_.join('\n'),
    handoff: handoff === undefined ? previous.handoff : (handoff ? 1 : 0),
    active: isActive === undefined ? previous.active : (isActive ? 1 : 0),
  };
}

/**
 * هل في الجواب رقم؟ **تحذير لا منع.**
 *
 * الأرقام التجارية في الموقع تقديرية، ووكيلٌ يقتبسها يحوّل التقدير إلى وعد.
 * لكنّ المكتب هو صاحب القرار: قد يعرف رقمًا مؤكّدًا يريد قوله. فيُقال له ما
 * يترتّب على ذلك ويُترك له الاختيار — ويُسجَّل في السجل أنّ الجواب فيه رقم.
 */
const hasNumber = (answer) => DIGITS.test(String(answer || ''));

function logFaq(faqId, actor, type, from = '', to = '') {
  db.prepare(
    `INSERT INTO faq_events (faq_id, actor_id, type, from_value, to_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(faqId, actor?.id ?? null, type, String(from), String(to), now());
}

function create(actor, body) {
  const f = readFields(body, { question: '', answer: '', keys: '', handoff: 0, active: 1 });
  if (db.prepare('SELECT 1 FROM faq WHERE question = ?').get(f.question)) {
    throw badRequest('يوجد سؤال بهذا النصّ');
  }
  const t = now();
  const run = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO faq (question, answer, keys, handoff, active, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(f.question, f.answer, f.keys, f.handoff, f.active, t, t, actor?.id ?? null);
    logFaq(info.lastInsertRowid, actor, 'created', '', f.question);
    /* السؤال الذي أُضيف يُعلَّم في «بلا جواب» فلا يبقى مطالبًا بما صار موجودًا */
    resolveMisses();
    return info.lastInsertRowid;
  });
  const id = run();
  touch();
  return shape(get(id));
}

function update(actor, id, body) {
  const before = get(id);
  const f = readFields(body, before);
  if (db.prepare('SELECT 1 FROM faq WHERE question = ? AND id <> ?').get(f.question, id)) {
    throw badRequest('يوجد سؤال بهذا النصّ');
  }
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE faq SET question=?, answer=?, keys=?, handoff=?, active=?, updated_at=?, updated_by=?
        WHERE id=?`
    ).run(f.question, f.answer, f.keys, f.handoff, f.active, now(), actor?.id ?? null, id);
    if (before.active !== f.active) {
      logFaq(id, actor, f.active ? 'enabled' : 'disabled', before.question, f.question);
    } else if (before.answer !== f.answer) {
      logFaq(id, actor, 'answer', before.answer, f.answer);
    } else {
      logFaq(id, actor, 'edited', before.question, f.question);
    }
    resolveMisses();
  });
  run();
  touch();
  return shape(get(id));
}

function remove(actor, id) {
  const row = get(id);
  const run = db.transaction(() => {
    db.prepare('DELETE FROM faq WHERE id = ?').run(id);
    logFaq(null, actor, 'deleted', row.question, '');
  });
  run();
  touch();
  return { deleted: true };
}

/* -------------------------- أسئلة بلا جواب -------------------------- */

/** يُسجَّل ما لم يُفهم مرّةً واحدة بعدّاد، لا سطرًا لكل تكرار */
function recordMiss(text) {
  const n = norm(text);
  if (n.length < 3 || n.split(' ').length > 25) return;
  const t = now();
  db.prepare(
    `INSERT INTO faq_misses (norm, text, hits, first_at, last_at) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(norm) DO UPDATE SET hits = hits + 1, last_at = excluded.last_at,
       answered_at = NULL`
  ).run(n, String(text).trim().slice(0, 300), t, t);
}

/** ما صار له جوابٌ الآن يُعلَّم، فلا تبقى القائمة تطالب بما أُنجز */
function resolveMisses() {
  const rows = active();
  const open = db.prepare('SELECT id, text FROM faq_misses WHERE answered_at IS NULL').all();
  const stamp = now();
  const mark = db.prepare('UPDATE faq_misses SET answered_at = ? WHERE id = ?');
  for (const m of open) if (match(m.text, rows)) mark.run(stamp, m.id);
}

function misses(limit = 40) {
  return db.prepare(
    `SELECT id, text, hits, first_at, last_at FROM faq_misses
      WHERE answered_at IS NULL ORDER BY hits DESC, id DESC LIMIT ?`
  ).all(limit);
}

function dismissMiss(id) {
  const r = db.prepare('UPDATE faq_misses SET answered_at = ? WHERE id = ?').run(now(), id);
  if (!r.changes) throw notFound('السؤال غير موجود');
  return { dismissed: true };
}

/* ------------------------------ الجواب ------------------------------ */

/**
 * جواب الوكيل لكلام الزبون. `null` إن لم يبلغ الثقة — ويُسجَّل حينها في
 * «بلا جواب» إن بدا سؤالًا (`asking`) لا إملاءَ طلب.
 */
function answer(text, { record = true } = {}) {
  const hit = match(text);
  if (!hit) {
    if (record && looksLikeQuestion(text)) recordMiss(text);
    return null;
  }
  return {
    id: hit.entry.id,
    question: hit.entry.question,
    answer: hit.entry.answer,
    handoff: !!hit.entry.handoff,
  };
}

/**
 * أهذا سؤالٌ أم إملاءُ طلب؟
 *
 * التمييز يلزم لأن الأمرين يتنازعان الجملة نفسها: «توصلون الجهراء؟» سؤالُ
 * تغطية، و«من الجهراء إلى السالمية» عنوانا طلب. ولا يُحسم بوجود «؟» وحدها
 * — أكثر الناس لا يكتبونها، والصوت لا ينطقها أصلًا. فتُقرأ أدوات الاستفهام
 * والصيغ الدارجة معها.
 */
const ASK_WORDS = [
  'كم', 'كيف', 'شنو', 'شنهي', 'وش', 'ايش', 'ليش', 'وين', 'متى', 'هل', 'ايمتى',
  'منو', 'من هو', 'ما هي', 'ما هو', 'اقدر', 'ممكن', 'تقدرون', 'عندكم', 'فيه',
  'تشتغلون', 'تفتحون', 'توصلون', 'تغطون', 'تقبلون', 'تشترون', 'تاخذون',
];
function looksLikeQuestion(text) {
  const raw = String(text || '');
  if (/[?؟]/.test(raw)) return true;
  const toks = norm(raw).split(' ');
  return ASK_WORDS.some((w) => (w.includes(' ') ? norm(raw).includes(w) : toks.includes(w)));
}

/* ------------------------------ البذرة ------------------------------ */

/*
 * المحتوى الأوّل. منقول عن `website/assistant.js` حرفًا بحرف حتى لا يختلف
 * ما يقوله الوكيل على الصفحتين يوم التشغيل الأوّل، و`test/faq.test.js`
 * يقارن القائمتين فيكشف انحرافهما لاحقًا.
 *
 * ولا يُعاد بذرُ ما حُذف: `seed_id` يجعل البذر يقع مرّة واحدة لكل مدخلة،
 * فمن حذف جوابًا لا يجده عاد إليه بعد أوّل إقلاع.
 */
const SEED = [
  /* لا مفتاحَ من كلمةٍ واحدة شائعة في كلام الطلب. «الخدمه» كانت هنا فأجابت
     «عندكم خدمة نقل أثاث؟» بتعريف موصول، و«كابتن» كانت في الانضمام فأجابت
     «ابغى كابتن يوصل أغراضي» بشرح كيف يصير الزبونُ سائقًا. جوابٌ واثق في
     غير موضعه أسوأ من لا جواب — وهو ما يكشفه «جرّب سؤالًا» في اللوحة. */
  { id: 'what', q: 'ما هي موصول؟', keys: ['ايش موصول', 'وش موصول', 'شنو موصول', 'شنهي موصول', 'ما هي موصول', 'من انتم', 'وش تسوون', 'شنو تسوون', 'ايش تقدمون', 'وش خدماتكم'],
    a: 'موصول وسيط بين الزبون والكابتن: نربطك بكابتن معتمد يملك سيارته الخاصة ليوصّل طلبك داخل الكويت. لا نملك أسطولًا ولا نوظّف سائقين.' },
  { id: 'coverage', q: 'أين تصلون؟', keys: ['وين توصلون', 'المناطق', 'التغطيه', 'تغطون', 'توصلون', 'المحافظات', 'توصلون منطقتي'],
    a: 'نغطي محافظات الكويت كلها. اذكر منطقة الاستلام ومنطقة التسليم وسنرتّب طلبك.' },
  { id: 'price', q: 'كم تكلفة التوصيل؟', keys: ['كم السعر', 'السعر', 'الاسعار', 'كم يكلف', 'التكلفه', 'الرسوم', 'كم عليه', 'كم تاخذون'],
    a: 'السعر يختلف حسب المحافظة ونوع السيارة وحجم الشحنة. أكمل طلبك هنا ويتّصل بك المكتب بالسعر الدقيق قبل أن يتحرّك الكابتن.', handoff: true },
  { id: 'time', q: 'كم يستغرق التوصيل؟', keys: ['كم ياخذ', 'الوقت', 'متى يوصل', 'كم مده', 'سرعه التوصيل', 'كم يستغرق', 'وقت التوصيل'],
    a: 'الوقت يعتمد على المسافة بين الاستلام والتسليم وحركة المرور وقت الطلب. اذكر العنوانين ويعطيك المكتب الوقت المتوقّع عند التأكيد.', handoff: true },
  { id: 'pay', q: 'ما طرق الدفع؟', keys: ['الدفع', 'ادفع', 'كي نت', 'كاش', 'نقدا', 'طرق الدفع', 'تحويل بنكي', 'فيزا'],
    a: 'نقبل الدفع نقدًا وكي نت عند الاستلام، والتحويل البنكي للشركات والمتاجر ذات العقود الشهرية.' },
  { id: 'buyforme', q: 'هل يشتري الكابتن الطلب نيابةً عني؟', keys: ['اشتري لي', 'تشترون', 'شراء الطلب', 'يشتري السائق', 'تشتري عني'],
    a: 'نعم، خدمة «اشترِ لي» متاحة: يدفع الكابتن قيمة المشتريات وتسدّدها له عند التسليم مع رسوم خدمة. اذكرها في طلبك ويؤكّدها لك المكتب.', handoff: true },
  { id: 'insurance', q: 'هل الشحنات مؤمَّنة؟', keys: ['التامين', 'مؤمنه', 'مؤمن', 'ضمان', 'لو انكسر', 'لو ضاع', 'تلف الشحنه'],
    a: 'نعم، الشحنات مؤمَّنة، وللشحنات ذات القيمة العالية يمكن طلب تغطية إضافية عند تأكيد الطلب. يوضّح لك المكتب حدود التغطية.', handoff: true },
  { id: 'absent', q: 'ماذا لو لم يكن المستلم موجودًا؟', keys: ['ما احد موجود', 'المستلم مو موجود', 'ما رد', 'لو ما كان موجود', 'ما استلم'],
    a: 'ينتظر الكابتن مدةً قصيرة ثم يتواصل معك لتحديد الإجراء. وإن تعذّر التسليم تُعاد الشحنة إلى نقطة الاستلام مقابل رسوم.', handoff: true },
  { id: 'store', q: 'كيف أربط متجري بموصول؟', keys: ['متجري', 'المتجر', 'ربط', 'api', 'واجهه برمجيه', 'شوبيفاي', 'سله', 'زد'],
    a: 'نوفّر واجهة برمجية وإضافات لمنصات المتاجر الشائعة. اترك رقمك ويتّصل بك المكتب لبدء الربط.', handoff: true },
  { id: 'cold', q: 'هل يوجد توصيل مبرّد؟', keys: ['مبرد', 'تبريد', 'ثلاجه', 'مواد غذاءيه', 'ادويه', 'حلويات'],
    a: 'نعم، لدينا خيار السيارة المبرّدة للمواد الغذائية الطازجة والحلويات والأدوية التي تحتاج سلسلة تبريد. اذكر أنك تريد سيارة مبرّدة في طلبك.' },
  { id: 'track', q: 'كيف أتابع طلبي؟', keys: ['اتابع', 'التتبع', 'وين طلبي', 'اين طلبي', 'رابط التتبع', 'اتتبع'],
    a: 'يصلك رمز الطلب فور إرساله، ويصلك رابط تتبّع على واتساب فور إسناده لكابتن تتابع منه الشحنة حتى التسليم.' },
  { id: 'join', q: 'كيف أنضم كابتن؟', keys: ['ابغى اشتغل', 'ابي اشتغل', 'اشتغل معكم', 'اشتغل كابتن', 'انضم', 'انضم لكم', 'وظيفه', 'التسجيل كساءق', 'ابغى اصير كابتن'],
    a: 'الانضمام يشترط أن تملك سيارتك الخاصة وأن تكون حديثة الموديل، وأن تجتاز مقابلة شخصية قبل الاعتماد. اترك رقمك ويتواصل معك المكتب.', handoff: true },
  { id: 'hours', q: 'ما أوقات العمل؟', keys: ['متى تشتغلون', 'الدوام', 'اوقات العمل', 'تشتغلون الجمعه', 'تفتحون'],
    a: 'نعمل يوميًا. إن كان طلبك خارج أوقات الدوام فأرسله على أي حال ويتواصل معك المكتب.', handoff: true },
  { id: 'contact', q: 'كيف أتواصل معكم؟', keys: ['ابغى اكلم', 'موظف', 'رقمكم', 'اتصال', 'تواصل', 'خدمه العملاء', 'شكوى', 'ابي احد'],
    a: 'أسرع طريق هو واتساب أو الاتصال على رقم المكتب — تجد الرابطين أسفل الصفحة، ويردّ عليك فريق خدمة العملاء.', handoff: true },
];

/** ما يُقال لمن لم يُعرف جوابه. لا يخمّن ولا يعتذر طويلًا: يدلّ على إنسان. */
const FALLBACK =
  'ما عندي جواب موثوق عن هذا، ولا أحبّ أن أخمّن عليك. '
  + 'أكمل طلبك هنا ويتّصل بك المكتب، أو راسلنا على واتساب.';

function ensureSeed() {
  const t = now();
  const ins = db.prepare(
    `INSERT INTO faq (question, answer, keys, handoff, active, seed_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
  );
  const mark = db.prepare('INSERT OR IGNORE INTO faq_seeds (seed_id, at) VALUES (?, ?)');
  const done = db.prepare('SELECT 1 FROM faq_seeds WHERE seed_id = ?');
  const run = db.transaction(() => {
    /* قاعدةٌ بُذرت قبل وجود السجلّ: صفوفها المبذورة أثرُ بذرٍ وقع، فتُقيَّد
       أولًا. وبغير ذلك يحاول البذر إدراجها ثانيةً فيسقط على قيد التفرّد
       ولا يقلع الخادم أصلًا. */
    for (const r of db.prepare('SELECT seed_id, created_at FROM faq WHERE seed_id IS NOT NULL').all()) {
      mark.run(r.seed_id, r.created_at || t);
    }
    for (const s of SEED) {
      /* الشرط على **أثر البذر** لا على وجود الصفّ: من حذف جوابًا مبذورًا
         لا يجده عاد إليه بعد أوّل إقلاع. قِيس ذلك فرجع المحذوف. */
      if (done.get(s.id)) continue;
      ins.run(s.q, s.a, s.keys.join('\n'), s.handoff ? 1 : 0, s.id, t, t);
      mark.run(s.id, t);
    }
  });
  run();
  touch();
}

module.exports = {
  norm, match, answer, looksLikeQuestion, hasNumber, FALLBACK, SEED, THRESHOLD,
  list, get, create, update, remove, history,
  recordMiss, resolveMisses, misses, dismissMiss, ensureSeed,
};
