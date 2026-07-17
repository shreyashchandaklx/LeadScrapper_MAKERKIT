<?php
/**
 * activity-log.php
 *
 * Intake endpoint for FRONTEND user-activity events (Lead Scrapper React app).
 * The browser logger (utils/activityLogger.js) POSTs events here; we validate,
 * clamp, rate-limit, and hand off to lib/activity_logger.php.
 *
 *   POST /activity-log.php
 *   { event, count?, meta?, user?, page? }
 *   -> { success: true }
 *
 * Notes:
 *   - Backend events (search/city_search) are logged server-side in apify-proxy.php
 *     where the count is authoritative; this endpoint is for browser-only actions
 *     (export, report, email_written, login).
 *   - Rate limit: ~60 events/min per IP (a touch higher than errors — normal usage
 *     fires more activity than errors).
 *   - NEVER returns 5xx for logging problems — worst case it still responds 200.
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

require_once __DIR__ . '/lib/activity_logger.php';

/** ── Rate limit: max 60 events per IP per minute ──────────────────────── */
function actlog_rate_limited($ip) {
    $dir = sys_get_temp_dir();
    $file = $dir . '/actlog-rate-' . md5($ip) . '-' . date('YmdHi'); // per-IP per-minute bucket
    $count = (int) @file_get_contents($file);
    if ($count >= 60) return true;
    @file_put_contents($file, (string) ($count + 1), LOCK_EX);
    if (mt_rand(1, 50) === 1) {
        foreach (glob($dir . '/actlog-rate-*') ?: [] as $old) {
            if (@filemtime($old) < time() - 300) @unlink($old);
        }
    }
    return false;
}

$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
if (actlog_rate_limited($ip)) {
    http_response_code(429);
    echo json_encode(['success' => false, 'error' => 'rate limited']);
    exit;
}

/** ── Parse + validate body ────────────────────────────────────────────── */
$raw = file_get_contents('php://input');
if (strlen($raw) > 16384) { // 16 KB cap on the whole payload
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

$event = trim((string) ($body['event'] ?? ''));
if ($event === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'event required']);
    exit;
}

log_activity((string) ($body['user'] ?? 'anonymous'), $event, [
    'source'    => 'frontend',
    'count'     => (int) ($body['count'] ?? 0),
    'meta'      => is_array($body['meta'] ?? null) ? $body['meta'] : [],
    'page'      => (string) ($body['page'] ?? ''),
    'ip'        => $ip,
    'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
]);

echo json_encode(['success' => true]);
