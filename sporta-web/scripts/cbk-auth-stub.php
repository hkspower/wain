<?php
// Used by tpay-test.mjs: an Authenticate endpoint that answers the two ways
// CBK's manual allows and the fake gateway does not exercise.
//   /num/...  -> 200 { "Status": 1 (a JSON NUMBER), "AccessToken": "NUMTOKEN" }
//   /deny/... -> 401 (bad ClientId/ClientSecret, or an unregistered server IP)
header('Content-Type: application/json');
$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
if (str_starts_with($path, '/num/')) exit(json_encode(['Status' => 1, 'Message' => 'Success', 'AccessToken' => 'NUMTOKEN']));
http_response_code(401);
echo json_encode(['Status' => 0, 'Message' => 'Invalid']);
