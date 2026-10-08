<?php
/**
 * WRITES to the live database: ONE value in the `site_text` settings row — the Arabic side of
 * `trust.delivery` — so the delivery line reads "… ساعة — ١ د.ك" with a dash where the bundle's
 * middle dot was. Asked for on 2026-10-08 (product-page review, item P3), approved by the owner.
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/set-delivery-wording.php && php r.php
 *
 * WHY. Arabic is the shop's default language. In right-to-left text the middle dot (U+00B7) of
 * "التوصيل خلال ٢٤ ساعة · ١ د.ك" sits right beside ١, at almost the size and height of the Arabic zero
 * (٠), so the line reads ١٠ د.ك — a 10 KWD fee for a 1 KWD one. The payment line under it already uses
 * " — ", and that is the character used here.
 *
 * WHERE IT LIVES. This is the OWNER'S wording, not code: /backends -> Settings -> Site wording writes the
 * same row in the same shape, {"trust.delivery":{"ar":[original, replacement]}}, and assets/site-text.js
 * swaps any whole text node equal to the original. One entry fixes the product page's delivery line AND
 * the About page's heading (the same sentence in a node of its own) — About needs no second change, and
 * its content-hashed bundle file must not be edited.
 *
 * WHAT IT TOUCHES, AND WHAT IT NEVER TOUCHES.
 *  - It reads the row, changes ONLY trust.delivery.ar, and writes the row back (a read-modify-write
 *    under `select … for update`, so a panel save at the same moment waits instead of being lost). Every
 *    other key, and trust.delivery.en, is compared before and after and reported.
 *  - The ORIGINAL it matches on is read out of the LIVE bundle the server is serving (index.html's module
 *    script, its Arabic `trust:{delivery:…}` literal) — never typed in here, because site-text.js matches
 *    it exactly and a shipped string that differs from the live one matches nothing.
 *  - If the owner already has their own Arabic wording for this line, the dot (if any) in THEIR text is
 *    turned into the dash and nothing else in it changes. If their text has no dot, it is left alone.
 *  - If the stored original no longer matches the live bundle, that entry already matches nothing on the
 *    page; it is the owner's to sort out, so this refuses and says so rather than guessing.
 *  - The old row is saved FIRST, verbatim, to a timestamped file in the account's home directory,
 *    OUTSIDE the docroot, mode 0600: /home/u130124229/site_text-backup-<UTC stamp>.json. The write does
 *    not happen unless that file reads back byte-identical. Undo = put that value back in the row.
 *
 * IDEMPOTENT, AND IT REPORTS STATE. A second run finds the dash and writes nothing (and makes no backup).
 * The last line reads the same on every run of a `* * * * *` job — `STATE trustDeliveryAr=dash …` —
 * whether this run or an earlier one did the work. Delete the job after the first output.
 *
 * NOT FIXED HERE, and printed so the reading says so: at any delivery fee other than 1.000 KWD,
 * assets/rules-live.js rewrites "١ د.ك" in the ORIGINAL before site-text.js can match it, and the dot
 * comes back ("٢ ·" then reads as ٢٠). `feeHolds=` says whether the live fee is the one this holds at.
 *
 * Cron channel: absolute paths only, no secrets printed (never a DSN, a user or a password — a failure
 * prints the exception's class and code), one line per step flushed as it is measured, and nothing
 * should follow `php r.php` in the job.
 */

declare(strict_types=1);

const LIVE_DOCROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
const LIVE_HOME    = '/home/u130124229';
const KEY          = 'trust.delivery';
const DOT          = "\u{00B7}";
const DASH         = ' — ';

$STATE = 'trustDeliveryAr=UNKNOWN (the run stopped before it measured)';
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
register_shutdown_function(static function () use (&$STATE): void {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) line('FAILED fatal at line ' . $e['line']);
    line('STATE ' . $STATE);
});

/* LOCAL TEST MODE, never on the live server: only when the live docroot does not exist do the
   SPORTA_* variables decide where to read and write (scripts/... test rig, a scratch database). */
$local   = !is_dir(LIVE_DOCROOT);
$docroot = $local ? (string) getenv('SPORTA_DOCROOT') : LIVE_DOCROOT;
$cfgFile = $local ? (string) getenv('SPORTA_CONFIG_FILE') : LIVE_DOCROOT . '/api/config.php';
$bakDir  = $local ? (string) getenv('SPORTA_BACKUP_DIR') : LIVE_HOME;

line('P3 set-delivery-wording ' . gmdate('Y-m-d\TH:i:s\Z') . ($local ? ' LOCAL-TEST' : ''));
if ($docroot === '' || $cfgFile === '' || $bakDir === '') { $STATE = 'trustDeliveryAr=UNKNOWN REFUSED-no-paths'; exit; }

/* The replacement: every middle dot, with whatever spaces surround it, becomes " — ". */
function dashed(string $s): string { return trim((string) preg_replace('/\s*\x{00B7}\s*/u', DASH, $s)); }
function stateOf(string $s): string {
    if (strpos($s, DOT) !== false) return 'dot';
    if (strpos($s, trim(DASH)) !== false) return 'dash';
    return 'owner-no-dot';
}
/* admin.php's own rules for a site_text value (settings_save), so the panel can still open and save it. */
function acceptable(string $s): bool {
    return $s !== '' && mb_strlen($s) <= 600 && strpos($s, '</') === false && strpos($s, "\0") === false;
}

try {
    // ------------------------------------------------ 1. the original, from the LIVE bundle
    $index = @file_get_contents($docroot . '/index.html');
    if (!is_string($index) || !preg_match('#<script[^>]+src="/assets/(index-[A-Za-z0-9_-]+\.js)"#', $index, $m)) {
        $STATE = 'trustDeliveryAr=UNKNOWN REFUSED-bundle-not-found'; exit;
    }
    $bundleName = $m[1];
    $bundle = @file_get_contents($docroot . '/assets/' . $bundleName);
    if (!is_string($bundle)) { $STATE = 'trustDeliveryAr=UNKNOWN REFUSED-bundle-unreadable'; exit; }
    $original = null;
    if (preg_match_all('/trust:\{delivery:`([^`]*)`/u', $bundle, $mm)) {
        foreach ($mm[1] as $lit) if (preg_match('/\p{Arabic}/u', $lit)) { $original = $lit; break; }
    }
    if ($original === null) { $STATE = 'trustDeliveryAr=UNKNOWN REFUSED-original-not-in-bundle'; exit; }
    line('bundle=' . $bundleName . ' original=found originalHasDot=' . (strpos($original, DOT) !== false ? 'yes' : 'no'));
    if (strpos($original, DOT) === false) { $STATE = 'trustDeliveryAr=bundle-has-no-dot NOTHING-TO-DO'; exit; }

    // ------------------------------------------------ 2. the database
    $cfg = @include $cfgFile;
    if (!is_array($cfg)) { $STATE = 'trustDeliveryAr=UNKNOWN REFUSED-config-unreadable'; exit; }
    try {
        $db = new PDO('mysql:host=' . ($cfg['db_host'] ?? 'localhost') . ';dbname=' . ($cfg['db_name'] ?? '') . ';charset=utf8mb4',
                      (string) ($cfg['db_user'] ?? ''), (string) ($cfg['db_pass'] ?? ''),
                      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    } catch (Throwable $e) {
        $STATE = 'trustDeliveryAr=UNKNOWN REFUSED-connect ' . get_class($e) . '/' . $e->getCode(); exit;
    }

    // The fee this fix holds at (informational: see the header).
    $fee = 1000;
    $rr = $db->query("select value from settings where name = 'rules'")->fetchColumn();
    $rj = is_string($rr) ? json_decode($rr, true) : null;
    if (is_array($rj) && isset($rj['delivery_fee_fils']) && is_numeric($rj['delivery_fee_fils'])) $fee = (int) $rj['delivery_fee_fils'];
    $feeNote = 'deliveryFeeFils=' . $fee . ' feeHolds=' . ($fee === 1000 ? 'yes' : 'no(rules-live.js rewrites the original first at this fee)');

    $db->beginTransaction();
    $q = $db->prepare("select value from settings where name = 'site_text' for update");
    $q->execute();
    $raw = $q->fetchColumn();
    $hadRow = is_string($raw);
    if ($hadRow) {
        $rows = json_decode($raw, true);
        if (!is_array($rows) || ($rows !== [] && array_is_list($rows))) {
            $db->rollBack();
            $STATE = 'trustDeliveryAr=UNKNOWN REFUSED-row-unreadable (left exactly as it is)'; exit;
        }
    } else {
        $rows = [];
    }
    line('row=' . ($hadRow ? 'present' : 'absent') . ' keys=' . count($rows));

    $entry = $rows[KEY] ?? null;
    if ($entry !== null && !is_array($entry)) { $db->rollBack(); $STATE = 'trustDeliveryAr=UNKNOWN REFUSED-entry-not-a-pair'; exit; }
    $ar = is_array($entry) ? ($entry['ar'] ?? null) : null;

    if ($ar === null) {
        $before = 'absent';
        $want = [$original, dashed($original)];
    } elseif (!is_array($ar) || count($ar) !== 2 || !is_string($ar[0]) || !is_string($ar[1])) {
        $db->rollBack(); $STATE = 'trustDeliveryAr=UNKNOWN REFUSED-ar-not-a-pair'; exit;
    } elseif ($ar[0] !== $original) {
        $db->rollBack();
        $STATE = 'trustDeliveryAr=stale-original(untouched) — the saved original is not the live bundle\'s, so this entry matches nothing; the owner\'s to fix in Site wording. ' . $feeNote;
        exit;
    } else {
        $before = stateOf($ar[1]);
        $want = [$ar[0], $before === 'dot' ? dashed($ar[1]) : $ar[1]];
    }
    line('before trustDeliveryAr=' . $before);

    $changes = !(is_array($ar) && $ar === $want);
    if (!$changes) {
        $db->rollBack();
        $STATE = 'trustDeliveryAr=' . stateOf($want[1]) . ' write=none(already) keys=' . count($rows) . ' ' . $feeNote;
        exit;
    }
    if (!acceptable($want[0]) || !acceptable($want[1])) { $db->rollBack(); $STATE = 'trustDeliveryAr=UNKNOWN REFUSED-value-not-acceptable'; exit; }

    // ------------------------------------------------ 3. the backup, verified before anything is written
    $stamp = gmdate('Ymd-His') . 'Z';
    $bak = rtrim($bakDir, '/') . '/site_text-backup-' . $stamp . '.json';
    $payload = $hadRow ? $raw : '{"_note":"there was no site_text row before ' . $stamp . '; undo = delete the row"}';
    $okFile = @file_put_contents($bak, $payload, LOCK_EX) === strlen($payload);
    @chmod($bak, 0600);
    $back = $okFile ? @file_get_contents($bak) : false;
    if (!$okFile || !is_string($back) || !hash_equals(hash('sha256', $payload), hash('sha256', $back))) {
        $db->rollBack(); $STATE = 'trustDeliveryAr=' . $before . ' REFUSED-backup-not-written ' . $bak; exit;
    }
    line('backup=' . $bak . ' bytes=' . strlen($back) . ' sha256=' . substr(hash('sha256', $back), 0, 16) . ' mode=' . substr(sprintf('%o', fileperms($bak)), -4) . ' verified=yes');

    // ------------------------------------------------ 4. the write: one key, one side
    $new = $rows;
    $newEntry = is_array($entry) ? $entry : [];
    $newEntry['ar'] = $want;
    $new[KEY] = $newEntry;
    $json = json_encode($new, JSON_UNESCAPED_UNICODE);   // the same encoding store_setting_save() uses
    if (!is_string($json) || strlen($json) > 65536) { $db->rollBack(); $STATE = 'trustDeliveryAr=' . $before . ' REFUSED-too-large'; exit; }
    $db->prepare('insert into settings (name, value) values (?, ?) on duplicate key update value = values(value)')
       ->execute(['site_text', $json]);
    $db->commit();
    line('write=done');

    // ------------------------------------------------ 5. read it back: STATE, not the verb
    $after = json_decode((string) $db->query("select value from settings where name = 'site_text'")->fetchColumn(), true);
    $after = is_array($after) ? $after : [];
    $others = 0; $same = 0;
    foreach ($rows as $k => $v) {
        if ($k === KEY) continue;
        $others++;
        if (array_key_exists($k, $after) && json_encode($after[$k], JSON_UNESCAPED_UNICODE) === json_encode($v, JSON_UNESCAPED_UNICODE)) $same++;
    }
    $extra = count(array_diff(array_keys($after), array_keys($rows), [KEY]));
    $enBefore = json_encode(is_array($entry) ? ($entry['en'] ?? null) : null, JSON_UNESCAPED_UNICODE);
    $enAfter  = json_encode($after[KEY]['en'] ?? null, JSON_UNESCAPED_UNICODE);
    $arNow = $after[KEY]['ar'] ?? null;
    $okAr = is_array($arNow) && $arNow === $want;
    $STATE = 'trustDeliveryAr=' . ($okAr ? stateOf((string) $arNow[1]) : 'MISMATCH')
           . ' write=done otherKeysUnchanged=' . ($same === $others && $extra === 0 ? 'yes' : 'NO') . '(' . $same . '/' . $others . ')'
           . ' enUnchanged=' . ($enBefore === $enAfter ? 'yes' : 'NO')
           . ' backup=' . $bak . ' ' . $feeNote;
} catch (Throwable $e) {
    if (isset($db) && $db instanceof PDO && $db->inTransaction()) { try { $db->rollBack(); } catch (Throwable $_) {} }
    $STATE = 'trustDeliveryAr=UNKNOWN FAILED ' . get_class($e) . '/' . $e->getCode();
}
