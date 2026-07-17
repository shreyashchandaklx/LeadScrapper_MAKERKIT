<?php
/**
 * lib/keyword_normalize.php
 *
 * ONE canonical keyword normalizer, shared by every place that builds a cache
 * key or a city job key, so "Electrician", "electrician ", and "electricians"
 * all collapse to the SAME key — one shared pool, one Apify scrape, billed once.
 *
 * ⚠️ CRITICAL: this MUST be applied identically in all three spots or a search
 * will store under one key and pull under another (cache miss → wasted Apify run):
 *   1. apify-proxy.php  buildCacheKey()      — where leads are stored + pulled
 *   2. city_scrape.php  cs_build_search_key() — city job dedup key
 *   3. city_scrape.php  cs_zip_cache_key()    — where the worker stores each ZIP
 *
 * Normalization (conservative):
 *   - lowercase, trim, collapse internal whitespace
 *   - strip a SINGLE trailing 's' (regular plural) so plumber/plumbers,
 *     dentist/dentists, electrician/electricians merge.
 *
 * LIMITATIONS (accepted): only regular "-s" plurals merge. Irregular plurals are
 * NOT merged (companies≠company, bakeries≠bakery, churches≠church). Words ending
 * in "ss" (business, address) are left intact. Very short words (≤3 after strip,
 * e.g. "gas") are left intact. The key need not be a real word — only consistent.
 */

if (!function_exists('normalize_keyword')) {
    function normalize_keyword($keyword)
    {
        $kw = strtolower(trim((string) $keyword));
        // collapse any run of whitespace to a single space
        $kw = preg_replace('/\s+/', ' ', $kw);
        if ($kw === '') return $kw;

        // Strip one trailing regular-plural 's', with guards:
        //   - not if it ends in "ss" (business, address, glass)
        //   - not if stripping would leave fewer than 3 chars (gas, bus)
        $len = strlen($kw);
        if ($len > 3 && $kw[$len - 1] === 's' && $kw[$len - 2] !== 's') {
            $kw = substr($kw, 0, $len - 1);
        }
        return $kw;
    }
}
