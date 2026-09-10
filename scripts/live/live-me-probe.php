<?php
/**
 * Why does ?r=me answer differently on the live server than in the sandbox?
 *
 * READ-ONLY: three unauthenticated GETs. It prints statuses and the first line
 * of each body, which for an error is the message — no credential can appear
 * there, and nothing else is printed.
 *
 * WHAT PROMPTED IT. live-admin-gate reported `withoutHeader=500`. That check
 * was aimed at the wrong route — `me` sits ABOVE the gate and never called
 * store_require_admin_header(), so the sandbox answers 200 with null and the
 * header was never its business. But 500 is not the sandbox's answer either,
 * and the two servers run a file with the same sha256. That difference is the
 * thing worth knowing: `me` is the FIRST request the panel makes, and a 500
 * there is a panel that cannot start.
 */
$ask = static function (array $headers) {
    $ch = curl_init('https://127.0.0.1/api/admin.php?r=me');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => array_merge(['Host: www.sporta.com.kw'], $headers),
        CURLOPT_TIMEOUT        => 20,
    ]);
    $body = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $first = trim(strtok($body, "\n"));
    return $code . '/' . strlen($body) . '/' . substr($first, 0, 90);
};

echo 'MEPROBE withHeader=' . $ask(['X-Sporta-Admin: 1'])
   . ' | withoutHeader=' . $ask([])
   . ' | phpVersion=' . PHP_VERSION
   . "\n";
