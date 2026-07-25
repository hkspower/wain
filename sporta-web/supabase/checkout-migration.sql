-- Sporta — checkout: capture delivery details, and fix order creation.
--
-- Run in the Supabase SQL editor AFTER schema.sql and admin-migration.sql.
-- Safe to re-run.
--
-- WHY THIS EXISTS
--
-- 1. Web checkout was broken. src/lib/checkout.js created the order with
--    `insert(...).select('id')`, which makes PostgREST use INSERT ... RETURNING.
--    Postgres applies SELECT policies to a RETURNING clause, and `orders` has
--    no SELECT policy for anon — so the insert raised
--    "new row violates row-level security policy" and rolled back. The error
--    was swallowed by a best-effort try/catch, the browser was redirected to
--    pay.php anyway, and pay.php (correctly fail-closed) answered 404 Unknown
--    order. Every web customer hit a bare 404 at the moment of payment.
--    Reproduced against a real PostgreSQL 16 with these exact policies.
--
-- 2. Orders carried no delivery details. The admin has always shown name,
--    phone and address fields, but nothing ever wrote them, so a paid order
--    could not be fulfilled.
--
-- Both are fixed by moving order creation into one SECURITY DEFINER function.
-- It runs as the owner, so RETURNING works without exposing orders to anon; it
-- validates everything server-side, where the browser cannot bypass it; and it
-- creates the order and its items in a single transaction, so a cart can never
-- half-record.

-- ============ 1. structured delivery address ============
--
-- Kuwait addresses are not street-address shaped: they are
-- governorate → area → block → street → building, plus floor/flat for
-- apartments. Storing them as separate columns keeps them sortable and
-- filterable (deliveries are routed by area) instead of one prose blob.
-- customer_area is kept as the plain area name so the existing admin screens
-- and the mobile API keep working unchanged.

alter table public.orders
  add column if not exists customer_governorate text,
  add column if not exists customer_block       text,
  add column if not exists customer_street      text,
  add column if not exists customer_building    text,
  add column if not exists customer_floor       text,
  add column if not exists customer_flat        text;

comment on column public.orders.customer_phone is
  'Normalised to 965XXXXXXXX. Kuwait mobiles are 8 digits starting 5, 6 or 9.';

create index if not exists idx_orders_area on public.orders (customer_area);

-- ============ 2. validation helpers ============

-- Kuwait mobile numbers: 8 digits beginning 5, 6 or 9. Accepts what people
-- actually type — +965, 00965, spaces, dashes — and returns the canonical
-- 965XXXXXXXX, or null if it is not a valid Kuwaiti mobile.
create or replace function public.normalise_kw_phone(p text)
returns text language plpgsql immutable as $$
declare d text;
begin
  d := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  if d like '00965%' then d := substr(d, 6);
  elsif length(d) = 11 and d like '965%' then d := substr(d, 4);
  end if;
  if d ~ '^[569]\d{7}$' then return '965' || d; end if;
  return null;
end $$;

-- Trimmed, length-checked text. Raises a stable machine token the client maps
-- to a translated message — never a raw Postgres error shown to a shopper.
create or replace function public.checkout_text(
  p_value text, p_field text, p_min int, p_max int
) returns text language plpgsql immutable as $$
declare v text;
begin
  v := btrim(coalesce(p_value, ''));
  v := regexp_replace(v, '\s+', ' ', 'g');
  if length(v) < p_min then raise exception 'missing_%', p_field using errcode = 'P0001'; end if;
  if length(v) > p_max then raise exception 'too_long_%', p_field using errcode = 'P0001'; end if;
  return v;
end $$;

-- ============ 3. create_order ============
--
-- The one entry point for creating an order from an untrusted client.
--
-- Prices are never accepted from the caller: items are given as slugs, the
-- existing trg_set_item_price copies the price from products, and
-- trg_recompute_amount sets the total. The function returns that computed
-- total so the browser can show the customer the real figure and stop before
-- redirecting if it is zero.

create or replace function public.create_order(
  p_track_id text,
  p_items    jsonb,   -- [{"slug":"rheo-zip-top","qty":2}, ...]
  p_customer jsonb    -- {name, phone, governorate, area, block, street, building, floor, flat, note}
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_track  text;
  v_phone  text;
  v_gov    text;
  v_amount numeric;
  v_status text;
  v_count  int;
  v_item   jsonb;
  v_pid    uuid;
  v_qty    int;
begin
  -- ---- track id ----
  v_track := btrim(coalesce(p_track_id, ''));
  if v_track !~ '^[A-Za-z0-9]{6,30}$' then
    raise exception 'invalid_track_id' using errcode = 'P0001';
  end if;

  -- Idempotency. A double submit, or a customer who backs out of the bank page
  -- and retries, must not create a second order or duplicate the items.
  select o.id, o.amount, o.payment_status into v_id, v_amount, v_status
    from public.orders o where o.track_id = v_track;
  if found then
    if v_status <> 'pending' then
      raise exception 'order_not_pending' using errcode = 'P0001';
    end if;
    return jsonb_build_object('order_id', v_id, 'track_id', v_track, 'amount', v_amount);
  end if;

  -- ---- cart ----
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'cart_too_large' using errcode = 'P0001';
  end if;

  -- ---- customer ----
  v_phone := public.normalise_kw_phone(p_customer ->> 'phone');
  if v_phone is null then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;

  v_gov := btrim(coalesce(p_customer ->> 'governorate', ''));
  if v_gov not in ('capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer', 'ahmadi', 'jahra') then
    raise exception 'invalid_governorate' using errcode = 'P0001';
  end if;

  insert into public.orders (
    track_id, payment_status,
    customer_name, customer_phone, customer_governorate, customer_area,
    customer_block, customer_street, customer_building,
    customer_floor, customer_flat, customer_note
  ) values (
    v_track, 'pending',
    public.checkout_text(p_customer ->> 'name',     'name',     2, 80),
    v_phone,
    v_gov,
    public.checkout_text(p_customer ->> 'area',     'area',     2, 60),
    public.checkout_text(p_customer ->> 'block',    'block',    1, 12),
    public.checkout_text(p_customer ->> 'street',   'street',   1, 40),
    public.checkout_text(p_customer ->> 'building', 'building', 1, 24),
    nullif(btrim(coalesce(p_customer ->> 'floor', '')), ''),
    nullif(btrim(coalesce(p_customer ->> 'flat',  '')), ''),
    nullif(btrim(coalesce(p_customer ->> 'note',  '')), '')
  ) returning id into v_id;

  -- ---- items ----
  --
  -- An unknown or inactive slug raises instead of being skipped. The old code
  -- skipped it, which produced an order totalling zero and an opaque
  -- "Order has no payable amount" at the payment step. Failing here means the
  -- shopper is told the item is unavailable while they can still act on it,
  -- and the admin Catalogue screen explains why (the product is not in the
  -- database yet).
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::int, 1);
    if v_qty < 1 or v_qty > 99 then
      raise exception 'invalid_qty' using errcode = 'P0001';
    end if;
    select p.id into v_pid from public.products p
      where p.slug = (v_item ->> 'slug') and p.active = true;
    if not found then
      raise exception 'unavailable_%', coalesce(v_item ->> 'slug', '?') using errcode = 'P0001';
    end if;
    insert into public.order_items (order_id, product_id, qty) values (v_id, v_pid, v_qty);
  end loop;

  -- trg_recompute_amount has now set the total from the stored prices.
  select o.amount into v_amount from public.orders o where o.id = v_id;
  if coalesce(v_amount, 0) <= 0 then
    raise exception 'zero_amount' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.order_items where order_id = v_id;
  return jsonb_build_object(
    'order_id', v_id, 'track_id', v_track, 'amount', v_amount, 'items', v_count
  );
end $$;

revoke all on function public.create_order(text, jsonb, jsonb) from public;
grant execute on function public.create_order(text, jsonb, jsonb) to anon, authenticated;

-- ============ 4. close the direct insert path ============
--
-- With create_order in place nothing needs to insert into these tables with
-- the anon key. Dropping the policies means an attacker holding the public
-- anon key can no longer write arbitrary orders — or arbitrary personal data —
-- straight into the table, bypassing every validation above. Order creation
-- now has exactly one door, and it is guarded.
drop policy if exists orders_insert      on public.orders;
drop policy if exists order_items_insert on public.order_items;
