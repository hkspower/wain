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
 */

$CFG = '/home/u130124229/domains/sporta.com.kw/public_html/api/config.php';

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
    // cron-assistant.php:31
    'assistant'     => ['n8n_webhook'],
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

echo 'CRON key=' . ($has('cron_key') ? 'set' : 'MISSING')
   . ' ready=' . count($ready) . '/' . count($NEEDS) . ':' . implode(',', $ready)
   . ' waiting=' . (count($waiting) ? implode(',', $waiting) : '0') . "\n";
