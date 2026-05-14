<?php
/**
 * YOURLS URL Shortener Proxy
 *
 * Usage from automation.php:
 *   require_once 'shorten-url.php';
 *   $shortUrl = shortenUrl("https://long-github-url.com/...");
 *
 * Or call directly via GET/POST:
 *   shorten-url.php?url=https://long-url.com
 */

// ─── YOURLS Configuration ───
define('YOURLS_API_URL', 'https://pixnom.com/demo/yourls-api.php');
define('YOURLS_SIGNATURE', '205c371093');

/**
 * Shorten a single URL using YOURLS API
 * Returns the short URL on success, or the original URL on failure (safe fallback)
 */
function shortenUrl($longUrl, $keyword = '', $title = '') {
    if (empty($longUrl)) return $longUrl;

    $params = [
        'signature' => YOURLS_SIGNATURE,
        'action'    => 'shorturl',
        'format'    => 'json',
        'url'       => $longUrl
    ];

    if (!empty($keyword)) $params['keyword'] = $keyword;
    if (!empty($title))   $params['title']   = $title;

    $apiUrl = YOURLS_API_URL . '?' . http_build_query($params);

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $apiUrl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($error || $httpCode < 200 || $httpCode >= 300) {
        // Fallback: return original URL so nothing breaks
        return $longUrl;
    }

    $data = json_decode($response, true);

    if (isset($data['shorturl'])) {
        return $data['shorturl'];
    }

    // URL may already exist in YOURLS — check for that case
    if (isset($data['url']['shorturl'])) {
        return $data['url']['shorturl'];
    }

    // Fallback: return original
    return $longUrl;
}

/**
 * Shorten multiple URLs at once
 * Input:  ['tier1' => 'https://...', 'tier2' => 'https://...', 'tier3' => 'https://...']
 * Output: ['tier1' => 'https://short/...', 'tier2' => 'https://short/...', 'tier3' => 'https://short/...']
 */
function shortenTierUrls($tierUrls) {
    $result = [];
    foreach ($tierUrls as $key => $url) {
        $result[$key] = shortenUrl($url);
    }
    return $result;
}

// ─── Direct API mode (when called via HTTP) ───
if (php_sapi_name() !== 'cli' && basename($_SERVER['SCRIPT_FILENAME']) === basename(__FILE__)) {
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');

    $url = $_GET['url'] ?? $_POST['url'] ?? '';

    if (empty($url)) {
        echo json_encode(['success' => false, 'error' => 'Missing "url" parameter']);
        exit;
    }

    $shortUrl = shortenUrl($url);

    echo json_encode([
        'success'   => true,
        'original'  => $url,
        'shorturl'  => $shortUrl
    ]);
}
