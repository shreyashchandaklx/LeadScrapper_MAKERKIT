<?php
/**
 * error-log.php
 *
 * Intake endpoint for FRONTEND errors (Lead Scrapper React app).
 * The browser-side logger (utils/errorLogger.js) POSTs error reports here;
 * we validate, clamp, rate-limit, and hand off to lib/error_logger.php.
 *
 *   POST /error-log.php
 *   { module, message, stack?, user?, page?, component?, action?, context?, errorId? }
 *   -> { success: true, errorId: "ERR-LS-..." }
 *
 * Notes:
 *   - errorId from the client is reused if well-formed (UI shows it instantly,
 *     before this request even completes).
 *   - Rate limit: ~30 writes/min per IP via a tiny file-based counter, so an
 *     error loop in one browser can't flood the disk.
 *   - This endpoint NEVER returns 5xx for logging problems — worst case it
 *     still responds with a usable errorId (see lib/error_logger.php fallbacks).
 */

error_reporting(E_ALL & ~E_DEPRECATED);
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'POST only']);
    exit;
}

require_once __DIR__ . '/lib/error_logger.php';

/** ── Rate limit: max 30 reports per IP per minute ─────────────────────── */
function errlog_rate_limited($ip) {
    $dir = sys_get_temp_dir();
    $file = $dir . '/errlog-rate-' . md5($ip) . '-' . date('YmdHi'); // per-IP per-minute bucket
    $count = (int) @file_get_contents($file);
    if ($count >= 30) return true;
    @file_put_contents($file, (string) ($count + 1), LOCK_EX);
    // opportunistic cleanup: remove buckets older than ~5 min (cheap, occasional)
    if (mt_rand(1, 50) === 1) {
        foreach (glob($dir . '/errlog-rate-*') ?: [] as $old) {
            if (@filemtime($old) < time() - 300) @unlink($old);
        }
    }
    return false;
}

$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (errlog_rate_limited($ip)) {
    http_response_code(429);
    echo json_encode(['success' => false, 'error' => 'rate limited']);
    exit;
}

/** ── Parse + validate body ────────────────────────────────────────────── */
$raw = file_get_contents('php://input');
if (strlen($raw) > 32768) { // 32 KB hard cap on the whole payload
    http_response_code(413);
    echo json_encode(['success' => false, 'error' => 'payload too large']);
    exit;
}
$body = json_decode($raw, true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'invalid JSON']);
    exit;
}

$message = trim((string) ($body['message'] ?? ''));
if ($message === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'message required']);
    exit;
}

$errorId = log_error((string) ($body['module'] ?? 'GEN'), $message, [
    'source'    => 'frontend',
    'errorId'   => is_string($body['errorId'] ?? null) ? $body['errorId'] : null,
    'user'      => (string) ($body['user'] ?? 'anonymous'),
    'page'      => (string) ($body['page'] ?? ''),
    'component' => (string) ($body['component'] ?? ''),
    'action'    => (string) ($body['action'] ?? ''),
    'stack'     => (string) ($body['stack'] ?? ''),
    'context'   => is_array($body['context'] ?? null) ? $body['context'] : [],
    'ip'        => $ip,
    'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
]);

echo json_encode(['success' => true, 'errorId' => $errorId]);
