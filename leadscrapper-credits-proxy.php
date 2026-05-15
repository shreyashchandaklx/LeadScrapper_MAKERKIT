<?php
/**
 * leadscrapper-credits-proxy.php
 *
 * Server-side proxy: forwards credit reads/deductions from leadscrapper.pixnom.com
 * to app.pixnom.com (Makerkit). Same-origin from the browser's perspective, no
 * CORS, no cookie juggling.
 *
 * Auth: sends shared service token (LEADSCRAPPER_SERVICE_TOKEN in .env) in
 * X-Leadscrapper-Token header. Mirror of map2web-proxy.php.
 *
 * Usage from JS:
 *   GET  /leadscrapper-credits-proxy.php?path=balance&email=foo@bar.com
 *   POST /leadscrapper-credits-proxy.php?path=deduct-leads   { email, leadCount }
 */

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$envConfig = [];
if (file_exists(__DIR__ . '/.env')) {
    $lines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || $line[0] === ';') continue;
        if (strpos($line, '=') === false) continue;
        list($name, $value) = explode('=', $line, 2);
        $name = trim($name);
        $value = trim($value);
        $value = preg_replace('/^["\'](.*)["\']$/', '$1', $value);
        $envConfig[$name] = $value;
    }
}

// Reuse MAP2WEB_ORIGIN if set (same Makerkit host) — fallback to MAKERKIT_ORIGIN, then prod default.
$upstreamBase = rtrim(
    $envConfig['MAKERKIT_ORIGIN']
        ?? $envConfig['MAP2WEB_ORIGIN']
        ?? 'https://app.pixnom.com',
    '/'
);
$allowed = ['balance', 'deduct-leads'];
$path = $_GET['path'] ?? '';
if (!in_array($path, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid path', 'allowed' => $allowed]);
    exit;
}

// ------------------------------------------------------------------
// Route mapping (leadscrapper-side path  ->  Makerkit endpoint + method)
// ------------------------------------------------------------------
if ($path === 'balance') {
    $email = trim($_GET['email'] ?? '');
    if ($email === '') {
        http_response_code(400);
        echo json_encode(['error' => 'email query param required']);
        exit;
    }
    $url    = $upstreamBase . '/api/supabase/credits/get?email=' . rawurlencode($email);
    $method = 'GET';
    $body   = '';
} else { // deduct-leads
    $url    = $upstreamBase . '/api/supabase/credits/deduct-leads';
    $method = 'POST';
    $body   = file_get_contents('php://input');
    if ($body === false) $body = '';
}

$headers = [
    'Content-Type: application/json',
    'Accept: application/json',
];

$ch = curl_init($url);
$opts = [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_HEADER         => false,
    CURLOPT_SSL_VERIFYPEER => true,
];
if ($method === 'POST') {
    $opts[CURLOPT_POST]       = true;
    $opts[CURLOPT_POSTFIELDS] = $body;
}
curl_setopt_array($ch, $opts);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$err = curl_error($ch);
curl_close($ch);

if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'upstream fetch failed', 'detail' => $err, 'url' => $url]);
    exit;
}

http_response_code($httpCode ?: 502);
if ($contentType) {
    header('Content-Type: ' . $contentType);
}
echo $response;
