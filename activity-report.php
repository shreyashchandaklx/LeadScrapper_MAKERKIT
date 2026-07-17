<?php
/**
 * activity-report.php
 *
 * Admin rollup reader for user-activity logs. Reads ONE day's
 * logs/YYYY-MM-DD/activity.log and returns a per-user + totals summary.
 * Files can't GROUP BY, so we tally in PHP (one day's file is small).
 *
 *   GET /activity-report.php?date=YYYY-MM-DD&key=<LEADSCRAPPER_SERVICE_TOKEN>
 *   -> {
 *        "date": "...",
 *        "users": { "u@x.com": { "search": {"actions":5,"leads":340}, ... } },
 *        "totals": { "search": 42, "leads": 2870, "report": 3, ... },
 *        "lines": 57
 *      }
 *
 * Gated by the existing LEADSCRAPPER_SERVICE_TOKEN in .env (admin-only).
 * Date defaults to today (server time). Never exposes raw log lines unless
 * ?raw=1 (still gated) for debugging.
 */

error_reporting(E_ALL & ~E_DEPRECATED);
header('Content-Type: application/json');

require_once __DIR__ . '/lib/supabase.php'; // for sb_load_env()

$env = function_exists('sb_load_env') ? sb_load_env() : [];
$adminToken = $env['LEADSCRAPPER_SERVICE_TOKEN'] ?? '';
$provided   = (string) ($_GET['key'] ?? '');
if ($adminToken === '' || !hash_equals($adminToken, $provided)) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

// Validate date (default today). Strict YYYY-MM-DD to prevent path traversal.
$date = (string) ($_GET['date'] ?? date('Y-m-d'));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    http_response_code(400);
    echo json_encode(['error' => 'date must be YYYY-MM-DD']);
    exit;
}

$file = __DIR__ . '/logs/' . $date . '/activity.log';
if (!is_file($file)) {
    echo json_encode(['date' => $date, 'users' => (object)[], 'totals' => (object)[], 'lines' => 0]);
    exit;
}

$fh = @fopen($file, 'r');
if (!$fh) {
    http_response_code(500);
    echo json_encode(['error' => 'could not read log']);
    exit;
}

$raw     = (($_GET['raw'] ?? '') === '1');
$rawOut  = [];
$users   = [];
$totals  = [];
$lines   = 0;

// "count" semantics per event: search/city_search → leads; export → rows;
// report/email/login → action count only. We expose actions for every event
// and a friendly secondary sum keyed by the event's natural unit.
$countLabel = [
    'search' => 'leads', 'city_search' => 'leads',
    'export' => 'rows', 'report' => 'reports',
    'email_written' => 'emails', 'login' => 'logins', 'other' => 'count',
];

while (($line = fgets($fh)) !== false) {
    $line = trim($line);
    if ($line === '') continue;
    $e = json_decode($line, true);
    if (!is_array($e)) continue;
    $lines++;
    if ($raw) { $rawOut[] = $e; continue; }

    $email = (string) ($e['email'] ?? 'anonymous');
    $event = (string) ($e['event'] ?? 'other');
    $count = (int) ($e['count'] ?? 0);

    if (!isset($users[$email])) $users[$email] = [];
    if (!isset($users[$email][$event])) {
        $users[$email][$event] = ['actions' => 0, ($countLabel[$event] ?? 'count') => 0];
    }
    $unit = $countLabel[$event] ?? 'count';
    $users[$email][$event]['actions'] += 1;
    $users[$email][$event][$unit]     += $count;

    if (!isset($totals[$event])) $totals[$event] = 0;
    $totals[$event] += 1;
    if ($count > 0) {
        $tk = $unit; // total leads/rows/etc.
        if (!isset($totals[$tk])) $totals[$tk] = 0;
        $totals[$tk] += $count;
    }
}
fclose($fh);

if ($raw) {
    echo json_encode(['date' => $date, 'lines' => $lines, 'entries' => $rawOut],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode([
    'date'   => $date,
    'lines'  => $lines,
    'users'  => $users ?: (object)[],
    'totals' => $totals ?: (object)[],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
