<?php
/**
 * supabase_cache.php - Supabase-backed universal cache for the lead scraper.
 *
 * Uses the EXISTING `leadscrapper_leads_data` table with reserved system emails:
 *   - UserEmail = '__cache__'   → cached search-result rows
 *   - UserEmail = '__pending__' → transient pending-serve mappings
 *
 * Cache rows reuse the same columns (Title, Address, Phone, PlaceId, etc.)
 * so no new table or schema changes are needed.
 *
 * Cache lookup key is stored in `SearchString` (keyword|location format).
 * TTL is checked via `CreatedAt`.
 */

require_once __DIR__ . '/supabase.php';

class SupabaseCache {
    const TABLE         = 'leadscrapper_leads_data';
    const CACHE_EMAIL   = '__cache__';
    const PENDING_EMAIL = '__pending__';

    /* ================================================================
     * QUERY CACHE — stores raw Apify place results for reuse
     * ================================================================ */

    /**
     * Look up cached places for a given search (cacheKey = keyword|location).
     * Returns { places: [...], scrapedAt: epoch } or null if miss.
     */
    public function getQuery($cacheKey) {
        $q = 'UserEmail=eq.' . urlencode(self::CACHE_EMAIL)
           . '&SearchString=eq.' . urlencode($cacheKey)
           . '&order=Rank.asc'
           . '&limit=9999';
        $res = sb_select(self::TABLE, $q);

        if ($res['status'] >= 400 || !is_array($res['json']) || empty($res['json'])) {
            return null;
        }

        // Derive scrapedAt from the newest CreatedAt in the batch
        $maxTs = 0;
        $places = [];
        foreach ($res['json'] as $row) {
            $places[] = $this->rowToPlace($row);
            $ts = strtotime($row['CreatedAt'] ?? '1970-01-01');
            if ($ts > $maxTs) $maxTs = $ts;
        }

        return [
            'places'    => $places,
            'scrapedAt' => $maxTs,
        ];
    }

    /**
     * Save (upsert) an array of places into the cache under a given key.
     */
    public function setQuery($cacheKey, $entry) {
        $places = $entry['places'] ?? [];
        if (empty($places)) return true;

        $now  = date('c'); // ISO-8601
        $rows = [];
        foreach ($places as $idx => $p) {
            $rows[] = $this->placeToRow($p, $cacheKey, $idx + 1, $now);
        }

        // Batch upsert in chunks of 200
        foreach (array_chunk($rows, 200) as $chunk) {
            $res = sb_insert(self::TABLE, $chunk, 'UserEmail,PlaceId');
            if ($res['status'] >= 400) {
                error_log('[SupabaseCache::setQuery] upsert failed: ' . ($res['raw'] ?? ''));
                return false;
            }
        }
        return true;
    }

    /**
     * Merge new places into existing cache (deduped by PlaceId).
     */
    public function mergePlaces($cacheKey, $newPlaces) {
        $existing = $this->getQuery($cacheKey);
        $places   = $existing ? ($existing['places'] ?? []) : [];

        $seen = [];
        foreach ($places as $p) {
            $pid = $p['placeId'] ?? null;
            if ($pid) $seen[$pid] = true;
        }

        $added = false;
        foreach ($newPlaces as $p) {
            if (!is_array($p)) continue;
            $pid = $p['placeId'] ?? null;
            if ($pid && isset($seen[$pid])) continue;
            $places[] = $p;
            if ($pid) $seen[$pid] = true;
            $added = true;
        }

        if ($added) {
            $this->setQuery($cacheKey, [
                'places'    => $places,
                'scrapedAt' => time(),
            ]);
        }
    }

    /* ================================================================
     * PENDING SERVES — map cached runIds to cache keys
     * ================================================================ */

    public function getPendingServe($runId) {
        $q = 'UserEmail=eq.' . urlencode(self::PENDING_EMAIL)
           . '&PlaceId=eq.' . urlencode($runId)
           . '&limit=1';
        $res = sb_select(self::TABLE, $q);

        if ($res['status'] >= 400 || empty($res['json'])) return null;

        $row = $res['json'][0];
        return [
            'cacheKey'  => $row['SearchString'] ?? '',
            'createdAt' => strtotime($row['CreatedAt'] ?? 'now'),
        ];
    }

    public function setPendingServe($runId, $meta) {
        $row = [
            'UserEmail'         => self::PENDING_EMAIL,
            'PlaceId'           => $runId,
            'SearchString'      => $meta['cacheKey'] ?? '',
            'Title'             => 'pending_serve',
            'Phone'             => '',
            'ClaimThisBusiness' => 'false',
            'IsAdvertisement'   => 'false',
            'CreatedAt'         => date('c'),
        ];
        $res = sb_insert(self::TABLE, [$row], 'UserEmail,PlaceId');
        return $res['status'] < 400;
    }

    public function deletePendingServe($runId) {
        $q = 'UserEmail=eq.' . urlencode(self::PENDING_EMAIL)
           . '&PlaceId=eq.' . urlencode($runId);
        $res = sb_delete(self::TABLE, $q);
        return $res['status'] < 400;
    }

    /* ================================================================
     * ADMIN / STATS
     * ================================================================ */

    /**
     * Get all cache data — same shape the old Firebase cache returned.
     */
    public function getAll() {
        // Queries
        $q = 'UserEmail=eq.' . urlencode(self::CACHE_EMAIL) . '&limit=9999';
        $res = sb_select(self::TABLE, $q);
        $queries = [];
        if ($res['status'] < 400 && is_array($res['json'])) {
            foreach ($res['json'] as $row) {
                $key = $row['SearchString'] ?? '';
                if ($key === '') continue;
                if (!isset($queries[$key])) {
                    $queries[$key] = ['places' => [], 'scrapedAt' => 0];
                }
                $queries[$key]['places'][] = $this->rowToPlace($row);
                $ts = strtotime($row['CreatedAt'] ?? '1970-01-01');
                if ($ts > $queries[$key]['scrapedAt']) {
                    $queries[$key]['scrapedAt'] = $ts;
                }
            }
        }

        // Pending serves
        $q2 = 'UserEmail=eq.' . urlencode(self::PENDING_EMAIL) . '&limit=500';
        $res2 = sb_select(self::TABLE, $q2);
        $pendingServes = [];
        if ($res2['status'] < 400 && is_array($res2['json'])) {
            foreach ($res2['json'] as $row) {
                $pendingServes[$row['PlaceId']] = [
                    'cacheKey'  => $row['SearchString'] ?? '',
                    'createdAt' => strtotime($row['CreatedAt'] ?? 'now'),
                ];
            }
        }

        return ['queries' => $queries, 'pendingServes' => $pendingServes];
    }

    public function setAll($cache) {
        // Just delegate to setQuery for each entry
        foreach (($cache['queries'] ?? []) as $key => $entry) {
            $this->setQuery($key, $entry);
        }
        foreach (($cache['pendingServes'] ?? []) as $runId => $meta) {
            $this->setPendingServe($runId, $meta);
        }
        return true;
    }

    /**
     * Clear all cache and pending-serve rows (leaves real user leads untouched).
     */
    public function clear() {
        $q1 = 'UserEmail=eq.' . urlencode(self::CACHE_EMAIL);
        $q2 = 'UserEmail=eq.' . urlencode(self::PENDING_EMAIL);
        sb_delete(self::TABLE, $q1);
        sb_delete(self::TABLE, $q2);
        return true;
    }

    /**
     * Cache statistics.
     */
    public function getStats() {
        $all = $this->getAll();
        return [
            'totalQueries'       => count($all['queries'] ?? []),
            'totalPendingServes' => count($all['pendingServes'] ?? []),
            'queries'            => array_map(function ($q) {
                return [
                    'count'     => count($q['places'] ?? []),
                    'scrapedAt' => $q['scrapedAt'] ?? null,
                ];
            }, $all['queries'] ?? []),
        ];
    }

    /* ================================================================
     * INTERNAL — row ↔ place conversion
     * ================================================================ */

    /**
     * Convert a Supabase row back to a raw Apify-style place object.
     */
    private function rowToPlace($row) {
        $parseMaybe = function ($v) {
            if (is_array($v)) return $v;
            if (is_string($v) && strlen($v) > 0) {
                $d = json_decode($v, true);
                if (json_last_error() === JSON_ERROR_NONE) return $d;
            }
            return $v;
        };

        return [
            'title'              => $row['Title'] ?? '',
            'price'              => $row['Price'] ?? null,
            'categoryName'       => $row['CategoryName'] ?? '',
            'address'            => $row['Address'] ?? '',
            'neighborhood'       => $row['Neighborhood'] ?? '',
            'street'             => $row['Street'] ?? '',
            'city'               => $row['City'] ?? '',
            'postalCode'         => $row['PostalCode'] ?? '',
            'state'              => $row['State'] ?? '',
            'countryCode'        => $row['CountryCode'] ?? '',
            'phone'              => $row['Phone'] ?? '',
            'phoneUnformatted'   => $row['PhoneUnformatted'] ?? '',
            'claimThisBusiness'  => ($row['ClaimThisBusiness'] === false || $row['ClaimThisBusiness'] === 'false') ? false : true,
            'cid'                => $row['Cid'] ?? '',
            'location'           => $parseMaybe($row['Location'] ?? null),
            'totalScore'         => $row['TotalScore'] ?? null,
            'reviewsCount'       => (int) ($row['ReviewsCount'] ?? 0),
            'imagesCount'        => (int) ($row['ImagesCount'] ?? 0),
            'imageCategories'    => $parseMaybe($row['ImageCategories'] ?? []),
            'peopleAlsoSearch'   => $parseMaybe($row['PeopleAlsoSearch'] ?? []),
            'placesTags'         => $parseMaybe($row['PlacesTags'] ?? []),
            'reviewsTags'        => $parseMaybe($row['ReviewsTags'] ?? []),
            'gasPrices'          => $parseMaybe($row['GasPrices'] ?? []),
            'googleFoodUrl'      => $row['GoogleFoodUrl'] ?? null,
            'hotelAds'           => $parseMaybe($row['HotelAds'] ?? []),
            'openingHours'       => $parseMaybe($row['OpeningHours'] ?? []),
            'url'                => $row['Url'] ?? '',
            'searchPageUrl'      => $row['SearchPageUrl'] ?? '',
            'searchString'       => $row['SearchString'] ?? '',
            'language'           => $row['Language'] ?? '',
            'rank'               => (int) ($row['Rank'] ?? 0),
            'isAdvertisement'    => ($row['IsAdvertisement'] === true || $row['IsAdvertisement'] === 'true'),
            'imageUrl'           => $row['ImageUrl'] ?? '',
            'kgmid'              => $row['Kgmid'] ?? '',
            'website'            => $row['Website'] ?? '',
            'additionalInfo'     => $parseMaybe($row['AdditionalInfo'] ?? null),
            'reviewsDistribution' => $parseMaybe($row['ReviewsDistribution'] ?? null),
            'additionalOpeningHours' => $parseMaybe($row['AdditionalOpeningHours'] ?? null),
            'description'        => $row['Description'] ?? null,
            'locatedIn'          => $row['LocatedIn'] ?? null,
            'placeId'            => $row['PlaceId'] ?? '',
        ];
    }

    /**
     * Convert a raw Apify-style place to a Supabase row for caching.
     */
    private function placeToRow($p, $cacheKey, $rank, $createdAt) {
        $jsonEncode = function ($v) {
            if (is_array($v) || is_object($v)) return json_encode($v);
            return $v;
        };

        $trunc = function($v, $len = 255) {
            if ($v === null) return null;
            if (strlen((string)$v) <= $len) return $v;
            return substr((string)$v, 0, $len - 3) . '...';
        };

        // Cast to bigint-safe value: '' / null → null, otherwise int.
        // Postgres rejects empty strings for bigint columns ("22P02").
        $bigintOrNull = function ($v) {
            if ($v === null || $v === '' || $v === false) return null;
            if (is_numeric($v)) return (int) $v;
            return null;
        };

        // Cast to numeric/float-safe value: '' / null → null.
        $floatOrNull = function ($v) {
            if ($v === null || $v === '' || $v === false) return null;
            if (is_numeric($v)) return (float) $v;
            return null;
        };

        return [
            'UserEmail'             => self::CACHE_EMAIL,
            'PlaceId'               => $p['placeId'] ?? ('synth_' . md5(($p['title'] ?? '') . $rank)),
            'Title'                 => $trunc($p['title'] ?? '', 255),
            'Price'                 => $trunc($p['price'] ?? null, 50),
            'CategoryName'          => $trunc($p['categoryName'] ?? '', 255),
            'Address'               => $trunc($p['address'] ?? '', 500),
            'Neighborhood'          => $trunc($p['neighborhood'] ?? '', 255),
            'Street'                => $trunc($p['street'] ?? '', 255),
            'City'                  => $trunc($p['city'] ?? '', 255),
            // PostalCode column is bigint in the live schema — '' fails the cast.
            'PostalCode'            => $bigintOrNull($p['postalCode'] ?? null),
            'State'                 => $trunc($p['state'] ?? '', 100),
            'CountryCode'           => $trunc($p['countryCode'] ?? '', 10),
            'Phone'                 => $trunc($p['phone'] ?? '', 50),
            // PhoneUnformatted column is bigint — '' fails the cast.
            'PhoneUnformatted'      => $bigintOrNull($p['phoneUnformatted'] ?? null),
            'ClaimThisBusiness'     => isset($p['claimThisBusiness']) ? ($p['claimThisBusiness'] === false ? false : true) : true,
            // Cid is text in the schema, plain truncate is fine.
            'Cid'                   => $trunc($p['cid'] ?? null, 100),
            'Location'              => $jsonEncode($p['location'] ?? null),
            // TotalScore is double precision — '' would fail.
            'TotalScore'            => $floatOrNull($p['totalScore'] ?? null),
            'ReviewsCount'          => (int) ($p['reviewsCount'] ?? 0),
            'ImagesCount'           => (int) ($p['imagesCount'] ?? 0),
            'ImageCategories'       => $jsonEncode($p['imageCategories'] ?? []),
            'PeopleAlsoSearch'      => $jsonEncode($p['peopleAlsoSearch'] ?? []),
            'PlacesTags'            => $jsonEncode($p['placesTags'] ?? []),
            'ReviewsTags'           => $jsonEncode($p['reviewsTags'] ?? []),
            'GasPrices'             => $jsonEncode($p['gasPrices'] ?? []),
            'GoogleFoodUrl'         => $trunc($p['googleFoodUrl'] ?? null, 1000),
            'HotelAds'              => $jsonEncode($p['hotelAds'] ?? []),
            'OpeningHours'          => $jsonEncode($p['openingHours'] ?? []),
            'Url'                   => $trunc($p['url'] ?? '', 1000),
            'SearchPageUrl'         => $trunc($p['searchPageUrl'] ?? '', 1000),
            'SearchString'          => $trunc($cacheKey, 500),
            'Language'              => $trunc($p['language'] ?? '', 10),
            'Rank'                  => $rank,
            'IsAdvertisement'       => ($p['isAdvertisement'] ?? false) ? true : false,
            'ImageUrl'              => $trunc($p['imageUrl'] ?? '', 1000),
            'Kgmid'                 => $trunc($p['kgmid'] ?? '', 100),
            'Website'               => $trunc($p['website'] ?? '', 500),
            'AdditionalInfo'        => $jsonEncode($p['additionalInfo'] ?? null),
            'ReviewsDistribution'   => $jsonEncode($p['reviewsDistribution'] ?? null),
            'AdditionalOpeningHours' => $jsonEncode($p['additionalOpeningHours'] ?? null),
            'Description'           => $trunc($p['description'] ?? null, 2000),
            'LocatedIn'             => $trunc($p['locatedIn'] ?? null, 255),
            'CreatedAt'             => $createdAt,
        ];
    }
}

/**
 * Singleton accessor — drop-in replacement for getFirebaseCache().
 */
function getSupabaseCache() {
    static $instance = null;
    if ($instance === null) {
        $instance = new SupabaseCache();
    }
    return $instance;
}
