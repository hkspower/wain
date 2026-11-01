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
