'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ar = require('../index.js');

test('الأرقام العربية-الهندية', () => {
  assert.equal(ar.digits(2026), '٢٠٢٦');
  assert.equal(ar.digits('MW-4821'), 'MW-٤٨٢١');
  assert.equal(ar.toLatin('١٢٨٬٠٠٠'), '128000');
  assert.equal(ar.toLatin('١٫٥٠٠'), '1.500');
});

test('فاصل الآلاف والفاصلة العشرية عربيان', () => {
  assert.equal(ar.number(128000), '١٢٨٬٠٠٠');
  assert.equal(ar.number(1234567), '١٬٢٣٤٬٥٦٧');
  assert.equal(ar.number(1.5, 3), '١٫٥٠٠');
  assert.equal(ar.number(999), '٩٩٩');
  assert.equal(ar.number(-42), '−٤٢');
});

test('الدينار الكويتي بثلاث خانات عشرية', () => {
  assert.equal(ar.money(1.5), '١٫٥٠٠ د.ك');
  assert.equal(ar.money(2.25), '٢٫٢٥٠ د.ك');
  assert.equal(ar.money(0.5), '٠٫٥٠٠ د.ك');
  assert.equal(ar.money(145), '١٤٥٫٠٠٠ د.ك');
});

test('النسبة المئوية بعلامة عربية', () => {
  assert.equal(ar.percent(98), '٩٨٪');
});

test('فئات تمييز العدد الست', () => {
  assert.equal(ar.pluralCategory(0), 'zero');
  assert.equal(ar.pluralCategory(1), 'one');
  assert.equal(ar.pluralCategory(2), 'two');
  assert.equal(ar.pluralCategory(3), 'few');
  assert.equal(ar.pluralCategory(10), 'few');
  assert.equal(ar.pluralCategory(11), 'many');
  assert.equal(ar.pluralCategory(99), 'many');
  assert.equal(ar.pluralCategory(100), 'other');
  assert.equal(ar.pluralCategory(103), 'few', '١٠٣ ← باقي المئة ٣ فتُجمع');
  assert.equal(ar.pluralCategory(111), 'many');
});

test('تمييز العدد للطلبات', () => {
  assert.equal(ar.plural(0, 'order'), 'لا طلبات');
  assert.equal(ar.plural(1, 'order'), 'طلب واحد');
  assert.equal(ar.plural(2, 'order'), 'طلبان');
  assert.equal(ar.plural(3, 'order'), '٣ طلبات');
  assert.equal(ar.plural(10, 'order'), '١٠ طلبات');
  assert.equal(ar.plural(11, 'order'), '١١ طلبًا');
  assert.equal(ar.plural(45, 'order'), '٤٥ طلبًا');
  assert.equal(ar.plural(100, 'order'), '١٠٠ طلب');
});

test('تمييز العدد للوقت — الخطأ الذي كان في الواجهة', () => {
  assert.equal(ar.plural(5, 'minute'), '٥ دقائق', 'وليس ٥ دقيقة');
  assert.equal(ar.plural(2, 'minute'), 'دقيقتان', 'وليس ٢ دقيقة');
  assert.equal(ar.plural(3, 'hour'), '٣ ساعات', 'وليس ٣ ساعة');
  assert.equal(ar.plural(24, 'hour'), '٢٤ ساعة');
  assert.equal(ar.plural(2, 'day'), 'يومان', 'وليس ٢ يوم');
  assert.equal(ar.plural(5, 'agent'), '٥ مندوبين', 'وليس ٥ مندوب');
  assert.equal(ar.plural(6, 'account'), '٦ حسابات', 'وليس ٦ حسابًا');
});

test('المثنّى يتغيّر بتغيّر موقعه من الإعراب', () => {
  assert.equal(ar.plural(2, 'order'), 'طلبان', 'مرفوع كمبتدأ');
  assert.equal(ar.plural(2, 'order', { case: 'oblique' }), 'طلبين', 'مجرور بعد حرف جر');
  assert.equal(ar.plural(2, 'agent', { case: 'oblique' }), 'مندوبين');
  assert.equal(ar.plural(5, 'order', { case: 'oblique' }), '٥ طلبات', 'الجمع لا يتأثر');
});

test('إظهار الرقم صراحةً في العدّادات', () => {
  assert.equal(ar.plural(2, 'order', { showNumber: true }), '٢ طلبان');
  assert.equal(ar.plural(1, 'order', { showNumber: true }), '١ طلب واحد');
  assert.equal(ar.plural(0, 'order', { showNumber: true }), '٠ طلبات');
});

test('الصفة تتبع فئة العدد — اسم غير عاقل مذكّر', () => {
  assert.equal(ar.describe(0, 'order', 'active'), 'لا طلبات نشطة');
  assert.equal(ar.describe(1, 'order', 'active'), 'طلب واحد نشط');
  assert.equal(ar.describe(2, 'order', 'active'), 'طلبان نشطان');
  assert.equal(ar.describe(5, 'order', 'active'), '٥ طلبات نشطة', 'جمع غير العاقل يوصف بمفرد مؤنث');
  assert.equal(ar.describe(11, 'order', 'active'), '١١ طلبًا نشطًا');
  assert.equal(ar.describe(100, 'order', 'active'), '١٠٠ طلب نشط');
});

test('الصفة مع اسم عاقل تأخذ جمع المذكّر السالم', () => {
  assert.equal(ar.describe(0, 'agent', 'shown'), 'لا مندوبين ظاهرين', 'وليس «لا مندوبين ظاهرة»');
  assert.equal(ar.describe(1, 'agent', 'shown'), 'مندوب واحد ظاهر');
  assert.equal(ar.describe(2, 'agent', 'shown'), 'مندوبان ظاهران');
  assert.equal(ar.describe(5, 'agent', 'shown'), '٥ مندوبين ظاهرين', 'جمع العاقل يوصف بجمعه');
  assert.equal(ar.describe(11, 'agent', 'shown'), '١١ مندوبًا ظاهرًا');
});

test('الصفة مع اسم مؤنّث', () => {
  assert.equal(ar.describe(1, 'attempt', 'pending'), 'محاولة واحدة معلّقة');
  assert.equal(ar.describe(2, 'attempt', 'pending'), 'محاولتان معلّقتان');
  assert.equal(ar.describe(4, 'attempt', 'pending'), '٤ محاولات معلّقة');
});

test('إضافة اسم جديد للقاموس', () => {
  ar.noun('parcel', { zero: 'لا طرود', one: 'طرد واحد', two: 'طردان', few: 'طرود', many: 'طردًا', other: 'طرد' });
  assert.equal(ar.plural(4, 'parcel'), '٤ طرود');
  assert.equal(ar.plural(2, 'parcel'), 'طردان');
});

test('اسم غير معروف يرمي خطأ واضحًا', () => {
  assert.throws(() => ar.plural(3, 'nope'), /اسم غير معروف/);
});

test('الوقت بنظام ١٢ ساعة عربيًا', () => {
  assert.equal(ar.time(new Date(2026, 7, 12, 9, 42)), '٠٩:٤٢ صباحًا');
  assert.equal(ar.time(new Date(2026, 7, 12, 13, 5)), '٠١:٠٥ ظهرًا');
  assert.equal(ar.time(new Date(2026, 7, 12, 20, 30)), '٠٨:٣٠ مساءً');
  assert.equal(ar.time(new Date(2026, 7, 12, 0, 0)), '١٢:٠٠ صباحًا');
});

test('التاريخ بالأشهر العربية', () => {
  assert.equal(ar.date(new Date(2026, 7, 12)), '١٢ أغسطس ٢٠٢٦');
  assert.equal(ar.date(new Date(2026, 7, 12), true), 'الأربعاء، ١٢ أغسطس ٢٠٢٦');
});

test('الوقت النسبي يستخدم الصيغ الصحيحة', () => {
  const now = new Date(2026, 7, 12, 12, 0).getTime();
  const ago = (mins) => new Date(now - mins * 60000);
  assert.equal(ar.since(ago(0.4), now), 'الآن');
  assert.equal(ar.since(ago(1), now), 'قبل دقيقة واحدة');
  assert.equal(ar.since(ago(2), now), 'قبل دقيقتين', 'المثنّى مجرور بعد حرف الجر');
  assert.equal(ar.since(ago(5), now), 'قبل ٥ دقائق');
  assert.equal(ar.since(ago(45), now), 'قبل ٤٥ دقيقة');
  assert.equal(ar.since(ago(120), now), 'قبل ساعتين');
  assert.equal(ar.since(ago(60 * 24 * 2), now), 'قبل يومين');
  assert.equal(ar.since(ago(60 * 5), now), 'قبل ٥ ساعات');
  assert.equal(ar.since(ago(60 * 24 * 3), now), 'قبل ٣ أيام');
  assert.equal(ar.since(new Date(now + 60 * 60000), now), 'بعد ساعة واحدة');
});

test('المدة المقروءة', () => {
  assert.equal(ar.duration(0), 'لا دقائق');
  assert.equal(ar.duration(35), '٣٥ دقيقة');
  assert.equal(ar.duration(60), 'ساعة واحدة');
  assert.equal(ar.duration(95), 'ساعة واحدة و٣٥ دقيقة');
  assert.equal(ar.duration(125), 'ساعتان و٥ دقائق');
});

test('ربط العناصر بواو عربية', () => {
  assert.equal(ar.list([]), '');
  assert.equal(ar.list(['حولي']), 'حولي');
  assert.equal(ar.list(['حولي', 'العاصمة']), 'حولي والعاصمة');
  assert.equal(ar.list(['حولي', 'العاصمة', 'الجهراء']), 'حولي، العاصمة والجهراء');
});

test('حماية النص اللاتيني من انقلاب الاتجاه', () => {
  assert.equal(ar.ltr('+965 2222 0000'), '‎+965 2222 0000');
  assert.equal(ar.ltr('MW-4821').charCodeAt(0), 0x200e);
});

test('التطبيع يتجاهل التشكيل واختلاف الهمزات', () => {
  assert.equal(ar.normalize('الأَحمدي'), 'الاحمدي');
  assert.equal(ar.normalize('مبــارك'), 'مبارك');
  assert.ok(ar.looseEqual('الفروانيّة', 'الفروانيه'));
  assert.ok(ar.looseEqual('إلى', 'الي'));
  assert.ok(!ar.looseEqual('حولي', 'الجهراء'));
});
