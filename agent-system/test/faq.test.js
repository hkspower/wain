'use strict';
/**
 * معرفة وكيل موصول: المطابقة، والقسمة بين السؤال والطلب، وإدارتها من اللوحة.
 *
 * أهمّ ما يُحرَس هنا شيئان لا يُريان في الشاشة:
 *   • **سؤالٌ لا يصير طلبًا.** كان كلُّ ما يقوله الزبون يُبتلع حقولًا، فسؤالان
 *     لا طلب فيهما ينتجان بطاقةً باسم «توصلون الجهراء» واستلامها الجهراء —
 *     أي كابتنٌ يُرسَل إلى عنوانٍ لم يطلبه أحد.
 *   • **لا جواب واثق في غير موضعه.** مفتاحٌ من كلمة واحدة شائعة يجعل الوكيل
 *     يجيب بثقة عن غير ما سُئل، وهو أسوأ من ألّا يجيب.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* قاعدة معزولة لكل تشغيل — لا تُمسّ قاعدة التطوير */
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-faq-'));
process.env.MAWSOOL_DATA_DIR = DIR;
process.env.MAWSOOL_DB = path.join(DIR, 'faq.db');

const FAQ = require('../server/faq');
const { db } = require('../server/db');
FAQ.ensureSeed();

const ACTOR = { id: null };

test('البذرة تقع مرّة واحدة، ولا يعود ما حُذف', () => {
  const n = FAQ.list().length;
  assert.ok(n >= 14, 'البذرة ناقصة: ' + n);

  const one = FAQ.list().find((x) => x.seeded);
  FAQ.remove(ACTOR, one.id);
  FAQ.ensureSeed();
  assert.equal(FAQ.list().length, n - 1, 'عاد ما حذفه المكتب بعد الإقلاع');

  /* وتُعاد لبقيّة الاختبارات */
  db.prepare(`INSERT INTO faq (question, answer, keys, handoff, active, seed_id, created_at, updated_at)
              VALUES (?, ?, ?, 0, 1, ?, ?, ?)`)
    .run(one.question, one.answer, one.keys.join('\n'), 'restored', '2026-01-01', '2026-01-01');
});

test('يجيب عمّا يعرف بصيغه الدارجة', () => {
  const cases = [
    ['كم سعر التوصيل؟', 'كم تكلفة التوصيل؟'],
    ['توصلون الجهراء؟', 'أين تصلون؟'],
    ['كم ياخذ وقت', 'كم يستغرق التوصيل؟'],
    ['كيف أدفع', 'ما طرق الدفع؟'],
    ['تشتغلون الجمعة؟', 'ما أوقات العمل؟'],
    ['هل الشحنة مؤمنة', 'هل الشحنات مؤمَّنة؟'],
    ['وين طلبي', 'كيف أتابع طلبي؟'],
    ['ابغى أشتغل معكم كابتن', 'كيف أنضم كابتن؟'],
  ];
  for (const [asked, expected] of cases) {
    const got = FAQ.answer(asked, { record: false });
    assert.ok(got, `لم يُجَب: ${asked}`);
    assert.equal(got.question, expected, asked);
  }
});

test('أداة التعريف وما يسبقها لا تُسقط المطابقة', () => {
  /* «للسعودية» = ل + ال + سعودية. كانت «لل» في أحد الطرفين دون الآخر تُسقط
     المطابقة، وكذلك «السعر» مقابل «سعر». والتجريد يقع على الطرفين معًا. */
  assert.equal(FAQ.norm('عندكم توصيل للسعودية'), 'عندكم توصيل للسعوديه');
  const id = FAQ.create(ACTOR, {
    question: 'هل توصّلون خارج الكويت؟',
    answer: 'لا، خدمتنا داخل الكويت فقط.',
    keys: ['توصيل للسعوديه', 'خارج الكويت'],
  }).id;
  assert.ok(FAQ.answer('عندكم توصيل للسعودية؟', { record: false }), 'أسقطته «لل»');
  assert.ok(FAQ.answer('توصلون خارج الكويت؟', { record: false }), 'أسقطته العبارة');
  FAQ.remove(ACTOR, id);
});

test('لا جواب واثق في غير موضعه', () => {
  /* هذه كانت تُجاب خطأً حين كان في البذرة مفاتيح من كلمة واحدة شائعة:
     «الخدمه» جعلت سؤال نقل الأثاث يُجاب بتعريف موصول، و«كابتن» جعلت زبونًا
     يطلب توصيلًا يُشرح له كيف يصير سائقًا. */
  const traps = [
    'عندكم خدمة نقل أثاث؟',
    'ابغى كابتن يوصل أغراضي',
    'ابغى كابتن الحين',
    'كم عدد موظفيكم؟',
    'ابغى أحد يستلم من المطار',
  ];
  for (const t of traps) {
    const got = FAQ.answer(t, { record: false });
    assert.equal(got, null, `أجاب «${t}» بـ«${got && got.question}»`);
  }
});

test('يميّز السؤال من كلام الطلب', () => {
  for (const q of ['كم السعر؟', 'وين توصلون', 'شنو موصول', 'تشتغلون الجمعة', 'ممكن توصل اليوم']) {
    assert.equal(FAQ.looksLikeQuestion(q), true, q);
  }
  for (const o of [
    'اسمي نورة', 'رقمي ٩٩٠٠١١٢٢', 'الاستلام من السالمية قطعة ٤',
    'التسليم في الجابرية قطعة ٧', 'لا، اسمي فهد', 'ودي أوصل أغراض للشرق',
  ]) {
    assert.equal(FAQ.looksLikeQuestion(o), false, o);
  }
});

test('التحقّق من المدخلة: لا سؤال قصير ولا جواب فارغ ولا تكرار', () => {
  assert.throws(() => FAQ.create(ACTOR, { question: 'ا', answer: 'جواب' }), /قصير/);
  assert.throws(() => FAQ.create(ACTOR, { question: 'سؤال صالح', answer: '' }), /قصير/);
  const it = FAQ.create(ACTOR, { question: 'سؤال فريد جدًّا', answer: 'جوابه' });
  assert.throws(() => FAQ.create(ACTOR, { question: 'سؤال فريد جدًّا', answer: 'آخر' }), /بهذا النصّ/);
  FAQ.remove(ACTOR, it.id);
});

test('الرقم في الجواب يُكشف ولا يُمنع — القرار للمكتب', () => {
  /* الأرقام التجارية تقديرية، ووكيلٌ يقتبسها يحوّل التقدير إلى وعد. لكنّ
     المنع يصادر قرارًا ليس لنا: قد يعرف المكتب رقمًا يلتزم به. فيُكشف. */
  assert.equal(FAQ.hasNumber('التوصيل خلال ٣٠ دقيقة'), true);
  assert.equal(FAQ.hasNumber('within 30 minutes'), true);
  assert.equal(FAQ.hasNumber('السعر يختلف حسب المنطقة'), false);
  const it = FAQ.create(ACTOR, { question: 'كم دقيقة؟', answer: 'خلال ٣٠ دقيقة' });
  assert.ok(it.id, 'مُنع الحفظ بدل أن يُنبَّه');
  FAQ.remove(ACTOR, it.id);
});

test('التعطيل يُسكت المدخلة بلا حذفها', () => {
  const it = FAQ.create(ACTOR, {
    question: 'هل عندكم تغليف؟', answer: 'نعم، نغلّف الشحنات الهشّة.',
    keys: ['تغليف', 'تغلفون'],
  });
  assert.ok(FAQ.answer('عندكم تغليف؟', { record: false }));
  FAQ.update(ACTOR, it.id, { active: false });
  assert.equal(FAQ.answer('عندكم تغليف؟', { record: false }), null, 'أجاب بمدخلة معطّلة');
  assert.ok(FAQ.list().some((x) => x.id === it.id), 'حُذفت بدل أن تُعطّل');
  FAQ.remove(ACTOR, it.id);
});

test('كل تعديل مسجَّل بنوعه', () => {
  const before = FAQ.history().length;
  const it = FAQ.create(ACTOR, { question: 'سؤال للسجل', answer: 'جوابه الأوّل' });
  FAQ.update(ACTOR, it.id, { answer: 'جوابه الثاني' });
  FAQ.update(ACTOR, it.id, { active: false });
  FAQ.remove(ACTOR, it.id);
  const types = FAQ.history().slice(0, 4).map((e) => e.type);
  assert.deepEqual(types, ['deleted', 'disabled', 'answer', 'created'], types.join(','));
  assert.equal(FAQ.history().length, before + 4);
});

test('أسئلة بلا جواب تُعدّ مرّة وتُحلّ حين يُضاف جوابها', () => {
  db.exec('DELETE FROM faq_misses');
  FAQ.recordMiss('عندكم خدمة نقل أثاث؟');
  FAQ.recordMiss('عندكم خدمة نقل أثاث؟');
  FAQ.recordMiss('عندكم خدمة نقل الأثاث');   // الصيغة نفسها بعد التطبيع؟ لا — سطر آخر
  let open = FAQ.misses();
  const first = open.find((m) => m.text === 'عندكم خدمة نقل أثاث؟');
  assert.equal(first.hits, 2, 'عُدّ التكرار سطرًا جديدًا بدل عدّاد');

  const it = FAQ.create(ACTOR, {
    question: 'هل تنقلون الأثاث؟', answer: 'لا، شحنات صغيرة فقط.',
    keys: ['نقل اثاث', 'نقل الاثاث'],
  });
  open = FAQ.misses();
  assert.equal(open.some((m) => /اثاث|أثاث/.test(m.text)), false, 'بقي مطالبًا بما صار له جواب');

  /* والإخفاء يدويًّا لما لا جواب له ولا يُراد */
  FAQ.recordMiss('سؤال لا يعني أحدًا');
  const m = FAQ.misses().find((x) => x.text === 'سؤال لا يعني أحدًا');
  FAQ.dismissMiss(m.id);
  assert.equal(FAQ.misses().some((x) => x.id === m.id), false);
  FAQ.remove(ACTOR, it.id);
});

test('البذرة توافق مساعد الموقع في معرّفاتها', () => {
  /* المحتوى الأوّل منقول عن `website/assistant.js`. الملف خارج هذه الحزمة،
     فيُتخطّى الفحص إن لم يكن موجودًا (حزمة النظام تُشحن وحدها) — وإن وُجد
     كُشف انحرافُ القائمتين. */
  const site = path.join(__dirname, '..', '..', 'website', 'assistant.js');
  if (!fs.existsSync(site)) return;
  const src = fs.readFileSync(site, 'utf8');
  const ids = [...src.matchAll(/^\s*id:\s*'([a-z]+)',/gm)].map((m) => m[1]);
  if (!ids.length) return;
  const missing = ids.filter((i) => !FAQ.SEED.some((s) => s.id === i));
  assert.deepEqual(missing, [], 'موضوعات في مساعد الموقع بلا بذرة هنا: ' + missing.join('، '));
});

test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* لا يضرّ */ } });
