'use strict';
/** واجهة برمجة التطبيق — كل المسارات تحت /api */
const { db, now, nextOrderCode, logEvent } = require('./db');
const auth = require('./auth');
const D = require('./domain');
const {
  badRequest, unauthorized, forbidden, notFound, conflict,
  str, num, oneOf, id,
} = require('./lib/http');

/* ------------------------------- مساعدات ------------------------------- */

const publicAgent = (a) => ({
  id: a.id, name: a.name, username: a.username, phone: a.phone, role: a.role,
  vehicle: a.vehicle, governorate: a.governorate, availability: a.availability,
  active: !!a.active, created_at: a.created_at,
});

function requireAdmin(ctx) {
  if (ctx.agent.role !== 'admin') throw forbidden('هذا الإجراء متاح لمدير العمليات فقط');
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
  return { ...order, events, transfers, pending_transfer: transfers.find((t) => t.status === 'pending') || null };
}

/* -------------------------------- المسارات ------------------------------- */

const routes = [];
const on = (method, pattern, handler, opts = {}) =>
  routes.push({ method, pattern, handler, auth: opts.auth !== false });

/* ---- المصادقة ---- */

on('POST', '/api/auth/login', async (ctx) => {
  const username = str(ctx.body.username, 'اسم المستخدم', { max: 60 }).toLowerCase();
  const password = str(ctx.body.password, 'كلمة المرور', { max: 200 });
  const key = `${ctx.ip}|${username}`;

  if (!auth.loginAllowed(key)) {
    throw new (require('./lib/http').HttpError)(429, 'محاولات كثيرة، حاول بعد قليل');
  }

  const agent = db.prepare('SELECT * FROM agents WHERE lower(username) = ?').get(username);
  if (!agent || !agent.active || !auth.verifyPassword(password, agent.password_hash)) {
    auth.recordFailure(key);
    throw unauthorized('اسم المستخدم أو كلمة المرور غير صحيحة');
  }

  auth.clearFailures(key);
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

on('GET', '/api/meta', async () => ({
  statuses: D.STATUSES,
  vehicles: D.VEHICLES,
  priorities: D.PRIORITIES,
  availability: D.AVAILABILITY,
  roles: D.ROLES,
  governorates: D.GOVERNORATES,
  active_statuses: D.ACTIVE_STATUSES,
  final_statuses: D.FINAL_STATUSES,
}), { auth: false });

/* ---- المندوبون ---- */

on('GET', '/api/agents', async (ctx) => {
  const rows = ctx.agent.role === 'admin'
    ? db.prepare('SELECT * FROM agents ORDER BY role DESC, name').all()
    : db.prepare("SELECT * FROM agents WHERE role='agent' AND active=1 ORDER BY name").all();

  const load = db.prepare(
    `SELECT agent_id, COUNT(*) AS n FROM orders
      WHERE status IN ('assigned','accepted','picked_up','on_the_way') AND agent_id IS NOT NULL
      GROUP BY agent_id`
  ).all();
  const byAgent = new Map(load.map((r) => [r.agent_id, r.n]));

  return { agents: rows.map((a) => ({ ...publicAgent(a), active_orders: byAgent.get(a.id) || 0 })) };
});

on('POST', '/api/agents', async (ctx) => {
  requireAdmin(ctx);
  const name = str(ctx.body.name, 'الاسم', { min: 3, max: 80 });
  const username = str(ctx.body.username, 'اسم المستخدم', { min: 3, max: 40 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw badRequest('اسم المستخدم يقبل الحروف اللاتينية والأرقام والنقطة والشرطة فقط');
  }
  const password = str(ctx.body.password, 'كلمة المرور', { min: 6, max: 200 });
  const phone = str(ctx.body.phone, 'رقم الهاتف', { required: false, max: 25 });
  const role = oneOf(ctx.body.role || 'agent', 'الدور', Object.keys(D.ROLES));
  const vehicle = oneOf(ctx.body.vehicle || 'sedan', 'نوع المركبة', Object.keys(D.VEHICLES));
  const governorate = str(ctx.body.governorate, 'المحافظة', { required: false, max: 40 });

  if (db.prepare('SELECT 1 FROM agents WHERE lower(username)=?').get(username)) {
    throw conflict('اسم المستخدم مستخدم بالفعل');
  }

  const info = db.prepare(
    `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate, availability, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', 1, ?)`
  ).run(name, username, phone, auth.hashPassword(password), role, vehicle, governorate, now());

  return { agent: publicAgent(db.prepare('SELECT * FROM agents WHERE id=?').get(info.lastInsertRowid)) };
});

on('PATCH', '/api/agents/:id', async (ctx) => {
  requireAdmin(ctx);
  const agentId = id(ctx.params.id, 'معرّف المندوب');
  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
  if (!agent) throw notFound('المندوب غير موجود');

  const fields = [];
  const values = [];
  if (ctx.body.name != null)        { fields.push('name = ?');        values.push(str(ctx.body.name, 'الاسم', { min: 3, max: 80 })); }
  if (ctx.body.phone != null)       { fields.push('phone = ?');       values.push(str(ctx.body.phone, 'رقم الهاتف', { required: false, max: 25 })); }
  if (ctx.body.vehicle != null)     { fields.push('vehicle = ?');     values.push(oneOf(ctx.body.vehicle, 'نوع المركبة', Object.keys(D.VEHICLES))); }
  if (ctx.body.governorate != null) { fields.push('governorate = ?'); values.push(str(ctx.body.governorate, 'المحافظة', { required: false, max: 40 })); }
  if (ctx.body.active != null)      { fields.push('active = ?');      values.push(ctx.body.active ? 1 : 0); }
  if (ctx.body.password) {
    fields.push('password_hash = ?');
    values.push(auth.hashPassword(str(ctx.body.password, 'كلمة المرور', { min: 6, max: 200 })));
  }
  if (!fields.length) throw badRequest('لا يوجد ما يُحدَّث');

  // منع تعطيل آخر مدير في النظام
  if (ctx.body.active === false && agent.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM agents WHERE role='admin' AND active=1").get().n;
    if (admins <= 1) throw conflict('لا يمكن تعطيل آخر مدير في النظام');
  }

  values.push(agentId);
  db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  if (ctx.body.active === false) db.prepare('DELETE FROM sessions WHERE agent_id=?').run(agentId);

  return { agent: publicAgent(db.prepare('SELECT * FROM agents WHERE id=?').get(agentId)) };
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

  // المندوب لا يرى إلا طلباته
  if (ctx.agent.role !== 'admin') {
    where.push('o.agent_id = ?');
    args.push(ctx.agent.id);
  } else if (ctx.query.agent_id) {
    where.push('o.agent_id = ?');
    args.push(id(ctx.query.agent_id, 'معرّف المندوب'));
  }

  const scope = ctx.query.scope || '';
  if (scope === 'active') {
    where.push(`o.status IN (${D.ACTIVE_STATUSES.map(() => '?').join(',')})`);
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
  requireAdmin(ctx);
  const order = {
    code: nextOrderCode(),
    customer_name: str(ctx.body.customer_name, 'اسم العميل', { min: 2, max: 80 }),
    customer_phone: str(ctx.body.customer_phone, 'هاتف العميل', { min: 6, max: 25 }),
    pickup_address: str(ctx.body.pickup_address, 'عنوان الاستلام', { min: 4, max: 300 }),
    dropoff_address: str(ctx.body.dropoff_address, 'عنوان التسليم', { min: 4, max: 300 }),
    governorate: oneOf(ctx.body.governorate, 'المحافظة', D.GOVERNORATES),
    vehicle: oneOf(ctx.body.vehicle || 'sedan', 'نوع المركبة', Object.keys(D.VEHICLES)),
    cod_amount: num(ctx.body.cod_amount, 'المبلغ المطلوب تحصيله', { max: 100000 }),
    delivery_fee: num(ctx.body.delivery_fee, 'رسوم التوصيل', { max: 10000 }),
    priority: oneOf(ctx.body.priority || 'normal', 'الأولوية', Object.keys(D.PRIORITIES)),
    notes: str(ctx.body.notes, 'الملاحظات', { required: false, max: 600 }),
  };

  const agentId = ctx.body.agent_id ? id(ctx.body.agent_id, 'معرّف المندوب') : null;
  if (agentId && !db.prepare("SELECT 1 FROM agents WHERE id=? AND role='agent' AND active=1").get(agentId)) {
    throw badRequest('المندوب غير موجود أو غير مفعّل');
  }

  const info = db.prepare(
    `INSERT INTO orders
      (code, customer_name, customer_phone, pickup_address, dropoff_address, governorate,
       vehicle, cod_amount, delivery_fee, priority, notes, status, agent_id, created_by, created_at, updated_at)
     VALUES (@code, @customer_name, @customer_phone, @pickup_address, @dropoff_address, @governorate,
       @vehicle, @cod_amount, @delivery_fee, @priority, @notes, @status, @agent_id, @created_by, @ts, @ts)`
  ).run({
    ...order,
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
  if (ctx.agent.role !== 'admin') {
    const involved = order.agent_id === ctx.agent.id
      || db.prepare('SELECT 1 FROM transfers WHERE order_id=? AND (from_agent_id=? OR to_agent_id=?)')
           .get(order.id, ctx.agent.id, ctx.agent.id);
    if (!involved) throw forbidden('هذا الطلب غير مُسند إليك');
  }
  const full = orderWithExtras(order);
  full.allowed_next = D.allowedNextStatuses(order, ctx.agent.role);
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
  const where = ctx.agent.role === 'admin' && ctx.query.box === 'all'
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

/* ---- الإحصاءات ---- */

on('GET', '/api/stats', async (ctx) => {
  const isAdmin = ctx.agent.role === 'admin';
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
    `SELECT COUNT(*) AS delivered, COALESCE(SUM(cod_amount), 0) AS cod
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
    pending_transfers_in: pendingTransfers,
    pending_transfers_out: outgoingTransfers,
    agents_online: isAdmin
      ? db.prepare("SELECT COUNT(*) AS n FROM agents WHERE role='agent' AND active=1 AND availability='available'").get().n
      : null,
  };
});

module.exports = { routes };
