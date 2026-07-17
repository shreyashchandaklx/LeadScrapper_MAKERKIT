<?php
/**
 * lib/error_logger.php
 *
 * Self-hosted error logger for Lead Scrapper (app "LS").
 * Writes one JSON line per error to logs/errors-YYYY-MM-DD.log and returns a
 * short Error ID (e.g. "ERR-LS-LEAD-LXK9F2-A7F3") that callers show to the user.
 *
 * Usage:
 *   require_once __DIR__ . '/error_logger.php';   // from a proxy in project root: lib/error_logger.php
 *   $id = log_error('LEAD', 'Apify run timed out', [
 *       'user'      => 'foo@bar.com',
 *       'action'    => 'startRun',
 *       'context'   => ['searchString' => 'dentists in Pune'],
 *       'stack'     => $e->getTraceAsString(),   // optional
 *       'errorId'   => null,                      // optional: reuse a client-generated ID
 *       'source'    => 'backend',                 // default 'backend'
 *   ]);
 *
 * Design rules (see log_errors.md):
 *   - NEVER throws. Logging must never break the actual request.
 *   - Secrets are stripped from context before writing.
 *   - logs/ + .htaccess are auto-created on first write.
 *   - Timestamps in IST (+05:30).
 */

const ERRLOG_APP     = 'LS';
const ERRLOG_DIR     = __DIR__ . '/../logs';
const ERRLOG_MODULES = ['LEAD', 'MGR', 'RPT', 'BILL', 'GEN'];

/** Max sizes so one entry can never bloat the file. */
const ERRLOG_MAX_MESSAGE = 2048;   // 2 KB
const ERRLOG_MAX_STACK   = 4096;   // 4 KB
const ERRLOG_MAX_CONTEXT = 2048;   // 2 KB (after json_encode)
const ERRLOG_MAX_FIELD   = 256;    // user/page/component/action/etc.

/**
 * Generate an Error ID: ERR-LS-<MODULE>-<TIME36>-<RAND4>
 * Same shape as the frontend generator in utils/errorLogger.js.
 */
function errlog_generate_id($module) {
    $module = errlog_clean_module($module);
    $time36 = strtoupper(base_convert((string) round(microtime(true) * 1000), 10, 36));
    $rand   = strtoupper(substr(bin2hex(random_bytes(3)), 0, 4));
    return "ERR-" . ERRLOG_APP . "-{$module}-{$time36}-{$rand}";
}

/** Normalize/validate a module tag; unknown tags fall back to GEN. */
function errlog_clean_module($module) {
    $module = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $module));
    return in_array($module, ERRLOG_MODULES, true) ? $module : 'GEN';
}

/** Recursively remove secret-ish keys from a context array. */
function errlog_strip_secrets($value, $depth = 0) {
    if ($depth > 4) return '[depth-limit]';
    if (!is_array($value)) return $value;
    $out = [];
    foreach ($value as $k => $v) {
        if (is_string($k) && preg_match('/api[_-]?key|token|authorization|password|secret|service[_-]?key|bearer/i', $k)) {
            $out[$k] = '[redacted]';
        } else {
            $out[$k] = errlog_strip_secrets($v, $depth + 1);
        }
    }
    return $out;
}

/** Clamp a string field to a max length (UTF-8 safe enough for logs). */
function errlog_clamp($s, $max) {
    $s = (string) $s;
    return strlen($s) > $max ? substr($s, 0, $max) . '…[truncated]' : $s;
}

/**
 * Ensure logs/ + today's dated subfolder exist and are protected. Never throws.
 * Layout: logs/YYYY-MM-DD/error.log (+ activity.log written by activity_logger.php).
 * @param string $date  YYYY-MM-DD (the dated subfolder)
 * @return string|false  the usable dated dir path, or false if not writable
 */
function errlog_ensure_dir($date) {
    if (!is_dir(ERRLOG_DIR)) {
        if (!@mkdir(ERRLOG_DIR, 0755, true)) return false;
    }
    // Deny-all at the logs/ root covers all dated subfolders (nginx needs its own
    // rule too — see log_errors.md §2).
    $ht = ERRLOG_DIR . '/.htaccess';
    if (!file_exists($ht)) {
        @file_put_contents($ht, "Require all denied\nDeny from all\n");
    }
    $dayDir = ERRLOG_DIR . '/' . $date;
    if (!is_dir($dayDir)) {
        if (!@mkdir($dayDir, 0755, true)) return false;
    }
    return is_writable($dayDir) ? $dayDir : false;
}

/**
 * Write one error to the daily log file.
 *
 * @param string $module  LEAD|MGR|RPT|BILL|GEN (anything else becomes GEN)
 * @param string $message human-readable error message
 * @param array  $opts    user, page, component, action, context (array), stack,
 *                        source ('backend'|'frontend'), errorId (reuse), ip, userAgent
 * @return string the Error ID (always returned, even if the disk write failed)
 */
function log_error($module, $message, $opts = []) {
    try {
        $module = errlog_clean_module($module);
        $id = (is_string($opts['errorId'] ?? null) && preg_match('/^ERR-[A-Z]{2}-[A-Z]{2,6}-[A-Z0-9]{6,10}-[A-Z0-9]{4}$/', $opts['errorId']))
            ? $opts['errorId']
            : errlog_generate_id($module);

        $context = errlog_strip_secrets(is_array($opts['context'] ?? null) ? $opts['context'] : []);
        $contextJson = json_encode($context, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($contextJson === false || strlen($contextJson) > ERRLOG_MAX_CONTEXT) {
            $context = ['_note' => 'context dropped (too large or unencodable)'];
        }

        $entry = [
            'id'        => $id,
            'ts'        => (new DateTime('now', new DateTimeZone('Asia/Kolkata')))->format('c'),
            'app'       => ERRLOG_APP,
            'module'    => $module,
            'source'    => ($opts['source'] ?? 'backend') === 'frontend' ? 'frontend' : 'backend',
            'user'      => errlog_clamp($opts['user'] ?? 'anonymous', ERRLOG_MAX_FIELD),
            'page'      => errlog_clamp($opts['page'] ?? ($_SERVER['REQUEST_URI'] ?? ''), ERRLOG_MAX_FIELD),
            'component' => errlog_clamp($opts['component'] ?? basename($_SERVER['SCRIPT_NAME'] ?? ''), ERRLOG_MAX_FIELD),
            'action'    => errlog_clamp($opts['action'] ?? '', ERRLOG_MAX_FIELD),
            'message'   => errlog_clamp($message, ERRLOG_MAX_MESSAGE),
            'stack'     => errlog_clamp($opts['stack'] ?? '', ERRLOG_MAX_STACK),
            'context'   => $context,
            'userAgent' => errlog_clamp($opts['userAgent'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? ''), ERRLOG_MAX_FIELD),
            'ip'        => errlog_clamp($opts['ip'] ?? ($_SERVER['REMOTE_ADDR'] ?? ''), 64),
        ];

        $line = json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($line === false) {
            // last-resort minimal entry
            $line = json_encode(['id' => $id, 'module' => $module, 'message' => '[unencodable error entry]']);
        }

        $date = date('Y-m-d');
        $dayDir = errlog_ensure_dir($date);
        if ($dayDir !== false) {
            $file = $dayDir . '/error.log';   // logs/YYYY-MM-DD/error.log
            // LOCK_EX so two simultaneous requests can't interleave lines
            if (@file_put_contents($file, $line . "\n", FILE_APPEND | LOCK_EX) !== false) {
                return $id;
            }
        }
        // Fallback: nginx/php error log still captures it, ID stays searchable
        @error_log('[errlog-fallback] ' . $line);
        return $id;
    } catch (Throwable $e) {
        // Absolute last resort — never let logging take down the request
        $fallback = 'ERR-' . ERRLOG_APP . '-GEN-FALLBACK-0000';
        @error_log('[errlog-failed] ' . $e->getMessage() . ' | original: ' . (string) $message);
        return $fallback;
    }
}
