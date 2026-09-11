'use strict';
/**
 * وكيل موصول على الصفحة الرئيسية.
 *
 * ما يستحقّ الاختبار ثلاثة:
 *   ١) أنه **لا يكتب** — لا ينشئ ولا يُسند ولا يغيّر حالة مهما كان السؤال،
 *   ٢) أن **الصلاحية تُحترم** — المندوب يسأل فيرى طلباته وحده،
 *   ٣) أنه **لا يخمّن** — ما لم يفهمه يقوله.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mawsool-agent-'));
process.env.MAWSOOL_DATA_DIR = TMP;
process.env.MAWSOOL_DB = path.join(TMP, 'agent.db');

const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { server } = require('../server/index');

let base;
let ids = {};
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

const ask = async (who, text) => (await call(who, 'POST', '/api/agent/ask', { text })).data;

test.before(async () => {
  db.exec('DELETE FROM events; DELETE FROM orders; DELETE FROM sessions; DELETE FROM agents;');
  const mk = (name, user, role) => db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                         availability, active, approval, created_at)
     VALUES (?,?,'',?,?,'sedan','حولي','available',1,'approved',datetime('now'))`
  ).run(name, user, hashPassword('pass1234'), role).lastInsertRowid;
  ids.admin = mk('سعود المدير', 'admin', 'admin');
  ids.badr = mk('بدر العنزي', 'badr', 'agent');
  ids.ahmad = mk('أحمد الكندري', 'ahmad', 'agent');
  db.prepare("UPDATE agents SET approval='under_test' WHERE id=?").run(ids.ahmad);

  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO orders (code, customer_name, customer_phone, pickup_address, dropoff_address,
                         governorate, pickup_area, status, delivery_fee, cod_amount, priority,
                         agent_id, created_at, updated_at, commission_amount, agent_earning, delivered_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  // MW-5001 لا كابتن له · MW-5002 لبدر · MW-5003 سُلّم لبدر · MW-5004 متعثّر لأحمد
  ins.run('MW-5001', 'منى الصباح', '+96599887766', 'السالمية، قطعة ٤', 'الفحيحيل', 'حولي', 'السالمية', 'new', 1.5, 12.5, 'normal', null, now, now, 0, 0, null);
  ins.run('MW-5002', 'خالد العتيبي', '+96566554433', 'حولي', 'مشرف', 'حولي', 'حولي', 'on_the_way', 2, 5, 'urgent', ids.badr, now, now, 0, 0, null);
  ins.run('MW-5003', 'نورة', '+96555443322', 'كيفان', 'قرطبة', 'العاصمة', 'كيفان', 'delivered', 2, 8, 'normal', ids.badr, now, now, 0.4, 1.6, now);
  ins.run('MW-5004', 'سالم', '+96599112233', 'بيان', 'سلوى', 'حولي', 'بيان', 'failed', 1.5, 0, 'normal', ids.ahmad, now, now, 0, 0, null);

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const u of ['admin', 'badr']) {
    await call(u, 'POST', '/api/auth/login', { username: u, password: 'pass1234' });
  }
});

test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

/* --------------------------- لا يكتب --------------------------- */

test('لا يكتب شيئًا مهما كان السؤال — ولا حتى أمرًا صريحًا', async () => {
  const before = {
    orders: db.prepare('SELECT COUNT(*) n FROM orders').get().n,
    events: db.prepare('SELECT COUNT(*) n FROM events').get().n,
    statuses: db.prepare('SELECT group_concat(status) s FROM orders ORDER BY id').get().s,
    agents: db.prepare('SELECT group_concat(approval) s FROM agents ORDER BY id').get().s,
  };

  for (const cmd of [
    'أنشئ طلبًا من السالمية إلى الفحيحيل للزبون منى ٩٩٨٨٧٧٦٦',
    'ألغِ طلب MW-5001',
    'اعتمد أحمد الكندري',
    'أسند MW-5001 لبدر',
    'غيّر حالة MW-5002 إلى تم التسليم',
    'احذف كل الطلبات',
  ]) {
    await ask('admin', cmd);
  }

  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, before.orders, 'أنشأ أو حذف طلبًا');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n, before.events, 'كتب في السجل');
  assert.equal(db.prepare('SELECT group_concat(status) s FROM orders ORDER BY id').get().s, before.statuses, 'غيّر حالة');
  assert.equal(db.prepare('SELECT group_concat(approval) s FROM agents ORDER BY id').get().s, before.agents, 'غيّر اعتمادًا');
});

test('الطلب الجديد يُحوَّل إلى النموذج ولا يُنشأ — والنصّ يُحمل معه', async () => {
  const r = await ask('admin', 'اسمي منى ورقمي ٩٩٨٨٧٧٦٦ من السالمية قطعة ٤ إلى الفحيحيل قطعة ٧');
  assert.equal(r.intent, 'new_order');
  assert.equal(r.kind, 'handoff');
  const act = r.actions.find((a) => a.href === '#/new');
  assert.ok(act, 'لا يوجد تحويل إلى النموذج');
  assert.ok(act.carry.includes('السالمية'), 'لم يحمل النصّ معه');
  assert.equal(r.data.parsed.fields.pickup_area, 'السالمية');
});

/* --------------------------- الصلاحية --------------------------- */

test('المندوب يسأل فيرى طلباته وحده', async () => {
  const mine = await ask('badr', 'الطلبات النشطة');
  assert.deepEqual(mine.data.orders.map((o) => o.code), ['MW-5002']);

  const other = await ask('badr', 'وين طلب MW-5001');
  assert.equal(other.kind, 'none', 'رأى طلبًا ليس له');
  assert.match(other.say, /بين طلباتك/);

  const search = await ask('badr', 'طلبات حولي');
  assert.ok(!search.data.orders.some((o) => o.code === 'MW-5001'), 'سرّب طلبًا ليس له في البحث');
});

test('النوايا الإدارية محجوبة عن المندوب', async () => {
  for (const q of ['مين متاح الآن', 'مين تحت التجربة', 'الطلبات بانتظار الإسناد']) {
    const r = await ask('badr', q);
    assert.equal(r.understood, false, `«${q}» أجابت المندوب`);
  }
  assert.equal((await ask('admin', 'مين متاح الآن')).intent, 'agents_available');
});

test('المندوب لا يُحوَّل إلى نموذج الطلب — ليس من عمله', async () => {
  const r = await ask('badr', 'من السالمية قطعة ٤ إلى الفحيحيل قطعة ٧');
  assert.notEqual(r.intent, 'new_order');
});

test('المسار يحتاج جلسة', async () => {
  assert.equal((await call(null, 'POST', '/api/agent/ask', { text: 'اليوم' })).status, 401);
});

/* --------------------------- الفهم --------------------------- */

test('يجيب عن اليوم بأرقام النظام نفسها', async () => {
  const r = await ask('admin', 'كم طلب سُلّم اليوم؟');
  assert.equal(r.intent, 'stats');
  const stats = (await call('admin', 'GET', '/api/stats')).data;
  const row = r.data.rows.find(([k]) => k === 'المُسلَّم اليوم');
  assert.ok(row, 'لا سطر للمُسلَّم');
  assert.match(row[1], new RegExp(stats.delivered_today === 1 ? 'واحد' : String(stats.delivered_today)));
});

test('يجد الطلب برمزه كاملًا وبرقمه وحده', async () => {
  for (const q of ['وين طلب MW-5002', 'طلب 5002', 'MW-5002']) {
    const r = await ask('admin', q);
    assert.equal(r.intent, 'find_order', `فشل على «${q}»`);
    assert.equal(r.data.orders[0].code, 'MW-5002');
  }
});

test('رمز غير موجود يُقال بوضوح ولا يُخترع له طلب', async () => {
  const r = await ask('admin', 'MW-9999');
  assert.equal(r.kind, 'none');
  assert.equal(r.data, undefined);
  assert.match(r.say, /لا طلب/);
});

test('يبحث بالمحافظة وبالمنطقة وبالحالة', async () => {
  assert.equal((await ask('admin', 'طلبات حولي')).data.orders.length, 3);
  assert.deepEqual((await ask('admin', 'طلبات كيفان')).data.orders.map((o) => o.code), ['MW-5003']);
  assert.deepEqual((await ask('admin', 'الطلبات بانتظار الإسناد')).data.orders.map((o) => o.code), ['MW-5001']);
});

test('يبحث باسم الزبون وبهاتفه', async () => {
  assert.equal((await ask('admin', 'منى')).data.orders[0].code, 'MW-5001');
  assert.equal((await ask('admin', '66554433')).data.orders[0].code, 'MW-5002');
});

test('العدد يوافق معدوده — «طلب واحد نشط» لا «طلب واحد نشطة»', async () => {
  /* لا تُستعمل \b هنا: حدود الكلمات في JS تُحسب على الحروف اللاتينية وحدها */
  const one = await ask('admin', 'الطلبات النشطة');
  assert.match(one.say, /طلب واحد نشط(\s|\.|$)/, one.say);
  assert.ok(!/واحد نشطة/.test(one.say), one.say);

  const caps = await ask('admin', 'مين متاح الآن');
  assert.match(caps.say, /كابتنان متاحان/, caps.say);
});

test('كل ما يقوله بلا رقم لاتيني — النظام عربيّ في عرضه', async () => {
  for (const q of ['كم طلب سُلّم اليوم؟', 'الطلبات النشطة', 'مين متاح الآن', 'MW-9999']) {
    const r = await ask('admin', q);
    const say = r.say.replace(/MW-/g, '');
    assert.ok(!/[0-9]/.test(say), `«${q}» فيه رقم لاتيني: ${r.say}`);
  }
});

/* --------------------------- لا يخمّن --------------------------- */

test('ما لا يفهمه يقوله ويعرض أمثلة، ولا يخترع جوابًا', async () => {
  for (const q of ['اطبخ لي عشاء', 'ما رأيك في الطقس', 'زززز']) {
    const r = await ask('admin', q);
    assert.equal(r.understood, false, `«${q}» أعطى جوابًا`);
    assert.ok(r.data.examples.length, 'لم يعرض أمثلة');
  }
});

test('السؤال الفارغ يُرفض في المسار', async () => {
  assert.equal((await call('admin', 'POST', '/api/agent/ask', { text: '   ' })).status, 400);
  assert.equal((await call('admin', 'POST', '/api/agent/ask', {})).status, 400);
});

test('يقول عن نفسه إنه يقرأ ولا ينفّذ حين لا يفهم أمرًا', async () => {
  const r = await ask('admin', 'سوّي لي شي غريب');
  assert.match(r.say, /لا أنفّذ/);
});

/* --------------------------- «هل تقصد…؟» --------------------------- */

test('يقترح الاسم القريب بدل أن يصمت — ولا يبحث به من تلقائه', async () => {
  /* المثال كان «السالمي» على أنّها خطأُ كتابةٍ لـ«السالمية»، وهي منطقةٌ
     قائمة بذاتها في الجهراء. فصار المثال خطأً حقيقيًّا لا اسمًا صحيحًا. */
  const r = await ask('admin', 'طلبات المنجف');
  assert.equal(r.intent, 'did_you_mean');
  assert.equal(r.understood, false, 'عدّ الاقتراح فهمًا');
  assert.match(r.say, /هل تقصد «المنقف»؟/);
  assert.equal(r.data.suggest, 'طلبات المنقف', 'الاقتراح ليس السؤال مصحّحًا');
  assert.equal(r.data.orders, undefined, 'بحث بالاقتراح بدل أن يعرضه');
});

test('الاقتراح المضغوط يعمل عمل السؤال الصحيح', async () => {
  const first = await ask('admin', 'طلبات الفحيحل');
  assert.equal(first.intent, 'did_you_mean');
  const then = await ask('admin', first.data.suggest);
  assert.equal(then.intent, 'search_orders');
  assert.ok(then.data.orders.length, 'الاقتراح المصحّح لم يجد شيئًا');
});

test('لا اقتراح لما ليس قريبًا — البعيد أسوأ من لا شيء', async () => {
  for (const q of ['اطبخ لي عشاء', 'زززز', 'ما رأيك في الطقس']) {
    const r = await ask('admin', q);
    assert.equal(r.intent, 'unknown', `«${q}» أُعطي اقتراحًا`);
    assert.equal(r.data.suggest, undefined);
  }
});

test('البحث الفارغ يقول أين يُبحث بعده', async () => {
  const r = await ask('admin', 'طلبات الجهراء');
  assert.equal(r.intent, 'search_orders');
  assert.equal(r.data.orders.length, 0);
  assert.equal(r.data.suggest, 'الطلبات النشطة', 'صفرٌ بلا خطوة تالية');
});

test('البحث الذي يجد لا يُثقَل باقتراح', async () => {
  const r = await ask('admin', 'طلبات حولي');
  assert.ok(r.data.orders.length);
  assert.equal(r.data.suggest, undefined);
});

/* --------------------------- الفترات --------------------------- */

test('يجيب على الفترة المذكورة لا على اليوم دائمًا', async () => {
  for (const [q, want] of [['كم سلّمنا اليوم', 'today'], ['كم سلّمنا أمس', 'yesterday'],
                           ['كم سلّمنا هذا الأسبوع', 'week'], ['اسبوعيا', 'week'],
                           ['كم هذا الشهر', 'month']]) {
    const r = await ask('admin', q);
    assert.equal(r.data.period, want, `«${q}» أعطت ${r.data.period}`);
  }
});

test('بلا ذكر فترة يُفهم اليوم — أضيق الاحتمالات لا أوسعها', async () => {
  assert.equal((await ask('admin', 'الإحصاءات')).data.period, 'today');
});

test('الأسبوع يبدأ الأحد كأسبوع العمل في الكويت', () => {
  const PER = require('../server/periods');
  for (const d of ['2026-08-16', '2026-08-20', '2026-08-22']) {   // أحد · خميس · سبت
    const r = PER.readPeriod(['الاسبوع'], new Date(d + 'T10:00:00'));
    assert.equal(r.from.getDay(), 0, `${d}: الأسبوع لا يبدأ الأحد`);
  }
});

/* ------------------------ أداء الكابتن ------------------------ */

test('أداء الكابتن يُجاب للمدير، ويُسجَّل الاطّلاع كما يُسجَّل الموقع', async () => {
  const before = db.prepare("SELECT COUNT(*) n FROM agent_events WHERE type='performance_view'").get().n;
  const r = await ask('admin', 'كم سلّم بدر هذا الأسبوع');
  assert.equal(r.intent, 'stats');
  assert.match(r.say, /بدر العنزي/);
  assert.equal(r.data.audited, true, 'لم يُعلَّم الجواب بأنه مُسجَّل');

  const rows = db.prepare(
    "SELECT * FROM agent_events WHERE type='performance_view' ORDER BY id DESC"
  ).all();
  assert.equal(rows.length, before + 1, 'لم يُسجَّل الاطّلاع');
  assert.equal(rows[0].agent_id, ids.badr, 'سُجِّل على غير صاحبه');
  assert.equal(rows[0].actor_id, ids.admin, 'لم يُسمَّ المطّلِع');
  assert.equal(rows[0].to_value, 'week', 'لم تُسجَّل الفترة');
  assert.match(rows[0].note, /سعود المدير/);
});

test('المندوب لا يرى أداء زميله ولا يُسجَّل له اطّلاع', async () => {
  const before = db.prepare("SELECT COUNT(*) n FROM agent_events WHERE type='performance_view'").get().n;
  const r = await ask('badr', 'كم سلّم أحمد الكندري');
  assert.ok(!/أحمد الكندري —/.test(r.say), `سرّب أداء زميله: ${r.say}`);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_events WHERE type='performance_view'").get().n,
    before, 'سجّل اطّلاعًا لمن لا يُجاب');
});

/* ------------------------ السياسات ------------------------ */

test('يجيب عن السياسات، ويقول من أين أخذ', async () => {
  const c = await ask('admin', 'كم العمولة');
  assert.equal(c.intent, 'policy');
  assert.match(c.say, /٪|د\.ك/, 'لم يُذكر المضبوط الآن');
  assert.equal(c.data.policy.source, 'الإعدادات وملفّ السياسات');
});

test('ما ليس مفروضًا في النظام يُقال إنه ليس مفروضًا', async () => {
  for (const [q, id] of [['شنو شروط الكابتن', 'captain_car'], ['المقابلة', 'interview'], ['دورة الصرف', 'payout']]) {
    const r = await ask('admin', q);
    assert.equal(r.data.policy.id, id, `«${q}» أعطت ${r.data.policy.id}`);
    assert.equal(r.data.policy.enforced, false, `«${q}» ادّعت أن النظام يفرضها`);
    assert.ok(r.data.policy.why_not, `«${q}» بلا سبب لعدم الفرض`);
  }
});

test('العمولة الحيّة تُقرأ ولا تُنسخ — تتغيّر بتغيّر الإعدادات', async () => {
  const S = require('../server/settings');
  const before = (await ask('admin', 'كم العمولة')).say;
  S.setCommission({ type: 'fixed', rate: 0.75 }, { id: ids.admin, name: 'سعود المدير' }, 'اختبار');
  const after = (await ask('admin', 'كم العمولة')).say;
  assert.notEqual(before, after, 'الجواب لم يتبع الإعدادات');
  assert.match(after, /٠٫٧٥٠/);
});

test('«كم عمولة هذا الأسبوع» رقمٌ لفترة لا قاعدةٌ ثابتة', async () => {
  const r = await ask('admin', 'كم عمولة هذا الأسبوع');
  assert.equal(r.intent, 'stats', 'خطفتها السياسة');
  assert.equal(r.data.period, 'week');
});
