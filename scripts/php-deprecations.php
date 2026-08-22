<?php
// Static scan for constructs that PHP has already deprecated, since those are
// what become fatal in a later version. Reported per file with line numbers.
$root = $argv[1] ?? '.';
$rules = [
  // Deprecated in 8.1, still working, removal expected.
  '/\bstrftime\s*\(/'                    => 'strftime() — deprecated 8.1',
  '/\bgmstrftime\s*\(/'                  => 'gmstrftime() — deprecated 8.1',
  '/\bstrptime\s*\(/'                    => 'strptime() — deprecated 8.1',
  '/\butf8_(en|de)code\s*\(/'            => 'utf8_encode/decode — deprecated 8.2',
  '/\bdate_sunrise\s*\(|\bdate_sunset\s*\(/' => 'date_sunrise/sunset — deprecated 8.1',
  // Passing null to a non-nullable internal parameter — deprecated 8.1 and the
  // single most common source of noise on an upgrade.
  '/\bE_STRICT\b/'                       => 'E_STRICT — deprecated 8.4',
  // A CALL, not a word. The first version matched `mysql_` anywhere and
  // reported six hits in preflight.php, every one of them a config KEY named
  // mysql_host or mysql_name. A scanner that cries wolf is worse than none.
  '/(?<![\w$>\'"])mysql_[a-z_]+\s*\(/'   => 'ext/mysql — removed in PHP 7',
  '/\beach\s*\(/'                        => 'each() — removed in PHP 8',
  '/\bcreate_function\s*\(/'             => 'create_function() — removed in PHP 8',
  '/\$\{[A-Za-z_]/'                      => '${} string interpolation — deprecated 8.2',
  '/\bassert\s*\(\s*[\'"]/'              => 'assert() on a string — removed in PHP 8',
  '/\bmb_check_encoding\s*\(\s*\)/'      => 'mb_check_encoding() with no argument — deprecated 8.1',
  // IMPLICITLY nullable means a typed parameter defaulting to null WITHOUT a
  // leading `?`. The first version keyed off the return type instead and
  // reported three functions whose parameters were already `?string`, which is
  // the correct form it was supposed to be looking for.
  // Inside a PARAMETER LIST — after a `(` or a `,` — and not `static $x = null`,
  // which is a static variable and matched five more times before this clause
  // was added. `static` and `self` are gone from the type list for the same
  // reason.
  '/[(,]\s*(?:int|float|string|bool|array|object|callable|iterable|[A-Z]\w+)\s+\$\w+\s*=\s*null\b/' => 'implicitly nullable parameter — deprecated 8.4',
];
$hits = 0;
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
foreach ($it as $f) {
    if ($f->getExtension() !== 'php') continue;
    // Not itself. The rule table below is a list of the very calls it looks
    // for, so scanning this file reports every rule as a finding — seven of
    // them, all of them noise, and enough of it to hide a real one.
    if ($f->getRealPath() === __FILE__) continue;
    $lines = file($f->getPathname());
    foreach ($lines as $n => $line) {
        foreach ($rules as $re => $why) {
            if (preg_match($re, $line)) {
                printf("%s:%d  %s\n    %s\n", $f->getPathname(), $n + 1, $why, trim($line));
                $hits++;
            }
        }
    }
}
echo $hits ? "\n$hits potential issues\n" : "\nnothing deprecated found\n";
