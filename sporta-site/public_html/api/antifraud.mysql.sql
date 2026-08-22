-- ===========================================================================
-- Sporta — cash-on-delivery abuse control.
--
-- Additive, and byte-for-byte the same statements as the block in
-- schema.mysql.sql, so a shop set up before this feature can add it without
-- re-importing. Everything is `if not exists`.
--
-- ---------------------------------------------------------------------------
-- THE FRAUD THIS EXISTS FOR
--
-- Cash on delivery is the normal way to pay in Kuwait, and it is the only
-- payment method that costs the shop money BEFORE anyone has paid anything. A
-- card order that turns out to be fake costs nothing: the bank never settled
-- it. A COD order that turns out to be fake has already sent a courier to an
-- address, and the shop pays for that trip whether or not a door opens.
--
-- Measured against this shop before this file existed: one phone number placed
-- TWELVE cash-on-delivery orders in a few seconds, every one accepted, every
-- one queuing a picking list to the warehouse. Nothing in the code objected,
-- because nothing was looking.
--
-- Two guards, because they catch different things:
--
--   The OPEN-ORDER CAP is automatic and needs nobody to notice. It limits how
--   many undelivered COD orders one phone can have at once, so a single number
--   cannot generate unlimited courier trips. It counts only orders still in
--   flight — a customer whose previous orders were delivered can order again
--   as freely as anyone. That distinction is the whole design: a rule that
--   punishes loyal customers gets switched off within a week.
--
--   The BLOCKLIST is manual and permanent, for the number that has already
--   cost the shop three wasted trips. It is a human decision, recorded with a
--   reason and a date, because a customer refused service deserves better than
--   an unexplained failure at checkout.
--
-- Neither can be perfect: an attacker with many phone numbers gets many
-- attempts. That is true of every COD shop on earth. The goal is to make the
-- cheap attack — one number, one script, a thousand orders — stop working, and
-- to give the owner somewhere to put what they learn.
-- ===========================================================================

create table if not exists blocked_customers (
  id          int unsigned auto_increment primary key,
  -- The CANONICAL phone, exactly as store_phone() returns it: 965 followed by
  -- eight digits. Storing what the customer typed would let 99887766,
  -- +965 99887766 and 00965-99887766 be three different people to this table
  -- and one person to the courier.
  phone       varchar(15)  not null unique,
  -- 'cod' refuses cash on delivery only; 'all' refuses every order.
  --
  -- 'cod' is the default and the proportionate answer. A prepaid KNET order
  -- from a blocked number costs the shop nothing — the money is in before
  -- anything ships — so refusing it turns a serial no-show into a lost
  -- customer for no gain. 'all' is there for the case where the person is the
  -- problem rather than the payment method.
  scope       varchar(3)   not null default 'cod',
  -- Why, in the owner's words. Not decoration: in six months this is the only
  -- thing that says whether a block was a fraud pattern or a bad afternoon.
  reason      varchar(200) null,
  -- Which admin did it, for the same reason.
  blocked_by  varchar(120) null,
  created_at  timestamp    not null default current_timestamp,
  constraint blocked_scope_ck check (scope in ('cod', 'all'))
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- The open-order cap counts a phone's unsettled COD orders on every checkout,
-- so it must not be a table scan on a table that only grows.
create index if not exists idx_orders_phone_open
  on orders (customer_phone, payment_method, payment_status);
