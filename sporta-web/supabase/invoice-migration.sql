-- Sporta — the customer's invoice.
--
-- Safe to re-run. Run AFTER order-options-migration.sql (it reads size/fit).
--
-- ============================== WHY THIS EXISTS =============================
-- A customer who paid got a tick, a sentence and an order number. No itemised
-- list, no prices, no total, nothing to print, nothing to keep, and nothing to
-- send to anyone who asks what they bought. Every other part of this checkout
-- was built and the document at the end of it was missing.
--
-- ========================= WHY THE TRACK ID IS ENOUGH =======================
-- There are no customer accounts on this shop — checkout is guest-only and no
-- email is collected, which is a deliberate decision recorded in the checkout
-- copy. So the order number IS the credential, exactly as it already is for
-- get_order_status, which has returned the amount and payment state to anyone
-- holding one since the day it shipped.
--
-- That is only defensible because the number is not guessable: makeTrackId()
-- draws two 32-bit values from crypto.getRandomValues, so a track id carries
-- ~64 bits of entropy. Enumerating them is not a thing that happens by hand,
-- and the table has no other read path for anon.
--
-- What it returns is therefore scoped to what an invoice actually needs, and
-- the phone number is deliberately NOT in it: the customer knows their own
-- number, an invoice does not need it, and it is the one field worth keeping
-- behind the admin.

create or replace function public.get_order_invoice(p_track_id text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'track_id',       o.track_id,
    'placed_at',      o.created_at,
    'paid_at',        o.paid_at,
    'amount',         o.amount,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'customer_name',  o.customer_name,
    'address', jsonb_build_object(
      'governorate', o.customer_governorate,
      'area',        o.customer_area,
      'block',       o.customer_block,
      'street',      o.customer_street,
      'building',    o.customer_building,
      'floor',       o.customer_floor,
      'flat',        o.customer_flat
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name_en',    p.name_en,
               'name_ar',    p.name_ar,
               'qty',        oi.qty,
               'size',       oi.size,
               'fit',        oi.fit,
               -- unit_price is the price the SERVER recorded at the time of
               -- the order, not today's price. An invoice that silently
               -- re-prices itself when the shop changes a price is not an
               -- invoice.
               'unit_price', oi.unit_price,
               'line_total', (oi.unit_price * oi.qty)
             ) order by p.name_en, oi.size)
        from public.order_items oi
        join public.products p on p.id = oi.product_id
       where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where o.track_id = btrim(coalesce(p_track_id, ''))
  limit 1;
$$;

revoke all on function public.get_order_invoice(text) from public;
grant execute on function public.get_order_invoice(text) to anon, authenticated;

do $$
begin
  raise notice 'get_order_invoice ready — an order number now returns a printable invoice';
end $$;
