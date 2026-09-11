'use strict';
/**
 * مجموعات الصلاحيات.
 *
 * كان في النظام دورَان: مديرٌ يملك **كل شيء** ومندوبٌ لا يملك شيئًا. فمن
 * أراد موظّف إسناد لا يمسّ العمولة ولا الحسابات لم يجد إلّا أن يجعله مديرًا
 * كاملًا — ومعه مفتاح كل شيء.
 *
 * الفحص هنا على القواعد التي تحرس المنظومة من نفسها: لا يمنح أحدٌ ما لا
 * يملك، ولا يُغلق الباب على أهله، ولا تُعدَّل المجموعتان المدمجتان.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-perms-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'perms.db');

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const P = require('../server/perms');

const mk = (name, username, role) => db.prepare(
  `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                       availability, active, approval, created_at)
   VALUES (?, ?, '', ?, ?, 'sedan', 'حولي', 'available', 1, 'approved', datetime('now'))`
).run(name, username, hashPassword('pass1234'), role).lastInsertRowid;

const get = (id) => db.prepare('SELECT * FROM agents WHERE id = ?').get(id);

let ownerId; let staffId; let capId;

test.before(() => {
  db.exec('DELETE FROM agents; DELETE FROM groups;');
  P.ensureGroups();
  ownerId = mk('المالك', 'owner', 'admin');
  staffId = mk('موظّف', 'staff', 'admin');
  capId = mk('كابتن', 'cap', 'agent');
  P.ensureGroups();   // تُلحق الحسابات الجديدة بمجموعات أدوارها
});

/* ---------------------------- الافتراضات ---------------------------- */

test('المجموعتان المدمجتان تحفظان السلوك الأصلي', () => {
  const groups = P.listGroups();
  const admin = groups.find((g) => g.key === 'admin');
  const agent = groups.find((g) => g.key === 'agent');
  assert.ok(admin.builtin && agent.builtin);
  assert.deepEqual(admin.perms.slice().sort(), P.ALL.slice().sort(), 'المدير فقد صلاحية');
  assert.deepEqual(agent.perms, [], 'الكابتن مُنح صلاحية إدارية');
});

test('حسابٌ بلا مجموعة يقع على مجموعة دوره — لا بلا صلاحيات', () => {
  /* كلُّ حساب أُنشئ قبل الترقية أو من خارج مسار الإنشاء لا `group_id` له.
     لو حُسب بلا صلاحيات لخرج المالك من نظامه لحظة الترقية. */
  db.prepare('UPDATE agents SET group_id = NULL WHERE id = ?').run(ownerId);
  assert.equal(P.can(get(ownerId), 'settings.manage'), true);
  assert.ok(P.keystoneHolders() >= 1, 'لا يُرى أحدٌ يملك المفتاح، فيُرفض كل إسناد');
  P.ensureGroups();
});

/* ------------------------- لا يمنح أحدٌ ما لا يملك ------------------------- */

test('من لا يملك صلاحية لا يضعها في مجموعة يُنشئها', () => {
  const owner = get(ownerId);
  const gm = P.createGroup(owner, { name: 'مجموعات فقط', perms: ['groups.manage'] });
  db.prepare('UPDATE agents SET group_id = ? WHERE id = ?').run(gm.id, staffId);

  /* لولا هذا لصار كلُّ من يدير المجموعات مديرًا كاملًا بخطوة واحدة */
  assert.throws(
    () => P.createGroup(get(staffId), { name: 'ترقية', perms: ['settings.manage'] }),
    /لا تملك/,
  );
  // وما يملكه يمنحه
  const ok = P.createGroup(get(staffId), { name: 'مجموعات أخرى', perms: ['groups.manage'] });
  assert.deepEqual(ok.perms, ['groups.manage']);
});

test('ولا يضعها بتعديل مجموعة قائمة — الباب نفسه من جهة أخرى', () => {
  const owner = get(ownerId);
  const g = P.createGroup(owner, { name: 'قابلة للتعديل', perms: [] });
  assert.throws(
    () => P.updateGroup(get(staffId), g.id, { perms: ['accounts.manage'] }),
    /لا تملك/,
  );
});

/* --------------------- لا يُغلق الباب على أهله --------------------- */

test('لا يبقى النظام بلا من يملك الحسابات والمجموعات معًا', () => {
  const owner = get(ownerId);
  const solo = P.createGroup(owner, { name: 'مفتاح', perms: P.KEYSTONE.slice() });
  /* تُنشأ **قبل** نقل المالك: بعد النقل لا يملك «رؤية كل الطلبات» فلا
     يمنحها — وهي القاعدة تعمل، لا عطبٌ في الاختبار. */
  /* صلاحياتها من صلاحيات المالك بعد نقله، وإلّا سبق فحصُ «لا تمنح ما لا
     تملك» فحصَ الإغلاق فاختبرنا القاعدة الأخرى بلا قصد. */
  const plain = P.createGroup(owner, { name: 'بلا مفتاح', perms: ['accounts.manage'] });
  db.prepare('UPDATE agents SET group_id = ? WHERE id = ?').run(solo.id, ownerId);
  // نُعطّل من سواه ممّن يملك المفتاح
  db.prepare("UPDATE agents SET active = 0 WHERE id <> ? AND role = 'admin'").run(ownerId);

  assert.equal(P.keystoneHolders(), 1);
  assert.throws(
    () => P.updateGroup(get(ownerId), solo.id, { perms: ['accounts.manage'] }),
    /يُغلق النظام على أهله/,
  );
  // ونقلُ صاحب المفتاح الوحيد إلى مجموعة بلا مفتاح مرفوض كذلك
  assert.throws(() => P.assignGroup(get(ownerId), get(ownerId), plain.id), /يُغلق النظام/);

  db.prepare("UPDATE agents SET active = 1 WHERE role = 'admin'").run();
  P.ensureGroups();
  db.prepare('UPDATE agents SET group_id = (SELECT id FROM groups WHERE key=?) WHERE id = ?')
    .run('admin', ownerId);
});

/* --------------------------- المدمجتان --------------------------- */

test('المدمجتان لا تُعدَّلان ولا تُحذفان', () => {
  const owner = get(ownerId);
  const builtin = P.listGroups().filter((g) => g.builtin);
  for (const g of builtin) {
    assert.throws(() => P.updateGroup(owner, g.id, { perms: [] }), /لا تُعدَّل/);
    assert.throws(() => P.deleteGroup(owner, g.id), /لا تُحذف/);
  }
});

test('المجموعة ذات الأعضاء لا تُحذف صامتةً', () => {
  const owner = get(ownerId);
  const g = P.createGroup(owner, { name: 'فيها أحد', perms: [] });
  db.prepare('UPDATE agents SET group_id = ? WHERE id = ?').run(g.id, staffId);
  /* الحذف لا ينقل أحدًا صامتًا إلى مجموعة أخرى: النقل قرارٌ لا أثرٌ جانبيّ */
  assert.throws(() => P.deleteGroup(owner, g.id), /انقلهم أولًا/);
  db.prepare('UPDATE agents SET group_id = (SELECT id FROM groups WHERE key=?) WHERE id = ?')
    .run('admin', staffId);
  assert.deepEqual(P.deleteGroup(owner, g.id), { deleted: true });
});

/* ---------------------------- الكابتن ---------------------------- */

test('الكابتن يبقى في مجموعته — قواعد التوصيل مبنيّة على دوره', () => {
  const owner = get(ownerId);
  const g = P.createGroup(owner, { name: 'إدارية', perms: ['orders.view_all'] });
  assert.throws(() => P.assignGroup(owner, get(capId), g.id), /حساب الكابتن يبقى/);
  const capGroup = P.listGroups().find((x) => x.key === 'agent');
  assert.throws(() => P.assignGroup(owner, get(staffId), capGroup.id), /لا يوضع في مجموعة/);
  P.deleteGroup(owner, g.id);
});

test('صلاحية غير معروفة تُرفض بالاسم', () => {
  assert.throws(() => P.createGroup(get(ownerId), { name: 'خطأ', perms: ['orders.delete_everything'] }),
    /صلاحية غير معروفة/);
});

test('كل صلاحية في القائمة لها اسم وشرح بالعربية', () => {
  for (const [key, p] of Object.entries(P.PERMISSIONS)) {
    assert.ok(p.label && /[؀-ۿ]/.test(p.label), `${key} بلا اسم عربي`);
    assert.ok(p.hint && /[؀-ۿ]/.test(p.hint), `${key} بلا شرح`);
  }
});

/* ــــــــــ حارسٌ بنيويّ على كل مسار ــــــــــ
 *
 * مصفوفة الصلاحيات في `authz.probe.js` تطرق ٤٢ نقطة، والمسجَّل ٦٦. فمن
 * أضاف مسارًا ونسي حراسته لم يكن ليعلم: لا اختبار يسأل عنه، والمِسبار
 * قائمةٌ مكتوبةٌ باليد لا تنمو مع الشيفرة.
 *
 * وهذا يقرأ `api.js` نصًّا ويسأل كل مسارٍ سؤالًا واحدًا: **من يحرسك؟**
 * والجواب المقبول ثلاثة لا رابع لها:
 *   · معلَنٌ عامًّا بـ`auth:false` — وعندئذ يجب أن يكون في القائمة أدناه
 *     نصًّا، فلا يصير مسارٌ عامًّا بالسهو
 *   · يفحص صلاحيةً في المسار بـ`need(ctx, …)`
 *   · يمرّر `ctx.agent` إلى طبقة المجال، وهناك يقع الفحص
 *
 * لا يقيس هذا صحّة الحراسة — تلك عند المِسبار والاختبارات — بل **وجودها**.
 */
test('كل مسار محروس: بـneed() أو بتمرير الفاعل، أو معلَنٌ عامًّا بالاسم', () => {
  /* العامّة عمدًا. الرابط والبوّابة يستوثقان برمزٍ لا بجلسة، والدخول
     والبيانات الوصفية قبل أي جلسة. من أراد زيادة هذه القائمة كتبها هنا. */
  const PUBLIC = new Set([
    'POST /api/auth/login',
    'GET /api/meta',
    'GET /api/link/:token',
    'POST /api/link/:token/consent',
    'PATCH /api/link/:token/sharing',
    'POST /api/link/:token/location',
    'POST /api/link/:token/voice',
    'POST /api/link/:token/outcome',
    'POST /api/public/order/parse',
    'POST /api/public/order',
  ]);

  const src = fs.readFileSync(require.resolve('../server/api.js'), 'utf8').split('\n');
  const starts = src.reduce((a, l, i) => (/^\s*on\('(GET|POST|PATCH|PUT|DELETE)'/.test(l) ? (a.push(i), a) : a), []);
  assert.ok(starts.length > 50, `لم تُقرأ المسارات — وُجد ${starts.length} فقط`);

  const naked = [];
  const undeclared = [];
  for (let k = 0; k < starts.length; k++) {
    const body = src.slice(starts[k], starts[k + 1] ?? src.length).join('\n');
    const m = src[starts[k]].match(/on\('(\w+)',\s*[`']([^`']+)/);
    if (!m) continue;
    const route = `${m[1]} ${m[2]}`;
    if (/auth:\s*false/.test(body)) {
      if (!PUBLIC.has(route)) undeclared.push(route);
      continue;
    }
    if (!/need\(ctx/.test(body) && !/ctx\.agent/.test(body)) naked.push(route);
  }

  assert.deepEqual(naked, [], `مسارات بلا حارس: ${naked.join('، ')}`);
  assert.deepEqual(undeclared, [],
    `مسارات صارت عامّة ولم تُذكر في قائمة العامّة: ${undeclared.join('، ')}`);
});

test.after(() => { db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
