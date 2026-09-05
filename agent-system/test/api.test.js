'use strict';
/**
 * اختبارات قواعد العمل عبر الواجهة البرمجية الحقيقية.
 * تعمل على قاعدة بيانات مؤقتة منفصلة عن بيانات التشغيل.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-test-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'test.db');

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { server } = require('../server/index');

let base;
const cookies = new Map();

/** طلب HTTP باسم مستخدم محدّد (تُحفظ كوكيز الجلسة لكل مستخدم) */
async function call(as, method, path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (as && cookies.has(as)) headers.Cookie = cookies.get(as);

  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) {
    const token = c.split(';')[0];
    if (as) cookies.set(as, token);
  }

  let data = {};
  try { data = await res.json(); } catch { /* بلا جسم */ }
  return { status: res.status, data };
}

const login = (as, username, password) => call(as, 'POST', '/api/auth/login', { username, password });

test.before(async () => {
  db.exec('DELETE FROM events; DELETE FROM agent_events; DELETE FROM transfers; DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;');
  const ins = db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate, availability, active, approval, created_at)
     VALUES (?, ?, '', ?, ?, 'sedan', 'العاصمة', 'available', 1, 'approved', datetime('now'))`
  );
  ins.run('المدير', 'admin', hashPassword('pass1234'), 'admin');
  ins.run('مندوب أ', 'ag1', hashPassword('pass1234'), 'agent');
  ins.run('مندوب ب', 'ag2', hashPassword('pass1234'), 'agent');
  ins.run('مندوب ج', 'ag3', hashPassword('pass1234'), 'agent');

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  await login('admin', 'admin', 'pass1234');
  await login('ag1', 'ag1', 'pass1234');
  await login('ag2', 'ag2', 'pass1234');
  await login('ag3', 'ag3', 'pass1234');
});

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const agentId = (username) => db.prepare('SELECT id FROM agents WHERE username = ?').get(username).id;

async function makeOrder(assignTo = null, extra = {}) {
  const { data } = await call('admin', 'POST', '/api/orders', {
    customer_name: 'عميل تجريبي',
    customer_phone: '+96599000000',
    pickup_address: 'العاصمة، قطعة ١، شارع ٢',
    dropoff_address: 'حولي، قطعة ٣، منزل ٤',
    governorate: 'العاصمة',
    cod_amount: 10,
    delivery_fee: 1.5,
    agent_id: assignTo ? agentId(assignTo) : undefined,
    ...extra,
  });
  return data.order;
}

/* ------------------------------ المصادقة ------------------------------ */

test('يرفض تسجيل الدخول بكلمة مرور خاطئة', async () => {
  const { status } = await call(null, 'POST', '/api/auth/login', { username: 'ag1', password: 'wrong' });
  assert.equal(status, 401);
});

test('يمنع الوصول للواجهة البرمجية بلا جلسة', async () => {
  const { status } = await call(null, 'GET', '/api/orders');
  assert.equal(status, 401);
});

/* ------------------------------- الصلاحيات ------------------------------ */

test('المندوب لا يستطيع إنشاء طلب', async () => {
  const { status } = await call('ag1', 'POST', '/api/orders', {
    customer_name: 'س', customer_phone: '123456', pickup_address: 'مكان ما',
    dropoff_address: 'مكان آخر', governorate: 'العاصمة',
  });
  assert.equal(status, 403);
});

test('المندوب لا يرى إلا طلباته', async () => {
  await makeOrder('ag1');
  await makeOrder('ag2');
  const { data } = await call('ag1', 'GET', '/api/orders');
  assert.ok(data.orders.length > 0);
  assert.ok(data.orders.every((o) => o.agent_name === 'مندوب أ'));
});

test('المندوب لا يفتح طلبًا لا يخصّه', async () => {
  const order = await makeOrder('ag2');
  const { status } = await call('ag1', 'GET', '/api/orders/' + order.id);
  assert.equal(status, 403);
});

/* ---------------------------- دورة حياة الطلب ---------------------------- */

test('الانتقالات تسير بالترتيب المسموح', async () => {
  const order = await makeOrder('ag1');
  for (const next of ['accepted', 'picked_up', 'on_the_way', 'delivered']) {
    const { status, data } = await call('ag1', 'PATCH', `/api/orders/${order.id}/status`, { status: next });
    assert.equal(status, 200, `فشل الانتقال إلى ${next}: ${data.error}`);
    assert.equal(data.order.status, next);
  }
});

test('يرفض القفز فوق خطوات دورة الحياة', async () => {
  const order = await makeOrder('ag1');
  const { status, data } = await call('ag1', 'PATCH', `/api/orders/${order.id}/status`, { status: 'delivered' });
  assert.equal(status, 409);
  assert.equal(data.code, 'invalid_transition');
});

test('تعذّر التسليم يتطلب كتابة سبب', async () => {
  const order = await makeOrder('ag1');
  for (const s of ['accepted', 'picked_up', 'on_the_way']) {
    await call('ag1', 'PATCH', `/api/orders/${order.id}/status`, { status: s });
  }
  const without = await call('ag1', 'PATCH', `/api/orders/${order.id}/status`, { status: 'failed' });
  assert.equal(without.status, 400);

  const withReason = await call('ag1', 'PATCH', `/api/orders/${order.id}/status`,
    { status: 'failed', note: 'المستلم غير متواجد' });
  assert.equal(withReason.status, 200);
  assert.equal(withReason.data.order.failure_reason, 'المستلم غير متواجد');
});

test('الطلب المنتهي لا يقبل تغييرًا جديدًا', async () => {
  const order = await makeOrder('ag1');
  for (const s of ['accepted', 'picked_up', 'on_the_way', 'delivered']) {
    await call('ag1', 'PATCH', `/api/orders/${order.id}/status`, { status: s });
  }
  const { status } = await call('admin', 'PATCH', `/api/orders/${order.id}/status`, { status: 'on_the_way' });
  assert.equal(status, 409);
});

/* ------------------------- التحويل بين المندوبين ------------------------- */

test('التحويل لا ينقل الطلب قبل قبول الزميل', async () => {
  const order = await makeOrder('ag1');
  const { status, data } = await call('ag1', 'POST', `/api/orders/${order.id}/transfer`,
    { to_agent_id: agentId('ag2'), reason: 'العنوان أقرب لك' });

  assert.equal(status, 200);
  assert.equal(data.order.agent_id, agentId('ag1'), 'يجب أن يبقى الطلب مع صاحبه حتى القبول');
  assert.equal(data.order.pending_transfer.status, 'pending');
});

test('قبول التحويل ينقل الطلب فعليًا', async () => {
  const order = await makeOrder('ag1');
  const t = await call('ag1', 'POST', `/api/orders/${order.id}/transfer`,
    { to_agent_id: agentId('ag2'), reason: 'مشغول بطلب عاجل' });

  const accepted = await call('ag2', 'POST', `/api/transfers/${t.data.transfer.id}/accept`, { note: 'تمام' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.order.agent_id, agentId('ag2'));
  assert.equal(accepted.data.order.status, 'assigned');
  assert.ok(accepted.data.order.events.some((e) => e.type === 'transfer_accepted'));
});

test('رفض التحويل يُبقي الطلب مع صاحبه', async () => {
  const order = await makeOrder('ag1');
  const t = await call('ag1', 'POST', `/api/orders/${order.id}/transfer`,
    { to_agent_id: agentId('ag2'), reason: 'خارج نطاقي' });

  const rejected = await call('ag2', 'POST', `/api/transfers/${t.data.transfer.id}/reject`, { note: 'عندي ضغط' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.order.agent_id, agentId('ag1'));
  assert.equal(rejected.data.order.pending_transfer, null);
});

test('لا يقبل التحويل إلا المندوب المقصود', async () => {
  const order = await makeOrder('ag1');
  const t = await call('ag1', 'POST', `/api/orders/${order.id}/transfer`,
    { to_agent_id: agentId('ag2'), reason: 'تجربة' });

  const { status } = await call('ag3', 'POST', `/api/transfers/${t.data.transfer.id}/accept`, {});
  assert.equal(status, 403);
});

test('لا يُسمح بطلبَي تحويل معلّقين على الطلب نفسه', async () => {
  const order = await makeOrder('ag1');
  await call('ag1', 'POST', `/api/orders/${order.id}/transfer`, { to_agent_id: agentId('ag2'), reason: 'الأول' });
  const second = await call('ag1', 'POST', `/api/orders/${order.id}/transfer`, { to_agent_id: agentId('ag3'), reason: 'الثاني' });
  assert.equal(second.status, 409);
  assert.equal(second.data.code, 'transfer_exists');
});

test('لا يمكن تحويل الطلب إلى المندوب نفسه', async () => {
  const order = await makeOrder('ag1');
  const { status } = await call('ag1', 'POST', `/api/orders/${order.id}/transfer`,
    { to_agent_id: agentId('ag1'), reason: 'تجربة' });
  assert.equal(status, 400);
});

test('صاحب الطلب يستطيع سحب طلب التحويل، وغيره لا', async () => {
  const order = await makeOrder('ag1');
  const t = await call('ag1', 'POST', `/api/orders/${order.id}/transfer`,
    { to_agent_id: agentId('ag2'), reason: 'تجربة السحب' });

  const byOther = await call('ag3', 'POST', `/api/transfers/${t.data.transfer.id}/cancel`, {});
  assert.equal(byOther.status, 403);

  const byOwner = await call('ag1', 'POST', `/api/transfers/${t.data.transfer.id}/cancel`, { note: 'رجعت أقدر' });
  assert.equal(byOwner.status, 200);
  assert.equal(byOwner.data.order.pending_transfer, null);
});

test('الطلب المُستلم فعليًا يبقى «تم الاستلام» بعد المناولة', async () => {
  const order = await makeOrder('ag1');
  for (const s of ['accepted', 'picked_up']) {
    await call('ag1', 'PATCH', `/api/orders/${order.id}/status`, { status: s });
  }
  const t = await call('ag1', 'POST', `/api/orders/${order.id}/transfer`,
    { to_agent_id: agentId('ag2'), reason: 'سلّمته الشحنة باليد' });
  const accepted = await call('ag2', 'POST', `/api/transfers/${t.data.transfer.id}/accept`, {});

  assert.equal(accepted.data.order.status, 'picked_up');
  assert.equal(accepted.data.order.agent_id, agentId('ag2'));
});

test('لا يمكن تحويل طلب منتهٍ', async () => {
  const order = await makeOrder('ag1');
  for (const s of ['accepted', 'picked_up', 'on_the_way', 'delivered']) {
    await call('ag1', 'PATCH', `/api/orders/${order.id}/status`, { status: s });
  }
  const { status, data } = await call('ag1', 'POST', `/api/orders/${order.id}/transfer`,
    { to_agent_id: agentId('ag2'), reason: 'متأخر' });
  assert.equal(status, 409);
  assert.equal(data.code, 'not_transferable');
});

test('إنهاء الطلب يُلغي طلب التحويل المعلّق تلقائيًا', async () => {
  const order = await makeOrder('ag1');
  for (const s of ['accepted', 'picked_up', 'on_the_way']) {
    await call('ag1', 'PATCH', `/api/orders/${order.id}/status`, { status: s });
  }
  await call('ag1', 'POST', `/api/orders/${order.id}/transfer`, { to_agent_id: agentId('ag2'), reason: 'قد أحتاج مساعدة' });
  const delivered = await call('ag1', 'PATCH', `/api/orders/${order.id}/status`, { status: 'delivered' });

  assert.equal(delivered.status, 200);
  assert.equal(delivered.data.order.pending_transfer, null);
  assert.ok(delivered.data.order.transfers.some((t) => t.status === 'cancelled'));
});

/* -------------------------------- الإسناد ------------------------------- */

test('المدير يعيد إسناد الطلب مباشرةً ويلغي التحويل المعلّق', async () => {
  const order = await makeOrder('ag1');
  await call('ag1', 'POST', `/api/orders/${order.id}/transfer`, { to_agent_id: agentId('ag2'), reason: 'انتظار' });

  const { status, data } = await call('admin', 'POST', `/api/orders/${order.id}/assign`,
    { agent_id: agentId('ag3'), note: 'إعادة توزيع' });

  assert.equal(status, 200);
  assert.equal(data.order.agent_id, agentId('ag3'));
  assert.equal(data.order.pending_transfer, null);
});

test('المندوب لا يستطيع الإسناد المباشر', async () => {
  const order = await makeOrder('ag1');
  const { status } = await call('ag1', 'POST', `/api/orders/${order.id}/assign`, { agent_id: agentId('ag2') });
  assert.equal(status, 403);
});

/* ------------------------------- الإحصاءات ------------------------------ */

test('صندوق الوارد يعرض التحويلات الموجّهة للمندوب فقط', async () => {
  const order = await makeOrder('ag1');
  await call('ag1', 'POST', `/api/orders/${order.id}/transfer`, { to_agent_id: agentId('ag3'), reason: 'وارد' });

  const inbox = await call('ag3', 'GET', '/api/transfers?box=inbox&status=pending');
  assert.ok(inbox.data.transfers.some((t) => t.order_id === order.id));

  const other = await call('ag2', 'GET', '/api/transfers?box=inbox&status=pending');
  assert.ok(!other.data.transfers.some((t) => t.order_id === order.id));
});

test('إحصاءات المندوب لا تحسب طلبات غيره', async () => {
  const mine = await call('ag1', 'GET', '/api/stats');
  const admin = await call('admin', 'GET', '/api/stats');
  assert.ok(admin.data.counts.delivered >= mine.data.counts.delivered);
  assert.equal(mine.data.agents_online, null);
  assert.ok(typeof admin.data.agents_online === 'number');
});

/* ------------------------------- التحقّقات ------------------------------ */

test('يرفض إنشاء طلب بمحافظة غير معروفة', async () => {
  const { status } = await call('admin', 'POST', '/api/orders', {
    customer_name: 'عميل', customer_phone: '+96599000000',
    pickup_address: 'مكان ما هنا', dropoff_address: 'مكان آخر هناك',
    governorate: 'دبي',
  });
  assert.equal(status, 400);
});

test('يمنع تكرار اسم المستخدم', async () => {
  const { status } = await call('admin', 'POST', '/api/agents', {
    name: 'مندوب مكرر', username: 'ag1', password: 'pass1234',
  });
  assert.equal(status, 409);
});

test('منع الحساب يُنهي جلساته', async () => {
  const created = await call('admin', 'POST', '/api/agents', {
    name: 'مندوب مؤقت', username: 'temp1', password: 'pass1234',
  });
  assert.equal(created.status, 200);

  await login('temp1', 'temp1', 'pass1234');
  assert.equal((await call('temp1', 'GET', '/api/auth/me')).status, 200);

  const blocked = await call('admin', 'PATCH', `/api/agents/${created.data.agent.id}/approval`, {
    approval: 'blocked', note: 'انتهى التعاقد',
  });
  assert.equal(blocked.status, 200);
  assert.equal((await call('temp1', 'GET', '/api/auth/me')).status, 401);
});

/* ------------------ حالات تنفيذية على طلب بلا كابتن ------------------ */

test('طلب لم يُسند بعد لا يُنقل إلى حالة تصف عمل كابتن', async () => {
  const order = await makeOrder();
  assert.equal(order.status, 'new');
  assert.equal(order.agent_id, null);

  for (const status of ['assigned', 'accepted', 'picked_up', 'on_the_way', 'delivered', 'returned']) {
    const res = await call('admin', 'PATCH', `/api/orders/${order.id}/status`, { status, note: 'محاولة' });
    assert.equal(res.status, 409, `الحالة «${status}» مرّت على طلب بلا كابتن`);
    assert.match(res.data.error, /أسند الطلب إلى كابتن أولًا/);
  }

  const after = await call('admin', 'GET', `/api/orders/${order.id}`);
  assert.equal(after.data.order.status, 'new');
});

test('اللوحة لا تعرض للمدير إلا الإلغاء على طلب بلا كابتن', async () => {
  const order = await makeOrder();
  const { data } = await call('admin', 'GET', `/api/orders/${order.id}`);
  assert.deepEqual(data.order.allowed_next, ['cancelled']);
});

test('إلغاء طلب بلا كابتن يبقى متاحًا', async () => {
  const order = await makeOrder();
  const res = await call('admin', 'PATCH', `/api/orders/${order.id}/status`, {
    status: 'cancelled', note: 'العميل تراجع',
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.order.status, 'cancelled');
});

test('بعد الإسناد تعود كل الحالات متاحة للمدير', async () => {
  const order = await makeOrder();
  const assigned = await call('admin', 'POST', `/api/orders/${order.id}/assign`, {
    agent_id: agentId('ag1'),
  });
  assert.equal(assigned.status, 200);

  const { data } = await call('admin', 'GET', `/api/orders/${order.id}`);
  assert.ok(data.order.allowed_next.includes('delivered'));
  assert.ok(data.order.allowed_next.includes('on_the_way'));
});

/* ------------------------ صلابة الواجهة الخلفية ------------------------ */

test('ترويسة X-Forwarded-For لا تُصدَّق ما لم يُعلَن الوسيط', async () => {
  // مفتاح حدّ المحاولات كان «العنوان|المستخدم» والعنوان يؤخذ من الترويسة بلا
  // شرط، فتغييرها كل محاولة يعطي مفتاحًا جديدًا ويُلغي الحدّ من أصله.
  const codes = [];
  for (let i = 0; i < 12; i++) {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${i}` },
      body: JSON.stringify({ username: 'ag3', password: 'خطأ' + i }),
    });
    codes.push(res.status);
  }
  assert.ok(codes.includes(429), 'التخمين مرّ ١٢ مرة بلا حجب رغم تزييف العنوان');
});

test('حدّ اسم المستخدم يحجب التخمين الموزّع ولا يقفل الحساب بلا داعٍ', async () => {
  const auth = require('../server/auth');
  auth.clearFailures('1.1.1.1', 'quota-user');
  // دون الحدّ الواسع: مسموح
  for (let i = 0; i < 30; i++) auth.recordFailure(`9.9.9.${i}`, 'quota-user');
  assert.equal(auth.loginAllowed('9.9.9.200', 'quota-user'), true);
  // فوقه: يُحجب
  for (let i = 0; i < 15; i++) auth.recordFailure(`8.8.8.${i}`, 'quota-user');
  assert.equal(auth.loginAllowed('8.8.8.200', 'quota-user'), false);
  // ولا يمسّ حسابًا آخر
  assert.equal(auth.loginAllowed('8.8.8.200', 'other-user'), true);
});

test('صفحات HTML تحمل ترويسات أمن ومنع التأطير', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'/);
  // الأصول الثابتة لا تحتاجها ولا تُحمَّل بها
  const js = await fetch(base + '/app.js');
  assert.equal(js.headers.get('content-security-policy'), null);
});

test('الأرقام العربية تُقبل في الخادم لا في الواجهة وحدها', () => {
  /* `Number('٢٥')` تعطي NaN و«٢٫٥» كذلك — الفاصلة العربية ليست نقطة. وكان
     كل رقم يصل بالعربية يُردّ «يجب أن يكون رقمًا». والخادم يُطرق من غير
     الواجهة: رابط الكابتن، والتكاملات، والطلب المنطوق. */
  const { num } = require('../server/lib/http');
  assert.equal(num('٢٥', 'النسبة', { max: 100 }), 25);
  assert.equal(num('٢٫٥', 'المبلغ', { max: 100 }), 2.5);
  assert.equal(num('2.5', 'المبلغ', { max: 100 }), 2.5);
  assert.throws(() => num('كلام', 'الحقل'), /يجب أن يكون رقمًا/);
});

test('الهاتف يُطبَّع فلا يخرج رابطٌ لا يعمل', () => {
  /* يُكتب «٩٩٨٨٧٧٦٦» على لوحة عربية فيُخزَّن كما هو، ثم يدخل في `tel:`
     وفي رسالة واتساب وفي البحث: لا يتّصل به هاتف ولا يطابقه بحث ويصل
     الكابتن رابطٌ ميّت. والتحويل ليس تخمينًا — هو الرقم نفسه بحروف أخرى. */
  const { phone } = require('../server/lib/http');
  assert.equal(phone('٩٩٨٨٧٧٦٦', 'هاتف'), '99887766');
  assert.equal(phone('+٩٦٥ ٩٩٨٨ ٧٧٦٦', 'هاتف'), '+96599887766');
  assert.equal(phone('9988-7766', 'هاتف'), '99887766');
  /* ومفتاح الدولة لا يُخترع: من كتب بلا مفتاح فقد قصد ما كتب */
  assert.equal(phone('99887766', 'هاتف'), '99887766');
});

test('إنشاء الحساب لا يترك أثرًا إذا رُدّ في خطوته الأخيرة', async () => {
  /* الإنشاء خطوتان: صفٌّ في `agents` ثم مجموعةٌ له. كانت الأولى تُثبَّت قبل
     أن تُفحص الثانية، فإذا رُدّت المجموعة رجع الردّ رفضًا وبقي الحساب:
     بلا مجموعة، وباسم مستخدمٍ محجوز، وبكلمة مرورٍ تعمل. يرى المسؤول
     «المجموعة غير موجودة» ثم يرى في إعادة المحاولة «اسم المستخدم مستخدم
     بالفعل» على حسابٍ لا أثر له في القائمة — وطريقٌ مسدود.

     الفحص من أثر الرفض لا من نصّه: هل بقي شيء بعده؟ */
  const before = db.prepare('SELECT COUNT(*) AS n FROM agents').get().n;

  const bad = await call('admin', 'POST', '/api/agents', {
    name: 'حسابٌ لا يولد', username: 'phantom', password: 'PhantomPass9',
    role: 'admin', governorate: 'العاصمة', group_id: 999999,
  });
  assert.equal(bad.status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agents').get().n, before);
  assert.equal(db.prepare('SELECT 1 FROM agents WHERE username = ?').get('phantom'), undefined);

  const login = await call('phantom', 'POST', '/api/auth/login',
    { username: 'phantom', password: 'PhantomPass9' });
  assert.equal(login.status, 401);

  /* وإعادة المحاولة تنجح: الاسم لم يُحجز */
  const good = await call('admin', 'POST', '/api/agents', {
    name: 'حسابٌ يولد', username: 'phantom', password: 'PhantomPass9',
    role: 'admin', governorate: 'العاصمة',
  });
  assert.equal(good.status, 200);
  assert.ok(good.data.agent.id);

  /* والمولود من هذه النقطة له مجموعةٌ دائمًا — لا حسابَ بلا صلاحيات معروفة.
     (الحسابات التي تضعها التهيئة بـSQL مباشرة خارج هذا الحكم: لم تمرّ من
     هنا، وتُلحقها `ensureGroups` عند الإقلاع.) */
  const born = db.prepare('SELECT group_id FROM agents WHERE id = ?').get(good.data.agent.id);
  assert.ok(born.group_id, 'وُلد الحساب بلا مجموعة');
});

test('كابتن في مجموعة إدارية يُردّ ولا يُخلَّف حسابًا', async () => {
  /* الرفض هنا مقصود في التصميم — الكابتن يبقى في مجموعة «كابتن» — والمهمّ
     أن يكون الرفض نظيفًا كذلك. */
  const g = await call('admin', 'POST', '/api/groups',
    { name: 'إسناد فقط', perms: ['orders.assign'] });
  assert.equal(g.status, 200);

  const before = db.prepare('SELECT COUNT(*) AS n FROM agents').get().n;
  const bad = await call('admin', 'POST', '/api/agents', {
    name: 'كابتن في غير موضعه', username: 'misplaced', password: 'MisPass1234',
    role: 'agent', governorate: 'العاصمة', group_id: g.data.group.id,
  });
  assert.equal(bad.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agents').get().n, before);
  assert.equal(db.prepare('SELECT 1 FROM agents WHERE username = ?').get('misplaced'), undefined);
});

test('بوّابة الزبون: التحليل والإنشاء بلا جلسة، والطلب موسومٌ بمصدره', async () => {
  /* التحليل عامّ — الزبون بلا حساب. الردّ حقول واقتراحات لا أكثر. */
  const p = await call(null, 'POST', '/api/public/order/parse', {
    text: 'اسمي منيرة ورقمي ٩٩٦٦٥٥٤٤، الاستلام من السالمية قطعة ٤ والتسليم في الجابرية قطعة ٧',
  });
  assert.equal(p.status, 200);
  assert.equal(p.data.fields.customer_name, 'منيرة');
  assert.equal(p.data.fields.pickup_area, 'السالمية');
  assert.equal(p.data.missing.length, 0);

  /* الإنشاء يقبل الحقول المهيكلة وحدها، ويصنع طلبًا بلا رسوم ولا كابتن */
  const c = await call(null, 'POST', '/api/public/order', {
    customer_name: 'منيرة الخالد', customer_phone: '99665544',
    pickup_area: 'السالمية', pickup_block: '4',
    dropoff_area: 'الجابرية', dropoff_block: '7',
  });
  assert.equal(c.status, 200);
  assert.match(c.data.order.code, /^MW-/);
  assert.equal(c.data.order.pickup_address.includes('السالمية'), true);
  /* لا يتسرّب للزبون شيء داخلي */
  assert.equal(c.data.order.commission_amount, undefined);
  assert.equal(c.data.order.id, undefined);

  const row = db.prepare('SELECT * FROM orders WHERE code = ?').get(c.data.order.code);
  assert.equal(row.source, 'public_ai');
  assert.equal(row.status, 'new');
  assert.equal(row.agent_id, null);
  assert.equal(row.created_by, null);
  assert.equal(row.delivery_fee, 0);

  /* منطقةٌ ليست من القائمة تُرفض — البوّابة مهيكلة حصرًا.
     (كان المثال هنا «السالمي» على أنّها ليست منطقة، وهي منطقةٌ في الجهراء
     على الحدود السعودية — عُرف ذلك بمراجعة مصادر خارجية. فالمثال الآن اسمٌ
     لا وجود له، وإلّا اختبرنا رفضَ ما يجب قبوله.) */
  const bad = await call(null, 'POST', '/api/public/order', {
    customer_name: 'منيرة', customer_phone: '99665544',
    pickup_area: 'مكانٌ لا وجود له', dropoff_area: 'الجابرية',
  });
  assert.equal(bad.status, 400);

  /* التسعير يُعيد أخذ لقطة العمولة — لولاه بقيت صفرًا إلى الأبد */
  const priced = await call('admin', 'PATCH', `/api/orders/${row.id}/pricing`, { delivery_fee: 3 });
  assert.equal(priced.status, 200);
  const after = db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id);
  assert.equal(after.delivery_fee, 3);
  assert.ok(after.commission_amount > 0, 'لقطة العمولة لم تُؤخذ');

  /* وبعد التسليم لا تسعير — الاتفاق قائم */
  db.prepare("UPDATE orders SET status='delivered' WHERE id=?").run(row.id);
  const late = await call('admin', 'PATCH', `/api/orders/${row.id}/pricing`, { delivery_fee: 9 });
  assert.equal(late.status, 400);
  db.prepare("UPDATE orders SET status='new' WHERE id=?").run(row.id);
});

test('بوّابة الزبون: «من» لا تنقلب تسليمًا لأنّ في الجملة كلمة «توصيل»', async () => {
  /* أخطر ما وُجد في فحص الوكيل، ومصدره المسار لا المستخرِج. كلمة «توصيل»
     في `SAYS_DROPOFF`، وهي في كل رسالة طلبٍ تقريبًا، فكانت أطبعُ افتتاحيّةٍ
     للطلب — «أبغى **توصيل من** السالمية» — تجعل السالمية **تسليمًا** أيضًا،
     لأن الاسم غلب حرف الجرّ الملاصق للمنطقة. فيصير طرفا الطلب مكانًا واحدًا
     ويذهب الكابتن ليستلم من حيث يسلّم — وكلّ ما يُعرض صحيحُ الشكل: منطقة
     من القائمة في كلا الحقلين. */
  const p = (latest, utterances = []) =>
    call(null, 'POST', '/api/public/order/parse', { utterances, latest });

  let r = await p('ابغى توصيل من السالمية');
  assert.equal(r.data.fields.pickup_area, 'السالمية');
  assert.equal(r.data.fields.dropoff_area, undefined, 'ملأ التسليم بعنوان الاستلام');

  r = await p('ابغى توصيل الى السالمية');
  assert.equal(r.data.fields.dropoff_area, 'السالمية');
  assert.equal(r.data.fields.pickup_area, undefined, 'ملأ الاستلام بعنوان التسليم');

  /* وبلا حرفٍ يحسم العنوان الجهة — ويترك الجهة الأخرى إن كانت مأخوذةً من
     الذكر نفسه، وإلّا صار الطرفان مكانًا واحدًا. */
  r = await p('التوصيل السالمية');
  assert.equal(r.data.fields.dropoff_area, 'السالمية');
  assert.equal(r.data.fields.pickup_area, undefined, 'بقي الافتراض مع العنوان');

  /* وما جاء من رسالةٍ سابقة لا يُمسّ */
  r = await p('التوصيل السالمية', ['من حولي']);
  assert.equal(r.data.fields.pickup_area, 'حولي', 'أُلغي استلامٌ من رسالةٍ سابقة');
  assert.equal(r.data.fields.dropoff_area, 'السالمية');
});

test('بوّابة الزبون: سؤالٌ وطلبٌ في رسالةٍ واحدة — يُجاب ويُقرأ', async () => {
  /* كان الجواب يبتلع الطلب: من كتب «كم السعر؟ وأبغى توصيل من السالمية إلى
     حولي» يُجاب عن السعر ولا يُملأ له حقل، فيعيد كتابة ما كتبه للتوّ.
     والشرط نيّةٌ مصرَّح بها لا حرف جرّ: سؤالٌ عن معلومةٍ يذكر منطقتين
     («كم يأخذ وقتًا من السالمية للجهراء؟») يبقى سؤالًا ولا يملأ شيئًا —
     وإلّا بقيت المنطقتان في البطاقة بعد أن ينصرف صاحبهما إلى طلبٍ آخر. */
  const p = (latest) => call(null, 'POST', '/api/public/order/parse', { utterances: [], latest });

  let r = await p('كم السعر؟ وابغى توصيل من السالمية الى حولي');
  assert.ok(r.data.answer, 'لم يُجَب السؤال');
  assert.equal(r.data.fields.pickup_area, 'السالمية', 'ابتلع الجوابُ الطلب');
  assert.equal(r.data.fields.dropoff_area, 'حولي');

  r = await p('كم ياخذ وقت من السالمية للجهراء؟');
  assert.ok(r.data.answer, 'لم يُجَب السؤال');
  assert.equal(r.data.fields.pickup_area, undefined, 'سؤالٌ عن معلومة ملأ حقلًا');
  assert.equal(r.data.fields.dropoff_area, undefined, 'سؤالٌ عن معلومة ملأ حقلًا');
});

test('بوّابة الزبون: الأحدث يفوز، والمناطق لا تنقلب بلا عنوان', async () => {
  /* المستخرِج يأخذ أوّل ما يطابق، فمن صحّح اسمه بقي على الأوّل. تُقرأ آخر
     جملةٍ وحدها ويعلو ما صرّحت به — وهذا ما يجعل التصحيح مسموعًا. */
  const p = (text, latest) => call(null, 'POST', '/api/public/order/parse', { text, latest });

  let r = await p('اسمي بدر ورقمي ٩٩٠٠١١٢٢، اسمي فهد', 'اسمي فهد');
  assert.equal(r.data.fields.customer_name, 'فهد', 'التصحيح لم يُسمَع');
  assert.equal(r.data.fields.customer_phone, '+96599001122', 'ضاع ما لم يُصحَّح');

  /* المناطق تُقرأ بموضعها، وجملةٌ معزولة فيها منطقة واحدة يقرؤها المستخرِج
     استلامًا مهما كان عنوانها — فلا تُؤخذ إلّا بعنوانٍ صريح فيها. */
  r = await p('من السالمية إلى الجابرية، التسليم إلى الفروانية', 'التسليم إلى الفروانية');
  assert.equal(r.data.fields.pickup_area, 'السالمية');
  assert.equal(r.data.fields.dropoff_area, 'الفروانية', 'تصحيح التسليم لم يُسمَع');

  /* والحرج: منطقةٌ بلا عنوان يجب ألّا تقلب التسليم استلامًا — لو قُلبت
     لذهب الكابتن إلى العنوان الخطأ وهو يظنّ نفسه على الصواب. */
  r = await p('من السالمية إلى الجابرية، الفروانية', 'الفروانية');
  assert.equal(r.data.fields.pickup_area, 'السالمية', 'انقلب الاستلام بجملة بلا عنوان');
  assert.equal(r.data.fields.dropoff_area, 'الجابرية', 'انقلب التسليم بجملة بلا عنوان');

  /* وجملةٌ فيها الطرفان تُؤخذ كما قُرئت */
  r = await p('من الشرق إلى السالمية', 'من الشرق إلى السالمية');
  assert.equal(r.data.fields.pickup_area, 'الشرق');
  assert.equal(r.data.fields.dropoff_area, 'السالمية');

  /* وما امتلأ يخرج من النواقص فلا يُسأل الزبون عمّا أجاب عنه */
  r = await p('اسمي نورة، رقمي ٩٩٨٨٧٧٦٦', 'رقمي ٩٩٨٨٧٧٦٦');
  assert.equal(r.data.missing.some((m) => m.field === 'customer_phone'), false);
});

test('بوّابة الزبون: الملخّص المعروض هو ما سيُرسَل، لا ما قيل أوّلًا', async () => {
  /* البطاقة على الصفحة تُبنى من `heard`، والطلب يُبنى من `fields`. فلمّا
     صار التصحيح يُسمَع في `fields` وحده بقي `heard` على القراءة الأولى:
     يرى الزبون «الاسم: بدر» ويُرسل «فهد». وهو أسوأ من خطأٍ ظاهر — إقرارٌ
     يُؤخذ على غير ما يقع. فيُعاد بناء الملخّص من الحقول بعد الدمج. */
  const r = await call(null, 'POST', '/api/public/order/parse', {
    text: 'اسمي بدر ورقمي ٩٩٠٠١١٢٢، اسمي فهد', latest: 'اسمي فهد',
  });
  const heard = r.data.heard.join(' · ');
  assert.match(heard, /الاسم: فهد/, 'الملخّص يعرض الاسم القديم');
  assert.doesNotMatch(heard, /بدر/, 'بقي الاسم القديم في الملخّص');

  /* وكذلك حين تتغيّر المنطقة: الملخّص يتبع الحقول */
  const r2 = await call(null, 'POST', '/api/public/order/parse', {
    text: 'من السالمية إلى الجابرية، التسليم إلى الفروانية', latest: 'التسليم إلى الفروانية',
  });
  const h2 = r2.data.heard.join(' · ');
  assert.match(h2, /التسليم: الفروانية/, h2);
  assert.doesNotMatch(h2, /التسليم: الجابرية/, h2);
});

test('بوّابة الزبون: السؤال يُجاب ولا يصير طلبًا', async () => {
  /* كان كلُّ ما يقوله الزبون يُبتلع حقولًا. قِيس أثره: سؤالان لا طلب فيهما
     — «كم سعر التوصيل؟» ثم «توصلون الجهراء؟» — أنتجا بطاقةً اسمها «توصلون
     الجهراء» واستلامها الجهراء. أي كابتنٌ يُرسَل إلى عنوانٍ لم يطلبه أحد،
     والزبون لم يُجَب أصلًا. */
  const turn = (utterances, latest, pending) =>
    call(null, 'POST', '/api/public/order/parse', { utterances, latest, pending });

  let r = await turn([], 'كم سعر التوصيل؟', 'customer_name');
  assert.equal(r.status, 200);
  assert.ok(r.data.answer, 'لم يُجَب السؤال');
  assert.match(r.data.answer.answer, /السعر يختلف/, r.data.answer.answer);
  assert.equal(r.data.accepted, null, 'دخل السؤال الطلب');
  assert.equal(r.data.fields.customer_name, undefined, 'صار السؤال اسمًا للزبون');

  /* والحرج: منطقةٌ تُذكر داخل سؤال تغطية لا تصير عنوان استلام */
  r = await turn([], 'توصلون الجهراء؟', 'customer_name');
  assert.ok(r.data.answer, 'لم يُجَب سؤال التغطية');
  assert.equal(r.data.fields.pickup_area, undefined, 'صارت منطقة السؤال استلامًا');

  /* وسؤالٌ لا جواب له لا يُبتلع كذلك، ويُقال للزبون إنّا لا نعرف */
  r = await turn([], 'عندكم خدمة نقل أثاث؟', 'customer_name');
  assert.equal(r.data.answer, null);
  assert.match(r.data.unanswered || '', /ما عندي جواب موثوق/, String(r.data.unanswered));
  assert.deepEqual(r.data.fields, {}, JSON.stringify(r.data.fields));

  /* أمّا الطلب المصوغ سؤالًا فيبقى طلبًا: العنوان الصريح يحسمه */
  r = await turn([], 'ممكن توصل من السالمية إلى الجابرية؟', 'customer_name');
  assert.equal(r.data.fields.pickup_area, 'السالمية');
  assert.equal(r.data.fields.dropoff_area, 'الجابرية');
  assert.ok(r.data.accepted, 'أُسقط طلبٌ صيغ سؤالًا');

  /* والجواب القصير يُغلَّف بعنوان الحقل المنتظَر — في الخادم لا في المتصفّح */
  r = await turn(['اسمي نورة'], 'السالمية', 'pickup_area');
  assert.equal(r.data.accepted, 'الاستلام من السالمية', r.data.accepted);
  assert.equal(r.data.fields.pickup_area, 'السالمية');
  assert.equal(r.data.fields.customer_name, 'نورة', 'ضاع ما سبق');

  /* ولا يُغلَّف ما يحمل عنوانه: «لا، اسمي فهد» جوابًا عن سؤال الاستلام
     كان يصير «الاستلام من لا، اسمي فهد» */
  r = await turn(['اسمي نورة'], 'لا، اسمي فهد', 'pickup_area');
  assert.equal(r.data.accepted, 'لا، اسمي فهد', r.data.accepted);
  assert.equal(r.data.fields.customer_name, 'فهد');
});

test('أسئلة الوكيل: الإدارة تحتاج صلاحيتها، والتعديل يسري على الزبون', async () => {
  const listed = await call('admin', 'GET', '/api/faq');
  assert.equal(listed.status, 200);
  assert.ok(listed.data.items.length >= 14, 'البذرة ناقصة');

  /* الكابتن لا يملك «أسئلة الوكيل» — وهي ليست من صلاحياته أصلًا */
  const denied = await call('ag1', 'GET', '/api/faq');
  assert.equal(denied.status, 403, JSON.stringify(denied.data));

  const created = await call('admin', 'POST', '/api/faq', {
    question: 'هل عندكم تغليف؟',
    answer: 'نعم، نغلّف الشحنات الهشّة بلا رسوم إضافية.',
    keys: ['تغليف', 'تغلفون الشحنه'],
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));

  /* يجيب به الوكيل في الحال، بلا إعادة نشرٍ ولا إقلاع */
  let asked = await call(null, 'POST', '/api/public/order/parse', {
    utterances: [], latest: 'عندكم تغليف؟', pending: '',
  });
  assert.match(asked.data.answer?.answer || '', /نغلّف/, JSON.stringify(asked.data.answer));

  /* والتعطيل يُسكته بلا حذفه */
  await call('admin', 'PATCH', '/api/faq/' + created.data.item.id, { active: false });
  asked = await call(null, 'POST', '/api/public/order/parse', {
    utterances: [], latest: 'عندكم تغليف؟', pending: '',
  });
  assert.equal(asked.data.answer, null, 'أجاب بمدخلة معطّلة');

  /* و«جرّب سؤالًا» يُظهر ما سيقوله الوكيل قبل أن يقوله */
  const tried = await call('admin', 'POST', '/api/faq/try', { text: 'كم السعر؟' });
  assert.equal(tried.status, 200);
  assert.match(tried.data.answer?.question || '', /تكلفة التوصيل/, JSON.stringify(tried.data));

  await call('admin', 'DELETE', '/api/faq/' + created.data.item.id);
});
