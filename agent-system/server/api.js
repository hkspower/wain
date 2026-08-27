'use strict';
/** واجهة برمجة التطبيق — كل المسارات تحت /api */
const { db, now, nextOrderCode, logEvent, logAgentEvent } = require('./db');
const auth = require('./auth');
const D = require('./domain');
const L = require('./location');
const S = require('./settings');
const LK = require('./links');
const M = require('./mailer');
const HK = require('./hooks');
const N = require('./nearest');
const V = require('./voice-order');
const AG = require('./agent');
const AREA = require('./areas');
const P = require('./perms');
const FAQ = require('./faq');
const {
  badRequest, unauthorized, forbidden, notFound, conflict,
  str, num, oneOf, id, phone: tel,
} = require('./lib/http');

/* ------------------------------- مساعدات ------------------------------- */

const publicAgent = (a) => ({
  id: a.id, name: a.name, username: a.username, phone: a.phone, role: a.role,
  vehicle: a.vehicle, governorate: a.governorate, availability: a.availability,
  active: !!a.active, created_at: a.created_at,
  group_id: a.group_id || null,
  approval: a.approval, approval_note: a.approval_note || '',
  approval_at: a.approval_at || null,
  location_consent: !!a.location_consent, location_sharing: !!a.location_sharing,
});

/*
 * كان حارسًا واحدًا لكل شيء: «مديرٌ أو لا». صار كل مسار يطلب صلاحيته
 * باسمها، فيمكن أن يكون في المكتب موظّف إسناد لا يمسّ العمولة ولا الحسابات.
 * والاسم في الرسالة صلاحيةٌ لا رتبة، فيعرف الموظّف ما ينقصه بالضبط.
 */
const need = (ctx, perm, what) => P.require(ctx.agent, perm, what);

/** الرابط كما يُعرض للمدير — مع العنوان الكامل الجاهز للإرسال على واتساب */
function publicLink(link, ctx) {
  const host = ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || 'localhost';
  const proto = ctx.req.headers['x-forwarded-proto']
    || (process.env.MAWSOOL_SECURE_COOKIE === '1' ? 'https' : 'http');
  return {
    id: link.id,
    url: `${proto}://${host}/l/${link.token}`,
    agent_name: link.agent_name,
    created_at: link.created_at,
    expires_at: link.expires_at,
    opened_at: link.opened_at,
    revoked_at: link.revoked_at,
    active: !link.revoked_at && new Date(link.expires_at).getTime() > Date.now(),
  };
}

function orderWithExtras(order) {
  const events = db.prepare(
    `SELECT e.*, a.name AS actor_name
       FROM events e LEFT JOIN agents a ON a.id = e.actor_id
      WHERE e.order_id = ? ORDER BY e.id ASC`
  ).all(order.id);
  const transfers = db.prepare(
    `SELECT t.*, f.name AS from_name, tt.name AS to_name
       FROM transfers t
       JOIN agents f  ON f.id  = t.from_agent_id
       JOIN agents tt ON tt.id = t.to_agent_id
      WHERE t.order_id = ? ORDER BY t.id DESC`
  ).all(order.id);
  const voiceNotes = db.prepare(
    'SELECT id, seconds, bytes, created_at FROM voice_notes WHERE order_id=? ORDER BY id DESC'
  ).all(order.id);
  return {
    ...order, events, transfers, voice_notes: voiceNotes,
    pending_transfer: transfers.find((t) => t.status === 'pending') || null,
  };
}

/* -------------------------------- المسارات ------------------------------- */

const routes = [];
const on = (method, pattern, handler, opts = {}) =>
  routes.push({ method, pattern, handler, auth: opts.auth !== false, raw: opts.raw || 0 });

/* ---- المصادقة ---- */

on('POST', '/api/auth/login', async (ctx) => {
  const username = str(ctx.body.username, 'اسم المستخدم', { max: 60 }).toLowerCase();
  const password = str(ctx.body.password, 'كلمة المرور', { max: 200 });

  if (!auth.loginAllowed(ctx.ip, username)) {
    throw new (require('./lib/http').HttpError)(429, 'محاولات كثيرة، حاول بعد قليل');
  }

  const agent = db.prepare('SELECT * FROM agents WHERE lower(username) = ?').get(username);
  if (!agent || !auth.verifyPassword(password, agent.password_hash)) {
    auth.recordFailure(ctx.ip, username);
    throw unauthorized('اسم المستخدم أو كلمة المرور غير صحيحة');
  }

  // سبب المنع يُكشف بعد التحقق من كلمة المرور فقط: صاحب الحساب يستحق معرفة
  // لماذا مُنع، ومن يخمّن كلمة مرور لا يعرف حتى إن كان الحساب موجودًا.
  if (!D.WORKING_APPROVALS.includes(agent.approval)) {
    auth.recordFailure(ctx.ip, username);
    throw new (require('./lib/http').HttpError)(
      403,
      D.APPROVAL_BLOCK_REASON[agent.approval] || 'حسابك غير مفعّل. راجع إدارة العمليات.',
      'approval_' + agent.approval
    );
  }
  if (!agent.active) throw unauthorized('حسابك غير مفعّل. راجع إدارة العمليات.');

  auth.clearFailures(ctx.ip, username);
  const session = auth.createSession(agent.id);
  db.prepare("UPDATE agents SET availability = 'available' WHERE id = ? AND role = 'agent'").run(agent.id);

  ctx.setCookie('mw_session', session.token, { maxAge: auth.SESSION_DAYS * 86400 });
  return { agent: publicAgent(db.prepare('SELECT * FROM agents WHERE id=?').get(agent.id)) };
}, { auth: false });

on('POST', '/api/auth/logout', async (ctx) => {
  if (ctx.agent?.role === 'agent') {
    db.prepare("UPDATE agents SET availability='offline' WHERE id=?").run(ctx.agent.id);
  }
  auth.destroySession(ctx.token);
  ctx.setCookie('mw_session', '', { maxAge: 0 });
  return { ok: true };
});

on('GET', '/api/auth/me', async (ctx) => ({ agent: publicAgent(ctx.agent) }));

/* ---- بيانات ثابتة يشاركها الخادم والواجهة ---- */

/* الواجهة لا تُخمّن ما يملكه المستخدم: تسأل. وهذا للعرض لا للحراسة —
   الحراسة في الخادم عند كل مسار، وإخفاء زرٍّ ليس منعًا. */
on('GET', '/api/me/permissions', async (ctx) => {
  const g = P.groupOf(ctx.agent);
  return { group: g ? { id: g.id, key: g.key, name: g.name, builtin: g.builtin } : null,
           perms: g ? g.perms : [] };
});

on('GET', '/api/meta', async () => ({
  statuses: D.STATUSES,
  vehicles: D.VEHICLES,
  priorities: D.PRIORITIES,
  availability: D.AVAILABILITY,
  roles: D.ROLES,
  governorates: D.GOVERNORATES,
  areas: AREA.AREAS,
  approval: D.APPROVAL,
  working_approvals: D.WORKING_APPROVALS,
  probation_max_orders: D.PROBATION_MAX_ORDERS,
  permissions: P.PERMISSIONS,
  active_statuses: D.ACTIVE_STATUSES,
  final_statuses: D.FINAL_STATUSES,
}), { auth: false });

/* ---- المندوبون ---- */

on('GET', '/api/agents', async (ctx) => {
  // من لا يملك إدارة الحسابات لا يرى إلا الزملاء القادرين على العمل
  const isAdmin = P.can(ctx.agent, 'accounts.manage');
  const approvalFilter = ctx.query.approval
    ? oneOf(ctx.query.approval, 'حالة الاعتماد', Object.keys(D.APPROVAL))
    : '';

  let rows;
  if (!isAdmin) {
    rows = db.prepare(
      `SELECT * FROM agents WHERE role='agent' AND active=1
         AND approval IN (${D.WORKING_APPROVALS.map(() => '?').join(',')})
       ORDER BY name`
    ).all(...D.WORKING_APPROVALS);
  } else if (approvalFilter) {
    rows = db.prepare('SELECT * FROM agents WHERE approval=? ORDER BY role DESC, name').all(approvalFilter);
  } else {
    rows = db.prepare('SELECT * FROM agents ORDER BY role DESC, name').all();
  }

  const load = db.prepare(
    `SELECT agent_id, COUNT(*) AS n FROM orders
      WHERE status IN ('assigned','accepted','picked_up','on_the_way') AND agent_id IS NOT NULL
      GROUP BY agent_id`
  ).all();
  const byAgent = new Map(load.map((r) => [r.agent_id, r.n]));

  return { agents: rows.map((a) => ({ ...publicAgent(a), active_orders: byAgent.get(a.id) || 0 })) };
});

on('POST', '/api/agents', async (ctx) => {
  need(ctx, 'accounts.manage', 'إنشاء حساب');
  const name = str(ctx.body.name, 'الاسم', { min: 3, max: 80 });
  const username = str(ctx.body.username, 'اسم المستخدم', { min: 3, max: 40 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw badRequest('اسم المستخدم يقبل الحروف اللاتينية والأرقام والنقطة والشرطة فقط');
  }
  const password = str(ctx.body.password, 'كلمة المرور', { min: 6, max: 200 });
  const phone = tel(ctx.body.phone, 'رقم الهاتف', { required: false, max: 25 });
  const role = oneOf(ctx.body.role || 'agent', 'الدور', Object.keys(D.ROLES));
  const vehicle = oneOf(ctx.body.vehicle || 'sedan', 'نوع المركبة', Object.keys(D.VEHICLES));
  const governorate = str(ctx.body.governorate, 'المحافظة', { required: false, max: 40 });

  if (db.prepare('SELECT 1 FROM agents WHERE lower(username)=?').get(username)) {
    throw conflict('اسم المستخدم مستخدم بالفعل');
  }

  // المندوب الجديد يبدأ تحت التجربة فلا يُعتمد أحد ضمنيًا؛ والمدير يبدأ معتمدًا.
  // يقبل الطلب `approval` صراحةً لمن يريد اعتماد مندوب فور إنشائه.
  const approval = ctx.body.approval
    ? oneOf(ctx.body.approval, 'حالة الاعتماد', D.WORKING_APPROVALS)
    : (role === 'admin' ? 'approved' : 'under_test');

  // التعمية بطيئة عمدًا، فتُحسب قبل فتح المعاملة لا داخلها: لا تُحبس
  // القاعدة على انتظار حساب.
  const hash = auth.hashPassword(password);
  const groupId = ctx.body.group_id != null ? id(ctx.body.group_id, 'معرّف المجموعة') : null;

  /* الإنشاء خطوتان: صفٌّ في `agents` ثم مجموعةٌ له. الأولى كانت تُثبَّت قبل
     أن تُفحص الثانية، فإذا رُدّت المجموعة رجع الردّ رفضًا وبقي الحساب —
     بلا مجموعة، وهي الحال التي يمنعها التعليق أدناه نفسه. ويزيد الأمر
     إحكامًا أنّ اسم المستخدم يكون قد حُجز: من يُعيد المحاولة يُقابَل بـ
     «مستخدم بالفعل» على حسابٍ لا يراه. فصارتا معاملةً واحدة: تمضيان معًا
     أو لا تمضي واحدة. */
  const create = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                           availability, active, approval, approval_at, approval_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', 1, ?, ?, ?, ?)`
    ).run(name, username, phone, hash, role, vehicle, governorate,
          approval, now(), ctx.agent.id, now());

    logAgentEvent({
      agentId: Number(info.lastInsertRowid), actorId: ctx.agent.id,
      type: 'created', to: approval,
    });

    /* لكل حساب مجموعة منذ لحظته الأولى: مجموعة دوره افتراضًا، أو ما طُلب
       صراحةً بقواعده. حسابٌ بلا مجموعة حسابٌ بلا صلاحيات معروفة. */
    const born = db.prepare('SELECT * FROM agents WHERE id=?').get(info.lastInsertRowid);
    if (groupId != null) P.assignGroup(ctx.agent, born, groupId);
    else db.prepare('UPDATE agents SET group_id = (SELECT id FROM groups WHERE key = ?) WHERE id = ?').run(role, born.id);

    return Number(info.lastInsertRowid);
  });

  return { agent: publicAgent(db.prepare('SELECT * FROM agents WHERE id=?').get(create())) };
});

on('PATCH', '/api/agents/:id', async (ctx) => {
  need(ctx, 'accounts.manage', 'تعديل حساب');
  const agentId = id(ctx.params.id, 'معرّف المندوب');
  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
  if (!agent) throw notFound('المندوب غير موجود');

  const fields = [];
  const values = [];
  if (ctx.body.name != null)        { fields.push('name = ?');        values.push(str(ctx.body.name, 'الاسم', { min: 3, max: 80 })); }
  if (ctx.body.phone != null)       { fields.push('phone = ?');       values.push(tel(ctx.body.phone, 'رقم الهاتف', { required: false, max: 25 })); }
  if (ctx.body.vehicle != null)     { fields.push('vehicle = ?');     values.push(oneOf(ctx.body.vehicle, 'نوع المركبة', Object.keys(D.VEHICLES))); }
  if (ctx.body.governorate != null) { fields.push('governorate = ?'); values.push(str(ctx.body.governorate, 'المحافظة', { required: false, max: 40 })); }
  if (ctx.body.password) {
    fields.push('password_hash = ?');
    values.push(auth.hashPassword(str(ctx.body.password, 'كلمة المرور', { min: 6, max: 200 })));
  }
  // حالة الاعتماد لها نقطة نهاية مستقلّة لأنها تحمل قواعد وسجلًّا، ولا تُخلط
  // مع تعديل البيانات. `active` صار مشتقًّا منها فلا يُضبط مباشرةً.
  if (ctx.body.approval != null || ctx.body.active != null) {
    throw badRequest('استخدم PATCH /api/agents/:id/approval لتغيير حالة الاعتماد', 'use_approval_endpoint');
  }
  /* المجموعة تمرّ بقواعدها هي (لا يمنح أحدٌ ما لا يملك، ولا يُغلق الباب على
     أهله)، فلا تُكتب مع بقية الحقول في جملة واحدة. */
  if (ctx.body.group_id != null) {
    P.assignGroup(ctx.agent, agent, id(ctx.body.group_id, 'معرّف المجموعة'));
  }
  if (!fields.length) {
    if (ctx.body.group_id != null) return { agent: publicAgent(db.prepare('SELECT * FROM agents WHERE id=?').get(agentId)) };
    throw badRequest('لا يوجد ما يُحدَّث');
  }

  values.push(agentId);
  db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return { agent: publicAgent(db.prepare('SELECT * FROM agents WHERE id=?').get(agentId)) };
});

/* ---- روابط المهام: صفحة الكابتن بلا تسجيل دخول ---- */

on('POST', '/api/orders/:id/link', async (ctx) => {
  need(ctx, 'links.manage', 'إنشاء رابط مهمّة');
  const orderId = id(ctx.params.id, 'معرّف الطلب');
  const link = LK.createLink(orderId, ctx.agent);
  const pub = publicLink(link, ctx);

  /* يُدفع الحدث إلى الوجهة الخارجية (n8n) لترسل الرابط للكابتن على واتساب.
     كان المدير ينسخ الرابط ويرسله بيده — خطوة يدوية في أكثر لحظة استعجالًا.
     الدفع لا يُفشل إنشاء الرابط: لو تعذّر بقي في الصندوق وأُعيدت محاولته. */
  const order = D.getOrder(orderId);
  const agent = db.prepare('SELECT name, phone FROM agents WHERE id=?').get(order.agent_id) || {};
  const hook = await HK.emit('link.created', {
    link: { url: HK.publicUrl() ? `${HK.publicUrl()}/l/${link.token}` : pub.url,
            expires_at: link.expires_at },
    agent: { id: order.agent_id, name: agent.name || '', phone: agent.phone || '' },
    order: {
      id: order.id, code: order.code, status: order.status,
      status_label: D.STATUSES[order.status],
      customer_name: order.customer_name, customer_phone: order.customer_phone,
      pickup_address: order.pickup_address, dropoff_address: order.dropoff_address,
      governorate: order.governorate, cod_amount: order.cod_amount,
      agent_earning: order.agent_earning, priority: order.priority, notes: order.notes,
    },
  }, orderId);

  return { link: pub, hook: hook ? { status: hook.status } : { status: 'off' } };
});

on('GET', '/api/orders/:id/links', async (ctx) => {
  need(ctx, 'links.manage', 'عرض روابط المهمّة');
  const orderId = id(ctx.params.id, 'معرّف الطلب');
  return { links: LK.linksForOrder(orderId).map((l) => publicLink(l, ctx)) };
});

on('DELETE', '/api/links/:id', async (ctx) => {
  need(ctx, 'links.manage', 'إلغاء رابط');
  return { link: publicLink(LK.revokeLink(id(ctx.params.id, 'معرّف الرابط'), ctx.agent), ctx) };
});

/* نقاط الرابط العامة — بلا جلسة، الرمز نفسه هو الإذن */

on('GET', '/api/link/:token', async (ctx) => LK.context(ctx.params.token), { auth: false });

on('POST', '/api/link/:token/consent', async (ctx) => {
  const state = LK.setConsent(ctx.params.token, ctx.body.granted);
  return { consent: state };
}, { auth: false });

on('PATCH', '/api/link/:token/sharing', async (ctx) => {
  const state = LK.setSharing(ctx.params.token, ctx.body.sharing);
  return { consent: state };
}, { auth: false });

on('POST', '/api/link/:token/location', async (ctx) => {
  const point = LK.recordPoint(ctx.params.token, {
    lat: ctx.body.lat, lng: ctx.body.lng,
    accuracy: ctx.body.accuracy, speed: ctx.body.speed, heading: ctx.body.heading,
  });
  return { point };
}, { auth: false });

on('POST', '/api/link/:token/voice', async (ctx) => {
  const mime = String(ctx.req.headers['content-type'] || '');
  const seconds = Number(ctx.req.headers['x-voice-seconds']) || 0;
  const note = LK.saveVoiceNote(ctx.params.token, ctx.rawBody, mime, seconds);
  return { voice_note: note };
}, { auth: false, raw: LK.VOICE_MAX_BYTES });

on('POST', '/api/link/:token/outcome', async (ctx) => {
  const outcome = oneOf(ctx.body.outcome, 'النتيجة', Object.keys(LK.OUTCOMES));
  const note = str(ctx.body.note, 'الملاحظة', { required: false, max: 500 });
  const result = LK.reportOutcome(ctx.params.token, outcome, note);

  // تقرير المهمّة يُرسل بريدًا بعد كل بلاغ — بلا الملاحظة الصوتية
  const mail = await M.sendOrderReport(result.order.id);

  return {
    outcome: result.outcome,
    changed_status: result.changed_status,
    status: result.order.status,
    status_label: D.STATUSES[result.order.status],
    mail: { status: mail.status, configured: M.isConfigured() },
  };
}, { auth: false });

/* ---- بوّابة الزبون: وكيل موصول على الموقع، بلا حساب ---- */

/*
 * مساران عامّان يقفان خلف صفحة الموقع الجديدة: الزبون يتكلّم أو يكتب،
 * والوكيل يفهم ويسأل عمّا نقص، ثم يُرسل الطلب إلى اللوحة.
 *
 * الفهم هو `voice-order.js` نفسه الذي تستعمله اللوحة — مستخرِج قاعديّ
 * يقترح ولا يخمّن (اقرأ رأس ذلك الملف). والصفحة تُعيد إرسال الحديث كلّه
 * في كل جولة، فالخادم بلا حالة: لا مسوّدات محفوظة ولا جلسات للزوّار.
 *
 * والإنشاء لا يُسند كابتنًا ولا يضع رسومًا: الطلب يصل اللوحة بمصدرٍ
 * ظاهر (`public_ai`) وموظّفٌ يتّصل يؤكّد ثم يسعّر ويُسند. الوكيل بابٌ
 * للاستقبال، والقرار في المكتب كما كان.
 */

/* حدُّ معدّلٍ في الذاكرة لكل عنوان: البوّابة عامّة بلا كلمة مرور، وحدُّ
   الدخول لا يحرسها. نافذته تُمسح بمرورها، والخادم واحد فلا حاجة لأبعد. */
const pubHits = new Map();
function pubGuard(ip, kind, max, windowMs) {
  const key = `${kind}|${ip}`;
  const rec = pubHits.get(key);
  if (!rec || Date.now() - rec.first > windowMs) {
    pubHits.set(key, { count: 1, first: Date.now() });
  } else if (++rec.count > max) {
    throw new (require('./lib/http').HttpError)(429, 'محاولات كثيرة، انتظر قليلًا ثم أعد المحاولة');
  }
  if (pubHits.size > 5000) {
    for (const [k, r] of pubHits) if (Date.now() - r.first > windowMs) pubHits.delete(k);
  }
}

/* الحقول التي تُقرأ من جملةٍ وحدها قراءةً قاطعة: معنونةٌ باسمها في الكلام
   («اسمي…» «رقمي…» «المبلغ…»)، فلا يغيّر موضعُها في الحديث معناها. مقابلها
   المناطق: تُقرأ **بموضعها** («من … إلى …»)، فجملةٌ معزولة فيها منطقة واحدة
   يقرؤها المستخرِج استلامًا مهما كان عنوانها. */
const SOLO_FIELDS = ['customer_name', 'customer_phone', 'cod_amount', 'delivery_fee',
  'notes', 'vehicle', 'priority'];
const SAYS_PICKUP = /الاستلام|الإستلام|استلام/;
const SAYS_DROPOFF = /التسليم|إلى|الى|توصيل/;

/** ملخّصٌ يُقرأ، مبنيٌّ من الحقول نفسها التي ستُرسَل — بصيغة المستخرِج */
function describeFields(f) {
  const ar = require('arabic-kit');
  const out = [];
  if (f.customer_name) out.push(`الاسم: ${f.customer_name}`);
  if (f.customer_phone) out.push(`الهاتف: ${ar.ltr(ar.digits(f.customer_phone))}`);
  for (const [prefix, label] of [['pickup', 'الاستلام'], ['dropoff', 'التسليم']]) {
    const area = f[`${prefix}_area`];
    if (!area) continue;
    const block = f[`${prefix}_block`];
    out.push(block === undefined || block === null
      ? `${label}: ${area} (بلا قطعة)`
      : `${label}: ${area}، قطعة ${ar.digits(block)}`);
    if (f[`${prefix}_street`]) out.push(`شارع ${label}: ${f[`${prefix}_street`]}`);
  }
  if (f.cod_amount !== undefined) out.push(`المبلغ المطلوب تحصيله: ${ar.money(f.cod_amount)}`);
  if (f.delivery_fee !== undefined) out.push(`رسوم التوصيل: ${ar.money(f.delivery_fee)}`);
  if (f.notes) out.push(`ملاحظات: ${f.notes}`);
  if (f.vehicle) out.push(`المركبة: ${D.VEHICLES[f.vehicle]}`);
  if (f.priority) out.push(`الأولوية: ${D.PRIORITIES[f.priority]}`);
  return out;
}

/**
 * قراءة كلام الزبون: ما يخصّ الطلب يُستخرج حقولًا، وما كان سؤالًا يُجاب
 * عنه من معرفة الوكيل **ولا يدخل الطلب**.
 *
 * الفصل ليس ترفًا. كان كلُّ ما يقوله الزبون يُبتلع طلبًا، فسؤالان لا طلب
 * فيهما — «كم سعر التوصيل؟» ثم «توصلون الجهراء؟» — أنتجا بطاقةً اسمها
 * «توصلون الجهراء» واستلامها الجهراء. أي أنّ سؤالًا عن التغطية كان يوشك
 * أن يرسل كابتنًا إلى عنوانٍ لم يطلبه أحد، والزبون لم يُجَب أصلًا.
 *
 * الشكل المفضّل `{ utterances, latest, pending }`: `utterances` ما سبق من
 * كلامٍ يخصّ الطلب، و`latest` آخر ما قيل **خامًا**، و`pending` الحقل الذي
 * سُئل عنه. الخادم وحده يقرّر مصير الأخيرة: سؤالًا يُجاب عنه ويُسقَط، أو
 * كلامَ طلبٍ يُغلَّف بعنوان الحقل المنتظَر ويُضمّ. ويعيد في `accepted` ما
 * ضمّه فعلًا، فيحفظ الزبونُ ما استُعمل لا ما ظنّه.
 *
 * ولم تُترك القسمة للمتصفّح: التغليف يسبق القراءة، فلو غلّف السؤال أوّلًا
 * صار «اسمي كم سعر التوصيل» ولم يعد سؤالًا يُعرف. القرار والتغليف في مكان
 * واحد أو يتناقضان. ويبقى `{text, latest}` مقبولًا كما كان لمن يرسل النصّ
 * مجموعًا بلا تغليف.
 */

/* غلافُ الجوابِ القصير بعنوان السؤال المنتظَر: «السالمية» وحدها تُقرأ
   استلامًا أينما وقعت، والعنوان يحسم الجهة. والشرط أن يكون الجواب **مجرّدًا**
   — من أجاب سؤال الاستلام بتصحيح اسمه («لا، اسمي فهد») صار كلامه «الاستلام
   من لا، اسمي فهد»، ويُقرأ «الاستلام» نفسه اسمَ منطقةٍ لم تُفهم. */
const CARRIES_LABEL = /اسمي|رقمي|هاتفي|الاستلام|الإستلام|التسليم|إلى|الى|(^|\s)من(\s|$)|المبلغ|الرسوم|ملاحظ/;
const WRAP = {
  customer_name: (t) => `اسمي ${t}`,
  customer_phone: (t) => `رقمي ${t}`,
  pickup_area: (t) => `الاستلام من ${t}`,
  dropoff_area: (t) => `التسليم إلى ${t}`,
};
const wrapAnswer = (field, t) =>
  (field && WRAP[field] && t.length <= 40 && !CARRIES_LABEL.test(t)) ? WRAP[field](t) : t;

on('POST', '/api/public/order/parse', async (ctx) => {
  pubGuard(ctx.ip, 'parse', 90, 10 * 60_000);

  const said = Array.isArray(ctx.body.utterances)
    ? ctx.body.utterances.map((u) => str(u, 'ما قيل', { max: 1000 })).filter(Boolean)
    : null;
  if (said && said.length > 60) throw badRequest('الحديث طويل — أعد الطلب من أوّله');

  const latestRaw = str(ctx.body.latest, 'آخر ما قيل', { required: false, max: 1000 });

  /* السؤال يُجاب ولا يُبتلع. */
  const answered = latestRaw ? FAQ.answer(latestRaw, { record: false }) : null;
  const asked = !answered && !!latestRaw && FAQ.looksLikeQuestion(latestRaw);

  /* ما ضُمّ إلى الطلب من آخر ما قيل: لا شيء إن كان سؤالًا أُجيب عنه */
  /* حقلٌ منتظَر لا غلاف له (كالملاحظات) يُهمَل ولا يُردّ بخطأ: الغلاف
     تحسينٌ للقراءة، وفقدُه يُبقي الكلام على حاله لا يُبطل الجولة. */
  const pending = WRAP[ctx.body.pending] ? ctx.body.pending : null;

  /* والسؤالُ الذي **لم** نعرف جوابه لا يدخل الطلب أيضًا. قِيس أثر إدخاله:
     «عندكم خدمة نقل أثاث؟» جعلت المركبة «فان توصيل»، و«توصلون الجهراء؟»
     كانت تجعل الاستلام الجهراء. سؤالٌ لا نجيبه أهون من طلبٍ نخترعه.
     إلّا أن يحمل عنوانًا صريحًا («ممكن توصل **من** السالمية **إلى**
     الجابرية؟») — فذاك طلبٌ صيغ سؤالًا، وإسقاطه يضيّع ما قاله الزبون. */
  const questionOnly = asked && !CARRIES_LABEL.test(latestRaw);
  const accepted = (said && latestRaw && !answered && !questionOnly)
    ? wrapAnswer(pending, latestRaw) : null;

  /* ولا يُسجَّل في «أسئلة بلا جواب» إلّا ما كان سؤالًا خالصًا: طلبٌ صيغ
     سؤالًا («ممكن توصل من السالمية إلى الجابرية؟») ليس نقصًا في المعرفة،
     وحشوُه في القائمة يُغرق ما يحتاج المكتبُ رؤيته حقًّا. */
  if (questionOnly) FAQ.recordMiss(latestRaw);

  const text = said
    ? [...said, ...(accepted ? [accepted] : [])].join('، ')
    : str(ctx.body.text, 'نصّ الطلب', { max: 4000 });
  const latest = said ? (accepted || '') : (answered ? '' : latestRaw);

  const parsed = V.parseOrder(text);

  /* **الأحدث يفوز.** المستخرِج يأخذ أوّل ما يطابق، فمن قال «اسمي بدر» ثم
     «لا، اسمي فهد» بقي بدرًا — والزبون يرى تصحيحه يُهمَل بلا سبب ظاهر.
     تُقرأ آخر جملةٍ وحدها، ويعلو ما صرّحت به على ما استُخرج من الحديث كلّه.
     والمناطق لا تُؤخذ إلّا بعنوانٍ صريح فيها: قراءتها موضعية، وجملةٌ معزولة
     بلا عنوان يقرؤها المستخرِج استلامًا دائمًا — فلو أُخذت على علّاتها
     لانقلب التسليم استلامًا وذهب الكابتن إلى العنوان الخطأ. ما لا عنوان له
     يُترك للحديث كلّه: أن يبقى على ما كان خيرٌ من أن يُقلب. */
  if (latest) {
    const solo = V.parseOrder(latest);
    for (const k of SOLO_FIELDS) {
      if (solo.fields[k] !== undefined) parsed.fields[k] = solo.fields[k];
    }
    const saysPick = SAYS_PICKUP.test(latest);
    const saysDrop = SAYS_DROPOFF.test(latest);
    const areas = [solo.fields.pickup_area, solo.fields.dropoff_area].filter(Boolean);
    const setSide = (side, area, block) => {
      parsed.fields[`${side}_area`] = area;
      const gov = AREA.AREA_TO_GOV[area];
      if (side === 'pickup') parsed.fields.governorate = gov;
      else parsed.fields.dropoff_governorate = gov;
      if (block !== undefined) parsed.fields[`${side}_block`] = block;
      else delete parsed.fields[`${side}_block`];
    };
    if (solo.fields.pickup_area && solo.fields.dropoff_area) {
      // الجملة نفسها فيها الطرفان بترتيبهما — تُؤخذ كما قُرئت
      setSide('pickup', solo.fields.pickup_area, solo.fields.pickup_block);
      setSide('dropoff', solo.fields.dropoff_area, solo.fields.dropoff_block);
    } else if (areas.length === 1 && saysDrop !== saysPick) {
      /* منطقةٌ واحدة وعنوانٌ واحد لا يلتبس: العنوان يحسم الجهة لا الموضع */
      setSide(saysDrop ? 'dropoff' : 'pickup', areas[0], solo.fields.pickup_block ?? solo.fields.dropoff_block);
    }
    /* ما امتلأ الآن يخرج من قائمة النواقص، وإلّا سُئل الزبون عمّا أجاب عنه */
    parsed.missing = parsed.missing.filter((m) => parsed.fields[m.field] === undefined);
    /* والملخّص يُعاد بناؤه من الحقول بعد الدمج لا من قراءة الحديث كلّه:
       بغيره يبقى «الاسم: بدر» معروضًا وقد صار في الطلب «فهد» — والزبون
       يؤكّد ما يراه، فإن خالف ما يُرسَل فقد أُخذ إقرارٌ على غير ما وقع. */
    parsed.heard = describeFields(parsed.fields);
  }

  /* «هل تقصد السالمية؟» — المستخرِج يقترحها فقط حين تأتي المنطقة معنونةً
     («الاستلام: السالمي»)، والزبون يتكلّم بلا عناوين («من السالمي»)، فلا
     يصل السؤال أبدًا لمن يحتاجه أكثر. هنا يُبحث في النصّ كلّه عن أقرب
     منطقةٍ لكلمةٍ لم تُفهم، ويُلحق الاقتراح بأوّل منطقةٍ ناقصة — سؤالًا
     يُعرض لا قيمةً تُملأ، كقاعدة المستخرِج نفسها. */
  const SIM = require('./similar');
  const usedAreas = [parsed.fields.pickup_area, parsed.fields.dropoff_area].filter(Boolean);
  const firstAreaGap = parsed.missing.find((m) => m.field.endsWith('_area') && !m.hint);
  if (firstAreaGap) {
    const near = SIM.closestInText(text, AREA.ALL_AREAS);
    if (near && !usedAreas.includes(near.name)) {
      firstAreaGap.hint = near.name;
      firstAreaGap.hintFrom = near.word;
      firstAreaGap.why = `«${near.word}» ليست من مناطق الكويت — هل تقصد «${near.name}»؟`;
    }
  }

  /* `heard` و`missing` مكتوبة لموظّفٍ يعرف النظام؛ تصل الزبون كما هي
     لأنها أصلًا جُمل عربية كاملة تشرح نفسها. */
  return {
    fields: parsed.fields, heard: parsed.heard, missing: parsed.missing,
    /* `answer` جوابٌ يُقال ولا يدخل الطلب. و`unanswered` سؤالٌ ظاهر بلا
       جواب: يُقال للزبون إنّا لا نعرف ويُدَلّ على إنسان، خيرٌ من أن
       يُتجاهل سؤاله ويُعاد عليه سؤال الحقل كأنّه لم ينطق. */
    answer: answered || null,
    unanswered: (asked && !accepted) ? FAQ.FALLBACK : null,
    /* ما ضُمّ فعلًا إلى الحديث، ليحفظه الزبون كما استُعمل لا كما ظنّه */
    accepted,
  };
}, { auth: false });

on('POST', '/api/public/order', async (ctx) => {
  pubGuard(ctx.ip, 'create', 10, 60 * 60_000);

  const name = str(ctx.body.customer_name, 'الاسم', { min: 2, max: 80 });
  const phoneNo = tel(ctx.body.customer_phone, 'رقم الهاتف', { min: 6, max: 25 });
  const notes = str(ctx.body.notes, 'الملاحظات', { required: false, max: 600 });
  const cod = num(ctx.body.cod_amount, 'المبلغ المطلوب تحصيله', { max: 100000 });
  const priority = oneOf(ctx.body.priority || 'normal', 'الأولوية', Object.keys(D.PRIORITIES));
  const vehicle = oneOf(ctx.body.vehicle || 'sedan', 'نوع المركبة', Object.keys(D.VEHICLES));

  /* العنوان هنا مهيكلٌ حصرًا — منطقة من القائمة وقطعة تُفحص — لأن ما يكتبه
     الوكيل جاء من القائمة نفسها. النصّ الحرّ بابه نموذج اللوحة، حيث موظّفٌ
     يقرأ ما كُتب. */
  const readSide = (prefix, label) => {
    const area = str(ctx.body[`${prefix}_area`], `منطقة ${label}`, { max: 60 });
    const gov = AREA.AREA_TO_GOV[area];
    if (!gov) throw badRequest(`«${area}» ليست من مناطق الكويت`);
    let block = null;
    const raw = ctx.body[`${prefix}_block`];
    if (raw !== undefined && raw !== '' && raw !== null) {
      const read = AREA.readBlock(raw, area);
      if (!read.ok) throw badRequest(read.message);
      block = String(read.block);
    }
    const street = str(ctx.body[`${prefix}_street`], `شارع ${label}`, { required: false, max: 120 });
    return { area, gov, block, street, address: AREA.composeAddress({ area, block, street }) };
  };
  const pick = readSide('pickup', 'الاستلام');
  const drop = readSide('dropoff', 'التسليم');

  // الرسوم يضعها المكتب بعد التأكيد الهاتفي؛ لقطة العمولة تُؤخذ ساعتها
  const commission = S.commissionFor(0);
  const order = {
    code: nextOrderCode(),
    customer_name: name, customer_phone: phoneNo,
    pickup_address: pick.address, dropoff_address: drop.address,
    governorate: pick.gov, vehicle,
    cod_amount: cod, delivery_fee: 0, priority, notes,
    pickup_area: pick.area, pickup_block: pick.block,
    dropoff_governorate: drop.gov, dropoff_area: drop.area, dropoff_block: drop.block,
    pickup_lat: null, pickup_lng: null,
  };
  const info = db.prepare(
    `INSERT INTO orders
      (code, customer_name, customer_phone, pickup_address, dropoff_address, governorate,
       vehicle, cod_amount, delivery_fee, priority, notes, status, agent_id, created_by,
       commission_type, commission_rate, commission_amount, agent_earning,
       pickup_area, pickup_block, dropoff_governorate, dropoff_area, dropoff_block,
       pickup_lat, pickup_lng, source, created_at, updated_at)
     VALUES (@code, @customer_name, @customer_phone, @pickup_address, @dropoff_address, @governorate,
       @vehicle, @cod_amount, @delivery_fee, @priority, @notes, 'new', NULL, NULL,
       @commission_type, @commission_rate, @commission_amount, @agent_earning,
       @pickup_area, @pickup_block, @dropoff_governorate, @dropoff_area, @dropoff_block,
       @pickup_lat, @pickup_lng, 'public_ai', @ts, @ts)`
  ).run({ ...order, ...commission, ts: now() });
  const orderId = Number(info.lastInsertRowid);

  logEvent({ orderId, actorId: null, type: 'created', to: order.code, note: 'من بوّابة الزبون' });

  /* يُدفع الحدث للوجهة الخارجية (n8n) ليصل المكتبَ إشعارٌ فوريّ على
     واتساب — والفشل لا يُفشل الطلب: هو في اللوحة على كل حال. */
  await HK.emit('public_order.created', {
    order: {
      id: orderId, code: order.code,
      customer_name: order.customer_name, customer_phone: order.customer_phone,
      pickup_address: order.pickup_address, dropoff_address: order.dropoff_address,
      governorate: order.governorate, cod_amount: order.cod_amount,
      priority: order.priority, notes: order.notes,
    },
  }, orderId);

  /* الزبون يرى رمزه وملخّصه فقط — لا هويّات داخلية ولا عمولات */
  return {
    order: {
      code: order.code,
      customer_name: order.customer_name,
      pickup_address: order.pickup_address,
      dropoff_address: order.dropoff_address,
      priority: order.priority,
    },
  };
}, { auth: false });

/*
 * تسعير طلبٍ وصل بلا رسوم. طلبات البوّابة تُنشأ برسوم صفر — الزبون لا
 * يسعّر — فلولا هذا المسار بقيت عمولتها صفرًا إلى الأبد، إذ اللقطة تُؤخذ
 * ساعة الإنشاء فقط. يُعاد أخذها هنا، وقبل خروج الكابتن لا بعده: ما بعد
 * القبول اتفاقٌ قائم لا يُعاد فتحه.
 */
on('PATCH', '/api/orders/:id/pricing', async (ctx) => {
  need(ctx, 'orders.create', 'تسعير الطلب');
  const orderId = id(ctx.params.id, 'معرّف الطلب');
  const order = D.getOrder(orderId);
  if (!['new', 'assigned'].includes(order.status)) {
    throw badRequest('التسعير قبل قبول الكابتن — بعده الاتفاق قائم');
  }
  const fee = num(ctx.body.delivery_fee, 'رسوم التوصيل', { max: 10000 });
  const cod = ctx.body.cod_amount === undefined
    ? order.cod_amount
    : num(ctx.body.cod_amount, 'المبلغ المطلوب تحصيله', { max: 100000 });
  const commission = S.commissionFor(fee);
  db.prepare(
    `UPDATE orders SET delivery_fee=@fee, cod_amount=@cod,
       commission_type=@commission_type, commission_rate=@commission_rate,
       commission_amount=@commission_amount, agent_earning=@agent_earning,
       updated_at=@ts WHERE id=@id`
  ).run({ id: orderId, fee, cod, ...commission, ts: now() });
  logEvent({ orderId, actorId: ctx.agent.id, type: 'priced', to: String(fee) });
  return { order: orderWithExtras(D.getOrder(orderId)) };
});

/* ---- الملاحظات الصوتية ووصلات البريد للوحة ---- */

on('GET', '/api/voice/:id', async (ctx) => {
  const file = LK.voiceFile(id(ctx.params.id, 'معرّف الملاحظة'), ctx.agent);
  return { __stream: file };
});

on('GET', '/api/emails', async (ctx) => {
  need(ctx, 'mail.view', 'صندوق البريد');
  return { emails: M.outbox(50), configured: M.isConfigured(), to: M.mailTo() };
});

on('GET', '/api/emails/:id', async (ctx) => {
  need(ctx, 'mail.view', 'قراءة رسالة');
  const row = M.getEmail(id(ctx.params.id, 'معرّف الرسالة'));
  if (!row) throw notFound('الرسالة غير موجودة');
  return { email: row };
});

on('POST', '/api/emails/retry', async (ctx) => {
  need(ctx, 'mail.view', 'إعادة الإرسال');
  const results = await M.retryPending();
  return { results, emails: M.outbox(50), configured: M.isConfigured() };
});

on('POST', '/api/orders/:id/report', async (ctx) => {
  need(ctx, 'mail.view', 'إرسال تقرير المهمّة');
  const mail = await M.sendOrderReport(id(ctx.params.id, 'معرّف الطلب'), ctx.body.to);
  return { mail, configured: M.isConfigured() };
});

/* ---- الإعدادات: عمولة الوساطة وغيرها ---- */

on('GET', '/api/settings', async (ctx) => {
  need(ctx, 'settings.manage', 'قراءة الإعدادات');
  return {
    settings: S.all(),
    commission: S.describeCommission(),
    commission_types: S.COMMISSION_TYPES,
    history: S.history('commission', 30),
  };
});

on('PATCH', '/api/settings', async (ctx) => {
  need(ctx, 'settings.manage', 'تعديل الإعدادات');
  const note = str(ctx.body.note, 'سبب التغيير', { required: false, max: 300 });

  if (ctx.body.commission_type == null && ctx.body.commission_rate == null) {
    throw badRequest('لا يوجد ما يُحدَّث');
  }
  const commission = S.setCommission(
    { type: ctx.body.commission_type, rate: ctx.body.commission_rate },
    ctx.agent, note
  );

  return { settings: S.all(), commission, history: S.history('commission', 30) };
});

/** معاينة العمولة على رسوم معيّنة قبل حفظ الطلب */
/* صادر الأحداث — نافذة المدير على ما خرج للوجهة الخارجية وما تعثّر */
on('GET', '/api/hooks', async (ctx) => {
  need(ctx, 'settings.manage', 'سجلّ الخطّافات');
  return {
    configured: HK.isConfigured(),
    url: HK.isConfigured() ? String(process.env.MAWSOOL_WEBHOOK_URL) : '',
    deliveries: HK.outbox(50),
  };
});

on('POST', '/api/hooks/retry', async (ctx) => {
  need(ctx, 'settings.manage', 'إعادة إرسال خطّاف');
  const results = await HK.retryPending();
  return { retried: results.length, deliveries: HK.outbox(50) };
});

on('GET', '/api/settings/commission-preview', async (ctx) => {
  need(ctx, 'settings.manage', 'معاينة العمولة');
  const fee = num(ctx.query.delivery_fee, 'رسوم التوصيل', { max: 10000 });
  return { preview: S.commissionFor(fee) };
});

/* ---- اعتماد المندوبين: معتمد · تحت التجربة · غير مقبول · محظور ---- */

on('PATCH', '/api/agents/:id/approval', async (ctx) => {
  need(ctx, 'accounts.manage', 'قرار الاعتماد');
  const agentId = id(ctx.params.id, 'معرّف المندوب');
  const approval = oneOf(ctx.body.approval, 'حالة الاعتماد', Object.keys(D.APPROVAL));
  const note = str(ctx.body.note, 'سبب القرار', { required: false, max: 400 });

  const agent = D.setApproval(agentId, ctx.agent, approval, note);
  return { agent: publicAgent(agent), history: D.approvalHistory(agentId) };
});

on('GET', '/api/agents/:id/approval', async (ctx) => {
  need(ctx, 'accounts.manage', 'سجلّ الاعتماد');
  const agentId = id(ctx.params.id, 'معرّف المندوب');
  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
  if (!agent) throw notFound('المندوب غير موجود');
  return {
    agent: publicAgent(agent),
    active_orders: D.activeOrderCount(agentId),
    history: D.approvalHistory(agentId),
  };
});

on('PATCH', '/api/me/availability', async (ctx) => {
  const value = oneOf(ctx.body.availability, 'الحالة', Object.keys(D.AVAILABILITY));
  db.prepare('UPDATE agents SET availability=? WHERE id=?').run(value, ctx.agent.id);
  return { agent: publicAgent(db.prepare('SELECT * FROM agents WHERE id=?').get(ctx.agent.id)) };
});

/* ---- الطلبات ---- */

on('GET', '/api/orders', async (ctx) => {
  const where = [];
  const args = [];

  // من لا يملك رؤية الكل لا يرى إلا طلباته
  if (!P.can(ctx.agent, 'orders.view_all')) {
    where.push('o.agent_id = ?');
    args.push(ctx.agent.id);
  } else if (ctx.query.agent_id) {
    where.push('o.agent_id = ?');
    args.push(id(ctx.query.agent_id, 'معرّف المندوب'));
  }

  const scope = ctx.query.scope || '';
  if (scope === 'active') {
    /* «نشطة» في اللوحة تعني: كلُّ ما لم يَنتهِ — ومنه `new` الذي لا كابتن
       له بعد. `ACTIVE_STATUSES` نفسها تتعمّد استثناءه لأنها تَعُدّ حِمل
       الكابتن (سقف التجربة)، فالإدراج هنا في الاستعلام لا في الثابت.
       قبل هذا كان الطلب غير المُسنَد — وكلُّ ما يصل من بوّابة الزبون كذلك —
       غائبًا عن اللسان الافتراضي وعن رئيسية اللوحة معًا: أحوجُ الطلبات
       للعين أخفاها عنها. */
    where.push(`(o.status IN (${D.ACTIVE_STATUSES.map(() => '?').join(',')}) OR o.status = 'new')`);
    args.push(...D.ACTIVE_STATUSES);
  } else if (scope === 'done') {
    where.push(`o.status IN (${D.FINAL_STATUSES.map(() => '?').join(',')})`);
    args.push(...D.FINAL_STATUSES);
  } else if (scope === 'unassigned') {
    where.push('o.agent_id IS NULL');
  }

  if (ctx.query.status) {
    where.push('o.status = ?');
    args.push(oneOf(ctx.query.status, 'الحالة', Object.keys(D.STATUSES)));
  }
  if (ctx.query.governorate) {
    where.push('o.governorate = ?');
    args.push(str(ctx.query.governorate, 'المحافظة', { max: 40 }));
  }
  if (ctx.query.q) {
    const q = `%${str(ctx.query.q, 'البحث', { max: 60 })}%`;
    where.push('(o.code LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.dropoff_address LIKE ?)');
    args.push(q, q, q, q);
  }

  const limit = Math.min(Math.max(Number(ctx.query.limit) || 100, 1), 300);
  const sql = `
    SELECT o.*, a.name AS agent_name,
           (SELECT COUNT(*) FROM transfers t WHERE t.order_id = o.id AND t.status = 'pending') AS has_pending_transfer
      FROM orders o
      LEFT JOIN agents a ON a.id = o.agent_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE o.priority WHEN 'urgent' THEN 0 ELSE 1 END, o.updated_at DESC
     LIMIT ?`;

  return { orders: db.prepare(sql).all(...args, limit) };
});

on('POST', '/api/orders', async (ctx) => {
  need(ctx, 'orders.create', 'إنشاء طلب');
  const order = {
    code: nextOrderCode(),
    customer_name: str(ctx.body.customer_name, 'اسم العميل', { min: 2, max: 80 }),
    customer_phone: tel(ctx.body.customer_phone, 'هاتف العميل', { min: 6, max: 25 }),
    pickup_address: str(ctx.body.pickup_address, 'عنوان الاستلام', { required: false, max: 300 }),
    dropoff_address: str(ctx.body.dropoff_address, 'عنوان التسليم', { required: false, max: 300 }),
    governorate: oneOf(ctx.body.governorate, 'المحافظة', D.GOVERNORATES),
    vehicle: oneOf(ctx.body.vehicle || 'sedan', 'نوع المركبة', Object.keys(D.VEHICLES)),
    cod_amount: num(ctx.body.cod_amount, 'المبلغ المطلوب تحصيله', { max: 100000 }),
    delivery_fee: num(ctx.body.delivery_fee, 'رسوم التوصيل', { max: 10000 }),
    priority: oneOf(ctx.body.priority || 'normal', 'الأولوية', Object.keys(D.PRIORITIES)),
    notes: str(ctx.body.notes, 'الملاحظات', { required: false, max: 600 }),
  };

  /* العنوان المهيكل اختياري: من أرسل منطقةً وقطعةً تحقّقنا منهما وبنينا منهما
     نصّ العنوان؛ ومن أرسل نصًّا حرًّا فقط بقي على ما كان. */
  const structured = (prefix, gov) => {
    const area = str(ctx.body[`${prefix}_area`], 'المنطقة', { required: false, max: 60 });
    const blockRaw = ctx.body[`${prefix}_block`];
    if (!area && (blockRaw === undefined || blockRaw === '')) return { area: null, block: null };
    if (!area) throw badRequest('القطعة بلا منطقة — اختر المنطقة أولًا');
    if (!AREA.areaBelongsTo(area, gov)) {
      throw badRequest(`«${area}» ليست من مناطق محافظة ${gov}`);
    }
    let block = null;
    if (blockRaw !== undefined && blockRaw !== '') {
      const read = AREA.readBlock(blockRaw, area);
      if (!read.ok) throw badRequest(read.message);
      block = read.block;
    }
    return { area, block: block === null ? null : String(block) };
  };

  const dropGov = ctx.body.dropoff_governorate
    ? oneOf(ctx.body.dropoff_governorate, 'محافظة التسليم', D.GOVERNORATES)
    : order.governorate;

  const pick = structured('pickup', order.governorate);
  const drop = structured('dropoff', dropGov);

  order.pickup_area = pick.area;
  order.pickup_block = pick.block;
  order.dropoff_governorate = pick.area || drop.area ? dropGov : null;
  order.dropoff_area = drop.area;
  order.dropoff_block = drop.block;

  /* العنوان المكتوب يُبنى من الأجزاء حين تتوفّر، فلا يفترق النصّ عن الحقول.
     وطريقان مقبولان لا واحد: منطقة مختارة، أو نصّ حرّ لمن يكتبه بيده. */
  if (pick.area) {
    order.pickup_address = AREA.composeAddress({ ...pick, street: ctx.body.pickup_street });
  }
  if (drop.area) {
    order.dropoff_address = AREA.composeAddress({ ...drop, street: ctx.body.dropoff_street });
  }
  for (const [label, addr] of [['الاستلام', order.pickup_address], ['التسليم', order.dropoff_address]]) {
    if (!addr || addr.trim().length < 4) {
      throw badRequest(`عنوان ${label} ناقص — اختر المنطقة أو اكتب العنوان`);
    }
  }

  // دبّوس الزبون اختياري — يُقبل رابط خرائط أو إحداثيتان، ويُرفض ما لا يُفهم
  // بسبب واضح بدل أن يُحفظ صفرًا يُرسل الكابتن إلى وسط المحيط
  const pin = ctx.body.pickup_pin ? N.parsePin(ctx.body.pickup_pin) : null;
  order.pickup_lat = pin ? pin.lat : null;
  order.pickup_lng = pin ? pin.lng : null;

  const agentId = ctx.body.agent_id ? id(ctx.body.agent_id, 'معرّف المندوب') : null;
  if (agentId) {
    const target = db.prepare("SELECT * FROM agents WHERE id=? AND role='agent'").get(agentId);
    if (!target) throw badRequest('المندوب غير موجود أو غير مفعّل');
    D.assertCanReceiveOrders(target);
  }

  // لقطة العمولة وقت الإنشاء — تغييرها لاحقًا لا يمسّ هذا الطلب
  const commission = S.commissionFor(order.delivery_fee);

  const info = db.prepare(
    `INSERT INTO orders
      (code, customer_name, customer_phone, pickup_address, dropoff_address, governorate,
       vehicle, cod_amount, delivery_fee, priority, notes, status, agent_id, created_by,
       commission_type, commission_rate, commission_amount, agent_earning,
       pickup_area, pickup_block, dropoff_governorate, dropoff_area, dropoff_block,
       pickup_lat, pickup_lng, created_at, updated_at)
     VALUES (@code, @customer_name, @customer_phone, @pickup_address, @dropoff_address, @governorate,
       @vehicle, @cod_amount, @delivery_fee, @priority, @notes, @status, @agent_id, @created_by,
       @commission_type, @commission_rate, @commission_amount, @agent_earning,
       @pickup_area, @pickup_block, @dropoff_governorate, @dropoff_area, @dropoff_block,
       @pickup_lat, @pickup_lng, @ts, @ts)`
  ).run({
    ...order,
    ...commission,
    status: agentId ? 'assigned' : 'new',
    agent_id: agentId,
    created_by: ctx.agent.id,
    ts: now(),
  });

  logEvent({ orderId: info.lastInsertRowid, actorId: ctx.agent.id, type: 'created', to: order.code });
  if (agentId) {
    const name = db.prepare('SELECT name FROM agents WHERE id=?').get(agentId).name;
    logEvent({ orderId: info.lastInsertRowid, actorId: ctx.agent.id, type: 'assigned', to: name });
  }

  return { order: orderWithExtras(D.getOrder(info.lastInsertRowid)) };
});

on('GET', '/api/orders/:id', async (ctx) => {
  const order = D.getOrder(id(ctx.params.id, 'معرّف الطلب'));
  if (!P.can(ctx.agent, 'orders.view_all')) {
    const involved = order.agent_id === ctx.agent.id
      || db.prepare('SELECT 1 FROM transfers WHERE order_id=? AND (from_agent_id=? OR to_agent_id=?)')
           .get(order.id, ctx.agent.id, ctx.agent.id);
    if (!involved) throw forbidden('هذا الطلب غير مُسند إليك');
  }
  const full = orderWithExtras(order);
  full.allowed_next = D.allowedNextStatuses(order, ctx.agent.role);
  /*
   * موقع الكابتن جزءٌ من التفاصيل لا شرطٌ لها: من لا يملك «مواقع الكباتن»
   * يرى الطلب كاملًا بلا لوحة الموقع. وكان استدعاؤه بلا فحص يرمي ٤٠٣
   * فيسقط **الطلب كلّه** لمن يملك رؤيته — منعُ جزءٍ لا يكون منعَ الكلّ.
   */
  full.driver_location = (order.agent_id && (P.can(ctx.agent, 'locations.view') || order.agent_id === ctx.agent.id))
    ? L.locationOf(ctx.agent, order.agent_id)
    : null;
  return { order: full };
});

on('PATCH', '/api/orders/:id/status', async (ctx) => {
  const order = D.changeStatus(
    id(ctx.params.id, 'معرّف الطلب'),
    ctx.agent,
    oneOf(ctx.body.status, 'الحالة', Object.keys(D.STATUSES)),
    str(ctx.body.note, 'الملاحظة', { required: false, max: 400 })
  );
  return { order: orderWithExtras(order) };
});

/* ---- موقع الزبون وأقرب كابتن ---- */

/**
 * ضبط دبّوس الزبون على طلب قائم. الدبّوس يصل غالبًا بعد إنشاء الطلب — الزبون
 * يرسل موقعه على واتساب حين يُسأل — فلا يُشترط وجوده وقت الإنشاء.
 */
on('PUT', '/api/orders/:id/pickup-pin', async (ctx) => {
  need(ctx, 'orders.create', 'تحديد دبّوس الاستلام');
  const orderId = id(ctx.params.id, 'معرّف الطلب');
  const order = D.getOrder(orderId);
  const pin = N.parsePin(ctx.body.pin);

  db.prepare('UPDATE orders SET pickup_lat=?, pickup_lng=?, updated_at=? WHERE id=?')
    .run(pin.lat, pin.lng, now(), order.id);
  logEvent({
    orderId: order.id, actorId: ctx.agent.id, type: 'pickup_pin',
    to: `${pin.lat},${pin.lng}`,
  });

  return { order: orderWithExtras(D.getOrder(order.id)) };
});

/**
 * ترتيب الكباتن حسب قربهم من الزبون. اقتراحٌ لا إسناد: القرار يبقى للمدير،
 * والإسناد يمرّ بمساره المعتاد بسجلّه وقواعده.
 */
on('GET', '/api/orders/:id/nearest', async (ctx) => {
  need(ctx, 'orders.assign', 'اقتراح أقرب كابتن');
  return N.nearestForOrder(ctx.agent, id(ctx.params.id, 'معرّف الطلب'), {
    limit: ctx.query.limit,
    includeUnavailable: ctx.query.include_unavailable === '1',
  });
});

/**
 * الطلب المنطوق ← حقول مقترحة. **يقرأ ولا يكتب**: لا ينشئ طلبًا ولا يمسّ
 * القاعدة، والموظّف يراجع ثم يضغط زرّ الإنشاء المعتاد بقواعده كلّها.
 *
 * ولهذا لا يقبل هذا المسار إلّا نصًّا: لو أنشأ طلبًا لصار للإنشاء بابان،
 * أحدهما يتخطّى ما يفرضه الآخر.
 */
/**
 * وكيل موصول على الصفحة الرئيسية. **يقرأ ويقترح ولا يكتب**: لا ينشئ ولا
 * يُسند ولا يغيّر حالة. وما يحتاج كتابةً يحوّله إلى الشاشة التي تفعله.
 *
 * وهو مفتوح للمندوب كما للمدير — والنطاق داخل الوكيل: المندوب يرى طلباته
 * وحده، والنوايا الإدارية محجوبة عنه أصلًا.
 */
on('POST', '/api/agent/ask', async (ctx) => {
  const text = str(ctx.body.text, 'السؤال', { max: 2000 });
  return AG.ask(ctx.agent, text);
});

on('POST', '/api/voice-orders/parse', async (ctx) => {
  need(ctx, 'orders.create', 'قراءة الطلب المنطوق');
  const transcript = str(ctx.body.transcript, 'نصّ الطلب', { max: 2000 });
  return V.parseOrder(transcript);
});

on('POST', '/api/orders/:id/assign', async (ctx) => {
  const order = D.assignOrder(
    id(ctx.params.id, 'معرّف الطلب'),
    ctx.agent,
    id(ctx.body.agent_id, 'معرّف المندوب'),
    str(ctx.body.note, 'الملاحظة', { required: false, max: 400 })
  );
  return { order: orderWithExtras(order) };
});

/* ---- التحويلات ---- */

on('POST', '/api/orders/:id/transfer', async (ctx) => {
  const orderId = id(ctx.params.id, 'معرّف الطلب');
  const toAgentId = id(ctx.body.to_agent_id, 'معرّف المندوب المستلِم');
  const reason = str(ctx.body.reason, 'سبب التحويل', { min: 3, max: 300 });

  const transfer = D.requestTransfer(orderId, ctx.agent, toAgentId, reason);
  return { transfer, order: orderWithExtras(D.getOrder(orderId)) };
});

on('GET', '/api/transfers', async (ctx) => {
  const box = ctx.query.box === 'outbox' ? 'from_agent_id' : 'to_agent_id';
  const where = P.can(ctx.agent, 'orders.view_all') && ctx.query.box === 'all'
    ? '1 = 1'
    : `t.${box} = @me`;
  const status = ctx.query.status ? oneOf(ctx.query.status, 'الحالة', ['pending', 'accepted', 'rejected', 'cancelled']) : null;

  const rows = db.prepare(
    `SELECT t.*, o.code, o.customer_name, o.dropoff_address, o.governorate, o.status AS order_status,
            o.cod_amount, o.priority,
            f.name AS from_name, f.phone AS from_phone,
            tt.name AS to_name,  tt.phone AS to_phone
       FROM transfers t
       JOIN orders o  ON o.id  = t.order_id
       JOIN agents f  ON f.id  = t.from_agent_id
       JOIN agents tt ON tt.id = t.to_agent_id
      WHERE ${where} ${status ? 'AND t.status = @status' : ''}
      ORDER BY CASE t.status WHEN 'pending' THEN 0 ELSE 1 END, t.id DESC
      LIMIT 200`
  ).all({ me: ctx.agent.id, status });

  return { transfers: rows };
});

const transferAction = (action, fn) =>
  on('POST', `/api/transfers/:id/${action}`, async (ctx) => {
    const order = fn(
      id(ctx.params.id, 'معرّف التحويل'),
      ctx.agent,
      str(ctx.body.note, 'الملاحظة', { required: false, max: 400 })
    );
    return { order: orderWithExtras(order) };
  });

transferAction('accept', D.acceptTransfer);
transferAction('reject', D.rejectTransfer);
transferAction('cancel', D.cancelTransfer);

/* ---- تتبّع الموقع (بموافقة المندوب) ---- */

on('GET', '/api/me/location-consent', async (ctx) => L.consentState(ctx.agent));

on('POST', '/api/me/location-consent', async (ctx) => {
  if (typeof ctx.body.granted !== 'boolean') throw badRequest('يجب تحديد الموافقة صراحةً');
  return L.setConsent(ctx.agent, ctx.body.granted);
});

on('PATCH', '/api/me/location-sharing', async (ctx) => {
  if (typeof ctx.body.sharing !== 'boolean') throw badRequest('يجب تحديد حالة المشاركة');
  return L.setSharing(ctx.agent, ctx.body.sharing);
});

on('DELETE', '/api/me/location-history', async (ctx) => L.purgeOwnHistory(ctx.agent));

on('POST', '/api/me/location', async (ctx) => L.recordPoint(ctx.agent, ctx.body));

on('GET', '/api/agents/:id/location', async (ctx) =>
  L.locationOf(ctx.agent, id(ctx.params.id, 'معرّف المندوب')));

on('GET', '/api/agents/:id/trail', async (ctx) =>
  L.trailOf(ctx.agent, id(ctx.params.id, 'معرّف المندوب'), ctx.query.minutes));

on('GET', '/api/locations/live', async (ctx) => ({ agents: L.liveBoard(ctx.agent) }));

/* ---- أسئلة وكيل موصول وأجوبتها ---- */

on('GET', '/api/faq', async (ctx) => {
  need(ctx, 'faq.manage', 'أسئلة الوكيل');
  return {
    items: FAQ.list(),
    misses: FAQ.misses(),
    history: FAQ.history(),
  };
});

on('POST', '/api/faq', async (ctx) => {
  need(ctx, 'faq.manage', 'إضافة سؤال');
  return { item: FAQ.create(ctx.agent, ctx.body) };
});

on('PATCH', '/api/faq/:id', async (ctx) => {
  need(ctx, 'faq.manage', 'تعديل سؤال');
  return { item: FAQ.update(ctx.agent, id(ctx.params.id, 'معرّف السؤال'), ctx.body) };
});

on('DELETE', '/api/faq/:id', async (ctx) => {
  need(ctx, 'faq.manage', 'حذف سؤال');
  return FAQ.remove(ctx.agent, id(ctx.params.id, 'معرّف السؤال'));
});

on('DELETE', '/api/faq/misses/:id', async (ctx) => {
  need(ctx, 'faq.manage', 'إخفاء سؤال بلا جواب');
  return FAQ.dismissMiss(id(ctx.params.id, 'معرّف السؤال'));
});

/**
 * «جرّب سؤالًا» — يُظهر ما سيجيب به الوكيل زبونًا يقول هذا، قبل أن يقوله.
 * بلا هذا تُكتب المفاتيح على الظنّ: يضيف الموظّف صيغةً ويحسبها تعمل، ولا
 * يعرف أنها لا تُصيب إلّا من شكوى زبون. ولا يُسجَّل ما جُرّب في «بلا جواب»
 * — التجربة ليست سؤال زبون.
 */
on('POST', '/api/faq/try', async (ctx) => {
  need(ctx, 'faq.manage', 'تجربة سؤال');
  const text = str(ctx.body.text, 'السؤال', { max: 500 });
  const hit = FAQ.answer(text, { record: false });
  return {
    answer: hit,
    is_question: FAQ.looksLikeQuestion(text),
    fallback: FAQ.FALLBACK,
  };
});

/* ---- مجموعات الصلاحيات ---- */

on('GET', '/api/groups', async (ctx) => {
  need(ctx, 'groups.manage', 'عرض المجموعات');
  return { groups: P.listGroups(), permissions: P.PERMISSIONS };
});

on('POST', '/api/groups', async (ctx) => ({
  group: P.createGroup(ctx.agent, { name: ctx.body.name, perms: ctx.body.perms }),
}));

on('PATCH', '/api/groups/:id', async (ctx) => ({
  group: P.updateGroup(ctx.agent, id(ctx.params.id, 'معرّف المجموعة'),
    { name: ctx.body.name, perms: ctx.body.perms }),
}));

on('DELETE', '/api/groups/:id', async (ctx) =>
  P.deleteGroup(ctx.agent, id(ctx.params.id, 'معرّف المجموعة')));

/* ---- الإحصاءات ---- */

on('GET', '/api/stats', async (ctx) => {
  const isAdmin = P.can(ctx.agent, 'orders.view_all');
  const scope = isAdmin ? '' : 'AND agent_id = @me';
  const args = { me: ctx.agent.id };

  const byStatus = db.prepare(
    `SELECT status, COUNT(*) AS n FROM orders WHERE 1=1 ${scope} GROUP BY status`
  ).all(args);

  const counts = Object.fromEntries(Object.keys(D.STATUSES).map((s) => [s, 0]));
  for (const row of byStatus) counts[row.status] = row.n;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const today = db.prepare(
    `SELECT COUNT(*) AS delivered,
            COALESCE(SUM(cod_amount), 0)        AS cod,
            COALESCE(SUM(delivery_fee), 0)      AS fees,
            COALESCE(SUM(commission_amount), 0) AS commission,
            COALESCE(SUM(agent_earning), 0)     AS earning
       FROM orders WHERE status='delivered' AND delivered_at >= @from ${scope}`
  ).get({ ...args, from: todayStart.toISOString() });

  const pendingTransfers = db.prepare(
    `SELECT COUNT(*) AS n FROM transfers
      WHERE status='pending' ${isAdmin ? '' : 'AND to_agent_id = @me'}`
  ).get(args).n;

  const outgoingTransfers = db.prepare(
    "SELECT COUNT(*) AS n FROM transfers WHERE status='pending' AND from_agent_id = @me"
  ).get(args).n;

  return {
    counts,
    active: D.ACTIVE_STATUSES.reduce((sum, s) => sum + counts[s], 0),
    delivered_today: today.delivered,
    cod_today: today.cod,
    fees_today: S.round3(today.fees),
    // عمولتنا كوسيط، ومستحقّ الكباتن — المجموعان من لقطة كل طلب لا من نسبة حالية
    commission_today: S.round3(today.commission),
    agent_earning_today: S.round3(today.earning),
    pending_transfers_in: pendingTransfers,
    pending_transfers_out: outgoingTransfers,
    agents_online: isAdmin
      ? db.prepare("SELECT COUNT(*) AS n FROM agents WHERE role='agent' AND active=1 AND availability='available'").get().n
      : null,
    agents_under_test: isAdmin
      ? db.prepare("SELECT COUNT(*) AS n FROM agents WHERE role='agent' AND approval='under_test'").get().n
      : null,
  };
});

module.exports = { routes };
