<?php
/**
 * leads-proxy.php
 * Talks to the existing Supabase table `leadscrapper_leads_data`.
 * Columns are PascalCase and match the legacy Google Sheet header exactly,
 * so request bodies pass through unchanged.
 *
 *   GET  /leads-proxy.php?action=load&email=foo@bar.com
 *   POST /leads-proxy.php  { action, UserEmail, ...payload }
 *
 * Actions:
 *   load          -> { success, leads }
 *   saveLead      -> upsert one lead (on UserEmail+PlaceId)
 *   bulkSaveLeads -> upsert many
 *   updateLead    -> patch by PlaceId
 *   deleteLead    -> delete by PlaceId
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

const TABLE = 'leadscrapper_leads_data';

function fail($code, $msg, $extra = null) {
    http_response_code($code);
    $out = ['success' => false, 'error' => $msg];
    if ($extra !== null) $out['detail'] = $extra;
    echo json_encode($out);
    exit;
}

/**
 * Normalize an incoming lead row for upsert.
 * - Always stamps UserEmail server-side from the authenticated request.
 * - Drops keys we never want to overwrite (CreatedAt).
 */
function normalize_lead($p, $email) {
    if (!is_array($p)) return null;
    if (empty($p['PlaceId'])) return null;
    unset($p['CreatedAt']);
    $p['UserEmail'] = $email;

    // Supabase numeric columns will throw 'invalid input syntax' if given an empty string.
    $numericFields = ['PhoneUnformatted', 'PostalCode', 'ReviewsCount', 'ImagesCount', 'TotalScore', 'Rank', 'LeadScore'];
    foreach ($numericFields as $field) {
        if (isset($p[$field]) && $p[$field] === '') {
            $p[$field] = null;
        }
    }

    return $p;
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
    case 'debug': {
        $cfg = sb_config();
        $info = [
            'success' => true,
            'build_marker' => 'leads-proxy-v2',
            'env_loaded' => !empty($cfg['url']) && !empty($cfg['key']),
            'url_host' => $cfg['url'] ? parse_url($cfg['url'], PHP_URL_HOST) : null,
            'env_url' => $cfg['url'] ? substr($cfg['url'], 0, 40) . '...' : 'MISSING',
            'env_key_set' => !empty($cfg['key']),
            'env_key_prefix' => $cfg['key'] ? substr($cfg['key'], 0, 8) . '...' : 'MISSING',
            'php_version' => PHP_VERSION,
            'curl_available' => function_exists('curl_init'),
            'table' => TABLE,
        ];
        // Try a live probe: count total rows for ANY email (no auth needed for count)
        $probe = sb_select(TABLE, 'select=PlaceId,UserEmail&limit=5');
        $info['probe_status'] = $probe['status'];
        $info['probe_raw'] = is_string($probe['raw']) ? substr($probe['raw'], 0, 300) : json_encode($probe['json']);
        // Try to insert a test row (will fail if RLS blocks it)
        $testId = 'debug_test_' . time();
        $testRes = sb_insert(TABLE, [['PlaceId' => $testId, 'UserEmail' => 'debug@debug.com', 'Title' => 'DEBUG TEST', 'Phone' => '000', 'ClaimThisBusiness' => 'true', 'IsAdvertisement' => 'false']], 'PlaceId');
        $info['test_insert_status'] = $testRes['status'];
        $info['test_insert_raw'] = is_string($testRes['raw']) ? substr($testRes['raw'], 0, 200) : json_encode($testRes['json']);
        echo json_encode($info, JSON_PRETTY_PRINT);
        exit;
    }

    case 'probe': {
        // Lightweight health check
        $probe = sb_select(TABLE, 'select=PlaceId&limit=1');
        echo json_encode(['supabase_ok' => $probe['status'] < 400, 'status' => $probe['status']]);
        exit;
    }

    case 'load': {
        if (!$email) fail(400, 'missing email');
        $q = 'UserEmail=eq.' . urlencode($email) . '&order=CreatedAt.desc';
        $res = sb_select(TABLE, $q);
        if ($res['status'] >= 400) fail(500, 'supabase load failed', $res['raw']);
        echo json_encode(['success' => true, 'leads' => $res['json'] ?: []]);
        exit;
    }

    case 'saveLead': {
        if (!$email) fail(400, 'missing email');
        $row = normalize_lead($body['lead'] ?? null, $email);
        if (!$row) fail(400, 'missing lead or PlaceId');
        $res = sb_insert(TABLE, [$row], 'UserEmail,PlaceId');
        if ($res['status'] >= 400) fail(500, 'supabase upsert failed', $res['raw']);
        echo json_encode(['success' => true]);
        exit;
    }

    case 'bulkSaveLeads': {
        if (!$email) fail(400, 'missing email');
        $incoming = $body['leads'] ?? [];
        $rows = [];
        $skipped = [];
        foreach ($incoming as $idx => $l) {
            $row = normalize_lead($l, $email);
            if ($row) {
                $rows[] = $row;
            } else {
                $skipped[] = ['idx' => $idx, 'reason' => empty($l['PlaceId']) ? 'missing PlaceId' : 'not array', 'sample' => is_array($l) ? array_slice($l, 0, 3, true) : gettype($l)];
            }
        }
        @file_put_contents(__DIR__ . '/supabase_save.log', date('c') . " bulkSaveLeads email=$email incoming=" . count($incoming) . " valid=" . count($rows) . " skipped=" . count($skipped) . "\n", FILE_APPEND);
        if (!count($rows)) {
            @file_put_contents(__DIR__ . '/supabase_error.log', date('c') . " bulkSaveLeads NO VALID ROWS skipped=" . json_encode($skipped) . "\n", FILE_APPEND);
            fail(400, 'no valid leads', ['incoming' => count($incoming), 'skipped' => $skipped]);
        }
        $res = sb_insert(TABLE, $rows, 'UserEmail,PlaceId');
        if ($res['status'] >= 400) {
            @file_put_contents(__DIR__ . '/supabase_error.log', date('c') . " bulkSaveLeads status={$res['status']} raw=" . substr($res['raw'] ?? '', 0, 1000) . " payloadSample=" . json_encode(array_slice($rows, 0, 1)) . "\n", FILE_APPEND);
            fail(500, 'supabase upsert failed', $res['raw']);
        }
        echo json_encode(['success' => true, 'count' => count($rows), 'skipped' => count($skipped)]);
        exit;
    }

    case 'updateLead': {
        if (!$email) fail(400, 'missing email');
        $placeId = $body['PlaceId'] ?? '';
        $fields = $body['fields'] ?? [];
        if (!$placeId || !is_array($fields) || !$fields) fail(400, 'missing PlaceId or fields');
        unset($fields['UserEmail'], $fields['PlaceId'], $fields['CreatedAt']);
        if (!$fields) fail(400, 'no patch fields after stripping protected keys');
        $q = 'UserEmail=eq.' . urlencode($email) . '&PlaceId=eq.' . urlencode($placeId);
        $res = sb_update(TABLE, $q, $fields);
        if ($res['status'] >= 400) fail(500, 'supabase update failed', $res['raw']);
        echo json_encode(['success' => true]);
        exit;
    }

    case 'deleteLead': {
        if (!$email) fail(400, 'missing email');
        $placeId = $body['PlaceId'] ?? '';
        if (!$placeId) fail(400, 'missing PlaceId');
        $q = 'UserEmail=eq.' . urlencode($email) . '&PlaceId=eq.' . urlencode($placeId);
        $res = sb_delete(TABLE, $q);
        if ($res['status'] >= 400) fail(500, 'supabase delete failed', $res['raw']);
        echo json_encode(['success' => true]);
        exit;
    }

    default:
        fail(400, 'unknown action: ' . $action);
}
