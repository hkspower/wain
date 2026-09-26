-- ===========================================================================
-- Sporta — WhatsApp order updates to the CUSTOMER.
--
-- Additive, and byte-for-byte the same statements as the block in
-- schema.mysql.sql, so a shop set up before this feature can add it without
-- re-importing. Everything is `if not exists`; importing either file, in any
-- order, any number of times, converges on the same database.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A SEPARATE QUEUE FROM fulfilment_outbox
--
-- It looks like the same table and it is not, because it fires at a different
-- moment and that difference is the whole point.
--
-- fulfilment_outbox mails the WAREHOUSE on INSERT — before payment, on
-- purpose, because the owner would rather see an order that never gets paid
-- than miss one that does. Every message states the payment state in its
-- subject and a follow-up says ship / do not ship.
--
-- A CUSTOMER cannot be told that. "Your order is confirmed" sent before the
-- bank has agreed is a message the shop may have to retract, and a shopper
-- whose card was declined receiving a confirmation is worse than silence: they
-- stop watching for the failure, and the sale is lost quietly. So this queue is
-- written when payment SETTLES, never on insert.
--
-- The two queues also differ in what a failure costs. A warehouse email that
-- does not arrive is noticed within the hour by a person who expects it. A
-- WhatsApp template that does not arrive is noticed by nobody, so the row is
-- kept with its error rather than deleted, and the attempt count is visible.
-- ===========================================================================

-- The language the customer was actually READING when they ordered.
--
-- Without this the shop has to guess, and both guesses are wrong often enough
-- to matter: this is a bilingual store in a country that is roughly 70%
-- expatriate, so neither "everyone here reads Arabic" nor "default to English"
-- is true. The checkout knows — the UI was rendered in one language or the
-- other — so it is recorded rather than inferred, exactly like the address.
--
-- NULL means an order placed before this column existed. The sender treats
-- NULL as Arabic, because the alternative is sending English to a customer who
-- chose Arabic, and an Arabic reader who receives English is a worse outcome
-- here than the reverse: the English template is legible to most Gulf
-- shoppers, an Arabic one is not to an expatriate, but the shop's own default
-- and its Arabic-first policy make Arabic the honest fallback.
-- ROW FORMAT FIRST. `orders` is by far the widest table in this schema — 40
-- columns and about 6.9 kB of declared width, against InnoDB's 8126-byte
-- ceiling — and every additive migration here makes it wider. A table created
-- without an explicit ROW_FORMAT is rebuilt by ALTER using the server's
-- default, and on a server whose default is not DYNAMIC that rebuild fails
-- with "Row size too large ... maximum row size ... is 8126" — refusing a
-- migration that only ADDS a nullable column, or even one that DROPS one.
-- Measured on MariaDB 10.11: `alter table orders drop column utm_source`
-- failed, and the same statement with `row_format=DYNAMIC` in front of it
-- succeeded on the identical table.
--
-- Stating it here is idempotent (it is already DYNAMIC on a healthy install,
-- and the ALTER is then a no-op rebuild of a small table) and it is what lets
-- this file run on a shop that was set up before it existed.
alter table orders row_format=DYNAMIC;
alter table orders add column if not exists customer_lang varchar(2) null after customer_note;

-- ------------------------------------------------------------ whatsapp_outbox
create table if not exists whatsapp_outbox (
  id         int unsigned auto_increment primary key,
  order_id   int unsigned not null,
  -- 'confirmed' the bank settled and the order is real
  -- 'shipped'   it left the warehouse
  kind       varchar(12) not null,
  -- E.164 WITHOUT the plus, which is what the Cloud API wants: 96599887766.
  -- Snapshotted at queue time rather than joined at send time, so correcting a
  -- customer's number in the admin cannot silently redirect a message that was
  -- already queued for the old one.
  to_e164    varchar(20) not null,
  -- The approved template name and the language it was queued for, both
  -- snapshotted for the same reason: renaming a template in Meta's console
  -- must not rewrite what an already-queued message claims to be.
  template   varchar(80) not null,
  lang       varchar(5)  not null default 'ar',
  payload    json not null,
  created_at timestamp not null default current_timestamp,
  sent_at    timestamp null,
  attempts   int not null default 0,
  last_error varchar(500) null,
  -- The message id Meta hands back, so a delivery question has an answer that
  -- does not depend on anyone's memory.
  wa_message_id varchar(120) null,
  -- ONE message per order per kind, enforced by the index and not by care.
  -- A callback that fires twice — which KNET's does, through the customer's
  -- browser — must not send the customer two confirmations. Unlike the
  -- warehouse's 'payment' rows there is no legitimate repeat here: an order
  -- is confirmed once and shipped once.
  constraint uq_wa_once unique (order_id, kind),
  constraint fk_wa_order foreign key (order_id) references orders (id) on delete cascade,
  constraint wa_kind_ck check (kind in ('confirmed','shipped','review'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- The cron claims pending work every few minutes from a table that only grows
-- — sent rows are KEPT, because they are the record that the customer was
-- told. Same index shape, and same reason, as idx_outbox_pending.
create index if not exists idx_wa_pending on whatsapp_outbox (sent_at, attempts, created_at);
