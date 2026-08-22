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
  /* موظّف مكتب في مجموعة محدودة: يوزّع الطلبات ويرى الكل، ولا يمسّ
     العمولة ولا الحسابات ولا الروابط ولا البريد ولا المواقع. وجودُه هو
     الفرق بين «مدير أو لا» وبين صلاحياتٍ حقيقية. */
  ins.run('موظّف إسناد', 'disp', hashPassword('pass1234'), 'admin');

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('admin', 'POST', '/api/auth/login', { username: 'admin', password: 'pass1234' });
  await call('ag1', 'POST', '/api/auth/login', { username: 'ag1', password: 'pass1234' });
  await call('ag2', 'POST', '/api/auth/login', { username: 'ag2', password: 'pass1234' });

  const perms = require('../server/perms');
  perms.ensureGroups();
  const admin = db.prepare('SELECT * FROM agents WHERE username=?').get('admin');
  const limited = perms.createGroup(admin, {
    name: 'إسناد فقط', perms: ['orders.assign', 'orders.view_all', 'orders.create'],
  });
  db.prepare('UPDATE agents SET group_id = ? WHERE username = ?').run(limited.id, 'disp');
  await call('disp', 'POST', '/api/auth/login', { username: 'disp', password: 'pass1234' });

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
    ['admin',  'GET',    '/api/groups'],
    ['admin',  'POST',   '/api/groups', { name: 'مجموعة فحص', perms: [] }],
  ];

  /* ما يجب أن **ينجح** لموظّف الإسناد المحدود، وما يجب أن يُمنع عنه.
     نقطةٌ إدارية تنجح له وهو لا يملك صلاحيتها ثغرةٌ، ونقطةٌ تُمنع عنه وهو
     يملكها حاجزٌ بلا سبب — والاثنان يظهران هنا. */
  const LIMITED = {
    allow: [
      ['GET', '/api/orders'],
      /* تفاصيل الطلب تحمل موقع الكابتن. منعُ جزءٍ لا يكون منعَ الكلّ:
         من يرى الطلبات يرى تفاصيلها ولو لم يرَ المواقع. */
      ['GET', `/api/orders/${oid}`],
      ['GET', '/api/stats'],
      ['GET', `/api/orders/${oid}/nearest`],
      ['POST', '/api/voice-orders/parse', { transcript: 'من حولي إلى السالمية' }],
    ],
    deny: [
      ['GET', '/api/settings'],
      ['PATCH', '/api/settings', { commission_type: 'percent', commission_rate: 30 }],
      ['POST', '/api/agents', { name: 'حساب مهرَّب', username: 'sneak', password: 'pass1234' }],
      ['PATCH', `/api/agents/${aid('ag2')}/approval`, { approval: 'blocked' }],
      ['GET', '/api/locations/live'],
      ['GET', `/api/agents/${aid('ag2')}/trail`],
      ['POST', `/api/orders/${oid}/link`, {}],
      ['GET', '/api/emails'],
      ['GET', '/api/groups'],
      ['POST', '/api/groups', { name: 'ترقية نفسي', perms: ['settings.manage'] }],
    ],
  };

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

  /*
   * التصعيد الدقيق: موظّفٌ **يملك** إدارة المجموعات ولا يملك الإعدادات،
   * يحاول أن يصنع لنفسه مجموعةً فيها الإعدادات. لو نجح لصار كلُّ من يدير
   * المجموعات مديرًا كاملًا بخطوة واحدة — وهي أخطر من ثغرة مسارٍ واحد.
   */
  ins.run('مدير مجموعات', 'gm', hashPassword('pass1234'), 'admin');
  const gmGroup = perms.createGroup(admin, { name: 'مجموعات فقط', perms: ['groups.manage'] });
  db.prepare('UPDATE agents SET group_id = ? WHERE username = ?').run(gmGroup.id, 'gm');
  await call('gm', 'POST', '/api/auth/login', { username: 'gm', password: 'pass1234' });

  const esc = await call('gm', 'POST', '/api/groups', { name: 'ترقية', perms: ['settings.manage'] });
  if (esc.status < 400) problems.push('تصعيد: مَن لا يملك الإعدادات منحها لمجموعة أنشأها');
  const escOk = await call('gm', 'POST', '/api/groups', { name: 'مجموعات أخرى', perms: ['groups.manage'] });
  if (escOk.status >= 400) problems.push(`مُنع منحُ صلاحية يملكها (${escOk.status}: ${escOk.data.error || ''})`);

  /* والإغلاق على الأهل: نزع مفتاح المدير الوحيد يجب أن يُرفض */
  const soloGroup = perms.createGroup(admin, { name: 'مفتاح وحيد', perms: ['accounts.manage', 'groups.manage'] });
  db.prepare('UPDATE agents SET group_id = ? WHERE username = ?').run(soloGroup.id, 'admin');
  db.prepare('UPDATE agents SET active = 0 WHERE username IN (?, ?)').run('gm', 'disp');
  const lock = await call('admin', 'PATCH', `/api/groups/${soloGroup.id}`, { perms: ['accounts.manage'] });
  if (lock.status < 400) problems.push('إغلاق: نُزع آخر مفتاح فلا يبقى من يدير الحسابات والمجموعات');
  db.prepare('UPDATE agents SET active = 1 WHERE username IN (?, ?)').run('gm', 'disp');
  db.prepare('UPDATE agents SET group_id = (SELECT id FROM groups WHERE key=?) WHERE username = ?').run('admin', 'admin');
  console.log('تصعيد الامتيازات والإغلاق على الأهل: فُحصا\n');

  for (const [method, urlPath, body] of LIMITED.allow) {
    const r = await call('disp', method, urlPath, body);
    if (r.status >= 400) problems.push(`${method} ${urlPath} — مُنع صاحبُ الصلاحية (${r.status}: ${r.data.error || ''})`);
  }
  for (const [method, urlPath, body] of LIMITED.deny) {
    const r = await call('disp', method, urlPath, body);
    if (r.status < 400) problems.push(`${method} ${urlPath} — نفّذها موظّف لا يملك صلاحيتها (${r.status})`);
    else if (r.status !== 403) problems.push(`${method} ${urlPath} — مُنع برمز ${r.status} لا 403`);
  }
  console.log(`محدود الصلاحية: ${LIMITED.allow.length} مسموحًا و${LIMITED.deny.length} ممنوعًا — فُحصت كلّها\n`);

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
    console.log(`✓ مصفوفة الصلاحيات سليمة على ${ROUTES.length} نقطة، وعلى ${LIMITED.allow.length + LIMITED.deny.length} فحصًا لمحدود الصلاحية`);
  }

  server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(problems.length ? 1 : 0);
})();
