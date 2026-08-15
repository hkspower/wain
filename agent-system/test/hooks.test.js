'use strict';
/**
 * صادر الأحداث: التوقيع، والصندوق، وإعادة المحاولة، وألّا يُفشل فشلُ الوجهة
 * إنشاءَ الرابط.
 *
 * الاختبار يرفع خادمًا صغيرًا يلعب دور n8n ويتحقّق من التوقيع كما يجب أن
 * يتحقّق المستقبل الحقيقي — فيصير الاختبار وصفًا تنفيذيًّا للعقد لا للتنفيذ.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-hooks-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'hooks.db');
process.env.MAWSOOL_WEBHOOK_SECRET = 'سرّ-الفحص-0123456789';

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { server } = require('../server/index');
const HK = require('../server/hooks');

let base;
const cookies = new Map();

async function call(as, method, urlPath, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (as && cookies.has(as)) headers.Cookie = cookies.get(as);
  const res = await fetch(base + urlPath, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie?.() || []) if (as) cookies.set(as, c.split(';')[0]);
  let data = {};
  try { data = await res.json(); } catch { /* بلا جسم */ }
  return { status: res.status, data };
}

/* --------- خادم يلعب دور n8n --------- */
let sink, sinkUrl;
const received = [];
let sinkStatus = 200;

test.before(async () => {
  sink = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      received.push({ headers: req.headers, raw });
      res.writeHead(sinkStatus, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => sink.listen(0, '127.0.0.1', r));
  sinkUrl = `http://127.0.0.1:${sink.address().port}/webhook/mawsool-link`;
  process.env.MAWSOOL_WEBHOOK_URL = sinkUrl;

  db.exec('DELETE FROM webhook_deliveries; DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;');
  const ins = db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate, availability, active, approval, created_at)
     VALUES (?, ?, ?, ?, ?, 'sedan', 'العاصمة', 'available', 1, 'approved', datetime('now'))`
  );
  ins.run('المدير', 'admin', '', hashPassword('pass1234'), 'admin');
  ins.run('أحمد الكندري', 'ag1', '+96590001111', hashPassword('pass1234'), 'agent');

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'pass1234' });
});

test.after(() => {
  server.close(); sink.close(); db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const agentId = (u) => db.prepare('SELECT id FROM agents WHERE username=?').get(u).id;

async function makeAssignedOrder() {
  const { data } = await call('admin', 'POST', '/api/orders', {
    customer_name: 'منى الصباح', customer_phone: '+96599887766',
    pickup_address: 'السالمية، قطعة ٤', dropoff_address: 'حولي، شارع تونس',
    governorate: 'حولي', cod_amount: 5, delivery_fee: 2, agent_id: agentId('ag1'),
  });
  return data.order;
}

/* ------------------------------ الاختبارات ------------------------------ */

test('إنشاء رابط مهمّة يدفع حدثًا موقّعًا فيه ما يكفي لإرسال واتساب', async () => {
  received.length = 0;
  const order = await makeAssignedOrder();
  const res = await call('admin', 'POST', `/api/orders/${order.id}/link`, {});
  assert.equal(res.status, 200);
  assert.equal(res.data.hook.status, 'sent');
  assert.equal(received.length, 1);

  const hit = received[0];
  const body = JSON.parse(hit.raw);
  assert.equal(body.event, 'link.created');
  // كل ما تحتاجه رسالة واتساب حاضر في الحمولة، فلا يعود n8n يسأل النظام
  assert.equal(body.data.agent.phone, '+96590001111');
  assert.equal(body.data.agent.name, 'أحمد الكندري');
  assert.match(body.data.link.url, /\/l\/[A-Za-z0-9_-]+$/);
  assert.equal(body.data.order.code, order.code);
  assert.equal(body.data.order.customer_name, 'منى الصباح');
  assert.ok(body.data.order.agent_earning > 0);
});

test('التوقيع يُحسب على «الطابع.الجسم» ويتحقّق عند المستقبل', async () => {
  received.length = 0;
  const order = await makeAssignedOrder();
  await call('admin', 'POST', `/api/orders/${order.id}/link`, {});
  const hit = received[0];

  const ts = hit.headers['x-mawsool-timestamp'];
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.MAWSOOL_WEBHOOK_SECRET)
    .update(`${ts}.${hit.raw}`).digest('hex');
  assert.equal(hit.headers['x-mawsool-signature'], expected);
  assert.equal(hit.headers['x-mawsool-event'], 'link.created');

  // الطابع داخل التوقيع: تغييره وحده يُبطل التحقّق فلا يُعاد بثّ طلب قديم
  const replay = 'sha256=' + crypto.createHmac('sha256', process.env.MAWSOOL_WEBHOOK_SECRET)
    .update(`${Number(ts) + 60_000}.${hit.raw}`).digest('hex');
  assert.notEqual(replay, expected);
});

test('سرّ خاطئ لا ينتج التوقيع نفسه', async () => {
  received.length = 0;
  const order = await makeAssignedOrder();
  await call('admin', 'POST', `/api/orders/${order.id}/link`, {});
  const hit = received[0];
  const ts = hit.headers['x-mawsool-timestamp'];
  const wrong = 'sha256=' + crypto.createHmac('sha256', 'سرّ-آخر')
    .update(`${ts}.${hit.raw}`).digest('hex');
  assert.notEqual(hit.headers['x-mawsool-signature'], wrong);
});

test('تعثّر الوجهة لا يُفشل إنشاء الرابط، ويبقى الحدث في الصندوق', async () => {
  sinkStatus = 500;
  const order = await makeAssignedOrder();
  const res = await call('admin', 'POST', `/api/orders/${order.id}/link`, {});
  assert.equal(res.status, 200, 'الرابط أُنشئ رغم تعثّر الوجهة');
  assert.equal(res.data.hook.status, 'failed');
  assert.ok(res.data.link.url);

  const box = await call('admin', 'GET', '/api/hooks');
  const failed = box.data.deliveries.find((d) => d.status === 'failed');
  assert.ok(failed, 'الحدث المتعثّر ظاهر للمدير');
  assert.equal(failed.http_status, 500);

  // ثم تتعافى الوجهة فتُعاد المحاولة بنجاح
  sinkStatus = 200;
  const retry = await call('admin', 'POST', '/api/hooks/retry', {});
  assert.ok(retry.data.retried >= 1);
  const after = await call('admin', 'GET', '/api/hooks');
  assert.equal(after.data.deliveries.filter((d) => d.status === 'failed').length, 0);
});

test('بلا سرّ لا يخرج حدث أصلًا', async () => {
  const keep = process.env.MAWSOOL_WEBHOOK_SECRET;
  process.env.MAWSOOL_WEBHOOK_SECRET = '';
  received.length = 0;
  const order = await makeAssignedOrder();
  const res = await call('admin', 'POST', `/api/orders/${order.id}/link`, {});
  assert.equal(res.status, 200);
  assert.equal(res.data.hook.status, 'failed');
  assert.equal(received.length, 0, 'لم يُرسل شيء بلا توقيع');
  process.env.MAWSOOL_WEBHOOK_SECRET = keep;
  await call('admin', 'POST', '/api/hooks/retry', {});
});

test('بلا وجهة مضبوطة لا يُكتب في الصندوق ولا يتعطّل شيء', async () => {
  const keep = process.env.MAWSOOL_WEBHOOK_URL;
  process.env.MAWSOOL_WEBHOOK_URL = '';
  const before = HK.outbox(200).length;
  const order = await makeAssignedOrder();
  const res = await call('admin', 'POST', `/api/orders/${order.id}/link`, {});
  assert.equal(res.status, 200);
  assert.equal(res.data.hook.status, 'off');
  assert.equal(HK.outbox(200).length, before);
  process.env.MAWSOOL_WEBHOOK_URL = keep;
});

test('صادر الأحداث للمدير وحده', async () => {
  await call('ag1', 'POST', '/api/auth/login', { username: 'ag1', password: 'pass1234' });
  assert.equal((await call('ag1', 'GET', '/api/hooks')).status, 403);
  assert.equal((await call('ag1', 'POST', '/api/hooks/retry', {})).status, 403);
  assert.equal((await call(null, 'GET', '/api/hooks')).status, 401);
});

test('ترويسة المصادقة تُرسل حين تُضبط، ولا تظهر بلا ضبط', async () => {
  received.length = 0;
  process.env.MAWSOOL_WEBHOOK_AUTH_VALUE = 'Bearer 9f2c1b7ae4d8360512c9';
  let order = await makeAssignedOrder();
  await call('admin', 'POST', `/api/orders/${order.id}/link`, {});
  assert.equal(received[0].headers.authorization, 'Bearer 9f2c1b7ae4d8360512c9');

  received.length = 0;
  process.env.MAWSOOL_WEBHOOK_AUTH_VALUE = '';
  order = await makeAssignedOrder();
  await call('admin', 'POST', `/api/orders/${order.id}/link`, {});
  assert.equal(received[0].headers.authorization, undefined);
});

/* ترويسات HTTP لا تحمل إلا ASCII. رمز عربي يجعل fetch يرمي قبل الإرسال،
   فيجب أن يظهر السبب في الصندوق لا أن يختفي الحدث بصمت. */
test('رمز مصادقة بحروف عربية يُسجَّل خطؤه بدل أن يضيع الحدث', async () => {
  received.length = 0;
  process.env.MAWSOOL_WEBHOOK_AUTH_VALUE = 'Bearer رمز-عربي';
  const order = await makeAssignedOrder();
  const res = await call('admin', 'POST', `/api/orders/${order.id}/link`, {});
  assert.equal(res.status, 200, 'الرابط أُنشئ رغم فشل الدفع');
  assert.equal(res.data.hook.status, 'failed');
  assert.equal(received.length, 0);

  const box = await call('admin', 'GET', '/api/hooks');
  const last = box.data.deliveries[0];
  assert.equal(last.status, 'failed');
  assert.ok(last.error.length > 0, 'سبب الفشل مكتوب في الصندوق: ' + last.error);

  process.env.MAWSOOL_WEBHOOK_AUTH_VALUE = '';
});
