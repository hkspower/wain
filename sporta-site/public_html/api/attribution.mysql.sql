-- ===========================================================================
-- Sporta — where the order came from.
--
-- Additive, and byte-for-byte the same statements as the block in
-- schema.mysql.sql, so a shop set up before this feature can add it without
-- re-importing. Everything is `if not exists`.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS
--
-- The shop advertises. Without these columns the owner can see that forty
-- orders arrived and cannot see that thirty-one of them came from one
-- Instagram campaign and none at all from the other — so the budget is split
-- by instinct, and the campaign that works is the one that gets cut.
--
-- The ad platforms' own dashboards do not answer this either: each one counts
-- conversions it believes it caused, they overlap, and none of them can see
-- KWD that landed in this shop's database. The order row is the only place the
-- truth lives.
--
-- WHAT IS DELIBERATELY NOT STORED: the click identifiers (fbclid, gclid). They
-- are the most identifying part of an ad URL, they are long, and they are only
-- useful for uploading conversions back to the ad platform — which this shop
-- does not do. Storing personal-ish data for a feature nobody has built is how
-- a privacy policy becomes untrue.
-- ===========================================================================

-- The campaign that produced the order, as the ad URL declared it.
-- NULL means the visit carried no campaign — a direct visit, a bookmark, or
-- organic search. That is a real and common answer, not missing data.
-- ROW FORMAT FIRST. `orders` is by far the widest table in this schema — 40
-- columns and about 6.9 kB of declared width, against InnoDB's 8126-byte
-- ceiling — and every additive migration here makes it wider. A table created
-- without an explicit ROW_FORMAT is rebuilt by ALTER using the server's
-- default, and on a server whose default is not DYNAMIC that rebuild fails
-- with "Row size too large ... maximum row size ... is 8126" — refusing a
-- migration that only ADDS a nullable column, or even one that DROPS one.
-- Measured on MariaDB 10.11: `alter table orders drop column utm_source`
-- failed, and the same statement with `row_format=DYNAMIC` in front of it
-- succeeded on the identical table.
--
-- Stating it here is idempotent (it is already DYNAMIC on a healthy install,
-- and the ALTER is then a no-op rebuild of a small table) and it is what lets
-- this file run on a shop that was set up before it existed.
alter table orders row_format=DYNAMIC;
alter table orders add column if not exists utm_source   varchar(60)  null after customer_lang;
alter table orders add column if not exists utm_medium   varchar(60)  null after utm_source;
alter table orders add column if not exists utm_campaign varchar(80)  null after utm_medium;

-- The site the visitor arrived FROM, host only — never the full URL, which can
-- carry a search query or a private page path. It answers the organic half of
-- the question: an order tagged instagram.com with no campaign came from a
-- post, not from a paid ad, and those are two different budgets.
alter table orders add column if not exists referrer_host varchar(120) null after utm_campaign;

-- The owner's real question is "how did LAST MONTH's campaigns do", which is a
-- scan over dates filtered by source. Indexed accordingly.
create index if not exists idx_orders_source on orders (utm_source, created_at);
