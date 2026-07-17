<?php
error_reporting(E_ALL);
ini_set('display_errors', '0');
require_once __DIR__ . '/lib/error_logger.php';

set_error_handler(function($errno, $errstr, $errfile, $errline) {
    if (!(error_reporting() & $errno)) return;
    $errorId = log_error('LEAD', "PHP Error [$errno]: $errstr in $errfile:$errline", [
        'action' => $_GET['action'] ?? '',
    ]);
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => 'server error', 'errorId' => $errorId]);
    exit;
});
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_COMPILE_ERROR], true)) {
        $errorId = log_error('LEAD', 'PHP Fatal: ' . $error['message'] . ' in ' . $error['file'] . ':' . $error['line'], [
            'action' => $_GET['action'] ?? '',
        ]);
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['error' => 'server fatal', 'errorId' => $errorId]);
    }
});

/**
 * city-scrape-proxy.php — Mode-2 (whole-city) job front door.
 *
 * Actions:
 *   POST ?action=create   { email, keyword, country, state, city, zips:[...] }
 *       → find-or-create the shared city_scrape_jobs row, enqueue the ZIPs
 *         (ON CONFLICT DO NOTHING so pre-scraped ZIPs are preserved/skipped),
 *         subscribe the user. Returns { jobId, zipsTotal }.
 *       ZIP expansion happens in the FRONTEND (it already bundles the
 *         `zipcodes` package / calls the India postal API), so the list is
 *         passed in — PHP has no zip dataset.
 *
 *   GET  ?action=status&jobId=...      → progress for the UI poll.
 *   POST ?action=cancel   { jobId, email }   → unsubscribe (shared job runs on).
 *
 * Billing is NOT done here. Users are charged via applyCreditSlice() when they
 * VIEW the leads (see §0a-REALITY of city_scrape_plan.md).
 */

require_once __DIR__ . '/lib/city_scrape.php';
require_once __DIR__ . '/lib/credits.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$action = $_GET['action'] ?? '';
$input  = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];

function cs_fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

if ($action === 'create') {
    $email   = strtolower(trim((string)($input['email'] ?? '')));
    $keyword = trim((string)($input['keyword'] ?? ''));
    $country = trim((string)($input['country'] ?? ''));
    $state   = trim((string)($input['state'] ?? ''));
    $city    = trim((string)($input['city'] ?? ''));
    $zips    = $input['zips'] ?? [];

    if ($email === '' || $keyword === '' || $city === '' || $state === '' || $country === '') {
        cs_fail(400, 'email, keyword, country, state, city are required');
    }
    if (!is_array($zips) || empty($zips)) {
        cs_fail(400, 'zips[] is required (frontend expands city→ZIPs)');
    }

    $job = cs_find_or_create_job($keyword, $city, $state, $country, $email);
    if (!$job) {
        $errorId = log_error('LEAD', 'cs_find_or_create_job returned null', [
            'user' => $email, 'action' => 'city-create',
            'context' => ['keyword' => $keyword, 'city' => $city],
        ]);
        cs_fail(500, 'could not create job'); // errorId already logged
    }

    // Enqueue ZIPs (idempotent — preserves any already-scraped rows).
    $total = cs_enqueue_zips($job['id'], $zips);

    // Scrape-until-target: the worker stops claiming ZIPs once the pool hits
    // target_leads (default 100), leaving the rest dormant — so a city search
    // doesn't drain the whole city's Apify quota. If this user is starting a
    // search and the pool may already be exhausted (a prior run stopped at the
    // old target), raise the target by one slice so the worker resumes for ~100
    // more. No-op when the job is fresh / still below target.
    $target = cs_bump_job_target($job['id'], 100);

    // Subscribe the user for progress.
    $cid = credits_get_or_create_customer_id($email);
    cs_add_subscriber($job['id'], $email, $cid);

    echo json_encode([
        'jobId'       => $job['id'],
        'zipsTotal'   => $total,
        'targetLeads' => $target,
        'status'      => $job['status'] ?? 'queued',
    ]);
    exit;
}

if ($action === 'status') {
    $jobId = trim((string)($_GET['jobId'] ?? ''));
    if ($jobId === '') cs_fail(400, 'jobId required');

    $job = cs_get_job($jobId);
    if (!$job) cs_fail(404, 'job not found');

    // Guard: if zips_total is 0 but the job is still active, recompute from
    // the ZIP rows. This prevents the frontend's termination condition from
    // firing immediately (0+0 >= 0 = true) when the sb_update in
    // cs_enqueue_zips failed silently or the job row was reused stale.
    $zipsTotal = (int)$job['zips_total'];
    if ($zipsTotal === 0 && $job['status'] !== 'completed') {
        cs_refresh_job_counters($job['id']);
        $job = cs_get_job($jobId);          // re-read after refresh
        $zipsTotal = (int)($job['zips_total'] ?? 0);
    }

    echo json_encode([
        'jobId'        => $job['id'],
        'status'       => $job['status'],
        'zipsTotal'    => $zipsTotal,
        'zipsDone'     => (int)$job['zips_done'],
        'zipsFailed'   => (int)$job['zips_failed'],
        'poolLeads'    => (int)$job['pool_leads'],
        'targetLeads'  => (int)($job['target_leads'] ?? 100),
        'lastScrapedAt'=> $job['last_scraped_at'],
        'city'         => $job['city'],
        'keyword'      => $job['keyword'],
        // ZIPs the worker has finished — the frontend pulls leads ONLY for these,
        // so the browser never races the worker with a live Apify run.
        'scrapedZips'  => cs_get_scraped_zips($job['id']),
    ]);
    exit;
}

if ($action === 'record-zip') {
    // Mode-1 reuse hook: a single-ZIP search just finished. Record the ZIP as
    // 'scraped' under its city+keyword job so a later whole-city run skips it.
    $email   = strtolower(trim((string)($input['email'] ?? '')));
    $keyword = trim((string)($input['keyword'] ?? ''));
    $country = trim((string)($input['country'] ?? ''));
    $state   = trim((string)($input['state'] ?? ''));
    $city    = trim((string)($input['city'] ?? ''));
    $zip     = trim((string)($input['zip'] ?? ''));
    $leads   = (int)($input['leadsCount'] ?? 0);

    if ($keyword === '' || $city === '' || $state === '' || $country === '' || $zip === '') {
        cs_fail(400, 'keyword, country, state, city, zip are required');
    }

    $ok = cs_record_single_zip_scraped($keyword, $city, $state, $country, $zip, $leads);
    echo json_encode(['ok' => (bool)$ok]);
    exit;
}

if ($action === 'cancel') {
    $jobId = trim((string)($input['jobId'] ?? ''));
    $email = strtolower(trim((string)($input['email'] ?? '')));
    if ($jobId === '' || $email === '') cs_fail(400, 'jobId and email required');

    cs_remove_subscriber($jobId, $email);
    echo json_encode(['ok' => true]);
    exit;
}

cs_fail(400, 'unknown action');
