<?php
/**
 * wain's own back end — one PHP file on wain's own origin, serving `/api/wain.php`.
 *
 *   install:   php wain.php install                (both stages; migrates; seeds)
 *   serve:     POST /api/wain.php?a=<action>  JSON → JSON
 *              GET  /api/wain.php?a=<read action>&…
 *   check:     php wain.php version | selftest [stage] | seed [file] | migrate | log [n]
 *
 * WHY THIS EXISTS
 *
 * The site was written against Supabase and Supabase was never configured: both
 * `NEXT_PUBLIC_SUPABASE_*` were empty in the repository and in every live build,
 * so ordering, the queue, business registration and live place edits were all
 * inert — four finished features behind one switch nobody could throw without
 * a third-party account. The owner chose their own server instead (4 October):
 * the account already runs PHP 8.5 with PDO, SQLite and MySQL, and the two
 * bridges before this one (`/api/tts.php`, `/api/media.php`) proved the shape —
 * one file, fetched from a pinned URL and installed by a cron job, its state in
 * `<domain>/storage/` outside the document root.
 *
 * WHAT IT IS
 *
 *  • The data `supabase/schema.sql` describes, without Postgres: places, orders,
 *    queue tickets and submissions, with the same column names and the same
 *    CHECK rules written out as PHP, so the client keeps `rowToPlace` and every
 *    table-shaped type it already had. The RPCs (`order_status`, `cancel_order`,
 *    `join_queue`, `queue_status`, `leave_queue`, `queue_size`) are actions with
 *    the same semantics, including the ones that matter for safety: a wrong
 *    token returns nothing rather than «no such order», the queue number is
 *    assigned under a lock, a walk-in needs staff.
 *  • Two engines behind one dialect. SQLite at `storage/wain.sqlite` by default
 *    (zero configuration, one file, this account's PHP has the driver), or MySQL
 *    when `storage/db.json` names a database for the stage. Every statement here
 *    is written in the subset both run — VARCHAR keys, TEXT for JSON, INTEGER
 *    for booleans, ISO-8601 UTC strings for time, no upserts — and `selftest`
 *    runs the whole set on the configured engine, which is the only proof of
 *    MySQL this repository can have: the sandbox has no MySQL server.
 *  • Admin by one shared secret in `storage/admin.secret`, sent as
 *    `X-Wain-Admin`. The installer creates the file EMPTY and never fills it;
 *    while it is empty every admin action answers 503 `admin_unset`. Fail
 *    closed, same as `elevenlabs.key` and `media-admin.key`. No cookies, so no
 *    CSRF surface; the secret lives in the admin's sessionStorage.
 *  • Pending photos are read through signed URLs (HMAC on the secret, ten
 *    minutes), published by copying into `public_html/images/business/`, a
 *    directory `deploy.php`'s PROTECTED_PATHS already keeps a deploy's prune out
 *    of — the one place under the docroot a deploy will never empty.
 *
 * WHAT IT IS NOT
 *
 *  • Not an account system. Visitors are anonymous; what they hold is the id and
 *    token their device generated, the same bargain the Postgres functions made.
 *  • Not a general store. Every action is named, every field is checked against
 *    the schema's own rule, and nothing is written that the schema would have
 *    refused.
 *
 * Staging and production are separate: the stage is read from the installed
 * path (`…/staging/api/wain.php`) and each has its own SQLite file or its own
 * `db.json` entry. `storage/` itself is shared, as it is for the deploy secret.
 */

declare(strict_types=1);

/* ── constants ──────────────────────────────────────────────────────────────*/

/** The same filter the other two bridges apply, with the same caveat: an
 *  Origin header is forged in one line, so this is hygiene, not the control.
 *  The admin secret and the tokens are the controls. */
const ALLOWED_HOSTS = [
    'www.wainkw.com',
    'wainkw.com',
    'staging.wainkw.com',
];

/** Requests a minute from one address, all actions. The admin board polls
 *  three panels every 20–30 seconds, about ten a minute; a visitor placing an
 *  order makes three or four. */
const RATE_PER_MIN = 120;

/** Public WRITES a minute from one address — orders placed, tickets taken,
 *  businesses submitted. Counted before validation, so a refused body spends
 *  an attempt too: the cap is on trying, not on succeeding. */
const WRITES_PER_MIN = 20;

/** A request body larger than this is refused unread. The largest honest body
 *  is a place with a sixty-line menu and twelve image URLs — a few kilobytes. */
const MAX_BODY = 65536;

/** From places.ts / schema.sql, the only categories a place can have. */
const CATEGORIES = ['landmarks', 'restaurants', 'fastfood', 'coffee',
                    'outdoors', 'shopping', 'culture', 'family'];

/** How long a signed media URL stays good. Long enough to open a review tab,
 *  short enough that a URL pasted somewhere is dead by the time it is read. */
const MEDIA_URL_SECONDS = 600;

/** The extensions `/api/media.php` writes, and therefore the only ones a
 *  pending path may name. The type was decided by getimagesize() at upload. */
const MEDIA_EXTS = ['jpg', 'png', 'webp'];

/** Read-only actions accept GET; everything else is POST with a JSON body. */
const READ_ACTIONS = ['ping', 'places', 'order_status', 'queue_status', 'queue_size',
                      'media_get', 'whoami', 'places_all', 'orders_list', 'queue_list',
                      'submissions_list'];

/** Public writes the per-address write cap applies to. */
const PUBLIC_WRITES = ['order_place', 'order_cancel', 'queue_join', 'queue_leave', 'submit'];

/** Actions that need `X-Wain-Admin`. `queue_join` with `source: walk_in` joins
 *  this list at runtime — a walk-in is somebody staff saw. */
const ADMIN_ACTIONS = ['whoami', 'places_all', 'place_save', 'place_delete', 'place_publish',
                       'place_location', 'orders_list', 'order_set_status', 'queue_list',
                       'queue_set_status', 'submissions_list', 'submission_reject',
                       'submission_approve', 'media_sign', 'media_publish', 'media_discard'];

/* ── the log ────────────────────────────────────────────────────────────────
   Identical in shape and promises to /api/tts.php's and /api/media.php's, and
   kept copied for the same reason they are: each file must install on its own
   from one raw URL. `npm run audit:logs` asks all three for `logformat`.

   What is NEVER written: a customer's name, phone, note, email, or a
   business's contact details — the only body field a line carries is the first
   eight characters of a row id, enough to find it, and the action's name. The
   address is the first 8 hex of its hash, which ties one visitor's lines
   together and to nothing else. */
const LOG_MAX_BYTES = 262144;   // 256K, then rotate
const LOG_KEEP      = 1;        // wain.log plus wain.log.1 — 512K, for ever
const LOG_NAME      = 'wain.log';

/* ── shared helpers (the three bridges keep these byte-alike) ───────────────*/

function keyState(string $file): string {
    if (!is_file($file)) return 'ABSENT';
    return trim((string) @file_get_contents($file)) === '' ? 'EMPTY' : 'present';
}

/** Walks UP to the first `storage/` — correct at public_html/api and one level
 *  deeper at public_html/staging/api, so both installed copies are byte-
 *  identical. See tts-endpoint.php for the off-by-one this avoids. */
function storageDir(): ?string {
    $dir = __DIR__;
    for ($i = 0; $i < 5; $i++) {
        $dir = dirname($dir);
        if ($dir === '' || $dir === '/' || $dir === '.') break;
        if (is_dir("$dir/storage")) return "$dir/storage";
    }
    return null;
}

function logline(string $outcome, array $fields = []): void {
    $storage = storageDir();
    if ($storage === null) return;
    $dir = "$storage/logs";
    if (!is_dir($dir)) { @mkdir($dir, 0700, true); }

    $file = "$dir/" . LOG_NAME;
    if (@filesize($file) >= LOG_MAX_BYTES) {
        @rename($file, "$file.1");
    }

    $parts = [gmdate('Y-m-d\TH:i:s\Z'), 'wain', $outcome];
    foreach ($fields as $k => $v) {
        $parts[] = $k . '=' . preg_replace('/[^\x21-\x7e]/', '', (string) $v);
    }
    @file_put_contents($file, implode(' ', $parts) . "\n", FILE_APPEND | LOCK_EX);
    @chmod($file, 0600);
}

function logIp(): string {
    return substr(hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? '0')), 0, 8);
}

/* ── stage, time, ids ───────────────────────────────────────────────────────*/

/** Where this copy is installed decides which stage it serves. The repository
 *  copy (scripts/publish/) is «production» for CLI purposes unless told. */
function stageFromPath(): string {
    return str_contains(str_replace('\\', '/', __DIR__), '/staging/') ? 'staging' : 'production';
}

/** The document root this copy serves — api/'s parent, at either depth. */
function docroot(): string {
    return dirname(__DIR__);
}

/** Microseconds, not seconds: `created_at` is what the board sorts on, and two
 *  orders placed in the same second must still have an order. The string
 *  still sorts as text and still parses in `new Date()`. */
function nowIso(): string {
    return (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.u\Z');
}

/** Asia/Kuwait, not UTC — the schema's own choice: a queue day that turned over
 *  at 3am would restart the numbering in the middle of a late shift. */
function kuwaitDay(): string {
    return (new DateTimeImmutable('now', new DateTimeZone('Asia/Kuwait')))->format('Y-m-d');
}

function uuid4(): string {
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    $h = bin2hex($b);
    return sprintf('%s-%s-%s-%s-%s', substr($h, 0, 8), substr($h, 8, 4),
                   substr($h, 12, 4), substr($h, 16, 4), substr($h, 20, 12));
}

/* ── the database ───────────────────────────────────────────────────────────*/

/**
 * Which engine a stage runs on.
 *
 * `storage/db.json` may hold `{"production": {"dsn": "mysql:host=127.0.0.1;
 * dbname=…;charset=utf8mb4", "user": "…", "pass": "…"}, "staging": {…}}`.
 * A stage without an entry runs SQLite in its own file. Two stages never share
 * a database: a staging order on the production board would be a lie told to
 * a shop.
 */
function dbConfig(string $storage, string $stage): array {
    $file = "$storage/db.json";
    if (is_file($file)) {
        $cfg = json_decode((string) @file_get_contents($file), true);
        $entry = is_array($cfg) ? ($cfg[$stage] ?? null) : null;
        if (is_array($entry) && is_string($entry['dsn'] ?? null) && str_starts_with($entry['dsn'], 'mysql:')) {
            return ['driver' => 'mysql', 'dsn' => $entry['dsn'],
                    'user' => (string) ($entry['user'] ?? ''), 'pass' => (string) ($entry['pass'] ?? '')];
        }
    }
    return ['driver' => 'sqlite',
            'file' => "$storage/" . ($stage === 'staging' ? 'wain-staging.sqlite' : 'wain.sqlite')];
}

final class Db {
    public PDO $pdo;
    public string $driver;

    private function __construct(PDO $pdo, string $driver) {
        $this->pdo = $pdo;
        $this->driver = $driver;
    }

    public static function open(array $cfg): Db {
        $opts = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                 PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
        if ($cfg['driver'] === 'mysql') {
            $opts[PDO::ATTR_EMULATE_PREPARES] = false;
            $pdo = new PDO($cfg['dsn'], $cfg['user'], $cfg['pass'], $opts);
            $pdo->exec("SET NAMES utf8mb4");
            $pdo->exec("SET time_zone = '+00:00'");
            return new Db($pdo, 'mysql');
        }
        $file = $cfg['file'];
        $fresh = !is_file($file);
        $pdo = new PDO('sqlite:' . $file, null, null, $opts);
        if ($fresh) @chmod($file, 0600);
        /* WAL so a board poll never blocks an order being written; a busy
           timeout so two writes arriving together queue instead of failing. */
        $pdo->exec('PRAGMA journal_mode=WAL');
        $pdo->exec('PRAGMA busy_timeout=5000');
        $pdo->exec('PRAGMA synchronous=NORMAL');
        return new Db($pdo, 'sqlite');
    }

    /** Run one statement with positional parameters, typed for the driver. */
    public function run(string $sql, array $params = []): PDOStatement {
        $st = $this->pdo->prepare($sql);
        foreach (array_values($params) as $i => $v) {
            $type = PDO::PARAM_STR;
            if (is_int($v)) $type = PDO::PARAM_INT;
            elseif (is_bool($v)) { $v = $v ? 1 : 0; $type = PDO::PARAM_INT; }
            elseif ($v === null) $type = PDO::PARAM_NULL;
            elseif (is_float($v)) $v = (string) $v;
            $st->bindValue($i + 1, $v, $type);
        }
        $st->execute();
        return $st;
    }

    public function one(string $sql, array $params = []): ?array {
        $r = $this->run($sql, $params)->fetch();
        return $r === false ? null : $r;
    }

    public function all(string $sql, array $params = []): array {
        return $this->run($sql, $params)->fetchAll();
    }

    public function scalar(string $sql, array $params = []): mixed {
        $v = $this->run($sql, $params)->fetchColumn();
        return $v === false ? null : $v;
    }

    /**
     * A write under a lock. SQLite: `BEGIN IMMEDIATE` takes the database's one
     * write lock, so two joiners serialise. MySQL: a row in `locks` taken FOR
     * UPDATE inside the transaction does the same per name — one lock per
     * salon-day would be finer, but a queue join is milliseconds and this is a
     * salon, not an exchange.
     */
    public function tx(string $lock, callable $fn): mixed {
        if ($this->driver === 'sqlite') {
            $this->pdo->exec('BEGIN IMMEDIATE');
        } else {
            $this->pdo->beginTransaction();
            $this->run('SELECT name FROM locks WHERE name = ? FOR UPDATE', [$lock]);
        }
        try {
            $out = $fn($this);
            $this->driver === 'sqlite' ? $this->pdo->exec('COMMIT') : $this->pdo->commit();
            return $out;
        } catch (Throwable $e) {
            try { $this->driver === 'sqlite' ? $this->pdo->exec('ROLLBACK') : $this->pdo->rollBack(); } catch (Throwable) {}
            throw $e;
        }
    }

    private function ensureIndex(string $name, string $table, string $cols, bool $unique = false): void {
        $u = $unique ? 'UNIQUE ' : '';
        if ($this->driver === 'sqlite') {
            $this->pdo->exec("CREATE {$u}INDEX IF NOT EXISTS $name ON $table ($cols)");
            return;
        }
        /* MySQL has no IF NOT EXISTS for an index (MariaDB does; the account's
           server is one or the other and this must not care). */
        $n = (int) $this->scalar(
            'SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
            [$table, $name]);
        if ($n === 0) $this->pdo->exec("CREATE {$u}INDEX $name ON $table ($cols)");
    }

    /**
     * The schema, idempotent. Column names are schema.sql's; types are the
     * subset both engines share. JSON lives in TEXT, booleans in INTEGER, time
     * in ISO-8601 UTC strings (which sort as text). Nothing has a DEFAULT —
     * every insert names every column — so a MySQL TEXT column's no-default
     * rule and SQLite's indifference agree.
     */
    public function migrate(): void {
        $tail = $this->driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
        $x = fn(string $sql) => $this->pdo->exec($sql . $tail);

        $x('CREATE TABLE IF NOT EXISTS locks (name VARCHAR(64) NOT NULL PRIMARY KEY)');
        $x('CREATE TABLE IF NOT EXISTS places (
              id VARCHAR(36) NOT NULL PRIMARY KEY,
              slug VARCHAR(191) NOT NULL,
              name TEXT NOT NULL, name_ar TEXT NOT NULL,
              category VARCHAR(32) NOT NULL,
              area TEXT NOT NULL, area_ar TEXT NOT NULL,
              lat DOUBLE NOT NULL, lng DOUBLE NOT NULL,
              rating DOUBLE NULL,
              price_level INTEGER NOT NULL,
              emoji TEXT NOT NULL,
              tagline_ar TEXT NOT NULL, description_ar TEXT NOT NULL,
              highlights_ar TEXT NOT NULL,
              best_time_ar TEXT NOT NULL,
              setting VARCHAR(16) NOT NULL,
              season_ar TEXT NOT NULL,
              tags_ar TEXT NOT NULL,
              logo_url TEXT NULL,
              bio_ar TEXT NOT NULL,
              image_urls TEXT NOT NULL,
              phone TEXT NOT NULL, instagram TEXT NOT NULL, website TEXT NOT NULL,
              products_ar TEXT NOT NULL,
              menu_ar TEXT NOT NULL,
              accepts_orders INTEGER NOT NULL,
              order_note_ar TEXT NOT NULL,
              order_prep_minutes INTEGER NOT NULL,
              order_whatsapp VARCHAR(16) NOT NULL,
              salon_kind VARCHAR(8) NOT NULL,
              takes_queue INTEGER NOT NULL,
              queue_service_minutes INTEGER NOT NULL,
              featured INTEGER NOT NULL, published INTEGER NOT NULL,
              sort_order INTEGER NOT NULL,
              created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL)');
        $this->ensureIndex('places_slug_idx', 'places', 'slug', true);
        $this->ensureIndex('places_sort_idx', 'places', 'sort_order, created_at');

        $x('CREATE TABLE IF NOT EXISTS orders (
              id VARCHAR(36) NOT NULL PRIMARY KEY,
              track_token VARCHAR(64) NOT NULL,
              status VARCHAR(16) NOT NULL,
              place_slug VARCHAR(191) NOT NULL,
              place_name_ar TEXT NOT NULL,
              lines TEXT NOT NULL,
              total_fils INTEGER NOT NULL,
              pickup_at VARCHAR(5) NOT NULL,
              customer_name TEXT NOT NULL,
              customer_phone VARCHAR(8) NOT NULL,
              note_ar TEXT NOT NULL,
              admin_note TEXT NOT NULL,
              ready_at VARCHAR(32) NULL, collected_at VARCHAR(32) NULL, cancelled_at VARCHAR(32) NULL,
              created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL)');
        $this->ensureIndex('orders_place_idx', 'orders', 'place_slug, created_at');
        $this->ensureIndex('orders_status_idx', 'orders', 'status, created_at');

        $x('CREATE TABLE IF NOT EXISTS queue_tickets (
              id VARCHAR(36) NOT NULL PRIMARY KEY,
              track_token VARCHAR(64) NOT NULL,
              place_slug VARCHAR(191) NOT NULL,
              place_name_ar TEXT NOT NULL,
              day VARCHAR(10) NOT NULL,
              number INTEGER NOT NULL,
              status VARCHAR(16) NOT NULL,
              source VARCHAR(16) NOT NULL,
              customer_name TEXT NOT NULL,
              customer_phone VARCHAR(8) NOT NULL,
              called_at VARCHAR(32) NULL, served_at VARCHAR(32) NULL, ended_at VARCHAR(32) NULL,
              created_at VARCHAR(32) NOT NULL, updated_at VARCHAR(32) NOT NULL)');
        /* One salon, one day, one number — the constraint that turns the lock
           in queue_join from a hope into a guarantee: a race hands the second
           insert an error, never two customers the same ticket. */
        $this->ensureIndex('queue_number_idx', 'queue_tickets', 'place_slug, day, number', true);
        $this->ensureIndex('queue_open_idx', 'queue_tickets', 'place_slug, day, status, number');

        $x('CREATE TABLE IF NOT EXISTS submissions (
              id VARCHAR(36) NOT NULL PRIMARY KEY,
              status VARCHAR(16) NOT NULL,
              name TEXT NOT NULL, name_ar TEXT NOT NULL,
              category VARCHAR(32) NOT NULL,
              area_ar TEXT NOT NULL, address_ar TEXT NOT NULL,
              lat DOUBLE NULL, lng DOUBLE NULL,
              price_level INTEGER NOT NULL,
              tagline_ar TEXT NOT NULL, description_ar TEXT NOT NULL,
              phone TEXT NOT NULL, instagram TEXT NOT NULL, website TEXT NOT NULL,
              contact_name TEXT NOT NULL, contact_email TEXT NOT NULL, contact_phone TEXT NOT NULL,
              logo_path TEXT NULL,
              image_paths TEXT NOT NULL,
              bio_ar TEXT NOT NULL,
              products_ar TEXT NOT NULL,
              admin_note TEXT NOT NULL,
              reviewed_at VARCHAR(32) NULL,
              published_slug TEXT NULL,
              created_at VARCHAR(32) NOT NULL)');
        $this->ensureIndex('submissions_status_idx', 'submissions', 'status, created_at');

        $ignore = $this->driver === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
        foreach (['queue', 'orders', 'submissions', 'places'] as $lock) {
            $this->run("$ignore INTO locks (name) VALUES (?)", [$lock]);
        }
    }
}

/* ── validation ─────────────────────────────────────────────────────────────
   Every rule below is a CHECK from supabase/schema.sql written as PHP. The
   message is for the log and the admin; the public client shows its own Arabic
   sentence per `error`/`field`, as it did for Postgres' error codes. */

final class Invalid extends Exception {
    public function __construct(public readonly string $field, string $message) {
        parent::__construct($message);
    }
}

function vStr(array $in, string $k, int $min, int $max, bool $trim = true): string {
    $v = $in[$k] ?? '';
    if (!is_string($v)) throw new Invalid($k, "$k must be a string");
    if ($trim) $v = trim($v);
    $n = mb_strlen($v);
    if ($n < $min || $n > $max) throw new Invalid($k, "$k must be $min–$max characters");
    return $v;
}

function vEnum(array $in, string $k, array $allowed, ?string $default = null): string {
    $v = $in[$k] ?? $default;
    if (!is_string($v) || !in_array($v, $allowed, true)) throw new Invalid($k, "$k must be one of " . implode('|', $allowed));
    return $v;
}

function vInt(array $in, string $k, int $min, int $max, ?int $default = null): int {
    $v = $in[$k] ?? $default;
    if (is_string($v) && preg_match('/^-?\d+$/', $v)) $v = (int) $v;
    if (is_float($v) && floor($v) === $v) $v = (int) $v;
    if (!is_int($v) || $v < $min || $v > $max) throw new Invalid($k, "$k must be an integer $min–$max");
    return $v;
}

function vNum(array $in, string $k, float $min, float $max, bool $nullable = false): ?float {
    $v = $in[$k] ?? null;
    if ($v === null || $v === '') {
        if ($nullable) return null;
        throw new Invalid($k, "$k is required");
    }
    if (is_string($v) && is_numeric($v)) $v = (float) $v;
    if (is_int($v)) $v = (float) $v;
    if (!is_float($v) || !is_finite($v) || $v < $min || $v > $max) throw new Invalid($k, "$k must be a number $min–$max");
    return $v;
}

function vBool(array $in, string $k, bool $default = false): bool {
    $v = $in[$k] ?? $default;
    if (is_int($v)) $v = $v !== 0;
    if (!is_bool($v)) throw new Invalid($k, "$k must be true or false");
    return $v;
}

function vRe(array $in, string $k, string $re, string $what, bool $allowEmpty = false): string {
    $v = $in[$k] ?? '';
    if (!is_string($v)) throw new Invalid($k, "$k must be a string");
    $v = trim($v);
    if ($v === '' && $allowEmpty) return '';
    if (!preg_match($re, $v)) throw new Invalid($k, "$k must be $what");
    return $v;
}

/** A list of strings, each trimmed and non-empty, at most $max of them. */
function vStrList(array $in, string $k, int $max, int $eachMax = 500): array {
    $v = $in[$k] ?? [];
    if ($v === null) $v = [];
    if (!is_array($v) || !array_is_list($v)) throw new Invalid($k, "$k must be a list");
    $out = [];
    foreach ($v as $s) {
        if (!is_string($s)) throw new Invalid($k, "$k must be a list of strings");
        $s = trim($s);
        if ($s === '') continue;
        if (mb_strlen($s) > $eachMax) throw new Invalid($k, "an entry of $k is too long");
        $out[] = $s;
    }
    if (count($out) > $max) throw new Invalid($k, "$k holds at most $max entries");
    return $out;
}

function vUuid(array $in, string $k): string {
    return strtolower(vRe($in, $k, '/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', 'a uuid'));
}

function vToken(array $in, string $k = 'track_token'): string {
    return vRe($in, $k, '/^[A-Za-z0-9_-]{20,64}$/', '20–64 token characters');
}

const RE_SLUG    = '/^[a-z0-9-]{1,191}$/';
const RE_PHONE   = '/^[569][0-9]{7}$/';
const RE_WEBSITE = '/^https?:\/\/\S{3,}$/i';
const RE_EMAIL   = '/^[^@\s]+@[^@\s]+\.[^@\s]+$/';
const RE_PICKUP  = '/^[0-2][0-9]:[0-5][0-9]$/';

/** [{ id, nameAr, priceFils, qty }] as the customer was shown them — stored as
 *  sent, so the shop sees what the customer saw and a mismatch with its own
 *  menu is a thing a human notices rather than one that is silently fixed. */
function vOrderLines(array $in): array {
    $v = $in['lines'] ?? null;
    if (!is_array($v) || count($v) < 1 || count($v) > 20) throw new Invalid('lines', 'lines must hold 1–20 entries');
    $out = [];
    foreach ($v as $l) {
        if (!is_array($l)) throw new Invalid('lines', 'each line must be an object');
        try {
            $out[] = [
                'id'        => vStr($l, 'id', 1, 80),
                'nameAr'    => vStr($l, 'nameAr', 1, 120),
                'priceFils' => vInt($l, 'priceFils', 0, 500000),
                'qty'       => vInt($l, 'qty', 1, 99),
            ];
        } catch (Invalid $e) {
            throw new Invalid('lines', 'a line is wrong: ' . $e->getMessage());
        }
    }
    return $out;
}

/** [{ id, nameAr, priceFils, noteAr?, soldOut? }], at most 60 — the shape
 *  PlaceForm writes and the panel reads. */
function vMenu(array $in): array {
    $v = $in['menu_ar'] ?? [];
    if ($v === null) $v = [];
    if (!is_array($v) || count($v) > 60) throw new Invalid('menu_ar', 'menu_ar holds at most 60 items');
    $out = [];
    foreach ($v as $m) {
        if (!is_array($m)) throw new Invalid('menu_ar', 'each menu item must be an object');
        try {
            $item = [
                'id'        => vStr($m, 'id', 1, 80),
                'nameAr'    => vStr($m, 'nameAr', 1, 120),
                'priceFils' => vInt($m, 'priceFils', 0, 500000),
            ];
            if (isset($m['noteAr']) && $m['noteAr'] !== '') $item['noteAr'] = vStr($m, 'noteAr', 1, 200);
        } catch (Invalid $e) {
            throw new Invalid('menu_ar', 'a menu item is wrong: ' . $e->getMessage());
        }
        if (!empty($m['soldOut'])) $item['soldOut'] = true;
        $out[] = $item;
    }
    return $out;
}

/** The whole place row, as placeToRow() sends it. */
function vPlace(array $in): array {
    $rating = vNum($in, 'rating', 0, 5, true);
    return [
        'slug'           => vRe($in, 'slug', RE_SLUG, 'lowercase letters, digits and hyphens'),
        'name'           => vStr($in, 'name', 1, 200),
        'name_ar'        => vStr($in, 'name_ar', 1, 200),
        'category'       => vEnum($in, 'category', CATEGORIES),
        'area'           => vStr($in, 'area', 1, 120),
        'area_ar'        => vStr($in, 'area_ar', 1, 120),
        'lat'            => vNum($in, 'lat', -90, 90),
        'lng'            => vNum($in, 'lng', -180, 180),
        'rating'         => $rating === null ? null : round($rating, 1),
        'price_level'    => vInt($in, 'price_level', 1, 3),
        'emoji'          => ($e = vStr($in, 'emoji', 0, 16)) === '' ? '📍' : $e,
        'tagline_ar'     => vStr($in, 'tagline_ar', 1, 400),
        'description_ar' => vStr($in, 'description_ar', 1, 4000),
        'highlights_ar'  => vStrList($in, 'highlights_ar', 30),
        'best_time_ar'   => vStr($in, 'best_time_ar', 0, 400),
        'setting'        => vEnum($in, 'setting', ['indoor', 'outdoor', 'mixed'], 'mixed'),
        'season_ar'      => vStr($in, 'season_ar', 0, 400),
        'tags_ar'        => vStrList($in, 'tags_ar', 30),
        'logo_url'       => ($in['logo_url'] ?? null) === null ? null : vStr($in, 'logo_url', 1, 500),
        'bio_ar'         => vStr($in, 'bio_ar', 0, 2000),
        'image_urls'     => vStrList($in, 'image_urls', 24),
        'phone'          => vStr($in, 'phone', 0, 40),
        'instagram'      => vStr($in, 'instagram', 0, 80),
        'website'        => ($w = vStr($in, 'website', 0, 200)) === '' ? '' : vRe($in, 'website', RE_WEBSITE, 'an http(s) URL'),
        'products_ar'    => vStrList($in, 'products_ar', 20),
        'menu_ar'        => vMenu($in),
        'accepts_orders' => vBool($in, 'accepts_orders'),
        'order_note_ar'  => vStr($in, 'order_note_ar', 0, 300),
        'order_prep_minutes'    => vInt($in, 'order_prep_minutes', 5, 240, 30),
        'order_whatsapp' => vRe($in, 'order_whatsapp', RE_PHONE, 'eight Kuwaiti digits', true),
        'salon_kind'     => vEnum($in, 'salon_kind', ['', 'men', 'women'], ''),
        'takes_queue'    => vBool($in, 'takes_queue'),
        'queue_service_minutes' => vInt($in, 'queue_service_minutes', 5, 180, 20),
        'featured'       => vBool($in, 'featured'),
        'published'      => vBool($in, 'published', true),
        'sort_order'     => vInt($in, 'sort_order', -1000000, 1000000, 0),
    ];
}

/* ── row shaping ────────────────────────────────────────────────────────────*/

const PLACE_JSON  = ['highlights_ar', 'tags_ar', 'image_urls', 'products_ar', 'menu_ar'];
const PLACE_BOOL  = ['accepts_orders', 'takes_queue', 'featured', 'published'];
const PLACE_INT   = ['price_level', 'order_prep_minutes', 'queue_service_minutes', 'sort_order'];
const PLACE_FLOAT = ['lat', 'lng', 'rating'];

/** A stored row → the PlaceRow the client already knows how to read. */
function placeOut(array $r): array {
    foreach (PLACE_JSON as $k)  $r[$k] = json_decode((string) $r[$k], true) ?? [];
    foreach (PLACE_BOOL as $k)  $r[$k] = (int) $r[$k] === 1;
    foreach (PLACE_INT as $k)   $r[$k] = (int) $r[$k];
    foreach (PLACE_FLOAT as $k) $r[$k] = $r[$k] === null ? null : (float) $r[$k];
    return $r;
}

function jsonCol(array $v): string {
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** The columns and values of a validated place, for INSERT or UPDATE. */
function placeColumns(array $p): array {
    foreach (PLACE_JSON as $k) $p[$k] = jsonCol($p[$k]);
    return $p;
}

function submissionOut(array $r): array {
    $r['image_paths'] = json_decode((string) $r['image_paths'], true) ?? [];
    $r['products_ar'] = json_decode((string) $r['products_ar'], true) ?? [];
    $r['price_level'] = (int) $r['price_level'];
    $r['lat'] = $r['lat'] === null ? null : (float) $r['lat'];
    $r['lng'] = $r['lng'] === null ? null : (float) $r['lng'];
    return $r;
}

function orderOut(array $r): array {
    unset($r['track_token']);
    $r['lines'] = json_decode((string) $r['lines'], true) ?? [];
    $r['total_fils'] = (int) $r['total_fils'];
    return $r;
}

function ticketOut(array $r): array {
    unset($r['track_token']);
    $r['number'] = (int) $r['number'];
    return $r;
}

/* ── CLI: install / version / selftest / seed / migrate / log ───────────────*/
if (PHP_SAPI === 'cli') {
    $home   = getenv('HOME') ?: __DIR__;
    $domain = 'wainkw.com';
    $web    = "$home/domains/$domain/public_html";

    $targets = [
        'production' => "$web/api/wain.php",
        'staging'    => "$web/staging/api/wain.php",
    ];

    /* An installed copy finds the real storage/ by walking up; the
       repository copy has none to find and writes INTO the HOME/domain shape. */
    $installed  = storageDir() !== null;
    $storage    = storageDir() ?? "$home/domains/$domain/storage";
    $secretFile = "$storage/admin.secret";

    $out = static function (array $r): never {
        echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
        exit;
    };
    $print = static fn(string $f): ?string =>
        ($h = @hash_file('sha256', $f)) === false ? null : substr($h, 0, 16);

    $mode  = $argv[1] ?? '';
    /* The stage: from the path when installed, from the argument otherwise.
       `selftest staging` from the repository copy exercises staging's engine. */
    $stageArg = in_array($argv[2] ?? '', ['production', 'staging'], true) ? $argv[2] : null;
    $stage = $installed ? stageFromPath() : ($stageArg ?? 'production');

    $openDb = static function (string $forStage) use ($storage): Db {
        if (!is_dir($storage)) @mkdir($storage, 0700, true);
        $db = Db::open(dbConfig($storage, $forStage));
        $db->migrate();
        return $db;
    };

    /** Insert every row of a places.json the table does not have a slug for.
     *  Never overwrites: an admin's live edit outranks the build's snapshot,
     *  and a deploy must not undo it. */
    $seed = static function (Db $db, string $file): array {
        if (!is_file($file)) return ['ok' => false, 'error' => 'no_seed_file', 'file' => $file];
        $rows = json_decode((string) file_get_contents($file), true);
        if (!is_array($rows)) return ['ok' => false, 'error' => 'bad_seed_file', 'file' => $file];
        $inserted = 0; $skipped = 0; $refused = [];
        foreach ($rows as $i => $row) {
            try {
                $p = vPlace(is_array($row) ? $row : []);
            } catch (Invalid $e) {
                $refused[] = ['index' => $i, 'slug' => is_array($row) ? ($row['slug'] ?? null) : null, 'field' => $e->field, 'why' => $e->getMessage()];
                continue;
            }
            $exists = $db->scalar('SELECT 1 FROM places WHERE slug = ?', [$p['slug']]);
            if ($exists !== null) { $skipped++; continue; }
            $c = placeColumns($p);
            $now = nowIso();
            $db->run('INSERT INTO places (id, slug, name, name_ar, category, area, area_ar, lat, lng, rating, price_level, emoji,
                        tagline_ar, description_ar, highlights_ar, best_time_ar, setting, season_ar, tags_ar, logo_url, bio_ar,
                        image_urls, phone, instagram, website, products_ar, menu_ar, accepts_orders, order_note_ar,
                        order_prep_minutes, order_whatsapp, salon_kind, takes_queue, queue_service_minutes, featured,
                        published, sort_order, created_at, updated_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [uuid4(), $c['slug'], $c['name'], $c['name_ar'], $c['category'], $c['area'], $c['area_ar'], $c['lat'], $c['lng'],
                 $c['rating'], $c['price_level'], $c['emoji'], $c['tagline_ar'], $c['description_ar'], $c['highlights_ar'],
                 $c['best_time_ar'], $c['setting'], $c['season_ar'], $c['tags_ar'], $c['logo_url'], $c['bio_ar'],
                 $c['image_urls'], $c['phone'], $c['instagram'], $c['website'], $c['products_ar'], $c['menu_ar'],
                 $c['accepts_orders'], $c['order_note_ar'], $c['order_prep_minutes'], $c['order_whatsapp'], $c['salon_kind'],
                 $c['takes_queue'], $c['queue_service_minutes'], $c['featured'], $c['published'], $c['sort_order'], $now, $now]);
            $inserted++;
        }
        return ['ok' => true, 'file' => $file, 'inserted' => $inserted, 'skipped' => $skipped, 'refused' => $refused,
                'total' => (int) $db->scalar('SELECT COUNT(*) FROM places')];
    };

    if ($mode === 'version') {
        $cfg = dbConfig($storage, $stage);
        $out([
            'ok'        => true,
            'running'   => $print(__FILE__),
            'from'      => __FILE__,
            'stage'     => $stage,
            'installed' => array_map(static fn($p) => ['path' => $p, 'fingerprint' => $print($p)], $targets),
            /* The runtime's own predicate (trim()), never is_file — the
               installer creates the file EMPTY on purpose, and «it exists» is
               true in exactly the state where every admin action is refused. */
            'adminSecret' => keyState($secretFile),
            'engine'    => $cfg['driver'] === 'mysql'
                ? ['driver' => 'mysql', 'dsn' => preg_replace('/password=[^;]*/i', 'password=…', $cfg['dsn'])]
                : ['driver' => 'sqlite', 'file' => $cfg['file'], 'exists' => is_file($cfg['file']),
                   'bytes' => is_file($cfg['file']) ? filesize($cfg['file']) : 0],
            'log'       => (static function () use ($storage): array {
                $f = "$storage/logs/" . LOG_NAME;
                return ['path' => $f, 'bytes' => is_file($f) ? filesize($f) : 0, 'rotated' => is_file("$f.1")];
            })(),
            'php'       => PHP_VERSION,
            'drivers'   => PDO::getAvailableDrivers(),
        ]);
    }

    if ($mode === 'migrate') {
        $db = $openDb($stage);
        $out(['ok' => true, 'stage' => $stage, 'engine' => $db->driver,
              'tables' => array_map(fn($t) => [$t => (int) $db->scalar("SELECT COUNT(*) FROM $t")],
                                    ['places', 'orders', 'queue_tickets', 'submissions'])]);
    }

    if ($mode === 'seed') {
        $file = $argv[2] ?? (docroot() . '/data/places.json');
        if ($file === 'production' || $file === 'staging') $file = docroot() . '/data/places.json';
        $db = $openDb($stage);
        $out(['stage' => $stage, 'engine' => $db->driver] + $seed($db, $file));
    }

    /* `selftest` — every statement this file runs, run once on the configured
       engine, inside rows named for the test and deleted at the end. This is
       the MySQL proof: the sandbox has no MySQL server, so the dialect subset
       above is a claim until this prints ok on the account's own database. */
    if ($mode === 'selftest') {
        $db = $openDb($stage);
        $tag = 'selftest-' . bin2hex(random_bytes(3));
        $report = ['ok' => false, 'stage' => $stage, 'engine' => $db->driver, 'tag' => $tag, 'steps' => []];
        $step = static function (string $name, callable $fn) use (&$report): void {
            $fn();
            $report['steps'][] = $name;
        };
        try {
            $now = nowIso();
            $placeId = uuid4();
            $step('insert place', fn() => $db->run('INSERT INTO places (id, slug, name, name_ar, category, area, area_ar, lat, lng, rating, price_level, emoji,
                        tagline_ar, description_ar, highlights_ar, best_time_ar, setting, season_ar, tags_ar, logo_url, bio_ar,
                        image_urls, phone, instagram, website, products_ar, menu_ar, accepts_orders, order_note_ar,
                        order_prep_minutes, order_whatsapp, salon_kind, takes_queue, queue_service_minutes, featured,
                        published, sort_order, created_at, updated_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [$placeId, $tag, 'Selftest', 'اختبار', 'coffee', 'Test', 'اختبار', 29.37, 47.97, 4.5, 2, '📍',
                 'tagline', 'description', '["a"]', 'best', 'mixed', '', '["x"]', null, '', '[]', '', '', '', '[]',
                 '[{"id":"m1","nameAr":"شاي","priceFils":250}]', 1, '', 15, '', 'men', 1, 20, 0, 1, 0, $now, $now]));
            $step('read place', function () use ($db, $tag) {
                $r = $db->one('SELECT * FROM places WHERE slug = ?', [$tag]);
                if ($r === null || placeOut($r)['menu_ar'][0]['nameAr'] !== 'شاي') throw new RuntimeException('place did not read back');
            });
            $orderId = uuid4();
            $step('insert order', fn() => $db->run('INSERT INTO orders (id, track_token, status, place_slug, place_name_ar, lines, total_fils, pickup_at,
                        customer_name, customer_phone, note_ar, admin_note, ready_at, collected_at, cancelled_at, created_at, updated_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [$orderId, str_repeat('t', 32), 'placed', $tag, 'اختبار', '[{"id":"m1","nameAr":"شاي","priceFils":250,"qty":2}]', 500, '18:30',
                 'سالم', '51234567', '', '', null, null, null, $now, $now]));
            $step('cancel order under lock', fn() => $db->tx('orders', function (Db $d) use ($orderId, $now) {
                $s = $d->scalar('SELECT status FROM orders WHERE id = ?', [$orderId]);
                if ($s !== 'placed') throw new RuntimeException("order status read $s");
                $d->run('UPDATE orders SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?', ['cancelled', $now, $now, $orderId]);
            }));
            $step('assign two queue numbers under lock', function () use ($db, $tag, $now) {
                $day = kuwaitDay();
                for ($i = 1; $i <= 2; $i++) {
                    $n = $db->tx('queue', function (Db $d) use ($tag, $day, $now, $i) {
                        $next = (int) $d->scalar('SELECT COALESCE(MAX(number), 0) + 1 FROM queue_tickets WHERE place_slug = ? AND day = ?', [$tag, $day]);
                        $d->run('INSERT INTO queue_tickets (id, track_token, place_slug, place_name_ar, day, number, status, source, customer_name,
                                   customer_phone, called_at, served_at, ended_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                            [uuid4(), str_repeat('q', 32), $tag, 'اختبار', $day, $next, 'waiting', 'online', "زبون $i", '', null, null, null, $now, $now]);
                        return $next;
                    });
                    if ($n !== $i) throw new RuntimeException("expected number $i, got $n");
                }
                $ahead = (int) $db->scalar('SELECT COUNT(*) FROM queue_tickets WHERE place_slug = ? AND day = ? AND status = ? AND number < ?', [$tag, $day, 'waiting', 2]);
                if ($ahead !== 1) throw new RuntimeException("ahead read $ahead");
            });
            $step('unique number refused', function () use ($db, $tag, $now) {
                try {
                    $db->run('INSERT INTO queue_tickets (id, track_token, place_slug, place_name_ar, day, number, status, source, customer_name,
                               customer_phone, called_at, served_at, ended_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        [uuid4(), str_repeat('q', 32), $tag, 'اختبار', kuwaitDay(), 1, 'waiting', 'online', 'dup', '', null, null, null, $now, $now]);
                    throw new RuntimeException('a duplicate number was accepted');
                } catch (PDOException $e) {
                    if (!str_starts_with((string) $e->getCode(), '23')) throw $e;
                }
            });
            $step('insert submission', fn() => $db->run('INSERT INTO submissions (id, status, name, name_ar, category, area_ar, address_ar, lat, lng, price_level,
                        tagline_ar, description_ar, phone, instagram, website, contact_name, contact_email, contact_phone, logo_path,
                        image_paths, bio_ar, products_ar, admin_note, reviewed_at, published_slug, created_at)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [uuid4(), 'pending', 'Selftest', $tag, 'coffee', 'اختبار', '', 29.37, 47.97, 2, 'tagline here', '', '', '', '',
                 'Owner', 'o@example.com', '', null, '[]', '', '[]', '', null, null, $now]));
            $step('read back counts', function () use ($db, $tag) {
                foreach (['orders' => 'place_slug', 'queue_tickets' => 'place_slug', 'submissions' => 'name_ar'] as $t => $col) {
                    $n = (int) $db->scalar("SELECT COUNT(*) FROM $t WHERE $col = ?", [$tag]);
                    if ($n < 1) throw new RuntimeException("$t has no selftest row");
                }
            });
            $report['ok'] = true;
        } catch (Throwable $e) {
            $report['error'] = get_class($e) . ': ' . $e->getMessage();
        } finally {
            foreach (['orders' => 'place_slug', 'queue_tickets' => 'place_slug', 'submissions' => 'name_ar', 'places' => 'slug'] as $t => $col) {
                try { $db->run("DELETE FROM $t WHERE $col = ?", [$tag]); } catch (Throwable) {}
            }
            $report['cleaned'] = true;
        }
        $report['counts'] = array_map(fn($t) => [$t => (int) $db->scalar("SELECT COUNT(*) FROM $t")],
                                      ['places', 'orders', 'queue_tickets', 'submissions']);
        $out($report);
    }

    if ($mode === 'log') {
        $file = "$storage/logs/" . LOG_NAME;
        $n    = max(1, min(500, (int) ($argv[2] ?? 40)));
        if (!is_file($file)) {
            $out(['ok' => true, 'file' => $file, 'lines' => 0, 'note' => 'nothing logged yet', 'rotated' => is_file("$file.1")]);
        }
        $all = @file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        $out(['ok' => true, 'file' => $file, 'bytes' => @filesize($file), 'rotated' => is_file("$file.1"),
              'lines' => count($all), 'showing' => min($n, count($all)), 'tail' => array_slice($all, -$n)]);
    }

    if ($mode === 'logformat') {
        $out([
            'name' => LOG_NAME, 'maxBytes' => LOG_MAX_BYTES, 'keep' => LOG_KEEP,
            'dir' => 'logs', 'perms' => '0600',
            'line' => '<iso8601Z> <app> <outcome> k=v…',
            'never' => ['request text', 'raw ip', 'file names', 'api key'],
            'ipField' => 'sha256(remote_addr) first 8 hex',
        ]);
    }

    if ($mode !== 'install') {
        $out(['ok' => false, 'error' => 'usage',
              'usage' => ['php wain.php install', 'php wain.php version', 'php wain.php migrate',
                          'php wain.php seed [places.json]', 'php wain.php selftest [production|staging]',
                          'php wain.php log [n]', 'php wain.php logformat']]);
    }

    /* install: copy to both stages, create the empty secret, migrate each
       stage's database, seed each from the export's data/places.json. */
    $report = [];
    foreach ($targets as $st => $path) {
        $dir = dirname($path);
        if (!is_dir($dir)) {
            $report[$st] = ['ok' => false, 'error' => 'no_api_dir', 'path' => $dir];
            continue;
        }
        $was = $print($path);
        if (!@copy(__FILE__, $path)) {
            $report[$st] = ['ok' => false, 'error' => 'copy_failed', 'path' => $path];
            continue;
        }
        @chmod($path, 0644);
        $entry = ['ok' => true, 'status' => $was === null ? 'installed' : 'replaced',
                  'path' => $path, 'was' => $was, 'fingerprint' => $print($path)];
        try {
            $db = $openDb($st);
            $entry['engine'] = $db->driver;
            $entry['seed'] = $seed($db, dirname($dir) . '/data/places.json');
        } catch (Throwable $e) {
            $entry['engine_error'] = $e->getMessage();
        }
        $report[$st] = $entry;
    }

    /* The secret is never written here — this file is fetched from a public
       URL to be run, so anything it carried would be public. Created empty,
       0600, and every admin action is refused until the owner fills it in. */
    $secretNote = keyState($secretFile);
    if (!is_file($secretFile)) {
        @mkdir(dirname($secretFile), 0700, true);
        @file_put_contents($secretFile, '');
        @chmod($secretFile, 0600);
        $secretNote = is_file($secretFile) ? 'created_empty' : 'could_not_create';
    }

    $out([
        'ok'     => true,
        'stages' => $report,
        'adminSecret' => ['path' => $secretFile, 'status' => $secretNote,
                          'note' => 'paste a long random secret into this file to open /admin; leave it empty to keep admin refused'],
        'db'     => ['config' => "$storage/db.json", 'present' => is_file("$storage/db.json"),
                     'note' => 'absent → SQLite in storage/; present → MySQL per stage, see the header comment'],
    ]);
}

/* ── serve ─────────────────────────────────────────────────────────────────*/

$t0 = microtime(true);
$ms = static fn(): int => (int) round((microtime(true) - $t0) * 1000);
$action = (string) ($_GET['a'] ?? '');

$send = static function (int $code, array $body) use ($ms, $action): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
};

$fail = static function (int $code, string $error, array $extra = []) use ($ms, $action, $send): never {
    logline((string) $code, ['a' => $action, 'why' => $error, 'ms' => $ms(), 'ip' => logIp()]);
    $send($code, ['ok' => false, 'error' => $error] + $extra);
};

$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');

$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '') {
    $host = parse_url($origin, PHP_URL_HOST);
    if (!is_string($host) || !in_array(strtolower($host), ALLOWED_HOSTS, true)) {
        $fail(403, 'origin_not_allowed');
    }
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type, X-Wain-Admin');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Max-Age: 600');
}
if ($method === 'OPTIONS') { http_response_code(204); exit; }

$storage = storageDir();
if ($storage === null) $fail(500, 'no_storage_dir');

$stage = stageFromPath();

/* ── the admin secret, read before anything else is decided ─────────────── */
$secret = trim((string) @file_get_contents("$storage/admin.secret"));
$givenAdmin = $_SERVER['HTTP_X_WAIN_ADMIN'] ?? null;
$isAdmin = false;
if (is_string($givenAdmin) && $givenAdmin !== '') {
    if ($secret === '') $fail(503, 'admin_unset');
    if (!hash_equals($secret, $givenAdmin)) {
        usleep(250000);   // a wrong guess costs a quarter second; a right one costs nothing
        $fail(403, 'admin_forbidden');
    }
    $isAdmin = true;
}

/* ── which action, which method ─────────────────────────────────────────── */
$known = array_values(array_unique(array_merge(READ_ACTIONS, PUBLIC_WRITES, ADMIN_ACTIONS)));
if (!in_array($action, $known, true)) $fail(400, 'unknown_action');
$isRead = in_array($action, READ_ACTIONS, true);
if ($method !== 'POST' && !($isRead && $method === 'GET')) {
    header('Allow: ' . ($isRead ? 'GET, POST' : 'POST'));
    $fail(405, 'method_not_allowed');
}

/* ── the body ───────────────────────────────────────────────────────────── */
$in = [];
if ($method === 'POST') {
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > MAX_BODY) $fail(413, 'body_too_large');
    $raw = (string) file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if (strlen($raw) > MAX_BODY) $fail(413, 'body_too_large');
    if (trim($raw) !== '') {
        $in = json_decode($raw, true);
        if (!is_array($in)) $fail(400, 'bad_json');
    }
} else {
    $in = $_GET;
    unset($in['a']);
}

/* ── rate limits — the admin, once authenticated, is exempt ─────────────── */
$count = static function (string $file, int $window): int {
    $now = time();
    $fh  = @fopen($file, 'c+');
    if (!$fh) return 0;
    @flock($fh, LOCK_EX);
    $data = json_decode((string) stream_get_contents($fh), true);
    $live = is_array($data) && ($data['start'] ?? 0) > $now - $window;
    $n = $live ? (int) ($data['n'] ?? 0) : 0;
    $start = $live ? (int) $data['start'] : $now;
    $n++;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode(['start' => $start, 'n' => $n]));
    @flock($fh, LOCK_UN);
    fclose($fh);
    return $n;
};
if (!$isAdmin) {
    $rateDir = "$storage/wain-rate";
    if (!is_dir($rateDir)) @mkdir($rateDir, 0700, true);
    $ipHash = hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? '0'));
    /* getenv() is a TEST SEAM, the shape WAIN_MEDIA_MAX_TOTAL_BYTES is on the
       other bridge: Apache never sets it, so production always sees the
       constants. A suite proving the cap trips should not need 120 requests. */
    $perMin   = (int) (getenv('WAIN_API_RATE_PER_MIN') ?: RATE_PER_MIN);
    $writes   = (int) (getenv('WAIN_API_WRITES_PER_MIN') ?: WRITES_PER_MIN);
    if ($count("$rateDir/all-$ipHash.json", 60) > $perMin) $fail(429, 'rate_limited');
    if (in_array($action, PUBLIC_WRITES, true) && $count("$rateDir/write-$ipHash.json", 60) > $writes) {
        $fail(429, 'rate_limited');
    }
}

/* ── admin gate ─────────────────────────────────────────────────────────── */
$needsAdmin = in_array($action, ADMIN_ACTIONS, true)
    || ($action === 'queue_join' && (($in['source'] ?? 'online') === 'walk_in'));
if ($needsAdmin && !$isAdmin) {
    if ($secret === '') $fail(503, 'admin_unset');
    $fail(403, 'admin_required');
}

/* ── the database, migrated on first touch ──────────────────────────────── */
try {
    $db = Db::open(dbConfig($storage, $stage));
    $db->migrate();
} catch (Throwable $e) {
    logline('500', ['a' => $action, 'why' => 'db_unavailable', 'driver' => dbConfig($storage, $stage)['driver'], 'ms' => $ms(), 'ip' => logIp()]);
    $send(500, ['ok' => false, 'error' => 'db_unavailable']);
}

$ok = static function (array $body, array $log = []) use ($send, $ms, $action): never {
    logline('ok', ['a' => $action] + $log + ['ms' => $ms(), 'ip' => logIp()]);
    $send(200, ['ok' => true] + $body);
};

/** The one place a pending path is turned into a file: the charset is
 *  media.php's own output shape and nothing else, so no «..», no slash
 *  beyond the one between draft and file, no extension media.php never
 *  wrote. */
$pendingFile = static function (string $path) use ($storage): ?string {
    if (!preg_match('/^([A-Za-z0-9-]{6,64})\/((?:logo|photo)-\d{1,2})\.(jpg|png|webp)$/', $path, $m)) return null;
    return "$storage/business-pending/$m[1]/$m[2].$m[3]";
};

$mediaSig = static fn(string $path, int $exp) => hash_hmac('sha256', "$path|$exp", $secret);

try {
    switch ($action) {

    /* ── public ──────────────────────────────────────────────────────────── */

    case 'ping':
        $ok(['service' => 'wain-api', 'stage' => $stage, 'engine' => $db->driver, 'time' => nowIso(),
             'admin' => $secret === '' ? 'unset' : 'set']);

    case 'places':
        $rows = $db->all('SELECT * FROM places WHERE published = 1 ORDER BY sort_order ASC, created_at ASC');
        $ok(['places' => array_map('placeOut', $rows)]);

    case 'order_place': {
        $id    = vUuid($in, 'id');
        $token = vToken($in);
        $slug  = vRe($in, 'place_slug', RE_SLUG, 'a slug');
        $row = [
            'place_name_ar'  => vStr($in, 'place_name_ar', 2, 120),
            'lines'          => vOrderLines($in),
            'total_fils'     => vInt($in, 'total_fils', 0, 50000),
            'pickup_at'      => vRe($in, 'pickup_at', RE_PICKUP, 'HH:MM'),
            'customer_name'  => vStr($in, 'customer_name', 2, 80),
            'customer_phone' => vRe($in, 'customer_phone', RE_PHONE, 'eight Kuwaiti digits'),
            'note_ar'        => vStr($in, 'note_ar', 0, 200),
        ];
        $result = $db->tx('orders', function (Db $d) use ($id, $token, $slug, $row) {
            /* The same id again with the same token is the retry the client
               makes after a timeout — the order exists, so the answer is yes.
               The same id with a different token is somebody else's guess. */
            $have = $d->one('SELECT track_token FROM orders WHERE id = ?', [$id]);
            if ($have !== null) return hash_equals((string) $have['track_token'], $token) ? 'again' : 'duplicate';
            $place = $d->one('SELECT published, accepts_orders FROM places WHERE slug = ?', [$slug]);
            if ($place === null || (int) $place['published'] !== 1 || (int) $place['accepts_orders'] !== 1) return 'closed';
            $now = nowIso();
            $d->run('INSERT INTO orders (id, track_token, status, place_slug, place_name_ar, lines, total_fils, pickup_at,
                        customer_name, customer_phone, note_ar, admin_note, ready_at, collected_at, cancelled_at, created_at, updated_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [$id, $token, 'placed', $slug, $row['place_name_ar'], jsonCol($row['lines']), $row['total_fils'], $row['pickup_at'],
                 $row['customer_name'], $row['customer_phone'], $row['note_ar'], '', null, null, null, $now, $now]);
            return 'placed';
        });
        if ($result === 'closed') $fail(409, 'closed');
        if ($result === 'duplicate') $fail(409, 'duplicate');
        $ok(['id' => $id, 'status' => 'placed', 'again' => $result === 'again'], ['id' => substr($id, 0, 8)]);
    }

    case 'order_status': {
        $id = vUuid($in, 'id'); $token = vToken($in, 'token');
        $r = $db->one('SELECT status, place_slug, place_name_ar, lines, total_fils, pickup_at, note_ar, created_at, ready_at,
                              collected_at, cancelled_at, track_token FROM orders WHERE id = ?', [$id]);
        /* No row or the wrong token: the same answer, or this is a way to ask
           «does this id exist?» one guess at a time. */
        if ($r === null || !hash_equals((string) $r['track_token'], $token)) $ok(['order' => null]);
        $ok(['order' => orderOut($r)]);
    }

    case 'order_cancel': {
        $id = vUuid($in, 'id'); $token = vToken($in, 'token');
        $status = $db->tx('orders', function (Db $d) use ($id, $token) {
            $r = $d->one('SELECT status, track_token FROM orders WHERE id = ?', [$id]);
            if ($r === null || !hash_equals((string) $r['track_token'], $token)) return null;
            if ($r['status'] === 'cancelled') return 'cancelled';
            if ($r['status'] !== 'placed') return $r['status'];   // ready/collected: too late, say which
            $now = nowIso();
            $d->run('UPDATE orders SET status = ?, cancelled_at = ?, updated_at = ? WHERE id = ?', ['cancelled', $now, $now, $id]);
            return 'cancelled';
        });
        $ok(['status' => $status], ['id' => substr($id, 0, 8)]);
    }

    case 'queue_join': {
        $id    = vUuid($in, 'id');
        $token = vToken($in);
        $slug  = vRe($in, 'place_slug', RE_SLUG, 'a slug');
        $nameAr = vStr($in, 'place_name_ar', 2, 120);
        $customer = vStr($in, 'customer_name', 2, 80);
        $phone  = vRe($in, 'customer_phone', RE_PHONE, 'eight Kuwaiti digits or empty', true);
        $source = vEnum($in, 'source', ['online', 'walk_in'], 'online');
        $day = kuwaitDay();
        $result = $db->tx('queue', function (Db $d) use ($id, $token, $slug, $nameAr, $customer, $phone, $source, $day) {
            $place = $d->one('SELECT published, takes_queue FROM places WHERE slug = ?', [$slug]);
            if ($place === null || (int) $place['published'] !== 1 || (int) $place['takes_queue'] !== 1) return ['closed'];
            if ($d->scalar('SELECT 1 FROM queue_tickets WHERE id = ?', [$id]) !== null) return ['duplicate'];
            /* One live ticket per phone per salon per day — schema.sql's
               partial unique index, which MySQL has no syntax for, so it is
               a query under the same lock on both engines. */
            if ($phone !== '') {
                $live = $d->scalar('SELECT 1 FROM queue_tickets WHERE place_slug = ? AND day = ? AND customer_phone = ? AND status IN (?, ?)',
                                   [$slug, $day, $phone, 'waiting', 'called']);
                if ($live !== null) return ['duplicate'];
            }
            $next = (int) $d->scalar('SELECT COALESCE(MAX(number), 0) + 1 FROM queue_tickets WHERE place_slug = ? AND day = ?', [$slug, $day]);
            if ($next > 9999) return ['closed'];
            $now = nowIso();
            $d->run('INSERT INTO queue_tickets (id, track_token, place_slug, place_name_ar, day, number, status, source, customer_name,
                        customer_phone, called_at, served_at, ended_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [$id, $token, $slug, $nameAr, $day, $next, 'waiting', $source, $customer, $phone, null, null, null, $now, $now]);
            return ['joined', $next];
        });
        if ($result[0] === 'closed') $fail(409, 'closed');
        if ($result[0] === 'duplicate') $fail(409, 'duplicate');
        $ok(['id' => $id, 'number' => $result[1], 'day' => $day], ['id' => substr($id, 0, 8), 'n' => $result[1]]);
    }

    case 'queue_status': {
        $id = vUuid($in, 'id'); $token = vToken($in, 'token');
        $t = $db->one('SELECT * FROM queue_tickets WHERE id = ?', [$id]);
        if ($t === null || !hash_equals((string) $t['track_token'], $token)) $ok(['ticket' => null]);
        $ahead = (int) $db->scalar('SELECT COUNT(*) FROM queue_tickets WHERE place_slug = ? AND day = ? AND status = ? AND number < ?',
                                   [$t['place_slug'], $t['day'], 'waiting', (int) $t['number']]);
        $serving = $db->scalar('SELECT MAX(number) FROM queue_tickets WHERE place_slug = ? AND day = ? AND status IN (?, ?)',
                               [$t['place_slug'], $t['day'], 'called', 'served']);
        $minutes = $db->scalar('SELECT queue_service_minutes FROM places WHERE slug = ?', [$t['place_slug']]);
        $ok(['ticket' => [
            'status' => $t['status'], 'number' => (int) $t['number'], 'ahead' => $ahead,
            'now_serving' => $serving === null ? null : (int) $serving,
            'place_slug' => $t['place_slug'], 'place_name_ar' => $t['place_name_ar'],
            'service_minutes' => $minutes === null ? 20 : (int) $minutes,
            'day' => $t['day'], 'created_at' => $t['created_at'], 'called_at' => $t['called_at'],
            'served_at' => $t['served_at'], 'ended_at' => $t['ended_at'],
        ]]);
    }

    case 'queue_leave': {
        $id = vUuid($in, 'id'); $token = vToken($in, 'token');
        $status = $db->tx('queue', function (Db $d) use ($id, $token) {
            $r = $d->one('SELECT status, track_token FROM queue_tickets WHERE id = ?', [$id]);
            if ($r === null || !hash_equals((string) $r['track_token'], $token)) return null;
            if ($r['status'] === 'left') return 'left';
            if (!in_array($r['status'], ['waiting', 'called'], true)) return $r['status'];
            $now = nowIso();
            $d->run('UPDATE queue_tickets SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?', ['left', $now, $now, $id]);
            return 'left';
        });
        $ok(['status' => $status], ['id' => substr($id, 0, 8)]);
    }

    case 'queue_size': {
        $slug = vRe($in, 'place_slug', RE_SLUG, 'a slug');
        $day = kuwaitDay();
        $waiting = (int) $db->scalar('SELECT COUNT(*) FROM queue_tickets WHERE place_slug = ? AND day = ? AND status = ?', [$slug, $day, 'waiting']);
        $serving = $db->scalar('SELECT MAX(number) FROM queue_tickets WHERE place_slug = ? AND day = ? AND status IN (?, ?)', [$slug, $day, 'called', 'served']);
        $minutes = $db->scalar('SELECT queue_service_minutes FROM places WHERE slug = ? AND published = 1', [$slug]);
        $ok(['waiting' => $waiting, 'now_serving' => $serving === null ? null : (int) $serving,
             'service_minutes' => $minutes === null ? 20 : (int) $minutes]);
    }

    case 'submit': {
        $s = [
            'name'           => vStr($in, 'name', 2, 120),
            'name_ar'        => vStr($in, 'name_ar', 2, 120),
            'category'       => vEnum($in, 'category', CATEGORIES),
            'area_ar'        => vStr($in, 'area_ar', 2, 80),
            'address_ar'     => vStr($in, 'address_ar', 0, 300),
            'lat'            => vNum($in, 'lat', 28.5, 30.2, true),
            'lng'            => vNum($in, 'lng', 46.5, 48.6, true),
            'price_level'    => vInt($in, 'price_level', 1, 3, 2),
            'tagline_ar'     => vStr($in, 'tagline_ar', 4, 160),
            'description_ar' => vStr($in, 'description_ar', 0, 1200),
            'phone'          => vStr($in, 'phone', 0, 40),
            'instagram'      => vStr($in, 'instagram', 0, 80),
            'website'        => ($w = vStr($in, 'website', 0, 200)) === '' ? '' : vRe($in, 'website', RE_WEBSITE, 'an http(s) URL'),
            'contact_name'   => vStr($in, 'contact_name', 2, 120),
            'contact_email'  => vRe($in, 'contact_email', RE_EMAIL, 'an email address'),
            'contact_phone'  => vStr($in, 'contact_phone', 0, 40),
            'logo_path'      => ($in['logo_path'] ?? null) === null ? null : vStr($in, 'logo_path', 1, 200),
            'image_paths'    => vStrList($in, 'image_paths', 12, 200),
            'bio_ar'         => vStr($in, 'bio_ar', 0, 800),
            'products_ar'    => vStrList($in, 'products_ar', 20),
        ];
        foreach (array_filter(array_merge([$s['logo_path']], $s['image_paths'])) as $p) {
            if ($pendingFile($p) === null) throw new Invalid('image_paths', 'a media path is not one /api/media.php writes');
        }
        $id = uuid4();
        $result = $db->tx('submissions', function (Db $d) use ($id, $s) {
            /* The same business twice while the first is still pending is a
               double tap, not a second business (schema.sql's partial unique
               index, as a query under the lock). */
            $dup = $d->scalar('SELECT 1 FROM submissions WHERE status = ? AND LOWER(name_ar) = LOWER(?) AND LOWER(area_ar) = LOWER(?)',
                              ['pending', $s['name_ar'], $s['area_ar']]);
            if ($dup !== null) return 'duplicate';
            $d->run('INSERT INTO submissions (id, status, name, name_ar, category, area_ar, address_ar, lat, lng, price_level,
                        tagline_ar, description_ar, phone, instagram, website, contact_name, contact_email, contact_phone, logo_path,
                        image_paths, bio_ar, products_ar, admin_note, reviewed_at, published_slug, created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [$id, 'pending', $s['name'], $s['name_ar'], $s['category'], $s['area_ar'], $s['address_ar'], $s['lat'], $s['lng'],
                 $s['price_level'], $s['tagline_ar'], $s['description_ar'], $s['phone'], $s['instagram'], $s['website'],
                 $s['contact_name'], $s['contact_email'], $s['contact_phone'], $s['logo_path'], jsonCol($s['image_paths']),
                 $s['bio_ar'], jsonCol($s['products_ar']), '', null, null, nowIso()]);
            return 'submitted';
        });
        if ($result === 'duplicate') $fail(409, 'duplicate');
        $ok(['id' => $id, 'status' => 'pending'], ['id' => substr($id, 0, 8)]);
    }

    /* ── admin ───────────────────────────────────────────────────────────── */

    case 'whoami':
        $ok(['admin' => true, 'stage' => $stage, 'engine' => $db->driver]);

    case 'places_all':
        $ok(['places' => array_map('placeOut', $db->all('SELECT * FROM places ORDER BY sort_order ASC, created_at ASC'))]);

    case 'place_save': {
        $place = vPlace(is_array($in['place'] ?? null) ? $in['place'] : $in);
        $id = isset($in['id']) && $in['id'] !== null && $in['id'] !== '' ? vUuid($in, 'id') : null;
        $saved = $db->tx('places', function (Db $d) use ($id, $place) {
            $taken = $d->one('SELECT id FROM places WHERE slug = ?', [$place['slug']]);
            if ($taken !== null && $taken['id'] !== $id) return 'duplicate';
            $c = placeColumns($place);
            $now = nowIso();
            if ($id === null) {
                $newId = uuid4();
                $d->run('INSERT INTO places (id, slug, name, name_ar, category, area, area_ar, lat, lng, rating, price_level, emoji,
                            tagline_ar, description_ar, highlights_ar, best_time_ar, setting, season_ar, tags_ar, logo_url, bio_ar,
                            image_urls, phone, instagram, website, products_ar, menu_ar, accepts_orders, order_note_ar,
                            order_prep_minutes, order_whatsapp, salon_kind, takes_queue, queue_service_minutes, featured,
                            published, sort_order, created_at, updated_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    [$newId, $c['slug'], $c['name'], $c['name_ar'], $c['category'], $c['area'], $c['area_ar'], $c['lat'], $c['lng'],
                     $c['rating'], $c['price_level'], $c['emoji'], $c['tagline_ar'], $c['description_ar'], $c['highlights_ar'],
                     $c['best_time_ar'], $c['setting'], $c['season_ar'], $c['tags_ar'], $c['logo_url'], $c['bio_ar'],
                     $c['image_urls'], $c['phone'], $c['instagram'], $c['website'], $c['products_ar'], $c['menu_ar'],
                     $c['accepts_orders'], $c['order_note_ar'], $c['order_prep_minutes'], $c['order_whatsapp'], $c['salon_kind'],
                     $c['takes_queue'], $c['queue_service_minutes'], $c['featured'], $c['published'], $c['sort_order'], $now, $now]);
                return $newId;
            }
            if ($d->scalar('SELECT 1 FROM places WHERE id = ?', [$id]) === null) return 'missing';
            $sets = []; $vals = [];
            foreach ($c as $k => $v) { $sets[] = "$k = ?"; $vals[] = $v; }
            $vals[] = $now; $vals[] = $id;
            $d->run('UPDATE places SET ' . implode(', ', $sets) . ', updated_at = ? WHERE id = ?', $vals);
            return $id;
        });
        if ($saved === 'duplicate') $fail(409, 'duplicate', ['field' => 'slug']);
        if ($saved === 'missing') $fail(404, 'not_found');
        $row = $db->one('SELECT * FROM places WHERE id = ?', [$saved]);
        $ok(['place' => placeOut($row)], ['id' => substr($saved, 0, 8)]);
    }

    case 'place_delete': {
        $id = vUuid($in, 'id');
        $n = $db->run('DELETE FROM places WHERE id = ?', [$id])->rowCount();
        if ($n === 0) $fail(404, 'not_found');
        $ok(['deleted' => $id], ['id' => substr($id, 0, 8)]);
    }

    case 'place_publish': {
        $id = vUuid($in, 'id'); $pub = vBool($in, 'published');
        $n = $db->run('UPDATE places SET published = ?, updated_at = ? WHERE id = ?', [$pub, nowIso(), $id])->rowCount();
        if ($n === 0 && $db->scalar('SELECT 1 FROM places WHERE id = ?', [$id]) === null) $fail(404, 'not_found');
        $ok(['id' => $id, 'published' => $pub], ['id' => substr($id, 0, 8)]);
    }

    case 'place_location': {
        $id = vUuid($in, 'id'); $lat = vNum($in, 'lat', -90, 90); $lng = vNum($in, 'lng', -180, 180);
        $n = $db->run('UPDATE places SET lat = ?, lng = ?, updated_at = ? WHERE id = ?', [$lat, $lng, nowIso(), $id])->rowCount();
        if ($n === 0 && $db->scalar('SELECT 1 FROM places WHERE id = ?', [$id]) === null) $fail(404, 'not_found');
        $ok(['id' => $id, 'lat' => $lat, 'lng' => $lng], ['id' => substr($id, 0, 8)]);
    }

    case 'orders_list': {
        $limit = vInt($in, 'limit', 1, 500, 200);
        /* Named columns: track_token is the customer's key to their own order
           and the board has no use for it, so it never leaves the database. */
        $rows = $db->all('SELECT id, status, place_slug, place_name_ar, lines, total_fils, pickup_at, customer_name, customer_phone,
                                 note_ar, admin_note, created_at, ready_at, collected_at, cancelled_at
                          FROM orders ORDER BY created_at DESC LIMIT ' . $limit);
        $ok(['orders' => array_map('orderOut', $rows)]);
    }

    case 'order_set_status': {
        $id = vUuid($in, 'id');
        $status = vEnum($in, 'status', ['placed', 'ready', 'collected', 'cancelled']);
        $done = $db->tx('orders', function (Db $d) use ($id, $status) {
            $r = $d->one('SELECT status FROM orders WHERE id = ?', [$id]);
            if ($r === null) return false;
            $now = nowIso();
            $stamp = ['ready' => 'ready_at', 'collected' => 'collected_at', 'cancelled' => 'cancelled_at'][$status] ?? null;
            if ($r['status'] !== $status && $stamp !== null) {
                $d->run("UPDATE orders SET status = ?, $stamp = ?, updated_at = ? WHERE id = ?", [$status, $now, $now, $id]);
            } else {
                $d->run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [$status, $now, $id]);
            }
            return true;
        });
        if (!$done) $fail(404, 'not_found');
        $ok(['id' => $id, 'status' => $status], ['id' => substr($id, 0, 8)]);
    }

    case 'queue_list': {
        $day = isset($in['day']) && $in['day'] !== '' ? vRe($in, 'day', '/^\d{4}-\d{2}-\d{2}$/', 'YYYY-MM-DD') : kuwaitDay();
        $rows = $db->all('SELECT id, number, status, source, place_slug, place_name_ar, customer_name, customer_phone, day,
                                 created_at, called_at, served_at, ended_at
                          FROM queue_tickets WHERE day = ? ORDER BY place_slug ASC, number ASC', [$day]);
        $ok(['day' => $day, 'tickets' => array_map('ticketOut', $rows)]);
    }

    case 'queue_set_status': {
        $id = vUuid($in, 'id');
        $status = vEnum($in, 'status', ['waiting', 'called', 'served', 'no_show', 'left']);
        $done = $db->tx('queue', function (Db $d) use ($id, $status) {
            $r = $d->one('SELECT status FROM queue_tickets WHERE id = ?', [$id]);
            if ($r === null) return false;
            $now = nowIso();
            $sets = ['status = ?', 'updated_at = ?']; $vals = [$status, $now];
            if ($r['status'] !== $status) {
                if ($status === 'called') { $sets[] = 'called_at = ?'; $vals[] = $now; }
                if ($status === 'served') { $sets[] = 'served_at = ?'; $vals[] = $now; }
                if (in_array($status, ['served', 'no_show', 'left'], true)) { $sets[] = 'ended_at = ?'; $vals[] = $now; }
            }
            $vals[] = $id;
            $d->run('UPDATE queue_tickets SET ' . implode(', ', $sets) . ' WHERE id = ?', $vals);
            return true;
        });
        if (!$done) $fail(404, 'not_found');
        $ok(['id' => $id, 'status' => $status], ['id' => substr($id, 0, 8)]);
    }

    case 'submissions_list': {
        $filter = vEnum($in, 'status', ['pending', 'all'], 'pending');
        $rows = $filter === 'pending'
            ? $db->all('SELECT * FROM submissions WHERE status = ? ORDER BY created_at DESC', ['pending'])
            : $db->all('SELECT * FROM submissions ORDER BY created_at DESC LIMIT 500');
        $pending = (int) $db->scalar('SELECT COUNT(*) FROM submissions WHERE status = ?', ['pending']);
        $ok(['submissions' => array_map('submissionOut', $rows), 'pending' => $pending]);
    }

    case 'submission_reject': {
        $id = vUuid($in, 'id'); $note = vStr($in, 'admin_note', 0, 1000);
        $n = $db->run('UPDATE submissions SET status = ?, admin_note = ?, reviewed_at = ? WHERE id = ?', ['rejected', $note, nowIso(), $id])->rowCount();
        if ($n === 0 && $db->scalar('SELECT 1 FROM submissions WHERE id = ?', [$id]) === null) $fail(404, 'not_found');
        $ok(['id' => $id, 'status' => 'rejected'], ['id' => substr($id, 0, 8)]);
    }

    case 'submission_approve': {
        $id = vUuid($in, 'id'); $slug = vRe($in, 'published_slug', RE_SLUG, 'a slug');
        $n = $db->run('UPDATE submissions SET status = ?, published_slug = ?, reviewed_at = ? WHERE id = ?', ['approved', $slug, nowIso(), $id])->rowCount();
        if ($n === 0 && $db->scalar('SELECT 1 FROM submissions WHERE id = ?', [$id]) === null) $fail(404, 'not_found');
        $ok(['id' => $id, 'status' => 'approved', 'published_slug' => $slug], ['id' => substr($id, 0, 8)]);
    }

    /* ── media: pending photos, signed reads, publishing ─────────────────── */

    case 'media_sign': {
        $path = vStr($in, 'path', 1, 200);
        $file = $pendingFile($path);
        if ($file === null) throw new Invalid('path', 'not a pending media path');
        if (!is_file($file)) $fail(404, 'not_found');
        $exp = time() + MEDIA_URL_SECONDS;
        $url = '/api/wain.php?a=media_get&p=' . rawurlencode($path) . '&exp=' . $exp . '&sig=' . $mediaSig($path, $exp);
        $ok(['url' => $url, 'exp' => $exp]);
    }

    case 'media_get': {
        /* Public by URL, authorised by the signature. The secret never leaves
           the server; a URL is good for ten minutes and for one file. */
        $path = (string) ($in['p'] ?? '');
        $exp  = (int) ($in['exp'] ?? 0);
        $sig  = (string) ($in['sig'] ?? '');
        $file = $pendingFile($path);
        if ($file === null) $fail(400, 'bad_path');
        if ($secret === '') $fail(503, 'admin_unset');
        if ($exp < time()) $fail(403, 'expired');
        if (!hash_equals($mediaSig($path, $exp), $sig)) $fail(403, 'bad_signature');
        if (!is_file($file)) $fail(404, 'not_found');
        $mime = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'][pathinfo($file, PATHINFO_EXTENSION)];
        logline('ok', ['a' => $action, 'ms' => $ms(), 'ip' => logIp()]);
        header("Content-Type: $mime");
        header('Content-Length: ' . (string) filesize($file));
        header('Cache-Control: private, no-store');
        readfile($file);
        exit;
    }

    case 'media_publish': {
        /* Approving copies the bytes into the docroot under images/business/,
           which deploy.php protects from its prune — the one place under
           public_html a deploy will never empty. The name is the admin's
           (`logo`, `photo-1`…) and the extension is the pending file's, which
           getimagesize() decided at upload. */
        $path = vStr($in, 'path', 1, 200);
        $slug = vRe($in, 'slug', RE_SLUG, 'a slug');
        $name = vRe($in, 'name', '/^[a-z0-9-]{1,40}$/', 'a short lowercase name');
        $src = $pendingFile($path);
        if ($src === null) throw new Invalid('path', 'not a pending media path');
        if (!is_file($src)) $fail(404, 'not_found');
        $ext = pathinfo($src, PATHINFO_EXTENSION);
        $dir = docroot() . "/images/business/$slug";
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) $fail(500, 'write_failed');
        $target = "$dir/$name.$ext";
        if (!@copy($src, "$target.part") || !@rename("$target.part", $target)) { @unlink("$target.part"); $fail(500, 'write_failed'); }
        @chmod($target, 0644);
        $ok(['url' => "/images/business/$slug/$name.$ext", 'bytes' => filesize($target)], ['slug' => $slug]);
    }

    case 'media_discard': {
        $paths = vStrList($in, 'paths', 24, 200);
        $removed = 0;
        foreach ($paths as $p) {
            $file = $pendingFile($p);
            if ($file === null) throw new Invalid('paths', 'not a pending media path');
            if (is_file($file) && @unlink($file)) $removed++;
            @rmdir(dirname($file));   // only succeeds once the draft's directory is empty
        }
        $ok(['removed' => $removed]);
    }

    default:
        $fail(400, 'unknown_action');
    }
} catch (Invalid $e) {
    $fail(422, 'invalid', ['field' => $e->field, 'message' => $e->getMessage()]);
} catch (PDOException $e) {
    /* The unique indexes are the backstop behind the checks made under the
       lock; reaching one means two writers raced past the same check, and
       the answer is the same word the check would have given. */
    if (str_starts_with((string) $e->getCode(), '23')) $fail(409, 'duplicate');
    logline('500', ['a' => $action, 'why' => 'db_error', 'ms' => $ms(), 'ip' => logIp()]);
    $send(500, ['ok' => false, 'error' => 'db_error']);
}
