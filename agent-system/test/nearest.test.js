'use strict';
/**
 * أقرب كابتن للزبون.
 *
 * ما يستحقّ الاختبار هنا ليس حساب المسافة — تلك معادلة معروفة — بل:
 *   • ما الذي يُقبل دبّوسًا وما الذي يُرفض، وهل يُكشف قلب الإحداثيتين.
 *   • هل يخضع الترتيب لقواعد الخصوصية أم يلتفّ عليها.
 *   • هل يخضع لقواعد الإسناد نفسها أم يقترح من لا يصلح.
 *   • هل يُسجَّل الاطّلاع على موقع كل كابتن يظهر في النتيجة.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-near-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'near.db');

const { db, now } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { server } = require('../server/index');
const N = require('../server/nearest');

/* نقاط حقيقية في الكويت */
const SALMIYA = { lat: 29.3339, lng: 48.0782 };
const HAWALLI = { lat: 29.3326, lng: 48.0289 };   // نحو ٥ كم عن السالمية
const JAHRA   = { lat: 29.3375, lng: 47.6581 };   // نحو ٤٠ كم

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

const agentId = (u) => db.prepare('SELECT id FROM agents WHERE username=?').get(u).id;

/** يضع كابتنًا في نقطة: موافقة ومشاركة ونقطة طازجة */
function place(username, point, ageMinutes = 0) {
  const gid = agentId(username);
  db.prepare('UPDATE agents SET location_consent=1, location_consent_at=?, location_sharing=1 WHERE id=?')
    .run(now(), gid);
  db.prepare('INSERT INTO locations (agent_id, lat, lng, recorded_at) VALUES (?,?,?,?)')
    .run(gid, point.lat, point.lng, new Date(Date.now() - ageMinutes * 60000).toISOString());
  return gid;
}

test.before(async () => {
  db.exec(`DELETE FROM location_views; DELETE FROM locations; DELETE FROM events;
           DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;`);
  const ins = db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                         availability, active, approval, created_at)
     VALUES (?,?,?,?,?,?,'حولي','available',1,?,datetime('now'))`
  );
  ins.run('سعود المدير', 'admin', '', hashPassword('pass1234'), 'admin', 'sedan', 'approved');
  ins.run('قريب',  'near',  '+96590000001', hashPassword('pass1234'), 'agent', 'sedan', 'approved');
  ins.run('بعيد',  'far',   '+96590000002', hashPassword('pass1234'), 'agent', 'sedan', 'approved');
  ins.run('كتوم',  'quiet', '+96590000003', hashPassword('pass1234'), 'agent', 'sedan', 'approved');
  ins.run('محظور', 'banned','+96590000004', hashPassword('pass1234'), 'agent', 'sedan', 'blocked');
  ins.run('شاحنة', 'van',   '+96590000005', hashPassword('pass1234'), 'agent', 'van',   'approved');

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'pass1234' });
});

test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

/* ------------------------------ الدبّوس ------------------------------ */

test('يقبل الدبّوس بكل صيغه التي تصل فعلًا من واتساب والخرائط', () => {
  const forms = [
    '29.3339, 48.0782',
    '٢٩٫٣٣٣٩, ٤٨٫٠٧٨٢',
    'https://www.google.com/maps/place/Salmiya/@29.3339,48.0782,17z',
    'https://maps.google.com/?q=29.3339,48.0782',
    'https://www.google.com/maps/dir//x/data=!3m1!4b1!3d29.3339!4d48.0782',
    'geo:29.3339,48.0782',
  ];
  for (const f of forms) {
    const pin = N.parsePin(f);
    assert.ok(Math.abs(pin.lat - 29.3339) < 0.001, `خط العرض من: ${f}`);
    assert.ok(Math.abs(pin.lng - 48.0782) < 0.001, `خط الطول من: ${f}`);
  }
});

test('يكشف قلب الإحداثيتين بدل أن يرسل الكابتن إلى الصومال', () => {
  assert.throws(() => N.parsePin('48.0782, 29.3339'), /مقلوبتان/);
});

test('يرفض موقعًا خارج الكويت، ورابطًا مختصرًا لا يحمل إحداثيات', () => {
  assert.throws(() => N.parsePin('25.2048, 55.2708'), /خارج الكويت/);     // دبي
  assert.throws(() => N.parsePin('https://maps.app.goo.gl/abc123'), /الرابط المختصر/);
  assert.throws(() => N.parsePin('السالمية قطعة ٤'), /تعذّر استخراج/);
  assert.throws(() => N.parsePin(''), /فارغ/);
});

test('المسافة المستقيمة معقولة على نقاط كويتية معروفة', () => {
  const km = N.straightKm(SALMIYA, JAHRA);
  assert.ok(km > 35 && km < 50, `السالمية↔الجهراء ${km} كم`);
  assert.ok(N.straightKm(SALMIYA, SALMIYA) < 0.001);
});

/* ------------------------------ الترتيب ------------------------------ */

test('يرتّب الكباتن بالأقرب، ويستبعد غير الصالح بسببه لا بصمت', async () => {
  place('near', HAWALLI);
  place('far', JAHRA);
  place('van', HAWALLI);          // أقرب، لكن مركبته لا تناسب
  place('banned', HAWALLI);       // أقرب، لكن حسابه محظور
  // «كتوم» بلا موافقة — لا يُوضع

  const mk = await call('admin', 'POST', '/api/orders', {
    customer_name: 'منى', customer_phone: '+96599887766',
    pickup_address: 'السالمية قطعة ٤', dropoff_address: 'حولي شارع تونس',
    governorate: 'حولي', delivery_fee: 2, pickup_pin: '29.3339, 48.0782',
  });
  assert.equal(mk.status, 200);
  const oid = mk.data.order.id;

  const res = await call('admin', 'GET', `/api/orders/${oid}/nearest`);
  assert.equal(res.status, 200);

  const names = res.data.candidates.map((c) => c.agent_name);
  assert.deepEqual(names, ['قريب', 'بعيد'], 'الترتيب بالأقرب فالأبعد');
  assert.ok(res.data.candidates[0].straight_km < res.data.candidates[1].straight_km);

  const why = Object.fromEntries(res.data.skipped.map((s) => [s.agent_name, s.reason]));
  assert.equal(why['شاحنة'], 'vehicle');
  assert.equal(why['محظور'], 'not_eligible');
  assert.equal(why['كتوم'], 'no_consent');
});

test('لا يقترح كابتنًا أوقف المشاركة، ولا نقطة قديمة', async () => {
  const oid = db.prepare('SELECT id FROM orders ORDER BY id DESC LIMIT 1').get().id;

  db.prepare('UPDATE agents SET location_sharing=0 WHERE username=?').run('near');
  let res = await call('admin', 'GET', `/api/orders/${oid}/nearest`);
  let why = Object.fromEntries(res.data.skipped.map((s) => [s.agent_name, s.reason]));
  assert.equal(why['قريب'], 'sharing_off');
  assert.ok(!res.data.candidates.some((c) => c.agent_name === 'قريب'));

  db.prepare('UPDATE agents SET location_sharing=1 WHERE username=?').run('near');
  db.prepare('DELETE FROM locations WHERE agent_id=?').run(agentId('near'));
  place('near', HAWALLI, 45);                      // نقطة عمرها ٤٥ دقيقة
  res = await call('admin', 'GET', `/api/orders/${oid}/nearest`);
  why = Object.fromEntries(res.data.skipped.map((s) => [s.agent_name, s.reason]));
  assert.equal(why['قريب'], 'stale');
});

test('كل كابتن يظهر في النتيجة يُسجَّل الاطّلاع على موقعه', async () => {
  const farId = agentId('far');
  db.exec('DELETE FROM location_views');

  const oid = db.prepare('SELECT id FROM orders ORDER BY id DESC LIMIT 1').get().id;
  const res = await call('admin', 'GET', `/api/orders/${oid}/nearest`);
  assert.ok(res.data.candidates.some((c) => c.agent_id === farId));

  const views = db.prepare('SELECT COUNT(*) AS n FROM location_views WHERE agent_id=?').get(farId).n;
  assert.equal(views, 1, 'الاقتراح اطّلاعٌ على الموقع، فيُسجَّل كما تُسجَّل اللوحة المباشرة');
});

test('طلب بلا دبّوس يردّ سببًا مفهومًا لا قائمة فارغة', async () => {
  const mk = await call('admin', 'POST', '/api/orders', {
    customer_name: 'بدر', customer_phone: '+96599000111',
    pickup_address: 'الفروانية قطعة ١', dropoff_address: 'الجهراء شارع ٥',
    governorate: 'الفروانية', delivery_fee: 2,
  });
  const res = await call('admin', 'GET', `/api/orders/${mk.data.order.id}/nearest`);
  assert.equal(res.status, 400);
  assert.match(res.data.error, /بلا موقع للزبون/);
});

test('الدبّوس يُضاف على طلب قائم — يصل غالبًا بعد إنشائه', async () => {
  const mk = await call('admin', 'POST', '/api/orders', {
    customer_name: 'هدى', customer_phone: '+96599000222',
    pickup_address: 'السالمية قطعة ٢', dropoff_address: 'حولي قطعة ٣',
    governorate: 'حولي', delivery_fee: 2,
  });
  const oid = mk.data.order.id;

  const bad = await call('admin', 'PUT', `/api/orders/${oid}/pickup-pin`, { pin: 'ليس موقعًا' });
  assert.equal(bad.status, 400);

  const ok = await call('admin', 'PUT', `/api/orders/${oid}/pickup-pin`, {
    pin: 'https://www.google.com/maps/place/x/@29.3339,48.0782,17z',
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.order.events.some((e) => e.type === 'pickup_pin'), 'يُسجَّل في سجلّ الطلب');

  const res = await call('admin', 'GET', `/api/orders/${oid}/nearest`);
  assert.equal(res.status, 200);
  assert.ok(res.data.candidates.length > 0);
});

test('المندوب لا يرى ترتيب زملائه ولا يضبط الدبّوس', async () => {
  await call('ag', 'POST', '/api/auth/login', { username: 'far', password: 'pass1234' });
  const oid = db.prepare('SELECT id FROM orders ORDER BY id DESC LIMIT 1').get().id;

  assert.equal((await call('ag', 'GET', `/api/orders/${oid}/nearest`)).status, 403);
  assert.equal((await call('ag', 'PUT', `/api/orders/${oid}/pickup-pin`, { pin: '29.3,48.0' })).status, 403);
});
