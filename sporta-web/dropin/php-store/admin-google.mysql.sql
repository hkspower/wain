-- Apply to existing Sporta databases before enabling Google admin sign-in.
-- A Google account is linked only by an already signed-in administrator.
alter table admin_users add column google_sub varchar(255) null unique after email;
