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
const P = require('./perms');

/** مدة الاحتفاظ بالنقاط بالساعات */
const RETENTION_HOURS = Number(process.env.MAWSOOL_LOCATION_RETENTION_HOURS) || 24;
/** بعد هذه المدة يُعتبر آخر موقع قديمًا ولا يُعرض كموقع حالي */
const STALE_MINUTES = 10;
/** أقل فاصل زمني بين نقطتين مقبولتين — يمنع إغراق القاعدة */
const MIN_INTERVAL_MS = 8000;

/*
 * ── جودة النقطة ───────────────────────────────────────────────────────
 * ثلاثة عيوب قِيست على السلوك القديم:
 *
 * ١. كابتن واقف عشر دقائق يُخزَّن له **٦٠ نقطة** متطابقة. على وردية عشر
 *    ساعات: ٣٦٠٠ صفًّا لكابتن واحد، تُغرق المسار وتُخفي فيه حركته الحقيقية.
 * ٢. قراءة من برج اتصال دقّتها **٣٠٠٠ متر** تُخزَّن وتُرسم نقطةً واحدة
 *    كأي قراءة GPS دقيقة، واللوحة تقول «موقع محدَّث».
 * ٣. قفزة **٥٠ كم في عشر ثوانٍ** (١٨٠٠٠ كم/س) تُقبل، فتطير النقطة عبر
 *    المخطّط ويُكسر المسار.
 */

/** أبعد من هذا ليس موقعًا بل اسمَ مدينة — يُرفض */
const MAX_ACCURACY_M = 10000;
/** وما فوق هذا موقعٌ تقريبيّ يُقال عنه ذلك، ولا يُدّعى أنه محدَّث */
const COARSE_ACCURACY_M = 200;
/** أقصى سرعة معقولة على طرق الكويت — ما فوقها خللُ قراءة لا سفر */
const MAX_SPEED_KMH = 200;
/** لا حركة تحت هذا القدر: تشويش الجهاز لا انتقال */
const MIN_MOVE_M = 20;
/*
 * نبضة: نخزّن نقطةً كل ثلاث دقائق ولو لم يتحرّك. بدونها يشيخ آخر موقع
 * للكابتن الواقف فتقول اللوحة «آخر قراءة قديمة» وهو يرسل كل عشر ثوانٍ —
 * أي أن مرشّح الحركة وحده يكذب بالسكوت. وثلاثٌ أقلّ من عتبة القِدَم (١٠).
 */
const HEARTBEAT_MS = 3 * 60_000;

/** مسافة مستقيمة بالأمتار بين نقطتين */
function metresBetween(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/*
 * القفزة تُرفض — لكن **لا تُرفض مرّتين متتاليتين**. لو كانت النقطة السابقة
 * هي الخاطئة لبقي الكابتن عالقًا في مكانٍ ليس فيه إلى الأبد: كل نقطة
 * صحيحة بعدها ستبدو قفزةً عن الخطأ. فقراءتان متتاليتان تتّفقان على
 * المكان الجديد تُصدَّقان. (ذاكرةٌ في العملية: أسوأ ما يقع بعد إعادة
 * التشغيل نقطةٌ واحدة تُرفض مرّة زائدة.) */
const lastJumpAt = new Map();
const JUMP_GRACE_MS = 2 * 60_000;

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

  const accuracy = Number(point.accuracy);
  if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_M) {
    return { recorded: false, reason: 'too_coarse', accuracy };
  }

  // تقييد المعدّل: نتجاهل النقطة إن وصلت قبل انقضاء الفاصل الأدنى
  const last = db.prepare(
    'SELECT lat, lng, accuracy, recorded_at FROM locations WHERE agent_id = ? ORDER BY id DESC LIMIT 1'
  ).get(agent.id);
  const sinceLast = last ? Date.now() - new Date(last.recorded_at).getTime() : Infinity;
  if (last && sinceLast < MIN_INTERVAL_MS) {
    return { recorded: false, reason: 'too_soon' };
  }

  if (last) {
    const moved = metresBetween(last, { lat, lng });
    const kmh = sinceLast > 0 ? (moved / 1000) / (sinceLast / 3_600_000) : Infinity;

    if (kmh > MAX_SPEED_KMH) {
      const prevJump = lastJumpAt.get(agent.id) || 0;
      if (Date.now() - prevJump > JUMP_GRACE_MS) {
        lastJumpAt.set(agent.id, Date.now());
        return { recorded: false, reason: 'implausible_jump', km: Math.round(moved / 100) / 10, kmh: Math.round(kmh) };
      }
      // قراءة ثانية تؤكّد المكان الجديد — نصدّقها ونمسح العلامة
      lastJumpAt.delete(agent.id);
    }

    /* عتبة الحركة تتبع دقّة القراءة: قراءةٌ دقّتها ٥٠ مترًا تتذبذب ٥٠ مترًا
       وهو واقف، فعتبةٌ ثابتة تخزّن تذبذبها حركةً. */
    const noise = Math.max(MIN_MOVE_M, Number.isFinite(accuracy) ? accuracy : MIN_MOVE_M);
    if (moved < noise && sinceLast < HEARTBEAT_MS) {
      return { recorded: false, reason: 'no_movement', moved: Math.round(moved) };
    }
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
    num(point.accuracy, 0, MAX_ACCURACY_M),
    num(point.speed, 0, 400),
    num(point.heading, 0, 360),
    active ? active.id : null,
    now()
  );

  purgeExpired();
  return {
    recorded: true,
    order_id: active ? active.id : null,
    coarse: Number.isFinite(accuracy) && accuracy > COARSE_ACCURACY_M,
  };
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
  return {
    ...row,
    age_minutes: Math.round(ageMin * 10) / 10,
    stale: ageMin > STALE_MINUTES,
    /* «تقريبيّ» لا «محدَّث»: نصف قطر مئتي متر يدلّ على الحيّ لا على الشارع،
       ورسمُه نقطةً واحدة ادّعاءُ دقّةٍ لا وجود لها. */
    coarse: Number.isFinite(row.accuracy) && row.accuracy > COARSE_ACCURACY_M,
  };
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
  if (!P.can(viewer, 'locations.view') && viewer.id !== agent.id) {
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
  P.require(viewer, 'locations.view', 'اللوحة المباشرة');
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
      available: !p.stale, reason: p.stale ? 'stale' : (p.coarse ? 'coarse' : null),
      coarse: p.coarse,
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
  if (!P.can(viewer, 'locations.view') && viewer.id !== agent.id) {
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
  MAX_ACCURACY_M, COARSE_ACCURACY_M, MAX_SPEED_KMH, MIN_MOVE_M, HEARTBEAT_MS,
  metresBetween,
  consentState, setConsent, setSharing, purgeOwnHistory,
  recordPoint, purgeExpired, locationOf, liveBoard, trailOf,
  // يستعملهما بحث «الأقرب» ليخضع لقواعد الخصوصية نفسها لا لنسخة منها
  latestFor, logView,
};
