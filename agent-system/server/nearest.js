'use strict';
/**
 * أقرب كابتن لموقع الزبون.
 *
 * ── لماذا دبّوس لا عنوان ─────────────────────────────────────────────
 * عنوان الاستلام في الطلب نصّ حرّ («السالمية، قطعة ٤، شارع سالم المبارك»)،
 * و«الأقرب» بلا نقطة على الأرض كلامٌ بلا معنى. وترميز العناوين الكويتية
 * العربية آليًّا يحتاج خدمة خارجية مدفوعة، ونتيجتها على قطع الكويت وشوارعها
 * غير موثوقة. والواقع يعطي ما هو أدقّ منها: الزبون يرسل موقعه على واتساب،
 * فيصل المدير **دبّوسًا** — رابط خرائط أو إحداثيتين. هذا ما نقبله.
 *
 * ── الترتيب ─────────────────────────────────────────────────────────
 * المسافة هنا **مستقيمة على سطح الأرض** لا مسافة سياقة: لا نملك محرّك طرق،
 * وادّعاء دقّة لا نملكها أسوأ من الاعتراف بالتقريب. في الكويت — مدينة مسطّحة
 * شبكيّة الشوارع — التقريب قريب بما يكفي لترتيب المرشّحين، ولذلك يُسمّى الحقل
 * `straight_km` لا `distance` حتى لا يُقرأ على أنه أكثر ممّا هو.
 *
 * ── الخصوصية ────────────────────────────────────────────────────────
 * قول «الكابتن أحمد يبعد ٢٫١ كم» إفشاءٌ لموقعه. فالبحث يخضع لقواعد
 * `location.js` نفسها بلا استثناء: لا موافقة فلا موقع، والمشاركة مطفأة فلا
 * موقع، وكل كابتن يُقرأ موقعه هنا **يُسجَّل الاطّلاع عليه** ويظهر له في سجلّه
 * كما لو فتح المدير لوحته المباشرة. الأتمتة لا تشتري تخفيفًا في الخصوصية.
 *
 * ── الأهلية ─────────────────────────────────────────────────────────
 * شرط قبول الطلب يُستفتى من `assertCanReceiveOrders` نفسها لا من نسخة منها،
 * فلا تفترق قواعد الاقتراح عن قواعد الإسناد لو تغيّرت إحداهما. الكابتن الذي
 * لا يصلح يظهر بسببه لا يُحذف بصمت — ليعرف المدير أن النظام رآه ورفضه.
 */
const { db } = require('./db');
const D = require('./domain');
const L = require('./location');
const { badRequest, notFound, forbidden } = require('./lib/http');

/** حدود الكويت تقريبًا — دبّوس خارجها غالبًا لصقة خاطئة أو إحداثيتان مقلوبتان */
const KW = { latMin: 28.45, latMax: 30.15, lngMin: 46.5, lngMax: 48.55 };

const inKuwait = (lat, lng) =>
  lat >= KW.latMin && lat <= KW.latMax && lng >= KW.lngMin && lng <= KW.lngMax;

/**
 * استخراج إحداثيتين من نصّ يلصقه المدير.
 *
 * يقبل ما يصل فعلًا من واتساب وخرائط جوجل:
 *   ٢٩٫٣٧٥٩, ٤٧٫٩٧٧٤            ← إحداثيتان مباشرة (بأرقام لاتينية أو عربية)
 *   https://maps.google.com/…@29.3759,47.9774,17z
 *   https://www.google.com/maps/place/…/@29.3759,47.9774
 *   https://maps.google.com/?q=29.3759,47.9774
 *   https://maps.app.goo.gl/…!3d29.3759!4d47.9774
 *   geo:29.3759,47.9774
 *
 * الروابط المختصرة (goo.gl) التي لا تحمل الإحداثيتين في نصّها تحتاج فتحًا
 * شبكيًّا، ولا نفتحه: لا نُخرج النظام إلى الشبكة لأجل لصقة. تُرفض بسبب واضح.
 */
function parsePin(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) throw badRequest('الدبّوس فارغ');

  // الأرقام العربية-الهندية تصل ملصوقة أحيانًا — نحوّلها قبل أي تحليل
  const text = raw
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/٫/g, '.');

  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`),          // صيغة جوجل الداخلية
    new RegExp(`[@]${num}\\s*,\\s*${num}`),    // …/@lat,lng
    new RegExp(`[?&](?:q|ll|daddr|destination)=${num}\\s*,\\s*${num}`),
    new RegExp(`^geo:${num}\\s*,\\s*${num}`),
    new RegExp(`^${num}\\s*,\\s*${num}$`),     // إحداثيتان مجرّدتان
  ];

  let lat = null;
  let lng = null;
  for (const re of patterns) {
    const m = text.match(re);
    if (m) { lat = Number(m[1]); lng = Number(m[2]); break; }
  }

  if (lat === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (/goo\.gl|maps\.app/.test(text)) {
      throw badRequest(
        'الرابط المختصر لا يحمل الإحداثيتين. افتحه في الخرائط وانسخ الرابط الكامل، ' +
        'أو الصق الإحداثيتين مباشرة بصيغة: 29.3759, 47.9774'
      );
    }
    throw badRequest('تعذّر استخراج موقع من هذه اللصقة — الصق رابط خرائط أو إحداثيتين');
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw badRequest('إحداثيات خارج المدى الممكن');

  // الخلط بين ترتيب الإحداثيتين أشهر خطأ في اللصق، ونكشفه بدل أن نرسل
  // كابتنًا إلى نصف الكرة الآخر
  if (!inKuwait(lat, lng)) {
    if (inKuwait(lng, lat)) {
      throw badRequest('يبدو أن الإحداثيتين مقلوبتان — الترتيب الصحيح: خط العرض ثم خط الطول');
    }
    throw badRequest('الموقع خارج الكويت — تأكّد من اللصقة');
  }

  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/** مسافة مستقيمة بالكيلومترات بين نقطتين على سطح الأرض */
function straightKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** أسباب استبعاد الكابتن، بنصّ يفهمه المدير */
const REASONS = {
  no_consent:   'لم يوافق على مشاركة موقعه',
  sharing_off:  'أوقف المشاركة الآن',
  no_data:      'لا توجد نقطة مسجّلة',
  stale:        'آخر نقطة قديمة',
  vehicle:      'مركبته لا تناسب الطلب',
  unavailable:  'غير متفرّغ',
  not_eligible: '',   // يُملأ من رسالة قاعدة الإسناد نفسها
  same_agent:   'الطلب مُسند إليه أصلًا',
};

/**
 * ترتيب الكباتن حسب قربهم من نقطة الزبون.
 *
 * @param viewer   المدير الطالب — يُسجَّل اطّلاعه على كل موقع يُقرأ
 * @param order    الطلب (يحمل الدبّوس ونوع المركبة المطلوب)
 * @param options  { limit, includeUnavailable }
 */
function rankForOrder(viewer, order, options = {}) {
  if (viewer.role !== 'admin') throw forbidden('اقتراح الأقرب متاح لمدير العمليات فقط');
  if (order.pickup_lat == null || order.pickup_lng == null) {
    throw badRequest('الطلب بلا موقع للزبون — أضف دبّوس الاستلام أولًا');
  }

  const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 25);
  const includeUnavailable = !!options.includeUnavailable;
  const target = { lat: order.pickup_lat, lng: order.pickup_lng };

  L.purgeExpired();

  const agents = db.prepare(
    "SELECT * FROM agents WHERE role = 'agent' ORDER BY name"
  ).all();

  const ranked = [];
  const skipped = [];

  for (const a of agents) {
    const base = {
      agent_id: a.id, agent_name: a.name, phone: a.phone,
      vehicle: a.vehicle, governorate: a.governorate,
      availability: a.availability, approval: a.approval,
      active_orders: db.prepare(
        `SELECT COUNT(*) AS n FROM orders WHERE agent_id = ? AND status IN (${
          L.ON_DUTY_STATUSES.map(() => '?').join(',')})`
      ).get(a.id, ...L.ON_DUTY_STATUSES).n,
    };

    const skip = (code, note) => skipped.push({ ...base, reason: code, reason_text: note || REASONS[code] });

    if (order.agent_id === a.id) { skip('same_agent'); continue; }

    // قاعدة الإسناد نفسها هي الحكم — لا نسخة منها هنا
    try {
      D.assertCanReceiveOrders(a);
    } catch (e) {
      skip('not_eligible', e.message);
      continue;
    }

    if (a.vehicle !== order.vehicle) { skip('vehicle'); continue; }
    if (a.availability !== 'available' && !includeUnavailable) { skip('unavailable'); continue; }

    if (!a.location_consent) { skip('no_consent'); continue; }
    if (!a.location_sharing) { skip('sharing_off'); continue; }

    const point = L.latestFor(a.id);
    if (!point) { skip('no_data'); continue; }
    if (point.stale) { skip('stale'); continue; }

    // قراءة الموقع اطّلاعٌ عليه — يُسجَّل ويظهر للكابتن
    L.logView(viewer.id, a.id);

    ranked.push({
      ...base,
      straight_km: Math.round(straightKm(target, point) * 100) / 100,
      lat: point.lat, lng: point.lng,
      recorded_at: point.recorded_at,
      age_minutes: point.age_minutes,
    });
  }

  // الأقرب أولًا، وعند تساوي المسافة يُقدَّم الأخفّ حِملًا
  ranked.sort((x, y) =>
    x.straight_km - y.straight_km || x.active_orders - y.active_orders || x.agent_id - y.agent_id
  );

  return {
    pickup: target,
    candidates: ranked.slice(0, limit),
    considered: agents.length,
    skipped,
    note: 'المسافة مستقيمة لا مسافة سياقة',
  };
}

/** غلاف يقرأ الطلب بنفسه — للاستدعاء من المسار */
function nearestForOrder(viewer, orderId, options) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw notFound('الطلب غير موجود');
  return { order_id: order.id, order_code: order.code, ...rankForOrder(viewer, order, options) };
}

module.exports = { parsePin, straightKm, rankForOrder, nearestForOrder, inKuwait, KW };
