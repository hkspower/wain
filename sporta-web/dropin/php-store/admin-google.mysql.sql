-- Apply to existing Sporta databases before enabling Google admin sign-in.
-- A Google account is linked only by an already signed-in administrator.
--
-- Idempotent: a database built from schema.mysql.sql already has the column,
-- and `npm run sandbox` applies every additive *.mysql.sql on top of it, so a
-- plain ADD COLUMN failed there on every run ("Duplicate column name"). The
-- same guard every other additive file in this folder uses (MariaDB syntax,
-- as is the rest of the schema).
alter table admin_users add column if not exists google_sub varchar(255) null unique after email;
