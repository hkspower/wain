// The KNET money-path mutations, committed so they can be re-run (review 3, finding 3: the claims "14 of 14" and "16 of 16"
// rested on ad-hoc runs nobody else could repeat).
//
//   npm run test:knet-mutants                 every mutant (about an hour: each runs the suites that should catch it)
//   npm run test:knet-mutants -- P1-M3 R      only the mutants whose id starts with one of the arguments
//   MUTANTS_DRY=1 npm run test:knet-mutants   only check that every mutant still applies (seconds, no rig)
//   (the rig of scripts/sandbox.sh, as test:knet, test:knet-refund and test:payment-receipt need it)
//
// Each mutant edits the source (every edit must match EXACTLY ONE place, or the mutant is reported as not applying, which is
// a failure: a mutant that silently stops applying proves nothing), runs the suites named for it one after another, and
// is KILLED when at least one of them fails. The files are restored byte for byte in a `finally`, also on Ctrl-C.
//
//   P1-*  Part 1, "match the official plug-in" (KNET-IPAYPIPE-CHECK.md D1-D7, the D2 inquiry), caught by test:knet
//   P2-*  Part 2, KNET payment records (K-063 B1-B3, B9, C2, D1/D5), caught by test:knet-refund / test:knet / test:native
//         / the server part of test:payment-receipt
//   R*    the review fixes of 2026-11-12 (one payment one order, second charges after a refund, the review cap, a manual
//         settlement confirmed by the bank, the narrow receipt key, the errorURL leg's order=)
//
// The page-side mutants (the result page and the /backends block) live in their own suites (payment-receipt-test.mjs part 4,
// knet-refund-ui-test.mjs part 7), because those run in a browser against fixtures and are cheap.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const SUITES = {
  knet: ['scripts/knet-test.mjs', {}],
  refund: ['scripts/knet-refund-test.mjs', {}],
  native: ['scripts/native-backend-test.mjs', {}],
  receipt: ['scripts/payment-receipt-test.mjs', { RECEIPT_PARTS: 'server' }],
}
const K = 'dropin/php-knet/knet.php', CB = 'dropin/php-knet/callback.php', PR = 'dropin/php-store/payment-records.php'
const ST = 'dropin/php-store/store.php', AD = 'dropin/php-store/admin.php', CR = 'dropin/php-store/cron-stock.php'

// [id, what it breaks, [[file, old, new, all?], ...], suites]
const MUTANTS = [
  // ---------------------------------------------------------------- Part 1
  ['P1-M1', 'trandata values urlencoded again', [[K, "        $out .= $k . '=' . $v . '&';", "        $out .= $k . '=' . urlencode($v) . '&';"]], ['knet']],
  ['P1-M2', 'empty pairs sent', [[K, "        if ($v === '') continue;\n        $problem = knet_raw_value_problem($v);", "        $problem = knet_raw_value_problem($v);"]], ['knet']],
  ['P1-M3', 'no refusal of & = ? # or control characters', [[K, "    if (strpbrk($value, '&=?#') !== false) return 'contains one of & = ? #';\n    if (preg_match('/[\\x00-\\x1F\\x7F]/', $value) === 1) return 'contains a control character';\n    return null;", '    return null;']], ['knet']],
  ['P1-M4', 'gateway checked by host only', [[K, '    if (!$isLocalTest && !in_array($selected, KNET_GATEWAY_URLS[$env], true)) {', '    if (!$isLocalTest && !in_array($selectedHost, array_map(static fn ($u) => parse_url($u, PHP_URL_HOST), KNET_GATEWAY_URLS[$env]), true)) {']], ['knet']],
  ['P1-M5', 'bare host only (www refused)', [[K, "    'test'       => ['https://kpaytest.com.kw/kpg/PaymentHTTP.htm', 'https://www.kpaytest.com.kw/kpg/PaymentHTTP.htm'],\n    'production' => ['https://kpay.com.kw/kpg/PaymentHTTP.htm', 'https://www.kpay.com.kw/kpg/PaymentHTTP.htm'],\n];", "    'test'       => ['https://kpaytest.com.kw/kpg/PaymentHTTP.htm'],\n    'production' => ['https://kpay.com.kw/kpg/PaymentHTTP.htm'],\n];"]], ['knet']],
  ['P1-M6', 'the admin accepts any https gateway URL', [[ST, '    return isset($allowed[$env]) && in_array($url, $allowed[$env], true);', "    return str_starts_with($url, 'https://');"]], ['knet']],
  ['P1-M7', 'the admin character rule off', [[ST, "    return strpbrk($value, '&=?#') === false && preg_match('/[\\x00-\\x1F\\x7F]/', $value) !== 1;", '    return true;']], ['knet']],
  ['P1-M8', 'the inquiry settles on any result', [[K, "    if ($result !== 'CAPTURED') return ['state' => 'other', 'reason' => 'not_captured', 'result' => $result, 'fields' => $fields];", '']], ['knet']],
  ['P1-M9', 'the inquiry ignores the echoed reference', [[K, '    if (!hash_equals($ref, $echoed)) {', '    if (false) {']], ['knet']],
  ['P1-M10', 'the sweeper skips the inquiry', [[CR, '    if (cron_knet_inquire_before_release($inquiry, $db, $r)) continue;', '']], ['knet']],
  ['P1-M11', 'a default inquiry action code', [[K, "    $action = $cfg['inquiry_action'] ?? null;\n    if ($action === null || $action === '') return 'inquiry_action_not_set';", "    $action = $cfg['inquiry_action'] ?? '8';"]], ['knet']],
  ['P1-M12', 'no stop when the bank is down', [[CR, "        $inquiry['cfg'] = null;\n        error_log('Sporta KNET inquiry stopped", "        error_log('Sporta KNET inquiry stopped"]], ['knet']],
  ['P1-M13', 'inquiry TLS verification off', [[K, '        CURLOPT_SSL_VERIFYPEER => true,\n        CURLOPT_SSL_VERIFYHOST => 2,\n        CURLOPT_MAXFILESIZE', '        CURLOPT_SSL_VERIFYPEER => false,\n        CURLOPT_SSL_VERIFYHOST => 0,\n        CURLOPT_MAXFILESIZE']], ['knet']],
  // D5: the fake bank must catch an encoded value; with a DECODING fake bank the urlencode would pass unseen
  ['P1-M14', 'the fake bank decodes AND the values are urlencoded', [['scripts/fake-knet-bank.php', '        $out[$parts[0]] = $parts[1];', '        $out[$parts[0]] = urldecode($parts[1]);'], [K, "        $out .= $k . '=' . $v . '&';", "        $out .= $k . '=' . urlencode($v) . '&';"]], ['knet']],
  // ---------------------------------------------------------------- Part 2
  ['P2-M1', 'a second capture never detected', [[K, "$secondCapture = $bankPaid && $methodMatches && $incomingPayId !== ''\n            && !hash_equals($recordedPayId, $incomingPayId);", '$secondCapture = false;']], ['refund', 'knet']],
  ['P2-M2', 'refunded / voided not final', [[K, "if (($before === 'refunded' || $before === 'voided') && $methodMatches) {", 'if (false) {']], ['refund']],
  ['P2-M3', 'no cap on a refund of a paid order', [[PR, "if ($fils > $amount - $refunded) { $db->rollBack(); store_fail('refund_exceeds_payment', 409); }", '']], ['refund']],
  ['P2-M4', 'any Payment ID accepted', [[PR, "if ($orderPay !== '' && hash_equals($orderPay, $payId)) {", 'if (true) {']], ['refund']],
  ['P2-M5', 'a whole refund does not stop the order', [[PR, "if ($closes) payrec_stop_order($db, $orderId, (string) $o['fulfilment_status']);", '']], ['refund']],
  ['P2-M6', 'a partial void accepted', [[PR, "if ($fils !== $amount) { $db->rollBack(); store_fail('void_must_be_full', 409); }", '']], ['refund']],
  // Both guards: the locking read of the key AND the unique-key (1062) answer; either alone still answers a replay.
  ['P2-M7', 'no idempotency (both guards)', [[PR, '        if ($prior) {', '        if (false) {'], [PR, "        if ($e instanceof PDOException && (int) ($e->errorInfo[1] ?? 0) === 1062) {", '        if (false) {']], ['refund']],
  ['P2-M8', 'revenue not net of refunds', [[AD, "    $net = store_column_exists($db, 'orders', 'refunded_amount') ? '(amount - refunded_amount)' : 'amount';\n    $row = $db->query(", "    $net = 'amount';\n    $row = $db->query("]], ['refund']],
  ['P2-M9', 'the key handed out on every leg (the errorURL one too)', [[K, "    $paidWith = trim((string) $paidWith);\n    if ($paidWith !== '' && ", "    $paidWith = trim((string) $paidWith);\n    if (true || "]], ['knet']],
  ['P2-M10', 'a refunded order can be put back on', [[AD, "&& in_array($order['payment_status'], ['refunded', 'voided'], true)) {", '&& false) {']], ['refund']],
  ['P2-M11', 'refunded orders in the unpaid queue', [[AD, "$where[] = \"payment_status in ('pending','review','failed')\";", "$where[] = \"payment_status <> 'paid'\";"]], ['refund']],
  ['P2-M12', 'XBRL ignores partial refunds', [['dropin/php-store/xbrl.php', "$back = max(0.0, (float)$o['refunded_amount']);", '$back = 0.0;']], ['refund']],
  ['P2-M13', 'the answered-under Track ID not stored', [[K, "        if (preg_match('/^[A-Za-z0-9]{1,30}$/D', $echoed)) {\n            $pdo->exec('savepoint knet_attempt_ref');", "        if (false) {\n            $pdo->exec('savepoint knet_attempt_ref');"]], ['refund']],
  ['P2-M14', 'a refunded order settled by hand', [[AD, "        if (in_array($o['payment_status'], ['refunded', 'voided'], true)) {\n            $db->rollBack();\n            store_fail('order_refunded', 409);", "        if (false) {\n            $db->rollBack();\n            store_fail('order_refunded', 409);"]], ['refund']],
  ['P2-M15', 'a review capture overwritten without an alert', [[K, "if ($before === 'review' && $secondCapture && $recordedPayId !== ''", "if (false && $recordedPayId !== ''"]], ['refund']],
  ['P2-M16', 'a second capture on a paid order answered review', [[K, "$paidAmount, $fields, $source, ['state' => 'paid', 'reason' => 'duplicate_capture']);", "$paidAmount, $fields, $source, ['state' => 'review', 'reason' => 'duplicate_capture']);"]], ['refund']],
  // ---------------------------------------------------------------- review fixes
  ['R1', 'the inquiry settles an answer that resolves to ANOTHER order (look-alike track id)', [[K, '        if (!hash_equals($trackid, $owner)) {', '        if (false) {']], ['knet']],
  ['R2', 'no "one Payment ID, one order" rule in the settlement', [[K, "            } elseif (knet_payment_id_elsewhere($pdo, (int) $order['id'], $incomingPayId)) {", '            } elseif (false) {']], ['knet']],
  // The missing-reference check and the whose-payment check each stop an answer with no echoed trackid (an empty reference
  // resolves to no order), so only both removed together is observable.
  ['R3', 'an inquiry answer with NO echoed reference accepted (both layers off)', [[K, "    if ($echoed === '') {", '    if (false) {'], [K, '        if (!hash_equals($trackid, $owner)) {', '        if (false) {']], ['knet']],
  ['R4', 'a second charge refused once the order itself is refunded', [[PR, "        $status = (string) $o['payment_status'];\n\n", "        $status = (string) $o['payment_status'];\n        if (in_array($status, ['refunded', 'voided'], true)) { $db->rollBack(); store_fail('order_already_refunded', 409); }\n\n"]], ['refund']],
  ['R5', 'a review order closed for any amount', [[PR, "            if ($fils > $amount) { $db->rollBack(); store_fail('refund_exceeds_payment', 409); }\n", '']], ['refund']],
  ['R6', 'a hand-settled order\'s own bank notification filed as a second charge', [[K, "            if ($secondCapture && (string) ($order['cbk_status'] ?? '') === 'MANUAL_BANK_CONFIRMED') {", '            if (false) {']], ['refund']],
  ['R7', 'the redirect carries the INVOICE key again', [[K, '        $key = payrec_receipt_key($trackid);', '        $key = store_invoice_key($trackid);']], ['receipt']],
  ['R8', 'a key for any trandata (not only the payment the order records)', [[K, "        && hash_equals(trim((string) ($row['cbk_paymentid'] ?? '')), $paidWith)) {", ') {']], ['receipt']],
  ['R9', 'the errorURL leg names the order trackid= again', [[CB, "$onward['order']", "$onward['trackid']", true]], ['knet', 'receipt']],
]

const only = process.argv.slice(2)
const chosen = MUTANTS.filter(([id]) => !only.length || only.some((o) => id.startsWith(o)))
const originals = new Map()
const restore = () => { for (const [f, b] of originals) writeFileSync(f, b); originals.clear() }
process.on('SIGINT', () => { restore(); process.exit(130) })
process.on('SIGTERM', () => { restore(); process.exit(143) })

const settle = () => new Promise((r) => setTimeout(r, 3000))
const runSuite = (name) => new Promise((resolve) => {
  const [file, env] = SUITES[name]
  const p = spawn(process.execPath, [file], { cwd: WEB, env: { ...process.env, ...env } })
  let out = ''
  p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { out += d })
  const t = setTimeout(() => p.kill('SIGKILL'), 30 * 60e3)
  p.on('close', (code) => { clearTimeout(t); resolve({ code, fails: (out.match(/^FAIL /gm) || []).length, first: (out.match(/^FAIL (.*)$/m) || [])[1] || '' }) })
})

let killed = 0, survived = 0, broken = 0, applied = 0
for (const [id, what, edits, suites] of chosen) {
  try {
    let applies = true
    for (const [f, old, neu, all] of edits) {
      const path = WEB + f
      if (!originals.has(path)) originals.set(path, readFileSync(path))
      const src = readFileSync(path, 'utf8')
      const n = src.split(old).length - 1
      if (n === 0 || (!all && n !== 1)) { applies = false; console.log(`FAIL ${id} ${what}: does not apply (${f}: ${n} matches)`); break }
      writeFileSync(path, all ? src.split(old).join(neu) : src.replace(old, neu))
    }
    if (!applies) { broken++; continue }
    // php -S runs with opcache on and opcache.revalidate_freq = 2: a file changed less than 2 s after its last check is
    // still served from the cache. That is why mutants "survived the first combined pass" and were killed alone (Part 2's
    // M10 and M14; P2-M3, P2-M8 and P2-M9 here on the first run): the suite ran against the ORIGINAL code. Wait it out.
    if (!process.env.MUTANTS_DRY) await settle()
    if (process.env.MUTANTS_DRY) { applied++; console.log(`ok   ${id} applies`); continue }   // MUTANTS_DRY=1: only check every mutant applies
    const res = []
    for (const s of suites) {
      const r = await runSuite(s)
      res.push(`${s}: ${r.code === 0 ? 'passed' : `${r.fails} failed`}`)
      if (r.code !== 0) break   // killed: no need to run the rest
    }
    const dead = res.some((x) => !x.endsWith('passed'))
    if (dead) { killed++; console.log(`ok   ${id} ${what}: KILLED (${res.join('; ')})`) }
    else { survived++; console.log(`FAIL ${id} ${what}: SURVIVED (${res.join('; ')})`) }
  } finally {
    restore()
    if (!process.env.MUTANTS_DRY) await settle()   // and the next mutant (or the next suite) must see the original again
  }
}
console.log(process.env.MUTANTS_DRY ? `\n${applied} apply, ${broken} did not apply (of ${chosen.length})`
  : `\n${killed} killed, ${survived} survived, ${broken} did not apply (of ${chosen.length})`)
process.exit(survived || broken ? 1 : 0)
