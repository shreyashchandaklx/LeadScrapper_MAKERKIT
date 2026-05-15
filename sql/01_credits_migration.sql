-- Leadscrapper credit-system migration
-- Run this ONCE in Supabase SQL editor BEFORE deploying the new code.
--
-- 1. Allow fractional credits (so 0.65 deductions work). Existing integer
--    balances are preserved verbatim (99 -> 99.00).
-- 2. Track which place_ids each user has already received for a given
--    keyword+location, so we never re-charge them for the same leads.
-- 3. Audit log: one row per search (who searched, how many they got, charged).

-- ---------------------------------------------------------------------------
-- 1) Make Credits fractional
-- ---------------------------------------------------------------------------
alter table public.user_credits
  alter column "Credits" type numeric(10,2)
  using "Credits"::numeric(10,2);

-- ---------------------------------------------------------------------------
-- 2) Per-user delivered ledger (the "reservation" the user already paid for)
-- ---------------------------------------------------------------------------
create table if not exists public.leadscrapper_delivered (
  user_email   text        not null,
  cache_key    text        not null,        -- e.g. "plumbers|zip:90001|us"
  place_id     text        not null,
  delivered_at timestamptz not null default now(),
  primary key (user_email, cache_key, place_id)
);

create index if not exists leadscrapper_delivered_lookup_idx
  on public.leadscrapper_delivered (user_email, cache_key);

-- ---------------------------------------------------------------------------
-- 3) Search audit log
-- ---------------------------------------------------------------------------
create table if not exists public.leadscrapper_searches (
  id              uuid          primary key default gen_random_uuid(),
  user_email      text          not null,
  keyword         text          not null,
  location_label  text          not null,        -- "ZIP 90001" or "Denver, CO"
  cache_key       text          not null,
  pool_size       int           not null,        -- total places in shared cache after this search
  delivered_count int           not null,        -- handed to the user this time
  credits_charged numeric(10,2) not null,
  source          text          not null,        -- 'apify' | 'cache' | 'reserve' | 'mixed'
  created_at      timestamptz   not null default now()
);

create index if not exists leadscrapper_searches_user_idx
  on public.leadscrapper_searches (user_email, created_at desc);
