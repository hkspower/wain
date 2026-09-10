<?php
/**
 * Which of the shop's scheduled jobs can actually do anything.
 *
 *   php /home/<user>/live-cron-check.php
 *
 * READ-ONLY. It reads api/config.php and reports, per job, whether the keys
 * that job needs are present. It writes nothing, changes nothing, and — the
 * part that matters — NEVER PRINTS A VALUE. Only "set" or "MISSING", because
 * this file is fetched over plain HTTP from a public repository by a cron job,
 * and config.php holds the database password, the cron key and the WhatsApp
 * token. A diagnostic that leaks what it is diagnosing is worse than no
 * diagnostic.
 *
 * WHY IT EXISTS. Measured on 2026-09-09, four of the eight live jobs were
 * returning an error on EVERY run and had been for as long as they have
 * existed:
 *
 *   cron-push        every minute   vapid_public/vapid_private are not set
 *   cron-whatsapp    every 2 min    whatsapp_token/phone_number_id are not set
 *   cron-assistant   every 5 min    n8n_webhook is not set
 *   cron-fulfilment  every 10 min   warehouse_email is not set
 *
 * That is roughly 2,400 PHP processes a day, on shared hosting, producing the
 * same error. None of it is visible: the jobs' own output is only readable one
 * at a time through the hosting panel, and nothing reads it. The failure is
 * loud and unheard, which is the same shape as the seven jobs that died on DNS
 * for months while the panel looked healthy.
 *
 * IT DOES NOT SAY THE JOBS ARE BROKEN. A job whose credentials are absent is
 * correctly refusing to run: it is waiting for the owner to add them. What this
 * turns into a fact is WHICH ones are waiting and on WHAT, so the answer is a
 * list of keys rather than an afternoon reading cron logs.
 *
 * ONE LINE, because cron returns only the last one.
 *
 * ---------------------------------------------------------------------------
 * AND IT NOW CHECKS ITS OWN LIST AGAINST THE JOBS, added 2026-09-10.
 * ---------------------------------------------------------------------------
 *
 * The list below was right when it was written, and the note above records that
 * getting it right took two goes. What nothing protected was the DAY AFTER: a
 * job that grows a requirement leaves this file reporting `ready`, in a word
 * nobody would question, about a job that now refuses to run. That is the
 * under-report failure this repository keeps paying for — a smaller number
 * rather than an error.
 *
 * The obvious fix is to derive the list from the sources and delete the
 * hand-written one. THAT WOULD BE WORSE, and the sources say why. The common
 * guard is a plain early exit:
 *
 *     if (($cfg['warehouse_email'] ?? '') === '') { … }
 *
 * but TWO of the nine are not written that way. cron-whatsapp assigns first and
 * tests the variables; cron-voice guards through assistant_speech_available().
 * An extractor matching only the plain form finds neither, reports a shorter
 * list, and every job it cannot parse becomes a job it says needs nothing. The
 * silence and the success look identical — which is exactly how the route
 * extractor dropped a capital letter, and how the first version of THIS file
 * went wrong.
 *
 * So it is a DRIFT ALARM rather than a re-derivation, and it is one-directional
 * on purpose, in both directions:
 *
 *   newGuard   a key guarded in the plain form that this list does NOT name.
 *              The job gained a requirement and this file under-reports it.
 *   stale      a key this list names that no longer appears in the job at all.
 *              The requirement went away and the list would cry wolf, which is
 *              how a real signal gets trained into noise.
 *
 * Neither pretends to parse PHP, and a key guarded indirectly is simply not
 * matched — it stays listed by hand, which is the honest arrangement.
 *
 * A CHECK THAT FINDS NOTHING PASSES EVERY COMPARISON UNDER IT, so `guardsSeen`
 * is reported and must be non-zero: if the extractor ever stops matching, that
 * number goes to 0 and says so, rather than the file reporting a clean sweep
 * about nine jobs it never read.
 */

$CFG = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';
/* The jobs live beside their config, so the directory is derived rather than
   written twice — and never with a relative path, which through this channel
   would resolve against the home directory and read nothing. */
$API = dirname($CFG);

// job => the keys it cannot work without. cron_key is deliberately not listed:
// every job needs it, so naming it eight times says nothing, and it is checked
// once on its own below.
//
// EVERY LIST BELOW IS THE JOB'S ACTUAL GUARD, read from its source, and the
// first version of this file got two of them wrong by grepping for `$cfg['...']`
// instead — which finds every key a file MENTIONS, including the optional ones:
//
//   voice          had ['tts_model', 'tts_voice_id']. tts_model is optional
//                  (`$cfg['tts_model'] ?? 'eleven_multilingual_v2'`) and
//                  tts_key was missing entirely, so a shop with a voice id and
//                  no API key would have been reported READY.
//   customer-mail  had ['mail_reply_to'], which nothing checks. It would have
//                  reported a false "waiting" the moment that field was
//                  cleared, and a checker that cries wolf is how the real
//                  four went unnoticed for months.
//
// A key that a file reads with `?? default` is not a key it needs. Read the
// guard, not the mentions.
$NEEDS = [
    // cron-push.php:33   vapid_public / vapid_private
    'push'          => ['vapid_public', 'vapid_private'],
    // cron-assistant.php:31 AND :42 — BOTH are `store_out(…, 503)` early exits,
    // and n8n_secret was missing here until the drift alarm below found it on
    // its first run. A shop that had filled in the webhook and not the secret
    // would have read as READY while the job answered 503 on every run, which
    // is this file's own original bug wearing a different key.
    'assistant'     => ['n8n_webhook', 'n8n_secret'],
    // cron-whatsapp.php:50
    'whatsapp'      => ['whatsapp_token', 'whatsapp_phone_number_id'],
    // cron-fulfilment.php:26
    'fulfilment'    => ['warehouse_email'],
    // Guarded on cron_key alone — mail_reply_to is optional.
    'customer-mail' => [],
    'stock'         => [],
    'invoice'       => [],
    // cron-voice.php:88 calls assistant_speech_available(), which is
    // tts_key && tts_voice_id && cron_key. And the guard sits BEFORE the
    // prune branch, so ?do=prune does nothing either while the voice is unset.
    'voice'         => ['tts_key', 'tts_voice_id'],
];

$cfg = @include $CFG;
if (!is_array($cfg)) { echo "CRON failed=no-config\n"; exit; }

/** Present AND non-empty. A key set to '' is not configured, and reporting it
 *  as set is how this check would become another thing that lies quietly. */
$has = static function (string $k) use ($cfg): bool {
    return isset($cfg[$k]) && trim((string) $cfg[$k]) !== '';
};

$ready = [];
$waiting = [];
foreach ($NEEDS as $job => $keys) {
    $missing = [];
    foreach ($keys as $k) if (!$has($k)) $missing[] = $k;
    if ($missing) $waiting[] = $job . '(' . implode('+', $missing) . ')';
    else $ready[] = $job;
}

/* ------------------------------------------------------- the drift alarm -- */

/* Only the plain early-exit form, and only inside an `if`. Deliberately narrow:
   a loose pattern would match every MENTION, which is the mistake that reported
   `voice` as ready with no API key. cron_key is excluded because every job has
   it and $NEEDS names it nowhere on purpose. */
/* Keys whose guard is NOT in the job's own file, with where it really is. The
   stale test asks "does this key still appear in this job?" and that question is
   only meaningful when the guard lives there — cron-voice defers to
   assistant_speech_available(), so tts_key appears nowhere in it and the naive
   test reported it stale on its first run. These are not exempted, they are
   checked SOMEWHERE ELSE: the helper must still exist and must still test them,
   which is a stronger statement than the mention test it replaces. */
$ELSEWHERE = [
    'voice' => ['file' => 'assistant.php', 'fn' => 'assistant_speech_available',
                'keys' => ['tts_key', 'tts_voice_id']],
];

$newGuard = []; $stale = []; $unread = []; $guardsSeen = 0; $indirect = [];

foreach ($NEEDS as $job => $keys) {
    $path = $API . '/cron-' . $job . '.php';
    $src  = @file_get_contents($path);
    if ($src === false) { $unread[] = $job; continue; }

    /* Line by line, and EVERY key on the line — not just the first. The first
       version anchored at `if (` with `[^)]*` in between, which cannot cross a
       closing bracket, so on the compound guard

           if (($cfg['vapid_public'] ?? '') === '' || ($cfg['vapid_private'] ?? '') === '')

       it saw `vapid_public` and stopped. A job adding a SECOND key to a guard it
       already had would have gone unnoticed, which is precisely the drift this
       exists to catch. Caught by mutation-testing rather than by reading: the
       "job drops a key" mutation renamed vapid_private and the alarm reported
       only the stale half, when it should have reported both. */
    $found = [];
    foreach (preg_split('/\R/', $src) as $line) {
        if (!preg_match('/^\s*(\}\s*else\s*)?if\s*\(/', $line)) continue;
        preg_match_all("/\\\$cfg\['([a-z0-9_]+)'\]\s*\?\?\s*''\s*\)\s*===\s*''/i", $line, $mm);
        foreach ($mm[1] as $k) $found[$k] = true;
    }
    foreach (array_keys($found) as $k) {
        if ($k === 'cron_key') continue;
        $guardsSeen++;
        if (!in_array($k, $keys, true)) $newGuard[] = $job . ':' . $k;
    }

    // The other direction: a key this file still demands that the job dropped.
    $away = $ELSEWHERE[$job]['keys'] ?? [];
    foreach ($keys as $k) {
        if (in_array($k, $away, true)) continue;          // checked below instead
        if (strpos($src, "'" . $k . "'") === false) $stale[] = $job . ':' . $k;
    }
}

/* The indirect guards, asked where they actually live. Two things must hold, and
   the first is what a plain mention test cannot say: the job must still CALL the
   helper, and the helper must still TEST each key. A job that stopped calling it
   would be unguarded while every key still sat in the helper looking correct. */
foreach ($ELSEWHERE as $job => $spec) {
    $jobSrc = @file_get_contents($API . '/cron-' . $job . '.php');
    $fnSrc  = @file_get_contents($API . '/' . $spec['file']);
    if ($jobSrc === false || $fnSrc === false) { $indirect[] = $job . ':unreadable'; continue; }
    if (strpos($jobSrc, $spec['fn']) === false) { $indirect[] = $job . ':no-longer-calls-' . $spec['fn']; continue; }
    if (!preg_match('/function\s+' . preg_quote($spec['fn'], '/') . '\s*\(.*?\n\}/s', $fnSrc, $fm)) {
        $indirect[] = $job . ':' . $spec['fn'] . '-not-found'; continue;
    }
    foreach ($spec['keys'] as $k) {
        if (strpos($fm[0], "'" . $k . "'") === false) $indirect[] = $job . ':' . $spec['fn'] . '-drops-' . $k;
    }
}

echo 'CRON key=' . ($has('cron_key') ? 'set' : 'MISSING')
   . ' ready=' . count($ready) . '/' . count($NEEDS) . ':' . implode(',', $ready)
   . ' waiting=' . (count($waiting) ? implode(',', $waiting) : '0')
   // The drift half. guardsSeen=0 means the extractor matched nothing at all,
   // in which case newGuard=0 is a statement about this file rather than about
   // the jobs — read it BEFORE the two results it guards.
   . ' | guardsSeen=' . $guardsSeen
   . ' unread=' . (count($unread) ? implode(',', $unread) : '0')
   . ' newGuard=' . (count($newGuard) ? implode(',', $newGuard) : '0')
   . ' stale=' . (count($stale) ? implode(',', $stale) : '0')
   . ' indirect=' . (count($indirect) ? implode(',', $indirect) : 'ok')
   . "\n";
