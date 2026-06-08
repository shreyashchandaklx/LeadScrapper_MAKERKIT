<?php
error_reporting(E_ALL);
ini_set('display_errors', '0');
require_once __DIR__ . '/lib/error_logger.php';
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    if (!(error_reporting() & $errno)) return;
    $errorId = log_error('LEAD', "PHP Error [$errno]: $errstr in $errfile:$errline", [
        'action' => $_GET['action'] ?? 'run',
    ]);
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => "PHP Error [$errno]: $errstr in $errfile:$errline", 'errorId' => $errorId]);
    exit;
});
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error !== null && ($error['type'] === E_ERROR || $error['type'] === E_PARSE || $error['type'] === E_COMPILE_ERROR)) {
        $errorId = log_error('LEAD', "PHP Fatal Error: " . $error['message'] . " in " . $error['file'] . ":" . $error['line'], [
            'action' => $_GET['action'] ?? 'run',
        ]);
        header('Content-Type: application/json');
        http_response_code(500);
        echo json_encode(['error' => "PHP Fatal Error: " . $error['message'] . " in " . $error['file'] . ":" . $error['line'], 'errorId' => $errorId]);
    }
});
/**
 * apify-proxy.php
 * Proxies Apify API calls with automatic API key rotation.
 * When one key's quota is exhausted, it auto-switches to the next.
 *
 * FIXES APPLIED:
 * 1. Changed actor to `compass~crawler-google-places` (free/public actor)
 * 2. Key rotation now also triggers on 403 (platform-feature-disabled)
 * 3. Loop now reads up to APIFY_KEY_21 (was capped at 20)
 * 4. parse_ini_file now uses INI_SCANNER_RAW to handle Unicode comments safely
 * 5. Cleaner error messaging throughout
 * 6. Universal cache backed by Supabase (leadscrapper_cache table)
 */

require_once __DIR__ . '/lib/supabase_cache.php';
require_once __DIR__ . '/lib/credits.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$inputJSON = file_get_contents('php://input');
$input = json_decode($inputJSON, true);
$action = $_GET['action'] ?? 'run';

// ─── LOAD ENV ───────────────────────────────────────────────────────────────
// INI_SCANNER_RAW prevents issues with Unicode characters in comments (e.g. ─)
$envConfig = [];
if (file_exists(__DIR__ . '/.env')) {
    $lines = file(__DIR__ . '/.env', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (strpos(trim($line), '#') === 0 || strpos(trim($line), ';') === 0) continue;
        list($name, $value) = explode('=', $line, 2) + [NULL, NULL];
        if ($name !== NULL && $value !== NULL) {
            $name = trim($name);
            $value = trim($value);
            $value = preg_replace('/^["\'](.*)["\']$/', '$1', $value);
            $envConfig[$name] = $value;
        }
    }
}

// ─── BUILD TOKEN LIST ────────────────────────────────────────────────────────
$allTokens = [];

// Load APIFY_KEY_1 through APIFY_KEY_21 (FIX: was capped at 20)
for ($i = 1; $i <= 21; $i++) {
    $key = trim($envConfig["APIFY_KEY_$i"] ?? '');
    if ($key !== '') {
        $allTokens[] = $key;
    }
}

// Fallback: legacy single-key variables
if (empty($allTokens)) {
    foreach (['APIFY_PROXY_TOKEN', 'VITE_APIFY_TOKEN'] as $legacyKey) {
        $val = trim($envConfig[$legacyKey] ?? '');
        if ($val !== '') {
            $allTokens[] = $val;
            break;
        }
    }
}

if (empty($allTokens)) {
    $errorId = log_error('LEAD', 'No Apify API keys configured in .env', ['action' => $action]);
    http_response_code(500);
    echo json_encode(['error' => 'No Apify API keys configured in .env', 'errorId' => $errorId]);
    exit;
}

// ─── KEY STATE (persisted in Redis for cross-instance access) ──────────────────────
$stateFile = __DIR__ . '/.apify_key_state.json';
$state = [];

if (file_exists($stateFile)) {
    $raw = file_get_contents($stateFile);
    $state = json_decode($raw, true) ?: [];
}

$currentIndex = (int) ($state['currentIndex'] ?? 0);
if ($currentIndex >= count($allTokens)) {
    $currentIndex = 0;
}

// runKeyMap: maps runId → keyIndex so check/dataset use the same key that started the run
// Entries may be either an int (legacy: just keyIndex) or an array {keyIndex, cacheKey}
$runKeyMap = (array) ($state['runKeyMap'] ?? []);

// Prune entries older than 24 hours to prevent unbounded growth
$runKeyMapExpiry = (array) ($state['runKeyMapExpiry'] ?? []);
$now = time();
foreach ($runKeyMapExpiry as $rid => $ts) {
    if ($now - (int) $ts > 86400) {
        unset($runKeyMap[$rid], $runKeyMapExpiry[$rid]);
    }
}

// ─── SUPABASE CACHE (universal, shared across all users/instances) ────────────────
const CACHE_TTL_SECONDS = 30 * 86400; // 30 days
$supabaseCache = getSupabaseCache();

/**
 * Build cache key from keyword and location
 */
function buildCacheKey($keyword, $location)
{
    return strtolower(trim($keyword)) . '|' . strtolower(trim($location));
}

/**
 * Extract a normalized (keyword, location) pair from the incoming run-body.
 * Supports both locationQuery-based and postalCode-based searches.
 * Returns null if keyword is missing so the caller can skip caching.
 */
function extractQueryFromInput($input)
{
    if (!is_array($input)) return null;
    $keyword = '';
    if (isset($input['searchStringsArray']) && is_array($input['searchStringsArray']) && !empty($input['searchStringsArray'])) {
        $keyword = (string) $input['searchStringsArray'][0];
    }
    if (trim($keyword) === '') return null;

    // Check for postalCode-based search first
    $postalCode = trim((string) ($input['postalCode'] ?? ''));
    if ($postalCode !== '') {
        $countryCode = trim((string) ($input['countryCode'] ?? ''));
        $location = 'zip:' . $postalCode . ($countryCode !== '' ? '|' . $countryCode : '');
        return [trim($keyword), $location];
    }

    // Fallback to locationQuery
    $location = (string) ($input['locationQuery'] ?? '');
    if (trim($location) === '') return null;
    return [trim($keyword), trim($location)];
}

/**
 * Merge newly fetched places into the cache for a given query, deduped by placeId.
 * Places without a placeId fall back to a synthetic key so they aren't lost.
 */
// mergePlacesIntoCache is now handled by $supabaseCache->mergePlaces()

/**
 * Apply the credit-system slice to a place pool.
 *
 *   $allPlaces    — full pool for this cacheKey (after cache merge)
 *   $billing      — runKeyMap entry: { email, keyword, locationLabel, source }
 *                   or null when not provided (then no billing happens)
 *   $cacheKey     — the query's cache_key
 *   $cacheHelper  — SupabaseCache instance (unused here; reserved for future)
 *
 * Side effects:
 *   - reads user's already-delivered set
 *   - deducts credits via Makerkit for newly-delivered leads
 *   - records new placeIds into leadscrapper_delivered
 *   - logs the search to leadscrapper_searches
 *
 * Returns the array of places to send back to the browser.
 */
function applyCreditSlice($allPlaces, $billing, $cacheKey, $cacheHelper)
{
    if (!$billing || !isset($billing['email']) || $billing['email'] === '' || !$cacheKey) {
        // No billing context (legacy/server-internal call). Return everything.
        return [
            'places'          => $allPlaces,
            'charged'         => 0,
            'delivered'       => count($allPlaces),
            'extrasRemaining' => 0,
            'source'          => 'unknown'
        ];
    }

    $email         = (string) $billing['email'];
    $keyword       = (string) ($billing['keyword'] ?? '');
    $locationLabel = (string) ($billing['locationLabel'] ?? '');
    $source        = (string) ($billing['source'] ?? 'apify');

    // 1) Fetch user's prior deliveries + extras + current balance
    $poolPlaceIds = [];
    foreach ($allPlaces as $p) {
        $pid = $p['placeId'] ?? null;
        if ($pid) $poolPlaceIds[] = $pid;
    }
    $delivered = credits_get_delivered_ids($email, $poolPlaceIds);
    $extras    = credits_get_extras($email, $cacheKey);
    $balance   = credits_get_balance($email);
    if ($balance === null) {
        // Couldn't reach Makerkit — fall back to giving the user nothing new
        $balance = 0.0;
    }

    // 2) Compute slice
    $slice = credits_compute_slice($allPlaces, $delivered, $extras, $balance);
    $placesToDeliver = $slice['places'];
    $charge          = $slice['charged'];

    // 3) Charge credits for the new portion (atomic via Makerkit)
    $deductionFailed = false;
    $deductionError  = null;
    if ($charge > 0) {
        // deduct_leads takes lead count (1 lead = 1 credit).
        // $charge / CREDIT_PER_LEAD = number of leads
        $leadCount = (int) round($charge / CREDIT_PER_LEAD);
        $r = credits_deduct_leads($email, $leadCount);
        if (empty($r['ok'])) {
            // Deduction failed — abort delivery and DO NOT mutate the extras queue.
            // The user keeps their full slice intact for the next attempt.
            error_log('[applyCreditSlice] credits_deduct_leads failed for ' . $email
                . ' status=' . ($r['status'] ?? '?')
                . ' body=' . json_encode($r));
            $deductionErrorId = log_error('BILL', 'credits_deduct_leads failed: ' . ($r['error'] ?? $r['message'] ?? 'unknown'), [
                'user'    => $email,
                'action'  => 'applyCreditSlice',
                'context' => ['status' => $r['status'] ?? null, 'leadCount' => $leadCount],
            ]);
            $placesToDeliver = [];
            $charge          = 0.0;
            $deductionFailed = true;
            $deductionError  = $r['error'] ?? $r['message'] ?? 'credit_deduction_failed';
        } else {
            // 4) Record newly delivered place_ids
            $newIds = [];
            foreach ($placesToDeliver as $p) {
                $pid = (string) ($p['placeId'] ?? '');
                if ($pid !== '') $newIds[] = $pid;
            }
            credits_record_delivered($email, $cacheKey, $newIds);
        }
    }

    // 5) Manage Extras queue — ONLY if deduction succeeded (or nothing to charge).
    // If we couldn't charge the user, leaving the queue untouched ensures they
    // can re-run the search and still get the same leads (plus the same overflow).
    if (!$deductionFailed) {
        if (!empty($slice['extrasUsed'])) {
            credits_dequeue_extras($email, $cacheKey, $slice['extrasUsed']);
        }
        if (!empty($slice['newOverflow'])) {
            credits_enqueue_extras($email, $cacheKey, $slice['newOverflow']);
        }
    }

    // 6) Audit log (always, even if 0 delivered — helps debug)
    // Determine effective source by composition of the delivered slice:
    //   - all from extras queue  → 'extras'
    //   - all new from pool      → keep original (apify or cache)
    //   - mix of both            → 'mixed'
    $deliveredCount = count($placesToDeliver);
    $extrasCount    = count($slice['extrasUsed'] ?? []);
    $newFromPool    = $deliveredCount - $extrasCount;

    if ($deliveredCount === 0) {
        $effectiveSrc = $source; // nothing delivered, keep run source for audit
    } else if ($extrasCount > 0 && $newFromPool > 0) {
        $effectiveSrc = 'mixed';
    } else if ($extrasCount > 0 && $newFromPool === 0) {
        $effectiveSrc = 'extras';
    } else {
        $effectiveSrc = $source; // apify or cache — fresh-to-user leads only
    }
    
    credits_log_search(
        $email,
        $keyword,
        $locationLabel,
        $cacheKey,
        count($allPlaces),
        count($placesToDeliver),
        $charge,
        $effectiveSrc
    );

    $totalDelivered = count($delivered);
    if (!$deductionFailed) {
        $totalDelivered += count($placesToDeliver);
    }

    return [
        'places'          => $placesToDeliver,
        'charged'         => $charge,
        'delivered'       => count($placesToDeliver),
        'totalDelivered'  => $totalDelivered,
        'extrasRemaining' => $deductionFailed ? count($extras) : $slice['extrasRemaining'],
        'poolSize'        => $slice['poolSize'],
        'source'          => $effectiveSrc,
        'deductionFailed' => $deductionFailed,
        'deductionError'  => $deductionError,
        'errorId'         => $deductionErrorId ?? null,
    ];
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Persist the full key state (currentIndex + runKeyMap) to disk.
 */
function saveState($stateFile, $index, $runKeyMap, $runKeyMapExpiry)
{
    file_put_contents($stateFile, json_encode([
        'currentIndex' => $index,
        'runKeyMap' => $runKeyMap,
        'runKeyMapExpiry' => $runKeyMapExpiry,
    ]));
}

// Legacy alias kept so apifyRequest() still compiles
function saveKeyIndex($stateFile, $index)
{
    // Read existing state to preserve runKeyMap during error-based rotation
    $existing = json_decode(@file_get_contents($stateFile) ?: '{}', true) ?: [];
    $existing['currentIndex'] = $index;
    file_put_contents($stateFile, json_encode($existing));
}

/**
 * HTTP codes that indicate the current key should be rotated.
 * 402 = payment required / quota exceeded
 * 403 = platform-feature-disabled or forbidden (FIX: was missing)
 * 429 = rate limited
 */
function shouldRotate($httpCode)
{
    return in_array($httpCode, [402, 403, 429], true);
}

/**
 * Execute an Apify API request with automatic key rotation on quota errors.
 *
 * @param $method       'GET' or 'POST'
 * @param $urlTemplate  URL with {TOKEN} placeholder
 * @param $token        Starting token
 * @param $allTokens    Full token list
 * @param $currentIndex Current index (passed by reference for rotation)
 * @param $stateFile    Path to key-state persistence file
 * @param string|null $postData  JSON body for POST requests
 *
 * @return array{result, httpCode}
 */
function apifyRequest(
    $method,
    $urlTemplate,
    $token,
    $allTokens,
    &$currentIndex,
    $stateFile,
     $postData = null
) {
    $totalKeys = count($allTokens);
    $tried = 0;

    while ($tried < $totalKeys) {
        $finalUrl = str_replace('{TOKEN}', $token, $urlTemplate);

        $ch = curl_init($finalUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 120);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $postData ?? '{}');
            curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        }

        $result = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        // cURL-level failure (network error, timeout, etc.)
        if ($result === false) {
            return [
                'result' => json_encode(['error' => 'cURL error: ' . $curlErr]),
                'httpCode' => 500,
            ];
        }

        // FIX: Rotate on 402 (quota), 403 (feature disabled), and 429 (rate limit)
        if (shouldRotate($httpCode)) {
            $currentIndex = ($currentIndex + 1) % $totalKeys;
            $token = $allTokens[$currentIndex];
            saveKeyIndex($stateFile, $currentIndex);
            $tried++;
            continue;
        }

        // Success or unrecoverable error — return as-is
        return ['result' => $result, 'httpCode' => $httpCode];
    }

    // All keys exhausted
    $errorId = log_error('LEAD', 'All Apify API keys exhausted or blocked', [
        'action'  => $_GET['action'] ?? 'run',
        'context' => ['totalKeys' => $totalKeys],
    ]);
    return [
        'result' => json_encode([
            'error' => 'All Apify API keys exhausted or blocked',
            'message' => 'All ' . $totalKeys . ' configured keys returned quota/access errors.',
            'errorId' => $errorId,
        ]),
        'httpCode' => 503,
    ];
}

// ─── ROUTING ─────────────────────────────────────────────────────────────────

$token = $allTokens[$currentIndex];

// ── ACTION: run ──────────────────────────────────────────────────────────────
if ($action === 'run') {

    // ─── Credit pre-check ────────────────────────────────────────────────────
    // Required: requester must send `email` in the body. Without it we can't
    // bill anybody, so reject. Reads `email` (preferred) or `userEmail`.
    $rawEmail = (string) ($input['email'] ?? $input['userEmail'] ?? '');
    $userEmail = strtolower(trim($rawEmail));
    if ($userEmail === '') {
        http_response_code(401);
        echo json_encode(['error' => 'Missing email in request body. User must be logged in.']);
        exit;
    }

    $balance = credits_get_balance($userEmail);

    if ($balance === null) {
        $errorId = log_error('BILL', 'Could not verify credit balance with Makerkit', [
            'user' => $userEmail, 'action' => $action,
        ]);
        http_response_code(502);
        echo json_encode(['error' => 'Could not verify credit balance with Makerkit', 'errorId' => $errorId]);
        exit;
    }
    if ($balance < CREDIT_PER_LEAD) {
        http_response_code(402);
        echo json_encode([
            'error'    => 'Insufficient credits',
            'message'  => 'You need at least 1 credit to start a search. Top up at app.pixnom.com.',
            'balance'  => $balance,
            'required' => CREDIT_PER_LEAD,
        ]);
        exit;
    }

    // ─── Cache check: serve from cache when possible ─────────────────────────
    $query = extractQueryFromInput($input);
    $requested = (int) ($input['maxCrawledPlacesPerSearch'] ?? 0);
    $cacheKey = null;
    $keywordForLog = '';
    $locationLabel = '';
    if ($query !== null) {
        [$kw, $loc] = $query;
        $cacheKey = buildCacheKey($kw, $loc);
        $keywordForLog = $kw;
        // Human-readable label for the audit log
        $locationLabel = (strpos($loc, 'zip:') === 0)
            ? 'ZIP ' . substr($loc, 4)
            : $loc;

        $entry = $supabaseCache->getQuery($cacheKey);

        // Universal cache — once a cache_key has ANY entries, NEVER re-scrape.
        // TTL gate removed: cache is permanent. Apify is only called when the
        // cache has zero places for this cache_key.
        $hasCache = ($entry && isset($entry['places']) && !empty($entry['places']));

        if ($hasCache) {
            // Cache HIT — synthesize an Apify-shaped run response.
            // The runId encodes the cacheKey directly (stateless — no DB row).
            // Stash billing metadata in runKeyMap so ?action=dataset knows who/what to charge.
            $cachedRunId = SupabaseCache::makeCachedRunId($cacheKey);
            $runKeyMap[$cachedRunId] = [
                'keyIndex'      => -1,
                'cacheKey'      => $cacheKey,
                'email'         => $userEmail,
                'keyword'       => $keywordForLog,
                'locationLabel' => $locationLabel,
                'source'        => 'cache',
            ];
            $runKeyMapExpiry[$cachedRunId] = time();
            saveState($stateFile, $currentIndex, $runKeyMap, $runKeyMapExpiry);

            http_response_code(201);
            echo json_encode([
                'data' => [
                    'id' => $cachedRunId,
                    'defaultDatasetId' => $cachedRunId,
                    'status' => 'SUCCEEDED',
                    'statusMessage' => 'Served from cache',
                ],
                '_cached' => true,
                '_cachedCount' => ($entry && isset($entry['places'])) ? count($entry['places']) : 0,
                '_balance' => $balance,
            ]);
            exit;
        }
    }

    // ─── Cache miss: call Apify normally ─────────────────────────────────────
    $actorId = 'compass~crawler-google-places';
    $url = "https://api.apify.com/v2/acts/$actorId/runs?token={TOKEN}";

    // Remember which key index is being used for THIS run
    $runStartKeyIndex = $currentIndex;

    // Strip leadscrapper-only fields before forwarding to Apify
    $apifyInput = $input;
    unset($apifyInput['email'], $apifyInput['userEmail']);
    $apifyInputJson = json_encode($apifyInput);

    $resp = apifyRequest('POST', $url, $token, $allTokens, $currentIndex, $stateFile, $apifyInputJson);

    // If run started successfully, map the runId to the key that started it
    // and advance to the next key for the NEXT query (per-query rotation)
    if ($resp['httpCode'] >= 200 && $resp['httpCode'] < 300) {
        $runData = json_decode($resp['result'], true);
        $runId = $runData['data']['id'] ?? null;

        if ($runId) {
            // Store keyIndex + cacheKey + billing metadata so dataset fetch can
            // (1) merge results back into cache and (2) charge the right user.
            $runKeyMap[$runId] = [
                'keyIndex'      => $currentIndex,
                'cacheKey'      => $cacheKey,
                'email'         => $userEmail,
                'keyword'       => $keywordForLog,
                'locationLabel' => $locationLabel,
                'source'        => 'apify',
            ];
            $runKeyMapExpiry[$runId] = time();
        }

        // Advance to next key so the next query gets a fresh-budget key
        $currentIndex = ($currentIndex + 1) % count($allTokens);
        $token = $allTokens[$currentIndex];
        saveState($stateFile, $currentIndex, $runKeyMap, $runKeyMapExpiry);
    }

    http_response_code($resp['httpCode']);
    echo $resp['result'];

    // ── ACTION: check ─────────────────────────────────────────────────────────────
} elseif ($action === 'check') {

    $runId = trim($_GET['runId'] ?? '');
    if ($runId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Missing runId parameter']);
        exit;
    }

    // Cached runId — return SUCCEEDED immediately without hitting Apify
    if (strpos($runId, 'cached-') === 0) {
        http_response_code(200);
        echo json_encode([
            'data' => [
                'id' => $runId,
                'defaultDatasetId' => $runId,
                'status' => 'SUCCEEDED',
                'statusMessage' => 'Served from cache',
            ],
        ]);
        exit;
    }

    // Use the same key that started this run (if known)
    if (isset($runKeyMap[$runId])) {
        $entry = $runKeyMap[$runId];
        $mappedIndex = is_array($entry) ? (int) ($entry['keyIndex'] ?? -1) : (int) $entry;
        if ($mappedIndex >= 0 && $mappedIndex < count($allTokens)) {
            $token = $allTokens[$mappedIndex];
        }
    }

    $url = "https://api.apify.com/v2/actor-runs/$runId?token={TOKEN}";
    $resp = apifyRequest('GET', $url, $token, $allTokens, $currentIndex, $stateFile);
    http_response_code($resp['httpCode']);
    echo $resp['result'];

    // ── ACTION: dataset ───────────────────────────────────────────────────────────
} elseif ($action === 'dataset') {

    $datasetId = trim($_GET['datasetId'] ?? '');
    $runId = trim($_GET['runId'] ?? '');
    if ($datasetId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Missing datasetId parameter']);
        exit;
    }

    $limit = (int) ($_GET['limit'] ?? 2000);
    $offset = (int) ($_GET['offset'] ?? 0);
    $limit = min($limit, 5000);
    $offset = max($offset, 0);

    // ─── Serve cached dataset ────────────────────────────────────────────────
    if (strpos($datasetId, 'cached-') === 0) {
        $pending  = $supabaseCache->getPendingServe($datasetId);
        $cacheKey = $pending['cacheKey'] ?? null;
        $places   = [];

        if ($cacheKey) {
            $entry  = $supabaseCache->getQuery($cacheKey);
            $places = ($entry && isset($entry['places'])) ? $entry['places'] : [];
        }

        // Credit-slice for the user that initiated this cached serve
        $billing = $runKeyMap[$runId] ?? $runKeyMap[$datasetId] ?? null;
        $sliced = applyCreditSlice($places, $billing, $cacheKey, $supabaseCache);

        // Clean up the pendingServe — dataset fetched, query is done
        $supabaseCache->deletePendingServe($datasetId);
        if (isset($runKeyMap[$runId]))      unset($runKeyMap[$runId], $runKeyMapExpiry[$runId]);
        if (isset($runKeyMap[$datasetId]))  unset($runKeyMap[$datasetId], $runKeyMapExpiry[$datasetId]);
        saveState($stateFile, $currentIndex, $runKeyMap, $runKeyMapExpiry);

        // Honor the caller's offset/limit on the post-credit list
        $page = array_slice($sliced['places'], $offset, $limit);
        $sliced['places'] = $page;
        http_response_code(200);
        echo json_encode($sliced);
        exit;
    }

    // ─── Live Apify dataset fetch ────────────────────────────────────────────
    $cacheKeyForMerge = null;
    $billing          = null;

    // Use the same key that started this run (if runId provided)
    if ($runId !== '' && isset($runKeyMap[$runId])) {
        $entry = $runKeyMap[$runId];
        if (is_array($entry)) {
            $mappedIndex      = (int) ($entry['keyIndex'] ?? -1);
            $cacheKeyForMerge = $entry['cacheKey'] ?? null;
            $billing          = $entry;
        } else {
            $mappedIndex = (int) $entry;
        }
        if ($mappedIndex >= 0 && $mappedIndex < count($allTokens)) {
            $token = $allTokens[$mappedIndex];
        }
    }

    // Always fetch the FULL Apify dataset (offset 0, large limit) so we can
    // merge into the shared cache and apply credit slicing against the full
    // pool. The original $limit/$offset are reapplied to the final result.
    $fetchLimit = 5000;
    $url = "https://api.apify.com/v2/datasets/$datasetId/items"
        . "?format=json&limit=$fetchLimit&offset=0&token={TOKEN}";

    $resp = apifyRequest('GET', $url, $token, $allTokens, $currentIndex, $stateFile);

    // On success, merge fresh places into the global cache so future identical
    // queries can be served for free.
    if (
        $cacheKeyForMerge
        && $resp['httpCode'] >= 200 && $resp['httpCode'] < 300
    ) {
        $decoded = json_decode($resp['result'], true);
        $fresh = [];
        if (is_array($decoded)) {
            // Apify returns a plain JSON array with format=json; some wrapped responses use {items:[...]}.
            $fresh = (array_keys($decoded) === range(0, count($decoded) - 1))
                ? $decoded
                : (is_array($decoded['items'] ?? null) ? $decoded['items'] : []);
        }
        if (!empty($fresh)) {
            $supabaseCache->mergePlaces($cacheKeyForMerge, $fresh);
        }

        // Credit-slice against the FULL pool (merged cache).
        $entry = $supabaseCache->getQuery($cacheKeyForMerge);
        $pool = ($entry && isset($entry['places'])) ? $entry['places'] : $fresh;

        $sliced = applyCreditSlice($pool, $billing, $cacheKeyForMerge, $supabaseCache);

        // Clean up runKeyMap now that we've billed
        if (isset($runKeyMap[$runId])) unset($runKeyMap[$runId], $runKeyMapExpiry[$runId]);
        saveState($stateFile, $currentIndex, $runKeyMap, $runKeyMapExpiry);

        $page = array_slice($sliced['places'], $offset, $limit);
        $sliced['places'] = $page;
        http_response_code(200);
        echo json_encode($sliced);
        exit;
    }

    // Non-success: pass through Apify's response unchanged
    if (isset($runKeyMap[$runId])) {
        unset($runKeyMap[$runId], $runKeyMapExpiry[$runId]);
        saveState($stateFile, $currentIndex, $runKeyMap, $runKeyMapExpiry);
    }
    http_response_code($resp['httpCode']);
    echo $resp['result'];

    // ── ACTION: balance ───────────────────────────────────────────────────────────
} elseif ($action === 'balance') {

    $email = strtolower(trim($_GET['email'] ?? ''));
    if ($email === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Missing email query param']);
        exit;
    }
    $bal = credits_get_balance($email);
    if ($bal === null) {
        $errorId = log_error('BILL', 'Could not reach credit service', [
            'user' => $email, 'action' => $action,
        ]);
        http_response_code(502);
        echo json_encode(['error' => 'Could not reach credit service', 'errorId' => $errorId]);
        exit;
    }
    echo json_encode([
        'email'         => $email,
        'balance'       => $bal,
        'creditPerLead' => CREDIT_PER_LEAD,
        'leadsPerCredit'=> LEADS_PER_CREDIT,
    ]);

    // ── ACTION: status (bonus — returns which key slot is active) ─────────────────
} elseif ($action === 'status') {

    echo json_encode([
        'totalKeys' => count($allTokens),
        'currentIndex' => $currentIndex,
        'activeKey' => substr($token, 0, 12) . '...', // Masked for safety
        'activeRuns' => count($runKeyMap),
    ]);

    // ── ACTION: cache (inspect / clear the query cache) ───────────────────────────
} elseif ($action === 'cache') {

    $sub = $_GET['op'] ?? 'stats';

    if ($sub === 'clear') {
        $supabaseCache->clear();
        echo json_encode(['cleared' => true]);
    } else {
        $stats = $supabaseCache->getStats();
        echo json_encode([
            'ttlSeconds' => CACHE_TTL_SECONDS,
            'totalQueries' => $stats['totalQueries'],
            'totalPendingServes' => $stats['totalPendingServes'],
            'queries' => $stats['queries'],
        ]);
    }

    // ── UNKNOWN ACTION ────────────────────────────────────────────────────────────
} else {

    http_response_code(400);
    echo json_encode([
        'error' => 'Invalid action',
        'validActions' => ['run', 'check', 'dataset', 'status', 'cache', 'balance'],
    ]);
}
?>
