'use strict';
/**
 * تتبّع موقع المندوب — قواعد الخصوصية مفروضة هنا لا في الواجهة.
 *
 * المبادئ:
 *  1. لا يُسجَّل أي موقع بلا موافقة صريحة من المندوب نفسه.
 *  2. الموافقة يمنحها المندوب فقط — لا المدير ولا أي حساب آخر.
 *  3. المشاركة تتوقف بضغطة واحدة، والموافقة تُسحب بضغطة واحدة.
 *  4. سحب الموافقة يمسح كل النقاط المخزّنة فورًا.
 *  5. النقاط تُحذف تلقائيًا بعد مدة الاحتفاظ (افتراضيًا ٢٤ ساعة).
 *  6. كل اطّلاع من المدير على موقع مندوب يُسجَّل ويظهر للمندوب.
 */
const { db, now } = require('./db');
const { badRequest, forbidden, notFound } = require('./lib/http');

/** مدة الاحتفاظ بالنقاط بالساعات */
const RETENTION_HOURS = Number(process.env.MAWSOOL_LOCATION_RETENTION_HOURS) || 24;
/** بعد هذه المدة يُعتبر آخر موقع قديمًا ولا يُعرض كموقع حالي */
const STALE_MINUTES = 10;
/** أقل فاصل زمني بين نقطتين مقبولتين — يمنع إغراق القاعدة */
const MIN_INTERVAL_MS = 8000;

/** الحالات التي يكون فيها المندوب في مهمة فعلية */
const ON_DUTY_STATUSES = ['accepted', 'picked_up', 'on_the_way'];

const isoMinutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

/* ------------------------------ الموافقة ------------------------------ */

function consentState(agent) {
  const row = db.prepare(
    'SELECT location_consent, location_consent_at, location_sharing FROM agents WHERE id = ?'
  ).get(agent.id);

  const lastPoint = db.prepare(
    'SELECT recorded_at FROM locations WHERE agent_id = ? ORDER BY id DESC LIMIT 1'
  ).get(agent.id);

  const points = db.prepare('SELECT COUNT(*) AS n FROM locations WHERE agent_id = ?').get(agent.id).n;

  const views = db.prepare(
    `SELECT v.viewed_at, a.name AS viewer_name
       FROM location_views v JOIN agents a ON a.id = v.viewer_id
      WHERE v.agent_id = ? ORDER BY v.id DESC LIMIT 10`
  ).all(agent.id);

  return {
    consent: !!row.location_consent,
    consent_at: row.location_consent_at,
    sharing: !!row.location_sharing,
    stored_points: points,
    last_point_at: lastPoint ? lastPoint.recorded_at : null,
    retention_hours: RETENTION_HOURS,
    recent_views: views,
  };
}

/** المندوب يمنح الموافقة أو يسحبها — لا أحد غيره */
function setConsent(agent, granted) {
  if (agent.role !== 'agent') {
    throw forbidden('موافقة مشاركة الموقع تخصّ المندوبين فقط');
  }

  const run = db.transaction(() => {
    if (granted) {
      db.prepare(
        'UPDATE agents SET location_consent = 1, location_consent_at = ?, location_sharing = 1 WHERE id = ?'
      ).run(now(), agent.id);
    } else {
      // سحب الموافقة يوقف المشاركة ويمسح كل ما سُجّل
      db.prepare(
        'UPDATE agents SET location_consent = 0, location_consent_at = NULL, location_sharing = 0 WHERE id = ?'
      ).run(agent.id);
      db.prepare('DELETE FROM locations WHERE agent_id = ?').run(agent.id);
    }
    return consentState(agent);
  });
  return run();
}

/** إيقاف/استئناف المشاركة مؤقتًا دون سحب الموافقة */
function setSharing(agent, sharing) {
  const row = db.prepare('SELECT location_consent FROM agents WHERE id = ?').get(agent.id);
  if (sharing && !row.location_consent) {
    throw forbidden('لا يمكن تشغيل المشاركة قبل منح الموافقة', 'consent_required');
  }
  db.prepare('UPDATE agents SET location_sharing = ? WHERE id = ?').run(sharing ? 1 : 0, agent.id);
  return consentState(agent);
}

/** المندوب يمسح سجلّ مواقعه دون سحب الموافقة */
function purgeOwnHistory(agent) {
  const info = db.prepare('DELETE FROM locations WHERE agent_id = ?').run(agent.id);
  return { deleted: info.changes, ...consentState(agent) };
}

/* ------------------------------ التسجيل ------------------------------ */

function recordPoint(agent, point) {
  const row = db.prepare('SELECT location_consent, location_sharing FROM agents WHERE id = ?').get(agent.id);
  if (!row.location_consent) throw forbidden('لم تُمنح موافقة مشاركة الموقع', 'consent_required');
  if (!row.location_sharing) throw forbidden('مشاركة الموقع متوقفة حاليًا', 'sharing_off');

  const lat = Number(point.lat);
  const lng = Number(point.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw badRequest('قيمة خط العرض غير صحيحة');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw badRequest('قيمة خط الطول غير صحيحة');

  // تقييد المعدّل: نتجاهل النقطة إن وصلت قبل انقضاء الفاصل الأدنى
  const last = db.prepare(
    'SELECT recorded_at FROM locations WHERE agent_id = ? ORDER BY id DESC LIMIT 1'
  ).get(agent.id);
  if (last && Date.now() - new Date(last.recorded_at).getTime() < MIN_INTERVAL_MS) {
    return { recorded: false, reason: 'too_soon' };
  }

  // نربط النقطة بالطلب النشط إن وُجد، ليكون للمسار معنى تشغيلي
  const active = db.prepare(
    `SELECT id FROM orders
      WHERE agent_id = ? AND status IN (${ON_DUTY_STATUSES.map(() => '?').join(',')})
      ORDER BY updated_at DESC LIMIT 1`
  ).get(agent.id, ...ON_DUTY_STATUSES);

  const num = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };

  db.prepare(
    `INSERT INTO locations (agent_id, lat, lng, accuracy, speed, heading, order_id, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    agent.id, lat, lng,
    num(point.accuracy, 0, 100000),
    num(point.speed, 0, 400),
    num(point.heading, 0, 360),
    active ? active.id : null,
    now()
  );

  purgeExpired();
  return { recorded: true, order_id: active ? active.id : null };
}

/** حذف النقاط الأقدم من مدة الاحتفاظ */
function purgeExpired() {
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 3600_000).toISOString();
  return db.prepare('DELETE FROM locations WHERE recorded_at < ?').run(cutoff).changes;
}

/* ------------------------------ الاطّلاع ------------------------------ */

function latestFor(agentId) {
  const row = db.prepare(
    `SELECT l.*, o.code AS order_code
       FROM locations l LEFT JOIN orders o ON o.id = l.order_id
      WHERE l.agent_id = ? ORDER BY l.id DESC LIMIT 1`
  ).get(agentId);
  if (!row) return null;
  const ageMin = (Date.now() - new Date(row.recorded_at).getTime()) / 60000;
  return { ...row, age_minutes: Math.round(ageMin * 10) / 10, stale: ageMin > STALE_MINUTES };
}

function logView(viewerId, agentId) {
  if (viewerId === agentId) return;
  // نسجّل اطّلاعًا واحدًا كل خمس دقائق لكل مشاهد حتى لا يمتلئ السجل بالتحديث الدوري
  const recent = db.prepare(
    'SELECT 1 FROM location_views WHERE viewer_id = ? AND agent_id = ? AND viewed_at > ?'
  ).get(viewerId, agentId, isoMinutesAgo(5));
  if (recent) return;
  db.prepare('INSERT INTO location_views (viewer_id, agent_id, viewed_at) VALUES (?, ?, ?)')
    .run(viewerId, agentId, now());
}

/**
 * موقع مندوب واحد — يعيد سبب عدم التوفّر بدل قيمة فارغة غامضة،
 * فيعرف المدير أن المندوب لم يوافق بدل أن يظن أن النظام معطّل.
 */
function locationOf(viewer, agentId) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) throw notFound('المندوب غير موجود');
  if (viewer.role !== 'admin' && viewer.id !== agent.id) {
    throw forbidden('لا تملك صلاحية الاطّلاع على موقع مندوب آخر');
  }

  const base = { agent_id: agent.id, agent_name: agent.name, available: false };
  if (!agent.location_consent) return { ...base, reason: 'no_consent' };
  if (!agent.location_sharing) return { ...base, reason: 'sharing_off' };

  const point = latestFor(agent.id);
  if (!point) return { ...base, reason: 'no_data' };

  logView(viewer.id, agent.id);
  return {
    ...base,
    available: !point.stale,
    reason: point.stale ? 'stale' : null,
    lat: point.lat, lng: point.lng,
    accuracy: point.accuracy, speed: point.speed, heading: point.heading,
    order_id: point.order_id, order_code: point.order_code,
    recorded_at: point.recorded_at, age_minutes: point.age_minutes,
  };
}

/** آخر موقع لكل مندوب مشارِك — للوحة المدير */
function liveBoard(viewer) {
  if (viewer.role !== 'admin') throw forbidden('اللوحة المباشرة متاحة لمدير العمليات فقط');
  purgeExpired();

  const agents = db.prepare(
    "SELECT * FROM agents WHERE role = 'agent' AND active = 1 ORDER BY name"
  ).all();

  return agents.map((a) => {
    const activeOrders = db.prepare(
      `SELECT COUNT(*) AS n FROM orders WHERE agent_id = ? AND status IN (${ON_DUTY_STATUSES.map(() => '?').join(',')})`
    ).get(a.id, ...ON_DUTY_STATUSES).n;

    const row = {
      agent_id: a.id, agent_name: a.name, phone: a.phone,
      vehicle: a.vehicle, governorate: a.governorate,
      availability: a.availability, active_orders: activeOrders,
      consent: !!a.location_consent, sharing: !!a.location_sharing,
      available: false, reason: null,
    };

    if (!a.location_consent) return { ...row, reason: 'no_consent' };
    if (!a.location_sharing) return { ...row, reason: 'sharing_off' };

    const p = latestFor(a.id);
    if (!p) return { ...row, reason: 'no_data' };

    logView(viewer.id, a.id);
    return {
      ...row,
      available: !p.stale, reason: p.stale ? 'stale' : null,
      lat: p.lat, lng: p.lng, accuracy: p.accuracy, speed: p.speed,
      order_id: p.order_id, order_code: p.order_code,
      recorded_at: p.recorded_at, age_minutes: p.age_minutes,
    };
  });
}

/** مسار المندوب خلال آخر ساعات محدودة — للمدير أو للمندوب نفسه */
function trailOf(viewer, agentId, minutes = 120) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) throw notFound('المندوب غير موجود');
  if (viewer.role !== 'admin' && viewer.id !== agent.id) {
    throw forbidden('لا تملك صلاحية الاطّلاع على مسار مندوب آخر');
  }
  if (!agent.location_consent) return { points: [], reason: 'no_consent' };

  const span = Math.min(Math.max(Number(minutes) || 120, 5), RETENTION_HOURS * 60);
  const points = db.prepare(
    `SELECT lat, lng, accuracy, speed, order_id, recorded_at
       FROM locations WHERE agent_id = ? AND recorded_at > ?
      ORDER BY id ASC LIMIT 500`
  ).all(agent.id, isoMinutesAgo(span));

  if (points.length) logView(viewer.id, agent.id);
  return { points, reason: null };
}

module.exports = {
  RETENTION_HOURS, STALE_MINUTES, MIN_INTERVAL_MS, ON_DUTY_STATUSES,
  consentState, setConsent, setSharing, purgeOwnHistory,
  recordPoint, purgeExpired, locationOf, liveBoard, trailOf,
  // يستعملهما بحث «الأقرب» ليخضع لقواعد الخصوصية نفسها لا لنسخة منها
  latestFor, logView,
};
