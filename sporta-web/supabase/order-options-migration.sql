-- Sporta — record the SIZE and the FIT the customer actually chose.
--
-- Safe to re-run. Must run AFTER payment-method-migration.sql, whose version of
-- create_order this replaces.
--
-- ============================== WHY THIS EXISTS =============================
-- The product page has asked for a size since the day it shipped. The order
-- never carried one.
--
--   p_items was   [{"slug": "...", "qty": 2}]
--   order_items was (order_id, product_id, qty, unit_price)
--
-- So a customer picked L, paid for L, and the shop received "2 x Cloudsoft
-- Jacket" with nothing to say which size to put in the box. That is not a
-- reporting gap, it is an order that cannot be fulfilled without ringing the
-- customer back — and with the ladder now running S to 5XL and a fit alongside
-- it, guessing stops being possible at all.
--
-- ============================== WHAT IT ADDS ================================
-- Two nullable text columns on order_items, and a create_order that reads them
-- out of each item.
--
-- NULLABLE, deliberately, on both counts:
--   * every order already in the table predates this and has no size to record.
--     A NOT NULL with a backfilled default would invent a fact.
--   * not every product has a size, or a fit. A backpack has neither.
--
-- The function below is the one from payment-method-migration.sql with the size
-- and fit lines added and NOTHING else changed — same idempotency check, same
-- phone and governorate validation, same server-side pricing. A security
-- definer function that creates orders is not something to paraphrase.

-- ---------- 1. the columns ----------
alter table public.order_items add column if not exists size text;
alter table public.order_items add column if not exists fit  text;

-- Bounded, so a text column fed from a JSON body cannot be used as free
-- storage. The lists are short enough to simply write down.
do $$
begin
  begin
    alter table public.order_items add constraint order_items_size_ck
      check (size is null or size = any (array['S','M','L','XL','2XL','3XL','4XL','5XL','ONE']));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.order_items add constraint order_items_fit_ck
      check (fit is null or fit = any (array['normal','slim','loose','oversize','boxy','tank']));
  exception when duplicate_object then null;
  end;
end $$;

comment on column public.order_items.size is
  'Size chosen at checkout, S..5XL. Null for orders placed before this column '
  'existed, and for products that have no size.';
comment on column public.order_items.fit is
  'Cut chosen at checkout. Null for orders placed before this column existed, '
  'and for products that have no fit.';

-- ---------- 2. the superseded three-argument create_order ----------
-- checkout-migration.sql created create_order(text, jsonb, jsonb).
-- payment-method-migration.sql created create_order(text, jsonb, jsonb, text)
-- and did not drop the first, so BOTH exist, and both are granted to anon.
--
-- Two problems, found by counting the functions after a rebuild:
--
--   1. A three-argument call is now AMBIGUOUS — Postgres answers "could not
--      choose a best candidate function". The browser sends four named
--      arguments so the live checkout is unaffected, which is exactly why this
--      sat unnoticed.
--   2. Worse than the error: the old overload is a SECOND DOOR into order
--      creation, reachable with the public anon key, running the pre-
--      payment-method code. No method validation, no size, no fit. The whole
--      point of the note in checkout-migration.sql — "order creation now has
--      exactly one door, and it is guarded" — is undone by a spare door left
--      standing next to it.
--
-- Dropped by exact signature, so the current four-argument function is
-- untouched.
drop function if exists public.create_order(text, jsonb, jsonb);

-- ---------- 3. create_order, carrying size and fit through ----------
create or replace function public.create_order(
  p_track_id text,
  p_items    jsonb,
  p_customer jsonb,
  p_payment_method text default 'knet'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_track  text;
  v_phone  text;
  v_gov    text;
  v_method text;
  v_amount numeric;
  v_status text;
  v_item   jsonb;
  v_pid    uuid;
  v_qty    int;
  v_size   text;
  v_fit    text;
begin
  v_track := btrim(coalesce(p_track_id, ''));
  if v_track !~ '^[A-Za-z0-9]{6,30}$' then
    raise exception 'invalid_track_id' using errcode = 'P0001';
  end if;

  v_method := lower(btrim(coalesce(p_payment_method, 'knet')));
  if v_method not in ('knet', 'tpay', 'cod') then
    raise exception 'invalid_payment_method' using errcode = 'P0001';
  end if;

  -- Idempotency: a double submit, or a customer who backs out of the bank page
  -- and retries, must not create a second order or duplicate the items.
  select o.id, o.amount, o.payment_status into v_id, v_amount, v_status
    from public.orders o where o.track_id = v_track;
  if found then
    if v_status <> 'pending' then
      raise exception 'order_not_pending' using errcode = 'P0001';
    end if;
    return jsonb_build_object('order_id', v_id, 'track_id', v_track, 'amount', v_amount,
                              'payment_method', v_method);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_cart' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'cart_too_large' using errcode = 'P0001';
  end if;

  v_phone := public.normalise_kw_phone(p_customer ->> 'phone');
  if v_phone is null then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;

  v_gov := btrim(coalesce(p_customer ->> 'governorate', ''));
  if v_gov not in ('capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer', 'ahmadi', 'jahra') then
    raise exception 'invalid_governorate' using errcode = 'P0001';
  end if;

  insert into public.orders (
    track_id, payment_status, payment_method,
    customer_name, customer_phone, customer_governorate, customer_area,
    customer_block, customer_street, customer_building,
    customer_floor, customer_flat, customer_note
  ) values (
    v_track, 'pending', v_method,
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

  -- An unknown or inactive slug raises rather than being skipped: skipping
  -- produced an order totalling zero and an opaque failure at the payment step.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::int, 1);
    if v_qty < 1 or v_qty > 99 then
      raise exception 'invalid_qty' using errcode = 'P0001';
    end if;

    -- Upper for size, lower for fit, because that is how each is written
    -- everywhere else: '2XL' and 'oversize'. An empty string becomes null
    -- rather than a row claiming a size of ''.
    v_size := nullif(upper(btrim(coalesce(v_item ->> 'size', ''))), '');
    v_fit  := nullif(lower(btrim(coalesce(v_item ->> 'fit',  ''))), '');

    -- An unrecognised value is REJECTED, not silently dropped. Dropping it
    -- would produce exactly the order this migration exists to prevent: one
    -- that looks complete and does not say which size to pack. p_items comes
    -- from the browser, and nothing else here trusts the browser either.
    if v_size is not null
       and v_size <> all (array['S','M','L','XL','2XL','3XL','4XL','5XL','ONE']) then
      raise exception 'invalid_size' using errcode = 'P0001';
    end if;
    if v_fit is not null
       and v_fit <> all (array['normal','slim','loose','oversize','boxy','tank']) then
      raise exception 'invalid_fit' using errcode = 'P0001';
    end if;

    select p.id into v_pid from public.products p
      where p.slug = (v_item ->> 'slug') and p.active;
    if v_pid is null then
      raise exception 'unavailable_%', coalesce(v_item ->> 'slug', '?') using errcode = 'P0001';
    end if;
    insert into public.order_items (order_id, product_id, qty, size, fit)
    values (v_id, v_pid, v_qty, v_size, v_fit);
  end loop;

  select o.amount into v_amount from public.orders o where o.id = v_id;
  if coalesce(v_amount, 0) <= 0 then
    raise exception 'zero_amount' using errcode = 'P0001';
  end if;

  return jsonb_build_object('order_id', v_id, 'track_id', v_track, 'amount', v_amount,
                            'payment_method', v_method);
end $$;

grant execute on function public.create_order(text, jsonb, jsonb, text) to anon, authenticated;

-- ---------- 4. what the admin has to pack ----------
-- The order's lines with their options. Gated on is_admin() like every other
-- admin read: order_items has no policy that lets anon read it, and this must
-- not quietly become one.
create or replace function public.admin_order_items(p_order_id uuid)
returns table (slug text, name_en text, qty int, size text, fit text, unit_price numeric)
language sql security definer set search_path = public stable as $$
  select p.slug, p.name_en, oi.qty, oi.size, oi.fit, oi.unit_price
    from public.order_items oi
    join public.products p on p.id = oi.product_id
   where oi.order_id = p_order_id
     and public.is_admin()
   order by p.name_en, oi.size;
$$;

revoke all on function public.admin_order_items(uuid) from public;
grant execute on function public.admin_order_items(uuid) to authenticated;

do $$
begin
  raise notice 'order_items records size and fit; create_order validates both';
end $$;
