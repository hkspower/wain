# Lane D3: backup, recovery and data protection (index)

**Built and proven on private test instances. NOT applied to the live database or server. Nothing here is deployed.**
Every live step goes through the one-shot job route, with the owner's confirmation at apply time. Never SSH, never a PHP endpoint, never CI.

| Part | Read | Run (rig-free: own MariaDB from port 33560, own PHP; never the shared rig) | Checks |
|---|---|---|---|
| **A. Backup and restore** | `BACKUP.md` (design, install, alerts, key, off-site), `RESTORE.md` (runbook, RTO/RPO) | `npm run test:db-backup` (about 10 minutes) | 142 (12 mutation checks) |
| **B. Data protection** | `DATA-PROTECTION.md` (inventory of every personal/secret column, retention rules, erase path, owner decisions) | `npm run test:db-privacy`; `npm run db:privacy` regenerates the SQL, the PHP patch and the inventory table | 90 (11 mutation checks) |
| **C. Connection hardening** | `DB-CONNECT.md` (findings, patch, order against the other patches) | `npm run test:db-connect`; `npm run db:connect-patch` regenerates the patches from the current tree | 42 (4 mutation checks) |

## Files

* A: `db-backup.sh`, `db-restore-test.sh`, `backup-install.mjs` (host scripts and the job installer; cron file written last, separate from `sporta-cron`).
* B: `data-protection.mjs` (the inventory, source of truth), `privacy-statements.mjs` (the rules, source of truth), `privacy-render.mjs` (generates `retention-preview.sql`, `retention-apply.sql`,
  `erase-preview.sql`, `erase-apply.sql`, `erase-reapply.sql`, `privacy-php.patch`), `privacy-inventory.mjs`, `privacy-schema.sql` (additive: three nullable columns, two small tables).
* C: `make-connect-patch.mjs` (generates `db-connect.patch` and `db-connect-after-roles.patch` from whatever the tree is, refusing when a file has moved).
* Shared: `scripts/lib/private-mariadb.mjs` (a private MariaDB for suites), the three suites.

## The patches (PHP; none is applied to the tree) and the order they go in

| Patch | Against | Notes |
|---|---|---|
| `privacy-php.patch` | HEAD | two **new** files only (`privacy.php`, `cron-privacy.php`); applies with any other patch. Needs `privacy-schema.sql` first and `npm run db:grants` after (lane D1's suite fails on an unassigned `*.php`) |
| `db-connect.patch` | HEAD | edits `config-path.php`, `store.php`, `seo-runtime.php`, `assistant.php`, `php-knet/{knet,pay,callback}.php`, `php-cbk/{cbk,pay,callback}.php` |
| `db-connect-after-roles.patch` | HEAD + lane D1's `php-roles.patch` | apply the roles patch **first** (the other order fails, tested) |
| lane P1 `db-pooling.patch` | HEAD | **conflicts with `db-connect.patch`** at the five connection sites (tested, both orders). The composition is described in `DB-CONNECT.md` 3b; it needs a small merge when the gate chooses an order |
| lane K1/K2/Q1 handoff patches | HEAD | apply cleanly on top of `db-connect.patch` (tested) |

## Things other lanes should know (found while building this)

1. **Lane D1:** `sporta_ro` (`SELECT, SHOW VIEW`) cannot take the backup this lane specifies: `mariadb-dump --events` stops with error 1044 and `--routines` needs more than `SELECT` (10.11: `SELECT` on `mysql.proc`; 11.3+: `SHOW CREATE ROUTINE`). The backup uses its own login,
   `sporta_backup@localhost` (`backup-install.mjs account-sql`). README section 2's "backups use `sporta_ro`" should say so.
2. **Lane D2:** `host.backups_dir` and `host.backup_recent` read only `/docker/sporta/backups` and look for `*.sql` / `*.sql.gz`. The encrypted backups are `/docker/sporta/private/backups/sporta-db-*.sql.gz.enc`; until the audit also reads that folder and accepts
   that suffix it will keep reporting "no dump". `HOST-CHECKLIST.md` says the same lane should check `*.sql.gz.enc`.
3. **Lane D2 `sporta-db-hardening.cnf`** keeps 14 days of binary log in the data volume: point-in-time recovery uses it (`RESTORE.md` 2d), and it is plaintext (`DATA-PROTECTION.md` section 3). Decide it together with owner decision 4 of `BACKUP.md`.
4. **Lane P1:** `sporta_db_after_connect()` runs `SET SESSION max_statement_time`, which P1's pool guard treats as a dirty connection. For pooled handles put the limit on the account (`WITH MAX_STATEMENT_TIME`, tested); see `DB-CONNECT.md` 3b.
5. **Collation trap for anyone writing SQL with user variables:** a variable carries the connection collation and `column = @variable` fails with error 1267 when it differs from the tables' `utf8mb4_unicode_ci` (MariaDB 11.8's default connection collation differs). The privacy SQL casts its variables.

## Independent review (2026-11-04): what was found and fixed in this lane's own files

Re-run on private instances of the reviewer's own (suites: `db-backup` 142/0, `db-privacy` 90/0, `db-connect` 42/0). Every item below was **reproduced first**, then fixed, then given a check and (where it is a guard) a mutation check.

| # | Found | Fix |
|---|---|---|
| 1 | `SPORTA_BACKUP_KEEP_DAILY/WEEKLY/MONTHLY=00` passed the number check (only the single character `0` was refused), emptied every bucket and **deleted every backup** at the end of a successful run | strict positive number (no leading zero, at most four digits) and a guard that a folder holding backups must keep at least one |
| 2 | The alert path logged `alert=... sent=yes` when nothing had been recorded (`store_system_event()` swallows its failure, `store_db()` answers a dead database with JSON and exit 0) | the PHP prints a word only when `lastInsertId() > 0`; the shell trusts nothing else |
| 3 | `backup-install.mjs apply` set an existing `/docker/sporta/private` to 0755 and `/etc/cron.d` to 0755 | server-owned directories are created if missing and never chmod-ed; a placeholder or short escrow key now stops the job **before** it creates a key nobody can escrow |
| 4 | A hung `docker exec` held the run, and with it the lock, for ever: every later night exited 4 in silence; a failed retention step skipped the off-site copy | `SPORTA_BACKUP_DUMP_TIMEOUT` (default 7200 s), a `db_backup_skipped` Activity row, a daily 08:47 `status` cron line (the only freshness alarm), retention in a subshell, no "ok" heartbeat after a retention failure, the lock descriptor closed for the off-site hook |
| 5 | The cron step had no job file ("edit the JSON by hand") | `compose --cron` |
| 6 | External scratch database name went into a `DROP DATABASE` with only a prefix check | letters, digits and underscore only |
| 7 | SQL retention files took `@orders_days = 0` or a negative number literally (blanking every closed order at once); the PHP library clamped them | the SQL files clamp exactly as `privacy.php` does (0 to 36500, `orders_days` never under 30) |
| 8 | Retention and erasure set `fulfilment_outbox.last_error = null`, but four fixed values of it are STATE that `store.php` reads back (`order cancelled`, `order reinstated`, `order shipped`, `sending`) | those four are kept, every other value is blanked |
| 9 | `privacy.php` (an include) relied on someone adding it to `/api/.htaccess` | it answers 404 when requested over HTTP |
| 10 | `db-connect.patch` refuses a remote `db_host` without a CA: if the live `db_host` is an address or a dotted name the **whole shop** answers `db_unreachable` after the release | a hard pre-apply gate in `DB-CONNECT.md` section 3 (a read-only job prints `local` or `remote`) |
| 11 | The backup suite failed with a long `TMPDIR` (scratch sockets over 107 bytes) and looked like a slow machine | scratch sockets live in a short directory |
| 12 | Docs said the backup login "has no DDL"; `TRIGGER` and `EVENT` also allow creating them | stated plainly, with the reason it is accepted |

Still open and not fixable from the repo: nothing here has run on MariaDB 11.8 or the VPS; the **first host run** of `db-backup.sh selftest` has no job file (BACKUP.md section 3 step 4); no off-site copy exists; the pooling patch conflict (item above) is unmerged.
