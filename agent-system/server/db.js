'use strict';
/**
 * قاعدة البيانات — SQLite
 * ملف واحد على القرص، بلا خادم قاعدة بيانات منفصل.
 */
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.MAWSOOL_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = process.env.MAWSOOL_DB || path.join(DATA_DIR, 'mawsool.db');
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  username      TEXT    NOT NULL UNIQUE,
  phone         TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'agent')),
  vehicle       TEXT    NOT NULL DEFAULT 'sedan'
                        CHECK (vehicle IN ('sedan', 'van', 'reefer', 'bike')),
  governorate   TEXT    NOT NULL DEFAULT '',
  availability  TEXT    NOT NULL DEFAULT 'offline'
                        CHECK (availability IN ('available', 'busy', 'offline')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_agent ON sessions(agent_id);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY,
  code            TEXT    NOT NULL UNIQUE,
  customer_name   TEXT    NOT NULL,
  customer_phone  TEXT    NOT NULL,
  pickup_address  TEXT    NOT NULL,
  dropoff_address TEXT    NOT NULL,
  governorate     TEXT    NOT NULL DEFAULT '',
  vehicle         TEXT    NOT NULL DEFAULT 'sedan'
                          CHECK (vehicle IN ('sedan', 'van', 'reefer', 'bike')),
  cod_amount      REAL    NOT NULL DEFAULT 0,
  delivery_fee    REAL    NOT NULL DEFAULT 0,
  priority        TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  notes           TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL CHECK (status IN
                    ('new','assigned','accepted','picked_up','on_the_way',
                     'delivered','failed','returned','cancelled')),
  agent_id        INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  created_by      INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  failure_reason  TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  delivered_at    TEXT
);
CREATE INDEX IF NOT EXISTS ix_orders_agent  ON orders(agent_id);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS transfers (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  to_agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  reason        TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  response_note TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_transfers_to   ON transfers(to_agent_id, status);
CREATE INDEX IF NOT EXISTS ix_transfers_from ON transfers(from_agent_id, status);
/* طلب تحويل معلّق واحد فقط لكل طلب في أي لحظة */
CREATE UNIQUE INDEX IF NOT EXISTS ux_transfers_one_pending
  ON transfers(order_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  type       TEXT    NOT NULL,
  from_value TEXT    NOT NULL DEFAULT '',
  to_value   TEXT    NOT NULL DEFAULT '',
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_order ON events(order_id);

CREATE TABLE IF NOT EXISTS locations (
  id          INTEGER PRIMARY KEY,
  agent_id    INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  lat         REAL    NOT NULL,
  lng         REAL    NOT NULL,
  accuracy    REAL,
  speed       REAL,
  heading     REAL,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  recorded_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_locations_agent ON locations(agent_id, recorded_at DESC);

/* سجل من اطّلع على موقع أي مندوب — الشفافية شرط للثقة */
CREATE TABLE IF NOT EXISTS location_views (
  id        INTEGER PRIMARY KEY,
  viewer_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  agent_id  INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  viewed_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_location_views_agent ON location_views(agent_id, viewed_at DESC);

/* سجل قرارات الاعتماد على الحسابات — منفصل عن events لأن تلك مرتبطة بطلب */
CREATE TABLE IF NOT EXISTS agent_events (
  id         INTEGER PRIMARY KEY,
  agent_id   INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  type       TEXT    NOT NULL,
  from_value TEXT    NOT NULL DEFAULT '',
  to_value   TEXT    NOT NULL DEFAULT '',
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_agent_events_agent ON agent_events(agent_id, id DESC);

/* إعدادات تشغيلية يضبطها المدير من لوحة التحكم بدل تثبيتها في الكود */
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES agents(id) ON DELETE SET NULL
);

/* سجل تغييرات الإعدادات — العمولة تمسّ مستحقّات الكباتن فلا تتغيّر بلا أثر */
CREATE TABLE IF NOT EXISTS setting_events (
  id         INTEGER PRIMARY KEY,
  key        TEXT    NOT NULL,
  actor_id   INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  from_value TEXT    NOT NULL DEFAULT '',
  to_value   TEXT    NOT NULL DEFAULT '',
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_setting_events_key ON setting_events(key, id DESC);

/* رابط مهمّة يُرسل للكابتن على واتساب: يفتح صفحة بلا تسجيل دخول يمنح فيها
   موافقة الموقع، ويسجّل ملاحظة صوتية، ويبلّغ نتيجة التسليم. */
CREATE TABLE IF NOT EXISTS delivery_links (
  id          INTEGER PRIMARY KEY,
  token       TEXT    NOT NULL UNIQUE,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  agent_id    INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_by  INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  opened_at   TEXT,
  revoked_at  TEXT,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_delivery_links_order ON delivery_links(order_id, id DESC);

/* ملاحظة صوتية من الكابتن إلى الإدارة. الملف على القرص لا في القاعدة. */
CREATE TABLE IF NOT EXISTS voice_notes (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  agent_id    INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  link_id     INTEGER REFERENCES delivery_links(id) ON DELETE SET NULL,
  filename    TEXT    NOT NULL,
  mime        TEXT    NOT NULL,
  bytes       INTEGER NOT NULL,
  seconds     REAL    NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_voice_notes_order ON voice_notes(order_id, id DESC);

/* صندوق صادر البريد. يُكتب أولًا ثم يُرسل، فلا تضيع رسالة لو تعذّر SMTP. */
CREATE TABLE IF NOT EXISTS emails (
  id          INTEGER PRIMARY KEY,
  to_address  TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  status      TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'failed')),
  error       TEXT    NOT NULL DEFAULT '',
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  sent_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_emails_status ON emails(status, id DESC);

/* صندوق صادر الأحداث إلى الخارج (n8n مثلًا). يُكتب أولًا ثم يُرسل، بنفس منطق
   البريد: حدثٌ لم يصل يبقى ظاهرًا بسببه ويُعاد إرساله، ولا يضيع بصمت. */
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          INTEGER PRIMARY KEY,
  event       TEXT    NOT NULL,
  payload     TEXT    NOT NULL,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  url         TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'failed')),
  http_status INTEGER,
  error       TEXT    NOT NULL DEFAULT '',
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  sent_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_hooks_status ON webhook_deliveries(status, id DESC);
`);

/* ---- ترحيلات: أعمدة تُضاف للقواعد القائمة ---- */
const agentCols = db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name);
const addColumn = (name, ddl) => {
  if (!agentCols.includes(name)) db.exec(`ALTER TABLE agents ADD COLUMN ${name} ${ddl}`);
};
addColumn('location_consent',    'INTEGER NOT NULL DEFAULT 0');
addColumn('location_consent_at', 'TEXT');
addColumn('location_sharing',    'INTEGER NOT NULL DEFAULT 0');

/* حالة اعتماد الحساب. `active` صار مشتقًّا منها لا مستقلًّا عنها، فلا يوجد
   مفتاحان متعارضان: الحسابات المعتمدة وتحت التجربة تعمل، والمرفوضة والمحظورة لا.
   الترحيل يُسقط الحالة القديمة على الجديدة: مفعّل ← معتمد، معطّل ← محظور. */
const isNewApprovalColumn = !agentCols.includes('approval');
addColumn('approval',     "TEXT NOT NULL DEFAULT 'under_test'");
addColumn('approval_note', 'TEXT NOT NULL DEFAULT \'\'');
addColumn('approval_at',   'TEXT');
addColumn('approval_by',   'INTEGER REFERENCES agents(id) ON DELETE SET NULL');
if (isNewApprovalColumn) {
  db.exec(`UPDATE agents SET approval = CASE WHEN active = 1 THEN 'approved' ELSE 'blocked' END`);
}

/* لقطة العمولة على الطلب. تُحفظ وقت الإنشاء ولا تتغيّر بعده: تغيير العمولة في
   لوحة التحكم يجب ألّا يعيد حساب مستحقّات طلبات سابقة اتُّفق عليها. */
const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
const addOrderColumn = (name, ddl) => {
  if (!orderCols.includes(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${ddl}`);
};
addOrderColumn('commission_type',   "TEXT NOT NULL DEFAULT 'percent'");
addOrderColumn('commission_rate',   'REAL NOT NULL DEFAULT 0');
addOrderColumn('commission_amount', 'REAL NOT NULL DEFAULT 0');
addOrderColumn('agent_earning',     'REAL NOT NULL DEFAULT 0');

/* دبّوس موقع الزبون. اختياري: الطلب يُنشأ ويُسند بلا دبّوس كما كان، والدبّوس
   يفتح اقتراح الأقرب وحده. القيمة NULL تعني «لم يُلتقط» لا «الصفر». */
/* العنوان المهيكل: المنطقة والقطعة تُختاران من قائمة، والشارع يبقى حرًّا.
   النصّ الكامل يبقى في pickup_address كما كان، فلا تنكسر الطلبات القديمة. */
addOrderColumn('pickup_area',        'TEXT');
addOrderColumn('pickup_block',       'TEXT');
addOrderColumn('dropoff_governorate','TEXT');
addOrderColumn('dropoff_area',       'TEXT');
addOrderColumn('dropoff_block',      'TEXT');

addOrderColumn('pickup_lat', 'REAL');
addOrderColumn('pickup_lng', 'REAL');

/** الوقت الحالي بصيغة ISO — كل الطوابع الزمنية مخزّنة بتوقيت UTC */
const now = () => new Date().toISOString();

/** توليد رمز طلب فريد بصيغة MW-XXXX */
function nextOrderCode() {
  const row = db.prepare("SELECT code FROM orders ORDER BY id DESC LIMIT 1").get();
  const last = row ? parseInt(String(row.code).replace(/\D/g, ''), 10) : 4000;
  return 'MW-' + (Number.isFinite(last) ? last + 1 : 4001);
}

function logEvent({ orderId, actorId, type, from = '', to = '', note = '' }) {
  db.prepare(
    `INSERT INTO events (order_id, actor_id, type, from_value, to_value, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(orderId, actorId ?? null, type, String(from ?? ''), String(to ?? ''), String(note ?? ''), now());
}

/** سجل قرار على حساب (اعتماد، حظر، رفض…) — سجل غير قابل للتعديل */
function logAgentEvent({ agentId, actorId, type, from = '', to = '', note = '' }) {
  db.prepare(
    `INSERT INTO agent_events (agent_id, actor_id, type, from_value, to_value, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(agentId, actorId ?? null, type, String(from ?? ''), String(to ?? ''), String(note ?? ''), now());
}

module.exports = { db, now, nextOrderCode, logEvent, logAgentEvent, DB_FILE, DATA_DIR };
