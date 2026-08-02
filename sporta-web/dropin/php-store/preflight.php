<?php
// One page that answers "is this install actually correct?" — then DELETE IT.
//
// WHY IT EXISTS
// scan-server-response.sh checks the site from OUTSIDE: headers, redirects,
// what must not be reachable. Nothing checked it from inside, and every
// go-live problem so far has been an inside one:
//
//   * api/config.php had the wrong db_pass, so the admin reported a correct
//     password as wrong and the account locked itself.
//   * public_html/assets was uploaded incompletely, so every page was an
//     orange bar and a logo and nothing else.
//   * knet/config.php was missing its mysql_* block, so every card payment was
//     refused with "Invalid amount".
//
// Each took a round trip to diagnose. Each is one line on this page.
//
// WHAT IT WILL NOT DO
// It reads. It writes nothing, changes nothing, and prints no secret — only
// "set", "missing" or "looks wrong". It cannot be used to configure anything;
// setup-config.php and setup-admin.php do that, and they have their own locks.
//
// HOW IT IS GATED, and why that is enough
// Two states, because the page has to work in both:
//
//   Before api/config.php exists there is nothing to protect. The only facts
//   available are the PHP version and which shipped files arrived — which
//   anyone can already infer from a shop that will not load. It answers openly,
//   because demanding a key from a file that does not exist yet is a lock with
//   no door.
//
//   Once api/config.php exists it holds the cron_key, and from then on the page
//   demands it before saying anything about the database, the payment configs
//   or the admin account. Same key setup-admin.php uses, same reasoning:
//   whoever has it can already read the server's configuration.
declare(strict_types=1);

$root = dirname(__DIR__);              // public_html, when installed
$here = __DIR__;                       // public_html/api
$rows = [];
$worst = 'ok';

/** @param string $state ok|warn|bad */
function check(string $state, string $what, string $detail = '', string $fix = ''): void {
    global $rows, $worst;
    $rows[] = compact('state', 'what', 'detail', 'fix');
    if ($state === 'bad' || ($state === 'warn' && $worst === 'ok')) $worst = $state;
}

// ---------------------------------------------------------------- the runtime
check(
    version_compare(PHP_VERSION, '8.0', '>=') ? 'ok' : 'bad',
    'PHP version', PHP_VERSION,
    'hPanel → Advanced → PHP Configuration → PHP version. This site needs 8.0 or newer.'
);
foreach (['pdo_mysql' => 'the database', 'openssl' => 'the KNET AES encryption',
          'mbstring' => 'Arabic text', 'json' => 'every API response'] as $ext => $why) {
    check(extension_loaded($ext) ? 'ok' : 'bad', "PHP extension: $ext", $why,
          'hPanel → Advanced → PHP Configuration → PHP extensions. Tick it and save.');
}

// ------------------------------------------------------- did the upload land
//
// THE "ORANGE BAR AND A LOGO" CHECK, and the reason this file is worth having.
// index.html names its JavaScript by content hash. If those files did not all
// arrive, the browser gets the HTML, renders the no-JS shell, and stops — a
// page that looks like an empty shop rather than a broken upload. Here the
// question is answerable in one line: does every file index.html asks for
// exist on this disk?
$index = $root . '/index.html';
if (!is_file($index)) {
    check('bad', 'index.html', 'missing',
          'The upload did not land. Extract SPORTA-GO-LIVE.zip so its public_html/ CONTENTS are in your public_html.');
} else {
    $html = (string) file_get_contents($index);
    preg_match_all('~(?:src|href)="(/assets/[^"]+)"~', $html, $m);
    $missing = [];
    foreach (array_unique($m[1] ?? []) as $rel) {
        if (!is_file($root . $rel)) $missing[] = $rel;
    }
    check($missing ? 'bad' : 'ok', 'index.html and its assets agree',
          $missing ? count($missing) . ' file(s) missing, e.g. ' . $missing[0]
                   : count(array_unique($m[1] ?? [])) . ' referenced, all present',
          'Delete public_html/assets entirely and re-extract the zip. A half-uploaded assets folder is what shows a top bar and a logo and nothing else.');
}

// .htaccess is the single most-missed file, because File Manager hides it.
foreach (['/.htaccess' => 'HTTPS, security headers, and deep routes like /shop',
          '/api/.htaccess' => 'keeps config.php and the .sql files unreadable',
          '/knet/.htaccess' => 'keeps the Tranportal credentials unreadable',
          '/pay/.htaccess' => 'keeps the CBK credentials unreadable'] as $p => $why) {
    check(is_file($root . $p) ? 'ok' : 'bad', $p, $why,
          'Turn on "Show hidden files" in File Manager and re-extract. Without these the site 404s on /shop and your credentials are downloadable.');
}
check(is_dir($root . '/hero') ? 'ok' : 'warn', '/hero', is_dir($root . '/hero') ? 'present' : 'missing',
      'Without it the home page falls back to drawn illustrations instead of the photographs.');

// ------------------------------------------------------------- the gate
$cfgPath = $here . '/config.php';
$configured = is_file($cfgPath);
$cfg = $configured ? (array) (require $cfgPath) : [];
$key = (string) ($_POST['key'] ?? '');
$unlocked = !$configured
    || (($cfg['cron_key'] ?? '') !== '' && hash_equals((string) $cfg['cron_key'], $key));

if (!$configured) {
    check('bad', 'api/config.php', 'missing',
          'Copy api/config.example.php to api/config.php, fill in db_host (localhost), db_name, db_user, db_pass, then set its permissions to 600.');
} elseif ($unlocked) {
    foreach (['db_host', 'db_name', 'db_user', 'db_pass', 'cron_key'] as $k) {
        check(($cfg[$k] ?? '') !== '' ? 'ok' : 'bad', "api/config.php: $k",
              ($cfg[$k] ?? '') !== '' ? 'set' : 'EMPTY', 'Fill it in — never leave it blank.');
    }

    // ------------------------------------------------------------ the database
    try {
        $db = new PDO(
            "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
            (string) $cfg['db_user'], (string) $cfg['db_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
        check('ok', 'Database connection', "connected to {$cfg['db_name']}");

        // Every table the shop needs, and what stops working without each.
        $need = [
            'products' => 'the catalogue', 'product_variants' => 'sizes and stock',
            'orders' => 'checkout', 'order_items' => 'what was ordered',
            'admin_users' => 'signing in to /backends', 'settings' => 'the slider and promo bar',
            'hero_slides' => 'the home slides', 'discounts' => 'coupons and offers',
            'brands' => 'the brands list', 'fulfilment_outbox' => 'the warehouse email',
        ];
        $have = [];
        foreach ($db->query('show tables') as $r) $have[] = (string) reset($r);
        $absent = array_values(array_diff(array_keys($need), $have));
        check($absent ? 'bad' : 'ok', 'Database tables',
              $absent ? 'missing: ' . implode(', ', $absent) : count($need) . ' present',
              'phpMyAdmin → Import → run api/schema.mysql.sql, then api/seed.mysql.sql, then api/brands.mysql.sql. IN THAT ORDER — getting it wrong fails quietly. All three are safe to re-run.');

        if (!$absent) {
            $n = (int) $db->query('select count(*) from products')->fetchColumn();
            check($n > 0 ? 'ok' : 'warn', 'Products loaded', "$n in the catalogue",
                  'Run api/seed.mysql.sql in phpMyAdmin — the schema creates empty tables.');
            $a = (int) $db->query('select count(*) from admin_users')->fetchColumn();
            check($a > 0 ? 'ok' : 'bad', 'Admin account', $a > 0 ? "$a account(s)" : 'none — nobody can sign in',
                  'Open /api/setup-admin.php, use the cron_key from config.php, then DELETE that file.');
            $locked = (int) $db->query('select count(*) from admin_users where locked_until > now()')->fetchColumn();
            check($locked ? 'warn' : 'ok', 'Admin lock', $locked ? "$locked account locked out right now" : 'not locked',
                  'Five wrong passwords locks an account for 15 minutes. It clears itself.');
        }
    } catch (PDOException $e) {
        // The same mapping store.php uses: MySQL says WHICH value is wrong, and
        // the fix differs per value, so it is passed on rather than flattened.
        $code = (int) ($e->errorInfo[1] ?? 0);
        $which = match ($code) {
            1045 => 'db_user or db_pass is wrong',
            1044 => 'db_user has no privileges on db_name',
            1049 => 'db_name does not exist',
            2002, 2005 => 'db_host is wrong (it should be localhost)',
            default => 'MySQL refused the connection',
        };
        check('bad', 'Database connection', $which,
              'hPanel → Databases → MySQL Databases. Hostinger PREFIXES the database and user with your account, so both look like u123456789_sporta, not sporta. Set a fresh password there and paste the same one into api/config.php.');
    }

    // -------------------------------------------------------- the money path
    //
    // The mysql_* block is checked by name because its absence is the single
    // documented way to have a shop that looks perfect and refuses every card:
    // without it /knet/pay.php cannot read the order it is being asked to
    // charge for, and answers "Invalid amount".
    $pay = [
        'knet/config.php' => ['tranportal_id', 'tranportal_password', 'resource_key'],
        'pay/config.php'  => ['client_id', 'client_secret', 'encrp_key'],
    ];
    foreach ($pay as $rel => $keys) {
        $p = $root . '/' . $rel;
        if (!is_file($p)) {
            check('warn', $rel, 'missing — this payment method is off',
                  "Copy $rel" . ".example to $rel and fill it in. See CHECKOUT-SECRETS.md.");
            continue;
        }
        $c = array_change_key_case((array) (require $p), CASE_LOWER);
        $blank = [];
        foreach ($keys as $k) if (($c[$k] ?? '') === '') $blank[] = $k;
        check($blank ? 'bad' : 'ok', $rel,
              $blank ? 'empty: ' . implode(', ', $blank) : 'credentials set',
              'Get these from CBK. They are different credentials for each product — neither set works for the other.');
        $mysql = array_filter(['mysql_host', 'mysql_name', 'mysql_user', 'mysql_pass'],
                              fn ($k) => ($c[$k] ?? '') === '');
        check($mysql ? 'bad' : 'ok', "$rel: database block",
              $mysql ? 'missing: ' . implode(', ', $mysql) : 'present',
              'These four name the SAME database as api/config.php, just spelled mysql_* instead of db_*. Without them every payment is refused with "Invalid amount" while the shop looks perfectly fine.');
    }
}

// ------------------------------------------------ tools that must not remain
foreach (['/api/setup-admin.php', '/api/preflight.php', '/knet/setup-config.php',
          '/knet/selftest.php', '/go-live.html'] as $p) {
    if (is_file($root . $p)) {
        check('warn', "Still on the server: $p", 'delete it',
              'Setup tools reveal configuration state. Delete each one once you are live; npm run publish never puts them back.');
    }
}

$https = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
      || ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443')
      || (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');
check($https ? 'ok' : 'warn', 'HTTPS', $https ? 'on' : 'this page was served over plain HTTP',
      'hPanel → Security → SSL. Without it the admin session cookie cannot use its __Host- protection.');

$counts = array_count_values(array_column($rows, 'state'));
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
?>
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sporta — install check</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; margin: 0; background: #171a1e; color: #e2dbce }
  main { max-width: 820px; margin: 0 auto; padding: 32px 20px 80px }
  h1 { font-size: 22px; margin: 0 0 4px }
  .sub { color: #9a948a; margin: 0 0 24px }
  .banner { border-radius: 12px; padding: 14px 18px; font-weight: 700; margin-bottom: 24px }
  .ok   { background: #14361f; color: #7ee2a8 }
  .warn { background: #3a2f12; color: #f0c674 }
  .bad  { background: #3d1a1a; color: #f2a0a0 }
  .row { border-top: 1px solid #2a2e34; padding: 12px 0; display: flex; gap: 12px; align-items: flex-start }
  .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 7px }
  .dot.ok { background: #45c17c } .dot.warn { background: #e0a53c } .dot.bad { background: #e05c5c }
  .what { font-weight: 600 }
  .detail { color: #9a948a; font-size: 13px }
  .fix { color: #f0c674; font-size: 13px; margin-top: 4px }
  form { background: #1f242a; border-radius: 12px; padding: 18px; margin-bottom: 24px }
  input { font: inherit; padding: 9px 12px; border-radius: 8px; border: 1px solid #3a4048;
          background: #12151a; color: #e2dbce; width: 100%; max-width: 340px }
  button { font: inherit; font-weight: 700; padding: 9px 18px; border: 0; border-radius: 8px;
           background: #e0561c; color: #171a1e; cursor: pointer; margin-top: 10px }
</style>
<main>
  <h1>Sporta — install check</h1>
  <p class="sub">Read-only. It changes nothing. Delete this file when the shop is live.</p>

  <div class="banner <?= $worst ?>">
    <?= $worst === 'ok' ? 'Everything this page can see is correct.'
        : ($worst === 'warn' ? 'Working, with things worth tidying.'
        : 'Something is stopping the shop from working.') ?>
    &nbsp;<?= (int) ($counts['ok'] ?? 0) ?> ok · <?= (int) ($counts['warn'] ?? 0) ?> warnings · <?= (int) ($counts['bad'] ?? 0) ?> problems
  </div>

<?php if ($configured && !$unlocked): ?>
  <form method="post">
    <p style="margin:0 0 10px"><strong>The database and payment checks need the key.</strong><br>
      <span class="detail">Paste the <code>cron_key</code> value from <code>api/config.php</code>. Everything above is shown without it.</span></p>
    <input type="password" name="key" autocomplete="off" placeholder="cron_key from api/config.php" autofocus>
    <button type="submit">Check everything</button>
  </form>
<?php endif; ?>

<?php foreach ($rows as $r): ?>
  <div class="row">
    <span class="dot <?= $r['state'] ?>"></span>
    <span>
      <span class="what"><?= htmlspecialchars($r['what'], ENT_QUOTES) ?></span>
      <?php if ($r['detail']): ?><span class="detail"> — <?= htmlspecialchars($r['detail'], ENT_QUOTES) ?></span><?php endif; ?>
      <?php if ($r['state'] !== 'ok' && $r['fix']): ?><div class="fix"><?= htmlspecialchars($r['fix'], ENT_QUOTES) ?></div><?php endif; ?>
    </span>
  </div>
<?php endforeach; ?>
</main>
