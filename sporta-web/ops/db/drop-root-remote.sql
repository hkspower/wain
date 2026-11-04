-- ===========================================================================
-- drop-root-remote.sql — remove root@% so root can sign in only from inside the
-- database container (root@localhost, the unix socket).
--
-- DO NOT RUN until all three are true:
--   1. audit-accounts.sql shows root@% (the official image creates it when
--      MARIADB_ROOT_HOST is left at its default) and root@localhost both exist;
--   2. you can already reach the database as root through `docker exec` into the
--      database container (the unix socket), so you are not locking yourself out;
--   3. no job, scan or tool of yours connects as root over the docker network:
--      the connections table at the end of audit-accounts.sql, taken while your
--      usual jobs run, is the evidence. After this file, such a job gets
--      "Access denied" at once. Use sporta_ro / sporta_migrate instead.
--
-- ROLLBACK: CREATE USER 'root'@'%' IDENTIFIED BY '<the root password>'; GRANT ALL
-- PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;  (as root@localhost)
-- ===========================================================================
DROP USER IF EXISTS 'root'@'%';
FLUSH PRIVILEGES;
