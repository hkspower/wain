<?php
// Sporta admin API — what the React /backends screen calls.
// Place at public_html/api/. Every route below ?r=login requires the session.
//
// The shapes returned here are the SAME shapes admin/api.js already hands the
// screens expected — stats keys, order columns, nested product names on
// items — so the admin UI does not know or care which backend it is on. The
// contract is the UI's, not the database's.

declare(strict_types=1);
require __DIR__ . '/store.php';

$r = $_GET['r'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$db = store_db();

// ---------------------------------------------------------------- throttling
// This file had NONE, and the login lockout is not a substitute for it.
//
// That lockout is PER ACCOUNT — five failures freeze one email for fifteen
// minutes. It says nothing about an attacker who sprays one guess across a
// hundred addresses, or who simply hammers ?r=me (unauthenticated, and it runs
// a count over admin_users on every call). Neither is slowed by an account
// lock, and both are free database load on shared hosting.
//
// The ceiling is deliberately high. An admin opening the dashboard fires a
// dozen requests before they have touched anything — stats, revenue, orders,
// items, products — and a limit that interrupts real work is one that gets
// removed. This is a bound on machines, not on people.
//
// IT WAS 240 A MINUTE, AND THAT WAS NOT HIGH ENOUGH. Measured: signing in and
// clicking through every screen of the panel costs about 24 requests, so 240
// looks like ten times the headroom one person needs. Two things spend it much
// faster than that.
//
// The Stock screen saves one request per size row. The catalogue has 120 size
// rows waiting for counts to be typed into it, and an owner working through
// them steadily reaches 240 partway down the list — then the panel starts
// refusing saves, in the middle of a job, with no way to tell that from a
// broken server.
//
// And the counter is per IP, so everyone in the office shares one allowance.
// Two people on the panel at once each get half of it.
//
// 1200 is five minutes of one person working flat out, or twenty minutes of
// normal use, and it is still four hundred times what any human types. It
// bounds a script, which is all it was ever for; the thing that actually
// protects the password is the per-account lockout in store_login(), and that
// is untouched.
//
// Failed LOGINS are counted separately and inside store_login(), on the
// failure path only: a signed-in admin reloading their screen is not guessing,
// and the same distinction the discount route makes applies here.
store_throttle($db, 'admin', 1200, 60);

// ------------------------------------------------------------------- session
if ($r === 'login' && $method === 'POST') {
    store_require_admin_header();
    $b = store_body();
    $who = store_login((string)($b['email'] ?? ''), (string)($b['password'] ?? ''));
    // need_code is the whole point of the answer when a second factor is
    // enrolled — without it the screen has no way to know it should ask, and
    // would sit there believing it had signed in while every route said 401.
    store_out([
        'email' => $who['email'],
        'need_code' => !empty($who['need_code']),
        // WHICH factor, and where it went. Without these the screen can only
        // say "enter your code" — which is the wrong instruction for half the
        // accounts, and useless for the owner staring at an authenticator app
        // they never installed while a code sits in their inbox.
        'code_via' => $who['code_via'] ?? null,
        'code_sent_to' => $who['code_sent_to'] ?? null,
        // FALSE MEANS THE MAIL DID NOT GO. Said out loud so the screen can
        // tell them, rather than asking for a code that was never sent.
        'code_sent' => $who['code_sent'] ?? null,
    ]);
}

// Create the FIRST admin account — and only ever the first.
//
// THE GAP THIS FILLS IS ONE THIS FILE ALREADY NAMED. Both `me` and
// store_login() count admin_users and answer no_admin_account (409) when it is
// empty, so the panel can say "this shop has no administrator yet" instead of
// telling the owner their correct password is wrong. Neither offered a way
// forward: the only way to make that first account was to hand-write a row,
// with a hash minted by php -r, which is what scripts/sandbox.sh still does.
// So the shop shipped a screen that diagnoses a problem it cannot fix.
//
// IT IS NOT A SIGN-UP, AND THE DIFFERENCE IS THE WHOLE DESIGN. An admin panel
// that lets a stranger create an administrator is not a feature, it is the
// door left open. This route can only ever fire while admin_users holds
// NOTHING — the moment one account exists it answers already_set_up, and does
// so forever. On this shop, which has an administrator, it is inert: it cannot
// add a second account and it cannot reach the first.
//
// Adding a COLLEAGUE is a different job with a different answer — it belongs
// behind the gate below, done by someone already signed in, and it is
// deliberately not this route.
//
// ONE AT A TIME. Two requests arriving together would both count zero and both
// insert, and the second would either collide with the unique index on email
// or quietly create a second administrator nobody asked for. A named lock
// serialises them; the loser sees already_set_up, which is the truth by then.
// MySQL frees the lock when the connection closes, so the exits below cannot
// strand it even though they skip the release.
if ($r === 'register' && $method === 'POST') {
    store_require_admin_header();
    // Twenty a quarter of an hour, and the number is chosen for what this
    // throttle actually defends. There is no secret here to guess: the route
    // holds no credential, and on a shop with an administrator every answer it
    // gives is already_set_up. What it defends is the narrow window while
    // admin_users is empty, and the lock below, against being hammered.
    //
    // Six was the first value and it was too mean twice over. A person setting
    // a shop up mistypes an address and picks a short password before they get
    // it right, and each of those spends an attempt — validation runs before
    // the count, deliberately. And the live rig makes four register calls per
    // run, so two runs inside the window failed on the throttle rather than on
    // anything real. A test that fails because it was run twice is a bad test.
    store_throttle($db, 'admin_register', 20, 900);
    $b = store_body();
    $email = mb_strtolower(trim((string)($b['email'] ?? '')));
    $pass  = (string)($b['password'] ?? '');

    if ($email === '' || mb_strlen($email) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        store_fail('bad_email');
    }
    // TWELVE, because that is what changing a password already demands further
    // down this file. A floor lower at the door than in the corridor protects
    // nothing.
    if (strlen($pass) < 12) store_fail('password_too_short');

    if ((int)$db->query("select get_lock('sporta_admin_register', 5)")->fetchColumn() !== 1) {
        store_fail('busy', 503);
    }
    if ((int)$db->query('select count(*) from admin_users')->fetchColumn() > 0) {
        $db->query("select release_lock('sporta_admin_register')");
        store_fail('already_set_up', 409);
    }
    $ins = $db->prepare('insert into admin_users (email, password_hash) values (?, ?)');
    $ins->execute([$email, password_hash($pass, PASSWORD_DEFAULT)]);
    $id = (int)$db->lastInsertId();
    $db->query("select release_lock('sporta_admin_register')");

    // Signed in immediately, through the SAME function both login paths end in,
    // so a newly made administrator and a returning one cannot drift into
    // different ideas of what a session is. They chose the password one line
    // ago; asking them to type it again proves nothing.
    store_admin_grant($db, ['id' => $id, 'email' => $email]);
    store_out(['email' => $email]);
}

// Send the emailed code again, while sign-in is half done.
//
// ABOVE THE GATE, like login_code, because there is no session yet — only the
// pending marker. It can therefore only ever mail the ONE account that marker
// names, and only to the address already on that account: it is not a route
// that sends mail to an address of the caller's choosing.
if ($r === 'login_code_resend' && $method === 'POST') {
    store_require_admin_header();
    store_session_start();
    $id = (int)($_SESSION['pending_admin_id'] ?? 0);
    $since = (int)($_SESSION['pending_at'] ?? 0);
    if ($id === 0 || (string)($_SESSION['pending_via'] ?? '') !== 'email'
        || time() - $since > STORE_EMAIL_OTP_SECONDS) {
        store_fail('code_expired', 401);
    }
    $q = $db->prepare('select id, email, email_otp_enabled, email_otp_sent_at
                         from admin_users where id = ?');
    $q->execute([$id]);
    $u = $q->fetch();
    if (!$u || (int)$u['email_otp_enabled'] !== 1) store_fail('code_expired', 401);
    // One a minute, from the row itself rather than a counter that a new
    // session would reset. Also throttled per IP, because the row is per
    // account and a spray is per address.
    if ($u['email_otp_sent_at'] !== null
        && time() - strtotime((string)$u['email_otp_sent_at']) < STORE_EMAIL_OTP_RESEND_SECONDS) {
        store_fail('too_soon', 429);
    }
    store_throttle($db, 'otp_send', 6, 900);
    $code = store_email_otp_issue($db, $u);
    store_out(['sent' => store_email_otp_send($u, $code),
               'to' => store_mask_email((string)$u['email'])]);
}

// Step two of sign-in. Above the gate on purpose: there is no session yet, only
// the pending marker store_login() left, and that marker is worth nothing on
// its own — it names an account and expires in five minutes.
if ($r === 'login_code' && $method === 'POST') {
    store_require_admin_header();
    $b = store_body();
    $who = store_login_code((string)($b['code'] ?? ''));
    store_out(['email' => $who['email']]);
}

if ($r === 'logout' && $method === 'POST') {
    store_session_start();
    // Clears the cookie as well as the server-side session. Emptying $_SESSION
    // and calling session_destroy() left the browser holding an id — expired
    // server-side, but still sent on every request, and still the thing an
    // attacker with the cookie would replay against a session PHP had not yet
    // collected.
    store_session_end();
    store_out(['ok' => true]);
}

if ($r === 'me') {
    // store_session_admin(), not store_session_start(): an expired session must
    // read as signed OUT here, or the dashboard renders around a session every
    // other route will refuse.
    $who = store_session_admin();
    if ($who === null) {
        // Not signed in — so answer the OTHER question the screen needs before
        // it offers a password box: is there anything to sign in to? Without
        // this, a server whose SQL was never imported and a server with no
        // account both look like a plain login, and the first thing the owner
        // learns is that their correct password is "wrong". One cheap count on
        // a tiny table, and only on the signed-out path.
        if ((int)$db->query('select count(*) from admin_users')->fetchColumn() === 0) {
            store_fail('no_admin_account', 409);
        }
        store_out(null);
    }
    // The Security screen needs these two on the very first render, and asking
    // for them separately would mean a flash of "two-factor: off" on a shop
    // that has it on.
    $u = $db->prepare('select totp_enabled, phone from admin_users where id = ?');
    $u->execute([$who['id']]);
    $row = $u->fetch() ?: [];
    store_out([
        'email'   => $who['email'],
        'phone'   => $row['phone'] ?? null,
        'totp'    => (int)($row['totp_enabled'] ?? 0) === 1,
    ]);
}

// Everything below this line is an admin.
$admin = store_require_admin();

// --------------------------------------------------------------------- stats
// Same columns as admin_order_stats — Overview reads these keys by name.
if ($r === 'stats') {
    $row = $db->query("
        select
          count(case when payment_status = 'paid' then 1 end)                          as paid_count,
          coalesce(sum(case when payment_status = 'paid' then amount end), 0)          as paid_revenue,
          count(case when payment_status = 'pending' then 1 end)                       as pending_count,
          count(case when payment_status = 'review' then 1 end)                        as review_count,
          count(case when payment_status = 'failed' then 1 end)                        as failed_count,
          count(case when payment_status = 'paid' and fulfilment_status = 'unfulfilled' then 1 end) as unfulfilled_count,
          count(case when payment_status = 'paid' and paid_at >= curdate() then 1 end) as paid_today,
          coalesce(sum(case when payment_status = 'paid' and paid_at >= curdate() then amount end), 0) as revenue_today,
          count(case when payment_status = 'paid' and paid_at >= curdate() - interval 7 day then 1 end) as paid_7d,
          coalesce(sum(case when payment_status = 'paid' and paid_at >= curdate() - interval 7 day then amount end), 0) as revenue_7d,
          count(case when payment_method = 'cod' and payment_status = 'pending' then 1 end) as cod_awaiting_count,
          coalesce(sum(case when payment_method = 'cod' and payment_status = 'pending' then amount end), 0) as cod_awaiting_amount
        from orders
    ")->fetch();
    store_out($row);
}

if ($r === 'revenue') {
    $days = max(1, min(60, (int)($_GET['days'] ?? 14)));
    $q = $db->prepare("
        select date(paid_at) as day, sum(amount) as revenue
          from orders
         where payment_status = 'paid' and paid_at >= curdate() - interval ? day
         group by date(paid_at) order by day
    ");
    $q->execute([$days]);
    store_out($q->fetchAll());
}

// -------------------------------------------------------------------- orders
if ($r === 'orders') {
    $sql = 'select id, track_id, amount, payment_status, payment_method, fulfilment_status,
                   paid_at, created_at, customer_name, customer_phone, customer_email, customer_area,
                   customer_note, customer_governorate, customer_block, customer_street,
                   customer_building, customer_floor, customer_flat,
                   cbk_paymentid, cbk_reference, cbk_status,
                   -- Which ad produced the order. The whole point of recording
                   -- it is that the owner can see it beside the money.
                   utm_source, utm_medium, utm_campaign, referrer_host
              from orders';
    $where = [];
    $args = [];
    $payment = $_GET['payment'] ?? 'all';
    $fulfilment = $_GET['fulfilment'] ?? 'all';
    if (in_array($payment, ['paid','pending','review','failed'], true)) {
        $where[] = 'payment_status = ?'; $args[] = $payment;
    }
    if (in_array($fulfilment, ['unfulfilled','packed','shipped','delivered','cancelled'], true)) {
        $where[] = 'fulfilment_status = ?'; $args[] = $fulfilment;
    }
    $term = trim((string)($_GET['search'] ?? ''));
    if ($term !== '') { $where[] = 'track_id like ?'; $args[] = '%' . $term . '%'; }
    if ($where) $sql .= ' where ' . implode(' and ', $where);
    $sql .= ' order by created_at desc limit ' . max(1, min(500, (int)($_GET['limit'] ?? 100)));
    $q = $db->prepare($sql);
    $q->execute($args);
    $rows = $q->fetchAll();
    foreach ($rows as &$row) { $row['amount'] = (float)$row['amount']; $row['id'] = (int)$row['id']; }
    store_out($rows);
}

if ($r === 'items') {
    // Nested `products` object, matching the join shape the Orders
    // screen already renders.
    $q = $db->prepare(
        // The name AS SOLD, falling back to the catalogue for lines placed
        // before order_items carried it. The owner reading an order in
        // /backends must see what the customer's invoice says, or a return
        // conversation has the two of them describing different items.
        'select oi.id, oi.qty, oi.unit_price, oi.size, oi.fit, p.slug,
                coalesce(oi.name_en, p.name_en) as name_en,
                coalesce(oi.name_ar, p.name_ar) as name_ar
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ?'
    );
    $q->execute([(int)($_GET['order'] ?? 0)]);
    $out = [];
    foreach ($q->fetchAll() as $row) {
        $out[] = [
            'id' => (int)$row['id'], 'qty' => (int)$row['qty'],
            'unit_price' => (float)$row['unit_price'],
            'size' => $row['size'], 'fit' => $row['fit'],
            'products' => ['slug' => $row['slug'], 'name_en' => $row['name_en'], 'name_ar' => $row['name_ar']],
        ];
    }
    store_out($out);
}

if ($r === 'fulfilment' && $method === 'POST') {
    $b = store_body();
    $status = (string)($b['status'] ?? '');
    if (!in_array($status, ['unfulfilled','packed','shipped','delivered','cancelled'], true)) {
        store_fail('invalid_status');
    }
    $orderId = (int)($b['order_id'] ?? 0);
    $db->prepare('update orders set fulfilment_status = ?,
                    fulfilled_at = case when ? = \'delivered\' then now() else fulfilled_at end
                  where id = ?')
       ->execute([$status, $status, $orderId]);
    // Tell the customer it is on its way. Only on 'shipped': 'packed' is an
    // internal state that means nothing to a shopper, and 'delivered' arrives
    // after they are holding the bag. The unique index makes this safe to call
    // again when an order is re-marked, which the admin screen allows.
    if ($status === 'shipped') store_queue_whatsapp($db, $orderId, 'shipped');
    // And ask what they thought, once it is actually in their hands. 'delivered'
    // is the only honest moment for this: a review invitation that arrives
    // while the order is still with the courier is asking someone to rate a
    // parcel they have not opened. The unique index on (order_id, kind) makes
    // re-marking an order safe — the admin screen allows it, and it must not
    // send a second invitation.
    if ($status === 'delivered') store_queue_whatsapp($db, $orderId, 'review');
    store_out(['ok' => true]);
}

// Settle (or un-settle) a cash order. The one narrow path that may touch
// payment_status, same as admin_set_cod_paid: card payments are confirmed by
// the bank's callback, never by a person with an admin session.
if ($r === 'cod_paid' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['order_id'] ?? 0);
    $paid = (bool)($b['paid'] ?? true);
    $q = $db->prepare('select payment_method, payment_status from orders where id = ?');
    $q->execute([$id]);
    $o = $q->fetch();
    if (!$o) store_fail('order_not_found');
    if ($o['payment_method'] !== 'cod') store_fail('not_a_cash_order');
    if ($paid  && $o['payment_status'] !== 'pending') store_fail('order_not_pending');
    if (!$paid && $o['payment_status'] !== 'paid')    store_fail('order_not_paid');

    $db->beginTransaction();
    try {
        $db->prepare('update orders set payment_status = ?, paid_at = ? where id = ?')
           ->execute([$paid ? 'paid' : 'pending', $paid ? date('Y-m-d H:i:s') : null, $id]);
        // Cash collected is a settled outcome: the warehouse follow-up fires
        // exactly as it does when the bank confirms a card.
        if ($paid) store_payment_settled($db, $id, 'paid');
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        store_fail('failed', 500);
    }
    $q2 = $db->prepare('select id, track_id, payment_status, paid_at from orders where id = ?');
    $q2->execute([$id]);
    store_out($q2->fetch());
}

// A card payment the bank took but the callback never reported.
//
// This is the one real gap the KNET flow leaves, and it is not hypothetical:
// KPG hands the result back through the CUSTOMER's browser, so a shopper who
// pays and then closes the tab, loses signal in a lift, or is bounced by a
// flaky redirect leaves the money captured at the bank and the order sitting
// at 'pending' — or at 'review', where callback.php parks anything it could
// not verify. Until now the admin had a warning telling them to check the KNET
// portal and NO control that could act on what they found there; cod_paid
// refuses cards by design, because an admin session must not be able to
// declare a card paid on a hunch.
//
// So: settling a card requires the bank's own payment id, typed in. That is
// the forcing function — you cannot fill it in without having opened the KNET
// portal and found the transaction. It is stored, and the status is recorded
// as MANUAL_BANK_CONFIRMED so a manual settlement can never be mistaken for
// the bank's own callback when the books are read later.
if ($r === 'card_settled' && $method === 'POST') {
    $b = store_body();
    $id  = (int)($b['order_id'] ?? 0);
    $ref = trim((string)($b['bank_reference'] ?? ''));

    $q = $db->prepare('select payment_method, payment_status, cbk_paymentid from orders where id = ?');
    $q->execute([$id]);
    $o = $q->fetch();
    if (!$o) store_fail('order_not_found');
    if ($o['payment_method'] === 'cod')  store_fail('not_a_card_order');
    if ($o['payment_status'] === 'paid') store_fail('order_already_paid');
    // Long enough that it cannot be a shrug. KNET payment ids are numeric and
    // ~12 digits; this stays permissive about format because acquirers differ,
    // but not about the field being filled in.
    if (strlen($ref) < 6 || strlen($ref) > 60) store_fail('bank_reference_required');

    $db->beginTransaction();
    try {
        $db->prepare(
            "update orders set payment_status = 'paid', paid_at = ?,
                    cbk_status = 'MANUAL_BANK_CONFIRMED',
                    cbk_paymentid = ?, cbk_message = ?
              where id = ? and payment_status <> 'paid'"
        )->execute([
            date('Y-m-d H:i:s'),
            $ref,
            'settled in admin by ' . (string)($_SESSION['admin_email'] ?? '?'),
            $id,
        ]);
        store_payment_settled($db, $id, 'paid');
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        store_fail('failed', 500);
    }
    $q2 = $db->prepare('select id, track_id, payment_status, paid_at, cbk_status, cbk_paymentid from orders where id = ?');
    $q2->execute([$id]);
    store_out($q2->fetch());
}

// ---------------------------------------------------------------- products
// The product editor. `sync` pushes the whole shipped catalogue; this is the
// single-row companion — add a piece, change a price, take one off sale.
if ($r === 'products_all') {
    store_out($db->query(
        'select id, slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                sale_starts_at, sale_ends_at, featured, featured_sort, category, brand_slug,
                image, active
           from products order by id desc'
    )->fetchAll());
}

if ($r === 'product_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $slug = store_slug((string)($b['slug'] ?? ''));
    if ($slug === '') store_fail('invalid_slug');
    $nameEn = store_text($b['name_en'] ?? null, 'name_en', 1, 160);
    $nameAr = store_text($b['name_ar'] ?? null, 'name_ar', 1, 160);
    // THE PRICE IS MONEY. Same three-decimal discipline the order path uses:
    // KWD has exactly three, and a price that arrives as 10.5 must be stored
    // as 10.500 or the fils quietly disappear.
    $price = (float)($b['price'] ?? 0);
    if ($price <= 0 || $price > 9999999) store_fail('invalid_price');
    $price = number_format($price, 3, '.', '');
    $active = array_key_exists('active', $b) ? (!empty($b['active']) ? 1 : 0) : 1;

    // The sale price. Optional, and only meaningful BELOW the list price — a
    // "sale" above it would quietly overcharge, which is the kind of mistake
    // nobody reports because the customer just leaves. Refused here rather
    // than ignored at read time, so the admin says so instead of saving
    // something that does nothing.
    $salePrice = $b['sale_price'] ?? null;
    if ($salePrice === '' || $salePrice === null) {
        $salePrice = null;
        $saleFrom = $saleTo = null;
    } else {
        $salePrice = (float)$salePrice;
        if ($salePrice <= 0)              store_fail('invalid_sale_price');
        if ($salePrice >= (float)$price)  store_fail('sale_not_lower');
        $salePrice = number_format($salePrice, 3, '.', '');
        $saleFrom = store_datetime($b['sale_starts_at'] ?? null);
        $saleTo   = store_datetime($b['sale_ends_at'] ?? null);
        if ($saleFrom !== null && $saleTo !== null && $saleFrom > $saleTo) store_fail('sale_dates_backwards');
    }
    $featured = !empty($b['featured']) ? 1 : 0;
    $featuredSort = (int)($b['featured_sort'] ?? 0);

    // WHICH BRAND MADE IT. Checked against the brands table rather than stored
    // as typed: a slug with a typo would silently show no brand on the product
    // page, and "the logo did not appear" is a much harder thing to diagnose
    // than a save that refused. Empty clears it, which is how a product goes
    // back to having no brand.
    // EXTRA PHOTOGRAPHS, as a comma-separated list of same-origin paths.
    // store_internal_href is the same gate the hero buttons pass: a leading //
    // is a HOSTNAME, not a path, so an off-site URL cannot be spelled here.
    // Blank entries are dropped rather than becoming empty <img> tags.
    $extraImages = null;
    $rawImages = trim((string)($b['images'] ?? ''));
    if ($rawImages !== '') {
        $clean = [];
        foreach (explode(',', $rawImages) as $one) {
            $one = trim($one);
            if ($one === '') continue;
            $clean[] = store_internal_href($one);
        }
        $extraImages = $clean ? implode(',', $clean) : null;
    }

    $brandSlug = trim((string)($b['brand_slug'] ?? ''));
    if ($brandSlug === '') {
        $brandSlug = null;
    } else {
        $q = $db->prepare('select 1 from brands where slug = ?');
        $q->execute([$brandSlug]);
        if (!$q->fetchColumn()) store_fail('unknown_brand');
    }

    // WHAT THE SLUG USED TO BE, read before the update overwrites it.
    //
    // product_images, product_variants and size_advice_log are all keyed on
    // products.slug rather than products.id — a deliberate choice, so the
    // catalogue survives being re-imported from the supplier's export. The
    // cost of it is that there is no foreign key and no ON UPDATE CASCADE to
    // carry those rows when the slug changes, and this route lets the owner
    // change it: the slug is an editable field in the product form.
    //
    // So renaming a product silently detached everything hanging off it. Its
    // whole photo shoot stayed in product_images under the old name — not
    // shown on the storefront (?r=products looks up by the new slug and finds
    // nothing, so the grid goes back to a grey box), not visible in the admin
    // (which also lists by slug), and not servable (?r=product_image INNER
    // JOINs products and 404s). The bytes stay in the database forever with
    // nothing able to reach them. The size rows went the same way, which is
    // worse than losing pictures: the garment becomes untracked, every size
    // reads as in stock, and it can be oversold.
    //
    // Measured before this was written: rename one product, and the storefront
    // row's `image` goes from a URL to null while the photograph is still in
    // the table.
    $oldSlug = null;
    if ($id > 0) {
        $prev = $db->prepare('select slug from products where id = ?');
        $prev->execute([$id]);
        $oldSlug = (string)($prev->fetchColumn() ?: '');
        if ($oldSlug === '' || $oldSlug === $slug) $oldSlug = null;
    }

    // ONE TRANSACTION for the product row and its children. A rename that
    // moved the photographs and then failed to move the size rows would leave
    // a garment whose stock is somewhere else entirely, and the shop would
    // keep selling it. Either the whole rename lands or none of it does.
    $renaming = $oldSlug !== null;
    if ($renaming) $db->beginTransaction();
    try {
        if ($id > 0) {
            $db->prepare(
                'update products set slug = ?, name_en = ?, name_ar = ?, desc_en = ?, desc_ar = ?,
                        price = ?, sale_price = ?, sale_starts_at = ?, sale_ends_at = ?,
                        featured = ?, featured_sort = ?, category = ?, brand_slug = ?, image = ?, images = ?, active = ?
                  where id = ?'
            )->execute([$slug, $nameEn, $nameAr, store_opt($b['desc_en'] ?? null),
                        store_opt($b['desc_ar'] ?? null), $price, $salePrice, $saleFrom, $saleTo,
                        $featured, $featuredSort, store_opt($b['category'] ?? null), $brandSlug,
                        store_opt($b['image'] ?? null), $extraImages, $active, $id]);
        } else {
            $db->prepare(
                'insert into products (slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                        sale_starts_at, sale_ends_at, featured, featured_sort, category, brand_slug,
                        image, images, active)
                 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([$slug, $nameEn, $nameAr, store_opt($b['desc_en'] ?? null),
                        store_opt($b['desc_ar'] ?? null), $price, $salePrice, $saleFrom, $saleTo,
                        $featured, $featuredSort, store_opt($b['category'] ?? null), $brandSlug,
                        store_opt($b['image'] ?? null), $extraImages, $active]);
            $id = (int)$db->lastInsertId();
        }

        // Carry the children. Every table keyed on products.slug is listed
        // here, and the list is the one information_schema gives for a `slug`
        // column: product_images (the shoot), product_variants (sizes and
        // stock), size_advice_log (what the assistant recommended for this
        // garment, kept so the advice can be reviewed).
        //
        // brands.slug and products.brand_slug are NOT here — they point the
        // other way, at a brand, and a product's own rename does not touch
        // them. order_items are not here either: they reference a product by
        // id and record the name as it was sold, which is what an invoice from
        // last year has to keep saying.
        if ($renaming) {
            foreach (['product_images', 'product_variants', 'size_advice_log'] as $child) {
                $db->prepare("update $child set slug = ? where slug = ?")
                   ->execute([$slug, $oldSlug]);
            }
            $db->commit();
        }
    } catch (Throwable $e) {
        if ($renaming && $db->inTransaction()) $db->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate')) store_fail('slug_taken');
        throw $e;
    }
    $q = $db->prepare('select id, slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                sale_starts_at, sale_ends_at, featured, featured_sort, category, brand_slug, image,
                images, active from products where id = ?');
    $q->execute([$id]);
    store_out($q->fetch());
}

// Take a product off sale. NOT a delete: order_items point at products by id,
// and a shop that deletes a sold product loses the line on every invoice that
// ever contained it. `active = 0` hides it from the storefront and keeps the
// history intact — the same reasoning as brands.
if ($r === 'product_active' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $db->prepare('update products set active = ? where id = ?')
       ->execute([empty($b['active']) ? 0 : 1, $id]);
    $q = $db->prepare('select id, slug, active from products where id = ?');
    $q->execute([$id]);
    $row = $q->fetch();
    if (!$row) store_fail('product_not_found');
    store_out($row);
}

// ------------------------------------------------------------------ brands
// The admin sees EVERY brand, disabled ones included — a switch you cannot
// see is a switch you cannot turn back on.
if ($r === 'brands') {
    store_out($db->query(
        'select id, slug, name_en, name_ar, logo, active, sort from brands order by sort, name_en'
    )->fetchAll());
}

// Create or rename a brand. One route for both: the admin screen has one form
// and the difference is whether an id came with it.
if ($r === 'brand_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $nameEn = store_text($b['name_en'] ?? null, 'name_en', 1, 80);
    $nameAr = store_text($b['name_ar'] ?? null, 'name_ar', 1, 80);
    $slug = store_slug((string)($b['slug'] ?? '')) ?: store_slug($nameEn);
    if ($slug === '') store_fail('invalid_slug');
    $sort = (int)($b['sort'] ?? 0);
    // Absent means "leave the logo alone"; empty string means "remove it".
    $hasLogo = array_key_exists('logo', $b);
    $logo = $hasLogo ? store_data_image($b['logo']) : null;

    try {
        if ($id > 0) {
            $sql = 'update brands set slug = ?, name_en = ?, name_ar = ?, sort = ?'
                 . ($hasLogo ? ', logo = ?' : '') . ' where id = ?';
            $args = $hasLogo ? [$slug, $nameEn, $nameAr, $sort, $logo, $id]
                             : [$slug, $nameEn, $nameAr, $sort, $id];
            $db->prepare($sql)->execute($args);
        } else {
            $db->prepare('insert into brands (slug, name_en, name_ar, logo, sort) values (?, ?, ?, ?, ?)')
               ->execute([$slug, $nameEn, $nameAr, $logo, $sort]);
            $id = (int)$db->lastInsertId();
        }
    } catch (Throwable $e) {
        // The slug is unique, and two brands with one slug is a storefront
        // filter that shows the wrong things — name the clash, do not 500.
        if (str_contains($e->getMessage(), 'Duplicate')) store_fail('slug_taken');
        throw $e;
    }
    $q = $db->prepare('select id, slug, name_en, name_ar, logo, active, sort from brands where id = ?');
    $q->execute([$id]);
    store_out($q->fetch());
}

// Show it, or stop showing it. Never a delete: a brand with orders behind it
// is history, and disabling is the reversible answer.
if ($r === 'brand_active' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $on = !empty($b['active']);
    $db->prepare('update brands set active = ? where id = ?')->execute([$on ? 1 : 0, $id]);
    $q = $db->prepare('select id, slug, active from brands where id = ?');
    $q->execute([$id]);
    $row = $q->fetch();
    if (!$row) store_fail('brand_not_found');
    store_out($row);
}

if ($r === 'customer' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['order_id'] ?? 0);
    // Column allowlist — an admin edits the delivery details, not the money.
    $allowed = ['customer_name','customer_phone','customer_email','customer_governorate','customer_area',
                'customer_block','customer_street','customer_building',
                'customer_floor','customer_flat','customer_note'];
    $sets = []; $args = [];
    foreach (($b['fields'] ?? []) as $k => $v) {
        if (!in_array($k, $allowed, true)) continue;
        // The email is the one field here that is posted somewhere rather than
        // read by a driver, so a typo is not a cosmetic problem: it lands next
        // to a header in a mail() call. Validated with the same function the
        // checkout uses, and a bad one is refused rather than stored.
        if ($k === 'customer_email' && (string)$v !== '') {
            $v = store_email((string)$v);
            if ($v === null) store_fail('invalid_email');
        }
        $sets[] = "`$k` = ?"; $args[] = $v === '' ? null : (string)$v;
    }
    if (!$sets) store_fail('nothing_to_update');
    $args[] = $id;
    $db->prepare('update orders set ' . implode(', ', $sets) . ' where id = ?')->execute($args);
    store_out(['ok' => true]);
}

// ----------------------------------------------------------------- catalogue
if ($r === 'products_state') {
    store_out($db->query('select slug, price, active from products')->fetchAll());
}

if ($r === 'sync' && $method === 'POST') {
    // Upsert on slug, exactly like syncCatalog expects. The rows come
    // from the shipped catalogue via the admin UI; prices here are what
    // checkout charges, which is the entire reason this screen exists.
    $rows = store_body()['rows'] ?? [];
    if (!is_array($rows) || !$rows) store_fail('empty');
    $up = $db->prepare(
        'insert into products (slug, name_en, name_ar, desc_en, desc_ar, price, category, image, active)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on duplicate key update name_en = values(name_en), name_ar = values(name_ar),
           desc_en = values(desc_en), desc_ar = values(desc_ar), price = values(price),
           category = values(category), active = values(active)'
    );
    $n = 0;
    $db->beginTransaction();
    try {
        foreach ($rows as $p) {
            if (!is_array($p) || empty($p['slug'])) continue;
            $up->execute([
                (string)$p['slug'], (string)($p['name_en'] ?? ''), (string)($p['name_ar'] ?? ''),
                $p['desc_en'] ?? null, $p['desc_ar'] ?? null,
                number_format((float)($p['price'] ?? 0), 3, '.', ''),
                $p['category'] ?? null, $p['image'] ?? null,
                !empty($p['active']) ? 1 : 0,
            ]);
            $n++;
        }
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        store_fail('failed', 500);
    }
    store_out(['count' => $n]);
}

// -------------------------------------------------------------------- stock
if ($r === 'variants') {
    // cost_aed IS included here — this is the admin, behind the session; the
    // public ?r=stock endpoint is the one that must never select it.
    $rows = $db->query(
        'select v.sku, v.slug, p.name_en, v.size, v.stock, v.cost_aed
           from product_variants v left join products p on p.slug = v.slug
          order by v.slug, v.size'
    )->fetchAll();
    foreach ($rows as &$row) { $row['stock'] = (int)$row['stock']; }
    store_out($rows);
}

if ($r === 'set_stock' && $method === 'POST') {
    $b = store_body();
    $stock = (int)($b['stock'] ?? -1);
    if ($stock < 0) store_fail('stock_cannot_be_negative');
    // The RPC discipline kept: only the count moves. Not the SKU, not the
    // slug, not the cost.
    $q = $db->prepare('update product_variants set stock = ? where sku = ?');
    $q->execute([$stock, (string)($b['sku'] ?? '')]);
    if ($q->rowCount() === 0) {
        $chk = $db->prepare('select 1 from product_variants where sku = ?');
        $chk->execute([(string)($b['sku'] ?? '')]);
        if (!$chk->fetch()) store_fail('sku_not_found');
    }
    $q2 = $db->prepare('select sku, slug, size, stock from product_variants where sku = ?');
    $q2->execute([(string)($b['sku'] ?? '')]);
    store_out($q2->fetch());
}

// CREATE the size ladder, which nothing could do until now.
//
// THE GAP THIS CLOSES. product_save() writes no product_variants rows and
// set_stock() only moves one that already exists — it answers sku_not_found,
// correctly, on a garment that has no ladder. So a product added through
// /backends had NO sizes for a shopper to choose from, and was stock-UNTRACKED:
// store_stock_claim() skips a slug with no rows by design, so it could be
// ordered in any quantity forever. The only way to give it sizes was
// phpMyAdmin, once per size, per garment. That is 46 products' worth of typing
// and the reason the catalogue's ladders were never finished.
//
// The SKU is generated, never accepted from the client. It is the primary key
// and the handle set_stock() uses, and letting the browser name it invites a
// collision with another garment's row — one shop's ladder silently editing
// another's. slug+size is already unique in every way that matters, so the key
// is derived from exactly that.
if ($r === 'variant_save' && $method === 'POST') {
    $b = store_body();
    $slug = store_slug((string)($b['slug'] ?? ''));
    if ($slug === '') store_fail('invalid_slug');
    $size = strtoupper(trim((string)($b['size'] ?? '')));
    // The same list the CHECK constraint and the order path use. Read from the
    // constant rather than retyped, so a size added in one place cannot be
    // creatable here and unorderable at checkout.
    if (!in_array($size, STORE_SIZES, true)) store_fail('invalid_size');

    // The garment has to exist. Without this the ladder can be built against a
    // typo'd slug, where it is invisible to the shop and to this screen's own
    // product list, and looks for all the world like the save silently failed.
    $chk = $db->prepare('select 1 from products where slug = ?');
    $chk->execute([$slug]);
    if (!$chk->fetch()) store_fail('product_not_found');

    $stock = (int)($b['stock'] ?? 0);
    if ($stock < 0) store_fail('stock_cannot_be_negative');
    // A wholesale cost is optional and is the one commercially sensitive number
    // in the schema. Null, never 0, when it is not given: 0 is a claim that the
    // garment cost nothing, and it would be believed by anything that averages.
    $cost = ($b['cost_aed'] ?? '') === '' || $b['cost_aed'] === null
        ? null : number_format((float)$b['cost_aed'], 2, '.', '');
    if ($cost !== null && (float)$cost < 0) store_fail('invalid_cost');

    // Capped at 30 so the key always fits varchar(30). Sizes are at most 3
    // characters plus the dash, so the slug gets 26.
    $sku = strtoupper(substr($slug, 0, 26) . '-' . $size);

    // ON DUPLICATE KEY on the SKU, so saving the same size twice EDITS rather
    // than erroring — the admin screen re-saves a row the operator is editing,
    // and a second click must not be a failure. The stock is set, not added:
    // this screen shows a number and writes back the number shown.
    $q = $db->prepare(
        'insert into product_variants (sku, slug, size, stock, cost_aed)
              values (?, ?, ?, ?, ?)
         on duplicate key update stock = values(stock), cost_aed = values(cost_aed)'
    );
    $q->execute([$sku, $slug, $size, $stock, $cost]);

    $q2 = $db->prepare('select sku, slug, size, stock, cost_aed from product_variants where sku = ?');
    $q2->execute([$sku]);
    store_out($q2->fetch());
}

// Remove a size from the ladder.
//
// REFUSED WHILE STOCK IS ON IT, unless the caller says so explicitly. Deleting
// a variant that holds stock is indistinguishable, afterwards, from that stock
// having been sold — the row is simply gone and the count with it. A garment
// discontinued at 12 pieces is a stocktake question, not a click.
//
// The row is NOT protected by a foreign key the way products are: order_items
// records a size STRING, not a variant id, so deleting the ladder does not
// touch order history and an old order keeps saying 'L' for ever. That is why
// this check has to live here.
if ($r === 'variant_delete' && $method === 'POST') {
    $b = store_body();
    $sku = (string)($b['sku'] ?? '');
    $q = $db->prepare('select stock from product_variants where sku = ?');
    $q->execute([$sku]);
    $row = $q->fetch();
    if (!$row) store_fail('sku_not_found');
    if ((int)$row['stock'] > 0 && empty($b['force'])) store_fail('variant_has_stock');
    $db->prepare('delete from product_variants where sku = ?')->execute([$sku]);
    store_out(['deleted' => $sku]);
}

// ------------------------------------------------------------------- slides
// The home hero. The photograph lives in the ROW, not on disk — the same rule
// the brand logos follow, and for the same reason: an endpoint that writes
// into the web root is a way in, and this server already hosted one.
//
// The admin sends the image already downscaled and re-encoded to WebP in the
// browser, so a 12-megapixel phone photo becomes ~200 kB before it is ever
// uploaded. store_data_image() is the floor under that, because a client-side
// limit is a suggestion.
if ($r === 'slides') {
    $rows = $db->query(
        'select id, sort, active, title_en, title_ar, subtitle_en, subtitle_ar,
                cta_label_en, cta_label_ar, cta_href, image_hash, image_w, image_h,
                focal_x, focal_y, updated_at
           from hero_slides order by sort, id'
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['active'] = (bool)$row['active'];
        $row['sort'] = (int)$row['sort'];
        $row['focal_x'] = (int)$row['focal_x'];
        $row['focal_y'] = (int)$row['focal_y'];
        // The admin gets the same cacheable URL the storefront gets, rather
        // than a megabyte of base64 per slide in a list response.
        $row['image'] = $row['image_hash']
            ? 'api.php?r=slide_image&id=' . $row['id'] . '&v=' . substr((string)$row['image_hash'], 0, 16)
            : null;
        $row['width']  = $row['image_w'] === null ? null : (int)$row['image_w'];
        $row['height'] = $row['image_h'] === null ? null : (int)$row['image_h'];
        unset($row['image_hash'], $row['image_w'], $row['image_h']);
    }
    unset($row);
    store_out(['slides' => $rows, 'hero' => store_setting($db, 'hero')]);
}

if ($r === 'slide_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);

    // A slide with no photograph is a blank panel on the home page. The image
    // is required on CREATE; on edit, omitting it keeps the one already there
    // rather than wiping it, so changing a caption cannot lose the artwork.
    $image = null;
    if (($b['image'] ?? '') !== '') {
        $image = store_data_image((string)$b['image'], STORE_HERO_MAX);
    } elseif ($id === 0) {
        store_fail('image_required');
    }

    $focalX = max(0, min(100, (int)($b['focal_x'] ?? 50)));
    $focalY = max(0, min(100, (int)($b['focal_y'] ?? 50)));
    $fields = [
        'title_en'     => store_opt($b['title_en'] ?? null),
        'title_ar'     => store_opt($b['title_ar'] ?? null),
        'subtitle_en'  => store_opt($b['subtitle_en'] ?? null),
        'subtitle_ar'  => store_opt($b['subtitle_ar'] ?? null),
        'cta_label_en' => store_opt($b['cta_label_en'] ?? null),
        'cta_label_ar' => store_opt($b['cta_label_ar'] ?? null),
        // Same-origin paths only. A hero button is the most prominent link on
        // the site, so it may not be pointed at somebody else's domain from a
        // form — that is a redirect the shop's own design would be lending
        // credibility to.
        'cta_href'     => store_internal_href($b['cta_href'] ?? null),
        'active'       => !empty($b['active']) ? 1 : 0,
        'sort'         => (int)($b['sort'] ?? 0),
        'focal_x'      => $focalX,
        'focal_y'      => $focalY,
    ];
    if ($image !== null) {
        $fields['image'] = $image;
        // The hash is the cache key the storefront URL carries, so a replaced
        // photograph is a different URL and appears at once despite the
        // one-year immutable cache on the old one.
        $fields['image_hash'] = hash('sha256', $image);
        $fields['image_w'] = (int)($b['width'] ?? 0) ?: null;
        $fields['image_h'] = (int)($b['height'] ?? 0) ?: null;
    }

    $cols = array_keys($fields);
    if ($id > 0) {
        $set = implode(', ', array_map(fn ($c) => "$c = ?", $cols));
        $db->prepare("update hero_slides set $set where id = ?")
           ->execute([...array_values($fields), $id]);
    } else {
        $ph = implode(', ', array_fill(0, count($cols), '?'));
        $db->prepare('insert into hero_slides (' . implode(', ', $cols) . ") values ($ph)")
           ->execute(array_values($fields));
        $id = (int)$db->lastInsertId();
    }
    store_out(['id' => $id]);
}

if ($r === 'slide_delete' && $method === 'POST') {
    $b = store_body();
    // Slides are genuinely deletable, unlike products and brands: nothing
    // points at one. No order, no invoice and no history refers to a slide, so
    // removing it loses nothing but the picture.
    $db->prepare('delete from hero_slides where id = ?')->execute([(int)($b['id'] ?? 0)]);
    store_out(['ok' => true]);
}

// Reorder in one call. Sending the whole order at once means the list can
// never be left half-renumbered by a failed second request.
if ($r === 'slide_reorder' && $method === 'POST') {
    $ids = store_body()['ids'] ?? [];
    if (!is_array($ids)) store_fail('bad_request');
    $db->beginTransaction();
    $up = $db->prepare('update hero_slides set sort = ? where id = ?');
    foreach (array_values($ids) as $i => $id) $up->execute([$i, (int)$id]);
    $db->commit();
    store_out(['ok' => true]);
}

// ------------------------------------------------------- product photographs
//
// The shoot for one garment: list, add, remove, reorder. Same shape as the
// slide routes above it, and the same rule — the bytes are a row, validated by
// store_data_image(), never a file. api.php?r=product_image serves them.
//
// Keyed on SLUG throughout, because that is what product_images stores and
// what the admin's product form already holds. The slug is checked against
// products on the way in, so a photograph cannot be filed under a garment that
// does not exist and then be invisible everywhere.
if ($r === 'product_images') {
    $slug = trim((string)($_GET['slug'] ?? ''));
    $q = $db->prepare(
        'select id, sort, image_hash, image_w, image_h
           from product_images where slug = ? order by sort, id'
    );
    $q->execute([$slug]);
    $rows = $q->fetchAll();
    foreach ($rows as &$row) {
        $row['id']   = (int)$row['id'];
        $row['sort'] = (int)$row['sort'];
        // The URL, not the base64 — the admin screen shows a strip of
        // thumbnails, and a dozen data: URIs in one JSON response is megabytes
        // down a connection in Kuwait to draw pictures the browser could have
        // cached. Identical URL to the storefront's, so it is very likely
        // already in cache.
        $row['url']  = 'api.php?r=product_image&id=' . $row['id']
                     . '&v=' . substr((string)$row['image_hash'], 0, 12);
        $row['width']  = $row['image_w'] === null ? null : (int)$row['image_w'];
        $row['height'] = $row['image_h'] === null ? null : (int)$row['image_h'];
        unset($row['image_hash'], $row['image_w'], $row['image_h']);
    }
    unset($row);
    store_out(['images' => $rows]);
}

if ($r === 'product_image_add' && $method === 'POST') {
    $b = store_body();
    $slug = trim((string)($b['slug'] ?? ''));

    $known = $db->prepare('select 1 from products where slug = ?');
    $known->execute([$slug]);
    if (!$known->fetchColumn()) store_fail('product_not_found');

    // The cap is counted BEFORE the insert and inside the same transaction as
    // it, so two tabs adding the twelfth and thirteenth photograph at the same
    // moment cannot both read eleven and both proceed. The same shape as the
    // single-use discount claim, for the same reason.
    $db->beginTransaction();
    $n = $db->prepare('select count(*) from product_images where slug = ? for update');
    $n->execute([$slug]);
    if ((int)$n->fetchColumn() >= STORE_PRODUCT_IMAGE_LIMIT) {
        $db->rollBack();
        store_fail('too_many_images');
    }

    // store_data_image() is the gate: png/jpeg/webp only, never SVG, and the
    // DECODED bytes must begin with that format's magic number. It throws
    // rather than returning null for anything present but invalid, so a
    // rejected photograph is an error the admin can read and not a save that
    // silently stored nothing.
    $image = store_data_image((string)($b['image'] ?? ''), STORE_PRODUCT_IMAGE_MAX);
    if ($image === null) { $db->rollBack(); store_fail('image_required'); }

    // Appended last. The first photograph in `sort` order is the main one, and
    // an upload quietly becoming the front of the shoot is not what anybody
    // means by "add a photo" — reordering is a separate, deliberate act.
    $next = $db->prepare('select coalesce(max(sort), -1) + 1 from product_images where slug = ?');
    $next->execute([$slug]);

    // Hashed in PHP, exactly as slide_save does it — one implementation of
    // "what is this photograph's cache key", not one here and a sha2() in SQL
    // that has to be trusted to agree with it.
    $hash = hash('sha256', $image);
    $ins = $db->prepare(
        'insert into product_images (slug, sort, image, image_hash, image_w, image_h)
         values (?, ?, ?, ?, ?, ?)'
    );
    $ins->execute([$slug, (int)$next->fetchColumn(), $image, $hash,
                   (int)($b['width'] ?? 0) ?: null, (int)($b['height'] ?? 0) ?: null]);
    $id = (int)$db->lastInsertId();
    $db->commit();

    store_out(['id' => $id, 'url' => 'api.php?r=product_image&id=' . $id . '&v=' . substr($hash, 0, 12)]);
}

if ($r === 'product_image_delete' && $method === 'POST') {
    $id = (int)(store_body()['id'] ?? 0);
    $del = $db->prepare('delete from product_images where id = ?');
    $del->execute([$id]);
    // Not an error when it is already gone: the admin may have deleted it in
    // another tab, and "it is not there" is the outcome that was asked for.
    store_out(['ok' => true, 'deleted' => $del->rowCount()]);
}

if ($r === 'product_image_reorder' && $method === 'POST') {
    $b = store_body();
    $slug = trim((string)($b['slug'] ?? ''));
    $ids = $b['ids'] ?? [];
    if ($slug === '' || !is_array($ids)) store_fail('bad_request');
    $db->beginTransaction();
    // `and slug = ?` is not decoration. Without it a crafted list of ids would
    // renumber photographs belonging to OTHER garments — scrambling a shoot
    // the admin was not looking at, with nothing on screen to show it had
    // happened.
    $up = $db->prepare('update product_images set sort = ? where id = ? and slug = ?');
    foreach (array_values($ids) as $i => $id) $up->execute([$i, (int)$id, $slug]);
    $db->commit();
    store_out(['ok' => true]);
}

// ------------------------------------------------------------------ settings
// How the slider plays, and the promo bar. Whitelisted by name and rebuilt
// field by field: a settings endpoint that stores whatever JSON it is handed
// is a place to park arbitrary data inside the shop's own configuration.
if ($r === 'settings_save' && $method === 'POST') {
    $b = store_body();
    $name = (string)($b['name'] ?? '');
    $v = is_array($b['value'] ?? null) ? $b['value'] : [];

    if ($name === 'hero') {
        store_setting_save($db, 'hero', [
            // 2s floor: anything faster is unreadable, and WCAG 2.2.2 wants
            // moving content to be pausable, not merely slow. 30s ceiling
            // because past that the second slide is never seen.
            'speed_ms' => max(2000, min(30000, (int)($v['speed_ms'] ?? 6500))),
            'shuffle'  => !empty($v['shuffle']),
            'autoplay' => !empty($v['autoplay']),
            'size'     => in_array($v['size'] ?? '', ['short', 'tall', 'full'], true) ? $v['size'] : 'tall',
        ]);
    } elseif ($name === 'promo_bar') {
        store_setting_save($db, 'promo_bar', [
            'enabled'   => !empty($v['enabled']),
            'text_en'   => mb_substr(trim((string)($v['text_en'] ?? '')), 0, 160),
            'text_ar'   => mb_substr(trim((string)($v['text_ar'] ?? '')), 0, 160),
            'href'      => store_internal_href($v['href'] ?? null) ?? '',
            'starts_at' => store_datetime($v['starts_at'] ?? null),
            'ends_at'   => store_datetime($v['ends_at'] ?? null),
        ]);
    } elseif ($name === 'contact') {
        // HOW TO REACH THE SHOP.
        //
        // Every field is optional and an empty one means "do not show this",
        // which is why nothing here is store_fail'd for being blank — the
        // owner clearing the address should clear the address, not refuse the
        // whole save and lose the edit they made to the phone number beside it.
        //
        // What IS refused is a value that is present and wrong, because that is
        // the one that reaches a customer: a mistyped email on the contact page
        // is a customer who writes to nobody, and the shop never finds out.
        $email = trim((string)($v['email'] ?? ''));
        if ($email !== '' && store_email($email) === null) store_fail('invalid_email');

        // THE WHATSAPP NUMBER GOES THROUGH store_phone(), the same function the
        // checkout uses — so it is stored in the one spelling the rest of the
        // shop speaks, with the country code, rather than however it was typed.
        // wa.me refuses anything else, and a wa.me link that opens on an error
        // is indistinguishable from the shop having no WhatsApp at all.
        $wa = trim((string)($v['whatsapp'] ?? ''));
        if ($wa !== '') {
            $wa = store_phone($wa);
            if ($wa === null) store_fail('invalid_whatsapp');
        }

        // The DISPLAY phone is deliberately NOT normalised. It is what appears
        // on the page and on the invoice, and shops write their number with
        // spaces for a reason; forcing it to 96522091914 would make every page
        // read like a database field. It is only ever printed, never dialled
        // programmatically — the tel: link is built from its digits at render.
        store_setting_save($db, 'contact', [
            'phone'      => mb_substr(trim((string)($v['phone'] ?? '')), 0, 32),
            'whatsapp'   => (string)$wa,
            'email'      => $email,
            'address_ar' => mb_substr(trim((string)($v['address_ar'] ?? '')), 0, 160),
            'address_en' => mb_substr(trim((string)($v['address_en'] ?? '')), 0, 160),
            'hours_ar'   => mb_substr(trim((string)($v['hours_ar'] ?? '')), 0, 120),
            'hours_en'   => mb_substr(trim((string)($v['hours_en'] ?? '')), 0, 120),
            // An instagram HANDLE, not a URL: the link is built from it, so a
            // full https:// pasted in here would produce a broken address. The
            // leading @ people habitually type is stripped rather than refused.
            'instagram'  => preg_replace('/[^A-Za-z0-9._]/', '',
                                mb_substr(trim((string)($v['instagram'] ?? '')), 0, 40)),
        ]);
    } else {
        store_fail('unknown_setting');
    }
    store_out(store_setting($db, $name));
}

// ------------------------------------------------------------- blocked numbers
// The manual half of the cash-on-delivery defence — see antifraud.mysql.sql.
// The automatic cap stops one number flooding the courier; this is where the
// owner records the number that already cost them three wasted trips.
if ($r === 'blocked') {
    store_out($db->query(
        'select id, phone, scope, reason, blocked_by, created_at
           from blocked_customers order by created_at desc limit 500'
    )->fetchAll());
}

if ($r === 'block_customer' && $method === 'POST') {
    $b = store_body();
    // Canonicalised with the SAME function the checkout uses, or the block is
    // recorded against a spelling the order path will never produce and
    // silently protects nothing.
    $phone = store_phone((string)($b['phone'] ?? ''));
    if ($phone === null) store_fail('invalid_phone');
    $scope = ($b['scope'] ?? 'cod') === 'all' ? 'all' : 'cod';
    $reason = mb_substr(trim((string)($b['reason'] ?? '')), 0, 200);

    $db->prepare(
        'insert into blocked_customers (phone, scope, reason, blocked_by) values (?, ?, ?, ?)
         on duplicate key update scope = values(scope), reason = values(reason),
                                 blocked_by = values(blocked_by)'
    )->execute([$phone, $scope, $reason === '' ? null : $reason,
                (string)($_SESSION['admin_email'] ?? '')]);
    store_out(['ok' => true, 'phone' => $phone, 'scope' => $scope]);
}

// Unblocking must be as easy as blocking. A block placed by mistake that
// cannot be undone from the same screen becomes a customer nobody can help.
if ($r === 'unblock_customer' && $method === 'POST') {
    $b = store_body();
    $phone = store_phone((string)($b['phone'] ?? ''));
    if ($phone === null) store_fail('invalid_phone');
    $db->prepare('delete from blocked_customers where phone = ?')->execute([$phone]);
    store_out(['ok' => true]);
}

// ----------------------------------------------------------------- discounts
if ($r === 'discounts') {
    $rows = $db->query('select * from discounts order by kind, code, id')->fetchAll();
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['active'] = (bool)$row['active'];
        $row['value'] = (float)$row['value'];
        $row['min_order'] = (float)$row['min_order'];
        $row['usage_limit'] = (int)$row['usage_limit'];
        $row['used_count'] = (int)$row['used_count'];
        $row['live'] = $row['active'] && store_window_open($row['starts_at'], $row['ends_at'])
            && ($row['usage_limit'] === 0 || $row['used_count'] < $row['usage_limit']);
    }
    unset($row);
    store_out($rows);
}

if ($r === 'discount_save' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $kind = ($b['kind'] ?? 'code') === 'auto' ? 'auto' : 'code';
    $type = ($b['type'] ?? 'percent') === 'fixed' ? 'fixed' : 'percent';

    // Uppercase and stripped to A-Z0-9, so SAVE10 and save10 cannot both
    // exist and a code cannot carry a space the customer will never reproduce.
    $code = null;
    if ($kind === 'code') {
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($b['code'] ?? '')));
        if (strlen($code) < 3 || strlen($code) > 24) store_fail('invalid_code');
    }

    $value = (float)($b['value'] ?? 0);
    // 90% is the per-rule ceiling; store_discounts_for caps the STACK at 60%
    // of the order. Both exist: one stops a typo ("100" meaning 10), the other
    // stops two sane rules adding up to a free order.
    if ($type === 'percent' && ($value < 1 || $value > 90)) store_fail('invalid_percent');
    if ($type === 'fixed' && ($value <= 0 || $value > 9999)) store_fail('invalid_amount');

    $fields = [
        'kind'        => $kind,
        'code'        => $code,
        'label'       => store_text($b['label'] ?? null, 'label', 2, 80),
        'type'        => $type,
        'value'       => number_format($value, 3, '.', ''),
        'min_order'   => number_format(max(0, (float)($b['min_order'] ?? 0)), 3, '.', ''),
        'category'    => store_opt($b['category'] ?? null),
        'starts_at'   => store_datetime($b['starts_at'] ?? null),
        'ends_at'     => store_datetime($b['ends_at'] ?? null),
        'usage_limit' => max(0, (int)($b['usage_limit'] ?? 0)),
        'active'      => !empty($b['active']) ? 1 : 0,
    ];
    if ($fields['starts_at'] !== null && $fields['ends_at'] !== null
        && $fields['starts_at'] > $fields['ends_at']) store_fail('sale_dates_backwards');

    $cols = array_keys($fields);
    try {
        if ($id > 0) {
            $set = implode(', ', array_map(fn ($c) => "$c = ?", $cols));
            $db->prepare("update discounts set $set where id = ?")
               ->execute([...array_values($fields), $id]);
        } else {
            $ph = implode(', ', array_fill(0, count($cols), '?'));
            $db->prepare('insert into discounts (' . implode(', ', $cols) . ") values ($ph)")
               ->execute(array_values($fields));
            $id = (int)$db->lastInsertId();
        }
    } catch (Throwable $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) store_fail('code_taken');
        throw $e;
    }
    $q = $db->prepare('select * from discounts where id = ?');
    $q->execute([$id]);
    store_out($q->fetch());
}

// Switched off, never deleted while it has been used: orders reference the
// code they were given, and a report that cannot explain why an order was
// 3 KWD cheaper is a report nobody trusts.
if ($r === 'discount_active' && $method === 'POST') {
    $b = store_body();
    $db->prepare('update discounts set active = ? where id = ?')
       ->execute([!empty($b['active']) ? 1 : 0, (int)($b['id'] ?? 0)]);
    store_out(['ok' => true]);
}

if ($r === 'discount_delete' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $q = $db->prepare('select code from discounts where id = ?');
    $q->execute([$id]);
    $code = $q->fetchColumn();
    if ($code !== false && $code !== null) {
        $u = $db->prepare('select count(*) from orders where discount_code = ?');
        $u->execute([$code]);
        if ((int)$u->fetchColumn() > 0) store_fail('discount_in_use', 409);
    }
    $db->prepare('delete from discounts where id = ?')->execute([$id]);
    store_out(['ok' => true]);
}

// ================================================================== reviews
//
// WHAT WAS WRONG. The shop asks every customer what they thought and pays 20%
// for the answer — and the answer was written to `reviews.comment` and never
// read again. Not by the storefront, not here, not by any route. Forty-six
// products, a discount code spent on each reply, and no screen anywhere that
// could show one. The feature was collecting the data and throwing away the
// point of collecting it.
//
// Admin-only, and deliberately so: these are unmoderated free-text strings from
// the public, and `reviews.published` exists precisely because the owner has not
// decided which of them should ever appear on a product page. Reading them is
// step one; putting them on the shop is a separate decision.
if ($r === 'reviews') {
    $rows = $db->query(
        "select v.id, v.rating, v.comment, v.lang, v.reward_code, v.published,
                v.created_at, o.track_id, o.customer_name
           from reviews v
           join orders o on o.id = v.order_id
          order by v.created_at desc
          limit 300"
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['rating'] = (int)$row['rating'];
        $row['published'] = (bool)$row['published'];
    }
    unset($row);
    // The averages the owner actually wants at a glance, computed here rather
    // than in the browser so a 300-row page limit cannot silently change them.
    $stats = $db->query(
        'select count(*) as total, round(avg(rating), 2) as average,
                count(case when comment is not null and comment <> \'\' then 1 end) as with_comment
           from reviews'
    )->fetch();
    store_out(['reviews' => $rows, 'stats' => [
        'total' => (int)($stats['total'] ?? 0),
        'average' => $stats['average'] === null ? null : (float)$stats['average'],
        'with_comment' => (int)($stats['with_comment'] ?? 0),
    ]]);
}

// Show it on the product page, or do not. Nothing reads `published` on the
// storefront yet — this records the decision so that when something does, the
// owner has already made it rather than publishing 300 strings at once.
// --------------------------------------------------------------- سبورتا AI
//
// What the assistant COULD NOT answer. Every row is a customer who was told a
// colleague would follow up, so this screen is a to-do list rather than a log —
// and `sent_at`/`last_error` make visible the case the old fire-and-forget
// handoff hid completely: n8n never took it.
if ($r === 'assistant_log') {
    $rows = $db->query(
        'select id, intent, lang, message, reply, created_at, sent_at, attempts,
                last_error, handled_at
           from assistant_outbox
          order by created_at desc
          limit 200'
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['attempts'] = (int) $row['attempts'];
        // Stuck for good, so the screen can say so rather than showing an
        // ordinary unsent row that will never move again.
        $row['gave_up'] = $row['sent_at'] === null && $row['attempts'] >= 5;
    }
    store_out($rows);
}

// Mark one dealt with BY A PERSON. Deliberately separate from sent_at: the
// webhook delivering is not the same event as somebody actually replying to
// the customer, and conflating them would let a green queue stand in for work
// nobody did.
if ($r === 'assistant_handled' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $on = !empty($b['handled']);
    $q = $db->prepare('update assistant_outbox set handled_at = ? where id = ?');
    $q->execute([$on ? date('Y-m-d H:i:s') : null, $id]);
    if ($q->rowCount() === 0) {
        $chk = $db->prepare('select 1 from assistant_outbox where id = ?');
        $chk->execute([$id]);
        if (!$chk->fetch()) store_fail('not_found');
    }
    store_out(['id' => $id, 'handled' => $on]);
}

if ($r === 'review_publish' && $method === 'POST') {
    $b = store_body();
    $db->prepare('update reviews set published = ? where id = ?')
       ->execute([!empty($b['published']) ? 1 : 0, (int)($b['id'] ?? 0)]);
    store_out(['ok' => true]);
}

// ================================================== returns and exchanges
//
// A to-do list, not a log. Every row is a customer waiting to hear whether a
// courier is coming, and the ones at the top are the ones nobody has looked at.

if ($r === 'returns') {
    $status = trim((string)($_GET['status'] ?? ''));
    $ok = ['new','approved','picked_up','refunded','rejected','cancelled'];
    $where = in_array($status, $ok, true) ? 'where rr.status = ?' : '';
    $q = $db->prepare(
        "select rr.id, rr.ref, rr.kind, rr.status, rr.reason, rr.lang, rr.phone,
                rr.staff_note, rr.created_at, rr.decided_at,
                o.track_id, o.customer_name, o.payment_method, o.amount,
                o.created_at as ordered_at, o.fulfilled_at
           from return_requests rr
           join orders o on o.id = rr.order_id
           $where
          order by rr.created_at desc limit 300"
    );
    $q->execute($where === '' ? [] : [$status]);
    $rows = $q->fetchAll();

    // The lines, fetched for every listed request in ONE query rather than one
    // query per row. Thirty requests on a screen is thirty round trips to
    // MariaDB otherwise, and the screen is the one the shop opens every day.
    $byRequest = [];
    if ($rows) {
        $ids = array_column($rows, 'id');
        $in  = implode(',', array_fill(0, count($ids), '?'));
        $li = $db->prepare(
            "select ri.request_id, ri.qty, ri.want_size,
                    oi.size, oi.unit_price,
                    coalesce(oi.name_en, p.name_en) as name_en,
                    coalesce(oi.name_ar, p.name_ar) as name_ar,
                    p.slug, p.image
               from return_request_items ri
               join order_items oi on oi.id = ri.order_item_id
               join products p on p.id = oi.product_id
              where ri.request_id in ($in) order by ri.id"
        );
        $li->execute($ids);
        foreach ($li->fetchAll() as $l) {
            $rid = (int)$l['request_id'];
            unset($l['request_id']);
            $l['qty'] = (int)$l['qty'];
            $l['unit_price'] = (float)$l['unit_price'];
            $byRequest[$rid][] = $l;
        }
    }
    foreach ($rows as &$row) {
        $row['id'] = (int)$row['id'];
        $row['amount'] = (float)$row['amount'];
        $row['items'] = $byRequest[(int)$row['id']] ?? [];
    }
    unset($row);

    // The counts the owner wants at a glance, computed here rather than from
    // the 300-row page — a limit must not silently change a total.
    $counts = [];
    foreach ($db->query('select status, count(*) as n from return_requests group by status')
                ->fetchAll() as $c) $counts[$c['status']] = (int)$c['n'];
    store_out(['returns' => $rows, 'counts' => $counts]);
}

if ($r === 'return_status' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['id'] ?? 0);
    $to = (string)($b['status'] ?? '');
    // The SAME list the CHECK constraint carries. A status the database would
    // refuse must be refused here, with a name, rather than arriving as a
    // driver-level exception the panel shows as "something went wrong".
    if (!in_array($to, ['new','approved','picked_up','refunded','rejected','cancelled'], true)) {
        store_out(['error' => 'bad_status'], 422);
    }
    $note = store_opt($b['note'] ?? null);
    // REJECTING WITHOUT A REASON IS NOT ALLOWED. The customer is told why, and
    // "no reason given" is not a thing the shop should be able to send.
    if ($to === 'rejected' && ($note === null || $note === '')) {
        store_out(['error' => 'reason_required'], 422);
    }
    $q = $db->prepare('select status from return_requests where id = ?');
    $q->execute([$id]);
    if ($q->fetchColumn() === false) store_out(['error' => 'not_found'], 404);

    // decided_at is set the first time it leaves 'new' and never moved again:
    // it answers "how long did the customer wait to hear", which a later
    // status change would erase.
    $db->prepare(
        "update return_requests
            set status = ?,
                staff_note = coalesce(?, staff_note),
                decided_at = case when decided_at is null and ? <> 'new'
                                  then current_timestamp else decided_at end
          where id = ?"
    )->execute([$to, $note, $to, $id]);
    store_out(['ok' => true]);
}

// ================================================================== account
//
// The four changes that decide who can sign in tomorrow: the password, the
// email, the mobile number, and whether a second factor is required at all.
//
// EVERY ONE OF THEM COSTS THE CURRENT PASSWORD PLUS A FRESH CODE. A session
// cookie is a bearer token and an unlocked laptop is enough to hold one; these
// are precisely the changes that would turn five minutes at someone's desk
// into permanent ownership of the shop. Asking again for both factors means
// the person making the change is the person who owns the account right now,
// not whoever the browser happens to belong to.

if ($r === 'account') {
    $q = $db->prepare('select email, phone, totp_enabled, last_login_at from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u) store_fail('account_not_found', 404);
    store_out([
        'email' => $u['email'],
        'phone' => $u['phone'],
        'totp'  => (int)$u['totp_enabled'] === 1,
        'last_login_at' => $u['last_login_at'],
    ]);
}

// Begin enrolment: mint a secret and hand back what the phone needs.
//
// The secret is STORED but totp_enabled stays 0 until a code proves the phone
// actually has it. Enabling first and confirming later is how an owner ends up
// locked out by a mistyped scan.
if ($r === 'totp_begin' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select password_hash, totp_enabled, email from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u) store_fail('account_not_found', 404);
    // Re-enrolling would silently invalidate the phone that currently works,
    // so it needs the same ceremony as turning it off.
    if ((int)$u['totp_enabled'] === 1) store_fail('already_enrolled', 409);
    // The password, even here. Otherwise an unlocked laptop can enrol an
    // attacker's OWN phone as the second factor and lock the owner out of
    // their shop with the owner's own password still working.
    store_throttle($db, 'account', 10, 300);
    if (!password_verify((string)($b['password'] ?? ''), (string)$u['password_hash'])) {
        store_fail('bad_password', 401);
    }

    $secret = store_totp_secret();
    $db->prepare('update admin_users set totp_secret = ?, totp_last_step = null where id = ?')
       ->execute([$secret, $admin['id']]);
    store_out([
        'secret' => $secret,
        'uri'    => store_totp_uri($secret, (string)$u['email']),
    ]);
}

// Finish enrolment: a code from the phone, checked against the stored secret.
if ($r === 'totp_enable' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select totp_secret, totp_enabled from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u || (string)$u['totp_secret'] === '') store_fail('not_started', 409);
    if ((int)$u['totp_enabled'] === 1) store_fail('already_enrolled', 409);

    store_throttle($db, 'totp', 10, 300);
    if (!store_totp_claim($db, (int)$admin['id'], (string)$u['totp_secret'], (string)($b['code'] ?? ''))) {
        store_fail('bad_code', 401);
    }
    $db->prepare('update admin_users set totp_enabled = 1 where id = ?')->execute([$admin['id']]);
    store_out(['ok' => true, 'totp' => true]);
}

// Turn it off. Password AND a working code — if the phone is lost, this is not
// the route: reset-admin.php on the server is, because that one proves you can
// read config.php rather than that you can hold the phone.
// ------------------------------------------- the emailed code, as a factor
//
// The same three-step ceremony TOTP has, for the same reasons, and one extra
// one that matters more here than it does there.
//
// THE EXTRA ONE: enrolling PROVES THE MAIL ARRIVES. otp_begin sends a code and
// otp_enable will not switch the factor on until that code comes back, so an
// owner cannot lock the door with a key they never received. TOTP does not
// need this — the app shows the code whether or not anything works — but a
// second factor that depends on a mail server nobody has tested is the one way
// this feature could take the shop away from its owner.

if ($r === 'otp_begin' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select id, email, password_hash, email_otp_enabled, email_otp_sent_at
                         from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u) store_fail('account_not_found', 404);
    if ((int)$u['email_otp_enabled'] === 1) store_fail('already_enrolled', 409);

    // The password, even here, and for the reason totp_begin gives: without it
    // an unlocked laptop enrols a factor the owner does not hold.
    store_throttle($db, 'account', 10, 300);
    if (!password_verify((string)($b['password'] ?? ''), (string)$u['password_hash'])) {
        store_fail('bad_password', 401);
    }
    $code = store_email_otp_issue($db, $u);
    $sent = store_email_otp_send($u, $code, ($b['lang'] ?? '') === 'en' ? 'en' : 'ar');
    // `sent` false is not an error to hide: it is the answer to "will this
    // work", asked at the only moment when finding out is free.
    store_out(['sent' => $sent, 'to' => store_mask_email((string)$u['email'])]);
}

if ($r === 'otp_enable' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select email_otp_enabled, email_otp_hash from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u || $u['email_otp_hash'] === null) store_fail('not_started', 409);
    if ((int)$u['email_otp_enabled'] === 1) store_fail('already_enrolled', 409);

    store_throttle($db, 'totp', 10, 300);
    if (!store_email_otp_claim($db, (int)$admin['id'], (string)($b['code'] ?? ''))) {
        store_fail('bad_code', 401);
    }
    $db->prepare('update admin_users set email_otp_enabled = 1 where id = ?')->execute([$admin['id']]);
    store_out(['ok' => true, 'email_otp' => true]);
}

// A fresh code for an admin who is ALREADY signed in, because the one they
// signed in with was consumed on use and store_require_fresh_code() needs a
// live one before a password, an email or a phone number can change.
//
// It mails the signed-in account's OWN address and nothing else — there is no
// recipient in the body to choose — and it is throttled twice: once a minute
// from the row, six times in fifteen minutes from the IP.
if ($r === 'otp_send' && $method === 'POST') {
    $q = $db->prepare('select id, email, email_otp_enabled, email_otp_sent_at
                         from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u || (int)$u['email_otp_enabled'] !== 1) store_fail('not_enrolled', 409);
    if ($u['email_otp_sent_at'] !== null
        && time() - strtotime((string)$u['email_otp_sent_at']) < STORE_EMAIL_OTP_RESEND_SECONDS) {
        store_fail('too_soon', 429);
    }
    store_throttle($db, 'otp_send', 6, 900);
    $code = store_email_otp_issue($db, $u);
    store_out(['sent' => store_email_otp_send($u, $code),
               'to' => store_mask_email((string)$u['email'])]);
}

// Turning it OFF costs the password and a live code, exactly as turning TOTP
// off does: it is a change to who can sign in tomorrow, and an unlocked laptop
// must not be enough to make it.
if ($r === 'otp_disable' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select password_hash, email_otp_enabled from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u || (int)$u['email_otp_enabled'] !== 1) store_fail('not_enrolled', 409);

    store_throttle($db, 'account', 10, 300);
    if (!password_verify((string)($b['password'] ?? ''), (string)$u['password_hash'])) {
        store_fail('bad_password', 401);
    }
    store_throttle($db, 'totp', 10, 300);
    if (!store_email_otp_claim($db, (int)$admin['id'], (string)($b['code'] ?? ''))) {
        store_fail('bad_code', 401);
    }
    $db->prepare('update admin_users set email_otp_enabled = 0, email_otp_hash = null,
                      email_otp_expires = null, email_otp_attempts = 0 where id = ?')
       ->execute([$admin['id']]);
    store_out(['ok' => true, 'email_otp' => false]);
}

if ($r === 'totp_disable' && $method === 'POST') {
    $b = store_body();
    $q = $db->prepare('select password_hash from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    store_throttle($db, 'account', 10, 300);
    if (!$u || !password_verify((string)($b['password'] ?? ''), (string)$u['password_hash'])) {
        store_fail('bad_password', 401);
    }
    store_require_fresh_code($db, $admin, (string)($b['code'] ?? ''));
    $db->prepare('update admin_users set totp_enabled = 0, totp_secret = null, totp_last_step = null where id = ?')
       ->execute([$admin['id']]);
    store_out(['ok' => true, 'totp' => false]);
}

// Change the password, the email, or the mobile number. One route, because
// they carry the same authority and must not drift into three different ideas
// of how much proof a change needs.
if ($r === 'account_update' && $method === 'POST') {
    $b = store_body();

    $q = $db->prepare('select email, phone, password_hash from admin_users where id = ?');
    $q->execute([$admin['id']]);
    $u = $q->fetch();
    if (!$u) store_fail('account_not_found', 404);

    store_throttle($db, 'account', 10, 300);
    if (!password_verify((string)($b['password'] ?? ''), (string)$u['password_hash'])) {
        store_fail('bad_password', 401);
    }
    store_require_fresh_code($db, $admin, (string)($b['code'] ?? ''));

    $sets = [];
    $args = [];

    if (array_key_exists('new_password', $b) && (string)$b['new_password'] !== '') {
        $new = (string)$b['new_password'];
        // Twelve, the same floor setup-admin.php and reset-admin.php enforce.
        // Three places agreeing is the point: a password rule that is stricter
        // in one door than another is the weakest of the three.
        if (strlen($new) < 12) store_fail('password_too_short');
        // Typed twice, for the same reason reset-admin.php asks twice: a typo
        // here signs you out of a shop you can no longer sign in to.
        if (!hash_equals($new, (string)($b['new_password2'] ?? ''))) store_fail('password_mismatch');
        $sets[] = 'password_hash = ?';
        $args[] = password_hash($new, PASSWORD_DEFAULT);
    }

    if (array_key_exists('email', $b)) {
        $email = mb_strtolower(trim((string)$b['email']));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) store_fail('invalid_email');
        if (mb_strlen($email) > 120) store_fail('invalid_email');
        if ($email !== $u['email']) {
            $dupe = $db->prepare('select 1 from admin_users where email = ? and id <> ?');
            $dupe->execute([$email, $admin['id']]);
            if ($dupe->fetchColumn()) store_fail('email_taken', 409);
            $sets[] = 'email = ?';
            $args[] = $email;
        }
    }

    if (array_key_exists('phone', $b)) {
        $phone = trim((string)$b['phone']);
        if ($phone === '') {
            $sets[] = 'phone = ?';
            $args[] = null;
        } else {
            // Digits, spaces and a leading + only. This is the owner's own
            // number and it is not dialled by any code — but a free-text column
            // on an admin row is somewhere to hide a payload, and refusing is
            // cheaper than remembering to escape it everywhere it is shown.
            if (!preg_match('/^\+?[0-9 ]{6,19}$/', $phone)) store_fail('invalid_phone');
            $sets[] = 'phone = ?';
            $args[] = $phone;
        }
    }

    if (!$sets) store_fail('nothing_to_update');

    $args[] = $admin['id'];
    $db->prepare('update admin_users set ' . implode(', ', $sets) . ' where id = ?')->execute($args);

    // A CHANGED PASSWORD ENDS EVERY SESSION, INCLUDING THIS ONE. The reason
    // people change a password is that they think someone else may have it,
    // and leaving the other browser signed in is exactly the thing they were
    // trying to stop. The email is refreshed in the session instead, so a
    // rename does not sign the owner out of their own screen.
    if (in_array('password_hash = ?', $sets, true)) {
        store_session_end();
        store_out(['ok' => true, 'signed_out' => true]);
    }
    if (array_key_exists('email', $b) && in_array('email = ?', $sets, true)) {
        $_SESSION['admin_email'] = $args[array_search('email = ?', $sets, true)];
    }
    store_out(['ok' => true]);
}

// ---------------------------------------------------------------- Web Push
// The owner's phone. See push.mysql.sql for the shape and webpush.php for the
// crypto; these four routes are only the plumbing between the two.

// What the Notifications screen needs on its first render, in one call: the
// key the browser must subscribe with, whether the feature is configured at
// all, and which devices are already signed up.
if ($r === 'push_state') {
    $cfg = store_config();
    $ready = ($cfg['vapid_public'] ?? '') !== '' && ($cfg['vapid_private'] ?? '') !== '';
    $subs = [];
    $recent = [];
    if ($ready) {
        // A shop that has the keys but has not imported push.mysql.sql would
        // 500 here on a missing table. Answer "configured, no devices" instead:
        // the screen then says exactly what is wrong in its own words.
        try {
            $subs = $db->query(
                'select id, label, created_at, last_ok_at, last_error,
                        substring(endpoint, 1, 40) as endpoint_head
                   from push_subscriptions order by id'
            )->fetchAll();
            $recent = $db->query(
                'select id, title, body, created_at, sent_at, attempts, last_error
                   from push_outbox order by id desc limit 10'
            )->fetchAll();
        } catch (Throwable $e) {
            store_out(['ready' => false, 'reason' => 'no_table',
                       'public_key' => '', 'subscriptions' => [], 'recent' => []]);
        }
    }
    store_out([
        'ready'         => $ready,
        'reason'        => $ready ? '' : 'no_keys',
        // The PUBLIC half only. The private scalar never leaves the server —
        // it is what proves a push came from this shop.
        'public_key'    => $ready ? (string) $cfg['vapid_public'] : '',
        'subscriptions' => $subs,
        'recent'        => $recent,
    ]);
}

// Record this browser. The body is PushSubscription.toJSON() plus a label.
if ($r === 'push_subscribe' && $method === 'POST') {
    $b = store_body();
    $endpoint = trim((string) ($b['endpoint'] ?? ''));
    $p256dh   = trim((string) ($b['p256dh'] ?? ''));
    $auth     = trim((string) ($b['auth'] ?? ''));

    // Only the two push services this shop can actually reach, over TLS. A
    // subscription is an outbound POST the cron makes on a schedule with no
    // human watching; an arbitrary URL in this column is a server-side request
    // forgery with a cron job driving it.
    if (!preg_match('~^https://[a-z0-9.-]+\.(apple|googleapis|mozilla)\.com/~i', $endpoint)
        || strlen($endpoint) > 500) {
        store_fail('bad_endpoint');
    }
    require_once __DIR__ . '/webpush.php';
    // Validate the keys HERE, where a person is watching, rather than at 3am in
    // a cron whose only symptom is a phone that never buzzes.
    if (strlen(wp_b64_decode($p256dh)) !== 65) store_fail('bad_p256dh');
    if (strlen(wp_b64_decode($auth)) !== 16)   store_fail('bad_auth');

    // Re-subscribing the same phone must not add a second row — the browser
    // hands back the identical endpoint, and two rows would mean two buzzes.
    $db->prepare(
        'insert into push_subscriptions (endpoint, endpoint_hash, p256dh, auth, label)
         values (?, ?, ?, ?, ?)
         on duplicate key update p256dh = values(p256dh), auth = values(auth),
                                 label = values(label), last_error = null'
    )->execute([$endpoint, hash('sha256', $endpoint), $p256dh, $auth,
                mb_substr(trim((string) ($b['label'] ?? '')), 0, 60)]);
    store_out(['ok' => true]);
}

// Stop notifying one device. By id, from the list the screen already has.
if ($r === 'push_unsubscribe' && $method === 'POST') {
    $b = store_body();
    $db->prepare('delete from push_subscriptions where id = ?')->execute([(int) ($b['id'] ?? 0)]);
    store_out(['ok' => true]);
}

// Queue a test alert. NOT a direct send: it goes through the same outbox and
// the same cron as a real order, so a green test proves the path an order will
// actually take rather than a second one written to look like it.
if ($r === 'push_test' && $method === 'POST') {
    $db->prepare('insert into push_outbox (order_id, kind, title, body, url) values (null, ?, ?, ?, ?)')
       ->execute(['test', 'سبورتا · تجربة', 'إذا وصلك هذا، فإشعارات الطلبات تعمل.', '/backends']);
    store_out(['ok' => true]);
}

// ------------------------------------------------------------- size charts
//
// The numbers behind "what is my size?". They are seeded from the guide the
// site has always published and they are NOT ours — they belong to whoever
// cuts the garments. is_default marks a row nobody has checked against a real
// garment yet, and the screen says so, because advice built on unverified
// numbers should not look identical to advice built on the factory's spec.

if ($r === 'size_charts') {
    $rows = $db->query(
        'select id, chart, size, chest_min, chest_max, waist_min, waist_max,
                hip_min, hip_max, length_cm, is_default, sort
           from size_charts order by chart, sort, id'
    )->fetchAll();
    // How much the advice is actually being used, and on what. A chart nobody
    // consults is not worth an afternoon with a tape measure; one that answers
    // fifty questions a week is.
    $stats = $db->query(
        "select count(*) total,
                sum(confidence = 'high') measured,
                sum(confidence = 'low') estimated,
                sum(outcome = 'returned') returned
           from size_advice_log where created_at > date_sub(now(), interval 30 day)"
    )->fetch() ?: [];
    store_out(['rows' => $rows, 'stats' => $stats]);
}

if ($r === 'size_chart_save' && $method === 'POST') {
    $b = store_body();
    $id = (int) ($b['id'] ?? 0);
    // A band is only a band if its top is at or above its bottom. A row saved
    // the wrong way round does not error anywhere — it silently matches
    // NOBODY, and the adviser then answers every body with the last size in
    // the chart.
    $pair = function (string $lo, string $hi) use ($b) {
        $a = $b[$lo] === '' || $b[$lo] === null ? null : (int) $b[$lo];
        $z = $b[$hi] === '' || $b[$hi] === null ? null : (int) $b[$hi];
        if ($a === null || $z === null) return [null, null];
        if ($a < 30 || $z > 250 || $z < $a) store_fail('bad_range');
        return [$a, $z];
    };
    [$c1, $c2] = $pair('chest_min', 'chest_max');
    [$w1, $w2] = $pair('waist_min', 'waist_max');
    [$h1, $h2] = $pair('hip_min', 'hip_max');
    if ($c1 === null || $w1 === null) store_fail('chest_and_waist_required');

    $size = strtoupper(trim((string) ($b['size'] ?? '')));
    if (!in_array($size, ['S','M','L','XL','2XL','3XL','4XL','5XL'], true)) store_fail('bad_size');
    $chart = preg_replace('/[^a-z0-9_-]/', '', strtolower(trim((string) ($b['chart'] ?? ''))));
    if ($chart === '') store_fail('bad_chart');

    $args = [$chart, $size, $c1, $c2, $w1, $w2, $h1, $h2,
             ($b['length_cm'] ?? '') === '' ? null : (int) $b['length_cm'],
             (int) ($b['sort'] ?? 0)];
    if ($id > 0) {
        // Any hand-edited row stops being a default, by definition: somebody
        // has now looked at it.
        $db->prepare('update size_charts set chart=?, size=?, chest_min=?, chest_max=?,
                        waist_min=?, waist_max=?, hip_min=?, hip_max=?, length_cm=?, sort=?,
                        is_default = 0 where id = ?')
           ->execute([...$args, $id]);
    } else {
        $db->prepare('insert into size_charts (chart, size, chest_min, chest_max, waist_min,
                        waist_max, hip_min, hip_max, length_cm, sort, is_default)
                      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                      on duplicate key update chest_min=values(chest_min), chest_max=values(chest_max),
                        waist_min=values(waist_min), waist_max=values(waist_max),
                        hip_min=values(hip_min), hip_max=values(hip_max),
                        length_cm=values(length_cm), sort=values(sort), is_default=0')
           ->execute($args);
    }
    store_out(['ok' => true]);
}

// What the shop has been telling people, newest first. The one screen that
// says whether the chart is any good.
if ($r === 'size_advice_log') {
    store_out($db->query(
        'select id, created_at, slug, lang, height_cm, weight_kg, chest_cm, waist_cm,
                hip_cm, usual_size, prefers, size, fit, confidence, outcome
           from size_advice_log order by id desc limit 100'
    )->fetchAll());
}

// ===========================================================================
// ACCOUNTING
//
// The ledger itself is in accounting.php; these routes are only a door onto
// it. Two rules hold across all of them:
//
//   * Every route degrades to a clear "not installed" rather than a 500 if
//     accounting.mysql.sql has not been imported. A shop mid-upgrade must be
//     told what to do, not shown a stack trace.
//   * Nothing here can edit or delete a posted entry, because acc_post() is
//     the only writer and it does not offer either. A correction is a
//     reversal, and that is a route of its own.
// ===========================================================================

// Is the ledger installed? Asked once, cached for the request, and every
// accounting route below is guarded by it.
function admin_acc_ready(PDO $db): bool {
    static $ready = null;
    if ($ready === null) {
        try {
            $db->query('select 1 from accounts limit 1');
            require_once __DIR__ . '/accounting.php';
            $ready = true;
        } catch (Throwable $e) {
            $ready = false;
        }
    }
    return $ready;
}

if (str_starts_with($r, 'acc_') && !admin_acc_ready($db)) {
    // 200 with a flag, not an error status: this is a normal state for a shop
    // that has not run the migration, and the screen renders instructions from
    // it. A 500 here would read as a broken admin.
    store_out(['installed' => false,
               'hint' => 'Import dropin/php-store/accounting.mysql.sql in phpMyAdmin.']);
}

// The Accounting screen's opening state: is posting on, what is the rate, and
// how much is owed to the ledger. The last of those is the number that matters
// — a ledger can balance perfectly while missing a week of sales.
if ($r === 'acc_summary') {
    $unposted = acc_unposted_orders($db);
    $owed = 0;
    foreach ($unposted as $o) $owed += store_fils($o['amount']);
    store_out([
        'installed' => true,
        'settings'  => acc_settings($db),
        'unposted_count' => count($unposted),
        'unposted_total' => store_kwd($owed),
        'unposted' => array_slice($unposted, 0, 25),
    ]);
}

if ($r === 'acc_accounts') {
    store_out(acc_accounts($db));
}

if ($r === 'acc_trial_balance') {
    store_out(acc_trial_balance($db, $_GET['from'] ?? null, $_GET['to'] ?? null));
}

if ($r === 'acc_pl') {
    store_out(acc_profit_loss($db, admin_acc_date($_GET['from'] ?? null, '-1 month'),
                                   admin_acc_date($_GET['to'] ?? null, 'now')));
}

if ($r === 'acc_bs') {
    store_out(acc_balance_sheet($db, admin_acc_date($_GET['as_at'] ?? null, 'now')));
}

if ($r === 'acc_journal') {
    store_out(['entries' => acc_journal($db, $_GET['from'] ?? null, $_GET['to'] ?? null,
                                        min(200, max(1, (int)($_GET['limit'] ?? 100))))]);
}

// A date from the query string, or a sensible default. VALIDATED rather than
// interpolated: these reach a prepared statement, so this is not an injection
// guard — it is a guard against a malformed date silently selecting nothing
// and the screen reporting a month of zero sales as though that were the
// answer.
function admin_acc_date(?string $v, string $fallback): string {
    if ($v !== null && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) return $v;
    return date('Y-m-d', strtotime($fallback));
}

// A manual entry — an expense, an owner contribution, an opening balance.
//
// The lines arrive from the browser and are checked HERE as well as in
// acc_post(), because the two checks answer different questions: this one
// rejects a shape the screen should never have sent, and acc_post() enforces
// the accounting rule. Neither substitutes for the other.
if ($r === 'acc_entry_add' && $method === 'POST') {
    $b = store_body();
    $date = admin_acc_date($b['date'] ?? null, 'now');
    $memo = mb_substr(trim((string)($b['memo'] ?? '')), 0, 200);
    if ($memo === '') store_fail('memo_required');

    $lines = [];
    foreach ((array)($b['lines'] ?? []) as $l) {
        $code = trim((string)($l['code'] ?? ''));
        if ($code === '') continue;
        // Amounts arrive as KWD strings from a form and become fils here, once.
        $debit  = store_fils($l['debit']  ?? 0);
        $credit = store_fils($l['credit'] ?? 0);
        if ($debit < 0 || $credit < 0) store_fail('negative_amount');
        $lines[] = ['code' => $code, 'debit' => $debit, 'credit' => $credit,
                    'memo' => mb_substr(trim((string)($l['memo'] ?? '')), 0, 200)];
    }
    if (count($lines) < 2) store_fail('two_lines_required');

    try {
        $id = acc_post($db, $date, $memo, $lines, 'manual', null, null,
                       (string)($_SESSION['admin_email'] ?? ''));
    } catch (InvalidArgumentException | RuntimeException $e) {
        // The message is the accounting rule that was broken — "entry does not
        // balance — debits 5.000 vs credits 4.999" — and it is exactly what
        // the person typing needs to see. A generic 'failed' would send them
        // to count the figures themselves.
        //
        // ONLY THOSE TWO CLASSES, and that is the fix. This used to catch
        // Throwable and hand the message straight out, but acc_post() also
        // runs SQL: a PDOException escaping it put the driver's text — the
        // statement, the column, the constraint name — on the Accounting
        // screen. accounting.php throws nothing but these two, and every one
        // of the six is a sentence written for a bookkeeper.
        store_fail($e->getMessage());
    } catch (Throwable $e) {
        // Anything else is this shop's problem, not the bookkeeper's. It goes
        // to the server log, where it can be read by someone who can act on
        // it, and the screen says only that the entry did not post.
        error_log('acc_entry_add: ' . $e->getMessage());
        store_fail('could_not_post');
    }
    store_out(['id' => $id]);
}

if ($r === 'acc_entry_reverse' && $method === 'POST') {
    $b = store_body();
    $id = (int)($b['entry_id'] ?? 0);
    $memo = mb_substr(trim((string)($b['memo'] ?? '')), 0, 200) ?: 'Reversal';
    $new = acc_reverse($db, $id, $memo, (string)($_SESSION['admin_email'] ?? ''));
    if ($new === null) store_fail('cannot_reverse');
    store_out(['id' => $new]);
}

// Post the backlog — every paid order the ledger has not seen.
//
// Bounded per call, and that is not caution about time: it is so the screen
// can show what happened and be pressed again. A single call that posts nine
// hundred orders and returns one number is a call nobody can check.
if ($r === 'acc_post_unposted' && $method === 'POST') {
    if (!(acc_settings($db)['posting_enabled'] ?? false)) store_fail('posting_disabled');
    $done = 0; $failed = [];
    foreach (array_slice(acc_unposted_orders($db), 0, 100) as $o) {
        try {
            $done += acc_post_order($db, (int)$o['id'], (string)($_SESSION['admin_email'] ?? ''));
        } catch (InvalidArgumentException | RuntimeException $e) {
            // One bad order must not stop the other ninety-nine. It is named
            // instead, so it can be fixed at its source.
            //
            // THESE TWO CLASSES ONLY, for the reason given at acc_entry_add
            // above: acc_post_order() runs four prepared statements, so a
            // PDOException caught here would put the driver's text — the
            // statement, the column, the constraint name — on the Accounting
            // screen next to a customer's track ID. The two classes
            // accounting.php raises are sentences written for a bookkeeper;
            // anything else is this shop's problem, not theirs.
            $failed[] = ['track_id' => $o['track_id'], 'why' => $e->getMessage()];
        } catch (Throwable $e) {
            error_log('acc_post_unposted ' . $o['track_id'] . ': ' . $e->getMessage());
            $failed[] = ['track_id' => $o['track_id'], 'why' => 'could_not_post'];
        }
    }
    store_out(['posted' => $done, 'failed' => $failed,
               'remaining' => count(acc_unposted_orders($db))]);
}

if ($r === 'acc_settings_save' && $method === 'POST') {
    $b = store_body();
    $cur = acc_settings($db);
    $rate = trim((string)($b['aed_to_kwd'] ?? $cur['aed_to_kwd']));
    // A rate of zero would post every cost of goods as nothing, balance
    // perfectly, and report a margin of 100%. Refused rather than stored.
    if (!preg_match('/^\d+(\.\d{1,6})?$/', $rate) || (float)$rate <= 0) store_fail('bad_rate');
    store_setting_save($db, 'accounting', [
        'aed_to_kwd' => $rate,
        'posting_enabled' => (bool)($b['posting_enabled'] ?? $cur['posting_enabled']),
    ]);
    store_out(['ok' => true]);
}

// Add or rename an account. SYSTEM accounts cannot be touched: the posting
// rules name them by code, and renaming 4000 out from under acc_post_order()
// breaks posting on a live shop at the moment of a payment.
if ($r === 'acc_account_save' && $method === 'POST') {
    $b = store_body();
    $code = trim((string)($b['code'] ?? ''));
    $type = (string)($b['type'] ?? '');
    if (!preg_match('/^[0-9]{4}$/', $code)) store_fail('bad_code');
    if (!in_array($type, ['asset','liability','equity','revenue','expense'], true)) store_fail('bad_type');
    $nameEn = mb_substr(trim((string)($b['name_en'] ?? '')), 0, 80);
    $nameAr = mb_substr(trim((string)($b['name_ar'] ?? '')), 0, 80) ?: $nameEn;
    if ($nameEn === '') store_fail('name_required');

    $q = $db->prepare('select is_system from accounts where code = ?');
    $q->execute([$code]);
    $existing = $q->fetch();
    if ($existing && (int)$existing['is_system'] === 1) store_fail('system_account');

    $side = in_array($type, ['asset','expense'], true) ? 'debit' : 'credit';
    $db->prepare('insert into accounts (code, name_en, name_ar, type, normal_side, is_system, active)
                  values (?, ?, ?, ?, ?, 0, 1)
                  on duplicate key update name_en = values(name_en), name_ar = values(name_ar),
                                          type = values(type), normal_side = values(normal_side)')
       ->execute([$code, $nameEn, $nameAr, $type, $side]);
    store_out(['ok' => true]);
}

store_fail('not_found', 404);
