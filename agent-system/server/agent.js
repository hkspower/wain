'use strict';
/**
 * وكيل موصول — الصفحة الرئيسية تُسأل بالكلام والكتابة.
 *
 * ── ما هو ───────────────────────────────────────────────────────────
 * موجِّه نوايا قاعديّ، لا نموذج لغويّ. يفهم ما عُلّم إياه ويقول ما لم يفهمه،
 * ولا يتعلّم ولا يستنتج ما لم يُقَل. قيل هنا صراحةً حتى لا يُظنّ به ما لا
 * يفعل. وفائدة ذلك أنه يعمل بلا مفتاح مدفوع ولا خدمة خارجية، ويُختبر كما
 * يُختبر أي كود.
 *
 * ── يقرأ ويقترح، ولا يكتب ───────────────────────────────────────────
 * كل ما يفعله الوكيل **قراءة**. لا ينشئ طلبًا ولا يُسند ولا يغيّر حالة ولا
 * يعتمد حسابًا. وما يحتاج كتابةً يحوّله إلى الشاشة التي تفعله، فتُفعل هناك
 * بقواعدها وسجلّها ومراجعة إنسان.
 *
 * والسبب أن سؤالًا يُساء فهمه أهون من أمرٍ يُساء فهمه: «ألغِ طلبات السالمية»
 * فُهمت خطأً تُتلف عملًا حقيقيًّا، و«كم طلب في السالمية» فُهمت خطأً تعطي
 * رقمًا يُراجَع. فالوكيل هنا يجيب ويقترح، والزرّ يبقى بيد الموظّف.
 *
 * ── الصلاحية ليست من الوكيل ─────────────────────────────────────────
 * المندوب يسأل فيرى طلباته هو؛ والمدير يرى الكل. والنطاق يُبنى في مكان
 * واحد (`scopeFor`) لا في كل استعلام، فلا يسهو أحدهم يومًا عن سطرٍ فيرى
 * مندوبٌ ما ليس له.
 */

const ar = require('arabic-kit');
const { db } = require('./db');
const D = require('./domain');
const AREA = require('./areas');
const V = require('./voice-order');

/* ------------------------------ المطابقة ------------------------------ */

/** تطبيع للمطابقة: بلا تشكيل ولا همزات مختلفة ولا علامات */
function norm(text) {
  return ar.normalize(String(text || ''))
    .replace(/[^ء-ي0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * مطابقة على الكلمة كاملةً لا على جزء منها.
 * «متاح» داخل «متاحة» مقبول، لكن «طلب» داخل «مطلوب» ليس طلبًا — ولهذا
 * تُطابَق الكلمات لا النصّ المتّصل.
 */
function hasPhrase(words, phrase) {
  const parts = norm(phrase).split(' ');
  for (let i = 0; i + parts.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      const w = words[i + j];
      if (w !== parts[j] && w !== 'ال' + parts[j] && w.replace(/^و/, '') !== parts[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/* ------------------------------ النطاق ------------------------------ */

/** المندوب يرى طلباته وحده. مكان واحد لا يتكرّر. */
function scopeFor(viewer) {
  return viewer.role === 'admin'
    ? { sql: '', args: [] }
    : { sql: ' AND o.agent_id = ?', args: [viewer.id] };
}

const ORDER_COLS = `o.id, o.code, o.status, o.customer_name, o.customer_phone,
  o.pickup_address, o.dropoff_address, o.governorate, o.delivery_fee,
  o.cod_amount, o.priority, o.created_at, o.updated_at, a.name AS agent_name`;

function queryOrders(viewer, where, args, limit = 10) {
  const s = scopeFor(viewer);
  return db.prepare(
    `SELECT ${ORDER_COLS} FROM orders o LEFT JOIN agents a ON a.id = o.agent_id
      WHERE ${where}${s.sql}
      ORDER BY CASE o.priority WHEN 'urgent' THEN 0 ELSE 1 END, o.updated_at DESC
      LIMIT ?`
  ).all(...args, ...s.args, limit);
}

function countOrders(viewer, where, args) {
  const s = scopeFor(viewer);
  return db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${where}${s.sql}`)
    .get(...args, ...s.args).n;
}

/* ------------------------------ الصيغ ------------------------------ */

const ORDERS = { gender: 'm', human: false, zero: 'لا طلبات', one: 'طلب واحد', two: 'طلبان',
  twoOblique: 'طلبين', few: 'طلبات', many: 'طلبًا', other: 'طلب' };
const CAPTAINS = { gender: 'm', human: true, zero: 'لا كباتن', one: 'كابتن واحد', two: 'كابتنان',
  twoOblique: 'كابتنين', few: 'كباتن', many: 'كابتنًا', other: 'كابتن' };

/* الوصف يتبع المعدود: «طلب واحد نشط» و«٣ طلبات نشطة» — والحزمة تتكفّل
   بالمطابقة، فلا يُكتب وصفٌ ثابت يصلح لعددٍ ويخطئ في غيره. */
const ADJ = {
  delivered: {
    m: { one: 'مُسلَّم', two: 'مُسلَّمان', twoOblique: 'مُسلَّمين', many: 'مُسلَّمًا', other: 'مُسلَّم' },
    f: { one: 'مُسلَّمة', two: 'مُسلَّمتان', twoOblique: 'مُسلَّمتين', many: 'مُسلَّمة', other: 'مُسلَّمة' },
    pm: 'مُسلَّمين', nh: 'مُسلَّمة',
  },
  failed: {
    m: { one: 'متعثّر', two: 'متعثّران', twoOblique: 'متعثّرين', many: 'متعثّرًا', other: 'متعثّر' },
    f: { one: 'متعثّرة', two: 'متعثّرتان', twoOblique: 'متعثّرتين', many: 'متعثّرة', other: 'متعثّرة' },
    pm: 'متعثّرين', nh: 'متعثّرة',
  },
  free: {
    m: { one: 'متاح', two: 'متاحان', twoOblique: 'متاحين', many: 'متاحًا', other: 'متاح' },
    f: { one: 'متاحة', two: 'متاحتان', twoOblique: 'متاحتين', many: 'متاحة', other: 'متاحة' },
    pm: 'متاحون', nh: 'متاحة',
  },
};

const nOrders = (n) => ar.plural(n, ORDERS);
const nCaptains = (n) => ar.plural(n, CAPTAINS);
const dOrders = (n, adj) => ar.describe(n, ORDERS, adj);

/* ------------------------------ النوايا ------------------------------ */

/**
 * كل نيّة: مفاتيحها، ومن يجيبها.
 * الترتيب مقصود — الأخصّ قبل الأعمّ، فـ«أقرب كابتن لطلب MW-1» ليست «ابحث».
 */
const INTENTS = [
  {
    id: 'help',
    keys: ['شنو تسوي', 'وش تسوي', 'ايش تسوي', 'شنو تقدر', 'مساعدة', 'المساعدة', 'كيف استخدمك', 'شنو اسالك'],
    run: () => ({
      kind: 'help',
      say: 'اسألني عن اليوم وعن الطلبات وعن الكباتن، أو ألصق طلبًا جديدًا فأفتح لك النموذج مملوءًا.',
      data: { examples: EXAMPLES },
    }),
  },

  {
    id: 'stats_today',
    keys: ['اليوم', 'احصاءات', 'الاحصاءات', 'وضع اليوم', 'ملخص اليوم', 'كم عمولة', 'العمولة', 'التحصيل', 'كم سلمنا'],
    run: (ctx) => {
      const from = startOfToday();
      const s = scopeFor(ctx.viewer);
      const t = db.prepare(
        `SELECT COUNT(*) AS delivered,
                COALESCE(SUM(o.cod_amount), 0) AS cod,
                COALESCE(SUM(o.delivery_fee), 0) AS fees,
                COALESCE(SUM(o.commission_amount), 0) AS commission,
                COALESCE(SUM(o.agent_earning), 0) AS earning
           FROM orders o WHERE o.status='delivered' AND o.delivered_at >= ?${s.sql}`
      ).get(from, ...s.args);

      const active = countOrders(ctx.viewer, `o.status IN (${q(D.ACTIVE_STATUSES)})`, D.ACTIVE_STATUSES);
      const waiting = ctx.isAdmin ? countOrders(ctx.viewer, "o.status = 'new'", []) : 0;

      const rows = [
        ['المُسلَّم اليوم', nOrders(t.delivered)],
        ['النشط الآن', nOrders(active)],
        ['تحصيل اليوم', ar.money(t.cod)],
      ];
      if (ctx.isAdmin) {
        rows.push(['بانتظار الإسناد', nOrders(waiting)]);
        rows.push(['عمولة الوساطة اليوم', ar.money(t.commission)]);
        rows.push(['مستحقّ الكباتن اليوم', ar.money(t.earning)]);
      }
      return {
        kind: 'stats',
        say: `اليوم: ${dOrders(t.delivered, ADJ.delivered)}، و${dOrders(active, 'active')} الآن.`,
        data: { rows },
        actions: [{ label: 'كل الطلبات', href: '#/orders' }],
      };
    },
  },

  {
    id: 'agents_available',
    keys: ['مين متاح', 'من متاح', 'الكباتن المتاحين', 'كابتن متاح', 'متاح الان', 'المتاحين', 'مين فاضي'],
    admin: true,
    run: () => {
      const list = db.prepare(
        `SELECT id, name, governorate, vehicle FROM agents
          WHERE role='agent' AND active=1 AND availability='available' AND approval IN (${q(D.WORKING_APPROVALS)})
          ORDER BY name LIMIT 20`
      ).all(...D.WORKING_APPROVALS);
      return {
        kind: 'agents',
        say: list.length ? `${ar.describe(list.length, CAPTAINS, ADJ.free)} الآن.` : 'لا كابتن متاحًا الآن.',
        data: { agents: list.map((a) => ({ ...a, vehicle_label: D.VEHICLES[a.vehicle] || a.vehicle })) },
        actions: [{ label: 'كل المندوبين', href: '#/agents' }],
      };
    },
  },

  {
    id: 'agents_under_test',
    keys: ['تحت التجربة', 'التجربة', 'الجدد', 'مين تحت التجربة'],
    admin: true,
    run: () => {
      const list = db.prepare(
        "SELECT id, name, governorate, vehicle FROM agents WHERE role='agent' AND approval='under_test' ORDER BY name LIMIT 20"
      ).all();
      return {
        kind: 'agents',
        say: list.length ? `${nCaptains(list.length)} تحت التجربة.` : 'لا أحد تحت التجربة.',
        data: { agents: list.map((a) => ({ ...a, vehicle_label: D.VEHICLES[a.vehicle] || a.vehicle })) },
        actions: [{ label: 'صفحة المندوبين', href: '#/agents' }],
      };
    },
  },

  {
    id: 'transfers_pending',
    keys: ['التحويلات', 'تحويلات معلقة', 'تحويل معلق', 'بانتظار الرد', 'التحويلات المعلقة'],
    run: (ctx) => {
      const n = db.prepare(
        `SELECT COUNT(*) AS n FROM transfers
          WHERE status='pending'${ctx.isAdmin ? '' : ' AND to_agent_id = ?'}`
      ).get(...(ctx.isAdmin ? [] : [ctx.viewer.id])).n;
      return {
        kind: 'count',
        say: n ? `${ar.plural(n, 'transfer')} بانتظار الردّ.` : 'لا تحويلات معلّقة.',
        actions: [{ label: 'صفحة التحويلات', href: '#/transfers' }],
      };
    },
  },

  {
    id: 'unassigned',
    keys: ['بانتظار الاسناد', 'بلا مندوب', 'بلا كابتن', 'غير مسندة', 'ما انسندت', 'الجديدة'],
    admin: true,
    run: (ctx) => {
      const orders = queryOrders(ctx.viewer, "o.status = 'new'", []);
      const n = countOrders(ctx.viewer, "o.status = 'new'", []);
      return {
        kind: 'orders',
        say: n ? `${nOrders(n)} بانتظار الإسناد.` : 'لا طلب بانتظار الإسناد.',
        data: { orders },
        actions: [{ label: 'افتحها', href: '#/orders?scope=unassigned' }],
      };
    },
  },

  {
    id: 'active_orders',
    keys: ['الطلبات النشطة', 'النشطة', 'الشغالة', 'الجارية', 'قيد التوصيل', 'في الطريق'],
    run: (ctx) => {
      const orders = queryOrders(ctx.viewer, `o.status IN (${q(D.ACTIVE_STATUSES)})`, D.ACTIVE_STATUSES);
      const n = countOrders(ctx.viewer, `o.status IN (${q(D.ACTIVE_STATUSES)})`, D.ACTIVE_STATUSES);
      return {
        kind: 'orders',
        say: n ? `${dOrders(n, 'active')} الآن.` : 'لا طلبات نشطة.',
        data: { orders },
        actions: [{ label: 'كل الطلبات', href: '#/orders?scope=active' }],
      };
    },
  },

  {
    id: 'failed_orders',
    keys: ['المتعثرة', 'تعذر التسليم', 'المتعثره', 'اللي ما انسلمت', 'الفاشلة', 'المرتجعة'],
    run: (ctx) => {
      const orders = queryOrders(ctx.viewer, "o.status IN ('failed','returned')", []);
      const n = countOrders(ctx.viewer, "o.status IN ('failed','returned')", []);
      return {
        kind: 'orders',
        say: n ? `${nOrders(n)} في «تعذّر التسليم» أو «مرتجع».` : 'لا طلبات متعثّرة ولا مرتجعة.',
        data: { orders },
      };
    },
  },
];

const EXAMPLES = [
  'كم طلب سُلّم اليوم؟',
  'مين متاح الآن؟',
  'الطلبات بانتظار الإسناد',
  'وين طلب MW-4001؟',
  'طلبات حولي',
  'ألصق طلبًا جديدًا…',
];

const q = (arr) => arr.map(() => '?').join(',');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/* --------------------------- مستخرِجات --------------------------- */

/**
 * رمز طلب: «MW-4001» صريحًا، أو رقم مجرّد يشبه الرمز.
 *
 * والرقم المجرّد لا يُؤخذ رمزًا إن كان هاتفًا كويتيًّا: «٦٦٥٥٤٤٣٣» ثمان
 * خانات تبدأ بستّة، وهي هاتف الزبون لا رمز طلب. ولولا ذلك لابتلع البحثُ
 * بالرمز كلَّ بحثٍ بالهاتف ولم يجد شيئًا.
 *
 * يعيد `{ code, explicit }` — والصريح وحده يُقطع فيه بالجواب حين لا يوجد.
 */
function findOrderCode(text) {
  const flat = ar.toLatin(String(text));
  const exp = flat.match(/\bMW[-\s]?(\d{1,8})\b/i);
  if (exp) return { code: Number(exp[1]), explicit: true };
  if (V.findPhone(text)) return null;
  const bare = flat.match(/\b(\d{3,6})\b/);
  return bare ? { code: Number(bare[1]), explicit: false } : null;
}

/** محافظة أو منطقة مذكورة بالاسم */
function findPlace(text) {
  const n = norm(text);
  const words = n.split(' ');
  for (const g of D.GOVERNORATES) if (hasPhrase(words, g)) return { governorate: g };
  const hit = V.findAreas(n)[0];
  return hit ? { area: hit.name } : null;
}

/** حالة مذكورة باسمها العربي */
function findStatus(text) {
  const words = norm(text).split(' ');
  for (const [key, label] of Object.entries(D.STATUSES)) {
    if (hasPhrase(words, label)) return key;
  }
  return null;
}

/* ------------------------------ السؤال ------------------------------ */

/**
 * يجيب سؤال الموظّف.
 * يعيد `{ understood, intent, kind, say, data, actions }`.
 * وما لم يُفهم يُقال صراحةً مع أمثلة — لا جواب مخترع ولا صمت.
 */
function ask(viewer, text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return { understood: false, intent: 'empty', kind: 'unknown', say: 'اكتب سؤالك أو تكلّم به.', data: { examples: EXAMPLES } };
  }

  const ctx = { viewer, isAdmin: viewer.role === 'admin', text: raw };
  const words = norm(raw).split(' ');

  /* ١ — طلب جديد؟ يُحوَّل إلى النموذج مملوءًا، ولا يُنشأ هنا.
     العلامة الفارقة أن النصّ فيه ما يكفي لطلب: منطقتان، أو منطقة وهاتف. */
  const parsed = V.parseOrder(raw);
  const f = parsed.fields;
  const looksNew = (f.pickup_area && f.dropoff_area) || (f.pickup_area && f.customer_phone);
  if (looksNew && ctx.isAdmin) {
    return {
      understood: true, intent: 'new_order', kind: 'handoff',
      say: `هذا طلب جديد — فهمت منه ${ar.plural(Object.keys(f).length, FIELDS)}.`,
      data: { parsed },
      actions: [{ label: 'افتح النموذج مملوءًا', href: '#/new', carry: raw, primary: true }],
    };
  }

  /* ٢ — رمز طلب صريح */
  const hit = findOrderCode(raw);
  if (hit) {
    const orders = queryOrders(viewer, 'o.code = ?', ['MW-' + hit.code], 1);
    if (orders.length) {
      const o = orders[0];
      return {
        understood: true, intent: 'find_order', kind: 'orders',
        say: `${o.code} — ${D.STATUSES[o.status]}${o.agent_name ? ` مع ${o.agent_name}` : ' وبلا كابتن'}.`,
        data: { orders },
        actions: [{ label: 'افتح الطلب', href: `#/orders/${o.id}`, primary: true }],
      };
    }
    /* الرمز الصريح يُقطع فيه بالجواب؛ والرقم المجرّد قد يكون شيئًا آخر
       فيمضي إلى بقيّة البحث بدل أن يقف عند «لا طلب». */
    if (hit.explicit) {
      return {
        understood: true, intent: 'find_order', kind: 'none',
        say: `لا طلب برمز MW-${ar.digits(hit.code)}${viewer.role === 'admin' ? '' : ' بين طلباتك'}.`,
      };
    }
  }

  /* ٣ — نيّة معروفة بمفاتيحها */
  let best = null;
  for (const intent of INTENTS) {
    if (intent.admin && !ctx.isAdmin) continue;
    const score = intent.keys.reduce((n, k) => n + (hasPhrase(words, k) ? norm(k).split(' ').length : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { intent, score };
  }
  if (best) {
    const out = best.intent.run(ctx);
    return { understood: true, intent: best.intent.id, ...out };
  }

  /* ٤ — مكان أو حالة: بحث في الطلبات */
  const place = findPlace(raw);
  const status = findStatus(raw);
  if (place || status) {
    const where = [];
    const args = [];
    if (place?.governorate) { where.push('o.governorate = ?'); args.push(place.governorate); }
    if (place?.area) { where.push('(o.pickup_area = ? OR o.dropoff_area = ?)'); args.push(place.area, place.area); }
    if (status) { where.push('o.status = ?'); args.push(status); }
    const sql = where.join(' AND ');
    const orders = queryOrders(viewer, sql, args);
    const n = countOrders(viewer, sql, args);
    const what = [place?.governorate && `محافظة ${place.governorate}`, place?.area, status && D.STATUSES[status]]
      .filter(Boolean).join(' · ');
    return {
      understood: true, intent: 'search_orders', kind: 'orders',
      say: n ? `${nOrders(n)} — ${what}.` : `لا طلبات — ${what}.`,
      data: { orders },
    };
  }

  /* ٥ — بحث نصّي على الاسم والهاتف والعنوان */
  const term = raw.replace(/[؟?]/g, '').trim();
  if (term.length >= 3) {
    const like = `%${term}%`;
    const where = '(o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.dropoff_address LIKE ? OR o.pickup_address LIKE ?)';
    const orders = queryOrders(viewer, where, [like, like, like, like]);
    if (orders.length) {
      return {
        understood: true, intent: 'search_text', kind: 'orders',
        say: `${nOrders(orders.length)} فيها «${term}».`,
        data: { orders },
      };
    }
  }

  /* ٦ — لا يخمّن */
  return {
    understood: false, intent: 'unknown', kind: 'unknown',
    say: 'لم أفهم هذا. أنا أقرأ وأجيب ولا أنفّذ — اسألني عن اليوم أو الطلبات أو الكباتن.',
    data: { examples: EXAMPLES },
  };
}

const FIELDS = { gender: 'm', human: false, zero: 'لا حقول', one: 'حقل واحد', two: 'حقلان',
  twoOblique: 'حقلين', few: 'حقول', many: 'حقلًا', other: 'حقل' };

module.exports = { ask, INTENTS, EXAMPLES, norm, hasPhrase, findOrderCode, findPlace, findStatus };
