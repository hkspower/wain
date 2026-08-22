'use strict';
/** أدوات مساعدة لخادم HTTP: قراءة الجسم، الردود، الكوكيز، والأخطاء */

const ar = require('arabic-kit');

const MAX_BODY = 256 * 1024; // 256 ك.ب

class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* كل المساعدات تقبل رمز خطأ اختياريًا حتى تستطيع الواجهة التصرّف بحسبه */
const badRequest = (m, c) => new HttpError(400, m, c);
const unauthorized = (m = 'الجلسة غير صالحة، الرجاء تسجيل الدخول', c) => new HttpError(401, m, c);
const forbidden = (m = 'ليست لديك صلاحية لهذا الإجراء', c) => new HttpError(403, m, c);
const notFound = (m = 'العنصر غير موجود', c) => new HttpError(404, m, c);
const conflict = (m, c) => new HttpError(409, m, c);

/** يقرأ الجسم خامًا بحدّ حجم مخصّص — الملاحظات الصوتية أكبر من حدّ JSON */
function readRawBody(req, maxBytes = MAX_BODY) {
  // الرفض من الترويسة قبل قراءة بايت واحد: قطع الاتصال في منتصف الرفع يصل
  // المستخدم كـ«فشل الشبكة» بدل رسالة تشرح أن الملف أكبر من الحدّ.
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume(); // نصرّف ما وصل حتى يُسلَّم الردّ سليمًا
    return Promise.reject(new HttpError(413, 'حجم الطلب كبير جدًا', 'too_large'));
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new HttpError(413, 'حجم الطلب كبير جدًا'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readBody(req) {
  const raw = await readRawBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('صيغة البيانات المرسلة غير صحيحة');
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, { maxAge, expires } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.MAWSOOL_SECURE_COOKIE === '1') bits.push('Secure');
  if (maxAge != null) bits.push(`Max-Age=${maxAge}`);
  if (expires) bits.push(`Expires=${expires}`);
  return bits.join('; ');
}

/* ---- التحقق من المدخلات ---- */

function str(value, field, { required = true, min = 0, max = 500 } = {}) {
  const v = value == null ? '' : String(value).trim();
  if (!v && required) throw badRequest(`الحقل «${field}» مطلوب`);
  if (v && v.length < min) throw badRequest(`الحقل «${field}» قصير جدًا`);
  if (v.length > max) throw badRequest(`الحقل «${field}» أطول من الحد المسموح`);
  return v;
}

/*
 * `Number('٢٥')` تعطي NaN، و«٢٫٥» كذلك — الفاصلة العربية ليست نقطة. فكل
 * رقمٍ يصل الخادم بالعربية كان يُردّ «يجب أن يكون رقمًا». الواجهة تُطبّع
 * قبل الإرسال، لكن الخادم يُطرق من غيرها: رابط الكابتن، والتكاملات،
 * والطلب المنطوق. والقاعدة في هذا النظام أن **الخادم هو الحكم** — كما في
 * رقم القطعة — لا أن يعتمد على تهذيب الواجهة.
 */
/*
 * الهاتف يُكتب بأرقام عربية على لوحة عربية، فيُخزَّن «٩٩٨٨٧٧٦٦» كما هو.
 * والرقم بعدها يدخل في `tel:` وفي رسالة واتساب وفي البحث — فلا يتّصل به
 * هاتف، ولا يطابقه بحث، ويصل الكابتن رابطٌ لا يعمل. تحويلُ الأرقام ليس
 * تخمينًا: هو الرقم نفسه بحروف أخرى. أمّا مفتاح الدولة فلا يُخترع — من
 * كتب بلا مفتاح فقد قصد ما كتب.
 */
function phone(value, field, opts = {}) {
  const raw = str(value, field, opts);
  if (!raw) return raw;
  const latin = ar.toLatin(raw);
  // تُحذف الفراغات والشرطات والأقواس، ويبقى «+» في أوّله إن وُجد
  const plus = /^\s*\+/.test(latin) ? '+' : '';
  return plus + latin.replace(/[^0-9]/g, '');
}

function num(value, field, { min = 0, max = 1e9, required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw badRequest(`الحقل «${field}» مطلوب`);
    return 0;
  }
  const n = Number(typeof value === 'string' ? ar.toLatin(value).trim() : value);
  if (!Number.isFinite(n)) throw badRequest(`الحقل «${field}» يجب أن يكون رقمًا`);
  if (n < min || n > max) throw badRequest(`قيمة «${field}» خارج النطاق المسموح`);
  return n;
}

function oneOf(value, field, allowed) {
  const v = String(value ?? '').trim();
  if (!allowed.includes(v)) throw badRequest(`قيمة «${field}» غير مقبولة`);
  return v;
}

function id(value, field = 'المعرّف') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field} غير صحيح`);
  return n;
}

module.exports = {
  phone,
  HttpError, badRequest, unauthorized, forbidden, notFound, conflict,
  readBody, readRawBody, sendJson, parseCookies, cookie,
  str, num, oneOf, id, MAX_BODY,
};
