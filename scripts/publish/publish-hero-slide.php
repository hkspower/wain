<?php
/**
 * Put the all-black banner live as the shop's hero slide.
 *
 * WHY THIS IS A DATABASE WRITE AND NOT A FILE PUBLISH. Every other publisher in
 * this directory copies bytes into public_html. A hero slide is not a file:
 * `hero_slides.image` holds a data: URI and api.php serves it from the row
 * through `?r=slide_image`, which is why api.php says in its own words that
 * this "is why nothing on this server needs write access to the web root". The
 * /hero/*.webp files are a different thing entirely — index.html's boot shell
 * paints one before React exists, and the React hero reads the database.
 *
 * WHAT THE SHOP DOES WITH NO ROWS, which is the state before this runs. The
 * bundle falls back to five DRAWN slides when `slides` is empty. So this is not
 * "add a slide to a carousel": it is the moment the front page stops showing
 * drawn art and starts showing a photograph. One active row means one slide,
 * and the bundle hides the arrows and dots at `b > 1`.
 *
 * NO TITLE, NO SUBTITLE, NO CTA, deliberately. The headline is BURNT INTO the
 * artwork — the Arabic line and the English under it were composed, kerned and
 * fitted to the band inside the picture. Setting title_ar as well would draw
 * the shop's own overlay on top of type that is already there, in a different
 * font, at a different size. Every text column is left null.
 *
 * FOCAL 15/50 IS NOT A TASTE. The banner is 2.52:1 and the phone's hero box is
 * 2.10:1, so a phone crops the sides; the composition was built against
 * `object-position: 15% center` and the subjects were shifted to survive
 * exactly that crop. A focal point anywhere else re-crops the picture through
 * the faces, which is the defect this artwork was rebuilt to fix.
 *
 * IDEMPOTENT, AND IT REPORTS STATE RATHER THAN ITS OWN VERB. CLAUDE.md records
 * why: cron keeps the LAST run's output, and on a per-minute job that is not
 * the run that did the work — so a script that says "inserted" reports
 * "already-there" a minute later and the two are indistinguishable from a path
 * that was always wrong. This prints the same line whether it just wrote the
 * row or found it already correct, and the line names the SHA and the id.
 *
 * THE BYTES ARE VERIFIED BEFORE THEY REACH THE DATABASE. $SHA is the artwork's
 * sha256 in the repository. An empty fetch, a truncated one, a wrong commit or
 * a tampered file all fail here and nothing is written — the guard written for
 * a tampered fetch is the one that has repeatedly caught ordinary mistakes.
 *
 * $COMMIT PINS THE ARTWORK, NOT THIS SCRIPT. Fetch the script itself from HEAD;
 * an older copy of a publisher silently does less and says so only in a number.
 *
 * It prints no secret: it reads api/config.php for the database password the
 * same way live-scan.php does, and prints none of it.
 */

// THE FULL SHA, NOT THE ABBREVIATION. Measured 2026-09-11: this same artwork
// at `21e4687` answered 404 three times running while the full forty characters
// answered 200 — raw.githubusercontent does not reliably resolve an abbreviated
// commit. Other publishers here carry short ones and happened to work, which is
// worse than failing: an unresolvable ref is an EMPTY fetch, and CLAUDE.md
// already records a publish lost to exactly that (a branch name with a slash in
// it, read as a ref, returning nothing and saying nothing).
$COMMIT = '21e4687b173ef9230f1ef24a64f8d98986827a29';
$ART    = 'assets/hero/all-black-banner.webp';
$SHA    = 'c805e838a29d5e55da0c33155ddb0769c537309b5b476040170e08eade37848e';
$W      = 3200;
$H      = 1270;
$FX     = 15;   // the composition's own object-position
$FY     = 50;

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

$out = [];

// ------------------------------------------------------------------ the bytes
$ch = curl_init('https://raw.githubusercontent.com/hkspower/wain/' . $COMMIT . '/' . $ART);
curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
                        CURLOPT_FOLLOWLOCATION => true]);
$body = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!is_string($body) || $code !== 200) {
    echo "SLIDE fetch=FAILED http=$code bytes=" . strlen((string) $body) . "\n";
    return;
}
$got = hash('sha256', $body);
if ($got !== $SHA) {
    // Name both, because "not equal" is a question you then have to guess at.
    echo "SLIDE fetch=HASH-MISMATCH bytes=" . strlen($body)
       . " want=" . substr($SHA, 0, 12) . " got=" . substr($got, 0, 12) . "\n";
    return;
}
// The shop's own validator would refuse anything that is not really a webp;
// check the same two markers here so a bad file never reaches the row.
if (substr($body, 0, 4) !== 'RIFF' || substr($body, 8, 4) !== 'WEBP') {
    echo "SLIDE fetch=NOT-A-WEBP bytes=" . strlen($body) . "\n";
    return;
}

$uri = 'data:image/webp;base64,' . base64_encode($body);
if (strlen($uri) > 1200000) {          // STORE_HERO_MAX
    echo "SLIDE uri=TOO-LARGE len=" . strlen($uri) . " max=1200000\n";
    return;
}

// --------------------------------------------------------------------- the db
$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "SLIDE db=NO-CONFIG\n"; return; }

try {
    $pdo = new PDO(
        "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
        $cfg['db_user'], $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 15]
    );

    // Identified by the artwork's hash rather than by an id, so re-running is
    // safe and so a re-render with new bytes is a NEW slide rather than a
    // silent overwrite of something the owner may have edited by hand.
    $find = $pdo->prepare('select id, active, sort from hero_slides where image_hash = ?');
    $find->execute([$SHA]);
    $row = $find->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        // Present already. Make sure it is ON — that is the only thing this
        // script insists on for an existing row; it does not restyle it.
        if ((int) $row['active'] !== 1) {
            $pdo->prepare('update hero_slides set active = 1 where id = ?')->execute([$row['id']]);
        }
        $id = (int) $row['id'];
    } else {
        $ins = $pdo->prepare(
            'insert into hero_slides (sort, active, image, image_hash, image_w, image_h,
                                      focal_x, focal_y)
             values (?, 1, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([0, $uri, $SHA, $W, $H, $FX, $FY]);
        $id = (int) $pdo->lastInsertId();
    }

    // THE STATE, read back from the database rather than assumed from the
    // write — a check that cannot fail is not a check.
    $q = $pdo->prepare('select active, image_w, image_h, focal_x, focal_y,
                               title_ar is null as noTitle, length(image) as len
                          from hero_slides where id = ?');
    $q->execute([$id]);
    $s = $q->fetch(PDO::FETCH_ASSOC);
    $live = (int) $pdo->query(
        'select count(*) from hero_slides where active = 1 and image is not null'
    )->fetchColumn();

    echo "SLIDE id=$id active={$s['active']} sha=" . substr($SHA, 0, 12)
       . " len={$s['len']} dims={$s['image_w']}x{$s['image_h']}"
       . " focal={$s['focal_x']}/{$s['focal_y']} noTitle={$s['noTitle']}"
       . " activeSlides=$live\n";
} catch (Throwable $e) {
    echo "SLIDE db=ERROR " . str_replace(["\n", "\r"], ' ', $e->getMessage()) . "\n";
}
