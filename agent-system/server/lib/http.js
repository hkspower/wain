'use strict';
/** أدوات مساعدة لخادم HTTP: قراءة الجسم، الردود، الكوكيز، والأخطاء */

const MAX_BODY = 256 * 1024; // 256 ك.ب

class HttpError extends Error {
  constructor(status, message, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (m, c) => new HttpError(400, m, c);
const unauthorized = (m = 'الجلسة غير صالحة، الرجاء تسجيل الدخول') => new HttpError(401, m);
const forbidden = (m = 'ليست لديك صلاحية لهذا الإجراء') => new HttpError(403, m);
const notFound = (m = 'العنصر غير موجود') => new HttpError(404, m);
const conflict = (m, c) => new HttpError(409, m, c);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'حجم الطلب كبير جدًا'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(badRequest('صيغة البيانات المرسلة غير صحيحة'));
      }
    });
    req.on('error', reject);
  });
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

function num(value, field, { min = 0, max = 1e9, required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw badRequest(`الحقل «${field}» مطلوب`);
    return 0;
  }
  const n = Number(value);
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
  HttpError, badRequest, unauthorized, forbidden, notFound, conflict,
  readBody, sendJson, parseCookies, cookie,
  str, num, oneOf, id, MAX_BODY,
};
