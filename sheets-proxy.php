<?php
error_reporting(E_ALL & ~E_DEPRECATED);
/**
 * sheets-proxy.php
 * Proxies Google Apps Script calls to avoid CORS issues.
 */
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/lib/error_logger.php';

$gasUrl = $_GET['gasUrl'] ?? '';
if (!$gasUrl || strpos($gasUrl, 'script.google.com') === false) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing or invalid gasUrl']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $params = $_GET;
    unset($params['gasUrl']);
    $queryString = http_build_query($params);
    $url = $gasUrl . ($queryString ? '?' . $queryString : '');

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 60);
    $response = curl_exec($ch);
    $error = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false) {
        $errorId = log_error('GEN', 'sheets-proxy curl error (GET): ' . $error, [
            'context' => ['gasUrl' => substr($gasUrl, 0, 256)],
        ]);
        http_response_code(500);
        echo json_encode(['error' => 'Curl error: ' . $error, 'errorId' => $errorId]);
    } else {
        http_response_code($httpCode);
        echo $response;
    }
} elseif ($method === 'POST') {
    $body = file_get_contents('php://input');

    $ch = curl_init($gasUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 60);
    $response = curl_exec($ch);
    $error = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false) {
        $errorId = log_error('GEN', 'sheets-proxy curl error (POST): ' . $error, [
            'context' => ['gasUrl' => substr($gasUrl, 0, 256)],
        ]);
        http_response_code(500);
        echo json_encode(['error' => 'Curl error: ' . $error, 'errorId' => $errorId]);
    } else {
        http_response_code($httpCode);
        echo $response;
    }
}
