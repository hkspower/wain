<?php
// A fake ElevenLabs, and a fake n8n, in one router.
//
// api.elevenlabs.io is not reachable from a test run — it needs a paid key and
// a network, and a suite that needs either is a suite nobody runs. So the
// shop's TTS base URL is pointed here (`tts_url`, which exists for this
// reason alone) and this answers the way ElevenLabs does: mp3 bytes and a 200.
//
// The two things it exists to prove:
//   * /calls counts upstream requests, so the test can show that asking for
//     the SAME sentence twice hits the network ONCE. That cache is the whole
//     cost model — without it every "when does it arrive" is a paid call.
//   * /n8n records the handoff and the X-Sporta-Signature header it arrived
//     with, so the test can show the workflow can tell this shop from anyone
//     who has seen the webhook URL.
declare(strict_types=1);

$state = sys_get_temp_dir() . '/sporta-fake-voice.json';
$read  = fn () => is_readable($state) ? (json_decode((string) file_get_contents($state), true) ?: []) : [];
$write = fn (array $s) => file_put_contents($state, json_encode($s));

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

// The recorder: what the test reads back.
if ($path === '/calls') {
    header('Content-Type: application/json');
    echo json_encode($read() + ['tts' => 0, 'n8n' => []]);
    exit;
}
if ($path === '/reset') { @unlink($state); echo 'ok'; exit; }

// Make the next N synthesis calls fail with a given status, so the test can
// prove that a wrong key is WRITTEN DOWN rather than becoming a silent null.
// /fail?code=401&n=1
if ($path === '/fail') {
    $s = $read();
    $s['fail_code'] = (int) ($_GET['code'] ?? 401);
    $s['fail_left'] = (int) ($_GET['n'] ?? 1);
    $write($s);
    echo 'ok';
    exit;
}
// Answer 200 with a JSON body instead of audio — the shape an upstream error
// sometimes actually takes, and the one that used to get cached as "audio"
// for ever.
if ($path === '/lie') { $s = $read(); $s['lie'] = 1; $write($s); echo 'ok'; exit; }

// ElevenLabs: POST /v1/text-to-speech/{voice_id}
if (str_starts_with($path, '/v1/text-to-speech/')) {
    $s = $read();
    $body = json_decode((string) file_get_contents('php://input'), true) ?: [];
    $s['tts'] = ($s['tts'] ?? 0) + 1;
    $s['last_text'] = $body['text'] ?? '';
    $s['last_model'] = $body['model_id'] ?? '';
    $s['last_voice'] = rawurldecode(substr($path, strlen('/v1/text-to-speech/')));
    $s['last_key'] = $_SERVER['HTTP_XI_API_KEY'] ?? '';
    // The format is a QUERY parameter, not a body field — recorded so the test
    // can prove the shop asks for speech-sized audio and not 128 kbps music.
    parse_str((string) (parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_QUERY) ?: ''), $qs);
    $s['last_format'] = $qs['output_format'] ?? '';
    $s['last_settings'] = $body['voice_settings'] ?? [];
    // Absent unless the shop is configured to pin the language — recorded so
    // the test can prove Kuwaiti Arabic is enforced, not detected.
    $s['last_language_code'] = $body['language_code'] ?? '';
    $s['texts'][] = $body['text'] ?? '';

    if (($s['fail_left'] ?? 0) > 0) {
        $s['fail_left']--;
        $write($s);
        http_response_code((int) $s['fail_code']);
        header('Content-Type: application/json');
        echo '{"detail":{"status":"invalid_api_key","message":"Invalid API key"}}';
        exit;
    }
    if (($s['lie'] ?? 0) === 1) {
        $s['lie'] = 0;
        $write($s);
        header('Content-Type: application/json');
        echo '{"detail":"quota exceeded"}';
        exit;
    }
    $write($s);
    header('Content-Type: audio/mpeg');
    // An ID3 header and a frame's worth of silence. Real enough that anything
    // sniffing the content type or the magic bytes is satisfied.
    echo "ID3\x03\x00\x00\x00\x00\x00\x00" . str_repeat("\xFF\xFB\x90\x00", 32);
    exit;
}

// n8n: the handoff webhook.
if ($path === '/n8n') {
    $s = $read();
    $raw = (string) file_get_contents('php://input');
    $s['n8n'][] = [
        'sig'  => $_SERVER['HTTP_X_SPORTA_SIGNATURE'] ?? '',
        'raw'  => $raw,
        'body' => json_decode($raw, true),
    ];
    $write($s);
    echo '{"ok":true}';
    exit;
}

http_response_code(404);
echo 'no';
