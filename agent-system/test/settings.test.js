'use strict';
/**
 * اختبارات عمولة الوساطة: تُضبط من لوحة التحكم، وتُلتقط على الطلب وقت إنشائه،
 * ولا يعيد تغييرها لاحقًا حساب طلبات سابقة.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-settings-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'test.db');

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const S = require('../server/settings');
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
  for (const c of res.headers.getSetCookie?.() || []) if (as) cookies.set(as, c.split(';')[0]);
  let data = {};
  try { data = await res.json(); } catch { /* بلا جسم */ }
  return { status: res.status, data };
}

const agentId = (u) => db.prepare('SELECT id FROM agents WHERE username=?').get(u).id;

test.before(async () => {
  db.exec('DELETE FROM events; DELETE FROM agent_events; DELETE FROM setting_events; DELETE FROM settings; DELETE FROM transfers; DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;');
  const ins = db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                         availability, active, approval, created_at)
     VALUES (?, ?, '', ?, ?, 'sedan', 'العاصمة', 'available', 1, 'approved', datetime('now'))`
  );
  ins.run('المدير', 'admin', hashPassword('pass1234'), 'admin');
  ins.run('كابتن', 'cap', hashPassword('pass1234'), 'agent');

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'pass1234' });
  await call('cap', 'POST', '/api/auth/login', { username: 'cap', password: 'pass1234' });
});

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const makeOrder = (fee) => call('admin', 'POST', '/api/orders', {
  customer_name: 'عميل', customer_phone: '+96599000000',
  pickup_address: 'العاصمة، قطعة ١', dropoff_address: 'حولي، قطعة ٢',
  governorate: 'العاصمة', vehicle: 'sedan', delivery_fee: fee,
});

/* ------------------------------ الحساب ------------------------------ */

test('العمولة الافتراضية نسبة ٢٠٪', () => {
  const c = S.commissionFor(1.5);
  assert.equal(c.commission_type, 'percent');
  assert.equal(c.commission_rate, 20);
  assert.equal(c.commission_amount, 0.3);
  assert.equal(c.agent_earning, 1.2);
});

test('المجموع يساوي رسوم التوصيل دائمًا', () => {
  for (const fee of [1.5, 1.75, 2, 2.25, 2.5, 3.333, 0.001]) {
    const c = S.commissionFor(fee);
    assert.equal(S.round3(c.commission_amount + c.agent_earning), S.round3(fee),
      `العمولة + مستحقّ الكابتن يجب أن يساوي ${fee}`);
  }
});

test('التقريب إلى الفلس — الدينار ثلاث خانات', () => {
  const c = S.commissionFor(1.75, { type: 'percent', rate: 20 });
  assert.equal(c.commission_amount, 0.35);
  const c2 = S.commissionFor(2.5, { type: 'percent', rate: 33 });
  assert.equal(c2.commission_amount, 0.825);
  assert.equal(c2.agent_earning, 1.675);
});

test('المبلغ الثابت', () => {
  const c = S.commissionFor(2.5, { type: 'fixed', rate: 0.5 });
  assert.equal(c.commission_amount, 0.5);
  assert.equal(c.agent_earning, 2);
});

test('العمولة لا تتجاوز رسوم التوصيل — لا مستحقّ سالب للكابتن', () => {
  const c = S.commissionFor(1.5, { type: 'fixed', rate: 10 });
  assert.equal(c.commission_amount, 1.5);
  assert.equal(c.agent_earning, 0, 'لا يخرج الكابتن بمبلغ سالب');
});

test('رسوم صفرية تعطي عمولة صفرية', () => {
  const c = S.commissionFor(0);
  assert.equal(c.commission_amount, 0);
  assert.equal(c.agent_earning, 0);
});

test('عمولة ١٠٠٪ تترك الكابتن بلا مستحقّ، و٠٪ تعطيه كل الرسوم', () => {
  assert.equal(S.commissionFor(2, { type: 'percent', rate: 100 }).agent_earning, 0);
  assert.equal(S.commissionFor(2, { type: 'percent', rate: 0 }).commission_amount, 0);
});

/* ------------------------------ اللوحة ------------------------------ */

test('المندوب لا يرى الإعدادات ولا يغيّرها', async () => {
  assert.equal((await call('cap', 'GET', '/api/settings')).status, 403);
  assert.equal((await call('cap', 'PATCH', '/api/settings', { commission_rate: 5 })).status, 403);
});

test('المدير يقرأ الإعدادات', async () => {
  const r = await call('admin', 'GET', '/api/settings');
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.commission_type, 'percent');
  assert.equal(r.data.settings.commission_rate, '20');
});

test('المدير يغيّر العمولة ويُسجَّل التغيير', async () => {
  const r = await call('admin', 'PATCH', '/api/settings', {
    commission_rate: 25, note: 'مراجعة الربع الأول',
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.commission_rate, '25');

  const last = r.data.history[0];
  assert.equal(last.from_value, '٢٠٪', 'السجل يحفظ الصيغة المقروءة بنوعها ووحدتها');
  assert.equal(last.to_value, '٢٥٪');
  assert.equal(last.note, 'مراجعة الربع الأول');
  assert.equal(last.actor_name, 'المدير');
});

test('السجل يوضّح الانتقال من نسبة إلى مبلغ ثابت', async () => {
  const r = await call('admin', 'PATCH', '/api/settings', {
    commission_type: 'fixed', commission_rate: 0.4, note: 'تجربة مبلغ ثابت',
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.history[0].from_value, '٢٥٪');
  assert.equal(r.data.history[0].to_value, '٠٫٤٠٠ د.ك');
  assert.ok(!/[0-9]/.test(r.data.history[0].to_value), 'أرقام عربية-هندية لا لاتينية');

  // إعادتها نسبة ٢٥٪ حتى تكمل بقية الاختبارات على ما تتوقّعه
  await call('admin', 'PATCH', '/api/settings', { commission_type: 'percent', commission_rate: 25 });
});

test('حفظ نفس القيمة يُرفض بدل تلويث السجل', async () => {
  const r = await call('admin', 'PATCH', '/api/settings', { commission_rate: 25 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /أصلًا/);
});

test('قيمة خارج النطاق تُرفض', async () => {
  assert.equal((await call('admin', 'PATCH', '/api/settings', { commission_rate: 150 })).status, 400);
  assert.equal((await call('admin', 'PATCH', '/api/settings', { commission_rate: -5 })).status, 400);
  assert.equal((await call('admin', 'PATCH', '/api/settings', { commission_type: 'gift' })).status, 400);
});

test('طلب بلا حقول معروفة يُرفض', async () => {
  const r = await call('admin', 'PATCH', '/api/settings', { unknown_key: 1 });
  assert.equal(r.status, 400);
});

test('المعاينة تحسب قبل الحفظ', async () => {
  const r = await call('admin', 'GET', '/api/settings/commission-preview?delivery_fee=2');
  assert.equal(r.status, 200);
  assert.equal(r.data.preview.commission_amount, 0.5, '٢٥٪ من ٢٫٠٠٠');
});

/* --------------------- اللقطة على الطلب --------------------- */

test('الطلب يحفظ لقطة العمولة وقت إنشائه', async () => {
  const r = await makeOrder(2);
  assert.equal(r.status, 200);
  assert.equal(r.data.order.commission_rate, 25);
  assert.equal(r.data.order.commission_amount, 0.5);
  assert.equal(r.data.order.agent_earning, 1.5);
});

test('تغيير العمولة لا يمسّ طلبًا سابقًا', async () => {
  const before = (await makeOrder(2)).data.order;
  assert.equal(before.commission_amount, 0.5);

  await call('admin', 'PATCH', '/api/settings', { commission_rate: 40, note: 'رفع العمولة' });

  const after = (await makeOrder(2)).data.order;
  assert.equal(after.commission_amount, 0.8, 'الطلب الجديد بالنسبة الجديدة');

  const reread = (await call('admin', 'GET', '/api/orders/' + before.id)).data.order;
  assert.equal(reread.commission_amount, 0.5, 'الطلب القديم بلقطته الأصلية');
  assert.equal(reread.agent_earning, 1.5);
});

test('إحصاءات اليوم تجمع العمولة ومستحقّ الكباتن', async () => {
  const o = (await makeOrder(2)).data.order; // ٤٠٪ ← ٠٫٨٠٠ عمولة، ١٫٢٠٠ للكابتن
  await call('admin', 'POST', `/api/orders/${o.id}/assign`, { agent_id: agentId('cap') });
  await call('admin', 'PATCH', `/api/orders/${o.id}/status`, { status: 'delivered' });

  const s = (await call('admin', 'GET', '/api/stats')).data;
  assert.ok(s.commission_today > 0);
  assert.equal(S.round3(s.commission_today + s.agent_earning_today), s.fees_today,
    'العمولة + مستحقّ الكباتن = مجموع الرسوم');
});
