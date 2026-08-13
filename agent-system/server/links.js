'use strict';
/**
 * روابط المهام: رابط واحد يُرسل للكابتن على واتساب لكل طلب.
 *
 * سببه أن الكابتن شريك لا موظّف — قد لا يفتح لوحة النظام أصلًا. الرابط يعطيه
 * صفحة واحدة بلا تسجيل دخول يفعل فيها ثلاثة أشياء لا رابع لها:
 *   ١. يوافق على مشاركة موقعه المباشر (أو يرفض/يوقف).
 *   ٢. يرسل ملاحظة صوتية للإدارة.
 *   ٣. يبلّغ نتيجة التسليم: تم · لم يُسلَّم بعد · تعذّر.
 *
 * حدود الرابط مقصودة: مربوط بطلب واحد وكابتن واحد، ينتهي بمدة، ويُلغى فورًا
 * إذا انتهى الطلب أو انتقل لكابتن آخر — فلا يبقى مفتاح سارٍ بلا سبب.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { db, now, logEvent, DATA_DIR } = require('./db');
const { badRequest, notFound, conflict, forbidden } = require('./lib/http');
const D = require('./domain');
const L = require('./location');

/** مدة صلاحية الرابط — مهمّة توصيل تنتهي في يومها */
const LINK_HOURS = Math.max(1, Number(process.env.MAWSOOL_LINK_HOURS) || 12);

/** حدّ حجم الملاحظة الصوتية */
const VOICE_MAX_BYTES = Math.max(64 * 1024, Number(process.env.MAWSOOL_VOICE_MAX_BYTES) || 4 * 1024 * 1024);

/** أطول مدة تسجيل مقبولة بالثواني */
const VOICE_MAX_SECONDS = 180;

const VOICE_DIR = path.join(DATA_DIR, 'voice');
fs.mkdirSync(VOICE_DIR, { recursive: true });

/** صيغ الصوت المقبولة — ما تنتجه المتصفحات فعليًا */
const VOICE_MIME = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
};

/** نتائج التسليم التي يبلّغ بها الكابتن من الرابط */
const OUTCOMES = {
  delivered: 'تم التسليم',
  not_yet:   'لم يُسلَّم بعد',
  failed:    'تعذّر التسليم',
};

/* --------------------------- إنشاء الرابط --------------------------- */

/** ينشئ رابط مهمّة للطلب وكابتنه الحالي، ويُلغي أي رابط سابق سارٍ عليه */
function createLink(orderId, actor) {
  if (actor.role !== 'admin') throw forbidden('إنشاء روابط المهام لمدير العمليات فقط');

  const run = db.transaction(() => {
    const order = D.getOrder(orderId);
    if (!order.agent_id) throw conflict('الطلب غير مُسند لكابتن بعد');
    if (D.FINAL_STATUSES.includes(order.status)) throw conflict('الطلب منتهٍ — لا حاجة لرابط');

    // رابط واحد سارٍ لكل طلب: القديم يُلغى فلا يبقى مفتاحان لبابٍ واحد
    db.prepare(
      "UPDATE delivery_links SET revoked_at=? WHERE order_id=? AND revoked_at IS NULL"
    ).run(now(), orderId);

    const token = crypto.randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + LINK_HOURS * 3600_000).toISOString();

    const info = db.prepare(
      `INSERT INTO delivery_links (token, order_id, agent_id, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(token, orderId, order.agent_id, actor.id, now(), expires);

    logEvent({
      orderId, actorId: actor.id, type: 'link_created',
      to: db.prepare('SELECT name FROM agents WHERE id=?').get(order.agent_id).name,
    });

    return db.prepare('SELECT * FROM delivery_links WHERE id=?').get(info.lastInsertRowid);
  });
  return run();
}

/** يُلغي رابطًا يدويًا */
function revokeLink(linkId, actor) {
  if (actor.role !== 'admin') throw forbidden('إلغاء روابط المهام لمدير العمليات فقط');
  const link = db.prepare('SELECT * FROM delivery_links WHERE id=?').get(linkId);
  if (!link) throw notFound('الرابط غير موجود');
  if (link.revoked_at) throw conflict('الرابط ملغى أصلًا');
  db.prepare('UPDATE delivery_links SET revoked_at=? WHERE id=?').run(now(), linkId);
  logEvent({ orderId: link.order_id, actorId: actor.id, type: 'link_revoked' });
  return db.prepare('SELECT * FROM delivery_links WHERE id=?').get(linkId);
}

/**
 * يتحقّق من رمز الرابط ويعيد سياقه. كل أسباب الرفض تُميَّز برمز حتى تعرض
 * الصفحة رسالة دقيقة بدل «رابط غير صالح» الغامضة.
 */
function resolve(token) {
  const link = db.prepare('SELECT * FROM delivery_links WHERE token=?').get(String(token || ''));
  if (!link) throw notFound('رابط غير معروف', 'link_unknown');
  if (link.revoked_at) throw forbidden('أُلغي هذا الرابط', 'link_revoked');
  if (new Date(link.expires_at).getTime() < Date.now()) {
    throw forbidden('انتهت صلاحية الرابط — اطلب رابطًا جديدًا', 'link_expired');
  }

  const order = D.getOrder(link.order_id);
  if (order.agent_id !== link.agent_id) {
    throw forbidden('انتقل الطلب إلى كابتن آخر', 'link_reassigned');
  }
  if (D.FINAL_STATUSES.includes(order.status)) {
    throw forbidden('انتهى هذا الطلب', 'link_finished');
  }

  const agent = db.prepare('SELECT * FROM agents WHERE id=?').get(link.agent_id);
  return { link, order, agent };
}

/** يسجّل أن الكابتن فتح الرابط */
function touch(link) {
  db.prepare('UPDATE delivery_links SET opened_at = COALESCE(opened_at, ?), last_seen_at = ? WHERE id = ?')
    .run(now(), now(), link.id);
}

/** ما تعرضه صفحة الرابط — الحدّ الأدنى الذي يحتاجه الكابتن، بلا بيانات زائدة */
function context(token) {
  const { link, order, agent } = resolve(token);
  touch(link);
  const voice = db.prepare(
    'SELECT id, seconds, created_at FROM voice_notes WHERE order_id=? ORDER BY id DESC'
  ).all(order.id);

  return {
    order: {
      code: order.code,
      status: order.status,
      status_label: D.STATUSES[order.status],
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      pickup_address: order.pickup_address,
      dropoff_address: order.dropoff_address,
      governorate: order.governorate,
      cod_amount: order.cod_amount,
      agent_earning: order.agent_earning,
      notes: order.notes,
      priority: order.priority,
    },
    agent: { name: agent.name, consent: !!agent.location_consent, sharing: !!agent.location_sharing },
    outcomes: OUTCOMES,
    voice_notes: voice,
    expires_at: link.expires_at,
  };
}

/* --------------------------- موافقة الموقع --------------------------- */

/** الكابتن يمنح موافقة الموقع أو يسحبها من الرابط — بنفس قواعد الشاشة الداخلية */
function setConsent(token, granted) {
  const { link, agent } = resolve(token);
  touch(link);
  if (typeof granted !== 'boolean') throw badRequest('يجب تحديد الموافقة صراحةً');
  const result = L.setConsent(agent, granted);
  logEvent({
    orderId: link.order_id, actorId: agent.id,
    type: granted ? 'link_consent_granted' : 'link_consent_revoked',
  });
  return result;
}

/** إيقاف/استئناف المشاركة مؤقتًا من الرابط */
function setSharing(token, on) {
  const { link, agent } = resolve(token);
  touch(link);
  if (typeof on !== 'boolean') throw badRequest('يجب تحديد حالة المشاركة');
  return L.setSharing(agent, on);
}

/** تسجيل نقطة موقع من الرابط */
function recordPoint(token, point) {
  const { link, agent } = resolve(token);
  touch(link);
  return L.recordPoint(agent, point);
}

/* -------------------------- الملاحظة الصوتية -------------------------- */

/** يحفظ ملاحظة صوتية من الكابتن. الملف على القرص والبيانات في القاعدة. */
function saveVoiceNote(token, buffer, mime, seconds) {
  const { link, order, agent } = resolve(token);
  touch(link);

  const ext = VOICE_MIME[String(mime || '').split(';')[0].trim()];
  if (!ext) throw badRequest('صيغة صوت غير مدعومة', 'voice_mime');
  if (!buffer || !buffer.length) throw badRequest('التسجيل فارغ', 'voice_empty');
  if (buffer.length > VOICE_MAX_BYTES) throw badRequest('التسجيل أكبر من الحد المسموح', 'voice_too_big');

  const secs = Math.max(0, Math.min(VOICE_MAX_SECONDS, Number(seconds) || 0));
  const filename = `${order.code}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(VOICE_DIR, filename), buffer);

  const info = db.prepare(
    `INSERT INTO voice_notes (order_id, agent_id, link_id, filename, mime, bytes, seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(order.id, agent.id, link.id, filename, mime, buffer.length, secs, now());

  logEvent({
    orderId: order.id, actorId: agent.id, type: 'voice_note',
    note: `ملاحظة صوتية (${Math.round(secs)} ث)`,
  });

  return db.prepare('SELECT id, seconds, bytes, created_at FROM voice_notes WHERE id=?')
    .get(info.lastInsertRowid);
}

/** مسار ملف ملاحظة صوتية — للمدير أو لصاحبها فقط */
function voiceFile(voiceId, viewer) {
  const row = db.prepare('SELECT * FROM voice_notes WHERE id=?').get(voiceId);
  if (!row) throw notFound('الملاحظة الصوتية غير موجودة');
  if (viewer.role !== 'admin' && row.agent_id !== viewer.id) {
    throw forbidden('لا تملك صلاحية سماع هذه الملاحظة');
  }
  const full = path.join(VOICE_DIR, row.filename);
  if (!fs.existsSync(full)) throw notFound('ملف الملاحظة مفقود');
  return { ...row, path: full };
}

/* --------------------------- نتيجة التسليم --------------------------- */

/**
 * الكابتن يبلّغ نتيجة المهمّة من الرابط:
 *   • تم التسليم    ← ينقل الطلب إلى `delivered`
 *   • تعذّر التسليم  ← ينقله إلى `failed` ويشترط سببًا
 *   • لم يُسلَّم بعد  ← **لا يغيّر الحالة**، يسجّل تحديثًا فقط ويبقى الطلب نشطًا
 *
 * «لم يُسلَّم بعد» ليست حالة في دورة حياة الطلب بل تطمين من الكابتن أنه ما زال
 * عليها — إدخالها حالةً كان سيكسر تسلسل الحالات بلا فائدة.
 */
function reportOutcome(token, outcome, note = '') {
  const { link, order, agent } = resolve(token);
  touch(link);
  if (!OUTCOMES[outcome]) throw badRequest('نتيجة غير معروفة');

  const text = String(note || '').trim().slice(0, 500);

  if (outcome === 'not_yet') {
    if (!text) throw badRequest('اكتب سببًا مختصرًا لتأخّر التسليم', 'note_required');
    logEvent({ orderId: order.id, actorId: agent.id, type: 'progress', to: 'not_yet', note: text });
    db.prepare('UPDATE orders SET updated_at=? WHERE id=?').run(now(), order.id);
    return { order: D.getOrder(order.id), outcome, changed_status: false };
  }

  // «تم التسليم» و«تعذّر التسليم» تمرّان بآلة الحالات نفسها التي تحكم اللوحة،
  // فالقفزات الممنوعة واشتراط سبب التعذّر مفروضة هنا أيضًا بلا تكرار قواعد.
  const updated = D.changeStatus(order.id, agent, outcome, text, { allowJump: true });
  logEvent({ orderId: order.id, actorId: agent.id, type: 'reported_via_link', to: outcome });
  if (outcome === 'delivered' || outcome === 'failed') {
    db.prepare('UPDATE delivery_links SET revoked_at=? WHERE id=? AND revoked_at IS NULL')
      .run(now(), link.id);
  }
  return { order: updated, outcome, changed_status: true };
}

/** روابط طلب معيّن — للوحة المدير */
function linksForOrder(orderId) {
  return db.prepare(
    `SELECT l.*, a.name AS agent_name FROM delivery_links l
       LEFT JOIN agents a ON a.id = l.agent_id
      WHERE l.order_id = ? ORDER BY l.id DESC`
  ).all(orderId);
}

module.exports = {
  LINK_HOURS, VOICE_MAX_BYTES, VOICE_MAX_SECONDS, VOICE_MIME, OUTCOMES, VOICE_DIR,
  createLink, revokeLink, resolve, context, linksForOrder,
  setConsent, setSharing, recordPoint,
  saveVoiceNote, voiceFile, reportOutcome,
};
