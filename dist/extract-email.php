<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$url = isset($_GET['url']) ? trim($_GET['url']) : '';

if (!$url) {
    echo json_encode(['success' => false, 'error' => 'Missing url parameter']);
    exit;
}

// Ensure URL has a scheme
if (!preg_match('#^https?://#i', $url)) {
    $url = 'https://' . $url;
}

// Validate URL
if (!filter_var($url, FILTER_VALIDATE_URL)) {
    echo json_encode(['success' => false, 'error' => 'Invalid URL']);
    exit;
}

// Domains to filter out (false positives)
$blacklistDomains = [
    'wixpress.com', 'sentry.io', 'w3.org', 'schema.org', 'googleapis.com',
    'google.com', 'facebook.com', 'twitter.com', 'example.com', 'yourdomain.com',
    'domain.com', 'email.com', 'test.com', 'wordpress.org', 'jquery.com',
    'cloudflare.com', 'gstatic.com', 'gravatar.com', 'wp.com',
    'squarespace.com', 'wix.com', 'weebly.com', 'godaddy.com',
];

// File extensions to filter out
$blacklistExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'css', 'js', 'woff', 'woff2', 'ttf', 'eot', 'map'];

function fetchPage($url) {
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 5,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER => [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: en-US,en;q=0.5',
        ],
    ]);
    $html = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode >= 200 && $httpCode < 400 && $html) {
        return $html;
    }
    return false;
}

function extractEmails($html) {
    $emails = [];

    // Extract from mailto: links
    if (preg_match_all('/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i', $html, $matches)) {
        $emails = array_merge($emails, $matches[1]);
    }

    // Extract via general email regex
    if (preg_match_all('/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/', $html, $matches)) {
        $emails = array_merge($emails, $matches[0]);
    }

    // Normalize and deduplicate
    $emails = array_map('strtolower', $emails);
    $emails = array_unique($emails);

    return array_values($emails);
}

function filterEmails($emails, $blacklistDomains, $blacklistExtensions) {
    return array_values(array_filter($emails, function($email) use ($blacklistDomains, $blacklistExtensions) {
        $parts = explode('@', $email);
        if (count($parts) !== 2) return false;

        $local = $parts[0];
        $domain = $parts[1];

        // Filter blacklisted domains
        foreach ($blacklistDomains as $bd) {
            if (stripos($domain, $bd) !== false) return false;
        }

        // Filter file extensions in local part (e.g., image@2x.png)
        $ext = pathinfo($email, PATHINFO_EXTENSION);
        if (in_array(strtolower($ext), $blacklistExtensions)) return false;

        // Filter very short or suspicious local parts
        if (strlen($local) < 2) return false;

        // Filter common non-person emails
        $skipLocals = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster'];
        if (in_array(strtolower($local), $skipLocals)) return false;

        return true;
    }));
}

// Try homepage first
$html = fetchPage($url);
$source = 'homepage';
$emails = [];

if ($html) {
    $emails = extractEmails($html);
    $emails = filterEmails($emails, $blacklistDomains, $blacklistExtensions);
}

// If no emails found on homepage, try common subpages
if (empty($emails)) {
    $parsed = parse_url($url);
    $baseUrl = $parsed['scheme'] . '://' . $parsed['host'];
    $subpages = ['/contact', '/contact-us', '/about', '/about-us'];

    foreach ($subpages as $page) {
        $pageUrl = $baseUrl . $page;
        $html = fetchPage($pageUrl);
        if ($html) {
            $emails = extractEmails($html);
            $emails = filterEmails($emails, $blacklistDomains, $blacklistExtensions);
            if (!empty($emails)) {
                $source = ltrim($page, '/');
                break;
            }
        }
    }
}

echo json_encode([
    'success' => true,
    'emails' => array_values($emails),
    'source' => $source,
]);
