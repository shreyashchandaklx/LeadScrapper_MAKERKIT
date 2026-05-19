-- ============================================================================
-- 03_deduplicate_leads.sql
-- Run this ONCE in Supabase SQL editor to:
--   1) Remove duplicate leads — keep only ONE row per (CustomerID, PlaceId)
--      preferring the row with empty SearchString (the "saved" version)
--   2) Remove 'search' audit rows from user_leadscrapper_leads (they belong
--      in leadscrapper_searches, not cluttering the lead table)
-- ============================================================================

-- Step 1: Delete duplicate 'delivered' rows that have a non-empty SearchString
-- when there's already a 'delivered' row with empty SearchString for the same
-- (CustomerID, PlaceId) combo.
DELETE FROM public.user_leadscrapper_leads AS a
WHERE a."Status" = 'delivered'
  AND a."SearchString" <> ''
  AND EXISTS (
    SELECT 1
    FROM public.user_leadscrapper_leads AS b
    WHERE b."CustomerID" = a."CustomerID"
      AND b."PlaceId" = a."PlaceId"
      AND b."Status" = 'delivered'
      AND b."SearchString" = ''
  );

-- Step 2: For leads that ONLY have non-empty SearchString rows and appear more
-- than once with different SearchStrings, keep only the most recent one.
-- First: identify duplicated (CustomerID, PlaceId) pairs where all rows have
-- non-empty SearchString, and delete all but the newest.
DELETE FROM public.user_leadscrapper_leads
WHERE ctid NOT IN (
  SELECT DISTINCT ON ("CustomerID", "PlaceId") ctid
  FROM public.user_leadscrapper_leads
  WHERE "Status" IN ('delivered', 'saved')
  ORDER BY "CustomerID", "PlaceId", "CreatedAt" DESC NULLS LAST
)
AND "Status" IN ('delivered', 'saved');

-- Step 3: Remove any 'search' audit rows (synthetic PlaceId starting with 'search_')
-- These were logged for audit purposes but shouldn't appear as leads.
DELETE FROM public.user_leadscrapper_leads
WHERE "Status" = 'search';

-- Step 4: Remove any 'queued' rows where a 'delivered' row already exists
-- for the same (CustomerID, PlaceId) — these are stale extras.
DELETE FROM public.user_leadscrapper_leads AS a
WHERE a."Status" = 'queued'
  AND EXISTS (
    SELECT 1
    FROM public.user_leadscrapper_leads AS b
    WHERE b."CustomerID" = a."CustomerID"
      AND b."PlaceId" = a."PlaceId"
      AND b."Status" = 'delivered'
  );

-- Verify: check for any remaining duplicates
SELECT "CustomerID", "PlaceId", COUNT(*) AS cnt
FROM public.user_leadscrapper_leads
WHERE "Status" IN ('delivered', 'saved')
GROUP BY "CustomerID", "PlaceId"
HAVING COUNT(*) > 1
ORDER BY cnt DESC
LIMIT 20;
