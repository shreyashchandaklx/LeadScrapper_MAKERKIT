<?php
/**
 * leads-proxy.php
 *
 * Lead Manager backend. After migration 003, per-user state lives in
 * `user_leadscrapper_leads` (Status='saved' or 'delivered') and business
 * details live in `leadscrapper_leads_data` (cache pool).
 * On load we join the two by PlaceId.
 *
 *   GET  /leads-proxy.php?action=load&email=foo@bar.com
 *   POST /leads-proxy.php  { action, UserEmail, ...payload }
 *
 * Actions:
 *   load          -> { success, leads }  — joined view of saved-state + business data
 *   saveLead      -> upsert one saved-row
 *   bulkSaveLeads -> upsert many saved-rows
 *   updateLead    -> patch per-user editable fields (Notes / LeadScore / ManagerStatus)
 *   deleteLead    -> remove the user's saved-row (cache stays intact)
 */

error_reporting(E_ALL & ~E_DEPRECATED);
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/lib/supabase.php';
require_once __DIR__ . '/lib/credits.php';

const POOL_TABLE  = 'leadscrapper_leads_data';   // cache rows only after 003
const STATE_TABLE = 'user_leadscrapper_leads';   // per-user state
const SAVED_STATUS = 'delivered';
const SAVED_SEARCH = '';                          // SearchString used for saved rows
                                                  // (leave empty — these aren't tied
                                                  // to a specific search anymore)

function fail($code, $msg, $extra = null) {
    http_response_code($code);
    $out = ['success' => false, 'error' => $msg];
    if ($extra !== null) $out['detail'] = $extra;
    echo json_encode($out);
    exit;
}

/**
 * Build a saved-row for user_leadscrapper_leads from an incoming lead payload.
 * Only stores per-user editable metadata; business details stay in the pool.
 */
function build_saved_row($lead, $email, $customerId) {
    if (!is_array($lead) || empty($lead['PlaceId'])) return null;

    $leadScore = $lead['LeadScore'] ?? null;
    if ($leadScore === '') $leadScore = null;

    return [
        'CustomerID'    => $customerId,
        'UserEmail'     => $email,
        'PlaceId'       => (string) $lead['PlaceId'],
        'SearchString'  => SAVED_SEARCH,
        'Status'        => SAVED_STATUS,
        'Notes'         => $lead['Notes'] ?? null,
        'LeadScore'     => $leadScore,
        'ManagerStatus' => $lead['Status'] ?? null,  // frontend still sends "Status"
        // CreatedAt left to DB default
    ];
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;
$body = [];
if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $body = json_decode($raw, true) ?: [];
    $action = $body['action'] ?? $action;
}

$email = strtolower(trim($body['UserEmail'] ?? $_GET['email'] ?? ''));

if (!$action) fail(400, 'missing action');

switch ($action) {

    // ────────────────────────────────────────────────────────────────────────
    // load — (saved + delivered) state ⨯ pool join
    // ────────────────────────────────────────────────────────────────────────
    case 'load': {
        if (!$email) fail(400, 'missing email');

        $customerId = credits_get_or_create_customer_id($email);
        if ($customerId === null) fail(500, 'could not resolve CustomerID for ' . $email);

        // 1. Pull the user's saved + delivered rows (all leads they've received)
        $q1 = 'CustomerID=eq.' . urlencode((string)$customerId)
            . '&Status=in.(saved,delivered)'
            . '&order=CreatedAt.desc'
            . '&limit=10000';
        $r1 = sb_select(STATE_TABLE, $q1);
        if ($r1['status'] >= 400) fail(500, 'supabase load (state) failed', $r1['raw']);
        $stateRows = is_array($r1['json']) ? $r1['json'] : [];

        if (empty($stateRows)) {
            echo json_encode(['success' => true, 'leads' => []]);
            exit;
        }

        // 2. Pull the matching business-detail rows from the pool, one-shot
        $placeIds = [];
        foreach ($stateRows as $sr) {
            $pid = $sr['PlaceId'] ?? '';
            if ($pid !== '') $placeIds[] = $pid;
        }
        $placeIds = array_values(array_unique($placeIds));

        $pool = [];
        // PostgREST in.(...) URL can get long — chunk to 200 ids per request.
        foreach (array_chunk($placeIds, 200) as $chunk) {
            $idList = implode(',', array_map('rawurlencode', $chunk));
            $q2 = 'UserEmail=eq.__cache__'
                . '&PlaceId=in.(' . $idList . ')'
                . '&limit=10000';
            $r2 = sb_select(POOL_TABLE, $q2);
            if ($r2['status'] >= 400) {
                fail(500, 'supabase load (pool) failed', $r2['raw']);
            }
            foreach (($r2['json'] ?? []) as $row) {
                $pid = $row['PlaceId'] ?? '';
                if ($pid !== '') $pool[$pid] = $row;
            }
        }

        // 3. Merge state-row overrides onto the pool row, return combined list.
        //    Deduplicate by PlaceId — if both 'saved' and 'delivered' rows exist
        //    for the same lead, prefer 'saved' (it carries user edits).
        $merged = [];
        foreach ($stateRows as $sr) {
            $pid = $sr['PlaceId'] ?? '';
            if ($pid === '') continue;

            // Skip delivered row if we already have a saved row for this PlaceId
            $rowStatus = $sr['Status'] ?? '';
            if (isset($merged[$pid]) && $rowStatus === 'delivered') continue;

            $base = $pool[$pid] ?? ['PlaceId' => $pid];
            // Per-user editable fields override
            $base['UserEmail'] = $email;
            $base['Notes']     = $sr['Notes']         ?? null;
            $base['LeadScore'] = $sr['LeadScore']     ?? null;
            $base['Status']    = $sr['ManagerStatus'] ?? null; // frontend's "Status"
            $base['CreatedAt'] = $sr['CreatedAt']     ?? null;
            $merged[$pid] = $base;
        }

        echo json_encode(['success' => true, 'leads' => array_values($merged)]);
        exit;
    }

    // ────────────────────────────────────────────────────────────────────────
    // saveLead — upsert one saved row
    // ────────────────────────────────────────────────────────────────────────
    case 'saveLead': {
        if (!$email) fail(400, 'missing email');

        $customerId = credits_get_or_create_customer_id($email);
        if ($customerId === null) fail(500, 'could not resolve CustomerID');

        $row = build_saved_row($body['lead'] ?? null, $email, $customerId);
        if (!$row) fail(400, 'missing lead or PlaceId');

        // Delete ALL existing rows for this PlaceId first (any SearchString/Status)
        // to guarantee exactly one copy per (CustomerID, PlaceId).
        $qDel = 'CustomerID=eq.' . urlencode((string)$customerId)
              . '&PlaceId=eq.' . urlencode((string)$row['PlaceId']);
        sb_delete(STATE_TABLE, $qDel);

        // Insert the single canonical row
        $res = sb_insert(STATE_TABLE, [$row]);
        if ($res['status'] >= 400) fail(500, 'supabase insert failed', $res['raw']);

        echo json_encode(['success' => true]);
        exit;
    }

    // ────────────────────────────────────────────────────────────────────────
    // bulkSaveLeads — upsert many saved rows
    // ────────────────────────────────────────────────────────────────────────
    case 'bulkSaveLeads': {
        if (!$email) fail(400, 'missing email');

        $customerId = credits_get_or_create_customer_id($email);
        if ($customerId === null) fail(500, 'could not resolve CustomerID');

        $incoming = $body['leads'] ?? [];
        $rows = [];
        $skipped = [];
        foreach ($incoming as $idx => $l) {
            $row = build_saved_row($l, $email, $customerId);
            if ($row) {
                $rows[] = $row;
            } else {
                $skipped[] = [
                    'idx'    => $idx,
                    'reason' => empty($l['PlaceId']) ? 'missing PlaceId' : 'not array',
                ];
            }
        }
        @file_put_contents(
            __DIR__ . '/supabase_save.log',
            date('c') . " bulkSaveLeads email=$email cid=$customerId incoming=" . count($incoming)
                . " valid=" . count($rows) . " skipped=" . count($skipped) . "\n",
            FILE_APPEND
        );
        if (!count($rows)) {
            fail(400, 'no valid leads', ['incoming' => count($incoming), 'skipped' => $skipped]);
        }

        // Delete ALL existing rows for these PlaceIds first (any SearchString/Status)
        // to guarantee exactly one copy per (CustomerID, PlaceId).
        $pids = array_map(function($r) { return rawurlencode($r['PlaceId']); }, $rows);
        foreach (array_chunk($pids, 200) as $chunk) {
            $qDel = 'CustomerID=eq.' . urlencode((string)$customerId)
                  . '&PlaceId=in.(' . implode(',', $chunk) . ')';
            sb_delete(STATE_TABLE, $qDel);
        }

        // Insert the canonical rows (no upsert needed — we just deleted)
        $res = sb_insert(STATE_TABLE, $rows);
        if ($res['status'] >= 400) {
            @file_put_contents(
                __DIR__ . '/supabase_error.log',
                date('c') . " bulkSaveLeads status={$res['status']} raw="
                    . substr($res['raw'] ?? '', 0, 1000) . "\n",
                FILE_APPEND
            );
            fail(500, 'supabase insert failed', $res['raw']);
        }

        echo json_encode(['success' => true, 'count' => count($rows), 'skipped' => count($skipped)]);
        exit;
    }

    // ────────────────────────────────────────────────────────────────────────
    // updateLead — patch per-user editable fields only
    // ────────────────────────────────────────────────────────────────────────
    case 'updateLead': {
        if (!$email) fail(400, 'missing email');

        $customerId = credits_get_or_create_customer_id($email);
        if ($customerId === null) fail(500, 'could not resolve CustomerID');

        $placeId = $body['PlaceId'] ?? '';
        $fields  = $body['fields'] ?? [];
        if (!$placeId || !is_array($fields) || !$fields) {
            fail(400, 'missing PlaceId or fields');
        }

        // Map frontend field names → state-table column names.
        // Only these three fields are editable per-user; everything else is
        // pool data and is read-only from the user's perspective.
        $patch = [];
        if (array_key_exists('Notes',     $fields)) $patch['Notes']         = $fields['Notes'];
        if (array_key_exists('LeadScore', $fields)) {
            $v = $fields['LeadScore'];
            $patch['LeadScore'] = ($v === '' ? null : $v);
        }
        if (array_key_exists('Status',    $fields)) $patch['ManagerStatus'] = $fields['Status'];

        if (!$patch) fail(400, 'no editable fields in patch');

        $q = 'CustomerID=eq.' . urlencode((string)$customerId)
           . '&Status=in.(saved,delivered)'
           . '&PlaceId=eq.' . urlencode($placeId);
        $res = sb_update(STATE_TABLE, $q, $patch);
        if ($res['status'] >= 400) fail(500, 'supabase update failed', $res['raw']);
        echo json_encode(['success' => true]);
        exit;
    }

    // ────────────────────────────────────────────────────────────────────────
    // deleteLead — drop the user's saved row (pool unaffected)
    // ────────────────────────────────────────────────────────────────────────
    case 'deleteLead': {
        if (!$email) fail(400, 'missing email');

        $customerId = credits_get_or_create_customer_id($email);
        if ($customerId === null) fail(500, 'could not resolve CustomerID');

        $placeId = $body['PlaceId'] ?? '';
        if (!$placeId) fail(400, 'missing PlaceId');

        $q = 'CustomerID=eq.' . urlencode((string)$customerId)
           . '&Status=in.(saved,delivered)'
           . '&PlaceId=eq.' . urlencode($placeId);
        $res = sb_delete(STATE_TABLE, $q);
        if ($res['status'] >= 400) fail(500, 'supabase delete failed', $res['raw']);
        echo json_encode(['success' => true]);
        exit;
    }

    // ────────────────────────────────────────────────────────────────────────
    // diagnostic
    // ────────────────────────────────────────────────────────────────────────
    case 'probe': {
        $probe = sb_select(STATE_TABLE, 'select=PlaceId&limit=1');
        echo json_encode(['supabase_ok' => $probe['status'] < 400, 'status' => $probe['status']]);
        exit;
    }

    default:
        fail(400, 'unknown action: ' . $action);
}
