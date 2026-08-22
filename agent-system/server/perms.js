'use strict';
/**
 * الصلاحيات والمجموعات.
 *
 * كان في النظام دورَان: مدير عمليات يملك **كل شيء**، ومندوب لا يملك شيئًا.
 * فمن أراد موظّف إسناد يوزّع الطلبات ولا يمسّ العمولة ولا يفتح الحسابات لم
 * يجد إلّا أن يجعله مديرًا كاملًا — ومعه مفتاح كل شيء.
 *
 * المبادئ:
 *  1. **الصلاحية تُمنح، لا تُفترض.** المجموعة الجديدة تبدأ فارغة.
 *  2. **لا يمنح أحدٌ ما لا يملك.** من يحرّر مجموعة لا يضع فيها صلاحية ليست
 *     عنده — وإلّا ترقّى كلُّ من يدير المجموعات إلى مدير كامل بخطوة واحدة.
 *  3. **لا يُغلق الباب على أهله.** لا بدّ أن يبقى حسابٌ فعّال واحد على الأقل
 *     يملك إدارة الحسابات وإدارة المجموعات معًا، وإلّا خرج المالك من نظامه
 *     ولا سبيل للرجوع إلّا من قاعدة البيانات.
 *  4. **الكابتن كابتن.** مجموعته مدمجة بلا صلاحيات إدارية، فلا تتغيّر قواعد
 *     التوصيل والاعتماد والموقع بتحرير مجموعة.
 */
const { db, now } = require('./db');
const { badRequest, forbidden, notFound } = require('./lib/http');

/*
 * القائمة مشتقّة من الحُرّاس القائمة فعلًا في الشيفرة، لا من تصوّرٍ لما قد
 * يُحتاج. كل صلاحية هنا كانت فحصَ `role === 'admin'` في مكان بعينه.
 */
const PERMISSIONS = {
  'accounts.manage':  { label: 'إدارة الحسابات', hint: 'إنشاء الحسابات وتعديلها وقرارات الاعتماد' },
  'orders.create':    { label: 'إنشاء الطلبات', hint: 'الطلب الجديد، والطلب المنطوق، ودبّوس الاستلام' },
  'orders.assign':    { label: 'إسناد الطلبات', hint: 'الإسناد المباشر واقتراح أقرب كابتن' },
  'orders.view_all':  { label: 'رؤية كل الطلبات', hint: 'الطلبات والإحصاءات والتحويلات عبر كل الكباتن' },
  'links.manage':     { label: 'روابط المهام', hint: 'إنشاء رابط المهمّة وإلغاؤه' },
  'locations.view':   { label: 'مواقع الكباتن', hint: 'اللوحة المباشرة ومسار الكابتن' },
  'settings.manage':  { label: 'الإعدادات والعمولة', hint: 'نسبة الوساطة وخطّافات التكامل' },
  'mail.view':        { label: 'صندوق البريد', hint: 'الرسائل الصادرة وإعادة الإرسال' },
  'groups.manage':    { label: 'إدارة المجموعات', hint: 'إنشاء مجموعات الصلاحيات وتعديلها' },
};
const ALL = Object.keys(PERMISSIONS);

/** الصلاحيتان اللتان لا يجوز أن تخلو المنظومة ممّن يملكهما معًا */
const KEYSTONE = ['accounts.manage', 'groups.manage'];

const BUILTIN = {
  admin: { name: 'مدير عمليات', perms: ALL },
  agent: { name: 'كابتن', perms: [] },
};

/* ---------------------------- التهيئة ---------------------------- */

/**
 * تُنشئ المجموعتين المدمجتين وتُلحق بهما الحسابات القائمة بحسب دورها.
 * تُستدعى عند الإقلاع، وهي غير ضارّة إن تكرّرت.
 */
function ensureGroups() {
  const upsert = db.prepare(
    `INSERT INTO groups (key, name, builtin, perms, created_at) VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(key) DO UPDATE SET name = excluded.name, perms = excluded.perms, builtin = 1`
  );
  for (const [key, g] of Object.entries(BUILTIN)) upsert.run(key, g.name, g.perms.join(','), now());

  /* الحسابات التي سبقت المجموعات تُلحق بمجموعة دورها — فلا يتغيّر لأحد شيء */
  db.exec(`
    UPDATE agents SET group_id = (SELECT id FROM groups WHERE key = agents.role)
     WHERE group_id IS NULL
  `);
}

/* ---------------------------- القراءة ---------------------------- */

const parsePerms = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

function groupOf(agent) {
  if (!agent) return null;
  const row = agent.group_id
    ? db.prepare('SELECT * FROM groups WHERE id = ?').get(agent.group_id)
    : db.prepare('SELECT * FROM groups WHERE key = ?').get(agent.role);
  if (!row) return null;
  return { ...row, builtin: !!row.builtin, perms: parsePerms(row.perms) };
}

/** هل يملك هذا الحساب هذه الصلاحية؟ */
function can(agent, perm) {
  const g = groupOf(agent);
  return !!g && g.perms.includes(perm);
}

/** يرمي `forbidden` برسالة تذكر الصلاحية الناقصة بالاسم لا بالرمز */
function require_(agent, perm, what) {
  if (can(agent, perm)) return;
  const label = PERMISSIONS[perm] ? PERMISSIONS[perm].label : perm;
  throw forbidden(`${what || 'هذا الإجراء'} يحتاج صلاحية «${label}»`);
}

function listGroups() {
  return db.prepare('SELECT * FROM groups ORDER BY builtin DESC, id ASC').all().map((g) => ({
    id: g.id, key: g.key, name: g.name, builtin: !!g.builtin, perms: parsePerms(g.perms),
    members: db.prepare('SELECT COUNT(*) AS n FROM agents WHERE group_id = ?').get(g.id).n,
  }));
}

/* ---------------------------- الكتابة ---------------------------- */

function readPerms(raw) {
  if (!Array.isArray(raw)) throw badRequest('الصلاحيات قائمة');
  const out = [];
  for (const p of raw) {
    const key = String(p).trim();
    if (!PERMISSIONS[key]) throw badRequest(`صلاحية غير معروفة: ${key}`);
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** لا يمنح أحدٌ ما لا يملك — وإلّا صار كلُّ من يدير المجموعات مديرًا كاملًا */
function checkGrantable(actor, perms) {
  const missing = perms.filter((p) => !can(actor, p));
  if (missing.length) {
    const names = missing.map((p) => `«${PERMISSIONS[p].label}»`).join(' و');
    throw forbidden(`لا تملك ${names}، فلا تمنحها لغيرك`);
  }
}

/**
 * عدد الحسابات الفعّالة التي تملك صلاحيات المفتاح كلّها، مع استثناء اختياري.
 *
 * تمرّ على `groupOf` عمدًا ولا تقرأ الجدول بنفسها: كانت تصله `LEFT JOIN`
 * مباشرةً، فمن لا `group_id` له — وهو كلُّ حسابٍ أُنشئ قبل الترقية أو من
 * خارج مسار الإنشاء — يُحسب بلا صلاحية، فيُظنّ أن لا أحد يملك المفتاح
 * ويُرفض **كل** إسناد. تعريفان لصلاحيات الحساب لا يستقيمان: واحدٌ يكفي.
 */
function keystoneHolders({ exceptAgentId = null, exceptGroupId = null, replacementPerms = null } = {}) {
  const rows = db.prepare(
    `SELECT id, role, group_id FROM agents
      WHERE active = 1 AND approval IN ('approved', 'under_test')`
  ).all();
  let n = 0;
  for (const r of rows) {
    if (exceptAgentId != null && r.id === exceptAgentId) continue;
    const g = groupOf(r);
    const perms = (exceptGroupId != null && g && g.id === exceptGroupId && replacementPerms)
      ? replacementPerms : (g ? g.perms : []);
    if (KEYSTONE.every((k) => perms.includes(k))) n++;
  }
  return n;
}

function assertNotLockout(opts) {
  if (keystoneHolders(opts) > 0) return;
  throw badRequest(
    'لا يمكن إتمام هذا: لن يبقى حسابٌ فعّال يملك «إدارة الحسابات» و«إدارة المجموعات» معًا، '
    + 'فيُغلق النظام على أهله ولا رجوع إلّا من قاعدة البيانات'
  );
}

function createGroup(actor, { name, perms }) {
  require_(actor, 'groups.manage', 'إنشاء مجموعة');
  const label = String(name || '').trim();
  if (label.length < 2) throw badRequest('اسم المجموعة قصير');
  if (db.prepare('SELECT 1 FROM groups WHERE name = ?').get(label)) {
    throw badRequest('توجد مجموعة بهذا الاسم');
  }
  const list = readPerms(perms || []);
  checkGrantable(actor, list);
  /* المفتاح من رقم الصفّ لا من الوقت: `Date.now()` يتكرّر لمجموعتين تُنشآن
     في الملّي نفسها — ضغطةٌ مزدوجة على «إنشاء» تكفي — فيسقط الإدراج على
     قيد التفرّد برسالةٍ من قاعدة البيانات لا من النظام. */
  const info = db.prepare(
    'INSERT INTO groups (key, name, builtin, perms, created_at) VALUES (?, ?, 0, ?, ?)'
  ).run('g_pending_' + label, label, list.join(','), now());
  db.prepare('UPDATE groups SET key = ? WHERE id = ?').run('g' + info.lastInsertRowid, info.lastInsertRowid);
  return listGroups().find((g) => g.id === info.lastInsertRowid);
}

function updateGroup(actor, id, { name, perms }) {
  require_(actor, 'groups.manage', 'تعديل مجموعة');
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!g) throw notFound('المجموعة غير موجودة');
  /* المدمجتان تحفظان السلوك الأصلي: لو عُدّلت «كابتن» تغيّرت قواعد التوصيل
     كلّها من شاشة صلاحيات، ولو نُزعت صلاحية من «مدير عمليات» فقد المالك بابه. */
  if (g.builtin) throw badRequest('المجموعتان المدمجتان لا تُعدَّلان — أنشئ مجموعة جديدة');

  const list = perms === undefined ? parsePerms(g.perms) : readPerms(perms);
  checkGrantable(actor, list);
  assertNotLockout({ exceptGroupId: g.id, replacementPerms: list });

  const label = name === undefined ? g.name : String(name).trim();
  if (label.length < 2) throw badRequest('اسم المجموعة قصير');
  if (db.prepare('SELECT 1 FROM groups WHERE name = ? AND id <> ?').get(label, id)) {
    throw badRequest('توجد مجموعة بهذا الاسم');
  }
  db.prepare('UPDATE groups SET name = ?, perms = ? WHERE id = ?').run(label, list.join(','), id);
  return listGroups().find((x) => x.id === id);
}

function deleteGroup(actor, id) {
  require_(actor, 'groups.manage', 'حذف مجموعة');
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  if (!g) throw notFound('المجموعة غير موجودة');
  if (g.builtin) throw badRequest('المجموعتان المدمجتان لا تُحذفان');
  const members = db.prepare('SELECT COUNT(*) AS n FROM agents WHERE group_id = ?').get(id).n;
  /* الحذف لا ينقل أحدًا صامتًا إلى مجموعة أخرى: النقل قرارٌ يُتّخذ لا أثرٌ جانبيّ */
  if (members > 0) throw badRequest(`في المجموعة ${members} حسابًا — انقلهم أولًا`);
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  return { deleted: true };
}

/** إسناد حساب إلى مجموعة — يُستدعى من مسار تعديل الحساب */
function assignGroup(actor, agent, groupId) {
  require_(actor, 'accounts.manage', 'تغيير مجموعة حساب');
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
  if (!g) throw notFound('المجموعة غير موجودة');
  /* الكابتن في مجموعة إدارية يخرج عن قواعد الاعتماد والتوفّر والموقع، وهي
     مبنيّة على دوره لا على صلاحياته. الفصل بين الأمرين مقصود. */
  if (agent.role === 'agent' && g.key !== 'agent') {
    throw badRequest('حساب الكابتن يبقى في مجموعة «كابتن» — المجموعات الإدارية لموظّفي المكتب');
  }
  if (agent.role === 'admin' && g.key === 'agent') {
    throw badRequest('حساب المكتب لا يوضع في مجموعة «كابتن»');
  }
  checkGrantable(actor, parsePerms(g.perms));
  assertNotLockout({ exceptAgentId: agent.id });
  db.prepare('UPDATE agents SET group_id = ? WHERE id = ?').run(g.id, agent.id);
  return groupOf({ ...agent, group_id: g.id });
}

module.exports = {
  PERMISSIONS, ALL, KEYSTONE, BUILTIN,
  ensureGroups, groupOf, can, require: require_, listGroups,
  createGroup, updateGroup, deleteGroup, assignGroup,
  keystoneHolders, assertNotLockout,
};
