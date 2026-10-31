-- Applied live 2026-10-31 13:25 UTC.
-- The live api/admin.php (?r=google_status, ?r=google_unlink) and api/admin-google.php
-- read and write admin_users.google_sub, but the column was never created, so the
-- signed-in admin's Google-status check threw a database error. Additive and idempotent.
alter table admin_users
  add column if not exists google_sub varchar(255) null default null,
  add unique key if not exists uq_admin_users_google_sub (google_sub);
