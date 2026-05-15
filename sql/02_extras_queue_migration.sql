-- Leadscrapper credit-system migration
-- Run this ONCE in Supabase SQL editor BEFORE deploying the new code.
--
-- 1. Allow fractional credits (so 0.65 deductions work). Existing integer
--    balances are preserved verbatim (99 -> 99.00).
-- 2. Track which place_ids each user has already received for a given
--    keyword+location, so we never re-charge them for the same leads.
-- 3. Audit log: one row per search (who searched, how many they got, charged).
--
-- ---------------------------------------------------------------------------
-- 1) Make Credits fractional
-- ---------------------------------------------------------------------------
alter table public.user_credits
  alter column "Credits" type numeric(10,2)
  using "Credits"::numeric(10,2);

-- ---------------------------------------------------------------------------
-- 2) Per-user delivered ledger (the "reservation" the user already paid for)
-- ---------------------------------------------------------------------------
create table if not exists public.leadscrapper_extras (
  user_email  text        NOT NULL,
  cache_key   text        NOT NULL,
  place_id    text        NOT NULL,
  queued_at   timestamptz NOT NULL DEFAULT now(),
  constraint leadscrapper_extras_pkey
    primary key (user_email, cache_key, place_id)
);

create index if not exists leadscrapper_extras_user_key_time
  on public.leadscrapper_extras (user_email, cache_key, queued_at);

create index if not exists leadscrapper_extras_cache_key
  on public.leadscrapper_extras (cache_key);
