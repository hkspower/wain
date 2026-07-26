-- Sporta — payment methods: KNET, CBK T-Pay, and cash on delivery.
--
-- Safe to re-run.
--
-- WHY A COLUMN AND NOT A NEW STATUS
-- payment_status answers "has the money arrived?" — pending, paid, failed,
-- review. Cash on delivery does not change that question; it changes WHERE the
-- money arrives from. A cash order is genuinely unpaid until the driver hands
-- it over, so it stays 'pending' and becomes 'paid' when the admin says the
-- cash was collected. Folding it into the status column would have made
-- "pending" mean two different things and quietly broken the revenue figures.
--
-- What the admin now sees, and why it matters:
--   pending + knet  an abandoned or unverified card payment. Chase the bank.
--   pending + tpay  an abandoned or unverified T-Pay QR payment. Chase the bank.
--   pending + cod   a real order waiting to be delivered. Chase the driver.
-- Those need opposite responses, which is exactly why they cannot share a row
-- shape with no way to tell them apart.

-- ============ 1. the column ============
alter table public.orders
  add column if not exists payment_method text not null default 'knet';

do $$ begin
  alter table public.orders drop constraint if exists orders_payment_method_check;
  alter table public.orders add constraint orders_payment_method_check
    check (payment_method in ('knet', 'tpay', 'cod'));
end $$;

comment on column public.orders.payment_method is
  'knet = classic KNET (Tranportal, /knet). tpay = CBK hosted T-Pay QR (/pay). '
  'cod  = cash collected on delivery.';

-- ============ 2. create_order accepts it ============
--
-- A new argument with a default, so the old three-argument call still works.
-- The method is validated here rather than trusted: the browser chooses it, and
-- a browser can send anything.
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
    select p.id into v_pid from public.products p
      where p.slug = (v_item ->> 'slug') and p.active;
    if v_pid is null then
      raise exception 'unavailable_%', coalesce(v_item ->> 'slug', '?') using errcode = 'P0001';
    end if;
    insert into public.order_items (order_id, product_id, qty) values (v_id, v_pid, v_qty);
  end loop;

  select o.amount into v_amount from public.orders o where o.id = v_id;
  if coalesce(v_amount, 0) <= 0 then
    raise exception 'zero_amount' using errcode = 'P0001';
  end if;

  return jsonb_build_object('order_id', v_id, 'track_id', v_track, 'amount', v_amount,
                            'payment_method', v_method);
end $$;

grant execute on function public.create_order(text, jsonb, jsonb, text) to anon, authenticated;

-- ============ 3. the shopper can see which method their order used ============
-- get_order_status is what the result page reads; without the method it cannot
-- tell a customer "pay the driver" rather than "your card was charged".
-- Dropped first, not "create or replace": the return type gains a column, and
-- Postgres refuses to replace a function whose OUT parameters changed. Without
-- this the whole setup file aborted here on any database that already had the
-- old version — which is every database that has ever been set up.
drop function if exists public.get_order_status(text);

create function public.get_order_status(p_track_id text)
returns table (payment_status text, payment_method text, amount numeric)
language sql security definer set search_path = public stable as $$
  select o.payment_status, o.payment_method, o.amount
    from public.orders o
   where o.track_id = btrim(coalesce(p_track_id, ''))
   limit 1;
$$;

grant execute on function public.get_order_status(text) to anon, authenticated;

-- ============ 4. admin stats must not count uncollected cash as revenue ============
-- A cash order is money owed, not money received. It becomes revenue when the
-- admin marks it paid, which is the same rule KNET follows.
comment on table public.orders is
  'payment_status is about money received. A cod order stays pending until the '
  'cash is collected and the admin marks it paid.';

select
  count(*) filter (where payment_method = 'knet') as knet_orders,
  count(*) filter (where payment_method = 'tpay') as tpay_orders,
  count(*) filter (where payment_method = 'cod')  as cash_orders
from public.orders;
