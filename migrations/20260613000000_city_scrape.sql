-- ════════════════════════════════════════════════════════════════════════════
-- Migration: City-wide scraping — ZIP queue + Apify key state
-- ════════════════════════════════════════════════════════════════════════════
--
-- Adds the orchestration layer for whole-city scraping. See
--   D:\Lead Scrapper PROD\city_scrape_plan.md
--
-- IMPORTANT (per §0a-REALITY of the plan):
--   * Credits live in Makerkit (HTTP), NOT here — so there is NO deliver_and_charge
--     RPC. Billing stays in applyCreditSlice() (apify-proxy.php), unchanged.
--   * The background worker SCRAPES ONLY: it fills the shared pool
--     leadscrapper_leads_data and never touches credits or per-user rows.
--     Users are charged via applyCreditSlice() when they VIEW the leads.
--   * These tables manage ONLY: (a) the per-city ZIP work queue, (b) who's
--     subscribed for progress, (c) Apify per-key quota state.
--
-- This migration is purely additive — it creates new tables + RPCs and touches
-- no existing table or data. Safe to run on the live DB.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- TABLE 1: city_scrape_jobs — one row per city+keyword (shared, NOT per user)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS city_scrape_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    search_key      text NOT NULL,                 -- canonical, e.g. "plumber|denver,co|us"
    keyword         text NOT NULL,
    country_code    text NOT NULL,
    state           text NOT NULL,
    city            text NOT NULL,
    status          text NOT NULL DEFAULT 'queued' -- queued|running|completed|failed
        CHECK (status IN ('queued','running','completed','failed')),
    zips_total      integer NOT NULL DEFAULT 0,
    zips_done       integer NOT NULL DEFAULT 0,
    zips_failed     integer NOT NULL DEFAULT 0,
    pool_leads      integer NOT NULL DEFAULT 0,     -- denormalized count for UI
    last_scraped_at timestamptz,                    -- freshness window anchor
    scraper_version text NOT NULL DEFAULT 'v1',     -- v2-defer: column now, logic later
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_city_scrape_jobs_key UNIQUE (search_key)
);

CREATE INDEX IF NOT EXISTS idx_city_scrape_jobs_status
    ON city_scrape_jobs (status);


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE 2: city_scrape_zips — one row per ZIP in a city job (the work queue)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS city_scrape_zips (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id        uuid NOT NULL REFERENCES city_scrape_jobs(id) ON DELETE CASCADE,
    zip           text NOT NULL,
    status        text NOT NULL DEFAULT 'queued'   -- queued|running|scraped|failed
        CHECK (status IN ('queued','running','scraped','failed')),
    apify_run_id  text,
    leads_count   integer NOT NULL DEFAULT 0,        -- leads added to pool (0 = scraped-but-empty)
    attempts      integer NOT NULL DEFAULT 0,
    error         text,
    worker_id     text,                              -- HARDENING #3: which worker holds it
    started_at    timestamptz,
    heartbeat_at  timestamptz,                       -- HARDENING #3: reaper re-queues if stale
    scraped_at    timestamptz,
    CONSTRAINT uq_city_scrape_zips UNIQUE (job_id, zip)
);

CREATE INDEX IF NOT EXISTS idx_city_scrape_zips_job_status
    ON city_scrape_zips (job_id, status);
-- claim_next_zip orders queued rows by id (monotonic insert order)
CREATE INDEX IF NOT EXISTS idx_city_scrape_zips_claim
    ON city_scrape_zips (status, id);
CREATE INDEX IF NOT EXISTS idx_city_scrape_zips_reaper
    ON city_scrape_zips (status, heartbeat_at);


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE 3: city_scrape_subscribers — who wants this city (progress + delivery)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS city_scrape_subscribers (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id      uuid NOT NULL REFERENCES city_scrape_jobs(id) ON DELETE CASCADE,
    email       text NOT NULL,
    customer_id integer,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_city_scrape_subscribers UNIQUE (job_id, email)
);


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE 4: apify_keys — quota-aware key selection (HARDENING #6)
--   NOTE: stores STATE only. The actual secrets stay in env (APIFY_KEY_1..21).
--   key_ref names which env var, e.g. 'APIFY_KEY_3'.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apify_keys (
    id             serial PRIMARY KEY,
    key_ref        text NOT NULL,
    runs_today     integer NOT NULL DEFAULT 0,
    last_reset     date,
    cooldown_until timestamptz,                      -- set on 402/429; skip until past
    is_suspended   boolean NOT NULL DEFAULT false,
    CONSTRAINT uq_apify_keys_ref UNIQUE (key_ref)
);


-- ════════════════════════════════════════════════════════════════════════════
-- RPC 1: claim_next_zip — atomic claim of the oldest queued ZIP (HARDENING #2)
--   FOR UPDATE SKIP LOCKED so it's safe even with >1 worker. Flips to 'running'
--   and stamps worker/heartbeat BEFORE returning, eliminating TOCTOU double-scrape.
--   Round-robin-ish fairness: order by id (monotonic insert order) across all
--   active jobs, so a big job can't fully starve a small one that was queued
--   around the same time. (Pure FIFO is acceptable for v1; revisit if needed.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION claim_next_zip(p_worker_id text)
RETURNS SETOF city_scrape_zips
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id bigint;
BEGIN
    SELECT z.id INTO v_id
    FROM city_scrape_zips z
    JOIN city_scrape_jobs j ON j.id = z.job_id
    WHERE z.status = 'queued'
      AND j.status IN ('queued','running')
    ORDER BY z.id ASC
    FOR UPDATE OF z SKIP LOCKED
    LIMIT 1;

    IF v_id IS NULL THEN
        RETURN;  -- no work
    END IF;

    RETURN QUERY
    UPDATE city_scrape_zips
    SET status       = 'running',
        worker_id    = p_worker_id,
        started_at   = now(),
        heartbeat_at = now(),
        attempts     = attempts + 1
    WHERE id = v_id
    RETURNING *;

    -- Mark the parent job 'running' on first pickup.
    UPDATE city_scrape_jobs
    SET status = 'running', updated_at = now()
    WHERE id = (SELECT job_id FROM city_scrape_zips WHERE id = v_id)
      AND status = 'queued';
END;
$$;
GRANT EXECUTE ON FUNCTION claim_next_zip(text) TO anon, authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- RPC 2: heartbeat_zip — keep a long-running ZIP alive so the reaper won't grab it
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION heartbeat_zip(p_zip_id bigint, p_worker_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE city_scrape_zips
    SET heartbeat_at = now()
    WHERE id = p_zip_id AND worker_id = p_worker_id AND status = 'running';
$$;
GRANT EXECUTE ON FUNCTION heartbeat_zip(bigint, text) TO anon, authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- RPC 3: reap_stuck_zips — re-queue ZIPs whose worker died (HARDENING #3)
--   Returns the number reclaimed (for logging).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION reap_stuck_zips(p_stale_minutes integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count integer;
BEGIN
    WITH reclaimed AS (
        UPDATE city_scrape_zips
        SET status = 'queued', worker_id = NULL, started_at = NULL, heartbeat_at = NULL
        WHERE status = 'running'
          AND heartbeat_at < now() - make_interval(mins => p_stale_minutes)
        RETURNING 1
    )
    SELECT count(*) INTO v_count FROM reclaimed;
    RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION reap_stuck_zips(integer) TO anon, authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- RPC 4: finish_zip — mark a ZIP done/failed and bump parent job counters
--   p_status: 'scraped' | 'failed' | 'queued' (re-queue on quota exhaustion)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION finish_zip(
    p_zip_id      bigint,
    p_status      text,
    p_leads_count integer DEFAULT 0,
    p_apify_run   text DEFAULT NULL,
    p_error       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job uuid;
BEGIN
    SELECT job_id INTO v_job FROM city_scrape_zips WHERE id = p_zip_id;
    IF v_job IS NULL THEN RETURN; END IF;

    IF p_status = 'queued' THEN
        -- Quota exhaustion: release the ZIP, do NOT count as done/failed.
        UPDATE city_scrape_zips
        SET status = 'queued', worker_id = NULL, started_at = NULL, heartbeat_at = NULL
        WHERE id = p_zip_id;
        RETURN;
    END IF;

    UPDATE city_scrape_zips
    SET status       = p_status,
        leads_count  = COALESCE(p_leads_count, 0),
        apify_run_id = COALESCE(p_apify_run, apify_run_id),
        error        = p_error,
        scraped_at   = CASE WHEN p_status = 'scraped' THEN now() ELSE scraped_at END,
        heartbeat_at = NULL,
        worker_id    = NULL
    WHERE id = p_zip_id;

    -- Recompute parent counters from the source of truth (idempotent, race-safe).
    UPDATE city_scrape_jobs j
    SET zips_done   = sub.done,
        zips_failed = sub.failed,
        pool_leads  = j.pool_leads + COALESCE(p_leads_count, 0),
        status      = CASE WHEN sub.done + sub.failed >= j.zips_total AND j.zips_total > 0
                           THEN 'completed' ELSE j.status END,
        last_scraped_at = CASE WHEN p_status = 'scraped' THEN now() ELSE j.last_scraped_at END,
        updated_at  = now()
    FROM (
        SELECT
            count(*) FILTER (WHERE status = 'scraped') AS done,
            count(*) FILTER (WHERE status = 'failed')  AS failed
        FROM city_scrape_zips WHERE job_id = v_job
    ) sub
    WHERE j.id = v_job;
END;
$$;
GRANT EXECUTE ON FUNCTION finish_zip(bigint, text, integer, text, text) TO anon, authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- RPC 5: pick_apify_key — choose least-used healthy key + bump runs_today
--   Returns the chosen key_ref (text), or NULL if all keys are cooled/suspended.
--   Auto-resets a key's daily counter when last_reset < today.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION pick_apify_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ref text;
BEGIN
    -- Daily auto-reset (idempotent): clear counters/cooldowns from previous days.
    UPDATE apify_keys
    SET runs_today = 0, cooldown_until = NULL, is_suspended = false, last_reset = current_date
    WHERE last_reset IS DISTINCT FROM current_date;

    SELECT key_ref INTO v_ref
    FROM apify_keys
    WHERE NOT is_suspended
      AND (cooldown_until IS NULL OR cooldown_until < now())
    ORDER BY runs_today ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_ref IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE apify_keys SET runs_today = runs_today + 1 WHERE key_ref = v_ref;
    RETURN v_ref;
END;
$$;
GRANT EXECUTE ON FUNCTION pick_apify_key() TO anon, authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- RPC 6: cooldown_apify_key — mark a key exhausted (called on 402/429)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION cooldown_apify_key(p_key_ref text, p_minutes integer DEFAULT 60)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE apify_keys
    SET cooldown_until = now() + make_interval(mins => p_minutes)
    WHERE key_ref = p_key_ref;
$$;
GRANT EXECUTE ON FUNCTION cooldown_apify_key(text, integer) TO anon, authenticated, service_role;


COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- POST-MIGRATION (run manually): seed apify_keys with the env key refs you use.
--   The worker also self-seeds a key_ref on first use, but seeding up-front lets
--   pick_apify_key round-robin across all of them from run #1.
--
--   INSERT INTO apify_keys (key_ref, last_reset) VALUES
--     ('APIFY_KEY_1', current_date), ('APIFY_KEY_2', current_date), ...
--   ON CONFLICT (key_ref) DO NOTHING;
--
-- Smoke tests:
--   SELECT * FROM claim_next_zip('test-worker');   -- should return a row or nothing
--   SELECT reap_stuck_zips(10);                     -- returns count reclaimed
--   SELECT pick_apify_key();                        -- returns a key_ref or NULL
-- ════════════════════════════════════════════════════════════════════════════
