-- ════════════════════════════════════════════════════════════════════════════
-- Migration 002: Drop the old tables
-- ════════════════════════════════════════════════════════════════════════════
--
-- DO NOT RUN THIS UNTIL:
--   1. Migration 001 was run successfully.
--   2. New PHP code has been deployed and running stably for at least 24 hours.
--   3. Verification queries in 001 all match expected counts.
--   4. You have a recent Supabase backup.
--
-- This is destructive and irreversible without a backup.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- The 3 audit/state tables — fully replaced by user_lead_state
DROP TABLE IF EXISTS leadscrapper_delivered;
DROP TABLE IF EXISTS leadscrapper_extras;
DROP TABLE IF EXISTS leadscrapper_searches;

-- The mixed-purpose table (cache rows + real user leads)
--
-- WARNING: This table also stored REAL USER LEADS (UserEmail = real email,
-- not __cache__). Those are leads users saved to their Lead Manager.
-- They are NOT migrated into leads_master automatically by migration 001
-- because they're "saved leads," not "cache pool."
--
-- Before dropping, decide:
--   (a) Are saved leads still needed? Then create migration 003 to move them
--       into a new `saved_leads` table first.
--   (b) Or keep leadscrapper_leads_data around (don't drop) and just use it
--       for the saved-leads Lead Manager feature.
--
-- Option (b) is safer: only drop the rows we know are cache/pending sentinels.

DELETE FROM leadscrapper_leads_data
WHERE "UserEmail" IN ('__cache__', '__pending__');

-- Real user lead rows (Lead Manager content) remain in leadscrapper_leads_data.
-- This is intentional — those are user-saved leads, not cache.

COMMIT;
