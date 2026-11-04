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
-- is detected on a private instance that has been given the fault on purpose,
-- and goes red when a detector is blinded)
--   * empty_password = 1                    anybody can sign in as that account
--                                           (also when it has a second method such as unix_socket)
--   * anonymous = 1                          an account with an empty user name
--   * wildcard_host = 1                      reachable from any address: %, an empty host, a host
--                                            that starts with a wildcard (%%, _%) or the
--                                            0.0.0.0/0.0.0.0 netmask. wide_host = 1: some other
--                                            wildcard (10.%, 172.18.%) - read it, it may be right
--   * weak_password = 1                      the stored hash IS the hash of the user name or of a
--                                            very common password (checked inside the server; no
--                                            hash or password is printed)
--   * a role that carries privileges and is granted to an account (section 2b): the account
--     inherits them, and USER_PRIVILEGES does not show a role's grants
--   * global privileges other than USAGE     FILE / PROCESS / SUPER / RELOAD /
--                                            CREATE USER / SHUTDOWN on an app account
--   * grantable = YES                        the account can hand its power on
--   * database-wide ALL / DROP / ALTER       the web account can destroy the schema; a database
--                                            name that is a pattern (wildcard_database = 1)
--   * tables in the database that no repo migration defines (the old storefront
--     build's ~40 tables): they must stay invisible to every app account
SET SESSION TRANSACTION READ ONLY;

-- 1. the server ---------------------------------------------------------------
SELECT VERSION() AS version, @@version_comment AS build, @@skip_name_resolve AS skip_name_resolve,
       @@local_infile AS local_infile, @@secure_file_priv AS secure_file_priv, @@max_connections AS max_connections,
       @@bind_address AS bind_address, @@port AS port;
SHOW GLOBAL VARIABLES WHERE Variable_name IN ('require_secure_transport', 'have_ssl', 'ssl_ca', 'max_password_errors',
  'default_password_lifetime', 'strict_password_validation', 'old_mode', 'sql_mode', 'log_bin', 'general_log', 'log_warnings');
-- authentication plugins in use on this server (mysql_native_password is the one PHP can speak; see README)
SELECT plugin_name, plugin_status FROM information_schema.PLUGINS WHERE plugin_type = 'AUTHENTICATION' ORDER BY plugin_name;
-- plugins from a library: ACTIVE = installed, NOT INSTALLED = the .so is in the image and can be installed
SELECT plugin_name, plugin_status, plugin_type, plugin_library FROM information_schema.ALL_PLUGINS
 WHERE plugin_library IS NOT NULL ORDER BY plugin_name;

-- 2. every account ------------------------------------------------------------
-- `a` is one row per mysql.global_priv entry; the flags below are computed from it.
-- A ROLE is stored there too (is_role = 1, host empty): it is not an account that can
-- sign in, so none of the account flags apply to it.
SELECT a.user, a.host,
       CASE WHEN a.plugin IS NULL THEN 'mysql_native_password(default)' ELSE a.plugin END AS auth_plugin,
       (a.is_role = 0 AND a.user = '') AS anonymous,
       (a.is_role = 0 AND (a.host IN ('%', '', '%%') OR a.host REGEXP '^[%_]' OR a.host REGEXP '/0[.]0[.]0[.]0$')) AS wildcard_host,
       (a.is_role = 0 AND a.host REGEXP '[%_]' AND a.host NOT REGEXP '^[0-9]{1,3}([.][0-9]{1,3}){2}[.]%$') AS wide_host,
       -- an empty authentication string on the native plugin is an empty password, whatever other
       -- method (unix_socket) the account also allows: the other method does not remove this one.
       -- ('invalid' is the Debian/docker spelling of "no password works" and is not empty.)
       (a.is_role = 0 AND COALESCE(a.plugin, 'mysql_native_password') IN ('mysql_native_password', 'mysql_old_password')
         AND a.auth = '' AND a.locked = 0) AS empty_password,
       -- the hash is compared INSIDE the server with the hash of the user name and of a short list of
       -- passwords people really use; nothing is printed but the flag
       (a.is_role = 0 AND COALESCE(a.plugin, 'mysql_native_password') = 'mysql_native_password' AND a.locked = 0 AND a.auth <> ''
         AND (a.auth = CONCAT('*', UPPER(SHA1(UNHEX(SHA1(a.user)))))
              OR EXISTS (SELECT 1 FROM (SELECT 'root' AS w UNION ALL SELECT 'password' UNION ALL SELECT 'passw0rd' UNION ALL SELECT 'admin'
                                         UNION ALL SELECT 'mysql' UNION ALL SELECT 'mariadb' UNION ALL SELECT 'test' UNION ALL SELECT '123456'
                                         UNION ALL SELECT '12345678' UNION ALL SELECT 'qwerty' UNION ALL SELECT 'secret' UNION ALL SELECT 'changeme'
                                         UNION ALL SELECT 'sporta' UNION ALL SELECT 'sporta123' UNION ALL SELECT 'sporta@123'
                                         UNION ALL SELECT 'Sporta@123') c
                         WHERE a.auth = CONCAT('*', UPPER(SHA1(UNHEX(SHA1(c.w)))))))) AS weak_password,
       a.is_role, a.locked, a.max_user_connections, a.password_expired, a.default_role,
       FROM_UNIXTIME(a.password_last_changed) AS password_last_changed
  FROM (SELECT User AS user, Host AS host,
               JSON_VALUE(Priv, '$.plugin') AS plugin,
               COALESCE(JSON_VALUE(Priv, '$.authentication_string'), '') AS auth,
               COALESCE(JSON_VALUE(Priv, '$.is_role'), 0) AS is_role,
               COALESCE(JSON_VALUE(Priv, '$.account_locked'), 0) AS locked,
               COALESCE(JSON_VALUE(Priv, '$.max_user_connections'), 0) AS max_user_connections,
               COALESCE(JSON_VALUE(Priv, '$.password_expired'), 0) AS password_expired,
               JSON_VALUE(Priv, '$.default_role') AS default_role,
               JSON_VALUE(Priv, '$.password_last_changed') AS password_last_changed
          FROM mysql.global_priv) a
 ORDER BY a.user, a.host;

-- 2b. roles granted to accounts. An account that holds a role can use everything the role
-- holds (SET ROLE, or at once when it is the default role), and information_schema does NOT
-- list a role's privileges under the account, so this is the only place they show.
-- role_has_privileges = 1: the role carries a global, database or table privilege.
SELECT m.User AS user, m.Host AS host, m.Role AS role, m.Admin_option AS admin_option,
       COALESCE(JSON_VALUE(rp.Priv, '$.access'), 0) AS role_global_access_mask,
       (SELECT COUNT(*) FROM mysql.db d WHERE d.User = m.Role AND d.Host = '') AS role_database_grants,
       (SELECT COUNT(*) FROM mysql.tables_priv t WHERE t.User = m.Role AND t.Host = '') AS role_table_grants,
       (COALESCE(JSON_VALUE(rp.Priv, '$.access'), 0) > 0
         OR EXISTS (SELECT 1 FROM mysql.db d WHERE d.User = m.Role AND d.Host = '')
         OR EXISTS (SELECT 1 FROM mysql.tables_priv t WHERE t.User = m.Role AND t.Host = '')) AS role_has_privileges
  FROM mysql.roles_mapping m
  LEFT JOIN mysql.global_priv rp ON rp.User = m.Role AND rp.Host = ''
 ORDER BY m.User, m.Host, m.Role;

-- 2c. proxy grants (an account that may act as another one)
SELECT Host AS host, User AS user, Proxied_host AS proxied_host, Proxied_user AS proxied_user, With_grant AS with_grant
  FROM mysql.proxies_priv ORDER BY Host, User;

-- 3. global privileges (anything but USAGE on *.* is power over the whole server)
SELECT grantee, privilege_type AS global_privilege, is_grantable AS grantable
  FROM information_schema.USER_PRIVILEGES
 WHERE privilege_type <> 'USAGE' OR is_grantable = 'YES'
 ORDER BY grantee, privilege_type;

-- 4. database-wide privileges (CREATE / ALTER / DROP / INDEX / ALL belong to the migration account only)
SELECT grantee, table_schema AS database_name, (INSTR(table_schema, '%') > 0) AS wildcard_database,
       GROUP_CONCAT(privilege_type ORDER BY privilege_type) AS privileges, MAX(is_grantable) AS grantable
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
