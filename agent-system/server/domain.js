'use strict';
/**
 * قواعد العمل: دورة حياة الطلب وتحويله بين المندوبين.
 * كل ما يغيّر حالة طلب يمرّ من هنا، فتبقى القواعد في مكان واحد.
 */
const { db, now, logEvent, logAgentEvent } = require('./db');
const { badRequest, forbidden, notFound, conflict } = require('./lib/http');
const ar = require('arabic-kit');

const STATUSES = {
  new:        'جديد',
  assigned:   'مُسند لمندوب',
  accepted:   'قبِله المندوب',
  picked_up:  'تم الاستلام',
  on_the_way: 'في الطريق',
  delivered:  'تم التسليم',
  failed:     'تعذّر التسليم',
  returned:   'مرتجع',
  cancelled:  'مُلغى',
};

const VEHICLES = { sedan: 'سيارة سيدان', van: 'فان توصيل', reefer: 'سيارة مبرّدة', bike: 'دراجة' };
const PRIORITIES = { normal: 'عادي', urgent: 'عاجل' };
const AVAILABILITY = { available: 'متاح', busy: 'مشغول', offline: 'غير متصل' };
const ROLES = { admin: 'مدير عمليات', agent: 'مندوب توصيل' };

/* المحافظات من ملفّ المناطق نفسه — قائمتان تفترقان يوم تُضاف محافظة */
const { GOVERNORATES } = require('./areas');
const P = require('./perms');

/**
 * حالة اعتماد الحساب — دورة حياة المندوب لدى الإدارة.
 * هذه هي المفتاح الوحيد لصلاحية العمل؛ العمود `active` مشتقّ منها.
 */
const APPROVAL = {
  under_test: 'تحت التجربة',
  approved:   'معتمد',
  rejected:   'غير مقبول',
  blocked:    'محظور',
};

/** الحالات التي يستطيع فيها صاحب الحساب الدخول واستلام الطلبات */
const WORKING_APPROVALS = ['approved', 'under_test'];

/** الحالات التي تمنع الدخول، ولكل واحدة رسالة تشرح السبب للمستخدم */
const APPROVAL_BLOCK_REASON = {
  rejected: 'لم يُقبل طلب انضمامك. راجع إدارة العمليات.',
  blocked:  'حسابك محظور. راجع إدارة العمليات.',
};

/**
 * سقف الطلبات النشطة للمندوب تحت التجربة. الغرض ألّا تكون «تحت التجربة»
 * مجرّد وسم بلا أثر تشغيلي. اضبطه بـ ٠ لإلغاء السقف تمامًا.
 */
const PROBATION_MAX_ORDERS = Math.max(0, Number(process.env.MAWSOOL_PROBATION_MAX_ORDERS ?? 3));

/** الحالات التي يُعتبر فيها الطلب قيد التنفيذ لدى مندوب */
const ACTIVE_STATUSES = ['assigned', 'accepted', 'picked_up', 'on_the_way'];
/** الحالات النهائية التي لا يمكن تغييرها بعدها */
const FINAL_STATUSES = ['delivered', 'returned', 'cancelled'];

/** الانتقالات المسموحة للمندوب على طلباته */
const AGENT_TRANSITIONS = {
  assigned:   ['accepted'],
  accepted:   ['picked_up'],
  picked_up:  ['on_the_way'],
  on_the_way: ['delivered', 'failed'],
  failed:     ['on_the_way', 'returned'],
};

/* ------------------------- اعتماد المندوبين ------------------------- */

/**
 * يُلغي روابط المهام السارية على طلب. يُستدعى كلما تغيّر كابتن الطلب:
 * الرابط مفتاحٌ باسم كابتن بعينه، فإبقاؤه ساريًا بعد انتقال الطلب يجعل اللوحة
 * تعرضه للمدير كرابط صالح فينسخه ويرسله — وهو ميّت عند الفتح.
 */
function revokeLinksFor(orderId) {
  db.prepare('UPDATE delivery_links SET revoked_at = ? WHERE order_id = ? AND revoked_at IS NULL')
    .run(now(), orderId);
}

/** عدد الطلبات النشطة لدى مندوب */
function activeOrderCount(agentId) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM orders
      WHERE agent_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`
  ).get(agentId, ...ACTIVE_STATUSES).n;
}

/**
 * يتحقق أن الحساب مؤهّل لاستلام طلب جديد، ويشرح السبب بدقة عند الرفض.
 * يُستدعى قبل الإسناد المباشر وقبل قبول التحويل — الطريقان الوحيدان
 * اللذان ينتقل بهما طلب إلى مندوب.
 */
function assertCanReceiveOrders(agent) {
  if (!agent || agent.role !== 'agent') throw badRequest('المندوب غير موجود');
  if (!WORKING_APPROVALS.includes(agent.approval)) {
    throw conflict(`لا يمكن إسناد طلبات إلى حساب ${APPROVAL[agent.approval] || agent.approval}`);
  }
  if (!agent.active) throw badRequest('المندوب غير مفعّل');
  if (agent.approval === 'under_test' && PROBATION_MAX_ORDERS > 0) {
    const load = activeOrderCount(agent.id);
    if (load >= PROBATION_MAX_ORDERS) {
      throw conflict(
        `المندوب تحت التجربة، وسقف طلباته النشطة ${ar.plural(PROBATION_MAX_ORDERS, 'order')}. ` +
        'اعتمده أو انتظر إنهاء أحد طلباته.'
      );
    }
  }
}

/**
 * تغيير حالة اعتماد حساب. مدير العمليات وحده يملكها، وهي المفتاح الوحيد
 * لصلاحية العمل — تُحدّث `active` معها فلا يتعارض مفتاحان.
 *
 * القواعد:
 *  • المنع (رفض/حظر) يتطلّب سببًا مكتوبًا يُحفظ في السجل.
 *  • لا يُمنع حساب يحمل طلبات نشطة — تُعاد أولًا حتى لا تُيتَّم الطلبات.
 *  • لا يُمنع آخر مدير في النظام.
 *  • المنع يُنهي جلسات الحساب فورًا.
 */
function setApproval(agentId, actor, approval, note = '') {
  P.require(actor, 'accounts.manage', 'إدارة اعتماد الحسابات');
  if (!APPROVAL[approval]) throw badRequest('حالة اعتماد غير معروفة');

  const run = db.transaction(() => {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) throw notFound('المندوب غير موجود');
    if (agent.approval === approval) throw conflict('الحساب في هذه الحالة أصلًا');

    const willWork = WORKING_APPROVALS.includes(approval);

    if (!willWork) {
      if (!String(note).trim()) throw badRequest('يجب كتابة سبب المنع');
      const load = activeOrderCount(agentId);
      if (load > 0) {
        throw conflict(
          `لا يمكن منع حساب لديه ${ar.describe(load, 'order', 'active')} — ` +
          'أعد إسناد طلباته لمندوب آخر أولًا.'
        );
      }
      if (agent.role === 'admin') {
        const admins = db.prepare(
          `SELECT COUNT(*) AS n FROM agents WHERE role='admin' AND id <> ?
            AND approval IN (${WORKING_APPROVALS.map(() => '?').join(',')})`
        ).get(agentId, ...WORKING_APPROVALS).n;
        if (admins < 1) throw conflict('لا يمكن منع آخر مدير في النظام');
      }
    }

    db.prepare(
      `UPDATE agents SET approval = ?, approval_note = ?, approval_at = ?, approval_by = ?,
                         active = ?, availability = CASE WHEN ? THEN availability ELSE 'offline' END
        WHERE id = ?`
    ).run(approval, String(note || ''), now(), actor.id, willWork ? 1 : 0, willWork ? 1 : 0, agentId);

    if (!willWork) db.prepare('DELETE FROM sessions WHERE agent_id = ?').run(agentId);

    logAgentEvent({
      agentId, actorId: actor.id, type: 'approval',
      from: agent.approval, to: approval, note,
    });

    return db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  });
  return run();
}

/** سجل قرارات الاعتماد على حساب، الأحدث أولًا */
function approvalHistory(agentId) {
  return db.prepare(
    `SELECT e.*, a.name AS actor_name FROM agent_events e
       LEFT JOIN agents a ON a.id = e.actor_id
      WHERE e.agent_id = ? ORDER BY e.id DESC LIMIT 50`
  ).all(agentId);
}

/**
 * الحالات التي لا معنى لها بلا كابتن: كلها تصف ما فعله كابتن بعينه. الإلغاء
 * وحده يبقى متاحًا لطلب لم يُسند بعد.
 */
const NEEDS_AGENT = ['assigned', 'accepted', 'picked_up', 'on_the_way', 'delivered', 'failed', 'returned'];

/** المدير يستطيع الانتقال إلى أي حالة عدا العودة من حالة نهائية */
function allowedNextStatuses(order, role) {
  if (FINAL_STATUSES.includes(order.status)) return [];
  if (role === 'admin') {
    // طلب بلا كابتن لا يُقال عنه «مُسند لمندوب» ولا «تم التسليم» — الإسناد أولًا
    const pool = Object.keys(STATUSES).filter((s) => s !== order.status && s !== 'new');
    return order.agent_id ? pool : pool.filter((s) => !NEEDS_AGENT.includes(s));
  }
  return AGENT_TRANSITIONS[order.status] || [];
}

const selectOrder = db.prepare(`
  SELECT o.*,
         a.name  AS agent_name,
         a.phone AS agent_phone,
         c.name  AS created_by_name
    FROM orders o
    LEFT JOIN agents a ON a.id = o.agent_id
    LEFT JOIN agents c ON c.id = o.created_by
   WHERE o.id = ?`);

function getOrder(orderId) {
  const order = selectOrder.get(orderId);
  if (!order) throw notFound('الطلب غير موجود');
  return order;
}

function pendingTransferFor(orderId) {
  return db.prepare(
    `SELECT t.*, f.name AS from_name, tt.name AS to_name
       FROM transfers t
       JOIN agents f  ON f.id  = t.from_agent_id
       JOIN agents tt ON tt.id = t.to_agent_id
      WHERE t.order_id = ? AND t.status = 'pending'`
  ).get(orderId);
}

/** يتحقق أن المستخدم يملك الطلب (أو أنه مدير) */
function assertCanTouch(order, actor) {
  if (P.can(actor, 'orders.view_all')) return;
  if (order.agent_id !== actor.id) throw forbidden('هذا الطلب غير مُسند إليك');
}

/* ------------------------------ تغيير الحالة ------------------------------ */

function changeStatus(orderId, actor, nextStatus, note = '', options = {}) {
  const run = db.transaction(() => {
    const order = getOrder(orderId);
    assertCanTouch(order, actor);

    if (!Object.hasOwn(STATUSES, nextStatus)) throw badRequest('حالة غير معروفة');
    if (order.status === nextStatus) throw conflict('الطلب في هذه الحالة أصلًا');

    /* الحالات التنفيذية تصف عمل كابتن، فلا تُضبط على طلب لم يُسند بعد: طلب
       «تم التسليم» بلا كابتن يدخل في العدّادات وفي حساب المستحقّات بلا صاحب. */
    if (!order.agent_id && NEEDS_AGENT.includes(nextStatus)) {
      throw conflict(`أسند الطلب إلى كابتن أولًا — «${STATUSES[nextStatus]}» تصف عمل كابتن`);
    }

    /* `allowJump` لرابط المهمّة: الكابتن الذي لا يفتح اللوحة أصلًا لا يستطيع
       تسلّق سُلّم الحالات خطوةً خطوة، فيُسمح له بإغلاق المهمّة مباشرةً.
       الحالات النهائية تبقى مقفلة، والقفزة تُسجَّل كما هي بلا اختلاق خطوات. */
    const allowed = FINAL_STATUSES.includes(order.status) ? []
      : options.allowJump
        ? Object.keys(STATUSES).filter((s) => s !== order.status && s !== 'new')
        : allowedNextStatuses(order, actor.role);
    if (!allowed.includes(nextStatus)) {
      throw conflict(
        `لا يمكن الانتقال من «${STATUSES[order.status]}» إلى «${STATUSES[nextStatus]}»`,
        'invalid_transition'
      );
    }

    if (nextStatus === 'failed' && !note) {
      throw badRequest('يجب كتابة سبب تعذّر التسليم');
    }

    // إلغاء أي طلب تحويل معلّق عند وصول الطلب إلى حالة نهائية
    if (FINAL_STATUSES.includes(nextStatus)) {
      const pending = pendingTransferFor(orderId);
      if (pending) {
        db.prepare(`UPDATE transfers SET status='cancelled', resolved_at=?,
                    response_note='أُلغي تلقائيًا لانتهاء الطلب' WHERE id=?`).run(now(), pending.id);
        logEvent({ orderId, actorId: actor.id, type: 'transfer_cancelled',
                   note: 'أُلغي طلب التحويل تلقائيًا لانتهاء الطلب' });
      }
    }

    db.prepare(
      `UPDATE orders
          SET status = ?, updated_at = ?,
              delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
              failure_reason = CASE WHEN ? = 'failed' THEN ? ELSE failure_reason END
        WHERE id = ?`
    ).run(nextStatus, now(), nextStatus, now(), nextStatus, note, orderId);

    logEvent({
      orderId, actorId: actor.id, type: 'status',
      from: order.status, to: nextStatus, note,
    });

    return getOrder(orderId);
  });
  return run();
}

/* ------------------------------- الإسناد -------------------------------- */

function assignOrder(orderId, actor, agentId, note = '') {
  P.require(actor, 'orders.assign', 'الإسناد المباشر');

  const run = db.transaction(() => {
    const order = getOrder(orderId);
    if (FINAL_STATUSES.includes(order.status)) throw conflict('لا يمكن إسناد طلب منتهٍ');

    const agent = db.prepare("SELECT * FROM agents WHERE id = ? AND role = 'agent'").get(agentId);
    if (!agent) throw badRequest('المندوب غير موجود أو غير مفعّل');
    if (order.agent_id === agentId) throw conflict('الطلب مُسند لهذا المندوب أصلًا');
    assertCanReceiveOrders(agent);

    const previous = order.agent_id
      ? db.prepare('SELECT name FROM agents WHERE id = ?').get(order.agent_id)?.name || ''
      : '';

    const pending = pendingTransferFor(orderId);
    if (pending) {
      db.prepare(`UPDATE transfers SET status='cancelled', resolved_at=?,
                  response_note='أُلغي لإعادة إسناد الطلب من الإدارة' WHERE id=?`).run(now(), pending.id);
    }

    // إذا كانت الشحنة مستلمة فعليًا فالحالة تبقى «تم الاستلام» بعد المناولة
    const nextStatus = ['picked_up', 'on_the_way'].includes(order.status) ? 'picked_up' : 'assigned';

    db.prepare('UPDATE orders SET agent_id = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(agentId, nextStatus, now(), orderId);
    revokeLinksFor(orderId);

    logEvent({
      orderId, actorId: actor.id, type: 'assigned',
      from: previous, to: agent.name, note,
    });

    return getOrder(orderId);
  });
  return run();
}

/* ----------------------- التحويل بين المندوبين ------------------------ */

/**
 * المندوب يطلب تحويل طلبه إلى زميل — لا ينتقل الطلب حتى يقبل الزميل.
 * المدير يحوّل مباشرةً عبر assignOrder.
 */
function requestTransfer(orderId, actor, toAgentId, reason) {
  const run = db.transaction(() => {
    const order = getOrder(orderId);
    assertCanTouch(order, actor);

    if (!order.agent_id) throw conflict('الطلب غير مُسند لأي مندوب بعد');
    if (!ACTIVE_STATUSES.includes(order.status)) {
      throw conflict(`لا يمكن تحويل طلب حالته «${STATUSES[order.status]}»`, 'not_transferable');
    }
    if (toAgentId === order.agent_id) throw badRequest('لا يمكن تحويل الطلب إلى المندوب نفسه');

    const target = db.prepare("SELECT * FROM agents WHERE id = ? AND role = 'agent'").get(toAgentId);
    if (!target) throw badRequest('المندوب المستلِم غير موجود أو غير مفعّل');
    assertCanReceiveOrders(target);

    if (pendingTransferFor(orderId)) {
      throw conflict('هناك طلب تحويل معلّق على هذا الطلب بالفعل', 'transfer_exists');
    }

    const info = db.prepare(
      `INSERT INTO transfers (order_id, from_agent_id, to_agent_id, reason, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).run(orderId, order.agent_id, toAgentId, reason, now());

    const fromName = db.prepare('SELECT name FROM agents WHERE id = ?').get(order.agent_id)?.name || '';
    logEvent({
      orderId, actorId: actor.id, type: 'transfer_requested',
      from: fromName, to: target.name, note: reason,
    });

    return db.prepare('SELECT * FROM transfers WHERE id = ?').get(info.lastInsertRowid);
  });
  return run();
}

/** المندوب المستلِم يقبل التحويل فينتقل الطلب إليه */
function acceptTransfer(transferId, actor, note = '') {
  const run = db.transaction(() => {
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(transferId);
    if (!t) throw notFound('طلب التحويل غير موجود');
    if (t.status !== 'pending') throw conflict('تمت معالجة طلب التحويل مسبقًا');
    if (!P.can(actor, 'orders.view_all') && t.to_agent_id !== actor.id) {
      throw forbidden('طلب التحويل هذا ليس موجّهًا إليك');
    }

    const order = getOrder(t.order_id);
    if (!ACTIVE_STATUSES.includes(order.status)) {
      throw conflict('تغيّرت حالة الطلب ولم يعد قابلًا للتحويل', 'not_transferable');
    }

    // قد تكون حالة اعتماد المستلِم تغيّرت بين إنشاء التحويل وقبوله
    assertCanReceiveOrders(db.prepare('SELECT * FROM agents WHERE id = ?').get(t.to_agent_id));

    const nextStatus = ['picked_up', 'on_the_way'].includes(order.status) ? 'picked_up' : 'assigned';

    db.prepare('UPDATE orders SET agent_id = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(t.to_agent_id, nextStatus, now(), t.order_id);
    revokeLinksFor(t.order_id);
    db.prepare("UPDATE transfers SET status='accepted', resolved_at=?, response_note=? WHERE id=?")
      .run(now(), note, transferId);

    const names = db.prepare(
      'SELECT (SELECT name FROM agents WHERE id=?) AS f, (SELECT name FROM agents WHERE id=?) AS t'
    ).get(t.from_agent_id, t.to_agent_id);

    logEvent({
      orderId: t.order_id, actorId: actor.id, type: 'transfer_accepted',
      from: names.f, to: names.t, note,
    });

    return getOrder(t.order_id);
  });
  return run();
}

/** المندوب المستلِم يرفض التحويل فيبقى الطلب مع صاحبه */
function rejectTransfer(transferId, actor, note = '') {
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(transferId);
  if (!t) throw notFound('طلب التحويل غير موجود');
  if (t.status !== 'pending') throw conflict('تمت معالجة طلب التحويل مسبقًا');
  if (!P.can(actor, 'orders.view_all') && t.to_agent_id !== actor.id) {
    throw forbidden('طلب التحويل هذا ليس موجّهًا إليك');
  }

  db.prepare("UPDATE transfers SET status='rejected', resolved_at=?, response_note=? WHERE id=?")
    .run(now(), note, transferId);

  const names = db.prepare(
    'SELECT (SELECT name FROM agents WHERE id=?) AS f, (SELECT name FROM agents WHERE id=?) AS t'
  ).get(t.from_agent_id, t.to_agent_id);

  logEvent({
    orderId: t.order_id, actorId: actor.id, type: 'transfer_rejected',
    from: names.f, to: names.t, note,
  });

  return getOrder(t.order_id);
}

/** صاحب الطلب يسحب طلب التحويل قبل ردّ الزميل */
function cancelTransfer(transferId, actor, note = '') {
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(transferId);
  if (!t) throw notFound('طلب التحويل غير موجود');
  if (t.status !== 'pending') throw conflict('تمت معالجة طلب التحويل مسبقًا');
  if (!P.can(actor, 'orders.view_all') && t.from_agent_id !== actor.id) {
    throw forbidden('لا يمكنك سحب طلب تحويل لم تنشئه');
  }

  db.prepare("UPDATE transfers SET status='cancelled', resolved_at=?, response_note=? WHERE id=?")
    .run(now(), note, transferId);

  logEvent({ orderId: t.order_id, actorId: actor.id, type: 'transfer_cancelled', note });
  return getOrder(t.order_id);
}

module.exports = {
  STATUSES, VEHICLES, PRIORITIES, AVAILABILITY, ROLES, GOVERNORATES,
  APPROVAL, WORKING_APPROVALS, APPROVAL_BLOCK_REASON, PROBATION_MAX_ORDERS,
  ACTIVE_STATUSES, FINAL_STATUSES, AGENT_TRANSITIONS,
  allowedNextStatuses, getOrder, pendingTransferFor,
  activeOrderCount, assertCanReceiveOrders, setApproval, approvalHistory, revokeLinksFor,
  changeStatus, assignOrder, requestTransfer, acceptTransfer, rejectTransfer, cancelTransfer,
};
