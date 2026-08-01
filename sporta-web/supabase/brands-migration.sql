-- Sporta — brands.
--
-- The Postgres twin of the `brands` table in
-- dropin/php-store/schema.mysql.sql. Same columns, same rules, so the admin
-- screen and the storefront cannot tell the two backends apart.
--
-- Run it in the Supabase SQL editor. Safe to re-run.
--
-- THE LOGO IS A ROW, NOT A FILE, and that is deliberate on both backends. On
-- the native side, uploading would mean a PHP endpoint that writes to the web
-- root, which this project forbids outright. Here it would mean provisioning
-- Storage, a bucket policy and a second failure mode for a handful of small
-- images. A capped `data:image/...;base64,…` string in a column is neither.
--
-- The CHECK below is the same gate store_data_image() applies in PHP: png,
-- jpeg or webp only — never SVG, which is a document that can carry script and
-- would be served from our own origin — and a hard size cap, because a
-- client-side limit is a suggestion.

create table if not exists public.brands (
  id          bigint generated always as identity primary key,
  slug        text not null unique,
  name_en     text not null,
  name_ar     text not null,
  logo        text,
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint brands_slug_ck check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint brands_name_en_ck check (char_length(name_en) between 1 and 80),
  constraint brands_name_ar_ck check (char_length(name_ar) between 1 and 80),
  constraint brands_logo_ck check (
    logo is null
    or (logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
        and char_length(logo) <= 160000)
  )
);

create index if not exists brands_active_sort_idx on public.brands (active, sort);

-- updated_at, maintained by the database rather than by every caller
-- remembering to set it.
create or replace function public.brands_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists brands_touch on public.brands;
create trigger brands_touch before update on public.brands
  for each row execute function public.brands_touch();

-- ---------------------------------------------------------------------- RLS
-- Anyone may read the brands the shop is SHOWING. Everything else — the
-- disabled ones included — is admin only. A disabled brand that the public
-- endpoint still returns is a switch that does nothing, so the policy draws
-- the same line the native backend's `where active = 1` does.
alter table public.brands enable row level security;

drop policy if exists brands_public_read on public.brands;
create policy brands_public_read on public.brands
  for select using (active = true);

drop policy if exists brands_admin_read on public.brands;
create policy brands_admin_read on public.brands
  for select using (public.is_admin());

drop policy if exists brands_admin_write on public.brands;
create policy brands_admin_write on public.brands
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.brands to anon, authenticated;
grant insert, update on public.brands to authenticated;

-- The brands the catalogue already mentions, so the screen is not empty on
-- the first visit. Names only — the logos are added in the admin.
insert into public.brands (slug, name_en, name_ar, sort) values
  ('sporta',       'Sporta',       'سبورتا',       0),
  ('ahed',         'AHED',         'عهد',          1),
  ('rheo',         'RHEO',         'ريو',          2),
  ('vanquish',     'Vanquish',     'فانكويش',      3),
  ('ate',          'ATE',          'إيه تي إي',    4),
  ('gymshark',     'Gymshark',     'جيم شارك',     5),
  ('eyesportwear', 'Eyesportwear', 'آي سبورت وير', 6),
  ('nba',          'NBA',          'إن بي إيه',    7)
on conflict (slug) do update
  set name_en = excluded.name_en, name_ar = excluded.name_ar;
