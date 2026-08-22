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
    4 => 'Import api/install.mysql.sql',
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
// PRESENT IS NOT THE SAME AS PROTECTING ANYTHING. The check above asks only
// whether a file with that name arrived. A .htaccess that was truncated by a
// half-finished upload, or overwritten by a tidier-looking one from somewhere
// else, passes it — and the thing it was guarding is the Tranportal password.
// So the two that guard credentials are read, and the deny rule is looked for
// by name. Cheap, deterministic, no network.
foreach (['/knet/.htaccess' => ['config.php', 'knet.php'],
          '/pay/.htaccess'  => ['config.php', 'cbk.php']] as $p => $names) {
    if (!is_file($root . $p)) continue;   // already reported missing above
    // Backslashes stripped first: the rule is written as a regex —
    // <FilesMatch "^(config\.php|knet\.php)$"> — so a plain search for
    // "config.php" does not find "config\.php" and the real, correct file
    // would be reported as guarding nothing.
    $txt = str_replace('\\', '', (string) file_get_contents($root . $p));
    $unguarded = array_values(array_filter($names, fn ($n) => !str_contains($txt, $n)));
    check($unguarded ? 'bad' : 'ok', "$p denies its secrets",
          $unguarded ? 'no rule mentions: ' . implode(', ', $unguarded) : 'config.php and the library are denied',
          "This file is what stops $p" . "'s credentials being downloaded over HTTP. Re-extract it from the zip rather than editing it — it is not a file to tidy.", 1);
}

// THE LIVE SITEMAP, and why a missing half of it is worse than a missing whole.
// /sitemap-products.xml is rewritten to api/sitemap-products.php so the URL
// does not change. The rewrite is conditional on that file existing, so an
// upload that brought the new .htaccess but not the PHP file falls back to the
// static sitemap and simply keeps serving the catalogue as it stood at build
// time — no error, no warning, and new products are never crawled. A warning,
// not a failure: nothing about the shop stops working, it just stops growing
// in Google, which is exactly the kind of fault nobody goes looking for.
$sm  = is_file($here . '/sitemap-products.php');
$ht  = is_file($root . '/.htaccess') &&
       str_contains((string) file_get_contents($root . '/.htaccess'), 'sitemap-products.php');
check($sm && $ht ? 'ok' : 'warn', 'Live product sitemap',
      $sm && $ht ? 'served from the catalogue'
                 : (!$sm && !$ht ? 'neither the file nor the rewrite arrived'
                    : (!$sm ? 'api/sitemap-products.php is missing — falling back to the build-time copy'
                            : '.htaccess has no rewrite — the build-time copy is being served')),
      'Re-extract the zip with hidden files shown: it needs api/sitemap-products.php AND the .htaccess that rewrites /sitemap-products.xml to it. Until both are there, products added in /backends are never crawled.', 1);

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
              'hPanel → Databases → phpMyAdmin → pick your database → Import → api/install.mysql.sql → Go. That one file is all four parts in the right order, so there is no order to get wrong, and it is safe to re-run — it repairs what is missing and leaves orders alone.', 4);

        if (!$absent) {
            // THE TABLES BEING PRESENT IS NOT THE SAME AS THE SCHEMA BEING
            // CURRENT, and this is the gap that made an UPGRADE harder to
            // diagnose than a fresh install. A shop imported months ago has all
            // fourteen tables and passes the check above; what it does not have
            // is the columns added since. Every one of them fails QUIETLY:
            //
            //   orders.stock_claimed / stock_released   the order is written,
            //     the shelf is never decremented, and the shop oversells until
            //     somebody counts the boxes.
            //   orders.pay_attempt                      a retried card payment
            //     cannot be told apart from the first one.
            //   order_items.name_en / name_ar           an invoice describes
            //     July's order in today's wording.
            //   products.brand_slug / images            the brand filter is
            //     empty and the grid shows one photo per product.
            //
            // Not one of them raises an error a shopper or the owner would see.
            // The fix is the same single import as the missing-table case —
            // install.mysql.sql is additive and safe to re-run — so the check
            // is worth nothing except that it ASKS, which nothing else did.
            $cols = [
                'orders'      => ['stock_claimed' => 'stock is never decremented — the shop oversells',
                                  'stock_released' => 'a failed payment never returns its stock',
                                  'pay_attempt'    => 'a retried card payment cannot be told from the first'],
                'order_items' => ['name_en' => 'invoices describe past orders in today’s wording',
                                  'name_ar' => 'invoices describe past orders in today’s wording'],
                'products'    => ['brand_slug' => 'the brands filter is empty',
                                  'images'     => 'only one photo per product'],
            ];
            $stale = [];
            foreach ($cols as $table => $wanted) {
                $present = [];
                foreach ($db->query("show columns from `$table`") as $c) $present[] = (string) $c['Field'];
                foreach ($wanted as $col => $why) {
                    if (!in_array($col, $present, true)) $stale[] = "$table.$col ($why)";
                }
            }
            check($stale ? 'bad' : 'ok', 'Database is up to date',
                  $stale ? count($stale) . ' column(s) missing: ' . implode('; ', $stale)
                         : 'every column this version needs is there',
                  'Same import as above: phpMyAdmin → your database → Import → api/install.mysql.sql → Go. It only adds what is absent; your orders and products are untouched.', 4);

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
        // A PLACEHOLDER IS NOT A CREDENTIAL. config.example.php ships
        // YOUR_TRANPORTAL_ID, YOUR_TRANPORTAL_PASSWORD and
        // YOUR_TERMINAL_RESOURCE_KEY, and a check for "not empty" accepted
        // every one of them — so copying the example and filling in nothing
        // reported "credentials set" and the ladder walked straight past step
        // 6 to declare the shop live.
        $unset = fn ($v) => $v === '' || str_starts_with(strtoupper((string) $v), 'YOUR_');
        $blank = [];
        foreach ($keys as $k) if ($unset($c[$k] ?? '')) $blank[] = $k;
        check($blank ? $sev : 'ok', $rel,
              $blank ? 'still the example value: ' . implode(', ', $blank) : 'credentials set',
              'These come from CBK, on the activation letter for THIS product. KNET credentials do not work for T-Pay and T-Pay credentials do not work for KNET.', $step);
        // AN INVISIBLE CHARACTER IS A WRONG CREDENTIAL, and it looks right in
        // every editor. A Tranportal password pasted out of a PDF or an email
        // routinely arrives carrying a non-breaking space, a zero-width space
        // or a BOM; File Manager renders all three as nothing at all. The
        // bank then rejects the credential and the owner re-types a value
        // that was already correct. setup-config.php knew to strip these, but
        // it is CLI-only on a host with no shell, so the knowledge lived
        // where it could never run.
        $invisible = [];
        foreach ($keys as $k) {
            $v = (string) ($c[$k] ?? '');
            if ($v === '' || $unset($v)) continue;
            if (preg_match('/^\s|\s$|\x{00A0}|\x{200B}|\x{FEFF}/u', $v)) $invisible[] = $k;
        }
        check($invisible ? $sev : 'ok', "$rel: characters",
              $invisible ? 'stray or invisible whitespace in: ' . implode(', ', $invisible) : 'clean',
              'One of these values begins or ends with a space, or contains a non-breaking space, zero-width space or BOM — invisible in File Manager and fatal to the bank. Retype the value by hand rather than pasting it, or paste into a plain text editor first.', $step);

        // THE SAME INHERITANCE THE GATEWAY ITSELF APPLIES. knet_config() and
        // cbk_config() fill an absent mysql_* block from api/config.php's db_*,
        // so a config that omits it is now CORRECT rather than fatal — and this
        // page has to agree with the code, or it reports a dead card path on a
        // shop that takes cards perfectly well. Everything below this point
        // then tests the values that will ACTUALLY be used, which is the only
        // thing worth testing.
        $inherited = [];
        foreach (['host', 'name', 'user', 'pass'] as $k) {
            if (($c['mysql_' . $k] ?? '') === '' && ($cfg['db_' . $k] ?? '') !== '') {
                $c['mysql_' . $k] = $cfg['db_' . $k];
                $inherited[] = 'mysql_' . $k;
            }
        }
        $mysql = array_filter(['mysql_host', 'mysql_name', 'mysql_user', 'mysql_pass'],
                              fn ($k) => ($c[$k] ?? '') === '');
        check($mysql ? $sev : 'ok', "$rel: database block",
              $mysql ? 'missing: ' . implode(', ', $mysql)
                     : ($inherited ? 'inherited from api/config.php (' . count($inherited) . ' value(s))' : 'set here'),
              'This names the orders database. It is OPTIONAL: leave it out and the gateway reads api/config.php\'s db_* values, which is the recommended way — one database named in one place cannot fall out of step with itself. Set it here only to point the gateway somewhere else deliberately. If it is missing from BOTH files every payment is refused with "Invalid amount" while the shop looks perfectly fine.', $step);

        // PRESENT IS NOT CONNECTED, and this is the hole in the check above.
        //
        // The four keys being non-empty was the whole test. A password typed
        // with one character wrong, or a db_name without the u123456789_
        // prefix Hostinger silently requires, passes it — and then every card
        // payment is refused with "Invalid amount" while this page says the
        // database block is present. That is the exact failure this file was
        // written to catch, checked in a way that could not catch it.
        //
        // So the gateway's OWN credentials are used to open its OWN
        // connection, and the orders table is read. Nothing is printed but
        // the outcome.
        if (!$mysql) {
            try {
                $gwdb = new PDO(
                    "mysql:host={$c['mysql_host']};dbname={$c['mysql_name']};charset=utf8mb4",
                    (string) $c['mysql_user'], (string) $c['mysql_pass'],
                    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
                );
                $n = (int) $gwdb->query('select count(*) from orders')->fetchColumn();
                check('ok', "$rel: reaches the orders table", "connected, $n order(s)", '', $step);

                // Connected is still not the same as connected to the RIGHT
                // one. Two valid databases, one shop: the checkout writes an
                // order here and the gateway looks for it there, finds
                // nothing, and refuses a payment for an order that plainly
                // exists. Comparing the names is enough to see it.
                $same = strtolower((string) ($c['mysql_name'] ?? '')) === strtolower((string) ($cfg['db_name'] ?? ''))
                     && strtolower((string) ($c['mysql_host'] ?? '')) === strtolower((string) ($cfg['db_host'] ?? ''));
                check($same ? 'ok' : $sev, "$rel: same database as api/config.php",
                      $same ? 'yes' : 'NO — it names a different database',
                      'The shop writes the order and this gateway reads it. Pointing them at two databases means every payment is for an order the gateway cannot find. mysql_host/mysql_name here must equal db_host/db_name in api/config.php.', $step);
            } catch (PDOException $e) {
                $code = (int) ($e->errorInfo[1] ?? 0);
                $which = match ($code) {
                    1045 => 'mysql_user or mysql_pass is wrong',
                    1044 => 'that user has no privileges on that database',
                    1049 => 'mysql_name does not exist',
                    2002, 2005 => 'cannot reach MySQL — mysql_host is wrong',
                    default => 'MySQL refused the connection',
                };
                check($sev, "$rel: reaches the orders table", $which,
                      'The four values are filled in but they do not work. Copy them from api/config.php exactly — Hostinger PREFIXES both the database and the user with your account number, so they look like u123456789_sporta. Until this connects, every payment is refused with "Invalid amount".', $step);
            }
        }

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

            // SIXTEEN BYTES IS NECESSARY, NOT SUFFICIENT. Sixteen bytes of
            // the wrong thing counts as sixteen, and so does a key with a
            // non-breaking space in the middle of it. The only way to know
            // openssl will accept this key in the shape the real code uses is
            // to run the real code: encrypt a payload with knet_encrypt() and
            // read it back with knet_decrypt(). If that round trip does not
            // return what went in, every transaction dies at the bank with no
            // useful error — the single most expensive failure in this
            // system, and the one the owner has no way to diagnose.
            //
            // knet.php is a pure library: it declares functions and runs
            // nothing at include time, so requiring it here is safe.
            $lib = $root . '/knet/knet.php';
            if ($len === 16 && is_file($lib)) {
                require_once $lib;
                $probe = 'trackid=PREFLIGHT&amt=1.500';
                try {
                    $ok = knet_decrypt(knet_encrypt($probe, (string) $c['resource_key']),
                                       (string) $c['resource_key']) === $probe;
                    check($ok ? 'ok' : 'bad', 'knet: the key actually encrypts',
                          $ok ? 'AES-128-CBC round trip OK' : 'round trip FAILED',
                          'The key is the right length but openssl cannot use it. Re-download the resource file from the KNET merchant portal and paste the key again, by hand.', 6);
                } catch (Throwable $e) {
                    check('bad', 'knet: the key actually encrypts', 'openssl refused the key',
                          'The key is 16 bytes but not usable. Re-download the resource file from the KNET merchant portal.', 6);
                }
            }
        }

        // ------------------------------------------------ ready to go live?
        //
        // Step 7 is not "is env set to production". It is "may this safely BE
        // set to production", which is a different question and the one worth
        // answering before real money is involved: the flip changes one word
        // and every card after it is somebody's actual money.
        //
        // Everything below is checked whichever mode the shop is in, so the
        // answer is ready BEFORE the switch rather than discovered by the
        // first live customer.
        $env  = strtolower((string) ($c['env'] ?? ''));
        $live = $env === 'production';
        $s7   = $rel === 'knet/config.php' ? 7 : 0;

        if ($rel === 'knet/config.php') {
            $prod = (string) ($c['production_url'] ?? '');
            $test = (string) ($c['test_url'] ?? '');
            // The flip swaps which URL is used. If production_url is empty,
            // still the test host, or the same string as test_url, then
            // switching to production changes nothing except the label — and
            // that is the failure that looks exactly like success: orders
            // "succeed" all day against a gateway that settles nothing.
            $badProd = $prod === '' || $prod === $test
                       || stripos($prod, 'test') !== false || !str_starts_with($prod, 'https://');
            // And the mirror image, which matters BEFORE the flip rather
            // than after it: while env is 'test', test_url must actually be a
            // test host. Pointing it at production and leaving the label on
            // 'test' means the rehearsal is being run with real cards.
            if (!$live) {
                $badTest = $test === '' || !str_starts_with($test, 'https://')
                           || stripos($test, 'test') === false;
                check($badTest ? 'bad' : 'ok', 'knet: test_url',
                      $test === '' ? 'not set' : $test,
                      'While env is "test" this is the gateway every payment goes to, so it must be the TEST host. If it is the production URL, the test transactions are real ones.', 6);
            }

            check($badProd ? 'bad' : 'ok', 'knet: production_url',
                  $prod === '' ? 'not set' : $prod,
                  'This is the URL the flip switches TO. If it is empty, still a test host, or the same as test_url, then going live changes the label and nothing else — and payments keep landing on a gateway that never settles. CBK gives you the production URL; do not guess it.', $s7);

            // The bank can only report a result to a URL it can reach, and
            // KNET requires https. A callback still pointing at localhost or
            // http is a payment that is taken and never recorded.
            foreach (['response_url' => 'where the bank reports success',
                      'error_url'    => 'where it reports failure',
                      'result_page_url' => 'where the customer lands afterwards'] as $k => $why) {
                $u = (string) ($c[$k] ?? '');
                $okUrl = str_starts_with($u, 'https://') && stripos($u, 'localhost') === false;
                check($okUrl ? 'ok' : 'bad', "knet: $k", $u === '' ? 'not set' : $u,
                      "$why. It must be a public https:// URL on your own domain, and the response and error URLs must be the ones REGISTERED WITH CBK — the bank posts to what it has on file, not to what is in this file.", $s7);
            }

            // The audit trail. A payment system whose log cannot be written
            // cannot be reconciled, and a dispute is then the customer's word
            // against nothing.
            $logf = (string) ($c['log_file'] ?? '');
            if ($logf === '') {
                check('warn', 'knet: log_file', 'disabled',
                      'No payment audit trail. Disputes and reconciliation have nothing to go on.', $s7);
            } else {
                $dir = dirname($logf);
                $writable = (is_file($logf) && is_writable($logf)) || (!is_file($logf) && is_writable($dir));
                $above = !str_starts_with(realpath($dir) ?: $dir, realpath($root) ?: $root);
                check($writable ? 'ok' : 'bad', 'knet: log_file writable', $logf,
                      'PHP cannot write the payment log. Check the folder exists and its permissions.', $s7);
                check($above ? 'ok' : 'bad', 'knet: log_file is above public_html',
                      $above ? 'yes' : 'NO — it is inside the web root',
                      'A payment log inside public_html is downloadable over HTTP. Move it one directory up, as config.example.php has it.', $s7);
            }
        }

        // And finally the switch itself.
        check($live ? 'ok' : 'warn', "$rel: env", $env === '' ? 'not set' : $env,
              $live
                ? ''
                : "Everything above is what has to be right BEFORE this changes. When they are all green, CBK has confirmed the account is live, and you have put one test order through: change env to 'production' in $rel. Then make one real purchase with a real card and refund it.",
              $s7);
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
