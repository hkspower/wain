#!/usr/bin/env bash
# Empty the sandbox database of everything the rigs have written.
#
#   npm run sandbox:clean
#
# The rigs place REAL orders against a REAL database — that is the point of
# them, and it is why the shop's own order path is exercised rather than
# mocked. The residue accumulates: hundreds of orders with names like
# "Live Admin Rig", their lines, their return requests and their throttle
# counters, all of it indistinguishable at a glance from a shop that has been
# trading.
#
# WHAT IS KEPT, and it is the difference between a clean sandbox and an empty
# one: the CATALOGUE (products, variants, brands, size charts), the SETTINGS,
# the chart of accounts, the seeded admin, and the SUMMER24 coupon that
# live-api-test.mjs looks up by name. Those are fixtures the rigs need, not
# residue they left.
#
# This touches nothing but the local sandbox. There is no path from here to
# the live shop, and there is not meant to be one.
set -euo pipefail

DB=${DB:-sporta}
mariadb -u sporta -plocaldev "$DB" --default-character-set=utf8mb4 <<'SQL'
-- Children first where there is no cascade to rely on, and orders last: the
-- foreign keys on order_items and return_requests cascade from it, so deleting
-- orders takes their rows with it either way. Stated explicitly so that a
-- schema change which drops a cascade does not silently leave orphans.
delete from return_request_items;
delete from return_requests;
delete from order_items;
delete from orders;
delete from rate_limit;
-- The outbox is a record that the warehouse was told about an order that no
-- longer exists. Cron would keep retrying rows whose order is gone.
delete from fulfilment_outbox;
SQL

mariadb -u sporta -plocaldev "$DB" --default-character-set=utf8mb4 -e "
select 'orders' as t, count(*) as n from orders
union all select 'order_items', count(*) from order_items
union all select 'return_requests', count(*) from return_requests
union all select 'rate_limit', count(*) from rate_limit
union all select 'products (kept)', count(*) from products
union all select 'brands (kept)', count(*) from brands
union all select 'discounts (kept)', count(*) from discounts
union all select 'admin_users (kept)', count(*) from admin_users;"
