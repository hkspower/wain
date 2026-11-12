-- ===========================================================================
-- Sporta — refunds and voids made in the KPay portal, and second captures.
--
-- Additive, and idempotent: importing it twice changes nothing. Byte-for-byte
-- the same statements as the "refunds" section at the end of schema.mysql.sql,
-- which shapes a fresh install; this file is for a database installed before
-- it (the live one). Import it BEFORE the PHP that records refunds goes live
-- (payment-records.php, the knet_refund_* routes in admin.php, the duplicate
-- capture alert in php-knet/knet.php). Until then:
--   * /backends cannot record a refund or a void: the routes answer 503
--     refunds_migration_missing and change nothing;
--   * a second capture on a paid order is still written to the payment log
--     (callback.duplicate_capture), but no alert row can be kept;
--   * revenue, the dashboard and the XBRL export read refunded_amount only
--     when the column exists (store_column_exists), so they keep working.
--
-- WHY THIS EXISTS (KNET-K063-CHECK.md B1, B2, B3, B8, B9, C10). A refund or a
-- void is something only a person can do, in the KPay merchant portal
-- (K-063 §4.1, §4.2): the shop never sends a credit (action 2) or a void, and
-- the bank does not tell the shop when one is made. Before this, a refunded
-- order stayed "paid" for ever: in revenue, in the XBRL export, and, when it
-- had not shipped, on its way to the customer, because a paid order cannot be
-- cancelled (409 order_paid). Now the owner RECORDS what they did in KPay:
--
--   order_refunds     one row per refund or void, with the KNET Payment ID it
--                     was made against, the amount, the KPay reference if the
--                     portal showed one, who recorded it, and the browser's
--                     idempotency key (a double click records one row).
--   orders.refunded_amount
--                     the running total of the order's own refunds, kept in the
--                     same transaction as the rows, so revenue is "paid minus
--                     refunded" without a join on every dashboard read.
--   orders.gateway_attempt_ref
--                     the Merchant Track ID of the bank answer the order records
--                     (<track> or <track>A<n>), for the receipt and the KPay check.
--   payment_status    two more values. 'refunded': every fils of the payment
--                     went back by Credit. 'voided': the transaction was voided
--                     before it settled. A PARTIAL refund leaves the order
--                     'paid' (the customer keeps the order) and only lowers the
--                     revenue it counts for. varchar(10) already fits both.
--   payment_alerts    a second CAPTURED payment the order does not record: the
--                     customer was charged twice (K-063 B3, C1). Written by the
--                     KNET settlement (callback or inquiry) in the same
--                     transaction as its decision; one row per extra Payment ID
--                     (the unique key makes a replay of the same notification a
--                     no-op). The owner refunds that payment in KPay and records
--                     it here, or dismisses the alert after checking.
--
-- DROP ... IF EXISTS then ADD for the CHECK: MariaDB has no ALTER ... ADD
-- CONSTRAINT IF NOT EXISTS (same as outbox-kinds.mysql.sql). The widened list
-- accepts every row the old one did.
-- ===========================================================================

alter table orders drop constraint if exists orders_payment_status_ck;
alter table orders
  add constraint orders_payment_status_ck
  check (payment_status in ('pending','paid','failed','review','refunded','voided'));

alter table orders add column if not exists refunded_amount decimal(10,3) not null default 0
  after amount;

-- The Merchant Track ID the recorded bank answer came back under: the order's
-- track id for a first attempt, <track>A<n> for a retry (php-knet/knet.php
-- knet_attempt_ref_for). KPay lists a payment under THIS reference, and the
-- customer's receipt shows it as the Track ID (K-063 C4, D1). Written by the
-- KNET settlement in a savepoint of its own, so a database without this column
-- loses the reference, never the payment.
alter table orders add column if not exists gateway_attempt_ref varchar(30) null
  after pay_attempt;

create table if not exists order_refunds (
  id             int unsigned auto_increment primary key,
  order_id       int unsigned not null,
  -- 'refund': KPay Credit (all of the payment, or part of it). 'void': the
  -- whole transaction voided before settlement; never partial.
  kind           varchar(8)    not null,
  amount         decimal(10,3) not null,
  -- 'order': the order's own payment (orders.cbk_paymentid).
  -- 'duplicate': a second capture the order never recorded (payment_alerts).
  scope          varchar(10)   not null default 'order',
  alert_id       int unsigned  null,
  -- The KNET Payment ID the refund or void was made against, as the portal
  -- shows it. For scope 'order' it must equal the order's own Payment ID.
  payment_id     varchar(60)   not null,
  -- The reference KPay gives the Credit or Void, when the portal shows one.
  kpay_reference varchar(60)   null,
  note           varchar(280)  null,
  -- The browser's key for THIS submission: a second POST with the same key
  -- (a double click, a retry after a lost answer) is answered with the first
  -- row and records nothing.
  request_key    char(32)      not null,
  actor_admin_id int unsigned  null,
  actor_email    varchar(120)  not null,
  created_at     timestamp     not null default current_timestamp,
  unique key uq_order_refunds_request (request_key),
  key idx_order_refunds_order (order_id, id),
  key idx_order_refunds_created (created_at, id),
  constraint fk_order_refunds_order foreign key (order_id) references orders (id) on delete cascade,
  constraint fk_order_refunds_admin foreign key (actor_admin_id) references admin_users (id) on delete set null,
  constraint order_refunds_kind_ck   check (kind in ('refund','void')),
  constraint order_refunds_scope_ck  check (scope in ('order','duplicate')),
  constraint order_refunds_amount_ck check (amount > 0)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists payment_alerts (
  id               int unsigned auto_increment primary key,
  order_id         int unsigned  not null,
  kind             varchar(24)   not null,
  gateway          varchar(10)   not null,
  -- The captured payment the order does NOT record: the one to refund.
  payment_id       varchar(60)   not null,
  -- The payment the order DOES record (null when it had none).
  order_payment_id varchar(60)   null,
  -- What the bank said it captured under payment_id (null when unknown).
  amount           decimal(10,3) null,
  transaction_id   varchar(60)   null,
  reference        varchar(60)   null,
  -- The reference the bank echoed (the order's track id, or <track>A<n>).
  attempt_ref      varchar(40)   null,
  -- Which reader saw it: the bank's notification or the stock sweeper's inquiry.
  source           varchar(10)   not null,
  resolution       varchar(10)   null,
  resolved_by      varchar(120)  null,
  resolved_at      timestamp     null,
  created_at       timestamp     not null default current_timestamp,
  unique key uq_payment_alerts (order_id, kind, payment_id),
  key idx_payment_alerts_open (resolved_at, id),
  constraint fk_payment_alerts_order foreign key (order_id) references orders (id) on delete cascade,
  constraint payment_alerts_kind_ck       check (kind in ('duplicate_capture')),
  constraint payment_alerts_gateway_ck    check (gateway in ('knet')),
  constraint payment_alerts_source_ck     check (source in ('callback','inquiry')),
  constraint payment_alerts_resolution_ck check (resolution is null or resolution in ('refunded','voided','dismissed'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
