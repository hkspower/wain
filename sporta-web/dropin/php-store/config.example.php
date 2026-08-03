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

    // ---------------------------------------------------- سبورتا AI (optional)
    //
    // The assistant works with every one of these empty. They add, in order: a
    // model that rewords answers, a voice that speaks them, and a webhook that
    // hands a customer to a human.

    // A language model. It may only ever REWORD facts the shop already looked
    // up — it is never asked what an order's status is. Leave blank and every
    // answer is the shop's own wording.
    'ai_key'   => '',
    'ai_url'   => 'https://api.anthropic.com/v1/messages',
    'ai_model' => 'claude-haiku-4-5-20251001',

    // ElevenLabs, for reading answers aloud in Arabic.
    //
    // voice_id is the ONE value you have to choose yourself: open
    // elevenlabs.io -> Voices, filter to Arabic, and audition until you find a
    // Kuwaiti/Gulf male around 40. Paste its ID here. There is no "Kuwaiti"
    // switch — the accent lives in the voice you pick, not in a setting.
    //
    // The model must be multilingual or the Arabic comes out as English
    // phonemes read off Arabic letters, which is worse than silence.
    'tts_key'      => '',
    'tts_voice_id' => '',
    'tts_model'    => 'eleven_multilingual_v2',
    // Spoken answers are cached here by content hash. The fixed replies
    // (delivery, returns, payment) are identical every time, so they are
    // synthesised ONCE and never paid for again. Above public_html: an audio
    // cache in the web root is a directory anyone can walk.
    'tts_cache_dir' => __DIR__ . '/../../sporta-voice',

    // n8n. When a customer asks for a human, or the assistant cannot answer,
    // the conversation is POSTed here. n8n does the rest — WhatsApp, email,
    // a row in a sheet, whatever the shop wants. Blank = nothing is sent.
    'n8n_webhook' => '',
    // Sent as X-Sporta-Signature so the workflow can refuse anything that did
    // not come from this shop. A webhook URL is a secret only until it is in
    // somebody's browser history.
    'n8n_secret'  => '',
];
