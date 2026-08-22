-- Sporta — Apple Wallet passes.
--
-- ADDITIVE. Fresh installs get this from schema.mysql.sql; running it again is
-- harmless. phpMyAdmin -> your database -> Import.

set names utf8mb4;

-- ONE SERIAL PER CUSTOMER, FOR EVER.
--
-- The serial is what the till scans and what Wallet uses to update a pass. If
-- it were minted per request, a customer who re-added their card would have two
-- cards with two histories and a shop assistant with no way to tell which is
-- the real one. So it is issued once, stored, and returned unchanged every time
-- afterwards.
--
-- Keyed by PHONE because that is what the shop already identifies a customer
-- by: orders carry customer_phone, there is no accounts table, and a phone is
-- what somebody reads out at a till.
create table if not exists wallet_passes (
  id           int unsigned auto_increment primary key,
  kind         varchar(10)  not null default 'loyalty',
  -- The serial on the pass and in the barcode. Unique across kinds: a till
  -- scanning one should never have to ask which sort of card it was.
  serial       varchar(40)  not null unique,
  -- Eight digits, no country code — the same normalisation store.php does.
  phone        varchar(16)  null,
  name         varchar(80)  null,
  -- Points are DERIVED from paid orders, not stored, so they cannot drift from
  -- what the customer actually spent. This is the balance at the moment the
  -- pass was last issued, kept only so a push notification can say what
  -- changed.
  points_at_issue int unsigned not null default 0,
  issued_at    timestamp    not null default current_timestamp,
  updated_at   timestamp    not null default current_timestamp on update current_timestamp,
  -- Wallet gives every installed pass a device id and a push token when it
  -- registers. Both are null until the web service exists; the columns are here
  -- so adding it later is not another migration on a live table.
  device_id    varchar(64)  null,
  push_token   varchar(128) null,
  constraint wallet_kind_ck check (kind in ('loyalty','coupon','giftcard'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create index if not exists idx_wallet_phone on wallet_passes (kind, phone);
