'use strict';
/**
 * صادر البريد.
 *
 * المبدأ: **تُكتب الرسالة في القاعدة أولًا ثم يُحاول إرسالها.** لو لم يُضبط
 * SMTP أو فشل الإرسال تبقى الرسالة في الصندوق بحالة `pending`/`failed` ظاهرة
 * في اللوحة، فلا يضيع تقرير مهمّة بصمت لأن الخادم لم يكن مضبوطًا.
 *
 * الضبط:  MAWSOOL_SMTP_URL=smtp://user:pass@host:587
 *         MAWSOOL_MAIL_FROM=ops@mawsool.com.kw
 *         MAWSOOL_MAIL_TO=ops@mawsool.com.kw     (المستلم الافتراضي)
 */
const { db, now } = require('./db');
const ar = require('arabic-kit');
const D = require('./domain');

/* تُقرأ الإعدادات عند الحاجة لا عند التحميل: يبقى الضبط في مكان واحد،
   ويصير مسار الإرسال قابلًا للاختبار بخادم SMTP محلي. */
const smtpUrl = () => process.env.MAWSOOL_SMTP_URL || '';
const mailFrom = () => process.env.MAWSOOL_MAIL_FROM || 'no-reply@mawsool.com.kw';
const mailTo = () => process.env.MAWSOOL_MAIL_TO || '';

let transport = null;
let transportFor = '';
function getTransport() {
  const url = smtpUrl();
  if (!url) return null;
  if (!transport || transportFor !== url) {
    transport = require('nodemailer').createTransport(url);
    transportFor = url;
  }
  return transport;
}

/** هل الإرسال مضبوط أصلًا — تعرضه اللوحة حتى لا يُظنّ أن الرسائل وصلت */
const isConfigured = () => Boolean(smtpUrl() && mailTo());

/* --------------------------- صياغة التقرير --------------------------- */

const line = (label, value) => `${label}: ${value}`;

/**
 * تقرير مهمّة كامل بالعربية: بيانات الطلب، والمبالغ، وحالة مشاركة الموقع،
 * وكل سجل الطلب.
 *
 * **بلا الملاحظة الصوتية**: يُذكر أنها موجودة ومدّتها وأين تُسمع، ولا تُرفق.
 * البريد ليس مكان تخزين تسجيلات، وإرفاقها يُخرج صوت الكابتن من النظام إلى
 * صناديق بريد لا تحكمها صلاحيات النظام.
 */
function buildOrderReport(orderId) {
  const order = D.getOrder(orderId);

  const events = db.prepare(
    `SELECT e.*, a.name AS actor_name FROM events e
       LEFT JOIN agents a ON a.id = e.actor_id
      WHERE e.order_id = ? ORDER BY e.id ASC`
  ).all(orderId);

  const voice = db.prepare(
    'SELECT id, seconds, bytes, created_at FROM voice_notes WHERE order_id=? ORDER BY id ASC'
  ).all(orderId);

  const links = db.prepare(
    'SELECT id, created_at, opened_at, revoked_at FROM delivery_links WHERE order_id=? ORDER BY id ASC'
  ).all(orderId);

  const agent = order.agent_id
    ? db.prepare('SELECT * FROM agents WHERE id=?').get(order.agent_id)
    : null;

  const parts = [];

  parts.push(`تقرير مهمّة — ${order.code}`);
  parts.push('='.repeat(46));
  parts.push('');
  parts.push(line('الحالة', D.STATUSES[order.status] || order.status));
  parts.push(line('العميل', `${order.customer_name} — ${ar.ltr(order.customer_phone)}`));
  parts.push(line('الاستلام', order.pickup_address));
  parts.push(line('التسليم', order.dropoff_address));
  parts.push(line('المحافظة', order.governorate));
  parts.push(line('المركبة', D.VEHICLES[order.vehicle] || order.vehicle));
  if (order.notes) parts.push(line('ملاحظات', order.notes));
  if (order.failure_reason) parts.push(line('سبب التعذّر', order.failure_reason));
  parts.push('');

  parts.push('المبالغ');
  parts.push('-'.repeat(46));
  parts.push(line('التحصيل عند الاستلام', ar.money(order.cod_amount)));
  parts.push(line('رسوم التوصيل', ar.money(order.delivery_fee)));
  parts.push(line('عمولة موصول', ar.money(order.commission_amount)));
  parts.push(line('مستحقّ الكابتن', ar.money(order.agent_earning)));
  parts.push('');

  if (agent) {
    parts.push('الكابتن');
    parts.push('-'.repeat(46));
    parts.push(line('الاسم', agent.name));
    parts.push(line('الهاتف', ar.ltr(agent.phone || '—')));
    parts.push(line('حالة الاعتماد', D.APPROVAL[agent.approval] || agent.approval));
    parts.push(line('موافقة مشاركة الموقع', agent.location_consent ? 'ممنوحة' : 'غير ممنوحة'));
    parts.push(line('المشاركة الآن', agent.location_sharing ? 'مفعّلة' : 'متوقّفة'));
    parts.push('');
  }

  if (links.length) {
    parts.push('روابط المهمّة');
    parts.push('-'.repeat(46));
    for (const l of links) {
      const state = l.revoked_at ? 'ملغى' : 'سارٍ';
      const opened = l.opened_at ? `فُتح ${ar.dateTime(l.opened_at)}` : 'لم يُفتح';
      parts.push(`• أُنشئ ${ar.dateTime(l.created_at)} — ${state} — ${opened}`);
    }
    parts.push('');
  }

  parts.push('الملاحظات الصوتية');
  parts.push('-'.repeat(46));
  if (!voice.length) {
    parts.push('لا توجد.');
  } else {
    for (const v of voice) {
      parts.push(`• ${ar.dateTime(v.created_at)} — ${ar.plural(Math.round(v.seconds), 'second')}`);
    }
    parts.push('');
    parts.push('التسجيلات غير مرفقة بهذه الرسالة عمدًا — تُسمع من لوحة النظام');
    parts.push('في صفحة الطلب. البريد ليس مكان حفظ تسجيلات الكباتن.');
  }
  parts.push('');

  parts.push('سجل الطلب');
  parts.push('-'.repeat(46));
  for (const e of events) {
    const who = e.actor_name || 'النظام';
    const move = e.from_value && e.to_value ? `${e.from_value} ← ${e.to_value}`
      : (e.to_value || e.from_value || '');
    parts.push(`• ${ar.dateTime(e.created_at)} — ${e.type}${move ? ` (${move})` : ''} — ${who}`);
    if (e.note) parts.push(`    ${e.note}`);
  }
  parts.push('');
  parts.push('-'.repeat(46));
  parts.push(`أُنشئ التقرير: ${ar.dateTime(new Date())}`);

  return {
    subject: `موصول — تقرير مهمّة ${order.code} (${D.STATUSES[order.status] || order.status})`,
    body: parts.join('\n'),
  };
}

/* ------------------------------ الإرسال ------------------------------ */

/** يضع رسالة في الصندوق ثم يحاول إرسالها. لا يرمي — فشل البريد لا يُفشل المهمّة. */
async function queueAndSend({ to, subject, body, orderId = null }) {
  const address = to || mailTo();
  if (!address) {
    // لا مستلم مضبوط: تُحفظ الرسالة بلا عنوان حتى تظهر الحاجة في اللوحة
    const info = db.prepare(
      `INSERT INTO emails (to_address, subject, body, order_id, status, error, created_at)
       VALUES ('', ?, ?, ?, 'failed', ?, ?)`
    ).run(subject, body, orderId, 'لم يُضبط MAWSOOL_MAIL_TO', now());
    return { id: Number(info.lastInsertRowid), status: 'failed', sent: false };
  }

  const info = db.prepare(
    `INSERT INTO emails (to_address, subject, body, order_id, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(address, subject, body, orderId, now());
  const id = Number(info.lastInsertRowid);

  return send(id);
}

/** يحاول إرسال رسالة من الصندوق ويحدّث حالتها */
async function send(id) {
  const row = db.prepare('SELECT * FROM emails WHERE id=?').get(id);
  if (!row) return { id, status: 'failed', sent: false };
  if (row.status === 'sent') return { id, status: 'sent', sent: true };

  const tx = getTransport();
  if (!tx || !row.to_address) {
    db.prepare('UPDATE emails SET attempts = attempts + 1, error = ? WHERE id = ?')
      .run(tx ? 'لا يوجد عنوان مستلم' : 'لم يُضبط MAWSOOL_SMTP_URL — الرسالة محفوظة في الصندوق', id);
    return { id, status: 'pending', sent: false };
  }

  try {
    await tx.sendMail({
      from: mailFrom(),
      to: row.to_address,
      subject: row.subject,
      text: row.body, // نصّ فقط، وبلا مرفقات — لا تُرفق التسجيلات الصوتية
    });
    db.prepare("UPDATE emails SET status='sent', sent_at=?, error='', attempts=attempts+1 WHERE id=?")
      .run(now(), id);
    return { id, status: 'sent', sent: true };
  } catch (err) {
    db.prepare("UPDATE emails SET status='failed', error=?, attempts=attempts+1 WHERE id=?")
      .run(String(err.message || err).slice(0, 400), id);
    return { id, status: 'failed', sent: false, error: String(err.message || err) };
  }
}

/** يعيد محاولة كل ما لم يُرسل — يستدعيه المدير من اللوحة */
async function retryPending() {
  const rows = db.prepare("SELECT id FROM emails WHERE status IN ('pending','failed') ORDER BY id").all();
  const out = [];
  for (const r of rows) out.push(await send(r.id));
  return out;
}

/** الصندوق للوحة المدير */
function outbox(limit = 50) {
  return db.prepare(
    `SELECT e.id, e.to_address, e.subject, e.status, e.error, e.attempts,
            e.created_at, e.sent_at, o.code AS order_code
       FROM emails e LEFT JOIN orders o ON o.id = e.order_id
      ORDER BY e.id DESC LIMIT ?`
  ).all(limit);
}

const getEmail = (id) => db.prepare('SELECT * FROM emails WHERE id=?').get(id);

/** يبني تقرير المهمّة ويضعه في الصندوق ويحاول إرساله */
async function sendOrderReport(orderId, to) {
  const { subject, body } = buildOrderReport(orderId);
  return queueAndSend({ to, subject, body, orderId });
}

module.exports = {
  isConfigured, mailTo, mailFrom,
  buildOrderReport, queueAndSend, send, retryPending, outbox, getEmail, sendOrderReport,
};
