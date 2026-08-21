'use strict';
/**
 * مصفوفة الصلاحيات: يطرق كل نقطة نهاية بثلاث هويّات — بلا جلسة، ومندوب،
 * ومدير — ويطبع الرمز الفعلي لكل خانة.
 *
 * الغرض اكتشاف حارس ناقص: نقطة إدارية تردّ ٢٠٠ على مندوب، أو نقطة تردّ
 * غير ٤٠١ على زائر بلا جلسة. القراءة وحدها لا تكفي — الحارس قد يكون مكتوبًا
 * في دالّة لا تُستدعى في مسار بعينه.
 *
 *   node test/authz.probe.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-authz-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'probe.db');

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { server } = require('../server/index');

let base;
const cookies = new Map();

async function call(as, method, urlPath, body) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (as && cookies.has(as)) headers.Cookie = cookies.get(as);
  const res = await fetch(base + urlPath, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    if (as) cookies.set(as, c.split(';')[0]);
  }
  let data = {};
  try { data = await res.json(); } catch { /* بلا جسم */ }
  return { status: res.status, data };
}

(async () => {
  db.exec('DELETE FROM events; DELETE FROM agent_events; DELETE FROM transfers; DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;');
  const ins = db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate, availability, active, approval, created_at)
     VALUES (?, ?, '', ?, ?, 'sedan', 'العاصمة', 'available', 1, 'approved', datetime('now'))`
  );
  ins.run('المدير', 'admin', hashPassword('pass1234'), 'admin');
  ins.run('مندوب أ', 'ag1', hashPassword('pass1234'), 'agent');
  ins.run('مندوب ب', 'ag2', hashPassword('pass1234'), 'agent');

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'pass1234' });
  await call('ag1', 'POST', '/api/auth/login', { username: 'ag1', password: 'pass1234' });
  await call('ag2', 'POST', '/api/auth/login', { username: 'ag2', password: 'pass1234' });

  const aid = (u) => db.prepare('SELECT id FROM agents WHERE username=?').get(u).id;

  // طلب مُسند إلى ag1 — يتيح تمييز «ممنوع» عن «غير موجود»
  const mk = await call('admin', 'POST', '/api/orders', {
    customer_name: 'عميل الفحص', customer_phone: '+96599000000',
    pickup_address: 'العاصمة، قطعة ١', dropoff_address: 'حولي، قطعة ٣',
    governorate: 'العاصمة', cod_amount: 0, delivery_fee: 2, agent_id: aid('ag1'),
  });
  const oid = mk.data.order.id;
  const lk = await call('admin', 'POST', `/api/orders/${oid}/link`, {});
  const linkId = lk.data?.link?.id ?? 1;

  /* [التصنيف, الطريقة, المسار, الجسم]
     التصنيف: admin = للمدير وحده · auth = لأي مسجَّل دخول · public = مفتوح */
  const ROUTES = [
    ['public', 'POST',   '/api/auth/login', { username: 'x', password: 'y' }],
    ['auth',   'GET',    '/api/auth/me'],
    // قواميس تسميات ثابتة لا بيانات، وتحتاجها شاشة الدخول قبل المصادقة
    ['public', 'GET',    '/api/meta'],
    ['auth',   'GET',    '/api/agents'],
    ['admin',  'POST',   '/api/agents', { name: 'جديد للفحص', username: 'probe1', password: 'pass1234' }],
    ['admin',  'PATCH',  `/api/agents/${aid('ag2')}`, { phone: '+96599112233' }],
    ['admin',  'PATCH',  `/api/agents/${aid('ag2')}/approval`, { approval: 'approved' }],
    ['admin',  'GET',    `/api/agents/${aid('ag2')}/approval`],
    ['admin',  'POST',   `/api/orders/${oid}/link`, {}],
    ['admin',  'GET',    `/api/orders/${oid}/links`],
    ['admin',  'DELETE', `/api/links/${linkId}`],
    ['admin',  'GET',    '/api/emails'],
    ['admin',  'GET',    '/api/emails/1'],
    ['admin',  'POST',   '/api/emails/retry', {}],
    ['admin',  'POST',   `/api/orders/${oid}/report`, {}],
    ['admin',  'GET',    '/api/settings'],
    ['admin',  'PATCH',  '/api/settings', { commission_type: 'percent', commission_rate: 21 }],
    ['admin',  'GET',    '/api/settings/commission-preview?fee=2'],
    ['auth',   'PATCH',  '/api/me/availability', { availability: 'available' }],
    ['auth',   'GET',    '/api/orders'],
    ['admin',  'POST',   '/api/orders', { customer_name: 'ع', customer_phone: '+96599000000',
                                          pickup_address: 'مكان ما هنا', dropoff_address: 'مكان آخر هناك',
                                          governorate: 'العاصمة', delivery_fee: 1 }],
    ['auth',   'GET',    `/api/orders/${oid}`],
    ['auth',   'PATCH',  `/api/orders/${oid}/status`, { status: 'accepted' }],
    ['admin',  'PUT',    `/api/orders/${oid}/pickup-pin`, { pin: '29.3759, 47.9774' }],
    ['admin',  'GET',    `/api/orders/${oid}/nearest`],
    ['admin',  'POST',   '/api/voice-orders/parse', { transcript: 'من حولي إلى السالمية' }],
    ['auth',   'POST',   '/api/agent/ask', { text: 'الطلبات النشطة' }],
    ['admin',  'POST',   `/api/orders/${oid}/assign`, { agent_id: aid('ag2') }],
    ['auth',   'POST',   `/api/orders/${oid}/transfer`, { to_agent_id: aid('ag1') }],
    ['auth',   'GET',    '/api/transfers'],
    ['auth',   'GET',    '/api/me/location-consent'],
    ['auth',   'POST',   '/api/me/location-consent', {}],
    ['auth',   'PATCH',  '/api/me/location-sharing', { sharing: false }],
    ['auth',   'DELETE', '/api/me/location-history'],
    ['auth',   'POST',   '/api/me/location', { lat: 29.3, lng: 47.9 }],
    ['admin',  'GET',    `/api/agents/${aid('ag2')}/location`],   // زميل لا الطارق نفسه
    ['admin',  'GET',    `/api/agents/${aid('ag2')}/trail`],      // زميل لا الطارق نفسه
    ['admin',  'GET',    '/api/locations/live'],
    ['auth',   'GET',    '/api/stats'],
    ['auth',   'GET',    '/api/voice/1'],
  ];

  const rows = [];
  const problems = [];
  for (const [kind, method, urlPath, body] of ROUTES) {
    const anon = await call(null, method, urlPath, body);
    const agent = await call('ag1', method, urlPath, body);
    const admin = await call('admin', method, urlPath, body);
    rows.push({ kind, method, urlPath, anon: anon.status, agent: agent.status, admin: admin.status });

    // زائر بلا جلسة يجب أن يُردّ ٤٠١ على كل ما ليس عامًّا
    if (kind !== 'public' && anon.status !== 401) {
      problems.push(`${method} ${urlPath} — زائر بلا جلسة حصل على ${anon.status} بدل 401`);
    }
    // نقطة إدارية يجب ألّا تنجح لمندوب
    if (kind === 'admin' && agent.status < 400) {
      problems.push(`${method} ${urlPath} — مندوب نفّذ نقطة إدارية (${agent.status})`);
    }
    if (kind === 'admin' && agent.status >= 400 && agent.status !== 403) {
      problems.push(`${method} ${urlPath} — مُنع المندوب برمز ${agent.status} لا 403 (رسالة غامضة)`);
    }
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('التصنيف', 8)} ${pad('الطريقة', 7)} ${pad('المسار', 44)} زائر  مندوب  مدير`);
  console.log('─'.repeat(80));
  for (const r of rows) {
    console.log(`${pad(r.kind, 8)} ${pad(r.method, 7)} ${pad(r.urlPath.slice(0, 43), 44)} ${pad(r.anon, 5)} ${pad(r.agent, 6)} ${r.admin}`);
  }
  console.log('');
  if (problems.length) {
    console.log('⚠ خلل في الصلاحيات:');
    for (const p of problems) console.log('  • ' + p);
  } else {
    console.log('✓ مصفوفة الصلاحيات سليمة على ' + ROUTES.length + ' نقطة');
  }

  server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(problems.length ? 1 : 0);
})();
