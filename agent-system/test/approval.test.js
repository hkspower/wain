'use strict';
/**
 * اختبارات اعتماد المندوبين: معتمد · تحت التجربة · غير مقبول · محظور.
 * القاعدة المحورية: حالة الاعتماد هي المفتاح الوحيد لصلاحية العمل،
 * مفروضة في الخادم لا في الواجهة.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-approval-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'test.db');
process.env.MAWSOOL_PROBATION_MAX_ORDERS = '2'; // سقف صغير ليسهل بلوغه في الاختبار

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { server } = require('../server/index');

let base;
const cookies = new Map();

async function call(as, method, path, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (as && cookies.has(as)) headers.Cookie = cookies.get(as);
  const res = await fetch(base + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    if (as) cookies.set(as, c.split(';')[0]);
  }
  let data = {};
  try { data = await res.json(); } catch { /* بلا جسم */ }
  return { status: res.status, data };
}

const login = (as, username, password = 'pass1234') =>
  call(as, 'POST', '/api/auth/login', { username, password });

const agentId = (username) => db.prepare('SELECT id FROM agents WHERE username=?').get(username).id;
const approvalOf = (username) => db.prepare('SELECT approval FROM agents WHERE username=?').get(username).approval;
const activeOf = (username) => db.prepare('SELECT active FROM agents WHERE username=?').get(username).active;

test.before(async () => {
  db.exec('DELETE FROM events; DELETE FROM agent_events; DELETE FROM transfers; DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;');
  const ins = db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                         availability, active, approval, created_at)
     VALUES (?, ?, '', ?, ?, 'sedan', 'العاصمة', 'available', ?, ?, datetime('now'))`
  );
  ins.run('المدير', 'admin', hashPassword('pass1234'), 'admin', 1, 'approved');
  ins.run('مدير ثانٍ', 'admin2', hashPassword('pass1234'), 'admin', 1, 'approved');
  ins.run('معتمد', 'okagent', hashPassword('pass1234'), 'agent', 1, 'approved');
  ins.run('تحت التجربة', 'probation', hashPassword('pass1234'), 'agent', 1, 'under_test');
  ins.run('غير مقبول', 'rejected', hashPassword('pass1234'), 'agent', 0, 'rejected');
  ins.run('محظور', 'blocked', hashPassword('pass1234'), 'agent', 0, 'blocked');

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await login('admin', 'admin');
  await login('okagent', 'okagent');
});

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function makeOrder(assignTo = null) {
  const { data } = await call('admin', 'POST', '/api/orders', {
    customer_name: 'عميل', customer_phone: '+96599000000',
    pickup_address: 'العاصمة، قطعة ١', dropoff_address: 'حولي، قطعة ٢',
    governorate: 'العاصمة', vehicle: 'sedan',
    agent_id: assignTo ? agentId(assignTo) : undefined,
  });
  return data.order;
}

/* ----------------------------- الدخول ----------------------------- */

test('المعتمد وتحت التجربة يستطيعان الدخول', async () => {
  assert.equal((await login('t1', 'okagent')).status, 200);
  assert.equal((await login('t2', 'probation')).status, 200);
});

test('المحظور يُمنع من الدخول برسالة تشرح السبب', async () => {
  const r = await login('t3', 'blocked');
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'approval_blocked');
  assert.match(r.data.error, /محظور/);
});

test('غير المقبول يُمنع من الدخول برسالة مختلفة', async () => {
  const r = await login('t4', 'rejected');
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'approval_rejected');
  assert.match(r.data.error, /لم يُقبل/);
});

test('كلمة مرور خاطئة لا تكشف حالة الاعتماد', async () => {
  const r = await call('t5', 'POST', '/api/auth/login', { username: 'blocked', password: 'wrong-pass' });
  assert.equal(r.status, 401, 'خطأ عام لا 403');
  assert.match(r.data.error, /اسم المستخدم أو كلمة المرور/);
});

/* --------------------------- إسناد الطلبات --------------------------- */

test('لا يُسند طلب إلى حساب محظور', async () => {
  const order = await makeOrder();
  const r = await call('admin', 'POST', `/api/orders/${order.id}/assign`, { agent_id: agentId('blocked') });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /محظور/);
});

test('لا يُسند طلب إلى حساب غير مقبول', async () => {
  const order = await makeOrder();
  const r = await call('admin', 'POST', `/api/orders/${order.id}/assign`, { agent_id: agentId('rejected') });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /غير مقبول/);
});

test('يُسند الطلب إلى حساب تحت التجربة ضمن سقفه', async () => {
  const order = await makeOrder();
  const r = await call('admin', 'POST', `/api/orders/${order.id}/assign`, { agent_id: agentId('probation') });
  assert.equal(r.status, 200);
  assert.equal(r.data.order.agent_id, agentId('probation'));
});

test('سقف الطلبات النشطة يوقف الإسناد لمن تحت التجربة', async () => {
  const second = await makeOrder();
  const ok = await call('admin', 'POST', `/api/orders/${second.id}/assign`, { agent_id: agentId('probation') });
  assert.equal(ok.status, 200, 'الطلب الثاني ضمن السقف (٢)');

  const third = await makeOrder();
  const r = await call('admin', 'POST', `/api/orders/${third.id}/assign`, { agent_id: agentId('probation') });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /تحت التجربة/);
  assert.match(r.data.error, /سقف/);
});

test('السقف لا يقيّد المعتمد', async () => {
  for (let i = 0; i < 4; i++) {
    const o = await makeOrder();
    const r = await call('admin', 'POST', `/api/orders/${o.id}/assign`, { agent_id: agentId('okagent') });
    assert.equal(r.status, 200, `الطلب ${i + 1} للمعتمد`);
  }
});

/* ------------------------------ التحويل ------------------------------ */

test('لا يُطلب تحويل إلى حساب ممنوع', async () => {
  const order = await makeOrder('okagent');
  const r = await call('okagent', 'POST', `/api/orders/${order.id}/transfer`, {
    to_agent_id: agentId('blocked'), reason: 'سبب كافٍ للتجربة',
  });
  assert.equal(r.status, 409);
});

test('تغيّر حالة المستلِم بعد إنشاء التحويل يمنع القبول', async () => {
  await login('probation2', 'probation');
  const order = await makeOrder('okagent');

  // نفرّغ طلبات «تحت التجربة» أولًا ليتّسع السقف لطلب التحويل
  db.prepare("UPDATE orders SET status='delivered', agent_id=agent_id WHERE agent_id=? AND status IN ('assigned','accepted','picked_up','on_the_way')")
    .run(agentId('probation'));

  const t = await call('okagent', 'POST', `/api/orders/${order.id}/transfer`, {
    to_agent_id: agentId('probation'), reason: 'العنوان أقرب لك',
  });
  assert.equal(t.status, 200);
  const transferId = t.data.order.transfers.find((x) => x.status === 'pending').id;

  // المدير يحظر المستلِم قبل أن يقبل
  const block = await call('admin', 'PATCH', `/api/agents/${agentId('probation')}/approval`, {
    approval: 'blocked', note: 'إيقاف مؤقّت أثناء التحقيق',
  });
  assert.equal(block.status, 200);

  const accept = await call('admin', 'POST', `/api/transfers/${transferId}/accept`, {});
  assert.equal(accept.status, 409, 'لا يُقبل تحويل إلى حساب صار ممنوعًا');

  // إعادته للحالة السابقة حتى لا تتأثر بقية الاختبارات
  await call('admin', 'PATCH', `/api/agents/${agentId('probation')}/approval`, { approval: 'under_test' });
});

/* --------------------------- تغيير الاعتماد --------------------------- */

test('المندوب لا يستطيع تغيير اعتماد أحد', async () => {
  const r = await call('okagent', 'PATCH', `/api/agents/${agentId('probation')}/approval`, {
    approval: 'approved',
  });
  assert.equal(r.status, 403);
});

test('المنع يتطلّب سببًا مكتوبًا', async () => {
  const r = await call('admin', 'PATCH', `/api/agents/${agentId('rejected')}/approval`, {
    approval: 'blocked',
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /سبب/);
});

test('لا يُمنع حساب يحمل طلبات نشطة', async () => {
  const r = await call('admin', 'PATCH', `/api/agents/${agentId('okagent')}/approval`, {
    approval: 'blocked', note: 'محاولة حظر بينما لديه طلبات',
  });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /أعد إسناد طلباته/);
  assert.ok(!/[0-9]/.test(r.data.error), 'الرسالة بأرقام عربية-هندية لا لاتينية');
});

test('الاعتماد يغيّر active ويُسجَّل في سجل الحساب', async () => {
  const before = approvalOf('probation');
  const r = await call('admin', 'PATCH', `/api/agents/${agentId('probation')}/approval`, {
    approval: 'approved', note: 'اجتاز فترة التجربة',
  });
  assert.equal(r.status, 200);
  assert.equal(approvalOf('probation'), 'approved');
  assert.equal(activeOf('probation'), 1);

  const last = r.data.history[0];
  assert.equal(last.type, 'approval');
  assert.equal(last.from_value, before);
  assert.equal(last.to_value, 'approved');
  assert.equal(last.note, 'اجتاز فترة التجربة');
});

test('الحظر يُنهي جلسات الحساب فورًا', async () => {
  await login('victim', 'probation');
  assert.equal((await call('victim', 'GET', '/api/auth/me')).status, 200);

  const r = await call('admin', 'PATCH', `/api/agents/${agentId('probation')}/approval`, {
    approval: 'blocked', note: 'إيقاف فوري',
  });
  assert.equal(r.status, 200);
  assert.equal(activeOf('probation'), 0);
  assert.equal((await call('victim', 'GET', '/api/auth/me')).status, 401, 'الجلسة أُنهيت');
});

test('الحظر يُرجع الحالة إلى غير متصل', () => {
  const row = db.prepare('SELECT availability FROM agents WHERE username=?').get('probation');
  assert.equal(row.availability, 'offline');
});

test('لا يمكن ضبط نفس الحالة مرتين', async () => {
  const r = await call('admin', 'PATCH', `/api/agents/${agentId('probation')}/approval`, {
    approval: 'blocked', note: 'مرة أخرى',
  });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /أصلًا/);
});

test('حالة اعتماد غير معروفة تُرفض', async () => {
  const r = await call('admin', 'PATCH', `/api/agents/${agentId('probation')}/approval`, {
    approval: 'maybe', note: 'حالة مخترعة',
  });
  assert.equal(r.status, 400);
});

test('لا يُمنع آخر مدير في النظام', async () => {
  const second = agentId('admin2');
  const r1 = await call('admin', 'PATCH', `/api/agents/${second}/approval`, {
    approval: 'blocked', note: 'ترك العمل',
  });
  assert.equal(r1.status, 200, 'حظر المدير الثاني مسموح');

  const r2 = await call('admin', 'PATCH', `/api/agents/${agentId('admin')}/approval`, {
    approval: 'blocked', note: 'حظر آخر مدير',
  });
  assert.equal(r2.status, 409);
  assert.match(r2.data.error, /آخر مدير/);
});

/* ------------------------- القوائم والعرض ------------------------- */

test('active لم يعد يُضبط مباشرةً', async () => {
  const r = await call('admin', 'PATCH', `/api/agents/${agentId('okagent')}`, { active: false });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'use_approval_endpoint');
});

test('المدير يرشّح القائمة بحالة الاعتماد', async () => {
  const r = await call('admin', 'GET', '/api/agents?approval=blocked');
  assert.equal(r.status, 200);
  assert.ok(r.data.agents.length > 0);
  assert.ok(r.data.agents.every((a) => a.approval === 'blocked'));
});

test('المندوب لا يرى الحسابات الممنوعة إطلاقًا', async () => {
  const r = await call('okagent', 'GET', '/api/agents');
  assert.equal(r.status, 200);
  const names = r.data.agents.map((a) => a.username);
  assert.ok(!names.includes('blocked'));
  assert.ok(!names.includes('rejected'));
});

test('المندوب الجديد يبدأ تحت التجربة لا معتمدًا', async () => {
  const r = await call('admin', 'POST', '/api/agents', {
    name: 'مندوب جديد', username: 'fresh', password: 'pass1234', role: 'agent',
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.agent.approval, 'under_test');
});

test('المدير الجديد يبدأ معتمدًا', async () => {
  const r = await call('admin', 'POST', '/api/agents', {
    name: 'مدير جديد', username: 'admin3', password: 'pass1234', role: 'admin',
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.agent.approval, 'approved');
});

test('صفحة الاعتماد تعرض الحمل الحالي والسجل', async () => {
  const r = await call('admin', 'GET', `/api/agents/${agentId('okagent')}/approval`);
  assert.equal(r.status, 200);
  assert.ok(r.data.active_orders > 0);
  assert.ok(Array.isArray(r.data.history));
});
