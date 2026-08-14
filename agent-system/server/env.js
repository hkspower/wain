'use strict';
/**
 * يحمّل ملف `.env` من جذر المشروع إن وُجد.
 *
 * Node لا يقرأ `.env` تلقائيًا، فبدون هذا يبقى الملف الذي نوزّعه (.env.example)
 * زينةً لا أثر لها، ويظنّ من نسخه أن الضبط سرى. يُستدعى أول سطر في كل مدخل
 * تشغيل (الخادم والبيانات التجريبية) قبل قراءة أي متغيّر.
 *
 * متغيّرات البيئة الحقيقية تفوز دائمًا: من صدّر قيمة في الطرفية أو في وحدة
 * الخدمة يقصد تجاوز الملف.
 */
const fs = require('node:fs');
const path = require('node:path');

const ENV_FILE = process.env.MAWSOOL_ENV_FILE || path.join(__dirname, '..', '.env');

function parse(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // اقتباس اختياري حول القيم التي فيها مسافات
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let loaded = false;
function load() {
  if (loaded) return {};
  loaded = true;
  if (!fs.existsSync(ENV_FILE)) return {};
  const values = parse(fs.readFileSync(ENV_FILE, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return values;
}

module.exports = { load, parse, ENV_FILE };
