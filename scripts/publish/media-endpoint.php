<?php
/**
 * Business registration's photo/logo bridge — wain's own, on wain's own
 * origin.
 *
 *   install:  php media.php install
 *   serve:    POST /api/media.php   multipart: draftId, kind, index, file
 *             → {"ok":true,"path":"<draftId>/<kind>-<index>.<ext>"}
 *
 * WHY THIS EXISTS
 *
 * src/lib/media.ts uploaded straight into Supabase Storage. Supabase is
 * unconfigured on this site — both env vars are empty, in the repo and in the
 * live build — so every upload failed at `loadSupabase()` before a byte left
 * the browser. This is the storage half of that path moved onto wain's own
 * server, the same move `/api/tts.php` already made for صوت وين's live
 * bridge and for the same first reason: same origin, no CORS allowlist to
 * keep in step with a new subdomain, and one thing in the repository instead
 * of one thing that could drift unseen.
 *
 * WHAT IT DOES NOT FIX
 *
 * `submitBusiness()` in src/lib/submissions.ts still inserts into
 * `public.submissions`, which is a Supabase table and does not exist here.
 * A file uploaded through this bridge with no submission ever recorded is an
 * orphan — `prune` below exists because of that, not despite it. Wiring the
 * two together needs a submissions endpoint this file does not attempt to
 * be. Until then this replaces ONE failure ("رفع الصور مو متاح حالياً",
 * before a byte was sent) with a LATER one ("التسجيل مو متاح حالياً", after
 * the photos already landed here) — worse for disk usage, not worse for the
 * visitor, who was already being told registration does not work either way.
 *
 * WHAT MAKES AN UNAUTHENTICATED UPLOAD ENDPOINT SAFE ENOUGH TO SHIP
 *
 *  1. Content is sniffed, never trusted. `getimagesize()` on the bytes decides
 *     what a file IS; the client's declared type and the filename's extension
 *     decide nothing about what gets written to disk.
 *  2. Nothing lands in public_html. storage/business-pending/ sits beside
 *     storage/tts and storage/deploy.secret, outside the document root — the
 *     same privacy property Supabase's private bucket had, for the same
 *     reason: an unreviewed photo of someone's shop is not public because its
 *     path is hard to guess.
 *  3. Two independent caps, not one. RATE_PER_MIN bounds one visitor hammering
 *     the endpoint; MAX_TOTAL_BYTES bounds the account's disk filling up from
 *     many visitors doing it legitimately slowly, which a per-IP limit alone
 *     never catches.
 *  4. `prune` is a CLI mode, not a background thread a PHP request can start.
 *     It is meant to be cron'd, the same fetch-pin-run shape every write path
 *     on this account already uses — see docs/hosting.md.
 */

declare(strict_types=1);

/** Matches src/lib/media.ts's MAX_BYTES. `npm run audit:media` fails when
 *  they disagree, by asking each side for its own number — see
 *  scripts/audit-media.mjs for why a regex over either file is not enough. */
const MAX_BYTES = 12 * 1024 * 1024;

/** Matches src/lib/media.ts's MAX_PHOTOS — the highest photo index accepted
 *  is MAX_PHOTOS - 1; logo is always index 0. */
const MAX_PHOTOS = 12;

/** Detected MIME → the only extensions this endpoint will ever write. Keyed
 *  on what getimagesize() reports, never on the client's Content-Type or the
 *  original filename. */
const ALLOWED_TYPES = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/webp' => 'webp',
];

/** Same filter /api/tts.php applies, and the same caveat: an Origin header is
 *  trivially forged, so this is not the security control — the content
 *  sniff and the storage location above are. */
const ALLOWED_HOSTS = [
    'www.wainkw.com',
    'wainkw.com',
    'staging.wainkw.com',
];

/** Per-IP uploads a minute. A real submission sends at most 13 requests
 *  (one logo, twelve photos) in the seconds after the form is validated;
 *  this is headroom over that, not a throttle on normal use. */
const RATE_PER_MIN = 40;

/** Total bytes storage/business-pending/ may hold before new uploads are
 *  refused. Nothing prunes automatically — see `prune` below — so this is
 *  the backstop between "nobody has run prune in a while" and "the account
 *  is out of disk". 2GB at MAX_BYTES each is room for dozens of full
 *  submissions still waiting on a review flow that does not exist yet. */
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

/** A pending draft older than this was abandoned — the form was never
 *  finished, or was finished before this bridge existed and can never be
 *  finished now. `prune` deletes it. Chosen generously: a real reviewer
 *  should see a submission in days, not weeks, but nothing here enforces
 *  that half of the bargain yet. */
const PRUNE_AFTER_DAYS = 14;

/* ── shared helpers ─────────────────────────────────────────────────────── */

/** See tts-endpoint.php's identical function for why this walks UP rather
 *  than counting down — the two installed copies (production, staging) stay
 *  byte-identical either way, and only this walk survives the staging depth
 *  being one level deeper. */
function storageDir(): ?string {
    $dir = __DIR__;
    for ($i = 0; $i < 5; $i++) {
        $dir = dirname($dir);
        if ($dir === '' || $dir === '/' || $dir === '.') break;
        if (is_dir("$dir/storage")) return "$dir/storage";
    }
    return null;
}

function dirSize(string $dir): int {
    if (!is_dir($dir)) return 0;
    $total = 0;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($it as $f) { if ($f->isFile()) $total += $f->getSize(); }
    return $total;
}

/* ── install / version / limits / prune (CLI only) ──────────────────────── */
if (PHP_SAPI === 'cli') {
    $home   = getenv('HOME') ?: __DIR__;
    $domain = 'wainkw.com';
    $web    = "$home/domains/$domain/public_html";

    $targets = [
        'production' => "$web/api/media.php",
        'staging'    => "$web/staging/api/media.php",
    ];

    /* storageDir() finds the REAL storage/ when this file runs from an
       installed copy (public_html/api/media.php or .../staging/api/media.php)
       — the same walk `serve` uses below, so `prune` always operates on
       exactly the directory `serve` writes to, at either stage's depth. Only
       the repository's own copy has no storage/ sibling to find, which is
       when `install` needs the HOME/domain shape — it is writing INTO that
       shape, not reading an existing one. */
    $storageGuess = storageDir() ?? "$home/domains/$domain/storage";
    $adminKeyFile = "$storageGuess/media-admin.key";
    $pendingDir   = "$storageGuess/business-pending";

    $out = static function (array $r): never {
        echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
        exit;
    };
    $print = static fn(string $f): ?string =>
        ($h = @hash_file('sha256', $f)) === false ? null : substr($h, 0, 16);

    $mode = $argv[1] ?? '';

    if ($mode === 'limits') {
        $out(['maxBytes' => MAX_BYTES, 'maxPhotos' => MAX_PHOTOS,
              'allowedTypes' => array_keys(ALLOWED_TYPES)]);
    }

    if ($mode === 'version') {
        $postMax   = ini_get('post_max_size') ?: '?';
        $uploadMax = ini_get('upload_max_filesize') ?: '?';
        $out([
            'ok'      => true,
            'running' => $print(__FILE__),
            'from'    => __FILE__,
            'installed' => array_map(static fn($p) => ['path' => $p, 'fingerprint' => $print($p)], $targets),
            'adminKey' => is_file($adminKeyFile) ? 'present' : 'ABSENT',
            'phpIni'  => [
                'post_max_size' => $postMax,
                'upload_max_filesize' => $uploadMax,
                'maxBytesInIniUnits' => (string) (MAX_BYTES / (1024 * 1024)) . 'M',
                'note' => 'both ini values must be >= maxBytesInIniUnits or an upload near MAX_BYTES fails as file_too_large before this file ever sees it',
            ],
        ]);
    }

    if ($mode === 'prune') {
        $dry = in_array('--dry-run', $argv, true);
        if (!is_dir($pendingDir)) $out(['ok' => true, 'removed' => [], 'note' => 'no pending dir yet']);
        $cutoff = time() - PRUNE_AFTER_DAYS * 86400;
        $removed = [];
        foreach (scandir($pendingDir) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $path = "$pendingDir/$entry";
            if (!is_dir($path)) continue;
            if ((filemtime($path) ?: 0) >= $cutoff) continue;
            $removed[] = $entry;
            if (!$dry) {
                $it = new RecursiveIteratorIterator(
                    new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
                    RecursiveIteratorIterator::CHILD_FIRST
                );
                foreach ($it as $f) { $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname()); }
                @rmdir($path);
            }
        }
        $out(['ok' => true, 'dryRun' => $dry, 'removed' => $removed, 'cutoffDays' => PRUNE_AFTER_DAYS]);
    }

    if ($mode !== 'install') {
        $out(['ok' => false, 'error' => 'usage',
              'usage' => ['php media.php install', 'php media.php version',
                          'php media.php limits', 'php media.php prune [--dry-run]']]);
    }

    $report = [];
    foreach ($targets as $stage => $path) {
        $dir = dirname($path);
        if (!is_dir($dir)) {
            $report[$stage] = ['ok' => false, 'error' => 'no_api_dir', 'path' => $dir];
            continue;
        }
        $was = $print($path);
        if (!@copy(__FILE__, $path)) {
            $report[$stage] = ['ok' => false, 'error' => 'copy_failed', 'path' => $path];
            continue;
        }
        @chmod($path, 0644);
        $report[$stage] = ['ok' => true, 'status' => $was === null ? 'installed' : 'replaced',
                           'path' => $path, 'was' => $was, 'fingerprint' => $print($path)];
    }

    /* The admin key is never written here, same reasoning as elevenlabs.key:
       this file is fetched from a public URL to be run, so anything it
       carried at that moment would be public. */
    $keyNote = 'present';
    if (!is_file($adminKeyFile)) {
        @mkdir(dirname($adminKeyFile), 0700, true);
        @file_put_contents($adminKeyFile, '');
        @chmod($adminKeyFile, 0600);
        $keyNote = is_file($adminKeyFile) ? 'created_empty' : 'could_not_create';
    }
    if (!is_dir($pendingDir)) @mkdir($pendingDir, 0700, true);

    $out([
        'ok'     => true,
        'stages' => $report,
        'adminKey' => ['path' => $adminKeyFile, 'status' => $keyNote,
                       'note' => 'paste a random secret into this file to enable ?action=view; leave empty to leave it refused'],
        'pendingDir' => $pendingDir,
    ]);
}

/* ── serve ─────────────────────────────────────────────────────────────────*/

$fail = static function (int $code, string $error, array $extra = []): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => false, 'error' => $error] + $extra, JSON_UNESCAPED_SLASHES);
    exit;
};

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $host = parse_url($origin, PHP_URL_HOST);
    if (!is_string($host) || !in_array(strtolower($host), ALLOWED_HOSTS, true)) {
        $fail(403, 'origin_not_allowed');
    }
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
}

$storage = storageDir();
if ($storage === null) $fail(500, 'no_storage_dir');
$pendingDir = "$storage/business-pending";
if (!is_dir($pendingDir)) @mkdir($pendingDir, 0700, true);

/** A window counter in one file — identical shape to /api/tts.php's, kept
 *  duplicated rather than shared: the two endpoints have no other reason to
 *  import from each other, and one file each is what stays copy-installable
 *  by itself. */
$count = static function (string $file, int $window): int {
    $now = time();
    $fh  = @fopen($file, 'c+');
    if (!$fh) return 0;
    @flock($fh, LOCK_EX);
    $data = json_decode((string) stream_get_contents($fh), true);
    $n = (is_array($data) && ($data['start'] ?? 0) > $now - $window) ? (int) ($data['n'] ?? 0) : 0;
    $start = (is_array($data) && ($data['start'] ?? 0) > $now - $window) ? (int) $data['start'] : $now;
    $n++;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode(['start' => $start, 'n' => $n]));
    @flock($fh, LOCK_UN);
    fclose($fh);
    return $n;
};

/* ── GET: an admin looking at a pending file ────────────────────────────── */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    if (($_GET['action'] ?? '') !== 'view') $fail(400, 'unknown_action');

    $key = is_file("$storage/media-admin.key") ? trim((string) @file_get_contents("$storage/media-admin.key")) : '';
    if ($key === '') $fail(503, 'not_configured');
    $given = $_SERVER['HTTP_X_MEDIA_KEY'] ?? '';
    if (!is_string($given) || !hash_equals($key, $given)) $fail(403, 'bad_key');

    $draftId = (string) ($_GET['draftId'] ?? '');
    $kind    = (string) ($_GET['kind'] ?? '');
    $index   = (string) ($_GET['index'] ?? '0');
    if (!preg_match('/^[A-Za-z0-9-]{6,64}$/', $draftId)) $fail(400, 'bad_draft_id');
    if (!in_array($kind, ['logo', 'photo'], true)) $fail(400, 'bad_kind');
    if (!preg_match('/^\d{1,2}$/', $index) || (int) $index >= MAX_PHOTOS) $fail(400, 'bad_index');

    $dir = "$pendingDir/$draftId";
    $found = null;
    foreach (ALLOWED_TYPES as $ext) {
        $candidate = "$dir/$kind-$index.$ext";
        if (is_file($candidate)) { $found = $candidate; break; }
    }
    if ($found === null) $fail(404, 'not_found');

    $mime = @mime_content_type($found) ?: 'application/octet-stream';
    header("Content-Type: $mime");
    header('Content-Length: ' . (string) filesize($found));
    header('Cache-Control: private, no-store');
    readfile($found);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: GET, POST');
    $fail(405, 'method_not_allowed');
}

/* PHP empties $_POST and $_FILES ENTIRELY, with no per-field error, when the
   whole request body exceeds `post_max_size` — before a single line here
   runs. Caught late, that reads as `bad_draft_id`, because draftId is
   checked first and is now ''. This is the classic way to detect it: a POST
   with a body but nothing parsed out of it. Checked before the rate limit
   too, since a request this large should not spend an attempt against a cap
   meant for legitimate calls.
   This is a REAL ceiling, not just a test artifact — if the live host's
   php.ini caps post_max_size or upload_max_filesize below MAX_BYTES, every
   upload between that cap and MAX_BYTES fails exactly this way in
   production. `php media.php version` reports both ini values for that
   reason; they must be raised to at least MAX_BYTES (plus a small margin for
   the other form fields) for the promise this file makes to be true. */
if (empty($_POST) && empty($_FILES) && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    $fail(413, 'file_too_large');
}

$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0');
if ($count("$pendingDir/.rate-" . hash('sha256', $ip) . '.json', 60) > RATE_PER_MIN) {
    $fail(429, 'rate_limited');
}

$draftId = (string) ($_POST['draftId'] ?? '');
$kind    = (string) ($_POST['kind'] ?? '');
$index   = (string) ($_POST['index'] ?? '0');

/* Opaque id only — no dot, no slash, nothing a path can be built from beyond
   this exact charset. Both newDraftId() shapes in media.ts (a UUID, and the
   older-Safari fallback) match this comfortably. */
if (!preg_match('/^[A-Za-z0-9-]{6,64}$/', $draftId)) $fail(400, 'bad_draft_id');
if (!in_array($kind, ['logo', 'photo'], true)) $fail(400, 'bad_kind');
if (!preg_match('/^\d{1,2}$/', $index) || (int) $index >= MAX_PHOTOS) $fail(400, 'bad_index');
$index = (int) $index;

if (!isset($_FILES['file']) || !is_array($_FILES['file'])) $fail(400, 'file_required');
$upload = $_FILES['file'];
if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_INI_SIZE
    || ($upload['error'] ?? 0) === UPLOAD_ERR_FORM_SIZE) $fail(413, 'file_too_large');
if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) $fail(400, 'upload_failed');
$tmpPath = (string) $upload['tmp_name'];
if (!is_uploaded_file($tmpPath)) $fail(400, 'upload_failed');

$size = (int) ($upload['size'] ?? 0);
if ($size <= 0) $fail(400, 'file_empty');
if ($size > MAX_BYTES) $fail(413, 'file_too_large');

/* The content decides the type, never the client's Content-Type and never
   the filename. getimagesize() both validates the bytes are a real,
   decodable image AND reports which kind — one call does both jobs, and a
   file that fails it is not an image whatever it claims to be. */
$info = @getimagesize($tmpPath);
if ($info === false) $fail(400, 'bad_type');
$mime = (string) ($info['mime'] ?? '');
if (!isset(ALLOWED_TYPES[$mime])) $fail(400, 'bad_type');
$ext = ALLOWED_TYPES[$mime];

/* getenv() override is a TEST SEAM only, the same shape WAIN_TTS_API_BASE is
   on the other endpoint: proving the 507 path for real means filling the
   quota, and nobody should write 2GB to a temp directory to run a test suite.
   Apache never sets this, so production always sees the real 2GB. */
$maxTotal = (int) (getenv('WAIN_MEDIA_MAX_TOTAL_BYTES') ?: MAX_TOTAL_BYTES);
if (dirSize($pendingDir) + $size > $maxTotal) $fail(507, 'quota_exceeded');

$draftDir = "$pendingDir/$draftId";
if (!is_dir($draftDir) && !@mkdir($draftDir, 0700, true) && !is_dir($draftDir)) {
    $fail(500, 'write_failed');
}

$target = "$draftDir/$kind-$index.$ext";
$tmp = "$target.part";
if (!@move_uploaded_file($tmpPath, $tmp)) $fail(500, 'write_failed');
if (!@rename($tmp, $target)) { @unlink($tmp); $fail(500, 'write_failed'); }
@touch($draftDir); // keeps the draft's mtime current, so `prune` measures
                    // time since the LAST file in it, not the first.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode(['ok' => true, 'path' => "$draftId/$kind-$index.$ext"], JSON_UNESCAPED_SLASHES);
