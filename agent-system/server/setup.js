'use strict';
/**
 * التهيئة الأولى: ينشئ **حساب مدير واحدًا فقط** وقاعدة نظيفة بلا أي بيانات.
 *
 *   npm run setup
 *
 * لا حسابات تجريبية ولا طلبات وهمية ولا كلمات مرور منشورة. كلمة المرور تُولَّد
 * عشوائيًا وتُطبع **مرة واحدة** ولا تُحفظ في أي مكان بنصّها، إلا أن تحدّدها بنفسك:
 *
 *   MAWSOOL_ADMIN_USERNAME=ops MAWSOOL_ADMIN_PASSWORD='...' npm run setup
 *
 * يرفض العمل إذا كانت القاعدة تحوي حسابات أصلًا — التهيئة لا تُشغَّل مرتين.
 */
require('./env').load();

const crypto = require('node:crypto');
const { db, now, logAgentEvent } = require('./db');
const { hashPassword } = require('./auth');

const USERNAME = (process.env.MAWSOOL_ADMIN_USERNAME || 'admin').toLowerCase();
const NAME = process.env.MAWSOOL_ADMIN_NAME || 'مدير العمليات';
const PHONE = process.env.MAWSOOL_ADMIN_PHONE || '';

/** كلمة مرور قوية مقروءة: بلا حروف تلتبس بالأرقام (0/O و1/l/I) */
function generatePassword(length = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const existing = db.prepare('SELECT COUNT(*) AS n FROM agents').get().n;
if (existing > 0) {
  console.error(
    `\nالقاعدة تحتوي على حسابات بالفعل (${existing}) — لم يُغيَّر شيء.\n` +
    'التهيئة الأولى تعمل على قاعدة فارغة فقط. لبناء قاعدة جديدة احذف ملف\n' +
    'قاعدة البيانات ثم أعد التشغيل.\n'
  );
  process.exit(1);
}

if (process.env.MAWSOOL_ADMIN_PASSWORD && process.env.MAWSOOL_ADMIN_PASSWORD.length < 10) {
  console.error('\nكلمة مرور المدير قصيرة — استخدم ١٠ محارف على الأقل.\n');
  process.exit(1);
}

const password = process.env.MAWSOOL_ADMIN_PASSWORD || generatePassword();
const generated = !process.env.MAWSOOL_ADMIN_PASSWORD;

const info = db.prepare(
  `INSERT INTO agents (name, username, phone, password_hash, role, vehicle, governorate,
                       availability, active, approval, approval_at, created_at)
   VALUES (?, ?, ?, ?, 'admin', 'sedan', '', 'offline', 1, 'approved', ?, ?)`
).run(NAME, USERNAME, PHONE, hashPassword(password), now(), now());

logAgentEvent({
  agentId: Number(info.lastInsertRowid), actorId: null,
  type: 'created', to: 'approved', note: 'التهيئة الأولى',
});

const line = '─'.repeat(54);
console.log(`
${line}
  جاهز. أُنشئ حساب مدير واحد، والقاعدة فارغة تمامًا.

  اسم المستخدم : ${USERNAME}
  كلمة المرور  : ${password}
${generated ? `
  ⚠ هذه الكلمة مولّدة عشوائيًا وتُعرض الآن فقط — لن تظهر مرة أخرى.
    انسخها إلى مكان آمن قبل إغلاق الطرفية.` : ''}
${line}

الخطوة التالية:  npm start
`);
