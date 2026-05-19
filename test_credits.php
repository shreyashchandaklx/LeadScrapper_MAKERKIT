<?php
require_once __DIR__ . '/lib/credits.php';

// Simulate cache (224 items)
$allPlaces = [];
$extrasIDs = [];
$balance = 10;

$slice1 = credits_compute_slice($allPlaces, $deliveredIDs, $extrasIDs, $balance);
echo "Run 1 extrasRemaining: " . $slice1['extrasRemaining'] . "\n";
echo "Run 1 extrasUsed: " . count($slice1['extrasUsed']) . "\n";
echo "Run 1 newOverflow: " . count($slice1['newOverflow']) . "\n";
echo "Run 1 places: " . count($slice1['places']) . "\n";

// simulate run 2
$deliveredIDs = [];
foreach ($slice1['places'] as $p) {
    $deliveredIDs[] = $p['placeId'];
}
$extrasIDs = $slice1['newOverflow'];

$slice2 = credits_compute_slice($allPlaces, $deliveredIDs, $extrasIDs, $balance);
echo "Run 2 extrasRemaining: " . $slice2['extrasRemaining'] . "\n";
echo "Run 2 extrasUsed: " . count($slice2['extrasUsed']) . "\n";
echo "Run 2 newOverflow: " . count($slice2['newOverflow']) . "\n";
echo "Run 2 places: " . count($slice2['places']) . "\n";

// simulate run 3
$deliveredIDs = array_merge($deliveredIDs, array_map(function($p){return $p['placeId'];}, $slice2['places']));
$extrasIDs = array_merge(array_diff($extrasIDs, $slice2['extrasUsed']), $slice2['newOverflow']);

$slice3 = credits_compute_slice($allPlaces, $deliveredIDs, $extrasIDs, $balance);
echo "Run 3 extrasRemaining: " . $slice3['extrasRemaining'] . "\n";
echo "Run 3 extrasUsed: " . count($slice3['extrasUsed']) . "\n";
echo "Run 3 newOverflow: " . count($slice3['newOverflow']) . "\n";
echo "Run 3 places: " . count($slice3['places']) . "\n";
