-- Sporta — customer accounts.
--
-- Safe to re-run. `create table if not exists` and nothing else, so importing
-- this twice does what importing it once did — the rule the rest of this
-- project's SQL learned the expensive way, where an `on duplicate key update`
-- naming a column the owner can edit reset hand-typed prices to seed values.
--
-- WHY THERE IS NO `customer_id` DEFAULT ON OLD ORDERS, and this is the whole
-- security decision in this file:
--
-- It is tempting to link a new account to its past orders by PHONE NUMBER.
-- The orders table has `customer_phone`, store_return_lookup() already gates
-- on it, and it would make an account useful from the first minute.
--
-- It is also an account takeover. Registration asks for a phone number and
-- verifies NOTHING — this shop has no SMS provider configured — so anyone who
-- knows a customer's mobile number could register with it and read that
-- person's name, address, and everything they have ever bought. The phone is
-- a gate on the RETURNS route only because the order reference is required
-- WITH it, and the pair is something only the customer has.
--
-- So orders are linked by `customer_id`, written at checkout by a shopper who
-- was signed in at the time, and by nothing else. An account starts empty and
-- fills up from the next order onward. Claiming older orders needs the phone
-- to be proved, which needs an SMS provider and is the owner's to arrange.

create table if not exists customers (
  id            int unsigned auto_increment primary key,
  email         varchar(190) not null unique,
  -- Stored normalised by store_phone(), the same way orders.customer_phone is,
  -- so the two can ever be compared if a verified link is added later.
  phone         varchar(20)  null,
  name          varchar(120) null,
  -- password_hash(), PASSWORD_DEFAULT. 255 because the algorithm may change
  -- under us and bcrypt's 60 characters is not a promise about the next one.
  password_hash varchar(255) not null,
  -- Set when the customer proves the email; null until then. NOTHING depends
  -- on it yet — it exists so that adding verification later does not need a
  -- migration on a live table with rows in it.
  verified_at   timestamp    null default null,
  created_at    timestamp    not null default current_timestamp,
  last_seen_at  timestamp    null default null
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- The link, added to orders rather than kept in a join table: an order belongs
-- to at most one account, and a null means "placed as a guest", which is the
-- normal case and must stay cheap to read.
--
-- `add column if not exists` is MariaDB's, which is what this shop runs
-- (measured: the live server reports MariaDB through PHP 8.5.4). On a server
-- without it this statement is the one thing here that needs a hand.
alter table orders add column if not exists customer_id int unsigned null;
alter table orders add index if not exists orders_customer_idx (customer_id);
