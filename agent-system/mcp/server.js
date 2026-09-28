'use strict';
/**
 * خادم MCP لموصول — يجعل النظام أداةً بيد نموذجٍ لغويّ.
 *
 * ── ما هو ───────────────────────────────────────────────────────────
 * `Model Context Protocol` واجهةٌ يتكلّمها العميل (Claude وغيره) مع خادمٍ
 * يعرض **أدوات**. وهذا الخادم يعرض عملَ المكتب: يقرأ طلبًا من كلام الزبون،
 * ويسرد الطلبات، وينشئ، ويسعّر، ويُسند، ويقترح أقرب كابتن، ويجيب من معرفة
 * موصول.
 *
 * ── ولماذا يمرّ كلُّ شيء بالواجهة البرمجية ──────────────────────────
 * كان أقصرَ أن يفتح هذا الملفّ قاعدة البيانات مباشرةً — الوحدات كلّها هنا.
 * ولو فعل لصار **بابًا ثانيًا للكتابة يتخطّى ما يفرضه الأوّل**: مصفوفة
 * الصلاحيات (`need`)، وحدود الطلبات، وسجلّ الأحداث الذي يقول من فعل ماذا.
 * فيسعّر نموذجٌ لغويّ طلبًا بلا صلاحية تسعير، ولا يبقى للفعل أثرٌ باسم أحد.
 *
 * فهذا الخادم **زبونٌ للواجهة لا شريكٌ لقاعدتها**: يدخل بحسابٍ له اسمٌ
 * وكلمة مرور، وكلُّ فعلٍ يقع باسم ذلك الحساب ويُقيَّد عليه. ومن أراد أن
 * يمنع الوكيل من التسعير منعه بنزع الصلاحية من الحساب، لا بتعديل شيفرة.
 *
 * ── التشغيل ────────────────────────────────────────────────────────
 *   MAWSOOL_MCP_URL=https://ops.example.com \
 *   MAWSOOL_MCP_USERNAME=mcp MAWSOOL_MCP_PASSWORD='…' \
 *   node mcp/server.js
 *
 * وفي إعداد العميل (mcpServers) يُذكر الأمرُ نفسه ببيئته.
 *
 * ── ما لا يُكتب في stdout ──────────────────────────────────────────
 * **stdout قناة البروتوكول وحدها.** أيّ `console.log` تشخيصيّ هنا يُفسد
 * الرسالة التي بعده فيسقط الاتّصال بلا سبب ظاهر — والتشخيص كلّه إلى
 * stderr. وهذا أوّل ما يُخطأ فيه في خوادم stdio.
 */

const readline = require('node:readline');

/* ------------------------------ الإعداد ------------------------------ */

const BASE = (process.env.MAWSOOL_MCP_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const USER = process.env.MAWSOOL_MCP_USERNAME || '';
const PASS = process.env.MAWSOOL_MCP_PASSWORD || '';

/** التشخيص إلى stderr — لا إلى stdout (انظر رأس الملفّ) */
const log = (...a) => process.stderr.write('[mawsool-mcp] ' + a.join(' ') + '\n');

/* --------------------------- زبون الواجهة --------------------------- */

let cookie = '';        // كوكي الجلسة كما أعطاها الخادم
let loggingIn = null;   // دخولٌ جارٍ: تنتظره الطلبات المتزامنة ولا تكرّره

async function login() {
  if (!USER || !PASS) {
    throw new Error(
      'لا بيانات دخول. اضبط MAWSOOL_MCP_USERNAME و MAWSOOL_MCP_PASSWORD ' +
      'لحسابٍ في نظام موصول — الأدوات تعمل بصلاحيات ذلك الحساب.'
    );
  }
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`تعذّر الدخول إلى موصول (${res.status}): ${body.error || 'سبب غير معروف'}`);
  }
  /* الكوكي كما أرسله الخادم، بلا سماته — تُعاد قيمتُه وحدها في الطلب */
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  cookie = set.map((c) => String(c).split(';')[0]).join('; ');
  if (!cookie) throw new Error('دخلَ ولم يُعطِ كوكي جلسة — راجع إعداد الخادم');
  log('دخل بحساب', USER);
}

/** دخولٌ واحد وإن تزامنت الطلبات */
const ensureSession = () => (loggingIn ||= login().finally(() => { loggingIn = null; }));

/**
 * طلبٌ إلى الواجهة بجلسةٍ حيّة.
 * والجلسة تنتهي بمرور الوقت، فيُعاد الدخول **مرّةً واحدة** عند ٤٠١ ثمّ
 * يُعاد الطلب — ولا يُعاد ثانيةً لئلّا تدور الحلقة على خطأٍ دائم.
 */
async function call(method, path, { body, query } = {}, retried = false) {
  if (!cookie) await ensureSession();
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && !retried) {
    cookie = '';
    await ensureSession();
    return call(method, path, { body, query }, true);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `${method} ${path} ← ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

/** ما لا يحتاج جلسةً: البيانات الوصفية مفتوحة */
async function callPublic(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} ← ${res.status}`);
  return data;
}

/**
 * الطلب بالرمز أو بالمعرّف.
 * النموذج يرى «MW-4176» في كلام الموظّف لا الرقم ٣١، فيُقبل الاثنان:
 * الرمز يُبحث عنه ثمّ يُقرأ بمعرّفه. وبلا هذا يسأل النموذج عن رقمٍ لا
 * يعرفه أحد، أو يخمّنه فيفتح طلب غيره.
 */
async function resolveOrderId(ref) {
  const s = String(ref == null ? '' : ref).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const { orders } = await call('GET', '/api/orders', { query: { q: s, limit: 5 } });
  const exact = (orders || []).filter((o) => String(o.code).toLowerCase() === s.toLowerCase());
  if (exact.length === 1) return exact[0].id;
  if (!exact.length) throw new Error(`لا طلب برمز «${s}»`);
  throw new Error(`«${s}» يطابق أكثر من طلب — استعمل المعرّف الرقمي`);
}

/* ------------------------------ الأدوات ------------------------------ */

/* الوصف الذي يقرأه النموذج هو **العقد**: منه يقرّر متى يستدعي الأداة وبأيّ
   حجج. فيُكتب فيه ما تفعله وما لا تفعله، لا اسمها مكرّرًا. */

const TOOLS = [
  {
    name: 'parse_order',
    title: 'اقرأ طلبًا من كلام الزبون',
    description:
      'يقرأ نصًّا عربيًّا كما يقوله زبونٌ كويتيّ («ابغى توصيل من السالمية قطعة ٤ '
      + 'إلى الجابرية، اسمي بدر ورقمي ٥٥٥٠١٠٢٠») ويعيد الحقول التي فهمها ومعها ما '
      + 'نقص وسببه. يقرأ ولا ينشئ: لا يمسّ قاعدة البيانات. استعمله قبل create_order '
      + 'لتحويل كلامٍ حرّ إلى حقول، ثم راجعها.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'كلام الزبون كما قاله' } },
      required: ['text'],
    },
    run: ({ text }) => call('POST', '/api/voice-orders/parse', { body: { transcript: text } }),
  },
  {
    name: 'list_orders',
    title: 'اسرد الطلبات',
    description:
      'يسرد الطلبات بمرشّحات. scope: active (كل ما لم ينتهِ) · done · unassigned. '
      + 'q يبحث في الرمز واسم الزبون وهاتفه وعنوان التسليم. '
      + 'ولا يرى الحسابُ إلّا ما تسمح به صلاحيته — الكابتن يرى طلباته وحدها.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['active', 'done', 'unassigned'] },
        status: { type: 'string', description: 'حالة بعينها، مثل new أو delivered' },
        governorate: { type: 'string' },
        q: { type: 'string', description: 'بحث نصّي' },
        limit: { type: 'integer', minimum: 1, maximum: 300, default: 50 },
      },
    },
    run: (a) => call('GET', '/api/orders', {
      query: { scope: a.scope, status: a.status, governorate: a.governorate, q: a.q, limit: a.limit || 50 },
    }),
  },
  {
    name: 'get_order',
    title: 'اقرأ طلبًا',
    description: 'تفصيل طلبٍ واحد بأحداثه. يقبل الرمز (MW-4176) أو المعرّف الرقمي.',
    inputSchema: {
      type: 'object',
      properties: { order: { type: 'string', description: 'رمز الطلب أو معرّفه' } },
      required: ['order'],
    },
    run: async (a) => call('GET', `/api/orders/${await resolveOrderId(a.order)}`),
  },
  {
    name: 'create_order',
    title: 'أنشئ طلبًا',
    description:
      'ينشئ طلبًا في النظام. **يكتب** — فراجع الحقول مع الزبون قبله. '
      + 'المنطقة تُفحص أنها من مناطق المحافظة المذكورة، والقطعة تُفحص في مداها. '
      + 'ولا يُسنَد الطلب ولا يُسعَّر هنا: المكتب يتّصل ويؤكّد ثمّ يسعّر ويُسند.',
    inputSchema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string' },
        customer_phone: { type: 'string', description: 'رقم كويتي، بمفتاح الدولة أو بدونه' },
        governorate: { type: 'string', description: 'محافظة الطلب — من قائمة meta' },
        pickup_area: { type: 'string' },
        pickup_block: { type: 'string' },
        pickup_address: { type: 'string', description: 'نصّ حرّ إن لم تكن المنطقة معروفة' },
        dropoff_area: { type: 'string' },
        dropoff_block: { type: 'string' },
        dropoff_address: { type: 'string' },
        vehicle: { type: 'string', default: 'sedan' },
        priority: { type: 'string', enum: ['normal', 'urgent'], default: 'normal' },
        cod_amount: { type: 'number', description: 'المبلغ المطلوب تحصيله من الزبون' },
        notes: { type: 'string' },
      },
      required: ['customer_name', 'customer_phone', 'governorate'],
    },
    run: (a) => call('POST', '/api/orders', { body: a }),
  },
  {
    name: 'price_order',
    title: 'سعّر طلبًا',
    description:
      'يضع رسوم التوصيل والمبلغ المحصَّل. **يكتب ويمسّ المال**: تُؤخذ لقطة '
      + 'العمولة ساعتها. ولا يقع إلّا قبل قبول الكابتن — بعده الاتفاق قائم.',
    inputSchema: {
      type: 'object',
      properties: {
        order: { type: 'string', description: 'رمز الطلب أو معرّفه' },
        delivery_fee: { type: 'number', description: 'رسوم التوصيل بالدينار' },
        cod_amount: { type: 'number' },
      },
      required: ['order', 'delivery_fee'],
    },
    run: async (a) => call('PATCH', `/api/orders/${await resolveOrderId(a.order)}/pricing`, {
      body: { delivery_fee: a.delivery_fee, cod_amount: a.cod_amount },
    }),
  },
  {
    name: 'assign_order',
    title: 'أسنِد طلبًا لكابتن',
    description: 'يسنِد الطلب إلى كابتن بمعرّفه. **يكتب**. استعمل nearest_captains أولًا.',
    inputSchema: {
      type: 'object',
      properties: {
        order: { type: 'string' },
        agent_id: { type: 'integer', description: 'معرّف الكابتن' },
        note: { type: 'string' },
      },
      required: ['order', 'agent_id'],
    },
    run: async (a) => call('POST', `/api/orders/${await resolveOrderId(a.order)}/assign`, {
      body: { agent_id: a.agent_id, note: a.note },
    }),
  },
  {
    name: 'nearest_captains',
    title: 'أقرب كابتن للاستلام',
    description:
      'يرتّب الكباتن بقربهم من نقطة استلام الطلب. يقرأ ولا يُسند. '
      + 'ويحتاج أن يكون للطلب دبّوس استلام ولمن يُرشَّح موقعٌ حديث.',
    inputSchema: {
      type: 'object',
      properties: {
        order: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
        include_unavailable: { type: 'boolean', default: false },
      },
      required: ['order'],
    },
    run: async (a) => call('GET', `/api/orders/${await resolveOrderId(a.order)}/nearest`, {
      query: { limit: a.limit, include_unavailable: a.include_unavailable ? '1' : '' },
    }),
  },
  {
    name: 'ask',
    title: 'اسأل معرفة موصول',
    description:
      'يجيب من معرفة موصول المكتوبة (الأسئلة الشائعة وقواعد العمل) ومن حالة '
      + 'الطلبات التي يراها الحساب. يقرأ ويقترح ولا يكتب. وما لا جواب موثوق له '
      + 'يُحال إلى إنسان بدل أن يُخمَّن.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'السؤال بالعربية' } },
      required: ['text'],
    },
    run: (a) => call('POST', '/api/agent/ask', { body: { text: a.text } }),
  },
  {
    name: 'meta',
    title: 'مناطق الكويت وقوائم النظام',
    description:
      'مناطق الكويت مرتّبةً بمحافظاتها، وحالات الطلب وأنواع المركبات والأولويات '
      + 'والصلاحيات. لا يحتاج حسابًا. استعمله لتعرف الاسم الصحيح للمنطقة أو '
      + 'المحافظة قبل create_order.',
    inputSchema: { type: 'object', properties: {} },
    run: () => callPublic('GET', '/api/meta'),
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** ما يُعرض للعميل: بلا `run` — هي تنفيذٌ لا عقد */
const listed = () => TOOLS.map(({ run, ...t }) => t);

/* ----------------------------- البروتوكول ----------------------------- */

/* نسخ البروتوكول التي يتكلّمها هذا الخادم. يُردّ على العميل بنسخته إن
   عرفناها، وإلّا بأحدث ما نعرف — وهو ما تنصّ عليه المواصفة. */
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = VERSIONS[0];

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

/** نتيجة أداة: نصٌّ فيه JSON — والعربية تبقى عربيةً لا هروبًا */
const toolResult = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

/**
 * خطأ الأداة يعود **في النتيجة** لا خطأً في البروتوكول.
 * والفرق ليس شكليًّا: خطأ البروتوكول يراه العميل عطبًا في الاتّصال فيقطعه،
 * وخطأ الأداة يراه النموذج جوابًا فيصحّح ويعيد. و«ليست من مناطق الكويت»
 * جوابٌ يُبنى عليه، لا عطب.
 */
const toolError = (message) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const want = params && params.protocolVersion;
      return reply(id, {
        protocolVersion: VERSIONS.includes(want) ? want : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mawsool', title: 'موصول', version: require('../package.json').version },
        instructions:
          'أدوات مكتب موصول لتوصيل الطلبات في الكويت. الأدوات التي تكتب '
          + '(create_order، price_order، assign_order) تقع باسم الحساب الذي '
          + 'يعمل به الخادم وتُقيَّد عليه في السجلّ — فراجع مع صاحب الطلب قبلها. '
          + 'والمناطق تُؤخذ من meta لا من الذاكرة.',
      });
    }

    /* إشعارٌ لا ردّ له. والردّ عليه خطأ: العميل ينتظر رسالةً بمعرّف لا هذه. */
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;

    case 'ping':
      return reply(id, {});

    case 'tools/list':
      return reply(id, { tools: listed() });

    case 'tools/call': {
      const name = params && params.name;
      const tool = BY_NAME.get(name);
      if (!tool) return reply(id, toolError(`لا أداة باسم «${name}»`));
      try {
        const data = await tool.run((params && params.arguments) || {});
        return reply(id, toolResult(data));
      } catch (err) {
        log('أداة', name, 'أخفقت:', err.message);
        return reply(id, toolError(err.message || 'أخفقت الأداة'));
      }
    }

    default:
      if (isNotification) return;               // إشعارٌ مجهول يُهمَل بصمت
      return fail(id, -32601, `طريقة غير معروفة: ${method}`);
  }
}

/* ------------------------------ المجرى ------------------------------ */

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return fail(null, -32700, 'JSON غير صالح');
  }
  /* الدفعات (مصفوفة رسائل) نُزعت من المواصفة في ٢٠٢٥-٠٦-١٨ — تُرفض بوضوح
     بدل أن تُقرأ نصف قراءة. */
  if (Array.isArray(msg)) return fail(null, -32600, 'الدفعات غير مدعومة');
  handle(msg).catch((err) => {
    log('خطأ غير متوقَّع:', err && err.stack ? err.stack : String(err));
    if (msg && msg.id !== undefined && msg.id !== null) {
      fail(msg.id, -32603, err && err.message ? err.message : 'خطأ داخلي');
    }
  });
});

rl.on('close', () => process.exit(0));

log(`جاهز · ${TOOLS.length} أدوات · الواجهة ${BASE}${USER ? ' · بحساب ' + USER : ' · بلا حساب'}`);

module.exports = { TOOLS, handle, VERSIONS };
