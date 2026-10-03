<?php
// READ-ONLY report of the PHP setup, BOTH ways it runs: command-line (what cron runs) and the web handler
// that serves the shop. The two can differ. The web half needs a request, so a probe file with a random
// name is written into api/, fetched once over the loopback, and deleted in the same run (it prints only
// the values below — no phpinfo(), no paths beyond these, no environment).
declare(strict_types=1);
header('Content-Type: text/plain; charset=utf-8');
$probe = <<<'P'
<?php
header('Content-Type: text/plain');
$ext = ['pdo_mysql','curl','openssl','mbstring','gd','zip','json','fileinfo','sodium','intl','zlib','exif','imagick','opcache','Zend OPcache'];
$have = []; foreach ($ext as $e) $have[] = $e . '=' . (extension_loaded($e) ? 'y' : 'n');
$ini = ['memory_limit','max_execution_time','upload_max_filesize','post_max_size','display_errors','log_errors','error_reporting','expose_php','allow_url_fopen','date.timezone','session.gc_maxlifetime','session.cookie_secure','session.use_strict_mode','opcache.enable','opcache.validate_timestamps','opcache.revalidate_freq','opcache.memory_consumption','max_input_vars','disable_functions'];
$v = []; foreach ($ini as $i) { $x = ini_get($i); $v[] = $i . '=' . ($x === false ? '-' : ($x === '' ? '""' : substr((string)$x, 0, 120))); }
$gd = function_exists('gd_info') ? gd_info() : [];
echo 'SAPI=' . PHP_SAPI . ' PHP=' . PHP_VERSION . "\nEXT " . implode(' ', $have) . "\nINI " . implode(' ', $v)
   . "\nGD webp=" . (!empty($gd['WebP Support']) ? 'y' : 'n') . ' jpeg=' . (!empty($gd['JPEG Support']) ? 'y' : 'n') . ' png=' . (!empty($gd['PNG Support']) ? 'y' : 'n')
   . ' curlTLS=' . (function_exists('curl_version') ? (curl_version()['ssl_version'] ?? '-') : '-') . ' http2=' . (defined('CURL_HTTP_VERSION_2_0') && (curl_version()['features'] & CURL_VERSION_HTTP2) ? 'y' : 'n') . "\n";
P;
echo "== CLI\n"; eval('?>' . $probe);
$name = 'p' . bin2hex(random_bytes(12)) . '.php';
$path = '/home/u130124229/domains/sporta.com.kw/public_html/api/' . $name;
file_put_contents($path, $probe);
$ch = curl_init('https://www.sporta.com.kw/api/' . $name);
curl_setopt_array($ch, [CURLOPT_RESOLVE => ['www.sporta.com.kw:443:127.0.0.1'], CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => 0, CURLOPT_TIMEOUT => 10]);
$body = (string) curl_exec($ch); $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
@unlink($path);
echo "== WEB (HTTP $code)\n" . $body . 'probeRemoved=' . (is_file($path) ? 'NO' : 'yes') . "\n";
