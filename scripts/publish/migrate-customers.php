<?php
/**
 * Create the customer-accounts tables on the LIVE database.
 *
 *   wget -qO c.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/migrate-customers.php && php c.php
 *
 * THIS MUST RUN BEFORE api/api.php IS PUBLISHED, and that ordering is not a
 * preference. The new checkout writes `orders.customer_id`. Publish the code
 * against a table that has no such column and the INSERT fails — which is not
 * a degraded feature, it is EVERY CHECKOUT FAILING, on a shop that takes money.
 * The column is nullable and unused by the old code, so running this first is
 * invisible until the code arrives; running it second is an outage.
 *
 * IDEMPOTENT, and it reports STATE rather than its own verb. `create table if
 * not exists` and `add column if not exists` do nothing on a second run — and
 * the output names what IS THERE afterwards rather than what this run did,
 * because a per-minute cron job's captured output is the LAST run's, and "I
 * created it" read one minute later is indistinguishable from a path that was
 * always wrong. `customers=yes orders.customer_id=yes` reads the same on every
 * run, which is the point.
 *
 * IT ADDS AND NEVER DROPS. No DROP, no ALTER of an existing column, no data
 * touched. The worst a repeat run can do is nothing.
 */

header('Content-Type: text/plain; charset=utf-8');
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }

$cfgPath = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
if (!is_file($cfgPath)) { line('config.php not found — nothing done'); exit; }
$c = require $cfgPath;
if (!is_array($c)) { line('config.php did not return an array — nothing done'); exit; }

try {
    $db = new PDO(
        'mysql:host=' . ($c['db_host'] ?? 'localhost') . ';dbname=' . ($c['db_name'] ?? '') . ';charset=utf8mb4',
        (string) ($c['db_user'] ?? ''), (string) ($c['db_pass'] ?? ''),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (Throwable $e) {
    line('database unreachable: ' . $e->getMessage());
    exit;
}

// The statements, exactly as api/customers.mysql.sql carries them. Repeated
// here rather than fetched, because this file is the thing being run and a
// migration that depends on a second fetch has two ways to half-happen.
$steps = [
    'customers table' => "create table if not exists customers (
        id            int unsigned auto_increment primary key,
        email         varchar(190) not null unique,
        phone         varchar(20)  null,
        name          varchar(120) null,
        password_hash varchar(255) not null,
        verified_at   timestamp    null default null,
        created_at    timestamp    not null default current_timestamp,
        last_seen_at  timestamp    null default null
      ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci",
    'orders.customer_id' => 'alter table orders add column if not exists customer_id int unsigned null',
    'orders index'       => 'alter table orders add index if not exists orders_customer_idx (customer_id)',
];

foreach ($steps as $what => $sql) {
    try {
        $db->exec($sql);
        line('ran: ' . $what);
    } catch (Throwable $e) {
        // Named, not swallowed. A migration that fails quietly is a checkout
        // that fails loudly an hour later.
        line('FAILED: ' . $what . ' — ' . $e->getMessage());
    }
}

// ---- and now the STATE, which is what to read ---------------------------
$has = static function (PDO $db, string $sql): string {
    try { return $db->query($sql)->fetchColumn() !== false ? 'yes' : 'no'; }
    catch (Throwable $e) { return 'no'; }
};

$customers = $has($db, "show tables like 'customers'");
$column    = $has($db, "show columns from orders like 'customer_id'");
$rows = '0';
try { $rows = (string) $db->query('select count(*) from customers')->fetchColumn(); }
catch (Throwable $e) { $rows = '?'; }

line('');
line("STATE customers=$customers orders.customer_id=$column accounts=$rows");
line($customers === 'yes' && $column === 'yes'
    ? 'READY — api/api.php may be published now.'
    : 'NOT READY — do NOT publish api/api.php; the checkout would fail on every order.');
