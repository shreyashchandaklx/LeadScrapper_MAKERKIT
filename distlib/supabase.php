<?php
/**
 * Minimal Supabase REST helper used by leads-proxy.php.
 * Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from .env.
 */

function sb_load_env() {
    static $loaded = null;
    if ($loaded !== null) return $loaded;
    $loaded = [];
    $envPath = __DIR__ . '/../.env';
    if (!file_exists($envPath)) return $loaded;
    $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || $line[0] === ';') continue;
        if (strpos($line, '=') === false) continue;
        list($k, $v) = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v);
        if (strlen($v) >= 2 && ($v[0] === '"' || $v[0] === "'") && substr($v, -1) === $v[0]) {
            $v = substr($v, 1, -1);
        }
        $loaded[$k] = $v;
    }
    return $loaded;
}

function sb_config() {
    $env = sb_load_env();
    return [
        'url' => rtrim($env['SUPABASE_URL'] ?? '', '/'),
        'key' => $env['SUPABASE_SERVICE_KEY'] ?? '',
    ];
}

/**
 * @param string $method  GET|POST|PATCH|DELETE
 * @param string $path    e.g. "leadscrapper_leads?user_email=eq.foo"
 * @param mixed  $body    array|null
 * @param array  $extraHeaders extra headers (e.g. Prefer: resolution=merge-duplicates)
 * @return array { status, json, raw }
 */
function sb_request($method, $path, $body = null, $extraHeaders = []) {
    $cfg = sb_config();
    if (!$cfg['url'] || !$cfg['key']) {
        return ['status' => 500, 'json' => null, 'raw' => 'SUPABASE_URL or SUPABASE_SERVICE_KEY missing in .env'];
    }
    $url = $cfg['url'] . '/rest/v1/' . ltrim($path, '/');
    $headers = [
        'apikey: ' . $cfg['key'],
        'Authorization: Bearer ' . $cfg['key'],
        'Content-Type: application/json',
        'Accept: application/json',
    ];
    foreach ($extraHeaders as $h) $headers[] = $h;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        $raw = curl_exec($ch);
        $err = curl_error($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false) {
            return ['status' => 500, 'json' => null, 'raw' => 'curl error: ' . $err];
        }
        $json = json_decode($raw, true);
        return ['status' => $code, 'json' => $json, 'raw' => $raw];
    }

    // Fallback when php-curl is not installed.
    $ctx = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headers),
            'content' => $body !== null ? json_encode($body) : '',
            'timeout' => 60,
            'ignore_errors' => true,
        ],
    ]);
    $raw = @file_get_contents($url, false, $ctx);
    $code = 0;
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
        }
    }
    if ($raw === false) {
        return ['status' => 500, 'json' => null, 'raw' => 'http stream error'];
    }
    $json = json_decode($raw, true);
    return ['status' => $code ?: 200, 'json' => $json, 'raw' => $raw];
}

function sb_select($table, $query = '') {
    $path = $table . ($query ? '?' . $query : '');
    return sb_request('GET', $path);
}

function sb_insert($table, $rows, $upsertOn = null) {
    // PostgREST requires multiple Prefer directives in a SINGLE header (comma-separated).
    // Sending two separate "Prefer:" headers causes only the last one to be used.
    if ($upsertOn) {
        $headers = ['Prefer: return=representation,resolution=merge-duplicates'];
    } else {
        $headers = ['Prefer: return=representation'];
    }
    $path = $table;
    if ($upsertOn) $path .= '?on_conflict=' . $upsertOn;
    return sb_request('POST', $path, $rows, $headers);
}

function sb_update($table, $query, $patch) {
    return sb_request('PATCH', $table . '?' . $query, $patch, ['Prefer: return=representation']);
}

function sb_delete($table, $query) {
    return sb_request('DELETE', $table . '?' . $query);
}
