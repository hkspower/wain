<?php
// READ-ONLY. Prints the domain's DMARC, SPF and MX as the world sees them, and checks each rua/ruf address:
// a report address on ANOTHER domain needs <domain>._report._dmarc.<that domain> TXT "v=DMARC1" or receivers ignore it.
//   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-dmarc-check.php && php r.php
$d = 'sporta.com.kw';
$txt = function ($n) { $r = @dns_get_record($n, DNS_TXT) ?: []; return array_map(fn ($x) => implode('', $x['entries'] ?? [$x['txt'] ?? '']), $r); };
$dm = $txt('_dmarc.' . $d);
echo 'DMARC count=' . count($dm) . ' ' . json_encode($dm, JSON_UNESCAPED_SLASHES) . "\n";
echo 'SPF ' . json_encode(array_values(array_filter($txt($d), fn ($t) => stripos($t, 'v=spf1') === 0)), JSON_UNESCAPED_SLASHES) . "\n";
$mx = @dns_get_record($d, DNS_MX) ?: []; echo 'MX ' . implode(',', array_map(fn ($m) => $m['target'], $mx)) . "\n";
foreach ($dm as $rec) foreach (['rua', 'ruf'] as $tag) if (preg_match('/\b' . $tag . '=([^;]+)/i', $rec, $m)) {
    foreach (explode(',', $m[1]) as $u) { $u = trim($u);
        if (!preg_match('/^mailto:[^@\s]+@([A-Za-z0-9.-]+)(!\d+[kmgt]?)?$/i', $u, $mm)) { echo "$tag BAD-URI " . $u . "\n"; continue; }
        $host = strtolower($mm[1]);
        if ($host === $d || str_ends_with($host, '.' . $d)) { echo "$tag $u same-domain ok\n"; continue; }
        $auth = $txt($d . '._report._dmarc.' . $host);
        $ok = (bool) array_filter($auth, fn ($t) => stripos($t, 'v=DMARC1') === 0);
        echo "$tag $u external authorized=" . ($ok ? 'yes' : 'NO') . "\n";
    }
}
