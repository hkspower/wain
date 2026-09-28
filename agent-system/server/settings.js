'use strict';
/**
 * الإعدادات التشغيلية التي يضبطها مدير العمليات من لوحة التحكم.
 *
 * أهمّها **عمولة الوساطة**: موصول وسيط بين الكابتن والزبون، فالعمولة هي دخل
 * المنصّة والباقي مستحقّ للكابتن. لذلك:
 *   • تُضبط من اللوحة لا من الكود.
 *   • كل تغيير يُسجَّل بمن غيّره ومتى ومن أي قيمة.
 *   • **تُلتقط على الطلب وقت إنشائه** — تغييرها لاحقًا لا يعيد حساب طلبات
 *     سابقة اتُّفق على عمولتها.
 */
const { db, now } = require('./db');
const { badRequest, oneOf, num } = require('./lib/http');
const ar = require('arabic-kit');

/** فلس واحد هو أصغر وحدة في الدينار الكويتي (ثلاث خانات عشرية) */
const round3 = (v) => Math.round((Number(v) + Number.EPSILON) * 1000) / 1000;

const COMMISSION_TYPES = {
  percent: 'نسبة من رسوم التوصيل',
  fixed:   'مبلغ ثابت لكل طلب',
};

/** تعريف كل إعداد: قيمته الافتراضية وكيف يُتحقّق منه */
const DEFINITIONS = {
  commission_type: {
    label: 'نوع العمولة',
    default: 'percent',
    parse: (v) => oneOf(v, 'نوع العمولة', Object.keys(COMMISSION_TYPES)),
  },
  commission_rate: {
    label: 'قيمة العمولة',
    default: '20',
    // النسبة ٠–١٠٠٪ والمبلغ الثابت ٠–١٠٠ د.ك؛ الحدّ الأعلى مشترك ويكفي للحالتين
    parse: (v) => String(round3(num(v, 'قيمة العمولة', { min: 0, max: 100 }))),
  },
};

const readRaw = (key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;

/** قيمة إعداد كنص، وإن لم تُضبط بعد فالقيمة الافتراضية */
function get(key) {
  const def = DEFINITIONS[key];
  if (!def) throw badRequest('إعداد غير معروف');
  const raw = readRaw(key);
  return raw == null ? def.default : raw;
}

/** كل الإعدادات دفعة واحدة، بقيمها الفعلية أو الافتراضية */
function all() {
  const out = {};
  for (const key of Object.keys(DEFINITIONS)) out[key] = get(key);
  return out;
}

/** كتابة قيمة إعداد بلا تسجيل — يستدعيها من يتولّى التسجيل بنفسه */
function writeSetting(key, value, actor) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,
       updated_at=excluded.updated_at, updated_by=excluded.updated_by`
  ).run(key, value, now(), actor?.id ?? null);
}

/** ضبط إعداد مفرد مع تسجيل من غيّره ومن أي قيمة */
function set(key, value, actor, note = '') {
  const def = DEFINITIONS[key];
  if (!def) throw badRequest('إعداد غير معروف');
  const next = def.parse(value);
  const previous = get(key);

  const run = db.transaction(() => {
    writeSetting(key, next, actor);
    if (previous !== next) {
      db.prepare(
        `INSERT INTO setting_events (key, actor_id, from_value, to_value, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(key, actor?.id ?? null, previous, next, String(note || ''), now());
    }
  });
  run();
  return next;
}

/** سجل تغييرات إعداد، الأحدث أولًا */
function history(key, limit = 50) {
  return db.prepare(
    `SELECT e.*, a.name AS actor_name FROM setting_events e
       LEFT JOIN agents a ON a.id = e.actor_id
      WHERE e.key = ? ORDER BY e.id DESC LIMIT ?`
  ).all(key, limit);
}

/**
 * حساب العمولة على رسوم توصيل. يعيد لقطة كاملة تُحفظ على الطلب.
 * العمولة لا تتجاوز رسوم التوصيل أبدًا — لا يجوز أن يخرج الكابتن بمستحقّ سالب.
 */
function commissionFor(deliveryFee, override) {
  const fee = round3(Math.max(0, Number(deliveryFee) || 0));
  const type = override?.type || get('commission_type');
  const rate = Number(override?.rate ?? get('commission_rate'));

  const raw = type === 'fixed' ? rate : fee * (rate / 100);
  const amount = round3(Math.min(fee, Math.max(0, raw)));

  return {
    commission_type: type,
    commission_rate: round3(rate),
    commission_amount: amount,
    agent_earning: round3(fee - amount),
  };
}

/**
 * صيغة العمولة مقروءة: «٢٠٪» أو «٠٫٤٠٠ د.ك».
 * النوع والقيمة لا ينفصلان — «٢٠» وحدها لا معنى لها في السجل.
 */
function formatCommission(type, rate) {
  return type === 'fixed' ? ar.money(rate) : ar.percent(rate);
}

/** وصف مقروء للعمولة الحالية — للوحة التحكم */
function describeCommission() {
  const type = get('commission_type');
  const rate = Number(get('commission_rate'));
  return { type, rate, label: COMMISSION_TYPES[type], text: formatCommission(type, rate) };
}

/**
 * ضبط العمولة نوعًا وقيمةً معًا، وتسجيلها **مدخلة واحدة مقروءة** في السجل.
 * تسجيل المفتاحين منفصلين كان ينتج «٠٫٤ من ٢٠» — قيمتان بوحدتين مختلفتين
 * بلا سياق يربطهما.
 */
function setCommission({ type, rate }, actor, note = '') {
  const before = describeCommission();
  const nextType = type == null ? before.type : DEFINITIONS.commission_type.parse(type);
  const nextRate = rate == null ? String(before.rate) : DEFINITIONS.commission_rate.parse(rate);
  const afterText = formatCommission(nextType, Number(nextRate));

  if (afterText === before.text) throw badRequest('العمولة على هذه القيمة أصلًا');

  const run = db.transaction(() => {
    writeSetting('commission_type', nextType, actor);
    writeSetting('commission_rate', nextRate, actor);
    db.prepare(
      `INSERT INTO setting_events (key, actor_id, from_value, to_value, note, created_at)
       VALUES ('commission', ?, ?, ?, ?, ?)`
    ).run(actor?.id ?? null, before.text, afterText, String(note || ''), now());
  });
  run();
  return describeCommission();
}

module.exports = {
  COMMISSION_TYPES, DEFINITIONS,
  get, all, set, setCommission, history, commissionFor,
  describeCommission, formatCommission, round3,
};
