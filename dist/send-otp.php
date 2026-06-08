<?php
// send-otp.php

// Required headers for typical cross-origin requests, though usually not needed if on same origin
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json; charset=UTF-8");

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/lib/error_logger.php';

// Only allow POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method Not Allowed']);
    exit;
}

// Read the raw JSON payload from fetch API
$inputJSON = file_get_contents('php://input');
$input = json_decode($inputJSON, TRUE);

// Extract parameters safely
$email = isset($input['email']) ? trim($input['email']) : '';
$otp = isset($input['otp']) ? trim($input['otp']) : '';

if (!$email || !$otp) {
    http_response_code(400);
    echo json_encode(['error' => 'Email and OTP are required', 'body' => $inputJSON]);
    exit;
}

// Your Resend API Key
$envConfig = @parse_ini_file(__DIR__ . '/.env') ?: [];
$RESEND_API_KEY = $envConfig['RESEND_API_KEY'] ?? 're_CJdJkCQu_FNFo6S3P9meonG3niaedpo3g';

// Make a cURL request to the Resend API
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://api.resend.com/emails');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);

// Construct properties as required by Resend payload
$payload = json_encode([
    'from' => 'Pixnom <info@pixnom.com>',
    'to' => [$email],
    'subject' => 'Your Login OTP',
    'html' => '<p>Your One-Time Password (OTP) for login is: <strong>' . htmlspecialchars($otp) . '</strong></p>'
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);

$headers = [
    'Authorization: Bearer ' . $RESEND_API_KEY,
    'Content-Type: application/json'
];
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

// Execute cURL and get response
$result = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);

if (curl_errno($ch)) {
    $errorId = log_error('GEN', 'send-otp curl error: ' . curl_error($ch), [
        'user' => $email, 'action' => 'send-otp',
    ]);
    http_response_code(500);
    echo json_encode(['error' => 'Curl internal error: ' . curl_error($ch), 'errorId' => $errorId]);
    curl_close($ch);
    exit;
}

curl_close($ch);

// Output the result identically to the serverless function
if ($http_code >= 200 && $http_code < 300) {
    http_response_code(200);
    $responseData = json_decode($result, true) ?: [];
    echo json_encode(['success' => true, 'data' => $responseData]);
} else {
    $errorId = log_error('GEN', 'Resend API returned ' . $http_code, [
        'user'    => $email,
        'action'  => 'send-otp',
        'context' => ['response' => substr((string) $result, 0, 512)],
    ]);
    http_response_code($http_code);
    echo json_encode([
        'error' => 'Failed to send email via Resend API',
        'details' => json_decode($result, true) ?: $result,
        'errorId' => $errorId
    ]);
}
?>
