'use strict';
/**
 * صادر الأحداث — يدفع ما يجري في النظام إلى وجهة خارجية (n8n).
 *
 * لماذا يدفع النظام بدل أن يسأل n8n:
 *   • الفوري يهمّ. رابط المهمّة يجب أن يصل الكابتن لحظة إسناد الطلب لا بعد
 *     دورة استطلاع.
 *   • الاستطلاع يحتاج مفتاح مدير دائمًا في n8n يقرأ كل شيء. الدفع يرسل ما
 *     يخصّ الحدث وحده، فلا يوجد مفتاح مقيم بصلاحية كاملة.
 *
 * التوقيع: كل طلب يحمل `X-Mawsool-Signature: sha256=<hmac>` على
 * «الطابع.الجسم»، و`X-Mawsool-Timestamp`. الطابع داخل التوقيع يمنع إعادة بثّ
 * طلب قديم مُلتقَط، والمقارنة عند المستقبل يجب أن تكون ثابتة الزمن.
 *
 * الفشل لا يُفشل العملية: الطلب يُكتب في الصندوق أولًا، فإن تعذّر الإرسال
 * بقي `pending`/`failed` ظاهرًا وأُعيدت محاولته — كما يفعل البريد تمامًا.
 */
const crypto = require('node:crypto');
const { db, now } = require('./db');

/* تُقرأ عند كل استدعاء لا عند التحميل: الاختبارات تضبط البيئة بعد الاستيراد */
const url = () => String(process.env.MAWSOOL_WEBHOOK_URL || '').trim();
const secret = () => String(process.env.MAWSOOL_WEBHOOK_SECRET || '').trim();

/* ترويسة مصادقة ثابتة اختيارية.
   المستقبل (n8n) يتحقّق منها بنظام الاعتمادات عنده، فيبقى السرّ في خزنة
   الاعتمادات لا مكتوبًا داخل تعريف سير العمل. التوقيع يبقى محسوبًا على كل
   طلب لمن يريد تحقّقًا أعمق من مجرّد «من الطالب». */
const authHeader = () => String(process.env.MAWSOOL_WEBHOOK_AUTH_HEADER || 'Authorization').trim();
const authValue = () => String(process.env.MAWSOOL_WEBHOOK_AUTH_VALUE || '').trim();

/** العنوان العام الذي تُبنى منه روابط المهام في الرسائل الخارجة */
const publicUrl = () =>
  String(process.env.MAWSOOL_PUBLIC_URL || '').trim().replace(/\/+$/, '');

const isConfigured = () => Boolean(url());

/** مهلة قصيرة: الوجهة الخارجية لا يجوز أن تعلّق طلب المدير */
const TIMEOUT_MS = Math.max(1000, Number(process.env.MAWSOOL_WEBHOOK_TIMEOUT_MS) || 8000);

/** يوقّع الجسم بالطابع الزمني معًا */
function sign(timestamp, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret())
    .update(`${timestamp}.${body}`).digest('hex');
}

/**
 * يضع حدثًا في الصندوق ثم يحاول دفعه. لا يرمي أبدًا.
 * يعيد `{ id, status }` أو `null` إن لم تُضبط وجهة أصلًا.
 */
async function emit(event, payload, orderId = null) {
  if (!isConfigured()) return null;

  const body = JSON.stringify({ event, sent_at: now(), data: payload });
  const info = db.prepare(
    `INSERT INTO webhook_deliveries (event, payload, order_id, url, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(event, body, orderId, url(), now());

  return deliver(Number(info.lastInsertRowid));
}

/** يحاول دفع حدث من الصندوق ويحدّث حالته */
async function deliver(id) {
  const row = db.prepare('SELECT * FROM webhook_deliveries WHERE id=?').get(id);
  if (!row) return { id, status: 'failed' };
  if (row.status === 'sent') return { id, status: 'sent' };

  if (!secret()) {
    db.prepare("UPDATE webhook_deliveries SET status='failed', error=?, attempts=attempts+1 WHERE id=?")
      .run('لم يُضبط MAWSOOL_WEBHOOK_SECRET — لا يُرسل حدث بلا توقيع', id);
    return { id, status: 'failed' };
  }

  const timestamp = String(Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(row.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mawsool-Event': row.event,
        'X-Mawsool-Timestamp': timestamp,
        'X-Mawsool-Signature': sign(timestamp, row.payload),
        ...(authValue() ? { [authHeader()]: authValue() } : {}),
      },
      body: row.payload,
      signal: controller.signal,
    });

    if (res.ok) {
      db.prepare("UPDATE webhook_deliveries SET status='sent', http_status=?, sent_at=?, attempts=attempts+1, error='' WHERE id=?")
        .run(res.status, now(), id);
      return { id, status: 'sent', http_status: res.status };
    }
    db.prepare("UPDATE webhook_deliveries SET status='failed', http_status=?, error=?, attempts=attempts+1 WHERE id=?")
      .run(res.status, `ردّت الوجهة ${res.status}`, id);
    return { id, status: 'failed', http_status: res.status };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? `تجاوز المهلة (${TIMEOUT_MS} م.ث)` : String(err?.message || err);
    db.prepare("UPDATE webhook_deliveries SET status='failed', error=?, attempts=attempts+1 WHERE id=?")
      .run(msg, id);
    return { id, status: 'failed', error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** يعيد محاولة كل ما لم يصل — تستدعيها اللوحة أو مهمّة دورية */
async function retryPending(limit = 50) {
  const rows = db.prepare(
    "SELECT id FROM webhook_deliveries WHERE status IN ('pending','failed') ORDER BY id LIMIT ?"
  ).all(limit);
  const out = [];
  for (const r of rows) out.push(await deliver(r.id));
  return out;
}

/** آخر ما صدر — للوحة */
function outbox(limit = 50) {
  return db.prepare(
    `SELECT id, event, order_id, status, http_status, error, attempts, created_at, sent_at
       FROM webhook_deliveries ORDER BY id DESC LIMIT ?`
  ).all(limit);
}

module.exports = { emit, deliver, retryPending, outbox, isConfigured, publicUrl, sign, authHeader, authValue };
