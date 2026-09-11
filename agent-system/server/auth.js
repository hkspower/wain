'use strict';
/**
 * المصادقة — تجزئة كلمات المرور بـ scrypt وجلسات مخزّنة في قاعدة البيانات.
 * لا نستخدم أي مكتبة خارجية: كل شيء من node:crypto.
 */
const crypto = require('node:crypto');
const { db, now } = require('./db');

const SESSION_DAYS = 14;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, keyHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    // مقارنة ثابتة الزمن لتفادي تسريب المعلومات عبر توقيت الاستجابة
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function createSession(agentId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, agent_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, agentId, now(), expires);
  return { token, expires };
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** يعيد المندوب صاحب الجلسة، أو null إذا كانت الجلسة غير صالحة أو منتهية */
function agentFromToken(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT a.* FROM sessions s
       JOIN agents a ON a.id = s.agent_id
      WHERE s.token = ? AND s.expires_at > ? AND a.active = 1`
  ).get(token, now());
  return row || null;
}

/** حذف الجلسات المنتهية — يُستدعى دوريًا */
function pruneSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
}

/* ---- حدّ محاولات تسجيل الدخول (في الذاكرة) ----
 *
 * حدّان لا حدّ واحد:
 *   • «العنوان|المستخدم» ضيّق (٨) — يوقف التخمين من مصدر واحد.
 *   • «المستخدم» وحده واسع (٤٠) — يبقي سقفًا حين يأتي التخمين من عناوين
 *     كثيرة، وهو ما يحدث فعلًا خلف وسيط أو من شبكة موزّعة.
 *
 * الحدّ الثاني واسع عمدًا: لو ضُيِّق لصار سلاح تعطيل — يكفي غريب يخمّن
 * ثماني مرات ليقفل حساب المدير عن صاحبه. أربعون محاولة في عشر دقائق لا
 * يبلغها مستخدم حقيقي، وتُبقي التخمين مقيّدًا بدل أن يكون بلا سقف.
 */
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const MAX_ATTEMPTS_USER = 40;
const WINDOW_MS = 10 * 60_000;

/** يُسقط السجلّات المنتهية حتى لا تنمو الخريطة بلا حدّ من مفاتيح ميّتة */
function sweep() {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, rec] of attempts) if (rec.first < cutoff) attempts.delete(k);
}

function allowed(key, max) {
  const rec = attempts.get(key);
  if (!rec) return true;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return true; }
  return rec.count < max;
}

function bump(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else rec.count += 1;
}

/** يُمرَّر العنوان واسم المستخدم منفصلين ليُفحص المفتاحان معًا */
function loginAllowed(ip, username) {
  if (attempts.size > 5000) sweep();
  return allowed(`${ip}|${username}`, MAX_ATTEMPTS) && allowed(`u|${username}`, MAX_ATTEMPTS_USER);
}

function recordFailure(ip, username) {
  bump(`${ip}|${username}`);
  bump(`u|${username}`);
}

function clearFailures(ip, username) {
  attempts.delete(`${ip}|${username}`);
  attempts.delete(`u|${username}`);
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession,
  agentFromToken, pruneSessions, loginAllowed, recordFailure, clearFailures,
  SESSION_DAYS,
};
