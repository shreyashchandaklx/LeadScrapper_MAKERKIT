# City-Wide Lead Scraping — Implementation Plan (Phase B: server-side queue)

> **Goal:** A user searches by **Country → State → City** (no ZIP needed). The backend
> automatically walks every ZIP code in that city, one by one, scraping the same keyword
> in each, deduping results, and tracking progress (scraped / queued / failed) so it can
> survive Apify-key rotation, server restarts, and the user closing their browser.
>
> **Decisions locked (from 2026-06-10 meeting + sir):**
> - ❌ Remove the mandatory ZIP field — city is enough.
> - ✅ ZIPs are NOT stored in our DB as a master list — the bundled `zipcodes` npm package
>   already maps every US/Canada city → its ZIPs offline (Denver=69, NYC=159, LA=95). India
>   uses the free `api.postalpincode.in`. **Zero zip-data maintenance.**
> - ✅ Loop runs **in the backend**, ZIP-by-ZIP, no per-ZIP user prompts, no cost cap.
> - ✅ **Phase B** chosen: a shared ZIP queue table (which ZIPs are scraped) + a background
>   worker. Survives browser close. (Phase A browser-loop was rejected.)
> - ✅ **Leads themselves:** ONE shared bag per city+keyword; per user we store ONLY what
>   was **delivered**; "remaining" is computed live as `bag − delivered`. See §0.
>
> **Build nothing until sir approves this doc.**

---

## 0. THE CORE DATA MODEL (read this first — it removes all the "conflict" worry)

There are exactly **two things** to store, and **one calculation**. Everything else follows.

1. **The bag** — `leadscrapper_leads_data`, the shared scraped pool for a city+keyword.
   Every lead stored **once** (dedup by `PlaceId`). It only ever grows as ZIPs finish.
   The bag does **NOT** remember who scraped a lead, in which run, or from which ZIP.

2. **Delivered** — `user_leadscrapper_leads` rows with `Status='delivered'`: the exact
   `PlaceId`s a given user has **already received and paid for**. (Per user.)

**The one calculation, run fresh on every search:**
> **What a user still gets = (everything in the bag) − (PlaceIds that user already has delivered).**

That's the whole anti-conflict design. Consequences:
- We **store `delivered` only.** "Remaining / yet-to-deliver" is **computed live**, never stored
  (a `... WHERE PlaceId NOT IN (user's delivered ids)` query). No frozen "queued" rows that
  could go stale, no per-run bookkeeping.
- **Run order is irrelevant.** userA scrapes some ZIPs, userB scrapes others — all leads land
  in the same bag. Each user automatically gets every bag lead they don't already hold,
  *no matter who scraped it.* userB gets userA's leads and vice-versa, for free, with zero mapping.
- **The same PlaceId can be delivered to many users** (separate `delivered` rows) — each pays once.
  Apify scrapes it once; we sell it to many.
- When a user's `delivered` set = the whole bag → remaining is 0 → nothing to show, nothing to charge.

> The leftover after a free-tier/credit cap is just *the part of "remaining" the user hasn't
> paid for yet* — recomputed live next search. We do **not** need to persist it as `queued`.

---

## 0a-REALITY. Three corrections found when reading the actual code (2026-06-13)

Before coding, I read `lib/credits.php`, `lib/supabase.php`, `apify-proxy.php`. Three plan
assumptions were WRONG against production. These override earlier sections where they conflict:

1. **Credits live in Makerkit (HTTP), NOT in local Postgres.** `credits_get_balance()` /
   `credits_deduct_leads()` (`credits.php:106,125`) call `app.pixnom.com` over HTTP. So the
   planned `deliver_and_charge()` Postgres transaction (old HARDENING #5) is **impossible** —
   you can't wrap an HTTP money call in a SQL transaction. **Replacement:** reuse the existing
   `applyCreditSlice()` (`apify-proxy.php:194`), whose ordering is already safe — deduct via
   Makerkit FIRST, record `delivered` rows only on success, abort+touch-nothing on failure.
   RPCs are still used for the **ZIP queue** (claim/reap) — just NOT for money.

2. **Production DOES use `queued` rows.** `credits_enqueue_extras()` / `credits_get_extras()`
   (`credits.php:311–425`) store `Status=queued` overflow beyond a user's balance and read it
   back FIFO. The §0 "store delivered only, drop queued" idea would mean **rewriting working
   billing code** — rejected. **Keep production's delivered+queued machinery exactly as is.**
   (The §0 "bag − delivered" mental model is still the right way to *think* about it, but the
   implementation keeps the existing `queued` overflow rows.)

3. **Billing trigger (sir, 2026-06-13): charge a user ONLY when leads are shown to them.**
   The background worker **scrapes only — it charges nobody and writes no per-user rows.** It
   just fills the shared pool `leadscrapper_leads_data`. A user is billed via the EXISTING
   `applyCreditSlice()` path **when they view/pull the job's leads** (frontend poll → a proxy
   endpoint that runs the pool through `applyCreditSlice` for that user). This removes
   per-subscriber billing from the worker entirely — big simplification, and the dangerous
   money code stays 100% untouched/reused.

**Net effect on the build:** drop `deliver_and_charge()` RPC; keep `applyCreditSlice` as the
billing brain; the worker is a pure scraper (queue + Apify + pool insert); delivery+charge
happens on the user's view request, reusing today's exact per-search billing path.

### Delivery mechanism (decided during build — NO new money code)

The worker fills one cache entry **per ZIP** (`keyword|zip:XXXXX|cc`), exactly the key a
single-ZIP search uses. So delivery = **the frontend replays the normal single-ZIP
`apify-proxy.php` flow (run→check→dataset) for each scraped ZIP** as the job progresses:
- `run` finds the ZIP already cached → returns a `cached-` runId (no Apify call, free),
- `dataset` runs `applyCreditSlice` → bills the user for leads new to them, returns them.

This means: **`city-scrape-proxy.php` never touches credits** (orchestration only), and the
entire billing path is the existing, battle-tested per-ZIP code — reused verbatim, per ZIP.
Per-user dedup is global-by-PlaceId (`credits_get_delivered_ids` filters by PlaceId, NOT
SearchString — `credits.php:218`), so a business on a ZIP border is charged once even though
it appears under two ZIP cache keys.

---

## 0b. HARDENING (validated by 3 independent reviews — must-do before production)

Two external senior reviews (Claude + ChatGPT) independently scored the core design ~8.5/10
and **agreed the architecture is sound** (shared pool + delivered-only + PlaceId dedup +
bag−delivered). They did NOT change the design — they hardened the *implementation*. The
six rules below are the consensus must-dos. **Build them in from day one.**

> **Stack note that shapes ALL of these:** this app talks to Supabase via **PostgREST**
> (`sb_select`/`sb_insert`/`sb_request` in `lib/supabase_cache.php`), NOT raw SQL. PostgREST
> can't do `FOR UPDATE SKIP LOCKED` or multi-statement transactions over HTTP. So every
> atomic operation below is implemented as a **Postgres RPC function** called via PostgREST —
> exactly like the existing `assign_customer_id` RPC (`credits.php:180`). See §6b.

| # | Rule | Why | Where |
|---|---|---|---|
| 1 | **Anti-join, not `NOT IN`** — read remaining via `LEFT JOIN … WHERE delivered.PlaceId IS NULL` | `NOT IN` degrades badly once a user has 100k+ delivered rows | the "remaining" read query / RPC |
| 2 | **Atomic claim-next-ZIP + flip to `running` BEFORE the Apify call** (`SELECT … FOR UPDATE SKIP LOCKED` inside an RPC) | prevents TOCTOU double-scrape (worker crashes after reading `queued` but before marking it) | `claim_next_zip()` RPC |
| 3 | **Heartbeat + stuck-row reaper** — `heartbeat_at` + `worker_id` columns; re-queue rows stuck `running` with stale heartbeat | a crashed worker otherwise leaves a ZIP `running` forever | `city_scrape_zips` + reaper RPC |
| 4 | **Idempotent pool insert** — `ON CONFLICT (PlaceId, SearchString) DO NOTHING` | partial-write + retry safety (Apify returns 40, worker dies after 20, ZIP re-scrapes) | pool insert into `leadscrapper_leads_data` |
| 5 | **Transactional deliver-and-charge** — insert `delivered` rows AND deduct credits in ONE RPC transaction | THE money bug: a crash between the two = free leads or phantom charges | `deliver_and_charge()` RPC |
| 6 | **Quota-aware key selection, not blind rotation** — track per-key remaining/cooldown; pick best, skip exhausted | blind round-robin wastes calls on already-dead keys | new `apify_keys` table + `pick_apify_key()` |

**SHOULD-DO (cheap, high value):** progressive delivery (show leads as ZIPs finish, don't
wait for all 70 — design already polls); mark empty ZIPs `scraped` with `result_count=0` so
"done-but-empty" ≠ "still running"; show **scrape age** in UI ("refreshed 11 days ago");
log suspiciously-low result counts (Apify cheap tier may silently truncate).

**DEFER to v2 (correct, but over-engineering for current scale — note, don't build now):**
- **Apify webhooks** instead of synchronous polling — cleaner, decouples worker from run
  duration, but needs a new HMAC-verified public endpoint. **v1 = keep the poll loop.**
- **Place vs Snapshot versioning** — so a user who "owns" a place can see refreshed
  phone/website later. Big schema change. **v1 = delivered once → owns latest snapshot we have.**
- **`scraper_version` in the job key** — add the column (default `v1`), no logic yet.
- **Partition `leadscrapper_leads_data` by date** — only matters at millions of rows; keep
  schema partition-friendly but don't build it now.
- **Supervisor/systemd daemon or Supabase Edge Functions** instead of cron+`flock` — fine
  to launch on cron+flock; revisit when operational visibility matters.

---

## 1. Why the "how many ZIPs do we store?" debate is moot

The meeting conflict was *"storing 20 ZIPs × thousands of US cities is unmaintainable."*
It is — so we don't. `node_modules/zipcodes` (5 MB, offline, already imported at
`components/LeadSearch.jsx:30`) gives us every ZIP for any US/Canada city instantly:

```js
zipcodes.lookupByName('Denver','CO')  // → 69 ZIP rows, 1 ms, no API, no DB
```

We expand city→ZIPs **at job-creation time** and write those ZIPs into the job's queue
table. We store ZIPs **per job** (ephemeral, lasts the life of that scrape), never as a
master list. India: same idea via the free postal API at job creation.

---

## 2. What already exists (we reuse, not rebuild)

`apify-proxy.php` already does the hard parts — per-run billing, dedup, key rotation:

| Capability | Where | Reuse in loop |
|---|---|---|
| Apify key rotation (KEY_1..21, rotate on 402/403/429) | `apify-proxy.php:78,412` | worker calls same proxy logic |
| Per-run `postalCode` + `countryCode` search | `LeadSearch.jsx:478-486` | one ZIP = one run, unchanged |
| Dedup by `PlaceId`, never double-charge | `apify-proxy.php:applyCreditSlice` | a business on a ZIP border is charged once |
| **Shared scraped pool** `leadscrapper_leads_data` (`UserEmail='__cache__'`) | `lib/credits.php:145` | scrape a lead ONCE, everyone reads it |
| **Per-user state** `user_leadscrapper_leads` with `Status` (`delivered`/`queued`/`saved`) | `lib/credits.php:197` | already tracks "who has what" — `delivered`=has it, `queued`=owed it |
| Credit deduction (1 lead = 1 credit, atomic) | `credits_deduct_leads()` | **billing happens per ZIP as loop runs** |

> **Important (corrected):** the old `leadscrapper_delivered` table was DELETED. The live model
> (post-migration 003) is two tables: `leadscrapper_leads_data` (shared scraped pool, tagged
> `UserEmail='__cache__'`) + `user_leadscrapper_leads` (per-user rows with a `Status` column).
> **`Status` IS the per-user ledger** — `delivered` = the user has & paid for that PlaceId,
> `queued` = owed but not yet delivered (the "extras" from a free-tier slice). This is exactly
> the "100 delivered / 200 queued, next run promotes more to delivered" behaviour, and it
> already runs in production (`credits_get_delivered_ids`, `credits_enqueue_extras`,
> `credits_record_delivered`, `credits_get_extras`).

**The only new thing is the orchestration layer**: a ZIP-queue + a worker that feeds ZIPs
through the *existing* pipeline one at a time, filling the shared pool. **Per-user lead
tracking is NOT rebuilt — `user_leadscrapper_leads.Status` already does it.**

### How the city feature plugs into this model
- Today a search is keyed per-ZIP: `SearchString = "plumber|zip:01915|us"`.
- For whole-city, the **shared pool** fills ZIP-by-ZIP from all ~70 Denver ZIPs, but the
  user's per-row `SearchString` becomes a **city-level key**: `"plumber|denver,co|us"`.
- So a user's `delivered`/`queued` rows track *"how much of the whole Denver pool have I
  received,"* spanning 70 ZIPs of leads instead of one. Same code, wider key.

---

## 3. Architecture

```
┌─ Browser ─────────────┐     ┌─ PHP backend ───────────────┐     ┌─ Supabase ────────────┐
│ City dropdown         │     │ scrape-job-proxy.php        │     │ scrape_jobs           │
│  → "Scrape whole city"│────▶│  • expand city→ZIPs (zipcodes)│──▶│ scrape_job_zips       │
│ Poll job status       │◀────│  • create job + enqueue ZIPs │     │ (queued/scraped/...)  │
│  progress bar         │     └──────────────────────────────┘     └───────────────────────┘
│                       │     ┌─ scrape_worker.php (cron) ──┐               ▲
│                       │◀────│  • lock, pull next queued ZIP│──────────────┘
└───────────────────────┘     │  • run via existing apify    │  marks scraped/failed,
                              │    pipeline (key rotation)   │  deducts credits, dedup
                              │  • loop until time budget    │
                              └──────────────────────────────┘
```

**Why the worker is PHP-cron, not a Node/pm2 service** (key senior decision):
all billing + Apify + dedup logic is already in PHP. Rewriting it in Node (like Map2Web's
worker) would duplicate the most dangerous code in the app — the part that charges money.
So the worker is a **PHP CLI script driven by cron**, reusing `lib/credits.php` and the
apify run/poll/dataset functions verbatim. LeadScrapper's stack is nginx + php-fpm; we add
one cron line, no new runtime.

---

## 3b. TWO SEARCH MODES (sir's refinement — ZIP optional)

The ZIP field is **optional**. What the user enters decides the mode:

### Mode 1 — ZIP entered → scrape THAT ZIP only (foreground, like today)
- No city job, no 69-ZIP queue, no background worker. Just scrape the single ZIP and return
  results — **exactly today's existing flow, unchanged.**
- BUT: the leads still land in the **shared bag** (`leadscrapper_leads_data`), and we
  **record that ZIP as `scraped`** under the city's job row (lazily create the
  `city_scrape_jobs` row for that city+keyword if it doesn't exist, mark just this one ZIP
  `scraped`, leave the rest unlisted). This is what lets a later city search reuse the work.

### Mode 2 — no ZIP → scrape the WHOLE city (background queue, the main feature)
- Expand city → 69 ZIPs, enqueue them, background worker drains them (everything in §3–§7).

### The reuse rule (sir's Denver example) — **skip any ZIP already scraped**
When a Mode-2 city search builds its 69-ZIP queue, **any ZIP already marked `scraped` for
that city+keyword is set straight to `scraped` (skipped), and only the remaining ZIPs are
`queued`.**

> **Sir's example:** UserX searches `Denver + ZIP 80202` (Mode 1) → 80202 scraped, its
> leads in the bag, 80202 marked `scraped` under the Denver-plumber job. Later anyone
> searches `Denver` (Mode 2) → we build the 69-ZIP queue but **80202 is already `scraped`,
> so we skip it and the worker scrapes only the other 68.**

**Decision locked (sir chose A):** **always skip a ZIP that has ever been scraped** — no
per-ZIP freshness re-check. Simplest + cheapest. (City-level freshness, §10 Q5, still governs
when the *whole* city is considered stale enough to re-scrape from scratch.)

**Billing is unchanged and consistent:** the Mode-2 user is still charged for the 80202
leads if they're new to *them* (normal `bag − delivered` rule). Whoever physically triggered
the 80202 Apify scrape (UserX) is irrelevant — same "scrape once, sell to many" model we
already agreed on. A reused ZIP just means Apify wasn't hit again; the leads are sold to the
new user normally.

> **Implementation:** Mode-1's single-ZIP path calls a small
> `record_single_zip_scraped(city_key, zip)` helper (find-or-create the job, upsert that ZIP
> as `scraped`). Mode-2's enqueue does `INSERT … ON CONFLICT (job_id, zip) DO NOTHING` for
> the 69 ZIPs, so any pre-existing `scraped` row is preserved, not reset to `queued`.

---

## 4. New Supabase tables

**Design principle (Option B — shared city pool):** a city-scrape job is keyed by
**city + keyword + country**, NOT by user. The first user to search "plumber in Denver"
creates the job; later users searching the same thing **subscribe** to it rather than
starting a fresh scrape. Each ZIP is scraped **once, ever** (within the freshness window),
its leads land in the existing shared pool `leadscrapper_leads_data`, and every user is
then served — and billed — only for the leads they personally don't yet have (via the
existing `user_leadscrapper_leads.Status` ledger). This is what makes "userA does ZIPs
1–20, userB does 21–50, userA finishes 51–70" work, with nobody re-scraping.

### 4a. `city_scrape_jobs` — one row per city+keyword (shared, NOT per user)
```sql
create table city_scrape_jobs (
  id            uuid primary key default gen_random_uuid(),
  search_key    text not null,                 -- canonical city key, e.g. "plumber|denver,co|us"
  keyword       text not null,                 -- "plumber"
  country_code  text not null,                 -- "us"
  state         text not null,                 -- "CO"
  city          text not null,                 -- "Denver"
  status        text not null default 'queued',-- queued|running|completed|failed
  zips_total    int  not null default 0,
  zips_done     int  not null default 0,
  zips_failed   int  not null default 0,
  pool_leads    int  not null default 0,       -- total leads in shared pool for this key
  last_scraped_at timestamptz,                  -- freshness: re-scrape if older than N days
  scraper_version text not null default 'v1',   -- v2-defer: column now, logic later
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (search_key)                          -- ONE job per city+keyword
);
create index on city_scrape_jobs (status);
```

### 4b. `city_scrape_zips` — one row per ZIP in a city job (the shared queue)
```sql
create table city_scrape_zips (
  id          bigint generated always as identity primary key,
  job_id      uuid not null references city_scrape_jobs(id) on delete cascade,
  zip         text not null,
  status      text not null default 'queued',  -- queued|running|scraped|failed
  apify_run_id text,
  leads_count int  not null default 0,          -- leads added to the pool from THIS zip
                                                --   (0 = scraped-but-empty, NOT "still running")
  attempts    int  not null default 0,
  error       text,
  worker_id   text,                             -- HARDENING #3: which worker holds it
  started_at  timestamptz,                      -- when this run began
  heartbeat_at timestamptz,                     -- HARDENING #3: reaper re-queues if stale
  scraped_at  timestamptz,
  unique (job_id, zip)
);
create index on city_scrape_zips (job_id, status);
create index on city_scrape_zips (status, heartbeat_at);
```

### 4c. `city_scrape_subscribers` — which users want this city (for delivery + UI)
```sql
create table city_scrape_subscribers (
  id          bigint generated always as identity primary key,
  job_id      uuid not null references city_scrape_jobs(id) on delete cascade,
  email       text not null,
  customer_id int,
  created_at  timestamptz default now(),
  unique (job_id, email)
);
```

> **Why three tables, not "one job per user":** the ZIP queue (`city_scrape_zips`) is the
> shared to-do list — active users collaboratively drain it. `unique(search_key)` guarantees
> only ONE Denver-plumber job exists, so two users never double-scrape the same ZIP.
> `city_scrape_subscribers` just records who's interested (so each gets progress + their
> own delivery/billing). The **actual leads** still live in `leadscrapper_leads_data`, and
> **who-has-what** still lives in `user_leadscrapper_leads.Status` — both unchanged.
> A crashed worker leaves a ZIP `running` with a stale `heartbeat_at`; the reaper (HARDENING
> #3) re-queues rows where `status='running' AND heartbeat_at < now()-10min`.

### 4d. `apify_keys` — quota-aware key selection (HARDENING #6)
```sql
create table apify_keys (
  id             serial primary key,
  key_ref        text not null,                 -- which APIFY_KEY_n env var (NOT the secret itself)
  runs_today     int  not null default 0,
  last_reset     date,
  cooldown_until timestamptz,                    -- set on 402/429; skip until past
  is_suspended   boolean not null default false,
  unique (key_ref)
);
```
> Worker picks `WHERE NOT is_suspended AND (cooldown_until IS NULL OR cooldown_until < now())
> ORDER BY runs_today ASC LIMIT 1` — least-used healthy key, not blind rotation. On quota
> error → set `cooldown_until = now()+1h`. Nightly reset zeroes `runs_today` + clears cooldown.
> **The actual secrets stay in env vars** (`APIFY_KEY_1..21`); this table only tracks *state*.

---

## 4e. Atomicity via Postgres RPCs (HARDENING #1,#2,#5 — the stack-specific part)

PostgREST can't run `FOR UPDATE SKIP LOCKED` or multi-statement transactions over HTTP, so
the atomic operations live in **Postgres functions** called via `rpc/<name>` (like the
existing `assign_customer_id`). These ship in the migration:

| RPC | Does (atomically) | Replaces |
|---|---|---|
| `claim_next_zip(p_worker_id)` | `SELECT … WHERE status='queued' ORDER BY oldest FOR UPDATE SKIP LOCKED LIMIT 1`, flip it to `running` + stamp `worker_id`/`started_at`/`heartbeat_at`, `RETURNING` the row. **Round-robin** = order by oldest-queued across jobs (or `(job_id, seq)`) so a 60-ZIP job can't starve a 2-ZIP job. | naive "read then update" (TOCTOU double-scrape) |
| `reap_stuck_zips()` | re-queue rows `status='running' AND heartbeat_at < now()-10min` | worker-crash leaves ZIP stuck forever |
| `deliver_and_charge(p_customer, p_place_ids, p_search_key)` | in ONE transaction: `SELECT credits FOR UPDATE`, insert `delivered` rows `ON CONFLICT DO NOTHING`, deduct credits, commit. Returns how many were actually delivered/charged. | two separate PHP calls (crash = free leads or phantom charge; double-tab race) |
| `pick_apify_key()` | atomically choose least-used healthy key + bump `runs_today` | blind round-robin wasting calls on dead keys |

> The worker calls `heartbeat()` (a tiny `UPDATE … SET heartbeat_at=now()`) periodically
> during a long Apify poll so the reaper doesn't snatch a ZIP that's legitimately still running.

---

## 5. New / changed files

### New files
| File | Purpose |
|---|---|
| `city-scrape-proxy.php` | **(Mode 2 only — no ZIP)** **POST** `{action:create, email, keyword, country, state, city}` → builds `search_key`, **finds-or-creates** the `city_scrape_jobs` row, expands city→ZIPs and enqueues them with `ON CONFLICT (job_id,zip) DO NOTHING` so any ZIP already `scraped` (e.g. from a prior Mode-1 single-ZIP search, §3b) is **preserved/skipped**, not re-queued; adds the user to `city_scrape_subscribers`, returns `{jobId}`. **GET ?action=status&jobId=&email=** → progress (`zips_done/zips_total`, `pool_leads`, scrape age) + how many leads this user has been delivered. **POST {action:cancel}** → unsubscribe the user (the shared job keeps running for others). |
| `city_scrape_worker.php` (CLI) | Cron-driven. `flock` so only one runs. First call `reap_stuck_zips()`. Loop within ~50s budget: `claim_next_zip()` (atomic, round-robin) → `pick_apify_key()` → run via existing Apify pipeline, calling `heartbeat()` during the poll → write leads to pool `ON CONFLICT DO NOTHING` → `deliver_and_charge()` per subscriber → mark ZIP `scraped`+`leads_count` (0 = scraped-but-empty), bump counters. On quota-exhaust (402/429): set key `cooldown_until`, put ZIP **back to `queued`**. On 3 failed attempts: mark `failed`. |
| `lib/city_scrape.php` | Thin PHP wrappers over the RPCs (§4e) + reads: `find_or_create_job`, `enqueue_zips` (`ON CONFLICT DO NOTHING` so pre-scraped ZIPs are preserved, §3b), `record_single_zip_scraped` (Mode-1 reuse hook, §3b), `claim_next_zip`, `reap_stuck`, `mark_zip_done/failed`, `deliver_and_charge`, `pick_apify_key`, `add_subscriber`, `get_status`, `remaining_for_user` (**anti-join**, HARDENING #1). |
| `migrations/2026xxxx_city_scrape.sql` | The four tables in §4 + the RPC functions in §4e + the `ON CONFLICT` unique index on the pool insert. |

### Changed files
| File | Change |
|---|---|
| `components/LeadSearch.jsx` | 1) ZIP field becomes **optional** (no toggle needed — the presence of a ZIP picks the mode, §3b). 2) Validation `:440` no longer requires `zipCode`. 3) **ZIP entered → Mode 1**: today's exact single-ZIP flow, untouched (results return inline). 4) **No ZIP → Mode 2**: POST to `city-scrape-proxy.php`, get `jobId`, switch panel to **job-progress mode** (poll status every ~4 s: progress bar + leads-delivered-to-me + scrape-age + Cancel); newly-delivered leads stream in as ZIPs complete. |
| `apify-proxy.php` | No structural change. Both modes + the worker call the same run/poll/dataset + `applyCreditSlice` path. **Mode-1 single-ZIP path additionally calls `record_single_zip_scraped()`** so that ZIP is reusable by a later city search (§3b). Billing/dedup already correct. |
| `lib/credits.php` | **Unchanged.** Worker reuses `applyCreditSlice` / `credits_record_delivered` / `credits_enqueue_extras` — the existing `delivered`/`queued` Status ledger does all per-user tracking. |

> **What does NOT change:** the leads still live in `leadscrapper_leads_data` (shared pool),
> who-has-what still lives in `user_leadscrapper_leads.Status`. We are NOT adding a new
> per-user leads table — the city tables only manage the **ZIP queue** and **subscriptions**.

---

## 6. Billing model in a background loop (the part to get right)

Today: credits deducted synchronously while the user watches. In a background loop the
user is gone, so:

1. Delivery + charge happen in **one `deliver_and_charge()` RPC transaction** (HARDENING #5):
   `SELECT credits FOR UPDATE` → insert `delivered` rows `ON CONFLICT DO NOTHING` → deduct
   credits → commit. A crash can't leave "leads delivered but not charged" or vice-versa,
   and two browser tabs can't both spend the same balance.
2. We deliver only PlaceIds the user doesn't already have (anti-join, HARDENING #1). A
   PlaceId already `delivered` to them is never re-charged. The shared pool stops any re-scrape.
3. **Out-of-credits mid-delivery** (decision needed — see §10 Q3): deliver up to the balance
   and stop; the rest stays simply *undelivered* (= `bag − delivered`, computed live, NOT a
   stored row). Topping up + searching again delivers more. The **shared scrape never pauses**
   for one user's balance — it keeps filling the pool for everyone.
4. Because we store only `delivered` and always diff against it, a user is **never charged
   twice** for the same business, and a mid-loop crash never double-bills.

**This is the safest possible model** — no big upfront charge, no surprise drain beyond
what the user's balance allows, charge-and-deliver is atomic, and it stops itself when
credits run out. (Note: no stored `queued` rows — that complexity was removed per §0.)

### 6a. Billing rule — credits are PER USER (confirmed by sir 2026-06-13)

> **Each user pays for their own copy of a lead. The shared pool saves YOUR Apify cost, NOT
> the user's price.**

- userA searches → gets 100 leads → **100 credits deducted from userA**.
- userB later scrapes/searches the **same** 100 leads → they are NOT in userB's `delivered`
  set → brand-new to userB → **100 credits deducted from userB too**.
- This is correct, not a double-charge. "Double-charge" only means charging the **same user
  twice for the same PlaceId** — that never happens (a PlaceId already in a user's
  `delivered` set is excluded by the anti-join).

| Scenario | Credits charged |
|---|---|
| Different users, same lead | **Each user pays** (userA 100, userB 100) |
| Same user, same lead again | **0** — already in their `delivered` set |
| Apify scrape of that lead | **Once, total** — reused from the shared bag, never re-scraped |

This is the "scrape once (cheap for us), sell to many (full price each)" model — it is the
core of the feature's margin. The only alternative ("first buyer pays, others get it free")
would destroy revenue and is explicitly NOT what we do.

---

## 7. Concurrency, ordering, failure handling

- **One worker at a time** via `flock` (v1). But claim ZIPs with `claim_next_zip()` /
  `FOR UPDATE SKIP LOCKED` from day one (HARDENING #2) so adding a 2nd worker later is safe.
- **Claim BEFORE the Apify call** — flip ZIP to `running` atomically first, so a crash can't
  cause a double-scrape (TOCTOU).
- **Sequential ZIPs** within the worker's ~50s budget; cron relaunches each minute. Denver
  (~70 ZIPs) at ~1–3 min/ZIP ≈ steady background completion; UI shows live progress.
- **Apify keys exhausted (402/429)**: set that key's `cooldown_until`, put the ZIP **back to
  `queued`**; `pick_apify_key()` skips cooled-down keys. If all keys cooled → worker exits,
  retries next tick. Job stays `running`.
- **Per-ZIP failure**: increment `attempts`; after 3 tries mark `failed`, continue.
  `zips_failed` surfaced in UI.
- **Scraped-but-empty**: ZIP with 0 Apify results → mark `scraped`, `leads_count=0` (NOT
  ambiguous "running") so the job can complete cleanly.
- **Stuck-row reaper** (HARDENING #3): `reap_stuck_zips()` re-queues rows `running` with
  `heartbeat_at` older than 10 min (covers worker crash / FPM restart). Worker heartbeats
  during long polls so legitimately-running ZIPs aren't snatched.
- **Cancel**: unsubscribe the user; the shared job keeps running for other subscribers. An
  in-flight ZIP finishes (can't un-scrape an Apify run already paid for).

---

## 8. Cron / deploy (VPS)

```cron
# every minute: launch worker; it self-exits if another holds the lock or no work
* * * * * /usr/bin/php /var/www/leadscrapper.pixnom.com/city_scrape_worker.php >> /var/www/leadscrapper.pixnom.com/logs/worker.log 2>&1
# nightly: reset Apify per-key daily counters + clear cooldowns
3 0 * * * /usr/bin/php /var/www/leadscrapper.pixnom.com/city_scrape_worker.php --reset-keys >> /var/www/leadscrapper.pixnom.com/logs/worker.log 2>&1
```
- Add `city-scrape-proxy.php`, `city_scrape_worker.php`, `lib/city_scrape.php` to the
  `copy-php` build script so deploys include them.
- Run the migration on Supabase (4 tables + RPC functions in §4e).
- Errors in the worker go through the existing `lib/error_logger.php` (`ERR-LS-LEAD-…`).

---

## 9. Build order (estimate ~4–5 days — hardening adds ~1 day)

| # | Step | Files | Est. |
|---|---|---|---|
| 1 | Migration: 4 tables (§4) + 4 RPCs (§4e) + pool unique index for `ON CONFLICT` | `migrations/…city_scrape.sql` | 2 h |
| 2 | PHP wrappers over RPCs + reads (incl. `remaining_for_user` anti-join) | `lib/city_scrape.php` | 3 h |
| 3 | Proxy: find-or-create job + city→ZIP expand + subscribe / status / cancel | `city-scrape-proxy.php` | 3 h |
| 4 | Worker: flock, reap, claim, pick-key, run-pipeline, heartbeat, pool insert ON CONFLICT, deliver_and_charge per subscriber | `city_scrape_worker.php` | 6 h |
| 5 | Frontend: city mode toggle, job-progress UI, polling, scrape-age label, cancel | `LeadSearch.jsx` | 5 h |
| 6 | Local E2E: 2-user share, interleaved scrapes, key cooldown, crash→reap→resume, out-of-credits, double-tab charge | — | 4 h |
| 7 | Deploy: migration+RPCs, files, cron (worker + nightly key reset), verify | VPS | 2 h |

Independent of error-logging and security work; can ship on its own.

### How long will it take to implement?

**Hands-on coding: ~21 hours of work ≈ 3–4 focused working days.**
With the normal back-and-forth (you review + test each piece before we move to the next,
so we never ship a money-handling bug), realistically **about 1 week** start to finish.

> The "hours" above are mostly **review + testing time**, not waiting on the code itself —
> each piece is written quickly, but billing-related code gets verified before the next step.

---

## 9b. New files — what each one is and why it exists

These are the **only new files**. Everything else (billing, Apify keys, dedup) is reused
from the existing code, not rebuilt.

| New file | What it is | Why we need it |
|---|---|---|
| `migrations/2026xxxx_city_scrape.sql` | The SQL that creates the **3 Supabase tables** (`city_scrape_jobs` + `city_scrape_zips` + `city_scrape_subscribers`). | The shared "to-do list" — ONE job per city+keyword, one row per ZIP with `queued/running/scraped/failed`, plus who's subscribed. Without it there's nowhere to remember progress when the browser closes, or to share a city across users. |
| `lib/city_scrape.php` | A small library of **database helper functions** (find-or-create the city job, insert all the ZIPs, grab the next queued ZIP safely + round-robin, mark done/failed, update counters, recover after a crash, add subscriber). | Keeps all the DB logic in **one tidy place** so the proxy and worker call simple functions instead of raw SQL. Makes "grab next ZIP" safe when two things run at once. |
| `city-scrape-proxy.php` | The **front door** the browser talks to. **create** (find-or-create the city job, expand ZIPs on first creation, subscribe the user), report **status** (progress bar + my-leads-delivered), and **cancel** (unsubscribe). | Runs the moment the user clicks "Scrape whole city." Reuses an existing fresh city scrape if one's running, else starts one — and hands back a `jobId`. |
| `city_scrape_worker.php` | The **background robot**, run by cron every minute. Locks so only one runs, picks the next queued ZIP (**round-robin across cities**), scrapes via the **existing** Apify pipeline, writes leads to the shared pool, marks the ZIP done, handles quota-exhausted by re-queuing. | The engine that walks the ZIPs one-by-one in the background — lets users close the browser and come back to finished leads. |

**Changed (not new):**
- `components/LeadSearch.jsx` — make the ZIP box optional, add the **"Whole city" toggle** and the **progress bar**. Single-ZIP search stays exactly as it is today.
- `apify-proxy.php` / `lib/credits.php` — **reused as-is** (worker calls the same money + scraping logic; the `delivered`/`queued` Status ledger is unchanged). Nothing rewritten.
- `package.json` — `copy-php` build step now also copies `city-scrape-proxy.php`, `city_scrape_worker.php`, and `lib/city_scrape.php` into `dist/`.

---

## 9c. AS-BUILT contract (CS-5 done 2026-06-14) — billing is ON-VIEW, worker SCRAPES ONLY

The build follows §0a-REALITY, NOT the older rows 4–5 of §9 (those said "deliver_and_charge
per subscriber in the worker", which is impossible — credits live in Makerkit over HTTP).
What actually shipped:

**Worker (`city_scrape_worker.php`)** — scrapes each ZIP into the shared pool under cacheKey
`keyword|zip:XXXXX|cc` and marks the ZIP `scraped`. **It charges nobody.**

**Frontend (`LeadSearch.jsx`)** drives billing-on-view:
- `handleSearch` — ZIP optional. ZIP present → existing single-ZIP flow. ZIP empty (city
  selected) → `handleCityScrape()`. Button label flips to "Scrape Whole City".
- `handleCityScrape()` — POSTs `?action=create {email,keyword,country,state,city,zips:[...]}`
  (frontend expands city→ZIPs via the `zipcodes` pkg / India API; PHP has no ZIP dataset),
  then polls `?action=status&jobId=` every 6 s. Status now returns **`scrapedZips: [...]`**.
- `pullZipLeads(zip)` — for each ZIP the backend reports `scraped`, replays the **existing**
  apify-proxy `run→check→dataset` flow. Because the worker already filled that ZIP's cache,
  it's a **cache hit** (no Apify spend) and `applyCreditSlice()` bills THIS user for leads
  new to them (per-user dedup by PlaceId). **The frontend only pulls `scrapedZips`** so the
  browser never races the worker with a live run. Pulls are serialized; a 402 stops cleanly,
  unsubscribes, and shows "top up" — already-pulled ZIPs stay billed/delivered.
- **Mode-1 reuse hook** — a successful single-ZIP search fires `?action=record-zip` (best-effort)
  → `cs_record_single_zip_scraped()` marks that ZIP `scraped` under its city job, so a later
  whole-city run skips it (never re-scraped).
- `handleCancel()` — stops the poller + `?action=cancel` (unsubscribe); the shared worker
  keeps running for other subscribers.

**New proxy actions beyond create/status/cancel:** `record-zip` (Mode-1 hook). **status** now
includes `scrapedZips` (from `cs_get_scraped_zips($jobId)`).

Validation: `npx vite build` passes (JSX valid). No local PHP — `php -l` deferred to VPS (CS-6).

### CS-6 local E2E findings (2026-06-14)
- **Worker pipeline verified** on Denver/plumber via XAMPP `D:\xampp\php\php.exe` (PHP not on PATH; serves localhost:8000). Ran worker by hand (no local cron): 80201→0, 80202→19, 80203→10, 80204→17, 80205→12, 80206→16. Job counters (`zips_done=6, pool_leads=74, zips_failed=0`) recomputed correctly by `finish_zip`. apify_keys auto-seeded on first run.
- **Billing-on-view verified**: replayed browser pull for 80202 → `cached=true, delivered=19, charged=19`; 19 `delivered` rows written to `user_leadscrapper_leads` for the user. Pool stores `UserEmail='__cache__'`; per-user ledger only on view. (Note: `user_leadscrapper_leads` has NO `Title` column — it's a thin ledger: CustomerID, UserEmail, PlaceId, SearchString, Status…)
- **BUG FIXED — enqueue clobber**: `cs_enqueue_zips` used `sb_insert(...,upsert)` which is `resolution=merge-duplicates` (a real overwrite), so re-running a city search reset already-`scraped`/`running` ZIPs back to `queued` (would re-scrape + re-bill the whole city). Fixed to SELECT existing ZIPs for the job and INSERT only missing ones — never overwrites existing rows. Verified a re-`create` now preserves scraped ZIPs.
- **BUG FIXED — empty-ZIP re-scrape leak**: a ZIP scraped to 0 leads writes NO cache row (pool only stores non-empty merges), so the frontend pull would cache-MISS and fire a fresh LIVE Apify run every time (wasted $ + race). Fixed `cs_get_scraped_zips()` to filter `leads_count=gt.0` — the frontend never pulls empty ZIPs (nothing to show/bill). Verified: 80201 (0 leads) excluded; only 80202–80206 returned.
- **Status semantics confirmed correct**: `running` shown during a scrape = `claim_next_zip` flipped the ZIP to running+heartbeat before the Apify call (TOCTOU guard); `finish_zip` sets `scraped` after. Not a bug.
- **Local test cost**: Apify free tier $5 cap (~$0.08–$1/ZIP) — don't run all 69 locally; cron handles the rest on prod.

---

## 10. Open questions for sir (answer before build)

1. **Outside US/CA/IN** (e.g. UK, Australia): the `zipcodes` pkg is US/CA only, India has
   its API. For other countries we'd fall back to **city-name search (no ZIP loop)** —
   acceptable? Or restrict whole-city mode to US/CA/IN for now?
2. **Max ZIPs per job** — even though we don't cost-cap, do we want a sanity ceiling (e.g.
   skip cities with >200 ZIPs, or just warn)? Protects against someone queuing a whole metro.
3. **Out-of-credits mid-delivery** — confirm the rule: deliver up to the user's balance,
   stop, leave the rest *undelivered* (it's just `bag − delivered`, re-shown on next search
   after top-up). No "Resume" button needed since nothing is frozen. **(I recommend this —
   it falls out of the store-delivered-only model for free.)**
4. **One active city-job per user at a time**, or allow several queued in parallel? (One at
   a time is simpler and friendlier to the shared Apify key pool — I recommend it.)
5. **Freshness window** — once a city is fully scraped into the pool, how many days before
   it's "stale" and we re-scrape? (Businesses open/close.) I recommend **7–14 days**.
6. **Lead versioning (v2 defer)** — a user who already "owns" a business won't see refreshed
   phone/website after a re-scrape. OK for v1 (own latest snapshot we have), or does sir want
   full snapshot history from day one? **(I recommend defer.)**
7. **"City" definition** — city limits only, or metro (does "Denver" include Aurora/Englewood)?
   The `zipcodes` package returns city-limit ZIPs; metro needs a wider lookup. **(Recommend
   city-limits for v1; note the gap.)**

---

## 11. Worked example — what every table looks like

> Denver = 70 ZIPs (illustrative). Keyword "plumber". Shows the exact state after each step.

> **We store `delivered` only. "Remaining" is always `bag − delivered`, computed live.**
> No `queued` rows. No per-run accounting. Counts below are just the live result sizes.

### CASE A — SAME user runs "plumber in Denver" twice (free tier: 100 leads/run)

**Run 1** — userA (CustomerID 1010). Worker scrapes ZIPs; bag fills to 300. Free tier
delivers 100 → those 100 PlaceIds get `delivered` rows. Remaining = 300 − 100 = **200 (live)**.

`city_scrape_zips` (shared ZIP queue): 30 `scraped`, 1 `running`, 39 `queued`.
`leadscrapper_leads_data` (the bag): ChIJ_001 … ChIJ_300 (300 leads, scraped once).
`user_leadscrapper_leads` (userA — **only delivered stored**):
| CustomerID | SearchString | PlaceId | Status |
|---|---|---|---|
| 1010 | plumber\|denver,co\|us | ChIJ_001 … ChIJ_100 | **delivered** (100) |

→ userA's "remaining" is NOT a stored 200 — it's a live anti-join: `bag LEFT JOIN his
  delivered WHERE delivered.PlaceId IS NULL` (HARDENING #1, never `NOT IN`).

**Run 2** — userA searches again. Bag is now 1000 (city finished). Worker did NOT re-scrape.
Live calc: bag(1000) − his delivered(100) = **900 available**. Free tier delivers next 100 →
he now has 200 `delivered` rows. Remaining = 1000 − 200 = **800 (live)**, never stored.

`user_leadscrapper_leads` (userA):
| CustomerID | PlaceId range | Status |
|---|---|---|
| 1010 | ChIJ_001 … ChIJ_200 | **delivered** (200) |

> No `queued` rows anywhere. "He still has 800 waiting" is a live COUNT, not a saved number.
> Never charged twice — a PlaceId already in his `delivered` set is excluded next time.

---

### CASE B — TWO users + interleaved scrapes (your A→B→A, 800/1800/2800 scenario)

userA scrapes ZIPs 1–8 (bag→800), userB scrapes 9–45 (bag→1800), userA finishes 46–70
(bag→2800). **Each ZIP scraped ONCE. All leads land in the ONE bag.**

`city_scrape_zips` — shared progress (resume point is per-CITY, not per-user):
| zips | status | (incidentally run by) |
|---|---|---|
| 1–8 | scraped | userA's worker run |
| 9–45 | scraped | userB's worker run |
| 46–70 | scraped | userA's worker run |

`leadscrapper_leads_data` (the bag): ChIJ_001 … ChIJ_2800 — **2800 unique, scraped once total.**

`user_leadscrapper_leads` — **only delivered stored per user:**
| CustomerID | Status | delivered count |
|---|---|---|
| 1010 (userA) | delivered | 200 |
| 1011 (userB) | delivered | 100 |

**The two questions answered by the live calc (nothing is run-tied):**
- *"How does userA get userB-run's leads (PlaceIds 801–1800)?"* → They're in the bag.
  userA's available = bag(2800) − his delivered(200) = **2600**, which **includes** 801–1800.
  He gets them simply because they're in the bag and not in his delivered set.
- *"How does userB get userA-run-3's leads (1801–2800)?"* → Same. userB available =
  bag(2800) − his delivered(100) = **2700**, which **includes** 1801–2800.

> The same PlaceId can be `delivered` to BOTH users (separate rows), each charged once.
> **Apify paid once per ZIP; sold to many.** Run order is irrelevant — the bag doesn't
> remember who scraped what, and each user just gets `bag − their own delivered`.
