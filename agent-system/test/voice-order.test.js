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
