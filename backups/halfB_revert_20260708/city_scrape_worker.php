<?php
/**
 * city_scrape_worker.php — background ZIP scraper for whole-city jobs (CLI only).
 *
 * Run by cron every minute (single instance via flock):
 *   * * * * * /usr/bin/php /var/www/leadscrapper.pixnom.com/city_scrape_worker.php >> .../logs/worker.log 2>&1
 *
 * WHAT IT DOES (per §0a-REALITY of city_scrape_plan.md):
 *   - Reaps stuck ZIPs (crashed-worker recovery).
 *   - Claims queued ZIPs one at a time (atomic, FOR UPDATE SKIP LOCKED).
 *   - Scrapes each ZIP via the existing Apify actor + cache merge.
 *   - SCRAPES ONLY — never touches credits or per-user rows. Leads land in the
 *     shared pool (leadscrapper_leads_data) under the per-ZIP cacheKey. Users
 *     are billed via applyCreditSlice() when they VIEW the leads.
 *   - Quota-aware key selection; on 402/403/429 the key is cooled down and the
 *     ZIP is returned to 'queued' (not failed).
 *
 * Exits after a time budget (default ~50s) or when there's no work; cron relaunches.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

error_reporting(E_ALL);
ini_set('display_errors', '1');
set_time_limit(0);   // long drain run (CSW_TIME_BUDGET); CLI is usually unlimited anyway

require_once __DIR__ . '/lib/error_logger.php';
require_once __DIR__ . '/lib/supabase_cache.php';
require_once __DIR__ . '/lib/city_scrape.php';
require_once __DIR__ . '/lib/credits.php';   // BYOK: credits_get_apify_token()

// ─── Config ───────────────────────────────────────────────────────────────
// CSW_TIME_BUDGET governs how long ONE worker run drains ZIPs back-to-back.
// A single ZIP takes ~90s (Apify scrape), so a small budget = 1 ZIP/run, and
// the user waits a full cron minute between leads (looks frozen). A large budget
// lets the worker loop through many ZIPs continuously in one run — leads appear
// every ~90s instead of every ~2min. It STILL stops at target: claim_next_zip
// returns nothing once pool ≥ target_leads, so the loop ends and we exit. The
// flock means the every-minute cron ticks during a long run just no-op (harmless).
const CSW_TIME_BUDGET   = 600;    // ~10 min: drains ~6 ZIPs/run, stops early at target
const CSW_POLL_INTERVAL = 5;      // seconds between Apify status polls
const CSW_MAX_POLL      = 180;    // 180 * 5s = 15 min max per ZIP
const CSW_MAX_ATTEMPTS  = 3;      // give up on a ZIP after this many tries
const CSW_RESULTS_PER_ZIP = 9999; // maxCrawledPlacesPerSearch for a ZIP

$workerId = gethostname() . '-' . getmypid();
$startedAt = time();

function csw_log($msg) {
    fwrite(STDOUT, '[' . gmdate('Y-m-d H:i:s') . "Z] $msg\n");
}

// ─── Single-instance lock ───────────────────────────────────────────────────
$lockFile = __DIR__ . '/.city_scrape_worker.lock';
$lockFp = fopen($lockFile, 'c');
if (!$lockFp || !flock($lockFp, LOCK_EX | LOCK_NB)) {
    csw_log('another worker holds the lock — exiting');
    exit(0);
}

// ─── Nightly key reset flag (cron may call with --reset-keys) ────────────────
if (in_array('--reset-keys', $argv ?? [], true)) {
    // pick_apify_key() auto-resets per-day; calling it once forces the reset pass.
    cs_pick_apify_key();
    csw_log('apify key daily reset triggered');
    flock($lockFp, LOCK_UN);
    exit(0);
}

// ─── Load env (.env) for Apify tokens ────────────────────────────────────────
$envConfig = [];
if (file_exists(__DIR__ . '/.env')) {
    foreach (file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $t = trim($line);
        if ($t === '' || $t[0] === '#' || $t[0] === ';') continue;
        if (strpos($t, '=') === false) continue;
        [$k, $v] = explode('=', $t, 2);
        $envConfig[trim($k)] = preg_replace('/^["\'](.*)["\']$/', '$1', trim($v));
    }
}

// BYOK: house keys are no longer used. The worker resolves each job owner's
// own Apify token from user_credits.ApifyToken. The env/APIFY_KEY_n loading
// and apify_keys table are legacy — kept for backward compatibility only.
// If no house keys exist, the worker still runs (BYOK doesn't need them).
$tokensByRef = [];
for ($i = 1; $i <= 21; $i++) {
    $ref = "APIFY_KEY_$i";
    $tok = trim($envConfig[$ref] ?? '');
    if ($tok !== '') $tokensByRef[$ref] = $tok;
}
if (!empty($tokensByRef)) {
    csw_seed_apify_keys(array_keys($tokensByRef));
}

$supabaseCache = getSupabaseCache();

// ─── Reap stuck ZIPs first ───────────────────────────────────────────────────
$reaped = cs_reap_stuck_zips(10);
if ($reaped > 0) csw_log("reaped $reaped stuck ZIP(s)");

// ─── Main loop ───────────────────────────────────────────────────────────────
$processed = 0;
while ((time() - $startedAt) < CSW_TIME_BUDGET) {
    $zip = cs_claim_next_zip($workerId);
    if (!$zip) {
        csw_log('no queued ZIPs — done');
        break;
    }

    $zipId  = (int)$zip['id'];
    $jobId  = $zip['job_id'];
    $zipStr = (string)$zip['zip'];

    // Load the parent job for keyword/country + BYOK owner.
    $job = cs_get_job($jobId);
    if (!$job) {
        cs_finish_zip($zipId, 'failed', 0, null, 'parent job missing');
        continue;
    }
    $keyword = (string)$job['keyword'];
    $country = (string)$job['country_code'];

    // BYOK: resolve the job owner's Apify token. If they haven't saved one,
    // pause the job (don't silently fall back to house keys).
    $ownerEmail = strtolower(trim((string)($job['owner_email'] ?? '')));
    if ($ownerEmail === '') {
        // Legacy job created before owner_email column — pause it.
        sb_update('city_scrape_jobs', 'id=eq.' . rawurlencode($jobId),
            ['status' => 'paused', 'updated_at' => gmdate('c')]);
        cs_finish_zip($zipId, 'queued');
        csw_log("zip=$zipStr job=$jobId has no owner_email — paused");
        break;
    }
    $ownerToken = credits_get_apify_token($ownerEmail);
    if ($ownerToken === '') {
        // Owner hasn't saved an Apify key yet — pause, don't burn house keys.
        sb_update('city_scrape_jobs', 'id=eq.' . rawurlencode($jobId),
            ['status' => 'paused', 'updated_at' => gmdate('c')]);
        cs_finish_zip($zipId, 'queued');
        csw_log("zip=$zipStr owner=$ownerEmail has no Apify key — job paused");
        break;
    }

    csw_log("scraping job=$jobId zip=$zipStr keyword=$keyword owner=$ownerEmail");

    $result = csw_scrape_zip($keyword, $zipStr, $country, $ownerToken, $supabaseCache, $zipId, $workerId);

    if ($result['outcome'] === 'requeue') {
        // Quota exhausted / all keys cooled — release ZIP, stop this run.
        cs_finish_zip($zipId, 'queued');
        csw_log("zip=$zipStr requeued ({$result['reason']}) — exiting run");
        break;
    } elseif ($result['outcome'] === 'scraped') {
        cs_finish_zip($zipId, 'scraped', $result['leads'], $result['runId']);
        csw_log("zip=$zipStr scraped leads={$result['leads']}");
    } else { // failed
        $attempts = (int)$zip['attempts'];
        if ($attempts >= CSW_MAX_ATTEMPTS) {
            cs_finish_zip($zipId, 'failed', 0, $result['runId'], $result['reason']);
            csw_log("zip=$zipStr FAILED permanently after $attempts attempts: {$result['reason']}");
        } else {
            cs_finish_zip($zipId, 'queued');  // retry later
            csw_log("zip=$zipStr failed (attempt $attempts), requeued: {$result['reason']}");
        }
    }

    $processed++;
}

csw_log("worker finished — processed $processed ZIP(s)");
flock($lockFp, LOCK_UN);
exit(0);


/* ============================================================
 * Helpers
 * ============================================================ */

/**
 * Seed apify_keys with the env key refs (idempotent). The DB tracks state only.
 */
function csw_seed_apify_keys($refs)
{
    $rows = [];
    foreach ($refs as $ref) {
        $rows[] = ['key_ref' => $ref, 'last_reset' => gmdate('Y-m-d')];
    }
    sb_insert('apify_keys', $rows, 'key_ref'); // ON CONFLICT DO NOTHING via upsert
}

/**
 * Scrape ONE ZIP through Apify and merge results into the shared cache.
 * Does NOT bill anyone. Returns:
 *   ['outcome' => 'scraped', 'leads' => int, 'runId' => string]
 *   ['outcome' => 'requeue', 'reason' => string]   (quota / no key)
 *   ['outcome' => 'failed',  'reason' => string, 'runId' => ?string]
 */
function csw_scrape_zip($keyword, $zip, $country, $token, $cache, $zipId, $workerId)
{
    // BYOK: token is the job owner's single Apify key (resolved by caller).
    // No house-key rotation — if this key is exhausted, the job pauses.

    $cacheKey = cs_zip_cache_key($keyword, $zip, $country);

    // Already cached for this ZIP? Then it's effectively scraped — merge nothing.
    $existing = $cache->getQuery($cacheKey);
    if ($existing && !empty($existing['places'])) {
        return ['outcome' => 'scraped', 'leads' => count($existing['places']), 'runId' => null];
    }

    // Build the Apify actor input (same shape as a single-ZIP frontend search).
    $input = [
        'searchStringsArray'        => [$keyword],
        'postalCode'                => $zip,
        'countryCode'               => strtolower($country),
        'maxCrawledPlacesPerSearch' => CSW_RESULTS_PER_ZIP,
        'language'                  => 'en',
    ];

    $actorId = 'compass~crawler-google-places';

    // 1) Start the run.
    $startUrl = "https://api.apify.com/v2/acts/$actorId/runs?token=" . urlencode($token);
    $start = csw_http('POST', $startUrl, json_encode($input));
    if ($start['code'] === 402 || $start['code'] === 403 || $start['code'] === 429) {
        // BYOK: owner's key is exhausted/rate-limited. Requeue and let cron retry.
        return ['outcome' => 'requeue', 'reason' => "owner key quota/start http {$start['code']}"];
    }
    if ($start['code'] < 200 || $start['code'] >= 300) {
        return ['outcome' => 'failed', 'reason' => "start http {$start['code']}", 'runId' => null];
    }
    $runData = json_decode($start['body'], true);
    $runId = $runData['data']['id'] ?? null;
    $datasetId = $runData['data']['defaultDatasetId'] ?? null;
    if (!$runId || !$datasetId) {
        return ['outcome' => 'failed', 'reason' => 'no runId/datasetId from start', 'runId' => null];
    }

    // 2) Poll until terminal state.
    $statusUrl = "https://api.apify.com/v2/actor-runs/$runId?token=" . urlencode($token);
    $polls = 0;
    $finalStatus = '';
    while ($polls < CSW_MAX_POLL) {
        sleep(CSW_POLL_INTERVAL);
        cs_heartbeat_zip($zipId, $workerId);   // keep reaper away
        $polls++;
        $st = csw_http('GET', $statusUrl);
        if ($st['code'] === 429) { continue; }
        if ($st['code'] < 200 || $st['code'] >= 300) continue;
        $sd = json_decode($st['body'], true);
        $finalStatus = $sd['data']['status'] ?? '';
        if (in_array($finalStatus, ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'], true)) break;
    }
    if ($finalStatus !== 'SUCCEEDED') {
        return ['outcome' => 'failed', 'reason' => "run ended status=$finalStatus", 'runId' => $runId];
    }

    // 3) Fetch the full dataset.
    $dsUrl = "https://api.apify.com/v2/datasets/$datasetId/items?format=json&limit=5000&offset=0&token=" . urlencode($token);
    $ds = csw_http('GET', $dsUrl);
    if ($ds['code'] < 200 || $ds['code'] >= 300) {
        return ['outcome' => 'failed', 'reason' => "dataset http {$ds['code']}", 'runId' => $runId];
    }
    $decoded = json_decode($ds['body'], true);
    $fresh = [];
    if (is_array($decoded)) {
        $fresh = (array_keys($decoded) === range(0, count($decoded) - 1))
            ? $decoded
            : (is_array($decoded['items'] ?? null) ? $decoded['items'] : []);
    }

    // 4) Merge into the shared cache (NO billing — that's done on view).
    if (!empty($fresh)) {
        $cache->mergePlaces($cacheKey, $fresh);
    }

    return ['outcome' => 'scraped', 'leads' => count($fresh), 'runId' => $runId];
}

/**
 * Minimal curl helper. Returns ['code' => int, 'body' => string].
 */
function csw_http($method, $url, $body = null)
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Accept: application/json'],
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($resp === false) return ['code' => 0, 'body' => 'curl error: ' . $err];
    return ['code' => $code, 'body' => $resp];
}
