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

test('تصحيحُ نصّ البذرة يصل قاعدةً قائمة، وما حرّره المكتب لا يُمسّ', () => {
  /* البذر كان يقع مرّةً ثمّ يتجمّد النصّ: خطأٌ لغويّ في جوابٍ مبذور نصلحه في
     الشيفرة فلا يصل أحدًا — القاعدة القائمة تبقى على خطئها والزبون يقرؤه.
     ولا يُمسّ ما حرّره المكتب: إتلاف كلمةٍ كتبها أسوأ من إبقاء خطأٍ كتبناه. */
  const seeded = FAQ.list().find((x) => x.seeded && x.id);

  /* صفٌّ بِكر: يُشوَّه نصُّه بلا أثرِ تحرير، فيجب أن يعود إلى نصّ البذرة */
  db.prepare('UPDATE faq SET answer = ?, updated_at = created_at, updated_by = NULL WHERE id = ?')
    .run('نصٌّ مشوَّه', seeded.id);
  FAQ.ensureSeed();
  assert.notEqual(FAQ.get(seeded.id).answer, 'نصٌّ مشوَّه', 'لم يصل التصحيح قاعدةً قائمة');

  /* وصفٌّ حرّره المكتب: يبقى على ما كتبه */
  FAQ.update(ACTOR, seeded.id, { answer: 'جوابٌ كتبه المكتب.' });
  FAQ.ensureSeed();
  assert.equal(FAQ.get(seeded.id).answer, 'جوابٌ كتبه المكتب.', 'أُتلف ما حرّره المكتب');
});

test('يجيب عمّا يعرف بصيغه الدارجة', () => {
  const cases = [
    ['كم سعر التوصيل؟', 'كم تكلفة التوصيل؟'],
    ['توصلون الجهراء؟', 'إلى أين تصلون؟'],
    ['كم ياخذ وقت', 'كم يستغرق التوصيل؟'],
    ['كيف أدفع', 'ما طرق الدفع؟'],
    ['تشتغلون الجمعة؟', 'ما أوقات العمل؟'],
    ['هل الشحنة مؤمنة', 'هل الشحنات مؤمَّنة؟'],
    ['وين طلبي', 'كيف أتابع طلبي؟'],
    ['ابغى أشتغل معكم كابتن', 'كيف أنضمّ كابتنًا؟'],
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

test('الشكوى من جوابٍ أُعطي تبقى حتى يُصحَّح الجواب لا حتى يُطابَق', () => {
  /* «بلا جواب» تُحلّ بالمطابقة: صار له جوابٌ فسقط من القائمة. والشكوى
     عكسها تمامًا — صاحبها **وجد** جوابًا، فلو قيست بالمطابقة لأُغلقت في
     اللحظة التي تُفتح فيها ولم يرها المكتب أبدًا. */
  db.exec('DELETE FROM faq_misses');
  const it = FAQ.create(ACTOR, {
    question: 'هل توصلون للسعودية؟', answer: 'داخل الكويت فقط.', keys: ['السعوديه', 'خارج الكويت'],
  });

  assert.equal(FAQ.recordUnhelpful('توصلون السعوديه؟', it.id), true);
  assert.equal(FAQ.recordUnhelpful('توصلون السعوديه؟', it.id), true);

  let open = FAQ.misses();
  const c = open.find((m) => m.kind === 'unhelpful');
  assert.ok(c, 'الشكوى لم تُسجَّل');
  assert.equal(c.hits, 2, 'التكرار سطرٌ جديد بدل عدّاد');
  assert.equal(c.faq_id, it.id, 'الشكوى لا تدلّ على الجواب المشكوّ منه');
  assert.equal(c.faq_question, 'هل توصلون للسعودية؟');

  /* ولا تُغلقها المطابقة ولو جرت مرارًا */
  FAQ.resolveMisses();
  assert.equal(FAQ.misses().some((m) => m.id === c.id), true, 'أُغلقت الشكوى بالمطابقة');

  /* ويراها المكتب على الجواب نفسه لا في قائمةٍ جانبية وحدها */
  assert.equal(FAQ.list().find((x) => x.id === it.id).complaints, 2);

  /* وتُغلق بتعديل الجواب — فالمكتب رآها وفعل */
  FAQ.update(ACTOR, it.id, { question: 'هل توصلون للسعودية؟', answer: 'داخل الكويت وحدها، ولا نخرج من حدودها.', keys: ['السعوديه'] });
  assert.equal(FAQ.misses().some((m) => m.id === c.id), false, 'بقيت الشكوى بعد تصحيح الجواب');
  assert.equal(FAQ.list().find((x) => x.id === it.id).complaints, 0);

  /* وشكوى على جوابٍ لا وجود له تُردّ ولا تُسجَّل: لا يُعرف ما يُصلَح */
  assert.equal(FAQ.recordUnhelpful('سؤال عن جواب محذوف', 999999), false);
  assert.equal(FAQ.misses().some((m) => m.text === 'سؤال عن جواب محذوف'), false);

  FAQ.remove(ACTOR, it.id);
});

test('سؤالٌ شُكي من جوابه ثمّ صار بلا جواب يعود «بلا جواب»', () => {
  /* الجدول واحد ومفتاحه نصّ السؤال، فحالته تتبع آخر ما وقع. ولولا ذلك
     لبقي في القائمة «صحّح الجواب» على جوابٍ لم يعد موجودًا. */
  db.exec('DELETE FROM faq_misses');
  const it = FAQ.create(ACTOR, { question: 'سؤالٌ سيُحذف', answer: 'جوابٌ سيُحذف', keys: ['صيغة نادرة جدا'] });
  FAQ.recordUnhelpful('صيغة نادرة جدا', it.id);
  assert.equal(FAQ.misses()[0].kind, 'unhelpful');

  FAQ.remove(ACTOR, it.id);
  FAQ.recordMiss('صيغة نادرة جدا');
  const m = FAQ.misses().find((x) => x.text === 'صيغة نادرة جدا');
  assert.equal(m.kind, 'unanswered');
  assert.equal(m.faq_id, null);
});

test('لا رقم في بذرة الأجوبة، والسؤال الرقميّ يُحال إلى إنسان', () => {
  /* كان هذا الحارس في `website/tools/check-assistant.mjs` يحرس ملفًّا على
     الموقع. ولمّا صارت الأجوبة في القاعدة انتقل إلى حيث المحتوى.
     والسبب لم يتغيّر: الأرقام التجارية تقديرية موضوعة للاتساق الداخلي لا
     كالتزامات، ووكيلٌ يقتبسها للزبون يحوّل التقدير إلى وعد، والوعد إلى
     خصومةٍ يوم يخلفه الواقع. وقرارٌ مكتوبٌ في تعليقٍ يُنسى بعد شهر: يضيف
     أحدهم «خلال ٣٠ دقيقة» بحسن نيّة. الحارس يجعل نسيانه مستحيلًا.

     ويحرس **البذرة** وحدها — وهي ما نشحنه نحن. أمّا ما يكتبه المكتب في
     اللوحة فيُنبَّه عليه ولا يُمنع: تلك أجوبتهم وقرارهم. */
  for (const s of FAQ.SEED) {
    assert.equal(FAQ.hasNumber(s.q), false, `في سؤال «${s.id}» رقم: ${s.q}`);
    assert.equal(FAQ.hasNumber(s.a), false, `في جواب «${s.id}» رقم: ${s.a}`);
  }
  /* والسؤالان الرقميّان لا يُجابان برقم بل يُحالان */
  for (const id of ['price', 'time']) {
    const t = FAQ.SEED.find((x) => x.id === id);
    assert.ok(t, `البذرة بلا «${id}»`);
    assert.equal(t.handoff, true, `«${id}» لا يُحال إلى إنسان`);
  }
});

test('تعديل الجواب من اللوحة يصل الزبون في الحال', () => {
  /* المدخلات تُجهَّز مرّةً وتُحفظ بين الرسائل — وإلّا أُعيدت قراءة الجدول
     وتجذير كل مفاتيحه مع كلّ ما يقوله الزبون (قِيس: ‏٢٨٠ جزءًا من المليون
     من الثانية، خمسةَ أضعاف قراءة الطلب كلّه). وثمن الحفظ أن يُبطَل عند كل
     كتابة: ذاكرةٌ لا تُبطَل تجعل المكتب يصحّح جوابًا خاطئًا في اللوحة ويراه
     صحيحًا عنده، بينما يبقى الزبون يسمع الخطأ — عطبٌ لا يُكتشف إلّا متأخّرًا
     لأنّ كلّ ما يراه المحرّر يقول إنّ التصحيح وقع. */
  const it = FAQ.create(ACTOR, {
    question: 'هل عندكم تخزين؟', answer: 'الجواب الأوّل.', keys: ['تخزين', 'تخزنون'],
  });
  assert.equal(FAQ.answer('عندكم تخزين؟', { record: false }).answer, 'الجواب الأوّل.');

  FAQ.update(ACTOR, it.id, { answer: 'الجواب المصحَّح.' });
  assert.equal(FAQ.answer('عندكم تخزين؟', { record: false }).answer, 'الجواب المصحَّح.',
    'بقي الجواب القديم يُقال للزبون بعد تصحيحه');

  /* وما حُذف لا يبقى يُجاب به */
  FAQ.remove(ACTOR, it.id);
  assert.equal(FAQ.answer('عندكم تخزين؟', { record: false }), null, 'أجاب بمدخلة محذوفة');

  /* وما أُضيف بعد ذلك يُجاب به بلا إقلاعٍ جديد */
  const two = FAQ.create(ACTOR, {
    question: 'هل تستلمون من المطار؟', answer: 'نعم، نستلم من المطار.',
    keys: ['استلام من المطار', 'من المطار'],
  });
  assert.ok(FAQ.answer('تستلمون من المطار؟', { record: false }), 'لم تُر المدخلة الجديدة');
  FAQ.remove(ACTOR, two.id);
});

test('نصّ البذرة سليمُ الإملاء — همزةً وتنوينًا وترقيمًا', () => {
  /* هذه الجمل هي ما يقرؤه الزبون من الوكيل، ولا يمرّ عليها محرّر. وأخطاء
     الإملاء العربية أكثرها آليّ يُكشف يقينًا: همزة قطعٍ ساقطة في كلمةٍ
     وظيفية، وتنوينٌ ناقص على حال، وترقيمٌ لاتينيّ في جملةٍ عربية. وما لا
     يُكشف يقينًا (النحو الكامل) لا يُدّعى هنا.
     قِيست هذه الأجوبة يدويًّا مرّةً فوُجد فيها ستّة: «الانضمام يشترط» بدل
     «يُشترط للانضمام»، و«تحتاج سلسلة» بدل «تحتاج إلى سلسلة»، و«أخمّن
     عليك»، وشدّاتٌ ساقطة. والحارس يمنع عودتها ودخول أمثالها. */
  const HAMZA = { 'الى': 'إلى', 'او': 'أو', 'اذا': 'إذا', 'اكثر': 'أكثر',
    'اقل': 'أقلّ', 'اول': 'أوّل', 'اي': 'أيّ', 'انت': 'أنت', 'انا': 'أنا',
    'الغاء': 'إلغاء', 'ارسال': 'إرسال', 'اضافة': 'إضافة', 'انشاء': 'إنشاء',
    'ادارة': 'إدارة', 'اجمالي': 'إجمالي', 'ايضا': 'أيضًا' };
  const TANWEEN = ['شكرا', 'ايضا', 'أيضا', 'مثلا', 'تماما', 'حاليا', 'فورا',
    'مجانا', 'مرحبا', 'جدا', 'دائما', 'تلقائيا', 'يدويا', 'لاحقا', 'اولا'];
  const MISSPELL = { 'انشاء الله': 'إن شاء الله', 'لاكن': 'لكن', 'هاذا': 'هذا',
    'الذى': 'الذي', 'التى': 'التي', 'مسؤل': 'مسؤول', 'مسئول': 'مسؤول' };
  const word = (w) => new RegExp(`(^|[\\s،.:«»()"'])${w}([\\s،.:؟!«»()"']|$)`);

  const texts = [...FAQ.SEED.flatMap((s) => [s.q, s.a]), FAQ.FALLBACK];
  for (const t of texts) {
    for (const [wrong, right] of Object.entries(HAMZA)) {
      assert.equal(word(wrong).test(t), false, `همزة قطع «${wrong}» ← «${right}» في: ${t}`);
    }
    for (const w of TANWEEN) {
      assert.equal(word(w).test(t), false, `تنوين ناقص «${w}» في: ${t}`);
    }
    for (const [wrong, right] of Object.entries(MISSPELL)) {
      assert.equal(word(wrong).test(t), false, `إملاء «${wrong}» ← «${right}» في: ${t}`);
    }
    assert.equal(/[ء-ي]\s*,/.test(t), false, `فاصلة لاتينية في: ${t}`);
    assert.equal(/[ء-ي]\s*;/.test(t), false, `فاصلة منقوطة لاتينية في: ${t}`);
    assert.equal(/ [،؛؟!]/.test(t), false, `مسافة قبل علامة الترقيم في: ${t}`);
    assert.equal(/[ء-ي]  +[ء-ي]/.test(t), false, `مسافتان بين كلمتين في: ${t}`);
  }
});

test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* لا يضرّ */ } });

test('ما بعد الطلب يُجاب ولا يُقرأ طلبًا جديدًا', () => {
  /* قِيس على اثنتين وعشرين نيّةً واقعية فسقطت **تسعٌ** في حفرةٍ واحدة:
     الزبون يقول خبرًا لا سؤالًا — «ابغى الغي الطلب»، «الكابتن تاخر»،
     «الشحنه انكسرت» — فلا `looksLikeQuestion` تعدّه سؤالًا، ولا مدخلةَ
     معرفةٍ تجيبه، فيُقرأ كلامَ طلبٍ جديد. أي أنّ صاحب الطلب القائم يُسأل
     «من أين نستلم؟» وهو يشكو من كابتنٍ تأخّر.
     وعلاجها معرفةٌ لا شيفرة، فيحرّرها المكتب كما يحرّر غيرها. */
  /* و`answer` تُرجع معرّف الصفّ في القاعدة لا معرّف البذرة، فالمقارنة
     بالسؤال كما يُعرض — وهو ما يراه الزبون على كلّ حال. */
  const says = (t) => { const a = FAQ.answer(t, { record: false }); return a && a.question; };
  const CANCEL = 'أريد إلغاء طلبي أو تعديله';

  assert.equal(says('ابغى الغي الطلب'), CANCEL);
  assert.equal(says('خلاص ما ابي التوصيل'), CANCEL);
  assert.equal(says('ابغى اعدل العنوان'), CANCEL);
  assert.equal(says('الكابتن تأخر'), 'تأخّر الكابتن ولم يصل');
  assert.equal(says('ابغى اشتكي'), 'الشحنة تضرّرت أو ضاعت');
  assert.equal(says('الشحنة انكسرت'), 'الشحنة تضرّرت أو ضاعت');

  /* وكلّها تحيل إلى إنسان: طلبٌ قائمٌ لا يُدار من صفحة الطلب الجديد */
  for (const t of ['ابغى الغي الطلب', 'الكابتن تأخر', 'ابغى اشتكي']) {
    assert.equal(FAQ.answer(t, { record: false }).handoff, true, `«${t}» لا تدلّ على إنسان`);
  }
});

test('خارج الكويت يُقال صراحةً، ومناطق الكويت لا تُحسب خارجها', () => {
  /* «ودّي اطرش للرياض» ليست سؤالًا، فكانت تُقرأ كلامَ طلبٍ ولا يُملأ منها
     شيء — فيُسأل الزبون عن منطقةٍ لن يجدها، ولا يُقال له إنّا لا نخرج من
     الكويت. والحدّ ليس سياسةً اختُرعت: النظام لا يقبل إلّا مناطق الكويت. */
  const says = (t) => { const a = FAQ.answer(t, { record: false }); return a && a.question; };
  const COVER = 'إلى أين تصلون؟';
  assert.equal(says('ابغى توصيل من دبي الى السالمية'), COVER);
  assert.equal(says('ودّي اطرش للرياض'), COVER);
  assert.equal(says('توصلون البحرين؟'), COVER);

  /* و**«الدوحة» منطقةٌ كويتية** لا عاصمةُ قطر هنا: لو جُعلت مفتاحًا
     لقيل لصاحب طلبٍ داخل الكويت إنّا لا نوصّل إليه. */
  assert.equal(says('من الدوحة الى السالمية'), null);
  /* و«جده» بعد التطبيع هي «جدّه» في «بيت جدّه» — فلا تكون مفتاحًا */
  assert.equal(says('التسليم عند بيت جده'), null);
  /* ولا يبتلع المفتاحُ طلبًا عاديًّا */
  assert.equal(says('ابغى توصيل من حولي الى السالمية'), null);
});
