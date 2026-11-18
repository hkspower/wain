-- Additive customer accounts. Existing order rows, stock and admins are preserved;
-- a nullable account link is added to orders for future signed-in checkouts.
create table if not exists customer_accounts (
  id bigint unsigned auto_increment primary key,
  name varchar(80) not null,
  email varchar(254) not null unique,
  password_hash varchar(255) not null,
  phone varchar(15) null,
  created_at timestamp not null default current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

-- Existing accounts and guest orders remain intact on a repeat import.
alter table customer_accounts add column if not exists phone varchar(15) null;
alter table orders add column if not exists customer_account_id bigint unsigned null;
create index if not exists idx_orders_customer_created on orders (customer_account_id, created_at);

-- One-use password links contain no recoverable token. A new request marks
-- older links used; a successful reset changes the password hash and revokes
-- existing customer sessions.
create table if not exists customer_password_resets (
  id bigint unsigned auto_increment primary key,
  customer_id bigint unsigned not null,
  token_hash char(64) not null unique,
  expires_at datetime not null,
  used_at datetime null,
  request_ip char(64) null,
  created_at timestamp not null default current_timestamp,
  constraint fk_customer_reset_account foreign key (customer_id) references customer_accounts(id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
create index if not exists idx_customer_reset_account on customer_password_resets (customer_id, used_at, expires_at);

-- Additive: customer email verification (2026-11-12, audit M4). Re-running this file applies it.
--
-- A customer account used to be trusted the moment it was created, so anybody
-- could register a stranger's address and the birthday gift went to whoever
-- had made the account. Now an account records WHEN its mailbox was proven:
--   * opening the verification link mailed at registration, or
--   * completing a password reset (the link arrived in that mailbox).
-- Unverified accounts still sign in, shop and see their orders - mail is the
-- thing being proven, and a mail outage must not lock a customer out - but the
-- birthday gift (cron-birthday.php) is sent only to a verified account.
--
-- Safe to re-run: nothing here deletes or rewrites a row. Existing accounts
-- start unverified; each becomes verified the first time it opens a link.
alter table customer_accounts add column if not exists email_verified_at datetime null;

-- One-use verification links. Only the SHA-256 of the token is stored, the
-- same design as customer_password_resets; a newer link replaces older ones.
create table if not exists customer_email_verifications (
  id bigint unsigned auto_increment primary key,
  customer_id bigint unsigned not null,
  token_hash char(64) not null unique,
  expires_at datetime not null,
  used_at datetime null,
  created_at timestamp not null default current_timestamp,
  constraint fk_customer_verify_account foreign key (customer_id) references customer_accounts(id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
create index if not exists idx_customer_verify_account on customer_email_verifications (customer_id, used_at, expires_at);

-- Sign in with Apple (2026-11-13): the stable Apple subject per account. NULL for every account that
-- signs in another way. Unique, so one Apple ID can belong to one account only. Re-running this file is safe.
alter table customer_accounts add column if not exists apple_sub varchar(255) null;
create unique index if not exists uq_customer_apple_sub on customer_accounts (apple_sub);
