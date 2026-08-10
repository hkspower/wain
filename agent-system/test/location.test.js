'use strict';
/** اختبارات تتبّع الموقع — التركيز على الموافقة والخصوصية */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-loc-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'test.db');

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { server } = require('../server/index');

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
const login = (as, u, p) => call(as, 'POST', '/api/auth/login', { username: u, password: p });
const agentId = (u) => db.prepare('SELECT id FROM agents WHERE username = ?').get(u).id;

/** التسجيل محدود بفاصل زمني أدنى، فنُرجع الطابع للخلف بين النقاط */
const backdate = (u, ms) =>
  db.prepare("UPDATE locations SET recorded_at = datetime('now', ?) WHERE agent_id = ?")
    .run(`-${Math.round(ms / 1000)} seconds`, agentId(u));

test.before(async () => {
  db.exec('DELETE FROM location_views; DELETE FROM locations; DELETE FROM events; DELETE FROM transfers; DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;');
  const ins = db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate, availability, active, created_at)
     VALUES (?, ?, '', ?, ?, 'sedan', 'العاصمة', 'available', 1, datetime('now'))`
  );
  ins.run('المدير', 'admin', hashPassword('pass1234'), 'admin');
  ins.run('مندوب أ', 'drv1', hashPassword('pass1234'), 'agent');
  ins.run('مندوب ب', 'drv2', hashPassword('pass1234'), 'agent');

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await login('admin', 'admin', 'pass1234');
  await login('drv1', 'drv1', 'pass1234');
  await login('drv2', 'drv2', 'pass1234');
});

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const POINT = { lat: 29.3759, lng: 47.9774, accuracy: 12 };

/* ------------------------ الموافقة شرط للتسجيل ------------------------ */

test('لا يُسجَّل أي موقع قبل الموافقة', async () => {
  const { status, data } = await call('drv1', 'POST', '/api/me/location', POINT);
  assert.equal(status, 403);
  assert.equal(data.code, 'consent_required');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM locations').get().n, 0);
});

test('الموافقة تبدأ التسجيل', async () => {
  const c = await call('drv1', 'POST', '/api/me/location-consent', { granted: true });
  assert.equal(c.status, 200);
  assert.equal(c.data.consent, true);
  assert.equal(c.data.sharing, true);

  const r = await call('drv1', 'POST', '/api/me/location', POINT);
  assert.equal(r.status, 200);
  assert.equal(r.data.recorded, true);
});

test('الموافقة يجب أن تكون صريحة لا مُستنتجة', async () => {
  const { status } = await call('drv1', 'POST', '/api/me/location-consent', { granted: 'yes' });
  assert.equal(status, 400);
});

test('المدير لا يستطيع منح الموافقة نيابةً عن المندوب', async () => {
  const { status } = await call('admin', 'POST', '/api/me/location-consent', { granted: true });
  assert.equal(status, 403);
});

/* --------------------------- إيقاف واستئناف --------------------------- */

test('إيقاف المشاركة يمنع التسجيل دون سحب الموافقة', async () => {
  await call('drv1', 'PATCH', '/api/me/location-sharing', { sharing: false });
  backdate('drv1', 60000);

  const blocked = await call('drv1', 'POST', '/api/me/location', POINT);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, 'sharing_off');

  const state = await call('drv1', 'GET', '/api/me/location-consent');
  assert.equal(state.data.consent, true, 'الموافقة تبقى قائمة');

  await call('drv1', 'PATCH', '/api/me/location-sharing', { sharing: true });
  const ok = await call('drv1', 'POST', '/api/me/location', POINT);
  assert.equal(ok.status, 200);
});

test('لا يمكن تشغيل المشاركة بلا موافقة', async () => {
  const { status, data } = await call('drv2', 'PATCH', '/api/me/location-sharing', { sharing: true });
  assert.equal(status, 403);
  assert.equal(data.code, 'consent_required');
});

/* ------------------------------ الاطّلاع ------------------------------ */

test('المدير يرى موقع من وافق فقط', async () => {
  const yes = await call('admin', 'GET', `/api/agents/${agentId('drv1')}/location`);
  assert.equal(yes.status, 200);
  assert.equal(yes.data.available, true);
  assert.ok(Math.abs(yes.data.lat - POINT.lat) < 0.001);

  const no = await call('admin', 'GET', `/api/agents/${agentId('drv2')}/location`);
  assert.equal(no.status, 200);
  assert.equal(no.data.available, false);
  assert.equal(no.data.reason, 'no_consent');
  assert.equal(no.data.lat, undefined, 'لا تُسرَّب إحداثيات مع سبب عدم التوفّر');
});

test('المندوب لا يرى موقع زميله', async () => {
  const { status } = await call('drv2', 'GET', `/api/agents/${agentId('drv1')}/location`);
  assert.equal(status, 403);
});

test('المندوب يرى موقعه ومساره', async () => {
  const self = await call('drv1', 'GET', `/api/agents/${agentId('drv1')}/location`);
  assert.equal(self.status, 200);
  const trail = await call('drv1', 'GET', `/api/agents/${agentId('drv1')}/trail`);
  assert.equal(trail.status, 200);
  assert.ok(trail.data.points.length > 0);
});

test('اللوحة المباشرة للمدير وحده', async () => {
  assert.equal((await call('drv1', 'GET', '/api/locations/live')).status, 403);
  const board = await call('admin', 'GET', '/api/locations/live');
  assert.equal(board.status, 200);
  assert.equal(board.data.agents.length, 2);
  const off = board.data.agents.find((a) => a.agent_name === 'مندوب ب');
  assert.equal(off.available, false);
  assert.equal(off.lat, undefined);
});

test('كل اطّلاع من المدير يُسجَّل ويظهر للمندوب', async () => {
  const state = await call('drv1', 'GET', '/api/me/location-consent');
  assert.ok(state.data.recent_views.length > 0);
  assert.equal(state.data.recent_views[0].viewer_name, 'المدير');
});

/* ---------------------------- المسح والسحب ---------------------------- */

test('المندوب يمسح سجلّ مواقعه مع بقاء الموافقة', async () => {
  const r = await call('drv1', 'DELETE', '/api/me/location-history');
  assert.equal(r.status, 200);
  assert.equal(r.data.consent, true);
  assert.equal(r.data.stored_points, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM locations WHERE agent_id = ?').get(agentId('drv1')).n, 0);
});

test('سحب الموافقة يوقف التسجيل ويمسح كل النقاط', async () => {
  await call('drv1', 'POST', '/api/me/location', POINT);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM locations WHERE agent_id = ?').get(agentId('drv1')).n > 0);

  const revoked = await call('drv1', 'POST', '/api/me/location-consent', { granted: false });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.consent, false);
  assert.equal(revoked.data.sharing, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM locations WHERE agent_id = ?').get(agentId('drv1')).n, 0);

  const after = await call('drv1', 'POST', '/api/me/location', POINT);
  assert.equal(after.status, 403);

  const view = await call('admin', 'GET', `/api/agents/${agentId('drv1')}/location`);
  assert.equal(view.data.available, false);
  assert.equal(view.data.reason, 'no_consent');
});

/* ------------------------------ التحقّقات ------------------------------ */

test('يرفض الإحداثيات خارج النطاق', async () => {
  await call('drv2', 'POST', '/api/me/location-consent', { granted: true });
  assert.equal((await call('drv2', 'POST', '/api/me/location', { lat: 95, lng: 47 })).status, 400);
  assert.equal((await call('drv2', 'POST', '/api/me/location', { lat: 29, lng: 200 })).status, 400);
  assert.equal((await call('drv2', 'POST', '/api/me/location', { lat: 'x', lng: 'y' })).status, 400);
});

test('يتجاهل النقاط المتلاحقة بدل إغراق القاعدة', async () => {
  const first = await call('drv2', 'POST', '/api/me/location', POINT);
  assert.equal(first.data.recorded, true);
  const second = await call('drv2', 'POST', '/api/me/location', POINT);
  assert.equal(second.data.recorded, false);
  assert.equal(second.data.reason, 'too_soon');
});

test('النقطة تُربط بالطلب النشط للمندوب', async () => {
  const { data } = await call('admin', 'POST', '/api/orders', {
    customer_name: 'عميل', customer_phone: '+96599000000',
    pickup_address: 'العاصمة، قطعة ١', dropoff_address: 'حولي، قطعة ٢',
    governorate: 'العاصمة', agent_id: agentId('drv2'),
  });
  await call('drv2', 'PATCH', `/api/orders/${data.order.id}/status`, { status: 'accepted' });

  backdate('drv2', 60000);
  const p = await call('drv2', 'POST', '/api/me/location', { lat: 29.31, lng: 48.02 });
  assert.equal(p.data.recorded, true);
  assert.equal(p.data.order_id, data.order.id);

  const detail = await call('admin', 'GET', `/api/orders/${data.order.id}`);
  assert.equal(detail.data.order.driver_location.available, true);
});

test('لا يُسجَّل موقع بلا جلسة', async () => {
  assert.equal((await call(null, 'POST', '/api/me/location', POINT)).status, 401);
  assert.equal((await call(null, 'GET', '/api/locations/live')).status, 401);
});
