'use strict';
/**
 * وكيل الطلب الصوتي.
 *
 * ما يستحقّ الاختبار ليس أنه يفهم الجملة النموذجية، بل أنه:
 *   ١) يفهم الكلام الدارج كما يُقال فعلًا، لا الفصيح وحده،
 *   ٢) **لا يخمّن** ما لم يُقَل، ويقول ما نقص،
 *   ٣) لا ينشئ طلبًا أبدًا مهما كان النصّ.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-voice-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'voice.db');

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { server } = require('../server/index');
const V = require('../server/voice-order');

let base;
const cookies = new Map();

async function call(as, method, p, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (as && cookies.has(as)) headers.Cookie = cookies.get(as);
  const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie?.() || []) if (as) cookies.set(as, c.split(';')[0]);
  let data = {};
  try { data = await res.json(); } catch { /* بلا جسم */ }
  return { status: res.status, data };
}

test.before(async () => {
  db.exec('DELETE FROM events; DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;');
  const mk = (name, user, role) => db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                         availability, active, approval, created_at)
     VALUES (?,?,'',?,?,'sedan','حولي','available',1,'approved',datetime('now'))`
  ).run(name, user, hashPassword('pass1234'), role);
  mk('سعود المدير', 'admin', 'admin');
  mk('أحمد الكندري', 'ahmad', 'agent');

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'pass1234' });
  await call('agent', 'POST', '/api/auth/login', { username: 'ahmad', password: 'pass1234' });
});

test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

/* ---------------------------- الأعداد ---------------------------- */

test('يقرأ العدد رقمًا ولفظًا، فصيحًا ودارجًا', () => {
  const same = [
    ['٤', 4], ['4', 4], ['أربعة', 4], ['اربع', 4],
    ['اثنا عشر', 12], ['اثنعش', 12], ['١٢', 12],
    ['خمسة وعشرين', 25], ['ثلاثين', 30], ['واحد', 1],
  ];
  for (const [text, want] of same) {
    assert.equal(V.readNumber(text), want, `«${text}» قُرئت ${V.readNumber(text)} لا ${want}`);
  }
  assert.equal(V.readNumber('بلا عدد هنا'), null);
  assert.equal(V.readNumber(''), null);
});

/* ---------------------------- المناطق ---------------------------- */

test('يطابق اسم المنطقة على اختلاف كتابته — «السالميه» و«السالمية» سواء', () => {
  for (const t of ['من السالمية', 'من السالميه', 'من السالميّة']) {
    assert.equal(V.parseOrder(t).fields.pickup_area, 'السالمية', `فشل على «${t}»`);
  }
});

test('يفضّل الاسم الأطول — «أبو حليفة» لا «أبو» ولا جزء منها', () => {
  const r = V.parseOrder('من أبو حليفة إلى أبو فطيرة');
  assert.equal(r.fields.pickup_area, 'أبو حليفة');
  assert.equal(r.fields.dropoff_area, 'أبو فطيرة');
});

test('يملأ المحافظة من المنطقة، فلا يسأل الموظّف عمّا يُعرف', () => {
  const r = V.parseOrder('من الفحيحيل إلى كيفان');
  assert.equal(r.fields.governorate, 'الأحمدي');
  assert.equal(r.fields.dropoff_governorate, 'العاصمة');
});

/* ---------------------------- الاتجاه ---------------------------- */

test('«من» و«إلى» تحدّدان الاتجاه، ودارج «لين» و«حق» مثلهما', () => {
  for (const t of ['من بيان إلى سلوى', 'من بيان لين سلوى', 'من بيان حق سلوى']) {
    const r = V.parseOrder(t);
    assert.equal(r.fields.pickup_area, 'بيان', `فشل على «${t}»`);
    assert.equal(r.fields.dropoff_area, 'سلوى', `فشل على «${t}»`);
  }
});

test('بلا كلمات اتجاه: الأولى استلام والثانية تسليم', () => {
  const r = V.parseOrder('الرميثية، الجابرية');
  assert.equal(r.fields.pickup_area, 'الرميثية');
  assert.equal(r.fields.dropoff_area, 'الجابرية');
});

test('القطعة تُنسب لمنطقتها لا لأختها', () => {
  const r = V.parseOrder('من السالمية قطعة أربعة إلى الفحيحيل قطعة سبعة');
  assert.equal(r.fields.pickup_block, '4');
  assert.equal(r.fields.dropoff_block, '7');
});

/* -------------------------- لا يخمّن -------------------------- */

test('لا يخمّن منطقةً من اسم يشبهها', () => {
  const r = V.parseOrder('من السالمي إلى مكان ما');
  assert.equal(r.fields.pickup_area, undefined, 'خمّن «السالمي» منطقةً');
  assert.ok(r.missing.some((m) => m.field === 'pickup_area'));
});

test('لا يلتقط اسمًا بلا علامة صريحة', () => {
  const r = V.parseOrder('توصيل من حولي إلى مشرف');
  assert.equal(r.fields.customer_name, undefined);
  assert.ok(r.missing.some((m) => m.field === 'customer_name'));
});

test('الاسم يقف عند الكلمة الوظيفية ولو التصقت بواو', () => {
  assert.equal(V.parseOrder('اسمي منى الصباح ورقمي ٩٩٨٨٧٧٦٦').fields.customer_name, 'منى الصباح');
  assert.equal(V.parseOrder('اسمي وليد العتيبي من حولي').fields.customer_name, 'وليد العتيبي');
});

test('يقرأ الهاتف الكويتي بصيغه، ويترك ما ليس هاتفًا', () => {
  for (const t of ['رقمي ٩٩٨٨٧٧٦٦', 'رقمي 99887766', 'رقمي +96599887766', 'رقمي 00965 99887766']) {
    assert.equal(V.parseOrder(t).fields.customer_phone, '+96599887766', `فشل على «${t}»`);
  }
  assert.equal(V.parseOrder('قطعة ١٢ شارع ٣').fields.customer_phone, undefined);
});

test('رقم قطعة خارج المدى يُقال ولا يُملأ', () => {
  const r = V.parseOrder('من السالمية قطعة ٥٠٠٠');
  assert.equal(r.fields.pickup_block, undefined, 'ملأ قطعةً مرفوضة');
  assert.ok(r.missing.some((m) => m.field === 'pickup_block' && /القطعة/.test(m.why)));
});

test('النصّ الفارغ يقول سببه ولا يرمي', () => {
  const r = V.parseOrder('   ');
  assert.deepEqual(r.fields, {});
  assert.ok(r.missing.some((m) => m.field === 'transcript'));
});

test('يلتقط المركبة والاستعجال حين يُذكران فقط', () => {
  const r = V.parseOrder('مستعجل، سيارة مبردة من الشويخ إلى مشرف');
  assert.equal(r.fields.vehicle, 'reefer');
  assert.equal(r.fields.priority, 'urgent');
  const plain = V.parseOrder('من الشويخ إلى مشرف');
  assert.equal(plain.fields.vehicle, undefined);
  assert.equal(plain.fields.priority, undefined);
});

/* --------------------------- النصّ الملصوق --------------------------- */

const PASTE = [
  'الاسم: منى الصباح',
  'الهاتف: 99887766',
  'الاستلام: السالمية ق٤ ش سالم المبارك',
  'التسليم: الفحيحيل قطعة ٧ منزل ١٢',
  'المبلغ: ١٢٫٥٠٠',
  'رسوم التوصيل: ٢',
  'ملاحظات: اتصل قبل الوصول',
].join('\n');

test('النصّ الملصوق المعنون يُملأ كلّه — لا حقل يبقى للموظّف', () => {
  const f = V.parseOrder(PASTE).fields;
  assert.equal(f.customer_name, 'منى الصباح');
  assert.equal(f.customer_phone, '+96599887766');
  assert.equal(f.pickup_area, 'السالمية');
  assert.equal(f.pickup_block, '4');
  assert.equal(f.pickup_street, 'ش سالم المبارك');
  assert.equal(f.dropoff_area, 'الفحيحيل');
  assert.equal(f.dropoff_block, '7');
  assert.equal(f.dropoff_street, 'منزل ١٢');
  assert.equal(f.cod_amount, 12.5);
  assert.equal(f.delivery_fee, 2);
  assert.equal(f.notes, 'اتصل قبل الوصول');
  assert.deepEqual(V.parseOrder(PASTE).missing, []);
});

test('«ق٤» اختصارًا كـ«قطعة ٤»', () => {
  for (const v of ['السالمية ق٤', 'السالمية ق ٤', 'السالمية قطعة ٤', 'السالمية قطعه 4']) {
    assert.equal(V.parseAddressValue(v).block, 4, `فشل على «${v}»`);
  }
});

test('العنوان الصريح يغلب الاستنتاج من ترتيب الكلام', () => {
  /* «من» في السطر تقول الاستلام، ولو جاء اسمه ثانيًا في النصّ */
  const f = V.parseOrder('التسليم: حولي\nالاستلام: مشرف').fields;
  assert.equal(f.pickup_area, 'مشرف');
  assert.equal(f.dropoff_area, 'حولي');
});

test('العنوان لا يتخطّى المدقّق — قيمة ليست هاتفًا تُهمل', () => {
  const r = V.parseOrder('الهاتف: ٤\nالاستلام: حولي');
  assert.equal(r.fields.customer_phone, undefined, 'ملأ هاتفًا من قيمة ليست هاتفًا');
  assert.ok(r.missing.some((m) => m.field === 'customer_phone'));
});

test('منطقة معنونة غير معروفة تُقال ولا تُملأ فارغةً', () => {
  const r = V.parseOrder('الاستلام: مكان مجهول ش ٥\nالتسليم: حولي');
  assert.ok(!('pickup_area' in r.fields), 'وضع منطقةً فارغة بدل أن يقول');
  assert.equal(r.fields.pickup_street, 'مكان مجهول ش ٥', 'أضاع الشارع وفيه معلومة');
  assert.ok(r.missing.some((m) => m.field === 'pickup_area' && /غير معروفة/.test(m.why)));
});

test('المال لا يُلتقط إلّا معنونًا — أرقام القطع والشوارع ليست مبالغ', () => {
  const f = V.parseOrder('من السالمية قطعة ٤ شارع ١٢ إلى الفحيحيل قطعة ٧').fields;
  assert.equal(f.cod_amount, undefined, 'خمّن مبلغًا من رقم ليس مالًا');
  assert.equal(f.delivery_fee, undefined);
});

test('مبلغ معنون لا يُفهم يُقال ولا يُملأ', () => {
  const r = V.parseOrder('الاستلام: حولي\nالمبلغ: لاحقًا');
  assert.equal(r.fields.cod_amount, undefined);
  assert.ok(r.missing.some((m) => m.field === 'cod_amount'));
});

test('النصّ الحرّ بلا عناوين يبقى مفهومًا كما كان', () => {
  const f = V.parseOrder('أبغى توصيل من السالمية قطعة أربعة إلى الفحيحيل قطعة سبعة').fields;
  assert.equal(f.pickup_area, 'السالمية');
  assert.equal(f.pickup_block, '4');
  assert.equal(f.dropoff_block, '7');
});

test('يقرأ المبلغ بالفاصلة العربية واللاتينية', () => {
  assert.equal(V.readMoney('١٢٫٥٠٠'), 12.5);
  assert.equal(V.readMoney('12.5 د.ك'), 12.5);
  assert.equal(V.readMoney('٣'), 3);
  assert.equal(V.readMoney('لاحقًا'), null);
});

/* ------------------------- المسار: يقرأ ولا يكتب ------------------------- */

test('المسار يقترح ولا ينشئ طلبًا مهما كان النصّ', async () => {
  const before = db.prepare('SELECT COUNT(*) n FROM orders').get().n;
  const res = await call('admin', 'POST', '/api/voice-orders/parse', {
    transcript: 'اسمي منى ورقمي ٩٩٨٨٧٧٦٦ من السالمية قطعة ٤ إلى الفحيحيل قطعة ٧',
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.fields.pickup_area, 'السالمية');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, before, 'أنشأ طلبًا!');
});

test('المسار لمدير العمليات وحده', async () => {
  assert.equal((await call('agent', 'POST', '/api/voice-orders/parse', { transcript: 'من حولي' })).status, 403);
  assert.equal((await call(null, 'POST', '/api/voice-orders/parse', { transcript: 'من حولي' })).status, 401);
});

test('المسار يرفض النصّ الفارغ والطويل جدًّا', async () => {
  assert.equal((await call('admin', 'POST', '/api/voice-orders/parse', {})).status, 400);
  const long = await call('admin', 'POST', '/api/voice-orders/parse', { transcript: 'ا'.repeat(2100) });
  assert.equal(long.status, 400);
});

test('الحقول المقترحة تُقبل كما هي في إنشاء الطلب — لا ترجمة بين الطرفين', async () => {
  const parsed = await call('admin', 'POST', '/api/voice-orders/parse', {
    transcript: 'اسمي منى الصباح ورقمي ٩٩٨٨٧٧٦٦ من السالمية قطعة ٤ إلى الفحيحيل قطعة ٧',
  });
  const made = await call('admin', 'POST', '/api/orders', {
    ...parsed.data.fields, delivery_fee: 2,
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal(made.data.order.pickup_address, 'السالمية، قطعة ٤');
  assert.equal(made.data.order.dropoff_address, 'الفحيحيل، قطعة ٧');
  assert.equal(made.data.order.customer_phone, '+96599887766');
});

test('الملصوق يمرّ إلى الطلب كاملًا — المبالغ والشارع والملاحظات معه', async () => {
  const parsed = await call('admin', 'POST', '/api/voice-orders/parse', { transcript: PASTE });
  assert.deepEqual(parsed.data.missing, [], 'بقي ناقص في نصّ كامل');

  const made = await call('admin', 'POST', '/api/orders', parsed.data.fields);
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const o = made.data.order;
  assert.equal(o.pickup_address, 'السالمية، قطعة ٤، ش سالم المبارك');
  assert.equal(o.dropoff_address, 'الفحيحيل، قطعة ٧، منزل ١٢');
  assert.equal(o.cod_amount, 12.5);
  assert.equal(o.delivery_fee, 2);
  assert.equal(o.notes, 'اتصل قبل الوصول');
});

/* --------------------------- «هل تقصد…؟» --------------------------- */

test('المنطقة القريبة تُقترح ولا تُملأ', () => {
  const r = V.parseOrder('الاستلام: السالمي ق٤\nالتسليم: حولي');
  assert.ok(!('pickup_area' in r.fields), 'ملأ المنطقة من اقتراح');
  const m = r.missing.find((x) => x.field === 'pickup_area');
  assert.ok(m, 'لا سطر عن منطقة الاستلام');
  assert.equal(m.hint, 'السالمية');
  assert.match(m.why, /هل تقصد «السالمية»؟/);
});

test('ما ليس قريبًا لا يُقترح له شيء', () => {
  const r = V.parseOrder('الاستلام: مكان مجهول تمامًا');
  const m = r.missing.find((x) => x.field === 'pickup_area');
  assert.equal(m.hint, undefined, 'اخترع اقتراحًا لما ليس قريبًا');
  assert.match(m.why, /ليست من مناطق الكويت/);
});

test('المكتوب صحيحًا لا يُقترح له بديل', () => {
  const r = V.parseOrder('الاستلام: السالميه ق٤\nالتسليم: الفحيحيل ق٧');
  assert.equal(r.fields.pickup_area, 'السالمية');
  /* الاسم والهاتف ناقصان فعلًا في هذا النصّ — المقصود ألّا يبقى نقصٌ في المكان */
  assert.deepEqual(r.missing.filter((m) => /area|block/.test(m.field)), []);
});
