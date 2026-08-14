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
