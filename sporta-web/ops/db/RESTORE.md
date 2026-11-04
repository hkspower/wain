# Restoring the database (`ops/db`, lane D3)

**Status: every procedure below was run on a private MariaDB by `npm run test:db-backup` (restore, compare, single rows, point-in-time),
none on the live server.** A restore is a write to the live database: it goes through the job route, with the owner's go, and with the shop
stopped for the duration. Read `BACKUP.md` first for where the files and the key are.

## 0. The numbers (what this design gives, and what it does not)

| | Number | What it means |
|---|---|---|
| **RPO, nightly dump only** | **up to 24 hours**, plus up to a day more if a failed run goes unnoticed (the daily heartbeat row is the signal) | Everything written since 02:17 UTC is lost: orders, stock changes, sign-ups, admin edits. The shop takes about one order a week, so in practice it is 0 or 1 order; the owner can usually re-enter it from the warehouse mail. |
| **RPO, with the binary log (point-in-time)** | **seconds to minutes**, to the last event the server wrote | Needs `SPORTA_DUMP_BINLOG_POS=1` and the binary log on (lane D2's `sporta-db-hardening.cnf`, 14 days). **The binary log lives in the same data volume as the database**: it survives a bad `UPDATE` or `DROP`, not a lost disk. |
| **RPO against losing the whole server** | **none today** | Until an off-site copy exists (`BACKUP.md` section 6), a lost VPS loses the database. This is the owner decision that matters most. |
| **RTO, machine time** | **minutes**. Measured here: **3 to 7 seconds** to decrypt, gunzip and load a 160 KB backup of the 28-table schema into an empty server (about 0.15 s per table: it is table creation, not data). The live database is a few megabytes (about 15 slide images of 100 to 200 KB in rows, 120 orders): expect **under a minute** to load, plus about 10 s to stop and start the web container. | The restore itself is not the slow part. |
| **RTO, human time** | **30 to 60 minutes** if the connector is signed in and the key is at hand; **hours** if the VPS must be rebuilt first | Finding the key, creating the job, reading the log, checking the shop. This is why the runbook below is a list of exact commands. |

## 1. Before anything: what you need

* The **key**: `/docker/sporta/private/backup-secrets/db-backup.key` on the server, or, if the server is gone, the escrow copy (`BACKUP.md` section 5):
  `openssl pkeyutl -decrypt -inkey backup-escrow.pem -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in escrow.bin -out db-backup.key`.
* The **backup file** (`sporta-db-<UTC stamp>.sql.gz.enc`) and its `.sha256`, from `/docker/sporta/private/backups/` or the off-site copy.
* An **admin database login** that can `CREATE`/`DROP` (not `sporta_backup`: it cannot write). How root authenticates in the container is recorded by lane D1's step 0.
* To decrypt by hand (any machine with `openssl` and `gzip`): `openssl enc -d -aes-256-cbc -md sha256 -pbkdf2 -iter 600000 -pass file:db-backup.key -in FILE | gzip -dc > dump.sql`.
  The plaintext is **personal data**: write it to `/dev/shm` (RAM) with `umask 077`, and remove it when done.

## 2. Pick the smallest procedure that fixes the problem

| What happened | Use | Shop stopped? |
|---|---|---|
| Someone deleted or damaged some rows | **2a. rows** | no |
| A table was dropped or emptied | **2b. one table** | brief |
| Everything is wrong, or the server was rebuilt | **2c. full restore** | yes |
| A bad statement ran at a known minute and you have the binary log | **2d. point in time** | yes |

### 2a. Recover some rows (shop keeps running)

1. Start a scratch server and load the backup into it: a container with `--network none` and `MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1`, the same image as the live database
   (`docker inspect -f '{{.Config.Image}}' sporta-db-mariadb-1`; `docker run --pull never`), then
   `openssl enc -d ... | gzip -dc | docker exec -i <scratch> mariadb -uroot sporta` (the exact commands `db-restore-test.sh` runs, minus the removal at the end).
2. Dump just the rows, as `REPLACE` statements, without the table definition:
   `docker exec <scratch> mariadb-dump -uroot --no-create-info --replace --skip-triggers --single-transaction --where="track_id in ('...')" sporta orders > rows.sql`
   (and the child table: `... --where="order_id in (<ids>)" sporta order_items`).
3. Load `rows.sql` into the live database as the admin login. `REPLACE` puts the old row back over a damaged one and inserts a deleted one; it touches nothing else.
4. `docker rm -f -v <scratch>`; delete `rows.sql`.

Tested: three deleted orders (with their items) and one damaged amount come back, and every other order is byte-identical before and after.

### 2b. Recover one table

As 2a, but dump the whole table (`mariadb-dump ... sporta <table>`, with its definition) and load it. If other tables point at it by foreign key, load with
`SET FOREIGN_KEY_CHECKS=0` in the same session (the dump's header already does) and run `ANALYZE TABLE` afterwards. Never `DROP` a table the shop is writing to without stopping the web container first.

### 2c. Full restore into the live database

1. **Stop the writers:** `docker stop apache-sporta-1` (the host cron jobs `docker exec` into it and will simply fail while it is down; stop `sporta-cron` is not needed).
2. **Keep what is there:** if the database still answers, `db-backup.sh run` first. The damaged state may hold the last orders; it is encrypted, small, and the newest file.
3. **Prove the file loads:** `db-restore-test.sh --file <name> --allow-drift` (restores into a throwaway container and compares; `--allow-drift` because the live source has moved since).
4. **Load it:** decrypt as in section 1 and pipe into the live database as the admin login:
   `... | docker exec -i sporta-db-mariadb-1 mariadb -uroot --default-character-set=utf8mb4 sporta`.
   The dump starts every table with `DROP TABLE IF EXISTS`, so tables are replaced. Tables that exist live but not in the backup (a newer migration) are left alone: see step 6.
5. **Erase again whoever asked to be erased since that backup** (the trap of any restore): `privacy_erasures` is part of the restored data only if the erasure predates the backup, so keep the
   **ledger from the damaged database** (step 2: it is in the pre-restore backup) and run `erase-reapply.sql` with `@privacy_confirm = 'REAPPLY'` and the same `@salt`
   (`DATA-PROTECTION.md` section 6). Skipping this brings erased people back. (Tested: a database restored from before an erasure erases the person again.)
6. **Bring the schema up to date:** every `*.mysql.sql` is idempotent; `install.mysql.sql` is the concatenation. Run it as the migration login, then `privacy-schema.sql` if it was ever applied.
7. **Start the shop:** `docker start apache-sporta-1`; run `./scan-server-response.sh`; open `/`, `/shop`, one product, `/backends` (sign in, Orders, Stock); place nothing.
8. **Take a fresh backup and run `db-restore-test.sh --fresh`** to prove the new state is itself restorable.
9. If the cause was a compromise rather than a mistake: rotate every secret in `CHECKOUT-SECRETS.md`, the database passwords (lane D1's `render-grants.mjs --rotate`), the backup key (`BACKUP.md` section 5) and the admin passwords.

### 2d. Point in time (needs the binary log and a dump taken with `SPORTA_DUMP_BINLOG_POS=1`)

The dump header records where the binary log was at the instant of the snapshot:
`-- CHANGE MASTER TO MASTER_LOG_FILE='binlog.000007', MASTER_LOG_POS=4521;`. The recovery is "load the dump, then replay the log from that position up to just before the bad statement".

1. Find the time of the bad statement (the Activity log, the warehouse mail, the order timestamps). Choose a stop time a few seconds before it.
2. Do steps 1 to 3 of 2c, but load into a **scratch** server first and check the rows you expect.
3. Replay (shown against the scratch; for the live database, the same pipe into the live client after stopping the web container):
   `docker exec <db> mariadb-binlog --start-position=4521 --stop-datetime='2026-11-04 09:14:55' /var/lib/mysql/binlog.000007 /var/lib/mysql/binlog.000008 | docker exec -i <scratch> mariadb -uroot`
   (list every log file from the recorded one onwards; times are in the database server's time zone).
4. Verify, then continue as 2c from step 5.

Tested: after the dump two good rows were inserted, then a bad `UPDATE` and a `DELETE`; replaying from the recorded position to just before them brought the good rows back and left the bad statements out.
Binary-log files hold **every changed row in plaintext** and are not covered by the encryption of the dump (`DATA-PROTECTION.md` section 3).

## 3. When the key is lost

There is no recovery: AES-256 with a 48-byte random passphrase. If the server is up, the key is on it. If both are gone, the escrow copy opens with the owner's private key. If neither exists, the
backups are noise, which is exactly what protects them from a thief. Make the escrow copy the day the key is made.

## 4. Checking that restores still work

* **Weekly** (Sunday 03:47 UTC, cron): `db-restore-test.sh --fresh` takes a new backup, restores it into a container with no network, compares **every table's row count and a CRC32 over every column of every row** (and the number of triggers, routines, events),
  removes the container, and raises `db_restore_check_failed` in the Activity log on any difference. `rate_limit` and `admin_activity_log` are compared by presence only (one is ephemeral, the other receives the backup's own alerts).
  A table that changed on the live server while the test ran is reported `moved` and judged by presence; the rest must match exactly.
* **Monthly, by a person:** run section 2a once on a spare row, so the humans have done it.
* The **host audit** (`host.backup_recent`) is the independent check that a recent file exists at all.

## 5. What the restore test does not prove

It proves the *file* restores into an empty server of the *same image* and equals the live data. It does not prove the shop's code works against the restored data (run the smoke steps of 2c.7), that the key is
safe off-server (look at the escrow copy once a quarter: decrypt it), or that the off-site copy exists.
