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
`);

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

module.exports = { db, now, nextOrderCode, logEvent, DB_FILE, DATA_DIR };
