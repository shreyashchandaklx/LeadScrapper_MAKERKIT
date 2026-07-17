<?php
/**
 * lib/city_scrape.php
 *
 * Data-access helpers for whole-city scraping. Thin wrappers over the RPCs and
 * tables created in migrations/20260613000000_city_scrape.sql.
 *
 * SCOPE (per §0a-REALITY of city_scrape_plan.md):
 *   This file manages ONLY the orchestration layer:
 *     - city_scrape_jobs        (one per city+keyword)
 *     - city_scrape_zips        (the ZIP work queue)
 *     - city_scrape_subscribers (who's watching)
 *     - apify_keys              (quota state)
 *   It does NOT touch credits or per-user delivered/queued rows. Billing stays
 *   in applyCreditSlice() (apify-proxy.php), invoked when a user VIEWS leads.
 *
 * Lead storage is unchanged: each ZIP scrape writes to leadscrapper_leads_data
 * under the per-ZIP cacheKey "keyword|zip:XXXXX|cc" via the existing pipeline.
 */

require_once __DIR__ . '/supabase.php';
require_once __DIR__ . '/keyword_normalize.php';

/**
 * Canonical city-level job key, e.g. "plumber|denver,co|us".
 * Distinct from the per-ZIP cacheKey "plumber|zip:80201|us".
 */
function cs_build_search_key($keyword, $city, $state, $country)
{
    $kw = normalize_keyword($keyword);   // plumber/plumbers/"Plumber " → one key
    $ci = strtolower(trim((string)$city));
    $st = strtolower(trim((string)$state));
    $cc = strtolower(trim((string)$country));
    return $kw . '|' . $ci . ',' . $st . '|' . $cc;
}

/**
 * The per-ZIP cacheKey a single ZIP scrape stores under — MUST match
 * buildCacheKey()/extractQueryFromInput() in apify-proxy.php:
 *   location = "zip:<postalCode>|<countryCode>"
 */
function cs_zip_cache_key($keyword, $zip, $country)
{
    $loc = 'zip:' . trim((string)$zip);
    $cc  = strtolower(trim((string)$country));
    if ($cc !== '') $loc .= '|' . $cc;
    return normalize_keyword($keyword) . '|' . strtolower($loc);
}

/* ============================================================
 * JOBS
 * ============================================================ */

/**
 * Find an existing job for this search_key, or create one.
 * Returns the job row (array) or null on failure.
 */
function cs_find_or_create_job($keyword, $city, $state, $country, $ownerEmail = '')
{
    $searchKey = cs_build_search_key($keyword, $city, $state, $country);

    // Try existing first.
    $r = sb_select('city_scrape_jobs',
        'select=*&search_key=eq.' . rawurlencode($searchKey) . '&limit=1');
    if ($r['status'] === 200 && is_array($r['json']) && !empty($r['json'])) {
        $job = $r['json'][0];
        // BYOK: backfill owner_email on an existing job that was created before
        // the column existed or via cs_record_single_zip_scraped (no email).
        $existingOwner = strtolower(trim((string)($job['owner_email'] ?? '')));
        if ($existingOwner === '' && $ownerEmail !== '') {
            sb_update('city_scrape_jobs',
                'id=eq.' . rawurlencode($job['id']),
                ['owner_email' => strtolower(trim($ownerEmail))]);
            $job['owner_email'] = strtolower(trim($ownerEmail));
        }
        return $job;
    }

    // Create. Upsert on search_key handles the create-create race.
    $row = [
        'search_key'   => $searchKey,
        'keyword'      => strtolower(trim((string)$keyword)),
        'country_code' => strtolower(trim((string)$country)),
        'state'        => (string)$state,
        'city'         => (string)$city,
        'status'       => 'queued',
    ];
    // BYOK: store the job creator's email so the worker uses their Apify key.
    if ($ownerEmail !== '') {
        $row['owner_email'] = strtolower(trim($ownerEmail));
    }
    $ins = sb_insert('city_scrape_jobs', [$row], 'search_key');
    if ($ins['status'] >= 400) {
        error_log('[cs_find_or_create_job] insert failed: ' . ($ins['raw'] ?? ''));
        return null;
    }
    if (is_array($ins['json']) && !empty($ins['json'])) {
        return $ins['json'][0];
    }
    // Upsert with no representation returned — re-select.
    $r2 = sb_select('city_scrape_jobs',
        'select=*&search_key=eq.' . rawurlencode($searchKey) . '&limit=1');
    return ($r2['status'] === 200 && !empty($r2['json'])) ? $r2['json'][0] : null;
}

/**
 * Raise a job's lead target so a dormant city resumes scraping. Returns the
 * (possibly unchanged) target. The RPC only bumps when the pool has already
 * reached the current target (i.e. a prior run stopped here); for a fresh job
 * still below target it's a no-op and the in-flight run finishes on its own.
 */
function cs_bump_job_target($jobId, $increment = 100)
{
    $r = sb_request('POST', 'rpc/bump_job_target',
        ['p_job_id' => $jobId, 'p_increment' => (int)$increment]);
    return ($r['status'] >= 200 && $r['status'] < 300) ? (int)$r['json'] : 0;
}

/**
 * Get a job (with computed progress) by id, scoped helper for the status endpoint.
 */
function cs_get_job($jobId)
{
    $r = sb_select('city_scrape_jobs',
        'select=*&id=eq.' . rawurlencode($jobId) . '&limit=1');
    return ($r['status'] === 200 && !empty($r['json'])) ? $r['json'][0] : null;
}

/* ============================================================
 * ZIP QUEUE
 * ============================================================ */

/**
 * Enqueue the given ZIPs for a job. Idempotent: ON CONFLICT (job_id, zip)
 * DO NOTHING, so any ZIP already present (e.g. a pre-scraped one from a
 * Mode-1 single-ZIP search) is PRESERVED, never reset to 'queued'.
 * Also sets zips_total on the job to the resulting ZIP count.
 */
function cs_enqueue_zips($jobId, $zips)
{
    $clean = [];
    foreach ($zips as $z) {
        $z = trim((string)$z);
        if ($z !== '') $clean[$z] = true;   // dedupe
    }
    if (empty($clean)) return 0;

    // Preserve existing rows: an UPSERT (merge-duplicates) would OVERWRITE a
    // ZIP that's already 'running'/'scraped' back to 'queued', re-scraping work
    // and breaking the Mode-1 reuse + crash-resume design. So we SELECT the ZIPs
    // already present for this job and INSERT only the ones that are missing.
    $existing = [];
    $exRes = sb_select('city_scrape_zips',
        'select=zip&job_id=eq.' . rawurlencode($jobId) . '&limit=100000');
    if ($exRes['status'] === 200 && is_array($exRes['json'])) {
        foreach ($exRes['json'] as $row) {
            if (isset($row['zip'])) $existing[(string)$row['zip']] = true;
        }
    }

    $rows = [];
    foreach (array_keys($clean) as $z) {
        if (isset($existing[$z])) continue;   // already enqueued/running/scraped — leave it
        $rows[] = ['job_id' => $jobId, 'zip' => $z, 'status' => 'queued'];
    }
    foreach (array_chunk($rows, 200) as $chunk) {
        // Plain insert (no upsert) — these are all new ZIPs. on_conflict guards
        // the rare create-create race so a concurrent insert can't 409 us.
        $ins = sb_insert('city_scrape_zips', $chunk, 'job_id,zip');
        if ($ins['status'] >= 400) {
            error_log('[cs_enqueue_zips] insert failed: ' . ($ins['raw'] ?? ''));
        }
    }

    // zips_total = current count of ZIP rows for this job.
    $cntRes = sb_select('city_scrape_zips',
        'select=id&job_id=eq.' . rawurlencode($jobId) . '&limit=100000');
    $total = (is_array($cntRes['json'])) ? count($cntRes['json']) : count($clean);
    sb_update('city_scrape_jobs', 'id=eq.' . rawurlencode($jobId),
        ['zips_total' => $total, 'updated_at' => gmdate('c')]);
    return $total;
}

/**
 * Mode-1 reuse hook: record that a single ZIP has already been scraped under
 * this city+keyword, so a later whole-city run skips it. Lazily creates the
 * job row. Marks the ZIP 'scraped' (upsert) and bumps zips_total if it's new.
 */
function cs_record_single_zip_scraped($keyword, $city, $state, $country, $zip, $leadsCount = 0)
{
    $job = cs_find_or_create_job($keyword, $city, $state, $country);
    if (!$job) return false;

    $row = [
        'job_id'      => $job['id'],
        'zip'         => trim((string)$zip),
        'status'      => 'scraped',
        'leads_count' => (int)$leadsCount,
        'scraped_at'  => gmdate('c'),
    ];
    // Upsert: if the ZIP row exists we promote it to scraped; if not we add it.
    $ins = sb_insert('city_scrape_zips', [$row], 'job_id,zip');
    if ($ins['status'] >= 400) {
        error_log('[cs_record_single_zip_scraped] upsert failed: ' . ($ins['raw'] ?? ''));
        return false;
    }
    // Recompute zips_total/done cheaply via finish_zip-style refresh.
    cs_refresh_job_counters($job['id']);
    return true;
}

/**
 * Recompute zips_total/zips_done/zips_failed for a job from its ZIP rows.
 * (finish_zip() does this in-RPC for worker writes; this is for the PHP-side
 * single-ZIP path which upserts directly.)
 */
function cs_refresh_job_counters($jobId)
{
    $r = sb_select('city_scrape_zips',
        'select=status&job_id=eq.' . rawurlencode($jobId) . '&limit=100000');
    if ($r['status'] !== 200 || !is_array($r['json'])) return;
    $total = count($r['json']);
    $done = 0; $failed = 0;
    foreach ($r['json'] as $row) {
        if (($row['status'] ?? '') === 'scraped') $done++;
        elseif (($row['status'] ?? '') === 'failed') $failed++;
    }
    $patch = [
        'zips_total'  => $total,
        'zips_done'   => $done,
        'zips_failed' => $failed,
        'updated_at'  => gmdate('c'),
    ];
    if ($total > 0 && ($done + $failed) >= $total) $patch['status'] = 'completed';
    sb_update('city_scrape_jobs', 'id=eq.' . rawurlencode($jobId), $patch);
}

/**
 * Return the list of ZIP strings for a job that are 'scraped' AND have leads.
 * The frontend pulls leads ONLY for these — so the browser never triggers a
 * live Apify run racing the worker.
 *
 * IMPORTANT — exclude leads_count=0: an empty ZIP writes NO cache row (the
 * pool only stores non-empty merges), so apify-proxy would cache-MISS and fire
 * a fresh live Apify run for it (wasted money + race). There's nothing to show
 * or bill for an empty ZIP anyway, so we simply never pull it.
 */
function cs_get_scraped_zips($jobId)
{
    $r = sb_select('city_scrape_zips',
        'select=zip&status=eq.scraped&leads_count=gt.0&job_id=eq.' . rawurlencode($jobId) . '&limit=100000');
    if ($r['status'] !== 200 || !is_array($r['json'])) return [];
    $out = [];
    foreach ($r['json'] as $row) {
        if (isset($row['zip']) && $row['zip'] !== '') $out[] = (string)$row['zip'];
    }
    return $out;
}

/**
 * Atomically claim the next queued ZIP across all active jobs.
 * Returns the ZIP row (array) or null when there's no work.
 */
function cs_claim_next_zip($workerId)
{
    $r = sb_request('POST', 'rpc/claim_next_zip', ['p_worker_id' => $workerId]);
    if ($r['status'] >= 200 && $r['status'] < 300 && is_array($r['json']) && !empty($r['json'])) {
        return $r['json'][0];
    }
    return null;
}

function cs_heartbeat_zip($zipId, $workerId)
{
    sb_request('POST', 'rpc/heartbeat_zip', ['p_zip_id' => (int)$zipId, 'p_worker_id' => $workerId]);
}

function cs_reap_stuck_zips($staleMinutes = 10)
{
    $r = sb_request('POST', 'rpc/reap_stuck_zips', ['p_stale_minutes' => (int)$staleMinutes]);
    return ($r['status'] >= 200 && $r['status'] < 300) ? (int)$r['json'] : 0;
}

/**
 * Mark a ZIP finished. $status: 'scraped' | 'failed' | 'queued' (re-queue on quota).
 */
function cs_finish_zip($zipId, $status, $leadsCount = 0, $apifyRun = null, $error = null)
{
    sb_request('POST', 'rpc/finish_zip', [
        'p_zip_id'      => (int)$zipId,
        'p_status'      => $status,
        'p_leads_count' => (int)$leadsCount,
        'p_apify_run'   => $apifyRun,
        'p_error'       => $error,
    ]);
}

/* ============================================================
 * APIFY KEYS
 * ============================================================ */

function cs_pick_apify_key()
{
    $r = sb_request('POST', 'rpc/pick_apify_key', []);
    if ($r['status'] >= 200 && $r['status'] < 300 && is_string($r['json']) && $r['json'] !== '') {
        return $r['json'];
    }
    // PostgREST returns scalar text — may arrive JSON-decoded as string or null.
    return (is_string($r['json']) && $r['json'] !== '') ? $r['json'] : null;
}

function cs_cooldown_apify_key($keyRef, $minutes = 60)
{
    sb_request('POST', 'rpc/cooldown_apify_key',
        ['p_key_ref' => $keyRef, 'p_minutes' => (int)$minutes]);
}

/* ============================================================
 * SUBSCRIBERS
 * ============================================================ */

function cs_add_subscriber($jobId, $email, $customerId = null)
{
    $row = [
        'job_id'      => $jobId,
        'email'       => strtolower(trim((string)$email)),
        'customer_id' => $customerId,
    ];
    $ins = sb_insert('city_scrape_subscribers', [$row], 'job_id,email');
    if ($ins['status'] >= 400) {
        error_log('[cs_add_subscriber] failed: ' . ($ins['raw'] ?? ''));
    }
}

function cs_remove_subscriber($jobId, $email)
{
    sb_delete('city_scrape_subscribers',
        'job_id=eq.' . rawurlencode($jobId)
        . '&email=eq.' . rawurlencode(strtolower(trim((string)$email))));
}
