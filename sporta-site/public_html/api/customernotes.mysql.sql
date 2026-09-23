-- Private notes and tags per customer, for the CRM card on /backends Orders.
--
-- Keyed by PHONE, because that is what a customer IS in the CRM (see
-- admin.php's crm_customers): the canonical 965 + eight digits store_phone()
-- returns, the same form orders, blocked_customers and customers use, so a
-- note joins to all three by plain equality.
--
-- One row per phone, not one per note: a CRM note here is "what the owner
-- wants to remember about this person", edited in place, not a log. Who last
-- changed it and when is kept; the admin audit log already records every save.
--
-- Safe to re-run. admin.php also creates this table on first use if it is
-- missing, so a shop that never imports this file still gets the feature.
create table if not exists customer_notes (
  phone       varchar(15)  not null primary key,
  note        text         null,
  -- Comma-separated, each tag trimmed and free of commas. A few short labels
  -- ("VIP", "prefers WhatsApp") do not need a join table.
  tags        varchar(400) not null default '',
  updated_by  varchar(190) null,
  updated_at  timestamp    not null default current_timestamp on update current_timestamp
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
