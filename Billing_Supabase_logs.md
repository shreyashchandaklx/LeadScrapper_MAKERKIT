# Billing & Supabase Cache — Debug Session Log

**Date:** 2026-05-16
**Project:** Lead Scrapper PROD
**VPS:** `74.208.208.186` — `/var/www/leadscrapper.pixnom.com/`
**PHP:** 8.1 via `/var/run/php/php8.1-fpm.sock`
**Error log:** `/var/log/nginx/error.log`

---

## Problem Statement

After re-running the same lead search, the software was triggering Apify (full crawler run) instead of serving cached data. User wanted same queries to return instantly from cache (no Apify cost) and only use Apify on genuinely new keyword+location combinations.

Test case used:
- Keyword: `Lawyer`
- Location: `ZIP 411005, Pune, India`
- First run delivered 100 leads, queued 123 extras (out of 223 scraped)
- Subsequent re-runs were unexpectedly hitting Apify

---

## Root Causes Discovered

### 1. TTL gate on cache check

`apify-proxy.php` had:
```php
$hasValidCache = ($entry
    && isset($entry['places'])
    && !empty($entry['places'])
    && (time() - (int) $entry['scrapedAt']) < CACHE_TTL_SECONDS);
```

If cache age exceeded `CACHE_TTL_SECONDS` (or `scrapedAt` was stale), the gate failed and fell through to Apify.

**Fix:** Removed the TTL gate — cache is now permanent. Apify only called when cache has zero places.

```php
// Universal cache — once a cache_key has ANY entries, NEVER re-scrape.
$hasCache = ($entry && isset($entry['places']) && !empty($entry['places']));
if ($hasCache) { ... }
```

### 2. Cache writes silently failing — `22P02` bigint error

After deploying the TTL fix, cache still didn't populate. Query confirmed:
```sql
SELECT COUNT(*) FROM leadscrapper_leads_data
WHERE "UserEmail" = '__cache__'
  AND "SearchString" = 'lawyer|zip:411005|in';
-- 0
```

Nginx log revealed:
```
PHP message: [SupabaseCache::setQuery] upsert failed:
{"code":"22P02","details":null,"hint":null,
 "message":"invalid input syntax for type bigint: \"\""}
```

Postgres rejected empty string `""` for bigint columns. Schema inspection showed:

| Column | Type | Apify often returns |
|---|---|---|
| `PostalCode` | **bigint** | `""` |
| `PhoneUnformatted` | **bigint** | `""` |
| `TotalScore` | double precision | sometimes `""` |
| `ReviewsCount` | bigint | safe (code already int-casts) |
| `ImagesCount` | bigint | safe (code already int-casts) |
| `Cid` | text | safe |

**Fix:** Added `$bigintOrNull` and `$floatOrNull` helpers in `lib/supabase_cache.php` `placeToRow()` to convert `""` / non-numeric to `null` before insert.

```php
$bigintOrNull = function ($v) {
    if ($v === null || $v === '' || $v === false) return null;
    if (is_numeric($v)) return (int) $v;
    return null;
};

$floatOrNull = function ($v) {
    if ($v === null || $v === '' || $v === false) return null;
    if (is_numeric($v)) return (float) $v;
    return null;
};

// Applied to:
'PostalCode'        => $bigintOrNull($p['postalCode'] ?? null),
'PhoneUnformatted'  => $bigintOrNull($p['phoneUnformatted'] ?? null),
'TotalScore'        => $floatOrNull($p['totalScore'] ?? null),
```

### 3. Audit `source` label was wrong in edge cases

`leadscrapper_searches` showed `source = 'cache'` even when 100% of delivered leads came from the user's extras queue (because the run was technically served via the cache-hit code path).

**Fix:** Reworked the source-label logic in `applyCreditSlice` to inspect the actual composition of delivered leads:

```php
$deliveredCount = count($placesToDeliver);
$extrasCount    = count($slice['extrasUsed'] ?? []);
$newFromPool    = $deliveredCount - $extrasCount;

if ($deliveredCount === 0)              $effectiveSrc = $source;
else if ($extrasCount > 0 && $newFromPool > 0)  $effectiveSrc = 'mixed';
else if ($extrasCount > 0 && $newFromPool === 0) $effectiveSrc = 'extras';
else                                    $effectiveSrc = $source; // apify or cache
```

---

## Architecture Reference

### Tables and roles

| Table | Scope | Purpose |
|---|---|---|
| `leadscrapper_leads_data` (`UserEmail='__cache__'`) | **Shared / global** | Universal lead pool — Apify scraped once, all users read |
| `leadscrapper_leads_data` (`UserEmail='__pending__'`) | **Shared** | Transient runId → cache_key mapping for in-flight cached serves |
| `leadscrapper_leads_data` (user emails) | **Per user** | Leads saved to a user's Lead Manager |
| `leadscrapper_extras` | **Per user** | Queued overflow place_ids — leads scraped but capped by per-search 100 limit |
| `leadscrapper_delivered` | **Per user** | Ledger of leads already delivered to user (dedup prevention) |
| `leadscrapper_searches` | **Per user** | Audit log of every search with billing details |

### `leadscrapper_searches.source` values

- `apify` — first scrape for this `cache_key`; Apify was actually called
- `cache` — served from universal pool, delivered leads were new-to-user (not previously queued)
- `extras` — 100% of delivered leads came from this user's own extras queue
- `mixed` — single search pulled from BOTH the extras queue AND new pool entries

### Multi-user behavior

Cache is keyed by `keyword|location|country` only — NOT user. When User 2 runs a query User 1 already scraped:

1. Cache lookup finds existing pool → cache hit
2. Apify NOT called
3. User 2 gets up to 100 fresh leads (their `leadscrapper_delivered` is independent of User 1's)
4. User 2's overflow goes to User 2's own `leadscrapper_extras`
5. User 2 is billed per delivery at `CREDIT_PER_LEAD` (0.01)

**Economics:** 1 Apify scrape (~$0.93 for 224 leads) can be served unlimited times to unlimited users at 0.01 credit/lead.

### Lifecycle on re-search by the same user

```
Search #1 (apify):
  Apify scrape → save 224 to cache pool
  Deliver 100 to user → 124 place_ids queued in user's extras
  Pool: 224  ┃  User's extras: 124  ┃  User's delivered: 100

Search #2 (extras):
  User's extras has 124 → deliver first 100 → dequeue them
  Pool: 224  ┃  User's extras: 24   ┃  User's delivered: 200

Search #3 (extras):
  User's extras has 24 → deliver 24 → dequeue
  Pool: 224  ┃  User's extras: 0    ┃  User's delivered: 224

Search #4 (cache):
  Extras empty → check pool for ids not in delivered → 0 left
  Pool: 224  ┃  User's extras: 0    ┃  User's delivered: 224
  Result: delivered=0
```

---

## Files Modified

### `apify-proxy.php` (root + `dist/`)

1. **TTL gate removed** (~line 438) — cache is permanent.
2. **Source label logic reworked** (~line 247) — accurately tags `extras` / `mixed` / `cache` / `apify`.

### `lib/supabase_cache.php` (root + `dist/`)

1. **`$bigintOrNull` helper** added in `placeToRow()`.
2. **`$floatOrNull` helper** added in `placeToRow()`.
3. **`PostalCode`** changed from `$trunc(...)` to `$bigintOrNull(...)`.
4. **`PhoneUnformatted`** changed from `$trunc(...)` to `$bigintOrNull(...)`.
5. **`TotalScore`** changed from raw `?? null` to `$floatOrNull(...)`.

---

## Deployment Commands (Windows → VPS)

```powershell
# Upload changed files from local Windows
scp "D:\Lead Scrapper PROD\apify-proxy.php" `
    root@74.208.208.186:/var/www/leadscrapper.pixnom.com/apify-proxy.php

scp "D:\Lead Scrapper PROD\lib\supabase_cache.php" `
    root@74.208.208.186:/var/www/leadscrapper.pixnom.com/lib/supabase_cache.php

# Reload PHP-FPM (note: php8.1, not 8.2/8.3)
ssh root@74.208.208.186 "chown www-data:www-data /var/www/leadscrapper.pixnom.com/apify-proxy.php /var/www/leadscrapper.pixnom.com/lib/supabase_cache.php && systemctl reload php8.1-fpm"
```

### Verification after deploy

```bash
# Should output 3 — one helper definition + 2 usages
ssh root@74.208.208.186 "grep -c bigintOrNull /var/www/leadscrapper.pixnom.com/lib/supabase_cache.php"

# Should output the new $hasCache, not $hasValidCache
ssh root@74.208.208.186 "grep -n 'hasValidCache\|hasCache' /var/www/leadscrapper.pixnom.com/apify-proxy.php"

# Should be empty after running fresh searches
ssh root@74.208.208.186 "tail -50 /var/log/nginx/error.log | grep -i 22P02"
```

---

## Useful Diagnostic SQL

```sql
-- How many places are cached per query?
SELECT "SearchString", COUNT(*) AS places
FROM leadscrapper_leads_data
WHERE "UserEmail" = '__cache__'
GROUP BY "SearchString"
ORDER BY COUNT(*) DESC;

-- Inspect schema column types
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'leadscrapper_leads_data'
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Clean slate for a single user + cache_key (testing only)
DELETE FROM leadscrapper_delivered
WHERE user_email = 'shreyashchandak321@gmail.com'
  AND cache_key  = 'lawyer|zip:411005|in';

DELETE FROM leadscrapper_extras
WHERE user_email = 'shreyashchandak321@gmail.com'
  AND cache_key  = 'lawyer|zip:411005|in';

DELETE FROM leadscrapper_searches
WHERE user_email = 'shreyashchandak321@gmail.com'
  AND cache_key  = 'lawyer|zip:411005|in';

-- Wipe the universal cache (NUCLEAR — only for testing)
DELETE FROM leadscrapper_leads_data WHERE "UserEmail" = '__cache__';
DELETE FROM leadscrapper_leads_data WHERE "UserEmail" = '__pending__';
```

---

## SSH Notes

- First connection to a new server prompts to trust the host fingerprint — answer `yes` once, then SSH adds it to `~/.ssh/known_hosts` (`Warning: Permanently added ...` is informational, not an error).
- To avoid repeated password prompts, deploy an SSH key:

```powershell
# Generate key (one time)
ssh-keygen -t ed25519 -C "shreyashchandak321@gmail.com"

# Copy public key to VPS (one-time password entry)
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@74.208.208.186 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

---

## Outcome

✅ Same query → instant cache serve, no Apify run, correct per-delivery billing.
✅ Different users searching the same query → all served from the shared cache.
✅ `leadscrapper_searches.source` accurately reflects where the delivered leads came from.
✅ Schema constraints respected — no more `22P02` errors in nginx log.

---

## Follow-up Session (2026-05-17) — Dev email deduct bypass

### Problem

Logged in as the dev account `shreyashchandak.lx@gmail.com`. UI showed `9999.00 credits` but searches returned `Charged 0.00 credits for 0 leads (from cache) · 124 extras queued`. No leads delivered.

### Root cause

`makerkit-api-credits/get/route.ts` has an `isDevEmail(email)` short-circuit that returns `credits: 9999` for dev/owner emails, but `makerkit-api-credits/deduct-leads/route.ts` did NOT have the matching bypass. So:

- `credits_get_balance()` → 9999 (via the bypass in `get`)
- `credits_deduct_leads()` → hits real `user_credits` table → finds `Credits=0` for the dev account → returns `{success: false, reason: "insufficient", status: 402}`

`applyCreditSlice` then wiped `placesToDeliver` to `[]` but still queued the 124 overflow into `leadscrapper_extras`, leaving the user with 0 leads delivered and a corrupted-feeling queue.

### Fix #1 — `apify-proxy.php` `applyCreditSlice`

Don't mutate the extras queue when credit deduction fails. Surface the failure in the response.

```php
$deductionFailed = false;
$deductionError  = null;
if ($charge > 0) {
    $r = credits_deduct_leads($email, $leadCount);
    if (empty($r['ok'])) {
        error_log('[applyCreditSlice] credits_deduct_leads failed for ' . $email
            . ' status=' . ($r['status'] ?? '?')
            . ' body=' . json_encode($r));
        $placesToDeliver = [];
        $charge          = 0.0;
        $deductionFailed = true;
        $deductionError  = $r['error'] ?? $r['message'] ?? 'credit_deduction_failed';
    } else {
        // record delivered…
    }
}

// Only touch the extras queue if deduction succeeded.
if (!$deductionFailed) {
    if (!empty($slice['extrasUsed']))  credits_dequeue_extras(...);
    if (!empty($slice['newOverflow'])) credits_enqueue_extras(...);
}
```

Return shape now includes `deductionFailed` and `deductionError` so the UI can surface a clear message.

### Fix #2 — `makerkit-api-credits/deduct-leads/route.ts`

Add the same `isDevEmail` bypass that `get/route.ts` has:

```ts
import { cleanEmail, isDevEmail } from '../../_lib';

// after input validation:
if (isDevEmail(email)) {
  console.log(`[Deduct] Dev email "${email}" — bypassing deduction (charge=${charge}).`);
  return NextResponse.json({
    success: true,
    charged: 0,
    leadCount,
    remaining: 9999,
    isDev: true,
  });
}
```

### Dev-email list

Lives in `_lib.ts` (shared between `get` and `deduct-leads`):

```ts
export function isDevEmail(email: string): boolean {
  const devs: string[] = [
    'shreyashchandak.lx@gmail.com',
    'shriganeshkolhe@gmail.com',
  ];
  return devs.includes(email.toLowerCase());
}
```

Add new dev emails here — they automatically bypass both balance check and deduction.

### Deployment

Makerkit Next.js app on VPS:

```bash
scp "D:\Lead Scrapper PROD\makerkit-api-credits\deduct-leads\route.ts" \
    root@74.208.208.186:/root/next-supabase-saas-kit-turbo-main/apps/web/app/api/supabase/credits/deduct-leads/route.ts

ssh root@74.208.208.186 "cd /root/next-supabase-saas-kit-turbo-main && pnpm --filter web build && pm2 restart all"
```

PHP-side `apify-proxy.php` (the extras-queue safety fix) — usual scp + reload PHP-FPM.

### Verification

Dev account searches now show `Charged 0.00 / Delivered 100` (or however many leads available) without "0 leads / 124 queued" weirdness. Real users still pay normally via the database-backed deduct path.

End of follow-up session.
