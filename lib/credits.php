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
 * Pricing: 1 credit = 100 leads  ->  1 lead = 0.01 credit
 */

require_once __DIR__ . '/supabase.php';

const LEADS_PER_CREDIT  = 100;
const CREDIT_PER_LEAD   = 0.01;

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
 * Deduct leadCount * 0.01 credits from the user. Returns the Makerkit
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
// (B) Local Supabase audit tables
// ---------------------------------------------------------------------------

/**
 * Returns array of place_ids this user has already received for cacheKey.
 */
function credits_get_delivered_ids($email, $cacheKey)
{
    $query = 'select=place_id'
        . '&user_email=eq.' . rawurlencode($email)
        . '&cache_key=eq.' . rawurlencode($cacheKey)
        . '&limit=100000';
    $r = sb_select('leadscrapper_delivered', $query);
    if ($r['status'] !== 200 || !is_array($r['json'])) return [];
    $ids = [];
    foreach ($r['json'] as $row) {
        if (isset($row['place_id']) && $row['place_id'] !== '') {
            $ids[] = (string) $row['place_id'];
        }
    }
    return $ids;
}

/**
 * Record place_ids as delivered to this user for cacheKey. Idempotent (upserts).
 */
function credits_record_delivered($email, $cacheKey, $placeIds)
{
    if (empty($placeIds)) return;
    $rows = [];
    $now = gmdate('c');
    foreach ($placeIds as $pid) {
        if ($pid === '' || $pid === null) continue;
        $rows[] = [
            'user_email'   => $email,
            'cache_key'    => $cacheKey,
            'place_id'     => (string) $pid,
            'delivered_at' => $now,
        ];
    }
    if (empty($rows)) return;
    // upsert on the composite PK (user_email,cache_key,place_id)
    sb_insert('leadscrapper_delivered', $rows, 'user_email,cache_key,place_id');
}

/**
 * Returns array of place_ids in the user's extras queue for this cacheKey.
 * Ordered FIFO.
 */
function credits_get_extras( $email, $cacheKey)
{
    if (empty($email)) return [];
    $query = 'select=place_id'
        . '&user_email=eq.' . rawurlencode($email)
        . '&cache_key=eq.' . rawurlencode($cacheKey)
        . '&order=queued_at.asc'
        . '&limit=100000';
    $r = sb_select('leadscrapper_extras', $query);
    if ($r['status'] !== 200 || !is_array($r['json'])) return [];
    $ids = [];
    foreach ($r['json'] as $row) {
        if (isset($row['place_id']) && $row['place_id'] !== '') {
            $ids[] = (string) $row['place_id'];
        }
    }
    return $ids;
}

/**
 * Remove the given place_ids from the user's extras queue for this cacheKey.
 */
function credits_dequeue_extras( $email, $cacheKey, $placeIds)
{
    if (empty($email) || empty($placeIds)) return;

    // Supabase requires url-encoded IN clauses for multiple IDs.
    $placeIdFilter = 'place_id.in.(' . implode(',', array_map('rawurlencode', $placeIds))
        . ')';

    $emailFilter = 'user_email=eq.' . rawurlencode($email);
    $cacheKeyFilter = 'cache_key=eq.' . rawurlencode($cacheKey);

    $query = $emailFilter . '&' . $cacheKeyFilter . '&' . $placeIdFilter;
    sb_delete('leadscrapper_extras', $query);
}

/**
 * Add place_ids to the user's extras queue for this cacheKey.
 */
function credits_enqueue_extras($email, $cacheKey, $placeIds)
{
    if (empty($email) || empty($placeIds)) return [];
    $rows = [];
    foreach ($placeIds as $pid) {
        if ($pid === '' || $pid === null) continue;
        $rows[] = [
            'user_email' => $email,
            'cache_key'  => $cacheKey,
            'place_id'   => (string) $pid,
        ];
    }
    if (empty($rows)) return [];
    // Insert on conflict - if a row already exists we just ignore it.
    // The PK (user_email, cache_key, place_id) prevents duplicates.
    return sb_insert('leadscrapper_extras', $rows, 'user_email,cache_key,place_id');
}

/**
 * Returns the number of unserved leads in the user's extras queue for this cacheKey.
 */
function credits_get_extras_count($email, $cacheKey)
{
    if (empty($email)) return 0;
    
    $q = "user_email=eq." . rawurlencode($email) . "&cache_key=eq." . rawurlencode($cacheKey) . "&select=count";
    $res = sb_select('leadscrapper_extras', $q);
    
    // PostgREST count query returns a scalar count if we use 'select=count' 
    // or sometimes an array [{count: N}]. 
    // My sb_select implementation returns ['json' => ...]
    
    if (isset($res['json'][0]['count'])) {
        return (int) $res['json'][0]['count'];
    }
    
    return 0;
}

/**
 * Insert an audit row into leadscrapper_searches.
 *  $source ∈ {'apify','cache','extras','mixed','failed-charge'}
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
    sb_insert('leadscrapper_searches', [[
        'user_email'      => $email,
        'keyword'         => $keyword,
        'location_label'  => $locationLabel,
        'cache_key'       => $cacheKey,
        'pool_size'       => $poolSize,
        'delivered_count' => $deliveredCount,
        'credits_charged' => $creditsCharged,
        'source'          => $source,
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
