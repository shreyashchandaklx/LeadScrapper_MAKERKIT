<?php
/**
 * debug-cache.php — TEMPORARY diagnostic. Delete after debugging.
 *
 * Tries to write a single dummy place into the cache table and reports
 * exactly what Supabase says. Hit it directly:
 *   https://leadscrapper.pixnom.com/debug-cache.php
 */

header('Content-Type: application/json');
require_once __DIR__ . '/lib/supabase_cache.php';
require_once __DIR__ . '/lib/supabase.php';

$cache = getSupabaseCache();

$dummy = [
    'placeId'    => 'debug_' . substr(md5((string) microtime(true)), 0, 12),
    'title'      => 'DEBUG TEST PLACE',
    'address'    => 'Test address',
    'phone'      => '+1 555 0100',
    'website'    => 'https://example.com',
    'totalScore' => 4.5,
    'reviewsCount' => 10,
    'rank'       => 1,
    'placesTags' => [],
    'reviewsTags' => [],
    'imageCategories' => [],
    'peopleAlsoSearch' => [],
    'gasPrices' => [],
    'hotelAds' => [],
    'openingHours' => [],
];

$cacheKey = 'debug|cachekey|test';

// 1) Try setQuery
$entry = ['places' => [$dummy], 'scrapedAt' => time()];
$ok = $cache->setQuery($cacheKey, $entry);

// 2) Read back what we just wrote
$readBack = $cache->getQuery($cacheKey);

// 3) Also test the raw sb_insert response for the same row
$row = (new ReflectionClass('SupabaseCache'));
$placeToRowMethod = $row->getMethod('placeToRow');
$placeToRowMethod->setAccessible(true);
$builtRow = $placeToRowMethod->invoke($cache, $dummy, $cacheKey, 1, date('c'));

$rawInsert = sb_insert('leadscrapper_leads_data', [$builtRow], 'UserEmail,PlaceId');

echo json_encode([
    'setQuery_ok'   => $ok,
    'readBack_count' => is_array($readBack['places'] ?? null) ? count($readBack['places']) : 0,
    'readBack_first_title' => $readBack['places'][0]['title'] ?? null,
    'raw_insert_status' => $rawInsert['status'],
    'raw_insert_body'   => $rawInsert['raw'],
    'row_columns'   => array_keys($builtRow),
], JSON_PRETTY_PRINT);
