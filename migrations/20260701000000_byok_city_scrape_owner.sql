-- BYOK: add owner_email to city_scrape_jobs so the worker uses the job
-- creator's own Apify key instead of the house rotation pool.
-- Applied: 2026-07-01

ALTER TABLE city_scrape_jobs
  ADD COLUMN IF NOT EXISTS owner_email text;
