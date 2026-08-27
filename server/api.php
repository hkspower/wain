<?php
/* ══════════════════════════════════════════════════════════════════════════
   وين — REST API over SQLite (v3)

   A rewrite of the api.php living in wainkw.com's public_html. The original
   is not in this repository at all, which is half of why it drifted: the only
   copy was on the server, so nothing reviewed it and nothing tested it.

   ── What was wrong ────────────────────────────────────────────────────────

   Five actions took no authentication of any kind — get, set, del, list and
   event — while the database behind them holds orders:, rsvp:, inv:, queue:,
   menu:, ask:, vm:, vmi: and a visitor-IP log. So:

     list?p=orders:   enumerated every order key, to anyone
     get?k=…          read any of them, to anyone
     set  {k,v}       overwrote any key, to anyone — including an existing order
     del?k=…          deleted any key, to anyone, over GET

   `del` over GET is the one that could go off by itself: a crawler, a link
   preview or a prefetch following such a URL deletes data without a human
   ever clicking. Destructive verbs must not be reachable by navigation.

   And `Access-Control-Allow-Origin: *` meant any website on the internet
   could do all of the above from a visitor's browser.

   ── What this does instead ────────────────────────────────────────────────

   The shape of every response is unchanged, and the actions the public app
   needs still work without a token. What changes is who may do what:

     get     public   unchanged — but you must know the exact key
     set     public   CREATE only. Overwriting an existing key needs the token
     event   public   unchanged, minus the raw IP
     list    ADMIN    was public. This is what made enumeration possible
     del     ADMIN    was public, and was reachable over GET
     stats bulk search export import purge   ADMIN, as before

   Anything that relied on public list, public del, or public overwrite will
   stop working. That is the point, but it is a breaking change and belongs in
   the deploy note, not in a surprise.

   ── The token ─────────────────────────────────────────────────────────────

   Two changes. It is read from OUTSIDE the document root, so it can never be
   fetched over HTTP whatever .htaccess says; and it no longer bootstraps
   itself from whatever the next caller happens to present, which turned
   "delete one file" into "become admin".

   See server/README.md for how to set it the first time.
   ══════════════════════════════════════════════════════════════════════════ */

declare(strict_types=1);

$__t0  = microtime(true);
$__rid = substr(bin2hex(random_bytes(4)), 0, 8);

/* ── configuration ─────────────────────────────────────────────────────── */

/** Origins allowed to call this from a browser. Not "*": with a wildcard, any
 *  page anywhere could drive this API using a visitor's connection. */
const ALLOWED_ORIGINS = [
  'https://www.wainkw.com',
  'https://wainkw.com',
];

/** The token file, one level ABOVE public_html. Not reachable over HTTP at
 *  any URL, so this no longer depends on an .htaccess rule being right. */
const TOKEN_FILE = __DIR__ . '/../wain-admin.token';

/** Where the public may create keys without a token. Everything else — the
 *  catalogue, the indexes — is the shop's data and needs the token. */
const PUBLIC_WRITE_PREFIXES = ['orders:', 'rsvp:', 'inv:', 'queue:', 'ask:', 'vm:', 'vmi:'];

const MAX_VAL   = 2000000;   // 2MB — voice notes and larger payloads
const KEY_RE    = '/^[\w:\-\.\x{0600}-\x{06FF}]{1,200}$/u';
const RATE_ALL  = 400;       // requests per minute per IP, any action
const RATE_WRITE = 60;       // of which at most this many may write

/* ── response plumbing ─────────────────────────────────────────────────── */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Wain-Request: ' . $__rid);
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow');
header('Vary: Origin');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
  if (!in_array($origin, ALLOWED_ORIGINS, true)) {
    // A cross-origin caller gets no CORS header, so the browser drops the
    // reply. Answered rather than blocked, because a curl user is not a
    // browser and blocking them buys nothing.
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'origin', 'code' => 403], JSON_UNESCAPED_UNICODE);
    exit;
  }
  header('Access-Control-Allow-Origin: ' . $origin);
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type, X-Wain-Admin');
  header('Access-Control-Max-Age: 600');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

function out($d, int $code = 200): void {
  global $__t0, $__rid;
  http_response_code($code);
  if (is_array($d)) {
    $d['t']   = time();
    $d['ms']  = (int) round((microtime(true) - $__t0) * 1000);
    $d['rid'] = $__rid;
  }
  echo json_encode($d, JSON_UNESCAPED_UNICODE);
  exit;
}

const HINTS = [
  'key'                => 'المفتاح: حروف/أرقام/عربي و : - . _ حتى ٢٠٠',
  'value-type'         => 'القيمة لازم تكون نصاً (String)',
  'too-large'          => 'الحد ٢MB للقيمة',
  'rate-limited'       => '٤٠٠ طلب/دقيقة — انتظر ثم أعد',
  'write-rate-limited' => '٦٠ كتابة/دقيقة — انتظر ثم أعد',
  'token-short (24+)'  => 'أرسل X-Wain-Admin بطول ٢٤+ حرف',
  'token-invalid'      => 'التوكن لا يطابق المعتمد',
  'token-unset'        => 'ما فيه توكن معتمد على السيرفر — شوف server/README.md',
  'not-found'          => 'المفتاح غير موجود',
  'unknown-action'     => 'شوف ?a=help للعقد الكامل',
  'prefix-not-allowed' => 'التنظيف مسموح لـ inv:/rsvp:/vm:/vmi:/orders:/events: فقط',
  'prefix-forbidden'   => 'الكتابة العامة مسموحة لـ orders:/rsvp:/inv:/queue:/ask:/vm:/vmi: فقط',
  'exists'             => 'المفتاح موجود — التعديل يحتاج توكن',
  'method'             => 'هذا الإجراء يحتاج POST',
  'body'               => 'أرسل JSON بجسم POST',
  'ops'                => 'bulk يحتاج ops مصفوفة ١-٥٠ عملية',
  'origin'             => 'النداء من نطاق غير مسموح',
];
function bad(string $m, int $code = 400): void {
  $e = ['ok' => false, 'error' => $m, 'code' => $code];
  if (isset(HINTS[$m])) $e['hint'] = HINTS[$m];
  out($e, $code);
}

/* ── database ──────────────────────────────────────────────────────────── */

try {
  $db = new SQLite3(__DIR__ . '/wain.db');
  $db->busyTimeout(3000);
  $db->exec('PRAGMA journal_mode=WAL');
  $db->exec('PRAGMA synchronous=NORMAL');
  $db->exec('PRAGMA busy_timeout=3000');
  $db->exec('PRAGMA cache_size=-8000');
  $db->exec('CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL,
    updated INTEGER NOT NULL
  )');
  $db->exec('CREATE INDEX IF NOT EXISTS idx_kv_updated ON kv(updated)');
  $db->exec('CREATE TABLE IF NOT EXISTS rate (ip TEXT, m INTEGER, n INTEGER, w INTEGER DEFAULT 0, PRIMARY KEY(ip,m))');
  // The column is new in v3; adding it to an existing table is a no-op error.
  @$db->exec('ALTER TABLE rate ADD COLUMN w INTEGER DEFAULT 0');
} catch (Throwable $e) { bad('db', 500); }

/* ── who is calling ────────────────────────────────────────────────────── */

$ip = substr($_SERVER['REMOTE_ADDR'] ?? '?', 0, 45);
$m  = intdiv(time(), 60);

$st = $db->prepare('INSERT INTO rate (ip,m,n,w) VALUES (:i,:m,1,0)
                    ON CONFLICT(ip,m) DO UPDATE SET n = n + 1');
$st->bindValue(':i', $ip, SQLITE3_TEXT);
$st->bindValue(':m', $m, SQLITE3_INTEGER);
$st->execute();

$st = $db->prepare('SELECT n, w FROM rate WHERE ip = :i AND m = :m');
$st->bindValue(':i', $ip, SQLITE3_TEXT);
$st->bindValue(':m', $m, SQLITE3_INTEGER);
$row = $st->execute()->fetchArray(SQLITE3_ASSOC) ?: ['n' => 0, 'w' => 0];
if ((int) $row['n'] > RATE_ALL) { header('Retry-After: 30'); bad('rate-limited', 429); }
if (random_int(0, 200) === 0) $db->exec('DELETE FROM rate WHERE m < ' . ($m - 5));

/** Count a write against the tighter budget. Reads are cheap; writes are how
 *  the database gets filled with rubbish. */
function chargeWrite(SQLite3 $db, string $ip, int $m, int $already): void {
  if ($already >= RATE_WRITE) { header('Retry-After: 30'); bad('write-rate-limited', 429); }
  $st = $db->prepare('UPDATE rate SET w = w + 1 WHERE ip = :i AND m = :m');
  $st->bindValue(':i', $ip, SQLITE3_TEXT);
  $st->bindValue(':m', $m, SQLITE3_INTEGER);
  $st->execute();
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$a      = $_GET['a'] ?? '';
$body   = null;
if ($method === 'POST') {
  $raw  = file_get_contents('php://input', false, null, 0, MAX_VAL + 4096);
  $body = json_decode($raw, true);
  if ($body === null && strlen($raw) > MAX_VAL) bad('too-large', 413);
  if (is_array($body) && isset($body['a'])) $a = $body['a'];
}

/**
 * Is this caller an admin?
 *
 * Never bootstraps. The previous version wrote a hash of whatever token the
 * next caller presented if the file happened to be missing, which meant
 * deleting one file was enough to become admin. Now an absent token file
 * disables admin actions and says so.
 */
function isAdmin(?array $body): bool {
  $given = $_SERVER['HTTP_X_WAIN_ADMIN'] ?? ($_GET['token'] ?? ($body['token'] ?? ''));
  $given = trim((string) $given);
  if ($given === '') return false;
  if (!is_readable(TOKEN_FILE)) return false;
  $hash = trim((string) file_get_contents(TOKEN_FILE));
  if ($hash === '') return false;
  return password_verify($given, $hash);
}

/** Admin or stop, with the reason spelled out. */
function requireAdmin(?array $body): void {
  $given = trim((string) ($_SERVER['HTTP_X_WAIN_ADMIN'] ?? ($_GET['token'] ?? ($body['token'] ?? ''))));
  if (!is_readable(TOKEN_FILE)) bad('token-unset', 503);
  if (strlen($given) < 24) bad('token-short (24+)', 401);
  if (!isAdmin($body)) { usleep(300000); bad('token-invalid', 401); }
}

function publicMayWrite(string $k): bool {
  foreach (PUBLIC_WRITE_PREFIXES as $p) {
    if (strncmp($k, $p, strlen($p)) === 0) return true;
  }
  return false;
}

/* ── actions ───────────────────────────────────────────────────────────── */

switch ($a) {

  case 'ping':
    out(['ok' => true, 'wain' => 'api', 'v' => 3,
         'actions' => ['ping','get','set','del','list','stats','bulk','search','export','import','purge','event','help']]);

  case 'help':
    out(['ok' => true, 'v' => 3, 'contract' => [
      'عام (بدون توكن)' => [
        'ping',
        'get?k= — لازم تعرف المفتاح بالضبط',
        'set {k,v} — إنشاء فقط، والتعديل يحتاج توكن',
        'event {type,data}',
      ],
      'أدمن (X-Wain-Admin)' => [
        'list?p= — كان عاماً، وهو اللي سمح بسحب كل المفاتيح',
        'del {k} — كان عاماً وعبر GET',
        'stats', 'bulk {ops}', 'search?p=&q=', 'export', 'import {data}', 'purge {p,days}',
      ],
      'ملاحظة' => 'الكتابة والحذف تحتاج POST. التوكن يُقرأ من خارج public_html.',
    ]]);

  /* ── public ──────────────────────────────────────────────────────────── */

  case 'get': {
    $k = $_GET['k'] ?? ($body['k'] ?? '');
    if (!preg_match(KEY_RE, (string) $k)) bad('key');
    $st = $db->prepare('SELECT v FROM kv WHERE k = :k');
    $st->bindValue(':k', $k, SQLITE3_TEXT);
    $r = $st->execute()->fetchArray(SQLITE3_ASSOC);
    if (!$r) bad('not-found', 404);
    out(['ok' => true, 'key' => $k, 'value' => $r['v']]);
  }

  case 'set': {
    // POST only. A write reachable over GET can be triggered by a crawler, a
    // prefetch or a link preview, with no human involved.
    if ($method !== 'POST') bad('method', 405);
    if (!is_array($body)) bad('body');
    $k = (string) ($body['k'] ?? '');
    $v = $body['v'] ?? null;
    if (!preg_match(KEY_RE, $k)) bad('key');
    if (!is_string($v)) bad('value-type');
    if (strlen($v) > MAX_VAL) bad('too-large', 413);

    $admin = isAdmin($body);
    if (!$admin) {
      if (!publicMayWrite($k)) bad('prefix-forbidden', 403);
      // Create-only for the public. Upsert let anybody rewrite an order that
      // already existed — change its total, its status, whose it was.
      $st = $db->prepare('SELECT 1 FROM kv WHERE k = :k');
      $st->bindValue(':k', $k, SQLITE3_TEXT);
      if ($st->execute()->fetchArray(SQLITE3_ASSOC)) bad('exists', 409);
      chargeWrite($db, $ip, $m, (int) $row['w']);
    }

    $st = $db->prepare('INSERT INTO kv (k, v, updated) VALUES (:k, :v, :t)
                        ON CONFLICT(k) DO UPDATE SET v = :v, updated = :t');
    $st->bindValue(':k', $k, SQLITE3_TEXT);
    $st->bindValue(':v', $v, SQLITE3_TEXT);
    $st->bindValue(':t', time(), SQLITE3_INTEGER);
    $st->execute();
    out(['ok' => true, 'key' => $k]);
  }

  case 'event': {
    if ($method !== 'POST') bad('method', 405);
    if (!is_array($body)) bad('body');
    chargeWrite($db, $ip, $m, (int) $row['w']);
    $type = substr((string) ($body['type'] ?? 'log'), 0, 40);

    // The old log stored the caller's raw IP on every entry, in a row any
    // visitor could read back. The site's privacy page promises nothing is
    // collected; a per-visitor IP list contradicts it, and it was readable by
    // the same open API. A salted, truncated hash still tells you "same
    // visitor or not" without being an address.
    $salt = hash_file('sha256', __FILE__);
    $who  = substr(hash_hmac('sha256', $ip, $salt), 0, 12);

    $st = $db->prepare('SELECT v FROM kv WHERE k = :k');
    $st->bindValue(':k', 'events:log', SQLITE3_TEXT);
    $r = $st->execute()->fetchArray(SQLITE3_ASSOC);
    $log = $r ? (json_decode($r['v'], true) ?: []) : [];
    $log[] = ['t' => time(), 'type' => $type, 'who' => $who,
              'data' => is_array($body['data'] ?? null) ? array_slice($body['data'], 0, 20) : null];
    $log = array_slice($log, -200);

    $st = $db->prepare('INSERT INTO kv (k,v,updated) VALUES (:k,:v,:t)
                        ON CONFLICT(k) DO UPDATE SET v=:v, updated=:t');
    $st->bindValue(':k', 'events:log', SQLITE3_TEXT);
    $st->bindValue(':v', json_encode($log, JSON_UNESCAPED_UNICODE), SQLITE3_TEXT);
    $st->bindValue(':t', time(), SQLITE3_INTEGER);
    $st->execute();
    out(['ok' => true, 'logged' => $type, 'n' => count($log)]);
  }

  /* ── admin ───────────────────────────────────────────────────────────── */

  case 'list': {
    // Was public. `list?p=orders:` returned up to a thousand order keys to
    // anyone who asked, and `get` did the rest.
    requireAdmin($body);
    $p = $_GET['p'] ?? ($body['p'] ?? '');
    if ($p !== '' && !preg_match(KEY_RE, (string) $p)) bad('prefix');
    $st = $db->prepare("SELECT k FROM kv WHERE k LIKE :p ESCAPE '\\' ORDER BY updated DESC LIMIT 1000");
    $st->bindValue(':p', str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string) $p) . '%', SQLITE3_TEXT);
    $res = $st->execute();
    $keys = [];
    while ($r = $res->fetchArray(SQLITE3_ASSOC)) $keys[] = $r['k'];
    out(['ok' => true, 'keys' => $keys]);
  }

  case 'del': {
    // Was public, and was reachable over GET.
    if ($method !== 'POST') bad('method', 405);
    requireAdmin($body);
    $k = (string) ($body['k'] ?? '');
    if (!preg_match(KEY_RE, $k)) bad('key');
    $st = $db->prepare('DELETE FROM kv WHERE k = :k');
    $st->bindValue(':k', $k, SQLITE3_TEXT);
    $st->execute();
    out(['ok' => true, 'deleted' => $db->changes() > 0]);
  }

  case 'stats': {
    requireAdmin($body);
    $prefixes = ['bizidx','salonidx','inv:','rsvp:','orders:','queue:','menu:','ask:','vm:','vmi:','events:'];
    $counts = [];
    foreach ($prefixes as $p) {
      $st = $db->prepare("SELECT COUNT(*) c FROM kv WHERE k LIKE :p ESCAPE '\\'");
      $st->bindValue(':p', str_replace(['\\','%','_'], ['\\\\','\\%','\\_'], $p) . '%', SQLITE3_TEXT);
      $counts[$p] = (int) ($st->execute()->fetchArray(SQLITE3_ASSOC)['c'] ?? 0);
    }
    out(['ok' => true,
         'total_keys' => (int) $db->querySingle('SELECT COUNT(*) FROM kv'),
         'db_bytes'   => @filesize(__DIR__ . '/wain.db') ?: 0,
         'by_prefix'  => $counts]);
  }

  case 'bulk': {
    if ($method !== 'POST') bad('method', 405);
    requireAdmin($body);
    $ops = is_array($body['ops'] ?? null) ? array_slice($body['ops'], 0, 50) : null;
    if (!$ops) bad('ops');
    $res = [];
    $db->exec('BEGIN');
    foreach ($ops as $o) {
      $op = $o['op'] ?? '';
      $k  = (string) ($o['k'] ?? '');
      if (!preg_match(KEY_RE, $k)) { $res[] = ['k'=>$k,'ok'=>false,'error'=>'key']; continue; }
      if ($op === 'get') {
        $st = $db->prepare('SELECT v FROM kv WHERE k=:k'); $st->bindValue(':k',$k,SQLITE3_TEXT);
        $r = $st->execute()->fetchArray(SQLITE3_ASSOC);
        $res[] = $r ? ['k'=>$k,'ok'=>true,'v'=>$r['v']] : ['k'=>$k,'ok'=>false,'error'=>'not-found'];
      } elseif ($op === 'set') {
        $v = $o['v'] ?? null;
        if (!is_string($v) || strlen($v) > MAX_VAL) { $res[] = ['k'=>$k,'ok'=>false,'error'=>'value']; continue; }
        $st = $db->prepare('INSERT INTO kv (k,v,updated) VALUES (:k,:v,:t) ON CONFLICT(k) DO UPDATE SET v=:v,updated=:t');
        $st->bindValue(':k',$k,SQLITE3_TEXT); $st->bindValue(':v',$v,SQLITE3_TEXT); $st->bindValue(':t',time(),SQLITE3_INTEGER);
        $st->execute(); $res[] = ['k'=>$k,'ok'=>true];
      } elseif ($op === 'del') {
        $st = $db->prepare('DELETE FROM kv WHERE k=:k'); $st->bindValue(':k',$k,SQLITE3_TEXT); $st->execute();
        $res[] = ['k'=>$k,'ok'=>true,'deleted'=>true];
      } else {
        $res[] = ['k'=>$k,'ok'=>false,'error'=>'op'];
      }
    }
    $db->exec('COMMIT');
    out(['ok' => true, 'results' => $res]);
  }

  case 'search': {
    requireAdmin($body);
    $p = $_GET['p'] ?? ($body['p'] ?? '');
    $q = trim((string) ($_GET['q'] ?? ($body['q'] ?? '')));
    if ($q === '' || strlen($q) > 240) bad('q');
    if ($p !== '' && !preg_match(KEY_RE, (string) $p)) bad('prefix');
    $esc = function ($x) { return str_replace(['\\','%','_'], ['\\\\','\\%','\\_'], (string) $x); };
    $st = $db->prepare("SELECT k, substr(v,1,180) s FROM kv
                        WHERE k LIKE :p ESCAPE '\\' AND v LIKE :q ESCAPE '\\'
                        ORDER BY updated DESC LIMIT 100");
    $st->bindValue(':p', $esc($p) . '%', SQLITE3_TEXT);
    $st->bindValue(':q', '%' . $esc($q) . '%', SQLITE3_TEXT);
    $r = $st->execute(); $hits = [];
    while ($rowx = $r->fetchArray(SQLITE3_ASSOC)) $hits[] = ['k' => $rowx['k'], 'peek' => $rowx['s']];
    out(['ok' => true, 'q' => $q, 'hits' => $hits]);
  }

  case 'export': {
    requireAdmin($body);
    $r = $db->query('SELECT k, v, updated FROM kv ORDER BY k');
    $all = [];
    while ($rowx = $r->fetchArray(SQLITE3_ASSOC)) $all[$rowx['k']] = ['v' => $rowx['v'], 't' => $rowx['updated']];
    header('Content-Disposition: attachment; filename="wain-backup-' . date('Y-m-d-Hi') . '.json"');
    out(['ok' => true, 'exported' => count($all), 'at' => time(), 'data' => $all]);
  }

  case 'import': {
    if ($method !== 'POST') bad('method', 405);
    requireAdmin($body);
    $data = $body['data'] ?? null;
    if (!is_array($data) || count($data) > 20000) bad('data');
    $n = 0; $db->exec('BEGIN');
    foreach ($data as $k => $rowx) {
      $v = is_array($rowx) ? ($rowx['v'] ?? null) : $rowx;
      if (!preg_match(KEY_RE, (string) $k) || !is_string($v) || strlen($v) > MAX_VAL) continue;
      $st = $db->prepare('INSERT INTO kv (k,v,updated) VALUES (:k,:v,:t) ON CONFLICT(k) DO UPDATE SET v=:v,updated=:t');
      $st->bindValue(':k',(string) $k,SQLITE3_TEXT); $st->bindValue(':v',$v,SQLITE3_TEXT); $st->bindValue(':t',time(),SQLITE3_INTEGER);
      $st->execute(); $n++;
    }
    $db->exec('COMMIT');
    out(['ok' => true, 'imported' => $n]);
  }

  case 'purge': {
    if ($method !== 'POST') bad('method', 405);
    requireAdmin($body);
    $p = (string) ($body['p'] ?? '');
    $days = max(1, min(365, (int) ($body['days'] ?? 2)));
    if (!preg_match(KEY_RE, $p)) bad('prefix');
    if (!in_array($p, ['inv:','rsvp:','vm:','vmi:','orders:','events:'], true)) bad('prefix-not-allowed');
    $st = $db->prepare("DELETE FROM kv WHERE k LIKE :p ESCAPE '\\' AND updated < :c");
    $st->bindValue(':p', str_replace(['\\','%','_'], ['\\\\','\\%','\\_'], $p) . '%', SQLITE3_TEXT);
    $st->bindValue(':c', time() - $days * 86400, SQLITE3_INTEGER);
    $st->execute();
    out(['ok' => true, 'purged' => $db->changes(), 'prefix' => $p, 'older_than_days' => $days]);
  }

  default:
    bad('unknown-action', 404);
}
