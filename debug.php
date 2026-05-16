<?php
header('Content-Type: application/json');
echo json_encode([
    'php_version' => PHP_VERSION,
    'display_errors' => ini_get('display_errors'),
    'error_reporting' => error_reporting(),
    'extensions' => [
        'curl' => extension_loaded('curl'),
        'json' => extension_loaded('json'),
        'mbstring' => extension_loaded('mbstring'),
    ],
    'files' => [
        'apify-proxy.php' => file_exists(__DIR__ . '/apify-proxy.php'),
        'lib/credits.php' => file_exists(__DIR__ . '/lib/credits.php'),
        'lib/supabase.php' => file_exists(__DIR__ . '/lib/supabase.php'),
        'lib/supabase_cache.php' => file_exists(__DIR__ . '/lib/supabase_cache.php'),
    ]
]);
