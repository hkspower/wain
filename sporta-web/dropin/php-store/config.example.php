<?php
// Sporta native backend — configuration TEMPLATE.
//
// Copy to config.php on the SERVER and fill in. config.php is never committed,
// never in the zip, never uploaded by npm run publish — the same rule as
// knet/config.php, for the same reason: it holds live credentials.
//
// The MySQL database is created in hPanel -> Databases -> MySQL Databases.
// Hostinger names them like u130124229_sporta; the user and password are set
// on the same screen.

return [
    // ---- MySQL (from hPanel -> Databases) ----
    'db_host' => 'localhost',
    'db_name' => '',
    'db_user' => '',
    'db_pass' => '',

    // ---- Fulfilment emails (cron-fulfilment.php) ----
    // The logistics company. Comma-separated for more than one recipient.
    'warehouse_email' => '',
    // Must be an address on a domain with SPF/DKIM set (DNS-EMAIL-RECORDS.txt)
    // or the mail lands in spam and nobody is told.
    'mail_from'       => 'orders@sporta.com.kw',
    'mail_reply_to'   => 'cs@sporta.com.kw',

    // ---- Cron shared secret ----
    // hPanel -> Advanced -> Cron Jobs calls cron-fulfilment.php with this in
    // the query string, so a stranger cannot make the server send mail:
    //   wget -qO- "https://www.sporta.com.kw/api/cron-fulfilment.php?key=PASTE_THE_SAME_VALUE"
    // Any long random string. Change it here and in the cron line together.
    'cron_key' => '',
];
