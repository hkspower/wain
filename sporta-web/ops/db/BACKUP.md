# Database backups (`ops/db`, lane D3)

**Status: built and proven on a private MariaDB 10.11 and a fake `docker`. NOT installed on the live server.
Nothing here runs by itself.** Installing it is a one-shot job through the project's job route (a compose project on
VM `2058651` through the Hostinger connector), after the owner says go. Never SSH, never a PHP endpoint, never CI.
`scripts/vps-deploy.mjs` is not touched. This directory is not part of the web package (the suite asserts it).

Why this exists: the live security scan found **no database backup at all** (an October dump and a few table
copies, one of them `0644` in a `0755` folder). A database you cannot restore is not secure: an attacker, a bad
`UPDATE`, a failed disk and a mistaken `DROP` all end in the same place. Proof: `npm run test:db-backup`
(142 checks, 12 of them mutation checks, about 10 minutes on a quiet machine).

## 1. What was decided, and why

| Question | Decision | Why |
|---|---|---|
| Where does it run? | **On the host, from cron**, like the four jobs that already exist (`docker exec ... php cron-*.php`). Only `mariadb-dump` runs inside the database container (`docker exec -i`). | The official `mariadb` image always has `mariadb-dump`; nothing is installed into it or rebuilt. Compression, encryption, hashing, locking, retention and alerting need `openssl`, `gzip`, `flock`, `sha256sum`, all part of the Ubuntu base of the VPS image. The key and the backups live on the host in directories no container mounts: a job inside the database container would keep the key beside the data it protects. |
| A separate cron file | `/etc/cron.d/sporta-db-backup`, not a line in `sporta-cron` | cron ignores a **whole** cron.d file that contains one bad line. `sporta-cron` holds the stock, fulfilment, voice and birthday jobs; an install must not be able to stop them. The line format is identical, so it can be moved into `sporta-cron` later. |
| Encryption | `openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt`, passphrase from a key **file** (`-pass file:`) | `openssl` is on every Ubuntu host. `age` is nicer (authenticated, public-key recipients) but is not guaranteed to be on the image, and `apt install` from a job is another moving part. The key never reaches a command line or an environment. |
| Integrity | sha256 sidecar **and** a full decrypt + gunzip + `-- Dump completed` trailer check before the file is renamed into place | CBC is not authenticated: a flipped bit garbles a block and the gzip CRC32 over the whole plaintext catches it; the suite flips a byte, forges the sidecar to match, and still gets rejected. Someone who can write to the backup folder is root already; they could delete the backups, not forge one without the key. |
| The database login | **`sporta_backup@localhost`**, passed to `mariadb-dump` on **stdin** (`--defaults-extra-file=/dev/stdin`) | No password in a process list, an environment, a log or a compose file. `@localhost` means a unix socket inside the container: the account cannot be used from the network at all. |
| Its privileges | `SELECT, SHOW VIEW, TRIGGER, EVENT, EXECUTE` on `sporta.*`, plus the right to read routine source | **Measured:** the narrow read-only account of lane D1 (`SELECT, SHOW VIEW`) cannot run `mariadb-dump --events`: error 1044, and the dump stops half-way. Without `TRIGGER`, `EVENT`, `EXECUTE` a dump would silently omit those objects. It has no INSERT, UPDATE, DELETE, `LOCK TABLES`, `FILE`, `CREATE`, `ALTER` or `DROP`. (`--single-transaction` needs no `LOCK TABLES`.) **Honest limit (independent review):** `TRIGGER` and `EVENT` are the privileges MariaDB demands to *see* triggers and events, and they also allow *creating* them (a trigger planted on `orders` that fails would make every insert fail). There is no read-only form of either. Accepted because the login is `@localhost` inside the database container, its password is in a root-only file on the host, and anyone who can read that file is root and can already do more. `MAX_USER_CONNECTIONS 2` bounds it. |
| Routine source | `SELECT ON mysql.proc` up to MariaDB 10.11, `SHOW CREATE ROUTINE` from 11.3 | **Measured on 10.11:** without it `mariadb-dump --routines` refuses ("insufficient privileges to SHOW CREATE FUNCTION"). The installer's `account-sql` chooses by server version. The 11.x branch could not be run here: `db-backup.sh selftest` proves it on the live server before the first night. |
| Consistency | `--single-transaction --quick` | One snapshot of every table. The suite writes orders with their items **while the dump runs** and finds no half-written order; the same test with the flag removed finds thousands. |
| What is dumped | `--routines --events --triggers --hex-blob --default-character-set=utf8mb4 --skip-add-locks`, the **whole database**, old-build tables included | You cannot restore what you did not save. (The old-build tables hold the same personal data; they are in the backup and under the same key.) |
| Point-in-time | Optional: `SPORTA_DUMP_BINLOG_POS=1` adds `--master-data=2`, so the dump header records the binary-log position of its snapshot | See `RESTORE.md` 2d. Off by default: it needs the binary log (lane D2's `sporta-db-hardening.cnf` turns it on, 14 days). **Measured on 10.11:** the ordinary backup login is enough (no `RELOAD`, no `BINLOG MONITOR`), and a dump taken while orders were being written replays from its recorded position to the end of the log to a copy identical to the source. The script refuses a dump whose header carries an empty position, and `selftest` checks it. If a server (11.8?) answers differently, `account-sql --pitr` adds the two global privileges. |

## 2. What is on disk

```
/docker/sporta/private/
  bin/                        0750 root   db-backup.sh  db-restore-test.sh        (root-owned: cron runs them as root)
  backups/                    0700 root   sporta-db-YYYYMMDDTHHMMSSZ.sql.gz.enc   0600
                                          sporta-db-YYYYMMDDTHHMMSSZ.sql.gz.enc.sha256   0600
                                          backup.log  last-status  last-success  last-restore-test   (counts and names only)
  backup-secrets/             0700 root   db-backup.key   0400   48 random bytes, base64: the encryption passphrase
                                          dump.cnf        0400   [client] host/user/password of sporta_backup
                                          db-backup.key.escrow  0600  the key wrapped to the owner's PUBLIC key (optional)
/etc/cron.d/sporta-db-backup  0644 root   02:17 UTC daily backup, 03:47 UTC Sunday restore test
```

Nothing is inside `/docker/sporta/site` (the web root) and nothing is mounted into a container. The log carries
file names, byte counts, seconds, exit codes and SQL **error numbers**: never a name, phone, address, note, password
or key (the suite plants canaries and fails if any appears in the log, the console or a command line).

## 3. Installing it (nothing below has been run on the live server)

Preconditions: the owner's go; the connector signed in; the repo pushed (the job fetches files at a pinned commit from
the public repo; they hold no secret).

1. **Read the plan** (read-only): `node ops/db/backup-install.mjs compose --sha <pushed sha>` prints a compose project
   whose job mounts `/docker/sporta/private` and `/etc/cron.d` **read-only** and runs `backup-install.mjs plan`. Create it
   on VM `2058651`, read the log, delete the project. (The first create often leaves the project "not found": create
   again with the same name. No `$`, no `curl`, no `wget` in the file; Node fetches.)
2. **Place the files and make the key and the login file** (writes): `compose --sha <sha> --apply` prints the second
   project. Edit its `ESCROW_PUB` value: paste the owner's **RSA public key** (PEM, 3072 bits or more, made on the owner's
   Mac with `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out backup-escrow.pem` and
   `openssl pkey -in backup-escrow.pem -pubout`; the private half never leaves the Mac). The job places the scripts
   (`0750`), creates the directories (`0700`), creates the key and `dump.cnf` **only if they do not exist** (re-running
   never regenerates a key: that would orphan every backup), and prints the **escrow ciphertext** (base64; safe in a log;
   only the owner's private key opens it). **Copy that text off the server and keep it with the private key.** It is the
   only thing that makes a lost VPS survivable. If `ESCROW_PUB` still holds the placeholder text (or a key under 3072 bits) the job stops **before**
   it creates anything. It never changes the mode of `/docker/sporta/private` or `/etc/cron.d` (it creates them only in a temporary root); it sets
   the modes of `bin`, `backups` and `backup-secrets`, which it owns.
3. **Create the database login** (admin job, the same shape as lane D1's `README.md` section 5, "The job"):
   `node backup-install.mjs account-sql | mariadb --defaults-extra-file=/admin.cnf` (it refuses to print to a terminal). It
   reads the password from `dump.cnf`, so the same secret is in both places and in no log. How root authenticates inside
   the database container is **not recorded in the repo**; lane D1's step 0 finds out.
4. **Self-test** on the host: `/docker/sporta/private/bin/db-backup.sh selftest`. **Open point, not solved by the repo:** the connector runs one-shot containers, and these scripts
   need the host's own `docker` CLI, GNU `date`/`stat` and `flock` (a stock Alpine job has busybox versions and `selftest` then refuses with `date_not_gnu`, by design). Someone must decide
   how this one command is run on the host the first time: a job that mounts the Docker socket and `/docker/sporta/private` on an Ubuntu-based image, or any other way the owner has to
   a root shell. Until it has run once the cron file must not be installed, because the first scheduled night would be the first run. It checks the tools (`openssl`, `gzip`,
   `sha256sum`, GNU `stat` and `date`, `flock`), the key (mode `0400`/`0600`, ours, not a link, 32+ characters, in a `0700`
   directory), the login file, an encrypt/decrypt round trip, a real login, and a schema-only dump with the same object
   flags the nightly run uses. **A failure here is the privilege problem of section 1, found tonight instead of on the night a
   restore is needed.**
5. **One real backup and one real restore test:** `db-backup.sh run`, then `db-backup.sh alert-test` (check the Activity
   screen in /backends for `db_backup_alert_test`), then `db-restore-test.sh --fresh` (starts a throwaway container with no
   network, restores, compares every table, removes it; expect `restore_test=PASS`).
6. **Only then install the cron file:** `node backup-install.mjs compose --sha <sha> --cron` prints the third project (private directory mounted read-only, `/etc/cron.d` writable,
   one command: `cron --root /host --sha <sha> --confirm-sha <sha>`); it writes the one file below. It writes `/etc/cron.d/sporta-db-backup`:

   ```
   SHELL=/bin/sh
   PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
   SPORTA_ALERT_ON_OK=1
   17 2 * * * root /docker/sporta/private/bin/db-backup.sh run >> /var/log/sporta-cron.log 2>&1
   47 3 * * 0 root /docker/sporta/private/bin/db-restore-test.sh --fresh >> /var/log/sporta-cron.log 2>&1
   47 8 * * * root /docker/sporta/private/bin/db-backup.sh status >> /var/log/sporta-cron.log 2>&1
   ```
   02:17 UTC is 05:17 in Kuwait, the quietest hour of a shop that takes about one order a week; it does not collide with
   `cron-stock` (`:00 :15 :30 :45`) or `cron-fulfilment` (every 5 minutes). The 08:47 line is the freshness check: it is the only
   thing that notices a night that never produced a backup (a hung or skipped run writes no heartbeat), and raises `db_backup_stale`
   when the newest backup is older than 36 hours.
7. Delete the scratch projects. Ask lane D2 to point `host.backups_dir` / `host.backup_recent` at `/docker/sporta/private/backups`
   and accept `*.sql.gz.enc` (today it reads only `/docker/sporta/backups` and `*.sql`/`*.sql.gz`, so it would keep reporting
   "no dump" while this runs).
8. Retire the old ad-hoc copies in `/docker/sporta/backups` (a dump readable by every host user, two `api-config.php` copies holding the
   current cron key): `chmod 700 /docker/sporta/backups`, then delete them once the changes they preceded are accepted
   (the live scan's config-3 and config-4).

**Rollback:** delete `/etc/cron.d/sporta-db-backup`. Nothing else depends on it. `DROP USER 'sporta_backup'@'localhost';` removes the login.

## 4. How a failure reaches the owner

The shop already has one alarm: the **Activity** screen in /backends. `cron-fulfilment.php` writes a row there
(`store_system_event()`, key `[a-z0-9_]`, system actor) when a warehouse mail does not go. The backup uses the same call, through the
web container's PHP (`docker exec -u www-data apache-sporta-1 php -r 'require ".../store.php"; store_system_event(store_db(), $argv[1]);'`),
so it needs no new account in tier 1 and no new PHP file. The keys:

| Activity key | Raised when |
|---|---|
| `db_backup_failed` | a run stopped (key, login, dump, verify, disk, lock held), or `verify` rejected a file |
| `db_backup_stale` | `db-backup.sh status` (cron, 08:47 UTC daily) finds the newest backup older than 36 hours |
| `db_backup_skipped` | a run found the lock held by another run (a hung dump, or a manual run at 02:17): the second run exits 4 and says so |
| `db_backup_offsite_failed` | the local backup is good but the off-site hook failed (exit 9) |
| `db_restore_check_failed` | the weekly restore test failed to compare equal |
| `db_backup_ok`, `db_restore_check_ok` | **heartbeats**, daily / weekly (`SPORTA_ALERT_ON_OK=1`): **the absence of today's row is the dead-man signal** |
| `db_backup_alert_test` | `db-backup.sh alert-test` |

**The log line `alert=<key> sent=yes` means a row was written** (reviewed 2026-11-04: the PHP prints a word only when `lastInsertId() > 0`, because
`store_system_event()` swallows its own failure and `store_db()` answers a dead database with JSON and exit status 0, so the exit status alone used
to say `sent=yes` when nothing had been recorded). With the database down the alert cannot reach the Activity screen at all; the line says `sent=no`
and the failure is still in `backup.log`, `/var/log/sporta-cron.log` and syslog.

Honest limits: (1) email is not an alert path today (`private/mail/password` is missing: LIVE-SECURITY-SCAN V-1); (2) with lane
D1's **tier 2** (separate runtime accounts) the `php -r` call runs as the storefront role, which cannot insert into
`admin_activity_log`: set `SPORTA_ALERT_CMD` to a `cron-*.php` entry script, or give the role that one insert. **Run `alert-test`
after every change of accounts**; (3) if cron itself stops there is no alarm from inside the box (the 08:47 check is in the same cron file): read the heartbeat rows, and run the
host audit (`host.backup_recent`) at every deploy. Every failure is also in `backup.log`, `/var/log/sporta-cron.log` and syslog (`logger`).

## 5. The key, and the copy that survives the server

* **Lose the key and every backup is unreadable. Lose the server and the key goes with it.** The escrow file from step 2 is the
  fix: the key encrypted to the owner's RSA public key. To open it on the Mac:
  `base64 -d escrow.b64 > escrow.bin && openssl pkeyutl -decrypt -inkey backup-escrow.pem -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in escrow.bin -out db-backup.key`
  (tested against Node's `privateDecrypt` and against the stock `openssl` command).
* **Rotating the key:** create a new key file, keep the old one (old backups need it) in the password manager under its date;
  new backups use the new key. Backups are not re-encrypted.
* **If the key leaks:** treat every backup as readable by the leaker. Rotate, and remember the data inside is personal data
  (`DATA-PROTECTION.md`).

## 6. Where the copies are (and are not)

A backup on the same disk as the database protects against a bad `UPDATE`, a `DROP`, a bug, an operator mistake. It does **not** protect against
losing the VPS, the disk, the hosting account, or ransomware that reaches `/docker`. That needs a copy somewhere else, and **this lane cannot create one**:
the VPS is reached only through the connector, SSH and SFTP are off for good, and no object store or second host exists in the repo. So:

* `db-backup.sh` has an **off-site hook**: `SPORTA_OFFSITE_CMD`, a command run after a good backup with `$SPORTA_BACKUP_FILE` and `$SPORTA_BACKUP_SHA256`
  set. Failure is exit 9 and an alert; the local backup is kept. Unset by default; `status` prints `offsite=no` so the weakness stays visible.
* Options for the owner to choose between: **(a)** the VPS provider's snapshot/backup feature (Hostinger offers snapshots; confirm the plan has it and how often; a snapshot
  contains the encrypted backups and the key together, so keep the escrowed key copy elsewhere regardless); **(b)** a command that uploads the encrypted file to a bucket
  the owner already pays for (the file is encrypted: the bucket needs no trust); **(c)** a job through the connector that downloads the newest file to the owner's Mac
  weekly. Whichever is chosen is a one-line `SPORTA_OFFSITE_CMD` and a test.
* Until one exists, say so plainly: **the recovery point against loss of the server is "none"**.

## 7. What it does not cover

* The `/docker/sporta/site` files (the shop's code and images): `vps-deploy.mjs` already keeps a pre-image of everything it overwrites.
* The private config files and secrets: copy them once by hand (`/docker/sporta/private/config`, `api-config.php`, the secrets directory); they are not in the database.
* The warehouse mailbox, WhatsApp provider and other third parties.
* A running database's own files (this is a logical dump, not a copy of `/var/lib/mysql`).
* Binary logs are not backed up by this script (they are the point-in-time source, 14 days, inside the data volume).

## 8. Owner decisions

1. Go for the install, in the order of section 3.
2. The **off-site copy** (section 6). Without it the answer to "what if the server is gone" is "nothing".
3. The **escrow key pair** (section 3 step 2): who holds the private key.
4. **Point-in-time recovery:** keep 14 days of binary log and the wider `RELOAD`/`BINLOG MONITOR` login for exact recovery, or accept the 24-hour recovery point
   of the nightly dump (`RESTORE.md` has both numbers). The binary log holds every changed row in plaintext inside the data volume.
5. Retention: 14 daily + 8 weekly + 6 monthly was asked for and is the default; at the shop's size one backup is a few megabytes, so six months of history is cheap.
   Longer history also keeps erased customers longer: see `DATA-PROTECTION.md` section 6.

## 9. Proven here, and what only the live server can confirm

Proven (`npm run test:db-backup`): dump, encrypt, verify, corrupt-one-byte (both layers), restore, per-table CRC compare, retention against an independent implementation, exact-pattern
pruning that leaves everything else (and never follows a link), permissions `0600`/`0700`, key and login fail-closed cases (nine variants), the lock, the disk guard, a dead database,
an under-privileged account, the alert through the shop's real `store.php`, point-in-time recovery with the real binary log, the installer, the cron file, the escrow round trip, and
mutations (no `--single-transaction`, no encryption, blind verification, widened prune pattern, no key-mode check, no lock, blind restore comparison).

Only the live server can confirm: **MariaDB 11.8** (the build machine has 10.11: the routine-source privilege name and `--master-data` spelling on 11.8), the container name
`sporta-db-mariadb-1` (from the October scan), that `openssl`, `flock`, GNU `date`/`stat` exist on the host image (the self-test checks), how root authenticates in the container,
that the connector accepts the compose files, the real size and timings of a dump, and that `docker run --pull never <the database image>` works for the restore test
(the image is already on the host because the database runs from it).
