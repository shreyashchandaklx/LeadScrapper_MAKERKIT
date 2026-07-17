-- ════════════════════════════════════════════════════════════════════════════
-- City-scrape: scrape-until-target (stop draining the whole city)
--
-- PROBLEM: the worker scraped EVERY ZIP in a city, burning Apify quota even
-- though a user only ever sees ~100 leads (credits_compute_slice $maxPerSearch).
--
-- FIX: give each job a `target_leads` (default 100). The worker stops claiming
-- ZIPs for a job once its pool has reached the target; leftover ZIPs stay
-- 'queued' but dormant. When a user needs MORE than the pool holds, the proxy
-- raises target_leads (+100) and the worker resumes from where it stopped.
--
-- The ENTIRE stop logic is one extra predicate in claim_next_zip:
--     AND j.pool_leads < j.target_leads
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) New column (idempotent — table already live on prod).
ALTER TABLE city_scrape_jobs
    ADD COLUMN IF NOT EXISTS target_leads integer NOT NULL DEFAULT 100;

-- 2) claim_next_zip — same as before + skip jobs that already hit their target.
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
      AND j.pool_leads < j.target_leads      -- ← STOP: job has enough leads
    ORDER BY z.id ASC
    FOR UPDATE OF z SKIP LOCKED
    LIMIT 1;

    IF v_id IS NULL THEN
        RETURN;  -- no work (every active job is at/over target, or queue empty)
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

    UPDATE city_scrape_jobs
    SET status = 'running', updated_at = now()
    WHERE id = (SELECT job_id FROM city_scrape_zips WHERE id = v_id)
      AND status = 'queued';
END;
$$;
GRANT EXECUTE ON FUNCTION claim_next_zip(text) TO anon, authenticated, service_role;

-- 3) bump_job_target — raise a job's target so a dormant city resumes scraping.
--   Called by the proxy when a user starts a search and the pool may not hold
--   enough fresh leads for them. Rule: if the pool has already reached the
--   current target (a prior run stopped here), push the target to pool+increment
--   so the worker resumes for ~`increment` more leads. Otherwise leave it — the
--   in-flight run will reach the existing target on its own.
--   Returns the (possibly unchanged) target.
CREATE OR REPLACE FUNCTION bump_job_target(p_job_id uuid, p_increment integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_target integer;
BEGIN
    UPDATE city_scrape_jobs
    SET target_leads = CASE
            WHEN pool_leads >= target_leads THEN pool_leads + p_increment
            ELSE target_leads
        END,
        -- Re-open a job that had completed (all ZIPs done at the old target) so
        -- the dormant queued ZIPs become claimable again.
        status = CASE
            WHEN status = 'completed'
                 AND pool_leads >= target_leads
                 AND zips_done + zips_failed < zips_total
                THEN 'queued'
            ELSE status
        END,
        updated_at = now()
    WHERE id = p_job_id
    RETURNING target_leads INTO v_target;

    RETURN COALESCE(v_target, 0);
END;
$$;
GRANT EXECUTE ON FUNCTION bump_job_target(uuid, integer) TO anon, authenticated, service_role;

COMMIT;
