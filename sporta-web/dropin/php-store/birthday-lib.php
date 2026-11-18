<?php
// Birthday gift — shared rules for the customer endpoint and the daily job.
declare(strict_types=1);

const BIRTHDAY_DEFAULTS = ['enabled' => true, 'percent' => 10, 'days' => 14];
const BIRTHDAY_MIN_YEAR = 1920;
const BIRTHDAY_SETTLE_DAYS = 30;   // a date must be on file this long before it earns a gift
const BIRTHDAY_TZ = 'Asia/Kuwait';

/** Owner settings from settings.birthday, clamped field by field. */
function birthday_settings(PDO $db): array {
    $raw = [];
    try {
        $q = $db->prepare('select value from settings where name = ?');
        $q->execute(['birthday']);
        $raw = json_decode((string)($q->fetchColumn() ?: ''), true) ?: [];
    } catch (Throwable $e) { $raw = []; }
    $s = array_merge(BIRTHDAY_DEFAULTS, is_array($raw) ? $raw : []);
    return [
        'enabled' => (bool)$s['enabled'],
        'percent' => max(1, min(50, (int)$s['percent'])),
        'days'    => max(1, min(60, (int)$s['days'])),
    ];
}

/** 'YYYY-MM-DD' | '' | null → [value|null, error|null]. Empty clears it. */
function birthday_parse(mixed $raw, ?DateTimeImmutable $today = null): array {
    if ($raw === null || $raw === '') return [null, null];
    if (!is_string($raw) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $raw, $m)) return [null, 'invalid_birthday'];
    [$y, $mo, $d] = [(int)$m[1], (int)$m[2], (int)$m[3]];
    if ($y < BIRTHDAY_MIN_YEAR || !checkdate($mo, $d, $y)) return [null, 'invalid_birthday'];
    $today ??= new DateTimeImmutable('now', new DateTimeZone(BIRTHDAY_TZ));
    if ($raw > $today->format('Y-m-d')) return [null, 'invalid_birthday'];
    return [$raw, null];
}

function birthday_columns_ready(PDO $db): bool {
    try { return (bool)$db->query("show columns from customer_accounts like 'birthday_sent_year'")->fetch(); }
    catch (Throwable $e) { return false; }
}

/**
 * Month-day strings that count as "a birthday today". 29 Feb celebrates on
 * 28 Feb in a common year, so nobody born on a leap day is skipped three years
 * in four.
 */
function birthday_today_keys(DateTimeImmutable $today): array {
    $keys = [$today->format('m-d')];
    $isLeap = (bool)$today->format('L');
    if (!$isLeap && $today->format('m-d') === '02-28') $keys[] = '02-29';
    return $keys;
}

/**
 * Accounts whose gift is due today.
 *
 * VERIFIED ADDRESSES ONLY (audit M4, 2026-11-12). Registration does not prove
 * the mailbox, so an unverified account's gift would go to whatever address
 * somebody typed - and one person could farm codes from any number of them.
 * An account is verified by its emailed link or a completed password reset
 * (customers.mysql.sql, the email verification section). FAILS CLOSED: before that migration is applied
 * the column is missing and nobody is due, rather than everybody.
 */
function birthday_due(PDO $db, DateTimeImmutable $today, int $limit = 200): array {
    if (!customer_verify_ready($db)) {
        error_log('Sporta birthday: customers.mysql.sql verification section not applied; no gifts sent');
        return [];
    }
    $keys = birthday_today_keys($today);
    $in = implode(',', array_fill(0, count($keys), '?'));
    $settled = $today->modify('-' . BIRTHDAY_SETTLE_DAYS . ' days')->format('Y-m-d 23:59:59');
    $q = $db->prepare("select id, name, email, birthday, birthday_sent_year from customer_accounts
        where birthday is not null and date_format(birthday, '%m-%d') in ($in)
          and email_verified_at is not null
          and birthday_set_at is not null and birthday_set_at <= ?
          and (birthday_sent_year is null or birthday_sent_year < ?)
        order by id limit " . max(1, min(1000, $limit)));
    $q->execute([...$keys, $settled, (int)$today->format('Y')]);
    return $q->fetchAll(PDO::FETCH_ASSOC);
}

function birthday_new_code(): string {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no O/0, no I/1
    $s = '';
    for ($i = 0; $i < 6; $i++) $s .= $alphabet[random_int(0, strlen($alphabet) - 1)];
    return 'BDAY' . $s;
}
