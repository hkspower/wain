<?php
/**
 * صوت وين's live bridge — wain's own, on wain's own origin.
 *
 *   install:  php tts.php install
 *   serve:    POST /api/tts.php  {"persona":"shouq","text":"…"}  → audio/mpeg
 *
 * WHY THIS EXISTS RATHER THAN THE n8n WEBHOOK IT REPLACES
 *
 * The clip library covers every sentence that can be written down in advance.
 * What it cannot cover is a sentence assembled at runtime, and that is where
 * شوق stopped being herself — the browser's own Arabic voice took over, and
 * the drop from a Kuwaiti woman to a robot is the loudest thing on the page.
 *
 * The bridge for those lines was `sportake.app.n8n.cloud/webhook/fahad-tts`,
 * and it was correct in every respect except that it could not authenticate:
 * its `httpHeaderAuth` credential is empty, so ElevenLabs answered
 * «Neither authorization header nor xi-api-key received» — a 401 on every
 * call. The node itself is wired properly (`genericCredentialType` +
 * `httpHeaderAuth`, credential attached); it is the credential's own data that
 * is blank, and no tool available to a session can write credential data. So
 * the one thing standing between شوق and her voice was a field in somebody
 * else's UI.
 *
 * Four things are better here, and none of them is «avoiding n8n» for its own
 * sake:
 *
 *  1. SAME ORIGIN. `/api/tts.php` is served by the host the page came from, so
 *     there is no CORS preflight and no allowlist to keep in step with a new
 *     subdomain. staging.wainkw.com was already missing from شوق's origin
 *     allowlist once; this class of bug cannot recur here.
 *  2. NOTHING IN `npm run scan` COULD SEE THE WORKFLOW. It is not in this
 *     repository, so it drifted silently — and it did: its شوق voice id had
 *     become a different woman entirely while every other setting matched, the
 *     hardest kind of drift to notice because nothing breaks. This file is in
 *     the repository, so `npm run audit:tts` compares its voice table against
 *     gen-voice.mjs on every scan.
 *  3. IT CACHES. n8n re-rendered every request. The sentences that reach this
 *     bridge are assembled from a 52-place catalogue, so the space is small and
 *     bounded: a disk cache means the spend converges to the size of that space
 *     instead of growing with traffic.
 *  4. ONE PLACE TO PUT THE KEY, and it is where the deploy secret already
 *     lives — `<domain>/storage/`, outside the document root.
 *
 * WHAT IT IS NOT: a general text-to-speech service. It renders short Arabic
 * sentences for this site's two personas and refuses everything else, because
 * every character is charged to a subscription.
 */

declare(strict_types=1);

/* ── the voice table ────────────────────────────────────────────────────────
   COPIED FROM scripts/gen-voice.mjs, AND IT MUST STAY COPIED.

   A recorded clip and a live sentence are heard one after the other inside a
   single utterance — resolveClips() falls through to this bridge for the whole
   answer only when a part has no clip, so in practice a visitor hears both
   paths in one session and often in one breath. Any difference between them is
   audible as the speaker changing mid-sentence.

   That is not hypothetical: the n8n bridge this replaces had drifted to
   w0uhBAmNIG5kUDeaFEsA (Maryam Essa) while the repository and the live agent
   were both on rh16DBXwtscjdPFeMBYf (Talya), with every other field identical.
   Nothing broke, so nothing reported it.

   `npm run audit:tts` reads both files and fails when they disagree. Edit
   gen-voice.mjs and this goes red — which is the point, because a table that
   is merely asked to match is a table that will not. */
const VOICES = [
    'shouq' => [
        'voiceId'  => 'rh16DBXwtscjdPFeMBYf', // Talya — ar-omani, female, young
        'settings' => [
            'stability'         => 0.35,
            'similarity_boost'  => 0.8,
            'style'             => 0.45,
            'use_speaker_boost' => true,
            'speed'             => 1.06,
        ],
    ],
    'salem' => [
        'voiceId'  => 'Ywuz3KyW2N5pqKNpwcCL', // Eid — Gulf male, warm and clear
        'settings' => [
            'stability'         => 0.45,
            'similarity_boost'  => 0.8,
            'style'             => 0.3,
            'use_speaker_boost' => true,
            'speed'             => 1.0,
        ],
    ],
];

/* eleven_multilingual_v2 to match the CLIPS, deliberately not the agent's
   eleven_flash_v2_5. شوق's conversational agent is right to run flash — it is
   realtime and latency is the whole game there — but her agent voice is never
   heard spliced into a recorded line, and these sentences are. The reference
   for this file is gen-voice.mjs, not the agent. */
const MODEL  = 'eleven_multilingual_v2';
const FORMAT = 'mp3_44100_64';

/* Hosts allowed to ask. An Origin header is trivially forged, so this is not a
   security control — it is the same filter the n8n webhook applied, and it
   keeps a casual scraper from spending the subscription. The budget below is
   what actually bounds the spend. */
const ALLOWED_HOSTS = [
    'www.wainkw.com',
    'wainkw.com',
    'staging.wainkw.com',
];

/** Longest sentence rendered. The input arrives from a browser and every
 *  character is charged; the longest real line in voice-lines.ts is 90. */
const MAX_CHARS = 500;

/** Per-IP requests a minute. One utterance is one request, so a visitor never
 *  legitimately approaches this. */
const RATE_PER_MIN = 30;

/** Cache MISSES a day, across everybody. Hits are free and uncapped.
 *
 *  This is the number that bounds the bill, and it is deliberately the only
 *  one that does. Capping requests would throttle a busy day for no reason —
 *  the tenth visitor to search «قهوة» costs nothing, because the answer is
 *  already on disk. Only a sentence never rendered before reaches ElevenLabs,
 *  and the site's sentence space is bounded by 52 places, so a day that needs
 *  more than this is a day something is generating text that is not wain's. */
const DAILY_MISSES = 1500;

/* ── shared helpers ─────────────────────────────────────────────────────── */

/**
 * The account's storage directory, found by walking UP rather than by counting
 * directories down.
 *
 * `dirname(__DIR__, 2)` is correct at public_html/api and wrong at
 * public_html/staging/api — one level deeper it resolves to public_html, and
 * the endpoint would look for the key in a directory that does not exist and
 * report itself unconfigured on staging only. That exact off-by-one is written
 * up in the notes for setup-staging-endpoint.php, which had to special-case it.
 *
 * Walking up sidesteps it: both stages sit under domains/wainkw.com, so the
 * first `storage/` above either one is the right one — and the two installed
 * copies stay BYTE-IDENTICAL, which is worth more than the two saved lines.
 * One fingerprint describes both.
 */
function storageDir(): ?string {
    $dir = __DIR__;
    for ($i = 0; $i < 5; $i++) {
        $dir = dirname($dir);
        if ($dir === '' || $dir === '/' || $dir === '.') break;
        if (is_dir("$dir/storage")) return "$dir/storage";
    }
    return null;
}

/* ── install (CLI only) ─────────────────────────────────────────────────────
   Under any web SAPI this branch is unreachable, so the served copy carries an
   installer it can never run. That is the same shape as storage/d.php and it is
   what makes one file the whole story: the thing in the repository IS the thing
   on the server, so `php tts.php version` can compare them. */
if (PHP_SAPI === 'cli') {
    $home   = getenv('HOME') ?: __DIR__;
    $domain = 'wainkw.com';
    $web    = "$home/domains/$domain/public_html";

    /* Production and staging both, always. Installing one and not the other is
       how staging becomes a rehearsal of a deploy that is not the deploy. */
    $targets = [
        'production' => "$web/api/tts.php",
        'staging'    => "$web/staging/api/tts.php",
    ];
    $keyFile = "$home/domains/$domain/storage/elevenlabs.key";

    $out = static function (array $r): never {
        echo json_encode($r, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
        exit;
    };
    $print = static fn(string $f): ?string =>
        ($h = @hash_file('sha256', $f)) === false ? null : substr($h, 0, 16);

    $mode = $argv[1] ?? '';

    if ($mode === 'version') {
        $out([
            'ok'      => true,
            'running' => $print(__FILE__),
            'from'    => __FILE__,
            'installed' => array_map(static fn($p) => ['path' => $p, 'fingerprint' => $print($p)], $targets),
            'key'     => is_file($keyFile) ? 'present' : 'ABSENT',
        ]);
    }

    /* `table` — print the voice table as JSON and stop.
       The other half of `npm run audit:tts`: gen-voice.mjs --rendition prints
       the same shape, and the audit requires them to be equal. Each side is
       asked for its own values by its own interpreter, so the comparison
       survives a rename or a reformat that would defeat a regex. */
    if ($mode === 'table') {
        $out(['model' => MODEL, 'format' => FORMAT, 'voices' => VOICES]);
    }

    if ($mode !== 'install') {
        $out(['ok' => false, 'error' => 'usage',
              'usage' => ['php tts.php install', 'php tts.php version', 'php tts.php table']]);
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
        @chmod($path, 0644); // it is served by Apache, unlike storage/d.php
        $report[$stage] = ['ok' => true, 'status' => $was === null ? 'installed' : 'replaced',
                           'path' => $path, 'was' => $was, 'fingerprint' => $print($path)];
    }

    /* The key is NEVER written here. This file is fetched from a public URL to
       be run, so anything it carried would be public. It creates the empty file
       with the right permissions and says where to paste — one action, in the
       panel's file manager, with the value never passing through a transcript
       or a crontab. */
    $keyNote = 'present';
    if (!is_file($keyFile)) {
        @file_put_contents($keyFile, '');
        @chmod($keyFile, 0600);
        $keyNote = is_file($keyFile) ? 'created_empty' : 'could_not_create';
    }

    $out([
        'ok'      => true,
        'stages'  => $report,
        'key'     => ['path' => $keyFile, 'status' => $keyNote,
                      'note' => 'paste the ElevenLabs API key into this file, nothing else, no newline needed'],
        'inert_until_key_is_set' => true,
    ]);
}

/* ── serve ─────────────────────────────────────────────────────────────────*/

/**
 * Finish the render even if the listener has gone.
 *
 * voice.ts gives the bridge four seconds and then hands the sentence to the
 * browser voice — which is right, because silence is worse than the robot. But
 * a render that was abandoned at four seconds has already been PAID FOR, and
 * without this PHP is killed on the aborted connection and the bytes are
 * thrown away. Now the first visitor may hear the robot and the render still
 * lands in the cache, so the second one hears شوق. The slow case pays once.
 */
ignore_user_abort(true);

$fail = static function (int $code, string $error, array $extra = []): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['ok' => false, 'error' => $error] + $extra, JSON_UNESCAPED_SLASHES);
    exit;
};

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    $fail(405, 'method_not_allowed');
}

/* Same origin in normal use, so this is a sanity check rather than CORS.
   An absent Origin is allowed: same-origin POSTs from some browsers omit it,
   and refusing those would break the feature to enforce a header that proves
   nothing anyway. */
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

/* Unconfigured is a 503 and it is answered IMMEDIATELY, before anything else
   is parsed. voice.ts treats this one status as «stop asking for the rest of
   this page», so an uninstalled key costs one fast request per session rather
   than one per sentence. */
$key = is_file("$storage/elevenlabs.key") ? trim((string) @file_get_contents("$storage/elevenlabs.key")) : '';
if ($key === '') $fail(503, 'not_configured');

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > 8192) $fail(400, 'bad_request');
$body = json_decode($raw, true);
if (!is_array($body)) $fail(400, 'bad_json');

$persona = strtolower(trim((string) ($body['persona'] ?? 'shouq')));
if (!isset(VOICES[$persona])) $fail(400, 'unknown_persona');

/* Normalised before it is hashed AND before it is sent, so two requests that
   differ only in whitespace are one cache entry rather than two renders. */
$text = trim(preg_replace('/\s+/u', ' ', (string) ($body['text'] ?? '')) ?? '');
if ($text === '') $fail(400, 'text_required');
if (mb_strlen($text, 'UTF-8') > MAX_CHARS) $fail(400, 'text_too_long');

$voice    = VOICES[$persona];
$cacheDir = "$storage/tts";
if (!is_dir($cacheDir)) @mkdir($cacheDir, 0700, true);

/* The cache key is the clip's IDENTITY, not its text — the same fields
   gen-voice.mjs hashes, and for the same reason it added them: change the
   voice, the settings, the model or the format and every cached render is of a
   different rendition. Hashing the text alone would serve the old voice for
   ever after a change, silently, which is the exact bug that made gen-voice's
   digest cover the rendition in the first place. */
$id = hash('sha256', json_encode([
    'text'     => $text,
    'voiceId'  => $voice['voiceId'],
    'model'    => MODEL,
    'format'   => FORMAT,
    'settings' => $voice['settings'],
], JSON_UNESCAPED_UNICODE));
$cacheFile = "$cacheDir/$id.mp3";

$serve = static function (string $file, string $how): never {
    header('Content-Type: audio/mpeg');
    header('Content-Length: ' . (string) filesize($file));
    // A week, matching what .htaccess gives the recorded clips. The URL is a
    // POST so the browser will not cache it, but a CDN or proxy in front might
    // and the bytes for one id never change.
    header('Cache-Control: public, max-age=604800');
    header("X-Wain-TTS: $how");
    readfile($file);
    exit;
};

if (is_file($cacheFile) && filesize($cacheFile) >= 512) $serve($cacheFile, 'hit');

/* ── the two budgets, checked only on a miss ─────────────────────────────── */

/** A window counter in one file. Not a token bucket and not atomic across
 *  concurrent requests — approximate is the right amount of engineering for a
 *  guard whose failure mode is «rendered one sentence too many». */
$count = static function (string $file, int $window) : int {
    $now = time();
    $fh  = @fopen($file, 'c+');
    if (!$fh) return 0; // a guard that cannot open its file must not deny service
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

$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0');
if ($count("$cacheDir/.rate-" . hash('sha256', $ip) . '.json', 60) > RATE_PER_MIN) {
    $fail(429, 'rate_limited');
}
if ($count("$cacheDir/.budget.json", 86400) > DAILY_MISSES) {
    // 503 rather than 429: nothing the caller did is wrong, and voice.ts turns
    // every non-2xx into the browser voice, which is the correct degradation.
    $fail(503, 'daily_budget_spent');
}

/* ── render ────────────────────────────────────────────────────────────────*/

/**
 * Where the render is asked for.
 *
 * The env var is a TEST SEAM and nothing else — the same reason gen-voice.mjs
 * has WAIN_VOICE_DIR. tests/tts-endpoint.test.mjs points it at a stub so the
 * cache, both budgets, the length cap and every failure branch are exercised
 * on a real PHP server without spending a character of the subscription. A
 * test that had to call ElevenLabs to run is a test that gets disabled.
 *
 * Apache does not set it, so production is the default string; and anything
 * able to set an environment variable on this account can already read the key
 * sitting next to it.
 */
$apiBase = getenv('WAIN_TTS_API_BASE') ?: 'https://api.elevenlabs.io/v1/text-to-speech';
$ch = curl_init("$apiBase/" . $voice['voiceId'] . '?output_format=' . FORMAT);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json', "xi-api-key: $key"],
    CURLOPT_POSTFIELDS     => json_encode([
        'text'           => $text,
        'model_id'       => MODEL,
        'voice_settings' => $voice['settings'],
    ], JSON_UNESCAPED_UNICODE),
    CURLOPT_CONNECTTIMEOUT => 5,
    // Longer than voice.ts's four-second deadline on purpose — see
    // ignore_user_abort above. The listener has already been handed to the
    // browser voice by now; this is finishing the render for the next one.
    CURLOPT_TIMEOUT        => 20,
]);
$audio  = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$cerr   = curl_error($ch);
curl_close($ch);

if ($audio === false)   $fail(502, 'upstream_unreachable', ['detail' => $cerr]);
if ($status !== 200)    $fail(502, 'upstream_error', ['status' => $status]);
/* A short body is an error page wearing an mp3's content type, and it plays as
   silence — which a listener cannot tell from «she ignored me». voice.ts has
   the same floor on its side for the same reason. */
if (strlen($audio) < 512) $fail(502, 'upstream_empty');

/* Written through a temporary name so a request that dies mid-write cannot
   leave a truncated file that every later request then serves as a cache hit. */
$tmp = "$cacheFile.$id.part";
if (@file_put_contents($tmp, $audio) === strlen($audio)) {
    @rename($tmp, $cacheFile);
} else {
    @unlink($tmp);
}

header('Content-Type: audio/mpeg');
header('Content-Length: ' . (string) strlen($audio));
header('Cache-Control: public, max-age=604800');
header('X-Wain-TTS: miss');
echo $audio;
