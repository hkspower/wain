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

// THE LADDER.
//
// A list of 31 things that are wrong is not a plan, and the owner has no shell
// and no way to tell which of them is causing the others. Every check belongs
// to a numbered step, the steps are in DEPENDENCY order, and the page shows
// exactly one of them at a time: the lowest-numbered step with something
// broken. Fix that, reload, and it moves on.
//
// The order is not editorial. Nothing can be checked before the files are on
// the server; the database cannot be reached before config.php names it; the
// tables cannot be imported before the connection works; KNET prices its
// charge from the orders table, so it cannot work before any of that. Which is
// why "set up KNET" is step 6 and not step 1, however much it is the thing
// actually being waited for.
const STEPS = [
    1 => 'Upload the site',
    2 => 'PHP settings in hPanel',
    3 => 'Connect the database',
    4 => 'Import the three SQL files',
    5 => 'Create your sign-in',
    6 => 'Set up KNET',
    7 => 'Switch KNET to live',
];

/** @param string $state ok|warn|bad */
function check(string $state, string $what, string $detail = '', string $fix = '', int $step = 0): void {
    global $rows, $worst;
    $rows[] = compact('state', 'what', 'detail', 'fix', 'step');
    if ($state === 'bad' || ($state === 'warn' && $worst === 'ok')) $worst = $state;
}

// ---------------------------------------------------------------- the runtime
check(
    version_compare(PHP_VERSION, '8.0', '>=') ? 'ok' : 'bad',
    'PHP version', PHP_VERSION,
    'hPanel → Advanced → PHP Configuration → PHP version. This site needs 8.0 or newer.',
    2
);
foreach (['pdo_mysql' => 'the database', 'openssl' => 'the KNET AES encryption',
          'mbstring' => 'Arabic text', 'json' => 'every API response'] as $ext => $why) {
    check(extension_loaded($ext) ? 'ok' : 'bad', "PHP extension: $ext", $why,
          'hPanel → Advanced → PHP Configuration → PHP extensions. Tick it and save.', 2);
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
          'The upload did not land. Extract SPORTA-GO-LIVE.zip so its public_html/ CONTENTS are in your public_html.', 1);
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
          'Delete public_html/assets entirely and re-extract the zip. A half-uploaded assets folder is what shows a top bar and a logo and nothing else.', 1);
}

// .htaccess is the single most-missed file, because File Manager hides it.
foreach (['/.htaccess' => 'HTTPS, security headers, and deep routes like /shop',
          '/api/.htaccess' => 'keeps config.php and the .sql files unreadable',
          '/knet/.htaccess' => 'keeps the Tranportal credentials unreadable',
          '/pay/.htaccess' => 'keeps the CBK credentials unreadable'] as $p => $why) {
    check(is_file($root . $p) ? 'ok' : 'bad', $p, $why,
          'Turn on "Show hidden files" in File Manager and re-extract. Without these the site 404s on /shop and your credentials are downloadable.', 1);
}
check(is_dir($root . '/hero') ? 'ok' : 'warn', '/hero', is_dir($root . '/hero') ? 'present' : 'missing',
      'Without it the home page falls back to drawn illustrations instead of the photographs.', 1);

// ------------------------------------------------------------- the gate
$cfgPath = $here . '/config.php';
$configured = is_file($cfgPath);
$cfg = $configured ? (array) (require $cfgPath) : [];
$key = (string) ($_POST['key'] ?? '');
$unlocked = !$configured
    || (($cfg['cron_key'] ?? '') !== '' && hash_equals((string) $cfg['cron_key'], $key));

if (!$configured) {
    check('bad', 'api/config.php', 'missing',
          'Copy api/config.example.php to api/config.php, fill in db_host (localhost), db_name, db_user, db_pass, then set its permissions to 600.', 3);
} elseif ($unlocked) {
    foreach (['db_host', 'db_name', 'db_user', 'db_pass', 'cron_key'] as $k) {
        check(($cfg[$k] ?? '') !== '' ? 'ok' : 'bad', "api/config.php: $k",
              ($cfg[$k] ?? '') !== '' ? 'set' : 'EMPTY', 'Fill it in — never leave it blank.', 3);
    }

    // ------------------------------------------------------------ the database
    try {
        $db = new PDO(
            "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
            (string) $cfg['db_user'], (string) $cfg['db_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
        );
        check('ok', 'Database connection', "connected to {$cfg['db_name']}", '', 3);

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
              'phpMyAdmin → Import → run api/schema.mysql.sql, then api/seed.mysql.sql, then api/brands.mysql.sql. IN THAT ORDER — getting it wrong fails quietly. All three are safe to re-run.', 4);

        if (!$absent) {
            $n = (int) $db->query('select count(*) from products')->fetchColumn();
            check($n > 0 ? 'ok' : 'warn', 'Products loaded', "$n in the catalogue",
                  'Run api/seed.mysql.sql in phpMyAdmin — the schema creates empty tables.', 4);
            $a = (int) $db->query('select count(*) from admin_users')->fetchColumn();
            check($a > 0 ? 'ok' : 'bad', 'Admin account', $a > 0 ? "$a account(s)" : 'none — nobody can sign in',
                  'Open /api/setup-admin.php, use the cron_key from config.php, then DELETE that file.', 5);
            $locked = (int) $db->query('select count(*) from admin_users where locked_until > now()')->fetchColumn();
            check($locked ? 'warn' : 'ok', 'Admin lock', $locked ? "$locked account locked out right now" : 'not locked',
                  'Five wrong passwords locks an account for 15 minutes. It clears itself.', 5);
        }
    } catch (PDOException $e) {
        // The same mapping store.php uses: MySQL says WHICH value is wrong, and
        // the fix differs per value, so it is passed on rather than flattened.
        $code = (int) ($e->errorInfo[1] ?? 0);
        $which = match ($code) {
            1045 => 'db_user or db_pass is wrong',
            1044 => 'db_user has no privileges on db_name',
            1049 => 'db_name does not exist',
            // 2002 is "could not reach the server at all", which is a wrong
            // db_host OR a MySQL that is down. On shared hosting the second is
            // rare and not the owner's to fix, so both are named rather than
            // sending them to edit a value that may be correct.
            2002, 2005 => 'cannot reach MySQL — db_host is wrong, or the database server is down',
            default => 'MySQL refused the connection',
        };
        check('bad', 'Database connection', $which,
              'hPanel → Databases → MySQL Databases. Hostinger PREFIXES the database and user with your account, so both look like u123456789_sporta, not sporta. Set a fresh password there and paste the same one into api/config.php.', 3);
    }

    // -------------------------------------------------------- the money path
    //
    // The mysql_* block is checked by name because its absence is the single
    // documented way to have a shop that looks perfect and refuses every card:
    // without it /knet/pay.php cannot read the order it is being asked to
    // charge for, and answers "Invalid amount".
    // KNET is step 6 and blocks; T-Pay is a second, independent CBK product and
    // must never hold the card path up, so everything about it is a warning.
    $pay = [
        'knet/config.php' => [['tranportal_id', 'tranportal_password', 'resource_key'], 6, 'bad'],
        'pay/config.php'  => [['client_id', 'client_secret', 'encrp_key'], 0, 'warn'],
    ];
    foreach ($pay as $rel => [$keys, $step, $sev]) {
        $p = $root . '/' . $rel;
        if (!is_file($p)) {
            check($sev, $rel, 'missing — this payment method is off',
                  "In File Manager, copy $rel" . ".example to $rel, then fill in the values CBK gave you. CHECKOUT-SECRETS.md lists every one and what breaks without it.", $step);
            continue;
        }
        $c = array_change_key_case((array) (require $p), CASE_LOWER);
        $blank = [];
        foreach ($keys as $k) if (($c[$k] ?? '') === '') $blank[] = $k;
        check($blank ? $sev : 'ok', $rel,
              $blank ? 'empty: ' . implode(', ', $blank) : 'credentials set',
              'These come from CBK, on the activation letter for THIS product. KNET credentials do not work for T-Pay and T-Pay credentials do not work for KNET.', $step);
        $mysql = array_filter(['mysql_host', 'mysql_name', 'mysql_user', 'mysql_pass'],
                              fn ($k) => ($c[$k] ?? '') === '');
        check($mysql ? $sev : 'ok', "$rel: database block",
              $mysql ? 'missing: ' . implode(', ', $mysql) : 'present',
              'These four name the SAME database as api/config.php, just spelled mysql_* instead of db_*. Copy the values across exactly. Without them every payment is refused with "Invalid amount" while the shop looks perfectly fine.', $step);

        // KNET's AES key must be EXACTLY 16 bytes, and the failure when it is
        // not is the nastiest one in the whole money path: the bank rejects
        // every transaction and says nothing useful about why. A trailing
        // space off a copy/paste is the usual cause, so the count is what is
        // reported rather than "set".
        if ($rel === 'knet/config.php') {
            $len = strlen((string) ($c['resource_key'] ?? ''));
            check($len === 16 ? 'ok' : 'bad', 'knet/config.php: resource_key length',
                  "$len bytes (must be exactly 16)",
                  'AES-128 needs 16 bytes. 17 usually means a trailing space or newline came along with the copy/paste; 0 means it is still the placeholder text.', 6);
        }

        // Which gateway this is actually pointed at. Both directions are a
        // real mistake: testing against the live bank, or taking real money on
        // the test one and wondering why it never settles.
        $env = strtolower((string) ($c['env'] ?? ''));
        check($env === 'production' ? 'ok' : 'warn', "$rel: env",
              $env === '' ? 'not set' : $env,
              $env === 'production'
                ? ''
                : "Still pointed at the TEST gateway, so real cards will not work. Change env to 'production' — but ONLY after CBK confirms the account is live, and after you have put a test order through.",
              $rel === 'knet/config.php' ? 7 : 0);
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

// ------------------------------------------------------------- which step
//
// The lowest-numbered step that still has something broken. Steps below it are
// done; steps above it cannot be judged yet, and pretending otherwise is how a
// checklist sends someone to fix step 6 while step 3 is what is breaking it.
$blocking = 0;
foreach ($rows as $r) {
    if ($r['state'] === 'bad' && $r['step'] > 0 && ($blocking === 0 || $r['step'] < $blocking)) {
        $blocking = $r['step'];
    }
}
// A locked page cannot see past step 3, so it must not claim the rest is fine.
$needKey = $configured && !$unlocked;
if ($needKey && ($blocking === 0 || $blocking > 3)) $blocking = 3;

// The last step is a warning, not a failure — being on the test gateway is
// correct right up until the bank says otherwise. It is still the final rung,
// so it is shown as one once everything below it is green.
$pending7 = false;
foreach ($rows as $r) {
    if ($r['step'] === 7 && $r['state'] !== 'ok') $pending7 = true;
}
$current = $blocking ?: ($pending7 ? 7 : 0);

$counts = array_count_values(array_column($rows, 'state'));
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
?>
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sporta — setup, step by step</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; margin: 0; background: #171a1e; color: #e2dbce }
  main { max-width: 780px; margin: 0 auto; padding: 32px 20px 80px }
  h1 { font-size: 22px; margin: 0 0 4px }
  .sub { color: #9a948a; margin: 0 0 24px; font-size: 14px }
  .now { border-radius: 14px; padding: 20px 22px; margin-bottom: 28px; background: #23282f;
         border: 2px solid #e0561c }
  .now.done { border-color: #45c17c }
  .now h2 { margin: 0 0 2px; font-size: 19px }
  .now .of { color: #e0561c; font-weight: 700; font-size: 13px; letter-spacing: .08em;
             text-transform: uppercase }
  .now.done .of { color: #45c17c }
  .todo { margin: 14px 0 0; padding: 0; list-style: none }
  .todo li { border-top: 1px solid #333941; padding: 10px 0 }
  .todo b { display: block }
  .todo span { color: #f0c674; font-size: 13.5px }
  .ladder { list-style: none; padding: 0; margin: 0 0 24px }
  .ladder li { display: flex; gap: 10px; align-items: center; padding: 7px 0; color: #6f6a63 }
  .ladder li.done { color: #7ee2a8 } .ladder li.cur { color: #e2dbce; font-weight: 700 }
  .num { flex: none; width: 22px; height: 22px; border-radius: 50%; font-size: 12px;
         display: grid; place-items: center; background: #2a2f36; color: #9a948a }
  .done .num { background: #14361f; color: #7ee2a8 } .cur .num { background: #e0561c; color: #171a1e }
  details { margin-top: 28px } summary { cursor: pointer; color: #9a948a; font-size: 14px }
  .row { border-top: 1px solid #2a2e34; padding: 10px 0; display: flex; gap: 10px }
  .dot { flex: none; width: 9px; height: 9px; border-radius: 50%; margin-top: 8px }
  .dot.ok { background: #45c17c } .dot.warn { background: #e0a53c } .dot.bad { background: #e05c5c }
  .detail { color: #9a948a; font-size: 13px }
  form { background: #23282f; border-radius: 12px; padding: 16px; margin-top: 14px }
  input { font: inherit; padding: 9px 12px; border-radius: 8px; border: 1px solid #3a4048;
          background: #12151a; color: #e2dbce; width: 100%; max-width: 330px }
  button { font: inherit; font-weight: 700; padding: 9px 18px; border: 0; border-radius: 8px;
           background: #e0561c; color: #171a1e; cursor: pointer; margin-top: 10px }
  code { font-size: 13px; color: #f0c674 }
</style>
<main>
  <h1>Sporta — setup, step by step</h1>
  <p class="sub">Do the one step below, then reload this page. It only ever asks for one thing at a time.
     Read-only: it changes nothing, and prints no password. Delete this file when you are finished.</p>

<?php if ($current === 0): ?>
  <div class="now done">
    <div class="of">All seven steps done</div>
    <h2>The shop is set up and KNET is live.</h2>
    <p class="sub" style="margin:8px 0 0">Put one real order through with a real card, refund it, then delete
       <code>api/preflight.php</code>, <code>api/setup-admin.php</code>,
       <code>knet/setup-config.php</code>, <code>knet/selftest.php</code> and <code>go-live.html</code>.</p>
  </div>
<?php else: ?>
  <div class="now">
    <div class="of">Step <?= $current ?> of <?= count(STEPS) ?><?= $blocking === 0 ? ' — last one' : '' ?></div>
    <h2><?= htmlspecialchars(STEPS[$current], ENT_QUOTES) ?></h2>
    <?php if ($needKey && $current === 3): ?>
      <p style="margin:10px 0 0">The database, sign-in and KNET checks need the key before they can be read.</p>
      <form method="post">
        <input type="password" name="key" autocomplete="off" placeholder="cron_key from api/config.php" autofocus>
        <button type="submit">Continue</button>
      </form>
    <?php endif; ?>
    <ul class="todo">
    <?php foreach ($rows as $r): if ($r['step'] !== $current || $r['state'] === 'ok') continue; ?>
      <li>
        <b><?= htmlspecialchars($r['what'], ENT_QUOTES) ?><?= $r['detail'] ? ' — ' . htmlspecialchars($r['detail'], ENT_QUOTES) : '' ?></b>
        <?php if ($r['fix']): ?><span><?= htmlspecialchars($r['fix'], ENT_QUOTES) ?></span><?php endif; ?>
      </li>
    <?php endforeach; ?>
    </ul>
  </div>
<?php endif; ?>

  <ul class="ladder">
  <?php foreach (STEPS as $n => $title):
    $cls = $current === 0 || $n < $current ? 'done' : ($n === $current ? 'cur' : ''); ?>
    <li class="<?= $cls ?>"><span class="num"><?= $cls === 'done' ? '✓' : $n ?></span><?= htmlspecialchars($title, ENT_QUOTES) ?></li>
  <?php endforeach; ?>
  </ul>

  <details>
    <summary>Everything checked (<?= (int) ($counts['ok'] ?? 0) ?> ok ·
      <?= (int) ($counts['warn'] ?? 0) ?> warnings · <?= (int) ($counts['bad'] ?? 0) ?> problems)</summary>
    <?php foreach ($rows as $r): ?>
      <div class="row">
        <span class="dot <?= $r['state'] ?>"></span>
        <span>
          <b><?= htmlspecialchars($r['what'], ENT_QUOTES) ?></b>
          <?php if ($r['detail']): ?><span class="detail"> — <?= htmlspecialchars($r['detail'], ENT_QUOTES) ?></span><?php endif; ?>
          <?php if ($r['state'] !== 'ok' && $r['fix']): ?><div class="detail" style="color:#f0c674"><?= htmlspecialchars($r['fix'], ENT_QUOTES) ?></div><?php endif; ?>
        </span>
      </div>
    <?php endforeach; ?>
  </details>
</main>
