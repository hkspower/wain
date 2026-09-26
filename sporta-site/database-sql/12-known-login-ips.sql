-- Sporta — which IPs have already signed an admin in successfully, so a NEW
-- one can be told apart from a routine sign-in and the owner alerted.
--
-- Import after 1-schema.mysql.sql. Safe to re-run.
--
-- See store_admin_grant() in api/store.php for where a row lands here — the
-- one place a sign-in is actually granted, shared by the password-only path
-- and the second-factor-verified path, so neither can slip past unwatched.

set names utf8mb4;

create table if not exists admin_known_ips (
  admin_id   int unsigned not null,
  -- NOT HASHED, unlike store_throttle()'s abuse-control buckets: those exist
  -- only to count attempts and never need to be read by a person, while this
  -- one has to be shown in the alert email in a form the owner can recognise
  -- ("was that you, at that address?") or report to whoever manages the
  -- network it came from. An IP is not a credential.
  ip         varchar(45) not null,
  first_seen timestamp not null default current_timestamp,
  last_seen  timestamp not null default current_timestamp,
  primary key (admin_id, ip),
  constraint fk_known_ip_admin foreign key (admin_id)
    references admin_users (id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
