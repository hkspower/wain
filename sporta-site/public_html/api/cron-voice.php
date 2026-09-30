<?php
// Warm the voice cache, and sweep the old audio out of it.
//
//   cron-voice.php?key=<cron_key>&do=warm    synthesise every canned sentence,
//                                            both languages, before any
//                                            customer has to wait for one
//   cron-voice.php?key=<cron_key>&do=prune   delete audio nobody has played
//   cron-voice.php?key=<cron_key>            what is cached, and how big
//
// (Or the same three from a shell, if you have one: php cron-voice.php warm.)
//
// WHY WARMING IS WORTH A SCRIPT
//
// The shop's answers repeat. "Delivery is same-day", "returns within 14 days",
// the greeting — the same words for every customer who ever asks, in both
// languages. They are synthesised once and served from disk for ever after,
// which is what makes the voice affordable at all.
//
// But "once" has to happen to somebody, and without this it happens to a
// CUSTOMER: the first person to press the speaker on each sentence waits out a
// live synthesis call — a second or two, on a Kuwaiti mobile connection, on
// the one interaction where the shop was trying to seem responsive. Twenty-four
// sentences means twenty-four unlucky customers.
//
// So the shop buys them all at once, in one deliberate run, before anyone is
// waiting. After this runs, the only thing a customer can ever trigger a live
// call for is a sentence with their own order number in it.
//
// RUN IT: after setting tts_voice_id for the first time, and again after
// changing the voice, the model or the audio format — each of those is part of
// the cache key, so a change means the whole cache is cold again.
//
// HOW TO RUN IT, AND WHY IT IS NOT CLI-ONLY
//
// THIS SERVER HAS NO SHELL. SSH is off permanently and the account's shell is
// /sbin/nologin, so "run php cron-voice.php warm" is an instruction the owner
// cannot follow — it would make warming a thing only a developer with a
// checkout can do, which means in practice it never happens and every
// customer pays the first-press wait.
//
// So it answers over HTTP, gated by cron_key, exactly like cron-fulfilment.php
// — the one pattern on this host that is known to work:
//
//   hPanel -> Advanced -> Cron Jobs (or just paste in a browser, once):
//   wget -qO- "https://www.sporta.com.kw/api/cron-voice.php?key=<cron_key>&do=warm"
//   wget -qO- "https://www.sporta.com.kw/api/cron-voice.php?key=<cron_key>&do=prune"
//
// The key IS the authorisation. Without it this is a URL that spends money
// upstream in a loop, so it 403s before doing anything — and `do` defaults to
// status, which reads the cache and buys nothing.
//
// Warming is not a schedule. Run it once after configuring the voice, and
// again after changing it. Prune is the one worth putting on a monthly cron.
declare(strict_types=1);

require __DIR__ . '/store.php';
require __DIR__ . '/assistant.php';

$cfg = store_config();
$cli = PHP_SAPI === 'cli';

if ($cli) {
    $cmd = $argv[1] ?? 'status';
} else {
    // Same gate as cron-fulfilment.php, and the same failure: a missing or
    // wrong key is 403 before a single upstream call is made.
    if (($cfg['cron_key'] ?? '') === '' || !hash_equals((string) $cfg['cron_key'], (string) ($_GET['key'] ?? ''))) {
        store_fail('forbidden', 403);
    }
    $cmd = (string) ($_GET['do'] ?? 'status');
    header('Content-Type: text/plain; charset=utf-8');
    // Warming two dozen sentences is two dozen upstream calls; the default
    // 30s would cut it off halfway and leave the cache half warm.
    @set_time_limit(300);
}

$dir = (string) ($cfg['tts_cache_dir'] ?? sys_get_temp_dir() . '/sporta-voice');

/** Every .mp3 in the cache, and what they weigh. */
$stat = function () use ($dir): array {
    $files = glob($dir . '/*.mp3') ?: [];
    $bytes = 0;
    foreach ($files as $f) $bytes += (int) @filesize($f);
    return [count($files), $bytes];
};
$human = fn (int $b) => $b > 1048576 ? round($b / 1048576, 1) . ' MB' : round($b / 1024) . ' kB';

if (!assistant_speech_available($cfg)) {
    // Not an error. The voice is optional and the shop is complete without it.
    // Over HTTP a write to STDERR goes nowhere, and the owner reading this in
    // a browser tab is exactly who needs to see it.
    $msg = "The voice is not configured, so there is nothing to warm.\n" .
           "Needs tts_key, tts_voice_id and cron_key in api/config.php.\n" .
           "See SPORTA-AI-VOICE.md — picking the voice is a listening job, not a\n" .
           "configuration one, and it is the only part nobody can do for you.\n";
    if ($cli) { fwrite(STDERR, $msg); } else { http_response_code(503); echo $msg; }
    exit(1);
}

if ($cmd === 'status') {
    [$n, $bytes] = $stat();
    $lines = assistant_canned_lines($cfg);
    $total = count($lines['ar']) + count($lines['en']);
    // Which of the canned lines are already on disk: the same key assistant_speak
    // computes, so this cannot drift from what the customer's request will look for.
    $model  = (string) ($cfg['tts_model'] ?? 'eleven_multilingual_v2');
    $format = (string) ($cfg['tts_format'] ?? 'mp3_22050_32');
    $warm = 0;
    foreach ($lines as $lang => $set) {
        foreach ($set as $t) {
            if (is_readable(assistant_voice_path($cfg, $t, $lang))) $warm++;
        }
    }
    echo "voice     {$cfg['tts_voice_id']}  model $model  format $format\n";
    echo "cache     $dir\n";
    echo "files     $n  (" . $human($bytes) . ")\n";
    echo "canned    $warm of $total warm" .
         ($warm < $total ? ($cli ? "  — run: php cron-voice.php warm\n"
                                 : "  — run this URL again with &do=warm\n")
                         : "\n");
    exit(0);
}

if ($cmd === 'prune') {
    $days = (int) ($cli ? ($argv[2] ?? 90) : ($_GET['days'] ?? 90));
    [$before, $bb] = $stat();
    $gone = assistant_voice_prune($cfg, $days);
    [$after, $ab] = $stat();
    echo "pruned $gone file(s) older than $days days — $before → $after (" .
         $human($bb) . " → " . $human($ab) . ")\n";
    exit(0);
}

if ($cmd !== 'warm') {
    $msg = "usage: php cron-voice.php [warm|prune [days]|status]\n" .
           "   or: cron-voice.php?key=<cron_key>&do=warm|prune|status\n";
    if ($cli) { fwrite(STDERR, $msg); } else { http_response_code(400); echo $msg; }
    exit(2);
}

// ------------------------------------------------------------------- warming
$lines = assistant_canned_lines($cfg);
$bought = $cached = $failed = 0;

foreach ($lines as $lang => $set) {
    foreach ($set as $text) {
        $already = is_readable(assistant_voice_path($cfg, $text, $lang));

        $mp3 = assistant_speak($cfg, $text, $lang);
        $short = mb_substr($text, 0, 46) . (mb_strlen($text) > 46 ? '…' : '');

        if ($mp3 === null) {
            $failed++;
            echo "FAIL  [$lang] $short\n";
            // Stop on the first failure rather than looping through two dozen
            // of them: if the key is wrong or the quota is gone, every call
            // after this one fails the same way, and the useful thing is the
            // reason, not twenty-four copies of it.
            $msg = "\nStopped. The reason is in " . dirname($dir) .
                   "/sporta-voice.log — usually a wrong tts_key,\n" .
                   "an unknown tts_voice_id, or an exhausted quota.\n";
            if ($cli) { fwrite(STDERR, $msg); } else { http_response_code(502); echo $msg; }
            exit(1);
        }
        if ($already) { $cached++; echo "have  [$lang] $short\n"; }
        else          { $bought++; echo "got   [$lang] " . $short . '  (' . $human(strlen($mp3)) . ")\n"; }
    }
}

[$n, $bytes] = $stat();
echo "\nwarmed: $bought new, $cached already cached, $failed failed\n";
echo "cache:  $n files, " . $human($bytes) . " in $dir\n";
echo "\nEvery canned answer now plays from disk. The only sentence that can\n";
echo "still cost anything is one with a customer's own order number in it.\n";
