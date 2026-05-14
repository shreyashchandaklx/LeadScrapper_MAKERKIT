<?php
/**
 * map2web-proxy.php
 *
 * Server-side reverse proxy: forwards /api/map2web/* calls from
 * leadscrapper.pixnom.com → app.pixnom.com. Same-origin from the browser's
 * perspective, no CORS, no cookie juggling.
 *
 * Auth: passes a shared service token (MAP2WEB_SERVICE_TOKEN in .env) in the
 * `X-Map2Web-Token` header so the Map2Web Next.js app can recognise this as a
 * trusted server-to-server caller and skip the session-cookie check.
 *
 * Usage from JS:
 *   fetch('/map2web-proxy.php?path=build', { method:'POST', body: JSON.stringify({...}) })
 *   fetch('/map2web-proxy.php?path=publish', ...)
 *   fetch('/map2web-proxy.php?path=log', ...)
 */

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$envConfig = @parse_ini_file(__DIR__ . '/.env', false, INI_SCANNER_RAW) ?: [];

$upstreamBase = rtrim($envConfig['MAP2WEB_ORIGIN'] ?? 'https://app.pixnom.com', '/');
$serviceToken = trim($envConfig['MAP2WEB_SERVICE_TOKEN'] ?? '');

// Whitelist of forwardable endpoints. Anything outside this list is rejected.
$allowed = ['scrape', 'deduct', 'build', 'publish', 'log'];
$path = $_GET['path'] ?? '';
if (!in_array($path, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid path', 'allowed' => $allowed]);
    exit;
}

$body = file_get_contents('php://input');
if ($body === false) $body = '';

$url = $upstreamBase . '/api/map2web/' . $path;

$headers = ['Content-Type: application/json', 'Accept: application/json'];
if ($serviceToken !== '') {
    $headers[] = 'X-Map2Web-Token: ' . $serviceToken;
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $body,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_TIMEOUT        => 120,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_HEADER         => false,
    CURLOPT_SSL_VERIFYPEER => true,
]);

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
