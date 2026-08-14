'use strict';
/**
 * اختبارات رابط المهمّة: موافقة الموقع، الملاحظة الصوتية، بلاغ النتيجة،
 * وتقرير البريد الذي يُرسل بعدها **بلا التسجيل الصوتي**.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-links-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'test.db');
process.env.MAWSOOL_MAIL_TO = 'ops@example.test';

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const LK = require('../server/links');
const M = require('../server/mailer');
const { server } = require('../server/index');

let base;
const cookies = new Map();

async function call(as, method, p, body, extra) {
  const o = extra || {};
  const headers = Object.assign({}, o.headers);
  if (body && !o.raw) headers['Content-Type'] = 'application/json';
  if (as && cookies.has(as)) headers.Cookie = cookies.get(as);
  const res = await fetch(base + p, {
    method, headers, body: o.raw ? o.raw : (body ? JSON.stringify(body) : undefined),
  });
  for (const c of res.headers.getSetCookie?.() || []) if (as) cookies.set(as, c.split(';')[0]);
  const type = res.headers.get('content-type') || '';
  let data = {};
  if (type.includes('json')) { try { data = await res.json(); } catch { /* بلا جسم */ } }
  else data = { __bytes: Buffer.from(await res.arrayBuffer()), __type: type };
  return { status: res.status, data };
}

const agentId = (u) => db.prepare('SELECT id FROM agents WHERE username=?').get(u).id;

test.before(async () => {
  db.exec(`DELETE FROM events; DELETE FROM agent_events; DELETE FROM setting_events;
           DELETE FROM settings; DELETE FROM emails; DELETE FROM voice_notes;
           DELETE FROM delivery_links; DELETE FROM transfers; DELETE FROM orders;
           DELETE FROM sessions; DELETE FROM agents;`);
  const ins = db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                         availability, active, approval, created_at)
     VALUES (?, ?, '+96590000000', ?, ?, 'sedan', 'العاصمة', 'available', 1, 'approved', datetime('now'))`
  );
  ins.run('المدير', 'admin', hashPassword('pass1234'), 'admin');
  ins.run('كابتن أول', 'cap', hashPassword('pass1234'), 'agent');
  ins.run('كابتن ثانٍ', 'cap2', hashPassword('pass1234'), 'agent');

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'pass1234' });
});

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function makeOrder(assignTo = 'cap') {
  const { data } = await call('admin', 'POST', '/api/orders', {
    customer_name: 'عميل', customer_phone: '+96599000000',
    pickup_address: 'العاصمة، قطعة ١', dropoff_address: 'حولي، قطعة ٢',
    governorate: 'العاصمة', vehicle: 'sedan', delivery_fee: 2,
    agent_id: assignTo ? agentId(assignTo) : undefined,
  });
  return data.order;
}

const newLink = async (order) => (await call('admin', 'POST', `/api/orders/${order.id}/link`)).data.link;
const tokenOf = (url) => url.split('/l/')[1];

/* ---------------------------- إنشاء الرابط ---------------------------- */

test('المدير ينشئ رابط مهمّة بعنوان كامل', async () => {
  const order = await makeOrder();
  const r = await call('admin', 'POST', `/api/orders/${order.id}/link`);
  assert.equal(r.status, 200);
  assert.match(r.data.link.url, /\/l\/[A-Za-z0-9_-]{20,}$/);
  assert.equal(r.data.link.active, true);
  assert.equal(r.data.link.opened_at, null);
});

test('المندوب لا ينشئ روابط', async () => {
  const order = await makeOrder();
  await call('cap', 'POST', '/api/auth/login', { username: 'cap', password: 'pass1234' });
  assert.equal((await call('cap', 'POST', `/api/orders/${order.id}/link`)).status, 403);
});

test('لا رابط لطلب غير مُسند', async () => {
  const order = await makeOrder(null);
  const r = await call('admin', 'POST', `/api/orders/${order.id}/link`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /غير مُسند/);
});

test('إنشاء رابط جديد يُلغي السابق', async () => {
  const order = await makeOrder();
  const first = await newLink(order);
  const second = await newLink(order);
  assert.notEqual(first.url, second.url);

  assert.equal((await call(null, 'GET', `/api/link/${tokenOf(first.url)}`)).status, 403);
  assert.equal((await call(null, 'GET', `/api/link/${tokenOf(second.url)}`)).status, 200);
});

/* ---------------------------- فتح الرابط ---------------------------- */

test('الرابط يفتح بلا تسجيل دخول ويعرض ما يحتاجه الكابتن فقط', async () => {
  const order = await makeOrder();
  const link = await newLink(order);
  const r = await call(null, 'GET', `/api/link/${tokenOf(link.url)}`);

  assert.equal(r.status, 200);
  assert.equal(r.data.order.code, order.code);
  assert.equal(r.data.agent.name, 'كابتن أول');
  assert.equal(r.data.order.agent_earning, 1.6, 'يرى مستحقّه');
  assert.equal(r.data.order.commission_amount, undefined, 'ولا يرى عمولة المنصّة');
  assert.deepEqual(Object.keys(r.data.outcomes), ['delivered', 'not_yet', 'failed']);
});

test('فتح الرابط يُسجَّل للمدير', async () => {
  const order = await makeOrder();
  const link = await newLink(order);
  await call(null, 'GET', `/api/link/${tokenOf(link.url)}`);
  const list = (await call('admin', 'GET', `/api/orders/${order.id}/links`)).data.links;
  assert.ok(list[0].opened_at, 'وقت الفتح مسجّل');
});

test('رمز مجهول يُرفض برمز واضح', async () => {
  const r = await call(null, 'GET', '/api/link/not-a-real-token');
  assert.equal(r.status, 404);
  assert.equal(r.data.code, 'link_unknown');
});

test('الرابط المنتهي يُرفض', async () => {
  const order = await makeOrder();
  const link = await newLink(order);
  db.prepare('UPDATE delivery_links SET expires_at=? WHERE id=?')
    .run(new Date(Date.now() - 60_000).toISOString(), link.id);
  const r = await call(null, 'GET', `/api/link/${tokenOf(link.url)}`);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'link_expired');
});

test('نقل الطلب لكابتن آخر يُبطل الرابط', async () => {
  const order = await makeOrder();
  const link = await newLink(order);
  await call('admin', 'POST', `/api/orders/${order.id}/assign`, { agent_id: agentId('cap2') });
  const r = await call(null, 'GET', `/api/link/${tokenOf(link.url)}`);
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'link_reassigned');
});

test('نقل الطلب يُلغي الرابط في القاعدة لا عند القراءة فقط', async () => {
  const order = await makeOrder();
  const link = await newLink(order);

  const before = db.prepare('SELECT revoked_at FROM delivery_links WHERE id=?').get(link.id);
  assert.equal(before.revoked_at, null);

  await call('admin', 'POST', `/api/orders/${order.id}/assign`, { agent_id: agentId('cap2') });

  // لو بقي غير ملغى لعرضته اللوحة للمدير كرابط سارٍ فينسخه ويرسله وهو ميّت
  const after = db.prepare('SELECT revoked_at FROM delivery_links WHERE id=?').get(link.id);
  assert.ok(after.revoked_at, 'الرابط أُلغي فعليًا عند نقل الطلب');

  const shown = (await call('admin', 'GET', `/api/orders/${order.id}/links`)).data.links;
  assert.ok(shown.every((l) => !l.active), 'لا رابط سارٍ معروض للمدير');
});

test('قبول التحويل يُلغي رابط الكابتن السابق', async () => {
  const order = await makeOrder();
  const link = await newLink(order);

  const t = await call('cap', 'POST', `/api/orders/${order.id}/transfer`, {
    to_agent_id: agentId('cap2'), reason: 'العنوان أقرب لك',
  });
  const transferId = t.data.order.transfers.find((x) => x.status === 'pending').id;
  await call('admin', 'POST', `/api/transfers/${transferId}/accept`, {});

  const after = db.prepare('SELECT revoked_at FROM delivery_links WHERE id=?').get(link.id);
  assert.ok(after.revoked_at, 'الرابط أُلغي عند انتقال الطلب بالتحويل');
});

test('المدير يُلغي الرابط يدويًا', async () => {
  const order = await makeOrder();
  const link = await newLink(order);
  assert.equal((await call('admin', 'DELETE', `/api/links/${link.id}`)).status, 200);
  const r = await call(null, 'GET', `/api/link/${tokenOf(link.url)}`);
  assert.equal(r.data.code, 'link_revoked');
});

/* --------------------------- موافقة الموقع --------------------------- */

test('الكابتن يمنح الموافقة ويوقفها ويسحبها من الرابط', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);

  const grant = await call(null, 'POST', `/api/link/${t}/consent`, { granted: true });
  assert.equal(grant.status, 200);
  assert.equal(grant.data.consent.consent, true);
  assert.equal(grant.data.consent.sharing, true);

  const pause = await call(null, 'PATCH', `/api/link/${t}/sharing`, { sharing: false });
  assert.equal(pause.data.consent.sharing, false);

  const revoke = await call(null, 'POST', `/api/link/${t}/consent`, { granted: false });
  assert.equal(revoke.data.consent.consent, false);
});

test('الموافقة يجب أن تكون صريحة', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  assert.equal((await call(null, 'POST', `/api/link/${t}/consent`, { granted: 'yes' })).status, 400);
});

test('لا يُسجَّل موقع قبل الموافقة', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  const r = await call(null, 'POST', `/api/link/${t}/location`, { lat: 29.37, lng: 47.97 });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'consent_required');
});

test('يُسجَّل الموقع بعد الموافقة', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  await call(null, 'POST', `/api/link/${t}/consent`, { granted: true });
  const r = await call(null, 'POST', `/api/link/${t}/location`, {
    lat: 29.3759, lng: 47.9774, accuracy: 12,
  });
  assert.equal(r.status, 200);
  await call(null, 'POST', `/api/link/${t}/consent`, { granted: false });
});

/* -------------------------- الملاحظة الصوتية -------------------------- */

const fakeAudio = (bytes = 2048) => Buffer.alloc(bytes, 7);

test('الكابتن يرسل ملاحظة صوتية', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  const r = await call(null, 'POST', `/api/link/${t}/voice`, null, {
    raw: fakeAudio(), headers: { 'Content-Type': 'audio/webm', 'X-Voice-Seconds': '12' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.voice_note.seconds, 12);
  assert.equal(r.data.voice_note.bytes, 2048);
});

test('صيغة صوت غير مدعومة تُرفض', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  const r = await call(null, 'POST', `/api/link/${t}/voice`, null, {
    raw: fakeAudio(), headers: { 'Content-Type': 'application/zip' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'voice_mime');
});

test('التسجيل الفارغ يُرفض', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  const r = await call(null, 'POST', `/api/link/${t}/voice`, null, {
    raw: Buffer.alloc(0), headers: { 'Content-Type': 'audio/webm' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'voice_empty');
});

test('التسجيل الأكبر من الحد يُرفض بلا تعطيل الخادم', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  const r = await call(null, 'POST', `/api/link/${t}/voice`, null, {
    raw: Buffer.alloc(LK.VOICE_MAX_BYTES + 4096, 3),
    headers: { 'Content-Type': 'audio/webm' },
  });
  assert.equal(r.status, 413);
});

test('المدير يسمع الملاحظة والمندوب الآخر لا', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  const up = await call(null, 'POST', `/api/link/${t}/voice`, null, {
    raw: fakeAudio(512), headers: { 'Content-Type': 'audio/webm', 'X-Voice-Seconds': '5' },
  });
  const vid = up.data.voice_note.id;

  const asAdmin = await call('admin', 'GET', `/api/voice/${vid}`);
  assert.equal(asAdmin.status, 200);
  assert.equal(asAdmin.data.__type, 'audio/webm');
  assert.equal(asAdmin.data.__bytes.length, 512);

  await call('cap2', 'POST', '/api/auth/login', { username: 'cap2', password: 'pass1234' });
  assert.equal((await call('cap2', 'GET', `/api/voice/${vid}`)).status, 403);
});

/* ---------------------------- بلاغ النتيجة ---------------------------- */

test('«تم التسليم» ينقل الحالة ويُبطل الرابط', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  const r = await call(null, 'POST', `/api/link/${t}/outcome`, { outcome: 'delivered' });

  assert.equal(r.status, 200);
  assert.equal(r.data.changed_status, true);
  assert.equal(r.data.status, 'delivered');

  // بعد التسليم يجب أن يقرأ الكابتن «انتهت المهمّة» لا «أُلغي من الإدارة»:
  // الرابط يُلغى تلقائيًا عند الإنهاء، ونسبة الإلغاء للإدارة تخالف ما حدث.
  const after = await call(null, 'GET', `/api/link/${t}`);
  assert.equal(after.status, 403);
  assert.equal(after.data.code, 'link_finished');
  assert.match(after.data.error, /انتهت هذه المهمّة/);
});

test('الرابط الملغى من الإدارة يبقى متمايزًا عن المنتهي', async () => {
  const order = await makeOrder();
  const link = await newLink(order);
  await call('admin', 'DELETE', `/api/links/${link.id}`);
  const r = await call(null, 'GET', `/api/link/${tokenOf(link.url)}`);
  assert.equal(r.data.code, 'link_revoked', 'الطلب ما زال نشطًا فالسبب هو الإلغاء');
});

test('«لم يُسلَّم بعد» لا يغيّر الحالة ويبقي الرابط عاملًا', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  const before = (await call('admin', 'GET', `/api/orders/${order.id}`)).data.order.status;

  const r = await call(null, 'POST', `/api/link/${t}/outcome`, {
    outcome: 'not_yet', note: 'زحمة في الطريق الدائري',
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.changed_status, false);
  assert.equal(r.data.status, before, 'الحالة كما هي');
  assert.equal((await call(null, 'GET', `/api/link/${t}`)).status, 200, 'الرابط ما زال يعمل');

  const events = (await call('admin', 'GET', `/api/orders/${order.id}`)).data.order.events;
  const progress = events.find((e) => e.type === 'progress');
  assert.ok(progress, 'سُجّل التحديث');
  assert.equal(progress.note, 'زحمة في الطريق الدائري');
});

test('«لم يُسلَّم بعد» يشترط سببًا', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  const r = await call(null, 'POST', `/api/link/${t}/outcome`, { outcome: 'not_yet' });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'note_required');
});

test('«تعذّر التسليم» يشترط سببًا ثم يغيّر الحالة', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);

  assert.equal((await call(null, 'POST', `/api/link/${t}/outcome`, { outcome: 'failed' })).status, 400);

  const r = await call(null, 'POST', `/api/link/${t}/outcome`, {
    outcome: 'failed', note: 'العميل لم يردّ بعد انتظار ١٥ دقيقة',
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'failed');
});

test('نتيجة غير معروفة تُرفض', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  assert.equal((await call(null, 'POST', `/api/link/${t}/outcome`, { outcome: 'maybe' })).status, 400);
});

/* ------------------------------ التقرير ------------------------------ */

test('التقرير يحوي بيانات الطلب والمبالغ والسجل', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  await call(null, 'POST', `/api/link/${t}/outcome`, { outcome: 'delivered' });

  const { subject, body } = M.buildOrderReport(order.id);
  assert.match(subject, new RegExp(order.code));
  assert.match(body, /مستحقّ الكابتن/);
  assert.match(body, /عمولة موصول/);
  assert.match(body, /سجل الطلب/);
  assert.match(body, /كابتن أول/);
});

test('التقرير يذكر الملاحظة الصوتية ولا يرفقها', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  await call(null, 'POST', `/api/link/${t}/voice`, null, {
    raw: fakeAudio(), headers: { 'Content-Type': 'audio/webm', 'X-Voice-Seconds': '9' },
  });
  await call(null, 'POST', `/api/link/${t}/outcome`, { outcome: 'delivered' });

  const { body } = M.buildOrderReport(order.id);
  assert.match(body, /الملاحظات الصوتية/);
  assert.match(body, /٩ ثوانٍ|٩ ثانية/, 'تُذكر مدّتها');
  assert.match(body, /غير مرفقة/, 'ويُصرَّح أنها غير مرفقة');

  const row = db.prepare('SELECT body FROM emails WHERE order_id=? ORDER BY id DESC').get(order.id);
  assert.ok(row, 'أُدرجت الرسالة في الصندوق');
  assert.ok(!/base64|audio\/webm/.test(row.body), 'لا أثر لملف صوتي في جسم الرسالة');
});

test('الرسالة تبقى في الصندوق عند غياب SMTP بدل أن تضيع', async () => {
  const order = await makeOrder();
  const t = tokenOf((await newLink(order)).url);
  const r = await call(null, 'POST', `/api/link/${t}/outcome`, { outcome: 'delivered' });

  assert.equal(r.data.mail.configured, false, 'SMTP غير مضبوط في الاختبار');
  assert.equal(r.data.mail.status, 'pending');

  const box = (await call('admin', 'GET', '/api/emails')).data;
  assert.equal(box.configured, false);
  const mine = box.emails.find((e) => e.order_code === order.code);
  assert.ok(mine, 'الرسالة ظاهرة للمدير');
  assert.equal(mine.status, 'pending');
});

test('صندوق البريد للمدير فقط', async () => {
  assert.equal((await call('cap', 'GET', '/api/emails')).status, 403);
});

test('المدير يرسل تقريرًا يدويًا لأي طلب', async () => {
  const order = await makeOrder();
  const r = await call('admin', 'POST', `/api/orders/${order.id}/report`, {});
  assert.equal(r.status, 200);
  assert.ok(['pending', 'sent', 'failed'].includes(r.data.mail.status));
});
