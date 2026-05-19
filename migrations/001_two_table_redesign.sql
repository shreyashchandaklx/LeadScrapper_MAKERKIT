-- ════════════════════════════════════════════════════════════════════════════
-- Migration 001: Two-Table Redesign
-- ════════════════════════════════════════════════════════════════════════════
--
-- Goal: Replace 4 tables with 2 properly normalized tables.
--
-- Final design:
--   Table 1: leadscrapper_leads_data   (existing, repurposed)
--            — scraped lead pool (one row per business per search)
--            — no UserEmail column anymore; this is the master pool only
--
--   Table 2: user_leadscrapper_leads   (new)
--            — per-user state: delivered / queued / search-audit
--            — references leadscrapper_leads_data by (PlaceId, SearchString)
--
-- Customer IDs:
--   - shreyashchandak.lx@gmail.com → CustomerID = 1   (dev)
--   - shriganeshkolhe@gmail.com    → CustomerID = 2   (dev)
--   - Real users start from 1001 via customer_id_seq.
--
-- Strategy (zero-downtime):
--   1. Create new table `user_leadscrapper_leads` alongside the old setup.
--   2. Copy data from leadscrapper_extras + leadscrapper_delivered +
--      leadscrapper_searches into it.
--   3. Move cache rows of leadscrapper_leads_data into a clean state (drop
--      __cache__/__pending__ sentinel design — keep the table as a pure
--      master lead pool with no UserEmail).
--   4. Old 3 helper tables (extras/delivered/searches) stay intact until PHP
--      cutover is complete. They are dropped in 002_drop_old_tables.sql.
--
-- This migration is SAFE to run while the live app is running:
--   - leadscrapper_leads_data keeps existing rows (cache + saved-leads).
--   - user_leadscrapper_leads is brand new — no conflict.
--   - We do NOT yet remove UserEmail column from leadscrapper_leads_data.
--     That happens in a later migration once PHP code is cut over.
-- ════════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 1: Customer ID sequence + lookup table
-- ────────────────────────────────────────────────────────────────────────────

-- 1a. Customer ID sequence (real users start at 1001)
CREATE SEQUENCE IF NOT EXISTS customer_id_seq START WITH 1001 INCREMENT BY 1;

-- 1b. customer_lookup — email ↔ CustomerID mapping
--     Devs reserved at 1 and 2 below.
CREATE TABLE IF NOT EXISTS customer_lookup (
    "CustomerID" integer     PRIMARY KEY,
    "UserEmail"  text        UNIQUE NOT NULL,
    "CreatedAt"  timestamptz NOT NULL DEFAULT now()
);

-- 1c. Reserve dev IDs (1 and 2)
INSERT INTO customer_lookup ("CustomerID", "UserEmail")
VALUES
    (1, 'shreyashchandak.lx@gmail.com'),
    (2, 'shriganeshkolhe@gmail.com')
ON CONFLICT ("UserEmail") DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 2: Create user_leadscrapper_leads (Table 2)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_leadscrapper_leads (
    "CustomerID"   integer     NOT NULL,
    "UserEmail"    text        NOT NULL,
    "PlaceId"      text        NOT NULL,
    "SearchString" text        NOT NULL,
    "Status"       text        NOT NULL,
    "SearchMeta"   jsonb,
    "CreatedAt"    timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY ("CustomerID", "PlaceId", "SearchString", "Status"),

    CONSTRAINT chk_user_lead_status
        CHECK ("Status" IN ('delivered', 'queued', 'search'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_leadscrapper_leads_customer
    ON user_leadscrapper_leads ("CustomerID", "Status", "SearchString");

CREATE INDEX IF NOT EXISTS idx_user_leadscrapper_leads_email
    ON user_leadscrapper_leads ("UserEmail", "Status", "SearchString");

CREATE INDEX IF NOT EXISTS idx_user_leadscrapper_leads_search_audit
    ON user_leadscrapper_leads ("UserEmail", "CreatedAt" DESC)
    WHERE "Status" = 'search';


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 3: Assign CustomerIDs to all existing users (oldest first → 1001)
-- ────────────────────────────────────────────────────────────────────────────

WITH all_users AS (
    SELECT DISTINCT lower(trim(user_email)) AS email, min_created
    FROM (
        SELECT user_email,        MIN(delivered_at) AS min_created FROM leadscrapper_delivered  GROUP BY user_email
        UNION ALL
        SELECT user_email,        MIN(queued_at)    AS min_created FROM leadscrapper_extras     GROUP BY user_email
        UNION ALL
        SELECT user_email,        MIN(created_at)   AS min_created FROM leadscrapper_searches   GROUP BY user_email
        UNION ALL
        SELECT "UserEmail" AS user_email, MIN("CreatedAt") AS min_created
            FROM leadscrapper_leads_data
            WHERE "UserEmail" NOT IN ('__cache__', '__pending__')
            GROUP BY "UserEmail"
    ) t
    WHERE user_email IS NOT NULL
      AND lower(trim(user_email)) NOT IN ('shreyashchandak.lx@gmail.com', 'shriganeshkolhe@gmail.com')
      AND lower(trim(user_email)) <> ''
),
ordered AS (
    SELECT email, MIN(min_created) AS first_activity
    FROM all_users
    GROUP BY email
    ORDER BY MIN(min_created) ASC
)
INSERT INTO customer_lookup ("CustomerID", "UserEmail", "CreatedAt")
SELECT nextval('customer_id_seq'), email, first_activity
FROM ordered
ON CONFLICT ("UserEmail") DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 4: Copy per-user data into user_leadscrapper_leads
-- ────────────────────────────────────────────────────────────────────────────

-- 4a. delivered rows
INSERT INTO user_leadscrapper_leads ("CustomerID", "UserEmail", "PlaceId", "SearchString", "Status", "CreatedAt")
SELECT
    c."CustomerID",
    lower(trim(d.user_email)),
    d.place_id,
    d.cache_key,
    'delivered',
    d.delivered_at
FROM leadscrapper_delivered d
JOIN customer_lookup c ON c."UserEmail" = lower(trim(d.user_email))
WHERE d.place_id IS NOT NULL AND d.place_id <> ''
  AND d.cache_key IS NOT NULL AND d.cache_key <> ''
ON CONFLICT ("CustomerID", "PlaceId", "SearchString", "Status") DO NOTHING;

-- 4b. queued rows
INSERT INTO user_leadscrapper_leads ("CustomerID", "UserEmail", "PlaceId", "SearchString", "Status", "CreatedAt")
SELECT
    c."CustomerID",
    lower(trim(e.user_email)),
    e.place_id,
    e.cache_key,
    'queued',
    e.queued_at
FROM leadscrapper_extras e
JOIN customer_lookup c ON c."UserEmail" = lower(trim(e.user_email))
WHERE e.place_id IS NOT NULL AND e.place_id <> ''
  AND e.cache_key IS NOT NULL AND e.cache_key <> ''
ON CONFLICT ("CustomerID", "PlaceId", "SearchString", "Status") DO NOTHING;

-- 4c. search audit rows
INSERT INTO user_leadscrapper_leads ("CustomerID", "UserEmail", "PlaceId", "SearchString", "Status", "SearchMeta", "CreatedAt")
SELECT
    c."CustomerID",
    lower(trim(s.user_email)),
    'search_' || s.id::text,
    s.cache_key,
    'search',
    jsonb_build_object(
        'pool_size',       s.pool_size,
        'delivered_count', s.delivered_count,
        'credits_charged', s.credits_charged,
        'source',          s.source,
        'keyword',         s.keyword,
        'location_label',  s.location_label
    ),
    s.created_at
FROM leadscrapper_searches s
JOIN customer_lookup c ON c."UserEmail" = lower(trim(s.user_email))
WHERE s.cache_key IS NOT NULL AND s.cache_key <> ''
ON CONFLICT ("CustomerID", "PlaceId", "SearchString", "Status") DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 4b: RPC for safe customer_id assignment from PHP
-- ────────────────────────────────────────────────────────────────────────────
-- The PHP layer calls this via POST /rest/v1/rpc/assign_customer_id with
-- {"p_email": "user@example.com"}. It returns the CustomerID (existing or new).
-- SECURITY DEFINER so it can run under PostgREST's anon role.

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

    -- Try to find an existing row first.
    SELECT "CustomerID" INTO v_id
    FROM customer_lookup
    WHERE "UserEmail" = v_email;

    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    -- Allocate a new id from the sequence (real users at 1001+).
    v_id := nextval('customer_id_seq');

    -- Insert; tolerate race where a concurrent call wins.
    INSERT INTO customer_lookup ("CustomerID", "UserEmail")
    VALUES (v_id, v_email)
    ON CONFLICT ("UserEmail") DO NOTHING;

    -- Re-read in case the concurrent insert claimed the email.
    SELECT "CustomerID" INTO v_id
    FROM customer_lookup
    WHERE "UserEmail" = v_email;

    RETURN v_id;
END;
$$;

-- Grant execute to PostgREST roles
GRANT EXECUTE ON FUNCTION assign_customer_id(text) TO anon, authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- STAGE 5: Verification queries — RUN MANUALLY AFTER MIGRATION
-- ────────────────────────────────────────────────────────────────────────────
-- All SELECT-only. Run them in Supabase SQL editor and confirm counts match.

-- 5a. How many customers were created?
--   SELECT COUNT(*) AS total_customers FROM customer_lookup;
--   SELECT * FROM customer_lookup ORDER BY "CustomerID" LIMIT 20;

-- 5b. Per-user state row counts comparison
--   SELECT
--     (SELECT COUNT(*) FROM user_leadscrapper_leads WHERE "Status" = 'delivered') AS new_delivered,
--     (SELECT COUNT(*) FROM leadscrapper_delivered)                                AS old_delivered,
--     (SELECT COUNT(*) FROM user_leadscrapper_leads WHERE "Status" = 'queued')    AS new_queued,
--     (SELECT COUNT(*) FROM leadscrapper_extras)                                   AS old_extras,
--     (SELECT COUNT(*) FROM user_leadscrapper_leads WHERE "Status" = 'search')    AS new_search,
--     (SELECT COUNT(*) FROM leadscrapper_searches)                                 AS old_searches;
--
--   Expected: each "new_*" count == its "old_*" counterpart. Small drift acceptable
--   if there were rows with NULL email or invalid place_id (we filter those out).

-- 5c. Spot-check a known user
--   SELECT * FROM user_leadscrapper_leads
--   WHERE "UserEmail" = 'shreyashchandak321@gmail.com'
--   ORDER BY "Status", "CreatedAt"
--   LIMIT 50;

-- 5d. Confirm cache pool is intact (no rows touched)
--   SELECT COUNT(*) FROM leadscrapper_leads_data WHERE "UserEmail" = '__cache__';
--   -- should match what you had before the migration


-- ════════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DOES NOT DO (intentionally):
-- ════════════════════════════════════════════════════════════════════════════
-- ✗ Does NOT drop leadscrapper_extras / _delivered / _searches.
--   These stay as a safety net until PHP cutover is verified.
--
-- ✗ Does NOT modify leadscrapper_leads_data at all.
--   The cache rows (UserEmail='__cache__') stay where they are; PHP can keep
--   reading from them via the OLD supabase_cache.php flow during the cutover.
--   After PHP cutover, a follow-up migration can drop those sentinel rows.
--
-- ✗ Does NOT remove UserEmail column from leadscrapper_leads_data.
--   That column is still needed for saved-leads (Lead Manager content).
-- ════════════════════════════════════════════════════════════════════════════
