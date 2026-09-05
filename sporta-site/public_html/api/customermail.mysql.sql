-- ===========================================================================
-- Sporta — the customer's own copy of their order, by email.
--
-- Additive, and byte-for-byte the same statements as the block in
-- schema.mysql.sql, so a shop set up before this feature can add it without
-- re-importing. Everything is `if not exists`; importing either file, in any
-- order, any number of times, converges on the same database.
--
-- ---------------------------------------------------------------------------
-- ROW FORMAT FIRST, and this file genuinely needs it rather than copying a
-- habit. `orders` is the widest table in this schema — about 6.9 kB of declared
-- width against InnoDB's 8126-byte ceiling — and this migration makes it wider
-- still. A table created without an explicit ROW_FORMAT is rebuilt by ALTER
-- using the server's default, and on a server whose default is not DYNAMIC that
-- rebuild fails with "Row size too large", refusing a migration that only ADDS
-- one nullable column.
--
-- It is idempotent: already DYNAMIC on a healthy install, where this is a no-op
-- rebuild.
alter table orders row_format=DYNAMIC;

set names utf8mb4;

-- ---------------------------------------------------------------------------
-- WHY THE COLUMN IS NULLABLE WHEN THE FIELD IS REQUIRED
--
-- The checkout demands an email from today onward, and api.php refuses an order
-- without a valid one. But every order placed BEFORE this migration has none,
-- and there is no honest value to backfill: '' would be a lie the sender would
-- try to deliver to, and a placeholder address is worse. NULL says "this order
-- predates the field", which is true, and store_queue_customer_mail() skips it
-- rather than queueing a message with nowhere to go.
alter table orders add column if not exists customer_email varchar(120) null
  after customer_phone;

-- ---------------------------------------------------------------------------
-- WHY THIS IS A FOURTH QUEUE AND NOT A SECOND ROW IN fulfilment_outbox
--
-- It looks like the warehouse queue and it is not, and the difference is the
-- recipient. fulfilment_outbox goes to ONE address the shop controls; a failure
-- there is noticed within the hour by a person who was expecting a picking
-- list. This goes to a stranger's mailbox, one per order, and a failure is
-- noticed by nobody — so the row keeps its error and its attempt count, and the
-- admin can see which customers were never actually written to.
--
-- Mixing them would also mean one queue where a warehouse outage holds up
-- customer receipts, and where the retry budget is shared between two messages
-- that fail for completely different reasons.
--
-- IT FIRES ON INSERT, before payment, because the owner asked for "any new
-- order" and because a receipt is the one customer message that is honest
-- before the bank has answered: it says what was ordered and what is owed, and
-- it names the payment state rather than congratulating anybody. That is the
-- distinction whatsapp_outbox exists to protect — "your order is confirmed"
-- must still wait for the money — and this queue does not break it.
create table if not exists customer_mail_outbox (
  id         int unsigned  not null auto_increment primary key,
  order_id   int unsigned  not null,
  kind       varchar(24)   not null default 'received',
  -- The address SNAPSHOT. Reading orders.customer_email at send time would
  -- mean an address corrected by an admin ten minutes later silently changes
  -- who this message was for, and the row would no longer record where it
  -- actually went.
  to_email   varchar(120)  not null,
  -- The language the customer was READING at checkout, frozen here for the
  -- same reason. NULL is not possible: the caller resolves it to ar or en.
  lang       varchar(2)    not null default 'ar',
  created_at timestamp     not null default current_timestamp,
  sent_at    timestamp     null,
  attempts   int           not null default 0,
  last_error varchar(500)  null,
  -- One 'received' mail per order, enforced rather than hoped: a double-tapped
  -- Pay button posts the same order twice, and two receipts for one purchase
  -- is how a shop teaches people its mail is noise.
  unique key uniq_customer_mail (order_id, kind),
  constraint fk_customer_mail_order foreign key (order_id) references orders (id)
    on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_customer_mail_unsent
  on customer_mail_outbox (sent_at, attempts, created_at);
