<?php

/**
 * lib/credits.php
 *
 * Server-side helpers for the leadscrapper credit system. Two responsibilities:
 *
 *   (A) Talk to Makerkit (app.pixnom.com) for the *authoritative* credit
 *       balance + deduction. Reuses leadscrapper-credits-proxy.php's
 *       upstream so we have a single place that hits Makerkit.
 *
 *   (B) Manage the two LOCAL audit tables in this project's Supabase:
 *         - leadscrapper_delivered  (per-user "what they already got" ledger)
 *         - leadscrapper_searches   (one row per search)
 *         - leadscrapper_extras     (FIFO queue of leads not yet delivered)
 *       These are independent of user_credits — they never touch the balance.
 *
 * Pricing: 1 credit = 1 lead
 */

require_once __DIR__ . '/supabase.php';

const LEADS_PER_CREDIT  = 1;
const CREDIT_PER_LEAD   = 1;

// ---------------------------------------------------------------------------
// Env loader (kept independent of apify-proxy.php's loader so this file is
// usable standalone).
// ---------------------------------------------------------------------------
function credits_env()
{
    static $env = null;
    if ($env !== null) return $env;
    $env = [];
    $envPath = __DIR__ . '/.env';
    if (!file_exists($envPath)) return $env;

    $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || $line[0] === ';') continue;
        if (strpos($line, '=') === false) continue;
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v);
        $v = preg_replace('/^["\'](.*)["\']$/', '$1', $v);
        $env[$k] = $v;
    }
    return $env;
}

function credits_makerkit_origin()
{
    $env = credits_env();
    return rtrim(
        $env['MAKERKIT_ORIGIN']
            ?? $env['MAP2WEB_ORIGIN']
            ?? 'https://app.pixnom.com',
        '/'
    );
}

/**
 * Low-level: call Makerkit credit endpoint. Returns ['status'=>int, 'json'=>array|null].
 */
function credits_call_makerkit($method, $path, $body = null)
{
    $base  = credits_makerkit_origin();
    $url   = $base . $path;

    $headers = [
        'Content-Type: application/json',
        'Accept: application/json',
    ];

    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_CUSTOMREQUEST  => $method,
    ];
    if ($body !== null) {
        $opts[CURLOPT_POSTFIELDS] = json_encode($body);
    }
    curl_setopt_array($ch, $opts);

    $raw  = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false) {
        return ['status' => 502, 'json' => null];
    }
    return ['status' => $code, 'json' => json_decode($raw, true)];
}

// ---------------------------------------------------------------------------
// (A) Makerkit-facing balance + deduct
// ---------------------------------------------------------------------------

/**
 * Returns the user's current credit balance as a float, or null on error.
 */
function credits_get_balance($email)
{
    if ($email === '') return null;
    $r = credits_call_makerkit(
        'GET',
        '/api/supabase/credits/get?email=' . rawurlencode($email)
    );
    if ($r['status'] !== 200 || !is_array($r['json'])) return null;
    if (!isset($r['json']['credits'])) return null;
    return (float) $r['json']['credits'];
}

/**
 * BYOK: return the user's own Apify API token from Supabase user_credits.
 * This is the SAME column shared with Map2Web — a user who saved their key in
 * Map2Web is already BYOK-ready here. Returns '' if none saved / lookup fails.
 */
function credits_get_apify_token($email)
{
    $email = strtolower(trim((string) $email));
    if ($email === '') return '';
    $r = sb_select(
        'user_credits',
        'select=ApifyToken&Email=eq.' . rawurlencode($email) . '&limit=1'
    );
    if ($r['status'] === 200 && !empty($r['json'][0]['ApifyToken'])) {
        return trim((string) $r['json'][0]['ApifyToken']);
    }
    return '';
}

/**
 * Deduct leadCount * 1 credit from the user. Returns the Makerkit
 * response with extra ['ok'] convenience flag.
 *
 * On 402 (insufficient) ok=false and the caller MUST refund/not-deliver the
 * leads it would have given.
 */
function credits_deduct_leads($email, $leadCount)
{
    // *** NOTE: This function is being deprecated. Use the new superset logic below. ***

    $r = credits_call_makerkit(
        'POST',
        '/api/supabase/credits/deduct-leads',
        ['email' => $email, 'leadCount' => $leadCount]
    );
    $json = is_array($r['json']) ? $r['json'] : [];
    $json['ok']     = ($r['status'] >= 200 && $r['status'] < 300 && !empty($json['success']));
    $json['status'] = $r['status'];
    return $json;
}

// ---------------------------------------------------------------------------
// (B) Customer ID resolution
// ---------------------------------------------------------------------------
//
// Storage model (post migration 003):
//   leadscrapper_leads_data    — scraped master pool (UserEmail='__cache__' only)
//   user_leadscrapper_leads    — per-user state (delivered/queued/search/saved)
//   user_credits               — credit wallet + CustomerID column
//
// CustomerID convention:
//   1 → shreyashchandak.lx@gmail.com (dev)
//   2 → shriganeshkolhe@gmail.com    (dev)
//   1001+ → real users, allocated from customer_id_seq

/**
 * Returns the CustomerID for $email. Creates one (1001+) if not already
 * registered. In-process cached so repeat calls in the same request are free.
 *
 * Returns int CustomerID, or null if the email is empty / lookup failed.
 */
function credits_get_or_create_customer_id($email)
{
    static $cache = [];

    $email = strtolower(trim((string) $email));
    if ($email === '') return null;
    if (isset($cache[$email])) return $cache[$email];

    // Try to find an existing row in user_credits first.
    $r = sb_select(
        'user_credits',
        'select=CustomerID&Email=eq.' . rawurlencode($email) . '&limit=1'
    );
    if ($r['status'] === 200 && !empty($r['json'][0]['CustomerID'])) {
        return $cache[$email] = (int) $r['json'][0]['CustomerID'];
    }

    // Not found — insert (Postgres assigns from customer_id_seq via RPC).
    // PostgREST doesn't run our sequence directly, so we call a small RPC.
    // Fallback: try insert; on duplicate-email race, re-select.
    $rpc = sb_request('POST', 'rpc/assign_customer_id', [
        'p_email' => $email,
    ], ['Prefer: return=representation']);
    if ($rpc['status'] >= 200 && $rpc['status'] < 300) {
        $cid = is_array($rpc['json']) && isset($rpc['json'][0])
            ? (int) $rpc['json'][0]
            : (int) $rpc['json'];
        if ($cid > 0) return $cache[$email] = $cid;
    }

    // RPC missing — log and bail (caller should treat as a soft error).
    error_log('[credits_get_or_create_customer_id] assign_customer_id RPC failed for ' . $email
        . ' status=' . ($rpc['status'] ?? '?') . ' raw=' . ($rpc['raw'] ?? ''));
    return null;
}

// ---------------------------------------------------------------------------
// (C) Per-user state on user_leadscrapper_leads
// ---------------------------------------------------------------------------

/**
 * Returns array of place_ids this user has already received for cacheKey.
 */
function credits_get_delivered_ids($email, $target)
{
    if (empty($email) || empty($target)) return [];
    $cid = credits_get_or_create_customer_id($email);
    if (!$cid) return [];

    $ids = [];
    if (is_array($target)) {
        $cleanPids = [];
        foreach ($target as $pid) {
            if ($pid === '' || $pid === null) continue;
            $cleanPids[] = (string) $pid;
        }
        if (empty($cleanPids)) return [];

        foreach (array_chunk($cleanPids, 200) as $chunk) {
            $idList = implode(',', array_map('rawurlencode', $chunk));
            $query = 'select=PlaceId'
                . '&CustomerID=eq.' . urlencode((string)$cid)
                . '&Status=eq.delivered'
                . '&PlaceId=in.(' . $idList . ')';
            $r = sb_select('user_leadscrapper_leads', $query);
            if ($r['status'] === 200 && is_array($r['json'])) {
                foreach ($r['json'] as $row) {
                    if (isset($row['PlaceId']) && $row['PlaceId'] !== '') {
                        $ids[] = (string) $row['PlaceId'];
                    }
                }
            }
        }
    } else {
        $query = 'select=PlaceId'
            . '&UserEmail=eq.' . rawurlencode(strtolower(trim($email)))
            . '&Status=eq.delivered'
            . '&SearchString=eq.' . rawurlencode($target)
            . '&limit=100000';
        $r = sb_select('user_leadscrapper_leads', $query);
        if ($r['status'] === 200 && is_array($r['json'])) {
            foreach ($r['json'] as $row) {
                if (isset($row['PlaceId']) && $row['PlaceId'] !== '') {
                    $ids[] = (string) $row['PlaceId'];
                }
            }
        }
    }
    return array_values(array_unique($ids));
}

/**
 * Record place_ids as delivered to this user for cacheKey. Idempotent (upserts).
 *
 * If the place was previously queued, we UPDATE the row's Status to 'delivered'
 * rather than insert a duplicate. The PK (CustomerID, PlaceId, SearchString,
 * Status) would otherwise allow both 'queued' and 'delivered' rows for the
 * same lead — credits_dequeue_extras takes care of removing the queued row
 * before this is called.
 */
function credits_record_delivered($email, $cacheKey, $placeIds)
{
    if (empty($placeIds) || empty($email)) return;

    $cid = credits_get_or_create_customer_id($email);
    if ($cid === null) {
        error_log('[credits_record_delivered] no CustomerID for ' . $email);
        return;
    }

    $emailNorm = strtolower(trim($email));
    $now = gmdate('c');

    // First, delete ALL existing rows for these PlaceIds (regardless of
    // SearchString or Status) so we never have duplicates.  The upsert PK
    // includes SearchString, but the same lead can arrive via different
    // search strings — we only want ONE row per (CustomerID, PlaceId).
    $cleanPids = [];
    foreach ($placeIds as $pid) {
        if ($pid === '' || $pid === null) continue;
        $cleanPids[] = (string) $pid;
    }
    if (empty($cleanPids)) return;

    foreach (array_chunk($cleanPids, 50) as $chunk) {
        $idList = implode(',', array_map('rawurlencode', $chunk));
        $qDel = 'CustomerID=eq.' . urlencode((string)$cid)
              . '&PlaceId=in.(' . $idList . ')'
              . '&Status=in.(delivered,saved,queued)';
        sb_delete('user_leadscrapper_leads', $qDel);
    }

    // Now insert the canonical delivered rows
    $rows = [];
    foreach ($cleanPids as $pid) {
        $rows[] = [
            'CustomerID'   => $cid,
            'UserEmail'    => $emailNorm,
            'PlaceId'      => $pid,
            'SearchString' => $cacheKey,
            'Status'       => 'delivered',
            'CreatedAt'    => $now,
        ];
    }
    sb_insert('user_leadscrapper_leads', $rows);
}

/**
 * Returns array of place_ids in the user's extras queue for this cacheKey.
 * Ordered FIFO by CreatedAt.
 */
function credits_get_extras($email, $cacheKey)
{
    if (empty($email) || empty($cacheKey)) return [];
    $query = 'select=PlaceId'
        . '&UserEmail=eq.' . rawurlencode(strtolower(trim($email)))
        . '&Status=eq.queued'
        . '&SearchString=eq.' . rawurlencode($cacheKey)
        . '&order=CreatedAt.asc'
        . '&limit=100000';
    $r = sb_select('user_leadscrapper_leads', $query);
    if ($r['status'] !== 200 || !is_array($r['json'])) return [];
    $ids = [];
    foreach ($r['json'] as $row) {
        if (isset($row['PlaceId']) && $row['PlaceId'] !== '') {
            $ids[] = (string) $row['PlaceId'];
        }
    }
    return $ids;
}

/**
 * Remove the given place_ids from the user's extras queue for this cacheKey.
 * (DELETE the rows where Status='queued'. Caller will follow up with
 * credits_record_delivered to create the 'delivered' rows.)
 */
function credits_dequeue_extras($email, $cacheKey, $placeIds)
{
    if (empty($email) || empty($cacheKey) || empty($placeIds)) return;

    $cid = credits_get_or_create_customer_id($email);
    if (!$cid) return;

    $cleanPids = [];
    foreach ($placeIds as $pid) {
        if ($pid === '' || $pid === null) continue;
        $cleanPids[] = (string) $pid;
    }

    foreach (array_chunk($cleanPids, 50) as $chunk) {
        $idList = implode(',', array_map('rawurlencode', $chunk));
        $query = 'CustomerID=eq.' . urlencode((string)$cid)
            . '&Status=eq.queued'
            . '&SearchString=eq.' . rawurlencode($cacheKey)
            . '&PlaceId=in.(' . $idList . ')';
        sb_delete('user_leadscrapper_leads', $query);
    }
}

/**
 * Add place_ids to the user's extras queue for this cacheKey.
 * Deletes any existing queued rows for these PlaceIds first (regardless of
 * SearchString) to prevent duplicates when the same lead appears across
 * multiple searches. Skips PlaceIds that already have a 'delivered' row.
 */
function credits_enqueue_extras($email, $cacheKey, $placeIds)
{
    if (empty($email) || empty($cacheKey) || empty($placeIds)) return [];

    $cid = credits_get_or_create_customer_id($email);
    if ($cid === null) {
        error_log('[credits_enqueue_extras] no CustomerID for ' . $email);
        return [];
    }

    $emailNorm = strtolower(trim($email));
    $now = gmdate('c');

    $cleanPids = [];
    foreach ($placeIds as $pid) {
        if ($pid === '' || $pid === null) continue;
        $cleanPids[] = (string) $pid;
    }
    if (empty($cleanPids)) return [];

    // Delete any existing 'queued' rows for these PlaceIds (any SearchString)
    // so we don't create duplicates when the same lead appears in a different search.
    foreach (array_chunk($cleanPids, 50) as $chunk) {
        $idList = implode(',', array_map('rawurlencode', $chunk));
        $qDel = 'CustomerID=eq.' . urlencode((string)$cid)
              . '&PlaceId=in.(' . $idList . ')'
              . '&Status=eq.queued';
        sb_delete('user_leadscrapper_leads', $qDel);
    }

    // Now check which PlaceIds already have a 'delivered' row — skip those
    $deliveredCheck = [];
    foreach (array_chunk($cleanPids, 50) as $chunk) {
        $idList = implode(',', array_map('rawurlencode', $chunk));
        $q = 'select=PlaceId'
           . '&CustomerID=eq.' . urlencode((string)$cid)
           . '&PlaceId=in.(' . $idList . ')'
           . '&Status=eq.delivered'
           . '&limit=10000';
        $r = sb_select('user_leadscrapper_leads', $q);
        if ($r['status'] === 200 && is_array($r['json'])) {
            foreach ($r['json'] as $row) {
                $deliveredCheck[$row['PlaceId']] = true;
            }
        }
    }

    // Build rows — skip already-delivered PlaceIds
    $rows = [];
    foreach ($cleanPids as $pid) {
        if (isset($deliveredCheck[$pid])) continue;
        $rows[] = [
            'CustomerID'   => $cid,
            'UserEmail'    => $emailNorm,
            'PlaceId'      => $pid,
            'SearchString' => $cacheKey,
            'Status'       => 'queued',
            'CreatedAt'    => $now,
        ];
    }
    if (empty($rows)) return [];

    return sb_insert('user_leadscrapper_leads', $rows);
}

/**
 * Returns the number of unserved leads in the user's extras queue for this cacheKey.
 */
function credits_get_extras_count($email, $cacheKey)
{
    if (empty($email) || empty($cacheKey)) return 0;

    // PostgREST: HEAD with Prefer: count=exact returns Content-Range header.
    // But sb_select can't read headers cleanly, so we just fetch ids and count.
    $ids = credits_get_extras($email, $cacheKey);
    return count($ids);
}

/**
 * Insert an audit row into user_leadscrapper_leads with Status='search'.
 *  $source ∈ {'apify','cache','extras','mixed','failed-charge'}
 *
 * The synthetic PlaceId is 'search_<microtime hex>' so each search creates a
 * uniquely-keyed row (the PK is (CustomerID, PlaceId, SearchString, Status)).
 */
function credits_log_search(
    $email,
    $keyword,
    $locationLabel,
    $cacheKey,
    $poolSize,
    $deliveredCount,
    $creditsCharged,
    $source
) {
    if (empty($email) || empty($cacheKey)) return;

    $cid = credits_get_or_create_customer_id($email);
    if ($cid === null) {
        error_log('[credits_log_search] no CustomerID for ' . $email);
        return;
    }

    $emailNorm = strtolower(trim($email));
    $syntheticId = 'search_' . bin2hex(random_bytes(8));

    $meta = [
        'pool_size'       => (int) $poolSize,
        'delivered_count' => (int) $deliveredCount,
        'credits_charged' => (float) $creditsCharged,
        'source'          => (string) $source,
        'keyword'         => (string) $keyword,
        'location_label'  => (string) $locationLabel,
    ];

    sb_insert('user_leadscrapper_leads', [[
        'CustomerID'   => $cid,
        'UserEmail'    => $emailNorm,
        'PlaceId'      => $syntheticId,
        'SearchString' => $cacheKey,
        'Status'       => 'search',
        'SearchMeta'   => $meta,
        'CreatedAt'    => gmdate('c'),
    ]]);
}

// ---------------------------------------------------------------------------
// (C) Main logic: compute, charge, deliver deliverables
// ---------------------------------------------------------------------------

/**
 * Compute the deliverable place list and associated charges/changes.
 *
 * Args:
 *   $allPlaces        — The full pool of places for this cache_key, may include
 *                     leads from Apify, cache, or extras queue.
 *   $deliveredIDs     — Place IDs this user has already received (free).
 *   $extrasIDs        — Place IDs currently in the user's extras queue.
 *   $balance          — User's current credit balance.
 *
 * Returns:
 *   An associative array with:
 *   - 'places'           => array of lead objects to be delivered (at most 100, extras first)
 *   - 'charged'          => float, total credits to deduct (always >= 0)
 *   - 'extrasUsed'       => array of place IDs dequeued from extras queue
 *   - 'newOverflow'      => array of place IDs to enqueue into extras queue
 *   - 'extrasRemaining'  => int, size of extras queue after this operation
 *   - 'poolSize'         => int, total number of leads available in $allPlaces
 */
function credits_compute_slice(
    $allPlaces,
    $deliveredIDs,
    $extrasIDs,
    $balance
)
{
    // Build lookups for efficiency
    $byId = [];
    foreach ($allPlaces as $p) {
        $pid = $p['placeId'] ?? null;
        if ($pid) $byId[$pid] = $p;
    }
    $deliveredSet = array_flip($deliveredIDs);
    $extrasSet    = array_flip($extrasIDs);

    $poolIDs = [];
    foreach ($byId as $pid => $place) {
        if (!isset($deliveredSet[$pid])) {
            $poolIDs[] = $pid;
        }
    }

    // Deliverable IDs: any in extras queue FIRST, then any new pool IDs
    $deliverableIDs = [];
    
    // First, valid extras
    foreach ($extrasIDs as $pid) {
        if (isset($byId[$pid]) && !isset($deliveredSet[$pid])) {
            $deliverableIDs[] = $pid;
        }
    }
    
    $deliverableSet = array_flip($deliverableIDs);
    
    // Next, any new pool IDs not already in extras
    foreach ($poolIDs as $pid) {
        if (!isset($deliverableSet[$pid])) {
            $deliverableIDs[] = $pid;
        }
    }

    // 3. Cap results: max 100 per search, then by balance.
    $maxPerSearch = 100;
    $maxPayable = (int) floor($balance * LEADS_PER_CREDIT + 1e-9); // Round down
    $limit = min($maxPerSearch, $maxPayable);

    $finalDeliverIDs = array_slice($deliverableIDs, 0, $limit);
    $charge = round(count($finalDeliverIDs) * CREDIT_PER_LEAD, 2);

    // 4. Determine which extras were used and what new overflow needs to be queued.
    $extrasUsed = array_intersect($extrasIDs, $finalDeliverIDs);
    $newOverflowIDs = array_diff($poolIDs, $finalDeliverIDs);
    
    // Remove any already in extras
    $newOverflowIDs = array_filter($newOverflowIDs, function($id) use ($extrasSet) {
        return !isset($extrasSet[$id]);
    });

    // 5. Calculate remaining extras.
    $extrasRemaining = count($extrasIDs) - count($extrasUsed) + count($newOverflowIDs);

    // 6. Map IDs back to place objects for the response.
    $placesToDeliver = [];
    foreach ($finalDeliverIDs as $pid) {
        if (isset($byId[$pid])) {
            $placesToDeliver[] = $byId[$pid];
        }
    }

    return [
        'places'           => $placesToDeliver,
        'charged'          => $charge,
        'extrasUsed'       => array_values($extrasUsed), // re-index array
        'newOverflow'      => array_values($newOverflowIDs), // re-index array
        'extrasRemaining'  => $extrasRemaining,
        'poolSize'         => count($allPlaces),
    ];
}
