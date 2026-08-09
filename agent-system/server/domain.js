'use strict';
/**
 * قواعد العمل: دورة حياة الطلب وتحويله بين المندوبين.
 * كل ما يغيّر حالة طلب يمرّ من هنا، فتبقى القواعد في مكان واحد.
 */
const { db, now, logEvent } = require('./db');
const { badRequest, forbidden, notFound, conflict } = require('./lib/http');

const STATUSES = {
  new:        'جديد',
  assigned:   'مُسند لمندوب',
  accepted:   'قبِله المندوب',
  picked_up:  'تم الاستلام',
  on_the_way: 'في الطريق',
  delivered:  'تم التسليم',
  failed:     'تعذّر التسليم',
  returned:   'مرتجع',
  cancelled:  'ملغي',
};

const VEHICLES = { sedan: 'سيارة سيدان', van: 'فان توصيل', reefer: 'سيارة مبرّدة', bike: 'دراجة' };
const PRIORITIES = { normal: 'عادي', urgent: 'عاجل' };
const AVAILABILITY = { available: 'متاح', busy: 'مشغول', offline: 'غير متصل' };
const ROLES = { admin: 'مدير عمليات', agent: 'مندوب توصيل' };

const GOVERNORATES = [
  'العاصمة', 'حولي', 'الفروانية', 'مبارك الكبير', 'الأحمدي', 'الجهراء',
];

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

/** المدير يستطيع الانتقال إلى أي حالة عدا العودة من حالة نهائية */
function allowedNextStatuses(order, role) {
  if (FINAL_STATUSES.includes(order.status)) return [];
  if (role === 'admin') {
    return Object.keys(STATUSES).filter((s) => s !== order.status && s !== 'new');
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
  if (actor.role === 'admin') return;
  if (order.agent_id !== actor.id) throw forbidden('هذا الطلب غير مُسند إليك');
}

/* ------------------------------ تغيير الحالة ------------------------------ */

function changeStatus(orderId, actor, nextStatus, note = '') {
  const run = db.transaction(() => {
    const order = getOrder(orderId);
    assertCanTouch(order, actor);

    if (!Object.hasOwn(STATUSES, nextStatus)) throw badRequest('حالة غير معروفة');
    if (order.status === nextStatus) throw conflict('الطلب في هذه الحالة أصلًا');

    const allowed = allowedNextStatuses(order, actor.role);
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
  if (actor.role !== 'admin') throw forbidden('الإسناد المباشر متاح لمدير العمليات فقط');

  const run = db.transaction(() => {
    const order = getOrder(orderId);
    if (FINAL_STATUSES.includes(order.status)) throw conflict('لا يمكن إسناد طلب منتهٍ');

    const agent = db.prepare("SELECT * FROM agents WHERE id = ? AND role = 'agent' AND active = 1").get(agentId);
    if (!agent) throw badRequest('المندوب غير موجود أو غير مفعّل');
    if (order.agent_id === agentId) throw conflict('الطلب مُسند لهذا المندوب أصلًا');

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

    const target = db.prepare("SELECT * FROM agents WHERE id = ? AND role = 'agent' AND active = 1").get(toAgentId);
    if (!target) throw badRequest('المندوب المستلِم غير موجود أو غير مفعّل');

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
    if (actor.role !== 'admin' && t.to_agent_id !== actor.id) {
      throw forbidden('طلب التحويل هذا ليس موجّهًا إليك');
    }

    const order = getOrder(t.order_id);
    if (!ACTIVE_STATUSES.includes(order.status)) {
      throw conflict('تغيّرت حالة الطلب ولم يعد قابلًا للتحويل', 'not_transferable');
    }

    const nextStatus = ['picked_up', 'on_the_way'].includes(order.status) ? 'picked_up' : 'assigned';

    db.prepare('UPDATE orders SET agent_id = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(t.to_agent_id, nextStatus, now(), t.order_id);
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
  if (actor.role !== 'admin' && t.to_agent_id !== actor.id) {
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
  if (actor.role !== 'admin' && t.from_agent_id !== actor.id) {
    throw forbidden('لا يمكنك سحب طلب تحويل لم تنشئه');
  }

  db.prepare("UPDATE transfers SET status='cancelled', resolved_at=?, response_note=? WHERE id=?")
    .run(now(), note, transferId);

  logEvent({ orderId: t.order_id, actorId: actor.id, type: 'transfer_cancelled', note });
  return getOrder(t.order_id);
}

module.exports = {
  STATUSES, VEHICLES, PRIORITIES, AVAILABILITY, ROLES, GOVERNORATES,
  ACTIVE_STATUSES, FINAL_STATUSES, AGENT_TRANSITIONS,
  allowedNextStatuses, getOrder, pendingTransferFor,
  changeStatus, assignOrder, requestTransfer, acceptTransfer, rejectTransfer, cancelTransfer,
};
