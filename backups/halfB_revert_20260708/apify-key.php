<?php
/**
 * apify-key.php
 *
 * Manages per-user Apify API keys stored in user_credits."ApifyToken".
 *
 * GET  ?action=get&email=        → { success: true, hasKey: bool }
 * POST ?action=save              body: { email, apifyToken }
 *                                → { success: true, valid: bool }
 * POST ?action=delete            body: { email }
 *                                → { success: true }
 *
 * The token is validated against Apify's /v2/users/me endpoint before saving.
 * The raw token is NEVER returned to the frontend — only whether one exists.
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');
require_once __DIR__ . '/lib/error_logger.php';
set_error_handler(function ($errno, $errstr, $errfile, $errline) {
    if (!(error_reporting() & $errno)) return;
    $errorId = log_error('LEAD', "PHP Error [$errno]: $errstr in $errfile:$errline", [
        'action' => $_GET['action'] ?? 'unknown',
    ]);
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => "PHP Error [$errno]: $errstr in $errfile:$errline", 'errorId' => $errorId]);
    exit;
});
register_shutdown_function(function () {
    $error = error_get_last();
    if ($error !== null && ($error['type'] === E_ERROR || $error['type'] === E_PARSE || $error['type'] === E_COMPILE_ERROR)) {
        $errorId = log_error('LEAD', "PHP Fatal Error: " . $error['message'] . " in " . $error['file'] . ":" . $error['line'], [
            'action' => $_GET['action'] ?? 'unknown',
        ]);
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['error' => "PHP Fatal Error: " . $error['message'] . " in " . $error['file'] . ":" . $error['line'], 'errorId' => $errorId]);
    }
});

require_once __DIR__ . '/lib/supabase.php';
require_once __DIR__ . '/lib/credits.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$action = $_GET['action'] ?? '';
$inputJSON = file_get_contents('php://input');
$input = json_decode($inputJSON, true) ?: [];

// ─── GET — check whether user has a saved key ──────────────────────────────

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'get') {
    $email = strtolower(trim($_GET['email'] ?? ''));
    if ($email === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'email required']);
        exit;
    }

    $token = credits_get_apify_token($email);
    echo json_encode(['success' => true, 'hasKey' => !empty($token)]);
    exit;
}

// ─── POST actions ──────────────────────────────────────────────────────────

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'POST or GET required']);
    exit;
}

// ─── SAVE — validate then store key ───────────────────────────────────────

if ($action === 'save') {
    $email      = strtolower(trim($input['email'] ?? ''));
    $apifyToken = trim($input['apifyToken'] ?? '');

    if ($email === '' || $apifyToken === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'email and apifyToken required']);
        exit;
    }

    // Validate token against Apify API
    $valid = validate_apify_token($apifyToken);
    if (!$valid) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'invalid Apify API token', 'valid' => false]);
        exit;
    }

    // Upsert into user_credits
    $existing = sb_select(
        'user_credits',
        'select=Email&Email=eq.' . rawurlencode($email) . '&limit=1'
    );

    if ($existing['status'] === 200 && !empty($existing['json'][0])) {
        // Row exists → patch
        $r = sb_update('user_credits', 'Email=eq.' . rawurlencode($email), [
            'ApifyToken' => $apifyToken,
        ]);
    } else {
        // No row → insert
        $r = sb_insert('user_credits', [
            'Email'      => $email,
            'ApifyToken' => $apifyToken,
        ]);
    }

    if ($r['status'] >= 300) {
        error_log('[apify-key.php save ERROR] ' . print_r($r, true));
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'database error', 'detail' => $r['raw']]);
        exit;
    }

    echo json_encode(['success' => true, 'valid' => true]);
    exit;
}

// ─── DELETE — clear saved key ─────────────────────────────────────────────

if ($action === 'delete') {
    $email = strtolower(trim($input['email'] ?? ''));
    if ($email === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'email required']);
        exit;
    }

    $r = sb_update('user_credits', 'Email=eq.' . rawurlencode($email), [
        'ApifyToken' => null,
    ]);

    if ($r['status'] >= 300) {
        error_log('[apify-key.php delete ERROR] ' . print_r($r, true));
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'database error']);
        exit;
    }

    echo json_encode(['success' => true]);
    exit;
}

// ─── Unknown action ───────────────────────────────────────────────────────

http_response_code(400);
echo json_encode(['success' => false, 'error' => 'unknown action']);

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Validate an Apify API token by hitting /v2/users/me.
 * Returns true if the token is valid (HTTP 200), false otherwise.
 */
function validate_apify_token(string $token): bool
{
    $ch = curl_init('https://api.apify.com/v2/users/me?token=' . rawurlencode($token));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
    ]);
    curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code === 200;
}
