-- Sporta — products/orders schema with SERVER-SIDE price authority + RLS.
-- Run in Supabase SQL editor. The client can never set the price it pays:
-- item prices are copied from the products table by a trigger, and the order
-- amount is recomputed server-side from the items.

-- ============================ TABLES ============================

create table if not exists public.products (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name_en    text not null,
  name_ar    text not null,
  desc_en    text,
  desc_ar    text,
  price      numeric(10,3) not null check (price >= 0),  -- KWD, source of truth
  category   text,
  image      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  track_id       text unique not null,
  amount         numeric(10,3) not null default 0,   -- computed by trigger, NOT client
  payment_status text not null default 'pending'
                 check (payment_status in ('pending','paid','failed')),
  cbk_status text, cbk_message text, cbk_paymentid text, cbk_transaction text,
  cbk_authcode text, cbk_reference text, cbk_receipt text, cbk_paytype text,
  paid_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  qty        int  not null check (qty > 0),
  unit_price numeric(10,3) not null default 0          -- set server-side by trigger
);

create index if not exists idx_order_items_order on public.order_items(order_id);

-- ===================== SERVER-SIDE PRICING ======================

-- On item insert, copy the authoritative price from products (ignore any
-- client-supplied unit_price) and reject inactive/unknown products.
create or replace function public.set_item_price()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select price into new.unit_price
  from public.products
  where id = new.product_id and active = true;
  if new.unit_price is null then
    raise exception 'Invalid or inactive product %', new.product_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_set_item_price on public.order_items;
create trigger trg_set_item_price
  before insert on public.order_items
  for each row execute function public.set_item_price();

-- Recompute the order total from its items after any change.
create or replace function public.recompute_order_amount()
returns trigger language plpgsql security definer set search_path = public as $$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o
     set amount = coalesce((select sum(unit_price * qty)
                            from public.order_items where order_id = oid), 0)
   where o.id = oid;
  return null;
end $$;

drop trigger if exists trg_recompute_amount on public.order_items;
create trigger trg_recompute_amount
  after insert or update or delete on public.order_items
  for each row execute function public.recompute_order_amount();

-- ============================ RLS ==============================

alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- Products: anyone may read active products.
drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select using (active = true);

-- Authenticated admins may read ALL products and manage them (add/edit/delete).
-- (Admin routes are behind Supabase Auth; tighten to a role/claim if you add one.)
drop policy if exists products_admin_read on public.products;
create policy products_admin_read on public.products
  for select to authenticated using (true);

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all to authenticated using (true) with check (true);

-- Orders: clients may CREATE a pending order (amount is forced to 0 here and
-- computed by the trigger). Clients may NOT update/delete/select directly —
-- status is set server-side (service key), and reads go through an RPC.
drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert with check (payment_status = 'pending' and amount = 0);

-- Order items: clients may insert items for their just-created order.
drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items
  for insert with check (true);

-- ===================== SAFE STATUS LOOKUP =======================

-- The result page reads status via this RPC (no broad table SELECT exposure).
create or replace function public.get_order_status(p_track_id text)
returns table (track_id text, amount numeric, payment_status text)
language sql stable security definer set search_path = public as $$
  select track_id, amount, payment_status
  from public.orders where track_id = p_track_id
$$;

revoke all on function public.get_order_status(text) from public;
grant execute on function public.get_order_status(text) to anon, authenticated;

-- ================= (optional) seed sample products ==============
-- insert into public.products (slug,name_en,name_ar,price,category,active) values
--   ('pro-match-ball','Pro Match Football','كرة قدم احترافية',18.500,'football',true);
