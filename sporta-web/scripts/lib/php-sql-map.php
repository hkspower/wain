<?php
// php-sql-map.php — a READ-ONLY map of the SQL a set of PHP files can send.
//
//   php scripts/lib/php-sql-map.php file.php [file.php ...]   > map.json
//
// It uses PHP's own tokenizer (token_get_all), so a quote inside a comment, a
// heredoc or a concatenation is read the way PHP reads it, and prints JSON:
//
//   { "<dir>/<file>": { "top":   { "calls": [...], "sql": [{line, text}], "includes": [...] },
//                 "funcs": { "<name>": { "line": n, "calls": [...], "sql": [...] } } } }
//
// WHAT COUNTS AS SQL. Every string expression (a literal, or literals joined
// with `.`, with `{$var}` marking an interpolated variable) is kept as a
// candidate; the caller decides which candidates are statements. Nothing is
// executed and nothing connects to a database. Calls are the names written as
// `name(`, which is enough to follow this code base's procedural functions from
// an entry point to the SQL they send (test:db-least-privilege does that).
//
// Used by scripts/db-least-privilege-test.mjs to prove that ops/db/grants.sql
// grants every table/privilege the code can use, and nothing more than that.
declare(strict_types=1);

$out = [];
foreach (array_slice($argv, 1) as $file) {
    $src = @file_get_contents($file);
    if ($src === false) { fwrite(STDERR, "cannot read $file\n"); exit(2); }
    $toks = token_get_all($src);
    $n = count($toks);
    $name = basename(dirname($file)) . "/" . basename($file);
    $out[$name] = ['top' => ['calls' => [], 'sql' => [], 'includes' => []], 'funcs' => []];
    // Where we are: '' = file top level, else the enclosing named function.
    $cur = '';
    $braceDepth = 0;
    $funcStack = [];      // [depth at which the function's body closes, name]
    $pendingFunc = null;  // a function name seen, waiting for its opening brace
    $declNameAt = -1;     // token index of a function's own name: a declaration, not a call
    $buf = null; $bufLine = 0; $pendingConcat = false;
    $target = function () use (&$out, $name, &$cur) {
        return $cur === '' ? '__top' : $cur;
    };
    $emit = function () use (&$buf, &$bufLine, &$out, $name, &$cur) {
        if ($buf !== null && trim($buf) !== '') {
            $slot = $cur === '' ? ['top'] : ['funcs', $cur];
            if ($slot[0] === 'top') $out[$name]['top']['sql'][] = ['line' => $bufLine, 'text' => $buf];
            else $out[$name]['funcs'][$cur]['sql'][] = ['line' => $bufLine, 'text' => $buf];
        }
        $buf = null;
    };
    $addCall = function (string $callee) use (&$out, $name, &$cur) {
        if ($cur === '') $out[$name]['top']['calls'][$callee] = true;
        else $out[$name]['funcs'][$cur]['calls'][$callee] = true;
    };
    $line = 1;
    for ($i = 0; $i < $n; $i++) {
        $t = $toks[$i];
        if (is_array($t)) {
            [$id, $text, $ln] = $t; $line = $ln;
            switch ($id) {
                case T_FUNCTION:
                    // Look ahead for `function name(` (skip `function (` closures and `&`).
                    $j = $i + 1;
                    while ($j < $n && is_array($toks[$j]) && $toks[$j][0] === T_WHITESPACE) $j++;
                    if ($j < $n && $toks[$j] === '&') { $j++; while ($j < $n && is_array($toks[$j]) && $toks[$j][0] === T_WHITESPACE) $j++; }
                    if ($j < $n && is_array($toks[$j]) && $toks[$j][0] === T_STRING) {
                        $pendingFunc = $toks[$j][1];
                        $declNameAt = $j;
                        $out[$name]['funcs'][$pendingFunc] = ['line' => $ln, 'calls' => [], 'sql' => []];
                    }
                    $emit();
                    continue 2;
                case T_CONSTANT_ENCAPSED_STRING:
                    $q = $text[0];
                    $inner = substr($text, 1, -1);
                    $inner = $q === "'" ? str_replace(["\\'", "\\\\"], ["'", "\\"], $inner) : stripcslashes($inner);
                    if ($buf === null) { $buf = $inner; $bufLine = $ln; } else $buf .= $inner;
                    $pendingConcat = false;
                    continue 2;
                case T_START_HEREDOC:
                    $j = $i + 1; $h = '';
                    while ($j < $n && !(is_array($toks[$j]) && $toks[$j][0] === T_END_HEREDOC)) {
                        $h .= is_array($toks[$j]) ? ($toks[$j][0] === T_VARIABLE ? '{$' . ltrim($toks[$j][1], '$') . '}' : $toks[$j][1]) : $toks[$j];
                        $j++;
                    }
                    if ($buf === null) { $buf = $h; $bufLine = $ln; } else $buf .= $h;
                    $i = $j; $pendingConcat = false;
                    continue 2;
                case T_VARIABLE:
                    if ($buf !== null && $pendingConcat) { $buf .= '{$' . ltrim($text, '$') . '}'; $pendingConcat = false; continue 2; }
                    $emit();
                    continue 2;
                case T_WHITESPACE: case T_COMMENT: case T_DOC_COMMENT:
                    continue 2;
                case T_REQUIRE: case T_REQUIRE_ONCE: case T_INCLUDE: case T_INCLUDE_ONCE:
                    // Collect the quoted path that follows (ignore __DIR__ . concatenation noise).
                    $j = $i + 1; $p = '';
                    while ($j < $n && $toks[$j] !== ';') {
                        if (is_array($toks[$j]) && $toks[$j][0] === T_CONSTANT_ENCAPSED_STRING) $p .= trim($toks[$j][1], "'\"");
                        $j++;
                    }
                    if ($p !== '') $out[$name]['top']['includes'][] = ltrim($p, '/');
                    $emit();
                    $i = $j;
                    continue 2;
                case T_STRING:
                    // `name(` is a call; `->name(` / `::name(` is a method call (recorded under its bare name too).
                    $j = $i + 1;
                    while ($j < $n && is_array($toks[$j]) && $toks[$j][0] === T_WHITESPACE) $j++;
                    if ($i !== $declNameAt && $j < $n && $toks[$j] === '(') $addCall($text);
                    $emit();
                    continue 2;
                default:
                    $emit();
                    continue 2;
            }
        } else {
            if ($t === '"') {
                $j = $i + 1; $h = '';
                while ($j < $n && $toks[$j] !== '"') {
                    $h .= is_array($toks[$j]) ? ($toks[$j][0] === T_VARIABLE ? '{$' . ltrim($toks[$j][1], '$') . '}' : $toks[$j][1]) : $toks[$j];
                    $j++;
                }
                if ($buf === null) { $buf = $h; $bufLine = $line; } else $buf .= $h;
                $i = $j; $pendingConcat = false;
                continue;
            }
            if ($t === '.' && $buf !== null) { $pendingConcat = true; continue; }
            if ($t === '{') {
                $braceDepth++;
                if ($pendingFunc !== null) { $funcStack[] = [$braceDepth, $pendingFunc]; $cur = $pendingFunc; $pendingFunc = null; }
                $emit();
                continue;
            }
            if ($t === '}') {
                $emit();
                if ($funcStack && end($funcStack)[0] === $braceDepth) { array_pop($funcStack); $cur = $funcStack ? end($funcStack)[1] : ''; }
                $braceDepth--;
                continue;
            }
            $emit();
        }
    }
    $emit();
    foreach ($out[$name]['funcs'] as &$f) $f['calls'] = array_keys($f['calls']);
    unset($f);
    $out[$name]['top']['calls'] = array_keys($out[$name]['top']['calls']);
}
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_SLASHES), "\n";
