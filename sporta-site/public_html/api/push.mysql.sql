-- ===========================================================================
-- Sporta — a push notification on the owner's phone when an order arrives.
--
-- Additive, and byte-for-byte the same statements as the block in
-- schema.mysql.sql, so a shop set up before this feature can add it without
-- re-importing. Everything is `if not exists`; importing either file, in any
-- order, any number of times, converges on the same database.
--
-- ---------------------------------------------------------------------------
-- WHY A THIRD QUEUE, WHEN THERE ARE ALREADY TWO
--
-- fulfilment_outbox mails the WAREHOUSE. whatsapp_outbox messages the
-- CUSTOMER. Neither reaches the OWNER, who until now found out about an order
-- by opening /backends and looking, or by reading the warehouse's copy of a
-- mail addressed to somebody else.
--
-- It fires on INSERT, before payment, exactly like the warehouse mail and for
-- the same reason the owner gave then: an order that never gets paid is worth
-- seeing, a paid one that was missed is not recoverable. So the payment state
-- is IN the alert — "paid", "awaiting payment", "cash on delivery" — because a
-- notification that does not say which is a notification that has to be
-- checked before it can be acted on, and one of those is worth very little at
-- two in the morning.
--
-- ---------------------------------------------------------------------------
-- WHY THE SUBSCRIPTION IS A ROW AND NOT A SETTING
--
-- A Web Push subscription is not an address the shop chooses; it is minted by
-- Apple (or Google) for one browser on one device, and it DIES on its own —
-- the owner reinstalls the Home Screen icon, or the push service rotates it,
-- and the endpoint starts answering 410 Gone for ever. So there are many, they
-- come and go without anyone deciding, and the sender must be able to delete
-- one. That is a table.
--
-- endpoint_hash exists because the endpoint itself is a long URL — Apple's run
-- to about 200 characters and FCM's further — and a unique index over
-- varchar(500) utf8mb4 is 2000 bytes, past what an index can hold on a server
-- with the older 767-byte limit. The hash is fixed at 64 and indexes anywhere.
-- ===========================================================================

set names utf8mb4;

create table if not exists push_subscriptions (
  id            int unsigned auto_increment primary key,
  -- The push service URL. Not a secret in the sense of a password, but it is
  -- a capability: anyone holding it can wake this phone, which is why VAPID
  -- signs every send and why this table is admin-only.
  endpoint      varchar(500) not null,
  -- sha256 of the endpoint, purely so the uniqueness can be indexed.
  endpoint_hash char(64)     not null,
  -- The browser's P-256 public key and 16-byte auth secret, base64url, exactly
  -- as PushSubscription.toJSON() gives them. RFC 8291 needs both.
  p256dh        varchar(120) not null,
  auth          varchar(40)  not null,
  -- Whatever the owner called this phone when subscribing. With two devices
  -- signed up, an endpoint URL is not something a person can tell apart.
  label         varchar(60)  not null default '',
  created_at    timestamp    not null default current_timestamp,
  -- Stamped on every successful send, so a device that has quietly stopped
  -- working is visible as a date rather than as silence.
  last_ok_at    timestamp    null,
  last_error    varchar(300) null,
  unique key uniq_push_endpoint (endpoint_hash)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- The alert itself. Queued in the order's own transaction, delivered by
-- cron-push.php — the same shape as the other two outboxes and for the same
-- reason: a checkout must never wait on Apple, and a notification that failed
-- to send must leave a trace rather than evaporating.
create table if not exists push_outbox (
  id         int unsigned auto_increment primary key,
  order_id   int unsigned null,
  kind       varchar(24)  not null default 'new',
  -- The rendered alert, decided when the order is written rather than when it
  -- is sent. A cron that re-reads the order would report the state at SEND
  -- time, so a card that settled in the meantime would produce an alert saying
  -- "paid" about the arrival of an unpaid order — true of the row, wrong about
  -- the event.
  title      varchar(120) not null,
  body       varchar(300) not null,
  -- Where tapping it goes. Same-origin path only; the service worker refuses
  -- anything else.
  url        varchar(200) not null default '/backends',
  created_at timestamp    not null default current_timestamp,
  sent_at    timestamp    null,
  attempts   int          not null default 0,
  last_error varchar(500) null,
  -- One 'new' alert per order, so a retried checkout cannot buzz twice.
  unique key uniq_push_order_kind (order_id, kind)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_push_unsent on push_outbox (sent_at, created_at);
