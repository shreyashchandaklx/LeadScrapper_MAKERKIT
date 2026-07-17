<?php
/**
 * error_notify_cron.php — batched error-alert digest for Lead Scrapper (app "LS").
 *
 * Runs every 15 min from cron. Reads the JSON-lines error log that
 * lib/error_logger.php writes (logs/YYYY-MM-DD/error.log), finds entries newer
 * than the last digest, groups them by module+message, and sends ONE summary
 * email via the Resend HTTP API. Zero new errors → sends nothing.
 *
 *   crontab (every 15 min):
 *     star/15 * * * * /usr/bin/php /var/www/leadscrapper.pixnom.com/error_notify_cron.php >> /var/www/leadscrapper.pixnom.com/logs/notify.log 2>&1
 *   (replace "star" with an asterisk)
 *
 * DESIGN
 *   - Does NOT touch lib/error_logger.php — it only READS the files that logger
 *     already writes, so the request-critical logging path is never at risk.
 *   - State (last-sent timestamp) lives in logs/.error_notify_state.json.
 *   - First ever run initializes the watermark to "now" and sends nothing, so
 *     enabling the cron never blasts a backlog.
 *   - CLI only. Never throws — a notifier must never become its own incident.
 *
 * ENV (.env, same file as APIFY_KEY_*):
 *   RESEND_API_KEY      (required)  — Resend API key
 *   ERROR_NOTIFY_TO     (optional)  — recipient; default below
 *   ERROR_NOTIFY_FROM   (optional)  — verified Resend sender; default below
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

const ENF_DEFAULT_TO   = 'shreyashchandak.lx@gmail.com';
const ENF_DEFAULT_FROM = 'Pixnom <info@pixnom.com>';
const ENF_APP_LABEL    = 'LeadScrapper';
const ENF_LOG_DIR      = __DIR__ . '/logs';
const ENF_STATE_FILE   = __DIR__ . '/logs/.error_notify_state.json';
const ENF_MAX_GROUPS   = 40;     // cap email size during a storm
const ENF_MAX_ERRORS   = 2000;   // hard cap on lines parsed per run

function enf_log($msg) {
    fwrite(STDOUT, '[' . gmdate('Y-m-d H:i:s') . "Z] $msg\n");
}

/** Load .env into an assoc array (same parsing as apify-proxy.php). */
function enf_load_env($path) {
    $env = [];
    if (!file_exists($path)) return $env;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $t = trim($line);
        if ($t === '' || $t[0] === '#' || $t[0] === ';') continue;
        if (strpos($t, '=') === false) continue;
        [$k, $v] = explode('=', $t, 2);
        $env[trim($k)] = preg_replace('/^["\'](.*)["\']$/', '$1', trim($v));
    }
    return $env;
}

/** IST date string (YYYY-MM-DD) for offset 0 = today, -1 = yesterday. */
function enf_ist_date($dayOffset = 0) {
    $ist = new DateTime('now', new DateTimeZone('Asia/Kolkata'));
    if ($dayOffset !== 0) $ist->modify(($dayOffset > 0 ? '+' : '') . $dayOffset . ' day');
    return $ist->format('Y-m-d');
}

/** Read state; returns ['lastSent' => epoch|null]. */
function enf_read_state() {
    if (!file_exists(ENF_STATE_FILE)) return ['lastSent' => null];
    $raw = @file_get_contents(ENF_STATE_FILE);
    $j = json_decode($raw ?: '', true);
    return is_array($j) ? $j + ['lastSent' => null] : ['lastSent' => null];
}

function enf_write_state($state) {
    @file_put_contents(ENF_STATE_FILE, json_encode($state), LOCK_EX);
}

/**
 * Collect error entries with ts strictly after $sinceEpoch.
 * Reads today's + yesterday's dated log (covers the IST-midnight rollover).
 */
function enf_collect_since($sinceEpoch) {
    $files = [
        ENF_LOG_DIR . '/' . enf_ist_date(-1) . '/error.log',
        ENF_LOG_DIR . '/' . enf_ist_date(0)  . '/error.log',
    ];
    $out = [];
    foreach ($files as $file) {
        if (!is_file($file)) continue;
        $fh = @fopen($file, 'r');
        if (!$fh) continue;
        while (($line = fgets($fh)) !== false) {
            $line = trim($line);
            if ($line === '') continue;
            $e = json_decode($line, true);
            if (!is_array($e) || !isset($e['ts'])) continue;
            $ts = strtotime($e['ts']);
            if ($ts === false || $ts <= $sinceEpoch) continue;
            $out[] = $e;
            if (count($out) >= ENF_MAX_ERRORS) { fclose($fh); return $out; }
        }
        fclose($fh);
    }
    return $out;
}

/** Group entries by module|message; return sorted groups + a sample each. */
function enf_group($entries) {
    $groups = [];
    foreach ($entries as $e) {
        $mod = $e['module'] ?? 'GEN';
        $msg = trim((string)($e['message'] ?? ''));
        $key = $mod . '|' . $msg;
        if (!isset($groups[$key])) {
            $groups[$key] = [
                'module'  => $mod,
                'message' => $msg,
                'count'   => 0,
                'users'   => [],
                'sample'  => $e,   // first seen — keeps id/page/action/source
            ];
        }
        $groups[$key]['count']++;
        $u = (string)($e['user'] ?? '');
        if ($u !== '' && $u !== 'anonymous') $groups[$key]['users'][$u] = true;
    }
    usort($groups, fn($a, $b) => $b['count'] <=> $a['count']);
    return $groups;
}

function enf_h($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

/** Build the HTML body for the digest. */
function enf_build_html($groups, $total, $windowDesc) {
    $rows = '';
    $shown = array_slice($groups, 0, ENF_MAX_GROUPS);
    foreach ($shown as $g) {
        $s = $g['sample'];
        $users = array_keys($g['users']);
        $userStr = empty($users)
            ? '—'
            : enf_h($users[0]) . (count($users) > 1 ? ' +' . (count($users) - 1) . ' more' : '');
        $rows .= '<tr>'
            . '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;font-weight:700;">' . (int)$g['count'] . '</td>'
            . '<td style="padding:6px 10px;border-bottom:1px solid #eee;"><code>' . enf_h($g['module']) . '</code></td>'
            . '<td style="padding:6px 10px;border-bottom:1px solid #eee;">' . enf_h($g['message']) . '</td>'
            . '<td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;">'
                . enf_h($s['source'] ?? '') . ' · ' . enf_h($s['action'] ?? ($s['page'] ?? '')) . '<br>'
                . '<span style="color:#999;font-size:11px;">' . enf_h($s['id'] ?? '') . '</span>'
            . '</td>'
            . '<td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;">' . $userStr . '</td>'
            . '</tr>';
    }
    $more = count($groups) > ENF_MAX_GROUPS
        ? '<p style="color:#999;">…and ' . (count($groups) - ENF_MAX_GROUPS) . ' more error type(s) not shown.</p>'
        : '';

    return '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:760px;">'
        . '<h2 style="margin:0 0 4px;">⚠️ ' . ENF_APP_LABEL . ' — ' . (int)$total . ' new error'
            . ($total === 1 ? '' : 's') . '</h2>'
        . '<p style="color:#666;margin:0 0 14px;">' . enf_h($windowDesc) . ' · '
            . count($groups) . ' distinct type' . (count($groups) === 1 ? '' : 's') . '</p>'
        . '<table style="border-collapse:collapse;width:100%;font-size:13px;">'
        . '<thead><tr style="background:#f5f5f5;text-align:left;">'
            . '<th style="padding:6px 10px;">#</th><th style="padding:6px 10px;">Module</th>'
            . '<th style="padding:6px 10px;">Message</th><th style="padding:6px 10px;">Where / Error ID</th>'
            . '<th style="padding:6px 10px;">User</th>'
        . '</tr></thead><tbody>' . $rows . '</tbody></table>'
        . $more
        . '<p style="color:#bbb;font-size:11px;margin-top:18px;">Automated digest from error_notify_cron.php · times are IST</p>'
        . '</div>';
}

/** Send via Resend HTTP API. Returns [ok, httpCode, body]. */
function enf_send_resend($apiKey, $from, $to, $subject, $html) {
    $payload = json_encode([
        'from'    => $from,
        'to'      => [$to],
        'subject' => $subject,
        'html'    => $html,
    ]);
    $ch = curl_init('https://api.resend.com/emails');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ],
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($body === false) return [false, 0, 'curl: ' . $err];
    return [$code >= 200 && $code < 300, $code, $body];
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
try {
    $env     = enf_load_env(__DIR__ . '/.env');
    $apiKey  = trim($env['RESEND_API_KEY'] ?? '');
    $to      = trim($env['ERROR_NOTIFY_TO'] ?? '') ?: ENF_DEFAULT_TO;
    $from    = trim($env['ERROR_NOTIFY_FROM'] ?? '') ?: ENF_DEFAULT_FROM;

    if ($apiKey === '') {
        enf_log('ERROR: RESEND_API_KEY missing in .env — cannot send. Exiting.');
        exit(1);
    }

    $state    = enf_read_state();
    $lastSent = $state['lastSent'] ?? null;
    $now      = time();

    // First run: set the watermark and send nothing (no backlog blast).
    if ($lastSent === null) {
        enf_write_state(['lastSent' => $now]);
        enf_log('initialized watermark — no email on first run');
        exit(0);
    }

    $entries = enf_collect_since((int)$lastSent);
    if (empty($entries)) {
        enf_write_state(['lastSent' => $now]);
        enf_log('no new errors');
        exit(0);
    }

    $groups     = enf_group($entries);
    $total      = count($entries);
    $windowDesc = 'since ' . (new DateTime('@' . (int)$lastSent))
        ->setTimezone(new DateTimeZone('Asia/Kolkata'))->format('H:i') . ' IST';
    $subject = '[' . ENF_APP_LABEL . '] ' . $total . ' new error'
        . ($total === 1 ? '' : 's') . ' · ' . count($groups) . ' type'
        . (count($groups) === 1 ? '' : 's');
    $html = enf_build_html($groups, $total, $windowDesc);

    [$ok, $code, $body] = enf_send_resend($apiKey, $from, $to, $subject, $html);
    if ($ok) {
        // Only advance the watermark on a successful send, so a transient Resend
        // outage doesn't silently drop a batch — next run retries the same window.
        enf_write_state(['lastSent' => $now]);
        enf_log("sent digest: $total error(s), " . count($groups) . " type(s) → $to");
    } else {
        enf_log("Resend send FAILED (http $code): " . substr((string)$body, 0, 300) . ' — watermark NOT advanced, will retry');
    }
    exit(0);
} catch (Throwable $e) {
    // A notifier must never become its own incident.
    enf_log('FATAL (ignored): ' . $e->getMessage());
    exit(0);
}
