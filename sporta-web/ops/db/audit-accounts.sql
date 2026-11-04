-- ===========================================================================
-- audit-accounts.sql — READ-ONLY look at who can sign in to this MariaDB and
-- what they can do. Run it FIRST, before touching anything, as the admin
-- account (it needs to read the mysql schema), from a one-shot job:
--
--   mariadb -h <db> -u <admin> -p... --batch < ops/db/audit-accounts.sql
--
-- It changes nothing, and prints no password and no password hash: only whether
-- one EXISTS. Every statement is a SELECT or SHOW; the first one makes the
-- session read-only, so the server itself refuses a write.
--
-- WHAT TO LOOK FOR (the suite, test:db-least-privilege, proves each finding below
-- is detected on a private instance that has been given the fault on purpose)
--   * empty_password = 1                    anybody can sign in as that account
--   * anonymous = 1                          an account with an empty user name
--   * wildcard_host = 1                      reachable from any address
--   * global privileges other than USAGE     FILE / PROCESS / SUPER / RELOAD /
--                                            CREATE USER / SHUTDOWN on an app account
--   * grantable = YES                        the account can hand its power on
--   * database-wide ALL / DROP / ALTER       the web account can destroy the schema
--   * tables in the database that no repo migration defines (the old storefront
--     build's ~40 tables): they must stay invisible to every app account
-- ===========================================================================
SET SESSION TRANSACTION READ ONLY;

-- 1. the server ---------------------------------------------------------------
SELECT VERSION() AS version, @@version_comment AS build, @@skip_name_resolve AS skip_name_resolve,
       @@local_infile AS local_infile, @@secure_file_priv AS secure_file_priv, @@max_connections AS max_connections,
       @@bind_address AS bind_address, @@port AS port;
SHOW GLOBAL VARIABLES WHERE Variable_name IN ('require_secure_transport', 'have_ssl', 'ssl_ca', 'max_password_errors',
  'default_password_lifetime', 'strict_password_validation', 'old_mode', 'sql_mode', 'log_bin', 'general_log', 'log_warnings');
-- plugins from a library: ACTIVE = installed, NOT INSTALLED = the .so is in the image and can be installed
SELECT plugin_name, plugin_status, plugin_type, plugin_library FROM information_schema.ALL_PLUGINS
 WHERE plugin_library IS NOT NULL ORDER BY plugin_name;

-- 2. every account ------------------------------------------------------------
SELECT User AS user, Host AS host,
       COALESCE(JSON_VALUE(Priv, '$.plugin'), 'mysql_native_password(default)') AS auth_plugin,
       (User = '') AS anonymous,
       (Host IN ('%', '', '%.%', '%.%.%', '%.%.%.%')) AS wildcard_host,
       -- an account with NO authentication_string and no alternative plugin has an empty password
       (COALESCE(JSON_VALUE(Priv, '$.plugin'), 'mysql_native_password') IN ('mysql_native_password', 'mysql_old_password')
         AND COALESCE(JSON_VALUE(Priv, '$.authentication_string'), '') = ''
         AND JSON_EXTRACT(Priv, '$.auth_or') IS NULL
         AND COALESCE(JSON_VALUE(Priv, '$.account_locked'), 0) = 0) AS empty_password,
       COALESCE(JSON_VALUE(Priv, '$.account_locked'), 0) AS locked,
       COALESCE(JSON_VALUE(Priv, '$.max_user_connections'), 0) AS max_user_connections,
       COALESCE(JSON_VALUE(Priv, '$.password_expired'), 0) AS password_expired,
       FROM_UNIXTIME(JSON_VALUE(Priv, '$.password_last_changed')) AS password_last_changed
  FROM mysql.global_priv
 ORDER BY User, Host;

-- 3. global privileges (anything but USAGE on *.* is power over the whole server)
SELECT grantee, privilege_type AS global_privilege, is_grantable AS grantable
  FROM information_schema.USER_PRIVILEGES
 WHERE privilege_type <> 'USAGE' OR is_grantable = 'YES'
 ORDER BY grantee, privilege_type;

-- 4. database-wide privileges (CREATE / ALTER / DROP / INDEX / ALL belong to the migration account only)
SELECT grantee, table_schema AS database_name, GROUP_CONCAT(privilege_type ORDER BY privilege_type) AS privileges, MAX(is_grantable) AS grantable
  FROM information_schema.SCHEMA_PRIVILEGES
 GROUP BY grantee, table_schema
 ORDER BY grantee, table_schema;

-- 5. table and column grants, counted per account (the detail is SHOW GRANTS FOR ...)
SELECT grantee, table_schema AS database_name, COUNT(*) AS table_grants,
       SUM(privilege_type IN ('DROP', 'ALTER', 'CREATE', 'INDEX', 'TRIGGER', 'REFERENCES', 'GRANT OPTION')) AS structural,
       SUM(privilege_type = 'DELETE') AS deletes, SUM(privilege_type = 'UPDATE') AS table_wide_updates
  FROM information_schema.TABLE_PRIVILEGES
 GROUP BY grantee, table_schema
 ORDER BY grantee;
SELECT grantee, table_name, GROUP_CONCAT(column_name ORDER BY column_name) AS update_columns
  FROM information_schema.COLUMN_PRIVILEGES
 WHERE privilege_type = 'UPDATE'
 GROUP BY grantee, table_name
 ORDER BY grantee, table_name;

-- 6. the databases and their tables --------------------------------------------
SELECT table_schema AS database_name, COUNT(*) AS tables, SUM(engine = 'InnoDB') AS innodb,
       SUM(engine <> 'InnoDB') AS other_engines
  FROM information_schema.TABLES
 WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'sys')
 GROUP BY table_schema;
SELECT table_schema, table_name, engine, table_rows
  FROM information_schema.TABLES
 WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'sys', 'mysql')
 ORDER BY table_schema, table_name;
SELECT table_schema, table_name, 'VIEW' AS kind FROM information_schema.VIEWS WHERE table_schema NOT IN ('information_schema', 'sys', 'mysql')
UNION ALL SELECT trigger_schema, trigger_name, 'TRIGGER' FROM information_schema.TRIGGERS WHERE trigger_schema NOT IN ('information_schema', 'sys', 'mysql')
UNION ALL SELECT routine_schema, routine_name, routine_type FROM information_schema.ROUTINES WHERE routine_schema NOT IN ('information_schema', 'sys', 'mysql')
UNION ALL SELECT event_schema, event_name, 'EVENT' FROM information_schema.EVENTS WHERE event_schema NOT IN ('information_schema', 'sys', 'mysql');

-- 7. who is connected right now -------------------------------------------------
SELECT user, SUBSTRING_INDEX(host, ':', 1) AS client, db, COUNT(*) AS connections, MAX(time) AS longest_seconds
  FROM information_schema.PROCESSLIST
 GROUP BY user, SUBSTRING_INDEX(host, ':', 1), db
 ORDER BY connections DESC;
