-- Sporta — Supabase Storage, arranged and locked before anything is put in it.
--
-- Safe to re-run. Run AFTER admin-allowlist-migration.sql (it needs is_admin()).
--
-- ============================ WHY THIS EXISTS NOW ==========================
-- Storage is not in use today, and that is exactly when to arrange it. The
-- outstanding gap on this project is real product photography, and the ordinary
-- way that gets added is: create a bucket in the dashboard, tick "public", and
-- accept the policy template that grants insert to `authenticated`.
--
-- In Supabase `authenticated` means ANY account that has signed up, sign-up is
-- open by default, and the anon key is published in public_html/config.js
-- because it is designed to be public. That is the same chain that was closed
-- for orders and products in admin-allowlist-migration.sql:
--
--   POST /auth/v1/signup  with the public anon key  ->  an authenticated JWT
--
-- and with the template policy that JWT alone would be enough to upload
-- anything, of any size, into the shop's own CDN under the shop's own domain —
-- and to overwrite or delete every product photograph. Storage abuse is not a
-- hypothetical: an open bucket on a real domain is a file host, and it gets
-- found and used for things far worse than gym photos.
--
-- ============================== THE ARRANGEMENT =============================
-- One bucket, product-images, with:
--   * PUBLIC READ. Product photographs are shop-window data fetched by browsers
--     with no session, and signed URLs would defeat CDN caching for images whose
--     entire purpose is to be cached. "Public" here is a deliberate decision
--     about images, not a shortcut.
--   * WRITES RESTRICTED TO is_admin(). Insert, update and delete all require a
--     row in public.admin_users. Being signed in is not enough.
--   * A SIZE CEILING and an ALLOWED MIME LIST enforced by the bucket itself, so
--     the limit holds even if a policy is ever loosened by hand.
--
-- Anything else stays absent, and the report at the bottom names any other
-- public bucket so an accidental one is visible rather than discovered later.
--
-- ==================== IT IS A NO-OP IF STORAGE IS ABSENT ====================
-- This file is concatenated into SETUP-ALL.sql, which the owner pastes into the
-- SQL editor and runs blind. If the storage schema is not provisioned, or the
-- editor's role cannot alter it, this must not take the rest of the setup down
-- with it. Every statement is therefore inside a guarded block that reports what
-- it could not do instead of raising.

do $$
declare
  v_bucket text := 'product-images';
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage is not provisioned in this project — nothing to arrange. '
                 'Enable Storage, then run this file again.';
    return;
  end if;

  -- ---------- 1. the bucket, with limits it enforces itself ----------
  -- 5 MB is generous for a web product photograph and small enough that a
  -- mistake is not a bill. The MIME list excludes SVG on purpose: an SVG is a
  -- document that can carry script, and serving one from our own origin would
  -- hand an attacker same-origin execution.
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (v_bucket, v_bucket, true, 5242880,
            array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
    on conflict (id) do update
      set public             = true,
          file_size_limit    = 5242880,
          allowed_mime_types  = array['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    raise notice 'bucket % ready: public read, 5 MB cap, raster images only', v_bucket;
  exception when insufficient_privilege then
    raise notice 'Cannot write storage.buckets as this role. Create the bucket "%" '
                 'in the dashboard (Public ON, 5 MB, image/jpeg+png+webp+avif), '
                 'then run this file again.', v_bucket;
    return;
  end;

  -- ---------- 2. RLS on the objects table ----------
  -- Supabase enables this by default. Asserted rather than assumed, because with
  -- RLS off every policy below is decoration.
  begin
    execute 'alter table storage.objects enable row level security';
  exception when insufficient_privilege then
    raise notice 'Could not confirm RLS on storage.objects — check it is ON in the dashboard.';
  end;

  -- ---------- 3. policies ----------
  -- Dropped first so the file is re-runnable, and named for what they do rather
  -- than the dashboard's defaults, so a leftover template policy is obvious.
  begin
    execute 'drop policy if exists product_images_public_read on storage.objects';
    execute format($p$
      create policy product_images_public_read on storage.objects
        for select to anon, authenticated
        using (bucket_id = %L)
    $p$, v_bucket);

    -- One policy per verb rather than `for all`: `for all` was how
    -- products_admin_write became a price-tampering hole, because it reads like
    -- "admins may write" and means insert, update AND delete.
    execute 'drop policy if exists product_images_admin_insert on storage.objects';
    execute format($p$
      create policy product_images_admin_insert on storage.objects
        for insert to authenticated
        with check (bucket_id = %L and public.is_admin())
    $p$, v_bucket);

    execute 'drop policy if exists product_images_admin_update on storage.objects';
    execute format($p$
      create policy product_images_admin_update on storage.objects
        for update to authenticated
        using (bucket_id = %L and public.is_admin())
        with check (bucket_id = %L and public.is_admin())
    $p$, v_bucket, v_bucket);

    execute 'drop policy if exists product_images_admin_delete on storage.objects';
    execute format($p$
      create policy product_images_admin_delete on storage.objects
        for delete to authenticated
        using (bucket_id = %L and public.is_admin())
    $p$, v_bucket);

    raise notice 'policies set: anyone reads %, only allowlisted admins write', v_bucket;
  exception when insufficient_privilege then
    raise notice 'Could not create the storage policies as this role. Set them in '
                 'the dashboard: SELECT for anon+authenticated, and INSERT/UPDATE/'
                 'DELETE gated on public.is_admin().';
  end;
end $$;

-- ---------- 4. what is actually there ----------
-- Reported rather than assumed. A public bucket that is not product-images is
-- the finding to act on: it is reachable by anyone who guesses a path, and the
-- policies above say nothing about it.
do $$
declare
  r record;
  v_other int := 0;
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage: not provisioned';
    return;
  end if;
  for r in select id, public, file_size_limit from storage.buckets order by id loop
    raise notice 'bucket %  public=%  limit=%', r.id, r.public,
                 coalesce(r.file_size_limit::text, 'none');
    if r.public and r.id <> 'product-images' then
      v_other := v_other + 1;
    end if;
  end loop;
  if v_other > 0 then
    raise notice '% OTHER PUBLIC BUCKET(S) — anyone can read them, and nothing '
                 'above restricts who writes. Review each one.', v_other;
  end if;
end $$;
