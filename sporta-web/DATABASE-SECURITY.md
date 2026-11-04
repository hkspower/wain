# Database security: the runbook

**Status, 2026-11-04: built and proven on private test instances. NOT applied to the live database or the
server.** Owner request: "secure database". Three lanes built the pack (D1 accounts and privileges, D2 live audit and
host checklist, D3 backup, recovery and data protection), each was attacked by an independent reviewer, and this is the
one page the owner and the next session follow. The lanes' own documents stay the detail (section 10); every claim
here points at the file and the suite that carry it.

## 1. Verdict

The repo now holds a complete, tested database-security pack, and **none of it is live**. It was built and proven
only on private MariaDB 10.11.14 plus PHP 8.3 instances that the suites start and remove themselves (the shared
test rig was never touched). The live database is MariaDB 11.8.9 and PHP 8.4. What is built: eight locked,
least-privilege database accounts derived from the PHP, with a renderer that never prints or logs a password
(D1); a read-only 56-check live audit, a 22-fact host audit and the server settings file (D2); an encrypted,
verified, retention-managed nightly backup with a weekly restore test, a column-by-column personal-data inventory
with retention and erasure SQL, and a connection-hardening patch (D3). Every control has a suite with mutation
checks that fail when the control is removed (section 3). It is not applied because the Hostinger connector was
signed out for this run and every live change needs the owner's yes at apply time. So the honest live state today is
**unchanged**: the live scan found no usable database backup and there is no copy of anything off the server; the
privileges of the account the shop connects with are unknown (it is probably broad), and `root@%` probably exists
(both seen by the 2026-10-31 scan, neither measured since). **The first action is read-only: run the two audit
jobs (section 4); the second is the backup (Phase B), before any account or setting changes.**

State of the tree on this commit (checked while writing this file):

* `node ops/db/make-grants.mjs --check` says **grants.sql is stale by one line**: the new `abandoned_followup`
  migration (abandoned-orders lane) gives `sporta_migrate` a SELECT. `dropin/php-store/abandoned.php` is a **new PHP
  file that D1's suite does not classify** (`test:db-least-privilege` has a tripwire for exactly that) and its SQL is
  built by functions, so the derivation cannot see it yet. The suite is therefore expected to fail until the
  abandoned-orders route is wired in and classified. I did not re-run it for this file: the machine's load average
  was about 50 on 4 CPUs, which would turn a 3-minute suite into a long, timing-distorted one. This is the designed
  behaviour (D1-4), not a defect in the pack.
* `make-connect-patch.mjs --check` says **`db-connect.patch` and `db-connect-after-roles.patch` are STALE** (the
  release gate is editing `php-knet` and `php-cbk`). Regenerate with `npm run db:connect-patch` just before applying.
* Current: `make-audit-jobs.mjs --check` (both job files), `privacy-render.mjs --check`, `privacy-inventory.mjs
  --check`. The no-database groups of `test:db-audit` pass (109 checks, 5 s).

## 2. Ground rules (they do not change)

* Every live step goes through the existing one-shot job route: `scripts/vps-deploy.mjs` for files, a single-purpose
  compose project on VM `2058651` through the Hostinger connector for database or host work. **Never SSH, never a PHP
  endpoint, never CI.** Delete every scratch project afterwards (`vps_docker_delete`).
* **Read first, change second.** Nothing is applied until the owner says yes to that step. Read-only jobs: tell the owner.
  Anything that changes an account, a host cron file, a server setting, or deletes or anonymises data: an explicit yes
  per step.
* Schema changes are additive and idempotent. The live database must carry every repo migration before code that
  needs it ships (the 2026-11-02 outage). `ops/` is **not** in the web package (the suites assert it).
* PHP changes reach the repo only as patch files through the release gate: `store.php`, `admin.php`, the gateways
  and the cron scripts belong to it. Patches are regenerated from the current tree right before applying.
* **Never re-apply the whole `grants.sql` to a live account without `--additive` or `--only`**: the plain file empties
  an account before granting it again, and a bank callback landing in that window answers 500 after the customer paid
  (measured: 0.1 to 0.2 s for web and tens of milliseconds for a gateway on a fast disk, several times that on a slow
  one). Never add `--force` to the mariadb client. Never regenerate the backup key (it
  would orphan every backup). A password is never printed, logged, committed or typed into chat.
* After any backend change that touches SQL: `node ops/db/make-grants.mjs --check`, regenerate, read the diff, then
  re-apply additively. Code that tolerates a missing table (1146) does not tolerate a missing grant (1142).

## 3. The controls

Legend. **built+proven**: built and proven on a private 10.11 instance, not applied live. **patch ready**: a patch
file proven on a staged copy of the tree, not applied to the repo's PHP. **needs live**: also needs a live read or
MariaDB 11.8 confirmation. **not built**: a gap. Nothing in the table is applied on the live server.

| # | Control | Status | Where | Suite |
|---|---|---|---|---|
| C1 | Live database audit: 56 read-only checks (accounts, server, TLS, logs, limits, charset, schema, secrets, data hygiene). Read-only in three layers; prints counts and names, never a value | built+proven, needs live | `scripts/db-security-audit.mjs`, `ops/db/db-audit.compose.json`, `ops/db/AUDIT-FIXES.md` (FAIL to fix table) | `test:db-audit` (281 checks, 56 tool mutants killed) |
| C2 | Host audit: 22 facts SQL cannot see (is 3306 published, who shares the network, container lockdown, data folder, backup and secret-file modes, backup freshness) | built+proven on fixture hosts, needs live | `ops/db/host-audit.mjs`, `host-audit.compose.json`, `HOST-CHECKLIST.md` | `test:db-audit` (19 host mutants killed) |
| C3 | Account audit SQL: every account, empty or weak password, any-host spellings, roles, grants, connections | built+proven, needs live | `ops/db/audit-accounts.sql` | `test:db-least-privilege` (each detector planted, then blinded) |
| C4 | Live schema diff: is every repo migration on the live database | built (lane S1, awaiting review), needs live | `scripts/db-schema-diff.mjs`, `ops/db/SCHEMA-AUDIT.md`; a one-job variant `scripts/db-schema-live-diff.mjs` is not committed yet | `test:db-schema-diff`, `test:db-columns` |
| C5 | Eight locked least-privilege accounts: per-table and per-column grants derived from the PHP, connection caps, host never `%`, append-only logs, nobody deletes an order | built+proven, grants.sql stale by one line today | `ops/db/grants.sql`, `make-grants.mjs`, `accounts.mjs`, `README.md` | `test:db-least-privilege` (253 checks) |
| C6 | Password handling: server is sent only a hash (no log can hold a password), CSPRNG 40 characters, 0600 files, `--additive`, `--only`, `--rotate`, `--lock`, `--unlock`, host pattern validation | built+proven | `ops/db/render-grants.mjs` | `test:db-least-privilege` |
| C7 | Account verifier: signs in as each account and probes allowed and forbidden statements without changing a row | built+proven, needs live | `ops/db/verify-accounts.mjs` | `test:db-least-privilege` |
| C8 | Hygiene: no anonymous accounts, no `test` database, `LOAD DATA LOCAL` off, password-policy plugins | built+proven, needs live (plugins on 11.8) | `ops/db/hygiene.sql` | `test:db-least-privilege` |
| C9 | Retire the old broad application account (lock, one-statement undo) | built+proven | `ops/db/retire-old-account.sql` | `test:db-least-privilege` |
| C10 | Remove remote root | built+proven, **blocked** by finding 9 (no admin route without it) | `ops/db/drop-root-remote.sql` | `test:db-least-privilege` |
| C11 | Tier 2: separate storefront, admin and cron accounts, chosen by entry script; the storefront cannot mark an order paid or read admin tables | patch ready | `ops/db/php-roles.patch`, `php-roles-tests.patch` | `test:db-least-privilege` (section 7b, includes `test:config-rules`) |
| C12 | Per-account statement time limit, no PHP needed (`WITH MAX_STATEMENT_TIME`) | tested by D3, not written into grants.sql | `ops/db/DB-CONNECT.md` 3b | `test:db-connect` |
| C13 | Server settings: skip-name-resolve, local-infile off, secure-file-priv, strict sql_mode, utf8mb4, no general or slow log, 14-day binary log, limits, password policy, login audit, TLS floor | built+proven on 10.11, needs live rehearsal on 11.8 and a restart | `ops/db/sporta-db-hardening.cnf` | `test:db-audit` (a server is started from it and the audit finds nothing to fail) |
| C14 | TLS certificate lines (a missing certificate file stops the server from starting: measured) | built, apply last, **recommended not now** (decision 11) | `ops/db/sporta-db-tls.cnf` | `test:db-audit` |
| C15 | Connection hardening in PHP: statement time limits, no stacked statements, remote host needs TLS, no credential hint to strangers, uncaught database errors logged as class and code only, payment logs without SQL text | patch ready, patches stale today, hard gate on the live `db_host` | `ops/db/db-connect.patch`, `db-connect-after-roles.patch`, `DB-CONNECT.md`, `make-connect-patch.mjs` | `test:db-connect` (42 checks, 4 mutants) |
| C16 | Encrypted nightly backup: consistent snapshot, AES-256, verified before it is renamed into place, 14 daily + 8 weekly + 6 monthly, lock, disk guard, dead-man heartbeat, failures raise a row on the Activity screen | built+proven, needs live | `ops/db/db-backup.sh`, `backup-install.mjs`, `BACKUP.md` | `test:db-backup` (142 checks, 12 mutants) |
| C17 | Weekly restore test: restores into a no-network throwaway container and compares every table | built+proven, needs live | `ops/db/db-restore-test.sh`, `RESTORE.md` | `test:db-backup` |
| C18 | Key escrow: the backup key wrapped to the owner's RSA public key (the only thing that survives losing the server) | built+proven | `ops/db/backup-install.mjs` | `test:db-backup` |
| C19 | Dedicated backup login `sporta_backup@localhost` (D1's `sporta_ro` cannot take the specified dump) | built+proven, needs live (11.x routine privilege) | `backup-install.mjs account-sql` | `test:db-backup` |
| C20 | Point-in-time recovery from the binary log (optional) | built+proven | `RESTORE.md` 2d | `test:db-backup` |
| C21 | **Off-server copy of the backups** | **not built** (a hook exists, no route) | `SPORTA_OFFSITE_CMD` in `db-backup.sh`, `BACKUP.md` section 6 | the hook and its failure alert are tested |
| C22 | Personal-data inventory, every column, five questions each; a new column cannot ship unclassified | built+proven | `ops/db/data-protection.mjs`, `DATA-PROTECTION.md` | `test:db-privacy` (90 checks, 11 mutants) |
| C23 | Retention SQL: preview then apply, confirmation word, closed orders only, accounting columns untouched | built+proven, needs live | `ops/db/retention-preview.sql`, `retention-apply.sql`, `privacy-render.mjs` | `test:db-privacy` |
| C24 | Erasure on request, with a salted-hash ledger that re-erases after a restore | built+proven | `ops/db/erase-preview.sql`, `erase-apply.sql`, `erase-reapply.sql` | `test:db-privacy` |
| C25 | Additive schema for C23 and C24 (3 nullable columns, 2 tables) | built+proven, not applied | `ops/db/privacy-schema.sql` | `test:db-privacy` |
| C26 | Scheduled retention in PHP (two new files only) | patch ready | `ops/db/privacy-php.patch` | `test:db-privacy` |
| C27 | Seal the admin authenticator seed with a key outside the database | specified, not patched (touches release-gate files) | `DATA-PROTECTION.md` section 4 | none |
| C28 | Privacy page: the optional map-location line and a retention period | not done (needs the owner's numbers; see finding 7) | `src/pages/Privacy.jsx` | none |
| C29 | Persistent connections (pooling) | built+proven, **recommended OFF**, conflicts with C15 | `ops/db/db-pooling.patch`, `dropin/php-store/db-pool.php`, `POOLING.md` | `test:db-pool` (411 checks, 17 mutants) |
| C30 | The pack stays out of the web package | built+proven | `make-package.mjs` and `bundle-php.mjs` name no `ops/` path | asserted inside `test:db-least-privilege`, `test:db-backup`, `test:db-audit` |

## 4. Read first: the live read-only audit

Run these before anything changes, keep the output (in the job log, not in chat), and re-plan if it surprises.

1. **Host audit** (C2): `node ops/db/make-audit-jobs.mjs --check` (offline, prints ok twice), then a project from
   `ops/db/host-audit.compose.json` on VM `2058651`. Read-only mounts only, no Docker socket. The log ends with
   `HOST_AUDIT_DONE fail=N unknown=M pass=K`. It prints names, modes, owners, ports and ages, never a value. It also
   prints the database network's subnet and the account host pattern the next steps need, and the **names** of the
   variables in the database container (tells whether root's password is a literal or a `_FILE`). If the API refuses
   the payload or `pid: host`, use `make-audit-jobs.mjs --fetch <pushed sha>`; `host.firewall` is always UNKNOWN from
   inside a container (read the Hostinger firewall with the connector).
2. **Database audit, limited verdict** (C1): `ops/db/db-audit.compose.json`, signs in as the shop's own account on a
   session the server confirms is read-only (otherwise exit 2). It cannot see the account tables: those checks say
   UNKNOWN, never PASS.
3. **Account facts** (C3): `audit-accounts.sql` as the administrative account in a job. This needs the root credential
   mounted as a root-only file, so it is an owner yes. For the full verdict of C1 (accounts, triggers, other
   connections), create a short-lived `sporta_audit` account in the same job, audit, then drop it
   (`HOST-CHECKLIST.md` section 2).
4. **Schema diff** (C4): every repo migration against the live schema; a line marked MISSING ON LIVE is a migration
   that has not run (the 2026-11-02 failure). The five-export method of `db-schema-diff.mjs --print-queries` may
   overflow the job log's 300-entry cap; prefer the one-job variant from lane S1 once it is committed.
5. **`db_host` class** (hard gate for C15): a read-only job that loads the patched `config-path.php`, calls
   `sporta_db_host_is_local()` on the live value and prints only `local` or `remote` (`DB-CONNECT.md` section 3).

**Stop and re-plan if:** 3306 is published or reachable from outside the shop's network (fix that before anything
else); containers other than `apache-sporta` share the database network or connect with the app account or root (they
need their own plan before Phase C); the schema diff shows a missing migration the PHP needs (apply it first, as the
standing rule says); root's password is a literal in the container environment (it has been in `docker inspect`:
move it to a `_FILE` and rotate); the `db_host` class is `remote`.

Predictions, to be treated as hypotheses until measured (`HOST-CHECKLIST.md` section 3): FAIL on `acct.root_network`,
`acct.wildcard_host`, `acct.app_ddl`, `host.backups_dir`, `host.backup_recent`, `sec.recoverable_secrets`,
`sch.backup_copies` (three `*_legacy_2026102x` tables), and most `srv.*`, `tls.*`, `log.*`, `lim.*` settings.

## 5. The live apply plan (ordered)

Kinds: **offline** (no live effect), **read** (connector, changes nothing), **change**, **delete** (cannot be undone
without a backup). Every row except offline needs the Hostinger connector, signed in when the session starts. Owner
yes: **tell** for read, **YES** for change and delete.

Why this order: the backup comes before any change because every later step is reversible except the retention
apply and the deletes, and the backup is what covers a failure nobody predicted. Accounts come before the server
settings restart because `skip-name-resolve` needs accounts bound to addresses, and a restart wants a baseline audit
and a fresh backup. The code release train comes last because tier 2 needs the accounts and the connect patch needs the
`db_host` gate.

### Gate G: before anything live

| Step | What | Kind | Blast radius | Rollback | Owner |
|---|---|---|---|---|---|
| G0 | Re-prove at the commit being applied: `node ops/db/make-grants.mjs --check`, `make-audit-jobs.mjs --check`, `make-connect-patch.mjs --check`, `privacy-render.mjs --check`, `privacy-inventory.mjs --check`; then `npm run test:db-least-privilege`, `test:db-audit`, `test:db-backup`, `test:db-privacy`, `test:db-connect`. Regenerate what is stale and read the diff; classify `abandoned.php` when its route is wired (section 1) | offline | none (each suite uses its own private MariaDB, ports from 33400, and removes it) | not needed | no |
| G1 | Push the commit; the jobs fetch files from the public repo at that pinned SHA (they hold no secret). Start a session with the connector signed in (connectors are read at session start) | offline | none | not needed | no |

### Phase A: read first (section 4)

| Step | What | Kind | Blast radius | Rollback | Owner |
|---|---|---|---|---|---|
| A1 | Host audit job | read | none: read-only mounts, project deleted after | delete the project | tell |
| A2 | Database audit, web account (limited verdict) | read | none: read-only session, counts only | delete the project | tell |
| A3 | `audit-accounts.sql` as root; optional short-lived `sporta_audit` for the full verdict | read, then change (auditor) | the root credential is mounted for one job; the auditor can read hashes until dropped | `DROP USER 'sporta_audit'@'<host>'` | YES |
| A4 | Live schema diff | read | none | delete the project | tell |
| A5 | `db_host` class (prints only `local` or `remote`) | read | none | delete the project | tell |
| A6 | Read the results and re-plan (stop list in section 4) | decision | none | not needed | owner reads |

### Phase B: make the database recoverable (additive; before anything that can lose data)

| Step | What | Kind | Blast radius | Rollback | Owner |
|---|---|---|---|---|---|
| B1 | `node ops/db/backup-install.mjs compose --sha <sha>`: the read-only plan job | read | none | delete the project | tell |
| B2 | `compose --apply`: places the scripts (0750), creates the key and the login file only if absent, prints the escrow ciphertext. The owner supplies an RSA public key of at least 3072 bits (private half stays on the owner's Mac); **copy the escrow text off the server the same day** | change | new files and folders under the private directory only; nothing mounted in a container; no database change | delete the new folders, only before a first backup exists; never delete or regenerate the key afterwards | YES |
| B3 | `backup-install.mjs account-sql` into an admin session: creates `sporta_backup@localhost` | change | one new account, usable only inside the database container | `DROP USER 'sporta_backup'@'localhost'` | YES |
| B4 | First run on the host: `db-backup.sh selftest`, `run`, `alert-test` (check the Activity screen), `db-restore-test.sh --fresh` (expect `restore_test=PASS`). **Open point: the repo has no job route for this** (needs the host's docker CLI, GNU date and stat, flock; a stock Alpine job refuses with `date_not_gnu` by design). Options for the owner in decision 3b. Do not install B5 before this has passed once | change | one consistent read of the database (megabytes, seconds), one throwaway no-network container | delete the files it wrote | YES |
| B5 | `compose --cron`: writes `/etc/cron.d/sporta-db-backup` (its own file, so a bad line cannot disable the existing `sporta-cron`): daily 02:17 UTC backup, Sunday restore test, daily 08:47 freshness check | change (host cron) | adds a nightly read of the database | delete that one file | YES |
| B6 | An off-server copy (decision 3). Until this exists the recovery point against losing the VPS is **none**, and a backup on the same disk dies with the server | change | depends on the route | remove the hook | YES |
| B7 | `/docker/sporta/backups`: `chmod 700` the folder at once; delete the two `api-config.php` copies (they hold the current cron key) and the 0644 customer dump after B4 has passed and the owner accepts. Findings config-3 and config-4 of the live security scan | change, then delete | local host users lose read access; nothing the shop reads is there | restore permissions; deleted files are gone | YES |

### Phase C: accounts (D1's order, `ops/db/README.md` section 5)

| Step | What | Kind | Blast radius | Rollback | Owner |
|---|---|---|---|---|---|
| C1 | `render-grants.mjs --db sporta --app-host <subnet> --job-host <subnet> --secrets <new dir> --generate`, piped into the mariadb client as root, **without** `--force`. Creates eight accounts, all locked; passwords land in 0600 files in a directory the web container does not mount; the server sees hashes only. Needs the subnet from A1 and the admin route from A3 | change | nothing uses the accounts | `DROP USER` each | YES |
| C2 | `--activate web,knet,tpay,ro`, then `verify-accounts.mjs --accounts web,knet,tpay,ro`. **Every account must say ok; do not continue on any FAIL.** `sporta_migrate` and the tier 2 accounts stay locked | change | still nothing live uses them | `--lock` them | YES |
| C3 | `hygiene.sql`: anonymous accounts, `test` database, `LOAD DATA LOCAL` off, password-policy plugins (runtime; C13 makes them permanent) | change | none expected (the audit lists what existed); the plugins refuse weak new passwords | `UNINSTALL SONAME` for the plugins | YES |
| C4 | Switch the config one file at a time, smallest radius first: a. `sporta_ro` for the next scan; b. `knet-config.php` mysql values to `sporta_knet`; c. `pay-config.php` add all four values with `sporta_tpay`; d. the store's `db_user` and `db_pass` secret files to `sporta_web` (the storefront, admin and cron move here). Write secret files **in place** (`cat new > file`), not by rename (a bind mount keeps the old inode), and confirm from inside the container that PHP reads the new value. Keep `rate_limit_secret` set | change | each file moves only its own component; the old account still works | write the old value back | YES, per file |
| C5 | Watch: `./scan-server-response.sh`, a read-only crawl of `/`, `/shop`, a product, `/api/api.php?r=products`; one real cash order; one `/backends` sign-in and product save by the owner; the connections table now shows the new accounts; `db-backup.sh alert-test` again | read | none | C4 rollback | tell |
| C6 | A quiet week and one real KNET payment, then `verify-accounts.mjs` again | read | none | not needed | tell |
| C7 | `retire-old-account.sql`: lock the old `sporta_app@%` after the connections table shows no connection from it | change | anything still using the old account gets error 4151 | `ALTER USER 'sporta_app'@'%' ACCOUNT UNLOCK` | YES |
| C8 | A week later, `DROP USER 'sporta_app'@'%'` | delete | none if C7 was quiet | none | YES |
| C9 | `drop-root-remote.sql` (removes `root@%`). **Blocked** until the admin route question (finding 9) is answered: after it, jobs that connect as root over the network are refused | change | every network admin job, including this plan's own | the recreate statement in the file's header, as root@localhost | YES |

### Phase D: server settings (restart)

| Step | What | Kind | Blast radius | Rollback | Owner |
|---|---|---|---|---|---|
| D1 | Rehearse `sporta-db-hardening.cnf` on a throwaway project of the **same image** with an empty data directory and an empty mount for `secure-file-priv`: it must say "ready for connections". Then, separately, the TLS file if it is ever used. Never both files in one step | read | none: separate container, no link to the live database | delete the project | tell |
| D2 | Decide the three binary-log lines (decision 4) and the timing of the strict `sql_mode` (it was never run against the native suite: the gate runs `test:native`, `test:knet`, `test:tpay` against a copy with that mode, or the line is left out of the first restart) | decision | none | not needed | owner |
| D3 | After a manual verified backup taken just before, in the shop's quietest hour (around 05:00 Kuwait, 02:00 UTC), mount the cnf and the empty directory into the database service and recreate it. How the database service definition is edited through the connector is not recorded in the repo; settle it in A1. Then re-run `db-backup.sh selftest` and the restore test (the file sets `max_statement_time` and `wait_timeout`). Note the file's global `max_user_connections=60` binds any account without its own cap (the old one); Phase C gives the new accounts explicit caps first | change | the database is down for the restart: orders and bank callbacks that land meanwhile fail; the data volume is untouched | remove the mount, recreate | YES |
| D4 | TLS certificate file, `require_secure_transport` | not recommended now (decision 11) | switching `require_secure_transport` on before PHP speaks TLS fails every order | do not apply | owner |
| D5 | Re-run A1 and A2 (and A3's full verdict); expect only accepted FAILs (section 9) | read | none | not needed | tell |

### Phase E: the code release train (with the release gate) and data protection

| Step | What | Kind | Blast radius | Rollback | Owner |
|---|---|---|---|---|---|
| E1 | Prepare in the repo, offline: apply `php-roles.patch` and `php-roles-tests.patch`, then `db-connect-after-roles.patch` (regenerate it first), then `privacy-php.patch`; **skip the pooling patch** (conflicts, recommended off). Move `privacy-schema.sql` to a `dropin/php-store/privacy.mysql.sql` and regenerate `install.mysql.sql`; deny `privacy.php` and `cron-privacy.php` in `api/.htaccess`; `npm run db:grants`; run the gate's suites plus `test:install-sql`, `test:config-rules` and the D suites | offline | none | revert the patches | no |
| E2 | Schema first: any migration A4 found missing, then `privacy-schema.sql`, through the migrate account (unlock it for the minutes it runs, lock it straight after) | change | additive nullable columns and two small tables | none needed (additive) | YES |
| E3 | Deploy the backend with `scripts/vps-deploy.mjs --only api,knet,pay,.htaccess` (plan, then apply with the SHA twice; it backs up what it overwrites). Safe before the account switch: the roles patch falls back to `db_user` for every role. Statement limits and the TLS refusal are live from here (hard gate A5). Watch the Activity log and the error log for `code=1969` for a week | change | the whole backend; the deploy job rolls back a page that stops working | `vps-deploy.mjs compose --rollback <name>` | YES |
| E4 | Tier 2: `verify-accounts.mjs` for `shop,admin,cron`, add the `db_admin_*` and `db_cron_*` keys, switch `db_user` to `sporta_shop`, run `alert-test` (the storefront role cannot write the activity log: set `SPORTA_ALERT_CMD` to a cron entry script). Retire `sporta_web` after a quiet week as in C7 | change | each key moves one role | write the old values back | YES |
| E5 | Retention. First the owner's numbers (decision 12) and the privacy text (finding 7). Then `retention-preview.sql` (read-only), the owner reads it, then `retention-apply.sql` with the confirmation word. Preconditions: the last restore test passed, a backup exists from today | read, then **delete** (anonymises order addresses and notes, blanks old tickets and messages) | closed orders older than the period lose street, building, floor, flat, block and note (the location line); accounting columns never change | restore from the backup (that is what it is for) | YES, each run |
| E6 | Weekly cron line for `cron-privacy.php retention --apply`, and the ninth account `sporta_retention` that D3 describes (not yet in `accounts.mjs`; the D1 suite fails on the new PHP file until it is assigned) | change (host cron, account) | one weekly batch job | delete the cron line, lock the account | YES |

### Phase F: close out

| Step | What | Kind | Blast radius | Rollback | Owner |
|---|---|---|---|---|---|
| F1 | Re-run A1 to A3; record each deliberately accepted FAIL with `--accept <id>` and the reason, in a file the owner keeps | read | none | not needed | tell |
| F2 | Delete `.prev` password files left by `--rotate`; confirm the password directories are mounted nowhere | delete | none | not needed | YES |

After F the work is routine: section 9.

## 6. Who must say yes, and what needs the connector

* **No connector, no owner step:** G0, G1, E1, and writing decisions down.
* **Connector, read-only (tell the owner first):** A1, A2, A4, A5, B1, C5, C6, D1, D5, F1.
* **Connector, changes something (explicit owner yes per step):** A3 (mounts the root credential), B2, B3, B4, B5,
  B6, B7, C1 to C4, C7 to C9, D3, E2, E3 (also guarded by `vps-deploy.mjs`'s own SHA-twice check), E4, E6, F2.
* **Deletes or anonymises data (yes each time, backup first):** B7, C8, E5, F2.
* Besides the connector, B4 needs a way to run a script on the host itself (finding 10), and C1, B3, C9 need an
  administrative route into the database (finding 9).

## 7. Open findings, ranked

| # | Severity | Finding | Source | Closed by |
|---|---|---|---|---|
| 1 | high | No usable database backup, and no copy of anything off the server; the recovery point against losing the VPS is none. The live scan found only an October dump and table copies | D3-1, live scan | Phase B, decision 3 |
| 2 | high, unmeasured | The shop connects with an account of unknown, probably broad, privileges (`sporta_app@%`), and `root@%` probably exists. The application needs none of DROP, ALTER, CREATE, FILE, PROCESS, LOCK TABLES, GRANT | D1-8, scan 2026-10-31 | A3, then Phase C |
| 3 | high, known | The old backup folder: a customer dump (names, phones, addresses) is 0644 in a 0755 folder; two `api-config.php` copies hold the current cron key | config-3, config-4 | B7 |
| 4 | medium-high | Tier 1 only narrows the account; the single web account can still set `payment_status` and UPDATE `orders` as a whole, on a stolen credential or one logic bug | D1-6 | E4 (tier 2) |
| 5 | medium | Admin authenticator seed (`admin_users.totp_secret`) is stored in clear; every backup and binary log holds a working seed | D2-2, D3-8 | decision 13 |
| 6 | medium | The binary log in the settings file keeps 14 days of every changed row in plain files inside the data volume, outside the backup encryption | D3-9 | decision 4, D2 |
| 7 | medium | The privacy page does not mention the optional map-location line and states no retention period. **Editing `Privacy.jsx` does not change the live page**: the live storefront is a different build (CLAUDE.md item 4). Also outside the database: the warehouse picking mail, the WhatsApp provider, the browser's "remember my details" copy, and the old-build and `_legacy_` tables (erasure is incomplete while they exist) | D2-3, D3-10, D3-11 | decisions 12, 15 |
| 8 | medium | Restart risks: `secure-file-priv` aborts startup if its directory is missing; any 11.8 renamed option does too; the strict `sql_mode` (`STRICT_ALL_TABLES`, `NO_ZERO_DATE`, `ONLY_FULL_GROUP_BY`) was not run against the native suite; zero dates in old-build tables could break a later ALTER | D2 review | D1, D2 |
| 9 | medium | **Admin route.** D1, D3 and the audits run their administrative SQL in jobs that join the database network and sign in as the administrative account (today `root@%` is the only one known to exist). `drop-root-remote.sql` removes exactly that, so after it the pack's own account, backup, rotate and hygiene steps have no way in. Needs either a docker-exec route into the container or an administrative account that is locked except during a job (the `sporta_migrate` pattern); neither is built. Until decided, C9 stays undone | found while merging the lanes | decision 7 |
| 10 | medium | The first host run of `db-backup.sh` has no job route (needs the host's own docker CLI, GNU tools and flock). Idea, not built or tested: a temporary one-run file in `/etc/cron.d`, written by a connector job (the host's own cron already runs docker commands for the shop), output read back from the log | D3 | decision 3b |
| 11 | medium | Patch collisions and staleness: `db-connect.patch` conflicts with `db-pooling.patch` at five connection sites in both orders; `php-roles.patch` must go first; the connect patches go stale whenever `store.php`, `knet.php` or `cbk.php` change. `db-connect.patch` refuses a remote `db_host` without a CA, which would take the whole shop down | D3-4, D1 review | A5, E1 |
| 12 | medium | Procedural controls, not technical ones: `sporta_migrate` can still ALTER away data and insert an admin sign-in (keep it locked); `sporta_ro` reads every personal column and the admin secrets; `sporta_backup` holds TRIGGER and EVENT, which also allow creating them | D1 review, D3 review | decision 8, a narrower read account if wanted |
| 13 | medium | No TLS between the shop and the database; `require_secure_transport` must stay off until PHP speaks TLS, so the audit's TLS FAILs are the true state. D1 declines TLS on the private bridge; D3's patch requires it only for a remote host | D2-1, D1 | decision 11 |
| 14 | low-medium | Gaps between lanes: D1's README says backups use `sporta_ro` (they cannot: `--events` and `--routines` need more); D2's host audit reads only `/docker/sporta/backups` and `*.sql` or `*.sql.gz` files, so it will keep reporting "no dump" after B5; alerts reach only the Activity screen (mail is dead, V-1), and under tier 2 the storefront role cannot write it | D3-2, D3-3, D3-12 | doc and tool edits by those lanes; `alert-test` after every account change |
| 15 | low | Everything is proven on MariaDB 10.11, not 11.8.9 (routine-source privilege, `--master-data`, `REGEXP_REPLACE`, `UPDATE ... JOIN`, `ON DUPLICATE KEY UPDATE` column rule, plugin set, `mysql.global_priv` layout) and on PHP 8.3, not 8.4. The 11.8 end-of-life date in the audit is unconfirmed. The Hostinger edge firewall cannot be read from a container | all lanes | A1 to A3, C2 |
| 16 | low | Residual privileges: the public theme route inserts a settings row on first read (D1-3); the gateways `require_once store.php` at run time (D1-5); dynamic SET lists force table-wide UPDATE on four tables (D1-7); `sporta_shop` can UPDATE `orders.amount` of any order | D1 | PHP edits by the gate, then narrower grants |
| 17 | low | Retention edge cases: phones match on their last 8 digits; the SQL path allows the identity stage with no salt (irreversible); a cancelled order reinstated after the period has no address; statement limits can abort a locked order with error 1969 | D3 | decision 12; first-week log watch |

## 8. Owner decisions

| # | Decision | Options and recommendation | Needed before |
|---|---|---|---|
| 1 | Run the read-only audits now | Recommended yes: they change nothing | A1 |
| 2 | Install the backup; who holds the escrow private key | Recommended yes. Make the RSA key pair on the Mac; keep the private key in the password manager plus one offline copy | B2 |
| 3 | **Where the off-server copy goes** (a backup on the same VPS dies with the VPS). (a) the provider's snapshot feature (confirm the plan has it; a snapshot holds the key and the backups together, so the escrow copy must live elsewhere); (b) an upload command to a bucket the owner already has (the files are encrypted, so the bucket needs no trust); (c) a weekly pull to the Mac (the job log cap is 300 entries, so a large file through the log is doubtful and untested) | Pick one before calling the system backed up | B6 |
| 3b | How the first host run of the backup script happens | Options: a one-time job on an Ubuntu-based image that mounts the Docker socket and the private folder (root on the host: delete the project at once); or the temporary cron-file idea in finding 10 | B4 |
| 4 | Binary log: keep 14 days of plaintext row history for point-in-time recovery, encrypt it, or switch it off | My recommendation: off for now. The shop takes about one order a week, so the nightly dump's 24-hour recovery point costs at most about one order, and the binary log is the one setting that adds a plaintext copy of personal data. Delete the three `log_bin` lines and record `--accept log.binlog_pitr` | D2 |
| 5 | Tier 1 now, tier 2 with the next backend release | Recommended: tier 1 now (config values only), tier 2 with the gate's release | C4, E4 |
| 6 | Lock the old account after a quiet week; drop it a week later | Recommended yes | C7, C8 |
| 7 | An administrative route that survives dropping `root@%` | docker-exec route, or an admin account that is locked except during a job. Decide before C9; until then keep `root@%` and accept audit FAIL `acct.root_network` | C9 |
| 8 | Where the `sporta_ro`, `sporta_migrate` and `sporta_backup` password files live; whether a second, narrower read-only account is wanted | Host-only, root-owned, never in the web container; narrower account not built, say if wanted | C1 |
| 9 | Install the password-policy plugins (minimum length 24, no reuse) if the 11.8 image carries them | Recommended yes | C3 |
| 10 | Connection caps (web 100, shop 80, admin 20, cron 10, knet 15, tpay 15, ro 3, migrate 3; sums 136 and 146 against the server's 200 in the settings file) and statement limits (15, 20, 30 and 120 seconds) | Keep unless Apache's `MaxRequestWorkers` says otherwise | C1, E3 |
| 11 | TLS between the shop and the database | Recommended: decline on the private bridge (the port is not published, same host, 240-bit passwords) and record the TLS FAILs with `--accept` and the reason; revisit if the database ever leaves the host | D4 |
| 12 | Retention periods and the privacy text | Proposed defaults: 90 days for address and note after an order closes, 365 for support, 365 for returns, 30 for sent warehouse mail copies and for reset rows, 400 for the activity log; identity stage (name and phone) off. Then edit the privacy page (finding 7) | E5 |
| 13 | Authenticator seed | Seal it with a key kept outside the database (a patch through the gate), or `--accept sec.recoverable_secrets` | E1 |
| 14 | Strict `sql_mode` timing | After the gate's native suites pass against it, or leave it out of the first restart | D2, D3 |
| 15 | Erasure: who verifies a request and who may run it; what to do with `blocked_customers`, CRM notes, the warehouse mailbox, and the old-build and `_legacy_` tables | Owner policy; the legacy tables wait for the old storefront's source | first erasure request |
| 16 | Patch order | Recommended: roles, then connect-after-roles, then privacy-php; pooling stays off | E1 |

## 9. Keeping it true after it is applied

* **Every backend change that touches SQL:** `node ops/db/make-grants.mjs --check`; regenerate; read the diff; re-apply
  with `render-grants.mjs ... --additive` (never the plain file on a live account); `verify-accounts.mjs`.
  Put `test:db-least-privilege` in the release gate's suite list.
* **Daily and weekly:** the `db_backup_ok` heartbeat row on the Activity screen (its absence is the alarm);
  the Sunday restore test must say PASS.
* **At every deploy that touches the database or the host:** the A1 and A2 jobs; the A4 schema diff.
* **Quarterly:** decrypt the escrow copy once to prove it; rotate database passwords with `render-grants.mjs --rotate`
  (write the secret file in place, verify from inside the container, delete the `.prev` file); read the connections table.
* **Expected FAILs that remain after Phase F, each recorded with `--accept` and a reason:** the TLS group (decision 11),
  `sec.recoverable_secrets` until the seed is sealed (decision 13), `log.binlog_pitr` if the binary log is off
  (decision 4), `sch.backup_copies` and the old-build character-set and key findings while those tables exist,
  `acct.root_network` if C9 is deferred.

## 10. Proof, and its limits

Run from `sporta-web`, no shared rig, no network; each starts its own MariaDB (ports from 33400 up) and removes it.
This machine has 4 CPUs: run them two at a time.

| Suite | Checks reported by the lane reviews | Time on a quiet machine |
|---|---|---|
| `npm run test:db-least-privilege` | 253, effective grants of all 8 accounts read back from the server; 32 to 41 forbidden actions refused per account; the full shop flows (storefront, cash, KNET, T-Pay, admin, cron) with zero access-denied; over-grant, under-grant, code-gains-a-write and blinded-detector mutations | about 3 minutes |
| `npm run test:db-audit` | 281, 56 tool mutants and 19 host-audit mutants killed. `node scripts/db-security-audit-test.mjs --only unit,docs,compose,host`: 109 checks in 5 seconds, re-run for this file and green | about 9 minutes |
| `npm run test:db-backup` | 142 (12 mutation checks): consistency under write load, corruption, restore, retention, fail-closed cases, alerts, point-in-time, installer, escrow | about 10 minutes |
| `npm run test:db-privacy` | 90 (11 mutation checks) | not reported |
| `npm run test:db-connect` | 42 (4 mutation checks) | not reported |
| `npm run test:db-pool` | 411 (17 mutants; 66 of them need Apache with mod_php and are skipped without it) | not reported |

Not proven, and only the live server can say: MariaDB 11.8.9 and PHP 8.4 behaviour; the old account's real grants and
whether `root@%` exists; the docker subnet and how root authenticates in the container; that the connector accepts the
job files (`make-audit-jobs.mjs --fetch <sha>` is the fallback for the audit jobs); that the live schema carries every
column `grants.sql` names; real bank callbacks on the new accounts; the Apache worker count against the 100-connection
cap; whether anything else (a scan, n8n, a backup job) connects with the old account or root; the real dump size and
timing; the row counts each retention rule would change; and whether port 3306 is open at the Hostinger edge.

## 11. Where things are

`sporta-web/ops/db/`: `README.md` (accounts, D1), `HOST-CHECKLIST.md` and `AUDIT-FIXES.md` (audits, D2),
`BACKUP.md`, `RESTORE.md`, `DATA-PROTECTION.md`, `DB-CONNECT.md`, `D3-INDEX.md` (D3), `SCHEMA-AUDIT.md` (S1),
`POOLING.md` (P1). Tools: `scripts/db-security-audit.mjs`, `scripts/db-schema-diff.mjs`, `scripts/db-url-scan.mjs`.
Background: `LIVE-SECURITY-SCAN-2026-11-03.md`, `../DATA-SCAN-2026-11-02.md`, `../VPS-SCAN-2026-10-31.md`,
`CHECKOUT-SECRETS.md`, `SECURITY.md`.
