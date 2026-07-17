<?php
/**
 * lib/activity_logger.php
 *
 * Self-hosted USER-ACTIVITY logger for Lead Scrapper (app "LS").
 * Writes one JSON line per user action to logs/YYYY-MM-DD/activity.log.
 * Sibling of lib/error_logger.php (errors go to logs/YYYY-MM-DD/error.log) —
 * kept INDEPENDENT so neither logger can break the other.
 *
 * Usage:
 *   require_once __DIR__ . '/activity_logger.php';
 *   log_activity('foo@bar.com', 'search', [
 *       'count' => 34,                       // leads delivered / rows / 1 / 0
 *       'meta'  => ['keyword' => 'plumber', 'city' => 'Denver', 'zip' => '80202'],
 *       'source'=> 'backend',                // 'backend' | 'frontend'
 *   ]);
 *
 * Design rules (same as error logger — see activity_logging.md):
 *   - NEVER throws. Logging must never break the actual request.
 *   - Secrets are stripped from meta before writing.
 *   - logs/ + .htaccess + the dated subfolder are auto-created on first write.
 *   - Timestamps in IST (+05:30).
 */

const ACTLOG_APP    = 'LS';
const ACTLOG_DIR    = __DIR__ . '/../logs';
const ACTLOG_EVENTS = ['search', 'city_search', 'export', 'report', 'email_written', 'login', 'other'];

/** Max sizes so one entry can never bloat the file. */
const ACTLOG_MAX_META  = 2048;   // 2 KB (after json_encode)
const ACTLOG_MAX_FIELD = 256;    // email/event/etc.

/** Normalize/validate an event tag; unknown tags fall back to 'other'. */
function actlog_clean_event($event) {
    $event = strtolower(preg_replace('/[^a-z_]/i', '', (string) $event));
    return in_array($event, ACTLOG_EVENTS, true) ? $event : 'other';
}

/** Recursively remove secret-ish keys from a meta array. */
function actlog_strip_secrets($value, $depth = 0) {
    if ($depth > 4) return '[depth-limit]';
    if (!is_array($value)) return $value;
    $out = [];
    foreach ($value as $k => $v) {
        if (is_string($k) && preg_match('/api[_-]?key|token|authorization|password|secret|service[_-]?key|bearer/i', $k)) {
            $out[$k] = '[redacted]';
        } else {
            $out[$k] = actlog_strip_secrets($v, $depth + 1);
        }
    }
    return $out;
}

/** Clamp a string field to a max length. */
function actlog_clamp($s, $max) {
    $s = (string) $s;
    return strlen($s) > $max ? substr($s, 0, $max) . '…[truncated]' : $s;
}

/**
 * Ensure logs/ + today's dated subfolder exist and are protected. Never throws.
 * @param string $date  YYYY-MM-DD
 * @return string|false  the usable dated dir path, or false if not writable
 */
function actlog_ensure_dir($date) {
    if (!is_dir(ACTLOG_DIR)) {
        if (!@mkdir(ACTLOG_DIR, 0755, true)) return false;
    }
    $ht = ACTLOG_DIR . '/.htaccess';
    if (!file_exists($ht)) {
        @file_put_contents($ht, "Require all denied\nDeny from all\n");
    }
    $dayDir = ACTLOG_DIR . '/' . $date;
    if (!is_dir($dayDir)) {
        if (!@mkdir($dayDir, 0755, true)) return false;
    }
    return is_writable($dayDir) ? $dayDir : false;
}

/**
 * Write one activity event to today's activity.log.
 *
 * @param string $email user identifier (email); 'anonymous' if unknown
 * @param string $event one of ACTLOG_EVENTS (anything else becomes 'other')
 * @param array  $opts  count(int), meta(array), source('backend'|'frontend'),
 *                      ip, userAgent, page
 * @return bool whether the line was written (best-effort; never throws)
 */
function log_activity($email, $event, $opts = []) {
    try {
        $event = actlog_clean_event($event);

        $meta = actlog_strip_secrets(is_array($opts['meta'] ?? null) ? $opts['meta'] : []);
        $metaJson = json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($metaJson === false || strlen($metaJson) > ACTLOG_MAX_META) {
            $meta = ['_note' => 'meta dropped (too large or unencodable)'];
        }

        $entry = [
            'ts'        => (new DateTime('now', new DateTimeZone('Asia/Kolkata')))->format('c'),
            'app'       => ACTLOG_APP,
            'email'     => actlog_clamp($email !== '' ? $email : 'anonymous', ACTLOG_MAX_FIELD),
            'event'     => $event,
            'count'     => (int) ($opts['count'] ?? 0),
            'source'    => ($opts['source'] ?? 'backend') === 'frontend' ? 'frontend' : 'backend',
            'meta'      => $meta,
            'page'      => actlog_clamp($opts['page'] ?? ($_SERVER['REQUEST_URI'] ?? ''), ACTLOG_MAX_FIELD),
            'userAgent' => actlog_clamp($opts['userAgent'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? ''), ACTLOG_MAX_FIELD),
            'ip'        => actlog_clamp($opts['ip'] ?? ($_SERVER['REMOTE_ADDR'] ?? ''), 64),
        ];

        $line = json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($line === false) {
            $line = json_encode(['ts' => $entry['ts'], 'event' => $event, 'email' => $entry['email'], '_note' => 'unencodable entry']);
        }

        $date = date('Y-m-d');
        $dayDir = actlog_ensure_dir($date);
        if ($dayDir !== false) {
            $file = $dayDir . '/activity.log';   // logs/YYYY-MM-DD/activity.log
            if (@file_put_contents($file, $line . "\n", FILE_APPEND | LOCK_EX) !== false) {
                return true;
            }
        }
        // Fallback: nginx/php error log still captures it (never lose the event silently)
        @error_log('[actlog-fallback] ' . $line);
        return false;
    } catch (Throwable $e) {
        @error_log('[actlog-failed] ' . $e->getMessage() . ' | event: ' . (string) $event);
        return false;
    }
}
