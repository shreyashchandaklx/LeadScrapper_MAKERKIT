-- ════════════════════════════════════════════════════════════════════════════
-- Migration 003: Consolidate to 2 application tables
-- ════════════════════════════════════════════════════════════════════════════
--
-- Final architecture:
--   leadscrapper_leads_data    → scraped pool ONLY (UserEmail='__cache__' rows)
--   user_leadscrapper_leads    → per-user state for everything (delivered /
--                                queued / search / saved)
--   user_credits               → Makerkit credit wallet + new CustomerID column
--
-- Dropped:
--   customer_lookup            → CustomerID moves onto user_credits
--   __pending__ rows           → replaced by encoded fake runId in PHP
--   real-user rows in leadscrapper_leads_data → moved to user_leadscrapper_leads
--                                with Status='saved'
--
-- This migration is RUN ONCE, after migration 001 + 001b are already in place.
-- It is partially destructive: drops customer_lookup and removes rows from
-- leadscrapper_leads_data. TAKE A BACKUP FIRST.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 1: Add CustomerID column to user_credits
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE user_credits
    ADD COLUMN IF NOT EXISTS "CustomerID" integer UNIQUE;

-- Index for fast email→CustomerID lookups
CREATE INDEX IF NOT EXISTS idx_user_credits_email_lower
    ON user_credits (lower(trim("Email")));


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 2: Backfill CustomerIDs into user_credits from customer_lookup
-- ────────────────────────────────────────────────────────────────────────────

UPDATE user_credits uc
SET "CustomerID" = cl."CustomerID"
FROM customer_lookup cl
WHERE lower(trim(uc."Email")) = cl."UserEmail"
  AND uc."CustomerID" IS NULL;

-- Sanity: any user_credits rows still missing a CustomerID? Allocate now.
-- (This handles users who have a credit wallet but never appeared in
-- customer_lookup — edge case, but defensive.)
WITH unassigned AS (
    SELECT id, lower(trim("Email")) AS email_norm
    FROM user_credits
    WHERE "CustomerID" IS NULL
      AND "Email" IS NOT NULL
      AND lower(trim("Email")) <> ''
      AND lower(trim("Email")) NOT IN ('shreyashchandak.lx@gmail.com', 'shriganeshkolhe@gmail.com')
    ORDER BY created_at ASC NULLS LAST
)
UPDATE user_credits uc
SET "CustomerID" = nextval('customer_id_seq')
FROM unassigned u
WHERE uc.id = u.id;

-- Dev accounts: force 1 and 2 (in case they weren't in customer_lookup)
UPDATE user_credits SET "CustomerID" = 1
    WHERE lower(trim("Email")) = 'shreyashchandak.lx@gmail.com'
      AND ("CustomerID" IS NULL OR "CustomerID" <> 1);

UPDATE user_credits SET "CustomerID" = 2
    WHERE lower(trim("Email")) = 'shriganeshkolhe@gmail.com'
      AND ("CustomerID" IS NULL OR "CustomerID" <> 2);


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 3: Extend user_leadscrapper_leads for 'saved' rows
-- ────────────────────────────────────────────────────────────────────────────

-- Drop the old CHECK constraint so we can add the new status value
ALTER TABLE user_leadscrapper_leads
    DROP CONSTRAINT IF EXISTS chk_user_lead_status;

ALTER TABLE user_leadscrapper_leads
    ADD CONSTRAINT chk_user_lead_status
    CHECK ("Status" IN ('delivered', 'queued', 'search', 'saved'));

-- New per-user editable columns for Lead Manager
ALTER TABLE user_leadscrapper_leads
    ADD COLUMN IF NOT EXISTS "Notes"         text,
    ADD COLUMN IF NOT EXISTS "LeadScore"     numeric,
    ADD COLUMN IF NOT EXISTS "ManagerStatus" text;

-- Index for fast saved-leads load
CREATE INDEX IF NOT EXISTS idx_user_leadscrapper_leads_saved
    ON user_leadscrapper_leads ("CustomerID", "CreatedAt" DESC)
    WHERE "Status" = 'saved';


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 4: Migrate saved leads from leadscrapper_leads_data → user_leadscrapper_leads
-- ────────────────────────────────────────────────────────────────────────────
--
-- Source: rows in leadscrapper_leads_data where UserEmail is a real email
--         (not __cache__ / __pending__). These are leads users explicitly
--         saved to their Lead Manager.
--
-- Target: user_leadscrapper_leads with Status='saved'. Only stores per-user
--         metadata (Notes, LeadScore, ManagerStatus) — full business details
--         remain in leadscrapper_leads_data (the __cache__ row, looked up by
--         PlaceId at read time).

INSERT INTO user_leadscrapper_leads
    ("CustomerID", "UserEmail", "PlaceId", "SearchString", "Status",
     "Notes", "LeadScore", "ManagerStatus", "CreatedAt")
SELECT
    uc."CustomerID",
    lower(trim(lld."UserEmail")),
    lld."PlaceId",
    COALESCE(lld."SearchString", ''),
    'saved',
    lld."Notes",
    lld."LeadScore",
    lld."Status",         -- legacy Lead Manager status column
    COALESCE(lld."CreatedAt", now())
FROM leadscrapper_leads_data lld
JOIN user_credits uc ON lower(trim(uc."Email")) = lower(trim(lld."UserEmail"))
WHERE lld."UserEmail" NOT IN ('__cache__', '__pending__')
  AND lld."PlaceId" IS NOT NULL
  AND lld."PlaceId" <> ''
ON CONFLICT ("CustomerID", "PlaceId", "SearchString", "Status") DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 5: Rewrite assign_customer_id() RPC to use user_credits
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assign_customer_id(p_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email text := lower(trim(p_email));
    v_id    integer;
BEGIN
    IF v_email IS NULL OR v_email = '' THEN
        RAISE EXCEPTION 'email cannot be empty';
    END IF;

    -- Existing wallet?
    SELECT "CustomerID" INTO v_id
    FROM user_credits
    WHERE lower(trim("Email")) = v_email;

    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    -- Wallet exists but no CustomerID yet → allocate and assign.
    IF EXISTS (SELECT 1 FROM user_credits WHERE lower(trim("Email")) = v_email) THEN
        v_id := nextval('customer_id_seq');
        UPDATE user_credits
        SET "CustomerID" = v_id
        WHERE lower(trim("Email")) = v_email
          AND "CustomerID" IS NULL;

        -- Re-read in case a concurrent caller won the UPDATE.
        SELECT "CustomerID" INTO v_id
        FROM user_credits
        WHERE lower(trim("Email")) = v_email;

        RETURN v_id;
    END IF;

    -- No wallet at all → create one with 0 credits and a new CustomerID.
    v_id := nextval('customer_id_seq');
    INSERT INTO user_credits ("Email", "Credits", "CustomerID")
    VALUES (v_email, 0, v_id)
    ON CONFLICT ("Email") DO UPDATE
        SET "CustomerID" = COALESCE(user_credits."CustomerID", EXCLUDED."CustomerID");

    SELECT "CustomerID" INTO v_id
    FROM user_credits
    WHERE lower(trim("Email")) = v_email;

    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION assign_customer_id(text) TO anon, authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 6: Drop customer_lookup
-- ────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS customer_lookup;


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 7: Clean leadscrapper_leads_data — cache rows ONLY going forward
-- ────────────────────────────────────────────────────────────────────────────

-- Drop pending serves (transient, replaced by encoded runId in PHP)
DELETE FROM leadscrapper_leads_data
    WHERE "UserEmail" = '__pending__';

-- Drop real-user saved-leads rows — they've been migrated to user_leadscrapper_leads
DELETE FROM leadscrapper_leads_data
    WHERE "UserEmail" NOT IN ('__cache__');


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 8: Verification queries (run manually after migration)
-- ────────────────────────────────────────────────────────────────────────────
-- 8a. Every user_credits row has a CustomerID:
--   SELECT COUNT(*) FROM user_credits WHERE "CustomerID" IS NULL;
--   -- expected: 0
--
-- 8b. Devs at 1 and 2:
--   SELECT email, "CustomerID" FROM user_credits
--   WHERE "CustomerID" IN (1, 2) ORDER BY "CustomerID";
--
-- 8c. Saved leads migrated:
--   SELECT COUNT(*) FROM user_leadscrapper_leads WHERE "Status" = 'saved';
--   -- should match the count of real-user rows that WERE in leadscrapper_leads_data
--
-- 8d. leadscrapper_leads_data is cache-only:
--   SELECT DISTINCT "UserEmail" FROM leadscrapper_leads_data;
--   -- expected: only '__cache__'
--
-- 8e. customer_lookup is gone:
--   SELECT to_regclass('customer_lookup');
--   -- expected: NULL


COMMIT;
